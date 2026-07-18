/**
 * Opaque cursor helpers for keyset pagination.
 *
 * A cursor is a base64url-encoded JSON snapshot of the last row's sort key.
 * Callers decide what fields to encode; this module only handles the
 * encode/decode round-trip and keeps the wire format opaque.
 *
 * Shape per list:
 *   voucher_meta     : { createdAt: string (ISO), id: string (UUID) }
 *   notifications    : { createdAt: string (ISO), id: string (UUID) }
 *   support_messages : { createdAt: string (ISO), id: string (UUID) }
 *   radacct history  : { startTime: string (ISO), id: number (radacctid) }
 */

export type TimestampUuidCursor = {
  createdAt: string;
  id: string;
};

export type TimestampIntCursor = {
  startTime: string;
  id: number;
};

/**
 * Encode any JSON-serialisable payload into an opaque base64url cursor string.
 */
export function encodeCursor(payload: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

/**
 * Decode an opaque cursor string back to its payload.
 * Throws if the string is not valid base64url JSON — callers should catch and
 * return 422 INVALID_CURSOR.
 */
export function decodeCursor<T = Record<string, unknown>>(cursor: string): T {
  try {
    const json = Buffer.from(cursor, 'base64url').toString('utf8');
    return JSON.parse(json) as T;
  } catch {
    throw new Error('INVALID_CURSOR');
  }
}
