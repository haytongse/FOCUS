/* eslint-disable @typescript-eslint/no-var-requires */
const XLSX   = require('xlsx-js-style');
const JSZip  = require('jszip');
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import LOGO_BASE64 from '../logo/logoBase64';
import {
  ApiIncomeStatement,
  ApiInvoiceHeader,
  ApiPurchaseOrder,
  ApiExpense,
  getInvoiceHeadersApi,
  getPurchaseOrdersApi,
  getExpensesApi,
} from '../services/focusApi';

// ── Company constants ─────────────────────────────────────────────────────────

const CO_NAME  = 'FOCUS LAB';
const CO_ADDR  = '#17 St 480, Sangkat Toul Toum Pong 1, Khan Chamkarmon, Phnom Penh 12310';
const CO_TEL   = 'Tel: 0964222816  |  sen.sov@gmail.com';

// ── Logo injection (same pattern as POExportScreen) ───────────────────────────

const LOGO_CX = 1270000;
const LOGO_CY = 1270000;

const makeDrawingXml = () =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><xdr:absoluteAnchor><xdr:pos x="0" y="0"/><xdr:ext cx="${LOGO_CX}" cy="${LOGO_CY}"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="2" name="Logo"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${LOGO_CX}" cy="${LOGO_CY}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:absoluteAnchor></xdr:wsDr>`;

const DRAWING_IMG_RELS =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/></Relationships>`;

const makeSheetRels = (drawingNum: number) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing${drawingNum}.xml"/></Relationships>`;

// Injects logo only into the first sheet (Summary).
const injectLogoIntoXlsx = async (xlsxBase64: string): Promise<string> => {
  const zip = await JSZip.loadAsync(xlsxBase64, { base64: true });
  const rawLogo = LOGO_BASE64.replace(/^data:image\/\w+;base64,/, '');
  zip.file('xl/media/image1.png', rawLogo, { base64: true });
  zip.file('xl/drawings/drawing1.xml', makeDrawingXml());
  zip.file('xl/drawings/_rels/drawing1.xml.rels', DRAWING_IMG_RELS);
  zip.file('xl/worksheets/_rels/sheet1.xml.rels', makeSheetRels(1));
  const sheetFile = 'xl/worksheets/sheet1.xml';
  const sheetXml: string = await zip.file(sheetFile)!.async('text');
  zip.file(sheetFile, sheetXml.replace('</worksheet>', '<drawing r:id="rId1"/></worksheet>'));
  const ct: string = await zip.file('[Content_Types].xml')!.async('text');
  zip.file('[Content_Types].xml', ct.replace(
    '</Types>',
    '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>',
  ));
  return zip.generateAsync({ type: 'base64', compression: 'DEFLATE' });
};

// ── Colour palette ────────────────────────────────────────────────────────────

const C = {
  title:    '0F172A',
  sub:      '64748B',
  label:    '0F172A',
  blue:     '2563EB',
  bgBlue:   'DBEAFE',
  bgYellow: 'FFFF99',
  bgLight:  'F1F5F9',
  white:    'FFFFFF',
};

// ── Cell styles ───────────────────────────────────────────────────────────────

