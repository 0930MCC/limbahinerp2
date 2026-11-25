import type { DocumentEntityKey, EntityKey, WorkerRole } from './types.ts';
import {
  DATA_TYPE_OPTIONS,
  INVOICE_STATUS_OPTIONS,
  JENIS_INVOICE_OPTIONS,
  JENIS_MANIFEST_OPTIONS,
  JENIS_PELAYANAN_OPTIONS,
  KEMASAN_OPTIONS,
  ROLE_OPTIONS,
  STATUS_DOKUMEN_OPTIONS,
  STATUS_JADWAL_OPTIONS,
  UNIT_OPTIONS,
} from './appOptions.ts';

export type FieldType =
  | 'text'
  | 'password'
  | 'email'
  | 'phone'
  | 'url'
  | 'url-list'
  | 'number'
  | 'currency'
  | 'date'
  | 'select'
  | 'textarea'
  | 'ref'
  | 'ref-list'
  | 'json';

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  optional?: boolean;
  placeholder?: string;
  options?: Array<{ value: string; label: string }>;
  refEntity?: EntityKey;
  showInTable?: boolean;
  align?: 'left' | 'right';
  hideOnEdit?: boolean;
}

export interface EntityMeta {
  key: EntityKey;
  singular: string;
  plural: string;
  prefix: string;
  routePath: string;
  description: string;
  fields: FieldDef[];
  statusField?: string;
}

export const DOCUMENT_ENTITIES: ReadonlySet<DocumentEntityKey> = new Set([
  'purchase_orders',
  'berita_acara',
  'invoices',
  'certificates',
  'fpl_real',
  'fpl_doc',
]);

export function isDocumentEntity(entity: EntityKey): entity is DocumentEntityKey {
  return DOCUMENT_ENTITIES.has(entity as DocumentEntityKey);
}

