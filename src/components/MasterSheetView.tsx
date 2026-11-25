import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  AlertTriangle,
  ChevronDown,
  ClipboardCopy,
  Eraser,
  ExternalLink,
  Plus,
  RotateCcw,
  Save,
  Search,
  Trash2,
  Undo2,
} from 'lucide-react';
import { api, formatIDR } from '../lib/api.ts';
import { useFeedback } from '../lib/feedback.tsx';
import { useNavigation } from '../lib/navigation.tsx';
import { ENTITY_META, type FieldDef } from '../shared/entityMeta.ts';
import {
  extractEntitySearchFields,
  rankBySimilarity,
} from '../shared/fuzzySearch.ts';
import type { AnyEntityRecord, EntityKey } from '../shared/types.ts';

interface MasterSheetViewProps {
  entity: EntityKey;
  records: AnyEntityRecord[];
  onSaved: () => void;
  onInspectRecord: (recordId: string) => void;
}

interface RefOption {
  id: string;
  label: string;
  searchText: string;
  raw: AnyEntityRecord;
}

interface SheetRow {
  rowKey: string;
  isNew: boolean;
  original: Record<string, unknown>;
}

interface CellCoord {
  r: number;
  c: number;
}

interface CellRange {
  anchor: CellCoord;
  focus: CellCoord;
}

function getNormalizedRange(sel: CellRange): {
  rMin: number;
  rMax: number;
  cMin: number;
  cMax: number;
} {
  return {
    rMin: Math.min(sel.anchor.r, sel.focus.r),
    rMax: Math.max(sel.anchor.r, sel.focus.r),
    cMin: Math.min(sel.anchor.c, sel.focus.c),
    cMax: Math.max(sel.anchor.c, sel.focus.c),
  };
}

function formatRefOption(refEntity: EntityKey, rec: AnyEntityRecord): RefOption {
  const obj = rec as unknown as Record<string, unknown>;
  let detail = '';
  if (refEntity === 'workers') {
    detail = `${String(obj.name || '')}${obj.username ? ` (@${obj.username})` : ''}`;
  } else if (refEntity === 'items') {
    detail = [obj.item_code, obj.title].filter(Boolean).join(' · ');
  } else if (refEntity === 'branches') {
    detail = [obj.name, obj.city].filter(Boolean).join(' · ');
  } else if (refEntity === 'schedules') {
    detail = [obj.vehicle_number, obj.scheduled_date].filter(Boolean).join(' · ');
  } else if (refEntity === 'customers') {
    detail = String(obj.name || '');
  } else if (refEntity === 'purchase_orders') {
    detail = String(obj.po_number || obj.date_period || '');
  } else if (
    refEntity === 'berita_acara' ||
    refEntity === 'invoices' ||
    refEntity === 'certificates' ||
    refEntity === 'fpl_real' ||
    refEntity === 'fpl_doc'
  ) {
    detail = [obj.date_period, obj.status].filter(Boolean).join(' · ');
  } else {
    detail = String(obj.name || obj.title || '');
  }

  const cleanDetail = detail.trim();
  const label = cleanDetail ? `${rec.id} — ${cleanDetail}` : rec.id;
  return {
    id: rec.id,
    label,
    searchText: `${rec.id} ${cleanDetail}`.toLowerCase(),
    raw: rec,
  };
}

function normalizeCellValueForCompare(field: FieldDef, val: unknown): string {
  if (val === null || val === undefined) return '';
  if (field.type === 'url-list') {
    if (Array.isArray(val)) return val.map(String).filter(Boolean).join('|');
    return String(val).trim();
  }
  if (field.type === 'number' || field.type === 'currency') {
    if (val === '') return '';
    const num = Number(val);
    return Number.isFinite(num) ? String(num) : String(val).trim();
  }
  return String(val).trim();
}

function toEditableString(field: FieldDef, val: unknown): string {
  if (val === null || val === undefined) return '';
  if (field.type === 'url-list') {
    return Array.isArray(val) ? val.map(String).filter(Boolean).join('|') : String(val);
  }
  return String(val);
}

