import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  TextInput,
  Modal,
  Alert,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import XLSX from 'xlsx';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { MaterialIcons as Icon } from '@expo/vector-icons';
import Colors from '../../theme/colors';
import AppText from '../../components/AppText';
import AppBar from '../../components/AppBar';
import DatePickerModal from '../../components/DatePickerModal';
import { useAlert } from '../../components/AppAlert';
import { COMPANY_INFO } from '../../utils/rentalInvoiceHtml';
import {
  getStockItemListApi,
  getStockReceivedBySkuApi,
  getInvoiceDetailsTotalOnhandApi,
  getVendorsApi,
  getLocationsApi,
  getUomsApi,
  getAllProductsApi,
  ApiStockMovementItem,
  ApiVendor,
  ApiLocation,
  ApiUom,
  ApiProduct,
} from '../../services/focusApi';

interface Props {
  onBack: () => void;
}

// Enriched item: stock fields + product master fields
type EnrichedItem = ApiStockMovementItem & {
  vendorName: string;
  locationName: string;
  categoryName: string;
  size: string | null;
  priceCents: number;
  costCents: number;
  lastCostCents: number | null;
  uomName: string;
  isRental: boolean;
};

const ITEM_COLORS = [
  '#2563EB', '#7C3AED', '#10B981', '#F59E0B',
  '#EF4444', '#06B6D4', '#F97316', '#EC4899',
];

const toISO   = (d: Date) => d.toISOString().slice(0, 10);
const fmtDate = (d: Date) =>
  d.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
const fmtUSD  = (cents: number) =>
  cents > 0 ? `$${(cents / 100).toFixed(2)}` : '';
const startOfYear = () => new Date(new Date().getFullYear(), 0, 1);

