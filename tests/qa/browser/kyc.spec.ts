import { existsSync, readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import sharp from 'sharp';
import { adminAdvance, contactStep, journey, K03_DOCS, observe, reachVerify, specimenPath, uploadAll, verdict } from './qa-helpers';

const SPECIMENS = JSON.parse(readFileSync('tests/fixtures/kyc/specimens.json', 'utf8')) as {
  applicants: Record<string, { documents: Record<string, { text: string }> }>;
};

const NEEDS_GSTIN = {
  profile: { cityTier: 1, employeeCount: 12, numSites: 1, gstinStatus: 'ACTIVE', fibreAvailable: true },
  lines: [
    { productId: 'P01', quantity: 1 },
    { productId: 'P15', quantity: 1 },
  ],
};

const payload = (name: string, mimeType: string, buffer: Buffer) => ({ name, mimeType, buffer });

/** A clean photo of a document from its text, for a re-upload the data pack has no specimen of. */
async function renderDocument(text: string): Promise<Buffer> {
  const escape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const rows = text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line, index) => `<text x="60" y="${80 + index * 52}" font-family="Arial" font-size="30" fill="black">${escape(line)}</text>`)
    .join('');
  const svg = `<svg width="1400" height="1000" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="white"/>${rows}</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

const docStatus = async (page: Page) => (await page.getByRole('main').innerText()).slice(0, 1500);

async function pending(page: Page): Promise<void> {
  await expect(page.getByText('Reading your document')).toBeHidden({ timeout: 60_000 });
}

test.describe('files a tile should refuse, in words the owner can act on', () => {
  const GENERIC = /went wrong/i;

  const cases: Array<[string, () => Promise<{ name: string; mimeType: string; buffer: Buffer }>]> = [
    ['an image too small', async () => payload('small.png', 'image/png', await sharp({ create: { width: 200, height: 200, channels: 3, background: 'white' } }).png().toBuffer())],
    ['a text file renamed .png', async () => payload('notes.png', 'image/png', Buffer.from('this is not an image at all, sorry '.repeat(50)))],
    ['a PDF', async () => payload('gst.pdf', 'application/pdf', Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n'))],
    ['a PDF renamed .png', async () => payload('gst.png', 'image/png', Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n'))],
    ['a truncated PNG', async () => {
      const whole = readFileSync(specimenPath('K03', 'gst_certificate'));
      return payload('cut.png', 'image/png', whole.subarray(0, 2000));
    }],
    ['a file over 10 MB', async () => payload('huge.jpg', 'image/jpeg', Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(11 * 1024 * 1024, 1)]))],
    ['an empty file', async () => payload('empty.png', 'image/png', Buffer.alloc(0))],
    ['a WebP photo', async () => payload('photo.webp', 'image/webp', await sharp(readFileSync(specimenPath('K03', 'gst_certificate'))).webp().toBuffer())],
  ];

  for (const [name, make] of cases) {
    test(name, async ({ page }) => {
      await reachVerify(page);
      await page.goto('/verify');
      await contactStep(page, 'K03');
      await page.getByTestId('upload-GST_CERTIFICATE').setInputFiles(await make());
      const notice = page.getByRole('main').locator('[role=status],[role=alert]').first();
      await expect(notice).toBeVisible({ timeout: 60_000 });
      const text = await notice.innerText();
      observe(test.info(), { name, text });
      expect(text).not.toMatch(GENERIC);
      // The same tile still works straight after.
      await page.getByTestId('upload-GST_CERTIFICATE').setInputFiles(specimenPath('K03', 'gst_certificate'));
      await expect(page.getByText('Read', { exact: true }).first()).toBeVisible({ timeout: 60_000 });
      await expect(page.getByRole('main').locator('[role=status],[role=alert]').filter({ hasText: text })).toHaveCount(0);
    });
  }
});

test.describe('replacing a document', () => {
  test('wrong document in a tile, then the right one', async ({ page }) => {
    await reachVerify(page, { body: NEEDS_GSTIN });
    await page.goto('/verify');
    await contactStep(page, 'K03');
    await page.getByTestId('upload-GST_CERTIFICATE').setInputFiles(specimenPath('K03', 'signatory_id'));
    await pending(page);
    await expect(page.getByRole('main')).toContainText(/found|looks like|signatory/i, { timeout: 60_000 });
    observe(test.info(), await docStatus(page));
    await uploadAll(page, 'K03', [['SIGNATORY_ID', 'signatory_id'], ['ADDRESS_PROOF', 'address_proof']]);
    await expect(verdict(page)).toHaveAttribute('data-verdict', 'RETAKE', { timeout: 60_000 });
    await expect(page.getByRole('button', { name: 'Place my order' })).toHaveCount(0);
    await uploadAll(page, 'K03', [['GST_CERTIFICATE', 'gst_certificate']]);
    await expect(verdict(page)).toHaveAttribute('data-verdict', 'VERIFIED', { timeout: 60_000 });
  });

  test('K04: blurred certificate, then a sharp one clears the retake', async ({ page }) => {
    await reachVerify(page, { body: NEEDS_GSTIN });
    await page.goto('/verify');
    await contactStep(page, 'K04');
    await uploadAll(page, 'K04', [['GST_CERTIFICATE', 'gst_certificate'], ['UDYAM_CERTIFICATE', 'udyam_certificate'], ['SIGNATORY_ID', 'signatory_id'], ['ADDRESS_PROOF', 'address_proof']]);
    await expect(verdict(page)).toHaveAttribute('data-verdict', 'RETAKE', { timeout: 60_000 });
    observe(test.info(), await docStatus(page));

    // The address exactly as the bill shows it, joined across the row where it wraps.
    const bill = SPECIMENS.applicants.K04?.documents.addressProof?.text ?? '';
    const [rowOne, rowTwo] = (/Supply address ([\s\S]*?)\n\s*Bill date/.exec(bill)?.[1] ?? '').split(/\s*\n\s*/);
    const sharpCopy = await renderDocument(
      ['Specimen: GST Registration Certificate', 'Format for hackathon OCR testing only', 'GSTIN 27PZSXS1936O1ZH', 'Legal name Saffron Dental Care LLP', 'Trade name Saffron Dental Care LLP', 'Constitution Partnership', `Address of principal ${rowOne}`, `place of business ${rowTwo}`, 'Date of liability 2020-01-01', 'Type of registration Regular'].join('\n'),
    );
    await page.getByTestId('upload-GST_CERTIFICATE').setInputFiles(payload('k04-sharp.png', 'image/png', sharpCopy));
    await pending(page);
    await expect(page.getByTestId('upload-GST_CERTIFICATE')).toBeEnabled({ timeout: 60_000 });
    await page.waitForTimeout(500);
    const appId = (await journey(page.request)).kycApplicationId;
    const state = (await (await page.request.get(`/api/v1/kyc-applications/${appId}`)).json()) as { verdict: string; documents: Array<{ documentType: string; quality: string; detectedType: string | null; ocrConfidence: number | null }>; checks: Array<{ id: string; outcome: string; onFail: string }> };
    observe(test.info(), { verdict: state.verdict, documents: state.documents, failed: state.checks.filter((c) => c.outcome === 'FAIL').map((c) => `${c.id}:${c.onFail}`) });
    await expect(verdict(page)).not.toHaveAttribute('data-verdict', 'RETAKE', { timeout: 10_000 });
    observe(test.info(), { after: await verdict(page).getAttribute('data-verdict'), main: await docStatus(page) });
    await page.reload();
    await expect(verdict(page)).not.toHaveAttribute('data-verdict', 'RETAKE');
  });

  test('K11: old bill, then a recent one lets the order through', async ({ page }) => {
    await reachVerify(page, { body: NEEDS_GSTIN });
    await page.goto('/verify');
    await contactStep(page, 'K11');
    await uploadAll(page, 'K11', [['GST_CERTIFICATE', 'gst_certificate'], ['UDYAM_CERTIFICATE', 'udyam_certificate'], ['SIGNATORY_ID', 'signatory_id'], ['ADDRESS_PROOF', 'address_proof']]);
    await expect(verdict(page)).toHaveAttribute('data-verdict', 'RETAKE', { timeout: 60_000 });
    observe(test.info(), await docStatus(page));
    const bill = SPECIMENS.applicants.K11?.documents.addressProof?.text ?? '';
    observe(test.info(), { billText: bill.slice(0, 500), keys: Object.keys(SPECIMENS.applicants.K11?.documents ?? {}) });
    const fresh = bill.replace(/\d{4}-\d{2}-\d{2}/g, '2026-07-01');
    await page.getByTestId('upload-ADDRESS_PROOF').setInputFiles(payload('k11-fresh.png', 'image/png', await renderDocument(fresh)));
    await pending(page);
    await expect(page.getByTestId('upload-ADDRESS_PROOF')).toBeEnabled({ timeout: 60_000 });
    await page.waitForTimeout(500);
    const billApp = (await journey(page.request)).kycApplicationId;
    const billState = (await (await page.request.get(`/api/v1/kyc-applications/${billApp}`)).json()) as { verdict: string; documents: Array<{ documentType: string; quality: string }>; checks: Array<{ id: string; outcome: string; onFail: string; evidence: unknown }> };
    observe(test.info(), { verdict: billState.verdict, documents: billState.documents.map((d) => `${d.documentType}:${d.quality}`), failed: billState.checks.filter((c) => c.outcome === 'FAIL').map((c) => [c.id, c.onFail, c.evidence]) });
    await expect(verdict(page)).toHaveAttribute('data-verdict', /VERIFIED|MANUAL_REVIEW/, { timeout: 10_000 });
    await expect(page.getByRole('button', { name: 'Place my order' })).toBeVisible();
  });
});

test.describe('uploading at the same time', () => {
  test('three tiles together end verified, and the screen agrees with a reload', async ({ page }) => {
    await reachVerify(page, { body: NEEDS_GSTIN });
    await page.goto('/verify');
    await contactStep(page, 'K03');
    await Promise.all(K03_DOCS.map(([type, file]) => page.getByTestId(`upload-${type}`).setInputFiles(specimenPath('K03', file))));
    for (const [type] of K03_DOCS) await expect(page.getByTestId(`upload-${type}`)).toBeEnabled({ timeout: 90_000 });
    await page.waitForTimeout(500);
    const onScreen = await verdict(page).getAttribute('data-verdict').catch(() => null);
    const reads = await page.getByText('Read', { exact: true }).count();
    const id = (await journey(page.request)).kycApplicationId;
    const server = (await (await page.request.get(`/api/v1/kyc-applications/${id}`)).json()) as { verdict: string | null; documents: Array<{ documentType: string; quality: string }>; nextActions: string[] };
    observe(test.info(), { onScreen, reads, serverVerdict: server.verdict, documents: server.documents.map((d) => [d.documentType, d.quality]), nextActions: server.nextActions });
    expect(server.documents.length, 'nothing lost on the server').toBe(3);
    expect(server.verdict, 'server verdict').toBe('VERIFIED');
    expect(reads, 'every tile shows its result without a reload').toBe(3);
    expect(onScreen, 'the screen shows the verdict without a reload').toBe('VERIFIED');
  });

  test('replacing a tile while another is still reading keeps both', async ({ page }) => {
    await reachVerify(page, { body: NEEDS_GSTIN });
    await page.goto('/verify');
    await contactStep(page, 'K03');
    await uploadAll(page, 'K03', [['GST_CERTIFICATE', 'gst_certificate']]);
    await page.getByTestId('upload-SIGNATORY_ID').setInputFiles(specimenPath('K03', 'signatory_id'));
    await page.getByTestId('upload-ADDRESS_PROOF').setInputFiles(specimenPath('K03', 'address_proof'));
    await page.getByTestId('upload-GST_CERTIFICATE').setInputFiles(specimenPath('K03', 'gst_certificate'));
    for (const [type] of K03_DOCS) await expect(page.getByTestId(`upload-${type}`)).toBeEnabled({ timeout: 90_000 });
    await expect(page.getByText('Read', { exact: true })).toHaveCount(3, { timeout: 10_000 });
    await expect(verdict(page)).toHaveAttribute('data-verdict', 'VERIFIED', { timeout: 10_000 });
  });
});

test.describe('the contact step', () => {
  const tries: Array<[string, string, string]> = [
    ['a GSTIN typed in lower case', 'Joseph Singh', '27xuixg0767d1zp'],
    ['a GSTIN that is too short', 'Joseph Singh', '27XUIX'],
    ['a very long name', 'J'.repeat(300), ''],
  ];
  for (const [name, contact, gstin] of tries) {
    test(name, async ({ page }) => {
      await reachVerify(page);
      await page.goto('/verify');
      await page.getByLabel(/Your full name/).fill(contact);
      if (gstin) await page.getByRole('textbox', { name: /GST/ }).fill(gstin);
      await page.getByRole('checkbox', { name: /18 or over/ }).check();
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
      await page.waitForTimeout(1500);
      const uploadsShown = await page.getByTestId('upload-GST_CERTIFICATE').count();
      const message = await page.getByRole('main').locator('[role=status],[role=alert]').allInnerTexts();
      observe(test.info(), { name, uploadsShown, message });
      if (uploadsShown === 0) expect(message.join(' '), 'a typing slip gets a useful message').not.toMatch(/went wrong/i);
    });
  }
});

test('K07: held for review, cleared by admin, then paid and on to active', async ({ page }) => {
  await reachVerify(page, { body: NEEDS_GSTIN });
  await page.goto('/verify');
  await contactStep(page, 'K07');
  await uploadAll(page, 'K07', [['GST_CERTIFICATE', 'gst_certificate'], ['UDYAM_CERTIFICATE', 'udyam_certificate'], ['SIGNATORY_ID', 'signatory_id'], ['ADDRESS_PROOF', 'address_proof']]);
  await expect(verdict(page)).toHaveAttribute('data-verdict', 'MANUAL_REVIEW', { timeout: 60_000 });
  await page.getByRole('button', { name: 'Place my order' }).click();
  await expect(page.getByTestId('tracker-next')).toBeVisible();
  const orderId = new URL(page.url()).pathname.split('/').pop() as string;
  await expect(page.getByRole('button', { name: 'Test a successful payment' })).toHaveCount(0);
  observe(test.info(), (await page.getByRole('main').innerText()).slice(0, 700));

  // Paying while held is refused by the API too.
  const early = await page.request.post(`/api/v1/orders/${orderId}/payment-attempts`, { data: { simulate: 'SUCCESS' } });
  expect(early.status()).toBe(409);

  expect(await adminAdvance(page.request, orderId)).toBe(200);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Test a successful payment' })).toBeVisible();
  await page.getByRole('button', { name: 'Test a failed payment' }).click();
  await expect(page.getByRole('main')).toContainText(/payment.*(failed|didn)/i);
  await page.getByRole('button', { name: 'Test a successful payment' }).click();
  await expect(page.getByRole('button', { name: 'Test a successful payment' })).toBeHidden();
  for (let step = 0; step < 3; step += 1) expect(await adminAdvance(page.request, orderId)).toBe(200);
  await page.reload();
  await expect(page.getByTestId('tracker-next')).toHaveCount(0);
  await expect(page.getByRole('main')).toContainText(/active|live/i);
  expect(await adminAdvance(page.request, orderId)).toBe(409);
});

test('K01: the changed quote speaks to the owner in words, not codes', async ({ page }) => {
  await reachVerify(page, {
    body: {
      profile: { cityTier: 1, employeeCount: 12, numSites: 1, gstinStatus: 'ACTIVE', fibreAvailable: true },
      lines: [
        { productId: 'P01', quantity: 1 },
        { productId: 'P15', quantity: 1 },
      ],
    },
  });
  await page.goto('/verify');
  await contactStep(page, 'K01');
  await uploadAll(page, 'K01', [['GST_CERTIFICATE', 'gst_certificate'], ['UDYAM_CERTIFICATE', 'udyam_certificate'], ['SIGNATORY_ID', 'signatory_id'], ['ADDRESS_PROOF', 'address_proof']]);
  await expect(verdict(page)).toHaveAttribute('data-verdict', 'REJECTED', { timeout: 60_000 });
  const main = await page.getByRole('main').innerText();
  observe(test.info(), main.slice(0, 1800));
  expect(main).not.toMatch(/\bCANCELLED\b|\bSUSPENDED\b|\bNEEDS_ACCEPTANCE\b/);
});

test.describe('K01 to K12 on a bundle that needs no GSTIN, the default for a small shop', () => {
  const EXPECTED: Record<string, string> = {
    K02: 'VERIFIED', K03: 'VERIFIED', K04: 'RETAKE', K05: 'VERIFIED', K06: 'NEEDS_CONFIRMATION', K07: 'MANUAL_REVIEW',
    K08: 'VERIFIED', K09: 'VERIFIED', K10: 'NEEDS_CONFIRMATION', K11: 'RETAKE', K12: 'VERIFIED',
  };
  const DOCS = [['GST_CERTIFICATE', 'gst_certificate'], ['UDYAM_CERTIFICATE', 'udyam_certificate'], ['SIGNATORY_ID', 'signatory_id'], ['ADDRESS_PROOF', 'address_proof']] as const;
  for (const [key, expected] of Object.entries(EXPECTED)) {
    test(`${key} still ends at ${expected}`, async ({ page }) => {
      await reachVerify(page);
      await page.goto('/verify');
      await contactStep(page, key);
      await uploadAll(page, key, DOCS.filter(([, file]) => existsSync(specimenPath(key, file))));
      await page.waitForTimeout(400);
      const got = await verdict(page).getAttribute('data-verdict').catch(() => null);
      const place = await page.getByRole('button', { name: 'Place my order' }).count();
      const id = (await journey(page.request)).kycApplicationId;
      const app = (await (await page.request.get(`/api/v1/kyc-applications/${id}`)).json()) as { requiredDocuments: string[]; documents: Array<{ documentType: string; quality: string }>; checks: Array<{ id: string; outcome: string; onFail: string }> };
      observe(test.info(), { key, got, place, required: app.requiredDocuments, docs: app.documents.map((d) => `${d.documentType}:${d.quality}`), failed: app.checks.filter((c) => c.outcome === 'FAIL').map((c) => `${c.id}:${c.onFail}`) });
      expect(got).toBe(expected);
    });
  }
});
