import React, { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  ActivityIndicator, Platform,
} from 'react-native';
import * as Sharing from 'expo-sharing';
import * as Print from 'expo-print';
import { generatePDF } from 'react-native-html-to-pdf';
import { MaterialIcons as Icon } from '@expo/vector-icons';
import AppBar from '../../components/AppBar';
import { useAlert } from '../../components/AppAlert';
import {
  ApiRentalInvoiceHeader, ApiRentalInvoiceDetail,
  ApiRentalUsageMachine, getRentalUsageInvoiceApi,
} from '../../services/focusApi';
import { buildRentalInvoiceHTML } from '../../utils/rentalInvoiceHtml';

// ─── Theme (identical to SaleOrderInvoiceScreen) ──────────────────────────────
const P   = '#546E7A';
const P_D = '#37474F';
const INK  = '#212121';
const SUB  = '#757575';
const BDR  = '#EEEEEE';
const SURF = '#FAFAFA';

// ─── Company / Payment constants ──────────────────────────────────────────────
const COMPANY_INFO = {
  name:    'FOCUS LAB',
  addr1:   '#17 St 480, Sangkat Toul Toum Pong 1',
  addr2:   'Khan Chamkarmon, Phnom Penh 12310',
  phone:   '0964222816',
  email:   'sen.sov@gmail.com',
};

const PAYMENT_INFO = {
  bankName:      'ABA Bank',
  accountName:   'SOVITHIA SEN AND TONG LYHEANG AND TE SOPHIE',
  accountNumber: '003 257 965',
};

// ─── Props ────────────────────────────────────────────────────────────────────
interface Props {
  invoice: ApiRentalInvoiceHeader;
  onBack: () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];
const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const fmtPeriodLong = (iso?: string | null): string => {
  if (!iso) return '—';
  try {
    const [y, m] = iso.split('-').map(Number);
    return `${MONTH_NAMES[m - 1]} ${y}`;
  } catch { return iso; }
};

const fmtDate = (iso?: string | null): string => {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return `${d.getDate()} ${MONTH_SHORT[d.getMonth()]} ${d.getFullYear()}`;
  } catch { return iso; }
};

const fmtUsd = (usd: number): string => `$${usd.toFixed(2)}`;

const totalCentsToUsd = (v?: number | string | null): number => {
  if (v == null) return 0;
  const n = typeof v === 'string' ? Number(v) : v;
  return isNaN(n) ? 0 : n / 100;
};

interface RentalComputed {
  details: ApiRentalInvoiceDetail[];
  totalPages: number;
  totalUsd: number;
  pricePerPage: number;
  campusLabel: string;
  campusCodeStr: string;
  customerName: string;
}

const computeRental = (
  inv: ApiRentalInvoiceHeader,
  machineList?: ApiRentalUsageMachine[] | null,
): RentalComputed => {
  // Use fetched machines when available; fall back to embedded details
  const details: ApiRentalInvoiceDetail[] =
    machineList && machineList.length > 0
      ? (machineList.map((m, i) => ({
          id: String(i),
          soId: '',
          qty: 0,
          unitPriceCents: m.unitPriceCents ?? 0,
          discountCents: 0,
          lineLabel:      m.machineName   ?? null,
          contractRef:    null,
          counterBwStart: m.startCount    ?? null,
          counterBwEnd:   m.endCount      ?? null,
          lineCents:      m.unitPriceCents ?? null,
          campusCode:     m.campusCode    ?? null,
          campus: m.campusNameEn
            ? { nameEn: m.campusNameEn, campusCode: m.campusCode ?? undefined }
            : null,
        })) as ApiRentalInvoiceDetail[])
      : (inv.details ?? []) as ApiRentalInvoiceDetail[];

  const totalPages = details.reduce((s, d) => {
    const start = Number(d.counterBwStart ?? 0);
    const end   = Number(d.counterBwEnd   ?? 0);
    return s + Math.max(0, end - start);
  }, 0);
  const totalUsd     = totalCentsToUsd(inv.totalCents);
  const pricePerPage = totalPages > 0 ? totalUsd / totalPages : 0;

  const campusNames = [...new Set(
    details.map(d => d.campus?.nameEn ?? d.campusCode ?? null).filter((v): v is string => !!v),
  )];
  const campusLabel = campusNames.length > 0
    ? campusNames.join(', ')
    : inv.campus?.nameEn ?? inv.campus?.campusCode ?? '—';

  const campusCodesList = [...new Set(
    details.map(d => d.campusCode ?? null).filter((v): v is string => !!v),
  )];
  const campusCodeStr = campusCodesList.length > 0
    ? campusCodesList.join(', ')
    : inv.campus?.campusCode ?? '—';

  const customerName = inv.customerOrg?.nameEn ?? inv.customerOrg?.name ?? '—';

  return { details, totalPages, totalUsd, pricePerPage, campusLabel, campusCodeStr, customerName };
};

