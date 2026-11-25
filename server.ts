import 'dotenv/config';
import express, { type NextFunction, type Request, type Response } from 'express';
import JSZip from 'jszip';
import multer from 'multer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';
import {
  AuthError,
  applyBulkCsvImport,
  applyMasterBulkSheetSave,
  changeUnverifiedEmail,
  completePasswordReset,
  computeDashboardSummary,
  confirmEmailCallback,
  createEntityRecord,
  deleteEntityRecord,
  encryptRememberPayload,
  getAuthStatus,
  getDocumentAttachments,
  getRecordById,
  inspectSessionToken,
  listAllRecords,
  loginWithUsername,
  requestPasswordReset,
  resendConfirmationEmail,
  restoreRememberedSession,
  signUpOfficeWorker,
  syncDocumentAttachments,
  updateEntityRecord,
  updateOwnWorkerProfile,
  uploadAssetFile,
} from './server/store.ts';
import {
  cancelInvoiceWithLedger,
  createChartOfAccount,
  createCompany,
  createManualTransactionRecord,
  deleteChartOfAccount,
  deleteTransactionRecord,
  generateFinancialStatements,
  listChartOfAccounts,
  listCompanies,
  listTransactionRecords,
  listUnpaidActiveInvoices,
  postInvoiceToLedger,
  processLedgerCsvImport,
  updateChartOfAccount,
  updateManualTransactionRecord,
  type SingleCsvStagedRow,
} from './server/accountingStore.ts';
import {
  ENTITY_META,
  canMutateEntity,
  getCsvColumnHeader,
  getEntityUrlFields,
  isDocumentEntity,
} from './src/shared/entityMeta.ts';
import {
  extractCsvDelimiterAndLinesShared,
  normalizeCsvHeaderShared,
  resolveRowAttachments,
  sanitizeZipEntries,
  type SanitizedZipEntry,
} from './src/shared/csvZipMatcher.ts';
import { generateEntityId } from './src/shared/idGenerator.ts';
import type {
  AnyEntityRecord,
  BranchRecord,
  CommissionRecord,
  CsvImportMode,
  CustomerRecord,
  DocumentEntityKey,
  EntityKey,
  InvoiceRecord,
  ScheduleRecord,
  WorkerRecord,
} from './src/shared/types.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ALLOWED_ENTITIES = new Set<EntityKey>(
  Object.keys(ENTITY_META) as EntityKey[]
);

interface AuthedRequest extends Request {
  worker?: WorkerRecord;
}

function parseEntityParam(raw: string): EntityKey | null {
  return ALLOWED_ENTITIES.has(raw as EntityKey) ? (raw as EntityKey) : null;
}

function formatCsvTimestamp(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const yy = String(date.getFullYear()).slice(-2);
  const mm = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const hh = pad(date.getHours());
  const mi = pad(date.getMinutes());
  const ss = pad(date.getSeconds());
  return `${yy}${mm}${dd}-${hh}${mi}${ss}`;
}

function parseCsvLine(line: string, delimiter = ','): string[] {
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

function extractCsvDelimiterAndLines(rawText: string): {
  delimiter: string;
  lines: string[];
  rowOffset: number;
} {
  const { delimiter, lines, rowOffset } = extractCsvDelimiterAndLinesShared(rawText);
  return { delimiter, lines, rowOffset };
}

function coerceFieldValue(
  entity: EntityKey,
  key: string,
  rawValue: unknown
): unknown {
  const fieldDef = ENTITY_META[entity].fields.find((f) => f.key === key);
  if (!fieldDef) return rawValue;

  if (rawValue === undefined || rawValue === null || rawValue === '') {
    if (fieldDef.type === 'ref-list' || fieldDef.type === 'url-list') return [];
    if (fieldDef.type === 'number' || fieldDef.type === 'currency') return 0;
    return fieldDef.optional ? null : '';
  }

  if (fieldDef.type === 'number' || fieldDef.type === 'currency') {
    const num = Number(String(rawValue).replace(/,/g, ''));
    return Number.isFinite(num) ? num : 0;
  }

  if (fieldDef.type === 'ref-list' || fieldDef.type === 'url-list') {
    if (Array.isArray(rawValue)) {
      return rawValue.map((v) => String(v).trim()).filter(Boolean);
    }
    return String(rawValue)
      .split(/[;|,]/)
      .map((v) => v.trim())
      .filter(Boolean);
  }

  return String(rawValue).trim();
}

const REMEMBER_COOKIE_NAME = 'limbahin_remember';
const REMEMBER_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

function parseCookies(cookieHeader?: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) {
      try {
        out[key] = decodeURIComponent(val);
      } catch {
        out[key] = val;
      }
    }
  }
  return out;
}

function isHttpsRequest(req: Request): boolean {
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  return req.secure || forwardedProto === 'https';
}

function setRememberCookie(req: Request, res: Response, encryptedVal: string): void {
  const encoded = encodeURIComponent(encryptedVal);
  const attrs = isHttpsRequest(req)
    ? `HttpOnly; Path=/; Max-Age=${REMEMBER_MAX_AGE_SECONDS}; SameSite=None; Secure; Partitioned`
    : `HttpOnly; Path=/; Max-Age=${REMEMBER_MAX_AGE_SECONDS}; SameSite=Lax`;
  res.setHeader('Set-Cookie', `${REMEMBER_COOKIE_NAME}=${encoded}; ${attrs}`);
}

function clearRememberCookie(req: Request, res: Response): void {
  const attrs = isHttpsRequest(req)
    ? 'HttpOnly; Path=/; Max-Age=0; SameSite=None; Secure; Partitioned'
    : 'HttpOnly; Path=/; Max-Age=0; SameSite=Lax';
  res.setHeader('Set-Cookie', `${REMEMBER_COOKIE_NAME}=; ${attrs}`);
}

function isTrustedClientRequest(req: Request): boolean {
  if (req.headers['x-requested-with'] === 'LimbahinClient') {
    return true;
  }
  const origin = typeof req.headers.origin === 'string' ? req.headers.origin.trim() : '';
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '')
    .split(',')[0]
    .trim();
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = Array.isArray(value) ? value.join('|') : String(value);
  if (/[",;\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

const csvUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50 MB max per uploaded file
    fieldSize: 25 * 1024 * 1024, // 25 MB max per text field (large CSV payloads)
    files: 2,
  },
});

const singleAssetUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10 MB max per uploaded asset
    files: 1,
  },
});

function parseSingleAssetUploadMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  singleAssetUpload.single('file')(req, res, (err: unknown) => {
    if (err) {
      const msg =
        err instanceof multer.MulterError
          ? err.code === 'LIMIT_FILE_SIZE'
            ? 'Uploaded file exceeds the 10 MB maximum size.'
            : err.message
          : err instanceof Error
            ? err.message
            : 'Invalid file upload.';
      res.status(400).json({ error: msg });
      return;
    }
    next();
  });
}

function parseCsvUploadMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!req.is('multipart/form-data')) {
    next();
    return;
  }
  csvUpload.fields([
    { name: 'csvFile', maxCount: 1 },
    { name: 'zipFile', maxCount: 1 },
  ])(req, res, (err: unknown) => {
    if (err) {
      const msg =
        err instanceof multer.MulterError
          ? err.code === 'LIMIT_FILE_SIZE'
            ? 'Uploaded file exceeds the 20 MB maximum size.'
            : err.message
          : err instanceof Error
            ? err.message
            : 'Invalid file upload.';
      res.status(400).json({ error: msg });
      return;
    }
    next();
  });
}

interface ZipEntryItem {
  fullName: string;
  baseLower: string;
  entry: JSZip.JSZipObject;
}

interface ZipEntryIndex {
  byPath: Map<string, ZipEntryItem>;
  byBase: Map<string, ZipEntryItem>;
  allEntries: ZipEntryItem[];
}

function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

