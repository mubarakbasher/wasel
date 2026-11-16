import { z } from 'zod';
import { SPEED_VALUE_RE } from '../utils/radius';

export const SPEED_LIMIT_OPTIONS = [
  '256k', '512k', '1M', '2M', '3M', '4M', '5M', '10M',
] as const;

export const DEFAULT_SPEED_LIMIT = '2M';

export const cardSpeedUpdateSchema = z
  .object({
    enabled: z.boolean(),
    // When disabling, the app echoes back the currently-stored speed which may be
    // outside the option list (e.g. after an option is removed). Accept any
    // structurally-valid speed string; list membership is only enforced when enabling.
    speed: z.string().regex(SPEED_VALUE_RE, 'Invalid speed value'),
  })
  .strict()
  .refine(
    (d) => !d.enabled || (SPEED_LIMIT_OPTIONS as readonly string[]).includes(d.speed),
    { message: 'speed must be one of the supported options when enabling', path: ['speed'] },
  );

export type CardSpeedUpdate = z.infer<typeof cardSpeedUpdateSchema>;

export interface CardSpeedSetting {
  enabled: boolean;
  speed: string;
  options: readonly string[];
}
