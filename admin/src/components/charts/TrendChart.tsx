export interface TrendPoint {
  /** ISO date string, "YYYY-MM-DD". */
  date: string;
  value: number;
}

interface TrendChartProps {
  points: TrendPoint[];
  /** Tailwind *text* color utility (e.g. "text-emerald-500"). */
  colorClass?: string;
  /** Format the value for the latest-value label / aria summary. */
  valueFormat?: (n: number) => string;
  /** Pixel height of the plot area (date ticks render below it). */
  height?: number;
}

/** Short "Jun 1" style tick label. Parsed as UTC so a plain date never shifts. */
function shortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
  }).format(d);
}

/**
 * Pure-SVG responsive area + line chart — no charting dependency.
 *
 * The plot is drawn in a `viewBox` with `preserveAspectRatio="none"` so the
 * path stretches to fill any width; `vector-effect="non-scaling-stroke"` keeps
 * line/grid weights crisp under that non-uniform scale. Point markers and the
 * latest-value callout sit in a normal-aspect HTML overlay positioned by
 * percentage, so they align with the stretched path without distorting.
 */
export default function TrendChart({
  points,
  colorClass = 'text-blue-500',
  valueFormat = (n) => n.toLocaleString(),
  height = 180,
}: TrendChartProps) {
  if (points.length < 2) {
    const only = points[0];
    return (
      <div
        className="flex flex-col items-center justify-center gap-2 text-center"
        style={{ height }}
      >
        {only && (
          <span className={`h-3 w-3 rounded-full bg-current ${colorClass}`} />
        )}
        <p className="text-sm text-slate-400">Not enough data yet</p>
        {only && (
          <p className="tabular-nums text-sm font-semibold text-slate-700">
            {valueFormat(only.value)}
          </p>
        )}
      </div>
    );
  }

  // viewBox coordinate space. Width is arbitrary (stretched away); height maps
  // 1:1 to the rendered pixel height so vertical math reads naturally.
  const vbW = 100;
  const vbH = height;
  const padY = Math.min(16, vbH * 0.12);

  const values = points.map((p) => p.value);
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) {
    // Flat series — pad so the line sits mid-height instead of on an edge.
    const bump = Math.abs(max) || 1;
    min -= bump;
    max += bump;
  }

  const xFrac = (i: number) => i / (points.length - 1);
  const x = (i: number) => xFrac(i) * vbW;
  const yFrac = (v: number) => 1 - (v - min) / (max - min);
  const y = (v: number) => padY + yFrac(v) * (vbH - padY * 2);

  const linePath = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(p.value)}`)
    .join(' ');
  const areaPath =
    `M ${x(0)} ${vbH} ` +
    points.map((p, i) => `L ${x(i)} ${y(p.value)}`).join(' ') +
    ` L ${x(points.length - 1)} ${vbH} Z`;

  const last = points[points.length - 1];
  const lastTopPct = ((y(last.value) / vbH) * 100).toFixed(2);

  // Faint baseline grid: top / middle / bottom of the plot band.
  const gridYs = [padY, vbH / 2, vbH - padY];

  const first = points[0];
  const direction =
    last.value > first.value
      ? 'trending up'
      : last.value < first.value
        ? 'trending down'
        : 'flat';
  const ariaLabel = `Trend over ${points.length} points from ${shortDate(
    first.date,
  )} to ${shortDate(last.date)}, ${direction}, latest ${valueFormat(
    last.value,
  )}`;

  return (
    <div>
      <div className="relative w-full" style={{ height }}>
        <svg
          className="absolute inset-0 h-full w-full overflow-visible"
          viewBox={`0 0 ${vbW} ${vbH}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={ariaLabel}
        >
          <title>{ariaLabel}</title>
          {gridYs.map((gy, i) => (
            <line
              key={i}
              x1={0}
              x2={vbW}
              y1={gy}
              y2={gy}
              vectorEffect="non-scaling-stroke"
              className="stroke-current text-slate-100"
              strokeWidth={1}
            />
          ))}
          <path
            d={areaPath}
            className={`fill-current ${colorClass}`}
            fillOpacity={0.12}
            stroke="none"
          />
          <path
            d={linePath}
            fill="none"
            vectorEffect="non-scaling-stroke"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`stroke-current ${colorClass}`}
          />
        </svg>

        {/* Latest-value callout (top-right, never clips). */}
        <div className="pointer-events-none absolute right-0 top-0">
          <span
            className={`rounded-md bg-white/85 px-2 py-0.5 text-xs font-semibold tabular-nums shadow-sm ring-1 ring-slate-200 backdrop-blur ${colorClass}`}
          >
            {valueFormat(last.value)}
          </span>
        </div>

        {/* Marker on the latest point, aligned by percentage to the stretched path. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2"
          style={{ left: '100%', top: `${lastTopPct}%` }}
        >
          <span
            className={`block h-2.5 w-2.5 rounded-full bg-current ring-2 ring-white ${colorClass}`}
          />
        </span>
      </div>

      <div className="mt-2 flex justify-between text-xs tabular-nums text-slate-400">
        <span>{shortDate(first.date)}</span>
        <span>{shortDate(last.date)}</span>
      </div>
    </div>
  );
}
