import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
  Modal,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons as Icon } from '@expo/vector-icons';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const XLSX = require('xlsx-js-style');
import * as FileSystem from 'expo-file-system/legacy';
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
  getPurchaseOrdersApi,
  getPurchaseOrderApi,
  getLocationsApi,
  ApiPurchaseOrder,
  ApiLocation,
} from '../../services/focusApi';

// ── Logo injection ────────────────────────────────────────────────────────────
const LOGO_CX = 1270000;
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
  const replaced = xml.replace(/<sheetView([^>]*?)\/>/,
    (_, attrs) => `<sheetView${attrs}>${pane}</sheetView>`,
  );
  if (replaced !== xml) return replaced;
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

// ── Helpers ───────────────────────────────────────────────────────────────────
interface Props { onBack: () => void; }

const parseCents = (v: number | string | null | undefined): number =>
  v == null ? 0 : typeof v === 'string' ? Number(v) || 0 : v;

const fmtDate = (iso?: string | null): string => {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch { return iso; }
};

const toIsoDate = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const todayStr = (): string => toIsoDate(new Date());

const firstOfMonth = (): Date => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1);
};

const STATUS_COLORS: Record<string, string> = {
  DRAFT: '#6B7280', APPROVED: '#2563EB', SENT: '#7C3AED',
  RECEIVED: '#16A34A', BILLED: '#D97706', PAID: '#059669', CANCELLED: '#DC2626',
};

