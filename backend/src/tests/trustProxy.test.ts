import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import app from '../app';

/**
 * GAP-1 regression: the production app must trust exactly one proxy hop (the
 * Nginx reverse proxy). Without it, `req.ip` collapses to Nginx's socket address
 * and both rate limiters share a single global bucket.
 *
 * The behavioural assertions run against a tiny mirror app whose `trust proxy`
 * value is read straight off the real `app`, so if the setting is ever removed
 * or changed to `true`, these tests break — binding the behaviour to the actual
 * production configuration rather than a hard-coded copy.
 */
function makeIpEchoApp(trustProxy: unknown) {
  const echo = express();
  echo.set('trust proxy', trustProxy);
  echo.get('/__ip', (req, res) => {
    res.json({ ip: req.ip });
  });
  return echo;
}

describe('Express trust proxy (GAP-1)', () => {
  it('sets trust proxy to exactly 1 hop on the real app (not true, not unset)', () => {
    // `true` would let clients spoof req.ip via their own X-Forwarded-For;
    // unset (false/undefined) collapses every client onto Nginx's socket IP.
    expect(app.get('trust proxy')).toBe(1);
  });

  it('resolves req.ip from a single X-Forwarded-For entry added by the trusted hop', async () => {
    const echo = makeIpEchoApp(app.get('trust proxy'));

    const res = await request(echo)
      .get('/__ip')
      .set('X-Forwarded-For', '203.0.113.9');

    expect(res.status).toBe(200);
    expect(res.body.ip).toBe('203.0.113.9');
  });

  it('takes only the rightmost (trusted) hop from a spoofed two-hop XFF', async () => {
    const echo = makeIpEchoApp(app.get('trust proxy'));

    // A client that injects its own left-most entry cannot forge req.ip:
    // with a single trusted hop, only the rightmost entry (the one the trusted
    // proxy actually added) is honoured.
    const res = await request(echo)
      .get('/__ip')
      .set('X-Forwarded-For', '6.6.6.6, 203.0.113.9');

    expect(res.status).toBe(200);
    expect(res.body.ip).toBe('203.0.113.9');
    expect(res.body.ip).not.toBe('6.6.6.6');
  });

  it('ignores X-Forwarded-For entirely when trust proxy is disabled (contrast)', async () => {
    const echo = makeIpEchoApp(false);

    const res = await request(echo)
      .get('/__ip')
      .set('X-Forwarded-For', '203.0.113.9');

    expect(res.status).toBe(200);
    // Without trust proxy the socket (loopback) address wins, never the header.
    expect(res.body.ip).not.toBe('203.0.113.9');
  });
});