const S = {
  coName: { font: { bold: true, sz: 13, color: { rgb: C.title } } },
  coSub:  { font: { sz: 10, color: { rgb: C.sub } } },

  title: { font: { bold: true, sz: 14, color: { rgb: C.title } } },
  sub:   { font: { sz: 11, color: { rgb: C.sub } } },
  label: { font: { sz: 11, color: { rgb: C.label } } },

  input: {
    font: { sz: 11, color: { rgb: C.blue } },
    fill: { patternType: 'solid', fgColor: { rgb: C.bgYellow } },
  },

  section: {
    font: { bold: true, sz: 11, color: { rgb: C.blue } },
    fill: { patternType: 'solid', fgColor: { rgb: C.bgBlue } },
  },

  formula: { font: { bold: true, sz: 11, color: { rgb: C.title } } },

  header: {
    font: { bold: true, sz: 11, color: { rgb: C.blue } },
    fill: { patternType: 'solid', fgColor: { rgb: C.bgBlue } },
    alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
    border: { bottom: { style: 'medium', color: { rgb: C.blue } } },
  },

  money:     { font: { sz: 11 }, alignment: { horizontal: 'right' } },
  moneyBold: { font: { bold: true, sz: 11 }, alignment: { horizontal: 'right' } },

  legendTitle: {
    font: { bold: true, sz: 10, color: { rgb: C.sub } },
    fill: { patternType: 'solid', fgColor: { rgb: C.bgLight } },
  },
  legendText: {
    font: { sz: 10, color: { rgb: C.sub } },
    fill: { patternType: 'solid', fgColor: { rgb: C.bgLight } },
  },

  data: { font: { sz: 11 } },

  grandTotalLabel: {
    font: { bold: true, sz: 11, color: { rgb: 'FFFFFF' } },
    fill: { patternType: 'solid', fgColor: { rgb: C.blue } },
    border: { top: { style: 'medium', color: { rgb: '1D4ED8' } } },
  },
  grandTotalMoney: {
    font: { bold: true, sz: 11, color: { rgb: 'FFFFFF' } },
    fill: { patternType: 'solid', fgColor: { rgb: C.blue } },
    alignment: { horizontal: 'right' },
    border: { top: { style: 'medium', color: { rgb: '1D4ED8' } } },
  },
};

const MONEY_FMT = '$#,##0.00';
const PCT_FMT   = '0.0%';

// ── Low-level cell constructors ───────────────────────────────────────────────

type CellStyle = Record<string, any>;

const vc = (v: any, t: string, s?: CellStyle, z?: string): any => {
  const cell: any = { v, t };
  if (s) cell.s = s;
  if (z) cell.z = z;
  return cell;
};

const fc = (formula: string, s?: CellStyle, z?: string): any => {
  const cell: any = { t: 'n', f: formula, v: 0 };
  if (s) cell.s = s;
  if (z) cell.z = z;
  return cell;
};

const at = (r: number, c: number): string =>
  XLSX.utils.encode_cell({ r, c });

// ── Helpers ───────────────────────────────────────────────────────────────────

const parseCents = (v: number | string | null | undefined): number =>
  v == null ? 0 : typeof v === 'string' ? Number(v) || 0 : v;

const invDate = (inv: ApiInvoiceHeader): string =>
  (inv.issuedAt ?? inv.createdAt ?? '').slice(0, 10);

const poDate = (po: ApiPurchaseOrder): string =>
  (po.receivedAt ?? po.billIssuedAt ?? po.sentAt ?? po.createdAt ?? '').slice(0, 10);

// ── Paginated fetchers ────────────────────────────────────────────────────────

const fetchAllPOs = async (from: string, to: string): Promise<ApiPurchaseOrder[]> => {
  const all: ApiPurchaseOrder[] = [];
  let cursor: number | null = null;
  do {
    const res = await getPurchaseOrdersApi({ from, to, limit: 100, cursor });
    all.push(...res.items);
    cursor = res.nextCursor;
  } while (cursor !== null);
  return all;
};

const fetchAllExpenses = async (from: string, to: string): Promise<ApiExpense[]> => {
  const all: ApiExpense[] = [];
  let cursor: string | null = null;
  do {
    const res = await getExpensesApi({ from, to, limit: 50, cursor: cursor ?? undefined });
    all.push(...res.items);
    cursor = res.nextCursor;
  } while (cursor);
  return all;
};

// ── Sheet builders ────────────────────────────────────────────────────────────

