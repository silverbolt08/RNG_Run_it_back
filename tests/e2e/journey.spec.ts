import { expect, test, type Page } from '@playwright/test';
import { checkScreen, contactNameOf, nextPhone, specimenPath } from './helpers';

type Words = {
  agree: string | RegExp;
  agreeAi: string | RegExp;
  start: string | RegExp;
  shop: string;
  size: string;
  sites: string;
  gstActive: string;
  fibreYes: string;
  none: string;
  seeQuote: string | RegExp;
  accept: string | RegExp;
  phone: string | RegExp;
  sendCode: string | RegExp;
  code: string | RegExp;
  verify: string | RegExp;
  consentAdult: string | RegExp;
  consentKyc: string | RegExp;
  consentGo: string | RegExp;
  name: string | RegExp;
  next: string | RegExp;
  placeOrder: string | RegExp;
  payWorks: string | RegExp;
  nextHeading: string | RegExp;
};

const ENGLISH: Words = {
  agree: 'I agree to this use of my business details',
  agreeAi: /Google Gemini reading what I type/,
  start: 'Start with the advisor',
  shop: 'Shop or small service',
  size: '5 to 9',
  sites: '1',
  gstActive: 'Yes, active',
  fibreYes: 'Yes',
  none: 'None of these',
  seeQuote: 'See my quote',
  accept: 'Accept and verify my business',
  phone: 'Mobile number',
  sendCode: 'Send code',
  code: '6-digit code',
  verify: 'Verify',
  consentAdult: /18 or over/,
  consentKyc: 'I agree to this use of my documents for verification',
  consentGo: 'Agree and continue',
  name: /Your full name/,
  next: 'Continue',
  placeOrder: 'Place my order',
  payWorks: 'Test a successful payment',
  nextHeading: 'What happens next',
};

const HINDI: Words = {
  agree: 'मैं अपने व्यवसाय की जानकारी के इस उपयोग के लिए सहमत हूँ',
  agreeAi: /Google Gemini चैट में मेरा लिखा पढ़े/,
  start: 'सलाहकार से शुरू करें',
  shop: 'दुकान या छोटी सेवा',
  size: '5 से 9',
  sites: '1',
  gstActive: 'हाँ, सक्रिय है',
  fibreYes: 'हाँ',
  none: 'इनमें से कुछ नहीं',
  seeQuote: 'मेरा कोटेशन देखें',
  accept: 'स्वीकार करें और व्यवसाय वेरिफ़ाई करें',
  phone: 'मोबाइल नंबर',
  sendCode: 'कोड भेजें',
  code: '6 अंकों का कोड',
  verify: 'वेरिफ़ाई करें',
  consentAdult: /18 वर्ष/,
  consentKyc: 'मैं वेरिफ़िकेशन के लिए अपने दस्तावेज़ों के इस उपयोग के लिए सहमत हूँ',
  consentGo: 'सहमत हूँ, आगे बढ़ें',
  name: /आपका पूरा नाम/,
  next: 'आगे बढ़ें',
  placeOrder: 'मेरा ऑर्डर दें',
  payWorks: 'सफल भुगतान आज़माएं',
  nextHeading: 'आगे क्या होगा',
};

async function chat(page: Page, words: Words): Promise<void> {
  await page.getByRole('button', { name: words.shop, exact: true }).click();
  // Typing is ignored while a reply is on its way, so wait for the next question first.
  await expect(page.getByRole('button', { name: words.shop, exact: true })).toBeHidden();
  await page.getByRole('textbox').fill('Pune');
  await page.getByRole('textbox').press('Enter');
  await page.getByRole('button', { name: words.size, exact: true }).click();
  await page.getByRole('button', { name: words.sites, exact: true }).click();
  await page.getByRole('button', { name: words.gstActive, exact: true }).click();
  await page.getByRole('button', { name: words.fibreYes, exact: true }).click();
  await page.getByRole('button', { name: words.none, exact: true }).click();
}

