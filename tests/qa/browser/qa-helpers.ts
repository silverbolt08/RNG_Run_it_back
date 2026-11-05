import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { contactNameOf, nextPhone, specimenPath } from '../../e2e/helpers';

export const ADMIN_TOKEN = 'e2e-admin-token-not-a-secret';
export { contactNameOf, nextPhone, specimenPath };

export const K03_DOCS = [
  ['GST_CERTIFICATE', 'gst_certificate'],
  ['SIGNATORY_ID', 'signatory_id'],
  ['ADDRESS_PROOF', 'address_proof'],
] as const;

type Consent = { purpose: string; currentNoticeVersion: string };

export async function grant(api: APIRequestContext, purpose: string, language = 'en'): Promise<void> {
  const consents = (await (await api.get('/api/v1/consents')).json()) as { items: Consent[] };
  const notice = consents.items.find((item) => item.purpose === purpose)?.currentNoticeVersion;
  const response = await api.post('/api/v1/consents', { data: { purpose, noticeVersion: notice, language } });
  expect(response.status(), `grant ${purpose}`).toBeLessThan(300);
}

export async function signIn(api: APIRequestContext, phone: string): Promise<void> {
  const challenge = (await (await api.post('/api/v1/sessions/otp-requests', { data: { phone } })).json()) as { challengeId: string; testCode: string };
  const verified = await api.post('/api/v1/sessions/otp-verifications', { data: { challengeId: challenge.challengeId, code: challenge.testCode } });
  expect(verified.status()).toBe(200);
}

export const P01_ACTIVE = {
  profile: { cityTier: 1, employeeCount: 12, numSites: 1, gstinStatus: 'ACTIVE', fibreAvailable: true },
  lines: [{ productId: 'P01', quantity: 1 }],
};

/** Everything before the verify screen, by API. */
export async function reachVerify(page: Page, options: { phone?: string; body?: unknown } = {}): Promise<{ quoteId: string; phone: string }> {
  await page.goto('/');
  const api = page.request;
  await api.post('/api/v1/sessions');
  await grant(api, 'advisor_profile');
  const quote = (await (await api.post('/api/v1/quotes', { data: options.body ?? P01_ACTIVE })).json()) as { id: string };
  const phone = options.phone ?? nextPhone();
  await signIn(api, phone);
  expect((await api.post(`/api/v1/quotes/${quote.id}/acceptance`)).status()).toBe(200);
  await grant(api, 'kyc_verification');
  return { quoteId: quote.id, phone };
}

export async function contactStep(page: Page, key: string): Promise<void> {
  await page.getByLabel(/Your full name/).fill(contactNameOf(key));
  await page.getByRole('checkbox', { name: /18 or over/ }).check();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByTestId('upload-GST_CERTIFICATE')).toBeAttached();
}

type DocFile = 'gst_certificate' | 'signatory_id' | 'address_proof' | 'udyam_certificate';

export async function uploadAll(page: Page, key: string, docs: ReadonlyArray<readonly [string, DocFile]> = K03_DOCS): Promise<void> {
  for (const [type, file] of docs) {
    await page.getByTestId(`upload-${type}`).setInputFiles(specimenPath(key, file));
    await expect(page.getByText('Reading your document')).toBeHidden({ timeout: 60_000 });
    await expect(page.getByTestId(`upload-${type}`)).toBeEnabled({ timeout: 60_000 });
  }
}

export const verdict = (page: Page) => page.getByTestId('kyc-verdict');

/** To the tracker with a K03 order: real screens from /verify onward. */
export async function reachOrder(page: Page, options: { phone?: string; key?: string } = {}): Promise<{ quoteId: string; phone: string; orderId: string }> {
  const reached = await reachVerify(page, options);
  await page.goto('/verify');
  const key = options.key ?? 'K03';
  await contactStep(page, key);
  await uploadAll(page, key);
  await expect(verdict(page)).toHaveAttribute('data-verdict', /VERIFIED|MANUAL_REVIEW/, { timeout: 60_000 });
  await page.getByRole('button', { name: 'Place my order' }).click();
  await expect(page).toHaveURL(/\/orders\/ord_/);
  await expect(page.getByTestId('tracker-next')).toBeVisible();
  const orderId = new URL(page.url()).pathname.split('/').pop() as string;
  return { ...reached, orderId };
}

export async function agreeHome(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('checkbox', { name: 'I agree to this use of my business details' }).check();
  await page.getByRole('checkbox', { name: /Google Gemini reading what I type/ }).check();
  await page.getByRole('button', { name: 'Start with the advisor' }).click();
  await expect(page.getByRole('button', { name: 'Shop or small service', exact: true })).toBeVisible();
}

export async function chatToBundle(page: Page, gst = 'Yes, active', employees = '5 to 9'): Promise<void> {
  await page.getByRole('button', { name: 'Shop or small service', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Shop or small service', exact: true })).toBeHidden();
  await page.getByRole('textbox').fill('Pune');
  await page.getByRole('textbox').press('Enter');
  await page.getByRole('button', { name: employees, exact: true }).click();
  await page.getByRole('button', { name: '1', exact: true }).click();
  await page.getByRole('button', { name: gst, exact: true }).click();
  await page.getByRole('button', { name: 'Yes', exact: true }).click();
  await page.getByRole('button', { name: 'None of these', exact: true }).click();
  await expect(page.getByTestId('bundle-card')).toBeVisible();
}

export async function listIds(api: APIRequestContext, path: string): Promise<string[]> {
  const body = (await (await api.get(path)).json()) as { items: Array<{ id: string }> };
  return body.items.map((item) => item.id);
}

export type Journey = { quoteId: string | null; kycApplicationId: string | null; orderId: string | null };

export async function journey(api: APIRequestContext): Promise<Journey> {
  const body = (await (await api.get('/api/v1/sessions/current')).json()) as { journey: Journey };
  return body.journey;
}

export async function adminAdvance(api: APIRequestContext, orderId: string): Promise<number> {
  return (await api.post(`/api/v1/admin/orders/${orderId}/stage-advances`, { headers: { 'x-admin-token': ADMIN_TOKEN } })).status();
}

/** Records what a probe saw, so a failure report can quote it. */
export function observe(info: { annotations: Array<{ type: string; description?: string }> }, what: unknown): void {
  const description = typeof what === 'string' ? what : JSON.stringify(what);
  info.annotations.push({ type: 'observed', description });
  console.log(`OBSERVED ${description}`);
}