async function buildZipEntryIndex(zipBuffer: Buffer): Promise<ZipEntryIndex> {
  const zip = await JSZip.loadAsync(zipBuffer);
  const byPath = new Map<string, ZipEntryItem>();
  const byBase = new Map<string, ZipEntryItem>();
  const allEntries: ZipEntryItem[] = [];

  for (const [rawName, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    const normalized = rawName.replace(/\\/g, '/').replace(/^\/+/, '');
    if (
      !normalized ||
      normalized.startsWith('__MACOSX/') ||
      normalized.includes('/__MACOSX/') ||
      normalized.split('/').some((seg) => seg === '..' || seg.startsWith('._'))
    ) {
      continue;
    }
    const lowerFull = normalized.toLowerCase();
    const baseLower = path.posix.basename(normalized).toLowerCase();
    const item: ZipEntryItem = { fullName: normalized, baseLower, entry };
    byPath.set(lowerFull, item);
    if (!byBase.has(baseLower)) {
      byBase.set(baseLower, item);
    }
    allEntries.push(item);
  }

  allEntries.sort((a, b) => naturalCompare(a.fullName, b.fullName));
  return { byPath, byBase, allEntries };
}

function sanitizeEntityInput(
  entity: EntityKey,
  body: Record<string, unknown>,
  isCreate: boolean,
  preserveId = false
): Record<string, unknown> {
  const allowedKeys = new Set(ENTITY_META[entity].fields.map((f) => f.key));
  const out: Record<string, unknown> = {};

  if ((isCreate || preserveId) && typeof body.id === 'string' && body.id.trim()) {
    out.id = body.id.trim();
  }
  if (isCreate && typeof body.created_at === 'string' && body.created_at.trim()) {
    out.created_at = body.created_at.trim();
  }

  for (const key of allowedKeys) {
    if (key in body) {
      out[key] = coerceFieldValue(entity, key, body[key]);
    }
  }

  // Document adjustments JSON array passthrough
  if (
    (entity === 'invoices' ||
      entity === 'fpl_real' ||
      entity === 'fpl_doc' ||
      entity === 'purchase_orders') &&
    'adjustments' in body &&
    Array.isArray(body.adjustments)
  ) {
    out.adjustments = body.adjustments;
  }

  return out;
}

async function requireAuth(
  req: AuthedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }
  const token = authHeader.slice('Bearer '.length).trim();
  const session = await inspectSessionToken(token);
  if (!session) {
    res.status(401).json({ error: 'Session expired or invalid.' });
    return;
  }
  if (session.lockReason === 'email_not_confirmed') {
    res.status(403).json({
      error: 'Account locked until email address is confirmed.',
      code: 'EMAIL_NOT_CONFIRMED',
    });
    return;
  }
  if (session.lockReason === 'account_inactive') {
    res.status(403).json({
      error: 'Account locked until status is set to active.',
      code: 'ACCOUNT_INACTIVE',
    });
    return;
  }
  if (session.requiresReloginAfterUnlock) {
    res.status(401).json({
      error: 'Your account is now verified and active. Please confirm your password to unlock your session.',
      code: 'RELOGIN_REQUIRED',
    });
    return;
  }
  req.worker = session.worker;
  next();
}

async function filterRecordsForRole(
  entity: EntityKey,
  records: AnyEntityRecord[],
  worker: WorkerRecord,
  isReferenceLookup: boolean
): Promise<AnyEntityRecord[]> {
  if (worker.role === 'master') {
    return records;
  }

  if (entity === 'logs') {
    return [];
  }

  if (worker.role === 'admin') {
    if (entity === 'commissions') return [];
    // Reference lookups allow reading master catalog/clients so admin can link records they create;
    // primary list view strictly shows records created by this admin.
    if (
      isReferenceLookup &&
      (entity === 'customers' ||
        entity === 'branches' ||
        entity === 'items' ||
        entity === 'workers' ||
        entity === 'schedules' ||
        entity === 'pickup_data' ||
        entity === 'purchase_orders' ||
        entity === 'berita_acara' ||
        entity === 'invoices' ||
        entity === 'certificates' ||
        entity === 'fpl_real' ||
        entity === 'fpl_doc')
    ) {
      return records;
    }
    if (entity === 'requests') {
      return records;
    }
    return records.filter((r) => r.created_by === worker.id);
  }

  if (worker.role === 'marketing') {
    const allClients = (await listAllRecords('customers')) as CustomerRecord[];
    const myClientIds = new Set(
      allClients.filter((c) => c.marketing_id === worker.id).map((c) => c.id)
    );

    if (entity === 'commissions') {
      return (records as CommissionRecord[]).filter(
        (c) => c.marketing_id === worker.id
      );
    }
    if (entity === 'schedules') {
      const allBranches = (await listAllRecords('branches')) as BranchRecord[];
      const branchClientMap = new Map(
        allBranches.map((b) => [b.id, b.id_client || b.client_id || ''])
      );
      return (records as ScheduleRecord[]).filter((s) => {
        const cid = s.client_id || branchClientMap.get(s.id_branch || s.branch_id || '');
        return Boolean(cid && myClientIds.has(cid));
      });
    }
    if (entity === 'invoices') {
      return (records as InvoiceRecord[]).filter(
        (inv) =>
          myClientIds.has(inv.id_user_model || inv.client_id || '') &&
          !inv.is_canceled &&
          inv.status !== 'canceled' &&
          inv.status !== 'paid'
      );
    }
    if (entity === 'customers') {
      return (records as CustomerRecord[]).filter((c) => myClientIds.has(c.id));
    }
    if (entity === 'branches') {
      return records.filter((b) => {
        const br = b as BranchRecord;
        return myClientIds.has(br.id_client || br.client_id || '');
      });
    }
    if (entity === 'requests') {
      return records;
    }
    if (isReferenceLookup && (entity === 'items' || entity === 'workers')) {
      return records;
    }
    return [];
  }

  if (worker.role === 'worker') {
    if (entity === 'pickup_data' || entity === 'requests') {
      return records;
    }
    if (
      isReferenceLookup &&
      (entity === 'schedules' ||
        entity === 'customers' ||
        entity === 'branches' ||
        entity === 'items' ||
        entity === 'workers')
    ) {
      return records;
    }
    return [];
  }

  return [];
}

function getSafeEmailRedirectUrl(
  req: Request,
  pathSuffix = '/auth/confirm'
): string {
  const safePath = pathSuffix.startsWith('/') ? pathSuffix : `/${pathSuffix}`;
  const forwardedProto = String(
    req.headers['x-forwarded-proto'] || req.protocol || 'https'
  )
    .split(',')[0]
    .trim();
  const proto = forwardedProto === 'http' ? 'http' : 'https';
  const rawHost = String(
    req.headers['x-forwarded-host'] || req.headers.host || ''
  )
    .split(',')[0]
    .trim();
  const isLocalHost =
    !rawHost ||
    rawHost.startsWith('localhost') ||
    rawHost.startsWith('127.0.0.1') ||
    rawHost.startsWith('0.0.0.0');

  // If accessed through a real public domain (including custom domains like mediacahayacerah.com)
  // and Origin matches when present, use that domain so confirmation/reset returns to the exact host.
  if (!isLocalHost && /^[a-zA-Z0-9.-]+(:\d+)?$/.test(rawHost)) {
    const originHeader =
      typeof req.headers.origin === 'string' ? req.headers.origin.trim() : '';
    if (!originHeader || originHeader.endsWith(`://${rawHost}`)) {
      return `${proto}://${rawHost}${safePath}`;
    }
  }

  const envUrl = process.env.APP_URL?.trim();
  if (envUrl && /^https?:\/\//i.test(envUrl)) {
    return `${envUrl.replace(/\/+$/, '')}${safePath}`;
  }

  const safeHost = /^[a-zA-Z0-9.-]+(:\d+)?$/.test(rawHost)
    ? rawHost
    : 'localhost:3000';
  return `${proto}://${safeHost}${safePath}`;
}

