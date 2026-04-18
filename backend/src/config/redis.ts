import Redis from 'ioredis';
import { config } from './index';
import logger from './logger';

// IMPORTANT: auth/OTP flows (JWT storage, OTP rate-limit) hard-depend on Redis.
// The service intentionally fails closed rather than degrading gracefully —
// a Redis outage will block logins rather than silently bypass security checks.
export const redis = new Redis({
  host: config.REDIS_HOST,
  port: config.REDIS_PORT,
  password: config.REDIS_PASSWORD || undefined,
  retryStrategy(times) {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
});

redis.on('connect', () => {
  logger.info('Redis connected successfully');
});

redis.on('error', (err) => {
  logger.error('Redis connection error', { error: err.message });
});