// ─── Native preview sub-components (mirrors SaleOrderInvoiceScreen) ───────────

const RentalHeader: React.FC<{ inv: ApiRentalInvoiceHeader; campusLabel: string }> = ({ inv, campusLabel }) => {
  const status = (inv.status ?? '').toLowerCase();
  const badgeBg    = status === 'paid' ? '#E8F5E9' : status === 'cancelled' ? '#FFEBEE' : '#E3F2FD';
  const badgeColor = status === 'paid' ? '#2E7D32' : status === 'cancelled' ? '#C62828' : '#1565C0';
  return (
    <View style={cs.hdrCard}>
      <View style={cs.hdrBand}>
        <View style={cs.hdrLeft}>
          <View style={cs.hdrLogoBox}>
            <Icon name="business" size={34} color="rgba(255,255,255,0.6)"/>
          </View>
          <View style={cs.hdrCoInfo}>
            <Text style={cs.hdrCoName}>{COMPANY_INFO.name}</Text>
            <Text style={cs.hdrCoSub}>{COMPANY_INFO.addr1}</Text>
            <Text style={cs.hdrCoSub}>{COMPANY_INFO.addr2}</Text>
            <Text style={cs.hdrCoSub}>{COMPANY_INFO.phone} · {COMPANY_INFO.email}</Text>
          </View>
        </View>
        <View style={cs.hdrRight}>
          <Text style={cs.hdrWordFaint}>INVOICE</Text>
          <Text style={cs.hdrInvNum}>{inv.invoiceNumber ?? '—'}</Text>
          <View style={[cs.statusBadge, { backgroundColor: badgeBg }]}>
            <Text style={[cs.statusBadgeTxt, { color: badgeColor }]}>{(inv.status ?? '').toUpperCase()}</Text>
          </View>
        </View>
      </View>
      <View style={cs.hdrMeta}>
        <View style={cs.hdrMetaItem}>
          <Text style={cs.metaLbl}>Issue Date</Text>
          <Text style={cs.metaVal}>{fmtDate(inv.issuedAt ?? inv.createdAt)}</Text>
        </View>
        <View style={cs.hdrMetaItem}>
          <Text style={cs.metaLbl}>Period</Text>
          <Text style={cs.metaVal}>{fmtPeriodLong(inv.periodMonth)}</Text>
        </View>
        <View style={cs.hdrMetaItem}>
          <Text style={cs.metaLbl}>Branch</Text>
          <Text style={cs.metaVal} numberOfLines={1}>{campusLabel}</Text>
        </View>
      </View>
    </View>
  );
};

const BillTo: React.FC<{ inv: ApiRentalInvoiceHeader; campusCodeStr: string }> = ({ inv, campusCodeStr }) => (
  <View style={cs.card}>
    <View style={cs.cardHdrRow}>
      <View style={cs.cardHdrDot}/>
      <Text style={cs.cardHdrTxt}>Bill To</Text>
    </View>
    <View style={cs.custRow}>
      <Text style={cs.custLbl}>Campus Code</Text>
      <Text style={cs.custVal}>{campusCodeStr || '—'}</Text>
    </View>
    {inv.startDate ? (
      <View style={cs.custRow}>
        <Text style={cs.custLbl}>From</Text>
        <Text style={cs.custVal}>{fmtDate(inv.startDate)}</Text>
      </View>
    ) : null}
    {inv.endDate ? (
      <View style={cs.custRow}>
        <Text style={cs.custLbl}>To</Text>
        <Text style={cs.custVal}>{fmtDate(inv.endDate)}</Text>
      </View>
    ) : null}
    {inv.note ? (
      <View style={[cs.custRow, { borderBottomWidth: 0 }]}>
        <Text style={cs.custLbl}>Note</Text>
        <Text style={[cs.custVal, { flex: 1 }]}>{inv.note}</Text>
      </View>
    ) : null}
  </View>
);

