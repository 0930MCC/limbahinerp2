export interface SelectOption {
  value: string;
  label: string;
}

export const JENIS_PELAYANAN_OPTIONS: SelectOption[] = [
  { value: 'LB3 Tahunan', label: 'LB3 Tahunan' },
  { value: 'LB3 Bulanan', label: 'LB3 Bulanan' },
  { value: 'LB3 Rutin', label: 'LB3 Rutin' },
  { value: 'LB3 SPK', label: 'LB3 SPK' },
  { value: 'LB3 Biaya MOU', label: 'LB3 Biaya MOU' },
  { value: 'LB3 MOU', label: 'LB3 MOU' },
];

export const JENIS_INVOICE_OPTIONS: SelectOption[] = [
  { value: 'LB3 Tahunan', label: 'LB3 Tahunan' },
  { value: 'LB3 Bulanan', label: 'LB3 Bulanan' },
  { value: 'LB3 Rutin', label: 'LB3 Rutin' },
  { value: 'LB3 SPK', label: 'LB3 SPK' },
  { value: 'LB3 Biaya MOU', label: 'LB3 Biaya MOU' },
  { value: 'LB3 MOU', label: 'LB3 MOU' },
];

/**
 * Status Dokumen — hanya Tersimpan, Cancel, dan Terubah yang dapat dilihat klien.
 */
export const STATUS_DOKUMEN_OPTIONS: SelectOption[] = [
  { value: 'Draft', label: 'Draft' },
  { value: 'Tersimpan', label: 'Tersimpan (Client Visible)' },
  { value: 'Terubah', label: 'Terubah (Client Visible)' },
  { value: 'Cancel', label: 'Cancel (Client Visible)' },
  { value: 'Sedang Diubah', label: 'Sedang Diubah' },
  { value: 'Dihapus', label: 'Dihapus' },
];

export const INVOICE_STATUS_OPTIONS: SelectOption[] = [
  { value: 'Draft', label: 'Draft' },
  { value: 'Tersimpan', label: 'Tersimpan (Client Visible)' },
  { value: 'Terubah', label: 'Terubah (Client Visible)' },
  { value: 'Cancel', label: 'Cancel (Client Visible)' },
  { value: 'Sedang Diubah', label: 'Sedang Diubah' },
  { value: 'Dihapus', label: 'Dihapus' },
  { value: 'unpaid', label: 'Unpaid' },
  { value: 'partial', label: 'Partial' },
  { value: 'paid', label: 'Paid' },
  { value: 'overdue', label: 'Overdue' },
];

export const CLIENT_VISIBLE_DOC_STATUSES = new Set<string>([
  'Tersimpan',
  'Cancel',
  'Terubah',
]);

export const UNIT_OPTIONS: SelectOption[] = [
  { value: 'Kg', label: 'Kg' },
  { value: 'Ltr', label: 'Ltr' },
  { value: 'Drum (Uk. 200 Ltr)', label: 'Drum (Uk. 200 Ltr)' },
  { value: 'IBC Tank (Uk. 1000 Ltr)', label: 'IBC Tank (Uk. 1000 Ltr)' },
  { value: 'Unit', label: 'Unit' },
  { value: 'Bulan', label: 'Bulan' },
  { value: 'Ritase', label: 'Ritase' },
  { value: 'Tahun', label: 'Tahun' },
  { value: 'Hari', label: 'Hari' },
  { value: 'Ton', label: 'Ton' },
];

export const KEMASAN_OPTIONS: SelectOption[] = [
  { value: 'Plastik', label: 'Plastik' },
  { value: 'Drum (Uk. 200 Ltr)', label: 'Drum (Uk. 200 Ltr)' },
  { value: 'IBC Tank (Uk. 1000 Ltr)', label: 'IBC Tank (Uk. 1000 Ltr)' },
  { value: 'Jumbo Bag', label: 'Jumbo Bag' },
  { value: 'Kosong', label: 'Kosong' },
  { value: 'Karung', label: 'Karung' },
];

export const ACCOUNT_TYPE_OPTIONS: SelectOption[] = [
  { value: 'System', label: 'System' },
  { value: 'BCA-MCC1', label: 'BCA-MCC1' },
  { value: 'Adjustment', label: 'Adjustment' },
  { value: 'Manual', label: 'Manual' },
  { value: 'Opening Balance', label: 'Opening Balance' },
];

