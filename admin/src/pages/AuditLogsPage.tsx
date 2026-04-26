import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, ChevronDown, ChevronUp } from 'lucide-react';
import api from '../lib/api';
import { formatDateTime } from '../lib/datetime';
import DataTable, { type Column } from '../components/DataTable';
import ErrorPanel from '../components/ErrorPanel';

interface AuditLog {
  id: string;
  created_at: string;
  admin_name: string;
  admin_email: string;
  action: string;
  target_entity: string;
  target_id: string;
  details: unknown;
  ip_address: string;
  [key: string]: unknown;
}

const ENTITY_OPTIONS = ['all', 'user', 'subscription', 'payment'] as const;

export default function AuditLogsPage() {
  const [page, setPage] = useState(1);
  const [actionSearch, setActionSearch] = useState('');
  const [debouncedAction, setDebouncedAction] = useState('');
  const [targetEntity, setTargetEntity] = useState<string>('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  const handleActionChange = (value: string) => {
    setActionSearch(value);
    clearTimeout((window as unknown as Record<string, number>).__auditSearchTimeout);
    (window as unknown as Record<string, number>).__auditSearchTimeout = window.setTimeout(() => {
      setDebouncedAction(value);
      setPage(1);
    }, 400);
  };

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['audit-logs', page, debouncedAction, targetEntity, fromDate, toDate],
    queryFn: async () => {
      const params: Record<string, string | number> = { page, limit: 20 };
      if (debouncedAction) params.action = debouncedAction;
      if (targetEntity !== 'all') params.targetEntity = targetEntity;
      if (fromDate) params.from = fromDate;
      if (toDate) params.to = toDate;
      const { data: res } = await api.get('/admin/audit-logs', { params });
      return res;
    },
  });

  const logs: AuditLog[] = data?.data ?? [];
  const total: number = data?.meta?.total ?? 0;

  function formatDetails(details: unknown): string {
    if (!details) return '-';
    try {
      return typeof details === 'string' ? details : JSON.stringify(details, null, 2);
    } catch {
      return String(details);
    }
  }

  function truncate(text: string, maxLen: number): string {
    return text.length > maxLen ? text.slice(0, maxLen) + '...' : text;
  }

  const columns: Column<AuditLog>[] = [
    {
      key: 'created_at',
      header: 'Timestamp',
      render: (row) => (
        <span className="whitespace-nowrap">{formatDateTime(row.created_at)}</span>
      ),
    },
    {
      key: 'admin_name',
      header: 'Admin',
      render: (row) => (
        <div>
          <div className="font-medium text-gray-900">{row.admin_name}</div>
          <div className="text-xs text-gray-500">{row.admin_email}</div>
        </div>
      ),
    },
    {
      key: 'action',
      header: 'Action',
      render: (row) => (
        <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded">{row.action}</code>
      ),
    },
    {
      key: 'target_entity',
      header: 'Target',
      render: (row) => <span className="capitalize">{row.target_entity}</span>,
    },
    {
      key: 'target_id',
      header: 'Target ID',
      render: (row) => (
        <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded">{row.target_id || '-'}</code>
      ),
    },
    {
      key: 'details',
      header: 'Details',
      render: (row) => {
        const text = formatDetails(row.details);
        if (text === '-') return <span className="text-gray-400">-</span>;

        const isExpanded = expandedRow === row.id;
        return (
          <div className="max-w-xs">
            <button
              onClick={() => setExpandedRow(isExpanded ? null : row.id)}
              className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 transition-colors"
            >
              {isExpanded ? (
                <>
                  Collapse <ChevronUp className="w-3 h-3" />
                </>
              ) : (
                <>
                  {truncate(text, 40)} <ChevronDown className="w-3 h-3" />
                </>
              )}
            </button>
            {isExpanded && (
              <pre className="mt-2 p-2 bg-gray-50 rounded text-xs text-gray-700 overflow-auto max-h-48 whitespace-pre-wrap">
                {text}
              </pre>
            )}
          </div>
        );
      },
    },
    { key: 'ip_address', header: 'IP Address' },
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Audit Logs</h1>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-4 mb-6">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Action</label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={actionSearch}
              onChange={(e) => handleActionChange(e.target.value)}
              placeholder="Search actions..."
              className="pl-9 pr-4 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 w-56"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Target Entity</label>
          <select
            value={targetEntity}
            onChange={(e) => {
              setTargetEntity(e.target.value);
              setPage(1);
            }}
            className="px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          >
            {ENTITY_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {opt === 'all' ? 'All Entities' : opt.charAt(0).toUpperCase() + opt.slice(1)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">From</label>
          <input
            type="date"
            value={fromDate}
            onChange={(e) => {
              setFromDate(e.target.value);
              setPage(1);
            }}
            className="px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">To</label>
          <input
            type="date"
            value={toDate}
            onChange={(e) => {
              setToDate(e.target.value);
              setPage(1);
            }}
            className="px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          />
        </div>
      </div>

      {isError ? (
        <ErrorPanel
          message={error instanceof Error ? error.message : undefined}
          onRetry={() => refetch()}
        />
      ) : (
        <div className="bg-white rounded-lg border shadow-sm">
          <DataTable
            columns={columns}
            data={logs}
            total={total}
            page={page}
            limit={20}
            onPageChange={setPage}
            isLoading={isLoading}
          />
        </div>
      )}
    </div>
  );
}
