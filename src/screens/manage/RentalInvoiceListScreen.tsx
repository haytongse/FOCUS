import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity,
  ActivityIndicator, RefreshControl, TextInput,
  Modal, KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import * as Sharing from 'expo-sharing';
import { MaterialIcons as Icon } from '@expo/vector-icons';
import Colors from '../../theme/colors';
import AppText from '../../components/AppText';
import AppBar from '../../components/AppBar';
import { tabEvents } from '../../navigation/tabEvents';
import * as Print from 'expo-print';
import { generatePDF } from 'react-native-html-to-pdf';
import LOGO_BASE64 from '../../logo/logoBase64';
import { buildMultiRentalInvoicesHTML } from '../../utils/rentalInvoiceHtml';
import {
  getRentalInvoiceHeadersApi,
  updateInvoiceHeaderStatusApi,
  getCampusesApi,
  ApiRentalInvoiceHeader,
  ApiRentalInvoiceDetail,
  ApiRentalUsageMachine,
  ApiCampus,
  createInvoiceSummaryApi,
  getInvoiceSummariesApi,
  getInvoiceSummaryApi,
  deleteInvoiceSummaryApi,
  ApiInvoiceSummary,
  getRentalUsageInvoiceApi,
} from '../../services/focusApi';
import { useAlert } from '../../components/AppAlert';

// ─── Types ────────────────────────────────────────────────────────────────────
interface Props {
  onBack:   () => void;
  onCreate: () => void;
  onView:   (invoice: ApiRentalInvoiceHeader) => void;
}

type Phase        = 'list' | 'creating' | 'result';
type StatusFilter = 'all' | 'ISSUED' | 'PAID' | 'CANCELLED';
type MainTab      = 'invoices' | 'summaries';

// ─── Company / Payment constants ─────────────────────────────────────────────
const COMPANY = {
  name:       'FOCUS LAB',
  addr1:      '#17 St 480, Sangkat Toul Toum Pong 1',
  addr2:      'Khan Chamkarmon, Phnom Penh 12310',
  abaAccount: '003 257 965',
  abaHolder:  'SOVITHIA SEN AND TONG LYHEANG AND TE SOPHIE',
};

// ─── Constants ────────────────────────────────────────────────────────────────
const FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'all',       label: 'All'       },
  { key: 'ISSUED',    label: 'Issued'    },
  { key: 'PAID',      label: 'Paid'      },
  { key: 'CANCELLED', label: 'Cancelled' },
];

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmtPeriod = (iso?: string | null): string => {
  if (!iso) return '—';
  try { const [y, m] = iso.split('-').map(Number); return `${MONTH_NAMES[m - 1]} ${y}`; }
  catch { return iso; }
};

const fmtDate = (iso?: string | null): string => {
  if (!iso) return '—';
  try { const d = new Date(iso); return `${d.getDate()} ${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`; }
  catch { return iso; }
};

const fmtMoney = (cents?: number | string | null): string => {
  if (cents == null) return '—';
  const n = typeof cents === 'string' ? Number(cents) : cents;
  return isNaN(n) ? '—' : `$${(n / 100).toFixed(2)}`;
};

const STATUS_CFG: Record<string, { label: string; bg: string; fg: string }> = {
  ISSUED:    { label: 'Issued',    bg: '#EDE9FE', fg: '#7C3AED' },
  PAID:      { label: 'Paid',      bg: '#D1FAE5', fg: '#059669' },
  CANCELLED: { label: 'Cancelled', bg: '#FFF1F2', fg: '#E11D48' },
};
const statusCfg = (status?: string) =>
  STATUS_CFG[(status ?? '').toUpperCase()] ??
  { label: status ?? '—', bg: Colors.divider, fg: Colors.textSecondary };

