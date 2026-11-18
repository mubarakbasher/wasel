import { describe, it, expect } from 'vitest';
import { signReceiptUrl, verifyReceiptLink } from '../utils/receiptLinks';

const NAME = '550e8400-e29b-41d4-a716-446655440000-1795000000000-abcdef12.png';
const NOW = 1_800_000_000_000;

function parts(link: string): { name: string; exp: string; sig: string } {
  const m = /^\/api\/v1\/receipts\/([^?]+)\?exp=(\d+)&sig=(.+)$/.exec(link)!;
  return { name: m[1], exp: m[2], sig: m[3] };
}

describe('signReceiptUrl', () => {
  it('signs a stored path into a relative receipts link', () => {
    const link = signReceiptUrl(`/uploads/receipts/${NAME}`, NOW);
    expect(link).toBe(`/api/v1/receipts/${NAME}?exp=1800003600&sig=${parts(link!).sig}`);
    expect(parts(link!).sig).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('returns null for anything that is not a standard stored receipt path', () => {
    expect(signReceiptUrl(null)).toBeNull();
    expect(signReceiptUrl(undefined)).toBeNull();
    expect(signReceiptUrl('https://cdn.wa-sel.com/receipts/r1.jpg')).toBeNull();
    expect(signReceiptUrl('/uploads/receipts/x.html')).toBeNull();
    expect(signReceiptUrl('/uploads/receipts/../../etc/passwd')).toBeNull();
    expect(signReceiptUrl(`/uploads/other/${NAME}`)).toBeNull();
  });
});

describe('verifyReceiptLink', () => {
  const { name, exp, sig } = parts(signReceiptUrl(`/uploads/receipts/${NAME}`, NOW)!);

  it('verifies its own link until expiry', () => {
    expect(verifyReceiptLink(name, exp, sig, NOW)).toBe(true);
    expect(verifyReceiptLink(name, exp, sig, NOW + 3600_001)).toBe(false);
  });

  it('rejects tampering and garbage without throwing', () => {
    const other = NAME.replace('abcdef12', 'abcdef13');
    expect(verifyReceiptLink(other, exp, sig, NOW)).toBe(false);
    expect(verifyReceiptLink(name, String(Number(exp) + 1), sig, NOW)).toBe(false);
    expect(verifyReceiptLink(name, exp, sig.slice(0, -1), NOW)).toBe(false);
    expect(verifyReceiptLink(name, exp, 'a'.repeat(200), NOW)).toBe(false);
    expect(verifyReceiptLink(name, 'abc', sig, NOW)).toBe(false);
    expect(verifyReceiptLink(name, '99999999999999999999', sig, NOW)).toBe(false);
    expect(verifyReceiptLink(name, undefined, undefined, NOW)).toBe(false);
    expect(verifyReceiptLink(name, [exp], sig, NOW)).toBe(false);
    expect(verifyReceiptLink(name, exp, [sig], NOW)).toBe(false);
  });

  it('rejects an exp further out than TTL + 60 s even when correctly signed', () => {
    const far = signReceiptUrl(`/uploads/receipts/${NAME}`, NOW + 120_000)!;
    const p = parts(far);
    expect(Number(p.exp) * 1000).toBeGreaterThan(NOW + (3600 + 60) * 1000);
    expect(verifyReceiptLink(p.name, p.exp, p.sig, NOW)).toBe(false);
    expect(verifyReceiptLink(name, exp, sig, NOW)).toBe(true);
  });
});
