import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Copy, Check } from 'lucide-react';
import api from '../lib/api';
import Button from './ui/Button';

interface SetupStep {
  step: number;
  title: string;
  description: string;
  command: string;
}

interface SetupGuide {
  routerName: string;
  setupGuide: string;
  tunnelIp: string | null;
  serverEndpoint: string;
  steps: SetupStep[];
}

function extractErr(err: unknown, fallback = 'Request failed'): string {
  const e = err as {
    response?: { data?: { error?: { message?: string } } };
    message?: string;
  };
  return e.response?.data?.error?.message ?? e.message ?? fallback;
}

/**
 * Fetches and renders a router's setup script from
 * `GET /admin/routers/:id/setup-guide`. Extracted from UserDetailPage so it can
 * be reused by the Routers page; behaviour is unchanged.
 */
export default function SetupGuideView({ routerId }: { routerId: string }) {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['admin-router-setup-guide', routerId],
    queryFn: async () => {
      const { data: res } = await api.get(`/admin/routers/${routerId}/setup-guide`);
      return res.data as SetupGuide;
    },
    enabled: !!routerId,
    staleTime: 0,
    gcTime: 60_000,
  });

  if (isLoading) {
    return <div className="text-sm text-slate-500 py-4">Generating script...</div>;
  }

  if (isError || !data) {
    return (
      <div className="space-y-3">
        <div className="px-3 py-2 rounded bg-red-50 text-red-700 text-sm">
          {error instanceof Error ? error.message : extractErr(error)}
        </div>
        <Button variant="secondary" size="sm" onClick={() => refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
      <div className="flex items-start gap-2 px-3 py-2 rounded-lg border border-yellow-200 bg-yellow-50 text-yellow-800 text-xs">
        <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
        <span>
          This script contains the router&apos;s WireGuard private key and RADIUS secret.
          Anyone with the script can impersonate the router.
        </span>
      </div>

      <div className="text-xs text-slate-500">
        <span className="font-medium">Router:</span> {data.routerName}
        {data.tunnelIp && (
          <>
            {' · '}
            <span className="font-medium">Tunnel IP:</span>{' '}
            <code className="bg-slate-100 px-1 rounded">{data.tunnelIp}</code>
          </>
        )}
      </div>

      <div className="space-y-2">
        {data.steps.map((s) => (
          <StepCard key={s.step} step={s} />
        ))}
      </div>

      <details className="border border-slate-200 rounded-lg">
        <summary className="px-3 py-2 text-sm font-medium text-slate-700 cursor-pointer hover:bg-slate-50">
          Full script
        </summary>
        <div className="p-3 space-y-2">
          <CopyButton text={data.setupGuide} label="Copy all" />
          <pre className="text-xs bg-slate-900 text-slate-100 rounded p-3 overflow-x-auto whitespace-pre-wrap break-all">
            {data.setupGuide}
          </pre>
        </div>
      </details>
    </div>
  );
}

function StepCard({ step }: { step: SetupStep }) {
  return (
    <div className="border border-slate-200 rounded-lg p-3">
      <div className="flex items-start justify-between gap-3 mb-1">
        <div>
          <div className="text-xs font-semibold text-blue-600">Step {step.step}</div>
          <div className="text-sm font-medium text-slate-900">{step.title}</div>
        </div>
        <CopyButton text={step.command} />
      </div>
      {step.description && (
        <p className="text-xs text-slate-500 mb-2">{step.description}</p>
      )}
      <pre className="text-xs bg-slate-900 text-slate-100 rounded p-2 overflow-x-auto whitespace-pre-wrap break-all">
        {step.command}
      </pre>
    </div>
  );
}

function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Ignore — user can still select and copy manually.
    }
  };
  return (
    <button
      type="button"
      onClick={copy}
      aria-label={copied ? 'Copied' : label}
      className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded border border-slate-200 hover:bg-slate-50 transition-colors cursor-pointer ${
        copied ? 'text-green-600' : 'text-slate-600'
      }`}
    >
      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
      {copied ? 'Copied' : label}
    </button>
  );
}
