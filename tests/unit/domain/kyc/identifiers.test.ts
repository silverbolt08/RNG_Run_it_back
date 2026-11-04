import { describe, expect, it } from 'vitest';
import {
  gstinStateName,
  isValidGstinChecksum,
  isValidGstinFormat,
  repairGstinByPosition,
  suggestGstinLookalike,
} from '@/domain/kyc/gstin';
import { isValidUdyamFormat, udyamStateName } from '@/domain/kyc/udyam';

// Values read from the fictional specimens K01 to K12 in the data pack.
const SPECIMEN = {
  K02: '19EOGXH4115Y1ZL',
  K03: '27XUIXG0767D1ZP',
  K05: '32TZAXB5481U1Z1',
  K06_PRINTED: '08YKZXS8189L1ZO',
  K07: '07CPCXN0398P1ZT',
  K08: '24XORXG9365M1Z3',
  K10: '27QHJXK0658U1ZL',
  K12: '37NBLXS1145E1ZU',
};

describe('GSTIN format', () => {
  it('accepts a valid structure', () => {
    expect(isValidGstinFormat(SPECIMEN.K02)).toBe(true);
  });

  it('accepts X as the 4th PAN character, as the data pack requires', () => {
    expect(SPECIMEN.K02.charAt(5)).toBe('X');
    expect(isValidGstinChecksum(SPECIMEN.K02)).toBe(true);
  });

  it.each([
    ['too short', '19EOGXH4115Y1Z'],
    ['too long', '19EOGXH4115Y1ZLL'],
    ['lowercase', '19eogxh4115y1zl'],
    ['a letter where a digit belongs', '1AEOGXH4115Y1ZL'],
    ['a digit where a letter belongs', '19E0GXH4115Y1ZL'],
    ['no fixed Z at position 14', '19EOGXH4115Y1AL'],
    ['0 as the entity code', '19EOGXH4115Y0ZL'],
    ['empty', ''],
  ])('rejects %s', (_name, value) => {
    expect(isValidGstinFormat(value)).toBe(false);
  });
});

describe('GSTIN checksum', () => {
  it.each(Object.entries(SPECIMEN).filter(([k]) => k !== 'K06_PRINTED'))('passes %s', (_k, value) => {
    expect(isValidGstinChecksum(value)).toBe(true);
  });

  it('fails K06, where one digit was altered', () => {
    expect(isValidGstinFormat(SPECIMEN.K06_PRINTED)).toBe(true);
    expect(isValidGstinChecksum(SPECIMEN.K06_PRINTED)).toBe(false);
  });

  it('fails anything with an invalid format', () => {
    expect(isValidGstinChecksum('19E0GXH4115Y1ZL')).toBe(false);
  });
});

describe('GSTIN state code', () => {
  it('names the state from the first two digits', () => {
    expect(gstinStateName(SPECIMEN.K10)).toBe('Maharashtra');
  });

  it('returns null for a state code outside the data pack', () => {
    expect(gstinStateName('99EOGXH4115Y1ZL')).toBeNull();
  });
});