const InvoiceDetails: React.FC<{ inv: ApiRentalInvoiceHeader }> = ({ inv }) => {
  const status = (inv.status ?? '').toLowerCase();
  const badgeBg    = status === 'paid' ? '#E8F5E9' : status === 'cancelled' ? '#FFEBEE' : '#E3F2FD';
  const badgeColor = status === 'paid' ? '#2E7D32' : status === 'cancelled' ? '#C62828' : '#1565C0';
  return (
    <View style={cs.card}>
      <View style={cs.cardHdrRow}>
        <View style={cs.cardHdrDot}/>
        <Text style={cs.cardHdrTxt}>Invoice Details</Text>
      </View>
      <View style={cs.custRow}>
        <Text style={cs.custLbl}>Invoice No</Text>
        <Text style={cs.custVal}>{inv.invoiceNumber ?? '—'}</Text>
      </View>
      <View style={cs.custRow}>
        <Text style={cs.custLbl}>Issue Date</Text>
        <Text style={cs.custVal}>{fmtDate(inv.issuedAt ?? inv.createdAt)}</Text>
      </View>
      {inv.dueAt ? (
        <View style={cs.custRow}>
          <Text style={cs.custLbl}>Due Date</Text>
          <Text style={[cs.custVal, { color: P }]}>{fmtDate(inv.dueAt)}</Text>
        </View>
      ) : null}
      <View style={[cs.custRow, { borderBottomWidth: 0 }]}>
        <Text style={cs.custLbl}>Status</Text>
        <View style={[cs.statusBadge, { backgroundColor: badgeBg }]}>
          <Text style={[cs.statusBadgeTxt, { color: badgeColor }]}>{(inv.status ?? '').toUpperCase()}</Text>
        </View>
      </View>
    </View>
  );
};

const UsageTable: React.FC<{ details: ApiRentalInvoiceDetail[]; totalPages: number }> = ({ details, totalPages }) => (
  <View style={cs.card}>
    <View style={cs.cardHdrRow}>
      <View style={cs.cardHdrDot}/>
      <Text style={cs.cardHdrTxt}>Usage</Text>
    </View>
    <View style={cs.tblHdr}>
      <Text style={[cs.tblHdrCell, { flex: 1 }]}>Machine Name</Text>
      <Text style={[cs.tblHdrCell, cs.colCnt, { textAlign: 'right' }]}>Start</Text>
      <Text style={[cs.tblHdrCell, cs.colCnt, { textAlign: 'right' }]}>End</Text>
      <Text style={[cs.tblHdrCell, cs.colCnt, { textAlign: 'right' }]}>Total</Text>
    </View>
    {details.map((d, idx) => {
      const start       = Number(d.counterBwStart ?? 0);
      const end         = Number(d.counterBwEnd   ?? 0);
      const total       = Math.max(0, end - start);
      const machineName = d.lineLabel ?? d.contractRef ?? `Machine #${idx + 1}`;
      return (
        <View key={d.id ?? idx} style={[cs.tblRow, idx % 2 === 1 && cs.tblRowAlt]}>
          <View style={{ flex: 1 }}>
            <Text style={cs.tblItemName}>{machineName}</Text>
            {d.lineLabel && d.contractRef
              ? <Text style={cs.tblItemSub}>{d.contractRef}</Text>
              : null}
          </View>
          <Text style={[cs.tblCell, cs.colCnt, { textAlign: 'right' }]}>{start.toLocaleString()}</Text>
          <Text style={[cs.tblCell, cs.colCnt, { textAlign: 'right' }]}>{end.toLocaleString()}</Text>
          <Text style={[cs.tblCell, cs.colCnt, { textAlign: 'right', fontWeight: '700' }]}>{total.toLocaleString()}</Text>
        </View>
      );
    })}
    <View style={[cs.sumRow, cs.sumSub]}>
      <Text style={cs.sumLbl}>Total Pages</Text>
      <Text style={cs.sumVal}>{totalPages.toLocaleString()}</Text>
    </View>
  </View>
);