// ── Component ─────────────────────────────────────────────────────────────────
const POExportScreen: React.FC<Props> = ({ onBack }) => {
  const { showAlert } = useAlert();

  const [fromDate, setFromDate] = useState<Date>(firstOfMonth);
  const [toDate, setToDate]     = useState<Date>(() => new Date());
  const [fromPickerVisible, setFromPickerVisible] = useState(false);
  const [toPickerVisible, setToPickerVisible]     = useState(false);

  const [poNumber, setPoNumber] = useState('');

  const [locations, setLocations]             = useState<ApiLocation[]>([]);
  const [locationId, setLocationId]           = useState<string | null>(null);
  const [locationSearch, setLocationSearch]   = useState('');
  const [locationPickerVisible, setLocationPickerVisible] = useState(false);
  const [locationsLoading, setLocationsLoading] = useState(false);

  const [statusFilters, setStatusFilters] = useState<string[]>(['RECEIVED', 'BILLED', 'PAID']);

  const [pos, setPos]           = useState<ApiPurchaseOrder[]>([]);
  const [loading, setLoading]   = useState(false);
  const [exporting, setExporting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Record<string, boolean>>({});

  const filteredLocations = useMemo(() => {
    const q = locationSearch.trim().toLowerCase();
    if (!q) return locations;
    return locations.filter(l =>
      l.code.toLowerCase().includes(q) || l.nameEn.toLowerCase().includes(q),
    );
  }, [locations, locationSearch]);

  const selectedLocation = useMemo(
    () => (locationId ? locations.find(l => String(l.id) === locationId) ?? null : null),
    [locations, locationId],
  );

  const openLocationPicker = useCallback(async () => {
    if (locations.length === 0) {
      setLocationsLoading(true);
      try { setLocations(await getLocationsApi()); } catch {}
      setLocationsLoading(false);
    }
    setLocationSearch('');
    setLocationPickerVisible(true);
  }, [locations.length]);

  const search = useCallback(async () => {
    setLoading(true);
    setSelectedIds({});
    setPos([]);
    try {
      const result = await getPurchaseOrdersApi({
        from:    toIsoDate(fromDate),
        to:      toIsoDate(toDate),
        limit:   100,
        ...(poNumber.trim() ? { poNumber: poNumber.trim() } : {}),
      });
      // Filter client-side by location and status
      const items = result.items.filter(p => {
        const locMatch = !locationId || String(p.locationId) === locationId || String(p.location?.id) === locationId;
        const statusMatch = statusFilters.length === 0 || statusFilters.includes((p.status ?? '').toUpperCase());
        return locMatch && statusMatch;
      });
      setPos(items);
      if (items.length === 0) {
        showAlert({ type: 'info', title: 'No Results', message: 'No purchase orders found for the selected filters.' });
      }
    } catch (err: any) {
      showAlert({ type: 'error', title: 'Search Failed', message: err?.message ?? 'Failed to load purchase orders' });
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate, poNumber, locationId, statusFilters, showAlert]);

  const allSelected = pos.length > 0 && pos.every(p => selectedIds[p.id]);

  const toggleAll = () => {
    if (allSelected) {
      setSelectedIds({});
    } else {
      const next: Record<string, boolean> = {};
      pos.forEach(p => { next[p.id] = true; });
      setSelectedIds(next);
    }
  };

  const selectedPos = useMemo(
    () => pos.filter(p => selectedIds[p.id]),
    [pos, selectedIds],
  );

  // ── Excel export ─────────────────────────────────────────────────────────
  const exportExcel = useCallback(async () => {
    const targets = selectedPos.length > 0 ? selectedPos : pos;
    if (targets.length === 0) {
      showAlert({ type: 'error', title: 'Nothing to Export', message: 'Search for purchase orders first.' });
      return;
    }

    setExporting(true);
    try {
      // Fetch each PO detail for line items
      const detailedResults = await Promise.all(
        targets.map(p => getPurchaseOrderApi(p.id).catch(() => null)),
      );

      const pad = (n: number): any[] => Array(n).fill('');
      const merge = (r1: number, c1: number, r2: number, c2: number) =>
        ({ s: { r: r1, c: c1 }, e: { r: r2, c: c2 } });

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

      const CO_NAME  = 'FOCUS LAB';
      const CO_ADDR1 = '#17 St 480, Sangkat Toul Toum Pong 1, Khan Chamkarmon, Phnom Penh 12310';
      const CO_TEL   = 'Tel: 0964222816';
      const CO_EMAIL = 'sen.sov@gmail.com';
      const LOGO_COLS = 2;

      // ── Sheet 1: Purchase Orders summary ───────────────────────────────────
      const S_COLS = 9; // #, PO Number, Vendor, Location, Status, Order Date, Received Date, Total, Note
      const summaryRows: any[][] = [
        [...pad(LOGO_COLS), CO_NAME,  ...pad(S_COLS - LOGO_COLS - 1)],
        [...pad(LOGO_COLS), CO_ADDR1, ...pad(S_COLS - LOGO_COLS - 1)],
        [...pad(LOGO_COLS), `${CO_TEL}  |  ${CO_EMAIL}`, ...pad(S_COLS - LOGO_COLS - 1)],
        pad(S_COLS),
        ['PURCHASE ORDER SUMMARY REPORT', ...pad(S_COLS - 1)],
        [`Period: ${toIsoDate(fromDate)}  →  ${toIsoDate(toDate)}`, ...pad(S_COLS - 1)],
        pad(S_COLS),
        ['#', 'PO Number', 'Vendor', 'Location', 'Status', 'Order Date', 'Received Date', 'Total (USD)', 'Note'],
      ];
      const summaryMerges = [
        merge(0, LOGO_COLS, 0, S_COLS - 1),
        merge(1, LOGO_COLS, 1, S_COLS - 1),
        merge(2, LOGO_COLS, 2, S_COLS - 1),
        merge(4, 0, 4, S_COLS - 1),
        merge(5, 0, 5, S_COLS - 1),
      ];

      targets.forEach((p, i) => {
        const vendor   = p.vendorName ?? p.vendor?.nameEn ?? p.vendor?.nameKm ?? '—';
        const loc      = p.location ? `${p.location.code ?? ''} - ${p.location.nameEn ?? ''}`.trim().replace(/^- /, '') : '';
        const total    = parseCents(p.totalCents) / 100;
        summaryRows.push([
          i + 1,
          p.poNumber,
          vendor,
          loc,
          (p.status ?? '').toUpperCase(),
          fmtDate(p.createdAt),
          fmtDate(p.receivedAt),
          total,
          p.receiptNote ?? '',
        ]);
      });

      const summaryWs = XLSX.utils.aoa_to_sheet(summaryRows);
      summaryWs['!merges'] = summaryMerges;
      summaryWs['!rows']   = [{ hpt: 35 }, { hpt: 35 }, { hpt: 35 }];
      summaryWs['!cols']   = [
        { wch: 5  }, // #
        { wch: 18 }, // PO Number
        { wch: 24 }, // Vendor
        { wch: 22 }, // Location
        { wch: 12 }, // Status
        { wch: 14 }, // Order Date
        { wch: 14 }, // Received Date
        { wch: 14 }, // Total (USD)
        { wch: 24 }, // Note
      ];
      const S_HDR_ROW = 7;
      applyHeaderStyle(summaryWs, S_HDR_ROW, S_COLS);

      // ── Sheet 2: Line Items ─────────────────────────────────────────────────
      const D_COLS = 11; // PO Number, SKU, Name (EN), Name (KH), Qty, Unit Price, Cost After Dis, Discount %, Discount, Tax, Total
      const detailRows: any[][] = [];
      const detailMerges: ReturnType<typeof merge>[] = [];
      const detailColHdrRows: number[] = [];

      targets.forEach((p, idx) => {
        const detail   = detailedResults[idx];
        const vendor   = p.vendorName ?? p.vendor?.nameEn ?? '—';
        const loc      = p.location ? `${p.location.code ?? ''} - ${p.location.nameEn ?? ''}`.trim().replace(/^- /, '') : '';
        const total    = parseCents(p.totalCents) / 100;

        const startRow = detailRows.length;

        if (idx === 0) {
          detailRows.push([...pad(LOGO_COLS), CO_NAME,  ...pad(D_COLS - LOGO_COLS - 1)]);
          detailRows.push([...pad(LOGO_COLS), CO_ADDR1, ...pad(D_COLS - LOGO_COLS - 1)]);
          detailRows.push([...pad(LOGO_COLS), `${CO_TEL}  |  ${CO_EMAIL}`, ...pad(D_COLS - LOGO_COLS - 1)]);
          detailRows.push(pad(D_COLS));
          detailMerges.push(
            merge(startRow,     LOGO_COLS, startRow,     D_COLS - 1),
            merge(startRow + 1, LOGO_COLS, startRow + 1, D_COLS - 1),
            merge(startRow + 2, LOGO_COLS, startRow + 2, D_COLS - 1),
          );
        }

        // PO meta
        const metaStart = detailRows.length;
        detailRows.push([`PO: ${p.poNumber}`, ...pad(D_COLS - 1)]);
        detailRows.push([
          `Vendor: ${vendor}`,
          `Location: ${loc}`,
          `Status: ${(p.status ?? '').toUpperCase()}`,
          `Date: ${fmtDate(p.createdAt)}`,
          `Total: $${total.toFixed(2)}`,
          ...pad(D_COLS - 5),
        ]);
        detailMerges.push(merge(metaStart, 0, metaStart, D_COLS - 1));

        // Column headers
        const colHdrRow = detailRows.length;
        detailColHdrRows.push(colHdrRow);
        detailRows.push([
          'PO Number', 'SKU', 'Name (EN)', 'Name (KH)',
          'Qty', 'Unit Price (USD)', 'Cost After Dis (USD)',
          'Discount (%)', 'Discount (USD)', 'Tax (USD)', 'Total (USD)',
        ]);

        // Item rows
        const items = detail?.items ?? [];
        items.forEach(item => {
          const unitPrice       = item.unitPrice ?? parseCents(item.unitPriceCents);
          const discountAmt     = item.discountAmount ?? parseCents(item.discountCents);
          const tax             = parseCents(item.taxCents);
          const itemTotal       = item.lineTotal ?? (unitPrice * item.qty - discountAmt);
          const discountPct     = item.discountPercent ?? item.discountPct
            ?? (unitPrice > 0 && discountAmt > 0 ? Number(((discountAmt / (unitPrice * item.qty)) * 100).toFixed(2)) : 0);
          detailRows.push([
            p.poNumber,
            item.sku ?? item.productSku ?? '',
            item.nameEn ?? item.productNameEn ?? item.productName ?? '',
            item.nameKm ?? item.productNameKm ?? '',
            item.qty,
            unitPrice,
            item.afterDiscount ?? '',
            discountPct,
            discountAmt,
            tax,
            itemTotal,
          ]);
        });

        detailRows.push(pad(D_COLS));
      });

      const detailWs = XLSX.utils.aoa_to_sheet(detailRows);
      detailWs['!merges'] = detailMerges;
      detailWs['!rows']   = [{ hpt: 35 }, { hpt: 35 }, { hpt: 35 }];
      detailWs['!cols']   = [
        { wch: 18 }, // PO Number
        { wch: 14 }, // SKU
        { wch: 28 }, // Name (EN)
        { wch: 28 }, // Name (KH)
        { wch: 8  }, // Qty
        { wch: 16 }, // Unit Price (USD)
        { wch: 18 }, // Cost After Dis (USD)
        { wch: 14 }, // Discount (%)
        { wch: 16 }, // Discount (USD)
        { wch: 14 }, // Tax (USD)
        { wch: 14 }, // Total (USD)
      ];
      detailColHdrRows.forEach(r => applyHeaderStyle(detailWs, r, D_COLS));

      // Battambang font for Name (KH) column (col index 3)
      const detailRange = XLSX.utils.decode_range(detailWs['!ref'] ?? 'A1');
      for (let r = detailRange.s.r; r <= detailRange.e.r; r++) {
        const addr = XLSX.utils.encode_cell({ r, c: 3 });
        if (!detailWs[addr]) continue;
        const existing = detailWs[addr].s ?? {};
        detailWs[addr].s = { ...existing, font: { ...(existing.font ?? {}), name: 'Battambang' } };
      }

      // ── Write + inject logo ─────────────────────────────────────────────────
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, summaryWs, 'Purchase Orders');
      XLSX.utils.book_append_sheet(wb, detailWs,  'Line Items');

      const wbBase64 = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
      const rawLogo  = LOGO_BASE64.replace(/^data:image\/\w+;base64,/, '');
      const detailFreezeRow = detailColHdrRows.length > 0 ? detailColHdrRows[0] + 1 : null;
      const wbOut    = await injectLogoIntoXlsx(wbBase64, rawLogo, 2, [S_HDR_ROW + 1, detailFreezeRow]);

      const fileName = `purchase_orders_${todayStr()}.xlsx`;
      const filePath = `${FileSystem.documentDirectory}${fileName}`;
      await FileSystem.writeAsStringAsync(filePath, wbOut, { encoding: FileSystem.EncodingType.Base64 });
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) await Sharing.shareAsync(filePath, { mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', dialogTitle: fileName });
    } catch (err: any) {
      showAlert({ type: 'error', title: 'Export Failed', message: err?.message ?? 'Failed to export Excel' });
    } finally {
      setExporting(false);
    }
  }, [selectedPos, pos, fromDate, toDate, showAlert]);

  // ── Render ────────────────────────────────────────────────────────────────
  const totalBilled = pos.reduce((s, p) => s + parseCents(p.billTotalCents ?? p.totalCents) / 100, 0);
  const totalPaid   = pos.reduce((s, p) => s + parseCents(p.paidAmountCents) / 100, 0);

  const renderItem = ({ item: p }: { item: ApiPurchaseOrder }) => {
    const selected  = !!selectedIds[p.id];
    const vendor    = p.vendorName ?? p.vendor?.nameEn ?? '—';
    const locCode   = p.location?.code ?? '';
    const locName   = p.location?.nameEn ?? '';
    const loc       = [locCode, locName].filter(Boolean).join(' ');
    const total     = parseCents(p.totalCents) / 100;
    const statusClr = STATUS_COLORS[p.status] ?? '#6B7280';
    return (
      <TouchableOpacity
        style={[styles.row, selected && styles.rowSelected]}
        onPress={() => setSelectedIds(prev => ({ ...prev, [p.id]: !prev[p.id] }))}
        activeOpacity={0.7}
      >
        <View style={[styles.checkbox, selected && styles.checkboxFilled]}>
          {selected && <Icon name="check" size={14} color="#fff" />}
        </View>
        <View style={styles.rowBody}>
          <View style={styles.rowTop}>
            <AppText style={styles.poNumber}>{p.poNumber}</AppText>
            <AppText style={[styles.statusBadge, { color: statusClr }]}>
              {(p.status ?? '').toUpperCase()}
            </AppText>
          </View>
          <View style={styles.noteRow}>
            <AppText style={[styles.meta, { fontWeight: '700', color: '#2563EB' }]}>Vendor:</AppText>
            <AppText style={[styles.meta, { flexShrink: 1, color: '#2563EB' }]}>{vendor}</AppText>
          </View>
          {!!loc && <AppText style={styles.metaSub}>{loc}</AppText>}
          {!!p.receiptNote && (
            <View style={styles.noteRow}>
              <AppText style={[styles.meta, { fontWeight: '700', color: '#059669' }]}>No:</AppText>
              <AppText style={[styles.meta, { flexShrink: 1, color: '#059669' }]}>{p.receiptNote}</AppText>
            </View>
          )}
          <View style={styles.rowBottom}>
            <AppText style={styles.rowDate}>{fmtDate(p.createdAt)}</AppText>
            <AppText style={styles.rowTotal}>${total.toFixed(2)}</AppText>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
      <AppBar title="PO Export" onBack={onBack} showBack />

      {/* ── Filters ───────────────────────────────────────────────────────────── */}
      <View style={styles.filters}>
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

        <View style={styles.filterRow}>
          <TouchableOpacity style={styles.locationPill} onPress={openLocationPicker}>
            {locationsLoading
              ? <ActivityIndicator size="small" color={Colors.primary} />
              : <Icon name="place" size={14} color={Colors.primary} />
            }
            <AppText style={styles.datePillText} numberOfLines={1}>
              {selectedLocation
                ? `${selectedLocation.code}  ${selectedLocation.nameEn}`
                : 'All Locations'}
            </AppText>
            <Icon name="arrow-drop-down" size={18} color={Colors.primary} />
          </TouchableOpacity>

          <TextInput
            style={styles.poInput}
            placeholder="PO #"
            placeholderTextColor="#9CA3AF"
            value={poNumber}
            onChangeText={setPoNumber}
            returnKeyType="search"
            onSubmitEditing={() => { search(); }}
          />
        </View>

        {/* Status chips */}
        <View style={styles.chipRow}>
          {(['RECEIVED', 'BILLED', 'PAID'] as const).map(s => {
            const active = statusFilters.includes(s);
            return (
              <TouchableOpacity
                key={s}
                style={[styles.chip, active && styles.chipActive]}
                onPress={() => setStatusFilters(prev =>
                  prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s],
                )}
              >
                <AppText style={[styles.chipText, active && styles.chipTextActive]}>{s}</AppText>
              </TouchableOpacity>
            );
          })}
        </View>

        <AppButton
          label={loading ? 'Searching…' : 'Search'}
          onPress={() => { search(); }}
          disabled={loading}
          style={styles.searchBtn}
        />
      </View>

      {/* ── Toolbar ───────────────────────────────────────────────────────────── */}
      {pos.length > 0 && (
        <View style={styles.toolbar}>
          <TouchableOpacity style={styles.selectAllRow} onPress={toggleAll}>
            <View style={[styles.checkbox, allSelected && styles.checkboxFilled]}>
              {allSelected && <Icon name="check" size={14} color="#fff" />}
            </View>
            <AppText style={styles.selectAllText}>
              {allSelected ? 'Deselect All' : 'Select All'} ({pos.length})
            </AppText>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.exportBtn, exporting && styles.exportBtnBusy]}
            onPress={() => { exportExcel(); }}
            disabled={exporting}
          >
            {exporting
              ? <ActivityIndicator size="small" color="#fff" />
              : <Icon name="file-download" size={16} color="#fff" />
            }
            <AppText style={styles.exportBtnText}>
              {exporting
                ? 'Exporting…'
                : selectedPos.length > 0
                  ? `Export (${selectedPos.length})`
                  : 'Export All'
              }
            </AppText>
          </TouchableOpacity>
        </View>
      )}

      {/* ── Summary cards ─────────────────────────────────────────────────────── */}
      {pos.length > 0 && (
        <View style={styles.cards}>
          <View style={[styles.card, styles.cardOrders]}>
            <View style={styles.cardIconWrap}>
              <Icon name="receipt" size={20} color="#2563EB" />
            </View>
            <View style={styles.cardBody}>
              <AppText style={styles.cardLabel}>Total Billed</AppText>
              <AppText style={[styles.cardAmount, styles.cardAmountOrders]}>${totalBilled.toFixed(2)}</AppText>
              <AppText style={styles.cardCount}>{pos.length} order{pos.length !== 1 ? 's' : ''}</AppText>
            </View>
          </View>

          <View style={[styles.card, styles.cardValue]}>
            <View style={styles.cardIconWrap}>
              <Icon name="check-circle" size={20} color="#059669" />
            </View>
            <View style={styles.cardBody}>
              <AppText style={styles.cardLabel}>Total Paid</AppText>
              <AppText style={[styles.cardAmount, styles.cardAmountValue]}>${totalPaid.toFixed(2)}</AppText>
              <AppText style={styles.cardCount}>USD</AppText>
            </View>
          </View>
        </View>
      )}

      {/* ── List ──────────────────────────────────────────────────────────────── */}
      <FlatList
        data={pos}
        keyExtractor={p => String(p.id)}
        renderItem={renderItem}
        style={styles.listView}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={() => { search(); }}
            colors={[Colors.primary]}
            tintColor={Colors.primary}
          />
        }
        ListEmptyComponent={
          loading ? null : (
            <View style={styles.emptyWrap}>
              <Icon name="shopping-bag" size={40} color="#D1D5DB" />
              <AppText style={styles.emptyText}>Set filters and tap Search to load purchase orders.</AppText>
            </View>
          )
        }
      />

      {/* ── Date pickers ──────────────────────────────────────────────────────── */}
      <DatePickerModal
        visible={fromPickerVisible}
        value={fromDate}
        onChange={(d: Date) => { setFromDate(d); setFromPickerVisible(false); }}
        onClose={() => setFromPickerVisible(false)}
      />
      <DatePickerModal
        visible={toPickerVisible}
        value={toDate}
        onChange={(d: Date) => { setToDate(d); setToPickerVisible(false); }}
        onClose={() => setToPickerVisible(false)}
      />

      {/* ── Location picker modal ─────────────────────────────────────────────── */}
      <Modal visible={locationPickerVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <AppText style={styles.modalTitle}>Select Location</AppText>
              <TouchableOpacity onPress={() => setLocationPickerVisible(false)}>
                <Icon name="close" size={22} color="#374151" />
              </TouchableOpacity>
            </View>
            <FlatList
              data={[{ id: '', code: '', nameEn: 'All Locations', nameKm: '' } as ApiLocation, ...filteredLocations]}
              keyExtractor={l => String(l.id)}
              style={styles.locationList}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item: l }) => {
                const isAll      = l.id === '';
                const isSelected = isAll ? locationId === null : String(l.id) === locationId;
                return (
                  <TouchableOpacity
                    style={[styles.locationRow, isSelected && styles.locationRowSelected]}
                    onPress={() => {
                      setLocationId(isAll ? null : String(l.id));
                      setLocationPickerVisible(false);
                    }}
                  >
                    <AppText style={[styles.locationRowText, isSelected && styles.locationRowTextSelected]}>
                      {isAll ? 'All Locations' : [l.code, l.nameEn].filter(Boolean).join('  ')}
                    </AppText>
                    {isSelected && <Icon name="check" size={18} color={Colors.primary} />}
                  </TouchableOpacity>
                );
              }}
            />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