export const ENTITY_META: Record<EntityKey, EntityMeta> = {
  workers: {
    key: 'workers',
    singular: 'Worker',
    plural: 'Workers',
    prefix: 'MCC',
    routePath: '/b3/workers',
    description:
      'Internal office staff, marketing team, admins, and field workers authenticated via Supabase Auth. Accounts with a real email require confirmation; workers without an email use an internal auth handle.',
    statusField: 'status',
    fields: [
      {
        key: 'name',
        label: 'Name / Entity',
        type: 'text',
        required: true,
        placeholder: 'PT. Limbahin Utama or Budi Santoso',
        showInTable: true,
      },
      {
        key: 'username',
        label: 'Username',
        type: 'text',
        required: true,
        placeholder: 'budi.ops',
        showInTable: true,
      },
      {
        key: 'password',
        label: 'Password',
        type: 'password',
        required: true,
        placeholder: 'Minimum 6 characters',
      },
      {
        key: 'role',
        label: 'Role',
        type: 'select',
        required: true,
        showInTable: true,
        options: ROLE_OPTIONS,
      },
      {
        key: 'status',
        label: 'Status',
        type: 'select',
        required: true,
        showInTable: true,
        options: [
          { value: 'active', label: 'Active' },
          { value: 'inactive', label: 'Inactive' },
        ],
      },
      {
        key: 'email',
        label: 'Email',
        type: 'email',
        optional: true,
        placeholder:
          'Optional for marketing/admin/worker (if set, must confirm email)',
        showInTable: true,
      },
      {
        key: 'phone',
        label: 'Phone',
        type: 'phone',
        optional: true,
        placeholder: '+62 812-3456-7890',
        showInTable: true,
      },
      {
        key: 'display_picture_url',
        label: 'Display Picture',
        type: 'url',
        optional: true,
        placeholder: 'Upload image (PNG, JPG, WEBP, GIF)',
      },
    ],
  },
  customers: {
    key: 'customers',
    singular: 'Client',
    plural: 'Clients',
    prefix: 'USR',
    routePath: '/b3/clients',
    description:
      'Client parent accounts (USR) with portal credentials (name, username, password, email).',
    fields: [
      {
        key: 'name',
        label: 'Client Name',
        type: 'text',
        required: true,
        placeholder: 'PT. ABC',
        showInTable: true,
      },
      {
        key: 'username',
        label: 'Username',
        type: 'text',
        required: true,
        placeholder: 'pt.abc',
        showInTable: true,
      },
      {
        key: 'password',
        label: 'Password',
        type: 'password',
        required: true,
        placeholder: 'Min 6 characters',
      },
      {
        key: 'email',
        label: 'Email',
        type: 'email',
        required: true,
        placeholder: 'finance@ptabc.co.id',
        showInTable: true,
      },
    ],
  },
  branches: {
    key: 'branches',
    singular: 'Limbahin Branch',
    plural: 'Branches',
    prefix: 'CUST',
    routePath: '/b3/branches',
    description:
      'Client branches / facilities (CUST) with document display name, optional NPWP for VAT/Faktur Pajak, addresses, and Operational/Finance PICs.',
    fields: [
      {
        key: 'id_client',
        label: 'Client (USR)',
        type: 'ref',
        refEntity: 'customers',
        required: true,
        showInTable: true,
      },
      {
        key: 'branch_name',
        label: 'Branch Name',
        type: 'text',
        required: true,
        placeholder: 'Klinik A',
        showInTable: true,
      },
      {
        key: 'name_in_document',
        label: 'Name in Document',
        type: 'text',
        required: true,
        placeholder: 'PT. ABC - Klinik A',
        showInTable: true,
      },
      {
        key: 'npwp',
        label: 'NPWP (for Faktur Pajak / VAT)',
        type: 'text',
        optional: true,
        placeholder: 'Optional — leave blank if no Faktur Pajak',
        showInTable: true,
      },
      {
        key: 'id_alamat_address_document',
        label: 'Document Recipient Address',
        type: 'textarea',
        optional: true,
        placeholder: 'Jl. HR Rasuna Said Kav. B-14, Jakarta Selatan',
        showInTable: true,
      },
      {
        key: 'id_alamat_address_limbah',
        label: 'Limbah Pickup Address',
        type: 'textarea',
        optional: true,
        placeholder: 'Same as document address or specify pickup site address',
      },
      {
        key: 'penanggung_jawab_utama_nama',
        label: 'Penanggung Jawab Utama (Nama)',
        type: 'text',
        optional: true,
        placeholder: 'dr. Ratna Dewi',
        showInTable: true,
      },
      {
        key: 'penanggung_jawab_utama_jabatan',
        label: 'Penanggung Jawab Utama (Jabatan)',
        type: 'text',
        optional: true,
        placeholder: 'Direktur Operasional',
      },
      {
        key: 'pic_operasional_nama',
        label: 'PIC Operasional (Nama)',
        type: 'text',
        optional: true,
        placeholder: 'Ns. Siska Rahmawati',
        showInTable: true,
      },
      {
        key: 'pic_operasional_telfonwa',
        label: 'PIC Operasional (Telp / WA)',
        type: 'phone',
        optional: true,
        placeholder: '+62 812-1190-2210',
      },
      {
        key: 'pic_keuangan_nama',
        label: 'PIC Keuangan (Nama)',
        type: 'text',
        optional: true,
        placeholder: 'Rini Kusuma',
      },
      {
        key: 'pic_keuangan_telfonwa',
        label: 'PIC Keuangan (Telp / WA)',
        type: 'phone',
        optional: true,
        placeholder: '+62 813-9000-1122',
      },
    ],
  },
  requests: {
    key: 'requests',
    singular: 'Request',
    plural: 'Requests',
    prefix: 'REQ',
    routePath: '/b3/requests',
    description:
      'Client and internal operational requests (REQ) tracked with worker solutions.',
    fields: [
      {
        key: 'request_type',
        label: 'Request Type',
        type: 'select',
        required: true,
        showInTable: true,
        options: REQUEST_TYPE_OPTIONS,
      },
      {
        key: 'id_user',
        label: 'Client (USR)',
        type: 'ref',
        refEntity: 'customers',
        required: true,
        showInTable: true,
      },
      {
        key: 'id_creator',
        label: 'Creator (User or Worker ID)',
        type: 'text',
        required: true,
        placeholder: 'USR-XXXXX or MCC-1001',
        showInTable: true,
      },
      {
        key: 'catatan',
        label: 'Catatan',
        type: 'textarea',
        required: true,
        placeholder: 'Describe the client request or operational issue...',
        showInTable: true,
      },
      {
        key: 'solution',
        label: 'Solution (Filled by Worker)',
        type: 'textarea',
        optional: true,
        placeholder: 'Resolution notes filled by worker...',
        showInTable: true,
      },
    ],
  },
  items: {
    key: 'items',
    singular: 'Item',
    plural: 'Items',
    prefix: 'ITM',
    routePath: '/b3/items',
    description:
      'Master waste & service items (ITM) used in Limbah Data records and documents. Supports helper item notes and multi-image ZIP uploads (-1, -2, -3).',
    fields: [
      {
        key: 'item_code',
        label: 'Item Code',
        type: 'text',
        required: true,
        placeholder: 'A337-1',
        showInTable: true,
      },
      {
        key: 'title',
        label: 'Title / Nama Item',
        type: 'text',
        required: true,
        placeholder: 'Limbah Klinis Infeksius',
        showInTable: true,
      },
      {
        key: 'description',
        label: 'Description',
        type: 'textarea',
        optional: true,
        placeholder: 'Kemasan Drum 200L / Yellow Biohazard Wheelie Bin',
        showInTable: true,
      },
      {
        key: 'kemasan',
        label: 'Kemasan',
        type: 'select',
        optional: true,
        showInTable: true,
        options: KEMASAN_OPTIONS,
      },
      {
        key: 'unit',
        label: 'Default Unit',
        type: 'select',
        optional: true,
        showInTable: true,
        options: UNIT_OPTIONS,
      },
      {
        key: 'item_note',
        label: 'Item Note (Helper Template)',
        type: 'textarea',
        optional: true,
        placeholder:
          'Format helper auto-filled into Limbah Data final_item_note (editable or removable per entry)',
        showInTable: true,
      },
      {
        key: 'list_url_image',
        label: 'Item Images (list_url_image)',
        type: 'url-list',
        optional: true,
        placeholder: 'A337-1 (matches A337-1-1.jpg, A337-1-2.jpg, A337-1-3.jpg in ZIP)',
        showInTable: true,
      },
    ],
  },
  schedules: {
    key: 'schedules',
    singular: 'Schedule Item',
    plural: 'Schedules',
    prefix: 'LMBHN-SCHD-ITEM',
    routePath: '/b3/operational/schedule',
    description:
      'Route stop schedule items (LMBHN-SCHD-ITEM) linking vehicle number, destination branch, sequence order, and reschedule chain.',
    statusField: 'status',
    fields: [
      {
        key: 'vehicle_number',
        label: 'Vehicle Number',
        type: 'text',
        required: true,
        placeholder: 'B 9412 TYX',
        showInTable: true,
      },
      {
        key: 'id_branch',
        label: 'Destination Branch',
        type: 'ref',
        refEntity: 'branches',
        required: true,
        showInTable: true,
      },
      {
        key: 'order_index',
        label: 'Order Index',
        type: 'number',
        required: true,
        placeholder: '1',
        showInTable: true,
        align: 'right',
      },
      {
        key: 'scheduled_date',
        label: 'Schedule Date',
        type: 'date',
        optional: true,
        showInTable: true,
      },
      {
        key: 'status',
        label: 'Status Jadwal',
        type: 'select',
        optional: true,
        showInTable: true,
        options: STATUS_JADWAL_OPTIONS,
      },
      {
        key: 'schedule_note',
        label: 'Schedule Note',
        type: 'textarea',
        optional: true,
        placeholder: 'Loading dock B opens 08:00 WIB. Bring Festronik printout.',
        showInTable: true,
      },
      {
        key: 'schedule_reschedule_problem',
        label: 'Reschedule Problem',
        type: 'textarea',
        optional: true,
        placeholder: 'Optional reason if route stop was rescheduled',
        showInTable: true,
      },
      {
        key: 'reschedule_id',
        label: 'Rescheduled To (Schedule ID)',
        type: 'ref',
        refEntity: 'schedules',
        optional: true,
        showInTable: true,
      },
    ],
  },
  pickup_data: {
    key: 'pickup_data',
    singular: 'Limbah Data',
    plural: 'Limbah Data',
    prefix: 'DATA',
    routePath: '/b3/operational/data',
    description:
      'Core Limbah Data records (DATA) referenced once inside BA, Invoice, FPL Real, and FPL Doc documents. Internal notes stay strictly inside ERP.',
    fields: [
      {
        key: 'data',
        label: 'Data / Date Label',
        type: 'text',
        required: true,
        placeholder: '2026-11-24 or Batch Pickup Label',
        showInTable: true,
      },
      {
        key: 'id_user_model',
        label: 'Client (id_user_model)',
        type: 'ref',
        refEntity: 'customers',
        required: true,
        showInTable: true,
      },
      {
        key: 'id_item_model',
        label: 'Item (id_item_model)',
        type: 'ref',
        refEntity: 'items',
        required: true,
        showInTable: true,
      },
      {
        key: 'data_type',
        label: 'Data Type',
        type: 'select',
        required: true,
        showInTable: true,
        options: DATA_TYPE_OPTIONS,
      },
      {
        key: 'jenis_pelayanan',
        label: 'Jenis Pelayanan',
        type: 'select',
        optional: true,
        showInTable: true,
        options: JENIS_PELAYANAN_OPTIONS,
      },
      {
        key: 'jenis_manifest',
        label: 'Jenis Manifest',
        type: 'select',
        optional: true,
        showInTable: true,
        options: JENIS_MANIFEST_OPTIONS,
      },
      {
        key: 'kemasan',
        label: 'Kemasan',
        type: 'select',
        optional: true,
        showInTable: true,
        options: KEMASAN_OPTIONS,
      },
      {
        key: 'reference_number',
        label: 'Reference Number',
        type: 'text',
        optional: true,
        placeholder: 'SJ / DO / PO Ref',
        showInTable: true,
      },
      {
        key: 'manifest_number',
        label: 'Manifest Number',
        type: 'text',
        optional: true,
        placeholder: 'FST-2026-08812',
        showInTable: true,
      },
      {
        key: 'quantity',
        label: 'Quantity',
        type: 'number',
        required: true,
        placeholder: '640',
        showInTable: true,
        align: 'right',
      },
      {
        key: 'unit',
        label: 'Unit',
        type: 'select',
        required: true,
        showInTable: true,
        options: UNIT_OPTIONS,
      },
      {
        key: 'invoice_price',
        label: 'Invoice Price (IDR)',
        type: 'currency',
        required: true,
        placeholder: '24500',
        showInTable: true,
        align: 'right',
      },
      {
        key: 'fpl_price',
        label: 'FPL Price (IDR)',
        type: 'currency',
        optional: true,
        placeholder: '16500',
        showInTable: true,
        align: 'right',
      },
      {
        key: 'final_item_note',
        label: 'Final Item Note (Shown in Docs)',
        type: 'textarea',
        optional: true,
        placeholder: 'Auto-filled from Item Note helper; appears in Invoice & BA',
      },
      {
        key: 'internal_note',
        label: 'Internal Note (ERP Only)',
        type: 'textarea',
        optional: true,
        placeholder: 'Internal remarks — never printed or shown on documents',
      },
      {
        key: 'ba_id',
        label: 'BA Ref (Once)',
        type: 'ref',
        refEntity: 'berita_acara',
        optional: true,
        showInTable: true,
      },
      {
        key: 'inv_id',
        label: 'Invoice Ref (Once)',
        type: 'ref',
        refEntity: 'invoices',
        optional: true,
        showInTable: true,
      },
      {
        key: 'fpl_real_id',
        label: 'FPL Real Ref (Once)',
        type: 'ref',
        refEntity: 'fpl_real',
        optional: true,
      },
      {
        key: 'fpl_doc_id',
        label: 'FPL Doc Ref (Once)',
        type: 'ref',
        refEntity: 'fpl_doc',
        optional: true,
      },
    ],
  },
  purchase_orders: {
    key: 'purchase_orders',
    singular: 'Purchase Order',
    plural: 'Purchase Orders',
    prefix: 'PO',
    routePath: '/b3/documents/purchase-order',
    description:
      'Client Purchase Orders authorizing Limbah B3 collection with full-screen item attachment table and adjustments.',
    statusField: 'status',
    fields: [
      {
        key: 'po_number',
        label: 'Client PO No.',
        type: 'text',
        required: true,
        placeholder: 'PO/GMN/XI/2026/014',
        showInTable: true,
      },
      {
        key: 'id_user_model',
        label: 'Client (id_user_model)',
        type: 'ref',
        refEntity: 'customers',
        required: true,
        showInTable: true,
      },
      {
        key: 'date_period',
        label: 'Date / Period',
        type: 'date',
        required: true,
        showInTable: true,
      },
      {
        key: 'note',
        label: 'Note',
        type: 'textarea',
        optional: true,
        placeholder: 'Authorization notes or scope terms',
        showInTable: true,
      },
      {
        key: 'subtotal_amount',
        label: 'Subtotal (IDR)',
        type: 'currency',
        optional: true,
        showInTable: true,
        align: 'right',
      },
      {
        key: 'total_amount',
        label: 'Total (IDR)',
        type: 'currency',
        required: true,
        placeholder: '14500000',
        showInTable: true,
        align: 'right',
      },
      {
        key: 'status',
        label: 'Status Dokumen',
        type: 'select',
        required: true,
        showInTable: true,
        options: STATUS_DOKUMEN_OPTIONS,
      },
    ],
  },
  berita_acara: {
    key: 'berita_acara',
    singular: 'Berita Acara',
    plural: 'Berita Acara (BA)',
    prefix: 'LMBHN-BA',
    routePath: '/b3/documents/ba',
    description:
      'Handover documentation (LMBHN-BA) showing pickup-type Limbah Data items (item code, description, final item note, quantity & unit) and optional certificate link.',
    statusField: 'status',
    fields: [
      {
        key: 'id_user_model',
        label: 'Client (id_user_model)',
        type: 'ref',
        refEntity: 'customers',
        required: true,
        showInTable: true,
      },
      {
        key: 'date_period',
        label: 'Date / Period',
        type: 'date',
        required: true,
        showInTable: true,
      },
      {
        key: 'id_certificate',
        label: 'Certificate Ref',
        type: 'ref',
        refEntity: 'certificates',
        optional: true,
        showInTable: true,
      },
      {
        key: 'note',
        label: 'Note',
        type: 'textarea',
        optional: true,
        placeholder: 'Handover remarks or witness names',
        showInTable: true,
      },
      {
        key: 'status',
        label: 'Status Dokumen',
        type: 'select',
        required: true,
        showInTable: true,
        options: STATUS_DOKUMEN_OPTIONS,
      },
    ],
  },
  invoices: {
    key: 'invoices',
    singular: 'Invoice',
    plural: 'Invoices',
    prefix: 'INV',
    routePath: '/b3/documents/invoice',
    description:
      'Billing invoices (INV) supporting all Limbah Data types, borderless VAT/adjustment lines, commission tracking, and automatic ledger posting.',
    statusField: 'status',
    fields: [
      {
        key: 'id_user_model',
        label: 'Client (id_user_model)',
        type: 'ref',
        refEntity: 'customers',
        required: true,
        showInTable: true,
      },
      {
        key: 'jenis_invoice',
        label: 'Jenis Invoice',
        type: 'select',
        optional: true,
        showInTable: true,
        options: JENIS_INVOICE_OPTIONS,
      },
      {
        key: 'date_period',
        label: 'Date / Period',
        type: 'date',
        required: true,
        showInTable: true,
      },
      {
        key: 'note',
        label: 'Note',
        type: 'textarea',
        optional: true,
        placeholder: 'Billing remarks or payment bank details',
        showInTable: true,
      },
      {
        key: 'subtotal_amount',
        label: 'Subtotal (IDR)',
        type: 'currency',
        optional: true,
        showInTable: true,
        align: 'right',
      },
      {
        key: 'total_amount',
        label: 'Total (IDR)',
        type: 'currency',
        required: true,
        placeholder: '11100000',
        showInTable: true,
        align: 'right',
      },
      {
        key: 'id_user_comission',
        label: 'Commission PIC',
        type: 'ref',
        refEntity: 'workers',
        optional: true,
        showInTable: true,
      },
      {
        key: 'comission_amount',
        label: 'Commission (IDR)',
        type: 'currency',
        optional: true,
        placeholder: '500000',
        showInTable: true,
        align: 'right',
      },
      {
        key: 'status',
        label: 'Status Dokumen',
        type: 'select',
        required: true,
        showInTable: true,
        options: INVOICE_STATUS_OPTIONS,
      },
    ],
  },
  certificates: {
    key: 'certificates',
    singular: 'Certificate',
    plural: 'Certificates',
    prefix: 'LMBHN-CERT',
    routePath: '/b3/documents/certificate',
    description:
      'Compliance certificates (LMBHN-CERT) referencing Berita Acara (BA) handover documents in their table.',
    statusField: 'status',
    fields: [
      {
        key: 'id_user_model',
        label: 'Client (id_user_model)',
        type: 'ref',
        refEntity: 'customers',
        required: true,
        showInTable: true,
      },
      {
        key: 'date_period',
        label: 'Date / Period',
        type: 'date',
        required: true,
        showInTable: true,
      },
      {
        key: 'note',
        label: 'Note',
        type: 'textarea',
        optional: true,
        placeholder: 'Destruction / treatment compliance note',
        showInTable: true,
      },
      {
        key: 'status',
        label: 'Status Dokumen',
        type: 'select',
        required: true,
        showInTable: true,
        options: STATUS_DOKUMEN_OPTIONS,
      },
    ],
  },
  fpl_real: {
    key: 'fpl_real',
    singular: 'FPL Real',
    plural: 'FPL Real',
    prefix: 'LMBHN-FPLREAL',
    routePath: '/b3/documents/fpl-real',
    description:
      'Actual FPL partner manifest billing (LMBHN-FPLREAL) using pickup-type Limbah Data with manifest, item packaging, FPL price, and borderless adjustments.',
    statusField: 'status',
    fields: [
      {
        key: 'id_user_model',
        label: 'Client (id_user_model)',
        type: 'ref',
        refEntity: 'customers',
        required: true,
        showInTable: true,
      },
      {
        key: 'date_period',
        label: 'Date / Period',
        type: 'date',
        required: true,
        showInTable: true,
      },
      {
        key: 'note',
        label: 'Note',
        type: 'textarea',
        optional: true,
        placeholder: 'FPL real processing remarks',
        showInTable: true,
      },
      {
        key: 'subtotal_amount',
        label: 'Subtotal (IDR)',
        type: 'currency',
        optional: true,
        showInTable: true,
        align: 'right',
      },
      {
        key: 'total_amount',
        label: 'Total (IDR)',
        type: 'currency',
        optional: true,
        showInTable: true,
        align: 'right',
      },
      {
        key: 'status',
        label: 'Status Dokumen',
        type: 'select',
        optional: true,
        showInTable: true,
        options: STATUS_DOKUMEN_OPTIONS,
      },
    ],
  },
  fpl_doc: {
    key: 'fpl_doc',
    singular: 'FPL Doc',
    plural: 'FPL Doc',
    prefix: 'LMBHN-FPLDOC',
    routePath: '/b3/documents/fpl-doc',
    description:
      'Documented FPL partner billing (LMBHN-FPLDOC) using pickup-type Limbah Data with manifest, item packaging, FPL price, and borderless adjustments.',
    statusField: 'status',
    fields: [
      {
        key: 'id_user_model',
        label: 'Client (id_user_model)',
        type: 'ref',
        refEntity: 'customers',
        required: true,
        showInTable: true,
      },
      {
        key: 'date_period',
        label: 'Date / Period',
        type: 'date',
        required: true,
        showInTable: true,
      },
      {
        key: 'note',
        label: 'Note',
        type: 'textarea',
        optional: true,
        placeholder: 'FPL document notes',
        showInTable: true,
      },
      {
        key: 'subtotal_amount',
        label: 'Subtotal (IDR)',
        type: 'currency',
        optional: true,
        showInTable: true,
        align: 'right',
      },
      {
        key: 'total_amount',
        label: 'Total (IDR)',
        type: 'currency',
        optional: true,
        showInTable: true,
        align: 'right',
      },
      {
        key: 'status',
        label: 'Status Dokumen',
        type: 'select',
        optional: true,
        showInTable: true,
        options: STATUS_DOKUMEN_OPTIONS,
      },
    ],
  },
  commissions: {
    key: 'commissions',
    singular: 'Commission',
    plural: 'Marketing Commissions',
    prefix: 'COM',
    routePath: '/b3/marketing',
    description:
      'Marketing sales commissions tied to client accounts and invoices.',
    statusField: 'status',
    fields: [
      {
        key: 'period',
        label: 'Period',
        type: 'text',
        required: true,
        placeholder: '2026-11',
        showInTable: true,
      },
      {
        key: 'marketing_id',
        label: 'Marketing PIC',
        type: 'ref',
        refEntity: 'workers',
        required: true,
        showInTable: true,
      },
      {
        key: 'client_id',
        label: 'Client',
        type: 'ref',
        refEntity: 'customers',
        required: true,
        showInTable: true,
      },
      {
        key: 'invoice_id',
        label: 'Invoice Ref',
        type: 'ref',
        refEntity: 'invoices',
        optional: true,
        showInTable: true,
      },
      {
        key: 'rate_percent',
        label: 'Rate (%)',
        type: 'number',
        required: true,
        placeholder: '5',
        showInTable: true,
        align: 'right',
      },
      {
        key: 'commission_amount',
        label: 'Commission (IDR)',
        type: 'currency',
        required: true,
        placeholder: '725000',
        showInTable: true,
        align: 'right',
      },
      {
        key: 'status',
        label: 'Status',
        type: 'select',
        required: true,
        showInTable: true,
        options: [
          { value: 'pending', label: 'Pending' },
          { value: 'approved', label: 'Approved' },
          { value: 'paid', label: 'Paid' },
        ],
      },
    ],
  },
  logs: {
    key: 'logs',
    singular: 'Audit Log',
    plural: 'Audit Logs',
    prefix: 'LOGS',
    routePath: '/b3/logs',
    description:
      'Immutable audit trail with previous-log chain references across all ERP models.',
    fields: [
      {
        key: 'id_previous_logs',
        label: 'Previous Log',
        type: 'ref',
        refEntity: 'logs',
        optional: true,
        showInTable: true,
      },
      {
        key: 'id_changed_by',
        label: 'Changed By',
        type: 'ref',
        refEntity: 'workers',
        optional: true,
        showInTable: true,
      },
      {
        key: 'model_name',
        label: 'Model',
        type: 'text',
        required: true,
        showInTable: true,
      },
      {
        key: 'timestamp_created_at',
        label: 'Timestamp',
        type: 'text',
        required: true,
        showInTable: true,
      },
      {
        key: 'changes_json',
        label: 'Changes',
        type: 'json',
        required: true,
        showInTable: true,
      },
    ],
  },
};

