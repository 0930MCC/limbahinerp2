import type {
  AnyEntityRecord,
  AuthChangeEmailResponse,
  AuthConfirmResponse,
  AuthForgotPasswordResponse,
  AuthMeResponse,
  AuthProfileUpdateResponse,
  AuthResendResponse,
  AuthResetPasswordResponse,
  AuthRestoreResponse,
  AuthSessionResponse,
  AuthSignUpResponse,
  AuthStatusResponse,
  CancelInvoiceResponse,
  ChartOfAccountRecord,
  CoaCategory,
  CoaNormalBalance,
  CoaStatement,
  CompanyRecord,
  CsvImportMode,
  CsvImportResult,
  DashboardSummary,
  EntityKey,
  FinancialStatementsResponse,
  LedgerCsvImportResult,
  LedgerEntryType,
  TransactionRecord,
  UnpaidInvoiceSummary,
} from '../shared/types.ts';

// Strictly held in memory (never localStorage or sessionStorage)
let inMemoryToken: string | null = null;

export function setAuthToken(token: string | null): void {
  inMemoryToken = token;
}

export function getAuthToken(): string | null {
  return inMemoryToken;
}

export class ApiError extends Error {
  status: number;
  code?: string;
  email?: string;
  workerId?: string;
  role?: string;
  retryAfterSeconds?: number;

