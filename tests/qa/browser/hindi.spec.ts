import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { ADMIN_TOKEN, contactNameOf, nextPhone, observe, reachVerify, specimenPath } from './qa-helpers';

const CATALOGUE_WORDS = readFileSync('tests/fixtures/product_catalogue.csv', 'utf8')
  .split('\n')
  .slice(1)
  .flatMap((line) => (line.split(',')[2] ?? '').split(/[^A-Za-z0-9-]+/));

// Names and acronyms an owner reads in Latin letters in Hindi too. Everything else is a finding.
const ALLOWED = new Set(
  [...CATALOGUE_WORDS, 'Accel', 'Business', 'English', 'GST', 'GSTIN', 'KYC', 'OTP', 'UPI', 'PAN', 'Wi-Fi', 'WhatsApp', 'Udyam', 'AI', 'Google', 'Gemini', 'SMS', 'SD-WAN', 'IP', 'CCTV', 'POS', 'SIM', 'ID', 'PDF', 'JPEG', 'PNG', 'Mbps', 'Gbps', 'IVR', 'DPDP', 'GB', 'TB', 'HD', 'IoT', 'GPS', 'SSL', 'UDYAM', 'MB', 'pm', 'am', 'SLA', 'DLT', 'PC', 'SOC', 'Pune', 'Nisha', 'Arora', 'grievance', 'accel-business', 'example', 'Ahmedabad', 'Bengaluru', 'Chennai', 'Delhi', 'Hyderabad', 'Kolkata', 'Mumbai', 'Bhopal', 'Coimbatore', 'Indore', 'Jaipur', 'Kochi', 'Lucknow', 'Ludhiana', 'Mysuru', 'Nagpur', 'Nashik', 'Patna', 'Surat', 'Vadodara', 'Visakhapatnam']
    .map((word) => word.toLowerCase()),
);

type Finding = { screen: string; latin: string[]; overflow: string[] };
const findings: Finding[] = [];

/** Text in Latin letters, and anything that sticks out past the right edge, on the screen as it stands. */
async function scan(page: Page, screen: string, allow: readonly string[] = []): Promise<void> {
  await page.waitForTimeout(250);
  const seen = await page.evaluate(() => {
    const visible = (element: Element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 1 && rect.height > 1;
    };
    const texts: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (!parent || ['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(parent.tagName)) continue;
      if (parent.closest('[lang="en"]')) continue;
      const value = node.textContent?.trim();
      if (value) texts.push(value);
    }
    for (const element of document.querySelectorAll('[aria-label],[placeholder],[title]')) {
      for (const attribute of ['aria-label', 'placeholder', 'title']) {
        const value = element.getAttribute(attribute);
        if (value) texts.push(value);
      }
    }
    const overflow: string[] = [];
    const width = document.documentElement.clientWidth;
    for (const element of document.querySelectorAll('body *')) {
      if (!visible(element)) continue;
      const rect = element.getBoundingClientRect();
      if (rect.right > width + 1 || rect.left < -1) overflow.push(`${element.tagName} right=${Math.round(rect.right)} "${(element.textContent ?? '').trim().slice(0, 50)}"`);
      if (element instanceof HTMLElement && element.scrollWidth > element.clientWidth + 1 && getComputedStyle(element).overflowX !== 'visible') overflow.push(`clipped ${element.tagName} "${(element.textContent ?? '').trim().slice(0, 50)}"`);
    }
    return { texts, overflow, pageOverflow: document.documentElement.scrollWidth - width };
  });
  const allowed = new Set([...ALLOWED, ...allow.map((word) => word.toLowerCase())]);
  const latin = new Set<string>();
  for (const text of seen.texts) {
    // Masked and full identifiers are the owner's own values, not wording.
    if (text.includes('•') || /^\d{2}[A-Z]{5}/.test(text)) continue;
    for (const word of text.match(/[A-Za-z][A-Za-z-]+/g) ?? []) {
      if (!allowed.has(word.toLowerCase())) latin.add(`${word} «${text.slice(0, 70)}»`);
    }
  }
  const overflow = seen.pageOverflow > 0 ? [`page scrolls sideways by ${seen.pageOverflow}`, ...seen.overflow] : seen.overflow;
  findings.push({ screen, latin: [...latin], overflow });
  console.log(`SCAN ${screen}: latin=${JSON.stringify([...latin])} overflow=${JSON.stringify(overflow)}`);
  if (process.env.QA_SHOTS) await page.screenshot({ path: `${process.env.QA_SHOTS}/${screen.replaceAll(/\W+/g, '-')}.png`, fullPage: true });
}

test.use({ viewport: { width: 320, height: 640 } });

const openAll = async (page: Page) => {
  while ((await page.locator('details:not([open]) summary').count()) > 0) await page.locator('details:not([open]) summary').first().click();
};

const WITH_WHATSAPP = {
  profile: { cityTier: 1, employeeCount: 12, numSites: 1, gstinStatus: 'ACTIVE', fibreAvailable: true },
  lines: [
    { productId: 'P01', quantity: 1 },
    { productId: 'P15', quantity: 1 },
  ],
};

const hindi = async (page: Page) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'हिन्दी' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'hi');
};

