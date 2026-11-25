import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AlertTriangle } from 'lucide-react';
import type { AnyEntityRecord, EntityKey } from '../shared/types.ts';

export type LayerEntry =
  | {
      layerId: string;
      kind: 'inspect';
      entity: EntityKey;
      recordId: string;
    }
  | {
      layerId: string;
      kind: 'create';
      entity: EntityKey;
    }
  | {
      layerId: string;
      kind: 'edit';
      entity: EntityKey;
      recordId: string;
    }
  | {
      layerId: string;
      kind: 'import-csv';
      entity: EntityKey;
    }
  | {
      layerId: string;
      kind: 'profile';
    }
  | {
      layerId: string;
      kind: 'pick-ref';
      entity: EntityKey;
      title?: string;
      multiple?: boolean;
      selectedIds: string[];
      filterRecord?: (record: AnyEntityRecord) => boolean;
      onSelect: (ids: string[], selectedRecords: AnyEntityRecord[]) => void;
    };

export type NewLayerInput =
  | { kind: 'inspect'; entity: EntityKey; recordId: string }
  | { kind: 'create'; entity: EntityKey }
  | { kind: 'edit'; entity: EntityKey; recordId: string }
  | { kind: 'import-csv'; entity: EntityKey }
  | { kind: 'profile' }
  | {
      kind: 'pick-ref';
      entity: EntityKey;
      title?: string;
      multiple?: boolean;
      selectedIds: string[];
      filterRecord?: (record: AnyEntityRecord) => boolean;
      onSelect: (ids: string[], selectedRecords: AnyEntityRecord[]) => void;
    };

export interface AccountingPrefill {
  refModel: string;
  refId: string;
  refLabel?: string;
  description?: string;
  note?: string;
  amount?: number;
}

export type LedgerStatusFilter = 'all' | 'labeled' | 'unlabeled' | 'not_equal';

interface NavigationContextValue {
  /** Active Page URL path (changes only on Page navigation, never on Layer open) */
  pathname: string;
  navigatePage: (path: string) => void;
  /** Active stacked Layers (path stays unchanged while layers open/stack/close) */
  layers: LayerEntry[];
  openLayer: (layer: NewLayerInput) => void;
  replaceTopLayer: (layer: NewLayerInput) => void;
  popLayer: () => void;
  closeAllLayers: () => void;
  /** Triggers active pages & layers to reload fresh data after mutations */
  dataVersion: number;
  notifyDataChanged: () => void;
  /** Unsaved-changes guard (used by Master Sheet View and other dirty editors) */
  hasUnsavedChanges: boolean;
  unsavedMessage: string;
  setUnsavedChanges: (dirty: boolean, message?: string) => void;
  confirmNavigationIfDirty: (onProceed: () => void) => void;
  /** Optional pre-fill handoff when navigating from Cancel Invoice (Option B) to Manual Journal */
  accountingPrefill: AccountingPrefill | null;
  setAccountingPrefill: (prefill: AccountingPrefill | null) => void;
  clearAccountingPrefill: () => void;
  /** Optional filter handoff when jumping from Financial Statements to Ledger */
  ledgerStatusFilterHandoff: LedgerStatusFilter | null;
  setLedgerStatusFilterHandoff: (filter: LedgerStatusFilter | null) => void;
  clearLedgerStatusFilterHandoff: () => void;
}

const NavigationContext = createContext<NavigationContextValue | null>(null);

let layerSeq = 1;

