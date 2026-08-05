import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal,
  ActivityIndicator, FlatList, RefreshControl,
} from 'react-native';
import { MaterialIcons as Icon } from '@expo/vector-icons';
import { WebView } from 'react-native-webview';
import * as Print from 'expo-print';
import AppBar from '../../components/AppBar';
import AppText from '../../components/AppText';
import { useAlert } from '../../components/AppAlert';
import LOGO_BASE64 from '../../logo/logoBase64';
import {
  getRentalInvoiceHeadersApi,
  ApiRentalInvoiceHeader,
  createInvoiceSummaryApi,
} from '../../services/focusApi';

// ─── Constants ────────────────────────────────────────────────────────────────
const COMPANY = {
  name:    'FOCUS LAB',
  addr1:   '#17 St 480, Sangkat Toul Toum Pong 1',
  addr2:   'Khan Chamkarmon, Phnom Penh 12310',
  abaAccount: '003 257 965',
  abaHolder:  'SOVITHIA SEN AND TONG LYHEANG<br/>AND TE SOPHIE',
};

const MONTH_LONG  = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const P   = '#546E7A';
const P_D = '#37474F';
const BDR = '#EEEEEE';

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmtPeriod = (iso?: string | null): string => {
  if (!iso) return '—';
  try {
    const [y, m] = iso.split('-').map(Number);
    return `${MONTH_SHORT[m - 1]} ${y}`;
  } catch { return iso ?? '—'; }
};

const fmtDate = (iso?: string | null): string => {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return `${d.getDate()} ${MONTH_SHORT[d.getMonth()]} ${d.getFullYear()}`;
  } catch { return iso ?? '—'; }
};

const fmtMoney = (cents?: number | string | null): string => {
  if (cents == null) return '$0.00';
  const n = typeof cents === 'string' ? Number(cents) : cents;
  return `$${(n / 100).toFixed(2)}`;
};


