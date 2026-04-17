import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),

  // PostgreSQL
  DB_HOST: z.string().default('localhost'),
  DB_PORT: z.coerce.number().default(5432),
  DB_NAME: z.string().default('wasel'),
  DB_USER: z.string().default('wasel'),
  DB_PASSWORD: z.string().default('changeme'),
  DB_POOL_MIN: z.coerce.number().default(2),
  DB_POOL_MAX: z.coerce.number().default(10),

  // Redis
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().default(6379),
  REDIS_PASSWORD: z.string().optional(),

  // JWT
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),

  // Encryption
  ENCRYPTION_KEY: z.string().regex(/^[0-9a-f]{64}$/i, 'ENCRYPTION_KEY must be 64 hex characters (32 bytes)'),

  // CORS
  CORS_ORIGIN: z.string().default('*'),

  // WireGuard
  WG_SERVER_PRIVATE_KEY: z.string().min(1),
  WG_SERVER_PUBLIC_KEY: z.string().min(1),
  WG_SERVER_ENDPOINT: z.string().min(1),
  WG_SERVER_PORT: z.coerce.number().default(51820),

  // SMTP (Email)
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().default('noreply@wasel.app'),

  // FreeRADIUS
  RADIUS_HOST: z.string().default('localhost'),
  RADIUS_AUTH_PORT: z.coerce.number().default(1812),
  RADIUS_ACCT_PORT: z.coerce.number().default(1813),
  RADIUS_COA_PORT: z.coerce.number().default(3799),

  // Firebase (Push Notifications)
  FIREBASE_SERVICE_ACCOUNT_PATH: z.string().optional(),
});

// Guard against wildcard CORS before we even parse — a misconfigured '*' with
// credentials:true silently breaks, and more importantly allows any origin to
// hit authenticated endpoints. Fail loudly at boot so ops must set it explicitly.
const rawCorsOrigin = process.env.CORS_ORIGIN ?? '';
const corsOrigins = rawCorsOrigin.split(',').map((s) => s.trim()).filter(Boolean);
if (rawCorsOrigin.trim() === '*' || corsOrigins.includes('*')) {
  console.error(
    'Invalid CORS_ORIGIN: wildcard "*" is not permitted. Set CORS_ORIGIN to an explicit comma-separated list of allowed origins.',
  );
  process.exit(1);
}

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;
