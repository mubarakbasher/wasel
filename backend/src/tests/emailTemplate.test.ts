/**
 * Tests for:
 *  - email-templates/manifest: the catalogue the write-path enums derive from
 *  - email.service: escapeHtml, derivePlaceholders, renderTemplate, sendTemplatedEmail
 *  - emailTemplate.service: getActiveTemplate, listEmailTemplates, updateEmailTemplate
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
  derivePlaceholders,
  renderTemplate,
  sendTemplatedEmail,
} from '../services/email.service';
import {
  EMAIL_TEMPLATE_TYPES,
  EMAIL_TEMPLATE_LANGUAGES,
  getDefaultTemplate,
} from '../email-templates/manifest';
import { emailTemplateParamSchema, testEmailBodySchema } from '../validators/admin.validators';
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
// Catalogue-driven write path
// ---------------------------------------------------------------------------

describe('email template write-path enums', () => {
  it('offers exactly the catalogue types, not a restated literal', () => {
    // Value equality would also pass on a copy-pasted list, so assert the
    // enums track the catalogue's contents rather than a fixed count: adding an
    // 8th type must keep this green without touching the validators.
    expect(emailTemplateParamSchema.shape.type.options).toEqual(EMAIL_TEMPLATE_TYPES);
    expect(testEmailBodySchema.shape.type.options).toEqual(EMAIL_TEMPLATE_TYPES);
    expect(EMAIL_TEMPLATE_TYPES.length).toBeGreaterThan(0);
  });

  it('has a built-in template behind every catalogued type', () => {
    for (const type of EMAIL_TEMPLATE_TYPES) {
      expect(getDefaultTemplate(type)).toBeDefined();
    }
  });

  it('accepts every catalogue type x language on save and test-send', () => {
    for (const type of EMAIL_TEMPLATE_TYPES) {
      for (const language of EMAIL_TEMPLATE_LANGUAGES) {
        expect(emailTemplateParamSchema.safeParse({ type, language }).success).toBe(true);
        expect(testEmailBodySchema.safeParse({ type, language }).success).toBe(true);
      }
    }
  });

  it('still rejects a type outside the catalogue and a language outside en/ar', () => {
    expect(emailTemplateParamSchema.safeParse({ type: 'not_a_type', language: 'en' }).success).toBe(
      false,
    );
    expect(testEmailBodySchema.safeParse({ type: 'not_a_type', language: 'en' }).success).toBe(
      false,
    );
    expect(
      emailTemplateParamSchema.safeParse({ type: EMAIL_TEMPLATE_TYPES[0], language: 'fr' }).success,
    ).toBe(false);
  });
});

describe('getDefaultTemplate', () => {
  it('does not resolve an inherited Object member as a template', () => {
    expect(getDefaultTemplate('constructor')).toBeUndefined();
    expect(getDefaultTemplate('toString')).toBeUndefined();
  });
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
// derivePlaceholders
// ---------------------------------------------------------------------------

describe('derivePlaceholders', () => {
  it('returns every token of a multi-token type in first-seen order', () => {
    expect(derivePlaceholders('payment_submitted_admin')).toEqual([
      '{user_name}',
      '{user_email}',
      '{plan}',
      '{amount}',
      '{currency}',
      '{reference}',
    ]);
  });

  it('dedupes a token that appears in both subject and body', () => {
    // support_message_admin has {user_name} in the subject and again in the body
    expect(derivePlaceholders('support_message_admin')).toEqual([
      '{user_name}',
      '{user_email}',
      '{message}',
    ]);
  });

  it('returns a single-token list for password_reset_otp', () => {
    expect(derivePlaceholders('password_reset_otp')).toEqual(['{otp}']);
  });

  it('returns [] for a template with no tokens at all', () => {
    expect(
      derivePlaceholders('unknown_type', { subject: 'Plain subject', body_html: '<p>Plain</p>' }),
    ).toEqual([]);
  });

  it('returns [] for an unknown type with no fallback instead of throwing', () => {
    expect(derivePlaceholders('unknown_type')).toEqual([]);
  });

  it('scans the fallback row when the type has no DEFAULT_TEMPLATES entry', () => {
    expect(
      derivePlaceholders('unknown_type', {
        subject: 'Hi {name}',
        body_html: '<p>{name} — {custom_token}</p>',
      }),
    ).toEqual(['{name}', '{custom_token}']);
  });

  it('prefers DEFAULT_TEMPLATES over a fallback row with tokens deleted', () => {
    expect(
      derivePlaceholders('verification_otp', { subject: 'Verify', body_html: '<p>no tokens</p>' }),
    ).toEqual(['{name}', '{otp}']);
  });

  it('still uses the fallback for a type named after an Object member', () => {
    // `constructor` must not resolve to Object.prototype.constructor and suppress
    // the fallback row.
    expect(
      derivePlaceholders('constructor', { subject: 'Hi {name}', body_html: '<p>{code}</p>' }),
    ).toEqual(['{name}', '{code}']);
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

  it('returns the updated row on success', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [mockRow] });

    const result = await emailTemplateService.updateEmailTemplate(
      'verification_otp',
      'en',
      { subject: 'Updated Subject' },
      'admin-id',
    );

    expect(result.row.subject).toBe('Updated Subject');
    expect(result.row.is_editable).toBe(true);
  });

  it('reports which half of the upsert ran without leaking the flag into the row', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [{ ...mockRow, created: true }] });
    const inserted = await emailTemplateService.updateEmailTemplate(
      'verification_otp',
      'en',
      { subject: 'First save' },
      'admin-id',
    );
    expect(inserted.created).toBe(true);
    // The xmax probe is a write-path detail; it must not reach the API response.
    expect('created' in inserted.row).toBe(false);

    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [{ ...mockRow, created: false }] });
    const updated = await emailTemplateService.updateEmailTemplate(
      'verification_otp',
      'en',
      { subject: 'Second save' },
      'admin-id',
    );
    expect(updated.created).toBe(false);
  });

  it('upserts on the (type, language) unique constraint, touching only sent fields', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [mockRow] });

    await emailTemplateService.updateEmailTemplate(
      'verification_otp',
      'ar',
      { subject: 'Only the subject' },
      'admin-id',
    );

    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain('INSERT INTO email_templates');
    expect(sql).toContain('ON CONFLICT (type, language) DO UPDATE');
    expect(sql).toContain('subject = EXCLUDED.subject');
    // Insert-vs-update comes back on the same statement, not a second query.
    expect(sql).toContain('(xmax = 0) AS created');
    // Not sent, so an existing row keeps its stored body...
    expect(sql).not.toContain('body_html = EXCLUDED.body_html');
    // ...while a first-time insert seeds it from the catalogue (NOT NULL column).
    const params = mockQuery.mock.calls[0][1] as unknown[];
    expect(params[2]).toBe('Only the subject');
    expect(String(params[3])).toContain('{otp}');
  });

  it('throws 404 for a type with no catalogue entry and no stored row', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });

    await expect(
      emailTemplateService.updateEmailTemplate('nonexistent', 'en', { is_active: false }, 'admin-id'),
    ).rejects.toMatchObject({ statusCode: 404, code: 'EMAIL_TEMPLATE_NOT_FOUND' });
  });

  it('updates a stored row for a type that left the catalogue', async () => {
    // Reachable only from a direct service call — the route enum 400s this type.
    const legacy = { ...mockRow, type: 'retired_type', is_active: false };
    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [legacy] });

    const result = await emailTemplateService.updateEmailTemplate(
      'retired_type',
      'en',
      { is_active: false },
      'admin-id',
    );

    expect(mockQuery.mock.calls[0][0]).toContain('UPDATE email_templates');
    expect(result.row.is_active).toBe(false);
    expect(result.row.is_editable).toBe(false);
    expect(result.created).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// emailTemplate.service — synthetic row identity
// ---------------------------------------------------------------------------

describe('emailTemplate.service synthetic ids', () => {
  it('is deterministic per (type, language)', () => {
    expect(emailTemplateService.syntheticTemplateId('payment_approved', 'ar')).toBe(
      'default:payment_approved:ar',
    );
    expect(emailTemplateService.syntheticTemplateId('payment_approved', 'ar')).toBe(
      emailTemplateService.syntheticTemplateId('payment_approved', 'ar'),
    );
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

interface ServedTemplate {
  id: string;
  type: string;
  language: string;
  subject: string;
  body_html: string;
  is_active: boolean;
  is_editable: boolean;
  created_at: string | null;
  updated_at: string | null;
  placeholders: string[];
}

function servedRows(res: { body: { data: unknown } }): ServedTemplate[] {
  return res.body.data as ServedTemplate[];
}

function servedRow(res: { body: { data: unknown } }, type: string, language: string) {
  return servedRows(res).find((row) => row.type === type && row.language === language)!;
}

describe('GET /api/v1/admin/email-templates', () => {
  function templateRow(type: string, language: string) {
    return {
      id: `tpl-${type}-${language}`,
      type,
      language,
      subject: 'Saved Subject',
      body_html: '<p>Saved body</p>',
      is_active: true,
      updated_by: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  }

  const everyCatalogueKey = EMAIL_TEMPLATE_TYPES.flatMap((type) =>
    EMAIL_TEMPLATE_LANGUAGES.map((language) => `${type}:${language}`),
  );

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

  it('adds derived placeholders to every row without changing the array shape', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        templateRow('verification_otp', 'en'),
        templateRow('password_reset_otp', 'ar'),
      ],
    });

    const res = await request(app)
      .get('/api/v1/admin/email-templates')
      .set(adminAuth());

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(servedRow(res, 'verification_otp', 'en').placeholders).toEqual(['{name}', '{otp}']);
    expect(servedRow(res, 'password_reset_otp', 'ar').placeholders).toEqual(['{otp}']);
    // Existing row fields must survive untouched (old admin bundles read these)
    expect(servedRow(res, 'verification_otp', 'en')).toMatchObject({
      id: 'tpl-verification_otp-en',
      type: 'verification_otp',
      language: 'en',
      subject: 'Saved Subject',
      is_active: true,
    });
  });

  it('derives from DEFAULT_TEMPLATES even when the saved row lost its tokens', async () => {
    const stripped = { ...templateRow('payment_rejected', 'en'), body_html: '<p>no tokens</p>' };
    mockQuery.mockResolvedValueOnce({ rows: [stripped] });

    const res = await request(app)
      .get('/api/v1/admin/email-templates')
      .set(adminAuth());

    expect(servedRow(res, 'payment_rejected', 'en').placeholders).toEqual([
      '{name}',
      '{plan}',
      '{reason}',
    ]);
  });

  it('returns a row for every catalogue type x language even when the table is empty', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .get('/api/v1/admin/email-templates')
      .set(adminAuth());

    expect(res.status).toBe(200);
    expect(servedRows(res).map((row) => `${row.type}:${row.language}`)).toEqual(everyCatalogueKey);
  });

  it('synthesises the rows an unseeded type has no DB row for', async () => {
    // Only the EN row is stored; the AR half of the same type is unseeded, and
    // support_reply_user has nothing stored at all.
    mockQuery.mockResolvedValueOnce({ rows: [templateRow('verification_otp', 'en')] });

    const res = await request(app)
      .get('/api/v1/admin/email-templates')
      .set(adminAuth());

    const stored = servedRow(res, 'verification_otp', 'en');
    expect(stored.id).toBe('tpl-verification_otp-en');
    expect(stored.subject).toBe('Saved Subject');

    const synthetic = servedRow(res, 'support_reply_user', 'ar');
    expect(synthetic.id).toBe('default:support_reply_user:ar');
    // is_active TRUE mirrors what renderTemplate actually does for it — the
    // built-in copy IS what gets sent.
    expect(synthetic.is_active).toBe(true);
    // Nulls so the panel's formatDateTime renders its em-dash "never" state
    // rather than "Invalid Date".
    expect(synthetic.created_at).toBeNull();
    expect(synthetic.updated_at).toBeNull();
    expect(synthetic.subject).toBe('Wasel support replied to your message');
    expect(synthetic.placeholders).toEqual(['{name}', '{message}']);
    // Nothing is stored for this type in either language, so both synthetic rows
    // carry the built-in copy — the last step of renderTemplate's chain.
    expect(servedRow(res, 'support_reply_user', 'en').subject).toBe(synthetic.subject);
  });

  it('seeds an unseeded AR row from the stored EN row, not the built-in copy', async () => {
    // renderTemplate resolves (type, ar) -> (type, en) -> catalogue, so once an
    // EN row is saved it is what a live AR send uses. The editor has to preview
    // that same copy or it shows something that would never be delivered.
    const editedEn = {
      ...templateRow('payment_approved', 'en'),
      subject: 'Admin-edited EN subject',
      body_html: '<p>Admin-edited EN body {name}</p>',
    };
    mockQuery.mockResolvedValueOnce({ rows: [editedEn] });

    const res = await request(app)
      .get('/api/v1/admin/email-templates')
      .set(adminAuth());

    const synthetic = servedRow(res, 'payment_approved', 'ar');
    expect(synthetic.id).toBe('default:payment_approved:ar');
    expect(synthetic.created_at).toBeNull();
    expect(synthetic.subject).toBe('Admin-edited EN subject');
    expect(synthetic.body_html).toBe('<p>Admin-edited EN body {name}</p>');
    expect(synthetic.subject).not.toBe(getDefaultTemplate('payment_approved')!.subject);
  });

  it('skips an inactive stored EN row when seeding, as getActiveTemplate does', async () => {
    const disabledEn = {
      ...templateRow('payment_approved', 'en'),
      subject: 'Disabled EN subject',
      is_active: false,
    };
    mockQuery.mockResolvedValueOnce({ rows: [disabledEn] });

    const res = await request(app)
      .get('/api/v1/admin/email-templates')
      .set(adminAuth());

    const synthetic = servedRow(res, 'payment_approved', 'ar');
    expect(synthetic.subject).toBe(getDefaultTemplate('payment_approved')!.subject);
  });

  it('marks catalogue rows editable whether they are stored or synthetic', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [templateRow('verification_otp', 'en')] });

    const res = await request(app)
      .get('/api/v1/admin/email-templates')
      .set(adminAuth());

    expect(servedRow(res, 'verification_otp', 'en').is_editable).toBe(true);
    expect(servedRow(res, 'support_reply_user', 'ar').is_editable).toBe(true);
  });

  it('gives synthetic rows a stable non-UUID id across refetches', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const first = await request(app).get('/api/v1/admin/email-templates').set(adminAuth());
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const second = await request(app).get('/api/v1/admin/email-templates').set(adminAuth());

    // The panel keys its "don't stomp unsaved edits" guard off row id, so a
    // background refetch must produce byte-identical ids.
    const ids = servedRows(first).map((row) => row.id);
    expect(servedRows(second).map((row) => row.id)).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
    // ...and none of them may look like a real row's UUID.
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    expect(ids.filter((id) => uuid.test(id))).toEqual([]);
    expect(ids.every((id) => id.startsWith('default:'))).toBe(true);
  });

  it('keeps stored rows for a type that left the catalogue, flagged read-only', async () => {
    const legacy = templateRow('retired_type', 'en');
    mockQuery.mockResolvedValueOnce({ rows: [legacy] });

    const res = await request(app)
      .get('/api/v1/admin/email-templates')
      .set(adminAuth());

    expect(servedRows(res)).toHaveLength(everyCatalogueKey.length + 1);
    expect(servedRow(res, 'retired_type', 'en').id).toBe('tpl-retired_type-en');
    expect(servedRow(res, 'retired_type', 'en').is_editable).toBe(false);

    // is_editable false is not cosmetic: the write enums are catalogue-derived,
    // so offering Save on this row would only ever produce a 400.
    const save = await request(app)
      .put('/api/v1/admin/email-templates/retired_type/en')
      .set(adminAuth())
      .send({ is_active: false });
    expect(save.status).toBe(400);

    const test = await request(app)
      .post('/api/v1/admin/email-templates/test')
      .set(adminAuth())
      .send({ type: 'retired_type', language: 'en' });
    expect(test.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// PUT /admin/email-templates/:type/:language
// ---------------------------------------------------------------------------

/**
 * Stand-in for the email_templates table, keyed like its UNIQUE (type, language).
 * Implements just enough of ON CONFLICT DO UPDATE to prove the upsert round trip:
 * a first save inserts, a later one updates only the columns the statement lists
 * as EXCLUDED. Returns the stored row so the response reflects what was written.
 */
