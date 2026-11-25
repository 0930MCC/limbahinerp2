import React from 'react';
import { ExternalLink, Search, X } from 'lucide-react';
import { useNavigation } from '../lib/navigation.tsx';
import { ENTITY_META } from '../shared/entityMeta.ts';
import { extractEntityDisplay } from '../shared/fuzzySearch.ts';
import type { AnyEntityRecord, EntityKey } from '../shared/types.ts';

interface ReferencePickerFieldProps {
  entity: EntityKey;
  /** Single ID (when multiple=false) */
  value?: string;
  /** Multiple IDs (when multiple=true) */
  values?: string[];
  multiple?: boolean;
  /** Optional already-loaded record(s) for rich preview display */
  selectedRecord?: AnyEntityRecord | null;
  selectedRecords?: AnyEntityRecord[];
  /** Optional fallback label map when record object is not in memory */
  fallbackLabel?: string;
  required?: boolean;
  optional?: boolean;
  disabled?: boolean;
  placeholder?: string;
  layerTitle?: string;
  size?: 'sm' | 'md';
  filterRecord?: (record: AnyEntityRecord) => boolean;
  onChangeSingle?: (id: string, record: AnyEntityRecord | null) => void;
  onChangeMultiple?: (ids: string[], records: AnyEntityRecord[]) => void;
}

