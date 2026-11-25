export type WorkerRole = 'master' | 'marketing' | 'admin' | 'worker';

export type OperationalMode = 'limbah_b3' | 'domestik';

export type EntityKey =
  | 'workers'
  | 'customers'
  | 'branches'
  | 'requests'
  | 'items'
  | 'schedules'
  | 'pickup_data'
  | 'purchase_orders'
  | 'berita_acara'
  | 'invoices'
  | 'certificates'
  | 'fpl_real'
  | 'fpl_doc'
  | 'commissions'
  | 'logs';

export type DocumentEntityKey =
  | 'purchase_orders'
  | 'berita_acara'
  | 'invoices'
  | 'certificates'
  | 'fpl_real'
  | 'fpl_doc';

export type LimbahDataType =
  | 'LB3 Pickup'
  | 'LB3 Pickup Details'
  | 'LB3 Data'
  | 'Logistik'
  | 'pickup'
  | 'service'
  | 'transport'
  | 'admin'
  | 'other';

export type DocumentStatus =
  | 'Draft'
  | 'Tersimpan'
  | 'Terubah'
  | 'Cancel'
  | 'Sedang Diubah'
  | 'Dihapus';

export interface DocumentAdjustment {
  id: string;
  label: string;
  type: 'percent' | 'fixed';
  value: number; // e.g., 11 for +11% VAT, -2 for -2% PPh 23, or fixed IDR amount
  amount: number; // computed IDR delta (+/-)
}

export interface BaseRecord {
  id: string;
  id_log_create?: string | null;
  id_log_update?: string | null;
  created_by?: string | null;
  created_at: string;
}

export interface LogFieldDiff {
  old: unknown;
  new: unknown;
}

export interface LogChangeEntry {
  record_id: string;
  action: 'create' | 'update';
  id_previous_logs?: string | null;
  changes: Record<string, LogFieldDiff>;
}

export interface LogRecord extends BaseRecord {
  id_previous_logs: string | null;
  id_changed_by: string | null;
  model_name: string;
  timestamp_created_at: string;
  changes_json: LogChangeEntry[];
}

export type WorkerStatus = 'active' | 'inactive';

export interface WorkerRecord extends BaseRecord {
  name: string;
  username: string;
  email: string | null;
  phone: string | null;
  role: WorkerRole;
  status: WorkerStatus;
  display_picture_url: string | null;
}

// client_model - USR
export interface CustomerRecord extends BaseRecord {
  name: string;
  username: string | null;
  email: string | null;
  // Legacy optional compatibility fields
  tax_id?: string | null;
  industry?: string | null;
  pic_name?: string | null;
  phone?: string | null;
  address?: string | null;
  marketing_id?: string | null;
  status?: 'active' | 'inactive' | 'pending';
}

// limbahin_branch_model - CUST
export interface BranchRecord extends BaseRecord {
  id_client: string;
  branch_name: string;
  name_in_document: string;
  npwp: string | null;
  id_alamat_address_document: string | null;
  id_alamat_address_limbah: string | null;
  penanggung_jawab_utama_nama: string | null;
  penanggung_jawab_utama_jabatan: string | null;
  pic_operasional_nama: string | null;
  pic_operasional_telfonwa: string | null;
  pic_keuangan_nama: string | null;
  pic_keuangan_telfonwa: string | null;
  // Legacy optional aliases synced automatically
  client_id?: string;
  name?: string;
  city?: string | null;
  address?: string | null;
  pic_name?: string | null;
  pic_phone?: string | null;
}

// request_model - REQ
export interface RequestRecord extends BaseRecord {
  request_type: string;
  catatan: string | null;
  solution: string | null;
  id_user: string;
  id_creator: string;
}

// item_model - ITM
export interface ItemRecord extends BaseRecord {
  item_code: string;
  title: string;
  description: string | null;
  kemasan?: string | null;
  item_note: string | null;
  list_url_image: string[];
  // Legacy aliases kept optional for backward compatibility
  code?: string | null;
  name?: string | null;
  hazard_category?: 'Category 1' | 'Category 2' | null;
  unit?: string | null;
  unit_price?: number | null;
  notes?: string | null;
}

// schedule_model - LMBHN-SCHD-ITEM
export interface ScheduleRecord extends BaseRecord {
  vehicle_number: string | null;
  id_branch: string | null;
  order_index: number;
  schedule_note: string | null;
  schedule_reschedule_problem: string | null;
  reschedule_id: string | null;
  scheduled_date?: string | null;
  status?:
    | 'Upcoming'
    | 'Minggu ini'
    | 'Hari ini'
    | 'Reschedule'
    | 'scheduled'
    | 'in_progress'
    | 'completed'
    | 'cancelled'
    | 'rescheduled';
  // Legacy compatibility fields
  client_id?: string | null;
  branch_id?: string | null;
  assigned_worker_id?: string | null;
  item_ids?: string[];
  vehicle_plate?: string | null;
  notes?: string | null;
}