function fakeEmailTemplatesTable(): Map<string, Record<string, unknown>> {
  const rows = new Map<string, Record<string, unknown>>();

  mockQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
    if (sql.includes('INSERT INTO email_templates')) {
      const [type, language, subject, bodyHtml, isActive, updatedBy] = params;
      const key = `${type}:${language}`;
      const existing = rows.get(key);

      if (!existing) {
        rows.set(key, {
          id: `00000000-0000-4000-8000-00000000000${rows.size + 1}`,
          type,
          language,
          subject,
          body_html: bodyHtml,
          is_active: isActive,
          updated_by: updatedBy,
          created_at: '2026-01-01T00:00:00.000Z',
          updated_at: '2026-01-01T00:00:00.000Z',
        });
      } else {
        if (sql.includes('subject = EXCLUDED.subject')) existing.subject = subject;
        if (sql.includes('body_html = EXCLUDED.body_html')) existing.body_html = bodyHtml;
        if (sql.includes('is_active = EXCLUDED.is_active')) existing.is_active = isActive;
        existing.updated_by = updatedBy;
        existing.updated_at = '2026-01-02T00:00:00.000Z';
      }
      // Stands in for `(xmax = 0) AS created` — true only on the INSERT half.
      return { rowCount: 1, rows: [{ ...rows.get(key), created: !existing }] };
    }

    if (sql.includes('FROM email_templates')) {
      return { rowCount: rows.size, rows: [...rows.values()] };
    }

    // Audit inserts and anything else.
    return { rowCount: 1, rows: [] };
  });

  return rows;
}

