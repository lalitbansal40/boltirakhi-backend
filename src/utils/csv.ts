/**
 * Hand-rolled CSV, because the only hard parts are the two below and a library
 * would be a dependency for string concatenation.
 */

/** Leading characters Excel and Sheets treat as the start of a formula. */
const FORMULA_START = /^[=+\-@\t\r]/;

/**
 * One cell, escaped for both Excel and correctness.
 *
 * Two separate problems:
 *
 * 1. **Formula injection.** A cell starting with `=`, `+`, `-` or `@` is
 *    executed as a formula on open. Product titles and customer names are
 *    user-supplied, so `=HYPERLINK(...)` in a name would run on the admin's
 *    machine. Prefixing with a single quote makes Excel treat it as text.
 * 2. **Delimiters.** Commas, quotes and newlines inside a value need the whole
 *    cell quoted, with inner quotes doubled.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';

  let text = String(value);
  if (FORMULA_START.test(text)) text = `'${text}`;

  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

/**
 * Rows to a CSV document.
 *
 * The BOM is there so Excel on Windows reads it as UTF-8 — without it, a
 * customer name in Devanagari opens as mojibake.
 */
export function toCsv(headers: readonly string[], rows: readonly unknown[][]): string {
  const lines = [headers.map(csvCell).join(',')];

  for (const row of rows) {
    lines.push(row.map(csvCell).join(','));
  }

  return `﻿${lines.join('\r\n')}\r\n`;
}
