import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import { rankBySimilarity, type WeightedSearchField } from '../shared/fuzzySearch.ts';

export interface SearchableSelectOption {
  value: string;
  /** Primary display code (e.g., COA-1110, INV-26-1001, CUST-...) */
  code?: string;
  /** Primary human-readable name/title */
  label: string;
  /** Optional secondary description line */
  subtitle?: string;
  /** Optional right-side metadata text (e.g., ASSET · BS · Debit) */
  meta?: string;
  /** Optional category/group tag for quick filter buttons */
  group?: string;
  /** Extra keywords/aliases for flexible similarity search */
  keywords?: string[];
}

interface SearchableSelectFieldProps {
  value: string;
  options: SearchableSelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  modalTitle?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  required?: boolean;
  optional?: boolean;
  disabled?: boolean;
  /** Optional quick filter tabs matched against option.group */
  groupFilters?: Array<{ value: string; label: string }>;
  /** Compact inline form cell vs toolbar filter button */
  variant?: 'cell' | 'field' | 'filter';
  /** Optional label prefix when variant="filter" and value is empty/all */
  allOptionLabel?: string;
  /** Value representing "all" / cleared state (default "") */
  clearValue?: string;
  className?: string;
  ariaLabel?: string;
}

export function SearchableSelectField({
  value,
  options,
  onChange,
  placeholder = 'Search & select...',
  modalTitle = 'Select Option',
  searchPlaceholder = 'Type code, name, or keyword (flexible search)...',
  emptyText = 'No matching options found.',
  required = false,
  optional = false,
  disabled = false,
  groupFilters,
  variant = 'field',
  allOptionLabel,
  clearValue = '',
  className = '',
  ariaLabel,
}: SearchableSelectFieldProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [groupFilter, setGroupFilter] = useState<string>('all');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const selectedOption = useMemo(
    () => options.find((o) => o.value === value) || null,
    [options, value]
  );

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setGroupFilter('all');
    setActiveIndex(0);
    const raf = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, [open]);

  const filteredOptions = useMemo(() => {
    const base =
      groupFilter === 'all'
        ? options
        : options.filter((o) => (o.group || '') === groupFilter);

    const trimmed = query.trim();
    if (!trimmed) return base;

    return rankBySimilarity(
      base,
      trimmed,
      (opt): WeightedSearchField[] => {
        const fields: WeightedSearchField[] = [
          { text: opt.label, weight: 1.05 },
          { text: opt.value, weight: 0.9 },
        ];
        if (opt.code) fields.push({ text: opt.code, weight: 1.15 });
        if (opt.subtitle) fields.push({ text: opt.subtitle, weight: 0.85 });
        if (opt.meta) fields.push({ text: opt.meta, weight: 0.72 });
        if (opt.group) fields.push({ text: opt.group, weight: 0.7 });
        if (opt.keywords && opt.keywords.length > 0) {
          fields.push({ text: opt.keywords.join(' '), weight: 0.92 });
        }
        return fields;
      },
      (opt) => `${opt.code || ''} ${opt.label}`
    ).map((r) => r.item);
  }, [options, query, groupFilter]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, groupFilter]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);

  const handlePick = (nextValue: string) => {
    onChange(nextValue);
    setOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (filteredOptions.length > 0) {
        setActiveIndex((prev) => Math.min(filteredOptions.length - 1, prev + 1));
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (filteredOptions.length > 0) {
        setActiveIndex((prev) => Math.max(0, prev - 1));
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const target = filteredOptions[activeIndex] || filteredOptions[0];
      if (target) handlePick(target.value);
    }
  };

  const isSelected = Boolean(value && value !== clearValue);

  const triggerSizing =
    variant === 'cell'
      ? 'px-2 py-1.5 text-xs rounded-md'
      : variant === 'filter'
        ? 'px-2.5 py-1.5 text-xs font-medium rounded-lg'
        : 'px-3 py-2 text-sm rounded-lg';

  return (
    <div className={`relative ${className}`}>
      {required && (
        <input
          type="text"
          tabIndex={-1}
          value={isSelected ? value : ''}
          onChange={() => {}}
          required
          aria-hidden="true"
          className="sr-only"
          style={{ position: 'absolute', bottom: 0, left: '50%', width: 1, height: 1 }}
        />
      )}

      <div
        className={`w-full bg-white border ${
          variant === 'filter' ? 'border-slate-200' : 'border-slate-300'
        } transition-colors flex items-center justify-between gap-1.5 ${
          disabled
            ? 'opacity-60 bg-slate-50'
            : 'hover:border-teal-600 focus-within:ring-2 focus-within:ring-teal-600/25 focus-within:border-teal-700'
        } ${triggerSizing}`}
      >
        <button
          type="button"
          onClick={() => !disabled && setOpen(true)}
          disabled={disabled}
          aria-label={ariaLabel || modalTitle}
          className="flex-1 min-w-0 text-left flex items-center gap-1.5 focus:outline-none"
        >
          {selectedOption && isSelected ? (
            <span className="truncate flex items-center gap-1.5 min-w-0">
              {selectedOption.code && (
                <span className="font-mono font-semibold text-teal-800 shrink-0">
                  {selectedOption.code}
                </span>
              )}
              <span className="truncate text-slate-900 font-medium">
                {selectedOption.label}
              </span>
            </span>
          ) : (
            <span
              className={`truncate ${
                variant === 'filter' ? 'text-slate-700' : 'text-slate-400'
              }`}
            >
              {allOptionLabel || placeholder}
            </span>
          )}
        </button>

        <div className="flex items-center gap-0.5 shrink-0">
          {isSelected && (optional || Boolean(allOptionLabel)) && !disabled && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onChange(clearValue);
              }}
              aria-label="Clear selection"
              title="Clear selection"
              className="p-0.5 text-slate-400 hover:text-red-700 rounded"
            >
              <X className="w-3 h-3" />
            </button>
          )}
          <button
            type="button"
            onClick={() => !disabled && setOpen(true)}
            disabled={disabled}
            aria-label={`Search ${modalTitle}`}
            className="p-0.5 text-slate-400 hover:text-teal-700 rounded"
          >
            {variant === 'filter' ? (
              <ChevronDown className="w-3.5 h-3.5" />
            ) : (
              <Search className="w-3.5 h-3.5 text-teal-700" />
            )}
          </button>
        </div>
      </div>

      {/* Searchable Picker Layer Modal */}
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={modalTitle}
          className="fixed inset-0 z-[70] flex items-center justify-center p-3 sm:p-5"
        >
          <div
            className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px]"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div className="relative z-10 w-full max-w-xl bg-white border border-slate-200 rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[82vh]">
            {/* Header */}
            <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between gap-3 bg-white shrink-0">
              <div>
                <h3 className="font-display text-sm font-bold text-slate-900">
                  {modalTitle}
                </h3>
                <p className="text-[11px] text-slate-500">
                  Flexible similarity search &middot; matches partial codes, keywords, and typos
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close picker"
                className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-md"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Search & Quick Group Filters */}
            <div className="px-5 py-3 border-b border-slate-200 bg-[#F8FAFB] space-y-2.5 shrink-0">
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  ref={inputRef}
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={searchPlaceholder}
                  className="w-full pl-9 pr-8 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-600/30 focus:border-teal-700"
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => {
                      setQuery('');
                      inputRef.current?.focus();
                    }}
                    aria-label="Clear search"
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700 rounded"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {groupFilters && groupFilters.length > 0 && (
                <div className="flex flex-wrap items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setGroupFilter('all')}
                    className={`px-2 py-1 text-[11px] font-medium rounded-md transition-colors ${
                      groupFilter === 'all'
                        ? 'bg-slate-900 text-white'
                        : 'text-slate-600 hover:bg-slate-200/70'
                    }`}
                  >
                    All ({options.length})
                  </button>
                  {groupFilters.map((gf) => (
                    <button
                      key={gf.value}
                      type="button"
                      onClick={() => setGroupFilter(gf.value)}
                      className={`px-2 py-1 text-[11px] font-medium rounded-md transition-colors ${
                        groupFilter === gf.value
                          ? 'bg-slate-900 text-white'
                          : 'text-slate-600 hover:bg-slate-200/70'
                      }`}
                    >
                      {gf.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Results */}
            <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
              {allOptionLabel && !query.trim() && (
                <button
                  type="button"
                  onClick={() => handlePick(clearValue)}
                  className={`w-full px-5 py-2.5 text-left flex items-center justify-between gap-2 transition-colors ${
                    !isSelected ? 'bg-[#EFF8F8]' : 'bg-white hover:bg-slate-50'
                  }`}
                >
                  <span className="text-xs font-semibold text-slate-800">
                    {allOptionLabel}
                  </span>
                  {!isSelected && <Check className="w-3.5 h-3.5 text-teal-700" />}
                </button>
              )}

              {filteredOptions.length === 0 ? (
                <div className="px-5 py-10 text-center space-y-2">
                  <p className="text-sm font-medium text-slate-800">{emptyText}</p>
                  {query.trim() && (
                    <button
                      type="button"
                      onClick={() => {
                        setQuery('');
                        setGroupFilter('all');
                        inputRef.current?.focus();
                      }}
                      className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg"
                    >
                      Clear Search
                    </button>
                  )}
                </div>
              ) : (
                filteredOptions.map((opt, idx) => {
                  const chosen = opt.value === value;
                  const highlighted = idx === activeIndex;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onMouseEnter={() => setActiveIndex(idx)}
                      onClick={() => handlePick(opt.value)}
                      className={`w-full px-5 py-3 text-left flex items-center justify-between gap-3 transition-colors ${
                        chosen
                          ? 'bg-[#EFF8F8]'
                          : highlighted
                            ? 'bg-slate-50'
                            : 'bg-white hover:bg-slate-50/80'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-2 min-w-0">
                          {opt.code && (
                            <span className="font-mono text-xs font-semibold text-teal-800 shrink-0">
                              {opt.code}
                            </span>
                          )}
                          <span className="text-sm font-medium text-slate-900 truncate">
                            {opt.label}
                          </span>
                        </div>
                        {opt.subtitle && (
                          <p className="text-xs text-slate-500 truncate mt-0.5">
                            {opt.subtitle}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {opt.meta && (
                          <span className="font-mono text-[11px] text-slate-500 whitespace-nowrap">
                            {opt.meta}
                          </span>
                        )}
                        {chosen && <Check className="w-4 h-4 text-teal-700 shrink-0" />}
                      </div>
                    </button>
                  );
                })
              )}
            </div>

            {/* Footer */}
            <div className="px-5 py-2 border-t border-slate-100 bg-slate-50/70 flex items-center justify-between text-[11px] text-slate-500 shrink-0">
              <span>
                {filteredOptions.length} {filteredOptions.length === 1 ? 'match' : 'matches'}
              </span>
              <span className="font-mono">↑ ↓ Navigate &middot; Enter Select &middot; Esc Close</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
