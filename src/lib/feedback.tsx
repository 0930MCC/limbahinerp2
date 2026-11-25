import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AlertCircle, CheckCircle2, X } from 'lucide-react';
import { ApiError, registerApiListeners } from './api.ts';

export type NotificationKind = 'error' | 'success';

interface NotificationItem {
  id: number;
  kind: NotificationKind;
  message: string;
}

interface FeedbackContextValue {
  isLoading: boolean;
  beginLoading: (label?: string) => void;
  endLoading: () => void;
  notifyError: (message: string) => void;
  notifySuccess: (message: string) => void;
  dismissNotification: (id: number) => void;
}

const FeedbackContext = createContext<FeedbackContextValue | null>(null);

const AUTO_DISMISS_MS = 5000;

export function FeedbackProvider({ children }: { children: React.ReactNode }) {
  const [loadingCount, setLoadingCount] = useState(0);
  const [loadingLabel, setLoadingLabel] = useState('Loading...');
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);

  const nextIdRef = useRef(1);
  const timersRef = useRef<Map<number, number>>(new Map());
  const lastMsgRef = useRef<{ text: string; at: number } | null>(null);

  const dismissNotification = useCallback((id: number) => {
    const timer = timersRef.current.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timersRef.current.delete(id);
    }
    setNotifications((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const pushNotification = useCallback(
    (kind: NotificationKind, rawMessage: string) => {
      const message = rawMessage.trim();
      if (!message) return;

      // Prevent duplicate identical notifications within 500ms
      const now = Date.now();
      if (
        lastMsgRef.current &&
        lastMsgRef.current.text === `${kind}:${message}` &&
        now - lastMsgRef.current.at < 500
      ) {
        return;
      }
      lastMsgRef.current = { text: `${kind}:${message}`, at: now };

      const id = nextIdRef.current++;
      setNotifications((prev) => [...prev.slice(-2), { id, kind, message }]);

      const timer = window.setTimeout(() => {
        timersRef.current.delete(id);
        setNotifications((prev) => prev.filter((item) => item.id !== id));
      }, AUTO_DISMISS_MS);
      timersRef.current.set(id, timer);
    },
    []
  );

  const notifyError = useCallback(
    (message: string) => pushNotification('error', message),
    [pushNotification]
  );

  const notifySuccess = useCallback(
    (message: string) => pushNotification('success', message),
    [pushNotification]
  );

  const beginLoading = useCallback((label?: string) => {
    if (label) setLoadingLabel(label);
    setLoadingCount((c) => c + 1);
  }, []);

  const endLoading = useCallback(() => {
    setLoadingCount((c) => {
      const next = Math.max(0, c - 1);
      if (next === 0) setLoadingLabel('Loading...');
      return next;
    });
  }, []);

  // Automatically wire every API request in the app to the translucent loading overlay
  // and bottom error notification bar (excluding intentional auth-gate layer codes).
  useEffect(() => {
    const unsubscribe = registerApiListeners({
      onStart: (label) => beginLoading(label || 'Processing...'),
      onEnd: () => endLoading(),
      onError: (err) => {
        if (
          err instanceof ApiError &&
          (err.code === 'EMAIL_NOT_CONFIRMED' || err.code === 'ACCOUNT_INACTIVE')
        ) {
          return;
        }
        notifyError(err.message || 'An unexpected error occurred.');
      },
    });
    return () => {
      unsubscribe();
    };
  }, [beginLoading, endLoading, notifyError]);

  useEffect(() => {
    return () => {
      for (const timer of timersRef.current.values()) {
        window.clearTimeout(timer);
      }
      timersRef.current.clear();
    };
  }, []);

  const value = useMemo(
    () => ({
      isLoading: loadingCount > 0,
      beginLoading,
      endLoading,
      notifyError,
      notifySuccess,
      dismissNotification,
    }),
    [
      loadingCount,
      beginLoading,
      endLoading,
      notifyError,
      notifySuccess,
      dismissNotification,
    ]
  );

  return (
    <FeedbackContext.Provider value={value}>
      {children}

      {/* Global Translucent Processing / Loading Layer */}
      {loadingCount > 0 && (
        <div
          role="status"
          aria-live="polite"
          aria-label={loadingLabel}
          className="fixed inset-0 z-[70] bg-slate-900/25 backdrop-blur-[2px] flex items-center justify-center transition-opacity"
        >
          <div className="bg-white/95 border border-slate-200 rounded-xl px-6 py-4 shadow-lg flex items-center gap-3.5">
            <span
              aria-hidden="true"
              className="w-5 h-5 rounded-full border-2 border-teal-100 border-t-teal-700 animate-spin shrink-0"
            />
            <span className="text-sm font-medium text-slate-800 whitespace-nowrap">
              {loadingLabel}
            </span>
          </div>
        </div>
      )}

      {/* Global Bottom Auto-Dismiss Notification Bar (5 seconds) */}
      {notifications.length > 0 && (
        <div
          aria-live="assertive"
          className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[80] w-[calc(100%-2rem)] max-w-lg flex flex-col gap-2 pointer-events-none"
        >
          {notifications.map((item) => {
            const isError = item.kind === 'error';
            return (
              <div
                key={item.id}
                role={isError ? 'alert' : 'status'}
                className={`pointer-events-auto relative overflow-hidden rounded-lg border shadow-lg px-4 py-3 flex items-start gap-3 ${
                  isError
                    ? 'bg-[#2A0E12] border-red-800/80 text-white'
                    : 'bg-[#0A4F55] border-teal-700 text-white'
                }`}
              >
                {isError ? (
                  <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                ) : (
                  <CheckCircle2 className="w-4 h-4 text-teal-300 shrink-0 mt-0.5" />
                )}
                <p className="text-xs sm:text-sm leading-snug flex-1 break-words">
                  {item.message}
                </p>
                <button
                  type="button"
                  onClick={() => dismissNotification(item.id)}
                  aria-label="Dismiss notification"
                  className="p-0.5 rounded text-white/70 hover:text-white transition-colors shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
                <span
                  aria-hidden="true"
                  className={`absolute bottom-0 left-0 h-0.5 ${
                    isError ? 'bg-red-400' : 'bg-teal-300'
                  } notif-countdown-bar`}
                />
              </div>
            );
          })}
        </div>
      )}
    </FeedbackContext.Provider>
  );
}

export function useFeedback(): FeedbackContextValue {
  const ctx = useContext(FeedbackContext);
  if (!ctx) {
    throw new Error('useFeedback must be used inside FeedbackProvider');
  }
  return ctx;
}
