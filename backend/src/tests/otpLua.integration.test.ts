/**
 * OTP Lua scripts against a REAL Redis — opt-in, skipped by default.
 *
 * Every other suite runs the JS re-implementation in setup.ts, so nothing in CI
 * ever feeds the actual Lua to a Lua interpreter. This file does, which is the
 * only way to catch a genuine Lua error (nil arithmetic, a cjson quirk, a
 * `redis.call` typo) or a real TTL/PTTL behaviour difference.
 *
 * How to run it:
 *
 *   docker compose -f docker-compose.dev.yml up -d redis
 *   cd backend && REDIS_INTEGRATION=1 npm test -- otpLua.integration
 *
 * The dev compose publishes Redis on 127.0.0.1:6380 with `--requirepass` taken
 * from REDIS_PASSWORD in the repo-root .env; backend/.env.local carries the same
 * value under the REDIS_HOST / REDIS_PORT / REDIS_PASSWORD names that
 * src/config/index.ts parses, and importing the service below loads it via
 * dotenv. Override per-run with REDIS_HOST / REDIS_PORT / REDIS_PASSWORD.
 *
 * Safety: every key is written under a run-unique prefix and only those keys are
 * deleted in afterAll. Never FLUSHDB here — the dev Redis is shared with the
 * running backend's sessions and rate-limit counters.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { Redis as RedisClient } from 'ioredis';
import { OTP_LUA_SCRIPTS } from '../services/token.service';

const enabled = process.env.REDIS_INTEGRATION === '1';

// Mirrors the constants in token.service.ts (maxAttempts, attemptsTtl, lockTtl).
const MAX_ATTEMPTS = '5';
const ATTEMPTS_TTL = '3600';
const LOCK_TTL = '900';
const WINDOW_TTL = '3600';

describe.skipIf(!enabled)('OTP Lua scripts against a real Redis', () => {
  const prefix = `test:${Date.now()}:`;
  const touched = new Set<string>();
  let client: RedisClient;

  /** Track every key we write so afterAll can delete exactly those and no more. */
  function key(name: string): string {
    const full = `${prefix}${name}`;
    touched.add(full);
    return full;
  }

  function validate(
    otpKey: string,
    attemptsKey: string,
    lockKey: string,
    provided: string,
    mode: 'raw' | 'json',
  ): Promise<unknown> {
    return client.eval(
      OTP_LUA_SCRIPTS.validate,
      3,
      otpKey,
      attemptsKey,
      lockKey,
      provided,
      mode,
      MAX_ATTEMPTS,
      ATTEMPTS_TTL,
      LOCK_TTL,
    ) as Promise<unknown>;
  }

  beforeAll(async () => {
    // setup.ts installs a global vi.mock('ioredis'); importActual bypasses it so
    // this file talks to a real server while every other file keeps the mock.
    const { default: Redis } = await vi.importActual<typeof import('ioredis')>('ioredis');
    client = new Redis({
      host: process.env.REDIS_HOST ?? '127.0.0.1',
      port: Number(process.env.REDIS_PORT ?? 6380),
      password: process.env.REDIS_PASSWORD || undefined,
      lazyConnect: false,
      maxRetriesPerRequest: 1,
    });
    await client.ping();
  });

  afterAll(async () => {
    if (!client) return;
    if (touched.size > 0) {
      await client.del(...touched);
    }
    await client.quit();
  });

  it('returns NOCODE when no code is live', async () => {
    const res = await validate(
      key('otp:nocode'),
      key('attempts:nocode'),
      key('lock:nocode'),
      '000000',
      'raw',
    );
    expect(res).toEqual(['NOCODE']);
    // A guess with no live code must not be counted, or anyone could pre-lock a
    // stranger's flow with junk guesses.
    expect(await client.exists(key('attempts:nocode'))).toBe(0);
  });

  it('locks out on the 5th wrong guess and arms the lock TTL', async () => {
    const otpKey = key('otp:lock');
    const attemptsKey = key('attempts:lock');
    const lockKey = key('lock:lock');
    await client.set(otpKey, '123456', 'EX', 3600);

    for (let i = 0; i < 4; i++) {
      expect(await validate(otpKey, attemptsKey, lockKey, '000000', 'raw')).toEqual([
        'WRONG',
      ]);
    }
    expect(await validate(otpKey, attemptsKey, lockKey, '000000', 'raw')).toEqual([
      'LOCKED',
    ]);

    // The lock is a real key with a real TTL — this is the assertion the mock
    // cannot make, since its store has no TTLs at all.
    const pttl = await client.pttl(lockKey);
    expect(pttl).toBeGreaterThan(890_000);
    expect(pttl).toBeLessThanOrEqual(900_000);
    // Lockout consumes the code and the counter.
    expect(await client.exists(otpKey)).toBe(0);
    expect(await client.exists(attemptsKey)).toBe(0);

    // And the CORRECT code is worthless while the lock stands — that is the point.
    expect(await validate(otpKey, attemptsKey, lockKey, '123456', 'raw')).toEqual([
      'LOCKED',
    ]);
  });

  it('raw mode returns a bare OK and consumes both keys', async () => {
    const otpKey = key('otp:raw');
    const attemptsKey = key('attempts:raw');
    const lockKey = key('lock:raw');
    await client.set(otpKey, '654321', 'EX', 3600);
    // One wrong guess first so the attempts key actually exists and we can prove
    // the OK branch clears it.
    expect(await validate(otpKey, attemptsKey, lockKey, '000000', 'raw')).toEqual([
      'WRONG',
    ]);
    expect(await client.exists(attemptsKey)).toBe(1);

    // No second element: in raw mode the stored value IS the plaintext OTP.
    expect(await validate(otpKey, attemptsKey, lockKey, '654321', 'raw')).toEqual(['OK']);
    expect(await client.exists(otpKey)).toBe(0);
    expect(await client.exists(attemptsKey)).toBe(0);
  });

  it('json mode returns OK plus the stored payload', async () => {
    const otpKey = key('otp:json');
    const attemptsKey = key('attempts:json');
    const lockKey = key('lock:json');
    const payload = JSON.stringify({ code: '123456', newEmail: 'x@y.z' });
    await client.set(otpKey, payload, 'EX', 3600);

    const res = (await validate(otpKey, attemptsKey, lockKey, '123456', 'json')) as [
      string,
      string,
    ];
    expect(res[0]).toBe('OK');
    // The caller parses this to recover newEmail, so the payload must survive
    // the round-trip through cjson-decode-then-echo byte for byte.
    expect(JSON.parse(res[1])).toEqual({ code: '123456', newEmail: 'x@y.z' });
    expect(await client.exists(otpKey)).toBe(0);
  });

  it('json mode treats a malformed payload as NOCODE, not a Lua error', async () => {
    const otpKey = key('otp:badjson');
    const attemptsKey = key('attempts:badjson');
    const lockKey = key('lock:badjson');
    await client.set(otpKey, 'not-json-at-all', 'EX', 3600);

    // pcall around cjson.decode: a corrupt/legacy value must degrade to "no code"
    // rather than raise, which would surface as a 500 on a live endpoint.
    expect(await validate(otpKey, attemptsKey, lockKey, '123456', 'json')).toEqual([
      'NOCODE',
    ]);
  });

  it('the send-cap window is fixed: the TTL is not refreshed by later calls', async () => {
    const counterKey = key('send:window');

    const first = await client.eval(
      OTP_LUA_SCRIPTS.incrFixedWindow,
      1,
      counterKey,
      WINDOW_TTL,
    );
    expect(first).toBe(1);
    const pttlAfterFirst = await client.pttl(counterKey);
    expect(pttlAfterFirst).toBeGreaterThan(0);

    // Deliberate pause: PTTL has millisecond resolution and six local round-trips
    // can land inside the same millisecond, which would make the comparison below
    // flaky rather than wrong.
    await new Promise((resolve) => setTimeout(resolve, 25));

    for (let i = 2; i <= 6; i++) {
      expect(
        await client.eval(OTP_LUA_SCRIPTS.incrFixedWindow, 1, counterKey, WINDOW_TTL),
      ).toBe(i);
    }

    // THE assertion: a sliding window would have pushed this back up to ~WINDOW_TTL.
    // Refused, over-cap calls must never be able to keep the window alive, or one
    // request per hour pins a victim's send budget at zero forever (M-A).
    const pttlAfterSixth = await client.pttl(counterKey);
    expect(pttlAfterSixth).toBeLessThan(pttlAfterFirst);
  });
});
