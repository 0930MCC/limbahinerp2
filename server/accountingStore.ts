import crypto from 'node:crypto';
import type {
  BalanceSheetReport,
  CancelInvoiceResponse,
  CashFlowActivityLine,
  CashFlowReport,
  ChartOfAccountRecord,
  CoaCategory,
  CoaNormalBalance,
  CoaStatement,
  CompanyRecord,
  CustomerRecord,
  FinancialStatementLine,
  FinancialStatementsResponse,
  IncomeStatementReport,
  InvoiceRecord,
  LedgerCsvImportResult,
  LedgerEntryType,
  RcrdSourceType,
  TransactionLabelStatus,
  TransactionLineRecord,
  TransactionRecord,
  UnpaidInvoiceSummary,
  WorkerRecord,
} from '../src/shared/types.ts';
import {
  createAuditLog,
  enhanceSchemaMigrationError,
  getRecordById,
  getSupabaseAdmin,
  isSupabaseConfigured,
  listAllRecords,
  localDb,
} from './store.ts';

import {
  isCanceledStatus,
  normalizeRcrdSourceType,
} from '../src/shared/appOptions.ts';

interface StoredRcrd {
  id: string;
  company_id: string;
  source_type: RcrdSourceType;
  bank_account_id: string | null;
  transaction_date: string;
  transaction_description: string | null;
  transaction_amount: number;
  transaction_note: string | null;
  id_log_create?: string | null;
  id_log_update?: string | null;
  created_by?: string | null;
  created_at: string;
}

interface StoredRcrdLine {
  id: string;
  id_transaction_record: string;
  type: LedgerEntryType;
  account_id: string;
  amount: number;
  reference_model: string | null;
  reference_model_id: string | null;
}

const DEFAULT_COMPANY_ID = 'COMP-MCC-001';
const DEFAULT_COMPANY_NAME = 'PT. Media Cahaya Cerah';

const DEFAULT_AR_CODE = 'COA-1110';
const DEFAULT_REV_CODE = 'COA-4010';
const DEFAULT_TAX_CODE = 'COA-2110';

const STANDARD_COA_TEMPLATES: Array<{
  code: string;
  name: string;
  category: CoaCategory;
  normal_balance: CoaNormalBalance;
  statement: CoaStatement;
}> = [
  { code: 'COA-1010', name: 'Cash in Bank', category: 'ASSET', normal_balance: 'Debit', statement: 'BS' },
  { code: 'COA-1020', name: 'Petty Cash', category: 'ASSET', normal_balance: 'Debit', statement: 'BS' },
  { code: 'COA-1110', name: 'Accounts Receivable', category: 'ASSET', normal_balance: 'Debit', statement: 'BS' },
  { code: 'COA-1120', name: 'Allowance for Doubtful Accounts', category: 'ASSET', normal_balance: 'Credit', statement: 'BS' },
  { code: 'COA-1130', name: 'Employee Receivable', category: 'ASSET', normal_balance: 'Debit', statement: 'BS' },
  { code: 'COA-1200', name: 'PPN Masukan (VAT Input)', category: 'ASSET', normal_balance: 'Debit', statement: 'BS' },
  { code: 'COA-1310', name: 'Transport Fleet', category: 'ASSET', normal_balance: 'Debit', statement: 'BS' },
  { code: 'COA-1320', name: 'Accumulated Depreciation – Fleet', category: 'ASSET', normal_balance: 'Credit', statement: 'BS' },
  { code: 'COA-1410', name: 'Employee Advances & Loans', category: 'ASSET', normal_balance: 'Debit', statement: 'BS' },
  { code: 'COA-2010', name: 'Accounts Payable', category: 'LIABILITY', normal_balance: 'Credit', statement: 'BS' },
  { code: 'COA-2020', name: 'Employee Payable', category: 'LIABILITY', normal_balance: 'Credit', statement: 'BS' },
  { code: 'COA-2110', name: 'PPN Keluaran (VAT Output)', category: 'LIABILITY', normal_balance: 'Credit', statement: 'BS' },
  { code: 'COA-2120', name: 'Tax Payable (PPh 21 / PPh 23)', category: 'LIABILITY', normal_balance: 'Credit', statement: 'BS' },
  { code: 'COA-2210', name: 'Bank Loans / Vehicle Financing', category: 'LIABILITY', normal_balance: 'Credit', statement: 'BS' },
  { code: 'COA-3010', name: "Owner's Capital", category: 'EQUITY', normal_balance: 'Credit', statement: 'BS' },
  { code: 'COA-3020', name: 'Retained Earnings', category: 'EQUITY', normal_balance: 'Credit', statement: 'BS' },
  { code: 'COA-3030', name: "Owner's Drawings / Prive", category: 'EQUITY', normal_balance: 'Debit', statement: 'BS' },
  { code: 'COA-4010', name: 'B3 Waste Transport Revenue', category: 'REVENUE', normal_balance: 'Credit', statement: 'IS' },
  { code: 'COA-4020', name: 'Non-Hazardous Waste Revenue', category: 'REVENUE', normal_balance: 'Credit', statement: 'IS' },
  { code: 'COA-4030', name: 'Sales Discounts', category: 'REVENUE', normal_balance: 'Debit', statement: 'IS' },
  { code: 'COA-5010', name: 'Fleet Fuel', category: 'EXPENSE', normal_balance: 'Debit', statement: 'IS' },
  { code: 'COA-5020', name: 'Vehicle Maintenance & Tolls', category: 'EXPENSE', normal_balance: 'Debit', statement: 'IS' },
  { code: 'COA-5030', name: 'Driver Wages & Allowances', category: 'EXPENSE', normal_balance: 'Debit', statement: 'IS' },
  { code: 'COA-5040', name: 'Waste Treatment Partner Fees', category: 'EXPENSE', normal_balance: 'Debit', statement: 'IS' },
  { code: 'COA-5050', name: 'Environmental Testing Costs', category: 'EXPENSE', normal_balance: 'Debit', statement: 'IS' },
  { code: 'COA-5060', name: 'Vehicle Depreciation Expense', category: 'EXPENSE', normal_balance: 'Debit', statement: 'IS' },
  { code: 'COA-6010', name: 'Office Salaries & Admin Expenses', category: 'EXPENSE', normal_balance: 'Debit', statement: 'IS' },
  { code: 'COA-6020', name: 'Sales Commission', category: 'EXPENSE', normal_balance: 'Debit', statement: 'IS' },
  { code: 'COA-6030', name: 'Google Ads & Marketing', category: 'EXPENSE', normal_balance: 'Debit', statement: 'IS' },
  { code: 'COA-6040', name: 'Cloud Infrastructure & Software', category: 'EXPENSE', normal_balance: 'Debit', statement: 'IS' },
  { code: 'COA-6050', name: 'Licensing & Legal Fees (KLHK/Kemenhub)', category: 'EXPENSE', normal_balance: 'Debit', statement: 'IS' },
  { code: 'COA-6060', name: 'Bad Debt Expense', category: 'EXPENSE', normal_balance: 'Debit', statement: 'IS' },
];

const VALID_COA_CATEGORIES = new Set<CoaCategory>([
  'ASSET',
  'LIABILITY',
  'EQUITY',
  'REVENUE',
  'EXPENSE',
]);

function defaultNormalBalance(category: CoaCategory): CoaNormalBalance {
  return category === 'ASSET' || category === 'EXPENSE' ? 'Debit' : 'Credit';
}

function defaultStatement(category: CoaCategory): CoaStatement {
  return category === 'REVENUE' || category === 'EXPENSE' ? 'IS' : 'BS';
}

function normalizeNormalBalance(
  val: unknown,
  category: CoaCategory
): CoaNormalBalance {
  const s = String(val || '').trim().toLowerCase();
  if (s === 'debit') return 'Debit';
  if (s === 'credit') return 'Credit';
  return defaultNormalBalance(category);
}

function normalizeStatement(val: unknown, category: CoaCategory): CoaStatement {
  const s = String(val || '').trim().toUpperCase();
  if (s === 'BS') return 'BS';
  if (s === 'IS') return 'IS';
  return defaultStatement(category);
}

