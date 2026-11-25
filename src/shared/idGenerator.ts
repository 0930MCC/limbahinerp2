import type { EntityKey } from './types.ts';

export const ENTITY_PREFIX: Record<EntityKey, string> = {
  workers: 'MCC',
  customers: 'USR',
  branches: 'CUST',
  requests: 'REQ',
  items: 'ITM',
  schedules: 'LMBHN-SCHD-ITEM',
  pickup_data: 'DATA',
  purchase_orders: 'PO',
  berita_acara: 'LMBHN-BA',
  invoices: 'INV',
  certificates: 'LMBHN-CERT',
  fpl_real: 'LMBHN-FPLREAL',
  fpl_doc: 'LMBHN-FPLDOC',
  commissions: 'COM',
  logs: 'LOGS',
};

const ALPHANUMERIC_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function isAlphanumericIdEntity(entity: EntityKey): boolean {
  return entity === 'workers' || entity === 'customers' || entity === 'branches';
}

function randomCode5(): string {
  let out = '';
  for (let i = 0; i < 5; i += 1) {
    const idx = Math.floor(Math.random() * ALPHANUMERIC_CHARS.length);
    out += ALPHANUMERIC_CHARS[idx];
  }
  return out;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Generates an ID following Limbahin's rules:
 * - If explicitId is supplied (form input or CSV import), preserve it verbatim.
 * - For workers (MCC), clients (USR), and Limbahin branches (CUST): 5-char uppercase alphanumeric, e.g. MCC-K82PL, USR-M54ED, CUST-PZX5V.
 * - For all other models: <PREFIX>-<YY>-<NNNN> starting at 1001, scoped to year of createdAt (e.g. REQ-26-1001, ITM-26-1001, LMBHN-BA-26-1001, DATA-26-1001).
 */
export function generateEntityId(
  entity: EntityKey,
  existingIds: string[],
  createdAt?: string | Date | null,
  explicitId?: string | null
): string {
  const trimmedExplicit = explicitId?.trim();
  if (trimmedExplicit) {
    return trimmedExplicit;
  }

  const prefix = ENTITY_PREFIX[entity];
  const existingSet = new Set(existingIds.map((id) => id.toUpperCase()));

  if (isAlphanumericIdEntity(entity)) {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const candidate = `${prefix}-${randomCode5()}`;
      if (!existingSet.has(candidate.toUpperCase())) {
        return candidate;
      }
    }
    return `${prefix}-${Date.now().toString(36).slice(-5).toUpperCase()}`;
  }

  const dateObj = createdAt ? new Date(createdAt) : new Date();
  const validDate = Number.isNaN(dateObj.getTime()) ? new Date() : dateObj;
  const yy = String(validDate.getFullYear()).slice(-2);
  const matcher = new RegExp(`^${escapeRegExp(prefix)}-${yy}-(\\d+)$`, 'i');

  let maxNum = 1000;
  for (const id of existingIds) {
    const m = matcher.exec(id.trim());
    if (m) {
      const parsed = Number.parseInt(m[1], 10);
      if (Number.isFinite(parsed) && parsed > maxNum) {
        maxNum = parsed;
      }
    }
  }

  return `${prefix}-${yy}-${maxNum + 1}`;
}

export function previewIdFormat(entity: EntityKey): string {
  const prefix = ENTITY_PREFIX[entity];
  if (isAlphanumericIdEntity(entity)) {
    return `${prefix}-XXXXX (auto 5-char alphanumeric)`;
  }
  const yy = String(new Date().getFullYear()).slice(-2);
  return `${prefix}-${yy}-1001 (auto year + sequence)`;
}
