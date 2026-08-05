import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
  Share,
  Image,
  StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons as Icon } from '@expo/vector-icons';
import LottieView from 'lottie-react-native';
import * as Print from 'expo-print';
import Colors from '../../theme/colors';
import AppText from '../../components/AppText';
import AppBar from '../../components/AppBar';
import { useAlert } from '../../components/AppAlert';
import DatePickerModal from '../../components/DatePickerModal';
import LOGO_BASE64 from '../../logo/logoBase64';
import {
  getVendorPayablesApi,
  getPurchaseOrderApi,
  payVendorPayableApi,
  getVendorsApi,
  getRoutesApi,
  ApiVendorPayable,
  ApiVendor,
  ApiRoute,
} from '../../services/focusApi';

interface Props {
  onBack: () => void;
}

const fmtMoney = (cents?: number | null) =>
  cents != null ? `$${(cents / 100).toFixed(2)}` : '$0.00';

const fmtDate = (iso?: string) => {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' }); }
  catch { return iso; }
};

const todayISO = () => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};
const startOfMonth = () => { const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d; };
const toISO = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const PAGE_SIZE = 20;

const PAY_METHODS = [
  { label: 'Cash',          value: 'CASH' },
  { label: 'Bank Transfer', value: 'BANK_TRANSFER' },
  { label: 'Other',         value: 'OTHER' },
];

const STATUS_STYLE: Record<string, { color: string; bg: string; label: string }> = {
  UNPAID:  { color: '#EF4444', bg: '#FEE2E2', label: 'Unpaid' },
  PARTIAL: { color: '#F59E0B', bg: '#FEF3C7', label: 'Partial' },
  PAID:    { color: '#10B981', bg: '#D1FAE5', label: 'Paid' },
};

const ROW_COLORS = ['#2563EB', '#7C3AED', '#10B981', '#F59E0B', '#EF4444', '#06B6D4'];

