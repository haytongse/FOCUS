import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons as Icon } from '@expo/vector-icons';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const XLSX = require('xlsx-js-style');
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const JSZip = require('jszip');
import LOGO_BASE64 from '../../logo/logoBase64';

import Colors from '../../theme/colors';
import AppText from '../../components/AppText';
import AppBar from '../../components/AppBar';
import AppButton from '../../components/AppButton';
import DatePickerModal from '../../components/DatePickerModal';
import { useAlert } from '../../components/AppAlert';
import {
  getInvoiceHeadersApi,
  getInvoiceHeaderApi,
  getInvoiceExportByIdCsvApi,
  getCampusesApi,
  ApiInvoiceHeader,
  ApiCampus,
} from '../../services/focusApi';

// ── Logo injection into xlsx ZIP ──────────────────────────────────────────────
const LOGO_CX = 1270000; // 100 pt in EMU
const LOGO_CY = 1270000;

const makeDrawingXml = () =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><xdr:absoluteAnchor><xdr:pos x="0" y="0"/><xdr:ext cx="${LOGO_CX}" cy="${LOGO_CY}"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="2" name="Logo"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${LOGO_CX}" cy="${LOGO_CY}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:absoluteAnchor></xdr:wsDr>`;

const DRAWING_IMG_RELS =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/></Relationships>`;

const makeSheetRels = (drawingNum: number) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing${drawingNum}.xml"/></Relationships>`;

const injectFreezePane = (xml: string, ySplit: number): string => {
  const topCell = `A${ySplit + 1}`;
  const pane = `<pane ySplit="${ySplit}" topLeftCell="${topCell}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft"/>`;
  // Replace self-closing <sheetView .../> with version that contains the pane
  const replaced = xml.replace(/<sheetView([^>]*?)\/>/,
    (_, attrs) => `<sheetView${attrs}>${pane}</sheetView>`,
  );
  if (replaced !== xml) return replaced;
  // Fallback: inject before </sheetView> if it was already open
  return xml.replace(/<\/sheetView>/, `${pane}</sheetView>`);
};

const injectLogoIntoXlsx = async (
  xlsxBase64: string,
  logoBase64: string,
  sheetCount: number,
  freezeRows: (number | null)[] = [],
): Promise<string> => {
  const zip = await JSZip.loadAsync(xlsxBase64, { base64: true });

  zip.file('xl/media/image1.png', logoBase64, { base64: true });

  for (let i = 1; i <= sheetCount; i++) {
    zip.file(`xl/drawings/drawing${i}.xml`, makeDrawingXml());
    zip.file(`xl/drawings/_rels/drawing${i}.xml.rels`, DRAWING_IMG_RELS);
    zip.file(`xl/worksheets/_rels/sheet${i}.xml.rels`, makeSheetRels(i));

    const sheetFile = `xl/worksheets/sheet${i}.xml`;
    let sheetXml: string = await zip.file(sheetFile)!.async('text');
    const fr = freezeRows[i - 1];
    if (fr != null && fr > 0) sheetXml = injectFreezePane(sheetXml, fr);
    zip.file(sheetFile, sheetXml.replace('</worksheet>', '<drawing r:id="rId1"/></worksheet>'));
  }

  const ct: string = await zip.file('[Content_Types].xml')!.async('text');
  const ctOverrides = Array.from({ length: sheetCount }, (_, i) =>
    `<Override PartName="/xl/drawings/drawing${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`,
  ).join('');
  zip.file('[Content_Types].xml', ct.replace('</Types>', ctOverrides + '</Types>'));

  return zip.generateAsync({ type: 'base64', compression: 'DEFLATE' });
};

interface Props {
  onBack: () => void;
}

const parseCents = (v: number | string | null | undefined): number =>
  v == null ? 0 : typeof v === 'string' ? Number(v) || 0 : v;

const fmtDate = (iso?: string): string => {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch { return iso; }
};

const toIsoDate = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const daysOutstanding = (iso?: string): number => {
  if (!iso) return 0;
  try {
    const issued = new Date(iso);
    const now    = new Date();
    issued.setHours(0, 0, 0, 0);
    now.setHours(0, 0, 0, 0);
    return Math.floor((now.getTime() - issued.getTime()) / 86_400_000);
  } catch { return 0; }
};

const todayStr = (): string => toIsoDate(new Date());

const firstOfMonth = (): Date => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1);
};