// ============================================================================
// Local Preview Accounting Store (used when Supabase is not configured)
// ============================================================================
const localAccountingDb: {
  companies: CompanyRecord[];
  coa: ChartOfAccountRecord[];
  rcrd: StoredRcrd[];
  rcrd_clsf: StoredRcrdLine[];
} = {
  companies: [
    {
      id: DEFAULT_COMPANY_ID,
      name: DEFAULT_COMPANY_NAME,
      created_at: '2026-01-01T00:00:00.000Z',
    },
  ],
  coa: STANDARD_COA_TEMPLATES.map((t, idx) => ({
    id: t.code,
    company_id: DEFAULT_COMPANY_ID,
    code: t.code,
    name: t.name,
    category: t.category,
    normal_balance: t.normal_balance,
    statement: t.statement,
    id_log_create: 'LOGS-26-COA0',
    id_log_update: null,
    created_by: 'MCC-1001',
    created_at: `2026-01-01T00:${String(idx).padStart(2, '0')}:00.000Z`,
  })),
  rcrd: [
    {
      id: 'c8f10a10-2601-4a91-9b11-000000001000',
      company_id: DEFAULT_COMPANY_ID,
      source_type: 'MANUAL',
      bank_account_id: 'COA-1010',
      transaction_date: '2026-10-01',
      transaction_description: 'Initial Capital Injection – PT. Media Cahaya Cerah',
      transaction_amount: 250000000,
      transaction_note: 'Paid-in owner capital transfer to BCA Corporate',
      id_log_create: 'LOGS-26-RC00',
      id_log_update: null,
      created_by: 'MCC-1001',
      created_at: '2026-10-01T08:00:00.000Z',
    },
    {
      id: 'c8f10a10-2601-4a91-9b11-000000001005',
      company_id: DEFAULT_COMPANY_ID,
      source_type: 'MANUAL',
      bank_account_id: 'COA-1010',
      transaction_date: '2026-10-05',
      transaction_description: 'B3 Transport Truck Fleet Acquisition',
      transaction_amount: 120000000,
      transaction_note: 'Unit B-9421-MCC Hazmat Carrier Down Payment & Settlement',
      id_log_create: 'LOGS-26-RC05',
      id_log_update: null,
      created_by: 'MCC-1001',
      created_at: '2026-10-05T11:00:00.000Z',
    },
    {
      id: 'c8f10a10-2601-4a91-9b11-000000001001',
      company_id: DEFAULT_COMPANY_ID,
      source_type: 'SYSTEM',
      bank_account_id: null,
      transaction_date: '2026-11-11',
      transaction_description: 'Invoice INV-26-1001',
      transaction_amount: 15680000,
      transaction_note: 'Auto-posted from invoice billing (DPP + PPN 11%)',
      id_log_create: 'LOGS-26-RC01',
      id_log_update: null,
      created_by: 'MCC-1001',
      created_at: '2026-11-11T09:00:01.000Z',
    },
    {
      id: 'c8f10a10-2601-4a91-9b11-000000001002',
      company_id: DEFAULT_COMPANY_ID,
      source_type: 'SYSTEM',
      bank_account_id: null,
      transaction_date: '2026-10-15',
      transaction_description: 'Invoice INV-26-1002',
      transaction_amount: 24950000,
      transaction_note: 'Auto-posted from invoice billing (DPP + PPN 11%)',
      id_log_create: 'LOGS-26-RC02',
      id_log_update: null,
      created_by: 'MCC-A71DM',
      created_at: '2026-10-15T10:30:01.000Z',
    },
    {
      id: 'c8f10a10-2601-4a91-9b11-000000001003',
      company_id: DEFAULT_COMPANY_ID,
      source_type: 'SYSTEM',
      bank_account_id: null,
      transaction_date: '2026-10-20',
      transaction_description: 'Invoice INV-26-1003',
      transaction_amount: 38400000,
      transaction_note: 'Auto-posted from invoice billing (DPP + PPN 11%)',
      id_log_create: 'LOGS-26-RC03',
      id_log_update: null,
      created_by: 'MCC-1001',
      created_at: '2026-10-20T14:00:01.000Z',
    },
    {
      id: 'c8f10a10-2601-4a91-9b11-000000001004',
      company_id: DEFAULT_COMPANY_ID,
      source_type: 'BCA1',
      bank_account_id: null,
      transaction_date: '2026-10-28',
      transaction_description: 'Full Settlement PT. Karya Logam Presisi (INV-26-1003)',
      transaction_amount: 38400000,
      transaction_note: 'BCA Corporate Transfer Ref #TRF-88291',
      id_log_create: 'LOGS-26-RC04',
      id_log_update: null,
      created_by: 'MCC-1001',
      created_at: '2026-10-28T15:10:00.000Z',
    },
    {
      id: 'c8f10a10-2601-4a91-9b11-000000001006',
      company_id: DEFAULT_COMPANY_ID,
      source_type: 'MANUAL',
      bank_account_id: null,
      transaction_date: '2026-11-04',
      transaction_description: 'Fleet Fuel & Highway Tolls – Week 1',
      transaction_amount: 6500000,
      transaction_note: 'Pertamina Dex & e-Toll fleet settlement',
      id_log_create: 'LOGS-26-RC06',
      id_log_update: null,
      created_by: 'MCC-A71DM',
      created_at: '2026-11-04T16:20:00.000Z',
    },
    {
      id: 'c8f10a10-2601-4a91-9b11-000000001007',
      company_id: DEFAULT_COMPANY_ID,
      source_type: 'MANUAL',
      bank_account_id: null,
      transaction_date: '2026-11-08',
      transaction_description: 'Office Payroll & Cloud Infrastructure',
      transaction_amount: 14300000,
      transaction_note: 'November payroll & ERP cloud subscription',
      id_log_create: 'LOGS-26-RC07',
      id_log_update: null,
      created_by: 'MCC-1001',
      created_at: '2026-11-08T09:15:00.000Z',
    },
    {
      id: 'c8f10a10-2601-4a91-9b11-000000001008',
      company_id: DEFAULT_COMPANY_ID,
      source_type: 'BCA1',
      bank_account_id: null,
      transaction_date: '2026-11-18',
      transaction_description: 'Unclassified Incoming Bank Transfer Ref #BCA-99410',
      transaction_amount: 5250000,
      transaction_note: 'Awaiting account classification before financial statement inclusion',
      id_log_create: 'LOGS-26-RC08',
      id_log_update: null,
      created_by: 'MCC-1001',
      created_at: '2026-11-18T13:45:00.000Z',
    },
  ],
  rcrd_clsf: [
    // Initial Owner's Capital
    {
      id: 'clsf-1000-1',
      id_transaction_record: 'c8f10a10-2601-4a91-9b11-000000001000',
      type: 'DEBIT',
      account_id: 'COA-1010',
      amount: 250000000,
      reference_model: null,
      reference_model_id: null,
    },
    {
      id: 'clsf-1000-2',
      id_transaction_record: 'c8f10a10-2601-4a91-9b11-000000001000',
      type: 'CREDIT',
      account_id: 'COA-3010',
      amount: 250000000,
      reference_model: null,
      reference_model_id: null,
    },
    // Fleet Acquisition (Investing outflow)
    {
      id: 'clsf-1005-1',
      id_transaction_record: 'c8f10a10-2601-4a91-9b11-000000001005',
      type: 'DEBIT',
      account_id: 'COA-1310',
      amount: 120000000,
      reference_model: null,
      reference_model_id: null,
    },
    {
      id: 'clsf-1005-2',
      id_transaction_record: 'c8f10a10-2601-4a91-9b11-000000001005',
      type: 'CREDIT',
      account_id: 'COA-1010',
      amount: 120000000,
      reference_model: null,
      reference_model_id: null,
    },
    // INV-26-1001 auto post
    {
      id: 'clsf-1001-1',
      id_transaction_record: 'c8f10a10-2601-4a91-9b11-000000001001',
      type: 'DEBIT',
      account_id: 'COA-1110',
      amount: 15680000,
      reference_model: 'invoice',
      reference_model_id: 'INV-26-1001',
    },
    {
      id: 'clsf-1001-2',
      id_transaction_record: 'c8f10a10-2601-4a91-9b11-000000001001',
      type: 'CREDIT',
      account_id: 'COA-4010',
      amount: 14126126,
      reference_model: 'invoice',
      reference_model_id: 'INV-26-1001',
    },
    {
      id: 'clsf-1001-3',
      id_transaction_record: 'c8f10a10-2601-4a91-9b11-000000001001',
      type: 'CREDIT',
      account_id: 'COA-2110',
      amount: 1553874,
      reference_model: 'invoice',
      reference_model_id: 'INV-26-1001',
    },
    // INV-26-1002 auto post
    {
      id: 'clsf-1002-1',
      id_transaction_record: 'c8f10a10-2601-4a91-9b11-000000001002',
      type: 'DEBIT',
      account_id: 'COA-1110',
      amount: 24950000,
      reference_model: 'invoice',
      reference_model_id: 'INV-26-1002',
    },
    {
      id: 'clsf-1002-2',
      id_transaction_record: 'c8f10a10-2601-4a91-9b11-000000001002',
      type: 'CREDIT',
      account_id: 'COA-4010',
      amount: 22477477,
      reference_model: 'invoice',
      reference_model_id: 'INV-26-1002',
    },
    {
      id: 'clsf-1002-3',
      id_transaction_record: 'c8f10a10-2601-4a91-9b11-000000001002',
      type: 'CREDIT',
      account_id: 'COA-2110',
      amount: 2472523,
      reference_model: 'invoice',
      reference_model_id: 'INV-26-1002',
    },
    // INV-26-1003 auto post
    {
      id: 'clsf-1003-1',
      id_transaction_record: 'c8f10a10-2601-4a91-9b11-000000001003',
      type: 'DEBIT',
      account_id: 'COA-1110',
      amount: 38400000,
      reference_model: 'invoice',
      reference_model_id: 'INV-26-1003',
    },
    {
      id: 'clsf-1003-2',
      id_transaction_record: 'c8f10a10-2601-4a91-9b11-000000001003',
      type: 'CREDIT',
      account_id: 'COA-4010',
      amount: 34594595,
      reference_model: 'invoice',
      reference_model_id: 'INV-26-1003',
    },
    {
      id: 'clsf-1003-3',
      id_transaction_record: 'c8f10a10-2601-4a91-9b11-000000001003',
      type: 'CREDIT',
      account_id: 'COA-2110',
      amount: 3805405,
      reference_model: 'invoice',
      reference_model_id: 'INV-26-1003',
    },
    // Payment settling INV-26-1003
    {
      id: 'clsf-1004-1',
      id_transaction_record: 'c8f10a10-2601-4a91-9b11-000000001004',
      type: 'DEBIT',
      account_id: 'COA-1010',
      amount: 38400000,
      reference_model: null,
      reference_model_id: null,
    },
    {
      id: 'clsf-1004-2',
      id_transaction_record: 'c8f10a10-2601-4a91-9b11-000000001004',
      type: 'CREDIT',
      account_id: 'COA-1110',
      amount: 38400000,
      reference_model: 'invoice',
      reference_model_id: 'INV-26-1003',
    },
    // Fleet Fuel & Tolls
    {
      id: 'clsf-1006-1',
      id_transaction_record: 'c8f10a10-2601-4a91-9b11-000000001006',
      type: 'DEBIT',
      account_id: 'COA-5010',
      amount: 4850000,
      reference_model: 'expense',
      reference_model_id: 'EXP-FUEL-1104',
    },
    {
      id: 'clsf-1006-2',
      id_transaction_record: 'c8f10a10-2601-4a91-9b11-000000001006',
      type: 'DEBIT',
      account_id: 'COA-5020',
      amount: 1650000,
      reference_model: 'expense',
      reference_model_id: 'EXP-TOLL-1104',
    },
    {
      id: 'clsf-1006-3',
      id_transaction_record: 'c8f10a10-2601-4a91-9b11-000000001006',
      type: 'CREDIT',
      account_id: 'COA-1010',
      amount: 6500000,
      reference_model: null,
      reference_model_id: null,
    },
    // Office Salaries & Cloud Software
    {
      id: 'clsf-1007-1',
      id_transaction_record: 'c8f10a10-2601-4a91-9b11-000000001007',
      type: 'DEBIT',
      account_id: 'COA-6010',
      amount: 12500000,
      reference_model: 'payroll',
      reference_model_id: 'PAY-2026-11',
    },
    {
      id: 'clsf-1007-2',
      id_transaction_record: 'c8f10a10-2601-4a91-9b11-000000001007',
      type: 'DEBIT',
      account_id: 'COA-6040',
      amount: 1800000,
      reference_model: 'expense',
      reference_model_id: 'EXP-CLOUD-11',
    },
    {
      id: 'clsf-1007-3',
      id_transaction_record: 'c8f10a10-2601-4a91-9b11-000000001007',
      type: 'CREDIT',
      account_id: 'COA-1010',
      amount: 14300000,
      reference_model: null,
      reference_model_id: null,
    },
  ],
};

