import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { MoreVertical, Loader2 } from 'lucide-react';
import api from '../lib/api';
import DataTable, { type Column } from '../components/DataTable';
import StatusBadge from '../components/StatusBadge';

interface Subscription {
  id: string;
  user_name: string;
  user_email: string;
  plan_tier: string;
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
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);

  // Edit modal state
  const [editSub, setEditSub] = useState<Subscription | null>(null);
  const [editStatus, setEditStatus] = useState('');
  const [editPlanTier, setEditPlanTier] = useState('');
  const [editEndDate, setEditEndDate] = useState('');
  const [editVoucherQuota, setEditVoucherQuota] = useState('');

  // Confirm dialog state
  const [confirmAction, setConfirmAction] = useState<{
    type: 'activate' | 'extend' | 'cancel' | 'delete';
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

  const updateMutation = useMutation({
    mutationFn: async ({ id, body }: { id: string; body: Record<string, unknown> }) => {
      await api.put(`/admin/subscriptions/${id}`, body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'subscriptions'] });
      setEditSub(null);
      setConfirmAction(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/admin/subscriptions/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'subscriptions'] });
      setConfirmAction(null);
    },
  });

  const openEdit = (sub: Subscription) => {
    setEditStatus(sub.status);
    setEditPlanTier(sub.plan_tier);
    setEditEndDate(sub.end_date ? new Date(sub.end_date).toISOString().slice(0, 16) : '');
    setEditVoucherQuota(sub.voucher_quota === -1 ? '-1' : String(sub.voucher_quota));
    setEditSub(sub);
    setOpenDropdown(null);
  };

  const handleEditSave = () => {
    if (!editSub) return;
    const body: Record<string, unknown> = {};

    if (editStatus !== editSub.status) body.status = editStatus;
    if (editPlanTier !== editSub.plan_tier) body.plan_tier = editPlanTier;

    const originalEnd = editSub.end_date ? new Date(editSub.end_date).toISOString().slice(0, 16) : '';
    if (editEndDate && editEndDate !== originalEnd) {
      body.end_date = new Date(editEndDate).toISOString();
    }

    const originalQuota = editSub.voucher_quota === -1 ? '-1' : String(editSub.voucher_quota);
    if (editVoucherQuota !== originalQuota) {
      body.voucher_quota = Number(editVoucherQuota);
    }

    if (Object.keys(body).length === 0) {
      setEditSub(null);
      return;
    }

    updateMutation.mutate({ id: editSub.id, body });
  };

  const handleConfirm = () => {
    if (!confirmAction) return;
    const { type, subscription } = confirmAction;

    if (type === 'delete') {
      deleteMutation.mutate(subscription.id);
      return;
    }

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

    updateMutation.mutate({ id: subscription.id, body });
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
        const style = planStyles[row.plan_tier?.toLowerCase()] ?? 'bg-slate-100 text-slate-700';
        return (
          <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${style}`}>
            {row.plan_tier}
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
        <div className="relative">
          <button
            onClick={() => setOpenDropdown(openDropdown === row.id ? null : row.id)}
            className="p-1 rounded hover:bg-gray-100 cursor-pointer"
          >
            <MoreVertical className="w-4 h-4 text-gray-500" />
          </button>
          {openDropdown === row.id && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setOpenDropdown(null)} />
              <div className="absolute right-0 mt-1 w-40 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-40">
                <button
                  onClick={() => openEdit(row)}
                  className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 cursor-pointer"
                >
                  Edit
                </button>
                {row.status !== 'active' && row.status !== 'cancelled' && (
                  <button
                    onClick={() => {
                      setConfirmAction({ type: 'activate', subscription: row });
                      setOpenDropdown(null);
                    }}
                    className="w-full text-left px-3 py-2 text-sm text-green-700 hover:bg-green-50 cursor-pointer"
                  >
                    Activate
                  </button>
                )}
                {row.status === 'active' && (
                  <button
                    onClick={() => {
                      setConfirmAction({ type: 'extend', subscription: row });
                      setOpenDropdown(null);
                    }}
                    className="w-full text-left px-3 py-2 text-sm text-blue-700 hover:bg-blue-50 cursor-pointer"
                  >
                    Extend 30 days
                  </button>
                )}
                {row.status !== 'cancelled' && (
                  <button
                    onClick={() => {
                      setConfirmAction({ type: 'cancel', subscription: row });
                      setOpenDropdown(null);
                    }}
                    className="w-full text-left px-3 py-2 text-sm text-orange-700 hover:bg-orange-50 cursor-pointer"
                  >
                    Cancel
                  </button>
                )}
                <button
                  onClick={() => {
                    setConfirmAction({ type: 'delete', subscription: row });
                    setOpenDropdown(null);
                  }}
                  className="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50 cursor-pointer"
                >
                  Delete
                </button>
              </div>
            </>
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

      {/* Edit Modal */}
      {editSub && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h2 className="text-lg font-semibold text-slate-900 mb-1">Edit Subscription</h2>
            <p className="text-sm text-slate-500 mb-4">
              {editSub.user_name} &middot; {editSub.user_email}
            </p>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Status</label>
                <select
                  value={editStatus}
                  onChange={(e) => setEditStatus(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 cursor-pointer"
                >
                  <option value="pending">Pending</option>
                  <option value="active">Active</option>
                  <option value="expired">Expired</option>
                  <option value="cancelled">Cancelled</option>
                  <option value="pending_change">Pending Change</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Plan Tier</label>
                <select
                  value={editPlanTier}
                  onChange={(e) => setEditPlanTier(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 cursor-pointer"
                >
                  <option value="starter">Starter</option>
                  <option value="professional">Professional</option>
                  <option value="enterprise">Enterprise</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">End Date</label>
                <input
                  type="datetime-local"
                  value={editEndDate}
                  onChange={(e) => setEditEndDate(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Voucher Quota</label>
                <input
                  type="number"
                  value={editVoucherQuota}
                  onChange={(e) => setEditVoucherQuota(e.target.value)}
                  min="-1"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
                <p className="text-xs text-slate-400 mt-1">Use -1 for unlimited</p>
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setEditSub(null)}
                className="px-4 py-2 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleEditSave}
                disabled={updateMutation.isPending}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-60 transition-colors cursor-pointer"
              >
                {updateMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Dialog */}
      {confirmAction && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h2 className="text-lg font-semibold text-slate-900 mb-2">
              {confirmAction.type === 'activate'
                ? 'Activate Subscription'
                : confirmAction.type === 'extend'
                  ? 'Extend Subscription'
                  : confirmAction.type === 'delete'
                    ? 'Delete Subscription'
                    : 'Cancel Subscription'}
            </h2>
            <p className="text-sm text-slate-600 mb-6">
              {confirmAction.type === 'activate' && (
                <>
                  Activate the <span className="font-medium">{confirmAction.subscription.plan_tier}</span> subscription for{' '}
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
              {confirmAction.type === 'delete' && (
                <>
                  Delete the subscription for{' '}
                  <span className="font-medium">{confirmAction.subscription.user_name}</span>? This action cannot be undone.
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
                disabled={updateMutation.isPending || deleteMutation.isPending}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-white text-sm font-medium disabled:opacity-60 transition-colors cursor-pointer ${
                  confirmAction.type === 'delete' || confirmAction.type === 'cancel'
                    ? 'bg-red-600 hover:bg-red-700'
                    : 'bg-blue-600 hover:bg-blue-700'
                }`}
              >
                {(updateMutation.isPending || deleteMutation.isPending) && (
                  <Loader2 className="w-4 h-4 animate-spin" />
                )}
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
