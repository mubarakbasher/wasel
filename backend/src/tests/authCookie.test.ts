import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import bcrypt from 'bcrypt';
import request from 'supertest';
import app from '../app';
import * as tokenService from '../services/token.service';

const mockQuery = (globalThis as Record<string, unknown>).__mockPoolQuery as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockQuery.mockReset();
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const USER_ID = '550e8400-e29b-41d4-a716-446655440000';

const loginBody = { email: 'test@example.com', password: 'Password1' };

// Hashed once in beforeAll (low cost: compare only cares about the embedded
// cost factor, and prod cost 12 would slow the suite for no extra coverage).
let activeUserRow: Record<string, unknown>;
// Same identity but role: 'admin' — login cookie mode requires an admin user.
let adminUserRow: Record<string, unknown>;

beforeAll(async () => {
  const passwordHash = await bcrypt.hash(loginBody.password, 4);
  activeUserRow = {
    id: USER_ID,
    name: 'Test User',
    email: 'test@example.com',
    password_hash: passwordHash,
    is_verified: true,
    is_active: true,
    failed_login_attempts: 0,
    locked_until: null,
    role: 'user',
  };
  adminUserRow = { ...activeUserRow, role: 'admin' };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** All Set-Cookie header values on a response (normalized to an array). */
function setCookies(res: request.Response): string[] {
  const raw = res.headers['set-cookie'] as unknown;
  if (raw === undefined) return [];
  return Array.isArray(raw) ? (raw as string[]) : [raw as string];
}

/** The wasel_rt Set-Cookie header, if any. */
function waselCookie(res: request.Response): string | undefined {
  return setCookies(res).find((c) => c.startsWith('wasel_rt='));
}

/** The value portion of a Set-Cookie string ("name=value; Attr; ..."). */
function cookieValue(setCookie: string): string {
  return setCookie.split(';')[0].slice('wasel_rt='.length);
}

/** Issue and persist a refresh token the way login does (Redis is mocked). */
async function issueStoredRefreshToken(): Promise<{ token: string; jti: string }> {
  const { token, jti } = tokenService.generateRefreshToken(USER_ID);
  await tokenService.storeRefreshToken(USER_ID, jti);
  return { token, jti };
}

const SEVEN_DAYS_SECONDS = 7 * 24 * 60 * 60;

// ---------------------------------------------------------------------------
// 1 + 2 — login: cookie mode vs legacy (mobile) mode
// ---------------------------------------------------------------------------

describe('POST /api/v1/auth/login — X-Client: admin cookie mode', () => {
  it('sets the wasel_rt HttpOnly cookie and omits refreshToken from the body', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [adminUserRow] });

    const res = await request(app)
      .post('/api/v1/auth/login')
      .set('X-Client', 'admin')
      .send(loginBody);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user.email).toBe('test@example.com');
    expect(res.body.data.accessToken).toBeDefined();
    expect(res.body.data.refreshToken).toBeUndefined();

    const cookie = waselCookie(res);
    expect(cookie).toBeDefined();
    expect(cookieValue(cookie!).length).toBeGreaterThan(0);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Path=/api/v1/auth');
    expect(cookie).toContain(`Max-Age=${SEVEN_DAYS_SECONDS}`);
    // NODE_ENV=test → not production → no Secure attribute
    expect(cookie).not.toContain('Secure');
  });

  it('matches the header value case-insensitively and trimmed', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [adminUserRow] });

    const res = await request(app)
      .post('/api/v1/auth/login')
      .set('X-Client', '  ADMIN ')
      .send(loginBody);

    expect(res.status).toBe(200);
    expect(res.body.data.refreshToken).toBeUndefined();
    expect(waselCookie(res)).toBeDefined();
  });

  it('a NON-admin login through the admin client gets NO cookie and the body pair', async () => {
    // Role gate: X-Client: admin alone is not enough — a non-admin user who
    // authenticates via the admin SPA must not be handed a live HttpOnly
    // refresh cookie the SPA can't reach to revoke. They get the legacy body
    // tokens (which the SPA slice discards) and zero Set-Cookie.
    mockQuery.mockResolvedValueOnce({ rows: [activeUserRow] }); // role: 'user'

    const res = await request(app)
      .post('/api/v1/auth/login')
      .set('X-Client', 'admin')
      .send(loginBody);

    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toBeDefined();
    expect(res.body.data.refreshToken).toBeDefined();
    expect(setCookies(res)).toHaveLength(0);
  });
});