// Seed matching local audit log entries for preview mode so Log IDs inspect cleanly
if (!isSupabaseConfigured) {
  localDb.logs.push({
    id: 'LOGS-26-COA0',
    id_previous_logs: null,
    id_changed_by: 'MCC-1001',
    model_name: 'chart_of_accounts',
    timestamp_created_at: '2026-01-01T00:00:00.000Z',
    created_at: '2026-01-01T00:00:00.000Z',
    created_by: 'MCC-1001',
    changes_json: [
      {
        record_id: DEFAULT_COMPANY_ID,
        action: 'create',
        id_previous_logs: null,
        changes: {
          seeded_accounts: { old: 0, new: STANDARD_COA_TEMPLATES.length },
        },
      },
    ],
  });
  for (const r of localAccountingDb.rcrd) {
    if (!r.id_log_create) continue;
    const lineCount = localAccountingDb.rcrd_clsf.filter(
      (l) => l.id_transaction_record === r.id
    ).length;
    localDb.logs.push({
      id: r.id_log_create,
      id_previous_logs: null,
      id_changed_by: r.created_by ?? 'MCC-1001',
      model_name: 'rcrd',
      timestamp_created_at: r.created_at,
      created_at: r.created_at,
      created_by: r.created_by ?? 'MCC-1001',
      changes_json: [
        {
          record_id: r.id,
          action: 'create',
          id_previous_logs: null,
          changes: {
            source_type: { old: null, new: r.source_type },
            transaction_date: { old: null, new: r.transaction_date },
            transaction_description: { old: null, new: r.transaction_description },
            transaction_amount: { old: null, new: r.transaction_amount },
            lines_count: { old: null, new: lineCount },
          },
        },
      ],
    });
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function computeTransactionBalanceAndStatus(
  lines: Array<{ type: LedgerEntryType; amount: number }>
): {
  total_debit: number;
  total_credit: number;
  balance_diff: number;
  label_status: TransactionLabelStatus;
} {
  if (!lines || lines.length === 0) {
    return {
      total_debit: 0,
      total_credit: 0,
      balance_diff: 0,
      label_status: 'unlabeled',
    };
  }
  let dr = 0;
  let cr = 0;
  for (const line of lines) {
    const amt = round2(Number(line.amount || 0));
    if (line.type === 'DEBIT') dr = round2(dr + amt);
    else if (line.type === 'CREDIT') cr = round2(cr + amt);
  }
  const diff = round2(dr - cr);
  const label_status: TransactionLabelStatus =
    lines.length >= 2 && dr > 0 && Math.abs(diff) <= 0.005
      ? 'labeled'
      : 'not_equal';
  return {
    total_debit: dr,
    total_credit: cr,
    balance_diff: diff,
    label_status,
  };
}

export async function ensureDefaultCompanyAndCoa(): Promise<CompanyRecord> {
  if (!isSupabaseConfigured) {
    return localAccountingDb.companies[0];
  }

  const admin = getSupabaseAdmin();
  const { data: existingCompanies, error } = await admin
    .from('companies')
    .select('*')
    .order('created_at', { ascending: true })
    .limit(1);

  if (error) {
    throw new Error(
      enhanceSchemaMigrationError(`Failed to query companies: ${error.message}`)
    );
  }

  let company: CompanyRecord;
  if (existingCompanies && existingCompanies.length > 0) {
    company = existingCompanies[0] as CompanyRecord;
  } else {
    const { data: created, error: createErr } = await admin
      .from('companies')
      .insert({
        id: DEFAULT_COMPANY_ID,
        name: DEFAULT_COMPANY_NAME,
      })
      .select()
      .single();
    if (createErr || !created) {
      throw new Error(
        enhanceSchemaMigrationError(
          `Failed to bootstrap default company: ${createErr?.message || 'Empty response'}`
        )
      );
    }
    company = created as CompanyRecord;
  }

  // Ensure standard COA exists for this company if empty
  const { data: existingCoa } = await admin
    .from('chart_of_accounts')
    .select('id')
    .eq('company_id', company.id)
    .limit(1);

  if (!existingCoa || existingCoa.length === 0) {
    const seedRows = STANDARD_COA_TEMPLATES.map((t) => ({
      id: company.id === DEFAULT_COMPANY_ID ? t.code : crypto.randomUUID(),
      company_id: company.id,
      code: t.code,
      name: t.name,
      category: t.category,
      normal_balance: t.normal_balance,
      statement: t.statement,
    }));
    await admin.from('chart_of_accounts').insert(seedRows);
  }

  return company;
}

// ============================================================================
// Companies
// ============================================================================
export async function listCompanies(): Promise<CompanyRecord[]> {
  if (!isSupabaseConfigured) {
    return [...localAccountingDb.companies];
  }
  await ensureDefaultCompanyAndCoa();
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from('companies')
    .select('*')
    .order('created_at', { ascending: true });
  if (error) {
    throw new Error(
      enhanceSchemaMigrationError(`Failed to load companies: ${error.message}`)
    );
  }
  return (data || []) as CompanyRecord[];
}

export async function createCompany(
  name: string,
  actor: WorkerRecord
): Promise<CompanyRecord> {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error('Company name is required.');
  }
  const id = crypto.randomUUID();
  const nowIso = new Date().toISOString();

  if (isSupabaseConfigured) {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from('companies')
      .insert({ id, name: trimmed, created_at: nowIso })
      .select()
      .single();
    if (error || !data) {
      throw new Error(
        enhanceSchemaMigrationError(
          `Failed to create company: ${error?.message || 'Database error'}`
        )
      );
    }
    const coaSeedLog = await createAuditLog(
      actor.id,
      'chart_of_accounts',
      [
        {
          record_id: id,
          action: 'create',
          id_previous_logs: null,
          changes: {
            company_id: { old: null, new: id },
            seeded_accounts: { old: 0, new: STANDARD_COA_TEMPLATES.length },
          },
        },
      ],
      null
    ).catch(() => null);

    // Seed standard 32-account COA for the new company so invoicing works immediately
    await admin.from('chart_of_accounts').insert(
      STANDARD_COA_TEMPLATES.map((t) => ({
        id: crypto.randomUUID(),
        company_id: id,
        code: t.code,
        name: t.name,
        category: t.category,
        normal_balance: t.normal_balance,
        statement: t.statement,
        id_log_create: coaSeedLog?.id ?? null,
        created_by: actor.id,
      }))
    );
    await createAuditLog(
      actor.id,
      'companies',
      [{ record_id: id, action: 'create', id_previous_logs: null, changes: { name: { old: null, new: trimmed } } }],
      null
    ).catch(() => {});
    return data as CompanyRecord;
  }

  const company: CompanyRecord = { id, name: trimmed, created_at: nowIso };
  localAccountingDb.companies.push(company);
  const coaSeedLog = await createAuditLog(
    actor.id,
    'chart_of_accounts',
    [
      {
        record_id: id,
        action: 'create',
        id_previous_logs: null,
        changes: {
          company_id: { old: null, new: id },
          seeded_accounts: { old: 0, new: STANDARD_COA_TEMPLATES.length },
        },
      },
    ],
    null
  );
  for (const t of STANDARD_COA_TEMPLATES) {
    localAccountingDb.coa.push({
      id: crypto.randomUUID(),
      company_id: id,
      code: t.code,
      name: t.name,
      category: t.category,
      normal_balance: t.normal_balance,
      statement: t.statement,
      id_log_create: coaSeedLog.id,
      id_log_update: null,
      created_by: actor.id,
      created_at: nowIso,
    });
  }
  await createAuditLog(
    actor.id,
    'companies',
    [{ record_id: id, action: 'create', id_previous_logs: null, changes: { name: { old: null, new: trimmed } } }],
    null
  );
  return company;
}

// ============================================================================
// Chart of Accounts (COA)
// ============================================================================
export async function listChartOfAccounts(
  companyId?: string
): Promise<ChartOfAccountRecord[]> {
  const targetCompanyId = companyId?.trim() || (await ensureDefaultCompanyAndCoa()).id;

  if (isSupabaseConfigured) {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from('chart_of_accounts')
      .select('*')
      .eq('company_id', targetCompanyId)
      .order('code', { ascending: true });
    if (error) {
      throw new Error(
        enhanceSchemaMigrationError(
          `Failed to load chart of accounts: ${error.message}`
        )
      );
    }
    const rows = (data || []) as ChartOfAccountRecord[];
    if (rows.length === 0) {
      const seedRows = STANDARD_COA_TEMPLATES.map((t) => ({
        id:
          targetCompanyId === DEFAULT_COMPANY_ID
            ? t.code
            : crypto.randomUUID(),
        company_id: targetCompanyId,
        code: t.code,
        name: t.name,
        category: t.category,
        normal_balance: t.normal_balance,
        statement: t.statement,
      }));
      await admin
        .from('chart_of_accounts')
        .upsert(seedRows, { onConflict: 'company_id,code', ignoreDuplicates: true });
      const { data: seeded } = await admin
        .from('chart_of_accounts')
        .select('*')
        .eq('company_id', targetCompanyId)
        .order('code', { ascending: true });
      return (seeded || []) as ChartOfAccountRecord[];
    }
    return rows;
  }

  let localRows = localAccountingDb.coa.filter((c) => c.company_id === targetCompanyId);
  if (localRows.length === 0) {
    const nowIso = new Date().toISOString();
    for (const t of STANDARD_COA_TEMPLATES) {
      localAccountingDb.coa.push({
        id:
          targetCompanyId === DEFAULT_COMPANY_ID
            ? t.code
            : crypto.randomUUID(),
        company_id: targetCompanyId,
        code: t.code,
        name: t.name,
        category: t.category,
        normal_balance: t.normal_balance,
        statement: t.statement,
        created_at: nowIso,
      });
    }
    localRows = localAccountingDb.coa.filter((c) => c.company_id === targetCompanyId);
  }

  return localRows.sort((a, b) =>
    a.code.localeCompare(b.code, undefined, { numeric: true })
  );
}

export async function createChartOfAccount(
  input: {
    company_id?: string;
    code: string;
    name: string;
    category: CoaCategory;
    normal_balance?: CoaNormalBalance;
    statement?: CoaStatement;
  },
  actor: WorkerRecord
): Promise<ChartOfAccountRecord> {
  const companyId =
    input.company_id?.trim() || (await ensureDefaultCompanyAndCoa()).id;
  const code = input.code.trim();
  const name = input.name.trim();
  const category = String(input.category || '').toUpperCase() as CoaCategory;

  if (!code || !name) {
    throw new Error('Account code and name are required.');
  }
  if (!VALID_COA_CATEGORIES.has(category)) {
    throw new Error('Category must be ASSET, LIABILITY, EQUITY, REVENUE, or EXPENSE.');
  }

  const normalBalance = normalizeNormalBalance(input.normal_balance, category);
  const statement = normalizeStatement(input.statement, category);

  const id = crypto.randomUUID();
  const nowIso = new Date().toISOString();
  const log = await createAuditLog(
    actor.id,
    'chart_of_accounts',
    [
      {
        record_id: id,
        action: 'create',
        id_previous_logs: null,
        changes: {
          company_id: { old: null, new: companyId },
          code: { old: null, new: code },
          name: { old: null, new: name },
          category: { old: null, new: category },
          normal_balance: { old: null, new: normalBalance },
          statement: { old: null, new: statement },
        },
      },
    ],
    null
  );

  const row: ChartOfAccountRecord = {
    id,
    company_id: companyId,
    code,
    name,
    category,
    normal_balance: normalBalance,
    statement,
    id_log_create: log.id,
    id_log_update: null,
    created_by: actor.id,
    created_at: nowIso,
  };

  if (isSupabaseConfigured) {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from('chart_of_accounts')
      .insert(row)
      .select()
      .single();
    if (error || !data) {
      throw new Error(
        enhanceSchemaMigrationError(
          `Failed to create COA account: ${error?.message || 'Database error'}`
        )
      );
    }
    return data as ChartOfAccountRecord;
  }

  if (
    localAccountingDb.coa.some(
      (c) =>
        c.company_id === companyId &&
        c.code.toLowerCase() === code.toLowerCase()
    )
  ) {
    throw new Error(`Account code "${code}" already exists in this company.`);
  }
  localAccountingDb.coa.push(row);
  return row;
}

export async function updateChartOfAccount(
  id: string,
  input: {
    code?: string;
    name?: string;
    category?: CoaCategory;
    normal_balance?: CoaNormalBalance;
    statement?: CoaStatement;
  },
  actor: WorkerRecord
): Promise<ChartOfAccountRecord> {
  if (isSupabaseConfigured) {
    const admin = getSupabaseAdmin();
    const { data: existing, error: fetchErr } = await admin
      .from('chart_of_accounts')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (fetchErr || !existing) {
      throw new Error('Chart of Accounts entry not found.');
    }

    const patch: Record<string, unknown> = {};
    const diffs: Record<string, { old: unknown; new: unknown }> = {};
    let effectiveCat = existing.category as CoaCategory;

    if (typeof input.code === 'string' && input.code.trim()) {
      const nextCode = input.code.trim();
      if (nextCode !== existing.code) {
        patch.code = nextCode;
        diffs.code = { old: existing.code, new: nextCode };
      }
    }
    if (typeof input.name === 'string' && input.name.trim()) {
      const nextName = input.name.trim();
      if (nextName !== existing.name) {
        patch.name = nextName;
        diffs.name = { old: existing.name, new: nextName };
      }
    }
    if (input.category) {
      const nextCat = String(input.category).toUpperCase() as CoaCategory;
      if (!VALID_COA_CATEGORIES.has(nextCat)) {
        throw new Error('Invalid COA category.');
      }
      effectiveCat = nextCat;
      if (nextCat !== existing.category) {
        patch.category = nextCat;
        diffs.category = { old: existing.category, new: nextCat };
      }
    }
    if (input.normal_balance) {
      const nextNb = normalizeNormalBalance(input.normal_balance, effectiveCat);
      if (nextNb !== existing.normal_balance) {
        patch.normal_balance = nextNb;
        diffs.normal_balance = { old: existing.normal_balance, new: nextNb };
      }
    }
    if (input.statement) {
      const nextStmt = normalizeStatement(input.statement, effectiveCat);
      if (nextStmt !== existing.statement) {
        patch.statement = nextStmt;
        diffs.statement = { old: existing.statement, new: nextStmt };
      }
    }

    if (Object.keys(patch).length > 0) {
      const prevLog = existing.id_log_update || existing.id_log_create || null;
      const log = await createAuditLog(
        actor.id,
        'chart_of_accounts',
        [{ record_id: id, action: 'update', id_previous_logs: prevLog, changes: diffs }],
        prevLog
      );
      patch.id_log_update = log.id;
    }

    const { data, error } = await admin
      .from('chart_of_accounts')
      .update(patch)
      .eq('id', id)
      .select()
      .single();
    if (error || !data) {
      throw new Error(
        enhanceSchemaMigrationError(
          `Failed to update COA account: ${error?.message || 'Database error'}`
        )
      );
    }
    return data as ChartOfAccountRecord;
  }

  const idx = localAccountingDb.coa.findIndex((c) => c.id === id);
  if (idx === -1) throw new Error('Chart of Accounts entry not found.');
  const existing = localAccountingDb.coa[idx];
  const nextCode = input.code?.trim() || existing.code;
  const nextName = input.name?.trim() || existing.name;
  const nextCat = (
    input.category ? String(input.category).toUpperCase() : existing.category
  ) as CoaCategory;
  if (!VALID_COA_CATEGORIES.has(nextCat)) {
    throw new Error('Invalid COA category.');
  }
  const nextNb = input.normal_balance
    ? normalizeNormalBalance(input.normal_balance, nextCat)
    : existing.normal_balance;
  const nextStmt = input.statement
    ? normalizeStatement(input.statement, nextCat)
    : existing.statement;

  if (
    nextCode.toLowerCase() !== existing.code.toLowerCase() &&
    localAccountingDb.coa.some(
      (c) =>
        c.id !== id &&
        c.company_id === existing.company_id &&
        c.code.toLowerCase() === nextCode.toLowerCase()
    )
  ) {
    throw new Error(`Account code "${nextCode}" already exists in this company.`);
  }

  const diffs: Record<string, { old: unknown; new: unknown }> = {};
  if (nextCode !== existing.code) diffs.code = { old: existing.code, new: nextCode };
  if (nextName !== existing.name) diffs.name = { old: existing.name, new: nextName };
  if (nextCat !== existing.category) diffs.category = { old: existing.category, new: nextCat };
  if (nextNb !== existing.normal_balance) {
    diffs.normal_balance = { old: existing.normal_balance, new: nextNb };
  }
  if (nextStmt !== existing.statement) {
    diffs.statement = { old: existing.statement, new: nextStmt };
  }

  let logUpdateId = existing.id_log_update ?? null;
  if (Object.keys(diffs).length > 0) {
    const prevLog = existing.id_log_update || existing.id_log_create || null;
    const log = await createAuditLog(
      actor.id,
      'chart_of_accounts',
      [{ record_id: id, action: 'update', id_previous_logs: prevLog, changes: diffs }],
      prevLog
    );
    logUpdateId = log.id;
  }

  const updated: ChartOfAccountRecord = {
    ...existing,
    code: nextCode,
    name: nextName,
    category: nextCat,
    normal_balance: nextNb,
    statement: nextStmt,
    id_log_update: logUpdateId,
  };
  localAccountingDb.coa[idx] = updated;
  return updated;
}

export async function deleteChartOfAccount(id: string): Promise<void> {
  if (isSupabaseConfigured) {
    const admin = getSupabaseAdmin();
    const { error } = await admin.from('chart_of_accounts').delete().eq('id', id);
    if (error) {
      throw new Error(
        `Cannot delete account (it may already be referenced by ledger entries): ${error.message}`
      );
    }
    return;
  }

  const inUse = localAccountingDb.rcrd_clsf.some((l) => l.account_id === id);
  if (inUse) {
    throw new Error(
      'Cannot delete account because it is referenced by existing ledger lines.'
    );
  }
  const idx = localAccountingDb.coa.findIndex((c) => c.id === id);
  if (idx === -1) throw new Error('Account not found.');
  localAccountingDb.coa.splice(idx, 1);
}

// ============================================================================
// Invoice Auto-Post & Cancellation + Counter-Reversal Engine
// ============================================================================
export async function postInvoiceToLedger(
  invoiceId: string,
  codes?: { arCode?: string; revCode?: string; taxCode?: string }
): Promise<string | null> {
  const arCode = codes?.arCode || DEFAULT_AR_CODE;
  const revCode = codes?.revCode || DEFAULT_REV_CODE;
  const taxCode = codes?.taxCode || DEFAULT_TAX_CODE;

  if (isSupabaseConfigured) {
    const admin = getSupabaseAdmin();
    const inv = (await getRecordById('invoices', invoiceId)) as InvoiceRecord | null;
    if (!inv) return null;
    if (inv.is_canceled || isCanceledStatus(inv.status)) return null;

    let targetCompanyId = inv.company_id;
    if (!targetCompanyId) {
      const defComp = await ensureDefaultCompanyAndCoa();
      targetCompanyId = defComp.id;
      await admin
        .from('invoices')
        .update({ company_id: targetCompanyId })
        .eq('id', invoiceId);
    }
    // Ensure standard COA accounts exist for this company before posting
    await listChartOfAccounts(targetCompanyId);

    const { data, error } = await admin.rpc('post_invoice_to_ledger', {
      p_invoice_id: invoiceId,
      p_ar_code: arCode,
      p_rev_code: revCode,
      p_tax_code: taxCode,
    });
    if (error) {
      throw new Error(
        enhanceSchemaMigrationError(`Auto-post invoice to ledger failed: ${error.message}`)
      );
    }
    const rcrdId = typeof data === 'string' ? data : null;
    if (rcrdId) {
      const rcrdLog = await createAuditLog(
        inv.created_by ?? null,
        'rcrd',
        [
          {
            record_id: rcrdId,
            action: 'create',
            id_previous_logs: null,
            changes: {
              source_type: { old: null, new: 'SYSTEM' },
              invoice_id: { old: null, new: inv.id },
              transaction_amount: {
                old: null,
                new: Number(inv.total_amount ?? inv.amount ?? 0),
              },
              label_status: { old: null, new: 'labeled' },
            },
          },
        ],
        null
      ).catch(() => null);
      if (rcrdLog) {
        await admin
          .from('rcrd')
          .update({ id_log_create: rcrdLog.id, created_by: inv.created_by ?? null })
          .eq('id', rcrdId);
      }
    }
    return rcrdId;
  }

  const inv = localDb.invoices.find((i) => i.id === invoiceId);
  if (!inv) throw new Error('Invoice not found.');
  if (inv.is_canceled || isCanceledStatus(inv.status)) return null;

  // Idempotency guard: avoid duplicate SYSTEM postings for the same invoice
  const existingAutoLine = localAccountingDb.rcrd_clsf.find(
    (l) =>
      l.reference_model === 'invoice' &&
      l.reference_model_id === inv.id &&
      localAccountingDb.rcrd.some(
        (r) =>
          r.id === l.id_transaction_record &&
          (r.source_type === 'SYSTEM' || r.source_type === 'SYSTEM_AUTO')
      )
  );
  if (existingAutoLine) {
    return existingAutoLine.id_transaction_record;
  }

  const companyId = inv.company_id || DEFAULT_COMPANY_ID;
  inv.company_id = companyId;

  const coaList = await listChartOfAccounts(companyId);
  const arAcc = coaList.find((c) => c.code === arCode);
  const revAcc = coaList.find((c) => c.code === revCode);
  const taxAcc = coaList.find((c) => c.code === taxCode);
  if (!arAcc || !revAcc) {
    throw new Error(`Required COA accounts (${arCode} / ${revCode}) not found.`);
  }

  const total = Number(inv.total_amount ?? inv.amount ?? 0);
  const tax = Number(inv.tax_amount ?? 0);
  const subtotal =
    Number(inv.subtotal_amount || 0) > 0
      ? Number(inv.subtotal_amount)
      : round2(total - tax);
  const invNo = inv.invoice_number || inv.id;

  if (tax !== 0 && !taxAcc) {
    throw new Error(`Tax COA account (${taxCode}) not found.`);
  }

  const rcrdId = crypto.randomUUID();
  const rcrdLog = await createAuditLog(
    inv.created_by ?? null,
    'rcrd',
    [
      {
        record_id: rcrdId,
        action: 'create',
        id_previous_logs: null,
        changes: {
          source_type: { old: null, new: 'SYSTEM' },
          invoice_id: { old: null, new: inv.id },
          transaction_description: { old: null, new: `Invoice ${invNo}` },
          transaction_amount: { old: null, new: total },
          label_status: { old: null, new: 'labeled' },
        },
      },
    ],
    null
  );

  localAccountingDb.rcrd.unshift({
    id: rcrdId,
    company_id: companyId,
    source_type: 'SYSTEM',
    bank_account_id: null,
    transaction_date: inv.date_period || inv.issue_date,
    transaction_description: `Invoice ${invNo}`,
    transaction_amount: total,
    transaction_note: 'Auto-posted from invoice creation',
    id_log_create: rcrdLog.id,
    id_log_update: null,
    created_by: inv.created_by ?? null,
    created_at: new Date().toISOString(),
  });

  localAccountingDb.rcrd_clsf.push(
    {
      id: crypto.randomUUID(),
      id_transaction_record: rcrdId,
      type: 'DEBIT',
      account_id: arAcc.id,
      amount: total,
      reference_model: 'invoice',
      reference_model_id: inv.id,
    },
    {
      id: crypto.randomUUID(),
      id_transaction_record: rcrdId,
      type: 'CREDIT',
      account_id: revAcc.id,
      amount: subtotal,
      reference_model: 'invoice',
      reference_model_id: inv.id,
    }
  );

  if (tax > 0 && taxAcc) {
    localAccountingDb.rcrd_clsf.push({
      id: crypto.randomUUID(),
      id_transaction_record: rcrdId,
      type: 'CREDIT',
      account_id: taxAcc.id,
      amount: tax,
      reference_model: 'invoice',
      reference_model_id: inv.id,
    });
  } else if (tax < 0 && taxAcc) {
    localAccountingDb.rcrd_clsf.push({
      id: crypto.randomUUID(),
      id_transaction_record: rcrdId,
      type: 'DEBIT',
      account_id: taxAcc.id,
      amount: Math.abs(tax),
      reference_model: 'invoice',
      reference_model_id: inv.id,
    });
  }

  return rcrdId;
}

export async function cancelInvoiceWithLedger(
  invoiceId: string,
  input: {
    cancelDate: string;
    reason: string;
    autoReverse: boolean;
    arCode?: string;
    revCode?: string;
    taxCode?: string;
  },
  actor: WorkerRecord
): Promise<CancelInvoiceResponse> {
  const cancelDate = input.cancelDate.trim();
  const reason = input.reason.trim();
  const autoReverse = Boolean(input.autoReverse);
  const arCode = input.arCode || DEFAULT_AR_CODE;
  const revCode = input.revCode || DEFAULT_REV_CODE;
  const taxCode = input.taxCode || DEFAULT_TAX_CODE;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(cancelDate)) {
    throw new Error('Cancellation date must be in YYYY-MM-DD format.');
  }
  if (!reason) {
    throw new Error('Please provide a reason for canceling this invoice.');
  }

  const existingInv = (await getRecordById('invoices', invoiceId)) as InvoiceRecord | null;
  if (!existingInv) {
    throw new Error('Invoice not found.');
  }
  if (existingInv.is_canceled || existingInv.status === 'canceled') {
    throw new Error('Invoice is already canceled.');
  }

  const prevLogId = existingInv.id_log_update || existingInv.id_log_create || null;
  let reversalRcrdId: string | null = null;
  let updatedInvoice: InvoiceRecord;

  if (isSupabaseConfigured) {
    const admin = getSupabaseAdmin();
    if (!existingInv.company_id) {
      const defComp = await ensureDefaultCompanyAndCoa();
      await admin
        .from('invoices')
        .update({ company_id: defComp.id })
        .eq('id', invoiceId);
    }

    const { data: rpcRcrdId, error: rpcErr } = await admin.rpc('cancel_invoice', {
      p_invoice_id: invoiceId,
      p_cancel_date: cancelDate,
      p_reason: reason,
      p_auto_reverse: autoReverse,
      p_ar_code: arCode,
      p_rev_code: revCode,
      p_tax_code: taxCode,
    });

    if (rpcErr) {
      throw new Error(
        enhanceSchemaMigrationError(`Failed to cancel invoice: ${rpcErr.message}`)
      );
    }
    reversalRcrdId = typeof rpcRcrdId === 'string' ? rpcRcrdId : null;

    if (reversalRcrdId) {
      const revLog = await createAuditLog(
        actor.id,
        'rcrd',
        [
          {
            record_id: reversalRcrdId,
            action: 'create',
            id_previous_logs: null,
            changes: {
              source_type: { old: null, new: 'ADJUSTMENT' },
              invoice_id: { old: null, new: invoiceId },
              transaction_date: { old: null, new: cancelDate },
              cancel_reason: { old: null, new: reason },
              label_status: { old: null, new: 'labeled' },
            },
          },
        ],
        null
      ).catch(() => null);
      if (revLog) {
        await admin
          .from('rcrd')
          .update({ id_log_create: revLog.id, created_by: actor.id })
          .eq('id', reversalRcrdId);
      }
    }

    const log = await createAuditLog(
      actor.id,
      'invoices',
      [
        {
          record_id: invoiceId,
          action: 'update',
          id_previous_logs: prevLogId,
          changes: {
            is_canceled: { old: false, new: true },
            status: { old: existingInv.status, new: 'canceled' },
            cancel_reason: { old: null, new: reason },
            reversal_rcrd_id: { old: null, new: reversalRcrdId },
          },
        },
      ],
      prevLogId
    );

    const { data: refreshed } = await admin
      .from('invoices')
      .update({ id_log_update: log.id })
      .eq('id', invoiceId)
      .select()
      .single();

    updatedInvoice = (refreshed as InvoiceRecord) || {
      ...existingInv,
      is_canceled: true,
      status: 'canceled',
      cancel_reason: reason,
      canceled_at: new Date().toISOString(),
      id_log_update: log.id,
    };
  } else {
    const idx = localDb.invoices.findIndex((i) => i.id === invoiceId);
    if (idx === -1) throw new Error('Invoice not found.');
    const inv = localDb.invoices[idx];
    const companyId = inv.company_id || DEFAULT_COMPANY_ID;
    inv.company_id = companyId;

    const nowIso = new Date().toISOString();

    if (autoReverse) {
      const coaList = localAccountingDb.coa.filter((c) => c.company_id === companyId);
      const arAcc = coaList.find((c) => c.code === arCode);
      const revAcc = coaList.find((c) => c.code === revCode);
      const taxAcc = coaList.find((c) => c.code === taxCode);
      if (!arAcc || !revAcc) {
        throw new Error(`Required COA accounts (${arCode} / ${revCode}) not found.`);
      }
      const total = Number(inv.total_amount ?? inv.amount ?? 0);
      const tax = Number(inv.tax_amount ?? 0);
      const subtotal =
        Number(inv.subtotal_amount || 0) > 0
          ? Number(inv.subtotal_amount)
          : round2(total - tax);
      const invNo = inv.invoice_number || inv.id;

      if (tax !== 0 && !taxAcc) {
        throw new Error(`Tax COA account (${taxCode}) not found.`);
      }

      reversalRcrdId = crypto.randomUUID();
      const revLog = await createAuditLog(
        actor.id,
        'rcrd',
        [
          {
            record_id: reversalRcrdId,
            action: 'create',
            id_previous_logs: null,
            changes: {
              source_type: { old: null, new: 'ADJUSTMENT' },
              invoice_id: { old: null, new: invoiceId },
              transaction_date: { old: null, new: cancelDate },
              transaction_amount: { old: null, new: total },
              cancel_reason: { old: null, new: reason },
              label_status: { old: null, new: 'labeled' },
            },
          },
        ],
        null
      );

      localAccountingDb.rcrd.unshift({
        id: reversalRcrdId,
        company_id: companyId,
        source_type: 'ADJUSTMENT',
        bank_account_id: null,
        transaction_date: cancelDate,
        transaction_description: `Reversal: Invoice ${invNo}`,
        transaction_amount: total,
        transaction_note: reason,
        id_log_create: revLog.id,
        id_log_update: null,
        created_by: actor.id,
        created_at: nowIso,
      });

      // DR Sales Revenue
      localAccountingDb.rcrd_clsf.push({
        id: crypto.randomUUID(),
        id_transaction_record: reversalRcrdId,
        type: 'DEBIT',
        account_id: revAcc.id,
        amount: subtotal,
        reference_model: 'invoice',
        reference_model_id: inv.id,
      });

      // DR PPN Keluaran (if tax > 0)
      if (tax > 0 && taxAcc) {
        localAccountingDb.rcrd_clsf.push({
          id: crypto.randomUUID(),
          id_transaction_record: reversalRcrdId,
          type: 'DEBIT',
          account_id: taxAcc.id,
          amount: tax,
          reference_model: 'invoice',
          reference_model_id: inv.id,
        });
      } else if (tax < 0 && taxAcc) {
        localAccountingDb.rcrd_clsf.push({
          id: crypto.randomUUID(),
          id_transaction_record: reversalRcrdId,
          type: 'CREDIT',
          account_id: taxAcc.id,
          amount: Math.abs(tax),
          reference_model: 'invoice',
          reference_model_id: inv.id,
        });
      }

      // CR Accounts Receivable
      localAccountingDb.rcrd_clsf.push({
        id: crypto.randomUUID(),
        id_transaction_record: reversalRcrdId,
        type: 'CREDIT',
        account_id: arAcc.id,
        amount: total,
        reference_model: 'invoice',
        reference_model_id: inv.id,
      });
    }

    const log = await createAuditLog(
      actor.id,
      'invoices',
      [
        {
          record_id: invoiceId,
          action: 'update',
          id_previous_logs: prevLogId,
          changes: {
            is_canceled: { old: false, new: true },
            status: { old: inv.status, new: 'canceled' },
            cancel_reason: { old: null, new: reason },
            reversal_rcrd_id: { old: null, new: reversalRcrdId },
          },
        },
      ],
      prevLogId
    );

    updatedInvoice = {
      ...inv,
      is_canceled: true,
      status: 'canceled',
      canceled_at: nowIso,
      cancel_reason: reason,
      id_log_update: log.id,
    };
    localDb.invoices[idx] = updatedInvoice;
  }

  return {
    invoice: updatedInvoice,
    reversalRcrdId,
    autoReversed: autoReverse,
    message: autoReverse
      ? `Invoice ${existingInv.invoice_number || existingInv.id} canceled and counter-reversal posted to the ledger.`
      : `Invoice ${existingInv.invoice_number || existingInv.id} marked as canceled. Open a manual journal entry for custom tax or bad-debt adjustments.`,
  };
}

