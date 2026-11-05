import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const SPECIMEN_DIR = 'YTL_TrackA_Udyam_Digital_Data/kyc_documents';

const SPECIMENS = JSON.parse(readFileSync('tests/fixtures/kyc/specimens.json', 'utf8')) as {
  applicants: Record<string, { contactName: string }>;
};

export const contactNameOf = (key: string): string => {
  const person = SPECIMENS.applicants[key];
  if (!person) throw new Error(`No applicant ${key}`);
  return person.contactName;
};

export const specimenPath = (key: string, document: 'gst_certificate' | 'signatory_id' | 'address_proof' | 'udyam_certificate') =>
  path.join(SPECIMEN_DIR, `${key}_${document}.png`);

/** Every key screen must have no serious accessibility problem and no sideways scroll. */
export async function checkScreen(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical');
  expect(serious.map((violation) => `${violation.id}: ${violation.nodes[0]?.html ?? ''}`)).toEqual([]);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

let phoneCounter = 0;

/** A different number each time, because a known number signs back in to its old owner. */
export function nextPhone(): string {
  phoneCounter += 1;
  return `9${String(Date.now()).slice(-7)}${String(phoneCounter).padStart(2, '0')}`;
}
