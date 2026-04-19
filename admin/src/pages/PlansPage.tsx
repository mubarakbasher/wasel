import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { MoreVertical, Plus, Loader2 } from 'lucide-react';
import api from '../lib/api';
import DataTable, { type Column } from '../components/DataTable';
import ErrorPanel from '../components/ErrorPanel';

interface Plan {
  id: string;
  tier: string;
  name: string;
  price: string;
  currency: string;
  max_routers: number;
  monthly_vouchers: number;
  session_monitoring: string | null;
  dashboard: string | null;
  features: string[];
  allowed_durations: number[];
  is_active: boolean;
  [key: string]: unknown;
}

const emptyForm = {
  tier: '',
  name: '',
  price: '',
  currency: 'SDG',
  max_routers: '1',
  monthly_vouchers: '500',
  session_monitoring: '',
  dashboard: '',
  features: '',
  allowed_durations: '1',
  is_active: true,
};

type PlanForm = typeof emptyForm;

export default function PlansPage() {
  const queryClient = useQueryClient();
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [editPlan, setEditPlan] = useState<Plan | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<PlanForm>(emptyForm);
  const [confirmDelete, setConfirmDelete] = useState<Plan | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['admin', 'plans'],
    queryFn: async () => {
      const { data: res } = await api.get('/admin/plans');
      return res;
    },
  });

  const plans: Plan[] = data?.data ?? [];

  const createMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      await api.post('/admin/plans', body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'plans'] });
      setShowCreate(false);
      setForm(emptyForm);
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, body }: { id: string; body: Record<string, unknown> }) => {
      await api.put(`/admin/plans/${id}`, body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'plans'] });
      setEditPlan(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/admin/plans/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'plans'] });
      setConfirmDelete(null);
    },
  });

  function formToBody(f: PlanForm): Record<string, unknown> {
    return {
      tier: f.tier,
      name: f.name,
      price: Number(f.price),
      currency: f.currency,
      max_routers: Number(f.max_routers),
      monthly_vouchers: Number(f.monthly_vouchers),
      session_monitoring: f.session_monitoring || undefined,
      dashboard: f.dashboard || undefined,
      features: f.features.split(',').map(s => s.trim()).filter(Boolean),
      allowed_durations: f.allowed_durations.split(',').map(s => Number(s.trim())).filter(n => !isNaN(n) && n > 0),
      is_active: f.is_active,
    };
  }

  function planToForm(plan: Plan): PlanForm {
    return {
      tier: plan.tier,
      name: plan.name,
      price: String(parseFloat(plan.price)),
      currency: plan.currency,
      max_routers: String(plan.max_routers),
      monthly_vouchers: String(plan.monthly_vouchers),
      session_monitoring: plan.session_monitoring ?? '',
      dashboard: plan.dashboard ?? '',
      features: plan.features.join(', '),
      allowed_durations: plan.allowed_durations.join(', '),
      is_active: plan.is_active,
    };
  }

  function openEdit(plan: Plan) {
    setForm(planToForm(plan));
    setEditPlan(plan);
    setOpenDropdown(null);
  }

  function handleCreateSave() {
    createMutation.mutate(formToBody(form));
  }

  function handleEditSave() {
    if (!editPlan) return;
    updateMutation.mutate({ id: editPlan.id, body: formToBody(form) });
  }

  const columns: Column<Plan>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (row) => (
        <div>
          <p className="font-medium text-slate-900">{row.name}</p>
          <p className="text-xs text-slate-500">{row.tier}</p>
        </div>
      ),
    },
    {
      key: 'price',
      header: 'Price',
      render: (row) => (
        <span className="font-medium">{row.currency ?? 'SDG'} {parseFloat(row.price)}<span className="text-slate-400 font-normal">/mo</span></span>
      ),
    },
    {
      key: 'max_routers',
      header: 'Max Routers',
    },
    {
      key: 'monthly_vouchers',
      header: 'Vouchers/mo',
      render: (row) => (
        <span>{row.monthly_vouchers === -1 ? 'Unlimited' : row.monthly_vouchers.toLocaleString()}</span>
      ),
    },
    {
      key: 'allowed_durations',
      header: 'Durations',
      render: (row) => (
        <span className="text-sm">{row.allowed_durations.map(d => `${d}mo`).join(', ')}</span>
      ),
    },
    {
      key: 'is_active',
      header: 'Status',
      render: (row) => (
        <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium ${
          row.is_active ? 'bg-green-50 text-green-700' : 'bg-slate-100 text-slate-500'
        }`}>
          {row.is_active ? 'Active' : 'Inactive'}
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
                <button
                  onClick={() => {
                    setConfirmDelete(row);
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

  const isModalOpen = showCreate || editPlan !== null;
  const isModalSaving = createMutation.isPending || updateMutation.isPending;
  const modalError = createMutation.error || updateMutation.error;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold text-slate-900">Subscription Plans</h2>
        <button
          onClick={() => { setForm(emptyForm); setShowCreate(true); }}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          New Plan
        </button>
      </div>

      {isError ? (
        <ErrorPanel
          message={error instanceof Error ? error.message : undefined}
          onRetry={() => refetch()}
        />
      ) : (
        <div className="bg-white rounded-lg border border-slate-200">
          <DataTable
            columns={columns}
            data={plans}
            total={plans.length}
            page={1}
            limit={100}
            onPageChange={() => {}}
            isLoading={isLoading}
          />
        </div>
      )}

      {/* Create / Edit Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">
              {showCreate ? 'Create Plan' : 'Edit Plan'}
            </h2>

            {modalError && (
              <div className="mb-4 p-3 rounded-lg bg-red-50 text-red-700 text-sm">
                {(modalError as Error).message || 'An error occurred'}
              </div>
            )}

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Tier (slug)</label>
                  <input
                    type="text"
                    value={form.tier}
                    onChange={(e) => setForm({ ...form, tier: e.target.value.toLowerCase() })}
                    placeholder="e.g. starter"
                    disabled={editPlan !== null}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-slate-50 disabled:text-slate-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Display Name</label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="e.g. Starter"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Price (per month)</label>
                  <input
                    type="number"
                    value={form.price}
                    onChange={(e) => setForm({ ...form, price: e.target.value })}
                    min="0"
                    step="0.01"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Currency</label>
                  <input
                    type="text"
                    value={form.currency}
                    onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })}
                    maxLength={3}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Max Routers</label>
                  <input
                    type="number"
                    value={form.max_routers}
                    onChange={(e) => setForm({ ...form, max_routers: e.target.value })}
                    min="1"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Monthly Vouchers</label>
                  <input
                    type="number"
                    value={form.monthly_vouchers}
                    onChange={(e) => setForm({ ...form, monthly_vouchers: e.target.value })}
                    min="-1"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                  <p className="text-xs text-slate-400 mt-1">Use -1 for unlimited</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Session Monitoring</label>
                  <input
                    type="text"
                    value={form.session_monitoring}
                    onChange={(e) => setForm({ ...form, session_monitoring: e.target.value })}
                    placeholder="e.g. Active only"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Dashboard</label>
                  <input
                    type="text"
                    value={form.dashboard}
                    onChange={(e) => setForm({ ...form, dashboard: e.target.value })}
                    placeholder="e.g. Basic stats"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Features</label>
                <input
                  type="text"
                  value={form.features}
                  onChange={(e) => setForm({ ...form, features: e.target.value })}
                  placeholder="Feature 1, Feature 2, Feature 3"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
                <p className="text-xs text-slate-400 mt-1">Comma-separated list</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Allowed Durations (months)</label>
                <input
                  type="text"
                  value={form.allowed_durations}
                  onChange={(e) => setForm({ ...form, allowed_durations: e.target.value })}
                  placeholder="1, 2, 6"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
                <p className="text-xs text-slate-400 mt-1">Comma-separated, e.g. 1, 2, 6</p>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="is_active"
                  checked={form.is_active}
                  onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                  className="rounded border-slate-300"
                />
                <label htmlFor="is_active" className="text-sm text-slate-700">Active</label>
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => { setShowCreate(false); setEditPlan(null); }}
                className="px-4 py-2 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={showCreate ? handleCreateSave : handleEditSave}
                disabled={isModalSaving}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-60 transition-colors cursor-pointer"
              >
                {isModalSaving && <Loader2 className="w-4 h-4 animate-spin" />}
                {showCreate ? 'Create' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirm Dialog */}
      {confirmDelete && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h2 className="text-lg font-semibold text-slate-900 mb-2">Delete Plan</h2>
            <p className="text-sm text-slate-600 mb-6">
              Delete the <span className="font-medium">{confirmDelete.name}</span> plan? This will fail if there are existing subscriptions using this plan.
            </p>

            {deleteMutation.error && (
              <div className="mb-4 p-3 rounded-lg bg-red-50 text-red-700 text-sm">
                {(deleteMutation.error as Error).message || 'Cannot delete this plan'}
              </div>
            )}

            <div className="flex justify-end gap-3">
              <button
                onClick={() => { setConfirmDelete(null); deleteMutation.reset(); }}
                className="px-4 py-2 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={() => deleteMutation.mutate(confirmDelete.id)}
                disabled={deleteMutation.isPending}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-60 transition-colors cursor-pointer"
              >
                {deleteMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
