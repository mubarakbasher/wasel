import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle, ExternalLink, XCircle } from 'lucide-react';
import api, { resolveAssetUrl } from '../lib/api';
import { formatDateTime } from '../lib/datetime';
import DataTable, { type Column } from '../components/DataTable';
import StatusBadge from '../components/StatusBadge';
import ErrorPanel from '../components/ErrorPanel';
import Button from '../components/ui/Button';
import Modal from '../components/Modal';

interface Payment {
  id: string;
  user_name: string;
  user_email: string;
  plan_tier: string;
  amount: number;
  currency: string;
  reference_code: string;
  receipt_url: string | null;
  rejection_reason: string | null;
  status: string;
  created_at: string;
  [key: string]: unknown;
}

const STATUS_TABS = ['pending', 'approved', 'rejected', 'all'] as const;

export default function PaymentsPage() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<string>('pending');
  const [confirmAction, setConfirmAction] = useState<{
    id: string;
    decision: 'approved' | 'rejected';
  } | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentionally reset the dialog inputs whenever the confirm action opens/closes
    setRejectionReason('');
    setErrorMsg('');
  }, [confirmAction]);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['payments', page, statusFilter],
    queryFn: async () => {
      const params: Record<string, string | number> = { page, limit: 20 };
      if (statusFilter !== 'all') params.status = statusFilter;
      const { data: res } = await api.get('/admin/payments', { params });
      return res;
    },
  });

  const mutation = useMutation({
    mutationFn: async ({
      id,
      decision,
      reason,
    }: {
      id: string;
      decision: string;
      reason?: string;
    }) => {
      const body: Record<string, unknown> = { decision };
      if (decision === 'rejected') body.rejection_reason = reason;
      await api.put(`/admin/payments/${id}`, body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      setSuccessMsg(
        confirmAction?.decision === 'approved'
          ? 'Payment approved successfully.'
          : 'Payment rejected successfully.',
      );
      setConfirmAction(null);
      setTimeout(() => setSuccessMsg(''), 3000);
    },
    onError: (err: unknown) => {
      const e = err as { response?: { data?: { error?: { message?: string } } } };
      setErrorMsg(e.response?.data?.error?.message ?? 'Request failed');
    },
  });

  const payments: Payment[] = data?.data ?? [];
  const total: number = data?.meta?.total ?? 0;

  const columns: Column<Payment>[] = [
    {
      key: 'user_name',
      header: 'User',
      render: (row) => (
        <div>
          <div className="font-medium text-gray-900">{row.user_name}</div>
          <div className="text-xs text-gray-500">{row.user_email}</div>
        </div>
      ),
    },
    {
      key: 'plan_tier',
      header: 'Plan',
      render: (row) => (
        <span className="inline-block px-2 py-0.5 rounded bg-blue-100 text-blue-700 text-xs font-medium capitalize">
          {row.plan_tier}
        </span>
      ),
    },
    {
      key: 'amount',
      header: 'Amount',
      render: (row) => (
        <span className="font-medium">
          {row.currency ?? 'SDG'} {Number(row.amount).toFixed(2)}
        </span>
      ),
    },
    { key: 'reference_code', header: 'Reference Code' },
    {
      key: 'status',
      header: 'Status',
      render: (row) => (
        <div>
          <StatusBadge status={row.status} />
          {row.status === 'rejected' && row.rejection_reason && (
            <div
              className="mt-1 text-xs text-red-700 max-w-xs truncate"
              title={row.rejection_reason}
            >
              {row.rejection_reason}
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'receipt_url',
      header: 'Receipt',
      render: (row) => {
        const url = resolveAssetUrl(row.receipt_url);
        return url ? (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            View
          </a>
        ) : (
          <span className="text-xs text-gray-400">—</span>
        );
      },
    },
    {
      key: 'created_at',
      header: 'Date',
      render: (row) => formatDateTime(row.created_at),
    },
    {
      key: 'actions',
      header: 'Actions',
      render: (row) =>
        row.status === 'pending' ? (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setConfirmAction({ id: row.id, decision: 'approved' })}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded bg-green-600 text-white hover:bg-green-700 transition-colors"
            >
              <CheckCircle className="w-3.5 h-3.5" />
              Approve
            </button>
            <button
              onClick={() => setConfirmAction({ id: row.id, decision: 'rejected' })}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded bg-red-600 text-white hover:bg-red-700 transition-colors"
            >
              <XCircle className="w-3.5 h-3.5" />
              Reject
            </button>
          </div>
        ) : null,
    },
  ];

  const isRejecting = confirmAction?.decision === 'rejected';
  const trimmedReason = rejectionReason.trim();
  const canSubmit =
    !mutation.isPending && (!isRejecting || trimmedReason.length > 0);

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Payment Verification</h1>

      {successMsg && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-green-50 text-green-700 text-sm font-medium">
          {successMsg}
        </div>
      )}

      {/* Status filter tabs */}
      <div className="flex gap-1 mb-6 border-b">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => {
              setStatusFilter(tab);
              setPage(1);
            }}
            className={`px-4 py-2 text-sm font-medium capitalize transition-colors border-b-2 -mb-px ${
              statusFilter === tab
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab}
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
            data={payments}
            total={total}
            page={page}
            limit={20}
            onPageChange={setPage}
            isLoading={isLoading}
          />
        </div>
      )}

      {/* Confirm dialog */}
      <Modal
        open={!!confirmAction}
        onClose={() => setConfirmAction(null)}
        title={isRejecting ? 'Reject Payment' : 'Approve Payment'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmAction(null)}>
              Cancel
            </Button>
            <Button
              variant={isRejecting ? 'danger' : 'success'}
              loading={mutation.isPending}
              disabled={!canSubmit}
              onClick={() =>
                confirmAction &&
                mutation.mutate({
                  id: confirmAction.id,
                  decision: confirmAction.decision,
                  reason: isRejecting ? trimmedReason : undefined,
                })
              }
            >
              {isRejecting ? 'Reject' : 'Approve'}
            </Button>
          </>
        }
      >
        <p className="text-sm text-gray-600">
          {isRejecting
            ? 'The user will see this reason and can upload a new receipt or cancel to pick another plan.'
            : "Approve this payment? The user's subscription will be activated."}
        </p>
        {isRejecting && (
          <div className="mt-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Reason <span className="text-red-600">*</span>
            </label>
            <textarea
              rows={3}
              maxLength={500}
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              placeholder="e.g. Receipt image is unreadable, or amount does not match."
              className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500"
            />
            <div className="text-xs text-gray-400 mt-1 text-right">
              {rejectionReason.length}/500
            </div>
          </div>
        )}
        {errorMsg && (
          <div className="mt-4 px-3 py-2 rounded bg-red-50 text-red-700 text-sm">
            {errorMsg}
          </div>
        )}
      </Modal>
    </div>
  );
}
