import crypto from 'crypto';
import { config } from '../config';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

/**
 * Get the encryption key as a Buffer from the hex-encoded env variable.
 * Must be exactly 32 bytes (64 hex characters).
 */
function getEncryptionKey(): Buffer {
  const keyHex = config.ENCRYPTION_KEY;
  const keyBuffer = Buffer.from(keyHex, 'hex');

  if (keyBuffer.length !== 32) {
    throw new Error(
      `ENCRYPTION_KEY must be exactly 32 bytes (64 hex chars), got ${keyBuffer.length} bytes`
    );
  }

  return keyBuffer;
}

/**
 * Encrypt plaintext using AES-256-GCM.
 *
 * @param plaintext - The string to encrypt
 * @returns Encrypted string in "iv:tag:ciphertext" format (all hex-encoded)
 */
export function encrypt(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypt a string produced by encrypt().
 *
 * @param encrypted - Encrypted string in "iv:tag:ciphertext" format (hex-encoded)
 * @returns The original plaintext
 * @throws Error if the data is tampered with or the key is wrong
 */
export function decrypt(encrypted: string): string {
  const key = getEncryptionKey();
  const parts = encrypted.split(':');

  if (parts.length !== 3) {
    throw new Error('Invalid encrypted data format — expected "iv:tag:ciphertext"');
  }

  const iv = Buffer.from(parts[0], 'hex');
  const tag = Buffer.from(parts[1], 'hex');
  const ciphertext = Buffer.from(parts[2], 'hex');

  if (iv.length !== IV_LENGTH) {
    throw new Error(`Invalid IV length: expected ${IV_LENGTH}, got ${iv.length}`);
  }
  if (tag.length !== TAG_LENGTH) {
    throw new Error(`Invalid auth tag length: expected ${TAG_LENGTH}, got ${tag.length}`);
  }

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return decrypted.toString('utf8');
}

/**
 * Generate a random RADIUS shared secret.
 *
 * Produces a 32-character alphanumeric string suitable for use as a
 * RADIUS shared secret between a router and the FreeRADIUS server.
 *
 * @returns 32-character alphanumeric secret
 */
export function generateRadiusSecret(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.randomBytes(32);
  let secret = '';

  for (let i = 0; i < 32; i++) {
    secret += chars[bytes[i] % chars.length];
  }

  return secret;
}

/**
 * Generate a unique NAS identifier for a router.
 *
 * Combines a sanitized router name with a short UUID suffix to ensure
 * uniqueness across all routers.
 *
 * @param routerName - Human-readable router name
 * @param routerId - UUID of the router
 * @returns NAS identifier string (e.g., "my-router_a1b2c3d4")
 */
export function generateNasIdentifier(routerName: string, routerId: string): string {
  // Sanitize router name: lowercase, replace non-alphanumeric with hyphens, trim
  const sanitized = routerName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 32);

  // Use first 8 chars of UUID (without hyphens) as suffix
  const suffix = routerId.replace(/-/g, '').substring(0, 8);

  return `${sanitized}_${suffix}`;
}
