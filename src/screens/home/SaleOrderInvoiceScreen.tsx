import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  ActivityIndicator, Platform,
} from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { MaterialIcons as Icon } from '@expo/vector-icons';
import AppBar from '../../components/AppBar';
import { useAlert } from '../../components/AppAlert';
import {
  getSalesOrderApi, getAllProductsApi, getDeliveryOrdersApi, getUomsApi,
  ApiSalesOrder, ApiProduct, ApiUom,
} from '../../services/focusApi';
import LOGO_BASE64 from '../../logo/logoBase64';

// ─── Theme ────────────────────────────────────────────────────────────────────

const P   = '#546E7A';
const P_D = '#37474F';
const P_L = '#ECEFF1';
const INK  = '#212121';
const SUB  = '#757575';
const BDR  = '#EEEEEE';
const SURF = '#FAFAFA';

// ─── Company / Payment defaults ───────────────────────────────────────────────

const COMPANY_INFO = {
  name:     'FOCUS LAB',
  addr1:    '#17 St 480, Sangkat Toul Toum Pong 1',
  addr2:    'Khan Chamkarmon, Phnom Penh 12310',
  phone:    '0964222816',
  email:    'sen.sov@gmail.com',
};

const PAYMENT_INFO: PaymentInfo = {
  bankName:      'ABA Bank',
  accountName:   'SOVITHIA SEN',
  accountNumber: '000 786 988',
  swiftCode:     'ABAAKHPP',
};

// ─── TypeScript Interfaces ────────────────────────────────────────────────────

interface Props { orderId: string; onBack: () => void; }

export interface CompanyInfo {
  name: string; addr1: string; addr2: string; phone: string; email: string;
}

export interface CustomerInfo {
  name: string; companyName: string; phone: string; email: string; address: string;
}

export interface InvoiceLineItem {
  no: number; barcode: string; name: string; nameKh: string; unit: string;
  qty: number; unitPriceCents: number; discountCents: number; totalCents: number;
}

export interface InvoiceSummaryData {
  subtotalCents: number; discountCents: number; taxCents: number; grandTotalCents: number;
}

export interface PaymentInfo {
  bankName: string; accountName: string; accountNumber: string; swiftCode: string;
}

export interface InvoiceData {
  invoiceNumber: string; invoiceDate: string; dueDate?: string; status: string;
  company: CompanyInfo; customer: CustomerInfo;
  items: InvoiceLineItem[]; summary: InvoiceSummaryData; payment: PaymentInfo;
  notes?: string; terms?: string; signatureUrl?: string | null;
}

// ─── Sample Invoice JSON Data ─────────────────────────────────────────────────

export const SAMPLE_INVOICE_DATA: InvoiceData = {
  invoiceNumber: 'IN-2606-000033',
  invoiceDate:   '2026-06-18',
  dueDate:       '2026-07-18',
  status:        'ISSUED',
  company:       COMPANY_INFO,
  customer: {
    name:        'SEN Sovithia',
    companyName: 'ABC School Ltd.',
    phone:       '+855 12 345 678',
    email:       'client@school.edu.kh',
    address:     '#123 St 271, Toul Tom Pong, Phnom Penh',
  },
  items: [
    { no:1, barcode:'NB-A4-001', name:'Notebook Set',   nameKh:'សំណុំសៀវភៅ',   unit:'SET', qty:5,  unitPriceCents:2500,  discountCents:0,   totalCents:12500 },
    { no:2, barcode:'WB-90-002', name:'Whiteboard',     nameKh:'ក្ដារស',        unit:'PCS', qty:3,  unitPriceCents:5000,  discountCents:500, totalCents:14500 },
    { no:3, barcode:'PJ-HD-003', name:'HD Projector',   nameKh:'ម៉ាស៊ីនពន្លឺ',  unit:'PCS', qty:1,  unitPriceCents:25000, discountCents:0,   totalCents:25000 },
    { no:4, barcode:'MK-AS-004', name:'Marker Set',     nameKh:'សំណុំប៊ិចម៉ាកឃ័រ', unit:'SET', qty:10, unitPriceCents:800,   discountCents:0,   totalCents:8000  },
    { no:5, barcode:'DO-BM-005', name:'Desk Organizer', nameKh:'គ្រឿងសម្រួលការ',  unit:'PCS', qty:8,  unitPriceCents:1500,  discountCents:0,   totalCents:12000 },
  ],
  summary: { subtotalCents:72000, discountCents:500, taxCents:0, grandTotalCents:71500 },
  payment: PAYMENT_INFO,
  notes: 'Thank you for your business. Please process payment within 30 days of the invoice date.',
  terms: '1. Payment is due within 30 days of invoice date.\n2. Late payments incur 2% monthly interest.\n3. Disputes must be raised within 7 days of receipt.',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmtMoney = (cents: number) => `$${(cents / 100).toFixed(2)}`;

const fmtDate = (iso?: string) => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('en-US', { day:'numeric', month:'short', year:'numeric' });
  } catch { return iso; }
};

const arrayBufferToBase64 = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer);
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i], b1 = bytes[i+1] ?? 0, b2 = bytes[i+2] ?? 0;
    out += chars[b0 >> 2];
    out += chars[((b0 & 3) << 4) | (b1 >> 4)];
    out += i+1 < bytes.length ? chars[((b1 & 15) << 2) | (b2 >> 6)] : '=';
    out += i+2 < bytes.length ? chars[b2 & 63] : '=';
  }
  return out;
};

const fetchBase64 = async (url: string): Promise<string | null> => {
  try {
    const res = await fetch(url);
    const buf = await res.arrayBuffer();
    const ct  = res.headers.get('content-type') ?? 'image/png';
    return `data:${ct};base64,${arrayBufferToBase64(buf)}`;
  } catch { return null; }
};

// ─── HTML Template Builder (print + PDF) ─────────────────────────────────────

