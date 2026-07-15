import dotenv from 'dotenv';
import path from 'path';
import { z } from 'zod';

// Load .env.local first so its values take precedence over .env. Production
// ships only .env (no .env.local), so behaviour there is unchanged.
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

// ---------------------------------------------------------------------------
// WG_SERVER_ENDPOINT validation
// ---------------------------------------------------------------------------
//
// Accepted forms:
//   • DNS hostname (RFC-1123 labels)           e.g. wg.wa-sel.com
//   • IPv4 dotted quad                         e.g. 76.13.59.23
//   • Bracketed IPv6                           e.g. [2001:db8::1]
//   • Any of the above followed by :<port>     e.g. wg.wa-sel.com:51820
//
// A bare host is allowed because `parseEndpoint` in wireguardConfig.ts
// defaults the port to 51820 when absent, and every caller appends
// WG_SERVER_PORT separately when building the router setup script.
// Using a DNS hostname (rather than a raw IP) lets the whole router fleet
// be repointed at a new VPS by editing one DNS record.

function isValidPortNumber(portStr: string | undefined): boolean {
  if (portStr === undefined) return true; // omitted is OK — defaults to 51820
  if (!/^\d+$/.test(portStr)) return false;
  const p = parseInt(portStr, 10);
  return p >= 1 && p <= 65535;
}

function isValidIpv4(host: string): boolean {
  const octets = host.split('.');
  if (octets.length !== 4) return false;
  return octets.every(
    (o) => /^\d{1,3}$/.test(o) && parseInt(o, 10) >= 0 && parseInt(o, 10) <= 255,
  );
}

function isValidIpv6Inside(inside: string): boolean {
  // Coarse check for the contents of the brackets: only hex, colons, dots
  // (for embedded IPv4 tail) and at least one colon. Full RFC-4291 compliance
  // is left to the OS resolver; we just want to reject obvious typos.
  return /^[0-9a-fA-F:.]+$/.test(inside) && inside.includes(':');
}

function isValidHostname(host: string): boolean {
  // RFC-1123 style: dot-separated labels, each 1–63 alphanumerics or hyphens,
  // no leading/trailing hyphen. Total length capped at 253.
  if (host.length === 0 || host.length > 253) return false;
  const labelRe = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/;
  return host.split('.').every((label) => labelRe.test(label));
}

function isValidWgServerEndpoint(value: string): boolean {
  // Bracketed IPv6, optionally with :<port>.
  const bracketed = value.match(/^\[([^\]]+)\](?::(\d+))?$/);
  if (bracketed) {
    return isValidIpv6Inside(bracketed[1]) && isValidPortNumber(bracketed[2]);
  }

  // If more than one colon appears without brackets, this is an unbracketed
  // IPv6 — the router endpoint-address field on Mikrotik requires brackets
  // when a port is present anyway, so reject to force the correct form.
  const firstColon = value.indexOf(':');
  const lastColon = value.lastIndexOf(':');
  if (firstColon !== -1 && firstColon !== lastColon) return false;

  let host: string;
  let portStr: string | undefined;
  if (lastColon === -1) {
    host = value;
  } else {
    host = value.substring(0, lastColon);
    portStr = value.substring(lastColon + 1);
  }

  if (!isValidPortNumber(portStr)) return false;
  return isValidIpv4(host) || isValidHostname(host);
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),

  // PostgreSQL
  DB_HOST: z.string().default('localhost'),
  DB_PORT: z.coerce.number().default(5432),
  DB_NAME: z.string().default('wasel'),
  DB_USER: z.string().default('wasel'),
  DB_PASSWORD: z.string().min(1, 'DB_PASSWORD must be set in .env'),
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
  // Hostname / IPv4 / [IPv6], optionally with :<port>. Prefer a DNS hostname
  // (e.g. wg.wa-sel.com) so the fleet can be repointed via a single DNS
  // change instead of touching every router.
  WG_SERVER_ENDPOINT: z
    .string()
    .min(1)
    .refine(isValidWgServerEndpoint, {
      message:
        'WG_SERVER_ENDPOINT must be a DNS hostname, IPv4, or bracketed IPv6, optionally followed by ":<port>" (1-65535). Example: wg.wa-sel.com or 76.13.59.23:51820',
    }),
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

  // Sentry (error tracking) — optional; all Sentry code is a no-op when unset.
  SENTRY_DSN: z.string().url().optional(),

  // Public base URL — used for callback URLs embedded in router setup scripts.
  // Must be reachable from the router over the internet (not the tunnel).
  // Example: https://api.wasel.app
  PUBLIC_BASE_URL: z.string().url().default('http://localhost:3000'),
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
