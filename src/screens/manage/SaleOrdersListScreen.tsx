import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  TextInput,
  ScrollView,
  Image,
  Modal,
  Dimensions,
  Platform,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { MaterialIcons as Icon } from '@expo/vector-icons';
import Colors from '../../theme/colors';
import AppText from '../../components/AppText';
import AppBar from '../../components/AppBar';
import { useAlert } from '../../components/AppAlert';
import { getSalesOrdersApi, getSalesOrderApi, getAllProductsApi, getCampusesApi, getSaleOrderSignaturesApi, updateSalesOrderStatusApi, createInvoiceHeaderApi, createSalesOrderApi, getUomsApi, ApiSalesOrder, ApiProduct, ApiCampus, ApiUom } from '../../services/focusApi';
import { notifyInvoiceCreated } from '../../services/fcmService';
import * as Print from 'expo-print';
import LOGO_BASE64 from '../../logo/logoBase64';
import DatePickerModal from '../../components/DatePickerModal';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import XLSX from 'xlsx';

interface Props {
  onBack: () => void;
}

type TabKey = 'all' | 'confirmed' | 'received' | 'invoiced';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'all',       label: 'All' },
  { key: 'confirmed', label: 'Confirmed' },
  { key: 'received',  label: 'Received' },
  { key: 'invoiced',  label: 'Invoiced' },
];

const STATUS_COLOR: Record<string, { bg: string; text: string; label: string }> = {
  draft:       { bg: '#FEF3C7', text: '#D97706', label: 'Draft' },
  prepare:     { bg: '#FEF3C7', text: '#D97706', label: 'Prepare' },
  prepared:    { bg: '#DBEAFE', text: '#2563EB', label: 'Prepared' },
  confirmed:   { bg: '#DBEAFE', text: '#2563EB', label: 'Confirmed' },
  sale_orders: { bg: '#DBEAFE', text: '#2563EB', label: 'Sale Order' },
  delivering:  { bg: '#ECFDF5', text: '#059669', label: 'Delivering' },
  received:    { bg: '#D1FAE5', text: '#10B981', label: 'Received' },
  invoiced:    { bg: '#EDE9FE', text: '#7C3AED', label: 'Invoiced' },
  delivered:   { bg: '#D1FAE5', text: '#10B981', label: 'Delivered' },
  cancelled:   { bg: '#FEE2E2', text: '#EF4444', label: 'Cancelled' },
};

const SIG_TYPE_COLOR: Record<string, { bg: string; text: string }> = {
  PREPARE:  { bg: '#FEF3C7', text: '#D97706' },
  CONFIRM:  { bg: '#DBEAFE', text: '#2563EB' },
  RECEIVED: { bg: '#D1FAE5', text: '#059669' },
};


// ─── SO PDF constants — A5, same style as invoice ───────────────────────────
const COMPANY = {
  name:       'FOCUS LAB',
  addr1:      '#17 St 480, Sangkat Toul Toum Pong 1',
  addr2:      'Khan Chamkarmon, Phnom Penh 12310',
  contact:    'SEN Sovithia  ·  0964222816  ·  sen.sov@gmail.com',
  abaAccount: '003 257 965',
  abaHolder:  'SOVITHIA SEN AND TONG LYHEANG<br/>AND TE SOPHIE',
};
const A5_PX = 559;
const A5_H  = 794;
const ROW_H = 22;

const fmtCents = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const toYMD = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const fmtDateBtn = (d: Date) =>
  d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

const fmtDate = (iso: string) => {
  try {
    const d = new Date(iso);
    return (
      d.toLocaleDateString('en-US', { day: 'numeric', month: 'numeric', year: '2-digit' }) +
      ' ' +
      d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })
    );
  } catch { return iso; }
};

const SO_CSS = `
  @page { size: A5 portrait; margin: 0; }
  *, *::before, *::after { margin:0; padding:0; box-sizing:border-box; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  html, body { width:${A5_PX}px; font-family:Arial,Helvetica,sans-serif; font-size:14px; color:#000; background:#fff; }
  .page { position:relative; width:${A5_PX}px; height:${A5_H}px; padding:20px 30px 185px; overflow:hidden; }
  .content { position:relative; }
  .hdr { display:flex; align-items:flex-start; margin-bottom:5px; gap:10px; }
  .logo { width:60px; height:60px; border-radius:10px; overflow:hidden; flex-shrink:0; }
  .logo img { width:60px; height:60px; display:block; }
  .hdr-mid { flex:1; text-align:center; }
  .co-name { font-size:15px; font-weight:900; letter-spacing:2px; text-transform:uppercase; }
  .co-addr { font-size:8px; color:#555; line-height:1.55; margin:2px 0 4px; }
  .so-title { font-size:16px; font-weight:900; text-decoration:underline; color:#2563EB; }
  .hdr-right { width:110px; text-align:right; flex-shrink:0; }
  .aba-label { font-size:8px; font-weight:700; color:#888; text-transform:uppercase; letter-spacing:0.5px; }
  .aba-num { font-size:11px; font-weight:800; color:#2563EB; margin:2px 0 1px; }
  .aba-name { font-size:6px; font-weight:600; line-height:1.4; word-break:break-word; }
  .hr { border:none; border-top:1.5px solid #000; margin:3px 0 4px; }
  .info-row { display:flex; border:1px solid #000; margin-bottom:5px; }
  .info-box { flex:1; padding:3px 8px; line-height:1.5; font-size:13px; }
  .info-box + .info-box { border-left:1px solid #000; }
  b { font-weight:700; }
  .tbl-wrap { border:1px solid #000; overflow:hidden; }
  table { width:100%; border-collapse:collapse; table-layout:fixed; }
  thead tr { height:26px; }
  thead th { background:#EFF6FF; border-bottom:1.5px solid #000; border-right:1px solid #000; padding:0 4px; font-size:15px; font-weight:700; text-align:center; height:26px; }
  thead th:last-child { border-right:none; }
  tbody tr { height:${ROW_H}px; }
  tbody td { height:${ROW_H}px; border:1px solid #d8d8d8; padding:0 5px; font-size:12px; vertical-align:middle; overflow:hidden; white-space:nowrap; }
  .c { text-align:center; } .r { text-align:right; } .l { text-align:left; }
  .no-badge { display:inline-block; width:18px; height:18px; line-height:18px; border-radius:4px; background:#EFF6FF; color:#2563EB; font-size:12px; font-weight:700; text-align:center; }
  .dash { font-size:14px; color:#c0c0c0; }
  .footer { position:absolute; bottom:0; left:0; right:0; padding:0 30px 14px; background:#fff; }
  .totals { border-top:1.5px solid #000; padding:4px 2px 5px; }
  .totals-row { display:flex; justify-content:flex-end; align-items:center; font-size:14px; padding:1.5px 0; }
  .totals-lbl { font-weight:600; padding-right:16px; min-width:80px; text-align:right; }
  .totals-val { width:70px; text-align:right; }
  .totals-disc .totals-val { color:#E53E3E; }
  .totals-grand { border-top:1px solid #aaa; margin-top:2px; padding-top:3px; font-size:15px; font-weight:800; }
  .sig-section { display:flex; margin-top:5px; }
  .sig-col { flex:1; text-align:center; font-size:14px; font-weight:600; padding:4px 5px 6px; }
  .sig-line { height:55px; overflow:hidden; margin:0 8px 4px; }
  .sig-lbl { border-top:1px solid #000; margin:0 8px; padding-top:4px; }
  .sig-img  { display:block; max-width:100%; max-height:120px; object-fit:contain; margin:4px auto 0; }
`;

