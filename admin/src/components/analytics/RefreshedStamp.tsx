import { useEffect, useState } from 'react';
import { Clock, TriangleAlert } from 'lucide-react';
import { ADMIN_TIMEZONE } from '../../lib/datetime';
import { formatRelative } from '../../lib/format';

interface RefreshedStampProps {
  /** Money is read live on every load: show how long ago this copy was fetched. */
  live?: boolean;
  /** `dataUpdatedAt` of the query, for the live label. */
  dataUpdatedAt?: number;
  /** `meta.refreshedAt`: when the hourly summaries last ran. */
  refreshedAt?: string | null;
  /** `meta.stale`: the summaries are overdue. */
  stale?: boolean;
}

// "15 Nov 2026, 12:20" on the admin's wall clock.
const stampFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: ADMIN_TIMEZONE,
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/**
 * Says how fresh a tab's numbers are: "Live, updated 2m ago" for money, or
 * "Figures as of 15 Nov 2026, 12:20" for the hourly summaries, in amber when
 * they are overdue, and "No figures yet" before the first run.
 */
export default function RefreshedStamp({
  live = false,
  dataUpdatedAt,
  refreshedAt,
  stale = false,
}: RefreshedStampProps) {
  // Tick so "updated 2m ago" keeps moving between refetches.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [live]);

  if (live) {
    // A fetch that lands between two ticks is newer than `now`: formatRelative
    // reads that as "just now", never as a negative age.
    const ago = dataUpdatedAt ? formatRelative(dataUpdatedAt, now) : '';
    return (
      <p className="inline-flex items-center gap-1.5 text-xs text-slate-500">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-green-500" aria-hidden="true" />
        <span>{ago ? `Live, updated ${ago}` : 'Live'}</span>
      </p>
    );
  }

  const at = refreshedAt ? new Date(refreshedAt) : null;
  const text =
    at && !Number.isNaN(at.getTime()) ? `Figures as of ${stampFmt.format(at)}` : 'No figures yet';
  const Icon = stale ? TriangleAlert : Clock;

  return (
    <p
      data-stale={stale ? 'true' : 'false'}
      title={stale ? 'These figures refresh every hour and are overdue.' : undefined}
      className={`inline-flex items-center gap-1.5 text-xs ${
        stale ? 'font-medium text-amber-700' : 'text-slate-500'
      }`}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>{text}</span>
    </p>
  );
}
