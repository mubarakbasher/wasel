import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

/**
 * Shared pieces of the analytics charts (BarChart, LineChart, ShareBars,
 * HeatGrid) — no charting dependency.
 *
 * Technique, as in TrendChart: shapes are drawn in an SVG that stretches to its
 * box (`preserveAspectRatio="none"`), and every piece of text is HTML placed by
 * percentage so it never distorts.
 *
 * Accessibility contract, the same for every chart:
 *  - the drawing is one `role="img"` element named by `ariaLabel`;
 *  - the numbers behind it are repeated in a visually-hidden data table;
 *  - the tooltip shows on hover and on keyboard focus, and never holds a value
 *    that the table does not;
 *  - series are told apart by more than colour: a legend names them and a
 *    second line can be dashed.
 */

/** One plotted series. `colorClass` is a Tailwind *text* colour utility. */
export type Series = { key: string; label: string; colorClass: string; dashed?: boolean };

/** Props every chart takes. */
export type Common = {
  /** Accessible name of the chart. */
  ariaLabel: string;
  /**
   * Pixel height of the whole chart block — legend and axis labels included —
   * so the empty block is exactly as tall as the drawn chart.
   */
  height?: number;
  /** Formats a value for the tooltip and the data table. */
  valueFormat?: (n: number) => string;
  /** Shown instead of the chart when there is nothing to draw. */
  emptyMessage?: string;
};

/** What a chart draws against: the plot box in SVG units, and the axis top. */
export type Plot = {
  /** viewBox width; equals the rendered pixel width once measured. */
  width: number;
  /** viewBox height; equals the rendered pixel height once measured. */
  height: number;
  /** Value at the top of the y-axis. The baseline is always 0. */
  top: number;
  /** Column under the pointer or holding keyboard focus. */
  active: number | null;
};

export const DEFAULT_EMPTY_MESSAGE = 'No data in this period';

/** Class of a `muted` bar (a provisional month): the same hue, drawn lighter. */
export const MUTED_CLASS = 'opacity-40';

/**
 * Series colours, in the order to assign them. Green, amber and red already
 * mean status in this panel, so series use blue, violet and slate.
 *
 * The steps are not interchangeable: blue-500 beside violet-500 is nearly one
 * colour to a red-green colour-blind reader (separation 1.4, where 8 is the
 * target). These three were checked with the dataviz palette validator on a
 * white surface: colour-blind separation 10.3, normal-vision separation 19.7,
 * all three at least 3:1 against white. Slate fails one check on purpose, the
 * chroma floor: it is the neutral of the three, and it is told from blue by
 * its greyness. Use these constants rather than picking steps by eye.
 */
export const SERIES_BLUE = 'text-blue-500';
export const SERIES_VIOLET = 'text-violet-700';
export const SERIES_SLATE = 'text-slate-500';

const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500';

/**
 * Mark of the active cell of a grid: a dark line on the cell's edge and a white
 * line just inside it. Cells run from near-white to a strong colour, so a ring
 * of one tone (the blue focus ring above all) would vanish on some of them.
 */
const CELL_RING = 'outline-2 -outline-offset-2 outline-slate-900 inset-ring-[3px] inset-ring-white';
const CELL_FOCUS_RING =
  'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-slate-900 focus-visible:inset-ring-[3px] focus-visible:inset-ring-white';

/** Narrowest column on which a tinted band can still be seen as the cursor. */
const MIN_BAND_CURSOR = 8;

/** Percentage with at most two decimals, for inline styles. */
function pct(fraction: number): number {
  return Math.round(fraction * 10000) / 100;
}

// 'en' rather than 'en-GB': the British compact form is lower case ("10k", "1.2m").
const COMPACT_TICK = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const FULL_TICK = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 });

/**
 * Evenly spaced y-axis ticks from 0 up to a round top.
 *
 * `yMax` pins the top (a percentage axis ends at 100) unless the data is
 * larger. All-zero data gets a baseline tick only and a top of 1, so nothing
 * downstream divides by zero.
 */