// data_model - DATA (Limbah Data Model)
export interface PickupDataRecord extends BaseRecord {
  data: string | null;
  id_user_model: string;
  id_item_model: string;
  data_type: LimbahDataType;
  jenis_pelayanan?: string | null;
  jenis_manifest?: string | null;
  kemasan?: string | null;
  reference_number: string | null;
  manifest_number: string | null;
  quantity: number;
  unit: string;
  invoice_price: number;
  fpl_price: number;
  final_item_note: string | null;
  internal_note: string | null; // ERP-only, never rendered in documents
  fpl_doc_id: string | null;
  fpl_real_id: string | null;
  ba_id: string | null;
  inv_id: string | null;
  po_id?: string | null;
  // Legacy compatibility fields
  schedule_id?: string | null;
  client_id?: string | null;
  branch_id?: string | null;
  item_id?: string | null;
  worker_id?: string | null;
  weight_kg?: number | null;
  container_count?: number | null;
  pickup_date?: string | null;
  status?: 'recorded' | 'verified' | 'manifested' | null;
  notes?: string | null;
}

export interface PurchaseOrderRecord extends BaseRecord {
  id_user_model: string;
  po_number: string | null;
  note: string | null;
  date_period: string;
  subtotal_amount: number;
  adjustments: DocumentAdjustment[];
  total_amount: number;
  status: DocumentStatus | 'draft' | 'open' | 'fulfilled' | 'cancelled';
  // Legacy compatibility
  client_id?: string;
  branch_id?: string | null;
  item_ids?: string[];
  issue_date?: string;
}

// berita_acara_model - LMBHN-BA
export interface BeritaAcaraRecord extends BaseRecord {
  id_user_model: string;
  note: string | null;
  date_period: string;
  id_certificate: string | null;
  status: DocumentStatus | 'draft' | 'signed' | 'archived';
  // Legacy compatibility
  pickup_id?: string | null;
  client_id?: string;
  branch_id?: string | null;
  ba_date?: string;
  signed_by_client?: string | null;
  signed_by_officer?: string | null;
  total_weight_kg?: number | null;
}

// invoice_document_model - INV
export interface InvoiceRecord extends BaseRecord {
  company_id?: string | null;
  invoice_number?: string | null;
  jenis_invoice?: string | null;
  id_user_model: string;
  note: string | null;
  date_period: string;
  subtotal_amount: number;
  adjustments: DocumentAdjustment[];
  tax_amount: number;
  total_amount: number;
  amount: number;
  id_user_comission: string | null;
  comission_amount: number;
  // Legacy & accounting compatibility fields
  client_id: string;
  po_id?: string | null;
  ba_id?: string | null;
  issue_date: string;
  due_date: string;
  commission_user_id?: string | null;
  commission_amount?: number;
  is_canceled?: boolean;
  canceled_at?: string | null;
  cancel_reason?: string | null;
  status:
    | DocumentStatus
    | 'unpaid'
    | 'overdue'
    | 'partial'
    | 'paid'
    | 'canceled';
}

// certificate_model - LMBHN-CERT
export interface CertificateRecord extends BaseRecord {
  id_user_model: string;
  note: string | null;
  date_period: string;
  status: DocumentStatus | 'processing' | 'issued' | 'verified';
  // Legacy compatibility
  client_id?: string;
  ba_id?: string | null;
  manifest_code?: string | null;
  treatment_method?: string | null;
  issued_date?: string;
  valid_until?: string | null;
}

// fpl_real_model - LMBHN-FPLREAL
export interface FplRealRecord extends BaseRecord {
  id_user_model: string;
  note: string | null;
  date_period: string;
  subtotal_amount: number;
  adjustments: DocumentAdjustment[];
  total_amount: number;
  status?: DocumentStatus | string | null;
}

// fpl_doc_model - LMBHN-FPLDOC
export interface FplDocRecord extends BaseRecord {
  id_user_model: string;
  note: string | null;
  date_period: string;
  subtotal_amount: number;
  adjustments: DocumentAdjustment[];
  total_amount: number;
  status?: DocumentStatus | string | null;
}

export interface CommissionRecord extends BaseRecord {
  marketing_id: string;
  client_id: string;
  invoice_id: string | null;
  period: string;
  rate_percent: number;
  commission_amount: number;
  status: 'pending' | 'approved' | 'paid';
}

