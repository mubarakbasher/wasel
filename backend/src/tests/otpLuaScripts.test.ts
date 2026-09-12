/**
 * Pins the SCRIPT TEXT of the two OTP Lua scripts.
 *
 * Why this file exists: every other suite runs against the MockRedis in
 * setup.ts, which re-implements both scripts in JavaScript. The mock is what
 * gets executed, so the real Lua is effectively dead code under test — an ARGV
 * reorder, a `>` where `>=` belongs, an EXPIRE moved out of the `count == 1`
 * guard, or a `return {'OK', stored}` left in the raw branch would all keep the
 * whole suite green while shipping broken enforcement to a real Redis.
 *
 * So these assertions are deliberately structural and literal: they pin exactly
 * the shape the mock assumes. If you change the Lua on purpose, change the mock
 * in setup.ts and these assertions together — that coupling is the point.
 * The behavioural counterpart runs the real scripts against a real Redis in
 * otpLua.integration.test.ts (opt-in).
 */
import { describe, it, expect, vi } from 'vitest';
import { redis } from '../config/redis';
import * as tokenService from '../services/token.service';
import { OTP_LUA_SCRIPTS } from '../services/token.service';

const VALIDATE = OTP_LUA_SCRIPTS.validate;
const WINDOW = OTP_LUA_SCRIPTS.incrFixedWindow;

/** Script body as trimmed lines — the Lua is one statement per line by design. */
function lines(script: string): string[] {
  return script.split('\n').map((line) => line.trim());
}

const validateLines = lines(VALIDATE);
const windowLines = lines(WINDOW);

describe('LUA_OTP_VALIDATE — script text', () => {
  it('starts with the -- otp-validate marker the mock dispatches on', () => {
    // MockRedis.eval branches on `script.startsWith('-- otp-validate')`; lose the
    // marker and the mock falls through to the consume-key branch (which matches
    // on 'DEL') and silently answers every OTP check with a bare 1/0.
    expect(VALIDATE.startsWith('-- otp-validate')).toBe(true);
  });

  it('makes the lock check its very first redis.call', () => {
    // Checking the lock anywhere but first would let a locked-out subject still
    // burn a comparison against the live code.
    const firstCall = VALIDATE.slice(VALIDATE.indexOf('redis.call('));
    expect(firstCall.startsWith("redis.call('EXISTS', KEYS[3])")).toBe(true);
  });

  it('compares SHA-1 digests, not the raw strings', () => {
    // Plain `code == ARGV[1]` in Lua is a length-then-memcmp on the secret
    // itself; over two 40-char hex digests an early exit leaks nothing usable.
    expect(validateLines).toContain(
      'if redis.sha1hex(code) == redis.sha1hex(ARGV[1]) then',
    );
  });

  it('DELs both the code and the attempts counter on the OK branch', () => {
    const cmpIdx = validateLines.indexOf(
      'if redis.sha1hex(code) == redis.sha1hex(ARGV[1]) then',
    );
    expect(cmpIdx).toBeGreaterThan(-1);
    // Consuming the code is what makes an OTP single-use; clearing the counter
    // is what gives the next code a fresh budget.
    expect(validateLines[cmpIdx + 1]).toBe("redis.call('DEL', KEYS[1])");
    expect(validateLines[cmpIdx + 2]).toBe("redis.call('DEL', KEYS[2])");
  });

  it('echoes the stored payload back only in json mode', () => {
    const cmpIdx = validateLines.indexOf(
      'if redis.sha1hex(code) == redis.sha1hex(ARGV[1]) then',
    );
    // In raw mode the stored value IS the plaintext OTP, so the reply must be a
    // bare {'OK'} — a live code must never ride back out on an eval reply.
    expect(validateLines[cmpIdx + 3]).toBe(
      "if ARGV[2] == 'json' then return {'OK', stored} end",
    );
    expect(validateLines[cmpIdx + 4]).toBe("return {'OK'}");
  });

  it('INCRs the attempts key then immediately re-EXPIREs it on a wrong guess', () => {
    const incrIdx = validateLines.indexOf("local n = redis.call('INCR', KEYS[2])");
    expect(incrIdx).toBeGreaterThan(-1);
    // Sliding on purpose (see the LUA_OTP_VALIDATE header): without the re-arm a
    // patient attacker drips 4 guesses per TTL forever and never trips the lock.
    expect(validateLines[incrIdx + 1]).toBe("redis.call('EXPIRE', KEYS[2], ARGV[4])");
  });

  it('arms the lock with SET ... EX ARGV[5] under an n >= maxAttempts guard', () => {
    const guardIdx = validateLines.indexOf('if n >= tonumber(ARGV[3]) then');
    // `>` instead of `>=` silently grants a 6th guess on a 5-guess budget.
    expect(guardIdx).toBeGreaterThan(-1);
    const lockIdx = validateLines.indexOf(
      "redis.call('SET', KEYS[3], '1', 'EX', ARGV[5])",
    );
    expect(lockIdx).toBeGreaterThan(guardIdx);
    // The lock TTL is the last ARGV so the risky knob is always the final one;
    // an ARGV reorder here would arm a 5-second (maxAttempts) lockout.
    expect(lockIdx).toBeLessThan(validateLines.indexOf("return {'LOCKED'}", guardIdx));
  });
});