// ============================================================================
// Transaction Records (RCRD + RCRD-CLSF)
// ============================================================================
export async function listTransactionRecords(
  companyId?: string
): Promise<TransactionRecord[]> {
  const targetCompanyId =
    companyId?.trim() || (await ensureDefaultCompanyAndCoa()).id;

  const [coaList, invoices] = await Promise.all([
    listChartOfAccounts(targetCompanyId),
    listAllRecords('invoices') as Promise<InvoiceRecord[]>,
  ]);

  const coaMap = new Map(coaList.map((c) => [c.id, c]));
  const invoiceMap = new Map(invoices.map((i) => [i.id, i]));

  let headers: StoredRcrd[] = [];
  let lines: StoredRcrdLine[] = [];

  if (isSupabaseConfigured) {
    const admin = getSupabaseAdmin();
    const { data: rcrdData, error: rcrdErr } = await admin
      .from('rcrd')
      .select('*')
      .eq('company_id', targetCompanyId)
      .order('transaction_date', { ascending: false })
      .order('created_at', { ascending: false });
    if (rcrdErr) {
      throw new Error(
        enhanceSchemaMigrationError(
          `Failed to load transaction records: ${rcrdErr.message}`
        )
      );
    }
    headers = (rcrdData || []) as StoredRcrd[];
    const ids = headers.map((h) => h.id);
    if (ids.length > 0) {
      const { data: clsfData, error: clsfErr } = await admin
        .from('rcrd_clsf')
        .select('*')
        .in('id_transaction_record', ids);
      if (clsfErr) {
        throw new Error(
          enhanceSchemaMigrationError(
            `Failed to load ledger lines: ${clsfErr.message}`
          )
        );
      }
      lines = (clsfData || []) as StoredRcrdLine[];
    }
  } else {
    headers = localAccountingDb.rcrd
      .filter((r) => r.company_id === targetCompanyId)
      .sort(
        (a, b) =>
          b.transaction_date.localeCompare(a.transaction_date) ||
          b.created_at.localeCompare(a.created_at)
      );
    const idSet = new Set(headers.map((h) => h.id));
    lines = localAccountingDb.rcrd_clsf.filter((l) =>
      idSet.has(l.id_transaction_record)
    );
  }

  const linesByParent = new Map<string, TransactionLineRecord[]>();
  for (const l of lines) {
    const acc = coaMap.get(l.account_id);
    const inv =
      l.reference_model === 'invoice' && l.reference_model_id
        ? invoiceMap.get(l.reference_model_id)
        : undefined;
    const enriched: TransactionLineRecord = {
      id: l.id,
      id_transaction_record: l.id_transaction_record,
      type: l.type,
      account_id: l.account_id,
      account_code: acc?.code,
      account_name: acc?.name,
      account_category: acc?.category,
      amount: Number(l.amount || 0),
      reference_model: l.reference_model,
      reference_model_id: l.reference_model_id,
      reference_label: inv ? inv.invoice_number || inv.id : l.reference_model_id,
    };
    const arr = linesByParent.get(l.id_transaction_record) || [];
    arr.push(enriched);
    linesByParent.set(l.id_transaction_record, arr);
  }

  return headers.map((h) => {
    const bank = h.bank_account_id ? coaMap.get(h.bank_account_id) : undefined;
    const recordLines = linesByParent.get(h.id) || [];
    const balanceMeta = computeTransactionBalanceAndStatus(recordLines);
    return {
      ...h,
      transaction_amount: Number(h.transaction_amount || 0),
      bank_code: bank?.code ?? null,
      bank_name: bank?.name ?? null,
      ...balanceMeta,
      lines: recordLines,
    };
  });
}

