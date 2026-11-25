import React, { useEffect, useMemo, useState } from 'react';
import {
  Ban,
  Check,
  Edit3,
  ExternalLink,
  Eye,
  FilePlus2,
  FileText,
  History,
  Plus,
  Printer,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import {
  api,
  formatIDR,
  formatStatusLabel,
  statusTextClass,
} from '../lib/api.ts';
import { useFeedback } from '../lib/feedback.tsx';
import { useNavigation } from '../lib/navigation.tsx';
import {
  DATA_TYPE_OPTIONS as STANDARD_DATA_TYPE_OPTIONS,
  JENIS_INVOICE_OPTIONS,
  KEMASAN_OPTIONS,
  UNIT_OPTIONS,
  isCanceledStatus,
  isPickupDataType,
} from '../shared/appOptions.ts';
import {
  ENTITY_META,
  canMutateEntity,
  formatDatePeriodLabel,
} from '../shared/entityMeta.ts';
import { rankBySimilarity } from '../shared/fuzzySearch.ts';
import { previewIdFormat } from '../shared/idGenerator.ts';
import type {
  AnyEntityRecord,
  BeritaAcaraRecord,
  CancelInvoiceResponse,
  CertificateRecord,
  CustomerRecord,
  DocumentAdjustment,
  DocumentEntityKey,
  FplDocRecord,
  FplRealRecord,
  InvoiceRecord,
  ItemRecord,
  LimbahDataType,
  PickupDataRecord,
  PurchaseOrderRecord,
  WorkerRecord,
} from '../shared/types.ts';
import { CancelInvoiceModal } from './CancelInvoiceModal.tsx';
import { DocumentPreviewSheet } from './DocumentPreviewSheet.tsx';
import { ReferencePickerField } from './ReferencePickerField.tsx';
import { LayerSkeleton } from './Skeleton.tsx';

interface DocumentWorkspaceLayerProps {
  entity: DocumentEntityKey;
  mode: 'create' | 'edit' | 'inspect';
  recordId?: string;
  worker: WorkerRecord;
}

const DATA_REF_KEY: Record<
  Exclude<DocumentEntityKey, 'certificates'>,
  'inv_id' | 'ba_id' | 'fpl_real_id' | 'fpl_doc_id' | 'po_id'
> = {
  invoices: 'inv_id',
  berita_acara: 'ba_id',
  fpl_real: 'fpl_real_id',
  fpl_doc: 'fpl_doc_id',
  purchase_orders: 'po_id',
};

const PICKUP_ONLY_ENTITIES = new Set<DocumentEntityKey>([
  'berita_acara',
  'fpl_real',
  'fpl_doc',
]);

const FINANCIAL_DOC_ENTITIES = new Set<DocumentEntityKey>([
  'invoices',
  'fpl_real',
  'fpl_doc',
  'purchase_orders',
]);

const DATA_TYPE_OPTIONS = STANDARD_DATA_TYPE_OPTIONS;

export function DocumentWorkspaceLayer({
  entity,
  mode,
  recordId,
  worker,
}: DocumentWorkspaceLayerProps) {
  const {
    openLayer,
    replaceTopLayer,
    popLayer,
    closeAllLayers,
    navigatePage,
    notifyDataChanged,
    setAccountingPrefill,
    dataVersion,
  } = useNavigation();
  const { notifySuccess, notifyError } = useFeedback();

  const meta = ENTITY_META[entity];
  const isCertificate = entity === 'certificates';
  const isPickupOnly = PICKUP_ONLY_ENTITIES.has(entity);
  const isFinancial = FINANCIAL_DOC_ENTITIES.has(entity);
  const isFpl = entity === 'fpl_real' || entity === 'fpl_doc';
  const isInspect = mode === 'inspect';

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'workspace' | 'preview'>('workspace');

  // Reference catalogs
  const [customers, setCustomers] = useState<CustomerRecord[]>([]);
  const [items, setItems] = useState<ItemRecord[]>([]);
  const [workers, setWorkers] = useState<WorkerRecord[]>([]);
  const [allDataRows, setAllDataRows] = useState<PickupDataRecord[]>([]);
  const [allBaRows, setAllBaRows] = useState<BeritaAcaraRecord[]>([]);
  const [allCertRows, setAllCertRows] = useState<CertificateRecord[]>([]);

  // Loaded record (edit / inspect)
  const [record, setRecord] = useState<AnyEntityRecord | null>(null);

  // Header form state
  const [customId, setCustomId] = useState('');
  const [clientId, setClientId] = useState('');
  const [datePeriod, setDatePeriod] = useState(
    new Date().toISOString().slice(0, 10)
  );
  const [note, setNote] = useState('');
  const [status, setStatus] = useState('');
  const [jenisInvoice, setJenisInvoice] = useState('');
  const [poNumber, setPoNumber] = useState('');
  const [commissionUserId, setCommissionUserId] = useState('');
  const [commissionAmount, setCommissionAmount] = useState<string>('0');
  const [baCertId, setBaCertId] = useState('');

  // Attached rows (IDs of PickupDataRecord OR BeritaAcaraRecord)
  const [attachedIds, setAttachedIds] = useState<string[]>([]);
  // Borderless adjustments (VAT/PPN, PPh, discounts, etc.)
  const [adjustments, setAdjustments] = useState<DocumentAdjustment[]>([]);

  // Picker & inline Limbah Data creator state
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSearch, setPickerSearch] = useState('');
  const [pickerSameClientOnly, setPickerSameClientOnly] = useState(false);
  const [inlineCreateOpen, setInlineCreateOpen] = useState(false);
  const [creatingInline, setCreatingInline] = useState(false);
  const [inlineForm, setInlineForm] = useState<{
    id_user_model: string;
    id_item_model: string;
    data_type: LimbahDataType;
    kemasan: string;
    data: string;
    manifest_number: string;
    reference_number: string;
    quantity: string;
    unit: string;
    invoice_price: string;
    fpl_price: string;
    final_item_note: string;
    internal_note: string;
  }>({
    id_user_model: '',
    id_item_model: '',
    data_type: 'LB3 Pickup',
    kemasan: '',
    data: '',
    manifest_number: '',
    reference_number: '',
    quantity: '1',
    unit: 'Kg',
    invoice_price: '0',
    fpl_price: '0',
    final_item_note: '',
    internal_note: '',
  });

  // Delete & Invoice Cancel state
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [cancelModalOpen, setCancelModalOpen] = useState(false);

  const customerMap = useMemo(
    () => new Map(customers.map((c) => [c.id, c])),
    [customers]
  );
  const itemMap = useMemo(
    () => new Map(items.map((i) => [i.id, i])),
    [items]
  );
  const workerMap = useMemo(
    () => new Map(workers.map((w) => [w.id, w])),
    [workers]
  );
  const dataMap = useMemo(
    () => new Map(allDataRows.map((d) => [d.id, d])),
    [allDataRows]
  );
  const baMap = useMemo(
    () => new Map(allBaRows.map((b) => [b.id, b])),
    [allBaRows]
  );

  // Load catalogs + record on mount / entity / mode / recordId change
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setConfirmDelete(false);
    setCancelModalOpen(false);
    setPickerOpen(false);
    setInlineCreateOpen(false);

    const loadAll = async () => {
      try {
        const [
          custRes,
          itemRes,
          workerRes,
          dataRes,
          baRes,
          certRes,
          recRes,
        ] = await Promise.all([
          api
            .listRecords<CustomerRecord>('customers', { lookup: true })
            .catch(() => ({ records: [] as CustomerRecord[] })),
          api
            .listRecords<ItemRecord>('items', { lookup: true })
            .catch(() => ({ records: [] as ItemRecord[] })),
          entity === 'invoices'
            ? api
                .listRecords<WorkerRecord>('workers', { lookup: true })
                .catch(() => ({ records: [] as WorkerRecord[] }))
            : Promise.resolve({ records: [] as WorkerRecord[] }),
          api
            .listRecords<PickupDataRecord>('pickup_data', { lookup: true })
            .catch(() => ({ records: [] as PickupDataRecord[] })),
          isCertificate
            ? api
                .listRecords<BeritaAcaraRecord>('berita_acara', { lookup: true })
                .catch(() => ({ records: [] as BeritaAcaraRecord[] }))
            : Promise.resolve({ records: [] as BeritaAcaraRecord[] }),
          entity === 'berita_acara'
            ? api
                .listRecords<CertificateRecord>('certificates', { lookup: true })
                .catch(() => ({ records: [] as CertificateRecord[] }))
            : Promise.resolve({ records: [] as CertificateRecord[] }),
          mode !== 'create' && recordId
            ? api.getRecord(entity, recordId)
            : Promise.resolve(null),
        ]);

        if (!active) return;

        setCustomers(custRes.records);
        setItems(itemRes.records);
        setWorkers(workerRes.records);
        setAllDataRows(dataRes.records);
        setAllBaRows(baRes.records);
        setAllCertRows(certRes.records);

        if (recRes?.record) {
          const r = recRes.record as unknown as Record<string, unknown>;
          setRecord(recRes.record);
          setClientId(String(r.id_user_model || r.client_id || ''));
          setDatePeriod(
            String(
              r.date_period ||
                r.issue_date ||
                r.ba_date ||
                r.issued_date ||
                new Date().toISOString().slice(0, 10)
            ).slice(0, 10)
          );
          setNote(String(r.note || ''));
          setStatus(String(r.status || ''));
          setJenisInvoice(String(r.jenis_invoice || ''));
          setPoNumber(String(r.po_number || ''));
          setCommissionUserId(
            String(r.id_user_comission || r.commission_user_id || '')
          );
          setCommissionAmount(
            String(r.comission_amount ?? r.commission_amount ?? 0)
          );
          setBaCertId(String(r.id_certificate || ''));
          setAdjustments(
            Array.isArray(r.adjustments)
              ? (r.adjustments as DocumentAdjustment[])
              : []
          );
          setAttachedIds((recRes.attachments || []).map((a) => a.id));
        } else {
          const today = new Date().toISOString().slice(0, 10);
          setRecord(null);
          setCustomId('');
          setClientId('');
          setDatePeriod(today);
          setNote('');
          setJenisInvoice('');
          setPoNumber('');
          setCommissionUserId('');
          setCommissionAmount('0');
          setBaCertId('');
          setAttachedIds([]);
          setAdjustments([]);
          setStatus('Draft');
        }
      } catch (err) {
        if (active) {
          setError(
            err instanceof Error ? err.message : 'Failed to load document.'
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    };

    loadAll();
    return () => {
      active = false;
    };
  }, [entity, mode, recordId, isCertificate]);

  // Refresh catalogs on external mutations (e.g. creating a new Client/Item inside pick-ref layer)
  // without wiping unsaved form fields when in create/edit mode.
  useEffect(() => {
    if (dataVersion === 0) return;
    let active = true;
    const refreshBackground = async () => {
      const [custRes, itemRes, workerRes, dataRes, baRes, certRes, recRes] =
        await Promise.all([
          api
            .listRecords<CustomerRecord>('customers', { lookup: true })
            .catch(() => null),
          api
            .listRecords<ItemRecord>('items', { lookup: true })
            .catch(() => null),
          entity === 'invoices'
            ? api
                .listRecords<WorkerRecord>('workers', { lookup: true })
                .catch(() => null)
            : Promise.resolve(null),
          !isCertificate
            ? api
                .listRecords<PickupDataRecord>('pickup_data', { lookup: true })
                .catch(() => null)
            : Promise.resolve(null),
          isCertificate
            ? api
                .listRecords<BeritaAcaraRecord>('berita_acara', { lookup: true })
                .catch(() => null)
            : Promise.resolve(null),
          entity === 'berita_acara'
            ? api
                .listRecords<CertificateRecord>('certificates', { lookup: true })
                .catch(() => null)
            : Promise.resolve(null),
          mode === 'inspect' && recordId
            ? api.getRecord(entity, recordId).catch(() => null)
            : Promise.resolve(null),
        ]);
      if (!active) return;
      if (custRes) setCustomers(custRes.records);
      if (itemRes) setItems(itemRes.records);
      if (workerRes) setWorkers(workerRes.records);
      if (dataRes) setAllDataRows(dataRes.records);
      if (baRes) setAllBaRows(baRes.records);
      if (certRes) setAllCertRows(certRes.records);
      if (recRes?.record && mode === 'inspect') {
        const r = recRes.record as unknown as Record<string, unknown>;
        setRecord(recRes.record);
        setStatus(String(r.status || ''));
        setNote(String(r.note || ''));
        setAttachedIds((recRes.attachments || []).map((a) => a.id));
      }
    };
    refreshBackground();
    return () => {
      active = false;
    };
  }, [dataVersion, entity, mode, recordId, isCertificate]);

  // Keep inline Limbah Data client synced when opening inline creator
  useEffect(() => {
    if (inlineCreateOpen) {
      setInlineForm((prev) => ({
        ...prev,
        id_user_model: prev.id_user_model || clientId,
        data_type: isPickupOnly ? 'LB3 Pickup' : prev.data_type,
      }));
    }
  }, [inlineCreateOpen, clientId, isPickupOnly]);

  const attachedDataRecords = useMemo(() => {
    if (isCertificate) return [];
    return attachedIds
      .map((id) => dataMap.get(id))
      .filter((r): r is PickupDataRecord => Boolean(r));
  }, [attachedIds, dataMap, isCertificate]);

  const attachedBaRecords = useMemo(() => {
    if (!isCertificate) return [];
    return attachedIds
      .map((id) => baMap.get(id))
      .filter((r): r is BeritaAcaraRecord => Boolean(r));
  }, [attachedIds, baMap, isCertificate]);

  // Financial calculations
  const subtotal = useMemo(() => {
    if (!isFinancial) return 0;
    if (attachedDataRecords.length > 0) {
      return attachedDataRecords.reduce((sum, row) => {
        const qty = Number(row.quantity ?? row.weight_kg ?? 0);
        const unitPrice = isFpl
          ? Number(row.fpl_price ?? 0)
          : Number(row.invoice_price ?? 0);
        return sum + qty * unitPrice;
      }, 0);
    }
    if (record) {
      const r = record as unknown as Record<string, unknown>;
      return Number(r.subtotal_amount ?? 0);
    }
    return 0;
  }, [isFinancial, attachedDataRecords, isFpl, record]);

  const computedAdjustments = useMemo(
    () =>
      adjustments.map((adj) => {
        const val = Number(adj.value ?? 0);
        const amount =
          adj.type === 'percent'
            ? Math.round(subtotal * (val / 100))
            : Number(adj.value ?? adj.amount ?? 0);
        return { ...adj, value: val, amount };
      }),
    [adjustments, subtotal]
  );

  const adjustmentsSum = useMemo(
    () => computedAdjustments.reduce((sum, a) => sum + Number(a.amount || 0), 0),
    [computedAdjustments]
  );

  const grandTotal = subtotal + adjustmentsSum;

  // Available rows for the picker (unclaimed by any other document of this type),
  // ranked by flexible similarity when searching
  const availableDataForPicker = useMemo(() => {
    if (isCertificate) return [];
    const refCol = DATA_REF_KEY[entity as Exclude<DocumentEntityKey, 'certificates'>];
    const currentSet = new Set(attachedIds);

    const eligible = allDataRows.filter((row) => {
      if (currentSet.has(row.id)) return false;
      const owner = row[refCol];
      if (owner && owner !== recordId) return false;
      if (isPickupOnly && !isPickupDataType(row.data_type)) return false;
      const rowClient = row.id_user_model || row.client_id || '';
      if (pickerSameClientOnly && clientId && rowClient !== clientId) return false;
      return true;
    });

    if (!pickerSearch.trim()) return eligible;
    return rankBySimilarity(eligible, pickerSearch, (row) => {
      const item = itemMap.get(row.id_item_model || row.item_id || '');
      const cust = customerMap.get(row.id_user_model || row.client_id || '');
      return [
        { text: row.id, weight: 1.0 },
        { text: row.manifest_number || '', weight: 1.0 },
        { text: row.reference_number || '', weight: 0.95 },
        { text: item?.item_code || '', weight: 1.0 },
        { text: item?.title || '', weight: 0.95 },
        { text: item?.description || '', weight: 0.85 },
        { text: row.data || '', weight: 0.9 },
        { text: row.final_item_note || '', weight: 0.82 },
        { text: cust?.name || '', weight: 0.88 },
        { text: row.data_type || '', weight: 0.7 },
      ];
    }).map((r) => r.item);
  }, [
    isCertificate,
    entity,
    attachedIds,
    allDataRows,
    recordId,
    isPickupOnly,
    pickerSameClientOnly,
    clientId,
    pickerSearch,
    itemMap,
    customerMap,
  ]);

  const availableBasForPicker = useMemo(() => {
    if (!isCertificate) return [];
    const currentSet = new Set(attachedIds);

    const eligible = allBaRows.filter((ba) => {
      if (currentSet.has(ba.id)) return false;
      if (ba.id_certificate && ba.id_certificate !== recordId) return false;
      const baClient = ba.id_user_model || ba.client_id || '';
      if (pickerSameClientOnly && clientId && baClient !== clientId) return false;
      return true;
    });

    if (!pickerSearch.trim()) return eligible;
    return rankBySimilarity(eligible, pickerSearch, (ba) => {
      const cust = customerMap.get(ba.id_user_model || ba.client_id || '');
      return [
        { text: ba.id, weight: 1.0 },
        { text: cust?.name || '', weight: 0.95 },
        { text: ba.date_period || ba.ba_date || '', weight: 0.85 },
        { text: ba.note || '', weight: 0.8 },
        { text: ba.status || '', weight: 0.6 },
      ];
    }).map((r) => r.item);
  }, [
    isCertificate,
    attachedIds,
    allBaRows,
    recordId,
    pickerSameClientOnly,
    clientId,
    pickerSearch,
    customerMap,
  ]);

  if (loading) return <LayerSkeleton />;

  if (mode !== 'create' && !record) {
    return (
      <div className="p-8">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-800">
          {error || 'Document not found.'}
        </div>
      </div>
    );
  }

  const canEdit =
    canMutateEntity(worker.role, entity) &&
    (worker.role !== 'admin' || !record || record.created_by === worker.id);

  const invoiceRec = entity === 'invoices' ? (record as InvoiceRecord | null) : null;
  const isInvoiceCanceled = Boolean(
    invoiceRec && (invoiceRec.is_canceled || isCanceledStatus(invoiceRec.status))
  );
  const canCancelInvoice = Boolean(
    isInspect &&
      invoiceRec &&
      !isInvoiceCanceled &&
      canEdit &&
      (worker.role === 'master' || worker.role === 'admin')
  );

  // Handlers
  const handleAttachId = (id: string) => {
    setAttachedIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
  };

  const handleDetachId = (id: string) => {
    setAttachedIds((prev) => prev.filter((x) => x !== id));
  };

  const handleAddAdjustment = (
    label = '',
    type: 'percent' | 'fixed' = 'fixed',
    value = 0
  ) => {
    const amount =
      type === 'percent' ? Math.round(subtotal * (value / 100)) : value;
    setAdjustments((prev) => [
      ...prev,
      {
        id: `adj-${Date.now()}-${prev.length + 1}`,
        label,
        type,
        value,
        amount,
      },
    ]);
  };

  const handleUpdateAdjustment = (
    idx: number,
    patch: Partial<DocumentAdjustment>
  ) => {
    setAdjustments((prev) =>
      prev.map((adj, i) => {
        if (i !== idx) return adj;
        const merged = { ...adj, ...patch };
        const val = Number(merged.value ?? 0);
        merged.amount =
          merged.type === 'percent' ? Math.round(subtotal * (val / 100)) : val;
        return merged;
      })
    );
  };

  const handleRemoveAdjustment = (idx: number) => {
    setAdjustments((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleInlineItemChange = (
    newItemId: string,
    pickedRecord?: AnyEntityRecord | null
  ) => {
    const selectedItem =
      (pickedRecord as ItemRecord | null | undefined) || itemMap.get(newItemId);
    if (pickedRecord && !itemMap.has(pickedRecord.id)) {
      setItems((prev) => [pickedRecord as ItemRecord, ...prev]);
    }
    setInlineForm((prev) => ({
      ...prev,
      id_item_model: newItemId,
      unit: selectedItem?.unit || prev.unit || 'Kg',
      kemasan: selectedItem?.kemasan || prev.kemasan || '',
      final_item_note: selectedItem?.item_note || prev.final_item_note,
    }));
  };

  const handleCreateInlineData = async () => {
    if (!inlineForm.id_user_model) {
      notifyError('Please select a Client for the new Limbah Data row.');
      return;
    }
    if (!inlineForm.id_item_model) {
      notifyError('Please select an Item for the new Limbah Data row.');
      return;
    }
    const qty = Number(inlineForm.quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      notifyError('Quantity must be greater than 0.');
      return;
    }

    setCreatingInline(true);
    try {
      const res = await api.createRecord<PickupDataRecord>('pickup_data', {
        id_user_model: inlineForm.id_user_model,
        id_item_model: inlineForm.id_item_model,
        data_type: isPickupOnly ? 'LB3 Pickup' : inlineForm.data_type,
        kemasan: inlineForm.kemasan || null,
        data: inlineForm.data.trim() || null,
        manifest_number: inlineForm.manifest_number.trim() || null,
        reference_number: inlineForm.reference_number.trim() || null,
        quantity: qty,
        unit: inlineForm.unit.trim() || 'Kg',
        invoice_price: Number(inlineForm.invoice_price || 0),
        fpl_price: Number(inlineForm.fpl_price || 0),
        final_item_note: inlineForm.final_item_note.trim() || null,
        internal_note: inlineForm.internal_note.trim() || null,
      });
      const createdRow = res.record;
      setAllDataRows((prev) => [createdRow, ...prev]);
      setAttachedIds((prev) => [...prev, createdRow.id]);
      setInlineForm({
        id_user_model: clientId,
        id_item_model: '',
        data_type: 'LB3 Pickup',
        kemasan: '',
        data: '',
        manifest_number: '',
        reference_number: '',
        quantity: '1',
        unit: 'Kg',
        invoice_price: '0',
        fpl_price: '0',
        final_item_note: '',
        internal_note: '',
      });
      setInlineCreateOpen(false);
      notifyDataChanged();
      notifySuccess(`Created & attached Limbah Data ${createdRow.id}.`);
    } catch (err) {
      notifyError(
        err instanceof Error ? err.message : 'Failed to create Limbah Data row.'
      );
    } finally {
      setCreatingInline(false);
    }
  };

  const handleSaveDocument = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clientId) {
      setError('Please select a Client (id_user_model).');
      return;
    }
    if (!datePeriod) {
      setError('Please set Date / Period.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        id_user_model: clientId,
        date_period: datePeriod,
        note: note.trim() || null,
        attached_ids: attachedIds,
      };

      if (mode === 'create' && customId.trim()) {
        payload.id = customId.trim();
      }

      if (isFinancial) {
        payload.subtotal_amount = subtotal;
        payload.adjustments = computedAdjustments.filter(
          (a) => a.label.trim() || Number(a.amount || 0) !== 0
        );
        payload.total_amount = grandTotal;
      }

      if (entity === 'invoices') {
        payload.status = status || 'Draft';
        payload.jenis_invoice = jenisInvoice || null;
        payload.id_user_comission = commissionUserId || null;
        payload.comission_amount = Number(commissionAmount || 0);
      } else if (entity === 'purchase_orders') {
        payload.po_number = poNumber.trim() || undefined;
        payload.status = status || 'Draft';
      } else if (entity === 'berita_acara') {
        payload.id_certificate = baCertId || null;
        payload.status = status || 'Draft';
      } else if (entity === 'certificates') {
        payload.status = status || 'Draft';
      } else if (entity === 'fpl_real' || entity === 'fpl_doc') {
        payload.status = status || 'Draft';
      }

      if (mode === 'create') {
        const res = await api.createRecord(entity, payload);
        notifyDataChanged();
        notifySuccess(`${meta.singular} ${res.record.id} created.`);
        replaceTopLayer({
          kind: 'inspect',
          entity,
          recordId: res.record.id,
        });
      } else if (recordId) {
        const res = await api.updateRecord(entity, recordId, payload);
        notifyDataChanged();
        notifySuccess(`${meta.singular} ${res.record.id} updated.`);
        replaceTopLayer({
          kind: 'inspect',
          entity,
          recordId: res.record.id,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save document.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!record) return;
    setDeleting(true);
    setError(null);
    try {
      await api.deleteRecord(entity, record.id);
      notifyDataChanged();
      notifySuccess(`${meta.singular} ${record.id} deleted.`);
      popLayer();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed.');
      setDeleting(false);
    }
  };

  const handleInvoiceCanceled = (res: CancelInvoiceResponse, reason: string) => {
    setCancelModalOpen(false);
    notifyDataChanged();
    if (!res.autoReversed && invoiceRec) {
      setAccountingPrefill({
        refModel: 'invoice',
        refId: invoiceRec.id,
        refLabel: invoiceRec.invoice_number || invoiceRec.id,
        description: `Manual Adjustment: Invoice ${invoiceRec.invoice_number || invoiceRec.id}`,
        note: reason,
        amount: Number(invoiceRec.total_amount ?? invoiceRec.amount ?? 0),
      });
      closeAllLayers();
      navigatePage('/b3/accounting/records');
    }
  };

  const selectedClient = customerMap.get(clientId);
  const selectedCommissionWorker = workerMap.get(commissionUserId);
  const periodLabel = formatDatePeriodLabel(datePeriod);

  // Format data description block (item_code, description, final_item_note) — NEVER internal_note
  const renderDataCellContent = (row: PickupDataRecord) => {
    const item = itemMap.get(row.id_item_model || row.item_id || '');
    return (
      <div className="space-y-0.5 min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          {item?.item_code && (
            <span className="font-mono text-xs font-semibold text-teal-800">
              {item.item_code}
            </span>
          )}
          <span className="text-sm font-medium text-slate-900">
            {item?.title || row.data || row.id}
          </span>
          {row.data_type && row.data_type !== 'pickup' && (
            <span className="text-[11px] text-slate-500 capitalize">
              &middot; {row.data_type}
            </span>
          )}
        </div>
        {item?.description && (
          <p className="text-xs text-slate-600">{item.description}</p>
        )}
        {row.final_item_note && (
          <p className="text-xs text-slate-500 italic">{row.final_item_note}</p>
        )}
        <button
          type="button"
          onClick={() =>
            openLayer({
              kind: 'inspect',
              entity: 'pickup_data',
              recordId: row.id,
            })
          }
          className="inline-flex items-center gap-1 font-mono text-[11px] text-teal-700 hover:underline mt-0.5"
        >
          <span>{row.id}</span>
          <ExternalLink className="w-2.5 h-2.5" />
        </button>
      </div>
    );
  };

  return (
    <form
      onSubmit={handleSaveDocument}
      className="flex flex-col min-h-full bg-[#F8FAFB]"
    >
      {/* Document Top Action / Context Bar */}
      <div className="no-print bg-white border-b border-slate-200 px-6 sm:px-8 py-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <span className="font-display text-sm font-extrabold tracking-wide text-[#2B8FA3]">
            LIMBAHIN
          </span>
          <span className="text-slate-300" aria-hidden="true">
            |
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-display text-base font-bold text-slate-900">
                {meta.singular}
              </span>
              {record?.id && (
                <span className="font-mono text-xs font-semibold text-teal-800">
                  {record.id}
                </span>
              )}
              {periodLabel && (
                <span className="text-xs text-slate-500 font-mono">
                  &middot; Period {periodLabel}
                </span>
              )}
              {status && (
                <span className={`text-xs ${statusTextClass(status)}`}>
                  &middot; {formatStatusLabel(status)}
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              {isCertificate
                ? 'Certificate table links Berita Acara (BA) records — each BA can be attached once.'
                : isPickupOnly
                  ? `Only Limbah Data rows with type "LB3 Pickup" or "LB3 Pickup Details" may be attached to ${meta.singular}. Internal notes stay ERP-only.`
                  : `Supports all Limbah Data types (LB3 Pickup, LB3 Pickup Details, LB3 Data, Logistik). Internal notes stay ERP-only.`}
            </p>
          </div>
        </div>

        {/* View Toggle + Mode Actions */}
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <div className="inline-flex items-center p-0.5 bg-slate-100 border border-slate-200 rounded-lg">
            <button
              type="button"
              onClick={() => setViewMode('workspace')}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                viewMode === 'workspace'
                  ? 'bg-teal-700 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              Workspace
            </button>
            <button
              type="button"
              onClick={() => setViewMode('preview')}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                viewMode === 'preview'
                  ? 'bg-teal-700 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Eye className="w-3.5 h-3.5" />
              Document Preview
            </button>
          </div>

          {viewMode === 'preview' && (
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-teal-800 bg-[#EFF8F8] border border-teal-200 hover:bg-teal-50 rounded-lg transition-colors whitespace-nowrap"
            >
              <Printer className="w-3.5 h-3.5" />
              Print / Save PDF
            </button>
          )}

          {isInspect ? (
            <>
              {canCancelInvoice && (
                <button
                  type="button"
                  onClick={() => setCancelModalOpen(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-amber-800 bg-amber-50 border border-amber-200 hover:bg-amber-100 rounded-lg transition-colors whitespace-nowrap"
                >
                  <Ban className="w-3.5 h-3.5" />
                  Cancel Invoice
                </button>
              )}
              {canEdit && record && (
                <button
                  type="button"
                  onClick={() =>
                    replaceTopLayer({
                      kind: 'edit',
                      entity,
                      recordId: record.id,
                    })
                  }
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg transition-colors whitespace-nowrap"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                  Edit Document
                </button>
              )}
              {canEdit && record && !confirmDelete && (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-700 bg-white border border-red-200 hover:bg-red-50 rounded-lg transition-colors whitespace-nowrap"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Delete
                </button>
              )}
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={popLayer}
                className="px-3.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap"
              >
                <Check className="w-3.5 h-3.5" />
                {submitting
                  ? 'Saving...'
                  : mode === 'create'
                    ? `Create ${meta.singular}`
                    : 'Save Document'}
              </button>
            </>
          )}
        </div>
      </div>

      {viewMode === 'preview' ? (
        <div className="flex-1 p-6 sm:p-8 bg-slate-100/80 overflow-y-auto">
          <DocumentPreviewSheet
            entity={entity}
            documentId={record?.id || customId.trim() || previewIdFormat(entity)}
            datePeriod={datePeriod}
            status={status}
            note={note}
            poNumber={poNumber}
            jenisInvoice={jenisInvoice}
            client={selectedClient ?? null}
            attachedDataRows={attachedDataRecords}
            attachedBaRows={attachedBaRecords}
            allDataRows={allDataRows}
            itemMap={itemMap}
            customerMap={customerMap}
            subtotal={subtotal}
            adjustments={computedAdjustments}
            grandTotal={grandTotal}
          />
        </div>
      ) : (
      /* Main Scrollable Document Sheet */
      <div className="flex-1 p-6 sm:p-8 max-w-[1280px] w-full mx-auto space-y-6">
        {error && (
          <div
            role="alert"
            className="px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800"
          >
            {error}
          </div>
        )}

        {isInvoiceCanceled && invoiceRec && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-xs text-red-900 space-y-1">
            <div className="flex items-center gap-1.5 font-semibold">
              <Ban className="w-4 h-4 text-red-700 shrink-0" />
              <span>Invoice Canceled</span>
            </div>
            {invoiceRec.canceled_at && (
              <p className="font-mono text-[11px] tabular-nums">
                Canceled at:{' '}
                {new Date(invoiceRec.canceled_at).toLocaleString('en-GB')}
              </p>
            )}
            {invoiceRec.cancel_reason && (
              <p>Reason: {invoiceRec.cancel_reason}</p>
            )}
          </div>
        )}

        {confirmDelete && record && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center justify-between gap-4">
            <p className="text-xs text-red-900">
              Permanently delete{' '}
              <span className="font-mono font-semibold">{record.id}</span>?
            </p>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                className="px-3 py-1.5 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-md disabled:opacity-60"
              >
                {deleting ? 'Deleting...' : 'Confirm Delete'}
              </button>
            </div>
          </div>
        )}

        {cancelModalOpen && invoiceRec && (
          <CancelInvoiceModal
            invoice={invoiceRec}
            onClose={() => setCancelModalOpen(false)}
            onCanceled={handleInvoiceCanceled}
          />
        )}

        {/* Section 1: Document Header Metadata Card */}
        <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
          {isInspect ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div>
                <p className="text-xs font-medium text-slate-500">
                  Client (id_user_model)
                </p>
                {selectedClient ? (
                  <button
                    type="button"
                    onClick={() =>
                      openLayer({
                        kind: 'inspect',
                        entity: 'customers',
                        recordId: selectedClient.id,
                      })
                    }
                    className="mt-1 text-left group"
                  >
                    <p className="text-sm font-semibold text-teal-800 group-hover:underline">
                      {selectedClient.name}
                    </p>
                    <p className="text-xs font-mono text-slate-500">
                      {selectedClient.id}
                      {selectedClient.pic_name
                        ? ` · PIC: ${selectedClient.pic_name}`
                        : ''}
                    </p>
                    {selectedClient.address && (
                      <p className="text-xs text-slate-500 mt-0.5">
                        {selectedClient.address}
                      </p>
                    )}
                  </button>
                ) : (
                  <p className="mt-1 text-sm font-mono text-slate-700">
                    {clientId || '—'}
                  </p>
                )}
              </div>

              <div>
                <p className="text-xs font-medium text-slate-500">
                  Date &amp; Period (date_period)
                </p>
                <p className="mt-1 font-mono text-sm font-semibold text-slate-900 tabular-nums">
                  {datePeriod || '—'}
                </p>
                {periodLabel && (
                  <p className="text-xs text-teal-700 mt-0.5">
                    Billing / Sign Period: {periodLabel}
                  </p>
                )}
                {entity === 'berita_acara' && baCertId && (
                  <p className="text-xs text-slate-600 mt-2">
                    Certificate:{' '}
                    <button
                      type="button"
                      onClick={() =>
                        openLayer({
                          kind: 'inspect',
                          entity: 'certificates',
                          recordId: baCertId,
                        })
                      }
                      className="font-mono font-semibold text-teal-700 hover:underline"
                    >
                      {baCertId}
                    </button>
                  </p>
                )}
              </div>

              <div>
                {entity === 'invoices' ? (
                  <div className="space-y-1.5">
                    <p className="text-xs font-medium text-slate-500">
                      Sales Commission
                    </p>
                    <p className="text-sm text-slate-900">
                      {selectedCommissionWorker ? (
                        <button
                          type="button"
                          onClick={() =>
                            openLayer({
                              kind: 'inspect',
                              entity: 'workers',
                              recordId: selectedCommissionWorker.id,
                            })
                          }
                          className="text-teal-700 hover:underline font-medium"
                        >
                          {selectedCommissionWorker.name} (
                          <span className="font-mono text-xs">
                            {selectedCommissionWorker.id}
                          </span>
                          )
                        </button>
                      ) : (
                        <span className="text-slate-400">No commission user</span>
                      )}
                    </p>
                    <p className="font-mono text-xs text-slate-700 tabular-nums">
                      Amount: {formatIDR(Number(commissionAmount || 0))}
                    </p>
                  </div>
                ) : entity === 'purchase_orders' ? (
                  <div>
                    <p className="text-xs font-medium text-slate-500">
                      PO Number
                    </p>
                    <p className="mt-1 font-mono text-sm font-semibold text-slate-900">
                      {poNumber || record?.id}
                    </p>
                  </div>
                ) : (
                  <div>
                    <p className="text-xs font-medium text-slate-500">
                      Document Note
                    </p>
                    <p className="mt-1 text-sm text-slate-700">
                      {note || <span className="text-slate-400">No note</span>}
                    </p>
                  </div>
                )}
              </div>

              {(entity === 'invoices' || entity === 'purchase_orders') && note && (
                <div className="md:col-span-3 pt-4 border-t border-slate-100">
                  <p className="text-xs font-medium text-slate-500">
                    Document Note
                  </p>
                  <p className="mt-1 text-sm text-slate-700 whitespace-pre-wrap">
                    {note}
                  </p>
                </div>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {mode === 'create' && (
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">
                    Custom ID{' '}
                    <span className="text-slate-400 font-normal">(optional)</span>
                  </label>
                  <input
                    type="text"
                    value={customId}
                    onChange={(e) => setCustomId(e.target.value)}
                    placeholder={previewIdFormat(entity)}
                    className="w-full px-3 py-2 text-sm font-mono bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600/30 focus:border-teal-700"
                  />
                </div>
              )}

              <div className={mode === 'create' ? '' : 'lg:col-span-2'}>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Client (id_user_model) *
                </label>
                <ReferencePickerField
                  entity="customers"
                  value={clientId}
                  selectedRecord={selectedClient ?? null}
                  required
                  layerTitle="Select Client"
                  onChangeSingle={(pickedId, pickedRec) => {
                    if (pickedRec && !customerMap.has(pickedRec.id)) {
                      setCustomers((prev) => [pickedRec as CustomerRecord, ...prev]);
                    }
                    setClientId(pickedId);
                  }}
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Date &amp; Period (date_period) *
                </label>
                <input
                  type="date"
                  value={datePeriod}
                  onChange={(e) => setDatePeriod(e.target.value)}
                  required
                  className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600/30 focus:border-teal-700"
                />
                {periodLabel && (
                  <p className="mt-1 text-[11px] text-teal-700 font-medium">
                    Period: {periodLabel}
                  </p>
                )}
              </div>

              {meta.statusField && (
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">
                    Status Dokumen
                  </label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600/30 focus:border-teal-700"
                  >
                    {(
                      meta.fields.find((f) => f.key === 'status')?.options || []
                    ).map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-[10.5px] text-slate-500">
                    Hanya Tersimpan, Cancel, dan Terubah yang dapat dilihat klien.
                  </p>
                </div>
              )}

              {entity === 'invoices' && (
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">
                    Jenis Invoice{' '}
                    <span className="text-slate-400 font-normal">(optional)</span>
                  </label>
                  <select
                    value={jenisInvoice}
                    onChange={(e) => setJenisInvoice(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600/30 focus:border-teal-700"
                  >
                    <option value="">— Pilih Jenis Invoice —</option>
                    {JENIS_INVOICE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {entity === 'purchase_orders' && (
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">
                    PO Number
                  </label>
                  <input
                    type="text"
                    value={poNumber}
                    onChange={(e) => setPoNumber(e.target.value)}
                    placeholder="PO-2026-0881"
                    className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600/30 focus:border-teal-700"
                  />
                </div>
              )}

              {entity === 'berita_acara' && (
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">
                    Certificate Ref{' '}
                    <span className="text-slate-400 font-normal">(optional)</span>
                  </label>
                  <ReferencePickerField
                    entity="certificates"
                    value={baCertId}
                    selectedRecord={allCertRows.find((c) => c.id === baCertId) ?? null}
                    optional
                    layerTitle="Select Certificate"
                    onChangeSingle={(pickedId, pickedRec) => {
                      if (
                        pickedRec &&
                        !allCertRows.some((c) => c.id === pickedRec.id)
                      ) {
                        setAllCertRows((prev) => [
                          pickedRec as CertificateRecord,
                          ...prev,
                        ]);
                      }
                      setBaCertId(pickedId);
                    }}
                  />
                </div>
              )}

              {entity === 'invoices' && (
                <>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1.5">
                      Commission User{' '}
                      <span className="text-slate-400 font-normal">(optional)</span>
                    </label>
                    <ReferencePickerField
                      entity="workers"
                      value={commissionUserId}
                      selectedRecord={selectedCommissionWorker ?? null}
                      optional
                      layerTitle="Select Commission User"
                      onChangeSingle={(pickedId, pickedRec) => {
                        if (pickedRec && !workerMap.has(pickedRec.id)) {
                          setWorkers((prev) => [pickedRec as WorkerRecord, ...prev]);
                        }
                        setCommissionUserId(pickedId);
                      }}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1.5">
                      Commission Amount (IDR)
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={commissionAmount}
                      onChange={(e) => setCommissionAmount(e.target.value)}
                      className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600/30 focus:border-teal-700"
                    />
                  </div>
                </>
              )}

              <div className="md:col-span-2 lg:col-span-4">
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Document Note{' '}
                  <span className="text-slate-400 font-normal">(optional)</span>
                </label>
                <textarea
                  rows={2}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Notes printed on this document (terms, pickup context, remarks)..."
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600/30 focus:border-teal-700"
                />
              </div>
            </div>
          )}
        </section>

        {/* Section 2: Document Line Items Table */}
        <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-display text-sm font-bold text-slate-900">
                {isCertificate
                  ? `Attached Berita Acara (${attachedBaRecords.length})`
                  : `Document Items (${attachedDataRecords.length})`}
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {isCertificate
                  ? 'Each Berita Acara (BA) can be referenced by at most one Certificate.'
                  : isPickupOnly
                    ? 'Showing pickup-type Limbah Data rows attached to this document.'
                    : 'All attached Limbah Data rows (pickup, service, transport, admin, other).'}
              </p>
            </div>

            {!isInspect && (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setPickerOpen((prev) => !prev);
                    setInlineCreateOpen(false);
                  }}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap ${
                    pickerOpen
                      ? 'bg-teal-700 text-white border-teal-700'
                      : 'bg-white text-teal-800 border-teal-300 hover:bg-teal-50'
                  }`}
                >
                  <Plus className="w-3.5 h-3.5" />
                  {isCertificate
                    ? 'Attach Berita Acara'
                    : 'Attach Existing Limbah Data'}
                </button>

                {!isCertificate && (
                  <button
                    type="button"
                    onClick={() => {
                      setInlineCreateOpen((prev) => !prev);
                      setPickerOpen(false);
                    }}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap ${
                      inlineCreateOpen
                        ? 'bg-slate-900 text-white border-slate-900'
                        : 'bg-slate-50 text-slate-800 border-slate-300 hover:bg-slate-100'
                    }`}
                  >
                    <FilePlus2 className="w-3.5 h-3.5" />
                    Insert New Limbah Data
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Picker Drawer (Attach existing unclaimed Limbah Data or BA) */}
          {!isInspect && pickerOpen && (
            <div className="p-5 bg-[#F5FAFA] border-b border-teal-200 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="relative flex-1 min-w-[220px] max-w-md">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="search"
                    value={pickerSearch}
                    onChange={(e) => setPickerSearch(e.target.value)}
                    placeholder={
                      isCertificate
                        ? 'Search unclaimed BA by ID, client, date...'
                        : 'Search unclaimed Limbah Data by ID, manifest, item, client...'
                    }
                    className="w-full pl-8 pr-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600/30 focus:border-teal-700"
                  />
                </div>

                <div className="flex items-center gap-3">
                  {clientId && (
                    <label className="inline-flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={pickerSameClientOnly}
                        onChange={(e) =>
                          setPickerSameClientOnly(e.target.checked)
                        }
                        className="rounded border-slate-300 text-teal-700"
                      />
                      <span>Match document client only</span>
                    </label>
                  )}
                  <button
                    type="button"
                    onClick={() => setPickerOpen(false)}
                    className="text-xs text-slate-500 hover:text-slate-900"
                  >
                    Done
                  </button>
                </div>
              </div>

              <div className="max-h-56 overflow-y-auto bg-white border border-slate-200 rounded-lg divide-y divide-slate-100">
                {isCertificate ? (
                  availableBasForPicker.length === 0 ? (
                    <p className="p-4 text-xs text-slate-500 text-center">
                      No unclaimed Berita Acara records match your filter.
                    </p>
                  ) : (
                    availableBasForPicker.map((ba) => {
                      const cust = customerMap.get(
                        ba.id_user_model || ba.client_id || ''
                      );
                      return (
                        <div
                          key={ba.id}
                          className="px-4 py-2.5 flex items-center justify-between gap-3 hover:bg-slate-50"
                        >
                          <div className="min-w-0 text-xs">
                            <span className="font-mono font-semibold text-teal-800">
                              {ba.id}
                            </span>
                            <span className="mx-2 text-slate-300">&middot;</span>
                            <span className="font-medium text-slate-800">
                              {cust?.name || ba.id_user_model}
                            </span>
                            <span className="mx-2 text-slate-300">&middot;</span>
                            <span className="font-mono text-slate-500">
                              {ba.date_period || ba.ba_date}
                            </span>
                            {ba.note && (
                              <p className="text-[11px] text-slate-500 truncate mt-0.5">
                                {ba.note}
                              </p>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => handleAttachId(ba.id)}
                            className="px-2.5 py-1 text-xs font-semibold text-teal-800 bg-[#EFF8F8] border border-teal-200 hover:bg-teal-100 rounded-md shrink-0"
                          >
                            + Add
                          </button>
                        </div>
                      );
                    })
                  )
                ) : availableDataForPicker.length === 0 ? (
                  <p className="p-4 text-xs text-slate-500 text-center">
                    No unclaimed{' '}
                    {isPickupOnly ? 'pickup-type ' : ''}
                    Limbah Data rows available. Use &ldquo;Insert New Limbah
                    Data&rdquo; to create one directly.
                  </p>
                ) : (
                  availableDataForPicker.map((row) => {
                    const item = itemMap.get(
                      row.id_item_model || row.item_id || ''
                    );
                    const cust = customerMap.get(
                      row.id_user_model || row.client_id || ''
                    );
                    const qty = Number(row.quantity ?? row.weight_kg ?? 0);
                    const price = isFpl
                      ? Number(row.fpl_price ?? 0)
                      : Number(row.invoice_price ?? 0);
                    return (
                      <div
                        key={row.id}
                        className="px-4 py-2.5 flex items-center justify-between gap-3 hover:bg-slate-50"
                      >
                        <div className="min-w-0 text-xs">
                          <div className="flex flex-wrap items-center gap-x-2">
                            <span className="font-mono font-semibold text-teal-800">
                              {row.id}
                            </span>
                            <span className="text-slate-500 capitalize">
                              {row.data_type || 'pickup'}
                            </span>
                            {row.manifest_number && (
                              <span className="font-mono text-slate-600">
                                {row.manifest_number}
                              </span>
                            )}
                            <span className="font-medium text-slate-800">
                              {item?.item_code ? `${item.item_code} · ` : ''}
                              {item?.title || row.data || 'Item'}
                            </span>
                            <span className="text-slate-500">
                              ({cust?.name || row.id_user_model})
                            </span>
                          </div>
                          <p className="text-[11px] font-mono text-slate-500 mt-0.5 tabular-nums">
                            {qty.toLocaleString('id-ID')} {row.unit || 'kg'}
                            {isFinancial &&
                              ` · ${formatIDR(price)} / ${row.unit || 'kg'} = ${formatIDR(qty * price)}`}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleAttachId(row.id)}
                          className="px-2.5 py-1 text-xs font-semibold text-teal-800 bg-[#EFF8F8] border border-teal-200 hover:bg-teal-100 rounded-md shrink-0"
                        >
                          + Add
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {/* Inline New Limbah Data Creator */}
          {!isInspect && !isCertificate && inlineCreateOpen && (
            <div className="p-5 bg-slate-50 border-b border-slate-200 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-bold text-slate-900">
                    Insert New Limbah Data Row &amp; Attach to {meta.singular}
                  </h4>
                  <p className="text-[11px] text-slate-500">
                    Selecting an item copies its Item Note into Final Item Note
                    (editable/deletable). Internal Note is ERP-only and never
                    prints on documents.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setInlineCreateOpen(false)}
                  className="p-1 text-slate-400 hover:text-slate-700"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <div>
                  <label className="block text-[11px] font-medium text-slate-700 mb-1">
                    Client *
                  </label>
                  <ReferencePickerField
                    entity="customers"
                    size="sm"
                    value={inlineForm.id_user_model}
                    selectedRecord={customerMap.get(inlineForm.id_user_model) ?? null}
                    layerTitle="Select Client for Limbah Data"
                    onChangeSingle={(pickedId, pickedRec) => {
                      if (pickedRec && !customerMap.has(pickedRec.id)) {
                        setCustomers((prev) => [pickedRec as CustomerRecord, ...prev]);
                      }
                      setInlineForm((p) => ({
                        ...p,
                        id_user_model: pickedId,
                      }));
                    }}
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-slate-700 mb-1">
                    Item (id_item_model) *
                  </label>
                  <ReferencePickerField
                    entity="items"
                    size="sm"
                    value={inlineForm.id_item_model}
                    selectedRecord={itemMap.get(inlineForm.id_item_model) ?? null}
                    layerTitle="Select Item for Limbah Data"
                    onChangeSingle={(pickedId, pickedRec) =>
                      handleInlineItemChange(pickedId, pickedRec)
                    }
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-slate-700 mb-1">
                    Data Type *
                  </label>
                  <select
                    value={isPickupOnly ? 'LB3 Pickup' : inlineForm.data_type}
                    disabled={isPickupOnly}
                    onChange={(e) =>
                      setInlineForm((p) => ({
                        ...p,
                        data_type: e.target.value as LimbahDataType,
                      }))
                    }
                    className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-md disabled:bg-slate-100"
                  >
                    {DATA_TYPE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-slate-700 mb-1">
                    Kemasan
                  </label>
                  <select
                    value={inlineForm.kemasan}
                    onChange={(e) =>
                      setInlineForm((p) => ({
                        ...p,
                        kemasan: e.target.value,
                      }))
                    }
                    className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-md"
                  >
                    <option value="">— Pilih Kemasan —</option>
                    {KEMASAN_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-slate-700 mb-1">
                    Manifest Number
                  </label>
                  <input
                    type="text"
                    value={inlineForm.manifest_number}
                    onChange={(e) =>
                      setInlineForm((p) => ({
                        ...p,
                        manifest_number: e.target.value,
                      }))
                    }
                    placeholder="FESTRONIK-26-..."
                    className="w-full px-2.5 py-1.5 text-xs font-mono bg-white border border-slate-300 rounded-md"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-slate-700 mb-1">
                    Quantity *
                  </label>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    value={inlineForm.quantity}
                    onChange={(e) =>
                      setInlineForm((p) => ({ ...p, quantity: e.target.value }))
                    }
                    className="w-full px-2.5 py-1.5 text-xs font-mono bg-white border border-slate-300 rounded-md"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-slate-700 mb-1">
                    Unit *
                  </label>
                  <select
                    value={inlineForm.unit}
                    onChange={(e) =>
                      setInlineForm((p) => ({ ...p, unit: e.target.value }))
                    }
                    className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-md"
                  >
                    {UNIT_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-slate-700 mb-1">
                    Invoice Unit Price (IDR)
                  </label>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    value={inlineForm.invoice_price}
                    onChange={(e) =>
                      setInlineForm((p) => ({
                        ...p,
                        invoice_price: e.target.value,
                      }))
                    }
                    className="w-full px-2.5 py-1.5 text-xs font-mono bg-white border border-slate-300 rounded-md"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-slate-700 mb-1">
                    FPL Unit Price (IDR)
                  </label>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    value={inlineForm.fpl_price}
                    onChange={(e) =>
                      setInlineForm((p) => ({
                        ...p,
                        fpl_price: e.target.value,
                      }))
                    }
                    className="w-full px-2.5 py-1.5 text-xs font-mono bg-white border border-slate-300 rounded-md"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-[11px] font-medium text-slate-700 mb-1">
                    Final Item Note (printed on documents — editable/deletable)
                  </label>
                  <input
                    type="text"
                    value={inlineForm.final_item_note}
                    onChange={(e) =>
                      setInlineForm((p) => ({
                        ...p,
                        final_item_note: e.target.value,
                      }))
                    }
                    placeholder="Auto-filled from Item Note; edit or clear as needed"
                    className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-md"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-[11px] font-medium text-slate-700 mb-1">
                    Internal Note{' '}
                    <span className="text-amber-700 font-normal">
                      (ERP only — never shown in document)
                    </span>
                  </label>
                  <input
                    type="text"
                    value={inlineForm.internal_note}
                    onChange={(e) =>
                      setInlineForm((p) => ({
                        ...p,
                        internal_note: e.target.value,
                      }))
                    }
                    placeholder="Internal ERP remarks..."
                    className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-md"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setInlineCreateOpen(false)}
                  className="px-3 py-1.5 text-xs font-medium text-slate-600 bg-white border border-slate-200 rounded-md"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleCreateInlineData}
                  disabled={creatingInline}
                  className="px-3.5 py-1.5 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-60 rounded-md"
                >
                  {creatingInline ? 'Saving...' : 'Save & Attach Row'}
                </button>
              </div>
            </div>
          )}

          {/* Actual Document Table per Model Spec */}
          <div className="overflow-x-auto">
            {isCertificate ? (
              /* Certificate Table: Berita Acara rows */
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500">
                    <th className="py-3 px-4 w-12">No.</th>
                    <th className="py-3 px-4">Berita Acara ID</th>
                    <th className="py-3 px-4">Date &amp; Period</th>
                    <th className="py-3 px-4">Client</th>
                    <th className="py-3 px-4">Note</th>
                    <th className="py-3 px-4">Status</th>
                    {!isInspect && <th className="py-3 px-4 w-16 text-right" />}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {attachedBaRecords.map((ba, idx) => {
                    const cust = customerMap.get(
                      ba.id_user_model || ba.client_id || ''
                    );
                    const dp = ba.date_period || ba.ba_date || '';
                    return (
                      <tr key={ba.id} className="hover:bg-slate-50/70">
                        <td className="py-3 px-4 font-mono text-xs text-slate-500 tabular-nums">
                          {idx + 1}
                        </td>
                        <td className="py-3 px-4">
                          <button
                            type="button"
                            onClick={() =>
                              openLayer({
                                kind: 'inspect',
                                entity: 'berita_acara',
                                recordId: ba.id,
                              })
                            }
                            className="inline-flex items-center gap-1 font-mono text-xs font-semibold text-teal-700 hover:underline"
                          >
                            <span>{ba.id}</span>
                            <ExternalLink className="w-3 h-3" />
                          </button>
                        </td>
                        <td className="py-3 px-4 font-mono text-xs text-slate-700 tabular-nums whitespace-nowrap">
                          {dp}{' '}
                          {dp && (
                            <span className="text-slate-400">
                              ({formatDatePeriodLabel(dp)})
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-xs text-slate-800">
                          {cust?.name || ba.id_user_model}
                        </td>
                        <td className="py-3 px-4 text-xs text-slate-600">
                          {ba.note || '—'}
                        </td>
                        <td className="py-3 px-4 text-xs">
                          <span className={statusTextClass(ba.status || 'draft')}>
                            {formatStatusLabel(ba.status || 'draft')}
                          </span>
                        </td>
                        {!isInspect && (
                          <td className="py-3 px-4 text-right">
                            <button
                              type="button"
                              onClick={() => handleDetachId(ba.id)}
                              title="Remove BA from certificate"
                              className="p-1 text-slate-400 hover:text-red-600 rounded"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                  {attachedBaRecords.length === 0 && (
                    <tr>
                      <td
                        colSpan={isInspect ? 6 : 7}
                        className="py-10 px-4 text-center text-xs text-slate-400"
                      >
                        No Berita Acara attached yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            ) : entity === 'berita_acara' ? (
              /* BA Table: No., Data (item code, description, final item note), Quantity, Unit */
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500">
                    <th className="py-3 px-4 w-12">No.</th>
                    <th className="py-3 px-4">
                      Data (Item Code, Description, Final Item Note)
                    </th>
                    <th className="py-3 px-4 text-right whitespace-nowrap">
                      Quantity
                    </th>
                    <th className="py-3 px-4 whitespace-nowrap">Unit</th>
                    {!isInspect && <th className="py-3 px-4 w-16 text-right" />}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {attachedDataRecords.map((row, idx) => (
                    <tr key={row.id} className="hover:bg-slate-50/70 align-top">
                      <td className="py-3 px-4 font-mono text-xs text-slate-500 tabular-nums">
                        {idx + 1}
                      </td>
                      <td className="py-3 px-4">{renderDataCellContent(row)}</td>
                      <td className="py-3 px-4 text-right font-mono text-sm font-medium text-slate-900 tabular-nums whitespace-nowrap">
                        {Number(row.quantity ?? row.weight_kg ?? 0).toLocaleString(
                          'id-ID'
                        )}
                      </td>
                      <td className="py-3 px-4 text-xs font-medium text-slate-700 whitespace-nowrap">
                        {row.unit || 'kg'}
                      </td>
                      {!isInspect && (
                        <td className="py-3 px-4 text-right">
                          <button
                            type="button"
                            onClick={() => handleDetachId(row.id)}
                            title="Remove row from BA"
                            className="p-1 text-slate-400 hover:text-red-600 rounded"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                  {attachedDataRecords.length === 0 && (
                    <tr>
                      <td
                        colSpan={isInspect ? 4 : 5}
                        className="py-10 px-4 text-center text-xs text-slate-400"
                      >
                        No pickup items attached to this Berita Acara yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            ) : isFpl ? (
              /* FPL Real & FPL Doc Table: No., Manifest, Client Name, Nama Item, Kemasan Item, Kode Item, Quantity, Unit, Harga FPL, Jumlah Harga */
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500">
                    <th className="py-3 px-3 w-10">No.</th>
                    <th className="py-3 px-3 whitespace-nowrap">Manifest</th>
                    <th className="py-3 px-3 whitespace-nowrap">
                      Client Name
                    </th>
                    <th className="py-3 px-3 whitespace-nowrap">Nama Item</th>
                    <th className="py-3 px-3 whitespace-nowrap">
                      Kemasan Item
                    </th>
                    <th className="py-3 px-3 whitespace-nowrap">Kode Item</th>
                    <th className="py-3 px-3 text-right whitespace-nowrap">
                      Quantity
                    </th>
                    <th className="py-3 px-3 whitespace-nowrap">Unit</th>
                    <th className="py-3 px-3 text-right whitespace-nowrap">
                      Harga FPL
                    </th>
                    <th className="py-3 px-3 text-right whitespace-nowrap">
                      Jumlah Harga
                    </th>
                    {!isInspect && <th className="py-3 px-3 w-12 text-right" />}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {attachedDataRecords.map((row, idx) => {
                    const item = itemMap.get(
                      row.id_item_model || row.item_id || ''
                    );
                    const cust = customerMap.get(
                      row.id_user_model || row.client_id || ''
                    );
                    const qty = Number(row.quantity ?? row.weight_kg ?? 0);
                    const fplPrice = Number(row.fpl_price ?? 0);
                    const lineTotal = qty * fplPrice;
                    return (
                      <tr
                        key={row.id}
                        className="hover:bg-slate-50/70 align-top text-xs"
                      >
                        <td className="py-3 px-3 font-mono text-slate-500 tabular-nums">
                          {idx + 1}
                        </td>
                        <td className="py-3 px-3 font-mono text-slate-700 whitespace-nowrap">
                          {row.manifest_number || '—'}
                        </td>
                        <td className="py-3 px-3 text-slate-800 font-medium">
                          {cust?.name || row.id_user_model}
                        </td>
                        <td className="py-3 px-3 text-slate-900">
                          <p className="font-medium">
                            {item?.title || item?.name || row.data || '—'}
                          </p>
                          {row.final_item_note && (
                            <p className="text-[11px] text-slate-500 italic mt-0.5">
                              {row.final_item_note}
                            </p>
                          )}
                        </td>
                        <td className="py-3 px-3 text-slate-600">
                          {item?.description || '—'}
                        </td>
                        <td className="py-3 px-3 font-mono font-semibold text-teal-800 whitespace-nowrap">
                          {item?.item_code || item?.code || '—'}
                        </td>
                        <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-900 whitespace-nowrap">
                          {qty.toLocaleString('id-ID')}
                        </td>
                        <td className="py-3 px-3 text-slate-700 whitespace-nowrap">
                          {row.unit || 'kg'}
                        </td>
                        <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-800 whitespace-nowrap">
                          {formatIDR(fplPrice)}
                        </td>
                        <td className="py-3 px-3 text-right font-mono font-semibold tabular-nums text-slate-900 whitespace-nowrap">
                          {formatIDR(lineTotal)}
                        </td>
                        {!isInspect && (
                          <td className="py-3 px-3 text-right">
                            <button
                              type="button"
                              onClick={() => handleDetachId(row.id)}
                              title="Remove row from FPL"
                              className="p-1 text-slate-400 hover:text-red-600 rounded"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                  {attachedDataRecords.length === 0 && (
                    <tr>
                      <td
                        colSpan={isInspect ? 10 : 11}
                        className="py-10 px-4 text-center text-xs text-slate-400"
                      >
                        No pickup Limbah Data rows attached to this{' '}
                        {meta.singular} yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            ) : (
              /* Invoice & Purchase Order Table: No., Data (item code, description, final item note), Qty & Unit, Inv Price, Line Total */
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500">
                    <th className="py-3 px-4 w-12">No.</th>
                    <th className="py-3 px-4">
                      Data (Item Code, Description, Final Item Note)
                    </th>
                    <th className="py-3 px-4 text-right whitespace-nowrap">
                      Qty &amp; Unit
                    </th>
                    <th className="py-3 px-4 text-right whitespace-nowrap">
                      Inv Price
                    </th>
                    <th className="py-3 px-4 text-right whitespace-nowrap">
                      Amount
                    </th>
                    {!isInspect && <th className="py-3 px-4 w-16 text-right" />}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {attachedDataRecords.map((row, idx) => {
                    const qty = Number(row.quantity ?? row.weight_kg ?? 0);
                    const invPrice = Number(row.invoice_price ?? 0);
                    const lineTotal = qty * invPrice;
                    return (
                      <tr
                        key={row.id}
                        className="hover:bg-slate-50/70 align-top"
                      >
                        <td className="py-3 px-4 font-mono text-xs text-slate-500 tabular-nums">
                          {idx + 1}
                        </td>
                        <td className="py-3 px-4">
                          {renderDataCellContent(row)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono text-xs text-slate-800 tabular-nums whitespace-nowrap">
                          {qty.toLocaleString('id-ID')} {row.unit || 'kg'}
                        </td>
                        <td className="py-3 px-4 text-right font-mono text-xs text-slate-800 tabular-nums whitespace-nowrap">
                          {formatIDR(invPrice)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono text-sm font-semibold text-slate-900 tabular-nums whitespace-nowrap">
                          {formatIDR(lineTotal)}
                        </td>
                        {!isInspect && (
                          <td className="py-3 px-4 text-right">
                            <button
                              type="button"
                              onClick={() => handleDetachId(row.id)}
                              title="Remove row"
                              className="p-1 text-slate-400 hover:text-red-600 rounded"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                  {attachedDataRecords.length === 0 && (
                    <tr>
                      <td
                        colSpan={isInspect ? 5 : 6}
                        className="py-10 px-4 text-center text-xs text-slate-400"
                      >
                        No Limbah Data items attached yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </div>

          {/* Financial Summary Block: Subtotal -> Borderless Adjustments Table -> Final Total */}
          {isFinancial && (
            <div className="px-6 py-5 border-t border-slate-200 bg-white flex flex-col items-end">
              <div className="w-full max-w-md space-y-2">
                {/* Subtotal Row */}
                <div className="flex items-center justify-between text-sm text-slate-700 py-1">
                  <span className="font-medium">Subtotal</span>
                  <span className="font-mono font-semibold text-slate-900 tabular-nums">
                    {formatIDR(subtotal)}
                  </span>
                </div>

                {/* Borderless Adjustment Table (VAT / PPN / PPh / Other Adjustments — strictly ZERO borders) */}
                {(computedAdjustments.length > 0 || !isInspect) && (
                  <div className="pt-1">
                    <table className="w-full border-0 border-collapse">
                      <tbody>
                        {computedAdjustments.map((adj, idx) => (
                          <tr key={adj.id || idx} className="border-0">
                            {isInspect ? (
                              <>
                                <td className="border-0 py-1 pr-3 text-xs text-slate-600">
                                  {adj.label}
                                  {adj.type === 'percent' && (
                                    <span className="font-mono text-slate-400 ml-1">
                                      ({adj.value > 0 ? `+${adj.value}` : adj.value}%)
                                    </span>
                                  )}
                                </td>
                                <td className="border-0 py-1 text-right font-mono text-xs text-slate-800 tabular-nums whitespace-nowrap">
                                  {adj.amount < 0 ? '− ' : ''}
                                  {formatIDR(Math.abs(Number(adj.amount || 0)))}
                                </td>
                              </>
                            ) : (
                              <>
                                <td className="border-0 py-1 pr-1.5">
                                  <input
                                    type="text"
                                    value={adj.label}
                                    onChange={(e) =>
                                      handleUpdateAdjustment(idx, {
                                        label: e.target.value,
                                      })
                                    }
                                    placeholder="e.g. VAT / PPN 11%"
                                    className="w-full px-2 py-1 text-xs bg-slate-50 rounded focus:outline-none focus:ring-1 focus:ring-teal-600/40"
                                  />
                                </td>
                                <td className="border-0 py-1 pr-1.5 w-16">
                                  <select
                                    value={adj.type}
                                    onChange={(e) =>
                                      handleUpdateAdjustment(idx, {
                                        type: e.target.value as 'percent' | 'fixed',
                                      })
                                    }
                                    className="w-full px-1.5 py-1 text-xs bg-slate-50 rounded focus:outline-none focus:ring-1 focus:ring-teal-600/40"
                                  >
                                    <option value="percent">%</option>
                                    <option value="fixed">Rp</option>
                                  </select>
                                </td>
                                <td className="border-0 py-1 pr-1.5 w-24">
                                  <input
                                    type="number"
                                    step="any"
                                    value={adj.value}
                                    onChange={(e) =>
                                      handleUpdateAdjustment(idx, {
                                        value: Number(e.target.value || 0),
                                      })
                                    }
                                    className="w-full px-2 py-1 text-xs font-mono text-right bg-slate-50 rounded tabular-nums focus:outline-none focus:ring-1 focus:ring-teal-600/40"
                                  />
                                </td>
                                <td className="border-0 py-1 pr-1 text-right font-mono text-[11px] text-slate-600 tabular-nums whitespace-nowrap">
                                  {adj.amount < 0 ? '−' : ''}
                                  {formatIDR(Math.abs(adj.amount))}
                                </td>
                                <td className="border-0 py-1 w-6 text-right">
                                  <button
                                    type="button"
                                    onClick={() => handleRemoveAdjustment(idx)}
                                    aria-label="Remove adjustment"
                                    className="p-1 text-slate-400 hover:text-red-600"
                                  >
                                    <X className="w-3.5 h-3.5" />
                                  </button>
                                </td>
                              </>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    {!isInspect && (
                      <div className="flex flex-wrap items-center gap-2 pt-2">
                        <button
                          type="button"
                          onClick={() =>
                            handleAddAdjustment('VAT / PPN 11%', 'percent', 11)
                          }
                          className="text-[11px] font-medium text-teal-700 hover:text-teal-900 hover:underline"
                        >
                          + PPN 11%
                        </button>
                        <span className="text-slate-300" aria-hidden="true">
                          &middot;
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            handleAddAdjustment('PPh 23 (-2%)', 'percent', -2)
                          }
                          className="text-[11px] font-medium text-teal-700 hover:text-teal-900 hover:underline"
                        >
                          - PPh 23 (2%)
                        </button>
                        <span className="text-slate-300" aria-hidden="true">
                          &middot;
                        </span>
                        <button
                          type="button"
                          onClick={() => handleAddAdjustment('', 'fixed', 0)}
                          className="text-[11px] font-medium text-slate-600 hover:text-slate-900 hover:underline"
                        >
                          + Custom Adjustment
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* Final Total Row */}
                <div className="flex items-center justify-between pt-3 mt-2 border-t border-slate-200 text-base">
                  <span className="font-display font-bold text-slate-900">
                    {entity === 'invoices'
                      ? 'Invoice Total'
                      : isFpl
                        ? 'FPL Total'
                        : 'PO Total'}
                  </span>
                  <span className="font-mono font-bold text-teal-800 tabular-nums">
                    {formatIDR(grandTotal)}
                  </span>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* Section 3: Signature Date & Audit Log Trail (Inspect Mode) */}
        {isInspect && record && (
          <section className="bg-white border border-slate-200 rounded-xl p-6 flex flex-col sm:flex-row sm:items-end justify-between gap-6">
            <div className="space-y-2 text-xs text-slate-600">
              <p className="font-medium text-slate-500">Audit Trail</p>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <span>
                  Created By:{' '}
                  <span className="font-mono text-slate-800">
                    {record.created_by || 'System'}
                  </span>
                </span>
                <span>
                  Log Create:{' '}
                  {record.id_log_create ? (
                    worker.role === 'master' ? (
                      <button
                        type="button"
                        onClick={() =>
                          openLayer({
                            kind: 'inspect',
                            entity: 'logs',
                            recordId: record.id_log_create!,
                          })
                        }
                        className="inline-flex items-center gap-1 font-mono font-semibold text-teal-700 hover:underline"
                      >
                        <History className="w-3 h-3" />
                        {record.id_log_create}
                      </button>
                    ) : (
                      <span className="font-mono">{record.id_log_create}</span>
                    )
                  ) : (
                    '—'
                  )}
                </span>
                <span>
                  Log Update:{' '}
                  {record.id_log_update ? (
                    worker.role === 'master' ? (
                      <button
                        type="button"
                        onClick={() =>
                          openLayer({
                            kind: 'inspect',
                            entity: 'logs',
                            recordId: record.id_log_update!,
                          })
                        }
                        className="inline-flex items-center gap-1 font-mono font-semibold text-teal-700 hover:underline"
                      >
                        <History className="w-3 h-3" />
                        {record.id_log_update}
                      </button>
                    ) : (
                      <span className="font-mono">{record.id_log_update}</span>
                    )
                  ) : (
                    'Never updated'
                  )}
                </span>
              </div>
            </div>

            <div className="text-left sm:text-right shrink-0">
              <p className="text-xs text-slate-500">
                Signed &amp; Issued Date (date_period)
              </p>
              <p className="mt-1 font-mono text-sm font-semibold text-slate-900 tabular-nums">
                {datePeriod || '—'}
              </p>
              <div className="mt-8 pt-2 border-t border-slate-300 w-48 sm:ml-auto text-center text-[11px] text-slate-500">
                PT Media Cahaya Cerah &middot; LIMBAHIN
              </div>
            </div>
          </section>
        )}
      </div>
      )}
    </form>
  );
}
