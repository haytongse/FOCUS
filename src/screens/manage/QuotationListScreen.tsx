import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  TextInput,
  ScrollView,
  Share,
  Modal,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons as Icon } from '@expo/vector-icons';
import Colors from '../../theme/colors';
import AppText from '../../components/AppText';
import AppBar from '../../components/AppBar';
import AppButton from '../../components/AppButton';
import AppInput from '../../components/AppInput';
import SignaturePad, { SignaturePadRef } from '../../components/SignaturePad';
import { useAlert } from '../../components/AppAlert';
import {
  getQuotationsApi,
  getQuotationApi,
  getAllProductsApi,
  getCampusesApi,
  updateQuotationStatusApi,
  updateQuotationItemsApi,
  convertQuotationsToSOApi,
  updateSalesOrderStatusApi,
  createInvoiceHeaderApi,
  uploadDirectApi,
  uploadSaleOrderSignatureApi,
  ApiQuotation,
  ApiProduct,
  ApiCampus,
} from '../../services/focusApi';
import { generatePDF } from 'react-native-html-to-pdf';
import LOGO_BASE64 from '../../logo/logoBase64';

// ─── PDF constants ────────────────────────────────────────────────────────────
const COMPANY = {
  name:       'FOCUS LAB',
  addr1:      '#17 St 480, Sangkat Toul Toum Pong 1',
  addr2:      'Khan Chamkarmon, Phnom Penh 12310',
  contact:    'SEN Sovithia  ·  0964222816  ·  sen.sov@gmail.com',
  abaAccount: '000 786 988',
  abaHolder:  'SOVITHIA SEN',
};
const A4_PX   = 794;
const A4_H    = 1123;
const ROW_H   = 28;
const THEAD_H = 30;
const NON_TABLE = 420;
const TABLE_H   = A4_H - NON_TABLE;
const MAX_ROWS  = Math.floor((TABLE_H - THEAD_H) / ROW_H) + 3;

const fmtCents = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const fmtDate  = (iso: string) => {
  try {
    const d = new Date(iso);
    return (
      d.toLocaleDateString('en-US', { day: 'numeric', month: 'numeric', year: '2-digit' }) +
      ' ' +
      d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })
    );
  } catch { return iso; }
};

const _arrayBufferToBase64 = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer);
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let result = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i], b1 = bytes[i + 1] ?? 0, b2 = bytes[i + 2] ?? 0;
    result += chars[b0 >> 2];
    result += chars[((b0 & 3) << 4) | (b1 >> 4)];
    result += i + 1 < bytes.length ? chars[((b1 & 15) << 2) | (b2 >> 6)] : '=';
    result += i + 2 < bytes.length ? chars[b2 & 63] : '=';
  }
  return result;
};

const QUOTATION_CSS = `
  @page { size: A4 portrait; margin: 0; }
  *, *::before, *::after {
    margin: 0; padding: 0; box-sizing: border-box;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  html, body { width: ${A4_PX}px; font-family: Arial, Helvetica, sans-serif; font-size: 11px; color: #000; background: #fff; }
  .page {
    position: relative; width: ${A4_PX}px; height: ${A4_H}px;
    padding: 30px 38px 0; overflow: hidden;
    page-break-after: always; break-after: always;
    page-break-inside: avoid; break-inside: avoid;
  }
  .page:last-child { page-break-after: avoid; break-after: avoid; }
  .hdr        { display: flex; align-items: flex-start; margin-bottom: 6px; }
  .hdr-left   { width: 96px; padding-top: 2px; }
  .hdr-center { flex: 1; text-align: center; }
  .hdr-right  { width: 148px; text-align: right; padding-top: 2px; }
  .logo       { width: 88px; height: 88px; border-radius: 12px; overflow: hidden; }
  .logo img   { width: 88px; height: 88px; display: block; }
  .co-name    { font-size: 17px; font-weight: 900; letter-spacing: 3px; text-transform: uppercase; }
  .co-addr    { font-size: 9px; color: #555; line-height: 1.6; margin: 3px 0 6px; }
  .inv-title  { font-size: 20px; font-weight: 900; text-decoration: underline; }
  .aba-label  { font-size: 9px; font-weight: 700; color: #888; text-transform: uppercase; letter-spacing: 0.5px; }
  .aba-num    { font-size: 13px; font-weight: 800; color: #2563EB; margin: 3px 0 2px; }
  .aba-name   { font-size: 10.5px; font-weight: 600; }
  .hr         { border: none; border-top: 1.5px solid #000; margin: 4px 0 5px; }
  .info-row   { display: flex; border: 1px solid #000; margin-bottom: 6px; }
  .info-box   { flex: 1; padding: 5px 10px; line-height: 1.75; font-size: 11px; }
  .info-box + .info-box { border-left: 1px solid #000; }
  b           { font-weight: 700; }
  .tbl-wrap   { border: 1px solid #000; overflow: hidden; }
  table       { width: 100%; border-collapse: collapse; table-layout: fixed; }
  thead tr    { height: ${THEAD_H}px; }
  thead th    {
    background: #efefef; border-bottom: 1.5px solid #000; border-right: 1px solid #000;
    padding: 0 4px; font-size: 11px; font-weight: 700;
    text-align: center; white-space: nowrap; height: ${THEAD_H}px;
  }
  thead th:last-child { border-right: none; }
  tbody tr    { height: ${ROW_H}px; }
  tbody td    { height: ${ROW_H}px; border: 1px solid #d8d8d8; padding: 0 5px; font-size: 10.5px; vertical-align: middle; overflow: hidden; white-space: nowrap; }
  .c { text-align: center; } .r { text-align: right; } .l { text-align: left; }
  .no-badge { display: inline-block; width: 20px; height: 20px; line-height: 20px; border-radius: 4px; background: #EFF6FF; color: #2563EB; font-size: 10px; font-weight: 700; text-align: center; }
  .dash { font-size: 9px; color: #c0c0c0; }
  col.no  { width: 30px; } col.dis { width: 52px; } col.qty { width: 34px; }
  col.pri { width: 68px; } col.amt { width: 72px; }
  .footer   { position: absolute; bottom: 0; left: 0; right: 0; padding: 0 38px 23px; background: #fff; }
  .totals   { border-top: 1.5px solid #000; padding: 5px 2px 10px; }
  .totals-row { display: flex; justify-content: flex-end; align-items: center; font-size: 11px; padding: 2px 0; }
  .totals-lbl { font-weight: 600; padding-right: 20px; min-width: 90px; text-align: right; }
  .totals-val { width: 80px; text-align: right; }
  .totals-disc .totals-val { color: #E53E3E; }
  .totals-grand { border-top: 1px solid #aaa; margin-top: 3px; padding-top: 4px; font-size: 12px; font-weight: 800; }
  .note-box { border: 1px solid #ccc; border-radius: 4px; padding: 8px 10px; font-size: 10px; color: #555; margin-top: 8px; }
`;

