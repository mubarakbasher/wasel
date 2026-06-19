import { vi } from 'vitest';

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

vi.mock('ioredis', () => {
  class MockRedis {
    async set(key: string, value: string, _mode?: string, _ttl?: number) {
      redisStore.set(key, value);
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
    async expire(_key: string, _ttl: number) {
      return 1; // always succeeds in tests
    }
    // Atomic Lua dispatch: branch on script content so each script gets correct semantics.
    // Consume script (contains 'DEL'): delete from redisStore, return 1 if existed else 0.
    // INCR+EXPIRE script: increment redisCounters and return the new count.
    async eval(script: string, _numkeys: number, key: string, _ttl?: string) {
      if (script.includes('DEL')) {
        // consume-key script: simulate atomic DEL
        if (redisStore.has(key)) {
          redisStore.delete(key);
          return 1;
        }
        return 0;
      }
      // INCR+EXPIRE script
      const current = (redisCounters.get(key) ?? 0) + 1;
      redisCounters.set(key, current);
      return current;
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
