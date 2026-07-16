import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Send } from 'lucide-react';
import api from '../lib/api';
import { formatDateTime } from '../lib/datetime';
import DataTable, { type Column } from '../components/DataTable';
import ErrorPanel from '../components/ErrorPanel';
import Button from '../components/ui/Button';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import { useToast } from '../hooks/useToast';

interface AnnouncementRow {
  id: string;
  titleEn: string;
  titleAr: string;
  bodyEn: string;
  bodyAr: string;
  audience: string;
  recipientCount: number;
  pushSuccessCount: number | null;
  pushFailureCount: number | null;
  createdAt: string;
  adminName: string;
  [key: string]: unknown;
}

const LIMIT = 20;
const TITLE_MAX = 200;
const BODY_MAX = 2000;

// Keys of the compose form, in render/validation order.
const FIELDS = ['titleEn', 'titleAr', 'bodyEn', 'bodyAr'] as const;
type FieldKey = (typeof FIELDS)[number];

const EMPTY_FORM: Record<FieldKey, string> = {
  titleEn: '',
  titleAr: '',
  bodyEn: '',
  bodyAr: '',
};

const REQUIRED_MESSAGES: Record<FieldKey, string> = {
  titleEn: 'Title (English) is required.',
  titleAr: 'Title (Arabic) is required.',
  bodyEn: 'Body (English) is required.',
  bodyAr: 'Body (Arabic) is required.',
};

function extractErrorMessage(err: unknown, fallback = 'Request failed'): string {
  const e = err as { response?: { data?: { error?: { message?: string } } } };
  return e.response?.data?.error?.message ?? fallback;
}

/** History push column: "12 ok / 1 failed", or "—" while counts are null. */
function pushLabel(row: AnnouncementRow): string {
  if (row.pushSuccessCount == null || row.pushFailureCount == null) return '—';
  return `${row.pushSuccessCount} ok / ${row.pushFailureCount} failed`;
}

function DetailField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-1 text-slate-700">{children}</div>
    </div>
  );
}

function CharCounter({ len, max }: { len: number; max: number }) {
  return (
    <span className={`text-xs tabular-nums ${len > max ? 'text-red-600' : 'text-slate-400'}`}>
      {len}/{max}
    </span>
  );
}

