/**
 * Sensitive-field pattern: covers passwords, OTPs, tokens, secrets, API
 * credentials, and WireGuard key fields.
 */
const SENSITIVE_KEY_RE = /password|otp|token|secret|api_pass|wg_.*_key/i;

/**
 * Walk an object recursively and replace values whose keys match the
 * SENSITIVE_KEY_RE pattern with the string '[REDACTED]'.
 *
 * - Plain objects are walked recursively.
 * - Arrays are walked element-by-element.
 * - Primitives are returned as-is unless their parent key is sensitive.
 * - The original object is never mutated; a deep copy is returned.
 *
 * Overloads ensure that passing a `Record<string, unknown>` (e.g. req.body)
 * returns `Record<string, unknown>` so the result can be assigned to typed
 * audit-log `details` fields without a cast.
 */
export function redact(value: Record<string, unknown>): Record<string, unknown>;
export function redact(value: unknown): unknown;
export function redact(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redact(item));
  }

  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = SENSITIVE_KEY_RE.test(k) ? '[REDACTED]' : redact(v);
    }
    return result;
  }

  return value;
}