export function NavigationProvider({ children }: { children: React.ReactNode }) {
  const [pathname, setPathname] = useState<string>(
    () => window.location.pathname || '/'
  );
  const [layers, setLayers] = useState<LayerEntry[]>([]);
  const [dataVersion, setDataVersion] = useState(0);
  const [hasUnsavedChanges, setHasUnsavedChangesState] = useState(false);
  const [unsavedMessage, setUnsavedMessageState] = useState('');
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);
  const [accountingPrefill, setAccountingPrefillState] =
    useState<AccountingPrefill | null>(null);
  const [ledgerStatusFilterHandoff, setLedgerStatusFilterHandoffState] =
    useState<LedgerStatusFilter | null>(null);

  const dirtyRef = useRef(false);
  dirtyRef.current = hasUnsavedChanges;

  const setUnsavedChanges = useCallback((dirty: boolean, message = '') => {
    dirtyRef.current = dirty;
    setHasUnsavedChangesState(dirty);
    setUnsavedMessageState(dirty ? message : '');
  }, []);

  // Warn browser tab close/refresh when there are unsaved changes
  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedChanges]);

  useEffect(() => {
    const onPopState = () => {
      if (dirtyRef.current) {
        // Restore current path and show confirmation dialog instead of losing edits
        const targetPath = window.location.pathname || '/';
        window.history.pushState({}, '', pathname);
        setPendingAction(() => () => {
          dirtyRef.current = false;
          setHasUnsavedChangesState(false);
          setUnsavedMessageState('');
          window.history.pushState({}, '', targetPath);
          setPathname(targetPath);
          setLayers([]);
        });
        return;
      }
      setPathname(window.location.pathname || '/');
      setLayers([]);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [pathname]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (pendingAction) {
          setPendingAction(null);
          return;
        }
        setLayers((prev) => (prev.length > 0 ? prev.slice(0, -1) : prev));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [pendingAction]);

  const performNavigate = useCallback((normalized: string) => {
    if (window.location.pathname !== normalized) {
      window.history.pushState({}, '', normalized);
    }
    setPathname(normalized);
    setLayers([]);
  }, []);

  const navigatePage = useCallback(
    (path: string) => {
      const normalized = path.startsWith('/') ? path : `/${path}`;
      if (normalized === pathname) {
        setLayers([]);
        return;
      }
      if (dirtyRef.current) {
        setPendingAction(() => () => {
          dirtyRef.current = false;
          setHasUnsavedChangesState(false);
          setUnsavedMessageState('');
          performNavigate(normalized);
        });
        return;
      }
      performNavigate(normalized);
    },
    [pathname, performNavigate]
  );

  const confirmNavigationIfDirty = useCallback((onProceed: () => void) => {
    if (dirtyRef.current) {
      setPendingAction(() => () => {
        dirtyRef.current = false;
        setHasUnsavedChangesState(false);
        setUnsavedMessageState('');
        onProceed();
      });
      return;
    }
    onProceed();
  }, []);

  const openLayer = useCallback((layer: NewLayerInput) => {
    const entry = { ...layer, layerId: `layer-${layerSeq++}` } as LayerEntry;
    setLayers((prev) => [...prev, entry]);
  }, []);

  const replaceTopLayer = useCallback((layer: NewLayerInput) => {
    const entry = { ...layer, layerId: `layer-${layerSeq++}` } as LayerEntry;
    setLayers((prev) => (prev.length === 0 ? [entry] : [...prev.slice(0, -1), entry]));
  }, []);

  const popLayer = useCallback(() => {
    setLayers((prev) => prev.slice(0, -1));
  }, []);

  const closeAllLayers = useCallback(() => {
    setLayers([]);
  }, []);

  const notifyDataChanged = useCallback(() => {
    setDataVersion((v) => v + 1);
  }, []);

  const setAccountingPrefill = useCallback((prefill: AccountingPrefill | null) => {
    setAccountingPrefillState(prefill);
  }, []);

  const clearAccountingPrefill = useCallback(() => {
    setAccountingPrefillState(null);
  }, []);

  const setLedgerStatusFilterHandoff = useCallback(
    (filter: LedgerStatusFilter | null) => {
      setLedgerStatusFilterHandoffState(filter);
    },
    []
  );

  const clearLedgerStatusFilterHandoff = useCallback(() => {
    setLedgerStatusFilterHandoffState(null);
  }, []);

  const value = useMemo(
    () => ({
      pathname,
      navigatePage,
      layers,
      openLayer,
      replaceTopLayer,
      popLayer,
      closeAllLayers,
      dataVersion,
      notifyDataChanged,
      hasUnsavedChanges,
      unsavedMessage,
      setUnsavedChanges,
      confirmNavigationIfDirty,
      accountingPrefill,
      setAccountingPrefill,
      clearAccountingPrefill,
      ledgerStatusFilterHandoff,
      setLedgerStatusFilterHandoff,
      clearLedgerStatusFilterHandoff,
    }),
    [
      pathname,
      navigatePage,
      layers,
      openLayer,
      replaceTopLayer,
      popLayer,
      closeAllLayers,
      dataVersion,
      notifyDataChanged,
      hasUnsavedChanges,
      unsavedMessage,
      setUnsavedChanges,
      confirmNavigationIfDirty,
      accountingPrefill,
      setAccountingPrefill,
      clearAccountingPrefill,
      ledgerStatusFilterHandoff,
      setLedgerStatusFilterHandoff,
      clearLedgerStatusFilterHandoff,
    ]
  );

  return (
    <NavigationContext.Provider value={value}>
      {children}

      {/* Unsaved Changes Navigation Confirmation Dialog */}
      {pendingAction && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/45 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="unsaved-nav-title"
        >
          <div className="bg-white border border-slate-200 rounded-xl shadow-xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h3
                  id="unsaved-nav-title"
                  className="font-display text-base font-bold text-slate-900"
                >
                  Unsaved Changes
                </h3>
                <p className="mt-1 text-sm text-slate-600 leading-relaxed">
                  {unsavedMessage ||
                    'You have unsaved changes in the spreadsheet table. Leaving now will discard your edits.'}
                </p>
              </div>
            </div>

            <div className="pt-2 flex items-center justify-end gap-2.5 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setPendingAction(null)}
                className="px-4 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg transition-colors whitespace-nowrap"
              >
                Stay &amp; Keep Editing
              </button>
              <button
                type="button"
                onClick={() => {
                  const proceed = pendingAction;
                  setPendingAction(null);
                  proceed();
                }}
                className="px-4 py-2 text-xs font-semibold text-red-700 bg-red-50 border border-red-200 hover:bg-red-100 rounded-lg transition-colors whitespace-nowrap"
              >
                Discard &amp; Leave
              </button>
            </div>
          </div>
        </div>
      )}
    </NavigationContext.Provider>
  );
}

export function useNavigation(): NavigationContextValue {
  const ctx = useContext(NavigationContext);
  if (!ctx) {
    throw new Error('useNavigation must be used inside NavigationProvider');
  }
  return ctx;
}
