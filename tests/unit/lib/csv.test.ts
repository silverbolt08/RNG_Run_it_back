import { describe, expect, it } from 'vitest';
import { parseCsv } from '@/lib/csv';

describe('parseCsv', () => {
  it('turns a header and rows into records', () => {
    expect(parseCsv('a,b\n1,2\n3,4\n')).toEqual([
      { a: '1', b: '2' },
      { a: '3', b: '4' },
    ]);
  });

  it('keeps commas inside quoted fields', () => {
    expect(parseCsv('name,desc\nP01,"Fibre, 100 Mbps, unlimited"\n')).toEqual([
      { name: 'P01', desc: 'Fibre, 100 Mbps, unlimited' },
    ]);
  });

  it('reads doubled quotes as one quote', () => {
    expect(parseCsv('a\n"say ""hi"""\n')).toEqual([{ a: 'say "hi"' }]);
  });

  it('keeps line breaks inside quoted fields', () => {
    expect(parseCsv('a,b\n"one\ntwo",3\n')).toEqual([{ a: 'one\ntwo', b: '3' }]);
  });

  // The data pack uses the literal string None as a real value, per the CLAUDE.md trap.
  it('keeps the literal string None and leaves blanks empty', () => {
    expect(parseCsv('provider,note\nNone,\n')).toEqual([{ provider: 'None', note: '' }]);
  });

  it('handles Windows line endings', () => {
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([{ a: '1', b: '2' }]);
  });

  it('handles a final row with no line ending', () => {
    expect(parseCsv('a\n1')).toEqual([{ a: '1' }]);
  });

  it('ignores a leading byte order mark', () => {
    expect(parseCsv('﻿a\n1\n')).toEqual([{ a: '1' }]);
  });

  it('rejects a row with the wrong number of fields', () => {
    expect(() => parseCsv('a,b\n1\n')).toThrow(/row 2/);
  });

  it('returns nothing for an empty file', () => {
    expect(parseCsv('')).toEqual([]);
  });
});
