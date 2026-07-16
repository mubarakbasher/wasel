import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Search, FileText, RefreshCw, Trash2 } from 'lucide-react';
import api from '../lib/api';
import { formatDateTime } from '../lib/datetime';
import DataTable, { type Column } from '../components/DataTable';
import StatusBadge from '../components/StatusBadge';
import ErrorPanel from '../components/ErrorPanel';
import Button from '../components/ui/Button';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import DropdownMenu from '../components/ui/DropdownMenu';
import SetupGuideView from '../components/SetupGuideView';
import { useToast } from '../hooks/useToast';

interface Router {
  id: string;
  name: string;
  owner_name: string;
  owner_email: string;
  status: string;
  last_seen: string;
  tunnel_ip: string;
  hotspot_template_id: string | null;
  created_at: string;
  [key: string]: unknown;
}

type ConfirmType = 'reprovision' | 'delete';

const STATUS_OPTIONS = ['all', 'online', 'offline', 'degraded'] as const;

function extractErr(err: unknown, fallback = 'Request failed'): string {
  const e = err as { response?: { data?: { error?: { message?: string } } } };
  return e.response?.data?.error?.message ?? fallback;
}

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
  const queryClient = useQueryClient();
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [setupRouterId, setSetupRouterId] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<{
    type: ConfirmType;
    router: Router;
  } | null>(null);

  // Simple debounce via timeout ref
  const handleSearchChange = (value: string) => {
    setSearch(value);
    clearTimeout((window as unknown as Record<string, number>).__routerSearchTimeout);
    (window as unknown as Record<string, number>).__routerSearchTimeout = window.setTimeout(() => {
      setDebouncedSearch(value);
      setPage(1);
    }, 400);
  };

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['routers', page, statusFilter, debouncedSearch],
    queryFn: async () => {
      const params: Record<string, string | number> = { page, limit: 20 };
      if (statusFilter !== 'all') params.status = statusFilter;
      if (debouncedSearch) params.search = debouncedSearch;
      const { data: res } = await api.get('/admin/routers', { params });
      return res;
    },
  });

  const reprovisionMutation = useMutation({
    mutationFn: async (routerId: string) => {
      const { data: res } = await api.post(`/admin/routers/${routerId}/reprovision`, {});
      return res.data as { hotspotTemplateStatus?: string };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['routers'] });
      setConfirmAction(null);
      if (result?.hotspotTemplateStatus === 'failed') {
        toast.error('Reprovisioned, but the hotspot template failed to re-apply on the router.');
      } else {
        toast.success('Router reprovisioned.');
      }
    },
    onError: (err: unknown) => toast.error(extractErr(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: async (routerId: string) => {
      await api.delete(`/admin/routers/${routerId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['routers'] });
      setConfirmAction(null);
      toast.success('Router deleted.');
    },
    onError: (err: unknown) => toast.error(extractErr(err)),
  });

  const handleConfirm = () => {
    if (!confirmAction) return;
    if (confirmAction.type === 'delete') {
      deleteMutation.mutate(confirmAction.router.id);
    } else {
      reprovisionMutation.mutate(confirmAction.router.id);
    }
  };

  const routers: Router[] = data?.data ?? [];
  const total: number = data?.meta?.total ?? 0;

  const columns: Column<Router>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (row) => <span className="font-medium text-gray-900">{row.name}</span>,
    },
    {
      key: 'owner_name',
      header: 'Owner',
      render: (row) => (
        <div>
          <div className="font-medium text-gray-900">{row.owner_name}</div>
          <div className="text-xs text-gray-500">{row.owner_email}</div>
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
      key: 'last_seen',
      header: 'Last Seen',
      render: (row) =>
        row.last_seen ? (
          <span title={formatDateTime(row.last_seen)}>{relativeTime(row.last_seen)}</span>
        ) : (
          <span className="text-gray-400">-</span>
        ),
    },
    {
      key: 'tunnel_ip',
      header: 'Tunnel IP',
      render: (row) => (
        <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded">{row.tunnel_ip || '-'}</code>
      ),
    },
    {
      key: 'created_at',
      header: 'Created',
      render: (row) => formatDateTime(row.created_at),
    },
    {
      key: 'actions',
      header: '',
      render: (row) => (
        <div className="flex justify-end">
          <DropdownMenu
            ariaLabel={`Actions for ${row.name}`}
            items={[
              {
                label: 'View setup guide',
                icon: <FileText className="w-4 h-4" />,
                onClick: () => setSetupRouterId(row.id),
              },
              {
                label: 'Reprovision',
                icon: <RefreshCw className="w-4 h-4" />,
                onClick: () => setConfirmAction({ type: 'reprovision', router: row }),
              },
              {
                label: 'Delete',
                icon: <Trash2 className="w-4 h-4" />,
                danger: true,
                onClick: () => setConfirmAction({ type: 'delete', router: row }),
              },
            ]}
          />
        </div>
      ),
    },
  ];

  const confirmIsDelete = confirmAction?.type === 'delete';

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
            className="pl-9 pr-4 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 w-64"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            setPage(1);
          }}
          className="px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        >
          {STATUS_OPTIONS.map((opt) => (
            <option key={opt} value={opt}>
              {opt === 'all' ? 'All Statuses' : opt.charAt(0).toUpperCase() + opt.slice(1)}
            </option>
          ))}
        </select>
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
            data={routers}
            total={total}
            page={page}
            limit={20}
            onPageChange={setPage}
            isLoading={isLoading}
          />
        </div>
      )}

      {/* Setup guide */}
      <Modal
        open={!!setupRouterId}
        onClose={() => setSetupRouterId(null)}
        title="Router setup guide"
        size="lg"
        footer={<Button onClick={() => setSetupRouterId(null)}>Done</Button>}
      >
        {setupRouterId && <SetupGuideView routerId={setupRouterId} />}
      </Modal>

      {/* Reprovision / delete confirm */}
      <ConfirmDialog
        open={!!confirmAction}
        title={confirmIsDelete ? 'Delete router' : 'Reprovision router'}
        message={
          confirmAction && (
            confirmIsDelete ? (
              <>
                Delete <span className="font-medium">{confirmAction.router.name}</span>? This
                destroys the router, its WireGuard tunnel and its RADIUS registration. Any vouchers
                on this router will stop authenticating. This cannot be undone.
              </>
            ) : (
              <>
                Re-apply the hotspot login template to{' '}
                <span className="font-medium">{confirmAction.router.name}</span> over WireGuard? The
                router must be online for the template to apply.
              </>
            )
          )
        }
        confirmLabel={confirmIsDelete ? 'Delete' : 'Reprovision'}
        variant={confirmIsDelete ? 'danger' : 'primary'}
        loading={reprovisionMutation.isPending || deleteMutation.isPending}
        onConfirm={handleConfirm}
        onClose={() => setConfirmAction(null)}
      />
    </div>
  );
}
