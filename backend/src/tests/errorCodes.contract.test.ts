import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { ErrorCodes } from '../utils/errorCodes';

/**
 * Contract test for the error-code surface.
 *
 * The mobile app localizes API errors by deriving an `error.<CODE>` i18n key
 * from `error.code` — it deliberately NEVER renders the backend's `message`,
 * because those are English-only and would leak English into an Arabic UI.
 *
 * That makes the set of codes a real public API. This test proves the codes we
 * actually emit are all declared in `ErrorCodes`, which is in turn what
 * `mobile/test/i18n/backend_error_codes_test.dart` checks translations against.
 * Together the two close the loop in both directions.
 */

const SRC = path.resolve(__dirname, '..');
const SKIP_DIRS = new Set(['tests', '__tests__', 'node_modules']);
const SKIP_FILES = new Set([path.join(SRC, 'utils', 'errorCodes.ts')]);

const CODE_RE = /^[A-Z][A-Z0-9_]*$/;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(full, out);
    } else if (entry.name.endsWith('.ts') && !SKIP_FILES.has(full)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Extract the code argument of every `new AppError(...)` call.
 *
 * Scans balanced parentheses rather than regexing the whole call, so multi-line
 * constructors (auth.service.ts, routerOs.service.ts) are handled, and takes the
 * LAST all-caps string literal — the `code` parameter. Anchoring on
 * `new AppError(` is what keeps SQL/Redis/signal literals (`BEGIN`, `COMMIT`,
 * `ILIKE`, `SIGTERM`) out of the result.
 */
function appErrorCodes(src: string): Set<string> {
  const found = new Set<string>();
  const NEEDLE = 'new AppError(';
  let at = src.indexOf(NEEDLE);

  while (at !== -1) {
    let i = at + NEEDLE.length;
    let depth = 1;
    while (i < src.length && depth > 0) {
      const c = src[i];
      if (c === '(' || c === '[' || c === '{') depth++;
      else if (c === ')' || c === ']' || c === '}') depth--;
      else if (c === "'" || c === '"' || c === '`') {
        const quote = c;
        i++;
        while (i < src.length && src[i] !== quote) {
          if (src[i] === '\\') i++;
          i++;
        }
      }
      i++;
    }

    const args = src.slice(at + NEEDLE.length, i - 1);
    const literals = [...args.matchAll(/'([^'\\]*)'/g)]
      .map((m) => m[1])
      .filter((s) => CODE_RE.test(s));
    if (literals.length > 0) found.add(literals[literals.length - 1]);

    at = src.indexOf(NEEDLE, i);
  }
  return found;
}

describe('error code contract', () => {
  const declared = new Set<string>(Object.values(ErrorCodes));

  const emitted = new Map<string, string>();
  for (const file of walk(SRC)) {
    const src = fs.readFileSync(file, 'utf8');
    const codes = appErrorCodes(src);
    // Responses built without AppError: rate limiters, errorHandler, validate.
    for (const m of src.matchAll(/\bcode:\s*'([A-Z][A-Z0-9_]*)'/g)) {
      codes.add(m[1]);
    }
    for (const c of codes) {
      if (!emitted.has(c)) emitted.set(c, path.relative(SRC, file));
    }
  }

  it('finds emit sites (guards against the scanner silently breaking)', () => {
    expect(emitted.size).toBeGreaterThan(50);
  });

  it('every code key equals its value', () => {
    for (const [key, value] of Object.entries(ErrorCodes)) {
      expect(value).toBe(key);
    }
  });

  it('every emitted code is declared in ErrorCodes', () => {
    const undeclared = [...emitted.entries()]
      .filter(([code]) => !declared.has(code))
      .map(([code, file]) => `${code} (${file})`)
      .sort();

    expect(
      undeclared,
      'These codes are returned to clients but missing from ErrorCodes. Add ' +
        'them there AND add error.<CODE> to _en and _ar in ' +
        'mobile/lib/i18n/app_localizations.dart, or an Arabic user sees a ' +
        'generic message instead of a real one.',
    ).toEqual([]);
  });
});
