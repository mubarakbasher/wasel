import { vi } from 'vitest';
import { createHash } from 'crypto';

// Set required env vars before config module loads
process.env.NODE_ENV = 'test';
process.env.JWT_ACCESS_SECRET = 'test-access-secret-that-is-long-enough';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-that-is-long-enough';
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.WG_SERVER_PRIVATE_KEY = 'test-wg-private-key';
process.env.WG_SERVER_PUBLIC_KEY = 'test-wg-public-key';
process.env.WG_SERVER_ENDPOINT = '127.0.0.1';
process.env.DB_HOST = 'localhost';
process.env.DB_PASSWORD = 'test';

// Mock ioredis
const redisStore = new Map<string, string>();
const redisCounters = new Map<string, number>();

// How many times a TTL was armed on a key — by a Lua script's EXPIRE/SET-EX, or
// by `set(key, value, 'EX', ttl)`. (No production code calls `.expire(` any
// more; the mock keeps the method only so a future caller does not silently
// bypass this bookkeeping.)
// Lets tests tell a FIXED window (EXPIRE once, on the first hit) from a SLIDING
// one (EXPIRE on every hit — which lets an over-cap caller keep the window
// alive forever).
const redisExpireCalls = new Map<string, number>();
// The (mode, ttl) last written for a key. The store itself is TTL-less, so
// without this a typo like a missing 'EX' would ship a permanent key unnoticed.
// Every TTL-arming path funnels through recordExpire() so the two maps stay
// symmetric — a key with a ttl entry always has an arm count and vice versa.
const redisTtls = new Map<string, { mode: string; ttl: number }>();

function recordExpire(key: string, ttl: number, mode = 'EX'): void {
  redisExpireCalls.set(key, (redisExpireCalls.get(key) ?? 0) + 1);
  redisTtls.set(key, { mode, ttl });
}

/** Mirrors Redis' `redis.sha1hex(...)` so the mock compares what the real script compares. */
function sha1hex(value: string): string {
  return createHash('sha1').update(value, 'utf8').digest('hex');
}

vi.mock('ioredis', () => {
  class MockRedis {
    async set(key: string, value: string, mode?: string, ttl?: number) {
      redisStore.set(key, value);
      if (mode !== undefined && ttl !== undefined) {
        // Same bookkeeping a Lua-armed TTL gets: a SET ... EX is a TTL arm.
        recordExpire(key, ttl, mode);
      }
      return 'OK';
    }
    async get(key: string) {
      return redisStore.get(key) ?? null;
    }
    async del(...keys: string[]) {
      let count = 0;
      for (const key of keys) {
        if (redisStore.delete(key)) count++;
        if (redisCounters.delete(key)) count++;
      }
      return count;
    }
    async exists(key: string) {
      return redisStore.has(key) ? 1 : 0;
    }
    async incr(key: string) {
      const current = (redisCounters.get(key) ?? 0) + 1;
      redisCounters.set(key, current);
      return current;
    }
    async expire(key: string, ttl: number) {
      recordExpire(key, ttl);
      return 1; // always succeeds in tests
    }
    // Atomic Lua dispatch. Marker comments are checked FIRST: the otp-validate
    // script also contains 'DEL', so the consume-key branch must stay last or it
    // would swallow it.
    async eval(script: string, numkeys: number, ...args: (string | number)[]) {
      const keys = args.slice(0, numkeys).map(String);
      const argv = args.slice(numkeys).map(String);

      // -- otp-validate: EXISTS lock -> GET code -> compare -> INCR/lock, atomically.
      if (script.startsWith('-- otp-validate')) {
        const [otpKey, attemptsKey, lockKey] = keys;
        const [provided, payloadMode, maxAttempts, attemptsTtl, lockTtl] = argv;

        if (redisStore.has(lockKey)) return ['LOCKED'];

        const stored = redisStore.get(otpKey);
        if (stored === undefined) return ['NOCODE'];

        let code: string | null = stored;
        if (payloadMode === 'json') {
          try {
            const parsed = JSON.parse(stored) as { code?: unknown };
            code = typeof parsed.code === 'string' ? parsed.code : null;
          } catch {
            code = null;
          }
          if (code === null) return ['NOCODE'];
        }

        if (sha1hex(code) === sha1hex(provided)) {
          redisStore.delete(otpKey);
          redisCounters.delete(attemptsKey);
          // 'raw' mode returns a bare ['OK']: the stored value there IS the
          // plaintext OTP and must not ride back out on the reply.
          return payloadMode === 'json' ? ['OK', stored] : ['OK'];
        }

        const n = (redisCounters.get(attemptsKey) ?? 0) + 1;
        redisCounters.set(attemptsKey, n);
        recordExpire(attemptsKey, Number(attemptsTtl));

        if (n >= Number(maxAttempts)) {
          redisStore.delete(otpKey);
          redisCounters.delete(attemptsKey);
          redisStore.set(lockKey, '1');
          recordExpire(lockKey, Number(lockTtl));
          return ['LOCKED'];
        }
        return ['WRONG'];
      }

      // -- incr-fixed-window: EXPIRE only when the counter was just created.
      if (script.startsWith('-- incr-fixed-window')) {
        const key = keys[0];
        const current = (redisCounters.get(key) ?? 0) + 1;
        redisCounters.set(key, current);
        if (current === 1) recordExpire(key, Number(argv[0]));
        return current;
      }

      // consume-key script: simulate atomic DEL
      if (script.includes('DEL')) {
        const key = keys[0];
        if (redisStore.has(key)) {
          redisStore.delete(key);
          return 1;
        }
        return 0;
      }

      throw new Error(`MockRedis.eval: unrecognised script:\n${script}`);
    }
    async scan(_cursor: string, _match: string, pattern: string) {
      const prefix = pattern.replace('*', '');
      const keys = Array.from(redisStore.keys()).filter((k) => k.startsWith(prefix));
      return ['0', keys];
    }
    async ping() { return 'PONG'; }
    // Used by the rate-limit-redis sendCommand bridge
    async call(_command: string, ..._args: string[]) { return 'OK'; }
    disconnect() { return Promise.resolve(); }
    on() { return this; }
  }
  return { default: MockRedis };
});

// Mock pg
const mockQuery = vi.fn();
const mockClientQuery = vi.fn();

vi.mock('pg', () => {
  class Pool {
    query = mockQuery;
    async connect() {
      return { query: mockClientQuery, release: vi.fn() };
    }
    on() {}
  }
  return { Pool };
});

// Expose mocks so tests can use them
(globalThis as Record<string, unknown>).__mockPoolQuery = mockQuery;
(globalThis as Record<string, unknown>).__mockClientQuery = mockClientQuery;
(globalThis as Record<string, unknown>).__mockRedisExpireCalls = redisExpireCalls;
(globalThis as Record<string, unknown>).__mockRedisTtls = redisTtls;
// Redis state is module-level and deliberately survives across tests in a file
// (durable OTP locks must outlive a single request), so suites use distinct
// subjects — or `redis.del(key)` in beforeEach when they must share one.

// Mock nodemailer
vi.mock('nodemailer', () => {
  const sendMail = vi.fn().mockResolvedValue({ messageId: 'test-msg-id' });
  return {
    default: {
      createTransport: vi.fn().mockReturnValue({ sendMail }),
    },
    createTransport: vi.fn().mockReturnValue({ sendMail }),
  };
});