describe('POST /api/v1/auth/login — header-less (mobile) mode unchanged', () => {
  it('returns both tokens in the body and sets no cookie', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [activeUserRow] });

    const res = await request(app).post('/api/v1/auth/login').send(loginBody);

    expect(res.status).toBe(200);
    expect(res.body.data.user.email).toBe('test@example.com');
    expect(res.body.data.accessToken).toBeDefined();
    expect(res.body.data.refreshToken).toBeDefined();
    expect(setCookies(res)).toHaveLength(0);
  });

  it('a non-admin X-Client value stays in legacy body mode', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [activeUserRow] });

    const res = await request(app)
      .post('/api/v1/auth/login')
      .set('X-Client', 'mobile')
      .send(loginBody);

    expect(res.status).toBe(200);
    expect(res.body.data.refreshToken).toBeDefined();
    expect(setCookies(res)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 3 + 4 + 5 — refresh: cookie-only, legacy body, and missing token
// ---------------------------------------------------------------------------

describe('POST /api/v1/auth/refresh — cookie mode', () => {
  it('rotates from a cookie-only request: new accessToken, fresh Set-Cookie, no body refreshToken', async () => {
    const { token: oldToken } = await issueStoredRefreshToken();
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: USER_ID, name: 'Test User', email: 'test@example.com', role: 'user' }],
    });

    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', `wasel_rt=${oldToken}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toBeDefined();
    expect(res.body.data.refreshToken).toBeUndefined();

    const cookie = waselCookie(res);
    expect(cookie).toBeDefined();
    // Rotation: the re-issued cookie must carry a NEW token
    expect(cookieValue(cookie!)).not.toBe(oldToken);
    expect(cookieValue(cookie!).length).toBeGreaterThan(0);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Path=/api/v1/auth');
    expect(cookie).toContain(`Max-Age=${SEVEN_DAYS_SECONDS}`);
  });
});

describe('POST /api/v1/auth/refresh — legacy body mode unchanged', () => {
  it('returns the body token pair and sets no cookie', async () => {
    const { token: oldToken } = await issueStoredRefreshToken();
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: USER_ID, name: 'Test User', email: 'test@example.com', role: 'user' }],
    });

    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: oldToken });

    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toBeDefined();
    expect(res.body.data.refreshToken).toBeDefined();
    expect(res.body.data.refreshToken).not.toBe(oldToken);
    expect(setCookies(res)).toHaveLength(0);
  });

  it('still returns 401 REFRESH_TOKEN_INVALID for a bad body token', async () => {
    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: 'invalid-token' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('REFRESH_TOKEN_INVALID');
  });
});

