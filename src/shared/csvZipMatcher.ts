export const CSV_IMPORT_BATCH_SIZE = 500;

export interface CsvBatchChunk {
  batchIndex: number;
  batchNumber: number;
  totalBatches: number;
  startIndex: number;
  endIndex: number;
  excelRowStart: number;
  excelRowEnd: number;
  excelRowOffset: number;
  rowCount: number;
  csvText: string;
}

export interface CsvBatchPlan {
  delimiter: string;
  headerLine: string;
  totalDataRows: number;
  batches: CsvBatchChunk[];
}

export interface SanitizedZipEntry<T = unknown> {
  rawPath: string;
  baseName: string;
  baseLower: string;
  extLower: string;
  stemLower: string;
  payload: T;
}

export const ALLOWED_ZIP_ATTACHMENT_EXTS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.pdf',
]);

const IGNORED_OS_FILES = new Set(['thumbs.db', '.ds_store', 'desktop.ini']);

export function isExistingAssetUrl(val: string): boolean {
  const lower = val.trim().toLowerCase();
  return (
    lower.startsWith('http://') ||
    lower.startsWith('https://') ||
    lower.startsWith('/assets/') ||
    lower.startsWith('/uploads/')
  );
}

export function normalizeCsvHeaderShared(rawHeader: string): string {
  return rawHeader
    .replace(/^\uFEFF/, '')
    .replace(/\s*\([\s\S]*$/g, '')
    .replace(/\s*\[[\s\S]*$/g, '')
    .trim()
    .toLowerCase();
}

export function parseCsvLineShared(line: string, delimiter = ','): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function countUnquotedDelimiterShared(line: string, delimiter: string): number {
  let count = 0;
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      count += 1;
    }
  }
  return count;
}

/**
 * RFC-4180 quote-aware CSV record splitter.
 * Preserves embedded newlines inside quoted cells (e.g. `"1. No Plat:\n2. Jenis:"`)
 * so Excel rows never fracture into broken lines.
 */
export function splitCsvRecordsQuoteAware(rawCsv: string): {
  records: string[];
  hasUnterminatedQuote: boolean;
} {
  const cleaned = rawCsv.replace(/^\uFEFF/, '');
  const records: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < cleaned.length; i += 1) {
    const ch = cleaned[i];
    if (ch === '"') {
      if (inQuotes && cleaned[i + 1] === '"') {
        current += '""';
        i += 1;
      } else {
        inQuotes = !inQuotes;
        current += ch;
      }
    } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && cleaned[i + 1] === '\n') {
        i += 1;
      }
      if (current.trim().length > 0) {
        records.push(current.trim());
      }
      current = '';
    } else {
      current += ch;
    }
  }

  if (current.trim().length > 0) {
    records.push(current.trim());
  }

  return {
    records,
    hasUnterminatedQuote: inQuotes,
  };
}

