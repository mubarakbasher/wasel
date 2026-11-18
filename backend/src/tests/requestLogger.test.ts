import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import app from '../app';
import logger from '../config/logger';

describe('requestLogger', () => {
  it('does not log the signed query string of receipt links', async () => {
    const info = vi.spyOn(logger, 'info');
    await request(app).get(`/api/v1/receipts/nope.png?exp=9999999999&sig=${'a'.repeat(43)}`);
    const calls = info.mock.calls as unknown as [string, { url: string }][];
    const urls = calls.filter((c) => c[0] === 'HTTP Request').map((c) => String(c[1].url));
    await request(app).get(`/API/V1/Receipts/nope.png?exp=9999999999&sig=${'b'.repeat(43)}`);
    const urls2 = (info.mock.calls as unknown as [string, { url: string }][])
      .filter((c) => c[0] === 'HTTP Request')
      .map((c) => String(c[1].url));
    expect(urls2.some((u) => u.toLowerCase().startsWith('/api/v1/receipts/nope.png'))).toBe(true);
    expect(urls2.some((u) => u.includes('sig='))).toBe(false);
    expect(urls.some((u) => u.startsWith('/api/v1/receipts/nope.png'))).toBe(true);
    expect(urls.some((u) => u.includes('sig='))).toBe(false);
    info.mockRestore();
  });
});
