interface StatusBadgeProps {
  status: string | null | undefined;
}

const statusStyles: Record<string, string> = {
  active: 'bg-green-50 text-green-700 ring-green-600/20',
  online: 'bg-green-50 text-green-700 ring-green-600/20',
  approved: 'bg-green-50 text-green-700 ring-green-600/20',
  expired: 'bg-red-50 text-red-700 ring-red-600/20',
  offline: 'bg-red-50 text-red-700 ring-red-600/20',
  pending: 'bg-yellow-50 text-yellow-700 ring-yellow-600/20',
  cancelled: 'bg-orange-50 text-orange-700 ring-orange-600/20',
  degraded: 'bg-orange-50 text-orange-700 ring-orange-600/20',
  suspended: 'bg-slate-100 text-slate-600 ring-slate-500/20',
};

const defaultStyle = 'bg-slate-100 text-slate-600 ring-slate-500/20';

export default function StatusBadge({ status }: StatusBadgeProps) {
  if (!status) {
    return (
      <span
        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ring-1 ring-inset ${defaultStyle}`}
      >
        —
      </span>
    );
  }

  const style = statusStyles[status.toLowerCase()] || defaultStyle;

  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ring-1 ring-inset ${style}`}
    >
      {status.charAt(0).toUpperCase() + status.slice(1).toLowerCase()}
    </span>
  );
}