export function extractCsvDelimiterAndLinesShared(rawCsv: string): {
  delimiter: string;
  lines: string[];
  rowOffset: number;
  hasUnterminatedQuote: boolean;
} {
  const { records, hasUnterminatedQuote } = splitCsvRecordsQuoteAware(rawCsv);
  let lines = records;

  let delimiter = ',';
  let rowOffset = 0;

  if (lines.length > 0) {
    const firstUnquoted = lines[0].replace(/^"(.*)"$/, '$1').trim();
    const sepMatch = /^sep=(.)\s*$/i.exec(firstUnquoted);
    if (sepMatch) {
      delimiter = sepMatch[1];
      lines = lines.slice(1);
      rowOffset = 1;
    } else {
      const header = lines[0];
      const candidates = [',', ';', '\t'];
      let best = ',';
      let bestCount = countUnquotedDelimiterShared(header, ',');
      for (const cand of candidates.slice(1)) {
        const c = countUnquotedDelimiterShared(header, cand);
        if (c > bestCount) {
          best = cand;
          bestCount = c;
        }
      }
      delimiter = best;
    }
  }

  return { delimiter, lines, rowOffset, hasUnterminatedQuote };
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

export function isIgnoredZipPath(rawPath: string, isDir = false): boolean {
  if (isDir) return true;
  const normalized = rawPath.replace(/\\/g, '/').replace(/^\/+/, '').trim();
  if (!normalized) return true;
  const segments = normalized.split('/');
  for (const seg of segments) {
    if (!seg) continue;
    const lower = seg.toLowerCase();
    if (lower === '__macosx' || seg === '..' || seg.startsWith('.')) {
      return true;
    }
  }
  const baseLower = segments[segments.length - 1].toLowerCase();
  if (IGNORED_OS_FILES.has(baseLower)) {
    return true;
  }
  return false;
}

export function sanitizeZipEntries<T>(
  rawEntries: Array<{ rawPath: string; isDir?: boolean; payload: T }>
): SanitizedZipEntry<T>[] {
  const out: SanitizedZipEntry<T>[] = [];
  for (const item of rawEntries) {
    if (isIgnoredZipPath(item.rawPath, item.isDir)) continue;
    const normalized = item.rawPath.replace(/\\/g, '/').replace(/^\/+/, '');
    const baseName = normalized.split('/').pop() || '';
    if (!baseName || baseName.startsWith('.')) continue;
    const dotIdx = baseName.lastIndexOf('.');
    if (dotIdx <= 0) continue;
    const extLower = baseName.slice(dotIdx).toLowerCase();
    if (!ALLOWED_ZIP_ATTACHMENT_EXTS.has(extLower)) continue;
    const baseLower = baseName.toLowerCase();
    const stemLower = baseLower.slice(0, -extLower.length);
    out.push({
      rawPath: normalized,
      baseName,
      baseLower,
      extLower,
      stemLower,
      payload: item.payload,
    });
  }
  out.sort((a, b) => naturalCompare(a.baseName, b.baseName));
  return out;
}

interface RowSortKey {
  priority: number; // 0 = exact `{R}.{ext}`, 1 = numeric suffix `{R}-{num}...`, 2 = non-numeric suffix
  numVal: number;
  subRank: number; // 0 = pure numeric `{R}-{num}`, 1 = numeric with duplicate/extra text e.g. `{R}-{num} (copy)`
  baseName: string;
}

function classifyRowMatch(
  entry: SanitizedZipEntry<unknown>,
  excelRow: number
): RowSortKey | null {
  const rowStr = String(excelRow);
  // 1. Exact match: `{R}.{ext}` — strict boundary, never matches `20.jpg` for row 2
  if (entry.stemLower === rowStr) {
    return {
      priority: 0,
      numVal: 0,
      subRank: 0,
      baseName: entry.baseLower,
    };
  }
  // 2. Suffixed match: `{R}-(.+).{ext}` — strict hyphen after exact row number
  const prefix = `${rowStr}-`;
  if (!entry.stemLower.startsWith(prefix)) {
    return null;
  }
  const suffix = entry.stemLower.slice(prefix.length).trim();
  if (!suffix) return null;

  const pureNum = /^(\d+)$/.exec(suffix);
  if (pureNum) {
    return {
      priority: 1,
      numVal: Number.parseInt(pureNum[1], 10),
      subRank: 0,
      baseName: entry.baseLower,
    };
  }

  const leadingNum = /^(\d+)([\s._(-].*)$/.exec(suffix);
  if (leadingNum) {
    return {
      priority: 1,
      numVal: Number.parseInt(leadingNum[1], 10),
      subRank: 1,
      baseName: entry.baseLower,
    };
  }

  return {
    priority: 2,
    numVal: Number.MAX_SAFE_INTEGER,
    subRank: 0,
    baseName: entry.baseLower,
  };
}

/**
 * Matches all valid ZIP entries for an exact Excel row number `R` (Row 2 = first item),
 * enforcing strict boundary rules (Row 2 never matches Row 20/21) and deterministic sorting:
 *   1. Exact `{R}.{ext}` first
 *   2. Numeric suffixes `{R}-{num}.{ext}` ascending numerically (with duplicates like `2-2 (copy).jpg` immediately after `2-2.jpg`)
 *   3. Ties or non-numeric suffixes alphabetically by filename
 */
export function matchZipEntriesForExcelRow<T>(
  entries: SanitizedZipEntry<T>[],
  excelRow: number
): SanitizedZipEntry<T>[] {
  const matched: Array<{ entry: SanitizedZipEntry<T>; key: RowSortKey }> = [];

  for (const entry of entries) {
    const key = classifyRowMatch(entry, excelRow);
    if (key) {
      matched.push({ entry, key });
    }
  }

  matched.sort((a, b) => {
    if (a.key.priority !== b.key.priority) return a.key.priority - b.key.priority;
    if (a.key.numVal !== b.key.numVal) return a.key.numVal - b.key.numVal;
    if (a.key.subRank !== b.key.subRank) return a.key.subRank - b.key.subRank;
    return naturalCompare(a.key.baseName, b.key.baseName);
  });

  return matched.map((m) => m.entry);
}

/**
 * Matches explicit non-URL filename or prefix tokens written in a CSV cell (pipe-separated).
 */
export function matchZipEntriesForExplicitToken<T>(
  entries: SanitizedZipEntry<T>[],
  token: string,
  allowNumberedSeries: boolean
): SanitizedZipEntry<T>[] {
  const normalized = token.replace(/\\/g, '/').replace(/^\/+/, '').trim().toLowerCase();
  if (!normalized) return [];
  const baseLookup = normalized.split('/').pop() || normalized;

  const exact = entries.find(
    (e) => e.rawPath.toLowerCase() === normalized || e.baseLower === baseLookup
  );

  const dotIdx = baseLookup.lastIndexOf('.');
  const stem = dotIdx > 0 ? baseLookup.slice(0, dotIdx) : baseLookup;
  const stemRegex = new RegExp(`^${escapeRegExp(stem)}$`, 'i');

  if (!allowNumberedSeries) {
    if (exact) return [exact];
    const fallback = entries.find((e) => stemRegex.test(e.stemLower));
    return fallback ? [fallback] : [];
  }

  // If the explicit token is purely a row number (e.g. "2"), reuse strict row matching
  if (/^\d+$/.test(stem) && dotIdx <= 0) {
    return matchZipEntriesForExcelRow(entries, Number.parseInt(stem, 10));
  }

  const seriesRegex = new RegExp(`^${escapeRegExp(stem)}[-_ ](\\d+)(.*)$`, 'i');
  const exactMatches: SanitizedZipEntry<T>[] = [];
  const numberedMatches: Array<{ entry: SanitizedZipEntry<T>; num: number; extra: string }> = [];

  for (const e of entries) {
    if (e.baseLower === baseLookup || stemRegex.test(e.stemLower)) {
      exactMatches.push(e);
      continue;
    }
    const m = seriesRegex.exec(e.stemLower);
    if (m) {
      numberedMatches.push({
        entry: e,
        num: Number.parseInt(m[1], 10),
        extra: (m[2] || '').trim(),
      });
    }
  }

  numberedMatches.sort((a, b) => {
    if (a.num !== b.num) return a.num - b.num;
    if (Boolean(a.extra) !== Boolean(b.extra)) return a.extra ? 1 : -1;
    return naturalCompare(a.entry.baseLower, b.entry.baseLower);
  });

  const combined: SanitizedZipEntry<T>[] = [];
  const seen = new Set<string>();
  const pushUnique = (item: SanitizedZipEntry<T>) => {
    if (!seen.has(item.rawPath)) {
      seen.add(item.rawPath);
      combined.push(item);
    }
  };
  if (exact) pushUnique(exact);
  for (const m of exactMatches) pushUnique(m);
  for (const m of numberedMatches) pushUnique(m.entry);

  return combined;
}

export interface ZipRowWarnings {
  rowOneFiles: string[];
  outOfRangeFiles: Array<{ fileName: string; rowNumber: number }>;
}

/**
 * Inspects sanitized ZIP entries against the CSV's max Excel row (`dataRows.length + 1`)
 * to surface proactive dry-run warnings for Row 1 headers (`1.*` / `1-*`) and out-of-range prefixes.
 */
export function analyzeZipRowWarnings(
  entries: SanitizedZipEntry<unknown>[],
  maxExcelRow: number
): ZipRowWarnings {
  const rowOneFiles: string[] = [];
  const outOfRangeFiles: Array<{ fileName: string; rowNumber: number }> = [];

  for (const entry of entries) {
    const m = /^(\d+)(?:-|$)/.exec(entry.stemLower);
    if (!m) continue;
    const rowNum = Number.parseInt(m[1], 10);
    if (!Number.isFinite(rowNum)) continue;
    if (rowNum === 1) {
      rowOneFiles.push(entry.baseName);
    } else if (rowNum > maxExcelRow && maxExcelRow >= 2) {
      outOfRangeFiles.push({ fileName: entry.baseName, rowNumber: rowNum });
    }
  }

  return { rowOneFiles, outOfRangeFiles };
}

export interface ResolvedRowAttachmentPlan<T = unknown> {
  existingUrls: string[];
  matchedZipEntries: SanitizedZipEntry<T>[];
  mode: 'none' | 'auto_row' | 'explicit_override' | 'update_append' | 'update_replace';
  missingExplicitTokens: string[];
}

/**
 * Resolves attachment matching for one CSV row's URL or URL-list field.
 *
 * Rules:
 * - Explicit override: If cell contains non-URL tokens (pipe-separated `|`), resolve those tokens in ZIP
 *   while preserving any `http://`/`https://` URLs in the same cell.
 * - Empty cell: Auto-match ZIP files by exact Excel row number `R` (`R.ext`, `R-*.ext`).
 * - Existing URL(s) in cell + ZIP uploaded:
 *   - If ZIP contains files matching Excel row `R`:
 *     - `url-list`: preserve existing URLs and APPEND the matched ZIP files.
 *     - `url` (single): REPLACE the existing URL with the first matched ZIP file.
 *   - If ZIP has no files matching row `R`: preserve existing URLs untouched.
 */
export function resolveRowAttachments<T>(params: {
  rawCell: string;
  fieldType: 'url' | 'url-list';
  excelRow: number;
  zipEntries: SanitizedZipEntry<T>[];
}): ResolvedRowAttachmentPlan<T> {
  const { rawCell, fieldType, excelRow, zipEntries } = params;
  const trimmed = rawCell.trim();

  // Case 1: Cell is empty -> pure Excel Row Auto-Match
  if (!trimmed) {
    if (zipEntries.length === 0) {
      return {
        existingUrls: [],
        matchedZipEntries: [],
        mode: 'none',
        missingExplicitTokens: [],
      };
    }
    const rowMatches = matchZipEntriesForExcelRow(zipEntries, excelRow);
    const chosen =
      fieldType === 'url' ? rowMatches.slice(0, 1) : rowMatches;
    return {
      existingUrls: [],
      matchedZipEntries: chosen,
      mode: chosen.length > 0 ? 'auto_row' : 'none',
      missingExplicitTokens: [],
    };
  }

  // Split tokens for url-list (pipe-separated primarily, also supports semicolon)
  const rawTokens =
    fieldType === 'url-list'
      ? trimmed
          .split(/[|;]/)
          .map((t) => t.trim())
          .filter(Boolean)
      : [trimmed];

  const existingUrls: string[] = [];
  const explicitTokens: string[] = [];

  for (const tok of rawTokens) {
    if (isExistingAssetUrl(tok)) {
      existingUrls.push(tok);
    } else {
      explicitTokens.push(tok);
    }
  }

  // Case 2: Explicit non-URL filenames/prefixes provided in the cell
  if (explicitTokens.length > 0) {
    const matchedZipEntries: SanitizedZipEntry<T>[] = [];
    const seen = new Set<string>();
    const missingExplicitTokens: string[] = [];

    for (const tok of explicitTokens) {
      const matches = matchZipEntriesForExplicitToken(
        zipEntries,
        tok,
        fieldType === 'url-list'
      );
      if (matches.length === 0) {
        missingExplicitTokens.push(tok);
      } else {
        for (const m of matches) {
          if (!seen.has(m.rawPath)) {
            seen.add(m.rawPath);
            matchedZipEntries.push(m);
          }
        }
      }
    }

    const chosen =
      fieldType === 'url'
        ? matchedZipEntries.slice(0, 1)
        : matchedZipEntries;

    return {
      existingUrls: fieldType === 'url' && chosen.length > 0 ? [] : existingUrls,
      matchedZipEntries: chosen,
      mode: 'explicit_override',
      missingExplicitTokens,
    };
  }

  // Case 3: Cell has existing URL(s) only (e.g., Update Mode CSV) -> check if ZIP has files for Excel row R
  if (zipEntries.length > 0) {
    const rowMatches = matchZipEntriesForExcelRow(zipEntries, excelRow);
    if (rowMatches.length > 0) {
      if (fieldType === 'url-list') {
        return {
          existingUrls,
          matchedZipEntries: rowMatches,
          mode: 'update_append',
          missingExplicitTokens: [],
        };
      }
      return {
        existingUrls: [],
        matchedZipEntries: rowMatches.slice(0, 1),
        mode: 'update_replace',
        missingExplicitTokens: [],
      };
    }
  }

  return {
    existingUrls,
    matchedZipEntries: [],
    mode: 'none',
    missingExplicitTokens: [],
  };
}

function serializeBatchCsv(
  delimiter: string,
  headerLine: string,
  dataLines: string[]
): string {
  const body = [headerLine, ...dataLines].join('\n');
  if (delimiter !== ',' && delimiter !== ';') {
    return `sep=${delimiter}\n${body}`;
  }
  return body;
}

/**
 * Splits any CSV (no row limit) into sequential chunks of `batchSize` (default 500)
 * while preserving exact Excel row numbers (`excelRowOffset = startIndex`).
 */
export function buildCsvBatches(
  rawCsv: string,
  batchSize = CSV_IMPORT_BATCH_SIZE
): CsvBatchPlan {
  const { delimiter, lines } = extractCsvDelimiterAndLinesShared(rawCsv);
  if (lines.length < 2) {
    return {
      delimiter,
      headerLine: lines[0] || '',
      totalDataRows: 0,
      batches: [],
    };
  }

  const headerLine = lines[0];
  const dataLines = lines.slice(1);
  const safeBatchSize = Math.max(1, Math.floor(batchSize));
  const totalBatches = Math.ceil(dataLines.length / safeBatchSize);
  const batches: CsvBatchChunk[] = [];

  for (let b = 0; b < totalBatches; b += 1) {
    const startIndex = b * safeBatchSize;
    const endIndex = Math.min(dataLines.length, startIndex + safeBatchSize);
    const slice = dataLines.slice(startIndex, endIndex);
    batches.push({
      batchIndex: b,
      batchNumber: b + 1,
      totalBatches,
      startIndex,
      endIndex,
      excelRowStart: startIndex + 2,
      excelRowEnd: endIndex + 1,
      excelRowOffset: startIndex,
      rowCount: slice.length,
      csvText: serializeBatchCsv(delimiter, headerLine, slice),
    });
  }

  return {
    delimiter,
    headerLine,
    totalDataRows: dataLines.length,
    batches,
  };
}

/**
 * Splits an accounting Single-CSV ledger file into ~`targetBatchSize` (default 500)
 * batches without ever splitting rows that share the same `rcrd_id` or `group_no`.
 */
export function buildLedgerCsvBatches(
  rawCsv: string,
  targetBatchSize = CSV_IMPORT_BATCH_SIZE
): CsvBatchPlan {
  const { delimiter, lines } = extractCsvDelimiterAndLinesShared(rawCsv);
  if (lines.length < 2) {
    return {
      delimiter,
      headerLine: lines[0] || '',
      totalDataRows: 0,
      batches: [],
    };
  }

  const headerLine = lines[0];
  const dataLines = lines.slice(1);
  const headers = parseCsvLineShared(headerLine, delimiter).map((h) =>
    h.trim().toLowerCase()
  );
  const rcrdIdx = headers.indexOf('rcrd_id');
  const groupIdx = headers.indexOf('group_no');
  const safeBatchSize = Math.max(1, Math.floor(targetBatchSize));

  // Collect complete transaction groups in order of first appearance so split
  // double-entry lines are never broken across two separate batch requests.
  const groupBuckets = new Map<string, string[]>();
  for (let i = 0; i < dataLines.length; i += 1) {
    const line = dataLines[i];
    const cols = parseCsvLineShared(line, delimiter);
    const rcrdVal = rcrdIdx >= 0 ? (cols[rcrdIdx] || '').trim() : '';
    const groupVal = groupIdx >= 0 ? (cols[groupIdx] || '').trim() : '';
    const key = rcrdVal
      ? `RCRD:${rcrdVal.toUpperCase()}`
      : groupVal
        ? `GRP:${groupVal.toUpperCase()}`
        : `ROW:${i}`;
    const existing = groupBuckets.get(key);
    if (existing) {
      existing.push(line);
    } else {
      groupBuckets.set(key, [line]);
    }
  }

  const rawChunks: string[][] = [];
  let currentChunk: string[] = [];

  for (const groupLines of groupBuckets.values()) {
    if (
      currentChunk.length > 0 &&
      currentChunk.length + groupLines.length > safeBatchSize
    ) {
      rawChunks.push(currentChunk);
      currentChunk = [];
    }
    currentChunk.push(...groupLines);
  }
  if (currentChunk.length > 0) {
    rawChunks.push(currentChunk);
  }

  const totalBatches = rawChunks.length;
  const batches: CsvBatchChunk[] = [];
  let cursor = 0;

  for (let b = 0; b < totalBatches; b += 1) {
    const slice = rawChunks[b];
    const startIndex = cursor;
    const endIndex = cursor + slice.length;
    cursor = endIndex;
    batches.push({
      batchIndex: b,
      batchNumber: b + 1,
      totalBatches,
      startIndex,
      endIndex,
      excelRowStart: startIndex + 2,
      excelRowEnd: endIndex + 1,
      excelRowOffset: startIndex,
      rowCount: slice.length,
      csvText: serializeBatchCsv(delimiter, headerLine, slice),
    });
  }

  return {
    delimiter,
    headerLine,
    totalDataRows: dataLines.length,
    batches,
  };
}

export interface CsvValidationFieldSpec {
  key: string;
  label: string;
  type: string;
  required?: boolean;
  optional?: boolean;
  options?: Array<{ value: string; label: string }>;
}

export interface CsvRowValidationIssue {
  excelRow: number;
  rowHint?: string;
  message: string;
}

export interface CsvFileHealthReport {
  delimiter: string;
  totalDataRows: number;
  headers: string[];
  hasUnterminatedQuote: boolean;
  headerErrors: string[];
  headerWarnings: string[];
  rowIssues: CsvRowValidationIssue[];
  rowIssuesByExcelRow: Map<number, string[]>;
  isHealthy: boolean;
}

/**
 * Validates the entire uploaded CSV before importing so users can spot
 * structural, header, or row-level issues (missing required fields, wrong
 * column names, invalid numbers/dates/selects, unterminated quotes) in preview.
 */
export function validateEntityCsvFile(params: {
  csvText: string;
  fields: CsvValidationFieldSpec[];
  mode: 'insert' | 'update';
  existingIds?: Set<string>;
}): CsvFileHealthReport {
  const { csvText, fields, mode, existingIds } = params;
  const { delimiter, lines, hasUnterminatedQuote } =
    extractCsvDelimiterAndLinesShared(csvText);

  const headerErrors: string[] = [];
  const headerWarnings: string[] = [];
  const rowIssues: CsvRowValidationIssue[] = [];
  const rowIssuesByExcelRow = new Map<number, string[]>();

  if (lines.length === 0) {
    return {
      delimiter,
      totalDataRows: 0,
      headers: [],
      hasUnterminatedQuote,
      headerErrors: ['CSV file is empty.'],
      headerWarnings: [],
      rowIssues: [],
      rowIssuesByExcelRow,
      isHealthy: false,
    };
  }

  const rawHeaders = parseCsvLineShared(lines[0], delimiter);
  const headers = rawHeaders.map(normalizeCsvHeaderShared);
  const allowedKeys = new Set<string>(['id', ...fields.map((f) => f.key.toLowerCase())]);

  if (hasUnterminatedQuote) {
    headerErrors.push(
      'Unclosed quotation mark (") detected in CSV. Check for stray quotes inside a cell.'
    );
  }

  if (lines.length < 2) {
    headerErrors.push('CSV contains a header row only and zero data rows.');
  }

  // Check duplicate headers & unknown headers
  const seenHeaders = new Set<string>();
  const unknownHeaders: string[] = [];
  const duplicateHeaders: string[] = [];
  for (const h of headers) {
    if (!h) continue;
    if (seenHeaders.has(h)) {
      duplicateHeaders.push(h);
    } else {
      seenHeaders.add(h);
    }
    if (!allowedKeys.has(h)) {
      unknownHeaders.push(h);
    }
  }

  if (duplicateHeaders.length > 0) {
    headerErrors.push(`Duplicate column header(s): ${duplicateHeaders.join(', ')}.`);
  }

  if (unknownHeaders.length > 0) {
    const validList = (mode === 'update' ? ['id'] : [])
      .concat(fields.map((f) => f.key))
      .join(', ');
    headerWarnings.push(
      `Unrecognized column(s) will be ignored: ${unknownHeaders.join(', ')}. Expected columns: ${validList}.`
    );
  }

  // Required columns check
  const missingRequiredCols = fields
    .filter((f) => f.required && !seenHeaders.has(f.key.toLowerCase()))
    .map((f) => f.key);
  if (mode === 'insert' && missingRequiredCols.length > 0) {
    headerErrors.push(
      `Missing required column(s): ${missingRequiredCols.join(', ')}.`
    );
  }

  if (mode === 'insert' && seenHeaders.has('id')) {
    headerWarnings.push(
      'Insert mode ignores the "id" column and auto-generates new sequential IDs. Switch to Update mode if you want to update existing IDs.'
    );
  }
  if (mode === 'update' && !seenHeaders.has('id')) {
    headerWarnings.push(
      'No "id" column found — in Update mode, all rows without an existing ID will be inserted as new records.'
    );
  }

  const pushRowIssue = (excelRow: number, message: string, rowHint?: string) => {
    rowIssues.push({ excelRow, rowHint, message });
    const list = rowIssuesByExcelRow.get(excelRow);
    if (list) {
      list.push(message);
    } else {
      rowIssuesByExcelRow.set(excelRow, [message]);
    }
  };

  const seenUpdateIds = new Set<string>();

  for (let i = 1; i < lines.length; i += 1) {
    const excelRow = i + 1;
    const values = parseCsvLineShared(lines[i], delimiter);
    const rowObj: Record<string, string> = {};
    headers.forEach((h, idx) => {
      if (h) rowObj[h] = (values[idx] ?? '').trim();
    });

    const firstNonEmpty = values.find((v) => v.trim().length > 0)?.trim();
    const rowHint =
      rowObj.item_code ||
      rowObj.id ||
      rowObj.username ||
      rowObj.name ||
      rowObj.title ||
      (firstNonEmpty ? firstNonEmpty.slice(0, 28) : undefined);

    if (values.length > headers.length) {
      pushRowIssue(
        excelRow,
        `Has ${values.length} columns, but header has ${headers.length} (check unquoted "${delimiter}" delimiters).`,
        rowHint
      );
    }

    const rawId = (rowObj.id || '').trim();
    const isExistingUpdateRow =
      mode === 'update' &&
      Boolean(rawId) &&
      Boolean(existingIds?.has(rawId.toUpperCase()));

    if (mode === 'update' && rawId) {
      const upperId = rawId.toUpperCase();
      if (seenUpdateIds.has(upperId)) {
        pushRowIssue(
          excelRow,
          `Duplicate ID "${rawId}" appears more than once in this CSV.`,
          rowHint
        );
      } else {
        seenUpdateIds.add(upperId);
      }
    }

    for (const field of fields) {
      const key = field.key.toLowerCase();
      const hasCol = seenHeaders.has(key);
      const val = hasCol ? (rowObj[key] ?? '') : '';

      // Required field check (for insert rows or newly inserted rows in update mode)
      if (field.required && !isExistingUpdateRow && !val) {
        if (hasCol) {
          pushRowIssue(
            excelRow,
            `Missing required field "${field.label}" (${field.key}).`,
            rowHint
          );
        }
        continue;
      }

      if (!val) continue;

      if (field.type === 'number' || field.type === 'currency') {
        const cleanedNum = val.replace(/,/g, '');
        if (!Number.isFinite(Number(cleanedNum))) {
          pushRowIssue(
            excelRow,
            `"${field.label}" must be a valid number (got "${val}").`,
            rowHint
          );
        }
      } else if (field.type === 'select' && field.options?.length) {
        const validValues = field.options.map((o) => o.value.toLowerCase());
        if (!validValues.includes(val.toLowerCase())) {
          pushRowIssue(
            excelRow,
            `"${field.label}" has invalid value "${val}" (expected: ${field.options
              .map((o) => o.value)
              .join(', ')}).`,
            rowHint
          );
        }
      } else if (field.type === 'date') {
        if (Number.isNaN(Date.parse(val))) {
          pushRowIssue(
            excelRow,
            `"${field.label}" is not a valid date (got "${val}", use YYYY-MM-DD).`,
            rowHint
          );
        }
      } else if (field.type === 'email') {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) {
          pushRowIssue(
            excelRow,
            `"${field.label}" is not a valid email address (got "${val}").`,
            rowHint
          );
        }
      }
    }
  }

  return {
    delimiter,
    totalDataRows: Math.max(0, lines.length - 1),
    headers,
    hasUnterminatedQuote,
    headerErrors,
    headerWarnings,
    rowIssues,
    rowIssuesByExcelRow,
    isHealthy:
      !hasUnterminatedQuote &&
      headerErrors.length === 0 &&
      rowIssues.length === 0,
  };
}


