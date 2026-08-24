import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  TextInput,
  Share,
  Modal,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Dimensions,
  Image,
  Animated,
  Easing,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons as Icon } from '@expo/vector-icons';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { File, Paths } from 'expo-file-system';

import Colors from '../../theme/colors';
import AppText from '../../components/AppText';
import AppBar from '../../components/AppBar';
import AppButton from '../../components/AppButton';
import SignaturePad, { SignaturePadRef } from '../../components/SignaturePad';
import DatePickerModal from '../../components/DatePickerModal';
import { useAlert } from '../../components/AppAlert';
import LOGO_BASE64 from '../../logo/logoBase64';
import { tabEvents } from '../../navigation/tabEvents';
import {
  getSalesOrdersApi,
  getSalesOrderApi,
  updateSalesOrderStatusApi,
  updateSalesOrderItemsApi,
  getCampusesApi,
  createInvoiceHeaderApi,
  getInvoiceHeadersApi,
  getInvoiceHeaderApi,
  updateInvoiceHeaderStatusApi,
  uploadDirectApi,
  uploadSaleOrderSignatureApi,
  getAllProductsApi,
  getUomsApi,
  getInvoiceSummariesApi,
  getInvoiceSummaryApi,
  createInvoiceSummaryApi,
  deleteInvoiceSummaryApi,
  ApiSalesOrder,
  ApiInvoiceHeader,
  ApiCampus,
  ApiProduct,
  ApiSalesOrderItem,
  ApiInvoiceSummary,
  ApiUom,
} from '../../services/focusApi';

interface Props {
  onBack: () => void;
}

type TabKey = 'received' | 'invoiced' | 'paid' | 'summaries';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'received',  label: 'Received' },
  { key: 'invoiced',  label: 'Invoiced' },
  { key: 'paid',      label: 'Paid' },
  { key: 'summaries', label: 'Summaries' },
];

const fmtCents = (cents?: number | null) =>
  cents != null ? `$${(cents / 100).toFixed(2)}` : '—';

const fmtDate = (iso?: string) => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch { return iso; }
};

const parseCents = (v: number | string | null | undefined): number =>
  v == null ? 0 : typeof v === 'string' ? (Number(v) || 0) : v;

const getOrderTotalCents = (o: ApiSalesOrder): number => {
  if (o.totalCents != null) return parseCents(o.totalCents);
  if (!Array.isArray(o.items) || o.items.length === 0) return 0;
  return o.items.reduce((s, it) => s + it.qty * it.unitPriceCents - (it.discountCents ?? 0), 0);
};

// ─── PDF builder for invoice headers ─────────────────────────────────────────
const COMPANY = {
  name:       'FOCUS LAB',
  addr1:      '#17 St 480, Sangkat Toul Toum Pong 1',
  addr2:      'Khan Chamkarmon, Phnom Penh 12310',
  contact:    'SEN Sovithia  ·  0964222816  ·  sen.sov@gmail.com',
  abaAccount: '003 257 965',
  abaHolder:  'SOVITHIA SEN AND TONG LYHEANG<br/>AND TE SOPHIE',
};

const A5_PX  = 559;
const A5_H   = 794;
const A4_PX  = 794;
const A4_H   = 1123;
const ROW_H2 = 26;

// Layout constants for SaleOrder-style invoice builder
const INV_ROW_H    = 28;
const INV_THEAD_H  = 30;
const INV_PAGE_PAD = 30;
const INV_HDR_H    = 186;
const INV_FOOTER_H = 370;
const INV_TH_SINGLE = A4_H - INV_PAGE_PAD - INV_HDR_H - INV_FOOTER_H;
const INV_TH_FIRST  = A4_H - INV_PAGE_PAD - INV_HDR_H;
const INV_TH_MID    = A4_H - INV_PAGE_PAD;
const INV_TH_LAST   = A4_H - INV_PAGE_PAD - INV_FOOTER_H;
const INV_MR_SINGLE = Math.floor((INV_TH_SINGLE - INV_THEAD_H) / INV_ROW_H);
const INV_MR_FIRST  = Math.floor((INV_TH_FIRST  - INV_THEAD_H) / INV_ROW_H);
const INV_MR_MID    = Math.floor((INV_TH_MID    - INV_THEAD_H) / INV_ROW_H);
const INV_MR_LAST   = Math.floor((INV_TH_LAST   - INV_THEAD_H) / INV_ROW_H);

const RECEIPT_CSS = `
  @page { size: A5 portrait; margin: 0; }
  *, *::before, *::after { margin:0; padding:0; box-sizing:border-box; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  html, body { width:${A5_PX}px; font-family:Arial,Helvetica,sans-serif; font-size:10px; color:#000; background:#fff; }
  .page { position:relative; width:${A5_PX}px; min-height:${A5_H}px; padding:24px 30px 20px; }
  .watermark {
    position:fixed; top:50%; left:50%;
    transform:translate(-50%,-50%) rotate(-45deg);
    font-size:100px; font-weight:900; color:rgba(16,185,129,0.12);
    letter-spacing:6px; text-transform:uppercase; white-space:nowrap;
    pointer-events:none; z-index:0;
  }
  .content { position:relative; z-index:1; }
  .hdr { display:flex; align-items:flex-start; margin-bottom:5px; gap:10px; }
  .logo { width:60px; height:60px; border-radius:10px; overflow:hidden; flex-shrink:0; }
  .logo img { width:60px; height:60px; display:block; }
  .hdr-mid { flex:1; text-align:center; }
  .co-name { font-size:14px; font-weight:900; letter-spacing:2px; text-transform:uppercase; }
  .co-addr { font-size:8px; color:#555; line-height:1.55; margin:2px 0 4px; }
  .rec-title { font-size:16px; font-weight:900; text-decoration:underline; color:#059669; }
  .hr { border:none; border-top:1.5px solid #000; margin:3px 0 4px; }
  .paid-badge {
    display:inline-block; background:#059669; color:#fff;
    font-size:11px; font-weight:900; letter-spacing:2px;
    padding:3px 14px; border-radius:4px; text-transform:uppercase;
    margin-bottom:5px;
  }
  .info-row { display:flex; border:1px solid #000; margin-bottom:5px; }
  .info-box { flex:1; padding:4px 8px; line-height:1.7; font-size:10px; }
  .info-box + .info-box { border-left:1px solid #000; }
  b { font-weight:700; }
  .tbl-wrap { border:1px solid #000; overflow:hidden; }
  table { width:100%; border-collapse:collapse; table-layout:fixed; }
  thead tr { height:26px; }
  thead th { background:#e7faf4; border-bottom:1.5px solid #000; border-right:1px solid #000; padding:0 4px; font-size:10px; font-weight:700; text-align:center; height:26px; }
  thead th:last-child { border-right:none; }
  tbody tr { height:${ROW_H2}px; }
  tbody td { height:${ROW_H2}px; border:1px solid #d8d8d8; padding:0 5px; font-size:9.5px; vertical-align:middle; overflow:hidden; white-space:nowrap; }
  tbody td.l { white-space:normal; }
  .c { text-align:center; } .r { text-align:right; } .l { text-align:left; }
  .no-badge { display:inline-block; width:18px; height:18px; line-height:18px; border-radius:4px; background:#d1fae5; color:#059669; font-size:9px; font-weight:700; text-align:center; }
  .footer { margin-top:8px; }
  .totals { border-top:1.5px solid #000; padding:4px 2px 5px; }
  .totals-row { display:flex; justify-content:flex-end; align-items:center; font-size:10px; padding:1.5px 0; }
  .totals-lbl { font-weight:600; padding-right:16px; min-width:80px; text-align:right; }
  .totals-val { width:70px; text-align:right; }
  .totals-disc .totals-val { color:#E53E3E; }
  .totals-grand { border-top:1px solid #aaa; margin-top:2px; padding-top:3px; font-size:11px; font-weight:800; color:#059669; }
  .sig-section { border:1px solid #000; display:flex; margin-top:8px; }
  .sig-col { flex:1; text-align:center; font-size:10px; font-weight:600; padding:8px 5px 10px; border-right:1px solid #000; }
  .sig-col:last-child { border-right:none; }
  .sig-line { border-bottom:1px solid #000; margin:5px 8px 8px; height:70px; }
`;

const buildPaymentReceiptHTML = (
  header: ApiInvoiceHeader,
  campusMap: Record<string, ApiCampus>,
  productMap: Record<string, ApiProduct> = {},
  previewWidth?: number,
): string => {
  const isPreview = !!previewWidth;
  const scale     = isPreview ? (previewWidth! / A4_PX) : 1;
  const scaledH   = isPreview ? Math.round(A4_H * scale) : A4_H;

  const campusCode =
    header.campusCode ??
    header.campus?.campusCode ??
    campusMap[String(header.campusId)]?.campusCode ??
    String(header.campusId);

  const campusObj: any = campusMap[String(header.campusId)] ?? header.campus ?? {};
  const campusPhone   = campusObj?.phone   ?? (header.campus as any)?.phone   ?? '';
  const campusAddress = campusObj?.address ?? (header.campus as any)?.address ?? '';

  const customer = header.customerOrg?.nameEn ?? header.customerOrg?.name ?? '';

  const soNums = [...new Set(
    (header.details ?? []).map((d: any) => d.soReferenceNumber).filter(Boolean)
  )].join(', ');

  const fmtC = (cents: number) => `$${(cents / 100).toFixed(2)}`;

  const detailMap: Record<string, { nameEn: string; nameKh: string; barcode: string; size: string; unit: number; qty: number; dis: number; total: number }> = {};
  (header.details ?? []).forEach(d => {
    const prod    = d.productId ? productMap[d.productId] : undefined;
    const rd      = d as any;
    const key     = d.productId ?? rd.productSku ?? rd.productNameEn ?? String(Math.random());
    const nameEn  = prod?.nameEn ?? rd.productNameEn ?? rd.product_name_en ?? rd.nameEn ?? '—';
    const nameKh  = prod?.nameKm ?? rd.productNameKh ?? rd.productNameKm ?? '';
    const barcode = prod?.barcode ?? prod?.sku ?? rd.productSku ?? '';
    const size    = prod?.size ?? rd.productSize ?? '';
    const unit    = parseCents(d.unitPriceCents);
    const dis     = parseCents(d.discountCents);
    const qty     = Number(d.qty ?? 0);
    const total   = qty * unit - dis;
    if (!detailMap[key]) detailMap[key] = { nameEn, nameKh, barcode, size, unit, qty: 0, dis: 0, total: 0 };
    detailMap[key].qty   += qty;
    detailMap[key].dis   += dis;
    detailMap[key].total += total;
  });
  const hasVisibleTextR = (kh: string, en: string) =>
    /[A-Za-z0-9\u1780-\u17b3\u17e0-\u17e9\u19e0-\u19ff]/.test(`${kh ?? ''} ${en ?? ''}`);
  const items = Object.entries(detailMap)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([, r]) => r)
    .filter(r => r.qty > 0 && (r.unit > 0 || r.total > 0) && hasVisibleTextR(r.nameKh, r.nameEn))
    .map((r, i) => ({ no: i + 1, ...r }));

  const grandTotal  = parseCents(header.totalCents) || items.reduce((s, it) => s + it.total, 0);
  const subtotal    = items.reduce((s, it) => s + it.qty * it.unit, 0);
  const discount    = items.reduce((s, it) => s + it.dis, 0);
  const hasDiscount = discount > 0;

  const ROWS_P1 = 12;
  const ROWS_PN = 18;

  const colHdr2 = `
    <div class="tbl-row hdr-row">
      <div class="tbl-cell tc-no c">No</div>
      <div class="tbl-cell tc-bar">Barcode</div>
      <div class="tbl-cell tc-nam">Description</div>
      <div class="tbl-cell tc-pri r">Price</div>
      <div class="tbl-cell tc-qty c">Qty</div>
      ${hasDiscount ? '<div class="tbl-cell tc-dis r">Discount</div>' : ''}
      <div class="tbl-cell tc-amt r">Amount</div>
    </div>`;

  const groups = items.length <= ROWS_P1
    ? [items]
    : [
        items.slice(0, ROWS_P1),
        ...Array.from(
          { length: Math.ceil((items.length - ROWS_P1) / ROWS_PN) },
          (_, i) => items.slice(ROWS_P1 + i * ROWS_PN, ROWS_P1 + (i + 1) * ROWS_PN)
        ),
      ];

  const PAGE_H   = 1009;
  const P1_HDR_H = 360;
  const COL_H    = 30;
  const ROW_H    = 36;
  const FOOTER_H = hasDiscount ? 300 : 270;

  const itemGroups = groups.map((grp, gi) => {
    const start = groups.slice(0, gi).reduce((s, g) => s + g.length, 0);
    const rows = grp.map((it, li) => {
      const idx = start + li;
      return `
    <div class="tbl-row${idx % 2 === 1 ? ' alt' : ''}">
      <div class="tbl-cell tc-no">${it.no}</div>
      <div class="tbl-cell tc-bar">${it.barcode || '—'}</div>
      <div class="tbl-cell tc-nam">
        <div class="iname">${it.nameKh ? `${it.nameKh} - ${it.nameEn}` : it.nameEn}</div>
      </div>
      <div class="tbl-cell tc-pri r">${fmtC(it.unit)}</div>
      <div class="tbl-cell tc-qty c">${it.qty}</div>
      ${hasDiscount ? `<div class="tbl-cell tc-dis r ${it.dis > 0 ? 'red' : 'muted'}">${it.dis > 0 ? `- ${fmtC(it.dis)}` : '—'}</div>` : ''}
      <div class="tbl-cell tc-amt r bold">${fmtC(it.total)}</div>
    </div>`;
    }).join('');
    const wrap = `<div class="tbl-w">${gi === 0 ? colHdr2 : ''}${rows}</div>`;
    return gi === 0 ? wrap : `<div class="pg-break"></div>${wrap}`;
  }).join('');

  const lastGroup      = groups[groups.length - 1];
  const usedOnLastPage = (groups.length === 1 ? P1_HDR_H : COL_H) + lastGroup.length * ROW_H;
  const footerBreak    = (PAGE_H - usedOnLastPage) < FOOTER_H;

  const scalerWrap = isPreview
    ? `<div style="width:${previewWidth}px;height:${scaledH}px;overflow:hidden;">
       <div style="width:${A4_PX}px;transform:scale(${scale.toFixed(6)});transform-origin:top left;">`
    : '';
  const scalerClose = isPreview ? '</div></div>' : '';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=${isPreview ? previewWidth : A4_PX},initial-scale=1.0"/>
