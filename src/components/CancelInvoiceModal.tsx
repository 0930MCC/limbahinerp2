import React, { useEffect, useState } from 'react';
import { AlertTriangle, Ban, X } from 'lucide-react';
import { api, formatIDR } from '../lib/api.ts';
import { useFeedback } from '../lib/feedback.tsx';
import type { CancelInvoiceResponse, InvoiceRecord } from '../shared/types.ts';

interface CancelInvoiceModalProps {
  invoice: InvoiceRecord;
  onClose: () => void;
  onCanceled: (res: CancelInvoiceResponse, reason: string) => void;
}

export function CancelInvoiceModal({
  invoice,
  onClose,
  onCanceled,
}: CancelInvoiceModalProps) {
  const { notifyError, notifySuccess } = useFeedback();
  const [cancelDate, setCancelDate] = useState(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [reason, setReason] = useState('');
  const [treatment, setTreatment] = useState<'auto_reverse' | 'manual'>(
    'auto_reverse'
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, submitting]);

  const invNumber = invoice.invoice_number || invoice.id;
  const totalAmount = Number(invoice.total_amount ?? invoice.amount ?? 0);
  const taxAmount = Number(invoice.tax_amount ?? 0);
  const subtotalAmount =
    Number(invoice.subtotal_amount || 0) > 0
      ? Number(invoice.subtotal_amount)
      : Math.max(0, totalAmount - taxAmount);

  const handleConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) {
      setError('Please enter a cancellation reason.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const autoReverse = treatment === 'auto_reverse';
      const res = await api.cancelInvoice(invoice.id, {
        cancelDate,
        reason: reason.trim(),
        autoReverse,
      });
      notifySuccess(res.message);
      onCanceled(res, reason.trim());
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Failed to cancel invoice.';
      setError(msg);
      notifyError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Cancel invoice ${invNumber}`}
      className="fixed inset-0 z-[70] bg-slate-900/45 backdrop-blur-[2px] flex items-center justify-center p-4"
    >
      <div
        className="fixed inset-0"
        onClick={() => !submitting && onClose()}
        aria-hidden="true"
      />
      <form
        onSubmit={handleConfirm}
        className="relative z-10 w-full max-w-lg bg-white border border-slate-200 rounded-xl shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-red-50 border border-red-200 text-red-700 flex items-center justify-center shrink-0 mt-0.5">
              <Ban className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h2 className="font-display text-base font-bold text-slate-900 truncate">
                Cancel Invoice {invNumber}
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Choose how the accounting ledger should treat this cancellation.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            aria-label="Close dialog"
            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-md transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5 max-h-[75vh] overflow-y-auto">
          {/* Financial Summary Strip */}
          <div className="grid grid-cols-3 gap-3 p-3.5 rounded-lg bg-slate-50 border border-slate-200 text-xs">
            <div>
              <p className="text-slate-500">Subtotal (DPP)</p>
              <p className="mt-0.5 font-mono font-semibold text-slate-900 tabular-nums">
                {formatIDR(subtotalAmount)}
              </p>
            </div>
            <div>
              <p className="text-slate-500">Tax (PPN)</p>
              <p className="mt-0.5 font-mono font-semibold text-slate-900 tabular-nums">
                {formatIDR(taxAmount)}
              </p>
            </div>
            <div>
              <p className="text-slate-500">Total Receivable</p>
              <p className="mt-0.5 font-mono font-semibold text-teal-800 tabular-nums">
                {formatIDR(totalAmount)}
              </p>
            </div>
          </div>

          {error && (
            <div
              role="alert"
              className="px-3.5 py-2.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800"
            >
              {error}
            </div>
          )}

          {/* Inputs */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                Cancellation Date
              </label>
              <input
                type="date"
                value={cancelDate}
                onChange={(e) => setCancelDate(e.target.value)}
                required
                className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600/30 focus:border-teal-700"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                Invoice Reference
              </label>
              <input
                type="text"
                value={`${invNumber} (${invoice.id})`}
                disabled
                className="w-full px-3 py-2 text-xs font-mono bg-slate-50 text-slate-500 border border-slate-200 rounded-lg"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">
              Cancellation Reason
            </label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
              placeholder="e.g., Client canceled pickup order"
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600/30 focus:border-teal-700"
            />
          </div>

          {/* Accounting Treatment Radio Selection */}
          <div className="space-y-2.5">
            <p className="text-xs font-medium text-slate-700">
              Accounting Treatment
            </p>

            <label
              className={`block p-3.5 rounded-lg border cursor-pointer transition-colors ${
                treatment === 'auto_reverse'
                  ? 'bg-[#EFF8F8] border-teal-600'
                  : 'bg-white border-slate-200 hover:bg-slate-50'
              }`}
            >
              <div className="flex items-start gap-2.5">
                <input
                  type="radio"
                  name="accounting_treatment"
                  checked={treatment === 'auto_reverse'}
                  onChange={() => setTreatment('auto_reverse')}
                  className="mt-0.5 text-teal-700 focus:ring-teal-600"
                />
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-slate-900">
                    Option A — Auto Counter-Reversal (Recommended)
                  </p>
                  <p className="mt-1 text-xs text-slate-600 leading-relaxed">
                    Automatically posts a reversal entry (
                    <span className="font-mono text-slate-800">
                      DR COA-4010 B3 Waste Transport Revenue
                    </span>
                    {taxAmount > 0 && (
                      <>
                        ,{' '}
                        <span className="font-mono text-slate-800">
                          DR COA-2110 PPN Keluaran (VAT Output)
                        </span>
                      </>
                    )}
                    ,{' '}
                    <span className="font-mono text-slate-800">
                      CR COA-1110 Accounts Receivable
                    </span>
                    ). Use when the invoice is unpaid and Faktur Pajak can be
                    canceled.
                  </p>
                </div>
              </div>
            </label>

            <label
              className={`block p-3.5 rounded-lg border cursor-pointer transition-colors ${
                treatment === 'manual'
                  ? 'bg-amber-50/70 border-amber-500'
                  : 'bg-white border-slate-200 hover:bg-slate-50'
              }`}
            >
              <div className="flex items-start gap-2.5">
                <input
                  type="radio"
                  name="accounting_treatment"
                  checked={treatment === 'manual'}
                  onChange={() => setTreatment('manual')}
                  className="mt-0.5 text-teal-700 focus:ring-teal-600"
                />
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-slate-900">
                    Option B — Manual Adjustment Only
                  </p>
                  <p className="mt-1 text-xs text-slate-600 leading-relaxed">
                    Marks the invoice as canceled without generating automatic
                    ledger entries, then opens the Manual Journal screen
                    pre-filled with this invoice reference for custom Bad Debt
                    or Tax adjustments.
                  </p>
                </div>
              </div>
            </label>
          </div>

          <div className="flex items-start gap-2 text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
            <span>
              Once canceled, this invoice is immediately excluded from unpaid
              payment and marketing commission dropdowns regardless of the
              accounting option selected.
            </span>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-200 bg-slate-50/60 flex items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors"
          >
            Keep Active
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="px-4 py-2 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap"
          >
            {submitting
              ? 'Processing...'
              : treatment === 'auto_reverse'
                ? 'Cancel & Post Reversal'
                : 'Cancel & Open Manual Journal'}
          </button>
        </div>
      </form>
    </div>
  );
}
