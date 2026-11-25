import React, { useEffect, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ArrowUpRight } from 'lucide-react';
import {
  api,
  formatIDR,
  formatStatusLabel,
  formatWeight,
  statusTextClass,
} from '../lib/api.ts';
import { useNavigation } from '../lib/navigation.tsx';
import type { DashboardSummary } from '../shared/types.ts';
import { DashboardSkeleton } from './Skeleton.tsx';

export function DashboardView() {
  const { openLayer, navigatePage, dataVersion } = useNavigation();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    api
      .dashboardSummary()
      .then((res) => {
        if (active) setSummary(res);
      })
      .catch((err) => {
        if (active) {
          setError(err instanceof Error ? err.message : 'Failed to load dashboard.');
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [dataVersion]);

  if (loading) {
    return <DashboardSkeleton />;
  }

  if (error || !summary) {
    return (
      <div className="bg-white border border-red-200 rounded-lg p-6 text-sm text-red-700">
        {error || 'Unable to load dashboard summary.'}
      </div>
    );
  }

  const { kpis } = summary;

  return (
    <div className="space-y-6">
      {/* KPI Strip — 4 flat single-elevation cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <p className="text-xs font-medium text-slate-500">Collected B3 Volume</p>
          <p className="mt-2 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
            {formatWeight(kpis.totalPickupsKg)}
          </p>
          <p className="mt-1.5 text-xs text-slate-500">
            {kpis.issuedCertificatesCount} compliance certificates issued
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <p className="text-xs font-medium text-slate-500">Collected Revenue</p>
          <p className="mt-2 font-mono text-2xl font-semibold text-teal-800 tabular-nums">
            {formatIDR(kpis.paidRevenueAmount)}
          </p>
          <p className="mt-1.5 text-xs text-slate-500">
            Settled Limbah B3 billing
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <p className="text-xs font-medium text-slate-500">Unpaid Receivables</p>
          <p className="mt-2 font-mono text-2xl font-semibold text-amber-700 tabular-nums">
            {formatIDR(kpis.unpaidInvoicesAmount)}
          </p>
          <p className="mt-1.5 text-xs text-slate-500">
            {kpis.unpaidInvoicesCount} open or overdue invoices
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <p className="text-xs font-medium text-slate-500">Active B3 Clients</p>
          <p className="mt-2 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
            {kpis.totalClients}
          </p>
          <p className="mt-1.5 text-xs text-slate-500">
            {kpis.activeSchedulesCount} active pickup schedules
          </p>
        </div>
      </div>

      {/* Main Analytics Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <section className="lg:col-span-2 bg-white border border-slate-200 rounded-lg p-6">
          <div className="flex items-baseline justify-between gap-4 mb-5">
            <div>
              <h2 className="font-display text-base font-semibold text-slate-900">
                Monthly Limbah B3 Tonnage
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Verified pickup volume in kilograms across the last 6 months
              </p>
            </div>
            <span className="text-xs font-mono text-slate-500 tabular-nums">
              FY 2026
            </span>
          </div>

          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={summary.monthlyVolume}
                margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                <XAxis
                  dataKey="month"
                  tick={{ fill: '#64748B', fontSize: 12 }}
                  axisLine={{ stroke: '#CBD5E1' }}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fill: '#64748B', fontSize: 12 }}
                  axisLine={false}
                  tickLine={false}
                  width={52}
                />
                <Tooltip
                  cursor={{ fill: '#F1F5F9' }}
                  contentStyle={{
                    borderRadius: '8px',
                    border: '1px solid #E2E8F0',
                    fontSize: '12px',
                    boxShadow: 'none',
                  }}
                  formatter={(value) => [
                    `${Number(value ?? 0).toLocaleString('id-ID')} kg`,
                    'Collected Volume',
                  ]}
                />
                <Bar dataKey="weightKg" fill="#0F766E" radius={[4, 4, 0, 0]} maxBarSize={44} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        {/* Hazard Classification Breakdown & Upcoming Schedules */}
        <section className="bg-white border border-slate-200 rounded-lg p-6 flex flex-col justify-between">
          <div>
            <h2 className="font-display text-base font-semibold text-slate-900">
              Hazard Class Mix
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              KLHK B3 Category 1 vs Category 2 weight split
            </p>

            <div className="mt-5 space-y-4">
              {summary.hazardBreakdown.map((item) => {
                const pct =
                  kpis.totalPickupsKg > 0
                    ? Math.round((item.weightKg / kpis.totalPickupsKg) * 100)
                    : 0;
                return (
                  <div key={item.category} className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-700 font-medium">{item.category}</span>
                      <span className="font-mono text-slate-600 tabular-nums">
                        {formatWeight(item.weightKg)} ({pct}%)
                      </span>
                    </div>
                    <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-teal-700 rounded-full"
                        style={{ width: `${Math.max(pct, 4)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="mt-6 pt-5 border-t border-slate-100">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold text-slate-700">
                Upcoming Dispatches
              </h3>
              <button
                type="button"
                onClick={() => navigatePage('/b3/operational/schedule')}
                className="text-xs text-teal-700 hover:text-teal-900 font-medium inline-flex items-center gap-0.5"
              >
                All schedules <ArrowUpRight className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="divide-y divide-slate-100">
              {summary.upcomingSchedules.slice(0, 3).map((sch) => (
                <div
                  key={sch.id}
                  className="py-2.5 flex items-center justify-between gap-2 text-xs"
                >
                  <div className="min-w-0">
                    <button
                      type="button"
                      onClick={() =>
                        openLayer({
                          kind: 'inspect',
                          entity: 'schedules',
                          recordId: sch.id,
                        })
                      }
                      className="font-mono font-medium text-teal-700 hover:underline"
                    >
                      {sch.id}
                    </button>
                    <p className="text-slate-500 truncate mt-0.5">
                      {sch.vehicle_number || sch.vehicle_plate || 'Fleet'} &middot;{' '}
                      {sch.id_branch || sch.branch_id || sch.client_id || '—'}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 ${statusTextClass(sch.status || 'scheduled')}`}
                  >
                    {formatStatusLabel(sch.status || 'scheduled')}
                  </span>
                </div>
              ))}
              {summary.upcomingSchedules.length === 0 && (
                <p className="py-3 text-xs text-slate-400">
                  No upcoming dispatches scheduled.
                </p>
              )}
            </div>
          </div>
        </section>
      </div>

      {/* Unpaid Invoices Watchlist */}
      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-base font-semibold text-slate-900">
              Open &amp; Overdue Invoices
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Click any ID to inspect details in a workspace layer without leaving the dashboard
            </p>
          </div>
          <button
            type="button"
            onClick={() => navigatePage('/b3/documents/invoice')}
            className="text-xs font-medium text-teal-700 hover:text-teal-900 whitespace-nowrap"
          >
            View all invoices
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/70 text-xs text-slate-500 font-medium">
                <th className="py-2.5 px-6">Invoice ID</th>
                <th className="py-2.5 px-4">Client Ref</th>
                <th className="py-2.5 px-4">PO Ref</th>
                <th className="py-2.5 px-4">Period / Date</th>
                <th className="py-2.5 px-4 text-right">Amount</th>
                <th className="py-2.5 px-6 text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {summary.unpaidInvoices.map((inv) => {
                const invClientId = inv.id_user_model || inv.client_id || '';
                const invAmount = Number(inv.total_amount ?? inv.amount ?? 0);
                const invDate = inv.date_period || inv.due_date || '';
                return (
                <tr key={inv.id} className="hover:bg-slate-50/80 transition-colors">
                  <td className="py-3 px-6 font-mono text-xs">
                    <button
                      type="button"
                      onClick={() =>
                        openLayer({
                          kind: 'inspect',
                          entity: 'invoices',
                          recordId: inv.id,
                        })
                      }
                      className="text-teal-700 hover:underline font-medium"
                    >
                      {inv.id}
                    </button>
                  </td>
                  <td className="py-3 px-4 font-mono text-xs">
                    {invClientId ? (
                      <button
                        type="button"
                        onClick={() =>
                          openLayer({
                            kind: 'inspect',
                            entity: 'customers',
                            recordId: invClientId,
                          })
                        }
                        className="text-slate-700 hover:text-teal-700 hover:underline"
                      >
                        {invClientId}
                      </button>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="py-3 px-4 font-mono text-xs text-slate-600">
                    {inv.po_id ? (
                      <button
                        type="button"
                        onClick={() =>
                          openLayer({
                            kind: 'inspect',
                            entity: 'purchase_orders',
                            recordId: inv.po_id!,
                          })
                        }
                        className="hover:text-teal-700 hover:underline"
                      >
                        {inv.po_id}
                      </button>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="py-3 px-4 font-mono text-xs text-slate-600 tabular-nums">
                    {invDate}
                  </td>
                  <td className="py-3 px-4 font-mono text-xs text-slate-900 text-right tabular-nums">
                    {formatIDR(invAmount)}
                  </td>
                  <td className={`py-3 px-6 text-xs text-right ${statusTextClass(inv.status)}`}>
                    {formatStatusLabel(inv.status)}
                  </td>
                </tr>
                );
              })}
              {summary.unpaidInvoices.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-sm text-slate-500">
                    All invoices are settled.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
