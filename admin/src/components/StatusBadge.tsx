interface StatusBadgeProps {
  status: string | null | undefined;
}

const statusStyles: Record<string, string> = {
  active: 'bg-green-50 text-green-700 ring-green-600/20',
  online: 'bg-green-50 text-green-700 ring-green-600/20',
  approved: 'bg-green-50 text-green-700 ring-green-600/20',
  sent: 'bg-green-50 text-green-700 ring-green-600/20',
  expired: 'bg-red-50 text-red-700 ring-red-600/20',
  offline: 'bg-red-50 text-red-700 ring-red-600/20',
  failed: 'bg-red-50 text-red-700 ring-red-600/20',
  pending: 'bg-yellow-50 text-yellow-700 ring-yellow-600/20',
  cancelled: 'bg-orange-50 text-orange-700 ring-orange-600/20',
  degraded: 'bg-orange-50 text-orange-700 ring-orange-600/20',
  suspended: 'bg-slate-100 text-slate-600 ring-slate-500/20',
};

const defaultStyle = 'bg-slate-100 text-slate-600 ring-slate-500/20';

const dotStyles: Record<string, string> = {
  active: 'bg-green-500',
  online: 'bg-green-500',
  approved: 'bg-green-500',
  sent: 'bg-green-500',
  expired: 'bg-red-500',
  offline: 'bg-red-500',
  failed: 'bg-red-500',
  pending: 'bg-yellow-500',
  cancelled: 'bg-orange-500',
  degraded: 'bg-orange-500',
  suspended: 'bg-slate-400',
};

const defaultDot = 'bg-slate-400';

export default function StatusBadge({ status }: StatusBadgeProps) {
  if (!status) {
    return (
      <span
        aria-label="Status: unknown"
        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ring-1 ring-inset ${defaultStyle}`}
      >
        <span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${defaultDot}`} />
        —
      </span>
    );
  }

  const key = status.toLowerCase();
  const style = statusStyles[key] || defaultStyle;
  const dot = dotStyles[key] || defaultDot;

  return (
    <span
      aria-label={`Status: ${status}`}
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ring-1 ring-inset ${style}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${dot}`} />
      {status.charAt(0).toUpperCase() + status.slice(1).toLowerCase()}
    </span>
  );
}
