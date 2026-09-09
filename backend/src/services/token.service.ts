import jwt, { JwtPayload, SignOptions } from 'jsonwebtoken';
import crypto from 'crypto';
import { config } from '../config';
import { redis } from '../config/redis';
import logger from '../config/logger';
import { AppError } from '../middleware/errorHandler';

const REFRESH_PREFIX = 'refresh';
const OTP_VERIFY_PREFIX = 'otp:verify';
const OTP_RESET_PREFIX = 'otp:reset';
const OTP_EMAIL_CHANGE_PREFIX = 'otp:email-change';
const OTP_ATTEMPTS_PREFIX = 'otp-attempts';
const OTP_LOCK_PREFIX = 'otp-lock';
const OTP_SEND_PREFIX = 'otp-send';

const REFRESH_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
const OTP_VERIFY_TTL_SECONDS = 24 * 60 * 60;  // 24 hours
const OTP_RESET_TTL_SECONDS = 15 * 60;         // 15 minutes
export const OTP_EMAIL_CHANGE_TTL_SECONDS = 3600; // 1 hour
const OTP_ATTEMPTS_TTL_SECONDS = 60 * 60;      // 1 hour
const OTP_MAX_ATTEMPTS = 5;
const OTP_LOCK_SECONDS = 15 * 60;              // 15 minutes
const OTP_SEND_WINDOW_SECONDS = 60 * 60;       // 1 hour
// Per-email (not per-IP) on purpose so IP rotation cannot turn resends into
// mail bombing; the accepted trade-off is that a hostile party who knows an
// email can exhaust its resend budget — the first code from `register` is
// unaffected.
const OTP_MAX_SENDS_PER_HOUR = 5;

/** The three OTP-backed auth flows that share the attempts/lock/send-cap machinery. */
export type OtpFlow = 'verify' | 'reset' | 'email-change';

export interface AccessTokenPayload {
  userId: string;
  email: string;
  name: string;
  role: string;
}

export interface RefreshTokenPayload {
  userId: string;
  jti: string;
}

export function generateAccessToken(payload: AccessTokenPayload): string {
  const opts: SignOptions = { expiresIn: config.JWT_ACCESS_EXPIRES_IN as `${number}${'s' | 'm' | 'h' | 'd'}` };
  return jwt.sign(payload, config.JWT_ACCESS_SECRET, opts);
}

export function generateRefreshToken(userId: string): { token: string; jti: string } {
  const jti = crypto.randomUUID();
  const opts: SignOptions = { expiresIn: config.JWT_REFRESH_EXPIRES_IN as `${number}${'s' | 'm' | 'h' | 'd'}` };
  const token = jwt.sign({ userId, jti }, config.JWT_REFRESH_SECRET, opts);
  return { token, jti };
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, config.JWT_ACCESS_SECRET) as AccessTokenPayload & JwtPayload;
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  return jwt.verify(token, config.JWT_REFRESH_SECRET) as RefreshTokenPayload & JwtPayload;
}

export async function storeRefreshToken(userId: string, jti: string): Promise<void> {
  const key = `${REFRESH_PREFIX}:${userId}:${jti}`;
  await redis.set(key, '1', 'EX', REFRESH_TTL_SECONDS);
}

export async function revokeRefreshToken(userId: string, jti: string): Promise<void> {
  const key = `${REFRESH_PREFIX}:${userId}:${jti}`;
  await redis.del(key);
}

export async function revokeAllRefreshTokens(userId: string): Promise<void> {
  const pattern = `${REFRESH_PREFIX}:${userId}:*`;
  let cursor = '0';
  do {
    const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
    cursor = nextCursor;
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  } while (cursor !== '0');
  logger.info('Revoked all refresh tokens', { userId });
}

export async function issueTokenPair(
  userId: string,
  email: string,
  name: string,
  role: string,
): Promise<{ accessToken: string; refreshToken: string }> {
  const accessToken = generateAccessToken({ userId, email, name, role });
  const { token: refreshToken, jti } = generateRefreshToken(userId);
  await storeRefreshToken(userId, jti);
  return { accessToken, refreshToken };
}

// --- OTP ---

function generateOtp(): string {
  return crypto.randomInt(100000, 999999).toString();
}

// Atomic consume: DEL the key and report whether THIS caller deleted it.
// Closes the rotation race (F4): two concurrent requests both observe the key,
// but only the one whose DEL returns 1 may issue a new token pair.
// Redis DEL already returns the count of keys removed (0 or 1), so no branch needed.
const LUA_CONSUME_KEY = `return redis.call('DEL', KEYS[1])`;