export default function AnnouncementsPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [form, setForm] = useState<Record<FieldKey, string>>(EMPTY_FORM);
  const [errors, setErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [detail, setDetail] = useState<AnnouncementRow | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['admin', 'announcements', page],
    queryFn: async () => {
      const { data: res } = await api.get('/admin/announcements', {
        params: { page, limit: LIMIT },
      });
      return res;
    },
  });

  const sendMutation = useMutation({
    mutationFn: async () => {
      const { data: res } = await api.post('/admin/announcements', {
        titleEn: form.titleEn.trim(),
        titleAr: form.titleAr.trim(),
        bodyEn: form.bodyEn.trim(),
        bodyAr: form.bodyAr.trim(),
      });
      return res;
    },
    onSuccess: (res) => {
      const count: number = res?.data?.recipientCount ?? 0;
      toast.success(`Announcement sent to ${count} operator${count === 1 ? '' : 's'}.`);
      setForm(EMPTY_FORM);
      setErrors({});
      setConfirmOpen(false);
      queryClient.invalidateQueries({ queryKey: ['admin', 'announcements'] });
    },
    onError: (err: unknown) => toast.error(extractErrorMessage(err)),
  });

  const setField = (key: FieldKey, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    // Clear the field's error as soon as the operator starts fixing it.
    setErrors((prev) => (prev[key] ? { ...prev, [key]: undefined } : prev));
  };

  const validate = (): Partial<Record<FieldKey, string>> => {
    const next: Partial<Record<FieldKey, string>> = {};
    for (const key of FIELDS) {
      if (!form[key].trim()) next[key] = REQUIRED_MESSAGES[key];
    }
    return next;
  };

  // "Send announcement" → validate client-side, then gate behind the confirm dialog.
  const handleSendClick = () => {
    const next = validate();
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    setConfirmOpen(true);
  };

  const announcements: AnnouncementRow[] = data?.data ?? [];
  const total: number = data?.meta?.total ?? 0;

  const columns: Column<AnnouncementRow>[] = [
    {
      key: 'createdAt',
      header: 'Sent',
      render: (row) => formatDateTime(row.createdAt),
    },
    {
      key: 'title',
      header: 'Title',
      render: (row) => (
        <div className="max-w-xs">
          <div className="font-medium text-slate-900 truncate">{row.titleEn}</div>
          <div dir="rtl" className="text-xs text-slate-500 truncate">
            {row.titleAr}
          </div>
        </div>
      ),
    },
    {
      key: 'adminName',
      header: 'Sent by',
      render: (row) => row.adminName ?? <span className="text-slate-400">—</span>,
    },
    {
      key: 'recipientCount',
      header: 'Recipients',
      render: (row) => row.recipientCount,
    },
    {
      key: 'push',
      header: 'Push',
      render: (row) => pushLabel(row),
    },
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Announcements</h1>

      {/* Compose card */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 mb-8">
        <h2 className="text-sm font-semibold text-slate-900 mb-1">New announcement</h2>
        <p className="text-xs text-slate-500 mb-4">
          Broadcasts an in-app notification and push to every active operator.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Title (English) */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label htmlFor="ann-title-en" className="text-sm font-medium text-slate-700">
                Title (English)
              </label>
              <CharCounter len={form.titleEn.length} max={TITLE_MAX} />
            </div>
            <input
              id="ann-title-en"
              type="text"
              maxLength={TITLE_MAX}
              value={form.titleEn}
              onChange={(e) => setField('titleEn', e.target.value)}
              placeholder="Scheduled maintenance tonight"
              className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                errors.titleEn ? 'border-red-400' : 'border-slate-300'
              }`}
            />
            {errors.titleEn && <p className="mt-1 text-xs text-red-600">{errors.titleEn}</p>}
          </div>

          {/* Title (Arabic) */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label htmlFor="ann-title-ar" className="text-sm font-medium text-slate-700">
                Title (Arabic)
              </label>
              <CharCounter len={form.titleAr.length} max={TITLE_MAX} />
            </div>
            <input
              id="ann-title-ar"
              type="text"
              dir="rtl"
              maxLength={TITLE_MAX}
              value={form.titleAr}
              onChange={(e) => setField('titleAr', e.target.value)}
              placeholder="عنوان الإعلان"
              className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                errors.titleAr ? 'border-red-400' : 'border-slate-300'
              }`}
            />
            {errors.titleAr && <p className="mt-1 text-xs text-red-600">{errors.titleAr}</p>}
          </div>

          {/* Body (English) */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label htmlFor="ann-body-en" className="text-sm font-medium text-slate-700">
                Body (English)
              </label>
              <CharCounter len={form.bodyEn.length} max={BODY_MAX} />
            </div>
            <textarea
              id="ann-body-en"
              rows={5}
              maxLength={BODY_MAX}
              value={form.bodyEn}
              onChange={(e) => setField('bodyEn', e.target.value)}
              placeholder="Describe the announcement for operators…"
              className={`w-full px-3 py-2 border rounded-lg text-sm resize-y focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                errors.bodyEn ? 'border-red-400' : 'border-slate-300'
              }`}
            />
            {errors.bodyEn && <p className="mt-1 text-xs text-red-600">{errors.bodyEn}</p>}
          </div>

          {/* Body (Arabic) */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label htmlFor="ann-body-ar" className="text-sm font-medium text-slate-700">
                Body (Arabic)
              </label>
              <CharCounter len={form.bodyAr.length} max={BODY_MAX} />
            </div>
            <textarea
              id="ann-body-ar"
              dir="rtl"
              rows={5}
              maxLength={BODY_MAX}
              value={form.bodyAr}
              onChange={(e) => setField('bodyAr', e.target.value)}
              placeholder="نص الإعلان للمشغّلين…"
              className={`w-full px-3 py-2 border rounded-lg text-sm resize-y focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                errors.bodyAr ? 'border-red-400' : 'border-slate-300'
              }`}
            />
            {errors.bodyAr && <p className="mt-1 text-xs text-red-600">{errors.bodyAr}</p>}
          </div>
        </div>

        <div className="mt-4 flex justify-end">
          <Button
            variant="primary"
            leftIcon={<Send className="w-4 h-4" />}
            loading={sendMutation.isPending}
            onClick={handleSendClick}
          >
            Send announcement
          </Button>
        </div>
      </div>

      {/* History */}
      <h2 className="text-sm font-semibold text-slate-900 mb-3">History</h2>
      {isError ? (
        <ErrorPanel
          message={error instanceof Error ? error.message : undefined}
          onRetry={() => refetch()}
        />
      ) : (
        <DataTable
          columns={columns}
          data={announcements}
          total={total}
          page={page}
          limit={LIMIT}
          onPageChange={setPage}
          isLoading={isLoading}
          onRowClick={setDetail}
        />
      )}

      {/* Detail modal */}
      <Modal
        open={!!detail}
        onClose={() => setDetail(null)}
        title="Announcement"
        size="lg"
        footer={
          <Button variant="ghost" onClick={() => setDetail(null)}>
            Close
          </Button>
        }
      >
        {detail && (
          <div className="space-y-5 text-sm">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <DetailField label="Sent">{formatDateTime(detail.createdAt)}</DetailField>
              <DetailField label="Sent by">
                {detail.adminName ?? <span className="text-slate-400">—</span>}
              </DetailField>
              <DetailField label="Audience">{detail.audience}</DetailField>
              <DetailField label="Recipients">{detail.recipientCount}</DetailField>
              <DetailField label="Push">{pushLabel(detail)}</DetailField>
            </div>

            <div className="border-t border-slate-200 pt-4 space-y-4">
              <DetailField label="Title (English)">
                <div className="font-medium text-slate-900">{detail.titleEn}</div>
              </DetailField>
              <DetailField label="Title (Arabic)">
                <div dir="rtl" className="font-medium text-slate-900">
                  {detail.titleAr}
                </div>
              </DetailField>
              <DetailField label="Body (English)">
                <p className="whitespace-pre-wrap text-slate-700">{detail.bodyEn}</p>
              </DetailField>
              <DetailField label="Body (Arabic)">
                <p dir="rtl" className="whitespace-pre-wrap text-slate-700">
                  {detail.bodyAr}
                </p>
              </DetailField>
            </div>
          </div>
        )}
      </Modal>

      {/* Confirm before broadcasting */}
      <ConfirmDialog
        open={confirmOpen}
        title="Send announcement"
        message={
          <>
            This notifies <span className="font-medium">all active operators</span> via an in-app
            notification and a push message. It cannot be recalled once sent.
          </>
        }
        confirmLabel="Send"
        variant="primary"
        loading={sendMutation.isPending}
        onConfirm={() => sendMutation.mutate()}
        onClose={() => setConfirmOpen(false)}
      />
    </div>
  );
}
