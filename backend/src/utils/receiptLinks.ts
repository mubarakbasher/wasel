import { createHmac, hkdfSync, timingSafeEqual } from 'crypto';
import { config } from '../config';
import { RECEIPTS_PUBLIC_PREFIX } from '../middleware/upload';

export const RECEIPT_LINK_TTL_SECONDS = 3600;

/** Old (`<uid>-<ms>.<ext>`) and new (`<uid>-<ms>-<8 hex>.<ext>`) receipt file names. */
export const RECEIPT_NAME_RE = /^[0-9a-f-]{36}-\d{13}(-[0-9a-f]{8})?\.(jpg|jpeg|png|webp)$/;

const SIG_LENGTH = 43; // base64url of a 32-byte HMAC-SHA256

let cachedKey: Buffer | null = null;
function linkKey(): Buffer {
  if (!cachedKey) {
    cachedKey = Buffer.from(
      hkdfSync('sha256', Buffer.from(config.ENCRYPTION_KEY, 'hex'), Buffer.alloc(0), 'wasel-receipt-url-v1', 32),
    );
  }
  return cachedKey;
}

function sign(name: string, exp: string): string {
  return createHmac('sha256', linkKey()).update(`${name}.${exp}`).digest('base64url');
}

/**
 * Turn a stored `/uploads/receipts/<name>` path into a signed, 1-hour link.
 * Returns null for null input or anything that is not a standard stored receipt path.
 */
export function signReceiptUrl(storedPath: string | null | undefined, nowMs: number = Date.now()): string | null {
  const prefix = `${RECEIPTS_PUBLIC_PREFIX}/`;
  if (typeof storedPath !== 'string' || !storedPath.startsWith(prefix)) return null;
  const name = storedPath.slice(prefix.length);
  if (!RECEIPT_NAME_RE.test(name)) return null;
  const exp = String(Math.floor(nowMs / 1000) + RECEIPT_LINK_TTL_SECONDS);
  return `/api/v1/receipts/${name}?exp=${exp}&sig=${sign(name, exp)}`;
}

/** Check a receipt link's expiry and signature. Never throws. */
export function verifyReceiptLink(name: string, exp: unknown, sig: unknown, nowMs: number = Date.now()): boolean {
  try {
    if (typeof exp !== 'string' || !/^\d{1,12}$/.test(exp)) return false;
    if (Number(exp) * 1000 <= nowMs) return false;
    if (Number(exp) * 1000 > nowMs + (RECEIPT_LINK_TTL_SECONDS + 60) * 1000) return false;
    if (typeof sig !== 'string' || sig.length !== SIG_LENGTH) return false;
    return timingSafeEqual(Buffer.from(sig), Buffer.from(sign(name, exp)));
  } catch {
    return false;
  }
}
