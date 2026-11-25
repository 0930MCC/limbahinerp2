import React, { useEffect, useMemo, useState } from 'react';
import { LogOut, Menu } from 'lucide-react';
import { AccountingPage } from './components/AccountingPage.tsx';
import {
  AuthScreen,
  type AuthenticatedPayload,
  type PasswordRecoveryPayload,
} from './components/AuthScreen.tsx';
import { DashboardLockLayer } from './components/DashboardLockLayer.tsx';
import { DashboardView } from './components/DashboardView.tsx';
import { EntityPage } from './components/EntityPage.tsx';
import { FinancialStatementsPage } from './components/FinancialStatementsPage.tsx';
import { LayerHost } from './components/LayerHost.tsx';
import { ModePlaceholderPage } from './components/ModePlaceholderPage.tsx';
import { Sidebar } from './components/Sidebar.tsx';
import { DashboardSkeleton } from './components/Skeleton.tsx';
import { api, setAuthToken } from './lib/api.ts';
import { FeedbackProvider, useFeedback } from './lib/feedback.tsx';
import { NavigationProvider, useNavigation } from './lib/navigation.tsx';
import {
  ENTITY_META,
  canAccessRoute,
  defaultRouteForRole,
} from './shared/entityMeta.ts';
import type {
  AccountLockReason,
  AuthProfileUpdateResponse,
  EntityKey,
  OperationalMode,
  WorkerRecord,
} from './shared/types.ts';

const ROUTE_TO_ENTITY: Record<string, EntityKey> = {
  '/b3/workers': 'workers',
  '/b3/clients': 'customers',
  '/b3/branches': 'branches',
  '/b3/requests': 'requests',
  '/b3/marketing': 'commissions',
  '/b3/items': 'items',
  '/b3/operational/schedule': 'schedules',
  '/b3/operational/data': 'pickup_data',
  '/b3/documents/purchase-order': 'purchase_orders',
  '/b3/documents/ba': 'berita_acara',
  '/b3/documents/invoice': 'invoices',
  '/b3/documents/certificate': 'certificates',
  '/b3/documents/fpl-real': 'fpl_real',
  '/b3/documents/fpl-doc': 'fpl_doc',
  '/b3/logs': 'logs',
};