// ─── Build printable HTML from rental invoice headers ─────────────────────────
const buildRentalSummaryHTML = (
  headers: ApiRentalInvoiceHeader[],
  summaryNum: string,
  receivedNote?: string | null,
): string => {
  const sorted = [...headers].sort((a, b) =>
    (a.invoiceNumber ?? '').localeCompare(b.invoiceNumber ?? ''),
  );

  let rowNo = 1, grandUsage = 0, grandTotal = 0;

  const dataRows = sorted.map(h => {
    const lines: any[] = (h as any).lines ?? h.details ?? [];
    const totalPrice   = Number(h.totalCents ?? 0) / 100;
    const usage        = lines.reduce(
      (s, l) => s + Math.max(0, Number(l.counterBwEnd ?? l.endCount ?? 0) - Number(l.counterBwStart ?? l.startCount ?? 0)),
      0,
    );
    const ppp = usage > 0 ? totalPrice / usage : 0;
    grandUsage += usage;
    grandTotal += totalPrice;
    const rs = lines.length > 1 ? ` rowspan="${lines.length}"` : '';

    if (lines.length === 0) {
      const n = rowNo++;
      return `<tr>
        <td class="c">${n}</td>
        <td><b>${h.invoiceNumber ?? '—'}</b></td>
        <td class="c">—</td>
        <td class="r">0</td><td class="r">0</td><td class="r">0</td>
        <td class="r">$${ppp.toFixed(5)}</td>
        <td class="r"><b>$${totalPrice.toFixed(2)}</b></td>
      </tr>`;
    }

    return lines.map((l, li) => {
      const n     = rowNo++;
      const start = Number(l.counterBwStart ?? l.startCount ?? 0);
      const end   = Number(l.counterBwEnd   ?? l.endCount   ?? 0);
      const use   = Math.max(0, end - start);
      if (li === 0) {
        return `<tr>
          <td class="c">${n}</td>
          <td${rs}><b>${h.invoiceNumber ?? '—'}</b></td>
          <td class="c">${l.campusCode ?? l.campusNameEn ?? '—'}</td>
          <td class="r">${start.toLocaleString()}</td>
          <td class="r">${end.toLocaleString()}</td>
          <td class="r">${use.toLocaleString()}</td>
          <td class="r"${rs}>$${ppp.toFixed(5)}</td>
          <td class="r"${rs}><b>$${totalPrice.toFixed(2)}</b></td>
        </tr>`;
      }
      return `<tr>
        <td class="c">${n}</td>
        <td class="c">${l.campusCode ?? l.campusNameEn ?? '—'}</td>
        <td class="r">${start.toLocaleString()}</td>
        <td class="r">${end.toLocaleString()}</td>
        <td class="r">${use.toLocaleString()}</td>
      </tr>`;
    }).join('');
  }).join('');

  const generatedDate = new Date().toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"/>
<style>
  @page { size: A4 portrait; margin: 8mm; }
  *, *::before, *::after { margin:0; padding:0; box-sizing:border-box; font-family:'Times New Roman',Times,serif; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  html, body { height:100%; }
  body { font-family:'Times New Roman',Times,serif; font-size: 10px; color: #000; background: #fff; }
  table, thead, tbody, tfoot, tr, th, td { font-family:'Times New Roman',Times,serif; }
  .page { padding: 10px; height: 100%; display:flex; flex-direction:column; overflow:hidden; }
  .hdr { display:flex; align-items:center; gap:10px; margin-bottom:4px; }
  .logo { width:42px; height:42px; border-radius:8px; overflow:hidden; flex-shrink:0; }
  .logo img { width:42px; height:42px; display:block; }
  .hdr-info { flex:1; }
  .co-name { font-size:12px; font-weight:900; letter-spacing:1px; text-transform:uppercase; }
  .co-sub { font-size:8px; color:#555; margin-top:1px; }
  .summary-number { font-size:11px; font-weight:700; color:#666; text-align:right; letter-spacing:0.5px; }
  .report-title { font-size:13px; font-weight:900; text-align:right; color:#2563EB; }
  .report-date { font-size:8px; color:#888; text-align:right; margin-top:1px; }
  hr { border:none; border-top:1.5px solid #000; margin:4px 0; }
  table { width:100%; border-collapse:collapse; margin-top:6px; }
  thead tr { background:#EFF6FF; }
  thead th { padding:3px 5px; font-size:9px; font-weight:700; text-transform:uppercase; letter-spacing:0.3px; border-bottom:1.5px solid #000; border-right:1px solid #d0d0d0; }
  thead th:last-child { border-right:none; }
  tbody td { padding:5px 5px; font-size:10px; border-bottom:1px solid #e8e8e8; border-right:1px solid #e8e8e8; vertical-align:middle; }
  tbody td:last-child { border-right:none; }
  tbody tr:nth-child(even) { background:#FAFAFA; }
  .c { text-align:center; }
  .r { text-align:right; }
  tfoot tr { background:#EFF6FF; }
  tfoot td { padding:3px 5px; font-size:10px; font-weight:800; border-top:2px solid #000; }
  .total-lbl { font-size:10px; font-weight:700; color:#2563EB; }
  .bottom { display:flex; gap:12px; margin-top:10px; align-items:flex-start; }
  .bank-box { flex:1; border:1px solid #d0d0d0; border-radius:4px; overflow:hidden; }
  .bank-title { background:#EFF6FF; padding:3px 8px; font-size:9px; font-weight:700; text-transform:uppercase; letter-spacing:0.5px; color:#2563EB; border-bottom:1px solid #d0d0d0; }
  .bank-row { display:flex; padding:3px 8px; border-bottom:1px solid #f0f0f0; }
  .bank-row:last-child { border-bottom:none; }
  .bank-lbl { width:90px; font-size:9px; color:#666; font-weight:600; flex-shrink:0; }
  .bank-val { font-size:9px; font-weight:700; color:#000; }
  .page-footer { margin-top:auto; padding-top:10px; }
  .sig-section { display:flex; gap:12px; padding-top:4px; }
  .sig-col { flex:1; display:flex; flex-direction:column; align-items:center; gap:4px; }
  .sig-line { width:100%; border-bottom:1.5px solid #000; margin-bottom:2px; height:28px; }
  .sig-label { font-size:9px; font-weight:700; color:#444; text-align:center; }
  @media print { body { -webkit-print-color-adjust:exact; print-color-adjust:exact; } }
</style>
</head><body style="font-family:'Times New Roman',Times,serif;">
<div class="page">
  <div class="hdr">
    <div class="logo"><img src="${LOGO_BASE64}"/></div>
    <div class="hdr-info">
      <div class="co-name">${COMPANY.name}</div>
      <div class="co-sub">${COMPANY.addr1}, ${COMPANY.addr2}</div>
    </div>
    <div>
      ${summaryNum ? `<div class="summary-number">${summaryNum}</div>` : ''}
      <div class="report-title">RENTAL INVOICE SUMMARY</div>
      <div class="report-date">Generated: ${generatedDate}</div>
    </div>
  </div>
  <hr/>
  ${receivedNote?.trim() ? `<div style="font-size:10px;color:#444;font-style:italic;font-weight:700;margin-bottom:4px;"><b>Note:</b> ${receivedNote.trim()}</div>` : ''}
  <table>
    <thead>
      <tr>
        <th class="c" style="width:30px">No</th>
        <th style="width:90px">Invoice No</th>
        <th class="c" style="width:60px">Campus</th>
        <th class="c" style="width:75px">Start Counter</th>
        <th class="c" style="width:75px">End Counter</th>
        <th class="c" style="width:60px">Usage</th>
        <th class="r" style="width:80px">Price/page</th>
        <th class="r" style="width:80px">Total Price</th>
      </tr>
    </thead>
    <tbody>${dataRows}</tbody>
    <tfoot>
      <tr>
        <td colspan="5" class="r total-lbl">Total Usage</td>
        <td class="r">${grandUsage.toLocaleString()}</td>
        <td class="r total-lbl">Grand Total</td>
        <td class="r">$${grandTotal.toFixed(2)}</td>
      </tr>
    </tfoot>
  </table>

  <div class="bottom">
    <div class="bank-box">
      <div class="bank-title">Payment Bank Details</div>
      <div class="bank-row">
        <span class="bank-lbl">Bank Name</span>
        <span class="bank-val">ABA Bank</span>
      </div>
      <div class="bank-row">
        <span class="bank-lbl">Account Name</span>
        <span class="bank-val">${COMPANY.abaHolder}</span>
      </div>
      <div class="bank-row">
        <span class="bank-lbl">Account Number</span>
        <span class="bank-val">${COMPANY.abaAccount}</span>
      </div>
    </div>
  </div>

  <div class="page-footer">
    <div class="sig-section">
      <div class="sig-col">
        <div class="sig-line"></div>
        <div class="sig-label">Received By</div>
      </div>
      <div class="sig-col">
        <div class="sig-line"></div>
        <div class="sig-label">Authorised By</div>
      </div>
    </div>
  </div>
</div>
</body></html>`;
};

// ─── Component ────────────────────────────────────────────────────────────────
const RentalInvoiceListScreen: React.FC<Props> = ({ onBack, onCreate, onView }) => {
  const { showAlert } = useAlert();

  const [invoices,   setInvoices]   = useState<ApiRentalInvoiceHeader[]>([]);
  const [campusMap,  setCampusMap]  = useState<Record<string, ApiCampus>>({});
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const [search,     setSearch]     = useState('');
  const [filter,     setFilter]     = useState<StatusFilter>('all');
  const [markingId,  setMarkingId]  = useState<string | null>(null);

  const [phase,          setPhase]          = useState<Phase>('list');
  const [selected,       setSelected]       = useState<Set<string>>(new Set());
  const [viewHeaders,       setViewHeaders]       = useState<ApiRentalInvoiceHeader[]>([]);
  const [viewSummaryNum,    setViewSummaryNum]    = useState('');
  const [viewReceivedNote,  setViewReceivedNote]  = useState<string | null>(null);

  const [mainTab,               setMainTab]               = useState<MainTab>('invoices');
  const [confirmSummaryVisible, setConfirmSummaryVisible] = useState(false);
  const [summaryNote,           setSummaryNote]           = useState('');
  const [savingSummary,         setSavingSummary]         = useState(false);

  const [savedSummaries,    setSavedSummaries]    = useState<ApiInvoiceSummary[]>([]);
  const [summariesLoading,  setSummariesLoading]  = useState(false);
  const [summariesError,    setSummariesError]    = useState<string | null>(null);
  const [loadingSummaryId,  setLoadingSummaryId]  = useState<string | null>(null);
  const [deletingSummaryId, setDeletingSummaryId] = useState<string | null>(null);
  const [printingSummary,   setPrintingSummary]   = useState(false);
  const [sharingPdf,        setSharingPdf]        = useState(false);

  const load = useCallback((silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    Promise.all([getRentalInvoiceHeadersApi(), getCampusesApi().catch(() => [] as ApiCampus[])])
      .then(([items, campuses]) => {
        setInvoices(items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
        const cMap: Record<string, ApiCampus> = {};
        campuses.forEach(c => { cMap[String(c.id)] = c; });
        setCampusMap(cMap);
      })
      .catch(err => setError(err?.message ?? 'Failed to load rental invoices'))
      .finally(() => { setLoading(false); setRefreshing(false); });
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => tabEvents.on('Manage', () => load(true)), [load]);

  const onRefresh = () => { setRefreshing(true); load(true); };

  const displayed = useMemo(() => {
    let list = invoices;
    if (filter !== 'all') list = list.filter(h => (h.status ?? '').toUpperCase() === filter);
    const q = search.trim().toLowerCase();
    if (q) list = list.filter(h =>
      (h.invoiceNumber ?? '').toLowerCase().includes(q) ||
      fmtPeriod(h.periodMonth).toLowerCase().includes(q) ||
      (h.customerOrg?.nameEn ?? '').toLowerCase().includes(q),
    );
    return list;
  }, [invoices, filter, search]);

  const stats = useMemo(() => {
    const issued   = invoices.filter(h => (h.status ?? '').toUpperCase() === 'ISSUED');
    const paid     = invoices.filter(h => (h.status ?? '').toUpperCase() === 'PAID');
    const totalUsd = invoices.reduce((s, h) => s + (Number(h.totalCents) || 0), 0) / 100;
    return { total: invoices.length, issued: issued.length, paid: paid.length, totalUsd };
  }, [invoices]);

  // ── Selection ──
  const toggle = useCallback((id: string) => {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }, []);

  const toggleAll = useCallback(() => {
    setSelected(prev =>
      displayed.every(i => prev.has(i.id))
        ? new Set()
        : new Set(displayed.map(i => i.id)),
    );
  }, [displayed]);

  const allSelected = displayed.length > 0 && displayed.every(i => selected.has(i.id));

  const selectedTotal = useMemo(
    () => invoices.filter(h => selected.has(h.id)).reduce((s, h) => s + (Number(h.totalCents) || 0), 0) / 100,
    [invoices, selected],
  );

  // ── Generate summary ──
  const openSummaryModal = useCallback(() => {
    if (selected.size === 0) return;
    setSummaryNote('');
    setConfirmSummaryVisible(true);
  }, [selected]);

  const doGenerateSummary = useCallback(async () => {
    const selectedInvoices = invoices.filter(h => selected.has(h.id));
    setSavingSummary(true);
    try {
      const rateUsed = selectedInvoices.find(h => (h as any).rateUsed != null)?.rateUsed ?? 4100;
      const created = await createInvoiceSummaryApi({
        invoiceIds:  [...selected],
        rateUsed,
        ...(summaryNote.trim() ? { description: summaryNote.trim() } : {}),
      });
      setConfirmSummaryVisible(false);
      setViewHeaders(selectedInvoices);
      setViewSummaryNum(created.summaryNumber);
      setSelected(new Set());
      setSummaryNote('');
      setPhase('result');
    } catch (e: any) {
      showAlert({ type: 'error', title: 'Error', message: e?.message ?? 'Failed to create summary' });
    } finally {
      setSavingSummary(false);
    }
  }, [selected, invoices, summaryNote, showAlert]);

  // ── Summary list ──
  const loadSummaries = useCallback((silent = false) => {
    if (!silent) setSummariesLoading(true);
    setSummariesError(null);
    getInvoiceSummariesApi()
      .then(list => setSavedSummaries(list))
      .catch(err => setSummariesError(err?.message ?? 'Failed to load summaries'))
      .finally(() => setSummariesLoading(false));
  }, []);

  const handleMainTabChange = useCallback((t: MainTab) => {
    setMainTab(t);
    if (t === 'summaries') loadSummaries();
  }, [loadSummaries]);

  const handleViewSummary = useCallback(async (item: ApiInvoiceSummary) => {
    setLoadingSummaryId(item.id);
    try {
      const detail = await getInvoiceSummaryApi(item.id);
      const ids = new Set((detail.invoices ?? []).map(inv => String(inv.id)));
      const headers = invoices.filter(h => ids.has(String(h.id)));
      setViewHeaders(headers);
      setViewSummaryNum(detail.summaryNumber);
      setViewReceivedNote(detail.receivedNote ?? detail.description ?? null);
      setPhase('result');
    } catch (err: any) {
      showAlert({ type: 'error', title: 'Error', message: err?.message ?? 'Failed to load summary' });
    } finally {
      setLoadingSummaryId(null);
    }
  }, [invoices, showAlert]);

  const handleDeleteSummary = useCallback((item: ApiInvoiceSummary) => {
    const label = item.description?.trim() || item.summaryNumber || fmtDate(item.createdAt);
    showAlert({
      type: 'confirm',
      title: 'Delete Summary',
      message: `Delete "${label}"? This cannot be undone.`,
      actions: [
        { label: 'Cancel', variant: 'outline' },
        {
          label: 'Delete', variant: 'danger',
          onPress: async () => {
            setDeletingSummaryId(item.id);
            try {
              await deleteInvoiceSummaryApi(item.id);
              setSavedSummaries(prev => prev.filter(s => s.id !== item.id));
            } catch (err: any) {
              showAlert({ type: 'error', title: 'Error', message: err?.message ?? 'Failed to delete summary' });
            } finally {
              setDeletingSummaryId(null);
            }
          },
        },
      ],
    });
  }, [showAlert]);

  const handlePrintSummary = useCallback(async () => {
    if (viewHeaders.length === 0) return;
    setPrintingSummary(true);
    try {
      const html = buildRentalSummaryHTML(viewHeaders, viewSummaryNum, viewReceivedNote);
      await Print.printAsync({ html });
    } catch (err: any) {
      if (err?.message !== 'User cancelled') {
        showAlert({ type: 'error', title: 'Print Error', message: err?.message ?? 'Failed to print' });
      }
    } finally {
      setPrintingSummary(false);
    }
  }, [viewHeaders, viewSummaryNum, viewReceivedNote, showAlert]);

  const handleSharePdf = useCallback(async () => {
    if (selected.size === 0) return;
    const selectedInvoices = invoices.filter(h => selected.has(h.id))
      .sort((a, b) => (a.invoiceNumber ?? '').localeCompare(b.invoiceNumber ?? ''));
    setSharingPdf(true);
    try {
      // Fetch machine usage in batches of 4 to avoid overwhelming the API
      const BATCH = 4;
      const machineResults: (ApiRentalUsageMachine[] | null)[] = [];
      for (let i = 0; i < selectedInvoices.length; i += BATCH) {
        const batch = selectedInvoices.slice(i, i + BATCH);
        const results = await Promise.all(
          batch.map(inv =>
            inv.invoiceNumber
              ? getRentalUsageInvoiceApi(inv.invoiceNumber)
                  .then(r => r.machines.length > 0 ? r.machines : null)
                  .catch(() => null)
              : Promise.resolve(null),
          ),
        );
        machineResults.push(...results);
      }

      const pages = selectedInvoices.map((inv, i) => ({
        inv,
        machines: machineResults[i] as ApiRentalUsageMachine[] | null,
      }));

      const html = buildMultiRentalInvoicesHTML(pages);

      const invFileName = (inv: ApiRentalInvoiceHeader) => {
        const campus = inv.campusCode ?? inv.campus?.campusCode ?? campusMap[String(inv.campusId)]?.campusCode ?? 'campus';
        return `${campus}-invoice-${inv.invoiceNumber ?? 'unknown'}`;
      };
      const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const fileName = selectedInvoices.length === 1
        ? invFileName(selectedInvoices[0])
        : `rental-invoices-${selectedInvoices.length}-${today}`;

      const result = await generatePDF({ html, fileName, width: 595, height: 842 });
      const filePath = result.filePath;
      if (!filePath) throw new Error('PDF generation failed');
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) await Sharing.shareAsync(filePath, { mimeType: 'application/pdf', dialogTitle: `${fileName}.pdf` });
    } catch (err: any) {
      if (err?.message !== 'User cancelled' && err?.message !== 'The user did not share') {
        showAlert({ type: 'error', title: 'Share Error', message: err?.message ?? 'Failed to generate PDF' });
      }
    } finally {
      setSharingPdf(false);
    }
  }, [selected, invoices, campusMap, showAlert]);

  const handleMarkPaid = (inv: ApiRentalInvoiceHeader) => {
    if ((inv.status ?? '').toUpperCase() === 'PAID') return;
    showAlert({
      type: 'confirm', title: 'Mark as Paid', message: `Mark "${inv.invoiceNumber}" as paid?`,
      actions: [
        { label: 'Cancel', variant: 'outline' },
        {
          label: 'Mark Paid', variant: 'primary',
          onPress: async () => {
            setMarkingId(inv.id);
            try {
              await updateInvoiceHeaderStatusApi(inv.id, 'PAID');
              setInvoices(prev => prev.map(h => h.id === inv.id ? { ...h, status: 'PAID' } : h));
            } catch (err: any) {
              showAlert({ type: 'error', title: 'Error', message: err?.message ?? 'Failed to update status' });
            } finally { setMarkingId(null); }
          },
        },
      ],
    });
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // ── CREATING ──
  // ─────────────────────────────────────────────────────────────────────────────
  if (phase === 'creating') {
    return (
      <View style={s.safe}>
        <AppBar title="Rental Invoices" titleAlign="left" showBack onBack={onBack} />
        <View style={s.center}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <AppText style={s.centerMsg} color="textSecondary">Saving summary…</AppText>
        </View>
      </View>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // ── RESULT ──
  // ─────────────────────────────────────────────────────────────────────────────
  if (phase === 'result' && viewHeaders.length > 0) {
    const totalCents = viewHeaders.reduce((s, h) => s + Number(h.totalCents ?? 0), 0);
    return (
      <View style={s.safe}>
        <AppBar
          title={viewSummaryNum || 'Invoice Summary'}
          subtitle={`${viewHeaders.length} invoice${viewHeaders.length !== 1 ? 's' : ''}`}
          titleAlign="left"
          showBack
          onBack={() => { setViewHeaders([]); setViewSummaryNum(''); setPhase('list'); }}
        />
        <FlatList
          data={[...viewHeaders].sort((a, b) => (a.invoiceNumber ?? '').localeCompare(b.invoiceNumber ?? ''))}
          keyExtractor={item => String(item.id)}
          contentContainerStyle={{ paddingBottom: 100 }}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            <View style={s.resultHeader}>
              <Icon name="summarize" size={18} color="#2563EB" />
              <AppText style={s.resultHeaderNum}>{viewSummaryNum}</AppText>
              <AppText style={s.resultHeaderTotal}>${(totalCents / 100).toFixed(2)}</AppText>
            </View>
          }
          ItemSeparatorComponent={() => <View style={s.summaryDivider} />}
          renderItem={({ item }) => {
            const lines: any[] = (item as any).lines ?? item.details ?? [];
            const invTotal = Number(item.totalCents ?? 0) / 100;
            return (
              <View style={s.resultRow}>
                <View style={s.resultRowTop}>
                  <AppText style={s.resultInvNum}>{item.invoiceNumber ?? '—'}</AppText>
                  <AppText style={s.resultInvAmount}>${invTotal.toFixed(2)}</AppText>
                </View>
                <AppText style={s.resultPeriod}>{fmtPeriod(item.periodMonth)}</AppText>
                {lines.map((l, li) => {
                  const start = Number(l.counterBwStart ?? l.startCount ?? 0);
                  const end   = Number(l.counterBwEnd   ?? l.endCount   ?? 0);
                  return (
                    <View key={li} style={s.resultLineRow}>
                      <View style={s.resultCampusChip}>
                        <AppText style={s.resultCampusTxt}>{l.campusCode ?? l.campusNameEn ?? '—'}</AppText>
                      </View>
                      <AppText style={s.resultCounter}>{start.toLocaleString()} → {end.toLocaleString()}</AppText>
                      <AppText style={s.resultUsage}>+{Math.max(0, end - start).toLocaleString()}</AppText>
                    </View>
                  );
                })}
              </View>
            );
          }}
        />
        <View style={s.printFooter}>
          <TouchableOpacity
            style={[s.printBtn, printingSummary && { opacity: 0.7 }]}
            onPress={handlePrintSummary}
            activeOpacity={0.85}
            disabled={printingSummary}
          >
            {printingSummary
              ? <ActivityIndicator size="small" color={Colors.white} />
              : <Icon name="print" size={20} color={Colors.white} />
            }
            <AppText style={s.printBtnTxt}>Print Summary</AppText>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // ── LIST VIEW ──
  // ─────────────────────────────────────────────────────────────────────────────
  const renderItem = ({ item }: { item: ApiRentalInvoiceHeader }) => {
    const cfg       = statusCfg(item.status);
    const isMarking = markingId === item.id;
    const isPaid    = (item.status ?? '').toUpperCase() === 'PAID';
    const details   = (item.details ?? []) as ApiRentalInvoiceDetail[];
    const isOn      = selected.has(item.id);

    const campusCodes = [...new Set(details.map(d => d.campusCode ?? d.campus?.campusCode ?? null).filter((v): v is string => !!v))];
    const campusStr   = campusCodes.length > 0
      ? campusCodes.join(', ')
      : item.campusCode ?? item.campus?.campusCode ?? campusMap[String(item.campusId)]?.campusCode ?? '—';

    const totalPages     = details.reduce((s, d) => s + Math.max(0, Number(d.counterBwEnd ?? 0) - Number(d.counterBwStart ?? 0)), 0);
    const hasCounterData = details.some(d => Number(d.counterBwEnd ?? 0) > 1);

    return (
      <TouchableOpacity
        style={[s.card, isOn && s.cardSelected]}
        activeOpacity={0.75}
        onPress={() => toggle(item.id)}
      >
        {/* ── Header ── */}
        <View style={s.cardHeader}>
          <View style={[s.checkbox, isOn && s.checkboxSelected]}>
            {isOn && <Icon name="check" size={14} color={Colors.white} />}
          </View>
          <View style={s.refRow}>
            <AppText variant="bodyMedium" style={s.refText}>{item.invoiceNumber ?? '—'}</AppText>
            <View style={s.campusChip}>
              <AppText style={s.campusChipText}>{campusStr}</AppText>
            </View>
          </View>
          <View style={[s.statusBadge, { backgroundColor: cfg.bg }]}>
            <AppText style={[s.statusText, { color: cfg.fg }]}>{cfg.label}</AppText>
          </View>
        </View>

        {/* ── Meta ── */}
        <View style={s.cardMeta}>
          {item.customerOrg?.nameEn ? (
            <View style={s.metaItem}>
              <Icon name="business" size={13} color={Colors.textSecondary} />
              <AppText variant="caption" color="textSecondary">{item.customerOrg.nameEn}</AppText>
            </View>
          ) : null}
          <View style={s.metaItem}>
            <Icon name="location-city" size={13} color={Colors.textSecondary} />
            <AppText variant="caption" color="textSecondary">{campusStr}</AppText>
          </View>
          {item.periodMonth ? (
            <View style={s.metaItem}>
              <Icon name="date-range" size={13} color={Colors.textSecondary} />
              <AppText variant="caption" color="textSecondary">{fmtPeriod(item.periodMonth)}</AppText>
            </View>
          ) : null}
          {(item.startDate || item.endDate) ? (
            <View style={s.metaItem}>
              <Icon name="calendar-today" size={13} color={Colors.textSecondary} />
              <AppText variant="caption" color="textSecondary">
                {fmtDate(item.startDate)} – {fmtDate(item.endDate)}
              </AppText>
            </View>
          ) : null}
          {hasCounterData ? (
            <View style={s.metaItem}>
              <Icon name="print" size={13} color={Colors.textSecondary} />
              <AppText variant="caption" color="textSecondary">{totalPages.toLocaleString()} pages</AppText>
            </View>
          ) : null}
        </View>

        {/* ── Note ── */}
        {!!item.note?.trim() && (
          <View style={s.cardNote}>
            <Icon name="notes" size={12} color={Colors.textSecondary} />
            <AppText style={s.cardNoteTxt} numberOfLines={2}>{item.note.trim()}</AppText>
          </View>
        )}

        {/* ── Footer ── */}
        <View style={s.cardFooter}>
          <AppText variant="caption" color="textSecondary" style={s.itemsLabel}>
            {details.length > 0
              ? `${details.length} machine${details.length !== 1 ? 's' : ''}`
              : '—'}
          </AppText>
          <AppText style={s.totalText}>{fmtMoney(item.totalCents)}</AppText>
          <TouchableOpacity
            style={[s.actionBtn, { backgroundColor: '#EFF6FF' }]}
            onPress={() => onView(item)}
            activeOpacity={0.75}
          >
            <Icon name="visibility" size={16} color="#2563EB" />
            <AppText style={[s.actionBtnText, { color: '#2563EB' }]}>View</AppText>
          </TouchableOpacity>
          {!isPaid && (
            isMarking
              ? <ActivityIndicator size="small" color={Colors.primary} style={s.actionBtn} />
              : (
                <TouchableOpacity style={s.actionBtn} onPress={() => handleMarkPaid(item)} activeOpacity={0.75}>
                  <Icon name="check-circle-outline" size={16} color={Colors.primary} />
                  <AppText style={s.actionBtnText}>Mark Paid</AppText>
                </TouchableOpacity>
              )
          )}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={s.safe}>
      <AppBar
        title="Rental Invoices"
        subtitle={mainTab === 'summaries'
          ? `${savedSummaries.length} summar${savedSummaries.length !== 1 ? 'ies' : 'y'}`
          : `${invoices.length} rental invoice${invoices.length !== 1 ? 's' : ''}`}
        titleAlign="left"
        showBack
        onBack={onBack}
      />

      {/* ── Main tabs ── */}
      <View style={s.tabBar}>
        {([
          { key: 'invoices',  label: 'Invoices'  },
          { key: 'summaries', label: 'Summaries' },
        ] as { key: MainTab; label: string }[]).map(t => (
          <TouchableOpacity
            key={t.key}
            style={[s.tab, mainTab === t.key && s.tabActive]}
            onPress={() => handleMainTabChange(t.key)}
            activeOpacity={0.7}
          >
            <AppText style={[s.tabText, mainTab === t.key && s.tabTextActive]}>{t.label}</AppText>
            {t.key === 'summaries' && savedSummaries.length > 0 && (
              <View style={s.tabBadge}>
                <AppText style={s.tabBadgeText}>{savedSummaries.length}</AppText>
              </View>
            )}
          </TouchableOpacity>
        ))}
      </View>

      {/* ── SUMMARIES TAB ── */}
      {mainTab === 'summaries' ? (
        summariesLoading ? (
          <View style={s.center}>
            <ActivityIndicator size="large" color={Colors.primary} />
          </View>
        ) : summariesError ? (
          <View style={s.center}>
            <Icon name="error-outline" size={52} color={Colors.textLight} />
            <AppText style={s.centerMsg} color="textSecondary">{summariesError}</AppText>
            <TouchableOpacity style={s.retryBtn} onPress={() => loadSummaries()}>
              <AppText variant="bodyMedium" color="primary">Retry</AppText>
            </TouchableOpacity>
          </View>
        ) : (
          <FlatList
            data={savedSummaries}
            keyExtractor={item => item.id}
            contentContainerStyle={{ paddingBottom: 100 }}
            showsVerticalScrollIndicator={false}
            refreshControl={<RefreshControl refreshing={false} onRefresh={() => loadSummaries(true)} tintColor={Colors.primary} />}
            ItemSeparatorComponent={() => <View style={s.summaryDivider} />}
            renderItem={({ item }) => {
              const isDeleting = deletingSummaryId === item.id;
              const isViewing  = loadingSummaryId  === item.id;
              return (
                <View style={s.summaryRow}>
                  <TouchableOpacity
                    style={s.summaryRowPress}
                    onPress={() => handleViewSummary(item)}
                    activeOpacity={0.7}
                    disabled={isDeleting || isViewing}
                  >
                    <View style={s.summaryIconBox}>
                      <Icon name="summarize" size={18} color="#2563EB" />
                    </View>
                    <View style={s.summaryBody}>
                      <AppText style={s.summaryNum} numberOfLines={1}>{item.summaryNumber ?? '—'}</AppText>
                      {!!item.description?.trim() && (
                        <AppText style={s.summaryNote} numberOfLines={1}>{item.description.trim()}</AppText>
                      )}
                      <AppText style={s.summaryDate}>{fmtDate(item.createdAt)}</AppText>
                    </View>
                    <AppText style={s.summaryTotal}>{fmtMoney(item.totalCents)}</AppText>
                  </TouchableOpacity>
                  {isViewing || isDeleting ? (
                    <ActivityIndicator size="small" color={isDeleting ? Colors.error : Colors.primary} style={s.summaryAction} />
                  ) : (
                    <TouchableOpacity
                      onPress={() => handleDeleteSummary(item)}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                      style={s.summaryAction}
                    >
                      <Icon name="delete-outline" size={20} color={Colors.error} />
                    </TouchableOpacity>
                  )}
                </View>
              );
            }}
            ListEmptyComponent={
              <View style={s.center}>
                <Icon name="summarize" size={56} color={Colors.textLight} />
                <AppText style={s.emptyTitle}>No saved summaries yet</AppText>
                <AppText style={s.emptySubtitle}>Generate one from the Invoices tab</AppText>
              </View>
            }
          />
        )
      ) : (
        <>
      {/* Stats bar */}
      {!loading && invoices.length > 0 && (
        <View style={s.statsBar}>
          <View style={s.statItem}>
            <AppText style={s.statNum}>{stats.total}</AppText>
            <AppText style={s.statLbl}>Total</AppText>
          </View>
          <View style={s.statDivider} />
          <View style={s.statItem}>
            <AppText style={[s.statNum, { color: '#7C3AED' }]}>{stats.issued}</AppText>
            <AppText style={s.statLbl}>Issued</AppText>
          </View>
          <View style={s.statDivider} />
          <View style={s.statItem}>
            <AppText style={[s.statNum, { color: '#059669' }]}>{stats.paid}</AppText>
            <AppText style={s.statLbl}>Paid</AppText>
          </View>
          <View style={s.statDivider} />
          <View style={s.statItem}>
            <AppText style={[s.statNum, { color: Colors.text }]}>${stats.totalUsd.toFixed(0)}</AppText>
            <AppText style={s.statLbl}>USD Total</AppText>
          </View>
        </View>
      )}

      {/* Search */}
      <View style={s.searchRow}>
        <Icon name="search" size={18} color={Colors.textSecondary} />
        <TextInput
          style={s.searchInput}
          placeholder="Search invoice, period, customer…"
          placeholderTextColor={Colors.textLight}
          value={search}
          onChangeText={setSearch}
          returnKeyType="search"
          clearButtonMode="while-editing"
        />
        {search ? (
          <TouchableOpacity onPress={() => setSearch('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Icon name="close" size={16} color={Colors.textSecondary} />
          </TouchableOpacity>
        ) : null}
      </View>

      {/* Filter pills */}
      <View style={s.filterRow}>
        {FILTERS.map(f => (
          <TouchableOpacity
            key={f.key}
            style={[s.filterPill, filter === f.key && s.filterPillActive]}
            onPress={() => setFilter(f.key)}
          >
            <AppText style={[s.filterText, filter === f.key && s.filterTextActive]}>
              {f.label}
            </AppText>
          </TouchableOpacity>
        ))}
      </View>

      {/* Select All bar */}
      {!loading && !error && displayed.length > 0 && (
        <TouchableOpacity style={s.selectAllBar} onPress={toggleAll} activeOpacity={0.7}>
          <View style={[s.checkbox, allSelected && s.checkboxSelected]}>
            {allSelected && <Icon name="check" size={14} color={Colors.white} />}
          </View>
          <AppText variant="caption" style={s.selectAllText}>
            {allSelected ? 'Deselect all' : `Select all (${displayed.length})`}
          </AppText>
          {selected.size > 0 && (
            <AppText style={s.selTotal}>{selected.size} selected · ${selectedTotal.toFixed(2)}</AppText>
          )}
        </TouchableOpacity>
      )}

      {/* List / loading / error */}
      {loading ? (
        <View style={s.center}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <AppText style={s.centerMsg} color="textSecondary">Loading invoices…</AppText>
        </View>
      ) : error ? (
        <View style={s.center}>
          <Icon name="error-outline" size={52} color={Colors.textLight} />
          <AppText style={s.centerMsg} color="textSecondary">{error}</AppText>
          <TouchableOpacity style={s.retryBtn} onPress={() => load()}>
            <AppText variant="bodyMedium" color="primary">Retry</AppText>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={displayed}
          keyExtractor={item => item.id}
          renderItem={renderItem}
          contentContainerStyle={[s.list, selected.size > 0 && { paddingBottom: 110 }]}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
          ListEmptyComponent={
            <View style={s.center}>
              <View style={s.emptyIcon}>
                <Icon name="print" size={32} color={Colors.primary} />
              </View>
              <AppText style={s.emptyTitle}>
                {search || filter !== 'all' ? 'No results found' : 'No rental invoices yet'}
              </AppText>
              <AppText style={s.emptySubtitle}>
                {search || filter !== 'all' ? 'Try adjusting your search or filter' : 'Tap + to create your first rental invoice'}
              </AppText>
            </View>
          }
        />
      )}

      {/* Generate Summary / Share PDF sticky footer */}
      {selected.size > 0 && (
        <View style={s.genFooter}>
          <View style={s.genBtnRow}>
            <TouchableOpacity
              style={[s.shareBtn, sharingPdf && { opacity: 0.7 }]}
              activeOpacity={0.85}
              onPress={handleSharePdf}
              disabled={sharingPdf}
            >
              {sharingPdf
                ? <ActivityIndicator size="small" color="#fff" />
                : <Icon name="share" size={18} color="#fff" />
              }
              <Text style={s.genBtnTxt}>Share PDF</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.genBtn} activeOpacity={0.85} onPress={openSummaryModal}>
              <Icon name="summarize" size={18} color="#fff" />
              <Text style={s.genBtnTxt}>Summary ({selected.size})</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
        </>
      )}

      {/* FAB */}
      <TouchableOpacity style={s.fab} onPress={onCreate} activeOpacity={0.85}>
        <Icon name="add" size={28} color={Colors.white} />
      </TouchableOpacity>

      {/* ── Confirm Summary Modal ── */}
      {(() => {
        const confirmInvoices = invoices.filter(h => selected.has(h.id));
        const confirmTotal    = confirmInvoices.reduce((s, h) => s + (Number(h.totalCents) || 0), 0) / 100;
        return (
          <Modal
            visible={confirmSummaryVisible}
            transparent
            animationType="fade"
            onRequestClose={() => !savingSummary && setConfirmSummaryVisible(false)}
          >
            <KeyboardAvoidingView
              style={{ flex: 1 }}
              behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
              keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 24}
            >
              <ScrollView
                contentContainerStyle={cs.backdrop}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                <View style={cs.card}>
                  <AppText style={cs.title}>Generate Summary?</AppText>

                  <View style={cs.table}>
                    <View style={cs.tableHeader}>
                      <AppText style={[cs.colInv,    cs.headerText]}>Invoice #</AppText>
                      <AppText style={[cs.colCampus, cs.headerText]}>Campus</AppText>
                      <AppText style={[cs.colPeriod, cs.headerText]}>Period</AppText>
                      <AppText style={[cs.colAmt,    cs.headerText]}>Amount</AppText>
                    </View>
                    {confirmInvoices.map(h => {
                      const campus = h.campusCode ?? h.campus?.campusCode ?? campusMap[String(h.campusId)]?.campusCode ?? '—';
                      return (
                        <View key={h.id} style={cs.row}>
                          <AppText style={[cs.colInv,    cs.rowText]} numberOfLines={1}>{h.invoiceNumber ?? '—'}</AppText>
                          <AppText style={[cs.colCampus, cs.rowText]}>{campus}</AppText>
                          <AppText style={[cs.colPeriod, cs.rowText]}>{fmtPeriod(h.periodMonth)}</AppText>
                          <AppText style={[cs.colAmt,    cs.rowText]}>{fmtMoney(h.totalCents)}</AppText>
                        </View>
                      );
                    })}
                  </View>

                  <View style={cs.totalRow}>
                    <AppText style={cs.totalLabel}>Total</AppText>
                    <AppText style={cs.totalAmount}>${confirmTotal.toFixed(2)}</AppText>
                  </View>

                  <View style={cs.fieldWrapper}>
                    <AppText style={cs.fieldLabel}>Note</AppText>
                    <TextInput
                      style={cs.fieldInput}
                      value={summaryNote}
                      onChangeText={setSummaryNote}
                      placeholder="e.g. Monthly rental summary — June 2026"
                      placeholderTextColor={Colors.textLight}
                      multiline
                      numberOfLines={2}
                      returnKeyType="done"
                      blurOnSubmit
                    />
                  </View>

                  <View style={cs.btnRow}>
                    <TouchableOpacity
                      style={cs.btnCancel}
                      onPress={() => { setConfirmSummaryVisible(false); setSummaryNote(''); }}
                      activeOpacity={0.8}
                      disabled={savingSummary}
                    >
                      <AppText style={cs.btnCancelText}>Cancel</AppText>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[cs.btnCreate, savingSummary && { opacity: 0.7 }]}
                      onPress={doGenerateSummary}
                      activeOpacity={0.8}
                      disabled={savingSummary}
                    >
                      {savingSummary
                        ? <ActivityIndicator size="small" color={Colors.white} />
                        : <AppText style={cs.btnCreateText}>Generate</AppText>
                      }
                    </TouchableOpacity>
                  </View>
                </View>
              </ScrollView>
            </KeyboardAvoidingView>
          </Modal>
        );
      })()}
    </View>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F0F4F8' },

  // ── Main tabs ──
  tabBar: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.divider,
  },
  tab: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 12, gap: 6,
  },
  tabActive: {
    borderBottomWidth: 2,
    borderBottomColor: Colors.primary,
  },
  tabText:       { fontSize: 13, fontWeight: '500', color: Colors.textSecondary },
  tabTextActive: { color: Colors.primary, fontWeight: '700' },
  tabBadge: {
    backgroundColor: Colors.primary,
    borderRadius: 10, paddingHorizontal: 6, paddingVertical: 2, minWidth: 20, alignItems: 'center',
  },
  tabBadgeText: { fontSize: 10, color: '#fff', fontWeight: '700' },

  // ── Summary list rows ──
  summaryRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.surface,
  },
  summaryRowPress: {
    flex: 1, flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12,
  },
  summaryAction: { marginLeft: 8 },
  summaryIconBox: {
    width: 32, height: 32, borderRadius: 8,
    backgroundColor: '#EFF6FF', alignItems: 'center', justifyContent: 'center',
    marginRight: 12,
  },
  summaryBody:  { flex: 1, gap: 2 },
  summaryNum:   { fontSize: 14, fontWeight: '600', color: Colors.text },
  summaryNote:  { fontSize: 12, color: Colors.textSecondary, fontStyle: 'italic' },
  summaryDate:  { fontSize: 12, color: Colors.textLight },
  summaryTotal: { fontSize: 14, fontWeight: '700', color: Colors.text, marginRight: 4 },
  summaryDivider: { height: 1, backgroundColor: Colors.border, marginHorizontal: 16 },

  // ── Print footer ──
  printFooter: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    paddingHorizontal: 16, paddingVertical: 12,
    backgroundColor: Colors.surface, borderTopWidth: 1, borderTopColor: Colors.divider,
  },
  printBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#2563EB', borderRadius: 14, paddingVertical: 14,
  },
  printBtnTxt: { fontSize: 15, fontWeight: '700', color: '#fff' },

  // Result list view
  resultHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#EFF6FF', paddingHorizontal: 16, paddingVertical: 12,
  },
  resultHeaderNum: { flex: 1, fontSize: 14, fontWeight: '700', color: '#2563EB' },
  resultHeaderTotal: { fontSize: 15, fontWeight: '800', color: '#1E40AF' },
  resultRow: {
    backgroundColor: Colors.surface, paddingHorizontal: 16, paddingVertical: 12,
  },
  resultRowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 },
  resultInvNum: { fontSize: 14, fontWeight: '700', color: '#1E293B' },
  resultInvAmount: { fontSize: 14, fontWeight: '700', color: '#16A34A' },
  resultPeriod: { fontSize: 12, color: Colors.textSecondary, marginBottom: 8 },
  resultLineRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  resultCampusChip: {
    backgroundColor: '#F1F5F9', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2,
  },
  resultCampusTxt: { fontSize: 11, fontWeight: '600', color: '#475569' },
  resultCounter: { flex: 1, fontSize: 12, color: Colors.textSecondary },
  resultUsage: { fontSize: 12, fontWeight: '700', color: '#2563EB' },

  // Stats bar
  statsBar: {
    flexDirection: 'row', backgroundColor: Colors.surface,
    marginHorizontal: 16, marginTop: 12, borderRadius: 14, paddingVertical: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 2,
  },
  statItem:    { flex: 1, alignItems: 'center', gap: 2 },
  statNum:     { fontSize: 18, fontWeight: '800', color: Colors.text },
  statLbl:     { fontSize: 10, color: Colors.textSecondary, fontWeight: '500', textTransform: 'uppercase', letterSpacing: 0.5 },
  statDivider: { width: 1, backgroundColor: Colors.divider, marginVertical: 4 },

  // Search
  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.surface, marginHorizontal: 16, marginTop: 10,
    borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10,
    borderWidth: 1, borderColor: Colors.border,
  },
  searchInput: { flex: 1, fontSize: 14, color: Colors.text, paddingVertical: 0 },

  // Filter pills
  filterRow: { flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 10, gap: 8 },
  filterPill: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border },
  filterPillActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  filterText:       { fontSize: 13, color: Colors.textSecondary, fontWeight: '500' },
  filterTextActive: { color: Colors.white, fontWeight: '700' },

  // Select All bar
  selectAllBar: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 16, paddingVertical: 10,
    backgroundColor: Colors.surface,
    borderTopWidth: 1, borderBottomWidth: 1, borderColor: Colors.divider,
  },
  selectAllText: { flex: 1, color: Colors.textSecondary },
  selTotal:      { fontSize: 13, fontWeight: '700', color: Colors.primary },

  // List
  list: { padding: 12, paddingBottom: 100, gap: 10 },

  // ── Card (matches Sale Invoice) ───────────────────────────────────────────────
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 14, padding: 14,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05, shadowRadius: 6, elevation: 2,
    gap: 10, borderWidth: 2, borderColor: 'transparent',
  },
  cardSelected: { borderColor: Colors.primary, backgroundColor: Colors.primaryMuted },

  // Header row
  cardHeader:   { flexDirection: 'row', alignItems: 'center', gap: 8 },
  refRow:       { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  refText:      { fontWeight: '700', color: '#7C3AED' },
  campusChip:   { backgroundColor: '#DBEAFE', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  campusChipText: { fontSize: 11, fontWeight: '700', color: '#2563EB' },

  // Checkbox
  checkbox: {
    width: 22, height: 22, borderRadius: 6,
    borderWidth: 2, borderColor: Colors.border,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.surface,
  },
  checkboxSelected: { backgroundColor: Colors.primary, borderColor: Colors.primary },

  // Status badge
  statusBadge: { borderRadius: 6, paddingHorizontal: 10, paddingVertical: 3 },
  statusText:  { fontSize: 11, fontWeight: '700' },

  // Meta row
  cardMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },

  // Footer row
  cardNote: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 5,
    paddingTop: 6, paddingBottom: 8,
  },
  cardNoteTxt: { flex: 1, fontSize: 12, color: Colors.textSecondary, fontStyle: 'italic' },
  cardFooter: {
    flexDirection: 'row', alignItems: 'center',
    borderTopWidth: 1, borderTopColor: Colors.divider, paddingTop: 10,
  },
  itemsLabel: { flex: 1 },
  totalText:  { fontSize: 16, fontWeight: '800', color: Colors.text, marginRight: 12 },
  actionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.primaryMuted, borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 6,
  },
  actionBtnText: { fontSize: 12, color: Colors.primary, fontWeight: '700' },

  // Generate footer
  genFooter: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    paddingHorizontal: 16, paddingVertical: 12,
    backgroundColor: Colors.surface, borderTopWidth: 1, borderTopColor: Colors.divider,
  },
  genBtnRow: { flexDirection: 'row', gap: 10 },
  shareBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#2563EB', borderRadius: 14, paddingVertical: 14,
  },
  genBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 14,
  },
  genBtnTxt: { fontSize: 14, fontWeight: '700', color: '#fff' },

  // States
  center:       { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, gap: 12 },
  centerMsg:    { textAlign: 'center', fontSize: 14 },
  retryBtn:     { paddingHorizontal: 24, paddingVertical: 10, borderRadius: 20, borderWidth: 1.5, borderColor: Colors.primary },
  emptyIcon:    { width: 72, height: 72, borderRadius: 24, backgroundColor: Colors.primaryMuted, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  emptyTitle:   { fontSize: 16, fontWeight: '700', color: Colors.text, textAlign: 'center' },
  emptySubtitle:{ fontSize: 13, color: Colors.textSecondary, textAlign: 'center' },

  fab: {
    position: 'absolute', bottom: 28, right: 24,
    width: 58, height: 58, borderRadius: 29,
    backgroundColor: Colors.primary,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: Colors.primary, shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.45, shadowRadius: 14, elevation: 10,
  },
});

// ─── Confirm Summary Modal Styles ────────────────────────────────────────────
const cs = StyleSheet.create({
  backdrop: {
    flexGrow: 1,
    backgroundColor: 'rgba(15,23,42,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 40,
  },
  card: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: Colors.surface,
    borderRadius: 20,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.18,
    shadowRadius: 32,
    elevation: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 20,
    textAlign: 'center',
  },
  table: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.divider,
    overflow: 'hidden',
    marginBottom: 16,
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: Colors.background,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  headerText: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.textSecondary,
    textTransform: 'uppercase',
  },
  row: {
    flexDirection: 'row',
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderTopWidth: 1,
    borderTopColor: Colors.divider,
  },
  rowText: { fontSize: 13, color: Colors.text },
  colInv:    { flex: 2.5 },
  colCampus: { flex: 1.5, textAlign: 'center' },
  colPeriod: { flex: 1.5, textAlign: 'center' },
  colAmt:    { flex: 2, textAlign: 'right' },
  totalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderTopWidth: 1.5,
    borderTopColor: Colors.divider,
    marginBottom: 16,
  },
  totalLabel:  { fontSize: 15, fontWeight: '600', color: Colors.textSecondary },
  totalAmount: { fontSize: 28, fontWeight: '800', color: Colors.text },
  fieldWrapper: { marginBottom: 16, gap: 6 },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  fieldInput: {
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 13,
    color: Colors.text,
    backgroundColor: Colors.background,
    minHeight: 60,
    textAlignVertical: 'top',
  },
  btnRow: { flexDirection: 'row', gap: 10 },
  btnCancel: {
    flex: 1, height: 48, borderRadius: 12,
    borderWidth: 1.5, borderColor: Colors.divider,
    alignItems: 'center', justifyContent: 'center',
  },
  btnCancelText: { fontSize: 15, fontWeight: '600', color: Colors.textSecondary },
  btnCreate: {
    flex: 1, height: 48, borderRadius: 12,
    backgroundColor: Colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  btnCreateText: { fontSize: 15, fontWeight: '700', color: '#fff' },
});

export default RentalInvoiceListScreen;
