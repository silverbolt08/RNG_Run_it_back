import { expect, test, type Page } from '@playwright/test';
import { agreeHome, contactStep, grant, nextPhone, observe, reachVerify, specimenPath } from './qa-helpers';

const active = (page: Page) =>
  page.evaluate(() => {
    const element = document.activeElement;
    if (!element) return 'none';
    return `${element.tagName}${element.getAttribute('role') ? `[${element.getAttribute('role')}]` : ''}: ${(element.getAttribute('aria-label') ?? element.textContent ?? '').trim().slice(0, 40)}`;
  });

const onBody = (page: Page) => page.evaluate(() => document.activeElement === document.body || document.activeElement === null);

async function tabsTo(page: Page, name: string, max = 30): Promise<number> {
  for (let press = 1; press <= max; press += 1) {
    await page.keyboard.press('Tab');
    const label = await page.evaluate(() => (document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent ?? '').trim());
    if (label === name) return press;
  }
  return -1;
}

test('keyboard only: tapping a chip leaves focus somewhere useful', async ({ page }) => {
  await agreeHome(page);
  expect(await tabsTo(page, 'Shop or small service')).toBeGreaterThan(0);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Shop or small service', exact: true })).toBeHidden();
  observe(test.info(), { afterChipTap: await active(page) });
  expect(await onBody(page), 'focus should not fall to the top of the page after each answer').toBe(false);
});

test('keyboard only: chips need a short path from one question to the next', async ({ page }) => {
  await agreeHome(page);
  await page.getByRole('button', { name: 'Shop or small service', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Shop or small service', exact: true })).toBeHidden();
  await page.getByRole('textbox').fill('Pune');
  await page.getByRole('textbox').press('Enter');
  await page.getByRole('button', { name: '5 to 9', exact: true }).waitFor();
  await page.locator('body').click({ position: { x: 1, y: 1 } });
  const first = await tabsTo(page, '5 to 9');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: '1', exact: true }).waitFor();
  const second = await tabsTo(page, '1');
  observe(test.info(), { tabsToFirstAnswer: first, tabsToNextAnswer: second });
  expect(second, 'after answering, the next answers are within a few tabs').toBeLessThanOrEqual(3);
});

test('typing a reply keeps focus in the box', async ({ page }) => {
  await agreeHome(page);
  await page.getByRole('button', { name: 'Shop or small service', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Shop or small service', exact: true })).toBeHidden();
  await page.getByRole('textbox').fill('Pune');
  await page.getByRole('textbox').press('Enter');
  await page.getByRole('button', { name: '5 to 9', exact: true }).waitFor();
  expect(await active(page)).toContain('INPUT');
});

test('a failed reply says so in an alert, and keeps what was typed', async ({ page }) => {
  await agreeHome(page);
  await page.route('**/api/v1/conversations/*/messages', (route) => route.abort());
  await page.getByRole('textbox').fill('Salon in Pune');
  await page.getByRole('textbox').press('Enter');
  const notice = page.locator('[role=status],[role=alert]').filter({ hasText: /connection|offline|internet|went wrong/i });
  await expect(notice.first()).toBeVisible();
  observe(test.info(), { role: await notice.first().getAttribute('role'), text: await notice.first().innerText(), focus: await active(page) });
  await expect(page.getByRole('textbox')).toHaveValue('Salon in Pune');
  expect(await notice.first().getAttribute('role'), 'an error should interrupt, as an alert').toBe('alert');
});

test('keyboard only: adding an add-on keeps focus near it', async ({ page }) => {
  await page.goto('/');
  await page.request.post('/api/v1/sessions');
  await grant(page.request, 'advisor_profile');
  await page.request.post('/api/v1/quotes', {
    data: { profile: { cityTier: 1, employeeCount: 12, numSites: 1, gstinStatus: 'ACTIVE', fibreAvailable: true }, lines: [{ productId: 'P01', quantity: 1 }] },
  });
  await page.goto('/quote');
  await expect(page.getByTestId('monthly-total')).toBeVisible();
  await page.locator('summary').filter({ hasText: 'Security' }).click();
  await page.getByRole('switch', { name: 'Secure Wi-Fi with Guest Network' }).focus();
  await page.keyboard.press('Space');
  await expect(page.getByRole('switch', { name: 'Secure Wi-Fi with Guest Network' })).toHaveAttribute('aria-checked', 'true');
  observe(test.info(), { afterAddOn: await active(page) });
  expect(await onBody(page), 'focus is lost when the row moves').toBe(false);
});

test('keyboard only: the stepper can be pressed twice without moving', async ({ page }) => {
  await page.goto('/');
  await page.request.post('/api/v1/sessions');
  await grant(page.request, 'advisor_profile');
  await page.request.post('/api/v1/quotes', {
    data: { profile: { cityTier: 1, employeeCount: 12, numSites: 1, gstinStatus: 'ACTIVE', fibreAvailable: true }, lines: [{ productId: 'P01', quantity: 1 }] },
  });
  await page.goto('/quote');
  await expect(page.getByTestId('monthly-total')).toHaveText('₹1,297');
  const plus = page.locator('button[aria-label*="Biz Fibre 100"]').nth(2);
  observe(test.info(), await page.locator('button[aria-label*="Biz Fibre 100"]').evaluateAll((items) => items.map((item) => item.getAttribute('aria-label'))));
  await plus.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('monthly-total')).toHaveText('₹2,594');
  observe(test.info(), { afterPlus: await active(page) });
  await page.waitForTimeout(300);
  await page.keyboard.press('Enter');
  // ₹3,297 before GST, plus 18% on that total, so not three times the rounded single price.
  await expect(page.getByTestId('monthly-total')).toHaveText('₹3,890');
});

test('sending the code puts the owner in the code box', async ({ page }) => {
  await page.goto('/');
  await page.request.post('/api/v1/sessions');
  await grant(page.request, 'advisor_profile');
  await page.request.post('/api/v1/quotes', {
    data: { profile: { cityTier: 1, employeeCount: 12, numSites: 1, gstinStatus: 'ACTIVE', fibreAvailable: true }, lines: [{ productId: 'P01', quantity: 1 }] },
  });
  await page.goto('/quote');
  await page.getByRole('button', { name: 'Accept and verify my business' }).click();
  await page.getByLabel('Mobile number').waitFor();
  const afterAccept = await active(page);
  const phoneInView = await page.getByLabel('Mobile number').evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const bar = document.querySelector('.sticky')?.getBoundingClientRect();
    return { top: Math.round(rect.top), bottom: Math.round(rect.bottom), viewport: innerHeight, barTop: bar ? Math.round(bar.top) : null };
  });
  await page.screenshot({ path: 'test-results/qa/phone-step-after-accept.png' });
  await page.getByLabel('Mobile number').fill(nextPhone());
  await page.getByLabel('Mobile number').press('Enter');
  await page.getByLabel('6-digit code').waitFor();
  const afterSend = await active(page);
  observe(test.info(), { afterAccept, phoneInView, afterSend });
  // Accepting opens a form further down the page: it must be where the owner is looking.
  expect(phoneInView.top, 'phone field is on screen, not below the fold').toBeLessThan(phoneInView.barTop ?? phoneInView.viewport);
  expect(phoneInView.bottom, 'phone field is clear of the sticky bar').toBeLessThanOrEqual(phoneInView.barTop ?? phoneInView.viewport);
  expect(afterSend, 'focus goes to the code box').toContain('INPUT');
});