function axisScale(
  maxValue: number,
  yMax: number | undefined,
  integers: boolean,
): { top: number; ticks: number[] } {
  const dataMax = Number.isFinite(maxValue) && maxValue > 0 ? maxValue : 0;
  if (yMax !== undefined && Number.isFinite(yMax) && yMax > 0 && yMax >= dataMax) {
    return { top: yMax, ticks: [0, yMax / 4, yMax / 2, (yMax * 3) / 4, yMax] };
  }
  if (dataMax === 0) return { top: 1, ticks: [0] };

  const rough = dataMax / 4;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const unit = rough / magnitude;
  let step = 10 * magnitude;
  for (const candidate of [1, 2, 2.5, 5, 10]) {
    const size = candidate * magnitude;
    // Counts get whole-number ticks: never "0.5 cards".
    if (unit <= candidate && (!integers || Number.isInteger(size))) {
      step = size;
      break;
    }
  }
  if (integers && step < 1) step = 1;
  const count = Math.max(1, Math.ceil(dataMax / step - 1e-9));
  return { top: count * step, ticks: Array.from({ length: count + 1 }, (_, i) => i * step) };
}

/** Size of an element's content box, in whole pixels; null until measured. */
function useMeasuredSize<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      const width = Math.round(rect.width);
      const height = Math.round(rect.height);
      if (width <= 0 || height <= 0) return;
      setSize((prev) =>
        prev && prev.width === width && prev.height === height ? prev : { width, height },
      );
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return [ref, size] as const;
}

/** Swatch that mirrors the mark it names: a block for bars, a stroke for lines. */
function SeriesKey({
  colorClass,
  dashed,
  mark,
}: {
  colorClass: string;
  dashed?: boolean;
  mark: 'rect' | 'line';
}) {
  if (mark === 'rect') {
    return (
      <span aria-hidden="true" className={`h-2.5 w-2.5 shrink-0 rounded-[2px] bg-current ${colorClass}`} />
    );
  }
  return (
    <span
      aria-hidden="true"
      className={`w-5 shrink-0 border-t-2 border-current ${dashed ? 'border-dashed' : ''} ${colorClass}`}
    />
  );
}

/** Same-height stand-in for a chart that has nothing to draw. */
export function ChartEmpty({
  ariaLabel,
  height,
  message,
}: {
  ariaLabel: string;
  height: number;
  message?: string;
}) {
  const messageId = useId();
  return (
    <div
      role="img"
      aria-label={ariaLabel}
      aria-describedby={messageId}
      data-chart-empty=""
      className="flex items-center justify-center rounded-lg bg-slate-50 px-4 text-center"
      style={{ height }}
    >
      <p id={messageId} className="text-sm text-slate-500">
        {message ?? DEFAULT_EMPTY_MESSAGE}
      </p>
    </div>
  );
}

/** Names the series. Left out for a single series: the chart's title names it. */
export function ChartLegend({ series, mark }: { series: Series[]; mark: 'rect' | 'line' }) {
  if (series.length < 2) return null;
  return (
    <ul
      aria-label="Legend"
      data-chart-legend=""
      className="mb-2 flex shrink-0 flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600"
    >
      {series.map((s, i) => (
        <li key={`${s.key}-${i}`} className="flex items-center gap-1.5">
          <SeriesKey colorClass={s.colorClass} dashed={s.dashed} mark={mark} />
          {s.label}
        </li>
      ))}
    </ul>
  );
}

export type TooltipRow = {
  label: string;
  value: string;
  /** Series colour; leave out for a row that is not a series (a total). */
  colorClass?: string;
  dashed?: boolean;
};

/**
 * Hover / focus readout, placed inside the plot by percentage. It sits on the
 * side of its anchor that has more room, so it never leaves the plot.
 *
 * Hidden from assistive tech: the focused hit target already carries the same
 * words as its accessible name.
 */