export type AnyEntityRecord =
  | WorkerRecord
  | CustomerRecord
  | BranchRecord
  | RequestRecord
  | ItemRecord
  | ScheduleRecord
  | PickupDataRecord
  | PurchaseOrderRecord
  | BeritaAcaraRecord
  | InvoiceRecord
  | CertificateRecord
  | FplRealRecord
  | FplDocRecord
  | CommissionRecord
  | LogRecord;

export type CsvImportMode = 'insert' | 'update';

export interface CsvImportResult {
  mode: CsvImportMode;
  createdCount: number;
  updatedCount: number;
  errorCount: number;
  ledgerPostedCount?: number;
  logCreateId?: string | null;
  logUpdateId?: string | null;
  created: AnyEntityRecord[];
  updated: AnyEntityRecord[];
  errors: Array<{ row: number; error: string }>;
}

export interface DashboardSummary {
  kpis: {
    totalClients: number;
    totalPickupsKg: number;
    unpaidInvoicesAmount: number;
    unpaidInvoicesCount: number;
    paidRevenueAmount: number;
    activeSchedulesCount: number;
    issuedCertificatesCount: number;
  };
  monthlyVolume: Array<{
    month: string;
    weightKg: number;
    revenueM: number;
  }>;
  hazardBreakdown: Array<{
    category: string;
    weightKg: number;
  }>;
  unpaidInvoices: InvoiceRecord[];
  upcomingSchedules: ScheduleRecord[];
}

export type AccountLockReason = 'email_not_confirmed' | 'account_inactive' | null;

export interface AuthStatusResponse {
  hasMaster: boolean;
  supabaseConfigured: boolean;
}

export interface AuthSessionResponse {
  token: string;
  worker: WorkerRecord;
  emailConfirmed: boolean;
  lockReason: AccountLockReason;
  requiresReloginAfterUnlock?: boolean;
  previewConfirmToken?: string;
  resendCooldownSeconds?: number;
}

export interface AuthMeResponse {
  worker: WorkerRecord;
  emailConfirmed: boolean;
  lockReason: AccountLockReason;
  requiresReloginAfterUnlock?: boolean;
  resendCooldownSeconds?: number;
}

export interface AuthSignUpResponse {
  requiresEmailConfirmation: true;
  email: string;
  worker: WorkerRecord;
  token: string;
  emailConfirmed: boolean;
  lockReason: AccountLockReason;
  requiresReloginAfterUnlock?: boolean;
  message: string;
  previewConfirmToken?: string;
  resendCooldownSeconds?: number;
}

export interface AuthResendResponse {
  message: string;
  cooldownSeconds: number;
  alreadyConfirmed?: boolean;
}

export interface AuthChangeEmailResponse {
  worker: WorkerRecord;
  email: string;
  emailSent: boolean;
  cooldownSeconds: number;
  message: string;
  previewConfirmToken?: string;
}

export interface AuthForgotPasswordResponse {
  message: string;
  cooldownSeconds: number;
  previewResetToken?: string;
}

export interface AuthResetPasswordResponse {
  message: string;
}

export interface AuthConfirmResponse {
  confirmed: boolean;
  message: string;
  accountInactive?: boolean;
  workerId?: string;
  token?: string;
  worker?: WorkerRecord;
  emailConfirmed?: boolean;
  lockReason?: AccountLockReason;
}

export interface AuthRestoreResponse {
  authenticated: boolean;
  token?: string;
  worker?: WorkerRecord;
  emailConfirmed?: boolean;
  lockReason?: AccountLockReason;
  requiresReloginAfterUnlock?: boolean;
  resendCooldownSeconds?: number;
}

export interface AuthProfileUpdateResponse {
  worker: WorkerRecord;
  emailChanged: boolean;
  requiresEmailConfirmation: boolean;
  token?: string;
  lockReason?: AccountLockReason;
  requiresReloginAfterUnlock?: boolean;
  resendCooldownSeconds?: number;
  previewConfirmToken?: string;
  message: string;
}

// ============================================================================
// Multi-Tenant Accounting & Ledger Blueprint Types
// ============================================================================
export type CoaCategory = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';

export type CoaNormalBalance = 'Debit' | 'Credit';

export type CoaStatement = 'BS' | 'IS';

export type RcrdSourceType =
  | 'MANUAL'
  | 'BCA1'
  | 'SYSTEM'
  | 'ADJUSTMENT'
  | 'SYSTEM_AUTO'
  | 'CSV_IMPORT'
  | 'REVERSAL';

export type LedgerEntryType = 'DEBIT' | 'CREDIT';

export type TransactionLabelStatus = 'labeled' | 'unlabeled' | 'not_equal';

export interface CompanyRecord {
  id: string;
  name: string;
  created_at: string;
}