// Build a single SO page div for one order
const buildInvoicePage = (
  order: ApiSalesOrder,
  productMap: Record<string, ApiProduct>,
  campusMap: Record<string, ApiCampus>,
  sigs: Array<{ url: string; type: string; createdAt?: string }> = [],
  forPrint = false,
  uomMap: Record<number, ApiUom> = {},
): string => {
  const colTypes: Record<number, string[]> = {
    1: ['PREPARE'],
    2: ['CONFIRM', 'CONFIRMED', 'CHECK', 'CHECK_BY'],
    3: ['RECEIVED', 'RECEIVE'],
  };
  const getSigUrl  = (col: 1 | 2 | 3): string =>
    sigs.find(s => colTypes[col].includes(s.type.toUpperCase()))?.url ?? '';
  const getSigDate = (col: 1 | 2 | 3): string => {
    const iso = sigs.find(s => colTypes[col].includes(s.type.toUpperCase()))?.createdAt;
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
    } catch { return ''; }
  };
  const sig1 = getSigUrl(1);  const date1 = getSigDate(1);
  const sig2 = getSigUrl(2);  const date2 = getSigDate(2);
  const sig3 = getSigUrl(3);  const date3 = getSigDate(3);

  const items = [...(order.items ?? [])].sort((a, b) => Number(a.id) - Number(b.id)).map((item, i) => {
    const product        = productMap[item.productId];
    const dis            = item.discountCents ?? 0;
    const lineCents      = item.qty * item.unitPriceCents;
    const totalCents     = lineCents - dis;
    const afterDiscCents = item.qty > 0 ? Math.round(totalCents / item.qty) : item.unitPriceCents;
    const disPct         = lineCents > 0 ? ((dis / lineCents) * 100).toFixed(1) : '0';
    const nameEn = item.productName ?? product?.nameEn ?? product?.sku ?? `Item ${i + 1}`;
    const nameKm = item.productNameKh ?? product?.nameKm ?? '';
    const description = nameKm ? `${nameKm} - ${nameEn}` : nameEn;
    const barcode = item.productCode ?? product?.sku ?? '';
    const unit    = (product?.uomId != null ? uomMap[product.uomId]?.code : undefined) ?? product?.unit ?? '';
    return { no: i + 1, description, barcode, unit, orinCents: item.unitPriceCents, disPct, qty: item.qty, afterDiscCents, totalCents };
  }).filter(it => it.qty > 0 && it.description.trim() !== '');

  const subtotalCents   = items.reduce((s, it) => s + it.qty * it.orinCents, 0);
  const discountCents   = items.reduce((s, it) => s + (it.qty * it.orinCents - it.totalCents), 0);
  const discPct         = subtotalCents > 0 ? ((discountCents / subtotalCents) * 100).toFixed(1) : '0';
  const grandTotalCents = order.totalCents != null ? order.totalCents : subtotalCents - discountCents;
  const hasDiscount     = discountCents > 0;

  const campusCode  = order.campusCode ?? order.campus?.campusCode ?? (order.campusId != null ? campusMap[String(order.campusId)]?.campusCode : null) ?? order.campusId ?? '—';
  const customerKh  = order.customerOrg?.nameKm ?? '';
  const customerEn  = order.customerOrgName ?? order.customerOrg?.nameEn ?? order.customerOrg?.name ?? '';
  const refNo       = order.referenceNumber ?? order.ref ?? order.orderNumber ?? order.id;

  const MAX_ROWS    = forPrint ? 0 : 12;
  const fillerCount = Math.max(0, MAX_ROWS - items.length);
  const fillerCols  = hasDiscount ? 9 : 7;
  const fillerRows  = Array.from({ length: fillerCount })
    .map(() => `<tr>${Array.from({ length: fillerCols }).map(() => '<td></td>').join('')}</tr>`)
    .join('');

  const dataRows = items.map(it => `
    <tr>
      <td class="c"><span class="no-badge">${it.no}</span></td>
      <td class="c" style="font-size:14px;">${it.barcode}</td>
      <td class="l">${it.description}</td>
      <td class="c">${it.unit || '—'}</td>
      ${hasDiscount ? `<td class="r">$${(it.orinCents / 100).toFixed(2)}</td>` : ''}
      ${hasDiscount ? `<td class="c" style="font-size:8px;">${parseFloat(it.disPct) > 0 ? `%${it.disPct}` : '<span class="dash">—</span>'}</td>` : ''}
      <td class="r">$${(it.afterDiscCents / 100).toFixed(2)}</td>
      <td class="c">${it.qty}</td>
      <td class="r">$${(it.totalCents / 100).toFixed(2)}</td>
    </tr>`).join('');

  const colgroup = hasDiscount
    ? `<colgroup><col style="width:50px"/><col style="width:120px"/><col/><col style="width:36px"/><col style="width:48px"/><col style="width:30px"/><col style="width:46px"/><col style="width:40px"/><col style="width:54px"/></colgroup>`
    : `<colgroup><col style="width:50px"/><col style="width:120px"/><col/><col style="width:40px"/><col style="width:56px"/><col style="width:40px"/><col style="width:64px"/></colgroup>`;

  const thead = hasDiscount
    ? `<tr><th>No</th><th>Barcode</th><th class="l">Description</th><th>Unit</th><th>Ori Price</th><th>Dis</th><th>Price</th><th>Qty</th><th>Amount</th></tr>`
    : `<tr><th>No</th><th>Barcode</th><th class="l">Description</th><th>Unit</th><th>Price</th><th>Qty</th><th>Amount</th></tr>`;

  return `
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
        <b>To:</b> ${campusCode}${customerKh ? `<br/><b>Customer:</b> ${customerKh}` : ''}${customerEn ? `<br/><span style="font-size:14px;">${customerEn}</span>` : ''}<br/>
        <b>Date:</b> ${fmtDate(order.createdAt)}${order.note ? `<br/><b>Note:</b> ${order.note}` : ''}
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
        <tbody>
          ${dataRows}
          ${fillerRows}
        </tbody>
      </table>
    </div>
    <div class="totals">
      <div class="totals-row"><span class="totals-lbl">Sub Total</span><span class="totals-val">${fmtCents(subtotalCents)}</span></div>
      ${hasDiscount ? `<div class="totals-row totals-disc"><span class="totals-lbl">Discount${parseFloat(discPct) > 0 ? ` (${discPct}%)` : ''}</span><span class="totals-val">- ${fmtCents(discountCents)}</span></div>` : ''}
      <div class="totals-row totals-grand"><span class="totals-lbl">Grand Total</span><span class="totals-val">${fmtCents(grandTotalCents)}</span></div>
    </div>
  </div>
  <div class="footer">
    <div class="sig-section">
      <div class="sig-col"><div class="sig-line">${sig1 ? `<img class="sig-img" src="${sig1}"/>` : ''}</div><div class="sig-lbl">Prepare By${date1 ? `<br/><span style="font-size:12px;font-weight:400;color:#555;">${date1}</span>` : ''}</div></div>
      <div class="sig-col"><div class="sig-line">${sig2 ? `<img class="sig-img" src="${sig2}"/>` : ''}</div><div class="sig-lbl">Check By${date2 ? `<br/><span style="font-size:12px;font-weight:400;color:#555;">${date2}</span>` : ''}</div></div>
      <div class="sig-col"><div class="sig-line">${sig3 ? `<img class="sig-img" src="${sig3}"/>` : ''}</div><div class="sig-lbl">Received By${date3 ? `<br/><span style="font-size:12px;font-weight:400;color:#555;">${date3}</span>` : ''}</div></div>
    </div>
  </div>
</div>`;
};

// Full multi-page HTML document — one SO page per order
const SO_PRINT_CSS = `
  @page { size: A4 portrait; margin: 10mm; }
  html, body { width:794px; font-size:14px; }
  .page { width:794px; height:277mm; padding:20px 40px 185px; overflow:hidden; }
  .content { position:relative; overflow:visible; }
  .footer { position:absolute; bottom:0; left:0; right:0; padding:0 40px 14px; background:#fff; }
  .co-name { font-size:15px; }
  .info-box { font-size:14px; }
  thead th { font-size:15px; }
  tbody td { font-size:12px; }
`;

const SO_PDF_CSS = `
  @page { margin: 0; }
  html, body { width:794px; font-size:14px; }
  .page { width:794px; min-height:auto; padding:58px 78px 58px 78px; overflow:visible; display:block; }
  .footer { position:relative; bottom:auto; left:auto; right:auto; padding:0 0 18px; margin-top:10px; }
  .co-name { font-size:15px; }
  .info-box { font-size:14px; }
  thead th { font-size:15px; }
  tbody td { font-size:12px; }
`;

const buildInvoiceHTML = (
  orders: ApiSalesOrder[],
  productMap: Record<string, ApiProduct>,
  sigsMap: Record<string, Array<{ url: string; type: string; createdAt?: string }>> = {},
  campusMap: Record<string, ApiCampus> = {},
  forPrint = false,
  previewWidth?: number,
  forPDF = false,
  uomMap: Record<number, ApiUom> = {},
): string => {
  const pages = orders.map(o => buildInvoicePage(o, productMap, campusMap, sigsMap[o.id] ?? [], forPrint || forPDF, uomMap)).join('\n');
  const extraCss = forPDF ? SO_PDF_CSS : forPrint ? SO_PRINT_CSS : '';
  if (previewWidth) {
    const scale     = previewWidth / A5_PX;
    const scaledH   = Math.round(A5_H * scale);
    const scalerCss = `html,body{width:${previewWidth}px;height:${scaledH}px;overflow:hidden;}
      .scaler{width:${A5_PX}px;height:${A5_H}px;transform:scale(${scale.toFixed(6)});transform-origin:top left;}`;
    return `<!DOCTYPE html><html><head><meta charset="UTF-8"/><style>${SO_CSS}</style><style>${extraCss}</style><style>${scalerCss}</style></head><body><div class="scaler">${pages}</div></body></html>`;
  }
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"/><style>${SO_CSS}</style><style>${extraCss}</style></head><body>${pages}</body></html>`;
};

// ─── Delivery Order HTML builder (A4) — from SO data ────────────────────────
const DO_A4_W = 794;
const DO_A4_H = 1120;
const DO_ROW_H   = 26;
const DO_THEAD_H = 28;
const DO_NON_TABLE = 420;
const DO_MAX_ROWS  = 17;

const DO_CSS = `
  @page{size:A4 portrait;margin:0;}
  *,*::before,*::after{margin:0;padding:0;box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
  html,body{margin:0;padding:0;width:${DO_A4_W}px;font-family:Arial,Helvetica,sans-serif;font-size:10px;color:#000;background:#fff;}
  .page{display:flex;flex-direction:column;width:${DO_A4_W}px;padding:24px 30px 24px;}
  .content{flex:1;}
  .hdr{display:flex;align-items:flex-start;margin-bottom:5px;gap:10px;}
  .logo{width:60px;height:60px;border-radius:10px;overflow:hidden;flex-shrink:0;}
  .logo img{width:60px;height:60px;display:block;}
  .hdr-mid{flex:1;text-align:center;}
  .co-name{font-size:14px;font-weight:900;letter-spacing:2px;text-transform:uppercase;}
  .co-addr{font-size:8px;color:#555;line-height:1.55;margin:2px 0 4px;}
  .do-title{font-size:16px;font-weight:900;text-decoration:underline;color:#059669;}
  .hdr-right{width:110px;text-align:right;flex-shrink:0;}
  .hr{border:none;border-top:1.5px solid #000;margin:3px 0 4px;}
  .info-row{display:flex;border:1px solid #000;margin-bottom:5px;}
  .info-box{flex:1;padding:4px 8px;line-height:1.7;font-size:10px;}
  .info-box+.info-box{border-left:1px solid #000;}
  b{font-weight:700;}
  .tbl-wrap{border:1px solid #000;overflow:hidden;}
  table{width:100%;border-collapse:collapse;table-layout:fixed;}
  thead tr{height:${DO_THEAD_H}px;}
  thead th{background:#EFF6FF;border-bottom:1.5px solid #000;border-right:1px solid #000;padding:0 4px;font-size:10px;font-weight:700;text-align:center;height:${DO_THEAD_H}px;}
  thead th:last-child{border-right:none;}
  tbody tr{height:${DO_ROW_H}px;}
  tbody td{height:${DO_ROW_H}px;border:1px solid #d8d8d8;padding:0 5px;font-size:14px;vertical-align:middle;overflow:hidden;white-space:nowrap;}
  .c{text-align:center;}.r{text-align:right;}.l{text-align:left;text-overflow:ellipsis;}
  .sm{font-size:8px;}
  .footer{flex-shrink:0;padding:0 0 28px;background:#fff;margin-top:120px;}
  .sig-section{border:1px solid #000;display:flex;margin-top:5px;}
  .sig-col{flex:1;text-align:center;font-size:10px;font-weight:600;padding:8px 5px 10px;border-right:1px solid #000;}
  .sig-col:last-child{border-right:none;}
  .sig-line{border:1px solid #000;border-radius:4px;margin:5px 8px 8px;height:120px;overflow:hidden;}
  .sig-img{display:block;max-width:100%;max-height:110px;object-fit:contain;margin:4px auto 0;}
  .note-row{font-size:9px;margin-bottom:5px;padding:4px 6px;border:1px solid #ddd;border-radius:4px;color:#444;}
`;

