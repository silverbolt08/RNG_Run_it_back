/**
 * A small RFC 4180 parser, enough for the data pack's files. It keeps every value as a
 * string, so the literal "None" in the pack stays a value and blanks stay empty.
 */
export function parseCsv(text: string): Array<Record<string, string>> {
  const rows = readRows(text.replace(/^﻿/, ''));
  const header = rows[0];
  if (!header) return [];

  return rows.slice(1).map((row, index) => {
    if (row.length !== header.length) {
      throw new Error(`CSV row ${index + 2} has ${row.length} fields, expected ${header.length}`);
    }
    return Object.fromEntries(header.map((name, column) => [name, row[column] ?? '']));
  });
}

function readRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text.charAt(i);

    if (inQuotes) {
      if (ch !== '"') {
        field += ch;
      } else if (text.charAt(i + 1) === '"') {
        field += '"';
        i++;
      } else {
        inQuotes = false;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch !== '\r') {
      field += ch;
    }
  }

  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
