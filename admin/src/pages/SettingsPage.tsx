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
                  ? 'border-indigo-600 text-indigo-600'
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
            className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 disabled:bg-gray-50"
            placeholder="Optional extra guidance shown to the user (e.g. include reference code in the transfer memo)."
          />
          <div className="text-xs text-gray-400 mt-1 text-right">
            {form.instructions.length}/1000
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <button
            onClick={() => mutation.mutate(form)}
            disabled={disabled}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {mutation.isPending ? 'Saving...' : 'Save'}
          </button>
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
        className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 disabled:bg-gray-50"
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
        <button
          onClick={() => setModal({ kind: 'create' })}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add Admin
        </button>
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
    <Modal title="Add Admin" onClose={onClose}>
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
      <ModalActions
        onClose={onClose}
        onConfirm={() => mutation.mutate()}
        confirmLabel={mutation.isPending ? 'Creating...' : 'Create'}
        confirmDisabled={!canSubmit}
      />
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
    <Modal title={`Reset password for ${admin.name}`} onClose={onClose}>
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
      <ModalActions
        onClose={onClose}
        onConfirm={() => mutation.mutate()}
        confirmLabel={mutation.isPending ? 'Saving...' : 'Reset password'}
        confirmDisabled={!canSubmit}
      />
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
    <Modal title={`Delete ${admin.name}?`} onClose={onClose}>
      <p className="text-sm text-gray-600">
        This permanently removes the admin account for <b>{admin.email}</b>. This cannot be undone.
      </p>
      {errorMsg && (
        <div className="mt-3 px-3 py-2 rounded bg-red-50 text-red-700 text-sm">
          {errorMsg}
        </div>
      )}
      <ModalActions
        onClose={onClose}
        onConfirm={() => mutation.mutate()}
        confirmLabel={mutation.isPending ? 'Deleting...' : 'Delete'}
        danger
      />
    </Modal>
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

// ---------------------------------------------------------------------------
// System Status
// ---------------------------------------------------------------------------

function SystemStatusTab() {
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
