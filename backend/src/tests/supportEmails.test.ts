/**
 * Tests for support-chat email senders in email.service:
 *  - sendSupportMessageAdminAlert: fan-out, Redis dedupe, zero admins, SMTP failure
 *  - sendSupportReplyEmail: language routing, SMTP failure (never throws)
 *  - Admin API: PUT /email-templates + POST /email-templates/test accept new types
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../app';
import { generateAccessToken } from '../services/token.service';
import {
  sendSupportMessageAdminAlert,
  sendSupportReplyEmail,
} from '../services/email.service';
import * as emailTemplateService from '../services/emailTemplate.service';
import * as emailLogService from '../services/emailLog.service';
import { redis } from '../config/redis';

// ---------------------------------------------------------------------------
// Shared mock handles
// ---------------------------------------------------------------------------

const mockQuery = (globalThis as Record<string, unknown>).__mockPoolQuery as ReturnType<
  typeof vi.fn
>;

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

const SENDER_USER_ID = 'cccccccc-0000-4000-8000-cccccccccccc';

beforeEach(() => {
  mockQuery.mockReset();
  vi.clearAllMocks();
  mockSendMail.mockResolvedValue({ messageId: 'test-msg-id' });
});

// ---------------------------------------------------------------------------
// sendSupportMessageAdminAlert — fan-out
// ---------------------------------------------------------------------------

describe('sendSupportMessageAdminAlert — fan-out', () => {
  it('sends to 2 admins in their respective languages (en + ar)', async () => {
    // redis.set returns 'OK' by default from the mock
    // 1. user lookup
    mockQuery.mockResolvedValueOnce({
      rows: [{ name: 'Alice Sender', email: 'alice@example.com' }],
    });
    // 2. admin lookup — 2 admins with different languages
    mockQuery.mockResolvedValueOnce({
      rows: [
        { email: 'admin-en@example.com', language: 'en' },
        { email: 'admin-ar@example.com', language: 'ar' },
      ],
    });

    const getActiveSpy = vi
      .spyOn(emailTemplateService, 'getActiveTemplate')
      .mockResolvedValueOnce({
        subject: 'New support message from {user_name}',
        body_html: '<p>{message}</p>',
      })
      .mockResolvedValueOnce({
        subject: 'رسالة دعم جديدة من {user_name}',
        body_html: '<p>{message}</p>',
      });
    const recordSpy = vi
      .spyOn(emailLogService, 'recordSentEmail')
      .mockResolvedValue(undefined);

    await sendSupportMessageAdminAlert(SENDER_USER_ID, 'Hello, I need help.');

    expect(mockSendMail).toHaveBeenCalledTimes(2);
    expect(getActiveSpy).toHaveBeenCalledWith('support_message_admin', 'en');
    expect(getActiveSpy).toHaveBeenCalledWith('support_message_admin', 'ar');
    expect(recordSpy).toHaveBeenCalledTimes(2);
    // Both sends target correct addresses
    const calls = mockSendMail.mock.calls.map((c) => (c[0] as { to: string }).to);
    expect(calls).toContain('admin-en@example.com');
    expect(calls).toContain('admin-ar@example.com');
  });
});

// ---------------------------------------------------------------------------
// sendSupportMessageAdminAlert — Redis dedupe
// ---------------------------------------------------------------------------

describe('sendSupportMessageAdminAlert — Redis dedupe', () => {
  it('sets Redis key with EX 600 NX on a fresh call', async () => {
    const redisSpy = vi.spyOn(redis, 'set').mockResolvedValueOnce('OK' as never);

    mockQuery
      .mockResolvedValueOnce({ rows: [{ name: 'Alice', email: 'alice@example.com' }] })
      .mockResolvedValueOnce({ rows: [{ email: 'admin@example.com', language: 'en' }] });

    vi.spyOn(emailTemplateService, 'getActiveTemplate').mockResolvedValueOnce({
      subject: 'New support message from {user_name}',
      body_html: '<p>{message}</p>',
    });
    vi.spyOn(emailLogService, 'recordSentEmail').mockResolvedValue(undefined);

    await sendSupportMessageAdminAlert(SENDER_USER_ID, 'test');

    expect(redisSpy).toHaveBeenCalledWith(
      `email:supportalert:${SENDER_USER_ID}`,
      '1',
      'EX',
      600,
      'NX',
    );
  });

  it('skips all DB queries and sends when Redis returns null (key already set)', async () => {
    // Simulate the NX flag returning null (key already exists → deduped)
    vi.spyOn(redis, 'set').mockResolvedValueOnce(null as never);

    await sendSupportMessageAdminAlert(SENDER_USER_ID, 'duplicate message');

    // No pool queries and no emails
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockSendMail).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// sendSupportMessageAdminAlert — zero active admins
// ---------------------------------------------------------------------------

describe('sendSupportMessageAdminAlert — zero admins', () => {
  it('logs a warning and does not send when no active admins exist', async () => {
    const warnSpy = vi.spyOn(
      (await import('../config/logger')).default,
      'warn',
    );

    mockQuery
      .mockResolvedValueOnce({ rows: [{ name: 'Alice', email: 'alice@example.com' }] })
      .mockResolvedValueOnce({ rows: [] }); // zero admins

    await sendSupportMessageAdminAlert(SENDER_USER_ID, 'test');

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('no active admins found'),
    );
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it('resolves without throwing when zero admins are found', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ name: 'Alice', email: 'alice@example.com' }] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(sendSupportMessageAdminAlert(SENDER_USER_ID, 'test')).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// sendSupportReplyEmail — language routing
// ---------------------------------------------------------------------------

describe('sendSupportReplyEmail — language routing', () => {
  it('sends in Arabic when the user language is ar', async () => {
    // resolveUserEmailAndLanguage returns an AR user
    mockQuery.mockResolvedValueOnce({
      rows: [{ email: 'user-ar@example.com', name: 'محمد', language: 'ar' }],
    });

    const getActiveSpy = vi
      .spyOn(emailTemplateService, 'getActiveTemplate')
      .mockResolvedValueOnce({
        subject: 'وصل ردّ على رسالتك',
        body_html: '<p dir="rtl">{message}</p>',
      });
    vi.spyOn(emailLogService, 'recordSentEmail').mockResolvedValue(undefined);

    await sendSupportReplyEmail(SENDER_USER_ID, 'مرحباً، هذا رد الدعم.');

    expect(getActiveSpy).toHaveBeenCalledWith('support_reply_user', 'ar');
    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'user-ar@example.com' }),
    );
  });

  it('sends in English when the user language is en', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ email: 'user-en@example.com', name: 'Bob', language: 'en' }],
    });

    const getActiveSpy = vi
      .spyOn(emailTemplateService, 'getActiveTemplate')
      .mockResolvedValueOnce({
        subject: 'Wasel support replied to your message',
        body_html: '<p>{message}</p>',
      });
    vi.spyOn(emailLogService, 'recordSentEmail').mockResolvedValue(undefined);

    await sendSupportReplyEmail(SENDER_USER_ID, 'Hello, here is our reply.');

    expect(getActiveSpy).toHaveBeenCalledWith('support_reply_user', 'en');
    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'user-en@example.com' }),
    );
  });

  it('passes the full message body (not truncated) as the {message} param', async () => {
    const longMessage = 'A'.repeat(200);
    mockQuery.mockResolvedValueOnce({
      rows: [{ email: 'user@example.com', name: 'Carol', language: 'en' }],
    });
    vi.spyOn(emailTemplateService, 'getActiveTemplate').mockResolvedValueOnce({
      subject: 'Support reply',
      body_html: '{message}',
    });
    vi.spyOn(emailLogService, 'recordSentEmail').mockResolvedValue(undefined);

    await sendSupportReplyEmail(SENDER_USER_ID, longMessage);

    const callArg = mockSendMail.mock.calls[0][0] as { html: string };
    // The full message must appear in the rendered body (HTML-escaped, but A chars are safe)
    expect(callArg.html).toContain(longMessage);
  });
});

// ---------------------------------------------------------------------------
// sendSupportReplyEmail — SMTP failure (never throws)
// ---------------------------------------------------------------------------

describe('sendSupportReplyEmail — SMTP failure', () => {
  it('records a failed log row and resolves without throwing on SMTP error', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ email: 'user@example.com', name: 'Dave', language: 'en' }],
    });

    vi.spyOn(emailTemplateService, 'getActiveTemplate').mockResolvedValueOnce({
      subject: 'Support reply',
      body_html: '<p>{message}</p>',
    });
    mockSendMail.mockRejectedValueOnce(new Error('SMTP connection refused'));

    const recordSpy = vi
      .spyOn(emailLogService, 'recordSentEmail')
      .mockResolvedValue(undefined);

    await expect(
      sendSupportReplyEmail(SENDER_USER_ID, 'Admin reply text'),
    ).resolves.toBeUndefined();

    expect(recordSpy).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed', error: 'SMTP connection refused' }),
    );
  });
});

// ---------------------------------------------------------------------------
// sendSupportMessageAdminAlert — SMTP failure (never throws)
// ---------------------------------------------------------------------------

describe('sendSupportMessageAdminAlert — SMTP failure', () => {
  it('records a failed log row and resolves without throwing on SMTP error', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ name: 'Alice', email: 'alice@example.com' }] })
      .mockResolvedValueOnce({ rows: [{ email: 'admin@example.com', language: 'en' }] });

    vi.spyOn(emailTemplateService, 'getActiveTemplate').mockResolvedValueOnce({
      subject: 'New support message from {user_name}',
      body_html: '<p>{message}</p>',
    });
    mockSendMail.mockRejectedValueOnce(new Error('SMTP timeout'));

    const recordSpy = vi
      .spyOn(emailLogService, 'recordSentEmail')
      .mockResolvedValue(undefined);

    await expect(
      sendSupportMessageAdminAlert(SENDER_USER_ID, 'test message'),
    ).resolves.toBeUndefined();

    expect(recordSpy).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed', error: 'SMTP timeout' }),
    );
  });
});

// ---------------------------------------------------------------------------
// Admin API — PUT /email-templates/:type/:language accepts new types
// ---------------------------------------------------------------------------

describe('PUT /api/v1/admin/email-templates — new support types', () => {
  const mockTemplateRow = (type: string) => ({
    id: 'tpl-id',
    type,
    language: 'en',
    subject: 'Updated Subject',
    body_html: '<p>New</p>',
    is_active: true,
    updated_by: ADMIN.userId,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  it('accepts support_message_admin as a valid type', async () => {
    mockQuery
      .mockResolvedValueOnce({ rowCount: 1, rows: [mockTemplateRow('support_message_admin')] })
      .mockResolvedValueOnce({}); // audit

    const res = await request(app)
      .put('/api/v1/admin/email-templates/support_message_admin/en')
      .set(adminAuth())
      .send({ subject: 'Updated Subject' });

    expect(res.status).toBe(200);
    expect(res.body.data.type).toBe('support_message_admin');
  });

  it('accepts support_reply_user as a valid type', async () => {
    mockQuery
      .mockResolvedValueOnce({ rowCount: 1, rows: [mockTemplateRow('support_reply_user')] })
      .mockResolvedValueOnce({}); // audit

    const res = await request(app)
      .put('/api/v1/admin/email-templates/support_reply_user/ar')
      .set(adminAuth())
      .send({ subject: 'Updated Arabic Subject' });

    expect(res.status).toBe(200);
    expect(res.body.data.type).toBe('support_reply_user');
  });
});

// ---------------------------------------------------------------------------
// Admin API — POST /email-templates/test accepts new types
// ---------------------------------------------------------------------------

describe('POST /api/v1/admin/email-templates/test — new support types', () => {
  it('returns 200 and calls sendMail for support_message_admin', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ subject: 'New support message from {user_name}', body_html: '<p>{message}</p>' }] })
      .mockResolvedValueOnce({}); // audit

    const res = await request(app)
      .post('/api/v1/admin/email-templates/test')
      .set(adminAuth())
      .send({ type: 'support_message_admin', language: 'en' });

    expect(res.status).toBe(200);
    expect(res.body.data.sent).toBe(true);
    expect(mockSendMail).toHaveBeenCalled();
  });

  it('returns 200 and calls sendMail for support_reply_user', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ subject: 'Wasel support replied to your message', body_html: '<p>{name}: {message}</p>' }] })
      .mockResolvedValueOnce({}); // audit

    const res = await request(app)
      .post('/api/v1/admin/email-templates/test')
      .set(adminAuth())
      .send({ type: 'support_reply_user', language: 'ar' });

    expect(res.status).toBe(200);
    expect(res.body.data.sent).toBe(true);
    expect(mockSendMail).toHaveBeenCalled();
  });

  it('returns 400 for still-invalid type (enum enforcement still works)', async () => {
    const res = await request(app)
      .post('/api/v1/admin/email-templates/test')
      .set(adminAuth())
      .send({ type: 'not_a_type', language: 'en' });

    expect(res.status).toBe(400);
  });
});