async function hindiContact(page: Page, key: string): Promise<void> {
  await page.getByLabel(/आपका पूरा नाम/).fill(contactNameOf(key));
  await page.getByRole('checkbox', { name: /18 वर्ष/ }).check();
  await page.getByRole('button', { name: 'आगे बढ़ें', exact: true }).click();
  await expect(page.getByTestId('upload-GST_CERTIFICATE')).toBeAttached();
}

async function hindiUpload(page: Page, key: string, docs: ReadonlyArray<readonly [string, 'gst_certificate' | 'signatory_id' | 'address_proof' | 'udyam_certificate']>): Promise<void> {
  for (const [type, file] of docs) {
    await page.getByTestId(`upload-${type}`).setInputFiles(specimenPath(key, file));
    await expect(page.getByTestId(`upload-${type}`)).toBeDisabled().catch(() => undefined);
    await expect(page.getByTestId(`upload-${type}`)).toBeEnabled({ timeout: 60_000 });
  }
}

const ALL_DOCS = [['GST_CERTIFICATE', 'gst_certificate'], ['UDYAM_CERTIFICATE', 'udyam_certificate'], ['SIGNATORY_ID', 'signatory_id'], ['ADDRESS_PROOF', 'address_proof']] as const;

test('every screen of the journey in Hindi at 320 px', async ({ page }) => {
  await hindi(page);
  await scan(page, 'home');
  await page.getByRole('checkbox', { name: 'मैं अपने व्यवसाय की जानकारी के इस उपयोग के लिए सहमत हूँ' }).check();
  await page.getByRole('checkbox', { name: /Google Gemini चैट में मेरा लिखा पढ़े/ }).check();
  await page.getByRole('button', { name: 'सलाहकार से शुरू करें' }).click();

  await expect(page.getByRole('button', { name: 'दुकान या छोटी सेवा', exact: true })).toBeVisible();
  await scan(page, 'advisor business');
  await page.getByRole('button', { name: 'दुकान या छोटी सेवा', exact: true }).click();
  await expect(page.getByRole('button', { name: 'दुकान या छोटी सेवा', exact: true })).toBeHidden();
  await scan(page, 'advisor city');
  await page.getByRole('textbox').fill('कोई शहर');
  await page.getByRole('textbox').press('Enter');
  await page.waitForTimeout(600);
  await scan(page, 'advisor city not read');
  await page.getByRole('textbox').fill('Pune');
  await page.getByRole('textbox').press('Enter');
  await page.getByRole('button', { name: '10 से 24', exact: true }).waitFor();
  await scan(page, 'advisor people');
  await page.getByRole('button', { name: '10 से 24', exact: true }).click();
  await page.getByRole('button', { name: '1', exact: true }).waitFor();
  await scan(page, 'advisor sites');
  await page.getByRole('button', { name: '1', exact: true }).click();
  await page.getByRole('button', { name: 'हाँ, सक्रिय है', exact: true }).waitFor();
  await scan(page, 'advisor gst');
  await page.getByRole('button', { name: 'हाँ, सक्रिय है', exact: true }).click();
  await page.getByRole('button', { name: 'हाँ', exact: true }).waitFor();
  await scan(page, 'advisor fibre');
  await page.getByRole('button', { name: 'हाँ', exact: true }).click();
  await page.getByRole('button', { name: 'इनमें से कुछ नहीं', exact: true }).waitFor();
  await scan(page, 'advisor needs');
  const bar = await page.evaluate(() => {
    const element = document.querySelector('.sticky');
    return element ? { barHeight: Math.round(element.getBoundingClientRect().height), viewport: innerHeight } : null;
  });
  observe(test.info(), { stickyBarAtNeeds: bar });
  if (process.env.QA_SHOTS) await page.screenshot({ path: `${process.env.QA_SHOTS}/needs-viewport.png` });
  await page.getByRole('button', { name: 'इनमें से कुछ नहीं', exact: true }).click();
  await expect(page.getByTestId('bundle-card')).toBeVisible();
  await scan(page, 'advisor bundle');

  await page.getByRole('button', { name: 'मेरा कोटेशन देखें' }).click();
  await expect(page.getByTestId('monthly-total')).toBeVisible();
  await openAll(page);
  await scan(page, 'quote');
  await page.getByRole('switch', { name: 'Managed Firewall' }).click();
  await expect(page.getByRole('switch', { name: 'Managed Firewall' })).toHaveAttribute('aria-checked', 'true');
  await scan(page, 'quote after firewall');
  await page.getByRole('switch', { name: 'Biz Fibre 100' }).click();
  await expect(page.getByTestId('monthly-total')).toHaveText('₹0');
  await scan(page, 'quote empty, stranded');
  await openAll(page);
  await page.getByRole('switch', { name: 'Biz Fibre 100' }).click();
  await expect(page.getByRole('switch', { name: 'Biz Fibre 100' })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('button', { name: 'स्वीकार करें और व्यवसाय वेरिफ़ाई करें' }).click();
  await page.getByLabel('मोबाइल नंबर').waitFor();
  await scan(page, 'phone');
  await page.getByRole('button', { name: 'कोड भेजें' }).click();
  await page.locator('p[role=alert]').first().waitFor();
  await scan(page, 'phone invalid');
  await page.getByLabel('मोबाइल नंबर').fill(nextPhone());
  await page.getByRole('button', { name: 'कोड भेजें' }).click();
  await page.getByLabel('6 अंकों का कोड').waitFor();
  await scan(page, 'otp');
  await page.getByLabel('6 अंकों का कोड').fill('123456');
  await page.getByRole('button', { name: 'वेरिफ़ाई करें', exact: true }).click();
  await page.locator('p[role=alert]').first().waitFor();
  await scan(page, 'otp wrong');
  await page.getByLabel('6 अंकों का कोड').fill('000000');
  await page.getByRole('button', { name: 'वेरिफ़ाई करें', exact: true }).click();

  const kyc = page.getByRole('checkbox', { name: 'मैं वेरिफ़िकेशन के लिए अपने दस्तावेज़ों के इस उपयोग के लिए सहमत हूँ' });
  await kyc.waitFor();
  await scan(page, 'consent');
  await page.getByRole('button', { name: 'सहमत हूँ, आगे बढ़ें' }).click();
  await page.locator('[role=status],[role=alert]').first().waitFor();
  await scan(page, 'consent required');
  await kyc.check();
  await page.getByRole('checkbox').nth(1).check();
  await page.getByRole('button', { name: 'सहमत हूँ, आगे बढ़ें' }).click();

  await page.getByLabel(/आपका पूरा नाम/).waitFor();
  await scan(page, 'contact');
  await page.getByRole('button', { name: 'आगे बढ़ें', exact: true }).click();
  await page.locator('p[role=alert]').first().waitFor();
  await scan(page, 'contact errors');
  await hindiContact(page, 'K03');
  await scan(page, 'documents empty');

  await page.getByTestId('upload-GST_CERTIFICATE').setInputFiles({ name: 'x.png', mimeType: 'image/png', buffer: Buffer.from('not an image '.repeat(40)) });
  await page.locator('[role=status],[role=alert]').first().waitFor();
  await scan(page, 'upload refused', ['Joseph', 'Singh']);
  await hindiUpload(page, 'K03', [['GST_CERTIFICATE', 'signatory_id']]);
  await page.waitForTimeout(300);
  await scan(page, 'wrong document', ['Joseph', 'Singh']);
  await hindiUpload(page, 'K03', [['GST_CERTIFICATE', 'gst_certificate'], ['SIGNATORY_ID', 'signatory_id'], ['ADDRESS_PROOF', 'address_proof']]);
  await expect(page.getByTestId('kyc-verdict')).toHaveAttribute('data-verdict', 'VERIFIED', { timeout: 60_000 });
  await openAll(page);
  await scan(page, 'verdict verified', ['Joseph', 'Singh']);

  await page.getByRole('button', { name: 'मेरा ऑर्डर दें' }).click();
  await page.getByTestId('tracker-next').waitFor();
  await scan(page, 'tracker');
  const orderId = new URL(page.url()).pathname.split('/').pop() as string;
  await page.getByRole('button', { name: 'असफल भुगतान आज़माएं' }).click();
  await page.waitForTimeout(800);
  await scan(page, 'tracker payment failed');
  await page.getByRole('button', { name: 'सफल भुगतान आज़माएं', exact: true }).click();
  await expect(page.getByRole('button', { name: 'सफल भुगतान आज़माएं', exact: true })).toBeHidden();
  await page.request.post(`/api/v1/admin/orders/${orderId}/delays`, { headers: { 'x-admin-token': ADMIN_TOKEN }, data: { reason: 'FIBRE_NOT_FEASIBLE', newDate: '2026-08-10' } });
  await page.reload();
  await page.getByTestId('tracker-next').waitFor();
  await scan(page, 'tracker delayed');
  for (let step = 0; step < 3; step += 1) await page.request.post(`/api/v1/admin/orders/${orderId}/stage-advances`, { headers: { 'x-admin-token': ADMIN_TOKEN } });
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.waitForTimeout(500);
  await scan(page, 'tracker active');

  await page.goto('/my-data');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.waitForTimeout(800);
  await scan(page, 'my data', ['Joseph', 'Singh', 'XUIXG', 'ZP']);
  await page.getByRole('button', { name: /वापस|withdraw/i }).first().click();
  await scan(page, 'my data confirm', ['Joseph', 'Singh']);

  await page.goto('/advisor/form');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await scan(page, 'short form');

  await page.goto('/orders/ord_doesnotexist');
  await page.waitForTimeout(800);
  await scan(page, 'order not found');

  const latin = findings.filter((finding) => finding.latin.length > 0).map((finding) => `${finding.screen}: ${finding.latin.join(' | ')}`);
  const overflow = findings.filter((finding) => finding.overflow.length > 0).map((finding) => `${finding.screen}: ${finding.overflow.join(' | ')}`);
  observe(test.info(), { latinScreens: latin.length, overflowScreens: overflow.length });
  expect(overflow, 'nothing sticks out at 320 px').toEqual([]);
  expect(latin, 'no English left on a Hindi screen').toEqual([]);
});

test('harder KYC screens in Hindi at 320 px: changed quote, confirm, retake, review, cancelled', async ({ page }) => {
  const local: Finding[] = [];
  const check = async (name: string, allow: readonly string[] = []) => {
    const before = findings.length;
    await scan(page, name, allow);
    local.push(...findings.slice(before));
  };
  await hindi(page);
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
  await hindiContact(page, 'K01');
  await hindiUpload(page, 'K01', ALL_DOCS);
  await expect(page.getByTestId('kyc-verdict')).toHaveAttribute('data-verdict', 'REJECTED', { timeout: 60_000 });
  await check('K01 changed quote', ['Neha', 'Kaur']);
  await page.goto('/quote');
  await expect(page.getByTestId('monthly-total')).toBeVisible();
  await check('K01 quote needs acceptance');

  const overflow = local.filter((finding) => finding.overflow.length > 0).map((finding) => `${finding.screen}: ${finding.overflow.join(' | ')}`);
  const latin = local.filter((finding) => finding.latin.length > 0).map((finding) => `${finding.screen}: ${finding.latin.join(' | ')}`);
  expect(overflow).toEqual([]);
  expect(latin).toEqual([]);
});

for (const [key, expected] of [['K11', 'RETAKE'], ['K07', 'MANUAL_REVIEW'], ['K10', 'NEEDS_CONFIRMATION'], ['K04', 'RETAKE']] as const) {
  test(`${key} ${expected} in Hindi at 320 px`, async ({ page }) => {
    const local: Finding[] = [];
    await hindi(page);
    await reachVerify(page, { body: WITH_WHATSAPP });
    await page.goto('/verify');
    await hindiContact(page, key);
    await hindiUpload(page, key, ALL_DOCS);
    await expect(page.getByTestId('kyc-verdict')).toHaveAttribute('data-verdict', expected, { timeout: 60_000 });
    const name = contactNameOf(key).split(' ');
    const before = findings.length;
    await scan(page, `${key} verdict`, name);
    local.push(...findings.slice(before));
    if (expected === 'MANUAL_REVIEW') {
      await page.getByRole('button', { name: 'मेरा ऑर्डर दें' }).click();
      await page.getByTestId('tracker-next').waitFor();
      const mark = findings.length;
      await scan(page, `${key} tracker under review`);
      local.push(...findings.slice(mark));
    }
    expect(local.filter((finding) => finding.overflow.length > 0).map((finding) => `${finding.screen}: ${finding.overflow.join(' | ')}`)).toEqual([]);
    expect(local.filter((finding) => finding.latin.length > 0).map((finding) => `${finding.screen}: ${finding.latin.join(' | ')}`)).toEqual([]);
  });
}
