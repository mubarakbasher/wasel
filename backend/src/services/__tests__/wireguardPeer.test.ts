import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock child_process.execFile BEFORE importing the module so wireguardPeer
// never shells out to a real `wg` binary during tests.
// ---------------------------------------------------------------------------
const { mockExecFile, mockWriteFile, mockUnlink } = vi.hoisted(() => ({
  mockExecFile: vi.fn((_cmd: string, _args: string[], cb: (err: Error | null, out?: { stdout: string; stderr: string }) => void) => {
    cb(null, { stdout: '', stderr: '' });
  }),
  mockWriteFile: vi.fn().mockResolvedValue(undefined),
  mockUnlink: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('child_process', () => ({ execFile: mockExecFile }));
vi.mock('fs/promises', () => ({ writeFile: mockWriteFile, unlink: mockUnlink }));

import { resetPeer } from '../wireguardPeer';

// 44-char base64 WireGuard keys. The 43rd char must be in [AEIMQUYcgkosw480].
const VALID_PUBKEY_1 = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
const VALID_PUBKEY_2 = 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBE=';
const VALID_PSK      = 'CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCI=';

beforeEach(() => {
  vi.clearAllMocks();
  // Reset the default execFile behaviour each test.
  mockExecFile.mockImplementation((_cmd, _args, cb) => cb(null, { stdout: '', stderr: '' }));
  mockWriteFile.mockResolvedValue(undefined);
  mockUnlink.mockResolvedValue(undefined);
});

describe('resetPeer input validation', () => {
  it('valid key + "(none)" PSK → performs remove then add (no PSK file written)', async () => {
    await resetPeer({
      publicKey: VALID_PUBKEY_1,
      allowedIps: '10.10.0.2/32',
      presharedKey: '(none)',
    });

    // Two wg invocations: `wg set wg0 peer <pk> remove` then `wg set wg0 peer <pk> allowed-ips 10.10.0.2/32`.
    expect(mockExecFile).toHaveBeenCalledTimes(2);
    const removeCall = mockExecFile.mock.calls[0];
    const addCall = mockExecFile.mock.calls[1];
    expect(removeCall[0]).toBe('wg');
    expect(removeCall[1]).toEqual(['set', 'wg0', 'peer', VALID_PUBKEY_1, 'remove']);
    expect(addCall[0]).toBe('wg');
    expect(addCall[1]).toEqual(['set', 'wg0', 'peer', VALID_PUBKEY_1, 'allowed-ips', '10.10.0.2/32']);

    // PSK is "(none)" → no temp file written and no --preshared-key arg appended.
    expect(mockWriteFile).not.toHaveBeenCalled();
    expect(addCall[1]).not.toContain('preshared-key');
  });

  it('valid key + valid PSK → PSK temp file is created with flag:wx mode:0o600 and cleaned up', async () => {
    await resetPeer({
      publicKey: VALID_PUBKEY_2,
      allowedIps: '10.10.0.6/32',
      presharedKey: VALID_PSK,
    });

    expect(mockWriteFile).toHaveBeenCalledTimes(1);
    const [, pskValue, writeOpts] = mockWriteFile.mock.calls[0];
    expect(pskValue).toBe(VALID_PSK);
    expect(writeOpts).toEqual({ flag: 'wx', mode: 0o600 });

    // Temp file is unlinked in finally.
    expect(mockUnlink).toHaveBeenCalledTimes(1);
  });

  it('malformed public key → no wg call, no PSK file, warn-and-return', async () => {
    await resetPeer({
      publicKey: 'not-a-real-wireguard-key',
      allowedIps: '10.10.0.2/32',
      presharedKey: '(none)',
    });

    expect(mockExecFile).not.toHaveBeenCalled();
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it('malformed preshared key → no wg call, no PSK file, warn-and-return', async () => {
    await resetPeer({
      publicKey: VALID_PUBKEY_1,
      allowedIps: '10.10.0.2/32',
      presharedKey: 'definitely-not-base64-and-wrong-length',
    });

    expect(mockExecFile).not.toHaveBeenCalled();
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it('allowed-ips outside the 10.10.0.0/16 pool → no wg call (pre-existing guard)', async () => {
    await resetPeer({
      publicKey: VALID_PUBKEY_1,
      allowedIps: '192.168.1.1/32',
      presharedKey: '(none)',
    });

    expect(mockExecFile).not.toHaveBeenCalled();
  });
});