/**
 * Atomically consume (delete) a refresh-token key.
 * true  — this caller deleted it; may rotate.
 * false — already gone; reject as revoked/replayed.
 */
export async function consumeRefreshToken(userId: string, jti: string): Promise<boolean> {
  const key = `${REFRESH_PREFIX}:${userId}:${jti}`;
  const result = (await redis.eval(LUA_CONSUME_KEY, 1, key)) as number;
  return result === 1;
}

/**
 * The WHOLE of OTP validation in one round-trip: lock check, code read,
 * comparison, attempt counting and lockout. Splitting these across separate
 * commands is the read-then-count race (H1-R): N concurrent guesses all clear
 * the lock check and all read the live code before the first INCR arms the
 * lock, so one 6-digit code absorbs N guesses instead of OTP_MAX_ATTEMPTS.
 *
 * The comparison is SHA-1 digest equality computed inside Redis. That replaces
 * the old Node-side crypto.timingSafeEqual: Lua's string compare is a plain
 * memcmp, but it runs over two 40-char hex digests, and an early-exit on digest
 * bytes leaks nothing usable about the OTP that produced them (a guess cannot be
 * steered toward a target digest without inverting SHA-1). SHA-1 is used purely
 * as a comparison shim here, never as a stored credential hash.
 *
 * ARGV[2] is the payload mode: 'raw' when the key holds only the code, 'json'
 * when it holds { code, newEmail } (the email-change flow keeps that format so
 * a deploy does not invalidate in-flight change requests). The lock TTL stays
 * LAST so the risky knob is always the final argument.
 *
 * The stored payload is echoed back ONLY in 'json' mode, where the caller needs
 * the newEmail that rode along with the code. In 'raw' mode the value IS the
 * plaintext OTP, so the reply is a bare {'OK'} — an eval reply must never be
 * able to carry a live code back out of Redis (into logs, traces, or a slowlog).
 *
 * The attempts key is re-EXPIREd on EVERY wrong guess on purpose — a sliding
 * window there blocks the slow-drip bypass (4 guesses/hour forever). The send
 * cap in LUA_INCR_FIXED_WINDOW is a FIXED window on purpose, because a sliding
 * window there would let a refused caller pin the victim's budget at zero. The
 * two windows are deliberately opposite; do not "make them consistent".
 *
 * Returns: {'LOCKED'} | {'NOCODE'} | {'OK'} | {'OK', stored} (json) | {'WRONG'}
 */
const LUA_OTP_VALIDATE = `-- otp-validate
-- KEYS[1]=otpKey KEYS[2]=attemptsKey KEYS[3]=lockKey
-- ARGV[1]=provided ARGV[2]=payloadMode('raw'|'json') ARGV[3]=maxAttempts
-- ARGV[4]=attemptsTtl ARGV[5]=lockTtl
if redis.call('EXISTS', KEYS[3]) == 1 then return {'LOCKED'} end
local stored = redis.call('GET', KEYS[1])
if not stored then return {'NOCODE'} end
local code = stored
if ARGV[2] == 'json' then
  local ok, decoded = pcall(cjson.decode, stored)
  if not ok or type(decoded) ~= 'table' or type(decoded['code']) ~= 'string' then
    return {'NOCODE'}
  end
  code = decoded['code']
end
if redis.sha1hex(code) == redis.sha1hex(ARGV[1]) then
  redis.call('DEL', KEYS[1])
  redis.call('DEL', KEYS[2])
  if ARGV[2] == 'json' then return {'OK', stored} end
  return {'OK'}
end
local n = redis.call('INCR', KEYS[2])
redis.call('EXPIRE', KEYS[2], ARGV[4])
if n >= tonumber(ARGV[3]) then
  redis.call('DEL', KEYS[1])
  redis.call('DEL', KEYS[2])
  redis.call('SET', KEYS[3], '1', 'EX', ARGV[5])
  return {'LOCKED'}
end
return {'WRONG'}
`;

// Fixed-window counter: the TTL is armed ONLY when the counter is created.
// A sliding window (EXPIRE on every call) lets refused, over-cap calls keep the
// window alive, so one request per window denies the subject forever (M-A).
const LUA_INCR_FIXED_WINDOW = `-- incr-fixed-window
-- KEYS[1]=counterKey ARGV[1]=windowTtl
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return count
`;

