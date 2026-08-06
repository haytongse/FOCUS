import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Image,
  RefreshControl,
  TextInput,
  ScrollView,
  Platform,
  Alert,
  Modal,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { MaterialIcons as Icon } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import XLSX from 'xlsx';
import Colors from '../../theme/colors';
import AppText from '../../components/AppText';
import AppBar from '../../components/AppBar';
import { useAlert } from '../../components/AppAlert';
import {
  getAllProductsApi,
  getCategoriesApi,
  getVendorsApi,
  getUomsApi,
  getLocationsApi,
  getProductLocationsApi,
  createProductApi,
  updateProductApi,
  addProductLocationApi,
  removeProductLocationApi,
  getStockReceivedBySkuApi,
  getInvoiceDetailsTotalOnhandApi,
  ApiProduct,
  ApiCategory,
  ApiVendor,
  ApiUom,
  ApiLocation,
  ApiProductLocation,
} from '../../services/focusApi';

interface Props {
  onBack: () => void;
  onCreate: () => void;
  onEdit: (product: ApiProduct) => void;
}

const CATEGORY_COLORS = [
  '#2563EB', '#F59E0B', '#EF4444', '#10B981',
  '#7C3AED', '#06B6D4', '#F97316', '#EC4899',
];

const CATEGORY_ICONS = [
  'category', 'local-cafe', 'restaurant', 'cake',
  'fastfood', 'local-pizza', 'icecream', 'rice-bowl',
];

const CSV_HEADERS = ['id', 'sku', 'nameEn', 'nameKm', 'pricingMode', 'fixedPrice', 'unit', 'isRentalItem', 'active', 'country', 'size', 'categoryName', 'vendorCode', 'uomCode', 'locations'];

const escapeCsv = (val: string | null | undefined): string => {
  const s = val ?? '';
  return s.includes(',') || s.includes('"') || s.includes('\n')
    ? `"${s.replace(/"/g, '""')}"` : s;
};

const parseCsvLine = (line: string): string[] => {
  const result: string[] = [];
  let cur = ''; let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuote && line[i + 1] === '"') { cur += '"'; i++; }
      else { inQuote = !inQuote; }
    } else if (ch === ',' && !inQuote) {
      result.push(cur.trim()); cur = '';
    } else { cur += ch; }
  }
  result.push(cur.trim());
  return result;
};

const readCsvFile = async (uri: string): Promise<string> => {
  try {
    const res = await fetch(uri);
    const text = await res.text();
    return text.replace(/^﻿/, '');
  } catch {
    const text = await FileSystem.readAsStringAsync(uri);
    return text.replace(/^﻿/, '');
  }
};

