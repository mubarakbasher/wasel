import { useState } from 'react';

import { ChartDataTable, ChartEmpty, ChartTooltip, HitGrid, type Common } from './chartCore';

type HeatGridProps = Common & {
  /** `cells[row][col]`. A negative or non-finite value counts as 0. */
  cells: number[][];
  rowLabels: string[];
  colLabels: string[];
  /** Tailwind *text* colour utility: the one hue the scale runs on. */
  colorClass?: string;
};

/**
 * Opacity of each step of the scale, lightest first. One hue from near the
 * surface to full strength: more is darker. Zero is not on the scale; it is
 * drawn as a neutral cell.
 */
const STEP_OPACITY = [0.2, 0.4, 0.6, 0.8, 1];
const ZERO_CLASS = 'text-slate-100';
/** Most column labels shown; past it they are thinned so they do not crowd. */
const MAX_COL_LABELS = 8;

const formatNumber = (n: number) => n.toLocaleString('en-GB');

/**
 * Grid of cells shaded by value: rows × columns, such as weekday × hour.
 *
 * Values are binned into five steps of one hue relative to the largest value,
 * which always gets the strongest step; a scale legend names the direction.
 * Cells are parted by a 2px gap in the surface colour. Each cell has its own
 * hover / focus readout, and the arrow keys walk the grid. With no cells, or
 * nothing above zero, the empty block is shown.
 */
export default function HeatGrid({
  ariaLabel,
  height = 240,
  valueFormat = formatNumber,
  emptyMessage,
  cells,
  rowLabels,
  colLabels,
  colorClass = 'text-blue-600',
}: HeatGridProps) {
  const [hovered, setHovered] = useState<number | null>(null);
  const [focused, setFocused] = useState<number | null>(null);

  const rows = cells.length;
  const cols = cells.reduce((widest, row) => Math.max(widest, row.length), 0);
  const valueAt = (row: number, col: number) => {
    const v = cells[row]?.[col];
    return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;
  };
  let peak = 0;
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) peak = Math.max(peak, valueAt(row, col));
  }

  if (rows === 0 || cols === 0 || peak <= 0) {
    return <ChartEmpty ariaLabel={ariaLabel} height={height} message={emptyMessage} />;
  }

  const count = rows * cols;
  const stepOf = (v: number) =>
    v <= 0 ? 0 : Math.min(STEP_OPACITY.length, Math.max(1, Math.ceil((v * STEP_OPACITY.length) / peak - 1e-9)));
  const rowLabel = (row: number) => rowLabels[row] ?? '';
  const colLabel = (col: number) => colLabels[col] ?? '';

  const candidate = hovered ?? focused;
  const active = candidate !== null && candidate < count ? candidate : null;
  const activeRow = active === null ? 0 : Math.floor(active / cols);
  const activeCol = active === null ? 0 : active % cols;
  const labelStride = Math.max(1, Math.ceil(cols / MAX_COL_LABELS));

  return (
    <div data-chart="heat" className="relative flex flex-col" style={{ height }}>
      <div className="grid min-h-0 flex-1 grid-cols-[auto_minmax(0,1fr)] grid-rows-[minmax(0,1fr)_auto]">
        <div aria-hidden="true" className="flex flex-col pr-2 text-xs text-slate-400">
          {Array.from({ length: rows }, (_, row) => (
            <span key={row} className="flex min-h-0 flex-1 items-center justify-end whitespace-nowrap">
              {rowLabel(row)}
            </span>
          ))}
        </div>

        <div className="relative min-h-0 min-w-0">
          <svg
            role="img"
            aria-label={ariaLabel}
            className="absolute inset-0 h-full w-full"
            viewBox={`0 0 ${cols} ${rows}`}
            preserveAspectRatio="none"
          >
            {Array.from({ length: count }, (_, i) => {
              const step = stepOf(valueAt(Math.floor(i / cols), i % cols));
              return (
                <rect
                  key={i}
                  data-mark="cell"
                  data-step={step}
                  x={i % cols}
                  y={Math.floor(i / cols)}
                  width={1}
                  height={1}
                  // The white stroke is the gap between cells, not an outline.
                  strokeWidth={2}
                  vectorEffect="non-scaling-stroke"
                  fillOpacity={step === 0 ? 1 : STEP_OPACITY[step - 1]}
                  className={`fill-current stroke-white ${step === 0 ? ZERO_CLASS : colorClass}`}
                />
              );
            })}
          </svg>

          <HitGrid
            columns={cols}
            rows={rows}
            active={active}
            tabStop={focused !== null && focused < count ? focused : 0}
            labelFor={(i) =>
              `${rowLabel(Math.floor(i / cols))}, ${colLabel(i % cols)}: ${valueFormat(
                valueAt(Math.floor(i / cols), i % cols),
              )}`
            }
            onHover={setHovered}
            onFocus={setFocused}
            cursor="cell"
          />

          {active !== null && (
            <ChartTooltip
              xPct={((activeCol + 0.5) / cols) * 100}
              // Below a cell in the upper half, above one in the lower half.
              topPct={activeRow < rows / 2 ? ((activeRow + 1) / rows) * 100 : undefined}
              bottomPct={activeRow < rows / 2 ? undefined : ((rows - activeRow) / rows) * 100}
              title={`${rowLabel(activeRow)}, ${colLabel(activeCol)}`}
              rows={[{ label: '', value: valueFormat(valueAt(activeRow, activeCol)) }]}
            />
          )}
        </div>

        <div />
        <div aria-hidden="true" className="mt-1 flex text-xs leading-4 tabular-nums text-slate-400">
          {Array.from({ length: cols }, (_, col) => (
            <span key={col} className="flex min-w-0 flex-1 justify-center whitespace-nowrap">
              {col % labelStride === 0 ? colLabel(col) : ''}
            </span>
          ))}
        </div>
      </div>

      <div aria-hidden="true" className="mt-2 flex shrink-0 items-center justify-end gap-1.5 text-xs text-slate-400">
        <span>Less</span>
        <span className={`flex gap-0.5 ${colorClass}`}>
          {STEP_OPACITY.map((opacity) => (
            <span key={opacity} className="h-2.5 w-4 rounded-[2px] bg-current" style={{ opacity }} />
          ))}
        </span>
        <span>More</span>
      </div>

      <ChartDataTable
        ariaLabel={ariaLabel}
        columns={Array.from({ length: cols }, (_, col) => colLabel(col))}
        rows={Array.from({ length: rows }, (_, row) => ({
          label: rowLabel(row),
          cells: Array.from({ length: cols }, (_, col) => valueFormat(valueAt(row, col))),
        }))}
      />
    </div>
  );
}
