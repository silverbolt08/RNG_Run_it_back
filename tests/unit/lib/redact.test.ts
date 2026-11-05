import { describe, expect, it } from 'vitest';
import { containsIdentifier, redactIdentifiers } from '@/lib/redact';

describe('redactIdentifiers', () => {
  it.each([
    ['my gst is 27XUIXG0767D1ZP ok', 'my gst is [GSTIN removed] ok'],
    ['27xuixg0767d1zp', '[GSTIN removed]'],
    ['misread 27QHIXK0658U1ZL here', 'misread [GSTIN removed] here'],
    ['gst 27 XUIXG 0767 D 1 Z P', 'gst [GSTIN removed]'],
    ['gst 27-XUIXG-0767-D-1ZP', 'gst [GSTIN removed]'],
    ['UDYAM-MH-00-1234567', '[Udyam number removed]'],
    ['udyam mh 12 1234567', '[Udyam number removed]'],
    ['MH-12-123456', '[Udyam number removed]'],
    ['PAN ABCDE1234F', 'PAN [PAN removed]'],
    ['PAN ABCDE 1234 F', 'PAN [PAN removed]'],
    ['voter ABC1234567', 'voter [ID number removed]'],
    ['mail me at a.b+c@example.co.in', 'mail me at [email removed]'],
    ['pay ramesh.k@okhdfc', 'pay [UPI ID removed]'],
    ['aadhaar 1234 5678 9012', 'aadhaar [number removed]'],
    ['aadhaar 1234.5678.9012', 'aadhaar [number removed]'],
    ['call 9876541234', 'call [number removed]'],
    ['call +91 98765 41234 now', 'call [number removed] now'],
    ['call 987 654 1234', 'call [number removed]'],
    ['call 98 76 54 12 34', 'call [number removed]'],
    ['call 98765.41234', 'call [number removed]'],
    ['landline 022-24567890', 'landline [number removed]'],
    ['account 50100123456789', 'account [number removed]'],
    ['फ़ोन ९८७६५४१२३४ है', 'फ़ोन [number removed] है'],
    ['आधार १२३४ ५६७८ ९०१२', 'आधार [number removed]'],
    ['My name is Ramesh Kumar, I run a shop', '[name removed], I run a shop'],
    ['mera naam Ramesh hai.', '[name removed].'],
    ['मेरा नाम रमेश कुमार है', '[name removed]'],
  ])('removes the identifier from "%s"', (input, expected) => {
    expect(redactIdentifiers(input)).toBe(expected);
  });

  it.each([
    'We have 12 staff and 3 branches in Pune',
    'Fibre 300 is what I want',
    'budget is 50000 a month',
    'कर्मचारी 5 हैं',
    'Our turnover is 1500000',
    'I am a salon owner in Pune',
  ])('leaves ordinary business facts alone: "%s"', (input) => {
    expect(redactIdentifiers(input)).toBe(input);
  });

  it('keeps a small number in another script readable', () => {
    expect(redactIdentifiers('५ लोग हैं')).toBe('5 लोग हैं');
  });
});

describe('containsIdentifier', () => {
  it('spots an identifier, and passes ordinary text', () => {
    expect(containsIdentifier('your GSTIN 27XUIXG0767D1ZP')).toBe(true);
    expect(containsIdentifier('your bundle is ready')).toBe(false);
  });

  it('does not count another script\'s digits as an identifier', () => {
    expect(containsIdentifier('कीमत ९९९ है')).toBe(false);
  });
});