// ─── Build rental summary HTML (same style as sale invoice summary) ───────────
const buildRentalSummaryHTML = (
  headers: ApiRentalInvoiceHeader[],
  summaryNumber: string,
  receivedNote?: string | null,
): string => {
  const invoices = [...headers].sort((a, b) =>
    (a.invoiceNumber ?? '').localeCompare(b.invoiceNumber ?? ''),
  );

  let rowNo = 1;
  let grandUsage = 0;
  let grandTotal = 0;

  const dataRows = invoices.map(inv => {
    const totalPrice = Number(inv.totalCents ?? 0) / 100;
    const lines: any[] = (inv as any).lines ?? inv.details ?? [];

    type Row = { campus: string; start: number; end: number };
    let rows: Row[];
    if (lines.length > 0) {
      rows = lines.map((l: any) => ({
        campus: l.campusCode ?? l.campusNameEn ?? l.lineLabel ?? '—',
        start:  Number(l.counterBwStart ?? l.startCount ?? 0),
        end:    Number(l.counterBwEnd   ?? l.endCount   ?? 0),
      }));
    } else {
      rows = [{ campus: '—', start: 0, end: 0 }];
    }

    const usage = rows.reduce((s, r) => s + Math.max(0, r.end - r.start), 0);
    const pricePerPage = usage > 0 ? totalPrice / usage : 0;
    grandUsage += usage;
    grandTotal += totalPrice;

    const n = rows.length;
    const subCells = rows.map((r, ri) => {
      const bdr = ri < n - 1 ? 'border-bottom:1px solid #e8e8e8;' : '';
      const u   = Math.max(0, r.end - r.start);
      return `
        <tr>
          <td class="c" style="${bdr}">${rowNo++}</td>
          ${ri === 0 ? `<td rowspan="${n}" style="font-weight:700;vertical-align:middle;border-right:1px solid #e8e8e8;">${inv.invoiceNumber ?? '—'}</td>` : ''}
          <td class="c" style="${bdr}border-right:1px solid #e8e8e8;">${r.campus}</td>
          <td class="r" style="${bdr}border-right:1px solid #e8e8e8;">${r.start.toLocaleString()}</td>
          <td class="r" style="${bdr}border-right:1px solid #e8e8e8;font-weight:600;">${r.end.toLocaleString()}</td>
          <td class="r" style="${bdr}border-right:1px solid #e8e8e8;font-weight:700;">${u.toLocaleString()}</td>
          ${ri === 0 ? `<td class="r" rowspan="${n}" style="vertical-align:middle;border-right:1px solid #e8e8e8;">$${pricePerPage.toFixed(5)}</td>` : ''}
          ${ri === 0 ? `<td class="r" rowspan="${n}" style="vertical-align:middle;font-weight:700;">$${totalPrice.toFixed(2)}</td>` : ''}
        </tr>`;
    }).join('');
    return subCells;
  }).join('');

  // Period label from first invoice's periodMonth
  let periodLabel = summaryNumber;
  const firstPeriod = invoices[0]?.periodMonth;
  if (firstPeriod) {
    try {
      const [y, m] = firstPeriod.split('-').map(Number);
      periodLabel = `${MONTH_LONG[m - 1]} ${y}`;
    } catch { /* keep summaryNumber */ }
  }

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"/>
<style>
  @page { size: A4 portrait; margin: 15mm; }
  *, *::before, *::after { margin:0; padding:0; box-sizing:border-box; font-family:'Times New Roman',Times,serif; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  html, body { font-family:'Times New Roman',Times,serif; font-size:11px; color:#000; background:#fff; }
  table, thead, tbody, tfoot, tr, th, td { font-family:'Times New Roman',Times,serif; }
  .page { padding:20px; min-height:257mm; display:flex; flex-direction:column; }
  .hdr { display:flex; align-items:center; gap:14px; margin-bottom:6px; }
  .logo { width:54px; height:54px; border-radius:10px; overflow:hidden; flex-shrink:0; }
  .logo img { width:54px; height:54px; display:block; }
  .hdr-info { flex:1; }
  .co-name { font-size:14px; font-weight:900; letter-spacing:1px; text-transform:uppercase; }
  .co-sub { font-size:9px; color:#555; margin-top:2px; }
  .summary-number { font-size:13px; font-weight:700; color:#666; text-align:right; letter-spacing:0.5px; }
  .report-title { font-size:16px; font-weight:900; text-align:right; color:#2563EB; }
  .report-date { font-size:9px; color:#888; text-align:right; margin-top:2px; }
  hr { border:none; border-top:1.5px solid #000; margin:8px 0; }
  .period-label { font-size:11px; color:#444; margin:6px 0 10px 0; }
  table { width:100%; border-collapse:collapse; margin-top:10px; }
  thead tr { background:#EFF6FF; }
  thead th { padding:8px 6px; font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:0.4px; border-bottom:1.5px solid #000; border-right:1px solid #d0d0d0; }
  thead th:last-child { border-right:none; }
  tbody td { padding:7px 6px; font-size:11px; border-bottom:1px solid #e8e8e8; vertical-align:middle; }
  tbody tr:nth-child(even) { background:#FAFAFA; }
  tfoot tr { background:#EFF6FF; }
  tfoot td { padding:9px 6px; font-size:14px; font-weight:800; border-top:2px solid #000; }
  .c { text-align:center; }
  .r { text-align:right; }
  .total-lbl { font-size:12px; font-weight:700; color:#2563EB; }
  .bottom { display:flex; gap:20px; margin-top:24px; align-items:flex-start; }
  .bank-box { flex:1; border:1px solid #d0d0d0; border-radius:6px; overflow:hidden; }
  .bank-title { background:#EFF6FF; padding:6px 10px; font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:0.5px; color:#2563EB; border-bottom:1px solid #d0d0d0; }
  .bank-row { display:flex; padding:5px 10px; border-bottom:1px solid #f0f0f0; }
  .bank-row:last-child { border-bottom:none; }
  .bank-lbl { width:110px; font-size:10px; color:#666; font-weight:600; flex-shrink:0; }
  .bank-val { font-size:10px; font-weight:700; color:#000; }
  .page-footer { margin-top:auto; padding-top:24px; }
  .sig-section { display:flex; gap:16px; padding-top:8px; }
  .sig-col { flex:1; display:flex; flex-direction:column; align-items:center; gap:6px; }
  .sig-line { width:100%; border-bottom:1.5px solid #000; margin-bottom:4px; height:40px; }
  .sig-label { font-size:10px; font-weight:700; color:#444; text-align:center; }
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
      ${summaryNumber ? `<div class="summary-number">${summaryNumber}</div>` : ''}
      <div class="report-title">RENTAL INVOICE SUMMARY</div>
      <div class="report-date">Generated: ${new Date().toLocaleDateString('en-US', { day:'numeric', month:'short', year:'numeric' })}</div>
    </div>
  </div>
  <hr/>
  ${periodLabel ? `<div class="period-label">${periodLabel}</div>` : ''}
  ${receivedNote?.trim() ? `<div style="font-size:10px;color:#444;font-style:italic;font-weight:700;margin-bottom:4px;"><b>Note:</b> ${receivedNote.trim()}</div>` : ''}
  <table>
    <thead>
      <tr>
        <th class="c" style="width:36px">No</th>
        <th>Invoice #</th>
        <th class="c" style="width:80px">Campus</th>
        <th class="r" style="width:80px">Start BW</th>
        <th class="r" style="width:80px">End BW</th>
        <th class="r" style="width:70px">Usage</th>
        <th class="r" style="width:90px">Price/Page</th>
        <th class="r" style="width:80px">Total (USD)</th>
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
      <div class="bank-row"><span class="bank-lbl">Bank Name</span><span class="bank-val">ABA Bank</span></div>
      <div class="bank-row"><span class="bank-lbl">Account Name</span><span class="bank-val">${COMPANY.abaHolder.replace(/<br\/>/g, ' ')}</span></div>
      <div class="bank-row"><span class="bank-lbl">Account Number</span><span class="bank-val">${COMPANY.abaAccount}</span></div>
    </div>
  </div>
  <div class="page-footer">
    <div class="sig-section">
      <div class="sig-col"><div class="sig-line"></div><div class="sig-label">Received By</div></div>
      <div class="sig-col"><div class="sig-line"></div><div class="sig-label">Authorised By</div></div>
    </div>
  </div>
</div>
</body></html>`;
};

// ─── Phase type ───────────────────────────────────────────────────────────────
type Phase = 'select' | 'creating' | 'result';

// ─── Props ────────────────────────────────────────────────────────────────────
interface Props { onBack: () => void; }

// ─── Screen ───────────────────────────────────────────────────────────────────
const RentalInvoiceSummaryScreen: React.FC<Props> = ({ onBack }) => {
  const { showAlert } = useAlert();

  // ── Invoice list ──
  const [invoices,   setInvoices]   = useState<ApiRentalInvoiceHeader[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error,      setError]      = useState<string | null>(null);

  // ── Selection ──
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // ── Phase + result ──
  const [phase,         setPhase]         = useState<Phase>('select');
  const [summaryNumber, setSummaryNumber] = useState('');
  const [summaryHtml,   setSummaryHtml]   = useState('');
  const [printing,      setPrinting]      = useState(false);
  const [createError,   setCreateError]   = useState<string | null>(null);

  // ── Load invoices ──
  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const raw = await getRentalInvoiceHeadersApi();
      const seen = new Set<string>();
      setInvoices(raw.filter(h => { const k = String(h.id); if (seen.has(k)) return false; seen.add(k); return true; }));
    } catch (e: any) {
      const msg = e?.message ?? 'Failed to load invoices';
      setError(msg);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const onRefresh = useCallback(() => { setRefreshing(true); load(true); }, [load]);

  // ── Selection helpers ──
  const toggle = useCallback((id: string) => {
    setSelected(prev => {
      const key = String(id);
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }, []);

  const selectableInvoices = useMemo(
    () => invoices.filter(i => !i.summaryNumber),
    [invoices],
  );

  const toggleAll = useCallback(() => {
    setSelected(prev =>
      prev.size === selectableInvoices.length
        ? new Set()
        : new Set(selectableInvoices.map(i => String(i.id))),
    );
  }, [selectableInvoices]);

  const allSelected = selectableInvoices.length > 0 && selected.size === selectableInvoices.length;

  // ── Create summary ──
  const handleGenerate = useCallback(async () => {
    if (selected.size === 0) return;
    const selectedHeaders = invoices.filter(i => selected.has(String(i.id)));
    setPhase('creating');
    setCreateError(null);
    try {
      const created = await createInvoiceSummaryApi({
        invoiceIds: [...selected],
        rateUsed:   4100,
      });
      setSummaryHtml(buildRentalSummaryHTML(selectedHeaders, created.summaryNumber, created.receivedNote ?? created.description));
      setSummaryNumber(created.summaryNumber);
      setSelected(new Set());
      setPhase('result');
    } catch (e: any) {
      const msg = e?.message ?? 'Failed to create summary';
      setCreateError(msg);
      showAlert({ type: 'error', title: 'Error', message: msg });
      setPhase('select');
    }
  }, [selected, invoices, showAlert]);

  const handlePrint = useCallback(async () => {
    setPrinting(true);
    try {
      await Print.printAsync({ html: summaryHtml });
    } catch (e: any) {
      if (e?.message !== 'User cancelled') {
        showAlert({ type: 'error', title: 'Print Error', message: e?.message ?? 'Failed to print' });
      }
    } finally {
      setPrinting(false);
    }
  }, [summaryHtml, summaryNumber, showAlert]);

  // ─────────────────────────────────────────────────────────────────────────────
  // ── RESULT VIEW ──
  // ─────────────────────────────────────────────────────────────────────────────
  if (phase === 'result' && summaryHtml) {
    return (
      <Modal visible animationType="slide" onRequestClose={() => { setPhase('select'); setSummaryNumber(''); }}>
        <View style={s.previewWrap}>
          <View style={s.previewBar}>
            <AppText style={s.previewTitle}>{summaryNumber || 'Rental Summary'}</AppText>
            <View style={s.previewActions}>
              <TouchableOpacity
                style={s.printBtn}
                onPress={handlePrint}
                disabled={printing}
              >
                {printing
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Icon name="print" size={18} color="#fff" />}
                <AppText style={s.printBtnTxt}>Print</AppText>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => { setPhase('select'); setSummaryNumber(''); }}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Icon name="close" size={24} color="#fff" />
              </TouchableOpacity>
            </View>
          </View>
          <View style={s.webviewWrap}>
            <WebView
              source={{ html: summaryHtml, baseUrl: '' }}
              originWhitelist={['*']}
              style={s.webview}
            />
          </View>
        </View>
      </Modal>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // ── CREATING VIEW ──
  // ─────────────────────────────────────────────────────────────────────────────
  if (phase === 'creating') {
    return (
      <View style={s.safe}>
        <AppBar title="Create Summary" titleAlign="left" showBack onBack={onBack} />
        <View style={s.center}>
          <ActivityIndicator size="large" color={P} />
          <AppText style={s.creatingTxt}>Saving summary…</AppText>
        </View>
      </View>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // ── SELECT VIEW ──
  // ─────────────────────────────────────────────────────────────────────────────
  const renderItem = ({ item }: { item: ApiRentalInvoiceHeader }) => {
    const summarized = !!item.summaryNumber;
    const isOn = !summarized && selected.has(String(item.id));
    return (
      <TouchableOpacity
        style={[s.card, isOn && s.cardSelected, summarized && s.cardSummarized]}
        activeOpacity={summarized ? 1 : 0.8}
        onPress={() => { if (!summarized) toggle(String(item.id)); }}
      >
        <View style={[s.checkbox, isOn && s.checkboxOn, summarized && s.checkboxDone]}>
          {isOn && <Icon name="check" size={14} color="#fff" />}
          {summarized && <Icon name="check" size={14} color="#16A34A" />}
        </View>

        <View style={s.cardBody}>
          <View style={s.cardRow}>
            <AppText style={[s.invNum, summarized && s.textMuted]}>{item.invoiceNumber ?? '—'}</AppText>
            <AppText style={[s.amount, summarized && s.textMuted]}>{fmtMoney(item.totalCents)}</AppText>
          </View>
          <View style={s.cardRow}>
            <AppText style={s.cardMeta} numberOfLines={1}>
              {item.customerOrg?.nameEn ?? '—'}
            </AppText>
            <AppText style={s.cardPeriod}>{fmtPeriod(item.periodMonth)}</AppText>
          </View>
          {summarized ? (
            <View style={s.summaryBadge}>
              <Icon name="task-alt" size={11} color="#16A34A" />
              <AppText style={s.summaryBadgeTxt}>{item.summaryNumber}</AppText>
            </View>
          ) : (
            <AppText style={s.cardDate}>
              {fmtDate(item.startDate)} – {fmtDate(item.endDate)}
            </AppText>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={s.safe}>
      <AppBar
        title="Create Summary"
        subtitle="Select invoices to include"
        titleAlign="left"
        showBack
        onBack={onBack}
      />

      {/* Select All bar */}
      {!loading && !error && invoices.length > 0 && (
        <View style={s.selBar}>
          <TouchableOpacity style={s.selAllBtn} onPress={toggleAll} activeOpacity={0.75}>
            <View style={[s.checkbox, allSelected && s.checkboxOn]}>
              {allSelected && <Icon name="check" size={14} color="#fff" />}
            </View>
            <AppText style={s.selAllTxt}>
              {allSelected ? 'Deselect All' : 'Select All'}
            </AppText>
          </TouchableOpacity>
          <AppText style={s.selCount}>
            {selected.size} / {invoices.length} selected
          </AppText>
        </View>
      )}

      {loading ? (
        <View style={s.center}>
          <ActivityIndicator size="large" color={P} />
        </View>
      ) : error ? (
        <View style={s.center}>
          <Icon name="cloud-off" size={36} color="#9E9E9E" />
          <AppText style={s.errorTxt}>{error}</AppText>
          <TouchableOpacity style={s.retryBtn} onPress={() => load()}>
            <AppText style={s.retryTxt}>Retry</AppText>
          </TouchableOpacity>
        </View>
      ) : invoices.length === 0 ? (
        <View style={s.center}>
          <Icon name="summarize" size={40} color="#BDBDBD" />
          <AppText style={s.emptyTitle}>No rental invoices found</AppText>
        </View>
      ) : (
        <FlatList
          data={invoices}
          keyExtractor={item => item.id}
          renderItem={renderItem}
          contentContainerStyle={s.list}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={P} />
          }
        />
      )}

      {/* Generate button */}
      {selected.size > 0 && (
        <View style={s.footer}>
          <TouchableOpacity style={s.generateBtn} activeOpacity={0.85} onPress={handleGenerate}>
            <Icon name="summarize" size={20} color="#fff" />
            <Text style={s.generateTxt}>Generate Summary ({selected.size})</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F0F4F8' },

  selBar: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#fff',
    paddingHorizontal: 16, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: BDR,
    justifyContent: 'space-between',
  },
  selAllBtn: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  selAllTxt: { fontSize: 14, fontWeight: '600', color: P_D },
  selCount:  { fontSize: 13, color: P, fontWeight: '600' },

  checkbox: {
    width: 22, height: 22, borderRadius: 6,
    borderWidth: 2, borderColor: '#BDBDBD',
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#fff',
  },
  checkboxOn: { backgroundColor: P, borderColor: P },

  list: { padding: 12, gap: 8, paddingBottom: 100 },

  card: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#fff', borderRadius: 12, padding: 14,
    borderWidth: 2, borderColor: 'transparent',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 4, elevation: 2,
  },
  cardSelected:   { borderColor: P, backgroundColor: '#EEF3F5' },
  cardSummarized: { opacity: 0.75, backgroundColor: '#F9FFF9' },
  cardBody:       { flex: 1, gap: 4 },
  cardRow:        { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  invNum:         { fontSize: 14, fontWeight: '700', color: P_D },
  amount:         { fontSize: 14, fontWeight: '800', color: P },
  cardMeta:       { fontSize: 12, color: '#757575', flex: 1 },
  cardPeriod:     { fontSize: 12, fontWeight: '600', color: P_D },
  cardDate:       { fontSize: 11, color: '#9E9E9E' },
  textMuted:      { color: '#9E9E9E' },
  checkboxDone:   { borderColor: '#16A34A', backgroundColor: '#F0FDF4' },
  summaryBadge:   { flexDirection: 'row', alignItems: 'center', gap: 4 },
  summaryBadgeTxt:{ fontSize: 11, color: '#16A34A', fontWeight: '600' },

  center:      { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  creatingTxt: { fontSize: 14, color: P_D, marginTop: 8 },
  errorTxt:    { fontSize: 14, color: '#757575', textAlign: 'center', paddingHorizontal: 32 },
  emptyTitle:  { fontSize: 16, fontWeight: '700', color: '#37474F' },
  retryBtn:    { paddingHorizontal: 24, paddingVertical: 10, borderRadius: 20, borderWidth: 1.5, borderColor: P },
  retryTxt:    { fontSize: 14, fontWeight: '600', color: P },

  footer: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    paddingHorizontal: 16, paddingVertical: 12,
    backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: BDR,
  },
  generateBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: P, borderRadius: 14, paddingVertical: 14,
  },
  generateTxt: { fontSize: 15, fontWeight: '700', color: '#fff' },

  previewWrap:    { flex: 1, backgroundColor: '#1E293B' },
  previewBar:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, paddingTop: 50, backgroundColor: '#1E293B' },
  previewTitle:   { fontSize: 16, fontWeight: '700', color: '#fff', flex: 1 },
  previewActions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  printBtn:       { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#2563EB', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 7 },
  printBtnTxt:    { fontSize: 13, fontWeight: '700', color: '#fff' },
  webviewWrap:    { flex: 1, padding: 8 },
  webview:        { flex: 1, backgroundColor: '#fff', borderRadius: 8 },
});

export default RentalInvoiceSummaryScreen;