describe('LUA_INCR_FIXED_WINDOW — script text', () => {
  it('starts with the -- incr-fixed-window marker the mock dispatches on', () => {
    expect(WINDOW.startsWith('-- incr-fixed-window')).toBe(true);
  });

  it('EXPIREs the counter only when it was just created', () => {
    expect(windowLines).toContain("local count = redis.call('INCR', KEYS[1])");
    expect(windowLines).toContain(
      "if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end",
    );
    // The ONLY EXPIRE in the script, and it is inside the count == 1 guard.
    // Unguarded, every refused over-cap call would push the window out and a
    // single request per hour would keep a victim's send budget at zero (M-A).
    const expireLines = windowLines.filter((line) => line.includes('EXPIRE'));
    expect(expireLines).toHaveLength(1);
    expect(expireLines[0]).toContain('count == 1');
  });
});

describe('OTP Lua call sites — key/ARGV arity', () => {
  it('validate is always invoked with exactly 3 keys and 5 ARGV', async () => {
    const evalSpy = vi.spyOn(redis, 'eval');

    // No code seeded -> NOCODE -> false. The call shape is what is under test.
    await expect(
      tokenService.validateVerificationOtp('lua-arity-user', '000000'),
    ).resolves.toBe(false);

    const call = evalSpy.mock.calls.find(
      (c) => typeof c[0] === 'string' && (c[0] as string).startsWith('-- otp-validate'),
    );
    expect(call).toBeDefined();
    const [script, numkeys, ...rest] = call as [string, number, ...string[]];
    expect(script).toBe(OTP_LUA_SCRIPTS.validate);
    expect(numkeys).toBe(3);
    // 3 keys + 5 ARGV. A missing trailing arg makes ARGV[5] nil and Redis then
    // rejects SET ... EX nil at lock time — i.e. the lockout silently stops
    // arming, which no mock-backed test would notice.
    expect(rest).toHaveLength(8);
    expect(rest.slice(0, 3)).toEqual([
      'otp:verify:lua-arity-user',
      'otp-attempts:lua-arity-user:verify',
      'otp-lock:lua-arity-user:verify',
    ]);
    expect(rest.slice(3)).toEqual(['000000', 'raw', '5', '3600', '900']);

    evalSpy.mockRestore();
  });

  it('the send-cap window is always invoked with exactly 1 key and 1 ARGV', async () => {
    const evalSpy = vi.spyOn(redis, 'eval');

    await expect(
      tokenService.enforceOtpSendCap('reset', 'lua-arity-subject@example.com'),
    ).resolves.toBeUndefined();

    const call = evalSpy.mock.calls.find(
      (c) =>
        typeof c[0] === 'string' && (c[0] as string).startsWith('-- incr-fixed-window'),
    );
    expect(call).toBeDefined();
    const [script, numkeys, ...rest] = call as [string, number, ...string[]];
    expect(script).toBe(OTP_LUA_SCRIPTS.incrFixedWindow);
    expect(numkeys).toBe(1);
    expect(rest).toEqual(['otp-send:lua-arity-subject@example.com:reset', '3600']);

    evalSpy.mockRestore();
  });
});
