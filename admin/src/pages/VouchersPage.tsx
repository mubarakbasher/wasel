import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Search, Ban, CheckCircle, Trash2 } from 'lucide-react';
import api from '../lib/api';
import { formatDateTime } from '../lib/datetime';
import DataTable, { type Column } from '../components/DataTable';
import StatusBadge from '../components/StatusBadge';
import ErrorPanel from '../components/ErrorPanel';
import Button from '../components/ui/Button';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import { useToast } from '../hooks/useToast';

interface VoucherRef {
  id: string;
  name: string;
}

interface VoucherOwner {
  id: string;
  name: string;
  email: string;
}

interface VoucherRow {
  id: string;
  code: string;
  status: string;
  createdAt: string;
  router: VoucherRef | null;
  owner: VoucherOwner | null;
  [key: string]: unknown;
}

type ConfirmType = 'disable' | 'enable' | 'delete';

const STATUS_OPTIONS = ['all', 'active', 'used', 'unused', 'expired', 'disabled'] as const;
const LIMIT = 20;

// Fields rendered explicitly in the detail modal; everything else is dumped
// defensively below (skipping nulls and nested objects).
const EXPLICIT_FIELDS = new Set(['id', 'code', 'status', 'createdAt', 'router', 'owner']);

function extractErrorMessage(err: unknown, fallback = 'Request failed'): string {
  const e = err as { response?: { data?: { error?: { message?: string } } } };
  return e.response?.data?.error?.message ?? fallback;
}

/** camelCase / snake_case / kebab-case → "Title Case". */
function humanizeKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

/** Render a primitive voucher field, formatting ISO timestamps as local time. */
function formatFieldValue(value: string | number | boolean): string {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
    return formatDateTime(value);
  }
  return String(value);
}

function DetailField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-1 text-slate-700">{children}</div>
    </div>
  );
}