const ProductsListScreen: React.FC<Props> = ({ onBack, onCreate, onEdit }) => {
  const { showAlert } = useAlert();
  const [products, setProducts] = useState<ApiProduct[]>([]);
  const [categories, setCategories] = useState<ApiCategory[]>([]);
  const [vendors, setVendors] = useState<ApiVendor[]>([]);
  const [uoms, setUoms] = useState<ApiUom[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Bust React Native's image cache each time this screen mounts (after returning from edit)
  const [imageCacheBuster] = useState(() => Date.now());
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [locationsMap, setLocationsMap] = useState<Record<string, ApiProductLocation[]>>({});
  const [lastCostMap, setLastCostMap] = useState<Record<string, number>>({});
  // productId → { rc: totalReceived, out: totalQty, onhand: totalOnhand } from /api/v1/invoice-details/total-onhand
  const [stockDetail, setStockDetail] = useState<Record<string, { rc: number; out: number; onhand: number }>>({});
  // authoritative total working stock summed directly from the endpoint
  const [totalWorking, setTotalWorking] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [showScanner, setShowScanner] = useState(false);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const scanCooldown = useRef(false);

  const openScanner = async () => {
    if (!cameraPermission?.granted) {
      const { granted } = await requestCameraPermission();
      if (!granted) { Alert.alert('Permission required', 'Camera access is needed to scan barcodes.'); return; }
    }
    setShowScanner(true);
  };

  const handleBarcodeScan = ({ data }: { data: string }) => {
    if (scanCooldown.current) return;
    scanCooldown.current = true;
    setShowScanner(false);
    setSearchQuery(data.trim());
    setTimeout(() => { scanCooldown.current = false; }, 1500);
  };
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [displayPage, setDisplayPage] = useState(1);

  const PAGE_SIZE = 30; // multiple of 3 columns = clean grid rows

  useEffect(() => { setDisplayPage(1); }, [selectedCategoryId, searchQuery]);

  const load = useCallback((silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    Promise.all([
      getAllProductsApi(),
      getCategoriesApi(),
      getVendorsApi(),
      getUomsApi().catch(() => [] as ApiUom[]),
      getInvoiceDetailsTotalOnhandApi().catch(() => []),
      getStockReceivedBySkuApi().catch(() => []),
    ]).then(([prods, cats, vens, uomsList, onhandItems, lastCosts]) => {
      const workingTotal = onhandItems.reduce((sum, s) => sum + s.totalOnhand, 0);
      const onhandMap = new Map<string, { totalQty: number; totalReceived: number; totalOnhand: number }>(
        onhandItems.map(s => [String(s.productId), { totalQty: s.totalQty, totalReceived: s.totalReceived, totalOnhand: s.totalOnhand }]),
      );
      const detail: Record<string, { rc: number; out: number; onhand: number }> = {};
      const sorted = [...prods]
        .map(p => {
          const oh = onhandMap.get(String(p.id));
          detail[p.id] = { rc: oh?.totalReceived ?? 0, out: oh?.totalQty ?? 0, onhand: oh?.totalOnhand ?? 0 };
          return { ...p, qtyOnHand: oh?.totalOnhand ?? 0 };
        })
        .sort((a, b) => Number(b.id) - Number(a.id));
      setProducts(sorted);
      setCategories(cats);
      setVendors(vens);
      setUoms(uomsList);
      setStockDetail(detail);
      setTotalWorking(workingTotal);
      const costMap: Record<string, number> = {};
      lastCosts.forEach(lc => { if (lc.lastCostCents != null) costMap[String(lc.productId)] = lc.lastCostCents; });
      setLastCostMap(costMap);
      Promise.allSettled(sorted.map(p => getProductLocationsApi(p.id))).then(results => {
        const map: Record<string, ApiProductLocation[]> = {};
        results.forEach((r, i) => {
          if (r.status === 'fulfilled') map[sorted[i].id] = r.value;
        });
        setLocationsMap(map);
      });
    })
    .catch(err => setError(err?.message ?? 'Failed to load products'))
    .finally(() => { setLoading(false); setRefreshing(false); });
  }, []);

  useEffect(() => { load(); }, [load]);

  const onRefresh = () => { setRefreshing(true); load(true); };

  const categoryFiltered = selectedCategoryId === null
    ? products
    : products.filter(p => p.categoryId === selectedCategoryId);

  const filteredProducts = searchQuery.trim()
    ? categoryFiltered.filter(p => {
        const q = searchQuery.toLowerCase();
        return (
          p.nameEn?.toLowerCase().includes(q) ||
          p.nameKm?.toLowerCase().includes(q) ||
          p.sku?.toLowerCase().includes(q)
        );
      })
    : categoryFiltered;

  const displayedProducts = useMemo(
    () => filteredProducts.slice(0, displayPage * PAGE_SIZE),
    [filteredProducts, displayPage, PAGE_SIZE],
  );

  const { totalCost, totalSale } = useMemo(() => {
    let cost = 0;
    let sale = 0;
    filteredProducts.forEach(p => {
      const qty = p.qtyOnHand ?? 0;
      if (p.costPriceCents) cost += qty * parseInt(p.costPriceCents, 10);
      if (p.fixedPriceCents) sale += qty * parseInt(p.fixedPriceCents, 10);
    });
    return { totalCost: cost, totalSale: sale };
  }, [filteredProducts]);

  const handleEndReached = useCallback(() => {
    if (displayedProducts.length < filteredProducts.length) setDisplayPage(p => p + 1);
  }, [displayedProducts.length, filteredProducts.length]);

  const renderListFooter = useCallback(() => {
    if (displayedProducts.length >= filteredProducts.length) return null;
    return (
      <View style={styles.paginationFooter}>
        <ActivityIndicator size="small" color={Colors.primary} />
        <AppText style={styles.paginationText}>{displayedProducts.length} of {filteredProducts.length}</AppText>
      </View>
    );
  }, [displayedProducts.length, filteredProducts.length]);

  const sidebarCategories = categories;

  const handleTemplate = async () => {
    try {
      const rows = [
        CSV_HEADERS.join(','),
        ',SKU001,Product Name,ឈ្មោះផលិតផល,FIXED,10.00,PCS,false,true,KH,Large,Electronics,VENDOR01,PCS,WH-A;WH-B',
        ',SKU002,Another Product,ផលិតផលទី២,RFQ,,UNIT,false,true,,,,,,,',
      ].join('\n');
      const path = `${FileSystem.documentDirectory}products_template.csv`;
      await FileSystem.writeAsStringAsync(path, rows);
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) await Sharing.shareAsync(path, { mimeType: 'text/csv', dialogTitle: 'Download Product Template' });
    } catch (err: any) {
      if (err?.message !== 'User did not share') {
        showAlert({ type: 'error', title: 'Template Failed', message: err?.message ?? 'Could not create template.' });
      }
    }
  };

  const handleExport = async () => {
    if (products.length === 0) {
      showAlert({ type: 'info', title: 'Nothing to Export', message: 'No products to export.' });
      return;
    }
    setExporting(true);
    try {
      const rows: string[][] = [...products].sort((a, b) => Number(a.id) - Number(b.id)).map(p => {
        const catName    = categories.find(c => c.id === p.categoryId)?.nameEn ?? '';
        const vendorCode = vendors.find(v => v.id === Number(p.vendorId))?.code ?? '';
        const uomCode    = uoms.find(u => u.id === p.uomId)?.code ?? '';
        const locs       = (locationsMap[p.id] ?? p.locations ?? []).map((l: any) => l.locationCode).join(';');
        return [
          String(p.id ?? ''),
          String(p.sku ?? ''),
          p.nameEn ?? '',
          p.nameKm ?? '',
          p.pricingMode ?? 'FIXED',
          p.fixedPriceCents ? String(parseInt(p.fixedPriceCents, 10) / 100) : '',
          p.unit ?? '',
          p.isRentalItem ? 'true' : 'false',
          p.active !== false ? 'true' : 'false',
          p.country ?? '',
          p.size ?? '',
          catName,
          vendorCode,
          uomCode,
          locs,
        ];
      });

      const ws = XLSX.utils.aoa_to_sheet([CSV_HEADERS, ...rows]);

      // Force id and sku columns (A & B) to text type so Excel never shows scientific notation.
      // Must update both t (type) and v (value) — mismatched t/v causes blank cells in some Excel versions.
      const textCols = [0, 1]; // id, sku
      [CSV_HEADERS, ...rows].forEach((row, r) => {
        textCols.forEach(c => {
          const addr = XLSX.utils.encode_cell({ r, c });
          if (ws[addr]) {
            ws[addr].t = 's';
            ws[addr].v = String(ws[addr].v ?? '');
          }
        });
      });

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Products');

      const wbout: string = XLSX.write(wb, { bookType: 'xlsx', type: 'base64' });
      const path = `${FileSystem.documentDirectory}products_export.xlsx`;
      await FileSystem.writeAsStringAsync(path, wbout, { encoding: FileSystem.EncodingType.Base64 });
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) await Sharing.shareAsync(path, { mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', dialogTitle: 'Export Products' });
    } catch (err: any) {
      if (err?.message !== 'User did not share') {
        showAlert({ type: 'error', title: 'Export Failed', message: err?.message ?? 'Could not export file.' });
      }
    } finally {
      setExporting(false);
    }
  };

  const handleImport = async () => {
    try {
      const pickerRes = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
      if (pickerRes.canceled) return;
      const file = pickerRes.assets[0];

      // Detect file type from extension in name or URI (more reliable than MIME type)
      const filename = file.name ?? decodeURIComponent(file.uri).split(/[/?#]/).pop() ?? '';
      const ext = filename.split('.').pop()?.toLowerCase() ?? '';
      const isXlsx = ['xlsx', 'xls'].includes(ext)
        || (file.type ?? '').includes('spreadsheet')
        || (file.type ?? '').includes('excel');

      let rows: string[][];

      if (isXlsx) {
        // Read XLSX: try fetch+arrayBuffer first, fall back to RNFS base64
        let wb: XLSX.WorkBook;
        try {
          const res = await fetch(file.uri);
          if (!res.ok) throw new Error(`fetch ${res.status}`);
          const buf = await res.arrayBuffer();
          wb = XLSX.read(new Uint8Array(buf), { type: 'array' });
        } catch {
          const b64 = await FileSystem.readAsStringAsync(file.uri, { encoding: FileSystem.EncodingType.Base64 });
          wb = XLSX.read(b64, { type: 'base64' });
        }
        if (!wb.SheetNames.length) throw new Error('Excel file has no sheets.');
        const ws = wb.Sheets[wb.SheetNames[0]];
        rows = (XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' }) as string[][]);
        if (rows.length < 2) {
          showAlert({ type: 'error', title: 'Invalid File', message: 'Excel file must have a header row and at least one data row.' });
          return;
        }
      } else {
        const content = await readCsvFile(file.uri);
        const lines = content.split(/\r?\n/).filter(l => l.trim());
        if (lines.length < 2) {
          showAlert({ type: 'error', title: 'Invalid File', message: 'CSV must have a header row and at least one data row.' });
          return;
        }
        rows = lines.map(l => parseCsvLine(l));
      }

      const rawHeader = rows[0].map((h: string) =>
        String(h).replace(/^﻿/, '').toLowerCase().replace(/[\s_-]/g, ''),
      );
      const col = (name: string) => rawHeader.indexOf(name);

      if (col('sku') === -1 || col('nameen') === -1) {
        showAlert({
          type: 'error',
          title: 'Header Mismatch',
          message: `File: ${filename || 'unknown'}\nMissing: ${[col('sku') === -1 && 'sku', col('nameen') === -1 && 'nameEn'].filter(Boolean).join(', ')}\n\nDetected columns:\n${rawHeader.join(', ')}`,
        });
        return;
      }

      rows = rows.slice(1).filter(r => r.some(v => v?.trim()));
      showAlert({
        type: 'confirm',
        title: 'Import Products',
        message: `Import ${rows.length} product row${rows.length !== 1 ? 's' : ''}?`,
        actions: [
          { label: 'Cancel', variant: 'outline' },
          {
            label: 'Import', variant: 'primary',
            onPress: async () => {
              setImporting(true);
              let success = 0;
              const errors: string[] = [];

              // Strip ="..." wrapper, then convert Excel scientific notation to full integer string
              const unquoteNum = (v: string | undefined): string => {
                const s = (v ?? '').replace(/^="(.*)"$/, '$1').trim();
                if (/^-?[\d.]+[Ee][+-]?\d+$/i.test(s)) {
                  return String(Math.round(Number(s)));
                }
                return s;
              };

              // Load all warehouse locations once so we can match by code
              let allLocations: ApiLocation[] = [];
              try { allLocations = await getLocationsApi(); } catch { /* skip location import if unavailable */ }

              for (let i = 0; i < rows.length; i++) {
                const row         = rows[i];
                const id          = col('id') >= 0 ? unquoteNum(row[col('id')]) : '';
                const sku         = unquoteNum(row[col('sku')]);
                const nameEn      = row[col('nameen')]?.trim();
                const nameKm      = (col('namekm') >= 0 ? row[col('namekm')]?.trim() : '') || nameEn || '';
                const pricingMode = row[col('pricingmode')]?.trim().toUpperCase() === 'RFQ' ? 'RFQ' : 'FIXED';
                // Strip currency symbols, spaces, commas so "$3.60", " $3.60 ", "3,600.00" all parse correctly
                const fixedRaw    = (col('fixedprice') >= 0 ? row[col('fixedprice')] ?? '' : '').replace(/[^0-9.]/g, '');
                const fixedPriceCents = fixedRaw && pricingMode === 'FIXED'
                  ? String(Math.round(parseFloat(fixedRaw) * 100)) : undefined;
                const unit        = (col('unit') >= 0 ? row[col('unit')]?.trim() : '') || 'PCS';
                const isRentalItem = row[col('isrentalitem')]?.trim().toLowerCase() === 'true';
                const activeRaw   = col('active') >= 0 ? row[col('active')]?.trim().toLowerCase() : 'true';
                const active      = activeRaw !== 'false' && activeRaw !== '0';
                const country     = col('country') >= 0 ? row[col('country')]?.trim() || undefined : undefined;
                const size        = col('size') >= 0 ? row[col('size')]?.trim() || undefined : undefined;
                const catNameRaw  = col('categoryname') >= 0 ? row[col('categoryname')]?.trim() : '';
                const categoryId  = catNameRaw ? (categories.find(c => c.nameEn === catNameRaw)?.id ?? undefined) : undefined;
                const vendorCodeRaw = col('vendorcode') >= 0 ? row[col('vendorcode')]?.trim() : '';
                const vendorId    = vendorCodeRaw ? (vendors.find(v => v.code === vendorCodeRaw)?.id ?? undefined) : undefined;
                const uomCodeRaw  = col('uomcode') >= 0 ? row[col('uomcode')]?.trim() : '';
                const uomId       = uomCodeRaw ? (uoms.find(u => u.code === uomCodeRaw)?.id ?? undefined) : undefined;
                // Parse semicolon-separated location codes e.g. "MAINBRAND;WH-B"
                const locationCodes = col('locations') >= 0
                  ? (row[col('locations')] ?? '').split(';').map((s: string) => s.trim()).filter(Boolean)
                  : [];

                try {
                  let productId: string;
                  if (id) {
                    // ID present → update existing product
                    await updateProductApi(id, { nameEn, nameKm, pricingMode, fixedPriceCents, unit, isRentalItem, active, country, size, categoryId, vendorId, uomId });
                    productId = id;
                  } else {
                    // No ID → insert new product
                    if (!sku || !nameEn) {
                      errors.push(`Row ${i + 2}: missing sku or nameEn`);
                      continue;
                    }
                    const created = await createProductApi({ sku, nameEn, nameKm, pricingMode, fixedPriceCents, unit, isRentalItem, active, country, size, categoryId, vendorId, uomId });
                    productId = String(created.id);
                  }

                  // Sync locations: replace existing set with the import list.
                  // Only runs when the locations column has values — empty column = leave unchanged.
                  if (locationCodes.length > 0) {
                    const existing = await getProductLocationsApi(productId).catch(() => []);
                    // Remove locations not in the new list
                    for (const pl of existing) {
                      if (!locationCodes.includes(pl.locationCode)) {
                        await removeProductLocationApi(productId, pl.id).catch(() => {});
                      }
                    }
                    // Add locations not already assigned
                    const existingCodes = existing.map(pl => pl.locationCode);
                    for (const code of locationCodes) {
                      if (!existingCodes.includes(code)) {
                        const loc = allLocations.find(l => l.code === code);
                        if (loc) {
                          await addProductLocationApi(productId, { locationId: Number(loc.id) }).catch(() => {});
                        }
                      }
                    }
                  }

                  success++;
                } catch (err: any) {
                  const body = err?.response?.data;
                  const msg  = body?.error?.messageKey ?? body?.message ?? err?.message ?? 'unknown error';
                  errors.push(`Row ${i + 2} (${id || sku}): ${msg}`);
                }
              }

              setImporting(false);
              load(true);
              showAlert({
                type: success > 0 ? 'success' : 'error',
                title: 'Import Complete',
                message: success === rows.length
                  ? `All ${success} products imported successfully.`
                  : `${success} imported, ${errors.length} failed.\n\n${errors.slice(0, 5).join('\n')}${errors.length > 5 ? `\n…and ${errors.length - 5} more` : ''}`,
              });
            },
          },
        ],
      });
    } catch (err: any) {
      const detail = err?.message ?? String(err) ?? 'Unknown error';
      showAlert({ type: 'error', title: 'Import Failed', message: detail });
    }
  };

  const renderItem = ({ item }: { item: ApiProduct }) => {
    const price =
      item.pricingMode === 'FIXED' && item.fixedPriceCents
        ? `$${(parseInt(item.fixedPriceCents, 10) / 100).toFixed(2)}`
        : 'RFQ';
    const lastCostCents = lastCostMap[String(item.id)] ?? null;
    const costLabel = lastCostCents != null ? `Cost: $${Number(lastCostCents).toFixed(4)}` : null;
    const catName = categories.find(c => c.id === item.categoryId)?.nameEn ?? null;
    const vendorObj = item.vendorId ? vendors.find(v => v.id === Number(item.vendorId)) : null;
    const vendorName =
      item.vendor?.name ??
      (vendorObj ? vendorObj.nameEn || vendorObj.nameKm || vendorObj.code : null);
    const stock = stockDetail[item.id];
    const productLocs = locationsMap[item.id] ?? item.locations ?? [];
    const isRFQ = item.pricingMode === 'RFQ';

    return (
      <TouchableOpacity style={styles.card} onPress={() => onEdit(item)} activeOpacity={0.82}>
        {/* Thumbnail */}
        <View style={styles.imageWrap}>
          {item.primaryImageUrl ? (
            <Image source={{ uri: `${item.primaryImageUrl}?t=${imageCacheBuster}` }} style={styles.image} resizeMode="cover" />
          ) : (
            <View style={styles.imagePlaceholder}>
              <Icon name="inventory-2" size={26} color="#CBD5E1" />
            </View>
          )}
          <View style={[styles.activeDot, item.active ? styles.activeDotOn : styles.activeDotOff]} />
        </View>

        {/* Info */}
        <View style={styles.cardBody}>
          {/* Name row */}
          <View style={styles.cardTop}>
            <View style={styles.nameBlock}>
              {item.nameKm ? (
                <AppText style={styles.productNameKm} numberOfLines={1}>{item.nameKm}</AppText>
              ) : null}
              {item.nameEn ? (
                <AppText style={styles.productName} numberOfLines={1}>{item.nameEn}</AppText>
              ) : null}
            </View>
            {isRFQ && (
              <View style={styles.rfqTag}>
                <AppText style={styles.rfqTagText}>RFQ</AppText>
              </View>
            )}
          </View>

          {/* SKU + Size + Bins */}
          <View style={styles.skuRow}>
            {item.sku ? (
              <View style={styles.skuChip}>
                <AppText style={styles.skuText} numberOfLines={1}>{item.sku}</AppText>
              </View>
            ) : null}
            {item.size ? (
              <View style={styles.sizeChip}>
                <AppText style={styles.sizeText} numberOfLines={1}>Size: {item.size}</AppText>
              </View>
            ) : null}
          </View>
          {productLocs.length > 0 ? (
            <View style={styles.binsRow}>
              {Object.entries(
                productLocs.reduce<Record<string, string[]>>((acc, pl) => {
                  const key = pl.locationCode;
                  if (!acc[key]) acc[key] = [];
                  if (pl.storeBin) acc[key].push(pl.storeBin);
                  return acc;
                }, {})
              ).map(([code, bins]) => (
                <View key={code} style={styles.locationPill}>
                  <Icon name="place" size={9} color="#059669" />
                  <AppText style={styles.locationText} numberOfLines={1}>
                    {code}{bins.length > 0 ? ` · ${bins.join(', ')}` : ''}
                  </AppText>
                </View>
              ))}
            </View>
          ) : null}

          {/* Category + Vendor */}
          <View style={styles.metaRow}>
            {catName ? (
              <View style={styles.catRow}>
                <Icon name="category" size={10} color="#7C3AED" />
                <AppText style={styles.catText} numberOfLines={1}>{catName}</AppText>
              </View>
            ) : null}
            {vendorName ? (
              <View style={styles.vendorRow}>
                <Icon name="storefront" size={10} color="#64748B" />
                <AppText style={styles.vendorText} numberOfLines={1}>{vendorName}</AppText>
              </View>
            ) : null}
          </View>

          {/* Price + Stock */}
          <View style={styles.cardFooter}>
            <View>
              <AppText style={[styles.price, isRFQ && styles.priceRFQ]}>{price}</AppText>
              {costLabel != null && <AppText style={styles.costLabel}>{costLabel}</AppText>}
            </View>
            <View style={[styles.qtyPill, (item.qtyOnHand ?? 0) < 0 && { backgroundColor: '#FEE2E2' }]}>
              <Icon name="inventory" size={10} color={(item.qtyOnHand ?? 0) < 0 ? '#EF4444' : '#2563EB'} />
              <AppText style={[styles.qtyText, (item.qtyOnHand ?? 0) < 0 && { color: '#EF4444' }]}>
                {item.qtyOnHand ?? 0}
              </AppText>
            </View>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  const subtitle = searchQuery
    ? `${filteredProducts.length} of ${products.length} items`
    : selectedCategoryId !== null
    ? `${filteredProducts.length} of ${products.length} items`
    : products.length > 0
    ? `${products.length} items`
    : 'Product catalog';

  return (
    <View style={styles.safe}>
      <AppBar
        title="Products"
        subtitle={subtitle}
        titleAlign="left"
        showBack
        onBack={onBack}
      />

      <View style={styles.toolbarRow}>
        <TouchableOpacity style={[styles.toolbarBtn, styles.toolbarBtnTemplate]} onPress={handleTemplate}>
          <Icon name="article" size={15} color="#7C3AED" />
          <AppText style={[styles.toolbarBtnText, { color: '#7C3AED' }]}>Template</AppText>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.toolbarBtn, styles.toolbarBtnImport]} onPress={handleImport} disabled={importing}>
          {importing
            ? <ActivityIndicator size="small" color={Colors.primary} />
            : <Icon name="upload-file" size={15} color={Colors.primary} />}
          <AppText style={[styles.toolbarBtnText, { color: Colors.primary }]}>
            {importing ? 'Importing…' : 'Import'}
          </AppText>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.toolbarBtn, styles.toolbarBtnExport]} onPress={handleExport} disabled={exporting}>
          {exporting
            ? <ActivityIndicator size="small" color={Colors.white} />
            : <Icon name="download" size={15} color={Colors.white} />}
          <AppText style={[styles.toolbarBtnText, { color: Colors.white }]}>
            {exporting ? 'Exporting…' : `Export (${products.length})`}
          </AppText>
        </TouchableOpacity>
      </View>

      {/* Search Bar */}
      <View style={styles.searchRow}>
        <Icon name="search" size={20} color={Colors.textSecondary} style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search by name or SKU..."
          placeholderTextColor={Colors.textLight}
          value={searchQuery}
          onChangeText={setSearchQuery}
          returnKeyType="search"
          clearButtonMode="while-editing"
        />
        {searchQuery ? (
          <TouchableOpacity onPress={() => setSearchQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Icon name="close" size={18} color={Colors.textSecondary} />
          </TouchableOpacity>
        ) : (
          <TouchableOpacity onPress={openScanner} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Icon name="qr-code-scanner" size={20} color={Colors.primary} />
          </TouchableOpacity>
        )}
      </View>

      {/* Summary Bar */}
      <View style={styles.summaryBar}>
        <View style={styles.summaryItem}>
          <AppText style={styles.summaryLabel}>Total Cost</AppText>
          <AppText style={styles.summaryCostValue}>${(totalCost / 100).toFixed(2)}</AppText>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryItem}>
          <AppText style={styles.summaryLabel}>Total Sale</AppText>
          <AppText style={styles.summarySaleValue}>${(totalSale / 100).toFixed(2)}</AppText>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryItem}>
          <AppText style={styles.summaryLabel}>Working</AppText>
          <AppText style={styles.summaryOnHandValue}>{totalWorking.toLocaleString()}</AppText>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryItem}>
          <AppText style={styles.summaryLabel}>Products</AppText>
          <AppText style={styles.summaryCountValue}>{filteredProducts.length}</AppText>
        </View>
      </View>

      <View style={styles.body}>
        {/* ── Category sidebar ── */}
        <View style={styles.sidebar}>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.sidebarContent}>
            {/* All */}
            <TouchableOpacity
              style={[styles.sidebarItem, selectedCategoryId === null && styles.sidebarItemActive]}
              onPress={() => setSelectedCategoryId(null)}
              activeOpacity={0.7}
            >
              <View style={[styles.sidebarIconBox, selectedCategoryId === null && { backgroundColor: Colors.primary }]}>
                <Icon
                  name="apps"
                  size={20}
                  color={selectedCategoryId === null ? Colors.white : Colors.primary}
                />
              </View>
              <AppText
                style={selectedCategoryId === null ? [styles.sidebarText, styles.sidebarTextActive] : styles.sidebarText}
                numberOfLines={1}
              >
                All
              </AppText>
              {selectedCategoryId === null && <View style={styles.sidebarIndicator} />}
            </TouchableOpacity>

            {/* Category rows (only categories that have products) */}
            {sidebarCategories.map((c, index) => {
              const isActive = selectedCategoryId === c.id;
              const label = c.nameEn || c.nameKm;
              const icon = CATEGORY_ICONS[index % CATEGORY_ICONS.length];
              const color = CATEGORY_COLORS[index % CATEGORY_COLORS.length];
              return (
                <TouchableOpacity
                  key={c.id}
                  style={[styles.sidebarItem, isActive && styles.sidebarItemActive]}
                  onPress={() => setSelectedCategoryId(c.id)}
                  activeOpacity={0.7}
                >
                  <View style={[styles.sidebarIconBox, isActive && { backgroundColor: color }]}>
                    <Icon
                      name={icon}
                      size={20}
                      color={isActive ? Colors.white : color}
                    />
                  </View>
                  <AppText
                    style={isActive ? [styles.sidebarText, styles.sidebarTextActive] : styles.sidebarText}
                    numberOfLines={2}
                  >
                    {label}
                  </AppText>
                  {isActive && <View style={styles.sidebarIndicator} />}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>

        {/* ── Product list ── */}
        <View style={styles.listPane}>
          {loading ? (
            <View style={styles.center}>
              <ActivityIndicator size="large" color={Colors.primary} />
            </View>
          ) : error ? (
            <View style={styles.center}>
              <Icon name="error-outline" size={48} color={Colors.textLight} />
              <AppText variant="body" color="textSecondary" style={styles.errorMsg}>{error}</AppText>
              <TouchableOpacity style={styles.retryBtn} onPress={() => load()}>
                <AppText variant="bodyMedium" color="primary">Retry</AppText>
              </TouchableOpacity>
            </View>
          ) : (
            <FlatList
              data={displayedProducts}
              keyExtractor={item => item.id}
              renderItem={renderItem}
              numColumns={3}
              columnWrapperStyle={styles.columnWrapper}
              contentContainerStyle={styles.list}
              showsVerticalScrollIndicator={false}
              onEndReached={handleEndReached}
              onEndReachedThreshold={0.3}
              ListFooterComponent={renderListFooter}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
              ListEmptyComponent={
                <View style={styles.center}>
                  <Icon name={searchQuery ? 'search-off' : 'inventory-2'} size={48} color={Colors.textLight} />
                  <AppText variant="body" color="textSecondary" style={styles.errorMsg}>
                    {searchQuery
                      ? `No products match "${searchQuery}"`
                      : selectedCategoryId !== null
                      ? 'No products in this category'
                      : 'No products yet'}
                  </AppText>
                </View>
              }
            />
          )}
        </View>
      </View>

      {/* FAB */}
      <TouchableOpacity style={styles.fab} onPress={onCreate} activeOpacity={0.85}>
        <Icon name="add" size={28} color={Colors.white} />
      </TouchableOpacity>

      {/* Barcode scanner modal */}
      <Modal visible={showScanner} animationType="slide" onRequestClose={() => setShowScanner(false)}>
        <View style={styles.scannerRoot}>
          <CameraView
            style={styles.scannerCamera}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr', 'ean13', 'ean8', 'code128', 'code39', 'upc_a', 'upc_e', 'aztec', 'pdf417', 'datamatrix'] }}
            onBarcodeScanned={handleBarcodeScan}
          />
          <View style={styles.scannerOverlay}>
            <View style={styles.scannerFrame} />
            <AppText style={styles.scannerHint}>Point at a product barcode or QR code</AppText>
          </View>
          <TouchableOpacity style={styles.scannerClose} onPress={() => setShowScanner(false)}>
            <Icon name="close" size={28} color="#fff" />
          </TouchableOpacity>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  summaryBar: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
  },
  summaryItem: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
    gap: 2,
  },
  summaryDivider: {
    width: 1,
    backgroundColor: Colors.border,
    marginVertical: 8,
  },
  summaryLabel: {
    fontSize: 10,
    color: Colors.textSecondary,
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  summaryCostValue: {
    fontSize: 13,
    fontWeight: '800',
    color: '#EF4444',
  },
  summarySaleValue: {
    fontSize: 13,
    fontWeight: '800',
    color: '#10B981',
  },
  summaryOnHandValue: {
    fontSize: 13,
    fontWeight: '800',
    color: '#F59E0B',
  },
  summaryCountValue: {
    fontSize: 13,
    fontWeight: '800',
    color: Colors.primary,
  },
  // Two-column layout
  body: {
    flex: 1,
    flexDirection: 'row',
  },
  sidebar: {
    width: '15%',
    backgroundColor: Colors.surface,
    borderRightWidth: 1,
    borderRightColor: Colors.divider,
  },
  sidebarContent: {
    paddingVertical: 8,
  },
  sidebarItem: {
    paddingVertical: 12,
    paddingHorizontal: 8,
    alignItems: 'center',
    position: 'relative',
  },
  sidebarItemActive: {
    backgroundColor: Colors.primaryMuted,
  },
  sidebarIconBox: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.background,
    marginBottom: 6,
  },
  sidebarText: {
    fontSize: 11,
    color: Colors.textSecondary,
    fontWeight: '500',
    textAlign: 'center',
    lineHeight: 15,
  },
  sidebarTextActive: {
    color: Colors.primary,
    fontWeight: '700',
  },
  sidebarIndicator: {
    position: 'absolute',
    right: 0,
    top: 12,
    bottom: 12,
    width: 3,
    borderRadius: 2,
    backgroundColor: Colors.primary,
  },
  listPane: {
    flex: 1,
  },
  // Search
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
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: Colors.text,
    paddingVertical: 0,
  },
  toolbarRow: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  toolbarBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 9,
    borderRadius: 10,
  },
  toolbarBtnTemplate: {
    borderWidth: 1.5,
    borderColor: '#7C3AED',
    backgroundColor: '#F5F3FF',
  },
  toolbarBtnImport: {
    borderWidth: 1.5,
    borderColor: Colors.primary,
    backgroundColor: Colors.primaryMuted,
  },
  toolbarBtnExport: {
    backgroundColor: Colors.primary,
  },
  toolbarBtnText: {
    fontSize: 13,
    fontWeight: '700',
  },
  // Grid list
  list: {
    padding: 10,
    paddingBottom: 100,
    gap: 10,
  },
  columnWrapper: {
    gap: 10,
  },
  // Card — vertical grid
  card: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 6,
    elevation: 2,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  imageWrap: {
    width: '100%',
    aspectRatio: 1,
    backgroundColor: '#F1F5F9',
    position: 'relative',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  imagePlaceholder: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F8FAFC',
  },
  activeDot: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 9,
    height: 9,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: Colors.surface,
  },
  activeDotOn: { backgroundColor: '#22C55E' },
  activeDotOff: { backgroundColor: '#94A3B8' },
  rfqTag: {
    backgroundColor: '#FEF3C7',
    borderRadius: 5,
    paddingHorizontal: 6,
    paddingVertical: 2,
    alignSelf: 'flex-start',
  },
  rfqTagText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#D97706',
    letterSpacing: 0.5,
  },
  cardBody: {
    padding: 8,
    gap: 3,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 4,
  },
  nameBlock: {
    flex: 1,
    gap: 1,
  },
  productNameKm: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.text,
    lineHeight: 16,
    paddingTop: 6,
    paddingBottom: 6,
  },
  productName: {
    fontSize: 11,
    fontWeight: '500',
    color: Colors.textSecondary,
    lineHeight: 15,
  },
  skuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  skuChip: {
    backgroundColor: Colors.primaryLight,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: `${Colors.primary}40`,
  },
  skuText: {
    fontSize: 11,
    color: Colors.primary,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  sizeChip: {
    backgroundColor: '#F1F5F9',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  sizeText: {
    fontSize: 11,
    color: '#475569',
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  binsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
  locationPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: '#D1FAE5',
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  locationText: {
    fontSize: 9,
    color: '#059669',
    fontWeight: '600',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  vendorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  vendorText: {
    fontSize: 10,
    color: '#64748B',
    fontWeight: '500',
  },
  catRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  catText: {
    fontSize: 10,
    color: '#7C3AED',
    fontWeight: '600',
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 2,
  },
  price: {
    fontSize: 14,
    fontWeight: '800',
    color: Colors.primary,
  },
  priceRFQ: {
    fontSize: 12,
    color: '#F59E0B',
  },
  costLabel: {
    fontSize: 10,
    color: '#6B7280',
    marginTop: 1,
  },
  stockRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  stockPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: '#F1F5F9',
    borderRadius: 5,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  stockPillText: {
    fontSize: 10,
    fontWeight: '700',
  },
  stockMinus: {
    fontSize: 10,
    color: Colors.textSecondary,
    fontWeight: '700',
  },
  stockEquals: {
    fontSize: 10,
    color: Colors.textSecondary,
    fontWeight: '700',
  },
  qtyPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#DBEAFE',
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  qtyText: {
    fontSize: 11,
    color: '#2563EB',
    fontWeight: '700',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 12,
  },
  errorMsg: {
    textAlign: 'center',
  },
  retryBtn: {
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: Colors.primary,
  },
  fab: {
    position: 'absolute',
    bottom: 28,
    right: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
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

  scannerRoot:   { flex: 1, backgroundColor: '#000' },
  scannerCamera: { flex: 1 },
  scannerOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center', justifyContent: 'center',
  },
  scannerFrame: {
    width: 260, height: 260, borderRadius: 16,
    borderWidth: 3, borderColor: '#fff',
  },
  scannerHint: {
    marginTop: 24, color: '#fff', fontSize: 14, fontWeight: '600',
    textAlign: 'center', textShadowColor: 'rgba(0,0,0,0.8)', textShadowRadius: 4,
  },
  scannerClose: {
    position: 'absolute', top: 52, right: 20,
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center', justifyContent: 'center',
  },
});

export default ProductsListScreen;
