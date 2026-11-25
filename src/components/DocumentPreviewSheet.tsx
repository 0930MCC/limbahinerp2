import React, { useMemo } from 'react';
import { formatIDR } from '../lib/api.ts';
import type {
  BeritaAcaraRecord,
  CustomerRecord,
  DocumentAdjustment,
  DocumentEntityKey,
  ItemRecord,
  PickupDataRecord,
} from '../shared/types.ts';

export interface DocumentPreviewSheetProps {
  entity: DocumentEntityKey;
  documentId: string;
  datePeriod: string;
  status?: string;
  note?: string;
  poNumber?: string;
  jenisInvoice?: string;
  client?: CustomerRecord | null;
  attachedDataRows: PickupDataRecord[];
  attachedBaRows: BeritaAcaraRecord[];
  allDataRows: PickupDataRecord[];
  itemMap: Map<string, ItemRecord>;
  customerMap: Map<string, CustomerRecord>;
  subtotal: number;
  adjustments: DocumentAdjustment[];
  grandTotal: number;
}

const ID_MONTHS = [
  'Januari',
  'Februari',
  'Maret',
  'April',
  'Mei',
  'Juni',
  'Juli',
  'Agustus',
  'September',
  'Oktober',
  'November',
  'Desember',
];

const EN_MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function formatDateIndonesian(dateStr?: string | null): string {
  if (!dateStr) return '-';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateStr).trim());
  if (!m) return String(dateStr);
  const year = m[1];
  const monthIdx = Number(m[2]) - 1;
  const day = Number(m[3]);
  return `${day} ${ID_MONTHS[monthIdx] || m[2]} ${year}`;
}

function formatDateEnglish(dateStr?: string | null): string {
  if (!dateStr) return '-';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateStr).trim());
  if (!m) return String(dateStr);
  const year = m[1];
  const monthIdx = Number(m[2]) - 1;
  const day = Number(m[3]);
  return `${day} ${EN_MONTHS[monthIdx] || m[2]} ${year}`;
}

function formatNumberPlain(value: number | string | null | undefined): string {
  const num = Number(value ?? 0);
  if (!Number.isFinite(num)) return '0';
  return new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 }).format(num);
}

/**
 * Deterministic 21x21 QR-style matrix SVG seeded from the document ID so
 * every document preview displays a clean, crisp document verification QR mark.
 */
function DocumentQrSvg({ value }: { value: string }) {
  const modules = useMemo(() => {
    const size = 21;
    const grid: boolean[][] = Array.from({ length: size }, () =>
      Array.from({ length: size }, () => false)
    );

    const drawFinder = (r0: number, c0: number) => {
      for (let r = 0; r < 7; r += 1) {
        for (let c = 0; c < 7; c += 1) {
          const isBorder = r === 0 || r === 6 || c === 0 || c === 6;
          const isInner = r >= 2 && r <= 4 && c >= 2 && c <= 4;
          grid[r0 + r][c0 + c] = isBorder || isInner;
        }
      }
    };

    drawFinder(0, 0);
    drawFinder(0, size - 7);
    drawFinder(size - 7, 0);

    // Timing patterns
    for (let i = 8; i < size - 8; i += 1) {
      grid[6][i] = i % 2 === 0;
      grid[i][6] = i % 2 === 0;
    }

    // Deterministic FNV-style hash fill for data area
    let seed = 2166136261;
    const text = value || 'LIMBAHIN-DOC';
    for (let i = 0; i < text.length; i += 1) {
      seed ^= text.charCodeAt(i);
      seed = Math.imul(seed, 16777619);
    }

    const isReserved = (r: number, c: number) => {
      if (r < 8 && c < 8) return true;
      if (r < 8 && c >= size - 8) return true;
      if (r >= size - 8 && c < 8) return true;
      if (r === 6 || c === 6) return true;
      return false;
    };

    for (let r = 0; r < size; r += 1) {
      for (let c = 0; c < size; c += 1) {
        if (isReserved(r, c)) continue;
        seed ^= (r * 31 + c * 17) & 0xff;
        seed = Math.imul(seed, 16777619);
        grid[r][c] = ((seed >>> 16) & 1) === 1;
      }
    }

    const rects: Array<{ x: number; y: number }> = [];
    for (let r = 0; r < size; r += 1) {
      for (let c = 0; c < size; c += 1) {
        if (grid[r][c]) rects.push({ x: c, y: r });
      }
    }
    return rects;
  }, [value]);

  return (
    <svg
      viewBox="0 0 21 21"
      className="w-[74px] h-[74px] shrink-0"
      aria-label={`QR code for ${value}`}
    >
      <rect width="21" height="21" fill="#ffffff" />
      {modules.map((m, idx) => (
        <rect
          key={idx}
          x={m.x}
          y={m.y}
          width={1}
          height={1}
          fill="#0F172A"
        />
      ))}
    </svg>
  );
}

/**
 * Shared LIMBAHIN official letterhead (matches MCC Invoice & BA PDF templates,
 * strictly using LIMBAHIN branding).
 */
