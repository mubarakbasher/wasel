/**
 * RFC-4180 CSV serialization for admin exports.
 *
 * Design goals:
 *  - Spec-correct quoting/escaping so the output round-trips through Excel,
 *    LibreOffice, and `csv`-parsing tooling.
 *  - Formula-injection hardening (CSV injection / "DDE") — a cell whose string
 *    value begins with `=`, `+`, `-`, or `@` is prefixed with a single quote so
 *    spreadsheet apps treat it as text, never as a formula.
 *  - UTF-8 BOM prefix so Excel autodetects UTF-8 and Arabic/RTL content renders
 *    correctly instead of as mojibake.
 *
 * The column-spec API (rather than a positional headers/keys pair) keeps every
 * export fully type-safe end to end: each `value` extractor is typed against the
 * row shape, so a renamed service field is a compile error, not a silent blank
 * column.
 */

/** A single output column: a header cell plus a typed value extractor. */
export interface CsvColumn<T> {
  /** Text of the header cell in row 1. */
  header: string;
  /** Extract this column's raw cell value from a row (serialized by {@link toCsv}). */
  value: (row: T) => unknown;
}

const CRLF = '\r\n';
const BOM = '﻿';

// Characters that, as the first char of a *string* cell, could be interpreted
// as the start of a formula by a spreadsheet application.
const FORMULA_TRIGGERS = new Set(['=', '+', '-', '@']);

/**
 * Serialize an arbitrary cell value to its raw text plus whether the
 * formula-injection guard applies.
 *
 * Only strings (and JSON-stringified objects) are guardable. Numbers, bigints,
 * booleans, and Dates are serialized in their canonical form and are exempt —
 * a numeric `-5` or an ISO date must never be mangled with a leading quote.
 */
function serialize(value: unknown): { text: string; guardable: boolean } {
  if (value === null || value === undefined) {
    return { text: '', guardable: false };
  }
  if (value instanceof Date) {
    return { text: value.toISOString(), guardable: false };
  }
  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') {
    return { text: String(value), guardable: false };
  }
  if (typeof value === 'string') {
    return { text: value, guardable: true };
  }
  // Objects/arrays (e.g. audit-log `details` JSONB) → compact JSON.
  return { text: JSON.stringify(value), guardable: true };
}

/** Serialize + formula-guard + RFC-4180-quote a single cell. */
function escapeCell(value: unknown): string {
  const { text, guardable } = serialize(value);
  let cell = text;

  // Formula-injection guard: prefix a leading trigger char with a single quote.
  if (guardable && cell.length > 0 && FORMULA_TRIGGERS.has(cell[0])) {
    cell = `'${cell}`;
  }

  // RFC-4180: a field containing a quote, comma, CR, or LF must be quoted, and
  // embedded quotes are doubled.
  if (/["\r\n,]/.test(cell)) {
    cell = `"${cell.replace(/"/g, '""')}"`;
  }

  return cell;
}

/**
 * Serialize `rows` to an RFC-4180 CSV document.
 *
 * The result is prefixed with a UTF-8 BOM and uses CRLF line endings, including
 * a trailing CRLF after the final record.
 */
export function toCsv<T>(rows: readonly T[], columns: readonly CsvColumn<T>[]): string {
  const headerLine = columns.map((col) => escapeCell(col.header)).join(',');
  const dataLines = rows.map((row) => columns.map((col) => escapeCell(col.value(row))).join(','));
  return BOM + [headerLine, ...dataLines].join(CRLF) + CRLF;
}