const fmtDODate = (iso: string | null | undefined) => {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { day: 'numeric', month: 'numeric', year: '2-digit' }) + ' ' +
      d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  } catch { return String(iso); }
};

const buildDOPage = (
  refNo: string,
  campusVal: string,
  dateStr: string,
  receivedBy: string,
  note: string,
  rows: Array<{ no: number; barcode: string; desc: string; size: string; qty: number }>,
): string => {
  const totalQty   = rows.reduce((s, r) => s + r.qty, 0);
  const fillerRows = Array.from({ length: Math.max(0, DO_MAX_ROWS - rows.length) })
    .map(() => `<tr><td></td><td></td><td></td><td></td><td></td></tr>`).join('');
  const dataRows = rows.map(it => `
    <tr>
      <td class="c">${it.no}</td>
      <td class="c">${it.barcode}</td>
      <td class="l">${it.desc}</td>
      <td class="c">${it.size}</td>
      <td class="c">${it.qty}</td>
    </tr>`).join('');
  const totalRow = `
    <tr style="background:#f0f4ff;border-top:2px solid #000;">
      <td colspan="4" style="text-align:right;font-weight:700;font-size:11px;padding:0 8px;height:32px;vertical-align:middle;border-right:1px solid #d8d8d8;">Total Qty</td>
      <td class="c" style="font-weight:900;font-size:16px;height:32px;vertical-align:middle;color:#1e40af;">${totalQty}</td>
    </tr>`;
  return `
<div class="page">
  <div class="content">
    <div class="hdr">
      <div class="logo"><img src="${LOGO_BASE64}"/></div>
      <div class="hdr-mid">
        <div class="co-name">${COMPANY.name}</div>
        <div class="co-addr">${COMPANY.addr1}<br/>${COMPANY.addr2}<br/>${COMPANY.contact}</div>
        <div class="do-title">DELIVERY ORDER</div>
      </div>
      <div class="hdr-right"></div>
    </div>
    <div class="hr"></div>
    <div class="info-row">
      <div class="info-box"><b>To:</b> ${campusVal}<br/><b>Date:</b> ${dateStr}</div>
      <div class="info-box"><b>Ref No:</b> ${refNo}<br/><b>Received By:</b> ${receivedBy || '—'}</div>
    </div>
    <div class="tbl-wrap">
      <table>
        <colgroup><col style="width:22px"/><col style="width:120px"/><col/><col style="width:50px"/><col style="width:40px"/></colgroup>
        <thead><tr><th>No</th><th>Barcode</th><th class="l">Description</th><th>Size</th><th>Qty</th></tr></thead>
        <tbody>${dataRows}${fillerRows}${totalRow}</tbody>
      </table>
    </div>
  </div>
  <div class="footer">
    ${note ? `<div class="note-row"><b>Note:</b> ${note}</div>` : ''}
    <div class="sig-section">
      <div class="sig-col"><div class="sig-line"></div>Prepare By</div>
      <div class="sig-col"><div class="sig-line"></div>Delivered By</div>
      <div class="sig-col"><div class="sig-line"></div>Received By</div>
    </div>
  </div>
</div>`;
};