export default function VouchersPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [detailVoucher, setDetailVoucher] = useState<VoucherRow | null>(null);
  const [confirmAction, setConfirmAction] = useState<{
    id: string;
    code: string;
    type: ConfirmType;
  } | null>(null);

  // Debounce the search box (mirrors RoutersPage).
  const handleSearchChange = (value: string) => {
    setSearch(value);
    clearTimeout((window as unknown as Record<string, number>).__voucherSearchTimeout);
    (window as unknown as Record<string, number>).__voucherSearchTimeout = window.setTimeout(() => {
      setDebouncedSearch(value);
      setPage(1);
    }, 400);
  };

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['admin', 'vouchers', page, statusFilter, debouncedSearch],
    queryFn: async () => {
      const params: Record<string, string | number> = { page, limit: LIMIT };
      if (statusFilter !== 'all') params.status = statusFilter;
      if (debouncedSearch) params.search = debouncedSearch;
      const { data: res } = await api.get('/admin/vouchers', { params });
      return res;
    },
  });

  const statusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: 'active' | 'disabled' }) => {
      await api.put(`/admin/vouchers/${id}`, { status });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'vouchers'] });
      toast.success(confirmAction?.type === 'enable' ? 'Voucher enabled.' : 'Voucher disabled.');
      setConfirmAction(null);
    },
    onError: (err: unknown) => toast.error(extractErrorMessage(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/admin/vouchers/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'vouchers'] });
      toast.success('Voucher deleted.');
      setConfirmAction(null);
    },
    onError: (err: unknown) => toast.error(extractErrorMessage(err)),
  });

  // Hand off from the detail modal to the confirm dialog. Deferring the open to
  // the next tick lets the detail modal fully unmount (and restore focus) first,
  // so the confirm dialog then mounts cleanly and traps focus — same reasoning
  // as PaymentsPage.openConfirmFromDetail.
  const openConfirmFromDetail = (type: ConfirmType) => {
    if (!detailVoucher) return;
    const { id, code } = detailVoucher;
    setDetailVoucher(null);
    setTimeout(() => setConfirmAction({ id, code, type }), 0);
  };

  const handleConfirm = () => {
    if (!confirmAction) return;
    if (confirmAction.type === 'delete') {
      deleteMutation.mutate(confirmAction.id);
    } else {
      statusMutation.mutate({
        id: confirmAction.id,
        status: confirmAction.type === 'disable' ? 'disabled' : 'active',
      });
    }
  };

  const vouchers: VoucherRow[] = data?.data ?? [];
  const total: number = data?.meta?.total ?? 0;

  const columns: Column<VoucherRow>[] = [
    {
      key: 'code',
      header: 'Code',
      render: (row) => (
        <span className="font-mono font-medium text-slate-900">{row.code}</span>
      ),
    },
    {
      key: 'owner',
      header: 'Owner',
      render: (row) =>
        row.owner ? (
          <div>
            <div className="font-medium text-gray-900">{row.owner.name}</div>
            <div className="text-xs text-gray-500">{row.owner.email}</div>
          </div>
        ) : (
          <span className="text-gray-400">—</span>
        ),
    },
    {
      key: 'router',
      header: 'Router',
      render: (row) => row.router?.name ?? <span className="text-gray-400">—</span>,
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: 'createdAt',
      header: 'Created',
      render: (row) => formatDateTime(row.createdAt),
    },
  ];

  const canDisable = detailVoucher?.status === 'active' || detailVoucher?.status === 'unused';
  const canEnable = detailVoucher?.status === 'disabled';

  const confirmTitle =
    confirmAction?.type === 'delete'
      ? 'Delete Voucher'
      : confirmAction?.type === 'enable'
        ? 'Enable Voucher'
        : 'Disable Voucher';

  const confirmLabel =
    confirmAction?.type === 'delete'
      ? 'Delete'
      : confirmAction?.type === 'enable'
        ? 'Enable'
        : 'Disable';

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Vouchers</h1>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-4 mb-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder="Search code, owner, or router..."
            className="pl-9 pr-4 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 w-72"
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
            data={vouchers}
            total={total}
            page={page}
            limit={LIMIT}
            onPageChange={setPage}
            isLoading={isLoading}
            onRowClick={setDetailVoucher}
          />
        </div>
      )}

      {/* Detail view */}
      <Modal
        open={!!detailVoucher}
        onClose={() => setDetailVoucher(null)}
        title="Voucher Details"
        size="lg"
        footer={
          detailVoucher && (
            <>
              {canEnable && (
                <Button
                  variant="success"
                  leftIcon={<CheckCircle className="w-4 h-4" />}
                  onClick={() => openConfirmFromDetail('enable')}
                >
                  Enable
                </Button>
              )}
              {canDisable && (
                <Button
                  variant="secondary"
                  leftIcon={<Ban className="w-4 h-4" />}
                  onClick={() => openConfirmFromDetail('disable')}
                >
                  Disable
                </Button>
              )}
              <Button
                variant="danger"
                leftIcon={<Trash2 className="w-4 h-4" />}
                onClick={() => openConfirmFromDetail('delete')}
              >
                Delete
              </Button>
              <Button variant="ghost" onClick={() => setDetailVoucher(null)}>
                Close
              </Button>
            </>
          )
        }
      >
        {detailVoucher && (
          <div className="space-y-4 text-sm">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <DetailField label="Code">
                <span className="font-mono text-slate-900">{detailVoucher.code}</span>
              </DetailField>
              <DetailField label="Status">
                <StatusBadge status={detailVoucher.status} />
              </DetailField>
              <DetailField label="Owner">
                {detailVoucher.owner ? (
                  <>
                    <div className="font-medium text-slate-900">{detailVoucher.owner.name}</div>
                    <div className="text-xs text-slate-500">{detailVoucher.owner.email}</div>
                  </>
                ) : (
                  <span className="text-slate-400">—</span>
                )}
              </DetailField>
              <DetailField label="Router">
                {detailVoucher.router?.name ?? <span className="text-slate-400">—</span>}
              </DetailField>
              <DetailField label="Created">{formatDateTime(detailVoucher.createdAt)}</DetailField>

              {/* Defensive dump of any extra primitive fields the API returns. */}
              {Object.entries(detailVoucher)
                .filter(
                  ([key, value]) =>
                    !EXPLICIT_FIELDS.has(key) &&
                    value !== null &&
                    value !== undefined &&
                    typeof value !== 'object',
                )
                .map(([key, value]) => (
                  <DetailField key={key} label={humanizeKey(key)}>
                    {formatFieldValue(value as string | number | boolean)}
                  </DetailField>
                ))}
            </div>
          </div>
        )}
      </Modal>

      {/* Confirm dialog */}
      <ConfirmDialog
        open={!!confirmAction}
        title={confirmTitle}
        message={
          confirmAction && (
            <>
              {confirmAction.type === 'delete' ? (
                <>
                  Delete voucher{' '}
                  <span className="font-mono font-medium">{confirmAction.code}</span>? This
                  permanently removes the RADIUS user and disconnects any active session. This
                  cannot be undone.
                </>
              ) : confirmAction.type === 'enable' ? (
                <>
                  Re-enable voucher{' '}
                  <span className="font-mono font-medium">{confirmAction.code}</span>? It will be
                  able to authenticate again.
                </>
              ) : (
                <>
                  Disable voucher{' '}
                  <span className="font-mono font-medium">{confirmAction.code}</span>? It will stop
                  authenticating until re-enabled.
                </>
              )}
            </>
          )
        }
        confirmLabel={confirmLabel}
        variant={
          confirmAction?.type === 'delete'
            ? 'danger'
            : confirmAction?.type === 'enable'
              ? 'success'
              : 'primary'
        }
        loading={statusMutation.isPending || deleteMutation.isPending}
        onConfirm={handleConfirm}
        onClose={() => setConfirmAction(null)}
      />
    </div>
  );
}