export default POExportScreen;

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F9FAFB' },

  // Filters
  filters:      { padding: 12, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#E5E7EB', gap: 8 },
  dateRow:      { flexDirection: 'row', alignItems: 'center', marginBottom: 0 },
  datePill: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#F3F4F6', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8,
  },
  datePillText: { fontSize: 13, color: '#374151', flex: 1 },
  arrow:        { marginHorizontal: 8, color: '#6B7280', fontSize: 16 },
  filterRow:    { flexDirection: 'row', alignItems: 'center', gap: 8 },
  locationPill: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#F3F4F6', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8,
  },
  poInput: {
    flex: 1, backgroundColor: '#F3F4F6', borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 8, fontSize: 13, color: '#374151',
  },
  chipRow:      { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip:         { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20, backgroundColor: '#F3F4F6', borderWidth: 1, borderColor: '#E5E7EB' },
  chipActive:   { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipText:     { fontSize: 12, fontWeight: '600', color: '#6B7280' },
  chipTextActive: { color: '#fff' },
  searchBtn: { borderRadius: 8 },

  // Toolbar
  toolbar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 12, paddingVertical: 8,
    backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#E5E7EB',
  },
  selectAllRow:  { flexDirection: 'row', alignItems: 'center', gap: 8 },
  selectAllText: { fontSize: 13, color: '#374151', fontWeight: '500' },
  exportBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#059669', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8,
  },
  exportBtnBusy: { opacity: 0.6 },
  exportBtnText: { color: '#fff', fontSize: 13, fontWeight: '600' },

  // Summary cards
  cards: { flexDirection: 'row', gap: 10, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: '#F9FAFB' },
  card: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10,
    borderRadius: 12, padding: 12,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  cardOrders: { backgroundColor: '#EFF6FF', borderWidth: 1, borderColor: '#BFDBFE' },
  cardValue:  { backgroundColor: '#F0FDF4', borderWidth: 1, borderColor: '#A7F3D0' },
  cardIconWrap: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center',
  },
  cardBody:         { flex: 1 },
  cardLabel:        { fontSize: 11, color: '#6B7280', fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4 },
  cardAmount:       { fontSize: 18, fontWeight: '800', marginTop: 1 },
  cardAmountOrders: { color: '#2563EB' },
  cardAmountValue:  { color: '#059669' },
  cardCount:        { fontSize: 11, color: '#9CA3AF', marginTop: 1 },

  // List
  loader:   { marginTop: 40 },
  listView: { backgroundColor: '#fff' },
  list:     { paddingBottom: 32 },
  emptyWrap: { alignItems: 'center', paddingTop: 60, gap: 12 },
  emptyText: { fontSize: 14, color: '#9CA3AF', textAlign: 'center' },

  // Row
  row: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff',
    paddingHorizontal: 16, paddingVertical: 12, gap: 10,
    borderBottomWidth: 1, borderBottomColor: '#F3F4F6',
  },
  rowSelected: { backgroundColor: '#EFF6FF', borderLeftWidth: 3, borderLeftColor: Colors.primary },
  checkbox: {
    width: 22, height: 22, borderRadius: 6,
    borderWidth: 1.5, borderColor: '#D1D5DB',
    alignItems: 'center', justifyContent: 'center',
  },
  checkboxFilled: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  rowBody:   { flex: 1 },
  rowTop:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 },
  poNumber:  { fontSize: 14, fontWeight: '700', color: '#111827' },
  statusBadge: { fontSize: 11, fontWeight: '700' },
  meta:      { fontSize: 12, color: '#6B7280', marginBottom: 1, flexShrink: 1 },
  noteRow:   { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaSub:   { fontSize: 11, color: '#9CA3AF', marginBottom: 4 },
  rowBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowDate:   { fontSize: 12, color: '#9CA3AF' },
  rowTotal:  { fontSize: 14, fontWeight: '700', color: '#059669' },

  // Location modal
  modalOverlay:  { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalSheet:    { backgroundColor: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: '70%' },
  modalHeader:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderBottomColor: '#E5E7EB' },
  modalTitle:    { fontSize: 16, fontWeight: '700', color: '#111827' },
  locationList:  { flexGrow: 0 },
  locationRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: '#F3F4F6',
  },
  locationRowSelected:     { backgroundColor: '#F0FDF4' },
  locationRowText:         { fontSize: 14, color: '#374151' },
  locationRowTextSelected: { color: Colors.primary, fontWeight: '600' },
});