const CostSection: React.FC<{ totalPages: number; pricePerPage: number; totalUsd: number }> = ({ totalPages, pricePerPage, totalUsd }) => (
  <View style={cs.card}>
    <View style={cs.cardHdrRow}>
      <View style={cs.cardHdrDot}/>
      <Text style={cs.cardHdrTxt}>Cost</Text>
    </View>
    <View style={cs.tblHdr}>
      <Text style={[cs.tblHdrCell, { flex: 1 }]}>Usage (pages)</Text>
      <Text style={[cs.tblHdrCell, cs.colCnt, { textAlign: 'right' }]}>Price / Page</Text>
      <Text style={[cs.tblHdrCell, cs.colCnt, { textAlign: 'right' }]}>Total Price</Text>
    </View>
    <View style={cs.tblRow}>
      <Text style={[cs.tblCell, { flex: 1 }]}>{totalPages.toLocaleString()}</Text>
      <Text style={[cs.tblCell, cs.colCnt, { textAlign: 'right' }]}>${pricePerPage.toFixed(5)}</Text>
      <Text style={[cs.tblCell, cs.colCnt, { textAlign: 'right', fontWeight: '700' }]}>{fmtUsd(totalUsd)}</Text>
    </View>
    <View style={[cs.sumRow, cs.sumGrand]}>
      <Text style={cs.sumGrandLbl}>Grand Total</Text>
      <Text style={cs.sumGrandVal}>{fmtUsd(totalUsd)}</Text>
    </View>
  </View>
);

const PaymentCard: React.FC = () => (
  <View style={cs.card}>
    <View style={cs.cardHdrRow}>
      <View style={cs.cardHdrDot}/>
      <Text style={cs.cardHdrTxt}>Payment Information</Text>
    </View>
    {[
      ['Bank Name',      PAYMENT_INFO.bankName],
      ['Account Name',   PAYMENT_INFO.accountName],
      ['Account Number', PAYMENT_INFO.accountNumber],
    ].map(([lbl, val]) => (
      <View style={cs.payRow} key={lbl}>
        <Text style={cs.payLbl}>{lbl}</Text>
        <Text style={cs.payVal}>{val}</Text>
      </View>
    ))}
  </View>
);

const SignatureCard: React.FC = () => (
  <View style={cs.card}>
    <View style={cs.cardHdrRow}>
      <View style={cs.cardHdrDot}/>
      <Text style={cs.cardHdrTxt}>Signature</Text>
    </View>
    <View style={cs.sigRow}>
      {['Prepared By', 'Received By'].map(lbl => (
        <View style={cs.sigBox} key={lbl}>
          <View style={cs.sigLine}/>
          <Text style={cs.sigLbl}>{lbl}</Text>
        </View>
      ))}
    </View>
  </View>
);

// ─── Main screen ──────────────────────────────────────────────────────────────

