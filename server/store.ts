import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type {
  AccountLockReason,
  AnyEntityRecord,
  BeritaAcaraRecord,
  BranchRecord,
  CertificateRecord,
  CommissionRecord,
  CsvImportMode,
  CustomerRecord,
  DashboardSummary,
  DocumentAdjustment,
  DocumentEntityKey,
  EntityKey,
  FplDocRecord,
  FplRealRecord,
  InvoiceRecord,
  ItemRecord,
  LogChangeEntry,
  LogFieldDiff,
  LogRecord,
  PickupDataRecord,
  PurchaseOrderRecord,
  RequestRecord,
  ScheduleRecord,
  WorkerRecord,
  WorkerRole,
} from '../src/shared/types.ts';
import { ENTITY_META } from '../src/shared/entityMeta.ts';
import { generateEntityId } from '../src/shared/idGenerator.ts';

interface StoredWorker extends WorkerRecord {
  auth_email: string;
  auth_user_id?: string | null;
  password_hash?: string | null; // Used ONLY in local preview fallback when Supabase is not configured
  email_confirmed?: boolean; // Used ONLY in local preview fallback
  confirm_token?: string | null; // Used ONLY in local preview fallback
  reset_token?: string | null; // Used ONLY in local preview fallback
}

interface StoredCustomer extends CustomerRecord {
  password_hash?: string | null;
}

function sanitizeCustomer(c: StoredCustomer): CustomerRecord {
  const { password_hash: _pwHash, ...safe } = c as StoredCustomer & { password?: unknown };
  delete (safe as Record<string, unknown>).password;
  return safe;
}

export class AuthError extends Error {
  status: number;
  code?: string;
  email?: string;
  workerId?: string;
  role?: string;
  retryAfterSeconds?: number;

  constructor(
    message: string,
    status = 400,
    code?: string,
    email?: string,
    workerId?: string,
    role?: string,
    retryAfterSeconds?: number
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.email = email;
    this.workerId = workerId;
    this.role = role;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

const RESEND_COOLDOWN_SECONDS = 120;
const resendCooldownUntil = new Map<string, number>();

function cooldownKeys(workerId?: string | null, email?: string | null): string[] {
  const keys: string[] = [];
  if (workerId) keys.push(`worker:${workerId.toUpperCase()}`);
  if (email) keys.push(`email:${email.trim().toLowerCase()}`);
  return keys;
}

export function getResendCooldownRemaining(
  workerId?: string | null,
  email?: string | null
): number {
  const now = Date.now();
  let maxRemaining = 0;
  for (const key of cooldownKeys(workerId, email)) {
    const until = resendCooldownUntil.get(key);
    if (until && until > now) {
      const secs = Math.ceil((until - now) / 1000);
      if (secs > maxRemaining) maxRemaining = secs;
    } else if (until && until <= now) {
      resendCooldownUntil.delete(key);
    }
  }
  return maxRemaining;
}

function setResendCooldown(
  workerId?: string | null,
  email?: string | null,
  seconds = RESEND_COOLDOWN_SECONDS
): void {
  const until = Date.now() + seconds * 1000;
  for (const key of cooldownKeys(workerId, email)) {
    resendCooldownUntil.set(key, until);
  }
}

function formatCooldownText(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins > 0) {
    return `${mins}m ${String(secs).padStart(2, '0')}s`;
  }
  return `${secs}s`;
}

interface LocalDatabase {
  workers: StoredWorker[];
  customers: StoredCustomer[];
  branches: BranchRecord[];
  requests: RequestRecord[];
  items: ItemRecord[];
  schedules: ScheduleRecord[];
  pickup_data: PickupDataRecord[];
  purchase_orders: PurchaseOrderRecord[];
  berita_acara: BeritaAcaraRecord[];
  invoices: InvoiceRecord[];
  certificates: CertificateRecord[];
  fpl_real: FplRealRecord[];
  fpl_doc: FplDocRecord[];
  commissions: CommissionRecord[];
  logs: LogRecord[];
}

const SESSION_SECRET =
  process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

const SUPABASE_URL = process.env.SUPABASE_URL?.trim() || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY?.trim() || '';
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || '';

export const isSupabaseConfigured = Boolean(
  SUPABASE_URL && SUPABASE_ANON_KEY && SUPABASE_SERVICE_ROLE_KEY
);

let supabaseAdminClient: SupabaseClient | null = null;
let supabaseAnonClient: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient {
  if (!supabaseAdminClient) {
    supabaseAdminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
      global: {
        headers: {
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
      },
    });
  }
  return supabaseAdminClient;
}

function getSupabaseAnon(): SupabaseClient {
  if (!supabaseAnonClient) {
    supabaseAnonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return supabaseAnonClient;
}

function hashPassword(plain: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(plain, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

function verifyPassword(plain: string, storedHash?: string | null): boolean {
  if (!storedHash || !storedHash.includes(':')) return false;
  const [salt, keyHex] = storedHash.split(':');
  const expected = Buffer.from(keyHex, 'hex');
  const actual = crypto.scryptSync(plain, salt, 64);
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}

type LocalTokenScope = 'full' | 'locked';

function signLocalToken(
  workerId: string,
  role: WorkerRole,
  scope: LocalTokenScope = 'full'
): string {
  const payload = Buffer.from(
    JSON.stringify({
      sub: workerId,
      role,
      scope,
      exp: Date.now() + 1000 * 60 * 60 * 12, // 12 hours
    })
  ).toString('base64url');
  const sig = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(payload)
    .digest('base64url');
  return `${payload}.${sig}`;
}

function verifyLocalToken(
  token: string
): { sub: string; role: WorkerRole; scope: LocalTokenScope } | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  const expectedSig = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(payload)
    .digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!parsed.sub || typeof parsed.exp !== 'number' || parsed.exp < Date.now()) {
      return null;
    }
    return {
      sub: String(parsed.sub),
      role: parsed.role as WorkerRole,
      scope: parsed.scope === 'locked' ? 'locked' : 'full',
    };
  } catch {
    return null;
  }
}

export interface RememberCookiePayload {
  token: string;
  refreshToken?: string | null;
  workerId: string;
  role: WorkerRole;
  exp: number;
}

function getRememberCipherKey(): Buffer {
  return crypto.createHash('sha256').update(SESSION_SECRET).digest();
}

export function encryptRememberPayload(payload: RememberCookiePayload): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getRememberCipherKey(), iv);
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64url')}.${tag.toString('base64url')}.${encrypted.toString('base64url')}`;
}

export function decryptRememberPayload(raw: string): RememberCookiePayload | null {
  try {
    const parts = raw.split('.');
    if (parts.length !== 3) return null;
    const [ivB64, tagB64, dataB64] = parts;
    const iv = Buffer.from(ivB64, 'base64url');
    const tag = Buffer.from(tagB64, 'base64url');
    const data = Buffer.from(dataB64, 'base64url');
    if (iv.length !== 12 || tag.length !== 16) return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', getRememberCipherKey(), iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
    const parsed = JSON.parse(decrypted) as Partial<RememberCookiePayload>;
    if (
      typeof parsed.token !== 'string' ||
      typeof parsed.workerId !== 'string' ||
      typeof parsed.exp !== 'number' ||
      parsed.exp < Date.now()
    ) {
      return null;
    }
    return {
      token: parsed.token,
      refreshToken: typeof parsed.refreshToken === 'string' ? parsed.refreshToken : null,
      workerId: parsed.workerId,
      role: parsed.role as WorkerRole,
      exp: parsed.exp,
    };
  } catch {
    return null;
  }
}

const INTERNAL_AUTH_DOMAIN = '@limbahin.internal';

function isInternalAuthEmail(email?: string | null): boolean {
  if (!email) return false;
  return email.trim().toLowerCase().endsWith(INTERNAL_AUTH_DOMAIN);
}

function generateInternalAuthEmail(username: string): string {
  const slug =
    username
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]/g, '') || 'worker';
  const suffix = crypto.randomBytes(3).toString('hex');
  return `${slug}.${suffix}${INTERNAL_AUTH_DOMAIN}`;
}

export function sanitizeWorker(w: StoredWorker): WorkerRecord {
  const visibleEmail =
    w.email && w.email.trim() && !isInternalAuthEmail(w.email)
      ? w.email.trim()
      : null;
  return {
    id: w.id,
    name: w.name,
    username: w.username,
    email: visibleEmail,
    phone: w.phone ?? null,
    role: w.role,
    status: w.status === 'active' ? 'active' : 'inactive',
    display_picture_url: w.display_picture_url ?? null,
    id_log_create: w.id_log_create ?? null,
    id_log_update: w.id_log_update ?? null,
    created_by: w.created_by ?? null,
    created_at: w.created_at,
  };
}

export function isValidImageUrl(url?: string | null): boolean {
  if (!url) return true;
  const trimmed = url.trim();
  if (!trimmed) return true;
  if (trimmed.startsWith('/assets/') || trimmed.startsWith('/uploads/')) return true;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

const ALLOWED_UPLOAD_EXT_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.pdf': 'application/pdf',
};

const STORAGE_BUCKET_NAME = 'limbahin-uploads';
let storageBucketEnsured = false;

export async function uploadAssetFile(
  entity: EntityKey,
  originalFileName: string,
  buffer: Buffer,
  options?: { companyId?: string; targetFileName?: string }
): Promise<string> {
  if (!buffer || buffer.length === 0) {
    throw new Error(`Uploaded file "${originalFileName}" is empty.`);
  }
  if (buffer.length > 10 * 1024 * 1024) {
    throw new Error(`File "${originalFileName}" exceeds the 10 MB per-file limit.`);
  }

  const baseName = path.basename(originalFileName).replace(/[^a-zA-Z0-9._-]/g, '_');
  const ext = path.extname(baseName).toLowerCase();
  const contentType = ALLOWED_UPLOAD_EXT_MIME[ext];
  if (!contentType) {
    throw new Error(
      `Unsupported file type "${ext || baseName}". Allowed types: PNG, JPG, JPEG, WEBP, GIF, PDF.`
    );
  }

  const safeTargetFileName = options?.targetFileName
    ? path
        .basename(options.targetFileName)
        .replace(/[^a-zA-Z0-9._-]/g, '_')
    : `${entity}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}${ext}`;

  const safeCompanySegment = options?.companyId
    ? options.companyId.replace(/[^a-zA-Z0-9_-]/g, '_')
    : null;

  if (isSupabaseConfigured) {
    const admin = getSupabaseAdmin();
    if (!storageBucketEnsured) {
      const { error: bucketErr } = await admin.storage.createBucket(STORAGE_BUCKET_NAME, {
        public: true,
      });
      if (
        bucketErr &&
        !bucketErr.message.toLowerCase().includes('already exists') &&
        !bucketErr.message.toLowerCase().includes('duplicate')
      ) {
        console.warn('Supabase storage bucket check warning:', bucketErr.message);
      }
      storageBucketEnsured = true;
    }

    const storagePath = safeCompanySegment
      ? `${safeCompanySegment}/${entity}/${safeTargetFileName}`
      : `${entity}/${safeTargetFileName}`;
    const { error: uploadErr } = await admin.storage
      .from(STORAGE_BUCKET_NAME)
      .upload(storagePath, buffer, {
        contentType,
        upsert: true,
      });

    if (uploadErr) {
      throw new Error(`Storage upload failed for "${originalFileName}": ${uploadErr.message}`);
    }

    const { data: pub } = admin.storage
      .from(STORAGE_BUCKET_NAME)
      .getPublicUrl(storagePath);
    if (!pub?.publicUrl) {
      throw new Error(`Unable to obtain public URL for "${originalFileName}".`);
    }
    return pub.publicUrl;
  }

  // Local preview fallback: save strictly inside public/uploads
  const uploadsRoot = path.resolve(process.cwd(), 'public/uploads');
  await fs.mkdir(uploadsRoot, { recursive: true });
  const targetPath = path.resolve(uploadsRoot, safeTargetFileName);
  if (!targetPath.startsWith(uploadsRoot + path.sep)) {
    throw new Error('Invalid upload destination path.');
  }
  await fs.writeFile(targetPath, buffer);
  return `/uploads/${safeTargetFileName}`;
}

function isSchemaMigrationErrorMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes('in the schema cache') ||
    lower.includes('pgrst204') ||
    lower.includes('could not find the') ||
    (lower.includes('column') && lower.includes('does not exist')) ||
    (lower.includes('relation "public.') && lower.includes('does not exist')) ||
    lower.includes('id_log_create') ||
    lower.includes('id_log_update') ||
    lower.includes('id_previous_logs') ||
    lower.includes('chart_of_accounts') ||
    lower.includes('csv_import_batches') ||
    lower.includes('rcrd') ||
    lower.includes('is_canceled') ||
    lower.includes('fpl_real') ||
    lower.includes('fpl_doc') ||
    lower.includes('item_code') ||
    lower.includes('list_url_image') ||
    lower.includes('date_period') ||
    lower.includes('id_user_model') ||
    lower.includes('data_type') ||
    lower.includes('final_item_note') ||
    lower.includes('internal_note') ||
    lower.includes('vehicle_number') ||
    lower.includes('reschedule_id') ||
    lower.includes('adjustments')
  );
}

export function enhanceSchemaMigrationError(message: string): string {
  if (isSchemaMigrationErrorMessage(message)) {
    return `${message} — Your Supabase database table is missing this column (this is a Supabase schema issue, not a problem in your CSV file). Please re-run the latest supabase/schema.sql in your Supabase SQL Editor and try again.`;
  }
  return message;
}

function normalizeDiffValue(val: unknown): unknown {
  if (val === undefined || val === '') return null;
  return val;
}

function valuesEqual(a: unknown, b: unknown): boolean {
  const na = normalizeDiffValue(a);
  const nb = normalizeDiffValue(b);
  if (na === nb) return true;
  if (na === null || nb === null) return false;
  if (typeof na === 'number' || typeof nb === 'number') {
    const numA = Number(na);
    const numB = Number(nb);
    if (Number.isFinite(numA) && Number.isFinite(numB)) {
      return numA === numB;
    }
  }
  if (Array.isArray(na) && Array.isArray(nb)) {
    if (na.length !== nb.length) return false;
    return na.every((v, i) => String(v) === String(nb[i]));
  }
  return String(na) === String(nb);
}

export function computeFieldDiffs(
  entity: EntityKey,
  oldRecord: Record<string, unknown> | null,
  newValues: Record<string, unknown>
): Record<string, LogFieldDiff> {
  const changes: Record<string, LogFieldDiff> = {};
  const allowedFields = ENTITY_META[entity].fields.filter(
    (f) => f.type !== 'password'
  );

  for (const field of allowedFields) {
    const key = field.key;
    if (!(key in newValues)) continue;
    const nextVal = normalizeDiffValue(newValues[key]);
    if (!oldRecord) {
      if (nextVal !== null && !(Array.isArray(nextVal) && nextVal.length === 0)) {
        changes[key] = { old: null, new: nextVal };
      }
    } else {
      const prevVal = normalizeDiffValue(oldRecord[key]);
      if (!valuesEqual(prevVal, nextVal)) {
        changes[key] = { old: prevVal, new: nextVal };
      }
    }
  }

  return changes;
}

export async function createAuditLog(
  actorId: string | null,
  modelName: string,
  changesJson: LogChangeEntry[],
  previousLogId: string | null = null
): Promise<LogRecord> {
  const existingLogs = await listAllRecords('logs');
  const existingIds = existingLogs.map((l) => l.id);
  const nowIso = new Date().toISOString();
  const logId = generateEntityId('logs', existingIds, nowIso);

  const row: LogRecord = {
    id: logId,
    id_previous_logs: previousLogId ?? null,
    id_changed_by: actorId,
    model_name: modelName,
    timestamp_created_at: nowIso,
    changes_json: changesJson,
    created_by: actorId,
    created_at: nowIso,
  };

  if (isSupabaseConfigured) {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from('logs')
      .insert(row)
      .select()
      .single();
    if (error) {
      throw new Error(enhanceSchemaMigrationError(`Failed to write audit log: ${error.message}`));
    }
    return data as LogRecord;
  }

  localDb.logs.unshift(row);
  return row;
}

async function updateAuditLogChanges(
  logId: string,
  changesJson: LogChangeEntry[],
  previousLogId?: string | null
): Promise<void> {
  const patch: Record<string, unknown> = { changes_json: changesJson };
  if (previousLogId !== undefined) {
    patch.id_previous_logs = previousLogId;
  }
  if (isSupabaseConfigured) {
    const admin = getSupabaseAdmin();
    const { error } = await admin
      .from('logs')
      .update(patch)
      .eq('id', logId);
    if (error) {
      throw new Error(enhanceSchemaMigrationError(`Failed to update audit log: ${error.message}`));
    }
    return;
  }
  const found = localDb.logs.find((l) => l.id === logId);
  if (found) {
    found.changes_json = changesJson;
    if (previousLogId !== undefined) {
      found.id_previous_logs = previousLogId;
    }
  }
}

async function deleteAuditLogSafe(logId: string): Promise<void> {
  try {
    if (isSupabaseConfigured) {
      const admin = getSupabaseAdmin();
      await admin.from('logs').delete().eq('id', logId);
    } else {
      const idx = localDb.logs.findIndex((l) => l.id === logId);
      if (idx !== -1) localDb.logs.splice(idx, 1);
    }
  } catch {
    // Ignore cleanup errors
  }
}

