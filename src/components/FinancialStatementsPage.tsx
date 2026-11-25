import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Download,
  RefreshCw,
} from 'lucide-react';
import { api, formatIDR } from '../lib/api.ts';
import { useFeedback } from '../lib/feedback.tsx';
import { useNavigation } from '../lib/navigation.tsx';
import type {
  FinancialStatementLine,
  FinancialStatementsResponse,
} from '../shared/types.ts';
import { TableSkeleton } from './Skeleton.tsx';

type StatementTab = 'income' | 'balance' | 'cashflow';

function formatCsvTimestamp(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${String(date.getFullYear()).slice(-2)}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function escapeCsvCell(val: string | number): string {
  const s = String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function formatSignedIDR(value: number): string {
  if (value < 0) {
    return `(${formatIDR(Math.abs(value))})`;
  }
  return formatIDR(value);
}

function getDefaultPeriod(): { startDate: string; endDate: string } {
  const today = new Date();
  const y = today.getFullYear();
  const endDate = today.toISOString().slice(0, 10);
  return { startDate: `${y}-01-01`, endDate };
}

export function FinancialStatementsPage() {
  const { navigatePage, dataVersion, setLedgerStatusFilterHandoff } =
    useNavigation();
  const { notifyError, notifySuccess } = useFeedback();

  const [selectedCompanyId, setSelectedCompanyId] = useState('');
  const [startDate, setStartDate] = useState(() => getDefaultPeriod().startDate);
  const [endDate, setEndDate] = useState(() => getDefaultPeriod().endDate);
  const [activePreset, setActivePreset] = useState<
    'month' | 'quarter' | 'ytd' | 'all' | 'custom'
  >('ytd');
  const [activeTab, setActiveTab] = useState<StatementTab>('income');
  const [report, setReport] = useState<FinancialStatementsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadCompanies = useCallback(async () => {
    const res = await api.listCompanies();
    const defaultId = res.companies[0]?.id || '';
    setSelectedCompanyId((prev) =>
      prev && res.companies.some((c) => c.id === prev) ? prev : defaultId
    );
    return defaultId;
  }, []);

  const loadStatements = useCallback(
    async (companyId: string, from: string, to: string) => {
      if (!companyId) return;
      setLoading(true);
      setError(null);
      try {
        const res = await api.getFinancialStatements({
          companyId,
          startDate: from,
          endDate: to,
        });
        setReport(res);
      } catch (err) {
        const msg =
          err instanceof Error
            ? err.message
            : 'Failed to generate financial statements.';
        setError(msg);
        notifyError(msg);
      } finally {
        setLoading(false);
      }
    },
    [notifyError]
  );

  useEffect(() => {
    let active = true;
    loadCompanies()
      .then((firstId) => {
        if (active && firstId) {
          return loadStatements(firstId, startDate, endDate);
        }
        if (active) setLoading(false);
      })
      .catch((err) => {
        if (active) {
          setError(
            err instanceof Error ? err.message : 'Unable to load companies.'
          );
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
    // Initial boot load only; subsequent reloads handled below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (selectedCompanyId) {
      loadStatements(selectedCompanyId, startDate, endDate);
    }
  }, [selectedCompanyId, startDate, endDate, dataVersion, loadStatements]);

  const applyPreset = (preset: 'month' | 'quarter' | 'ytd' | 'all') => {
    setActivePreset(preset);
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    const todayStr = now.toISOString().slice(0, 10);
    if (preset === 'month') {
      const firstOfMonth = `${y}-${String(m + 1).padStart(2, '0')}-01`;
      setStartDate(firstOfMonth);
      setEndDate(todayStr);
    } else if (preset === 'quarter') {
      const qStartMonth = Math.floor(m / 3) * 3 + 1;
      setStartDate(`${y}-${String(qStartMonth).padStart(2, '0')}-01`);
      setEndDate(todayStr);
    } else if (preset === 'ytd') {
      setStartDate(`${y}-01-01`);
      setEndDate(todayStr);
    } else {
      setStartDate('2020-01-01');
      setEndDate(todayStr);
    }
  };

  const handleJumpToLedger = (filter: 'unlabeled' | 'not_equal') => {
    setLedgerStatusFilterHandoff(filter);
    navigatePage('/b3/accounting/records');
  };

  const handleExportStatementsCsv = () => {
    if (!report) return;
    const rows: Array<Array<string | number>> = [
      ['Statement', 'Section', 'Account Code', 'Account Name', 'Amount (IDR)'],
    ];

    const pushLines = (
      stmt: string,
      section: string,
      lines: FinancialStatementLine[]
    ) => {
      for (const l of lines) {
        rows.push([stmt, section, l.code, l.name, l.amount]);
      }
    };

    // Income Statement
    pushLines('Income Statement', 'Revenue', report.incomeStatement.revenue);
    rows.push([
      'Income Statement',
      'Subtotal',
      '',
      'Total Revenue',
      report.incomeStatement.totalRevenue,
    ]);
    pushLines(
      'Income Statement',
      'Direct Operating Costs',
      report.incomeStatement.directCosts
    );
    rows.push([
      'Income Statement',
      'Subtotal',
      '',
      'Gross Profit',
      report.incomeStatement.grossProfit,
    ]);
    pushLines(
      'Income Statement',
      'Operating & Admin Expenses',
      report.incomeStatement.operatingExpenses
    );
    rows.push([
      'Income Statement',
      'Total',
      '',
      'Net Income',
      report.incomeStatement.netIncome,
    ]);

    // Balance Sheet
    pushLines('Balance Sheet', 'Current Assets', report.balanceSheet.currentAssets);
    pushLines('Balance Sheet', 'Fixed Assets', report.balanceSheet.fixedAssets);
    rows.push([
      'Balance Sheet',
      'Total',
      '',
      'Total Assets',
      report.balanceSheet.totalAssets,
    ]);
    pushLines(
      'Balance Sheet',
      'Current Liabilities',
      report.balanceSheet.currentLiabilities
    );
    pushLines(
      'Balance Sheet',
      'Non-Current Liabilities',
      report.balanceSheet.nonCurrentLiabilities
    );
    rows.push([
      'Balance Sheet',
      'Subtotal',
      '',
      'Total Liabilities',
      report.balanceSheet.totalLiabilities,
    ]);
    pushLines('Balance Sheet', 'Equity', report.balanceSheet.equityAccounts);
    rows.push([
      'Balance Sheet',
      'Equity',
      '',
      'Current & Unclosed Net Earnings',
      report.balanceSheet.currentPeriodEarnings,
    ]);
    rows.push([
      'Balance Sheet',
      'Total',
      '',
      'Total Liabilities & Equity',
      report.balanceSheet.totalLiabilitiesAndEquity,
    ]);

    // Cash Flow Statement
    rows.push([
      'Cash Flow',
      'Opening',
      '',
      'Beginning Cash Balance',
      report.cashFlow.beginningCash,
    ]);
    for (const l of report.cashFlow.operating) {
      rows.push(['Cash Flow', 'Operating Activities', l.code, l.name, l.amount]);
    }
    rows.push([
      'Cash Flow',
      'Subtotal',
      '',
      'Net Cash from Operating Activities',
      report.cashFlow.netOperatingCash,
    ]);
    for (const l of report.cashFlow.investing) {
      rows.push(['Cash Flow', 'Investing Activities', l.code, l.name, l.amount]);
    }
    rows.push([
      'Cash Flow',
      'Subtotal',
      '',
      'Net Cash from Investing Activities',
      report.cashFlow.netInvestingCash,
    ]);
    for (const l of report.cashFlow.financing) {
      rows.push(['Cash Flow', 'Financing Activities', l.code, l.name, l.amount]);
    }
    rows.push([
      'Cash Flow',
      'Subtotal',
      '',
      'Net Cash from Financing Activities',
      report.cashFlow.netFinancingCash,
    ]);
    rows.push([
      'Cash Flow',
      'Total',
      '',
      'Ending Cash Balance',
      report.cashFlow.endingCash,
    ]);

    const csvBody = rows
      .map((r) => r.map(escapeCsvCell).join(','))
      .join('\r\n');
    const content = `sep=,\r\n${csvBody}\r\n`;
    const fileName = `limbahin-financial-statements-${report.period.startDate}-to-${report.period.endDate}-${formatCsvTimestamp()}.csv`;
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
    notifySuccess(`Exported ${fileName}.`);
  };

  const pendingAttentionCount =
    (report?.integrity.unlabeledCountAsOfEnd ?? 0) +
    (report?.integrity.notEqualCountAsOfEnd ?? 0);

  return (
    <div className="space-y-5">
      {/* Controls Bar: Period + Export */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">

            <div className="flex items-center gap-2">
              <label
                htmlFor="fs-start-date"
                className="text-xs font-medium text-slate-500"
              >
                From
              </label>
              <input
                id="fs-start-date"
                type="date"
                value={startDate}
                onChange={(e) => {
                  setStartDate(e.target.value);
                  setActivePreset('custom');
                }}
                className="px-2.5 py-1.5 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:bg-white focus:border-teal-700"
              />
              <label
                htmlFor="fs-end-date"
                className="text-xs font-medium text-slate-500"
              >
                To
              </label>
              <input
                id="fs-end-date"
                type="date"
                value={endDate}
                onChange={(e) => {
                  setEndDate(e.target.value);
                  setActivePreset('custom');
                }}
                className="px-2.5 py-1.5 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:bg-white focus:border-teal-700"
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() =>
                selectedCompanyId &&
                loadStatements(selectedCompanyId, startDate, endDate)
              }
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Refresh
            </button>
            <button
              type="button"
              disabled={!report}
              onClick={handleExportStatementsCsv}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" />
              Export CSV
            </button>
          </div>
        </div>

        {/* Period Presets & Statement Tabs */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-100">
          <div className="flex items-center gap-1 p-1 bg-slate-50 border border-slate-200 rounded-lg">
            {(
              [
                { id: 'income', label: 'Income Statement (IS)' },
                { id: 'balance', label: 'Balance Sheet (BS)' },
                { id: 'cashflow', label: 'Cash Flow Statement' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  activeTab === tab.id
                    ? 'bg-teal-700 text-white'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-slate-400 mr-1">Quick Period:</span>
            {(
              [
                { id: 'month', label: 'Monthly' },
                { id: 'quarter', label: 'Quarterly' },
                { id: 'ytd', label: 'YTD' },
                { id: 'all', label: 'All Time' },
              ] as const
            ).map((p) => {
              const isSelected = activePreset === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => applyPreset(p.id)}
                  className={`px-2.5 py-1 text-xs font-medium border rounded-md transition-colors whitespace-nowrap ${
                    isSelected
                      ? 'bg-teal-700 text-white border-teal-700 shadow-xs'
                      : 'bg-white text-slate-600 border-slate-200 hover:text-teal-800 hover:bg-[#EFF8F8]'
                  }`}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Integrity Warning Banner if Unlabeled / Unequal Records Exist */}
      {report && pendingAttentionCount > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-2.5 text-xs text-amber-950">
            <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">
                {pendingAttentionCount} transaction record
                {pendingAttentionCount === 1 ? ' is' : 's are'} excluded from
                these statements (as of {report.period.endDate})
              </p>
              <p className="text-amber-800 mt-0.5">
                Only <span className="font-semibold">Labeled</span> (balanced DR
                = CR) records feed into BS, IS, and Cash Flow. Found{' '}
                <span className="font-mono font-semibold">
                  {report.integrity.unlabeledCountAsOfEnd}
                </span>{' '}
                Unlabeled and{' '}
                <span className="font-mono font-semibold">
                  {report.integrity.notEqualCountAsOfEnd}
                </span>{' '}
                Not Equal (DR &ne; CR) entries.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {report.integrity.unlabeledCountAsOfEnd > 0 && (
              <button
                type="button"
                onClick={() => handleJumpToLedger('unlabeled')}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-amber-950 bg-white border border-amber-300 hover:bg-amber-100/60 rounded-lg whitespace-nowrap"
              >
                <span>Review Unlabeled</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
            {report.integrity.notEqualCountAsOfEnd > 0 && (
              <button
                type="button"
                onClick={() => handleJumpToLedger('not_equal')}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-red-800 bg-white border border-red-200 hover:bg-red-50 rounded-lg whitespace-nowrap"
              >
                <span>Fix Unequal</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-800"
        >
          {error}
        </div>
      )}

      {/* KPI Summary Strip */}
      {report && !loading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <p className="text-xs text-slate-500">Net Revenue (Period)</p>
            <p className="mt-1.5 font-mono text-xl font-bold text-slate-900 tabular-nums truncate">
              {formatSignedIDR(report.incomeStatement.totalRevenue)}
            </p>
            <p className="mt-1 text-xs text-slate-500 tabular-nums">
              Gross Margin {report.incomeStatement.grossMarginPercent.toFixed(1)}%
            </p>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <p className="text-xs text-slate-500">Net Income (Period)</p>
            <p
              className={`mt-1.5 font-mono text-xl font-bold tabular-nums truncate ${
                report.incomeStatement.netIncome >= 0
                  ? 'text-teal-800'
                  : 'text-red-700'
              }`}
            >
              {formatSignedIDR(report.incomeStatement.netIncome)}
            </p>
            <p className="mt-1 text-xs text-slate-500 tabular-nums">
              Net Margin {report.incomeStatement.netMarginPercent.toFixed(1)}%
            </p>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <p className="text-xs text-slate-500">
              Total Assets (As of {report.period.endDate})
            </p>
            <p className="mt-1.5 font-mono text-xl font-bold text-slate-900 tabular-nums truncate">
              {formatSignedIDR(report.balanceSheet.totalAssets)}
            </p>
            <p
              className={`mt-1 text-xs font-medium ${
                report.balanceSheet.isBalanced
                  ? 'text-teal-700'
                  : 'text-red-700'
              }`}
            >
              {report.balanceSheet.isBalanced
                ? 'Balanced (Assets = L + E)'
                : `Discrepancy ${formatIDR(Math.abs(report.balanceSheet.balanceDiscrepancy))}`}
            </p>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <p className="text-xs text-slate-500">Ending Cash Balance</p>
            <p className="mt-1.5 font-mono text-xl font-bold text-slate-900 tabular-nums truncate">
              {formatSignedIDR(report.cashFlow.endingCash)}
            </p>
            <p
              className={`mt-1 text-xs font-medium ${
                report.cashFlow.isReconciled ? 'text-teal-700' : 'text-red-700'
              }`}
            >
              {report.cashFlow.isReconciled
                ? 'Reconciled with Balance Sheet Cash'
                : `Variance ${formatIDR(Math.abs(report.cashFlow.cashDiscrepancy))}`}
            </p>
          </div>
        </div>
      )}

      {/* Statement Body */}
      {loading || !report ? (
        <TableSkeleton columns={4} rows={8} />
      ) : activeTab === 'income' ? (
        <IncomeStatementCard report={report} />
      ) : activeTab === 'balance' ? (
        <BalanceSheetCard report={report} />
      ) : (
        <CashFlowCard report={report} />
      )}
    </div>
  );
}

function StatementSectionTable({
  title,
  lines,
  emptyLabel,
  subtotalLabel,
  subtotalAmount,
}: {
  title: string;
  lines: FinancialStatementLine[];
  emptyLabel: string;
  subtotalLabel: string;
  subtotalAmount: number;
}) {
  return (
    <div className="border-b border-slate-100 last:border-b-0">
      <div className="px-6 py-2.5 bg-slate-50/70 border-b border-slate-100">
        <h3 className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
          {title}
        </h3>
      </div>
      {lines.length === 0 ? (
        <div className="px-6 py-4 text-xs text-slate-400">{emptyLabel}</div>
      ) : (
        <div className="divide-y divide-slate-100">
          {lines.map((line) => (
            <div
              key={line.account_id}
              className="px-6 py-2.5 flex items-center justify-between gap-4 text-sm hover:bg-[#F3FAFA] transition-colors"
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className="font-mono text-xs text-teal-800 font-medium w-20 shrink-0">
                  {line.code}
                </span>
                <span className="text-slate-800 truncate">{line.name}</span>
              </div>
              <span
                className={`font-mono text-sm tabular-nums whitespace-nowrap ${
                  line.amount < 0 ? 'text-amber-800' : 'text-slate-900'
                }`}
              >
                {formatSignedIDR(line.amount)}
              </span>
            </div>
          ))}
        </div>
      )}
      <div className="px-6 py-2.5 bg-slate-50/40 flex items-center justify-between gap-4 text-sm font-semibold text-slate-900 border-t border-slate-100">
        <span>{subtotalLabel}</span>
        <span className="font-mono tabular-nums whitespace-nowrap">
          {formatSignedIDR(subtotalAmount)}
        </span>
      </div>
    </div>
  );
}

function IncomeStatementCard({
  report,
}: {
  report: FinancialStatementsResponse;
}) {
  const is = report.incomeStatement;
  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-display text-base font-bold text-slate-900">
            Income Statement (Profit &amp; Loss)
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            {report.company.name} &middot; Period{' '}
            <span className="font-mono">{report.period.startDate}</span> to{' '}
            <span className="font-mono">{report.period.endDate}</span> &middot;{' '}
            {report.integrity.labeledRecordsInPeriod} labeled transaction
            {report.integrity.labeledRecordsInPeriod === 1 ? '' : 's'}
          </p>
        </div>
        <span className="text-xs font-mono text-slate-500">Currency: IDR</span>
      </div>

      <StatementSectionTable
        title="Revenue (COA 4xxx)"
        lines={is.revenue}
        emptyLabel="No revenue entries recorded in this period."
        subtotalLabel="Net Revenue"
        subtotalAmount={is.totalRevenue}
      />

      <StatementSectionTable
        title="Direct Operating Costs (COA 5xxx)"
        lines={is.directCosts}
        emptyLabel="No direct operating costs recorded in this period."
        subtotalLabel="Total Direct Operating Costs"
        subtotalAmount={is.totalDirectCosts}
      />

      <div className="px-6 py-3 bg-[#EFF8F8] border-y border-teal-200/70 flex items-center justify-between gap-4">
        <div>
          <span className="font-display text-sm font-bold text-teal-950">
            Gross Profit
          </span>
          <span className="ml-2 text-xs font-mono text-teal-800 tabular-nums">
            ({is.grossMarginPercent.toFixed(1)}% margin)
          </span>
        </div>
        <span className="font-mono text-sm font-bold text-teal-950 tabular-nums">
          {formatSignedIDR(is.grossProfit)}
        </span>
      </div>

      <StatementSectionTable
        title="Operating & Administrative Expenses (COA 6xxx)"
        lines={is.operatingExpenses}
        emptyLabel="No operating or administrative expenses recorded in this period."
        subtotalLabel="Total Operating Expenses"
        subtotalAmount={is.totalOperatingExpenses}
      />

      <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between gap-4">
        <div>
          <p className="font-display text-base font-bold">Net Income</p>
          <p className="text-xs text-slate-300 font-mono tabular-nums mt-0.5">
            Net Profit Margin: {is.netMarginPercent.toFixed(1)}%
          </p>
        </div>
        <span className="font-mono text-lg font-bold tabular-nums">
          {formatSignedIDR(is.netIncome)}
        </span>
      </div>
    </div>
  );
}

function BalanceSheetCard({ report }: { report: FinancialStatementsResponse }) {
  const bs = report.balanceSheet;
  return (
    <div className="space-y-4">
      <div className="bg-white border border-slate-200 rounded-xl px-6 py-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-base font-bold text-slate-900">
            Balance Sheet (Statement of Financial Position)
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            {report.company.name} &middot; Cumulative balances as of{' '}
            <span className="font-mono">{report.period.endDate}</span> &middot;{' '}
            {report.integrity.labeledRecordsAsOfEnd} labeled entries
          </p>
        </div>
        <div className="inline-flex items-center gap-1.5 text-xs font-semibold">
          {bs.isBalanced ? (
            <>
              <CheckCircle2 className="w-4 h-4 text-teal-700" />
              <span className="text-teal-700">
                Accounting Equation Verified (Assets = Liabilities + Equity)
              </span>
            </>
          ) : (
            <>
              <AlertTriangle className="w-4 h-4 text-red-700" />
              <span className="text-red-700">
                Out of balance by {formatIDR(Math.abs(bs.balanceDiscrepancy))}
              </span>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        {/* Left Column: Assets */}
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-6 py-3.5 border-b border-slate-200 bg-slate-50/50">
            <h3 className="font-display text-sm font-bold text-slate-900">
              Assets
            </h3>
          </div>
          <StatementSectionTable
            title="Current Assets"
            lines={bs.currentAssets}
            emptyLabel="No current asset balances."
            subtotalLabel="Total Current Assets"
            subtotalAmount={bs.totalCurrentAssets}
          />
          <StatementSectionTable
            title="Fixed Assets & Depreciation"
            lines={bs.fixedAssets}
            emptyLabel="No fixed asset balances."
            subtotalLabel="Total Fixed Assets"
            subtotalAmount={bs.totalFixedAssets}
          />
          <div className="px-6 py-3.5 bg-slate-900 text-white flex items-center justify-between gap-4">
            <span className="font-display text-sm font-bold">Total Assets</span>
            <span className="font-mono text-base font-bold tabular-nums">
              {formatSignedIDR(bs.totalAssets)}
            </span>
          </div>
        </div>

        {/* Right Column: Liabilities & Equity */}
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-6 py-3.5 border-b border-slate-200 bg-slate-50/50">
            <h3 className="font-display text-sm font-bold text-slate-900">
              Liabilities &amp; Equity
            </h3>
          </div>
          <StatementSectionTable
            title="Current Liabilities"
            lines={bs.currentLiabilities}
            emptyLabel="No current liability balances."
            subtotalLabel="Total Current Liabilities"
            subtotalAmount={bs.totalCurrentLiabilities}
          />
          <StatementSectionTable
            title="Non-Current Liabilities"
            lines={bs.nonCurrentLiabilities}
            emptyLabel="No non-current liability balances."
            subtotalLabel="Total Non-Current Liabilities"
            subtotalAmount={bs.totalNonCurrentLiabilities}
          />

          <div className="px-6 py-2.5 bg-slate-100/70 flex items-center justify-between gap-4 text-sm font-semibold text-slate-900 border-y border-slate-200">
            <span>Total Liabilities</span>
            <span className="font-mono tabular-nums">
              {formatSignedIDR(bs.totalLiabilities)}
            </span>
          </div>

          <div className="border-b border-slate-100">
            <div className="px-6 py-2.5 bg-slate-50/70 border-b border-slate-100">
              <h4 className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
                Equity
              </h4>
            </div>
            <div className="divide-y divide-slate-100">
              {bs.equityAccounts.map((line) => (
                <div
                  key={line.account_id}
                  className="px-6 py-2.5 flex items-center justify-between gap-4 text-sm hover:bg-[#F3FAFA] transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="font-mono text-xs text-teal-800 font-medium w-20 shrink-0">
                      {line.code}
                    </span>
                    <span className="text-slate-800 truncate">{line.name}</span>
                  </div>
                  <span className="font-mono text-sm tabular-nums text-slate-900 whitespace-nowrap">
                    {formatSignedIDR(line.amount)}
                  </span>
                </div>
              ))}
              <div className="px-6 py-2.5 flex items-center justify-between gap-4 text-sm bg-[#EFF8F8]/50">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="font-mono text-xs text-teal-700 font-medium w-20 shrink-0">
                    AUTO-IS
                  </span>
                  <span className="text-slate-800 font-medium truncate">
                    Current &amp; Unclosed Net Earnings
                  </span>
                </div>
                <span
                  className={`font-mono text-sm font-medium tabular-nums whitespace-nowrap ${
                    bs.currentPeriodEarnings >= 0
                      ? 'text-teal-800'
                      : 'text-red-700'
                  }`}
                >
                  {formatSignedIDR(bs.currentPeriodEarnings)}
                </span>
              </div>
            </div>
            <div className="px-6 py-2.5 bg-slate-50/40 flex items-center justify-between gap-4 text-sm font-semibold text-slate-900 border-t border-slate-100">
              <span>Total Equity</span>
              <span className="font-mono tabular-nums">
                {formatSignedIDR(bs.totalEquity)}
              </span>
            </div>
          </div>

          <div className="px-6 py-3.5 bg-slate-900 text-white flex items-center justify-between gap-4">
            <span className="font-display text-sm font-bold">
              Total Liabilities &amp; Equity
            </span>
            <span className="font-mono text-base font-bold tabular-nums">
              {formatSignedIDR(bs.totalLiabilitiesAndEquity)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function CashFlowCard({ report }: { report: FinancialStatementsResponse }) {
  const cf = report.cashFlow;
  const sections = [
    {
      title: 'Cash Flows from Operating Activities',
      lines: cf.operating,
      empty: 'No operating cash movements in this period.',
      subtotalLabel: 'Net Cash from Operating Activities',
      subtotal: cf.netOperatingCash,
    },
    {
      title: 'Cash Flows from Investing Activities',
      lines: cf.investing,
      empty: 'No investing cash movements (fleet/fixed assets) in this period.',
      subtotalLabel: 'Net Cash from Investing Activities',
      subtotal: cf.netInvestingCash,
    },
    {
      title: 'Cash Flows from Financing Activities',
      lines: cf.financing,
      empty: 'No financing cash movements (capital/loans/drawings) in this period.',
      subtotalLabel: 'Net Cash from Financing Activities',
      subtotal: cf.netFinancingCash,
    },
  ];

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-base font-bold text-slate-900">
            Statement of Cash Flows (Direct Method)
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            {report.company.name} &middot; Period{' '}
            <span className="font-mono">{report.period.startDate}</span> to{' '}
            <span className="font-mono">{report.period.endDate}</span> &middot;
            Tracks Cash in Bank (COA-1010) &amp; Petty Cash (COA-1020)
          </p>
        </div>
        <div className="inline-flex items-center gap-1.5 text-xs font-semibold">
          {cf.isReconciled ? (
            <>
              <CheckCircle2 className="w-4 h-4 text-teal-700" />
              <span className="text-teal-700">
                Reconciled with Balance Sheet Cash
              </span>
            </>
          ) : (
            <>
              <AlertTriangle className="w-4 h-4 text-red-700" />
              <span className="text-red-700">
                Variance {formatIDR(Math.abs(cf.cashDiscrepancy))}
              </span>
            </>
          )}
        </div>
      </div>

      <div className="px-6 py-3 bg-slate-50/70 border-b border-slate-200 flex items-center justify-between gap-4 text-sm font-medium text-slate-800">
        <span>Beginning Cash &amp; Cash Equivalents (Before {report.period.startDate})</span>
        <span className="font-mono tabular-nums font-semibold">
          {formatSignedIDR(cf.beginningCash)}
        </span>
      </div>

      {sections.map((sec) => (
        <div key={sec.title} className="border-b border-slate-100">
          <div className="px-6 py-2.5 bg-slate-50/70 border-b border-slate-100">
            <h3 className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
              {sec.title}
            </h3>
          </div>
          {sec.lines.length === 0 ? (
            <div className="px-6 py-4 text-xs text-slate-400">{sec.empty}</div>
          ) : (
            <div className="divide-y divide-slate-100">
              {sec.lines.map((line) => (
                <div
                  key={line.account_id}
                  className="px-6 py-2.5 flex items-center justify-between gap-4 text-sm hover:bg-[#F3FAFA] transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="font-mono text-xs text-teal-800 font-medium w-20 shrink-0">
                      {line.code}
                    </span>
                    <span className="text-slate-800 truncate">{line.name}</span>
                    <span className="text-xs text-slate-400 shrink-0">
                      ({line.txCount} tx)
                    </span>
                  </div>
                  <span
                    className={`font-mono text-sm tabular-nums whitespace-nowrap ${
                      line.amount >= 0 ? 'text-teal-800' : 'text-red-700'
                    }`}
                  >
                    {line.amount >= 0 ? `+${formatIDR(line.amount)}` : formatSignedIDR(line.amount)}
                  </span>
                </div>
              ))}
            </div>
          )}
          <div className="px-6 py-2.5 bg-slate-50/40 flex items-center justify-between gap-4 text-sm font-semibold text-slate-900 border-t border-slate-100">
            <span>{sec.subtotalLabel}</span>
            <span
              className={`font-mono tabular-nums ${
                sec.subtotal >= 0 ? 'text-teal-800' : 'text-red-700'
              }`}
            >
              {formatSignedIDR(sec.subtotal)}
            </span>
          </div>
        </div>
      ))}

      <div className="px-6 py-3 bg-[#EFF8F8] border-y border-teal-200/70 flex items-center justify-between gap-4 text-sm font-semibold text-teal-950">
        <span>Net Increase / (Decrease) in Cash</span>
        <span className="font-mono tabular-nums">
          {formatSignedIDR(cf.netChangeInCash)}
        </span>
      </div>

      <div className="px-6 py-4 bg-slate-900 text-white flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="font-display text-base font-bold">
            Ending Cash &amp; Cash Equivalents
          </p>
          <p className="text-xs text-slate-300 font-mono tabular-nums mt-0.5">
            Balance Sheet Cash as of {report.period.endDate}:{' '}
            {formatSignedIDR(cf.balanceSheetCash)}
          </p>
        </div>
        <span className="font-mono text-lg font-bold tabular-nums">
          {formatSignedIDR(cf.endingCash)}
        </span>
      </div>
    </div>
  );
}
