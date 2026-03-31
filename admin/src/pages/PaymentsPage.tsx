import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle, XCircle } from 'lucide-react';
import api from '../lib/api';
import DataTable, { type Column } from '../components/DataTable';
import StatusBadge from '../components/StatusBadge';

interface Payment {
  id: string;
  userName: string;
  userEmail: string;
  plan: string;
  amount: number;
  currency: string;
  referenceCode: string;
  receiptUrl: string;
  status: string;
  createdAt: string;
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
  const [successMsg, setSuccessMsg] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['payments', page, statusFilter],
    queryFn: async () => {
      const params: Record<string, string | number> = { page, limit: 20 };
      if (statusFilter !== 'all') params.status = statusFilter;
      const res = await api.get('/admin/payments', { params });
      return res.data;
    },
  });

  const mutation = useMutation({
    mutationFn: async ({ id, decision }: { id: string; decision: string }) => {
      await api.put(`/admin/payments/${id}`, { decision });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      setConfirmAction(null);
      setSuccessMsg(
        confirmAction?.decision === 'approved'
          ? 'Payment approved successfully.'
          : 'Payment rejected successfully.',
      );
      setTimeout(() => setSuccessMsg(''), 3000);
    },
  });

  const payments: Payment[] = data?.data ?? [];
  const total: number = data?.meta?.total ?? 0;

  const columns: Column<Payment>[] = [
    {
      key: 'userName',
      header: 'User',
      render: (row) => (
        <div>
          <div className="font-medium text-gray-900">{row.userName}</div>
          <div className="text-xs text-gray-500">{row.userEmail}</div>
        </div>
      ),
    },
    {
      key: 'plan',
      header: 'Plan',
      render: (row) => (
        <span className="inline-block px-2 py-0.5 rounded bg-indigo-100 text-indigo-700 text-xs font-medium capitalize">
          {row.plan}
        </span>
      ),
    },
    {
      key: 'amount',
      header: 'Amount',
      render: (row) => (
        <span className="font-medium">
          {row.currency ?? 'USD'} {Number(row.amount).toFixed(2)}
        </span>
      ),
    },
    { key: 'referenceCode', header: 'Reference Code' },
    {
      key: 'receiptUrl',
      header: 'Receipt',
      render: (row) =>
        row.receiptUrl ? (
          <a
            href={row.receiptUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-indigo-600 hover:text-indigo-800 underline text-sm"
          >
            View
          </a>
        ) : (
          <span className="text-gray-400">-</span>
        ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: 'createdAt',
      header: 'Date',
      render: (row) => new Date(row.createdAt).toLocaleString(),
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
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

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

      {/* Confirm dialog */}
      {confirmAction && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              {confirmAction.decision === 'approved' ? 'Approve Payment' : 'Reject Payment'}
            </h3>
            <p className="text-sm text-gray-600 mb-6">
              {confirmAction.decision === 'approved'
                ? "Approve this payment? The user's subscription will be activated."
                : 'Reject this payment? The user will be notified.'}
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setConfirmAction(null)}
                className="px-4 py-2 text-sm font-medium rounded-lg border text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() =>
                  mutation.mutate({
                    id: confirmAction.id,
                    decision: confirmAction.decision,
                  })
                }
                disabled={mutation.isPending}
                className={`px-4 py-2 text-sm font-medium rounded-lg text-white transition-colors disabled:opacity-50 ${
                  confirmAction.decision === 'approved'
                    ? 'bg-green-600 hover:bg-green-700'
                    : 'bg-red-600 hover:bg-red-700'
                }`}
              >
                {mutation.isPending
                  ? 'Processing...'
                  : confirmAction.decision === 'approved'
                    ? 'Approve'
                    : 'Reject'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