const buildQuotationPage = (
  q: ApiQuotation,
  productMap: Record<string, ApiProduct>,
  campusMap: Record<string, ApiCampus>,
): string => {
  const items = (q.items ?? []).map((item, i) => {
    const product      = productMap[item.productId];
    const dis          = item.discountCents ?? 0;
    const lineCents    = item.qty * item.unitPriceCents;
    const totalCents   = lineCents - dis;
    const afterDisc    = item.qty > 0 ? Math.round(totalCents / item.qty) : item.unitPriceCents;
    const disPct       = lineCents > 0 ? ((dis / lineCents) * 100).toFixed(1) : '0';
    return { no: i + 1, description: product?.nameEn ?? product?.sku ?? `Product #${item.productId}`, orinCents: item.unitPriceCents, disPct, qty: item.qty, afterDisc, totalCents };
  });

  const subtotalCents   = items.reduce((s, it) => s + it.qty * it.orinCents, 0);
  const discountCents   = items.reduce((s, it) => s + (it.qty * it.orinCents - it.totalCents), 0);
  const discPct         = subtotalCents > 0 ? ((discountCents / subtotalCents) * 100).toFixed(1) : '0';
  const grandTotalCents = q.totalCents != null ? q.totalCents : subtotalCents - discountCents;

  const campusCode = q.campusId != null ? (campusMap[String(q.campusId)]?.campusCode ?? String(q.campusId)) : '—';
  const refNo      = q.quotationNumber ?? q.quotation_number ?? q.referenceNumber ?? q.ref ?? q.id;

  const fillerCount = Math.max(0, MAX_ROWS - items.length);
  const fillerRows  = Array.from({ length: fillerCount }).map(() =>
    `<tr><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>`).join('');

  const dataRows = items.map(it => `
    <tr>
      <td class="c"><span class="no-badge">${it.no}</span></td>
      <td class="l">${it.description}</td>
      <td class="r">${fmtCents(it.orinCents)}</td>
      <td class="c">${parseFloat(it.disPct) > 0 ? `${it.disPct}%` : '<span class="dash">—</span>'}</td>
      <td class="c">${it.qty}</td>
      <td class="r">${fmtCents(it.afterDisc)}</td>
      <td class="r">${fmtCents(it.totalCents)}</td>
    </tr>`).join('');

  return `
<div class="page">
  <div class="hdr">
    <div class="hdr-left"><div class="logo"><img src="${LOGO_BASE64}" /></div></div>
    <div class="hdr-center">
      <div class="co-name">${COMPANY.name}</div>
      <div class="co-addr">${COMPANY.addr1}<br/>${COMPANY.addr2}<br/>${COMPANY.contact}</div>
      <div class="inv-title">QUOTATION</div>
    </div>
    <div class="hdr-right">
      <div class="aba-label">ABA Account</div>
      <div class="aba-num">${COMPANY.abaAccount}</div>
      <div class="aba-name">${COMPANY.abaHolder}</div>
    </div>
  </div>
  <div class="hr"></div>
  <div class="info-row">
    <div class="info-box"><b>Campus:</b> ${campusCode}<br/><b>Date:</b> ${fmtDate(q.createdAt)}</div>
    <div class="info-box"><b>Ref No:</b> ${refNo}<br/><b>Status:</b> ${q.status ?? ''}</div>
  </div>
  <div class="tbl-wrap">
    <table>
      <colgroup><col class="no"/><col/><col class="pri"/><col class="dis"/><col class="qty"/><col class="pri"/><col class="amt"/></colgroup>
      <thead><tr><th>No</th><th class="l">Description</th><th>Orin Price</th><th>Dis</th><th>Qty</th><th>Price</th><th>Amount</th></tr></thead>
      <tbody>${dataRows}${fillerRows}</tbody>
    </table>
  </div>
  <div class="footer">
    <div class="totals">
      <div class="totals-row"><span class="totals-lbl">Sub Total</span><span class="totals-val">${fmtCents(subtotalCents)}</span></div>
      <div class="totals-row totals-disc"><span class="totals-lbl">Discount${parseFloat(discPct) > 0 ? ` (${discPct}%)` : ''}</span><span class="totals-val">- ${fmtCents(discountCents)}</span></div>
      <div class="totals-row totals-grand"><span class="totals-lbl">Grand Total</span><span class="totals-val">${fmtCents(grandTotalCents)}</span></div>
    </div>
    ${q.note ? `<div class="note-box"><b>Note:</b> ${q.note}</div>` : ''}
  </div>
</div>`;
};

const buildQuotationHTML = (
  quotations: ApiQuotation[],
  productMap: Record<string, ApiProduct>,
  campusMap: Record<string, ApiCampus>,
): string => {
  const pages = quotations.map(q => buildQuotationPage(q, productMap, campusMap)).join('\n');
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"/><style>${QUOTATION_CSS}</style></head><body>${pages}</body></html>`;
};

// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  onBack: () => void;
}

type TabKey = 'all' | 'draft' | 'confirmed' | 'cancelled';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'all',       label: 'All' },
  { key: 'draft',     label: 'Draft' },
  { key: 'confirmed', label: 'Confirmed' },
  { key: 'cancelled', label: 'Cancelled' },
];

const STATUS_COLOR: Record<string, { bg: string; text: string; label: string }> = {
  draft:     { bg: '#FEF3C7', text: '#D97706', label: 'Draft' },
  sent:      { bg: '#DBEAFE', text: '#2563EB', label: 'Sent' },
  confirmed: { bg: '#D1FAE5', text: '#059669', label: 'Confirmed' },
  cancelled: { bg: '#FEE2E2', text: '#EF4444', label: 'Cancelled' },
  converted: { bg: '#EDE9FE', text: '#7C3AED', label: 'Converted' },
};

const ROW_COLORS = ['#2563EB', '#7C3AED', '#10B981', '#F59E0B', '#EF4444', '#06B6D4'];

const calcTotal = (q: ApiQuotation): number => {
  if (q.totalCents != null) return q.totalCents / 100;
  if (!Array.isArray(q.items) || q.items.length === 0) return 0;
  return q.items.reduce(
    (sum, item) => sum + item.qty * item.unitPriceCents - (item.discountCents ?? 0),
    0,
  ) / 100;
};