  constructor(
    message: string,
    status: number,
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

interface ApiLifecycleListeners {
  onStart?: (label?: string) => void;
  onEnd?: () => void;
  onError?: (err: Error) => void;
}

const apiListeners = new Set<ApiLifecycleListeners>();

export function registerApiListeners(listeners: ApiLifecycleListeners): () => void {
  apiListeners.add(listeners);
  return () => {
    apiListeners.delete(listeners);
  };
}

async function request<T>(
  url: string,
  options: RequestInit = {},
  loadingLabel = 'Loading...'
): Promise<T> {
  const headers = new Headers(options.headers);
  const isFormData =
    typeof FormData !== 'undefined' && options.body instanceof FormData;
  if (!isFormData && !headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json');
  }
  headers.set('X-Requested-With', 'LimbahinClient');
  if (inMemoryToken) {
    headers.set('Authorization', `Bearer ${inMemoryToken}`);
  }

  for (const listener of apiListeners) {
    listener.onStart?.(loadingLabel);
  }

  try {
    const response = await fetch(url, {
      ...options,
      headers,
      credentials: 'include',
    });
    const contentType = response.headers.get('content-type') || '';
    const isJson = contentType.includes('application/json');

    let data: Record<string, unknown> | null = null;
    if (isJson) {
      try {
        data = (await response.json()) as Record<string, unknown>;
      } catch {
        data = null;
      }
    }

    if (!response.ok) {
      const apiErr = new ApiError(
        typeof data?.error === 'string'
          ? data.error
          : `Request failed (${response.status} ${response.statusText || 'Error'})`,
        response.status,
        typeof data?.code === 'string' ? data.code : undefined,
        typeof data?.email === 'string' ? data.email : undefined,
        typeof data?.workerId === 'string' ? data.workerId : undefined,
        typeof data?.role === 'string' ? data.role : undefined,
        typeof data?.retryAfterSeconds === 'number'
          ? data.retryAfterSeconds
          : undefined
      );
      for (const listener of apiListeners) {
        listener.onError?.(apiErr);
      }
      throw apiErr;
    }

    if (!isJson || !data) {
      const invalidErr = new ApiError(
        'Server returned an unexpected response format. Please retry in a moment.',
        response.status || 500
      );
      for (const listener of apiListeners) {
        listener.onError?.(invalidErr);
      }
      throw invalidErr;
    }

    return data as T;
  } catch (err) {
    if (!(err instanceof ApiError)) {
      const networkErr =
        err instanceof Error
          ? err
          : new Error('Network error. Please check your connection and try again.');
      for (const listener of apiListeners) {
        listener.onError?.(networkErr);
      }
      throw networkErr;
    }
    throw err;
  } finally {
    for (const listener of apiListeners) {
      listener.onEnd?.();
    }
  }
}

export const api = {
  authStatus: () => request<AuthStatusResponse>('/api/auth/status', {}, 'Checking session...'),

  signup: (payload: {
    id?: string;
    name: string;
    username: string;
    email: string;
    password: string;
    phone?: string;
  }) =>
    request<AuthSignUpResponse>(
      '/api/auth/signup',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      'Creating office account...'
    ),

  resendConfirmation: (email: string) =>
    request<AuthResendResponse>(
      '/api/auth/resend-confirmation',
      {
        method: 'POST',
        body: JSON.stringify({ email }),
      },
      'Sending confirmation email...'
    ),

  changeEmail: (email: string) =>
    request<AuthChangeEmailResponse>(
      '/api/auth/change-email',
      {
        method: 'POST',
        body: JSON.stringify({ email }),
      },
      'Updating email & sending verification...'
    ),

  forgotPassword: (identifier: string) =>
    request<AuthForgotPasswordResponse>(
      '/api/auth/forgot-password',
      {
        method: 'POST',
        body: JSON.stringify({ identifier }),
      },
      'Sending password reset link...'
    ),

  resetPassword: (payload: {
    code?: string;
    tokenHash?: string;
    accessToken?: string;
    previewToken?: string;
    newPassword: string;
  }) =>
    request<AuthResetPasswordResponse>(
      '/api/auth/reset-password',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      'Updating password...'
    ),

  confirmEmail: (payload: {
    code?: string;
    tokenHash?: string;
    type?: string;
    accessToken?: string;
    previewToken?: string;
  }) =>
    request<AuthConfirmResponse>(
      '/api/auth/confirm',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      'Verifying email...'
    ),

  login: (username: string, password: string, rememberMe = false) =>
    request<AuthSessionResponse>(
      '/api/auth/login',
      {
        method: 'POST',
        body: JSON.stringify({ username, password, rememberMe }),
      },
      'Signing in...'
    ),

  restoreSession: () =>
    request<AuthRestoreResponse>(
      '/api/auth/restore',
      {},
      'Restoring session...'
    ),

  logout: () =>
    request<{ signedOut: boolean }>(
      '/api/auth/logout',
      { method: 'POST' },
      'Signing out...'
    ),

  me: () => request<AuthMeResponse>('/api/auth/me', {}, 'Verifying account status...'),

  updateOwnProfile: (payload: {
    name?: string;
    email?: string | null;
    phone?: string | null;
    display_picture_url?: string | null;
  }) =>
    request<AuthProfileUpdateResponse>(
      '/api/auth/profile',
      {
        method: 'PUT',
        body: JSON.stringify(payload),
      },
      'Updating profile...'
    ),

  uploadOwnAvatar: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return request<{ url: string; fileName: string }>(
      '/api/auth/profile/upload',
      {
        method: 'POST',
        body: formData,
      },
      'Uploading profile image...'
    );
  },

  dashboardSummary: () =>
    request<DashboardSummary>('/api/dashboard/summary', {}, 'Loading dashboard...'),

  listRecords: <T extends AnyEntityRecord = AnyEntityRecord>(
    entity: EntityKey,
    options?: { lookup?: boolean }
  ) =>
    request<{ records: T[] }>(
      `/api/records/${entity}${options?.lookup ? '?lookup=1' : ''}`,
      {},
      'Loading records...'
    ),

  getRecord: <T extends AnyEntityRecord = AnyEntityRecord>(
    entity: EntityKey,
    id: string
  ) =>
    request<{ record: T; attachments?: AnyEntityRecord[] }>(
      `/api/records/${entity}/${encodeURIComponent(id)}`,
      {},
      'Loading details...'
    ),

  createRecord: <T extends AnyEntityRecord = AnyEntityRecord>(
    entity: EntityKey,
    payload: Record<string, unknown>
  ) =>
    request<{ record: T; attachments?: AnyEntityRecord[]; ledgerRcrdId?: string | null }>(
      `/api/records/${entity}`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      'Saving record...'
    ),

  updateRecord: <T extends AnyEntityRecord = AnyEntityRecord>(
    entity: EntityKey,
    id: string,
    payload: Record<string, unknown>
  ) =>
    request<{ record: T; attachments?: AnyEntityRecord[] }>(
      `/api/records/${entity}/${encodeURIComponent(id)}`,
      {
        method: 'PUT',
        body: JSON.stringify(payload),
      },
      'Updating record...'
    ),

  deleteRecord: (entity: EntityKey, id: string) =>
    request<{ deleted: boolean; id: string }>(
      `/api/records/${entity}/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
      'Deleting record...'
    ),

  uploadRecordAsset: (entity: EntityKey, file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return request<{ url: string; fileName: string }>(
      `/api/records/${entity}/upload`,
      {
        method: 'POST',
        body: formData,
      },
      'Uploading file...'
    );
  },

  uploadRecordZip: (entity: EntityKey, file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return request<{ urls: string[]; fileNames: string[] }>(
      `/api/records/${entity}/upload-zip`,
      {
        method: 'POST',
        body: formData,
      },
      'Extracting & uploading ZIP images...'
    );
  },

  exportCsv: async (entity: EntityKey): Promise<string> => {
    const headers = new Headers({ 'X-Requested-With': 'LimbahinClient' });
    if (inMemoryToken) {
      headers.set('Authorization', `Bearer ${inMemoryToken}`);
    }
    for (const listener of apiListeners) {
      listener.onStart?.('Exporting existing CSV...');
    }
    try {
      const response = await fetch(`/api/records/${entity}/export-csv`, {
        method: 'GET',
        headers,
        credentials: 'include',
      });
      if (!response.ok) {
        let message = `Export failed (${response.status})`;
        try {
          const errJson = (await response.json()) as { error?: string };
          if (errJson?.error) message = errJson.error;
        } catch {
          // ignore
        }
        const apiErr = new ApiError(message, response.status);
        for (const listener of apiListeners) {
          listener.onError?.(apiErr);
        }
        throw apiErr;
      }
      return await response.text();
    } catch (err) {
      if (!(err instanceof ApiError)) {
        const netErr =
          err instanceof Error ? err : new Error('Failed to export CSV.');
        for (const listener of apiListeners) {
          listener.onError?.(netErr);
        }
        throw netErr;
      }
      throw err;
    } finally {
      for (const listener of apiListeners) {
        listener.onEnd?.();
      }
    }
  },

  importCsv: (
    entity: EntityKey,
    payload: {
      mode: CsvImportMode;
      csvText?: string;
      csvFile?: File | null;
      zipFile?: File | null;
      excelRowOffset?: number;
    }
  ) => {
    const formData = new FormData();
    formData.append('mode', payload.mode);
    if (payload.excelRowOffset && payload.excelRowOffset > 0) {
      formData.append('excelRowOffset', String(payload.excelRowOffset));
    }
    if (payload.csvFile) {
      formData.append('csvFile', payload.csvFile);
    } else if (payload.csvText) {
      formData.append('csv', payload.csvText);
    }
    if (payload.zipFile) {
      formData.append('zipFile', payload.zipFile);
    }
    return request<CsvImportResult>(
      `/api/records/${entity}/import-csv`,
      {
        method: 'POST',
        body: formData,
      },
      payload.zipFile
        ? 'Uploading ZIP files & importing CSV...'
        : payload.mode === 'update'
          ? 'Updating records from CSV...'
          : 'Importing CSV...'
    );
  },

  bulkSaveSheet: (
    entity: EntityKey,
    payload: {
      updates: Array<{ id: string; changes: Record<string, unknown> }>;
      creates: Array<{ tempKey: string; data: Record<string, unknown> }>;
      deletes: string[];
    }
  ) =>
    request<{
      createdCount: number;
      updatedCount: number;
      deletedCount: number;
      logCreateId: string | null;
      logUpdateId: string | null;
      errors: Array<{ rowKey: string; error: string }>;
    }>(
      `/api/records/${entity}/bulk-save`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      'Saving sheet changes...'
    ),

  cancelInvoice: (
    invoiceId: string,
    payload: {
      cancelDate: string;
      reason: string;
      autoReverse: boolean;
      arCode?: string;
      revCode?: string;
      taxCode?: string;
    }
  ) =>
    request<CancelInvoiceResponse>(
      `/api/invoices/${encodeURIComponent(invoiceId)}/cancel`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      payload.autoReverse
        ? 'Canceling invoice & posting reversal...'
        : 'Canceling invoice...'
    ),

  listCompanies: () =>
    request<{ companies: CompanyRecord[] }>(
      '/api/accounting/companies',
      {},
      'Loading companies...'
    ),

  createCompany: (name: string) =>
    request<{ company: CompanyRecord }>(
      '/api/accounting/companies',
      {
        method: 'POST',
        body: JSON.stringify({ name }),
      },
      'Creating company...'
    ),

  listChartOfAccounts: (companyId?: string) =>
    request<{ accounts: ChartOfAccountRecord[] }>(
      `/api/accounting/coa${companyId ? `?companyId=${encodeURIComponent(companyId)}` : ''}`,
      {},
      'Loading Chart of Accounts...'
    ),

  createChartOfAccount: (payload: {
    company_id?: string;
    code: string;
    name: string;
    category: CoaCategory;
    normal_balance?: CoaNormalBalance;
    statement?: CoaStatement;
  }) =>
    request<{ account: ChartOfAccountRecord }>(
      '/api/accounting/coa',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      'Creating account...'
    ),

  updateChartOfAccount: (
    id: string,
    payload: {
      code?: string;
      name?: string;
      category?: CoaCategory;
      normal_balance?: CoaNormalBalance;
      statement?: CoaStatement;
    }
  ) =>
    request<{ account: ChartOfAccountRecord }>(
      `/api/accounting/coa/${encodeURIComponent(id)}`,
      {
        method: 'PUT',
        body: JSON.stringify(payload),
      },
      'Updating account...'
    ),

  deleteChartOfAccount: (id: string) =>
    request<{ deleted: boolean; id: string }>(
      `/api/accounting/coa/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
      'Deleting account...'
    ),

  listUnpaidActiveInvoices: (companyId?: string) =>
    request<{ invoices: UnpaidInvoiceSummary[] }>(
      `/api/accounting/unpaid-invoices${companyId ? `?companyId=${encodeURIComponent(companyId)}` : ''}`,
      {},
      'Loading unpaid invoices...'
    ),

  listLedgerRecords: (companyId?: string) =>
    request<{ records: TransactionRecord[] }>(
      `/api/accounting/records${companyId ? `?companyId=${encodeURIComponent(companyId)}` : ''}`,
      {},
      'Loading ledger records...'
    ),

  createLedgerRecord: (payload: {
    company_id?: string;
    source_type?:
      | 'MANUAL'
      | 'BCA1'
      | 'SYSTEM'
      | 'ADJUSTMENT'
      | 'SYSTEM_AUTO'
      | 'CSV_IMPORT'
      | 'REVERSAL';
    bank_account_id?: string | null;
    transaction_date: string;
    transaction_description: string;
    transaction_amount?: number;
    transaction_note?: string | null;
    lines: Array<{
      type: LedgerEntryType;
      account_id: string;
      amount: number;
      reference_model?: string | null;
      reference_model_id?: string | null;
    }>;
  }) =>
    request<{ record: TransactionRecord }>(
      '/api/accounting/records',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      'Saving transaction record...'
    ),

  updateLedgerRecord: (
    id: string,
    payload: {
      company_id?: string;
      source_type?:
        | 'MANUAL'
        | 'BCA1'
        | 'SYSTEM'
        | 'ADJUSTMENT'
        | 'SYSTEM_AUTO'
        | 'CSV_IMPORT'
        | 'REVERSAL';
      bank_account_id?: string | null;
      transaction_date: string;
      transaction_description: string;
      transaction_amount?: number;
      transaction_note?: string | null;
      lines: Array<{
        type: LedgerEntryType;
        account_id: string;
        amount: number;
        reference_model?: string | null;
        reference_model_id?: string | null;
      }>;
    }
  ) =>
    request<{ record: TransactionRecord }>(
      `/api/accounting/records/${encodeURIComponent(id)}`,
      {
        method: 'PUT',
        body: JSON.stringify(payload),
      },
      'Updating transaction record...'
    ),

  deleteLedgerRecord: (id: string) =>
    request<{ deleted: boolean; id: string }>(
      `/api/accounting/records/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
      'Deleting transaction record...'
    ),

  exportLedgerCsv: async (companyId?: string): Promise<string> => {
    const headers = new Headers({ 'X-Requested-With': 'LimbahinClient' });
    if (inMemoryToken) {
      headers.set('Authorization', `Bearer ${inMemoryToken}`);
    }
    for (const listener of apiListeners) {
      listener.onStart?.('Exporting ledger CSV...');
    }
    try {
      const response = await fetch(
        `/api/accounting/records/export-csv${companyId ? `?companyId=${encodeURIComponent(companyId)}` : ''}`,
        { method: 'GET', headers, credentials: 'include' }
      );
      if (!response.ok) {
        let message = `Export failed (${response.status})`;
        try {
          const errJson = (await response.json()) as { error?: string };
          if (errJson?.error) message = errJson.error;
        } catch {
          // ignore
        }
        const apiErr = new ApiError(message, response.status);
        for (const listener of apiListeners) {
          listener.onError?.(apiErr);
        }
        throw apiErr;
      }
      return await response.text();
    } finally {
      for (const listener of apiListeners) {
        listener.onEnd?.();
      }
    }
  },

  importLedgerCsv: (payload: {
    companyId?: string;
    mode?: CsvImportMode;
    csvText?: string;
    csvFile?: File | null;
    allowDrafts?: boolean;
    excelRowOffset?: number;
  }) => {
    const formData = new FormData();
    if (payload.companyId) formData.append('companyId', payload.companyId);
    formData.append('mode', payload.mode || 'insert');
    if (payload.allowDrafts !== undefined) {
      formData.append('allowDrafts', String(payload.allowDrafts));
    }
    if (payload.excelRowOffset && payload.excelRowOffset > 0) {
      formData.append('excelRowOffset', String(payload.excelRowOffset));
    }
    if (payload.csvFile) {
      formData.append('csvFile', payload.csvFile);
    } else if (payload.csvText) {
      formData.append('csv', payload.csvText);
    }
    return request<LedgerCsvImportResult>(
      '/api/accounting/records/import-csv',
      {
        method: 'POST',
        body: formData,
      },
      'Processing Single-CSV ledger batch...'
    );
  },

  getFinancialStatements: (params?: {
    companyId?: string;
    startDate?: string;
    endDate?: string;
  }) => {
    const search = new URLSearchParams();
    if (params?.companyId) search.set('companyId', params.companyId);
    if (params?.startDate) search.set('startDate', params.startDate);
    if (params?.endDate) search.set('endDate', params.endDate);
    const qs = search.toString();
    return request<FinancialStatementsResponse>(
      `/api/accounting/statements${qs ? `?${qs}` : ''}`,
      {},
      'Generating financial statements...'
    );
  },
};

export function formatIDR(value: number | string | null | undefined): string {
  const num = Number(value ?? 0);
  if (!Number.isFinite(num)) return 'Rp 0';
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(num);
}

export function formatWeight(value: number | string | null | undefined): string {
  const num = Number(value ?? 0);
  if (!Number.isFinite(num)) return '0 kg';
  return `${new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 }).format(num)} kg`;
}

export function formatStatusLabel(status: string): string {
  return status
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

export function statusTextClass(status: string): string {
  switch (status.toLowerCase()) {
    case 'active':
    case 'paid':
    case 'completed':
    case 'signed':
    case 'verified':
    case 'fulfilled':
    case 'issued':
    case 'manifested':
    case 'approved':
    case 'tersimpan':
    case 'hari ini':
      return 'text-teal-700 font-medium';
    case 'overdue':
    case 'cancelled':
    case 'canceled':
    case 'cancel':
    case 'dihapus':
    case 'inactive':
      return 'text-red-700 font-medium';
    case 'unpaid':
    case 'pending':
    case 'partial':
    case 'in_progress':
    case 'scheduled':
    case 'processing':
    case 'open':
    case 'terubah':
    case 'sedang diubah':
    case 'minggu ini':
    case 'reschedule':
    case 'upcoming':
      return 'text-amber-700 font-medium';
    default:
      return 'text-slate-600 font-medium';
  }
}
