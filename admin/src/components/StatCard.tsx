import type { ReactNode } from 'react';
import { Minus, TrendingDown, TrendingUp } from 'lucide-react';

export interface StatCardDelta {
  /** Already formatted, e.g. "+18%". */
  text: string;
  direction: 'up' | 'down' | 'flat';
  /** Whether the change is good news: a rise in income is, a rise in quiet operators is not. */
  good: boolean;
}

interface StatCardProps {
  title: string;
  value: string | number;
  icon: ReactNode;
  color?: string;
  /** A small line under the value, e.g. "+3 granted". */
  sub?: ReactNode;
  /** The change against the previous period, shown before the sub line. */
  delta?: StatCardDelta;
}

const DELTA_ICON = { up: TrendingUp, down: TrendingDown, flat: Minus };

function deltaTone(delta: StatCardDelta): string {
  if (delta.direction === 'flat') return 'text-slate-500';
  return delta.good ? 'text-green-700' : 'text-red-700';
}

/**
 * The type size of the value line. A value is never cut off: up to 13
 * characters ("SDG 1,240,000") it is set as large as ever, a longer one ("SDG
 * 12,480,000") steps down so it still fits on one line where the cards are
 * narrowest, and whatever is wider than its card wraps onto a second line.
 */
function valueSize(value: string | number): string {
  const length = String(value).length;
  if (length <= 13) return 'text-2xl';
  if (length <= 15) return 'text-xl';
  return 'text-lg';
}

export default function StatCard({
  title,
  value,
  icon,
  color = 'bg-blue-50 text-blue-600',
  sub,
  delta,
}: StatCardProps) {
  const hasSub = sub !== undefined && sub !== null && sub !== false && sub !== '';
  const DeltaIcon = delta ? DELTA_ICON[delta.direction] : null;

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6 flex items-center gap-4 min-w-0">
      <div className={`flex items-center justify-center w-12 h-12 shrink-0 rounded-lg ${color}`}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-sm font-medium text-slate-500 truncate">{title}</p>
        {/* One line height for every size, so a card with a smaller value is as tall as its neighbours. */}
        <p
          className={`${valueSize(value)} leading-8 font-bold text-slate-900 tabular-nums break-words`}
        >
          {value}
        </p>
        {(delta || hasSub) && (
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500">
            {delta && DeltaIcon && (
              <span
                data-delta={delta.direction}
                className={`inline-flex shrink-0 items-center gap-1 font-semibold tabular-nums ${deltaTone(delta)}`}
              >
                <DeltaIcon className="h-3.5 w-3.5" aria-hidden="true" />
                {delta.text}
              </span>
            )}
            {hasSub && <span className="min-w-0">{sub}</span>}
          </div>
        )}
      </div>
    </div>
  );
}
