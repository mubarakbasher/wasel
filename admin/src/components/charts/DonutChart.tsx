export interface DonutSegment {
  /** Human-readable status label (e.g. "active", "pending change"). */
  label: string;
  /** Count for this segment. Negative values are clamped to 0. */
  value: number;
  /**
   * A Tailwind *text* color utility (e.g. "text-green-500"). The arc uses it
   * via `stroke-current` and the legend swatch via `bg-current`, so a single
   * class drives both and the colors always stay in sync.
   */
  colorClass: string;
}

interface DonutChartProps {
  segments: DonutSegment[];
  /** Outer pixel diameter of the ring. */
  size?: number;
}

/**
 * Pure-SVG donut chart — no charting dependency.
 *
 * The ring is a stack of `<circle>` arcs sharing one geometry; each arc draws a
 * `stroke-dasharray` slice and is pushed forward with `stroke-dashoffset`. The
 * grand total sits centered inside the ring and a text legend (swatch + label +
 * value + percentage) lists every segment. Accessibility: counts are ALWAYS
 * rendered as text (never color-only), and the SVG carries an aria-label that
 * summarizes the full breakdown.
 */
export default function DonutChart({ segments, size = 160 }: DonutChartProps) {
  const strokeWidth = Math.max(12, Math.round(size * 0.12));
  const radius = (size - strokeWidth) / 2;
  const center = size / 2;
  const circumference = 2 * Math.PI * radius;

  const total = segments.reduce((sum, s) => sum + Math.max(0, s.value), 0);

  const summary =
    total > 0
      ? segments
          .filter((s) => s.value > 0)
          .map(
            (s) =>
              `${s.label}: ${s.value} (${Math.round((s.value / total) * 100)}%)`,
          )
          .join(', ')
      : 'No data';

  // Running offset (in path units) so each arc begins where the previous ended.
  let offset = 0;

  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center">
      <div
        className="relative shrink-0"
        style={{ width: size, height: size }}
      >
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          role="img"
          aria-label={`Breakdown — ${summary}`}
        >
          {/* Track ring (also the "No data" ring when total is 0). */}
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            strokeWidth={strokeWidth}
            className="stroke-current text-slate-100"
          />
          {total > 0 &&
            segments.map((seg, i) => {
              const value = Math.max(0, seg.value);
              if (value === 0) return null;
              const dash = (value / total) * circumference;
              const node = (
                <circle
                  key={`${seg.label}-${i}`}
                  cx={center}
                  cy={center}
                  r={radius}
                  fill="none"
                  strokeWidth={strokeWidth}
                  strokeLinecap="butt"
                  strokeDasharray={`${dash} ${circumference - dash}`}
                  strokeDashoffset={-offset}
                  transform={`rotate(-90 ${center} ${center})`}
                  className={`stroke-current ${seg.colorClass}`}
                />
              );
              offset += dash;
              return node;
            })}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold tabular-nums text-slate-900">
            {total.toLocaleString()}
          </span>
          <span className="text-xs font-medium text-slate-400">
            {total > 0 ? 'Total' : 'No data'}
          </span>
        </div>
      </div>

      <ul className="w-full min-w-0 flex-1 space-y-2">
        {segments.length === 0 && (
          <li className="text-sm text-slate-400">No segments to show</li>
        )}
        {segments.map((seg, i) => {
          const value = Math.max(0, seg.value);
          const pct = total > 0 ? Math.round((value / total) * 100) : 0;
          return (
            <li
              key={`${seg.label}-${i}`}
              className="flex items-center gap-2.5 text-sm"
            >
              <span
                aria-hidden="true"
                className={`h-3 w-3 shrink-0 rounded-full bg-current ${seg.colorClass}`}
              />
              <span className="min-w-0 flex-1 truncate capitalize text-slate-600">
                {seg.label}
              </span>
              <span className="tabular-nums font-semibold text-slate-900">
                {value.toLocaleString()}
              </span>
              <span className="w-10 shrink-0 text-right tabular-nums text-xs text-slate-400">
                {pct}%
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