function LimbahinLetterhead({ documentId }: { documentId: string }) {
  return (
    <div>
      {/* Top Brand Row */}
      <div className="flex items-center justify-between gap-4 pb-3 border-b border-slate-300">
        <div className="flex items-center gap-3">
          <img
            src="/assets/aistudio/Logo_b14b4906.jpg"
            alt="LIMBAHIN logo"
            referrerPolicy="no-referrer"
            className="w-11 h-11 object-contain shrink-0"
          />
          <div>
            <div className="font-display text-[22px] font-extrabold tracking-[0.06em] leading-none text-[#1E96AC]">
              LIMBAHIN
            </div>
            <div className="text-[9px] font-semibold tracking-[0.22em] text-slate-500 mt-1">
              WASTE MANAGEMENT SOLUTION
            </div>
          </div>
        </div>
        <div className="text-right text-[11px] leading-snug text-slate-600">
          <div>Dikelola oleh</div>
          <div className="font-bold text-slate-800">PT. Media Cahaya Cerah</div>
        </div>
      </div>

      {/* QR + Head Office Row */}
      <div className="flex items-start justify-between gap-4 pt-3 pb-4">
        <div className="flex items-center gap-2.5">
          <DocumentQrSvg value={documentId} />
          <div className="text-[9.5px] font-mono text-slate-500 leading-tight hidden sm:block">
            <div className="uppercase tracking-wider text-slate-400">Doc Ref</div>
            <div className="text-slate-700 font-semibold mt-0.5">
              {documentId || 'PREVIEW'}
            </div>
          </div>
        </div>
        <div className="text-right text-[10.5px] leading-[1.45] text-slate-700">
          <div className="font-display font-bold text-[#1E96AC] tracking-wide text-[11.5px]">
            HEAD OFFICE
          </div>
          <div>Ruko Boutique Office Icon City Blok B23, Jln. Boulevard</div>
          <div>Raya Deltamas No.189, Cikarang Pusat 17531</div>
          <div>Tel +(021) 8911 8485 - Mobile WA +(62) 815 1700 5533</div>
          <div className="text-slate-600">
            cs@mediacahayacerah.com | www.mediacahayacerah.com
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Official PT. Media Cahaya Cerah circular stamp + signature block.
 */
function MccStampAndSignature({
  topLabel = 'Hormat Kami,',
  bottomName,
  bottomTitle,
  dateLine,
  align = 'right',
}: {
  topLabel?: string;
  bottomName?: string;
  bottomTitle?: string;
  dateLine?: string;
  align?: 'left' | 'right';
}) {
  const alignCls = align === 'left' ? 'items-start text-left' : 'items-end text-right';
  return (
    <div className={`flex flex-col ${alignCls} text-[11px] text-slate-800`}>
      <div>{topLabel}</div>
      <div className="font-bold text-slate-900 mt-0.5">
        PT. MEDIA CAHAYA CERAH
      </div>

      {/* Official MCC Stamp & Signature SVG */}
      <div className="relative h-[78px] w-[170px] flex items-center justify-center my-1">
        <svg
          viewBox="0 0 180 86"
          className="w-full h-full"
          aria-label="PT. Media Cahaya Cerah Official Stamp"
        >
          {/* Subtle circular company stamp */}
          <g transform="translate(56, 43)" opacity="0.72">
            <circle
              cx="0"
              cy="0"
              r="34"
              fill="none"
              stroke="#1E7B9C"
              strokeWidth="1.8"
            />
            <circle
              cx="0"
              cy="0"
              r="29"
              fill="none"
              stroke="#1E7B9C"
              strokeWidth="0.9"
              strokeDasharray="2 1.5"
            />
            <text
              x="0"
              y="-15"
              textAnchor="middle"
              fontSize="5.5"
              fontWeight="700"
              fill="#1E7B9C"
              letterSpacing="0.8"
            >
              PT. MEDIA CAHAYA CERAH
            </text>
            <text
              x="0"
              y="3"
              textAnchor="middle"
              fontSize="7.5"
              fontWeight="800"
              fill="#1E7B9C"
              letterSpacing="1"
            >
              LIMBAHIN
            </text>
            <text
              x="0"
              y="18"
              textAnchor="middle"
              fontSize="5"
              fontWeight="600"
              fill="#1E7B9C"
              letterSpacing="0.6"
            >
              CIKARANG PUSAT
            </text>
          </g>
          {/* Stylized signature flourish */}
          <path
            d="M42 54 C 58 24, 74 22, 82 48 C 88 64, 102 36, 114 42 C 122 46, 128 32, 146 38 C 120 50, 96 58, 152 54"
            fill="none"
            stroke="#1E3A5F"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>

      {bottomName && (
        <div className="font-bold text-slate-900 border-b border-slate-800 pb-0.5 px-2">
          {bottomName}
        </div>
      )}
      {bottomTitle && (
        <div className="text-[10.5px] text-slate-700 mt-0.5">{bottomTitle}</div>
      )}
      {dateLine && (
        <div className="text-[10.5px] text-slate-700 mt-1">{dateLine}</div>
      )}
    </div>
  );
}

/**
 * Helper to summarize total quantities per unit for BA & Certificate tables.
 */
function summarizeQtyByUnit(rows: PickupDataRecord[]): string {
  if (rows.length === 0) return '0 Kg';
  const map = new Map<string, number>();
  for (const r of rows) {
    const unit = (r.unit || 'Kg').trim();
    const qty = Number(r.quantity ?? r.weight_kg ?? 0);
    map.set(unit, (map.get(unit) || 0) + (Number.isFinite(qty) ? qty : 0));
  }
  return Array.from(map.entries())
    .map(([unit, qty]) => `${formatNumberPlain(qty)} ${unit}`)
    .join(' + ');
}

export function DocumentPreviewSheet({
  entity,
  documentId,
  datePeriod,
  status,
  note,
  poNumber,
  jenisInvoice,
  client,
  attachedDataRows,
  attachedBaRows,
  allDataRows,
  itemMap,
  customerMap,
  subtotal,
  adjustments,
  grandTotal,
}: DocumentPreviewSheetProps) {
  const displayId = documentId || 'DRAFT-PREVIEW';
  const roundedTotal = Math.round(grandTotal / 100) * 100;

  // =========================================================================
  // 1. CERTIFICATE OF HAZARDOUS WASTE DISPOSAL (Matches MCC-GNR-DOK PDF)
  // =========================================================================
  if (entity === 'certificates') {
    const baSummaryRows = attachedBaRows.map((ba) => {
      const baItems = allDataRows.filter((d) => d.ba_id === ba.id);
      const qtySummary =
        baItems.length > 0
          ? summarizeQtyByUnit(baItems)
          : ba.total_weight_kg
            ? `${formatNumberPlain(ba.total_weight_kg)} Kg`
            : '-';
      return {
        ba,
        qtySummary,
      };
    });

    return (
      <div className="limbahin-print-sheet mx-auto w-full max-w-[794px] bg-white shadow-sm border border-slate-200 relative overflow-hidden">
        {/* Decorative Teal Ornamental Border Frame */}
        <div className="p-4 sm:p-6">
          <div className="relative border-[3px] border-[#1E96AC] p-1.5">
            <div className="relative border border-[#72C3D1] px-7 sm:px-11 py-8 sm:py-10 min-h-[1020px] flex flex-col justify-between bg-white">
              {/* Ornamental Corner Flourishes */}
              <svg
                className="pointer-events-none absolute top-1.5 left-1.5 w-14 h-14 text-[#1E96AC]/75"
                viewBox="0 0 60 60"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M4 54 C4 22, 22 4, 54 4 M10 42 C10 22, 22 10, 42 10 M16 28 C18 20, 20 18, 28 16"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
                <circle cx="14" cy="14" r="3" fill="currentColor" />
              </svg>
              <svg
                className="pointer-events-none absolute top-1.5 right-1.5 w-14 h-14 text-[#1E96AC]/75 -scale-x-100"
                viewBox="0 0 60 60"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M4 54 C4 22, 22 4, 54 4 M10 42 C10 22, 22 10, 42 10 M16 28 C18 20, 20 18, 28 16"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
                <circle cx="14" cy="14" r="3" fill="currentColor" />
              </svg>
              <svg
                className="pointer-events-none absolute bottom-1.5 left-1.5 w-14 h-14 text-[#1E96AC]/75 -scale-y-100"
                viewBox="0 0 60 60"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M4 54 C4 22, 22 4, 54 4 M10 42 C10 22, 22 10, 42 10 M16 28 C18 20, 20 18, 28 16"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
                <circle cx="14" cy="14" r="3" fill="currentColor" />
              </svg>
              <svg
                className="pointer-events-none absolute bottom-1.5 right-1.5 w-14 h-14 text-[#1E96AC]/75 -scale-x-100 -scale-y-100"
                viewBox="0 0 60 60"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M4 54 C4 22, 22 4, 54 4 M10 42 C10 22, 22 10, 42 10 M16 28 C18 20, 20 18, 28 16"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
                <circle cx="14" cy="14" r="3" fill="currentColor" />
              </svg>

              {/* Subtle Archipelago Watermark */}
              <svg
                viewBox="0 0 600 180"
                className="pointer-events-none absolute inset-x-10 bottom-36 opacity-[0.07] text-[#1E96AC]"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M25,70 Q65,40 120,85 Q145,105 160,120 Q120,125 85,105 Q45,95 25,70 Z" />
                <path d="M168,124 Q225,118 285,130 Q305,136 270,144 Q215,142 168,124 Z" />
                <path d="M255,48 Q305,30 345,65 Q335,100 295,105 Q260,92 255,48 Z" />
                <path d="M362,65 Q395,52 415,82 Q395,108 375,112 Q365,90 362,65 Z" />
                <path d="M460,82 Q525,65 585,95 Q575,130 520,124 Q475,112 460,82 Z" />
              </svg>

              {/* Top & Center Body */}
              <div className="relative z-10 space-y-6">
                {/* Centered Corporate Header */}
                <div className="text-center pt-2 flex flex-col items-center">
                  <img
                    src="/assets/aistudio/Logo_b14b4906.jpg"
                    alt="LIMBAHIN logo"
                    referrerPolicy="no-referrer"
                    className="w-11 h-11 object-contain mb-2"
                  />
                  <div className="font-display text-[22px] font-extrabold tracking-[0.08em] text-[#1E96AC]">
                    PT. MEDIA CAHAYA CERAH
                  </div>
                  <div className="text-[11px] font-semibold tracking-[0.26em] text-slate-700 mt-1">
                    WASTE MANAGEMENT SOLUTION
                  </div>
                  <div className="text-[9.5px] font-bold tracking-[0.22em] text-[#1E96AC] mt-1">
                    LIMBAHIN
                  </div>
                </div>

                {/* Certificate Title */}
                <div className="text-center pt-2">
                  <h2 className="inline-block font-display text-[17px] font-extrabold tracking-[0.06em] text-slate-900 border-b-2 border-slate-900 pb-1">
                    CERTIFICATE OF HAZARDOUS WASTE DISPOSAL
                  </h2>
                  <div className="font-mono text-xs font-semibold text-slate-700 mt-2">
                    NO. {displayId}
                  </div>
                </div>

                {/* Presented For */}
                <div className="text-center pt-2 space-y-1.5">
                  <p className="text-xs italic text-slate-600">
                    This Certificate is Presented for:
                  </p>
                  <p className="font-display text-[20px] font-extrabold text-slate-900 tracking-wide">
                    {client?.name || 'Client Name'}
                  </p>
                  {client?.address && (
                    <p className="text-[11px] text-slate-600 max-w-md mx-auto">
                      {client.address}
                    </p>
                  )}
                </div>

                {/* Waste Data & Report Table */}
                <div className="pt-2">
                  <div className="text-center text-xs font-bold text-slate-800 mb-2 tracking-wide">
                    Waste Data &amp; Report
                  </div>
                  <table className="w-full text-[11px] border-collapse border border-slate-800">
                    <thead>
                      <tr className="bg-[#EAF7F9] text-slate-900 font-bold">
                        <th className="py-2 px-2.5 border border-slate-800 w-10 text-center">
                          No.
                        </th>
                        <th className="py-2 px-3 border border-slate-800 text-left">
                          Berita Acara
                        </th>
                        <th className="py-2 px-3 border border-slate-800 text-center">
                          Periode
                        </th>
                        <th className="py-2 px-3 border border-slate-800 text-right">
                          Jumlah Unit
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {baSummaryRows.length === 0 ? (
                        <tr>
                          <td
                            colSpan={4}
                            className="py-5 px-3 border border-slate-800 text-center text-slate-400 italic"
                          >
                            No Berita Acara (BA) attached to this certificate yet.
                          </td>
                        </tr>
                      ) : (
                        baSummaryRows.map(({ ba, qtySummary }, idx) => (
                          <tr key={ba.id}>
                            <td className="py-2 px-2.5 border border-slate-800 text-center font-mono">
                              {idx + 1}
                            </td>
                            <td className="py-2 px-3 border border-slate-800 font-mono font-semibold text-slate-900">
                              {ba.id}
                            </td>
                            <td className="py-2 px-3 border border-slate-800 text-center">
                              {formatDateIndonesian(ba.date_period || ba.ba_date)}
                            </td>
                            <td className="py-2 px-3 border border-slate-800 text-right font-mono font-semibold tabular-nums">
                              {qtySummary}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Compliance Paragraphs */}
                <div className="space-y-3 text-[11px] leading-[1.65] text-slate-700 text-justify pt-2">
                  <p>
                    PT. Media Cahaya Cerah (<span className="font-semibold">LIMBAHIN</span>)
                    hereby certifies that the hazardous and toxic waste (Limbah B3)
                    specified in the Berita Acara listed above from{' '}
                    <span className="font-semibold text-slate-900">
                      {client?.name || 'the waste generator'}
                    </span>{' '}
                    has been collected, transported, and processed responsibly in
                    compliance with applicable Indonesian environmental laws and
                    Ministry of Environment and Forestry (KLHK) regulations.
                  </p>
                  <p>
                    All official electronic manifest (Festronik) documentation and
                    disposal records have been verified and archived for regulatory
                    audit purposes.
                    {note ? ` Note: ${note}` : ''}
                  </p>
                </div>
              </div>

              {/* Bottom Signature & Footer */}
              <div className="relative z-10 pt-8 space-y-6">
                <div className="flex items-end justify-between gap-4">
                  <div className="flex items-center gap-2.5">
                    <DocumentQrSvg value={displayId} />
                    <div className="text-[10px] text-slate-500">
                      <div>Issued Date:</div>
                      <div className="font-semibold text-slate-800">
                        {formatDateEnglish(datePeriod)}
                      </div>
                    </div>
                  </div>
                  <MccStampAndSignature
                    topLabel="Hormat Kami,"
                    bottomName="MARIA E W HADI"
                    bottomTitle="Direktur"
                    align="right"
                  />
                </div>

                <div className="pt-3 border-t border-slate-200 text-center text-[10px] text-slate-500 tracking-wide">
                  www.mediacahayacerah.com &nbsp;|&nbsp; cs@mediacahayacerah.com
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // =========================================================================
  // 2. BERITA ACARA PENGELOLAAN LIMBAH (Matches MCC-BA PDF)
  // =========================================================================
  if (entity === 'berita_acara') {
    const totalUnitSummary = summarizeQtyByUnit(attachedDataRows);
    return (
      <div className="limbahin-print-sheet mx-auto w-full max-w-[794px] bg-white shadow-sm border border-slate-200 px-8 sm:px-11 py-8 sm:py-10 min-h-[1040px] flex flex-col justify-between">
        <div>
          <LimbahinLetterhead documentId={displayId} />

          {/* Centered Title */}
          <div className="text-center pt-2 pb-5">
            <h2 className="font-display text-[17px] font-extrabold tracking-wide text-slate-900">
              BERITA ACARA PENGELOLAAN LIMBAH
            </h2>
            <div className="font-mono text-xs font-semibold text-slate-700 mt-1">
              {displayId}
            </div>
          </div>

          {/* 2-Column Client Info */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 text-[11px] pb-5">
            <div className="space-y-1">
              <div className="grid grid-cols-12 gap-1">
                <span className="col-span-4 font-bold text-slate-800">CUST ID</span>
                <span className="col-span-8 font-mono text-slate-700">
                  : {client?.id || '-'}
                </span>
              </div>
              <div className="grid grid-cols-12 gap-1">
                <span className="col-span-4 font-bold text-slate-800">CUST NAME</span>
                <span className="col-span-8 font-semibold text-slate-900">
                  : {client?.name || '-'}
                </span>
              </div>
              <div className="grid grid-cols-12 gap-1">
                <span className="col-span-4 font-bold text-slate-800">CUST TAX ID</span>
                <span className="col-span-8 font-mono text-slate-700">
                  : {client?.tax_id || '-'}
                </span>
              </div>
              <div className="grid grid-cols-12 gap-1">
                <span className="col-span-4 font-bold text-slate-800">CUST EMAIL</span>
                <span className="col-span-8 text-slate-700">
                  : {client?.email || '-'}
                </span>
              </div>
            </div>
            <div>
              <div className="font-bold text-slate-800 mb-0.5">ALAMAT</div>
              <div className="text-slate-700 leading-relaxed">
                {client?.address || '-'}
              </div>
            </div>
          </div>

          {/* Handover Declaration Paragraphs */}
          <div className="space-y-2.5 text-[11px] leading-[1.6] text-slate-700 text-justify pb-5">
            <p>
              Dengan ini menerangkan bahwa{' '}
              <span className="font-semibold text-slate-900">
                PT. Media Cahaya Cerah (LIMBAHIN)
              </span>{' '}
              telah melaksanakan pengangkutan dan serah terima pengelolaan Limbah
              Bahan Berbahaya dan Beracun (Limbah B3) dari penghasil limbah{' '}
              <span className="font-semibold text-slate-900">
                {client?.name || '-'}
              </span>{' '}
              (ID: <span className="font-mono">{client?.id || '-'}</span>) sesuai
              dengan rincian manifest elektronik (Festronik) pada tabel di bawah ini.
            </p>
            <p>
              Berita Acara ini diterbitkan sebagai bukti resmi pelaksanaan serah
              terima limbah B3 serta bahan pendukung pelaporan berkala pada sistem
              SIMPLE &amp; SPEED Kementerian Lingkungan Hidup dan Kehutanan (KLHK).
            </p>
          </div>

          {/* Teal-Header Table */}
          <table className="w-full text-[11px] border-collapse">
            <thead>
              <tr className="bg-[#239FB5] text-white">
                <th className="py-2 px-2.5 text-center font-semibold w-10 border border-[#1E8DA1]">
                  No
                </th>
                <th className="py-2 px-3 text-left font-semibold border border-[#1E8DA1]">
                  Item
                </th>
                <th className="py-2 px-3 text-right font-semibold w-28 border border-[#1E8DA1]">
                  Quantity
                </th>
                <th className="py-2 px-3 text-left font-semibold w-32 border border-[#1E8DA1]">
                  Unit
                </th>
              </tr>
            </thead>
            <tbody>
              {attachedDataRows.length === 0 ? (
                <tr>
                  <td
                    colSpan={4}
                    className="py-6 px-3 text-center text-slate-400 italic border border-slate-200"
                  >
                    Belum ada item Limbah Data (Pickup) terlampir.
                  </td>
                </tr>
              ) : (
                attachedDataRows.map((row, idx) => {
                  const item = itemMap.get(row.id_item_model || row.item_id || '');
                  return (
                    <tr
                      key={row.id}
                      className={idx % 2 === 1 ? 'bg-[#EDF8FA]' : 'bg-white'}
                    >
                      <td className="py-2 px-2.5 text-center font-mono border border-slate-200 align-top">
                        {idx + 1}
                      </td>
                      <td className="py-2 px-3 border border-slate-200 align-top">
                        <div className="font-semibold text-slate-900">
                          {item?.item_code ? `${item.item_code} - ` : ''}
                          {item?.title || row.data || row.id}
                        </div>
                        {item?.description && (
                          <div className="text-[10.5px] text-slate-600 mt-0.5">
                            {item.description}
                          </div>
                        )}
                        {row.final_item_note && (
                          <div className="text-[10px] text-slate-500 italic mt-0.5">
                            {row.final_item_note}
                          </div>
                        )}
                        {(row.manifest_number || row.data) && (
                          <div className="text-[10px] font-mono text-slate-500 mt-0.5">
                            {[
                              row.data ? `Tgl: ${row.data}` : '',
                              row.manifest_number ? `Manifest: ${row.manifest_number}` : '',
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </div>
                        )}
                      </td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums border border-slate-200 align-top">
                        {formatNumberPlain(row.quantity ?? row.weight_kg ?? 0)}
                      </td>
                      <td className="py-2 px-3 border border-slate-200 align-top">
                        {row.unit || 'Kg'}
                      </td>
                    </tr>
                  );
                })
              )}
              <tr className="bg-[#D9F1F5] font-bold text-slate-900">
                <td
                  colSpan={2}
                  className="py-2 px-3 text-right border border-slate-300"
                >
                  TOTAL
                </td>
                <td
                  colSpan={2}
                  className="py-2 px-3 text-right font-mono tabular-nums border border-slate-300"
                >
                  {totalUnitSummary}
                </td>
              </tr>
            </tbody>
          </table>

          {/* Catatan */}
          <div className="mt-4 text-[11px] text-slate-700">
            <span className="font-bold text-slate-900">Catatan:</span>{' '}
            <span>{note?.trim() || '-'}</span>
          </div>
        </div>

        {/* Bottom Pelaksana Signature */}
        <div className="pt-8 flex items-end justify-between">
          <div className="text-[10px] text-slate-400">
            {status ? `Status Dokumen: ${status}` : ''}
          </div>
          <MccStampAndSignature
            topLabel="Pelaksana,"
            dateLine={`Tanggal ${formatDateIndonesian(datePeriod)}`}
            align="right"
          />
        </div>
      </div>
    );
  }

  // =========================================================================
  // 3. FPL REAL & FPL DOC (Matching LIMBAHIN letterhead + FPL column spec)
  // =========================================================================
  if (entity === 'fpl_real' || entity === 'fpl_doc') {
    const docHeading =
      entity === 'fpl_real' ? 'FPL REAL STATEMENT' : 'FPL DOCUMENT STATEMENT';
    return (
      <div className="limbahin-print-sheet mx-auto w-full max-w-[794px] bg-white shadow-sm border border-slate-200 px-7 sm:px-10 py-8 sm:py-9 min-h-[1040px] flex flex-col justify-between">
        <div>
          <LimbahinLetterhead documentId={displayId} />

          <div className="pb-4">
            <h2 className="font-display text-[17px] font-extrabold tracking-wide text-slate-900">
              {docHeading}
            </h2>
            <div className="font-mono text-xs font-semibold text-slate-700 mt-0.5">
              {displayId}
            </div>
          </div>

          {/* 2-Column Client Info */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 text-[11px] pb-5">
            <div className="space-y-1">
              <div className="grid grid-cols-12 gap-1">
                <span className="col-span-4 font-bold text-slate-800">CUST ID</span>
                <span className="col-span-8 font-mono text-slate-700">
                  : {client?.id || '-'}
                </span>
              </div>
              <div className="grid grid-cols-12 gap-1">
                <span className="col-span-4 font-bold text-slate-800">CUST NAME</span>
                <span className="col-span-8 font-semibold text-slate-900">
                  : {client?.name || '-'}
                </span>
              </div>
              <div className="grid grid-cols-12 gap-1">
                <span className="col-span-4 font-bold text-slate-800">CUST TAX ID</span>
                <span className="col-span-8 font-mono text-slate-700">
                  : {client?.tax_id || '-'}
                </span>
              </div>
            </div>
            <div className="space-y-1">
              <div className="font-bold text-slate-800">CUST DOC ADDRESS</div>
              <div className="text-slate-700">{client?.address || '-'}</div>
              <div className="pt-1">
                <span className="font-bold text-slate-800">DATE: </span>
                <span>{formatDateEnglish(datePeriod)}</span>
              </div>
            </div>
          </div>

          {/* Teal-Header FPL Table */}
          <table className="w-full text-[10px] border-collapse">
            <thead>
              <tr className="bg-[#239FB5] text-white">
                <th className="py-2 px-1.5 text-center border border-[#1E8DA1]">No</th>
                <th className="py-2 px-2 text-left border border-[#1E8DA1]">Manifest</th>
                <th className="py-2 px-2 text-left border border-[#1E8DA1]">Klien</th>
                <th className="py-2 px-2 text-left border border-[#1E8DA1]">Nama Item</th>
                <th className="py-2 px-2 text-left border border-[#1E8DA1]">Kemasan</th>
                <th className="py-2 px-2 text-left border border-[#1E8DA1]">Kode</th>
                <th className="py-2 px-1.5 text-right border border-[#1E8DA1]">Qty</th>
                <th className="py-2 px-1.5 text-left border border-[#1E8DA1]">Unit</th>
                <th className="py-2 px-2 text-right border border-[#1E8DA1]">Harga FPL</th>
                <th className="py-2 px-2 text-right border border-[#1E8DA1]">Jumlah</th>
              </tr>
            </thead>
            <tbody>
              {attachedDataRows.length === 0 ? (
                <tr>
                  <td
                    colSpan={10}
                    className="py-6 px-3 text-center text-slate-400 italic border border-slate-200"
                  >
                    No pickup rows attached.
                  </td>
                </tr>
              ) : (
                attachedDataRows.map((row, idx) => {
                  const item = itemMap.get(row.id_item_model || row.item_id || '');
                  const rowCust = customerMap.get(row.id_user_model || row.client_id || '');
                  const qty = Number(row.quantity ?? row.weight_kg ?? 0);
                  const fplPrice = Number(row.fpl_price ?? 0);
                  const lineTotal = qty * fplPrice;
                  return (
                    <tr
                      key={row.id}
                      className={idx % 2 === 1 ? 'bg-[#EDF8FA]' : 'bg-white'}
                    >
                      <td className="py-1.5 px-1.5 text-center font-mono border border-slate-200">
                        {idx + 1}
                      </td>
                      <td className="py-1.5 px-2 font-mono border border-slate-200">
                        {row.manifest_number || '-'}
                      </td>
                      <td className="py-1.5 px-2 border border-slate-200">
                        {rowCust?.name || client?.name || '-'}
                      </td>
                      <td className="py-1.5 px-2 font-medium text-slate-900 border border-slate-200">
                        {item?.title || row.data || row.id}
                      </td>
                      <td className="py-1.5 px-2 border border-slate-200">
                        {row.kemasan || item?.kemasan || item?.description || '-'}
                      </td>
                      <td className="py-1.5 px-2 font-mono border border-slate-200">
                        {item?.item_code || '-'}
                      </td>
                      <td className="py-1.5 px-1.5 text-right font-mono tabular-nums border border-slate-200">
                        {formatNumberPlain(qty)}
                      </td>
                      <td className="py-1.5 px-1.5 border border-slate-200">
                        {row.unit || 'Kg'}
                      </td>
                      <td className="py-1.5 px-2 text-right font-mono tabular-nums border border-slate-200">
                        {formatIDR(fplPrice)}
                      </td>
                      <td className="py-1.5 px-2 text-right font-mono font-semibold tabular-nums border border-slate-200">
                        {formatIDR(lineTotal)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>

          {/* Borderless Summary & Adjustments */}
          <div className="mt-5 flex flex-col sm:flex-row justify-between gap-6">
            <div className="text-[11px] text-slate-700 max-w-sm">
              {note && (
                <div>
                  <span className="font-bold text-slate-900">Note: </span>
                  {note}
                </div>
              )}
            </div>
            <table className="w-full sm:w-72 text-[11px] border-collapse">
              <tbody>
                <tr>
                  <td className="py-1 pr-4 text-slate-700">Subtotal</td>
                  <td className="py-1 text-right font-mono tabular-nums text-slate-900">
                    {formatIDR(subtotal)}
                  </td>
                </tr>
                {adjustments.map((adj) => (
                  <tr key={adj.id}>
                    <td className="py-1 pr-4 text-slate-600">
                      {adj.label || 'Adjustment'}
                      {adj.type === 'percent' ? ` (${adj.value}%)` : ''}
                    </td>
                    <td className="py-1 text-right font-mono tabular-nums text-slate-800">
                      {formatIDR(adj.amount)}
                    </td>
                  </tr>
                ))}
                <tr className="font-bold text-slate-900 text-[12px]">
                  <td className="pt-2 pr-4">Grand Total</td>
                  <td className="pt-2 text-right font-mono tabular-nums text-[#1E96AC]">
                    {formatIDR(grandTotal)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="pt-8 flex items-end justify-between">
          <div className="text-[10px] text-slate-400">
            {status ? `Status Dokumen: ${status}` : ''}
          </div>
          <MccStampAndSignature
            topLabel="Hormat Kami,"
            dateLine={`Date: ${formatDateEnglish(datePeriod)}`}
            align="right"
          />
        </div>
      </div>
    );
  }

  // =========================================================================
  // 4. SALES INVOICE & PURCHASE ORDER (Matches MCC-INV PDF)
  // =========================================================================
  const isPo = entity === 'purchase_orders';
  return (
    <div className="limbahin-print-sheet mx-auto w-full max-w-[794px] bg-white shadow-sm border border-slate-200 px-8 sm:px-11 py-8 sm:py-10 min-h-[1040px] flex flex-col justify-between">
      <div>
        <LimbahinLetterhead documentId={displayId} />

        {/* Document Heading */}
        <div className="pb-4">
          <h2 className="font-display text-[18px] font-extrabold tracking-wide text-slate-900">
            {isPo ? 'PURCHASE ORDER' : 'SALES INVOICE'}
          </h2>
          <div className="flex flex-wrap items-center gap-x-3 text-xs mt-0.5">
            <span className="font-mono font-semibold text-slate-800">
              {displayId}
            </span>
            {isPo && poNumber && poNumber !== displayId && (
              <span className="font-mono text-slate-600">
                (Client PO: {poNumber})
              </span>
            )}
            {!isPo && jenisInvoice && (
              <span className="text-[#1E96AC] font-semibold">
                · {jenisInvoice}
              </span>
            )}
          </div>
        </div>

        {/* 2-Column Client Info */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 text-[11px] pb-5">
          <div className="space-y-1">
            <div className="grid grid-cols-12 gap-1">
              <span className="col-span-4 font-bold text-slate-800">CUST ID</span>
              <span className="col-span-8 font-mono text-slate-700">
                : {client?.id || '-'}
              </span>
            </div>
            <div className="grid grid-cols-12 gap-1">
              <span className="col-span-4 font-bold text-slate-800">CUST NAME</span>
              <span className="col-span-8 font-semibold text-slate-900">
                : {client?.name || '-'}
              </span>
            </div>
            <div className="grid grid-cols-12 gap-1">
              <span className="col-span-4 font-bold text-slate-800">CUST TAX ID</span>
              <span className="col-span-8 font-mono text-slate-700">
                : {client?.tax_id || '-'}
              </span>
            </div>
            <div className="grid grid-cols-12 gap-1">
              <span className="col-span-4 font-bold text-slate-800">CUST EMAIL</span>
              <span className="col-span-8 text-slate-700">
                : {client?.email || '-'}
              </span>
            </div>
          </div>
          <div className="space-y-2">
            <div>
              <div className="font-bold text-slate-800">CUST DOC ADDRESS</div>
              <div className="text-slate-700 leading-relaxed mt-0.5">
                {client?.address || '-'}
              </div>
            </div>
            <div>
              <span className="font-bold text-slate-800">DATE</span>
              <span className="text-slate-700 ml-2">
                : {formatDateEnglish(datePeriod)}
              </span>
            </div>
          </div>
        </div>

        {/* Teal-Header Invoice / PO Table */}
        <table className="w-full text-[11px] border-collapse">
          <thead>
            <tr className="bg-[#239FB5] text-white">
              <th className="py-2 px-2 text-center font-semibold w-9 border border-[#1E8DA1]">
                No
              </th>
              <th className="py-2 px-3 text-left font-semibold border border-[#1E8DA1]">
                Item
              </th>
              <th className="py-2 px-2.5 text-left font-semibold w-24 border border-[#1E8DA1]">
                Unit
              </th>
              <th className="py-2 px-2.5 text-right font-semibold w-20 border border-[#1E8DA1]">
                Quantity
              </th>
              <th className="py-2 px-2.5 text-right font-semibold w-28 border border-[#1E8DA1]">
                Price (IDR)
              </th>
              <th className="py-2 px-2.5 text-right font-semibold w-32 border border-[#1E8DA1]">
                Sub Total (IDR)
              </th>
            </tr>
          </thead>
          <tbody>
            {attachedDataRows.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="py-6 px-3 text-center text-slate-400 italic border border-slate-200"
                >
                  No item rows attached.
                </td>
              </tr>
            ) : (
              attachedDataRows.map((row, idx) => {
                const item = itemMap.get(row.id_item_model || row.item_id || '');
                const qty = Number(row.quantity ?? row.weight_kg ?? 0);
                const price = Number(row.invoice_price ?? 0);
                const lineTotal = qty * price;
                return (
                  <tr
                    key={row.id}
                    className={idx % 2 === 1 ? 'bg-[#EDF8FA]' : 'bg-white'}
                  >
                    <td className="py-2 px-2 text-center font-mono border border-slate-200 align-top">
                      {idx + 1}
                    </td>
                    <td className="py-2 px-3 border border-slate-200 align-top">
                      <div className="font-semibold text-slate-900">
                        {item?.item_code ? `${item.item_code} - ` : ''}
                        {item?.title || row.data || row.id}
                      </div>
                      {item?.description && (
                        <div className="text-[10.5px] text-slate-600 mt-0.5">
                          {item.description}
                        </div>
                      )}
                      {row.final_item_note && (
                        <div className="text-[10px] text-slate-500 italic mt-0.5">
                          {row.final_item_note}
                        </div>
                      )}
                      {(row.data || row.manifest_number) && (
                        <div className="text-[10px] font-mono text-slate-500 mt-0.5">
                          {[row.data, row.manifest_number]
                            .filter(Boolean)
                            .join(' · ')}
                        </div>
                      )}
                    </td>
                    <td className="py-2 px-2.5 border border-slate-200 align-top">
                      {row.unit || 'Kg'}
                    </td>
                    <td className="py-2 px-2.5 text-right font-mono tabular-nums border border-slate-200 align-top">
                      {formatNumberPlain(qty)}
                    </td>
                    <td className="py-2 px-2.5 text-right font-mono tabular-nums border border-slate-200 align-top">
                      {formatIDR(price)}
                    </td>
                    <td className="py-2 px-2.5 text-right font-mono font-semibold tabular-nums border border-slate-200 align-top">
                      {formatIDR(lineTotal)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>

        {/* Footer Split: Payment Instructions (Left) + Borderless Totals (Right) */}
        <div className="mt-5 grid grid-cols-1 sm:grid-cols-12 gap-6 items-start">
          <div className="sm:col-span-7 text-[10.5px] leading-relaxed text-slate-700 space-y-2">
            {!isPo && (
              <div className="p-3 bg-[#F6FBFD] border border-[#CFEAF0] rounded">
                <div className="font-bold text-slate-900 text-[10.5px]">
                  PEMBAYARAN DAPAT DILAKUKAN MELALUI TRANSFER KE:
                </div>
                <div className="font-mono font-bold text-[#1E96AC] text-[12px] mt-0.5">
                  PT. MEDIA CAHAYA CERAH : 002-3060075 (BCA)
                </div>
                <div className="text-[10px] text-slate-600 mt-1">
                  MOHON MENCANTUMKAN NOMOR INVOICE PADA BERITA TRANSFER
                </div>
                <div className="text-[10px] font-mono text-slate-600">
                  CONTOH: {displayId}
                </div>
              </div>
            )}
            {note && (
              <div>
                <span className="font-bold text-slate-900">Catatan: </span>
                <span>{note}</span>
              </div>
            )}
          </div>

          {/* Borderless Adjustment & Grand Total Block */}
          <div className="sm:col-span-5">
            <table className="w-full text-[11px] border-collapse">
              <tbody>
                <tr>
                  <td className="py-1 pr-3 text-slate-700">Total</td>
                  <td className="py-1 text-right font-mono tabular-nums text-slate-900">
                    {formatIDR(subtotal)}
                  </td>
                </tr>
                {adjustments.map((adj) => (
                  <tr key={adj.id}>
                    <td className="py-1 pr-3 text-slate-600">
                      {adj.label || 'Adjustment'}
                      {adj.type === 'percent' ? ` (${adj.value}%)` : ''}
                    </td>
                    <td className="py-1 text-right font-mono tabular-nums text-slate-800">
                      {formatIDR(adj.amount)}
                    </td>
                  </tr>
                ))}
                <tr className="font-bold text-slate-900 text-[12px]">
                  <td className="pt-2 pr-3">Grand Total</td>
                  <td className="pt-2 text-right font-mono tabular-nums">
                    {formatIDR(grandTotal)}
                  </td>
                </tr>
                {!isPo && roundedTotal !== grandTotal && (
                  <tr className="font-semibold text-[#1E96AC] text-[11.5px]">
                    <td className="pt-1 pr-3">Rounded</td>
                    <td className="pt-1 text-right font-mono tabular-nums">
                      {formatIDR(roundedTotal)}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Bottom Signature Block */}
      <div className="pt-8 flex items-end justify-between">
        <div className="text-[10px] text-slate-400">
          {status ? `Status Dokumen: ${status}` : ''}
        </div>
        <MccStampAndSignature
          topLabel="Hormat Kami,"
          dateLine={`Date: ${formatDateEnglish(datePeriod)}`}
          align="right"
        />
      </div>
    </div>
  );
}