export interface ManualTransactionInput {
  company_id?: string;
  source_type?: RcrdSourceType;
  account_type?: string | null;
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

function validateLedgerLines(
  lines: ManualTransactionInput['lines'],
  validAccountIds: Set<string>,
  headerAmountInput?: number
): {
  headerAmount: number;
  totalDebit: number;
  totalCredit: number;
  labelStatus: TransactionLabelStatus;
  normalized: ManualTransactionInput['lines'];
} {
  if (!Array.isArray(lines)) {
    throw new Error('Ledger lines must be an array.');
  }

  // Allow unlabeled records (0 classification lines) if a positive header amount is given
  if (lines.length === 0) {
    const amt = round2(Number(headerAmountInput ?? 0));
    if (!Number.isFinite(amt) || amt <= 0) {
      throw new Error(
        'Unlabeled transaction records require a positive header amount (or add classification lines).'
      );
    }
    return {
      headerAmount: amt,
      totalDebit: 0,
      totalCredit: 0,
      labelStatus: 'unlabeled',
      normalized: [],
    };
  }

  let totalDr = 0;
  let totalCr = 0;
  const normalized: ManualTransactionInput['lines'] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const type = String(line.type || '').toUpperCase() as LedgerEntryType;
    if (type !== 'DEBIT' && type !== 'CREDIT') {
      throw new Error(`Line ${i + 1}: type must be DEBIT or CREDIT.`);
    }
    if (!line.account_id || !validAccountIds.has(line.account_id)) {
      throw new Error(`Line ${i + 1}: invalid Chart of Accounts selection.`);
    }
    const amt = round2(Number(line.amount));
    if (!Number.isFinite(amt) || amt <= 0) {
      throw new Error(`Line ${i + 1}: amount must be greater than 0.`);
    }
    if (type === 'DEBIT') totalDr = round2(totalDr + amt);
    else totalCr = round2(totalCr + amt);

    normalized.push({
      type,
      account_id: line.account_id,
      amount: amt,
      reference_model: line.reference_model?.trim() || null,
      reference_model_id: line.reference_model_id?.trim() || null,
    });
  }

  const { label_status } = computeTransactionBalanceAndStatus(normalized);
  const headerAmount = Math.max(totalDr, totalCr);
  if (headerAmount <= 0) {
    throw new Error('Transaction total must be greater than 0.');
  }

  return {
    headerAmount,
    totalDebit: totalDr,
    totalCredit: totalCr,
    labelStatus: label_status,
    normalized,
  };
}

export async function createManualTransactionRecord(
  input: ManualTransactionInput,
  actor: WorkerRecord
): Promise<TransactionRecord> {
  const companyId =
    input.company_id?.trim() || (await ensureDefaultCompanyAndCoa()).id;
  const txDate = input.transaction_date?.trim();
  const description = input.transaction_description?.trim();
  const note = input.transaction_note?.trim() || null;

  if (!txDate || !/^\d{4}-\d{2}-\d{2}$/.test(txDate)) {
    throw new Error('Valid transaction date (YYYY-MM-DD) is required.');
  }
  if (!description) {
    throw new Error('Transaction description is required.');
  }

  const coaList = await listChartOfAccounts(companyId);
  const validAccIds = new Set(coaList.map((c) => c.id));
  const bankAccId = input.bank_account_id?.trim() || null;
  if (bankAccId && !validAccIds.has(bankAccId)) {
    throw new Error('Selected bank account does not belong to this company.');
  }

  const { headerAmount, totalDebit, totalCredit, labelStatus, normalized } =
    validateLedgerLines(input.lines, validAccIds, input.transaction_amount);
  const rcrdId = crypto.randomUUID();
  const nowIso = new Date().toISOString();

  const resolvedSourceType: RcrdSourceType = normalizeRcrdSourceType(
    input.source_type
  );

  const log = await createAuditLog(
    actor.id,
    'rcrd',
    [
      {
        record_id: rcrdId,
        action: 'create',
        id_previous_logs: null,
        changes: {
          source_type: { old: null, new: resolvedSourceType },
          transaction_date: { old: null, new: txDate },
          transaction_description: { old: null, new: description },
          transaction_amount: { old: null, new: headerAmount },
          total_debit: { old: null, new: totalDebit },
          total_credit: { old: null, new: totalCredit },
          label_status: { old: null, new: labelStatus },
          lines_count: { old: null, new: normalized.length },
        },
      },
    ],
    null
  );

  const headerRow: StoredRcrd = {
    id: rcrdId,
    company_id: companyId,
    source_type: resolvedSourceType,
    bank_account_id: bankAccId,
    transaction_date: txDate,
    transaction_description: description,
    transaction_amount: headerAmount,
    transaction_note: note,
    id_log_create: log.id,
    id_log_update: null,
    created_by: actor.id,
    created_at: nowIso,
  };

  const lineRows: StoredRcrdLine[] = normalized.map((l) => ({
    id: crypto.randomUUID(),
    id_transaction_record: rcrdId,
    type: l.type,
    account_id: l.account_id,
    amount: l.amount,
    reference_model: l.reference_model || null,
    reference_model_id: l.reference_model_id || null,
  }));

  if (isSupabaseConfigured) {
    const admin = getSupabaseAdmin();
    const { error: hErr } = await admin.from('rcrd').insert(headerRow);
    if (hErr) {
      throw new Error(
        enhanceSchemaMigrationError(`Failed to create transaction record: ${hErr.message}`)
      );
    }
    if (lineRows.length > 0) {
      const { error: lErr } = await admin.from('rcrd_clsf').insert(lineRows);
      if (lErr) {
        await admin.from('rcrd').delete().eq('id', rcrdId);
        throw new Error(
          enhanceSchemaMigrationError(`Failed to insert ledger lines: ${lErr.message}`)
        );
      }
    }
  } else {
    localAccountingDb.rcrd.unshift(headerRow);
    if (lineRows.length > 0) {
      localAccountingDb.rcrd_clsf.push(...lineRows);
    }
  }

  const all = await listTransactionRecords(companyId);
  const found = all.find((r) => r.id === rcrdId);
  if (!found) throw new Error('Unable to load newly created transaction record.');
  return found;
}