const formatDate = (iso: string): string => {
  try {
    return new Date(iso).toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch { return iso; }
};

const QuotationListScreen: React.FC<Props> = ({ onBack }) => {
  const { showAlert } = useAlert();
  const [quotations, setQuotations]   = useState<ApiQuotation[]>([]);
  const [campusMap, setCampusMap]     = useState<Record<string, ApiCampus>>({});
  const [loading, setLoading]         = useState(true);
  const [refreshing, setRefreshing]   = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [search, setSearch]           = useState('');
  const [activeTab, setActiveTab]     = useState<TabKey>('all');
  const [selectedIds, setSelectedIds]     = useState<Set<string>>(new Set());
  const [acting, setActing]               = useState(false);
  const [exporting, setExporting]         = useState(false);
  const [statusUpdatingId, setStatusUpdatingId] = useState<string | null>(null);

  // Convert modal
  const [convertModalVisible, setConvertModalVisible] = useState(false);
  const [convertIds, setConvertIds]         = useState<string[]>([]);
  const [convertTarget, setConvertTarget]   = useState<'SO' | 'INV'>('SO');
  const [convertRateUsed, setConvertRateUsed] = useState('4100');
  const [converting, setConverting]         = useState(false);
  const [convertError, setConvertError]     = useState<string | null>(null);
  const [sigUploading, setSigUploading] = useState(false);
  const [sigUploaded, setSigUploaded]   = useState(false);
  const [sigUploadedUrl, setSigUploadedUrl] = useState<string | null>(null);
  const [scrollEnabled, setScrollEnabled]   = useState(true);
  const sigRef    = useRef<SignaturePadRef>(null);
  const scrollRef = useRef<ScrollView>(null);

  // Edit items modal
  type EditItem = { id: string; productId: string; name: string; sku?: string; nameKh?: string; qty: number; unitPriceStr: string; discountPct: string };
  const [editModalVisible, setEditModalVisible]   = useState(false);
  const [editQuotation, setEditQuotation]         = useState<ApiQuotation | null>(null);
  const [editItems, setEditItems]                 = useState<EditItem[]>([]);
  const [editNote, setEditNote]                   = useState('');
  const [editCampusCode, setEditCampusCode]       = useState('');
  const [editCampusName, setEditCampusName]       = useState('');
  const [saving, setSaving]                       = useState(false);
  const [saveError, setSaveError]                 = useState<string | null>(null);

  const load = useCallback((silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    Promise.all([getQuotationsApi(), getCampusesApi().catch(() => [] as ApiCampus[])])
      .then(([quots, campuses]) => {
        setQuotations(quots);
        const cMap: Record<string, ApiCampus> = {};
        campuses.forEach(c => { cMap[String(c.id)] = c; });
        setCampusMap(cMap);
      })
      .catch(err => setError(err?.message ?? 'Failed to load quotations'))
      .finally(() => { setLoading(false); setRefreshing(false); });
  }, []);

  useEffect(() => { load(); }, [load]);

  const onRefresh = () => { setRefreshing(true); load(true); };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return quotations.filter(o => {
      const s = (o.status ?? '').toLowerCase().trim();
      if (activeTab !== 'all') {
        let match = false;
        if (activeTab === 'draft')     match = s === 'draft';
        else if (activeTab === 'confirmed') match = s === 'confirmed';
        else if (activeTab === 'cancelled') match = s === 'cancelled' || s === 'canceled';
        if (!match) return false;
      }
      if (q && !(
        (o.quotationNumber ?? o.quotation_number ?? o.referenceNumber ?? o.ref ?? o.id).toLowerCase().includes(q) ||
        s.includes(q)
      )) return false;
      return true;
    });
  }, [quotations, search, activeTab]);

  const summary = useMemo(() => {
    let draft = 0, confirmed = 0, grandTotal = 0;
    for (const q of quotations) {
      const amt = calcTotal(q);
      const s = (q.status ?? '').toLowerCase();
      grandTotal += amt;
      if (s === 'draft') draft += amt;
      if (s === 'confirmed') confirmed += amt;
    }
    return { draft, confirmed, grandTotal };
  }, [quotations]);

  // True when at least one selected quotation is still in an actionable state
  const hasActionableSelected = useMemo(() => {
    if (selectedIds.size === 0) return false;
    return quotations.some(q => {
      if (!selectedIds.has(q.id)) return false;
      const s = (q.status ?? '').toLowerCase();
      return s !== 'confirmed' && s !== 'cancelled' && s !== 'converted';
    });
  }, [selectedIds, quotations]);

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleCancel = () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    showAlert({
      type: 'confirm',
      title: 'Cancel Quotations',
      message: `Cancel ${ids.length} quotation${ids.length > 1 ? 's' : ''}?`,
      actions: [
        { label: 'Dismiss', variant: 'outline' },
        {
          label: 'Cancel Quotation',
          variant: 'danger',
          onPress: async () => {
            setActing(true);
            let failed = 0;
            for (const id of ids) {
              try { await updateQuotationStatusApi(id, 'cancelled'); }
              catch { failed++; }
            }
            setActing(false);
            setSelectedIds(new Set());
            load(true);
            if (failed > 0) {
              showAlert({ type: 'warning', title: 'Partial Update', message: `${ids.length - failed} cancelled, ${failed} failed.` });
            }
          },
        },
      ],
    });
  };

  const openConvertModal = () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setConvertIds(ids);
    setConvertTarget('SO');
    setConvertError(null);
    setSigUploaded(false);
    setSigUploadedUrl(null);
    setScrollEnabled(true);
    sigRef.current?.clear();
    setConvertModalVisible(true);
  };

  const closeConvertModal = () => {
    setConvertModalVisible(false);
    setConvertIds([]);
    setConvertError(null);
    setSigUploaded(false);
    setSigUploadedUrl(null);
    setScrollEnabled(true);
    sigRef.current?.clear();
  };

  const doConvert = async () => {
    if (sigRef.current?.isEmpty() && !sigUploadedUrl) {
      Alert.alert('Signature Required', 'Please draw a signature before converting.');
      return;
    }
    setConverting(true);
    setConvertError(null);
    try {
      // Confirm all selected quotations first
      await Promise.allSettled(convertIds.map(id => updateQuotationStatusApi(id, 'confirmed')));

      // Convert quotations → SO
      const so = await convertQuotationsToSOApi(convertIds);
      const soId = (so as any)?.id ?? (so as any)?.data?.id;

      // Upload signature once
      let signatureUrl: string | undefined = sigUploadedUrl ?? undefined;
      if (!signatureUrl && !sigRef.current?.isEmpty()) {
        try {
          const png = await sigRef.current!.toPNG();
          signatureUrl = await uploadDirectApi({ uri: png, type: 'image/png', fileName: `sig-quo-${soId ?? Date.now()}.png` });
        } catch {}
      }

      if (convertTarget === 'SO') {
        // ── Convert to Sale Order only ────────────────────────────────────────
        if (soId && signatureUrl) {
          try { await uploadSaleOrderSignatureApi(soId, signatureUrl, 'PREPARE'); } catch {}
        }
        setSelectedIds(new Set());
        closeConvertModal();
        load(true);
        const ref = (so as any)?.referenceNumber ?? (so as any)?.ref ?? soId;
        setTimeout(() => showAlert({
          type: 'success',
          title: 'Converted to SO',
          message: ref ? `Sale Order created: ${ref}` : 'Sale Order created successfully.',
          autoClose: 3000,
        }), 300);

      } else {
        // ── Convert to Invoice ────────────────────────────────────────────────
        if (!soId) throw new Error('Sale order was not created. Cannot invoice.');

        // Move SO to RECEIVED so it can be invoiced
        await updateSalesOrderStatusApi(soId, 'RECEIVED');

        // Resolve customerOrgId + campusId from the first quotation
        const firstQ = quotations.find(q => convertIds.includes(q.id));
        const customerOrgId = (firstQ as any)?.customerOrgId ?? (firstQ as any)?.customerOrg?.id ?? (firstQ as any)?.org?.id;
        const campusId      = (firstQ as any)?.campusId;
        if (!customerOrgId || campusId == null) throw new Error('Could not determine customer or campus from the quotation.');

        const inv = await createInvoiceHeaderApi({
          customerOrgId,
          campusId,
          soIds: [soId],
          rateUsed: Number(convertRateUsed) || 4100,
        });

        if (signatureUrl) {
          try { await uploadSaleOrderSignatureApi(soId, signatureUrl, 'RECEIVED'); } catch {}
        }

        setSelectedIds(new Set());
        closeConvertModal();
        load(true);
        const invRef = inv?.invoiceNumber ?? inv?.id;
        setTimeout(() => showAlert({
          type: 'success',
          title: 'Invoice Created',
          message: invRef ? `Invoice: ${invRef}` : 'Invoice created successfully.',
          autoClose: 3000,
        }), 300);
      }
    } catch (err: any) {
      const msg = err?.message ?? 'Failed to convert quotations';
      setConvertError(msg);
    } finally {
      setConverting(false);
    }
  };

  const openEditModal = async (q: ApiQuotation) => {
    let full = q;
    let productMap: Record<string, ApiProduct> = {};
    try {
      const [detail, products] = await Promise.all([
        getQuotationApi(q.id),
        getAllProductsApi().catch(() => [] as ApiProduct[]),
      ]);
      full = detail;
      products.forEach(p => { productMap[String(p.id)] = p; });
    } catch {}

    const campus = full.campusId != null ? campusMap[String(full.campusId)] : undefined;
    const items: EditItem[] = (full.items ?? []).map(it => {
      const product = productMap[String(it.productId)];
      return {
        id:           String(it.id ?? it.productId),
        productId:    String(it.productId),
        name:         product?.nameEn ?? it.productName ?? it.product?.nameEn ?? it.product?.name ?? `Product #${it.productId}`,
        sku:          product?.sku ?? it.productCode ?? (it.product as any)?.sku ?? undefined,
        nameKh:       product?.nameKm ?? (it as any).productNameKh ?? (it.product as any)?.nameKm ?? undefined,
        qty:          it.qty,
        unitPriceStr: (it.unitPriceCents / 100).toFixed(2),
        discountPct:  it.discountCents && it.qty > 0 && it.unitPriceCents > 0
          ? ((it.discountCents / (it.qty * it.unitPriceCents)) * 100).toFixed(1)
          : '0',
      };
    });
    setEditQuotation(full);
    setEditItems(items);
    setEditNote(full.note ?? '');
    setEditCampusCode(campus?.campusCode ?? (full.campusId != null ? String(full.campusId) : ''));
    setEditCampusName(campus?.nameEn ?? '');
    setSaveError(null);
    setEditModalVisible(true);
  };

  const closeEditModal = () => {
    setEditModalVisible(false);
    setEditQuotation(null);
    setEditItems([]);
    setEditNote('');
    setEditCampusCode('');
    setEditCampusName('');
    setSaveError(null);
  };

  const updateEditItem = (idx: number, patch: Partial<EditItem>) => {
    setEditItems(prev => prev.map((it, i) => i === idx ? { ...it, ...patch } : it));
  };

  const doSaveEdit = async () => {
    if (!editQuotation) return;
    setSaving(true);
    setSaveError(null);
    try {
      const items = editItems.map(it => {
        const unitPriceCents = Math.round((parseFloat(it.unitPriceStr) || 0) * 100);
        const pct            = parseFloat(it.discountPct) || 0;
        const discountCents  = Math.round(it.qty * unitPriceCents * pct / 100);
        return { productId: it.productId, qty: Math.max(1, it.qty), unitPriceCents, discountCents };
      });
      await updateQuotationItemsApi(editQuotation.id, items, editNote.trim() || undefined);
      closeEditModal();
      load(true);
      setTimeout(() => showAlert({ type: 'success', title: 'Saved', message: 'Quotation updated.', autoClose: 2000 }), 300);
    } catch (err: any) {
      setSaveError(err?.message ?? 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleExportPDF = async () => {
    const target = selectedIds.size > 0
      ? quotations.filter(q => selectedIds.has(q.id))
      : quotations;
    if (target.length === 0) {
      showAlert({ type: 'info', title: 'No Quotations', message: 'Nothing to export.' });
      return;
    }
    setExporting(true);
    try {
      const [fullQuotations, products, campuses] = await Promise.all([
        Promise.all(target.map(q => getQuotationApi(q.id).catch(() => q))),
        getAllProductsApi().catch(() => [] as ApiProduct[]),
        getCampusesApi().catch(() => [] as ApiCampus[]),
      ]);
      const productMap: Record<string, ApiProduct> = {};
      products.forEach(p => { productMap[p.id] = p; });
      const campusMap: Record<string, ApiCampus> = {};
      campuses.forEach(c => { campusMap[String(c.id)] = c; });

      for (const q of fullQuotations) {
        const html     = buildQuotationHTML([q], productMap, campusMap);
        const refPart  = q.quotationNumber ?? q.quotation_number ?? q.referenceNumber ?? q.ref ?? q.id;
        const name     = `QUO-${refPart.replace(/[^a-zA-Z0-9]/g, '-')}-${Date.now()}`;
        const result   = await generatePDF({ html, fileName: name, width: 595, height: 842 });
        await Share.share({ url: `file://${result.filePath}`, title: 'Quotation' });
      }
    } catch (err: any) {
      showAlert({ type: 'error', title: 'Export Error', message: err?.message ?? 'Failed to export PDF' });
    } finally {
      setExporting(false);
    }
  };

  const doStatusUpdate = async (id: string, status: string, label: string) => {
    setStatusUpdatingId(id);
    try {
      await updateQuotationStatusApi(id, status);
      load(true);
      setTimeout(() => showAlert({
        type: 'success',
        title: 'Status Updated',
        message: `Quotation ${label.toLowerCase()} successfully.`,
        autoClose: 2000,
      }), 300);
    } catch (err: any) {
      showAlert({ type: 'error', title: 'Update Failed', message: err?.message ?? 'Failed to update status' });
    } finally {
      setStatusUpdatingId(null);
    }
  };

  const handleStatusChange = (id: string, currentStatus: string) => {
    const s = (currentStatus ?? '').toLowerCase();
    const options: { label: string; status: string; variant: 'primary' | 'danger' }[] = [];
    if (s === 'draft')     options.push({ label: 'Confirm',  status: 'confirmed',  variant: 'primary' });
    if (s !== 'cancelled') options.push({ label: 'Cancel',   status: 'cancelled',  variant: 'danger'  });
    if (options.length === 0) return;

    showAlert({
      type: 'confirm',
      title: 'Update Status',
      message: 'Choose a new status for this quotation:',
      actions: [
        { label: 'Dismiss', variant: 'outline' },
        ...options.map(opt => ({
          label: opt.label,
          variant: opt.variant,
          onPress: () => doStatusUpdate(id, opt.status, opt.label),
        })),
      ],
    });
  };

  const subtitle = selectedIds.size > 0
    ? `${selectedIds.size} selected`
    : search || activeTab !== 'all'
    ? `${filtered.length} of ${quotations.length} quotations`
    : quotations.length > 0
    ? `${quotations.length} quotations`
    : 'Quotations';

  const renderItem = ({ item, index }: { item: ApiQuotation; index: number }) => {
    const statusKey = (item.status ?? '').toLowerCase();
    const s = STATUS_COLOR[statusKey] ?? { bg: Colors.divider, text: Colors.textSecondary, label: item.status ?? '' };
    const total = calcTotal(item);
    const ref = item.quotationNumber ?? item.quotation_number ?? item.referenceNumber ?? item.ref ?? item.id;
    const color = ROW_COLORS[index % ROW_COLORS.length];
    const isSelected = selectedIds.has(item.id);
    const isUpdating = statusUpdatingId === item.id;
    const itemCount = Array.isArray(item.items) ? item.items.length : null;

    return (
      <TouchableOpacity
        style={[styles.rowWrap, isSelected && styles.rowSelected]}
        activeOpacity={0.7}
        onPress={() => toggleSelect(item.id)}
      >
        <View style={styles.rowMain}>
          <Icon
            name={isSelected ? 'check-box' : 'check-box-outline-blank'}
            size={22}
            color={isSelected ? Colors.primary : '#C0C0C0'}
          />
          <View style={[styles.indexBox, { backgroundColor: `${color}18` }]}>
            <AppText style={[styles.indexText, { color }]}>{index + 1}</AppText>
          </View>
          <View style={styles.rowBody}>
            <AppText style={styles.ref} numberOfLines={1}>{ref}</AppText>
            <View style={styles.rowMeta}>
              {itemCount !== null ? (
                <View style={styles.metaChip}>
                  <Icon name="inventory-2" size={10} color={Colors.textSecondary} />
                  <AppText style={styles.metaChipText}>{itemCount} item{itemCount !== 1 ? 's' : ''}</AppText>
                </View>
              ) : null}
              <AppText style={styles.date}>{formatDate(item.createdAt)}</AppText>
            </View>
          </View>
          <View style={styles.rowRight}>
            <View style={styles.rowRightTop}>
              <AppText style={styles.amount}>${total.toFixed(2)}</AppText>
              <TouchableOpacity
                style={styles.editBtn}
                onPress={() => openEditModal(item)}
                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              >
                <Icon name="edit" size={14} color={Colors.primary} />
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={[styles.statusBadge, { backgroundColor: s.bg }]}
              onPress={() => !isUpdating && handleStatusChange(item.id, item.status)}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              disabled={isUpdating}
            >
              {isUpdating
                ? <ActivityIndicator size="small" color={s.text} style={{ marginHorizontal: 4 }} />
                : <AppText style={[styles.statusText, { color: s.text }]}>{s.label}</AppText>}
            </TouchableOpacity>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  const headerRight = (
    <TouchableOpacity
      style={[styles.headerExportBtn, exporting && styles.headerExportBtnDisabled]}
      onPress={handleExportPDF}
      disabled={exporting}
      activeOpacity={0.75}
    >
      {exporting
        ? <ActivityIndicator size="small" color="#FFFFFF" />
        : <Icon name="picture-as-pdf" size={19} color="#FFFFFF" />}
      <AppText style={styles.headerExportText}>PDF</AppText>
      {selectedIds.size > 0 && (
        <View style={styles.headerBadge}>
          <AppText style={styles.headerBadgeText}>{selectedIds.size}</AppText>
        </View>
      )}
    </TouchableOpacity>
  );

  return (
    <View style={styles.safe}>
      <AppBar
        title="Quotations"
        subtitle={subtitle}
        titleAlign="left"
        showBack
        onBack={onBack}
        rightActions={headerRight}
      />

      {/* Search */}
      <View style={styles.searchRow}>
        <Icon name="search" size={20} color={Colors.textSecondary} style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search by ref or status..."
          placeholderTextColor={Colors.textLight}
          value={search}
          onChangeText={setSearch}
          returnKeyType="search"
          clearButtonMode="while-editing"
        />
        {search ? (
          <TouchableOpacity onPress={() => setSearch('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Icon name="close" size={18} color={Colors.textSecondary} />
          </TouchableOpacity>
        ) : null}
      </View>

      {/* Status tabs */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tabsRow}
        contentContainerStyle={styles.tabsContent}
      >
        {TABS.map(tab => (
          <TouchableOpacity
            key={tab.key}
            style={[styles.tabPill, activeTab === tab.key && styles.tabPillActive]}
            onPress={() => setActiveTab(tab.key)}
            activeOpacity={0.75}
          >
            <AppText style={[styles.tabLabel, activeTab === tab.key && styles.tabLabelActive]}>
              {tab.label}
            </AppText>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <View style={styles.listArea}>
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={Colors.primary} />
          </View>
        ) : error ? (
          <View style={styles.center}>
            <Icon name="error-outline" size={48} color={Colors.textLight} />
            <AppText variant="body" color="textSecondary" style={styles.centerMsg}>{error}</AppText>
            <TouchableOpacity style={styles.retryBtn} onPress={() => load()}>
              <AppText variant="bodyMedium" color="primary">Retry</AppText>
            </TouchableOpacity>
          </View>
        ) : (
          <FlatList
            data={filtered}
            keyExtractor={item => item.id}
            renderItem={renderItem}
            style={styles.flatList}
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}
            extraData={{ activeTab, selectedIds, statusUpdatingId }}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
            ListEmptyComponent={
              <View style={styles.center}>
                <Icon name={search ? 'search-off' : 'description'} size={48} color={Colors.textLight} />
                <AppText variant="body" color="textSecondary" style={styles.centerMsg}>
                  {search ? `No quotations match "${search}"` : 'No quotations yet'}
                </AppText>
              </View>
            }
          />
        )}
      </View>

      {/* Action bar — shown when items are selected */}
      {hasActionableSelected && (
        <View style={styles.actionBar}>
          <TouchableOpacity
            style={styles.actionBtnDanger}
            onPress={handleCancel}
            disabled={acting}
            activeOpacity={0.8}
          >
            {acting
              ? <ActivityIndicator size="small" color="#FFFFFF" />
              : <Icon name="cancel" size={16} color="#FFFFFF" />}
            <AppText style={styles.actionBtnText}>Cancel</AppText>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.actionBtnPrimary}
            onPress={openConvertModal}
            disabled={acting}
            activeOpacity={0.8}
          >
            {acting
              ? <ActivityIndicator size="small" color="#FFFFFF" />
              : <Icon name="swap-horiz" size={16} color="#FFFFFF" />}
            <AppText style={styles.actionBtnText}>Convert</AppText>
          </TouchableOpacity>
        </View>
      )}

      {/* Summary card */}
      {!loading && !error && (
        <View style={styles.summaryCard}>
          <View style={styles.summaryItem}>
            <View style={[styles.summaryDot, { backgroundColor: '#D97706' }]} />
            <View style={styles.summaryTexts}>
              <AppText style={styles.summaryLabel}>Draft</AppText>
              <AppText style={[styles.summaryAmount, { color: '#D97706' }]}>${summary.draft.toFixed(2)}</AppText>
            </View>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryItem}>
            <View style={[styles.summaryDot, { backgroundColor: '#059669' }]} />
            <View style={styles.summaryTexts}>
              <AppText style={styles.summaryLabel}>Confirmed</AppText>
              <AppText style={[styles.summaryAmount, { color: '#059669' }]}>${summary.confirmed.toFixed(2)}</AppText>
            </View>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryItem}>
            <View style={[styles.summaryDot, { backgroundColor: Colors.text }]} />
            <View style={styles.summaryTexts}>
              <AppText style={styles.summaryLabel}>Total</AppText>
              <AppText style={[styles.summaryAmount, { color: Colors.text }]}>${summary.grandTotal.toFixed(2)}</AppText>
            </View>
          </View>
        </View>
      )}

      {/* ── Edit Quotation Items modal ──────────────────────────────────────── */}
      <Modal
        visible={editModalVisible}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={closeEditModal}
      >
        <SafeAreaView style={cvStyles.safe} edges={['bottom']}>
          <AppBar
            title="Edit Quotation"
            subtitle={editQuotation
              ? (editQuotation.quotationNumber ?? editQuotation.quotation_number ?? editQuotation.referenceNumber ?? editQuotation.ref ?? editQuotation.id)
              : ''}
            titleAlign="left"
            showBack
            onBack={closeEditModal}
          />
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <ScrollView
              style={edStyles.modalScroll}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: 24 }}
            >
              {/* Items card */}
              <AppText style={edStyles.sectionLabel}>Items ({editItems.length})</AppText>
              <View style={edStyles.orderCard}>

                {/* Campus header */}
                {editCampusCode ? (
                  <View style={edStyles.orderCardCampus}>
                    <Icon name="place" size={18} color={Colors.primary} />
                    <AppText style={edStyles.campusCode}>{editCampusCode}</AppText>
                    {editCampusName ? (
                      <AppText style={edStyles.campusName} numberOfLines={1}>{editCampusName}</AppText>
                    ) : null}
                  </View>
                ) : null}
                <View style={edStyles.divider} />

                {editItems.map((it, idx) => {
                  const price       = parseFloat(it.unitPriceStr) || 0;
                  const pct         = parseFloat(it.discountPct) || 0;
                  const subtotal    = it.qty * price;
                  const discount    = subtotal * pct / 100;
                  const lineTotal   = Math.max(0, subtotal - discount);
                  return (
                    <View key={it.id}>
                      {/* Item row */}
                      <View style={edStyles.itemRow}>
                        <View style={edStyles.itemIndex}>
                          <AppText style={edStyles.itemIndexText}>{idx + 1}</AppText>
                        </View>
                        <View style={edStyles.itemNames}>
                          {it.sku ? (
                            <View style={edStyles.skuChip}>
                              <AppText style={edStyles.skuText}>{it.sku}</AppText>
                            </View>
                          ) : null}
                          <AppText style={edStyles.itemName} numberOfLines={2}>{it.name}</AppText>
                          {it.nameKh ? (
                            <AppText style={edStyles.itemNameKh} numberOfLines={1}>{it.nameKh}</AppText>
                          ) : null}
                        </View>
                        <View style={edStyles.itemRight}>
                          {discount > 0 ? (
                            <>
                              <AppText style={edStyles.itemPriceOld}>${subtotal.toFixed(2)}</AppText>
                              <AppText style={edStyles.itemPrice}>${lineTotal.toFixed(2)}</AppText>
                            </>
                          ) : (
                            <AppText style={edStyles.itemPrice}>${subtotal.toFixed(2)}</AppText>
                          )}
                          <AppText style={edStyles.itemUnit}>${price.toFixed(2)} × {it.qty}</AppText>
                        </View>
                      </View>

                      {/* Qty row */}
                      <View style={edStyles.qtyRow}>
                        <View style={edStyles.rowLeft}>
                          <Icon name="format-list-numbered" size={13} color={Colors.primary} />
                          <AppText style={edStyles.qtyLabel}>Qty</AppText>
                        </View>
                        <View style={edStyles.qtyPill}>
                          <TouchableOpacity
                            style={edStyles.qtyBtn}
                            onPress={() => updateEditItem(idx, { qty: Math.max(1, it.qty - 1) })}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          >
                            <Icon name="remove" size={15} color={Colors.primary} />
                          </TouchableOpacity>
                          <TextInput
                            style={edStyles.qtyInput}
                            value={String(it.qty)}
                            onChangeText={v => {
                              const n = parseInt(v, 10);
                              if (!isNaN(n) && n >= 1) updateEditItem(idx, { qty: n });
                            }}
                            keyboardType="number-pad"
                            selectTextOnFocus
                            maxLength={4}
                            returnKeyType="done"
                          />
                          <TouchableOpacity
                            style={edStyles.qtyBtn}
                            onPress={() => updateEditItem(idx, { qty: it.qty + 1 })}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          >
                            <Icon name="add" size={15} color={Colors.primary} />
                          </TouchableOpacity>
                        </View>
                      </View>

                      {/* Unit Price row */}
                      <View style={edStyles.priceRow}>
                        <View style={edStyles.rowLeft}>
                          <Icon name="attach-money" size={13} color={Colors.primary} />
                          <AppText style={edStyles.qtyLabel}>Unit Price</AppText>
                        </View>
                        <View style={edStyles.priceInputWrap}>
                          <AppText style={edStyles.priceDollar}>$</AppText>
                          <TextInput
                            style={edStyles.priceInput}
                            value={it.unitPriceStr}
                            onChangeText={v => updateEditItem(idx, { unitPriceStr: v.replace(/[^0-9.]/g, '') })}
                            onBlur={() => {
                              const n = parseFloat(it.unitPriceStr);
                              updateEditItem(idx, { unitPriceStr: isNaN(n) ? '0.00' : n.toFixed(2) });
                            }}
                            keyboardType="decimal-pad"
                            selectTextOnFocus
                            maxLength={10}
                            returnKeyType="done"
                          />
                        </View>
                      </View>

                      {/* Discount row */}
                      <View style={edStyles.discRow}>
                        <View style={edStyles.rowLeft}>
                          <Icon name="sell" size={13} color="#7C3AED" />
                          <AppText style={edStyles.discLabel}>Discount</AppText>
                        </View>
                        <View style={edStyles.discRight}>
                          <View style={edStyles.discInputWrap}>
                            <TextInput
                              style={edStyles.discInput}
                              value={it.discountPct}
                              onChangeText={v => {
                                const clean = v.replace(/[^0-9.]/g, '');
                                if (parseFloat(clean) > 100) return;
                                updateEditItem(idx, { discountPct: clean });
                              }}
                              keyboardType="decimal-pad"
                              placeholder="0"
                              placeholderTextColor={Colors.textLight}
                              maxLength={5}
                              selectTextOnFocus
                              returnKeyType="done"
                            />
                            <AppText style={edStyles.discPct}>%</AppText>
                          </View>
                          {discount > 0 ? (
                            <AppText style={edStyles.discSaving}>−${discount.toFixed(2)}</AppText>
                          ) : null}
                        </View>
                      </View>

                      {idx < editItems.length - 1 && <View style={edStyles.divider} />}
                    </View>
                  );
                })}

                {/* Totals */}
                {(() => {
                  const subtotal = editItems.reduce((s, it) => s + (parseFloat(it.unitPriceStr)||0) * it.qty, 0);
                  const totalDisc = editItems.reduce((s, it) => {
                    const p = parseFloat(it.unitPriceStr)||0;
                    const d = parseFloat(it.discountPct)||0;
                    return s + it.qty * p * d / 100;
                  }, 0);
                  const grand = Math.max(0, subtotal - totalDisc);
                  return (
                    <>
                      <View style={edStyles.divider} />
                      <View style={edStyles.totalsBox}>
                        <View style={edStyles.totalRow}>
                          <AppText style={edStyles.totalRowLabel}>Subtotal</AppText>
                          <AppText style={edStyles.totalRowValue}>${subtotal.toFixed(2)}</AppText>
                        </View>
                        {totalDisc > 0 && (
                          <View style={edStyles.totalRow}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                              <Icon name="sell" size={13} color="#7C3AED" />
                              <AppText style={edStyles.discTotalLabel}>Total Discount</AppText>
                            </View>
                            <AppText style={edStyles.discTotalValue}>−${totalDisc.toFixed(2)}</AppText>
                          </View>
                        )}
                        <View style={edStyles.divider} />
                        <View style={edStyles.grandRow}>
                          <AppText style={edStyles.grandLabel}>Total</AppText>
                          <AppText style={edStyles.grandValue}>${grand.toFixed(2)}</AppText>
                        </View>
                      </View>
                    </>
                  );
                })()}
              </View>

              {/* Note */}
              <AppText style={edStyles.sectionLabel}>Note (optional)</AppText>
              <View style={edStyles.noteCard}>
                <AppInput
                  label=""
                  value={editNote}
                  onChangeText={setEditNote}
                  placeholder="Add a note to this quotation…"
                  multiline
                  numberOfLines={3}
                />
              </View>
            </ScrollView>
          </KeyboardAvoidingView>

          <View style={cvStyles.submitBar}>
            {saveError ? (
              <View style={cvStyles.errorBox}>
                <Icon name="error-outline" size={16} color={Colors.error} />
                <AppText style={cvStyles.errorText} numberOfLines={2}>{saveError}</AppText>
              </View>
            ) : null}
            <AppButton
              label="Save Changes"
              onPress={() => Alert.alert(
                'Save Changes',
                'Are you sure you want to save the changes to this quotation?',
                [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Save', onPress: doSaveEdit },
                ],
              )}
              variant="primary"
              size="lg"
              fullWidth
              loading={saving}
              disabled={saving}
            />
          </View>
        </SafeAreaView>
      </Modal>

      {/* ── Convert to SO modal with signature ─────────────────────────────── */}
      <Modal
        visible={convertModalVisible}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={closeConvertModal}
      >
        <SafeAreaView style={cvStyles.safe} edges={['bottom']}>
          <AppBar
            title={convertTarget === 'INV' ? 'Convert to Invoice' : 'Convert to Sale Order'}
            subtitle={`${convertIds.length} quotation${convertIds.length !== 1 ? 's' : ''} selected`}
            titleAlign="left"
            showBack
            onBack={closeConvertModal}
          />

          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <ScrollView
              ref={scrollRef}
              style={{ flex: 1, padding: 16 }}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              scrollEnabled={scrollEnabled}
              contentContainerStyle={{ paddingBottom: 24 }}
            >
              {/* Target picker */}
              <View style={cvStyles.targetRow}>
                <TouchableOpacity
                  style={[cvStyles.targetChip, convertTarget === 'SO' && cvStyles.targetChipSO]}
                  onPress={() => setConvertTarget('SO')}
                  activeOpacity={0.8}
                >
                  <Icon name="receipt-long" size={14} color={convertTarget === 'SO' ? '#FFFFFF' : Colors.primary} />
                  <AppText style={[cvStyles.targetChipText, convertTarget === 'SO' && cvStyles.targetChipTextActive]}>
                    Sale Order
                  </AppText>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[cvStyles.targetChip, convertTarget === 'INV' && cvStyles.targetChipINV]}
                  onPress={() => setConvertTarget('INV')}
                  activeOpacity={0.8}
                >
                  <Icon name="request-quote" size={14} color={convertTarget === 'INV' ? '#FFFFFF' : '#7C3AED'} />
                  <AppText style={[cvStyles.targetChipText, convertTarget === 'INV' && cvStyles.targetChipTextActive]}>
                    Invoice
                  </AppText>
                </TouchableOpacity>
              </View>

              {/* Info card */}
              <View style={[cvStyles.infoCard, convertTarget === 'INV' && cvStyles.infoCardInv]}>
                <Icon
                  name={convertTarget === 'INV' ? 'request-quote' : 'swap-horiz'}
                  size={28}
                  color={convertTarget === 'INV' ? '#7C3AED' : Colors.primary}
                />
                <View style={{ flex: 1, gap: 3 }}>
                  <AppText style={cvStyles.infoTitle}>
                    {convertTarget === 'INV' ? 'Convert to Invoice' : 'Confirm Conversion'}
                  </AppText>
                  <AppText style={cvStyles.infoSub}>
                    {convertTarget === 'INV'
                      ? `${convertIds.length} quotation${convertIds.length !== 1 ? 's' : ''} will be converted to a Sale Order and immediately invoiced.`
                      : `${convertIds.length} quotation${convertIds.length !== 1 ? 's' : ''} will be confirmed and merged into a single Sale Order.`}
                  </AppText>
                  {convertTarget === 'INV' ? (
                    <View style={cvStyles.rateRow}>
                      <AppText style={cvStyles.rateLabel}>Exchange Rate (KHR):</AppText>
                      <TextInput
                        style={cvStyles.rateInput}
                        value={convertRateUsed}
                        onChangeText={setConvertRateUsed}
                        keyboardType="numeric"
                        selectTextOnFocus
                        placeholder="4100"
                        placeholderTextColor={Colors.textLight}
                      />
                    </View>
                  ) : null}
                </View>
              </View>

              {/* Signature section */}
              <AppText style={cvStyles.sectionLabel}>
                Signature <AppText style={{ color: Colors.error, fontWeight: '700' }}>*</AppText>
              </AppText>

              <View style={cvStyles.sigCard}>
                {/* Header */}
                <View style={cvStyles.sigHeader}>
                  <View style={cvStyles.sigHeaderLeft}>
                    <Icon name="draw" size={16} color={Colors.primary} />
                    <AppText style={cvStyles.sigHeaderTitle}>Recipient Signature</AppText>
                    <View style={cvStyles.sigRequiredBadge}>
                      <AppText style={cvStyles.sigRequiredText}>Required</AppText>
                    </View>
                  </View>
                  <View style={cvStyles.sigHeaderActions}>
                    <TouchableOpacity
                      style={[cvStyles.sigActionBtn, sigUploaded && cvStyles.sigActionBtnDone]}
                      disabled={sigUploading}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      onPress={async () => {
                        if (sigRef.current?.isEmpty()) {
                          Alert.alert('No Signature', 'Please draw a signature first.');
                          return;
                        }
                        setSigUploading(true);
                        try {
                          const png = await sigRef.current!.toPNG();
                          const url = await uploadDirectApi({ uri: png, type: 'image/png', fileName: 'sig-quo-preview.png' });
                          setSigUploadedUrl(url);
                          setSigUploaded(true);
                        } catch (e: any) {
                          Alert.alert('Upload Failed', e?.message ?? 'Could not upload signature');
                        } finally {
                          setSigUploading(false);
                        }
                      }}
                    >
                      {sigUploading
                        ? <ActivityIndicator size="small" color={sigUploaded ? '#10B981' : Colors.primary} />
                        : <Icon name={sigUploaded ? 'check-circle' : 'cloud-upload'} size={13} color={sigUploaded ? '#10B981' : Colors.primary} />}
                      <AppText style={[cvStyles.sigActionText, sigUploaded && { color: '#10B981' }]}>
                        {sigUploaded ? 'Uploaded' : 'Upload'}
                      </AppText>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={cvStyles.sigActionBtn}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      onPress={() => { sigRef.current?.clear(); setSigUploaded(false); setSigUploadedUrl(null); }}
                    >
                      <Icon name="refresh" size={13} color={Colors.primary} />
                      <AppText style={cvStyles.sigActionText}>Clear</AppText>
                    </TouchableOpacity>
                  </View>
                </View>

                {/* Drawing area */}
                <View style={cvStyles.sigDrawArea}>
                  <SignaturePad
                    ref={sigRef}
                    style={cvStyles.sigPad}
                    onDrawStart={() => setScrollEnabled(false)}
                    onDrawEnd={() => setScrollEnabled(true)}
                  />
                </View>

                {/* Footer */}
                <View style={cvStyles.sigFooter}>
                  <View style={cvStyles.sigFooterLine} />
                  <Icon name="person-outline" size={13} color="#94A3B8" />
                  <AppText style={cvStyles.sigFooterLabel}>Recipient Signature</AppText>
                  <View style={cvStyles.sigFooterLine} />
                </View>
              </View>
            </ScrollView>
          </KeyboardAvoidingView>

          {/* Submit bar */}
          <View style={cvStyles.submitBar}>
            {convertError ? (
              <View style={cvStyles.errorBox}>
                <Icon name="error-outline" size={16} color={Colors.error} />
                <AppText style={cvStyles.errorText} numberOfLines={2}>{convertError}</AppText>
              </View>
            ) : null}
            <AppButton
              label={convertTarget === 'INV' ? 'Convert to Invoice' : 'Convert to Sale Order'}
              onPress={doConvert}
              variant="primary"
              size="lg"
              fullWidth
              loading={converting}
              disabled={converting}
            />
          </View>
        </SafeAreaView>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },

  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    marginHorizontal: 16,
    marginTop: 8,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  searchIcon:  { marginRight: 8 },
  searchInput: { flex: 1, fontSize: 15, color: Colors.text, paddingVertical: 0 },

  tabsRow:     { flexGrow: 0, flexShrink: 0 },
  tabsContent: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 6 },
  tabPill: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    marginRight: 8,
  },
  tabPillActive:  { backgroundColor: Colors.primary, borderColor: Colors.primary },
  tabLabel:       { fontSize: 13, fontWeight: '600', color: Colors.text },
  tabLabelActive: { color: '#FFFFFF' },

  listArea: { flex: 1 },
  flatList: { flex: 1 },
  list:     { paddingBottom: 8 },

  rowWrap: {
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.divider,
  },
  rowMain: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 13,
    gap: 10,
  },
  rowSelected: { backgroundColor: '#EFF6FF' },

  indexBox:  { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  indexText: { fontSize: 14, fontWeight: '800' },
  rowBody:   { flex: 1, gap: 3 },
  ref:       { fontSize: 14, fontWeight: '700', color: Colors.text, letterSpacing: 0.3 },
  rowMeta:   { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 5 },
  metaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: Colors.background,
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  metaChipText: { fontSize: 10, color: Colors.textSecondary },
  date:      { fontSize: 11, color: Colors.textSecondary },
  rowRight:      { alignItems: 'flex-end', gap: 5 },
  rowRightTop:   { flexDirection: 'row', alignItems: 'center', gap: 6 },
  editBtn: {
    width: 26, height: 26, borderRadius: 8,
    backgroundColor: Colors.primaryMuted,
    alignItems: 'center', justifyContent: 'center',
  },
  amount:    { fontSize: 14, fontWeight: '800', color: Colors.primary },
  statusBadge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  statusText:  { fontSize: 11, fontWeight: '700' },

  center:    { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  centerMsg: { textAlign: 'center' },
  retryBtn: {
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: Colors.primary,
  },

  actionBar: {
    flexDirection: 'row',
    gap: 10,
    backgroundColor: Colors.surface,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 6,
  },
  actionBtnDanger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.error,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  actionBtnPrimary: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: Colors.primary,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  actionBtnText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },

  summaryCard: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingVertical: 14,
    paddingHorizontal: 8,
  },
  summaryItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  summaryDot:     { width: 8, height: 8, borderRadius: 4, marginTop: 1 },
  summaryTexts:   { gap: 2 },
  summaryLabel:   { fontSize: 11, color: Colors.textSecondary, fontWeight: '500' },
  summaryAmount:  { fontSize: 15, fontWeight: '800' },
  summaryDivider: { width: 1, backgroundColor: Colors.divider, marginVertical: 4 },

  headerExportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: Colors.primary,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  headerExportBtnDisabled: { opacity: 0.6 },
  headerExportText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
  headerBadge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  headerBadgeText: { fontSize: 10, fontWeight: '800', color: Colors.primary },
});