test('upload tiles: keyboard reach, visible focus, names and announcements', async ({ page }) => {
  await reachVerify(page);
  await page.goto('/verify');
  await contactStep(page, 'K03');
  const input = page.getByTestId('upload-GST_CERTIFICATE');

  const liveBefore = await input.evaluate((element) => (element.closest('.rounded-card') as HTMLElement).querySelectorAll('[aria-live],[role=status],[role=alert]').length);

  await input.focus();
  const styles = await input.evaluate((element) => {
    const label = document.querySelector(`label[for="${CSS.escape(element.id)}"]`) as HTMLElement;
    const read = (item: HTMLElement) => {
      const style = getComputedStyle(item);
      return { outline: `${style.outlineStyle} ${style.outlineWidth}`, shadow: style.boxShadow };
    };
    const rect = element.getBoundingClientRect();
    return { input: read(element as HTMLElement), inputSize: [Math.round(rect.width), Math.round(rect.height)], label: read(label), labelText: label.textContent };
  });

  const chooser = page.waitForEvent('filechooser', { timeout: 3000 }).then(() => true).catch(() => false);
  await page.keyboard.press('Space');
  const opened = await chooser;

  await input.setInputFiles(specimenPath('K03', 'gst_certificate'));
  await expect(page.getByText('Read', { exact: true }).first()).toBeVisible({ timeout: 60_000 });
  const afterUpload = await active(page);
  const names = await input.evaluate((element) => {
    const label = document.querySelector(`label[for="${CSS.escape(element.id)}"]`) as HTMLElement;
    return { aria: element.getAttribute('aria-label'), visible: label.textContent };
  });
  observe(test.info(), { liveBefore, styles, opened, afterUpload, names });

  expect(opened, 'Space opens the file chooser').toBe(true);
  expect(styles.label.outline !== 'none 0px' || styles.label.shadow !== 'none', 'the visible tile button shows keyboard focus').toBe(true);
  // No aria-label, so the spoken name is the visible label itself.
  expect(names.aria, 'the label names the input').toBeNull();
  expect((names.visible ?? '').trim()).not.toBe('');
  expect(liveBefore, 'a live region exists before the result, or it is not announced').toBeGreaterThan(0);
});

test('field errors on the contact step move focus to the first problem', async ({ page }) => {
  await reachVerify(page);
  await page.goto('/verify');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.locator('p[role=alert]').first().waitFor();
  const focus = await active(page);
  observe(test.info(), { afterErrors: focus });
  expect(focus).toContain('INPUT');
});

test('moving between KYC steps moves focus to the new step', async ({ page }) => {
  await page.goto('/');
  await page.request.post('/api/v1/sessions');
  await grant(page.request, 'advisor_profile');
  const quote = (await (
    await page.request.post('/api/v1/quotes', {
      data: { profile: { cityTier: 1, employeeCount: 12, numSites: 1, gstinStatus: 'ACTIVE', fibreAvailable: true }, lines: [{ productId: 'P01', quantity: 1 }] },
    })
  ).json()) as { id: string };
  const challenge = (await (await page.request.post('/api/v1/sessions/otp-requests', { data: { phone: nextPhone() } })).json()) as { challengeId: string; testCode: string };
  await page.request.post('/api/v1/sessions/otp-verifications', { data: { challengeId: challenge.challengeId, code: challenge.testCode } });
  await page.request.post(`/api/v1/quotes/${quote.id}/acceptance`);
  await page.goto('/verify');
  await page.getByRole('checkbox', { name: 'I agree to this use of my documents for verification' }).check();
  await page.getByRole('button', { name: 'Agree and continue' }).focus();
  await page.keyboard.press('Enter');
  await page.getByLabel(/Your full name/).waitFor();
  const scroll = await page.evaluate(() => Math.round(scrollY));
  const focus = await active(page);
  observe(test.info(), { afterConsent: focus, scroll });
  expect(await onBody(page), 'focus should land on the new step').toBe(false);
});
