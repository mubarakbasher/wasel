import crypto from 'crypto';

/**
 * Generate a WireGuard-compatible X25519 key pair.
 *
 * WireGuard keys are raw 32-byte Curve25519 keys encoded as base64.
 * Node.js crypto generates them in SPKI/PKCS8 DER containers, so we
 * extract the trailing 32 bytes which hold the actual key material.
 *
 * @returns Object with base64-encoded privateKey and publicKey (44 chars each)
 */
export function generateKeyPair(): { privateKey: string; publicKey: string } {
  const keyPair = crypto.generateKeyPairSync('x25519', {
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'der' },
  });

  // X25519 SPKI DER is 44 bytes: 12-byte header + 32-byte raw public key
  const publicKey = keyPair.publicKey.subarray(-32).toString('base64');
  // X25519 PKCS8 DER is 48 bytes: 16-byte header + 32-byte raw private key
  const privateKey = keyPair.privateKey.subarray(-32).toString('base64');

  return { privateKey, publicKey };
}

/**
 * Generate a random 256-bit preshared key for additional WireGuard tunnel security.
 *
 * WireGuard preshared keys are 32 random bytes encoded as base64, used as an
 * optional symmetric key mixed into the handshake for post-quantum resistance.
 *
 * @returns Base64-encoded 32-byte preshared key
 */
export function generatePresharedKey(): string {
  return crypto.randomBytes(32).toString('base64');
}
