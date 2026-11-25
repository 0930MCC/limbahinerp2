import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Download,
  Edit3,
  ExternalLink,
  FileBarChart2,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { api, formatIDR } from '../lib/api.ts';
import { useFeedback } from '../lib/feedback.tsx';
import { formatBytes } from '../lib/imageCompression.ts';
import { useNavigation, type LedgerStatusFilter } from '../lib/navigation.tsx';
import {
  CSV_IMPORT_BATCH_SIZE,
  buildLedgerCsvBatches,
} from '../shared/csvZipMatcher.ts';
import {
  RCRD_SOURCE_TYPE_OPTIONS,
  REFERENCE_MODEL_OPTIONS,
  normalizeRcrdSourceType,
} from '../shared/appOptions.ts';
import { rankBySimilarity } from '../shared/fuzzySearch.ts';
import type {
  ChartOfAccountRecord,
  CoaCategory,
  CoaNormalBalance,
  CoaStatement,
  EntityKey,
  LedgerCsvImportResult,
  LedgerEntryType,
  RcrdSourceType,
  TransactionLabelStatus,
  TransactionRecord,
  UnpaidInvoiceSummary,
  WorkerRecord,
} from '../shared/types.ts';
import { ReferencePickerField } from './ReferencePickerField.tsx';
import {
  SearchableSelectField,
  type SearchableSelectOption,
} from './SearchableSelectField.tsx';
import { TableSkeleton } from './Skeleton.tsx';

const REF_MODEL_TO_ENTITY: Record<string, EntityKey> = {
  invoice: 'invoices',
  commission: 'commissions',
  berita_acara: 'berita_acara',
  purchase_order: 'purchase_orders',
  fpl_real: 'fpl_real',
  fpl_doc: 'fpl_doc',
};

interface AccountingPageProps {
  view: 'records' | 'coa';
  worker: WorkerRecord;
}

interface DraftLine {
  key: string;
  type: LedgerEntryType;
  account_id: string;
  amount: string;
  reference_model: string;
  reference_model_id: string;
  reference_label?: string;
}

const COA_CATEGORIES: CoaCategory[] = [
  'ASSET',
  'LIABILITY',
  'EQUITY',
  'REVENUE',
  'EXPENSE',
];

const COA_GROUP_FILTERS = COA_CATEGORIES.map((c) => ({ value: c, label: c }));

function getCoaSearchKeywords(acc: ChartOfAccountRecord): string[] {
  const lower = `${acc.code} ${acc.name}`.toLowerCase();
  const kw: string[] = [acc.category, acc.normal_balance || '', acc.statement || ''];
  if (lower.includes('receivable') || lower.includes('1110')) {
    kw.push('ar', 'piutang', 'customer');
  }
  if (lower.includes('payable') || lower.includes('2010')) {
    kw.push('ap', 'hutang', 'utang', 'vendor');
  }
  if (lower.includes('cash') || lower.includes('bank') || lower.includes('1010') || lower.includes('1020')) {
    kw.push('kas', 'bca', 'bca1', 'tunai', 'transfer');
  }
  if (lower.includes('ppn') || lower.includes('vat') || lower.includes('tax') || lower.includes('pph')) {
    kw.push('pajak', 'tax', 'ppn', 'vat');
  }
  if (lower.includes('revenue') || acc.category === 'REVENUE') {
    kw.push('rev', 'sales', 'pendapatan', 'omzet', 'penjualan');
  }
  if (lower.includes('fuel')) kw.push('bbm', 'bensin', 'solar');
  if (lower.includes('commission')) kw.push('komisi', 'com');
  if (lower.includes('salar') || lower.includes('wage')) kw.push('gaji', 'payroll');
  if (lower.includes('bad debt')) kw.push('piutang tak tertagih', 'writeoff');
  return kw;
}