// ─── Convert modal styles ─────────────────────────────────────────────────────
const cvStyles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },

  targetRow: {
    flexDirection: 'row', gap: 10, marginBottom: 14,
  },
  targetChip: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 10, borderRadius: 10,
    borderWidth: 1.5, borderColor: Colors.border, backgroundColor: Colors.surface,
  },
  targetChipSO:  { borderColor: Colors.primary,  backgroundColor: Colors.primary },
  targetChipINV: { borderColor: '#7C3AED',        backgroundColor: '#7C3AED' },
  targetChipText: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary },
  targetChipTextActive: { color: '#FFFFFF' },

  infoCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    backgroundColor: Colors.surface,
    borderRadius: 14, padding: 16, marginBottom: 20,
    borderWidth: 1, borderColor: Colors.border,
  },
  infoCardInv: { borderColor: '#EDE9FE', backgroundColor: '#FAF5FF' },
  infoTitle: { fontSize: 15, fontWeight: '700', color: Colors.text },
  infoSub:   { fontSize: 13, color: Colors.textSecondary, lineHeight: 18 },
  rateRow:   { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  rateLabel: { fontSize: 12, fontWeight: '600', color: Colors.textSecondary },
  rateInput: {
    borderWidth: 1, borderColor: '#C4B5FD', borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 4,
    fontSize: 14, fontWeight: '700', color: '#7C3AED',
    minWidth: 70, textAlign: 'center', backgroundColor: '#FFFFFF',
  },

  sectionLabel: {
    fontSize: 11, fontWeight: '600', color: Colors.textSecondary,
    textTransform: 'uppercase', letterSpacing: 0.8,
    marginBottom: 8, marginTop: 4,
  },

  sigCard: {
    backgroundColor: Colors.surface, borderRadius: 16,
    borderWidth: 1, borderColor: Colors.border,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 8, elevation: 2,
  },
  sigHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
    backgroundColor: `${Colors.primary}0D`,
    borderBottomWidth: 1, borderBottomColor: `${Colors.primary}22`,
    borderTopLeftRadius: 16, borderTopRightRadius: 16,
  },
  sigHeaderLeft:    { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sigHeaderTitle:   { fontSize: 13, fontWeight: '700', color: Colors.primary },
  sigRequiredBadge: { backgroundColor: '#FEE2E2', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  sigRequiredText:  { fontSize: 10, fontWeight: '700', color: Colors.error },
  sigHeaderActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sigActionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 20, borderWidth: 1,
    borderColor: `${Colors.primary}40`, backgroundColor: Colors.surface,
  },
  sigActionBtnDone: { borderColor: '#10B981', backgroundColor: '#F0FDF4' },
  sigActionText:    { fontSize: 11, fontWeight: '600', color: Colors.primary },
  sigDrawArea:      { borderBottomWidth: 1, borderBottomColor: Colors.border, overflow: 'hidden' },
  sigPad:           { height: 210 },
  sigFooter: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 10, gap: 8, backgroundColor: '#F8FAFC',
    borderBottomLeftRadius: 16, borderBottomRightRadius: 16,
  },
  sigFooterLine:  { flex: 1, height: 1, backgroundColor: '#CBD5E1' },
  sigFooterLabel: { fontSize: 11, color: '#94A3B8', fontWeight: '500', letterSpacing: 0.5 },

  submitBar: {
    padding: 16, paddingBottom: 8,
    borderTopWidth: 1, borderTopColor: Colors.border,
    backgroundColor: Colors.surface, gap: 10,
  },
  errorBox: {
    flexDirection: 'row', alignItems: 'flex-start',
    backgroundColor: '#FEF2F2', borderRadius: 10, padding: 10, gap: 8,
  },
  errorText: { flex: 1, fontSize: 13, color: Colors.error, lineHeight: 18 },
});