export interface ChartOfAccountRecord {
  id: string;
  company_id: string;
  code: string;
  name: string;
  category: CoaCategory;
  normal_balance: CoaNormalBalance;
  statement: CoaStatement;
  id_log_create?: string | null;
  id_log_update?: string | null;
  created_by?: string | null;
  created_at: string;
}

export interface TransactionLineRecord {
  id: string;
  id_transaction_record: string;
  type: LedgerEntryType;
  account_id: string;
  account_code?: string;
  account_name?: string;
  account_category?: CoaCategory;
  amount: number;
  reference_model: string | null;
  reference_model_id: string | null;
  reference_label?: string | null;
}

export interface TransactionRecord {
  id: string;
  company_id: string;
  source_type: RcrdSourceType;
  account_type?: string | null;
  bank_account_id: string | null;
  bank_code?: string | null;
  bank_name?: string | null;
  transaction_date: string;
  transaction_description: string | null;
  transaction_amount: number;
  transaction_note: string | null;
  total_debit: number;
  total_credit: number;
  balance_diff: number;
  label_status: TransactionLabelStatus;
  id_log_create?: string | null;
  id_log_update?: string | null;
  created_by?: string | null;
  created_at: string;
  lines: TransactionLineRecord[];
}

export interface UnpaidInvoiceSummary {
  id: string;
  company_id: string | null;
  invoice_number: string;
  client_id: string;
  client_name: string;
  issue_date: string;
  due_date: string;
  subtotal_amount: number;
  tax_amount: number;
  total_amount: number;
  paid_amount: number;
  remaining_balance: number;
  status: string;
  is_canceled: boolean;
}

export interface CancelInvoiceResponse {
  invoice: InvoiceRecord;
  reversalRcrdId: string | null;
  autoReversed: boolean;
  message: string;
}

export interface LedgerCsvImportResult {
  batchTag: string;
  groupsProcessed: number;
  createdCount: number;
  updatedCount: number;
  linesInserted: number;
  labeledCount?: number;
  unlabeledCount?: number;
  notEqualCount?: number;
  logCreateId?: string | null;
  logUpdateId?: string | null;
  errorCount: number;
  errors: Array<{ group: string; error: string }>;
}

// ============================================================================
// Auto-Generated Financial Statements (IS, BS, Cash Flow)
// ============================================================================
export interface FinancialStatementLine {
  account_id: string;
  code: string;
  name: string;
  category: CoaCategory;
  normal_balance: CoaNormalBalance;
  statement: CoaStatement;
  debit_total: number;
  credit_total: number;
  amount: number;
}

export interface IncomeStatementReport {
  revenue: FinancialStatementLine[];
  totalRevenue: number;
  directCosts: FinancialStatementLine[];
  totalDirectCosts: number;
  grossProfit: number;
  operatingExpenses: FinancialStatementLine[];
  totalOperatingExpenses: number;
  netIncome: number;
  grossMarginPercent: number;
  netMarginPercent: number;
}

export interface BalanceSheetReport {
  currentAssets: FinancialStatementLine[];
  totalCurrentAssets: number;
  fixedAssets: FinancialStatementLine[];
  totalFixedAssets: number;
  totalAssets: number;
  currentLiabilities: FinancialStatementLine[];
  totalCurrentLiabilities: number;
  nonCurrentLiabilities: FinancialStatementLine[];
  totalNonCurrentLiabilities: number;
  totalLiabilities: number;
  equityAccounts: FinancialStatementLine[];
  currentPeriodEarnings: number;
  totalEquity: number;
  totalLiabilitiesAndEquity: number;
  balanceDiscrepancy: number;
  isBalanced: boolean;
}

export interface CashFlowActivityLine {
  account_id: string;
  code: string;
  name: string;
  amount: number;
  txCount: number;
}

export interface CashFlowReport {
  beginningCash: number;
  operating: CashFlowActivityLine[];
  netOperatingCash: number;
  investing: CashFlowActivityLine[];
  netInvestingCash: number;
  financing: CashFlowActivityLine[];
  netFinancingCash: number;
  netChangeInCash: number;
  endingCash: number;
  balanceSheetCash: number;
  cashDiscrepancy: number;
  isReconciled: boolean;
}

export interface FinancialStatementsResponse {
  company: CompanyRecord;
  period: {
    startDate: string;
    endDate: string;
  };
  generatedAt: string;
  integrity: {
    totalRecordsInPeriod: number;
    labeledRecordsInPeriod: number;
    unlabeledCountInPeriod: number;
    notEqualCountInPeriod: number;
    totalRecordsAsOfEnd: number;
    labeledRecordsAsOfEnd: number;
    unlabeledCountAsOfEnd: number;
    notEqualCountAsOfEnd: number;
  };
  incomeStatement: IncomeStatementReport;
  balanceSheet: BalanceSheetReport;
  cashFlow: CashFlowReport;
}