export async function updateManualTransactionRecord(
  id: string,
  input: ManualTransactionInput,
  actor: WorkerRecord
): Promise<TransactionRecord> {
  const companyId =
    input.company_id?.trim() || (await ensureDefaultCompanyAndCoa()).id;
  const txDate = input.transaction_date?.trim();
  const description = input.transaction_description?.trim();
  const note = input.transaction_note?.trim() || null;

  if (!txDate || !/^\d{4}-\d{2}-\d{2}$/.test(txDate)) {
    throw new Error('Valid transaction date (YYYY-MM-DD) is required.');
  }
  if (!description) {
    throw new Error('Transaction description is required.');
  }

  const coaList = await listChartOfAccounts(companyId);
  const validAccIds = new Set(coaList.map((c) => c.id));
  const bankAccId = input.bank_account_id?.trim() || null;
  if (bankAccId && !validAccIds.has(bankAccId)) {
    throw new Error('Selected bank account does not belong to this company.');
  }

  const { headerAmount, totalDebit, totalCredit, labelStatus, normalized } =
    validateLedgerLines(input.lines, validAccIds, input.transaction_amount);
  const lineRows: StoredRcrdLine[] = normalized.map((l) => ({
    id: crypto.randomUUID(),
    id_transaction_record: id,
    type: l.type,
    account_id: l.account_id,
    amount: l.amount,
    reference_model: l.reference_model || null,
    reference_model_id: l.reference_model_id || null,
  }));

  if (isSupabaseConfigured) {
    const admin = getSupabaseAdmin();
    const { data: existing, error: fetchErr } = await admin
      .from('rcrd')
      .select('*')
      .eq('id', id)
      .eq('company_id', companyId)
      .maybeSingle();
    if (fetchErr || !existing) {
      throw new Error('Transaction record not found in this company.');
    }

    const { data: oldLines } = await admin
      .from('rcrd_clsf')
      .select('type, amount')
      .eq('id_transaction_record', id);
    const oldMeta = computeTransactionBalanceAndStatus(
      ((oldLines || []) as Array<{ type: LedgerEntryType; amount: number }>).map((l) => ({
        type: l.type,
        amount: Number(l.amount || 0),
      }))
    );

    const nextSourceType = input.source_type
      ? normalizeRcrdSourceType(input.source_type)
      : existing.source_type;
    const prevLog = existing.id_log_update || existing.id_log_create || null;
    const log = await createAuditLog(
      actor.id,
      'rcrd',
      [
        {
          record_id: id,
          action: 'update',
          id_previous_logs: prevLog,
          changes: {
            source_type: { old: existing.source_type, new: nextSourceType },
            transaction_date: { old: existing.transaction_date, new: txDate },
            transaction_description: {
              old: existing.transaction_description,
              new: description,
            },
            transaction_amount: { old: existing.transaction_amount, new: headerAmount },
            total_debit: { old: oldMeta.total_debit, new: totalDebit },
            total_credit: { old: oldMeta.total_credit, new: totalCredit },
            label_status: { old: oldMeta.label_status, new: labelStatus },
            lines_count: { old: (oldLines || []).length, new: normalized.length },
          },
        },
      ],
      prevLog
    );

    const updatePatch: Record<string, unknown> = {
      source_type: nextSourceType,
      bank_account_id: bankAccId,
      transaction_date: txDate,
      transaction_description: description,
      transaction_amount: headerAmount,
      transaction_note: note,
      id_log_update: log.id,
    };

    const { error: updErr } = await admin
      .from('rcrd')
      .update(updatePatch)
      .eq('id', id)
      .eq('company_id', companyId);
    if (updErr) {
      throw new Error(`Failed to update transaction header: ${updErr.message}`);
    }

    await admin.from('rcrd_clsf').delete().eq('id_transaction_record', id);
    if (lineRows.length > 0) {
      const { error: lineErr } = await admin.from('rcrd_clsf').insert(lineRows);
      if (lineErr) {
        throw new Error(`Failed to replace ledger lines: ${lineErr.message}`);
      }
    }
  } else {
    const idx = localAccountingDb.rcrd.findIndex(
      (r) => r.id === id && r.company_id === companyId
    );
    if (idx === -1) throw new Error('Transaction record not found in this company.');
    const existing = localAccountingDb.rcrd[idx];
    const oldLines = localAccountingDb.rcrd_clsf.filter(
      (l) => l.id_transaction_record === id
    );
    const oldMeta = computeTransactionBalanceAndStatus(oldLines);
    const nextSourceType = input.source_type
      ? normalizeRcrdSourceType(input.source_type)
      : existing.source_type;
    const prevLog = existing.id_log_update || existing.id_log_create || null;
    const log = await createAuditLog(
      actor.id,
      'rcrd',
      [
        {
          record_id: id,
          action: 'update',
          id_previous_logs: prevLog,
          changes: {
            source_type: { old: existing.source_type, new: nextSourceType },
            transaction_date: { old: existing.transaction_date, new: txDate },
            transaction_description: {
              old: existing.transaction_description,
              new: description,
            },
            transaction_amount: { old: existing.transaction_amount, new: headerAmount },
            total_debit: { old: oldMeta.total_debit, new: totalDebit },
            total_credit: { old: oldMeta.total_credit, new: totalCredit },
            label_status: { old: oldMeta.label_status, new: labelStatus },
            lines_count: { old: oldLines.length, new: normalized.length },
          },
        },
      ],
      prevLog
    );

    localAccountingDb.rcrd[idx] = {
      ...existing,
      source_type: nextSourceType,
      bank_account_id: bankAccId,
      transaction_date: txDate,
      transaction_description: description,
      transaction_amount: headerAmount,
      transaction_note: note,
      id_log_update: log.id,
    };
    localAccountingDb.rcrd_clsf = localAccountingDb.rcrd_clsf.filter(
      (l) => l.id_transaction_record !== id
    );
    if (lineRows.length > 0) {
      localAccountingDb.rcrd_clsf.push(...lineRows);
    }
  }

  const all = await listTransactionRecords(companyId);
  const found = all.find((r) => r.id === id);
  if (!found) throw new Error('Unable to load updated transaction record.');
  return found;
}

export async function deleteTransactionRecord(id: string): Promise<void> {
  if (isSupabaseConfigured) {
    const admin = getSupabaseAdmin();
    const { error } = await admin.from('rcrd').delete().eq('id', id);
    if (error) {
      throw new Error(`Failed to delete transaction record: ${error.message}`);
    }
    return;
  }
  const idx = localAccountingDb.rcrd.findIndex((r) => r.id === id);
  if (idx === -1) throw new Error('Transaction record not found.');
  localAccountingDb.rcrd.splice(idx, 1);
  localAccountingDb.rcrd_clsf = localAccountingDb.rcrd_clsf.filter(
    (l) => l.id_transaction_record !== id
  );
}

// ============================================================================
// Unpaid Active Invoices Safeguard (Strictly WHERE is_canceled = false)
// ============================================================================
export async function listUnpaidActiveInvoices(
  companyId?: string
): Promise<UnpaidInvoiceSummary[]> {
  const targetCompanyId =
    companyId?.trim() || (await ensureDefaultCompanyAndCoa()).id;

  const [invoices, customers, coaList, transactions] = await Promise.all([
    listAllRecords('invoices') as Promise<InvoiceRecord[]>,
    listAllRecords('customers') as Promise<CustomerRecord[]>,
    listChartOfAccounts(targetCompanyId),
    listTransactionRecords(targetCompanyId),
  ]);

  const customerMap = new Map(customers.map((c) => [c.id, c]));
  const arAccountIds = new Set(
    coaList
      .filter(
        (c) =>
          c.code === DEFAULT_AR_CODE ||
          c.name.toLowerCase().includes('accounts receivable')
      )
      .map((c) => c.id)
  );

  // Sum AR DEBIT vs CREDIT per invoice from rcrd_clsf
  const arDebitByInvoice = new Map<string, number>();
  const arCreditByInvoice = new Map<string, number>();

  for (const tx of transactions) {
    for (const line of tx.lines) {
      if (line.reference_model !== 'invoice' || !line.reference_model_id) continue;
      if (arAccountIds.size > 0 && !arAccountIds.has(line.account_id)) continue;
      const invId = line.reference_model_id;
      if (line.type === 'DEBIT') {
        arDebitByInvoice.set(invId, round2((arDebitByInvoice.get(invId) || 0) + line.amount));
      } else {
        arCreditByInvoice.set(invId, round2((arCreditByInvoice.get(invId) || 0) + line.amount));
      }
    }
  }

  const results: UnpaidInvoiceSummary[] = [];

  for (const inv of invoices) {
    // Operational Safeguard: Canceled invoices NEVER appear in unpaid dropdowns
    if (inv.is_canceled || inv.status === 'canceled') continue;
    if (inv.company_id && inv.company_id !== targetCompanyId) continue;

    const total = Number(inv.total_amount ?? inv.amount ?? 0);
    const tax = Number(inv.tax_amount ?? 0);
    const subtotal =
      Number(inv.subtotal_amount || 0) > 0
        ? Number(inv.subtotal_amount)
        : round2(total - tax);

    const ledgerDebit = arDebitByInvoice.get(inv.id) || 0;
    const ledgerCredit = arCreditByInvoice.get(inv.id) || 0;

    // Remaining AR balance: if posted to ledger, use ledger DR - CR; else fall back to status/total
    let remaining =
      ledgerDebit > 0
        ? round2(Math.max(0, ledgerDebit - ledgerCredit))
        : inv.status === 'paid'
          ? 0
          : round2(Math.max(0, total - ledgerCredit));
    const paidAmount = round2(Math.max(0, total - remaining));

    if (inv.status === 'paid' && ledgerDebit === 0) {
      remaining = 0;
    }

    if (remaining <= 0.005) continue;

    const client = customerMap.get(inv.client_id);
    results.push({
      id: inv.id,
      company_id: inv.company_id ?? targetCompanyId,
      invoice_number: inv.invoice_number || inv.id,
      client_id: inv.client_id,
      client_name: client?.name || inv.client_id,
      issue_date: inv.issue_date,
      due_date: inv.due_date,
      subtotal_amount: subtotal,
      tax_amount: tax,
      total_amount: total,
      paid_amount: paidAmount,
      remaining_balance: remaining,
      status: inv.status,
      is_canceled: false,
    });
  }

  return results.sort((a, b) => a.due_date.localeCompare(b.due_date));
}

// ============================================================================
// Single-CSV Staging & Grouped Import/Update Engine (RCRD + RCRD-CLSF)
// ============================================================================
export interface SingleCsvStagedRow {
  rowNumber: number;
  rcrd_id: string | null;
  group_no: string;
  transaction_date: string;
  source_type?: string | null;
  bank_code: string | null;
  description: string;
  note: string | null;
  type: LedgerEntryType | null;
  account_code: string;
  amount: number;
  ref_model: string | null;
  ref_number: string | null;
}