const VendorPayablesScreen: React.FC<Props> = ({ onBack }) => {
  const { showAlert } = useAlert();

  // ── List state ───────────────────────────────────────────────────────────
  const [bills, setBills] = useState<ApiVendorPayable[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [totalCount, setTotalCount] = useState(0);

  // ── Filter inputs ────────────────────────────────────────────────────────
  const [pvcInput, setPvcInput] = useState('');
  const [filterVendor, setFilterVendor] = useState<ApiVendor | null>(null);
  const [filterVendorSearch, setFilterVendorSearch] = useState('');
  const [showVendorModal, setShowVendorModal] = useState(false);
  const [fromDate, setFromDate] = useState<Date>(startOfMonth());
  const [toDate, setToDate] = useState<Date>(new Date());
  const [datePicker, setDatePicker] = useState<'from' | 'to' | null>(null);
  const [filterRoute, setFilterRoute] = useState<ApiRoute | null>(null);

  // Applied filters (set on Filter button press)
  const [appliedFilters, setAppliedFilters] = useState<{
    pvcNumber?: string;
    vendorId?: number;
    from: string;
    to: string;
    routeId?: number;
  }>({ from: toISO(startOfMonth()), to: toISO(new Date()) });

  // ── Vendor picker data ───────────────────────────────────────────────────
  const [vendors, setVendors] = useState<ApiVendor[]>([]);
  const [vendorsLoading, setVendorsLoading] = useState(false);

  // ── Routes data ──────────────────────────────────────────────────────────
  const [routes, setRoutes] = useState<ApiRoute[]>([]);

  // ── Preview ──────────────────────────────────────────────────────────────
  const [screenView, setScreenView] = useState<'list' | 'preview'>('list');
  const [previewingBill, setPreviewingBill] = useState<ApiVendorPayable | null>(null);
  const [printLoading, setPrintLoading] = useState(false);

  // ── Pay modal ────────────────────────────────────────────────────────────
  const [payingBill, setPayingBill] = useState<ApiVendorPayable | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payRateUsed, setPayRateUsed] = useState('4100');
  const [payPaidAt, setPayPaidAt] = useState(todayISO());
  const [payDatePicker, setPayDatePicker] = useState(false);
  const [payMethod, setPayMethod] = useState('BANK_TRANSFER');
  const [payNote, setPayNote] = useState('');
  const [paying, setPaying] = useState(false);
  const [payConfirmVisible, setPayConfirmVisible] = useState(false);

  // ── Load bills ───────────────────────────────────────────────────────────
  const enrichWithPoNotes = async (items: ApiVendorPayable[]): Promise<ApiVendorPayable[]> => {
    const uniquePoIds = [...new Set(items.map(b => b.poId).filter((id): id is number => id != null))];
    if (uniquePoIds.length === 0) return items;
    const poResults = await Promise.allSettled(uniquePoIds.map(id => getPurchaseOrderApi(id)));
    const poMap: Record<number, { poNumber?: string; receiptNote?: string | null }> = {};
    poResults.forEach((r, i) => {
      if (r.status === 'fulfilled') {
        poMap[uniquePoIds[i]] = {
          poNumber:    r.value.poNumber,
          receiptNote: r.value.receiptNote,
        };
      }
    });
    return items.map(b => {
      if (b.poId == null || !poMap[b.poId]) return b;
      const po = poMap[b.poId];
      return {
        ...b,
        poNumber:    b.poNumber ?? po.poNumber,
        receiptNote: b.receiptNote ?? po.receiptNote ?? undefined,
      };
    });
  };

  const load = useCallback((silent = false, filters?: typeof appliedFilters) => {
    if (!silent) setLoading(true);
    setError(null);
    const f = filters ?? appliedFilters;
    getVendorPayablesApi({ ...f, limit: PAGE_SIZE })
      .then(async ({ items, nextCursor: nc, totalCount: tc }) => {
        const enriched = await enrichWithPoNotes(items);
        setBills(enriched);
        setNextCursor(nc);
        setHasMore(nc !== null);
        setTotalCount(tc);
      })
      .catch(err => setError(err?.message ?? 'Failed to load vendor payables'))
      .finally(() => { setLoading(false); setRefreshing(false); });
  }, [appliedFilters]);

  const loadMore = useCallback(() => {
    if (loadingMore || !hasMore || nextCursor == null) return;
    setLoadingMore(true);
    getVendorPayablesApi({ ...appliedFilters, cursor: nextCursor, limit: PAGE_SIZE })
      .then(async ({ items, nextCursor: nc }) => {
        const enriched = await enrichWithPoNotes(items);
        setBills(prev => [...prev, ...enriched]);
        setNextCursor(nc);
        setHasMore(nc !== null);
      })
      .catch(() => {})
      .finally(() => setLoadingMore(false));
  }, [loadingMore, hasMore, nextCursor, appliedFilters]);

  useEffect(() => { load(); }, [load]);

  // ── Load vendors (lazy) ──────────────────────────────────────────────────
  const ensureVendors = () => {
    if (vendors.length > 0 || vendorsLoading) return;
    setVendorsLoading(true);
    getVendorsApi()
      .then(setVendors)
      .catch(() => {})
      .finally(() => setVendorsLoading(false));
  };

  // ── Load routes on mount ─────────────────────────────────────────────────
  useEffect(() => {
    getRoutesApi().then(setRoutes).catch(() => {});
  }, []);

  // ── Apply filters ────────────────────────────────────────────────────────
  const doFilter = useCallback(() => {
    const newFilters = {
      pvcNumber: pvcInput.trim() || undefined,
      vendorId:  filterVendor ? Number(filterVendor.id) : undefined,
      from:      toISO(fromDate),
      to:        toISO(toDate),
      routeId:   filterRoute ? Number(filterRoute.id) : undefined,
    };
    setAppliedFilters(newFilters);
    load(false, newFilters);
  }, [pvcInput, filterVendor, fromDate, toDate, filterRoute, load]);

  // ── Filtered vendors in picker search ────────────────────────────────────
  const filteredVendors = useMemo(() => {
    const q = filterVendorSearch.trim().toLowerCase();
    if (!q) return vendors;
    return vendors.filter(v =>
      (v.nameEn ?? '').toLowerCase().includes(q) ||
      (v.nameKm ?? '').toLowerCase().includes(q) ||
      (v.code ?? '').toLowerCase().includes(q),
    );
  }, [vendors, filterVendorSearch]);

  const totalOutstandingCents = useMemo(
    () => bills.reduce((s, b) => {
      if (b.status === 'PAID') return s;
      return s + (b.balanceCents ?? Math.max(0, b.totalCents - (b.paidCents ?? b.paidAmountCents ?? 0)));
    }, 0),
    [bills],
  );

  const totalPaidCents = useMemo(
    () => bills.reduce((s, b) => s + (b.paidCents ?? b.paidAmountCents ?? 0), 0),
    [bills],
  );

  const paidCount    = useMemo(() => bills.filter(b => b.status === 'PAID').length, [bills]);
  const pendingCount = useMemo(() => bills.filter(b => b.status !== 'PAID').length, [bills]);

  // ── Pay modal helpers ────────────────────────────────────────────────────
  const openPayModal = (bill: ApiVendorPayable) => {
    const balance = bill.balanceCents ??
      Math.max(0, bill.totalCents - (bill.paidCents ?? bill.paidAmountCents ?? 0));
    setPayingBill(bill);
    setPayAmount((balance / 100).toFixed(2));
    setPayRateUsed(String(bill.rateUsed ?? 4100));
    setPayPaidAt(todayISO());
    setPayDatePicker(false);
    setPayMethod('BANK_TRANSFER');
    setPayNote('');
  };

  const submitPay = useCallback(async (bill: ApiVendorPayable, amountCents: number) => {
    setPaying(true);
    try {
      const result = await payVendorPayableApi(bill.id, {
        amountCents,
        rateUsed: Number(payRateUsed) || 4100,
        paidAt:   payPaidAt,
        method:   payMethod,
        note:     payNote || undefined,
      });
      setPayingBill(null);
      setTimeout(() => {
        showAlert({
          type:     'success',
          title:    result?.billStatus === 'PAID' ? 'Bill Fully Paid' : 'Payment Recorded',
          message:  result?.billStatus === 'PAID'
            ? `${bill.billNo} is now fully paid.`
            : `${fmtMoney(amountCents)} recorded. Balance: ${fmtMoney(result?.balanceCents ?? 0)}.`,
          autoClose: 2500,
        });
      }, 350);
      load(true);
    } catch (err: any) {
      Alert.alert('Payment Failed', err?.message ?? 'Failed to record payment');
    } finally {
      setPaying(false);
    }
  }, [payRateUsed, payPaidAt, payMethod, payNote, load, showAlert]);

  const handlePay = useCallback(() => {
    if (!payingBill) return;
    const amountCents = Math.round(Number(payAmount || '0') * 100);
    if (!amountCents || amountCents <= 0) {
      Alert.alert('Invalid Amount', 'Please enter a valid payment amount in dollars.');
      return;
    }
    setPayConfirmVisible(true);
  }, [payingBill, payAmount]);

  // ── Preview / Print ──────────────────────────────────────────────────────
  const openPreview = (bill: ApiVendorPayable) => {
    setPrintLoading(false);
    setPreviewingBill(bill);
    setScreenView('preview');
  };

  const buildBillHTML = (bill: ApiVendorPayable): string => {
    const vendorName = bill.vendorName ?? bill.vendor?.nameEn ?? `Vendor #${bill.vendorId ?? '?'}`;
    const balance = bill.balanceCents ??
      Math.max(0, bill.totalCents - (bill.paidCents ?? bill.paidAmountCents ?? 0));
    const statusLabel = bill.status === 'PAID' ? 'Paid' : bill.status === 'PARTIAL' ? 'Partial' : 'Unpaid';
    const statusColor = bill.status === 'PAID' ? '#10B981' : bill.status === 'PARTIAL' ? '#F59E0B' : '#EF4444';
    const payments = bill.payments ?? [];

    const paymentRows = payments.length > 0
      ? payments.map((p, i) => `
        <tr style="background:${i % 2 === 0 ? '#fff' : '#f9fafb'}">
          <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb">${i + 1}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb">${p.paidAt?.slice(0, 10) ?? '—'}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb">${p.method ?? '—'}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:700">$${(Number(p.amountCents) / 100).toFixed(2)}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb">${p.note ?? ''}</td>
        </tr>`).join('')
      : `<tr><td colspan="5" style="padding:12px;text-align:center;color:#9ca3af">No payment records</td></tr>`;

    return `<!DOCTYPE html><html><head><meta charset="UTF-8"/>
<style>
  @page{size:A5 portrait;margin:0}
  *{margin:0;padding:0;box-sizing:border-box;-webkit-print-color-adjust:exact}
  body{font-family:Arial,Helvetica,sans-serif;font-size:10px;color:#111;background:#fff;padding:20px 24px}

  /* ── Header ── */
  .hdr{display:flex;align-items:center;gap:12px;margin-bottom:10px}
  .logo img{width:52px;height:52px;border-radius:8px}
  .hdr-center{flex:1}
  .co-name{font-size:15px;font-weight:900;letter-spacing:2px;text-transform:uppercase;color:#111}
  .co-addr{font-size:8px;color:#6b7280;line-height:1.5;margin-top:2px}
  .doc-badge{display:inline-block;margin-top:5px;padding:2px 10px;border-radius:4px;font-size:9px;font-weight:800;letter-spacing:1px;text-transform:uppercase;background:#1e3a5f;color:#fff}

  /* ── Divider ── */
  .hr{border:none;border-top:1.5px solid #1e3a5f;margin:8px 0}

  /* ── Info rows ── */
  .info-section{margin-bottom:10px}
  .info-row{display:flex;margin-bottom:4px}
  .info-row .lbl{width:90px;font-size:8px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.4px;padding-top:1px}
  .info-row .val{flex:1;font-size:10px;font-weight:600;color:#111}
  .info-row .val.red{color:#ef4444}
  .status-pill{display:inline-block;padding:1px 8px;border-radius:3px;font-weight:700;font-size:9px;color:${statusColor};background:${statusColor}22;border:1px solid ${statusColor}44}

  /* ── Amount boxes ── */
  .amounts{display:flex;border:1.5px solid #1e3a5f;border-radius:6px;overflow:hidden;margin-bottom:12px}
  .amt-box{flex:1;padding:8px 10px;text-align:center}
  .amt-box+.amt-box{border-left:1px solid #d1d5db}
  .amt-box.highlight{background:#1e3a5f}
  .amt-lbl{font-size:7px;font-weight:700;text-transform:uppercase;letter-spacing:0.4px;color:#6b7280;margin-bottom:3px}
  .amt-box.highlight .amt-lbl{color:rgba(255,255,255,0.7)}
  .amt-val{font-size:14px;font-weight:800;color:#111}
  .amt-box.highlight .amt-val{color:#fff}

  /* ── Table ── */
  .section-title{font-size:9px;font-weight:700;color:#1e3a5f;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:5px;border-left:3px solid #1e3a5f;padding-left:6px}
  table{width:100%;border-collapse:collapse;font-size:9px}
  thead tr{background:#1e3a5f}
  thead th{padding:5px 7px;font-weight:700;color:#fff;text-align:left}
  thead th.r{text-align:right}
  tbody tr:nth-child(even){background:#f9fafb}
  tbody td{padding:5px 7px;border-bottom:1px solid #f0f0f0;color:#374151}
  tbody td.r{text-align:right;font-weight:700}
  .no-data td{text-align:center;color:#9ca3af;padding:10px;font-style:italic}

  /* ── Footer ── */
  .footer{margin-top:14px;border-top:1px solid #e5e7eb;padding-top:8px;display:flex;justify-content:space-between;align-items:center}
  .footer-brand{font-size:8px;color:#9ca3af}
  .footer-sig{font-size:8px;color:#9ca3af;text-align:right}
</style>
</head><body>

<!-- Header -->
<div class="hdr">
  <div class="logo"><img src="${LOGO_BASE64}" /></div>
  <div class="hdr-center">
    <div class="co-name">FOCUS LAB</div>
    <div class="co-addr">#17 St 480, Sangkat Toul Toum Pong 1<br/>Khan Chamkarmon, Phnom Penh 12310 · Tel: 0964222816</div>
  </div>
  <div><span class="doc-badge">Vendor Payable</span></div>
</div>
<div class="hr"></div>

<!-- Info -->
<div class="info-section">
  <div class="info-row">
    <span class="lbl">Vendor</span>
    <span class="val">${vendorName}</span>
  </div>
  <div class="info-row">
    <span class="lbl">Bill No</span>
    <span class="val">${bill.billNo}</span>
  </div>
  ${bill.poNumber ? `<div class="info-row"><span class="lbl">PO Number</span><span class="val">${bill.poNumber}</span></div>` : ''}
  ${bill.receiptNote ? `<div class="info-row"><span class="lbl">Note</span><span class="val">${bill.receiptNote}</span></div>` : ''}
  <div class="info-row">
    <span class="lbl">Status</span>
    <span class="val"><span class="status-pill">${statusLabel}</span></span>
  </div>
  <div class="info-row">
    <span class="lbl">Issued</span>
    <span class="val">${bill.issuedAt?.slice(0, 10) ?? '—'}</span>
  </div>
  ${bill.dueAt ? `<div class="info-row"><span class="lbl">Due Date</span><span class="val red">${bill.dueAt.slice(0, 10)}</span></div>` : ''}
</div>

<!-- Amounts -->
<div class="amounts">
  <div class="amt-box">
    <div class="amt-lbl">Bill Total</div>
    <div class="amt-val">$${(bill.totalCents / 100).toFixed(2)}</div>
  </div>
  <div class="amt-box">
    <div class="amt-lbl">Total Paid</div>
    <div class="amt-val" style="color:#10b981">$${((bill.paidCents ?? bill.paidAmountCents ?? 0) / 100).toFixed(2)}</div>
  </div>
  <div class="amt-box highlight">
    <div class="amt-lbl">Balance Due</div>
    <div class="amt-val">$${(balance / 100).toFixed(2)}</div>
  </div>
</div>

<!-- Payment History -->
<div class="section-title">Payment History</div>
<table>
  <thead>
    <tr><th>#</th><th>Date</th><th>Method</th><th class="r">Amount</th><th>Note</th></tr>
  </thead>
  <tbody>
    ${payments.length > 0
      ? payments.map((p, i) => `
        <tr>
          <td>${i + 1}</td>
          <td>${p.paidAt?.slice(0, 10) ?? '—'}</td>
          <td>${p.method ?? '—'}</td>
          <td class="r">$${(Number(p.amountCents) / 100).toFixed(2)}</td>
          <td>${p.note ?? ''}</td>
        </tr>`).join('')
      : `<tr class="no-data"><td colspan="5">No payment records</td></tr>`}
  </tbody>
</table>

<!-- Footer -->
<div class="footer">
  <span class="footer-brand">Focus Lab ERP · ${new Date().toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
  <span class="footer-sig">Authorized Signature: ________________</span>
</div>

</body></html>`;
  };

  const printBill = async (bill: ApiVendorPayable) => {
    setPrintLoading(true);
    try {
      const html = buildBillHTML(bill);
      const name = `PVC-${bill.billNo.replace(/[^a-zA-Z0-9]/g, '-')}-${Date.now()}`;
      const result = await Print.printToFileAsync({ html, width: 420, height: 595 });
      await Share.share({ url: result.uri, title: `Vendor Payable ${bill.billNo}` });
    } catch (err: any) {
      Alert.alert('Export Error', err?.message ?? 'Failed to generate PDF');
    } finally {
      setPrintLoading(false);
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────
  const renderItem = useCallback(({ item, index }: { item: ApiVendorPayable; index: number }) => {
    const balance = item.balanceCents ??
      Math.max(0, item.totalCents - (item.paidCents ?? item.paidAmountCents ?? 0));
    const s = STATUS_STYLE[item.status] ?? STATUS_STYLE.UNPAID;
    const canPay = item.status !== 'PAID';
    const vendorName = item.vendorName ?? item.vendor?.nameEn ?? `Vendor #${item.vendorId ?? '?'}`;
    const color = ROW_COLORS[index % ROW_COLORS.length];

    return (
      <View style={styles.listRow}>
        {/* Left color bar */}
        <View style={[styles.listRowBar, { backgroundColor: color }]} />

        <View style={styles.listRowContent}>
          {/* Top: bill no + PO number + status badge + balance */}
          <View style={styles.listRowTop}>
            <View style={{ flex: 1 }}>
              <AppText style={styles.billNo} numberOfLines={1}>{item.billNo}</AppText>
              {item.poNumber ? (
                <AppText style={styles.poNumberSub}>PO: {item.poNumber}</AppText>
              ) : null}
            </View>
            <View style={[styles.statusBadge, { backgroundColor: s.bg }]}>
              <AppText style={[styles.statusText, { color: s.color }]}>{s.label}</AppText>
            </View>
            <AppText style={[styles.balanceAmt, canPay && { color: Colors.error }]}>
              {fmtMoney(balance)}
            </AppText>
          </View>

          {/* Middle: vendor + meta + pay */}
          <View style={styles.listRowBottom}>
            <View style={styles.listRowMeta}>
              <AppText style={styles.vendorName} numberOfLines={1}>{vendorName}</AppText>
              <View style={styles.metaRow}>
                {item.receiptNote ? (
                  <AppText style={styles.metaText}>Ref: {item.receiptNote}</AppText>
                ) : null}
                <AppText style={styles.metaText}>{fmtDate(item.issuedAt)}</AppText>
                {item.dueAt ? (
                  <AppText style={[styles.metaText, { color: '#EF4444' }]}>Due: {fmtDate(item.dueAt)}</AppText>
                ) : null}
                <AppText style={styles.totalLabel}>Total: {fmtMoney(item.totalCents)}</AppText>
              </View>
            </View>
            {canPay ? (
              <TouchableOpacity style={styles.payBtn} onPress={() => openPayModal(item)} activeOpacity={0.8}>
                <Icon name="payments" size={13} color="#FFFFFF" />
                <AppText style={styles.payBtnText}>Pay</AppText>
              </TouchableOpacity>
            ) : (
              <View style={styles.paidTag}>
                <Icon name="check-circle" size={13} color={Colors.success} />
                <AppText style={styles.paidTagText}>Paid</AppText>
              </View>
            )}
          </View>

          {/* Action row: Preview + Print */}
          <View style={styles.actionRow}>
            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: '#FFF7ED', borderColor: '#FED7AA' }]}
              onPress={() => openPreview(item)}
              activeOpacity={0.7}
            >
              <Icon name="visibility" size={13} color="#EA580C" />
              <AppText style={[styles.actionBtnText, { color: '#EA580C' }]}>Preview</AppText>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: '#F5F3FF', borderColor: '#DDD6FE' }]}
              onPress={() => printBill(item)}
              activeOpacity={0.7}
            >
              <Icon name="print" size={13} color="#7C3AED" />
              <AppText style={[styles.actionBtnText, { color: '#7C3AED' }]}>Print</AppText>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  }, []);

  const renderFooter = () =>
    loadingMore ? (
      <View style={styles.loadMoreIndicator}>
        <ActivityIndicator size="small" color={Colors.primary} />
      </View>
    ) : null;

  // ── Preview screen ──────────────────────────────────────────────────────────
  if (screenView === 'preview' && previewingBill) {
    const bill = previewingBill;
    const paid = bill.paidCents ?? bill.paidAmountCents ?? 0;
    const balance = bill.balanceCents ?? Math.max(0, bill.totalCents - paid);
    const vendorName = bill.vendorName ?? bill.vendor?.nameEn ?? `Vendor #${bill.vendorId}`;

    return (
      <View style={styles.previewRoot}>
        <AppBar
          title={bill.billNo}
          subtitle="Vendor Payable"
          titleAlign="left"
          showBack
          onBack={() => setScreenView('list')}
        />
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }}>
          <View style={styles.previewDoc}>
            {/* Logo */}
            <Image source={{ uri: LOGO_BASE64 }} style={styles.previewLogo} />
            <AppText style={styles.previewDocTitle}>Vendor Payable</AppText>
            <AppText style={styles.previewDocSubtitle}>{bill.billNo}</AppText>

            <View style={styles.previewDivider} />

            {/* Info grid */}
            <View style={styles.previewGrid}>
              <View style={styles.previewGridRow}>
                <View style={styles.previewGridCell}>
                  <AppText style={styles.previewLabel}>Vendor</AppText>
                  <AppText style={styles.previewValue}>{vendorName}</AppText>
                </View>
                <View style={styles.previewGridCell}>
                  <AppText style={styles.previewLabel}>Status</AppText>
                  <AppText style={styles.previewValue}>{(bill.status ?? 'unknown').toUpperCase()}</AppText>
                </View>
              </View>
              {bill.poNumber ? (
                <View style={styles.previewGridRow}>
                  <View style={styles.previewGridCell}>
                    <AppText style={styles.previewLabel}>PO Number</AppText>
                    <AppText style={styles.previewValue}>{bill.poNumber}</AppText>
                  </View>
                  {bill.receiptNote ? (
                    <View style={styles.previewGridCell}>
                      <AppText style={styles.previewLabel}>Note</AppText>
                      <AppText style={styles.previewValue}>{bill.receiptNote}</AppText>
                    </View>
                  ) : (
                    <View style={styles.previewGridCell}>
                      <AppText style={styles.previewLabel}>Issued</AppText>
                      <AppText style={styles.previewValue}>{fmtDate(bill.issuedAt)}</AppText>
                    </View>
                  )}
                </View>
              ) : (
                <View style={styles.previewGridRow}>
                  <View style={styles.previewGridCell}>
                    <AppText style={styles.previewLabel}>Issued</AppText>
                    <AppText style={styles.previewValue}>{fmtDate(bill.issuedAt)}</AppText>
                  </View>
                  {bill.dueAt ? (
                    <View style={styles.previewGridCell}>
                      <AppText style={styles.previewLabel}>Due</AppText>
                      <AppText style={[styles.previewValue, { color: '#EF4444' }]}>{fmtDate(bill.dueAt)}</AppText>
                    </View>
                  ) : null}
                </View>
              )}
              {bill.dueAt && bill.poNumber ? (
                <View style={styles.previewGridRow}>
                  <View style={styles.previewGridCell}>
                    <AppText style={styles.previewLabel}>Due Date</AppText>
                    <AppText style={[styles.previewValue, { color: '#EF4444' }]}>{fmtDate(bill.dueAt)}</AppText>
                  </View>
                </View>
              ) : null}
            </View>

            <View style={styles.previewDivider} />

            {/* Amounts */}
            <View style={styles.previewAmtSection}>
              <View style={styles.previewAmtRow}>
                <AppText style={styles.previewAmtLabel}>Bill Total</AppText>
                <AppText style={styles.previewAmtValue}>{fmtMoney(bill.totalCents)}</AppText>
              </View>
              {paid > 0 && (
                <View style={styles.previewAmtRow}>
                  <AppText style={styles.previewAmtLabel}>Amount Paid</AppText>
                  <AppText style={[styles.previewAmtValue, { color: Colors.success }]}>{fmtMoney(paid)}</AppText>
                </View>
              )}
              <View style={[styles.previewAmtRow, styles.previewAmtRowTotal]}>
                <AppText style={styles.previewAmtLabelTotal}>Balance Due</AppText>
                <AppText style={styles.previewAmtValueTotal}>{fmtMoney(balance)}</AppText>
              </View>
            </View>

            {/* Payment history */}
            {bill.payments && bill.payments.length > 0 && (
              <>
                <View style={styles.previewDivider} />
                <AppText style={styles.previewSectionTitle}>Payment History</AppText>
                {bill.payments.map((p, i) => (
                  <View key={p.id ?? i} style={styles.previewPaymentRow}>
                    <View style={styles.previewPaymentTop}>
                      <AppText style={styles.previewPaymentAmt}>{fmtMoney(p.amountCents)}</AppText>
                      <AppText style={styles.previewPaymentDate}>{fmtDate(p.paidAt)}</AppText>
                    </View>
                    <AppText style={styles.previewPaymentMeta}>
                      {[p.method, p.note].filter(Boolean).join(' · ')}
                    </AppText>
                  </View>
                ))}
              </>
            )}
          </View>
        </ScrollView>

        {/* Bottom action bar */}
        <View style={styles.previewBottomBar}>
          <TouchableOpacity
            style={styles.previewBackBtn}
            onPress={() => setScreenView('list')}
            activeOpacity={0.7}
          >
            <Icon name="arrow-back" size={16} color={Colors.text} />
            <AppText style={styles.previewBackBtnText}>Back</AppText>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.previewPrintBtn}
            onPress={() => printBill(bill)}
            disabled={printLoading}
            activeOpacity={0.85}
          >
            {printLoading ? (
              <ActivityIndicator color="#FFFFFF" size="small" />
            ) : (
              <>
                <Icon name="print" size={16} color="#FFFFFF" />
                <AppText style={styles.previewPrintBtnText}>Print / Export PDF</AppText>
              </>
            )}
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <AppBar
        title="Vendor Payables"
        subtitle={`${totalCount} bill${totalCount !== 1 ? 's' : ''}`}
        titleAlign="left"
        showBack
        onBack={() => { if (!paying) onBack(); }}
      />

      {/* ── Filter Panel ── */}
      <View style={styles.filterPanel}>
        {/* Row 1: PVC search (full width) */}
        <View style={styles.searchBox}>
          <Icon name="search" size={16} color={Colors.textSecondary} style={{ marginLeft: 10 }} />
          <TextInput
            style={styles.searchInput}
            placeholder="PVC Number..."
            placeholderTextColor={Colors.textLight}
            value={pvcInput}
            onChangeText={setPvcInput}
            returnKeyType="search"
            onSubmitEditing={doFilter}
            autoCapitalize="none"
          />
          {pvcInput.length > 0 && (
            <TouchableOpacity onPress={() => setPvcInput('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Icon name="close" size={16} color={Colors.textSecondary} style={{ marginRight: 8 }} />
            </TouchableOpacity>
          )}
        </View>

        {/* Row 2: Vendor picker (full width) */}
        <TouchableOpacity
          style={[styles.vendorBtn, !!filterVendor && styles.vendorBtnActive]}
          onPress={() => { ensureVendors(); setShowVendorModal(true); }}
          activeOpacity={0.7}
        >
          <Icon name="store" size={15} color={filterVendor ? Colors.primary : Colors.textSecondary} />
          <AppText style={[styles.vendorBtnText, !!filterVendor && { color: Colors.primary }]} numberOfLines={1}>
            {filterVendor ? (filterVendor.nameEn ?? filterVendor.code ?? 'Vendor') : 'Select Vendor'}
          </AppText>
          <Icon name="arrow-drop-down" size={20} color={filterVendor ? Colors.primary : Colors.textSecondary} style={{ marginLeft: 'auto' }} />
        </TouchableOpacity>

        {/* Row 3: Date range + Filter button (full width) */}
        <View style={styles.filterRow}>
          <TouchableOpacity style={styles.datePill} onPress={() => setDatePicker('from')} activeOpacity={0.7}>
            <Icon name="event" size={13} color={Colors.primary} />
            <AppText style={styles.datePillText}>{toISO(fromDate)}</AppText>
          </TouchableOpacity>
          <AppText style={styles.dateSep}>→</AppText>
          <TouchableOpacity style={styles.datePill} onPress={() => setDatePicker('to')} activeOpacity={0.7}>
            <Icon name="event" size={13} color={Colors.primary} />
            <AppText style={styles.datePillText}>{toISO(toDate)}</AppText>
          </TouchableOpacity>
          <TouchableOpacity style={styles.applyBtn} onPress={doFilter} activeOpacity={0.8}>
            <Icon name="filter-list" size={14} color="#FFFFFF" />
            <AppText style={styles.applyBtnText}>Filter</AppText>
          </TouchableOpacity>
        </View>

        {/* Row 4: Route chips */}
        {routes.length > 0 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.routeScroll}
            contentContainerStyle={styles.routeChips}
          >
            <TouchableOpacity
              style={[styles.routeChip, !filterRoute && styles.routeChipActive]}
              onPress={() => setFilterRoute(null)}
              activeOpacity={0.7}
            >
              <AppText style={[styles.routeChipText, !filterRoute && styles.routeChipTextActive]}>All</AppText>
            </TouchableOpacity>
            {routes.map(r => (
              <TouchableOpacity
                key={r.id}
                style={[styles.routeChip, filterRoute?.id === r.id && styles.routeChipActive]}
                onPress={() => setFilterRoute(filterRoute?.id === r.id ? null : r)}
                activeOpacity={0.7}
              >
                <AppText style={[styles.routeChipText, filterRoute?.id === r.id && styles.routeChipTextActive]}>
                  {r.nameEn ?? r.code}
                </AppText>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}
      </View>

      {/* ── Summary Banner ── */}
      {!loading && !error && bills.length > 0 && (
        <View style={styles.summaryRow}>
          {/* PVC Count */}
          <View style={[styles.summaryCard, { backgroundColor: Colors.primary }]}>
            <Icon name="receipt" size={18} color="rgba(255,255,255,0.8)" />
            <AppText style={styles.summaryCardValue}>{totalCount}</AppText>
            <AppText style={styles.summaryCardLabel}>PVC</AppText>
            <View style={styles.summarySubRow}>
              <AppText style={styles.summarySubText}>{paidCount} paid</AppText>
              <AppText style={styles.summarySubDot}>·</AppText>
              <AppText style={styles.summarySubText}>{pendingCount} pending</AppText>
            </View>
          </View>

          {/* Total Paid */}
          <View style={[styles.summaryCard, { backgroundColor: '#059669' }]}>
            <Icon name="check-circle" size={18} color="rgba(255,255,255,0.8)" />
            <AppText style={styles.summaryCardValue}>{fmtMoney(totalPaidCents)}</AppText>
            <AppText style={styles.summaryCardLabel}>Total Paid</AppText>
          </View>

          {/* Total Pending */}
          <View style={[styles.summaryCard, { backgroundColor: Colors.error }]}>
            <Icon name="pending" size={18} color="rgba(255,255,255,0.8)" />
            <AppText style={styles.summaryCardValue}>{fmtMoney(totalOutstandingCents)}</AppText>
            <AppText style={styles.summaryCardLabel}>Pending</AppText>
          </View>
        </View>
      )}

      {/* ── Content ── */}
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Icon name="error-outline" size={48} color={Colors.textLight} />
          <AppText style={styles.centerMsg}>{error}</AppText>
          <TouchableOpacity style={styles.retryBtn} onPress={() => load()}>
            <AppText style={{ color: Colors.primary, fontWeight: '600' }}>Retry</AppText>
          </TouchableOpacity>
        </View>
      ) : bills.length === 0 ? (
        <View style={styles.center}>
          <Icon name="check-circle-outline" size={64} color={Colors.success} />
          <AppText style={styles.emptyTitle}>No Bills Found</AppText>
          <AppText style={styles.emptyMsg}>Adjust your filters and try again.</AppText>
        </View>
      ) : (
        <FlatList
          data={bills}
          keyExtractor={b => String(b.id)}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          onEndReached={loadMore}
          onEndReachedThreshold={0.3}
          ListFooterComponent={renderFooter}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); load(true); }}
              tintColor={Colors.primary}
            />
          }
        />
      )}

      {/* ── Vendor Picker Modal ── */}
      <Modal
        visible={showVendorModal}
        animationType="slide"
        transparent
        onRequestClose={() => setShowVendorModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.pickerSheet}>
            <View style={styles.pickerHeader}>
              <AppText style={styles.pickerTitle}>Select Vendor</AppText>
              <TouchableOpacity onPress={() => setShowVendorModal(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Icon name="close" size={22} color={Colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <View style={styles.pickerSearchBox}>
              <Icon name="search" size={16} color={Colors.textSecondary} />
              <TextInput
                style={styles.pickerSearchInput}
                placeholder="Search vendor..."
                placeholderTextColor={Colors.textLight}
                value={filterVendorSearch}
                onChangeText={setFilterVendorSearch}
                autoFocus
              />
            </View>
            <TouchableOpacity
              style={styles.pickerClearRow}
              onPress={() => { setFilterVendor(null); setShowVendorModal(false); setFilterVendorSearch(''); }}
            >
              <Icon name="clear-all" size={16} color={Colors.textSecondary} />
              <AppText style={styles.pickerClearText}>Clear vendor filter</AppText>
            </TouchableOpacity>
            {vendorsLoading ? (
              <ActivityIndicator style={{ padding: 24 }} color={Colors.primary} />
            ) : (
              <FlatList
                data={filteredVendors}
                keyExtractor={v => String(v.id)}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={[styles.pickerItem, filterVendor?.id === item.id && styles.pickerItemActive]}
                    onPress={() => { setFilterVendor(item); setShowVendorModal(false); setFilterVendorSearch(''); }}
                    activeOpacity={0.7}
                  >
                    <AppText style={[styles.pickerItemText, filterVendor?.id === item.id && { color: Colors.primary, fontWeight: '700' }]}>
                      {item.nameEn ?? item.nameKm ?? item.code}
                    </AppText>
                    <AppText style={styles.pickerItemSub}>{item.code}</AppText>
                  </TouchableOpacity>
                )}
                contentContainerStyle={{ paddingBottom: 40 }}
              />
            )}
          </View>
        </View>
      </Modal>

      {/* ── Date Pickers ── */}
      <DatePickerModal
        visible={datePicker === 'from'}
        value={fromDate}
        onChange={d => { setFromDate(d); setDatePicker(null); }}
        onClose={() => setDatePicker(null)}
      />
      <DatePickerModal
        visible={datePicker === 'to'}
        value={toDate}
        onChange={d => { setToDate(d); setDatePicker(null); }}
        onClose={() => setDatePicker(null)}
      />

      {/* ── Pay Modal ── */}
      <Modal
        visible={!!payingBill}
        animationType="slide"
        onRequestClose={() => !paying && setPayingBill(null)}
      >
        <View style={{ flex: 1 }}>
        <SafeAreaView style={styles.modalOverlay}>
          <StatusBar barStyle="dark-content" backgroundColor={Colors.surface} />
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
            <View style={styles.modalSheet}>
              <View style={styles.modalHeader}>
                <AppText style={styles.modalTitle}>Record Payment</AppText>
                <TouchableOpacity
                  onPress={() => !paying && setPayingBill(null)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Icon name="close" size={22} color={Colors.textSecondary} />
                </TouchableOpacity>
              </View>

              <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 32 }}>
                <View style={styles.payInfoBox}>
                  <AppText style={styles.payInfoVendor}>
                    {payingBill?.vendorName ?? payingBill?.vendor?.nameEn ?? `Vendor #${payingBill?.vendorId}`}
                  </AppText>
                  <AppText style={styles.payInfoBill}>Bill: {payingBill?.billNo}</AppText>
                  {payingBill?.poNumber ? (
                    <AppText style={styles.payInfoMeta}>PO: {payingBill.poNumber}</AppText>
                  ) : null}
                  <View style={styles.payInfoAmtRow}>
                    <AppText style={styles.payInfoAmtLabel}>Bill Total</AppText>
                    <AppText style={styles.payInfoAmtValue}>{fmtMoney(payingBill?.totalCents)}</AppText>
                  </View>
                  {(payingBill?.paidCents ?? payingBill?.paidAmountCents ?? 0) > 0 && (
                    <View style={styles.payInfoAmtRow}>
                      <AppText style={styles.payInfoAmtLabel}>Already Paid</AppText>
                      <AppText style={[styles.payInfoAmtValue, { color: Colors.success }]}>
                        {fmtMoney(payingBill?.paidCents ?? payingBill?.paidAmountCents)}
                      </AppText>
                    </View>
                  )}
                  <View style={[styles.payInfoAmtRow, styles.payInfoAmtRowLast]}>
                    <AppText style={[styles.payInfoAmtLabel, { fontWeight: '700', color: Colors.text }]}>
                      Balance Due
                    </AppText>
                    <AppText style={[styles.payInfoAmtValue, { color: Colors.error, fontWeight: '800' }]}>
                      {fmtMoney(
                        payingBill?.balanceCents ??
                        Math.max(0, (payingBill?.totalCents ?? 0) -
                          (payingBill?.paidCents ?? payingBill?.paidAmountCents ?? 0))
                      )}
                    </AppText>
                  </View>
                </View>

                <View style={styles.fieldGroup}>
                  <AppText style={styles.fieldLabel}>Payment Amount ($)</AppText>
                  <TextInput
                    style={styles.fieldInput}
                    value={payAmount}
                    onChangeText={setPayAmount}
                    keyboardType="numeric"
                    placeholder="e.g. 250.00"
                    placeholderTextColor={Colors.textLight}
                  />
                </View>

                <View style={styles.fieldGroup}>
                  <AppText style={styles.fieldLabel}>Payment Method</AppText>
                  <View style={styles.methodRow}>
                    {PAY_METHODS.map(m => (
                      <TouchableOpacity
                        key={m.value}
                        style={[styles.methodChip, payMethod === m.value && styles.methodChipActive]}
                        onPress={() => setPayMethod(m.value)}
                        activeOpacity={0.7}
                      >
                        <AppText style={[styles.methodChipText, payMethod === m.value && styles.methodChipTextActive]}>
                          {m.label}
                        </AppText>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>

                <View style={styles.fieldGroup}>
                  <AppText style={styles.fieldLabel}>Payment Date</AppText>
                  <TouchableOpacity
                    style={[styles.fieldInput, { flexDirection: 'row', alignItems: 'center', gap: 8 }]}
                    onPress={() => setPayDatePicker(true)}
                    activeOpacity={0.75}
                  >
                    <Icon name="event" size={16} color={Colors.primary} />
                    <AppText style={{ color: Colors.text, flex: 1 }}>{payPaidAt}</AppText>
                  </TouchableOpacity>
                </View>

                <View style={styles.fieldGroup}>
                  <AppText style={styles.fieldLabel}>Exchange Rate (KHR per $1)</AppText>
                  <TextInput
                    style={styles.fieldInput}
                    value={payRateUsed}
                    onChangeText={setPayRateUsed}
                    keyboardType="numeric"
                    placeholder="4100"
                    placeholderTextColor={Colors.textLight}
                  />
                </View>

                <View style={styles.fieldGroup}>
                  <AppText style={styles.fieldLabel}>Note (optional)</AppText>
                  <TextInput
                    style={[styles.fieldInput, styles.fieldInputMulti]}
                    value={payNote}
                    onChangeText={setPayNote}
                    placeholder="Transfer ID, reference..."
                    placeholderTextColor={Colors.textLight}
                    multiline
                    numberOfLines={2}
                  />
                </View>

                <TouchableOpacity
                  style={[styles.confirmBtn, paying && styles.confirmBtnDisabled]}
                  onPress={handlePay}
                  disabled={paying}
                  activeOpacity={0.85}
                >
                  {paying ? (
                    <ActivityIndicator color="#FFFFFF" size="small" />
                  ) : (
                    <>
                      <Icon name="payments" size={18} color="#FFFFFF" />
                      <AppText style={styles.confirmBtnText}>Confirm Payment</AppText>
                    </>
                  )}
                </TouchableOpacity>
              </ScrollView>
            </View>
          </KeyboardAvoidingView>
        </SafeAreaView>
        {payConfirmVisible && (
          <View style={payConfirmStyles.overlay}>
            <TouchableOpacity style={StyleSheet.absoluteFillObject} activeOpacity={1} onPress={() => setPayConfirmVisible(false)} />
            <View style={payConfirmStyles.card}>
              <View style={payConfirmStyles.lottieWrap}>
                <LottieView
                  source={require('../../assets/animations/invoice-confirm.json')}
                  autoPlay
                  loop
                  style={payConfirmStyles.lottie}
                />
              </View>
              <AppText style={payConfirmStyles.title}>Confirm Payment</AppText>
              <AppText style={payConfirmStyles.message}>
                {payingBill?.vendorName ?? payingBill?.vendor?.nameEn ?? `Vendor #${payingBill?.vendorId}`}
                {'\n'}{payingBill?.billNo}  ·  {fmtMoney(Math.round(Number(payAmount || '0') * 100))}
                {'\n'}{payMethod.replace('_', ' ')}
              </AppText>
              <View style={payConfirmStyles.divider} />
              <View style={payConfirmStyles.btnRow}>
                <TouchableOpacity style={payConfirmStyles.cancelBtn} onPress={() => setPayConfirmVisible(false)} activeOpacity={0.7}>
                  <AppText style={payConfirmStyles.cancelText}>Cancel</AppText>
                </TouchableOpacity>
                <TouchableOpacity
                  style={payConfirmStyles.okBtn}
                  onPress={() => { setPayConfirmVisible(false); submitPay(payingBill!, Math.round(Number(payAmount || '0') * 100)); }}
                  disabled={paying}
                  activeOpacity={0.85}
                >
                  {paying
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <AppText style={payConfirmStyles.okText}>Confirm</AppText>}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}
        <DatePickerModal
          noModal
          visible={payDatePicker}
          value={payPaidAt ? new Date(payPaidAt) : new Date()}
          onChange={d => { setPayPaidAt(toISO(d)); setPayDatePicker(false); }}
          onClose={() => setPayDatePicker(false)}
        />
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },

  // ── Filter panel ──────────────────────────────────────────────────────────
  filterPanel: {
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 8,
    gap: 8,
  },
  filterRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },

  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.background,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: Colors.border,
    height: 48,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: Colors.text,
    paddingHorizontal: 8,
    paddingVertical: 0,
    height: 48,
  },

  vendorBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
  },
  vendorBtnActive: { borderColor: Colors.primary, backgroundColor: Colors.primaryMuted },
  vendorBtnText: { flex: 1, fontSize: 14, color: Colors.textSecondary, fontWeight: '600' },

  datePill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
  },
  datePillText: { fontSize: 12, color: Colors.text, fontWeight: '600', flex: 1 },
  dateSep: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary },

  applyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 10,
    backgroundColor: Colors.primary,
  },
  applyBtnText: { fontSize: 13, color: '#FFFFFF', fontWeight: '700' },

  routeScroll: { marginTop: 2 },
  routeChips: { flexDirection: 'row', gap: 8, paddingBottom: 4 },
  routeChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
  },
  routeChipActive: { borderColor: Colors.primary, backgroundColor: Colors.primaryMuted },
  routeChipText: { fontSize: 12, fontWeight: '600', color: Colors.textSecondary },
  routeChipTextActive: { color: Colors.primary },

  // ── Summary banner ────────────────────────────────────────────────────────
  summaryRow: {
    flexDirection: 'row',
    gap: 8,
    marginHorizontal: 16,
    marginTop: 10,
    marginBottom: 4,
  },
  summaryCard: {
    flex: 1,
    borderRadius: 14,
    padding: 12,
    alignItems: 'center',
    gap: 2,
  },
  summaryCardValue: { color: '#FFFFFF', fontSize: 14, fontWeight: '800', marginTop: 2 },
  summaryCardLabel: { color: 'rgba(255,255,255,0.75)', fontSize: 10, fontWeight: '600' },
  summarySubRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 2 },
  summarySubText: { color: 'rgba(255,255,255,0.8)', fontSize: 9, fontWeight: '500' },
  summarySubDot: { color: 'rgba(255,255,255,0.5)', fontSize: 9 },

  // ── List ──────────────────────────────────────────────────────────────────
  list: { paddingBottom: 40 },
  loadMoreIndicator: { padding: 16, alignItems: 'center' },

  // ── List row ───────────────────────────────────────────────────────────────
  listRow: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.divider,
  },
  listRowBar: { width: 4 },
  listRowContent: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 6,
  },
  listRowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  listRowBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  listRowMeta: { flex: 1, gap: 2 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  metaText: { fontSize: 11, color: Colors.textSecondary },

  billNo: { fontSize: 14, fontWeight: '700', color: Colors.text },
  poNumberSub: { fontSize: 11, color: Colors.textSecondary, marginTop: 1 },
  statusBadge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  statusText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.3 },
  vendorName: { fontSize: 13, color: Colors.text, fontWeight: '600' },
  balanceAmt: { fontSize: 14, fontWeight: '800', color: Colors.text },
  totalLabel: { fontSize: 11, color: Colors.textSecondary },
  payBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.primary,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  payBtnText: { fontSize: 12, fontWeight: '700', color: '#FFFFFF' },
  paidTag: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  paidTagText: { fontSize: 11, color: Colors.success, fontWeight: '600' },

  actionRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 2,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 7,
    borderWidth: 1,
  },
  actionBtnText: { fontSize: 11, fontWeight: '700' },

  // ── Preview screen ─────────────────────────────────────────────────────────
  previewRoot: { flex: 1, backgroundColor: '#F5F5F5' },
  previewDoc: { margin: 16, backgroundColor: '#FFFFFF', borderRadius: 12, padding: 20, gap: 0 },
  previewLogo: { width: 80, height: 80, alignSelf: 'center', marginBottom: 8, resizeMode: 'contain' },
  previewDocTitle: { fontSize: 18, fontWeight: '800', color: Colors.text, textAlign: 'center', marginBottom: 2 },
  previewDocSubtitle: { fontSize: 12, color: Colors.textSecondary, textAlign: 'center', marginBottom: 16 },
  previewDivider: { height: 1, backgroundColor: Colors.divider, marginVertical: 12 },
  previewGrid: { gap: 6 },
  previewGridRow: { flexDirection: 'row', gap: 8 },
  previewGridCell: { flex: 1 },
  previewLabel: { fontSize: 10, color: Colors.textSecondary, fontWeight: '600', letterSpacing: 0.3, textTransform: 'uppercase', marginBottom: 1 },
  previewValue: { fontSize: 13, color: Colors.text, fontWeight: '600' },
  previewAmtSection: { marginTop: 4, gap: 4 },
  previewAmtRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  previewAmtLabel: { fontSize: 13, color: Colors.textSecondary },
  previewAmtValue: { fontSize: 13, color: Colors.text, fontWeight: '600' },
  previewAmtRowTotal: { borderTopWidth: 1, borderTopColor: Colors.divider, marginTop: 6, paddingTop: 10 },
  previewAmtLabelTotal: { fontSize: 15, fontWeight: '700', color: Colors.text },
  previewAmtValueTotal: { fontSize: 15, fontWeight: '800', color: Colors.error },
  previewSectionTitle: { fontSize: 13, fontWeight: '700', color: Colors.text, marginBottom: 8 },
  previewPaymentRow: { paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: Colors.divider, gap: 2 },
  previewPaymentTop: { flexDirection: 'row', justifyContent: 'space-between' },
  previewPaymentAmt: { fontSize: 13, fontWeight: '700', color: Colors.success },
  previewPaymentDate: { fontSize: 12, color: Colors.textSecondary },
  previewPaymentMeta: { fontSize: 11, color: Colors.textSecondary },
  previewBottomBar: {
    flexDirection: 'row',
    padding: 16,
    paddingBottom: 32,
    gap: 12,
    backgroundColor: Colors.surface,
    borderTopWidth: 1,
    borderTopColor: Colors.divider,
  },
  previewBackBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Colors.border,
  },
  previewBackBtnText: { fontSize: 14, fontWeight: '700', color: Colors.text },
  previewPrintBtn: {
    flex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: Colors.primary,
  },
  previewPrintBtnText: { fontSize: 14, fontWeight: '700', color: '#FFFFFF' },

  // ── Empty / error ──────────────────────────────────────────────────────────
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  centerMsg: { color: Colors.textSecondary, textAlign: 'center', fontSize: 14 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: Colors.text, marginTop: 8 },
  emptyMsg: { fontSize: 14, color: Colors.textSecondary },
  retryBtn: {
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: Colors.primary,
  },

  // ── Vendor picker modal ────────────────────────────────────────────────────
  pickerSheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '80%',
    paddingBottom: 40,
  },
  pickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.divider,
  },
  pickerTitle: { fontSize: 17, fontWeight: '700', color: Colors.text },
  pickerSearchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginVertical: 10,
    paddingHorizontal: 12,
    height: 42,
    backgroundColor: Colors.background,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: Colors.border,
  },
  pickerSearchInput: { flex: 1, fontSize: 14, color: Colors.text, paddingVertical: 0 },
  pickerClearRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.divider,
  },
  pickerClearText: { fontSize: 13, color: Colors.textSecondary },
  pickerItem: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.divider,
  },
  pickerItemActive: { backgroundColor: Colors.primaryMuted },
  pickerItemText: { fontSize: 14, color: Colors.text },
  pickerItemSub: { fontSize: 11, color: Colors.textSecondary, marginTop: 2 },

  // ── Pay modal ──────────────────────────────────────────────────────────────
  modalOverlay: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  modalSheet: {
    flex: 1,
    backgroundColor: Colors.surface,
    paddingHorizontal: 24,
  },
  modalHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.border,
    alignSelf: 'center',
    marginTop: 12,
    marginBottom: 4,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.divider,
    marginBottom: 16,
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: Colors.text },

  payInfoBox: {
    backgroundColor: Colors.primaryMuted,
    borderRadius: 12,
    padding: 14,
    marginBottom: 18,
    gap: 4,
  },
  payInfoVendor: { fontSize: 15, fontWeight: '700', color: Colors.text, marginBottom: 2 },
  payInfoBill: { fontSize: 13, fontWeight: '600', color: Colors.text },
  payInfoMeta: { fontSize: 12, color: Colors.textSecondary },
  payInfoAmtRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  payInfoAmtRowLast: {
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  payInfoAmtLabel: { fontSize: 13, color: Colors.textSecondary },
  payInfoAmtValue: { fontSize: 13, fontWeight: '700', color: Colors.text },

  fieldGroup: { marginBottom: 14 },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary, marginBottom: 6 },
  fieldInput: {
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: Colors.text,
    backgroundColor: Colors.background,
  },
  fieldInputMulti: { height: 64, textAlignVertical: 'top', fontSize: 14 },
  fieldHint: { fontSize: 12, color: Colors.primary, fontWeight: '600', marginTop: 4, marginLeft: 4 },

  methodRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  methodChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
  },
  methodChipActive: { borderColor: Colors.primary, backgroundColor: Colors.primaryMuted },
  methodChipText: { fontSize: 12, fontWeight: '600', color: Colors.textSecondary },
  methodChipTextActive: { color: Colors.primary },

  confirmBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingVertical: 16,
    marginTop: 8,
  },
  confirmBtnDisabled: { backgroundColor: Colors.border },
  confirmBtnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
});

const payConfirmStyles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 999,
  },
  card: {
    width: 280,
    backgroundColor: Colors.surface,
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 12,
  },
  lottieWrap: { marginBottom: 16, alignItems: 'center', justifyContent: 'center' },
  lottie: { width: 130, height: 130 },
  title: { fontSize: 17, fontWeight: '800', color: Colors.text, textAlign: 'center', marginBottom: 8 },
  message: { fontSize: 13, color: Colors.textSecondary, textAlign: 'center', lineHeight: 20, marginBottom: 4 },
  divider: { height: 1, backgroundColor: Colors.divider, width: '100%', marginTop: 18, marginBottom: 14 },
  btnRow: { flexDirection: 'row', gap: 10, width: '100%' },
  cancelBtn: { flex: 1, paddingVertical: 13, borderRadius: 12, borderWidth: 1.5, borderColor: Colors.border, alignItems: 'center' },
  cancelText: { fontSize: 14, fontWeight: '600', color: Colors.textSecondary },
  okBtn: { flex: 1, paddingVertical: 13, borderRadius: 12, alignItems: 'center', backgroundColor: '#059669' },
  okText: { fontSize: 14, fontWeight: '700', color: '#fff' },
});

export default VendorPayablesScreen;
