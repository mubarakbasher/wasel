import { generateAccessToken } from '../services/token.service';

// ---------------------------------------------------------------------------
// Test user
// ---------------------------------------------------------------------------

export const TEST_USER = {
  userId: '550e8400-e29b-41d4-a716-446655440000',
  email: 'test@example.com',
  name: 'Test User',
  role: 'user',
};

export const TEST_USER_2 = {
  userId: '660e8400-e29b-41d4-a716-446655440000',
  email: 'other@example.com',
  name: 'Other User',
  role: 'user',
};

// ---------------------------------------------------------------------------
// Auth header helper
// ---------------------------------------------------------------------------

export function authHeader(): Record<string, string> {
  const token = generateAccessToken(TEST_USER);
  return { Authorization: `Bearer ${token}` };
}

export function authHeaderFor(user: { userId: string; email: string; name: string; role?: string }): Record<string, string> {
  const token = generateAccessToken({ ...user, role: user.role || 'user' });
  return { Authorization: `Bearer ${token}` };
}

// ---------------------------------------------------------------------------
// Active subscription mock row
// ---------------------------------------------------------------------------

const futureDate = new Date(Date.now() + 30 * 86400000); // 30 days from now
const pastDate = new Date(Date.now() - 1 * 86400000); // yesterday

export const ACTIVE_SUBSCRIPTION_ROW = {
  id: 'sub-001',
  user_id: TEST_USER.userId,
  plan_tier: 'starter',
  start_date: pastDate,
  end_date: futureDate,
  status: 'active',
  voucher_quota: 500,
  vouchers_used: 10,
  created_at: pastDate,
  updated_at: pastDate,
};

/**
 * Chain a mockResolvedValueOnce for the requireSubscription middleware query.
 * Call this BEFORE chaining any service-level query mocks.
 */
export function mockSubscriptionQuery(mockQuery: ReturnType<typeof import('vitest').vi.fn>): void {
  mockQuery.mockResolvedValueOnce({ rows: [ACTIVE_SUBSCRIPTION_ROW] });
}

/**
 * Chain a mockResolvedValueOnce that returns no subscription (403).
 */
export function mockNoSubscriptionQuery(mockQuery: ReturnType<typeof import('vitest').vi.fn>): void {
  mockQuery.mockResolvedValueOnce({ rows: [] });
}

// ---------------------------------------------------------------------------
// Common test UUIDs
// ---------------------------------------------------------------------------

export const TEST_ROUTER_ID = 'a0a00000-0000-4000-8000-000000000001';
export const TEST_VOUCHER_ID = 'b0b00000-0000-4000-8000-000000000001';
export const TEST_PROFILE_ID = 'c0c00000-0000-4000-8000-000000000001';
