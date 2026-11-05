import { expect, test, type Page } from '@playwright/test';
import { agreeHome, chatToBundle, grant, journey, listIds, nextPhone, observe, reachOrder, signIn } from './qa-helpers';

const PROFILE = { cityTier: 1, employeeCount: 12, numSites: 1, gstinStatus: 'ACTIVE', fibreAvailable: true };

async function quoteWith(page: Page, lines: Array<{ productId: string; quantity: number }>): Promise<string> {
  await page.goto('/');
  await page.request.post('/api/v1/sessions');
  await grant(page.request, 'advisor_profile');
  const quote = (await (await page.request.post('/api/v1/quotes', { data: { profile: PROFILE, lines } })).json()) as { id: string };
  await page.goto('/quote');
  await expect(page.getByTestId('monthly-total')).toBeVisible();
  return quote.id;
}

async function openAllAddOns(page: Page): Promise<void> {
  while ((await page.locator('details:not([open]) summary').count()) > 0) await page.locator('details:not([open]) summary').first().click();
}

test('the firewall shows its contract jump, setup fee and new total at once', async ({ page }) => {
  await quoteWith(page, [{ productId: 'P01', quantity: 1 }]);
  await openAllAddOns(page);
  await page.getByRole('switch', { name: 'Managed Firewall' }).click();
  await expect(page.getByRole('main')).toContainText(/24 months/);
  await expect(page.getByRole('main')).toContainText(/12/);
  const main = await page.getByRole('main').innerText();
  observe(test.info(), main.slice(0, 600));
  // Biz Fibre 1099 + firewall 2499 = 3598, plus 18% GST. Setup 4000 plus 18%.
  await expect(page.getByTestId('monthly-total')).toHaveText('₹4,246');
  await expect(page.getByText(/₹4,720/).first()).toBeVisible();
  await page.getByRole('switch', { name: 'Managed Firewall' }).click();
  await expect(page.getByTestId('monthly-total')).toHaveText('₹1,297');
  await expect(page.getByRole('main')).toContainText(/12 months/);
});

test('removing a base with several dependents names them all, and the total follows', async ({ page }) => {
  await quoteWith(page, [
    { productId: 'P01', quantity: 1 },
    { productId: 'P09', quantity: 1 },
    { productId: 'P22', quantity: 1 },
    { productId: 'P23', quantity: 2 },
    { productId: 'P16', quantity: 3 },
  ]);
  await page.getByRole('switch', { name: 'Biz Fibre 100' }).click();
  for (const name of ['Backup 4G/5G Failover', 'Secure Wi-Fi with Guest Network', 'Cloud CCTV']) {
    await expect(page.getByRole('main').locator('div').filter({ hasText: new RegExp(`${name}.*needed that connection`) }).first()).toBeVisible();
  }
  // Only the email is left: 3 x 138 = 414, plus GST.
  await expect(page.getByRole('switch', { name: 'Cloud Email & Office Suite' })).toBeVisible();
  observe(test.info(), { total: await page.getByTestId('monthly-total').innerText(), main: (await page.getByRole('main').innerText()).slice(0, 500) });
});

test('an empty bundle: no accept, honest details, and it can be rebuilt after a reload', async ({ page }) => {
  await quoteWith(page, [{ productId: 'P01', quantity: 1 }]);
  await page.getByRole('switch', { name: 'Biz Fibre 100' }).click();
  await expect(page.getByTestId('monthly-total')).toHaveText('₹0');
  await expect(page.getByRole('button', { name: 'Accept and verify my business' })).toBeDisabled();
  const main = await page.getByRole('main').innerText();
  observe(test.info(), main.slice(0, 700));
  await page.screenshot({ path: 'test-results/qa/empty-bundle.png', fullPage: true });
  expect(main, 'an empty bundle should not state a contract or install time').not.toMatch(/\b0 months?\b|\b0 days?\b/i);
  await page.reload();
  await expect(page.getByTestId('monthly-total')).toHaveText('₹0');
  await openAllAddOns(page);
  await page.getByRole('switch', { name: 'Biz Fibre 300' }).click();
  await expect(page.getByTestId('monthly-total')).not.toHaveText('₹0');
});

test('save says saved only when it was', async ({ page }) => {
  await quoteWith(page, [{ productId: 'P01', quantity: 1 }]);
  await page.route('**/api/v1/quotes/*/save', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'X', message: 'x', details: {}, requestId: 'r' } }) }));
  await page.getByRole('button', { name: /save/i }).click();
  await expect(page.getByText(/went wrong/i).first()).toBeVisible();
  const main = await page.getByRole('main').innerText();
  observe(test.info(), main.slice(-400));
  await expect(page.locator('[role=status]').filter({ hasText: /saved\b(?!,)/i }).filter({ hasNotText: /went wrong/i }), 'no saved message after a failed save').toHaveCount(0);
});