function formatCsvTimestamp(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${String(date.getFullYear()).slice(-2)}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

export function AccountingPage({ view, worker }: AccountingPageProps) {
  const {
    navigatePage,
    openLayer,
    dataVersion,
    notifyDataChanged,
    accountingPrefill,
    clearAccountingPrefill,
    ledgerStatusFilterHandoff,
    clearLedgerStatusFilterHandoff,
  } = useNavigation();
  const { notifyError, notifySuccess } = useFeedback();

  const [selectedCompanyId, setSelectedCompanyId] = useState<string>('');
  const [accounts, setAccounts] = useState<ChartOfAccountRecord[]>([]);
  const [records, setRecords] = useState<TransactionRecord[]>([]);
  const [unpaidInvoices, setUnpaidInvoices] = useState<UnpaidInvoiceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters & sorting
  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState<string>('all');
  const [labelStatusFilter, setLabelStatusFilter] =
    useState<LedgerStatusFilter>('all');
  const [coaCategoryFilter, setCoaCategoryFilter] = useState<string>('all');
  const [coaStatementFilter, setCoaStatementFilter] = useState<'all' | CoaStatement>('all');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});

  // Manual Journal Modal (RCRD + RCRD-CLSF)
  const [journalModalOpen, setJournalModalOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<TransactionRecord | null>(null);
  const [txDate, setTxDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [txSourceType, setTxSourceType] = useState<RcrdSourceType>('MANUAL');
  const [txDesc, setTxDesc] = useState('');
  const [txHeaderAmount, setTxHeaderAmount] = useState('');
  const [txNote, setTxNote] = useState('');
  const [draftLines, setDraftLines] = useState<DraftLine[]>([]);
  const [savingJournal, setSavingJournal] = useState(false);

  // Single-CSV Import Modal (unlimited rows via ~500-line group-safe batches)
  const [csvModalOpen, setCsvModalOpen] = useState(false);
  const [csvImportMode, setCsvImportMode] = useState<'insert' | 'update'>('insert');
  const [csvText, setCsvText] = useState('');
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [csvAllowDrafts, setCsvAllowDrafts] = useState(true);
  const [importingCsv, setImportingCsv] = useState(false);
  const [downloadingExistingLedger, setDownloadingExistingLedger] = useState(false);
  const [csvNextBatchIndex, setCsvNextBatchIndex] = useState(0);
  const [csvResult, setCsvResult] = useState<{
    batchTags: string[];
    groupsProcessed: number;
    createdCount: number;
    updatedCount: number;
    linesInserted: number;
    labeledCount: number;
    unlabeledCount: number;
    notEqualCount: number;
    errorCount: number;
    processedLines: number;
    completedBatches: number;
    logCreateIds: string[];
    logUpdateIds: string[];
    errors: Array<{ group: string; error: string }>;
  } | null>(null);

  const ledgerBatchPlan = useMemo(
    () => buildLedgerCsvBatches(csvText, CSV_IMPORT_BATCH_SIZE),
    [csvText]
  );
  const ledgerTotalLines = ledgerBatchPlan.totalDataRows;
  const ledgerTotalBatches = ledgerBatchPlan.batches.length;
  const isLedgerMultiBatch = ledgerTotalBatches > 1;
  const ledgerCurrentBatch = ledgerBatchPlan.batches[csvNextBatchIndex] ?? null;
  const isLedgerAllDone =
    ledgerTotalBatches > 0 && csvNextBatchIndex >= ledgerTotalBatches;
  const ledgerProcessedLines = csvResult?.processedLines ?? 0;
  const ledgerRemainingLines = Math.max(0, ledgerTotalLines - ledgerProcessedLines);

  const resetLedgerBatchProgress = () => {
    setCsvNextBatchIndex(0);
    setCsvResult(null);
  };

  // COA Create / Edit Modal
  const [coaModalOpen, setCoaModalOpen] = useState(false);
  const [editingCoa, setEditingCoa] = useState<ChartOfAccountRecord | null>(null);
  const [coaCode, setCoaCode] = useState('');
  const [coaName, setCoaName] = useState('');
  const [coaCategory, setCoaCategory] = useState<CoaCategory>('ASSET');
  const [coaNormalBalance, setCoaNormalBalance] = useState<CoaNormalBalance>('Debit');
  const [coaStatement, setCoaStatement] = useState<CoaStatement>('BS');
  const [savingCoa, setSavingCoa] = useState(false);

  const loadCompanies = useCallback(async () => {
    const res = await api.listCompanies();
    const defaultId = res.companies[0]?.id || '';
    setSelectedCompanyId((prev) =>
      prev && res.companies.some((c) => c.id === prev) ? prev : defaultId
    );
    return defaultId;
  }, []);

  const loadCompanyData = useCallback(async (companyId: string) => {
    if (!companyId) return;
    setLoading(true);
    setError(null);
    try {
      const [coaRes, recRes, unpaidRes] = await Promise.all([
        api.listChartOfAccounts(companyId),
        api.listLedgerRecords(companyId),
        api.listUnpaidActiveInvoices(companyId),
      ]);
      setAccounts(coaRes.accounts);
      setRecords(recRes.records);
      setUnpaidInvoices(unpaidRes.invoices);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to load accounting data.'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    loadCompanies()
      .then((firstId) => {
        if (active && firstId) {
          return loadCompanyData(firstId);
        }
        if (active) setLoading(false);
      })
      .catch((err) => {
        if (active) {
          setError(err instanceof Error ? err.message : 'Unable to load companies.');
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [loadCompanies, loadCompanyData]);

  useEffect(() => {
    if (selectedCompanyId) {
      loadCompanyData(selectedCompanyId);
    }
  }, [selectedCompanyId, dataVersion, loadCompanyData]);

  // Apply filter handoff when jumping from Financial Statements integrity alert
  useEffect(() => {
    if (view === 'records' && ledgerStatusFilterHandoff) {
      setLabelStatusFilter(ledgerStatusFilterHandoff);
      clearLedgerStatusFilterHandoff();
    }
  }, [view, ledgerStatusFilterHandoff, clearLedgerStatusFilterHandoff]);

  // Open Manual Journal pre-filled when arriving from Cancel Invoice Option B
  useEffect(() => {
    if (view !== 'records' || !accountingPrefill || accounts.length === 0) return;

    const arAcc =
      accounts.find((a) => a.code === 'COA-1110') ||
      accounts.find((a) => a.name.toLowerCase().includes('accounts receivable')) ||
      accounts[0];
    const badDebtAcc =
      accounts.find((a) => a.code === 'COA-6060') ||
      accounts.find((a) => a.name.toLowerCase().includes('bad debt')) ||
      accounts.find((a) => a.category === 'EXPENSE') ||
      accounts[0];
    const defaultAmt = accountingPrefill.amount ? String(accountingPrefill.amount) : '';

    setEditingRecord(null);
    setTxDate(new Date().toISOString().slice(0, 10));
    setTxSourceType('ADJUSTMENT');
    setTxDesc(
      accountingPrefill.description ||
        `Manual Adjustment: ${accountingPrefill.refLabel || accountingPrefill.refId}`
    );
    setTxNote(accountingPrefill.note || '');
    setDraftLines([
      {
        key: 'l-1',
        type: 'DEBIT',
        account_id: badDebtAcc?.id || '',
        amount: defaultAmt,
        reference_model: accountingPrefill.refModel,
        reference_model_id: accountingPrefill.refId,
        reference_label: accountingPrefill.refLabel || accountingPrefill.refId,
      },
      {
        key: 'l-2',
        type: 'CREDIT',
        account_id: arAcc?.id || '',
        amount: defaultAmt,
        reference_model: accountingPrefill.refModel,
        reference_model_id: accountingPrefill.refId,
        reference_label: accountingPrefill.refLabel || accountingPrefill.refId,
      },
    ]);
    setJournalModalOpen(true);
    clearAccountingPrefill();
  }, [view, accountingPrefill, accounts, clearAccountingPrefill]);

  const bankAccounts = useMemo(
    () =>
      accounts.filter(
        (a) =>
          a.category === 'ASSET' &&
          (a.code === 'COA-1010' ||
            a.code === 'COA-1020' ||
            a.name.toLowerCase().includes('cash') ||
            a.name.toLowerCase().includes('bank') ||
            a.name.toLowerCase().includes('kas'))
      ),
    [accounts]
  );

  const coaSearchOptions = useMemo<SearchableSelectOption[]>(
    () =>
      accounts.map((a) => ({
        value: a.id,
        code: a.code,
        label: a.name,
        subtitle: `${a.category} · Normal ${a.normal_balance || 'Debit'}`,
        meta: `${a.statement || 'BS'} · ${a.category}`,
        group: a.category,
        keywords: getCoaSearchKeywords(a),
      })),
    [accounts]
  );

  const unpaidInvoiceSearchOptions = useMemo<SearchableSelectOption[]>(
    () =>
      unpaidInvoices.map((inv) => ({
        value: inv.id,
        code: inv.invoice_number,
        label: inv.client_name,
        subtitle: `Due ${inv.due_date || '—'} · Total ${formatIDR(inv.total_amount)}`,
        meta: `Bal: ${formatIDR(inv.remaining_balance)}`,
        keywords: [inv.id, inv.invoice_number, inv.client_name, inv.client_id, inv.issue_date],
      })),
    [unpaidInvoices]
  );

  // KPI metrics for Ledger
  const ledgerMetrics = useMemo(() => {
    const labeledRecords = records.filter((r) => r.label_status === 'labeled');
    const unlabeledCount = records.filter(
      (r) => r.label_status === 'unlabeled'
    ).length;
    const notEqualCount = records.filter(
      (r) => r.label_status === 'not_equal'
    ).length;
    const totalVolume = labeledRecords.reduce(
      (sum, r) => sum + Number(r.transaction_amount || 0),
      0
    );
    const totalUnpaidAr = unpaidInvoices.reduce(
      (sum, inv) => sum + Number(inv.remaining_balance || 0),
      0
    );
    const adjustmentCount = records.filter(
      (r) => normalizeRcrdSourceType(r.source_type) === 'ADJUSTMENT'
    ).length;
    return {
      totalVolume,
      totalUnpaidAr,
      unpaidCount: unpaidInvoices.length,
      recordCount: records.length,
      labeledCount: labeledRecords.length,
      unlabeledCount,
      notEqualCount,
      reversalCount: adjustmentCount,
    };
  }, [records, unpaidInvoices]);

  const filteredRecords = useMemo(() => {
    const q = search.trim().toLowerCase();
    return records
      .filter((rec) => {
        if (
          sourceFilter !== 'all' &&
          normalizeRcrdSourceType(rec.source_type) !== sourceFilter
        ) {
          return false;
        }
        if (labelStatusFilter !== 'all' && rec.label_status !== labelStatusFilter) {
          return false;
        }
        if (!q) return true;
        const tokens = [
          rec.id,
          rec.transaction_date,
          rec.source_type,
          normalizeRcrdSourceType(rec.source_type),
          rec.label_status,
          rec.id_log_create || '',
          rec.id_log_update || '',
          rec.transaction_description || '',
          rec.transaction_note || '',
          ...rec.lines.flatMap((l) => [
            l.type,
            l.account_code || '',
            l.account_name || '',
            l.reference_model || '',
            l.reference_model_id || '',
            l.reference_label || '',
          ]),
        ];
        return tokens.some((t) => t.toLowerCase().includes(q));
      })
      .sort((a, b) => {
        const cmp =
          a.transaction_date.localeCompare(b.transaction_date) ||
          a.created_at.localeCompare(b.created_at);
        return sortDir === 'asc' ? cmp : -cmp;
      });
  }, [records, search, sourceFilter, labelStatusFilter, sortDir]);

  const filteredCoa = useMemo(() => {
    const base = accounts.filter((acc) => {
      if (coaCategoryFilter !== 'all' && acc.category !== coaCategoryFilter) {
        return false;
      }
      if (coaStatementFilter !== 'all' && acc.statement !== coaStatementFilter) {
        return false;
      }
      return true;
    });
    const q = search.trim();
    if (q) {
      return rankBySimilarity(
        base,
        q,
        (acc) => [
          { text: acc.code, weight: 1.15 },
          { text: acc.name, weight: 1.05 },
          { text: getCoaSearchKeywords(acc).join(' '), weight: 0.9 },
        ],
        (acc) => acc.code
      ).map((r) => r.item);
    }
    return [...base].sort((a, b) => {
      const cmp = a.code.localeCompare(b.code, undefined, { numeric: true });
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [accounts, search, coaCategoryFilter, coaStatementFilter, sortDir]);

  const openNewJournal = () => {
    const defaultDebit = bankAccounts[0]?.id || accounts[0]?.id || '';
    const defaultCredit =
      accounts.find((a) => a.code === 'COA-1110')?.id ||
      accounts.find((a) => a.name.toLowerCase().includes('accounts receivable'))?.id ||
      accounts[1]?.id ||
      accounts[0]?.id ||
      '';
    setEditingRecord(null);
    setTxDate(new Date().toISOString().slice(0, 10));
    setTxSourceType('MANUAL');
    setTxDesc('');
    setTxHeaderAmount('');
    setTxNote('');
    setDraftLines([
      {
        key: `l-${Date.now()}-1`,
        type: 'DEBIT',
        account_id: defaultDebit,
        amount: '',
        reference_model: '',
        reference_model_id: '',
      },
      {
        key: `l-${Date.now()}-2`,
        type: 'CREDIT',
        account_id: defaultCredit,
        amount: '',
        reference_model: 'invoice',
        reference_model_id: '',
      },
    ]);
    setJournalModalOpen(true);
  };

  const openEditJournal = (rec: TransactionRecord) => {
    setEditingRecord(rec);
    setTxDate(rec.transaction_date);
    setTxSourceType(normalizeRcrdSourceType(rec.source_type));
    setTxDesc(rec.transaction_description || '');
    setTxHeaderAmount(String(rec.transaction_amount || ''));
    setTxNote(rec.transaction_note || '');
    setDraftLines(
      rec.lines.map((l, idx) => ({
        key: l.id || `edit-${idx}`,
        type: l.type,
        account_id: l.account_id,
        amount: String(l.amount),
        reference_model: l.reference_model || '',
        reference_model_id: l.reference_model_id || '',
        reference_label: l.reference_label || undefined,
      }))
    );
    setJournalModalOpen(true);
  };

  const handleQuickApplyUnpaidInvoice = (invId: string) => {
    const inv = unpaidInvoices.find((i) => i.id === invId);
    if (!inv) return;
    const bankAcc = bankAccounts[0] || accounts.find((a) => a.code === 'COA-1010');
    const arAcc =
      accounts.find((a) => a.code === 'COA-1110') ||
      accounts.find((a) => a.name.toLowerCase().includes('accounts receivable')) ||
      accounts[0];
    setTxSourceType('BCA1');
    setTxDesc(`Payment ${inv.client_name} (${inv.invoice_number})`);
    setTxHeaderAmount(String(inv.remaining_balance));
    setDraftLines([
      {
        key: `pay-${Date.now()}-1`,
        type: 'DEBIT',
        account_id: bankAcc?.id || accounts[0]?.id || '',
        amount: String(inv.remaining_balance),
        reference_model: '',
        reference_model_id: '',
      },
      {
        key: `pay-${Date.now()}-2`,
        type: 'CREDIT',
        account_id: arAcc?.id || '',
        amount: String(inv.remaining_balance),
        reference_model: 'invoice',
        reference_model_id: inv.id,
        reference_label: `${inv.invoice_number} · ${inv.client_name}`,
      },
    ]);
  };

  const draftBalance = useMemo(() => {
    let dr = 0;
    let cr = 0;
    for (const l of draftLines) {
      const n = Number(l.amount || 0);
      if (!Number.isFinite(n) || n <= 0) continue;
      if (l.type === 'DEBIT') dr += n;
      else cr += n;
    }
    const diff = Math.round((dr - cr) * 100) / 100;
    const status: TransactionLabelStatus =
      draftLines.length === 0
        ? 'unlabeled'
        : draftLines.length >= 2 && dr > 0 && Math.abs(diff) < 0.005
          ? 'labeled'
          : 'not_equal';
    const headerAmtNum = Number(txHeaderAmount || 0);
    const canSave =
      draftLines.length === 0
        ? Number.isFinite(headerAmtNum) && headerAmtNum > 0
        : draftLines.every(
            (l) => Boolean(l.account_id) && Number.isFinite(Number(l.amount)) && Number(l.amount) > 0
          );
    return {
      dr,
      cr,
      diff,
      status,
      isBalanced: status === 'labeled',
      canSave,
    };
  }, [draftLines, txHeaderAmount]);

  const handleSaveJournal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draftBalance.canSave) {
      notifyError(
        draftLines.length === 0
          ? 'Enter a positive header amount to save an unlabeled transaction.'
          : 'Each classification line must have an account and an amount greater than 0.'
      );
      return;
    }
    setSavingJournal(true);
    try {
      const payload = {
        company_id: selectedCompanyId,
        source_type: txSourceType,
        bank_account_id: null,
        transaction_date: txDate,
        transaction_description: txDesc.trim(),
        transaction_amount:
          draftLines.length === 0 ? Number(txHeaderAmount) : undefined,
        transaction_note: txNote.trim() || null,
        lines: draftLines.map((l) => ({
          type: l.type,
          account_id: l.account_id,
          amount: Number(l.amount),
          reference_model: l.reference_model || null,
          reference_model_id: l.reference_model_id.trim() || null,
        })),
      };
      if (editingRecord) {
        await api.updateLedgerRecord(editingRecord.id, payload);
        notifySuccess(
          draftBalance.status === 'labeled'
            ? 'Transaction record labeled & balanced.'
            : draftBalance.status === 'unlabeled'
              ? 'Transaction record saved as Unlabeled.'
              : 'Transaction record saved as Not Equal (DR ≠ CR).'
        );
      } else {
        await api.createLedgerRecord(payload);
        notifySuccess(
          draftBalance.status === 'labeled'
            ? 'Labeled journal entry posted to ledger.'
            : draftBalance.status === 'unlabeled'
              ? 'Unlabeled transaction record saved.'
              : 'Draft entry saved as Not Equal (DR ≠ CR).'
        );
      }
      setJournalModalOpen(false);
      notifyDataChanged();
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Failed to save entry.');
    } finally {
      setSavingJournal(false);
    }
  };

  const handleDeleteRecord = async (rec: TransactionRecord) => {
    try {
      await api.deleteLedgerRecord(rec.id);
      notifySuccess('Transaction record deleted.');
      notifyDataChanged();
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Failed to delete entry.');
    }
  };

  const LEDGER_INSERT_HEADERS =
    'group_no,transaction_date,source_type (MANUAL | BCA1 | SYSTEM | ADJUSTMENT),description,note,type (DEBIT | CREDIT),account_code (ref),amount,ref_model (invoice | commission | payroll | expense | berita_acara | purchase_order | fpl_real | fpl_doc),ref_number (ref)';

  const LEDGER_UPDATE_HEADERS = `rcrd_id (ref),${LEDGER_INSERT_HEADERS}`;

  const handleDownloadLedgerTemplate = () => {
    const today = new Date().toISOString().slice(0, 10);
    const inv1 = unpaidInvoices[0]?.invoice_number || 'INV-26-1001';
    const inv2 = unpaidInvoices[1]?.invoice_number || 'INV-26-1002';
    const sample = [
      `1,${today},BCA1,Split Payment PT Maju,Bank Transfer,DEBIT,COA-1010,10000000,,`,
      `1,${today},BCA1,Split Payment PT Maju,Bank Transfer,CREDIT,COA-1110,6000000,invoice,${inv1}`,
      `1,${today},BCA1,Split Payment PT Maju,Bank Transfer,CREDIT,COA-1110,4000000,invoice,${inv2}`,
    ].join('\r\n');
    const content = `sep=,\r\n${LEDGER_INSERT_HEADERS}\r\n${sample}\r\n`;
    const fileName = `limbahin-ledger-insert-${formatCsvTimestamp()}.csv`;
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportExistingLedgerCsv = async () => {
    setDownloadingExistingLedger(true);
    try {
      const content = await api.exportLedgerCsv(selectedCompanyId);
      const fileName = `limbahin-ledger-existing-${formatCsvTimestamp()}.csv`;
      const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
      notifySuccess(`Downloaded ${fileName}.`);
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Export failed.');
    } finally {
      setDownloadingExistingLedger(false);
    }
  };

  const handleImportLedgerCsv = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!csvText.trim()) {
      notifyError('Upload a CSV file or paste ledger CSV rows first.');
      return;
    }
    if (!ledgerCurrentBatch) {
      notifyError(
        ledgerTotalBatches === 0
          ? 'CSV must include a header row and at least one ledger line.'
          : 'All batches have already been imported.'
      );
      return;
    }

    setImportingCsv(true);
    try {
      const res: LedgerCsvImportResult = await api.importLedgerCsv({
        companyId: selectedCompanyId,
        mode: csvImportMode,
        csvText: ledgerCurrentBatch.csvText,
        allowDrafts: csvAllowDrafts,
        excelRowOffset: ledgerCurrentBatch.excelRowOffset,
      });

      const nextIndex = ledgerCurrentBatch.batchIndex + 1;
      const hasMore = nextIndex < ledgerTotalBatches;

      setCsvResult((prev) => {
        const logCreateIds = prev ? [...prev.logCreateIds] : [];
        if (res.logCreateId && !logCreateIds.includes(res.logCreateId)) {
          logCreateIds.push(res.logCreateId);
        }
        const logUpdateIds = prev ? [...prev.logUpdateIds] : [];
        if (res.logUpdateId && !logUpdateIds.includes(res.logUpdateId)) {
          logUpdateIds.push(res.logUpdateId);
        }
        return {
          batchTags: [...(prev?.batchTags ?? []), res.batchTag],
          groupsProcessed: (prev?.groupsProcessed ?? 0) + res.groupsProcessed,
          createdCount: (prev?.createdCount ?? 0) + res.createdCount,
          updatedCount: (prev?.updatedCount ?? 0) + res.updatedCount,
          linesInserted: (prev?.linesInserted ?? 0) + res.linesInserted,
          labeledCount: (prev?.labeledCount ?? 0) + (res.labeledCount ?? 0),
          unlabeledCount: (prev?.unlabeledCount ?? 0) + (res.unlabeledCount ?? 0),
          notEqualCount: (prev?.notEqualCount ?? 0) + (res.notEqualCount ?? 0),
          errorCount: (prev?.errorCount ?? 0) + res.errorCount,
          processedLines:
            (prev?.processedLines ?? 0) + ledgerCurrentBatch.rowCount,
          completedBatches: (prev?.completedBatches ?? 0) + 1,
          logCreateIds,
          logUpdateIds,
          errors: [...(prev?.errors ?? []), ...res.errors],
        };
      });
      setCsvNextBatchIndex(nextIndex);

      if (res.groupsProcessed > 0) {
        notifyDataChanged();
        if (isLedgerMultiBatch && hasMore) {
          notifySuccess(
            `Batch ${ledgerCurrentBatch.batchNumber}/${ledgerTotalBatches} done (${res.groupsProcessed} group(s)). Click Continue for the next batch.`
          );
        } else if (isLedgerMultiBatch) {
          notifySuccess(
            `All ${ledgerTotalLines.toLocaleString()} ledger lines finished across ${ledgerTotalBatches} batches.`
          );
        } else {
          notifySuccess(
            `Processed ${res.groupsProcessed} group(s): ${res.createdCount} created, ${res.updatedCount} updated.`
          );
        }
      } else if (res.errorCount > 0) {
        notifyError(
          `Batch ${ledgerCurrentBatch.batchNumber} completed with ${res.errorCount} group error(s).`
        );
      }
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Ledger CSV import failed.');
    } finally {
      setImportingCsv(false);
    }
  };

  const openCreateCoa = () => {
    setEditingCoa(null);
    setCoaCode('');
    setCoaName('');
    setCoaCategory('ASSET');
    setCoaNormalBalance('Debit');
    setCoaStatement('BS');
    setCoaModalOpen(true);
  };

  const openEditCoa = (acc: ChartOfAccountRecord) => {
    setEditingCoa(acc);
    setCoaCode(acc.code);
    setCoaName(acc.name);
    setCoaCategory(acc.category);
    setCoaNormalBalance(acc.normal_balance || 'Debit');
    setCoaStatement(acc.statement || 'BS');
    setCoaModalOpen(true);
  };

  const handleCoaCategoryChange = (nextCat: CoaCategory) => {
    setCoaCategory(nextCat);
    if (!editingCoa) {
      setCoaNormalBalance(
        nextCat === 'ASSET' || nextCat === 'EXPENSE' ? 'Debit' : 'Credit'
      );
      setCoaStatement(nextCat === 'REVENUE' || nextCat === 'EXPENSE' ? 'IS' : 'BS');
    }
  };

  const handleSaveCoa = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingCoa(true);
    try {
      if (editingCoa) {
        await api.updateChartOfAccount(editingCoa.id, {
          code: coaCode.trim(),
          name: coaName.trim(),
          category: coaCategory,
          normal_balance: coaNormalBalance,
          statement: coaStatement,
        });
        notifySuccess(`Account ${coaCode} updated.`);
      } else {
        await api.createChartOfAccount({
          company_id: selectedCompanyId,
          code: coaCode.trim(),
          name: coaName.trim(),
          category: coaCategory,
          normal_balance: coaNormalBalance,
          statement: coaStatement,
        });
        notifySuccess(`Account ${coaCode} added to Chart of Accounts.`);
      }
      setCoaModalOpen(false);
      notifyDataChanged();
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Failed to save account.');
    } finally {
      setSavingCoa(false);
    }
  };

  const handleDeleteCoa = async (acc: ChartOfAccountRecord) => {
    try {
      await api.deleteChartOfAccount(acc.id);
      notifySuccess(`Account ${acc.code} deleted.`);
      notifyDataChanged();
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Failed to delete account.');
    }
  };

  return (
    <div className="space-y-5">
      {/* KPI Summary Strip (Ledger View) */}
      {view === 'records' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <p className="text-xs text-slate-500">Labeled Entries (Statement Ready)</p>
            <p className="mt-1.5 font-mono text-2xl font-bold text-teal-800 tabular-nums">
              {ledgerMetrics.labeledCount}
              <span className="text-sm font-normal text-slate-400">
                {' '}
                / {ledgerMetrics.recordCount}
              </span>
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {ledgerMetrics.reversalCount} adjustment
              {ledgerMetrics.reversalCount === 1 ? '' : 's'}
            </p>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <p className="text-xs text-slate-500">Needs Labeling / Balancing</p>
            <p
              className={`mt-1.5 font-mono text-2xl font-bold tabular-nums ${
                ledgerMetrics.unlabeledCount + ledgerMetrics.notEqualCount > 0
                  ? 'text-amber-700'
                  : 'text-slate-900'
              }`}
            >
              {ledgerMetrics.unlabeledCount + ledgerMetrics.notEqualCount}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {ledgerMetrics.unlabeledCount} unlabeled &middot;{' '}
              {ledgerMetrics.notEqualCount} not equal (DR &ne; CR)
            </p>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <p className="text-xs text-slate-500">Labeled Ledger Volume</p>
            <p className="mt-1.5 font-mono text-xl font-bold text-slate-900 tabular-nums truncate">
              {formatIDR(ledgerMetrics.totalVolume)}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Balanced entries feeding BS, IS &amp; Cash Flow
            </p>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <p className="text-xs text-slate-500">Active Unpaid Receivables</p>
            <p className="mt-1.5 font-mono text-xl font-bold text-slate-900 tabular-nums truncate">
              {formatIDR(ledgerMetrics.totalUnpaidAr)}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {ledgerMetrics.unpaidCount} active invoice
              {ledgerMetrics.unpaidCount === 1 ? '' : 's'} (canceled excluded)
            </p>
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="bg-white border border-slate-200 rounded-xl p-3.5 space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5 flex-1">
            <div className="relative flex-1 min-w-[220px] max-w-md">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={
                  view === 'records'
                    ? 'Search RCRD ID, description, log ID, account code, or invoice...'
                    : 'Search account code, name, or category...'
                }
                className="w-full pl-9 pr-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:bg-white focus:ring-2 focus:ring-teal-600/25 focus:border-teal-700"
              />
            </div>

            <button
              type="button"
              onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
              className="inline-flex items-center gap-1 px-2.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap"
            >
              {sortDir === 'asc' ? (
                <>
                  <ArrowUp className="w-3.5 h-3.5 text-teal-700" />
                  <span>{view === 'records' ? 'Oldest' : 'Code Asc'}</span>
                </>
              ) : (
                <>
                  <ArrowDown className="w-3.5 h-3.5 text-teal-700" />
                  <span>{view === 'records' ? 'Newest' : 'Code Desc'}</span>
                </>
              )}
            </button>

            {(search ||
              sourceFilter !== 'all' ||
              labelStatusFilter !== 'all' ||
              coaCategoryFilter !== 'all' ||
              coaStatementFilter !== 'all') && (
              <button
                type="button"
                onClick={() => {
                  setSearch('');
                  setSourceFilter('all');
                  setLabelStatusFilter('all');
                  setCoaCategoryFilter('all');
                  setCoaStatementFilter('all');
                }}
                className="inline-flex items-center gap-1 px-2.5 py-2 text-xs font-medium text-slate-600 bg-slate-50 border border-slate-200 hover:bg-slate-100 rounded-lg"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Reset
              </button>
            )}
          </div>

          {view === 'records' ? (
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => navigatePage('/b3/accounting/statements')}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-teal-800 bg-[#EFF8F8] border border-teal-200 hover:bg-teal-50 rounded-lg transition-colors whitespace-nowrap"
              >
                <FileBarChart2 className="w-3.5 h-3.5" />
                Financial Statements
              </button>
              <button
                type="button"
                onClick={() => {
                  setCsvResult(null);
                  setCsvModalOpen(true);
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap"
              >
                <Upload className="w-3.5 h-3.5" />
                Single-CSV Import
              </button>
              <button
                type="button"
                onClick={openNewJournal}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg transition-colors whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                New Record
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={openCreateCoa}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Account
            </button>
          )}
        </div>

        {/* Filter Segmented Strip */}
        <div className="flex flex-wrap items-center gap-2.5 pt-2.5 border-t border-slate-100">
          {view === 'records' ? (
            <>
              <div className="flex items-center gap-1 p-1 bg-slate-50 border border-slate-200 rounded-lg overflow-x-auto">
                {(
                  [
                    { id: 'all', label: `All Status (${ledgerMetrics.recordCount})` },
                    { id: 'labeled', label: `Labeled (${ledgerMetrics.labeledCount})` },
                    {
                      id: 'unlabeled',
                      label: `Unlabeled (${ledgerMetrics.unlabeledCount})`,
                    },
                    {
                      id: 'not_equal',
                      label: `Not Equal (${ledgerMetrics.notEqualCount})`,
                    },
                  ] as const
                ).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setLabelStatusFilter(item.id)}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                      labelStatusFilter === item.id
                        ? 'bg-teal-700 text-white'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-1 p-1 bg-slate-50 border border-slate-200 rounded-lg overflow-x-auto">
                {(['all', 'MANUAL', 'BCA1', 'SYSTEM', 'ADJUSTMENT'] as const).map(
                  (src) => (
                    <button
                      key={src}
                      type="button"
                      onClick={() => setSourceFilter(src)}
                      className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                        sourceFilter === src
                          ? 'bg-teal-700 text-white'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {src === 'all' ? 'All Types' : src}
                    </button>
                  )
                )}
              </div>
            </>
          ) : (
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="flex items-center gap-1 p-1 bg-slate-50 border border-slate-200 rounded-lg overflow-x-auto">
                {(['all', ...COA_CATEGORIES] as const).map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setCoaCategoryFilter(cat)}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                      coaCategoryFilter === cat
                        ? 'bg-teal-700 text-white'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {cat === 'all' ? 'All Categories' : cat}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-1 p-1 bg-slate-50 border border-slate-200 rounded-lg">
                {(['all', 'BS', 'IS'] as const).map((stmt) => (
                  <button
                    key={stmt}
                    type="button"
                    onClick={() => setCoaStatementFilter(stmt)}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                      coaStatementFilter === stmt
                        ? 'bg-teal-700 text-white'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {stmt === 'all'
                      ? 'All Statements'
                      : stmt === 'BS'
                        ? 'BS (Balance Sheet)'
                        : 'IS (Income Statement)'}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-800"
        >
          {error}
        </div>
      )}

      {/* Main Data Table */}
      {loading ? (
        <TableSkeleton columns={view === 'records' ? 8 : 7} rows={6} />
      ) : view === 'records' ? (
        filteredRecords.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-xl p-12 text-center">
            <p className="font-display text-base font-semibold text-slate-900">
              No ledger transaction records found
            </p>
            <p className="mt-1.5 text-sm text-slate-500 max-w-md mx-auto">
              Create an invoice to auto-post AR/Revenue/PPN entries, upload a
              Single-CSV Excel batch, or add a manual transaction record.
            </p>
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500">
                    <th className="py-3 px-4 w-8" />
                    <th className="py-3 px-4 whitespace-nowrap">Date</th>
                    <th className="py-3 px-4 whitespace-nowrap">Label Status</th>
                    <th className="py-3 px-4 whitespace-nowrap">Record Type</th>
                    <th className="py-3 px-4">Description &amp; Split Lines</th>
                    <th className="py-3 px-4 whitespace-nowrap">Log Ref</th>
                    <th className="py-3 px-4 text-right whitespace-nowrap">
                      Amount (IDR)
                    </th>
                    <th className="py-3 px-4 text-right whitespace-nowrap">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredRecords.map((rec) => {
                    const isExpanded = expandedIds[rec.id] !== false;
                    const activeLogId = rec.id_log_update || rec.id_log_create || null;
                    return (
                      <React.Fragment key={rec.id}>
                        <tr
                          onClick={() =>
                            setExpandedIds((prev) => ({
                              ...prev,
                              [rec.id]: !isExpanded,
                            }))
                          }
                          className="hover:bg-[#F3FAFA] transition-colors cursor-pointer"
                        >
                          <td className="py-3 px-4 text-slate-400">
                            {isExpanded ? (
                              <ChevronDown className="w-4 h-4" />
                            ) : (
                              <ChevronRight className="w-4 h-4" />
                            )}
                          </td>
                          <td className="py-3 px-4 font-mono text-xs text-slate-700 whitespace-nowrap tabular-nums">
                            {rec.transaction_date}
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            {rec.label_status === 'labeled' ? (
                              <span className="text-xs font-semibold text-teal-700">
                                Labeled
                              </span>
                            ) : rec.label_status === 'unlabeled' ? (
                              <div>
                                <span className="text-xs font-semibold text-amber-700">
                                  Unlabeled
                                </span>
                                <p className="text-[11px] text-slate-500">
                                  No account lines
                                </p>
                              </div>
                            ) : (
                              <div>
                                <span className="text-xs font-semibold text-red-700">
                                  Not Equal (DR &ne; CR)
                                </span>
                                <p className="text-[11px] font-mono text-red-600 tabular-nums">
                                  Diff {formatIDR(Math.abs(rec.balance_diff))}
                                </p>
                              </div>
                            )}
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            {(() => {
                              const recType = normalizeRcrdSourceType(rec.source_type);
                              return (
                                <span
                                  className={`font-mono text-xs font-semibold ${
                                    recType === 'ADJUSTMENT'
                                      ? 'text-red-700'
                                      : recType === 'SYSTEM'
                                        ? 'text-teal-700'
                                        : recType === 'BCA1'
                                          ? 'text-indigo-700'
                                          : 'text-slate-700'
                                  }`}
                                >
                                  {recType}
                                </span>
                              );
                            })()}
                          </td>
                          <td className="py-3 px-4">
                            <p className="text-sm font-medium text-slate-900">
                              {rec.transaction_description || 'Untitled Entry'}
                            </p>
                            <p className="text-[11px] font-mono text-slate-400 mt-0.5">
                              {rec.id}
                              {rec.transaction_note ? ` · ${rec.transaction_note}` : ''}
                            </p>
                          </td>
                          <td
                            className="py-3 px-4 whitespace-nowrap"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {activeLogId ? (
                              worker.role === 'master' ? (
                                <button
                                  type="button"
                                  onClick={() =>
                                    openLayer({
                                      kind: 'inspect',
                                      entity: 'logs',
                                      recordId: activeLogId,
                                    })
                                  }
                                  title={
                                    rec.id_log_update
                                      ? `Latest update log (created: ${rec.id_log_create || '—'})`
                                      : 'Creation audit log'
                                  }
                                  className="inline-flex items-center gap-1 font-mono text-xs text-teal-700 hover:underline font-medium"
                                >
                                  <span>{activeLogId}</span>
                                  <ExternalLink className="w-3 h-3" />
                                </button>
                              ) : (
                                <span className="font-mono text-xs text-slate-600">
                                  {activeLogId}
                                </span>
                              )
                            ) : (
                              <span className="text-xs text-slate-400">—</span>
                            )}
                            {rec.id_log_create &&
                              rec.id_log_update &&
                              rec.id_log_create !== rec.id_log_update && (
                                <p className="text-[10px] font-mono text-slate-400 mt-0.5">
                                  cr: {rec.id_log_create}
                                </p>
                              )}
                          </td>
                          <td className="py-3 px-4 text-right font-mono text-xs font-semibold text-slate-900 whitespace-nowrap tabular-nums">
                            {formatIDR(rec.transaction_amount)}
                          </td>
                          <td
                            className="py-3 px-4 text-right whitespace-nowrap"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div className="inline-flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => openEditJournal(rec)}
                                title={
                                  rec.label_status === 'labeled'
                                    ? 'Edit RCRD & split lines'
                                    : 'Label / balance transaction'
                                }
                                className="p-1.5 text-slate-500 hover:text-teal-800 hover:bg-slate-100 rounded-md"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteRecord(rec)}
                                title="Delete RCRD"
                                className="p-1.5 text-slate-500 hover:text-red-700 hover:bg-red-50 rounded-md"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>

                        {isExpanded && (
                          <tr className="bg-slate-50/60">
                            <td colSpan={8} className="px-6 py-2.5">
                              {rec.lines.length === 0 ? (
                                <div className="px-3.5 py-2.5 border border-amber-200/80 rounded-lg bg-amber-50/40 flex flex-wrap items-center justify-between gap-2 text-xs">
                                  <span className="text-amber-900">
                                    This transaction record has no account classifications yet and is excluded from BS, IS, and Cash Flow statements.
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => openEditJournal(rec)}
                                    className="font-semibold text-teal-800 hover:underline whitespace-nowrap"
                                  >
                                    Label Now &rarr;
                                  </button>
                                </div>
                              ) : (
                                <div className="divide-y divide-slate-200/70 border border-slate-200/80 rounded-lg bg-white overflow-hidden">
                                  {rec.lines.map((line) => (
                                    <div
                                      key={line.id}
                                      className="px-3.5 py-2 text-xs grid grid-cols-12 gap-2 items-center"
                                    >
                                      <span
                                        className={`col-span-2 font-mono font-semibold ${
                                          line.type === 'DEBIT'
                                            ? 'text-teal-800'
                                            : 'text-amber-800'
                                        }`}
                                      >
                                        {line.type}
                                      </span>
                                      <span className="col-span-5 text-slate-800 truncate">
                                        <span className="font-mono font-medium text-slate-600">
                                          {line.account_code || '—'}
                                        </span>{' '}
                                        {line.account_name || line.account_id}
                                      </span>
                                      <span className="col-span-3 text-slate-500 truncate">
                                        {line.reference_model === 'invoice' &&
                                        line.reference_model_id ? (
                                          <button
                                            type="button"
                                            onClick={() =>
                                              openLayer({
                                                kind: 'inspect',
                                                entity: 'invoices',
                                                recordId: line.reference_model_id!,
                                              })
                                            }
                                            className="inline-flex items-center gap-1 font-mono text-teal-700 hover:underline font-medium"
                                          >
                                            <span>
                                              invoice:{' '}
                                              {line.reference_label ||
                                                line.reference_model_id}
                                            </span>
                                            <ExternalLink className="w-3 h-3" />
                                          </button>
                                        ) : line.reference_model ? (
                                          <span className="font-mono">
                                            {line.reference_model}
                                            {line.reference_model_id
                                              ? `: ${line.reference_model_id}`
                                              : ''}
                                          </span>
                                        ) : (
                                          <span className="text-slate-400">—</span>
                                        )}
                                      </span>
                                      <span className="col-span-2 text-right font-mono tabular-nums text-slate-900 font-medium">
                                        {formatIDR(line.amount)}
                                      </span>
                                    </div>
                                  ))}
                                  {rec.label_status === 'not_equal' && (
                                    <div className="px-3.5 py-2 bg-red-50/60 flex flex-wrap items-center justify-between gap-2 text-xs text-red-800">
                                      <span className="font-mono tabular-nums">
                                        DR {formatIDR(rec.total_debit)} &ne; CR{' '}
                                        {formatIDR(rec.total_credit)} (Diff:{' '}
                                        {formatIDR(Math.abs(rec.balance_diff))}) &middot;
                                        Excluded from statements until balanced
                                      </span>
                                      <button
                                        type="button"
                                        onClick={() => openEditJournal(rec)}
                                        className="font-semibold text-red-800 hover:underline whitespace-nowrap"
                                      >
                                        Fix Balance &rarr;
                                      </button>
                                    </div>
                                  )}
                                </div>
                              )}
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )
      ) : (
        /* Chart of Accounts Table */
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500">
                  <th className="py-3 px-4 whitespace-nowrap">ID / Code</th>
                  <th className="py-3 px-4">Account Name</th>
                  <th className="py-3 px-4 whitespace-nowrap">Category</th>
                  <th className="py-3 px-4 whitespace-nowrap">Normal Balance</th>
                  <th className="py-3 px-4 whitespace-nowrap">Statement</th>
                  <th className="py-3 px-4 whitespace-nowrap">Log Ref</th>
                  <th className="py-3 px-4 text-right whitespace-nowrap">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredCoa.map((acc) => {
                  const coaLogId = acc.id_log_update || acc.id_log_create || null;
                  return (
                    <tr
                      key={acc.id}
                      className="hover:bg-[#F3FAFA] transition-colors"
                    >
                      <td className="py-3 px-4 font-mono text-xs font-semibold text-teal-800 whitespace-nowrap">
                        {acc.code}
                      </td>
                      <td className="py-3 px-4 text-sm text-slate-900 font-medium">
                        {acc.name}
                      </td>
                      <td className="py-3 px-4 font-mono text-xs text-slate-600 whitespace-nowrap">
                        {acc.category}
                      </td>
                      <td className="py-3 px-4 text-xs font-medium whitespace-nowrap">
                        <span
                          className={
                            acc.normal_balance === 'Debit'
                              ? 'text-teal-800'
                              : 'text-amber-800'
                          }
                        >
                          {acc.normal_balance || 'Debit'}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-mono text-xs font-medium text-slate-700 whitespace-nowrap">
                        {acc.statement || 'BS'}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        {coaLogId ? (
                          worker.role === 'master' ? (
                            <button
                              type="button"
                              onClick={() =>
                                openLayer({
                                  kind: 'inspect',
                                  entity: 'logs',
                                  recordId: coaLogId,
                                })
                              }
                              className="inline-flex items-center gap-1 font-mono text-xs text-teal-700 hover:underline font-medium"
                            >
                              <span>{coaLogId}</span>
                              <ExternalLink className="w-3 h-3" />
                            </button>
                          ) : (
                            <span className="font-mono text-xs text-slate-600">
                              {coaLogId}
                            </span>
                          )
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => openEditCoa(acc)}
                            className="p-1.5 text-slate-500 hover:text-teal-800 hover:bg-slate-100 rounded-md"
                            title="Edit account"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteCoa(acc)}
                            className="p-1.5 text-slate-500 hover:text-red-700 hover:bg-red-50 rounded-md"
                            title="Delete account"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-2.5 border-t border-slate-100 bg-slate-50/40 flex items-center justify-between text-xs text-slate-500 tabular-nums">
            <span>
              {filteredCoa.length} of {accounts.length} accounts
            </span>
            <span>BS = Balance Sheet &middot; IS = Income Statement</span>
          </div>
        </div>
      )}

      {/* Manual Journal Entry Modal (RCRD + Split RCRD-CLSF) */}
      {journalModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-[2px] flex items-center justify-center p-4"
        >
          <div
            className="fixed inset-0"
            onClick={() => !savingJournal && setJournalModalOpen(false)}
            aria-hidden="true"
          />
          <form
            onSubmit={handleSaveJournal}
            className="relative z-10 w-full max-w-4xl bg-white border border-slate-200 rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
          >
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-base font-bold text-slate-900">
                  {editingRecord ? 'Edit & Label Transaction Record (RCRD)' : 'New Transaction Record (RCRD)'}
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Balance Debit and Credit lines to mark as Labeled (included in BS, IS &amp; Cash Flow), or save unlabeled / draft entries to classify later.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setJournalModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-md"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-5 overflow-y-auto">
              {/* Unpaid Active Invoice Quick-Fill (strictly excludes canceled invoices) */}
              {!editingRecord && unpaidInvoices.length > 0 && (
                <div className="p-3.5 rounded-lg bg-[#EFF8F8] border border-teal-200/80 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                  <div className="text-xs text-teal-950">
                    <span className="font-semibold">Quick-Fill Unpaid Invoice Payment</span>
                    <span className="text-teal-800 block mt-0.5">
                      Search active unpaid invoices by invoice number or client name.
                    </span>
                  </div>
                  <div className="w-full sm:w-80">
                    <SearchableSelectField
                      value=""
                      options={unpaidInvoiceSearchOptions}
                      onChange={(invId) => {
                        if (invId) handleQuickApplyUnpaidInvoice(invId);
                      }}
                      variant="cell"
                      placeholder="Search unpaid invoice..."
                      modalTitle="Quick-Fill Unpaid Invoice"
                      searchPlaceholder="Search invoice number, client name, or ID..."
                      emptyText="No matching unpaid invoices."
                    />
                  </div>
                </div>
              )}

              {/* Core RCRD Header Fields: Date, Record Type, Amount */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">
                    Date
                  </label>
                  <input
                    type="date"
                    value={txDate}
                    onChange={(e) => setTxDate(e.target.value)}
                    required
                    className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600/25 focus:border-teal-700"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">
                    Record Type
                  </label>
                  <select
                    value={txSourceType}
                    onChange={(e) =>
                      setTxSourceType(e.target.value as RcrdSourceType)
                    }
                    className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600/25 focus:border-teal-700"
                  >
                    {RCRD_SOURCE_TYPE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">
                    Amount (IDR)
                    {draftLines.length > 0 && (
                      <span className="text-slate-400 font-normal ml-1">(from lines)</span>
                    )}
                  </label>
                  {draftLines.length === 0 ? (
                    <input
                      type="number"
                      step="any"
                      min="0.01"
                      value={txHeaderAmount}
                      onChange={(e) => setTxHeaderAmount(e.target.value)}
                      required
                      placeholder="e.g., 5250000"
                      className="w-full px-3 py-2 text-sm font-mono text-right bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600/25 focus:border-teal-700"
                    />
                  ) : (
                    <div className="w-full px-3 py-2 text-sm font-mono text-right bg-slate-50 border border-slate-200 rounded-lg text-slate-800 tabular-nums">
                      {formatIDR(Math.max(draftBalance.dr, draftBalance.cr))}
                    </div>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">
                    Description
                  </label>
                  <input
                    type="text"
                    value={txDesc}
                    onChange={(e) => setTxDesc(e.target.value)}
                    required
                    placeholder="e.g., Split Payment PT Graha Medika or Incoming Bank Transfer"
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600/25 focus:border-teal-700"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">
                    Note <span className="text-slate-400 font-normal">(optional)</span>
                  </label>
                  <input
                    type="text"
                    value={txNote}
                    onChange={(e) => setTxNote(e.target.value)}
                    placeholder="Transfer ref / tax remark"
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600/25 focus:border-teal-700"
                  />
                </div>
              </div>

              {/* Split Classification Lines */}
              <div className="space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-slate-700">
                    Ledger Split Lines (RCRD-CLSF)
                  </p>
                  <div className="flex items-center gap-2">
                    {draftLines.length > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          if (!txHeaderAmount && (draftBalance.dr > 0 || draftBalance.cr > 0)) {
                            setTxHeaderAmount(
                              String(Math.max(draftBalance.dr, draftBalance.cr))
                            );
                          }
                          setDraftLines([]);
                        }}
                        className="px-2.5 py-1 text-xs font-medium text-amber-800 bg-amber-50 border border-amber-200 hover:bg-amber-100 rounded-md"
                      >
                        Clear Lines (Unlabeled)
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() =>
                        setDraftLines((prev) => [
                          ...prev,
                          {
                            key: `l-${Date.now()}-${prev.length}`,
                            type: prev.length === 0 ? 'DEBIT' : 'CREDIT',
                            account_id:
                              prev.length === 0
                                ? bankAccounts[0]?.id || accounts[0]?.id || ''
                                : accounts[0]?.id || '',
                            amount:
                              prev.length === 0 && txHeaderAmount ? txHeaderAmount : '',
                            reference_model: '',
                            reference_model_id: '',
                          },
                        ])
                      }
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-teal-800 bg-[#EFF8F8] border border-teal-200 hover:bg-teal-50 rounded-md"
                    >
                      <Plus className="w-3 h-3" />
                      Add Split Line
                    </button>
                  </div>
                </div>

                {draftLines.length === 0 ? (
                  <div className="p-4 rounded-lg border border-dashed border-amber-300 bg-amber-50/40 text-xs text-amber-900">
                    No classification lines attached. Saving now will store this entry as{' '}
                    <span className="font-semibold">Unlabeled</span> so you can classify it later.
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="hidden md:grid grid-cols-12 gap-2 px-2.5 text-[11px] font-medium text-slate-500">
                      <span className="col-span-2">Type</span>
                      <span className="col-span-3">Chart of Account (Search)</span>
                      <span className="col-span-2 text-right">Amount</span>
                      <span className="col-span-2">Ref Model</span>
                      <span className="col-span-3">Reference ID (Search)</span>
                    </div>
                    {draftLines.map((line, idx) => {
                      const refEntity = REF_MODEL_TO_ENTITY[line.reference_model];
                      return (
                        <div
                          key={line.key}
                          className="grid grid-cols-12 gap-2 items-center p-2.5 rounded-lg bg-slate-50 border border-slate-200"
                        >
                          <select
                            value={line.type}
                            onChange={(e) =>
                              setDraftLines((prev) =>
                                prev.map((item, i) =>
                                  i === idx
                                    ? { ...item, type: e.target.value as LedgerEntryType }
                                    : item
                                )
                              )
                            }
                            aria-label="Entry type"
                            className="col-span-4 md:col-span-2 px-2 py-1.5 text-xs font-mono font-semibold bg-white border border-slate-300 rounded-md"
                          >
                            <option value="DEBIT">DEBIT</option>
                            <option value="CREDIT">CREDIT</option>
                          </select>

                          <div className="col-span-8 md:col-span-3">
                            <SearchableSelectField
                              value={line.account_id}
                              options={coaSearchOptions}
                              onChange={(nextAccId) =>
                                setDraftLines((prev) =>
                                  prev.map((item, i) =>
                                    i === idx ? { ...item, account_id: nextAccId } : item
                                  )
                                )
                              }
                              required
                              variant="cell"
                              placeholder="Search COA account..."
                              modalTitle="Select Chart of Account"
                              searchPlaceholder="Search code (1110, 4010), name, AR, PPN, category..."
                              emptyText="No matching Chart of Account found."
                              groupFilters={COA_GROUP_FILTERS}
                            />
                          </div>

                          <input
                            type="number"
                            step="any"
                            min="0.01"
                            value={line.amount}
                            onChange={(e) =>
                              setDraftLines((prev) =>
                                prev.map((item, i) =>
                                  i === idx ? { ...item, amount: e.target.value } : item
                                )
                              )
                            }
                            required
                            placeholder="Amount"
                            className="col-span-6 md:col-span-2 px-2 py-1.5 text-xs font-mono bg-white border border-slate-300 rounded-md text-right"
                          />

                          <select
                            value={line.reference_model}
                            onChange={(e) => {
                              const nextModel = e.target.value;
                              setDraftLines((prev) =>
                                prev.map((item, i) =>
                                  i === idx
                                    ? {
                                        ...item,
                                        reference_model: nextModel,
                                        reference_model_id:
                                          item.reference_model === nextModel
                                            ? item.reference_model_id
                                            : '',
                                        reference_label:
                                          item.reference_model === nextModel
                                            ? item.reference_label
                                            : undefined,
                                      }
                                    : item
                                )
                              );
                            }}
                            aria-label="Reference model"
                            className="col-span-6 md:col-span-2 px-2 py-1.5 text-xs bg-white border border-slate-300 rounded-md"
                          >
                            {REFERENCE_MODEL_OPTIONS.map((opt) => (
                              <option key={opt.value} value={opt.value}>
                                {opt.label}
                              </option>
                            ))}
                          </select>

                          <div className="col-span-12 md:col-span-3 flex items-center gap-1">
                            <div className="flex-1 min-w-0">
                              {refEntity ? (
                                <ReferencePickerField
                                  entity={refEntity}
                                  value={line.reference_model_id}
                                  fallbackLabel={line.reference_label}
                                  optional
                                  size="sm"
                                  placeholder={`Search ${line.reference_model}...`}
                                  layerTitle={`Search ${line.reference_model} reference`}
                                  onChangeSingle={(pickedId, pickedRec) => {
                                    const pickedObj = pickedRec as Record<string, unknown> | null;
                                    const label =
                                      (pickedObj?.invoice_number as string) ||
                                      (pickedObj?.po_number as string) ||
                                      (pickedObj?.title as string) ||
                                      (pickedObj?.name as string) ||
                                      undefined;
                                    setDraftLines((prev) =>
                                      prev.map((item, i) =>
                                        i === idx
                                          ? {
                                              ...item,
                                              reference_model_id: pickedId,
                                              reference_label: label,
                                            }
                                          : item
                                      )
                                    );
                                  }}
                                />
                              ) : line.reference_model ? (
                                <input
                                  type="text"
                                  value={line.reference_model_id}
                                  onChange={(e) =>
                                    setDraftLines((prev) =>
                                      prev.map((item, i) =>
                                        i === idx
                                          ? { ...item, reference_model_id: e.target.value }
                                          : item
                                      )
                                    )
                                  }
                                  placeholder={`Enter ${line.reference_model} ref...`}
                                  className="w-full min-w-0 px-2 py-1.5 text-xs font-mono bg-white border border-slate-300 rounded-md"
                                />
                              ) : (
                                <div className="px-2 py-1.5 text-xs text-slate-400 bg-slate-100/70 border border-slate-200 rounded-md truncate">
                                  No reference
                                </div>
                              )}
                            </div>
                            <button
                              type="button"
                              onClick={() =>
                                setDraftLines((prev) =>
                                  prev.filter((_, i) => i !== idx)
                                )
                              }
                              aria-label="Remove line"
                              className="p-1 text-slate-400 hover:text-red-600 shrink-0"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Live Label & Balance Summary */}
                <div
                  className={`px-3.5 py-2.5 rounded-lg border text-xs flex flex-wrap items-center justify-between gap-2 ${
                    draftBalance.status === 'labeled'
                      ? 'bg-[#EFF8F8] border-teal-200 text-teal-900'
                      : draftBalance.status === 'unlabeled'
                        ? 'bg-amber-50 border-amber-200 text-amber-900'
                        : 'bg-red-50 border-red-200 text-red-900'
                  }`}
                >
                  <div className="flex items-center gap-4 font-mono tabular-nums">
                    <span>Total Debit: {formatIDR(draftBalance.dr)}</span>
                    <span>Total Credit: {formatIDR(draftBalance.cr)}</span>
                  </div>
                  <span className="font-semibold">
                    {draftBalance.status === 'labeled'
                      ? 'Labeled · Balanced (DR = CR)'
                      : draftBalance.status === 'unlabeled'
                        ? 'Unlabeled (Excluded from Statements)'
                        : `Not Equal (DR ≠ CR) · Diff ${formatIDR(Math.abs(draftBalance.diff))}`}
                  </span>
                </div>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-slate-200 bg-slate-50/60 flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setJournalModalOpen(false)}
                className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingJournal || !draftBalance.canSave}
                className="px-4 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-50 rounded-lg whitespace-nowrap"
              >
                {savingJournal
                  ? 'Saving...'
                  : editingRecord
                    ? draftBalance.status === 'labeled'
                      ? 'Save Labeled Entry'
                      : 'Save Draft Changes'
                    : draftBalance.status === 'labeled'
                      ? 'Post Labeled Entry'
                      : draftBalance.status === 'unlabeled'
                        ? 'Save as Unlabeled'
                        : 'Save as Not Equal Draft'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Single-CSV Excel Import & Update Engine Modal */}
      {csvModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-[2px] flex items-center justify-center p-4"
        >
          <div
            className="fixed inset-0"
            onClick={() => !importingCsv && setCsvModalOpen(false)}
            aria-hidden="true"
          />
          <form
            onSubmit={handleImportLedgerCsv}
            className="relative z-10 w-full max-w-2xl bg-white border border-slate-200 rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
          >
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-base font-bold text-slate-900">
                  Import Ledger Records (CSV)
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Rows sharing <span className="font-mono">group_no</span> merge
                  into one RCRD entry with split Debit/Credit lines. Leave{' '}
                  <span className="font-mono">type</span> &amp;{' '}
                  <span className="font-mono">account_code</span> blank to stage unlabeled records.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCsvModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-md"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-5 overflow-y-auto">
              {/* Insert vs Update Mode Selector (Matches Master CSV Import) */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-2">
                  Import Action
                </label>
                <div className="grid grid-cols-2 gap-1.5 p-1 bg-slate-100 rounded-lg border border-slate-200">
                  <button
                    type="button"
                    onClick={() => {
                      setCsvImportMode('insert');
                      resetLedgerBatchProgress();
                    }}
                    className={`py-2 px-3 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                      csvImportMode === 'insert'
                        ? 'bg-white text-teal-800 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Insert (New Only)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setCsvImportMode('update');
                      resetLedgerBatchProgress();
                    }}
                    className={`py-2 px-3 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                      csvImportMode === 'update'
                        ? 'bg-white text-teal-800 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Update (Existing + New)
                  </button>
                </div>
              </div>

              {/* Mode Instructions + Template / Export Action */}
              <div className="p-3.5 rounded-lg bg-[#F5FAFA] border border-teal-200/80 space-y-2.5">
                {csvImportMode === 'insert' ? (
                  <>
                    <p className="text-xs text-slate-700 leading-relaxed">
                      <span className="font-semibold text-slate-900">Insert mode</span>{' '}
                      omits the <span className="font-mono">rcrd_id</span> column. Every{' '}
                      <span className="font-mono">group_no</span> creates a new ledger record
                      with its Debit/Credit classification lines linked to a shared{' '}
                      <span className="font-mono">LOGS</span> audit record.
                    </p>
                    <button
                      type="button"
                      onClick={handleDownloadLedgerTemplate}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold text-teal-700 hover:text-teal-900 hover:underline"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Download Insert Template (No rcrd_id Column)
                    </button>
                  </>
                ) : (
                  <>
                    <p className="text-xs text-slate-700 leading-relaxed">
                      <span className="font-semibold text-slate-900">Update mode</span>{' '}
                      uses the <span className="font-mono">rcrd_id</span> column. Existing IDs
                      are updated and their classification lines replaced (sharing one update{' '}
                      <span className="font-mono">LOGS</span> entry). Rows with a blank or new{' '}
                      <span className="font-mono">rcrd_id</span> are automatically inserted.
                    </p>
                    <button
                      type="button"
                      onClick={handleExportExistingLedgerCsv}
                      disabled={downloadingExistingLedger}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-teal-800 bg-white border border-teal-300 hover:bg-teal-50 disabled:opacity-60 rounded-lg transition-colors"
                    >
                      <Download className="w-3.5 h-3.5" />
                      {downloadingExistingLedger
                        ? 'Exporting Existing Ledger...'
                        : 'Download Existing Ledger CSV'}
                    </button>
                  </>
                )}
              </div>

              {/* CSV File Upload Card (Single CSV section — Ledger has no file attachments) */}
              <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 space-y-3">
                <div className="flex flex-col justify-between p-3 rounded-lg bg-white border border-slate-200 space-y-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <FileSpreadsheet className="w-4 h-4 text-teal-700 shrink-0" />
                      <span className="text-xs font-semibold text-slate-900 truncate">
                        CSV Data File
                      </span>
                    </div>
                    {csvFile && (
                      <button
                        type="button"
                        onClick={() => {
                          setCsvFile(null);
                          setCsvText('');
                          resetLedgerBatchProgress();
                        }}
                        disabled={importingCsv}
                        className="text-[11px] font-medium text-slate-500 hover:text-red-700 shrink-0 disabled:opacity-50"
                      >
                        Clear
                      </button>
                    )}
                  </div>

                  <label
                    className={`w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border transition-colors cursor-pointer text-center ${
                      csvFile
                        ? 'bg-[#EFF8F8] text-teal-800 border-teal-300 hover:bg-teal-50'
                        : 'bg-teal-700 text-white border-teal-700 hover:bg-teal-800'
                    }`}
                  >
                    <Upload className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">
                      {csvFile ? 'Change CSV File' : 'Select CSV File'}
                    </span>
                    <input
                      type="file"
                      accept=".csv,text/csv"
                      disabled={importingCsv}
                      onChange={(e) => {
                        const file = e.target.files?.[0] || null;
                        setCsvFile(file);
                        if (file) {
                          const reader = new FileReader();
                          reader.onload = () => {
                            setCsvText(String(reader.result || ''));
                            resetLedgerBatchProgress();
                          };
                          reader.readAsText(file);
                        }
                      }}
                      className="sr-only"
                    />
                  </label>

                  <p className="text-[11px] font-mono text-slate-500 truncate">
                    {csvFile
                      ? `${csvFile.name} (${ledgerTotalLines.toLocaleString()} lines)`
                      : 'Required · .csv (comma or semicolon)'}
                  </p>
                </div>

                <label className="flex items-start gap-2.5 pt-1 text-xs text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={csvAllowDrafts}
                    onChange={(e) => setCsvAllowDrafts(e.target.checked)}
                    className="mt-0.5 rounded border-slate-300 text-teal-700 focus:ring-teal-600"
                  />
                  <span>
                    <span className="font-semibold text-slate-900">
                      Allow unlabeled &amp; unequal (DR &ne; CR) groups as drafts
                    </span>
                    <span className="block text-[11px] text-slate-500 mt-0.5">
                      Draft entries appear clearly labeled in the ledger for later classification and are excluded from Financial Statements until balanced.
                    </span>
                  </span>
                </label>
              </div>

              <div>
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <label className="block text-xs font-medium text-slate-700">
                    CSV Content Preview / Paste
                  </label>
                  {ledgerTotalLines > 0 && (
                    <span className="text-[11px] font-mono text-slate-500 tabular-nums">
                      {ledgerTotalLines.toLocaleString()}{' '}
                      {ledgerTotalLines === 1 ? 'line' : 'lines'}
                      {isLedgerMultiBatch
                        ? ` · ${ledgerTotalBatches} group-safe batches (no limit)`
                        : ''}
                    </span>
                  )}
                </div>

                {csvFile && ledgerTotalLines > 1000 ? (
                  <div className="px-3.5 py-3 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-slate-900 truncate">
                        {csvFile.name}
                      </p>
                      <p className="text-[11px] font-mono text-slate-600 tabular-nums">
                        {ledgerTotalLines.toLocaleString()} lines ({formatBytes(csvFile.size)}) &middot;{' '}
                        {ledgerTotalBatches} batches (~{CSV_IMPORT_BATCH_SIZE} lines each, keeping split groups intact)
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setCsvFile(null);
                        setCsvText('');
                        resetLedgerBatchProgress();
                      }}
                      disabled={importingCsv}
                      className="px-2.5 py-1.5 text-xs text-slate-600 hover:text-slate-900 bg-white border border-slate-200 rounded-md shrink-0 disabled:opacity-50"
                    >
                      Clear File
                    </button>
                  </div>
                ) : (
                  <textarea
                    rows={6}
                    value={csvText}
                    onChange={(e) => {
                      setCsvText(e.target.value);
                      setCsvFile(null);
                      resetLedgerBatchProgress();
                    }}
                    placeholder={
                      csvImportMode === 'insert'
                        ? LEDGER_INSERT_HEADERS
                        : LEDGER_UPDATE_HEADERS
                    }
                    className="w-full px-3 py-2 text-xs font-mono bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:bg-white focus:ring-2 focus:ring-teal-600/25 focus:border-teal-700"
                  />
                )}
              </div>

              {isLedgerMultiBatch && (
                <div className="p-3.5 rounded-lg bg-[#F5FAFA] border border-teal-200 space-y-2">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-semibold text-teal-900 flex items-center gap-1.5">
                      {isLedgerAllDone && (
                        <CheckCircle2 className="w-4 h-4 text-teal-700 shrink-0" />
                      )}
                      {isLedgerAllDone
                        ? `All ${ledgerTotalBatches} ledger batches completed`
                        : csvNextBatchIndex === 0
                          ? `Large Ledger CSV ready — ${ledgerTotalBatches} group-safe batches`
                          : `Batch ${csvNextBatchIndex} of ${ledgerTotalBatches} completed · ${ledgerRemainingLines.toLocaleString()} lines remaining`}
                    </span>
                    <span className="font-mono text-[11px] text-teal-800 tabular-nums">
                      {ledgerProcessedLines.toLocaleString()} /{' '}
                      {ledgerTotalLines.toLocaleString()} lines
                    </span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-teal-100 overflow-hidden">
                    <div
                      className="h-full bg-teal-700 transition-all duration-300"
                      style={{
                        width: `${
                          ledgerTotalLines > 0
                            ? Math.min(
                                100,
                                Math.round(
                                  (ledgerProcessedLines / ledgerTotalLines) * 100
                                )
                              )
                            : 0
                        }%`,
                      }}
                    />
                  </div>
                  {!isLedgerAllDone && ledgerCurrentBatch && (
                    <p className="text-[11px] text-slate-600">
                      Next up: <span className="font-semibold text-slate-800">Batch {ledgerCurrentBatch.batchNumber} of {ledgerTotalBatches}</span>{' '}
                      ({ledgerCurrentBatch.rowCount} lines). Split transactions sharing a{' '}
                      <span className="font-mono">group_no</span> or{' '}
                      <span className="font-mono">rcrd_id</span> are always kept together in the same batch.
                    </p>
                  )}
                </div>
              )}

              {csvResult && (
                <div className="p-3.5 rounded-lg border border-slate-200 bg-slate-50 space-y-2 text-xs">
                  <p className="font-semibold text-slate-900">
                    {isLedgerMultiBatch
                      ? `Cumulative (${csvResult.completedBatches}/${ledgerTotalBatches} batches): `
                      : `Batch ${csvResult.batchTags[csvResult.batchTags.length - 1]}: `}
                    {csvResult.createdCount.toLocaleString()} inserted,{' '}
                    {csvResult.updatedCount.toLocaleString()} updated (
                    {csvResult.linesInserted.toLocaleString()} ledger lines)
                  </p>
                  <p className="text-slate-600">
                    <span className="text-teal-700 font-medium">
                      {csvResult.labeledCount} Labeled
                    </span>{' '}
                    &middot;{' '}
                    <span className="text-amber-700 font-medium">
                      {csvResult.unlabeledCount} Unlabeled
                    </span>{' '}
                    &middot;{' '}
                    <span className="text-red-700 font-medium">
                      {csvResult.notEqualCount} Not Equal
                    </span>
                  </p>
                  {(csvResult.logCreateIds.length > 0 ||
                    csvResult.logUpdateIds.length > 0) && (
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-mono text-slate-600">
                      {csvResult.logCreateIds.slice(-3).map((logId) => (
                        <span key={logId}>
                          Create Log:{' '}
                          {worker.role === 'master' ? (
                            <button
                              type="button"
                              onClick={() => {
                                setCsvModalOpen(false);
                                openLayer({
                                  kind: 'inspect',
                                  entity: 'logs',
                                  recordId: logId,
                                });
                              }}
                              className="text-teal-700 hover:underline font-semibold"
                            >
                              {logId}
                            </button>
                          ) : (
                            logId
                          )}
                        </span>
                      ))}
                      {csvResult.logUpdateIds.slice(-3).map((logId) => (
                        <span key={logId}>
                          Update Log:{' '}
                          {worker.role === 'master' ? (
                            <button
                              type="button"
                              onClick={() => {
                                setCsvModalOpen(false);
                                openLayer({
                                  kind: 'inspect',
                                  entity: 'logs',
                                  recordId: logId,
                                });
                              }}
                              className="text-teal-700 hover:underline font-semibold"
                            >
                              {logId}
                            </button>
                          ) : (
                            logId
                          )}
                        </span>
                      ))}
                    </div>
                  )}
                  {csvResult.errors.length > 0 && (
                    <div className="space-y-1 text-red-700 max-h-32 overflow-y-auto">
                      {csvResult.errors.slice(0, 10).map((err, i) => (
                        <p key={i}>
                          Group {err.group}: {err.error}
                        </p>
                      ))}
                      {csvResult.errors.length > 10 && (
                        <p className="text-[11px] text-red-600">
                          +{csvResult.errors.length - 10} more group error(s)
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-slate-200 bg-slate-50/60 flex flex-wrap items-center justify-between gap-2.5">
              <div>
                {csvResult && csvNextBatchIndex > 0 && (
                  <button
                    type="button"
                    onClick={resetLedgerBatchProgress}
                    disabled={importingCsv}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-50 rounded-lg"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Reset Progress
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2.5 ml-auto">
                <button
                  type="button"
                  onClick={() => setCsvModalOpen(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg"
                >
                  Close
                </button>
                <button
                  type="submit"
                  disabled={importingCsv || isLedgerAllDone}
                  className="px-4 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-60 rounded-lg whitespace-nowrap"
                >
                  {importingCsv
                    ? isLedgerMultiBatch && ledgerCurrentBatch
                      ? `Processing Batch ${ledgerCurrentBatch.batchNumber} of ${ledgerTotalBatches}...`
                      : 'Processing Batch...'
                    : isLedgerAllDone
                      ? `All ${ledgerTotalLines.toLocaleString()} Lines Imported`
                      : isLedgerMultiBatch && ledgerCurrentBatch
                        ? csvNextBatchIndex === 0
                          ? `Import First ${ledgerCurrentBatch.rowCount} Lines (Batch 1 of ${ledgerTotalBatches})`
                          : `Continue Next Batch (Batch ${ledgerCurrentBatch.batchNumber} of ${ledgerTotalBatches} · ${ledgerRemainingLines.toLocaleString()} left)`
                        : csvImportMode === 'update'
                          ? 'Update Ledger from CSV'
                          : 'Insert New Ledger Records'}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* Create / Edit COA Modal */}
      {coaModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-[2px] flex items-center justify-center p-4"
        >
          <div
            className="fixed inset-0"
            onClick={() => !savingCoa && setCoaModalOpen(false)}
            aria-hidden="true"
          />
          <form
            onSubmit={handleSaveCoa}
            className="relative z-10 w-full max-w-md bg-white border border-slate-200 rounded-xl shadow-xl p-6 space-y-4"
          >
            <h2 className="font-display text-base font-bold text-slate-900">
              {editingCoa ? `Edit Account ${editingCoa.code}` : 'Add Chart of Account'}
            </h2>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  ID / Account Code
                </label>
                <input
                  type="text"
                  value={coaCode}
                  onChange={(e) => setCoaCode(e.target.value)}
                  required
                  placeholder="COA-1010"
                  className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Category
                </label>
                <select
                  value={coaCategory}
                  onChange={(e) =>
                    handleCoaCategoryChange(e.target.value as CoaCategory)
                  }
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                >
                  {COA_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Account Name
              </label>
              <input
                type="text"
                value={coaName}
                onChange={(e) => setCoaName(e.target.value)}
                required
                placeholder="Cash in Bank"
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Normal Balance
                </label>
                <select
                  value={coaNormalBalance}
                  onChange={(e) =>
                    setCoaNormalBalance(e.target.value as CoaNormalBalance)
                  }
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                >
                  <option value="Debit">Debit</option>
                  <option value="Credit">Credit</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Statement
                </label>
                <select
                  value={coaStatement}
                  onChange={(e) =>
                    setCoaStatement(e.target.value as CoaStatement)
                  }
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                >
                  <option value="BS">BS (Balance Sheet)</option>
                  <option value="IS">IS (Income Statement)</option>
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setCoaModalOpen(false)}
                className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingCoa}
                className="px-3.5 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-60 rounded-lg"
              >
                {savingCoa ? 'Saving...' : 'Save Account'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