<style>
  @page { size:A4 portrait; margin:0; }
  *,*::before,*::after {
    box-sizing:border-box; margin:0; padding:0;
    -webkit-print-color-adjust:exact; print-color-adjust:exact;
  }
  body {
    font-family:Times,'Times New Roman',serif; font-size:12px;
    color:#212121; background:#fff; width:${A4_PX}px;
  }
  * { font-weight:400 !important; }
  .ichdr { font-weight:700 !important; }
  .ival  { font-weight:700 !important; }
  .sv    { font-weight:700 !important; }
  .tc-amt { font-weight:700 !important; }
  .bold  { font-weight:700 !important; }
  .inv-title { font-weight:700 !important; }
  .co-n { font-weight:700 !important; }
  .watermark {
    position:fixed; top:50%; left:50%; transform:translate(-50%,-50%) rotate(-45deg);
    font-size:120px; font-weight:900; color:rgba(5,150,105,0.08);
    pointer-events:none; z-index:0; letter-spacing:20px;
    -webkit-print-color-adjust:exact; print-color-adjust:exact;
  }
  .inv-hdr {
    background:#fff; color:#212121;
    padding:12px 28px 10px;
    display:flex; align-items:center; gap:10px;
  }
  .logo-w { width:48px;height:48px;border-radius:8px;overflow:hidden;flex-shrink:0;background:#F5F5F5; }
  .logo-w img { width:100%;height:100%;display:block;object-fit:cover; }
  .co-b   { flex:1; }
  .co-n   { font-size:13px;font-weight:900;letter-spacing:2px;text-transform:uppercase;color:#212121; }
  .co-s   { font-size:8px;color:#757575;line-height:1.5;margin-top:2px; }
  .inv-title-wrap { text-align:center;margin-bottom:12px; }
  .inv-title      { font-size:20px;font-weight:900;letter-spacing:5px;text-transform:uppercase;color:#059669;line-height:1;display:inline-block;border-bottom:2px solid #059669;padding-bottom:0; }
  .body { padding:12px 28px 28px; }
  .irow2  { display:flex;gap:14px;margin-bottom:20px; }
  .icard  { flex:1;padding:12px 14px;border:1px solid #EEE;border-radius:8px;background:#FAFAFA; }
  .ichdr  { font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;
            color:#546E7A;padding-bottom:5px;margin-bottom:8px;border-bottom:2px solid #546E7A; }
  .ifield { display:flex;gap:6px;margin-bottom:4px; }
  .ilbl   { font-size:9.5px;color:#000;font-weight:600;width:72px;flex-shrink:0; }
  .ival   { font-size:11px;font-weight:600;color:#212121; }
  .st-paid { background:#E8F5E9;color:#2E7D32;padding:2px 8px;border-radius:8px;font-size:10px;font-weight:700; }
  .tbl-w { border:1px solid #EEE; margin-bottom:0; }
  .pg-break { page-break-after:always; break-after:always; height:0; margin:0; padding:0; }
  .tbl-row { display:flex; align-items:stretch; min-height:36px; border-bottom:1px solid #F5F5F5; page-break-inside:avoid; break-inside:avoid; }
  .tbl-row:last-child { border-bottom:none; }
  .hdr-row { background:#E8F5E9; border-bottom:2px solid #A5D6A7; }
  .tbl-row.alt { background:#FAFAFA; }
  .tbl-cell { padding:6px 11px; font-size:12px; display:flex; align-items:center; }
  .hdr-row .tbl-cell { font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.5px; color:#2E7D32; padding:9px 11px; }
  .tc-no  { width:28px; flex-shrink:0; justify-content:center; text-align:center; }
  .tc-bar { width:90px; flex-shrink:0; font-size:10px; color:#212121; }
  .tc-nam { flex:1; flex-direction:column; align-items:flex-start; justify-content:center; gap:2px; }
  .tc-pri { width:68px; flex-shrink:0; justify-content:flex-end; text-align:right; }
  .tc-qty { width:34px; flex-shrink:0; justify-content:center; text-align:center; }
  .tc-dis { width:64px; flex-shrink:0; justify-content:flex-end; text-align:right; }
  .tc-amt { width:72px; flex-shrink:0; justify-content:flex-end; text-align:right; }
  .c { justify-content:center; text-align:center; }
  .r { justify-content:flex-end; text-align:right; }
  .red  { color:#546E7A; } .muted { color:#BDBDBD; } .bold { font-weight:700; }
  .iname { font-weight:600; font-size:12px; }
  .ikh   { font-size:12px; color:#212121; }
  .sum-b { border:1px solid #EEE; border-top:none; page-break-inside:avoid; break-inside:avoid; }
  .srow  { display:flex; justify-content:space-between; align-items:center; padding:8px 11px; font-size:12px; border-bottom:1px solid #F5F5F5; }
  .srow:last-child { border-bottom:none; }
  .srow.disc .sv { color:#546E7A; }
  .srow.grand { background:#059669; color:#fff; font-size:15px; font-weight:800; padding:10px 11px; }
  .sl { font-weight:600; }
  .sv { font-weight:700; }
  .sig-row2 { display:flex;gap:14px;page-break-inside:avoid;margin-top:16px; }
  .sig-b  { flex:1;text-align:center; }
  .sig-ln { border-bottom:1.5px solid #333;margin:0 8px 6px;height:55px; }
  .sig-lb { font-size:11px;font-weight:700;color:#555; }
  .foot { background:#F5F5F5;color:#757575;text-align:center;
          padding:9px;font-size:10px;letter-spacing:.4px;margin-top:20px;
          border-top:1px solid #EEE; }
</style>
</head>
<body>
<div class="watermark">PAID</div>
${scalerWrap}

<div class="inv-hdr">
  <div class="logo-w"><img src="${LOGO_BASE64}" alt="logo"/></div>
  <div class="co-b">
    <div class="co-n">${COMPANY.name}</div>
    <div class="co-s">${COMPANY.addr1}<br/>${COMPANY.addr2}<br/>${COMPANY.contact}</div>
  </div>
</div>

<div class="body">

  <div class="inv-title-wrap">
    <div class="inv-title">PAYMENT RECEIPT</div>
  </div>

  <div class="irow2">
    <div class="icard">
      <div class="ichdr">Bill To</div>
      <div class="ifield"><span class="ilbl">Campus</span><span class="ival">${campusCode}</span></div>
      ${soNums ? `<div class="ifield"><span class="ilbl">SO No</span><span class="ival">${soNums}</span></div>` : ''}
      ${campusPhone ? `<div class="ifield"><span class="ilbl">Phone</span><span class="ival">${campusPhone}</span></div>` : ''}
      ${campusAddress ? `<div class="ifield"><span class="ilbl">Address</span><span class="ival">${campusAddress}</span></div>` : ''}
      ${customer ? `<div class="ifield"><span class="ilbl">Customer</span><span class="ival">${customer}</span></div>` : ''}
      ${header.note ? `<div class="ifield"><span class="ilbl">Note</span><span class="ival">${header.note}</span></div>` : ''}
    </div>
    <div class="icard">
      <div class="ichdr">Receipt Details</div>
      <div class="ifield"><span class="ilbl">Invoice No</span><span class="ival">${header.invoiceNumber}</span></div>
      <div class="ifield"><span class="ilbl">Issue Date</span><span class="ival">${fmtDate(header.issuedAt ?? header.createdAt)}</span></div>
      ${header.dueAt ? `<div class="ifield"><span class="ilbl">Due Was</span><span class="ival">${fmtDate(header.dueAt)}</span></div>` : ''}
      <div class="ifield"><span class="ilbl">Status</span><span class="ival"><span class="st-paid">PAID</span></span></div>
    </div>
  </div>

  ${itemGroups}
  ${footerBreak ? '<div class="pg-break"></div>' : ''}
  <div class="sum-b">
    ${discount > 0 ? `<div class="srow disc"><span class="sl">Discount</span><span class="sv">- ${fmtC(discount)}</span></div>` : ''}
    <div class="srow grand"><span class="sl">TOTAL PAID</span><span class="sv">${fmtC(grandTotal)}</span></div>
  </div>

  <div class="sig-row2">
    <div class="sig-b"><div class="sig-ln"></div><div class="sig-lb">Prepared By</div></div>
    <div class="sig-b"><div class="sig-ln"></div><div class="sig-lb">Received By</div></div>
  </div>

</div>

${scalerClose}
</body>
</html>`;
};

const buildInvoiceHeaderHTML = (
  header: ApiInvoiceHeader,
  campusMap: Record<string, ApiCampus>,
  productMap: Record<string, ApiProduct> = {},
  forPrint = false,
  previewWidth?: number,
  uomMap: Record<number, ApiUom> = {},
): string => {
  const isPreview = !!previewWidth;
  const scale     = isPreview ? (previewWidth! / A4_PX) : 1;
  const scaledH   = isPreview ? Math.round(A4_H * scale) : A4_H;

  const campusCode =
    header.campusCode ??
    header.campus?.campusCode ??
    campusMap[String(header.campusId)]?.campusCode ??
    String(header.campusId);

  const campusObj: any = campusMap[String(header.campusId)] ?? header.campus ?? {};
  const campusPhone   = campusObj?.phone   ?? (header.campus as any)?.phone   ?? '';
  const campusAddress = campusObj?.address ?? (header.campus as any)?.address ?? '';

  const customer = header.customerOrg?.nameEn ?? header.customerOrg?.name ?? '';

  const soNums = [...new Set(
    (header.details ?? []).map((d: any) => d.soReferenceNumber).filter(Boolean)
  )].join(', ');

  const fmtC = (cents: number) => `$${(cents / 100).toFixed(2)}`;

  // Aggregate details by productId so the same SKU from multiple SOs prints as one line.
  const detailMap: Record<string, { nameEn: string; nameKh: string; barcode: string; uomCode: string; unit: number; qty: number; dis: number; total: number }> = {};
  (header.details ?? []).forEach(d => {
    const prod    = d.productId ? productMap[d.productId] : undefined;
    const rd      = d as any;
    const key     = d.productId ?? rd.productSku ?? rd.productNameEn ?? String(Math.random());
    const nameEn  = prod?.nameEn ?? rd.productNameEn ?? rd.product_name_en ?? rd.nameEn ?? '—';
    const nameKh  = prod?.nameKm ?? rd.productNameKh ?? rd.productNameKm ?? '';
    const barcode = prod?.barcode ?? prod?.sku ?? rd.productSku ?? '';
    const uomCode = (prod?.uomId != null ? uomMap[prod.uomId]?.code : undefined) ?? prod?.unit ?? '';
    const unit    = parseCents(d.unitPriceCents);
    const dis     = parseCents(d.discountCents);
    const qty     = Number(d.qty ?? 0);
    const total   = qty * unit - dis;
    if (!detailMap[key]) detailMap[key] = { nameEn, nameKh, barcode, uomCode, unit, qty: 0, dis: 0, total: 0 };
    detailMap[key].qty   += qty;
    detailMap[key].dis   += dis;
    detailMap[key].total += total;
  });
  const hasVisibleText = (kh: string, en: string) =>
    /[A-Za-z0-9\u1780-\u17b3\u17e0-\u17e9\u19e0-\u19ff]/.test(`${kh ?? ''} ${en ?? ''}`);
  const items = Object.entries(detailMap)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([, r]) => r)
    .filter(r => r.qty > 0 && (r.unit > 0 || r.total > 0) && hasVisibleText(r.nameKh, r.nameEn))
    .map((r, i) => ({ no: i + 1, ...r }));

  const grandTotal  = parseCents(header.totalCents) || items.reduce((s, it) => s + it.total, 0);
  const subtotal    = items.reduce((s, it) => s + it.qty * it.unit, 0);
  const discount    = items.reduce((s, it) => s + it.dis, 0);
  const hasDiscount = discount > 0;

  const statusClass =
    (header.status ?? '').toLowerCase() === 'paid'      ? 'st-paid'      :
    (header.status ?? '').toLowerCase() === 'cancelled' ? 'st-cancelled'  : 'st-issued';

  const colHdr = `
    <div class="tbl-row hdr-row">
      <div class="tbl-cell tc-no c">No</div>
      <div class="tbl-cell tc-bar">Barcode</div>
      <div class="tbl-cell tc-nam">Description</div>
      <div class="tbl-cell tc-unit c">Unit</div>
      <div class="tbl-cell tc-pri r">Price</div>
      <div class="tbl-cell tc-qty c">Qty</div>
      ${hasDiscount ? '<div class="tbl-cell tc-dis r">Discount</div>' : ''}
      <div class="tbl-cell tc-amt r">Amount</div>
    </div>`;

  const ROWS_P1  = 14;
  const ROWS_PN  = 25;
  const PAGE_H   = 1009;
  const P1_HDR_H = 280;
  const COL_H    = 30;
  const ROW_H    = 26;
  const SUMM_H   = hasDiscount ? 82 : 60;
  const FOOTER_H = 240;

  const invGroups = items.length <= ROWS_P1
    ? [items]
    : [
        items.slice(0, ROWS_P1),
        ...Array.from(
          { length: Math.ceil((items.length - ROWS_P1) / ROWS_PN) },
          (_, i) => items.slice(ROWS_P1 + i * ROWS_PN, ROWS_P1 + (i + 1) * ROWS_PN)
        ),
      ];

  const lastInvGroup   = invGroups[invGroups.length - 1];
  const usedOnLastPage = (invGroups.length === 1 ? P1_HDR_H : 0) + COL_H + lastInvGroup.length * ROW_H + SUMM_H;
  const footerBreak    = (PAGE_H - usedOnLastPage) < FOOTER_H;

  const summaryRows = `
    <div class="tbl-row sub-row">
      <div class="tbl-cell tc-grand-lbl">Sub Total</div>
      <div class="tbl-cell tc-amt r">${fmtC(subtotal)}</div>
    </div>
    ${hasDiscount ? `
    <div class="tbl-row disc-row">
      <div class="tbl-cell tc-grand-lbl">Discount</div>
      <div class="tbl-cell tc-amt r">- ${fmtC(discount)}</div>
    </div>` : ''}
    <div class="tbl-row grand-row">
      <div class="tbl-cell tc-grand-lbl">Total</div>
      <div class="tbl-cell tc-amt r bold">${fmtC(grandTotal)}</div>
    </div>`;

  const itemGroupsHtml = invGroups.map((grp, gi) => {
    const start  = invGroups.slice(0, gi).reduce((s, g) => s + g.length, 0);
    const isLast = gi === invGroups.length - 1;
    const rows   = grp.map((it, li) => {
      const idx = start + li;
      return `
    <div class="tbl-row${idx % 2 === 1 ? ' alt' : ''}">
      <div class="tbl-cell tc-no">${it.no}</div>
      <div class="tbl-cell tc-bar">${it.barcode || '—'}</div>
      <div class="tbl-cell tc-nam">
        <div class="iname">${it.nameKh ? `${it.nameKh} - ${it.nameEn}` : it.nameEn}</div>
      </div>
      <div class="tbl-cell tc-unit c">${it.uomCode || '—'}</div>
      <div class="tbl-cell tc-pri r">${fmtC(it.unit)}</div>
      <div class="tbl-cell tc-qty c">${it.qty}</div>
      ${hasDiscount ? `<div class="tbl-cell tc-dis r ${it.dis > 0 ? 'red' : 'muted'}">${it.dis > 0 ? `- ${fmtC(it.dis)}` : '—'}</div>` : ''}
      <div class="tbl-cell tc-amt r bold">${fmtC(it.total)}</div>
    </div>`;
    }).join('');
    const tblW = `<div class="tbl-w">${gi === 0 ? colHdr : ''}${rows}${isLast ? summaryRows : ''}</div>`;
    return gi === 0 ? tblW : `<div class="pg-break"></div>${tblW}`;
  }).join('');

  const scalerWrap = isPreview
    ? `<div style="width:${previewWidth}px;height:${scaledH}px;overflow:hidden;">
       <div style="width:${A4_PX}px;transform:scale(${scale.toFixed(6)});transform-origin:top left;">`
    : '';
  const scalerClose = isPreview ? '</div></div>' : '';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=${isPreview ? previewWidth : A4_PX},initial-scale=1.0"/>
<style>
  @page { size:A4 portrait; margin:0; }
  *,*::before,*::after {
    box-sizing:border-box; margin:0; padding:0;
    -webkit-print-color-adjust:exact; print-color-adjust:exact;
  }
  body {
    font-family:Times,'Times New Roman',serif; font-size:12px;
    color:#212121; background:#fff; width:${A4_PX}px;
  }
  * { font-weight:400 !important; }
  .ichdr { font-weight:700 !important; }
  .ival  { font-weight:700 !important; }
  .sv    { font-weight:700 !important; }
  .tc-amt { font-weight:700 !important; }
  .bold  { font-weight:700 !important; }
  .inv-title { font-weight:700 !important; }
  .co-n { font-weight:700 !important; }

  /* ── Header Band ── */
  .inv-hdr {
    background:#fff; color:#212121;
    padding:14px 36px 6px;
    display:flex; align-items:center; gap:10px;
  }
  .logo-w { width:48px;height:48px;border-radius:8px;overflow:hidden;flex-shrink:0;background:#F5F5F5; }
  .logo-w img { width:100%;height:100%;display:block;object-fit:cover; }
  .co-b   { flex:1; }
  .co-n   { font-size:13px;font-weight:900;letter-spacing:2px;text-transform:uppercase;color:#212121; }
  .co-s   { font-size:8px;color:#757575;line-height:1.5;margin-top:2px; }
  .inv-title-wrap { text-align:center;margin-bottom:12px; }
  .inv-title      { font-size:20px;font-weight:900;letter-spacing:5px;text-transform:uppercase;color:#37474F;line-height:1;display:inline-block;border-bottom:2px solid #37474F;padding-bottom:0; }
  .inv-bg     { display:inline-block;flex-shrink:0;padding:3px 10px;border-radius:8px;
                font-size:9px;font-weight:700;letter-spacing:.5px;text-transform:uppercase; }

  /* ── Content ── */
  .body { padding:12px 36px 36px; }

  /* ── Info cards ── */
  .irow2  { display:flex;gap:14px;margin-bottom:20px; }
  .icard  { flex:1;padding:12px 14px;border:1px solid #EEE;border-radius:8px;background:#FAFAFA; }
  .ichdr  { font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;
            color:#546E7A;padding-bottom:5px;margin-bottom:8px;border-bottom:2px solid #546E7A; }
  .ifield { display:flex;gap:6px;margin-bottom:4px; }
  .ilbl   { font-size:9.5px;color:#000;font-weight:600;width:72px;flex-shrink:0; }
  .ival   { font-size:11px;font-weight:600;color:#212121; }
  .st-issued    { background:#E3F2FD;color:#1565C0;padding:2px 8px;border-radius:8px;font-size:10px;font-weight:700; }
  .st-paid      { background:#E8F5E9;color:#2E7D32;padding:2px 8px;border-radius:8px;font-size:10px;font-weight:700; }
  .st-cancelled { background:#FFEBEE;color:#C62828;padding:2px 8px;border-radius:8px;font-size:10px;font-weight:700; }

  /* ── Section title ── */
  .stitle { font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#546E7A;margin-bottom:8px; }

  /* ── Items table (div-based — reliable page breaks on iOS WebKit) ── */
  .tbl-w { border:1px solid #EEE; margin-bottom:0; }
  .tbl-row { display:flex; align-items:stretch; min-height:20px; border-bottom:1px solid #F5F5F5; page-break-inside:avoid; break-inside:avoid; }
  .tbl-row:last-child { border-bottom:none; }
  .hdr-row { background:#E3F2FD; border-bottom:2px solid #BBDEFB; page-break-after:avoid; break-after:avoid; }
  .tbl-row.alt { background:#FAFAFA; }
  .tbl-cell { padding:3px 8px; font-size:12px; display:flex; align-items:center; border-right:1px solid #E0E0E0; }
  .tbl-cell:last-child { border-right:none; }
  .hdr-row .tbl-cell { font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.5px; color:#1565C0; padding:5px 8px; }
  .tc-no  { width:28px; flex-shrink:0; justify-content:center; text-align:center; }
  .tc-bar { width:110px; flex-shrink:0; font-size:12px; color:#212121; }
  .tc-nam { flex:1; min-width:0; overflow:hidden; align-items:center; justify-content:flex-start; }
  .tc-unit { width:46px; flex-shrink:0; justify-content:center; text-align:center; }
  .tc-pri { width:68px; flex-shrink:0; justify-content:flex-end; text-align:right; }
  .tc-qty { width:34px; flex-shrink:0; justify-content:center; text-align:center; }
  .tc-dis { width:64px; flex-shrink:0; justify-content:flex-end; text-align:right; }
  .tc-amt { width:72px; flex-shrink:0; justify-content:flex-end; text-align:right; }
  .c { justify-content:center; text-align:center; }
  .r { justify-content:flex-end; text-align:right; }
  .red  { color:#546E7A; } .muted { color:#BDBDBD; } .bold { font-weight:700; }
  .iname { font-weight:600; font-size:12px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .grand-row { background:#37474F; color:#fff; border-bottom:none; page-break-inside:avoid; break-inside:avoid; }
  .grand-row .tbl-cell { border-right-color:#555; color:#fff; font-size:14px; font-weight:800; padding:8px 8px; }
  .tc-grand-lbl { flex:1; min-width:0; text-align:right; padding-right:12px; }
  .sub-row { background:#F5F5F5; border-bottom:1px solid #EEE; }
  .sub-row .tbl-cell { font-size:12px; font-weight:600; color:#546E7A; padding:5px 8px; }
  .disc-row .tbl-cell { font-size:12px; font-weight:600; color:#E53935; padding:5px 8px; }

  /* ── Summary ── */
  .sum-b { display:inline-block; width:100%; border:1px solid #EEE; border-top:none; overflow:hidden; page-break-inside:avoid; break-inside:avoid; page-break-before:avoid; break-before:avoid; }
  .srow  { display:flex; justify-content:space-between; align-items:center; padding:8px 11px; font-size:12px; border-bottom:1px solid #F5F5F5; }
  .srow:last-child { border-bottom:none; }
  .srow.disc .sv { color:#546E7A; }
  .srow.grand { background:#37474F; color:#fff; font-size:15px; font-weight:800; padding:10px 11px; }
  .sl { font-weight:600; }
  .sv { font-weight:700; }

  /* ── Payment ── */
  .pay-c  { border:1px solid #EEE;border-radius:8px;margin-top:16px;margin-bottom:8px; }
  .pay-h  { background:#212121;color:#fff;padding:9px 14px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px; }
  .prow   { display:flex;padding:7px 14px;border-bottom:1px solid #F5F5F5; }
  .prow:last-child { border-bottom:none; }
  .pl     { width:100px;font-size:10px;color:#9E9E9E;font-weight:600;flex-shrink:0; }
  .pv     { font-size:11px;font-weight:700; }

  /* ── Signature ── */
  .sig-section { display:flex; margin-top:10px; }
  .sig-col { flex:1; text-align:center; font-size:11px; font-weight:700; color:#555; padding:4px 5px 6px; }
  .sig-line { height:50px; overflow:hidden; margin:0 8px 4px; }
  .sig-lbl { border-top:1.5px solid #333; margin:0 8px; padding-top:4px; }

  /* ── Footer strip ── */
  .foot { background:#F5F5F5;color:#757575;text-align:center;
          padding:9px;font-size:10px;letter-spacing:.4px;margin-top:20px;
          border-top:1px solid #EEE; }
</style>
</head>
<body>
${scalerWrap}

<!-- Header -->
<div class="inv-hdr">
  <div class="logo-w"><img src="${LOGO_BASE64}" alt="logo"/></div>
  <div class="co-b">
    <div class="co-n">${COMPANY.name}</div>
    <div class="co-s">${COMPANY.addr1}<br/>${COMPANY.addr2}<br/>${COMPANY.contact}</div>
  </div>
</div>

<div class="body">

  <!-- INVOICE title -->
  <div class="inv-title-wrap">
    <div class="inv-title">INVOICE</div>
  </div>

  <!-- Bill To + Invoice Details -->
  <div class="irow2">
    <div class="icard">
      <div class="ichdr">Bill To</div>
      <div class="ifield"><span class="ilbl">Campus</span><span class="ival">${campusCode}</span></div>
      ${soNums ? `<div class="ifield"><span class="ilbl">SO No</span><span class="ival">${soNums}</span></div>` : ''}
      ${campusPhone ? `<div class="ifield"><span class="ilbl">Phone</span><span class="ival">${campusPhone}</span></div>` : ''}
      ${campusAddress ? `<div class="ifield"><span class="ilbl">Address</span><span class="ival">${campusAddress}</span></div>` : ''}
      ${customer ? `<div class="ifield"><span class="ilbl">Customer</span><span class="ival">${customer}</span></div>` : ''}
      ${header.note ? `<div class="ifield"><span class="ilbl">Note</span><span class="ival">${header.note}</span></div>` : ''}
    </div>
    <div class="icard">
      <div class="ichdr">Invoice Details</div>
      <div class="ifield"><span class="ilbl">Invoice No</span><span class="ival">${header.invoiceNumber}</span></div>
      <div class="ifield"><span class="ilbl">Issue Date</span><span class="ival">${fmtDate(header.issuedAt ?? header.createdAt)}</span></div>
      ${header.dueAt ? `<div class="ifield"><span class="ilbl">Due Date</span><span class="ival">${fmtDate(header.dueAt)}</span></div>` : ''}
      <div class="ifield"><span class="ilbl">Status</span><span class="ival"><span class="${statusClass}">${header.status ?? 'ISSUED'}</span></span></div>
    </div>
  </div>

  <!-- Items Table -->
  ${itemGroupsHtml}
  ${footerBreak ? '<div class="pg-break"></div>' : ''}

  <!-- Payment + Signature -->
  <div id="pay-sig" style="page-break-inside:avoid;break-inside:avoid;">
    <div class="pay-c">
      <div class="pay-h">Payment Information</div>
      <div class="prow"><span class="pl">Bank</span><span class="pv">ABA Bank</span></div>
      <div class="prow"><span class="pl">Account Name</span><span class="pv">${COMPANY.abaHolder.replace(/<br\/>/g, ' ')}</span></div>
      <div class="prow"><span class="pl">Account No</span><span class="pv">${COMPANY.abaAccount}</span></div>
    </div>
    <div class="sig-section" style="margin-top:10px;">
      <div class="sig-col"><div class="sig-line"></div><div class="sig-lbl">Prepared By</div></div>
      <div class="sig-col"><div class="sig-line"></div><div class="sig-lbl">Received By</div></div>
    </div>
  </div>

</div>

${scalerClose}
</body>
</html>`;
};

// ─── Sale Order preview builder (reuses RECEIPT_CSS + small overrides) ────────
const buildSOPreviewHTML = (
  order: ApiSalesOrder,
  productMap: Record<string, ApiProduct>,
  campusMap: Record<string, ApiCampus>,
  uomMap: Record<number, ApiUom> = {},
  previewWidth?: number,
): string => {
  const items = (order.items ?? []).map((item, i) => {
    const product    = productMap[item.productId];
    const dis        = item.discountCents ?? 0;
    const lineCents  = item.qty * item.unitPriceCents;
    const totalCents = lineCents - dis;
    const afterDisc  = item.qty > 0 ? Math.round(totalCents / item.qty) : item.unitPriceCents;
    const disPct     = lineCents > 0 ? ((dis / lineCents) * 100).toFixed(1) : '0';
    const nameEn     = item.productName ?? product?.nameEn ?? product?.sku ?? `Item ${i + 1}`;
    const nameKm     = item.productNameKh ?? product?.nameKm ?? '';
    const nameCell   = nameKm
      ? `${nameKm}<br/><span style="font-size:8.5px;color:#555;">${nameEn}</span>`
      : nameEn;
    const barcode = item.productCode ?? product?.sku ?? '';
    const unit    = (product?.uomId != null ? uomMap[product.uomId]?.code : undefined) ?? product?.unit ?? '';
    return { no: i + 1, nameCell, barcode, unit, orinCents: item.unitPriceCents, disPct, qty: item.qty, afterDisc, totalCents };
  }).filter(it => it.qty > 0);

  const subtotalCents   = items.reduce((s, it) => s + it.qty * it.orinCents, 0);
  const discountCents   = items.reduce((s, it) => s + (it.qty * it.orinCents - it.totalCents), 0);
  const discPct         = subtotalCents > 0 ? ((discountCents / subtotalCents) * 100).toFixed(1) : '0';
  const grandTotalCents = order.totalCents != null ? order.totalCents : subtotalCents - discountCents;
  const hasDiscount     = discountCents > 0;

  const campusCode = order.campusCode ?? order.campus?.campusCode ?? (order.campusId != null ? campusMap[String(order.campusId)]?.campusCode : null) ?? '—';
  const customerKh = order.customerOrg?.nameKm ?? '';
  const customerEn = order.customerOrgName ?? order.customerOrg?.nameEn ?? order.customerOrg?.name ?? '';
  const refNo      = order.referenceNumber ?? order.ref ?? order.orderNumber ?? order.id;


  const dataRows = items.map(it => `
    <tr>
      <td class="c"><span class="no-badge">${it.no}</span></td>
      <td class="c" style="font-size:8px;">${it.barcode}</td>
      <td class="l">${it.nameCell}</td>
      <td class="c" style="font-size:9px;">${it.unit || '—'}</td>
      ${hasDiscount ? `<td class="r">$${(it.orinCents / 100).toFixed(2)}</td>` : ''}
      ${hasDiscount ? `<td class="c">${parseFloat(it.disPct) > 0 ? `${it.disPct}%` : '<span style="color:#c0c0c0;">—</span>'}</td>` : ''}
      <td class="r">$${(it.afterDisc / 100).toFixed(2)}</td>
      <td class="c">${it.qty}</td>
      <td class="r">$${(it.totalCents / 100).toFixed(2)}</td>
    </tr>`).join('');

  const colgroup = hasDiscount
    ? `<colgroup><col style="width:22px"/><col style="width:52px"/><col/><col style="width:36px"/><col style="width:48px"/><col style="width:30px"/><col style="width:46px"/><col style="width:24px"/><col style="width:54px"/></colgroup>`
    : `<colgroup><col style="width:22px"/><col style="width:56px"/><col/><col style="width:40px"/><col style="width:56px"/><col style="width:26px"/><col style="width:64px"/></colgroup>`;
  const thead = hasDiscount
    ? `<tr><th>No</th><th>Barcode</th><th class="l">Description</th><th>Unit</th><th>Ori Price</th><th>Dis</th><th>Price</th><th>Qty</th><th>Amount</th></tr>`
    : `<tr><th>No</th><th>Barcode</th><th class="l">Description</th><th>Unit</th><th>Price</th><th>Qty</th><th>Amount</th></tr>`;

  const scalerCss = previewWidth ? (() => {
    const scale   = previewWidth / A5_PX;
    const scaledH = Math.round(A5_H * scale);
    return `html,body{width:${previewWidth}px;height:${scaledH}px;overflow:hidden;}.scaler{width:${A5_PX}px;height:${A5_H}px;transform:scale(${scale.toFixed(6)});transform-origin:top left;}`;
  })() : '';

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"/>
<style>${RECEIPT_CSS}</style>
<style>
  .page { padding-bottom:170px; }
  .so-title { font-size:16px; font-weight:900; text-decoration:underline; color:#2563EB; }
  thead th { background:#EFF6FF; }
  .no-badge { background:#EFF6FF; color:#2563EB; }
  .totals-grand { color:#000; }
  ${scalerCss}
</style>
</head><body>
${previewWidth ? '<div class="scaler">' : ''}
<div class="page">
  <div class="content">
    <div class="hdr">
      <div class="logo"><img src="${LOGO_BASE64}"/></div>
      <div class="hdr-mid">
        <div class="co-name">${COMPANY.name}</div>
        <div class="co-addr">${COMPANY.addr1}<br/>${COMPANY.addr2}<br/>${COMPANY.contact}</div>
        <div class="so-title">SALE ORDER</div>
      </div>
      <div class="hdr-right"></div>
    </div>
    <div class="hr"></div>
    <div class="info-row">
      <div class="info-box">
        <b>To:</b> ${campusCode}${customerKh ? `<br/><b>Customer:</b> ${customerKh}` : ''}${customerEn ? `<br/><span style="font-size:9px;">${customerEn}</span>` : ''}<br/>
        <b>Date:</b> ${fmtDate(order.createdAt)}
      </div>
      <div class="info-box">
        <b>Ref No:</b> ${refNo}<br/>
        <b>Status:</b> ${(order.status ?? '').toUpperCase()}
      </div>
    </div>
    <div class="tbl-wrap">
      <table>
        ${colgroup}
        <thead>${thead}</thead>
        <tbody>${dataRows}</tbody>
      </table>
    </div>
  </div>
  <div class="footer">
    <div class="totals">
      <div class="totals-row"><span class="totals-lbl">Sub Total</span><span class="totals-val">$${(subtotalCents / 100).toFixed(2)}</span></div>
      ${hasDiscount ? `<div class="totals-row totals-disc"><span class="totals-lbl">Discount${parseFloat(discPct) > 0 ? ` (${discPct}%)` : ''}</span><span class="totals-val">- $${(discountCents / 100).toFixed(2)}</span></div>` : ''}
      <div class="totals-row totals-grand"><span class="totals-lbl">Grand Total</span><span class="totals-val">$${(grandTotalCents / 100).toFixed(2)}</span></div>
    </div>
    <div class="sig-section">
      <div class="sig-col"><div class="sig-line"></div>Prepare By</div>
      <div class="sig-col"><div class="sig-line"></div>Check By</div>
      <div class="sig-col"><div class="sig-line"></div>Received By</div>
    </div>
  </div>
</div>
${previewWidth ? '</div>' : ''}
</body></html>`;
};

const buildInvoiceSummaryHTML = (
  headers: ApiInvoiceHeader[],
  campusMap: Record<string, ApiCampus>,
  description = '',
  summaryNumber = '',
  receivedNote = '',
): string => {
  const rows = headers.map((h, i) => {
    const cents  = parseCents(h.totalCents);
    const usdAmt = cents / 100;
    const date   = fmtDate(h.issuedAt ?? h.createdAt);
    const isPaid = (h.status ?? '').toLowerCase() === 'paid';
    const campus = h.campusCode ?? h.campus?.campusCode ?? campusMap[String(h.campusId)]?.campusCode ?? '—';
    return { no: i + 1, invNum: h.invoiceNumber, note: h.note ?? '', campus, date, isPaid, usdAmt, cents };
  });

  // Sum cents (integers) to avoid floating-point drift, then convert once at the end.
  const totalUsd = rows.reduce((s, r) => s + r.cents, 0) / 100;

  const dataRows = rows.map(r => `
    <tr>
      <td class="c">${r.no}</td>
      <td><b>${r.invNum}</b></td>
      <td style="font-size:10px;color:#555;">${r.note}</td>
      <td class="c">${r.campus}</td>
      <td class="c">${r.date}</td>
      <td class="c">
        <span class="badge ${r.isPaid ? 'badge-paid' : 'badge-inv'}">
          ${r.isPaid ? 'Paid' : 'Invoiced'}
        </span>
      </td>
      <td class="r">$${r.usdAmt.toFixed(2)}</td>
    </tr>`).join('');

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"/>
<style>
  @page { size: A4 portrait; margin: 8mm 15mm 8mm 15mm; }
  *, *::before, *::after { margin:0; padding:0; box-sizing:border-box; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  body { font-family: Times,'Times New Roman',serif; font-size: 11px; color: #000; background: #fff; }
  .page { padding: 8px 20px 8px 20px; }
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
  table { width:100%; border-collapse:collapse; margin-top:10px; }
  thead tr { background:#EFF6FF; }
  thead th { padding:8px 6px; font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:0.4px; border-bottom:1.5px solid #000; border-right:1px solid #d0d0d0; }
  thead th:last-child { border-right:none; }
  tbody tr { height:18px; }
  tbody td { padding:4px 6px; font-size:11px; border-bottom:1px solid #e8e8e8; border-right:1px solid #e8e8e8; vertical-align:middle; }
  tbody td:last-child { border-right:none; font-weight:700; }
  tbody tr:nth-child(even) { background:#FAFAFA; }
  .c { text-align:center; }
  .r { text-align:right; }
  .badge { display:inline-block; border-radius:4px; padding:2px 8px; font-size:10px; font-weight:700; }
  .badge-paid { background:#D1FAE5; color:#059669; }
  .badge-inv  { background:#EDE9FE; color:#7C3AED; }
  tfoot tr { background:#EFF6FF; }
  tfoot td { padding:9px 6px; font-size:18px; font-weight:800; border-top:2px solid #000; }
  .total-lbl { font-size:12px; font-weight:700; color:#2563EB; }
  .bottom { display:flex; gap:20px; margin-top:24px; align-items:flex-start; }
  .bank-box { flex:1; border:1px solid #d0d0d0; border-radius:6px; overflow:hidden; }
  .bank-title { background:#EFF6FF; padding:6px 10px; font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:0.5px; color:#2563EB; border-bottom:1px solid #d0d0d0; }
  .bank-row { display:flex; padding:5px 10px; border-bottom:1px solid #f0f0f0; }
  .bank-row:last-child { border-bottom:none; }
  .bank-lbl { width:110px; font-size:10px; color:#666; font-weight:600; flex-shrink:0; }
  .bank-val { font-size:10px; font-weight:700; color:#000; }
  .page-footer { margin-top:24px; }
  .sig-section { display:flex; gap:16px; padding-top:8px; }
  .sig-col { flex:1; display:flex; flex-direction:column; align-items:center; gap:6px; }
  .sig-line { width:100%; border-bottom:1.5px solid #000; margin-bottom:4px; height:40px; }
  .sig-label { font-size:10px; font-weight:700; color:#444; text-align:center; }
  @media print {
    body { -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  }
</style>
</head><body>
<div class="page">
  <div class="hdr">
    <div class="logo"><img src="${LOGO_BASE64}"/></div>
    <div class="hdr-info">
      <div class="co-name">${COMPANY.name}</div>
      <div class="co-sub">${COMPANY.addr1}, ${COMPANY.addr2}</div>
    </div>
    <div>
      ${summaryNumber ? `<div class="summary-number">${summaryNumber}</div>` : ''}
      <div class="report-title">INVOICE SUMMARY</div>
      <div class="report-date">Generated: ${new Date().toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })}</div>
    </div>
  </div>
  <hr/>
  ${description ? `<div style="font-size:11px;color:#444;margin:6px 0 10px 0;">${description}</div>` : ''}
  <table>
    <thead>
      <tr>
        <th class="c" style="width:36px">No</th>
        <th>Invoice #</th>
        <th style="width:120px">Note</th>
        <th class="c" style="width:60px">Campus</th>
        <th class="c" style="width:85px">Date</th>
        <th class="c" style="width:75px">Status</th>
        <th class="r" style="width:85px">Amount (USD)</th>
      </tr>
    </thead>
    <tbody>${dataRows}</tbody>
    <tfoot>
      <tr>
        <td colspan="5" class="r total-lbl">Grand Total</td>
        <td colspan="2" class="r">$${totalUsd.toFixed(2)}</td>
      </tr>
    </tfoot>
  </table>
  ${receivedNote?.trim() ? `<div style="font-size:10px;color:#444;font-style:italic;margin-top:6px;"><b>Note:</b> ${receivedNote.trim()}</div>` : ''}

  <div class="bottom">
    <div class="bank-box">
      <div class="bank-title">Payment Bank Details</div>
      <div class="bank-row">
        <span class="bank-lbl">Bank Name</span>
        <span class="bank-val">ABA Bank</span>
      </div>
      <div class="bank-row">
        <span class="bank-lbl">Account Name</span>
        <span class="bank-val">${COMPANY.abaHolder.replace(/<br\/>/g, ' ')}</span>
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

const buildSavedSummaryHTML = (
  summary: ApiInvoiceSummary,
  invoiceHeaderMap: Record<string, ApiInvoiceHeader>,
  campusMap: Record<string, ApiCampus>,
): string => {
  const items = summary.invoices ?? [];
  // reuse the same CSS/layout as buildInvoiceSummaryHTML by delegating to it with a temp object
  return buildInvoiceSummaryHTML(
    items.map(it => {
      const header = invoiceHeaderMap[it.id];
      return {
        id:             it.id,
        invoiceNumber:  it.invoiceNumber,
        customerOrgId:  '',
        campusId:       header?.campusId ?? 0,
        campusCode:     header?.campusCode ?? header?.campus?.campusCode ?? campusMap[String(header?.campusId)]?.campusCode ?? '—',
        status:         it.status,
        totalCents:     it.totalCents,
        rateUsed:       it.rateUsed ?? summary.rateUsed,
        issuedAt:       it.issuedAt,
        createdAt:      it.issuedAt ?? '',
        note:           it.note ?? '',
      };
    }),
    campusMap,
    summary.description ?? '',
    summary.summaryNumber,
    summary.receivedNote ?? '',
  );
};

const buildMergedInvoicesHTML = (
  headers: ApiInvoiceHeader[],
  campMap: Record<string, ApiCampus>,
  prodMap: Record<string, ApiProduct> = {},
  uomMap: Record<number, ApiUom> = {},
): string => {
  if (headers.length === 0) return '<html><body></body></html>';

  const parts: string[] = headers.map((header, i) => {
    const isPaid = (header.status ?? '').toLowerCase() === 'paid';
    const fullHtml = isPaid
      ? buildPaymentReceiptHTML(header, campMap, prodMap)
      : buildInvoiceHeaderHTML(header, campMap, prodMap, false, undefined, uomMap);
    const bodyContent = fullHtml
      .replace(/^[\s\S]*?<body[^>]*>/i, '')
      .replace(/<\/body>[\s\S]*$/i, '');
    const isLast = i === headers.length - 1;
    return `<div style="page-break-after:${isLast ? 'auto' : 'always'};break-after:${isLast ? 'auto' : 'always'};">${bodyContent}</div>`;
  });

  const firstIsPaid = (headers[0].status ?? '').toLowerCase() === 'paid';
  const firstHtml = firstIsPaid
    ? buildPaymentReceiptHTML(headers[0], campMap, prodMap)
    : buildInvoiceHeaderHTML(headers[0], campMap, prodMap, false, undefined, uomMap);
  const styleMatch = firstHtml.match(/<style>([\s\S]*?)<\/style>/i);
  const css = styleMatch ? styleMatch[1] : '';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=794,initial-scale=1.0"/>
<style>${css}</style>
</head>
<body>${parts.join('')}</body>
</html>`;
};

// ─── Qty stepper pill for the Edit Items modal ───────────────────────────────
const EditQtyPill: React.FC<{
  qty: string;
  onChangeText: (v: string) => void;
  onDecrement: () => void;
  onIncrement: () => void;
  onEndEditing?: () => void;
}> = ({ qty, onChangeText, onDecrement, onIncrement, onEndEditing }) => (
  <View style={editStyles.qtyPill}>
    <TouchableOpacity
      style={editStyles.qtyPillBtn}
      onPress={onDecrement}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
    >
      <Icon name="remove" size={15} color={Colors.primary} />
    </TouchableOpacity>
    <TextInput
      style={editStyles.qtyPillInput}
      value={qty}
      onChangeText={v => onChangeText(v.replace(/[^0-9]/g, ''))}
      onEndEditing={onEndEditing}
      keyboardType="number-pad"
      selectTextOnFocus
      maxLength={4}
      returnKeyType="done"
    />
    <TouchableOpacity
      style={editStyles.qtyPillBtn}
      onPress={onIncrement}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
    >
      <Icon name="add" size={15} color={Colors.primary} />
    </TouchableOpacity>
  </View>
);

const PAGE_SIZE = 20;

const AnimatedInvoiceIcon: React.FC = () => {
  const bounceY   = useRef(new Animated.Value(0)).current;
  const stampScale = useRef(new Animated.Value(0)).current;
  const stampOpacity = useRef(new Animated.Value(0)).current;
  const glowScale = useRef(new Animated.Value(0.6)).current;
  const glowOpacity = useRef(new Animated.Value(0)).current;
  const line1W = useRef(new Animated.Value(0)).current;
  const line2W = useRef(new Animated.Value(0)).current;
  const line3W = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Doc bounce
    Animated.loop(
      Animated.sequence([
        Animated.timing(bounceY, { toValue: -6, duration: 500, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(bounceY, { toValue: 0, duration: 400, easing: Easing.in(Easing.quad), useNativeDriver: true }),
        Animated.delay(800),
      ]),
    ).start();

    // Lines draw in
    Animated.sequence([
      Animated.delay(300),
      Animated.timing(line1W, { toValue: 1, duration: 250, easing: Easing.out(Easing.cubic), useNativeDriver: false }),
      Animated.timing(line2W, { toValue: 1, duration: 250, easing: Easing.out(Easing.cubic), useNativeDriver: false }),
      Animated.timing(line3W, { toValue: 1, duration: 200, easing: Easing.out(Easing.cubic), useNativeDriver: false }),
    ]).start();

    // Glow ring
    Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(glowScale, { toValue: 1.25, duration: 1000, easing: Easing.out(Easing.ease), useNativeDriver: true }),
          Animated.timing(glowOpacity, { toValue: 0.35, duration: 400, useNativeDriver: true }),
        ]),
        Animated.parallel([
          Animated.timing(glowScale, { toValue: 1.5, duration: 700, useNativeDriver: true }),
          Animated.timing(glowOpacity, { toValue: 0, duration: 700, useNativeDriver: true }),
        ]),
        Animated.timing(glowScale, { toValue: 0.6, duration: 0, useNativeDriver: true }),
        Animated.delay(600),
      ]),
    ).start();

    // Stamp pop-in after lines
    Animated.sequence([
      Animated.delay(1100),
      Animated.parallel([
        Animated.spring(stampScale, { toValue: 1, tension: 180, friction: 7, useNativeDriver: true }),
        Animated.timing(stampOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
      ]),
      Animated.delay(600),
      Animated.loop(
        Animated.sequence([
          Animated.timing(stampScale, { toValue: 1.12, duration: 350, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(stampScale, { toValue: 1, duration: 350, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.delay(1200),
        ]),
      ),
    ]).start();
  }, []);

  const PURPLE = '#7C3AED';
  const LIGHT  = '#EDE9FE';

  return (
    <View style={{ width: 90, height: 90, alignItems: 'center', justifyContent: 'center' }}>
      {/* Glow ring */}
      <Animated.View style={{
        position: 'absolute', width: 90, height: 90, borderRadius: 45,
        backgroundColor: PURPLE,
        transform: [{ scale: glowScale }],
        opacity: glowOpacity,
      }} />

      {/* Document body */}
      <Animated.View style={{
        transform: [{ translateY: bounceY }],
        alignItems: 'center', justifyContent: 'center',
      }}>
        {/* Paper */}
        <View style={{ width: 52, height: 64, backgroundColor: '#fff', borderRadius: 6, overflow: 'hidden',
          borderWidth: 1.5, borderColor: '#DDD6FE',
          shadowColor: PURPLE, shadowOpacity: 0.2, shadowRadius: 6, shadowOffset: { width: 0, height: 3 }, elevation: 4 }}>
          {/* Purple header band */}
          <View style={{ height: 18, backgroundColor: PURPLE, alignItems: 'center', justifyContent: 'center' }}>
            <View style={{ width: 20, height: 3, backgroundColor: 'rgba(255,255,255,0.6)', borderRadius: 2 }} />
          </View>
          {/* Animated lines */}
          <View style={{ flex: 1, paddingHorizontal: 6, paddingTop: 6, gap: 4 }}>
            {[line1W, line2W, line3W].map((w, i) => (
              <View key={i} style={{ height: 4, backgroundColor: LIGHT, borderRadius: 2, overflow: 'hidden' }}>
                <Animated.View style={{
                  height: 4, borderRadius: 2,
                  backgroundColor: i === 0 ? PURPLE : '#A78BFA',
                  width: w.interpolate({ inputRange: [0, 1], outputRange: ['0%', i === 2 ? '60%' : '100%'] }),
                }} />
              </View>
            ))}
            {/* Dollar amount row */}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 }}>
              <View style={{ width: 14, height: 4, backgroundColor: LIGHT, borderRadius: 2 }} />
              <View style={{ width: 18, height: 4, backgroundColor: '#DDD6FE', borderRadius: 2 }} />
            </View>
          </View>
        </View>

        {/* Stamp badge */}
        <Animated.View style={{
          position: 'absolute', bottom: -6, right: -8,
          width: 24, height: 24, borderRadius: 12,
          backgroundColor: '#10B981', borderWidth: 2, borderColor: '#fff',
          alignItems: 'center', justifyContent: 'center',
          transform: [{ scale: stampScale }],
          opacity: stampOpacity,
          shadowColor: '#10B981', shadowOpacity: 0.4, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 3,
        }}>
          <View style={{ width: 10, height: 5.5, borderLeftWidth: 2, borderBottomWidth: 2, borderColor: '#fff', transform: [{ rotate: '-45deg' }, { translateY: -1 }] }} />
        </Animated.View>
      </Animated.View>
    </View>
  );
};

const SaleInvoiceListScreen: React.FC<Props> = ({ onBack }) => {
  const { showAlert } = useAlert();
  const [orders, setOrders] = useState<ApiSalesOrder[]>([]);
  const [invoicedHeaders, setInvoicedHeaders] = useState<ApiInvoiceHeader[]>([]);
  const [paidHeaders, setPaidHeaders] = useState<ApiInvoiceHeader[]>([]);
  const [invoicedFrom, setInvoicedFrom] = useState(() => {
    const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`;
  });
  const [invoicedTo, setInvoicedTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [invoicedFromPickerVisible, setInvoicedFromPickerVisible] = useState(false);
  const [invoicedToPickerVisible, setInvoicedToPickerVisible] = useState(false);
  const [invoicedFilterLoading, setInvoicedFilterLoading] = useState(false);
  const [invoicedCustomerOrgId, setInvoicedCustomerOrgId] = useState<string | null>(null);
  const [invoicedOrgPickerVisible, setInvoicedOrgPickerVisible] = useState(false);
  const [invoicedOrgSearch, setInvoicedOrgSearch] = useState('');
  const [invoicedRefSearch, setInvoicedRefSearch] = useState('');;
  const [campusMap, setCampusMap] = useState<Record<string, ApiCampus>>({});
  const [productMap, setProductMap] = useState<Record<string, ApiProduct>>({});
  const [uomMap, setUomMap] = useState<Record<number, ApiUom>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
const [exportingReceiptId, setExportingReceiptId] = useState<string | null>(null);
  const [exportingInvoiceId, setExportingInvoiceId] = useState<string | null>(null);
  const [sharingTelegramId, setSharingTelegramId] = useState<string | null>(null);
  const [mergingPDF, setMergingPDF] = useState(false);
  const [printingId, setPrintingId] = useState<string | null>(null);
  const [printingReceiptId, setPrintingReceiptId] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>('received');
  const [searchQuery, setSearchQuery] = useState('');

  const [selectedIds, setSelectedIds] = useState<Record<string, boolean>>({});
  const [selectedInvoiceIds, setSelectedInvoiceIds] = useState<Record<string, boolean>>({});
  const [confirmSummaryVisible, setConfirmSummaryVisible] = useState(false);
  const [summaryDescription, setSummaryDescription] = useState('');
  const [summaryDate, setSummaryDate]               = useState<Date>(new Date());
  const [summaryDatePickerVisible, setSummaryDatePickerVisible] = useState(false);
  const [summaryVisible, setSummaryVisible] = useState(false);
  const [summaryHtml, setSummaryHtml] = useState('');
  const [printingSummary, setPrintingSummary] = useState(false);
  const [savingSummary, setSavingSummary] = useState(false);
  const [savedSummaries, setSavedSummaries]             = useState<ApiInvoiceSummary[]>([]);
  const [summariesLoading, setSummariesLoading]         = useState(false);
  const [summariesError, setSummariesError]             = useState<string | null>(null);
  const [deletingSummaryId, setDeletingSummaryId]       = useState<string | null>(null);
  const [viewSummaryHtml, setViewSummaryHtml]           = useState('');
  const [viewSummaryVisible, setViewSummaryVisible]     = useState(false);
  const [printingViewSummary, setPrintingViewSummary]   = useState(false);
  const [loadingSummaryId, setLoadingSummaryId]         = useState<string | null>(null);
  const [markingPaidId, setMarkingPaidId] = useState<string | null>(null);
  const [generatingInvoice, setGeneratingInvoice] = useState(false);
  const [rateUsed, setRateUsed] = useState('4100');
  const [displayPage, setDisplayPage] = useState(1);

  // Confirm-before-create modal
  const [confirmInvoiceVisible, setConfirmInvoiceVisible] = useState(false);
  const [confirmInvoiceIds, setConfirmInvoiceIds] = useState<Record<string, boolean>>({});

  // Preview modal
  const [previewHtml, setPreviewHtml]       = useState<string>('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewHeader, setPreviewHeader]   = useState<ApiInvoiceHeader | null>(null);

  // Create Invoice modal
  const [invoiceModalVisible, setInvoiceModalVisible] = useState(false);
  const [invoiceError, setInvoiceError]               = useState<string | null>(null);
  const [sigUploading, setSigUploading]               = useState(false);
  const [sigUploaded, setSigUploaded]                 = useState(false);
  const [sigUploadedUrl, setSigUploadedUrl]           = useState<string | null>(null);
  const [hasSig, setHasSig]                           = useState(false);
  const [scrollEnabled, setScrollEnabled]             = useState(true);
  const [invoiceIssuedAt, setInvoiceIssuedAt]         = useState('');
  const [invoiceDueAt, setInvoiceDueAt]               = useState('');
  const [invoiceNote, setInvoiceNote]                 = useState('');
  const [datePickerVisible, setDatePickerVisible]     = useState(false);
  const [dpYear,  setDpYear]  = useState(new Date().getFullYear());
  const [dpMonth, setDpMonth] = useState(new Date().getMonth() + 1);
  const [dpDay,   setDpDay]   = useState(new Date().getDate());
  const sigRef    = useRef<SignaturePadRef>(null);
  const scrollRef = useRef<ScrollView>(null);
  const dpYearRef  = useRef<ScrollView>(null);
  const dpMonthRef = useRef<ScrollView>(null);
  const dpDayRef   = useRef<ScrollView>(null);

  // Edit order items modal
  type EditItem = { id: string; qty: string; price: string; discount: string; name: string; nameKh?: string; sku?: string; imageUrl?: string; productId?: string; isNew?: boolean };
  const [editingOrder, setEditingOrder] = useState<ApiSalesOrder | null>(null);
  const [editItems, setEditItems] = useState<EditItem[]>([]);
  const [savingEdit, setSavingEdit] = useState(false);
  const [loadingEdit, setLoadingEdit] = useState(false);
  const [confirmSaveVisible, setConfirmSaveVisible] = useState(false);
  const [addItemModalVisible, setAddItemModalVisible] = useState(false);
  const [addItemSearch, setAddItemSearch] = useState('');
  const [editCampusId, setEditCampusId] = useState<string | number | null>(null);
  const [campusPickerVisible, setCampusPickerVisible] = useState(false);
  const [campusSearch, setCampusSearch] = useState('');

  const productList = useMemo(() => Object.values(productMap), [productMap]);
  const campusList = useMemo(() => Object.values(campusMap), [campusMap]);

  const filteredAddProducts = useMemo(() => {
    const q = addItemSearch.trim().toLowerCase();
    if (!q) return productList;
    return productList.filter(p =>
      (p.nameEn ?? '').toLowerCase().includes(q) ||
      (p.nameKm ?? '').toLowerCase().includes(q) ||
      (p.sku ?? '').toLowerCase().includes(q)
    );
  }, [productList, addItemSearch]);

  const filteredCampuses = useMemo(() => {
    const q = campusSearch.trim().toLowerCase();
    if (!q) return campusList;
    return campusList.filter(c =>
      (c.campusCode ?? '').toLowerCase().includes(q) ||
      (c.nameEn ?? '').toLowerCase().includes(q) ||
      (c.nameKm ?? '').toLowerCase().includes(q)
    );
  }, [campusList, campusSearch]);

  const toEditItem = (it: ApiSalesOrderItem, idx: number): EditItem => {
    const product = it.productId ? productMap[it.productId] : undefined;
    const subtotalCents = it.unitPriceCents * it.qty;
    const discountCents = it.discountCents ?? 0;
    const pct = subtotalCents > 0 ? (discountCents / subtotalCents) * 100 : 0;
    return {
      id: it.id,
      name: it.productName ?? it.productCode ?? product?.nameEn ?? `Item ${idx + 1}`,
      nameKh: it.productNameKh ?? product?.nameKm,
      sku: it.productCode ?? product?.sku,
      imageUrl: product?.primaryImageUrl ?? undefined,
      qty: String(it.qty),
      price: (it.unitPriceCents / 100).toFixed(2),
      discount: pct > 0 ? (Math.round(pct * 100) / 100).toString() : '',
    };
  };

  const openEditModal = async (order: ApiSalesOrder) => {
    setEditingOrder(order);
    setEditItems([]);
    setConfirmSaveVisible(false);
    setAddItemModalVisible(false);
    setAddItemSearch('');
    setEditCampusId(order.campusId ?? null);
    setCampusPickerVisible(false);
    setCampusSearch('');

    // Use items already in the list if present
    const listItems = Array.isArray(order.items) && order.items.length > 0 ? order.items : null;
    if (listItems) {
      setEditItems(listItems.map(toEditItem));
      return;
    }

    // Otherwise fetch the full order
    setLoadingEdit(true);
    try {
      const full = await getSalesOrderApi(order.id);
      const raw = full.items ?? [];
      setEditItems(raw.map(toEditItem));
    } catch (err: any) {
      showAlert({ type: 'error', title: 'Error', message: err?.message ?? 'Failed to load order items' });
      setEditingOrder(null);
    } finally {
      setLoadingEdit(false);
    }
  };

  const updateEditItem = (idx: number, field: 'qty' | 'price' | 'discount', value: string) => {
    setEditItems(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      return next;
    });
  };

  const addProductToOrder = (product: ApiProduct) => {
    const price = product.fixedPriceCents != null ? (parseInt(product.fixedPriceCents, 10) / 100) : 0;
    const newItem: EditItem = {
      id: `new-${product.id}-${Date.now()}`,
      productId: product.id,
      isNew: true,
      name: product.nameEn,
      nameKh: product.nameKm,
      sku: product.sku,
      imageUrl: product.primaryImageUrl ?? undefined,
      qty: '1',
      price: price.toFixed(2),
      discount: '',
    };
    setEditItems(prev => [...prev, newItem]);
    setAddItemModalVisible(false);
    setAddItemSearch('');
  };

  const removeEditItem = (idx: number) => {
    setEditItems(prev => prev.filter((_, i) => i !== idx));
  };

  const saveEditItems = () => {
    if (!editingOrder) return;
    setConfirmSaveVisible(true);
  };

  const performSaveEditItems = async () => {
    if (!editingOrder) return;
    setConfirmSaveVisible(false);
    setSavingEdit(true);
    try {
      const payload = editItems.map(it => {
        const qty = Math.max(1, parseInt(it.qty, 10) || 1);
        const unitPriceCents = Math.round((parseFloat(it.price) || 0) * 100);
        const pct = Math.min(100, Math.max(0, parseFloat(it.discount) || 0));
        const discountCents = Math.round((unitPriceCents * qty * pct) / 100);
        if (it.isNew) {
          return { productId: it.productId, qty, unitPriceCents, discountCents };
        }
        return { id: it.id, qty, unitPriceCents, discountCents };
      });
      await updateSalesOrderItemsApi(editingOrder.id, payload, {
        campusId: editCampusId,
        locationId: editingOrder.locationId,
        customerOrgId: editingOrder.customerOrgId,
      });
      setEditingOrder(null);
      load(true);
    } catch (err: any) {
      const status = err?.response?.status;
      const body = err?.response?.data;
      const bodyMsg = body?.error?.message ?? body?.error?.messageKey ?? body?.error?.code ?? body?.message;
      const detail = body?.error?.details ?? body?.error?.issues ?? body?.details ?? body?.issues;
      const detailStr = detail ? `\n${JSON.stringify(detail)}` : (bodyMsg ? '' : (body ? `\n${JSON.stringify(body)}` : ''));
      const message = status
        ? `Server returned ${status} for ${err?.config?.method?.toUpperCase?.() ?? ''} ${err?.config?.url ?? ''}${bodyMsg ? `\n${bodyMsg}` : ''}${detailStr}`
        : (err?.message ?? 'Failed to update order items');
      showAlert({ type: 'error', title: 'Update Failed', message });
    } finally {
      setSavingEdit(false);
    }
  };

  const load = useCallback((silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    Promise.all([
      getSalesOrdersApi(),
      getCampusesApi(),
      getInvoiceHeadersApi(),
      getAllProductsApi().catch(() => [] as ApiProduct[]),
      getUomsApi().catch(() => [] as ApiUom[]),
    ])
      .then(([data, campuses, allHeaders, products, uoms]) => {
        const normalizeOrder = (o: any): ApiSalesOrder => {
          const rawItems: any[] = o.items ?? o.salesOrderItems ?? o.lineItems ?? o.orderItems ?? [];
          return {
            ...o,
            items: rawItems.map((i: any) => ({
              ...i,
              productName: i.productName ?? i.product?.nameEn ?? i.product?.name ?? undefined,
              productCode: i.productCode ?? i.product?.code ?? i.product?.sku ?? undefined,
            })),
          };
        };
        const dedupOrders = <T extends { id: string }>(arr: T[]): T[] => {
          const seen = new Set<string>();
          return arr.filter(o => { const k = String(o.id); if (seen.has(k)) return false; seen.add(k); return true; });
        };
        const relevant = dedupOrders(
          data
            .filter(o => {
              const s = (o.status ?? '').toLowerCase();
              return s === 'received' || s === 'invoiced' || s === 'paid';
            })
            .map(normalizeOrder),
        );
        setOrders(relevant);
        Promise.all(relevant.map(o => getSalesOrderApi(o.id).catch(() => o)))
          .then(full => setOrders(dedupOrders(full)))
          .catch(() => {});
        const cMap: Record<string, ApiCampus> = {};
        campuses.forEach(c => { cMap[String(c.id)] = c; });
        setCampusMap(cMap);
        const pMap: Record<string, ApiProduct> = {};
        products.forEach(p => { pMap[String(p.id)] = p; });
        setProductMap(pMap);
        const uMap: Record<number, ApiUom> = {};
        uoms.forEach(u => { uMap[u.id] = u; });
        setUomMap(uMap);
        const dedupById = <T extends { id: string }>(arr: T[]): T[] => {
          const seen = new Set<string>();
          return arr.filter(h => { const k = String(h.id); if (seen.has(k)) return false; seen.add(k); return true; });
        };
        // Invoiced tab: all issued headers (summaryNumber field shows which are already summarized)
        const issued = dedupById(allHeaders.filter(h => (h.status ?? '').toLowerCase() === 'issued'));
        setInvoicedHeaders(issued);
        Promise.all(issued.map(h => getInvoiceHeaderApi(h.id).catch(() => h)))
          .then(full => setInvoicedHeaders(dedupById(full.map((detail, i) => ({
            ...detail,
            summaryNumber: detail.summaryNumber ?? issued[i]?.summaryNumber ?? null,
            summaryId: detail.summaryId ?? issued[i]?.summaryId ?? null,
          })))))
          .catch(() => {});
        // Paid tab: all paid headers
        const paid = dedupById(allHeaders.filter(h => (h.status ?? '').toLowerCase() === 'paid'));
        setPaidHeaders(paid);
        Promise.all(paid.map(h => getInvoiceHeaderApi(h.id).catch(() => h)))
          .then(full => setPaidHeaders(dedupById(full.map((detail, i) => ({
            ...detail,
            summaryNumber: detail.summaryNumber ?? paid[i]?.summaryNumber ?? null,
            summaryId: detail.summaryId ?? paid[i]?.summaryId ?? null,
          })))))
          .catch(() => {});
      })
      .catch(err => setError(err?.message ?? 'Failed to load invoices'))
      .finally(() => { setLoading(false); setRefreshing(false); });
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => tabEvents.on('Manage', () => load(true)), [load]);


const onRefresh = () => { setRefreshing(true); load(true); };

  const loadInvoicedByFilter = useCallback((from: string, to: string, ref: string, customerOrgId: string | null) => {
    setInvoicedFilterLoading(true);
    getInvoiceHeadersApi({
      from,
      to,
      ...(ref.trim() ? { invoiceNumber: ref.trim() } : {}),
      ...(customerOrgId ? { customerOrgId } : {}),
    })
      .then(items => {
        const seen = new Set<string>();
        const result = items.filter(h => {
          if ((h.status ?? '').toLowerCase() !== 'issued') return false;
          const k = String(h.id); if (seen.has(k)) return false;
          seen.add(k);
          return true;
        });
        setInvoicedHeaders(result);
      })
      .catch(() => {})
      .finally(() => setInvoicedFilterLoading(false));
  }, []);

  // Build a lookup of customerOrgId → org names from sales orders (which include nameKm)
  const customerOrgMap = useMemo(() => {
    const map: Record<string, { nameEn?: string; nameKm?: string }> = {};
    orders.forEach(o => {
      const id = o.customerOrgId ?? o.customerOrg?.id;
      if (id && o.customerOrg) map[String(id)] = o.customerOrg;
    });
    return map;
  }, [orders]);

  const vendorList = useMemo(() =>
    Object.entries(customerOrgMap)
      .map(([id, org]) => ({ id, name: org.nameEn ?? org.nameKm ?? id }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  [customerOrgMap]);

  // Reset page when filter changes
  useEffect(() => { setDisplayPage(1); }, [tab, searchQuery]);

  const loadSummaries = useCallback((silent = false) => {
    if (!silent) setSummariesLoading(true);
    setSummariesError(null);
    getInvoiceSummariesApi()
      .then(list => setSavedSummaries(list))
      .catch(err => setSummariesError(err?.message ?? 'Failed to load summaries'))
      .finally(() => setSummariesLoading(false));
  }, []);


  const DP_ITEM_H = 44;
  const DP_YEARS  = Array.from({ length: 16 }, (_, i) => 2020 + i);
  const DP_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const getDpDaysInMonth = (y: number, m: number) => new Date(y, m, 0).getDate();

  useEffect(() => {
    if (!datePickerVisible) return;
    const yIdx = DP_YEARS.indexOf(dpYear);
    const mIdx = dpMonth - 1;
    const dIdx = dpDay - 1;
    setTimeout(() => {
      dpYearRef.current?.scrollTo({ y: yIdx * DP_ITEM_H, animated: false });
      dpMonthRef.current?.scrollTo({ y: mIdx * DP_ITEM_H, animated: false });
      dpDayRef.current?.scrollTo({ y: dIdx * DP_ITEM_H, animated: false });
    }, 60);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datePickerVisible]);

  // Clear selection when switching tabs
  const handleTabChange = (t: TabKey) => {
    setTab(t);
    setSelectedIds({});
    setSelectedInvoiceIds({});
    setSearchQuery('');
    if (t === 'summaries') loadSummaries();
  };

  const toggleInvoiceSelect = (id: string) => {
    setSelectedInvoiceIds(prev => {
      const next = { ...prev };
      if (next[id]) { delete next[id]; } else { next[id] = true; }
      return next;
    });
  };

  const toggleSelectAllInvoices = () => {
    const selectable = filteredHeaders.filter(h => tab === 'paid' || !h.summaryNumber);
    if (selectable.every(h => selectedInvoiceIds[h.id])) {
      setSelectedInvoiceIds({});
    } else {
      const next: Record<string, boolean> = {};
      selectable.forEach(h => { next[h.id] = true; });
      setSelectedInvoiceIds(next);
    }
  };

  // Received tab — SO-based
  const tabOrders = useMemo(() =>
    orders
      .filter(o => (o.status ?? '').toLowerCase() === 'received')
      .sort((a, b) => Number(b.id) - Number(a.id)),
  [orders]);

  const filteredOrders = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return tabOrders;
    return tabOrders.filter(o => {
      const ref = (o.referenceNumber ?? o.ref ?? o.orderNumber ?? o.id).toLowerCase();
      const campus = (
        o.campusCode ??
        o.campus?.campusCode ??
        (o.campusId != null ? campusMap[String(o.campusId)]?.campusCode : null) ??
        ''
      ).toLowerCase();
      const customer = (o.customerOrgName ?? o.customerOrg?.nameEn ?? '').toLowerCase();
      return ref.includes(q) || campus.includes(q) || customer.includes(q);
    });
  }, [tabOrders, searchQuery, campusMap]);

  // Invoiced / Paid tabs — invoice-header-based
  const tabHeaders = useMemo(() => {
    if (tab === 'invoiced') return [...invoicedHeaders].sort((a, b) => Number(b.id) - Number(a.id));
    if (tab === 'paid')     return [...paidHeaders].sort((a, b) => Number(b.id) - Number(a.id));
    return [];
  }, [invoicedHeaders, paidHeaders, tab]);

  const filteredHeaders = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return tabHeaders;
    return tabHeaders.filter(h => {
      const inv = (h.invoiceNumber ?? '').toLowerCase();
      const campus = (
        h.campusCode ??
        h.campus?.campusCode ??
        campusMap[String(h.campusId)]?.campusCode ??
        ''
      ).toLowerCase();
      const customer = (h.customerOrg?.nameEn ?? h.customerOrg?.name ?? '').toLowerCase();
      return inv.includes(q) || campus.includes(q) || customer.includes(q);
    });
  }, [tabHeaders, searchQuery, campusMap]);

  const tabTotal = useMemo(() => {
    if (tab === 'received') return tabOrders.reduce((s, o) => s + getOrderTotalCents(o), 0);
    return tabHeaders.reduce((s, h) => s + parseCents(h.totalCents), 0);
  }, [tab, tabOrders, tabHeaders]);

  const displayedOrders  = useMemo(() => filteredOrders.slice(0, displayPage * PAGE_SIZE),  [filteredOrders, displayPage]);
  const displayedHeaders = useMemo(() => filteredHeaders.slice(0, displayPage * PAGE_SIZE), [filteredHeaders, displayPage]);

  const handleEndReached = useCallback(() => {
    const total   = tab === 'received' ? filteredOrders.length : filteredHeaders.length;
    const shown   = tab === 'received' ? displayedOrders.length : displayedHeaders.length;
    if (shown < total) setDisplayPage(p => p + 1);
  }, [tab, filteredOrders.length, filteredHeaders.length, displayedOrders.length, displayedHeaders.length]);

  const renderListFooter = useCallback(() => {
    const total = tab === 'received' ? filteredOrders.length : filteredHeaders.length;
    const shown = tab === 'received' ? displayedOrders.length : displayedHeaders.length;
    if (shown >= total) return null;
    return (
      <View style={styles.paginationFooter}>
        <ActivityIndicator size="small" color={Colors.primary} />
        <AppText style={styles.paginationText}>{shown} of {total}</AppText>
      </View>
    );
  }, [tab, filteredOrders.length, filteredHeaders.length, displayedOrders.length, displayedHeaders.length]);

  const selectedTotal = useMemo(() =>
    orders
      .filter(o => selectedIds[o.id] === true)
      .reduce((sum, o) => sum + getOrderTotalCents(o), 0),
  [orders, selectedIds]);

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = { ...prev };
      if (next[id]) { delete next[id]; } else { next[id] = true; }
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (Object.keys(selectedIds).length === filteredOrders.length) {
      setSelectedIds({});
    } else {
      const next: Record<string, boolean> = {};
      filteredOrders.forEach(o => { next[o.id] = true; });
      setSelectedIds(next);
    }
  };

  // Build invoice groups from the given id set, returns null if validation fails
  const buildInvoiceGroups = (ids: Record<string, boolean>) => {
    type Group = { customerOrgId: string; campusId: string | number; locationId?: string | number; soIds: string[]; refs: string[] };
    const groupRecord: Record<string, Group> = {};
    let validationFailed = false;
    orders.forEach(order => {
      if (validationFailed || !ids[order.id]) return;
      const customerOrgId = order.customerOrgId ?? order.customerOrg?.id ?? order.org?.id;
      if (!customerOrgId) {
        const ref = order.referenceNumber ?? order.ref ?? order.id;
        showAlert({ type: 'error', title: 'Missing Customer', message: `Order "${ref}" has no customer organisation linked.` });
        validationFailed = true;
        return;
      }
      if (order.campusId == null) {
        const ref = order.referenceNumber ?? order.ref ?? order.id;
        showAlert({ type: 'error', title: 'Missing Campus', message: `Order "${ref}" has no campus linked.` });
        validationFailed = true;
        return;
      }
      const locationId = order.locationId ?? order.location?.id ?? undefined;
      const key = `${customerOrgId}|${order.campusId}|${locationId ?? ''}`;
      if (!groupRecord[key]) groupRecord[key] = { customerOrgId, campusId: order.campusId, locationId, soIds: [], refs: [] };
      groupRecord[key].soIds.push(order.id);
      groupRecord[key].refs.push(order.referenceNumber ?? order.ref ?? order.id);
    });
    if (validationFailed) return null;
    return Object.values(groupRecord);
  };

  const openInvoiceModal = (idsOverride?: Record<string, boolean>) => {
    const ids = idsOverride ?? selectedIds;
    if (Object.keys(ids).length === 0) {
      showAlert({ type: 'info', title: 'No Orders', message: 'Select received orders to create an invoice.' });
      return;
    }

    // Campus check — block if selected orders span more than one campus
    const selectedOrders = orders.filter(o => ids[o.id]);
    const campusCodes = [...new Set(selectedOrders.map(o =>
      o.campusCode ?? o.campus?.campusCode ?? campusMap[String(o.campusId)]?.campusCode ?? String(o.campusId ?? '')
    ))];
    if (campusCodes.length > 1) {
      showAlert({
        type: 'error',
        title: 'Multiple Campuses',
        message: `Selected orders belong to ${campusCodes.length} different campuses (${campusCodes.join(', ')}).\n\nPlease select orders from one campus at a time.`,
      });
      return;
    }

    // Validate groups (customer org, campus presence)
    const groups = buildInvoiceGroups(ids);
    if (!groups) return;

    setConfirmInvoiceIds(idsOverride ?? selectedIds);
    setConfirmInvoiceVisible(true);
  };

  const doOpenInvoiceModal = (ids: Record<string, boolean>) => {
    setConfirmInvoiceVisible(false);
    setSelectedIds(ids);
    setInvoiceError(null);
    setSigUploaded(false);
    setSigUploadedUrl(null);
    setScrollEnabled(true);
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    setInvoiceIssuedAt(`${yyyy}-${mm}-${dd}`);
    const due = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 30);
    setInvoiceDueAt(`${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, '0')}-${String(due.getDate()).padStart(2, '0')}`);

    // Pre-fill note from selected SO(s) if they carry one
    const selectedOrders = orders.filter(o => ids[o.id]);
    const notes = selectedOrders
      .map(o => o.note?.trim())
      .filter((n): n is string => !!n);
    const uniqueNotes = [...new Set(notes)];
    setInvoiceNote(uniqueNotes.join(' | '));

    sigRef.current?.clear();
    setHasSig(false);
    setInvoiceModalVisible(true);
  };

  const closeInvoiceModal = () => {
    setInvoiceModalVisible(false);
    setInvoiceError(null);
    setSigUploaded(false);
    setSigUploadedUrl(null);
    setHasSig(false);
    setScrollEnabled(true);
    setInvoiceIssuedAt('');
    setInvoiceDueAt('');
    setInvoiceNote('');
    sigRef.current?.clear();
  };

  const doCreateInvoice = async () => {
    if (sigRef.current?.isEmpty() && !sigUploadedUrl) {
      showAlert({ type: 'warning', title: 'Signature Required', message: 'Please draw a signature before creating the invoice.' });
      return;
    }
    const groups = buildInvoiceGroups(selectedIds);
    if (!groups) return;
    if (groups.length === 0) {
      setInvoiceError('No valid orders found. Please go back and re-select.');
      return;
    }

    setGeneratingInvoice(true);
    setInvoiceError(null);
    try {
      // Upload signature once
      let signatureUrl: string | undefined = sigUploadedUrl ?? undefined;
      if (!signatureUrl && !sigRef.current?.isEmpty()) {
        const png = await sigRef.current!.toPNG();
        signatureUrl = await uploadDirectApi({ uri: png, type: 'image/png', fileName: `sig-inv-${Date.now()}.png` });
      }

      // Create invoice headers (one per customer+campus group)
      let failed = 0;
      const created: string[] = [];
      const invoicedSoIds: string[] = [];
      const failedErrors: string[] = [];
      for (let gi = 0; gi < groups.length; gi++) {
        const group = groups[gi];
        try {
          const payload = {
            customerOrgId: group.customerOrgId,
            campusId:      group.campusId,
            locationId:    group.locationId,
            soIds:         group.soIds,
            rateUsed:      Number(rateUsed),
            ...(invoiceIssuedAt ? { issuedAt: invoiceIssuedAt } : {}),
            ...(invoiceDueAt    ? { dueAt:    invoiceDueAt    } : {}),
            ...(invoiceNote.trim() ? { note: invoiceNote.trim() } : {}),
          };
          const inv = await createInvoiceHeaderApi(payload);
          created.push(inv.invoiceNumber ?? inv.id);
          invoicedSoIds.push(...group.soIds);
        } catch (err: any) {
          failed++;
          failedErrors.push(err?.message ?? 'Unknown error');
        }
      }

      // Upload signature to each successfully invoiced SO
      if (signatureUrl && invoicedSoIds.length > 0) {
        await Promise.allSettled(
          invoicedSoIds.map(id => uploadSaleOrderSignatureApi(id, signatureUrl!, 'RECEIVED')),
        );
      }

      closeInvoiceModal();
      setSelectedIds({});
      load(true);

      if (failed === 0) {
        setTimeout(() => showAlert({
          type: 'success',
          title: 'Invoice Created',
          message: `Created: ${created.join(', ')}`,
          autoClose: 3000,
        }), 300);
      } else {
        const errDetail = failedErrors.length > 0 ? `\nError: ${failedErrors[0]}` : '';
        setTimeout(() => showAlert({
          type: 'warning',
          title: 'Partial Success',
          message: `${created.length} invoice${created.length !== 1 ? 's' : ''} created, ${failed} failed.${created.length > 0 ? `\nCreated: ${created.join(', ')}` : ''}${errDetail}`,
        }), 300);
      }
    } catch (err: any) {
      setInvoiceError(err?.message ?? 'Failed to create invoice');
    } finally {
      setGeneratingInvoice(false);
    }
  };

  const handleMarkPaid = (order: ApiSalesOrder) => {
    const ref = order.referenceNumber ?? order.ref ?? order.orderNumber ?? order.id;
    showAlert({
      type: 'confirm',
      title: 'Mark as Paid',
      message: `Mark invoice "${ref}" as paid?`,
      actions: [
        { label: 'Cancel', variant: 'outline' },
        {
          label: 'Mark Paid',
          variant: 'primary',
          onPress: async () => {
            setMarkingPaidId(order.id);
            try {
              await updateSalesOrderStatusApi(order.id, 'PAID');
              setOrders(prev => prev.map(o => o.id === order.id ? { ...o, status: 'paid' } : o));
              showAlert({ type: 'success', title: 'Marked as Paid', message: `Invoice "${ref}" is now paid.`, autoClose: 2000 });
            } catch (err: any) {
              showAlert({ type: 'error', title: 'Error', message: err?.message ?? 'Failed to update status' });
            } finally {
              setMarkingPaidId(null);
            }
          },
        },
      ],
    });
  };

  const handleMarkInvoicePaid = (header: ApiInvoiceHeader) => {
    showAlert({
      type: 'confirm',
      title: 'Mark as Paid',
      message: `Mark invoice "${header.invoiceNumber}" as paid?`,
      actions: [
        { label: 'Cancel', variant: 'outline' },
        {
          label: 'Mark Paid',
          variant: 'primary',
          onPress: async () => {
            setMarkingPaidId(header.id);
            try {
              await updateInvoiceHeaderStatusApi(header.id, 'PAID');
              const updated = { ...header, status: 'PAID' };
              setInvoicedHeaders(prev => prev.filter(h => h.id !== header.id));
              setPaidHeaders(prev => [updated, ...prev.filter(h => h.id !== header.id)]);
              showAlert({ type: 'success', title: 'Marked as Paid', message: `Invoice "${header.invoiceNumber}" is now paid.`, autoClose: 2000 });
            } catch (err: any) {
              showAlert({ type: 'error', title: 'Error', message: err?.message ?? 'Failed to update status' });
            } finally {
              setMarkingPaidId(null);
            }
          },
        },
      ],
    });
  };

const handleExportReceiptPDF = async (header: ApiInvoiceHeader) => {
    setExportingReceiptId(header.id);
    try {
      const full = await getInvoiceHeaderApi(header.id);
      const html = buildPaymentReceiptHTML(full, campusMap, productMap);
      const name = `RECEIPT-${header.invoiceNumber ?? header.id}-${Date.now()}`.replace(/[^a-zA-Z0-9]/g, '-');
      const result = await Print.printToFileAsync({ html, width: 794, height: 1123 });
      setExportingReceiptId(null);
      await Share.share({ url: result.uri, title: `Receipt - ${header.invoiceNumber ?? ''}` });
    } catch (err: any) {
      showAlert({ type: 'error', title: 'Export Error', message: err?.message ?? 'Failed to export receipt' });
    } finally {
      setExportingReceiptId(null);
    }
  };

  const handleExportInvoicePDF = async (header: ApiInvoiceHeader) => {
    setExportingInvoiceId(header.id);
    try {
      const full = await getInvoiceHeaderApi(header.id);
      const isPaid = (full.status ?? '').toLowerCase() === 'paid';
      const html = isPaid
        ? buildPaymentReceiptHTML(full, campusMap, productMap)
        : buildInvoiceHeaderHTML(full, campusMap, productMap, false, undefined, uomMap);
      const campusCode = header.campusCode ?? header.campus?.campusCode ?? campusMap[String(header.campusId)]?.campusCode ?? '';
      const invoiceNum = (header.invoiceNumber ?? String(header.id)).replace(/[^a-zA-Z0-9\-]/g, '-');
      const label = campusCode ? `${campusCode}-${invoiceNum}` : invoiceNum;
      const result = await Print.printToFileAsync({ html, width: 794, height: 1123 });
      setExportingInvoiceId(null);
      const destFile = new File(Paths.cache, `${label}.pdf`);
      new File(result.uri).copy(destFile);
      const destUri = destFile.uri;
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) await Sharing.shareAsync(destUri, { mimeType: 'application/pdf', dialogTitle: label });
    } catch (err: any) {
      if (err?.message !== 'User cancelled') {
        showAlert({ type: 'error', title: 'Export Error', message: err?.message ?? 'Failed to export invoice' });
      }
    } finally {
      setExportingInvoiceId(null);
    }
  };

  const handleShareToTelegram = async (header: ApiInvoiceHeader) => {
    setSharingTelegramId(header.id);
    try {
      const full = await getInvoiceHeaderApi(header.id);
      const isPaid = (full.status ?? '').toLowerCase() === 'paid';
      const html = isPaid
        ? buildPaymentReceiptHTML(full, campusMap, productMap)
        : buildInvoiceHeaderHTML(full, campusMap, productMap, false, undefined, uomMap);
      const campusCode = header.campusCode ?? header.campus?.campusCode ?? campusMap[String(header.campusId)]?.campusCode ?? '';
      const invoiceNum = (header.invoiceNumber ?? String(header.id)).replace(/[^a-zA-Z0-9\-]/g, '-');
      const label = campusCode ? `${campusCode}-${invoiceNum}` : invoiceNum;
      const result = await Print.printToFileAsync({ html, width: 794, height: 1123 });
      const destFile = new File(Paths.cache, `${label}.pdf`);
      new File(result.uri).copy(destFile);
      const destUri = destFile.uri;
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) await Sharing.shareAsync(destUri, { mimeType: 'application/pdf', dialogTitle: label });
    } catch (err: any) {
      if (err?.message !== 'User cancelled') {
        showAlert({ type: 'error', title: 'Share Error', message: err?.message ?? 'Failed to share invoice' });
      }
    } finally {
      setSharingTelegramId(null);
    }
  };

  const handleMergeAndExport = async () => {
    const selected = [...invoicedHeaders, ...paidHeaders].filter(h => selectedInvoiceIds[h.id]);
    if (selected.length === 0) {
      showAlert({ type: 'info', title: 'No Invoices', message: 'Select invoices to merge and export.' });
      return;
    }
    setMergingPDF(true);
    try {
      const full = await Promise.all(selected.map(h => getInvoiceHeaderApi(h.id).catch(() => h)));
      const html = buildMergedInvoicesHTML(full, campusMap, productMap, uomMap);
      const name = `INVOICES-MERGED-${Date.now()}`;
      const result = await Print.printToFileAsync({ html, width: 794, height: 1123 });
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) await Sharing.shareAsync(result.uri, { mimeType: 'application/pdf', dialogTitle: `${selected.length} Invoices` });
    } catch (err: any) {
      if (err?.message !== 'User cancelled') {
        showAlert({ type: 'error', title: 'Export Error', message: err?.message ?? 'Failed to export merged PDF' });
      }
    } finally {
      setMergingPDF(false);
    }
  };

  const handleMergeAndTelegram = async () => {
    const selected = [...invoicedHeaders, ...paidHeaders].filter(h => selectedInvoiceIds[h.id]);
    if (selected.length === 0) {
      showAlert({ type: 'info', title: 'No Invoices', message: 'Select invoices to share to Telegram.' });
      return;
    }
    setMergingPDF(true);
    try {
      const full = await Promise.all(selected.map(h => getInvoiceHeaderApi(h.id).catch(() => h)));
      const html = buildMergedInvoicesHTML(full, campusMap, productMap, uomMap);
      const name = `INVOICES-MERGED-${Date.now()}`;
      const result = await Print.printToFileAsync({ html, width: 794, height: 1123 });
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) await Sharing.shareAsync(result.uri, { mimeType: 'application/pdf', dialogTitle: `${selected.length} Invoice${selected.length !== 1 ? 's' : ''}` });
    } catch (err: any) {
      if (err?.message !== 'User cancelled') {
        showAlert({ type: 'error', title: 'Share Error', message: err?.message ?? 'Failed to share invoices' });
      }
    } finally {
      setMergingPDF(false);
    }
  };

  const handleDebugInvoice = async (header: ApiInvoiceHeader) => {
    try {
      const full = await getInvoiceHeaderApi(header.id);
      const details = full.details ?? [];
      const lines = details.map((d: any, i: number) => {
        const rd      = d as any;
        const nameEn  = rd.productNameEn ?? rd.product_name_en ?? rd.nameEn ?? '—';
        const nameKh  = rd.productNameKh ?? rd.productNameKm ?? '';
        const qty     = Number(d.qty ?? 0);
        const unit    = Number(d.unitPriceCents ?? 0);
        const passes  = qty > 0 && /[A-Za-z0-9ក-ឳ០-៩᧠-᧿]/.test(`${nameKh} ${nameEn}`);
        const khHex   = [...nameKh].map(c => 'U+' + c.codePointAt(0)!.toString(16).toUpperCase().padStart(4,'0')).join(' ');
        const enHex   = [...nameEn].map(c => 'U+' + c.codePointAt(0)!.toString(16).toUpperCase().padStart(4,'0')).join(' ');
        return `[${i+1}] qty=${qty} unit=${unit}\n  EN="${nameEn}" ${enHex}\n  KH="${nameKh}" ${khHex}\n  PASS=${passes}`;
      });
      showAlert({ type: 'info', title: `Debug: ${header.invoiceNumber}`, message: lines.join('\n\n') });
    } catch (err: any) {
      showAlert({ type: 'error', title: 'Debug Error', message: err?.message ?? 'Failed' });
    }
  };

  const handlePrintInvoice = async (header: ApiInvoiceHeader) => {
    setPrintingId(header.id);
    try {
      const full    = await getInvoiceHeaderApi(header.id);
      const isPaid  = (full.status ?? '').toLowerCase() === 'paid';
      const html    = isPaid
        ? buildPaymentReceiptHTML(full, campusMap, productMap)
        : buildInvoiceHeaderHTML(full, campusMap, productMap, true, undefined, uomMap);
      await Print.printAsync({ html });
    } catch (err: any) {
      if (err?.message !== 'User cancelled') {
        showAlert({ type: 'error', title: 'Print Error', message: err?.message ?? 'Failed to print invoice' });
      }
    } finally {
      setPrintingId(null);
    }
  };

  const handlePrintReceipt = async (header: ApiInvoiceHeader) => {
    setPrintingReceiptId(header.id);
    try {
      const full = await getInvoiceHeaderApi(header.id);
      const html = buildPaymentReceiptHTML(full, campusMap, productMap);
      await Print.printAsync({ html });
    } catch (err: any) {
      if (err?.message !== 'User cancelled') {
        showAlert({ type: 'error', title: 'Print Error', message: err?.message ?? 'Failed to print receipt' });
      }
    } finally {
      setPrintingReceiptId(null);
    }
  };

  const handleViewSummary = async (summary: ApiInvoiceSummary) => {
    setLoadingSummaryId(summary.id);
    try {
      const full = await getInvoiceSummaryApi(summary.id);
      const invoiceHeaderMap: Record<string, ApiInvoiceHeader> = {};
      [...invoicedHeaders, ...paidHeaders].forEach(h => { invoiceHeaderMap[h.id] = h; });
      const html = buildSavedSummaryHTML(full, invoiceHeaderMap, campusMap);
      setViewSummaryHtml(html);
      setViewSummaryVisible(true);
    } catch (err: any) {
      showAlert({ type: 'error', title: 'Error', message: err?.message ?? 'Failed to load summary' });
    } finally {
      setLoadingSummaryId(null);
    }
  };

  const handleDeleteSummary = (summary: ApiInvoiceSummary) => {
    const label = summary.description?.trim() || fmtDate(summary.createdAt);
    showAlert({
      type: 'confirm',
      title: 'Delete Summary',
      message: `Delete "${label}"? This cannot be undone.`,
      actions: [
        { label: 'Cancel', variant: 'outline' },
        {
          label: 'Delete',
          variant: 'danger',
          onPress: async () => {
            setDeletingSummaryId(summary.id);
            try {
              await deleteInvoiceSummaryApi(summary.id);
              loadSummaries(true);
              load(true);
            } catch (err: any) {
              showAlert({ type: 'error', title: 'Error', message: err?.message ?? 'Failed to delete summary' });
            } finally {
              setDeletingSummaryId(null);
            }
          },
        },
      ],
    });
  };

  const handlePrintViewSummary = async () => {
    setPrintingViewSummary(true);
    try {
      await Print.printAsync({ html: viewSummaryHtml });
    } catch (err: any) {
      if (err?.message !== 'User cancelled') {
        showAlert({ type: 'error', title: 'Print Error', message: err?.message ?? 'Failed to print' });
      }
    } finally {
      setPrintingViewSummary(false);
    }
  };

  const handlePreviewInvoice = async (header: ApiInvoiceHeader) => {
    setPreviewHtml('');
    setPreviewHeader(header);
    setPreviewLoading(true);
    try {
      const pw   = Dimensions.get('window').width - 16;
      const full = await getInvoiceHeaderApi(header.id);
      const isPaid = (full.status ?? '').toLowerCase() === 'paid';
      const html = isPaid
        ? buildPaymentReceiptHTML(full, campusMap, productMap, pw)
        : buildInvoiceHeaderHTML(full, campusMap, productMap, true, pw, uomMap);
      setPreviewHtml(html);
    } catch (err: any) {
      showAlert({ type: 'error', title: 'Preview Error', message: err?.message ?? 'Failed to load preview' });
    } finally {
      setPreviewLoading(false);
    }
  };

  const openSummary = () => {
    const selected = [...invoicedHeaders, ...paidHeaders].filter(h => selectedInvoiceIds[h.id]);
    if (selected.length === 0) {
      showAlert({ type: 'info', title: 'No Invoices', message: 'Select invoices to generate a summary.' });
      return;
    }
    setSummaryDate(new Date());
    setConfirmSummaryVisible(true);
  };

  const doGenerateSummary = async () => {
    const selected = invoicedHeaders.filter(h => selectedInvoiceIds[h.id] && !h.summaryNumber);
    setSavingSummary(true);
    try {
      const sd = summaryDate;
      const summaryDateStr = `${sd.getFullYear()}-${String(sd.getMonth() + 1).padStart(2, '0')}-${String(sd.getDate()).padStart(2, '0')}`;
      const created = await createInvoiceSummaryApi({
        description: summaryDescription.trim() || undefined,
        invoiceIds: selected.map(h => h.id),
        rateUsed: selected[0]?.rateUsed ?? 4100,
        summaryDate: summaryDateStr,
      });

      setConfirmSummaryVisible(false);
      const html = buildInvoiceSummaryHTML(selected, campusMap, summaryDescription.trim(), created.summaryNumber, created.receivedNote ?? '');
      setSummaryHtml(html);
      setSummaryVisible(true);
      setSummaryDescription('');
      setSelectedInvoiceIds({});
      loadSummaries(true);
      load(true);
    } catch (err: any) {
      showAlert({ type: 'error', title: 'Error', message: err?.message ?? 'Failed to save summary' });
    } finally {
      setSavingSummary(false);
    }
  };

  const handlePrintSummary = async () => {
    setPrintingSummary(true);
    try {
      await Print.printAsync({ html: summaryHtml });
    } catch (err: any) {
      if (err?.message !== 'User cancelled') {
        showAlert({ type: 'error', title: 'Print Error', message: err?.message ?? 'Failed to print' });
      }
    } finally {
      setPrintingSummary(false);
    }
  };

  const handlePreviewSO = async (order: ApiSalesOrder) => {
    setPreviewHtml('');
    setPreviewLoading(true);
    try {
      const full = await getSalesOrderApi(order.id);
      const pw   = Dimensions.get('window').width - 16;
      const html = buildSOPreviewHTML(full, productMap, campusMap, uomMap, pw);
      setPreviewHtml(html);
    } catch (err: any) {
      showAlert({ type: 'error', title: 'Preview Error', message: err?.message ?? 'Failed to load preview' });
    } finally {
      setPreviewLoading(false);
    }
  };

  const renderInvoiceHeaderCard = ({ item }: { item: ApiInvoiceHeader }) => {
    const campus =
      item.campusCode ??
      item.campus?.campusCode ??
      campusMap[String(item.campusId)]?.campusCode ??
      null;
    const orgFromOrders = customerOrgMap[String(item.customerOrgId)] ?? {};
    const customerKm = item.customerOrg?.nameKm ?? orgFromOrders.nameKm ?? null;
    const customer = item.customerOrg?.nameEn ?? item.customerOrg?.name ?? orgFromOrders.nameEn ?? null;
    const s = (item.status ?? '').toLowerCase();
    const isIssued = s === 'issued';
    const isMarking = markingPaidId === item.id;
const isExportingReceipt = exportingReceiptId === item.id;
    const isPrinting = printingId === item.id;
    const isPrintingReceipt = printingReceiptId === item.id;
    const isSelected = selectedInvoiceIds[item.id] === true;
    const isSummarized = !!(item.summaryNumber);

    const isPaidTab = tab === 'paid';

    const isExportingInvoice = exportingInvoiceId === item.id;
    const isSharingTelegram = sharingTelegramId === item.id;

    return (
      <TouchableOpacity
        style={[styles.card, isSelected ? styles.cardSelected : null]}
        onPress={() => { if (!isSummarized || isPaidTab) toggleInvoiceSelect(item.id); }}
        activeOpacity={isSummarized && !isPaidTab ? 1 : 0.75}
      >
        <View style={styles.cardHeader}>
          <View style={[styles.checkbox, (isSelected || (isSummarized && !isPaidTab)) ? styles.checkboxSelected : null]}>
            {(isSelected || (isSummarized && !isPaidTab)) ? <Icon name="check" size={14} color={Colors.white} /> : null}
          </View>
          <View style={styles.refRow}>
            <AppText variant="bodyMedium" style={[styles.refText, { color: '#7C3AED' }]}>{item.invoiceNumber}</AppText>
            {isSummarized && !isPaidTab ? (
              <View style={[styles.campusChip, { backgroundColor: '#D1FAE5' }]}>
                <AppText style={[styles.campusChipText, { color: '#059669', fontSize: 9 }]}>{item.summaryNumber}</AppText>
              </View>
            ) : null}
            {campus ? (
              <View style={[styles.campusChip, { backgroundColor: '#D1FAE5', flexDirection: 'row', alignItems: 'center', gap: 3 }]}>
                <AppText style={[styles.campusChipText, { color: '#059669' }]}>Campus:</AppText>
                <AppText style={[styles.campusChipText, { color: '#059669' }]}>{campus}</AppText>
              </View>
            ) : null}
          </View>
          <View style={[styles.statusBadge, isIssued ? styles.statusInvoiced : styles.statusPaid]}>
            <AppText style={[styles.statusText, isIssued ? styles.statusInvoicedText : styles.statusPaidText]}>
              {isIssued ? 'Invoiced' : 'Paid'}
            </AppText>
          </View>
        </View>

        <View style={styles.cardMeta}>
          {customerKm || customer ? (
            <View style={styles.metaItem}>
              <Icon name="business" size={13} color={Colors.textSecondary} />
              <View>
                {customerKm ? <AppText variant="caption" color="textSecondary">{customerKm}</AppText> : null}
                {customer ? <AppText variant="caption" color="textSecondary">{customer}</AppText> : null}
              </View>
            </View>
          ) : null}
          <View style={styles.metaItem}>
            <Icon name="calendar-today" size={13} color={Colors.textSecondary} />
            <AppText variant="caption" color="textSecondary">{fmtDate(item.issuedAt ?? item.createdAt)}</AppText>
          </View>
          {item.dueAt ? (
            <View style={styles.metaItem}>
              <Icon name="event" size={13} color={Colors.textSecondary} />
              <AppText variant="caption" color="textSecondary">Due {fmtDate(item.dueAt)}</AppText>
            </View>
          ) : null}
          {item.details && item.details.length > 0 ? (() => {
            const soNums = item.details!.map(d => d.soReferenceNumber).filter(Boolean).filter((v, i, a) => a.indexOf(v) === i);
            return soNums.length > 0 ? (
              <View style={styles.metaItem}>
                <Icon name="receipt-long" size={13} color={Colors.textSecondary} />
                <AppText variant="caption" color="textSecondary">{soNums.join(', ')}</AppText>
              </View>
            ) : null;
          })() : null}
          {item.note ? (
            <View style={styles.metaItem}>
              <Icon name="notes" size={13} color={Colors.textSecondary} />
              <AppText variant="caption" color="textSecondary">{item.note}</AppText>
            </View>
          ) : null}
        </View>


        {item.details && item.details.length > 0 ? (
          <AppText variant="caption" color="textSecondary" style={{ paddingHorizontal: 12, paddingBottom: 4 }}>
            {item.details.length} item{item.details.length !== 1 ? 's' : ''}
          </AppText>
        ) : null}
        <View style={styles.cardFooter}>
          <AppText style={styles.totalText}>${(parseCents(item.totalCents) / 100).toFixed(2)}</AppText>
          <TouchableOpacity
            style={[styles.markBtn, { backgroundColor: '#EFF6FF' }]}
            onPress={() => handlePreviewInvoice(item)}
            activeOpacity={0.75}
          >
            <Icon name="visibility" size={16} color="#2563EB" />
            <AppText style={[styles.markBtnText, { color: '#2563EB' }]}>Preview</AppText>
          </TouchableOpacity>
<TouchableOpacity
            style={[styles.markBtn, { backgroundColor: '#FEF3C7' }]}
            onPress={() => handlePrintInvoice(item)}
            onLongPress={() => handleDebugInvoice(item)}
            disabled={isPrinting}
            activeOpacity={0.75}
          >
            {isPrinting
              ? <ActivityIndicator size="small" color="#D97706" />
              : <Icon name="print" size={16} color="#D97706" />}
            <AppText style={[styles.markBtnText, { color: '#D97706' }]}>Print</AppText>
          </TouchableOpacity>
          {isPaidTab ? (
            <TouchableOpacity
              style={[styles.markBtn, { backgroundColor: '#EDE9FE' }]}
              onPress={() => handleExportInvoicePDF(item)}
              disabled={isExportingInvoice}
              activeOpacity={0.75}
            >
              {isExportingInvoice
                ? <ActivityIndicator size="small" color="#7C3AED" />
                : <Icon name="picture-as-pdf" size={16} color="#7C3AED" />}
              <AppText style={[styles.markBtnText, { color: '#7C3AED' }]}>Export</AppText>
            </TouchableOpacity>
          ) : null}
          {isPaidTab ? (
            <TouchableOpacity
              style={[styles.markBtn, { backgroundColor: '#E0F2FE' }]}
              onPress={() => handleShareToTelegram(item)}
              disabled={isSharingTelegram}
              activeOpacity={0.75}
            >
              {isSharingTelegram
                ? <ActivityIndicator size="small" color="#0288D1" />
                : <Icon name="send" size={16} color="#0288D1" />}
              <AppText style={[styles.markBtnText, { color: '#0288D1' }]}>Telegram</AppText>
            </TouchableOpacity>
          ) : null}
          {!isIssued ? (
            <TouchableOpacity
              style={[styles.markBtn, { backgroundColor: '#D1FAE5' }]}
              onPress={() => isPaidTab ? handlePrintReceipt(item) : handleExportReceiptPDF(item)}
              disabled={isPaidTab ? isPrintingReceipt : isExportingReceipt}
              activeOpacity={0.75}
            >
              {(isPaidTab ? isPrintingReceipt : isExportingReceipt)
                ? <ActivityIndicator size="small" color="#059669" />
                : <Icon name="receipt" size={16} color="#059669" />}
              <AppText style={[styles.markBtnText, { color: '#059669' }]}>Receipt</AppText>
            </TouchableOpacity>
          ) : null}
          {isIssued ? (
            isMarking ? (
              <ActivityIndicator size="small" color={Colors.primary} style={styles.markBtn} />
            ) : (
              <TouchableOpacity style={styles.markBtn} onPress={() => handleMarkInvoicePaid(item)} activeOpacity={0.75}>
                <Icon name="check-circle-outline" size={16} color={Colors.primary} />
                <AppText style={styles.markBtnText}>Mark Paid</AppText>
              </TouchableOpacity>
            )
          ) : null}
        </View>
      </TouchableOpacity>
    );
  };

  const renderItem = ({ item }: { item: ApiSalesOrder }) => {
    const ref = item.referenceNumber ?? item.ref ?? item.orderNumber ?? item.id;
    const campus =
      item.campusCode ??
      item.campus?.campusCode ??
      (item.campusId != null ? campusMap[String(item.campusId)]?.campusCode : null) ??
      null;
    const customer = item.customerOrgName ?? item.customerOrg?.nameEn ?? null;
    const date = item.orderDate ?? item.createdAt;
    const s = (item.status ?? '').toLowerCase();
    const isPaid = s === 'paid';
    const isReceived = s === 'received';
    const isMarking = markingPaidId === item.id;
    const isSelected = selectedIds[item.id] === true;

    return (
      <TouchableOpacity
        style={[styles.card, isSelected ? styles.cardSelected : null]}
        onPress={() => isReceived ? toggleSelect(item.id) : undefined}
        activeOpacity={isReceived ? 0.7 : 1}
      >
        <View style={styles.cardHeader}>
          {/* Checkbox for received orders */}
          {isReceived ? (
            <View style={[styles.checkbox, isSelected ? styles.checkboxSelected : null]}>
              {isSelected ? <Icon name="check" size={14} color={Colors.white} /> : null}
            </View>
          ) : (
            <Icon name="receipt" size={16} color={Colors.primary} />
          )}

          <View style={styles.refRow}>
            <AppText variant="bodyMedium" style={styles.refText}>{ref}</AppText>
            {campus ? (
              <View style={styles.campusChip}>
                <AppText style={styles.campusChipText}>{campus}</AppText>
              </View>
            ) : null}
          </View>

          <View style={[
            styles.statusBadge,
            isPaid ? styles.statusPaid : isReceived ? styles.statusReceived : styles.statusInvoiced,
          ]}>
            <AppText style={[
              styles.statusText,
              isPaid ? styles.statusPaidText : isReceived ? styles.statusReceivedText : styles.statusInvoicedText,
            ]}>
              {isPaid ? 'Paid' : isReceived ? 'Received' : 'Invoiced'}
            </AppText>
          </View>
        </View>

        <View style={styles.cardMeta}>
          {customer ? (
            <View style={styles.metaItem}>
              <Icon name="business" size={13} color={Colors.textSecondary} />
              <AppText variant="caption" color="textSecondary">{customer}</AppText>
            </View>
          ) : null}
          <View style={styles.metaItem}>
            <Icon name="calendar-today" size={13} color={Colors.textSecondary} />
            <AppText variant="caption" color="textSecondary">{fmtDate(date)}</AppText>
          </View>
        </View>


        <View style={styles.cardFooter}>
          <AppText variant="caption" color="textSecondary" style={styles.itemsLabel}>
            {item.items?.length ?? 0} item{(item.items?.length ?? 0) !== 1 ? 's' : ''}
          </AppText>
          <AppText style={styles.totalText}>{fmtCents(getOrderTotalCents(item))}</AppText>
          {isReceived ? (
            <TouchableOpacity
              style={[styles.markBtn, { backgroundColor: '#EFF6FF' }]}
              onPress={() => handlePreviewSO(item)}
              activeOpacity={0.75}
            >
              <Icon name="visibility" size={16} color="#2563EB" />
              <AppText style={[styles.markBtnText, { color: '#2563EB' }]}>Preview</AppText>
            </TouchableOpacity>
          ) : null}
          {isReceived ? (
            <TouchableOpacity
              style={[styles.markBtn, { backgroundColor: '#FFF7ED' }]}
              onPress={() => openEditModal(item)}
              activeOpacity={0.75}
            >
              <Icon name="edit" size={16} color="#F59E0B" />
              <AppText style={[styles.markBtnText, { color: '#F59E0B' }]}>Edit</AppText>
            </TouchableOpacity>
          ) : null}
          {s === 'invoiced' ? (
            isMarking ? (
              <ActivityIndicator size="small" color={Colors.primary} style={styles.markBtn} />
            ) : (
              <TouchableOpacity style={styles.markBtn} onPress={() => handleMarkPaid(item)} activeOpacity={0.75}>
                <Icon name="check-circle-outline" size={16} color={Colors.primary} />
                <AppText style={styles.markBtnText}>Mark Paid</AppText>
              </TouchableOpacity>
            )
          ) : null}
        </View>
      </TouchableOpacity>
    );
  };

  const receivedCount  = orders.filter(o => (o.status ?? '').toLowerCase() === 'received').length;
  const invoicedCount  = invoicedHeaders.length;
  const paidCount      = paidHeaders.length;
  const summariesCount = savedSummaries.length;

  const activeListLen  = tab === 'received' ? filteredOrders.length : filteredHeaders.length;
  const activeTabLen   = tab === 'received' ? tabOrders.length : tabHeaders.length;
  const subtitle = searchQuery
    ? `${activeListLen} of ${activeTabLen} results`
    : `${receivedCount} received · ${invoicedCount} invoiced · ${paidCount} paid`;

  const selCount = Object.keys(selectedIds).length;
  const allSelected = filteredOrders.length > 0 && selCount === filteredOrders.length;

  return (
    <View style={styles.safe}>
      <AppBar
        title="Sale Invoices"
        subtitle={subtitle}
        titleAlign="left"
        showBack
        onBack={onBack}
      />

      {/* Tabs */}
      <View style={styles.tabBar}>
        {TABS.map(t => (
          <TouchableOpacity
            key={t.key}
            style={[styles.tab, tab === t.key ? styles.tabActive : null]}
            onPress={() => handleTabChange(t.key)}
            activeOpacity={0.7}
          >
            <AppText style={[styles.tabText, tab === t.key ? styles.tabTextActive : null]}>
              {t.label}
            </AppText>
            {t.key === 'received' && receivedCount > 0 ? (
              <View style={styles.tabBadge}>
                <AppText style={styles.tabBadgeText}>{receivedCount}</AppText>
              </View>
            ) : t.key === 'invoiced' && invoicedCount > 0 ? (
              <View style={[styles.tabBadge, { backgroundColor: '#7C3AED' }]}>
                <AppText style={styles.tabBadgeText}>{invoicedCount}</AppText>
              </View>
            ) : t.key === 'paid' && paidCount > 0 ? (
              <View style={[styles.tabBadge, { backgroundColor: '#10B981' }]}>
                <AppText style={styles.tabBadgeText}>{paidCount}</AppText>
              </View>
            ) : t.key === 'summaries' && summariesCount > 0 ? (
              <View style={[styles.tabBadge, { backgroundColor: '#2563EB' }]}>
                <AppText style={styles.tabBadgeText}>{summariesCount}</AppText>
              </View>
            ) : null}
          </TouchableOpacity>
        ))}
      </View>

      {/* Filter block — Invoiced tab only */}
      {tab === 'invoiced' ? (
        <View style={{ backgroundColor: Colors.surface, paddingHorizontal: 12, paddingVertical: 10, gap: 8, borderBottomWidth: 1, borderBottomColor: Colors.divider }}>
          {/* Row 1: Reference search */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1.5, borderColor: Colors.border, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, backgroundColor: Colors.background }}>
            <Icon name="search" size={16} color={Colors.textSecondary} />
            <TextInput
              style={{ flex: 1, fontSize: 13, color: Colors.text, padding: 0 }}
              value={invoicedRefSearch}
              onChangeText={setInvoicedRefSearch}
              placeholder="Search by reference…"
              placeholderTextColor={Colors.textLight}
              returnKeyType="search"
              autoCorrect={false}
              onSubmitEditing={() => loadInvoicedByFilter(invoicedFrom, invoicedTo, invoicedRefSearch, invoicedCustomerOrgId)}
            />
            {invoicedRefSearch ? (
              <TouchableOpacity onPress={() => setInvoicedRefSearch('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Icon name="close" size={15} color={Colors.textSecondary} />
              </TouchableOpacity>
            ) : null}
          </View>
          {/* Row 2: Customer selector */}
          <TouchableOpacity
            style={{ flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1.5, borderColor: Colors.border, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, backgroundColor: Colors.background }}
            activeOpacity={0.7}
            onPress={() => { setInvoicedOrgSearch(''); setInvoicedOrgPickerVisible(true); }}
          >
            <Icon name="business" size={16} color={Colors.textSecondary} />
            <AppText style={{ flex: 1, fontSize: 13, color: invoicedCustomerOrgId ? Colors.text : Colors.textLight }}>
              {invoicedCustomerOrgId
                ? (customerOrgMap[invoicedCustomerOrgId]?.nameEn ?? customerOrgMap[invoicedCustomerOrgId]?.nameKm ?? invoicedCustomerOrgId)
                : 'Select customer…'}
            </AppText>
            {invoicedCustomerOrgId ? (
              <TouchableOpacity onPress={() => setInvoicedCustomerOrgId(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Icon name="close" size={15} color={Colors.textSecondary} />
              </TouchableOpacity>
            ) : (
              <Icon name="arrow-drop-down" size={20} color={Colors.textSecondary} />
            )}
          </TouchableOpacity>
          {/* Row 3: Date range */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <TouchableOpacity
              style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1.5, borderColor: Colors.border, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, backgroundColor: Colors.background }}
              onPress={() => setInvoicedFromPickerVisible(true)} activeOpacity={0.7}
            >
              <Icon name="date-range" size={13} color={Colors.primary} />
              <AppText style={{ fontSize: 12, fontWeight: '600', color: Colors.text }}>{invoicedFrom}</AppText>
            </TouchableOpacity>
            <AppText style={{ fontSize: 13, color: Colors.textSecondary }}>→</AppText>
            <TouchableOpacity
              style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1.5, borderColor: Colors.border, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, backgroundColor: Colors.background }}
              onPress={() => setInvoicedToPickerVisible(true)} activeOpacity={0.7}
            >
              <Icon name="date-range" size={13} color={Colors.primary} />
              <AppText style={{ fontSize: 12, fontWeight: '600', color: Colors.text }}>{invoicedTo}</AppText>
            </TouchableOpacity>
          </View>
          {/* Row 4: Search button full width */}
          <TouchableOpacity
            style={{ backgroundColor: Colors.primary, borderRadius: 8, paddingVertical: 11, alignItems: 'center' }}
            onPress={() => loadInvoicedByFilter(invoicedFrom, invoicedTo, invoicedRefSearch, invoicedCustomerOrgId)}
            activeOpacity={0.8}
          >
            {invoicedFilterLoading
              ? <ActivityIndicator size="small" color="#fff" />
              : <AppText style={{ color: '#fff', fontWeight: '700', fontSize: 14 }}>Search</AppText>}
          </TouchableOpacity>
        </View>
      ) : null}

      {/* Search — hidden on summaries and invoiced tabs */}
      <View style={[styles.searchRow, (tab === 'summaries' || tab === 'invoiced') ? { display: 'none' } : null]}>
        <Icon name="search" size={20} color={Colors.textSecondary} style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search by reference, campus..."
          placeholderTextColor={Colors.textLight}
          value={searchQuery}
          onChangeText={setSearchQuery}
          returnKeyType="search"
          clearButtonMode="while-editing"
          autoCorrect={false}
        />
        {searchQuery ? (
          <TouchableOpacity onPress={() => setSearchQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Icon name="close" size={18} color={Colors.textSecondary} />
          </TouchableOpacity>
        ) : null}
      </View>

      {/* Select all bar — Received tab only */}
      {tab === 'received' && !loading && !error && filteredOrders.length > 0 ? (
        <TouchableOpacity style={styles.selectAllBar} onPress={toggleSelectAll} activeOpacity={0.7}>
          <View style={[styles.checkbox, allSelected ? styles.checkboxSelected : null]}>
            {allSelected ? <Icon name="check" size={14} color={Colors.white} /> : null}
          </View>
          <AppText variant="caption" style={styles.selectAllText}>
            {allSelected ? 'Deselect all' : `Select all (${filteredOrders.length})`}
          </AppText>
          {selCount > 0 ? (
            <AppText style={styles.selectAllTotal}>{fmtCents(selectedTotal)}</AppText>
          ) : (
            <AppText variant="caption" color="textSecondary">{fmtCents(tabTotal)} total</AppText>
          )}
        </TouchableOpacity>
      ) : null}

      {/* Select-all bar — invoiced and paid tabs */}
      {(tab === 'invoiced' || tab === 'paid') && !loading && !error && filteredHeaders.length > 0 ? (() => {
        const invSelCount = Object.keys(selectedInvoiceIds).length;
        const allInvSelected = filteredHeaders.length > 0 && invSelCount === filteredHeaders.length;
        return (
          <TouchableOpacity style={styles.selectAllBar} onPress={toggleSelectAllInvoices} activeOpacity={0.7}>
            <View style={[styles.checkbox, allInvSelected ? styles.checkboxSelected : null]}>
              {allInvSelected ? <Icon name="check" size={14} color={Colors.white} /> : null}
            </View>
            <AppText variant="caption" style={styles.selectAllText}>
              {allInvSelected ? 'Deselect all' : `Select all (${filteredHeaders.length})`}
            </AppText>
            <AppText style={styles.summaryTotal}>${(tabTotal / 100).toFixed(2)}</AppText>
          </TouchableOpacity>
        );
      })() : null}

      {tab === 'summaries' ? (
        summariesLoading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={Colors.primary} />
          </View>
        ) : summariesError ? (
          <View style={styles.center}>
            <Icon name="error-outline" size={48} color={Colors.textLight} />
            <AppText variant="body" color="textSecondary" style={styles.centerMsg}>{summariesError}</AppText>
            <TouchableOpacity style={styles.retryBtn} onPress={() => loadSummaries()}>
              <AppText variant="bodyMedium" color="primary">Retry</AppText>
            </TouchableOpacity>
          </View>
        ) : (
          <FlatList
            data={savedSummaries}
            keyExtractor={item => item.id}
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}
            refreshControl={<RefreshControl refreshing={false} onRefresh={() => loadSummaries(true)} tintColor={Colors.primary} />}
            renderItem={({ item, index }) => {
              const isDeleting = deletingSummaryId === item.id;
              const isLoading  = loadingSummaryId === item.id;
              const hasDesc    = !!item.description?.trim();
              return (
                <TouchableOpacity
                  style={styles.summaryRow}
                  onPress={() => handleViewSummary(item)}
                  activeOpacity={0.75}
                  disabled={isDeleting || isLoading}
                >
                  <View style={styles.summaryIndexBadge}>
                    <AppText style={styles.summaryIndexText}>{savedSummaries.length - index}</AppText>
                  </View>
                  <View style={styles.rowBodyMain}>
                    <AppText variant="bodyMedium" style={styles.summaryDesc} numberOfLines={1}>
                      {hasDesc ? item.description : 'No description'}
                    </AppText>
                    <View style={styles.summaryMeta}>
                      <Icon name="event" size={11} color={Colors.textLight} />
                      <AppText variant="caption" color="textSecondary"> {fmtDate(item.createdAt)}</AppText>
                      <View style={styles.summaryDot} />
                      <Icon name="receipt" size={11} color={Colors.textLight} />
                      <AppText variant="caption" color="textSecondary"> {item.summaryNumber}</AppText>
                    </View>
                  </View>
                  <View style={styles.summaryRight}>
                    <AppText variant="bodyMedium" style={styles.summaryTotal}>
                      {fmtCents(parseCents(item.totalCents))}
                    </AppText>
                    {isLoading ? (
                      <ActivityIndicator size="small" color={Colors.primary} />
                    ) : isDeleting ? (
                      <ActivityIndicator size="small" color={Colors.error} />
                    ) : (
                      <TouchableOpacity
                        onPress={() => handleDeleteSummary(item)}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <Icon name="delete-outline" size={20} color={Colors.error} />
                      </TouchableOpacity>
                    )}
                  </View>
                </TouchableOpacity>
              );
            }}
            ListEmptyComponent={
              <View style={styles.center}>
                <Icon name="summarize" size={56} color={Colors.textLight} />
                <AppText variant="body" color="textSecondary" style={styles.centerMsg}>
                  No saved summaries yet.{'\n'}Generate one from the Invoiced or Paid tab.
                </AppText>
              </View>
            }
          />
        )
      ) : loading ? (
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
      ) : tab === 'received' ? (
        <FlatList
          data={displayedOrders}
          keyExtractor={item => item.id}
          renderItem={renderItem}
          contentContainerStyle={[styles.list, selCount > 0 ? styles.listWithBar : null]}
          showsVerticalScrollIndicator={false}
          onEndReached={handleEndReached}
          onEndReachedThreshold={0.3}
          ListFooterComponent={renderListFooter}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
          ListEmptyComponent={
            <View style={styles.center}>
              <Icon name={searchQuery ? 'search-off' : 'receipt-long'} size={48} color={Colors.textLight} />
              <AppText variant="body" color="textSecondary" style={styles.centerMsg}>
                {searchQuery ? `No results for "${searchQuery}"` : 'No received orders'}
              </AppText>
            </View>
          }
        />
      ) : (
        <FlatList
          data={displayedHeaders}
          keyExtractor={item => item.id}
          renderItem={renderInvoiceHeaderCard}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          onEndReached={handleEndReached}
          onEndReachedThreshold={0.3}
          ListFooterComponent={renderListFooter}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
          ListEmptyComponent={
            <View style={styles.center}>
              <Icon name={searchQuery ? 'search-off' : 'description'} size={48} color={Colors.textLight} />
              <AppText variant="body" color="textSecondary" style={styles.centerMsg}>
                {searchQuery
                  ? `No results for "${searchQuery}"`
                  : tab === 'invoiced' ? 'No invoices yet'
                  : 'No paid invoices yet'}
              </AppText>
            </View>
          }
        />
      )}

      {/* Generate Invoice action bar */}
      {tab === 'received' && selCount > 0 ? (
        <View style={styles.actionBar}>
          <View style={styles.actionBarInfo}>
            <AppText style={styles.actionBarCount}>{selCount} order{selCount > 1 ? 's' : ''} selected</AppText>
            <AppText style={styles.actionBarTotal}>{fmtCents(selectedTotal)}</AppText>
          </View>
          <View style={styles.rateBox}>
            <AppText style={styles.rateLabel}>Rate</AppText>
            <TextInput
              style={styles.rateInput}
              value={rateUsed}
              onChangeText={setRateUsed}
              keyboardType="numeric"
              selectTextOnFocus
              placeholder="4100"
              placeholderTextColor={Colors.textLight}
            />
          </View>
          <TouchableOpacity
            style={[styles.generateBtn, generatingInvoice ? styles.generateBtnDisabled : null]}
            onPress={() => openInvoiceModal()}
            disabled={generatingInvoice}
            activeOpacity={0.85}
          >
            {generatingInvoice ? (
              <ActivityIndicator size="small" color={Colors.white} />
            ) : (
              <>
                <Icon name="request-quote" size={18} color={Colors.white} />
                <AppText style={styles.generateBtnText}>Create Invoice</AppText>
              </>
            )}
          </TouchableOpacity>
        </View>
      ) : null}

      {/* Invoice summary/export action bar — invoiced tab */}
      {(() => {
        if (tab !== 'invoiced') return null;
        const invSelCount = Object.keys(selectedInvoiceIds).length;
        if (invSelCount === 0) return null;
        const invSelTotal = invoicedHeaders
          .filter(h => selectedInvoiceIds[h.id])
          .reduce((s, h) => s + parseCents(h.totalCents), 0);
        return (
          <View style={styles.actionBar}>
            <View style={styles.actionBarInfo}>
              <AppText style={styles.actionBarCount}>{invSelCount} invoice{invSelCount > 1 ? 's' : ''} selected</AppText>
              <AppText style={styles.actionBarTotal}>${(invSelTotal / 100).toFixed(2)}</AppText>
            </View>
            <TouchableOpacity
              style={[styles.generateBtn, { backgroundColor: '#7C3AED' }, mergingPDF ? styles.generateBtnDisabled : null]}
              onPress={handleMergeAndExport}
              disabled={mergingPDF}
              activeOpacity={0.85}
            >
              {mergingPDF
                ? <ActivityIndicator size="small" color={Colors.white} />
                : <><Icon name="picture-as-pdf" size={16} color={Colors.white} /><AppText style={styles.generateBtnText}>Merge PDF</AppText></>}
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.generateBtn, { backgroundColor: '#0288D1' }, mergingPDF ? styles.generateBtnDisabled : null]}
              onPress={handleMergeAndTelegram}
              disabled={mergingPDF}
              activeOpacity={0.85}
            >
              {mergingPDF
                ? <ActivityIndicator size="small" color={Colors.white} />
                : <><Icon name="send" size={16} color={Colors.white} /><AppText style={styles.generateBtnText}>Telegram</AppText></>}
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.generateBtn}
              onPress={openSummary}
              activeOpacity={0.85}
            >
              <Icon name="summarize" size={18} color={Colors.white} />
              <AppText style={styles.generateBtnText}>Summary</AppText>
            </TouchableOpacity>
          </View>
        );
      })()}

      {/* Export/Telegram action bar — paid tab */}
      {tab === 'paid' && Object.keys(selectedInvoiceIds).length > 0 ? (() => {
        const invSelCount = Object.keys(selectedInvoiceIds).length;
        const invSelTotal = paidHeaders
          .filter(h => selectedInvoiceIds[h.id])
          .reduce((s, h) => s + parseCents(h.totalCents), 0);
        return (
          <View style={styles.actionBar}>
            <View style={styles.actionBarInfo}>
              <AppText style={styles.actionBarCount}>{invSelCount} receipt{invSelCount > 1 ? 's' : ''} selected</AppText>
              <AppText style={styles.actionBarTotal}>${(invSelTotal / 100).toFixed(2)}</AppText>
            </View>
            <TouchableOpacity
              style={[styles.generateBtn, { backgroundColor: '#7C3AED' }, mergingPDF ? styles.generateBtnDisabled : null]}
              onPress={handleMergeAndExport}
              disabled={mergingPDF}
              activeOpacity={0.85}
            >
              {mergingPDF
                ? <ActivityIndicator size="small" color={Colors.white} />
                : <><Icon name="picture-as-pdf" size={16} color={Colors.white} /><AppText style={styles.generateBtnText}>Merge PDF</AppText></>}
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.generateBtn, { backgroundColor: '#0288D1' }, mergingPDF ? styles.generateBtnDisabled : null]}
              onPress={handleMergeAndTelegram}
              disabled={mergingPDF}
              activeOpacity={0.85}
            >
              {mergingPDF
                ? <ActivityIndicator size="small" color={Colors.white} />
                : <><Icon name="send" size={16} color={Colors.white} /><AppText style={styles.generateBtnText}>Telegram</AppText></>}
            </TouchableOpacity>
          </View>
        );
      })() : null}

      {/* ── Preview Modal ─────────────────────────────────────────────────────── */}
      <Modal
        visible={previewLoading || previewHtml !== ''}
        transparent={false}
        animationType="slide"
        onRequestClose={() => { setPreviewHtml(''); setPreviewLoading(false); setPreviewHeader(null); }}
      >
        <View style={{ flex: 1, backgroundColor: '#1E293B' }}>
          <View style={{
            flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
            paddingHorizontal: 16, paddingVertical: 14, paddingTop: 50,
            backgroundColor: '#1E293B',
          }}>
            <AppText style={{ fontSize: 16, fontWeight: '700', color: '#FFFFFF' }}>Preview</AppText>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
              <TouchableOpacity
                onPress={() => previewHeader && handleExportInvoicePDF(previewHeader)}
                disabled={!previewHeader || exportingInvoiceId === previewHeader?.id}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                {exportingInvoiceId === previewHeader?.id ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Icon name="picture-as-pdf" size={24} color="#FFFFFF" />
                )}
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => previewHeader && handleShareToTelegram(previewHeader)}
                disabled={!previewHeader || sharingTelegramId === previewHeader?.id}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                {sharingTelegramId === previewHeader?.id ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Icon name="send" size={24} color="#0288D1" />
                )}
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => previewHeader && handlePrintInvoice(previewHeader)}
                disabled={!previewHeader || printingId === previewHeader?.id}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                {printingId === previewHeader?.id ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Icon name="print" size={24} color="#FFFFFF" />
                )}
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => { setPreviewHtml(''); setPreviewLoading(false); setPreviewHeader(null); }}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Icon name="close" size={24} color="#FFFFFF" />
              </TouchableOpacity>
            </View>
          </View>
          {previewLoading ? (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 }}>
              <ActivityIndicator size="large" color="#FFFFFF" />
              <AppText style={{ fontSize: 14, color: '#94A3B8' }}>Loading preview…</AppText>
            </View>
          ) : (
            <View style={{ flex: 1, padding: 8 }}>
              <WebView
                source={{ html: previewHtml, baseUrl: '' }}
                originWhitelist={['*']}
                style={{ flex: 1 }}
                scrollEnabled={true}
              />
            </View>
          )}
        </View>
      </Modal>

      {/* ── Create Invoice modal with signature ────────────────────────────── */}
      <Modal
        visible={invoiceModalVisible}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={closeInvoiceModal}
      >
        <SafeAreaView style={invStyles.safe} edges={['bottom']}>
          <AppBar
            title="Create Invoice"
            subtitle={`${selCount} order${selCount !== 1 ? 's' : ''} · ${fmtCents(selectedTotal)}`}
            titleAlign="left"
            showBack
            onBack={closeInvoiceModal}
          />

          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <ScrollView
              ref={scrollRef}
              style={{ flex: 1, padding: 16 }}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: 24 }}
            >
              {(() => {
                const selOrders = orders.filter(o => selectedIds[o.id]);
                const skuMap: Record<string, { sku: string; name: string; qty: number; unit: number; cents: number }> = {};
                selOrders.forEach(o => {
                  (o.items ?? []).forEach((it: any) => {
                    const prod  = it.productId ? productMap[it.productId] : undefined;
                    const key   = it.productId ?? it.productSku ?? it.productCode ?? '—';
                    const sku   = it.productSku ?? it.productCode ?? prod?.sku ?? it.productId ?? '—';
                    const name  = it.productNameEn ?? it.productName ?? prod?.nameEn ?? sku;
                    const unit  = parseCents(it.unitPriceCents);
                    const dis   = parseCents(it.discountCents);
                    const qty   = Number(it.qty ?? 0);
                    const total = qty * unit - dis;
                    if (!skuMap[key]) skuMap[key] = { sku, name, qty: 0, unit, cents: 0 };
                    skuMap[key].qty   += qty;
                    skuMap[key].cents += total;
                  });
                });
                const rows       = Object.values(skuMap).sort((a, b) => b.cents - a.cents);
                const totalQty   = rows.reduce((s, r) => s + r.qty, 0);
                const totalCents = rows.reduce((s, r) => s + r.cents, 0);
                return (
                  <>
                    {/* Info card */}
                    <View style={{ borderRadius: 16, overflow: 'hidden', marginBottom: 20, elevation: 3, shadowColor: '#7C3AED', shadowOpacity: 0.18, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } }}>
                      {/* Purple header band */}
                      <View style={{ backgroundColor: '#7C3AED', paddingHorizontal: 20, paddingTop: 18, paddingBottom: 20 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 14 }}>
                          <AnimatedInvoiceIcon />
                          <View style={{ flex: 1 }}>
                            <AppText style={{ fontSize: 12, fontWeight: '700', color: 'rgba(255,255,255,0.85)', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 }}>Invoice Summary</AppText>
                            <AppText style={{ fontSize: 28, fontWeight: '800', color: '#fff', letterSpacing: -0.5 }}>{fmtCents(selectedTotal)}</AppText>
                            <AppText style={{ fontSize: 12, color: 'rgba(255,255,255,0.65)', marginTop: 2 }}>Total Invoice Value</AppText>
                          </View>
                        </View>
                        {/* Stat chips */}
                        <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
                          <View style={{ backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5, flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                            <Icon name="receipt-long" size={13} color="#fff" />
                            <AppText style={{ fontSize: 12, fontWeight: '600', color: '#fff' }}>{selCount} order{selCount !== 1 ? 's' : ''}</AppText>
                          </View>
                          <View style={{ backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5, flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                            <Icon name="inventory-2" size={13} color="#fff" />
                            <AppText style={{ fontSize: 12, fontWeight: '600', color: '#fff' }}>{totalQty} item{totalQty !== 1 ? 's' : ''}</AppText>
                          </View>
                        </View>
                      </View>
                      {/* White detail rows */}
                      {(() => {
                        const campusCode = selOrders[0]
                          ? (selOrders[0].campusCode ?? selOrders[0].campus?.campusCode ?? campusMap[String(selOrders[0].campusId)]?.campusCode ?? '—')
                          : '—';
                        const soRefs = selOrders.map(o => o.referenceNumber ?? o.ref ?? String(o.id));
                        return (
                          <View style={{ backgroundColor: '#fff' }}>
                            {/* Campus row */}
                            <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 12, borderTopWidth: 1, borderTopColor: '#F3F4F6', gap: 10 }}>
                              <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: '#EDE9FE', alignItems: 'center', justifyContent: 'center' }}>
                                <Icon name="school" size={15} color="#7C3AED" />
                              </View>
                              <AppText style={{ fontSize: 13, color: Colors.textSecondary, width: 90 }}>Campus</AppText>
                              <AppText style={{ fontSize: 13, fontWeight: '700', color: Colors.text, flex: 1 }}>{campusCode}</AppText>
                            </View>
                            {/* SO row */}
                            <View style={{ paddingHorizontal: 20, paddingVertical: 12, borderTopWidth: 1, borderTopColor: '#F3F4F6' }}>
                              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
                                <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: '#EDE9FE', alignItems: 'center', justifyContent: 'center', marginTop: 1 }}>
                                  <Icon name="receipt-long" size={15} color="#7C3AED" />
                                </View>
                                <AppText style={{ fontSize: 13, color: Colors.textSecondary, width: 90, paddingTop: 6 }}>Sales Orders</AppText>
                                <View style={{ flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                                  {soRefs.map(ref => (
                                    <View key={ref} style={{ backgroundColor: '#F5F3FF', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderColor: '#DDD6FE' }}>
                                      <AppText style={{ fontSize: 11, fontWeight: '600', color: '#6D28D9' }}>{ref}</AppText>
                                    </View>
                                  ))}
                                </View>
                              </View>
                            </View>
                            {/* Rate row */}
                            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 12, borderTopWidth: 1, borderTopColor: '#F3F4F6' }}>
                              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                                <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: '#EDE9FE', alignItems: 'center', justifyContent: 'center' }}>
                                  <Icon name="currency-exchange" size={15} color="#7C3AED" />
                                </View>
                                <AppText style={{ fontSize: 13, color: Colors.textSecondary, width: 90 }}>Rate</AppText>
                                <AppText style={{ fontSize: 12, color: Colors.textSecondary }}>1 USD =</AppText>
                              </View>
                              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                                <TextInput
                                  style={invStyles.rateInput}
                                  value={rateUsed}
                                  onChangeText={setRateUsed}
                                  keyboardType="numeric"
                                  selectTextOnFocus
                                  placeholder="4100"
                                  placeholderTextColor={Colors.textLight}
                                />
                                <AppText style={{ fontSize: 12, color: Colors.textSecondary }}>KHR</AppText>
                              </View>
                            </View>
                          </View>
                        );
                      })()}
                    </View>

                    {/* Items by SKU table */}
                    {rows.length > 0 && (
                      <View style={{ marginBottom: 20 }}>
                        <AppText style={invStyles.sectionLabel}>Items by SKU</AppText>
                        <View style={{ borderRadius: 10, borderWidth: 1, borderColor: Colors.divider, overflow: 'hidden' }}>
                          {/* Header */}
                          <View style={{ flexDirection: 'row', backgroundColor: Colors.background, paddingVertical: 8, paddingHorizontal: 10 }}>
                            <AppText style={[invItemCol.name, invItemCol.hdr]}>Product</AppText>
                            <AppText style={[invItemCol.qty,  invItemCol.hdr]}>Qty</AppText>
                            <AppText style={[invItemCol.price,invItemCol.hdr]}>Price</AppText>
                            <AppText style={[invItemCol.amt,  invItemCol.hdr]}>Amount</AppText>
                          </View>
                          {/* Rows */}
                          {rows.map((r, i) => (
                            <View key={r.sku} style={{ flexDirection: 'row', paddingVertical: 9, paddingHorizontal: 10, borderTopWidth: 1, borderTopColor: Colors.divider, backgroundColor: i % 2 === 1 ? '#F8FAFC' : Colors.surface }}>
                              <View style={invItemCol.name}>
                                <AppText style={{ fontSize: 12, fontWeight: '600', color: Colors.text }} numberOfLines={1}>{r.name}</AppText>
                                <AppText style={{ fontSize: 10, color: Colors.textSecondary }}>{r.sku}</AppText>
                              </View>
                              <AppText style={[invItemCol.qty,  invItemCol.cell]}>{r.qty}</AppText>
                              <AppText style={[invItemCol.price,invItemCol.cell]}>{fmtCents(r.unit)}</AppText>
                              <AppText style={[invItemCol.amt,  invItemCol.cell]}>{fmtCents(r.cents)}</AppText>
                            </View>
                          ))}
                          {/* Total row */}
                          <View style={{ flexDirection: 'row', paddingVertical: 9, paddingHorizontal: 10, borderTopWidth: 1.5, borderTopColor: Colors.divider, backgroundColor: '#EFF6FF' }}>
                            <AppText style={[invItemCol.name, { fontSize: 13, fontWeight: '700', color: Colors.text }]}>Total</AppText>
                            <AppText style={[invItemCol.qty,  invItemCol.cell, { fontWeight: '700', color: '#2563EB' }]}>{totalQty}</AppText>
                            <AppText style={[invItemCol.price,invItemCol.cell]} />
                            <AppText style={[invItemCol.amt,  invItemCol.cell, { fontWeight: '700' }]}>{fmtCents(totalCents)}</AppText>
                          </View>
                        </View>
                      </View>
                    )}
                  </>
                );
              })()}

              {/* Invoice Details */}
              <AppText style={invStyles.sectionLabel}>Invoice Details</AppText>
              <View style={{ borderRadius: 10, borderWidth: 1, borderColor: Colors.divider, overflow: 'hidden', marginBottom: 20, backgroundColor: Colors.surface }}>
                <View style={{ padding: 14, gap: 12 }}>
                  <View style={{ gap: 4 }}>
                    <AppText style={{ fontSize: 12, color: Colors.textSecondary, fontWeight: '600' }}>Issue Date</AppText>
                    <TouchableOpacity
                      style={{ borderWidth: 1, borderColor: Colors.divider, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: Colors.background, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
                      onPress={() => {
                        if (invoiceIssuedAt) {
                          const d = new Date(invoiceIssuedAt);
                          if (!isNaN(d.getTime())) {
                            setDpYear(d.getFullYear());
                            setDpMonth(d.getMonth() + 1);
                            setDpDay(d.getDate());
                          }
                        } else {
                          const now = new Date();
                          setDpYear(now.getFullYear());
                          setDpMonth(now.getMonth() + 1);
                          setDpDay(now.getDate());
                        }
                        setDatePickerVisible(true);
                      }}
                      activeOpacity={0.7}
                    >
                      <AppText style={{ fontSize: 14, color: invoiceIssuedAt ? Colors.text : Colors.textLight }}>
                        {invoiceIssuedAt || 'Select date'}
                      </AppText>
                      <Icon name="calendar-today" size={18} color={Colors.textSecondary} />
                    </TouchableOpacity>
                  </View>
                  {!!invoiceIssuedAt && (
                    <View style={{ gap: 4 }}>
                      <AppText style={{ fontSize: 12, color: Colors.textSecondary, fontWeight: '600' }}>Due Date <AppText style={{ fontSize: 11, fontWeight: '400' }}>(Issue Date + 30 days)</AppText></AppText>
                      <View style={{ borderWidth: 1, borderColor: Colors.divider, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: '#F8FAFC' }}>
                        <AppText style={{ fontSize: 14, color: invoiceDueAt ? Colors.text : Colors.textLight }}>
                          {invoiceDueAt || '—'}
                        </AppText>
                      </View>
                    </View>
                  )}
                  <View style={{ gap: 4 }}>
                    <AppText style={{ fontSize: 12, color: Colors.textSecondary, fontWeight: '600' }}>Note</AppText>
                    <TextInput
                      style={{ borderWidth: 1, borderColor: Colors.divider, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, fontSize: 14, color: Colors.text, backgroundColor: Colors.background, minHeight: 72, textAlignVertical: 'top' }}
                      value={invoiceNote}
                      onChangeText={setInvoiceNote}
                      placeholder="Optional note..."
                      placeholderTextColor={Colors.textLight}
                      multiline
                    />
                  </View>
                </View>
              </View>

            </ScrollView>

            {/* Signature — outside ScrollView so drawing never conflicts with scroll */}
            <View style={invStyles.sigCard}>
              <View style={invStyles.sigHeader}>
                <View style={invStyles.sigHeaderLeft}>
                  <Icon name="draw" size={16} color={Colors.primary} />
                  <AppText style={invStyles.sigHeaderTitle}>Recipient Signature</AppText>
                  <View style={invStyles.sigRequiredBadge}>
                    <AppText style={invStyles.sigRequiredText}>Required</AppText>
                  </View>
                </View>
                <View style={invStyles.sigHeaderActions}>
                  <TouchableOpacity
                    style={[invStyles.sigActionBtn, sigUploaded && invStyles.sigActionBtnDone]}
                    disabled={sigUploading}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    onPress={async () => {
                      if (sigRef.current?.isEmpty()) {
                        showAlert({ type: 'warning', title: 'No Signature', message: 'Please draw a signature first.' });
                        return;
                      }
                      setSigUploading(true);
                      try {
                        const png = await sigRef.current!.toPNG();
                        const url = await uploadDirectApi({ uri: png, type: 'image/png', fileName: 'sig-inv-preview.png' });
                        setSigUploadedUrl(url);
                        setSigUploaded(true);
                      } catch (e: any) {
                        showAlert({ type: 'error', title: 'Upload Failed', message: e?.message ?? 'Could not upload signature' });
                      } finally {
                        setSigUploading(false);
                      }
                    }}
                  >
                    {sigUploading
                      ? <ActivityIndicator size="small" color={sigUploaded ? '#10B981' : Colors.primary} />
                      : <Icon name={sigUploaded ? 'check-circle' : 'cloud-upload'} size={13} color={sigUploaded ? '#10B981' : Colors.primary} />}
                    <AppText style={[invStyles.sigActionText, sigUploaded && { color: '#10B981' }]}>
                      {sigUploaded ? 'Uploaded' : 'Upload'}
                    </AppText>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={invStyles.sigActionBtn}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    onPress={() => { sigRef.current?.clear(); setSigUploaded(false); setSigUploadedUrl(null); setHasSig(false); }}
                  >
                    <Icon name="refresh" size={13} color={Colors.primary} />
                    <AppText style={invStyles.sigActionText}>Clear</AppText>
                  </TouchableOpacity>
                </View>
              </View>

              <View style={invStyles.sigDrawArea}>
                <SignaturePad ref={sigRef} style={invStyles.sigPad} onDrawEnd={() => setHasSig(true)} />
              </View>

              <View style={invStyles.sigFooter}>
                <View style={invStyles.sigFooterLine} />
                <Icon name="person-outline" size={13} color="#94A3B8" />
                <AppText style={invStyles.sigFooterLabel}>Recipient Signature</AppText>
                <View style={invStyles.sigFooterLine} />
              </View>
            </View>
          </KeyboardAvoidingView>

          {/* Submit bar */}
          <View style={invStyles.submitBar}>
            {invoiceError ? (
              <View style={invStyles.errorBox}>
                <Icon name="error-outline" size={16} color={Colors.error} />
                <AppText style={invStyles.errorText} numberOfLines={2}>{invoiceError}</AppText>
              </View>
            ) : null}
            <AppButton
              label="Create Invoice"
              onPress={doCreateInvoice}
              variant="primary"
              size="lg"
              fullWidth
              loading={generatingInvoice}
              disabled={generatingInvoice || (!hasSig && !sigUploadedUrl)}
            />
          </View>

          {/* Date Picker — must live inside the fullScreen modal to render on top of it on iOS */}
          <Modal visible={datePickerVisible} transparent animationType="fade" onRequestClose={() => setDatePickerVisible(false)}>
            <View style={{ flex: 1, justifyContent: 'flex-end' }}>
              <TouchableOpacity style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.45)' }} activeOpacity={1} onPress={() => setDatePickerVisible(false)} />
              <View style={{ backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: 28 }}>
                {/* Header */}
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: '#F0F0F0' }}>
                  <TouchableOpacity onPress={() => setDatePickerVisible(false)}>
                    <AppText style={{ fontSize: 15, color: Colors.textSecondary }}>Cancel</AppText>
                  </TouchableOpacity>
                  <AppText style={{ fontSize: 16, fontWeight: '700', color: Colors.text }}>Select Issue Date</AppText>
                  <TouchableOpacity onPress={() => {
                    const daysInMonth = getDpDaysInMonth(dpYear, dpMonth);
                    const safeDay = Math.min(dpDay, daysInMonth);
                    const issued = `${dpYear}-${String(dpMonth).padStart(2, '0')}-${String(safeDay).padStart(2, '0')}`;
                    setInvoiceIssuedAt(issued);
                    const due = new Date(dpYear, dpMonth - 1, safeDay + 30);
                    const dueStr = `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, '0')}-${String(due.getDate()).padStart(2, '0')}`;
                    setInvoiceDueAt(dueStr);
                    setDatePickerVisible(false);
                  }}>
                    <AppText style={{ fontSize: 15, fontWeight: '700', color: Colors.primary }}>Done</AppText>
                  </TouchableOpacity>
                </View>
                {/* Column pickers */}
                <View style={{ flexDirection: 'row', height: 220, marginTop: 4 }}>
                  {/* Year */}
                  <View style={{ flex: 1, position: 'relative' }}>
                    <View pointerEvents="none" style={{ position: 'absolute', top: 88, left: 0, right: 0, height: 44, borderTopWidth: 1, borderBottomWidth: 1, borderColor: '#E0E0E0' }} />
                    <ScrollView ref={dpYearRef} showsVerticalScrollIndicator={false} snapToInterval={DP_ITEM_H} decelerationRate="fast" contentContainerStyle={{ paddingVertical: DP_ITEM_H * 2 }}
                      onMomentumScrollEnd={e => { const idx = Math.round(e.nativeEvent.contentOffset.y / DP_ITEM_H); setDpYear(DP_YEARS[Math.max(0, Math.min(idx, DP_YEARS.length - 1))]); }}>
                      {DP_YEARS.map(y => (
                        <TouchableOpacity key={y} style={{ height: DP_ITEM_H, justifyContent: 'center', alignItems: 'center' }} onPress={() => { dpYearRef.current?.scrollTo({ y: DP_YEARS.indexOf(y) * DP_ITEM_H, animated: true }); setDpYear(y); }}>
                          <AppText style={{ fontSize: 17, color: dpYear === y ? Colors.text : Colors.textSecondary, fontWeight: dpYear === y ? '700' : '400' }}>{y}</AppText>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </View>
                  {/* Month */}
                  <View style={{ flex: 1, position: 'relative' }}>
                    <View pointerEvents="none" style={{ position: 'absolute', top: 88, left: 0, right: 0, height: 44, borderTopWidth: 1, borderBottomWidth: 1, borderColor: '#E0E0E0' }} />
                    <ScrollView ref={dpMonthRef} showsVerticalScrollIndicator={false} snapToInterval={DP_ITEM_H} decelerationRate="fast" contentContainerStyle={{ paddingVertical: DP_ITEM_H * 2 }}
                      onMomentumScrollEnd={e => { const idx = Math.round(e.nativeEvent.contentOffset.y / DP_ITEM_H); setDpMonth(Math.max(1, Math.min(idx + 1, 12))); }}>
                      {DP_MONTHS.map((mn, i) => (
                        <TouchableOpacity key={mn} style={{ height: DP_ITEM_H, justifyContent: 'center', alignItems: 'center' }} onPress={() => { dpMonthRef.current?.scrollTo({ y: i * DP_ITEM_H, animated: true }); setDpMonth(i + 1); }}>
                          <AppText style={{ fontSize: 17, color: dpMonth === i + 1 ? Colors.text : Colors.textSecondary, fontWeight: dpMonth === i + 1 ? '700' : '400' }}>{mn}</AppText>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </View>
                  {/* Day */}
                  <View style={{ flex: 1, position: 'relative' }}>
                    <View pointerEvents="none" style={{ position: 'absolute', top: 88, left: 0, right: 0, height: 44, borderTopWidth: 1, borderBottomWidth: 1, borderColor: '#E0E0E0' }} />
                    <ScrollView ref={dpDayRef} showsVerticalScrollIndicator={false} snapToInterval={DP_ITEM_H} decelerationRate="fast" contentContainerStyle={{ paddingVertical: DP_ITEM_H * 2 }}
                      onMomentumScrollEnd={e => { const idx = Math.round(e.nativeEvent.contentOffset.y / DP_ITEM_H); setDpDay(Math.max(1, Math.min(idx + 1, getDpDaysInMonth(dpYear, dpMonth)))); }}>
                      {Array.from({ length: getDpDaysInMonth(dpYear, dpMonth) }, (_, i) => i + 1).map(d => (
                        <TouchableOpacity key={d} style={{ height: DP_ITEM_H, justifyContent: 'center', alignItems: 'center' }} onPress={() => { dpDayRef.current?.scrollTo({ y: (d - 1) * DP_ITEM_H, animated: true }); setDpDay(d); }}>
                          <AppText style={{ fontSize: 17, color: dpDay === d ? Colors.text : Colors.textSecondary, fontWeight: dpDay === d ? '700' : '400' }}>{String(d).padStart(2, '0')}</AppText>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </View>
                </View>
              </View>
            </View>
          </Modal>
        </SafeAreaView>
      </Modal>

      {/* ── Edit Order Items modal (same template as Create SO confirm screen) ── */}
      <Modal
        visible={editingOrder !== null}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => setEditingOrder(null)}
      >
        <SafeAreaView style={editStyles.modalSafe} edges={['bottom']}>
          <AppBar
            title="Edit Order Items"
            subtitle={editingOrder?.referenceNumber ?? editingOrder?.ref ?? ''}
            titleAlign="left"
            showBack
            onBack={() => setEditingOrder(null)}
          />

          {loadingEdit ? (
            <View style={editStyles.loadingBox}>
              <ActivityIndicator size="large" color={Colors.primary} />
            </View>
          ) : (
            <KeyboardAvoidingView
              style={{ flex: 1 }}
              behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            >
              <ScrollView
                style={editStyles.modalScroll}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingBottom: 24 }}
              >
                <AppText style={editStyles.sectionLabel}>
                  Order Items ({editItems.length})
                </AppText>
                <View style={editStyles.orderCard}>
                  {/* Campus header */}
                  {editingOrder ? (() => {
                    const campus =
                      (editCampusId != null ? campusMap[String(editCampusId)]?.campusCode : null) ??
                      editingOrder.campusCode ??
                      editingOrder.campus?.campusCode;
                    const customer = editingOrder.customerOrgName ?? editingOrder.customerOrg?.nameEn ?? '';
                    return (
                      <>
                        <TouchableOpacity
                          style={editStyles.orderCardCampus}
                          onPress={() => setCampusPickerVisible(true)}
                          activeOpacity={0.7}
                        >
                          <Icon name="place" size={18} color={Colors.primary} />
                          {campus ? <AppText style={editStyles.orderCardCampusCode}>{campus}</AppText> : (
                            <AppText style={editStyles.orderCardCampusCode}>Select campus</AppText>
                          )}
                          <AppText style={editStyles.orderCardCampusName} numberOfLines={1}>{customer}</AppText>
                          <Icon name="edit" size={16} color={Colors.primary} />
                        </TouchableOpacity>
                        <View style={editStyles.orderCardDivider} />
                      </>
                    );
                  })() : null}

                  {/* Items */}
                  {editItems.map((it, idx) => {
                    const qty = parseInt(it.qty, 10) || 0;
                    const price = parseFloat(it.price) || 0;
                    const pct = Math.min(100, Math.max(0, parseFloat(it.discount) || 0));
                    const lineSubtotal = qty * price;
                    const disc = lineSubtotal * pct / 100;
                    const lineTotal = Math.max(0, lineSubtotal - disc);
                    return (
                      <View key={it.id}>
                        {/* Item row */}
                        <View style={editStyles.orderItemRow}>
                          <View style={editStyles.orderItemImageBox}>
                            {it.imageUrl ? (
                              <Image
                                source={{ uri: it.imageUrl }}
                                style={editStyles.orderItemImage}
                                resizeMode="cover"
                              />
                            ) : (
                              <View style={editStyles.orderItemImagePlaceholder}>
                                <Icon name="fastfood" size={18} color="#CBD5E1" />
                              </View>
                            )}
                            <View style={editStyles.orderItemIndexBadge}>
                              <AppText style={editStyles.orderItemIndexText}>{idx + 1}</AppText>
                            </View>
                          </View>
                          <View style={editStyles.orderItemNames}>
                            {it.sku ? (
                              <View style={editStyles.orderItemCodeChip}>
                                <AppText style={editStyles.orderItemCodeText}>{it.sku}</AppText>
                              </View>
                            ) : null}
                            <AppText style={editStyles.orderItemNameEn} numberOfLines={2}>{it.name}</AppText>
                            {it.nameKh ? (
                              <AppText style={editStyles.orderItemNameKh} numberOfLines={1}>{it.nameKh}</AppText>
                            ) : null}
                          </View>
                          <View style={editStyles.orderItemRight}>
                            {disc > 0 ? (
                              <>
                                <AppText style={editStyles.orderItemPriceOld}>${lineSubtotal.toFixed(2)}</AppText>
                                <AppText style={editStyles.orderItemPrice}>${lineTotal.toFixed(2)}</AppText>
                              </>
                            ) : (
                              <AppText style={editStyles.orderItemPrice}>${lineTotal.toFixed(2)}</AppText>
                            )}
                            <AppText style={editStyles.orderItemUnit}>${price.toFixed(2)} × {qty}</AppText>
                          </View>
                          {editItems.length > 1 ? (
                            <TouchableOpacity
                              style={editStyles.removeItemBtn}
                              onPress={() => removeEditItem(idx)}
                              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            >
                              <Icon name="close" size={16} color={Colors.error} />
                            </TouchableOpacity>
                          ) : null}
                        </View>

                        {/* Price row */}
                        <View style={editStyles.itemPriceRow}>
                          <View style={editStyles.itemFieldLeft}>
                            <Icon name="attach-money" size={13} color={Colors.primary} />
                            <AppText style={editStyles.itemFieldLabel}>Unit Price</AppText>
                          </View>
                          <View style={editStyles.priceInputWrap}>
                            <AppText style={editStyles.priceInputPrefix}>$</AppText>
                            <TextInput
                              style={editStyles.priceInput}
                              value={it.price}
                              onChangeText={v => updateEditItem(idx, 'price', v.replace(/[^0-9.]/g, ''))}
                              keyboardType="decimal-pad"
                              selectTextOnFocus
                            />
                          </View>
                        </View>

                        {/* Qty row */}
                        <View style={editStyles.itemQtyRow}>
                          <View style={editStyles.itemFieldLeft}>
                            <Icon name="format-list-numbered" size={13} color={Colors.primary} />
                            <AppText style={editStyles.itemFieldLabel}>Qty</AppText>
                          </View>
                          <EditQtyPill
                            qty={it.qty}
                            onChangeText={v => updateEditItem(idx, 'qty', v)}
                            onDecrement={() => {
                              if (qty <= 1) {
                                if (editItems.length > 1) removeEditItem(idx);
                              } else {
                                updateEditItem(idx, 'qty', String(qty - 1));
                              }
                            }}
                            onIncrement={() => updateEditItem(idx, 'qty', String(qty + 1))}
                            onEndEditing={() => {
                              const v = parseInt(it.qty, 10) || 0;
                              if (v <= 0) {
                                if (editItems.length > 1) removeEditItem(idx);
                                else updateEditItem(idx, 'qty', '1');
                              }
                            }}
                          />
                        </View>

                        {/* Discount row */}
                        <View style={editStyles.itemDiscountRow}>
                          <View style={editStyles.itemFieldLeft}>
                            <Icon name="sell" size={13} color="#7C3AED" />
                            <AppText style={editStyles.itemDiscountLabel}>Discount</AppText>
                          </View>
                          <View style={editStyles.itemDiscountRight}>
                            <View style={editStyles.itemDiscountInputWrap}>
                              <TextInput
                                style={editStyles.itemDiscountInput}
                                value={it.discount}
                                onChangeText={v => {
                                  const clean = v.replace(/[^0-9.]/g, '');
                                  const num = parseFloat(clean);
                                  if (!isNaN(num) && num > 100) return;
                                  updateEditItem(idx, 'discount', clean);
                                }}
                                keyboardType="decimal-pad"
                                placeholder="0"
                                placeholderTextColor={Colors.textLight}
                                maxLength={6}
                                selectTextOnFocus
                              />
                              <AppText style={editStyles.itemDiscountPct}>%</AppText>
                            </View>
                            {disc > 0 ? (
                              <AppText style={editStyles.itemDiscountSaving}>−${disc.toFixed(2)}</AppText>
                            ) : null}
                          </View>
                        </View>

                        <View style={editStyles.orderCardDivider} />
                      </View>
                    );
                  })}

                  {/* Add item */}
                  <TouchableOpacity
                    style={editStyles.addItemBtn}
                    onPress={() => setAddItemModalVisible(true)}
                    activeOpacity={0.75}
                  >
                    <Icon name="add-circle-outline" size={18} color={Colors.primary} />
                    <AppText style={editStyles.addItemBtnText}>Add Item</AppText>
                  </TouchableOpacity>

                  {/* Totals */}
                  {(() => {
                    const subtotal = editItems.reduce((s, it) => s + (parseInt(it.qty, 10) || 0) * (parseFloat(it.price) || 0), 0);
                    const discount = editItems.reduce((s, it) => {
                      const lineSubtotal = (parseInt(it.qty, 10) || 0) * (parseFloat(it.price) || 0);
                      const pct = Math.min(100, Math.max(0, parseFloat(it.discount) || 0));
                      return s + lineSubtotal * pct / 100;
                    }, 0);
                    const total = Math.max(0, subtotal - discount);
                    return (
                      <>
                        <View style={editStyles.orderCardDivider} />
                        <View style={editStyles.orderTotalsBox}>
                          <View style={editStyles.orderTotalRow}>
                            <AppText style={editStyles.orderTotalRowLabel}>Subtotal</AppText>
                            <AppText style={editStyles.orderTotalRowValue}>${subtotal.toFixed(2)}</AppText>
                          </View>
                          {discount > 0 ? (
                            <View style={editStyles.orderTotalRow}>
                              <View style={editStyles.discountLabelRow}>
                                <Icon name="sell" size={13} color="#7C3AED" />
                                <AppText style={editStyles.discountLabel}>Total Discount</AppText>
                              </View>
                              <AppText style={editStyles.discountValue}>−${discount.toFixed(2)}</AppText>
                            </View>
                          ) : null}
                          <View style={editStyles.orderCardDivider} />
                          <View style={editStyles.orderItemsTotal}>
                            <AppText style={editStyles.orderItemsTotalLabel}>Total</AppText>
                            <AppText style={editStyles.orderItemsTotalValue}>${total.toFixed(2)}</AppText>
                          </View>
                        </View>
                      </>
                    );
                  })()}
                </View>
              </ScrollView>
            </KeyboardAvoidingView>
          )}

          <View style={editStyles.saveBar}>
            <AppButton
              label="Save Changes"
              onPress={saveEditItems}
              variant="primary"
              size="lg"
              fullWidth
              loading={savingEdit}
              disabled={savingEdit || loadingEdit}
            />
          </View>

          {/* Inline confirm overlay (a sibling <Modal> here won't render above this fullScreen modal) */}
          {confirmSaveVisible ? (
            <View style={editStyles.confirmOverlay}>
              <View style={editStyles.confirmCard}>
                <View style={editStyles.confirmIconCircle}>
                  <AppText style={{ fontSize: 18, fontWeight: '900', color: Colors.primary }}>A4</AppText>
                </View>
                <AppText style={editStyles.confirmTitle}>Save Changes</AppText>
                <AppText style={editStyles.confirmMessage}>
                  Save changes to order "{editingOrder?.referenceNumber ?? editingOrder?.ref ?? ''}"? This will update item quantities, prices, and discounts.
                </AppText>
                <View style={editStyles.confirmActions}>
                  <AppButton
                    label="Cancel"
                    onPress={() => setConfirmSaveVisible(false)}
                    variant="outline"
                    size="md"
                    style={editStyles.confirmActionBtn}
                  />
                  <AppButton
                    label="Save"
                    onPress={performSaveEditItems}
                    variant="primary"
                    size="md"
                    loading={savingEdit}
                    disabled={savingEdit}
                    style={editStyles.confirmActionBtn}
                  />
                </View>
              </View>
            </View>
          ) : null}

          {/* Add Item overlay (inline, not a sibling <Modal> — see note above) */}
          {addItemModalVisible ? (
            <View style={editStyles.fullOverlay}>
              <AppBar
                title="Add Item"
                titleAlign="left"
                showBack
                onBack={() => setAddItemModalVisible(false)}
              />
              <View style={editStyles.addItemSearchBox}>
                <Icon name="search" size={18} color={Colors.textLight} />
                <TextInput
                  style={editStyles.addItemSearchInput}
                  value={addItemSearch}
                  onChangeText={setAddItemSearch}
                  placeholder="Search by name or SKU"
                  placeholderTextColor={Colors.textLight}
                />
              </View>
              <ScrollView
                style={editStyles.modalScroll}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingBottom: 24 }}
              >
                {filteredAddProducts.map(p => {
                  const price = p.fixedPriceCents != null ? parseInt(p.fixedPriceCents, 10) / 100 : 0;
                  return (
                    <TouchableOpacity
                      key={p.id}
                      style={editStyles.addItemRow}
                      onPress={() => addProductToOrder(p)}
                      activeOpacity={0.7}
                    >
                      <View style={editStyles.orderItemImageBox}>
                        {p.primaryImageUrl ? (
                          <Image source={{ uri: p.primaryImageUrl }} style={editStyles.orderItemImage} resizeMode="cover" />
                        ) : (
                          <View style={editStyles.orderItemImagePlaceholder}>
                            <Icon name="fastfood" size={18} color="#CBD5E1" />
                          </View>
                        )}
                      </View>
                      <View style={editStyles.orderItemNames}>
                        {p.sku ? (
                          <View style={editStyles.orderItemCodeChip}>
                            <AppText style={editStyles.orderItemCodeText}>{p.sku}</AppText>
                          </View>
                        ) : null}
                        <AppText style={editStyles.orderItemNameEn} numberOfLines={2}>{p.nameEn}</AppText>
                        {p.nameKm ? (
                          <AppText style={editStyles.orderItemNameKh} numberOfLines={1}>{p.nameKm}</AppText>
                        ) : null}
                      </View>
                      <AppText style={editStyles.orderItemPrice}>${price.toFixed(2)}</AppText>
                    </TouchableOpacity>
                  );
                })}
                {filteredAddProducts.length === 0 ? (
                  <View style={editStyles.loadingBox}>
                    <AppText style={{ color: Colors.textSecondary }}>No products found</AppText>
                  </View>
                ) : null}
              </ScrollView>
            </View>
          ) : null}

          {/* Campus picker overlay (inline, not a sibling <Modal>) */}
          {campusPickerVisible ? (
            <View style={editStyles.fullOverlay}>
              <AppBar
                title="Select Campus"
                titleAlign="left"
                showBack
                onBack={() => setCampusPickerVisible(false)}
              />
              <View style={editStyles.addItemSearchBox}>
                <Icon name="search" size={18} color={Colors.textLight} />
                <TextInput
                  style={editStyles.addItemSearchInput}
                  value={campusSearch}
                  onChangeText={setCampusSearch}
                  placeholder="Search by code or name"
                  placeholderTextColor={Colors.textLight}
                />
              </View>
              <ScrollView
                style={editStyles.modalScroll}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingBottom: 24 }}
              >
                {filteredCampuses.map(c => {
                  const selected = String(c.id) === String(editCampusId);
                  return (
                    <TouchableOpacity
                      key={String(c.id)}
                      style={[editStyles.addItemRow, selected && editStyles.addItemRowSelected]}
                      onPress={() => {
                        setEditCampusId(c.id);
                        setCampusPickerVisible(false);
                        setCampusSearch('');
                      }}
                      activeOpacity={0.7}
                    >
                      <View style={editStyles.orderItemNames}>
                        <View style={editStyles.orderItemCodeChip}>
                          <AppText style={editStyles.orderItemCodeText}>{c.campusCode}</AppText>
                        </View>
                        <AppText style={editStyles.orderItemNameEn} numberOfLines={1}>{c.nameEn}</AppText>
                        {c.nameKm ? (
                          <AppText style={editStyles.orderItemNameKh} numberOfLines={1}>{c.nameKm}</AppText>
                        ) : null}
                      </View>
                      {selected ? <Icon name="check-circle" size={20} color={Colors.primary} /> : null}
                    </TouchableOpacity>
                  );
                })}
                {filteredCampuses.length === 0 ? (
                  <View style={editStyles.loadingBox}>
                    <AppText style={{ color: Colors.textSecondary }}>No campuses found</AppText>
                  </View>
                ) : null}
              </ScrollView>
            </View>
          ) : null}
        </SafeAreaView>
      </Modal>

      {/* ── Invoice Summary Modal ────────────────────────────────────────────── */}
      <Modal
        visible={summaryVisible}
        transparent={false}
        animationType="slide"
        onRequestClose={() => setSummaryVisible(false)}
      >
        <View style={{ flex: 1, backgroundColor: '#1E293B' }}>
          <View style={{
            flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
            paddingHorizontal: 16, paddingVertical: 14, paddingTop: 50,
            backgroundColor: '#1E293B',
          }}>
            <AppText style={{ fontSize: 16, fontWeight: '700', color: '#FFFFFF' }}>Invoice Summary</AppText>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <TouchableOpacity
                onPress={handlePrintSummary}
                disabled={printingSummary}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: 6,
                  backgroundColor: '#2563EB', borderRadius: 8,
                  paddingHorizontal: 14, paddingVertical: 7,
                }}
              >
                {printingSummary
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Icon name="print" size={18} color="#fff" />}
                <AppText style={{ fontSize: 13, fontWeight: '700', color: '#fff' }}>Print</AppText>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setSummaryVisible(false)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Icon name="close" size={24} color="#FFFFFF" />
              </TouchableOpacity>
            </View>
          </View>
          <View style={{ flex: 1, padding: 8 }}>
            <WebView
              source={{ html: summaryHtml, baseUrl: '' }}
              originWhitelist={['*']}
              style={{ flex: 1, backgroundColor: '#fff', borderRadius: 8 }}
            />
          </View>
        </View>
      </Modal>

      {/* ── Confirm Create Invoice modal ──────────────────────────────────────── */}
      {(() => {
        const confirmOrders = orders.filter(o => confirmInvoiceIds[o.id] === true);
        const confirmTotal  = confirmOrders.reduce((s, o) => s + getOrderTotalCents(o), 0);

        // Campus grouping — detect if orders span multiple campuses
        const campusGroups = [...new Set(confirmOrders.map(o =>
          o.campusCode ?? o.campus?.campusCode ?? campusMap[String(o.campusId)]?.campusCode ?? String(o.campusId ?? '—')
        ))];
        const multiCampus = campusGroups.length > 1;

        // SKU breakdown — aggregate qty and amount across all selected orders
        const skuMap: Record<string, { sku: string; name: string; qty: number; cents: number }> = {};
        confirmOrders.forEach(o => {
          (o.items ?? []).forEach((it: any) => {
            const prod  = it.productId ? productMap[it.productId] : undefined;
            const key   = it.productId ?? it.productSku ?? it.productCode ?? '—';
            const sku   = it.productSku ?? it.productCode ?? prod?.sku ?? it.productId ?? '—';
            const name  = it.productNameEn ?? it.productName ?? prod?.nameEn ?? sku;
            const unit  = parseCents(it.unitPriceCents);
            const dis   = parseCents(it.discountCents);
            const qty   = Number(it.qty ?? 0);
            const total = qty * unit - dis;
            if (!skuMap[key]) skuMap[key] = { sku, name, qty: 0, cents: 0 };
            skuMap[key].qty   += qty;
            skuMap[key].cents += total;
          });
        });
        const skuRows  = Object.values(skuMap).sort((a, b) => b.cents - a.cents);
        const totalQty = skuRows.reduce((s, r) => s + r.qty, 0);

        return (
          <Modal
            visible={confirmInvoiceVisible}
            transparent
            animationType="fade"
            onRequestClose={() => setConfirmInvoiceVisible(false)}
          >
            <View style={confirmStyles.backdrop}>
              <View style={[confirmStyles.card, { maxHeight: '88%' }]}>
                <AppText style={confirmStyles.title}>Create Invoice?</AppText>

                <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

                  {/* Campus warning */}
                  {multiCampus && (
                    <View style={{ backgroundColor: '#FEF9C3', borderRadius: 8, padding: 10, marginBottom: 14, flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
                      <Icon name="warning-amber" size={16} color="#B45309" />
                      <AppText style={{ fontSize: 12, color: '#92400E', flex: 1 }}>
                        {campusGroups.length} campuses selected ({campusGroups.join(', ')}) — will create {campusGroups.length} separate invoices.
                      </AppText>
                    </View>
                  )}

                  {/* Single campus badge */}
                  {!multiCampus && campusGroups.length === 1 && (
                    <View style={{ backgroundColor: '#EFF6FF', borderRadius: 8, padding: 10, marginBottom: 14, flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                      <Icon name="business" size={15} color="#2563EB" />
                      <AppText style={{ fontSize: 13, fontWeight: '700', color: '#1D4ED8' }}>{campusGroups[0]}</AppText>
                    </View>
                  )}

                  {/* Order rows */}
                  <View style={confirmStyles.table}>
                    <View style={confirmStyles.tableHeader}>
                      <AppText style={[confirmStyles.colSO, confirmStyles.headerText]}>SO Number</AppText>
                      <AppText style={[confirmStyles.colCampus, confirmStyles.headerText]}>Campus</AppText>
                      <AppText style={[confirmStyles.colAmt, confirmStyles.headerText]}>Amount</AppText>
                    </View>
                    {confirmOrders.map(o => {
                      const ref    = o.referenceNumber ?? o.ref ?? o.orderNumber ?? o.id;
                      const campus = o.campusCode ?? o.campus?.campusCode ?? (o.campusId != null ? campusMap[String(o.campusId)]?.campusCode : null) ?? '—';
                      const amt    = getOrderTotalCents(o);
                      return (
                        <View key={o.id} style={confirmStyles.row}>
                          <AppText style={[confirmStyles.colSO, confirmStyles.rowText]} numberOfLines={1}>{ref}</AppText>
                          <AppText style={[confirmStyles.colCampus, confirmStyles.rowText]}>{campus}</AppText>
                          <AppText style={[confirmStyles.colAmt, confirmStyles.rowText]}>{fmtCents(amt)}</AppText>
                        </View>
                      );
                    })}
                  </View>

                  {/* SKU breakdown */}
                  {skuRows.length > 0 && (
                    <>
                      <AppText style={{ fontSize: 11, fontWeight: '700', color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
                        Items by SKU
                      </AppText>
                      <View style={confirmStyles.table}>
                        <View style={confirmStyles.tableHeader}>
                          <AppText style={[{ flex: 2 }, confirmStyles.headerText]}>SKU</AppText>
                          <AppText style={[{ flex: 3 }, confirmStyles.headerText]}>Product</AppText>
                          <AppText style={[{ width: 36, textAlign: 'center' }, confirmStyles.headerText]}>Qty</AppText>
                          <AppText style={[confirmStyles.colAmt, confirmStyles.headerText]}>Amount</AppText>
                        </View>
                        {skuRows.map(r => (
                          <View key={r.sku} style={confirmStyles.row}>
                            <AppText style={[{ flex: 2 }, confirmStyles.rowText]} numberOfLines={1}>{r.sku}</AppText>
                            <AppText style={[{ flex: 3 }, confirmStyles.rowText]} numberOfLines={1}>{r.name}</AppText>
                            <AppText style={[{ width: 36, textAlign: 'center' }, confirmStyles.rowText]}>{r.qty}</AppText>
                            <AppText style={[confirmStyles.colAmt, confirmStyles.rowText]}>{fmtCents(r.cents)}</AppText>
                          </View>
                        ))}
                        <View style={[confirmStyles.row, { backgroundColor: '#F8FAFC' }]}>
                          <AppText style={[{ flex: 2 }, confirmStyles.rowText, { fontWeight: '700' }]}>Total</AppText>
                          <AppText style={[{ flex: 3 }, confirmStyles.rowText]} />
                          <AppText style={[{ width: 36, textAlign: 'center' }, confirmStyles.rowText, { fontWeight: '700', color: '#2563EB' }]}>{totalQty}</AppText>
                          <AppText style={[confirmStyles.colAmt, confirmStyles.rowText, { fontWeight: '700' }]}>{fmtCents(confirmTotal)}</AppText>
                        </View>
                      </View>
                    </>
                  )}

                  {/* Grand total */}
                  <View style={confirmStyles.totalRow}>
                    <AppText style={confirmStyles.totalLabel}>Total</AppText>
                    <AppText style={confirmStyles.totalAmount}>{fmtCents(confirmTotal)}</AppText>
                  </View>

                </ScrollView>

                {/* Buttons */}
                <View style={[confirmStyles.btnRow, { marginTop: 4 }]}>
                  <TouchableOpacity style={confirmStyles.btnCancel} onPress={() => setConfirmInvoiceVisible(false)} activeOpacity={0.8}>
                    <AppText style={confirmStyles.btnCancelText}>Cancel</AppText>
                  </TouchableOpacity>
                  <TouchableOpacity style={confirmStyles.btnCreate} onPress={() => doOpenInvoiceModal(confirmInvoiceIds)} activeOpacity={0.8}>
                    <AppText style={confirmStyles.btnCreateText}>Create</AppText>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </Modal>
        );
      })()}

      {/* ── Confirm Summary modal ────────────────────────────────────────────── */}
      {(() => {
        const confirmHeaders = invoicedHeaders.filter(h => selectedInvoiceIds[h.id] && !h.summaryNumber);
        const confirmTotal   = confirmHeaders.reduce((s, h) => s + parseCents(h.totalCents), 0);
        return (
          <Modal
            visible={confirmSummaryVisible}
            transparent
            animationType="fade"
            onRequestClose={() => setConfirmSummaryVisible(false)}
          >
            <KeyboardAvoidingView
              style={{ flex: 1 }}
              behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
              keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 24}
            >
              <ScrollView
                contentContainerStyle={confirmStyles.backdrop}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
              <View style={confirmStyles.card}>
                <AppText style={confirmStyles.title}>Generate Summary?</AppText>

                <View style={confirmStyles.table}>
                  <View style={confirmStyles.tableHeader}>
                    <AppText style={[confirmStyles.colSO, confirmStyles.headerText]}>Invoice #</AppText>
                    <AppText style={[confirmStyles.colNote, confirmStyles.headerText]}>Note</AppText>
                    <AppText style={[confirmStyles.colCampus, confirmStyles.headerText]}>Campus</AppText>
                    <AppText style={[confirmStyles.colDate, confirmStyles.headerText]}>Date</AppText>
                    <AppText style={[confirmStyles.colAmt, confirmStyles.headerText]}>Amount</AppText>
                  </View>
                  {confirmHeaders.map(h => {
                    const campus = h.campusCode ?? h.campus?.campusCode ?? campusMap[String(h.campusId)]?.campusCode ?? '—';
                    const date = fmtDate(h.issuedAt ?? h.createdAt);
                    const amt  = parseCents(h.totalCents);
                    return (
                      <View key={h.id} style={confirmStyles.row}>
                        <AppText style={[confirmStyles.colSO, confirmStyles.rowText]} numberOfLines={1}>{h.invoiceNumber}</AppText>
                        <AppText style={[confirmStyles.colNote, confirmStyles.rowText]} numberOfLines={2}>{h.note ?? '—'}</AppText>
                        <AppText style={[confirmStyles.colCampus, confirmStyles.rowText]}>{campus}</AppText>
                        <AppText style={[confirmStyles.colDate, confirmStyles.rowText]}>{date}</AppText>
                        <AppText style={[confirmStyles.colAmt, confirmStyles.rowText]}>{fmtCents(amt)}</AppText>
                      </View>
                    );
                  })}
                </View>

                <View style={confirmStyles.totalRow}>
                  <AppText style={confirmStyles.totalLabel}>Total</AppText>
                  <AppText style={confirmStyles.totalAmount}>{fmtCents(confirmTotal)}</AppText>
                </View>

                <View style={confirmStyles.descWrapper}>
                  <AppText style={confirmStyles.descLabel}>Summary Date</AppText>
                  <TouchableOpacity
                    style={confirmStyles.dateBtn}
                    onPress={() => setSummaryDatePickerVisible(true)}
                    activeOpacity={0.75}
                  >
                    <AppText style={confirmStyles.dateBtnText}>
                      {summaryDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </AppText>
                    <Icon name="edit-calendar" size={15} color={Colors.primary} />
                  </TouchableOpacity>
                </View>

                <View style={confirmStyles.descWrapper}>
                  <AppText style={confirmStyles.descLabel}>Description</AppText>
                  <TextInput
                    style={confirmStyles.descInput}
                    value={summaryDescription}
                    onChangeText={setSummaryDescription}
                    placeholder="e.g. Monthly invoice summary — June 2026"
                    placeholderTextColor={Colors.textLight}
                    multiline
                    numberOfLines={2}
                    returnKeyType="done"
                    blurOnSubmit
                  />
                </View>

                <View style={confirmStyles.btnRow}>
                  <TouchableOpacity style={confirmStyles.btnCancel} onPress={() => { setConfirmSummaryVisible(false); setSummaryDescription(''); setSummaryDate(new Date()); }} activeOpacity={0.8} disabled={savingSummary}>
                    <AppText style={confirmStyles.btnCancelText}>Cancel</AppText>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[confirmStyles.btnCreate, { backgroundColor: '#2563EB' }, savingSummary && { opacity: 0.7 }]}
                    onPress={doGenerateSummary}
                    activeOpacity={0.8}
                    disabled={savingSummary}
                  >
                    {savingSummary ? (
                      <ActivityIndicator size="small" color={Colors.white} />
                    ) : (
                      <AppText style={confirmStyles.btnCreateText}>Generate</AppText>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
              </ScrollView>
            </KeyboardAvoidingView>
            <DatePickerModal
              visible={summaryDatePickerVisible}
              value={summaryDate}
              onChange={setSummaryDate}
              onClose={() => setSummaryDatePickerVisible(false)}
            />
          </Modal>
        );
      })()}

      <DatePickerModal visible={invoicedFromPickerVisible} value={new Date(invoicedFrom)} onChange={d => { setInvoicedFrom(d.toISOString().slice(0, 10)); setInvoicedFromPickerVisible(false); }} onClose={() => setInvoicedFromPickerVisible(false)} />
      <DatePickerModal visible={invoicedToPickerVisible} value={new Date(invoicedTo)} onChange={d => { setInvoicedTo(d.toISOString().slice(0, 10)); setInvoicedToPickerVisible(false); }} onClose={() => setInvoicedToPickerVisible(false)} />

      {/* Customer org picker modal */}
      <Modal visible={invoicedOrgPickerVisible} transparent animationType="fade" onRequestClose={() => setInvoicedOrgPickerVisible(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', paddingHorizontal: 20 }}>
          <View style={{ backgroundColor: Colors.surface, borderRadius: 14, overflow: 'hidden', maxHeight: '80%' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingTop: 14, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: Colors.divider }}>
              <AppText variant="bodyMedium" style={{ flex: 1, fontWeight: '700' }}>Select Customer</AppText>
              <TouchableOpacity onPress={() => setInvoicedOrgPickerVisible(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Icon name="close" size={22} color={Colors.text} />
              </TouchableOpacity>
            </View>
            {/* Search inside picker */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, margin: 10, borderWidth: 1.5, borderColor: Colors.border, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7, backgroundColor: Colors.background }}>
              <Icon name="search" size={16} color={Colors.textSecondary} />
              <TextInput
                style={{ flex: 1, fontSize: 13, color: Colors.text, padding: 0 }}
                value={invoicedOrgSearch}
                onChangeText={setInvoicedOrgSearch}
                placeholder="Search…"
                placeholderTextColor={Colors.textLight}
                autoCorrect={false}
                autoFocus
              />
              {invoicedOrgSearch ? (
                <TouchableOpacity onPress={() => setInvoicedOrgSearch('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Icon name="close" size={14} color={Colors.textSecondary} />
                </TouchableOpacity>
              ) : null}
            </View>
            <ScrollView keyboardShouldPersistTaps="handled">
              {/* All customers option */}
              <TouchableOpacity
                style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: Colors.divider }}
                onPress={() => { setInvoicedCustomerOrgId(null); setInvoicedOrgPickerVisible(false); }}
              >
                <Icon name="group" size={16} color={Colors.textSecondary} style={{ marginRight: 10 }} />
                <AppText style={{ flex: 1, fontSize: 14, color: Colors.textSecondary, fontStyle: 'italic' }}>All customers</AppText>
                {!invoicedCustomerOrgId ? <Icon name="check" size={18} color={Colors.primary} /> : null}
              </TouchableOpacity>
              {vendorList
                .filter(v => !invoicedOrgSearch.trim() || v.name.toLowerCase().includes(invoicedOrgSearch.trim().toLowerCase()))
                .map(v => (
                  <TouchableOpacity
                    key={v.id}
                    style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: Colors.divider }}
                    onPress={() => { setInvoicedCustomerOrgId(v.id); setInvoicedOrgPickerVisible(false); }}
                  >
                    <Icon name="business" size={16} color={Colors.textSecondary} style={{ marginRight: 10 }} />
                    <AppText style={{ flex: 1, fontSize: 14, color: Colors.text }}>{v.name}</AppText>
                    {invoicedCustomerOrgId === v.id ? <Icon name="check" size={18} color={Colors.primary} /> : null}
                  </TouchableOpacity>
                ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ── Saved Summary detail modal ───────────────────────────────────────── */}
      <Modal
        visible={viewSummaryVisible}
        animationType="slide"
        onRequestClose={() => setViewSummaryVisible(false)}
      >
        <View style={styles.summaryPreviewSafe}>
          <View style={styles.summaryPreviewBar}>
            <TouchableOpacity
              onPress={() => setViewSummaryVisible(false)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Icon name="close" size={24} color={Colors.text} />
            </TouchableOpacity>
            <AppText variant="bodyMedium" style={styles.summaryPreviewTitle}>Summary</AppText>
            <TouchableOpacity
              style={[styles.summaryPrintBtn, printingViewSummary ? styles.summaryPrintBtnDisabled : null]}
              onPress={handlePrintViewSummary}
              disabled={printingViewSummary}
            >
              <Icon name="print" size={18} color={Colors.white} />
              <AppText style={styles.summaryPrintBtnText}>
                {printingViewSummary ? 'Printing…' : 'Print'}
              </AppText>
            </TouchableOpacity>
          </View>
          <WebView
            source={{ html: viewSummaryHtml, baseUrl: '' }}
            style={{ flex: 1 }}
            originWhitelist={['*']}
            scrollEnabled
          />
        </View>
      </Modal>

    </View>
  );
};

const confirmStyles = StyleSheet.create({
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
  rowText: {
    fontSize: 13,
    color: Colors.text,
  },
  colSO:     { flex: 2.5 },
  colNote:   { flex: 2.5 },
  colCampus: { flex: 1.5, textAlign: 'center' },
  colDate:   { flex: 1.5, textAlign: 'center' },
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
  descWrapper: {
    marginBottom: 12,
    gap: 6,
  },
  dateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: Colors.background,
  },
  dateBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.primary,
    flex: 1,
  },
  descLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  descInput: {
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
  totalLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  totalAmount: {
    fontSize: 28,
    fontWeight: '800',
    color: Colors.text,
  },
  btnRow: {
    flexDirection: 'row',
    gap: 10,
  },
  btnCancel: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Colors.divider,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnCancelText: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  btnCreate: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    backgroundColor: '#DC2626',
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnCreateText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
  },
});

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },

  tabBar: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.divider,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    gap: 6,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: { borderBottomColor: Colors.primary },
  tabText: { fontSize: 14, color: Colors.textSecondary, fontWeight: '500' },
  tabTextActive: { color: Colors.primary, fontWeight: '700' },
  tabBadge: {
    backgroundColor: Colors.error,
    borderRadius: 10,
    minWidth: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  tabBadgeText: { fontSize: 10, color: Colors.white, fontWeight: '800' },

  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 4,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  searchIcon: { marginRight: 8 },
  searchInput: { flex: 1, fontSize: 15, color: Colors.text, paddingVertical: 0 },

  selectAllBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 10,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.divider,
  },
  selectAllText: { flex: 1, color: Colors.text },
  selectAllTotal: { fontSize: 14, fontWeight: '700', color: Colors.text },

  summaryBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 2,
  },
  summaryTotal: { fontSize: 15, fontWeight: '700', color: Colors.text },

  list: { padding: 16, gap: 12, paddingBottom: 32 },
  listWithBar: { paddingBottom: 100 },

  card: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
    gap: 10,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  cardSelected: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primaryMuted,
  },

  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  refRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  refText: { fontWeight: '700', color: Colors.text },
  campusChip: {
    backgroundColor: '#DBEAFE',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  campusChipText: { fontSize: 11, fontWeight: '700', color: '#2563EB' },

  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surface,
  },
  checkboxSelected: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  checkboxSummarized: {
    backgroundColor: '#F3F4F6',
    borderColor: '#D1D5DB',
  },

  statusBadge: { borderRadius: 6, paddingHorizontal: 10, paddingVertical: 3 },
  statusReceived:  { backgroundColor: '#D1FAE5' },
  statusInvoiced:  { backgroundColor: '#EDE9FE' },
  statusPaid:      { backgroundColor: Colors.successLight },
  statusText:      { fontSize: 9, fontWeight: '700' },
  statusReceivedText:  { color: '#059669' },
  statusInvoicedText:  { color: '#7C3AED' },
  statusPaidText:      { color: Colors.success },

  cardMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },

  itemsSection: {
    borderTopWidth: 1,
    borderTopColor: Colors.divider,
    paddingTop: 8,
    gap: 6,
  },
  lineItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  lineItemName: { flex: 1, fontSize: 13, color: Colors.text },
  lineItemMeta: { fontSize: 12, color: Colors.textSecondary },
  lineItemTotal: { fontSize: 13, fontWeight: '700', color: Colors.text, minWidth: 60, textAlign: 'right' },

  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: Colors.divider,
    paddingTop: 10,
  },
  itemsLabel: { flex: 1 },
  totalText: { fontSize: 16, fontWeight: '800', color: Colors.text, marginRight: 12 },
  markBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.primaryMuted,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  markBtnText: { fontSize: 12, color: Colors.primary, fontWeight: '700' },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  centerMsg: { textAlign: 'center' },
  retryBtn: {
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: Colors.primary,
  },

  actionBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderTopWidth: 1,
    borderTopColor: Colors.divider,
    paddingHorizontal: 16,
    paddingVertical: 12,
    paddingBottom: 28,
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 10,
  },
  actionBarInfo: { flex: 1, gap: 2 },
  actionBarCount: { fontSize: 13, fontWeight: '600', color: Colors.text },
  actionBarTotal: { fontSize: 16, fontWeight: '800', color: Colors.primary },
  rateBox: {
    alignItems: 'center',
    gap: 2,
  },
  rateLabel: { fontSize: 10, color: Colors.textSecondary, fontWeight: '600' },
  rateInput: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    fontSize: 14,
    fontWeight: '700',
    color: Colors.text,
    minWidth: 64,
    textAlign: 'center',
    backgroundColor: Colors.background,
  },
  generateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#DC2626',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  generateBtnDisabled: { opacity: 0.6 },
  generateBtnText: { color: Colors.white, fontWeight: '700', fontSize: 14 },

  paginationFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 18,
  },
  paginationText: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontWeight: '500',
  },

  // ── Summaries tab ──────────────────────────────────────────────────────────
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.divider,
    gap: 12,
  },
  summaryIndexBadge: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: Colors.primaryMuted,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  summaryIndexText: { fontSize: 12, fontWeight: '700', color: Colors.primary },
  rowBodyMain:      { flex: 1, gap: 4 },
  summaryDesc:      { fontWeight: '600', color: Colors.text },
  summaryMeta:      { flexDirection: 'row', alignItems: 'center', gap: 2 },
  summaryDot: {
    width: 3,
    height: 3,
    borderRadius: 2,
    backgroundColor: Colors.textLight,
    marginHorizontal: 4,
  },
  summaryRight:  { alignItems: 'flex-end', gap: 6 },

  // ── Saved summary detail modal ─────────────────────────────────────────────
  summaryPreviewSafe: { flex: 1, backgroundColor: Colors.background },
  summaryPreviewBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.divider,
    backgroundColor: Colors.surface,
    gap: 12,
  },
  summaryPreviewTitle: { flex: 1, textAlign: 'center' },
  summaryPrintBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: Colors.primary,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  summaryPrintBtnDisabled: { opacity: 0.55 },
  summaryPrintBtnText: { color: Colors.white, fontWeight: '700', fontSize: 13 },
});

// ─── Invoice modal styles ─────────────────────────────────────────────────────
const invItemCol = StyleSheet.create({
  name:  { flex: 1 },
  qty:   { width: 38, textAlign: 'center' },
  price: { width: 64, textAlign: 'right' },
  amt:   { width: 72, textAlign: 'right' },
  hdr:   { fontSize: 11, fontWeight: '600', color: '#64748B', textTransform: 'uppercase' },
  cell:  { fontSize: 13, color: '#1E293B' },
});

const invStyles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },

  infoCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    backgroundColor: Colors.surface, borderRadius: 14, padding: 16,
    marginBottom: 20, borderWidth: 1, borderColor: '#EDE9FE',
  },
  infoTitle: { fontSize: 15, fontWeight: '700', color: Colors.text },
  infoSub:   { fontSize: 13, color: Colors.textSecondary, lineHeight: 18 },
  rateRow:   { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  rateLabel: { fontSize: 12, fontWeight: '600', color: Colors.textSecondary },
  rateInput: {
    borderWidth: 1, borderColor: Colors.border, borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 4,
    fontSize: 14, fontWeight: '700', color: Colors.text,
    minWidth: 70, textAlign: 'center', backgroundColor: Colors.background,
  },

  sectionLabel: {
    fontSize: 11, fontWeight: '600', color: Colors.textSecondary,
    textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8, marginTop: 4,
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

const editStyles = StyleSheet.create({
  modalSafe: { flex: 1, backgroundColor: Colors.background },
  modalScroll: { flex: 1, paddingHorizontal: 16, paddingTop: 12 },
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  sectionLabel: {
    fontSize: 11, fontWeight: '600', color: Colors.textSecondary,
    textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8, marginTop: 4,
  },

  // Order card (mirrors MenuScreen Confirm Order template)
  orderCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
    marginBottom: 4,
  },
  orderCardCampus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.primaryMuted,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  orderCardCampusCode: {
    fontSize: 22,
    fontWeight: '900',
    color: Colors.primary,
    letterSpacing: 1,
  },
  orderCardCampusName: {
    flex: 1,
    fontSize: 13,
    color: Colors.textSecondary,
    fontWeight: '500',
  },
  orderCardDivider: {
    height: 1,
    backgroundColor: Colors.divider,
  },
  orderItemRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 10,
    position: 'relative',
  },
  orderItemImageBox: {
    width: 48,
    height: 48,
    borderRadius: 10,
    backgroundColor: '#F1F5F9',
    overflow: 'hidden',
    position: 'relative',
  },
  orderItemImage: {
    width: '100%',
    height: '100%',
  },
  orderItemImagePlaceholder: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F8FAFC',
  },
  orderItemIndexBadge: {
    position: 'absolute',
    top: 2,
    left: 2,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  orderItemIndexText: {
    fontSize: 10,
    fontWeight: '800',
    color: Colors.white,
  },
  orderItemNames: {
    flex: 1,
    gap: 2,
  },
  orderItemNameEn: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.text,
  },
  orderItemNameKh: {
    fontSize: 12,
    color: Colors.textSecondary,
  },
  orderItemCodeChip: {
    alignSelf: 'flex-start',
    backgroundColor: Colors.primaryMuted,
    borderRadius: 5,
    paddingHorizontal: 7,
    paddingVertical: 2,
    marginBottom: 3,
  },
  orderItemCodeText: {
    fontSize: 10,
    fontWeight: '700',
    color: Colors.primary,
    letterSpacing: 0.5,
  },
  orderItemRight: {
    alignItems: 'flex-end',
    gap: 2,
  },
  orderItemPrice: {
    fontSize: 15,
    fontWeight: '800',
    color: Colors.primary,
  },
  orderItemPriceOld: {
    fontSize: 12,
    color: Colors.textLight,
    textDecorationLine: 'line-through',
    textAlign: 'right',
  },
  orderItemUnit: {
    fontSize: 11,
    color: Colors.textLight,
  },
  removeItemBtn: {
    position: 'absolute',
    top: -4,
    right: -4,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: Colors.errorLight,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Per-item edit field rows
  itemFieldLeft: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  itemFieldLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.primary,
  },
  itemPriceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: `${Colors.primary}08`,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  priceInputWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 2,
    borderWidth: 1.5, borderColor: `${Colors.primary}40`, borderRadius: 8,
    backgroundColor: Colors.white, paddingHorizontal: 8, paddingVertical: 4,
  },
  priceInputPrefix: { fontSize: 13, fontWeight: '800', color: Colors.primary },
  priceInput: {
    fontSize: 13, fontWeight: '800', color: Colors.primary,
    padding: 0, minWidth: 50, textAlign: 'right',
  },

  // Per-item qty row
  itemQtyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: `${Colors.primary}08`,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  qtyPill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: `${Colors.primary}40`,
    borderRadius: 8,
    backgroundColor: Colors.white,
    overflow: 'hidden',
  },
  qtyPillBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: `${Colors.primary}10`,
  },
  qtyPillInput: {
    width: 44,
    height: 32,
    textAlign: 'center',
    fontSize: 14,
    fontWeight: '800',
    color: Colors.primary,
    padding: 0,
  },

  // Per-item discount row
  itemDiscountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F5F3FF',
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 8,
  },
  itemDiscountRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  itemDiscountLabel: { fontSize: 12, fontWeight: '600', color: '#7C3AED' },
  itemDiscountInputWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 2,
    borderWidth: 1, borderColor: '#C4B5FD', borderRadius: 8,
    backgroundColor: '#FFFFFF', paddingHorizontal: 8, paddingVertical: 4,
  },
  itemDiscountInput: {
    fontSize: 13, fontWeight: '800', color: '#7C3AED',
    padding: 0, minWidth: 30, textAlign: 'right',
  },
  itemDiscountPct: { fontSize: 12, fontWeight: '700', color: '#7C3AED' },
  itemDiscountSaving: {
    fontSize: 13, fontWeight: '700', color: '#7C3AED',
  },

  // Totals
  orderTotalsBox: {
    gap: 0,
  },
  orderTotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  orderTotalRowLabel: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontWeight: '500',
  },
  orderTotalRowValue: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.text,
  },
  discountLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  discountLabel: {
    fontSize: 13,
    color: '#7C3AED',
    fontWeight: '600',
  },
  discountValue: {
    fontSize: 14,
    fontWeight: '700',
    color: '#7C3AED',
  },
  orderItemsTotal: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  orderItemsTotalLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.text,
  },
  orderItemsTotalValue: {
    fontSize: 22,
    fontWeight: '900',
    color: Colors.primary,
  },

  // Add item button + picker
  addItemBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    backgroundColor: Colors.primaryMuted,
  },
  addItemBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.primary,
  },
  addItemSearchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 12,
    marginHorizontal: 16,
    marginTop: 12,
    height: 44,
  },
  addItemSearchInput: {
    flex: 1,
    fontSize: 14,
    color: Colors.text,
    padding: 0,
  },
  addItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 10,
    marginBottom: 8,
  },
  addItemRowSelected: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primaryMuted,
  },

  saveBar: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: Colors.divider,
  },

  // Inline full-screen overlay (Add Item / Campus picker)
  fullOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: Colors.background,
    zIndex: 20,
    elevation: 20,
  },

  // Inline save-confirm overlay
  confirmOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 20,
    elevation: 20,
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  confirmCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: Colors.surface,
    borderRadius: 24,
    paddingTop: 32,
    paddingBottom: 24,
    paddingHorizontal: 24,
    alignItems: 'center',
    shadowColor: Colors.black,
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.18,
    shadowRadius: 40,
    elevation: 20,
  },
  confirmIconCircle: {
    width: 68,
    height: 68,
    borderRadius: 34,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
    backgroundColor: Colors.primaryLight,
  },
  confirmTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 8,
    textAlign: 'center',
  },
  confirmMessage: {
    fontSize: 14,
    color: Colors.textSecondary,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 20,
  },
  confirmActions: {
    flexDirection: 'row',
    gap: 10,
    width: '100%',
  },
  confirmActionBtn: {
    flex: 1,
  },
});

export default SaleInvoiceListScreen;
