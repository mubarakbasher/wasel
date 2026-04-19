import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Plus, AlertTriangle } from 'lucide-react';
import api from '../lib/api';
import ErrorPanel from '../components/ErrorPanel';
import StatusBadge from '../components/StatusBadge';

interface UserInfo {
  id: string;
  name: string;
  email: string;
  phone?: string | null;
  business_name?: string | null;
  role: string;
  is_verified: boolean;
  is_active: boolean;
  created_at: string;
}

interface SubscriptionInfo {
  id: string;
  planTier: string;
  planName: string;
  status: string;
  startDate: string;
  endDate: string;
  voucherQuota: number;
  vouchersUsed: number;
  daysRemaining: number;
  maxRouters: number;
}

interface RouterInfo {
  id: string;
  name: string;
  status: string;
  tunnel_ip?: string | null;
  created_at: string;
}

interface UserDetailResponse {
  user: UserInfo;
  subscription: SubscriptionInfo | null;
  routers: RouterInfo[];
  routerCount: number;
}

function extractErr(err: unknown, fallback = 'Request failed'): string {
  const e = err as {
    response?: { data?: { error?: { message?: string } } };
    message?: string;
  };
  return e.response?.data?.error?.message ?? e.message ?? fallback;
}

export default function UserDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [addOpen, setAddOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['admin-user', id],
    queryFn: async () => {
      const { data: res } = await api.get(`/admin/users/${id}`);
      return res.data as UserDetailResponse;
    },
    enabled: !!id,
  });

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  return (
    <div className="max-w-4xl">
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => navigate('/users')}
          className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900 transition-colors cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to users
        </button>
      </div>

      {toast && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-green-50 text-green-700 text-sm font-medium">
          {toast}
        </div>
      )}

      {isLoading ? (
        <div className="text-sm text-slate-400">Loading...</div>
      ) : isError || !data ? (
        <ErrorPanel
          message={error instanceof Error ? error.message : undefined}
          onRetry={() => refetch()}
        />
      ) : (
        <div className="space-y-6">
          {/* User info card */}
          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <h2 className="text-2xl font-bold text-slate-900">{data.user.name}</h2>
                <p className="text-sm text-slate-500 mt-1">{data.user.email}</p>
              </div>
              <div className="flex items-center gap-2 flex-wrap justify-end">
                <StatusBadge status={data.user.is_verified ? 'verified' : 'not verified'} />
                <StatusBadge status={data.user.is_active ? 'active' : 'suspended'} />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
              <InfoRow label="Email" value={data.user.email} />
              <InfoRow label="Phone" value={data.user.phone || '—'} />
              <InfoRow label="Business" value={data.user.business_name || '—'} />
              <InfoRow label="Role" value={data.user.role} />
              <InfoRow
                label="Created"
                value={new Date(data.user.created_at).toLocaleString()}
              />
            </div>
          </div>

          {/* Subscription card */}
          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <h3 className="text-lg font-semibold text-slate-900 mb-4">Subscription</h3>
            {data.subscription ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700 ring-1 ring-inset ring-indigo-600/20">
                    {data.subscription.planTier.charAt(0).toUpperCase() +
                      data.subscription.planTier.slice(1)}
                  </span>
                  <StatusBadge status={data.subscription.status} />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
                  <InfoRow
                    label="Ends on"
                    value={
                      data.subscription.endDate
                        ? new Date(data.subscription.endDate).toLocaleDateString()
                        : '—'
                    }
                  />
                  <InfoRow
                    label="Routers"
                    value={`${data.routerCount} / ${data.subscription.maxRouters}`}
                  />
                  <InfoRow
                    label="Vouchers"
                    value={`${data.subscription.vouchersUsed} / ${data.subscription.voucherQuota}`}
                  />
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-500">No active subscription.</p>
            )}
          </div>

          {/* Routers card */}
          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-slate-900">Routers</h3>
              <button
                onClick={() => setAddOpen(true)}
                className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition-colors cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                Add router
              </button>
            </div>
            {data.routers.length === 0 ? (
              <p className="text-sm text-slate-500">This user has no routers yet.</p>
            ) : (
              <div className="overflow-hidden rounded-lg border border-slate-200">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">
                    <tr>
                      <th className="px-4 py-2.5">Name</th>
                      <th className="px-4 py-2.5">Status</th>
                      <th className="px-4 py-2.5">Tunnel IP</th>
                      <th className="px-4 py-2.5">Created</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.routers.map((r) => (
                      <tr key={r.id}>
                        <td className="px-4 py-2.5 font-medium text-slate-900">{r.name}</td>
                        <td className="px-4 py-2.5">
                          <StatusBadge status={r.status} />
                        </td>
                        <td className="px-4 py-2.5">
                          {r.tunnel_ip ? (
                            <code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded">
                              {r.tunnel_ip}
                            </code>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-slate-600">
                          {new Date(r.created_at).toLocaleDateString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {addOpen && id && (
        <AddRouterModal
          userId={id}
          onClose={() => setAddOpen(false)}
          onSuccess={() => {
            setAddOpen(false);
            flash('Router created.');
          }}
        />
      )}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-sm text-slate-600">
      <span className="font-medium text-slate-500">{label}:</span>{' '}
      <span className="text-slate-800">{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add Router Modal
// ---------------------------------------------------------------------------

interface CreateRouterBody {
  name: string;
  model?: string;
  rosVersion?: string;
  apiUser?: string;
  apiPass?: string;
  overrideQuota?: boolean;
}

function AddRouterModal({
  userId,
  onClose,
  onSuccess,
}: {
  userId: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [model, setModel] = useState('');
  const [rosVersion, setRosVersion] = useState('');
  const [apiUser, setApiUser] = useState('');
  const [apiPass, setApiPass] = useState('');
  const [overrideQuota, setOverrideQuota] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const mutation = useMutation({
    mutationFn: async () => {
      const body: CreateRouterBody = { name: name.trim() };
      if (model.trim()) body.model = model.trim();
      if (rosVersion.trim()) body.rosVersion = rosVersion.trim();
      if (apiUser.trim()) body.apiUser = apiUser.trim();
      if (apiPass) body.apiPass = apiPass;
      if (overrideQuota) body.overrideQuota = true;
      await api.post(`/admin/users/${userId}/routers`, body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-user', userId] });
      onSuccess();
    },
    onError: (err) => setErrorMsg(extractErr(err)),
  });

  const trimmedName = name.trim();
  const canSubmit =
    !mutation.isPending && trimmedName.length >= 2 && trimmedName.length <= 100;

  return (
    <Modal title="Add router" onClose={onClose}>
      <div className="space-y-3">
        <ModalField
          label="Name"
          value={name}
          onChange={setName}
          maxLength={100}
          required
        />
        <ModalField
          label="Model (optional)"
          value={model}
          onChange={setModel}
          maxLength={100}
        />
        <ModalField
          label="RouterOS version (optional)"
          value={rosVersion}
          onChange={setRosVersion}
          maxLength={50}
        />
        <ModalField
          label="API user (optional)"
          value={apiUser}
          onChange={setApiUser}
          maxLength={100}
        />
        <ModalField
          label="API password (optional)"
          value={apiPass}
          onChange={setApiPass}
          type="password"
        />

        <div>
          <label className="inline-flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={overrideQuota}
              onChange={(e) => setOverrideQuota(e.target.checked)}
              className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
            />
            Override subscription quota
          </label>
          {overrideQuota && (
            <div className="mt-2 flex items-start gap-2 px-3 py-2 rounded-lg border border-yellow-200 bg-yellow-50 text-yellow-800 text-xs">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>
                This will exceed the user&apos;s plan limit. The action is flagged in the audit
                log.
              </span>
            </div>
          )}
        </div>

        {errorMsg && (
          <div className="px-3 py-2 rounded bg-red-50 text-red-700 text-sm">{errorMsg}</div>
        )}
      </div>
      <ModalActions
        onClose={onClose}
        onConfirm={() => mutation.mutate()}
        confirmLabel={mutation.isPending ? 'Creating...' : 'Create router'}
        confirmDisabled={!canSubmit}
      />
    </Modal>
  );
}

function ModalField({
  label,
  value,
  onChange,
  maxLength,
  type = 'text',
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  maxLength?: number;
  type?: string;
  required?: boolean;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={maxLength}
        className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
      />
    </div>
  );
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-md">
        <div className="flex items-start justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none"
          >
            &times;
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ModalActions({
  onClose,
  onConfirm,
  confirmLabel,
  confirmDisabled,
  danger,
}: {
  onClose: () => void;
  onConfirm: () => void;
  confirmLabel: string;
  confirmDisabled?: boolean;
  danger?: boolean;
}) {
  const confirmColor = danger
    ? 'bg-red-600 hover:bg-red-700'
    : 'bg-indigo-600 hover:bg-indigo-700';
  return (
    <div className="flex justify-end gap-3 mt-5">
      <button
        onClick={onClose}
        className="px-4 py-2 text-sm font-medium rounded-lg border text-gray-700 hover:bg-gray-50 transition-colors"
      >
        Cancel
      </button>
      <button
        onClick={onConfirm}
        disabled={confirmDisabled}
        className={`px-4 py-2 text-sm font-medium rounded-lg text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${confirmColor}`}
      >
        {confirmLabel}
      </button>
    </div>
  );
}
