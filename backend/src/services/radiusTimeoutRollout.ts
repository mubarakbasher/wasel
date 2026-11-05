/**
 * radiusTimeoutRollout.ts — gated rollout for the hourly RADIUS-timeout
 * ensure step.
 *
 * `RADIUS_TIMEOUT_ROLLOUT` env (parsed by backend/src/config/index.ts):
 *   - unset / empty        → OFF for everyone (default, safe)
 *   - "all"  (any case)    → ON for everyone
 *   - comma-separated IDs  → ON only for those router UUIDs (trimmed)
 *
 * Kept separate from routerOs.service.ts because the jobs' Vitest suites
 * routinely `vi.mock('../services/routerOs.service', ...)` wholesale — if
 * the gate lived there, tests could not exercise it without also
 * re-mocking the service.
 */
import { config } from '../config';

export function isRadiusTimeoutRolloutEnabled(routerId: string): boolean {
  const raw = (config.RADIUS_TIMEOUT_ROLLOUT ?? '').trim();
  if (raw === '') return false;
  if (raw.toLowerCase() === 'all') return true;
  const allowed = new Set(
    raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
  return allowed.has(routerId);
}
