import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Landmark,
  Users2,
  Activity,
  KeyRound,
  UserX,
  UserCheck,
  Trash2,
  Plus,
} from 'lucide-react';
import api from '../lib/api';
import { formatDate } from '../lib/datetime';
import StatusBadge from '../components/StatusBadge';
import ErrorPanel from '../components/ErrorPanel';
import Button from '../components/ui/Button';
import Modal from '../components/Modal';
import { useAuth } from '../hooks/useAuth';

const TABS = ['bank', 'admins', 'system'] as const;
type Tab = (typeof TABS)[number];

const TAB_LABELS: Record<Tab, string> = {
  bank: 'Bank Details',
  admins: 'Admins',
  system: 'System Status',
};

const TAB_ICONS: Record<Tab, typeof Landmark> = {
  bank: Landmark,
  admins: Users2,
  system: Activity,
};

interface BankInfo {
  bankName: string;
  accountNumber: string;
  accountHolder: string;
  instructions: string;
}

interface AdminRow {
  id: string;
  name: string;
  email: string;
  is_active: boolean;
  created_at: string;
}

interface ServiceStatus {
  status: 'ok' | 'error' | 'disabled';
  responseMs?: number;
  enabled?: boolean;
  message?: string;
}

interface ProcessStatus {
  uptimeSeconds: number;
  nodeVersion: string;
  memoryMb: number;
}

interface SystemStatus {
  database: ServiceStatus;
  redis: ServiceStatus;
  fcm: ServiceStatus;
  process: ProcessStatus;
}

interface FreeradiusStatus {
  socket: {
    path: string;
    exists: boolean;
    readable: boolean;
    writable: boolean;
  };
  clients: {
    raw: string;
    lineCount: number;
  };
}

function extractErr(err: unknown, fallback = 'Request failed'): string {
  const e = err as { response?: { data?: { error?: { message?: string } } } };
  return e.response?.data?.error?.message ?? fallback;
}

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>('bank');

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Settings</h1>

      <div className="flex gap-1 mb-6 border-b">
        {TABS.map((t) => {
          const Icon = TAB_ICONS[t];
          return (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
                tab === t
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <Icon className="w-4 h-4" />
              {TAB_LABELS[t]}
            </button>
          );
        })}
      </div>

      {tab === 'bank' && <BankDetailsTab />}
      {tab === 'admins' && <AdminsTab />}
      {tab === 'system' && <SystemStatusTab />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bank Details
// ---------------------------------------------------------------------------

function BankDetailsTab() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<BankInfo>({
    bankName: '',
    accountNumber: '',
    accountHolder: '',
    instructions: '',
  });
  const [initial, setInitial] = useState<BankInfo>(form);
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['admin-settings-bank'],
    queryFn: async () => {
      const { data: res } = await api.get('/admin/settings/bank');
      return res.data as BankInfo;
    },
  });

  useEffect(() => {
    if (data) {
      const next: BankInfo = {
        bankName: data.bankName ?? '',
        accountNumber: data.accountNumber ?? '',
        accountHolder: data.accountHolder ?? '',
        instructions: data.instructions ?? '',
      };
      // eslint-disable-next-line react-hooks/set-state-in-effect -- seed the editable form from fetched settings once the query resolves
      setForm(next);
      setInitial(next);
    }
  }, [data]);

  const mutation = useMutation({
    mutationFn: async (body: BankInfo) => {
      await api.put('/admin/settings/bank', body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-settings-bank'] });
      setInitial(form);
      setSuccessMsg('Bank details saved.');
      setErrorMsg('');
      setTimeout(() => setSuccessMsg(''), 3000);
    },
    onError: (err) => {
      setErrorMsg(extractErr(err));
    },
  });

  const dirty = useMemo(
    () =>
      form.bankName !== initial.bankName ||
      form.accountNumber !== initial.accountNumber ||
      form.accountHolder !== initial.accountHolder ||
      form.instructions !== initial.instructions,
    [form, initial],
  );

  const disabled = mutation.isPending || !dirty;

  if (isError) {
    return (
      <div className="max-w-2xl">
        <ErrorPanel
          message={error instanceof Error ? error.message : undefined}
          onRetry={() => refetch()}
        />
      </div>
    );
  }

  return (
    <div className="max-w-2xl">
      {successMsg && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-green-50 text-green-700 text-sm font-medium">
          {successMsg}
        </div>
      )}
      {errorMsg && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-red-50 text-red-700 text-sm font-medium">
          {errorMsg}
        </div>
      )}

      <div className="bg-white rounded-lg border shadow-sm p-6 space-y-4">
        <p className="text-sm text-gray-600">
          These details are shown to users on the payment screen when they submit a bank transfer.
        </p>

        <Field
          label="Bank name"
          value={form.bankName}
          onChange={(v) => setForm((f) => ({ ...f, bankName: v }))}
          maxLength={120}
          disabled={isLoading}
        />
        <Field
          label="Account number"
          value={form.accountNumber}
          onChange={(v) => setForm((f) => ({ ...f, accountNumber: v }))}
          maxLength={64}
          disabled={isLoading}
        />
        <Field
          label="Account holder"
          value={form.accountHolder}
          onChange={(v) => setForm((f) => ({ ...f, accountHolder: v }))}
          maxLength={120}
          disabled={isLoading}
        />

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Transfer instructions
          </label>
          <textarea
            rows={6}
            maxLength={1000}
            value={form.instructions}
            onChange={(e) =>
              setForm((f) => ({ ...f, instructions: e.target.value }))
            }
            disabled={isLoading}
            className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-50"
            placeholder="Optional extra guidance shown to the user (e.g. include reference code in the transfer memo)."
          />
          <div className="text-xs text-gray-400 mt-1 text-right">
            {form.instructions.length}/1000
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <Button
            onClick={() => mutation.mutate(form)}
            loading={mutation.isPending}
            disabled={disabled}
          >
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  maxLength,
  disabled,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  maxLength?: number;
  disabled?: boolean;
  type?: string;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={maxLength}
        disabled={disabled}
        className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-50"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Admins
