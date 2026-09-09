/**
 * OTP Atomic Validation + Durable Lockout Test
 *
 * Pins the fix for the read-then-count race (H1-R): validation is ONE Lua
 * script, so the lock check, the code read, the comparison and the attempt
 * counter can no longer be interleaved by concurrent requests. A burst of 20
 * guesses must therefore burn at most OTP_MAX_ATTEMPTS (5) comparisons against
 * the live code — not 20.
 *
 * Also pins the DURABILITY of the lockout: it is stored under its own key with
 * its own TTL, so re-issuing an OTP no longer buys a fresh batch of guesses.
 */
import { describe, it, expect } from 'vitest';
import * as tokenService from '../services/token.service';

const mockRedisExpireCalls = (globalThis as Record<string, unknown>)
  .__mockRedisExpireCalls as Map<string, number>;

// The mock Redis in setup.ts keeps module-level state for the whole file, and
// the lockout now OUTLIVES a new OTP — so each test uses its own address
// instead of sharing one seeded in beforeEach.

describe('OTP atomic race — lockout at attempt 5', () => {
  it('burns at most OTP_MAX_ATTEMPTS comparisons under a 20-guess burst', async () => {
    const email = 'otp-race-concurrent@example.com';
    const correctOtp = await tokenService.createPasswordResetOtp(email);
    const wrongOtp = '000000'; // guaranteed wrong

    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        tokenService.validatePasswordResetOtp(email, wrongOtp).catch((err: Error) => err),
      ),
    );

    // Count how many returned false (wrong but not yet locked) vs threw 429
    const falseCount = results.filter((r) => r === false).length;
    const lockedCount = results.filter(
      (r) => r instanceof Error && r.message.includes('Too many wrong codes'),
    ).length;

    // No attempt ever succeeded, and every one is accounted for.
    expect(falseCount + lockedCount).toBe(20);
    expect(lockedCount).toBeGreaterThanOrEqual(1);

    // THE race assertion: the guess budget is 5, not 5-per-inflight-batch.
    // Before the atomic script, all 20 passed the lock check and read the live
    // code before any INCR armed the lock, so one code absorbed 20 guesses.
    expect(falseCount).toBeLessThanOrEqual(5);
    expect(lockedCount).toBeGreaterThanOrEqual(15);

    // Every comparison against the live code INCRs+EXPIREs the attempts key,
    // so the TTL-arm count is an exact tally of how many guesses were compared.
    // Locked-out callers short-circuit before the INCR and never add to it.
    expect(mockRedisExpireCalls.get(`otp-attempts:${email}:reset`) ?? 0).toBeLessThanOrEqual(5);

    // The CORRECT code is worthless while the lock stands.
    await expect(tokenService.validatePasswordResetOtp(email, correctOtp)).rejects.toMatchObject({
      statusCode: 429,
      code: 'OTP_LOCKED',
    });
  });

  it('should keep refusing a freshly issued OTP while the lockout stands', async () => {
    const email = 'otp-race-fresh@example.com';
    await tokenService.createPasswordResetOtp(email);

    // Exhaust attempts (4 wrong ones, still under the threshold)
    const wrongOtp = '000000';
    for (let i = 0; i < 4; i++) {
      await tokenService.validatePasswordResetOtp(email, wrongOtp).catch(() => null);
    }
    // 5th attempt triggers lockout
    let lockoutFired = false;
    try {
      await tokenService.validatePasswordResetOtp(email, wrongOtp);
    } catch {
      lockoutFired = true;
    }
    expect(lockoutFired).toBe(true);

    // Issue a new OTP. That resets the ATTEMPT COUNTER but must NOT lift the
    // lock — otherwise "5 guesses -> resend -> 5 fresh guesses" loops forever
    // and the 6-digit code is brute-forceable.
    const newOtp = await tokenService.createPasswordResetOtp(email);

    await expect(tokenService.validatePasswordResetOtp(email, newOtp)).rejects.toMatchObject({
      statusCode: 429,
      code: 'OTP_LOCKED',
    });
  });

  it('does not count guesses made when no code is live', async () => {
    const email = 'otp-race-nocode@example.com';

    // 10 guesses with nothing seeded: a flow with no live code must not be
    // lockable, or an attacker could keep any account's reset permanently
    // denied with junk guesses (M-A, denial half).
    for (let i = 0; i < 10; i++) {
      await expect(tokenService.validatePasswordResetOtp(email, '000000')).resolves.toBe(false);
    }
    expect(mockRedisExpireCalls.get(`otp-attempts:${email}:reset`) ?? 0).toBe(0);

    // The flow still works afterwards.
    const otp = await tokenService.createPasswordResetOtp(email);
    await expect(tokenService.validatePasswordResetOtp(email, otp)).resolves.toBe(true);
  });
});