export function ReferencePickerField({
  entity,
  value = '',
  values = [],
  multiple = false,
  selectedRecord,
  selectedRecords = [],
  fallbackLabel,
  required = false,
  optional = false,
  disabled = false,
  placeholder,
  layerTitle,
  size = 'md',
  filterRecord,
  onChangeSingle,
  onChangeMultiple,
}: ReferencePickerFieldProps) {
  const { openLayer } = useNavigation();
  const meta = ENTITY_META[entity];

  const handleOpenPicker = () => {
    if (disabled) return;
    openLayer({
      kind: 'pick-ref',
      entity,
      title: layerTitle || `Select ${multiple ? meta.plural : meta.singular}`,
      multiple,
      selectedIds: multiple ? values : value ? [value] : [],
      filterRecord,
      onSelect: (ids, recs) => {
        if (multiple) {
          onChangeMultiple?.(ids, recs);
        } else {
          onChangeSingle?.(ids[0] || '', recs[0] || null);
        }
      },
    });
  };

  if (multiple) {
    const recMap = new Map(selectedRecords.map((r) => [r.id, r]));
    return (
      <div className="space-y-2">
        <button
          type="button"
          onClick={handleOpenPicker}
          disabled={disabled}
          className="w-full px-3 py-2 text-xs font-medium text-teal-800 bg-white border border-slate-300 hover:border-teal-600 hover:bg-[#F5FAFA] disabled:opacity-50 rounded-lg flex items-center justify-between gap-2 transition-colors"
        >
          <span className="inline-flex items-center gap-2">
            <Search className="w-3.5 h-3.5 text-teal-700 shrink-0" />
            <span>
              {values.length > 0
                ? `Search & edit ${meta.plural.toLowerCase()} (${values.length} selected)`
                : placeholder || `Search & select ${meta.plural.toLowerCase()}...`}
            </span>
          </span>
          <span className="text-[11px] font-semibold text-teal-700 shrink-0">
            Browse
          </span>
        </button>

        {values.length > 0 && (
          <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 bg-slate-50/50 max-h-48 overflow-y-auto">
            {values.map((id) => {
              const rec = recMap.get(id);
              const summary = rec ? extractEntityDisplay(entity, rec) : null;
              return (
                <div
                  key={id}
                  className="px-3 py-2 flex items-center justify-between gap-2 text-xs"
                >
                  <div className="min-w-0 truncate">
                    <span className="font-mono font-semibold text-teal-800">
                      {id}
                    </span>
                    {summary && (
                      <span className="text-slate-700 ml-1.5">
                        {summary.code && summary.code !== summary.title
                          ? `${summary.code} · ${summary.title}`
                          : summary.title}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() =>
                        openLayer({ kind: 'inspect', entity, recordId: id })
                      }
                      aria-label={`Inspect ${id}`}
                      className="p-1 text-slate-400 hover:text-teal-700 rounded"
                    >
                      <ExternalLink className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const nextIds = values.filter((x) => x !== id);
                        const nextRecs = selectedRecords.filter((r) => r.id !== id);
                        onChangeMultiple?.(nextIds, nextRecs);
                      }}
                      aria-label={`Remove ${id}`}
                      className="p-1 text-slate-400 hover:text-red-700 rounded"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // Single-select reference picker field
  const summary = selectedRecord
    ? extractEntityDisplay(entity, selectedRecord)
    : null;
  const hasValue = Boolean(value);
  const compact = size === 'sm';

  return (
    <div className="relative">
      {/* Native required constraint hook so form validation works cleanly */}
      {required && (
        <input
          type="text"
          tabIndex={-1}
          value={value}
          onChange={() => {}}
          required
          aria-hidden="true"
          className="sr-only"
          style={{ position: 'absolute', bottom: 0, left: '50%', width: 1, height: 1 }}
        />
      )}

      <div
        className={`w-full bg-white border border-slate-300 rounded-lg transition-colors flex items-center justify-between gap-2 ${
          disabled
            ? 'opacity-60 bg-slate-50'
            : 'hover:border-teal-600 focus-within:ring-2 focus-within:ring-teal-600/30 focus-within:border-teal-700'
        } ${compact ? 'px-2.5 py-1.5' : 'px-3 py-2'}`}
      >
        <button
          type="button"
          onClick={handleOpenPicker}
          disabled={disabled}
          className="flex-1 min-w-0 text-left focus:outline-none"
        >
          {hasValue ? (
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 min-w-0">
                <span
                  className={`font-mono font-semibold text-teal-800 shrink-0 ${
                    compact ? 'text-[11px]' : 'text-xs'
                  }`}
                >
                  {value}
                </span>
                {summary ? (
                  <span
                    className={`truncate font-medium text-slate-900 ${
                      compact ? 'text-xs' : 'text-sm'
                    }`}
                  >
                    {summary.code && summary.code !== summary.title
                      ? `${summary.code} · ${summary.title}`
                      : summary.title}
                  </span>
                ) : fallbackLabel && fallbackLabel !== value ? (
                  <span
                    className={`truncate text-slate-700 ${
                      compact ? 'text-xs' : 'text-sm'
                    }`}
                  >
                    {fallbackLabel}
                  </span>
                ) : null}
              </div>
              {!compact && summary?.subtitle && (
                <p className="text-[11px] text-slate-500 truncate mt-0.5">
                  {summary.subtitle}
                </p>
              )}
            </div>
          ) : (
            <span
              className={`block truncate text-slate-400 ${
                compact ? 'text-xs' : 'text-sm'
              }`}
            >
              {placeholder ||
                (optional
                  ? `Search ${meta.singular.toLowerCase()} (optional)...`
                  : `Search & select ${meta.singular.toLowerCase()}...`)}
            </span>
          )}
        </button>

        <div className="flex items-center gap-1 shrink-0">
          {hasValue && !disabled && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                openLayer({ kind: 'inspect', entity, recordId: value });
              }}
              title={`Inspect ${value}`}
              aria-label={`Inspect ${value}`}
              className="p-1 text-slate-400 hover:text-teal-700 rounded transition-colors"
            >
              <ExternalLink className={compact ? 'w-3 h-3' : 'w-3.5 h-3.5'} />
            </button>
          )}
          {hasValue && optional && !disabled && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onChangeSingle?.('', null);
              }}
              title="Clear selection"
              aria-label="Clear selection"
              className="p-1 text-slate-400 hover:text-red-700 rounded transition-colors"
            >
              <X className={compact ? 'w-3 h-3' : 'w-3.5 h-3.5'} />
            </button>
          )}
          <button
            type="button"
            onClick={handleOpenPicker}
            disabled={disabled}
            title={`Search ${meta.plural}`}
            aria-label={`Search ${meta.plural}`}
            className={`inline-flex items-center gap-1 font-semibold text-teal-700 hover:text-teal-900 rounded transition-colors whitespace-nowrap ${
              compact ? 'px-1.5 py-0.5 text-[11px]' : 'px-2 py-1 text-xs bg-[#EFF8F8] hover:bg-teal-100/70'
            }`}
          >
            <Search className={compact ? 'w-3 h-3' : 'w-3.5 h-3.5'} />
            {!compact && <span>Search</span>}
          </button>
        </div>
      </div>
    </div>
  );
}