// Layout (row indices, 0-based):
//   0-2  → Logo area + Company header (CO_NAME / CO_ADDR / CO_TEL in col B)
//   3    → Separator
//   4    → Report title
//   5    → Period
//   6    → (blank)
//   7    → Start Date     B8
//   8    → End Date       B9
//   9    → (blank)
//   10   → TOTALS header
//   11   → Total Revenue  B12 = SUM('Sales'!E:E)
//   12   → Total COGS     B13 = SUM('Received PO'!G:G)
//   13   → Total Expenses B14 = SUM('Expenses'!D:D)
//   14   → (blank)
//   15   → Gross Profit   B16 = B12-B13
//   16   → Net Profit     B17 = B16-B14
//   17   → Net Margin %   B18 = IF(B12=0,0,B17/B12)
//   18-19 → (blank)
//   20   → EXPENSE BREAKDOWN header
//   21   → Column headers
//   22+  → Category rows  A23+ / SUMIF refs

function buildSummarySheet(
  report: ApiIncomeStatement,
  fromDate: string,
  toDate: string,
): any {
  const ws: Record<string, any> = {};
  const set = (r: number, c: number, cell: any) => { ws[at(r, c)] = cell; };

  // ── Rows 0-2: Company header (logo floats over col A via absoluteAnchor) ──
  set(0, 0, vc('',       's', {}));
  set(0, 1, vc(CO_NAME,  's', S.coName));

  set(1, 0, vc('',       's', {}));
  set(1, 1, vc(CO_ADDR,  's', S.coSub));

  set(2, 0, vc('',       's', {}));
  set(2, 1, vc(CO_TEL,   's', S.coSub));

  // Row 3: separator (empty)

  // Row 4: Title
  set(4, 0, vc('Financial Summary Report', 's', S.title));

  // Row 5: Period
  set(5, 0, vc(`Period: ${fromDate} – ${toDate}`, 's', S.sub));

  // Row 7: Start Date
  set(7, 0, vc('Start Date', 's', S.label));
  set(7, 1, vc(fromDate, 's', S.input));

  // Row 8: End Date
  set(8, 0, vc('End Date', 's', S.label));
  set(8, 1, vc(toDate, 's', S.input));

  // Row 10: TOTALS section header
  set(10, 0, vc('TOTALS', 's', S.section));

  // Row 11 (B12): Total Revenue
  set(11, 0, vc('Total Revenue (Sales)', 's', S.label));
  set(11, 1, fc("SUM('Sales'!D:D)", S.formula, MONEY_FMT));

  // Row 12 (B13): Total COGS
  set(12, 0, vc('Total Cost of Goods (Received PO)', 's', S.label));
  set(12, 1, fc("SUM('Received PO'!D:D)", S.formula, MONEY_FMT));

  // Row 13 (B14): Total Operating Expenses
  set(13, 0, vc('Total Operating Expenses', 's', S.label));
  set(13, 1, fc("SUM('Expenses'!D:D)", S.formula, MONEY_FMT));

  // Row 15 (B16): Gross Profit = B12 - B13
  set(15, 0, vc('Gross Profit (Revenue - COGS)', 's', S.formula));
  set(15, 1, fc('B12-B13', S.formula, MONEY_FMT));

  // Row 16 (B17): Net Profit = B16 - B14
  set(16, 0, vc('Net Profit (Gross Profit - Expenses)', 's', S.formula));
  set(16, 1, fc('B16-B14', S.formula, MONEY_FMT));

  // Row 17 (B18): Net Profit Margin %
  set(17, 0, vc('Net Profit Margin %', 's', S.formula));
  set(17, 1, fc('IF(B12=0,0,B17/B12)', S.formula, PCT_FMT));

  // Row 20: Expense Breakdown section header
  set(20, 0, vc('EXPENSE BREAKDOWN BY CATEGORY', 's', S.section));

  // Row 21: Column headers
  set(21, 0, vc('Category', 's', S.header));
  set(21, 1, vc('Amount',   's', S.header));

  // Rows 22+: one per expense category, SUMIF against Expenses sheet col B
  const cats = report.operatingExpenses.lines.filter(l => l.amountCents > 0);
  cats.forEach((line, i) => {
    const row      = 22 + i;
    const excelRow = row + 1; // 1-based Excel row
    set(row, 0, vc(line.nameEn, 's', S.data));
    set(row, 1, fc(`SUMIF('Expenses'!B:B,A${excelRow},'Expenses'!D:D)`, S.formula, MONEY_FMT));
  });

  // Legend
  const legendStart = 24 + cats.length;
  set(legendStart,     0, vc('LEGEND', 's', S.legendTitle));
  set(legendStart + 1, 0, vc('Yellow cells = fill in your own values', 's', S.legendText));
  set(legendStart + 2, 0, vc('Blue text = editable inputs (dates)', 's', S.legendText));
  set(legendStart + 3, 0, vc('Bold black = calculated formulas, do not overwrite', 's', S.legendText));
  set(legendStart + 4, 0, vc('Add more expense categories in the rows above as needed', 's', S.legendText));

  ws['!ref']  = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: legendStart + 4, c: 1 } });
  ws['!cols'] = [{ wch: 46 }, { wch: 36 }];
  ws['!rows'] = [{ hpt: 26 }, { hpt: 18 }, { hpt: 18 }]; // taller rows for company header
  return ws;
}