export const buildModernInvoiceHTML = (data: InvoiceData): string => {
  const { company, customer, items, summary, payment } = data;

  const statusClass  =
    data.status.toLowerCase() === 'paid'      ? 'status-paid'      :
    data.status.toLowerCase() === 'cancelled' ? 'status-cancelled'  : 'status-issued';
  const hasDiscount  = items.some(it => it.discountCents > 0);

  // Page capacity: P1 accounts for the large invoice header on page 1.
  // PN is conservative for rows with Khmer text (~46 px tall).
  const ROWS_P1 = 13;
  const ROWS_PN = 20;

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

  const groups: InvoiceLineItem[][] = items.length <= ROWS_P1
    ? [items]
    : [
        items.slice(0, ROWS_P1),
        ...Array.from(
          { length: Math.ceil((items.length - ROWS_P1) / ROWS_PN) },
          (_, i) => items.slice(ROWS_P1 + i * ROWS_PN, ROWS_P1 + (i + 1) * ROWS_PN)
        ),
      ];

  // Each page gets its own tbl-wrap so pg-break sits OUTSIDE the border container
  // — page-break-after fires reliably when not inside a bordered div.
  const itemGroups = groups.map((grp, gi) => {
    const start = groups.slice(0, gi).reduce((s, g) => s + g.length, 0);
    const rows = grp.map((it, li) => {
      const idx = start + li;
      return `
    <div class="tbl-row${idx % 2 === 1 ? ' alt' : ''}">
      <div class="tbl-cell tc-no">${it.no}</div>
      <div class="tbl-cell tc-bar">${it.barcode || '—'}</div>
      <div class="tbl-cell tc-nam">
        ${it.nameKh ? `<div class="item-kh">${it.nameKh}</div>` : ''}
        <div class="item-name">${it.name}</div>
      </div>
      <div class="tbl-cell tc-unit c">${it.unit || '—'}</div>
      <div class="tbl-cell tc-pri r">${fmtMoney(it.unitPriceCents)}</div>
      <div class="tbl-cell tc-qty c">${it.qty}</div>
      ${hasDiscount ? `<div class="tbl-cell tc-dis r ${it.discountCents > 0 ? 'red' : 'muted'}">${it.discountCents > 0 && it.qty * it.unitPriceCents > 0 ? `%${Math.round(it.discountCents / (it.qty * it.unitPriceCents) * 100)}` : '—'}</div>` : ''}
      <div class="tbl-cell tc-amt r bold">${fmtMoney(it.totalCents)}</div>
    </div>`;
    }).join('');
    const wrap = `<div class="tbl-wrap">${colHdr}${rows}</div>`;
    return gi === 0 ? wrap : `<div class="pg-break"></div>${wrap}`;
  }).join('');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=794,initial-scale=1.0"/>
<style>
  @page { size:A4 portrait; margin:0; }
  *,*::before,*::after {
    box-sizing:border-box; margin:0; padding:0;
    -webkit-print-color-adjust:exact; print-color-adjust:exact;
  }
  body {
    font-family:'Helvetica Neue',Helvetica,'Trebuchet MS',Arial,sans-serif;
    font-size:12px; color:#212121; background:#fff;
    width:794px;
    font-variant-numeric:tabular-nums lining-nums;
  }

  /* ── Header Band ── */
  .inv-hdr {
    background:#fff; color:#212121;
    padding:26px 40px 20px;
    display:flex; align-items:center; gap:16px;
  }
  .logo-wrap {
    width:76px; height:76px; border-radius:12px;
    overflow:hidden; flex-shrink:0;
    background:#F5F5F5;
  }
  .logo-wrap img { width:100%; height:100%; display:block; object-fit:cover; }
  .co-block { flex:1; }
  .co-name  { font-size:20px; font-weight:900; letter-spacing:3px; text-transform:uppercase; color:#212121; }
  .co-sub   { font-size:10px; color:#757575; line-height:1.7; margin-top:4px; }
  .inv-title-wrap { text-align:center; margin-bottom:22px; }
  .inv-title  { font-size:30px; font-weight:900; letter-spacing:6px; text-transform:uppercase; color:#37474F; line-height:1; display:inline-block; border-bottom:2.5px solid #37474F; padding-bottom:0; }
  .inv-badge  {
    display:inline-block; flex-shrink:0;
    padding:4px 14px; border-radius:12px;
    font-size:10px; font-weight:700; letter-spacing:.5px; text-transform:uppercase;
  }

  /* ── Body ── */
  .body { padding:26px 40px 40px; }

  /* ── Info Cards ── */
  .info-row { display:flex; gap:14px; margin-bottom:22px; }
  .info-card {
    flex:1; padding:13px 15px;
    border:1px solid #EEE; border-radius:10px; background:#FAFAFA;
  }
  .info-hdr {
    font-size:10px; font-weight:700;
    text-transform:uppercase; letter-spacing:1px;
    color:#546E7A; padding-bottom:5px; margin-bottom:8px;
    border-bottom:2px solid #546E7A;
  }
  .irow { display:flex; gap:6px; margin-bottom:4px; align-items:baseline; }
  .ilbl { font-size:9.5px; color:#9E9E9E; font-weight:600; width:80px; flex-shrink:0; }
  .ival { font-size:11px; font-weight:600; color:#212121; font-variant-numeric:tabular-nums lining-nums; }
  .status-issued    { background:#E3F2FD; color:#1565C0; padding:2px 10px; border-radius:10px; font-size:10px; font-weight:700; }
  .status-paid      { background:#E8F5E9; color:#2E7D32; padding:2px 10px; border-radius:10px; font-size:10px; font-weight:700; }
  .status-cancelled { background:#FFEBEE; color:#C62828; padding:2px 10px; border-radius:10px; font-size:10px; font-weight:700; }

  /* ── Section Title ── */
  .sec-title {
    font-size:11px; font-weight:700; text-transform:uppercase;
    letter-spacing:1px; color:#546E7A; margin-bottom:9px;
  }

  /* ── Items Table (div-based — reliable page breaks on iOS WebKit) ── */
  .tbl-wrap { border:1px solid #EEE; margin-bottom:0; }
  .tbl-row {
    display:flex; align-items:stretch;
    min-height:36px;
    border-bottom:1px solid #F5F5F5;
    page-break-inside:avoid; break-inside:avoid;
  }
  .tbl-row:last-child { border-bottom:none; }
  .hdr-row { background:#E3F2FD; border-bottom:2px solid #BBDEFB; }
  .pg-break { page-break-after:always; break-after:always; height:0; margin:0; padding:0; }
  .tbl-row.alt { background:#FAFAFA; }
  .tbl-cell {
    padding:6px 12px; font-size:12px;
    display:flex; align-items:center;
    font-variant-numeric:tabular-nums lining-nums;
  }
  .hdr-row .tbl-cell {
    font-size:10px; font-weight:700;
    text-transform:uppercase; letter-spacing:.5px;
    color:#1565C0; padding:10px 12px;
  }
  .tc-no   { width:50px; flex-shrink:0; justify-content:center; text-align:center; font-size:13px; font-weight:700; }
  .tc-bar  { width:100px; flex-shrink:0; color:#212121; }
  .tc-nam  { flex:1; flex-direction:column; align-items:flex-start; justify-content:center; gap:2px; }
  .tc-unit { width:46px; flex-shrink:0; justify-content:center; text-align:center; font-size:10px; }
  .tc-pri  { width:70px; flex-shrink:0; justify-content:flex-end; text-align:right; }
  .tc-qty  { width:34px; flex-shrink:0; justify-content:center; text-align:center; }
  .tc-dis  { width:70px; flex-shrink:0; justify-content:flex-end; text-align:right; }
  .tc-amt  { width:76px; flex-shrink:0; justify-content:flex-end; text-align:right; }

  .c { justify-content:center; text-align:center; }
  .r { justify-content:flex-end; text-align:right; }
  .red   { color:#546E7A; }
  .muted { color:#BDBDBD; }
  .bold  { font-weight:700; }
  .item-name { font-weight:600; font-size:12px; }
  .item-kh   { font-size:12px; color:#212121; }

  /* ── Summary ── */
  .sum-box { border:1px solid #EEE; border-top:none; page-break-inside:avoid; break-inside:avoid; }
  .sum-row {
    display:flex; justify-content:space-between; align-items:center;
    padding:9px 16px; font-size:12px;
    border-bottom:1px solid #F5F5F5;
  }
  .sum-row:last-child { border-bottom:none; }
  .sum-row.sub { background:#FAFAFA; }
  .sum-row.disc .sum-v { color:#546E7A; }
  .sum-row.grand {
    background:#37474F; color:#fff;
    font-size:14px; font-weight:800; padding:12px 16px;
  }
  .sum-row.grand .sum-l,
  .sum-row.grand .sum-v { color:#fff; }
  .sum-l { font-weight:600; }
  .sum-v { font-weight:700; }

  /* ── Bottom Section ── */
  .bottom-row { display:flex; gap:14px; margin-top:16px; margin-bottom:18px; page-break-before:always; break-before:always; page-break-inside:avoid; break-inside:avoid; }

  .pay-card { flex:1; border:1px solid #EEE; border-radius:10px; overflow:hidden; }
  .pay-hdr  {
    background:#212121; color:#fff;
    padding:10px 14px;
    font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:1px;
  }
  .pay-row  { display:flex; align-items:baseline; padding:8px 14px; border-bottom:1px solid #F5F5F5; }
  .pay-row:last-child { border-bottom:none; }
  .pay-l { width:105px; font-size:10px; color:#9E9E9E; font-weight:600; flex-shrink:0; }
  .pay-v { font-size:11px; font-weight:700; }

  .notes-card { flex:1; border:1px solid #EEE; border-radius:10px; overflow:hidden; }
  .notes-hdr  { background:#F5F5F5; padding:10px 14px; font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:1px; color:#555; }
  .notes-body { padding:12px 14px; font-size:11px; line-height:1.7; color:#555; }

  /* ── Terms ── */
  .terms-card { border:1px solid #EEE; border-radius:10px; overflow:hidden; margin-bottom:18px; page-break-inside:avoid; break-inside:avoid; }
  .terms-hdr  { background:#F5F5F5; padding:10px 14px; font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:1px; color:#555; }
  .terms-body { padding:12px 14px; font-size:10px; line-height:1.8; color:#777; white-space:pre-line; }

  /* ── Signature ── */
  .sig-section { display:flex; page-break-inside:avoid; break-inside:avoid; margin-top:10px; }
  .sig-col { flex:1; text-align:center; font-size:11px; font-weight:700; color:#555; padding:4px 5px 6px; }
  .sig-line { height:55px; overflow:hidden; margin:0 8px 4px; }
  .sig-lbl { border-top:1.5px solid #333; margin:0 8px; padding-top:4px; }
  .sig-img { display:block; max-width:100%; max-height:50px; object-fit:contain; margin:4px auto 0; }

  /* ── Footer strip ── */
  .footer {
    background:#F5F5F5; color:#757575;
    text-align:center; padding:10px;
    font-size:10px; letter-spacing:.4px;
    margin-top:20px; border-top:1px solid #EEE;
  }
</style>
</head>
<body>

<!-- ── Header ── -->
<div class="inv-hdr">
  <div class="logo-wrap">
    <img src="${LOGO_BASE64}" alt="logo"/>
  </div>
  <div class="co-block">
    <div class="co-name">${company.name}</div>
    <div class="co-sub">${company.addr1}<br/>${company.addr2}<br/>${company.phone} &nbsp;·&nbsp; ${company.email}</div>
  </div>
</div>

<!-- ── Body ── -->
<div class="body">

  <!-- INVOICE title -->
  <div class="inv-title-wrap">
    <div class="inv-title">INVOICE</div>
  </div>

  <!-- Bill To + Invoice Details -->
  <div class="info-row">
    <div class="info-card">
      <div class="info-hdr">Bill To</div>
      <div class="irow"><span class="ilbl">Name</span><span class="ival">${customer.name}</span></div>
      <div class="irow"><span class="ilbl">Campus</span><span class="ival">${customer.companyName}</span></div>
      <div class="irow"><span class="ilbl">SO No</span><span class="ival">${data.invoiceNumber}</span></div>
      <div class="irow"><span class="ilbl">Phone</span><span class="ival">${customer.phone}</span></div>
      <div class="irow"><span class="ilbl">Email</span><span class="ival">${customer.email}</span></div>
      <div class="irow"><span class="ilbl">Address</span><span class="ival">${customer.address}</span></div>
    </div>
    <div class="info-card">
      <div class="info-hdr">Invoice Details</div>
      <div class="irow"><span class="ilbl">Invoice No</span><span class="ival">${data.invoiceNumber}</span></div>
      <div class="irow"><span class="ilbl">Issue Date</span><span class="ival">${fmtDate(data.invoiceDate)}</span></div>
      ${data.dueDate ? `<div class="irow"><span class="ilbl">Due Date</span><span class="ival">${fmtDate(data.dueDate)}</span></div>` : ''}
      <div class="irow"><span class="ilbl">Status</span><span class="ival"><span class="${statusClass}">${data.status}</span></span></div>
    </div>
  </div>

  <!-- Items Table: one tbl-wrap per page, pg-break sits outside between them -->
  ${itemGroups}
  <!-- Summary -->
  <div class="sum-box">
    <div class="sum-row sub">
      <span class="sum-l">Sub Total</span>
      <span class="sum-v">${fmtMoney(summary.subtotalCents)}</span>
    </div>
    ${summary.discountCents > 0 ? `
    <div class="sum-row disc">
      <span class="sum-l">Discount</span>
      <span class="sum-v">- ${fmtMoney(summary.discountCents)}</span>
    </div>` : ''}
    ${summary.taxCents > 0 ? `
    <div class="sum-row">
      <span class="sum-l">Tax (VAT 10%)</span>
      <span class="sum-v">${fmtMoney(summary.taxCents)}</span>
    </div>` : ''}
    <div class="sum-row grand">
      <span class="sum-l">Grand Total</span>
      <span class="sum-v">${fmtMoney(summary.grandTotalCents)}</span>
    </div>
  </div>

  <!-- Payment + Notes -->
  <div class="bottom-row">
    <div class="pay-card">
      <div class="pay-hdr">Payment Information</div>
      <div class="pay-row"><span class="pay-l">Bank Name</span><span class="pay-v">${payment.bankName}</span></div>
      <div class="pay-row"><span class="pay-l">Account Name</span><span class="pay-v">${payment.accountName}</span></div>
      <div class="pay-row"><span class="pay-l">Account No</span><span class="pay-v">${payment.accountNumber}</span></div>
      <div class="pay-row"><span class="pay-l">Swift Code</span><span class="pay-v">${payment.swiftCode}</span></div>
    </div>
    ${data.notes ? `
    <div class="notes-card">
      <div class="notes-hdr">Notes</div>
      <div class="notes-body">${data.notes}</div>
    </div>` : ''}
  </div>

  <!-- Terms & Conditions -->
  ${data.terms ? `
  <div class="terms-card">
    <div class="terms-hdr">Terms &amp; Conditions</div>
    <div class="terms-body">${data.terms}</div>
  </div>` : ''}


</div><!-- /body -->

<!-- Signature footer -->
<div style="padding:0 40px 20px;">
  <div class="sig-section">
    <div class="sig-col">
      <div class="sig-line">${data.signatureUrl ? `<img class="sig-img" src="${data.signatureUrl}"/>` : ''}</div>
      <div class="sig-lbl">Prepared By</div>
    </div>
    <div class="sig-col">
      <div class="sig-line"></div>
      <div class="sig-lbl">Customer Signature</div>
    </div>
    <div class="sig-col">
      <div class="sig-line"></div>
      <div class="sig-lbl">Received By</div>
    </div>
  </div>
</div>
</body>
</html>`;
};

// ─── PDF Template (clone of print template — customise independently) ────────

export const buildPDFInvoiceHTML = (data: InvoiceData): string => {
  const { company, customer, items, summary, payment } = data;

  const statusClass  =
    data.status.toLowerCase() === 'paid'      ? 'status-paid'      :
    data.status.toLowerCase() === 'cancelled' ? 'status-cancelled'  : 'status-issued';
  const hasDiscount  = items.some(it => it.discountCents > 0);

  const ROWS_P1 = 13;
  const ROWS_PN = 20;

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

  const groups: InvoiceLineItem[][] = items.length <= ROWS_P1
    ? [items]
    : [
        items.slice(0, ROWS_P1),
        ...Array.from(
          { length: Math.ceil((items.length - ROWS_P1) / ROWS_PN) },
          (_, i) => items.slice(ROWS_P1 + i * ROWS_PN, ROWS_P1 + (i + 1) * ROWS_PN)
        ),
      ];

  const itemGroups = groups.map((grp, gi) => {
    const start = groups.slice(0, gi).reduce((s, g) => s + g.length, 0);
    const rows = grp.map((it, li) => {
      const idx = start + li;
      return `
    <div class="tbl-row${idx % 2 === 1 ? ' alt' : ''}">
      <div class="tbl-cell tc-no">${it.no}</div>
      <div class="tbl-cell tc-bar">${it.barcode || '—'}</div>
      <div class="tbl-cell tc-nam">
        ${it.nameKh ? `<div class="item-kh">${it.nameKh}</div>` : ''}
        <div class="item-name">${it.name}</div>
      </div>
      <div class="tbl-cell tc-unit c">${it.unit || '—'}</div>
      <div class="tbl-cell tc-pri r">${fmtMoney(it.unitPriceCents)}</div>
      <div class="tbl-cell tc-qty c">${it.qty}</div>
      ${hasDiscount ? `<div class="tbl-cell tc-dis r ${it.discountCents > 0 ? 'red' : 'muted'}">${it.discountCents > 0 && it.qty * it.unitPriceCents > 0 ? `%${Math.round(it.discountCents / (it.qty * it.unitPriceCents) * 100)}` : '—'}</div>` : ''}
      <div class="tbl-cell tc-amt r bold">${fmtMoney(it.totalCents)}</div>
    </div>`;
    }).join('');
    const wrap = `<div class="tbl-wrap">${colHdr}${rows}</div>`;
    return gi === 0 ? wrap : `<div class="pg-break"></div>${wrap}`;
  }).join('');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=794,initial-scale=1.0"/>
<style>
  @page { size:A4 portrait; margin:0; }
  *,*::before,*::after {
    box-sizing:border-box; margin:0; padding:0;
    -webkit-print-color-adjust:exact; print-color-adjust:exact;
  }
  body {
    font-family:'Helvetica Neue',Helvetica,'Trebuchet MS',Arial,sans-serif;
    font-size:12px; color:#212121; background:#fff;
    width:794px;
    font-variant-numeric:tabular-nums lining-nums;
  }

  /* ── Header Band ── */
  .inv-hdr {
    background:#fff; color:#212121;
    padding:26px 40px 20px;
    display:flex; align-items:center; gap:16px;
  }
  .logo-wrap {
    width:76px; height:76px; border-radius:12px;
    overflow:hidden; flex-shrink:0;
    background:#F5F5F5;
  }
  .logo-wrap img { width:100%; height:100%; display:block; object-fit:cover; }
  .co-block { flex:1; }
  .co-name  { font-size:20px; font-weight:900; letter-spacing:3px; text-transform:uppercase; color:#212121; }
  .co-sub   { font-size:10px; color:#757575; line-height:1.7; margin-top:4px; }
  .inv-title-wrap { text-align:center; margin-bottom:22px; }
  .inv-title  { font-size:30px; font-weight:900; letter-spacing:6px; text-transform:uppercase; color:#37474F; line-height:1; display:inline-block; border-bottom:2.5px solid #37474F; padding-bottom:0; }
  .inv-badge  {
    display:inline-block; flex-shrink:0;
    padding:4px 14px; border-radius:12px;
    font-size:10px; font-weight:700; letter-spacing:.5px; text-transform:uppercase;
  }

  /* ── Body ── */
  .body { padding:26px 40px 40px; }

  /* ── Info Cards ── */
  .info-row { display:flex; gap:14px; margin-bottom:22px; }
  .info-card {
    flex:1; padding:13px 15px;
    border:1px solid #EEE; border-radius:10px; background:#FAFAFA;
  }
  .info-hdr {
    font-size:10px; font-weight:700;
    text-transform:uppercase; letter-spacing:1px;
    color:#546E7A; padding-bottom:5px; margin-bottom:8px;
    border-bottom:2px solid #546E7A;
  }
  .irow { display:flex; gap:6px; margin-bottom:4px; align-items:baseline; }
  .ilbl { font-size:9.5px; color:#9E9E9E; font-weight:600; width:80px; flex-shrink:0; }
  .ival { font-size:11px; font-weight:600; color:#212121; font-variant-numeric:tabular-nums lining-nums; }
  .status-issued    { background:#E3F2FD; color:#1565C0; padding:2px 10px; border-radius:10px; font-size:10px; font-weight:700; }
  .status-paid      { background:#E8F5E9; color:#2E7D32; padding:2px 10px; border-radius:10px; font-size:10px; font-weight:700; }
  .status-cancelled { background:#FFEBEE; color:#C62828; padding:2px 10px; border-radius:10px; font-size:10px; font-weight:700; }

  /* ── Section Title ── */
  .sec-title {
    font-size:11px; font-weight:700; text-transform:uppercase;
    letter-spacing:1px; color:#546E7A; margin-bottom:9px;
  }

  /* ── Items Table ── */
  .tbl-wrap { border:1px solid #EEE; margin-bottom:0; }
  .tbl-row {
    display:flex; align-items:stretch;
    min-height:36px;
    border-bottom:1px solid #F5F5F5;
    page-break-inside:avoid; break-inside:avoid;
  }
  .tbl-row:last-child { border-bottom:none; }
  .hdr-row { background:#E3F2FD; border-bottom:2px solid #BBDEFB; }
  .pg-break { page-break-after:always; break-after:always; height:0; margin:0; padding:0; }
  .tbl-row.alt { background:#FAFAFA; }
  .tbl-cell {
    padding:6px 12px; font-size:12px;
    display:flex; align-items:center;
    font-variant-numeric:tabular-nums lining-nums;
  }
  .hdr-row .tbl-cell {
    font-size:10px; font-weight:700;
    text-transform:uppercase; letter-spacing:.5px;
    color:#1565C0; padding:10px 12px;
  }
  .tc-no   { width:50px; flex-shrink:0; justify-content:center; text-align:center; font-size:13px; font-weight:700; }
  .tc-bar  { width:100px; flex-shrink:0; color:#212121; }
  .tc-nam  { flex:1; flex-direction:column; align-items:flex-start; justify-content:center; gap:2px; }
  .tc-unit { width:46px; flex-shrink:0; justify-content:center; text-align:center; font-size:10px; }
  .tc-pri  { width:70px; flex-shrink:0; justify-content:flex-end; text-align:right; }
  .tc-qty  { width:34px; flex-shrink:0; justify-content:center; text-align:center; }
  .tc-dis  { width:70px; flex-shrink:0; justify-content:flex-end; text-align:right; }
  .tc-amt  { width:76px; flex-shrink:0; justify-content:flex-end; text-align:right; }

  .c { justify-content:center; text-align:center; }
  .r { justify-content:flex-end; text-align:right; }
  .red   { color:#546E7A; }
  .muted { color:#BDBDBD; }
  .bold  { font-weight:700; }
  .item-name { font-weight:600; font-size:12px; }
  .item-kh   { font-size:12px; color:#212121; }

  /* ── Summary ── */
  .sum-box { border:1px solid #EEE; border-top:none; page-break-inside:avoid; break-inside:avoid; }
  .sum-row {
    display:flex; justify-content:space-between; align-items:center;
    padding:9px 16px; font-size:12px;
    border-bottom:1px solid #F5F5F5;
  }
  .sum-row:last-child { border-bottom:none; }
  .sum-row.sub { background:#FAFAFA; }
  .sum-row.disc .sum-v { color:#546E7A; }
  .sum-row.grand {
    background:#37474F; color:#fff;
    font-size:14px; font-weight:800; padding:12px 16px;
  }
  .sum-row.grand .sum-l,
  .sum-row.grand .sum-v { color:#fff; }
  .sum-l { font-weight:600; }
  .sum-v { font-weight:700; }

  /* ── Bottom Section ── */
  .bottom-row { display:flex; gap:14px; margin-top:16px; margin-bottom:18px; page-break-before:always; break-before:always; page-break-inside:avoid; break-inside:avoid; }

  .pay-card { flex:1; border:1px solid #EEE; border-radius:10px; overflow:hidden; }
  .pay-hdr  {
    background:#212121; color:#fff;
    padding:10px 14px;
    font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:1px;
  }
  .pay-row  { display:flex; align-items:baseline; padding:8px 14px; border-bottom:1px solid #F5F5F5; }
  .pay-row:last-child { border-bottom:none; }
  .pay-l { width:105px; font-size:10px; color:#9E9E9E; font-weight:600; flex-shrink:0; }
  .pay-v { font-size:11px; font-weight:700; }

  .notes-card { flex:1; border:1px solid #EEE; border-radius:10px; overflow:hidden; }
  .notes-hdr  { background:#F5F5F5; padding:10px 14px; font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:1px; color:#555; }
  .notes-body { padding:12px 14px; font-size:11px; line-height:1.7; color:#555; }

  /* ── Terms ── */
  .terms-card { border:1px solid #EEE; border-radius:10px; overflow:hidden; margin-bottom:18px; page-break-inside:avoid; break-inside:avoid; }
  .terms-hdr  { background:#F5F5F5; padding:10px 14px; font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:1px; color:#555; }
  .terms-body { padding:12px 14px; font-size:10px; line-height:1.8; color:#777; white-space:pre-line; }

  /* ── Signature ── */
  .sig-section { display:flex; page-break-inside:avoid; break-inside:avoid; margin-top:10px; }
  .sig-col { flex:1; text-align:center; font-size:11px; font-weight:700; color:#555; padding:4px 5px 6px; }
  .sig-line { height:55px; overflow:hidden; margin:0 8px 4px; }
  .sig-lbl { border-top:1.5px solid #333; margin:0 8px; padding-top:4px; }
  .sig-img { display:block; max-width:100%; max-height:50px; object-fit:contain; margin:4px auto 0; }

  /* ── Footer strip ── */
  .footer {
    background:#F5F5F5; color:#757575;
    text-align:center; padding:10px;
    font-size:10px; letter-spacing:.4px;
    margin-top:20px; border-top:1px solid #EEE;
  }
</style>
</head>
<body>

<!-- ── Header ── -->
<div class="inv-hdr">
  <div class="logo-wrap">
    <img src="${LOGO_BASE64}" alt="logo"/>
  </div>
  <div class="co-block">
    <div class="co-name">${company.name}</div>
    <div class="co-sub">${company.addr1}<br/>${company.addr2}<br/>${company.phone} &nbsp;·&nbsp; ${company.email}</div>
  </div>
</div>

<!-- ── Body ── -->
<div class="body">

  <!-- INVOICE title -->
  <div class="inv-title-wrap">
    <div class="inv-title">INVOICE</div>
  </div>

  <!-- Bill To + Invoice Details -->
  <div class="info-row">
    <div class="info-card">
      <div class="info-hdr">Bill To</div>
      <div class="irow"><span class="ilbl">Name</span><span class="ival">${customer.name}</span></div>
      <div class="irow"><span class="ilbl">Campus</span><span class="ival">${customer.companyName}</span></div>
      <div class="irow"><span class="ilbl">SO No</span><span class="ival">${data.invoiceNumber}</span></div>
      <div class="irow"><span class="ilbl">Phone</span><span class="ival">${customer.phone}</span></div>
      <div class="irow"><span class="ilbl">Email</span><span class="ival">${customer.email}</span></div>
      <div class="irow"><span class="ilbl">Address</span><span class="ival">${customer.address}</span></div>
    </div>
    <div class="info-card">
      <div class="info-hdr">Invoice Details</div>
      <div class="irow"><span class="ilbl">Invoice No</span><span class="ival">${data.invoiceNumber}</span></div>
      <div class="irow"><span class="ilbl">Issue Date</span><span class="ival">${fmtDate(data.invoiceDate)}</span></div>
      ${data.dueDate ? `<div class="irow"><span class="ilbl">Due Date</span><span class="ival">${fmtDate(data.dueDate)}</span></div>` : ''}
      <div class="irow"><span class="ilbl">Status</span><span class="ival"><span class="${statusClass}">${data.status}</span></span></div>
    </div>
  </div>

  <!-- Items Table -->
  ${itemGroups}
  <!-- Summary -->
  <div class="sum-box">
    <div class="sum-row sub">
      <span class="sum-l">Sub Total</span>
      <span class="sum-v">${fmtMoney(summary.subtotalCents)}</span>
    </div>
    ${summary.discountCents > 0 ? `
    <div class="sum-row disc">
      <span class="sum-l">Discount</span>
      <span class="sum-v">- ${fmtMoney(summary.discountCents)}</span>
    </div>` : ''}
    ${summary.taxCents > 0 ? `
    <div class="sum-row">
      <span class="sum-l">Tax (VAT 10%)</span>
      <span class="sum-v">${fmtMoney(summary.taxCents)}</span>
    </div>` : ''}
    <div class="sum-row grand">
      <span class="sum-l">Grand Total</span>
      <span class="sum-v">${fmtMoney(summary.grandTotalCents)}</span>
    </div>
  </div>

  <!-- Payment + Notes -->
  <div class="bottom-row">
    <div class="pay-card">
      <div class="pay-hdr">Payment Information</div>
      <div class="pay-row"><span class="pay-l">Bank Name</span><span class="pay-v">${payment.bankName}</span></div>
      <div class="pay-row"><span class="pay-l">Account Name</span><span class="pay-v">${payment.accountName}</span></div>
      <div class="pay-row"><span class="pay-l">Account No</span><span class="pay-v">${payment.accountNumber}</span></div>
      <div class="pay-row"><span class="pay-l">Swift Code</span><span class="pay-v">${payment.swiftCode}</span></div>
    </div>
    ${data.notes ? `
    <div class="notes-card">
      <div class="notes-hdr">Notes</div>
      <div class="notes-body">${data.notes}</div>
    </div>` : ''}
  </div>

  <!-- Terms & Conditions -->
  ${data.terms ? `
  <div class="terms-card">
    <div class="terms-hdr">Terms &amp; Conditions</div>
    <div class="terms-body">${data.terms}</div>
  </div>` : ''}


</div><!-- /body -->

<!-- Signature footer -->
<div style="padding:0 40px 20px;">
  <div class="sig-section">
    <div class="sig-col">
      <div class="sig-line">${data.signatureUrl ? `<img class="sig-img" src="${data.signatureUrl}"/>` : ''}</div>
      <div class="sig-lbl">Prepared By</div>
    </div>
    <div class="sig-col">
      <div class="sig-line"></div>
      <div class="sig-lbl">Customer Signature</div>
    </div>
    <div class="sig-col">
      <div class="sig-line"></div>
      <div class="sig-lbl">Received By</div>
    </div>
  </div>
</div>
</body>
</html>`;
};

// ─── Sub-components (native React Native) ────────────────────────────────────

interface InvoiceHeaderProps {
  company: CompanyInfo;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate?: string;
  status: string;
}

const InvoiceHeader: React.FC<InvoiceHeaderProps> = ({ company, invoiceNumber, invoiceDate, dueDate, status }) => {
  const badgeBg =
    status.toLowerCase() === 'paid'      ? '#E8F5E9' :
    status.toLowerCase() === 'cancelled' ? '#FFEBEE' : '#E3F2FD';
  const badgeColor =
    status.toLowerCase() === 'paid'      ? '#2E7D32' :
    status.toLowerCase() === 'cancelled' ? '#C62828' : '#1565C0';

  return (
    <View style={cs.hdrCard}>
      <View style={cs.hdrBand}>
        <View style={cs.hdrLeft}>
          <View style={cs.hdrLogoBox}>
            <Icon name="business" size={34} color="rgba(255,255,255,0.6)"/>
          </View>
          <View style={cs.hdrCoInfo}>
            <Text style={cs.hdrCoName}>{company.name}</Text>
            <Text style={cs.hdrCoSub}>{company.addr1}</Text>
            <Text style={cs.hdrCoSub}>{company.addr2}</Text>
            <Text style={cs.hdrCoSub}>{company.phone} · {company.email}</Text>
          </View>
        </View>
        <View style={cs.hdrRight}>
          <Text style={cs.hdrWordFaint}>INVOICE</Text>
          <Text style={cs.hdrInvNum}>{invoiceNumber}</Text>
          <View style={[cs.statusBadge, { backgroundColor: badgeBg }]}>
            <Text style={[cs.statusBadgeTxt, { color: badgeColor }]}>{status}</Text>
          </View>
        </View>
      </View>
      <View style={cs.hdrMeta}>
        <View style={cs.hdrMetaItem}>
          <Text style={cs.metaLbl}>Issue Date</Text>
          <Text style={cs.metaVal}>{fmtDate(invoiceDate)}</Text>
        </View>
        {dueDate ? (
          <View style={cs.hdrMetaItem}>
            <Text style={cs.metaLbl}>Due Date</Text>
            <Text style={[cs.metaVal, { color: P }]}>{fmtDate(dueDate)}</Text>
          </View>
        ) : null}
        <View style={cs.hdrMetaItem}>
          <Text style={cs.metaLbl}>Invoice No</Text>
          <Text style={cs.metaVal}>{invoiceNumber}</Text>
        </View>
      </View>
    </View>
  );
};

// ─────────────────────────────────────────────────────────────────────────────

const CustomerInfo: React.FC<{ customer: CustomerInfo }> = ({ customer }) => (
  <View style={cs.card}>
    <View style={cs.cardHdrRow}>
      <View style={cs.cardHdrDot}/>
      <Text style={cs.cardHdrTxt}>Bill To</Text>
    </View>
    <View style={cs.custGrid}>
      {[
        ['Name',    customer.name],
        ['Company', customer.companyName],
        ['Phone',   customer.phone],
        ['Email',   customer.email],
        ['Address', customer.address],
      ].map(([lbl, val]) => (
        <View style={cs.custRow} key={lbl}>
          <Text style={cs.custLbl}>{lbl}</Text>
          <Text style={cs.custVal}>{val || '—'}</Text>
        </View>
      ))}
    </View>
  </View>
);

// ─────────────────────────────────────────────────────────────────────────────

const InvoiceItems: React.FC<{ items: InvoiceLineItem[] }> = ({ items }) => (
  <View style={cs.card}>
    <View style={cs.cardHdrRow}>
      <View style={cs.cardHdrDot}/>
      <Text style={cs.cardHdrTxt}>Invoice Items</Text>
    </View>
    {/* Table Header */}
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View style={{ minWidth: '100%' }}>
        <View style={cs.tblHdr}>
          <Text style={[cs.tblHdrCell, cs.colNo]}>#</Text>
          <Text style={[cs.tblHdrCell, cs.colBar]}>Barcode</Text>
          <Text style={[cs.tblHdrCell, cs.colDesc]}>Description</Text>
          <Text style={[cs.tblHdrCell, cs.colUnit, { textAlign: 'center' }]}>Unit</Text>
          <Text style={[cs.tblHdrCell, cs.colPri, { textAlign: 'right' }]}>Price</Text>
          <Text style={[cs.tblHdrCell, cs.colQty, { textAlign: 'center' }]}>Qty</Text>
          <Text style={[cs.tblHdrCell, cs.colDis, { textAlign: 'right' }]}>Discount</Text>
          <Text style={[cs.tblHdrCell, cs.colAmt, { textAlign: 'right' }]}>Amount</Text>
        </View>
        {items.map((it, idx) => (
          <View key={it.no} style={[cs.tblRow, idx % 2 === 1 && cs.tblRowAlt]}>
            <Text style={[cs.tblCell, cs.colNo, { textAlign: 'center' }]}>{it.no}</Text>
            <Text style={[cs.tblCell, cs.colBar, cs.tblBarcode]}>{it.barcode || '—'}</Text>
            <View style={cs.colDesc}>
              {!!it.nameKh && <Text style={cs.tblItemKh}>{it.nameKh}</Text>}
              <Text style={cs.tblItemName}>{it.name}</Text>
            </View>
            <Text style={[cs.tblCell, cs.colUnit, { textAlign: 'center' }]}>{it.unit || '—'}</Text>
            <Text style={[cs.tblCell, cs.colPri, { textAlign: 'right' }]}>{fmtMoney(it.unitPriceCents)}</Text>
            <Text style={[cs.tblCell, cs.colQty, { textAlign: 'center' }]}>{it.qty}</Text>
            <Text style={[cs.tblCell, cs.colDis, { textAlign: 'right', color: it.discountCents > 0 ? P : '#BDBDBD' }]}>
              {it.discountCents > 0 ? `- ${fmtMoney(it.discountCents)}` : '—'}
            </Text>
            <Text style={[cs.tblCell, cs.colAmt, { textAlign: 'right', fontWeight: '700' }]}>{fmtMoney(it.totalCents)}</Text>
          </View>
        ))}
      </View>
    </ScrollView>
  </View>
);

// ─────────────────────────────────────────────────────────────────────────────

const InvoiceSummary: React.FC<{ summary: InvoiceSummaryData }> = ({ summary }) => (
  <View style={cs.card}>
    <View style={cs.cardHdrRow}>
      <View style={cs.cardHdrDot}/>
      <Text style={cs.cardHdrTxt}>Summary</Text>
    </View>
    <View style={cs.sumRows}>
      <View style={cs.sumRow}>
        <Text style={cs.sumLbl}>Sub Total</Text>
        <Text style={cs.sumVal}>{fmtMoney(summary.subtotalCents)}</Text>
      </View>
      {summary.discountCents > 0 && (
        <View style={cs.sumRow}>
          <Text style={cs.sumLbl}>Discount</Text>
          <Text style={[cs.sumVal, { color: P }]}>- {fmtMoney(summary.discountCents)}</Text>
        </View>
      )}
      {summary.taxCents > 0 && (
        <View style={cs.sumRow}>
          <Text style={cs.sumLbl}>Tax (VAT)</Text>
          <Text style={cs.sumVal}>{fmtMoney(summary.taxCents)}</Text>
        </View>
      )}
      <View style={[cs.sumRow, cs.sumGrand]}>
        <Text style={cs.sumGrandLbl}>Grand Total</Text>
        <Text style={cs.sumGrandVal}>{fmtMoney(summary.grandTotalCents)}</Text>
      </View>
    </View>
  </View>
);

// ─────────────────────────────────────────────────────────────────────────────

const PaymentInfo: React.FC<{ payment: PaymentInfo }> = ({ payment }) => (
  <View style={cs.card}>
    <View style={cs.cardHdrRow}>
      <View style={cs.cardHdrDot}/>
      <Text style={cs.cardHdrTxt}>Payment Information</Text>
    </View>
    {[
      ['Bank Name',      payment.bankName],
      ['Account Name',   payment.accountName],
      ['Account Number', payment.accountNumber],
      ['Swift Code',     payment.swiftCode],
    ].map(([lbl, val]) => (
      <View style={cs.payRow} key={lbl}>
        <Text style={cs.payLbl}>{lbl}</Text>
        <Text style={cs.payVal}>{val}</Text>
      </View>
    ))}
  </View>
);

// ─────────────────────────────────────────────────────────────────────────────

const InvoiceFooter: React.FC<{ notes?: string; terms?: string }> = ({ notes, terms }) => (
  <View>
    {!!notes && (
      <View style={cs.card}>
        <View style={cs.cardHdrRow}>
          <View style={cs.cardHdrDot}/>
          <Text style={cs.cardHdrTxt}>Notes</Text>
        </View>
        <Text style={cs.footerBody}>{notes}</Text>
      </View>
    )}
    {!!terms && (
      <View style={cs.card}>
        <View style={cs.cardHdrRow}>
          <View style={cs.cardHdrDot}/>
          <Text style={cs.cardHdrTxt}>Terms &amp; Conditions</Text>
        </View>
        <Text style={cs.footerBody}>{terms}</Text>
      </View>
    )}
    {/* Signature Area */}
    <View style={cs.card}>
      <View style={cs.cardHdrRow}>
        <View style={cs.cardHdrDot}/>
        <Text style={cs.cardHdrTxt}>Signature</Text>
      </View>
      <View style={cs.sigRow}>
        {['Prepared By', 'Customer Signature', 'Received By'].map(lbl => (
          <View style={cs.sigBox} key={lbl}>
            <View style={cs.sigLine}/>
            <Text style={cs.sigLbl}>{lbl}</Text>
          </View>
        ))}
      </View>
    </View>
  </View>
);

// ─── Main Screen ──────────────────────────────────────────────────────────────

const SaleOrderInvoiceScreen: React.FC<Props> = ({ orderId, onBack }) => {
  const { showAlert } = useAlert();

  const [invoiceData, setInvoiceData] = useState<InvoiceData | null>(null);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState<string | null>(null);
  const [exporting,    setExporting]    = useState(false);
  const [exportingPDF, setExportingPDF] = useState(false);
  const [sharingTelegram, setSharingTelegram] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    Promise.all([getSalesOrderApi(orderId), getAllProductsApi(), getDeliveryOrdersApi(), getUomsApi()])
      .then(async ([order, products, dos, uoms]) => {
        const prodMap: Record<string, ApiProduct> = {};
        products.forEach(p => { prodMap[p.id] = p; });
        const uomMap: Record<number, ApiUom> = {};
        uoms.forEach(u => { uomMap[u.id] = u; });

        const rawItems = [...(order.items ?? [])].sort((a, b) => Number(a.id) - Number(b.id));
        const items: InvoiceLineItem[] = rawItems.map((it, i) => {
          const p   = prodMap[it.productId];
          const dis = it.discountCents ?? 0;
          return {
            no:             i + 1,
            barcode:        p?.barcode ?? p?.sku ?? it.productCode ?? '',
            name:           p?.nameEn ?? it.productName ?? `Item #${it.productId}`,
            nameKh:         p?.nameKm ?? '',
            unit:           (p?.uomId != null ? uomMap[p.uomId]?.code : undefined) ?? p?.unit ?? '',
            qty:            it.qty,
            unitPriceCents: it.unitPriceCents,
            discountCents:  dis,
            totalCents:     it.qty * it.unitPriceCents - dis,
          };
        });

        const subtotal  = items.reduce((s, it) => s + it.qty * it.unitPriceCents, 0);
        const discount  = items.reduce((s, it) => s + it.discountCents, 0);
        const grandTotal = order.totalCents != null
          ? order.totalCents
          : items.reduce((s, it) => s + it.totalCents, 0);

        const sigUrl = dos.find(d => d.soId === orderId)?.signatureUrl ?? null;
        const sigData = sigUrl ? await fetchBase64(sigUrl) : null;

        const campusName = String(order.campusId ?? '');
        const customerOrg = order.customerOrg ?? order.org;

        setInvoiceData({
          invoiceNumber: order.referenceNumber ?? order.ref ?? order.id,
          invoiceDate:   order.orderDate ?? order.createdAt,
          status:        order.status ?? 'DRAFT',
          company:       COMPANY_INFO,
          customer: {
            name:        customerOrg?.nameEn ?? customerOrg?.name ?? '—',
            companyName: campusName,
            phone:       '—',
            email:       '—',
            address:     '—',
          },
          items,
          summary: { subtotalCents: subtotal, discountCents: discount, taxCents: 0, grandTotalCents: grandTotal },
          payment: PAYMENT_INFO,
          notes:   order.note ?? undefined,
          signatureUrl: sigData,
        });
      })
      .catch(e => setError(e?.message ?? 'Failed to load invoice'))
      .finally(() => setLoading(false));
  }, [orderId]);

  useEffect(() => { load(); }, [load]);

  const handlePrint = async () => {
    if (!invoiceData) return;
    try {
      setExporting(true);
      await Print.printAsync({ html: buildModernInvoiceHTML(invoiceData) });
    } catch (e: any) {
      showAlert({ type: 'error', title: 'Print Error', message: e?.message ?? 'Failed to print' });
    } finally {
      setExporting(false);
    }
  };

  const handleExportPDF = async () => {
    if (!invoiceData) return;
    try {
      setExportingPDF(true);
      const fileName = `INV-${invoiceData.invoiceNumber.replace(/[^a-zA-Z0-9]/g, '-')}-${Date.now()}`;
      const result = await Print.printToFileAsync({ html: buildPDFInvoiceHTML(invoiceData), width: 794, height: 1123 });
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) await Sharing.shareAsync(result.uri, { mimeType: 'application/pdf', dialogTitle: `Invoice ${invoiceData.invoiceNumber}` });
    } catch (e: any) {
      if (e?.message !== 'User cancelled') {
        showAlert({ type: 'error', title: 'Export Error', message: e?.message ?? 'Failed to export PDF' });
      }
    } finally {
      setExportingPDF(false);
    }
  };

  const handleShareToTelegram = async () => {
    if (!invoiceData) return;
    try {
      setSharingTelegram(true);
      const fileName = `INV-${invoiceData.invoiceNumber.replace(/[^a-zA-Z0-9]/g, '-')}-${Date.now()}`;
      const result = await Print.printToFileAsync({ html: buildPDFInvoiceHTML(invoiceData), width: 794, height: 1123 });
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) await Sharing.shareAsync(result.uri, { mimeType: 'application/pdf', dialogTitle: `Invoice ${invoiceData.invoiceNumber}` });
    } catch (e: any) {
      if (e?.message !== 'User cancelled') {
        showAlert({ type: 'error', title: 'Telegram Error', message: e?.message ?? 'Failed to share to Telegram' });
      }
    } finally {
      setSharingTelegram(false);
    }
  };

  if (loading) return (
    <View style={ss.safe}>
      <AppBar title="Invoice" titleAlign="left" showBack onBack={onBack}/>
      <View style={ss.center}><ActivityIndicator size="large" color={P}/></View>
    </View>
  );

  if (error || !invoiceData) return (
    <View style={ss.safe}>
      <AppBar title="Invoice" titleAlign="left" showBack onBack={onBack}/>
      <View style={ss.center}>
        <Icon name="error-outline" size={48} color={P}/>
        <Text style={ss.errTxt}>{error ?? 'Invoice not found'}</Text>
        <TouchableOpacity onPress={load} style={ss.retryBtn}>
          <Text style={ss.retryTxt}>Retry</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <View style={ss.safe}>
      <AppBar
        title={invoiceData.invoiceNumber}
        subtitle="Invoice"
        titleAlign="left"
        showBack
        onBack={onBack}
        rightActions={
          <View style={ss.actions}>
            <TouchableOpacity style={ss.actionBtn} onPress={handleShareToTelegram} disabled={sharingTelegram}>
              {sharingTelegram
                ? <ActivityIndicator size="small" color="#fff"/>
                : <Icon name="send" size={20} color="#fff"/>}
            </TouchableOpacity>
            <TouchableOpacity style={ss.actionBtn} onPress={handleExportPDF} disabled={exportingPDF}>
              {exportingPDF
                ? <ActivityIndicator size="small" color="#fff"/>
                : <Icon name="picture-as-pdf" size={20} color="#fff"/>}
            </TouchableOpacity>
            <TouchableOpacity style={ss.actionBtn} onPress={handlePrint} disabled={exporting}>
              {exporting
                ? <ActivityIndicator size="small" color="#fff"/>
                : <Icon name="print" size={20} color="#fff"/>}
            </TouchableOpacity>
          </View>
        }
      />
      <ScrollView
        style={ss.scroll}
        contentContainerStyle={ss.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <InvoiceHeader
          company={invoiceData.company}
          invoiceNumber={invoiceData.invoiceNumber}
          invoiceDate={invoiceData.invoiceDate}
          dueDate={invoiceData.dueDate}
          status={invoiceData.status}
        />
        <CustomerInfo   customer={invoiceData.customer}/>
        <InvoiceItems   items={invoiceData.items}/>
        <InvoiceSummary summary={invoiceData.summary}/>
        <PaymentInfo    payment={invoiceData.payment}/>
        <InvoiceFooter  notes={invoiceData.notes} terms={invoiceData.terms}/>
      </ScrollView>
    </View>
  );
};

// ─── Component Styles ─────────────────────────────────────────────────────────

const shadow = Platform.select({
  ios:     { shadowColor: '#000', shadowOffset: { width:0, height:2 }, shadowOpacity: 0.07, shadowRadius: 8 },
  android: { elevation: 3 },
});

const cs = StyleSheet.create({
  // Header card
  hdrCard:      { marginHorizontal: 16, marginTop: 16, borderRadius: 12, overflow: 'hidden', ...shadow },
  hdrBand:      { backgroundColor: '#fff', padding: 18, flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  hdrLeft:      { flex: 1, flexDirection: 'row', gap: 12 },
  hdrLogoBox:   { width: 60, height: 60, borderRadius: 10, backgroundColor: '#F5F5F5', alignItems: 'center', justifyContent: 'center' },
  hdrCoInfo:    { flex: 1 },
  hdrCoName:    { fontSize: 16, fontWeight: '900', color: INK, letterSpacing: 2 },
  hdrCoSub:     { fontSize: 10, color: SUB, marginTop: 2, lineHeight: 16 },
  hdrRight:     { alignItems: 'flex-end' },
  hdrWordFaint: { fontSize: 22, fontWeight: '900', color: P, opacity: 0.15, letterSpacing: 4 },
  hdrInvNum:    { fontSize: 13, fontWeight: '800', color: INK, marginTop: 2 },
  statusBadge:  { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 10, marginTop: 6 },
  statusBadgeTxt:{ fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  hdrMeta:      { backgroundColor: '#FAFAFA', flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1, borderTopColor: BDR },
  hdrMetaItem:  { flex: 1 },
  metaLbl:      { fontSize: 10, color: SUB, fontWeight: '600', marginBottom: 2 },
  metaVal:      { fontSize: 13, fontWeight: '700', color: INK },

  // Generic card
  card:      { backgroundColor: '#fff', marginHorizontal: 16, marginTop: 12, borderRadius: 12, padding: 16, ...shadow },
  cardHdrRow:{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  cardHdrDot:{ width: 4, height: 16, borderRadius: 2, backgroundColor: P },
  cardHdrTxt:{ fontSize: 13, fontWeight: '700', color: INK, textTransform: 'uppercase', letterSpacing: 0.5 },

  // Customer
  custGrid: {},
  custRow:  { flexDirection: 'row', paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: '#F5F5F5' },
  custLbl:  { width: 90, fontSize: 12, color: SUB, fontWeight: '600' },
  custVal:  { flex: 1, fontSize: 12, color: INK, fontWeight: '500' },

  // Table
  tblHdr:     { flexDirection: 'row', backgroundColor: '#37474F', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 8, marginBottom: 2 },
  tblHdrCell: { fontSize: 9, fontWeight: '700', color: '#fff', textTransform: 'uppercase', letterSpacing: 0.3 },
  tblRow:     { flexDirection: 'row', paddingHorizontal: 8, paddingVertical: 7, alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#F5F5F5' },
  tblRowAlt:  { backgroundColor: SURF },
  tblCell:    { fontSize: 11, color: INK },
  tblItemName:{ fontSize: 11, fontWeight: '600', color: INK },
  tblItemKh:  { fontSize: 12, color: INK, marginTop: 1 },
  tblItemDesc:{ fontSize: 10, color: SUB, marginTop: 1 },
  tblDisc:    { fontSize: 9, color: P, marginTop: 1 },
  tblBarcode: { fontSize: 11, color: INK },

  // Column widths
  colNo:   { width: 50 },
  colBar:  { width: 100 },
  colDesc: { flex: 1 },
  colUnit: { width: 44 },
  colPri:  { width: 60 },
  colQty:  { width: 28 },
  colDis:  { width: 62 },
  colAmt:  { width: 64 },

  // Summary
  sumRows:    {},
  sumRow:     { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: '#F5F5F5' },
  sumLbl:     { fontSize: 13, fontWeight: '600', color: INK },
  sumVal:     { fontSize: 13, fontWeight: '700', color: INK },
  sumGrand:   { backgroundColor: P, marginHorizontal: -16, paddingHorizontal: 16, borderBottomWidth: 0, marginTop: 4, paddingVertical: 13 },
  sumGrandLbl:{ fontSize: 15, fontWeight: '800', color: '#fff' },
  sumGrandVal:{ fontSize: 15, fontWeight: '900', color: '#fff' },

  // Payment
  payRow: { flexDirection: 'row', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#F5F5F5' },
  payLbl: { width: 130, fontSize: 12, color: SUB, fontWeight: '600' },
  payVal: { flex: 1, fontSize: 12, color: INK, fontWeight: '700' },

  // Footer card body
  footerBody: { fontSize: 13, color: SUB, lineHeight: 20 },

  // Signature
  sigRow:  { flexDirection: 'row', gap: 12, marginTop: 8 },
  sigBox:  { flex: 1, alignItems: 'center' },
  sigLine: { width: '100%', height: 70, borderWidth: 1.5, borderColor: BDR, borderRadius: 6, marginBottom: 6 },
  sigLbl:  { fontSize: 11, fontWeight: '700', color: SUB, textAlign: 'center' },
});

// ─── Screen Styles ────────────────────────────────────────────────────────────

const ss = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: '#F5F5F5' },
  center:      { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 32 },
  errTxt:      { fontSize: 14, color: '#DC2626', textAlign: 'center', marginTop: 8 },
  retryBtn:    { paddingHorizontal: 24, paddingVertical: 10, borderWidth: 1.5, borderColor: P, borderRadius: 8, marginTop: 4 },
  retryTxt:    { fontWeight: '700', fontSize: 13, color: P },
  actions:     { flexDirection: 'row', gap: 8 },
  actionBtn:   {
    width: 36, height: 36, borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center', justifyContent: 'center',
  },
  scroll:       { flex: 1 },
  scrollContent:{ paddingBottom: 32 },
  footerStrip:  {
    marginTop: 20, marginHorizontal: 16, marginBottom: 8,
    backgroundColor: '#F5F5F5', borderRadius: 10, padding: 12,
    alignItems: 'center', borderWidth: 1, borderColor: BDR,
  },
  footerTxt: { fontSize: 11, color: SUB, letterSpacing: 0.3 },
});

export default SaleOrderInvoiceScreen;