export function getEntityUrlFields(entity: EntityKey): FieldDef[] {
  return ENTITY_META[entity].fields.filter(
    (f) => f.type === 'url' || f.type === 'url-list'
  );
}

/**
 * Generates clear, comma-free CSV headers for Google Sheets / Excel exports & templates:
 * - Reference fields (`ref` / `ref-list`) -> `field_key (ref)`
 * - Dropdown fields (`select`) -> `field_key (opt1 | opt2 | ...)`
 * - URL/Image fields (`url` / `url-list`) -> Excel row-number ZIP instructions
 * The CSV importer strips everything from the first `(` automatically on upload.
 */
export function getCsvColumnHeader(
  entity: EntityKey,
  field: FieldDef,
  mode: 'insert' | 'update'
): string {
  if (entity === 'workers' && field.key === 'display_picture_url') {
    return mode === 'insert'
      ? 'display_picture_url (blank for Excel row ZIP e.g. 2.jpg or url)'
      : 'display_picture_url (url or Excel row ZIP e.g. 2.jpg to replace)';
  }
  if (entity === 'items' && field.key === 'list_url_image') {
    return mode === 'insert'
      ? 'list_url_image (blank for Excel row ZIP e.g. 2-1.jpg / 2-2.jpg or url)'
      : 'list_url_image (existing urls + Excel row ZIP e.g. 2-1.jpg to add)';
  }
  if (field.type === 'url') {
    return mode === 'insert'
      ? `${field.key} (blank for Excel row ZIP e.g. 2.jpg or url)`
      : `${field.key} (url or Excel row ZIP e.g. 2.jpg to replace)`;
  }
  if (field.type === 'url-list') {
    return mode === 'insert'
      ? `${field.key} (blank for Excel row ZIP e.g. 2-1.jpg or url)`
      : `${field.key} (existing urls + Excel row ZIP e.g. 2-1.jpg to add)`;
  }
  if (field.type === 'ref' || field.type === 'ref-list') {
    return `${field.key} (ref)`;
  }
  if (field.type === 'select' && field.options && field.options.length > 0) {
    const opts = field.options
      .map((o) => o.value.replace(/,/g, '/'))
      .join(' | ');
    return `${field.key} (${opts})`;
  }
  return field.key;
}

