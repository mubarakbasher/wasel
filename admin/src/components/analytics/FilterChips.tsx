export interface FilterChipOption<K extends string = string> {
  key: K;
  label: string;
  /** Optional number shown after the label, e.g. how many rows the chip keeps. */
  count?: number;
}

interface FilterChipsProps<K extends string> {
  options: FilterChipOption<K>[];
  /** Key of the active chip. */
  value: K;
  onChange: (key: K) => void;
  /** Accessible name of the group. */
  ariaLabel?: string;
  className?: string;
}

/**
 * A row of single-choice chips above a table ("All | Quiet | Near limit").
 * Exactly one chip is active; the caller keeps the choice and filters its rows.
 */
export default function FilterChips<K extends string>({
  options,
  value,
  onChange,
  ariaLabel = 'Filter',
  className = '',
}: FilterChipsProps<K>) {
  return (
    <div role="group" aria-label={ariaLabel} className={`flex flex-wrap gap-2 ${className}`}>
      {options.map((option) => {
        const active = option.key === value;
        return (
          <button
            key={option.key}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.key)}
            className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1 ${
              active
                ? 'border-blue-600 bg-blue-600 text-white'
                : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900'
            }`}
          >
            {option.label}
            {option.count !== undefined && (
              <>
                {/* A real space, so the name reads "Quiet 4" and not "Quiet4". */}{' '}
                <span
                  className={`tabular-nums text-xs ${active ? 'text-blue-100' : 'text-slate-500'}`}
                >
                  {option.count.toLocaleString('en-GB')}
                </span>
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}
