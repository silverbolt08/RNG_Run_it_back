import { describe, expect, it } from 'vitest';
import {
  assessImageQuality,
  detectDocumentType,
  parseAddressProof,
  parseGstCertificate,
  parseSignatoryId,
  parseUdyamCertificate,
} from '@/domain/kyc/documents';

// Layouts as OCR returns them from the fictional specimens.
const GST_TEXT = `Specimen: GST Registration Certificate
Format for hackathon OCR testing only

GSTIN 37IHKXV5167L1ZS

Legal name Neha Kaur (Prop. Vindhya Tours & Travels)
Trade name Vindhya Tours & Travels

Constitution Proprietorship

Address of principal Shop/Unit 1, Tech Park Road, Visakhapatnam, A
place of business ndhra Pradesh - 118383
Date of liability 2025-06-07

Type of registration Regular`;

const UDYAM_TEXT = `Specimen: Udyam Registration Certificate
Udyam reg. number UDYAM-MH-00-9516696

Enterprise name Ganesh Woodcraft

Major activity Manufacturing

City Nagpur

State Maharashtra

Date of registration 2024-11-21`;

const ID_TEXT = `Specimen: Authorised Signatory ID

Name

Joseph Singh

Designation

Owner

For business

Ganesh Woodcraft

ID no.

SYN-ID-447889

Valid till

2028-07-04`;

const BILL_TEXT = `Specimen: Electricity Bill
Consumer no. 3438517928

Billed to Ganesh Woodcraft

Supply address Shop/Unit 80, Civil Lines, Nagpur, Maharashtr

a-411231

Bill date 2026-05-30

Units consumed 231`;

describe('parseGstCertificate', () => {
  it('reads every field by its label', () => {
    expect(parseGstCertificate(GST_TEXT)).toEqual({
      gstin: '37IHKXV5167L1ZS',
      legalName: 'Neha Kaur (Prop. Vindhya Tours & Travels)',
      tradeName: 'Vindhya Tours & Travels',
      constitution: 'Proprietorship',
      address: 'Shop/Unit 1, Tech Park Road, Visakhapatnam, Andhra Pradesh - 118383',
      liabilityDate: '2025-06-07',
      registrationType: 'Regular',
    });
  });

  it('copes with noisy labels', () => {
    const noisy = 'Legai narne Neha Kaur\nTrade nane Vindhya Tours\nGST1N 37IHKXV5167L1ZS';
    expect(parseGstCertificate(noisy)).toMatchObject({
      gstin: '37IHKXV5167L1ZS',
      legalName: 'Neha Kaur',
      tradeName: 'Vindhya Tours',
    });
  });

  it('leaves a missing field blank instead of guessing', () => {
    expect(parseGstCertificate('GSTIN 37IHKXV5167L1ZS').legalName).toBe('');
  });
});

describe('parseUdyamCertificate', () => {
  it('reads every field by its label', () => {
    expect(parseUdyamCertificate(UDYAM_TEXT)).toEqual({
      udyamNumber: 'UDYAM-MH-00-9516696',
      enterpriseName: 'Ganesh Woodcraft',
      majorActivity: 'Manufacturing',
      city: 'Nagpur',
      state: 'Maharashtra',
      registrationDate: '2024-11-21',
    });
  });

  // K01: the certificate prints its label with nothing after it.
  it('reads a blank number as blank', () => {
    const blank = UDYAM_TEXT.replace('UDYAM-MH-00-9516696', '');
    expect(parseUdyamCertificate(blank).udyamNumber).toBe('');
  });
});

describe('parseSignatoryId', () => {
  it('reads values from the line under each label', () => {
    expect(parseSignatoryId(ID_TEXT)).toEqual({
      name: 'Joseph Singh',
      designation: 'Owner',
      business: 'Ganesh Woodcraft',
      idNumber: 'SYN-ID-447889',
      validTill: '2028-07-04',
    });
  });

  it('does not take the next label as a value', () => {
    expect(parseSignatoryId('Name\nDesignation\nOwner').name).toBe('');
  });
});

describe('parseAddressProof', () => {
  it('reads every field, joining the wrapped address', () => {
    expect(parseAddressProof(BILL_TEXT)).toEqual({
      consumerNumber: '3438517928',
      billedTo: 'Ganesh Woodcraft',
      supplyAddress: 'Shop/Unit 80, Civil Lines, Nagpur, Maharashtra-411231',
      billDate: '2026-05-30',
    });
  });

  it('does not join the next labelled row onto an unwrapped address', () => {
    const text = 'Supply address Shop/Unit 80, Civil Lines\nBill date 2026-05-30';
    expect(parseAddressProof(text).supplyAddress).toBe('Shop/Unit 80, Civil Lines');
  });
});

describe('detectDocumentType', () => {
  it.each([
    [GST_TEXT, 'GST_CERTIFICATE'],
    [UDYAM_TEXT, 'UDYAM_CERTIFICATE'],
    [ID_TEXT, 'SIGNATORY_ID'],
    [BILL_TEXT, 'ADDRESS_PROOF'],
  ])('recognises each document type', (text, expected) => {
    expect(detectDocumentType(text)).toBe(expected);
  });

  it('returns null for text it can not place', () => {
    expect(detectDocumentType('Dear customer, thank you for your order')).toBeNull();
    expect(detectDocumentType('')).toBeNull();
  });
});

describe('assessImageQuality', () => {
  // K04's blurred certificate scores 1, and every sharp specimen scores 433 or more.
  it.each([
    [1, 'BLURRED'],
    [99, 'BLURRED'],
    [100, 'OK'],
    [433, 'OK'],
    [867, 'OK'],
  ])('reads a blur score of %i as %s', (score, expected) => {
    expect(assessImageQuality(score)).toBe(expected);
  });
});
