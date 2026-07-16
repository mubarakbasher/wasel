import { describe, it, expect } from 'vitest';
import { toCsv, CsvColumn } from '../utils/csv';

const BOM = '﻿';
const CRLF = '\r\n';

interface Row {
  a: unknown;
  b: unknown;
}

/** Build a two-column CSV from raw {a, b} cell values. */
function twoCol(rows: Row[]): string {
  const columns: CsvColumn<Row>[] = [
    { header: 'A', value: (r) => r.a },
    { header: 'B', value: (r) => r.b },
  ];
  return toCsv(rows, columns);
}

/** Strip the BOM + header line, returning the data region only. */
function body(csv: string): string {
  return csv.slice(BOM.length + `A,B${CRLF}`.length);
}

describe('toCsv', () => {
  it('prepends a UTF-8 BOM', () => {
    const csv = toCsv([], [{ header: 'A', value: () => '' }]);
    expect(csv.startsWith(BOM)).toBe(true);
    // The BOM must be the very first codepoint, before the header.
    expect(csv.slice(BOM.length).startsWith('A')).toBe(true);
  });

  it('uses CRLF line endings, including a trailing terminator', () => {
    const csv = twoCol([{ a: '1', b: '2' }]);
    expect(csv).toBe(`${BOM}A,B${CRLF}1,2${CRLF}`);
  });

  it('emits only the header row (plus trailing CRLF) for an empty row set', () => {
    const csv = twoCol([]);
    expect(csv).toBe(`${BOM}A,B${CRLF}`);
  });

  it('quotes fields containing a comma', () => {
    const csv = twoCol([{ a: 'hello, world', b: 'x' }]);
    expect(body(csv)).toBe(`"hello, world",x${CRLF}`);
  });

  it('quotes fields containing CR or LF', () => {
    const csv = twoCol([{ a: 'line1\nline2', b: 'c\rd' }]);
    expect(body(csv)).toBe(`"line1\nline2","c\rd"${CRLF}`);
  });

  it('escapes embedded double-quotes by doubling and wrapping', () => {
    const csv = twoCol([{ a: 'she said "hi"', b: 'x' }]);
    expect(body(csv)).toBe(`"she said ""hi""",x${CRLF}`);
  });

  it('leaves ordinary fields unquoted', () => {
    const csv = twoCol([{ a: 'plain', b: 'value' }]);
    expect(body(csv)).toBe(`plain,value${CRLF}`);
  });

  describe('formula-injection guard', () => {
    it.each(['=', '+', '-', '@'])('prefixes a string starting with %s with a single quote', (ch) => {
      const csv = twoCol([{ a: `${ch}CMD()`, b: 'x' }]);
      expect(body(csv)).toBe(`'${ch}CMD(),x${CRLF}`);
    });

    it('quotes AND guards when the payload also contains a comma', () => {
      const csv = twoCol([{ a: '=1+2,3', b: 'x' }]);
      expect(body(csv)).toBe(`"'=1+2,3",x${CRLF}`);
    });

    // OWASP lists tab (0x09) and CR (0x0D) as Excel cell-start formula triggers.
    it('prefixes AND quotes a string starting with a tab (0x09)', () => {
      const csv = twoCol([{ a: '\tSUM(A1)', b: 'x' }]);
      // guard adds a leading quote, then the tab forces RFC-4180 quoting.
      expect(body(csv)).toBe(`"'\tSUM(A1)",x${CRLF}`);
    });

    it('prefixes AND quotes a string starting with a carriage return (0x0D)', () => {
      const csv = twoCol([{ a: '\r=1+1', b: 'x' }]);
      expect(body(csv)).toBe(`"'\r=1+1",x${CRLF}`);
    });

    it('quotes a cell with an embedded (non-leading) tab so it never leaks raw', () => {
      const csv = twoCol([{ a: 'a\tb', b: 'x' }]);
      expect(body(csv)).toBe(`"a\tb",x${CRLF}`);
    });

    it('does not guard negative NUMBERS (numeric cells are exempt)', () => {
      const csv = twoCol([{ a: -5, b: 0 }]);
      expect(body(csv)).toBe(`-5,0${CRLF}`);
    });

    it('guards a negative number written as a STRING', () => {
      const csv = twoCol([{ a: '-5', b: 'x' }]);
      expect(body(csv)).toBe(`'-5,x${CRLF}`);
    });
  });

  describe('value serialization', () => {
    it('renders null and undefined as empty cells', () => {
      const csv = twoCol([{ a: null, b: undefined }]);
      expect(body(csv)).toBe(`,${CRLF}`);
    });

    it('serializes Dates as ISO 8601', () => {
      const d = new Date('2026-07-16T12:34:56.000Z');
      const csv = twoCol([{ a: d, b: 'x' }]);
      expect(body(csv)).toBe(`2026-07-16T12:34:56.000Z,x${CRLF}`);
    });

    it('serializes booleans and numbers canonically', () => {
      const csv = twoCol([{ a: true, b: 42 }]);
      expect(body(csv)).toBe(`true,42${CRLF}`);
    });

    it('JSON-stringifies objects (e.g. audit details) and quotes them', () => {
      const csv = twoCol([{ a: { k: 'v', n: 1 }, b: 'x' }]);
      expect(body(csv)).toBe(`"{""k"":""v"",""n"":1}",x${CRLF}`);
    });
  });

  it('passes Arabic text through unmangled', () => {
    const csv = twoCol([{ a: 'مرحبا بالعالم', b: 'قسيمة' }]);
    expect(body(csv)).toBe(`مرحبا بالعالم,قسيمة${CRLF}`);
    // BOM still leads the document so Excel autodetects UTF-8.
    expect(csv.startsWith(BOM)).toBe(true);
  });

  it('emits multiple data rows in order', () => {
    const csv = twoCol([
      { a: '1', b: 'one' },
      { a: '2', b: 'two' },
    ]);
    expect(body(csv)).toBe(`1,one${CRLF}2,two${CRLF}`);
  });
});