const RentalInvoicePrintScreen: React.FC<Props> = ({ invoice, onBack }) => {
  const { showAlert } = useAlert();
  const [printing,     setPrinting]     = useState(false);
  const [exportingPDF, setExportingPDF] = useState(false);
  const [machines,     setMachines]     = useState<ApiRentalUsageMachine[] | null>(null);
  const [loadingUsage, setLoadingUsage] = useState(true);
  const [usageError,   setUsageError]   = useState(false);

  useEffect(() => {
    let cancelled = false;
    const num = invoice.invoiceNumber;
    if (!num) { setLoadingUsage(false); return; }

    const timeout = setTimeout(() => {
      if (!cancelled) { setLoadingUsage(false); setUsageError(true); }
    }, 10000);

    getRentalUsageInvoiceApi(num)
      .then(res => {
        if (cancelled) return;
        setMachines(res.machines.length > 0 ? res.machines : null);
        setUsageError(false);
      })
      .catch(() => {
        if (!cancelled) setUsageError(true);
      })
      .finally(() => {
        clearTimeout(timeout);
        if (!cancelled) setLoadingUsage(false);
      });

    return () => { cancelled = true; clearTimeout(timeout); };
  }, [invoice.invoiceNumber]);

  const { details, totalPages, totalUsd, pricePerPage, campusLabel, campusCodeStr } = computeRental(invoice, machines);

  const handlePrint = async () => {
    try {
      setPrinting(true);
      await Print.printAsync({ html: buildRentalInvoiceHTML(invoice, machines) });
    } catch (e: any) {
      showAlert({ type: 'error', title: 'Print Error', message: e?.message ?? 'Failed to print' });
    } finally {
      setPrinting(false);
    }
  };

  const handleExportPDF = async () => {
    try {
      setExportingPDF(true);
      const fileName = `RI-${(invoice.invoiceNumber ?? 'invoice').replace(/[^a-zA-Z0-9]/g, '-')}-${Date.now()}`;
      const result = await generatePDF({ html: buildRentalInvoiceHTML(invoice, machines), fileName, width: 595, height: 842 });
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) await Sharing.shareAsync(result.filePath, { mimeType: 'application/pdf', dialogTitle: `Rental Invoice ${invoice.invoiceNumber}` });
    } catch (e: any) {
      showAlert({ type: 'error', title: 'Export Error', message: e?.message ?? 'Failed to export PDF' });
    } finally {
      setExportingPDF(false);
    }
  };

  return (
    <View style={ss.safe}>
      <AppBar
        title={invoice.invoiceNumber ?? 'Rental Invoice'}
        subtitle="Rental Usage Invoice"
        titleAlign="left"
        showBack
        onBack={onBack}
        rightActions={
          <View style={ss.actions}>
            <TouchableOpacity style={ss.actionBtn} onPress={handleExportPDF} disabled={exportingPDF}>
              {exportingPDF
                ? <ActivityIndicator size="small" color="#fff"/>
                : <Icon name="picture-as-pdf" size={20} color="#fff"/>}
            </TouchableOpacity>
            <TouchableOpacity style={ss.actionBtn} onPress={handlePrint} disabled={printing}>
              {printing
                ? <ActivityIndicator size="small" color="#fff"/>
                : <Icon name="print" size={20} color="#fff"/>}
            </TouchableOpacity>
          </View>
        }
      />
      <ScrollView style={ss.scroll} contentContainerStyle={ss.scrollContent} showsVerticalScrollIndicator={false}>
        <RentalHeader   inv={invoice} campusLabel={campusLabel}/>
        <BillTo         inv={invoice} campusCodeStr={campusCodeStr}/>
        <InvoiceDetails inv={invoice}/>
        {loadingUsage
          ? <View style={ss.usageLoader}><ActivityIndicator size="large" color={P}/></View>
          : usageError && details.length === 0
            ? <View style={ss.usageLoader}>
                <Icon name="cloud-off" size={28} color={SUB}/>
                <Text style={{ fontSize: 13, color: SUB, marginTop: 8 }}>Could not load usage data</Text>
              </View>
            : <>
                <UsageTable  details={details} totalPages={totalPages}/>
                <CostSection totalPages={totalPages} pricePerPage={pricePerPage} totalUsd={totalUsd}/>
              </>
        }
        <PaymentCard/>
        <SignatureCard/>
      </ScrollView>
    </View>
  );
};

// ─── Component styles (identical to SaleOrderInvoiceScreen) ───────────────────

const shadow = Platform.select({
  ios:     { shadowColor: '#000', shadowOffset: { width:0, height:2 }, shadowOpacity: 0.07, shadowRadius: 8 },
  android: { elevation: 3 },
});