async function completeJourney(page: Page, words: Words, locale: 'en' | 'hi'): Promise<void> {
  await page.goto('/');
  if (locale === 'hi') await page.getByRole('button', { name: 'हिन्दी' }).click();

  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: words.start })).toBeDisabled();
  await page.getByRole('checkbox', { name: words.agree }).check();
  await page.getByRole('checkbox', { name: words.agreeAi }).check();
  await checkScreen(page);
  await page.getByRole('button', { name: words.start }).click();

  await expect(page.getByRole('button', { name: words.shop, exact: true })).toBeVisible();
  await checkScreen(page);
  await chat(page, words);
  await expect(page.getByTestId('bundle-card')).toBeVisible();
  await checkScreen(page);

  await page.getByRole('button', { name: words.seeQuote }).click();
  await expect(page.getByTestId('monthly-total')).toHaveText('₹1,297');
  await checkScreen(page);

  await page.getByRole('button', { name: words.accept }).click();
  await page.getByLabel(words.phone).fill(nextPhone());
  await page.getByRole('button', { name: words.sendCode }).click();
  await page.getByLabel(words.code).fill('000000');
  await checkScreen(page);
  await page.getByRole('button', { name: words.verify, exact: true }).click();

  await page.getByRole('checkbox', { name: words.consentKyc }).waitFor();
  await checkScreen(page);
  await page.getByRole('checkbox', { name: words.consentKyc }).check();
  await page.getByRole('button', { name: words.consentGo }).click();

  await page.getByLabel(words.name).fill(contactNameOf('K03'));
  await page.getByRole('checkbox', { name: words.consentAdult }).check();
  await checkScreen(page);
  await page.getByRole('button', { name: words.next, exact: true }).click();

  await page.getByTestId('upload-GST_CERTIFICATE').setInputFiles(specimenPath('K03', 'gst_certificate'));
  await expect(page.getByText(locale === 'en' ? 'Read' : 'पढ़ लिया', { exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('upload-SIGNATORY_ID').setInputFiles(specimenPath('K03', 'signatory_id'));
  await expect(page.getByText(locale === 'en' ? 'Read' : 'पढ़ लिया', { exact: true }).nth(1)).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('upload-ADDRESS_PROOF').setInputFiles(specimenPath('K03', 'address_proof'));

  await expect(page.getByTestId('kyc-verdict')).toHaveAttribute('data-verdict', 'VERIFIED', { timeout: 60_000 });
  await checkScreen(page);
  // A masked number only: the full GSTIN must never be on this screen.
  await expect(page.locator('body')).not.toContainText(/\d{2}[A-Z]{5}\d{4}[A-Z]\dZ[0-9A-Z]/);

  await page.getByRole('button', { name: words.placeOrder }).click();
  await expect(page.getByTestId('tracker-next')).toBeVisible();
  await expect(page.getByRole('heading', { name: words.nextHeading })).toBeVisible();
  await checkScreen(page);

  await page.getByRole('button', { name: words.payWorks, exact: true }).click();
  await expect(page.getByRole('button', { name: words.payWorks, exact: true })).toBeHidden();
  await checkScreen(page);
}

test('the whole journey in English at 360 px, with the LLM off', async ({ page }) => {
  await completeJourney(page, ENGLISH, 'en');
  await expect(page.getByTestId('tracker-next')).toHaveText('Accel Business schedules your installation');
});

test('the whole journey in Hindi at 360 px', async ({ page }) => {
  await completeJourney(page, HINDI, 'hi');
  await expect(page.locator('html')).toHaveAttribute('lang', 'hi');
  await expect(page.getByTestId('tracker-next')).toHaveText('Accel Business आपका इंस्टॉलेशन तय करेगा');
});

test('toggling add-ons changes the price, and a blocked one stays disabled with its reason', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('checkbox', { name: ENGLISH.agree }).check();
  await page.getByRole('checkbox', { name: ENGLISH.agreeAi }).check();
  await page.getByRole('button', { name: ENGLISH.start }).click();
  await page.getByRole('button', { name: ENGLISH.shop, exact: true }).click();
  await expect(page.getByRole('button', { name: ENGLISH.shop, exact: true })).toBeHidden();
  await page.getByRole('textbox').fill('Pune');
  await page.getByRole('textbox').press('Enter');
  await page.getByRole('button', { name: ENGLISH.size, exact: true }).click();
  await page.getByRole('button', { name: ENGLISH.sites, exact: true }).click();
  await page.getByRole('button', { name: 'No GST', exact: true }).click();
  await page.getByRole('button', { name: 'Yes', exact: true }).click();
  await page.getByRole('button', { name: ENGLISH.none, exact: true }).click();
  await page.getByRole('button', { name: ENGLISH.seeQuote }).click();
  await expect(page.getByTestId('monthly-total')).toHaveText('₹1,297');

  await page.getByText('Communication', { exact: true }).click();
  await expect(page.getByRole('switch', { name: 'WhatsApp Business API Starter' })).toBeDisabled();
  await expect(page.getByRole('listitem').filter({ hasText: 'WhatsApp Business API Starter' })).toContainText('Not available: needs an active GST registration');

  await page.getByText('Security', { exact: true }).click();
  await page.getByRole('switch', { name: 'Secure Wi-Fi with Guest Network' }).click();
  await expect(page.getByTestId('monthly-total')).toHaveText('₹1,886');

  // Removing the base takes its dependent with it, and says so.
  await page.getByRole('switch', { name: 'Biz Fibre 100' }).click();
  await expect(page.getByText(/Secure Wi-Fi with Guest Network needed that connection/)).toBeVisible();
  await expect(page.getByTestId('monthly-total')).toHaveText('₹0');
  await checkScreen(page);
});

test('the short form reaches the same bundle and price without the advisor', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('checkbox', { name: ENGLISH.agree }).check();
  // The short form never calls the LLM, so it needs only the first agreement.
  await expect(page.getByRole('button', { name: ENGLISH.start })).toBeDisabled();
  await page.getByRole('button', { name: 'I prefer a short form' }).click();

  await page.getByLabel('City').selectOption('pune');
  await page.getByLabel('Number of people').fill('6');
  await page.getByLabel('GST registration').selectOption('NONE');
  await page.getByLabel('Does fibre reach your premises?').selectOption('YES');
  await checkScreen(page);
  await page.getByRole('button', { name: 'See my bundle' }).click();

  await expect(page.getByTestId('bundle-card')).toContainText('₹1,297');
  await page.getByRole('button', { name: ENGLISH.seeQuote }).click();
  await expect(page.getByTestId('monthly-total')).toHaveText('₹1,297');
});

