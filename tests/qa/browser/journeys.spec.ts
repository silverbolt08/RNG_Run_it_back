import { expect, test } from '@playwright/test';
import {
  agreeHome,
  chatToBundle,
  contactStep,
  grant,
  journey,
  K03_DOCS,
  listIds,
  nextPhone,
  observe,
  reachOrder,
  reachVerify,
  signIn,
  specimenPath,
  uploadAll,
  verdict,
} from './qa-helpers';

const RESUME = /continue|resume|pick up/i;

test.describe('resume after a reload', () => {
  test('mid-chat, then with the bundle showing', async ({ page }) => {
    await agreeHome(page);
    await page.getByRole('button', { name: 'Shop or small service', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Shop or small service', exact: true })).toBeHidden();
    await page.reload();
    await expect(page.getByRole('textbox')).toBeVisible();
    await page.getByRole('textbox').fill('Pune');
    await page.getByRole('textbox').press('Enter');
    await page.getByRole('button', { name: '5 to 9', exact: true }).click();
    await page.getByRole('button', { name: '1', exact: true }).click();
    await page.reload();
    await page.getByRole('button', { name: 'Yes, active', exact: true }).click();
    await page.getByRole('button', { name: 'Yes', exact: true }).click();
    await page.getByRole('button', { name: 'None of these', exact: true }).click();
    await expect(page.getByTestId('bundle-card')).toBeVisible();
    await page.reload();
    await expect(page.getByTestId('bundle-card')).toBeVisible();
    await expect(page.getByRole('button', { name: 'See my quote' })).toBeVisible();
  });

  test('each step from quote to tracker, and home offers the right way back', async ({ page }) => {
    await agreeHome(page);
    await chatToBundle(page);
    await page.getByRole('button', { name: 'See my quote' }).click();
    await expect(page.getByTestId('monthly-total')).toHaveText('₹1,297');
    await page.reload();
    await expect(page.getByTestId('monthly-total')).toHaveText('₹1,297');

    await page.getByRole('button', { name: 'Accept and verify my business' }).click();
    await page.getByLabel('Mobile number').fill(nextPhone());
    await page.reload();
    await page.getByRole('button', { name: 'Accept and verify my business' }).click();
    await page.getByLabel('Mobile number').fill(nextPhone());
    await page.getByRole('button', { name: 'Send code' }).click();
    await page.getByLabel('6-digit code').fill('000000');
    await page.reload();
    // Losing the code step on a reload is fine, as long as the way forward is there.
    await page.getByRole('button', { name: 'Accept and verify my business' }).click();
    await page.getByLabel('Mobile number').fill(nextPhone());
    await page.getByRole('button', { name: 'Send code' }).click();
    await page.getByLabel('6-digit code').fill('000000');
    await page.getByRole('button', { name: 'Verify', exact: true }).click();

    const kyc = page.getByRole('checkbox', { name: 'I agree to this use of my documents for verification' });
    await kyc.waitFor();
    await page.reload();
    await kyc.check();
    await page.getByRole('button', { name: 'Agree and continue' }).click();
    await expect(page.getByLabel(/Your full name/)).toBeVisible();
    await page.reload();
    await contactStep(page, 'K03');
    await page.reload();
    await expect(page.getByTestId('upload-GST_CERTIFICATE')).toBeAttached();

    await page.getByTestId('upload-GST_CERTIFICATE').setInputFiles(specimenPath('K03', 'gst_certificate'));
    await expect(page.getByText('Read', { exact: true }).first()).toBeVisible({ timeout: 60_000 });
    await page.reload();
    await expect(page.getByText('Read', { exact: true }).first()).toBeVisible();

    await uploadAll(page, 'K03', K03_DOCS.slice(1));
    await expect(verdict(page)).toHaveAttribute('data-verdict', 'VERIFIED', { timeout: 60_000 });
    await page.reload();
    await expect(verdict(page)).toHaveAttribute('data-verdict', 'VERIFIED');
    await page.goto('/');
    await page.getByRole('link', { name: RESUME }).click();
    await expect(page).toHaveURL(/\/verify/);
    await expect(verdict(page)).toHaveAttribute('data-verdict', 'VERIFIED');

    await page.getByRole('button', { name: 'Place my order' }).click();
    await expect(page.getByTestId('tracker-next')).toBeVisible();
    await page.reload();
    await expect(page.getByTestId('tracker-next')).toBeVisible();
    await page.goto('/');
    await page.getByRole('link', { name: RESUME }).click();
    await expect(page).toHaveURL(/\/orders\/ord_/);
  });
});

test.describe('back button and repeats', () => {
  test('back from the tracker, then Place my order again, makes no second order', async ({ page }) => {
    const { orderId } = await reachOrder(page);
    await page.goBack();
    await expect(page).toHaveURL(/\/verify/);
    const place = page.getByRole('button', { name: 'Place my order' });
    await place.waitFor({ state: 'visible', timeout: 8000 }).catch(() => undefined);
    if (await place.isVisible()) {
      await place.click();
      await expect(page).toHaveURL(new RegExp(orderId));
    }
    expect(await listIds(page.request, '/api/v1/orders')).toEqual([orderId]);
  });

  test('back from verify to the accepted quote shows it locked', async ({ page }) => {
    await agreeHome(page);
    await chatToBundle(page);
    await page.getByRole('button', { name: 'See my quote' }).click();
    await page.getByRole('button', { name: 'Accept and verify my business' }).click();
    await page.getByLabel('Mobile number').fill(nextPhone());
    await page.getByRole('button', { name: 'Send code' }).click();
    await page.getByLabel('6-digit code').fill('000000');
    await page.getByRole('button', { name: 'Verify', exact: true }).click();
    await expect(page).toHaveURL(/\/verify/);
    await page.goBack();
    await expect(page).toHaveURL(/\/quote/);
    await expect(page.getByTestId('monthly-total')).toBeVisible();
    await expect(page.getByRole('switch')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Accept and verify my business' })).toHaveCount(0);
  });

  test('double clicks make one of everything', async ({ page }) => {
    await agreeHome(page);
    await chatToBundle(page);
    await page.getByRole('button', { name: 'See my quote' }).dblclick();
    await expect(page.getByTestId('monthly-total')).toBeVisible();
    expect((await listIds(page.request, '/api/v1/quotes')).length, 'quotes after double click on See my quote').toBe(1);

    await page.getByRole('button', { name: 'Accept and verify my business' }).dblclick();
    await page.getByLabel('Mobile number').fill(nextPhone());
    await page.getByRole('button', { name: 'Send code' }).dblclick();
    await page.getByLabel('6-digit code').fill('000000');
    await page.getByRole('button', { name: 'Verify', exact: true }).dblclick();
    await expect(page).toHaveURL(/\/verify/);
    await expect(page.getByText(/went wrong/i)).toHaveCount(0);

    await page.getByRole('checkbox', { name: 'I agree to this use of my documents for verification' }).check();
    await page.getByRole('button', { name: 'Agree and continue' }).dblclick();
    await page.getByLabel(/Your full name/).fill('Joseph Singh');
    await page.getByRole('checkbox', { name: /18 or over/ }).check();
    await page.getByRole('button', { name: 'Continue', exact: true }).dblclick();
    await uploadAll(page, 'K03');
    await expect(verdict(page)).toHaveAttribute('data-verdict', 'VERIFIED', { timeout: 60_000 });
    await page.getByRole('button', { name: 'Place my order' }).dblclick();
    await expect(page.getByTestId('tracker-next')).toBeVisible();
    expect((await listIds(page.request, '/api/v1/orders')).length, 'orders').toBe(1);
    await page.getByRole('button', { name: 'Test a successful payment' }).dblclick();
    await expect(page.getByRole('button', { name: 'Test a successful payment' })).toBeHidden();
    await expect(page.getByText(/went wrong/i)).toHaveCount(0);
  });
});

test.describe('a second purchase and returning owners', () => {
  test('same browser: start over after an order, buy a second bundle', async ({ page }) => {
    const { orderId } = await reachOrder(page);
    await grant(page.request, 'ai_chat');
    await page.goto('/advisor');
    await page.getByRole('button', { name: 'Start over' }).click();
    await chatToBundle(page);
    await page.getByRole('button', { name: 'See my quote' }).click();
    await expect(page.getByTestId('monthly-total')).toBeVisible();
    await expect(page.getByRole('switch', { name: 'Biz Fibre 100' })).toBeVisible();
    const before = await journey(page.request);
    await page.getByRole('button', { name: 'Accept and verify my business' }).click();
    await expect(page).toHaveURL(/\/verify/);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.waitForTimeout(1500);
    const placeVisible = await page.getByRole('button', { name: 'Place my order' }).isVisible();
    const contactVisible = await page.getByLabel(/Your full name/).isVisible();
    observe(test.info(), { before, placeVisible, contactVisible });
    // The new quote needs its own verification, or a new order. It must not bounce to the first.
    if (placeVisible) {
      await page.getByRole('button', { name: 'Place my order' }).click();
      await page.waitForURL(/\/orders\//);
      expect(new URL(page.url()).pathname, 'second bundle must become its own order').not.toContain(orderId);
    } else {
      await expect(page.getByLabel(/Your full name/)).toBeVisible();
    }
  });

  test('new device, known phone with an order: the new quote is the one that gets verified', async ({ page, browser }) => {
    const { phone, orderId } = await reachOrder(page);

    const context = await browser.newContext({ viewport: { width: 360, height: 780 }, baseURL: test.info().project.use.baseURL });
    const other = await context.newPage();
    await agreeHome(other);
    await chatToBundle(other);
    await other.getByRole('button', { name: 'See my quote' }).click();
    await expect(other.getByTestId('monthly-total')).toBeVisible();
    await other.getByRole('button', { name: 'Accept and verify my business' }).click();
    await other.getByLabel('Mobile number').fill(phone);
    await other.getByRole('button', { name: 'Send code' }).click();
    await other.getByLabel('6-digit code').fill('000000');
    await other.getByRole('button', { name: 'Verify', exact: true }).click();
    await expect(other).toHaveURL(/\/verify/);
    await other.waitForTimeout(1500);
    const placeVisible = await other.getByRole('button', { name: 'Place my order' }).isVisible();
    observe(test.info(), { journey: await journey(other.request), placeVisible });
    if (placeVisible) {
      await other.getByRole('button', { name: 'Place my order' }).click();
      await other.waitForURL(/\/orders\//);
      expect(new URL(other.url()).pathname, 'must not bounce to the old order').not.toContain(orderId);
    }
    await context.close();
  });

  test('new device, known phone: signing in shows the old order from home', async ({ page, browser }) => {
    const { phone, orderId } = await reachOrder(page);
    const context = await browser.newContext({ viewport: { width: 360, height: 780 }, baseURL: test.info().project.use.baseURL });
    const other = await context.newPage();
    await other.goto('/');
    // The home screen starts its own session, so wait for it rather than race its cookie.
    await other.waitForLoadState('networkidle');
    await signIn(other.request, phone);
    expect((await journey(other.request)).orderId).toBe(orderId);
    await other.goto('/');
    await other.getByRole('link', { name: RESUME }).click();
    await expect(other).toHaveURL(new RegExp(orderId));
    await expect(other.getByTestId('tracker-next')).toBeVisible();
    await context.close();
  });

  test('a draft started after an order is reachable from home', async ({ page }) => {
    await reachOrder(page);
    await page.request.post('/api/v1/quotes', {
      data: { profile: { cityTier: 1, employeeCount: 12, numSites: 1, gstinStatus: 'ACTIVE', fibreAvailable: true }, lines: [{ productId: 'P02', quantity: 1 }] },
    });
    await page.goto('/');
    await page.getByRole('link', { name: RESUME }).click();
    await expect(page, 'home resume should reach the newer draft').toHaveURL(/\/quote/);
  });
});

test.describe('withdrawing consent', () => {
  test('kyc_verification after ordering: tracker explains, and a new verification and order work', async ({ page }) => {
    const { orderId, quoteId } = await reachOrder(page);
    await page.goto('/my-data');
    await expect(page.getByRole('button', { name: 'Withdraw' }).first()).toBeVisible();
    const withdraws = page.getByRole('button', { name: 'Withdraw' });
    const count = await withdraws.count();
    observe(test.info(), { withdrawButtons: count });
    // advisor_profile, ai_chat?, kyc_verification: find the card that names documents.
    const card = page.locator('div.rounded-card').filter({ hasText: /document/i }).filter({ has: page.getByRole('button', { name: 'Withdraw' }) }).first();
    await card.getByRole('button', { name: 'Withdraw' }).click();
    await page.getByRole('button', { name: 'Yes, withdraw' }).click();
    await expect(page.getByRole('button', { name: 'Yes, withdraw' })).toHaveCount(0);

    await page.goto(`/orders/${orderId}`);
    await expect(page.getByText(/cancel/i).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Test a successful payment' })).toHaveCount(0);
    await expect(page.getByTestId('tracker-next')).toHaveCount(0);
    const steps = await page.getByRole('main').innerText();
    observe(test.info(), steps.slice(0, 500));
    await expect.soft(page.getByRole('main').getByRole('link'), 'a cancelled order should offer a way forward').not.toHaveCount(0);

    await page.goto('/verify');
    await page.getByRole('checkbox', { name: 'I agree to this use of my documents for verification' }).check();
    await page.getByRole('button', { name: 'Agree and continue' }).click();
    await contactStep(page, 'K03');
    await uploadAll(page, 'K03');
    await expect(verdict(page)).toHaveAttribute('data-verdict', 'VERIFIED', { timeout: 60_000 });
    await page.getByRole('button', { name: 'Place my order' }).click();
    await expect(page).toHaveURL(/\/orders\/ord_/);
    const second = new URL(page.url()).pathname.split('/').pop() as string;
    expect(second).not.toBe(orderId);
    await expect(page.getByTestId('tracker-next')).toBeVisible();
    expect((await journey(page.request)).quoteId).toBe(quoteId);
  });

  test('advisor_profile with a draft quote open in another tab', async ({ page, context }) => {
    await agreeHome(page);
    await chatToBundle(page);
    await page.getByRole('button', { name: 'See my quote' }).click();
    await expect(page.getByTestId('monthly-total')).toBeVisible();

    const tab = await context.newPage();
    await tab.goto('/my-data');
    await tab.getByRole('button', { name: 'Withdraw' }).first().click();
    await tab.getByRole('button', { name: 'Yes, withdraw' }).click();
    await expect(tab.getByText('Withdrawn', { exact: true }).first()).toBeVisible();
    await tab.close();

    // The open tab is now stale. It must say why, not "something went wrong".
    await page.getByRole('switch', { name: 'Biz Fibre 100' }).click();
    const notice = page.locator('[role=status],[role=alert]');
    await expect(notice.first()).toBeVisible();
    const text = await notice.first().innerText();
    observe(test.info(), text);
    expect(text).not.toMatch(/went wrong/i);
  });

  test('advisor_profile after acceptance: quote and verification survive', async ({ page }) => {
    await reachVerify(page);
    await page.goto('/my-data');
    await page.getByRole('button', { name: 'Withdraw' }).first().click();
    await page.getByRole('button', { name: 'Yes, withdraw' }).click();
    await expect(page.getByText('Withdrawn', { exact: true }).first()).toBeVisible();
    await page.goto('/quote');
    await expect(page.getByTestId('monthly-total')).toBeVisible();
    await expect(page.getByText(/went wrong/i)).toHaveCount(0);
    await page.goto('/verify');
    await expect(page.getByLabel(/Your full name/)).toBeVisible();
  });
});