const cs = StyleSheet.create({
  // Header card
  hdrCard:       { marginHorizontal: 16, marginTop: 8, borderRadius: 12, overflow: 'hidden', ...shadow },
  hdrBand:       { backgroundColor: '#fff', paddingHorizontal: 20, paddingTop: 10, paddingBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 14 },
  hdrLeft:       { flex: 1, flexDirection: 'row', gap: 14 },
  hdrLogoBox:    { width: 56, height: 56, borderRadius: 10, backgroundColor: '#F5F5F5', alignItems: 'center', justifyContent: 'center' },
  hdrCoInfo:     { flex: 1, justifyContent: 'center' },
  hdrCoName:     { fontSize: 18, fontWeight: '900', color: INK, letterSpacing: 2 },
  hdrCoSub:      { fontSize: 10, color: SUB, marginTop: 3, lineHeight: 17 },
  hdrRight:      { alignItems: 'flex-end' },
  hdrWordFaint:  { fontSize: 22, fontWeight: '900', color: P, opacity: 0.15, letterSpacing: 4 },
  hdrInvNum:     { fontSize: 13, fontWeight: '800', color: INK, marginTop: 2 },
  statusBadge:   { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 10, marginTop: 6 },
  statusBadgeTxt:{ fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  hdrMeta:       { backgroundColor: '#FAFAFA', flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1, borderTopColor: BDR },
  hdrMetaItem:   { flex: 1 },
  metaLbl:       { fontSize: 10, color: SUB, fontWeight: '600', marginBottom: 2 },
  metaVal:       { fontSize: 13, fontWeight: '700', color: INK },

  // Generic card
  card:       { backgroundColor: '#fff', marginHorizontal: 16, marginTop: 12, borderRadius: 12, padding: 16, ...shadow },
  cardHdrRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  cardHdrDot: { width: 4, height: 16, borderRadius: 2, backgroundColor: P },
  cardHdrTxt: { fontSize: 13, fontWeight: '700', color: INK, textTransform: 'uppercase', letterSpacing: 0.5 },

  // Bill-to rows
  custRow: { flexDirection: 'row', paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: '#F5F5F5' },
  custLbl: { width: 90, fontSize: 12, color: SUB, fontWeight: '600' },
  custVal: { flex: 1, fontSize: 12, color: INK, fontWeight: '500' },

  // Date range row (From / To)
  dateRangeCard:    { flexDirection: 'row', alignItems: 'stretch', paddingVertical: 10 },
  dateRangeCol:     { flex: 1, alignItems: 'flex-start', paddingHorizontal: 4 },
  dateRangeDivider: { width: 1, backgroundColor: BDR, marginVertical: 2 },
  dateRangeVal:     { fontSize: 14, fontWeight: '700', color: INK, marginTop: 4 },

  // Table
  tblHdr:     { flexDirection: 'row', backgroundColor: P_D, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 8, marginBottom: 2 },
  tblHdrCell: { fontSize: 9, fontWeight: '700', color: '#fff', textTransform: 'uppercase', letterSpacing: 0.3 },
  tblRow:     { flexDirection: 'row', paddingHorizontal: 8, paddingVertical: 8, alignItems: 'flex-start', borderBottomWidth: 1, borderBottomColor: '#F5F5F5' },
  tblRowAlt:  { backgroundColor: SURF },
  tblCell:    { fontSize: 11, color: INK },
  tblItemName:{ fontSize: 11, fontWeight: '600', color: INK },
  tblItemSub: { fontSize: 10, color: SUB, marginTop: 1 },
  colCnt:     { width: 80 },

  // Summary rows
  sumRow:     { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: '#F5F5F5' },
  sumSub:     { backgroundColor: SURF, borderBottomWidth: 0 },
  sumLbl:     { fontSize: 13, fontWeight: '600', color: INK },
  sumVal:     { fontSize: 13, fontWeight: '700', color: INK },
  sumGrand:   { backgroundColor: P, marginHorizontal: -16, paddingHorizontal: 16, borderBottomWidth: 0, marginTop: 4, paddingVertical: 13, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sumGrandLbl:{ fontSize: 15, fontWeight: '800', color: '#fff' },
  sumGrandVal:{ fontSize: 15, fontWeight: '900', color: '#fff' },

  // Payment
  payRow: { flexDirection: 'row', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#F5F5F5' },
  payLbl: { width: 130, fontSize: 12, color: SUB, fontWeight: '600' },
  payVal: { flex: 1, fontSize: 12, color: INK, fontWeight: '700' },

  // Footer
  footerBody: { fontSize: 13, color: SUB, lineHeight: 20 },

  // Signature
  sigRow: { flexDirection: 'row', gap: 12, marginTop: 8 },
  sigBox: { flex: 1, alignItems: 'center' },
  sigLine:{ width: '100%', height: 60, borderBottomWidth: 1.5, borderBottomColor: INK, marginBottom: 6 },
  sigLbl: { fontSize: 11, fontWeight: '700', color: SUB, textAlign: 'center' },
});

// ─── Screen styles (identical to SaleOrderInvoiceScreen) ─────────────────────

const ss = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: '#F5F5F5' },
  actions:     { flexDirection: 'row', gap: 8 },
  actionBtn:   {
    width: 36, height: 36, borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center', justifyContent: 'center',
  },
  scroll:        { flex: 1 },
  scrollContent: { paddingBottom: 32 },
  usageLoader:   { paddingVertical: 40, alignItems: 'center', justifyContent: 'center' },
});

export default RentalInvoicePrintScreen;