export const STATUS_JADWAL_OPTIONS: SelectOption[] = [
  { value: 'Upcoming', label: 'Upcoming' },
  { value: 'Minggu ini', label: 'Minggu ini' },
  { value: 'Hari ini', label: 'Hari ini' },
  { value: 'Reschedule', label: 'Reschedule' },
];

export const REQUEST_TYPE_OPTIONS: SelectOption[] = [
  { value: 'Jadwal', label: 'Jadwal' },
  { value: 'File & Dokumen', label: 'File & Dokumen' },
  { value: 'Gambar & Video', label: 'Gambar & Video' },
  { value: 'Perpanjangan', label: 'Perpanjangan' },
  { value: 'Fasilitas', label: 'Fasilitas' },
  { value: 'Lainnya', label: 'Lainnya' },
];

export const DATA_TYPE_OPTIONS: SelectOption[] = [
  { value: 'LB3 Pickup', label: 'LB3 Pickup' },
  { value: 'LB3 Pickup Details', label: 'LB3 Pickup Details' },
  { value: 'LB3 Data', label: 'LB3 Data' },
  { value: 'Logistik', label: 'Logistik' },
];

export const ROLE_OPTIONS: SelectOption[] = [
  { value: 'admin', label: 'Admin' },
  { value: 'master', label: 'Master' },
  { value: 'marketing', label: 'Marketing' },
  { value: 'worker', label: 'Worker' },
];

export const JENIS_MANIFEST_OPTIONS: SelectOption[] = [
  { value: 'Manual', label: 'Manual' },
  { value: 'Festronik', label: 'Festronik' },
  {
    value: 'Festronik diisi oleh LIMBAHIN',
    label: 'Festronik diisi oleh LIMBAHIN',
  },
];

export const RCRD_SOURCE_TYPE_OPTIONS: SelectOption[] = [
  { value: 'MANUAL', label: 'MANUAL' },
  { value: 'BCA1', label: 'BCA1' },
  { value: 'SYSTEM', label: 'SYSTEM' },
  { value: 'ADJUSTMENT', label: 'ADJUSTMENT' },
];

export type CanonicalRcrdSourceType = 'MANUAL' | 'BCA1' | 'SYSTEM' | 'ADJUSTMENT';

export function normalizeRcrdSourceType(
  raw?: string | null
): CanonicalRcrdSourceType {
  const upper = String(raw || '')
    .trim()
    .toUpperCase();
  if (upper === 'SYSTEM' || upper === 'SYSTEM_AUTO') return 'SYSTEM';
  if (upper === 'BCA1' || upper === 'BCA-MCC1' || upper === 'CSV_IMPORT') return 'BCA1';
  if (upper === 'ADJUSTMENT' || upper === 'REVERSAL') return 'ADJUSTMENT';
  return 'MANUAL';
}

export const REFERENCE_MODEL_OPTIONS: SelectOption[] = [
  { value: '', label: 'None (No Reference)' },
  { value: 'invoice', label: 'Invoice (INV)' },
  { value: 'commission', label: 'Commission (COM)' },
  { value: 'payroll', label: 'Payroll' },
  { value: 'expense', label: 'Expense' },
  { value: 'berita_acara', label: 'Berita Acara (BA)' },
  { value: 'purchase_order', label: 'Purchase Order (PO)' },
  { value: 'fpl_real', label: 'FPL Real' },
  { value: 'fpl_doc', label: 'FPL Doc' },
];

export const VALID_DATA_TYPE_VALUES = new Set<string>([
  'LB3 Pickup',
  'LB3 Pickup Details',
  'LB3 Data',
  'Logistik',
  // Legacy values retained for backward compatibility
  'pickup',
  'service',
  'transport',
  'admin',
  'other',
]);

/**
 * Checks whether a Limbah Data row qualifies as a pickup-type row
 * (eligible for Berita Acara, FPL Real, and FPL Doc).
 */
export function isPickupDataType(dataType?: string | null): boolean {
  const normalized = String(dataType || 'LB3 Pickup')
    .trim()
    .toLowerCase();
  return (
    normalized === 'lb3 pickup' ||
    normalized === 'lb3 pickup details' ||
    normalized === 'pickup'
  );
}

/**
 * Checks whether a document status represents a canceled/deleted state.
 */
export function isCanceledStatus(status?: string | null): boolean {
  const normalized = String(status || '')
    .trim()
    .toLowerCase();
  return (
    normalized === 'cancel' ||
    normalized === 'canceled' ||
    normalized === 'cancelled' ||
    normalized === 'dihapus'
  );
}