/**
 * The exact Lua the service ships, exported so a test can pin the SCRIPT TEXT.
 * The suite runs against a MockRedis that re-implements these in JS, so without
 * a structural test an ARGV reorder or a `>`/`>=` slip inside the Lua would keep
 * every existing test green while shipping broken enforcement to Redis.
 */
export const OTP_LUA_SCRIPTS = Object.freeze({
  validate: LUA_OTP_VALIDATE,
  incrFixedWindow: LUA_INCR_FIXED_WINDOW,
});

type OtpValidateOutcome = 'LOCKED' | 'NOCODE' | 'WRONG' | 'OK';

/**
 * Run LUA_OTP_VALIDATE for one flow. `stored` is only present on 'OK' in 'json'
 * mode; a 'raw' OK reply is one element long precisely so a live plaintext OTP
 * can never travel back out of Redis in an eval reply.
 *
 * A guess made when NO code is live returns 'NOCODE' and is deliberately NOT
 * counted: counting it would let anyone pre-lock a stranger's verify/reset flow
 * with junk guesses (5 every 15 minutes = permanent denial).
 */
async function runOtpValidate(
  otpKey: string,
  flow: OtpFlow,
  subject: string,
  provided: string,
  payloadMode: 'raw' | 'json',
): Promise<{ outcome: OtpValidateOutcome; stored?: string }> {
  const result = (await redis.eval(
    LUA_OTP_VALIDATE,
    3,
    otpKey,
    `${OTP_ATTEMPTS_PREFIX}:${subject}:${flow}`,
    `${OTP_LOCK_PREFIX}:${subject}:${flow}`,
    provided,
    payloadMode,
    String(OTP_MAX_ATTEMPTS),
    String(OTP_ATTEMPTS_TTL_SECONDS),
    String(OTP_LOCK_SECONDS),
    // The second element exists only for {'OK', stored} in 'json' mode; every
    // other reply — including a 'raw' OK — is a one-element table, so `stored`
    // is undefined there and no plaintext OTP ever leaves Redis in a reply.
  )) as [OtpValidateOutcome, string?];
  return { outcome: result[0], stored: payloadMode === 'json' ? result[1] : undefined };
}

/**
 * Is (subject, flow) inside a wrong-code lockout window?
 *
 * The lock is what makes the guess budget finite. Lockout clears the attempts
 * key, and minting a fresh OTP clears it too, so without a separate durable lock
 * an attacker loops "5 guesses -> 429 -> resend -> 5 fresh guesses" forever: the
 * per-IP authLimiter does not bound a distributed attacker, and a hit on a
 * 6-digit code yields a 7-day session.
 *
 * Validation itself checks the lock INSIDE LUA_OTP_VALIDATE; this helper is for
 * the non-validating callers (resend) that must refuse before mailing a code.
 */
async function isOtpLocked(flow: OtpFlow, subject: string): Promise<boolean> {
  return (await redis.exists(`${OTP_LOCK_PREFIX}:${subject}:${flow}`)) === 1;
}

/** The single 429 every OTP flow raises while locked. */
function otpLockedError(): AppError {
  return new AppError(
    429,
    `Too many wrong codes. Please wait ${OTP_LOCK_SECONDS / 60} minutes and try again.`,
    'OTP_LOCKED',
  );
}

/** Throw 429 OTP_LOCKED when (subject, flow) is locked out. */
export async function assertOtpNotLocked(flow: OtpFlow, subject: string): Promise<void> {
  if (await isOtpLocked(flow, subject)) {
    throw otpLockedError();
  }
}

/**
 * Cap how many OTP emails one subject (normally the email address) can trigger
 * per hour, independently of the per-IP limiter. Without this, resend is a free
 * OTP-rotation oracle that refills the guess budget from any IP.
 *
 * Throws 429 EMAIL_RATE_LIMIT_EXCEEDED once the cap is exceeded.
 *
 * FIXED window, not sliding: a refused request must not push the window out, or
 * a single request per hour keeps the address's resend budget exhausted forever
 * and the victim can never get a code again.
 */
export async function enforceOtpSendCap(flow: OtpFlow, subject: string): Promise<void> {
  const key = `${OTP_SEND_PREFIX}:${subject}:${flow}`;
  const count = await redis.eval(LUA_INCR_FIXED_WINDOW, 1, key, String(OTP_SEND_WINDOW_SECONDS)) as number;
  if (count > OTP_MAX_SENDS_PER_HOUR) {
    throw new AppError(
      429,
      'Too many code requests. Please wait before requesting another.',
      'EMAIL_RATE_LIMIT_EXCEEDED',
    );
  }
}

