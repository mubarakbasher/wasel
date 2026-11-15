import { CartesianFrame, ChartEmpty, MUTED_CLASS, type Common, type Series } from './chartCore';

/** What a column prints in the tooltip and the data table where it has no value. */
const NO_VALUE = '—';

export interface BarDatum {
  label: string;
  /**
   * Value per series key. null means there is no value: no bar, and a dash in
   * the tooltip and the data table. 0 is a value like any other: a bar of no
   * height, which reads "0". A missing key, a negative or a non-finite number
   * counts as 0.
   */
  values: Record<string, number | null>;
  /**
   * Draw this column lighter (a provisional month). The chart cannot say why a
   * column is lighter: say it in the label or in a caption beside the chart.
   */
  muted?: boolean;
}

type BarChartProps = Common & {
  data: BarDatum[];
  series: Series[];
  /** Stack the series in one bar per column instead of placing them side by side. */
  stacked?: boolean;
  /**
   * Pin the top of the axis (100 for a percentage); the data may still push it
   * higher. The ticks then sit at the quarters of `yMax`.
   */
  yMax?: number;
  /**
   * Formats the y-axis ticks; defaults to `valueFormat`.
   *
   * The ticks are round decimal steps of the raw values. Bytes are not decimal:
   * raw byte values give ticks that read "19 GB, 37 GB, 56 GB". Pass the values
   * already divided into the unit shown, or pin a round top with `yMax`.
   */
  axisFormat?: (n: number) => string;
};

/** Widest a bar gets, however much room its column has. */
const MAX_BAR_WIDTH = 24;
/** Share of its column a bar (or a group of bars) may fill. */
const BAND_FILL = 0.7;
/** Gap in the surface colour between fills that would otherwise touch. */
const SURFACE_GAP = 2;
/** Radius of a bar's data end. The baseline end stays square. */
const END_RADIUS = 4;
/** Narrowest bar that still keeps a gap to its neighbours. Thinner bars touch. */
const MIN_PARTED_WIDTH = 3;
/** How far a touching bar runs under the next one, so no seam shows between them. */
const SEAM_OVERLAP = 1;

const formatNumber = (n: number) => n.toLocaleString('en-GB');

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/** A bar from `yBottom` up to `yTop`, its top corners rounded by `radius`. */
function barPath(x: number, width: number, yTop: number, yBottom: number, radius: number): string {
  const left = round(x);
  const right = round(x + width);
  const bottom = round(yBottom);
  const topEdge = round(yTop);
  const r = round(Math.max(0, Math.min(radius, width / 2, yBottom - yTop)));
  if (r === 0) return `M${left} ${bottom}V${topEdge}H${right}V${bottom}Z`;
  return (
    `M${left} ${bottom}V${round(yTop + r)}A${r} ${r} 0 0 1 ${round(x + r)} ${topEdge}` +
    `H${round(x + width - r)}A${r} ${r} 0 0 1 ${right} ${round(yTop + r)}V${bottom}Z`
  );
}

/**
 * Vertical bar chart: one column per datum, its series stacked or side by side.
 *
 * Bars always grow from a zero baseline. Each is at most 24px wide with a
 * rounded data end, and touching fills are parted by a 2px gap rather than an
 * outline. When there are so many columns that a bar would be under 3px wide (a
 * year of days), the bars are drawn edge to edge instead, as one silhouette.
 *
 * Zero and "no value" are different. A zero is a bar of no height: nothing
 * rises from the baseline and the column reads "0"; an all-zero chart still
 * draws its axes, because zero is data. A null draws nothing either, but its
 * column reads as a dash. Both keep their place and their label on the x-axis.
 * With no value at all (no data, or every value null), the empty block is shown.
 */
export default function BarChart({
  ariaLabel,
  height = 240,
  valueFormat,
  emptyMessage,
  data,
  series,
  stacked = false,
  yMax,
  axisFormat,
}: BarChartProps) {
  const values = data.map((datum) =>
    series.map((s) => {
      const v = datum.values[s.key];
      if (v === null) return null;
      return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;
    }),
  );

  // No columns, no series, or nothing but nulls: there is no value to show.
  if (!values.some((row) => row.some((v) => v !== null))) {
    return <ChartEmpty ariaLabel={ariaLabel} height={height} message={emptyMessage} />;
  }

  const heights = values.map((row) => row.map((v) => v ?? 0));
  const maxValue = Math.max(
    0,
    ...heights.map((row) => (stacked ? row.reduce((sum, v) => sum + v, 0) : Math.max(...row))),
  );

  return (
    <CartesianFrame
      kind="bar"
      ariaLabel={ariaLabel}
      height={height}
      labels={data.map((datum) => datum.label)}
      series={series}
      values={values}
      maxValue={maxValue}
      yMax={yMax}
      valueFormat={valueFormat ?? formatNumber}
      axisFormat={axisFormat ?? valueFormat}
      noValueText={NO_VALUE}
      showTotal={stacked}
    >
      {(plot) => {
        const band = plot.width / data.length;
        const perColumn = stacked ? 1 : series.length;
        const partedGap = perColumn > 1 ? Math.min(SURFACE_GAP, band * 0.04) : 0;
        const partedWidth = Math.min(
          MAX_BAR_WIDTH,
          (band * BAND_FILL - partedGap * (perColumn - 1)) / perColumn,
        );
        // Slivers of surface between bars this thin shimmer as stripes instead of
        // reading as gaps: the bars fill their columns and touch.
        const touching = partedWidth < MIN_PARTED_WIDTH;
        const gap = touching ? 0 : partedGap;
        const barWidth = touching ? band / perColumn : partedWidth;
        const groupWidth = barWidth * perColumn + gap * (perColumn - 1);
        const yOf = (v: number) => plot.height * (1 - v / plot.top);

        // A null has no height, like a zero: neither draws a mark.
        return heights.map((row, i) => {
          const start = (i + 0.5) * band - groupWidth / 2;
          const tint = data[i].muted ? MUTED_CLASS : '';
          // A lighter bar is see-through, so an overlap would show as a darker line.
          const overlap = touching && !data[i].muted ? SEAM_OVERLAP : 0;
          const lastDrawn = row.reduce((last, v, k) => (v > 0 ? k : last), -1);
          let below = 0;
          let drawn = 0;

          return row.map((v, k) => {
            if (v <= 0) return null;
            const s = series[k];
            let yBottom = yOf(stacked ? below : 0);
            // A value too small to see still gets a 1px sliver: it is not zero.
            const yTop = Math.min(yOf(stacked ? below + v : v), yBottom - 1);
            // Part a segment from the one under it with a gap in the surface colour.
            if (stacked && drawn > 0) yBottom -= Math.min(SURFACE_GAP, (yBottom - yTop) / 2);
            if (stacked) below += v;
            drawn += 1;
            const x = Math.max(0, stacked ? start : start + k * (barWidth + gap));
            const width = Math.min(barWidth + overlap, plot.width - x);
            const isDataEnd = !touching && (!stacked || k === lastDrawn);

            return (
              <path
                key={`${i}-${k}`}
                data-mark="bar"
                data-series={s.key}
                data-index={i}
                d={barPath(x, width, yTop, yBottom, isDataEnd ? END_RADIUS : 0)}
                className={`fill-current ${s.colorClass} ${tint}`}
              />
            );
          });
        });
      }}
    </CartesianFrame>
  );
}