/** The details JSON of the most recent audit_logs insert (5th bound param). */
function lastAuditDetails(): Record<string, unknown> {
  const audits = mockQuery.mock.calls.filter((call) =>
    String(call[0]).includes('INSERT INTO audit_logs'),
  );
  const params = audits[audits.length - 1][1] as unknown[];
  return JSON.parse(String(params[4])) as Record<string, unknown>;
}

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

  it('upserts instead of 404-ing when no row exists for a valid type', async () => {
    // Pre-fix this returned rowCount 0 and the service threw 404, throwing away
    // whatever the admin had just written into a synthetic row.
    fakeEmailTemplatesTable();

    const res = await request(app)
      .put(`/api/v1/admin/email-templates/${VALID_ID}/${VALID_LANG}`)
      .set(adminAuth())
      .send({ is_active: false });

    expect(res.status).toBe(200);
    expect(res.body.data.is_active).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// PUT /admin/email-templates — first save of a synthetic row
// ---------------------------------------------------------------------------

describe('PUT /api/v1/admin/email-templates — saving an unseeded template', () => {
  it('persists on the first save and updates in place on the second', async () => {
    const table = fakeEmailTemplatesTable();

    // Nothing stored yet: the panel is showing a synthetic row for this pair.
    const before = await request(app).get('/api/v1/admin/email-templates').set(adminAuth());
    expect(servedRow(before, 'support_reply_user', 'ar').id).toBe('default:support_reply_user:ar');

    // First save inserts. body_html was not sent, so it is seeded from the
    // catalogue rather than left NULL.
    const created = await request(app)
      .put('/api/v1/admin/email-templates/support_reply_user/ar')
      .set(adminAuth())
      .send({ subject: 'رد الدعم' });

    expect(created.status).toBe(200);
    expect(table.size).toBe(1);
    expect(created.body.data.subject).toBe('رد الدعم');
    expect(created.body.data.body_html).toContain('{message}');

    // Second save updates the same row; the subject it did not send survives.
    const updated = await request(app)
      .put('/api/v1/admin/email-templates/support_reply_user/ar')
      .set(adminAuth())
      .send({ body_html: '<p dir="rtl">{name}</p>' });

    expect(updated.status).toBe(200);
    expect(table.size).toBe(1);
    expect(updated.body.data.id).toBe(created.body.data.id);
    expect(updated.body.data.subject).toBe('رد الدعم');
    expect(updated.body.data.body_html).toBe('<p dir="rtl">{name}</p>');

    // And the panel now serves the persisted row, not the synthetic one.
    const after = await request(app).get('/api/v1/admin/email-templates').set(adminAuth());
    expect(servedRow(after, 'support_reply_user', 'ar').id).toBe(created.body.data.id);
  });

  it('writes the audit row for a save that inserted', async () => {
    fakeEmailTemplatesTable();

    const res = await request(app)
      .put('/api/v1/admin/email-templates/payment_approved/en')
      .set(adminAuth())
      .send({ subject: 'Approved' });

    expect(res.status).toBe(200);
    const auditCall = mockQuery.mock.calls.find((call) =>
      String(call[0]).includes('INSERT INTO audit_logs'),
    );
    expect(auditCall).toBeDefined();
    expect(auditCall![1]).toEqual(
      expect.arrayContaining([
        ADMIN.userId,
        'email_template.update',
        'email_template',
        'payment_approved:en',
      ]),
    );
  });

  it('records in the audit details whether the save inserted or updated', async () => {
    fakeEmailTemplatesTable();

    // Same action string for both — only `created` tells them apart, so renaming
    // it would be the only other way and would split the audit history in two.
    const inserted = await request(app)
      .put('/api/v1/admin/email-templates/payment_approved/en')
      .set(adminAuth())
      .send({ subject: 'Approved' });
    expect(inserted.status).toBe(200);
    expect(lastAuditDetails().created).toBe(true);

    const updated = await request(app)
      .put('/api/v1/admin/email-templates/payment_approved/en')
      .set(adminAuth())
      .send({ subject: 'Approved again' });
    expect(updated.status).toBe(200);
    expect(lastAuditDetails().created).toBe(false);
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
