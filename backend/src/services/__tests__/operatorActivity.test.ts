import { describe, it, expect, vi, beforeEach } from 'vitest';
import logger from '../../config/logger';

const mockPoolQuery = (globalThis as Record<string, unknown>).__mockPoolQuery as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockPoolQuery.mockReset();
});

describe('touchOperatorActivity', () => {
  it('throttles to 5 minutes in SQL', async () => {
    // Use actual implementation (not the global mock in setup.ts)
    const { touchOperatorActivity } = await vi.importActual<typeof import('../../services/operatorActivity.service')>(
      '../../services/operatorActivity.service',
    );

    mockPoolQuery.mockResolvedValueOnce({ rowCount: 1 });

    await touchOperatorActivity('user-123');

    expect(mockPoolQuery).toHaveBeenCalledOnce();
    const sql = mockPoolQuery.mock.calls[0][0] as string;
    expect(sql).toContain("INTERVAL '5 minutes'");
  });

  it('resolves when the database rejects', async () => {
    const logErrorSpy = vi.spyOn(logger, 'error').mockImplementation(() => logger);
    const { touchOperatorActivity } = await vi.importActual<typeof import('../../services/operatorActivity.service')>(
      '../../services/operatorActivity.service',
    );

    mockPoolQuery.mockRejectedValueOnce(new Error('DB error'));

    await expect(touchOperatorActivity('user-456')).resolves.toBeUndefined();
    expect(logErrorSpy).toHaveBeenCalledOnce();
  });

  it('a rejected touch raises no unhandledRejection', async () => {
    const { touchOperatorActivity } = await vi.importActual<typeof import('../../services/operatorActivity.service')>(
      '../../services/operatorActivity.service',
    );

    mockPoolQuery.mockRejectedValueOnce(new Error('DB error'));

    const unhandledSpy = vi.fn();
    process.on('unhandledRejection', unhandledSpy);

    void touchOperatorActivity('user-789').catch(() => undefined);

    // Give microtasks time to settle
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    process.removeListener('unhandledRejection', unhandledSpy);
    expect(unhandledSpy).not.toHaveBeenCalled();
  });
});