/**
 * Reset the wrong-attempt COUNTER (never the lock) — on successful validation
 * and whenever a new OTP is minted, so a fresh code gets its own 5-try budget.
 */
async function clearOtpAttempts(flow: OtpFlow, subject: string): Promise<void> {
  await redis.del(`${OTP_ATTEMPTS_PREFIX}:${subject}:${flow}`);
}

// NOTE: there is deliberately no Node-side otpMatches/timingSafeEqual any more.
// Do not reintroduce one — the rationale (H1-R read-then-count, and why SHA-1
// digest equality inside Redis is the right comparison here) is in the
// LUA_OTP_VALIDATE header above.

export async function createVerificationOtp(userId: string): Promise<string> {
  const otp = generateOtp();
  const key = `${OTP_VERIFY_PREFIX}:${userId}`;
  await redis.set(key, otp, 'EX', OTP_VERIFY_TTL_SECONDS);
  // Attempt counter only — an active lock deliberately survives a re-issued
  // code, otherwise resending would buy a fresh batch of guesses.
  await clearOtpAttempts('verify', userId);
  return otp;
}

/**
 * Validate a verification OTP.
 * true — correct; the code is consumed. false — wrong or no live code.
 * Throws 429 OTP_LOCKED while the flow is locked out (the lock refuses the
 * CORRECT code too — that is the point).
 */
export async function validateVerificationOtp(userId: string, otp: string): Promise<boolean> {
  const key = `${OTP_VERIFY_PREFIX}:${userId}`;
  const { outcome } = await runOtpValidate(key, 'verify', userId, otp, 'raw');
  if (outcome === 'LOCKED') {
    throw otpLockedError();
  }
  return outcome === 'OK';
}

export async function createPasswordResetOtp(email: string): Promise<string> {
  const otp = generateOtp();
  const key = `${OTP_RESET_PREFIX}:${email}`;
  await redis.set(key, otp, 'EX', OTP_RESET_TTL_SECONDS);
  await clearOtpAttempts('reset', email.toLowerCase());
  return otp;
}

/** Same contract as validateVerificationOtp, keyed on the email address. */
export async function validatePasswordResetOtp(email: string, otp: string): Promise<boolean> {
  const key = `${OTP_RESET_PREFIX}:${email}`;
  const { outcome } = await runOtpValidate(key, 'reset', email.toLowerCase(), otp, 'raw');
  if (outcome === 'LOCKED') {
    throw otpLockedError();
  }
  return outcome === 'OK';
}

/**
 * Store a 6-digit OTP for an email-change request.
 * The key holds JSON { code, newEmail } so a single Redis key carries both
 * the secret code and the destination address that was verified.
 * TTL: 1 hour.
 */
export async function createEmailChangeOtp(userId: string, newEmail: string): Promise<string> {
  const code = generateOtp();
  const key = `${OTP_EMAIL_CHANGE_PREFIX}:${userId}`;
  await redis.set(key, JSON.stringify({ code, newEmail }), 'EX', OTP_EMAIL_CHANGE_TTL_SECONDS);
  // Attempt counter only — an active lock survives a re-issued code.
  await clearOtpAttempts('email-change', userId);
  return code;
}

/**
 * Validate the email-change OTP for a user.
 * Returns the newEmail stored alongside the code on success, null when the key
 * is absent (expired or never issued), or throws OTP_LOCKED (429) after 5 bad
 * attempts — same rate-limiting as validateVerificationOtp.
 */
export async function validateEmailChangeOtp(userId: string, otp: string): Promise<string | null> {
  const key = `${OTP_EMAIL_CHANGE_PREFIX}:${userId}`;
  // 'json' mode: the script compares only the `code` field of the stored
  // { code, newEmail } payload and hands the whole payload back on success, so
  // the Redis value format is unchanged and in-flight requests survive a deploy.
  const { outcome, stored } = await runOtpValidate(key, 'email-change', userId, otp, 'json');
  if (outcome === 'LOCKED') {
    throw otpLockedError();
  }
  if (outcome !== 'OK' || !stored) {
    return null;
  }
  const { newEmail } = JSON.parse(stored) as { code: string; newEmail: string };
  return newEmail;
}
