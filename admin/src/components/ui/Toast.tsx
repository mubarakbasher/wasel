import { useEffect, type ReactNode } from 'react';
import { CheckCircle, XCircle, X } from 'lucide-react';

export type ToastType = 'success' | 'error';

export interface ToastMessage {
  id: number;
  type: ToastType;
  message: string;
}

// How long a toast stays on screen before it auto-dismisses.
export const TOAST_DURATION_MS = 4000;

const typeStyles: Record<ToastType, { container: string; icon: ReactNode }> = {
  success: {
    container: 'bg-white border-green-200 text-slate-800',
    icon: <CheckCircle className="w-5 h-5 shrink-0 text-green-600" />,
  },
  error: {
    container: 'bg-white border-red-200 text-slate-800',
    icon: <XCircle className="w-5 h-5 shrink-0 text-red-600" />,
  },
};

function ToastItem({
  toast,
  onDismiss,
}: {
  toast: ToastMessage;
  onDismiss: (id: number) => void;
}) {
  const { id } = toast;
  const styles = typeStyles[toast.type];

  useEffect(() => {
    const timer = setTimeout(() => onDismiss(id), TOAST_DURATION_MS);
    return () => clearTimeout(timer);
  }, [id, onDismiss]);

  return (
    <div
      role="status"
      aria-live="polite"
      className={`pointer-events-auto flex items-start gap-3 w-full rounded-lg border shadow-lg px-4 py-3 text-sm font-medium animate-[modalIn_150ms_ease-out] ${styles.container}`}
    >
      {styles.icon}
      <span className="flex-1 break-words">{toast.message}</span>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => onDismiss(id)}
        className="text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

/**
 * Fixed, top-right stack that renders active toasts. Purely presentational —
 * state and lifecycle live in ToastProvider (hooks/useToast).
 */
export default function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: ToastMessage[];
  onDismiss: (id: number) => void;
}) {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-[60] flex w-full max-w-sm flex-col gap-2 pointer-events-none">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}
