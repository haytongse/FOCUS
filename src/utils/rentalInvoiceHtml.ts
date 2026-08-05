import LOGO_BASE64 from '../logo/logoBase64';
import { ApiRentalInvoiceHeader, ApiRentalInvoiceDetail, ApiRentalUsageMachine } from '../services/focusApi';

// ─── Constants ────────────────────────────────────────────────────────────────
const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];
const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export const COMPANY_INFO = {
  name:  'FOCUS LAB',
  addr1: '#17 St 480, Sangkat Toul Toum Pong 1',
  addr2: 'Khan Chamkarmon, Phnom Penh 12310',
  phone: '0964222816',
  email: 'sen.sov@gmail.com',
};

export const PAYMENT_INFO = {
  bankName:      'ABA Bank',
  accountName:   'SOVITHIA SEN AND TONG LYHEANG AND TE SOPHIE',
  accountNumber: '003 257 965',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
export const fmtPeriodLong = (iso?: string | null): string => {
  if (!iso) return '—';
  try {
    const [y, m] = iso.split('-').map(Number);
    return `${MONTH_NAMES[m - 1]} ${y}`;
  } catch { return iso; }
};

export const fmtDateShort = (iso?: string | null): string => {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return `${d.getDate()} ${MONTH_SHORT[d.getMonth()]} ${d.getFullYear()}`;
  } catch { return iso; }
};

const fmtUsd = (usd: number) => `$${usd.toFixed(2)}`;

const totalCentsToUsd = (v?: number | string | null): number => {
  if (v == null) return 0;
  const n = typeof v === 'string' ? Number(v) : v;
  return isNaN(n) ? 0 : n / 100;
};

// ─── computeRental ────────────────────────────────────────────────────────────
export interface RentalComputed {
  details: ApiRentalInvoiceDetail[];
  totalPages: number;
  totalUsd: number;
  pricePerPage: number;
  campusLabel: string;
  campusCodeStr: string;
  customerName: string;
}