function buildSalesSheet(invoices: ApiInvoiceHeader[]): any {
  // Columns: Date | Invoice # | Campus | Total Amount | Status | Note
  // Total Amount = column D (index 3)
  const HDR = ['Date', 'Invoice #', 'Campus', 'Total Amount', 'Status', 'Note'];

  const sorted = [...invoices].sort((a, b) => invDate(a).localeCompare(invDate(b)));

  const rows: any[][] = [HDR];
  sorted.forEach(inv => {
    rows.push([
      invDate(inv),
      inv.invoiceNumber ?? '',
      inv.campus?.nameEn ?? inv.campusCode ?? '',
      parseCents(inv.totalCents) / 100,
      inv.status ?? '',
      inv.note ?? '',
    ]);
  });

  const ws = XLSX.utils.aoa_to_sheet(rows);

  HDR.forEach((_, c) => {
    const a = at(0, c);
    if (ws[a]) ws[a].s = S.header;
  });

  // Money format for column D (index 3) = Total Amount
  for (let r = 1; r < rows.length; r++) {
    const a = at(r, 3);
    if (ws[a]) { ws[a].s = S.moneyBold; ws[a].z = MONEY_FMT; }
  }

  const gtRow = rows.length;
  ws[at(gtRow, 0)] = vc('Grand Total', 's', S.grandTotalLabel);
  ws[at(gtRow, 3)] = fc(`SUM(D2:D${rows.length})`, S.grandTotalMoney, MONEY_FMT);

  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: gtRow, c: HDR.length - 1 } });
  ws['!cols'] = [
    { wch: 12 }, // Date
    { wch: 18 }, // Invoice #
    { wch: 18 }, // Campus
    { wch: 16 }, // Total Amount
    { wch: 12 }, // Status
    { wch: 30 }, // Note
  ];
  return ws;
}