async function createServer() {
  const app = express();
  app.use(express.json({ limit: '5mb' }));

  // Serve locally uploaded files (preview fallback when Supabase Storage isn't configured)
  const localUploadsDir = path.resolve(__dirname, 'public/uploads');
  app.use(
    '/uploads',
    (_req, res, next) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      next();
    },
    express.static(localUploadsDir)
  );

  // ==========================================================================
  // Public Auth Routes
  // ==========================================================================
  app.get('/api/auth/status', async (_req, res) => {
    try {
      const status = await getAuthStatus();
      res.json(status);
    } catch (err) {
      console.error('Auth status error:', err);
      res.status(500).json({ error: 'Unable to check authentication status.' });
    }
  });

  app.post('/api/auth/signup', async (req, res) => {
    try {
      const { id, name, username, email, password, phone } = req.body || {};
      if (
        typeof name !== 'string' ||
        typeof username !== 'string' ||
        typeof email !== 'string' ||
        typeof password !== 'string' ||
        !name.trim() ||
        !username.trim() ||
        !email.trim() ||
        password.length < 6
      ) {
        res.status(400).json({
          error:
            'Name, username, valid email, and password (min 6 characters) are required.',
        });
        return;
      }

      const result = await signUpOfficeWorker({
        id: typeof id === 'string' ? id : undefined,
        name,
        username,
        email,
        password,
        phone: typeof phone === 'string' ? phone : null,
        emailRedirectTo: getSafeEmailRedirectUrl(req),
      });
      res.status(201).json(result);
    } catch (err) {
      if (err instanceof AuthError) {
        res.status(err.status).json({
          error: err.message,
          code: err.code,
          email: err.email,
        });
        return;
      }
      const message = err instanceof Error ? err.message : 'Sign up failed.';
      res.status(400).json({ error: message });
    }
  });

  app.post('/api/auth/resend-confirmation', async (req, res) => {
    try {
      let sessionWorkerId: string | undefined;
      let sessionEmail: string | undefined;

      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.slice('Bearer '.length).trim();
        const session = await inspectSessionToken(token);
        if (session) {
          sessionWorkerId = session.worker.id;
          sessionEmail = session.worker.email ?? undefined;
        }
      }

      const bodyEmail =
        typeof req.body?.email === 'string' ? req.body.email.trim() : '';
      const targetEmail = sessionEmail || bodyEmail;

      if (!targetEmail) {
        res.status(400).json({ error: 'Email address is required.' });
        return;
      }

      const result = await resendConfirmationEmail(
        targetEmail,
        getSafeEmailRedirectUrl(req),
        sessionWorkerId
      );
      res.json(result);
    } catch (err) {
      if (err instanceof AuthError) {
        res.status(err.status).json({
          error: err.message,
          code: err.code,
          retryAfterSeconds: err.retryAfterSeconds,
        });
        return;
      }
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Unable to resend email.',
      });
    }
  });

  app.post('/api/auth/change-email', async (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(401).json({ error: 'Authentication required.' });
        return;
      }
      const token = authHeader.slice('Bearer '.length).trim();
      const session = await inspectSessionToken(token);
      if (!session) {
        res.status(401).json({ error: 'Session expired or invalid.' });
        return;
      }
      if (session.lockReason !== 'email_not_confirmed') {
        res.status(400).json({
          error: 'Email can only be changed here while email confirmation is pending.',
        });
        return;
      }

      const newEmail =
        typeof req.body?.email === 'string' ? req.body.email.trim() : '';
      if (!newEmail) {
        res.status(400).json({ error: 'New email address is required.' });
        return;
      }

      const result = await changeUnverifiedEmail(
        session.worker.id,
        newEmail,
        getSafeEmailRedirectUrl(req)
      );
      res.json(result);
    } catch (err) {
      if (err instanceof AuthError) {
        res.status(err.status).json({
          error: err.message,
          code: err.code,
          retryAfterSeconds: err.retryAfterSeconds,
        });
        return;
      }
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Unable to update email address.',
      });
    }
  });

  app.post('/api/auth/forgot-password', async (req, res) => {
    try {
      const identifier =
        typeof req.body?.identifier === 'string'
          ? req.body.identifier.trim()
          : '';
      if (!identifier) {
        res.status(400).json({ error: 'Username or email address is required.' });
        return;
      }
      const result = await requestPasswordReset(
        identifier,
        getSafeEmailRedirectUrl(req, '/auth/reset-password')
      );
      res.json(result);
    } catch (err) {
      if (err instanceof AuthError) {
        res.status(err.status).json({
          error: err.message,
          code: err.code,
          retryAfterSeconds: err.retryAfterSeconds,
        });
        return;
      }
      res.status(400).json({
        error:
          err instanceof Error
            ? err.message
            : 'Unable to send password reset email.',
      });
    }
  });

  app.post('/api/auth/reset-password', async (req, res) => {
    try {
      const { code, tokenHash, accessToken, previewToken, newPassword } =
        req.body || {};
      if (typeof newPassword !== 'string' || newPassword.length < 6) {
        res.status(400).json({
          error: 'New password must be at least 6 characters.',
        });
        return;
      }
      const result = await completePasswordReset({
        code: typeof code === 'string' ? code : undefined,
        tokenHash: typeof tokenHash === 'string' ? tokenHash : undefined,
        accessToken: typeof accessToken === 'string' ? accessToken : undefined,
        previewToken:
          typeof previewToken === 'string' ? previewToken : undefined,
        newPassword,
      });
      res.json(result);
    } catch (err) {
      if (err instanceof AuthError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      res.status(400).json({
        error:
          err instanceof Error
            ? err.message
            : 'Unable to update password. Request a new reset link.',
      });
    }
  });

  app.post('/api/auth/confirm', async (req, res) => {
    try {
      const { code, tokenHash, type, accessToken, previewToken } = req.body || {};
      const result = await confirmEmailCallback({
        code: typeof code === 'string' ? code : undefined,
        tokenHash: typeof tokenHash === 'string' ? tokenHash : undefined,
        type: typeof type === 'string' ? type : undefined,
        accessToken: typeof accessToken === 'string' ? accessToken : undefined,
        previewToken: typeof previewToken === 'string' ? previewToken : undefined,
      });
      res.json(result);
    } catch (err) {
      if (err instanceof AuthError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      res.status(400).json({
        error:
          err instanceof Error
            ? err.message
            : 'Email confirmation link is invalid or expired.',
      });
    }
  });

  app.post('/api/auth/login', async (req, res) => {
    try {
      const { username, password, rememberMe } = req.body || {};
      if (
        typeof username !== 'string' ||
        typeof password !== 'string' ||
        !username.trim() ||
        !password
      ) {
        res.status(400).json({ error: 'Username or email and password are required.' });
        return;
      }
      const { refreshToken, ...publicSession } = await loginWithUsername(
        username,
        password
      );
      if (rememberMe === true) {
        const encrypted = encryptRememberPayload({
          token: publicSession.token,
          refreshToken: refreshToken ?? null,
          workerId: publicSession.worker.id,
          role: publicSession.worker.role,
          exp: Date.now() + REMEMBER_MAX_AGE_SECONDS * 1000,
        });
        setRememberCookie(req, res, encrypted);
      } else {
        clearRememberCookie(req, res);
      }
      res.json(publicSession);
    } catch (err) {
      if (err instanceof AuthError) {
        res.status(err.status).json({
          error: err.message,
          code: err.code,
          email: err.email,
          workerId: err.workerId,
          role: err.role,
        });
        return;
      }
      const message =
        err instanceof Error ? err.message : 'Invalid username/email or password.';
      res.status(401).json({ error: message });
    }
  });

  app.get('/api/auth/restore', async (req, res) => {
    try {
      const cookies = parseCookies(req.headers.cookie);
      const rawCookie = cookies[REMEMBER_COOKIE_NAME];
      if (!rawCookie) {
        res.json({ authenticated: false });
        return;
      }
      const restored = await restoreRememberedSession(rawCookie);
      if (!restored) {
        clearRememberCookie(req, res);
        res.json({ authenticated: false });
        return;
      }
      if (restored.refreshedCookie) {
        setRememberCookie(req, res, restored.refreshedCookie);
      }
      res.json({
        authenticated: true,
        token: restored.token,
        worker: restored.worker,
        emailConfirmed: restored.emailConfirmed,
        lockReason: restored.lockReason,
        requiresReloginAfterUnlock: restored.requiresReloginAfterUnlock,
        resendCooldownSeconds: restored.resendCooldownSeconds,
      });
    } catch {
      clearRememberCookie(req, res);
      res.json({ authenticated: false });
    }
  });

  app.post('/api/auth/logout', (req, res) => {
    if (!isTrustedClientRequest(req)) {
      res.status(403).json({ error: 'Invalid logout request origin.' });
      return;
    }
    clearRememberCookie(req, res);
    res.json({ signedOut: true });
  });

  // ==========================================================================
  // Authenticated ERP Routes
  // ==========================================================================
  app.get('/api/auth/me', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    const token = authHeader.slice('Bearer '.length).trim();
    const session = await inspectSessionToken(token);
    if (!session) {
      res.status(401).json({ error: 'Session expired or invalid.' });
      return;
    }
    res.json(session);
  });

  app.post(
    '/api/auth/profile/upload',
    requireAuth,
    parseSingleAssetUploadMiddleware,
    async (req: AuthedRequest, res) => {
      const uploadedFile = req.file;
      if (!uploadedFile) {
        res.status(400).json({ error: 'Please select an image file to upload.' });
        return;
      }
      try {
        const url = await uploadAssetFile(
          'workers',
          uploadedFile.originalname,
          uploadedFile.buffer
        );
        res.status(201).json({
          url,
          fileName: uploadedFile.originalname,
        });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to upload profile image.';
        res.status(400).json({ error: message });
      }
    }
  );

  app.put('/api/auth/profile', requireAuth, async (req: AuthedRequest, res) => {
    try {
      const worker = req.worker!;
      const body = (req.body || {}) as Record<string, unknown>;
      const result = await updateOwnWorkerProfile(
        worker,
        {
          name: typeof body.name === 'string' ? body.name : undefined,
          phone:
            typeof body.phone === 'string'
              ? body.phone
              : body.phone === null
                ? null
                : undefined,
          email:
            typeof body.email === 'string'
              ? body.email
              : body.email === null
                ? null
                : undefined,
          display_picture_url:
            typeof body.display_picture_url === 'string'
              ? body.display_picture_url
              : body.display_picture_url === null
                ? null
                : undefined,
        },
        getSafeEmailRedirectUrl(req)
      );
      if (result.requiresEmailConfirmation) {
        clearRememberCookie(req, res);
      }
      res.json(result);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to update profile.';
      res.status(400).json({ error: message });
    }
  });

  app.get('/api/dashboard/summary', requireAuth, async (req: AuthedRequest, res) => {
    if (req.worker?.role !== 'master') {
      res.status(403).json({
        error: 'Report dashboard summary is restricted to Master role.',
      });
      return;
    }
    try {
      const summary = await computeDashboardSummary();
      res.json(summary);
    } catch (err) {
      console.error('Dashboard summary error:', err);
      res.status(500).json({ error: 'Failed to load dashboard summary.' });
    }
  });

  app.get('/api/records/:entity', requireAuth, async (req: AuthedRequest, res) => {
    const entity = parseEntityParam(String(req.params.entity));
    if (!entity) {
      res.status(400).json({ error: 'Invalid entity type.' });
      return;
    }
    const worker = req.worker!;
    const isLookup = req.query.lookup === '1';

    // Strict RBAC read check for non-lookup views
    if (entity === 'logs' && worker.role !== 'master') {
      res.status(403).json({ error: 'Audit logs are restricted to Master role.' });
      return;
    }
    if (!isLookup) {
      if (worker.role === 'marketing') {
        if (
          entity !== 'commissions' &&
          entity !== 'schedules' &&
          entity !== 'invoices' &&
          entity !== 'customers' &&
          entity !== 'branches'
        ) {
          res.status(403).json({ error: 'Access denied for Marketing role.' });
          return;
        }
      } else if (worker.role === 'worker' && entity !== 'pickup_data') {
        res.status(403).json({ error: 'Field workers can only access Pickup Data.' });
        return;
      } else if (worker.role === 'admin' && entity === 'commissions') {
        res.status(403).json({ error: 'Admin role cannot view commission reports.' });
        return;
      }
    }

    try {
      const all = await listAllRecords(entity);
      const filtered = await filterRecordsForRole(entity, all, worker, isLookup);
      res.json({ records: filtered });
    } catch (err) {
      console.error(`List ${entity} error:`, err);
      res.status(500).json({
        error: err instanceof Error ? err.message : `Failed to fetch ${entity}.`,
      });
    }
  });

  app.get(
    '/api/records/:entity/export-csv',
    requireAuth,
    async (req: AuthedRequest, res) => {
      const entity = parseEntityParam(String(req.params.entity));
      if (!entity || entity === 'logs') {
        res.status(400).json({ error: 'Invalid export entity type.' });
        return;
      }
      const worker = req.worker!;
      if (!canMutateEntity(worker.role, entity)) {
        res.status(403).json({
          error: `Role "${worker.role}" cannot export ${entity} for bulk updates.`,
        });
        return;
      }

      try {
        const all = await listAllRecords(entity);
        const visible = await filterRecordsForRole(entity, all, worker, false);
        const exportFields = ENTITY_META[entity].fields.filter(
          (f) => f.type !== 'password'
        );
        const fieldKeys = ['id', ...exportFields.map((f) => f.key)];
        const headerLabels = [
          'id',
          ...exportFields.map((f) => getCsvColumnHeader(entity, f, 'update')),
        ];
        const csvLines = [headerLabels.map((h) => escapeCsvCell(h)).join(',')];

        for (const rec of visible) {
          const obj = rec as unknown as Record<string, unknown>;
          const rowValues = fieldKeys.map((key) => escapeCsvCell(obj[key]));
          csvLines.push(rowValues.join(','));
        }

        // Prepend `sep=,` with CRLF so Excel auto-splits columns across all regional locales (incl. Indonesia/EU)
        const csvContent = `sep=,\r\n${csvLines.join('\r\n')}\r\n`;
        const fileName = `limbahin-${entity}-existing-${formatCsvTimestamp()}.csv`;
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="${fileName}"`
        );
        res.send(csvContent);
      } catch (err) {
        console.error(`Export ${entity} CSV error:`, err);
        res.status(500).json({ error: `Failed to export ${entity} CSV.` });
      }
    }
  );

  app.get(
    '/api/records/:entity/:id',
    requireAuth,
    async (req: AuthedRequest, res) => {
      const entity = parseEntityParam(String(req.params.entity));
      if (!entity) {
        res.status(400).json({ error: 'Invalid entity type.' });
        return;
      }
      try {
        const record = await getRecordById(entity, String(req.params.id));
        if (!record) {
          res.status(404).json({ error: 'Record not found.' });
          return;
        }
        const allowed = await filterRecordsForRole(entity, [record], req.worker!, true);
        if (allowed.length === 0) {
          res.status(403).json({ error: 'Access denied for this record.' });
          return;
        }
        const attachments = isDocumentEntity(entity)
          ? await getDocumentAttachments(entity, allowed[0].id)
          : undefined;
        res.json({ record: allowed[0], ...(attachments ? { attachments } : {}) });
      } catch (err) {
        console.error(`Get ${entity} error:`, err);
        res.status(500).json({ error: 'Failed to load record details.' });
      }
    }
  );

  app.post(
    '/api/records/:entity/upload',
    requireAuth,
    parseSingleAssetUploadMiddleware,
    async (req: AuthedRequest, res) => {
      const entity = parseEntityParam(String(req.params.entity));
      if (!entity || entity === 'logs') {
        res.status(400).json({ error: 'Invalid entity type.' });
        return;
      }
      const worker = req.worker!;
      if (!canMutateEntity(worker.role, entity)) {
        res.status(403).json({
          error: `Role "${worker.role}" does not have permission to upload files for ${entity}.`,
        });
        return;
      }
      const uploadedFile = req.file;
      if (!uploadedFile) {
        res.status(400).json({ error: 'Please select a file to upload.' });
        return;
      }
      try {
        const url = await uploadAssetFile(
          entity,
          uploadedFile.originalname,
          uploadedFile.buffer
        );
        res.status(201).json({
          url,
          fileName: uploadedFile.originalname,
        });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to upload file.';
        res.status(400).json({ error: message });
      }
    }
  );

  app.post(
    '/api/records/:entity/upload-zip',
    requireAuth,
    (req: Request, res: Response, next: NextFunction) => {
      csvUpload.single('file')(req, res, (err: unknown) => {
        if (err) {
          res.status(400).json({
            error:
              err instanceof Error
                ? err.message
                : 'ZIP file exceeds 20 MB limit or is invalid.',
          });
          return;
        }
        next();
      });
    },
    async (req: AuthedRequest, res) => {
      const entity = parseEntityParam(String(req.params.entity));
      if (!entity || entity === 'logs') {
        res.status(400).json({ error: 'Invalid entity type.' });
        return;
      }
      const worker = req.worker!;
      if (!canMutateEntity(worker.role, entity)) {
        res.status(403).json({
          error: `Role "${worker.role}" does not have permission to upload ZIP files for ${entity}.`,
        });
        return;
      }
      const uploadedZip = req.file;
      if (!uploadedZip) {
        res.status(400).json({ error: 'Please select a .zip archive to upload.' });
        return;
      }
      try {
        const zipIndex = await buildZipEntryIndex(uploadedZip.buffer);
        const ALLOWED_IMG_EXT = new Set([
          '.png',
          '.jpg',
          '.jpeg',
          '.webp',
          '.gif',
          '.pdf',
        ]);
        const imageEntries = zipIndex.allEntries.filter((e) =>
          ALLOWED_IMG_EXT.has(path.posix.extname(e.baseLower))
        );
        if (imageEntries.length === 0) {
          res.status(400).json({
            error:
              'ZIP archive does not contain any supported image files (.png, .jpg, .jpeg, .webp, .gif, .pdf).',
          });
          return;
        }
        if (imageEntries.length > 30) {
          res.status(400).json({
            error: 'A single item ZIP archive may contain at most 30 images.',
          });
          return;
        }

        const urls: string[] = [];
        const fileNames: string[] = [];
        let totalBytes = 0;
        const MAX_EXTRACTED = 30 * 1024 * 1024;
        for (const item of imageEntries) {
          const buf = await item.entry.async('nodebuffer');
          totalBytes += buf.length;
          if (totalBytes > MAX_EXTRACTED) {
            throw new Error('Extracted ZIP contents exceed 30 MB safety limit.');
          }
          const url = await uploadAssetFile(entity, item.fullName, buf);
          urls.push(url);
          fileNames.push(path.posix.basename(item.fullName));
        }

        res.status(201).json({ urls, fileNames });
      } catch (err) {
        res.status(400).json({
          error:
            err instanceof Error
              ? err.message
              : 'Failed to process ZIP archive.',
        });
      }
    }
  );

  app.post('/api/records/:entity', requireAuth, async (req: AuthedRequest, res) => {
    const entity = parseEntityParam(String(req.params.entity));
    if (!entity) {
      res.status(400).json({ error: 'Invalid entity type.' });
      return;
    }
    const worker = req.worker!;
    if (!canMutateEntity(worker.role, entity)) {
      res.status(403).json({
        error: `Role "${worker.role}" does not have permission to create ${entity}.`,
      });
      return;
    }

    try {
      const sanitized = sanitizeEntityInput(entity, req.body || {}, true);
      if (entity === 'pickup_data' && worker.role === 'worker' && !sanitized.worker_id) {
        sanitized.worker_id = worker.id;
      }
      let created = await createEntityRecord(entity, sanitized, worker, {
        emailRedirectTo: getSafeEmailRedirectUrl(req),
      });

      let attachments: AnyEntityRecord[] | undefined;
      if (isDocumentEntity(entity) && Array.isArray(req.body?.attached_ids)) {
        const synced = await syncDocumentAttachments(
          entity as DocumentEntityKey,
          created.id,
          req.body.attached_ids as string[],
          worker
        );
        attachments = synced.attachments;
        if (
          (entity === 'invoices' ||
            entity === 'fpl_real' ||
            entity === 'fpl_doc' ||
            entity === 'purchase_orders') &&
          synced.attachments.length > 0 &&
          !(typeof req.body?.subtotal_amount === 'number' && req.body.subtotal_amount > 0)
        ) {
          created = await updateEntityRecord(
            entity,
            created.id,
            {
              subtotal_amount: synced.subtotal,
              adjustments: sanitized.adjustments ?? [],
            },
            worker
          );
        }
      }

      let ledgerRcrdId: string | null = null;
      if (entity === 'invoices' && !(created as InvoiceRecord).is_canceled) {
        try {
          ledgerRcrdId = await postInvoiceToLedger(created.id);
        } catch (ledgerErr) {
          console.warn('Auto-post invoice to ledger skipped:', ledgerErr);
        }
      }
      res.status(201).json({
        record: created,
        ...(attachments ? { attachments } : {}),
        ledgerRcrdId,
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : `Failed to create ${entity}.`;
      res.status(400).json({ error: message });
    }
  });

  app.put(
    '/api/records/:entity/:id',
    requireAuth,
    async (req: AuthedRequest, res) => {
      const entity = parseEntityParam(String(req.params.entity));
      if (!entity) {
        res.status(400).json({ error: 'Invalid entity type.' });
        return;
      }
      const worker = req.worker!;
      if (!canMutateEntity(worker.role, entity)) {
        res.status(403).json({
          error: `Role "${worker.role}" cannot edit ${entity}.`,
        });
        return;
      }

      try {
        const existing = await getRecordById(entity, String(req.params.id));
        if (!existing) {
          res.status(404).json({ error: 'Record not found.' });
          return;
        }
        if (
          worker.role === 'admin' &&
          entity !== 'requests' &&
          existing.created_by !== worker.id
        ) {
          res.status(403).json({
            error: 'Admin users can only edit records they created.',
          });
          return;
        }

        const sanitized = sanitizeEntityInput(entity, req.body || {}, false);
        let attachments: AnyEntityRecord[] | undefined;
        if (isDocumentEntity(entity) && Array.isArray(req.body?.attached_ids)) {
          const synced = await syncDocumentAttachments(
            entity as DocumentEntityKey,
            String(req.params.id),
            req.body.attached_ids as string[],
            worker
          );
          attachments = synced.attachments;
          if (
            (entity === 'invoices' ||
              entity === 'fpl_real' ||
              entity === 'fpl_doc' ||
              entity === 'purchase_orders') &&
            !('subtotal_amount' in sanitized)
          ) {
            sanitized.subtotal_amount = synced.subtotal;
          }
        }

        const updated = await updateEntityRecord(
          entity,
          String(req.params.id),
          sanitized,
          worker,
          { emailRedirectTo: getSafeEmailRedirectUrl(req) }
        );
        res.json({
          record: updated,
          ...(attachments ? { attachments } : {}),
        });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : `Failed to update ${entity}.`;
        res.status(400).json({ error: message });
      }
    }
  );

  app.delete(
    '/api/records/:entity/:id',
    requireAuth,
    async (req: AuthedRequest, res) => {
      const entity = parseEntityParam(String(req.params.entity));
      if (!entity) {
        res.status(400).json({ error: 'Invalid entity type.' });
        return;
      }
      const worker = req.worker!;
      if (!canMutateEntity(worker.role, entity)) {
        res.status(403).json({
          error: `Role "${worker.role}" cannot delete ${entity}.`,
        });
        return;
      }

      try {
        const existing = await getRecordById(entity, String(req.params.id));
        if (!existing) {
          res.status(404).json({ error: 'Record not found.' });
          return;
        }
        if (entity === 'workers' && existing.id === worker.id) {
          res.status(400).json({ error: 'You cannot delete your own active account.' });
          return;
        }
        if (worker.role === 'admin' && existing.created_by !== worker.id) {
          res.status(403).json({
            error: 'Admin users can only delete records they created.',
          });
          return;
        }

        await deleteEntityRecord(entity, String(req.params.id));
        res.json({ deleted: true, id: req.params.id });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : `Failed to delete ${entity}.`;
        res.status(400).json({ error: message });
      }
    }
  );

  app.post(
    '/api/records/:entity/bulk-save',
    requireAuth,
    async (req: AuthedRequest, res) => {
      const entity = parseEntityParam(String(req.params.entity));
      if (!entity || entity === 'logs') {
        res.status(400).json({ error: 'Invalid entity type.' });
        return;
      }
      const worker = req.worker!;
      if (worker.role !== 'master') {
        res.status(403).json({
          error: 'Spreadsheet bulk editing is restricted to Master role.',
        });
        return;
      }

      const rawUpdates = Array.isArray(req.body?.updates) ? req.body.updates : [];
      const rawCreates = Array.isArray(req.body?.creates) ? req.body.creates : [];
      const rawDeletes = Array.isArray(req.body?.deletes) ? req.body.deletes : [];

      if (rawUpdates.length + rawCreates.length + rawDeletes.length === 0) {
        res.json({
          createdCount: 0,
          updatedCount: 0,
          deletedCount: 0,
          logCreateId: null,
          logUpdateId: null,
          errors: [],
        });
        return;
      }

      try {
        const sanitizedUpdates = rawUpdates
          .filter(
            (u: unknown): u is { id: string; changes: Record<string, unknown> } =>
              Boolean(u && typeof (u as { id?: unknown }).id === 'string')
          )
          .map((u: { id: string; changes: Record<string, unknown> }) => ({
            id: u.id.trim(),
            changes: sanitizeEntityInput(entity, u.changes || {}, false, true),
          }));

        const sanitizedCreates = rawCreates
          .filter(
            (c: unknown): c is { tempKey: string; data: Record<string, unknown> } =>
              Boolean(c && typeof (c as { tempKey?: unknown }).tempKey === 'string')
          )
          .map((c: { tempKey: string; data: Record<string, unknown> }) => ({
            tempKey: c.tempKey,
            data: sanitizeEntityInput(entity, c.data || {}, true, false),
          }));

        const deletes = rawDeletes
          .filter((id: unknown): id is string => typeof id === 'string' && Boolean(id.trim()))
          .map((id: string) => id.trim());

        const result = await applyMasterBulkSheetSave(
          entity,
          {
            updates: sanitizedUpdates,
            creates: sanitizedCreates,
            deletes,
          },
          worker,
          { emailRedirectTo: getSafeEmailRedirectUrl(req) }
        );
        let ledgerPostedCount = 0;
        if (entity === 'invoices' && result.createdIds.length > 0) {
          const allInvoices = (await listAllRecords('invoices')) as InvoiceRecord[];
          const createdIds = new Set(result.createdIds);
          for (const inv of allInvoices) {
            if (!createdIds.has(inv.id)) continue;
            const st = String(inv.status || '').toLowerCase();
            if (inv.is_canceled || st === 'canceled' || st === 'cancel' || st === 'dihapus') {
              continue;
            }
            try {
              const rcrdId = await postInvoiceToLedger(inv.id);
              if (rcrdId) ledgerPostedCount += 1;
            } catch (ledgerErr) {
              console.error(
                `Bulk-save auto-post invoice ${inv.id} to ledger failed:`,
                ledgerErr
              );
            }
          }
        }
        res.json({ ...result, ledgerPostedCount });
      } catch (err) {
        res.status(400).json({
          error:
            err instanceof Error ? err.message : 'Failed to save spreadsheet changes.',
        });
      }
    }
  );

  app.post(
    '/api/records/:entity/import-csv',
    requireAuth,
    parseCsvUploadMiddleware,
    async (req: AuthedRequest, res) => {
      const entity = parseEntityParam(String(req.params.entity));
      if (!entity || entity === 'logs') {
        res.status(400).json({ error: 'Invalid entity type.' });
        return;
      }
      const worker = req.worker!;
      if (!canMutateEntity(worker.role, entity)) {
        res.status(403).json({
          error: `Role "${worker.role}" cannot import ${entity}.`,
        });
        return;
      }

      const files = req.files as
        | {
            csvFile?: Express.Multer.File[];
            zipFile?: Express.Multer.File[];
          }
        | undefined;

      const uploadedCsvFile = files?.csvFile?.[0];
      const uploadedZipFile = files?.zipFile?.[0];

      const rawMode =
        typeof req.body?.mode === 'string' ? req.body.mode.trim().toLowerCase() : 'insert';
      const importMode: CsvImportMode = rawMode === 'update' ? 'update' : 'insert';

      const csvText = uploadedCsvFile
        ? uploadedCsvFile.buffer.toString('utf8')
        : typeof req.body?.csv === 'string'
          ? req.body.csv
          : '';

      const { delimiter, lines } = extractCsvDelimiterAndLines(csvText);

      if (lines.length < 2) {
        res.status(400).json({
          error: 'CSV must contain a header row and at least one data row.',
        });
        return;
      }

      const rawExcelOffset = Number.parseInt(
        String(req.body?.excelRowOffset ?? '0'),
        10
      );
      const excelRowOffset =
        Number.isFinite(rawExcelOffset) && rawExcelOffset > 0
          ? rawExcelOffset
          : 0;

      const urlFields = getEntityUrlFields(entity);
      let sanitizedZipEntries: SanitizedZipEntry<JSZip.JSZipObject>[] = [];
      if (uploadedZipFile) {
        try {
          const zip = await JSZip.loadAsync(uploadedZipFile.buffer);
          const rawZipItems = Object.entries(zip.files).map(([rawPath, entry]) => ({
            rawPath,
            isDir: entry.dir,
            payload: entry,
          }));
          sanitizedZipEntries = sanitizeZipEntries(rawZipItems);
        } catch {
          res.status(400).json({
            error: 'Uploaded ZIP file could not be read. Please ensure it is a valid .zip archive.',
          });
          return;
        }
      }

      // Pre-load existing records & company_id so we can resolve sequential system IDs
      // (e.g. ITM-26-1001) BEFORE uploading renamed files to {company_id}/{entity}/{system_id}-{seq}.{ext}
      const existingRecords = await listAllRecords(entity);
      const existingById = new Map<string, AnyEntityRecord>(
        existingRecords.map((r) => [r.id.toUpperCase(), r])
      );
      const allocatedIds = existingRecords.map((r) => r.id);

      let companyId = 'default';
      try {
        const companies = await listCompanies();
        if (companies.length > 0 && companies[0]?.id) {
          companyId = companies[0].id;
        }
      } catch {
        // Fallback to default storage tenant folder
      }

      const headers = parseCsvLine(lines[0], delimiter).map(normalizeCsvHeaderShared);
      let totalExtractedBytes = 0;
      const MAX_TOTAL_EXTRACTED_BYTES = 30 * 1024 * 1024; // 30 MB zip-bomb ceiling

      const preparedRows: Array<{
        rowNumber: number;
        data: Record<string, unknown>;
        preAllocatedId?: string;
      }> = [];
      const preErrors: Array<{ row: number; error: string }> = [];

      // Row 1 is headers (lines[0]); first data item is Excel Row 2 (excelRowOffset + i + 1)
      for (let i = 1; i < lines.length; i += 1) {
        const excelRow = excelRowOffset + i + 1;
        const values = parseCsvLine(lines[i], delimiter);
        const rowObj: Record<string, unknown> = {};
        headers.forEach((header, idx) => {
          rowObj[header] = values[idx] ?? '';
        });

        // Resolve target system ID before uploading any attachments
        let targetSystemId: string;
        let existingMatch: AnyEntityRecord | undefined;

        if (importMode === 'insert') {
          delete rowObj.id;
          targetSystemId = generateEntityId(entity, allocatedIds);
          allocatedIds.push(targetSystemId);
        } else {
          const rawId = typeof rowObj.id === 'string' ? rowObj.id.trim() : '';
          existingMatch = rawId ? existingById.get(rawId.toUpperCase()) : undefined;
          if (existingMatch) {
            targetSystemId = existingMatch.id;
          } else {
            targetSystemId = generateEntityId(
              entity,
              allocatedIds,
              undefined,
              rawId || null
            );
            allocatedIds.push(targetSystemId);
          }
        }

        try {
          const uploadRenamedEntry = async (
            match: SanitizedZipEntry<JSZip.JSZipObject>,
            seq: number
          ): Promise<string> => {
            const fileBuf = await match.payload.async('nodebuffer');
            totalExtractedBytes += fileBuf.length;
            if (totalExtractedBytes > MAX_TOTAL_EXTRACTED_BYTES) {
              throw new Error(
                'Extracted ZIP contents exceed the 30 MB batch safety limit.'
              );
            }
            const targetFileName = `${targetSystemId}-${seq}${match.extLower}`;
            return uploadAssetFile(entity, match.baseName, fileBuf, {
              companyId,
              targetFileName,
            });
          };

          for (const urlField of urlFields) {
            const rawCell =
              typeof rowObj[urlField.key] === 'string'
                ? (rowObj[urlField.key] as string)
                : '';

            // In Update mode on an existing record, if the CSV cell was omitted or left blank
            // but the existing record already has media, carry over existing list URLs so ZIP matches append cleanly
            let effectiveCell = rawCell;
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

            if (plan.missingExplicitTokens.length > 0) {
              if (!uploadedZipFile) {
                throw new Error(
                  `Column "${urlField.key}" references file "${plan.missingExplicitTokens[0]}", but no ZIP archive was uploaded.`
                );
              }
              throw new Error(
                `File "${plan.missingExplicitTokens[0]}" (column "${urlField.key}") was not found in the uploaded ZIP archive.`
              );
            }

            if (urlField.type === 'url-list') {
              if (plan.existingUrls.length === 0 && plan.matchedZipEntries.length === 0) {
                continue;
              }
              // Continue sequential numbering after any existing URLs to avoid overwriting existing files
              let maxExistingSeq = plan.existingUrls.length;
              const seqPattern = new RegExp(
                `${targetSystemId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-(\\d+)\\.`,
                'i'
              );
              for (const existingUrl of plan.existingUrls) {
                const m = seqPattern.exec(existingUrl);
                if (m) {
                  const n = Number.parseInt(m[1], 10);
                  if (Number.isFinite(n) && n > maxExistingSeq) {
                    maxExistingSeq = n;
                  }
                }
              }

              const finalUrls = [...plan.existingUrls];
              let seqCursor = maxExistingSeq;
              for (const match of plan.matchedZipEntries) {
                seqCursor += 1;
                const uploadedUrl = await uploadRenamedEntry(match, seqCursor);
                if (!finalUrls.includes(uploadedUrl)) {
                  finalUrls.push(uploadedUrl);
                }
              }
              rowObj[urlField.key] = finalUrls;
            } else {
              // Single URL field: if ZIP matched row R (or explicit file), replace existing URL with `{system_id}-1.{ext}`
              if (plan.matchedZipEntries.length > 0) {
                rowObj[urlField.key] = await uploadRenamedEntry(
                  plan.matchedZipEntries[0],
                  1
                );
              } else if (plan.existingUrls.length > 0) {
                rowObj[urlField.key] = plan.existingUrls[0];
              }
            }
          }

          const sanitized = sanitizeEntityInput(
            entity,
            rowObj,
            importMode === 'insert',
            importMode === 'update'
          );
          if (entity === 'pickup_data' && worker.role === 'worker' && !sanitized.worker_id) {
            sanitized.worker_id = worker.id;
          }
          if (importMode === 'update' && !existingMatch && !sanitized.id) {
            sanitized.id = targetSystemId;
          }
          preparedRows.push({
            rowNumber: excelRow,
            data: sanitized,
            preAllocatedId: importMode === 'insert' ? targetSystemId : undefined,
          });
        } catch (err) {
          preErrors.push({
            row: excelRow,
            error: err instanceof Error ? err.message : 'Invalid row data',
          });
        }
      }

      try {
        const result = await applyBulkCsvImport(
          entity,
          importMode,
          preparedRows,
          worker,
          { emailRedirectTo: getSafeEmailRedirectUrl(req) }
        );
        let ledgerPostedCount = 0;
        if (entity === 'invoices' && result.created.length > 0) {
          for (const rec of result.created) {
            const inv = rec as InvoiceRecord;
            const st = String(inv.status || '').toLowerCase();
            if (inv.is_canceled || st === 'canceled' || st === 'cancel' || st === 'dihapus') {
              continue;
            }
            try {
              const rcrdId = await postInvoiceToLedger(inv.id);
              if (rcrdId) ledgerPostedCount += 1;
            } catch (ledgerErr) {
              console.error(
                `CSV import auto-post invoice ${inv.id} to ledger failed:`,
                ledgerErr
              );
            }
          }
        }
        const combinedErrors = [...preErrors, ...result.errors].sort(
          (a, b) => a.row - b.row
        );
        res.status(201).json({
          ...result,
          ledgerPostedCount,
          errorCount: combinedErrors.length,
          errors: combinedErrors,
        });
      } catch (err) {
        res.status(400).json({
          error: err instanceof Error ? err.message : 'CSV import failed.',
        });
      }
    }
  );

  // ==========================================================================
  // Multi-Tenant Accounting, Ledger (RCRD / RCRD-CLSF) & Invoice Cancellation
  // ==========================================================================
  const requireAccountingAccess = (
    req: AuthedRequest,
    res: Response,
    next: NextFunction
  ): void => {
    const role = req.worker?.role;
    if (role !== 'master' && role !== 'admin') {
      res.status(403).json({
        error: 'Accounting and ledger operations are restricted to Master and Admin roles.',
      });
      return;
    }
    next();
  };

  app.post(
    '/api/invoices/:id/cancel',
    requireAuth,
    requireAccountingAccess,
    async (req: AuthedRequest, res) => {
      try {
        const invoiceId = String(req.params.id);
        const worker = req.worker!;
        const existing = await getRecordById('invoices', invoiceId);
        if (!existing) {
          res.status(404).json({ error: 'Invoice not found.' });
          return;
        }
        if (worker.role === 'admin' && existing.created_by !== worker.id) {
          res.status(403).json({
            error: 'Admin users can only cancel invoices they created.',
          });
          return;
        }

        const body = (req.body || {}) as Record<string, unknown>;
        const cancelDate =
          typeof body.cancelDate === 'string' && body.cancelDate.trim()
            ? body.cancelDate.trim()
            : new Date().toISOString().slice(0, 10);
        const reason =
          typeof body.reason === 'string' ? body.reason.trim() : '';
        const autoReverse = body.autoReverse !== false;

        const result = await cancelInvoiceWithLedger(
          invoiceId,
          {
            cancelDate,
            reason,
            autoReverse,
            arCode: typeof body.arCode === 'string' ? body.arCode : undefined,
            revCode: typeof body.revCode === 'string' ? body.revCode : undefined,
            taxCode: typeof body.taxCode === 'string' ? body.taxCode : undefined,
          },
          worker
        );
        res.json(result);
      } catch (err) {
        res.status(400).json({
          error:
            err instanceof Error ? err.message : 'Failed to cancel invoice.',
        });
      }
    }
  );

  app.get(
    '/api/accounting/companies',
    requireAuth,
    requireAccountingAccess,
    async (_req, res) => {
      try {
        const companies = await listCompanies();
        res.json({ companies });
      } catch (err) {
        res.status(500).json({
          error:
            err instanceof Error ? err.message : 'Failed to load companies.',
        });
      }
    }
  );

  app.post(
    '/api/accounting/companies',
    requireAuth,
    async (req: AuthedRequest, res) => {
      if (req.worker?.role !== 'master') {
        res.status(403).json({ error: 'Only Master role can add companies.' });
        return;
      }
      try {
        const name =
          typeof req.body?.name === 'string' ? req.body.name.trim() : '';
        const company = await createCompany(name, req.worker);
        res.status(201).json({ company });
      } catch (err) {
        res.status(400).json({
          error:
            err instanceof Error ? err.message : 'Failed to create company.',
        });
      }
    }
  );

  app.get(
    '/api/accounting/coa',
    requireAuth,
    requireAccountingAccess,
    async (req, res) => {
      try {
        const companyId =
          typeof req.query.companyId === 'string' ? req.query.companyId : undefined;
        const accounts = await listChartOfAccounts(companyId);
        res.json({ accounts });
      } catch (err) {
        res.status(500).json({
          error:
            err instanceof Error
              ? err.message
              : 'Failed to load Chart of Accounts.',
        });
      }
    }
  );

  app.post(
    '/api/accounting/coa',
    requireAuth,
    requireAccountingAccess,
    async (req: AuthedRequest, res) => {
      try {
        const body = (req.body || {}) as Record<string, unknown>;
        const account = await createChartOfAccount(
          {
            company_id:
              typeof body.company_id === 'string' ? body.company_id : undefined,
            code: typeof body.code === 'string' ? body.code : '',
            name: typeof body.name === 'string' ? body.name : '',
            category: String(body.category || 'ASSET') as
              | 'ASSET'
              | 'LIABILITY'
              | 'EQUITY'
              | 'REVENUE'
              | 'EXPENSE',
            normal_balance:
              body.normal_balance === 'Debit' || body.normal_balance === 'Credit'
                ? body.normal_balance
                : undefined,
            statement:
              body.statement === 'BS' || body.statement === 'IS'
                ? body.statement
                : undefined,
          },
          req.worker!
        );
        res.status(201).json({ account });
      } catch (err) {
        res.status(400).json({
          error:
            err instanceof Error ? err.message : 'Failed to create account.',
        });
      }
    }
  );

  app.put(
    '/api/accounting/coa/:id',
    requireAuth,
    requireAccountingAccess,
    async (req: AuthedRequest, res) => {
      try {
        const body = (req.body || {}) as Record<string, unknown>;
        const account = await updateChartOfAccount(
          String(req.params.id),
          {
            code: typeof body.code === 'string' ? body.code : undefined,
            name: typeof body.name === 'string' ? body.name : undefined,
            category:
              typeof body.category === 'string'
                ? (body.category as
                    | 'ASSET'
                    | 'LIABILITY'
                    | 'EQUITY'
                    | 'REVENUE'
                    | 'EXPENSE')
                : undefined,
            normal_balance:
              body.normal_balance === 'Debit' || body.normal_balance === 'Credit'
                ? body.normal_balance
                : undefined,
            statement:
              body.statement === 'BS' || body.statement === 'IS'
                ? body.statement
                : undefined,
          },
          req.worker!
        );
        res.json({ account });
      } catch (err) {
        res.status(400).json({
          error:
            err instanceof Error ? err.message : 'Failed to update account.',
        });
      }
    }
  );

  app.delete(
    '/api/accounting/coa/:id',
    requireAuth,
    requireAccountingAccess,
    async (req, res) => {
      try {
        await deleteChartOfAccount(String(req.params.id));
        res.json({ deleted: true, id: req.params.id });
      } catch (err) {
        res.status(400).json({
          error:
            err instanceof Error ? err.message : 'Failed to delete account.',
        });
      }
    }
  );

  app.get(
    '/api/accounting/unpaid-invoices',
    requireAuth,
    requireAccountingAccess,
    async (req, res) => {
      try {
        const companyId =
          typeof req.query.companyId === 'string' ? req.query.companyId : undefined;
        const invoices = await listUnpaidActiveInvoices(companyId);
        res.json({ invoices });
      } catch (err) {
        res.status(500).json({
          error:
            err instanceof Error
              ? err.message
              : 'Failed to load unpaid active invoices.',
        });
      }
    }
  );

  app.get(
    '/api/accounting/records',
    requireAuth,
    requireAccountingAccess,
    async (req, res) => {
      try {
        const companyId =
          typeof req.query.companyId === 'string' ? req.query.companyId : undefined;
        const records = await listTransactionRecords(companyId);
        res.json({ records });
      } catch (err) {
        res.status(500).json({
          error:
            err instanceof Error
              ? err.message
              : 'Failed to load ledger transaction records.',
        });
      }
    }
  );

  app.get(
    '/api/accounting/records/export-csv',
    requireAuth,
    requireAccountingAccess,
    async (req, res) => {
      try {
        const companyId =
          typeof req.query.companyId === 'string' ? req.query.companyId : undefined;
        const records = await listTransactionRecords(companyId);
        const headers = [
          'rcrd_id (ref)',
          'group_no',
          'transaction_date',
          'source_type (MANUAL | BCA1 | SYSTEM | ADJUSTMENT)',
          'description',
          'note',
          'type (DEBIT | CREDIT)',
          'account_code (ref)',
          'amount',
          'ref_model (invoice | commission | payroll | expense | berita_acara | purchase_order | fpl_real | fpl_doc)',
          'ref_number (ref)',
        ];
        const csvLines = [headers.map(escapeCsvCell).join(',')];
        let groupIdx = 1;
        for (const rec of records) {
          if (rec.lines.length === 0) {
            csvLines.push(
              [
                rec.id,
                String(groupIdx),
                rec.transaction_date,
                rec.source_type || 'MANUAL',
                rec.transaction_description || '',
                rec.transaction_note || '',
                '',
                '',
                String(rec.transaction_amount),
                '',
                '',
              ]
                .map(escapeCsvCell)
                .join(',')
            );
          } else {
            for (const line of rec.lines) {
              csvLines.push(
                [
                  rec.id,
                  String(groupIdx),
                  rec.transaction_date,
                  rec.source_type || 'MANUAL',
                  rec.transaction_description || '',
                  rec.transaction_note || '',
                  line.type,
                  line.account_code || '',
                  String(line.amount),
                  line.reference_model || '',
                  line.reference_label || line.reference_model_id || '',
                ]
                  .map(escapeCsvCell)
                  .join(',')
              );
            }
          }
          groupIdx += 1;
        }
        const csvContent = `sep=,\r\n${csvLines.join('\r\n')}\r\n`;
        const fileName = `limbahin-ledger-existing-${formatCsvTimestamp()}.csv`;
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="${fileName}"`
        );
        res.send(csvContent);
      } catch (err) {
        res.status(500).json({
          error:
            err instanceof Error ? err.message : 'Failed to export ledger CSV.',
        });
      }
    }
  );

  app.post(
    '/api/accounting/records/import-csv',
    requireAuth,
    requireAccountingAccess,
    parseCsvUploadMiddleware,
    async (req: AuthedRequest, res) => {
      try {
        const files = req.files as
          | { csvFile?: Express.Multer.File[] }
          | undefined;
        const uploadedCsvFile = files?.csvFile?.[0];
        const csvText = uploadedCsvFile
          ? uploadedCsvFile.buffer.toString('utf8')
          : typeof req.body?.csv === 'string'
            ? req.body.csv
            : '';
        const companyId =
          typeof req.body?.companyId === 'string'
            ? req.body.companyId.trim()
            : undefined;

        const { delimiter, lines, rowOffset } = extractCsvDelimiterAndLines(csvText);
        if (lines.length < 2) {
          res.status(400).json({
            error: 'CSV must include a header row and at least one ledger line.',
          });
          return;
        }

        const rawLedgerOffset = Number.parseInt(
          String(req.body?.excelRowOffset ?? '0'),
          10
        );
        const excelRowOffset =
          Number.isFinite(rawLedgerOffset) && rawLedgerOffset > 0
            ? rawLedgerOffset
            : 0;

        const allowDraftsRaw = req.body?.allowDrafts;
        const allowDrafts =
          allowDraftsRaw === undefined
            ? true
            : String(allowDraftsRaw).toLowerCase() !== 'false';

        const rawMode =
          typeof req.body?.mode === 'string'
            ? req.body.mode.trim().toLowerCase()
            : 'insert';
        const importMode: CsvImportMode =
          rawMode === 'update' ? 'update' : 'insert';

        const headers = parseCsvLine(lines[0], delimiter).map(
          normalizeCsvHeaderShared
        );
        const stagedRows: SingleCsvStagedRow[] = [];

        for (let i = 1; i < lines.length; i += 1) {
          const rowNumber = excelRowOffset + i + 1 + rowOffset;
          const values = parseCsvLine(lines[i], delimiter);
          const obj: Record<string, string> = {};
          headers.forEach((h, idx) => {
            obj[h] = (values[idx] ?? '').trim();
          });

          const rawType = (obj.type || '').toUpperCase();
          if (rawType !== '' && rawType !== 'DEBIT' && rawType !== 'CREDIT') {
            res.status(400).json({
              error: `Row ${rowNumber}: column "type" must be DEBIT, CREDIT, or blank for unlabeled rows (got "${obj.type || ''}").`,
            });
            return;
          }

          const amountNum = Number((obj.amount || '').replace(/,/g, ''));
          stagedRows.push({
            rowNumber,
            rcrd_id: importMode === 'update' ? obj.rcrd_id || null : null,
            group_no: obj.group_no || '',
            transaction_date: obj.transaction_date || '',
            source_type: obj.source_type || obj.record_type || null,
            bank_code: obj.bank_code || null,
            description: obj.description || obj.transaction_description || '',
            note: obj.note || obj.transaction_note || null,
            type: rawType === 'DEBIT' || rawType === 'CREDIT' ? rawType : null,
            account_code: obj.account_code || '',
            amount: amountNum,
            ref_model: obj.ref_model || obj.reference_model || null,
            ref_number: obj.ref_number || obj.reference_model_id || null,
          });
        }

        const result = await processLedgerCsvImport(
          companyId,
          stagedRows,
          req.worker!,
          allowDrafts,
          importMode
        );
        res.status(201).json(result);
      } catch (err) {
        res.status(400).json({
          error:
            err instanceof Error
              ? err.message
              : 'Failed to process ledger CSV batch.',
        });
      }
    }
  );

  app.post(
    '/api/accounting/records',
    requireAuth,
    requireAccountingAccess,
    async (req: AuthedRequest, res) => {
      try {
        const body = (req.body || {}) as Record<string, unknown>;
        const record = await createManualTransactionRecord(
          {
            company_id:
              typeof body.company_id === 'string' ? body.company_id : undefined,
            source_type:
              typeof body.source_type === 'string'
                ? (body.source_type as
                    | 'MANUAL'
                    | 'BCA1'
                    | 'SYSTEM'
                    | 'ADJUSTMENT'
                    | 'SYSTEM_AUTO'
                    | 'CSV_IMPORT'
                    | 'REVERSAL')
                : 'MANUAL',
            bank_account_id:
              typeof body.bank_account_id === 'string'
                ? body.bank_account_id
                : null,
            transaction_date:
              typeof body.transaction_date === 'string'
                ? body.transaction_date
                : '',
            transaction_description:
              typeof body.transaction_description === 'string'
                ? body.transaction_description
                : '',
            transaction_amount:
              body.transaction_amount !== undefined && body.transaction_amount !== null
                ? Number(body.transaction_amount)
                : undefined,
            transaction_note:
              typeof body.transaction_note === 'string'
                ? body.transaction_note
                : null,
            lines: Array.isArray(body.lines)
              ? (body.lines as Array<{
                  type: 'DEBIT' | 'CREDIT';
                  account_id: string;
                  amount: number;
                  reference_model?: string | null;
                  reference_model_id?: string | null;
                }>)
              : [],
          },
          req.worker!
        );
        res.status(201).json({ record });
      } catch (err) {
        res.status(400).json({
          error:
            err instanceof Error
              ? err.message
              : 'Failed to save transaction record.',
        });
      }
    }
  );

  app.put(
    '/api/accounting/records/:id',
    requireAuth,
    requireAccountingAccess,
    async (req: AuthedRequest, res) => {
      try {
        const body = (req.body || {}) as Record<string, unknown>;
        const record = await updateManualTransactionRecord(
          String(req.params.id),
          {
            company_id:
              typeof body.company_id === 'string' ? body.company_id : undefined,
            source_type:
              typeof body.source_type === 'string'
                ? (body.source_type as
                    | 'MANUAL'
                    | 'BCA1'
                    | 'SYSTEM'
                    | 'ADJUSTMENT'
                    | 'SYSTEM_AUTO'
                    | 'CSV_IMPORT'
                    | 'REVERSAL')
                : undefined,
            bank_account_id:
              typeof body.bank_account_id === 'string'
                ? body.bank_account_id
                : null,
            transaction_date:
              typeof body.transaction_date === 'string'
                ? body.transaction_date
                : '',
            transaction_description:
              typeof body.transaction_description === 'string'
                ? body.transaction_description
                : '',
            transaction_amount:
              body.transaction_amount !== undefined && body.transaction_amount !== null
                ? Number(body.transaction_amount)
                : undefined,
            transaction_note:
              typeof body.transaction_note === 'string'
                ? body.transaction_note
                : null,
            lines: Array.isArray(body.lines)
              ? (body.lines as Array<{
                  type: 'DEBIT' | 'CREDIT';
                  account_id: string;
                  amount: number;
                  reference_model?: string | null;
                  reference_model_id?: string | null;
                }>)
              : [],
          },
          req.worker!
        );
        res.json({ record });
      } catch (err) {
        res.status(400).json({
          error:
            err instanceof Error
              ? err.message
              : 'Failed to update transaction record.',
        });
      }
    }
  );

  app.delete(
    '/api/accounting/records/:id',
    requireAuth,
    requireAccountingAccess,
    async (req, res) => {
      try {
        await deleteTransactionRecord(String(req.params.id));
        res.json({ deleted: true, id: req.params.id });
      } catch (err) {
        res.status(400).json({
          error:
            err instanceof Error
              ? err.message
              : 'Failed to delete transaction record.',
        });
      }
    }
  );

  app.get(
    '/api/accounting/statements',
    requireAuth,
    requireAccountingAccess,
    async (req, res) => {
      try {
        const companyId =
          typeof req.query.companyId === 'string' ? req.query.companyId : undefined;
        const startDate =
          typeof req.query.startDate === 'string' ? req.query.startDate : undefined;
        const endDate =
          typeof req.query.endDate === 'string' ? req.query.endDate : undefined;
        const report = await generateFinancialStatements(
          companyId,
          startDate,
          endDate
        );
        res.json(report);
      } catch (err) {
        res.status(400).json({
          error:
            err instanceof Error
              ? err.message
              : 'Failed to generate financial statements.',
        });
      }
    }
  );

  // Ensure unmatched /api/* routes always return JSON 404 instead of SPA HTML
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found.' });
  });

  // ==========================================================================
  // Frontend Asset Serving (Vite Dev Middleware or Production Static Build)
  // ==========================================================================
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/')) {
        next();
        return;
      }
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const PORT = Number(process.env.PORT) || 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Limbahin ERP server listening on http://0.0.0.0:${PORT}`);
  });
}

createServer().catch((err) => {
  console.error('Failed to start Limbahin ERP server:', err);
  process.exit(1);
});
