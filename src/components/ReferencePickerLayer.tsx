import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  ExternalLink,
  Image as ImageIcon,
  Plus,
  Search,
  X,
} from 'lucide-react';
import { api, formatStatusLabel, statusTextClass } from '../lib/api.ts';
import { useNavigation } from '../lib/navigation.tsx';
import { ENTITY_META, canMutateEntity } from '../shared/entityMeta.ts';
import {
  rankEntityRecords,
  type EntityDisplaySummary,
} from '../shared/fuzzySearch.ts';
import type { AnyEntityRecord, EntityKey, WorkerRecord } from '../shared/types.ts';
import { SafeImage } from './SafeImage.tsx';
import { LayerSkeleton } from './Skeleton.tsx';

export interface ReferencePickerLayerBodyProps {
  entity: EntityKey;
  multiple?: boolean;
  selectedIds: string[];
  filterRecord?: (record: AnyEntityRecord) => boolean;
  onSelect: (ids: string[], selectedRecords: AnyEntityRecord[]) => void;
  worker: WorkerRecord;
}

type SortMode = 'best' | 'alpha' | 'newest';

const PAGE_CHUNK = 80;

export function ReferencePickerLayerBody({
  entity,
  multiple = false,
  selectedIds,
  filterRecord,
  onSelect,
  worker,
}: ReferencePickerLayerBodyProps) {
  const { openLayer, popLayer, dataVersion } = useNavigation();
  const meta = ENTITY_META[entity];
  const canCreateNew = canMutateEntity(worker.role, entity);

  const [records, setRecords] = useState<AnyEntityRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('best');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [draftSelected, setDraftSelected] = useState<string[]>(() => selectedIds);
  const [activeIndex, setActiveIndex] = useState(0);
  const [visibleLimit, setVisibleLimit] = useState(PAGE_CHUNK);

  const searchInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setDraftSelected(selectedIds);
  }, [selectedIds]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    api
      .listRecords(entity, { lookup: true })
      .then((res) => {
        if (!active) return;
        const filtered = filterRecord
          ? res.records.filter(filterRecord)
          : res.records;
        setRecords(filtered);
      })
      .catch((err) => {
        if (!active) return;
        setError(
          err instanceof Error
            ? err.message
            : `Failed to load ${meta.plural.toLowerCase()}.`
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [entity, filterRecord, dataVersion, meta.plural]);

  // Auto-focus search input once loaded
  useEffect(() => {
    if (!loading) {
      requestAnimationFrame(() => searchInputRef.current?.focus());
    }
  }, [loading]);

  // Reset pagination & highlight cursor when search or filters change
  useEffect(() => {
    setActiveIndex(0);
    setVisibleLimit(PAGE_CHUNK);
  }, [query, statusFilter, sortMode]);

  // Collect available status/data_type quick filter values if applicable
  const quickFilterInfo = useMemo(() => {
    if (meta.statusField) {
      const statusFieldDef = meta.fields.find((f) => f.key === meta.statusField);
      if (statusFieldDef?.options?.length) {
        return {
          key: meta.statusField,
          options: statusFieldDef.options,
        };
      }
    }
    if (entity === 'pickup_data') {
      const dtField = meta.fields.find((f) => f.key === 'data_type');
      if (dtField?.options?.length) {
        return {
          key: 'data_type',
          options: dtField.options,
        };
      }
    }
    return null;
  }, [entity, meta.fields, meta.statusField]);

  const recordMap = useMemo(
    () => new Map(records.map((r) => [r.id, r])),
    [records]
  );

  const prefilteredRecords = useMemo(() => {
    if (!quickFilterInfo || statusFilter === 'all') return records;
    return records.filter((r) => {
      const val = String((r as unknown as Record<string, unknown>)[quickFilterInfo.key] || '');
      return val === statusFilter;
    });
  }, [records, quickFilterInfo, statusFilter]);

  const rankedResults = useMemo(() => {
    const trimmed = query.trim();
    const ranked = rankEntityRecords(entity, prefilteredRecords, trimmed);

    if (trimmed && sortMode === 'best') {
      return ranked;
    }

    const sorted = [...ranked];
    if (sortMode === 'alpha') {
      sorted.sort((a, b) => {
        const keyA = a.summary.code || a.summary.title || a.summary.id;
        const keyB = b.summary.code || b.summary.title || b.summary.id;
        return keyA.localeCompare(keyB, undefined, { numeric: true });
      });
    } else if (sortMode === 'newest') {
      sorted.sort((a, b) => {
        const tA = String(a.record.created_at || '');
        const tB = String(b.record.created_at || '');
        if (tA !== tB) return tB.localeCompare(tA);
        return b.record.id.localeCompare(a.record.id, undefined, { numeric: true });
      });
    } else {
      // Default browse order when query is empty: selected items first, then natural code/title order
      const selectedSet = new Set(draftSelected);
      sorted.sort((a, b) => {
        const aSel = selectedSet.has(a.record.id) ? 0 : 1;
        const bSel = selectedSet.has(b.record.id) ? 0 : 1;
        if (aSel !== bSel) return aSel - bSel;
        const keyA = a.summary.code || a.summary.title || a.summary.id;
        const keyB = b.summary.code || b.summary.title || b.summary.id;
        return keyA.localeCompare(keyB, undefined, { numeric: true });
      });
    }

    return sorted;
  }, [entity, prefilteredRecords, query, sortMode, draftSelected]);

  const visibleResults = useMemo(
    () => rankedResults.slice(0, visibleLimit),
    [rankedResults, visibleLimit]
  );

  const selectedSet = useMemo(() => new Set(draftSelected), [draftSelected]);

  const handleRowPick = (record: AnyEntityRecord) => {
    if (!multiple) {
      onSelect([record.id], [record]);
      popLayer();
      return;
    }

    setDraftSelected((prev) =>
      prev.includes(record.id)
        ? prev.filter((id) => id !== record.id)
        : [...prev, record.id]
    );
  };

  const handleConfirmMultiple = () => {
    const chosenRecords = draftSelected
      .map((id) => recordMap.get(id))
      .filter((r): r is AnyEntityRecord => Boolean(r));
    onSelect(draftSelected, chosenRecords);
    popLayer();
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (visibleResults.length > 0) {
        setActiveIndex((prev) => Math.min(visibleResults.length - 1, prev + 1));
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (visibleResults.length > 0) {
        setActiveIndex((prev) => Math.max(0, prev - 1));
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const target = visibleResults[activeIndex] || visibleResults[0];
      if (target) {
        handleRowPick(target.record);
      }
    }
  };

  if (loading && records.length === 0) {
    return <LayerSkeleton />;
  }

  const trimmedQuery = query.trim();

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Sticky Search & Filter Header */}
      <div className="px-6 py-4 border-b border-slate-200 bg-[#F8FAFB] space-y-3 shrink-0">
        {/* Flexible Similarity Search Input */}
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            ref={searchInputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder={
              entity === 'items'
                ? 'Search by code, title, description, packaging, or note (flexible similarity)...'
                : `Search ${meta.plural.toLowerCase()} by ID, name, or details (flexible similarity)...`
            }
            aria-label={`Search ${meta.plural}`}
            className="w-full pl-10 pr-9 py-2.5 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-600/30 focus:border-teal-700"
          />
          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery('');
                searchInputRef.current?.focus();
              }}
              aria-label="Clear search"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Controls Bar: Count + Sort + Quick Create */}
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <div className="text-xs text-slate-500 tabular-nums">
            {trimmedQuery ? (
              <>
                <span className="font-semibold text-slate-800">
                  {rankedResults.length}
                </span>{' '}
                {rankedResults.length === 1 ? 'closest match' : 'closest matches'}
                <span className="mx-1.5 text-slate-300" aria-hidden="true">
                  &middot;
                </span>
                <span>ranked by similarity</span>
              </>
            ) : (
              <>
                <span className="font-semibold text-slate-800">
                  {rankedResults.length}
                </span>{' '}
                {rankedResults.length === 1
                  ? meta.singular.toLowerCase()
                  : meta.plural.toLowerCase()}{' '}
                available
              </>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Segmented Sort Control */}
            <div className="inline-flex items-center p-0.5 bg-slate-200/70 rounded-lg">
              {(
                [
                  { id: 'best', label: trimmedQuery ? 'Best Match' : 'Default' },
                  { id: 'alpha', label: 'A–Z' },
                  { id: 'newest', label: 'Newest' },
                ] as Array<{ id: SortMode; label: string }>
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setSortMode(opt.id)}
                  className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                    sortMode === opt.id
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {canCreateNew && (
              <button
                type="button"
                onClick={() => openLayer({ kind: 'create', entity })}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-teal-800 bg-white border border-teal-300 hover:bg-[#EFF8F8] rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                New {meta.singular}
              </button>
            )}
          </div>
        </div>

        {/* Optional Status / Data-Type Quick Filter */}
        {quickFilterInfo && (
          <div className="flex flex-wrap items-center gap-1 pt-0.5">
            <button
              type="button"
              onClick={() => setStatusFilter('all')}
              className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap ${
                statusFilter === 'all'
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:bg-slate-200/70'
              }`}
            >
              All
            </button>
            {quickFilterInfo.options.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setStatusFilter(opt.value)}
                className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap ${
                  statusFilter === opt.value
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:bg-slate-200/70'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Error State */}
      {error && (
        <div className="mx-6 mt-4 px-3.5 py-2.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800">
          {error}
        </div>
      )}

      {/* Results List */}
      <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
        {visibleResults.length === 0 ? (
          <div className="px-6 py-14 text-center space-y-2.5">
            <p className="text-sm font-medium text-slate-800">
              {trimmedQuery
                ? `No similar ${meta.plural.toLowerCase()} found for "${trimmedQuery}".`
                : `No ${meta.plural.toLowerCase()} available yet.`}
            </p>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              {trimmedQuery
                ? 'Try fewer keywords, a partial item code, or clear the active filter.'
                : `Create a new ${meta.singular.toLowerCase()} to link it here.`}
            </p>
            <div className="pt-2 flex items-center justify-center gap-2">
              {trimmedQuery && (
                <button
                  type="button"
                  onClick={() => {
                    setQuery('');
                    setStatusFilter('all');
                    searchInputRef.current?.focus();
                  }}
                  className="px-3.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg"
                >
                  Clear Search
                </button>
              )}
              {canCreateNew && (
                <button
                  type="button"
                  onClick={() => openLayer({ kind: 'create', entity })}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Create {meta.singular}
                </button>
              )}
            </div>
          </div>
        ) : (
          <>
            {visibleResults.map(({ record, summary }, idx) => {
              const isSelected = selectedSet.has(record.id);
              const isHighlighted = idx === activeIndex;

              return (
                <PickerResultRow
                  key={record.id}
                  entity={entity}
                  record={record}
                  summary={summary}
                  multiple={multiple}
                  isSelected={isSelected}
                  isHighlighted={isHighlighted}
                  onMouseEnter={() => setActiveIndex(idx)}
                  onPick={() => handleRowPick(record)}
                  onInspect={() =>
                    openLayer({
                      kind: 'inspect',
                      entity,
                      recordId: record.id,
                    })
                  }
                />
              );
            })}

            {rankedResults.length > visibleLimit && (
              <div className="px-6 py-4 bg-slate-50/70 flex items-center justify-between gap-3">
                <span className="text-xs text-slate-500 tabular-nums">
                  Showing {visibleResults.length} of {rankedResults.length} results
                </span>
                <button
                  type="button"
                  onClick={() => setVisibleLimit((prev) => prev + PAGE_CHUNK)}
                  className="px-3.5 py-1.5 text-xs font-semibold text-teal-800 bg-white border border-teal-300 hover:bg-[#EFF8F8] rounded-lg transition-colors whitespace-nowrap"
                >
                  Show {Math.min(PAGE_CHUNK, rankedResults.length - visibleLimit)} More
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer Bar: Multi-Select Confirm OR Single-Select Keyboard Hint */}
      {multiple ? (
        <div className="px-6 py-3.5 border-t border-slate-200 bg-white flex items-center justify-between gap-3 shrink-0">
          <div className="text-xs text-slate-600 tabular-nums">
            <span className="font-semibold text-slate-900">
              {draftSelected.length}
            </span>{' '}
            selected
          </div>
          <div className="flex items-center gap-2">
            {draftSelected.length > 0 && (
              <button
                type="button"
                onClick={() => setDraftSelected([])}
                className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900"
              >
                Clear All
              </button>
            )}
            <button
              type="button"
              onClick={popLayer}
              className="px-3.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirmMultiple}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg transition-colors whitespace-nowrap"
            >
              <Check className="w-3.5 h-3.5" />
              Confirm Selection ({draftSelected.length})
            </button>
          </div>
        </div>
      ) : (
        <div className="px-6 py-2.5 border-t border-slate-100 bg-slate-50/70 flex items-center justify-between gap-2 text-[11px] text-slate-500 shrink-0">
          <span>Click any row or press Enter to select</span>
          <span className="font-mono">↑ ↓ Navigate &middot; Esc Back</span>
        </div>
      )}
    </div>
  );
}

function PickerResultRow({
  entity,
  record,
  summary,
  multiple,
  isSelected,
  isHighlighted,
  onMouseEnter,
  onPick,
  onInspect,
}: {
  entity: EntityKey;
  record: AnyEntityRecord;
  summary: EntityDisplaySummary;
  multiple: boolean;
  isSelected: boolean;
  isHighlighted: boolean;
  onMouseEnter: () => void;
  onPick: () => void;
  onInspect: () => void;
}) {
  const showThumbnailSlot = entity === 'items' || entity === 'workers';

  return (
    <div
      role="option"
      aria-selected={isSelected}
      onMouseEnter={onMouseEnter}
      onClick={onPick}
      className={`px-6 py-3.5 flex items-start gap-3.5 cursor-pointer transition-colors ${
        isSelected
          ? 'bg-[#EFF8F8]'
          : isHighlighted
            ? 'bg-slate-50'
            : 'bg-white hover:bg-slate-50/80'
      }`}
    >
      {/* Multi-select checkbox */}
      {multiple && (
        <div className="pt-0.5 shrink-0">
          <div
            className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${
              isSelected
                ? 'bg-teal-700 border-teal-700 text-white'
                : 'bg-white border-slate-300'
            }`}
          >
            {isSelected && <Check className="w-3 h-3" />}
          </div>
        </div>
      )}

      {/* Optional Thumbnail */}
      {showThumbnailSlot && (
        <div className="w-10 h-10 rounded-lg border border-slate-200 bg-slate-50 overflow-hidden shrink-0 flex items-center justify-center">
          {summary.thumbnailUrl ? (
            <SafeImage
              src={summary.thumbnailUrl}
              alt={summary.title}
              className="w-full h-full object-cover"
              fallback={<ImageIcon className="w-4 h-4 text-slate-300" />}
            />
          ) : (
            <ImageIcon className="w-4 h-4 text-slate-300" />
          )}
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="font-mono text-xs font-semibold text-teal-800 shrink-0">
            {summary.id}
          </span>
          {summary.code && summary.code !== summary.title && (
            <>
              <span className="text-slate-300 text-xs" aria-hidden="true">
                &middot;
              </span>
              <span className="font-mono text-xs font-semibold text-slate-800">
                {summary.code}
              </span>
            </>
          )}
          <span className="text-sm font-semibold text-slate-900 break-words">
            {summary.title}
          </span>
        </div>

        {summary.subtitle && (
          <p className="text-xs text-slate-600 line-clamp-2 leading-relaxed">
            {summary.subtitle}
          </p>
        )}

        {summary.notePreview && (
          <p className="text-[11px] text-slate-500 italic line-clamp-1">
            Note: {summary.notePreview}
          </p>
        )}

        {(summary.metaSegments.length > 0 || summary.status) && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500">
            {summary.status && (
              <span className={`font-medium ${statusTextClass(summary.status)}`}>
                {formatStatusLabel(summary.status)}
              </span>
            )}
            {summary.metaSegments.map((seg, i) => (
              <React.Fragment key={`${record.id}-m-${i}`}>
                {(i > 0 || summary.status) && (
                  <span className="text-slate-300" aria-hidden="true">
                    &middot;
                  </span>
                )}
                <span className="truncate max-w-[260px]">{seg}</span>
              </React.Fragment>
            ))}
          </div>
        )}
      </div>

      {/* Right Actions: Selected Indicator + Inspect */}
      <div className="flex items-center gap-1.5 shrink-0 pt-0.5">
        {!multiple && isSelected && (
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-teal-700 mr-1">
            <Check className="w-3.5 h-3.5" />
            Selected
          </span>
        )}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onInspect();
          }}
          title={`Inspect ${record.id}`}
          aria-label={`Inspect ${record.id}`}
          className="p-1.5 rounded-md text-slate-400 hover:text-teal-700 hover:bg-white border border-transparent hover:border-slate-200 transition-colors"
        >
          <ExternalLink className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