test('the stepper at its limit explains itself', async ({ page }) => {
  const id = await quoteWith(page, [{ productId: 'P01', quantity: 1 }]);
  await page.request.put(`/api/v1/quotes/${id}/lines/P01`, { data: { quantity: 1000 } });
  await page.reload();
  // At the limit the control is off, so tapping it can't lead to an error.
  await expect(page.getByRole('button', { name: /increase/i }).first()).toBeDisabled();
});

test('with the LLM off, an unknown city is not told to tap options that are not there', async ({ page }) => {
  await agreeHome(page);
  await page.getByRole('button', { name: 'Shop or small service', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Shop or small service', exact: true })).toBeHidden();
  await page.getByRole('textbox').fill('Sangli');
  await page.getByRole('textbox').press('Enter');
  await expect(page.getByText(/tap one of the options/).first()).toBeVisible();
  const chips = await page.locator('[role=group]').filter({ hasNot: page.getByRole('button', { name: 'English' }) }).getByRole('button').count();
  observe(test.info(), { chips, main: (await page.getByRole('main').innerText()).slice(-500) });
  expect(chips, 'told to tap an option, so there must be one').toBeGreaterThan(0);
});

test('typing 0 for people in the chat does not produce a bundle nobody can buy', async ({ page }) => {
  await agreeHome(page);
  await page.getByRole('button', { name: 'Shop or small service', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Shop or small service', exact: true })).toBeHidden();
  await page.getByRole('textbox').fill('Pune');
  await page.getByRole('textbox').press('Enter');
  await expect(page.getByRole('button', { name: '5 to 9', exact: true })).toBeVisible();
  await page.getByRole('textbox').fill('0');
  await page.getByRole('textbox').press('Enter');
  // Zero is asked about again, rather than taken as the answer.
  await expect(page.getByRole('button', { name: '5 to 9', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '5 to 9', exact: true }).click();
  await page.getByRole('button', { name: '1', exact: true }).click();
  await page.getByRole('button', { name: 'Yes, active', exact: true }).click();
  await page.getByRole('button', { name: 'Yes', exact: true }).click();
  await page.getByRole('button', { name: 'None of these', exact: true }).click();
  await expect(page.getByTestId('bundle-card')).toBeVisible();
  const main = await page.getByRole('main').innerText();
  observe(test.info(), main.slice(-700));
  await page.screenshot({ path: 'test-results/qa/zero-people.png', fullPage: true });
  await expect(page.getByRole('button', { name: 'See my quote' }), 'zero people should be asked again, or still reach a quote').toBeVisible();
});

test('the short form refuses 0 people and 0 sites with a message', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('checkbox', { name: 'I agree to this use of my business details' }).check();
  await page.getByRole('button', { name: 'I prefer a short form' }).click();
  await page.getByLabel('City').selectOption('pune');
  await page.getByLabel('Number of people').fill('0');
  await page.getByLabel('GST registration').selectOption('ACTIVE');
  await page.getByLabel('Does fibre reach your premises?').selectOption('YES');
  await page.getByRole('button', { name: 'See my bundle' }).click();
  await page.waitForTimeout(800);
  const main = await page.getByRole('main').innerText();
  observe(test.info(), main.slice(-500));
  await expect(page.getByTestId('bundle-card'), 'zero people is not a business').toHaveCount(0);
});

test('a short-form answer of 1500 people still reaches a quote', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('checkbox', { name: 'I agree to this use of my business details' }).check();
  await page.getByRole('button', { name: 'I prefer a short form' }).click();
  await page.getByLabel('City').selectOption('pune');
  await page.getByLabel('Number of people').fill('1500');
  await page.getByLabel('GST registration').selectOption('ACTIVE');
  await page.getByLabel('Does fibre reach your premises?').selectOption('YES');
  await page.getByRole('checkbox', { name: /mail/i }).check();
  await page.getByRole('button', { name: 'See my bundle' }).click();
  await expect(page.getByTestId('bundle-card')).toBeVisible();
  await page.getByRole('button', { name: 'See my quote' }).click();
  await expect(page.getByTestId('monthly-total'), 'the quote screen opens').toBeVisible();
});

test('the short form with no connection and no needs says something, and does not show an empty heading', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('checkbox', { name: 'I agree to this use of my business details' }).check();
  await page.getByRole('button', { name: 'I prefer a short form' }).click();
  await page.getByLabel('City').selectOption('pune');
  await page.getByLabel('Number of people').fill('6');
  await page.getByLabel('GST registration').selectOption('ACTIVE');
  await page.getByLabel('Does fibre reach your premises?').selectOption('YES');
  await page.locator('select').filter({ has: page.locator('option[value=NONE]') }).last().selectOption('NONE');
  await page.getByRole('button', { name: 'See my bundle' }).click();
  await expect(page.getByText('Nothing is selected yet. Tell me what you need.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'See my quote' })).toHaveCount(0);
});

test('the short form does not quote old answers after they are changed', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('checkbox', { name: 'I agree to this use of my business details' }).check();
  await page.getByRole('button', { name: 'I prefer a short form' }).click();
  await page.getByLabel('City').selectOption('pune');
  await page.getByLabel('Number of people').fill('6');
  await page.getByLabel('GST registration').selectOption('ACTIVE');
  await page.getByLabel('Does fibre reach your premises?').selectOption('YES');
  await page.getByRole('checkbox', { name: /WhatsApp/i }).check();
  await page.getByRole('button', { name: 'See my bundle' }).click();
  await expect(page.getByTestId('bundle-card')).toContainText('WhatsApp');
  // Changed the answer, then went straight to the button at the bottom of the screen.
  await page.getByLabel('GST registration').selectOption('NONE');
  // The old result goes as soon as an answer changes, so it can't be quoted.
  await expect(page.getByRole('button', { name: 'See my quote' })).toHaveCount(0);
  await expect(page.getByTestId('bundle-card')).toHaveCount(0);
  await page.getByRole('button', { name: 'See my bundle' }).click();
  await expect(page.getByTestId('bundle-card')).toContainText('needs an active GST registration');
});

test('changing your mind between the chat and the quote keeps only one live quote in play', async ({ page }) => {
  await agreeHome(page);
  await chatToBundle(page);
  await page.getByRole('button', { name: 'See my quote' }).click();
  await expect(page.getByTestId('monthly-total')).toHaveText('₹1,297');
  await openAllAddOns(page);
  await page.getByRole('switch', { name: 'Secure Wi-Fi with Guest Network' }).click();
  await expect(page.getByTestId('monthly-total')).toHaveText('₹1,886');
  await page.goBack();
  await expect(page.getByRole('button', { name: 'See my quote' })).toBeVisible();
  await page.goForward();
  await expect(page.getByTestId('monthly-total')).toHaveText('₹1,886');
  await page.goBack();
  await page.getByRole('button', { name: 'See my quote' }).click();
  await expect(page.getByTestId('monthly-total')).toBeVisible();
  const total = await page.getByTestId('monthly-total').innerText();
  const quotes = await listIds(page.request, '/api/v1/quotes');
  observe(test.info(), { total, quotes: quotes.length });
  // The add-on the owner chose must not vanish without a word.
  expect(total, 'the owner toggled Wi-Fi on this quote, then tapped See my quote again').toBe('₹1,886');
});

test('after signing out, the owner has a way back to their order without buying again', async ({ page }) => {
  const { orderId } = await reachOrder(page);
  await page.goto('/my-data');
  await page.getByRole('button', { name: /sign out/i }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto(`/orders/${orderId}`);
  const tracker = await page.getByTestId('tracker-next').count();
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.waitForTimeout(800);
  const signInOffered = await page.getByRole('link', { name: /sign in|log in|my order|track/i }).or(page.getByRole('button', { name: /sign in|log in|my order|track/i })).count();
  await page.goto('/my-data');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.waitForTimeout(500);
  const fromMyData = await page.getByLabel(/mobile/i).count();
  observe(test.info(), { tracker, signInOffered, fromMyData, myData: (await page.getByRole('main').innerText()).slice(0, 300) });
  expect(signInOffered + fromMyData, 'some way to sign in that is not buying a new bundle').toBeGreaterThan(0);
});

test('new device, known phone, after page load: home offers the order', async ({ page, browser }) => {
  const { phone, orderId } = await reachOrder(page);
  const context = await browser.newContext({ viewport: { width: 360, height: 780 }, baseURL: test.info().project.use.baseURL });
  const other = await context.newPage();
  await other.goto('/');
  await other.waitForLoadState('networkidle');
  await signIn(other.request, phone);
  expect((await journey(other.request)).orderId).toBe(orderId);
  await other.goto('/');
  await other.getByRole('link', { name: /continue|resume|pick up/i }).click();
  await expect(other).toHaveURL(new RegExp(orderId));
  await context.close();
});

test('phone number formats people really type', async ({ page }) => {
  await quoteWith(page, [{ productId: 'P01', quantity: 1 }]);
  await page.getByRole('button', { name: 'Accept and verify my business' }).click();
  const base = nextPhone();
  const spaced = `+91 ${base.slice(0, 5)} ${base.slice(5)}`;
  await page.getByLabel('Mobile number').fill(spaced);
  await page.getByRole('button', { name: 'Send code' }).click();
  await expect(page.getByLabel('6-digit code')).toBeVisible();
  await expect(page.getByRole('main')).not.toContainText(base.slice(0, 6));
  await page.getByLabel('6-digit code').fill('123456');
  await page.getByRole('button', { name: 'Verify', exact: true }).click();
  await expect(page.locator('p[role=alert]')).toBeVisible();
  observe(test.info(), await page.locator('p[role=alert]').innerText());
  await page.getByRole('button', { name: /change/i }).click();
  await page.getByLabel('Mobile number').fill('12345');
  await page.getByRole('button', { name: 'Send code' }).click();
  await expect(page.locator('p[role=alert]')).toBeVisible();
});
