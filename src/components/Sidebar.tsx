import React, { useEffect, useState } from 'react';
import {
  Award,
  BookOpen,
  Building2,
  Calendar,
  Check,
  ChevronRight,
  ChevronsUpDown,
  ClipboardCheck,
  Database,
  FileBarChart2,
  FileSpreadsheet,
  FileText,
  History,
  Inbox,
  Landmark,
  Layers,
  LayoutDashboard,
  Package,
  Receipt,
  TrendingUp,
  UserCog,
  Users,
  X,
} from 'lucide-react';
import { useNavigation } from '../lib/navigation.tsx';
import { canAccessRoute } from '../shared/entityMeta.ts';
import type { OperationalMode, WorkerRecord } from '../shared/types.ts';
import { SafeImage } from './SafeImage.tsx';

interface SidebarProps {
  worker: WorkerRecord;
  mode: OperationalMode;
  onModeChange: (mode: OperationalMode) => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

interface NavItem {
  label: string;
  path: string;
  icon: React.ComponentType<{ className?: string }>;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

const B3_NAV_GROUPS: NavGroup[] = [
  {
    title: 'Overview',
    items: [
      { label: 'Dashboard', path: '/b3/dashboard', icon: LayoutDashboard },
      { label: 'Audit Logs', path: '/b3/logs', icon: History },
    ],
  },
  {
    title: 'Master Data',
    items: [
      { label: 'Worker', path: '/b3/workers', icon: UserCog },
      { label: 'Client', path: '/b3/clients', icon: Users },
      { label: 'Branch', path: '/b3/branches', icon: Building2 },
      { label: 'Marketing', path: '/b3/marketing', icon: TrendingUp },
      { label: 'Item', path: '/b3/items', icon: Package },
    ],
  },
  {
    title: 'Operational',
    items: [
      { label: 'Schedule', path: '/b3/operational/schedule', icon: Calendar },
      { label: 'Limbah Data', path: '/b3/operational/data', icon: Database },
      { label: 'Requests', path: '/b3/requests', icon: Inbox },
    ],
  },
  {
    title: 'Document',
    items: [
      { label: 'Purchase Order', path: '/b3/documents/purchase-order', icon: FileSpreadsheet },
      { label: 'BA', path: '/b3/documents/ba', icon: ClipboardCheck },
      { label: 'Invoice', path: '/b3/documents/invoice', icon: Receipt },
      { label: 'Certificate', path: '/b3/documents/certificate', icon: Award },
      { label: 'FPL Real', path: '/b3/documents/fpl-real', icon: FileText },
      { label: 'FPL Doc', path: '/b3/documents/fpl-doc', icon: FileText },
    ],
  },
  {
    title: 'Accounting',
    items: [
      { label: 'Ledger & Journal', path: '/b3/accounting/records', icon: BookOpen },
      { label: 'Financial Statements', path: '/b3/accounting/statements', icon: FileBarChart2 },
      { label: 'Chart of Accounts', path: '/b3/accounting/coa', icon: Landmark },
    ],
  },
];

const MODES: Array<{
  id: OperationalMode;
  label: string;
  description: string;
  statusNote: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  {
    id: 'limbah_b3',
    label: 'Limbah B3',
    description: 'Hazardous waste manifests, pickup schedules, PO, BA, invoices, and compliance certificates.',
    statusNote: 'Active',
    icon: FileText,
  },
  {
    id: 'domestik',
    label: 'Limbah Domestik',
    description: 'Non-hazardous commercial and municipal waste collection routes and tonnage billing.',
    statusNote: 'Coming Soon',
    icon: Layers,
  },
];

export function Sidebar({
  worker,
  mode,
  onModeChange,
  mobileOpen,
  onCloseMobile,
}: SidebarProps) {
  const { pathname, navigatePage, openLayer, confirmNavigationIfDirty } =
    useNavigation();
  const [modePickerOpen, setModePickerOpen] = useState(false);

  const canSwitchModes = worker.role === 'master' || worker.role === 'admin';
  const activeModeMeta = MODES.find((m) => m.id === mode) || MODES[0];
  const ActiveModeIcon = activeModeMeta.icon;

  useEffect(() => {
    if (!modePickerOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setModePickerOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [modePickerOpen]);

  const handleNavClick = (path: string) => {
    navigatePage(path);
    onCloseMobile();
  };

  const handleSelectMode = (target: OperationalMode) => {
    setModePickerOpen(false);
    confirmNavigationIfDirty(() => {
      onModeChange(target);
      if (target === 'domestik') {
        navigatePage('/domestik');
      } else {
        navigatePage(worker.role === 'master' ? '/b3/dashboard' : '/b3/clients');
      }
      onCloseMobile();
    });
  };

  const visibleGroups = B3_NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => canAccessRoute(worker.role, item.path)),
  })).filter((group) => group.items.length > 0);

  const initials = worker.name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase();

