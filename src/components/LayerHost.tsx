import React, { useEffect, useMemo, useState } from 'react';
import JSZip from 'jszip';
import {
  AlertTriangle,
  Archive,
  ArrowLeft,
  Ban,
  CheckCircle2,
  Download,
  Edit3,
  ExternalLink,
  FileSpreadsheet,
  History,
  Image as ImageIcon,
  LogOut,
  RotateCcw,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {
  api,
  formatIDR,
  formatStatusLabel,
  formatWeight,
  statusTextClass,
} from '../lib/api.ts';
import { useFeedback } from '../lib/feedback.tsx';
import {
  compressImageFile,
  compressZipImages,
  formatBytes,
} from '../lib/imageCompression.ts';
import { isGoogleDriveLink, isSafeDisplayUrl } from '../lib/imageUrl.ts';
import { useNavigation, type LayerEntry } from '../lib/navigation.tsx';
import {
  CSV_IMPORT_BATCH_SIZE,
  analyzeZipRowWarnings,
  buildCsvBatches,
  extractCsvDelimiterAndLinesShared,
  normalizeCsvHeaderShared,
  parseCsvLineShared,
  resolveRowAttachments,
  sanitizeZipEntries,
  validateEntityCsvFile,
  type SanitizedZipEntry,
} from '../shared/csvZipMatcher.ts';
import {
  ENTITY_META,
  canMutateEntity,
  formatDatePeriodLabel,
  getCsvColumnHeader,
  getEntityUrlFields,
  isDocumentEntity,
  type FieldDef,
} from '../shared/entityMeta.ts';
import { generateEntityId, previewIdFormat } from '../shared/idGenerator.ts';
import type {
  AnyEntityRecord,
  AuthProfileUpdateResponse,
  CancelInvoiceResponse,
  CsvImportMode,
  CsvImportResult,
  DocumentEntityKey,
  EntityKey,
  InvoiceRecord,
  LogChangeEntry,
  LogRecord,
  WorkerRecord,
} from '../shared/types.ts';
import { CancelInvoiceModal } from './CancelInvoiceModal.tsx';
import { DocumentWorkspaceLayer } from './DocumentWorkspaceLayer.tsx';
import { ReferencePickerField } from './ReferencePickerField.tsx';
import { ReferencePickerLayerBody } from './ReferencePickerLayer.tsx';
import { SafeImage } from './SafeImage.tsx';
import { LayerSkeleton } from './Skeleton.tsx';

interface LayerHostProps {
  worker: WorkerRecord;
  onProfileUpdated: (res: AuthProfileUpdateResponse) => void;
  onSignOut: () => void;
}

export function LayerHost({
  worker,
  onProfileUpdated,
  onSignOut,
}: LayerHostProps) {
  const { layers, popLayer, closeAllLayers, pathname } = useNavigation();

  if (layers.length === 0) return null;

  const topLayer = layers[layers.length - 1];

  const isLayerFullScreenDoc = (layer: LayerEntry): boolean =>
    (layer.kind === 'create' ||
      layer.kind === 'edit' ||
      layer.kind === 'inspect') &&
    isDocumentEntity(layer.entity);

  const isTopFullScreenDoc = isLayerFullScreenDoc(topLayer);

  return (
    <div
      className={
        isTopFullScreenDoc
          ? 'fixed inset-0 z-[60] flex items-center justify-center p-2 sm:p-4'
          : 'fixed inset-0 z-[60] flex justify-end'
      }
    >
      {/* Backdrop — pops only the top layer when stacked so underlying forms stay safe */}
      <div
        className="fixed inset-0 bg-slate-900/35 backdrop-blur-[2px] transition-opacity"
        onClick={layers.length > 1 ? popLayer : closeAllLayers}
        aria-hidden="true"
      />

      {/* Keep all stacked layers mounted so opening pick-ref/inspect never wipes unsaved form state */}
      {layers.map((layer, index) => {
        const isTop = index === layers.length - 1;
        const isFullScreenDocument = isLayerFullScreenDoc(layer);
        const isPickRef = layer.kind === 'pick-ref';
        const drawerWidthClass = isPickRef ? 'max-w-2xl' : 'max-w-xl';

        return (
          <section
            key={layer.layerId}
            role="dialog"
            aria-modal={isTop}
            aria-hidden={!isTop}
            className={`${!isTop ? 'hidden' : 'flex'} ${
              isFullScreenDocument
                ? 'relative z-10 w-full max-w-[1400px] h-full bg-white border border-slate-200 rounded-xl flex-col shadow-2xl overflow-hidden'
                : `relative z-10 w-full ${drawerWidthClass} bg-white border-l border-slate-200 h-full flex-col shadow-xl`
            }`}
          >
            {/* Layer Stack Header */}
            <header className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-3 shrink-0 bg-white">
              <div className="flex items-center gap-2.5 min-w-0">
                {index > 0 && (
                  <button
                    type="button"
                    onClick={popLayer}
                    aria-label="Previous layer"
                    className="p-1.5 rounded-md text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors shrink-0"
                  >
                    <ArrowLeft className="w-4 h-4" />
                  </button>
                )}
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-[11px] text-slate-500 font-mono truncate">
                    <span>Layer {index + 1}</span>
                    {isFullScreenDocument && (
                      <>
                        <span aria-hidden="true">&middot;</span>
                        <span className="text-teal-700 font-semibold">
                          Full-Screen Document
                        </span>
                      </>
                    )}
                    {isPickRef && (
                      <>
                        <span aria-hidden="true">&middot;</span>
                        <span className="text-teal-700 font-semibold">
                          Reference Search
                        </span>
                      </>
                    )}
                    <span aria-hidden="true">&middot;</span>
                    <span className="truncate">{pathname}</span>
                  </div>
                  <h2 className="font-display text-base font-semibold text-slate-900 truncate">
                    {layerTitle(layer)}
                  </h2>
                </div>
              </div>

              <button
                type="button"
                onClick={isPickRef && index > 0 ? popLayer : closeAllLayers}
                aria-label={isPickRef && index > 0 ? 'Close reference picker' : 'Close layer'}
                className="p-1.5 rounded-md text-slate-400 hover:text-slate-800 hover:bg-slate-100 transition-colors shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </header>

            {/* Layer Body */}
            <div className={isPickRef ? 'flex-1 min-h-0 overflow-hidden' : 'flex-1 overflow-y-auto'}>
              {(layer.kind === 'create' ||
                layer.kind === 'edit' ||
                layer.kind === 'inspect') &&
              isDocumentEntity(layer.entity) ? (
                <DocumentWorkspaceLayer
                  entity={layer.entity}
                  mode={layer.kind}
                  recordId={
                    layer.kind === 'edit' || layer.kind === 'inspect'
                      ? layer.recordId
                      : undefined
                  }
                  worker={worker}
                />
              ) : (
                <>
                  {layer.kind === 'inspect' && (
                    <InspectLayerBody
                      entity={layer.entity}
                      recordId={layer.recordId}
                      worker={worker}
                    />
                  )}
                  {layer.kind === 'create' && (
                    <RecordFormLayerBody
                      entity={layer.entity}
                      mode="create"
                      worker={worker}
                    />
                  )}
                  {layer.kind === 'edit' && (
                    <RecordFormLayerBody
                      entity={layer.entity}
                      mode="edit"
                      recordId={layer.recordId}
                      worker={worker}
                    />
                  )}
                  {layer.kind === 'import-csv' && (
                    <CsvImportLayerBody entity={layer.entity} worker={worker} />
                  )}
                  {layer.kind === 'profile' && (
                    <ProfileLayerBody
                      worker={worker}
                      onProfileUpdated={onProfileUpdated}
                      onSignOut={onSignOut}
                    />
                  )}
                  {layer.kind === 'pick-ref' && (
                    <ReferencePickerLayerBody
                      entity={layer.entity}
                      multiple={layer.multiple}
                      selectedIds={layer.selectedIds}
                      filterRecord={layer.filterRecord}
                      onSelect={layer.onSelect}
                      worker={worker}
                    />
                  )}
                </>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function layerTitle(layer: LayerEntry): string {
  switch (layer.kind) {
    case 'inspect':
      return `${ENTITY_META[layer.entity].singular} ${layer.recordId}`;
    case 'create':
      return `New ${ENTITY_META[layer.entity].singular}`;
    case 'edit':
      return `Edit ${ENTITY_META[layer.entity].singular} ${layer.recordId}`;
    case 'import-csv':
      return `Import ${ENTITY_META[layer.entity].plural} (CSV)`;
    case 'profile':
      return 'Worker Account';
    case 'pick-ref':
      return (
        layer.title ||
        `Select ${layer.multiple ? ENTITY_META[layer.entity].plural : ENTITY_META[layer.entity].singular}`
      );
  }
}

// ============================================================================
// 1. Inspect Record Layer (with clickable Reference IDs stacking further layers)
// ============================================================================
function InspectLayerBody({
  entity,
  recordId,
  worker,
}: {
  entity: EntityKey;
  recordId: string;
  worker: WorkerRecord;
}) {
  const {
    openLayer,
    replaceTopLayer,
    popLayer,
    closeAllLayers,
    navigatePage,
    notifyDataChanged,
    setAccountingPrefill,
    dataVersion,
  } = useNavigation();
  const { notifySuccess } = useFeedback();
  const meta = ENTITY_META[entity];

  const [record, setRecord] = useState<AnyEntityRecord | null>(null);
  const [prevLogChain, setPrevLogChain] = useState<LogRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [cancelModalOpen, setCancelModalOpen] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setConfirmDelete(false);
    setCancelModalOpen(false);
    setPrevLogChain([]);

    const loadRecord = async () => {
      try {
        const res = await api.getRecord(entity, recordId);
        if (!active) return;
        setRecord(res.record);

        // When inspecting an Audit Log, traverse id_previous_logs up to 2 steps back
        if (entity === 'logs') {
          const chain: LogRecord[] = [];
          let nextPrevId = (res.record as LogRecord).id_previous_logs || null;
          for (let step = 0; step < 2 && nextPrevId; step++) {
            try {
              const prevRes = await api.getRecord<LogRecord>('logs', nextPrevId);
              if (!active) return;
              chain.push(prevRes.record);
              nextPrevId = prevRes.record.id_previous_logs || null;
            } catch {
              break;
            }
          }
          if (active) setPrevLogChain(chain);
        }
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : 'Unable to load record.');
        }
      } finally {
        if (active) setLoading(false);
      }
    };

    loadRecord();
    return () => {
      active = false;
    };
  }, [entity, recordId, dataVersion]);

  if (loading) return <LayerSkeleton />;

  if (error || !record) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-800">
          {error || 'Record not found.'}
        </div>
      </div>
    );
  }

  const obj = record as unknown as Record<string, unknown>;
  const canEdit =
    canMutateEntity(worker.role, entity) &&
    (worker.role !== 'admin' || record.created_by === worker.id);
  const canDelete = canEdit && !(entity === 'workers' && record.id === worker.id);

  const handleDelete = async () => {
    setDeleting(true);
    setError(null);
    try {
      await api.deleteRecord(entity, record.id);
      notifyDataChanged();
      notifySuccess(`${meta.singular} ${record.id} deleted.`);
      popLayer();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed.');
      setDeleting(false);
    }
  };

  const renderFieldValue = (field: FieldDef) => {
    const val = obj[field.key];
    if (val === null || val === undefined || val === '') {
      return <span className="text-slate-400">Not set</span>;
    }
    if (field.type === 'ref' && field.refEntity) {
      const refId = String(val);
      return (
        <button
          type="button"
          onClick={() =>
            openLayer({
              kind: 'inspect',
              entity: field.refEntity!,
              recordId: refId,
            })
          }
          className="inline-flex items-center gap-1.5 font-mono text-xs font-semibold text-teal-700 hover:text-teal-900 hover:underline"
        >
          <span>{refId}</span>
          <ExternalLink className="w-3 h-3" />
        </button>
      );
    }
    if (field.type === 'ref-list' && field.refEntity) {
      const list = Array.isArray(val) ? val.map(String) : [];
      if (list.length === 0) return <span className="text-slate-400">None</span>;
      return (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          {list.map((refId) => (
            <button
              key={refId}
              type="button"
              onClick={() =>
                openLayer({
                  kind: 'inspect',
                  entity: field.refEntity!,
                  recordId: refId,
                })
              }
              className="inline-flex items-center gap-1 font-mono text-xs font-semibold text-teal-700 hover:text-teal-900 hover:underline"
            >
              <span>{refId}</span>
              <ExternalLink className="w-3 h-3" />
            </button>
          ))}
        </div>
      );
    }
    if (field.type === 'currency') {
      return (
        <span className="font-mono text-sm font-medium text-slate-900 tabular-nums">
          {formatIDR(Number(val))}
        </span>
      );
    }
    if (field.type === 'number') {
      return (
        <span className="font-mono text-sm text-slate-900 tabular-nums">
          {field.key.includes('weight')
            ? formatWeight(Number(val))
            : field.key.includes('rate')
              ? `${val}%`
              : Number(val).toLocaleString('id-ID')}
        </span>
      );
    }
    if (field.key === 'status') {
      return (
        <span className={`text-sm ${statusTextClass(String(val))}`}>
          {formatStatusLabel(String(val))}
        </span>
      );
    }
    if (field.type === 'url-list') {
      const urls = Array.isArray(val) ? val.map(String).filter(Boolean) : [];
      if (urls.length === 0) {
        return <span className="text-slate-400">No images uploaded</span>;
      }
      return (
        <div className="space-y-2">
          <div className="grid grid-cols-3 gap-2">
            {urls.map((urlStr, idx) => (
              <a
                key={`${urlStr}-${idx}`}
                href={isSafeDisplayUrl(urlStr) ? urlStr : undefined}
                target="_blank"
                rel="noopener noreferrer"
                className="group relative block rounded-lg overflow-hidden border border-slate-200 bg-slate-50 aspect-square"
              >
                <SafeImage
                  src={urlStr}
                  alt={`${field.label} ${idx + 1}`}
                  className="w-full h-full object-cover"
                  fallback={
                    <div className="w-full h-full flex flex-col items-center justify-center text-slate-400 text-[10px] font-mono p-1 text-center">
                      <ImageIcon className="w-4 h-4 mb-0.5" />
                      <span>#{idx + 1}</span>
                    </div>
                  }
                />
                <span className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded bg-slate-900/70 text-white font-mono text-[10px]">
                  #{idx + 1}
                </span>
              </a>
            ))}
          </div>
          <p className="text-[11px] text-slate-400">
            {urls.length} {urls.length === 1 ? 'image' : 'images'} (loaded with no-referrer)
          </p>
        </div>
      );
    }
    if (field.key === 'date_period') {
      const dp = String(val);
      const period = formatDatePeriodLabel(dp);
      return (
        <span className="font-mono text-sm text-slate-900 tabular-nums">
          {dp}{' '}
          {period && (
            <span className="text-xs font-sans text-teal-700 font-medium ml-1">
              ({period})
            </span>
          )}
        </span>
      );
    }
    if (field.type === 'url') {
      const urlStr = String(val);
      const isPdf = /\.pdf(\?|$)/i.test(urlStr);
      return (
        <div className="flex items-center gap-3 min-w-0">
          {!isPdf ? (
            <SafeImage
              src={urlStr}
              alt={field.label}
              className="w-11 h-11 rounded-lg object-cover border border-slate-200 bg-white shrink-0"
              fallback={
                <div className="w-11 h-11 rounded-lg bg-slate-100 border border-slate-200 text-slate-400 flex items-center justify-center shrink-0">
                  <ImageIcon className="w-4 h-4" />
                </div>
              }
            />
          ) : (
            <div className="w-11 h-11 rounded-lg bg-slate-100 border border-slate-200 text-slate-500 flex items-center justify-center shrink-0 text-[10px] font-mono font-semibold">
              PDF
            </div>
          )}
          <div className="min-w-0 flex-1">
            {isSafeDisplayUrl(urlStr) ? (
              <a
                href={urlStr}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs font-mono text-teal-700 hover:underline max-w-full"
              >
                <span className="truncate max-w-[210px]">{urlStr}</span>
                <ExternalLink className="w-3 h-3 shrink-0" />
              </a>
            ) : (
              <span className="text-xs font-mono text-slate-600 truncate block max-w-[220px]">
                {urlStr}
              </span>
            )}
            {isGoogleDriveLink(urlStr) && (
              <p className="text-[11px] text-slate-400 mt-0.5">
                Google Drive link (loaded with no-referrer)
              </p>
            )}
          </div>
        </div>
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
            second: '2-digit',
          });
      return (
        <span className="font-mono text-xs tabular-nums text-slate-800">
          {formatted}
        </span>
      );
    }
    if (field.type === 'json') {
      const entries = (Array.isArray(val) ? val : []) as LogChangeEntry[];
      const targetModel =
        typeof obj.model_name === 'string' && obj.model_name in ENTITY_META
          ? (obj.model_name as EntityKey)
          : null;

      if (entries.length === 0) {
        return <span className="text-xs text-slate-400">No field changes recorded</span>;
      }

      const formatDiffVal = (v: unknown): string => {
        if (v === null || v === undefined || v === '') return '—';
        if (Array.isArray(v)) return v.join(', ') || '—';
        if (typeof v === 'object') return JSON.stringify(v);
        return String(v);
      };

      return (
        <div className="space-y-3">
          {entries.map((entry, idx) => {
            const changeKeys = Object.keys(entry.changes || {});
            return (
              <div
                key={`${entry.record_id}-${idx}`}
                className="border border-slate-200 rounded-lg overflow-hidden bg-slate-50/50"
              >
                <div className="px-3 py-2 bg-slate-100/80 border-b border-slate-200 flex items-center justify-between gap-2">
                  {targetModel && targetModel !== 'logs' ? (
                    <button
                      type="button"
                      onClick={() =>
                        openLayer({
                          kind: 'inspect',
                          entity: targetModel,
                          recordId: entry.record_id,
                        })
                      }
                      className="inline-flex items-center gap-1 font-mono text-xs font-semibold text-teal-800 hover:underline"
                    >
                      <span>{entry.record_id}</span>
                      <ExternalLink className="w-3 h-3" />
                    </button>
                  ) : (
                    <span className="font-mono text-xs font-semibold text-slate-800">
                      {entry.record_id}
                    </span>
                  )}
                  <span
                    className={`text-[11px] font-medium capitalize ${
                      entry.action === 'create'
                        ? 'text-teal-700'
                        : 'text-amber-700'
                    }`}
                  >
                    {entry.action}
                  </span>
                </div>

                {changeKeys.length === 0 ? (
                  <p className="px-3 py-2 text-xs text-slate-500">
                    No field value changes
                  </p>
                ) : (
                  <div className="divide-y divide-slate-200/70">
                    {changeKeys.map((fieldKey) => {
                      const diff = entry.changes[fieldKey];
                      return (
                        <div
                          key={fieldKey}
                          className="px-3 py-2 text-xs grid grid-cols-12 gap-2 items-start"
                        >
                          <span className="col-span-4 font-mono text-slate-600 truncate">
                            {fieldKey}
                          </span>
                          <div className="col-span-8 flex flex-wrap items-center gap-1.5 font-mono text-[11px] break-all">
                            <span className="text-slate-500 line-through">
                              {formatDiffVal(diff?.old)}
                            </span>
                            <span className="text-slate-400" aria-hidden="true">
                              &rarr;
                            </span>
                            <span className="text-teal-900 font-medium">
                              {formatDiffVal(diff?.new)}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      );
    }
    return <span className="text-sm text-slate-900 break-words">{String(val)}</span>;
  };

  const invoiceRec = entity === 'invoices' ? (record as InvoiceRecord) : null;
  const isInvoiceCanceled = Boolean(
    invoiceRec && (invoiceRec.is_canceled || invoiceRec.status === 'canceled')
  );
  const canCancelInvoice = Boolean(
    invoiceRec &&
      !isInvoiceCanceled &&
      canEdit &&
      (worker.role === 'master' || worker.role === 'admin')
  );

  const handleInvoiceCanceled = (res: CancelInvoiceResponse, reason: string) => {
    setCancelModalOpen(false);
    notifyDataChanged();
    if (!res.autoReversed && invoiceRec) {
      setAccountingPrefill({
        refModel: 'invoice',
        refId: invoiceRec.id,
        refLabel: invoiceRec.invoice_number || invoiceRec.id,
        description: `Manual Adjustment: Invoice ${invoiceRec.invoice_number || invoiceRec.id}`,
        note: reason,
        amount: Number(invoiceRec.total_amount ?? invoiceRec.amount ?? 0),
      });
      closeAllLayers();
      navigatePage('/b3/accounting/records');
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-mono text-teal-700 font-semibold">
            {record.id}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {meta.singular} &middot; Created{' '}
            <span className="font-mono tabular-nums">
              {new Date(record.created_at).toLocaleDateString('en-GB', {
                day: '2-digit',
                month: 'short',
                year: 'numeric',
              })}
            </span>
          </p>
        </div>

        {(canEdit || canDelete || canCancelInvoice) && (
          <div className="flex flex-wrap items-center justify-end gap-2 shrink-0">
            {canCancelInvoice && (
              <button
                type="button"
                onClick={() => setCancelModalOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-amber-800 bg-amber-50 border border-amber-200 hover:bg-amber-100 rounded-lg transition-colors whitespace-nowrap"
              >
                <Ban className="w-3.5 h-3.5" />
                Cancel Invoice
              </button>
            )}
            {canEdit && (
              <button
                type="button"
                onClick={() =>
                  replaceTopLayer({ kind: 'edit', entity, recordId: record.id })
                }
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap"
              >
                <Edit3 className="w-3.5 h-3.5" />
                Edit
              </button>
            )}
            {canDelete && !confirmDelete && (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-700 bg-white border border-red-200 hover:bg-red-50 rounded-lg transition-colors whitespace-nowrap"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Delete
              </button>
            )}
          </div>
        )}
      </div>

      {isInvoiceCanceled && invoiceRec && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3.5 text-xs text-red-900 space-y-1">
          <div className="flex items-center gap-1.5 font-semibold">
            <Ban className="w-3.5 h-3.5 text-red-700 shrink-0" />
            <span>Invoice Canceled</span>
          </div>
          {invoiceRec.canceled_at && (
            <p className="text-red-800 font-mono text-[11px] tabular-nums">
              Canceled at:{' '}
              {new Date(invoiceRec.canceled_at).toLocaleString('en-GB', {
                day: '2-digit',
                month: 'short',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </p>
          )}
          {invoiceRec.cancel_reason && (
            <p className="text-red-800">Reason: {invoiceRec.cancel_reason}</p>
          )}
        </div>
      )}

      {confirmDelete && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center justify-between gap-4">
          <p className="text-xs text-red-900">
            Permanently delete <span className="font-mono font-semibold">{record.id}</span>?
          </p>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setConfirmDelete(false)}
              className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              className="px-3 py-1.5 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-md disabled:opacity-60"
            >
              {deleting ? 'Deleting...' : 'Confirm Delete'}
            </button>
          </div>
        </div>
      )}

      {cancelModalOpen && invoiceRec && (
        <CancelInvoiceModal
          invoice={invoiceRec}
          onClose={() => setCancelModalOpen(false)}
          onCanceled={handleInvoiceCanceled}
        />
      )}

      <dl className="divide-y divide-slate-100 border-t border-slate-200">
        {meta.fields
          .filter((f) => f.type !== 'password')
          .map((field) => (
            <div
              key={field.key}
              className="py-3.5 grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-4"
            >
              <dt className="text-xs font-medium text-slate-500">
                {field.label}
              </dt>
              <dd className="sm:col-span-2">{renderFieldValue(field)}</dd>
            </div>
          ))}
        {record.created_by && (
          <div className="py-3.5 grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-4">
            <dt className="text-xs font-medium text-slate-500">Created By</dt>
            <dd className="sm:col-span-2 font-mono text-xs text-slate-600">
              {record.created_by}
            </dd>
          </div>
        )}
        {entity !== 'logs' && (
          <>
            <div className="py-3.5 grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-4">
              <dt className="text-xs font-medium text-slate-500">
                Log Create Ref
              </dt>
              <dd className="sm:col-span-2">
                {record.id_log_create ? (
                  worker.role === 'master' ? (
                    <button
                      type="button"
                      onClick={() =>
                        openLayer({
                          kind: 'inspect',
                          entity: 'logs',
                          recordId: record.id_log_create!,
                        })
                      }
                      className="inline-flex items-center gap-1.5 font-mono text-xs font-semibold text-teal-700 hover:text-teal-900 hover:underline"
                    >
                      <History className="w-3.5 h-3.5" />
                      <span>{record.id_log_create}</span>
                      <ExternalLink className="w-3 h-3" />
                    </button>
                  ) : (
                    <span className="font-mono text-xs text-slate-600">
                      {record.id_log_create}
                    </span>
                  )
                ) : (
                  <span className="text-xs text-slate-400">Not recorded</span>
                )}
              </dd>
            </div>
            <div className="py-3.5 grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-4">
              <dt className="text-xs font-medium text-slate-500">
                Log Update Ref
              </dt>
              <dd className="sm:col-span-2">
                {record.id_log_update ? (
                  worker.role === 'master' ? (
                    <button
                      type="button"
                      onClick={() =>
                        openLayer({
                          kind: 'inspect',
                          entity: 'logs',
                          recordId: record.id_log_update!,
                        })
                      }
                      className="inline-flex items-center gap-1.5 font-mono text-xs font-semibold text-teal-700 hover:text-teal-900 hover:underline"
                    >
                      <History className="w-3.5 h-3.5" />
                      <span>{record.id_log_update}</span>
                      <ExternalLink className="w-3 h-3" />
                    </button>
                  ) : (
                    <span className="font-mono text-xs text-slate-600">
                      {record.id_log_update}
                    </span>
                  )
                ) : (
                  <span className="text-xs text-slate-400">Never updated</span>
                )}
              </dd>
            </div>
          </>
        )}
      </dl>

      {/* Previous Logs Chain (up to 2 steps back) */}
      {entity === 'logs' && prevLogChain.length > 0 && (
        <div className="pt-4 border-t border-slate-200 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
              <History className="w-3.5 h-3.5 text-teal-700" />
              Previous Change Chain (Up to 2 Steps Back)
            </h3>
            <span className="text-[11px] font-mono text-slate-400">
              via id_previous_logs
            </span>
          </div>
          <div className="space-y-2.5">
            {prevLogChain.map((prevLog, idx) => {
              const entries = Array.isArray(prevLog.changes_json)
                ? prevLog.changes_json
                : [];
              const changedFields = Array.from(
                new Set(entries.flatMap((e) => Object.keys(e.changes || {})))
              );
              const dt = new Date(prevLog.timestamp_created_at);
              const ts = Number.isNaN(dt.getTime())
                ? prevLog.timestamp_created_at
                : dt.toLocaleString('en-GB', {
                    day: '2-digit',
                    month: 'short',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  });

              return (
                <div
                  key={prevLog.id}
                  className="p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-1.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-mono text-[11px] font-semibold text-slate-500">
                        Step -{idx + 1}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          openLayer({
                            kind: 'inspect',
                            entity: 'logs',
                            recordId: prevLog.id,
                          })
                        }
                        className="inline-flex items-center gap-1 font-mono text-xs font-semibold text-teal-700 hover:underline truncate"
                      >
                        <span>{prevLog.id}</span>
                        <ExternalLink className="w-3 h-3 shrink-0" />
                      </button>
                    </div>
                    <span className="font-mono text-[11px] text-slate-500 tabular-nums shrink-0">
                      {ts}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-600">
                    By <span className="font-mono">{prevLog.id_changed_by || 'System'}</span>
                    {' · '}
                    {entries.length} {entries.length === 1 ? 'record' : 'records'}
                    {changedFields.length > 0 && (
                      <>
                        {' · '}Fields:{' '}
                        <span className="font-mono text-slate-700">
                          {changedFields.slice(0, 5).join(', ')}
                          {changedFields.length > 5 ? ` +${changedFields.length - 5}` : ''}
                        </span>
                      </>
                    )}
                  </p>
                  {prevLog.id_previous_logs && idx === 1 && (
                    <p className="text-[11px] font-mono text-slate-400">
                      Earlier ancestor: {prevLog.id_previous_logs}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// 2. Create / Edit Record Form Layer
// ============================================================================
function RecordFormLayerBody({
  entity,
  mode,
  recordId,
  worker,
}: {
  entity: EntityKey;
  mode: 'create' | 'edit';
  recordId?: string;
  worker: WorkerRecord;
}) {
  const { popLayer, replaceTopLayer, notifyDataChanged } = useNavigation();
  const { notifySuccess } = useFeedback();
  const meta = ENTITY_META[entity];

  const [values, setValues] = useState<Record<string, unknown>>({});
  const [customId, setCustomId] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [uploadingField, setUploadingField] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refRecordMap, setRefRecordMap] = useState<
    Partial<Record<EntityKey, Record<string, AnyEntityRecord>>>
  >({});
  const [itemMetaById, setItemMetaById] = useState<
    Record<string, { item_note?: string | null; unit?: string }>
  >({});
  const [newImageUrlDraft, setNewImageUrlDraft] = useState<Record<string, string>>({});
  const [branchDocNameEdited, setBranchDocNameEdited] = useState(false);
  const [sameAsDocAddress, setSameAsDocAddress] = useState(false);
  const [sameAsOpsPic, setSameAsOpsPic] = useState(false);
  const { openLayer } = useNavigation();

  const refEntitiesNeeded = useMemo(() => {
    const set = new Set<EntityKey>();
    for (const f of meta.fields) {
      if ((f.type === 'ref' || f.type === 'ref-list') && f.refEntity) {
        set.add(f.refEntity);
      }
    }
    return Array.from(set);
  }, [meta.fields]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    const loadAll = async () => {
      try {
        const nextItemMeta: Record<string, { item_note?: string | null; unit?: string }> = {};
        const refEntries = await Promise.all(
          refEntitiesNeeded.map(async (refEnt) => {
            try {
              const res = await api.listRecords(refEnt, { lookup: true });
              const filteredRecords =
                refEnt === 'invoices'
                  ? res.records.filter((r) => {
                      const inv = r as unknown as Record<string, unknown>;
                      return !inv.is_canceled && inv.status !== 'canceled';
                    })
                  : res.records;
              const recById: Record<string, AnyEntityRecord> = {};
              for (const r of filteredRecords) {
                recById[r.id] = r;
                if (refEnt === 'items') {
                  const o = r as unknown as Record<string, unknown>;
                  nextItemMeta[r.id] = {
                    item_note: typeof o.item_note === 'string' ? o.item_note : null,
                    unit: typeof o.unit === 'string' ? o.unit : undefined,
                  };
                }
              }
              return [refEnt, recById] as const;
            } catch {
              return [refEnt, {} as Record<string, AnyEntityRecord>] as const;
            }
          })
        );

        const nextRefMap: Partial<Record<EntityKey, Record<string, AnyEntityRecord>>> = {};
        for (const [k, mapObj] of refEntries) {
          nextRefMap[k] = mapObj;
        }

        let initial: Record<string, unknown> = {};
        if (mode === 'edit' && recordId) {
          const res = await api.getRecord(entity, recordId);
          initial = { ...(res.record as unknown as Record<string, unknown>), password: '' };
        } else {
          const today = new Date().toISOString().slice(0, 10);
          for (const f of meta.fields) {
            if (f.type === 'select' && f.options?.[0]) {
              initial[f.key] = f.options[0].value;
            } else if (f.type === 'date' && f.required) {
              initial[f.key] = today;
            } else if (f.type === 'ref-list' || f.type === 'url-list') {
              initial[f.key] = [];
            } else if (f.key === 'unit') {
              initial[f.key] = 'kg';
            } else if (f.key === 'order_index') {
              initial[f.key] = 1;
            } else if (f.key === 'worker_id' && worker.role === 'worker') {
              initial[f.key] = worker.id;
            } else if (entity === 'requests' && f.key === 'id_creator') {
              initial[f.key] = worker.id;
            } else {
              initial[f.key] = '';
            }
          }
        }

        if (active) {
          setRefRecordMap(nextRefMap);
          setItemMetaById(nextItemMeta);
          setValues(initial);
          if (entity === 'branches') {
            setBranchDocNameEdited(mode === 'edit' && Boolean(initial.name_in_document));
            const docAddr = String(initial.id_alamat_address_document || '').trim();
            const limbahAddr = String(initial.id_alamat_address_limbah || '').trim();
            setSameAsDocAddress(Boolean(docAddr && limbahAddr && docAddr === limbahAddr));
            const opsN = String(initial.pic_operasional_nama || '').trim();
            const opsP = String(initial.pic_operasional_telfonwa || '').trim();
            const finN = String(initial.pic_keuangan_nama || '').trim();
            const finP = String(initial.pic_keuangan_telfonwa || '').trim();
            setSameAsOpsPic(
              Boolean((opsN || opsP) && opsN === finN && opsP === finP)
            );
          } else {
            setBranchDocNameEdited(false);
            setSameAsDocAddress(false);
            setSameAsOpsPic(false);
          }
        }
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : 'Failed to prepare form.');
        }
      } finally {
        if (active) setLoading(false);
      }
    };

    loadAll();
    return () => {
      active = false;
    };
  }, [entity, mode, recordId, refEntitiesNeeded, meta.fields, worker.id, worker.role]);

  if (loading) return <LayerSkeleton />;

  const computeDefaultBranchDocName = (
    clientId: string,
    branchName: string,
    clientMap?: Record<string, AnyEntityRecord>
  ): string => {
    const map = clientMap || refRecordMap.customers || {};
    const clientRec = clientId ? (map[clientId] as { name?: string } | undefined) : undefined;
    const cName = String(clientRec?.name || '').trim();
    const bName = branchName.trim();
    if (cName && bName) return `${cName} - ${bName}`;
    return bName || cName || '';
  };

  const handleFieldChange = (key: string, value: unknown) => {
    if (entity === 'branches' && key === 'name_in_document') {
      setBranchDocNameEdited(true);
    }
    setValues((prev) => {
      const next = { ...prev, [key]: value };
      if (entity === 'branches') {
        if ((key === 'id_client' || key === 'branch_name') && !branchDocNameEdited) {
          const nextClientId = String(
            key === 'id_client' ? value : next.id_client || ''
          );
          const nextBranchName = String(
            key === 'branch_name' ? value : next.branch_name || ''
          );
          next.name_in_document = computeDefaultBranchDocName(
            nextClientId,
            nextBranchName
          );
        }
        if (key === 'id_alamat_address_document' && sameAsDocAddress) {
          next.id_alamat_address_limbah = value;
        }
        if (key === 'pic_operasional_nama' && sameAsOpsPic) {
          next.pic_keuangan_nama = value;
        }
        if (key === 'pic_operasional_telfonwa' && sameAsOpsPic) {
          next.pic_keuangan_telfonwa = value;
        }
      }
      if (entity === 'pickup_data' && key === 'id_item_model' && typeof value === 'string') {
        const chosenItem = itemMetaById[value];
        if (chosenItem) {
          if (chosenItem.item_note && !String(prev.final_item_note || '').trim()) {
            next.final_item_note = chosenItem.item_note;
          }
          if (chosenItem.unit && !String(prev.unit || '').trim()) {
            next.unit = chosenItem.unit;
          }
        }
      }
      if (
        entity === 'invoices' &&
        (key === 'subtotal_amount' || key === 'tax_amount')
      ) {
        const sub = Number(
          key === 'subtotal_amount' ? value : next.subtotal_amount || 0
        );
        const tax = Number(key === 'tax_amount' ? value : next.tax_amount || 0);
        if (Number.isFinite(sub) && Number.isFinite(tax) && (sub > 0 || tax !== 0)) {
          next.amount = Math.round((sub + tax) * 100) / 100;
        }
      }
      return next;
    });
  };

  const handleRefSinglePicked = (
    field: FieldDef,
    pickedId: string,
    pickedRecord: AnyEntityRecord | null
  ) => {
    if (field.refEntity && pickedRecord) {
      setRefRecordMap((prev) => ({
        ...prev,
        [field.refEntity!]: {
          ...(prev[field.refEntity!] || {}),
          [pickedRecord.id]: pickedRecord,
        },
      }));
      if (field.refEntity === 'items') {
        const o = pickedRecord as unknown as Record<string, unknown>;
        const itemNote = typeof o.item_note === 'string' ? o.item_note : null;
        const itemUnit = typeof o.unit === 'string' ? o.unit : undefined;
        setItemMetaById((prev) => ({
          ...prev,
          [pickedRecord.id]: { item_note: itemNote, unit: itemUnit },
        }));
        setValues((prev) => {
          const next: Record<string, unknown> = { ...prev, [field.key]: pickedId };
          if (entity === 'pickup_data' && field.key === 'id_item_model') {
            if (itemNote && !String(prev.final_item_note || '').trim()) {
              next.final_item_note = itemNote;
            }
            if (itemUnit && !String(prev.unit || '').trim()) {
              next.unit = itemUnit;
            }
          }
          return next;
        });
        return;
      }
      if (entity === 'branches' && field.key === 'id_client') {
        const updatedCustomerMap = {
          ...(refRecordMap.customers || {}),
          [pickedRecord.id]: pickedRecord,
        };
        setValues((prev) => {
          const next: Record<string, unknown> = { ...prev, id_client: pickedId };
          if (!branchDocNameEdited) {
            next.name_in_document = computeDefaultBranchDocName(
              pickedId,
              String(prev.branch_name || ''),
              updatedCustomerMap
            );
          }
          return next;
        });
        return;
      }
    }
    handleFieldChange(field.key, pickedId);
  };

  const handleRefMultiPicked = (
    field: FieldDef,
    pickedIds: string[],
    pickedRecords: AnyEntityRecord[]
  ) => {
    if (field.refEntity && pickedRecords.length > 0) {
      setRefRecordMap((prev) => {
        const nextBucket = { ...(prev[field.refEntity!] || {}) };
        for (const r of pickedRecords) {
          nextBucket[r.id] = r;
        }
        return { ...prev, [field.refEntity!]: nextBucket };
      });
    }
    handleFieldChange(field.key, pickedIds);
  };

  const handleAssetFileUpload = async (
    fieldKey: string,
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploadingField(fieldKey);
    setError(null);
    try {
      const compressed = await compressImageFile(file, {
        maxDimension: entity === 'workers' || fieldKey === 'display_picture_url' ? 800 : 1600,
        quality: 0.8,
      });
      const uploaded = await api.uploadRecordAsset(entity, compressed.file);
      handleFieldChange(fieldKey, uploaded.url);
      const sizeNote = compressed.wasCompressed
        ? ` (${formatBytes(compressed.originalSize)} → ${formatBytes(compressed.compressedSize)})`
        : '';
      notifySuccess(`Uploaded ${uploaded.fileName}${sizeNote}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload file.');
    } finally {
      setUploadingField(null);
    }
  };

  const handleMultiImageUpload = async (
    fieldKey: string,
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const selectedFiles = Array.from(e.target.files || []);
    e.target.value = '';
    if (selectedFiles.length === 0) return;
    setUploadingField(fieldKey);
    setError(null);
    try {
      const uploadedUrls: string[] = [];
      let totalOriginal = 0;
      let totalCompressed = 0;
      let anyCompressed = false;
      for (const file of selectedFiles) {
        const compressed = await compressImageFile(file, {
          maxDimension: 1600,
          quality: 0.8,
        });
        totalOriginal += compressed.originalSize;
        totalCompressed += compressed.compressedSize;
        if (compressed.wasCompressed) anyCompressed = true;
        const res = await api.uploadRecordAsset(entity, compressed.file);
        uploadedUrls.push(res.url);
      }
      const existingList = Array.isArray(values[fieldKey])
        ? (values[fieldKey] as string[])
        : [];
      handleFieldChange(fieldKey, [...existingList, ...uploadedUrls]);
      const sizeNote = anyCompressed
        ? ` (${formatBytes(totalOriginal)} → ${formatBytes(totalCompressed)})`
        : '';
      notifySuccess(`Uploaded ${uploadedUrls.length} image(s)${sizeNote}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload image(s).');
    } finally {
      setUploadingField(null);
    }
  };

  const handleZipImagesUpload = async (
    fieldKey: string,
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const zipFile = e.target.files?.[0];
    e.target.value = '';
    if (!zipFile) return;
    setUploadingField(fieldKey);
    setError(null);
    try {
      const compressedZip = await compressZipImages(zipFile, {
        maxDimension: 1600,
        quality: 0.78,
      });
      const res = await api.uploadRecordZip(entity, compressedZip.file);
      const existingList = Array.isArray(values[fieldKey])
        ? (values[fieldKey] as string[])
        : [];
      handleFieldChange(fieldKey, [...existingList, ...res.urls]);
      const sizeNote =
        compressedZip.compressedCount > 0
          ? ` (${formatBytes(compressedZip.originalSize)} → ${formatBytes(compressedZip.compressedSize)})`
          : '';
      notifySuccess(
        `Extracted & uploaded ${res.urls.length} image(s) from ${zipFile.name}${sizeNote}.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload ZIP images.');
    } finally {
      setUploadingField(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      if (mode === 'create') {
        const payload: Record<string, unknown> = { ...values };
        if (customId.trim()) {
          payload.id = customId.trim();
        }
        const res = await api.createRecord(entity, payload);
        if (!res?.record?.id) {
          throw new Error('Unexpected response while creating record.');
        }
        notifyDataChanged();
        notifySuccess(`${meta.singular} ${res.record.id} created.`);
        replaceTopLayer({
          kind: 'inspect',
          entity,
          recordId: res.record.id,
        });
      } else if (recordId) {
        const updatePayload: Record<string, unknown> = { ...values };
        if (
          typeof updatePayload.password === 'string' &&
          !updatePayload.password.trim()
        ) {
          delete updatePayload.password;
        }
        const res = await api.updateRecord(entity, recordId, updatePayload);
        if (!res?.record?.id) {
          throw new Error('Unexpected response while updating record.');
        }
        notifyDataChanged();
        notifySuccess(`${meta.singular} ${res.record.id} updated.`);
        replaceTopLayer({
          kind: 'inspect',
          entity,
          recordId: res.record.id,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save record.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="p-6 space-y-5">
      {error && (
        <div
          role="alert"
          className="px-3.5 py-2.5 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800"
        >
          {error}
        </div>
      )}

      {mode === 'create' && (
        <div className="pb-4 border-b border-slate-100">
          <label className="block text-xs font-medium text-slate-700 mb-1.5">
            Custom ID <span className="text-slate-400 font-normal">(optional — leave blank to auto-generate)</span>
          </label>
          <input
            type="text"
            value={customId}
            onChange={(e) => setCustomId(e.target.value)}
            placeholder={previewIdFormat(entity)}
            className="w-full px-3 py-2 text-sm font-mono bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600/30 focus:border-teal-700"
          />
        </div>
      )}

      <div className="space-y-4">
        {meta.fields
          .filter((f) => !(mode === 'edit' && f.hideOnEdit))
          .map((field) => {
            const val = values[field.key];
            const isOptionalEditPassword = mode === 'edit' && field.type === 'password';
            const isFieldRequired = isOptionalEditPassword ? false : field.required;
            const isFieldOptional = isOptionalEditPassword ? true : field.optional;
            const fieldPlaceholder = isOptionalEditPassword
              ? 'Leave blank to keep current password'
              : field.placeholder;
            return (
              <div key={field.key}>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  {isOptionalEditPassword ? `New ${field.label}` : field.label}
                  {isFieldOptional && (
                    <span className="text-slate-400 font-normal ml-1">(optional)</span>
                  )}
                </label>

                {field.type === 'select' && (
                  <select
                    value={String(val ?? '')}
                    onChange={(e) => handleFieldChange(field.key, e.target.value)}
                    required={isFieldRequired}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600/30 focus:border-teal-700"
                  >
                    {field.options?.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                )}

                {field.type === 'ref' && field.refEntity && (
                  <ReferencePickerField
                    entity={field.refEntity}
                    value={String(val ?? '')}
                    selectedRecord={
                      val ? refRecordMap[field.refEntity]?.[String(val)] ?? null : null
                    }
                    required={isFieldRequired}
                    optional={isFieldOptional}
                    layerTitle={`Select ${field.label}`}
                    filterRecord={
                      field.refEntity === 'invoices'
                        ? (r) => {
                            const inv = r as unknown as Record<string, unknown>;
                            return !inv.is_canceled && inv.status !== 'canceled';
                          }
                        : undefined
                    }
                    onChangeSingle={(pickedId, pickedRec) =>
                      handleRefSinglePicked(field, pickedId, pickedRec)
                    }
                  />
                )}

                {field.type === 'ref-list' && field.refEntity && (
                  <ReferencePickerField
                    entity={field.refEntity}
                    multiple
                    values={Array.isArray(val) ? (val as string[]) : []}
                    selectedRecords={(Array.isArray(val) ? (val as string[]) : [])
                      .map((id) => refRecordMap[field.refEntity!]?.[id])
                      .filter((r): r is AnyEntityRecord => Boolean(r))}
                    layerTitle={`Select ${field.label}`}
                    onChangeMultiple={(pickedIds, pickedRecs) =>
                      handleRefMultiPicked(field, pickedIds, pickedRecs)
                    }
                  />
                )}

                {field.type === 'textarea' && (
                  <div className="space-y-1.5">
                    {entity === 'branches' && field.key === 'id_alamat_address_limbah' && (
                      <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={sameAsDocAddress}
                          onChange={(e) => {
                            const checked = e.target.checked;
                            setSameAsDocAddress(checked);
                            if (checked) {
                              setValues((prev) => ({
                                ...prev,
                                id_alamat_address_limbah:
                                  prev.id_alamat_address_document ?? '',
                              }));
                            }
                          }}
                          className="rounded border-slate-300 text-teal-700 focus:ring-teal-600"
                        />
                        <span>Same as document recipient address</span>
                      </label>
                    )}
                    <textarea
                      rows={3}
                      value={String(val ?? '')}
                      onChange={(e) => handleFieldChange(field.key, e.target.value)}
                      required={isFieldRequired}
                      disabled={
                        entity === 'branches' &&
                        field.key === 'id_alamat_address_limbah' &&
                        sameAsDocAddress
                      }
                      placeholder={fieldPlaceholder}
                      className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600/30 focus:border-teal-700 disabled:bg-slate-100 disabled:text-slate-500"
                    />
                    {entity === 'pickup_data' &&
                      field.key === 'final_item_note' &&
                      typeof values.id_item_model === 'string' &&
                      itemMetaById[values.id_item_model]?.item_note && (
                        <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500">
                          <span className="truncate">
                            Item template:{' '}
                            <span className="text-slate-700">
                              {itemMetaById[values.id_item_model].item_note}
                            </span>
                          </span>
                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              type="button"
                              onClick={() =>
                                handleFieldChange(
                                  'final_item_note',
                                  itemMetaById[String(values.id_item_model)].item_note || ''
                                )
                              }
                              className="text-teal-700 font-medium hover:underline"
                            >
                              Use Template
                            </button>
                            {Boolean(val) && (
                              <button
                                type="button"
                                onClick={() => handleFieldChange('final_item_note', '')}
                                className="text-slate-500 hover:text-red-700"
                              >
                                Clear
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    {entity === 'pickup_data' && field.key === 'internal_note' && (
                      <p className="text-[11px] text-amber-700">
                        ERP-only note — never shown in Invoice, BA, FPL Real, or FPL Doc tables.
                      </p>
                    )}
                  </div>
                )}

                {field.type === 'url-list' && (() => {
                  const urls = Array.isArray(val)
                    ? (val as string[]).filter(Boolean)
                    : [];
                  const draftUrl = newImageUrlDraft[field.key] || '';
                  return (
                    <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 space-y-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <label
                          className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors cursor-pointer whitespace-nowrap ${
                            uploadingField === field.key
                              ? 'bg-slate-100 text-slate-400 border-slate-200 pointer-events-none'
                              : 'bg-white text-teal-800 border-teal-300 hover:bg-teal-50'
                          }`}
                        >
                          <Upload className="w-3.5 h-3.5" />
                          <span>
                            {uploadingField === field.key
                              ? 'Uploading...'
                              : 'Upload Images'}
                          </span>
                          <input
                            type="file"
                            multiple
                            accept="image/png,image/jpeg,image/webp,image/gif,.png,.jpg,.jpeg,.webp,.gif"
                            onChange={(e) => handleMultiImageUpload(field.key, e)}
                            disabled={uploadingField === field.key}
                            className="sr-only"
                          />
                        </label>

                        <label
                          className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors cursor-pointer whitespace-nowrap ${
                            uploadingField === field.key
                              ? 'bg-slate-100 text-slate-400 border-slate-200 pointer-events-none'
                              : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                          }`}
                        >
                          <Archive className="w-3.5 h-3.5 text-teal-700" />
                          <span>Upload ZIP (-1, -2, -3)</span>
                          <input
                            type="file"
                            accept=".zip,application/zip,application/x-zip-compressed"
                            onChange={(e) => handleZipImagesUpload(field.key, e)}
                            disabled={uploadingField === field.key}
                            className="sr-only"
                          />
                        </label>
                      </div>

                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={draftUrl}
                          onChange={(e) =>
                            setNewImageUrlDraft((prev) => ({
                              ...prev,
                              [field.key]: e.target.value,
                            }))
                          }
                          placeholder="Or paste image / Google Drive URL and click Add"
                          className="flex-1 px-2.5 py-1.5 text-xs font-mono bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-600/30 focus:border-teal-700"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            const clean = draftUrl.trim();
                            if (!clean) return;
                            handleFieldChange(field.key, [...urls, clean]);
                            setNewImageUrlDraft((prev) => ({
                              ...prev,
                              [field.key]: '',
                            }));
                          }}
                          className="px-3 py-1.5 text-xs font-semibold text-teal-800 bg-white border border-teal-300 hover:bg-teal-50 rounded-md shrink-0"
                        >
                          Add URL
                        </button>
                      </div>

                      {urls.length > 0 ? (
                        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 pt-1">
                          {urls.map((u, idx) => (
                            <div
                              key={`${u}-${idx}`}
                              className="relative group rounded-lg overflow-hidden border border-slate-200 bg-white aspect-square"
                            >
                              <SafeImage
                                src={u}
                                alt={`Item image ${idx + 1}`}
                                className="w-full h-full object-cover"
                                fallback={
                                  <div className="w-full h-full flex items-center justify-center text-slate-400">
                                    <ImageIcon className="w-4 h-4" />
                                  </div>
                                }
                              />
                              <button
                                type="button"
                                onClick={() =>
                                  handleFieldChange(
                                    field.key,
                                    urls.filter((_, i) => i !== idx)
                                  )
                                }
                                title="Remove image"
                                className="absolute top-1 right-1 p-1 rounded-full bg-slate-900/75 text-white hover:bg-red-600"
                              >
                                <X className="w-3 h-3" />
                              </button>
                              <span className="absolute bottom-1 left-1 px-1.5 py-0.5 rounded bg-slate-900/65 text-white font-mono text-[10px]">
                                #{idx + 1}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-[11px] text-slate-500">
                          Upload multiple images, a numbered ZIP archive (e.g. A337-1-1.jpg, A337-1-2.jpg, A337-1-3.jpg), or paste image/Google Drive URLs. Images are automatically compressed before upload.
                        </p>
                      )}
                    </div>
                  );
                })()}

                {field.type === 'url' && (
                  <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 space-y-3">
                    <div className="flex items-center gap-3.5">
                      {typeof val === 'string' && val.trim() && !/\.pdf(\?|$)/i.test(val) ? (
                        <SafeImage
                          src={val}
                          alt={field.label}
                          className="w-14 h-14 rounded-lg object-cover border border-slate-200 bg-white shrink-0"
                          fallback={
                            <div className="w-14 h-14 rounded-lg bg-white border border-dashed border-slate-300 text-slate-400 flex items-center justify-center shrink-0">
                              <ImageIcon className="w-5 h-5" />
                            </div>
                          }
                        />
                      ) : (
                        <div className="w-14 h-14 rounded-lg bg-white border border-dashed border-slate-300 text-slate-400 flex items-center justify-center shrink-0">
                          <ImageIcon className="w-5 h-5" />
                        </div>
                      )}

                      <div className="min-w-0 flex-1 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <label
                            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors cursor-pointer whitespace-nowrap ${
                              uploadingField === field.key
                                ? 'bg-slate-100 text-slate-400 border-slate-200 pointer-events-none'
                                : 'bg-white text-teal-800 border-teal-300 hover:bg-teal-50'
                            }`}
                          >
                            <Upload className="w-3.5 h-3.5" />
                            <span>
                              {uploadingField === field.key
                                ? 'Uploading...'
                                : typeof val === 'string' && val.trim()
                                  ? 'Replace File'
                                  : 'Upload Image'}
                            </span>
                            <input
                              type="file"
                              accept={
                                field.key === 'display_picture_url'
                                  ? 'image/png,image/jpeg,image/webp,image/gif,.png,.jpg,.jpeg,.webp,.gif'
                                  : 'image/png,image/jpeg,image/webp,image/gif,application/pdf,.png,.jpg,.jpeg,.webp,.gif,.pdf'
                              }
                              onChange={(e) => handleAssetFileUpload(field.key, e)}
                              disabled={uploadingField === field.key}
                              className="sr-only"
                            />
                          </label>

                          {typeof val === 'string' && val.trim() && (
                            <button
                              type="button"
                              onClick={() => handleFieldChange(field.key, '')}
                              disabled={uploadingField === field.key}
                              className="px-2.5 py-1.5 text-xs font-medium text-red-700 bg-white border border-red-200 hover:bg-red-50 rounded-lg transition-colors"
                            >
                              Remove
                            </button>
                          )}
                        </div>

                        <input
                          type="text"
                          value={String(val ?? '')}
                          onChange={(e) => handleFieldChange(field.key, e.target.value)}
                          placeholder="Upload above or paste direct / Google Drive URL"
                          className="w-full px-2.5 py-1.5 text-xs font-mono bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-600/30 focus:border-teal-700"
                        />

                        {typeof val === 'string' && isGoogleDriveLink(val) ? (
                          <p className="text-[11px] text-teal-800">
                            Google Drive link detected — automatically converted and rendered with{' '}
                            <span className="font-mono">no-referrer</span>. Ensure Drive sharing is set to &ldquo;Anyone with the link&rdquo;.
                          </p>
                        ) : (
                          <p className="text-[11px] text-slate-500">
                            PNG, JPG, WEBP, or GIF (max 10 MB). Images are automatically compressed before uploading to storage.
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {field.type !== 'select' &&
                  field.type !== 'ref' &&
                  field.type !== 'ref-list' &&
                  field.type !== 'textarea' &&
                  field.type !== 'url' &&
                  field.type !== 'url-list' && (
                    <div className="space-y-1.5">
                      {entity === 'branches' && field.key === 'pic_keuangan_nama' && (
                        <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={sameAsOpsPic}
                            onChange={(e) => {
                              const checked = e.target.checked;
                              setSameAsOpsPic(checked);
                              if (checked) {
                                setValues((prev) => ({
                                  ...prev,
                                  pic_keuangan_nama: prev.pic_operasional_nama ?? '',
                                  pic_keuangan_telfonwa:
                                    prev.pic_operasional_telfonwa ?? '',
                                }));
                              }
                            }}
                            className="rounded border-slate-300 text-teal-700 focus:ring-teal-600"
                          />
                          <span>Same as Operational PIC (name &amp; phone/WA)</span>
                        </label>
                      )}
                      <input
                        type={
                          field.type === 'currency' || field.type === 'number'
                            ? 'number'
                            : field.type === 'phone'
                              ? 'tel'
                              : field.type
                        }
                        step={field.type === 'number' ? 'any' : undefined}
                        value={String(val ?? '')}
                        onChange={(e) => handleFieldChange(field.key, e.target.value)}
                        required={isFieldRequired}
                        disabled={
                          entity === 'branches' &&
                          (field.key === 'pic_keuangan_nama' ||
                            field.key === 'pic_keuangan_telfonwa') &&
                          sameAsOpsPic
                        }
                        placeholder={fieldPlaceholder}
                        className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600/30 focus:border-teal-700 disabled:bg-slate-100 disabled:text-slate-500"
                      />
                      {entity === 'branches' && field.key === 'name_in_document' && (
                        <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500">
                          <span>
                            Appears in all documents. Defaults to &ldquo;Client Name - Branch Name&rdquo; (editable).
                          </span>
                          {branchDocNameEdited && (
                            <button
                              type="button"
                              onClick={() => {
                                setBranchDocNameEdited(false);
                                setValues((prev) => ({
                                  ...prev,
                                  name_in_document: computeDefaultBranchDocName(
                                    String(prev.id_client || ''),
                                    String(prev.branch_name || '')
                                  ),
                                }));
                              }}
                              className="text-teal-700 font-medium hover:underline shrink-0"
                            >
                              Reset default
                            </button>
                          )}
                        </div>
                      )}
                      {entity === 'branches' && field.key === 'npwp' && (
                        <p className="text-[11px] text-slate-500">
                          Required for Faktur Pajak (VAT). Leave blank if this branch does not receive Faktur Pajak.
                        </p>
                      )}
                      {entity === 'requests' && field.key === 'id_creator' && (
                        <div className="flex flex-wrap items-center gap-2 text-[11px]">
                          <span className="text-slate-500">Quick pick:</span>
                          <button
                            type="button"
                            onClick={() =>
                              openLayer({
                                kind: 'ref-picker',
                                entity: 'workers',
                                title: 'Select Creator (Worker)',
                                selectedIds: val ? [String(val)] : [],
                                onSelectSingle: (pickedId) =>
                                  handleFieldChange('id_creator', pickedId),
                              })
                            }
                            className="px-2 py-0.5 font-medium text-teal-800 bg-[#EFF8F8] border border-teal-200 hover:bg-teal-50 rounded"
                          >
                            Pick Worker (MCC)
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              openLayer({
                                kind: 'ref-picker',
                                entity: 'customers',
                                title: 'Select Creator (Client)',
                                selectedIds: val ? [String(val)] : [],
                                onSelectSingle: (pickedId) =>
                                  handleFieldChange('id_creator', pickedId),
                              })
                            }
                            className="px-2 py-0.5 font-medium text-slate-700 bg-slate-100 border border-slate-200 hover:bg-slate-200/70 rounded"
                          >
                            Pick Client (USR)
                          </button>
                        </div>
                      )}
                    </div>
                  )}
              </div>
            );
          })}
      </div>

      <div className="pt-4 border-t border-slate-200 flex items-center justify-end gap-2.5">
        <button
          type="button"
          onClick={popLayer}
          className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={submitting || uploadingField !== null}
          className="px-4 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap"
        >
          {submitting
            ? 'Saving...'
            : mode === 'create'
              ? `Create ${meta.singular}`
              : 'Save Changes'}
        </button>
      </div>
    </form>
  );
}

// ============================================================================
// 3. CSV Bulk Import Layer (Insert vs Update + ZIP Upload for URL File Fields)
// ============================================================================
function CsvImportLayerBody({
  entity,
  worker,
}: {
  entity: EntityKey;
  worker: WorkerRecord;
}) {
  const { openLayer, popLayer, notifyDataChanged } = useNavigation();
  const { notifyError, notifySuccess } = useFeedback();
  const meta = ENTITY_META[entity];
  const urlFields = useMemo(() => getEntityUrlFields(entity), [entity]);

  const [importMode, setImportMode] = useState<CsvImportMode>('insert');
  const [csvText, setCsvText] = useState('');
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [existingRecords, setExistingRecords] = useState<AnyEntityRecord[]>([]);
  const [sanitizedZipEntries, setSanitizedZipEntries] = useState<
    SanitizedZipEntry<null>[]
  >([]);
  const [downloadingExisting, setDownloadingExisting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [compressionStatus, setCompressionStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nextBatchIndex, setNextBatchIndex] = useState(0);
  const [cumulativeResult, setCumulativeResult] = useState<{
    createdCount: number;
    updatedCount: number;
    errorCount: number;
    ledgerPostedCount: number;
    processedRows: number;
    completedBatches: number;
    logCreateIds: string[];
    logUpdateIds: string[];
    errors: Array<{ row: number; error: string }>;
  } | null>(null);

  const refreshExistingRecords = () => {
    api
      .listRecords(entity, { lookup: true })
      .then((res) => setExistingRecords(res.records))
      .catch(() => {
        // keep current cache on transient error
      });
  };

  // Load existing records so dry-run preview accurately predicts sequential IDs (e.g. ITM-26-1001) and Update merges
  useEffect(() => {
    let active = true;
    api
      .listRecords(entity, { lookup: true })
      .then((res) => {
        if (active) setExistingRecords(res.records);
      })
      .catch(() => {
        if (active) setExistingRecords([]);
      });
    return () => {
      active = false;
    };
  }, [entity]);

  // Parse ZIP entries in browser memory for instant Dry-Run Preview & warnings before upload
  useEffect(() => {
    if (!zipFile) {
      setSanitizedZipEntries([]);
      return;
    }
    let active = true;
    JSZip.loadAsync(zipFile)
      .then((zip) => {
        if (!active) return;
        const rawItems = Object.entries(zip.files).map(([rawPath, entry]) => ({
          rawPath,
          isDir: entry.dir,
          payload: null,
        }));
        setSanitizedZipEntries(sanitizeZipEntries(rawItems));
      })
      .catch(() => {
        if (active) setSanitizedZipEntries([]);
      });
    return () => {
      active = false;
    };
  }, [zipFile]);

  const escapeCsvHeaderCell = (raw: string) =>
    /[",;\r\n]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;

  const insertHeaders = useMemo(
    () =>
      meta.fields
        .map((f) => escapeCsvHeaderCell(getCsvColumnHeader(entity, f, 'insert')))
        .join(','),
    [entity, meta.fields]
  );

  const updateHeaders = useMemo(
    () =>
      [
        'id',
        ...meta.fields
          .filter((f) => f.type !== 'password')
          .map((f) => escapeCsvHeaderCell(getCsvColumnHeader(entity, f, 'update'))),
      ].join(','),
    [entity, meta.fields]
  );

  const activeSampleHeaders =
    importMode === 'insert' ? insertHeaders : updateHeaders;

  // Split unlimited CSV rows into safe 500-row sequential batches while preserving exact Excel row numbers
  const batchPlan = useMemo(
    () => buildCsvBatches(csvText, CSV_IMPORT_BATCH_SIZE),
    [csvText]
  );
  const totalDataRows = batchPlan.totalDataRows;
  const totalBatches = batchPlan.batches.length;
  const isMultiBatch = totalBatches > 1;
  const currentBatch = batchPlan.batches[nextBatchIndex] ?? null;
  const isAllBatchesDone = totalBatches > 0 && nextBatchIndex >= totalBatches;
  const processedRows = cumulativeResult?.processedRows ?? 0;
  const remainingRows = Math.max(0, totalDataRows - processedRows);

  // Full-file pre-upload health check (validates headers, quotes, delimiters & all rows in milliseconds)
  const fileHealth = useMemo(() => {
    if (!csvText.trim()) return null;
    const existingIds = new Set(existingRecords.map((r) => r.id.toUpperCase()));
    return validateEntityCsvFile({
      csvText,
      fields: meta.fields,
      mode: importMode,
      existingIds,
    });
  }, [csvText, meta.fields, importMode, existingRecords]);

  // Live Dry-Run Preview for the active upcoming batch (at most 500 rows for instant UI responsiveness)
  // while checking out-of-range ZIP filenames against the full CSV's max Excel row.
  const dryRunPreview = useMemo(() => {
    if (!csvText.trim() || totalBatches === 0) return null;
    const previewBatch = currentBatch ?? batchPlan.batches[totalBatches - 1];
    if (!previewBatch) return null;

    const { delimiter, lines } = extractCsvDelimiterAndLinesShared(
      previewBatch.csvText
    );
    if (lines.length < 2) return null;

    const headers = parseCsvLineShared(lines[0], delimiter).map(
      normalizeCsvHeaderShared
    );
    const existingById = new Map<string, AnyEntityRecord>(
      existingRecords.map((r) => [r.id.toUpperCase(), r])
    );
    const allocatedIds = existingRecords.map((r) => r.id);

    const rows: Array<{
      excelRow: number;
      targetId: string;
      action: 'insert' | 'update';
      matchedCount: number;
      existingUrlCount: number;
      mergeMode:
        | 'none'
        | 'auto_row'
        | 'explicit_override'
        | 'update_append'
        | 'update_replace';
      renamedSamples: string[];
      missingTokens: string[];
    }> = [];
    const batchMatchedRawPaths = new Set<string>();

    for (let i = 1; i < lines.length; i += 1) {
      const excelRow = previewBatch.excelRowOffset + i + 1;
      const values = parseCsvLineShared(lines[i], delimiter);
      const rowObj: Record<string, string> = {};
      headers.forEach((h, idx) => {
        rowObj[h] = values[idx] ?? '';
      });

      let targetId: string;
      let action: 'insert' | 'update' = 'insert';
      let existingMatch: AnyEntityRecord | undefined;

      if (importMode === 'insert') {
        targetId = generateEntityId(entity, allocatedIds);
        allocatedIds.push(targetId);
      } else {
        const rawId = (rowObj.id || '').trim();
        existingMatch = rawId ? existingById.get(rawId.toUpperCase()) : undefined;
        if (existingMatch) {
          targetId = existingMatch.id;
          action = 'update';
        } else {
          targetId = generateEntityId(
            entity,
            allocatedIds,
            undefined,
            rawId || null
          );
          allocatedIds.push(targetId);
        }
      }

      let totalMatched = 0;
      let totalExisting = 0;
      let mergeMode:
        | 'none'
        | 'auto_row'
        | 'explicit_override'
        | 'update_append'
        | 'update_replace' = 'none';
      const renamedSamples: string[] = [];
      const missingTokens: string[] = [];

      for (const urlField of urlFields) {
        let effectiveCell = rowObj[urlField.key] || '';
        if (
          importMode === 'update' &&
          existingMatch &&
          !effectiveCell.trim() &&
          urlField.type === 'url-list'
        ) {
          const existingVal = (existingMatch as unknown as Record<string, unknown>)[
            urlField.key
          ];
          if (Array.isArray(existingVal) && existingVal.length > 0) {
            effectiveCell = existingVal.map(String).filter(Boolean).join('|');
          }
        }

        const plan = resolveRowAttachments({
          rawCell: effectiveCell,
          fieldType: urlField.type === 'url-list' ? 'url-list' : 'url',
          excelRow,
          zipEntries: sanitizedZipEntries,
        });

        totalExisting += plan.existingUrls.length;
        totalMatched += plan.matchedZipEntries.length;
        if (plan.mode !== 'none') mergeMode = plan.mode;
        missingTokens.push(...plan.missingExplicitTokens);

        let seqStart = urlField.type === 'url-list' ? plan.existingUrls.length : 0;
        for (const m of plan.matchedZipEntries) {
          batchMatchedRawPaths.add(m.rawPath);
          seqStart += 1;
          renamedSamples.push(`${m.baseName} → ${targetId}-${seqStart}${m.extLower}`);
        }
      }

      rows.push({
        excelRow,
        targetId,
        action,
        matchedCount: totalMatched,
        existingUrlCount: totalExisting,
        mergeMode,
        renamedSamples,
        missingTokens,
      });
    }

    const fullMaxExcelRow = totalDataRows + 1;
    const warnings = analyzeZipRowWarnings(sanitizedZipEntries, fullMaxExcelRow);
    const totalAttachments = rows.reduce((sum, r) => sum + r.matchedCount, 0);

    return {
      rows,
      batchNumber: previewBatch.batchNumber,
      excelRowStart: previewBatch.excelRowStart,
      excelRowEnd: previewBatch.excelRowEnd,
      fullMaxExcelRow,
      totalAttachments,
      batchMatchedRawPaths,
      warnings,
      hasWarnings:
        warnings.rowOneFiles.length > 0 ||
        warnings.outOfRangeFiles.length > 0 ||
        rows.some((r) => r.missingTokens.length > 0),
    };
  }, [
    csvText,
    batchPlan,
    totalBatches,
    totalDataRows,
    currentBatch,
    importMode,
    existingRecords,
    entity,
    urlFields,
    sanitizedZipEntries,
  ]);

  const resetBatchProgress = () => {
    setNextBatchIndex(0);
    setCumulativeResult(null);
    setError(null);
  };

  const handleModeSwitch = (nextMode: CsvImportMode) => {
    setImportMode(nextMode);
    resetBatchProgress();
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvFile(file);
    const reader = new FileReader();
    reader.onload = () => {
      setCsvText(String(reader.result || ''));
      resetBatchProgress();
    };
    reader.readAsText(file);
  };

  const handleZipSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    setZipFile(file);
    setError(null);
  };

  const formatCsvTimestamp = (date = new Date()) => {
    const pad = (n: number) => String(n).padStart(2, '0');
    const yy = String(date.getFullYear()).slice(-2);
    const mm = pad(date.getMonth() + 1);
    const dd = pad(date.getDate());
    const hh = pad(date.getHours());
    const mi = pad(date.getMinutes());
    const ss = pad(date.getSeconds());
    return `${yy}${mm}${dd}-${hh}${mi}${ss}`;
  };

  const escapeCsvCell = (raw: string) => {
    if (/[",;\r\n]/.test(raw)) {
      return `"${raw.replace(/"/g, '""')}"`;
    }
    return raw;
  };

  const handleDownloadInsertTemplate = () => {
    // Insert template omits the `id` column completely and prepends `sep=,` so Excel auto-splits columns across all locales
    const sampleRow = meta.fields
      .map((f) => {
        if (f.type === 'select' && f.options?.[0]) return escapeCsvCell(f.options[0].value);
        if (f.type === 'date') return new Date().toISOString().slice(0, 10);
        if (f.type === 'number' || f.type === 'currency') return '100';
        // Leave URL columns blank by default so Excel Row 2 ZIP files (2.jpg / 2-1.jpg, 2-2.jpg) auto-match seamlessly
        if (f.type === 'url' || f.type === 'url-list') return '';
        if (f.type === 'email' && entity === 'workers') return '';
        return escapeCsvCell(f.placeholder?.replace(/,/g, '') || '');
      })
      .join(',');
    const content = `sep=,\r\n${insertHeaders}\r\n${sampleRow}\r\n`;
    const fileName = `limbahin-${entity}-insert-${formatCsvTimestamp()}.csv`;
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadExistingCsv = async () => {
    setDownloadingExisting(true);
    setError(null);
    try {
      const content = await api.exportCsv(entity);
      const fileName = `limbahin-${entity}-existing-${formatCsvTimestamp()}.csv`;
      const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      link.click();
      URL.revokeObjectURL(url);
      notifySuccess(`Downloaded ${fileName}.`);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Unable to download existing CSV.'
      );
    } finally {
      setDownloadingExisting(false);
    }
  };

  const handleImport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!csvText.trim()) {
      const msg = 'Upload or paste CSV rows first.';
      setError(msg);
      notifyError(msg);
      return;
    }
    if (!currentBatch) {
      const msg =
        totalBatches === 0
          ? 'CSV must contain a header row and at least one data row.'
          : 'All batches have already been imported.';
      setError(msg);
      notifyError(msg);
      return;
    }

    setSubmitting(true);
    setCompressionStatus(null);
    setError(null);

    try {
      let preparedZipFile: File | null = null;
      if (zipFile && urlFields.length > 0) {
        const matchedPaths = dryRunPreview?.batchMatchedRawPaths;
        if (isMultiBatch) {
          // Only compress & upload ZIP entries belonging to this 500-row batch
          if (matchedPaths && matchedPaths.size > 0) {
            setCompressionStatus(
              `Compressing Batch ${currentBatch.batchNumber} images (${matchedPaths.size})...`
            );
            const compressedZip = await compressZipImages(zipFile, {
              maxDimension: entity === 'workers' ? 800 : 1600,
              quality: 0.78,
              includeRawPaths: matchedPaths,
              onProgress: (done, total) => {
                setCompressionStatus(
                  `Compressing Batch ${currentBatch.batchNumber} images (${done}/${total})...`
                );
              },
            });
            preparedZipFile = compressedZip.file;
            setCompressionStatus(`Uploading Batch ${currentBatch.batchNumber}...`);
          }
        } else {
          setCompressionStatus('Compressing ZIP images...');
          const compressedZip = await compressZipImages(zipFile, {
            maxDimension: entity === 'workers' ? 800 : 1600,
            quality: 0.78,
            onProgress: (done, total) => {
              setCompressionStatus(`Compressing images (${done}/${total})...`);
            },
          });
          preparedZipFile = compressedZip.file;
          setCompressionStatus('Uploading...');
        }
      }

      const res: CsvImportResult = await api.importCsv(entity, {
        mode: importMode,
        csvText: currentBatch.csvText,
        zipFile: preparedZipFile,
        excelRowOffset: currentBatch.excelRowOffset,
      });

      const nextCompletedBatchIndex = currentBatch.batchIndex + 1;
      const hasMoreBatches = nextCompletedBatchIndex < totalBatches;

      setCumulativeResult((prev) => {
        const logCreateIds = prev ? [...prev.logCreateIds] : [];
        if (res.logCreateId && !logCreateIds.includes(res.logCreateId)) {
          logCreateIds.push(res.logCreateId);
        }
        const logUpdateIds = prev ? [...prev.logUpdateIds] : [];
        if (res.logUpdateId && !logUpdateIds.includes(res.logUpdateId)) {
          logUpdateIds.push(res.logUpdateId);
        }
        return {
          createdCount: (prev?.createdCount ?? 0) + res.createdCount,
          updatedCount: (prev?.updatedCount ?? 0) + res.updatedCount,
          errorCount: (prev?.errorCount ?? 0) + res.errorCount,
          ledgerPostedCount:
            (prev?.ledgerPostedCount ?? 0) + (res.ledgerPostedCount ?? 0),
          processedRows: (prev?.processedRows ?? 0) + currentBatch.rowCount,
          completedBatches: (prev?.completedBatches ?? 0) + 1,
          logCreateIds,
          logUpdateIds,
          errors: [...(prev?.errors ?? []), ...res.errors],
        };
      });
      setNextBatchIndex(nextCompletedBatchIndex);

      const totalApplied = res.createdCount + res.updatedCount;
      if (totalApplied > 0) {
        notifyDataChanged();
        refreshExistingRecords();
        if (isMultiBatch && hasMoreBatches) {
          notifySuccess(
            `Batch ${currentBatch.batchNumber}/${totalBatches} done (Rows ${currentBatch.excelRowStart}–${currentBatch.excelRowEnd}). Click Continue for the next batch.`
          );
        } else if (isMultiBatch) {
          notifySuccess(
            `${meta.plural}: all ${totalDataRows.toLocaleString()} rows finished (${totalBatches} batches).`
          );
        } else {
          const parts: string[] = [];
          if (res.createdCount > 0) parts.push(`${res.createdCount} inserted`);
          if (res.updatedCount > 0) parts.push(`${res.updatedCount} updated`);
          if ((res.ledgerPostedCount ?? 0) > 0) {
            parts.push(`${res.ledgerPostedCount} auto-posted to SYSTEM_AUTO ledger`);
          }
          notifySuccess(`${meta.plural}: ${parts.join(', ')}.`);
        }
      } else if (res.errorCount > 0) {
        notifyError(
          `Batch ${currentBatch.batchNumber} completed with ${res.errorCount} row error(s).`
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'CSV import failed.');
    } finally {
      setCompressionStatus(null);
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleImport} className="p-6 space-y-5">
      {/* Insert vs Update Mode Toggle */}
      <div>
        <p className="text-xs font-medium text-slate-700 mb-2">Import Action</p>
        <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-lg">
          <button
            type="button"
            onClick={() => handleModeSwitch('insert')}
            className={`py-2 px-3 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
              importMode === 'insert'
                ? 'bg-white text-teal-800 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Insert (New Only)
          </button>
          <button
            type="button"
            onClick={() => handleModeSwitch('update')}
            className={`py-2 px-3 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
              importMode === 'update'
                ? 'bg-white text-teal-800 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Update (Existing + New)
          </button>
        </div>
      </div>

      {/* Mode Instructions + Template / Export Action */}
      <div className="p-3.5 rounded-lg bg-[#F5FAFA] border border-teal-200/80 space-y-2.5">
        {importMode === 'insert' ? (
          <>
            <p className="text-xs text-slate-700 leading-relaxed">
              <span className="font-semibold text-slate-900">Insert mode</span>{' '}
              omits the <span className="font-mono">id</span> column. Every row
              creates a new record with an auto-generated ID (
              <span className="font-mono text-teal-800">
                {previewIdFormat(entity)}
              </span>
              ) linked to a single shared <span className="font-mono">LOGS</span>{' '}
              audit record.
            </p>
            <button
              type="button"
              onClick={handleDownloadInsertTemplate}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-teal-700 hover:text-teal-900 hover:underline"
            >
              <Download className="w-3.5 h-3.5" />
              Download Insert Template (No ID Column)
            </button>
          </>
        ) : (
          <>
            <p className="text-xs text-slate-700 leading-relaxed">
              <span className="font-semibold text-slate-900">Update mode</span>{' '}
              uses the <span className="font-mono">id</span> column. Existing IDs
              are updated (sharing one update <span className="font-mono">LOGS</span>{' '}
              entry). Rows with a blank <span className="font-mono">id</span> or
              an <span className="font-mono">id</span> that does not exist are
              automatically inserted as new records.
            </p>
            <button
              type="button"
              onClick={handleDownloadExistingCsv}
              disabled={downloadingExisting}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-teal-800 bg-white border border-teal-300 hover:bg-teal-50 disabled:opacity-60 rounded-lg transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              {downloadingExisting
                ? 'Exporting Existing Records...'
                : `Download Existing ${meta.plural} CSV`}
            </button>
          </>
        )}
      </div>

      {/* Upload Section: 50/50 CSV + ZIP when model has file/image fields; CSV-only otherwise */}
      <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 space-y-3">
        <div
          className={
            urlFields.length > 0 ? 'grid grid-cols-2 gap-3' : 'grid grid-cols-1 gap-3'
          }
        >
          {/* Select CSV File */}
          <div className="flex flex-col justify-between p-3 rounded-lg bg-white border border-slate-200 space-y-2.5">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <FileSpreadsheet className="w-4 h-4 text-teal-700 shrink-0" />
                <span className="text-xs font-semibold text-slate-900 truncate">
                  CSV Data File
                </span>
              </div>
              {csvFile && (
                <button
                  type="button"
                  onClick={() => {
                    setCsvFile(null);
                    setCsvText('');
                    resetBatchProgress();
                  }}
                  disabled={submitting}
                  className="text-[11px] font-medium text-slate-500 hover:text-red-700 shrink-0 disabled:opacity-50"
                >
                  Clear
                </button>
              )}
            </div>

            <label
              className={`w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border transition-colors cursor-pointer text-center ${
                csvFile
                  ? 'bg-[#EFF8F8] text-teal-800 border-teal-300 hover:bg-teal-50'
                  : 'bg-teal-700 text-white border-teal-700 hover:bg-teal-800'
              }`}
            >
              <Upload className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">
                {csvFile ? 'Change CSV File' : 'Select CSV File'}
              </span>
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={handleFileSelect}
                disabled={submitting}
                className="sr-only"
              />
            </label>

            <p className="text-[11px] font-mono text-slate-500 truncate">
              {csvFile
                ? `${csvFile.name} (${totalDataRows.toLocaleString()} rows)`
                : 'Required · .csv (comma or semicolon)'}
            </p>
          </div>

          {/* Right 50%: Select File Attachments ZIP (only rendered for models with attachment fields) */}
          {urlFields.length > 0 && (
            <div className="flex flex-col justify-between p-3 rounded-lg bg-white border border-slate-200 space-y-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Archive className="w-4 h-4 text-teal-700 shrink-0" />
                  <span className="text-xs font-semibold text-slate-900 truncate">
                    File Attachments (ZIP)
                  </span>
                </div>
                {zipFile && (
                  <button
                    type="button"
                    onClick={() => setZipFile(null)}
                    disabled={submitting}
                    className="text-[11px] font-medium text-slate-500 hover:text-red-700 shrink-0 disabled:opacity-50"
                  >
                    Clear
                  </button>
                )}
              </div>

              <label
                className={`w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border transition-colors cursor-pointer text-center ${
                  zipFile
                    ? 'bg-[#EFF8F8] text-teal-800 border-teal-300 hover:bg-teal-50'
                    : 'bg-white text-teal-800 border-teal-300 hover:bg-teal-50'
                }`}
              >
                <Archive className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">
                  {zipFile ? 'Change Attachment ZIP' : 'Select Attachment ZIP'}
                </span>
                <input
                  type="file"
                  accept=".zip,application/zip,application/x-zip-compressed"
                  onChange={handleZipSelect}
                  disabled={submitting}
                  className="sr-only"
                />
              </label>

              <p className="text-[11px] font-mono text-slate-500 truncate">
                {zipFile
                  ? `${zipFile.name} (${sanitizedZipEntries.length} file${sanitizedZipEntries.length === 1 ? '' : 's'})`
                  : 'Optional · .zip named by Excel row'}
              </p>
            </div>
          )}
        </div>

        {urlFields.length > 0 && (
          <div className="pt-1 border-t border-slate-200/80 text-[11px] text-slate-600 leading-relaxed space-y-0.5">
            <p>
              Name files in your ZIP using the exact Excel row number (Row 1 is headers;
              Row 2 is your first item). Example: Row 2 &rarr;{' '}
              <span className="font-mono text-slate-900">2.jpg</span> or{' '}
              <span className="font-mono text-slate-900">2-1.jpg</span>,{' '}
              <span className="font-mono text-slate-900">2-2.jpg</span>.
            </p>
            <p className="text-slate-500">
              Auto-compressed &amp; saved as{' '}
              <span className="font-mono text-teal-800">{meta.prefix}-YY-XXXX-1.jpg</span>,{' '}
              <span className="font-mono text-teal-800">-2.jpg</span>.
              {importMode === 'update' && (
                <>
                  {' '}
                  In Update mode, matched ZIP files are{' '}
                  <span className="font-semibold text-slate-700">added</span> to{' '}
                  <span className="font-mono">list_url_image</span> or{' '}
                  <span className="font-semibold text-slate-700">replace</span> single URL fields.
                </>
              )}
            </p>
          </div>
        )}
      </div>

      {/* CSV Preview / Paste (automatically switches to compact card for >1,000-row files) */}
      <div>
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <label className="block text-xs font-medium text-slate-700">
            CSV Content Preview / Paste
          </label>
          {totalDataRows > 0 && (
            <span className="text-[11px] font-mono text-slate-500 tabular-nums">
              {totalDataRows.toLocaleString()} {totalDataRows === 1 ? 'row' : 'rows'}
              {isMultiBatch
                ? ` · ${totalBatches} batches of ${CSV_IMPORT_BATCH_SIZE} (no row limit)`
                : ''}
            </span>
          )}
        </div>

        {csvFile && totalDataRows > 1000 ? (
          <div className="px-3.5 py-3 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-slate-900 truncate">
                {csvFile.name}
              </p>
              <p className="text-[11px] font-mono text-slate-600 tabular-nums">
                {totalDataRows.toLocaleString()} rows ({formatBytes(csvFile.size)}) &middot;{' '}
                {totalBatches} sequential batches of up to {CSV_IMPORT_BATCH_SIZE} rows
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setCsvFile(null);
                setCsvText('');
                resetBatchProgress();
              }}
              disabled={submitting}
              className="px-2.5 py-1.5 text-xs text-slate-600 hover:text-slate-900 bg-white border border-slate-200 rounded-md shrink-0 disabled:opacity-50"
            >
              Clear File
            </button>
          </div>
        ) : (
          <textarea
            rows={6}
            value={csvText}
            onChange={(e) => {
              setCsvText(e.target.value);
              setCsvFile(null);
              resetBatchProgress();
            }}
            placeholder={`${activeSampleHeaders}\n`}
            className="w-full px-3 py-2 text-xs font-mono bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600/30 focus:border-teal-700"
          />
        )}
      </div>

      {/* Multi-Batch Progress Bar (shown whenever CSV exceeds 500 rows) */}
      {isMultiBatch && (
        <div className="p-3.5 rounded-lg bg-[#F5FAFA] border border-teal-200 space-y-2">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="font-semibold text-teal-900 flex items-center gap-1.5">
              {isAllBatchesDone && (
                <CheckCircle2 className="w-4 h-4 text-teal-700 shrink-0" />
              )}
              {isAllBatchesDone
                ? `All ${totalBatches} batches completed`
                : nextBatchIndex === 0
                  ? `Large CSV ready — ${totalBatches} batches of up to ${CSV_IMPORT_BATCH_SIZE} rows`
                  : `Batch ${nextBatchIndex} of ${totalBatches} completed · ${remainingRows.toLocaleString()} rows remaining`}
            </span>
            <span className="font-mono text-[11px] text-teal-800 tabular-nums">
              {processedRows.toLocaleString()} / {totalDataRows.toLocaleString()} rows
            </span>
          </div>
          <div className="w-full h-2 rounded-full bg-teal-100 overflow-hidden">
            <div
              className="h-full bg-teal-700 transition-all duration-300"
              style={{
                width: `${
                  totalDataRows > 0
                    ? Math.min(100, Math.round((processedRows / totalDataRows) * 100))
                    : 0
                }%`,
              }}
            />
          </div>
          {!isAllBatchesDone && currentBatch && (
            <p className="text-[11px] text-slate-600">
              Next up: <span className="font-semibold text-slate-800">Batch {currentBatch.batchNumber} of {totalBatches}</span>{' '}
              (Excel Rows {currentBatch.excelRowStart.toLocaleString()}–{currentBatch.excelRowEnd.toLocaleString()},{' '}
              {currentBatch.rowCount} rows). Excel row numbers for ZIP attachment matching stay exact across every batch.
            </p>
          )}
        </div>
      )}

      {/* Dry-Run Preview & Pre-Upload File Health Check */}
      {(dryRunPreview || fileHealth) && !isAllBatchesDone && (
        <div className="p-3.5 rounded-lg bg-white border border-slate-200 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-slate-900">
              {isMultiBatch && dryRunPreview
                ? `Dry-Run Preview — Batch ${dryRunPreview.batchNumber} of ${totalBatches}`
                : 'Dry-Run Import Preview'}
            </p>
            {dryRunPreview && (
              <span className="text-[11px] font-mono text-slate-500 tabular-nums">
                {dryRunPreview.rows.length}{' '}
                {dryRunPreview.rows.length === 1 ? 'row' : 'rows'} (Rows{' '}
                {dryRunPreview.excelRowStart.toLocaleString()}–
                {dryRunPreview.excelRowEnd.toLocaleString()})
                {urlFields.length > 0 &&
                  ` · ${dryRunPreview.totalAttachments} attachment${
                    dryRunPreview.totalAttachments === 1 ? '' : 's'
                  } matched`}
              </span>
            )}
          </div>

          {/* Pre-Upload CSV File Health Check */}
          {fileHealth && (
            <>
              {fileHealth.isHealthy && fileHealth.headerWarnings.length === 0 ? (
                <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-[#EFF8F8] border border-teal-200 text-xs text-teal-900">
                  <CheckCircle2 className="w-4 h-4 text-teal-700 shrink-0" />
                  <span>
                    <span className="font-semibold">File check passed:</span> All{' '}
                    {fileHealth.totalDataRows.toLocaleString()} rows &amp;{' '}
                    {fileHealth.headers.length} columns look valid (delimiter:{' '}
                    <span className="font-mono">
                      {fileHealth.delimiter === '\t'
                        ? 'TAB'
                        : `"${fileHealth.delimiter}"`}
                    </span>
                    ).
                  </span>
                </div>
              ) : (
                <div className="space-y-2">
                  {(fileHealth.headerErrors.length > 0 ||
                    fileHealth.rowIssues.length > 0) && (
                    <div
                      role="alert"
                      className="px-3 py-2.5 rounded-md bg-red-50 border border-red-200 text-xs text-red-900 space-y-1.5"
                    >
                      <div className="flex items-start gap-2">
                        <AlertTriangle className="w-4 h-4 text-red-700 shrink-0 mt-0.5" />
                        <div className="space-y-1 min-w-0 flex-1">
                          <p className="font-semibold">
                            Uploaded CSV has{' '}
                            {fileHealth.headerErrors.length +
                              fileHealth.rowIssues.length}{' '}
                            issue
                            {fileHealth.headerErrors.length +
                              fileHealth.rowIssues.length ===
                            1
                              ? ''
                              : 's'}{' '}
                            detected before upload
                          </p>
                          {fileHealth.headerErrors.map((msg, idx) => (
                            <p key={`he-${idx}`} className="text-red-800">
                              &bull; {msg}
                            </p>
                          ))}
                          {fileHealth.rowIssues.length > 0 && (
                            <ul className="max-h-28 overflow-y-auto space-y-0.5 pt-0.5 font-mono text-[11px] text-red-800">
                              {fileHealth.rowIssues.slice(0, 25).map((issue, idx) => (
                                <li key={`ri-${issue.excelRow}-${idx}`}>
                                  Row {issue.excelRow}
                                  {issue.rowHint ? ` (${issue.rowHint})` : ''}:{' '}
                                  {issue.message}
                                </li>
                              ))}
                              {fileHealth.rowIssues.length > 25 && (
                                <li className="text-red-700 font-sans font-medium pt-0.5">
                                  +{(fileHealth.rowIssues.length - 25).toLocaleString()} more row issue(s) across the file.
                                </li>
                              )}
                            </ul>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {fileHealth.headerWarnings.length > 0 && (
                    <div
                      role="alert"
                      className="flex items-start gap-2 px-3 py-2 rounded-md bg-amber-50 border border-amber-300 text-xs text-amber-900"
                    >
                      <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                      <div className="space-y-0.5">
                        {fileHealth.headerWarnings.map((msg, idx) => (
                          <p key={`hw-${idx}`}>{msg}</p>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {/* Warnings for Row 1 files & Out-of-range ZIP files */}
          {dryRunPreview && dryRunPreview.warnings.rowOneFiles.length > 0 && (
            <div
              role="alert"
              className="flex items-start gap-2 px-3 py-2 rounded-md bg-amber-50 border border-amber-300 text-xs text-amber-900"
            >
              <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold">Row 1 warning:</span> ZIP contains files
                starting with <span className="font-mono">1.</span> or{' '}
                <span className="font-mono">1-</span> (
                <span className="font-mono">
                  {dryRunPreview.warnings.rowOneFiles.slice(0, 5).join(', ')}
                </span>
                ). Row 1 is the CSV header — item rows start at <span className="font-semibold">Row 2</span>.
              </div>
            </div>
          )}

          {dryRunPreview && dryRunPreview.warnings.outOfRangeFiles.length > 0 && (
            <div
              role="alert"
              className="flex items-start gap-2 px-3 py-2 rounded-md bg-amber-50 border border-amber-300 text-xs text-amber-900"
            >
              <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold">Out-of-range ZIP files:</span> These files
                reference row numbers past the last CSV row (Row{' '}
                {dryRunPreview.fullMaxExcelRow.toLocaleString()}):{' '}
                <span className="font-mono">
                  {dryRunPreview.warnings.outOfRangeFiles
                    .slice(0, 6)
                    .map((f) => f.fileName)
                    .join(', ')}
                </span>
                .
              </div>
            </div>
          )}

          {/* Row-by-row summary list */}
          {dryRunPreview && (
            <div className="max-h-44 overflow-y-auto divide-y divide-slate-100 border border-slate-100 rounded-md">
              {dryRunPreview.rows.slice(0, 40).map((row) => {
                const rowProblems = fileHealth?.rowIssuesByExcelRow.get(row.excelRow);
                return (
                  <div
                    key={`${row.excelRow}-${row.targetId}`}
                    className={`px-3 py-1.5 text-xs space-y-0.5 ${
                      rowProblems ? 'bg-red-50/70' : ''
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-slate-800">
                        Row {row.excelRow} &rarr;{' '}
                        <span className="font-semibold text-teal-800">{row.targetId}</span>
                      </span>
                      <span className="text-[11px] text-slate-600 tabular-nums">
                        {rowProblems && rowProblems.length > 0 ? (
                          <span className="text-red-700 font-medium">
                            {rowProblems[0]}
                          </span>
                        ) : row.missingTokens.length > 0 ? (
                          <span className="text-red-700 font-medium">
                            Missing: {row.missingTokens.join(', ')}
                          </span>
                        ) : row.mergeMode === 'update_append' ? (
                          <span className="text-teal-800 font-medium">
                            +{row.matchedCount} added to {row.existingUrlCount} existing
                          </span>
                        ) : row.mergeMode === 'update_replace' ? (
                          <span className="text-amber-800 font-medium">
                            Replaces existing image ({row.matchedCount} matched)
                          </span>
                        ) : row.matchedCount > 0 ? (
                          <span className="text-teal-800 font-medium">
                            {row.matchedCount} attachment{row.matchedCount === 1 ? '' : 's'} matched
                          </span>
                        ) : (
                          <span className="text-slate-400">
                            {row.action === 'update' ? 'Update row' : 'Insert row'}
                            {row.existingUrlCount > 0
                              ? ` (${row.existingUrlCount} existing kept)`
                              : ''}
                          </span>
                        )}
                      </span>
                    </div>
                    {row.renamedSamples.length > 0 && (
                      <p className="text-[11px] font-mono text-slate-500 truncate">
                        {row.renamedSamples.slice(0, 4).join(' · ')}
                        {row.renamedSamples.length > 4
                          ? ` · +${row.renamedSamples.length - 4} more`
                          : ''}
                      </p>
                    )}
                  </div>
                );
              })}
              {dryRunPreview.rows.length > 40 && (
                <div className="px-3 py-1.5 text-[11px] text-slate-500 bg-slate-50">
                  Showing first 40 of {dryRunPreview.rows.length} rows in this batch.
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="px-3.5 py-2.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800"
        >
          {error}
        </div>
      )}

      {cumulativeResult && (
        <div className="px-4 py-3 rounded-lg bg-[#EFF8F8] border border-teal-200 text-xs text-slate-800 space-y-2">
          <p className="font-semibold text-teal-900 tabular-nums">
            {isMultiBatch
              ? `Cumulative (${cumulativeResult.completedBatches}/${totalBatches} batches): `
              : ''}
            Inserted {cumulativeResult.createdCount.toLocaleString()} &middot; Updated{' '}
            {cumulativeResult.updatedCount.toLocaleString()}
            {cumulativeResult.ledgerPostedCount > 0
              ? ` · Auto-posted ${cumulativeResult.ledgerPostedCount.toLocaleString()} to Ledger (SYSTEM_AUTO)`
              : ''}
            {cumulativeResult.errorCount > 0
              ? ` · ${cumulativeResult.errorCount.toLocaleString()} failed`
              : ''}
          </p>

          {(cumulativeResult.logCreateIds.length > 0 ||
            cumulativeResult.logUpdateIds.length > 0) && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-0.5">
              {cumulativeResult.logCreateIds.slice(-3).map((logId) =>
                worker.role === 'master' ? (
                  <button
                    key={logId}
                    type="button"
                    onClick={() =>
                      openLayer({
                        kind: 'inspect',
                        entity: 'logs',
                        recordId: logId,
                      })
                    }
                    className="inline-flex items-center gap-1 font-mono text-[11px] font-semibold text-teal-700 hover:underline"
                  >
                    <History className="w-3 h-3" />
                    Create Log: {logId}
                    <ExternalLink className="w-3 h-3" />
                  </button>
                ) : (
                  <span
                    key={logId}
                    className="inline-flex items-center gap-1 font-mono text-[11px] text-slate-600"
                  >
                    <History className="w-3 h-3" />
                    Create Log: {logId}
                  </span>
                )
              )}
              {cumulativeResult.logUpdateIds.slice(-3).map((logId) =>
                worker.role === 'master' ? (
                  <button
                    key={logId}
                    type="button"
                    onClick={() =>
                      openLayer({
                        kind: 'inspect',
                        entity: 'logs',
                        recordId: logId,
                      })
                    }
                    className="inline-flex items-center gap-1 font-mono text-[11px] font-semibold text-teal-700 hover:underline"
                  >
                    <History className="w-3 h-3" />
                    Update Log: {logId}
                    <ExternalLink className="w-3 h-3" />
                  </button>
                ) : (
                  <span
                    key={logId}
                    className="inline-flex items-center gap-1 font-mono text-[11px] text-slate-600"
                  >
                    <History className="w-3 h-3" />
                    Update Log: {logId}
                  </span>
                )
              )}
            </div>
          )}

          {cumulativeResult.errors.length > 0 && (
            <ul className="list-disc pl-4 text-red-700 space-y-0.5 max-h-32 overflow-y-auto">
              {cumulativeResult.errors.slice(0, 10).map((e, idx) => (
                <li key={`${e.row}-${idx}`}>
                  Row {e.row}: {e.error}
                </li>
              ))}
              {cumulativeResult.errors.length > 10 && (
                <li className="list-none text-[11px] text-red-600">
                  +{cumulativeResult.errors.length - 10} more row error(s)
                </li>
              )}
            </ul>
          )}
        </div>
      )}

      <div className="pt-4 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2.5">
        <div>
          {cumulativeResult && nextBatchIndex > 0 && (
            <button
              type="button"
              onClick={resetBatchProgress}
              disabled={submitting}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-50 rounded-lg"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset Progress
            </button>
          )}
        </div>
        <div className="flex items-center gap-2.5 ml-auto">
          <button
            type="button"
            onClick={popLayer}
            className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg"
          >
            Close
          </button>
          <button
            type="submit"
            disabled={submitting || isAllBatchesDone}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-60 rounded-lg whitespace-nowrap"
          >
            <Upload className="w-3.5 h-3.5" />
            {submitting
              ? compressionStatus ||
                (isMultiBatch && currentBatch
                  ? `Importing Batch ${currentBatch.batchNumber} of ${totalBatches}...`
                  : 'Processing...')
              : isAllBatchesDone
                ? `All ${totalDataRows.toLocaleString()} Rows Imported`
                : isMultiBatch && currentBatch
                  ? nextBatchIndex === 0
                    ? `Import First ${currentBatch.rowCount} Rows (Batch 1 of ${totalBatches})`
                    : `Continue Next Batch (Rows ${currentBatch.excelRowStart.toLocaleString()}–${currentBatch.excelRowEnd.toLocaleString()} · ${remainingRows.toLocaleString()} left)`
                  : importMode === 'update'
                    ? 'Run Update / Upsert'
                    : 'Run Insert Import'}
          </button>
        </div>
      </div>
    </form>
  );
}

// ============================================================================
// 4. Worker Profile & Permissions Layer (Self-Editable by All Logged-In Workers)
// ============================================================================
function ProfileLayerBody({
  worker,
  onProfileUpdated,
  onSignOut,
}: {
  worker: WorkerRecord;
  onProfileUpdated: (res: AuthProfileUpdateResponse) => void;
  onSignOut: () => void;
}) {
  const { closeAllLayers, notifyDataChanged } = useNavigation();
  const { notifySuccess } = useFeedback();

  const [name, setName] = useState(worker.name || '');
  const [email, setEmail] = useState(worker.email || '');
  const [phone, setPhone] = useState(worker.phone || '');
  const [displayPictureUrl, setDisplayPictureUrl] = useState(
    worker.display_picture_url || ''
  );
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setName(worker.name || '');
    setEmail(worker.email || '');
    setPhone(worker.phone || '');
    setDisplayPictureUrl(worker.display_picture_url || '');
  }, [worker]);

  const permissionSummary: Record<WorkerRecord['role'], string> = {
    master:
      'Full ERP access across Dashboard summary reports, Worker & Client management, Master Data, Operational schedules & pickups, Audit Logs, and all Documents.',
    admin:
      'Can create, edit, and delete records they created across Clients, Branches, Items, Operational, and Documents. Executive Dashboard reports are hidden.',
    marketing:
      'Scoped view of assigned Clients & Branches, Marketing Commissions, Pickup Schedules, and Unpaid Invoices.',
    worker:
      'Field Operations access limited to creating, editing, and managing Pickup Data records.',
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploadingAvatar(true);
    setError(null);
    try {
      const compressed = await compressImageFile(file, {
        maxDimension: 800,
        quality: 0.8,
      });
      const uploaded = await api.uploadOwnAvatar(compressed.file);
      setDisplayPictureUrl(uploaded.url);
      const sizeNote = compressed.wasCompressed
        ? ` (${formatBytes(compressed.originalSize)} → ${formatBytes(compressed.compressedSize)})`
        : '';
      notifySuccess(`Uploaded ${uploaded.fileName}${sizeNote}. Click Save Profile to apply.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload image.');
    } finally {
      setUploadingAvatar(false);
    }
  };

  const normalizedCurrentEmail = (worker.email || '').trim().toLowerCase();
  const normalizedNextEmail = email.trim().toLowerCase();
  const willRequireEmailConfirm =
    Boolean(normalizedNextEmail) && normalizedNextEmail !== normalizedCurrentEmail;

  const isDirty =
    name.trim() !== (worker.name || '').trim() ||
    normalizedNextEmail !== normalizedCurrentEmail ||
    phone.trim() !== (worker.phone || '').trim() ||
    displayPictureUrl.trim() !== (worker.display_picture_url || '').trim();

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Name cannot be empty.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await api.updateOwnProfile({
        name: name.trim(),
        email: email.trim() || null,
        phone: phone.trim() || null,
        display_picture_url: displayPictureUrl.trim() || null,
      });
      onProfileUpdated(res);
      notifyDataChanged();
      notifySuccess(res.message || 'Profile updated successfully.');
      if (res.requiresEmailConfirmation) {
        closeAllLayers();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update profile.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSaveProfile} className="p-6 space-y-6">
      <div className="flex items-center gap-4">
        <SafeImage
          src={displayPictureUrl}
          alt={name || worker.name}
          className="w-14 h-14 rounded-xl object-cover border border-slate-200 shrink-0"
          fallback={
            <div className="w-14 h-14 rounded-xl bg-[#EAF5F5] text-teal-800 font-display font-bold text-lg flex items-center justify-center shrink-0">
              {(name || worker.name).slice(0, 2).toUpperCase()}
            </div>
          }
        />
        <div className="min-w-0">
          <p className="font-mono text-xs font-semibold text-teal-700">
            {worker.id}
          </p>
          <h3 className="font-display text-lg font-bold text-slate-900 truncate">
            {name || worker.name}
          </h3>
          <p className="text-xs text-slate-500 capitalize">
            {worker.role} role &middot; @{worker.username}
          </p>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="px-3.5 py-2.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800"
        >
          {error}
        </div>
      )}

      <div className="space-y-4 pt-4 border-t border-slate-200">
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1.5">
            Display Picture <span className="text-slate-400 font-normal">(optional)</span>
          </label>
          <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 space-y-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <label
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors cursor-pointer whitespace-nowrap ${
                  uploadingAvatar
                    ? 'bg-slate-100 text-slate-400 border-slate-200 pointer-events-none'
                    : 'bg-white text-teal-800 border-teal-300 hover:bg-teal-50'
                }`}
              >
                <Upload className="w-3.5 h-3.5" />
                <span>
                  {uploadingAvatar
                    ? 'Uploading...'
                    : displayPictureUrl.trim()
                      ? 'Upload New Image'
                      : 'Upload Image'}
                </span>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif,.png,.jpg,.jpeg,.webp,.gif"
                  onChange={handleAvatarUpload}
                  disabled={uploadingAvatar}
                  className="sr-only"
                />
              </label>

              {displayPictureUrl.trim() && (
                <button
                  type="button"
                  onClick={() => setDisplayPictureUrl('')}
                  disabled={uploadingAvatar}
                  className="px-2.5 py-1.5 text-xs font-medium text-red-700 bg-white border border-red-200 hover:bg-red-50 rounded-lg transition-colors"
                >
                  Remove
                </button>
              )}
            </div>
            <input
              type="text"
              value={displayPictureUrl}
              onChange={(e) => setDisplayPictureUrl(e.target.value)}
              placeholder="Or paste image / Google Drive URL (https://... or /uploads/...)"
              className="w-full px-3 py-1.5 text-xs font-mono bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600/30 focus:border-teal-700"
            />
            {isGoogleDriveLink(displayPictureUrl) && (
              <p className="text-[11px] text-teal-800">
                Google Drive link detected — automatically rendered with{' '}
                <span className="font-mono">no-referrer</span>. Ensure Drive sharing is set to &ldquo;Anyone with the link&rdquo;.
              </p>
            )}
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1.5">
            Full Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            placeholder="Your full name"
            className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600/30 focus:border-teal-700"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1.5">
            Email{' '}
            {worker.role !== 'master' && (
              <span className="text-slate-400 font-normal">(optional)</span>
            )}
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required={worker.role === 'master'}
            placeholder="name@company.co.id"
            className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600/30 focus:border-teal-700"
          />
          {willRequireEmailConfirm && (
            <p className="mt-1.5 text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-2.5 py-1.5 leading-relaxed">
              Adding or changing your email sends a verification link and locks your dashboard until the new email is confirmed.
            </p>
          )}
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1.5">
            Phone <span className="text-slate-400 font-normal">(optional)</span>
          </label>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+62 812-3456-7890"
            className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600/30 focus:border-teal-700"
          />
        </div>
      </div>

      <div className="pt-4 border-t border-slate-200 space-y-2">
        <p className="text-xs font-medium text-slate-500">Access Scope</p>
        <p className="text-xs text-slate-600 leading-relaxed">
          {permissionSummary[worker.role]}
        </p>
      </div>

      <div className="pt-4 border-t border-slate-200 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onSignOut}
          className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-red-700 bg-white border border-red-200 hover:bg-red-50 rounded-lg transition-colors whitespace-nowrap"
        >
          <LogOut className="w-3.5 h-3.5" />
          Sign Out
        </button>

        <button
          type="submit"
          disabled={saving || uploadingAvatar || !isDirty}
          className="px-4 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap"
        >
          {saving ? 'Saving...' : 'Save Profile'}
        </button>
      </div>
    </form>
  );
}
