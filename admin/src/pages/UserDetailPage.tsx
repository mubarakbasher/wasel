import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Plus, AlertTriangle, FileText, Check } from 'lucide-react';
import api from '../lib/api';
import { formatDate, formatDateTime } from '../lib/datetime';
import ErrorPanel from '../components/ErrorPanel';
import StatusBadge from '../components/StatusBadge';
import Button from '../components/ui/Button';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import SetupGuideView from '../components/SetupGuideView';

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
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [setupRouterId, setSetupRouterId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [verifyConfirm, setVerifyConfirm] = useState(false);

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

  const verifyMutation = useMutation({
    mutationFn: async () => {
      await api.put(`/admin/users/${id}`, { is_verified: true });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-user', id] });
      setVerifyConfirm(false);
      flash('User verified.');
    },
    onError: (err) => flash(extractErr(err, 'Verify failed')),
  });

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
                {!data.user.is_verified && (
                  <Button
                    size="sm"
                    variant="success"
                    onClick={() => setVerifyConfirm(true)}
                    loading={verifyMutation.isPending}
                    leftIcon={<Check className="w-4 h-4" />}
                  >
                    Verify user
                  </Button>
                )}
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
                value={formatDateTime(data.user.created_at)}
              />
            </div>
          </div>

          {/* Subscription card */}
          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <h3 className="text-lg font-semibold text-slate-900 mb-4">Subscription</h3>
            {data.subscription ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-600/20">
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
                        ? formatDate(data.subscription.endDate)
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
              <Button
                size="sm"
                onClick={() => setAddOpen(true)}
                leftIcon={<Plus className="w-4 h-4" />}
              >
                Add router
              </Button>
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
                      <th className="px-4 py-2.5 text-right">Actions</th>
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
                          {formatDate(r.created_at)}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => setSetupRouterId(r.id)}
                            title="View setup script"
                            leftIcon={<FileText className="w-4 h-4" />}
                          >
                            View setup
                          </Button>
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
          onDone={() => {
            setAddOpen(false);
            flash('Router created.');
          }}
        />
      )}

      <Modal
        open={!!setupRouterId}
        onClose={() => setSetupRouterId(null)}
        title="Setup script"
        footer={
          <Button onClick={() => setSetupRouterId(null)}>Done</Button>
        }
      >
        {setupRouterId && <SetupGuideView routerId={setupRouterId} />}
      </Modal>

      <ConfirmDialog
        open={verifyConfirm}
        title="Verify user"
        message="Mark this user as email-verified? They will be able to log in without entering an OTP."
        confirmLabel="Verify user"
        variant="success"
        loading={verifyMutation.isPending}
        onConfirm={() => verifyMutation.mutate()}
        onClose={() => setVerifyConfirm(false)}
      />
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
  onDone,
}: {
  userId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [model, setModel] = useState('');
  const [rosVersion, setRosVersion] = useState('');
  const [apiUser, setApiUser] = useState('');
  const [apiPass, setApiPass] = useState('');
  const [overrideQuota, setOverrideQuota] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [createdRouterId, setCreatedRouterId] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      const body: CreateRouterBody = { name: name.trim() };
      if (model.trim()) body.model = model.trim();
      if (rosVersion.trim()) body.rosVersion = rosVersion.trim();
      if (apiUser.trim()) body.apiUser = apiUser.trim();
      if (apiPass) body.apiPass = apiPass;
      if (overrideQuota) body.overrideQuota = true;
      const { data: res } = await api.post(`/admin/users/${userId}/routers`, body);
      return res.data as { id: string };
    },
    onSuccess: (router) => {
      queryClient.invalidateQueries({ queryKey: ['admin-user', userId] });
      setCreatedRouterId(router.id);
    },
    onError: (err) => setErrorMsg(extractErr(err)),
  });

  const trimmedName = name.trim();
  const canSubmit =
    !mutation.isPending && trimmedName.length >= 2 && trimmedName.length <= 100;

  if (createdRouterId) {
    return (
      <Modal
        open
        onClose={onDone}
        title="Router created — setup script"
        footer={<Button onClick={onDone}>Done</Button>}
      >
        <SetupGuideView routerId={createdRouterId} />
      </Modal>
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Add router"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            loading={mutation.isPending}
            disabled={!canSubmit}
          >
            Create router
          </Button>
        </>
      }
    >
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
              className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
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
        className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
      />
    </div>
  );
}
