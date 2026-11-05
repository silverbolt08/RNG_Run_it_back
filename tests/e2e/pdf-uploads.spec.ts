import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import sharp from 'sharp';
import { imagePdf, passwordProtectedPdf } from '../helpers/pdf-fixtures';
import { checkScreen, contactNameOf, nextPhone, specimenPath } from './helpers';

async function reachDocuments(page: Page, key: string): Promise<void> {
  await page.goto('/');
  const api = page.request;
  await api.post('/api/v1/sessions');
  const consents = (await (await api.get('/api/v1/consents')).json()) as { items: Array<{ purpose: string; currentNoticeVersion: string }> };
  const grant = (purpose: string) =>
    api.post('/api/v1/consents', { data: { purpose, noticeVersion: consents.items.find((item) => item.purpose === purpose)?.currentNoticeVersion, language: 'en' } });
  await grant('advisor_profile');

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

  await page.goto('/verify');
  await page.getByLabel(/Your full name/).fill(contactNameOf(key));
  await page.getByRole('checkbox', { name: /18 or over/ }).check();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
}

async function asPdfFile(key: string, document: 'gst_certificate' | 'signatory_id' | 'address_proof') {
  const png = readFileSync(specimenPath(key, document));
  const { width = 0, height = 0 } = await sharp(png).metadata();
  const jpeg = await sharp(png).flatten({ background: '#ffffff' }).jpeg({ quality: 92 }).toBuffer();
  return { name: `${document}.pdf`, mimeType: 'application/pdf', buffer: imagePdf(jpeg, width, height) };
}

test('a clean applicant can send every document as a PDF, through the real server', async ({ page }) => {
  await reachDocuments(page, 'K03');

  await page.getByTestId('upload-GST_CERTIFICATE').setInputFiles(await asPdfFile('K03', 'gst_certificate'));
  await expect(page.getByText('Read', { exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('upload-SIGNATORY_ID').setInputFiles(await asPdfFile('K03', 'signatory_id'));
  await expect(page.getByText('Read', { exact: true }).nth(1)).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('upload-ADDRESS_PROOF').setInputFiles(await asPdfFile('K03', 'address_proof'));

  await expect(page.getByTestId('kyc-verdict')).toHaveAttribute('data-verdict', 'VERIFIED', { timeout: 60_000 });
  await checkScreen(page);
});

test('a blurred certificate sent as a PDF is still asked for again', async ({ page }) => {
  await reachDocuments(page, 'K04');
  await page.getByTestId('upload-GST_CERTIFICATE').setInputFiles(await asPdfFile('K04', 'gst_certificate'));
  await expect(page.getByText(/Too blurry to read/)).toBeVisible({ timeout: 60_000 });
});

test('a locked PDF and a damaged one each say what to do next, and the tile still works', async ({ page }) => {
  await reachDocuments(page, 'K03');
  const tile = page.getByTestId('upload-SIGNATORY_ID');

  await tile.setInputFiles({ name: 'locked.pdf', mimeType: 'application/pdf', buffer: passwordProtectedPdf() });
  await expect(page.getByText(/locked with a password/)).toBeVisible({ timeout: 30_000 });

  await tile.setInputFiles({ name: 'bad.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7 not really') });
  await expect(page.getByText(/couldn't open this PDF/)).toBeVisible({ timeout: 30_000 });
  await checkScreen(page);

  await tile.setInputFiles(await asPdfFile('K03', 'signatory_id'));
  await expect(page.getByText('Read', { exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/couldn't open this PDF/)).toHaveCount(0);
});