export function formatDatePeriodLabel(dateStr?: string | null): string {
  if (!dateStr) return '';
  const m = /^(\d{4})-(\d{2})/.exec(String(dateStr).trim());
  if (!m) return String(dateStr);
  const year = Number(m[1]);
  const monthIdx = Number(m[2]) - 1;
  const d = new Date(Date.UTC(year, monthIdx, 1));
  if (Number.isNaN(d.getTime())) return `${m[1]}-${m[2]}`;
  return d.toLocaleDateString('en-GB', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function canAccessRoute(role: WorkerRole, path: string): boolean {
  if (path === '/domestik') {
    return role === 'master' || role === 'admin';
  }
  if (path === '/b3/logs' || path === '/b3/workers') {
    return role === 'master';
  }
  if (
    path === '/b3/accounting/records' ||
    path === '/b3/accounting/coa' ||
    path === '/b3/accounting/statements'
  ) {
    return role === 'master' || role === 'admin';
  }
  switch (role) {
    case 'master':
      return true;
    case 'admin':
      return (
        path !== '/b3/dashboard' &&
        path !== '/' &&
        path !== '/b3/logs' &&
        path !== '/b3/workers' &&
        path !== '/b3/marketing'
      );
    case 'marketing':
      return (
        path === '/b3/clients' ||
        path === '/b3/branches' ||
        path === '/b3/requests' ||
        path === '/b3/marketing' ||
        path === '/b3/operational/schedule' ||
        path === '/b3/documents/invoice'
      );
    case 'worker':
      return path === '/b3/operational/data' || path === '/b3/requests';
    default:
      return false;
  }
}

export function defaultRouteForRole(role: WorkerRole): string {
  switch (role) {
    case 'master':
      return '/b3/dashboard';
    case 'admin':
      return '/b3/clients';
    case 'marketing':
      return '/b3/marketing';
    case 'worker':
      return '/b3/operational/data';
  }
}

export function canMutateEntity(role: WorkerRole, entity: EntityKey): boolean {
  if (entity === 'logs') return false;
  if (role === 'master') return true;
  if (role === 'admin') {
    return entity !== 'workers' && entity !== 'commissions';
  }
  if (role === 'marketing') {
    return entity === 'requests';
  }
  if (role === 'worker') {
    return entity === 'pickup_data' || entity === 'requests';
  }
  return false;
}