describe('POST /api/v1/auth/refresh — neither body token nor cookie', () => {
  it('returns the endpoint\'s existing missing-token error (400 VALIDATION_ERROR)', async () => {
    const res = await request(app).post('/api/v1/auth/refresh').send({});

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details[0].field).toBe('refreshToken');
    expect(setCookies(res)).toHaveLength(0);
  });

  it('returns the same error when the admin header is present but no token exists', async () => {
    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .set('X-Client', 'admin')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

// ---------------------------------------------------------------------------
// 6 — logout: cookie revocation + clearing
// ---------------------------------------------------------------------------

describe('POST /api/v1/auth/logout — cookie mode', () => {
  it('revokes the cookie token and clears the cookie', async () => {
    const { token, jti } = await issueStoredRefreshToken();
    const revokeSpy = vi.spyOn(tokenService, 'revokeRefreshToken');

    const res = await request(app)
      .post('/api/v1/auth/logout')
      .set('Cookie', `wasel_rt=${token}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(revokeSpy).toHaveBeenCalledWith(USER_ID, jti);

    const cookie = waselCookie(res);
    expect(cookie).toBeDefined();
    // Cleared: empty value + epoch expiry + matching path
    expect(cookie).toMatch(/^wasel_rt=;/);
    expect(cookie).toContain('Expires=Thu, 01 Jan 1970');
    expect(cookie).toContain('Path=/api/v1/auth');
    revokeSpy.mockRestore();
  });

  it('is idempotent for the admin client: 200 + cleared cookie even with no token anywhere', async () => {
    const res = await request(app)
      .post('/api/v1/auth/logout')
      .set('X-Client', 'admin')
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const cookie = waselCookie(res);
    expect(cookie).toBeDefined();
    expect(cookie).toMatch(/^wasel_rt=;/);
  });

  it('legacy body logout stays unchanged: 400 when missing, 200 + no cookie when provided', async () => {
    const missing = await request(app).post('/api/v1/auth/logout').send({});
    expect(missing.status).toBe(400);
    expect(missing.body.error.code).toBe('VALIDATION_ERROR');
    expect(setCookies(missing)).toHaveLength(0);

    const provided = await request(app)
      .post('/api/v1/auth/logout')
      .send({ refreshToken: 'some-expired-token' });
    expect(provided.status).toBe(200);
    expect(provided.body.success).toBe(true);
    expect(setCookies(provided)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 7 — bank-settings update writes an audit row
// ---------------------------------------------------------------------------

describe('PUT /api/v1/admin/settings/bank — audit logging', () => {
  const ADMIN_USER = {
    userId: 'aaaaaaaa-0000-4000-8000-000000000042',
    email: 'admin-settings@example.com',
    name: 'Admin Settings',
    role: 'admin',
  };

  function adminAuth(): Record<string, string> {
    const token = tokenService.generateAccessToken(ADMIN_USER);
    return { Authorization: `Bearer ${token}` };
  }

  it('records settings.update_bank with before/after details', async () => {
    mockQuery
      // before: getBankInfo
      .mockResolvedValueOnce({ rows: [{ key: 'bank.name', value: 'Old Bank' }] })
      // updateSettings: one upsert per provided key
      .mockResolvedValueOnce({ rows: [] }) // bank.name
      .mockResolvedValueOnce({ rows: [] }) // bank.accountNumber
      // after: getBankInfo
      .mockResolvedValueOnce({
        rows: [
          { key: 'bank.name', value: 'New Bank' },
          { key: 'bank.accountNumber', value: '12345' },
        ],
      })
      // audit insert
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .put('/api/v1/admin/settings/bank')
      .set(adminAuth())
      .send({ bankName: 'New Bank', accountNumber: '12345' });

    expect(res.status).toBe(200);
    expect(res.body.data.bankName).toBe('New Bank');

    const auditCall = mockQuery.mock.calls.find(
      (c) => typeof c[0] === 'string' && (c[0] as string).includes('INSERT INTO audit_logs'),
    );
    expect(auditCall).toBeDefined();
    const params = auditCall![1] as unknown[];
    expect(params[0]).toBe(ADMIN_USER.userId);   // admin_id ← req.user.id
    expect(params[1]).toBe('settings.update_bank');
    expect(params[2]).toBe('settings');
    expect(params[3]).toBe('bank');
    const details = JSON.parse(params[4] as string) as {
      before: Record<string, string>;
      after: Record<string, string>;
    };
    expect(details.before.bankName).toBe('Old Bank');
    expect(details.after.bankName).toBe('New Bank');
    expect(details.after.accountNumber).toBe('12345');
  });
});