  const content = (
    <div className="flex flex-col h-full bg-white border-r border-slate-200 w-[264px]">
      {/* Brand Header */}
      <div className="h-16 px-5 border-b border-slate-200 flex items-center justify-between shrink-0">
        <button
          type="button"
          onClick={() =>
            handleNavClick(
              worker.role === 'master'
                ? '/b3/dashboard'
                : worker.role === 'marketing'
                  ? '/b3/marketing'
                  : worker.role === 'worker'
                    ? '/b3/operational/data'
                    : '/b3/clients'
            )
          }
          className="flex items-center gap-2.5 text-left"
        >
          <img
            src="/assets/aistudio/Logo_b14b4906.jpg"
            alt="LIMBAHIN logo"
            referrerPolicy="no-referrer"
            className="w-8 h-8 object-contain shrink-0"
          />
          <span className="font-display text-lg font-extrabold tracking-wide text-[#2B8FA3] whitespace-nowrap">
            LIMBAHIN
          </span>
        </button>

        <button
          type="button"
          onClick={onCloseMobile}
          aria-label="Close navigation"
          className="lg:hidden p-1.5 text-slate-500 hover:text-slate-800 rounded-md"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Single Mode Selector Trigger Button -> Opens Translucent Mode Layer */}
      {canSwitchModes && (
        <div className="px-4 pt-4 pb-3 border-b border-slate-100">
          <p className="text-[11px] font-medium text-slate-500 mb-2 px-1">
            Business Unit Mode
          </p>
          <button
            type="button"
            onClick={() => setModePickerOpen(true)}
            className="w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium transition-colors"
          >
            <span className="flex items-center gap-2.5 min-w-0">
              <ActiveModeIcon className="w-4 h-4 shrink-0 text-teal-100" />
              <span className="truncate">{activeModeMeta.label}</span>
            </span>
            <ChevronsUpDown className="w-4 h-4 shrink-0 text-teal-100" />
          </button>
        </div>
      )}

      {/* Navigation Tree */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
        {mode === 'limbah_b3' ? (
          visibleGroups.map((group) => (
            <div key={group.title}>
              <p className="px-3 mb-1.5 text-xs font-medium text-slate-400">
                {group.title}
              </p>
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const active = pathname === item.path;
                  return (
                    <button
                      key={item.path}
                      type="button"
                      onClick={() => handleNavClick(item.path)}
                      className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors whitespace-nowrap ${
                        active
                          ? 'bg-[#EAF5F5] text-teal-800 font-semibold'
                          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                      }`}
                    >
                      <Icon
                        className={`w-4 h-4 shrink-0 ${
                          active ? 'text-teal-700' : 'text-slate-400'
                        }`}
                      />
                      <span className="truncate">{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))
        ) : (
          <div className="px-3 py-2 text-xs text-slate-500 leading-relaxed">
            Switch back to{' '}
            <button
              type="button"
              onClick={() => handleSelectMode('limbah_b3')}
              className="text-teal-700 font-medium hover:underline"
            >
              Limbah B3
            </button>{' '}
            to manage active office operations and documents.
          </div>
        )}
      </nav>

      {/* Worker Profile Footer (Opens Profile Layer without changing path) */}
      <div className="p-3 border-t border-slate-200 shrink-0">
        <button
          type="button"
          onClick={() => {
            openLayer({ kind: 'profile' });
            onCloseMobile();
          }}
          className="w-full flex items-center gap-3 px-2.5 py-2 rounded-lg hover:bg-slate-100 transition-colors text-left"
        >
          <SafeImage
            src={worker.display_picture_url}
            alt={worker.name}
            className="w-9 h-9 rounded-lg object-cover shrink-0 border border-slate-200"
            fallback={
              <div className="w-9 h-9 rounded-lg bg-[#EAF5F5] text-teal-800 font-display font-semibold text-xs flex items-center justify-center shrink-0">
                {initials}
              </div>
            }
          />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-slate-900 truncate">
              {worker.name}
            </p>
            <p className="text-xs text-slate-500 font-mono truncate">
              {worker.id} &middot; {worker.role}
            </p>
          </div>
          <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
        </button>
      </div>
    </div>
  );

  return (
    <>
      <aside className="hidden lg:block shrink-0 h-screen sticky top-0">
        {content}
      </aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-900/35"
            onClick={onCloseMobile}
            aria-hidden="true"
          />
          <div className="relative z-10 h-full">{content}</div>
        </div>
      )}

      {/* Translucent Business Unit Mode Selector Layer */}
      {modePickerOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Select business unit mode"
          className="fixed inset-0 z-50 bg-slate-900/35 backdrop-blur-[3px] flex items-center justify-center p-4"
        >
          <div
            className="fixed inset-0"
            onClick={() => setModePickerOpen(false)}
            aria-hidden="true"
          />
          <div className="relative z-10 w-full max-w-md bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-base font-bold text-slate-900">
                  Select Business Unit Mode
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Switch between LIMBAHIN operational modules.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setModePickerOpen(false)}
                aria-label="Close mode selector"
                className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-md transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 space-y-2.5">
              {MODES.map((item) => {
                const Icon = item.icon;
                const selected = mode === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleSelectMode(item.id)}
                    className={`w-full text-left p-4 rounded-xl border transition-colors flex items-start gap-3.5 ${
                      selected
                        ? 'bg-[#EFF8F8] border-teal-600'
                        : 'bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50/70'
                    }`}
                  >
                    <div
                      className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
                        selected
                          ? 'bg-teal-700 text-white'
                          : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      <Icon className="w-5 h-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-display text-sm font-bold text-slate-900">
                          {item.label}
                        </span>
                        <span
                          className={`text-[11px] font-medium ${
                            item.id === 'limbah_b3'
                              ? 'text-teal-700'
                              : 'text-slate-500'
                          }`}
                        >
                          {item.statusNote}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-slate-600 leading-relaxed">
                        {item.description}
                      </p>
                    </div>
                    {selected && (
                      <Check className="w-4 h-4 text-teal-700 shrink-0 mt-0.5" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