function coerceSheetValue(
  field: FieldDef,
  rawStr: string,
  refOptions?: RefOption[]
): unknown {
  const trimmed = rawStr.trim();

  if (field.type === 'number' || field.type === 'currency') {
    if (!trimmed) return field.required ? 0 : null;
    const cleaned = trimmed.replace(/[Rp\s,]/gi, '');
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  if (field.type === 'url-list') {
    if (!trimmed) return [];
    return trimmed
      .split(/[|;]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  if (field.type === 'select' && field.options?.length) {
    if (!trimmed) return field.optional ? '' : field.options[0].value;
    const lower = trimmed.toLowerCase();
    const match = field.options.find(
      (o) => o.value.toLowerCase() === lower || o.label.toLowerCase() === lower
    );
    return match ? match.value : trimmed;
  }

  if (field.type === 'ref') {
    if (!trimmed) return null;
    if (refOptions && refOptions.length > 0) {
      const lower = trimmed.toLowerCase();
      const byId = refOptions.find((o) => o.id.toLowerCase() === lower);
      if (byId) return byId.id;
      const byPrefix = refOptions.find((o) => o.label.toLowerCase() === lower);
      if (byPrefix) return byPrefix.id;
      const byContains = refOptions.find((o) => o.searchText.includes(lower));
      if (byContains) return byContains.id;
    }
    return trimmed;
  }

  return trimmed === '' && field.optional ? null : trimmed;
}

function buildDefaultNewRowData(fields: FieldDef[]): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  const today = new Date().toISOString().slice(0, 10);
  for (const f of fields) {
    if (f.type === 'select' && f.options?.[0]) {
      data[f.key] = f.options[0].value;
    } else if (f.type === 'date' && f.required) {
      data[f.key] = today;
    } else if (f.type === 'number' || f.type === 'currency') {
      data[f.key] = f.required ? 0 : null;
    } else if (f.type === 'url-list') {
      data[f.key] = [];
    } else {
      data[f.key] = '';
    }
  }
  return data;
}

export function MasterSheetView({
  entity,
  records,
  onSaved,
  onInspectRecord,
}: MasterSheetViewProps) {
  const meta = ENTITY_META[entity];
  const { openLayer, setUnsavedChanges, notifyDataChanged } = useNavigation();
  const { notifySuccess, notifyError } = useFeedback();

  const columns = useMemo(
    () =>
      meta.fields.filter(
        (f) =>
          f.type !== 'password' &&
          f.type !== 'json' &&
          f.type !== 'ref-list'
      ),
    [meta.fields]
  );

  // Lookup options for every reference column in this entity
  const refEntitiesNeeded = useMemo(() => {
    const set = new Set<EntityKey>();
    for (const f of columns) {
      if (f.type === 'ref' && f.refEntity) {
        set.add(f.refEntity);
      }
    }
    return Array.from(set);
  }, [columns]);

  const [refOptionsMap, setRefOptionsMap] = useState<Record<string, RefOption[]>>({});

  useEffect(() => {
    let active = true;
    const loadRefs = async () => {
      if (refEntitiesNeeded.length === 0) {
        setRefOptionsMap({});
        return;
      }
      const entries = await Promise.all(
        refEntitiesNeeded.map(async (refEnt) => {
          try {
            const res = await api.listRecords(refEnt, { lookup: true });
            const opts = res.records
              .map((r) => formatRefOption(refEnt, r))
              .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
            return [refEnt, opts] as const;
          } catch {
            return [refEnt, [] as RefOption[]] as const;
          }
        })
      );
      if (!active) return;
      const next: Record<string, RefOption[]> = {};
      for (const [k, v] of entries) next[k] = v;
      setRefOptionsMap(next);
    };
    loadRefs();
    return () => {
      active = false;
    };
  }, [refEntitiesNeeded]);

  // Spreadsheet dirty state
  const [edits, setEdits] = useState<Record<string, Record<string, unknown>>>({});
  const [newRows, setNewRows] = useState<Array<{ tempKey: string; data: Record<string, unknown> }>>([]);
  const [deletedIds, setDeletedIds] = useState<Set<string>>(() => new Set());
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  // Selection & editing state
  const [selection, setSelection] = useState<CellRange | null>(null);
  const [editingCell, setEditingCell] = useState<CellCoord | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [dropdownSearch, setDropdownSearch] = useState('');
  const isDraggingRef = useRef(false);
  const newRowCounterRef = useRef(1);
  const gridContainerRef = useRef<HTMLDivElement | null>(null);
  const activeInputRef = useRef<HTMLInputElement | null>(null);
  const dropdownSearchRef = useRef<HTMLInputElement | null>(null);

  // Reset sheet state when switching entity
  useEffect(() => {
    setEdits({});
    setNewRows([]);
    setDeletedIds(new Set());
    setRowErrors({});
    setSelection(null);
    setEditingCell(null);
    setDropdownSearch('');
  }, [entity]);

  // Combine existing records + new rows
  const sheetRows = useMemo<SheetRow[]>(() => {
    const existing: SheetRow[] = records.map((rec) => ({
      rowKey: rec.id,
      isNew: false,
      original: rec as unknown as Record<string, unknown>,
    }));
    const appended: SheetRow[] = newRows.map((nr) => ({
      rowKey: nr.tempKey,
      isNew: true,
      original: nr.data,
    }));
    return [...existing, ...appended];
  }, [records, newRows]);

  const getCellValue = useCallback(
    (row: SheetRow, field: FieldDef): unknown => {
      if (row.isNew) {
        return row.original[field.key];
      }
      const rowEdits = edits[row.rowKey];
      if (rowEdits && field.key in rowEdits) {
        return rowEdits[field.key];
      }
      return row.original[field.key];
    },
    [edits]
  );

  const isCellDirty = useCallback(
    (row: SheetRow, fieldKey: string): boolean => {
      if (row.isNew) return true;
      return Boolean(edits[row.rowKey] && fieldKey in edits[row.rowKey]);
    },
    [edits]
  );

  // Compute dirty counters
  const editedCellCount = useMemo(() => {
    let count = 0;
    for (const rowChanges of Object.values(edits)) {
      count += Object.keys(rowChanges).length;
    }
    return count;
  }, [edits]);

  const modifiedRowCount = Object.keys(edits).length;
  const newRowCount = newRows.length;
  const deletedRowCount = deletedIds.size;
  const hasChanges = editedCellCount > 0 || newRowCount > 0 || deletedRowCount > 0;

  const changeSummaryText = useMemo(() => {
    const parts: string[] = [];
    if (editedCellCount > 0) {
      parts.push(
        `${editedCellCount} edited ${editedCellCount === 1 ? 'cell' : 'cells'}`
      );
    }
    if (newRowCount > 0) {
      parts.push(`${newRowCount} new ${newRowCount === 1 ? 'row' : 'rows'}`);
    }
    if (deletedRowCount > 0) {
      parts.push(`${deletedRowCount} deleted`);
    }
    return parts.join(' · ');
  }, [editedCellCount, newRowCount, deletedRowCount]);

  // Sync unsaved state into NavigationContext so page/tab switches open the Confirm Dialog
  useEffect(() => {
    if (hasChanges) {
      setUnsavedChanges(
        true,
        `You have unsaved changes in ${meta.plural} Sheet View (${changeSummaryText}). Leaving now will discard your edits.`
      );
    } else {
      setUnsavedChanges(false);
    }
  }, [hasChanges, changeSummaryText, meta.plural, setUnsavedChanges]);

  // Always clear unsaved guard when MasterSheetView unmounts
  useEffect(() => {
    return () => {
      setUnsavedChanges(false);
    };
  }, [setUnsavedChanges]);

  // End mouse drag selection globally
  useEffect(() => {
    const onMouseUp = () => {
      isDraggingRef.current = false;
    };
    window.addEventListener('mouseup', onMouseUp);
    return () => window.removeEventListener('mouseup', onMouseUp);
  }, []);

  // Auto-focus inline input or dropdown search when entering edit mode
  useEffect(() => {
    if (!editingCell) return;
    const field = columns[editingCell.c];
    if (!field) return;
    if (field.type === 'ref' || field.type === 'select') {
      requestAnimationFrame(() => dropdownSearchRef.current?.focus());
    } else {
      requestAnimationFrame(() => {
        activeInputRef.current?.focus();
        activeInputRef.current?.select();
      });
    }
  }, [editingCell, columns]);

  // Apply a value to a single cell
  const applyCellUpdate = useCallback(
    (rowIdx: number, colIdx: number, rawValue: unknown) => {
      const row = sheetRows[rowIdx];
      const field = columns[colIdx];
      if (!row || !field) return;

      const refOpts = field.refEntity ? refOptionsMap[field.refEntity] : undefined;
      const coerced =
        typeof rawValue === 'string'
          ? coerceSheetValue(field, rawValue, refOpts)
          : rawValue;

      // Clear any previous row error on edit
      setRowErrors((prev) => {
        if (!(row.rowKey in prev)) return prev;
        const copy = { ...prev };
        delete copy[row.rowKey];
        return copy;
      });

      if (row.isNew) {
        setNewRows((prev) =>
          prev.map((nr) => {
            if (nr.tempKey !== row.rowKey) return nr;
            const nextData = { ...nr.data, [field.key]: coerced };
            // Helpful default: on new Limbah Data row, auto-copy item_note to final_item_note if blank
            if (
              entity === 'pickup_data' &&
              field.key === 'id_item_model' &&
              typeof coerced === 'string' &&
              coerced &&
              !String(nextData.final_item_note || '').trim()
            ) {
              const itemOpt = refOptionsMap.items?.find((o) => o.id === coerced);
              const itemNote = itemOpt
                ? String((itemOpt.raw as unknown as Record<string, unknown>).item_note || '')
                : '';
              if (itemNote) nextData.final_item_note = itemNote;
            }
            return { ...nr, data: nextData };
          })
        );
        return;
      }

      const originalVal = row.original[field.key];
      const origNorm = normalizeCellValueForCompare(field, originalVal);
      const nextNorm = normalizeCellValueForCompare(field, coerced);

      setEdits((prev) => {
        const existingRowEdits = prev[row.rowKey] ? { ...prev[row.rowKey] } : {};
        if (origNorm === nextNorm) {
          delete existingRowEdits[field.key];
        } else {
          existingRowEdits[field.key] = coerced;
        }
        const next = { ...prev };
        if (Object.keys(existingRowEdits).length === 0) {
          delete next[row.rowKey];
        } else {
          next[row.rowKey] = existingRowEdits;
        }
        return next;
      });
    },
    [sheetRows, columns, refOptionsMap, entity]
  );

  const commitActiveEdit = useCallback(() => {
    if (!editingCell) return;
    const field = columns[editingCell.c];
    if (field && field.type !== 'ref' && field.type !== 'select') {
      applyCellUpdate(editingCell.r, editingCell.c, editDraft);
    }
    setEditingCell(null);
    setDropdownSearch('');
  }, [editingCell, columns, applyCellUpdate, editDraft]);

  const startEditingCell = useCallback(
    (r: number, c: number, initialChar?: string) => {
      const row = sheetRows[r];
      const field = columns[c];
      if (!row || !field) return;
      if (deletedIds.has(row.rowKey)) return;

      setSelection({ anchor: { r, c }, focus: { r, c } });
      setEditingCell({ r, c });
      setDropdownSearch(initialChar ?? '');
      if (field.type === 'ref' || field.type === 'select') {
        setEditDraft(toEditableString(field, getCellValue(row, field)));
      } else if (initialChar !== undefined) {
        setEditDraft(initialChar);
      } else {
        setEditDraft(toEditableString(field, getCellValue(row, field)));
      }
    },
    [sheetRows, columns, deletedIds, getCellValue]
  );

  const handleClearSelectedCells = useCallback(() => {
    if (!selection) return;
    const { rMin, rMax, cMin, cMax } = getNormalizedRange(selection);
    for (let r = rMin; r <= rMax; r += 1) {
      const row = sheetRows[r];
      if (!row || deletedIds.has(row.rowKey)) continue;
      for (let c = cMin; c <= cMax; c += 1) {
        applyCellUpdate(r, c, '');
      }
    }
  }, [selection, sheetRows, deletedIds, applyCellUpdate]);

  const handleCopySelection = useCallback(async () => {
    if (!selection) return;
    const { rMin, rMax, cMin, cMax } = getNormalizedRange(selection);
    const lines: string[] = [];
    for (let r = rMin; r <= rMax; r += 1) {
      const row = sheetRows[r];
      if (!row) continue;
      const cells: string[] = [];
      for (let c = cMin; c <= cMax; c += 1) {
        const field = columns[c];
        const val = getCellValue(row, field);
        cells.push(toEditableString(field, val).replace(/\t/g, ' ').replace(/\r?\n/g, ' '));
      }
      lines.push(cells.join('\t'));
    }
    const tsv = lines.join('\n');
    try {
      await navigator.clipboard.writeText(tsv);
      notifySuccess(
        `Copied ${rMax - rMin + 1} × ${cMax - cMin + 1} cell(s) to clipboard.`
      );
    } catch {
      // Fallback for restricted iframe clipboard permissions
      const ta = document.createElement('textarea');
      ta.value = tsv;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      notifySuccess(
        `Copied ${rMax - rMin + 1} × ${cMax - cMin + 1} cell(s) to clipboard.`
      );
    }
  }, [selection, sheetRows, columns, getCellValue, notifySuccess]);

  const applyPastedText = useCallback(
    (rawText: string) => {
      if (!selection || !rawText) return;
      const { rMin, rMax, cMin, cMax } = getNormalizedRange(selection);

      const normalized = rawText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      const rawLines = normalized.endsWith('\n')
        ? normalized.slice(0, -1).split('\n')
        : normalized.split('\n');
      const matrix = rawLines.map((line) => line.split('\t'));
      if (matrix.length === 0) return;

      // Single-cell paste fills entire selected range (Google Sheets behavior)
      if (matrix.length === 1 && matrix[0].length === 1) {
        const val = matrix[0][0];
        for (let r = rMin; r <= rMax; r += 1) {
          if (r >= sheetRows.length) break;
          if (deletedIds.has(sheetRows[r].rowKey)) continue;
          for (let c = cMin; c <= cMax; c += 1) {
            if (c >= columns.length) break;
            applyCellUpdate(r, c, val);
          }
        }
        return;
      }

      // Multi-cell TSV paste: auto-append new rows if pasting extends beyond existing rows
      const requiredRows = rMin + matrix.length;
      const rowsToAppend = Math.max(0, requiredRows - sheetRows.length);
      const extraNewRows: Array<{ tempKey: string; data: Record<string, unknown> }> = [];
      for (let i = 0; i < rowsToAppend; i += 1) {
        extraNewRows.push({
          tempKey: `new-${newRowCounterRef.current++}`,
          data: buildDefaultNewRowData(columns),
        });
      }

      // Apply pasted cells to newly appended rows directly before committing state
      if (extraNewRows.length > 0) {
        for (let dr = 0; dr < matrix.length; dr += 1) {
          const targetRowIdx = rMin + dr;
          if (targetRowIdx >= sheetRows.length) {
            const newRowOffset = targetRowIdx - sheetRows.length;
            const targetNewRow = extraNewRows[newRowOffset];
            if (!targetNewRow) continue;
            for (let dc = 0; dc < matrix[dr].length; dc += 1) {
              const targetColIdx = cMin + dc;
              const field = columns[targetColIdx];
              if (!field) continue;
              const refOpts = field.refEntity ? refOptionsMap[field.refEntity] : undefined;
              targetNewRow.data[field.key] = coerceSheetValue(
                field,
                matrix[dr][dc],
                refOpts
              );
            }
          }
        }
        setNewRows((prev) => [...prev, ...extraNewRows]);
      }

      // Apply pasted cells to already-present rows
      for (let dr = 0; dr < matrix.length; dr += 1) {
        const targetRowIdx = rMin + dr;
        if (targetRowIdx >= sheetRows.length) continue;
        if (deletedIds.has(sheetRows[targetRowIdx].rowKey)) continue;
        for (let dc = 0; dc < matrix[dr].length; dc += 1) {
          const targetColIdx = cMin + dc;
          if (targetColIdx >= columns.length) continue;
          applyCellUpdate(targetRowIdx, targetColIdx, matrix[dr][dc]);
        }
      }

      // Expand selection to match pasted bounds
      setSelection({
        anchor: { r: rMin, c: cMin },
        focus: {
          r: Math.min(sheetRows.length + extraNewRows.length - 1, rMin + matrix.length - 1),
          c: Math.min(columns.length - 1, cMin + matrix[0].length - 1),
        },
      });
    },
    [selection, sheetRows, columns, deletedIds, applyCellUpdate, refOptionsMap]
  );

  const handleAddRow = useCallback(() => {
    const tempKey = `new-${newRowCounterRef.current++}`;
    setNewRows((prev) => [
      ...prev,
      { tempKey, data: buildDefaultNewRowData(columns) },
    ]);
    const nextRowIndex = sheetRows.length;
    setSelection({
      anchor: { r: nextRowIndex, c: 0 },
      focus: { r: nextRowIndex, c: 0 },
    });
  }, [columns, sheetRows.length]);

  const handleToggleDeleteRow = useCallback(
    (row: SheetRow) => {
      if (row.isNew) {
        setNewRows((prev) => prev.filter((nr) => nr.tempKey !== row.rowKey));
        setEditingCell(null);
        return;
      }
      setDeletedIds((prev) => {
        const next = new Set(prev);
        if (next.has(row.rowKey)) next.delete(row.rowKey);
        else next.add(row.rowKey);
        return next;
      });
    },
    []
  );

  const handleDiscardAll = useCallback(() => {
    setEdits({});
    setNewRows([]);
    setDeletedIds(new Set());
    setRowErrors({});
    setEditingCell(null);
    setDropdownSearch('');
  }, []);

  const handleSaveAll = useCallback(async () => {
    if (!hasChanges || saving) return;
    if (editingCell) {
      commitActiveEdit();
    }
    setSaving(true);
    setRowErrors({});

    try {
      const updatesPayload = Object.entries(edits)
        .filter(([id]) => !deletedIds.has(id))
        .map(([id, changes]) => ({ id, changes }));

      const createsPayload = newRows.map((nr) => ({
        tempKey: nr.tempKey,
        data: nr.data,
      }));

      const deletesPayload = Array.from(deletedIds);

      const res = await api.bulkSaveSheet(entity, {
        updates: updatesPayload,
        creates: createsPayload,
        deletes: deletesPayload,
      });

      const failedKeys = new Set(res.errors.map((e) => e.rowKey));
      if (res.errors.length > 0) {
        const errMap: Record<string, string> = {};
        for (const e of res.errors) {
          errMap[e.rowKey] = e.error;
        }
        setRowErrors(errMap);

        // Keep only failed rows dirty so successful rows commit cleanly
        setEdits((prev) => {
          const next: Record<string, Record<string, unknown>> = {};
          for (const [k, v] of Object.entries(prev)) {
            if (failedKeys.has(k)) next[k] = v;
          }
          return next;
        });
        setNewRows((prev) => prev.filter((nr) => failedKeys.has(nr.tempKey)));
        setDeletedIds((prev) => {
          const next = new Set<string>();
          for (const id of prev) {
            if (failedKeys.has(id)) next.add(id);
          }
          return next;
        });
        notifyError(
          `Saved with ${res.errors.length} row error(s). Review highlighted rows.`
        );
      } else {
        setEdits({});
        setNewRows([]);
        setDeletedIds(new Set());
        setRowErrors({});
        const parts: string[] = [];
        if (res.updatedCount > 0) parts.push(`${res.updatedCount} updated`);
        if (res.createdCount > 0) parts.push(`${res.createdCount} added`);
        if (res.deletedCount > 0) parts.push(`${res.deletedCount} deleted`);
        notifySuccess(`${meta.plural} saved: ${parts.join(', ')}.`);
      }

      if (res.updatedCount + res.createdCount + res.deletedCount > 0) {
        notifyDataChanged();
        onSaved();
      }
    } catch (err) {
      notifyError(
        err instanceof Error ? err.message : 'Failed to save spreadsheet changes.'
      );
    } finally {
      setSaving(false);
    }
  }, [
    hasChanges,
    saving,
    editingCell,
    commitActiveEdit,
    edits,
    deletedIds,
    newRows,
    entity,
    meta.plural,
    notifyDataChanged,
    notifyError,
    notifySuccess,
    onSaved,
  ]);

  // Global keyboard shortcuts when sheet grid is focused
  const handleGridKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    // Ctrl+S / Cmd+S to save changes
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      if (hasChanges) handleSaveAll();
      return;
    }

    if (!selection) return;
    const { anchor, focus } = selection;

    // If currently editing a text input, let the input handle navigation keys
    if (editingCell) {
      if (e.key === 'Escape') {
        e.preventDefault();
        setEditingCell(null);
        setDropdownSearch('');
        gridContainerRef.current?.focus();
      }
      return;
    }

    // Copy shortcut
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
      e.preventDefault();
      handleCopySelection();
      return;
    }

    // Arrow key navigation (Shift extends range)
    if (
      e.key === 'ArrowUp' ||
      e.key === 'ArrowDown' ||
      e.key === 'ArrowLeft' ||
      e.key === 'ArrowRight'
    ) {
      e.preventDefault();
      const dr = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
      const dc = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      const base = e.shiftKey ? focus : anchor;
      const nextR = Math.max(0, Math.min(sheetRows.length - 1, base.r + dr));
      const nextC = Math.max(0, Math.min(columns.length - 1, base.c + dc));
      if (e.shiftKey) {
        setSelection({ anchor, focus: { r: nextR, c: nextC } });
      } else {
        setSelection({ anchor: { r: nextR, c: nextC }, focus: { r: nextR, c: nextC } });
      }
      return;
    }

    // Tab / Shift+Tab navigation
    if (e.key === 'Tab') {
      e.preventDefault();
      const dir = e.shiftKey ? -1 : 1;
      let nextC = anchor.c + dir;
      let nextR = anchor.r;
      if (nextC >= columns.length) {
        nextC = 0;
        nextR = Math.min(sheetRows.length - 1, nextR + 1);
      } else if (nextC < 0) {
        nextC = columns.length - 1;
        nextR = Math.max(0, nextR - 1);
      }
      setSelection({ anchor: { r: nextR, c: nextC }, focus: { r: nextR, c: nextC } });
      return;
    }

    // Delete / Backspace clears selected cells
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      handleClearSelectedCells();
      return;
    }

    // Enter or F2 enters edit mode
    if (e.key === 'Enter' || e.key === 'F2') {
      e.preventDefault();
      startEditingCell(anchor.r, anchor.c);
      return;
    }

    // Typing a printable character enters edit mode directly (Google Sheets style)
    if (
      e.key.length === 1 &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey
    ) {
      e.preventDefault();
      startEditingCell(anchor.r, anchor.c, e.key);
    }
  };

  const handleGridPaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    if (editingCell) return; // Let normal input paste work inside an active input
    const pasted = e.clipboardData?.getData('text/plain');
    if (pasted) {
      e.preventDefault();
      applyPastedText(pasted);
    }
  };

  const activeCellInfo = useMemo(() => {
    if (!selection) return null;
    const row = sheetRows[selection.anchor.r];
    const col = columns[selection.anchor.c];
    if (!row || !col) return null;
    const { rMin, rMax, cMin, cMax } = getNormalizedRange(selection);
    const cellCount = (rMax - rMin + 1) * (cMax - cMin + 1);
    return {
      rowLabel: row.isNew ? `New #${selection.anchor.r + 1}` : row.rowKey,
      colLabel: col.label,
      cellCount,
      rawVal: toEditableString(col, getCellValue(row, col)),
    };
  }, [selection, sheetRows, columns, getCellValue]);

  const renderCellDisplay = (row: SheetRow, field: FieldDef) => {
    const val = getCellValue(row, field);
    if (val === null || val === undefined || val === '') {
      return <span className="text-slate-300 select-none">—</span>;
    }
    if (field.type === 'ref' && field.refEntity) {
      const refId = String(val);
      const opt = refOptionsMap[field.refEntity]?.find((o) => o.id === refId);
      return (
        <div className="flex items-center justify-between gap-1.5 min-w-0">
          <span className="truncate text-xs">
            <span className="font-mono font-semibold text-teal-800">{refId}</span>
            {opt && opt.label !== refId && (
              <span className="text-slate-500 ml-1">
                {opt.label.slice(refId.length + 3)}
              </span>
            )}
          </span>
          <ChevronDown className="w-3 h-3 text-slate-400 shrink-0" />
        </div>
      );
    }
    if (field.type === 'select' && field.options) {
      const opt = field.options.find((o) => o.value === String(val));
      return (
        <div className="flex items-center justify-between gap-1.5 min-w-0">
          <span className="truncate text-xs font-medium text-slate-800">
            {opt ? opt.label : String(val)}
          </span>
          <ChevronDown className="w-3 h-3 text-slate-400 shrink-0" />
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
      return (
        <span className="font-mono text-xs tabular-nums text-slate-900">
          {Number(val).toLocaleString('id-ID')}
        </span>
      );
    }
    if (field.type === 'url-list') {
      const list = Array.isArray(val) ? val.filter(Boolean) : [];
      if (list.length === 0) return <span className="text-slate-300 select-none">—</span>;
      return (
        <span className="font-mono text-xs text-slate-600 tabular-nums truncate">
          {list.length} {list.length === 1 ? 'link' : 'links'}
        </span>
      );
    }
    return <span className="text-xs text-slate-800 truncate">{String(val)}</span>;
  };

  return (
    <div className="space-y-3">
      {/* Unsaved Changes Notice Banner */}
      {hasChanges && (
        <div
          role="status"
          className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-3 rounded-xl bg-amber-50 border border-amber-300 text-amber-950"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
            <div className="text-xs leading-snug">
              <span className="font-semibold">Unsaved changes</span>
              <span className="mx-1.5 text-amber-700" aria-hidden="true">
                &middot;
              </span>
              <span className="tabular-nums">{changeSummaryText}</span>
              <span className="text-amber-800"> — save changes before navigating away.</span>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleDiscardAll}
              disabled={saving}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-amber-900 bg-white border border-amber-300 hover:bg-amber-100/70 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Discard
            </button>
            <button
              type="button"
              onClick={handleSaveAll}
              disabled={saving}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap"
            >
              <Save className="w-3.5 h-3.5" />
              {saving ? 'Saving...' : 'Save All Changes'}
            </button>
          </div>
        </div>
      )}

      {/* Spreadsheet Action & Formula Bar */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-3.5 py-2.5 border-b border-slate-200 bg-slate-50/70 flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleAddRow}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-teal-800 bg-white border border-teal-300 hover:bg-teal-50 rounded-lg transition-colors whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Row
            </button>
            <button
              type="button"
              onClick={handleCopySelection}
              disabled={!selection}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-40 rounded-lg transition-colors whitespace-nowrap"
            >
              <ClipboardCopy className="w-3.5 h-3.5" />
              Copy
            </button>
            <button
              type="button"
              onClick={handleClearSelectedCells}
              disabled={!selection}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-40 rounded-lg transition-colors whitespace-nowrap"
            >
              <Eraser className="w-3.5 h-3.5" />
              Clear Cell(s)
            </button>
          </div>

          <div className="flex items-center gap-3 text-xs text-slate-500 min-w-0">
            {activeCellInfo ? (
              <span className="truncate font-mono text-[11px] text-slate-700">
                {activeCellInfo.rowLabel} &middot; {activeCellInfo.colLabel}
                {activeCellInfo.cellCount > 1 && ` (${activeCellInfo.cellCount} cells)`}
              </span>
            ) : (
              <span>
                Click cell to select &middot; Drag or Shift+Arrow for range &middot; Ctrl+C / Ctrl+V &middot; Delete to clear
              </span>
            )}
          </div>
        </div>

        {/* Sheet Grid */}
        <div
          ref={gridContainerRef}
          tabIndex={0}
          onKeyDown={handleGridKeyDown}
          onPaste={handleGridPaste}
          className="overflow-auto max-h-[68vh] focus:outline-none select-none"
        >
          <table className="w-full border-collapse text-left">
            <thead className="sticky top-0 z-20">
              <tr className="bg-slate-100 border-b border-slate-300 text-[11px] font-semibold text-slate-600">
                <th className="w-12 px-2 py-2 text-center border-r border-slate-200 bg-slate-100 sticky left-0 z-30">
                  #
                </th>
                <th className="min-w-[135px] px-3 py-2 border-r border-slate-200 whitespace-nowrap bg-slate-100">
                  ID
                </th>
                {columns.map((field) => (
                  <th
                    key={field.key}
                    className={`min-w-[155px] px-3 py-2 border-r border-slate-200 whitespace-nowrap ${
                      field.align === 'right' ? 'text-right' : 'text-left'
                    }`}
                  >
                    <span>{field.label}</span>
                    {field.type === 'ref' && (
                      <span className="ml-1 font-normal text-teal-700">(ref)</span>
                    )}
                  </th>
                ))}
                <th className="w-16 px-2 py-2 text-center bg-slate-100 whitespace-nowrap">
                  Row
                </th>
              </tr>
            </thead>
            <tbody>
              {sheetRows.map((row, rIdx) => {
                const isDeleted = deletedIds.has(row.rowKey);
                const rowError = rowErrors[row.rowKey];
                const isRowEdited =
                  row.isNew || Boolean(edits[row.rowKey]) || isDeleted;
                return (
                  <React.Fragment key={row.rowKey}>
                    <tr
                      className={`border-b border-slate-200 ${
                        isDeleted
                          ? 'bg-red-50/70 line-through opacity-70'
                          : rowError
                            ? 'bg-red-50/50'
                            : row.isNew
                              ? 'bg-[#F0FAF9]'
                              : 'bg-white'
                      }`}
                    >
                      {/* Excel-style Row Index Gutter */}
                      <td className="px-2 py-1.5 text-center font-mono text-[11px] text-slate-400 border-r border-slate-200 bg-slate-50 sticky left-0 z-10 tabular-nums">
                        {rIdx + 2}
                      </td>

                      {/* Read-only System ID Cell */}
                      <td className="px-3 py-1.5 border-r border-slate-200 whitespace-nowrap bg-slate-50/50">
                        <div className="flex items-center justify-between gap-1.5">
                          <span
                            className={`font-mono text-xs ${
                              row.isNew
                                ? 'text-teal-700 italic'
                                : isRowEdited
                                  ? 'font-semibold text-amber-800'
                                  : 'font-semibold text-teal-800'
                            }`}
                          >
                            {row.isNew ? '(new)' : row.rowKey}
                          </span>
                          {!row.isNew && (
                            <button
                              type="button"
                              onClick={() => onInspectRecord(row.rowKey)}
                              title="Inspect record details"
                              className="p-0.5 text-slate-400 hover:text-teal-700 rounded"
                            >
                              <ExternalLink className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </td>

                      {/* Editable Data & Reference Cells */}
                      {columns.map((field, cIdx) => {
                        const normRange = selection ? getNormalizedRange(selection) : null;
                        const inSelection =
                          normRange !== null &&
                          rIdx >= normRange.rMin &&
                          rIdx <= normRange.rMax &&
                          cIdx >= normRange.cMin &&
                          cIdx <= normRange.cMax;
                        const isAnchor =
                          selection?.anchor.r === rIdx && selection?.anchor.c === cIdx;
                        const isEditing =
                          editingCell?.r === rIdx && editingCell?.c === cIdx;
                        const dirty = isCellDirty(row, field.key);

                        return (
                          <td
                            key={field.key}
                            onMouseDown={(e) => {
                              if (isEditing) return;
                              if (e.button !== 0) return;
                              if (editingCell) {
                                commitActiveEdit();
                              }
                              if (e.shiftKey && selection) {
                                setSelection({
                                  anchor: selection.anchor,
                                  focus: { r: rIdx, c: cIdx },
                                });
                              } else {
                                isDraggingRef.current = true;
                                setSelection({
                                  anchor: { r: rIdx, c: cIdx },
                                  focus: { r: rIdx, c: cIdx },
                                });
                              }
                              gridContainerRef.current?.focus();
                            }}
                            onMouseEnter={() => {
                              if (isDraggingRef.current && selection) {
                                setSelection((prev) =>
                                  prev
                                    ? { anchor: prev.anchor, focus: { r: rIdx, c: cIdx } }
                                    : null
                                );
                              }
                            }}
                            onClick={() => {
                              if (isDeleted || isEditing) return;
                              // Single-click opens reference & select dropdowns immediately
                              if (field.type === 'ref' || field.type === 'select') {
                                startEditingCell(rIdx, cIdx);
                              }
                            }}
                            onDoubleClick={() => {
                              if (isDeleted) return;
                              startEditingCell(rIdx, cIdx);
                            }}
                            className={`relative px-2.5 py-1.5 border-r border-slate-200 max-w-[260px] cursor-cell align-middle ${
                              field.align === 'right' ? 'text-right' : 'text-left'
                            } ${
                              isAnchor
                                ? 'ring-2 ring-teal-600 ring-inset z-10 bg-white'
                                : inSelection
                                  ? 'bg-teal-50/75'
                                  : dirty && !row.isNew
                                    ? 'bg-amber-50/80'
                                    : ''
                            }`}
                          >
                            {isEditing && field.type === 'ref' && field.refEntity ? (
                              (() => {
                                const refEnt = field.refEntity;
                                const opts = refOptionsMap[refEnt] || [];
                                const q = dropdownSearch.trim();
                                const filtered = q
                                  ? rankBySimilarity(
                                      opts,
                                      q,
                                      (o) => extractEntitySearchFields(refEnt, o.raw),
                                      (o) => o.label
                                    ).map((r) => r.item)
                                  : opts;
                                const currentVal = String(getCellValue(row, field) ?? '');
                                return (
                                  <div
                                    className="relative"
                                    onMouseDown={(e) => e.stopPropagation()}
                                  >
                                    <div className="flex items-center justify-between gap-1 text-xs font-mono text-teal-800">
                                      <span className="truncate">
                                        {currentVal || 'Select reference...'}
                                      </span>
                                      <ChevronDown className="w-3 h-3 shrink-0" />
                                    </div>
                                    <div className="absolute left-0 top-full mt-1 z-40 w-80 bg-white border border-slate-300 rounded-lg shadow-lg overflow-hidden text-left">
                                      <div className="p-1.5 border-b border-slate-100 bg-slate-50 space-y-1.5">
                                        <div className="relative">
                                          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2 top-1/2 -translate-y-1/2" />
                                          <input
                                            ref={dropdownSearchRef}
                                            type="text"
                                            value={dropdownSearch}
                                            onChange={(e) => setDropdownSearch(e.target.value)}
                                            onKeyDown={(e) => {
                                              if (e.key === 'Escape') {
                                                e.stopPropagation();
                                                setEditingCell(null);
                                                setDropdownSearch('');
                                                gridContainerRef.current?.focus();
                                              } else if (e.key === 'Enter' && filtered.length > 0) {
                                                e.preventDefault();
                                                e.stopPropagation();
                                                applyCellUpdate(rIdx, cIdx, filtered[0].id);
                                                setEditingCell(null);
                                                setDropdownSearch('');
                                                gridContainerRef.current?.focus();
                                              }
                                            }}
                                            placeholder={`Flexible search ${ENTITY_META[refEnt].plural.toLowerCase()}...`}
                                            className="w-full pl-7 pr-2 py-1 text-xs bg-white border border-slate-200 rounded focus:outline-none focus:border-teal-700"
                                          />
                                        </div>
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setEditingCell(null);
                                            setDropdownSearch('');
                                            openLayer({
                                              kind: 'pick-ref',
                                              entity: refEnt,
                                              title: `Select ${field.label}`,
                                              selectedIds: currentVal ? [currentVal] : [],
                                              onSelect: (ids, pickedRecs) => {
                                                const chosen = pickedRecs[0];
                                                if (chosen) {
                                                  setRefOptionsMap((prev) => {
                                                    const list = prev[refEnt] || [];
                                                    if (list.some((o) => o.id === chosen.id)) {
                                                      return prev;
                                                    }
                                                    return {
                                                      ...prev,
                                                      [refEnt]: [
                                                        formatRefOption(refEnt, chosen),
                                                        ...list,
                                                      ],
                                                    };
                                                  });
                                                }
                                                applyCellUpdate(rIdx, cIdx, ids[0] || '');
                                              },
                                            });
                                          }}
                                          className="w-full px-2 py-1 text-[11px] font-semibold text-teal-800 bg-[#EFF8F8] hover:bg-teal-100/70 rounded flex items-center justify-center gap-1.5 transition-colors"
                                        >
                                          <ExternalLink className="w-3 h-3" />
                                          Open Full Search Layer ({ENTITY_META[refEnt].plural})
                                        </button>
                                      </div>
                                      <div className="max-h-52 overflow-y-auto divide-y divide-slate-100">
                                        {field.optional && (
                                          <button
                                            type="button"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              applyCellUpdate(rIdx, cIdx, '');
                                              setEditingCell(null);
                                              setDropdownSearch('');
                                              gridContainerRef.current?.focus();
                                            }}
                                            className="w-full px-3 py-2 text-left text-xs text-slate-500 hover:bg-slate-50 italic"
                                          >
                                            (Clear / None)
                                          </button>
                                        )}
                                        {filtered.length === 0 ? (
                                          <div className="px-3 py-3 text-xs text-slate-400 text-center">
                                            No matching records
                                          </div>
                                        ) : (
                                          filtered.slice(0, 60).map((opt) => (
                                            <button
                                              key={opt.id}
                                              type="button"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                applyCellUpdate(rIdx, cIdx, opt.id);
                                                setEditingCell(null);
                                                setDropdownSearch('');
                                                gridContainerRef.current?.focus();
                                              }}
                                              className={`w-full px-3 py-2 text-left text-xs hover:bg-[#EFF8F8] transition-colors flex flex-col ${
                                                currentVal === opt.id
                                                  ? 'bg-[#EFF8F8] font-semibold'
                                                  : ''
                                              }`}
                                            >
                                              <span className="font-mono text-teal-800">
                                                {opt.id}
                                              </span>
                                              {opt.label !== opt.id && (
                                                <span className="text-[11px] text-slate-600 truncate">
                                                  {opt.label.slice(opt.id.length + 3)}
                                                </span>
                                              )}
                                            </button>
                                          ))
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                );
                              })()
                            ) : isEditing && field.type === 'select' && field.options ? (
                              <div
                                className="relative"
                                onMouseDown={(e) => e.stopPropagation()}
                              >
                                <div className="flex items-center justify-between gap-1 text-xs font-medium text-teal-800">
                                  <span className="truncate">
                                    {String(getCellValue(row, field) || 'Select...')}
                                  </span>
                                  <ChevronDown className="w-3 h-3 shrink-0" />
                                </div>
                                <div className="absolute left-0 top-full mt-1 z-40 w-44 bg-white border border-slate-300 rounded-lg shadow-lg overflow-hidden text-left">
                                  <div className="max-h-52 overflow-y-auto divide-y divide-slate-100">
                                    {field.options.map((opt) => (
                                      <button
                                        key={opt.value}
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          applyCellUpdate(rIdx, cIdx, opt.value);
                                          setEditingCell(null);
                                          gridContainerRef.current?.focus();
                                        }}
                                        className={`w-full px-3 py-2 text-left text-xs hover:bg-[#EFF8F8] ${
                                          String(getCellValue(row, field)) === opt.value
                                            ? 'bg-[#EFF8F8] font-semibold text-teal-900'
                                            : 'text-slate-700'
                                        }`}
                                      >
                                        {opt.label}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              </div>
                            ) : isEditing ? (
                              <input
                                ref={activeInputRef}
                                type={field.type === 'date' ? 'date' : 'text'}
                                value={editDraft}
                                onChange={(e) => setEditDraft(e.target.value)}
                                onBlur={commitActiveEdit}
                                onMouseDown={(e) => e.stopPropagation()}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    applyCellUpdate(rIdx, cIdx, editDraft);
                                    setEditingCell(null);
                                    const nextR = Math.min(sheetRows.length - 1, rIdx + 1);
                                    setSelection({
                                      anchor: { r: nextR, c: cIdx },
                                      focus: { r: nextR, c: cIdx },
                                    });
                                    gridContainerRef.current?.focus();
                                  } else if (e.key === 'Tab') {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    applyCellUpdate(rIdx, cIdx, editDraft);
                                    setEditingCell(null);
                                    const dir = e.shiftKey ? -1 : 1;
                                    const nextC = Math.max(
                                      0,
                                      Math.min(columns.length - 1, cIdx + dir)
                                    );
                                    setSelection({
                                      anchor: { r: rIdx, c: nextC },
                                      focus: { r: rIdx, c: nextC },
                                    });
                                    gridContainerRef.current?.focus();
                                  } else if (e.key === 'Escape') {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    setEditingCell(null);
                                    gridContainerRef.current?.focus();
                                  }
                                }}
                                className={`w-full px-1 py-0.5 text-xs bg-white focus:outline-none ${
                                  field.align === 'right'
                                    ? 'text-right font-mono tabular-nums'
                                    : ''
                                }`}
                              />
                            ) : (
                              <div className="truncate">{renderCellDisplay(row, field)}</div>
                            )}
                          </td>
                        );
                      })}

                      {/* Row Delete / Restore Toggle */}
                      <td className="px-2 py-1.5 text-center whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => handleToggleDeleteRow(row)}
                          title={
                            row.isNew
                              ? 'Remove unsaved row'
                              : isDeleted
                                ? 'Undo row deletion'
                                : 'Mark row for deletion'
                          }
                          className={`p-1 rounded transition-colors ${
                            isDeleted
                              ? 'text-teal-700 hover:bg-teal-50'
                              : 'text-slate-400 hover:text-red-700 hover:bg-red-50'
                          }`}
                        >
                          {isDeleted ? (
                            <Undo2 className="w-3.5 h-3.5" />
                          ) : (
                            <Trash2 className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </td>
                    </tr>

                    {rowError && (
                      <tr className="bg-red-50 border-b border-red-200">
                        <td
                          colSpan={columns.length + 3}
                          className="px-4 py-1.5 text-xs text-red-700"
                        >
                          Error on {row.isNew ? 'new row' : row.rowKey}: {rowError}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}

              {sheetRows.length === 0 && (
                <tr>
                  <td
                    colSpan={columns.length + 3}
                    className="px-6 py-10 text-center text-sm text-slate-500"
                  >
                    No rows yet. Click <span className="font-semibold text-teal-800">Add Row</span> above to start entering data.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Sheet Footer */}
        <div className="px-4 py-2 border-t border-slate-200 bg-slate-50/50 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 tabular-nums">
          <span>
            {sheetRows.length} {sheetRows.length === 1 ? 'row' : 'rows'} &middot;{' '}
            {columns.length} editable columns
            {modifiedRowCount > 0 && ` · ${modifiedRowCount} row(s) modified`}
          </span>
          <span>
            Click reference cells for dropdown &middot; Double-click or type to edit &middot; Ctrl+S to save
          </span>
        </div>
      </div>
    </div>
  );
}