const MovementItemsScreen: React.FC<Props> = ({ onBack }) => {
  const { showAlert } = useAlert();

  // ── Data ─────────────────────────────────────────────────────────────────────
  const [items, setItems]           = useState<EnrichedItem[]>([]);
  const [loaded, setLoaded]         = useState(false);
  const [loading, setLoading]       = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError]           = useState<string | null>(null);

  // ── Reference data ────────────────────────────────────────────────────────────
  const [vendors,   setVendors]   = useState<ApiVendor[]>([]);
  const [locations, setLocations] = useState<ApiLocation[]>([]);
  const [uoms,      setUoms]      = useState<ApiUom[]>([]);

  const [vendorsLoading,   setVendorsLoading]   = useState(false);
  const [locationsLoading, setLocationsLoading] = useState(false);

  // Products cached after first load (may be large)
  const productsCacheRef  = useRef<Map<number, ApiProduct>>(new Map());
  const productsLoadedRef = useRef(false);

  // ── Filter inputs ─────────────────────────────────────────────────────────────
  const [skuInput,    setSkuInput]    = useState('');
  const [selVendor,   setSelVendor]   = useState<ApiVendor | null>(null);
  const [selLocation, setSelLocation] = useState<ApiLocation | null>(null);
  const [fromDate,    setFromDate]    = useState<Date>(startOfYear());
  const [toDate,      setToDate]      = useState<Date>(new Date());

  // ── Picker UI ─────────────────────────────────────────────────────────────────
  const [vendorSearch,   setVendorSearch]   = useState('');
  const [locationSearch, setLocationSearch] = useState('');
  const [showVendorModal, setShowVendorModal] = useState(false);
  const [showLocModal,    setShowLocModal]    = useState(false);
  const [datePicker, setDatePicker] = useState<'from' | 'to' | null>(null);

  // ── Barcode scanner ───────────────────────────────────────────────────────────
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
    setSkuInput(data.trim());
    setTimeout(() => { scanCooldown.current = false; }, 1500);
  };

  // ── Load reference data on mount ──────────────────────────────────────────────
  useEffect(() => {
    setVendorsLoading(true);
    setLocationsLoading(true);
    Promise.all([
      getVendorsApi(),
      getLocationsApi(),
      getUomsApi(),
    ])
      .then(([v, l, u]) => {
        setVendors(v);   setVendorsLoading(false);
        setLocations(l); setLocationsLoading(false);
        setUoms(u);
      })
      .catch(() => { setVendorsLoading(false); setLocationsLoading(false); });
  }, []);

  // ── Lookup maps ───────────────────────────────────────────────────────────────
  const vendorMap   = useMemo(() => new Map(vendors.map(v => [v.id, v.nameEn ?? v.nameKm ?? ''])), [vendors]);
  const locationMap = useMemo(() => new Map(locations.map(l => [Number(l.id), l.nameEn ?? (l as any).nameKm ?? l.code ?? ''])), [locations]);
  const uomMap      = useMemo(() => new Map(uoms.map(u => [u.id, u.nameEn ?? u.code ?? ''])), [uoms]);

  // ── Fetch & enrich ────────────────────────────────────────────────────────────
  const doFilter = useCallback((silent = false) => {
    if (!silent) setLoading(true);
    setError(null);

    const filterParams = {
      sku:        skuInput.trim() || undefined,
      vendorId:   selVendor   ? Number(selVendor.id)   : undefined,
      locationId: selLocation ? Number(selLocation.id) : undefined,
      from:       toISO(fromDate),
      to:         toISO(toDate),
    };

    const loadProducts = productsLoadedRef.current
      ? Promise.resolve()
      : getAllProductsApi()
          .then(prods => {
            productsCacheRef.current = new Map(prods.map(p => [Number(p.id), p]));
            productsLoadedRef.current = true;
          })
          .catch(() => {});

    Promise.all([
      getStockItemListApi({ ...filterParams, activeOnly: true }),
      getStockReceivedBySkuApi({
        sku:        filterParams.sku,
        vendorId:   filterParams.vendorId,
        locationId: filterParams.locationId,
        // no date → all-time totalRCV
      }).catch(() => []),
      getInvoiceDetailsTotalOnhandApi().catch(() => []),
      loadProducts,
    ])
      .then(([stockItems, receivedItems, onhandItems]) => {
        const rcvMap = new Map<number, { totalReceived: number; lastCostCents: number | null }>();
        for (const r of receivedItems) {
          rcvMap.set(r.productId, { totalReceived: r.totalReceived, lastCostCents: r.lastCostCents ?? null });
        }

        // authoritative on-hand: received - sold (same source as Products list)
        const onhandMap = new Map<number, number>();
        for (const o of onhandItems) {
          onhandMap.set(Number(o.productId), o.totalOnhand);
        }

        const enriched: EnrichedItem[] = stockItems.map(item => {
          const rcv  = rcvMap.get(item.id);
          const prod = productsCacheRef.current.get(item.id);

          const vendorId   = item.vendorId ?? (prod?.vendorId != null ? Number(prod.vendorId) : null);
          const locationId = item.locationId ?? null;

          return {
            ...item,
            totalReceived: rcv?.totalReceived ?? item.totalReceived,
            totalOnHand:   onhandMap.has(item.id) ? onhandMap.get(item.id)! : item.qtyOnHand,
            // category comes directly from the API response
            categoryNameEn: item.categoryNameEn ?? rcv?.categoryNameEn ?? null,
            categoryNameKm: item.categoryNameKm ?? rcv?.categoryNameKm ?? null,
            vendorName:    vendorId != null ? (vendorMap.get(vendorId) ?? '') : '',
            locationName:  locationId != null ? (locationMap.get(locationId) ?? '') : '',
            categoryName:  item.categoryNameEn ?? item.categoryNameKm ?? '',
            size:          prod?.size ?? null,
            priceCents:    Number(prod?.fixedPriceCents ?? item.fixedPriceCents ?? 0),
            costCents:     Number(prod?.costPriceCents ?? 0),
            lastCostCents: item.lastCostCents ?? rcv?.lastCostCents ?? null,
            uomName:       prod?.uomId != null ? (uomMap.get(Number(prod.uomId)) ?? prod.unit ?? '') : (prod?.unit ?? ''),
            isRental:      prod?.isRentalItem ?? false,
          };
        });

        setItems(enriched);
        setLoaded(true);
      })
      .catch(err => setError(err?.message ?? 'Failed to load'))
      .finally(() => { setLoading(false); setRefreshing(false); });
  }, [fromDate, toDate, skuInput, selVendor, selLocation, vendorMap, locationMap, uomMap]);

  const onRefresh = () => { setRefreshing(true); doFilter(true); };

  // ── Totals ────────────────────────────────────────────────────────────────────
  const totalOnHand   = useMemo(() => items.reduce((s, i) => s + i.totalOnHand,   0), [items]);
  const totalReceived = useMemo(() => items.reduce((s, i) => s + i.totalReceived,  0), [items]);
  const totalCost     = useMemo(() => items.reduce((s, i) => { const c = i.lastCostCents != null ? i.lastCostCents : i.costCents / 100; return s + c * Math.max(0, i.totalOnHand); }, 0), [items]);
  const totalPrice    = useMemo(() => items.reduce((s, i) => s + i.priceCents * i.totalOnHand, 0), [items]);

  // ── Excel export ──────────────────────────────────────────────────────────────
  const [exportLoading, setExportLoading] = useState(false);

  const handleExport = useCallback(async () => {
    if (items.length === 0) return;
    setExportLoading(true);
    try {
      const dateRange  = `${fmtDate(fromDate)} → ${fmtDate(toDate)}`;
      const filterNote = [
        skuInput.trim()  ? `SKU: ${skuInput.trim()}`                              : null,
        selVendor        ? `Vendor: ${selVendor.nameEn ?? selVendor.nameKm ?? ''}` : null,
        selLocation      ? `Location: ${selLocation.nameEn ?? selLocation.code ?? ''}` : null,
      ].filter(Boolean).join('   ') || 'All Products';

      const COLS = 17;
      const merge = (r: number) => ({ s: { r, c: 0 }, e: { r, c: COLS - 1 } });

      const HEADERS = [
        '#', 'SKU', 'Name EN', 'Name KH', 'Vendor', 'Size', 'Category',
        'Location', 'Price ($)', 'Cost ($)', 'Last Cost ($)', 'UOM', 'Active', 'isRental',
        'Adj', 'On Hand', 'Total RCV',
      ];

      const blank: string[] = Array(COLS).fill('');

      const aoa: (string | number)[][] = [
        // ── Company header ──────────────────────────────────────────────────────
        [COMPANY_INFO.name,                                                          ...Array(COLS - 1).fill('')],
        [`${COMPANY_INFO.addr1}, ${COMPANY_INFO.addr2}`,                            ...Array(COLS - 1).fill('')],
        [`Tel: ${COMPANY_INFO.phone}   Email: ${COMPANY_INFO.email}`,               ...Array(COLS - 1).fill('')],
        blank,
        // ── Report info ─────────────────────────────────────────────────────────
        ['Stock Movement Report',                                                    ...Array(COLS - 1).fill('')],
        [`Period: ${dateRange}`,                                                     ...Array(COLS - 1).fill('')],
        [`Filter: ${filterNote}`,                                                    ...Array(COLS - 1).fill('')],
        [`Exported: ${fmtDate(new Date())}`,                                        ...Array(COLS - 1).fill('')],
        blank,
        // ── Table header ────────────────────────────────────────────────────────
        HEADERS,
        // ── Data rows ───────────────────────────────────────────────────────────
        ...items.map((item, i) => [
          i + 1,
          item.sku,
          item.nameEn ?? '',
          item.nameKm ?? '',
          item.vendorName,
          item.size ?? '',
          item.categoryName,
          item.locationName,
          item.priceCents > 0 ? +(item.priceCents / 100).toFixed(2) : '',
          (() => { const c = item.lastCostCents != null ? item.lastCostCents : (item.costCents > 0 ? item.costCents / 100 : null); return c != null && c > 0 ? +Number(c).toFixed(2) : ''; })(),
          item.lastCostCents != null ? +Number(item.lastCostCents).toFixed(2) : '',
          item.uomName,
          item.active    ? 'Yes' : 'No',
          item.isRental  ? 'Yes' : 'No',
          item.qtyStart,
          item.totalOnHand,
          item.totalReceived,
        ]),
        // ── Totals ──────────────────────────────────────────────────────────────
        ['TOTAL', '', '', '', '', '', '', '', '', '', '', '', '',
          '', totalOnHand, totalReceived],
      ];

      const ws = XLSX.utils.aoa_to_sheet(aoa);

      ws['!merges'] = [
        merge(0), merge(1), merge(2),
        merge(4), merge(5), merge(6), merge(7),
      ];

      ws['!cols'] = [
        { wch: 4 },  // #
        { wch: 13 }, // SKU
        { wch: 26 }, // Name EN
        { wch: 26 }, // Name KH
        { wch: 22 }, // Vendor
        { wch: 8 },  // Size
        { wch: 18 }, // Category
        { wch: 18 }, // Location
        { wch: 9 },  // Price
        { wch: 9 },  // Cost
        { wch: 12 }, // Last Cost
        { wch: 8 },  // UOM
        { wch: 7 },  // Active
        { wch: 8 },  // isRental
        { wch: 7 },  // Adj
        { wch: 9 },  // On Hand
        { wch: 10 }, // Total RCV
      ];

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Movement Items');
      const wbout: string = XLSX.write(wb, { bookType: 'xlsx', type: 'base64' });

      const filename = `movement_items_${toISO(new Date())}.xlsx`;
      const path     = `${FileSystem.documentDirectory}${filename}`;
      await FileSystem.writeAsStringAsync(path, wbout, { encoding: FileSystem.EncodingType.Base64 });
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) await Sharing.shareAsync(path, { mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', dialogTitle: 'Export Movement Items' });
    } catch (err: any) {
      if (err?.message !== 'User did not share') {
        showAlert({ type: 'error', title: 'Export Failed', message: err?.message ?? 'Could not export.' });
      }
    } finally {
      setExportLoading(false);
    }
  }, [items, fromDate, toDate, skuInput, selVendor, selLocation, totalOnHand, totalReceived]);

  // ── Filtered pickers ──────────────────────────────────────────────────────────
  const filteredVendors = useMemo(() => {
    const q = vendorSearch.trim().toLowerCase();
    if (!q) return vendors;
    return vendors.filter(v =>
      (v.nameEn ?? '').toLowerCase().includes(q) ||
      (v.nameKm ?? '').toLowerCase().includes(q) ||
      (v.code ?? '').toLowerCase().includes(q),
    );
  }, [vendors, vendorSearch]);

  const filteredLocations = useMemo(() => {
    const q = locationSearch.trim().toLowerCase();
    if (!q) return locations;
    return locations.filter(l =>
      (l.nameEn ?? '').toLowerCase().includes(q) ||
      (l.nameKm ?? '').toLowerCase().includes(q) ||
      (l.code ?? '').toLowerCase().includes(q),
    );
  }, [locations, locationSearch]);

  // ── Row card ──────────────────────────────────────────────────────────────────
  const renderItem = ({ item, index }: { item: EnrichedItem; index: number }) => {
    const color       = ITEM_COLORS[index % ITEM_COLORS.length];
    const ohColor     = item.totalOnHand > 0 ? Colors.success : item.totalOnHand < 0 ? Colors.error : Colors.textSecondary;
    const price       = fmtUSD(item.priceCents);
    // prefer lastCostCents (dollars) over costCents (actual cents from product master)
    const displayCostDollars = item.lastCostCents != null ? item.lastCostCents : item.costCents / 100;
    const cost = displayCostDollars > 0 ? `$${Number(displayCostDollars).toFixed(2)}` : '';

    return (
      <View style={styles.card}>
        {/* ── Top row: index + names + stock numbers ──────────────────────── */}
        <View style={styles.cardTop}>
          <View style={[styles.indexBox, { backgroundColor: `${color}18` }]}>
            <AppText style={[styles.indexText, { color }]}>{index + 1}</AppText>
          </View>

          <View style={styles.nameBlock}>
            {item.nameKm ? (
              <AppText style={styles.nameKm} numberOfLines={1}>{item.nameKm}</AppText>
            ) : null}
            <AppText style={styles.nameEn} numberOfLines={1}>{item.nameEn ?? item.sku}</AppText>
          </View>

          <View style={styles.stockCols}>
            <View style={styles.stockCol}>
              <AppText style={styles.stockLabel}>Adj</AppText>
              <AppText style={styles.stockVal}>{item.qtyStart}</AppText>
            </View>
            <View style={styles.stockCol}>
              <AppText style={styles.stockLabel}>On Hand</AppText>
              <View style={[styles.qtyPill, item.totalOnHand < 0 && { backgroundColor: '#FEE2E2' }]}>
                <Icon name="inventory" size={10} color={item.totalOnHand < 0 ? '#EF4444' : '#2563EB'} />
                <AppText style={[styles.qtyText, item.totalOnHand < 0 && { color: '#EF4444' }]}>
                  {item.totalOnHand}
                </AppText>
              </View>
            </View>
            <View style={styles.stockCol}>
              <AppText style={styles.stockLabel}>Total RCV</AppText>
              <AppText style={[styles.stockValBig, { color: '#0891B2' }]}>{item.totalReceived}</AppText>
            </View>
          </View>
        </View>

        {/* ── Tags row: SKU, UOM, Size, Active, isRental ──────────────────── */}
        <View style={styles.tagRow}>
          <View style={styles.skuBadge}>
            <AppText style={styles.skuText}>{item.sku}</AppText>
          </View>
          {item.uomName ? (
            <View style={styles.chip}>
              <AppText style={styles.chipText}>{item.uomName}</AppText>
            </View>
          ) : null}
          {item.size ? (
            <View style={[styles.chip, { backgroundColor: '#FEF3C7' }]}>
              <AppText style={[styles.chipText, { color: '#92400E' }]}>{item.size}</AppText>
            </View>
          ) : null}
          {item.active ? (
            <View style={[styles.chip, { backgroundColor: '#D1FAE5' }]}>
              <AppText style={[styles.chipText, { color: '#065F46' }]}>Active</AppText>
            </View>
          ) : (
            <View style={[styles.chip, { backgroundColor: '#FEE2E2' }]}>
              <AppText style={[styles.chipText, { color: '#991B1B' }]}>Inactive</AppText>
            </View>
          )}
          {item.isRental ? (
            <View style={[styles.chip, { backgroundColor: '#EDE9FE' }]}>
              <AppText style={[styles.chipText, { color: '#5B21B6' }]}>Rental</AppText>
            </View>
          ) : null}
        </View>

        {/* ── Details rows ─────────────────────────────────────────────────── */}
        <View style={styles.detailsGrid}>
          {item.vendorName ? (
            <View style={styles.detailItem}>
              <Icon name="store" size={11} color={Colors.textSecondary} />
              <AppText style={styles.detailText} numberOfLines={1}>{item.vendorName}</AppText>
            </View>
          ) : null}
          {item.locationName ? (
            <View style={styles.detailItem}>
              <Icon name="place" size={11} color={Colors.textSecondary} />
              <AppText style={styles.detailText} numberOfLines={1}>{item.locationName}</AppText>
            </View>
          ) : null}
          {item.categoryName ? (
            <View style={styles.detailItem}>
              <Icon name="category" size={11} color={Colors.textSecondary} />
              <AppText style={styles.detailText} numberOfLines={1}>{item.categoryName}</AppText>
            </View>
          ) : null}
          {price ? (
            <View style={styles.detailItem}>
              <Icon name="attach-money" size={11} color={Colors.textSecondary} />
              <AppText style={styles.detailText}>Price {price}</AppText>
            </View>
          ) : null}
          {cost ? (
            <View style={styles.detailItem}>
              <Icon name="sell" size={11} color={Colors.textSecondary} />
              <AppText style={styles.detailText}>Cost {cost}</AppText>
            </View>
          ) : null}
        </View>
      </View>
    );
  };

  // ── Picker modal ──────────────────────────────────────────────────────────────
  const PickerModal = ({
    visible, title, search, onSearch, onClose, isLoading,
    data, selectedId, onSelect, onClear,
  }: {
    visible: boolean; title: string; search: string;
    onSearch: (v: string) => void; onClose: () => void;
    isLoading: boolean;
    data: { id: string | number; primary: string; secondary?: string }[];
    selectedId: string | number | null;
    onSelect: (id: string | number) => void;
    onClear: () => void;
  }) => (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={styles.sheet} onPress={() => {}}>
          <View style={styles.sheetHeader}>
            <AppText style={styles.sheetTitle}>{title}</AppText>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Icon name="close" size={22} color={Colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <View style={styles.sheetSearch}>
            <Icon name="search" size={18} color={Colors.textSecondary} />
            <TextInput
              style={styles.sheetSearchInput}
              placeholder={`Search ${title.toLowerCase()}…`}
              placeholderTextColor={Colors.textLight}
              value={search}
              onChangeText={onSearch}
              autoFocus
            />
            {search ? (
              <TouchableOpacity onPress={() => onSearch('')}>
                <Icon name="close" size={16} color={Colors.textSecondary} />
              </TouchableOpacity>
            ) : null}
          </View>

          <TouchableOpacity style={styles.sheetRow} onPress={() => { onClear(); onClose(); }}>
            <Icon name="clear" size={18} color={Colors.textSecondary} />
            <AppText style={[styles.sheetRowPrimary, { color: Colors.textSecondary }]}>All</AppText>
            {selectedId === null && <Icon name="check" size={18} color={Colors.primary} />}
          </TouchableOpacity>

          {isLoading ? (
            <View style={styles.sheetCenter}><ActivityIndicator color={Colors.primary} /></View>
          ) : (
            <FlatList
              data={data}
              keyExtractor={it => String(it.id)}
              style={{ maxHeight: 380 }}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item: it }) => {
                const isSel = String(selectedId) === String(it.id);
                return (
                  <TouchableOpacity
                    style={[styles.sheetRow, isSel && styles.sheetRowActive]}
                    onPress={() => { onSelect(it.id); onClose(); }}
                  >
                    <View style={[styles.sheetAvatar, isSel && { backgroundColor: Colors.primary }]}>
                      <AppText style={[styles.sheetAvatarText, isSel && { color: '#fff' }]}>
                        {it.primary[0]?.toUpperCase() ?? '?'}
                      </AppText>
                    </View>
                    <View style={{ flex: 1 }}>
                      <AppText style={styles.sheetRowPrimary} numberOfLines={1}>{it.primary}</AppText>
                      {it.secondary ? <AppText style={styles.sheetRowSub}>{it.secondary}</AppText> : null}
                    </View>
                    {isSel && <Icon name="check" size={18} color={Colors.primary} />}
                  </TouchableOpacity>
                );
              }}
              ListEmptyComponent={
                <View style={styles.sheetCenter}>
                  <AppText style={{ color: Colors.textSecondary, fontSize: 13 }}>No results</AppText>
                </View>
              }
            />
          )}
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );

  // ── Main render ───────────────────────────────────────────────────────────────
  return (
    <View style={styles.safe}>
      <AppBar
        title="Movement Items"
        subtitle={`${items.length} items`}
        titleAlign="left"
        showBack
        onBack={onBack}
        rightActions={
          items.length > 0 ? (
            <TouchableOpacity
              onPress={handleExport}
              disabled={exportLoading}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              {exportLoading
                ? <ActivityIndicator size="small" color="#fff" />
                : <Icon name="file-download" size={24} color="#fff" />}
            </TouchableOpacity>
          ) : undefined
        }
      />

      {/* ── Filter bar ──────────────────────────────────────────────────────── */}
      <View style={styles.filterBar}>
        <View style={styles.inputRow}>
          <TouchableOpacity onPress={openScanner} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Icon name="qr-code-scanner" size={20} color={Colors.primary} />
          </TouchableOpacity>
          <TextInput
            style={styles.textInput}
            value={skuInput}
            onChangeText={setSkuInput}
            placeholder="Enter or scan SKU…"
            placeholderTextColor={Colors.textLight}
            autoCapitalize="characters"
            returnKeyType="search"
            onSubmitEditing={() => doFilter()}
          />
          {skuInput ? (
            <TouchableOpacity onPress={() => setSkuInput('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Icon name="close" size={16} color={Colors.textSecondary} />
            </TouchableOpacity>
          ) : null}
        </View>

        <View style={styles.selectRow}>
          <TouchableOpacity style={styles.selectBtn} onPress={() => setShowVendorModal(true)} activeOpacity={0.75}>
            <Icon name="store" size={15} color={selVendor ? Colors.primary : Colors.textSecondary} />
            <AppText style={[styles.selectText, selVendor && styles.selectTextActive]} numberOfLines={1}>
              {selVendor ? (selVendor.nameEn ?? selVendor.nameKm ?? '—') : 'Select Vendor'}
            </AppText>
            {selVendor
              ? <TouchableOpacity onPress={() => setSelVendor(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Icon name="close" size={14} color={Colors.primary} />
                </TouchableOpacity>
              : <Icon name="expand-more" size={18} color={Colors.textSecondary} />}
          </TouchableOpacity>

          <TouchableOpacity style={styles.selectBtn} onPress={() => setShowLocModal(true)} activeOpacity={0.75}>
            <Icon name="place" size={15} color={selLocation ? Colors.primary : Colors.textSecondary} />
            <AppText style={[styles.selectText, selLocation && styles.selectTextActive]} numberOfLines={1}>
              {selLocation ? (selLocation.nameEn ?? selLocation.code ?? '—') : 'Select Location'}
            </AppText>
            {selLocation
              ? <TouchableOpacity onPress={() => setSelLocation(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Icon name="close" size={14} color={Colors.primary} />
                </TouchableOpacity>
              : <Icon name="expand-more" size={18} color={Colors.textSecondary} />}
          </TouchableOpacity>
        </View>

        <View style={styles.selectRow}>
          <TouchableOpacity style={styles.dateBtn} onPress={() => setDatePicker('from')} activeOpacity={0.75}>
            <Icon name="calendar-today" size={14} color={Colors.primary} />
            <AppText style={styles.dateText}>{fmtDate(fromDate)}</AppText>
          </TouchableOpacity>
          <AppText style={styles.dateSep}>→</AppText>
          <TouchableOpacity style={styles.dateBtn} onPress={() => setDatePicker('to')} activeOpacity={0.75}>
            <Icon name="calendar-today" size={14} color={Colors.primary} />
            <AppText style={styles.dateText}>{fmtDate(toDate)}</AppText>
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.filterBtn} onPress={() => doFilter()} activeOpacity={0.85} disabled={loading}>
          {loading
            ? <ActivityIndicator size="small" color="#fff" />
            : <><Icon name="search" size={18} color="#fff" /><AppText style={styles.filterBtnText}>Filter</AppText></>}
        </TouchableOpacity>
      </View>

      {/* ── Summary bar ─────────────────────────────────────────────────────── */}
      {!loading && !error && items.length > 0 && (
        <View style={styles.summaryBar}>
          {/* Row 1 */}
          <View style={styles.summaryRow}>
            <View style={styles.summaryItem}>
              <AppText style={styles.summaryLabel}>Products</AppText>
              <AppText style={styles.summaryVal}>{items.length}</AppText>
            </View>
            <View style={styles.summaryDivider} />
            <View style={styles.summaryItem}>
              <AppText style={styles.summaryLabel}>Total RCV</AppText>
              <AppText style={[styles.summaryVal, { color: '#0891B2' }]}>{totalReceived}</AppText>
            </View>
            <View style={styles.summaryDivider} />
            <View style={styles.summaryItem}>
              <AppText style={styles.summaryLabel}>On Hand</AppText>
              <AppText style={[styles.summaryVal, { color: totalOnHand < 0 ? Colors.error : Colors.primary }]}>{totalOnHand}</AppText>
            </View>
          </View>
          {/* Divider between rows */}
          <View style={{ height: 1, backgroundColor: Colors.divider, marginHorizontal: 12, marginVertical: 6 }} />
          {/* Row 2 */}
          <View style={styles.summaryRow}>
            <View style={styles.summaryItem}>
              <AppText style={styles.summaryLabel}>Total Cost</AppText>
              <AppText style={[styles.summaryVal, { color: '#7C3AED', fontSize: 13 }]}>${totalCost.toFixed(2)}</AppText>
            </View>
            <View style={styles.summaryDivider} />
            <View style={styles.summaryItem}>
              <AppText style={styles.summaryLabel}>Total Price</AppText>
              <AppText style={[styles.summaryVal, { color: '#059669', fontSize: 13 }]}>${(totalPrice / 100).toFixed(2)}</AppText>
            </View>
          </View>
        </View>
      )}

      {/* ── List ────────────────────────────────────────────────────────────── */}
      {error ? (
        <View style={styles.center}>
          <Icon name="error-outline" size={48} color={Colors.textLight} />
          <AppText style={styles.centerMsg}>{error}</AppText>
          <TouchableOpacity style={styles.retryBtn} onPress={() => doFilter()}>
            <AppText style={styles.retryText}>Retry</AppText>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={item => String(item.id)}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />
          }
          ListEmptyComponent={
            !loading ? (
              <View style={styles.center}>
                <Icon name={loaded ? 'inventory' : 'search'} size={48} color={Colors.textLight} />
                <AppText style={styles.centerMsg}>
                  {loaded
                    ? 'No items found for the selected filters.'
                    : 'Set filters above and tap Filter to load stock movements.'}
                </AppText>
              </View>
            ) : null
          }
        />
      )}

      {/* ── Date pickers ────────────────────────────────────────────────────── */}
      <DatePickerModal
        visible={datePicker === 'from'}
        value={fromDate}
        maxDate={toDate}
        onChange={d => setFromDate(d)}
        onClose={() => setDatePicker(null)}
      />
      <DatePickerModal
        visible={datePicker === 'to'}
        value={toDate}
        minDate={fromDate}
        maxDate={new Date()}
        onChange={d => setToDate(d)}
        onClose={() => setDatePicker(null)}
      />

      {/* ── Vendor picker ────────────────────────────────────────────────────── */}
      <PickerModal
        visible={showVendorModal}
        title="Vendor"
        search={vendorSearch}
        onSearch={setVendorSearch}
        onClose={() => { setShowVendorModal(false); setVendorSearch(''); }}
        isLoading={vendorsLoading}
        data={filteredVendors.map(v => ({ id: v.id, primary: v.nameEn ?? v.nameKm ?? String(v.id), secondary: v.code }))}
        selectedId={selVendor?.id ?? null}
        onSelect={id => { setSelVendor(vendors.find(v => String(v.id) === String(id)) ?? null); setVendorSearch(''); }}
        onClear={() => setSelVendor(null)}
      />

      {/* ── Location picker ──────────────────────────────────────────────────── */}
      <PickerModal
        visible={showLocModal}
        title="Location"
        search={locationSearch}
        onSearch={setLocationSearch}
        onClose={() => { setShowLocModal(false); setLocationSearch(''); }}
        isLoading={locationsLoading}
        data={filteredLocations.map(l => ({ id: l.id, primary: l.nameEn ?? l.nameKm ?? l.code, secondary: l.code }))}
        selectedId={selLocation?.id ?? null}
        onSelect={id => { setSelLocation(locations.find(l => String(l.id) === String(id)) ?? null); setLocationSearch(''); }}
        onClear={() => setSelLocation(null)}
      />

      {/* ── Barcode scanner modal ────────────────────────────────────────────── */}
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
            <AppText style={styles.scannerHint}>Point at a barcode or QR code</AppText>
          </View>
          <TouchableOpacity style={styles.scannerClose} onPress={() => setShowScanner(false)}>
            <Icon name="close" size={28} color="#fff" />
          </TouchableOpacity>
        </View>
      </Modal>
    </View>
  );
};

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },

  filterBar: {
    backgroundColor: Colors.surface,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.divider,
    gap: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 3,
  },

  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: Colors.background,
    gap: 8,
  },
  textInput: { flex: 1, fontSize: 14, color: Colors.text, paddingVertical: 0 },

  selectRow: { flexDirection: 'row', gap: 8 },
  selectBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center',
    borderWidth: 1, borderColor: Colors.border, borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 10,
    backgroundColor: Colors.background, gap: 6,
  },
  selectText:       { flex: 1, fontSize: 13, color: Colors.textLight },
  selectTextActive: { color: Colors.text, fontWeight: '600' },

  dateBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6,
    borderWidth: 1, borderColor: Colors.border, borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 10, backgroundColor: Colors.background,
  },
  dateText: { fontSize: 13, color: Colors.text, fontWeight: '500' },
  dateSep:  { fontSize: 14, color: Colors.textSecondary, fontWeight: '600' },

  filterBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: Colors.primary, borderRadius: 12, paddingVertical: 13,
    shadowColor: Colors.primary, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 8, elevation: 5,
  },
  filterBtnText: { color: '#fff', fontSize: 15, fontWeight: '700', letterSpacing: 0.3 },

  summaryBar: {
    backgroundColor: Colors.surface,
    marginHorizontal: 12, marginTop: 8, marginBottom: 2,
    borderRadius: 12, paddingVertical: 10,
    borderWidth: 1, borderColor: Colors.border,
  },
  summaryRow:     { flexDirection: 'row' },
  summaryItem:    { flex: 1, alignItems: 'center', gap: 2 },
  summaryLabel:   { fontSize: 10, color: Colors.textSecondary, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4 },
  summaryVal:     { fontSize: 16, fontWeight: '700', color: Colors.text },
  summaryDivider: { width: 1, backgroundColor: Colors.divider, marginVertical: 4 },

  list: { paddingBottom: 40 },

  // ── Card row ─────────────────────────────────────────────────────────────────
  card: {
    backgroundColor: Colors.surface,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.divider,
    gap: 7,
  },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  indexBox: { width: 34, height: 34, borderRadius: 9, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  indexText: { fontSize: 12, fontWeight: '700' },
  nameBlock: { flex: 1, minWidth: 0, gap: 2 },
  nameKm:    { fontSize: 13, fontWeight: '700', color: Colors.text },
  nameEn:    { fontSize: 12, color: Colors.textSecondary },

  stockCols: { flexDirection: 'row', gap: 2 },
  stockCol:  { width: 56, alignItems: 'center', gap: 1 },
  stockLabel:  { fontSize: 8, color: Colors.textSecondary, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.3 },
  stockVal:    { fontSize: 13, fontWeight: '600', color: Colors.text },
  stockValBig: { fontSize: 15, fontWeight: '800' },
  qtyPill: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: '#DBEAFE', borderRadius: 6, paddingHorizontal: 5, paddingVertical: 2 },
  qtyText: { fontSize: 12, color: '#2563EB', fontWeight: '700' },

  // ── Tags ─────────────────────────────────────────────────────────────────────
  tagRow: { flexDirection: 'row', gap: 5, flexWrap: 'wrap' },
  skuBadge: {
    backgroundColor: Colors.primaryMuted, borderRadius: 5,
    paddingHorizontal: 6, paddingVertical: 2,
  },
  skuText: { fontSize: 10, color: Colors.primary, fontWeight: '700', letterSpacing: 0.4 },
  chip: {
    backgroundColor: `${Colors.textSecondary}18`, borderRadius: 5,
    paddingHorizontal: 6, paddingVertical: 2,
  },
  chipText: { fontSize: 10, color: Colors.textSecondary, fontWeight: '600' },

  // ── Details grid ─────────────────────────────────────────────────────────────
  detailsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 },
  detailItem:  { flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: '48%' },
  detailText:  { fontSize: 11, color: Colors.textSecondary, flex: 1 },

  // ── Empty / error ─────────────────────────────────────────────────────────────
  center:    { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12, marginTop: 20 },
  centerMsg: { color: Colors.textSecondary, fontSize: 14, textAlign: 'center' },
  retryBtn:  { paddingHorizontal: 24, paddingVertical: 10, borderRadius: 8, borderWidth: 1.5, borderColor: Colors.primary },
  retryText: { color: Colors.primary, fontWeight: '600', fontSize: 14 },

  // ── Picker modal ──────────────────────────────────────────────────────────────
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: Colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingTop: 16, paddingBottom: 36, maxHeight: '72%',
  },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, marginBottom: 10 },
  sheetTitle:  { fontSize: 16, fontWeight: '700', color: Colors.text },
  sheetSearch: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.background,
    borderRadius: 10, marginHorizontal: 12, marginBottom: 6,
    paddingHorizontal: 10, paddingVertical: 8,
    borderWidth: 1, borderColor: Colors.border, gap: 8,
  },
  sheetSearchInput: { flex: 1, fontSize: 14, color: Colors.text, paddingVertical: 0 },
  sheetRow:      { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: Colors.divider, gap: 12 },
  sheetRowActive: { backgroundColor: Colors.primaryMuted },
  sheetAvatar:    { width: 36, height: 36, borderRadius: 18, backgroundColor: `${Colors.primary}22`, alignItems: 'center', justifyContent: 'center' },
  sheetAvatarText: { color: Colors.primary, fontWeight: '700', fontSize: 14 },
  sheetRowPrimary: { fontSize: 14, fontWeight: '600', color: Colors.text },
  sheetRowSub:     { fontSize: 11, color: Colors.textSecondary, marginTop: 1 },
  sheetCenter:     { padding: 24, alignItems: 'center' },

  // ── Barcode scanner ───────────────────────────────────────────────────────────
  scannerRoot:   { flex: 1, backgroundColor: '#000' },
  scannerCamera: { flex: 1 },
  scannerOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center', justifyContent: 'center',
  },
  scannerFrame: {
    width: 260, height: 260, borderRadius: 16,
    borderWidth: 3, borderColor: '#fff',
    shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 10,
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

export default MovementItemsScreen;