function WorkspaceShell({
  worker,
  isLocked,
  onProfileUpdated,
  onSignOut,
}: {
  worker: WorkerRecord;
  isLocked: boolean;
  onProfileUpdated: (res: AuthProfileUpdateResponse) => void;
  onSignOut: () => void;
}) {
  const { pathname, navigatePage } = useNavigation();
  const [mode, setMode] = useState<OperationalMode>(() => {
    if (pathname === '/domestik') return 'domestik';
    return 'limbah_b3';
  });
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  // Sync mode when pathname changes via browser back/forward
  useEffect(() => {
    if (pathname === '/domestik') setMode('domestik');
    else setMode('limbah_b3');
  }, [pathname]);

  // Enforce role-based landing redirect if user visits root, legacy /b3/users, or disallowed route
  useEffect(() => {
    if (pathname === '/b3/users') {
      navigatePage(worker.role === 'master' ? '/b3/workers' : '/b3/clients');
      return;
    }
    const allowedPaths = [
      '/b3/dashboard',
      '/b3/logs',
      '/b3/workers',
      '/b3/clients',
      '/b3/branches',
      '/b3/requests',
      '/b3/marketing',
      '/b3/items',
      '/b3/operational/schedule',
      '/b3/operational/data',
      '/b3/documents/purchase-order',
      '/b3/documents/ba',
      '/b3/documents/invoice',
      '/b3/documents/certificate',
      '/b3/documents/fpl-real',
      '/b3/documents/fpl-doc',
      '/b3/accounting/records',
      '/b3/accounting/statements',
      '/b3/accounting/coa',
      '/domestik',
    ];
    if (
      pathname === '/' ||
      !allowedPaths.includes(pathname) ||
      !canAccessRoute(worker.role, pathname)
    ) {
      navigatePage(defaultRouteForRole(worker.role));
    }
  }, [pathname, worker.role, navigatePage]);

  const pageMeta = useMemo(() => {
    if (pathname === '/b3/dashboard') {
      return {
        breadcrumb: ['Limbah B3', 'Dashboard'],
        title: 'Executive Dashboard',
        subtitle: 'Operational tonnage, receivables, and dispatch performance.',
      };
    }
    if (pathname === '/b3/logs') {
      return {
        breadcrumb: ['Limbah B3', 'Overview', 'Audit Logs'],
        title: 'Audit Logs',
        subtitle: ENTITY_META.logs.description,
      };
    }
    if (pathname === '/b3/accounting/records') {
      return {
        breadcrumb: ['Limbah B3', 'Accounting', 'Ledger & Journal'],
        title: 'Ledger & Journal (RCRD)',
        subtitle:
          'Double-entry transaction records, split classifications, manual journals, and single-CSV Excel import/update.',
      };
    }
    if (pathname === '/b3/accounting/statements') {
      return {
        breadcrumb: ['Limbah B3', 'Accounting', 'Financial Statements'],
        title: 'Financial Statements (BS, IS & Cash Flow)',
        subtitle:
          'Auto-generated Income Statement, Balance Sheet, and Direct Cash Flow Statement from labeled double-entry records.',
      };
    }
    if (pathname === '/b3/accounting/coa') {
      return {
        breadcrumb: ['Limbah B3', 'Accounting', 'Chart of Accounts'],
        title: 'Chart of Accounts (COA)',
        subtitle:
          'Multi-tenant accounting codes across Assets, Liabilities, Equity, Revenue, and Expenses.',
      };
    }
    if (pathname === '/domestik') {
      return {
        breadcrumb: ['Limbah Domestik', 'Module Status'],
        title: 'Limbah Domestik',
        subtitle: 'Non-hazardous waste management module.',
      };
    }
    const entity = ROUTE_TO_ENTITY[pathname];
    if (entity) {
      const m = ENTITY_META[entity];
      const section =
        pathname.includes('/operational/') || pathname === '/b3/requests'
          ? 'Operational'
          : pathname.includes('/documents/')
            ? 'Document'
            : 'Master Data';
      return {
        breadcrumb: ['Limbah B3', section, m.plural],
        title: m.plural,
        subtitle: m.description,
      };
    }
    return {
      breadcrumb: ['Limbah B3'],
      title: 'LIMBAHIN ERP',
      subtitle: '',
    };
  }, [pathname]);

  const renderMainContent = () => {
    if (isLocked) {
      return <DashboardSkeleton />;
    }
    if (pathname === '/domestik') {
      return (
        <ModePlaceholderPage
          onReturnToB3={() => setMode('limbah_b3')}
        />
      );
    }
    if (pathname === '/b3/dashboard') {
      return <DashboardView />;
    }
    if (pathname === '/b3/accounting/records') {
      return <AccountingPage view="records" worker={worker} />;
    }
    if (pathname === '/b3/accounting/statements') {
      return <FinancialStatementsPage />;
    }
    if (pathname === '/b3/accounting/coa') {
      return <AccountingPage view="coa" worker={worker} />;
    }
    const entity = ROUTE_TO_ENTITY[pathname];
    if (entity) {
      return <EntityPage entity={entity} worker={worker} />;
    }
    return <DashboardSkeleton />;
  };

  return (
    <div className="min-h-screen flex bg-[#F5F8F9] text-slate-900">
      <Sidebar
        worker={worker}
        mode={mode}
        onModeChange={setMode}
        mobileOpen={mobileSidebarOpen}
        onCloseMobile={() => setMobileSidebarOpen(false)}
      />

      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top Context Bar */}
        <header className="h-16 bg-white border-b border-slate-200 px-4 sm:px-8 flex items-center justify-between gap-4 sticky top-0 z-20">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileSidebarOpen(true)}
              aria-label="Open menu"
              className="lg:hidden p-1.5 text-slate-600 hover:text-slate-900 rounded-md"
            >
              <Menu className="w-5 h-5" />
            </button>
            <nav
              aria-label="Breadcrumb"
              className="flex items-center gap-2 text-xs text-slate-500 min-w-0 truncate"
            >
              {pageMeta.breadcrumb.map((part, idx) => (
                <React.Fragment key={part}>
                  {idx > 0 && <span aria-hidden="true">/</span>}
                  <span
                    className={
                      idx === pageMeta.breadcrumb.length - 1
                        ? 'text-slate-900 font-medium truncate'
                        : 'truncate'
                    }
                  >
                    {part}
                  </span>
                </React.Fragment>
              ))}
            </nav>
          </div>

          <div className="flex items-center gap-3 text-xs text-slate-500 shrink-0 whitespace-nowrap">
            <span className="font-mono text-slate-700">{worker.id}</span>
            <span aria-hidden="true">&middot;</span>
            <span className="capitalize">{worker.role}</span>
          </div>
        </header>

        {/* Page Viewport */}
        <main className="flex-1 p-4 sm:p-8 max-w-[1440px] w-full mx-auto space-y-6">
          <div>
            <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900">
              {pageMeta.title}
            </h1>
            {pageMeta.subtitle && (
              <p className="mt-1 text-sm text-slate-500">{pageMeta.subtitle}</p>
            )}
          </div>

          {renderMainContent()}
        </main>
      </div>

      {/* Stacked Slide-Over Layer Host */}
      {!isLocked && (
        <LayerHost
          worker={worker}
          onProfileUpdated={onProfileUpdated}
          onSignOut={onSignOut}
        />
      )}
    </div>
  );
}

