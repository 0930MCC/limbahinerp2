import type { AnyEntityRecord, EntityKey } from './types.ts';

export interface WeightedSearchField {
  text: string;
  weight: number;
}

export interface EntityDisplaySummary {
  id: string;
  code: string;
  title: string;
  subtitle: string;
  notePreview: string;
  metaSegments: string[];
  thumbnailUrl?: string;
  status?: string;
  dataType?: string;
}

/**
 * Normalizes a string for flexible matching:
 * lowercase, strips accents/diacritics, replaces punctuation/separators with spaces,
 * and collapses consecutive whitespace.
 */
export function normalizeSearchText(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Strips all non-alphanumeric characters so codes like "A3371" match "A337-1"
 * and "ITM260001" matches "ITM-26-0001".
 */
export function compactSearchText(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Bounded Damerau-Levenshtein-like edit distance with early exit when > maxDist.
 * Handles character insertions, deletions, substitutions, and adjacent transpositions.
 */
export function boundedEditDistance(
  a: string,
  b: string,
  maxDist: number
): number {
  const lenA = a.length;
  const lenB = b.length;
  if (Math.abs(lenA - lenB) > maxDist) return maxDist + 1;
  if (lenA === 0) return lenB;
  if (lenB === 0) return lenA;

  let prevPrev = new Int32Array(lenB + 1);
  let prev = new Int32Array(lenB + 1);
  let curr = new Int32Array(lenB + 1);

  for (let j = 0; j <= lenB; j += 1) {
    prev[j] = j;
  }

  for (let i = 1; i <= lenA; i += 1) {
    curr[0] = i;
    let rowMin = curr[0];
    const ca = a.charCodeAt(i - 1);

    for (let j = 1; j <= lenB; j += 1) {
      const cb = b.charCodeAt(j - 1);
      const cost = ca === cb ? 0 : 1;
      let val = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + cost
      );
      // Adjacent character transposition (e.g., "plsatik" -> "plastik")
      if (
        i > 1 &&
        j > 1 &&
        ca === b.charCodeAt(j - 2) &&
        a.charCodeAt(i - 2) === cb
      ) {
        val = Math.min(val, prevPrev[j - 2] + 1);
      }
      curr[j] = val;
      if (val < rowMin) rowMin = val;
    }

    if (rowMin > maxDist) return maxDist + 1;

    const tmp = prevPrev;
    prevPrev = prev;
    prev = curr;
    curr = tmp;
  }

  return prev[lenB];
}

/**
 * Sørensen–Dice coefficient on character bigrams (0..1).
 * Great for measuring overall textual similarity even with typos or partial stems.
 */
export function bigramDiceSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) {
    return b.includes(a) || a.includes(b) ? 0.5 : 0;
  }

  const bigramsA = new Map<string, number>();
  for (let i = 0; i < a.length - 1; i += 1) {
    const bg = a.slice(i, i + 2);
    bigramsA.set(bg, (bigramsA.get(bg) || 0) + 1);
  }

  let intersection = 0;
  for (let i = 0; i < b.length - 1; i += 1) {
    const bg = b.slice(i, i + 2);
    const count = bigramsA.get(bg) || 0;
    if (count > 0) {
      intersection += 1;
      bigramsA.set(bg, count - 1);
    }
  }

  return (2 * intersection) / (a.length - 1 + (b.length - 1));
}

/**
 * Checks if `needle` appears as an ordered character subsequence inside `haystack`.
 * Returns compactness ratio (0..1), or 0 if not a subsequence.
 */
function subsequenceRatio(needle: string, haystack: string): number {
  if (!needle || !haystack || needle.length > haystack.length) return 0;
  let ni = 0;
  let firstMatch = -1;
  let lastMatch = -1;
  for (let hi = 0; hi < haystack.length && ni < needle.length; hi += 1) {
    if (haystack.charCodeAt(hi) === needle.charCodeAt(ni)) {
      if (firstMatch === -1) firstMatch = hi;
      lastMatch = hi;
      ni += 1;
    }
  }
  if (ni !== needle.length) return 0;
  const span = lastMatch - firstMatch + 1;
  return needle.length / Math.max(span, 1);
}