// ---------------------------------------------------------------------------

type AdminModalState =
  | { kind: 'create' }
  | { kind: 'reset'; admin: AdminRow }
  | { kind: 'delete'; admin: AdminRow }
  | null;

function AdminsTab() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [modal, setModal] = useState<AdminModalState>(null);
  const [successMsg, setSuccessMsg] = useState('');
  const [rowErrorMsg, setRowErrorMsg] = useState('');

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['admin-admins'],
    queryFn: async () => {
      const { data: res } = await api.get('/admin/admins');
      return res.data as AdminRow[];
    },
  });

  const admins: AdminRow[] = data ?? [];
  const activeCount = admins.filter((a) => a.is_active).length;

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['admin-admins'] });

  const flash = (msg: string) => {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(''), 3000);
  };

  const toggleMutation = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      await api.put(`/admin/admins/${id}/active`, { is_active });
    },
    onSuccess: (_d, vars) => {
      invalidate();
      flash(vars.is_active ? 'Admin activated.' : 'Admin deactivated.');
      setRowErrorMsg('');
    },
    onError: (err) => setRowErrorMsg(extractErr(err)),
  });

  if (isError) {
    return (
      <ErrorPanel
        message={error instanceof Error ? error.message : undefined}
        onRetry={() => refetch()}
      />
    );
  }

  return (
    <div>
      {successMsg && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-green-50 text-green-700 text-sm font-medium">
          {successMsg}
        </div>
      )}
      {rowErrorMsg && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-red-50 text-red-700 text-sm font-medium">
          {rowErrorMsg}
        </div>
      )}

      <div className="flex justify-end mb-4">
        <Button
          onClick={() => setModal({ kind: 'create' })}
          leftIcon={<Plus className="w-4 h-4" />}
        >
          Add Admin
        </Button>
      </div>

      <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Created</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {isLoading && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-gray-500">
                  Loading...
                </td>
              </tr>
            )}
            {!isLoading && admins.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-gray-500">
                  No admins.
                </td>
              </tr>
            )}
            {admins.map((a) => {
              const isSelf = user?.id === a.id;
              const isLastActive = a.is_active && activeCount <= 1;
              const toggleDisabled =
                toggleMutation.isPending || (a.is_active && isLastActive);
              const deleteDisabled = isSelf || (a.is_active && isLastActive);

              return (
                <tr key={a.id}>
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900">
                      {a.name}
                      {isSelf && (
                        <span className="ml-2 text-xs text-gray-400">(you)</span>
                      )}
                    </div>
                    <div className="text-xs text-gray-500">{a.email}</div>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={a.is_active ? 'active' : 'inactive'} />
                  </td>
                  <td className="px-4 py-3 text-gray-700">
                    {formatDate(a.created_at)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <IconButton
                        title="Reset password"
                        onClick={() => setModal({ kind: 'reset', admin: a })}
                      >
                        <KeyRound className="w-4 h-4" />
                      </IconButton>
                      <IconButton
                        title={
                          a.is_active
                            ? isLastActive
                              ? 'Cannot deactivate the last active admin'
                              : 'Deactivate'
                            : 'Activate'
                        }
                        disabled={toggleDisabled}
                        onClick={() =>
                          toggleMutation.mutate({
                            id: a.id,
                            is_active: !a.is_active,
                          })
                        }
                      >
                        {a.is_active ? (
                          <UserX className="w-4 h-4" />
                        ) : (
                          <UserCheck className="w-4 h-4" />
                        )}
                      </IconButton>
                      <IconButton
                        title={
                          isSelf
                            ? 'You cannot delete yourself'
                            : isLastActive
                              ? 'Cannot delete the last active admin'
                              : 'Delete'
                        }
                        danger
                        disabled={deleteDisabled}
                        onClick={() => setModal({ kind: 'delete', admin: a })}
                      >
                        <Trash2 className="w-4 h-4" />
                      </IconButton>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {modal?.kind === 'create' && (
        <CreateAdminModal
          onClose={() => setModal(null)}
          onSuccess={() => {
            setModal(null);
            invalidate();
            flash('Admin created.');
          }}
        />
      )}
      {modal?.kind === 'reset' && (
        <ResetPasswordModal
          admin={modal.admin}
          onClose={() => setModal(null)}
          onSuccess={() => {
            setModal(null);
            flash('Password reset.');
          }}
        />
      )}
      {modal?.kind === 'delete' && (
        <DeleteAdminModal
          admin={modal.admin}
          onClose={() => setModal(null)}
          onSuccess={() => {
            setModal(null);
            invalidate();
            flash('Admin deleted.');
          }}
        />
      )}
    </div>
  );
}

function IconButton({
  children,
  onClick,
  title,
  disabled,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  disabled?: boolean;
  danger?: boolean;
}) {
  const base =
    'inline-flex items-center justify-center w-8 h-8 rounded border transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
  const color = danger
    ? 'border-red-200 text-red-600 hover:bg-red-50'
    : 'border-gray-200 text-gray-600 hover:bg-gray-50';
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className={`${base} ${color}`}
    >
      {children}
    </button>
  );
}

function CreateAdminModal({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const mutation = useMutation({
    mutationFn: async () => {
      await api.post('/admin/admins', { name, email, password });
    },
    onSuccess,
    onError: (err) => setErrorMsg(extractErr(err)),
  });

  const canSubmit =
    !mutation.isPending &&
    name.trim().length >= 2 &&
    /.+@.+\..+/.test(email) &&
    password.length >= 8;

  return (
    <Modal
      open
      onClose={onClose}
      title="Add Admin"
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
            Create
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Name" value={name} onChange={setName} maxLength={100} />
        <Field
          label="Email"
          value={email}
          onChange={setEmail}
          maxLength={200}
          type="email"
        />
        <Field
          label="Password (min 8 chars)"
          value={password}
          onChange={setPassword}
          type="password"
        />
        {errorMsg && (
          <div className="px-3 py-2 rounded bg-red-50 text-red-700 text-sm">
            {errorMsg}
          </div>
        )}
      </div>
    </Modal>
  );
}

function ResetPasswordModal({
  admin,
  onClose,
  onSuccess,
}: {
  admin: AdminRow;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [password, setPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const mutation = useMutation({
    mutationFn: async () => {
      await api.put(`/admin/admins/${admin.id}/password`, { password });
    },
    onSuccess,
    onError: (err) => setErrorMsg(extractErr(err)),
  });

  const canSubmit = !mutation.isPending && password.length >= 8;

  return (
    <Modal
      open
      onClose={onClose}
      title={`Reset password for ${admin.name}`}
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
            Reset password
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field
          label="New password (min 8 chars)"
          value={password}
          onChange={setPassword}
          type="password"
        />
        {errorMsg && (
          <div className="px-3 py-2 rounded bg-red-50 text-red-700 text-sm">
            {errorMsg}
          </div>
        )}
      </div>
    </Modal>
  );
}

function DeleteAdminModal({
  admin,
  onClose,
  onSuccess,
}: {
  admin: AdminRow;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [errorMsg, setErrorMsg] = useState('');

  const mutation = useMutation({
    mutationFn: async () => {
      await api.delete(`/admin/admins/${admin.id}`);
    },
    onSuccess,
    onError: (err) => setErrorMsg(extractErr(err)),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={`Delete ${admin.name}?`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={() => mutation.mutate()}
            loading={mutation.isPending}
          >
            Delete
          </Button>
        </>
      }
    >
      <p className="text-sm text-gray-600">
        This permanently removes the admin account for <b>{admin.email}</b>. This cannot be undone.
      </p>
      {errorMsg && (
        <div className="mt-3 px-3 py-2 rounded bg-red-50 text-red-700 text-sm">
          {errorMsg}
        </div>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// System Status
// ---------------------------------------------------------------------------

function SystemStatusTab() {
  return (
    <div className="space-y-6">
      <CoreStatusGrid />
      <FreeradiusCard />
    </div>
  );
}

function CoreStatusGrid() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['admin-system-status'],
    queryFn: async () => {
      const { data: res } = await api.get('/admin/system-status');
      return res.data as SystemStatus;
    },
    refetchInterval: 30_000,
  });

  if (isLoading) {
    return <div className="text-gray-500">Loading system status...</div>;
  }
  if (isError || !data) {
    return (
      <ErrorPanel
        message={error instanceof Error ? error.message : undefined}
        onRetry={() => refetch()}
      />
    );
  }

  const dbValue =
    data.database.status === 'ok'
      ? data.database.responseMs != null
        ? `OK (${data.database.responseMs} ms)`
        : 'OK'
      : 'Error';
  const redisValue =
    data.redis.status === 'ok'
      ? data.redis.responseMs != null
        ? `OK (${data.redis.responseMs} ms)`
        : 'OK'
      : 'Error';

  const fcmTone: StatusTone =
    data.fcm.status === 'ok'
      ? 'ok'
      : data.fcm.status === 'disabled'
        ? 'disabled'
        : 'error';
  const fcmValue =
    data.fcm.status === 'ok'
      ? 'Enabled'
      : data.fcm.status === 'disabled'
        ? 'Disabled'
        : 'Error';

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      <StatusCard
        title="Database"
        value={dbValue}
        tone={data.database.status === 'ok' ? 'ok' : 'error'}
        subtitle={data.database.message}
      />
      <StatusCard
        title="Redis"
        value={redisValue}
        tone={data.redis.status === 'ok' ? 'ok' : 'error'}
        subtitle={data.redis.message}
      />
      <StatusCard title="FCM" value={fcmValue} tone={fcmTone} subtitle={data.fcm.message} />
      <StatusCard
        title="Uptime"
        value={formatUptime(data.process.uptimeSeconds)}
        tone="neutral"
      />
      <StatusCard
        title="Node Version"
        value={data.process.nodeVersion}
        tone="neutral"
      />
      <StatusCard
        title="Memory"
        value={`${data.process.memoryMb} MB`}
        tone="neutral"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// FreeRADIUS
// ---------------------------------------------------------------------------

function FreeradiusCard() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['admin-freeradius-status'],
    queryFn: async () => {
      const { data: res } = await api.get('/admin/freeradius/status');
      return res.data as FreeradiusStatus;
    },
    refetchInterval: 30_000,
  });

  if (isLoading) {
    return <div className="text-gray-500">Loading FreeRADIUS status...</div>;
  }
  if (isError || !data) {
    return (
      <ErrorPanel
        message={error instanceof Error ? error.message : undefined}
        onRetry={() => refetch()}
      />
    );
  }

  // The control socket must exist and be both readable and writable for the
  // backend's radmin probes to reach FreeRADIUS.
  const healthy = data.socket.exists && data.socket.readable && data.socket.writable;
  const rawOutput = data.clients.raw?.trim()
    ? data.clients.raw
    : 'No output — radmin returned nothing (socket unreachable, or no NAS clients cached yet).';

  return (
    <div
      className={`rounded-lg border p-4 ${
        healthy ? 'border-green-300 bg-green-50' : 'border-red-300 bg-red-50'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">
            FreeRADIUS
          </div>
          <div
            className={`mt-1 inline-flex items-center gap-1.5 text-lg font-semibold ${
              healthy ? 'text-green-800' : 'text-red-800'
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full ${healthy ? 'bg-green-500' : 'bg-red-500'}`}
            />
            {healthy ? 'Healthy' : 'Unhealthy'}
          </div>
        </div>
        <div className="text-right text-xs text-gray-600">
          <div>
            <span className="font-medium">{data.clients.lineCount}</span> cached client
            {data.clients.lineCount === 1 ? '' : 's'}
          </div>
          <div className="mt-0.5">
            socket: {data.socket.exists ? 'present' : 'missing'}
            {data.socket.exists &&
              `, ${data.socket.readable ? 'r' : '-'}${data.socket.writable ? 'w' : '-'}`}
          </div>
        </div>
      </div>

      <div className="mt-2 text-xs text-gray-500">
        Control socket:{' '}
        <code className="bg-white/70 px-1 py-0.5 rounded break-all">{data.socket.path}</code>
      </div>

      <details className="mt-3 rounded-lg border border-black/5 bg-white/60">
        <summary className="px-3 py-2 text-sm font-medium text-gray-700 cursor-pointer hover:bg-black/5 rounded-lg">
          Raw radmin output
        </summary>
        <div className="p-3">
          <pre className="text-xs bg-slate-900 text-slate-100 rounded p-3 overflow-x-auto whitespace-pre-wrap break-all">
            {rawOutput}
          </pre>
        </div>
      </details>
    </div>
  );
}

type StatusTone = 'ok' | 'error' | 'disabled' | 'neutral';

function StatusCard({
  title,
  value,
  tone,
  subtitle,
}: {
  title: string;
  value: string;
  tone: StatusTone;
  subtitle?: string;
}) {
  const tones: Record<StatusTone, string> = {
    ok: 'border-green-300 bg-green-50',
    error: 'border-red-300 bg-red-50',
    disabled: 'border-gray-300 bg-gray-50',
    neutral: 'border-gray-200 bg-white',
  };
  const valueTones: Record<StatusTone, string> = {
    ok: 'text-green-800',
    error: 'text-red-800',
    disabled: 'text-gray-600',
    neutral: 'text-gray-900',
  };
  return (
    <div className={`rounded-lg border p-4 ${tones[tone]}`}>
      <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">
        {title}
      </div>
      <div className={`mt-1 text-lg font-semibold ${valueTones[tone]}`}>{value}</div>
      {subtitle && <div className="mt-1 text-xs text-gray-600">{subtitle}</div>}
    </div>
  );
}

function formatUptime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0 || days > 0) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);
  return parts.join(' ');
}
