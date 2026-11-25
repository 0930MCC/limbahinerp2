-- ============================================================================
-- Limbahin ERP — Supabase PostgreSQL Schema, Documents, Accounting Ledger & RLS
-- Run this SQL in your Supabase Project -> SQL Editor (safe to re-run)
-- ============================================================================

-- 0. Audit Logs (LOGS) — includes id_previous_logs for change-history chaining
CREATE TABLE IF NOT EXISTS public.logs (
  id TEXT PRIMARY KEY, -- e.g. LOGS-26-1001
  id_previous_logs TEXT REFERENCES public.logs(id) ON DELETE SET NULL,
  id_changed_by TEXT,
  model_name TEXT NOT NULL,
  timestamp_created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  changes_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 1. Workers (MCC) — Linked to Supabase Auth (auth.users); zero password hashes stored in public schema
CREATE TABLE IF NOT EXISTS public.workers (
  id TEXT PRIMARY KEY, -- e.g. MCC-1001 (master), MCC-K82PL (alphanumeric 5 chars)
  auth_user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  username TEXT UNIQUE NOT NULL,
  auth_email TEXT UNIQUE NOT NULL,
  email TEXT,
  phone TEXT,
  role TEXT NOT NULL CHECK (role IN ('master', 'marketing', 'admin', 'worker')),
  status TEXT NOT NULL DEFAULT 'inactive' CHECK (status IN ('active', 'inactive')),
  display_picture_url TEXT,
  id_log_create TEXT REFERENCES public.logs(id) ON DELETE SET NULL,
  id_log_update TEXT REFERENCES public.logs(id) ON DELETE SET NULL,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Customers / Clients (USR)
CREATE TABLE IF NOT EXISTS public.customers (
  id TEXT PRIMARY KEY, -- e.g. USR-M54ED (alphanumeric 5 chars)
  name TEXT NOT NULL,
  username TEXT UNIQUE,
  password_hash TEXT,
  email TEXT,
  -- Legacy optional compatibility columns
  tax_id TEXT,
  industry TEXT,
  pic_name TEXT,
  phone TEXT,
  address TEXT,
  marketing_id TEXT REFERENCES public.workers(id) ON DELETE SET NULL,
  status TEXT DEFAULT 'active' CHECK (status IS NULL OR status IN ('active', 'inactive', 'pending')),
  id_log_create TEXT REFERENCES public.logs(id) ON DELETE SET NULL,
  id_log_update TEXT REFERENCES public.logs(id) ON DELETE SET NULL,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Limbahin Branches (CUST)
CREATE TABLE IF NOT EXISTS public.branches (
  id TEXT PRIMARY KEY, -- e.g. CUST-PZX5V (alphanumeric 5 chars)
  id_client TEXT REFERENCES public.customers(id) ON DELETE CASCADE,
  branch_name TEXT,
  name_in_document TEXT,
  npwp TEXT,
  id_alamat_address_document TEXT,
  id_alamat_address_limbah TEXT,
  penanggung_jawab_utama_nama TEXT,
  penanggung_jawab_utama_jabatan TEXT,
  pic_operasional_nama TEXT,
  pic_operasional_telfonwa TEXT,
  pic_keuangan_nama TEXT,
  pic_keuangan_telfonwa TEXT,
  -- Legacy compatibility columns kept nullable
  client_id TEXT REFERENCES public.customers(id) ON DELETE CASCADE,
  name TEXT,
  city TEXT,
  address TEXT,
  pic_name TEXT,
  pic_phone TEXT,
  id_log_create TEXT REFERENCES public.logs(id) ON DELETE SET NULL,
  id_log_update TEXT REFERENCES public.logs(id) ON DELETE SET NULL,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3b. Requests (REQ)
CREATE TABLE IF NOT EXISTS public.requests (
  id TEXT PRIMARY KEY, -- e.g. REQ-26-1001
  request_type TEXT NOT NULL,
  catatan TEXT,
  solution TEXT,
  id_user TEXT NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  id_creator TEXT NOT NULL,
  id_log_create TEXT REFERENCES public.logs(id) ON DELETE SET NULL,
  id_log_update TEXT REFERENCES public.logs(id) ON DELETE SET NULL,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Item Model (ITM) — Used in Limbah Data Model, which in turn is used in Documents
CREATE TABLE IF NOT EXISTS public.items (
  id TEXT PRIMARY KEY, -- e.g. ITM-26-1001
  item_code TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  description TEXT,
  item_note TEXT, -- Helper format copied into Limbah Data final_item_note
  list_url_image TEXT[] NOT NULL DEFAULT '{}',
  -- Legacy compatibility columns kept nullable for seamless migration
  code TEXT,
  name TEXT,
  hazard_category TEXT DEFAULT 'Category 1',
  unit TEXT DEFAULT 'kg',
  unit_price NUMERIC(14, 2) DEFAULT 0,
  notes TEXT,
  id_log_create TEXT REFERENCES public.logs(id) ON DELETE SET NULL,
  id_log_update TEXT REFERENCES public.logs(id) ON DELETE SET NULL,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Schedule Model (LMBHN-SCHD-ITEM)
CREATE TABLE IF NOT EXISTS public.schedules (
  id TEXT PRIMARY KEY, -- e.g. LMBHN-SCHD-ITEM-26-1001
  vehicle_number TEXT,
  id_branch TEXT REFERENCES public.branches(id) ON DELETE SET NULL,
  order_index INTEGER NOT NULL DEFAULT 1,
  schedule_note TEXT,
  schedule_reschedule_problem TEXT,
  reschedule_id TEXT REFERENCES public.schedules(id) ON DELETE SET NULL,
  -- Legacy compatibility columns
  client_id TEXT REFERENCES public.customers(id) ON DELETE SET NULL,
  branch_id TEXT REFERENCES public.branches(id) ON DELETE SET NULL,
  assigned_worker_id TEXT REFERENCES public.workers(id) ON DELETE SET NULL,
  item_ids TEXT[] NOT NULL DEFAULT '{}',
  scheduled_date DATE DEFAULT CURRENT_DATE,
  vehicle_plate TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'in_progress', 'completed', 'cancelled', 'rescheduled')),
  notes TEXT,
  id_log_create TEXT REFERENCES public.logs(id) ON DELETE SET NULL,
  id_log_update TEXT REFERENCES public.logs(id) ON DELETE SET NULL,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. Companies (Multi-tenant accounting root)
CREATE TABLE IF NOT EXISTS public.companies (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name VARCHAR(150) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. Chart of Accounts (COA)
CREATE TABLE IF NOT EXISTS public.chart_of_accounts (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  company_id TEXT NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  code VARCHAR(32) NOT NULL,
  name VARCHAR(150) NOT NULL,
  category VARCHAR(32) NOT NULL CHECK (category IN ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE')),
  normal_balance VARCHAR(10) NOT NULL DEFAULT 'Debit' CHECK (normal_balance IN ('Debit', 'Credit')),
  statement VARCHAR(10) NOT NULL DEFAULT 'BS' CHECK (statement IN ('BS', 'IS')),
  id_log_create TEXT REFERENCES public.logs(id) ON DELETE SET NULL,
  id_log_update TEXT REFERENCES public.logs(id) ON DELETE SET NULL,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(company_id, code)
);

-- 8. Purchase Orders (PO)
CREATE TABLE IF NOT EXISTS public.purchase_orders (
  id TEXT PRIMARY KEY, -- e.g. PO-26-1001
  id_user_model TEXT REFERENCES public.customers(id) ON DELETE CASCADE,
  client_id TEXT REFERENCES public.customers(id) ON DELETE CASCADE,
  branch_id TEXT REFERENCES public.branches(id) ON DELETE SET NULL,
  item_ids TEXT[] NOT NULL DEFAULT '{}',
  po_number TEXT,
  note TEXT,
  date_period DATE DEFAULT CURRENT_DATE,
  issue_date DATE DEFAULT CURRENT_DATE,
  subtotal_amount NUMERIC(15, 2) NOT NULL DEFAULT 0,
  adjustments JSONB NOT NULL DEFAULT '[]'::jsonb,
  total_amount NUMERIC(15, 2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('draft', 'open', 'fulfilled', 'cancelled')),
  id_log_create TEXT REFERENCES public.logs(id) ON DELETE SET NULL,
  id_log_update TEXT REFERENCES public.logs(id) ON DELETE SET NULL,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 9. Certificate Model (LMBHN-CERT) — Shows table of Berita Acara (BA) models
CREATE TABLE IF NOT EXISTS public.certificates (
  id TEXT PRIMARY KEY, -- e.g. LMBHN-CERT-26-1001
  id_user_model TEXT REFERENCES public.customers(id) ON DELETE CASCADE,
  client_id TEXT REFERENCES public.customers(id) ON DELETE CASCADE,
  note TEXT,
  date_period DATE DEFAULT CURRENT_DATE,
  -- Legacy compatibility columns
  ba_id TEXT,
  manifest_code TEXT,
  treatment_method TEXT,
  issued_date DATE DEFAULT CURRENT_DATE,
  valid_until DATE,
  status TEXT NOT NULL DEFAULT 'issued' CHECK (status IN ('processing', 'issued', 'verified')),
  id_log_create TEXT REFERENCES public.logs(id) ON DELETE SET NULL,
  id_log_update TEXT REFERENCES public.logs(id) ON DELETE SET NULL,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 10. Berita Acara Model (LMBHN-BA) — Only attaches pickup-type Limbah Data
CREATE TABLE IF NOT EXISTS public.berita_acara (
  id TEXT PRIMARY KEY, -- e.g. LMBHN-BA-26-1001
  id_user_model TEXT REFERENCES public.customers(id) ON DELETE CASCADE,
  note TEXT,
  date_period DATE DEFAULT CURRENT_DATE,
  id_certificate TEXT REFERENCES public.certificates(id) ON DELETE SET NULL,
  -- Legacy compatibility columns
  pickup_id TEXT,
  client_id TEXT REFERENCES public.customers(id) ON DELETE CASCADE,
  branch_id TEXT REFERENCES public.branches(id) ON DELETE SET NULL,
  ba_date DATE DEFAULT CURRENT_DATE,
  signed_by_client TEXT,
  signed_by_officer TEXT,
  total_weight_kg NUMERIC(12, 2) DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'signed', 'archived')),
  id_log_create TEXT REFERENCES public.logs(id) ON DELETE SET NULL,
  id_log_update TEXT REFERENCES public.logs(id) ON DELETE SET NULL,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 11. Invoice Document Model (INV) — All data types + borderless adjustments + commission
CREATE TABLE IF NOT EXISTS public.invoices (
  id TEXT PRIMARY KEY, -- e.g. INV-26-1001
  company_id TEXT REFERENCES public.companies(id) ON DELETE SET NULL,
  invoice_number VARCHAR(64),
  id_user_model TEXT REFERENCES public.customers(id) ON DELETE CASCADE,
  client_id TEXT REFERENCES public.customers(id) ON DELETE CASCADE,
  note TEXT,
  date_period DATE DEFAULT CURRENT_DATE,
  po_id TEXT REFERENCES public.purchase_orders(id) ON DELETE SET NULL,
  ba_id TEXT REFERENCES public.berita_acara(id) ON DELETE SET NULL,
  issue_date DATE DEFAULT CURRENT_DATE,
  due_date DATE DEFAULT CURRENT_DATE,
  subtotal_amount NUMERIC(15, 2) NOT NULL DEFAULT 0,
  adjustments JSONB NOT NULL DEFAULT '[]'::jsonb,
  tax_amount NUMERIC(15, 2) NOT NULL DEFAULT 0,
  total_amount NUMERIC(15, 2) NOT NULL DEFAULT 0,
  amount NUMERIC(15, 2) NOT NULL DEFAULT 0,
  id_user_comission TEXT REFERENCES public.workers(id) ON DELETE SET NULL,
  comission_amount NUMERIC(15, 2) NOT NULL DEFAULT 0,
  commission_user_id TEXT REFERENCES public.workers(id) ON DELETE SET NULL,
  commission_amount NUMERIC(15, 2) NOT NULL DEFAULT 0,
  is_canceled BOOLEAN NOT NULL DEFAULT false,
  canceled_at TIMESTAMPTZ,
  cancel_reason TEXT,
  status TEXT NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid', 'overdue', 'partial', 'paid', 'canceled')),
  id_log_create TEXT REFERENCES public.logs(id) ON DELETE SET NULL,
  id_log_update TEXT REFERENCES public.logs(id) ON DELETE SET NULL,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 12. FPL Real Model (LMBHN-FPLREAL) — Only attaches pickup-type Limbah Data
CREATE TABLE IF NOT EXISTS public.fpl_real (
  id TEXT PRIMARY KEY, -- e.g. LMBHN-FPLREAL-26-1001
  id_user_model TEXT NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  note TEXT,
  date_period DATE NOT NULL DEFAULT CURRENT_DATE,
  subtotal_amount NUMERIC(15, 2) NOT NULL DEFAULT 0,
  adjustments JSONB NOT NULL DEFAULT '[]'::jsonb,
  total_amount NUMERIC(15, 2) NOT NULL DEFAULT 0,
  id_log_create TEXT REFERENCES public.logs(id) ON DELETE SET NULL,
  id_log_update TEXT REFERENCES public.logs(id) ON DELETE SET NULL,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 13. FPL Doc Model (LMBHN-FPLDOC) — Only attaches pickup-type Limbah Data
CREATE TABLE IF NOT EXISTS public.fpl_doc (
  id TEXT PRIMARY KEY, -- e.g. LMBHN-FPLDOC-26-1001
  id_user_model TEXT NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  note TEXT,
  date_period DATE NOT NULL DEFAULT CURRENT_DATE,
  subtotal_amount NUMERIC(15, 2) NOT NULL DEFAULT 0,
  adjustments JSONB NOT NULL DEFAULT '[]'::jsonb,
  total_amount NUMERIC(15, 2) NOT NULL DEFAULT 0,
  id_log_create TEXT REFERENCES public.logs(id) ON DELETE SET NULL,
  id_log_update TEXT REFERENCES public.logs(id) ON DELETE SET NULL,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 14. Limbah Data Model (DATA) — Stored in public.pickup_data for zero-downtime upgrade
-- Each data row can only be referenced once per document type via single FK columns
CREATE TABLE IF NOT EXISTS public.pickup_data (
  id TEXT PRIMARY KEY, -- e.g. DATA-26-1001
  data TEXT,
  id_user_model TEXT REFERENCES public.customers(id) ON DELETE CASCADE,
  id_item_model TEXT REFERENCES public.items(id) ON DELETE RESTRICT,
  data_type TEXT NOT NULL DEFAULT 'pickup' CHECK (data_type IN ('pickup', 'service', 'transport', 'admin', 'other')),
  reference_number TEXT,
  manifest_number TEXT,
  quantity NUMERIC(14, 2) NOT NULL DEFAULT 0,
  unit TEXT NOT NULL DEFAULT 'kg',
  invoice_price NUMERIC(15, 2) NOT NULL DEFAULT 0,
  fpl_price NUMERIC(15, 2) NOT NULL DEFAULT 0,
  final_item_note TEXT,
  internal_note TEXT, -- Internal ERP only; NEVER displayed in documents
  fpl_doc_id TEXT REFERENCES public.fpl_doc(id) ON DELETE SET NULL,
  fpl_real_id TEXT REFERENCES public.fpl_real(id) ON DELETE SET NULL,
  ba_id TEXT REFERENCES public.berita_acara(id) ON DELETE SET NULL,
  inv_id TEXT REFERENCES public.invoices(id) ON DELETE SET NULL,
  po_id TEXT REFERENCES public.purchase_orders(id) ON DELETE SET NULL,
  -- Legacy compatibility columns kept nullable
  schedule_id TEXT REFERENCES public.schedules(id) ON DELETE SET NULL,
  client_id TEXT REFERENCES public.customers(id) ON DELETE SET NULL,
  branch_id TEXT REFERENCES public.branches(id) ON DELETE SET NULL,
  item_id TEXT REFERENCES public.items(id) ON DELETE SET NULL,
  worker_id TEXT REFERENCES public.workers(id) ON DELETE SET NULL,
  weight_kg NUMERIC(12, 2) DEFAULT 0,
  container_count INTEGER DEFAULT 1,
  pickup_date DATE DEFAULT CURRENT_DATE,
  status TEXT DEFAULT 'recorded' CHECK (status IN ('recorded', 'verified', 'manifested')),
  notes TEXT,
  id_log_create TEXT REFERENCES public.logs(id) ON DELETE SET NULL,
  id_log_update TEXT REFERENCES public.logs(id) ON DELETE SET NULL,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 15. Marketing Commissions (COM)
CREATE TABLE IF NOT EXISTS public.commissions (
  id TEXT PRIMARY KEY, -- e.g. COM-26-1001
  marketing_id TEXT NOT NULL REFERENCES public.workers(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  invoice_id TEXT REFERENCES public.invoices(id) ON DELETE SET NULL,
  period TEXT NOT NULL, -- e.g. 2026-11
  rate_percent NUMERIC(5, 2) NOT NULL DEFAULT 5.00,
  commission_amount NUMERIC(15, 2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'paid')),
  id_log_create TEXT REFERENCES public.logs(id) ON DELETE SET NULL,
  id_log_update TEXT REFERENCES public.logs(id) ON DELETE SET NULL,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 16. Transaction Record Header (RCRD)
CREATE TABLE IF NOT EXISTS public.rcrd (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  company_id TEXT NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  source_type VARCHAR(32) NOT NULL DEFAULT 'MANUAL' CHECK (source_type IN ('MANUAL', 'BCA1', 'SYSTEM', 'ADJUSTMENT', 'SYSTEM_AUTO', 'CSV_IMPORT', 'REVERSAL')),
  bank_account_id TEXT REFERENCES public.chart_of_accounts(id) ON DELETE SET NULL,
  transaction_date DATE NOT NULL,
  transaction_description TEXT,
  transaction_amount NUMERIC(15, 2) NOT NULL DEFAULT 0,
  transaction_note TEXT,
  id_log_create TEXT REFERENCES public.logs(id) ON DELETE SET NULL,
  id_log_update TEXT REFERENCES public.logs(id) ON DELETE SET NULL,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 17. Record Classification / Ledger Lines (RCRD-CLSF)
CREATE TABLE IF NOT EXISTS public.rcrd_clsf (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  id_transaction_record TEXT NOT NULL REFERENCES public.rcrd(id) ON DELETE CASCADE,
  type VARCHAR(10) NOT NULL CHECK (type IN ('DEBIT', 'CREDIT')),
  account_id TEXT NOT NULL REFERENCES public.chart_of_accounts(id) ON DELETE RESTRICT,
  amount NUMERIC(15, 2) NOT NULL,
  reference_model VARCHAR(50),
  reference_model_id TEXT
);

-- 18. Single-CSV Staging Table (Upload Excel/CSV here)
CREATE TABLE IF NOT EXISTS public.csv_import_batches (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  company_id TEXT NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  batch_tag VARCHAR(64) NOT NULL,
  rcrd_id TEXT,
  group_no VARCHAR(32) NOT NULL,
  transaction_date DATE NOT NULL,
  bank_code VARCHAR(32),
  description TEXT,
  note TEXT,
  type VARCHAR(10) CHECK (type IS NULL OR type IN ('DEBIT', 'CREDIT')),
  account_code VARCHAR(32),
  amount NUMERIC(15, 2) NOT NULL,
  ref_model VARCHAR(50),
  ref_number VARCHAR(100)
);

-- ============================================================================
-- Idempotent Migrations (safe to re-run on already-initialized Supabase DBs)
-- ============================================================================

-- Audit logs & worker cleanup
ALTER TABLE public.logs            ADD COLUMN IF NOT EXISTS id_previous_logs TEXT REFERENCES public.logs(id) ON DELETE SET NULL;
ALTER TABLE public.workers         DROP COLUMN IF EXISTS password_hash;
ALTER TABLE public.workers         ADD COLUMN IF NOT EXISTS id_log_create TEXT REFERENCES public.logs(id) ON DELETE SET NULL;
ALTER TABLE public.workers         ADD COLUMN IF NOT EXISTS id_log_update TEXT REFERENCES public.logs(id) ON DELETE SET NULL;
ALTER TABLE public.customers       ADD COLUMN IF NOT EXISTS id_log_create TEXT REFERENCES public.logs(id) ON DELETE SET NULL;
ALTER TABLE public.customers       ADD COLUMN IF NOT EXISTS id_log_update TEXT REFERENCES public.logs(id) ON DELETE SET NULL;
ALTER TABLE public.branches        ADD COLUMN IF NOT EXISTS id_log_create TEXT REFERENCES public.logs(id) ON DELETE SET NULL;
ALTER TABLE public.branches        ADD COLUMN IF NOT EXISTS id_log_update TEXT REFERENCES public.logs(id) ON DELETE SET NULL;

-- Item Model (ITM) migrations
ALTER TABLE public.items           ADD COLUMN IF NOT EXISTS item_code TEXT NOT NULL DEFAULT '';
ALTER TABLE public.items           ADD COLUMN IF NOT EXISTS title TEXT NOT NULL DEFAULT '';
ALTER TABLE public.items           ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE public.items           ADD COLUMN IF NOT EXISTS item_note TEXT;
ALTER TABLE public.items           ADD COLUMN IF NOT EXISTS list_url_image TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE public.items           ADD COLUMN IF NOT EXISTS id_log_create TEXT REFERENCES public.logs(id) ON DELETE SET NULL;
ALTER TABLE public.items           ADD COLUMN IF NOT EXISTS id_log_update TEXT REFERENCES public.logs(id) ON DELETE SET NULL;
ALTER TABLE public.items           ALTER COLUMN code DROP NOT NULL;
ALTER TABLE public.items           ALTER COLUMN name DROP NOT NULL;
ALTER TABLE public.items           ALTER COLUMN hazard_category DROP NOT NULL;
ALTER TABLE public.items           ALTER COLUMN unit DROP NOT NULL;
ALTER TABLE public.items           ALTER COLUMN unit_price DROP NOT NULL;
ALTER TABLE public.items           DROP CONSTRAINT IF EXISTS items_hazard_category_check;

UPDATE public.items
SET item_code = COALESCE(NULLIF(item_code, ''), code, ''),
    title = COALESCE(NULLIF(title, ''), name, ''),
    item_note = COALESCE(item_note, notes)
WHERE item_code = '' OR title = '';

-- Schedule Model (LMBHN-SCHD-ITEM) migrations
ALTER TABLE public.schedules       ADD COLUMN IF NOT EXISTS vehicle_number TEXT;
ALTER TABLE public.schedules       ADD COLUMN IF NOT EXISTS id_branch TEXT REFERENCES public.branches(id) ON DELETE SET NULL;
ALTER TABLE public.schedules       ADD COLUMN IF NOT EXISTS order_index INTEGER NOT NULL DEFAULT 1;
ALTER TABLE public.schedules       ADD COLUMN IF NOT EXISTS schedule_note TEXT;
-- Customers (USR) & Items standardized fields
ALTER TABLE public.customers       ADD COLUMN IF NOT EXISTS username TEXT;
ALTER TABLE public.customers       ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE public.customers       ADD COLUMN IF NOT EXISTS tax_id TEXT;
ALTER TABLE public.customers       ALTER COLUMN status DROP NOT NULL;
ALTER TABLE public.items           ADD COLUMN IF NOT EXISTS kemasan TEXT;

-- Limbahin Branches (CUST) migrations
ALTER TABLE public.branches        ADD COLUMN IF NOT EXISTS id_client TEXT REFERENCES public.customers(id) ON DELETE CASCADE;
ALTER TABLE public.branches        ADD COLUMN IF NOT EXISTS branch_name TEXT;
ALTER TABLE public.branches        ADD COLUMN IF NOT EXISTS name_in_document TEXT;
ALTER TABLE public.branches        ADD COLUMN IF NOT EXISTS npwp TEXT;
ALTER TABLE public.branches        ADD COLUMN IF NOT EXISTS id_alamat_address_document TEXT;
ALTER TABLE public.branches        ADD COLUMN IF NOT EXISTS id_alamat_address_limbah TEXT;
ALTER TABLE public.branches        ADD COLUMN IF NOT EXISTS penanggung_jawab_utama_nama TEXT;
ALTER TABLE public.branches        ADD COLUMN IF NOT EXISTS penanggung_jawab_utama_jabatan TEXT;
ALTER TABLE public.branches        ADD COLUMN IF NOT EXISTS pic_operasional_nama TEXT;
ALTER TABLE public.branches        ADD COLUMN IF NOT EXISTS pic_operasional_telfonwa TEXT;
ALTER TABLE public.branches        ADD COLUMN IF NOT EXISTS pic_keuangan_nama TEXT;
ALTER TABLE public.branches        ADD COLUMN IF NOT EXISTS pic_keuangan_telfonwa TEXT;
ALTER TABLE public.branches        ALTER COLUMN client_id DROP NOT NULL;
ALTER TABLE public.branches        ALTER COLUMN name DROP NOT NULL;
ALTER TABLE public.branches        ALTER COLUMN city DROP NOT NULL;

UPDATE public.branches b
SET id_client = COALESCE(b.id_client, b.client_id),
    branch_name = COALESCE(NULLIF(b.branch_name, ''), b.name, ''),
    name_in_document = COALESCE(
      NULLIF(b.name_in_document, ''),
      CASE
        WHEN c.name IS NOT NULL AND COALESCE(NULLIF(b.branch_name, ''), b.name, '') <> ''
          THEN c.name || ' - ' || COALESCE(NULLIF(b.branch_name, ''), b.name, '')
        ELSE COALESCE(NULLIF(b.branch_name, ''), b.name, c.name, '')
      END
    ),
    id_alamat_address_document = COALESCE(b.id_alamat_address_document, b.address),
    id_alamat_address_limbah = COALESCE(b.id_alamat_address_limbah, b.address),
    pic_operasional_nama = COALESCE(b.pic_operasional_nama, b.pic_name),
    pic_operasional_telfonwa = COALESCE(b.pic_operasional_telfonwa, b.pic_phone)
FROM public.customers c
WHERE c.id = COALESCE(b.id_client, b.client_id)
  AND (b.id_client IS NULL OR b.branch_name IS NULL OR b.name_in_document IS NULL);

-- Ledger CSV staging source_type migration
ALTER TABLE public.csv_import_batches ADD COLUMN IF NOT EXISTS source_type VARCHAR(32) DEFAULT 'BCA1';

-- Schedules migrations
ALTER TABLE public.schedules       ADD COLUMN IF NOT EXISTS schedule_reschedule_problem TEXT;
ALTER TABLE public.schedules       ADD COLUMN IF NOT EXISTS reschedule_id TEXT REFERENCES public.schedules(id) ON DELETE SET NULL;
ALTER TABLE public.schedules       ADD COLUMN IF NOT EXISTS id_log_create TEXT REFERENCES public.logs(id) ON DELETE SET NULL;
ALTER TABLE public.schedules       ADD COLUMN IF NOT EXISTS id_log_update TEXT REFERENCES public.logs(id) ON DELETE SET NULL;
ALTER TABLE public.schedules       ALTER COLUMN client_id DROP NOT NULL;
ALTER TABLE public.schedules       ALTER COLUMN scheduled_date DROP NOT NULL;
ALTER TABLE public.schedules       DROP CONSTRAINT IF EXISTS schedules_status_check;
ALTER TABLE public.schedules       ADD CONSTRAINT schedules_status_check
  CHECK (status IS NULL OR status IN (
    'Upcoming', 'Minggu ini', 'Hari ini', 'Reschedule',
    'scheduled', 'in_progress', 'completed', 'cancelled', 'rescheduled'
  ));

UPDATE public.schedules
SET vehicle_number = COALESCE(vehicle_number, vehicle_plate),
    id_branch = COALESCE(id_branch, branch_id),
    schedule_note = COALESCE(schedule_note, notes)
WHERE vehicle_number IS NULL OR id_branch IS NULL OR schedule_note IS NULL;

-- Purchase Orders (PO) migrations
ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS id_user_model TEXT REFERENCES public.customers(id) ON DELETE CASCADE;
ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS note TEXT;
ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS date_period DATE DEFAULT CURRENT_DATE;
ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS subtotal_amount NUMERIC(15, 2) NOT NULL DEFAULT 0;
ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS adjustments JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS id_log_create TEXT REFERENCES public.logs(id) ON DELETE SET NULL;
ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS id_log_update TEXT REFERENCES public.logs(id) ON DELETE SET NULL;
ALTER TABLE public.purchase_orders ALTER COLUMN client_id DROP NOT NULL;
ALTER TABLE public.purchase_orders ALTER COLUMN po_number DROP NOT NULL;
ALTER TABLE public.purchase_orders ALTER COLUMN issue_date DROP NOT NULL;

ALTER TABLE public.purchase_orders DROP CONSTRAINT IF EXISTS purchase_orders_status_check;
ALTER TABLE public.purchase_orders ADD CONSTRAINT purchase_orders_status_check
  CHECK (status IS NULL OR status IN (
    'Draft', 'Tersimpan', 'Terubah', 'Cancel', 'Sedang Diubah', 'Dihapus',
    'draft', 'open', 'fulfilled', 'cancelled'
  ));

UPDATE public.purchase_orders
SET id_user_model = COALESCE(id_user_model, client_id),
    date_period = COALESCE(date_period, issue_date, CURRENT_DATE),
    subtotal_amount = CASE WHEN subtotal_amount = 0 AND total_amount > 0 THEN total_amount ELSE subtotal_amount END
WHERE id_user_model IS NULL OR date_period IS NULL;

-- Certificates (LMBHN-CERT) migrations
ALTER TABLE public.certificates    ADD COLUMN IF NOT EXISTS id_user_model TEXT REFERENCES public.customers(id) ON DELETE CASCADE;
ALTER TABLE public.certificates    ADD COLUMN IF NOT EXISTS note TEXT;
ALTER TABLE public.certificates    ADD COLUMN IF NOT EXISTS date_period DATE DEFAULT CURRENT_DATE;
ALTER TABLE public.certificates    ADD COLUMN IF NOT EXISTS id_log_create TEXT REFERENCES public.logs(id) ON DELETE SET NULL;
ALTER TABLE public.certificates    ADD COLUMN IF NOT EXISTS id_log_update TEXT REFERENCES public.logs(id) ON DELETE SET NULL;
ALTER TABLE public.certificates    ALTER COLUMN client_id DROP NOT NULL;
ALTER TABLE public.certificates    ALTER COLUMN manifest_code DROP NOT NULL;
ALTER TABLE public.certificates    ALTER COLUMN treatment_method DROP NOT NULL;
ALTER TABLE public.certificates    ALTER COLUMN issued_date DROP NOT NULL;
ALTER TABLE public.certificates    DROP CONSTRAINT IF EXISTS certificates_status_check;
ALTER TABLE public.certificates    ADD CONSTRAINT certificates_status_check
  CHECK (status IS NULL OR status IN (
    'Draft', 'Tersimpan', 'Terubah', 'Cancel', 'Sedang Diubah', 'Dihapus',
    'processing', 'issued', 'verified'
  ));

UPDATE public.certificates
SET id_user_model = COALESCE(id_user_model, client_id),
    date_period = COALESCE(date_period, issued_date, CURRENT_DATE)
WHERE id_user_model IS NULL OR date_period IS NULL;

-- Berita Acara (LMBHN-BA) migrations
ALTER TABLE public.berita_acara    ADD COLUMN IF NOT EXISTS id_user_model TEXT REFERENCES public.customers(id) ON DELETE CASCADE;
ALTER TABLE public.berita_acara    ADD COLUMN IF NOT EXISTS note TEXT;
ALTER TABLE public.berita_acara    ADD COLUMN IF NOT EXISTS date_period DATE DEFAULT CURRENT_DATE;
ALTER TABLE public.berita_acara    ADD COLUMN IF NOT EXISTS id_certificate TEXT REFERENCES public.certificates(id) ON DELETE SET NULL;
ALTER TABLE public.berita_acara    ADD COLUMN IF NOT EXISTS id_log_create TEXT REFERENCES public.logs(id) ON DELETE SET NULL;
ALTER TABLE public.berita_acara    ADD COLUMN IF NOT EXISTS id_log_update TEXT REFERENCES public.logs(id) ON DELETE SET NULL;
ALTER TABLE public.berita_acara    ALTER COLUMN client_id DROP NOT NULL;
ALTER TABLE public.berita_acara    ALTER COLUMN ba_date DROP NOT NULL;
ALTER TABLE public.berita_acara    ALTER COLUMN total_weight_kg DROP NOT NULL;
ALTER TABLE public.berita_acara    DROP CONSTRAINT IF EXISTS berita_acara_status_check;
ALTER TABLE public.berita_acara    ADD CONSTRAINT berita_acara_status_check
  CHECK (status IS NULL OR status IN (
    'Draft', 'Tersimpan', 'Terubah', 'Cancel', 'Sedang Diubah', 'Dihapus',
    'draft', 'signed', 'archived'
  ));

UPDATE public.berita_acara
SET id_user_model = COALESCE(id_user_model, client_id),
    date_period = COALESCE(date_period, ba_date, CURRENT_DATE)
WHERE id_user_model IS NULL OR date_period IS NULL;

-- FPL Real & FPL Doc status migrations
ALTER TABLE public.fpl_real        ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'Draft';
ALTER TABLE public.fpl_doc         ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'Draft';

-- Invoices (INV) migrations
ALTER TABLE public.invoices        ADD COLUMN IF NOT EXISTS company_id TEXT REFERENCES public.companies(id) ON DELETE SET NULL;
ALTER TABLE public.invoices        ADD COLUMN IF NOT EXISTS invoice_number VARCHAR(64);
ALTER TABLE public.invoices        ADD COLUMN IF NOT EXISTS jenis_invoice TEXT;
ALTER TABLE public.invoices        ADD COLUMN IF NOT EXISTS id_user_model TEXT REFERENCES public.customers(id) ON DELETE CASCADE;
ALTER TABLE public.invoices        ADD COLUMN IF NOT EXISTS note TEXT;
ALTER TABLE public.invoices        ADD COLUMN IF NOT EXISTS date_period DATE DEFAULT CURRENT_DATE;
ALTER TABLE public.invoices        ADD COLUMN IF NOT EXISTS subtotal_amount NUMERIC(15, 2) NOT NULL DEFAULT 0;
ALTER TABLE public.invoices        ADD COLUMN IF NOT EXISTS adjustments JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.invoices        ADD COLUMN IF NOT EXISTS tax_amount NUMERIC(15, 2) NOT NULL DEFAULT 0;
ALTER TABLE public.invoices        ADD COLUMN IF NOT EXISTS total_amount NUMERIC(15, 2) NOT NULL DEFAULT 0;
ALTER TABLE public.invoices        ADD COLUMN IF NOT EXISTS id_user_comission TEXT REFERENCES public.workers(id) ON DELETE SET NULL;
ALTER TABLE public.invoices        ADD COLUMN IF NOT EXISTS comission_amount NUMERIC(15, 2) NOT NULL DEFAULT 0;
ALTER TABLE public.invoices        ADD COLUMN IF NOT EXISTS commission_user_id TEXT REFERENCES public.workers(id) ON DELETE SET NULL;
ALTER TABLE public.invoices        ADD COLUMN IF NOT EXISTS commission_amount NUMERIC(15, 2) NOT NULL DEFAULT 0;
ALTER TABLE public.invoices        ADD COLUMN IF NOT EXISTS is_canceled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.invoices        ADD COLUMN IF NOT EXISTS canceled_at TIMESTAMPTZ;
ALTER TABLE public.invoices        ADD COLUMN IF NOT EXISTS cancel_reason TEXT;
ALTER TABLE public.invoices        ADD COLUMN IF NOT EXISTS id_log_create TEXT REFERENCES public.logs(id) ON DELETE SET NULL;
ALTER TABLE public.invoices        ADD COLUMN IF NOT EXISTS id_log_update TEXT REFERENCES public.logs(id) ON DELETE SET NULL;
ALTER TABLE public.invoices        ALTER COLUMN client_id DROP NOT NULL;
ALTER TABLE public.invoices        ALTER COLUMN issue_date DROP NOT NULL;
ALTER TABLE public.invoices        ALTER COLUMN due_date DROP NOT NULL;

ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_status_check;
ALTER TABLE public.invoices ADD CONSTRAINT invoices_status_check
  CHECK (status IS NULL OR status IN (
    'Draft', 'Tersimpan', 'Terubah', 'Cancel', 'Sedang Diubah', 'Dihapus',
    'unpaid', 'overdue', 'partial', 'paid', 'canceled'
  ));

UPDATE public.invoices
SET invoice_number = COALESCE(NULLIF(invoice_number, ''), id),
    id_user_model = COALESCE(id_user_model, client_id),
    date_period = COALESCE(date_period, issue_date, CURRENT_DATE),
    id_user_comission = COALESCE(id_user_comission, commission_user_id),
    comission_amount = CASE WHEN comission_amount = 0 AND commission_amount > 0 THEN commission_amount ELSE comission_amount END,
    total_amount = CASE WHEN total_amount = 0 AND amount > 0 THEN amount ELSE total_amount END,
    subtotal_amount = CASE WHEN subtotal_amount = 0 AND total_amount = 0 AND amount > 0 THEN amount ELSE subtotal_amount END
WHERE invoice_number IS NULL OR invoice_number = '' OR id_user_model IS NULL OR date_period IS NULL OR (total_amount = 0 AND amount > 0);

-- Limbah Data Model (pickup_data / DATA) migrations
ALTER TABLE public.pickup_data     ADD COLUMN IF NOT EXISTS data TEXT;
ALTER TABLE public.pickup_data     ADD COLUMN IF NOT EXISTS id_user_model TEXT REFERENCES public.customers(id) ON DELETE CASCADE;
ALTER TABLE public.pickup_data     ADD COLUMN IF NOT EXISTS id_item_model TEXT REFERENCES public.items(id) ON DELETE RESTRICT;
ALTER TABLE public.pickup_data     ADD COLUMN IF NOT EXISTS data_type TEXT NOT NULL DEFAULT 'pickup';
ALTER TABLE public.pickup_data     ADD COLUMN IF NOT EXISTS reference_number TEXT;
ALTER TABLE public.pickup_data     ADD COLUMN IF NOT EXISTS manifest_number TEXT;
ALTER TABLE public.pickup_data     ADD COLUMN IF NOT EXISTS quantity NUMERIC(14, 2) NOT NULL DEFAULT 0;
ALTER TABLE public.pickup_data     ADD COLUMN IF NOT EXISTS unit TEXT NOT NULL DEFAULT 'kg';
ALTER TABLE public.pickup_data     ADD COLUMN IF NOT EXISTS invoice_price NUMERIC(15, 2) NOT NULL DEFAULT 0;
ALTER TABLE public.pickup_data     ADD COLUMN IF NOT EXISTS fpl_price NUMERIC(15, 2) NOT NULL DEFAULT 0;
ALTER TABLE public.pickup_data     ADD COLUMN IF NOT EXISTS final_item_note TEXT;
ALTER TABLE public.pickup_data     ADD COLUMN IF NOT EXISTS internal_note TEXT;
ALTER TABLE public.pickup_data     ADD COLUMN IF NOT EXISTS fpl_doc_id TEXT REFERENCES public.fpl_doc(id) ON DELETE SET NULL;
ALTER TABLE public.pickup_data     ADD COLUMN IF NOT EXISTS fpl_real_id TEXT REFERENCES public.fpl_real(id) ON DELETE SET NULL;
ALTER TABLE public.pickup_data     ADD COLUMN IF NOT EXISTS ba_id TEXT REFERENCES public.berita_acara(id) ON DELETE SET NULL;
ALTER TABLE public.pickup_data     ADD COLUMN IF NOT EXISTS inv_id TEXT REFERENCES public.invoices(id) ON DELETE SET NULL;
ALTER TABLE public.pickup_data     ADD COLUMN IF NOT EXISTS po_id TEXT REFERENCES public.purchase_orders(id) ON DELETE SET NULL;
ALTER TABLE public.pickup_data     ADD COLUMN IF NOT EXISTS id_log_create TEXT REFERENCES public.logs(id) ON DELETE SET NULL;
ALTER TABLE public.pickup_data     ADD COLUMN IF NOT EXISTS id_log_update TEXT REFERENCES public.logs(id) ON DELETE SET NULL;
ALTER TABLE public.pickup_data     ALTER COLUMN client_id DROP NOT NULL;
ALTER TABLE public.pickup_data     ALTER COLUMN item_id DROP NOT NULL;
ALTER TABLE public.pickup_data     ALTER COLUMN weight_kg DROP NOT NULL;
ALTER TABLE public.pickup_data     ALTER COLUMN container_count DROP NOT NULL;
ALTER TABLE public.pickup_data     ALTER COLUMN pickup_date DROP NOT NULL;
ALTER TABLE public.pickup_data     ADD COLUMN IF NOT EXISTS jenis_pelayanan TEXT;
ALTER TABLE public.pickup_data     ADD COLUMN IF NOT EXISTS jenis_manifest TEXT;
ALTER TABLE public.pickup_data     ADD COLUMN IF NOT EXISTS kemasan TEXT;
ALTER TABLE public.pickup_data     DROP CONSTRAINT IF EXISTS pickup_data_data_type_check;
ALTER TABLE public.pickup_data     ADD CONSTRAINT pickup_data_data_type_check
  CHECK (data_type IN (
    'LB3 Pickup', 'LB3 Pickup Details', 'LB3 Data', 'Logistik',
    'pickup', 'service', 'transport', 'admin', 'other'
  ));

UPDATE public.pickup_data
SET id_user_model = COALESCE(id_user_model, client_id),
    id_item_model = COALESCE(id_item_model, item_id),
    data = COALESCE(data, pickup_date::text),
    quantity = CASE WHEN quantity = 0 AND COALESCE(weight_kg, 0) > 0 THEN weight_kg ELSE quantity END,
    final_item_note = COALESCE(final_item_note, notes)
WHERE id_user_model IS NULL OR id_item_model IS NULL OR data IS NULL;

-- Commissions, COA, RCRD & CSV staging migrations
ALTER TABLE public.commissions       ADD COLUMN IF NOT EXISTS id_log_create TEXT REFERENCES public.logs(id) ON DELETE SET NULL;
ALTER TABLE public.commissions       ADD COLUMN IF NOT EXISTS id_log_update TEXT REFERENCES public.logs(id) ON DELETE SET NULL;
ALTER TABLE public.chart_of_accounts ADD COLUMN IF NOT EXISTS normal_balance VARCHAR(10) NOT NULL DEFAULT 'Debit' CHECK (normal_balance IN ('Debit', 'Credit'));
ALTER TABLE public.chart_of_accounts ADD COLUMN IF NOT EXISTS statement VARCHAR(10) NOT NULL DEFAULT 'BS' CHECK (statement IN ('BS', 'IS'));
ALTER TABLE public.chart_of_accounts ADD COLUMN IF NOT EXISTS id_log_create TEXT REFERENCES public.logs(id) ON DELETE SET NULL;
ALTER TABLE public.chart_of_accounts ADD COLUMN IF NOT EXISTS id_log_update TEXT REFERENCES public.logs(id) ON DELETE SET NULL;
ALTER TABLE public.rcrd              ADD COLUMN IF NOT EXISTS id_log_create TEXT REFERENCES public.logs(id) ON DELETE SET NULL;
ALTER TABLE public.rcrd              ADD COLUMN IF NOT EXISTS id_log_update TEXT REFERENCES public.logs(id) ON DELETE SET NULL;
ALTER TABLE public.rcrd              DROP CONSTRAINT IF EXISTS rcrd_source_type_check;
ALTER TABLE public.rcrd              ADD CONSTRAINT rcrd_source_type_check
  CHECK (source_type IN ('MANUAL', 'BCA1', 'SYSTEM', 'ADJUSTMENT', 'SYSTEM_AUTO', 'CSV_IMPORT', 'REVERSAL'));
ALTER TABLE public.csv_import_batches ALTER COLUMN type DROP NOT NULL;
ALTER TABLE public.csv_import_batches ALTER COLUMN account_code DROP NOT NULL;
ALTER TABLE public.csv_import_batches DROP CONSTRAINT IF EXISTS csv_import_batches_type_check;
ALTER TABLE public.csv_import_batches ADD CONSTRAINT csv_import_batches_type_check
  CHECK (type IS NULL OR type IN ('DEBIT', 'CREDIT'));

-- ============================================================================
-- Indexes (created after idempotent column migrations so upgrades never fail)
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_pickup_data_inv ON public.pickup_data(inv_id);
CREATE INDEX IF NOT EXISTS idx_pickup_data_ba ON public.pickup_data(ba_id);
CREATE INDEX IF NOT EXISTS idx_pickup_data_fpl_real ON public.pickup_data(fpl_real_id);
CREATE INDEX IF NOT EXISTS idx_pickup_data_fpl_doc ON public.pickup_data(fpl_doc_id);
CREATE INDEX IF NOT EXISTS idx_pickup_data_po ON public.pickup_data(po_id);
CREATE INDEX IF NOT EXISTS idx_ba_cert ON public.berita_acara(id_certificate);
CREATE INDEX IF NOT EXISTS idx_rcrd_clsf_parent ON public.rcrd_clsf(id_transaction_record);
CREATE INDEX IF NOT EXISTS idx_rcrd_clsf_ref ON public.rcrd_clsf(reference_model, reference_model_id);
CREATE INDEX IF NOT EXISTS idx_rcrd_company_date ON public.rcrd(company_id, transaction_date DESC);
CREATE INDEX IF NOT EXISTS idx_csv_import_batch_lookup ON public.csv_import_batches(company_id, batch_tag);

-- ============================================================================
-- Seed Default Company & Chart of Accounts (COA-1010 to COA-6060)
-- ============================================================================
INSERT INTO public.companies (id, name)
VALUES ('COMP-MCC-001', 'PT. Media Cahaya Cerah')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.chart_of_accounts (id, company_id, code, name, category, normal_balance, statement)
VALUES
  ('COA-1010', 'COMP-MCC-001', 'COA-1010', 'Cash in Bank', 'ASSET', 'Debit', 'BS'),
  ('COA-1020', 'COMP-MCC-001', 'COA-1020', 'Petty Cash', 'ASSET', 'Debit', 'BS'),
  ('COA-1110', 'COMP-MCC-001', 'COA-1110', 'Accounts Receivable', 'ASSET', 'Debit', 'BS'),
  ('COA-1120', 'COMP-MCC-001', 'COA-1120', 'Allowance for Doubtful Accounts', 'ASSET', 'Credit', 'BS'),
  ('COA-1130', 'COMP-MCC-001', 'COA-1130', 'Employee Receivable', 'ASSET', 'Debit', 'BS'),
  ('COA-1200', 'COMP-MCC-001', 'COA-1200', 'PPN Masukan (VAT Input)', 'ASSET', 'Debit', 'BS'),
  ('COA-1310', 'COMP-MCC-001', 'COA-1310', 'Transport Fleet', 'ASSET', 'Debit', 'BS'),
  ('COA-1320', 'COMP-MCC-001', 'COA-1320', 'Accumulated Depreciation – Fleet', 'ASSET', 'Credit', 'BS'),
  ('COA-1410', 'COMP-MCC-001', 'COA-1410', 'Employee Advances & Loans', 'ASSET', 'Debit', 'BS'),
  ('COA-2010', 'COMP-MCC-001', 'COA-2010', 'Accounts Payable', 'LIABILITY', 'Credit', 'BS'),
  ('COA-2020', 'COMP-MCC-001', 'COA-2020', 'Employee Payable', 'LIABILITY', 'Credit', 'BS'),
  ('COA-2110', 'COMP-MCC-001', 'COA-2110', 'PPN Keluaran (VAT Output)', 'LIABILITY', 'Credit', 'BS'),
  ('COA-2120', 'COMP-MCC-001', 'COA-2120', 'Tax Payable (PPh 21 / PPh 23)', 'LIABILITY', 'Credit', 'BS'),
  ('COA-2210', 'COMP-MCC-001', 'COA-2210', 'Bank Loans / Vehicle Financing', 'LIABILITY', 'Credit', 'BS'),
  ('COA-3010', 'COMP-MCC-001', 'COA-3010', 'Owner''s Capital', 'EQUITY', 'Credit', 'BS'),
  ('COA-3020', 'COMP-MCC-001', 'COA-3020', 'Retained Earnings', 'EQUITY', 'Credit', 'BS'),
  ('COA-3030', 'COMP-MCC-001', 'COA-3030', 'Owner''s Drawings / Prive', 'EQUITY', 'Debit', 'BS'),
  ('COA-4010', 'COMP-MCC-001', 'COA-4010', 'B3 Waste Transport Revenue', 'REVENUE', 'Credit', 'IS'),
  ('COA-4020', 'COMP-MCC-001', 'COA-4020', 'Non-Hazardous Waste Revenue', 'REVENUE', 'Credit', 'IS'),
  ('COA-4030', 'COMP-MCC-001', 'COA-4030', 'Sales Discounts', 'REVENUE', 'Debit', 'IS'),
  ('COA-5010', 'COMP-MCC-001', 'COA-5010', 'Fleet Fuel', 'EXPENSE', 'Debit', 'IS'),
  ('COA-5020', 'COMP-MCC-001', 'COA-5020', 'Vehicle Maintenance & Tolls', 'EXPENSE', 'Debit', 'IS'),
  ('COA-5030', 'COMP-MCC-001', 'COA-5030', 'Driver Wages & Allowances', 'EXPENSE', 'Debit', 'IS'),
  ('COA-5040', 'COMP-MCC-001', 'COA-5040', 'Waste Treatment Partner Fees', 'EXPENSE', 'Debit', 'IS'),
  ('COA-5050', 'COMP-MCC-001', 'COA-5050', 'Environmental Testing Costs', 'EXPENSE', 'Debit', 'IS'),
  ('COA-5060', 'COMP-MCC-001', 'COA-5060', 'Vehicle Depreciation Expense', 'EXPENSE', 'Debit', 'IS'),
  ('COA-6010', 'COMP-MCC-001', 'COA-6010', 'Office Salaries & Admin Expenses', 'EXPENSE', 'Debit', 'IS'),
  ('COA-6020', 'COMP-MCC-001', 'COA-6020', 'Sales Commission', 'EXPENSE', 'Debit', 'IS'),
  ('COA-6030', 'COMP-MCC-001', 'COA-6030', 'Google Ads & Marketing', 'EXPENSE', 'Debit', 'IS'),
  ('COA-6040', 'COMP-MCC-001', 'COA-6040', 'Cloud Infrastructure & Software', 'EXPENSE', 'Debit', 'IS'),
  ('COA-6050', 'COMP-MCC-001', 'COA-6050', 'Licensing & Legal Fees (KLHK/Kemenhub)', 'EXPENSE', 'Debit', 'IS'),
  ('COA-6060', 'COMP-MCC-001', 'COA-6060', 'Bad Debt Expense', 'EXPENSE', 'Debit', 'IS')
ON CONFLICT (company_id, code) DO UPDATE
  SET name = EXCLUDED.name,
      category = EXCLUDED.category,
      normal_balance = EXCLUDED.normal_balance,
      statement = EXCLUDED.statement;

-- ============================================================================
-- Atomic Accounting RPC Functions
-- ============================================================================

-- A. Auto-Post Ledger When Invoice Is Saved
CREATE OR REPLACE FUNCTION public.post_invoice_to_ledger(
    p_invoice_id TEXT,
    p_ar_code VARCHAR DEFAULT 'COA-1110',
    p_rev_code VARCHAR DEFAULT 'COA-4010',
    p_tax_code VARCHAR DEFAULT 'COA-2110'
)
RETURNS TEXT AS $$
DECLARE
    inv RECORD;
    v_rcrd_id TEXT;
    v_ar_id TEXT;
    v_rev_id TEXT;
    v_tax_id TEXT;
    v_subtotal NUMERIC(15, 2);
    v_tax NUMERIC(15, 2);
    v_total NUMERIC(15, 2);
    v_inv_no TEXT;
    v_tx_date DATE;
BEGIN
    SELECT * INTO inv FROM public.invoices WHERE id = p_invoice_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Invoice not found'; END IF;
    IF inv.company_id IS NULL THEN RAISE EXCEPTION 'Invoice % has no company_id assigned', p_invoice_id; END IF;

    IF inv.is_canceled OR LOWER(COALESCE(inv.status, '')) IN ('canceled', 'cancel', 'dihapus') THEN
        RETURN NULL;
    END IF;

    -- Idempotency guard: avoid duplicate SYSTEM posting for the same invoice
    SELECT r.id INTO v_rcrd_id
    FROM public.rcrd r
    INNER JOIN public.rcrd_clsf c ON c.id_transaction_record = r.id
    WHERE r.source_type IN ('SYSTEM', 'SYSTEM_AUTO')
      AND c.reference_model = 'invoice'
      AND c.reference_model_id = inv.id
    LIMIT 1;
    IF v_rcrd_id IS NOT NULL THEN
        RETURN v_rcrd_id;
    END IF;

    v_inv_no := COALESCE(NULLIF(inv.invoice_number, ''), inv.id);
    v_tx_date := COALESCE(inv.date_period, inv.issue_date, CURRENT_DATE);
    v_total := CASE WHEN COALESCE(inv.total_amount, 0) > 0 THEN inv.total_amount ELSE COALESCE(inv.amount, 0) END;
    v_tax := COALESCE(inv.tax_amount, 0);
    v_subtotal := CASE WHEN COALESCE(inv.subtotal_amount, 0) > 0 THEN inv.subtotal_amount ELSE (v_total - v_tax) END;

    SELECT id INTO v_ar_id FROM public.chart_of_accounts WHERE company_id = inv.company_id AND code = p_ar_code;
    SELECT id INTO v_rev_id FROM public.chart_of_accounts WHERE company_id = inv.company_id AND code = p_rev_code;
    SELECT id INTO v_tax_id FROM public.chart_of_accounts WHERE company_id = inv.company_id AND code = p_tax_code;

    IF v_ar_id IS NULL OR v_rev_id IS NULL THEN
        RAISE EXCEPTION 'Required COA accounts (% / %) not found for company %', p_ar_code, p_rev_code, inv.company_id;
    END IF;
    IF v_tax <> 0 AND v_tax_id IS NULL THEN
        RAISE EXCEPTION 'Required tax COA account (%) not found for company %', p_tax_code, inv.company_id;
    END IF;

    -- Create Header
    INSERT INTO public.rcrd (company_id, source_type, transaction_date, transaction_description, transaction_amount, transaction_note)
    VALUES (inv.company_id, 'SYSTEM', v_tx_date, 'Invoice ' || v_inv_no, v_total, 'Auto-posted from invoice')
    RETURNING id INTO v_rcrd_id;

    -- Debit: Accounts Receivable (Full Total)
    INSERT INTO public.rcrd_clsf (id_transaction_record, type, account_id, amount, reference_model, reference_model_id)
    VALUES (v_rcrd_id, 'DEBIT', v_ar_id, v_total, 'invoice', inv.id);

    -- Credit: Sales Revenue (Subtotal / DPP)
    INSERT INTO public.rcrd_clsf (id_transaction_record, type, account_id, amount, reference_model, reference_model_id)
    VALUES (v_rcrd_id, 'CREDIT', v_rev_id, v_subtotal, 'invoice', inv.id);

    -- Credit: PPN Keluaran (If tax > 0) or Debit if negative adjustment
    IF v_tax > 0 THEN
        INSERT INTO public.rcrd_clsf (id_transaction_record, type, account_id, amount, reference_model, reference_model_id)
        VALUES (v_rcrd_id, 'CREDIT', v_tax_id, v_tax, 'invoice', inv.id);
    ELSIF v_tax < 0 THEN
        INSERT INTO public.rcrd_clsf (id_transaction_record, type, account_id, amount, reference_model, reference_model_id)
        VALUES (v_rcrd_id, 'DEBIT', v_tax_id, ABS(v_tax), 'invoice', inv.id);
    END IF;

    RETURN v_rcrd_id;
END;
$$ LANGUAGE plpgsql;

-- B. Cancel Invoice & Counter-Reversal Function
CREATE OR REPLACE FUNCTION public.cancel_invoice(
    p_invoice_id TEXT,
    p_cancel_date DATE,
    p_reason TEXT,
    p_auto_reverse BOOLEAN,
    p_ar_code VARCHAR DEFAULT 'COA-1110',
    p_rev_code VARCHAR DEFAULT 'COA-4010',
    p_tax_code VARCHAR DEFAULT 'COA-2110'
)
RETURNS TEXT AS $$
DECLARE
    inv RECORD;
    v_rcrd_id TEXT := NULL;
    v_ar_id TEXT;
    v_rev_id TEXT;
    v_tax_id TEXT;
    v_subtotal NUMERIC(15, 2);
    v_tax NUMERIC(15, 2);
    v_total NUMERIC(15, 2);
    v_inv_no TEXT;
BEGIN
    SELECT * INTO inv FROM public.invoices WHERE id = p_invoice_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Invoice not found'; END IF;
    IF inv.is_canceled THEN RAISE EXCEPTION 'Invoice is already canceled'; END IF;

    v_inv_no := COALESCE(NULLIF(inv.invoice_number, ''), inv.id);
    v_total := CASE WHEN COALESCE(inv.total_amount, 0) > 0 THEN inv.total_amount ELSE COALESCE(inv.amount, 0) END;
    v_tax := COALESCE(inv.tax_amount, 0);
    v_subtotal := CASE WHEN COALESCE(inv.subtotal_amount, 0) > 0 THEN inv.subtotal_amount ELSE (v_total - v_tax) END;

    -- 1. Mark Invoice as Canceled
    UPDATE public.invoices
    SET is_canceled = true,
        status = 'canceled',
        canceled_at = NOW(),
        cancel_reason = p_reason
    WHERE id = p_invoice_id;

    -- 2. If User Selected "Auto Counter-Reversal", post opposite entries
    IF p_auto_reverse THEN
        IF inv.company_id IS NULL THEN
            RAISE EXCEPTION 'Invoice % has no company_id assigned for auto counter-reversal', p_invoice_id;
        END IF;

        SELECT id INTO v_ar_id FROM public.chart_of_accounts WHERE company_id = inv.company_id AND code = p_ar_code;
        SELECT id INTO v_rev_id FROM public.chart_of_accounts WHERE company_id = inv.company_id AND code = p_rev_code;
        SELECT id INTO v_tax_id FROM public.chart_of_accounts WHERE company_id = inv.company_id AND code = p_tax_code;

        IF v_ar_id IS NULL OR v_rev_id IS NULL THEN
            RAISE EXCEPTION 'Required COA accounts (% / %) not found for company %', p_ar_code, p_rev_code, inv.company_id;
        END IF;
        IF v_tax <> 0 AND v_tax_id IS NULL THEN
            RAISE EXCEPTION 'Required tax COA account (%) not found for company %', p_tax_code, inv.company_id;
        END IF;

        INSERT INTO public.rcrd (company_id, source_type, transaction_date, transaction_description, transaction_amount, transaction_note)
        VALUES (inv.company_id, 'ADJUSTMENT', p_cancel_date, 'Reversal: Invoice ' || v_inv_no, v_total, p_reason)
        RETURNING id INTO v_rcrd_id;

        -- Debit: Sales Revenue (reverses original credit)
        INSERT INTO public.rcrd_clsf (id_transaction_record, type, account_id, amount, reference_model, reference_model_id)
        VALUES (v_rcrd_id, 'DEBIT', v_rev_id, v_subtotal, 'invoice', inv.id);

        -- Debit: PPN Keluaran (reverses tax liability)
        IF v_tax > 0 THEN
            INSERT INTO public.rcrd_clsf (id_transaction_record, type, account_id, amount, reference_model, reference_model_id)
            VALUES (v_rcrd_id, 'DEBIT', v_tax_id, v_tax, 'invoice', inv.id);
        ELSIF v_tax < 0 THEN
            INSERT INTO public.rcrd_clsf (id_transaction_record, type, account_id, amount, reference_model, reference_model_id)
            VALUES (v_rcrd_id, 'CREDIT', v_tax_id, ABS(v_tax), 'invoice', inv.id);
        END IF;

        -- Credit: Accounts Receivable (wipes out customer balance)
        INSERT INTO public.rcrd_clsf (id_transaction_record, type, account_id, amount, reference_model, reference_model_id)
        VALUES (v_rcrd_id, 'CREDIT', v_ar_id, v_total, 'invoice', inv.id);
    END IF;

    RETURN v_rcrd_id;
END;
$$ LANGUAGE plpgsql;

-- C. Single-CSV Batch Staging Processor (Groups by group_no, supports labeled, unlabeled, and unequal draft entries)
DROP FUNCTION IF EXISTS public.process_csv_batch(TEXT, VARCHAR);
CREATE OR REPLACE FUNCTION public.process_csv_batch(
    p_company_id TEXT,
    p_batch_tag VARCHAR,
    p_allow_drafts BOOLEAN DEFAULT true
)
RETURNS VOID AS $$
DECLARE
    grp RECORD;
    line RECORD;
    v_rcrd_id TEXT;
    v_bank_id TEXT;
    v_account_id TEXT;
    v_ref_id TEXT;
    v_total_dr NUMERIC(15, 2);
    v_total_cr NUMERIC(15, 2);
    v_labeled_lines INTEGER;
    v_max_amount NUMERIC(15, 2);
    v_header_amount NUMERIC(15, 2);
BEGIN
    FOR grp IN
        SELECT DISTINCT ON (group_no)
               group_no, rcrd_id, transaction_date, COALESCE(NULLIF(TRIM(source_type), ''), 'BCA1') AS source_type, bank_code, description, note
        FROM public.csv_import_batches
        WHERE company_id = p_company_id AND batch_tag = p_batch_tag
        ORDER BY group_no
    LOOP
        SELECT
            COALESCE(SUM(CASE WHEN type = 'DEBIT' AND NULLIF(TRIM(COALESCE(account_code, '')), '') IS NOT NULL THEN amount ELSE 0 END), 0),
            COALESCE(SUM(CASE WHEN type = 'CREDIT' AND NULLIF(TRIM(COALESCE(account_code, '')), '') IS NOT NULL THEN amount ELSE 0 END), 0),
            COUNT(*) FILTER (WHERE NULLIF(TRIM(COALESCE(account_code, '')), '') IS NOT NULL AND type IN ('DEBIT', 'CREDIT')),
            COALESCE(MAX(amount), 0)
        INTO v_total_dr, v_total_cr, v_labeled_lines, v_max_amount
        FROM public.csv_import_batches
        WHERE company_id = p_company_id AND batch_tag = p_batch_tag AND group_no = grp.group_no;

        IF NOT p_allow_drafts AND (v_labeled_lines < 2 OR v_total_dr <> v_total_cr) THEN
            RAISE EXCEPTION 'Group % is unlabeled or unbalanced: Debit (%) != Credit (%)', grp.group_no, v_total_dr, v_total_cr;
        END IF;

        IF v_labeled_lines = 0 THEN
            v_header_amount := v_max_amount;
        ELSE
            v_header_amount := GREATEST(v_total_dr, v_total_cr);
        END IF;

        v_bank_id := NULL;
        IF grp.bank_code IS NOT NULL AND TRIM(grp.bank_code) <> '' THEN
            SELECT id INTO v_bank_id FROM public.chart_of_accounts
            WHERE company_id = p_company_id AND code = TRIM(grp.bank_code);
        END IF;

        IF grp.rcrd_id IS NULL OR TRIM(grp.rcrd_id) = '' THEN
            INSERT INTO public.rcrd (company_id, source_type, bank_account_id, transaction_date, transaction_description, transaction_amount, transaction_note)
            VALUES (p_company_id, grp.source_type, v_bank_id, grp.transaction_date, grp.description, v_header_amount, grp.note)
            RETURNING id INTO v_rcrd_id;
        ELSE
            UPDATE public.rcrd SET
                source_type = grp.source_type,
                bank_account_id = v_bank_id,
                transaction_date = grp.transaction_date,
                transaction_description = grp.description,
                transaction_amount = v_header_amount,
                transaction_note = grp.note
            WHERE id = TRIM(grp.rcrd_id) AND company_id = p_company_id
            RETURNING id INTO v_rcrd_id;

            IF v_rcrd_id IS NULL THEN
                INSERT INTO public.rcrd (id, company_id, source_type, bank_account_id, transaction_date, transaction_description, transaction_amount, transaction_note)
                VALUES (TRIM(grp.rcrd_id), p_company_id, grp.source_type, v_bank_id, grp.transaction_date, grp.description, v_header_amount, grp.note)
                RETURNING id INTO v_rcrd_id;
            ELSE
                DELETE FROM public.rcrd_clsf WHERE id_transaction_record = v_rcrd_id;
            END IF;
        END IF;

        FOR line IN
            SELECT * FROM public.csv_import_batches
            WHERE company_id = p_company_id AND batch_tag = p_batch_tag AND group_no = grp.group_no
        LOOP
            IF NULLIF(TRIM(COALESCE(line.account_code, '')), '') IS NULL OR line.type IS NULL THEN
                CONTINUE;
            END IF;

            SELECT id INTO v_account_id FROM public.chart_of_accounts
            WHERE company_id = p_company_id AND code = TRIM(line.account_code);

            IF v_account_id IS NULL THEN
                RAISE EXCEPTION 'Account code % not found in group %', line.account_code, grp.group_no;
            END IF;

            v_ref_id := NULL;
            IF LOWER(COALESCE(line.ref_model, '')) = 'invoice' AND line.ref_number IS NOT NULL AND TRIM(line.ref_number) <> '' THEN
                SELECT id INTO v_ref_id FROM public.invoices
                WHERE (company_id = p_company_id OR company_id IS NULL)
                  AND (invoice_number = TRIM(line.ref_number) OR id = TRIM(line.ref_number))
                LIMIT 1;
            ELSIF line.ref_number IS NOT NULL AND TRIM(line.ref_number) <> '' THEN
                v_ref_id := TRIM(line.ref_number);
            END IF;

            INSERT INTO public.rcrd_clsf (id_transaction_record, type, account_id, amount, reference_model, reference_model_id)
            VALUES (v_rcrd_id, line.type, v_account_id, line.amount, NULLIF(TRIM(COALESCE(line.ref_model, '')), ''), v_ref_id);
        END LOOP;
    END LOOP;

    DELETE FROM public.csv_import_batches WHERE company_id = p_company_id AND batch_tag = p_batch_tag;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Enable Row Level Security (RLS) on all tables
-- Server routes verify Supabase Auth JWT and enforce role-based access control.
-- ============================================================================
ALTER TABLE public.logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pickup_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.berita_acara ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.certificates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fpl_real ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fpl_doc ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chart_of_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rcrd ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rcrd_clsf ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.csv_import_batches ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- Grants for Supabase PostgREST roles (required alongside RLS)
-- ============================================================================
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL PRIVILEGES ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL PRIVILEGES ON SEQUENCES TO service_role;

-- Policy: Authenticated users can read their own worker profile
DROP POLICY IF EXISTS "Workers can read own profile" ON public.workers;
CREATE POLICY "Workers can read own profile"
  ON public.workers
  FOR SELECT
  TO authenticated
  USING (auth_user_id = auth.uid());

-- Refresh Supabase PostgREST API schema cache so newly added columns take effect immediately
NOTIFY pgrst, 'reload schema';

