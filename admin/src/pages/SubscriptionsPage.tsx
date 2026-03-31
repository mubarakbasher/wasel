import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import api from '../lib/api';
import DataTable, { type Column } from '../components/DataTable';
import StatusBadge from '../components/StatusBadge';

interface Subscription {
  id: string;
  user_name: string;
  user_email: string;
  plan: string;
  status: string;
  start_date: string;
  end_date: string;
  vouchers_used: number;
  voucher_quota: number;
  [key: string]: unknown;
}

const planStyles: Record<string, string> = {
  starter: 'bg-slate-100 text-slate-700',
  professional: 'bg-blue-100 text-blue-700',
  enterprise: 'bg-purple-100 text-purple-700',
};

export default function SubscriptionsPage() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');

  const [confirmAction, setConfirmAction] = useState<{
    type: 'activate' | 'extend' | 'cancel';
    subscription: Subscription;
  } | null>(null);

  const limit = 20;

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'subscriptions', page, limit, status],
    queryFn: async () => {
      const params: Record<string, string | number> = { page, limit };
      if (status) params.status = status;
      const { data: res } = await api.get('/admin/subscriptions', { params });
      return res;
    },
  });

  const subscriptions: Subscription[] = data?.data ?? [];
  const total: number = data?.meta?.total ?? 0;

  const mutation = useMutation({
    mutationFn: async ({ id, body }: { id: string; body: Record<string, unknown> }) => {
      await api.put(`/admin/subscriptions/${id}`, body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'subscriptions'] });
      setConfirmAction(null);
    },
  });

  const handleConfirm = () => {
    if (!confirmAction) return;
    const { type, subscription } = confirmAction;

    let body: Record<string, unknown>;
    if (type === 'activate') {
      body = { status: 'active' };
    } else if (type === 'extend') {
      const currentEnd = new Date(subscription.end_date);
      const newEnd = new Date(currentEnd.getTime() + 30 * 24 * 60 * 60 * 1000);
      body = { end_date: newEnd.toISOString() };
    } else {
      body = { status: 'cancelled' };
    }

    mutation.mutate({ id: subscription.id, body });
  };

  const columns: Column<Subscription>[] = [
    {
      key: 'user',
      header: 'User',
      render: (row) => (
        <div>
          <p className="font-medium text-slate-900">{row.user_name}</p>
          <p className="text-xs text-slate-500">{row.user_email}</p>
        </div>
      ),
    },
    {
      key: 'plan',
      header: 'Plan',
      render: (row) => {
        const style = planStyles[row.plan?.toLowerCase()] ?? 'bg-slate-100 text-slate-700';
        return (
          <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${style}`}>
            {row.plan}
          </span>
        );
      },
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: 'start_date',
      header: 'Start Date',
      render: (row) => new Date(row.start_date).toLocaleDateString(),
    },
    {
      key: 'end_date',
      header: 'End Date',
      render: (row) => new Date(row.end_date).toLocaleDateString(),
    },
    {
      key: 'vouchers',
      header: 'Vouchers',
      render: (row) => (
        <span className="text-sm">
          {row.vouchers_used}
          <span className="text-slate-400"> / </span>
          {row.voucher_quota === -1 ? 'unlimited' : row.voucher_quota}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      render: (row) => (
        <div className="flex items-center gap-1">
          {row.status !== 'active' && row.status !== 'cancelled' && (
            <button
              onClick={() => setConfirmAction({ type: 'activate', subscription: row })}
              className="px-2.5 py-1 rounded text-xs font-medium text-green-700 bg-green-50 hover:bg-green-100 transition-colors cursor-pointer"
            >
              Activate
            </button>
          )}
          {row.status === 'active' && (
            <button
              onClick={() => setConfirmAction({ type: 'extend', subscription: row })}
              className="px-2.5 py-1 rounded text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 transition-colors cursor-pointer"
            >
              Extend
            </button>
          )}
          {row.status !== 'cancelled' && (
            <button
              onClick={() => setConfirmAction({ type: 'cancel', subscription: row })}
              className="px-2.5 py-1 rounded text-xs font-medium text-red-700 bg-red-50 hover:bg-red-100 transition-colors cursor-pointer"
            >
              Cancel
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          className="px-3 py-2 rounded-lg border border-slate-300 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 cursor-pointer"
        >
          <option value="">All Status</option>
          <option value="pending">Pending</option>
          <option value="active">Active</option>
          <option value="expired">Expired</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>

      <div className="bg-white rounded-lg border border-slate-200">
        <DataTable
          columns={columns}
          data={subscriptions}
          total={total}
          page={page}
          limit={limit}
          onPageChange={setPage}
          isLoading={isLoading}
        />
      </div>

      {/* Confirm Dialog */}
      {confirmAction && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h2 className="text-lg font-semibold text-slate-900 mb-2">
              {confirmAction.type === 'activate'
                ? 'Activate Subscription'
                : confirmAction.type === 'extend'
                  ? 'Extend Subscription'
                  : 'Cancel Subscription'}
            </h2>
            <p className="text-sm text-slate-600 mb-6">
              {confirmAction.type === 'activate' && (
                <>
                  Activate the <span className="font-medium">{confirmAction.subscription.plan}</span> subscription for{' '}
                  <span className="font-medium">{confirmAction.subscription.user_name}</span>?
                </>
              )}
              {confirmAction.type === 'extend' && (
                <>
                  Extend the subscription for{' '}
                  <span className="font-medium">{confirmAction.subscription.user_name}</span> by 30 days? New end date
                  will be{' '}
                  <span className="font-medium">
                    {new Date(
                      new Date(confirmAction.subscription.end_date).getTime() + 30 * 24 * 60 * 60 * 1000,
                    ).toLocaleDateString()}
                  </span>
                  .
                </>
              )}
              {confirmAction.type === 'cancel' && (
                <>
                  Cancel the subscription for{' '}
                  <span className="font-medium">{confirmAction.subscription.user_name}</span>? This will revoke their
                  access.
                </>
              )}
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setConfirmAction(null)}
                className="px-4 py-2 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirm}
                disabled={mutation.isPending}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-white text-sm font-medium disabled:opacity-60 transition-colors cursor-pointer ${
                  confirmAction.type === 'cancel'
                    ? 'bg-red-600 hover:bg-red-700'
                    : 'bg-blue-600 hover:bg-blue-700'
                }`}
              >
                {mutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