export const computeRental = (
  inv: ApiRentalInvoiceHeader,
  machineList?: ApiRentalUsageMachine[] | null,
): RentalComputed => {
  const details: ApiRentalInvoiceDetail[] =
    machineList && machineList.length > 0
      ? (machineList.map((m, i) => ({
          id: String(i), soId: '', qty: 0,
          unitPriceCents: m.unitPriceCents ?? 0,
          discountCents:  0,
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

  const totalPages = details.reduce((s, d) =>
    s + Math.max(0, Number(d.counterBwEnd ?? 0) - Number(d.counterBwStart ?? 0)), 0);
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

// ─── Exact CSS from RentalInvoicePrintScreen ─────────────────────────────────
const INVOICE_CSS = `
  @page { size:A4 portrait; margin:0; }
  *,*::before,*::after {
    box-sizing:border-box; margin:0; padding:0;
    font-family:'Times New Roman',Times,serif;
    -webkit-print-color-adjust:exact; print-color-adjust:exact;
  }
  html, body {
    font-family:'Times New Roman',Times,serif;
    font-size:12px; color:#212121; background:#fff;
    width:794px;
  }
  table, thead, tbody, tfoot, tr, th, td { font-family:'Times New Roman',Times,serif; }

  /* ── Header Band ── */
  .inv-hdr {
    background:#fff; color:#212121;
    padding:14px 40px;
    display:flex; align-items:center; gap:20px;
  }
  .logo-wrap {
    width:96px; height:96px; border-radius:14px;
    overflow:hidden; flex-shrink:0;
    background:#F5F5F5;
  }
  .logo-wrap img { width:100%; height:100%; display:block; object-fit:cover; }
  .co-block { flex:1; }
  .co-name  { font-size:24px; font-weight:900; letter-spacing:3px; text-transform:uppercase; color:#212121; }
  .co-sub   { font-size:10.5px; color:#757575; line-height:1.8; margin-top:6px; }
  .inv-title-wrap { text-align:center; margin-bottom:22px; }
  .inv-title  { font-size:30px; font-weight:900; letter-spacing:6px; text-transform:uppercase; color:#37474F; line-height:1; display:inline-block; border-bottom:2.5px solid #37474F; padding-bottom:0; }

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
  .ival { font-size:11px; font-weight:600; color:#212121; }
  .status-issued    { background:#E3F2FD; color:#1565C0; padding:2px 10px; border-radius:10px; font-size:10px; font-weight:700; }
  .status-paid      { background:#E8F5E9; color:#2E7D32; padding:2px 10px; border-radius:10px; font-size:10px; font-weight:700; }
  .status-cancelled { background:#FFEBEE; color:#C62828; padding:2px 10px; border-radius:10px; font-size:10px; font-weight:700; }

  /* ── Section Title ── */
  .sec-title {
    font-size:11px; font-weight:700; text-transform:uppercase;
    letter-spacing:1px; color:#546E7A; margin-bottom:9px;
  }

  /* ── Table (div-based — reliable page breaks on iOS WebKit) ── */
  .tbl-wrap { border:1px solid #EEE; margin-bottom:0; }
  .tbl-row {
    display:flex; align-items:stretch;
    min-height:36px;
    border-bottom:1px solid #F5F5F5;
    page-break-inside:avoid; break-inside:avoid;
  }
  .tbl-row:last-child { border-bottom:none; }
  .hdr-row { background:#E3F2FD; border-bottom:2px solid #BBDEFB; }
  .tbl-row.alt { background:#FAFAFA; }
  .tbl-cell {
    padding:6px 12px; font-size:12px;
    display:flex; align-items:center;
  }
  .hdr-row .tbl-cell {
    font-size:10px; font-weight:700;
    text-transform:uppercase; letter-spacing:.5px;
    color:#1565C0; padding:10px 12px;
  }
  .tc-name  { flex:1; flex-direction:column; align-items:flex-start; justify-content:center; gap:2px; }
  .tc-cnt   { width:110px; flex-shrink:0; white-space:nowrap; }
  .item-name { font-weight:600; font-size:12px; }
  .item-sub  { font-size:10px; color:#9E9E9E; margin-top:2px; }

  .r    { justify-content:flex-end; text-align:right; }
  .bold { font-weight:700; }

  /* ── Summary / Cost ── */
  .sum-box { border:1px solid #EEE; border-top:none; page-break-inside:avoid; break-inside:avoid; }
  .sum-row {
    display:flex; justify-content:space-between; align-items:center;
    padding:9px 16px; font-size:12px;
    border-bottom:1px solid #F5F5F5;
  }
  .sum-row:last-child { border-bottom:none; }
  .sum-row.sub { background:#FAFAFA; }
  .sum-row.grand {
    background:#37474F; color:#fff;
    font-size:14px; font-weight:800; padding:12px 16px;
  }
  .sum-row.grand .sum-l,
  .sum-row.grand .sum-v { color:#fff; }
  .sum-l { font-weight:600; }
  .sum-v { font-weight:700; }

  /* ── Section label above table ── */
  .sec-label {
    font-size:11px; font-weight:700; text-transform:uppercase;
    letter-spacing:1px; color:#546E7A; margin-bottom:9px;
  }

  /* ── Bottom Section ── */
  .bottom-row { display:flex; gap:14px; margin-top:16px; margin-bottom:18px; page-break-inside:avoid; break-inside:avoid; }

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

  /* ── Signature ── */
  .sig-row { display:flex; gap:14px; margin-bottom:18px; page-break-inside:avoid; break-inside:avoid; }
  .sig-box { flex:1; text-align:center; }
  .sig-line{ border-bottom:1.5px solid #333; margin:0 10px 6px; height:100px;
             display:flex; align-items:center; justify-content:center; }
  .sig-lbl { font-size:11px; font-weight:700; color:#555; }


`;

// ─── Single invoice body (no <html>/<head> wrapper) ──────────────────────────
const invoiceBodyHTML = (
  inv: ApiRentalInvoiceHeader,
  machineList?: ApiRentalUsageMachine[] | null,
): string => {
  const { details, totalPages, totalUsd, pricePerPage, campusCodeStr } = computeRental(inv, machineList);

  const statusClass =
    (inv.status ?? '').toLowerCase() === 'paid'      ? 'status-paid'      :
    (inv.status ?? '').toLowerCase() === 'cancelled' ? 'status-cancelled' : 'status-issued';

  const invNo     = inv.invoiceNumber ?? '—';
  const invDate   = fmtDateShort(inv.issuedAt ?? inv.createdAt);
  const startDate = fmtDateShort(inv.startDate);
  const endDate   = fmtDateShort(inv.endDate);

  const usageRows = details.map((d, i) => {
    const start       = Number(d.counterBwStart ?? 0);
    const end         = Number(d.counterBwEnd   ?? 0);
    const total       = Math.max(0, end - start);
    const machineName = d.lineLabel ?? d.contractRef ?? `Machine #${i + 1}`;
    const subRef      = d.lineLabel && d.contractRef ? `<div class="item-sub">${d.contractRef}</div>` : '';
    const isAlt       = i % 2 === 1;
    return `
    <div class="tbl-row${isAlt ? ' alt' : ''}">
      <div class="tbl-cell tc-name"><div class="item-name">${machineName}</div>${subRef}</div>
      <div class="tbl-cell tc-cnt r">${start.toLocaleString()}</div>
      <div class="tbl-cell tc-cnt r">${end.toLocaleString()}</div>
      <div class="tbl-cell tc-cnt r bold">${total.toLocaleString()}</div>
    </div>`;
  }).join('');

  return `
<!-- ── Header ── -->
<div class="inv-hdr">
  <div class="logo-wrap">
    <img src="${LOGO_BASE64}" alt="logo"/>
  </div>
  <div class="co-block">
    <div class="co-name">${COMPANY_INFO.name}</div>
    <div class="co-sub">${COMPANY_INFO.addr1}<br/>${COMPANY_INFO.addr2}<br/>${COMPANY_INFO.phone} &nbsp;·&nbsp; ${COMPANY_INFO.email}</div>
  </div>
</div>

<!-- ── Body ── -->
<div class="body">

  <!-- Title -->
  <div class="inv-title-wrap">
    <div class="inv-title">INVOICE</div>
  </div>

  <!-- Bill To + Invoice Details -->
  <div class="info-row">
    <div class="info-card">
      <div class="info-hdr">Bill To</div>
      <div class="irow"><span class="ilbl">Campus Code</span><span class="ival">${campusCodeStr}</span></div>
      ${inv.startDate ? `<div class="irow"><span class="ilbl">From</span><span class="ival">${startDate}</span></div>` : ''}
      ${inv.endDate   ? `<div class="irow"><span class="ilbl">To</span><span class="ival">${endDate}</span></div>` : ''}
      ${inv.note      ? `<div class="irow"><span class="ilbl">Note</span><span class="ival">${inv.note}</span></div>` : ''}
    </div>
    <div class="info-card">
      <div class="info-hdr">Invoice Details</div>
      <div class="irow"><span class="ilbl">Invoice No</span><span class="ival">${invNo}</span></div>
      <div class="irow"><span class="ilbl">Issue Date</span><span class="ival">${invDate}</span></div>
      ${inv.dueAt ? `<div class="irow"><span class="ilbl">Due Date</span><span class="ival">${fmtDateShort(inv.dueAt)}</span></div>` : ''}
      <div class="irow"><span class="ilbl">Status</span><span class="ival"><span class="${statusClass}">${(inv.status ?? '').toUpperCase()}</span></span></div>
    </div>
  </div>

  <!-- Usage Table -->
  <div class="sec-label">Usage</div>
  <div class="tbl-wrap">
    <div class="tbl-row hdr-row">
      <div class="tbl-cell tc-name">Machine Name</div>
      <div class="tbl-cell tc-cnt r">Start</div>
      <div class="tbl-cell tc-cnt r">End</div>
      <div class="tbl-cell tc-cnt r">Total</div>
    </div>
    ${usageRows}
  </div>

  <!-- Usage Total -->
  <div class="sum-box">
    <div class="sum-row sub">
      <span class="sum-l">Total Pages</span>
      <span class="sum-v">${totalPages.toLocaleString()}</span>
    </div>
  </div>

  <!-- Cost Table -->
  <div class="sec-label" style="margin-top:22px;">Cost</div>
  <div class="tbl-wrap">
    <div class="tbl-row hdr-row">
      <div class="tbl-cell tc-name">Usage (pages)</div>
      <div class="tbl-cell tc-cnt r">Price / Page</div>
      <div class="tbl-cell tc-cnt r">Total Price</div>
    </div>
    <div class="tbl-row">
      <div class="tbl-cell tc-name">${totalPages.toLocaleString()}</div>
      <div class="tbl-cell tc-cnt r">$${pricePerPage.toFixed(5)}</div>
      <div class="tbl-cell tc-cnt r bold">${fmtUsd(totalUsd)}</div>
    </div>
  </div>
  <div class="sum-box">
    <div class="sum-row grand">
      <span class="sum-l">Grand Total</span>
      <span class="sum-v">${fmtUsd(totalUsd)}</span>
    </div>
  </div>

  <!-- Payment -->
  <div class="bottom-row">
    <div class="pay-card">
      <div class="pay-hdr">Payment Information</div>
      <div class="pay-row"><span class="pay-l">Bank Name</span><span class="pay-v">${PAYMENT_INFO.bankName}</span></div>
      <div class="pay-row"><span class="pay-l">Account Name</span><span class="pay-v">${PAYMENT_INFO.accountName}</span></div>
      <div class="pay-row"><span class="pay-l">Account No</span><span class="pay-v">${PAYMENT_INFO.accountNumber}</span></div>
    </div>
  </div>

  <!-- Signature -->
  <div class="sig-row">
    <div class="sig-box">
      <div class="sig-line"></div>
      <div class="sig-lbl">Prepared By</div>
    </div>
    <div class="sig-box">
      <div class="sig-line"></div>
      <div class="sig-lbl">Received By</div>
    </div>
  </div>


</div><!-- /body -->`;
};

// ─── Single invoice (used by RentalInvoicePrintScreen) ───────────────────────
export const buildRentalInvoiceHTML = (
  inv: ApiRentalInvoiceHeader,
  machineList?: ApiRentalUsageMachine[] | null,
): string => `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=794,initial-scale=1.0"/>
<style>${INVOICE_CSS}</style>
</head>
<body style="font-family:'Times New Roman',Times,serif;">
${invoiceBodyHTML(inv, machineList)}
</body>
</html>`;

// ─── Multi-invoice PDF (all invoices merged into one file, one page each) ─────
export const buildMultiRentalInvoicesHTML = (
  invoices: Array<{ inv: ApiRentalInvoiceHeader; machines?: ApiRentalUsageMachine[] | null }>,
): string => {
  const total = invoices.length;
  const pages = invoices
    .map(({ inv, machines }, i) => {
      const isLast = i === total - 1;
      const body   = invoiceBodyHTML(inv, machines);
      return `<div style="page-break-after:${isLast ? 'avoid' : 'always'};break-after:${isLast ? 'avoid' : 'always'}">${body}</div>`;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=794,initial-scale=1.0"/>
<style>${INVOICE_CSS}</style>
</head>
<body style="font-family:'Times New Roman',Times,serif;">
${pages}
</body>
</html>`;
};
