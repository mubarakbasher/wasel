import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import api from '../lib/api';
import {
  EMAIL_TEMPLATES_KEY,
  fetchEmailTemplates,
  templateTypeLabel,
  templateTypesFrom,
} from '../lib/emailTemplates';
import { formatDateTime } from '../lib/datetime';
import DataTable, { type Column } from '../components/DataTable';
import StatusBadge from '../components/StatusBadge';
import ErrorPanel from '../components/ErrorPanel';

interface EmailLog {
  id: string;
  user_id: string | null;
  recipient: string;
  type: string;
  language: 'en' | 'ar';
  subject: string;
  status: 'sent' | 'failed';
  error: string | null;
  created_at: string;
  [key: string]: unknown;
}

const ALL_TYPES = 'all';

const STATUS_TABS = ['all', 'sent', 'failed'] as const;
type StatusTab = (typeof STATUS_TABS)[number];

const STATUS_TAB_LABELS: Record<StatusTab, string> = {
  sent: 'Sent',
  failed: 'Failed',
  all: 'All',
};

function truncate(text: string, maxLen: number): string {
  return text.length > maxLen ? text.slice(0, maxLen) + '...' : text;
}

export default function EmailLogPage() {
  const [page, setPage] = useState(1);
  const [type, setType] = useState<string>(ALL_TYPES);
  const [status, setStatus] = useState<StatusTab>('all');
  const [recipientSearch, setRecipientSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const handleSearchChange = (value: string) => {
    setRecipientSearch(value);
    clearTimeout((window as unknown as Record<string, number>).__emailLogSearchTimeout);
    (window as unknown as Record<string, number>).__emailLogSearchTimeout = window.setTimeout(() => {
      setDebouncedSearch(value);
      setPage(1);
    }, 400);
  };

  // Same key + fetcher as the Email Templates page, so the type catalogue is
  // usually served from cache. A failure here only costs the type filter its
  // options, so the log itself still renders.
  const { data: templates } = useQuery({
    queryKey: EMAIL_TEMPLATES_KEY,
    queryFn: fetchEmailTemplates,
  });

  const typeOptions = useMemo(
    () => [ALL_TYPES, ...templateTypesFrom(templates ?? [])],
    [templates],
  );

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['email-log', page, type, status, debouncedSearch, fromDate, toDate],
    queryFn: async () => {
      const params: Record<string, string | number> = { page, limit: 20 };
      if (type !== ALL_TYPES) params.type = type;
      if (status !== 'all') params.status = status;
      if (debouncedSearch) params.search = debouncedSearch;
      if (fromDate) params.from = fromDate;
      if (toDate) params.to = toDate;
      const { data: res } = await api.get('/admin/email-log', { params });
      return res;
    },
  });

  const logs: EmailLog[] = data?.data ?? [];
  const total: number = data?.meta?.total ?? 0;

  const columns: Column<EmailLog>[] = [
    {
      key: 'created_at',
      header: 'Date',
      render: (row) => (
        <span className="whitespace-nowrap">{formatDateTime(row.created_at)}</span>
      ),
    },
    {
      key: 'recipient',
      header: 'Recipient',
      render: (row) => <span className="text-gray-900">{row.recipient}</span>,
    },
    {
      key: 'type',
      header: 'Type',
      render: (row) => (
        <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded">{row.type}</code>
      ),
    },
    {
      key: 'language',
      header: 'Language',
      render: (row) => <span className="uppercase">{row.language}</span>,
    },
    {
      key: 'subject',
      header: 'Subject',
      render: (row) => (
        <span className="text-gray-700" title={row.subject}>
          {truncate(row.subject ?? '', 50)}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => (
        <div>
          <StatusBadge status={row.status} />
          {row.status === 'failed' && row.error && (
            <div
              className="mt-1 text-xs text-red-600 max-w-xs truncate"
              title={row.error}
            >
              {row.error}
            </div>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Email Log</h1>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-4 mb-6">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Type</label>
          <select
            value={type}
            onChange={(e) => {
              setType(e.target.value);
              setPage(1);
            }}
            className="px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            {typeOptions.map((opt) => (
              <option key={opt} value={opt}>
                {opt === ALL_TYPES ? 'All Types' : templateTypeLabel(opt)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Recipient</label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={recipientSearch}
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder="Search recipient..."
              className="pl-9 pr-4 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 w-56"
            />
          </div>
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
            className="px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
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
            className="px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
      </div>

      {/* Status tabs */}
      <div className="flex gap-1 mb-6 border-b">
        {STATUS_TABS.map((t) => (
          <button
            key={t}
            onClick={() => {
              setStatus(t);
              setPage(1);
            }}
            className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
              status === t
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {STATUS_TAB_LABELS[t]}
          </button>
        ))}
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