export function isValidEmail(email?: string | null): boolean {
  if (!email) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

// ============================================================================
// Initial Local Store Data (used only when Supabase env vars are not yet set)
// ============================================================================
export const localDb: LocalDatabase = {
  workers: [
    {
      id: 'MCC-M49KT',
      name: 'Nadia Kusuma',
      username: 'nadia.mkt',
      auth_email: 'nadia@limbahin.co.id',
      email: 'nadia@limbahin.co.id',
      phone: '+62 812-8810-4412',
      role: 'marketing',
      status: 'active',
      display_picture_url: null,
      password_hash: null,
      created_by: 'MCC-1001',
      created_at: '2026-01-12T08:00:00.000Z',
    },
    {
      id: 'MCC-A71DM',
      name: 'Raka Pratama',
      username: 'raka.adm',
      auth_email: 'raka@limbahin.co.id',
      email: 'raka@limbahin.co.id',
      phone: '+62 813-4421-9080',
      role: 'admin',
      status: 'active',
      display_picture_url: null,
      password_hash: null,
      created_by: 'MCC-1001',
      created_at: '2026-01-15T09:30:00.000Z',
    },
    {
      id: 'MCC-W38OP',
      name: 'Agus Setiawan',
      username: 'agus.ops',
      auth_email: 'agus.ops@limbahin.internal',
      email: null,
      phone: '+62 857-2001-3349',
      role: 'worker',
      status: 'active',
      display_picture_url: null,
      password_hash: null,
      created_by: 'MCC-1001',
      created_at: '2026-01-18T07:15:00.000Z',
    },
  ],
  customers: [
    {
      id: 'CUST-M54ED',
      name: 'PT. Graha Medika Nusantara',
      username: 'grahamedika',
      password_hash: null,
      industry: 'Hospital & Healthcare',
      pic_name: 'dr. Ratna Dewi',
      email: 'ehs@grahamedika.co.id',
      phone: '+62 21-5790-4120',
      address: 'Jl. HR Rasuna Said Kav. B-14, Jakarta Selatan',
      marketing_id: 'MCC-M49KT',
      status: 'active',
      created_by: 'MCC-1001',
      created_at: '2026-02-04T08:15:00.000Z',
    },
    {
      id: 'CUST-R91BX',
      name: 'PT. Surya Manufaktur Karawang',
      username: 'suryamanufaktur',
      password_hash: null,
      industry: 'Automotive Components',
      pic_name: 'Ir. Hendra Wijaya',
      email: 'hse@suryamanufaktur.co.id',
      phone: '+62 267-845-2210',
      address: 'Kawasan Industri KIIC Lot C-4, Karawang',
      marketing_id: 'MCC-M49KT',
      status: 'active',
      created_by: 'MCC-A71DM',
      created_at: '2026-02-19T10:00:00.000Z',
    },
    {
      id: 'CUST-T42KQ',
      name: 'PT. Karya Logam Presisi',
      username: 'karyalogam',
      password_hash: null,
      industry: 'Metal Electroplating',
      pic_name: 'Bambang Sudibyo',
      email: 'env@karyalogam.co.id',
      phone: '+62 21-893-7741',
      address: 'Kawasan Industri Jababeka II Blok HH, Cikarang',
      marketing_id: null,
      status: 'active',
      created_by: 'MCC-1001',
      created_at: '2026-03-08T11:20:00.000Z',
    },
  ],
  branches: [
    {
      id: 'BRC-26-1001',
      id_client: 'CUST-M54ED',
      client_id: 'CUST-M54ED',
      branch_name: 'Klinik Kuningan',
      name: 'Klinik Kuningan',
      name_in_document: 'PT. Graha Medika Nusantara - Klinik Kuningan',
      npwp: '0032831188424000',
      id_alamat_address_document: 'Jl. HR Rasuna Said Kav. B-14, Jakarta Selatan',
      id_alamat_address_limbah: 'Jl. HR Rasuna Said Kav. B-14, Jakarta Selatan',
      penanggung_jawab_utama_nama: 'dr. Ratna Dewi',
      penanggung_jawab_utama_jabatan: 'Direktur Operasional',
      pic_operasional_nama: 'Ns. Siska Rahmawati',
      pic_operasional_telfonwa: '+62 812-1190-2210',
      pic_keuangan_nama: 'Rini Kusuma',
      pic_keuangan_telfonwa: '+62 812-3344-5566',
      city: 'Jakarta Selatan',
      address: 'Jl. HR Rasuna Said Kav. B-14, Jakarta Selatan',
      pic_name: 'Ns. Siska Rahmawati',
      pic_phone: '+62 812-1190-2210',
      created_by: 'MCC-1001',
      created_at: '2026-02-05T09:00:00.000Z',
    },
    {
      id: 'BRC-26-1002',
      id_client: 'CUST-M54ED',
      client_id: 'CUST-M54ED',
      branch_name: 'Klinik Bekasi Barat',
      name: 'Klinik Bekasi Barat',
      name_in_document: 'PT. Graha Medika Nusantara - Klinik Bekasi Barat',
      npwp: null,
      id_alamat_address_document: 'Jl. Ahmad Yani No. 88, Bekasi',
      id_alamat_address_limbah: 'Jl. Ahmad Yani No. 88, Bekasi',
      penanggung_jawab_utama_nama: 'dr. Ratna Dewi',
      penanggung_jawab_utama_jabatan: 'Direktur Operasional',
      pic_operasional_nama: 'Dedi Kurniawan',
      pic_operasional_telfonwa: '+62 813-8821-7761',
      pic_keuangan_nama: 'Dedi Kurniawan',
      pic_keuangan_telfonwa: '+62 813-8821-7761',
      city: 'Bekasi',
      address: 'Jl. Ahmad Yani No. 88, Bekasi',
      pic_name: 'Dedi Kurniawan',
      pic_phone: '+62 813-8821-7761',
      created_by: 'MCC-1001',
      created_at: '2026-02-11T09:00:00.000Z',
    },
    {
      id: 'BRC-26-1003',
      id_client: 'CUST-R91BX',
      client_id: 'CUST-R91BX',
      branch_name: 'Plant 1 — Stamping & Coating',
      name: 'Plant 1 — Stamping & Coating',
      name_in_document: 'PT. Surya Manufaktur Karawang - Plant 1 — Stamping & Coating',
      npwp: '0192837465123000',
      id_alamat_address_document: 'KIIC Lot C-4, Karawang Barat',
      id_alamat_address_limbah: 'KIIC Lot C-4, Karawang Barat',
      penanggung_jawab_utama_nama: 'Ir. Hendra Wijaya',
      penanggung_jawab_utama_jabatan: 'Plant Manager',
      pic_operasional_nama: 'Ir. Hendra Wijaya',
      pic_operasional_telfonwa: '+62 811-9022-450',
      pic_keuangan_nama: 'Lestari Putri',
      pic_keuangan_telfonwa: '+62 811-9022-459',
      city: 'Karawang',
      address: 'KIIC Lot C-4, Karawang Barat',
      pic_name: 'Ir. Hendra Wijaya',
      pic_phone: '+62 811-9022-450',
      created_by: 'MCC-A71DM',
      created_at: '2026-02-20T10:30:00.000Z',
    },
    {
      id: 'BRC-26-1004',
      id_client: 'CUST-T42KQ',
      client_id: 'CUST-T42KQ',
      branch_name: 'Facility Jababeka II',
      name: 'Facility Jababeka II',
      name_in_document: 'PT. Karya Logam Presisi - Facility Jababeka II',
      npwp: '0283746519283000',
      id_alamat_address_document: 'Jababeka II Blok HH-11, Cikarang',
      id_alamat_address_limbah: 'Jababeka II Blok HH-11, Cikarang',
      penanggung_jawab_utama_nama: 'Bambang Sudibyo',
      penanggung_jawab_utama_jabatan: 'HSE Head',
      pic_operasional_nama: 'Bambang Sudibyo',
      pic_operasional_telfonwa: '+62 815-7730-1988',
      pic_keuangan_nama: 'Bambang Sudibyo',
      pic_keuangan_telfonwa: '+62 815-7730-1988',
      city: 'Cikarang',
      address: 'Jababeka II Blok HH-11, Cikarang',
      pic_name: 'Bambang Sudibyo',
      pic_phone: '+62 815-7730-1988',
      created_by: 'MCC-1001',
      created_at: '2026-03-09T14:00:00.000Z',
    },
  ],
  requests: [
    {
      id: 'REQ-26-1001',
      request_type: 'Jadwal',
      catatan: 'Mohon penjadwalan pickup tambahan hari Kamis pagi untuk Klinik Kuningan.',
      solution: 'Dijadwalkan pada armada B 9284 TYZ urutan stop #1.',
      id_user: 'CUST-M54ED',
      id_creator: 'CUST-M54ED',
      created_by: 'MCC-1001',
      created_at: '2026-03-18T08:30:00.000Z',
    },
    {
      id: 'REQ-26-1002',
      request_type: 'File & Dokumen',
      catatan: 'Permintaan salinan PDF Berita Acara dan Faktur Pajak periode Maret 2026.',
      solution: null,
      id_user: 'CUST-R91BX',
      id_creator: 'MCC-A71DM',
      created_by: 'MCC-A71DM',
      created_at: '2026-03-21T10:15:00.000Z',
    },
  ],
  items: [
    {
      id: 'ITM-26-1001',
      item_code: 'A337-1',
      title: 'Limbah Klinis Infeksius',
      description: 'Yellow Biohazard Wheelie Bin 240L',
      item_note: 'Incinerator treatment — double-sealed biohazard liner',
      list_url_image: [],
      code: 'A337-1',
      name: 'Limbah Klinis Infeksius',
      hazard_category: 'Category 1',
      unit: 'kg',
      unit_price: 24500,
      notes: 'Incinerator treatment — double-sealed biohazard liner',
      created_by: 'MCC-1001',
      created_at: '2026-01-10T08:00:00.000Z',
    },
    {
      id: 'ITM-26-1002',
      item_code: 'B105d',
      title: 'Minyak Pelumas Bekas',
      description: 'Steel Drum 200L (Sealed)',
      item_note: 'Zero-leak palletized steel drum, re-refining batch',
      list_url_image: [],
      code: 'B105d',
      name: 'Minyak Pelumas Bekas',
      hazard_category: 'Category 2',
      unit: 'kg',
      unit_price: 8500,
      notes: 'Zero-leak palletized steel drum, re-refining batch',
      created_by: 'MCC-1001',
      created_at: '2026-01-10T08:05:00.000Z',
    },
    {
      id: 'ITM-26-1003',
      item_code: 'B104d',
      title: 'Kemasan Bekas B3 (Drum & IBC)',
      description: 'IBC Tank 1000L / Empty Chemical Drum',
      item_note: 'Drained residual chemical containers prior to pickup',
      list_url_image: [],
      code: 'B104d',
      name: 'Kemasan Bekas B3 (Drum & IBC)',
      hazard_category: 'Category 2',
      unit: 'kg',
      unit_price: 11200,
      notes: 'Drained residual chemical containers prior to pickup',
      created_by: 'MCC-A71DM',
      created_at: '2026-01-12T08:10:00.000Z',
    },
    {
      id: 'ITM-26-1004',
      item_code: 'A102d',
      title: 'Aki / Baterai Bekas',
      description: 'Acid-Proof Plastic Crate',
      item_note: 'Lead-acid industrial backup batteries, terminals taped',
      list_url_image: [],
      code: 'A102d',
      name: 'Aki / Baterai Bekas',
      hazard_category: 'Category 1',
      unit: 'kg',
      unit_price: 16000,
      notes: 'Lead-acid industrial backup batteries, terminals taped',
      created_by: 'MCC-1001',
      created_at: '2026-01-15T08:15:00.000Z',
    },
    {
      id: 'ITM-26-1005',
      item_code: 'B324-1',
      title: 'Sludge IPAL Elektroplating',
      description: 'Jumbo Bag 1000kg Liner',
      item_note: 'Moisture < 35%, forklift loading at TPS',
      list_url_image: [],
      code: 'B324-1',
      name: 'Sludge IPAL Elektroplating',
      hazard_category: 'Category 2',
      unit: 'kg',
      unit_price: 9800,
      notes: 'Moisture < 35%, forklift loading at TPS',
      created_by: 'MCC-1001',
      created_at: '2026-01-20T08:20:00.000Z',
    },
    {
      id: 'ITM-26-1006',
      item_code: 'SVC-TRP',
      title: 'Jasa Pengangkutan Khusus B3',
      description: 'Armada Box B3 Berizin KLHK',
      item_note: 'Biaya mobilisasi armada & pengawalan manifest',
      list_url_image: [],
      code: 'SVC-TRP',
      name: 'Jasa Pengangkutan Khusus B3',
      hazard_category: 'Category 2',
      unit: 'trip',
      unit_price: 2500000,
      notes: 'Biaya mobilisasi armada & pengawalan manifest',
      created_by: 'MCC-1001',
      created_at: '2026-01-22T08:20:00.000Z',
    },
  ],
  schedules: [
    {
      id: 'LMBHN-SCHD-ITEM-26-1001',
      vehicle_number: 'B 9412 TYX',
      id_branch: 'BRC-26-1001',
      order_index: 1,
      schedule_note: 'Loading dock B opens 08:00 WIB. Bring Festronik manifest printout.',
      schedule_reschedule_problem: null,
      reschedule_id: null,
      scheduled_date: '2026-11-24',
      status: 'scheduled',
      client_id: 'CUST-M54ED',
      branch_id: 'BRC-26-1001',
      assigned_worker_id: 'MCC-W38OP',
      vehicle_plate: 'B 9412 TYX',
      notes: 'Loading dock B opens 08:00 WIB. Bring Festronik manifest printout.',
      created_by: 'MCC-1001',
      created_at: '2026-11-18T09:00:00.000Z',
    },
    {
      id: 'LMBHN-SCHD-ITEM-26-1002',
      vehicle_number: 'B 9781 KLP',
      id_branch: 'BRC-26-1003',
      order_index: 2,
      schedule_note: '12 steel drums + 4 IBC totes at TPS Limbah B3 North.',
      schedule_reschedule_problem: null,
      reschedule_id: null,
      scheduled_date: '2026-11-25',
      status: 'in_progress',
      client_id: 'CUST-R91BX',
      branch_id: 'BRC-26-1003',
      assigned_worker_id: 'MCC-W38OP',
      vehicle_plate: 'B 9781 KLP',
      notes: '12 steel drums + 4 IBC totes at TPS Limbah B3 North.',
      created_by: 'MCC-A71DM',
      created_at: '2026-11-19T10:15:00.000Z',
    },
    {
      id: 'LMBHN-SCHD-ITEM-26-1003',
      vehicle_number: 'B 9412 TYX',
      id_branch: 'BRC-26-1004',
      order_index: 1,
      schedule_note: 'Forklift provided on site for jumbo bags.',
      schedule_reschedule_problem: null,
      reschedule_id: null,
      scheduled_date: '2026-11-27',
      status: 'scheduled',
      client_id: 'CUST-T42KQ',
      branch_id: 'BRC-26-1004',
      assigned_worker_id: 'MCC-W38OP',
      vehicle_plate: 'B 9412 TYX',
      notes: 'Forklift provided on site for jumbo bags.',
      created_by: 'MCC-1001',
      created_at: '2026-11-20T11:45:00.000Z',
    },
  ],
  pickup_data: [
    {
      id: 'DATA-26-1001',
      data: '2026-11-10',
      id_user_model: 'CUST-M54ED',
      id_item_model: 'ITM-26-1001',
      data_type: 'pickup',
      reference_number: 'SJ-GMN-1110',
      manifest_number: 'FST-2026-08812',
      quantity: 576.58,
      unit: 'kg',
      invoice_price: 24500,
      fpl_price: 16500,
      final_item_note: 'Incinerator treatment — 16 yellow bins weighed on calibrated platform scale',
      internal_note: 'Driver Agus confirmed dock B waiting time 35 min',
      fpl_doc_id: 'LMBHN-FPLDOC-26-1001',
      fpl_real_id: 'LMBHN-FPLREAL-26-1001',
      ba_id: 'LMBHN-BA-26-1001',
      inv_id: 'INV-26-1001',
      po_id: 'PO-26-1001',
      client_id: 'CUST-M54ED',
      item_id: 'ITM-26-1001',
      weight_kg: 576.58,
      pickup_date: '2026-11-10',
      status: 'manifested',
      created_by: 'MCC-W38OP',
      created_at: '2026-11-10T11:30:00.000Z',
    },
    {
      id: 'DATA-26-1002',
      data: '2026-11-14',
      id_user_model: 'CUST-R91BX',
      id_item_model: 'ITM-26-1002',
      data_type: 'pickup',
      reference_number: 'SJ-SMK-1114',
      manifest_number: 'FST-2026-08847',
      quantity: 2150,
      unit: 'kg',
      invoice_price: 8500,
      fpl_price: 5800,
      final_item_note: '11 sealed steel drums 200L — re-refining batch',
      internal_note: 'Confirm drum count with Plant 1 security before next billing',
      fpl_doc_id: null,
      fpl_real_id: null,
      ba_id: 'LMBHN-BA-26-1002',
      inv_id: 'INV-26-1002',
      po_id: 'PO-26-1002',
      client_id: 'CUST-R91BX',
      item_id: 'ITM-26-1002',
      weight_kg: 2150,
      pickup_date: '2026-11-14',
      status: 'verified',
      created_by: 'MCC-W38OP',
      created_at: '2026-11-14T14:20:00.000Z',
    },
    {
      id: 'DATA-26-1003',
      data: '2026-11-19',
      id_user_model: 'CUST-T42KQ',
      id_item_model: 'ITM-26-1005',
      data_type: 'pickup',
      reference_number: 'SJ-KLP-1119',
      manifest_number: 'FST-2026-08901',
      quantity: 3420,
      unit: 'kg',
      invoice_price: 9800,
      fpl_price: 6900,
      final_item_note: '4 jumbo bags 1000kg liner — sludge IPAL elektroplating',
      internal_note: 'Moisture sample passed lab pre-check at 28%',
      fpl_doc_id: null,
      fpl_real_id: null,
      ba_id: 'LMBHN-BA-26-1003',
      inv_id: null,
      po_id: 'PO-26-1003',
      client_id: 'CUST-T42KQ',
      item_id: 'ITM-26-1005',
      weight_kg: 3420,
      pickup_date: '2026-11-19',
      status: 'recorded',
      created_by: 'MCC-W38OP',
      created_at: '2026-11-19T15:10:00.000Z',
    },
    {
      id: 'DATA-26-1004',
      data: '2026-11-20',
      id_user_model: 'CUST-M54ED',
      id_item_model: 'ITM-26-1006',
      data_type: 'transport',
      reference_number: 'TRP-GMN-1120',
      manifest_number: null,
      quantity: 1,
      unit: 'trip',
      invoice_price: 2500000,
      fpl_price: 0,
      final_item_note: 'Dedicated B3 hazmat truck mobilization — Kuningan route',
      internal_note: 'Special weekend overtime surcharge included',
      fpl_doc_id: null,
      fpl_real_id: null,
      ba_id: null,
      inv_id: null,
      po_id: null,
      client_id: 'CUST-M54ED',
      item_id: 'ITM-26-1006',
      weight_kg: 0,
      pickup_date: '2026-11-20',
      status: 'recorded',
      created_by: 'MCC-1001',
      created_at: '2026-11-20T10:00:00.000Z',
    },
  ],
  purchase_orders: [
    {
      id: 'PO-26-1001',
      id_user_model: 'CUST-M54ED',
      client_id: 'CUST-M54ED',
      branch_id: 'BRC-26-1001',
      item_ids: ['ITM-26-1001'],
      po_number: 'PO/GMN/XI/2026/014',
      note: 'Monthly medical B3 waste disposal authorization.',
      date_period: '2026-11-02',
      issue_date: '2026-11-02',
      subtotal_amount: 14126126,
      adjustments: [{ id: 'adj-po-1', label: 'PPN 11%', type: 'percent', value: 11, amount: 1553874 }],
      total_amount: 15680000,
      status: 'fulfilled',
      created_by: 'MCC-1001',
      created_at: '2026-11-02T09:00:00.000Z',
    },
    {
      id: 'PO-26-1002',
      id_user_model: 'CUST-R91BX',
      client_id: 'CUST-R91BX',
      branch_id: 'BRC-26-1003',
      item_ids: ['ITM-26-1002', 'ITM-26-1003'],
      po_number: 'PO/SMK/2026/1189',
      note: 'Automotive oil & drum disposal order.',
      date_period: '2026-11-06',
      issue_date: '2026-11-06',
      subtotal_amount: 22477477,
      adjustments: [{ id: 'adj-po-2', label: 'PPN 11%', type: 'percent', value: 11, amount: 2472523 }],
      total_amount: 24950000,
      status: 'open',
      created_by: 'MCC-A71DM',
      created_at: '2026-11-06T10:45:00.000Z',
    },
    {
      id: 'PO-26-1003',
      id_user_model: 'CUST-T42KQ',
      client_id: 'CUST-T42KQ',
      branch_id: 'BRC-26-1004',
      item_ids: ['ITM-26-1005', 'ITM-26-1004'],
      po_number: 'PO/KLP/XI/2026/077',
      note: 'IPAL electroplating sludge collection.',
      date_period: '2026-11-12',
      issue_date: '2026-11-12',
      subtotal_amount: 34594595,
      adjustments: [{ id: 'adj-po-3', label: 'PPN 11%', type: 'percent', value: 11, amount: 3805405 }],
      total_amount: 38400000,
      status: 'open',
      created_by: 'MCC-1001',
      created_at: '2026-11-12T13:15:00.000Z',
    },
  ],
  berita_acara: [
    {
      id: 'LMBHN-BA-26-1001',
      id_user_model: 'CUST-M54ED',
      note: 'Signed at RS Graha Medika Kuningan by dr. Ratna Dewi & Agus Setiawan.',
      date_period: '2026-11-10',
      id_certificate: 'LMBHN-CERT-26-1001',
      client_id: 'CUST-M54ED',
      ba_date: '2026-11-10',
      status: 'signed',
      created_by: 'MCC-1001',
      created_at: '2026-11-10T16:00:00.000Z',
    },
    {
      id: 'LMBHN-BA-26-1002',
      id_user_model: 'CUST-R91BX',
      note: 'Signed at Plant 1 Karawang by Ir. Hendra Wijaya.',
      date_period: '2026-11-14',
      id_certificate: 'LMBHN-CERT-26-1002',
      client_id: 'CUST-R91BX',
      ba_date: '2026-11-14',
      status: 'signed',
      created_by: 'MCC-A71DM',
      created_at: '2026-11-14T17:15:00.000Z',
    },
    {
      id: 'LMBHN-BA-26-1003',
      id_user_model: 'CUST-T42KQ',
      note: 'Awaiting client EHS countersignature at Jababeka II.',
      date_period: '2026-11-19',
      id_certificate: null,
      client_id: 'CUST-T42KQ',
      ba_date: '2026-11-19',
      status: 'draft',
      created_by: 'MCC-1001',
      created_at: '2026-11-19T17:45:00.000Z',
    },
  ],
  invoices: [
    {
      id: 'INV-26-1001',
      company_id: 'COMP-MCC-001',
      invoice_number: 'INV-26-1001',
      id_user_model: 'CUST-M54ED',
      client_id: 'CUST-M54ED',
      note: 'Transfer to BCA PT. Media Cahaya Cerah — NET 30.',
      date_period: '2026-11-11',
      po_id: 'PO-26-1001',
      ba_id: 'LMBHN-BA-26-1001',
      issue_date: '2026-11-11',
      due_date: '2026-12-11',
      subtotal_amount: 14126126,
      adjustments: [{ id: 'adj-inv-1', label: 'PPN 11%', type: 'percent', value: 11, amount: 1553874 }],
      tax_amount: 1553874,
      total_amount: 15680000,
      amount: 15680000,
      id_user_comission: 'MCC-M49KT',
      comission_amount: 784000,
      commission_user_id: 'MCC-M49KT',
      commission_amount: 784000,
      is_canceled: false,
      canceled_at: null,
      cancel_reason: null,
      status: 'unpaid',
      created_by: 'MCC-1001',
      created_at: '2026-11-11T09:00:00.000Z',
    },
    {
      id: 'INV-26-1002',
      company_id: 'COMP-MCC-001',
      invoice_number: 'INV-26-1002',
      id_user_model: 'CUST-R91BX',
      client_id: 'CUST-R91BX',
      note: 'October industrial waste collection settlement.',
      date_period: '2026-10-15',
      po_id: 'PO-26-1002',
      ba_id: 'LMBHN-BA-26-1002',
      issue_date: '2026-10-15',
      due_date: '2026-11-14',
      subtotal_amount: 22477477,
      adjustments: [{ id: 'adj-inv-2', label: 'PPN 11%', type: 'percent', value: 11, amount: 2472523 }],
      tax_amount: 2472523,
      total_amount: 24950000,
      amount: 24950000,
      id_user_comission: 'MCC-M49KT',
      comission_amount: 1122750,
      commission_user_id: 'MCC-M49KT',
      commission_amount: 1122750,
      is_canceled: false,
      canceled_at: null,
      cancel_reason: null,
      status: 'overdue',
      created_by: 'MCC-A71DM',
      created_at: '2026-10-15T10:30:00.000Z',
    },
    {
      id: 'INV-26-1003',
      company_id: 'COMP-MCC-001',
      invoice_number: 'INV-26-1003',
      id_user_model: 'CUST-T42KQ',
      client_id: 'CUST-T42KQ',
      note: 'Settled via BCA Corporate transfer.',
      date_period: '2026-10-20',
      po_id: 'PO-26-1003',
      ba_id: 'LMBHN-BA-26-1003',
      issue_date: '2026-10-20',
      due_date: '2026-11-19',
      subtotal_amount: 34594595,
      adjustments: [{ id: 'adj-inv-3', label: 'PPN 11%', type: 'percent', value: 11, amount: 3805405 }],
      tax_amount: 3805405,
      total_amount: 38400000,
      amount: 38400000,
      id_user_comission: null,
      comission_amount: 0,
      commission_user_id: null,
      commission_amount: 0,
      is_canceled: false,
      canceled_at: null,
      cancel_reason: null,
      status: 'paid',
      created_by: 'MCC-1001',
      created_at: '2026-10-20T14:00:00.000Z',
    },
  ],
  certificates: [
    {
      id: 'LMBHN-CERT-26-1001',
      id_user_model: 'CUST-M54ED',
      client_id: 'CUST-M54ED',
      note: 'Thermal Incineration (1100°C) verified — Festronik KLHK compliant.',
      date_period: '2026-11-13',
      issued_date: '2026-11-13',
      status: 'verified',
      created_by: 'MCC-1001',
      created_at: '2026-11-13T10:00:00.000Z',
    },
    {
      id: 'LMBHN-CERT-26-1002',
      id_user_model: 'CUST-R91BX',
      client_id: 'CUST-R91BX',
      note: 'Re-refining & fuel blending batch certificate.',
      date_period: '2026-11-17',
      issued_date: '2026-11-17',
      status: 'issued',
      created_by: 'MCC-A71DM',
      created_at: '2026-11-17T11:30:00.000Z',
    },
  ],
  fpl_real: [
    {
      id: 'LMBHN-FPLREAL-26-1001',
      id_user_model: 'CUST-M54ED',
      note: 'Actual treatment partner manifest settlement — November Batch 1.',
      date_period: '2026-11-12',
      subtotal_amount: 9513570,
      adjustments: [{ id: 'adj-fplr-1', label: 'PPN 11%', type: 'percent', value: 11, amount: 1046493 }],
      total_amount: 10560063,
      created_by: 'MCC-1001',
      created_at: '2026-11-12T10:00:00.000Z',
    },
  ],
  fpl_doc: [
    {
      id: 'LMBHN-FPLDOC-26-1001',
      id_user_model: 'CUST-M54ED',
      note: 'Partner documented manifest bill — November Batch 1.',
      date_period: '2026-11-12',
      subtotal_amount: 9513570,
      adjustments: [{ id: 'adj-fpld-1', label: 'PPN 11%', type: 'percent', value: 11, amount: 1046493 }],
      total_amount: 10560063,
      created_by: 'MCC-1001',
      created_at: '2026-11-12T10:15:00.000Z',
    },
  ],
  commissions: [
    {
      id: 'COM-26-1001',
      marketing_id: 'MCC-M49KT',
      client_id: 'CUST-M54ED',
      invoice_id: 'INV-26-1001',
      period: '2026-11',
      rate_percent: 5,
      commission_amount: 784000,
      status: 'pending',
      created_by: 'MCC-1001',
      created_at: '2026-11-11T09:15:00.000Z',
    },
    {
      id: 'COM-26-1002',
      marketing_id: 'MCC-M49KT',
      client_id: 'CUST-R91BX',
      invoice_id: 'INV-26-1002',
      period: '2026-10',
      rate_percent: 4.5,
      commission_amount: 1122750,
      status: 'approved',
      created_by: 'MCC-1001',
      created_at: '2026-10-16T08:40:00.000Z',
    },
  ],
  logs: [],
};

async function findMasterWorker(): Promise<StoredWorker | null> {
  if (isSupabaseConfigured) {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from('workers')
      .select('*')
      .eq('role', 'master')
      .limit(1);
    if (error) {
      throw new Error(`Supabase workers query failed: ${error.message}`);
    }
    return (data?.[0] as StoredWorker) || null;
  }
  return localDb.workers.find((w) => w.role === 'master') || null;
}

export async function getAuthStatus(): Promise<{
  hasMaster: boolean;
  supabaseConfigured: boolean;
}> {
  try {
    const master = await findMasterWorker();
    return {
      hasMaster: Boolean(master),
      supabaseConfigured: isSupabaseConfigured,
    };
  } catch (err) {
    console.error('Error checking auth status:', err);
    return {
      hasMaster: false,
      supabaseConfigured: isSupabaseConfigured,
    };
  }
}

export async function signUpOfficeWorker(input: {
  id?: string;
  name: string;
  username: string;
  email: string;
  password: string;
  phone?: string | null;
  emailRedirectTo: string;
}): Promise<{
  requiresEmailConfirmation: true;
  email: string;
  worker: WorkerRecord;
  token: string;
  emailConfirmed: boolean;
  lockReason: AccountLockReason;
  requiresReloginAfterUnlock?: boolean;
  message: string;
  previewConfirmToken?: string;
  resendCooldownSeconds: number;
}> {
  const name = input.name.trim();
  const username = input.username.trim().toLowerCase();
  const email = input.email.trim().toLowerCase();
  const phone = input.phone?.trim() || null;

  if (!name || !username) {
    throw new AuthError('Name and username are required.', 400);
  }
  if (!isValidEmail(email)) {
    throw new AuthError('A valid email address is required for office registration.', 400);
  }
  if (input.password.length < 6) {
    throw new AuthError('Password must be at least 6 characters.', 400);
  }

  // Office Sign Up always registers a Master account with status = 'inactive'
  // (must confirm email AND be manually activated in Supabase before dashboard access).
  const assignedRole: WorkerRole = 'master';

  const existingWorkers = await listAllRecords('workers');
  const existingIds = existingWorkers.map((w) => w.id);
  const hasMcc1001 = existingIds.some((id) => id.toUpperCase() === 'MCC-1001');
  const explicitId = input.id?.trim() || (!hasMcc1001 ? 'MCC-1001' : undefined);

  if (
    explicitId &&
    existingIds.some((e) => e.toUpperCase() === explicitId.toUpperCase())
  ) {
    throw new AuthError(`Worker ID "${explicitId}" already exists.`, 409);
  }

  const workerId = generateEntityId(
    'workers',
    existingIds,
    new Date().toISOString(),
    explicitId
  );

  if (isSupabaseConfigured) {
    const admin = getSupabaseAdmin();
    const anon = getSupabaseAnon();

    const [{ data: dupUser }, { data: dupEmail }] = await Promise.all([
      admin.from('workers').select('id').eq('username', username).maybeSingle(),
      admin.from('workers').select('id').eq('auth_email', email).maybeSingle(),
    ]);

    if (dupUser) {
      throw new AuthError(`Username "${username}" is already registered.`, 409);
    }
    if (dupEmail) {
      throw new AuthError(`Email "${email}" is already registered.`, 409);
    }

    const { data: signUpData, error: signUpErr } = await anon.auth.signUp({
      email,
      password: input.password,
      options: {
        emailRedirectTo: input.emailRedirectTo,
        data: {
          worker_id: workerId,
          username,
          name,
          role: assignedRole,
          status: 'inactive',
        },
      },
    });

    if (signUpErr || !signUpData.user) {
      throw new AuthError(
        signUpErr?.message || 'Failed to register account with Supabase Auth.',
        400
      );
    }

    if (
      Array.isArray(signUpData.user.identities) &&
      signUpData.user.identities.length === 0
    ) {
      throw new AuthError(
        'An account with this email already exists. Please sign in or resend the confirmation email.',
        409
      );
    }

    const row = {
      id: workerId,
      auth_user_id: signUpData.user.id,
      name,
      username,
      auth_email: email,
      email,
      phone,
      role: assignedRole,
      status: 'inactive' as const,
      display_picture_url: null,
      created_by: workerId,
      created_at: new Date().toISOString(),
    };

    const { data: inserted, error: dbErr } = await admin
      .from('workers')
      .insert(row)
      .select()
      .single();

    if (dbErr || !inserted) {
      await admin.auth.admin.deleteUser(signUpData.user.id).catch(() => {});
      throw new AuthError(
        `Failed to save worker profile: ${dbErr?.message || 'Empty response from database.'}`,
        500
      );
    }

    const sanitized = sanitizeWorker(inserted as StoredWorker);
    setResendCooldown(sanitized.id, email);
    return {
      requiresEmailConfirmation: true,
      email,
      worker: sanitized,
      token: signLocalToken(sanitized.id, sanitized.role, 'locked'),
      emailConfirmed: false,
      lockReason: 'email_not_confirmed',
      requiresReloginAfterUnlock: true,
      message: `Confirmation email sent to ${email}. Confirm your email to unlock your account.`,
      resendCooldownSeconds: RESEND_COOLDOWN_SECONDS,
    };
  }

  if (localDb.workers.some((w) => w.username.toLowerCase() === username)) {
    throw new AuthError(`Username "${username}" is already registered.`, 409);
  }
  if (localDb.workers.some((w) => w.auth_email?.toLowerCase() === email)) {
    throw new AuthError(`Email "${email}" is already registered.`, 409);
  }

  const confirmToken = crypto.randomBytes(24).toString('hex');
  const newWorker: StoredWorker = {
    id: workerId,
    name,
    username,
    auth_email: email,
    email,
    phone,
    role: assignedRole,
    status: 'inactive',
    display_picture_url: null,
    password_hash: hashPassword(input.password),
    email_confirmed: false,
    confirm_token: confirmToken,
    created_by: workerId,
    created_at: new Date().toISOString(),
  };
  localDb.workers.unshift(newWorker);

  const sanitizedLocal = sanitizeWorker(newWorker);
  setResendCooldown(sanitizedLocal.id, email);
  return {
    requiresEmailConfirmation: true,
    email,
    worker: sanitizedLocal,
    token: signLocalToken(sanitizedLocal.id, sanitizedLocal.role, 'locked'),
    emailConfirmed: false,
    lockReason: 'email_not_confirmed',
    requiresReloginAfterUnlock: false,
    message: `Account created for ${email} (status: inactive). Confirm your email to unlock your account.`,
    previewConfirmToken: confirmToken,
    resendCooldownSeconds: RESEND_COOLDOWN_SECONDS,
  };
}

export async function resendConfirmationEmail(
  emailInput: string,
  emailRedirectTo: string,
  workerId?: string
): Promise<{
  message: string;
  cooldownSeconds: number;
  alreadyConfirmed?: boolean;
}> {
  let email = emailInput.trim().toLowerCase();
  let resolvedWorkerId = workerId;

  if (isSupabaseConfigured) {
    const admin = getSupabaseAdmin();
    const anon = getSupabaseAnon();

    let stored: StoredWorker | null = null;
    if (resolvedWorkerId) {
      const { data } = await admin
        .from('workers')
        .select('*')
        .eq('id', resolvedWorkerId)
        .maybeSingle();
      stored = (data as StoredWorker | null) || null;
    }
    if (!stored && email) {
      const { data } = await admin
        .from('workers')
        .select('*')
        .eq('email', email)
        .maybeSingle();
      stored = (data as StoredWorker | null) || null;
    }

    if (stored) {
      resolvedWorkerId = stored.id;
      if (stored.email) {
        email = stored.email.trim().toLowerCase();
      }
      // Check live Supabase Auth state: if already confirmed, inform the client immediately
      if (stored.auth_user_id) {
        const { data: authUserData } = await admin.auth.admin.getUserById(
          stored.auth_user_id
        );
        if (authUserData?.user?.email_confirmed_at) {
          return {
            message:
              'Your email address is already confirmed. Checking your account status now.',
            cooldownSeconds: 0,
            alreadyConfirmed: true,
          };
        }
      }
    }

    if (!isValidEmail(email)) {
      throw new AuthError('Please provide a valid email address.', 400);
    }

    const remaining = getResendCooldownRemaining(resolvedWorkerId, email);
    if (remaining > 0) {
      throw new AuthError(
        `Please wait ${formatCooldownText(remaining)} before requesting another confirmation email.`,
        429,
        'RESEND_COOLDOWN',
        email,
        resolvedWorkerId,
        undefined,
        remaining
      );
    }

    const { error } = await anon.auth.resend({
      type: 'signup',
      email,
      options: { emailRedirectTo },
    });

    if (error) {
      const lower = error.message.toLowerCase();
      if (
        error.status === 429 ||
        lower.includes('rate limit') ||
        lower.includes('security purposes') ||
        lower.includes('only request this after')
      ) {
        setResendCooldown(resolvedWorkerId, email, RESEND_COOLDOWN_SECONDS);
        throw new AuthError(
          'Supabase email rate limit reached (default Supabase SMTP allows 2 emails/hour). Wait before retrying, or configure custom SMTP in Supabase Auth settings.',
          429,
          'EMAIL_RATE_LIMIT',
          email,
          resolvedWorkerId,
          undefined,
          RESEND_COOLDOWN_SECONDS
        );
      }
      throw new AuthError(error.message, 400);
    }

    setResendCooldown(resolvedWorkerId, email, RESEND_COOLDOWN_SECONDS);
    return {
      message: `Confirmation email sent to ${email}. Check your inbox and spam folder.`,
      cooldownSeconds: RESEND_COOLDOWN_SECONDS,
    };
  }

  // Local preview fallback
  const found =
    (resolvedWorkerId
      ? localDb.workers.find((w) => w.id === resolvedWorkerId)
      : null) ||
    localDb.workers.find((w) => w.email?.toLowerCase() === email);

  if (found) {
    resolvedWorkerId = found.id;
    if (found.email) email = found.email.toLowerCase();
    if (found.email_confirmed) {
      return {
        message: 'Your email address is already confirmed.',
        cooldownSeconds: 0,
        alreadyConfirmed: true,
      };
    }
  }

  if (!isValidEmail(email)) {
    throw new AuthError('Please provide a valid email address.', 400);
  }

  const remaining = getResendCooldownRemaining(resolvedWorkerId, email);
  if (remaining > 0) {
    throw new AuthError(
      `Please wait ${formatCooldownText(remaining)} before requesting another confirmation email.`,
      429,
      'RESEND_COOLDOWN',
      email,
      resolvedWorkerId,
      undefined,
      remaining
    );
  }

  setResendCooldown(resolvedWorkerId, email, RESEND_COOLDOWN_SECONDS);
  return {
    message: `Confirmation email re-sent to ${email}.`,
    cooldownSeconds: RESEND_COOLDOWN_SECONDS,
  };
}

export async function changeUnverifiedEmail(
  workerId: string,
  newEmailInput: string,
  emailRedirectTo: string
): Promise<{
  worker: WorkerRecord;
  email: string;
  emailSent: boolean;
  cooldownSeconds: number;
  message: string;
  previewConfirmToken?: string;
}> {
  const newEmail = newEmailInput.trim().toLowerCase();
  if (!isValidEmail(newEmail)) {
    throw new AuthError('Please enter a valid email address.', 400);
  }

  if (isSupabaseConfigured) {
    const admin = getSupabaseAdmin();
    const anon = getSupabaseAnon();

    const { data: workerRow, error: fetchErr } = await admin
      .from('workers')
      .select('*')
      .eq('id', workerId)
      .maybeSingle();

    if (fetchErr || !workerRow) {
      throw new AuthError('Worker account not found.', 404);
    }

    const stored = workerRow as StoredWorker;
    const oldEmail = (stored.email || stored.auth_email || '').trim().toLowerCase();

    if (oldEmail === newEmail) {
      throw new AuthError(
        'Enter a different email address than your current one.',
        400
      );
    }

    // Verify account is still unconfirmed before allowing email change from the lock layer
    if (stored.auth_user_id) {
      const { data: authUserData, error: authFetchErr } =
        await admin.auth.admin.getUserById(stored.auth_user_id);
      if (authFetchErr || !authUserData?.user) {
        throw new AuthError('Unable to verify authentication account.', 500);
      }
      if (authUserData.user.email_confirmed_at) {
        throw new AuthError(
          'Your current email is already confirmed. Click Check Status to continue.',
          400
        );
      }
    }

    // Ensure newEmail isn't taken by another worker
    const { data: allWorkers } = await admin
      .from('workers')
      .select('id, email, auth_email');
    const duplicate = (allWorkers || []).find(
      (w) =>
        w.id !== stored.id &&
        (String(w.email || '').trim().toLowerCase() === newEmail ||
          String(w.auth_email || '').trim().toLowerCase() === newEmail)
    );
    if (duplicate) {
      throw new AuthError(
        `Email "${newEmail}" is already registered to another account.`,
        409
      );
    }

    if (!stored.auth_user_id) {
      throw new AuthError(
        'Missing Supabase Auth link for this worker account.',
        500
      );
    }

    // Step 1: Update email in Supabase Auth while keeping email unconfirmed
    const { error: authUpdateErr } = await admin.auth.admin.updateUserById(
      stored.auth_user_id,
      {
        email: newEmail,
        email_confirm: false,
      }
    );
    if (authUpdateErr) {
      throw new AuthError(
        authUpdateErr.message || 'Unable to update email in Supabase Auth.',
        400
      );
    }

    // Step 2: Update public.workers (rollback auth email if DB update fails)
    const { data: updatedRow, error: dbUpdateErr } = await admin
      .from('workers')
      .update({ email: newEmail, auth_email: newEmail })
      .eq('id', stored.id)
      .select()
      .single();

    if (dbUpdateErr || !updatedRow) {
      await admin.auth.admin
        .updateUserById(stored.auth_user_id, {
          email: oldEmail,
          email_confirm: false,
        })
        .catch(() => {});
      throw new AuthError(
        `Failed to update worker email: ${dbUpdateErr?.message || 'Database error.'}`,
        500
      );
    }

    // Step 3: Trigger verification email to the new email address
    const { error: resendErr } = await anon.auth.resend({
      type: 'signup',
      email: newEmail,
      options: { emailRedirectTo },
    });

    const sanitized = sanitizeWorker(updatedRow as StoredWorker);
    setResendCooldown(sanitized.id, newEmail, RESEND_COOLDOWN_SECONDS);

    if (resendErr) {
      return {
        worker: sanitized,
        email: newEmail,
        emailSent: false,
        cooldownSeconds: RESEND_COOLDOWN_SECONDS,
        message: `Email changed to ${newEmail}, but sending the verification link was delayed (${resendErr.message}). Wait for cooldown and click Resend.`,
      };
    }

    return {
      worker: sanitized,
      email: newEmail,
      emailSent: true,
      cooldownSeconds: RESEND_COOLDOWN_SECONDS,
      message: `Email updated to ${newEmail} and a new confirmation link has been sent.`,
    };
  }

  // Local preview fallback
  const found = localDb.workers.find((w) => w.id === workerId);
  if (!found) {
    throw new AuthError('Worker account not found.', 404);
  }
  if (found.email_confirmed) {
    throw new AuthError('Your current email is already confirmed.', 400);
  }
  if ((found.email || '').toLowerCase() === newEmail) {
    throw new AuthError(
      'Enter a different email address than your current one.',
      400
    );
  }
  if (
    localDb.workers.some(
      (w) =>
        w.id !== found.id &&
        (w.email?.toLowerCase() === newEmail ||
          w.auth_email?.toLowerCase() === newEmail)
    )
  ) {
    throw new AuthError(
      `Email "${newEmail}" is already registered to another account.`,
      409
    );
  }

  found.email = newEmail;
  found.auth_email = newEmail;
  found.email_confirmed = false;
  found.confirm_token = crypto.randomBytes(24).toString('hex');
  setResendCooldown(found.id, newEmail, RESEND_COOLDOWN_SECONDS);

  return {
    worker: sanitizeWorker(found),
    email: newEmail,
    emailSent: true,
    cooldownSeconds: RESEND_COOLDOWN_SECONDS,
    message: `Email updated to ${newEmail} and confirmation link sent.`,
    previewConfirmToken: found.confirm_token,
  };
}

export async function requestPasswordReset(
  identifierInput: string,
  redirectTo: string
): Promise<{
  message: string;
  cooldownSeconds: number;
  previewResetToken?: string;
}> {
  const identifier = identifierInput.trim().toLowerCase();
  if (!identifier) {
    throw new AuthError('Please enter your username or email address.', 400);
  }

  if (isSupabaseConfigured) {
    const admin = getSupabaseAdmin();
    const anon = getSupabaseAnon();

    const { data: allWorkers, error: lookupErr } = await admin
      .from('workers')
      .select('*');
    if (lookupErr) {
      throw new AuthError('Unable to look up account right now.', 500);
    }

    const stored = (allWorkers || []).find(
      (w) =>
        String(w.username || '').trim().toLowerCase() === identifier ||
        String(w.email || '').trim().toLowerCase() === identifier ||
        String(w.auth_email || '').trim().toLowerCase() === identifier
    ) as StoredWorker | undefined;

    if (!stored) {
      // If user typed a valid email address not yet found, still respond generically to prevent account enumeration
      if (isValidEmail(identifier)) {
        return {
          message:
            'If an account with that email exists, a password reset link has been sent.',
          cooldownSeconds: RESEND_COOLDOWN_SECONDS,
        };
      }
      throw new AuthError(
        'No account found with that username or email address.',
        404
      );
    }

    const targetEmail = (stored.email || '').trim().toLowerCase();
    if (!targetEmail || !isValidEmail(targetEmail) || isInternalAuthEmail(targetEmail)) {
      throw new AuthError(
        'This account does not have a recovery email on file. Ask a Master administrator to reset the password.',
        400
      );
    }

    const remaining = getResendCooldownRemaining(stored.id, targetEmail);
    if (remaining > 0) {
      throw new AuthError(
        `Please wait ${formatCooldownText(remaining)} before requesting another email.`,
        429,
        'RESET_COOLDOWN',
        targetEmail,
        stored.id,
        undefined,
        remaining
      );
    }

    const { error } = await anon.auth.resetPasswordForEmail(targetEmail, {
      redirectTo,
    });

    if (error) {
      const lower = error.message.toLowerCase();
      if (
        error.status === 429 ||
        lower.includes('rate limit') ||
        lower.includes('security purposes') ||
        lower.includes('only request this after')
      ) {
        setResendCooldown(stored.id, targetEmail, RESEND_COOLDOWN_SECONDS);
        throw new AuthError(
          'Supabase email rate limit reached (default Supabase SMTP allows 2 emails/hour). Wait before retrying, or configure custom SMTP in Supabase Auth settings.',
          429,
          'EMAIL_RATE_LIMIT',
          targetEmail,
          stored.id,
          undefined,
          RESEND_COOLDOWN_SECONDS
        );
      }
      throw new AuthError(error.message, 400);
    }

    setResendCooldown(stored.id, targetEmail, RESEND_COOLDOWN_SECONDS);
    return {
      message: `Password reset link sent to ${targetEmail}. Check your inbox and spam folder.`,
      cooldownSeconds: RESEND_COOLDOWN_SECONDS,
    };
  }

  // Local preview fallback
  const found = localDb.workers.find(
    (w) =>
      w.username.toLowerCase() === identifier ||
      (w.email && w.email.toLowerCase() === identifier)
  );
  if (!found) {
    if (isValidEmail(identifier)) {
      return {
        message:
          'If an account with that email exists, a password reset link has been sent.',
        cooldownSeconds: RESEND_COOLDOWN_SECONDS,
      };
    }
    throw new AuthError('No account found with that username or email address.', 404);
  }
  if (!found.email) {
    throw new AuthError(
      'This account does not have a recovery email on file. Ask a Master administrator to reset the password.',
      400
    );
  }

  const remaining = getResendCooldownRemaining(found.id, found.email);
  if (remaining > 0) {
    throw new AuthError(
      `Please wait ${formatCooldownText(remaining)} before requesting another email.`,
      429,
      'RESET_COOLDOWN',
      found.email,
      found.id,
      undefined,
      remaining
    );
  }

  found.reset_token = crypto.randomBytes(24).toString('hex');
  setResendCooldown(found.id, found.email, RESEND_COOLDOWN_SECONDS);
  return {
    message: `Password reset link sent to ${found.email}.`,
    cooldownSeconds: RESEND_COOLDOWN_SECONDS,
    previewResetToken: found.reset_token,
  };
}

export async function completePasswordReset(input: {
  code?: string;
  tokenHash?: string;
  accessToken?: string;
  previewToken?: string;
  newPassword: string;
}): Promise<{ message: string }> {
  if (!input.newPassword || input.newPassword.length < 6) {
    throw new AuthError('New password must be at least 6 characters.', 400);
  }

  if (isSupabaseConfigured) {
    const anon = getSupabaseAnon();
    const admin = getSupabaseAdmin();

    let authUserId: string | null = null;

    if (input.code) {
      const { data, error } = await anon.auth.exchangeCodeForSession(input.code);
      if (error || !data.user) {
        throw new AuthError(
          error?.message || 'Password reset link is invalid or has expired.',
          400
        );
      }
      authUserId = data.user.id;
    } else if (input.tokenHash) {
      const { data, error } = await anon.auth.verifyOtp({
        token_hash: input.tokenHash,
        type: 'recovery',
      });
      if (error || !data.user) {
        throw new AuthError(
          error?.message || 'Password reset link is invalid or has expired.',
          400
        );
      }
      authUserId = data.user.id;
    } else if (input.accessToken) {
      const { data: userData, error } = await admin.auth.getUser(
        input.accessToken
      );
      if (error || !userData.user) {
        throw new AuthError(
          'Password reset link is invalid or has expired. Please request a new one.',
          400
        );
      }
      authUserId = userData.user.id;
    } else {
      throw new AuthError('Missing password reset verification token.', 400);
    }

    const { error: updateErr } = await admin.auth.admin.updateUserById(
      authUserId,
      { password: input.newPassword }
    );
    if (updateErr) {
      throw new AuthError(
        updateErr.message || 'Unable to update password right now.',
        400
      );
    }

    return {
      message: 'Your password has been updated. Sign in with your new password.',
    };
  }

  // Local preview fallback
  if (!input.previewToken) {
    throw new AuthError('Missing password reset token.', 400);
  }
  const found = localDb.workers.find((w) => w.reset_token === input.previewToken);
  if (!found) {
    throw new AuthError('Invalid or expired password reset token.', 400);
  }
  found.password_hash = hashPassword(input.newPassword);
  found.reset_token = null;
  return {
    message: 'Your password has been updated. Sign in with your new password.',
  };
}

export async function confirmEmailCallback(input: {
  code?: string;
  tokenHash?: string;
  type?: string;
  accessToken?: string;
  previewToken?: string;
}): Promise<{
  confirmed: boolean;
  message: string;
  accountInactive?: boolean;
  workerId?: string;
  token?: string;
  worker?: WorkerRecord;
  emailConfirmed?: boolean;
  lockReason?: AccountLockReason;
}> {
  if (isSupabaseConfigured) {
    const anon = getSupabaseAnon();
    const admin = getSupabaseAdmin();

    let authUserId: string | null = null;
    let sessionToken: string | undefined;

    if (input.code) {
      const { data, error } = await anon.auth.exchangeCodeForSession(input.code);
      if (error || !data.session || !data.user) {
        throw new AuthError(
          error?.message || 'Confirmation link is invalid or has expired.',
          400
        );
      }
      if (!data.user.email_confirmed_at) {
        throw new AuthError('Email is not yet confirmed.', 400);
      }
      authUserId = data.user.id;
      sessionToken = data.session.access_token;
    } else if (input.tokenHash) {
      const otpType =
        input.type === 'email' || input.type === 'magiclink'
          ? input.type
          : 'signup';
      const { data, error } = await anon.auth.verifyOtp({
        token_hash: input.tokenHash,
        type: otpType,
      });
      if (error || !data.user) {
        throw new AuthError(
          error?.message || 'Confirmation link is invalid or has expired.',
          400
        );
      }
      authUserId = data.user.id;
      sessionToken = data.session?.access_token;
    } else if (input.accessToken) {
      const { data: userData, error } = await admin.auth.getUser(
        input.accessToken
      );
      if (error || !userData.user) {
        throw new AuthError('Invalid or expired confirmation session.', 400);
      }
      if (!userData.user.email_confirmed_at) {
        throw new AuthError('Email address is not yet confirmed.', 400);
      }
      authUserId = userData.user.id;
      sessionToken = input.accessToken;
    } else {
      throw new AuthError('Missing confirmation parameters.', 400);
    }

    const { data: workerRow } = await admin
      .from('workers')
      .select('*')
      .eq('auth_user_id', authUserId)
      .maybeSingle();

    const stored = workerRow as StoredWorker | null;
    if (stored && stored.status !== 'active') {
      const sanitized = sanitizeWorker(stored);
      return {
        confirmed: true,
        accountInactive: true,
        workerId: stored.id,
        token: sessionToken || signLocalToken(sanitized.id, sanitized.role, 'locked'),
        worker: sanitized,
        emailConfirmed: true,
        lockReason: 'account_inactive',
        message:
          'Email confirmed. Your account status is currently inactive and must be set to active in Supabase before unlocking the dashboard.',
      };
    }

    return {
      confirmed: true,
      message: 'Email confirmed successfully.',
      token: stored ? sessionToken : undefined,
      worker: stored ? sanitizeWorker(stored) : undefined,
      emailConfirmed: true,
      lockReason: null,
    };
  }

  // Preview fallback confirmation
  if (!input.previewToken) {
    throw new AuthError('Missing confirmation token.', 400);
  }
  const found = localDb.workers.find((w) => w.confirm_token === input.previewToken);
  if (!found) {
    throw new AuthError('Invalid or expired confirmation token.', 400);
  }
  found.email_confirmed = true;
  found.confirm_token = null;

  const sanitizedFound = sanitizeWorker(found);
  if (found.status !== 'active') {
    return {
      confirmed: true,
      accountInactive: true,
      workerId: found.id,
      token: signLocalToken(found.id, found.role, 'full'),
      worker: sanitizedFound,
      emailConfirmed: true,
      lockReason: 'account_inactive',
      message:
        'Email confirmed. Your account status is currently inactive and must be activated before unlocking the dashboard.',
    };
  }

  return {
    confirmed: true,
    message: 'Email confirmed successfully.',
    token: signLocalToken(found.id, found.role, 'full'),
    worker: sanitizedFound,
    emailConfirmed: true,
    lockReason: null,
  };
}

export async function loginWithUsername(
  identifierInput: string,
  password: string
): Promise<{
  token: string;
  refreshToken?: string;
  worker: WorkerRecord;
  emailConfirmed: boolean;
  lockReason: AccountLockReason;
  requiresReloginAfterUnlock?: boolean;
  previewConfirmToken?: string;
  resendCooldownSeconds?: number;
}> {
  const identifier = identifierInput.trim().toLowerCase();

  if (isSupabaseConfigured) {
    const admin = getSupabaseAdmin();
    const anon = getSupabaseAnon();

    const lookupCol = identifier.includes('@') ? 'email' : 'username';
    let { data: workerRow, error: lookupErr } = await admin
      .from('workers')
      .select('*')
      .eq(lookupCol, identifier)
      .maybeSingle();

    if (!lookupErr && !workerRow && identifier.includes('@')) {
      const byAuthEmail = await admin
        .from('workers')
        .select('*')
        .eq('auth_email', identifier)
        .maybeSingle();
      workerRow = byAuthEmail.data;
      lookupErr = byAuthEmail.error;
    }

    // Fallback case-insensitive lookup in case values were edited manually in Supabase
    if (!lookupErr && !workerRow) {
      const { data: allWorkers, error: allErr } = await admin
        .from('workers')
        .select('*');
      if (!allErr && allWorkers) {
        workerRow =
          allWorkers.find(
            (w) =>
              String(w.username || '').trim().toLowerCase() === identifier ||
              String(w.email || '').trim().toLowerCase() === identifier ||
              String(w.auth_email || '').trim().toLowerCase() === identifier
          ) || null;
      }
    }

    if (lookupErr) {
      throw new AuthError('Authentication lookup failed.', 500);
    }
    if (!workerRow) {
      throw new AuthError('Invalid username/email or password.', 401);
    }

    const stored = workerRow as StoredWorker;
    const sanitized = sanitizeWorker(stored);
    // Internal @limbahin.internal placeholder emails are NEVER treated as real user emails
    const hasRealEmail = Boolean(sanitized.email);

    const authLoginEmail = (stored.auth_email || stored.email || '').trim();
    if (!authLoginEmail) {
      throw new AuthError('Invalid username/email or password.', 401);
    }

    const { data: authData, error: authErr } =
      await anon.auth.signInWithPassword({
        email: authLoginEmail,
        password,
      });

    // Gate 1: If email is not yet confirmed in Supabase Auth, still allow login
    // into a locked dashboard session so the translucent lock layer is shown.
    if (authErr) {
      const lower = authErr.message.toLowerCase();
      const errCode =
        typeof (authErr as { code?: string }).code === 'string'
          ? (authErr as { code?: string }).code
          : '';
      if (
        hasRealEmail &&
        (errCode === 'email_not_confirmed' ||
          lower.includes('email not confirmed') ||
          lower.includes('confirm'))
      ) {
        return {
          token: signLocalToken(sanitized.id, sanitized.role, 'locked'),
          worker: sanitized,
          emailConfirmed: false,
          lockReason: 'email_not_confirmed',
          requiresReloginAfterUnlock: true,
          resendCooldownSeconds: getResendCooldownRemaining(
            sanitized.id,
            sanitized.email
          ),
        };
      }
      throw new AuthError('Invalid username/email or password.', 401);
    }

    if (!authData.session || !authData.user) {
      throw new AuthError('Invalid username/email or password.', 401);
    }

    if (hasRealEmail && !authData.user.email_confirmed_at) {
      return {
        token: authData.session.access_token,
        refreshToken: authData.session.refresh_token,
        worker: sanitized,
        emailConfirmed: false,
        lockReason: 'email_not_confirmed',
        requiresReloginAfterUnlock: false,
        resendCooldownSeconds: getResendCooldownRemaining(
          sanitized.id,
          sanitized.email
        ),
      };
    }

    // Gate 2: Email confirmed, check worker active status -> lock dashboard if inactive
    if (stored.status !== 'active') {
      return {
        token: authData.session.access_token,
        refreshToken: authData.session.refresh_token,
        worker: sanitized,
        emailConfirmed: true,
        lockReason: 'account_inactive',
        requiresReloginAfterUnlock: false,
      };
    }

    return {
      token: authData.session.access_token,
      refreshToken: authData.session.refresh_token,
      worker: sanitized,
      emailConfirmed: true,
      lockReason: null,
      requiresReloginAfterUnlock: false,
    };
  }

  const found = localDb.workers.find(
    (w) =>
      w.username.toLowerCase() === identifier ||
      (w.email && w.email.toLowerCase() === identifier)
  );
  if (!found || !verifyPassword(password, found.password_hash)) {
    throw new AuthError('Invalid username/email or password.', 401);
  }

  const sanitizedLocal = sanitizeWorker(found);
  if (found.email && found.email_confirmed === false) {
    return {
      token: signLocalToken(found.id, found.role, 'locked'),
      worker: sanitizedLocal,
      emailConfirmed: false,
      lockReason: 'email_not_confirmed',
      requiresReloginAfterUnlock: false,
      previewConfirmToken: found.confirm_token ?? undefined,
      resendCooldownSeconds: getResendCooldownRemaining(found.id, found.email),
    };
  }
  if (found.status !== 'active') {
    return {
      token: signLocalToken(found.id, found.role, 'full'),
      worker: sanitizedLocal,
      emailConfirmed: true,
      lockReason: 'account_inactive',
      requiresReloginAfterUnlock: false,
    };
  }

  return {
    token: signLocalToken(found.id, found.role, 'full'),
    worker: sanitizedLocal,
    emailConfirmed: true,
    lockReason: null,
    requiresReloginAfterUnlock: false,
  };
}

export async function restoreRememberedSession(encryptedCookie: string): Promise<{
  token: string;
  refreshedCookie?: string;
  worker: WorkerRecord;
  emailConfirmed: boolean;
  lockReason: AccountLockReason;
  requiresReloginAfterUnlock: boolean;
  resendCooldownSeconds: number;
} | null> {
  const payload = decryptRememberPayload(encryptedCookie);
  if (!payload) return null;

  const existingSession = await inspectSessionToken(payload.token);
  if (existingSession) {
    return {
      token: payload.token,
      ...existingSession,
    };
  }

  // If Supabase access token expired, refresh transparently with stored refresh_token
  if (isSupabaseConfigured && payload.refreshToken) {
    const anon = getSupabaseAnon();
    const { data, error } = await anon.auth.refreshSession({
      refresh_token: payload.refreshToken,
    });
    if (!error && data.session?.access_token) {
      const refreshedSession = await inspectSessionToken(data.session.access_token);
      if (refreshedSession) {
        const refreshedCookie = encryptRememberPayload({
          token: data.session.access_token,
          refreshToken: data.session.refresh_token || payload.refreshToken,
          workerId: refreshedSession.worker.id,
          role: refreshedSession.worker.role,
          exp: payload.exp,
        });
        return {
          token: data.session.access_token,
          refreshedCookie,
          ...refreshedSession,
        };
      }
    }
    return null;
  }

  // Local preview fallback: re-sign fresh token within the 30-day Remember Me window
  if (!isSupabaseConfigured) {
    const found = localDb.workers.find((w) => w.id === payload.workerId);
    if (!found) return null;
    const scope = found.email && found.email_confirmed === false ? 'locked' : 'full';
    const nextToken = signLocalToken(found.id, found.role, scope);
    const nextSession = await inspectSessionToken(nextToken);
    if (!nextSession) return null;
    const refreshedCookie = encryptRememberPayload({
      token: nextToken,
      workerId: found.id,
      role: found.role,
      exp: payload.exp,
    });
    return {
      token: nextToken,
      refreshedCookie,
      ...nextSession,
    };
  }

  return null;
}

export async function inspectSessionToken(token: string): Promise<{
  worker: WorkerRecord;
  emailConfirmed: boolean;
  lockReason: AccountLockReason;
  requiresReloginAfterUnlock: boolean;
  resendCooldownSeconds: number;
} | null> {
  if (!token) return null;

  if (isSupabaseConfigured) {
    const admin = getSupabaseAdmin();

    // Check if this is a restricted locked-session token (for unconfirmed real-email accounts)
    const lockedPayload = verifyLocalToken(token);
    if (lockedPayload && lockedPayload.scope === 'locked') {
      const { data: workerRow, error: workerErr } = await admin
        .from('workers')
        .select('*')
        .eq('id', lockedPayload.sub)
        .maybeSingle();

      if (workerErr || !workerRow) return null;
      const stored = workerRow as StoredWorker;
      const sanitized = sanitizeWorker(stored);
      const hasRealEmail = Boolean(sanitized.email);

      let emailConfirmed = !hasRealEmail;
      if (hasRealEmail && stored.auth_user_id) {
        const { data: authUserData } = await admin.auth.admin.getUserById(
          stored.auth_user_id
        );
        emailConfirmed = Boolean(authUserData?.user?.email_confirmed_at);
      }

      const lockReason: AccountLockReason = !emailConfirmed
        ? 'email_not_confirmed'
        : stored.status !== 'active'
          ? 'account_inactive'
          : null;

      return {
        worker: sanitized,
        emailConfirmed,
        lockReason,
        // Once email is confirmed & account is active, upgrade to a real Supabase session JWT
        requiresReloginAfterUnlock: lockReason === null,
        resendCooldownSeconds: getResendCooldownRemaining(
          sanitized.id,
          sanitized.email
        ),
      };
    }

    // Standard Supabase Auth session JWT
    const { data: userData, error } = await admin.auth.getUser(token);
    if (error || !userData.user) return null;

    const { data: workerRow, error: workerErr } = await admin
      .from('workers')
      .select('*')
      .eq('auth_user_id', userData.user.id)
      .maybeSingle();

    if (workerErr || !workerRow) return null;
    const stored = workerRow as StoredWorker;
    const sanitized = sanitizeWorker(stored);
    const hasRealEmail = Boolean(sanitized.email);
    const emailConfirmed = !hasRealEmail || Boolean(userData.user.email_confirmed_at);
    const lockReason: AccountLockReason = !emailConfirmed
      ? 'email_not_confirmed'
      : stored.status !== 'active'
        ? 'account_inactive'
        : null;

    return {
      worker: sanitized,
      emailConfirmed,
      lockReason,
      requiresReloginAfterUnlock: false,
      resendCooldownSeconds: getResendCooldownRemaining(
        sanitized.id,
        sanitized.email
      ),
    };
  }

  const payload = verifyLocalToken(token);
  if (!payload) return null;
  const worker = localDb.workers.find((w) => w.id === payload.sub);
  if (!worker) return null;
  const emailConfirmed = !worker.email || worker.email_confirmed !== false;
  const lockReason: AccountLockReason = !emailConfirmed
    ? 'email_not_confirmed'
    : worker.status !== 'active'
      ? 'account_inactive'
      : null;

  const sanitized = sanitizeWorker(worker);
  return {
    worker: sanitized,
    emailConfirmed,
    lockReason,
    requiresReloginAfterUnlock: payload.scope === 'locked' && lockReason === null,
    resendCooldownSeconds: getResendCooldownRemaining(
      sanitized.id,
      sanitized.email
    ),
  };
}

export async function verifySessionToken(
  token: string
): Promise<WorkerRecord | null> {
  const session = await inspectSessionToken(token);
  if (!session) return null;
  if (session.lockReason !== null || session.requiresReloginAfterUnlock) {
    return null;
  }
  return session.worker;
}

// ============================================================================
// Generic Entity CRUD Helpers (Supabase or Local Preview Store)
// ============================================================================
export async function listAllRecords(entity: EntityKey): Promise<AnyEntityRecord[]> {
  if (isSupabaseConfigured) {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from(entity)
      .select('*')
      .order('created_at', { ascending: false });
    if (error) {
      throw new Error(
        enhanceSchemaMigrationError(`Failed to load ${entity}: ${error.message}`)
      );
    }
    if (entity === 'workers') {
      return ((data || []) as StoredWorker[]).map(sanitizeWorker);
    }
    if (entity === 'customers') {
      return ((data || []) as StoredCustomer[]).map(sanitizeCustomer);
    }
    return (data || []) as AnyEntityRecord[];
  }

  if (entity === 'workers') {
    return localDb.workers.map(sanitizeWorker);
  }
  if (entity === 'customers') {
    return localDb.customers
      .map(sanitizeCustomer)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  return [...(localDb[entity] as AnyEntityRecord[])].sort((a, b) =>
    b.created_at.localeCompare(a.created_at)
  );
}

export async function getRecordById(
  entity: EntityKey,
  id: string
): Promise<AnyEntityRecord | null> {
  if (isSupabaseConfigured) {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from(entity)
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) {
      throw new Error(
        enhanceSchemaMigrationError(`Failed to fetch ${entity}: ${error.message}`)
      );
    }
    if (!data) return null;
    if (entity === 'workers') return sanitizeWorker(data as StoredWorker);
    if (entity === 'customers') return sanitizeCustomer(data as StoredCustomer);
    return data as AnyEntityRecord;
  }

  const list = localDb[entity] as AnyEntityRecord[];
  const found = list.find((r) => r.id === id);
  if (!found) return null;
  if (entity === 'workers') return sanitizeWorker(found as StoredWorker);
  if (entity === 'customers') return sanitizeCustomer(found as StoredCustomer);
  return found;
}

export async function createEntityRecord(
  entity: EntityKey,
  payload: Record<string, unknown>,
  actor: WorkerRecord,
  options?: { emailRedirectTo?: string; sharedLogId?: string }
): Promise<AnyEntityRecord> {
  if (entity === 'logs') {
    throw new Error('Audit logs are managed automatically and cannot be created manually.');
  }

  const existing = await listAllRecords(entity);
  const existingIds = existing.map((r) => r.id);
  const createdAt =
    typeof payload.created_at === 'string' && payload.created_at.trim()
      ? payload.created_at.trim()
      : new Date().toISOString();

  const explicitId =
    typeof payload.id === 'string' && payload.id.trim()
      ? payload.id.trim()
      : undefined;

  if (explicitId && existingIds.some((e) => e.toUpperCase() === explicitId.toUpperCase())) {
    throw new Error(`Record ID "${explicitId}" already exists.`);
  }

  const generatedId = generateEntityId(entity, existingIds, createdAt, explicitId);

  if (entity === 'workers') {
    const username = String(payload.username || '').trim().toLowerCase();
    const password = String(payload.password || '');
    const name = String(payload.name || '').trim();
    const role = String(payload.role || 'worker') as WorkerRole;
    const rawEmail = payload.email ? String(payload.email).trim().toLowerCase() : '';
    const email = rawEmail || null;
    const phone = payload.phone ? String(payload.phone).trim() : null;
    const status =
      payload.status === 'inactive' ? ('inactive' as const) : ('active' as const);
    const displayPictureUrl = payload.display_picture_url
      ? String(payload.display_picture_url).trim()
      : null;

    if (!name || !username || password.length < 6) {
      throw new Error(
        'Worker requires name, username, and password (min 6 characters).'
      );
    }
    if (!['master', 'marketing', 'admin', 'worker'].includes(role)) {
      throw new Error('Invalid worker role.');
    }
    if (role === 'master' && !email) {
      throw new Error('Master accounts require a valid email address.');
    }
    if (email && isInternalAuthEmail(email)) {
      throw new Error('Reserved @limbahin.internal domain cannot be used as a real email address.');
    }
    if (email && !isValidEmail(email)) {
      throw new Error('Please enter a valid email address.');
    }
    if (!isValidImageUrl(displayPictureUrl)) {
      throw new Error('Display picture URL must start with https://, http://, or /uploads/.');
    }

    // When no real email is supplied, generate an internal placeholder strictly for Supabase Auth login
    // while keeping `public.workers.email = null` so the ERP treats the worker as having no email.
    const authEmail = email ?? generateInternalAuthEmail(username);
    const workerFieldsForDiff: Record<string, unknown> = {
      name,
      username,
      role,
      status,
      email,
      phone,
      display_picture_url: displayPictureUrl,
    };

    let createdOwnLogId: string | null = null;
    let logCreateId = options?.sharedLogId || null;
    if (!logCreateId) {
      const diffs = computeFieldDiffs('workers', null, workerFieldsForDiff);
      const log = await createAuditLog(actor.id, 'workers', [
        { record_id: generatedId, action: 'create', changes: diffs },
      ]);
      logCreateId = log.id;
      createdOwnLogId = log.id;
    }

    if (isSupabaseConfigured) {
      const admin = getSupabaseAdmin();
      const anon = getSupabaseAnon();

      let authUserId: string | null = null;

      try {
        // Check duplicate username up front before touching Supabase Auth
        const { data: existingUsername } = await admin
          .from('workers')
          .select('id')
          .eq('username', username)
          .maybeSingle();
        if (existingUsername) {
          throw new Error(`Username "${username}" is already taken.`);
        }

        if (email) {
          // Real email provided -> create an UNVERIFIED Supabase Auth user via signUp
          // so email confirmation is required before unlocking the dashboard.
          const { data: existingEmail } = await admin
            .from('workers')
            .select('id')
            .eq('email', email)
            .maybeSingle();
          if (existingEmail) {
            throw new Error(`Email "${email}" is already registered.`);
          }

          const { data: createdAuth, error: authErr } = await anon.auth.signUp({
            email,
            password,
            options: {
              emailRedirectTo: options?.emailRedirectTo,
              data: { worker_id: generatedId, username, name, role, status },
            },
          });
          if (authErr || !createdAuth.user) {
            throw new Error(authErr?.message || 'Failed to create Supabase Auth account.');
          }
          authUserId = createdAuth.user.id;
        } else {
          // No real email -> store password securely in Supabase Auth via synthetic @limbahin.internal handle.
          // No password hash is stored in public.workers, and public.workers.email stays NULL.
          const { data: createdAuth, error: authErr } =
            await admin.auth.admin.createUser({
              email: authEmail,
              password,
              email_confirm: true,
              user_metadata: {
                worker_id: generatedId,
                username,
                name,
                role,
                status,
                is_internal_no_email: true,
              },
            });
          if (authErr || !createdAuth.user) {
            throw new Error(authErr?.message || 'Failed to create Supabase Auth account.');
          }
          authUserId = createdAuth.user.id;
        }

        const row = {
          id: generatedId,
          auth_user_id: authUserId,
          name,
          username,
          auth_email: authEmail,
          email,
          phone,
          role,
          status,
          display_picture_url: displayPictureUrl,
          id_log_create: logCreateId,
          id_log_update: null,
          created_by: actor.id,
          created_at: createdAt,
        };
        const { data: inserted, error: dbErr } = await admin
          .from('workers')
          .insert(row)
          .select()
          .single();
        if (dbErr) {
          if (authUserId) {
            await admin.auth.admin.deleteUser(authUserId).catch(() => {});
          }
          throw new Error(enhanceSchemaMigrationError(dbErr.message));
        }
        return sanitizeWorker(inserted as StoredWorker);
      } catch (err) {
        if (createdOwnLogId) await deleteAuditLogSafe(createdOwnLogId);
        throw err;
      }
    }

    if (localDb.workers.some((w) => w.username.toLowerCase() === username)) {
      if (createdOwnLogId) await deleteAuditLogSafe(createdOwnLogId);
      throw new Error(`Username "${username}" is already taken.`);
    }
    if (email && localDb.workers.some((w) => w.email?.toLowerCase() === email)) {
      if (createdOwnLogId) await deleteAuditLogSafe(createdOwnLogId);
      throw new Error(`Email "${email}" is already registered.`);
    }
    const newWorker: StoredWorker = {
      id: generatedId,
      name,
      username,
      auth_email: authEmail,
      email,
      phone,
      role,
      status,
      display_picture_url: displayPictureUrl,
      password_hash: hashPassword(password),
      email_confirmed: !email,
      confirm_token: email ? crypto.randomBytes(24).toString('hex') : null,
      id_log_create: logCreateId,
      id_log_update: null,
      created_by: actor.id,
      created_at: createdAt,
    };
    localDb.workers.unshift(newWorker);
    return sanitizeWorker(newWorker);
  }

  const customerRawPassword =
    entity === 'customers' &&
    typeof payload.password === 'string' &&
    payload.password.trim()
      ? payload.password.trim()
      : null;

  await normalizeEntityPayload(entity, payload, null, generatedId);

  let createdOwnLogId: string | null = null;
  let logCreateId = options?.sharedLogId || null;
  if (!logCreateId) {
    const diffSource = { ...payload };
    delete diffSource.password;
    delete diffSource.password_hash;
    const diffs = computeFieldDiffs(entity, null, diffSource);
    if (customerRawPassword) {
      diffs.password = { old: null, new: '[set]' };
    }
    const log = await createAuditLog(
      actor.id,
      entity,
      [{ record_id: generatedId, action: 'create', id_previous_logs: null, changes: diffs }],
      null
    );
    logCreateId = log.id;
    createdOwnLogId = log.id;
  }

  const record: Record<string, unknown> = {
    ...payload,
    id: generatedId,
    id_log_create: logCreateId,
    id_log_update: null,
    created_by: actor.id,
    created_at: createdAt,
  };
  delete record.password;

  if (isSupabaseConfigured) {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from(entity)
      .insert(record)
      .select()
      .single();
    if (error) {
      if (createdOwnLogId) await deleteAuditLogSafe(createdOwnLogId);
      throw new Error(
        enhanceSchemaMigrationError(`Failed to create ${entity}: ${error.message}`)
      );
    }
    return entity === 'customers'
      ? sanitizeCustomer(data as StoredCustomer)
      : (data as AnyEntityRecord);
  }

  (localDb[entity] as unknown as Record<string, unknown>[]).unshift(record);
  return entity === 'customers'
    ? sanitizeCustomer(record as unknown as StoredCustomer)
    : (record as unknown as AnyEntityRecord);
}

export async function updateEntityRecord(
  entity: EntityKey,
  id: string,
  payload: Record<string, unknown>,
  actor: WorkerRecord,
  options?: { sharedLogId?: string; emailRedirectTo?: string }
): Promise<AnyEntityRecord> {
  if (entity === 'logs') {
    throw new Error('Audit logs are immutable and cannot be edited.');
  }

  const cleanPayload: Record<string, unknown> = { ...payload };
  delete cleanPayload.id;
  delete cleanPayload.created_by;
  delete cleanPayload.created_at;
  delete cleanPayload.auth_user_id;
  delete cleanPayload.password_hash;
  delete cleanPayload.id_log_create;
  delete cleanPayload.id_log_update;

  const existingRecord = await getRecordById(entity, id);
  if (!existingRecord) {
    throw new Error(entity === 'workers' ? 'Worker not found.' : 'Record not found.');
  }

  const newPassword =
    (entity === 'workers' || entity === 'customers') &&
    typeof cleanPayload.password === 'string' &&
    cleanPayload.password.trim()
      ? cleanPayload.password.trim()
      : null;

  await normalizeEntityPayload(entity, cleanPayload, existingRecord, id);

  const previousLogId =
    existingRecord.id_log_update || existingRecord.id_log_create || null;

  const diffPayload = { ...cleanPayload };
  delete diffPayload.password;
  delete diffPayload.password_hash;

  const fieldDiffs = computeFieldDiffs(
    entity,
    existingRecord as unknown as Record<string, unknown>,
    diffPayload
  );
  if (newPassword) {
    fieldDiffs.password = { old: '[redacted]', new: '[updated]' };
  }

  let createdOwnLogId: string | null = null;
  let logUpdateId: string | null = options?.sharedLogId || null;
  if (!logUpdateId && Object.keys(fieldDiffs).length > 0) {
    const log = await createAuditLog(
      actor.id,
      entity,
      [
        {
          record_id: id,
          action: 'update',
          id_previous_logs: previousLogId,
          changes: fieldDiffs,
        },
      ],
      previousLogId
    );
    logUpdateId = log.id;
    createdOwnLogId = log.id;
  }

  if (logUpdateId) {
    cleanPayload.id_log_update = logUpdateId;
  }

  if (entity === 'workers') {
    delete cleanPayload.password;

    if (isSupabaseConfigured) {
      const admin = getSupabaseAdmin();
      const anon = getSupabaseAnon();
      const { data: existingRow } = await admin
        .from('workers')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (!existingRow) {
        if (createdOwnLogId) await deleteAuditLogSafe(createdOwnLogId);
        throw new Error('Worker not found.');
      }

      const currentEmail =
        existingRow.email && !isInternalAuthEmail(existingRow.email)
          ? String(existingRow.email).trim().toLowerCase()
          : '';
      const nextEmailRaw =
        typeof cleanPayload.email === 'string'
          ? cleanPayload.email.trim().toLowerCase()
          : cleanPayload.email === null
            ? ''
            : undefined;
      const effectiveRole = String(cleanPayload.role || existingRow.role);

      let updatedAuthEmailRollback: {
        email: string;
        emailConfirm: boolean;
      } | null = null;
      let shouldSendConfirmationEmailTo: string | null = null;

      try {
        if (nextEmailRaw !== undefined) {
          if (nextEmailRaw && isInternalAuthEmail(nextEmailRaw)) {
            throw new Error(
              'Reserved @limbahin.internal domain cannot be used as a real email address.'
            );
          }
          if (nextEmailRaw && !isValidEmail(nextEmailRaw)) {
            throw new Error('Please enter a valid email address.');
          }
          if (!nextEmailRaw && effectiveRole === 'master') {
            throw new Error('Master accounts require a valid email address.');
          }
        }

        if (newPassword && newPassword.length < 6) {
          throw new Error('Password must be at least 6 characters.');
        }

        if (existingRow.auth_user_id) {
          const authUpdates: {
            password?: string;
            email?: string;
            email_confirm?: boolean;
          } = {};

          if (newPassword) {
            authUpdates.password = newPassword;
          }

          if (nextEmailRaw !== undefined && nextEmailRaw !== currentEmail) {
            if (nextEmailRaw) {
              // Adding or changing to a real email -> require email confirmation in Supabase Auth
              const { data: existingEmail } = await admin
                .from('workers')
                .select('id')
                .eq('email', nextEmailRaw)
                .neq('id', id)
                .maybeSingle();
              if (existingEmail) {
                throw new Error(`Email "${nextEmailRaw}" is already registered.`);
              }
              authUpdates.email = nextEmailRaw;
              authUpdates.email_confirm = false;
              cleanPayload.email = nextEmailRaw;
              cleanPayload.auth_email = nextEmailRaw;
              shouldSendConfirmationEmailTo = nextEmailRaw;
              updatedAuthEmailRollback = {
                email: String(existingRow.auth_email || ''),
                emailConfirm: isInternalAuthEmail(existingRow.auth_email),
              };
            } else {
              // Clearing email on a non-master worker -> switch to synthetic internal auth handle
              const internalEmail = generateInternalAuthEmail(
                String(cleanPayload.username || existingRow.username)
              );
              authUpdates.email = internalEmail;
              authUpdates.email_confirm = true;
              cleanPayload.email = null;
              cleanPayload.auth_email = internalEmail;
              updatedAuthEmailRollback = {
                email: String(existingRow.auth_email || ''),
                emailConfirm: false,
              };
            }
          }

          if (Object.keys(authUpdates).length > 0) {
            const { error: authErr } = await admin.auth.admin.updateUserById(
              existingRow.auth_user_id,
              authUpdates
            );
            if (authErr) throw new Error(authErr.message);
          }
        }

        const { data, error } = await admin
          .from('workers')
          .update(cleanPayload)
          .eq('id', id)
          .select()
          .single();
        if (error) {
          if (updatedAuthEmailRollback && existingRow.auth_user_id && updatedAuthEmailRollback.email) {
            await admin.auth.admin
              .updateUserById(existingRow.auth_user_id, {
                email: updatedAuthEmailRollback.email,
                email_confirm: updatedAuthEmailRollback.emailConfirm,
              })
              .catch(() => {});
          }
          throw new Error(enhanceSchemaMigrationError(error.message));
        }

        if (shouldSendConfirmationEmailTo) {
          await anon.auth
            .resend({
              type: 'signup',
              email: shouldSendConfirmationEmailTo,
              options: { emailRedirectTo: options?.emailRedirectTo },
            })
            .catch(() => {});
        }

        return sanitizeWorker(data as StoredWorker);
      } catch (err) {
        if (createdOwnLogId) await deleteAuditLogSafe(createdOwnLogId);
        throw err;
      }
    }

    const idx = localDb.workers.findIndex((w) => w.id === id);
    if (idx === -1) {
      if (createdOwnLogId) await deleteAuditLogSafe(createdOwnLogId);
      throw new Error('Worker not found.');
    }
    const target = localDb.workers[idx];
    const nextEmailRaw =
      typeof cleanPayload.email === 'string'
        ? cleanPayload.email.trim().toLowerCase()
        : cleanPayload.email === null
          ? ''
          : undefined;
    const prevEmail =
      target.email && !isInternalAuthEmail(target.email)
        ? target.email.trim().toLowerCase()
        : '';
    let nextEmail = target.email;
    let nextAuthEmail = target.auth_email;
    let nextEmailConfirmed = target.email_confirmed;
    let nextConfirmToken = target.confirm_token ?? null;

    if (nextEmailRaw !== undefined && nextEmailRaw !== prevEmail) {
      if (nextEmailRaw && isInternalAuthEmail(nextEmailRaw)) {
        if (createdOwnLogId) await deleteAuditLogSafe(createdOwnLogId);
        throw new Error('Reserved @limbahin.internal domain cannot be used as a real email address.');
      }
      if (nextEmailRaw && !isValidEmail(nextEmailRaw)) {
        if (createdOwnLogId) await deleteAuditLogSafe(createdOwnLogId);
        throw new Error('Please enter a valid email address.');
      }
      if (!nextEmailRaw && (cleanPayload.role || target.role) === 'master') {
        if (createdOwnLogId) await deleteAuditLogSafe(createdOwnLogId);
        throw new Error('Master accounts require a valid email address.');
      }
      if (
        nextEmailRaw &&
        localDb.workers.some(
          (w) => w.id !== id && w.email?.toLowerCase() === nextEmailRaw
        )
      ) {
        if (createdOwnLogId) await deleteAuditLogSafe(createdOwnLogId);
        throw new Error(`Email "${nextEmailRaw}" is already registered.`);
      }
      nextEmail = nextEmailRaw || null;
      nextAuthEmail = nextEmailRaw || generateInternalAuthEmail(target.username);
      nextEmailConfirmed = !nextEmailRaw;
      nextConfirmToken = nextEmailRaw ? crypto.randomBytes(24).toString('hex') : null;
    }

    const updated: StoredWorker = {
      ...target,
      ...(cleanPayload as Partial<StoredWorker>),
      email: nextEmail,
      auth_email: nextAuthEmail,
      email_confirmed: nextEmailConfirmed,
      confirm_token: nextConfirmToken,
      password_hash: newPassword ? hashPassword(newPassword) : target.password_hash,
    };
    localDb.workers[idx] = updated;
    return sanitizeWorker(updated);
  }

  delete cleanPayload.password;

  if (isSupabaseConfigured) {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from(entity)
      .update(cleanPayload)
      .eq('id', id)
      .select()
      .single();
    if (error) {
      if (createdOwnLogId) await deleteAuditLogSafe(createdOwnLogId);
      throw new Error(
        enhanceSchemaMigrationError(`Failed to update ${entity}: ${error.message}`)
      );
    }
    return entity === 'customers'
      ? sanitizeCustomer(data as StoredCustomer)
      : (data as AnyEntityRecord);
  }

  const list = localDb[entity] as unknown as Record<string, unknown>[];
  const idx = list.findIndex((r) => r.id === id);
  if (idx === -1) {
    if (createdOwnLogId) await deleteAuditLogSafe(createdOwnLogId);
    throw new Error('Record not found.');
  }
  list[idx] = { ...list[idx], ...cleanPayload };
  return entity === 'customers'
    ? sanitizeCustomer(list[idx] as unknown as StoredCustomer)
    : (list[idx] as unknown as AnyEntityRecord);
}

export async function applyBulkCsvImport(
  entity: EntityKey,
  mode: CsvImportMode,
  rows: Array<{
    rowNumber: number;
    data: Record<string, unknown>;
    preAllocatedId?: string;
  }>,
  actor: WorkerRecord,
  options?: { emailRedirectTo?: string }
): Promise<{
  mode: CsvImportMode;
  createdCount: number;
  updatedCount: number;
  errorCount: number;
  logCreateId: string | null;
  logUpdateId: string | null;
  created: AnyEntityRecord[];
  updated: AnyEntityRecord[];
  errors: Array<{ row: number; error: string }>;
}> {
  if (entity === 'logs') {
    throw new Error('Audit logs cannot be imported via CSV.');
  }

  const existingRecords = await listAllRecords(entity);
  const existingById = new Map<string, AnyEntityRecord>(
    existingRecords.map((r) => [r.id.toUpperCase(), r])
  );

  const created: AnyEntityRecord[] = [];
  const updated: AnyEntityRecord[] = [];
  const errors: Array<{ row: number; error: string }> = [];

  const createChangeEntries: LogChangeEntry[] = [];
  const updateChangeEntries: LogChangeEntry[] = [];

  let batchCreateLogId: string | null = null;
  let batchUpdateLogId: string | null = null;

  const ensureCreateLog = async (): Promise<string> => {
    if (!batchCreateLogId) {
      const log = await createAuditLog(actor.id, entity, []);
      batchCreateLogId = log.id;
    }
    return batchCreateLogId;
  };

  const ensureUpdateLog = async (): Promise<string> => {
    if (!batchUpdateLogId) {
      const log = await createAuditLog(actor.id, entity, []);
      batchUpdateLogId = log.id;
    }
    return batchUpdateLogId;
  };

  for (const row of rows) {
    try {
      if (mode === 'insert') {
        // Insert mode ignores any user-supplied CSV id column and uses server's preAllocatedId (for ZIP file renaming sync) or auto-generates a new sequential ID
        const payload: Record<string, unknown> = { ...row.data };
        if (row.preAllocatedId) {
          payload.id = row.preAllocatedId;
        } else {
          delete payload.id;
        }

        const sharedLogId = await ensureCreateLog();
        const rec = await createEntityRecord(entity, payload, actor, {
          emailRedirectTo: options?.emailRedirectTo,
          sharedLogId,
        });
        created.push(rec);
        existingById.set(rec.id.toUpperCase(), rec);
        createChangeEntries.push({
          record_id: rec.id,
          action: 'create',
          changes: computeFieldDiffs(
            entity,
            null,
            rec as unknown as Record<string, unknown>
          ),
        });
      } else {
        // Update mode: existing ID -> update; empty ID or non-existent ID -> insert new
        const rawId =
          typeof row.data.id === 'string' ? row.data.id.trim() : '';
        const existingMatch = rawId ? existingById.get(rawId.toUpperCase()) : undefined;

        if (existingMatch) {
          if (actor.role === 'admin' && existingMatch.created_by !== actor.id) {
            throw new Error(
              `Admin users can only update records they created (${existingMatch.id}).`
            );
          }

          const diffs = computeFieldDiffs(
            entity,
            existingMatch as unknown as Record<string, unknown>,
            row.data
          );
          if (
            entity === 'workers' &&
            typeof row.data.password === 'string' &&
            row.data.password.trim()
          ) {
            diffs.password = { old: '[redacted]', new: '[updated]' };
          }

          const prevLogForRow =
            existingMatch.id_log_update || existingMatch.id_log_create || null;
          const sharedLogId = await ensureUpdateLog();
          const rec = await updateEntityRecord(
            entity,
            existingMatch.id,
            row.data,
            actor,
            { sharedLogId, emailRedirectTo: options?.emailRedirectTo }
          );
          updated.push(rec);
          existingById.set(rec.id.toUpperCase(), rec);
          updateChangeEntries.push({
            record_id: rec.id,
            action: 'update',
            id_previous_logs: prevLogForRow,
            changes: diffs,
          });
        } else {
          // Missing ID or non-existent ID -> treat as new insert
          const payload: Record<string, unknown> = { ...row.data };
          if (rawId) {
            payload.id = rawId;
          } else {
            delete payload.id;
          }

          const sharedLogId = await ensureCreateLog();
          const rec = await createEntityRecord(entity, payload, actor, {
            emailRedirectTo: options?.emailRedirectTo,
            sharedLogId,
          });
          created.push(rec);
          existingById.set(rec.id.toUpperCase(), rec);
          createChangeEntries.push({
            record_id: rec.id,
            action: 'create',
            id_previous_logs: null,
            changes: computeFieldDiffs(
              entity,
              null,
              rec as unknown as Record<string, unknown>
            ),
          });
        }
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Invalid row data';
      // Fail fast on database schema / missing column errors instead of repeating 500 identical failed inserts
      if (isSchemaMigrationErrorMessage(errMsg)) {
        if (batchCreateLogId && createChangeEntries.length === 0) {
          await deleteAuditLogSafe(batchCreateLogId);
        }
        if (batchUpdateLogId && updateChangeEntries.length === 0) {
          await deleteAuditLogSafe(batchUpdateLogId);
        }
        throw new Error(errMsg);
      }
      errors.push({
        row: row.rowNumber,
        error: errMsg,
      });
    }
  }

  // Finalize or clean up shared batch logs
  if (batchCreateLogId) {
    if (createChangeEntries.length > 0) {
      await updateAuditLogChanges(batchCreateLogId, createChangeEntries, null);
    } else {
      await deleteAuditLogSafe(batchCreateLogId);
      batchCreateLogId = null;
    }
  }

  if (batchUpdateLogId) {
    if (updateChangeEntries.length > 0) {
      const firstPrevLog =
        updateChangeEntries.find((e) => e.id_previous_logs)?.id_previous_logs ??
        null;
      await updateAuditLogChanges(batchUpdateLogId, updateChangeEntries, firstPrevLog);
    } else {
      await deleteAuditLogSafe(batchUpdateLogId);
      batchUpdateLogId = null;
    }
  }

  return {
    mode,
    createdCount: created.length,
    updatedCount: updated.length,
    errorCount: errors.length,
    logCreateId: batchCreateLogId,
    logUpdateId: batchUpdateLogId,
    created,
    updated,
    errors,
  };
}

export async function applyMasterBulkSheetSave(
  entity: EntityKey,
  payload: {
    updates: Array<{ id: string; changes: Record<string, unknown> }>;
    creates: Array<{ tempKey: string; data: Record<string, unknown> }>;
    deletes: string[];
  },
  actor: WorkerRecord,
  options?: { emailRedirectTo?: string }
): Promise<{
  createdCount: number;
  createdIds: string[];
  updatedCount: number;
  deletedCount: number;
  logCreateId: string | null;
  logUpdateId: string | null;
  errors: Array<{ rowKey: string; error: string }>;
}> {
  if (entity === 'logs') {
    throw new Error('Audit logs are immutable and cannot be edited.');
  }

  const existingRecords = await listAllRecords(entity);
  const existingById = new Map<string, AnyEntityRecord>(
    existingRecords.map((r) => [r.id.toUpperCase(), r])
  );

  let createdCount = 0;
  let updatedCount = 0;
  let deletedCount = 0;
  const errors: Array<{ rowKey: string; error: string }> = [];

  const createChangeEntries: LogChangeEntry[] = [];
  const updateChangeEntries: LogChangeEntry[] = [];
  let batchCreateLogId: string | null = null;
  let batchUpdateLogId: string | null = null;

  const ensureCreateLog = async (): Promise<string> => {
    if (!batchCreateLogId) {
      const log = await createAuditLog(actor.id, entity, []);
      batchCreateLogId = log.id;
    }
    return batchCreateLogId;
  };

  const ensureUpdateLog = async (): Promise<string> => {
    if (!batchUpdateLogId) {
      const log = await createAuditLog(actor.id, entity, []);
      batchUpdateLogId = log.id;
    }
    return batchUpdateLogId;
  };

  // 1. Apply Updates
  for (const item of payload.updates) {
    try {
      const existingMatch = existingById.get(item.id.toUpperCase());
      if (!existingMatch) {
        throw new Error(`Record ${item.id} not found.`);
      }
      const diffs = computeFieldDiffs(
        entity,
        existingMatch as unknown as Record<string, unknown>,
        item.changes
      );
      const prevLog =
        existingMatch.id_log_update || existingMatch.id_log_create || null;
      const sharedLogId = await ensureUpdateLog();
      const updated = await updateEntityRecord(
        entity,
        existingMatch.id,
        item.changes,
        actor,
        { sharedLogId, emailRedirectTo: options?.emailRedirectTo }
      );
      updatedCount += 1;
      existingById.set(updated.id.toUpperCase(), updated);
      updateChangeEntries.push({
        record_id: updated.id,
        action: 'update',
        id_previous_logs: prevLog,
        changes: diffs,
      });
    } catch (err) {
      errors.push({
        rowKey: item.id,
        error: err instanceof Error ? err.message : 'Update failed',
      });
    }
  }

  // 2. Apply Creates
  for (const item of payload.creates) {
    try {
      const cleanData: Record<string, unknown> = { ...item.data };
      delete cleanData.id;
      const sharedLogId = await ensureCreateLog();
      const rec = await createEntityRecord(entity, cleanData, actor, {
        sharedLogId,
        emailRedirectTo: options?.emailRedirectTo,
      });
      createdCount += 1;
      existingById.set(rec.id.toUpperCase(), rec);
      createChangeEntries.push({
        record_id: rec.id,
        action: 'create',
        id_previous_logs: null,
        changes: computeFieldDiffs(
          entity,
          null,
          rec as unknown as Record<string, unknown>
        ),
      });
    } catch (err) {
      errors.push({
        rowKey: item.tempKey,
        error: err instanceof Error ? err.message : 'Create failed',
      });
    }
  }

  // 3. Apply Deletes
  for (const delId of payload.deletes) {
    try {
      if (entity === 'workers' && delId === actor.id) {
        throw new Error('Cannot delete your own active account.');
      }
      await deleteEntityRecord(entity, delId);
      deletedCount += 1;
    } catch (err) {
      errors.push({
        rowKey: delId,
        error: err instanceof Error ? err.message : 'Delete failed',
      });
    }
  }

  // Finalize batch logs
  if (batchCreateLogId) {
    if (createChangeEntries.length > 0) {
      await updateAuditLogChanges(batchCreateLogId, createChangeEntries, null);
    } else {
      await deleteAuditLogSafe(batchCreateLogId);
      batchCreateLogId = null;
    }
  }
  if (batchUpdateLogId) {
    if (updateChangeEntries.length > 0) {
      const firstPrevLog =
        updateChangeEntries.find((e) => e.id_previous_logs)?.id_previous_logs ??
        null;
      await updateAuditLogChanges(batchUpdateLogId, updateChangeEntries, firstPrevLog);
    } else {
      await deleteAuditLogSafe(batchUpdateLogId);
      batchUpdateLogId = null;
    }
  }

  return {
    createdCount,
    createdIds: createChangeEntries.map((e) => e.record_id),
    updatedCount,
    deletedCount,
    logCreateId: batchCreateLogId,
    logUpdateId: batchUpdateLogId,
    errors,
  };
}

export async function deleteEntityRecord(
  entity: EntityKey,
  id: string
): Promise<void> {
  if (entity === 'logs') {
    throw new Error('Audit logs are immutable and cannot be deleted.');
  }
  if (entity === 'workers') {
    if (isSupabaseConfigured) {
      const admin = getSupabaseAdmin();
      const { data: existingRow } = await admin
        .from('workers')
        .select('auth_user_id')
        .eq('id', id)
        .maybeSingle();
      const { error } = await admin.from('workers').delete().eq('id', id);
      if (error) throw new Error(error.message);
      if (existingRow?.auth_user_id) {
        await admin.auth.admin.deleteUser(existingRow.auth_user_id);
      }
      return;
    }
    const idx = localDb.workers.findIndex((w) => w.id === id);
    if (idx === -1) throw new Error('Worker not found.');
    localDb.workers.splice(idx, 1);
    return;
  }

  if (isSupabaseConfigured) {
    const admin = getSupabaseAdmin();
    const { error } = await admin.from(entity).delete().eq('id', id);
    if (error) throw new Error(error.message);
    return;
  }

  const list = localDb[entity] as unknown as Record<string, unknown>[];
  const idx = list.findIndex((r) => r.id === id);
  if (idx === -1) throw new Error('Record not found.');
  list.splice(idx, 1);
}

export async function computeDashboardSummary(): Promise<DashboardSummary> {
  const [customers, pickups, invoices, schedules, certificates, items] =
    await Promise.all([
      listAllRecords('customers') as Promise<CustomerRecord[]>,
      listAllRecords('pickup_data') as Promise<PickupDataRecord[]>,
      listAllRecords('invoices') as Promise<InvoiceRecord[]>,
      listAllRecords('schedules') as Promise<ScheduleRecord[]>,
      listAllRecords('certificates') as Promise<CertificateRecord[]>,
      listAllRecords('items') as Promise<ItemRecord[]>,
    ]);

  const totalPickupsKg = pickups.reduce(
    (sum, p) => sum + Number(p.quantity ?? p.weight_kg ?? 0),
    0
  );
  // Operational safeguard: strictly exclude canceled invoices from unpaid receivables
  const activeInvoices = invoices.filter(
    (inv) => !inv.is_canceled && inv.status !== 'canceled'
  );
  const unpaid = activeInvoices.filter((inv) => inv.status !== 'paid');
  const paid = activeInvoices.filter((inv) => inv.status === 'paid');

  const unpaidInvoicesAmount = unpaid.reduce(
    (sum, i) => sum + Number(i.total_amount ?? i.amount ?? 0),
    0
  );
  const paidRevenueAmount = paid.reduce(
    (sum, i) => sum + Number(i.total_amount ?? i.amount ?? 0),
    0
  );

  const itemMap = new Map(items.map((i) => [i.id, i]));
  let cat1Kg = 0;
  let cat2Kg = 0;
  for (const p of pickups) {
    const itemId = p.id_item_model || p.item_id || '';
    const it = itemMap.get(itemId);
    const qty = Number(p.quantity ?? p.weight_kg ?? 0);
    if (it?.hazard_category === 'Category 1') {
      cat1Kg += qty;
    } else {
      cat2Kg += qty;
    }
  }

  const monthlyVolume = [
    { month: 'Jun', weightKg: 4120, revenueM: 48.2 },
    { month: 'Jul', weightKg: 4680, revenueM: 54.6 },
    { month: 'Aug', weightKg: 5290, revenueM: 61.8 },
    { month: 'Sep', weightKg: 4910, revenueM: 58.4 },
    { month: 'Oct', weightKg: 5840, revenueM: 69.5 },
    {
      month: 'Nov',
      weightKg: Math.max(totalPickupsKg, 6210),
      revenueM: Number(((paidRevenueAmount + unpaidInvoicesAmount) / 1_000_000).toFixed(1)),
    },
  ];

  const activeSchedules = schedules.filter(
    (s) => s.status === 'scheduled' || s.status === 'in_progress'
  );

  return {
    kpis: {
      totalClients: customers.length,
      totalPickupsKg,
      unpaidInvoicesAmount,
      unpaidInvoicesCount: unpaid.length,
      paidRevenueAmount,
      activeSchedulesCount: activeSchedules.length,
      issuedCertificatesCount: certificates.length,
    },
    monthlyVolume,
    hazardBreakdown: [
      { category: 'Category 1 (Acute B3)', weightKg: cat1Kg },
      { category: 'Category 2 (Chronic B3)', weightKg: cat2Kg },
    ],
    unpaidInvoices: unpaid.slice(0, 6),
    upcomingSchedules: activeSchedules.slice(0, 6),
  };
}

export async function updateOwnWorkerProfile(
  worker: WorkerRecord,
  input: {
    name?: string;
    phone?: string | null;
    email?: string | null;
    display_picture_url?: string | null;
  },
  emailRedirectTo: string
): Promise<{
  worker: WorkerRecord;
  emailChanged: boolean;
  requiresEmailConfirmation: boolean;
  token?: string;
  lockReason?: AccountLockReason;
  requiresReloginAfterUnlock?: boolean;
  resendCooldownSeconds?: number;
  previewConfirmToken?: string;
  message: string;
}> {
  const safePayload: Record<string, unknown> = {};

  if (input.name !== undefined) {
    const trimmedName = input.name.trim();
    if (!trimmedName) {
      throw new Error('Name cannot be empty.');
    }
    safePayload.name = trimmedName;
  }

  if (input.phone !== undefined) {
    const trimmedPhone = typeof input.phone === 'string' ? input.phone.trim() : '';
    safePayload.phone = trimmedPhone || null;
  }

  if (input.display_picture_url !== undefined) {
    const trimmedUrl =
      typeof input.display_picture_url === 'string'
        ? input.display_picture_url.trim()
        : '';
    if (trimmedUrl && !isValidImageUrl(trimmedUrl)) {
      throw new Error(
        'Display picture URL must start with https://, http://, or /uploads/.'
      );
    }
    safePayload.display_picture_url = trimmedUrl || null;
  }

  const prevEmail = (worker.email || '').trim().toLowerCase();
  let emailChangedToNewRealEmail = false;
  if (input.email !== undefined) {
    const nextEmail =
      typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
    if (nextEmail && isInternalAuthEmail(nextEmail)) {
      throw new Error(
        'Reserved @limbahin.internal domain cannot be used as a real email address.'
      );
    }
    if (nextEmail && !isValidEmail(nextEmail)) {
      throw new Error('Please enter a valid email address.');
    }
    if (!nextEmail && worker.role === 'master') {
      throw new Error('Master accounts require a valid email address.');
    }
    safePayload.email = nextEmail || null;
    emailChangedToNewRealEmail = Boolean(nextEmail && nextEmail !== prevEmail);
  }

  const updated = (await updateEntityRecord(
    'workers',
    worker.id,
    safePayload,
    worker,
    { emailRedirectTo }
  )) as WorkerRecord;

  if (emailChangedToNewRealEmail && updated.email) {
    setResendCooldown(updated.id, updated.email, RESEND_COOLDOWN_SECONDS);
    let previewConfirmToken: string | undefined;
    if (!isSupabaseConfigured) {
      const localMatch = localDb.workers.find((w) => w.id === updated.id);
      previewConfirmToken = localMatch?.confirm_token ?? undefined;
    }
    return {
      worker: updated,
      emailChanged: true,
      requiresEmailConfirmation: true,
      token: signLocalToken(updated.id, updated.role, 'locked'),
      lockReason: 'email_not_confirmed',
      requiresReloginAfterUnlock: isSupabaseConfigured,
      resendCooldownSeconds: RESEND_COOLDOWN_SECONDS,
      previewConfirmToken,
      message: `Profile updated. A confirmation email was sent to ${updated.email} — confirm your email to unlock your account.`,
    };
  }

  return {
    worker: updated,
    emailChanged: false,
    requiresEmailConfirmation: false,
    message: 'Profile updated successfully.',
  };
}

// ============================================================================
// Entity Normalization & Document Attachment Synchronization
// ============================================================================

function addDaysToIsoDate(isoDate: string, days: number): string {
  const parsed = new Date(`${isoDate.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    const fallback = new Date(Date.now() + days * 86_400_000);
    return fallback.toISOString().slice(0, 10);
  }
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function normalizeAdjustments(
  raw: unknown,
  subtotal = 0
): DocumentAdjustment[] {
  if (!Array.isArray(raw)) return [];
  const out: DocumentAdjustment[] = [];
  raw.forEach((item, idx) => {
    if (!item || typeof item !== 'object') return;
    const obj = item as Record<string, unknown>;
    const label = String(obj.label || '').trim();
    const type: 'percent' | 'fixed' =
      obj.type === 'percent' ? 'percent' : 'fixed';
    const rawVal = Number(obj.value ?? obj.amount ?? 0);
    const value = Number.isFinite(rawVal) ? rawVal : 0;
    const computedAmount =
      type === 'percent'
        ? Math.round(subtotal * (value / 100))
        : Number.isFinite(Number(obj.amount))
          ? Number(obj.amount)
          : value;
    if (!label && value === 0 && computedAmount === 0) return;
    out.push({
      id:
        typeof obj.id === 'string' && obj.id.trim()
          ? obj.id.trim()
          : `adj-${idx + 1}`,
      label: label || 'Adjustment',
      type,
      value,
      amount: Number.isFinite(computedAmount) ? computedAmount : 0,
    });
  });
  return out;
}

const VALID_DATA_TYPES_MAP = new Map<string, string>([
  ['lb3 pickup', 'LB3 Pickup'],
  ['lb3 pickup details', 'LB3 Pickup Details'],
  ['lb3 data', 'LB3 Data'],
  ['logistik', 'Logistik'],
  // Legacy compatibility
  ['pickup', 'pickup'],
  ['service', 'service'],
  ['transport', 'transport'],
  ['admin', 'admin'],
  ['other', 'other'],
]);

function isPickupEligibleType(value: string): boolean {
  const norm = value.trim().toLowerCase();
  return norm === 'lb3 pickup' || norm === 'lb3 pickup details' || norm === 'pickup';
}

async function normalizeEntityPayload(
  entity: EntityKey,
  payload: Record<string, unknown>,
  existing: AnyEntityRecord | null,
  recordId?: string
): Promise<void> {
  // Validate URL and URL-list fields
  for (const field of ENTITY_META[entity].fields) {
    if (field.type === 'url' && payload[field.key]) {
      if (!isValidImageUrl(String(payload[field.key]))) {
        throw new Error(
          `${field.label} must start with https://, http://, or /uploads/.`
        );
      }
    }
    if (field.type === 'url-list' && field.key in payload) {
      const rawList = payload[field.key];
      const urls = Array.isArray(rawList)
        ? rawList.map((u) => String(u).trim()).filter(Boolean)
        : typeof rawList === 'string' && rawList.trim()
          ? rawList
              .split(/[|;,]/)
              .map((u) => u.trim())
              .filter(Boolean)
          : [];
      for (const url of urls) {
        if (!isValidImageUrl(url)) {
          throw new Error(
            `${field.label} contains invalid URL "${url}". Must start with https://, http://, or /uploads/.`
          );
        }
      }
      payload[field.key] = urls;
    }
  }

  const isCreate = !existing;
  const todayIso = new Date().toISOString().slice(0, 10);

  if (entity === 'customers') {
    if ('name' in payload) {
      payload.name = String(payload.name || '').trim();
    }
    if ('username' in payload) {
      const uname = String(payload.username || '').trim().toLowerCase();
      payload.username = uname || null;
      if (uname) {
        const allCustomers = (await listAllRecords('customers')) as CustomerRecord[];
        const clash = allCustomers.find(
          (c) =>
            c.id !== recordId &&
            (c.username || '').trim().toLowerCase() === uname
        );
        if (clash) {
          throw new Error(`Client username "${uname}" is already taken.`);
        }
      }
    }
    if ('email' in payload) {
      const email = String(payload.email || '').trim().toLowerCase();
      if (email && !isValidEmail(email)) {
        throw new Error('Please enter a valid client email address.');
      }
      payload.email = email || null;
    }
    if ('password' in payload) {
      const rawPw = typeof payload.password === 'string' ? payload.password.trim() : '';
      delete payload.password;
      if (rawPw) {
        if (rawPw.length < 6) {
          throw new Error('Client password must be at least 6 characters.');
        }
        payload.password_hash = hashPassword(rawPw);
      } else if (isCreate) {
        throw new Error('Client password is required (min 6 characters).');
      }
    }
    if (isCreate && !payload.status) {
      payload.status = 'active';
    }
    return;
  }

  if (entity === 'branches') {
    const prev = existing as BranchRecord | null;
    if ('id_client' in payload || (isCreate && 'client_id' in payload)) {
      const cid = String(payload.id_client ?? payload.client_id ?? '').trim();
      payload.id_client = cid;
      payload.client_id = cid;
    }
    if ('branch_name' in payload || (isCreate && 'name' in payload)) {
      const bname = String(payload.branch_name ?? payload.name ?? '').trim();
      payload.branch_name = bname;
      payload.name = bname;
    }
    const effectiveClientId = String(
      payload.id_client ?? prev?.id_client ?? prev?.client_id ?? ''
    ).trim();
    const effectiveBranchName = String(
      payload.branch_name ?? prev?.branch_name ?? prev?.name ?? ''
    ).trim();

    if ('name_in_document' in payload || isCreate) {
      const suppliedDocName =
        typeof payload.name_in_document === 'string'
          ? payload.name_in_document.trim()
          : '';
      if (suppliedDocName) {
        payload.name_in_document = suppliedDocName;
      } else {
        const clientRec = effectiveClientId
          ? ((await getRecordById('customers', effectiveClientId)) as CustomerRecord | null)
          : null;
        const clientName = clientRec?.name?.trim() || '';
        payload.name_in_document =
          clientName && effectiveBranchName
            ? `${clientName} - ${effectiveBranchName}`
            : effectiveBranchName || clientName || '';
      }
    }

    const trimOrNull = (val: unknown): string | null => {
      if (val === null || val === undefined) return null;
      const s = String(val).trim();
      return s || null;
    };

    if ('npwp' in payload) payload.npwp = trimOrNull(payload.npwp);
    if ('id_alamat_address_document' in payload || (isCreate && 'address' in payload)) {
      const docAddr = trimOrNull(
        payload.id_alamat_address_document ?? payload.address
      );
      payload.id_alamat_address_document = docAddr;
      payload.address = docAddr;
    }
    if ('id_alamat_address_limbah' in payload) {
      payload.id_alamat_address_limbah = trimOrNull(payload.id_alamat_address_limbah);
    }
    if ('penanggung_jawab_utama_nama' in payload) {
      payload.penanggung_jawab_utama_nama = trimOrNull(payload.penanggung_jawab_utama_nama);
    }
    if ('penanggung_jawab_utama_jabatan' in payload) {
      payload.penanggung_jawab_utama_jabatan = trimOrNull(payload.penanggung_jawab_utama_jabatan);
    }
    if ('pic_operasional_nama' in payload || (isCreate && 'pic_name' in payload)) {
      const opsName = trimOrNull(payload.pic_operasional_nama ?? payload.pic_name);
      payload.pic_operasional_nama = opsName;
      payload.pic_name = opsName;
    }
    if ('pic_operasional_telfonwa' in payload || (isCreate && 'pic_phone' in payload)) {
      const opsPhone = trimOrNull(payload.pic_operasional_telfonwa ?? payload.pic_phone);
      payload.pic_operasional_telfonwa = opsPhone;
      payload.pic_phone = opsPhone;
    }
    if ('pic_keuangan_nama' in payload) {
      payload.pic_keuangan_nama = trimOrNull(payload.pic_keuangan_nama);
    }
    if ('pic_keuangan_telfonwa' in payload) {
      payload.pic_keuangan_telfonwa = trimOrNull(payload.pic_keuangan_telfonwa);
    }
    if (isCreate && !('city' in payload)) {
      payload.city = '';
    }
    return;
  }

  if (entity === 'requests') {
    if ('request_type' in payload) {
      payload.request_type = String(payload.request_type || 'Lainnya').trim();
    }
    if ('id_user' in payload) {
      payload.id_user = String(payload.id_user || '').trim();
    }
    if ('id_creator' in payload) {
      payload.id_creator = String(payload.id_creator || '').trim();
    }
    if ('catatan' in payload) {
      const v = String(payload.catatan || '').trim();
      payload.catatan = v || null;
    }
    if ('solution' in payload) {
      const v = String(payload.solution || '').trim();
      payload.solution = v || null;
    }
    return;
  }

  if (entity === 'items') {
    if ('item_code' in payload || (isCreate && 'code' in payload)) {
      const itemCode = String(payload.item_code ?? payload.code ?? '').trim();
      payload.item_code = itemCode;
      payload.code = itemCode;
    }
    if ('title' in payload || (isCreate && 'name' in payload)) {
      const title = String(payload.title ?? payload.name ?? '').trim();
      payload.title = title;
      payload.name = title;
    }
    if ('item_note' in payload || (isCreate && 'notes' in payload)) {
      const note =
        payload.item_note !== undefined
          ? payload.item_note
            ? String(payload.item_note).trim()
            : null
          : payload.notes
            ? String(payload.notes).trim()
            : null;
      payload.item_note = note;
      payload.notes = note;
    }
    if (isCreate && !('list_url_image' in payload)) {
      payload.list_url_image = [];
    }
    if (isCreate) {
      if (!payload.description) payload.description = '';
      if (!payload.hazard_category) payload.hazard_category = 'Category 2';
      if (!payload.unit) payload.unit = 'kg';
    }
    return;
  }

  if (entity === 'schedules') {
    if ('vehicle_number' in payload || (isCreate && 'vehicle_plate' in payload)) {
      const plate = String(
        payload.vehicle_number ?? payload.vehicle_plate ?? ''
      ).trim();
      payload.vehicle_number = plate;
      payload.vehicle_plate = plate;
    }
    if ('id_branch' in payload || (isCreate && 'branch_id' in payload)) {
      const branchId = String(payload.id_branch ?? payload.branch_id ?? '').trim();
      payload.id_branch = branchId;
      payload.branch_id = branchId;
      if (branchId && !payload.client_id) {
        const branches = (await listAllRecords('branches')) as BranchRecord[];
        const matchedBranch = branches.find((b) => b.id === branchId);
        if (matchedBranch) {
          payload.client_id = matchedBranch.id_client || matchedBranch.client_id;
        }
      }
    }
    if ('order_index' in payload || isCreate) {
      const idxNum = Number(payload.order_index ?? 1);
      payload.order_index =
        Number.isFinite(idxNum) && idxNum >= 1 ? Math.round(idxNum) : 1;
    }
    if ('schedule_note' in payload || (isCreate && 'notes' in payload)) {
      const note =
        payload.schedule_note !== undefined
          ? payload.schedule_note
            ? String(payload.schedule_note).trim()
            : null
          : payload.notes
            ? String(payload.notes).trim()
            : null;
      payload.schedule_note = note;
      payload.notes = note;
    }
    if ('schedule_reschedule_problem' in payload) {
      payload.schedule_reschedule_problem = payload.schedule_reschedule_problem
        ? String(payload.schedule_reschedule_problem).trim()
        : null;
    }
    if ('reschedule_id' in payload) {
      const resched = payload.reschedule_id
        ? String(payload.reschedule_id).trim()
        : null;
      if (resched && recordId && resched === recordId) {
        throw new Error('A schedule cannot be rescheduled to itself.');
      }
      payload.reschedule_id = resched;
    }
    if (isCreate) {
      if (!payload.scheduled_date) payload.scheduled_date = todayIso;
      if (!payload.status) payload.status = 'scheduled';
      if (!payload.driver_name) payload.driver_name = '';
    }
    return;
  }

  if (entity === 'pickup_data') {
    const prev = existing as PickupDataRecord | null;
    if ('id_user_model' in payload || (isCreate && 'client_id' in payload)) {
      const cid = String(payload.id_user_model ?? payload.client_id ?? '').trim();
      payload.id_user_model = cid;
      payload.client_id = cid;
    }
    if ('id_item_model' in payload || (isCreate && 'item_id' in payload)) {
      const iid = String(payload.id_item_model ?? payload.item_id ?? '').trim();
      payload.id_item_model = iid;
      payload.item_id = iid;
    }
    if ('quantity' in payload || (isCreate && 'weight_kg' in payload)) {
      const qty = Number(payload.quantity ?? payload.weight_kg ?? 0);
      payload.quantity = Number.isFinite(qty) ? qty : 0;
      payload.weight_kg = payload.quantity;
    }
    if ('final_item_note' in payload || (isCreate && 'notes' in payload)) {
      const note =
        payload.final_item_note !== undefined
          ? payload.final_item_note
            ? String(payload.final_item_note).trim()
            : null
          : payload.notes
            ? String(payload.notes).trim()
            : null;
      payload.final_item_note = note;
      payload.notes = note;
    }
    if ('internal_note' in payload) {
      payload.internal_note = payload.internal_note
        ? String(payload.internal_note).trim()
        : null;
    }
    if ('data' in payload) {
      payload.data = payload.data ? String(payload.data).trim() : null;
    }
    if ('reference_number' in payload) {
      payload.reference_number = payload.reference_number
        ? String(payload.reference_number).trim()
        : null;
    }
    if ('manifest_number' in payload) {
      payload.manifest_number = payload.manifest_number
        ? String(payload.manifest_number).trim()
        : null;
    }
    if ('invoice_price' in payload || isCreate) {
      const p = Number(payload.invoice_price ?? 0);
      payload.invoice_price = Number.isFinite(p) ? p : 0;
    }
    if ('fpl_price' in payload || isCreate) {
      const p = Number(payload.fpl_price ?? 0);
      payload.fpl_price = Number.isFinite(p) ? p : 0;
    }
    if (isCreate && !payload.unit) {
      payload.unit = 'Kg';
    }
    if (isCreate && !payload.pickup_date) {
      payload.pickup_date = todayIso;
    }
    if (isCreate && !payload.status) {
      payload.status = 'recorded';
    }

    const rawType = String(
      payload.data_type ?? prev?.data_type ?? 'LB3 Pickup'
    ).trim();
    const canonicalType = VALID_DATA_TYPES_MAP.get(rawType.toLowerCase());
    if (!canonicalType) {
      throw new Error(
        `Invalid data_type "${rawType}". Must be LB3 Pickup, LB3 Pickup Details, LB3 Data, or Logistik.`
      );
    }
    if ('data_type' in payload || isCreate) {
      payload.data_type = canonicalType;
    }

    for (const refCol of ['ba_id', 'inv_id', 'fpl_real_id', 'fpl_doc_id', 'po_id']) {
      if (refCol in payload) {
        payload[refCol] = payload[refCol] ? String(payload[refCol]).trim() : null;
      }
    }

    const nextBa =
      'ba_id' in payload ? payload.ba_id : prev?.ba_id ?? null;
    const nextFplReal =
      'fpl_real_id' in payload ? payload.fpl_real_id : prev?.fpl_real_id ?? null;
    const nextFplDoc =
      'fpl_doc_id' in payload ? payload.fpl_doc_id : prev?.fpl_doc_id ?? null;

    if (!isPickupEligibleType(canonicalType) && (nextBa || nextFplReal || nextFplDoc)) {
      throw new Error(
        'Only Limbah Data rows with data_type "LB3 Pickup" or "LB3 Pickup Details" can be linked to Berita Acara, FPL Real, or FPL Doc.'
      );
    }
    return;
  }

  // Document models
  if (
    entity === 'purchase_orders' ||
    entity === 'berita_acara' ||
    entity === 'invoices' ||
    entity === 'certificates' ||
    entity === 'fpl_real' ||
    entity === 'fpl_doc'
  ) {
    if ('id_user_model' in payload || (isCreate && 'client_id' in payload)) {
      const cid = String(payload.id_user_model ?? payload.client_id ?? '').trim();
      payload.id_user_model = cid;
      payload.client_id = cid;
    }

    const rawDatePeriod =
      payload.date_period ??
      payload.issue_date ??
      payload.ba_date ??
      payload.issued_date ??
      (isCreate ? todayIso : undefined);
    if (rawDatePeriod !== undefined) {
      const dp = String(rawDatePeriod || todayIso).trim().slice(0, 10);
      payload.date_period = dp;
      if (entity === 'purchase_orders' || entity === 'invoices') {
        payload.issue_date = dp;
      } else if (entity === 'berita_acara') {
        payload.ba_date = dp;
      } else if (entity === 'certificates') {
        payload.issued_date = dp;
      }
    }

    if ('note' in payload) {
      payload.note = payload.note ? String(payload.note).trim() : null;
    }

    if (entity === 'berita_acara') {
      if ('id_certificate' in payload) {
        payload.id_certificate = payload.id_certificate
          ? String(payload.id_certificate).trim()
          : null;
      }
      if (isCreate && !payload.status) payload.status = 'draft';
      return;
    }

    if (entity === 'certificates') {
      if (isCreate && !payload.status) payload.status = 'processing';
      return;
    }

    // Financial document models with subtotal + adjustments + total
    const prevDoc = existing as
      | (Partial<InvoiceRecord> & {
          subtotal_amount?: number;
          tax_amount?: number;
          adjustments?: DocumentAdjustment[];
        })
      | null;

    const hasSub = 'subtotal_amount' in payload;
    const hasTax = 'tax_amount' in payload;
    const hasTotal = 'total_amount' in payload || 'amount' in payload;

    let finalSubtotal = hasSub
      ? Number(payload.subtotal_amount || 0)
      : Number(prevDoc?.subtotal_amount ?? 0);
    if (!Number.isFinite(finalSubtotal)) finalSubtotal = 0;

    const hasAdjustments = 'adjustments' in payload;
    const normalizedAdjustments: DocumentAdjustment[] = hasAdjustments
      ? normalizeAdjustments(payload.adjustments, finalSubtotal)
      : normalizeAdjustments(prevDoc?.adjustments ?? [], finalSubtotal);
    if (hasAdjustments || isCreate) {
      payload.adjustments = normalizedAdjustments;
    }

    const adjSum = normalizedAdjustments.reduce(
      (sum: number, adj: DocumentAdjustment) => sum + Number(adj.amount || 0),
      0
    );

    let finalTax = hasAdjustments
      ? adjSum
      : hasTax
        ? Number(payload.tax_amount || 0)
        : Number(prevDoc?.tax_amount ?? adjSum);
    if (!Number.isFinite(finalTax)) finalTax = 0;

    let finalTotal = hasTotal
      ? Number(payload.total_amount ?? payload.amount ?? 0)
      : finalSubtotal + finalTax;
    if (!Number.isFinite(finalTotal)) finalTotal = 0;

    if (hasSub || hasAdjustments || hasTax) {
      finalTotal = finalSubtotal + finalTax;
    } else if (hasTotal && finalSubtotal === 0) {
      finalSubtotal = finalTotal - finalTax;
    }

    if (isCreate || hasSub || hasAdjustments || hasTax || hasTotal) {
      payload.subtotal_amount = finalSubtotal;
      if (entity === 'invoices') {
        payload.tax_amount = finalTax;
        payload.amount = finalTotal;
      }
      payload.total_amount = finalTotal;
    }

    if (entity === 'purchase_orders') {
      if (isCreate && !payload.status) payload.status = 'draft';
      if (isCreate && !payload.po_number && recordId) {
        payload.po_number = recordId;
      }
    }

    if (entity === 'invoices') {
      if (isCreate) {
        payload.invoice_number =
          typeof payload.invoice_number === 'string' &&
          payload.invoice_number.trim()
            ? payload.invoice_number.trim()
            : recordId || '';
        if (!payload.company_id) payload.company_id = 'COMP-MCC-001';
        if (!payload.due_date) {
          payload.due_date = addDaysToIsoDate(
            String(payload.date_period || todayIso),
            30
          );
        }
        if (!payload.status) payload.status = 'unpaid';
      }
      if ('id_user_comission' in payload || 'commission_user_id' in payload) {
        const rawCommUser =
          payload.id_user_comission ?? payload.commission_user_id ?? null;
        const cleanCommUser = rawCommUser ? String(rawCommUser).trim() : null;
        payload.id_user_comission = cleanCommUser;
        payload.commission_user_id = cleanCommUser;
      }
      if (
        'comission_amount' in payload ||
        'commission_amount' in payload ||
        isCreate
      ) {
        const commAmt = Number(
          payload.comission_amount ?? payload.commission_amount ?? 0
        );
        const safeAmt = Number.isFinite(commAmt) ? commAmt : 0;
        payload.comission_amount = safeAmt;
        payload.commission_amount = safeAmt;
      }
      if ('status' in payload || isCreate) {
        payload.is_canceled = payload.status === 'canceled';
      }
    }
  }
}

