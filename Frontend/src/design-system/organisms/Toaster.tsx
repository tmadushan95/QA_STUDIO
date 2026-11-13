/**
 * Toaster organism: short confirmations ("Saved", "Cleared 30 test cases") in the corner of the screen.
 * A toast can carry one action, such as "Undo", and stays longer when it does. Announced to screen readers.
 *
 * @example
 * const toast = useToast();
 * toast.show('Parameters saved');
 * toast.show('Cleared 30 test cases', { action: { label: 'Undo', onClick: undo } });
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { IconButton } from '../atoms/Button.js';
import styles from './Toaster.module.css';

interface ToastAction {
  label: string;
  onClick: () => void;
}
interface Toast {
  id: number;
  message: string;
  tone: 'success' | 'danger' | 'info';
  action?: ToastAction;
}
interface ToastApi {
  show(message: string, opts?: { tone?: Toast['tone']; action?: ToastAction }): void;
}

const ToastContext = createContext<ToastApi>({ show: () => undefined });

/** Show toasts from any component under `ToastProvider`. */
export const useToast = () => useContext(ToastContext);

let nextId = 1;

/** Holds the toasts on screen. Wrap the app in it so `useToast` works anywhere. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const api = useMemo<ToastApi>(
    () => ({
      show(message, opts) {
        const t: Toast = {
          id: nextId++,
          message,
          tone: opts?.tone ?? 'success',
          ...(opts?.action && { action: opts.action }),
        };
        setToasts((all) => [...all.slice(-3), t]);
        // An action needs time to be read and used: 30 seconds, otherwise 5.
        setTimeout(() => dismiss(t.id), opts?.action ? 30_000 : 5_000);
      },
    }),
    [dismiss],
  );
  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className={styles.region} role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`${styles.toast} ${styles[t.tone]}`}>
            <span className={styles.message}>{t.message}</span>
            {t.action && (
              <button
                type="button"
                className={styles.action}
                onClick={() => {
                  dismiss(t.id);
                  t.action!.onClick();
                }}
              >
                {t.action.label}
              </button>
            )}
            <IconButton icon="close" label="Dismiss" onClick={() => dismiss(t.id)} />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