interface PreparedField {
  norm: string;
  compact: string;
  words: string[];
  weight: number;
}

function scoreSingleTokenAgainstField(token: string, field: PreparedField): number {
  if (!field.norm) return 0;

  let best = 0;

  // Compact match for code-like tokens (e.g. "a3371" -> "a3371")
  if (token.length >= 2 && field.compact) {
    if (field.compact === token) return 1.0;
    if (field.compact.startsWith(token)) {
      best = Math.max(best, 0.92);
    } else if (field.compact.includes(token)) {
      best = Math.max(best, 0.8);
    }
  }

  const maxEditDist = token.length <= 2 ? 0 : token.length <= 5 ? 1 : token.length <= 9 ? 2 : 3;

  for (const word of field.words) {
    if (!word) continue;
    if (word === token) return 1.0;

    if (word.startsWith(token)) {
      const ratio = token.length / word.length;
      best = Math.max(best, 0.88 + 0.1 * ratio);
      continue;
    }

    if (word.includes(token)) {
      const ratio = token.length / word.length;
      best = Math.max(best, 0.75 + 0.1 * ratio);
      continue;
    }

    if (token.length >= 4 && token.includes(word) && word.length >= 3) {
      best = Math.max(best, 0.65 * (word.length / token.length));
    }

    if (maxEditDist > 0 && word.length >= 2) {
      // Full-word fuzzy edit distance (typos like "kunig" -> "kuning", "klnis" -> "klinis")
      const fullDist = boundedEditDistance(token, word, maxEditDist);
      if (fullDist <= maxEditDist) {
        const sim = 1 - fullDist / Math.max(token.length, word.length);
        best = Math.max(best, 0.45 + 0.43 * sim);
      } else if (word.length > token.length) {
        // Prefix fuzzy edit distance (e.g., "infeksiu" -> "infeksius", "plsat" -> "plastik")
        const prefixSlice = word.slice(0, Math.min(word.length, token.length + 1));
        const prefDist = boundedEditDistance(token, prefixSlice, Math.min(maxEditDist, 2));
        if (prefDist <= Math.min(maxEditDist, 2)) {
          const sim = 1 - prefDist / Math.max(token.length, prefixSlice.length);
          best = Math.max(best, 0.4 + 0.38 * sim);
        }
      }
    }

    if (token.length >= 3 && word.length >= 3 && best < 0.7) {
      const dice = bigramDiceSimilarity(token, word);
      if (dice >= 0.45) {
        best = Math.max(best, 0.34 + 0.42 * dice);
      }
    }
  }

  return best;
}

/**
 * Computes a flexible similarity score (0 = no meaningful similarity, higher = closer match)
 * across weighted text fields. Combines exact, prefix, substring, multi-token, typo-tolerant
 * Damerau-Levenshtein, bigram Dice, and subsequence signals.
 */