export async function processLedgerCsvImport(
  companyIdInput: string | undefined,
  rows: SingleCsvStagedRow[],
  actor: WorkerRecord,
  allowDrafts = true,
  mode: 'insert' | 'update' = 'insert'
): Promise<LedgerCsvImportResult> {
  const companyId =
    companyIdInput?.trim() || (await ensureDefaultCompanyAndCoa()).id;

  if (rows.length === 0) {
    throw new Error('CSV contains no valid transaction rows.');
  }

  const batchTag = `BATCH-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const coaList = await listChartOfAccounts(companyId);
  const coaByCode = new Map(coaList.map((c) => [c.code.trim().toLowerCase(), c]));
  const invoices = (await listAllRecords('invoices')) as InvoiceRecord[];

  const grouped = new Map<string, SingleCsvStagedRow[]>();
  for (const r of rows) {
    const gKey = r.group_no.trim();
    if (!gKey) {
      throw new Error(`Row ${r.rowNumber}: group_no is required.`);
    }
    const arr = grouped.get(gKey) || [];
    arr.push(r);
    grouped.set(gKey, arr);
  }

  const errors: Array<{ group: string; error: string }> = [];
  const validGroups: Array<{
    groupNo: string;
    resolvedRcrdId: string;
    suppliedRcrdId: string | null;
    rows: SingleCsvStagedRow[];
    labeledRows: SingleCsvStagedRow[];
    headerAmount: number;
    labelStatus: TransactionLabelStatus;
  }> = [];

  for (const [groupNo, groupRows] of grouped.entries()) {
    let totalDr = 0;
    let totalCr = 0;
    let maxAmt = 0;
    let groupError: string | null = null;
    const labeledRows: SingleCsvStagedRow[] = [];

    for (const r of groupRows) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(r.transaction_date)) {
        groupError = `Row ${r.rowNumber}: invalid transaction_date "${r.transaction_date}" (expected YYYY-MM-DD).`;
        break;
      }
      if (r.bank_code && !coaByCode.has(r.bank_code.trim().toLowerCase())) {
        groupError = `Row ${r.rowNumber}: bank_code "${r.bank_code}" not found in company Chart of Accounts.`;
        break;
      }
      if (!Number.isFinite(r.amount) || r.amount <= 0) {
        groupError = `Row ${r.rowNumber}: amount must be greater than 0.`;
        break;
      }
      maxAmt = Math.max(maxAmt, round2(r.amount));

      const hasAccountCode = Boolean(r.account_code.trim());
      const hasType = r.type === 'DEBIT' || r.type === 'CREDIT';

      if (hasAccountCode && !hasType) {
        groupError = `Row ${r.rowNumber}: column "type" must be DEBIT or CREDIT when account_code is provided.`;
        break;
      }
      if (!hasAccountCode && hasType) {
        groupError = `Row ${r.rowNumber}: column "account_code" is required when type "${r.type}" is specified.`;
        break;
      }
      if (hasAccountCode && hasType) {
        if (!coaByCode.has(r.account_code.trim().toLowerCase())) {
          groupError = `Row ${r.rowNumber}: account_code "${r.account_code}" not found in company Chart of Accounts.`;
          break;
        }
        labeledRows.push(r);
        if (r.type === 'DEBIT') totalDr = round2(totalDr + r.amount);
        else totalCr = round2(totalCr + r.amount);
      }
    }

    const labelStatus: TransactionLabelStatus =
      labeledRows.length === 0
        ? 'unlabeled'
        : labeledRows.length >= 2 && totalDr > 0 && Math.abs(totalDr - totalCr) <= 0.005
          ? 'labeled'
          : 'not_equal';

    if (!groupError && !allowDrafts && labelStatus !== 'labeled') {
      groupError =
        labelStatus === 'unlabeled'
          ? `Group ${groupNo} has no classified account lines (Unlabeled).`
          : `Group ${groupNo} is unbalanced: Debit (${totalDr.toLocaleString('id-ID')}) != Credit (${totalCr.toLocaleString('id-ID')}).`;
    }

    if (groupError) {
      errors.push({ group: groupNo, error: groupError });
    } else {
      const suppliedId =
        mode === 'update' ? groupRows[0]?.rcrd_id?.trim() || null : null;
      validGroups.push({
        groupNo,
        resolvedRcrdId: suppliedId || crypto.randomUUID(),
        suppliedRcrdId: suppliedId,
        rows: groupRows,
        labeledRows,
        headerAmount: labeledRows.length === 0 ? maxAmt : Math.max(totalDr, totalCr),
        labelStatus,
      });
    }
  }

  if (validGroups.length === 0) {
    return {
      batchTag,
      groupsProcessed: 0,
      createdCount: 0,
      updatedCount: 0,
      linesInserted: 0,
      labeledCount: 0,
      unlabeledCount: 0,
      notEqualCount: 0,
      logCreateId: null,
      logUpdateId: null,
      errorCount: errors.length,
      errors,
    };
  }

  let createdCount = 0;
  let updatedCount = 0;
  let linesInserted = 0;
  let labeledCount = 0;
  let unlabeledCount = 0;
  let notEqualCount = 0;
  let logCreateId: string | null = null;
  let logUpdateId: string | null = null;

  for (const g of validGroups) {
    if (g.labelStatus === 'labeled') labeledCount += 1;
    else if (g.labelStatus === 'unlabeled') unlabeledCount += 1;
    else notEqualCount += 1;
  }

  if (isSupabaseConfigured) {
    const admin = getSupabaseAdmin();

    const suppliedIds = Array.from(
      new Set(
        validGroups
          .map((g) => g.suppliedRcrdId)
          .filter((v): v is string => Boolean(v))
      )
    );
    const existingMap = new Map<
      string,
      { id: string; id_log_create?: string | null; id_log_update?: string | null }
    >();
    if (suppliedIds.length > 0) {
      const { data: existingRows } = await admin
        .from('rcrd')
        .select('id, id_log_create, id_log_update')
        .eq('company_id', companyId)
        .in('id', suppliedIds);
      for (const r of existingRows || []) {
        existingMap.set(String(r.id), {
          id: String(r.id),
          id_log_create: (r.id_log_create as string | null) ?? null,
          id_log_update: (r.id_log_update as string | null) ?? null,
        });
      }
    }

    const stagingPayload = validGroups.flatMap((g) => {
      const groupSourceType = normalizeRcrdSourceType(
        g.rows[0]?.source_type || 'BCA1'
      );
      return g.rows.map((r) => ({
        id: crypto.randomUUID(),
        company_id: companyId,
        batch_tag: batchTag,
        rcrd_id: g.resolvedRcrdId,
        group_no: g.groupNo,
        transaction_date: r.transaction_date,
        source_type: groupSourceType,
        bank_code: r.bank_code || null,
        description: r.description || null,
        note: r.note || null,
        type: r.type,
        account_code: r.account_code.trim() || null,
        amount: r.amount,
        ref_model: r.ref_model || null,
        ref_number: r.ref_number || null,
      }));
    });

    const { error: stageErr } = await admin
      .from('csv_import_batches')
      .insert(stagingPayload);
    if (stageErr) {
      throw new Error(
        enhanceSchemaMigrationError(
          `Failed to stage CSV batch: ${stageErr.message}`
        )
      );
    }

    const { error: procErr } = await admin.rpc('process_csv_batch', {
      p_company_id: companyId,
      p_batch_tag: batchTag,
      p_allow_drafts: allowDrafts,
    });
    if (procErr) {
      await admin
        .from('csv_import_batches')
        .delete()
        .eq('company_id', companyId)
        .eq('batch_tag', batchTag);
      throw new Error(
        enhanceSchemaMigrationError(`CSV batch processing failed: ${procErr.message}`)
      );
    }

    const createdGroups = validGroups.filter(
      (g) => !(g.suppliedRcrdId && existingMap.has(g.suppliedRcrdId))
    );
    const updatedGroups = validGroups.filter(
      (g) => Boolean(g.suppliedRcrdId && existingMap.has(g.suppliedRcrdId))
    );

    createdCount = createdGroups.length;
    updatedCount = updatedGroups.length;
    linesInserted = validGroups.reduce((sum, g) => sum + g.labeledRows.length, 0);

    if (createdGroups.length > 0) {
      const createLog = await createAuditLog(
        actor.id,
        'rcrd',
        createdGroups.map((g) => ({
          record_id: g.resolvedRcrdId,
          action: 'create',
          id_previous_logs: null,
          changes: {
            batch_tag: { old: null, new: batchTag },
            transaction_date: { old: null, new: g.rows[0].transaction_date },
            transaction_amount: { old: null, new: g.headerAmount },
            label_status: { old: null, new: g.labelStatus },
            lines_count: { old: null, new: g.labeledRows.length },
          },
        })),
        null
      );
      logCreateId = createLog.id;
      await admin
        .from('rcrd')
        .update({ id_log_create: createLog.id, created_by: actor.id })
        .in(
          'id',
          createdGroups.map((g) => g.resolvedRcrdId)
        );
    }

    if (updatedGroups.length > 0) {
      const firstPrev = existingMap.get(updatedGroups[0].resolvedRcrdId);
      const topPrevLog = firstPrev?.id_log_update || firstPrev?.id_log_create || null;
      const updateLog = await createAuditLog(
        actor.id,
        'rcrd',
        updatedGroups.map((g) => {
          const prev = existingMap.get(g.resolvedRcrdId);
          const prevLog = prev?.id_log_update || prev?.id_log_create || null;
          return {
            record_id: g.resolvedRcrdId,
            action: 'update',
            id_previous_logs: prevLog,
            changes: {
              batch_tag: { old: null, new: batchTag },
              transaction_date: { old: null, new: g.rows[0].transaction_date },
              transaction_amount: { old: null, new: g.headerAmount },
              label_status: { old: null, new: g.labelStatus },
              lines_count: { old: null, new: g.labeledRows.length },
            },
          };
        }),
        topPrevLog
      );
      logUpdateId = updateLog.id;
      await admin
        .from('rcrd')
        .update({ id_log_update: updateLog.id })
        .in(
          'id',
          updatedGroups.map((g) => g.resolvedRcrdId)
        );
    }
  } else {
    const nowIso = new Date().toISOString();
    const createdEntries: Array<{
      record_id: string;
      action: 'create';
      id_previous_logs: null;
      changes: Record<string, { old: unknown; new: unknown }>;
    }> = [];
    const updatedEntries: Array<{
      record_id: string;
      action: 'update';
      id_previous_logs: string | null;
      changes: Record<string, { old: unknown; new: unknown }>;
    }> = [];
    const createdIds: string[] = [];
    const updatedIds: string[] = [];

    for (const g of validGroups) {
      const first = g.rows[0];
      const bankAcc = first.bank_code
        ? coaByCode.get(first.bank_code.trim().toLowerCase())
        : undefined;

      const existingIdx = g.suppliedRcrdId
        ? localAccountingDb.rcrd.findIndex(
            (r) => r.id === g.suppliedRcrdId && r.company_id === companyId
          )
        : -1;

      const groupSourceType = normalizeRcrdSourceType(
        first.source_type || 'BCA1'
      );

      let targetRcrdId: string;
      if (existingIdx !== -1) {
        const existing = localAccountingDb.rcrd[existingIdx];
        targetRcrdId = existing.id;
        const prevLog = existing.id_log_update || existing.id_log_create || null;
        localAccountingDb.rcrd[existingIdx] = {
          ...existing,
          source_type: first.source_type ? groupSourceType : existing.source_type,
          bank_account_id: bankAcc?.id ?? null,
          transaction_date: first.transaction_date,
          transaction_description: first.description,
          transaction_amount: g.headerAmount,
          transaction_note: first.note,
        };
        localAccountingDb.rcrd_clsf = localAccountingDb.rcrd_clsf.filter(
          (l) => l.id_transaction_record !== targetRcrdId
        );
        updatedCount += 1;
        updatedIds.push(targetRcrdId);
        updatedEntries.push({
          record_id: targetRcrdId,
          action: 'update',
          id_previous_logs: prevLog,
          changes: {
            batch_tag: { old: null, new: batchTag },
            source_type: { old: existing.source_type, new: first.source_type ? groupSourceType : existing.source_type },
            transaction_date: { old: existing.transaction_date, new: first.transaction_date },
            transaction_amount: { old: existing.transaction_amount, new: g.headerAmount },
            label_status: { old: null, new: g.labelStatus },
            lines_count: { old: null, new: g.labeledRows.length },
          },
        });
      } else {
        targetRcrdId = g.resolvedRcrdId;
        localAccountingDb.rcrd.unshift({
          id: targetRcrdId,
          company_id: companyId,
          source_type: groupSourceType,
          bank_account_id: bankAcc?.id ?? null,
          transaction_date: first.transaction_date,
          transaction_description: first.description,
          transaction_amount: g.headerAmount,
          transaction_note: first.note,
          id_log_create: null,
          id_log_update: null,
          created_by: actor.id,
          created_at: nowIso,
        });
        createdCount += 1;
        createdIds.push(targetRcrdId);
        createdEntries.push({
          record_id: targetRcrdId,
          action: 'create',
          id_previous_logs: null,
          changes: {
            batch_tag: { old: null, new: batchTag },
            transaction_date: { old: null, new: first.transaction_date },
            transaction_amount: { old: null, new: g.headerAmount },
            label_status: { old: null, new: g.labelStatus },
            lines_count: { old: null, new: g.labeledRows.length },
          },
        });
      }

      for (const line of g.labeledRows) {
        const acc = coaByCode.get(line.account_code.trim().toLowerCase())!;
        let refId: string | null = null;
        if (
          line.ref_model?.toLowerCase() === 'invoice' &&
          line.ref_number?.trim()
        ) {
          const needle = line.ref_number.trim().toLowerCase();
          const matchedInv = invoices.find(
            (inv) =>
              (inv.invoice_number || '').toLowerCase() === needle ||
              inv.id.toLowerCase() === needle
          );
          refId = matchedInv ? matchedInv.id : line.ref_number.trim();
        } else if (line.ref_number?.trim()) {
          refId = line.ref_number.trim();
        }

        localAccountingDb.rcrd_clsf.push({
          id: crypto.randomUUID(),
          id_transaction_record: targetRcrdId,
          type: line.type!,
          account_id: acc.id,
          amount: line.amount,
          reference_model: line.ref_model?.trim() || null,
          reference_model_id: refId,
        });
        linesInserted += 1;
      }
    }

    if (createdEntries.length > 0) {
      const createLog = await createAuditLog(actor.id, 'rcrd', createdEntries, null);
      logCreateId = createLog.id;
      const createdSet = new Set(createdIds);
      for (const r of localAccountingDb.rcrd) {
        if (createdSet.has(r.id)) r.id_log_create = createLog.id;
      }
    }
    if (updatedEntries.length > 0) {
      const updateLog = await createAuditLog(
        actor.id,
        'rcrd',
        updatedEntries,
        updatedEntries[0].id_previous_logs
      );
      logUpdateId = updateLog.id;
      const updatedSet = new Set(updatedIds);
      for (const r of localAccountingDb.rcrd) {
        if (updatedSet.has(r.id)) r.id_log_update = updateLog.id;
      }
    }
  }

  return {
    batchTag,
    groupsProcessed: validGroups.length,
    createdCount,
    updatedCount,
    linesInserted,
    labeledCount,
    unlabeledCount,
    notEqualCount,
    logCreateId,
    logUpdateId,
    errorCount: errors.length,
    errors,
  };
}

// ============================================================================
// Auto-Generating Financial Statements Engine (IS, BS, Cash Flow)
// ============================================================================
function extractCoaDigits(code: string): string {
  const m = code.match(/(\d{4})/);
  return m ? m[1] : code.replace(/\D/g, '');
}

function isCashAccount(acc: ChartOfAccountRecord): boolean {
  if (acc.category !== 'ASSET') return false;
  const digits = extractCoaDigits(acc.code);
  if (digits === '1010' || digits === '1020') return true;
  const lower = acc.name.toLowerCase();
  return lower.includes('cash') || lower.includes('bank') || lower.includes('kas');
}

function isFixedAssetAccount(acc: ChartOfAccountRecord): boolean {
  if (acc.category !== 'ASSET') return false;
  const digits = extractCoaDigits(acc.code);
  if (digits.startsWith('13')) return true;
  const lower = acc.name.toLowerCase();
  return (
    lower.includes('fleet') ||
    lower.includes('equipment') ||
    lower.includes('vehicle') ||
    lower.includes('property') ||
    lower.includes('accumulated depreciation')
  );
}

function isNonCurrentLiabilityAccount(acc: ChartOfAccountRecord): boolean {
  if (acc.category !== 'LIABILITY') return false;
  const digits = extractCoaDigits(acc.code);
  if (digits.startsWith('22')) return true;
  const lower = acc.name.toLowerCase();
  return lower.includes('loan') || lower.includes('financing') || lower.includes('long-term');
}

function isDirectCostAccount(acc: ChartOfAccountRecord): boolean {
  if (acc.category !== 'EXPENSE') return false;
  const digits = extractCoaDigits(acc.code);
  return digits.startsWith('5');
}

export async function generateFinancialStatements(
  companyIdInput?: string,
  startDateInput?: string,
  endDateInput?: string
): Promise<FinancialStatementsResponse> {
  const companies = await listCompanies();
  const targetCompany =
    companies.find((c) => c.id === companyIdInput?.trim()) ||
    companies[0] ||
    (await ensureDefaultCompanyAndCoa());

  const [coaList, allRecords] = await Promise.all([
    listChartOfAccounts(targetCompany.id),
    listTransactionRecords(targetCompany.id),
  ]);

  const today = new Date().toISOString().slice(0, 10);
  const startDate =
    startDateInput && /^\d{4}-\d{2}-\d{2}$/.test(startDateInput.trim())
      ? startDateInput.trim()
      : `${today.slice(0, 4)}-01-01`;
  const endDate =
    endDateInput && /^\d{4}-\d{2}-\d{2}$/.test(endDateInput.trim())
      ? endDateInput.trim()
      : today;

  if (startDate > endDate) {
    throw new Error('Start date cannot be after end date.');
  }

  const coaById = new Map(coaList.map((c) => [c.id, c]));

  // Partition records for period (IS & Cash Flow) and cumulative as-of endDate (BS)
  const recordsInPeriod = allRecords.filter(
    (r) => r.transaction_date >= startDate && r.transaction_date <= endDate
  );
  const recordsAsOfEnd = allRecords.filter((r) => r.transaction_date <= endDate);
  const recordsBeforeStart = allRecords.filter((r) => r.transaction_date < startDate);

  const labeledInPeriod = recordsInPeriod.filter((r) => r.label_status === 'labeled');
  const labeledAsOfEnd = recordsAsOfEnd.filter((r) => r.label_status === 'labeled');
  const labeledBeforeStart = recordsBeforeStart.filter(
    (r) => r.label_status === 'labeled'
  );

  const integrity = {
    totalRecordsInPeriod: recordsInPeriod.length,
    labeledRecordsInPeriod: labeledInPeriod.length,
    unlabeledCountInPeriod: recordsInPeriod.filter((r) => r.label_status === 'unlabeled')
      .length,
    notEqualCountInPeriod: recordsInPeriod.filter((r) => r.label_status === 'not_equal')
      .length,
    totalRecordsAsOfEnd: recordsAsOfEnd.length,
    labeledRecordsAsOfEnd: labeledAsOfEnd.length,
    unlabeledCountAsOfEnd: recordsAsOfEnd.filter((r) => r.label_status === 'unlabeled')
      .length,
    notEqualCountAsOfEnd: recordsAsOfEnd.filter((r) => r.label_status === 'not_equal')
      .length,
  };

  // Helper to aggregate DR/CR totals per account
  const aggregateAccounts = (txs: TransactionRecord[]) => {
    const totals = new Map<string, { debit: number; credit: number }>();
    for (const tx of txs) {
      for (const line of tx.lines) {
        const prev = totals.get(line.account_id) || { debit: 0, credit: 0 };
        if (line.type === 'DEBIT') prev.debit = round2(prev.debit + line.amount);
        else prev.credit = round2(prev.credit + line.amount);
        totals.set(line.account_id, prev);
      }
    }
    return totals;
  };

  const periodTotals = aggregateAccounts(labeledInPeriod);
  const cumulativeTotals = aggregateAccounts(labeledAsOfEnd);
  const priorTotals = aggregateAccounts(labeledBeforeStart);

  // --------------------------------------------------------------------------
  // 1. Income Statement (IS) — Labeled transactions within [startDate, endDate]
  // --------------------------------------------------------------------------
  const revenue: FinancialStatementLine[] = [];
  const directCosts: FinancialStatementLine[] = [];
  const operatingExpenses: FinancialStatementLine[] = [];

  for (const acc of coaList) {
    if (acc.statement !== 'IS') continue;
    const t = periodTotals.get(acc.id);
    if (!t || (t.debit === 0 && t.credit === 0)) continue;

    if (acc.category === 'REVENUE') {
      // Revenue: Credit - Debit (so contra-revenue Sales Discounts COA-4030 subtracts naturally)
      const amt = round2(t.credit - t.debit);
      revenue.push({
        account_id: acc.id,
        code: acc.code,
        name: acc.name,
        category: acc.category,
        normal_balance: acc.normal_balance,
        statement: acc.statement,
        debit_total: t.debit,
        credit_total: t.credit,
        amount: amt,
      });
    } else {
      // Expense: Debit - Credit
      const amt = round2(t.debit - t.credit);
      const item: FinancialStatementLine = {
        account_id: acc.id,
        code: acc.code,
        name: acc.name,
        category: acc.category,
        normal_balance: acc.normal_balance,
        statement: acc.statement,
        debit_total: t.debit,
        credit_total: t.credit,
        amount: amt,
      };
      if (isDirectCostAccount(acc)) {
        directCosts.push(item);
      } else {
        operatingExpenses.push(item);
      }
    }
  }

  const totalRevenue = round2(revenue.reduce((s, l) => s + l.amount, 0));
  const totalDirectCosts = round2(directCosts.reduce((s, l) => s + l.amount, 0));
  const grossProfit = round2(totalRevenue - totalDirectCosts);
  const totalOperatingExpenses = round2(
    operatingExpenses.reduce((s, l) => s + l.amount, 0)
  );
  const netIncome = round2(grossProfit - totalOperatingExpenses);
  const grossMarginPercent =
    totalRevenue !== 0 ? round2((grossProfit / totalRevenue) * 100) : 0;
  const netMarginPercent =
    totalRevenue !== 0 ? round2((netIncome / totalRevenue) * 100) : 0;

  const incomeStatement: IncomeStatementReport = {
    revenue,
    totalRevenue,
    directCosts,
    totalDirectCosts,
    grossProfit,
    operatingExpenses,
    totalOperatingExpenses,
    netIncome,
    grossMarginPercent,
    netMarginPercent,
  };

  // --------------------------------------------------------------------------
  // 2. Balance Sheet (BS) — Cumulative labeled transactions <= endDate
  // --------------------------------------------------------------------------
  const currentAssets: FinancialStatementLine[] = [];
  const fixedAssets: FinancialStatementLine[] = [];
  const currentLiabilities: FinancialStatementLine[] = [];
  const nonCurrentLiabilities: FinancialStatementLine[] = [];
  const equityAccounts: FinancialStatementLine[] = [];

  let cumulativeIsNetEarnings = 0;
  let balanceSheetCash = 0;

  for (const acc of coaList) {
    const t = cumulativeTotals.get(acc.id);
    if (!t || (t.debit === 0 && t.credit === 0)) continue;

    if (acc.statement === 'IS') {
      // Unclosed net earnings from all IS accounts <= endDate
      cumulativeIsNetEarnings = round2(
        cumulativeIsNetEarnings + (t.credit - t.debit)
      );
      continue;
    }

    if (acc.category === 'ASSET') {
      // Assets: Debit - Credit (contra-assets like Allowance & Accum Depr naturally show negative)
      const amt = round2(t.debit - t.credit);
      if (isCashAccount(acc)) {
        balanceSheetCash = round2(balanceSheetCash + amt);
      }
      const item: FinancialStatementLine = {
        account_id: acc.id,
        code: acc.code,
        name: acc.name,
        category: acc.category,
        normal_balance: acc.normal_balance,
        statement: acc.statement,
        debit_total: t.debit,
        credit_total: t.credit,
        amount: amt,
      };
      if (isFixedAssetAccount(acc)) fixedAssets.push(item);
      else currentAssets.push(item);
    } else if (acc.category === 'LIABILITY') {
      const amt = round2(t.credit - t.debit);
      const item: FinancialStatementLine = {
        account_id: acc.id,
        code: acc.code,
        name: acc.name,
        category: acc.category,
        normal_balance: acc.normal_balance,
        statement: acc.statement,
        debit_total: t.debit,
        credit_total: t.credit,
        amount: amt,
      };
      if (isNonCurrentLiabilityAccount(acc)) nonCurrentLiabilities.push(item);
      else currentLiabilities.push(item);
    } else if (acc.category === 'EQUITY') {
      // Equity: Credit - Debit (Owner's Drawings / Prive COA-3030 naturally subtracts)
      const amt = round2(t.credit - t.debit);
      equityAccounts.push({
        account_id: acc.id,
        code: acc.code,
        name: acc.name,
        category: acc.category,
        normal_balance: acc.normal_balance,
        statement: acc.statement,
        debit_total: t.debit,
        credit_total: t.credit,
        amount: amt,
      });
    }
  }

  const totalCurrentAssets = round2(currentAssets.reduce((s, l) => s + l.amount, 0));
  const totalFixedAssets = round2(fixedAssets.reduce((s, l) => s + l.amount, 0));
  const totalAssets = round2(totalCurrentAssets + totalFixedAssets);

  const totalCurrentLiabilities = round2(
    currentLiabilities.reduce((s, l) => s + l.amount, 0)
  );
  const totalNonCurrentLiabilities = round2(
    nonCurrentLiabilities.reduce((s, l) => s + l.amount, 0)
  );
  const totalLiabilities = round2(
    totalCurrentLiabilities + totalNonCurrentLiabilities
  );

  const totalEquityAccounts = round2(equityAccounts.reduce((s, l) => s + l.amount, 0));
  const totalEquity = round2(totalEquityAccounts + cumulativeIsNetEarnings);
  const totalLiabilitiesAndEquity = round2(totalLiabilities + totalEquity);
  const balanceDiscrepancy = round2(totalAssets - totalLiabilitiesAndEquity);

  const balanceSheet: BalanceSheetReport = {
    currentAssets,
    totalCurrentAssets,
    fixedAssets,
    totalFixedAssets,
    totalAssets,
    currentLiabilities,
    totalCurrentLiabilities,
    nonCurrentLiabilities,
    totalNonCurrentLiabilities,
    totalLiabilities,
    equityAccounts,
    currentPeriodEarnings: cumulativeIsNetEarnings,
    totalEquity,
    totalLiabilitiesAndEquity,
    balanceDiscrepancy,
    isBalanced: Math.abs(balanceDiscrepancy) <= 0.01,
  };

  // --------------------------------------------------------------------------
  // 3. Cash Flow Statement (Direct Method, Reconciled to BS Cash)
  // --------------------------------------------------------------------------
  let beginningCash = 0;
  for (const acc of coaList) {
    if (!isCashAccount(acc)) continue;
    const t = priorTotals.get(acc.id);
    if (t) {
      beginningCash = round2(beginningCash + (t.debit - t.credit));
    }
  }

  const operatingMap = new Map<string, CashFlowActivityLine>();
  const investingMap = new Map<string, CashFlowActivityLine>();
  const financingMap = new Map<string, CashFlowActivityLine>();

  const addCashBucket = (
    bucket: Map<string, CashFlowActivityLine>,
    acc: ChartOfAccountRecord,
    delta: number
  ) => {
    const prev = bucket.get(acc.id) || {
      account_id: acc.id,
      code: acc.code,
      name: acc.name,
      amount: 0,
      txCount: 0,
    };
    prev.amount = round2(prev.amount + delta);
    prev.txCount += 1;
    bucket.set(acc.id, prev);
  };

  for (const tx of labeledInPeriod) {
    let cashIn = 0;
    let cashOut = 0;
    const nonCashLines: Array<{ acc: ChartOfAccountRecord; signedEffect: number }> = [];

    for (const line of tx.lines) {
      const acc = coaById.get(line.account_id);
      if (!acc) continue;
      if (isCashAccount(acc)) {
        if (line.type === 'DEBIT') cashIn = round2(cashIn + line.amount);
        else cashOut = round2(cashOut + line.amount);
      } else {
        // Counterpart credit brings cash IN (+), counterpart debit takes cash OUT (-)
        const signed = line.type === 'CREDIT' ? line.amount : -line.amount;
        nonCashLines.push({ acc, signedEffect: signed });
      }
    }

    const netCashDelta = round2(cashIn - cashOut);
    // Skip non-cash transactions & pure cash-to-cash internal transfers
    if (Math.abs(netCashDelta) <= 0.005 || nonCashLines.length === 0) continue;

    // Allocate netCashDelta across counterpart lines (exact when counterpart sum equals netCashDelta)
    const sumCounterpart = round2(
      nonCashLines.reduce((s, c) => s + c.signedEffect, 0)
    );
    const scale =
      Math.abs(sumCounterpart) > 0.005 ? netCashDelta / sumCounterpart : 0;

    let allocatedSoFar = 0;
    for (let idx = 0; idx < nonCashLines.length; idx += 1) {
      const { acc, signedEffect } = nonCashLines[idx];
      const share =
        idx === nonCashLines.length - 1
          ? round2(netCashDelta - allocatedSoFar)
          : scale !== 0
            ? round2(signedEffect * scale)
            : round2(netCashDelta / nonCashLines.length);
      allocatedSoFar = round2(allocatedSoFar + share);

      if (isFixedAssetAccount(acc)) {
        addCashBucket(investingMap, acc, share);
      } else if (acc.category === 'EQUITY' || isNonCurrentLiabilityAccount(acc)) {
        addCashBucket(financingMap, acc, share);
      } else {
        addCashBucket(operatingMap, acc, share);
      }
    }
  }

  const sortCashLines = (m: Map<string, CashFlowActivityLine>) =>
    Array.from(m.values())
      .filter((l) => Math.abs(l.amount) > 0.005)
      .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));

  const operating = sortCashLines(operatingMap);
  const investing = sortCashLines(investingMap);
  const financing = sortCashLines(financingMap);

  const netOperatingCash = round2(operating.reduce((s, l) => s + l.amount, 0));
  const netInvestingCash = round2(investing.reduce((s, l) => s + l.amount, 0));
  const netFinancingCash = round2(financing.reduce((s, l) => s + l.amount, 0));
  const netChangeInCash = round2(
    netOperatingCash + netInvestingCash + netFinancingCash
  );
  const endingCash = round2(beginningCash + netChangeInCash);
  const cashDiscrepancy = round2(endingCash - balanceSheetCash);

  const cashFlow: CashFlowReport = {
    beginningCash,
    operating,
    netOperatingCash,
    investing,
    netInvestingCash,
    financing,
    netFinancingCash,
    netChangeInCash,
    endingCash,
    balanceSheetCash,
    cashDiscrepancy,
    isReconciled: Math.abs(cashDiscrepancy) <= 0.01,
  };

  return {
    company: targetCompany,
    period: { startDate, endDate },
    generatedAt: new Date().toISOString(),
    integrity,
    incomeStatement,
    balanceSheet,
    cashFlow,
  };
}
