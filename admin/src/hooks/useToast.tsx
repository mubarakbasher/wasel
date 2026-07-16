import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import ToastViewport, { type ToastMessage, type ToastType } from '../components/ui/Toast';

interface ToastApi {
  success: (message: string) => void;
  error: (message: string) => void;
}

// Payload shape for the `wasel:toast` window event (raised by non-React code
// such as lib/api.ts, which has no access to React context).
interface ToastEventDetail {
  type: ToastType;
  message: string;
}

const ToastContext = createContext<ToastApi | null>(null);

export const TOAST_EVENT = 'wasel:toast';

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback((type: ToastType, message: string) => {
    const id = nextId.current++;
    setToasts((prev) => [...prev, { id, type, message }]);
  }, []);

  // Stable API object so consumers don't re-render when the toast list changes.
  const api = useMemo<ToastApi>(
    () => ({
      success: (message: string) => push('success', message),
      error: (message: string) => push('error', message),
    }),
    [push],
  );

  // Bridge for non-React callers: window.dispatchEvent(new CustomEvent('wasel:toast', ...)).
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<Partial<ToastEventDetail>>).detail;
      if (!detail || typeof detail.message !== 'string') return;
      push(detail.type === 'error' ? 'error' : 'success', detail.message);
    };
    window.addEventListener(TOAST_EVENT, handler);
    return () => window.removeEventListener(TOAST_EVENT, handler);
  }, [push]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components -- hook colocated with its provider; affects Fast Refresh only, not correctness
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return ctx;
}
