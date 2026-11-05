import { existsSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { checkScreen, contactNameOf, nextPhone, specimenPath } from './helpers';

const ADMIN_TOKEN = 'e2e-admin-token-not-a-secret';
const DOCUMENTS = [
  ['GST_CERTIFICATE', 'gst_certificate'],
  ['UDYAM_CERTIFICATE', 'udyam_certificate'],
  ['SIGNATORY_ID', 'signatory_id'],
  ['ADDRESS_PROOF', 'address_proof'],
] as const;

/** Everything before verification, by API, so these tests spend their time on the KYC screens. */
async function reachVerification(page: Page): Promise<void> {
  await page.goto('/');
  const api = page.request;
  await api.post('/api/v1/sessions');
  const consents = (await (await api.get('/api/v1/consents')).json()) as { items: Array<{ purpose: string; currentNoticeVersion: string }> };
  const grant = (purpose: string) =>
    api.post('/api/v1/consents', {
      data: { purpose, noticeVersion: consents.items.find((item) => item.purpose === purpose)?.currentNoticeVersion, language: 'en' },
    });
  await grant('advisor_profile');

  // Needs a GSTIN, because that is what makes a Cancelled registration matter.
  const quote = (await (
    await api.post('/api/v1/quotes', {
      data: {
        profile: { cityTier: 1, employeeCount: 12, numSites: 1, gstinStatus: 'ACTIVE', fibreAvailable: true },
        lines: [
          { productId: 'P01', quantity: 1 },
          { productId: 'P15', quantity: 1 },
        ],
      },
    })
  ).json()) as { id: string };

  const challenge = (await (await api.post('/api/v1/sessions/otp-requests', { data: { phone: nextPhone() } })).json()) as { challengeId: string; testCode: string };
  await api.post('/api/v1/sessions/otp-verifications', { data: { challengeId: challenge.challengeId, code: challenge.testCode } });
  await api.post(`/api/v1/quotes/${quote.id}/acceptance`);
  await grant('kyc_verification');
}

async function applyAs(page: Page, key: string): Promise<void> {
  await reachVerification(page);
  await page.goto('/verify');
  await page.getByLabel(/Your full name/).fill(contactNameOf(key));
  await page.getByRole('checkbox', { name: /18 or over/ }).check();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();

  for (const [type, file] of DOCUMENTS) {
    const source = specimenPath(key, file);
    if (!existsSync(source)) continue;
    await page.getByTestId(`upload-${type}`).setInputFiles(source);
    await expect(page.getByText('Reading your document')).toBeHidden({ timeout: 60_000 });
  }
}

const verdict = (page: Page) => page.getByTestId('kyc-verdict');
const expectVerdict = (page: Page, expected: string) => expect(verdict(page)).toHaveAttribute('data-verdict', expected, { timeout: 60_000 });

test.describe('K01 to K12 through the real screens and real OCR', () => {
  for (const [key, expected] of [
    ['K02', 'VERIFIED'],
    ['K03', 'VERIFIED'],
    ['K04', 'RETAKE'],
    ['K05', 'VERIFIED'],
    ['K07', 'MANUAL_REVIEW'],
    ['K08', 'VERIFIED'],
    ['K09', 'VERIFIED'],
    ['K11', 'RETAKE'],
    ['K12', 'VERIFIED'],
  ] as const) {
    test(`${key} ends at ${expected}`, async ({ page }) => {
      await applyAs(page, key);
      await expectVerdict(page, expected);
      await checkScreen(page);
    });
  }

  test('K01: a Cancelled GSTIN changes the quote, and the owner can go on with the new one', async ({ page }) => {
    await applyAs(page, 'K01');
    await expectVerdict(page, 'REJECTED');
    await expect(page.getByText(/Your GST registration shows as Cancelled/).first()).toBeVisible();
    await expect(page.getByText(/WhatsApp Business API Starter/)).toBeVisible();
    await checkScreen(page);

    await page.getByRole('button', { name: 'Accept the changed quote' }).click();
    await expect(verdict(page)).not.toHaveAttribute('data-verdict', 'REJECTED');
  });

  test('K06: an altered digit asks the owner to check, then fails on what they confirm', async ({ page }) => {
    await applyAs(page, 'K06');
    await expectVerdict(page, 'NEEDS_CONFIRMATION');
    await page.getByLabel('GST number on your certificate').fill('08YKZXS8189L1ZO');
    await page.getByRole('button', { name: 'Confirm number' }).click();
    await expectVerdict(page, 'REJECTED');
  });

  test('K10: a misread number is corrected by the owner, and the signatory mismatch then shows', async ({ page }) => {
    await applyAs(page, 'K10');
    await expectVerdict(page, 'NEEDS_CONFIRMATION');
    await page.getByRole('button', { name: 'Use this number' }).click();
    await page.getByRole('button', { name: 'Confirm number' }).click();
    await expectVerdict(page, 'MANUAL_REVIEW');
    await expect(page.getByText(/which is different from the name you gave/)).toBeVisible();
    await checkScreen(page);
  });
});

test('a registry outage loses nothing: the owner waits, and it finishes when the registry is back', async ({ page }) => {
  const setOutage = (enabled: boolean) =>
    page.request.put('/api/v1/admin/simulations/registry-outage', { data: { enabled }, headers: { 'x-admin-token': ADMIN_TOKEN } });

  await page.goto('/');
  await setOutage(true);
  try {
    await applyAs(page, 'K03');
    await expectVerdict(page, 'VERIFICATION_PENDING');
    await expect(page.getByRole('button', { name: 'Check again' })).toBeVisible();
    await checkScreen(page);
  } finally {
    await setOutage(false);
  }
  await page.getByRole('button', { name: 'Check again' }).click();
  await expectVerdict(page, 'VERIFIED');
});

test('a failed payment can be retried, a delay explains itself, and the tracker reaches active', async ({ page }) => {
  await applyAs(page, 'K03');
  await expectVerdict(page, 'VERIFIED');
  await page.getByRole('button', { name: 'Place my order' }).click();
  await expect(page.getByTestId('tracker-next')).toHaveText('You pay the first bill');

  await page.getByRole('button', { name: 'Test a failed payment' }).click();
  await expect(page.getByText(/The payment failed. Nothing was charged/)).toBeVisible();
  await expect(page.getByTestId('tracker-next')).toContainText("didn't go through");

  await page.getByRole('button', { name: 'Test a successful payment' }).click();
  await expect(page.getByText(/^Paid:/)).toBeVisible();

  const orderId = page.url().split('/').pop() ?? '';
  const admin = { headers: { 'x-admin-token': ADMIN_TOKEN } };
  await page.request.post(`/api/v1/admin/orders/${orderId}/delays`, { ...admin, data: { reason: 'FIBRE_NOT_FEASIBLE', newDate: '2026-08-10' } });
  await page.reload();
  await expect(page.getByText('Your order is delayed')).toBeVisible();
  await expect(page.getByText(/needs no fibre/)).toBeVisible();
  await checkScreen(page);

  for (let step = 0; step < 3; step += 1) await page.request.post(`/api/v1/admin/orders/${orderId}/stage-advances`, admin);
  await page.reload();
  await expect(page.getByText('Everything is active. Welcome to Accel Business.')).toBeVisible();
});

test("another owner's order is not found", async ({ page, browser }) => {
  await applyAs(page, 'K03');
  await expectVerdict(page, 'VERIFIED');
  await page.getByRole('button', { name: 'Place my order' }).click();
  await expect(page.getByTestId('tracker-next')).toBeVisible();
  const url = page.url();

  const stranger = await browser.newContext();
  const strangerPage = await stranger.newPage();
  await strangerPage.goto(url);
  await expect(strangerPage.getByTestId('tracker-next')).toHaveCount(0);
  await expect(strangerPage.getByRole('alert').or(strangerPage.getByRole('status')).first()).toBeVisible();
  await stranger.close();
});
