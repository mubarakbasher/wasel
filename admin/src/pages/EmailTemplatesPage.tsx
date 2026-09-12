import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Send } from 'lucide-react';
import api from '../lib/api';
import {
  EMAIL_TEMPLATES_KEY,
  fetchEmailTemplates,
  templateTypeLabel,
  templateTypesFrom,
  type EmailTemplate,
} from '../lib/emailTemplates';
import { formatDateTime } from '../lib/datetime';
import Button from '../components/ui/Button';
import ErrorPanel from '../components/ErrorPanel';

const LANGUAGES = ['en', 'ar'] as const;
type Language = (typeof LANGUAGES)[number];

interface FormState {
  subject: string;
  body_html: string;
  is_active: boolean;
}

const EMPTY_FORM: FormState = { subject: '', body_html: '', is_active: true };

function extractErr(err: unknown, fallback = 'Request failed'): string {
  const e = err as { response?: { data?: { error?: { message?: string } } } };
  return e.response?.data?.error?.message ?? fallback;
}

export default function EmailTemplatesPage() {
  const queryClient = useQueryClient();
  const [pickedType, setPickedType] = useState('');
  const [language, setLanguage] = useState<Language>('en');
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [initial, setInitial] = useState<FormState>(EMPTY_FORM);
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [testMsg, setTestMsg] = useState('');
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: EMAIL_TEMPLATES_KEY,
    queryFn: fetchEmailTemplates,
  });

  const templates: EmailTemplate[] = useMemo(() => data ?? [], [data]);
  const types = useMemo(() => templateTypesFrom(templates), [templates]);

  // Selection falls back to the first available type until one is picked, and
  // again if the picked type leaves the catalogue. Empty string when there are
  // no templates at all — the editor then stays disabled rather than crashing.
  const type = types.includes(pickedType) ? pickedType : (types[0] ?? '');

  const selected = useMemo(
    () => templates.find((t) => t.type === type && t.language === language),
    [templates, type, language],
  );

  // Chips come from the row itself; fall back to the other language's row so a
  // missing translation still shows the type's tokens.
  const placeholders = useMemo(() => {
    const row = selected ?? templates.find((t) => t.type === type);
    return Array.isArray(row?.placeholders) ? row.placeholders : [];
  }, [selected, templates, type]);

  const seededKey = useRef<string | null>(null);
  useEffect(() => {
    // Reseed only when the selection changes (type/language switch or initial
    // load) — NOT on a background refetch of the same selection, which would
    // otherwise stomp unsaved edits in the form.
    //
    // Keyed on (type, language), not on the row id: a catalogue type with no DB
    // row arrives with a synthetic `default:<type>:<lang>` id that becomes a real
    // UUID on its first save, so an id-keyed guard would read the post-save
    // refetch as a selection change and silently discard whatever was typed
    // while the save was in flight.
    const key = `${type}:${language}`;
    if (!selected || seededKey.current === key) return;
    seededKey.current = key;
    const next: FormState = {
      subject: selected.subject ?? '',
      body_html: selected.body_html ?? '',
      is_active: selected.is_active ?? true,
    };
    // eslint-disable-next-line react-hooks/set-state-in-effect -- seed the editable form from the selected template on selection change / first load
    setForm(next);
    setInitial(next);
  }, [selected, type, language]);

  const dirty = useMemo(
    () =>
      form.subject !== initial.subject ||
      form.body_html !== initial.body_html ||
      form.is_active !== initial.is_active,
    [form, initial],
  );

  const saveMutation = useMutation({
    mutationFn: async (body: FormState) => {
      // Both segments are encoded: `type` is a server-supplied string, and a
      // `/`, `?` or `#` in it would otherwise retarget this PUT at another route.
      await api.put(
        `/admin/email-templates/${encodeURIComponent(type)}/${encodeURIComponent(language)}`,
        body,
      );
    },
    onSuccess: (_data, submitted) => {
      queryClient.invalidateQueries({ queryKey: EMAIL_TEMPLATES_KEY });
      // The baseline is what was actually PUT, not the current form — anything
      // typed while the request was in flight is still unsaved and must keep
      // showing as dirty.
      setInitial(submitted);
      setSuccessMsg('Template saved.');
      setErrorMsg('');
      setTestMsg('');
      setTimeout(() => setSuccessMsg(''), 3000);
    },
    onError: (err) => {
      setErrorMsg(extractErr(err));
    },
  });

  const testMutation = useMutation({
    mutationFn: async () => {
      await api.post('/admin/email-templates/test', { type, language });
    },
    onSuccess: () => {
      setTestMsg('Test email sent to your inbox.');
      setErrorMsg('');
      setTimeout(() => setTestMsg(''), 3000);
    },
    onError: (err) => {
      setErrorMsg(extractErr(err));
    },
  });

  function insertPlaceholder(token: string) {
    const el = bodyRef.current;
    if (!el) {
      setForm((f) => ({ ...f, body_html: f.body_html + token }));
      return;
    }
    const start = el.selectionStart ?? form.body_html.length;
    const end = el.selectionEnd ?? form.body_html.length;
    const next = form.body_html.slice(0, start) + token + form.body_html.slice(end);
    setForm((f) => ({ ...f, body_html: next }));
    // Restore caret just after the inserted token.
    requestAnimationFrame(() => {
      el.focus();
      const caret = start + token.length;
      el.setSelectionRange(caret, caret);
    });
  }

  if (isError) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Email Templates</h1>
        <ErrorPanel
          message={error instanceof Error ? error.message : undefined}
          onRetry={() => refetch()}
        />
      </div>
    );
  }

  // Only an explicit false locks the editor, so a response without the field
  // (an older backend behind a cached bundle) still behaves as before.
  const readOnly = selected?.is_editable === false;

  const fieldsDisabled = isLoading || !selected || readOnly;
  const saveDisabled = saveMutation.isPending || !dirty || fieldsDisabled;

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Email Templates</h1>

      {successMsg && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-green-50 text-green-700 text-sm font-medium">
          {successMsg}
        </div>
      )}
      {testMsg && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-blue-50 text-blue-700 text-sm font-medium">
          {testMsg}
        </div>
      )}
      {errorMsg && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-red-50 text-red-700 text-sm font-medium">
          {errorMsg}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-6">
        {/* Type selector */}
        <div className="bg-white rounded-lg border shadow-sm p-2 h-fit">
          <ul className="space-y-1">
            {types.map((t) => (
              <li key={t}>
                <button
                  onClick={() => setPickedType(t)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    type === t
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  {templateTypeLabel(t)}
                </button>
              </li>
            ))}
          </ul>
        </div>

        {/* Editor */}
        <div className="space-y-4">
          {/* Language toggle + meta */}
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="inline-flex rounded-lg border border-gray-300 overflow-hidden">
              {LANGUAGES.map((lang) => (
                <button
                  key={lang}
                  onClick={() => setLanguage(lang)}
                  className={`px-4 py-2 text-sm font-medium transition-colors ${
                    language === lang
                      ? 'bg-blue-600 text-white'
                      : 'bg-white text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {lang.toUpperCase()}
                </button>
              ))}
            </div>
            {selected && (
              <span className="text-xs text-gray-400">
                Last updated {formatDateTime(selected.updated_at)}
              </span>
            )}
          </div>

          <div className="bg-white rounded-lg border shadow-sm p-6 space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Subject</label>
              <input
                type="text"
                value={form.subject}
                onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}
                disabled={fieldsDisabled}
                maxLength={255}
                className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-50"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Body (HTML)</label>
              <textarea
                ref={bodyRef}
                rows={16}
                value={form.body_html}
                onChange={(e) => setForm((f) => ({ ...f, body_html: e.target.value }))}
                disabled={fieldsDisabled}
                className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-50"
                placeholder="<p>Hello {name}...</p>"
              />
            </div>

            {/* Placeholders */}
            {placeholders.length > 0 && (
              <div>
                <p className="text-xs font-medium text-gray-500 mb-2">Available placeholders</p>
                <div className="flex flex-wrap gap-2">
                  {placeholders.map((token) => (
                    <button
                      key={token}
                      type="button"
                      onClick={() => insertPlaceholder(token)}
                      disabled={fieldsDisabled}
                      title="Insert placeholder"
                      className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-mono bg-gray-100 text-gray-700 hover:bg-blue-100 hover:text-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {token}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
                disabled={fieldsDisabled}
                className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              Active (uncheck to disable this language version — sends fall back to English / the built-in default)
            </label>

            <div className="flex items-center justify-end gap-3 pt-2 border-t border-gray-100">
              {readOnly && (
                <p className="mr-auto text-xs text-gray-500">
                  This template type is no longer used by the app, so it cannot be edited or tested.
                </p>
              )}
              <Button
                variant="secondary"
                leftIcon={<Send className="w-4 h-4" />}
                onClick={() => testMutation.mutate()}
                loading={testMutation.isPending}
                disabled={testMutation.isPending || fieldsDisabled}
                title={dirty && !readOnly ? 'Sends the last saved version' : undefined}
              >
                Send test to me
              </Button>
              <Button
                onClick={() => saveMutation.mutate(form)}
                loading={saveMutation.isPending}
                disabled={saveDisabled}
              >
                Save
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