const DOC_PICKUP_REF_COLUMN: Record<
  Exclude<DocumentEntityKey, 'certificates'>,
  'inv_id' | 'ba_id' | 'fpl_real_id' | 'fpl_doc_id' | 'po_id'
> = {
  invoices: 'inv_id',
  berita_acara: 'ba_id',
  fpl_real: 'fpl_real_id',
  fpl_doc: 'fpl_doc_id',
  purchase_orders: 'po_id',
};

const PICKUP_ONLY_DOCS = new Set<DocumentEntityKey>([
  'berita_acara',
  'fpl_real',
  'fpl_doc',
]);

export async function getDocumentAttachments(
  entity: DocumentEntityKey,
  docId: string
): Promise<AnyEntityRecord[]> {
  if (entity === 'certificates') {
    const allBas = (await listAllRecords('berita_acara')) as BeritaAcaraRecord[];
    return allBas.filter((ba) => ba.id_certificate === docId);
  }
  const refCol = DOC_PICKUP_REF_COLUMN[entity];
  const allData = (await listAllRecords('pickup_data')) as PickupDataRecord[];
  return allData.filter((row) => row[refCol] === docId);
}

export async function syncDocumentAttachments(
  entity: DocumentEntityKey,
  docId: string,
  attachedIds: string[],
  actor: WorkerRecord
): Promise<{ attachments: AnyEntityRecord[]; subtotal: number }> {
  const uniqueIds = Array.from(
    new Set(attachedIds.map((id) => String(id).trim()).filter(Boolean))
  );
  const desiredSet = new Set(uniqueIds);

  if (entity === 'certificates') {
    const allBas = (await listAllRecords('berita_acara')) as BeritaAcaraRecord[];
    const baById = new Map(allBas.map((b) => [b.id, b]));

    for (const baId of uniqueIds) {
      const ba = baById.get(baId);
      if (!ba) {
        throw new Error(`Berita Acara "${baId}" was not found.`);
      }
      if (ba.id_certificate && ba.id_certificate !== docId) {
        throw new Error(
          `Berita Acara "${baId}" is already attached to Certificate "${ba.id_certificate}". Each BA can only belong to one certificate.`
        );
      }
    }

    const toDetach = allBas.filter(
      (b) => b.id_certificate === docId && !desiredSet.has(b.id)
    );
    const toAttach = uniqueIds
      .map((id) => baById.get(id)!)
      .filter((b) => b.id_certificate !== docId);

    const changedRows = [
      ...toDetach.map((row) => ({ row, nextCert: null as string | null })),
      ...toAttach.map((row) => ({ row, nextCert: docId as string | null })),
    ];

    if (changedRows.length > 0) {
      const changeEntries: LogChangeEntry[] = changedRows.map(
        ({ row, nextCert }) => ({
          record_id: row.id,
          action: 'update',
          id_previous_logs: row.id_log_update || row.id_log_create || null,
          changes: {
            id_certificate: {
              old: row.id_certificate ?? null,
              new: nextCert,
            },
          },
        })
      );
      const firstPrev =
        changeEntries.find((e) => e.id_previous_logs)?.id_previous_logs ?? null;
      const log = await createAuditLog(
        actor.id,
        'berita_acara',
        changeEntries,
        firstPrev
      );

      for (const { row, nextCert } of changedRows) {
        if (isSupabaseConfigured) {
          const admin = getSupabaseAdmin();
          const { error } = await admin
            .from('berita_acara')
            .update({ id_certificate: nextCert, id_log_update: log.id })
            .eq('id', row.id);
          if (error) {
            throw new Error(
              enhanceSchemaMigrationError(
                `Failed updating BA "${row.id}": ${error.message}`
              )
            );
          }
        } else {
          const idx = localDb.berita_acara.findIndex((b) => b.id === row.id);
          if (idx !== -1) {
            localDb.berita_acara[idx] = {
              ...localDb.berita_acara[idx],
              id_certificate: nextCert,
              id_log_update: log.id,
            };
          }
        }
      }
    }

    const updatedBas = await getDocumentAttachments('certificates', docId);
    return { attachments: updatedBas, subtotal: 0 };
  }

  // Limbah Data attachments for invoices, berita_acara, fpl_real, fpl_doc, purchase_orders
  const refCol = DOC_PICKUP_REF_COLUMN[entity];
  const allData = (await listAllRecords('pickup_data')) as PickupDataRecord[];
  const dataById = new Map(allData.map((r) => [r.id, r]));

  for (const dataId of uniqueIds) {
    const row = dataById.get(dataId);
    if (!row) {
      throw new Error(`Limbah Data "${dataId}" was not found.`);
    }
    if (PICKUP_ONLY_DOCS.has(entity) && (row.data_type || 'pickup') !== 'pickup') {
      throw new Error(
        `Limbah Data "${dataId}" has type "${row.data_type}". Only "pickup" rows can be attached to ${ENTITY_META[entity].singular}.`
      );
    }
    const currentOwner = row[refCol];
    if (currentOwner && currentOwner !== docId) {
      throw new Error(
        `Limbah Data "${dataId}" is already attached to "${currentOwner}". Each Limbah Data row can only be attached to one ${ENTITY_META[entity].singular}.`
      );
    }
  }

  const toDetach = allData.filter(
    (r) => r[refCol] === docId && !desiredSet.has(r.id)
  );
  const toAttach = uniqueIds
    .map((id) => dataById.get(id)!)
    .filter((r) => r[refCol] !== docId);

  const changedRows = [
    ...toDetach.map((row) => ({ row, nextRef: null as string | null })),
    ...toAttach.map((row) => ({ row, nextRef: docId as string | null })),
  ];

  if (changedRows.length > 0) {
    const changeEntries: LogChangeEntry[] = changedRows.map(
      ({ row, nextRef }) => ({
        record_id: row.id,
        action: 'update',
        id_previous_logs: row.id_log_update || row.id_log_create || null,
        changes: {
          [refCol]: {
            old: row[refCol] ?? null,
            new: nextRef,
          },
        },
      })
    );
    const firstPrev =
      changeEntries.find((e) => e.id_previous_logs)?.id_previous_logs ?? null;
    const log = await createAuditLog(
      actor.id,
      'pickup_data',
      changeEntries,
      firstPrev
    );

    for (const { row, nextRef } of changedRows) {
      if (isSupabaseConfigured) {
        const admin = getSupabaseAdmin();
        const { error } = await admin
          .from('pickup_data')
          .update({ [refCol]: nextRef, id_log_update: log.id })
          .eq('id', row.id);
        if (error) {
          throw new Error(
            enhanceSchemaMigrationError(
              `Failed updating Limbah Data "${row.id}": ${error.message}`
            )
          );
        }
      } else {
        const idx = localDb.pickup_data.findIndex((p) => p.id === row.id);
        if (idx !== -1) {
          localDb.pickup_data[idx] = {
            ...localDb.pickup_data[idx],
            [refCol]: nextRef,
            id_log_update: log.id,
          };
        }
      }
    }
  }

  const attachedRows = (await getDocumentAttachments(
    entity,
    docId
  )) as PickupDataRecord[];
  const useFplPrice = entity === 'fpl_real' || entity === 'fpl_doc';
  const subtotal = attachedRows.reduce((sum, row) => {
    const qty = Number(row.quantity ?? row.weight_kg ?? 0);
    const unitPrice = useFplPrice
      ? Number(row.fpl_price ?? 0)
      : Number(row.invoice_price ?? 0);
    return sum + qty * unitPrice;
  }, 0);

  return { attachments: attachedRows, subtotal };
}