describe('repairGstinByPosition', () => {
  // Each pair is what OCR read on 2026-11-04 and the value it should become.
  it.each([
    ['K02, 0 read in a letter position', '19E0GXH4115Y1ZL', SPECIMEN.K02],
    ['K03, O read in a digit position', '27XUIXGO767D1ZP', SPECIMEN.K03],
    ['K05, 7 read for the fixed Z', '32TZAXB5481U171', SPECIMEN.K05],
    ['K07, O read in a digit position', '07CPCXNO398P1ZT', SPECIMEN.K07],
    ['K08, two faults at once', '24X0RXG9365M173', SPECIMEN.K08],
    ['K12, 7 read for the fixed Z', '37NBLXS1145E17U', SPECIMEN.K12],
  ])('repairs %s', (_name, read, expected) => {
    const result = repairGstinByPosition(read);
    expect(result.value).toBe(expected);
    expect(result.checksumOk).toBe(true);
    expect(result.changes.length).toBeGreaterThan(0);
  });

  // The check character can be a letter or a digit, so its position can't settle O or 0.
  it.each([
    ['O read as 0', '19SNXXC4363G1Z0', '19SNXXC4363G1ZO'],
    ['0 read as O', '08JVKXA4705I1ZO', '08JVKXA4705I1Z0'],
  ])('settles the check character by the checksum when %s', (_name, read, expected) => {
    const result = repairGstinByPosition(read);
    expect(result.value).toBe(expected);
    expect(result.checksumOk).toBe(true);
    expect(result.changes).toContainEqual({ position: 15, from: read.charAt(14), to: expected.charAt(14) });
  });

  it('leaves a valid GSTIN unchanged', () => {
    const result = repairGstinByPosition(SPECIMEN.K10);
    expect(result).toEqual({ value: SPECIMEN.K10, changes: [], checksumOk: true });
  });

  it('removes spaces and punctuation, and uppercases', () => {
    expect(repairGstinByPosition(' 27qhjxk0658u1zl. ').value).toBe(SPECIMEN.K10);
  });

  it('never makes K06 valid, whichever way its check character was read', () => {
    expect(repairGstinByPosition('08YKZXS8189L170').checksumOk).toBe(false);
    expect(repairGstinByPosition(SPECIMEN.K06_PRINTED).checksumOk).toBe(false);
  });

  it('cannot repair K10, because I and J are both letters', () => {
    const result = repairGstinByPosition('27QHIXK0658U1ZL');
    expect(result.checksumOk).toBe(false);
    expect(result.changes).toEqual([]);
  });

  it('does not attempt a repair on the wrong length', () => {
    expect(repairGstinByPosition('19E0GXH')).toEqual({ value: '19E0GXH', changes: [], checksumOk: false });
  });
});

describe('suggestGstinLookalike', () => {
  it('suggests the one look-alike letter that fixes K10', () => {
    expect(suggestGstinLookalike('27QHIXK0658U1ZL')).toBe(SPECIMEN.K10);
  });

  // Altered digits are the fault we must catch, so digits are never suggested.
  it('offers nothing for K06 read with a 0 check character', () => {
    expect(suggestGstinLookalike('08YKZXS8189L1Z0')).toBeNull();
  });

  // A suggestion only passes the checksum. The registry lookup still has to find it.
  it('can suggest for K06 read with an O, leaving the registry to reject it', () => {
    const suggestion = suggestGstinLookalike(SPECIMEN.K06_PRINTED);
    expect(suggestion).not.toBeNull();
    expect(isValidGstinChecksum(suggestion ?? '')).toBe(true);
  });

  it('offers nothing when the value is already valid', () => {
    expect(suggestGstinLookalike(SPECIMEN.K10)).toBeNull();
  });

  it('offers nothing for a malformed value', () => {
    expect(suggestGstinLookalike('NOTAGSTIN')).toBeNull();
  });
});

describe('Udyam number', () => {
  it('accepts district 00, as the data pack requires', () => {
    expect(isValidUdyamFormat('UDYAM-MH-00-9516696')).toBe(true);
  });

  it.each([
    ['another district', 'UDYAM-MH-01-9516696'],
    ['six digits', 'UDYAM-MH-00-951669'],
    ['eight digits', 'UDYAM-MH-00-95166960'],
    ['lowercase', 'udyam-mh-00-9516696'],
    ['no prefix', 'MH-00-9516696'],
    ['empty', ''],
  ])('rejects %s', (_name, value) => {
    expect(isValidUdyamFormat(value)).toBe(false);
  });

  it('names the state from the code', () => {
    expect(udyamStateName('UDYAM-KL-00-5521886')).toBe('Kerala');
  });

  // The pack uses KR for Karnataka, not the KA a real validator would expect.
  it('uses the data pack code for Karnataka', () => {
    expect(udyamStateName('UDYAM-KR-00-1234567')).toBe('Karnataka');
  });

  it('returns null for a state code outside the data pack', () => {
    expect(udyamStateName('UDYAM-ZZ-00-1234567')).toBeNull();
  });
});
