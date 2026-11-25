import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  LayoutList,
  Plus,
  RotateCcw,
  Search,
  Table2,
  Upload,
} from 'lucide-react';
import {
  api,
  formatIDR,
  formatStatusLabel,
  formatWeight,
  statusTextClass,
} from '../lib/api.ts';
import { useNavigation } from '../lib/navigation.tsx';
import {
  ENTITY_META,
  canMutateEntity,
  formatDatePeriodLabel,
  type FieldDef,
} from '../shared/entityMeta.ts';
import type {
  AnyEntityRecord,
  CustomerRecord,
  EntityKey,
  LogChangeEntry,
  WorkerRecord,
} from '../shared/types.ts';
import { MasterSheetView } from './MasterSheetView.tsx';
import { SafeImage } from './SafeImage.tsx';
import { SearchableSelectField } from './SearchableSelectField.tsx';
import { TableSkeleton } from './Skeleton.tsx';

interface EntityPageProps {
  entity: EntityKey;
  worker: WorkerRecord;
  tabs?: Array<{ entity: EntityKey; label: string }>;
  onTabChange?: (entity: EntityKey) => void;
}

type SortDirection = 'asc' | 'desc';

const MODEL_LABEL_MAP: Record<string, string> = {
  workers: 'Workers (MCC)',
  customers: 'Clients (CUST)',
  branches: 'Branches (BRC)',
  items: 'Waste Items (ITM)',
  schedules: 'Schedules (LMBHN-SCHD-ITEM)',
  pickup_data: 'Limbah Data (DATA)',
  purchase_orders: 'Purchase Orders (PO)',
  berita_acara: 'Berita Acara (LMBHN-BA)',
  invoices: 'Invoices (INV)',
  certificates: 'Certificates (LMBHN-CERT)',
  fpl_real: 'FPL Real (LMBHN-FPLREAL)',
  fpl_doc: 'FPL Doc (LMBHN-FPLDOC)',
  commissions: 'Commissions (COM)',
  companies: 'Companies',
  chart_of_accounts: 'Chart of Accounts (COA)',
  rcrd: 'Ledger Records (RCRD)',
};