test('owners can read what they agreed to and withdraw it', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('checkbox', { name: ENGLISH.agree }).check();
  await page.getByRole('checkbox', { name: ENGLISH.agreeAi }).check();
  await page.getByRole('button', { name: ENGLISH.start }).click();
  await expect(page.getByRole('button', { name: ENGLISH.shop, exact: true })).toBeVisible();

  await page.goto('/my-data');
  await expect(page.getByText('Agreed').first()).toBeVisible();
  await checkScreen(page);
  await page.getByRole('button', { name: 'Withdraw' }).first().click();
  await expect(page.getByText(/This deletes your chat/)).toBeVisible();
  await page.getByRole('button', { name: 'Yes, withdraw' }).click();
  await expect(page.getByText('Withdrawn', { exact: true }).first()).toBeVisible();

  // The advisor now sends them back to agree again.
  await page.goto('/advisor');
  await expect(page.getByRole('checkbox', { name: ENGLISH.agree })).toBeVisible();
});

test('a small phone at 320 px has no sideways scroll', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/');
  await checkScreen(page);
  await page.getByRole('button', { name: 'हिन्दी' }).click();
  await checkScreen(page);
});

test('the back office needs a token, and shows no identifiers', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto('/backoffice');
  await page.getByLabel('Admin token').fill('wrong-token');
  await page.getByRole('button', { name: 'Open' }).click();
  await expect(page.getByText("That token wasn't accepted.")).toBeVisible();

  await page.getByLabel('Admin token').fill('e2e-admin-token-not-a-secret');
  await page.getByRole('button', { name: 'Open' }).click();
  await expect(page.getByRole('heading', { name: 'Top leads by propensity' })).toBeVisible();
  await expect(page.locator('body')).not.toContainText(/\d{2}[A-Z]{5}\d{4}[A-Z]\dZ[0-9A-Z]/);
  await checkScreen(page);
});
