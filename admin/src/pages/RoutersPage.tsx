import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import api from '../lib/api';
import DataTable, { type Column } from '../components/DataTable';
import StatusBadge from '../components/StatusBadge';

interface Router {
  id: string;
  name: string;
  model: string;
  ownerName: string;
  ownerEmail: string;
  status: string;
  lastSeen: string;
  tunnelIp: string;
  createdAt: string;
}

const STATUS_OPTIONS = ['all', 'online', 'offline', 'degraded'] as const;

function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffSec = Math.floor((now - then) / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  return `${diffDays}d ago`;
}

export default function RoutersPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  // Simple debounce via timeout ref
  const handleSearchChange = (value: string) => {
    setSearch(value);
    clearTimeout((window as unknown as Record<string, number>).__routerSearchTimeout);
    (window as unknown as Record<string, number>).__routerSearchTimeout = window.setTimeout(() => {
      setDebouncedSearch(value);
      setPage(1);
    }, 400);
  };

  const { data, isLoading } = useQuery({
    queryKey: ['routers', page, statusFilter, debouncedSearch],
    queryFn: async () => {
      const params: Record<string, string | number> = { page, limit: 20 };
      if (statusFilter !== 'all') params.status = statusFilter;
      if (debouncedSearch) params.search = debouncedSearch;
      const res = await api.get('/admin/routers', { params });
      return res.data;
    },
  });

  const routers: Router[] = data?.data ?? [];
  const total: number = data?.meta?.total ?? 0;

  const columns: Column<Router>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (row) => <span className="font-medium text-gray-900">{row.name}</span>,
    },
    { key: 'model', header: 'Model' },
    {
      key: 'ownerName',
      header: 'Owner',
      render: (row) => (
        <div>
          <div className="font-medium text-gray-900">{row.ownerName}</div>
          <div className="text-xs text-gray-500">{row.ownerEmail}</div>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => (
        <span className="inline-flex items-center gap-1.5">
          <span
            className={`w-2 h-2 rounded-full ${
              row.status === 'online'
                ? 'bg-green-500'
                : row.status === 'degraded'
                  ? 'bg-yellow-500'
                  : 'bg-red-500'
            }`}
          />
          <StatusBadge status={row.status} />
        </span>
      ),
    },
    {
      key: 'lastSeen',
      header: 'Last Seen',
      render: (row) =>
        row.lastSeen ? (
          <span title={new Date(row.lastSeen).toLocaleString()}>{relativeTime(row.lastSeen)}</span>
        ) : (
          <span className="text-gray-400">-</span>
        ),
    },
    {
      key: 'tunnelIp',
      header: 'Tunnel IP',
      render: (row) => (
        <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded">{row.tunnelIp || '-'}</code>
      ),
    },
    {
      key: 'createdAt',
      header: 'Created',
      render: (row) => new Date(row.createdAt).toLocaleString(),
    },
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Routers</h1>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-4 mb-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder="Search routers..."
            className="pl-9 pr-4 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 w-64"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            setPage(1);
          }}
          className="px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
        >
          {STATUS_OPTIONS.map((opt) => (
            <option key={opt} value={opt}>
              {opt === 'all' ? 'All Statuses' : opt.charAt(0).toUpperCase() + opt.slice(1)}
            </option>
          ))}
        </select>
      </div>

      <div className="bg-white rounded-lg border shadow-sm">
        <DataTable
          columns={columns}
          data={routers}
          total={total}
          page={page}
          limit={20}
          onPageChange={setPage}
          isLoading={isLoading}
        />
      </div>
    </div>
  );
}
