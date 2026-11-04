import { describe, expect, it } from 'vitest';
import { maskGstin, maskPhone, maskSignatoryId, maskUdyam, scrubIdentifiers } from '@/lib/mask';

describe('masking helpers', () => {
  it('masks a GSTIN as in the privacy-security table', () => {
    expect(maskGstin('32TTNXB7384T1ZW')).toBe('32TTN•••••••1ZW');
  });

  it('masks a Udyam number as in the privacy-security table', () => {
    expect(maskUdyam('UDYAM-KL-00-3078801')).toBe('UDYAM-KL-00-•••8801');
  });

  it('keeps only the last 4 characters of a signatory ID', () => {
    expect(maskSignatoryId('SYN-ID-447889')).toBe('••••7889');
  });

  it('keeps only the last 4 digits of a phone number', () => {
    expect(maskPhone('9876541234')).toBe('••••••1234');
    expect(maskPhone('+919876541234')).toBe('••••••1234');
  });

  it.each([
    ['a misread GSTIN of the wrong length', maskGstin, '32TTNXB73'],
    ['a malformed Udyam number', maskUdyam, 'UDYAM-KL-3078801'],
    ['a short signatory ID', maskSignatoryId, '1234'],
    ['a short phone', maskPhone, '12345'],
  ])('reveals nothing useful from %s', (_label, mask, value) => {
    const masked = mask(value);
    expect(masked).toContain('•');
    expect(masked).not.toContain(value);
    expect(masked.replace(/•/g, '').length).toBeLessThanOrEqual(3);
  });
});

describe('scrubIdentifiers', () => {
  it('masks any GSTIN, Udyam number and phone number in free text', () => {
    const text = 'gstin 32TTNXB7384T1ZW udyam UDYAM-KL-00-3078801 phone 9876541234 or +91 98765 41234';
    const scrubbed = scrubIdentifiers(text);
    expect(scrubbed).not.toContain('32TTNXB7384T1ZW');
    expect(scrubbed).not.toContain('UDYAM-KL-00-3078801');
    expect(scrubbed).not.toContain('9876541234');
    expect(scrubbed).not.toContain('98765 41234');
    expect(scrubbed).toContain('32TTN•••••••1ZW');
    expect(scrubbed).toContain('UDYAM-KL-00-•••8801');
    expect(scrubbed).toContain('••••••1234');
  });

  it('also masks a GSTIN that fails the checksum, since OCR values do', () => {
    expect(scrubIdentifiers('read 08YKZXS8189L1ZO today')).not.toContain('08YKZXS8189L1ZO');
  });

  it('leaves ordinary text alone', () => {
    expect(scrubIdentifiers('quote accepted in 12 months')).toBe('quote accepted in 12 months');
  });
});
