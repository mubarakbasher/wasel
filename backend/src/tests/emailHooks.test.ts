/**
 * Tests for payment-event email hooks (service layer, no HTTP):
 *  - uploadReceipt triggers sendPaymentSubmittedAdminAlert (fire-and-forget)
 *  - reviewPayment approve calls sendPaymentApproved
 *  - reviewPayment reject calls sendPaymentRejected
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as emailService from '../services/email.service';
import * as subscriptionService from '../services/subscription.service';
import * as adminService from '../services/admin.service';

const mockQuery = (globalThis as Record<string, unknown>).__mockPoolQuery as ReturnType<
  typeof vi.fn
>;
const mockClientQuery = (globalThis as Record<string, unknown>)
  .__mockClientQuery as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockQuery.mockReset();
  mockClientQuery.mockReset();
  vi.restoreAllMocks();
});

const PAYMENT_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
const ADMIN_ID = 'bbbbbbbb-0000-4000-8000-000000000002';

// ---------------------------------------------------------------------------
// uploadReceipt → sendPaymentSubmittedAdminAlert (fire-and-forget)
// ---------------------------------------------------------------------------

describe('uploadReceipt → sendPaymentSubmittedAdminAlert', () => {
  it('calls sendPaymentSubmittedAdminAlert after a successful receipt upload', async () => {
    const alertSpy = vi
      .spyOn(emailService, 'sendPaymentSubmittedAdminAlert')
      .mockResolvedValue(undefined);

    // pool.query calls inside uploadReceipt:
    // 1. SELECT id, user_id, status FROM payments WHERE id = $1
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: PAYMENT_ID, user_id: USER_ID, status: 'pending' }],
    });
    // 2. UPDATE payments SET receipt_url ...
    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [] });

    await subscriptionService.uploadReceipt(USER_ID, PAYMENT_ID, 'https://cdn.wa-sel.com/r.jpg');

    // Allow the void promise (fire-and-forget) to flush
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(alertSpy).toHaveBeenCalledWith(PAYMENT_ID);
  });

  it('does not break uploadReceipt when alert throws', async () => {
    vi.spyOn(emailService, 'sendPaymentSubmittedAdminAlert').mockRejectedValue(
      new Error('SMTP down'),
    );

    mockQuery
      .mockResolvedValueOnce({
        rows: [{ id: PAYMENT_ID, user_id: USER_ID, status: 'rejected' }],
      })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });

    // Must not throw even though alert fails
    await expect(
      subscriptionService.uploadReceipt(USER_ID, PAYMENT_ID, 'https://cdn.wa-sel.com/r2.jpg'),
    ).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// reviewPayment → sendPaymentApproved / sendPaymentRejected
// ---------------------------------------------------------------------------

describe('reviewPayment → email senders', () => {
  const PAYMENT_ROW = {
    id: PAYMENT_ID,
    user_id: USER_ID,
    amount: 5,
    status: 'approved',
    plan_tier: 'starter',
    currency: 'SDG',
    reference_code: 'REF-001',
    receipt_url: 'https://cdn.wa-sel.com/r.jpg',
    rejection_reason: null,
    reviewed_by: ADMIN_ID,
    reviewed_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
  };

  // Queue the transaction client calls for an "approved" review
  function queueApproveTransaction(): void {
    mockClientQuery
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rowCount: 1, rows: [PAYMENT_ROW] }) // UPDATE payments RETURNING
      .mockResolvedValueOnce({ rows: [] }) // pending_change sub check
      .mockResolvedValueOnce({ rows: [] }) // pending sub check
      .mockResolvedValueOnce({}); // COMMIT
    // planLabel lookup (pool.query outside the client)
    mockQuery.mockResolvedValueOnce({ rows: [{ name: 'Starter' }] });
  }

  // Queue the transaction client calls for a "rejected" review
  function queueRejectTransaction(): void {
    const rejRow = { ...PAYMENT_ROW, status: 'rejected', rejection_reason: 'Unreadable' };
    mockClientQuery
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rowCount: 1, rows: [rejRow] }) // UPDATE payments RETURNING
      .mockResolvedValueOnce({}); // COMMIT
    // planLabel lookup
    mockQuery.mockResolvedValueOnce({ rows: [{ name: 'Starter' }] });
  }

  it('calls sendPaymentApproved when decision is approved', async () => {
    const approvedSpy = vi
      .spyOn(emailService, 'sendPaymentApproved')
      .mockResolvedValue(undefined);
    const rejectedSpy = vi
      .spyOn(emailService, 'sendPaymentRejected')
      .mockResolvedValue(undefined);

    queueApproveTransaction();

    await adminService.reviewPayment(PAYMENT_ID, ADMIN_ID, 'approved');

    expect(approvedSpy).toHaveBeenCalledWith(
      USER_ID,
      'Starter',
      '5',
      'SDG',
    );
    expect(rejectedSpy).not.toHaveBeenCalled();
  });

  it('calls sendPaymentRejected when decision is rejected', async () => {
    const approvedSpy = vi
      .spyOn(emailService, 'sendPaymentApproved')
      .mockResolvedValue(undefined);
    const rejectedSpy = vi
      .spyOn(emailService, 'sendPaymentRejected')
      .mockResolvedValue(undefined);

    queueRejectTransaction();

    await adminService.reviewPayment(PAYMENT_ID, ADMIN_ID, 'rejected', 'Unreadable');

    expect(rejectedSpy).toHaveBeenCalledWith(USER_ID, 'Starter', 'Unreadable');
    expect(approvedSpy).not.toHaveBeenCalled();
  });

  it('does not throw when sendPaymentApproved fails', async () => {
    vi.spyOn(emailService, 'sendPaymentApproved').mockRejectedValue(new Error('SMTP down'));

    queueApproveTransaction();

    await expect(
      adminService.reviewPayment(PAYMENT_ID, ADMIN_ID, 'approved'),
    ).resolves.toBeDefined();
  });

  it('does not throw when sendPaymentRejected fails', async () => {
    vi.spyOn(emailService, 'sendPaymentRejected').mockRejectedValue(new Error('SMTP down'));

    queueRejectTransaction();

    await expect(
      adminService.reviewPayment(PAYMENT_ID, ADMIN_ID, 'rejected', 'Reason'),
    ).resolves.toBeDefined();
  });
});
