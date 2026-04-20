import rateLimit from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { redis } from '../config/redis';
import logger from '../config/logger';

const skipInTest = () => process.env.NODE_ENV === 'test';

/**
 * Bridge between rate-limit-redis and ioredis.
 * The store calls sendCommand(...args) where args[0] is the command name.
 * On any error we log and re-throw so the limiter fails open (express-rate-limit
 * treats store errors as "allow" when the store rejects).
 */
function makeRedisSendCommand(prefix: string) {
  return async (...args: string[]): Promise<string | number | boolean | (string | number | boolean)[]> => {
    try {
      // ioredis: redis.call(command, ...rest)
      const [command, ...rest] = args;
      const result = await (redis as unknown as { call: (...a: string[]) => Promise<unknown> }).call(command, ...rest);
      return result as string | number | boolean | (string | number | boolean)[];
    } catch (err) {
      logger.warn('Rate-limit Redis store error — failing open', {
        prefix,
        error: (err as Error).message,
      });
      throw err; // express-rate-limit treats store rejection as "skip"
    }
  };
}

function makeStore(prefix: string): RedisStore {
  return new RedisStore({
    prefix,
    sendCommand: makeRedisSendCommand(prefix),
  });
}

export const generalLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
  store: makeStore('rl:general:'),
  message: {
    success: false,
    error: { message: 'Too many requests, please try again later.', code: 'RATE_LIMIT_EXCEEDED' },
  },
});

export const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
  store: makeStore('rl:auth:'),
  message: {
    success: false,
    error: { message: 'Too many auth attempts, please try again later.', code: 'AUTH_RATE_LIMIT_EXCEEDED' },
  },
});