// Build DO HTML from a Sale Order (status: sale_order / confirmed)
const buildDOFromSOHTML = (
  order: ApiSalesOrder,
  productMap: Record<string, ApiProduct>,
  campusMap: Record<string, ApiCampus>,
): string => {
  const refNo     = order.referenceNumber ?? order.ref ?? order.orderNumber ?? order.id;
  const campusVal = order.campusCode ?? order.campus?.campusCode ??
    (order.campusId != null ? campusMap[String(order.campusId)]?.campusCode ?? String(order.campusId) : '—');
  const dateStr   = fmtDODate(order.createdAt);

  const rows = (order.items ?? []).map((item, i) => {
    const product = productMap[item.productId];
    const nameEn  = item.productName ?? item.productNameKh ?? product?.nameEn ?? `Item ${i + 1}`;
    const nameKm  = product?.nameKm ?? '';
    const desc    = nameKm ? `${nameKm} - ${nameEn}` : nameEn;
    return { no: i + 1, barcode: item.productCode ?? product?.sku ?? '', desc, size: product?.size ?? '', qty: item.qty };
  });

  const page = buildDOPage(refNo, campusVal, dateStr, '', order.note ?? '', rows);
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"/>
<meta name="viewport" content="width=${DO_A4_W},initial-scale=1.0"/>
<style>${DO_CSS}</style></head><body>${page.trim()}</body></html>`;
};

// Pure-JS ArrayBuffer → base64 fallback (used when global.Buffer is unavailable)
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

// ─── Order helpers ───────────────────────────────────────────────────────────
const calcTotal = (order: ApiSalesOrder): number => {
  if (order.totalCents != null) return order.totalCents / 100;
  if (!Array.isArray(order.items) || order.items.length === 0) return 0;
  return order.items.reduce(
    (sum, item) => sum + item.qty * item.unitPriceCents - (item.discountCents ?? 0),
    0,
  ) / 100;
};

const formatDate = (iso: string): string => {
  try {
    return new Date(iso).toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch { return iso; }
};

const PAGE_SIZE = 20;

// ─── Screen ──────────────────────────────────────────────────────────────────
const SaleOrdersListScreen: React.FC<Props> = ({ onBack }) => {
  const { showAlert } = useAlert();
  const [orders, setOrders]           = useState<ApiSalesOrder[]>([]);
  const [loading, setLoading]         = useState(true);
  const [refreshing, setRefreshing]   = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [search, setSearch]           = useState('');
  const [activeTab, setActiveTab]     = useState<TabKey>('all');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [exporting, setExporting]     = useState(false);
  const [importing, setImporting]     = useState(false);
  const [printing, setPrinting]       = useState(false);
  const [printingDO, setPrintingDO]   = useState(false);
  const [generating, setGenerating]   = useState(false);
  const [rateUsed, setRateUsed]       = useState('4100');
  const [campusMap, setCampusMap]     = useState<Record<string, ApiCampus>>({});
  const [sigMap, setSigMap]           = useState<Record<string, Array<{ url: string; type: string; createdAt: string }>>>({});

  // Confirm Generate Invoice modal
  type InvGroup = { customerOrgId: string; campusId: string | number; locationId?: string | number; soIds: string[] };
  const [confirmVisible, setConfirmVisible]   = useState(false);
  const [confirmGroups, setConfirmGroups]     = useState<InvGroup[]>([]);
  const [confirmOrders, setConfirmOrders]     = useState<ApiSalesOrder[]>([]);
  const [invoiceIssuedAt, setInvoiceIssuedAt] = useState<Date>(new Date());
  const [invoiceDueAt, setInvoiceDueAt]       = useState<Date | null>(null);
  const [invoiceNote, setInvoiceNote]         = useState('');
  const [datePickerFor, setDatePickerFor]     = useState<'issued' | 'due' | null>(null);

  // Preview modal
  const [previewHtml, setPreviewHtml]         = useState<string>('');
  const [previewLoading, setPreviewLoading]   = useState(false);

  const [displayPage, setDisplayPage] = useState(1);
  useEffect(() => { setDisplayPage(1); }, [activeTab, search]);

  const load = useCallback((silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    Promise.all([
      getSalesOrdersApi(),
      getCampusesApi().catch(() => [] as ApiCampus[]),
    ])
      .then(([data, campuses]) => {
        setOrders(data);
        const cMap: Record<string, ApiCampus> = {};
        campuses.forEach(c => { cMap[String(c.id)] = c; });
        setCampusMap(cMap);

        // Fetch all signatures for each order in parallel
        Promise.all(data.map(o => getSaleOrderSignaturesApi(o.id))).then(results => {
          const sMap: Record<string, Array<{ url: string; type: string; createdAt: string }>> = {};
          results.forEach((sigs, i) => {
            if (sigs.length === 0) return;
            sMap[data[i].id] = [...sigs]
              .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
              .map(s => ({ url: s.signatureUrl, type: s.type, createdAt: s.createdAt }));
          });
          setSigMap(sMap);
        }).catch(() => {});
      })
      .catch(err => setError(err?.message ?? 'Failed to load sale orders'))
      .finally(() => { setLoading(false); setRefreshing(false); });
  }, []);

  useEffect(() => { load(); }, [load]);

  const onRefresh = () => { setRefreshing(true); load(true); };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return orders.filter(o => {
      const statusKey = (o.status ?? '').toLowerCase();
      if (activeTab !== 'all') {
        let match = false;
        if (activeTab === 'confirmed') match = statusKey === 'confirmed' || statusKey === 'sale_orders' || statusKey === 'prepare';
        else if (activeTab === 'received') match = statusKey === 'received';
        else if (activeTab === 'invoiced') match = statusKey === 'invoiced' || statusKey === 'paid';
        if (!match) return false;
      }
      if (q && !(
        (o.ref ?? o.referenceNumber ?? o.orderNumber ?? '').toLowerCase().includes(q) ||
        statusKey.includes(q)
      )) return false;
      return true;
    });
  }, [orders, search, activeTab]);

  const summary = useMemo(() => {
    let confirmed = 0, received = 0, invoice = 0, grandTotal = 0;
    for (const o of orders) {
      const amt = calcTotal(o);
      const s   = (o.status ?? '').toLowerCase();
      grandTotal += amt;
      if (s === 'confirmed' || s === 'sale_orders' || s === 'prepare') confirmed += amt;
      if (s === 'received') received += amt;
      if (s === 'invoiced' || s === 'paid') invoice += amt;
    }
    return { confirmed, received, invoice, grandTotal };
  }, [orders]);

  const displayedOrders = useMemo(() => filtered.slice(0, displayPage * PAGE_SIZE), [filtered, displayPage]);

  const handleEndReached = useCallback(() => {
    if (displayedOrders.length < filtered.length) setDisplayPage(p => p + 1);
  }, [displayedOrders.length, filtered.length]);

  const renderListFooter = useCallback(() => {
    if (displayedOrders.length >= filtered.length) return null;
    return (
      <View style={styles.paginationFooter}>
        <ActivityIndicator size="small" color={Colors.primary} />
        <AppText style={styles.paginationText}>{displayedOrders.length} of {filtered.length}</AppText>
      </View>
    );
  }, [displayedOrders.length, filtered.length]);

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set<string>();
      prev.forEach(v => next.add(v));
      if (next.has(id)) { next.delete(id); } else { next.add(id); }
      return next;
    });
  };

  const getTargetOrders = () =>
    selectedIds.size > 0
      ? filtered.filter(o => selectedIds.has(o.id))
      : filtered;

  // Fetch a remote image URL and return a base64 data URI (for PDF embedding)
  const fetchImageBase64 = async (url: string): Promise<string | null> => {
    try {
      const res         = await fetch(url);
      const arrayBuffer = await res.arrayBuffer();
      const base64      = _arrayBufferToBase64(arrayBuffer);
      const contentType = res.headers.get('content-type') ?? 'image/png';
      return `data:${contentType};base64,${base64}`;
    } catch (e) {
      return null;
    }
  };

  // Returns one PDF file path per selected order
  const buildAndExport = async (): Promise<string[]> => {
    const target = getTargetOrders();

    // Fetch everything fresh — doMap state may be stale
    const [fullOrders, products, campuses, uoms] = await Promise.all([
      Promise.all(target.map(o => getSalesOrderApi(o.id).catch(() => o))),
      getAllProductsApi().catch(() => [] as ApiProduct[]),
      getCampusesApi().catch(() => [] as ApiCampus[]),
      getUomsApi().catch(() => [] as ApiUom[]),
    ]);

    const productMap: Record<string, ApiProduct> = {};
    products.forEach(p => { productMap[p.id] = p; });

    const campusMap: Record<string, ApiCampus> = {};
    campuses.forEach(c => { campusMap[c.id] = c; });

    const uomMap: Record<number, ApiUom> = {};
    uoms.forEach(u => { uomMap[u.id] = u; });

    // Fetch all signatures per order
    const sigResults = await Promise.all(
      fullOrders.map(o => getSaleOrderSignaturesApi(o.id))
    );

    // Convert every signature URL to base64 for PDF embedding
    const freshSigsMap: Record<string, Array<{ url: string; type: string }>> = {};
    for (let i = 0; i < fullOrders.length; i++) {
      const rawSigs = sigResults[i];
      if (rawSigs.length === 0) continue;
      freshSigsMap[fullOrders[i].id] = await Promise.all(
        rawSigs.map(async sig => ({
          type: sig.type,
          url:  (await fetchImageBase64(sig.signatureUrl)) ?? sig.signatureUrl,
        }))
      );
    }

    // One PDF per order (sequential to avoid file-system conflicts)
    const paths: string[] = [];
    for (const order of fullOrders) {
      const orderSigs = freshSigsMap[order.id] ?? [];
      const html = buildInvoiceHTML([order], productMap, { [order.id]: orderSigs }, campusMap, false, undefined, true, uomMap);
      const campusCode = order.campusId ? (campusMap[String(order.campusId)]?.campusCode ?? order.campusId) : '';
      const refPart   = order.referenceNumber ?? order.ref ?? order.id;
      const nameParts = [campusCode, refPart].filter(Boolean).join('-');
      const name      = `${nameParts.replace(/[^a-zA-Z0-9]/g, '-')}-${Date.now()}`;
      const result    = await Print.printToFileAsync({ html, width: 794, height: 1123 });
      paths.push(result.uri);
    }
    return paths;
  };

  /* ── Excel export ── */
  const XLS_HEADERS = ['Ref #', 'Status', 'Campus', 'Customer', 'Order Date', 'Note', 'Received By', 'SKU', 'Product', 'Qty', 'Unit Price (USD)', 'Discount (USD)', 'Line Total (USD)', 'Order Total (USD)'];

  const handleExportXLSX = async () => {
    const target = getTargetOrders();
    if (target.length === 0) { showAlert({ type: 'info', title: 'No Orders', message: 'Select orders to export.' }); return; }
    setExporting(true);
    try {
      const [fullOrders, products, campuses] = await Promise.all([
        Promise.all(target.map(o => getSalesOrderApi(o.id).catch(() => o))),
        getAllProductsApi().catch(() => [] as ApiProduct[]),
        getCampusesApi().catch(() => [] as ApiCampus[]),
      ]);
      const productMap: Record<string, ApiProduct> = {};
      products.forEach(p => { productMap[p.id] = p; });
      const campusMap: Record<string, ApiCampus> = {};
      campuses.forEach(c => { campusMap[c.id] = c; });

      const rows: string[][] = [];
      for (const o of fullOrders) {
        const campus   = o.campusCode ?? campusMap[String(o.campusId)]?.campusCode ?? String(o.campusId ?? '');
        const customer = o.customerOrgName ?? o.customerOrg?.nameEn ?? o.customerOrg?.name ?? String(o.customerOrgId ?? '');
        const date     = o.orderDate ?? o.soDate ?? o.createdAt ?? '';
        const totalUSD = (calcTotal(o) / 100).toFixed(2);
        const items    = o.items ?? [];
        if (items.length === 0) {
          rows.push([o.referenceNumber ?? o.id, (o.status ?? '').toUpperCase(), campus, customer, date, o.note ?? '', o.receivedBy ?? '', '', '', '', '', '', '', totalUSD]);
        } else {
          items.forEach((item, idx) => {
            const prod     = productMap[item.productId];
            const sku      = item.productCode ?? prod?.sku ?? '';
            const name     = item.productName ?? prod?.nameEn ?? '';
            const qty      = String(item.qty);
            const unitUSD  = (item.unitPriceCents / 100).toFixed(2);
            const disUSD   = ((item.discountCents ?? 0) / 100).toFixed(2);
            const lineUSD  = ((item.qty * item.unitPriceCents - (item.discountCents ?? 0)) / 100).toFixed(2);
            rows.push([
              idx === 0 ? (o.referenceNumber ?? o.id) : '',
              idx === 0 ? (o.status ?? '').toUpperCase() : '',
              idx === 0 ? campus   : '',
              idx === 0 ? customer : '',
              idx === 0 ? date     : '',
              idx === 0 ? (o.note ?? '')       : '',
              idx === 0 ? (o.receivedBy ?? '') : '',
              sku, name, qty, unitUSD, disUSD, lineUSD,
              idx === 0 ? totalUSD : '',
            ]);
          });
        }
      }

      const ws = XLSX.utils.aoa_to_sheet([XLS_HEADERS, ...rows]);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Sale Orders');
      const wbout: string = XLSX.write(wb, { bookType: 'xlsx', type: 'base64' });
      const path = `${FileSystem.documentDirectory}sale_orders_export.xlsx`;
      await FileSystem.writeAsStringAsync(path, wbout, { encoding: FileSystem.EncodingType.Base64 });
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) await Sharing.shareAsync(path, { mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', dialogTitle: 'Export Sale Orders' });
    } catch (err: any) {
      if (err?.message !== 'User did not share') {
        showAlert({ type: 'error', title: 'Export Failed', message: err?.message ?? 'Could not export.' });
      }
    } finally {
      setExporting(false);
    }
  };

  /* ── Excel import ── */
  // Template: Order Key | Campus Code | Customer Org ID | Order Date | Note | Received By | SKU | Qty | Unit Price (USD) | Discount (USD)
  const handleImportXLSX = async () => {
    try {
      const pickerRes = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
      if (pickerRes.canceled) return;
      const file = pickerRes.assets[0];
      const filename = file.name ?? decodeURIComponent(file.uri).split(/[/?#]/).pop() ?? '';
      const ext = filename.split('.').pop()?.toLowerCase() ?? '';
      const isXlsx = ['xlsx', 'xls'].includes(ext) || (file.mimeType ?? '').includes('spreadsheet') || (file.mimeType ?? '').includes('excel');
      if (!isXlsx) { showAlert({ type: 'error', title: 'Invalid File', message: 'Please select an .xlsx or .xls file.' }); return; }

      let wb: XLSX.WorkBook;
      try {
        const res = await fetch(file.uri);
        if (!res.ok) throw new Error(`fetch ${res.status}`);
        wb = XLSX.read(new Uint8Array(await res.arrayBuffer()), { type: 'array' });
      } catch {
        wb = XLSX.read(await FileSystem.readAsStringAsync(file.uri, { encoding: FileSystem.EncodingType.Base64 }), { type: 'base64' });
      }
      if (!wb.SheetNames.length) throw new Error('Excel file has no sheets.');
      const ws = wb.Sheets[wb.SheetNames[0]];
      const allRows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' }) as string[][];
      if (allRows.length < 2) { showAlert({ type: 'error', title: 'Empty File', message: 'File must have a header row and at least one data row.' }); return; }

      const rawHeader = allRows[0].map(h => String(h).replace(/^﻿/, '').toLowerCase().replace(/[\s_-]/g, ''));
      const col = (name: string) => rawHeader.indexOf(name);

      const required = ['orderkey', 'campuscode', 'customerorgid', 'sku', 'qty', 'unitpriceusd'];
      const missing  = required.filter(k => col(k) === -1);
      if (missing.length > 0) {
        showAlert({ type: 'error', title: 'Header Mismatch', message: `Missing columns: ${missing.join(', ')}\n\nDetected: ${rawHeader.join(', ')}` });
        return;
      }

      const dataRows = allRows.slice(1).filter(r => r.some(v => String(v).trim()));

      // Load products and campuses for mapping
      const [products, campuses] = await Promise.all([
        getAllProductsApi().catch(() => [] as ApiProduct[]),
        getCampusesApi().catch(() => [] as ApiCampus[]),
      ]);
      const skuMap: Record<string, ApiProduct>  = {};
      products.forEach(p => { if (p.sku) skuMap[p.sku.toLowerCase()] = p; });
      const codeMap: Record<string, ApiCampus> = {};
      campuses.forEach(c => { if (c.campusCode) codeMap[c.campusCode.toLowerCase()] = c; });

      // Group rows by Order Key
      const groups: Record<string, { campusCode: string; customerOrgId: string; orderDate: string; note: string; receivedBy: string; items: Array<{ productId: number; qty: number; unitPriceCents: number; discountCents?: number }> }> = {};
      const errors: string[] = [];
      dataRows.forEach((row, i) => {
        const key        = String(row[col('orderkey')] ?? '').trim();
        const campusCode = String(row[col('campuscode')] ?? '').trim();
        const orgId      = String(row[col('customerorgid')] ?? '').trim();
        const date       = String(row[col('orderdate') > -1 ? col('orderdate') : -1] ?? '').trim();
        const note       = col('note') > -1 ? String(row[col('note')] ?? '').trim() : '';
        const receivedBy = col('receivedby') > -1 ? String(row[col('receivedby')] ?? '').trim() : '';
        const sku        = String(row[col('sku')] ?? '').trim();
        const qty        = parseInt(String(row[col('qty')] ?? '0'), 10) || 0;
        const unitUSD    = parseFloat(String(row[col('unitpriceusd')] ?? '0').replace(/[^0-9.]/g, '')) || 0;
        const disUSD     = col('discountusd') > -1 ? parseFloat(String(row[col('discountusd')] ?? '0').replace(/[^0-9.]/g, '')) || 0 : 0;

        if (!key) { errors.push(`Row ${i + 2}: missing Order Key`); return; }
        const prod = skuMap[sku.toLowerCase()];
        if (!prod) { errors.push(`Row ${i + 2}: SKU "${sku}" not found`); return; }
        if (qty <= 0) { errors.push(`Row ${i + 2}: invalid qty "${qty}"`); return; }

        if (!groups[key]) {
          const campus = codeMap[campusCode.toLowerCase()];
          if (!campus) { errors.push(`Row ${i + 2}: campus code "${campusCode}" not found`); return; }
          groups[key] = { campusCode, customerOrgId: orgId, orderDate: date, note, receivedBy, items: [] };
          (groups[key] as any)._campusId = campus.id;
        }
        groups[key].items.push({
          productId:      Number(prod.id),
          qty,
          unitPriceCents: Math.round(unitUSD * 100),
          discountCents:  disUSD > 0 ? Math.round(disUSD * 100) : undefined,
        });
      });

      if (errors.length > 0) {
        showAlert({ type: 'error', title: 'Import Errors', message: errors.slice(0, 5).join('\n') + (errors.length > 5 ? `\n…and ${errors.length - 5} more` : '') });
        return;
      }

      const orderCount = Object.keys(groups).length;
      showAlert({
        type: 'confirm',
        title: 'Import Sale Orders',
        message: `Create ${orderCount} sale order${orderCount !== 1 ? 's' : ''} from this file?`,
        actions: [
          { label: 'Cancel', variant: 'outline' },
          {
            label: 'Import', variant: 'primary',
            onPress: async () => {
              setImporting(true);
              let created = 0;
              const failed: string[] = [];
              for (const [key, g] of Object.entries(groups)) {
                try {
                  await createSalesOrderApi({
                    campusId:      (g as any)._campusId,
                    customerOrgId: g.customerOrgId,
                    orderDate:     g.orderDate || undefined,
                    soDate:        g.orderDate || undefined,
                    note:          g.note || undefined,
                    receivedBy:    g.receivedBy || undefined,
                    items:         g.items,
                  });
                  created++;
                } catch (e: any) {
                  failed.push(`${key}: ${e?.message ?? 'failed'}`);
                }
              }
              setImporting(false);
              load(true);
              const msg = `Created ${created} order${created !== 1 ? 's' : ''}.` + (failed.length ? `\nFailed: ${failed.join(', ')}` : '');
              showAlert({ type: created > 0 ? 'success' : 'error', title: 'Import Complete', message: msg });
            },
          },
        ],
      });
    } catch (err: any) {
      showAlert({ type: 'error', title: 'Import Failed', message: err?.message ?? 'Could not read file.' });
    }
  };

  const handleExportPDF = async () => {
    const target = getTargetOrders();
    if (target.length === 0) { showAlert({ type: 'info', title: 'No Orders', message: 'Nothing to export.' }); return; }
    setExporting(true);
    try {
      const paths = await buildAndExport();
      // Open share sheet for each file — user can pick Telegram, Save to Files, etc.
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        for (const path of paths) {
          await Sharing.shareAsync(path, { mimeType: 'application/pdf', dialogTitle: 'Sale Order Invoice' });
        }
      }
    } catch (err: any) {
      showAlert({ type: 'error', title: 'Export Error', message: err?.message ?? 'Failed to export PDF' });
    } finally {
      setExporting(false);
    }
  };

  const handlePrintPDF = async () => {
    const target = getTargetOrders();
    if (target.length === 0) { showAlert({ type: 'info', title: 'No Orders', message: 'Nothing to print.' }); return; }
    setPrinting(true);
    try {
      const { fullOrders, productMap: pMap, sigResults } = await buildAndExport().then(() => ({} as any)).catch(() => null) ?? {};
      // Re-fetch since buildAndExport returns paths not data — rebuild HTML directly
      const soIds = target.map(o => o.id);
      const [fullOs, products, campuses, uomsLocal] = await Promise.all([
        Promise.all(soIds.map(id => getSalesOrderApi(id))),
        getAllProductsApi().catch(() => [] as ApiProduct[]),
        getCampusesApi().catch(() => [] as ApiCampus[]),
        getUomsApi().catch(() => [] as ApiUom[]),
      ]);
      const pMapLocal: Record<string, ApiProduct> = {};
      products.forEach(p => { pMapLocal[p.id] = p; });
      const cMapLocal: Record<string, ApiCampus> = {};
      campuses.forEach(c => { cMapLocal[String(c.id)] = c; });
      const uomMapLocal: Record<number, ApiUom> = {};
      uomsLocal.forEach(u => { uomMapLocal[u.id] = u; });
      const sigResultsLocal = await Promise.all(
        fullOs.map(o => getSaleOrderSignaturesApi(o.id).catch(() => [])),
      );
      const sigsMap: Record<string, Array<{ url: string; type: string; createdAt?: string }>> = {};
      for (let i = 0; i < fullOs.length; i++) {
        const raw = sigResultsLocal[i];
        if (raw.length === 0) continue;
        sigsMap[fullOs[i].id] = await Promise.all(
          raw.map(async sig => ({
            type: sig.type,
            createdAt: sig.createdAt,
            url: (await fetchImageBase64(sig.signatureUrl)) ?? sig.signatureUrl,
          })),
        );
      }
      const html = buildInvoiceHTML(fullOs, pMapLocal, sigsMap, cMapLocal, true, undefined, false, uomMapLocal);
      await Print.printAsync({ html });
    } catch (err: any) {
      if (err?.message !== 'User cancelled') {
        showAlert({ type: 'error', title: 'Print Error', message: err?.message ?? 'Failed to print' });
      }
    } finally {
      setPrinting(false);
    }
  };

  const handlePrintDelivery = async () => {
    const target = getTargetOrders();
    if (target.length === 0) { showAlert({ type: 'info', title: 'No Orders', message: 'Select orders first.' }); return; }
    setPrintingDO(true);
    try {
      // Fetch full SO details (with items) + lookup maps
      const [fullOrders, products, campuses] = await Promise.all([
        Promise.all(target.map(o => getSalesOrderApi(o.id).catch(() => o))),
        getAllProductsApi().catch(() => [] as ApiProduct[]),
        getCampusesApi().catch(() => [] as ApiCampus[]),
      ]);
      const pMap: Record<string, ApiProduct> = {};
      products.forEach(p => { pMap[p.id] = p; });
      const cMap: Record<string, ApiCampus> = {};
      campuses.forEach(c => { cMap[String(c.id)] = c; });

      // Build one DO page per SO using the SO's own items
      const pages = fullOrders.map(so => {
        const refNo     = so.referenceNumber ?? so.ref ?? so.orderNumber ?? so.id;
        const campusVal = so.campusCode ?? so.campus?.campusCode ??
          (so.campusId != null ? cMap[String(so.campusId)]?.campusCode ?? String(so.campusId) : '—');
        const rows = (so.items ?? []).map((item, i) => {
          const product = pMap[item.productId];
          const nameEn  = item.productName ?? item.productNameKh ?? product?.nameEn ?? `Item ${i + 1}`;
          const nameKm  = product?.nameKm ?? '';
          const desc    = nameKm ? `${nameKm} - ${nameEn}` : nameEn;
          return { no: i + 1, barcode: item.productCode ?? product?.sku ?? '', desc, size: product?.size ?? '', qty: item.qty };
        });
        return buildDOPage(refNo, campusVal, fmtDODate(so.createdAt), '', so.note ?? '', rows);
      });

      const combinedHTML = `<!DOCTYPE html><html><head><meta charset="UTF-8"/>
<meta name="viewport" content="width=${DO_A4_W},initial-scale=1.0"/>
<style>${DO_CSS}.page:not(:last-child){page-break-after:always;}</style>
</head><body>${pages.join('').trim()}</body></html>`;

      await Print.printAsync({ html: combinedHTML });
    } catch (err: any) {
      if (err?.message !== 'User cancelled') {
        showAlert({ type: 'error', title: 'Print Error', message: err?.message ?? 'Failed to print delivery orders' });
      }
    } finally {
      setPrintingDO(false);
    }
  };

  const selectedReceivedIds = useMemo(() =>
    filtered
      .filter(o => selectedIds.has(o.id) && (o.status ?? '').toLowerCase() === 'received')
      .map(o => o.id),
  [filtered, selectedIds]);

  const selectedReceivedTotal = useMemo(() =>
    filtered
      .filter(o => selectedIds.has(o.id) && (o.status ?? '').toLowerCase() === 'received')
      .reduce((s, o) => s + calcTotal(o), 0),
  [filtered, selectedIds]);

  const handleGenerateInvoice = () => {
    const count = selectedReceivedIds.length;
    if (count === 0) return;

    const groupRecord: Record<string, InvGroup> = {};
    const selectedOrders: ApiSalesOrder[] = [];

    for (let i = 0; i < selectedReceivedIds.length; i++) {
      const id = selectedReceivedIds[i];
      const order = orders.find(o => o.id === id);
      if (!order) continue;
      const customerOrgId = order.customerOrgId ?? order.customerOrg?.id ?? order.org?.id;
      if (!customerOrgId) {
        const ref = order.referenceNumber ?? order.ref ?? order.id;
        showAlert({ type: 'error', title: 'Missing Customer', message: `Order "${ref}" has no customer organisation linked.` });
        return;
      }
      if (order.campusId == null) {
        const ref = order.referenceNumber ?? order.ref ?? order.id;
        showAlert({ type: 'error', title: 'Missing Campus', message: `Order "${ref}" has no campus linked.` });
        return;
      }
      const locationId = order.locationId ?? order.location?.id ?? undefined;
      const key = `${customerOrgId}|${order.campusId}|${locationId ?? ''}`;
      if (!groupRecord[key]) groupRecord[key] = { customerOrgId, campusId: order.campusId, locationId, soIds: [] };
      groupRecord[key].soIds.push(id);
      selectedOrders.push(order);
    }

    setInvoiceIssuedAt(new Date());
    setInvoiceDueAt(null);
    setInvoiceNote('');
    setConfirmGroups(Object.values(groupRecord));
    setConfirmOrders(selectedOrders);
    setConfirmVisible(true);
  };

  const doGenerateInvoice = async () => {
    setConfirmVisible(false);
    setGenerating(true);
    let failed = 0;
    const created: string[] = [];
    for (const group of confirmGroups) {
      try {
        const payload = {
          customerOrgId: group.customerOrgId,
          campusId: group.campusId,
          locationId: group.locationId,
          soIds: group.soIds,
          rateUsed: Number(rateUsed),
          issuedAt: toYMD(invoiceIssuedAt),
          dueAt: invoiceDueAt ? toYMD(invoiceDueAt) : undefined,
          note: invoiceNote.trim() || undefined,
        };
        const inv = await createInvoiceHeaderApi(payload);
        created.push(inv.invoiceNumber ?? inv.id);
        notifyInvoiceCreated(inv.invoiceNumber ?? inv.id, inv.totalCents, payload.rateUsed);
      } catch (err: any) {
        failed++;
      }
    }
    setGenerating(false);
    setSelectedIds(prev => {
      const next = new Set<string>();
      prev.forEach(id => { if (!selectedReceivedIds.includes(id)) next.add(id); });
      return next;
    });
    load(true);
    if (failed === 0) {
      setTimeout(() => showAlert({ type: 'success', title: 'Invoice Generated', message: `Created: ${created.join(', ')}`, autoClose: 3000 }), 300);
    } else {
      showAlert({ type: 'warning', title: 'Partial Success', message: `${created.length} created, ${failed} failed.${created.length > 0 ? `\nCreated: ${created.join(', ')}` : ''}` });
    }
  };

  const subtitle = selectedIds.size > 0
    ? `${selectedIds.size} selected`
    : search || activeTab !== 'all'
    ? `${filtered.length} of ${orders.length} orders`
    : orders.length > 0
    ? `${orders.length} orders`
    : 'Sale orders';

  /* ── Header right: Export PDF + Print + Print Delivery buttons ── */
  const canExport = selectedIds.size > 0;
  const headerRight = (
    <View style={{ flexDirection: 'row', gap: 6 }}>
      <TouchableOpacity
        style={[styles.headerExportBtn, !canExport && styles.headerExportBtnDisabled, { backgroundColor: '#059669' }]}
        onPress={handlePrintDelivery}
        disabled={printingDO || !canExport}
        activeOpacity={0.75}
      >
        {printingDO
          ? <ActivityIndicator size="small" color="#FFFFFF" />
          : <Icon name="local-shipping" size={16} color="#FFFFFF" />}
        <AppText style={styles.headerExportText}>DO</AppText>
        {canExport && (
          <View style={styles.headerBadge}>
            <AppText style={styles.headerBadgeText}>{selectedIds.size}</AppText>
          </View>
        )}
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.headerExportBtn, !canExport && styles.headerExportBtnDisabled, { backgroundColor: '#D97706' }]}
        onPress={handlePrintPDF}
        disabled={printing || !canExport}
        activeOpacity={0.75}
      >
        {printing
          ? <ActivityIndicator size="small" color="#FFFFFF" />
          : <Icon name="print" size={16} color="#FFFFFF" />}
        <AppText style={styles.headerExportText}>Print</AppText>
        {canExport && (
          <View style={styles.headerBadge}>
            <AppText style={styles.headerBadgeText}>{selectedIds.size}</AppText>
          </View>
        )}
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.headerExportBtn, !canExport && styles.headerExportBtnDisabled]}
        onPress={handleExportPDF}
        disabled={exporting || !canExport}
        activeOpacity={0.75}
      >
        {exporting
          ? <ActivityIndicator size="small" color="#FFFFFF" />
          : <Icon name="picture-as-pdf" size={16} color="#FFFFFF" />}
        <AppText style={styles.headerExportText}>PDF</AppText>
        {canExport && (
          <View style={styles.headerBadge}>
            <AppText style={styles.headerBadgeText}>{selectedIds.size}</AppText>
          </View>
        )}
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.headerExportBtn, !canExport && styles.headerExportBtnDisabled, { backgroundColor: '#16A34A' }]}
        onPress={handleExportXLSX}
        disabled={exporting || !canExport}
        activeOpacity={0.75}
      >
        {exporting
          ? <ActivityIndicator size="small" color="#FFFFFF" />
          : <Icon name="table-chart" size={16} color="#FFFFFF" />}
        <AppText style={styles.headerExportText}>XLS</AppText>
        {canExport && (
          <View style={styles.headerBadge}>
            <AppText style={styles.headerBadgeText}>{selectedIds.size}</AppText>
          </View>
        )}
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.headerExportBtn, { backgroundColor: '#7C3AED' }]}
        onPress={handleImportXLSX}
        disabled={importing}
        activeOpacity={0.75}
      >
        {importing
          ? <ActivityIndicator size="small" color="#FFFFFF" />
          : <Icon name="upload-file" size={16} color="#FFFFFF" />}
        <AppText style={styles.headerExportText}>Import</AppText>
      </TouchableOpacity>
    </View>
  );

  /* ── Row renderer ── */
  const handlePreview = async (order: ApiSalesOrder) => {
    setPreviewHtml('');
    setPreviewLoading(true);
    try {
      const [full, sigs, products, campuses, uomsPreview] = await Promise.all([
        getSalesOrderApi(order.id),
        getSaleOrderSignaturesApi(order.id).catch(() => [] as Array<{ signatureUrl: string; type: string; createdAt: string }>),
        getAllProductsApi().catch(() => [] as ApiProduct[]),
        getCampusesApi().catch(() => [] as ApiCampus[]),
        getUomsApi().catch(() => [] as ApiUom[]),
      ]);
      const pMap: Record<string, ApiProduct> = {};
      products.forEach(p => { pMap[p.id] = p; });
      const cMap: Record<string, ApiCampus> = {};
      campuses.forEach(c => { cMap[String(c.id)] = c; });
      const uomMapPreview: Record<number, ApiUom> = {};
      uomsPreview.forEach(u => { uomMapPreview[u.id] = u; });
      const sigsMapped = await Promise.all(
        sigs.map(async s => ({
          type:      s.type,
          createdAt: s.createdAt,
          url:       (await fetchImageBase64(s.signatureUrl)) ?? s.signatureUrl,
        })),
      );
      const pw   = Dimensions.get('window').width - 16;
      const html = buildInvoiceHTML([full], pMap, { [full.id]: sigsMapped }, cMap, false, pw, false, uomMapPreview);
      setPreviewHtml(html);
    } catch (err: any) {
      showAlert({ type: 'error', title: 'Preview Error', message: err?.message ?? 'Failed to load preview' });
    } finally {
      setPreviewLoading(false);
    }
  };

  const renderItem = ({ item, index }: { item: ApiSalesOrder; index: number }) => {
    const statusKey   = (item.status ?? '').toLowerCase();
    const s           = STATUS_COLOR[statusKey] ?? { bg: Colors.divider, text: Colors.textSecondary, label: item.status ?? '' };
    const total       = calcTotal(item);
    const ref         = item.referenceNumber ?? item.ref ?? item.id;
    const rowColors   = ['#2563EB', '#7C3AED', '#10B981', '#F59E0B', '#EF4444', '#06B6D4'];
    const color       = rowColors[index % rowColors.length];
    const isSelected  = selectedIds.has(item.id);

    const campusCode  =
      item.campusCode ??
      item.campus?.campusCode ??
      (item.campusId != null ? campusMap[String(item.campusId)]?.campusCode : undefined) ??
      null;

    const creatorName =
      item.createdByName ??
      item.createdByUser?.name ??
      item.createdByUser?.email ??
      null;

    const quotationRef =
      item.quotation?.quotationNumber ??
      item.quotation?.quotation_number ??
      item.quotation?.referenceNumber ??
      item.quotation?.ref ??
      item.quotationNumber ??
      item.quotation_number ??
      item.quotationRef ??
      null;

    const sigs = sigMap[item.id] ?? [];

    return (
      <TouchableOpacity
        style={[styles.rowWrap, isSelected && styles.rowSelected]}
        activeOpacity={0.7}
        onPress={() => toggleSelect(item.id)}
      >
        {/* Main info row */}
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
              {campusCode ? (
                <View style={styles.campusChip}>
                  <Icon name="place" size={10} color={Colors.primary} />
                  <AppText style={styles.campusChipText}>{campusCode}</AppText>
                </View>
              ) : null}
              {quotationRef ? (
                <View style={styles.quoteChip}>
                  <Icon name="description" size={10} color="#7C3AED" />
                  <AppText style={styles.quoteChipText} numberOfLines={1}>{quotationRef}</AppText>
                </View>
              ) : null}
              {creatorName ? (
                <View style={styles.creatorChip}>
                  <Icon name="person-outline" size={10} color={Colors.textSecondary} />
                  <AppText style={styles.creatorChipText} numberOfLines={1}>{creatorName}</AppText>
                </View>
              ) : null}
              <AppText style={styles.date}>{formatDate(item.createdAt)}</AppText>
            </View>
          </View>
          <View style={styles.rowRight}>
            <AppText style={styles.amount}>${total.toFixed(2)}</AppText>
            <View style={[styles.statusBadge, { backgroundColor: s.bg }]}>
              <AppText style={[styles.statusText, { color: s.text }]}>{s.label}</AppText>
            </View>
          </View>
        </View>

        {/* Signatures */}
        {sigs.length > 0 ? (
          <View style={styles.sigRow}>
            <View style={styles.sigHeader}>
              <Icon name="draw" size={11} color={Colors.textSecondary} />
              <AppText style={styles.sigLabel}>Signatures ({sigs.length})</AppText>
            </View>
            <View style={styles.sigList}>
              {sigs.map((sig, i) => {
                const tc = SIG_TYPE_COLOR[sig.type?.toUpperCase()] ?? { bg: '#F0F0F0', text: Colors.textSecondary };
                return (
                  <View key={i} style={styles.sigCard}>
                    <View style={[styles.sigCardAccent, { backgroundColor: tc.text }]} />
                    <View style={styles.sigImageWrap}>
                      <Image source={{ uri: sig.url }} style={styles.sigImage} resizeMode="contain" />
                    </View>
                    <View style={styles.sigCardFooter}>
                      <View style={[styles.sigTypeChip, { backgroundColor: tc.bg }]}>
                        <AppText style={[styles.sigTypeText, { color: tc.text }]}>{sig.type}</AppText>
                      </View>
                      <AppText style={styles.sigItemDate}>{formatDate(sig.createdAt)}</AppText>
                    </View>
                  </View>
                );
              })}
            </View>
          </View>
        ) : null}

        {/* Preview button */}
        <View style={styles.cardActions}>
          <TouchableOpacity
            style={styles.previewBtn}
            onPress={e => { e.stopPropagation?.(); handlePreview(item); }}
            activeOpacity={0.7}
          >
            <Icon name="visibility" size={14} color="#2563EB" />
            <AppText style={styles.previewBtnText}>Preview</AppText>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.safe}>
      <AppBar
        title="Sale Orders"
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
            data={displayedOrders}
            keyExtractor={item => item.id}
            extraData={sigMap}
            renderItem={renderItem}
            style={styles.flatList}
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}
            onEndReached={handleEndReached}
            onEndReachedThreshold={0.3}
            ListFooterComponent={renderListFooter}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
            ListEmptyComponent={
              <View style={styles.center}>
                <Icon name={search ? 'search-off' : 'receipt-long'} size={48} color={Colors.textLight} />
                <AppText variant="body" color="textSecondary" style={styles.centerMsg}>
                  {search ? `No orders match "${search}"` : 'No sale orders yet'}
                </AppText>
              </View>
            }
          />
        )}
      </View>

      {/* Generate Invoice bar — visible when received orders are selected */}
      {selectedReceivedIds.length > 0 && (
        <View style={styles.generateBar}>
          <View style={styles.generateInfo}>
            <View style={styles.generateBadge}>
              <AppText style={styles.generateBadgeText}>{selectedReceivedIds.length}</AppText>
            </View>
            <AppText style={styles.generateLabel}>received · ${selectedReceivedTotal.toFixed(2)}</AppText>
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
            style={styles.generateBtn}
            onPress={handleGenerateInvoice}
            disabled={generating}
            activeOpacity={0.8}
          >
            {generating
              ? <ActivityIndicator size="small" color="#FFFFFF" />
              : <Icon name="request-quote" size={16} color="#FFFFFF" />}
            <AppText style={styles.generateBtnText}>Generate</AppText>
          </TouchableOpacity>
        </View>
      )}

      {/* Summary card — always visible */}
      {!loading && !error && (
        <View style={styles.summaryCard}>
          <View style={styles.summaryItem}>
            <View style={[styles.summaryDot, { backgroundColor: '#2563EB' }]} />
            <View style={styles.summaryTexts}>
              <AppText style={styles.summaryLabel}>Confirmed</AppText>
              <AppText style={[styles.summaryAmount, { color: '#2563EB' }]}>
                ${summary.confirmed.toFixed(2)}
              </AppText>
            </View>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryItem}>
            <View style={[styles.summaryDot, { backgroundColor: '#10B981' }]} />
            <View style={styles.summaryTexts}>
              <AppText style={styles.summaryLabel}>Received</AppText>
              <AppText style={[styles.summaryAmount, { color: '#10B981' }]}>
                ${summary.received.toFixed(2)}
              </AppText>
            </View>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryItem}>
            <View style={[styles.summaryDot, { backgroundColor: '#7C3AED' }]} />
            <View style={styles.summaryTexts}>
              <AppText style={styles.summaryLabel}>Invoiced</AppText>
              <AppText style={[styles.summaryAmount, { color: '#7C3AED' }]}>
                ${summary.invoice.toFixed(2)}
              </AppText>
            </View>
          </View>
        </View>
      )}

      {/* ── Preview Modal ─────────────────────────────────────────────────────── */}
      <Modal
        visible={previewLoading || previewHtml !== ''}
        transparent={false}
        animationType="slide"
        onRequestClose={() => { setPreviewHtml(''); setPreviewLoading(false); }}
      >
        <View style={{ flex: 1, backgroundColor: '#1E293B' }}>
          <View style={styles.previewHeader}>
            <AppText style={styles.previewTitle}>Sale Order Preview</AppText>
            <TouchableOpacity
              onPress={() => { setPreviewHtml(''); setPreviewLoading(false); }}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Icon name="close" size={24} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
          {previewLoading ? (
            <View style={styles.previewCenter}>
              <ActivityIndicator size="large" color="#FFFFFF" />
              <AppText style={styles.previewLoadingText}>Loading preview…</AppText>
            </View>
          ) : (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 8 }}>
              <WebView
                source={{ html: previewHtml, baseUrl: '' }}
                originWhitelist={['*']}
                style={{
                  width: Dimensions.get('window').width - 16,
                  height: Math.round(A5_H * ((Dimensions.get('window').width - 16) / A5_PX)),
                }}
                scrollEnabled={false}
              />
            </View>
          )}
        </View>
      </Modal>

      {/* ── Confirm Generate Invoice modal ────────────────────────────────────── */}
      <Modal
        visible={confirmVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setConfirmVisible(false)}
      >
        <View style={soConfirmStyles.backdrop}>
          <View style={soConfirmStyles.card}>
            <AppText style={soConfirmStyles.title}>Generate Invoice?</AppText>

            <View style={soConfirmStyles.table}>
              <View style={soConfirmStyles.tableHeader}>
                <AppText style={[soConfirmStyles.colSO, soConfirmStyles.headerText]}>SO Number</AppText>
                <AppText style={[soConfirmStyles.colCampus, soConfirmStyles.headerText]}>Campus</AppText>
                <AppText style={[soConfirmStyles.colAmt, soConfirmStyles.headerText]}>Amount</AppText>
              </View>
              {confirmOrders.map(o => {
                const ref    = o.referenceNumber ?? o.ref ?? o.orderNumber ?? o.id;
                const campus = o.campusCode ?? o.campus?.campusCode ?? (o.campusId != null ? campusMap[String(o.campusId)]?.campusCode : null) ?? '—';
                const amt    = calcTotal(o);
                return (
                  <View key={o.id} style={soConfirmStyles.row}>
                    <AppText style={[soConfirmStyles.colSO, soConfirmStyles.rowText]} numberOfLines={1}>{ref}</AppText>
                    <AppText style={[soConfirmStyles.colCampus, soConfirmStyles.rowText]}>{campus}</AppText>
                    <AppText style={[soConfirmStyles.colAmt, soConfirmStyles.rowText]}>${amt.toFixed(2)}</AppText>
                  </View>
                );
              })}
            </View>

            <View style={soConfirmStyles.totalRow}>
              <AppText style={soConfirmStyles.totalLabel}>Total</AppText>
              <AppText style={soConfirmStyles.totalAmount}>${confirmOrders.reduce((s, o) => s + calcTotal(o), 0).toFixed(2)}</AppText>
            </View>

            <View style={soConfirmStyles.dateRow}>
              <View style={{ flex: 1 }}>
                <AppText style={soConfirmStyles.dateLabel}>Issue Date</AppText>
                <TouchableOpacity
                  style={soConfirmStyles.dateBtn}
                  onPress={() => setDatePickerFor('issued')}
                  activeOpacity={0.75}
                >
                  <AppText style={soConfirmStyles.dateBtnText}>{fmtDateBtn(invoiceIssuedAt)}</AppText>
                  <Icon name="edit-calendar" size={15} color={Colors.primary} />
                </TouchableOpacity>
              </View>
              <View style={{ flex: 1 }}>
                <AppText style={soConfirmStyles.dateLabel}>Due Date</AppText>
                <TouchableOpacity
                  style={soConfirmStyles.dateBtn}
                  onPress={() => setDatePickerFor('due')}
                  activeOpacity={0.75}
                >
                  <AppText style={[soConfirmStyles.dateBtnText, !invoiceDueAt && { color: '#94a3b8' }]}>
                    {invoiceDueAt ? fmtDateBtn(invoiceDueAt) : 'Optional'}
                  </AppText>
                  <Icon name="edit-calendar" size={15} color={Colors.primary} />
                </TouchableOpacity>
              </View>
            </View>

            <View>
              <AppText style={soConfirmStyles.dateLabel}>Note</AppText>
              <TextInput
                style={[soConfirmStyles.dateInput, { minHeight: 60, textAlignVertical: 'top' }]}
                value={invoiceNote}
                onChangeText={setInvoiceNote}
                placeholder="Invoice note (optional)"
                placeholderTextColor="#94a3b8"
                multiline
              />
            </View>

            {confirmGroups.length > 1 ? (
              <AppText style={soConfirmStyles.groupNote}>
                Orders will be grouped into {confirmGroups.length} invoices by customer &amp; campus.
              </AppText>
            ) : null}

            <View style={soConfirmStyles.btnRow}>
              <TouchableOpacity style={soConfirmStyles.btnCancel} onPress={() => setConfirmVisible(false)} activeOpacity={0.8}>
                <AppText style={soConfirmStyles.btnCancelText}>Cancel</AppText>
              </TouchableOpacity>
              <TouchableOpacity style={soConfirmStyles.btnCreate} onPress={doGenerateInvoice} disabled={generating} activeOpacity={0.8}>
                {generating
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <AppText style={soConfirmStyles.btnCreateText}>Generate</AppText>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <DatePickerModal
        visible={datePickerFor !== null}
        value={datePickerFor === 'due' ? (invoiceDueAt ?? new Date()) : invoiceIssuedAt}
        onChange={date => {
          if (datePickerFor === 'issued') setInvoiceIssuedAt(date);
          else setInvoiceDueAt(date);
        }}
        onClose={() => setDatePickerFor(null)}
      />
    </View>
  );
};

const soConfirmStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
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
  rowText:   { fontSize: 13, color: Colors.text },
  colSO:     { flex: 3 },
  colCampus: { flex: 1.5, textAlign: 'center' },
  colAmt:    { flex: 2, textAlign: 'right' },
  totalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderTopWidth: 1.5,
    borderTopColor: Colors.divider,
    marginBottom: 8,
  },
  totalLabel:  { fontSize: 15, fontWeight: '600', color: Colors.textSecondary },
  totalAmount: { fontSize: 28, fontWeight: '800', color: Colors.text },
  dateRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 12,
  },
  dateLabel: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginBottom: 4,
  },
  dateInput: {
    borderWidth: 1,
    borderColor: Colors.divider,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
    color: Colors.text,
    backgroundColor: Colors.background,
  },
  dateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: Colors.divider,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 9,
    backgroundColor: Colors.background,
  },
  dateBtnText: {
    fontSize: 13,
    color: Colors.text,
    flex: 1,
  },
  groupNote: {
    fontSize: 12,
    color: Colors.textSecondary,
    textAlign: 'center',
    marginBottom: 16,
  },
  btnRow:   { flexDirection: 'row', gap: 10, marginTop: 12 },
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

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },

  headerExportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  headerExportBtnDisabled: { opacity: 0.35 },
  headerExportText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
  headerBadge: {
    backgroundColor: '#EF4444',
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
    marginLeft: 2,
  },
  headerBadgeText: { color: '#FFFFFF', fontSize: 10, fontWeight: '800' },

  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 0,
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
  list: { paddingBottom: 8 },

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

  sigRow: {
    marginHorizontal: 14, marginBottom: 12,
    borderTopWidth: 1, borderTopColor: Colors.divider,
    paddingTop: 8, gap: 6,
  },
  sigList:       { flexDirection: 'row', gap: 6, alignItems: 'stretch' },
  sigHeader:     { flexDirection: 'row', alignItems: 'center', gap: 4 },
  sigLabel:      { fontSize: 10, color: Colors.textSecondary, fontWeight: '600', letterSpacing: 0.3 },
  sigCard: {
    flex: 1,
    borderRadius: 8, overflow: 'hidden',
    backgroundColor: '#FFFFFF',
    borderWidth: 1, borderColor: '#E8EEF4',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06, shadowRadius: 3, elevation: 2,
  },
  sigCardAccent:  { height: 3 },
  sigImageWrap:   { backgroundColor: '#F8FAFF', padding: 4 },
  sigImage:       { width: '100%', height: 48 },
  sigCardFooter: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 5, paddingVertical: 4,
    borderTopWidth: 1, borderTopColor: '#F0F4F8',
    backgroundColor: '#FAFBFF',
  },
  sigItemDate:   { fontSize: 8, color: Colors.textSecondary },
  sigTypeChip:   { borderRadius: 3, paddingHorizontal: 4, paddingVertical: 1 },
  sigTypeText:   { fontSize: 8, fontWeight: '700', letterSpacing: 0.3 },

  indexBox: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  indexText: { fontSize: 14, fontWeight: '800' },
  rowBody:   { flex: 1, gap: 3 },
  ref:       { fontSize: 14, fontWeight: '700', color: Colors.text, letterSpacing: 0.3 },
  rowMeta:   { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 5 },
  campusChip: {
    flexDirection: 'row', alignItems: 'center', gap: 2,
    backgroundColor: '#EFF6FF', borderRadius: 4,
    paddingHorizontal: 5, paddingVertical: 2,
  },
  campusChipText: { fontSize: 10, fontWeight: '700', color: Colors.primary },
  quoteChip: {
    flexDirection: 'row', alignItems: 'center', gap: 2,
    backgroundColor: '#EDE9FE', borderRadius: 4,
    paddingHorizontal: 5, paddingVertical: 2,
  },
  quoteChipText: { fontSize: 10, fontWeight: '700', color: '#7C3AED', maxWidth: 110 },
  creatorChip: {
    flexDirection: 'row', alignItems: 'center', gap: 2,
    backgroundColor: Colors.background, borderRadius: 4,
    paddingHorizontal: 5, paddingVertical: 2,
  },
  creatorChipText: { fontSize: 10, color: Colors.textSecondary, maxWidth: 90 },
  date:      { fontSize: 11, color: Colors.textSecondary },
  rowRight:  { alignItems: 'flex-end', gap: 5 },
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

  generateBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16, paddingVertical: 12,
    borderTopWidth: 1, borderTopColor: '#E2E8F0',
    shadowColor: '#000', shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.08, shadowRadius: 6, elevation: 6,
  },
  generateInfo:      { flexDirection: 'row', alignItems: 'center', gap: 8 },
  generateBadge: {
    backgroundColor: '#10B981', borderRadius: 12,
    paddingHorizontal: 8, paddingVertical: 2, minWidth: 26, alignItems: 'center',
  },
  generateBadgeText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },
  generateLabel:     { fontSize: 13, fontWeight: '600', color: Colors.text },
  generateBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#7C3AED', borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 9,
  },
  generateBtnText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
  cardActions: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: Colors.divider,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  previewBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 5,
    paddingHorizontal: 10,
    backgroundColor: '#EFF6FF',
    borderRadius: 8,
  },
  previewBtnText: {
    fontSize: 12,
    color: '#2563EB',
    fontWeight: '600',
  },
  previewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    paddingTop: 50,
    backgroundColor: '#1E293B',
  },
  previewTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  previewCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  previewLoadingText: {
    fontSize: 14,
    color: '#94A3B8',
  },

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

  rateBox: { alignItems: 'center', gap: 2 },
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
});

export default SaleOrdersListScreen;
