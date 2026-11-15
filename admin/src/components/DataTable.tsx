import type { ReactNode } from 'react';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsUpDown } from 'lucide-react';
import type { SortState } from '../lib/tableSort';

export interface Column<T> {
  key: string;
  header: string;
  render?: (row: T) => ReactNode;
  /**
   * Makes the column sortable: the value its rows are ordered by. The table
   * only shows the state and reports clicks; the caller orders `data` (see
   * `sortRows` in lib/tableSort).
   */
  sortValue?: (row: T) => string | number | null;
  /** Numbers read best right-aligned. Defaults to left. */
  align?: 'left' | 'right';
  /**
   * Keep the cell on one line: an amount or a date broken in two is hard to
   * read, so a tight table scrolls sideways instead. Right-aligned columns
   * (numbers) are kept on one line unless this is false.
   */
  nowrap?: boolean;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  total: number;
  page: number;
  limit: number;
  onPageChange: (page: number) => void;
  isLoading?: boolean;
  onRowClick?: (row: T) => void;
  /** The current sort. Columns with `sortValue` become buttons once `onSortChange` is given. */
  sort?: SortState;
  onSortChange?: (sort: SortState) => void;
  /** A stable id per row, so a re-sorted row keeps its DOM node. Defaults to the row index. */
  rowKey?: (row: T) => string;
  /** Shown instead of the table when there are no rows. */
  emptyMessage?: string;
}

export default function DataTable<T extends object>({
  columns,
  data,
  total,
  page,
  limit,
  onPageChange,
  isLoading = false,
  onRowClick,
  sort,
  onSortChange,
  rowKey,
  emptyMessage = 'No data available.',
}: DataTableProps<T>) {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const start = (page - 1) * limit + 1;
  const end = Math.min(page * limit, total);

  const headerRow = (
    <tr className="border-b border-slate-200 bg-slate-50">
      {columns.map((col) => {
        const alignClass = col.align === 'right' ? 'text-right' : 'text-left';
        const thClass = `px-6 py-3 ${alignClass} text-xs font-semibold text-slate-500 uppercase tracking-wider`;

        if (!col.sortValue || !onSortChange) {
          return (
            <th key={col.key} scope="col" className={thClass}>
              {col.header}
            </th>
          );
        }

        const active = sort?.key === col.key;
        const dir = active ? sort.dir : null;
        const SortIcon = dir === 'asc' ? ArrowUp : dir === 'desc' ? ArrowDown : ChevronsUpDown;
        return (
          <th
            key={col.key}
            scope="col"
            // Only the sorted column announces a direction.
            aria-sort={dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : undefined}
            className={thClass}
          >
            <button
              type="button"
              onClick={() =>
                // A new column starts ascending; the active one flips.
                onSortChange({ key: col.key, dir: dir === 'asc' ? 'desc' : 'asc' })
              }
              className={`group -mx-1 inline-flex cursor-pointer items-center gap-1 rounded px-1 uppercase tracking-wider transition-colors hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                col.align === 'right' ? 'flex-row-reverse' : ''
              } ${active ? 'text-slate-900' : ''}`}
            >
              {col.header}
              <SortIcon
                aria-hidden="true"
                className={`h-3.5 w-3.5 shrink-0 ${
                  active ? 'text-blue-600' : 'text-slate-300 group-hover:text-slate-500'
                }`}
              />
            </button>
          </th>
        );
      })}
    </tr>
  );

  if (isLoading) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="relative">
          <div className="overflow-x-auto">
            <table className="w-full">
            <thead>{headerRow}</thead>
            <tbody>
              {Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="border-b border-slate-100">
                  {columns.map((col) => (
                    <td key={col.key} className="px-6 py-4">
                      <div
                        className={`h-4 bg-slate-200 rounded animate-pulse w-3/4 ${
                          col.align === 'right' ? 'ml-auto' : ''
                        }`}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            </table>
          </div>
          <div className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-black/5 to-transparent lg:hidden" />
        </div>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
        <p className="text-slate-400 text-sm">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="relative">
        <div className="overflow-x-auto">
          <table className="w-full">
          <thead>{headerRow}</thead>
          <tbody>
            {data.map((row, i) => (
              <tr
                key={rowKey ? rowKey(row) : i}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={`border-b border-slate-100 hover:bg-slate-50 transition-colors ${
                  i % 2 === 1 ? 'bg-slate-50/50' : ''
                } ${onRowClick ? 'cursor-pointer' : ''}`}
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={`px-6 py-4 text-sm text-slate-700 ${
                      col.align === 'right' ? 'text-right tabular-nums' : ''
                    } ${(col.nowrap ?? col.align === 'right') ? 'whitespace-nowrap' : ''}`}
                  >
                    {col.render ? col.render(row) : String((row as Record<string, unknown>)[col.key] ?? '')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          </table>
        </div>
        <div className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-black/5 to-transparent lg:hidden" />
      </div>

      <div className="flex items-center justify-between px-6 py-3 border-t border-slate-200 bg-slate-50">
        <p className="text-sm text-slate-500">
          Showing {start} to {end} of {total} results
        </p>
        <div className="flex items-center gap-2">
          <button
            onClick={() => onPageChange(page - 1)}
            disabled={page <= 1}
            className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-slate-600 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
          >
            <ChevronLeft className="w-4 h-4" />
            Previous
          </button>
          <span className="text-sm text-slate-500 px-2">
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() => onPageChange(page + 1)}
            disabled={page >= totalPages}
            className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-slate-600 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
          >
            Next
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