export function computeSimilarityScore(
  rawQuery: string,
  fields: WeightedSearchField[]
): number {
  const normQuery = normalizeSearchText(rawQuery);
  const compactQuery = compactSearchText(rawQuery);
  if (!normQuery && !compactQuery) return 1;

  const prepared: PreparedField[] = [];
  for (const f of fields) {
    if (!f.text) continue;
    const norm = normalizeSearchText(f.text);
    const compact = compactSearchText(f.text);
    if (!norm && !compact) continue;
    prepared.push({
      norm,
      compact,
      words: norm ? norm.split(' ') : [],
      weight: f.weight,
    });
  }
  if (prepared.length === 0) return 0;

  let wholeQueryBonus = 0;

  for (const f of prepared) {
    if (f.norm === normQuery || (compactQuery.length >= 2 && f.compact === compactQuery)) {
      wholeQueryBonus = Math.max(wholeQueryBonus, 1000 * f.weight);
    } else if (
      f.norm.startsWith(normQuery) ||
      (compactQuery.length >= 2 && f.compact.startsWith(compactQuery))
    ) {
      const tightness = Math.min(1, normQuery.length / Math.max(f.norm.length, 1));
      wholeQueryBonus = Math.max(wholeQueryBonus, (760 + 80 * tightness) * f.weight);
    } else {
      const idx = f.norm.indexOf(normQuery);
      if (idx !== -1) {
        const wordStartBonus = idx === 0 || f.norm[idx - 1] === ' ' ? 55 : 0;
        const tightness = Math.min(1, normQuery.length / Math.max(f.norm.length, 1));
        wholeQueryBonus = Math.max(
          wholeQueryBonus,
          (540 + wordStartBonus + 70 * tightness) * f.weight
        );
      } else if (compactQuery.length >= 3 && f.compact.includes(compactQuery)) {
        wholeQueryBonus = Math.max(wholeQueryBonus, 520 * f.weight);
      }
    }
  }

  // Token-by-token flexible matching (handles reordered words, multi-field queries, typos)
  const qTokens = normQuery ? normQuery.split(' ').filter(Boolean) : [];
  let tokenTotal = 0;
  let strongTokenMatches = 0;
  let weakTokenMatches = 0;

  for (const qt of qTokens) {
    let bestForToken = 0;
    for (const f of prepared) {
      const tokenScore = scoreSingleTokenAgainstField(qt, f) * f.weight;
      if (tokenScore > bestForToken) bestForToken = tokenScore;
    }
    tokenTotal += bestForToken;
    if (bestForToken >= 0.45) strongTokenMatches += 1;
    else if (bestForToken >= 0.25) weakTokenMatches += 1;
  }

  let tokenScoreAggregate = 0;
  if (qTokens.length > 0 && (strongTokenMatches > 0 || weakTokenMatches > 0)) {
    const avgTokenScore = tokenTotal / qTokens.length;
    const coverage = (strongTokenMatches + weakTokenMatches * 0.5) / qTokens.length;
    // Reward matching ALL query words strongly, while still keeping partial matches ranked below
    tokenScoreAggregate = avgTokenScore * (220 + 260 * coverage);
  }

  // Whole-string fuzzy Dice + subsequence fallback for typos across concatenated text
  let fuzzyFallback = 0;
  if (wholeQueryBonus === 0 && compactQuery.length >= 3) {
    for (const f of prepared) {
      const dice = bigramDiceSimilarity(normQuery, f.norm);
      if (dice >= 0.32) {
        fuzzyFallback = Math.max(fuzzyFallback, dice * 240 * f.weight);
      }
      if (compactQuery.length <= 16) {
        const subRatio = subsequenceRatio(compactQuery, f.compact);
        if (subRatio >= 0.42) {
          fuzzyFallback = Math.max(fuzzyFallback, subRatio * 180 * f.weight);
        }
      }
    }
  }

  const combined = wholeQueryBonus + tokenScoreAggregate + fuzzyFallback;

  // Minimum quality floor so unrelated records are excluded
  const minFloor = qTokens.length > 1 ? 115 : compactQuery.length <= 2 ? 180 : 95;
  return combined >= minFloor ? Math.round(combined * 10) / 10 : 0;
}

export function rankBySimilarity<T>(
  items: T[],
  query: string,
  getFields: (item: T) => WeightedSearchField[],
  getTieBreakKey?: (item: T) => string
): Array<{ item: T; score: number }> {
  const trimmed = query.trim();
  if (!trimmed) {
    return items.map((item) => ({ item, score: 1 }));
  }

  const scored: Array<{ item: T; score: number }> = [];
  for (const item of items) {
    const score = computeSimilarityScore(trimmed, getFields(item));
    if (score > 0) {
      scored.push({ item, score });
    }
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (getTieBreakKey) {
      return getTieBreakKey(a.item).localeCompare(getTieBreakKey(b.item), undefined, {
        numeric: true,
      });
    }
    return 0;
  });

  return scored;
}