// ─── Edit items modal styles (mirrors MenuScreen confirm order) ───────────────
const edStyles = StyleSheet.create({
  modalScroll: { flex: 1, padding: 16 },
  sectionLabel: {
    fontSize: 11, fontWeight: '600', color: Colors.textSecondary,
    textTransform: 'uppercase', letterSpacing: 0.8,
    marginBottom: 8, marginTop: 16,
  },

  orderCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16, borderWidth: 1, borderColor: Colors.border,
    overflow: 'hidden', marginBottom: 4,
  },
  orderCardCampus: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.primaryMuted,
    paddingHorizontal: 16, paddingVertical: 14,
  },
  campusCode: { fontSize: 22, fontWeight: '900', color: Colors.primary, letterSpacing: 1 },
  campusName: { flex: 1, fontSize: 13, color: Colors.textSecondary, fontWeight: '500' },
  divider:    { height: 1, backgroundColor: Colors.divider },

  itemRow: {
    flexDirection: 'row', alignItems: 'flex-start',
    paddingHorizontal: 16, paddingVertical: 12, gap: 10,
  },
  itemIndex: {
    width: 28, height: 28, borderRadius: 8,
    backgroundColor: Colors.primaryMuted,
    alignItems: 'center', justifyContent: 'center', marginTop: 1,
  },
  itemIndexText: { fontSize: 12, fontWeight: '800', color: Colors.primary },
  itemNames:     { flex: 1, gap: 2 },
  skuChip: {
    alignSelf: 'flex-start', backgroundColor: Colors.primaryMuted,
    borderRadius: 5, paddingHorizontal: 7, paddingVertical: 2, marginBottom: 3,
  },
  skuText:       { fontSize: 10, fontWeight: '700', color: Colors.primary, letterSpacing: 0.5 },
  itemName:      { fontSize: 14, fontWeight: '700', color: Colors.text },
  itemNameKh:    { fontSize: 12, color: Colors.textSecondary },
  itemRight:     { alignItems: 'flex-end', gap: 2 },
  itemPrice:     { fontSize: 15, fontWeight: '800', color: Colors.primary },
  itemPriceOld:  { fontSize: 12, color: Colors.textLight, textDecorationLine: 'line-through' },
  itemUnit:      { fontSize: 11, color: Colors.textLight },

  qtyRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: `${Colors.primary}08`, paddingHorizontal: 16, paddingVertical: 8,
  },
  priceRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: `${Colors.primary}05`, paddingHorizontal: 16, paddingVertical: 8,
  },
  rowLeft:   { flexDirection: 'row', alignItems: 'center', gap: 5, flex: 1 },
  qtyLabel:  { fontSize: 12, fontWeight: '600', color: Colors.primary },

  qtyPill: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1.5, borderColor: `${Colors.primary}40`,
    borderRadius: 8, backgroundColor: Colors.white, overflow: 'hidden',
  },
  qtyBtn: {
    width: 32, height: 32, alignItems: 'center', justifyContent: 'center',
    backgroundColor: `${Colors.primary}10`,
  },
  qtyInput: {
    width: 44, height: 32, textAlign: 'center',
    fontSize: 14, fontWeight: '800', color: Colors.primary, padding: 0,
  },

  priceInputWrap: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1, borderColor: Colors.border,
    borderRadius: 8, backgroundColor: Colors.background,
    paddingHorizontal: 10, paddingVertical: 5, minWidth: 110,
  },
  priceDollar: { fontSize: 14, fontWeight: '700', color: Colors.textSecondary, marginRight: 3 },
  priceInput:  { flex: 1, fontSize: 14, fontWeight: '700', color: Colors.text, padding: 0 },

  discRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#F5F3FF', paddingHorizontal: 16, paddingVertical: 8, gap: 8,
  },
  discLabel:    { fontSize: 12, fontWeight: '600', color: '#7C3AED' },
  discRight:    { flexDirection: 'row', alignItems: 'center', gap: 8 },
  discInputWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 2,
    borderWidth: 1, borderColor: '#C4B5FD', borderRadius: 8,
    backgroundColor: '#FFFFFF', paddingHorizontal: 8, paddingVertical: 4,
  },
  discInput: {
    fontSize: 13, fontWeight: '800', color: '#7C3AED',
    padding: 0, minWidth: 30, textAlign: 'right',
  },
  discPct:    { fontSize: 12, fontWeight: '700', color: '#7C3AED' },
  discSaving: { fontSize: 13, fontWeight: '700', color: '#7C3AED' },

  totalsBox:      { gap: 0 },
  totalRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 10,
  },
  totalRowLabel:  { fontSize: 13, color: Colors.textSecondary, fontWeight: '500' },
  totalRowValue:  { fontSize: 14, fontWeight: '600', color: Colors.text },
  discTotalLabel: { fontSize: 13, color: '#7C3AED', fontWeight: '600' },
  discTotalValue: { fontSize: 14, fontWeight: '700', color: '#7C3AED' },
  grandRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 14,
  },
  grandLabel: { fontSize: 15, fontWeight: '700', color: Colors.text },
  grandValue: { fontSize: 22, fontWeight: '900', color: Colors.primary },

  noteCard: {
    backgroundColor: Colors.surface, borderRadius: 14,
    padding: 16, marginBottom: 16,
    borderWidth: 1, borderColor: Colors.border, gap: 10,
  },
});

export default QuotationListScreen;
