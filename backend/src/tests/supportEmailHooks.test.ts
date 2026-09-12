/**
 * Tests for support-chat email hooks (service layer, no HTTP):
 *  - sendUserMessage fires sendSupportMessageAdminAlert (fire-and-forget)
 *  - sendAdminMessage fires BOTH notifySupportReply AND sendSupportReplyEmail
 *  - each hook has a "sender rejects → request still succeeds" case
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as emailService from '../services/email.service';
import * as supportService from '../services/support.service';
import * as notificationService from '../services/notification.service';

const mockQuery = (globalThis as Record<string, unknown>).__mockPoolQuery as ReturnType<
  typeof vi.fn
>;

beforeEach(() => {
  mockQuery.mockReset();
  vi.restoreAllMocks();
});

const USER_ID = 'dddddddd-0000-4000-8000-000000000001';
const ADMIN_ID = 'eeeeeeee-0000-4000-8000-000000000002';

// Shared message row returned by pool INSERT queries
const MESSAGE_ROW = {
  id: '11111111-1111-4111-8111-111111111111',
  sender: 'user' as const,
  body: 'Hello, I need help.',
  read_at: null,
  created_at: new Date(),
};

const ADMIN_MESSAGE_ROW = {
  ...MESSAGE_ROW,
  sender: 'admin' as const,
  body: 'Hi, this is the admin reply.',
};

// ---------------------------------------------------------------------------
// sendUserMessage → sendSupportMessageAdminAlert (fire-and-forget)
// ---------------------------------------------------------------------------

describe('sendUserMessage → sendSupportMessageAdminAlert', () => {
  it('calls sendSupportMessageAdminAlert with (userId, body) after a successful INSERT', async () => {
    const alertSpy = vi
      .spyOn(emailService, 'sendSupportMessageAdminAlert')
      .mockResolvedValue(undefined);

    // pool.query: INSERT INTO support_messages RETURNING
    mockQuery.mockResolvedValueOnce({ rows: [MESSAGE_ROW] });

    await supportService.sendUserMessage(USER_ID, MESSAGE_ROW.body);

    // Flush fire-and-forget microtask
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(alertSpy).toHaveBeenCalledWith(USER_ID, MESSAGE_ROW.body);
  });

  it('resolves and returns the message even when sendSupportMessageAdminAlert rejects', async () => {
    vi.spyOn(emailService, 'sendSupportMessageAdminAlert').mockRejectedValue(
      new Error('email down'),
    );

    mockQuery.mockResolvedValueOnce({ rows: [MESSAGE_ROW] });

    const result = await supportService.sendUserMessage(USER_ID, MESSAGE_ROW.body);

    await new Promise<void>((resolve) => setImmediate(resolve));

    // The main operation must still succeed
    expect(result).toMatchObject({ id: MESSAGE_ROW.id, sender: 'user' });
  });
});

// ---------------------------------------------------------------------------
// sendAdminMessage → notifySupportReply + sendSupportReplyEmail
// ---------------------------------------------------------------------------

describe('sendAdminMessage → notifySupportReply + sendSupportReplyEmail', () => {
  it('fires both notifySupportReply and sendSupportReplyEmail after INSERT', async () => {
    const notifySpy = vi
      .spyOn(notificationService, 'notifySupportReply')
      .mockResolvedValue(undefined);
    const replySpy = vi
      .spyOn(emailService, 'sendSupportReplyEmail')
      .mockResolvedValue(undefined);

    // pool.query 1: SELECT 1 FROM users (existence check)
    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [{}] });
    // pool.query 2: INSERT INTO support_messages RETURNING
    mockQuery.mockResolvedValueOnce({ rows: [ADMIN_MESSAGE_ROW] });

    await supportService.sendAdminMessage(USER_ID, ADMIN_ID, ADMIN_MESSAGE_ROW.body);

    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(notifySpy).toHaveBeenCalledTimes(1);
    expect(replySpy).toHaveBeenCalledTimes(1);
    expect(replySpy).toHaveBeenCalledWith(USER_ID, ADMIN_MESSAGE_ROW.body);
  });

  it('passes the FULL body to sendSupportReplyEmail (not the 80-char preview)', async () => {
    const longBody = 'B'.repeat(150);
    const replySpy = vi
      .spyOn(emailService, 'sendSupportReplyEmail')
      .mockResolvedValue(undefined);
    vi.spyOn(notificationService, 'notifySupportReply').mockResolvedValue(undefined);

    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [{}] });
    mockQuery.mockResolvedValueOnce({
      rows: [{ ...ADMIN_MESSAGE_ROW, body: longBody }],
    });

    await supportService.sendAdminMessage(USER_ID, ADMIN_ID, longBody);
    await new Promise<void>((resolve) => setImmediate(resolve));

    // Email gets full body, not the truncated 77-char preview
    expect(replySpy).toHaveBeenCalledWith(USER_ID, longBody);
  });

  it('resolves and returns the message even when sendSupportReplyEmail rejects', async () => {
    vi.spyOn(emailService, 'sendSupportReplyEmail').mockRejectedValue(
      new Error('SMTP down'),
    );
    vi.spyOn(notificationService, 'notifySupportReply').mockResolvedValue(undefined);

    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [{}] });
    mockQuery.mockResolvedValueOnce({ rows: [ADMIN_MESSAGE_ROW] });

    const result = await supportService.sendAdminMessage(USER_ID, ADMIN_ID, ADMIN_MESSAGE_ROW.body);

    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(result).toMatchObject({ id: MESSAGE_ROW.id, sender: 'admin' });
  });

  it('resolves and returns the message even when notifySupportReply rejects', async () => {
    vi.spyOn(notificationService, 'notifySupportReply').mockRejectedValue(
      new Error('push down'),
    );
    vi.spyOn(emailService, 'sendSupportReplyEmail').mockResolvedValue(undefined);

    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [{}] });
    mockQuery.mockResolvedValueOnce({ rows: [ADMIN_MESSAGE_ROW] });

    const result = await supportService.sendAdminMessage(USER_ID, ADMIN_ID, ADMIN_MESSAGE_ROW.body);

    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(result).toMatchObject({ id: MESSAGE_ROW.id, sender: 'admin' });
  });
});