const InvoiceDetailExportScreen: React.FC<Props> = ({ onBack }) => {
  const { showAlert } = useAlert();

  const [fromDate, setFromDate] = useState<Date>(firstOfMonth);
  const [toDate, setToDate] = useState<Date>(() => new Date());
  const [fromPickerVisible, setFromPickerVisible] = useState(false);
  const [toPickerVisible, setToPickerVisible] = useState(false);
  const [invoiceNumber, setInvoiceNumber] = useState('');

  const [statusFilter, setStatusFilter] = useState<string | null>(null);

  const [campuses, setCampuses] = useState<ApiCampus[]>([]);
  const [campusId, setCampusId] = useState<string | null>(null);
  const [campusPickerVisible, setCampusPickerVisible] = useState(false);
  const [campusSearch, setCampusSearch] = useState('');
  const [campusesLoading, setCampusesLoading] = useState(false);

  const [headers, setHeaders] = useState<ApiInvoiceHeader[]>([]);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Record<string, boolean>>({});

  const campusMap = useMemo(() => {
    const m: Record<string, ApiCampus> = {};
    campuses.forEach(c => { m[String(c.id)] = c; });
    return m;
  }, [campuses]);

  const filteredCampuses = useMemo(() => {
    const q = campusSearch.trim().toLowerCase();
    if (!q) return campuses;
    return campuses.filter(c =>
      (c.campusCode ?? '').toLowerCase().includes(q) ||
      (c.nameEn ?? '').toLowerCase().includes(q),
    );
  }, [campuses, campusSearch]);

  const selectedCampus = useMemo(
    () => (campusId ? campuses.find(c => String(c.id) === campusId) ?? null : null),
    [campuses, campusId],
  );

  const openCampusPicker = useCallback(async () => {
    if (campuses.length === 0) {
      setCampusesLoading(true);
      try { setCampuses(await getCampusesApi()); } catch {}
      setCampusesLoading(false);
    }
    setCampusSearch('');
    setCampusPickerVisible(true);
  }, [campuses.length]);

  const search = useCallback(async () => {
    setLoading(true);
    setSelectedIds({});
    setHeaders([]);
    try {
      const results = await getInvoiceHeadersApi({
        from: toIsoDate(fromDate),
        to:   toIsoDate(toDate),
        ...(invoiceNumber.trim() ? { invoiceNumber: invoiceNumber.trim() } : {}),
        ...(campusId     ? { campusId }            : {}),
        ...(statusFilter ? { status: statusFilter } : {}),
      });
      const filtered = statusFilter
        ? results.filter(h => (h.status ?? '').toUpperCase() === statusFilter)
        : results;
      setHeaders(filtered);
      if (filtered.length === 0) {
        showAlert({ type: 'info', title: 'No Results', message: 'No invoices found for the selected filters.' });
      }
    } catch (err: any) {
      showAlert({ type: 'error', title: 'Search Failed', message: err?.message ?? 'Failed to load invoices' });
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate, invoiceNumber, campusId, statusFilter, showAlert]);

  const allSelected = headers.length > 0 && headers.every(h => selectedIds[h.id]);

  const { totalIssued, totalPaid, countIssued, countPaid } = useMemo(() => {
    let issued = 0, paid = 0, cIssued = 0, cPaid = 0;
    headers.forEach(h => {
      const st = (h.status ?? '').toLowerCase();
      const cents = parseCents(h.totalCents);
      if (st === 'issued') { issued += cents; cIssued++; }
      else if (st === 'paid') { paid += cents; cPaid++; }
    });
    return { totalIssued: issued / 100, totalPaid: paid / 100, countIssued: cIssued, countPaid: cPaid };
  }, [headers]);

  const toggleAll = () => {
    if (allSelected) {
      setSelectedIds({});
    } else {
      const next: Record<string, boolean> = {};
      headers.forEach(h => { next[h.id] = true; });
      setSelectedIds(next);
    }
  };

  const selectedHeaders = useMemo(
    () => headers.filter(h => selectedIds[h.id]),
    [headers, selectedIds],
  );

  const exportExcel = useCallback(async () => {
    const targets = selectedHeaders.length > 0 ? selectedHeaders : headers;
    if (targets.length === 0) {
      showAlert({ type: 'error', title: 'Nothing to Export', message: 'Search for invoices first.' });
      return;
    }

    setExporting(true);
    try {
      // Fetch CSV and full detail in parallel for each invoice
      const [csvResults, detailedResults] = await Promise.all([
        Promise.all(targets.map(h => getInvoiceExportByIdCsvApi(h.id).catch(() => ''))),
        Promise.all(targets.map(h => getInvoiceHeaderApi(h.id).catch(() => null))),
      ]);

      // Build SKU → productNameKm map per invoice index
      const nameKmMaps: Record<string, string>[] = detailedResults.map(detail => {
        const map: Record<string, string> = {};
        (detail?.details ?? []).forEach((d: any) => {
          if (d.productSku) map[d.productSku] = d.productNameKm ?? d.productNameKh ?? '';
        });
        return map;
      });

      // Build SKU → { cost, grossProfit, campusCode } map per invoice index
      // Only populate when costAfterDiscount is non-null so we don't produce a fake 0
      const costMaps: Record<string, { cost: number; grossProfit: number; campusCode: string }>[] =
        detailedResults.map(detail => {
          const map: Record<string, { cost: number; grossProfit: number; campusCode: string }> = {};
          (detail?.details ?? []).forEach((d: any) => {
            if (!d.productSku || d.costAfterDiscount == null) return;
            const cost      = parseCents(d.costAfterDiscount);
            const lineTotal = parseCents(d.lineCents);
            map[d.productSku] = {
              cost:        cost / 100,
              grossProfit: (lineTotal - cost) / 100,
              campusCode:  d.campusCode ?? '',
            };
          });
          return map;
        });

      // ── Helpers ──────────────────────────────────────────────────────────────
      const parseCsvLine = (line: string): string[] => {
        const cols: string[] = [];
        let cur = '';
        let inQ = false;
        for (const ch of line) {
          if (ch === '"') { inQ = !inQ; }
          else if (ch === ',' && !inQ) { cols.push(cur); cur = ''; }
          else { cur += ch; }
        }
        cols.push(cur);
        return cols;
      };
      const parseAmt = (v: string): number => Number((v ?? '').replace(/[$,]/g, '')) || 0;
      const merge = (r1: number, c1: number, r2: number, c2: number) =>
        ({ s: { r: r1, c: c1 }, e: { r: r2, c: c2 } });

      // ── Style helpers ─────────────────────────────────────────────────────────
      const HEADER_STYLE = {
        fill: { patternType: 'solid', fgColor: { rgb: 'D9D9D9' } },
        font: { bold: true },
        alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
        border: {
          top:    { style: 'thin', color: { rgb: 'AAAAAA' } },
          bottom: { style: 'thin', color: { rgb: 'AAAAAA' } },
          left:   { style: 'thin', color: { rgb: 'AAAAAA' } },
          right:  { style: 'thin', color: { rgb: 'AAAAAA' } },
        },
      };
      const applyHeaderStyle = (ws: any, rowIdx: number, colCount: number) => {
        for (let c = 0; c < colCount; c++) {
          const addr = XLSX.utils.encode_cell({ r: rowIdx, c });
          if (ws[addr]) ws[addr].s = HEADER_STYLE;
        }
      };

      // ── Company branding constants ────────────────────────────────────────────
      const CO_NAME  = 'FOCUS LAB';
      const CO_ADDR1 = '#17 St 480, Sangkat Toul Toum Pong 1, Khan Chamkarmon, Phnom Penh 12310';
      const CO_TEL   = 'Tel: 0964222816';
      const CO_EMAIL = 'sen.sov@gmail.com';
      const LOGO_COLS = 2; // cols A-B reserved for the logo image

      // ── Sheet 1: Invoices ─────────────────────────────────────────────────────
      const S_COLS = 10;
      const pad = (n: number) => Array(n).fill('');

      const summaryRows: any[][] = [
        // Rows 0-2: logo occupies cols A-B; company text starts at col C
        [...pad(LOGO_COLS), CO_NAME,  ...pad(S_COLS - LOGO_COLS - 1)],
        [...pad(LOGO_COLS), CO_ADDR1, ...pad(S_COLS - LOGO_COLS - 1)],
        [...pad(LOGO_COLS), `${CO_TEL}  |  ${CO_EMAIL}`, ...pad(S_COLS - LOGO_COLS - 1)],
        pad(S_COLS),
        ['INVOICE SUMMARY REPORT', ...pad(S_COLS - 1)],
        [`Period: ${toIsoDate(fromDate)}  →  ${toIsoDate(toDate)}`, ...pad(S_COLS - 1)],
        pad(S_COLS),
        ['#', 'Invoice Number', 'Campus Code', 'Campus Name', 'Customer', 'Status', 'Issue Date', 'Due Date', 'Days Outstanding', 'Total (USD)'],
      ];
      const summaryMerges = [
        merge(0, LOGO_COLS, 0, S_COLS - 1), // Company name: C1:J1
        merge(1, LOGO_COLS, 1, S_COLS - 1), // Address:      C2:J2
        merge(2, LOGO_COLS, 2, S_COLS - 1), // Tel/Email:    C3:J3
        merge(4, 0, 4, S_COLS - 1),          // Report title: full width
        merge(5, 0, 5, S_COLS - 1),          // Period:       full width
      ];

      targets.forEach((h, i) => {
        const campusObj  = campusMap[String(h.campusId)] ?? (h.campus as any) ?? {};
        const campusCode = h.campusCode ?? campusObj?.campusCode ?? String(h.campusId);
        const campusName = campusObj?.nameEn ?? '';
        const customerMatch = csvResults[i].match(/^Customer,(.*)$/m);
        const customer = customerMatch
          ? customerMatch[1].trim()
          : (h.customerOrg?.nameEn ?? h.customerOrg?.name ?? '');
        summaryRows.push([
          i + 1,
          h.invoiceNumber,
          campusCode,
          campusName,
          customer,
          (h.status ?? '').toUpperCase(),
          fmtDate(h.issuedAt ?? h.createdAt),
          h.dueAt ? fmtDate(h.dueAt) : '',
          daysOutstanding(h.issuedAt ?? h.createdAt),
          parseCents(h.totalCents) / 100,
        ]);
      });

      const summaryWs = XLSX.utils.aoa_to_sheet(summaryRows);
      summaryWs['!merges'] = summaryMerges;
      summaryWs['!rows']   = [{ hpt: 35 }, { hpt: 35 }, { hpt: 35 }];
      summaryWs['!cols']   = [
        { wch: 5  }, // #
        { wch: 18 }, // Invoice Number
        { wch: 14 }, // Campus Code
        { wch: 18 }, // Campus Name
        { wch: 26 }, // Customer
        { wch: 12 }, // Status
        { wch: 14 }, // Issue Date
        { wch: 14 }, // Due Date
        { wch: 18 }, // Days Outstanding
        { wch: 14 }, // Total (USD)
      ];
      // Grey header + freeze below it (row 7 = index 7 → freeze first 8 rows)
      const S_HDR_ROW = 7;
      applyHeaderStyle(summaryWs, S_HDR_ROW, S_COLS);

      // ── Sheet 2: Line Items ───────────────────────────────────────────────────
      // One section per invoice: branding header → invoice meta → column header → rows
      const D_COLS = 12;
      const detailRows: any[][] = [];
      const detailMerges: ReturnType<typeof merge>[] = [];
      const detailColHdrRows: number[] = []; // row indices that need grey header style

      targets.forEach((h, idx) => {
        const csvText = csvResults[idx];
        const lines   = (csvText ?? '').split('\n').map(l => l.trim());

        // Parse invoice meta from CSV header section
        const getField = (key: string) => {
          const m = lines.find(l => l.toLowerCase().startsWith(key.toLowerCase() + ','));
          return m ? m.slice(key.length + 1).replace(/^"|"$/g, '').trim() : '';
        };
        const customer  = getField('Customer');
        const status    = getField('Status');
        const issuedAt  = getField('Issued At');
        const dueAt     = getField('Due At');
        const totalStr  = getField('Total');
        const note      = getField('Note');

        const startRow = detailRows.length;

        if (idx === 0) {
          // Company branding — only once at top; logo occupies cols A-B
          detailRows.push([...pad(LOGO_COLS), CO_NAME,  ...pad(D_COLS - LOGO_COLS - 1)]);
          detailRows.push([...pad(LOGO_COLS), CO_ADDR1, ...pad(D_COLS - LOGO_COLS - 1)]);
          detailRows.push([...pad(LOGO_COLS), `${CO_TEL}  |  ${CO_EMAIL}`, ...pad(D_COLS - LOGO_COLS - 1)]);
          detailRows.push(pad(D_COLS)); // blank
          detailMerges.push(
            merge(startRow,     LOGO_COLS, startRow,     D_COLS - 1),
            merge(startRow + 1, LOGO_COLS, startRow + 1, D_COLS - 1),
            merge(startRow + 2, LOGO_COLS, startRow + 2, D_COLS - 1),
          );
        }

        // Invoice details block
        const metaStart = detailRows.length;
        detailRows.push([`Invoice: ${h.invoiceNumber}`, ...pad(D_COLS - 1)]); // invoice number
        detailRows.push([
          `Customer: ${customer}`,   `Status: ${status}`,
          `Issued: ${issuedAt}`,     `Due: ${dueAt}`,
          `Total: ${totalStr}`,      ...(note ? [`Note: ${note}`] : ['']),
          ...pad(D_COLS - 6),
        ]);
        detailMerges.push(merge(metaStart, 0, metaStart, D_COLS - 1));

        // Column headers — record index for grey styling pass below
        const colHdrRow = detailRows.length;
        detailColHdrRows.push(colHdrRow);
        detailRows.push([
          'Invoice Number', 'SKU', 'Name (EN)', 'Name (KH)',
          'Campus', 'Campus Code', 'Qty',
          'Unit Price (USD)', 'Discount (USD)', 'Line Total (USD)', 'Cost (USD)', 'Gross Profit (USD)',
        ]);

        // Line-item data rows
        const hdrIdx = lines.findIndex(l => /^"?#"?,/i.test(l) && l.toLowerCase().includes('sku'));
        if (hdrIdx !== -1) {
          // Detect format by checking header row for new-format columns
          const hdrLow = lines[hdrIdx].toLowerCase();
          const isNewFmt = hdrLow.includes('name (kh)') || hdrLow.includes('campus code');

          const nameKmMap = nameKmMaps[idx] ?? {};
          const costMap   = costMaps[idx] ?? {};

          lines.slice(hdrIdx + 1).forEach(line => {
            if (!line) return;
            const cols = parseCsvLine(line);
            if (cols.length < 5) return;

            let sku: string, nameEn: string, nameKh: string, campus: string,
                campusCode: string, qty: string, unitPrice: string,
                discount: string, lineTotal: string, cost: string, grossProfit: string;

            if (isNewFmt) {
              // New: # | SKU | Name(EN) | Name(KH) | Campus | CampusCode | Qty | UnitPrice | Discount | LineTotal | Cost | GrossProfit
              [, sku, nameEn, nameKh, campus, campusCode, qty, unitPrice, discount, lineTotal, cost, grossProfit] = cols;
            } else {
              // Old: # | SKU | Product | Campus | Qty | UnitPrice | Discount | LineTotal
              [, sku, nameEn, campus, qty, unitPrice, discount, lineTotal] = cols;
              nameKh = ''; campusCode = ''; cost = ''; grossProfit = '';
            }

            // Prefer JSON API values; fall back to CSV then invoice-level campus code
            const invoiceCampusCode   = h.campusCode ?? campusMap[String(h.campusId)]?.campusCode ?? '';
            const resolvedNameKh      = nameKmMap[sku ?? ''] || nameKh || '';
            const apiCost             = costMap[sku ?? ''];
            const resolvedCost        = apiCost != null ? apiCost.cost        : parseAmt(cost);
            const resolvedGrossProfit = apiCost != null ? apiCost.grossProfit : parseAmt(grossProfit ?? '');
            const resolvedCampusCode  = campusCode || apiCost?.campusCode || invoiceCampusCode;

            detailRows.push([
              h.invoiceNumber,
              sku ?? '', nameEn ?? '', resolvedNameKh,
              campus ?? '', resolvedCampusCode,
              Number(qty ?? 0),
              parseAmt(unitPrice), parseAmt(discount),
              parseAmt(lineTotal), resolvedCost, resolvedGrossProfit,
            ]);
          });
        }

        // Blank separator between invoices
        detailRows.push(pad(D_COLS));
      });

      const detailWs = XLSX.utils.aoa_to_sheet(detailRows);
      detailWs['!merges'] = detailMerges;
      detailWs['!rows']   = [{ hpt: 35 }, { hpt: 35 }, { hpt: 35 }];
      detailWs['!cols']   = [
        { wch: 18 }, // Invoice Number
        { wch: 14 }, // SKU
        { wch: 30 }, // Name (EN)
        { wch: 30 }, // Name (KH)
        { wch: 18 }, // Campus
        { wch: 14 }, // Campus Code
        { wch: 8  }, // Qty
        { wch: 16 }, // Unit Price (USD)
        { wch: 16 }, // Discount (USD)
        { wch: 16 }, // Line Total (USD)
        { wch: 14 }, // Cost (USD)
        { wch: 16 }, // Gross Profit (USD)
      ];
      // Grey style on every column-header row in Line Items
      detailColHdrRows.forEach(r => applyHeaderStyle(detailWs, r, D_COLS));

      // Battambang font on all cells in Name (KH) column (col index 3)
      const detailRange = XLSX.utils.decode_range(detailWs['!ref'] ?? 'A1');
      for (let r = detailRange.s.r; r <= detailRange.e.r; r++) {
        const addr = XLSX.utils.encode_cell({ r, c: 3 });
        if (!detailWs[addr]) continue;
        const existing = detailWs[addr].s ?? {};
        detailWs[addr].s = { ...existing, font: { ...(existing.font ?? {}), name: 'Battambang' } };
      }


      // ── Write workbook then inject logo ───────────────────────────────────────
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, summaryWs, 'Invoices');
      XLSX.utils.book_append_sheet(wb, detailWs,  'Line Items');

      const wbBase64 = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
      const rawLogo  = LOGO_BASE64.replace(/^data:image\/\w+;base64,/, '');
      // freezeRows: sheet1 freezes after Invoices header, sheet2 freezes after first Line Items column header
      const detailFreezeRow = detailColHdrRows.length > 0 ? detailColHdrRows[0] + 1 : null;
      const wbOut    = await injectLogoIntoXlsx(wbBase64, rawLogo, 2, [S_HDR_ROW + 1, detailFreezeRow]);

      const fileName = `invoices_${todayStr()}.xlsx`;
      const filePath = `${FileSystem.documentDirectory}${fileName}`;
      await FileSystem.writeAsStringAsync(filePath, wbOut, { encoding: FileSystem.EncodingType.Base64 });
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) await Sharing.shareAsync(filePath, { mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', dialogTitle: fileName });
    } catch (err: any) {
      showAlert({ type: 'error', title: 'Export Failed', message: err?.message ?? 'Could not generate Excel file' });
    } finally {
      setExporting(false);
    }
  }, [selectedHeaders, headers, campusMap, fromDate, toDate, showAlert]);

  const renderHeader = ({ item }: { item: ApiInvoiceHeader }) => {
    const selected = !!selectedIds[item.id];
    const campusObj  = campusMap[String(item.campusId)] ?? (item.campus as any) ?? {};
    const campusCode = item.campusCode ?? campusObj?.campusCode ?? '';
    const campusName = campusObj?.nameEn ?? '';
    const campus     = [campusCode, campusName].filter(Boolean).join(' ') || '—';
    const customer   = item.customerOrg?.nameEn ?? item.customerOrg?.name ?? '';
    const total    = parseCents(item.totalCents) / 100;
    const st       = (item.status ?? '').toLowerCase();
    const statusColor =
      st === 'paid'      ? '#059669' :
      st === 'cancelled' ? '#DC2626'  : '#2563EB';
    const days      = st === 'paid' ? null : daysOutstanding(item.issuedAt ?? item.createdAt);
    const daysColor = days == null ? '#6B7280' : days > 30 ? '#DC2626' : days > 14 ? '#F59E0B' : '#6B7280';

    return (
      <TouchableOpacity
        style={[styles.row, selected && styles.rowSelected]}
        onPress={() => setSelectedIds(p => ({ ...p, [item.id]: !p[item.id] }))}
        activeOpacity={0.7}
      >
        <View style={[styles.checkbox, selected && styles.checkboxFilled]}>
          {selected && <Icon name="check" size={14} color="#fff" />}
        </View>
        <View style={styles.rowBody}>
          <View style={styles.rowTop}>
            <AppText style={styles.invNum}>{item.invoiceNumber}</AppText>
            <View style={{
              backgroundColor: st === 'paid' ? '#D1FAE5' : st === 'cancelled' ? '#FEE2E2' : '#FEF3C7',
              borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2,
            }}>
              <AppText style={[styles.statusBadge, { color: st === 'paid' ? '#059669' : st === 'cancelled' ? '#DC2626' : '#D97706' }]}>
                {(item.status ?? '').toUpperCase()}
              </AppText>
            </View>
          </View>
          {!!campusCode && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 2 }}>
              <View style={{ backgroundColor: '#D1FAE5', borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 }}>
                <AppText style={{ fontSize: 10, fontWeight: '700', color: '#059669', letterSpacing: 0.5, textTransform: 'uppercase' }}>Campus:</AppText>
              </View>
              <AppText style={{ fontSize: 12, fontWeight: '600', color: '#059669' }}>{campusCode}</AppText>
            </View>
          )}
          {item.note ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 2 }}>
              <View style={{ backgroundColor: '#EFF6FF', borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 }}>
                <AppText style={{ fontSize: 10, fontWeight: '700', color: '#2563EB', letterSpacing: 0.5, textTransform: 'uppercase' }}>Note:</AppText>
              </View>
              <AppText style={[styles.meta, { flex: 1, color: '#2563EB' }]} numberOfLines={2}>{item.note}</AppText>
            </View>
          ) : null}
          {!!customer && <AppText style={styles.metaSub}>{customer}</AppText>}
          <View style={styles.rowBottom}>
            <AppText style={styles.rowDate}>Issue: {fmtDate(item.issuedAt ?? item.createdAt)}</AppText>
            {days != null && (
              <AppText style={[styles.rowDays, { color: daysColor }]}>{days}d</AppText>
            )}
            <AppText style={styles.rowTotal}>${total.toFixed(2)}</AppText>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
      <AppBar title="Invoice Details" onBack={onBack} showBack />

      {/* ── Filters ─────────────────────────────────────────────────────────── */}
      <View style={styles.filters}>
        {/* Date range */}
        <View style={styles.dateRow}>
          <TouchableOpacity style={styles.datePill} onPress={() => setFromPickerVisible(true)}>
            <Icon name="calendar-today" size={14} color={Colors.primary} />
            <AppText style={styles.datePillText}>{toIsoDate(fromDate)}</AppText>
          </TouchableOpacity>
          <AppText style={styles.arrow}>→</AppText>
          <TouchableOpacity style={styles.datePill} onPress={() => setToPickerVisible(true)}>
            <Icon name="calendar-today" size={14} color={Colors.primary} />
            <AppText style={styles.datePillText}>{toIsoDate(toDate)}</AppText>
          </TouchableOpacity>
        </View>

        {/* Campus + invoice number */}
        <View style={styles.filterRow}>
          <TouchableOpacity style={styles.campusPill} onPress={openCampusPicker}>
            {campusesLoading
              ? <ActivityIndicator size="small" color={Colors.primary} />
              : <Icon name="location-city" size={14} color={Colors.primary} />
            }
            <AppText style={styles.datePillText} numberOfLines={1}>
              {selectedCampus
                ? [selectedCampus.campusCode, selectedCampus.nameEn].filter(Boolean).join(' ')
                : 'All Campus'
              }
            </AppText>
            <Icon name="arrow-drop-down" size={18} color={Colors.primary} />
          </TouchableOpacity>

          <TextInput
            style={styles.invInput}
            placeholder="Invoice #"
            placeholderTextColor="#9CA3AF"
            value={invoiceNumber}
            onChangeText={setInvoiceNumber}
            returnKeyType="search"
            onSubmitEditing={search}
          />
        </View>

        {/* Status chips */}
        <View style={styles.chipRow}>
          {[null, 'DRAFT', 'ISSUED', 'PAID', 'CANCELLED'].map(s => (
            <TouchableOpacity
              key={s ?? 'all'}
              style={[styles.chip, statusFilter === s && styles.chipActive]}
              onPress={() => setStatusFilter(s)}
            >
              <AppText style={[styles.chipText, statusFilter === s && styles.chipTextActive]}>
                {s ?? 'All'}
              </AppText>
            </TouchableOpacity>
          ))}
        </View>

        <AppButton
          label={loading ? 'Searching…' : 'Search'}
          onPress={search}
          disabled={loading}
          style={styles.searchBtn}
        />
      </View>

      {/* ── Result toolbar ───────────────────────────────────────────────────── */}
      {headers.length > 0 && (
        <View style={styles.toolbar}>
          <TouchableOpacity style={styles.selectAllRow} onPress={toggleAll}>
            <View style={[styles.checkbox, allSelected && styles.checkboxFilled]}>
              {allSelected && <Icon name="check" size={14} color="#fff" />}
            </View>
            <AppText style={styles.selectAllText}>
              {allSelected ? 'Deselect All' : 'Select All'} ({headers.length})
            </AppText>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.exportBtn, exporting && styles.exportBtnBusy]}
            onPress={exportExcel}
            disabled={exporting}
          >
            {exporting
              ? <ActivityIndicator size="small" color="#fff" />
              : <Icon name="file-download" size={16} color="#fff" />
            }
            <AppText style={styles.exportBtnText}>
              {exporting
                ? 'Exporting…'
                : selectedHeaders.length > 0
                  ? `Export (${selectedHeaders.length})`
                  : 'Export All'
              }
            </AppText>
          </TouchableOpacity>
        </View>
      )}

      {/* ── Summary cards ───────────────────────────────────────────────────── */}
      {headers.length > 0 && (
        <View style={styles.cards}>
          <View style={[styles.card, styles.cardIssued]}>
            <View style={styles.cardIconWrap}>
              <Icon name="receipt" size={20} color="#DC2626" />
            </View>
            <View style={styles.cardBody}>
              <AppText style={styles.cardLabel}>Total Issued</AppText>
              <AppText style={[styles.cardAmount, styles.cardAmountIssued]}>${totalIssued.toFixed(2)}</AppText>
              <AppText style={styles.cardCount}>{countIssued} invoice{countIssued !== 1 ? 's' : ''}</AppText>
            </View>
          </View>

          <View style={[styles.card, styles.cardPaid]}>
            <View style={styles.cardIconWrap}>
              <Icon name="check-circle" size={20} color="#059669" />
            </View>
            <View style={styles.cardBody}>
              <AppText style={styles.cardLabel}>Total Paid</AppText>
              <AppText style={[styles.cardAmount, styles.cardAmountPaid]}>${totalPaid.toFixed(2)}</AppText>
              <AppText style={styles.cardCount}>{countPaid} invoice{countPaid !== 1 ? 's' : ''}</AppText>
            </View>
          </View>
        </View>
      )}

      {/* ── List ────────────────────────────────────────────────────────────── */}
      {loading ? (
        <ActivityIndicator style={styles.loader} size="large" color={Colors.primary} />
      ) : (
        <FlatList
          data={headers}
          keyExtractor={h => h.id}
          renderItem={renderHeader}
          style={styles.listView}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Icon name="search" size={40} color="#D1D5DB" />
              <AppText style={styles.emptyText}>Set filters and tap Search to load invoices.</AppText>
            </View>
          }
        />
      )}

      {/* ── Date pickers ────────────────────────────────────────────────────── */}
      <DatePickerModal
        visible={fromPickerVisible}
        value={fromDate}
        onChange={d => { setFromDate(d); setFromPickerVisible(false); }}
        onClose={() => setFromPickerVisible(false)}
      />
      <DatePickerModal
        visible={toPickerVisible}
        value={toDate}
        onChange={d => { setToDate(d); setToPickerVisible(false); }}
        onClose={() => setToPickerVisible(false)}
      />

      {/* ── Campus picker modal ──────────────────────────────────────────────── */}
      <Modal visible={campusPickerVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <AppText style={styles.modalTitle}>Select Campus</AppText>
              <TouchableOpacity onPress={() => setCampusPickerVisible(false)}>
                <Icon name="close" size={22} color="#374151" />
              </TouchableOpacity>
            </View>
            <TextInput
              style={styles.modalSearch}
              placeholder="Search campus…"
              placeholderTextColor="#9CA3AF"
              value={campusSearch}
              onChangeText={setCampusSearch}
              autoFocus
            />
            <FlatList
              data={[{ id: '', campusCode: '', nameEn: 'All Campus', nameKm: '' } as ApiCampus, ...filteredCampuses]}
              keyExtractor={c => String(c.id)}
              renderItem={({ item }) => {
                const isAll = item.id === '';
                const isSelected = isAll ? campusId === null : String(item.id) === campusId;
                return (
                  <TouchableOpacity
                    style={[styles.campusRow, isSelected && styles.campusRowSelected]}
                    onPress={() => {
                      setCampusId(isAll ? null : String(item.id));
                      setCampusPickerVisible(false);
                    }}
                  >
                    <AppText style={[styles.campusRowText, isSelected && styles.campusRowTextSelected]}>
                      {isAll ? 'All Campus' : [item.campusCode, item.nameEn].filter(Boolean).join(' ')}
                    </AppText>
                    {isSelected && <Icon name="check" size={18} color={Colors.primary} />}
                  </TouchableOpacity>
                );
              }}
              keyboardShouldPersistTaps="handled"
              style={styles.campusList}
            />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

export default InvoiceDetailExportScreen;

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F9FAFB' },

  // Filters
  filters: { padding: 12, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#E5E7EB' },
  dateRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  datePill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#F3F4F6',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  datePillText: { fontSize: 13, color: '#374151', flex: 1 },
  arrow: { marginHorizontal: 8, color: '#6B7280', fontSize: 16 },
  filterRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  campusPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#F3F4F6',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  invInput: {
    flex: 1,
    backgroundColor: '#F3F4F6',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
    color: '#374151',
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
    backgroundColor: '#F3F4F6',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  chipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipText:       { fontSize: 12, fontWeight: '600', color: '#6B7280' },
  chipTextActive: { color: '#fff' },
  searchBtn: { borderRadius: 8 },

  // Toolbar
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  selectAllRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  selectAllText: { fontSize: 13, color: '#374151', fontWeight: '500' },
  exportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#059669',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  exportBtnBusy: { opacity: 0.6 },
  exportBtnText: { color: '#fff', fontSize: 13, fontWeight: '600' },

  // Summary cards
  cards: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#F9FAFB',
  },
  card: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 12,
    padding: 12,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  cardIssued: { backgroundColor: '#FEF2F2', borderWidth: 1, borderColor: '#FECACA' },
  cardPaid:   { backgroundColor: '#F0FDF4', borderWidth: 1, borderColor: '#A7F3D0' },
  cardIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardBody: { flex: 1 },
  cardLabel:       { fontSize: 11, color: '#6B7280', fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4 },
  cardAmount:      { fontSize: 18, fontWeight: '800', marginTop: 1 },
  cardAmountIssued: { color: '#DC2626' },
  cardAmountPaid:   { color: '#059669' },
  cardCount:       { fontSize: 11, color: '#9CA3AF', marginTop: 1 },

  // List
  loader: { marginTop: 40 },
  listView: { backgroundColor: '#fff' },
  list: { paddingBottom: 32 },
  emptyWrap: { alignItems: 'center', paddingTop: 60, gap: 12 },
  emptyText: { fontSize: 14, color: '#9CA3AF', textAlign: 'center' },

  // Row
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  rowSelected: { backgroundColor: '#EFF6FF', borderLeftWidth: 3, borderLeftColor: Colors.primary },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: '#D1D5DB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxFilled: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  rowBody: { flex: 1 },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 },
  invNum: { fontSize: 14, fontWeight: '700', color: '#111827' },
  statusBadge: { fontSize: 11, fontWeight: '700' },
  meta:    { fontSize: 12, color: '#6B7280', marginBottom: 1 },
  metaSub: { fontSize: 11, color: '#9CA3AF', marginBottom: 4 },
  rowBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowDate:  { fontSize: 12, color: '#9CA3AF' },
  rowDays:  { fontSize: 12, fontWeight: '600' },
  rowTotal: { fontSize: 14, fontWeight: '700', color: '#059669' },

  // Campus modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: '70%' },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderBottomColor: '#E5E7EB' },
  modalTitle: { fontSize: 16, fontWeight: '700', color: '#111827' },
  modalSearch: {
    margin: 12,
    backgroundColor: '#F3F4F6',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#374151',
  },
  campusList: { flexGrow: 0 },
  campusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  campusRowSelected: { backgroundColor: '#F0FDF4' },
  campusRowText: { fontSize: 14, color: '#374151' },
  campusRowTextSelected: { color: Colors.primary, fontWeight: '600' },
});