function buildPOSheet(pos: ApiPurchaseOrder[]): any {
  // Columns: Date | PO # | Supplier | Total Cost | Payment Status | Note
  // Total Cost = column D (index 3)
  const HDR = ['Date', 'PO #', 'Supplier', 'Total Cost', 'Payment Status', 'Note'];

  const sorted = [...pos].sort((a, b) => poDate(a).localeCompare(poDate(b)));

  const rows: any[][] = [HDR];
  sorted.forEach(po => {
    rows.push([
      poDate(po),
      po.poNumber ?? '',
      po.vendorName ?? po.vendor?.nameEn ?? po.supplierOrg?.nameEn ?? '',
      (po.billTotalCents ?? po.totalCents ?? 0) / 100,
      po.status ?? '',
      po.receiptNote ?? po.note ?? '',
    ]);
  });

  const ws = XLSX.utils.aoa_to_sheet(rows);

  HDR.forEach((_, c) => {
    const a = at(0, c);
    if (ws[a]) ws[a].s = S.header;
  });

  // Money format for column D (index 3) = Total Cost
  for (let r = 1; r < rows.length; r++) {
    const a = at(r, 3);
    if (ws[a]) { ws[a].s = S.moneyBold; ws[a].z = MONEY_FMT; }
  }

  const gtRow = rows.length;
  ws[at(gtRow, 0)] = vc('Grand Total', 's', S.grandTotalLabel);
  ws[at(gtRow, 3)] = fc(`SUM(D2:D${rows.length})`, S.grandTotalMoney, MONEY_FMT);

  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: gtRow, c: HDR.length - 1 } });
  ws['!cols'] = [
    { wch: 12 }, // Date
    { wch: 16 }, // PO #
    { wch: 24 }, // Supplier
    { wch: 16 }, // Total Cost
    { wch: 16 }, // Payment Status
    { wch: 30 }, // Note
  ];
  return ws;
}

function buildExpensesSheet(expenses: ApiExpense[]): any {
  const HDR = ['Date', 'Category', 'Description', 'Amount'];

  const sorted = [...expenses].sort((a, b) =>
    (a.paidAt ?? '').localeCompare(b.paidAt ?? ''),
  );

  const rows: any[][] = [HDR];
  sorted.forEach(exp => {
    rows.push([
      (exp.paidAt ?? '').slice(0, 10),
      exp.categoryNameEn ?? exp.categoryKey ?? '',
      exp.description ?? exp.vendor ?? '',
      exp.amountCents / 100,
    ]);
  });

  const ws = XLSX.utils.aoa_to_sheet(rows);

  HDR.forEach((_, c) => {
    const a = at(0, c);
    if (ws[a]) ws[a].s = S.header;
  });

  for (let r = 1; r < rows.length; r++) {
    const a = at(r, 3);
    if (ws[a]) { ws[a].s = S.money; ws[a].z = MONEY_FMT; }
  }

  const gtRow = rows.length;
  ws[at(gtRow, 0)] = vc('Grand Total', 's', S.grandTotalLabel);
  ws[at(gtRow, 3)] = fc(`SUM(D2:D${rows.length})`, S.grandTotalMoney, MONEY_FMT);

  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: gtRow, c: HDR.length - 1 } });
  ws['!cols'] = [{ wch: 12 }, { wch: 22 }, { wch: 34 }, { wch: 16 }];
  return ws;
}

// ── Public export function ────────────────────────────────────────────────────

export const exportIncomeStatementExcel = async (
  report: ApiIncomeStatement,
  fromDate: string,
  toDate: string,
): Promise<void> => {
  const [invoices, allPOs, expenses] = await Promise.all([
    getInvoiceHeadersApi({ from: fromDate, to: toDate }),
    fetchAllPOs(fromDate, toDate),
    fetchAllExpenses(fromDate, toDate),
  ]);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, buildSummarySheet(report, fromDate, toDate), 'Summary');
  XLSX.utils.book_append_sheet(wb, buildSalesSheet(invoices),                   'Sales');
  XLSX.utils.book_append_sheet(wb, buildPOSheet(allPOs),                        'Received PO');
  XLSX.utils.book_append_sheet(wb, buildExpensesSheet(expenses),                'Expenses');

  const wbBase64: string = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });

  // Inject company logo into the Summary sheet only
  const withLogo = await injectLogoIntoXlsx(wbBase64);

  const fileName = `Financial_Summary_Report_${fromDate}_to_${toDate}.xlsx`;
  const filePath = `${FileSystem.documentDirectory}${fileName}`;
  await FileSystem.writeAsStringAsync(filePath, withLogo, { encoding: FileSystem.EncodingType.Base64 });
  const canShare = await Sharing.isAvailableAsync();
  if (canShare) await Sharing.shareAsync(filePath, { mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', dialogTitle: fileName });
};
