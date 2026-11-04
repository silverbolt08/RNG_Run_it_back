import { describe, expect, it } from 'vitest';
import { containsIdentifier, redactIdentifiers } from '@/lib/redact';

describe('redactIdentifiers', () => {
  it.each([
    ['my gst is 27XUIXG0767D1ZP ok', 'my gst is [GSTIN removed] ok'],
    ['27xuixg0767d1zp', '[GSTIN removed]'],
    ['misread 27QHIXK0658U1ZL here', 'misread [GSTIN removed] here'],
    ['UDYAM-MH-00-1234567', '[Udyam number removed]'],
    ['udyam mh 12 1234567', '[Udyam number removed]'],
    ['PAN ABCDE1234F', 'PAN [PAN removed]'],
    ['mail me at a.b+c@example.co.in', 'mail me at [email removed]'],
    ['aadhaar 1234 5678 9012', 'aadhaar [ID number removed]'],
    ['call 9876541234', 'call [phone removed]'],
    ['call +91 98765 41234 now', 'call [phone removed] now'],
  ])('removes the identifier from "%s"', (input, expected) => {
    expect(redactIdentifiers(input)).toBe(expected);
  });

  it.each([
    'We have 12 staff and 3 branches in Pune',
    'Fibre 300 is what I want',
    'budget is 50000 a month',
    'कर्मचारी 5 हैं',
    'Our turnover is 1500000',
  ])('leaves ordinary business facts alone: "%s"', (input) => {
    expect(redactIdentifiers(input)).toBe(input);
  });
});

describe('containsIdentifier', () => {
  it('spots an identifier, and passes ordinary text', () => {
    expect(containsIdentifier('your GSTIN 27XUIXG0767D1ZP')).toBe(true);
    expect(containsIdentifier('your bundle is ready')).toBe(false);
  });
});
