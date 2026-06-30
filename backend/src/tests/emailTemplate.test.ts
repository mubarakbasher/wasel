/**
 * Tests for:
 *  - email.service: escapeHtml, renderTemplate, sendTemplatedEmail
 *  - emailTemplate.service: getActiveTemplate, updateEmailTemplate
 *  - emailLog.service: getEmailLog
 *  - Admin API: GET /email-log, GET /email-templates,
 *               PUT /email-templates/:type/:language, POST /email-templates/test
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../app';
import { generateAccessToken } from '../services/token.service';
import {
  escapeHtml,
  renderTemplate,
  sendTemplatedEmail,
} from '../services/email.service';
import * as emailTemplateService from '../services/emailTemplate.service';
import * as emailLogService from '../services/emailLog.service';

// ---------------------------------------------------------------------------
// Global mocks from setup.ts
// ---------------------------------------------------------------------------

const mockQuery = (globalThis as Record<string, unknown>).__mockPoolQuery as ReturnType<
  typeof vi.fn
>;

// Access nodemailer's sendMail mock via a safe cast through unknown.
// setup.ts mocks createTransport to always return the same { sendMail } object.
import nodemailer from 'nodemailer';
const mockSendMail = (
  nodemailer.createTransport as unknown as () => { sendMail: ReturnType<typeof vi.fn> }
)().sendMail;

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

const ADMIN = {
  userId: 'aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa',
  email: 'admin@example.com',
  name: 'Test Admin',
  role: 'admin',
};

const USER = {
  userId: 'bbbbbbbb-0000-4000-8000-bbbbbbbbbbbb',
  email: 'user@example.com',
  name: 'Regular User',
  role: 'user',
};

function adminAuth() {
  return { Authorization: `Bearer ${generateAccessToken(ADMIN)}` };
}
function userAuth() {
  return { Authorization: `Bearer ${generateAccessToken(USER)}` };
}

beforeEach(() => {
  mockQuery.mockReset();
  vi.clearAllMocks();
  // Re-attach sendMail so it resolves for each test
  mockSendMail.mockResolvedValue({ messageId: 'test-msg-id' });
});

// ---------------------------------------------------------------------------
// escapeHtml
// ---------------------------------------------------------------------------

describe('escapeHtml', () => {
  it('escapes & < > " \'', () => {
    expect(escapeHtml('a & b')).toBe('a &amp; b');
    expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
    expect(escapeHtml('"hello"')).toBe('&quot;hello&quot;');
    expect(escapeHtml("it's")).toBe('it&#39;s');
  });

  it('returns plain string unchanged', () => {
    expect(escapeHtml('hello world')).toBe('hello world');
  });
});

// ---------------------------------------------------------------------------
// renderTemplate
// ---------------------------------------------------------------------------

describe('renderTemplate', () => {
  it('picks the matching (type, language) row from DB', async () => {
    vi.spyOn(emailTemplateService, 'getActiveTemplate').mockResolvedValueOnce({
      subject: 'Hello {name}',
      body_html: '<p>{name}</p>',
    });

    const result = await renderTemplate('verification_otp', 'en', { name: 'Alice' });

    expect(result).not.toBeNull();
    expect(result?.subject).toBe('Hello Alice');
    expect(result?.body_html).toBe('<p>Alice</p>');
    expect(emailTemplateService.getActiveTemplate).toHaveBeenCalledWith('verification_otp', 'en');
  });

  it('falls back to EN template when requested language not found', async () => {
    const spy = vi
      .spyOn(emailTemplateService, 'getActiveTemplate')
      .mockResolvedValueOnce(null) // ar not found
      .mockResolvedValueOnce({ subject: 'EN Subject {name}', body_html: '<p>{name}</p>' }); // en found

    const result = await renderTemplate('verification_otp', 'ar', { name: 'Bob' });

    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenNthCalledWith(1, 'verification_otp', 'ar');
    expect(spy).toHaveBeenNthCalledWith(2, 'verification_otp', 'en');
    expect(result?.subject).toBe('EN Subject Bob');
  });

  it('falls back to DEFAULT_TEMPLATES when DB returns null for both', async () => {
    vi.spyOn(emailTemplateService, 'getActiveTemplate').mockResolvedValue(null);

    const result = await renderTemplate('password_reset_otp', 'ar', { otp: '654321' });

    // Should use DEFAULT_TEMPLATES.password_reset_otp and interpolate otp
    expect(result).not.toBeNull();
    expect(result?.subject).toContain('Password Reset');
    expect(result?.body_html).toContain('654321');
  });

  it('returns null when type has no DB row and no DEFAULT_TEMPLATES entry', async () => {
    vi.spyOn(emailTemplateService, 'getActiveTemplate').mockResolvedValue(null);

    const result = await renderTemplate('unknown_type', 'en', {});

    expect(result).toBeNull();
  });

  it('HTML-escapes user-controlled param values in body_html but NOT in subject', async () => {
    vi.spyOn(emailTemplateService, 'getActiveTemplate').mockResolvedValueOnce({
      subject: 'Hi {name}',
      body_html: '<p>{name}</p>',
    });

    const result = await renderTemplate('verification_otp', 'en', {
      name: '<script>alert("xss")</script>',
    });

    // body_html must have HTML-escaped token values
    expect(result?.body_html).toBe('<p>&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;</p>');
    // Subject must NOT be HTML-escaped — it is plain text; control chars stripped but < > left as-is
    expect(result?.subject).toBe('Hi <script>alert("xss")</script>');
    expect(result?.subject).not.toContain('&lt;script&gt;');
  });

  it('strips CR/LF/tab from subject token values (CRLF injection prevention)', async () => {
    vi.spyOn(emailTemplateService, 'getActiveTemplate').mockResolvedValueOnce({
      subject: 'Hello {name}',
      body_html: '<p>{name}</p>',
    });

    const result = await renderTemplate('verification_otp', 'en', {
      name: 'Alice\r\nBcc: evil@example.com',
    });

    expect(result?.subject).toBe('Hello Alice Bcc: evil@example.com');
    expect(result?.subject).not.toContain('\r');
    expect(result?.subject).not.toContain('\n');
  });

  it('caps subject at 255 characters', async () => {
    vi.spyOn(emailTemplateService, 'getActiveTemplate').mockResolvedValueOnce({
      subject: '{name}',
      body_html: '<p>ok</p>',
    });

    const longName = 'A'.repeat(300);
    const result = await renderTemplate('verification_otp', 'en', { name: longName });

    expect(result?.subject.length).toBe(255);
  });

  it('does not escape en template when language is en (no double call)', async () => {
    const spy = vi.spyOn(emailTemplateService, 'getActiveTemplate').mockResolvedValueOnce({
      subject: 'Test',
      body_html: '<p>OK</p>',
    });

    await renderTemplate('payment_approved', 'en', { name: 'X', plan: 'Y', amount: '5', currency: 'SDG' });

    // language is 'en', so only one DB lookup
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// sendTemplatedEmail
// ---------------------------------------------------------------------------

describe('sendTemplatedEmail', () => {
  it('calls sendMail and records a sent log row on success', async () => {
    vi.spyOn(emailTemplateService, 'getActiveTemplate').mockResolvedValueOnce({
      subject: 'Test Subject',
      body_html: '<p>body</p>',
    });

    const recordSpy = vi
      .spyOn(emailLogService, 'recordSentEmail')
      .mockResolvedValue(undefined);

    await sendTemplatedEmail({
      to: 'recipient@example.com',
      type: 'verification_otp',
      language: 'en',
      params: {},
      userId: 'user-id-123',
    });

    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'recipient@example.com' }),
    );
    expect(recordSpy).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'sent', recipient: 'recipient@example.com' }),
    );
  });

  it('records a failed log row on SMTP error and does NOT throw', async () => {
    vi.spyOn(emailTemplateService, 'getActiveTemplate').mockResolvedValueOnce({
      subject: 'Test Subject',
      body_html: '<p>body</p>',
    });

    mockSendMail.mockRejectedValueOnce(new Error('SMTP connection refused'));

    const recordSpy = vi
      .spyOn(emailLogService, 'recordSentEmail')
      .mockResolvedValue(undefined);

    // Must not throw
    await expect(
      sendTemplatedEmail({
        to: 'fail@example.com',
        type: 'verification_otp',
        language: 'en',
        params: {},
        userId: null,
      }),
    ).resolves.toBeUndefined();

    expect(recordSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        error: 'SMTP connection refused',
      }),
    );
  });

  it('does not call sendMail or record a log row when renderTemplate returns null', async () => {
    vi.spyOn(emailTemplateService, 'getActiveTemplate').mockResolvedValue(null);

    const recordSpy = vi
      .spyOn(emailLogService, 'recordSentEmail')
      .mockResolvedValue(undefined);

    await sendTemplatedEmail({
      to: 'test@example.com',
      type: 'unknown_type',
      language: 'en',
      params: {},
    });

    expect(mockSendMail).not.toHaveBeenCalled();
    expect(recordSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// emailLog.service — getEmailLog dynamic WHERE
// ---------------------------------------------------------------------------

describe('emailLog.service.getEmailLog', () => {
  it('issues a WHERE clause with type= when type is provided', async () => {
    // data + count
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] });

    await emailLogService.getEmailLog({ page: 1, limit: 10, type: 'verification_otp' });

    const dataSql = mockQuery.mock.calls[0][0] as string;
    const params = mockQuery.mock.calls[0][1] as unknown[];

    expect(dataSql).toContain('WHERE');
    expect(dataSql).toContain('type =');
    expect(params).toContain('verification_otp');
  });

  it('issues a WHERE clause with status= when status is provided', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] });

    await emailLogService.getEmailLog({ page: 1, limit: 10, status: 'failed' });

    const params = mockQuery.mock.calls[0][1] as unknown[];
    expect(params).toContain('failed');
  });

  it('issues ILIKE search when search is provided', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] });

    await emailLogService.getEmailLog({ page: 1, limit: 10, search: 'alice' });

    const dataSql = mockQuery.mock.calls[0][0] as string;
    const params = mockQuery.mock.calls[0][1] as unknown[];

    expect(dataSql).toContain('ILIKE');
    expect(params).toContain('%alice%');
  });

  it('omits WHERE clause when no filters provided', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] });

    await emailLogService.getEmailLog({ page: 1, limit: 10 });

    const dataSql = mockQuery.mock.calls[0][0] as string;
    expect(dataSql).not.toContain('WHERE');
  });

  it('uses ::date cast and inclusive INTERVAL for from/to filters', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] });

    await emailLogService.getEmailLog({ page: 1, limit: 10, from: '2024-01-01', to: '2024-12-31' });

    const dataSql = mockQuery.mock.calls[0][0] as string;
    const params = mockQuery.mock.calls[0][1] as unknown[];

    expect(dataSql).toContain('::date');
    expect(dataSql).toContain("INTERVAL '1 day'");
    expect(params).toContain('2024-01-01');
    expect(params).toContain('2024-12-31');
  });
});

// ---------------------------------------------------------------------------
// emailTemplate.service — updateEmailTemplate
// ---------------------------------------------------------------------------

describe('emailTemplate.service.updateEmailTemplate', () => {
  it('returns the updated row on success', async () => {
    const mockRow = {
      id: 'tpl-id',
      type: 'verification_otp',
      language: 'en',
      subject: 'Updated Subject',
      body_html: '<p>new</p>',
      is_active: true,
      updated_by: 'admin-id',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [mockRow] });

    const result = await emailTemplateService.updateEmailTemplate(
      'verification_otp',
      'en',
      { subject: 'Updated Subject' },
      'admin-id',
    );

    expect(result.subject).toBe('Updated Subject');
  });

  it('throws 404 when no row is matched', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });

    await expect(
      emailTemplateService.updateEmailTemplate('nonexistent', 'en', { is_active: false }, 'admin-id'),
    ).rejects.toMatchObject({ statusCode: 404, code: 'EMAIL_TEMPLATE_NOT_FOUND' });
  });
});

// ---------------------------------------------------------------------------
// GET /admin/email-log — auth guards + response shape
// ---------------------------------------------------------------------------

describe('GET /api/v1/admin/email-log', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/v1/admin/email-log');
    expect(res.status).toBe(401);
  });

  it('returns 403 for a non-admin user', async () => {
    const res = await request(app)
      .get('/api/v1/admin/email-log')
      .set(userAuth());
    expect(res.status).toBe(403);
  });

  it('returns 200 with paginated envelope for admin', async () => {
    const logRow = {
      id: 'log-1',
      user_id: null,
      recipient: 'test@example.com',
      type: 'verification_otp',
      language: 'en',
      subject: 'Wasel - Verify Your Email',
      status: 'sent',
      error: null,
      created_at: new Date().toISOString(),
    };
    mockQuery
      .mockResolvedValueOnce({ rows: [logRow] })
      .mockResolvedValueOnce({ rows: [{ count: '1' }] });

    const res = await request(app)
      .get('/api/v1/admin/email-log?page=1&limit=10')
      .set(adminAuth());

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.meta).toMatchObject({ page: 1, limit: 10, total: 1 });
  });

  it('validates status enum — rejects invalid value', async () => {
    const res = await request(app)
      .get('/api/v1/admin/email-log?status=unknown')
      .set(adminAuth());
    expect(res.status).toBe(400);
  });

  it('accepts YYYY-MM-DD date format for from/to filters', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] });

    const res = await request(app)
      .get('/api/v1/admin/email-log?from=2024-01-01&to=2024-12-31')
      .set(adminAuth());

    expect(res.status).toBe(200);
  });

  it('rejects an invalid date string for from filter', async () => {
    const res = await request(app)
      .get('/api/v1/admin/email-log?from=not-a-date')
      .set(adminAuth());
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// GET /admin/email-templates
// ---------------------------------------------------------------------------

describe('GET /api/v1/admin/email-templates', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/v1/admin/email-templates');
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-admin', async () => {
    const res = await request(app)
      .get('/api/v1/admin/email-templates')
      .set(userAuth());
    expect(res.status).toBe(403);
  });

  it('returns 200 with template list for admin', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .get('/api/v1/admin/email-templates')
      .set(adminAuth());

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// PUT /admin/email-templates/:type/:language
// ---------------------------------------------------------------------------

describe('PUT /api/v1/admin/email-templates/:type/:language', () => {
  const VALID_ID = 'verification_otp';
  const VALID_LANG = 'en';

  const mockTemplateRow = {
    id: 'tpl-id',
    type: VALID_ID,
    language: VALID_LANG,
    subject: 'New Subject',
    body_html: '<p>New</p>',
    is_active: true,
    updated_by: ADMIN.userId,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  it('returns 401 without auth', async () => {
    const res = await request(app)
      .put(`/api/v1/admin/email-templates/${VALID_ID}/${VALID_LANG}`)
      .send({ subject: 'New Subject' });
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-admin', async () => {
    const res = await request(app)
      .put(`/api/v1/admin/email-templates/${VALID_ID}/${VALID_LANG}`)
      .set(userAuth())
      .send({ subject: 'New Subject' });
    expect(res.status).toBe(403);
  });

  it('returns 400 when body is empty (no fields)', async () => {
    const res = await request(app)
      .put(`/api/v1/admin/email-templates/${VALID_ID}/${VALID_LANG}`)
      .set(adminAuth())
      .send({});
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid language param', async () => {
    const res = await request(app)
      .put(`/api/v1/admin/email-templates/${VALID_ID}/fr`)
      .set(adminAuth())
      .send({ subject: 'S' });
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid type param (enum enforcement)', async () => {
    const res = await request(app)
      .put(`/api/v1/admin/email-templates/nonexistent/${VALID_LANG}`)
      .set(adminAuth())
      .send({ subject: 'S' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when body_html exceeds 64000 characters', async () => {
    const res = await request(app)
      .put(`/api/v1/admin/email-templates/${VALID_ID}/${VALID_LANG}`)
      .set(adminAuth())
      .send({ body_html: 'a'.repeat(64001) });
    expect(res.status).toBe(400);
  });

  it('returns 200 and updated template for valid admin request', async () => {
    // updateEmailTemplate call + audit logAction call
    mockQuery
      .mockResolvedValueOnce({ rowCount: 1, rows: [mockTemplateRow] }) // UPDATE
      .mockResolvedValueOnce({}); // audit INSERT

    const res = await request(app)
      .put(`/api/v1/admin/email-templates/${VALID_ID}/${VALID_LANG}`)
      .set(adminAuth())
      .send({ subject: 'New Subject' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.subject).toBe('New Subject');
  });

  it('returns 404 when template row does not exist for a valid type', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });

    const res = await request(app)
      .put(`/api/v1/admin/email-templates/${VALID_ID}/${VALID_LANG}`)
      .set(adminAuth())
      .send({ is_active: false });

    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// POST /admin/email-templates/test
// ---------------------------------------------------------------------------

describe('POST /api/v1/admin/email-templates/test', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app)
      .post('/api/v1/admin/email-templates/test')
      .send({ type: 'verification_otp', language: 'en' });
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-admin', async () => {
    const res = await request(app)
      .post('/api/v1/admin/email-templates/test')
      .set(userAuth())
      .send({ type: 'verification_otp', language: 'en' });
    expect(res.status).toBe(403);
  });

  it('returns 400 for invalid language', async () => {
    const res = await request(app)
      .post('/api/v1/admin/email-templates/test')
      .set(adminAuth())
      .send({ type: 'verification_otp', language: 'fr' });
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid type (enum enforcement)', async () => {
    const res = await request(app)
      .post('/api/v1/admin/email-templates/test')
      .set(adminAuth())
      .send({ type: 'invalid_type', language: 'en' });
    expect(res.status).toBe(400);
  });

  it('returns 200 with { sent: true } and calls sendMail for admin', async () => {
    // getActiveTemplate lookup + audit INSERT
    mockQuery
      .mockResolvedValueOnce({ rows: [{ subject: 'Test {name}', body_html: '<p>{name}</p>' }] })
      .mockResolvedValueOnce({}); // audit

    const res = await request(app)
      .post('/api/v1/admin/email-templates/test')
      .set(adminAuth())
      .send({ type: 'verification_otp', language: 'en' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.sent).toBe(true);
    expect(mockSendMail).toHaveBeenCalled();
  });
});