export function EntityPage({
  entity,
  worker,
  tabs,
  onTabChange,
}: EntityPageProps) {
  const { openLayer, dataVersion, confirmNavigationIfDirty } = useNavigation();
  const meta = ENTITY_META[entity];
  const canUseSheetView = worker.role === 'master' && entity !== 'logs';

  const [viewMode, setViewMode] = useState<'list' | 'sheet'>('list');
  const [records, setRecords] = useState<AnyEntityRecord[]>([]);
  const [workerLookup, setWorkerLookup] = useState<Record<string, WorkerRecord>>({});
  const [clientLookup, setClientLookup] = useState<Record<string, CustomerRecord>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Universal search, filter & sort state (works across all models)
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [roleFilter, setRoleFilter] = useState('all');
  const [hazardFilter, setHazardFilter] = useState('all');
  const [dataTypeFilter, setDataTypeFilter] = useState('all');
  const [periodFilter, setPeriodFilter] = useState('all');
  const [clientFilter, setClientFilter] = useState('all');
  const [logModelFilter, setLogModelFilter] = useState('all');
  const [logActorFilter, setLogActorFilter] = useState('all');
  const [logActionFilter, setLogActionFilter] = useState('all');
  const [excludeClientsLogs, setExcludeClientsLogs] = useState(false);
  const [excludeWorkersLogs, setExcludeWorkersLogs] = useState(false);
  const [sortKey, setSortKey] = useState<string>('created_at');
  const [sortDir, setSortDir] = useState<SortDirection>('desc');

  // Reset filters when switching entity page
  useEffect(() => {
    setSearch('');
    setStatusFilter('all');
    setRoleFilter('all');
    setHazardFilter('all');
    setDataTypeFilter('all');
    setPeriodFilter('all');
    setClientFilter('all');
    setLogModelFilter('all');
    setLogActorFilter('all');
    setLogActionFilter('all');
    setExcludeClientsLogs(false);
    setExcludeWorkersLogs(false);
    setSortKey(entity === 'logs' ? 'timestamp_created_at' : 'created_at');
    setSortDir('desc');
    setViewMode('list');
  }, [entity]);

  // Fetch main records + worker/client lookup maps for cross-reference search & filtering
  const needsWorkerLookup = useMemo(
    () =>
      entity === 'logs' ||
      meta.fields.some((f) => f.refEntity === 'workers'),
    [entity, meta.fields]
  );

  const needsClientLookup = useMemo(
    () =>
      entity === 'logs' ||
      meta.fields.some((f) => f.refEntity === 'customers'),
    [entity, meta.fields]
  );

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    const loadAll = async () => {
      try {
        const [mainRes, workersRes, clientsRes] = await Promise.all([
          api.listRecords(entity),
          needsWorkerLookup
            ? api
                .listRecords<WorkerRecord>('workers', { lookup: true })
                .catch(() => ({ records: [] as WorkerRecord[] }))
            : Promise.resolve({ records: [] as WorkerRecord[] }),
          needsClientLookup
            ? api
                .listRecords<CustomerRecord>('customers', { lookup: true })
                .catch(() => ({ records: [] as CustomerRecord[] }))
            : Promise.resolve({ records: [] as CustomerRecord[] }),
        ]);

        if (!active) return;
        setRecords(mainRes.records);

        const wMap: Record<string, WorkerRecord> = {};
        for (const w of workersRes.records) {
          wMap[w.id] = w;
        }
        setWorkerLookup(wMap);

        const cMap: Record<string, CustomerRecord> = {};
        for (const c of clientsRes.records) {
          cMap[c.id] = c;
        }
        setClientLookup(cMap);
      } catch (err) {
        if (active) {
          setError(
            err instanceof Error ? err.message : `Failed to load ${meta.plural}.`
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    };

    loadAll();
    return () => {
      active = false;
    };
  }, [entity, dataVersion, meta.plural, needsWorkerLookup, needsClientLookup]);

  const tableFields = useMemo(
    () => meta.fields.filter((f) => f.showInTable),
    [meta.fields]
  );

  const statusOptions = useMemo(() => {
    if (!meta.statusField) return [];
    const field = meta.fields.find((f) => f.key === meta.statusField);
    return field?.options ?? [];
  }, [meta]);

  const roleOptions = useMemo(() => {
    if (entity !== 'workers') return [];
    return meta.fields.find((f) => f.key === 'role')?.options ?? [];
  }, [entity, meta.fields]);

  const hazardOptions = useMemo(() => {
    if (entity !== 'items') return [];
    return meta.fields.find((f) => f.key === 'hazard_category')?.options ?? [];
  }, [entity, meta.fields]);

  const dataTypeOptions = useMemo(() => {
    if (entity !== 'pickup_data') return [];
    return meta.fields.find((f) => f.key === 'data_type')?.options ?? [];
  }, [entity, meta.fields]);

  const hasDatePeriodField = useMemo(
    () => meta.fields.some((f) => f.key === 'date_period'),
    [meta.fields]
  );

  const periodOptions = useMemo(() => {
    if (!hasDatePeriodField) return [];
    const seen = new Map<string, string>();
    for (const rec of records) {
      const obj = rec as unknown as Record<string, unknown>;
      const raw = String(obj.date_period || '').trim();
      if (/^\d{4}-\d{2}/.test(raw)) {
        const ym = raw.slice(0, 7);
        if (!seen.has(ym)) {
          seen.set(ym, formatDatePeriodLabel(`${ym}-01`) || ym);
        }
      }
    }
    return Array.from(seen.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([value, label]) => ({ value, label }));
  }, [hasDatePeriodField, records]);

  const clientRefFieldKey = useMemo(() => {
    const f = meta.fields.find(
      (field) =>
        (field.key === 'id_user_model' || field.key === 'client_id') &&
        field.refEntity === 'customers'
    );
    return f?.key ?? null;
  }, [meta.fields]);

  const hasClientIdField = Boolean(clientRefFieldKey);

  const sortedWorkerOptions = useMemo(
    () =>
      Object.values(workerLookup).sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
      ),
    [workerLookup]
  );

  const sortedClientOptions = useMemo(
    () =>
      Object.values(clientLookup).sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
      ),
    [clientLookup]
  );

  const sortableFields = useMemo(() => {
    const items: Array<{ key: string; label: string }> = [
      {
        key: entity === 'logs' ? 'timestamp_created_at' : 'created_at',
        label: entity === 'logs' ? 'Timestamp' : 'Created Date',
      },
      { key: 'id', label: 'ID' },
    ];
    for (const f of tableFields) {
      if (f.type === 'json' || f.type === 'ref-list' || f.type === 'url-list') continue;
      if (items.some((i) => i.key === f.key)) continue;
      items.push({ key: f.key, label: f.label });
    }
    return items;
  }, [entity, tableFields]);

  const handleHeaderSort = (key: string) => {
    if (sortKey === key) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(
        key === 'created_at' || key === 'timestamp_created_at' ? 'desc' : 'asc'
      );
    }
  };

  const hasActiveFilters =
    Boolean(search.trim()) ||
    statusFilter !== 'all' ||
    roleFilter !== 'all' ||
    hazardFilter !== 'all' ||
    dataTypeFilter !== 'all' ||
    periodFilter !== 'all' ||
    clientFilter !== 'all' ||
    logModelFilter !== 'all' ||
    logActorFilter !== 'all' ||
    logActionFilter !== 'all' ||
    excludeClientsLogs ||
    excludeWorkersLogs ||
    sortKey !== (entity === 'logs' ? 'timestamp_created_at' : 'created_at') ||
    sortDir !== 'desc';

  const clearAllFilters = () => {
    setSearch('');
    setStatusFilter('all');
    setRoleFilter('all');
    setHazardFilter('all');
    setDataTypeFilter('all');
    setPeriodFilter('all');
    setClientFilter('all');
    setLogModelFilter('all');
    setLogActorFilter('all');
    setLogActionFilter('all');
    setExcludeClientsLogs(false);
    setExcludeWorkersLogs(false);
    setSortKey(entity === 'logs' ? 'timestamp_created_at' : 'created_at');
    setSortDir('desc');
  };

  const filteredAndSortedRecords = useMemo(() => {
    const q = search.trim().toLowerCase();

    const filtered = records.filter((rec) => {
      const obj = rec as unknown as Record<string, unknown>;

      // Status filter (all models with statusField)
      if (meta.statusField && statusFilter !== 'all') {
        if (String(obj[meta.statusField] ?? '') !== statusFilter) return false;
      }

      // Workers role filter
      if (entity === 'workers' && roleFilter !== 'all') {
        if (String(obj.role ?? '') !== roleFilter) return false;
      }

      // Items hazard filter
      if (entity === 'items' && hazardFilter !== 'all') {
        if (String(obj.hazard_category ?? '') !== hazardFilter) return false;
      }

      // Limbah Data type filter
      if (entity === 'pickup_data' && dataTypeFilter !== 'all') {
        if (String(obj.data_type ?? 'pickup') !== dataTypeFilter) return false;
      }

      // Date Period (Month-Year) filter
      if (hasDatePeriodField && periodFilter !== 'all') {
        const dp = String(obj.date_period ?? '').trim();
        if (!dp.startsWith(periodFilter)) return false;
      }

      // Client filter for client-linked entities (client_id or id_user_model)
      if (clientRefFieldKey && clientFilter !== 'all') {
        const rowCid = String(
          obj[clientRefFieldKey] ?? obj.id_user_model ?? obj.client_id ?? ''
        );
        if (rowCid !== clientFilter) return false;
      }

      // Audit Logs filters (model exclusion, specific model, changed-by user, action)
      if (entity === 'logs') {
        const modelName = String(obj.model_name ?? '').toLowerCase();
        if (excludeClientsLogs && modelName === 'customers') return false;
        if (excludeWorkersLogs && modelName === 'workers') return false;
        if (logModelFilter === 'exclude_clients_workers') {
          if (modelName === 'customers' || modelName === 'workers') return false;
        } else if (logModelFilter !== 'all' && modelName !== logModelFilter) {
          return false;
        }
        if (logActorFilter !== 'all') {
          if (String(obj.id_changed_by ?? '') !== logActorFilter) return false;
        }
        if (logActionFilter !== 'all') {
          const entries = Array.isArray(obj.changes_json)
            ? (obj.changes_json as LogChangeEntry[])
            : [];
          const hasAction = entries.some((entry) => entry?.action === logActionFilter);
          if (!hasAction) return false;
        }
      }

      if (!q) return true;

      // Build comprehensive searchable tokens: all scalar/nested fields + linked worker username/name/ID + linked client name/ID
      const searchableParts: string[] = [];

      for (const [k, val] of Object.entries(obj)) {
        if (val == null) continue;
        if (k === 'changes_json' && Array.isArray(val)) {
          for (const entry of val as LogChangeEntry[]) {
            if (!entry) continue;
            if (entry.record_id) {
              searchableParts.push(entry.record_id);
              const linkedW = workerLookup[entry.record_id];
              if (linkedW) {
                searchableParts.push(linkedW.name, linkedW.username, linkedW.email || '');
              }
              const linkedC = clientLookup[entry.record_id];
              if (linkedC) {
                searchableParts.push(linkedC.name, linkedC.pic_name || '');
              }
            }
            if (entry.action) searchableParts.push(entry.action);
            if (entry.changes && typeof entry.changes === 'object') {
              for (const [fieldKey, diff] of Object.entries(entry.changes)) {
                searchableParts.push(fieldKey);
                if (diff && typeof diff === 'object') {
                  if (diff.old !== undefined && diff.old !== null) {
                    searchableParts.push(String(diff.old));
                  }
                  if (diff.new !== undefined && diff.new !== null) {
                    searchableParts.push(String(diff.new));
                  }
                }
              }
            }
          }
        } else if (Array.isArray(val)) {
          searchableParts.push(...val.map((item) => String(item)));
        } else {
          const strVal = String(val);
          searchableParts.push(strVal);

          // Enrich worker references with name & username so searching username/name/ID works everywhere
          if (
            k === 'id_changed_by' ||
            k === 'marketing_id' ||
            k === 'assigned_worker_id' ||
            k === 'worker_id' ||
            k === 'id_user_comission' ||
            k === 'created_by'
          ) {
            const w = workerLookup[strVal];
            if (w) {
              searchableParts.push(w.name, w.username, w.email || '');
            }
          }
          // Enrich client references with company name
          if (k === 'client_id' || k === 'id_user_model') {
            const c = clientLookup[strVal];
            if (c) {
              searchableParts.push(c.name, c.pic_name || '');
            }
          }
          // Enrich date_period with human-readable Month Year (e.g. "Jun 2027")
          if (k === 'date_period') {
            const periodText = formatDatePeriodLabel(strVal);
            if (periodText) searchableParts.push(periodText);
          }
        }
      }

      return searchableParts.some((part) => part.toLowerCase().includes(q));
    });

    const getSortVal = (rec: AnyEntityRecord): string | number => {
      const obj = rec as unknown as Record<string, unknown>;
      const raw = obj[sortKey];
      if (raw === null || raw === undefined || raw === '') return '';

      const fieldDef = meta.fields.find((f) => f.key === sortKey);
      if (fieldDef?.type === 'number' || fieldDef?.type === 'currency') {
        const num = Number(raw);
        return Number.isFinite(num) ? num : 0;
      }
      if (sortKey === 'created_at' || sortKey === 'timestamp_created_at') {
        const ms = Date.parse(String(raw));
        return Number.isFinite(ms) ? ms : String(raw);
      }
      if (sortKey === 'id_changed_by') {
        const w = workerLookup[String(raw)];
        return w ? `${w.name} ${w.username}`.toLowerCase() : String(raw).toLowerCase();
      }
      if (sortKey === 'client_id' || sortKey === 'id_user_model') {
        const c = clientLookup[String(raw)];
        return c ? c.name.toLowerCase() : String(raw).toLowerCase();
      }
      return String(raw).toLowerCase();
    };

    const sorted = [...filtered].sort((a, b) => {
      const va = getSortVal(a);
      const vb = getSortVal(b);
      let cmp = 0;
      if (typeof va === 'number' && typeof vb === 'number') {
        cmp = va - vb;
      } else {
        cmp = String(va).localeCompare(String(vb), undefined, {
          numeric: true,
          sensitivity: 'base',
        });
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });

    return sorted;
  }, [
    records,
    search,
    meta.statusField,
    meta.fields,
    statusFilter,
    entity,
    roleFilter,
    hazardFilter,
    dataTypeFilter,
    hasDatePeriodField,
    periodFilter,
    clientRefFieldKey,
    clientFilter,
    excludeClientsLogs,
    excludeWorkersLogs,
    logModelFilter,
    logActorFilter,
    logActionFilter,
    workerLookup,
    clientLookup,
    sortKey,
    sortDir,
  ]);

  const canWrite = canMutateEntity(worker.role, entity);

  const roleScopeNote = useMemo(() => {
    if (worker.role === 'admin') {
      return 'Showing records created by your admin account.';
    }
    if (worker.role === 'marketing') {
      if (entity === 'customers' || entity === 'branches') {
        return 'Scoped to clients and branches assigned to your marketing profile.';
      }
      if (entity === 'invoices') {
        return 'Scoped to unpaid invoices for your assigned clients.';
      }
      if (entity === 'schedules') {
        return 'Scoped to pickup schedules for your assigned clients.';
      }
      if (entity === 'commissions') {
        return 'Scoped to commissions assigned to your marketing profile.';
      }
    }
    if (worker.role === 'worker') {
      return 'Field worker workspace: log, update, and manage pickup records.';
    }
    return null;
  }, [worker.role, entity]);

  const renderSortIcon = (key: string) => {
    if (sortKey !== key) {
      return <ArrowUpDown className="w-3 h-3 text-slate-300 shrink-0" />;
    }
    return sortDir === 'asc' ? (
      <ArrowUp className="w-3 h-3 text-teal-700 shrink-0" />
    ) : (
      <ArrowDown className="w-3 h-3 text-teal-700 shrink-0" />
    );
  };

  const renderCell = (field: FieldDef, rec: AnyEntityRecord) => {
    const obj = rec as unknown as Record<string, unknown>;
    const val = obj[field.key];

    if (val === null || val === undefined || val === '') {
      return <span className="text-slate-400">—</span>;
    }

    if (field.type === 'ref' && field.refEntity) {
      const refId = String(val);
      const linkedWorker =
        field.refEntity === 'workers' ? workerLookup[refId] : undefined;
      const linkedClient =
        field.refEntity === 'customers' ? clientLookup[refId] : undefined;
      return (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            openLayer({
              kind: 'inspect',
              entity: field.refEntity!,
              recordId: refId,
            });
          }}
          className="inline-flex items-center gap-1.5 text-left group"
        >
          <span className="font-mono text-xs text-teal-700 group-hover:underline font-medium">
            {refId}
          </span>
          {linkedWorker && (
            <span className="text-xs text-slate-500 font-normal">
              {linkedWorker.name} (@{linkedWorker.username})
            </span>
          )}
          {linkedClient && (
            <span className="text-xs text-slate-500 font-normal">
              {linkedClient.name}
            </span>
          )}
        </button>
      );
    }

    if (field.type === 'ref-list' && field.refEntity) {
      const list = Array.isArray(val) ? val.map(String) : [];
      if (list.length === 0) return <span className="text-slate-400">—</span>;
      return (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-xs">
          {list.map((refId, idx) => (
            <React.Fragment key={refId}>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  openLayer({
                    kind: 'inspect',
                    entity: field.refEntity!,
                    recordId: refId,
                  });
                }}
                className="text-teal-700 hover:underline font-medium"
              >
                {refId}
              </button>
              {idx < list.length - 1 && (
                <span className="text-slate-300" aria-hidden="true">
                  &middot;
                </span>
              )}
            </React.Fragment>
          ))}
        </div>
      );
    }

    if (field.type === 'currency') {
      return (
        <span className="font-mono text-xs tabular-nums text-slate-900">
          {formatIDR(Number(val))}
        </span>
      );
    }

    if (field.type === 'number') {
      const isWeight = field.key.includes('weight');
      return (
        <span className="font-mono text-xs tabular-nums text-slate-900">
          {isWeight
            ? formatWeight(Number(val))
            : field.key.includes('rate')
              ? `${val}%`
              : Number(val).toLocaleString('id-ID')}
        </span>
      );
    }

    if (field.type === 'url-list') {
      const urls = Array.isArray(val) ? val.map(String).filter(Boolean) : [];
      if (urls.length === 0) return <span className="text-slate-400">—</span>;
      return (
        <div className="inline-flex items-center gap-2">
          <SafeImage
            src={urls[0]}
            alt="Preview"
            className="w-7 h-7 rounded object-cover border border-slate-200 bg-slate-50 shrink-0"
            fallback={
              <span className="w-7 h-7 rounded bg-slate-100 border border-slate-200 inline-flex items-center justify-center text-[10px] font-mono text-slate-500">
                IMG
              </span>
            }
          />
          <span className="font-mono text-xs text-slate-600 tabular-nums">
            {urls.length} {urls.length === 1 ? 'img' : 'imgs'}
          </span>
        </div>
      );
    }

    if (field.type === 'date') {
      const dateStr = String(val);
      if (field.key === 'date_period') {
        const period = formatDatePeriodLabel(dateStr);
        return (
          <span className="font-mono text-xs tabular-nums text-slate-700">
            {dateStr}
            {period && (
              <span className="ml-1.5 font-sans text-teal-700 font-medium">
                &middot; {period}
              </span>
            )}
          </span>
        );
      }
      return (
        <span className="font-mono text-xs tabular-nums text-slate-600">
          {dateStr}
        </span>
      );
    }

    if (field.key === 'status') {
      return (
        <span className={`text-xs ${statusTextClass(String(val))}`}>
          {formatStatusLabel(String(val))}
        </span>
      );
    }

    if (field.key === 'data_type') {
      const t = String(val);
      return (
        <span
          className={`text-xs font-medium capitalize ${
            t === 'pickup' ? 'text-teal-700' : 'text-slate-700'
          }`}
        >
          {t}
        </span>
      );
    }

    if (field.key === 'role') {
      return (
        <span className="text-xs font-medium text-slate-700 capitalize">
          {String(val)}
        </span>
      );
    }

    if (field.key === 'model_name') {
      const rawModel = String(val);
      return (
        <span className="font-mono text-xs font-medium text-slate-700">
          {MODEL_LABEL_MAP[rawModel] || rawModel}
        </span>
      );
    }

    if (field.key === 'timestamp_created_at') {
      const dt = new Date(String(val));
      const formatted = Number.isNaN(dt.getTime())
        ? String(val)
        : dt.toLocaleString('en-GB', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          });
      return (
        <span className="font-mono text-xs tabular-nums text-slate-600">
          {formatted}
        </span>
      );
    }

    if (field.type === 'json') {
      const entries = Array.isArray(val) ? (val as LogChangeEntry[]) : [];
      const count = entries.length;
      const firstAction =
        count > 0 && typeof entries[0]?.action === 'string'
          ? entries[0].action
          : 'change';
      const firstRecordId = count > 0 ? entries[0]?.record_id : '';
      return (
        <span className="text-xs text-slate-700 tabular-nums">
          <span className="font-medium text-teal-800">{count}</span>{' '}
          {count === 1 ? 'record' : 'records'} &middot;{' '}
          <span className="capitalize text-slate-500">{firstAction}</span>
          {count === 1 && firstRecordId && (
            <span className="ml-1.5 font-mono text-[11px] text-slate-400">
              ({firstRecordId})
            </span>
          )}
        </span>
      );
    }

    return <span className="text-sm text-slate-800">{String(val)}</span>;
  };

  return (
    <div className="space-y-4">
      {/* Optional Segmented Tabs */}
      {tabs && tabs.length > 1 && onTabChange && (
        <div className="inline-flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg">
          {tabs.map((tab) => {
            const active = tab.entity === entity;
            return (
              <button
                key={tab.entity}
                type="button"
                onClick={() => confirmNavigationIfDirty(() => onTabChange(tab.entity))}
                className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      )}

      {/* Primary Toolbar: Search, Sort & Actions */}
      <div className="bg-white border border-slate-200 rounded-xl p-3.5 space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5 flex-1">
            {/* Search by ID, name, username, or linked reference */}
            <div className="relative flex-1 min-w-[220px] max-w-md">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={
                  entity === 'logs'
                    ? 'Search username, name, record ID, or field...'
                    : `Search ${meta.plural.toLowerCase()} by name, username, or ID...`
                }
                className="w-full pl-9 pr-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:bg-white focus:ring-2 focus:ring-teal-600/25 focus:border-teal-700"
              />
            </div>

            {/* Universal Sort Controls */}
            <div className="flex items-center gap-1.5">
              <select
                aria-label="Sort by field"
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value)}
                className="px-2.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600/25 focus:border-teal-700"
              >
                {sortableFields.map((opt) => (
                  <option key={opt.key} value={opt.key}>
                    Sort: {opt.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() =>
                  setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'))
                }
                title={sortDir === 'asc' ? 'Ascending order' : 'Descending order'}
                className="inline-flex items-center gap-1 px-2.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap"
              >
                {sortDir === 'asc' ? (
                  <>
                    <ArrowUp className="w-3.5 h-3.5 text-teal-700" />
                    <span>Asc</span>
                  </>
                ) : (
                  <>
                    <ArrowDown className="w-3.5 h-3.5 text-teal-700" />
                    <span>Desc</span>
                  </>
                )}
              </button>
            </div>

            {hasActiveFilters && (
              <button
                type="button"
                onClick={clearAllFilters}
                className="inline-flex items-center gap-1 px-2.5 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 bg-slate-50 border border-slate-200 hover:bg-slate-100 rounded-lg transition-colors whitespace-nowrap"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Reset
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {canUseSheetView && (
              <div
                className="inline-flex items-center gap-0.5 p-0.5 bg-slate-100 border border-slate-200 rounded-lg"
                role="group"
                aria-label="View mode"
              >
                <button
                  type="button"
                  onClick={() => {
                    if (viewMode === 'list') return;
                    confirmNavigationIfDirty(() => setViewMode('list'));
                  }}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    viewMode === 'list'
                      ? 'bg-white text-teal-800 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <LayoutList className="w-3.5 h-3.5" />
                  <span>List</span>
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('sheet')}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    viewMode === 'sheet'
                      ? 'bg-white text-teal-800 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Table2 className="w-3.5 h-3.5" />
                  <span>Sheet View</span>
                </button>
              </div>
            )}

            {canWrite && (
              <>
                <button
                  type="button"
                  onClick={() =>
                    confirmNavigationIfDirty(() =>
                      openLayer({ kind: 'import-csv', entity })
                    )
                  }
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  <Upload className="w-3.5 h-3.5" />
                  Import CSV
                </button>
                <button
                  type="button"
                  onClick={() =>
                    confirmNavigationIfDirty(() =>
                      openLayer({ kind: 'create', entity })
                    )
                  }
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add {meta.singular}
                </button>
              </>
            )}
          </div>
        </div>

        {/* Secondary Filter Bar: Entity-Specific & Audit Log Filters */}
        {(statusOptions.length > 0 ||
          roleOptions.length > 0 ||
          hazardOptions.length > 0 ||
          dataTypeOptions.length > 0 ||
          periodOptions.length > 0 ||
          (hasClientIdField && sortedClientOptions.length > 0) ||
          entity === 'logs') && (
          <div className="flex flex-wrap items-center gap-2.5 pt-2.5 border-t border-slate-100">
            {/* Status Filter Buttons */}
            {statusOptions.length > 0 && (
              <div className="flex items-center gap-1 p-1 bg-slate-50 border border-slate-200 rounded-lg overflow-x-auto">
                <button
                  type="button"
                  onClick={() => setStatusFilter('all')}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    statusFilter === 'all'
                      ? 'bg-teal-700 text-white'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  All Status
                </button>
                {statusOptions.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setStatusFilter(opt.value)}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                      statusFilter === opt.value
                        ? 'bg-teal-700 text-white'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}

            {/* Workers Role Filter */}
            {roleOptions.length > 0 && (
              <select
                aria-label="Filter by role"
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value)}
                className="px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600/25 focus:border-teal-700"
              >
                <option value="all">All Roles</option>
                {roleOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    Role: {opt.label}
                  </option>
                ))}
              </select>
            )}

            {/* Waste Item Hazard Filter */}
            {hazardOptions.length > 0 && (
              <select
                aria-label="Filter by hazard category"
                value={hazardFilter}
                onChange={(e) => setHazardFilter(e.target.value)}
                className="px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600/25 focus:border-teal-700"
              >
                <option value="all">All Hazard Categories</option>
                {hazardOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            )}

            {/* Limbah Data Type Filter */}
            {dataTypeOptions.length > 0 && (
              <select
                aria-label="Filter by data type"
                value={dataTypeFilter}
                onChange={(e) => setDataTypeFilter(e.target.value)}
                className="px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600/25 focus:border-teal-700"
              >
                <option value="all">All Data Types</option>
                {dataTypeOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    Type: {opt.label}
                  </option>
                ))}
              </select>
            )}

            {/* Document Period (Month-Year) Filter */}
            {periodOptions.length > 0 && (
              <select
                aria-label="Filter by period"
                value={periodFilter}
                onChange={(e) => setPeriodFilter(e.target.value)}
                className="px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600/25 focus:border-teal-700"
              >
                <option value="all">All Periods</option>
                {periodOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    Period: {opt.label}
                  </option>
                ))}
              </select>
            )}

            {/* Client Filter for Client-Linked Models (Flexible Search) */}
            {hasClientIdField && sortedClientOptions.length > 0 && (
              <div className="min-w-[180px] max-w-[240px]">
                <SearchableSelectField
                  value={clientFilter}
                  clearValue="all"
                  allOptionLabel="All Clients"
                  variant="filter"
                  ariaLabel="Filter by client"
                  modalTitle="Filter by Client"
                  searchPlaceholder="Search client name, ID, PIC, or industry..."
                  emptyText="No matching clients."
                  options={sortedClientOptions.map((c) => ({
                    value: c.id,
                    code: c.id,
                    label: c.name,
                    subtitle: [c.industry, c.pic_name].filter(Boolean).join(' · ') || undefined,
                    keywords: [c.id, c.name, c.email || '', c.phone || ''],
                  }))}
                  onChange={(nextVal) => setClientFilter(nextVal || 'all')}
                />
              </div>
            )}

            {/* Audit Logs Dedicated Filters */}
            {entity === 'logs' && (
              <>
                <select
                  aria-label="Filter audit logs by model"
                  value={logModelFilter}
                  onChange={(e) => setLogModelFilter(e.target.value)}
                  className="px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600/25 focus:border-teal-700"
                >
                  <option value="all">All Models</option>
                  <option value="exclude_clients_workers">
                    Exclude Clients &amp; Workers
                  </option>
                  {Object.entries(MODEL_LABEL_MAP).map(([modelKey, label]) => (
                    <option key={modelKey} value={modelKey}>
                      {label}
                    </option>
                  ))}
                </select>

                <div className="min-w-[190px] max-w-[260px]">
                  <SearchableSelectField
                    value={logActorFilter}
                    clearValue="all"
                    allOptionLabel="All Changed By Users"
                    variant="filter"
                    ariaLabel="Filter audit logs by user"
                    modalTitle="Filter Logs by User"
                    searchPlaceholder="Search worker name, @username, role, or ID..."
                    emptyText="No matching users."
                    options={sortedWorkerOptions.map((w) => ({
                      value: w.id,
                      code: w.id,
                      label: w.name,
                      subtitle: `@${w.username} · ${w.role}`,
                      keywords: [w.id, w.name, w.username, w.role, w.email || ''],
                    }))}
                    onChange={(nextVal) => setLogActorFilter(nextVal || 'all')}
                  />
                </div>

                <select
                  aria-label="Filter audit logs by action"
                  value={logActionFilter}
                  onChange={(e) => setLogActionFilter(e.target.value)}
                  className="px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600/25 focus:border-teal-700"
                >
                  <option value="all">All Actions</option>
                  <option value="create">Create Only</option>
                  <option value="update">Update Only</option>
                </select>

                <label className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-50 border border-slate-200 rounded-lg cursor-pointer select-none whitespace-nowrap">
                  <input
                    type="checkbox"
                    checked={excludeClientsLogs}
                    onChange={(e) => setExcludeClientsLogs(e.target.checked)}
                    className="rounded border-slate-300 text-teal-700 focus:ring-teal-600/30"
                  />
                  <span>Hide Clients</span>
                </label>

                <label className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-50 border border-slate-200 rounded-lg cursor-pointer select-none whitespace-nowrap">
                  <input
                    type="checkbox"
                    checked={excludeWorkersLogs}
                    onChange={(e) => setExcludeWorkersLogs(e.target.checked)}
                    className="rounded border-slate-300 text-teal-700 focus:ring-teal-600/30"
                  />
                  <span>Hide Workers</span>
                </label>
              </>
            )}
          </div>
        )}
      </div>

      {/* Role Scope Context */}
      {roleScopeNote && (
        <p className="text-xs text-slate-500">{roleScopeNote}</p>
      )}

      {/* Error State */}
      {error && (
        <div
          role="alert"
          className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-800"
        >
          {error}
        </div>
      )}

      {/* Loading Skeleton, Master Sheet View, or Populated Data Table */}
      {loading ? (
        <TableSkeleton columns={tableFields.length + 1} rows={6} />
      ) : viewMode === 'sheet' && canUseSheetView ? (
        <MasterSheetView
          entity={entity}
          records={filteredAndSortedRecords}
          onSaved={() => {}}
          onInspectRecord={(recordId) =>
            confirmNavigationIfDirty(() =>
              openLayer({ kind: 'inspect', entity, recordId })
            )
          }
        />
      ) : filteredAndSortedRecords.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-lg p-12 text-center">
          <p className="font-display text-base font-semibold text-slate-900">
            No {meta.plural.toLowerCase()} found
          </p>
          <p className="mt-1.5 text-sm text-slate-500 max-w-md mx-auto">
            {hasActiveFilters
              ? 'Try clearing or adjusting your active search and filter criteria.'
              : `Records created in ${meta.plural} will appear here with auto-generated ${meta.prefix} identifiers.`}
          </p>
          {hasActiveFilters ? (
            <button
              type="button"
              onClick={clearAllFilters}
              className="mt-5 inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-teal-800 bg-[#EFF8F8] border border-teal-200 hover:bg-teal-50 rounded-lg transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset Filters
            </button>
          ) : (
            canWrite && (
              <button
                type="button"
                onClick={() => openLayer({ kind: 'create', entity })}
                className="mt-5 inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                Create First {meta.singular}
              </button>
            )
          )}
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500">
                  <th className="py-3 px-4 whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => handleHeaderSort('id')}
                      className="inline-flex items-center gap-1 hover:text-slate-900 transition-colors"
                    >
                      <span>ID</span>
                      {renderSortIcon('id')}
                    </button>
                  </th>
                  {tableFields.map((field) => {
                    const sortable =
                      field.type !== 'json' &&
                      field.type !== 'ref-list' &&
                      field.type !== 'url-list';
                    return (
                      <th
                        key={field.key}
                        className={`py-3 px-4 whitespace-nowrap ${
                          field.align === 'right' ? 'text-right' : 'text-left'
                        }`}
                      >
                        {sortable ? (
                          <button
                            type="button"
                            onClick={() => handleHeaderSort(field.key)}
                            className={`inline-flex items-center gap-1 hover:text-slate-900 transition-colors ${
                              field.align === 'right' ? 'flex-row-reverse' : ''
                            }`}
                          >
                            <span>{field.label}</span>
                            {renderSortIcon(field.key)}
                          </button>
                        ) : (
                          field.label
                        )}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredAndSortedRecords.map((rec) => (
                  <tr
                    key={rec.id}
                    onClick={() =>
                      openLayer({
                        kind: 'inspect',
                        entity,
                        recordId: rec.id,
                      })
                    }
                    className="hover:bg-[#F3FAFA] transition-colors cursor-pointer"
                  >
                    <td className="py-3 px-4 font-mono text-xs font-semibold text-teal-800 whitespace-nowrap">
                      {rec.id}
                    </td>
                    {tableFields.map((field) => (
                      <td
                        key={field.key}
                        className={`py-3 px-4 whitespace-nowrap ${
                          field.align === 'right' ? 'text-right' : 'text-left'
                        }`}
                      >
                        {renderCell(field, rec)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-2.5 border-t border-slate-100 bg-slate-50/40 flex items-center justify-between text-xs text-slate-500 tabular-nums">
            <span>
              {filteredAndSortedRecords.length} of {records.length}{' '}
              {records.length === 1 ? 'record' : 'records'}
            </span>
            <span>Click column headers to sort &middot; click a row to inspect</span>
          </div>
        </div>
      )}
    </div>
  );
}
