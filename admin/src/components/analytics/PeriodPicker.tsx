import { useId, useState, type FormEvent } from 'react';
import type { AnalyticsTab } from '../../lib/analytics';
import {
  MAX_RANGE_DAYS,
  PRESETS,
  isDay,
  periodKey,
  rangeDays,
  type PeriodQuery,
} from '../../lib/period';
import Button from '../ui/Button';

interface PeriodPickerProps {
  /** Decides which presets are offered. */
  tab: AnalyticsTab;
  /** The applied period. */
  value: PeriodQuery;
  onChange: (next: PeriodQuery) => void;
  className?: string;
}

const segment =
  'cursor-pointer whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500';
const segmentOn = 'bg-white text-slate-900 shadow-sm';
const segmentOff = 'text-slate-500 hover:text-slate-700';

const dateInput =
  'rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500';

/**
 * The period choice of an analytics view: the tab's presets plus "Custom",
 * which opens two day inputs. Controlled: the pressed button always shows the
 * applied `value`, and a custom range only takes effect on Apply, so
 * half-typed dates never reach the API.
 */
export default function PeriodPicker({ tab, value, onChange, className = '' }: PeriodPickerProps) {
  const custom = 'from' in value ? value : null;
  const panelId = useId();
  const problemId = useId();

  const [open, setOpen] = useState(custom !== null);
  const [from, setFrom] = useState(custom?.from ?? '');
  const [to, setTo] = useState(custom?.to ?? '');

  // Follow the applied value when it changes from outside (a preset, the Back
  // button, another tab): an applied range shows its days, anything else closes
  // the inputs. Adjusted during render rather than in an effect, so the stale
  // state is never painted.
  const appliedKey = `${tab}:${periodKey(value)}`;
  const [seenKey, setSeenKey] = useState(appliedKey);
  if (seenKey !== appliedKey) {
    setSeenKey(appliedKey);
    setOpen(custom !== null);
    if (custom) {
      setFrom(custom.from);
      setTo(custom.to);
    }
  }

  const complete = isDay(from) && isDay(to);
  let problem: string | null = null;
  if (complete && from > to) {
    problem = 'From must be on or before To';
  } else if (complete && rangeDays(from, to) > MAX_RANGE_DAYS) {
    problem = `A range can cover at most ${MAX_RANGE_DAYS} days`;
  }
  const canApply = complete && problem === null;

  const apply = (event: FormEvent) => {
    event.preventDefault();
    if (canApply) onChange({ from, to });
  };

  return (
    <div className={`flex flex-col items-start gap-2 ${className}`}>
      <div
        role="group"
        aria-label="Period"
        className="inline-flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1"
      >
        {PRESETS[tab].map((preset) => {
          const active = 'period' in value && value.period === preset.key;
          return (
            <button
              key={preset.key}
              type="button"
              aria-pressed={active}
              onClick={() => {
                setOpen(false);
                onChange({ period: preset.key });
              }}
              className={`${segment} ${active ? segmentOn : segmentOff}`}
            >
              {preset.label}
            </button>
          );
        })}
        <button
          type="button"
          aria-pressed={custom !== null}
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          // An applied range keeps its days on show; otherwise Custom toggles the inputs.
          onClick={() => setOpen(custom !== null || !open)}
          className={`${segment} ${
            custom !== null ? segmentOn : open ? 'text-slate-900 ring-1 ring-slate-300' : segmentOff
          }`}
        >
          Custom
        </button>
      </div>

      {open && (
        <form id={panelId} onSubmit={apply} className="flex flex-wrap items-end gap-2" noValidate>
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-500">
            From
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              aria-invalid={problem !== null}
              aria-describedby={problem ? problemId : undefined}
              className={dateInput}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-500">
            To
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              aria-invalid={problem !== null}
              aria-describedby={problem ? problemId : undefined}
              className={dateInput}
            />
          </label>
          <Button type="submit" size="sm" disabled={!canApply}>
            Apply
          </Button>
        </form>
      )}
      {/* A sibling of the form, not a child: it lines up with the inputs on
          whichever side the caller aligns the picker. */}
      {open && problem && (
        <p id={problemId} role="alert" className="text-xs font-medium text-red-700">
          {problem}
        </p>
      )}
    </div>
  );
}
