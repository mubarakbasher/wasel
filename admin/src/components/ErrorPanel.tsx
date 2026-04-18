import { AlertTriangle, RefreshCw } from 'lucide-react';

interface ErrorPanelProps {
  message?: string;
  onRetry?: () => void;
  className?: string;
}

/**
 * Compact, reusable error panel for failed useQuery states.
 * Shows a friendly message and an optional retry button.
 */
export default function ErrorPanel({
  message,
  onRetry,
  className,
}: ErrorPanelProps) {
  return (
    <div
      className={
        'flex items-start gap-3 p-4 rounded-lg border border-red-200 bg-red-50 text-red-800 ' +
        (className ?? '')
      }
      role="alert"
    >
      <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">Failed to load data</p>
        {message && (
          <p className="text-xs text-red-700 mt-1 break-words">{message}</p>
        )}
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center gap-1.5 mt-3 px-3 py-1.5 text-xs font-medium rounded bg-red-600 text-white hover:bg-red-700 transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Retry
          </button>
        )}
      </div>
    </div>
  );
}
