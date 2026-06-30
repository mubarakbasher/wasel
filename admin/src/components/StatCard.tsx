import type { ReactNode } from 'react';

interface StatCardProps {
  title: string;
  value: string | number;
  icon: ReactNode;
  color?: string;
}

export default function StatCard({ title, value, icon, color = 'bg-blue-50 text-blue-600' }: StatCardProps) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6 flex items-center gap-4 min-w-0">
      <div className={`flex items-center justify-center w-12 h-12 shrink-0 rounded-lg ${color}`}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-sm font-medium text-slate-500 truncate">{title}</p>
        <p className="text-2xl font-bold text-slate-900 tabular-nums truncate">{value}</p>
      </div>
    </div>
  );
}