function asStr(v: unknown): string {
  return typeof v === 'string' ? v.trim() : v !== null && v !== undefined ? String(v).trim() : '';
}

/**
 * Extracts structured display & metadata summary for any ERP model record
 * so ReferencePickerLayer and ReferencePickerField render rich, consistent rows.
 */
export function extractEntityDisplay(
  entity: EntityKey,
  record: AnyEntityRecord
): EntityDisplaySummary {
  const o = record as unknown as Record<string, unknown>;
  const id = asStr(o.id);

  switch (entity) {
    case 'items': {
      const code = asStr(o.item_code || o.code);
      const title = asStr(o.title || o.name) || id;
      const subtitle = asStr(o.description);
      const notePreview = asStr(o.item_note);
      const images = Array.isArray(o.list_url_image)
        ? (o.list_url_image as unknown[]).map(asStr).filter(Boolean)
        : [];
      const metaSegments: string[] = [];
      if (asStr(o.unit)) metaSegments.push(`Unit: ${asStr(o.unit)}`);
      if (images.length > 0) {
        metaSegments.push(`${images.length} ${images.length === 1 ? 'photo' : 'photos'}`);
      }
      if (notePreview) metaSegments.push('Has note template');
      return {
        id,
        code,
        title,
        subtitle,
        notePreview,
        metaSegments,
        thumbnailUrl: images[0],
      };
    }

    case 'customers': {
      const title = asStr(o.name) || id;
      const username = asStr(o.username);
      const email = asStr(o.email);
      const subtitle = [username ? `@${username}` : '', email].filter(Boolean).join(' · ');
      const metaSegments = [
        asStr(o.industry),
        asStr(o.pic_name) ? `PIC: ${asStr(o.pic_name)}` : '',
        asStr(o.phone),
      ].filter(Boolean);
      return {
        id,
        code: username ? `@${username}` : '',
        title,
        subtitle,
        notePreview: '',
        metaSegments,
        status: asStr(o.status) || undefined,
      };
    }

    case 'branches': {
      const branchName = asStr(o.branch_name || o.name);
      const docName = asStr(o.name_in_document);
      const title = docName || branchName || id;
      const subtitle = [
        branchName && docName && branchName !== docName ? branchName : '',
        asStr(o.id_alamat_address_document || o.address),
      ]
        .filter(Boolean)
        .join(' · ');
      const clientRef = asStr(o.id_client || o.client_id);
      const metaSegments = [
        clientRef ? `Client: ${clientRef}` : '',
        asStr(o.npwp) ? `NPWP: ${asStr(o.npwp)}` : 'No NPWP',
        asStr(o.pic_operasional_nama || o.pic_name)
          ? `Ops PIC: ${asStr(o.pic_operasional_nama || o.pic_name)}`
          : '',
      ].filter(Boolean);
      return {
        id,
        code: asStr(o.npwp),
        title,
        subtitle,
        notePreview: asStr(o.id_alamat_address_limbah),
        metaSegments,
      };
    }

    case 'requests': {
      const reqType = asStr(o.request_type);
      const title = reqType ? `${reqType} — ${id}` : id;
      const subtitle = asStr(o.catatan);
      const notePreview = asStr(o.solution);
      const metaSegments = [
        asStr(o.id_user) ? `Client: ${asStr(o.id_user)}` : '',
        asStr(o.id_creator) ? `Creator: ${asStr(o.id_creator)}` : '',
        notePreview ? 'Solved' : 'Open',
      ].filter(Boolean);
      return {
        id,
        code: reqType,
        title,
        subtitle,
        notePreview,
        metaSegments,
      };
    }

    case 'workers': {
      const title = asStr(o.name) || id;
      const username = asStr(o.username);
      const role = asStr(o.role);
      const subtitle = [username ? `@${username}` : '', role ? role.toUpperCase() : '']
        .filter(Boolean)
        .join(' · ');
      const metaSegments = [asStr(o.email), asStr(o.phone)].filter(Boolean);
      return {
        id,
        code: username ? `@${username}` : '',
        title,
        subtitle,
        notePreview: '',
        metaSegments,
        thumbnailUrl: asStr(o.display_picture_url) || undefined,
        status: asStr(o.status) || undefined,
      };
    }

    case 'schedules': {
      const code = asStr(o.vehicle_number);
      const title = asStr(o.scheduled_date)
        ? `${code || 'Schedule'} (${asStr(o.scheduled_date)})`
        : code || id;
      const subtitle = asStr(o.schedule_note);
      const notePreview = asStr(o.schedule_reschedule_problem);
      const metaSegments = [
        asStr(o.id_branch) ? `Branch: ${asStr(o.id_branch)}` : '',
        o.order_index !== undefined && o.order_index !== null
          ? `Stop #${String(o.order_index)}`
          : '',
      ].filter(Boolean);
      return {
        id,
        code,
        title,
        subtitle,
        notePreview,
        metaSegments,
      };
    }

    case 'pickup_data': {
      const code = asStr(o.manifest_number || o.reference_number);
      const title = asStr(o.data) || asStr(o.id_item_model) || id;
      const subtitle = asStr(o.final_item_note);
      const qty = o.quantity !== undefined && o.quantity !== null ? String(o.quantity) : '';
      const unit = asStr(o.unit);
      const metaSegments = [
        asStr(o.data_type) ? `Type: ${asStr(o.data_type)}` : '',
        qty ? `${qty} ${unit || 'kg'}` : '',
        asStr(o.id_user_model) ? `Client: ${asStr(o.id_user_model)}` : '',
        asStr(o.id_item_model) ? `Item: ${asStr(o.id_item_model)}` : '',
      ].filter(Boolean);
      return {
        id,
        code,
        title,
        subtitle,
        notePreview: asStr(o.internal_note),
        metaSegments,
        dataType: asStr(o.data_type) || undefined,
      };
    }

    case 'purchase_orders': {
      const code = asStr(o.po_number);
      const title = code || id;
      const subtitle = asStr(o.note);
      const metaSegments = [
        asStr(o.date_period),
        asStr(o.id_user_model || o.client_id),
      ].filter(Boolean);
      return {
        id,
        code,
        title,
        subtitle,
        notePreview: '',
        metaSegments,
        status: asStr(o.status) || undefined,
      };
    }

    case 'berita_acara':
    case 'invoices':
    case 'certificates':
    case 'fpl_real':
    case 'fpl_doc': {
      const dateStr = asStr(o.date_period || o.issue_date || o.ba_date || o.issued_date);
      const code = asStr(o.invoice_number || o.certificate_number || dateStr);
      const title =
        dateStr && code !== dateStr
          ? `${code} · ${dateStr}`
          : dateStr
            ? `${id} · ${dateStr}`
            : id;
      const subtitle = asStr(o.note);
      const metaSegments = [
        asStr(o.id_user_model || o.client_id)
          ? `Client: ${asStr(o.id_user_model || o.client_id)}`
          : '',
        dateStr ? `Period: ${dateStr}` : '',
      ].filter(Boolean);
      return {
        id,
        code,
        title,
        subtitle,
        notePreview: '',
        metaSegments,
        status: asStr(o.status) || undefined,
      };
    }

    default: {
      const title = asStr(o.title || o.name || o.model_name) || id;
      const subtitle = asStr(o.description || o.note || o.period);
      return {
        id,
        code: asStr(o.period),
        title,
        subtitle,
        notePreview: '',
        metaSegments: [],
        status: asStr(o.status) || undefined,
      };
    }
  }
}