export function ChartTooltip({
  xPct,
  topPct,
  bottomPct,
  title,
  rows,
}: {
  /** Horizontal anchor, 0–100. */
  xPct: number;
  /** Vertical anchor from the top of the plot; defaults to the top edge. */
  topPct?: number;
  /** Vertical anchor from the bottom of the plot; wins over `topPct`. */
  bottomPct?: number;
  title: string;
  rows: TooltipRow[];
}) {
  const style: CSSProperties = xPct > 50 ? { right: `${pct(1 - xPct / 100)}%` } : { left: `${pct(xPct / 100)}%` };
  if (bottomPct !== undefined) style.bottom = `${bottomPct}%`;
  else style.top = `${topPct ?? 0}%`;

  return (
    <div
      aria-hidden="true"
      data-chart-tooltip=""
      className="pointer-events-none absolute z-10 mx-2.5 my-1 w-max max-w-[15rem] rounded-lg bg-white px-3 py-2 text-xs shadow-lg ring-1 ring-slate-200"
      style={style}
    >
      <p className="font-medium text-slate-500">{title}</p>
      <ul className="mt-1 space-y-0.5">
        {rows.map((row, i) => (
          <li key={i} className="flex items-center gap-2">
            {row.colorClass && <SeriesKey colorClass={row.colorClass} dashed={row.dashed} mark="line" />}
            {row.label && <span className="text-slate-500">{row.label}</span>}
            {/* The value is the strong element: the reader has the series, and wants the number. */}
            <span className={`font-semibold tabular-nums text-slate-900 ${row.label ? 'ml-auto pl-2' : ''}`}>
              {row.value}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The chart's numbers as a real table, visually hidden. It is the text
 * alternative of the drawing, so it lives outside the `role="img"` element.
 */
export function ChartDataTable({
  ariaLabel,
  corner,
  columns,
  rows,
}: {
  ariaLabel: string;
  /** Header of the label column; leave out for a blank corner cell. */
  corner?: string;
  columns: string[];
  rows: { label: string; cells: string[] }[];
}) {
  return (
    // The wrapper, not the table, is clipped: a table ignores a 1px width.
    <div className="sr-only">
      <table aria-label={`${ariaLabel} (data table)`}>
        <thead>
          <tr>
            {corner ? <th scope="col">{corner}</th> : <td />}
            {columns.map((column, i) => (
              <th key={i} scope="col">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              <th scope="row">{row.label}</th>
              {row.cells.map((cell, j) => (
                <td key={j}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Invisible hit targets laid over a plot, row-major: one per column of a bar or
 * line chart (`rows = 1`), one per cell of a grid. Each target is far larger
 * than the mark under it, so the pointer only has to be in the right column.
 *
 * Keyboard: the whole layer is a single tab stop; the arrow keys, Home and End
 * move between targets, and Escape dismisses the readout.
 */
export function HitGrid({
  columns,
  rows,
  active,
  tabStop,
  labelFor,
  onHover,
  onFocus,
  cursor,
}: {
  columns: number;
  rows: number;
  /** Target whose readout is showing. */
  active: number | null;
  /** The one target reachable with Tab. */
  tabStop: number;
  /** Accessible name of a target: the same words as its tooltip. */
  labelFor: (index: number) => string;
  onHover: (index: number | null) => void;
  onFocus: (index: number | null) => void;
  /** How the active target is marked: a tinted band, a hairline, or a two-tone ring. */
  cursor: 'band' | 'line' | 'cell';
}) {
  const count = columns * rows;

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const column = index % columns;
    let next: number;
    switch (event.key) {
      case 'ArrowRight':
        next = column < columns - 1 ? index + 1 : index;
        break;
      case 'ArrowLeft':
        next = column > 0 ? index - 1 : index;
        break;
      case 'ArrowDown':
        // A one-row layer leaves the vertical arrows to the page scroll.
        if (rows === 1) return;
        next = index + columns < count ? index + columns : index;
        break;
      case 'ArrowUp':
        if (rows === 1) return;
        next = index - columns >= 0 ? index - columns : index;
        break;
      case 'Home':
        next = index - column;
        break;
      case 'End':
        next = index - column + columns - 1;
        break;
      case 'Escape':
        onHover(null);
        event.currentTarget.blur();
        return;
      default:
        return;
    }
    event.preventDefault();
    const target = event.currentTarget.parentElement?.children[next];
    if (target instanceof HTMLElement) target.focus();
  };

  return (
    <div
      className="absolute inset-0 grid"
      style={{
        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
      }}
      onPointerLeave={() => onHover(null)}
    >
      {Array.from({ length: count }, (_, i) => {
        const isActive = active === i;
        const mark =
          isActive && cursor === 'band' ? 'bg-slate-900/5' : isActive && cursor === 'cell' ? CELL_RING : '';
        return (
          <button
            key={i}
            type="button"
            data-chart-hit=""
            tabIndex={i === tabStop ? 0 : -1}
            aria-label={labelFor(i)}
            className={`relative min-w-0 cursor-default ${cursor === 'cell' ? CELL_FOCUS_RING : FOCUS_RING} ${mark}`}
            onPointerEnter={() => onHover(i)}
            onFocus={() => onFocus(i)}
            onBlur={() => onFocus(null)}
            // Touch browsers do not focus a button on tap; do it so the readout stays.
            onClick={(event) => event.currentTarget.focus()}
            onKeyDown={(event) => onKeyDown(event, i)}
          >
            {isActive && cursor === 'line' && (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-slate-300"
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Room an x-axis label needs, and how close to an edge it must be to hug it. */
const X_LABEL_SLOT = 64;
const X_LABEL_EDGE = 28;
/** Room a label hugging an edge and its centred neighbour need between them. */
const X_LABEL_PAIR = 84;

/**
 * Everything a bar or line chart shares: legend, y-axis ticks, gridlines,
 * x-axis labels, the hover / focus layer with its tooltip, and the hidden data
 * table. The chart itself only supplies the marks, through `children`.
 *
 * The plot box is measured, and the SVG's viewBox is set to that size, so one
 * SVG unit is one pixel: bars can be capped at a pixel width and corners stay
 * round. Until the first measurement (and in tests) an estimate is used and the
 * SVG simply stretches, so the chart is never wrong, only less exact.
 */
export function CartesianFrame({
  kind,
  ariaLabel,
  height,
  labels,
  series,
  values,
  maxValue,
  yMax,
  valueFormat,
  axisFormat,
  noValueText = 'No data',
  showTotal = false,
  children,
  overlay,
}: {
  kind: 'bar' | 'line';
  ariaLabel: string;
  height: number;
  /** One label per column, left to right. */
  labels: string[];
  series: Series[];
  /** `values[column][series]`; null is a gap: there is no value, which is not a zero. */
  values: (number | null)[][];
  /** Largest value the axis has to hold (a stack's total, for stacked bars). */
  maxValue: number;
  yMax?: number;
  valueFormat: (n: number) => string;
  /** Tick labels; defaults to plain numbers, compact from 10,000 up. */
  axisFormat?: (n: number) => string;
  /** What a null prints as in the tooltip, the data table and a column's accessible name. */
  noValueText?: string;
  /** Adds a total to the tooltip and the table (stacked bars). */
  showTotal?: boolean;
  /** SVG marks, drawn in `plot` units. */
  children: (plot: Plot) => ReactNode;
  /** HTML markers placed by percentage (dots, which must not stretch). */
  overlay?: (plot: Plot) => ReactNode;
}) {
  const [plotRef, measured] = useMeasuredSize<HTMLDivElement>();
  const [hovered, setHovered] = useState<number | null>(null);
  const [focused, setFocused] = useState<number | null>(null);

  const count = labels.length;
  const hasLegend = series.length > 1;
  const width = measured?.width ?? 600;
  const plotHeight = measured?.height ?? Math.max(40, height - (hasLegend ? 54 : 30));

  const integers = values.every((row) => row.every((v) => v === null || Number.isInteger(v)));
  const { top, ticks } = axisScale(maxValue, yMax, integers);
  const tickFormat =
    axisFormat ?? ((n: number) => (top >= 10_000 ? COMPACT_TICK.format(n) : FULL_TICK.format(n)));

  const candidate = hovered ?? focused;
  const active = candidate !== null && candidate < count ? candidate : null;
  const plot: Plot = { width, height: plotHeight, top, active };

  const cell = (v: number | null) => (v === null ? noValueText : valueFormat(v));
  // The total of a column with no value at all is no value either, not a zero.
  const totalOf = (row: (number | null)[]) =>
    row.reduce<number | null>((sum, v) => (v === null ? sum : (sum ?? 0) + v), null);
  const withTotal = showTotal && series.length > 1;

  // Thin the x labels to what fits, counting back from the latest column so
  // the most recent one is always named.
  const band = width / count;
  const centreOf = (i: number) => (i + 0.5) * band;
  const hugsLeft = (i: number) => count > 1 && centreOf(i) < X_LABEL_EDGE;
  const hugsRight = (i: number) => count > 1 && width - centreOf(i) < X_LABEL_EDGE;
  const stride = Math.max(1, Math.ceil(count / Math.max(2, Math.floor(width / X_LABEL_SLOT))));
  let shownLabels = labels.map((_, i) => i).filter((i) => (count - 1 - i) % stride === 0);
  // A label that hugs an edge sits off its column, towards its neighbour: drop
  // the neighbour (or, on the left, the hugging label) when the two would touch.
  if (shownLabels.length > 1 && hugsRight(count - 1)) {
    const neighbour = shownLabels[shownLabels.length - 2];
    if (width - centreOf(neighbour) < X_LABEL_PAIR) shownLabels = shownLabels.filter((i) => i !== neighbour);
  }
  if (shownLabels.length > 1 && hugsLeft(shownLabels[0]) && centreOf(shownLabels[1]) < X_LABEL_PAIR) {
    shownLabels = shownLabels.slice(1);
  }

  return (
    <div data-chart={kind} className="relative flex flex-col" style={{ height }}>
      <ChartLegend series={series} mark={kind === 'bar' ? 'rect' : 'line'} />

      <div className="grid min-h-0 flex-1 grid-cols-[auto_minmax(0,1fr)] grid-rows-[minmax(0,1fr)_auto] pt-2">
        <div
          aria-hidden="true"
          data-chart-axis="y"
          className="flex flex-col-reverse justify-between pr-2 text-xs tabular-nums text-slate-400"
        >
          {ticks.map((tick) => (
            // Zero-height rows: each label is centred on its gridline.
            <span key={tick} className="flex h-0 items-center justify-end whitespace-nowrap">
              {tickFormat(tick)}
            </span>
          ))}
        </div>

        <div ref={plotRef} className="relative min-h-0 min-w-0">
          <svg
            role="img"
            aria-label={ariaLabel}
            className="absolute inset-0 h-full w-full overflow-visible"
            viewBox={`0 0 ${width} ${plotHeight}`}
            preserveAspectRatio="none"
          >
            {ticks.map((tick) => {
              const y = Math.round(plotHeight * (1 - tick / top) * 100) / 100;
              return (
                <line
                  key={tick}
                  x1={0}
                  x2={width}
                  y1={y}
                  y2={y}
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                  className={`stroke-current ${tick === 0 ? 'text-slate-300' : 'text-slate-100'}`}
                />
              );
            })}
            {children(plot)}
          </svg>

          <HitGrid
            columns={count}
            rows={1}
            active={active}
            tabStop={focused !== null && focused < count ? focused : 0}
            labelFor={(i) =>
              `${labels[i]}: ${series.map((s, k) => `${s.label} ${cell(values[i][k])}`).join(', ')}`
            }
            onHover={setHovered}
            onFocus={setFocused}
            // A year of daily bars: the band would be a pixel or two wide, so use the hairline.
            cursor={kind === 'bar' && band >= MIN_BAND_CURSOR ? 'band' : 'line'}
          />

          {overlay?.(plot)}

          {active !== null && (
            <ChartTooltip
              xPct={((active + 0.5) / count) * 100}
              title={labels[active]}
              rows={[
                ...series.map((s, k) => ({
                  label: s.label,
                  value: cell(values[active][k]),
                  colorClass: s.colorClass,
                  dashed: s.dashed,
                })),
                ...(withTotal ? [{ label: 'Total', value: cell(totalOf(values[active])) }] : []),
              ]}
            />
          )}
        </div>

        <div />
        <div
          aria-hidden="true"
          data-chart-axis="x"
          className="relative mt-1.5 h-4 text-xs leading-4 tabular-nums text-slate-400"
        >
          {shownLabels.map((i) => {
            // A label next to an edge hugs it instead of hanging outside the plot.
            const style: CSSProperties = hugsLeft(i)
              ? { left: 0 }
              : hugsRight(i)
                ? { right: 0 }
                : { left: `${pct(centreOf(i) / width)}%`, transform: 'translateX(-50%)' };
            return (
              <span key={i} className="absolute top-0 whitespace-nowrap" style={style}>
                {labels[i]}
              </span>
            );
          })}
        </div>
      </div>

      <ChartDataTable
        ariaLabel={ariaLabel}
        corner="Category"
        columns={[...series.map((s) => s.label), ...(withTotal ? ['Total'] : [])]}
        rows={labels.map((label, i) => ({
          label,
          cells: [...values[i].map(cell), ...(withTotal ? [cell(totalOf(values[i]))] : [])],
        }))}
      />
    </div>
  );
}
