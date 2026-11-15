import { ChartDataTable, ChartEmpty, SERIES_BLUE, type Common } from './chartCore';

export interface ShareItem {
  label: string;
  /** A negative or non-finite value counts as 0. */
  value: number;
  /** Tailwind *text* colour utility for this bar; defaults to the first series colour. */
  colorClass?: string;
}

type ShareBarsProps = Common & {
  items: ShareItem[];
  /** Most named rows to show. The rest are added up in one "Other" row. */
  maxItems?: number;
};

/** Height of the empty block, and the least height of the list, when none is given. */
const DEFAULT_HEIGHT = 160;
/** The folded "Other" row is context, not a part to compare: neutral grey. */
const OTHER_CLASS = 'text-slate-300';

const formatNumber = (n: number) => n.toLocaleString('en-GB');

function shareText(share: number): string {
  const percent = share * 100;
  return percent > 0 && percent < 1 ? '<1%' : `${Math.round(percent)}%`;
}

/**
 * Parts of one whole as ranked horizontal bars, largest first.
 *
 * Each bar's length is its share of the total, drawn on a full-width track, so
 * bars compare on one baseline. Every row prints its name, value and share as
 * text, so nothing is read from colour or from hovering. The bars share one
 * hue: the parts are named, not colour-coded. Items past `maxItems` fold into a
 * grey "Other" row. With no items, or a total of zero, the empty block is shown.
 */
export default function ShareBars({
  ariaLabel,
  height = DEFAULT_HEIGHT,
  valueFormat = formatNumber,
  emptyMessage,
  items,
  maxItems = 6,
}: ShareBarsProps) {
  const ranked = items
    .map((item) => ({ ...item, value: Number.isFinite(item.value) && item.value > 0 ? item.value : 0 }))
    .sort((a, b) => b.value - a.value);
  const total = ranked.reduce((sum, item) => sum + item.value, 0);

  if (total <= 0) {
    return <ChartEmpty ariaLabel={ariaLabel} height={height} message={emptyMessage} />;
  }

  const limit = Math.max(1, Math.floor(maxItems));
  const tail = ranked.slice(limit);
  const rows: (ShareItem & { other?: boolean })[] =
    tail.length > 0
      ? [
          ...ranked.slice(0, limit),
          { label: 'Other', value: tail.reduce((sum, item) => sum + item.value, 0), other: true },
        ]
      : ranked;

  return (
    <div data-chart="share" className="relative" style={{ minHeight: height }}>
      <div role="img" aria-label={ariaLabel} className="space-y-3">
        {rows.map((row, i) => {
          const share = row.value / total;
          return (
            <div key={`${row.label}-${i}`} data-share-row="">
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span data-share-label="" className="min-w-0 truncate text-slate-600">
                  {row.label}
                </span>
                <span className="shrink-0 tabular-nums">
                  <span className="font-semibold text-slate-900">{valueFormat(row.value)}</span>
                  <span className="ml-2 inline-block w-9 text-right text-xs text-slate-400">
                    {shareText(share)}
                  </span>
                </span>
              </div>
              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100">
                <div
                  data-share-fill=""
                  className={`h-full rounded-full bg-current ${
                    row.other ? OTHER_CLASS : (row.colorClass ?? SERIES_BLUE)
                  }`}
                  style={{ width: `${Math.round(share * 10000) / 100}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>

      <ChartDataTable
        ariaLabel={ariaLabel}
        corner="Item"
        columns={['Value', 'Share']}
        rows={rows.map((row) => ({
          label: row.label,
          cells: [valueFormat(row.value), shareText(row.value / total)],
        }))}
      />
    </div>
  );
}