/**
 * Extracts weighted search fields across ALL meaningful attributes of an entity record
 * so similarity search matches IDs, codes, titles, descriptions, packaging, notes, cities, PICs, etc.
 */
export function extractEntitySearchFields(
  entity: EntityKey,
  record: AnyEntityRecord
): WeightedSearchField[] {
  const o = record as unknown as Record<string, unknown>;
  const fields: WeightedSearchField[] = [];
  const push = (val: unknown, weight: number) => {
    const s = asStr(val);
    if (s) fields.push({ text: s, weight });
  };

  push(o.id, 1.0);

  switch (entity) {
    case 'items':
      push(o.item_code || o.code, 1.05);
      push(o.title || o.name, 1.0);
      push(o.description, 0.88);
      push(o.item_note, 0.76);
      push(o.unit, 0.6);
      break;

    case 'customers':
      push(o.name, 1.05);
      push(o.username, 1.0);
      push(o.email, 0.88);
      push(o.industry, 0.72);
      push(o.pic_name, 0.72);
      push(o.address, 0.65);
      push(o.phone, 0.65);
      break;

    case 'branches':
      push(o.name_in_document, 1.05);
      push(o.branch_name || o.name, 1.02);
      push(o.id_client || o.client_id, 0.9);
      push(o.npwp, 0.88);
      push(o.id_alamat_address_document || o.address, 0.8);
      push(o.id_alamat_address_limbah, 0.78);
      push(o.penanggung_jawab_utama_nama, 0.75);
      push(o.pic_operasional_nama || o.pic_name, 0.75);
      push(o.pic_keuangan_nama, 0.72);
      break;

    case 'requests':
      push(o.request_type, 1.05);
      push(o.catatan, 0.95);
      push(o.solution, 0.88);
      push(o.id_user, 0.9);
      push(o.id_creator, 0.85);
      break;

    case 'workers':
      push(o.name, 1.05);
      push(o.username, 1.0);
      push(o.role, 0.82);
      push(o.email, 0.78);
      push(o.phone, 0.72);
      push(o.status, 0.55);
      break;

    case 'schedules':
      push(o.vehicle_number, 1.05);
      push(o.scheduled_date, 0.9);
      push(o.id_branch, 0.85);
      push(o.schedule_note, 0.8);
      push(o.schedule_reschedule_problem, 0.75);
      break;

    case 'pickup_data':
      push(o.manifest_number, 1.0);
      push(o.reference_number, 0.95);
      push(o.data, 0.95);
      push(o.id_item_model, 0.9);
      push(o.id_user_model, 0.88);
      push(o.final_item_note, 0.84);
      push(o.data_type, 0.75);
      push(o.internal_note, 0.65);
      break;

    default:
      push(o.po_number, 1.0);
      push(o.invoice_number, 1.0);
      push(o.title || o.name, 1.0);
      push(o.date_period || o.issue_date || o.ba_date || o.issued_date, 0.88);
      push(o.id_user_model || o.client_id, 0.85);
      push(o.note || o.description, 0.8);
      push(o.status, 0.6);
      push(o.model_name, 0.85);
      break;
  }

  return fields;
}

export function rankEntityRecords<T extends AnyEntityRecord>(
  entity: EntityKey,
  records: T[],
  query: string
): Array<{ record: T; summary: EntityDisplaySummary; score: number }> {
  const ranked = rankBySimilarity(
    records,
    query,
    (rec) => extractEntitySearchFields(entity, rec),
    (rec) => {
      const summary = extractEntityDisplay(entity, rec);
      return `${summary.code || summary.title} ${summary.id}`;
    }
  );
  return ranked.map(({ item, score }) => ({
    record: item,
    summary: extractEntityDisplay(entity, item),
    score,
  }));
}
