import { expect, test } from '@playwright/test';
import { checkScreen, contactNameOf, nextPhone, specimenPath } from './helpers';

const OCR_DOWN = 'http://localhost:3101';

test.describe('with the OCR language file missing, a real OCR outage', () => {
  test.use({ baseURL: OCR_DOWN });

  test('uploads are kept, nothing is lost, and the owner is told what happens next', async ({ page }) => {
    await page.goto('/');
    const api = page.request;
    await api.post('/api/v1/sessions');
    const consents = (await (await api.get('/api/v1/consents')).json()) as { items: Array<{ purpose: string; currentNoticeVersion: string }> };
    const grant = (purpose: string) =>
      api.post('/api/v1/consents', { data: { purpose, noticeVersion: consents.items.find((item) => item.purpose === purpose)?.currentNoticeVersion, language: 'en' } });
    await grant('advisor_profile');

    const quote = (await (
      await api.post('/api/v1/quotes', {
        data: { profile: { cityTier: 1, employeeCount: 12, numSites: 1, gstinStatus: 'ACTIVE', fibreAvailable: true }, lines: [{ productId: 'P01', quantity: 1 }] },
      })
    ).json()) as { id: string };
    const challenge = (await (await api.post('/api/v1/sessions/otp-requests', { data: { phone: nextPhone() } })).json()) as { challengeId: string; testCode: string };
    await api.post('/api/v1/sessions/otp-verifications', { data: { challengeId: challenge.challengeId, code: challenge.testCode } });
    await api.post(`/api/v1/quotes/${quote.id}/acceptance`);
    await grant('kyc_verification');

    await page.goto('/verify');
    await page.getByLabel(/Your full name/).fill(contactNameOf('K03'));
    await page.getByRole('checkbox', { name: /18 or over/ }).check();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();

    await page.getByTestId('upload-SIGNATORY_ID').setInputFiles(specimenPath('K03', 'signatory_id'));
    await expect(page.getByText(/Saved. We'll read it shortly/)).toBeVisible({ timeout: 60_000 });

    await page.getByTestId('upload-ADDRESS_PROOF').setInputFiles(specimenPath('K03', 'address_proof'));
    await expect(page.getByText(/Saved. We'll read it shortly/)).toHaveCount(2, { timeout: 60_000 });
    await checkScreen(page);
  });
});

test('a typed message with the LLM failing gets a plain answer, not an error', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('checkbox', { name: 'I agree to this use of my business details' }).check();
  await page.getByRole('checkbox', { name: /Google Gemini reading what I type/ }).check();
  await page.getByRole('button', { name: 'Start with the advisor' }).click();
  await expect(page.getByRole('button', { name: 'Shop or small service', exact: true })).toBeVisible();

  await page.getByRole('textbox').fill('I run a little place near the station, in Pune, with 6 people');
  await page.getByRole('textbox').press('Enter');

  await expect(page.getByText(/can't read typed messages/).first()).toBeVisible();
  await expect(page.getByText(/Something went wrong/)).toHaveCount(0);
  // What was stated plainly still counts, so the next question moves on from the city and the size.
  await page.getByRole('button', { name: 'Shop or small service', exact: true }).click();
  await expect(page.getByRole('button', { name: '1', exact: true })).toBeVisible();
  await checkScreen(page);
});