function AppContent() {
  const { notifyError, notifySuccess } = useFeedback();
  const [worker, setWorker] = useState<WorkerRecord | null>(null);
  const [lockReason, setLockReason] = useState<AccountLockReason>(null);
  const [emailConfirmed, setEmailConfirmed] = useState(true);
  const [requiresReloginAfterUnlock, setRequiresReloginAfterUnlock] = useState(false);
  const [previewConfirmToken, setPreviewConfirmToken] = useState<string | undefined>(
    undefined
  );
  const [resendCooldownSeconds, setResendCooldownSeconds] = useState(0);
  const [recoveryPayload, setRecoveryPayload] =
    useState<PasswordRecoveryPayload | null>(null);
  const [signOutConfirmOpen, setSignOutConfirmOpen] = useState(false);
  const [bootLoading, setBootLoading] = useState(true);
  const [hasMaster, setHasMaster] = useState(false);
  const [authNotice, setAuthNotice] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    if (!signOutConfirmOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSignOutConfirmOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [signOutConfirmOpen]);

  useEffect(() => {
    let active = true;

    const init = async () => {
      try {
        const currentPath = window.location.pathname;
        const searchParams = new URLSearchParams(window.location.search);
        const hashRaw = window.location.hash.startsWith('#')
          ? window.location.hash.slice(1)
          : '';
        const hashParams = new URLSearchParams(hashRaw);

        const code = searchParams.get('code') || undefined;
        const tokenHash = searchParams.get('token_hash') || undefined;
        const type =
          searchParams.get('type') || hashParams.get('type') || undefined;
        const accessToken = hashParams.get('access_token') || undefined;
        const hashError =
          hashParams.get('error_description') ||
          searchParams.get('error_description');

        const isRecoveryRedirect =
          currentPath === '/auth/reset-password' || type === 'recovery';

        if (hashError) {
          window.history.replaceState({}, '', '/');
          if (active) {
            setAuthError(hashError);
            notifyError(hashError);
          }
        } else if (isRecoveryRedirect && (code || tokenHash || accessToken)) {
          window.history.replaceState({}, '', '/');
          if (active) {
            setRecoveryPayload({ code, tokenHash, accessToken });
          }
        } else if (code || tokenHash || accessToken) {
          window.history.replaceState({}, '', '/');
          try {
            const confirmed = await api.confirmEmail({
              code,
              tokenHash,
              type,
              accessToken,
            });
            if (active) {
              if (confirmed.token && confirmed.worker) {
                setAuthToken(confirmed.token);
                setWorker(confirmed.worker);
                setEmailConfirmed(confirmed.emailConfirmed ?? true);
                setLockReason(
                  confirmed.lockReason ??
                    (confirmed.accountInactive ? 'account_inactive' : null)
                );
                setRequiresReloginAfterUnlock(false);
                setHasMaster(true);
                notifySuccess(
                  confirmed.accountInactive
                    ? 'Email confirmed. Account requires activation in Supabase.'
                    : 'Email confirmed. Welcome to LIMBAHIN.'
                );
                return;
              } else {
                const msg =
                  confirmed.message ||
                  'Email confirmed successfully. You can now sign in to LIMBAHIN Office.';
                setAuthNotice(msg);
                notifySuccess(msg);
              }
            }
          } catch (err) {
            if (active) {
              setAuthError(
                err instanceof Error
                  ? err.message
                  : 'Unable to confirm email link.'
              );
            }
          }
        }

        // Attempt to restore a Remember Me session from HttpOnly cookie
        if (!isRecoveryRedirect && !hashError) {
          try {
            const restored = await api.restoreSession();
            if (active && restored.authenticated && restored.token && restored.worker) {
              setAuthToken(restored.token);
              setWorker(restored.worker);
              setEmailConfirmed(restored.emailConfirmed ?? true);
              setLockReason(restored.lockReason ?? null);
              setRequiresReloginAfterUnlock(
                Boolean(restored.requiresReloginAfterUnlock)
              );
              setResendCooldownSeconds(restored.resendCooldownSeconds ?? 0);
              setHasMaster(true);
              return;
            }
          } catch {
            // Fall through to standard auth screen
          }
        }

        const status = await api.authStatus();
        if (active) {
          setHasMaster(status.hasMaster);
        }
      } catch {
        if (active) setHasMaster(false);
      } finally {
        if (active) setBootLoading(false);
      }
    };

    init();
    return () => {
      active = false;
    };
  }, [notifyError, notifySuccess]);

  const handleAuthenticated = (payload: AuthenticatedPayload) => {
    setAuthToken(payload.token);
    setWorker(payload.worker);
    setEmailConfirmed(payload.emailConfirmed);
    setLockReason(payload.lockReason);
    setRequiresReloginAfterUnlock(Boolean(payload.requiresReloginAfterUnlock));
    setPreviewConfirmToken(payload.previewConfirmToken);
    setResendCooldownSeconds(payload.resendCooldownSeconds ?? 0);
    setHasMaster(true);
    setAuthError(null);
    setAuthNotice(null);
  };

  const handleSessionUpdated = (update: {
    token?: string;
    worker: WorkerRecord;
    emailConfirmed: boolean;
    lockReason: AccountLockReason;
    requiresReloginAfterUnlock: boolean;
    previewConfirmToken?: string;
    resendCooldownSeconds?: number;
  }) => {
    if (update.token) {
      setAuthToken(update.token);
    }
    setWorker(update.worker);
    setEmailConfirmed(update.emailConfirmed);
    setLockReason(update.lockReason);
    setRequiresReloginAfterUnlock(update.requiresReloginAfterUnlock);
    if ('previewConfirmToken' in update) {
      setPreviewConfirmToken(update.previewConfirmToken);
    }
    if (typeof update.resendCooldownSeconds === 'number') {
      setResendCooldownSeconds(update.resendCooldownSeconds);
    }
  };

  const requestSignOut = () => {
    setSignOutConfirmOpen(true);
  };

  const confirmSignOut = () => {
    setSignOutConfirmOpen(false);
    api.logout().catch(() => {});
    setAuthToken(null);
    setWorker(null);
    setLockReason(null);
    setEmailConfirmed(true);
    setRequiresReloginAfterUnlock(false);
    setPreviewConfirmToken(undefined);
    setResendCooldownSeconds(0);
    notifySuccess('You have signed out of LIMBAHIN.');
  };

  if (bootLoading) {
    return (
      <div className="min-h-screen bg-[#F5F8F9] p-8 max-w-6xl mx-auto">
        <DashboardSkeleton />
      </div>
    );
  }

  if (!worker) {
    return (
      <AuthScreen
        hasMaster={hasMaster}
        initialNotice={authNotice}
        initialError={authError}
        initialRecovery={recoveryPayload}
        onClearRecovery={() => setRecoveryPayload(null)}
        onAuthenticated={handleAuthenticated}
      />
    );
  }

  const handleProfileUpdated = (res: AuthProfileUpdateResponse) => {
    setWorker(res.worker);
    if (res.requiresEmailConfirmation) {
      if (res.token) {
        setAuthToken(res.token);
      }
      setEmailConfirmed(false);
      setLockReason(res.lockReason ?? 'email_not_confirmed');
      setRequiresReloginAfterUnlock(Boolean(res.requiresReloginAfterUnlock));
      setResendCooldownSeconds(res.resendCooldownSeconds ?? 120);
      setPreviewConfirmToken(res.previewConfirmToken);
    }
  };

  const isLocked = lockReason !== null || requiresReloginAfterUnlock;

  return (
    <NavigationProvider>
      <WorkspaceShell
        worker={worker}
        isLocked={isLocked}
        onProfileUpdated={handleProfileUpdated}
        onSignOut={requestSignOut}
      />
      {isLocked && (
        <DashboardLockLayer
          worker={worker}
          lockReason={lockReason}
          emailConfirmed={emailConfirmed}
          requiresReloginAfterUnlock={requiresReloginAfterUnlock}
          previewConfirmToken={previewConfirmToken}
          initialResendCooldownSeconds={resendCooldownSeconds}
          onSessionUpdated={handleSessionUpdated}
          onSignOut={requestSignOut}
        />
      )}

      {/* Sign Out Confirmation Dialog */}
      {signOutConfirmOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Confirm sign out"
          className="fixed inset-0 z-[60] bg-slate-900/40 backdrop-blur-[2px] flex items-center justify-center p-4"
        >
          <div
            className="fixed inset-0"
            onClick={() => setSignOutConfirmOpen(false)}
            aria-hidden="true"
          />
          <div className="relative z-10 w-full max-w-sm bg-white border border-slate-200 rounded-xl shadow-xl p-6 space-y-5">
            <div className="flex items-start gap-3.5">
              <div className="w-10 h-10 rounded-lg bg-red-50 text-red-700 border border-red-200 flex items-center justify-center shrink-0">
                <LogOut className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h3 className="font-display text-base font-bold text-slate-900">
                  Sign out of LIMBAHIN?
                </h3>
                <p className="mt-1 text-xs text-slate-600 leading-relaxed">
                  You are currently signed in as{' '}
                  <span className="font-medium text-slate-900">
                    @{worker.username}
                  </span>{' '}
                  (<span className="font-mono">{worker.id}</span>). You will need
                  to sign in again to continue.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setSignOutConfirmOpen(false)}
                className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmSignOut}
                className="px-4 py-2 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors whitespace-nowrap"
              >
                Yes, Sign Out
              </button>
            </div>
          </div>
        </div>
      )}
    </NavigationProvider>
  );
}

export default function App() {
  return (
    <FeedbackProvider>
      <AppContent />
    </FeedbackProvider>
  );
}
