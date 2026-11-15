import { CartesianFrame, ChartEmpty, type Common, type Series } from './chartCore';

export interface LinePoint {
  label: string;
  /** Value per series key. null (or a missing key) is a gap in that line. */
  values: Record<string, number | null>;
}

type LineChartProps = Common & {
  points: LinePoint[];
  series: Series[];
  /** Formats the y-axis ticks; defaults to `valueFormat`. */
  axisFormat?: (n: number) => string;
};

const formatNumber = (n: number) => n.toLocaleString('en-GB');

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Splits a series into unbroken runs of points. A null ends a run, so the line
 * is not drawn across days that have no value.
 */
function runsOf(ys: (number | null)[]): { index: number; y: number }[][] {
  const runs: { index: number; y: number }[][] = [];
  let run: { index: number; y: number }[] = [];
  ys.forEach((y, index) => {
    if (y === null) {
      if (run.length > 0) runs.push(run);
      run = [];
    } else {
      run.push({ index, y });
    }
  });
  if (run.length > 0) runs.push(run);
  return runs;
}

/**
 * Line chart on a zero baseline: one 2px line per series over shared columns.
 *
 * A series marked `dashed` is drawn dashed, so two lines are told apart by
 * more than colour. A null value breaks the line; a point with no neighbour
 * is drawn as a dot. A single series gets a faint area wash under it. With no
 * value to draw at all, the empty block is shown.
 */
export default function LineChart({
  ariaLabel,
  height = 240,
  valueFormat,
  emptyMessage,
  points,
  series,
  axisFormat,
}: LineChartProps) {
  const values = points.map((point) =>
    series.map((s) => {
      const v = point.values[s.key];
      return typeof v === 'number' && Number.isFinite(v) ? Math.max(0, v) : null;
    }),
  );
  const present = values.flat().filter((v): v is number => v !== null);

  if (present.length === 0) {
    return <ChartEmpty ariaLabel={ariaLabel} height={height} message={emptyMessage} />;
  }

  const count = points.length;
  const xFraction = (index: number) => (index + 0.5) / count;

  return (
    <CartesianFrame
      kind="line"
      ariaLabel={ariaLabel}
      height={height}
      labels={points.map((point) => point.label)}
      series={series}
      values={values}
      maxValue={Math.max(...present)}
      valueFormat={valueFormat ?? formatNumber}
      axisFormat={axisFormat ?? valueFormat}
      overlay={(plot) =>
        series.flatMap((s, k) => {
          const dot = (index: number, v: number, size: string, name: string) => (
            <span
              key={`${name}-${k}-${index}`}
              aria-hidden="true"
              data-mark={name}
              className={`pointer-events-none absolute rounded-full bg-current ring-2 ring-white ${size} ${s.colorClass}`}
              style={{
                left: `${round(xFraction(index) * 100)}%`,
                top: `${round((1 - v / plot.top) * 100)}%`,
                transform: 'translate(-50%, -50%)',
              }}
            />
          );
          // A point with no neighbour cannot be a line segment: draw it as a dot.
          const lone = runsOf(values.map((row) => row[k]))
            .filter((run) => run.length === 1)
            .map((run) => dot(run[0].index, run[0].y, 'h-2 w-2', 'point'));
          const activeValue = plot.active !== null ? values[plot.active][k] : null;
          const cursor =
            plot.active !== null && activeValue !== null
              ? [dot(plot.active, activeValue, 'h-2.5 w-2.5', 'cursor')]
              : [];
          return [...lone, ...cursor];
        })
      }
    >
      {(plot) => {
        const x = (index: number) => round(xFraction(index) * plot.width);
        const y = (v: number) => round(plot.height * (1 - v / plot.top));
        const baseline = round(plot.height);

        return series.map((s, k) => {
          const runs = runsOf(values.map((row) => row[k]));
          if (runs.length === 0) return null;
          const line = runs
            .map((run) => run.map((p, j) => `${j === 0 ? 'M' : 'L'}${x(p.index)} ${y(p.y)}`).join(''))
            .join('');
          const area = runs
            .filter((run) => run.length > 1)
            .map(
              (run) =>
                `M${x(run[0].index)} ${baseline}` +
                run.map((p) => `L${x(p.index)} ${y(p.y)}`).join('') +
                `L${x(run[run.length - 1].index)} ${baseline}Z`,
            )
            .join('');

          return (
            <g key={`${s.key}-${k}`} className={s.colorClass}>
              {series.length === 1 && area && (
                <path data-mark="area" d={area} className="fill-current" fillOpacity={0.1} stroke="none" />
              )}
              <path
                data-mark="line"
                data-series={s.key}
                d={line}
                fill="none"
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap={s.dashed ? 'butt' : 'round'}
                strokeDasharray={s.dashed ? '6 4' : undefined}
                vectorEffect="non-scaling-stroke"
                className="stroke-current"
              />
            </g>
          );
        });
      }}
    </CartesianFrame>
  );
}
