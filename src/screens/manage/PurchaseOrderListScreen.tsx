import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  TextInput,
  ScrollView,
  Modal,
  KeyboardAvoidingView,
  Platform,
  Share,
  Image,
  Alert,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { MaterialIcons as Icon } from '@expo/vector-icons';
import LottieView from 'lottie-react-native';
import SignaturePad, { SignaturePadRef } from '../../components/SignaturePad';
import * as Print from 'expo-print';
import Colors from '../../theme/colors';
import AppText from '../../components/AppText';
import AppBar from '../../components/AppBar';
import { useAlert } from '../../components/AppAlert';
import DatePickerModal from '../../components/DatePickerModal';
import LOGO_BASE64 from '../../logo/logoBase64';
import {
  getPurchaseOrdersApi,
  getPurchaseOrderApi,
  createPurchaseOrderApi,
  updatePurchaseOrderApi,
  approvePurchaseOrderApi,
  sendPurchaseOrderApi,
  receivePurchaseOrderApi,
  billPurchaseOrderApi,
  payPurchaseOrderApi,
  cancelPurchaseOrderApi,
  getAllProductsApi,
  getVendorsApi,
  getVendorApi,
  getLocationsApi,
  getCategoriesApi,
  getProductsLastCostsApi,
  getStockLastCostBySkuApi,
  getPOReceivedImagesApi,
  addPOReceivedImagesApi,
  deletePOReceivedImageApi,
  uploadDirectApi,
  createPOInvoiceHeaderApi,
  createInvoiceDetailApi,
  ApiPurchaseOrder,
  ApiPOItem,
  ApiProduct,
  ApiVendor,
  ApiLocation,
  ApiCategory,
  ApiLastCost,
  ApiPOReceivedImage,
  POStatus,
} from '../../services/focusApi';

interface Props {
  onBack: () => void;
}

const startOfYear = () => { const d = new Date(); d.setMonth(0, 1); d.setHours(0, 0, 0, 0); return d; };
const startOfMonth = () => { const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d; };
const toISO = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

type ScreenView = 'list' | 'form' | 'preview';
type TabFilter = 'ALL' | POStatus;
type ActionPanel = 'none' | 'receive' | 'bill' | 'pay' | 'cancel' | 'images';

const TABS: { key: TabFilter; label: string }[] = [
  { key: 'ALL',       label: 'All' },
  { key: 'DRAFT',     label: 'Draft' },
  { key: 'APPROVED',  label: 'Approved' },
  { key: 'SENT',      label: 'Sent' },
  { key: 'RECEIVED',  label: 'Received' },
  { key: 'BILLED',    label: 'Billed' },
  { key: 'PAID',      label: 'Paid' },
];

const STATUS: Record<string, { color: string; bg: string; label: string; icon: string }> = {
  DRAFT:     { color: '#D97706', bg: '#FEF3C7', label: 'Draft',     icon: 'edit-note' },
  APPROVED:  { color: '#2563EB', bg: '#DBEAFE', label: 'Approved',  icon: 'thumb-up' },
  SENT:      { color: '#06B6D4', bg: '#CFFAFE', label: 'Sent',      icon: 'send' },
  RECEIVED:  { color: '#10B981', bg: '#D1FAE5', label: 'Received',  icon: 'move-to-inbox' },
  BILLED:    { color: '#7C3AED', bg: '#EDE9FE', label: 'Billed',    icon: 'receipt' },
  PAID:      { color: '#059669', bg: '#A7F3D0', label: 'Paid',      icon: 'check-circle' },
  CANCELLED: { color: '#EF4444', bg: '#FEE2E2', label: 'Cancelled', icon: 'cancel' },
};

const fmtDate = (iso?: string) => {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' }); }
  catch { return iso; }
};

const daysSince = (iso?: string): number => {
  if (!iso) return 0;
  try {
    const diff = Date.now() - new Date(iso).getTime();
    return Math.floor(diff / (1000 * 60 * 60 * 24));
  } catch { return 0; }
};

const daysBadgeColor = (days: number): { bg: string; text: string } => {
  if (days <= 3)  return { bg: '#D1FAE5', text: '#059669' };
  if (days <= 7)  return { bg: '#FEF3C7', text: '#D97706' };
  if (days <= 14) return { bg: '#FEE2E2', text: '#EF4444' };
  return           { bg: '#FEE2E2', text: '#DC2626' };
};
const todayISO = () => new Date().toISOString().split('T')[0];
const fmtMoney = (cents?: number | null) =>
  cents != null ? `$${(cents / 100).toFixed(2)}` : '—';

interface DraftItem {
  productId: string;
  qty: string;
  unitPrice: string;
  discountPct: string;
  taxPct: string;
  productName?: string;
  productNameKm?: string;
  productSku?: string;
  size?: string | null;
  salePrice?: string;
  lastCostCents?: number | null;
}

interface ReceiveRow {
  poItemId: string;
  productName: string;
  totalQty: number;
  alreadyReceived: number;
  qtyReceived: string;
  unitCost: string;
}

// ─────────────────────────────────────────────────────────────────────────────

const PurchaseOrderListScreen: React.FC<Props> = ({ onBack }) => {
  const { showAlert } = useAlert();

  // ── List state ──────────────────────────────────────────────────────────────
  const [screenView, setScreenView] = useState<ScreenView>('list');
  const [pos, setPos] = useState<ApiPurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabFilter>('ALL');
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [totalCount, setTotalCount] = useState(0);
  const PAGE_SIZE = 20;

  // ── Filter bar state ─────────────────────────────────────────────────────────
  const [poNumberInput, setPoNumberInput] = useState('');
  const [filterVendor, setFilterVendor] = useState<ApiVendor | null>(null);
  const [filterVendorSearch, setFilterVendorSearch] = useState('');
  const [showFilterVendorModal, setShowFilterVendorModal] = useState(false);
  const [fromDate, setFromDate] = useState<Date>(startOfMonth());
  const [toDate, setToDate] = useState<Date>(new Date());
  const [datePicker, setDatePicker] = useState<'from' | 'to' | null>(null);
  // Applied filter params (set when Filter button is pressed)
  const [appliedFilters, setAppliedFilters] = useState<{
    poNumber?: string; vendorId?: number; from: string; to: string; status?: string;
  }>({ from: toISO(startOfMonth()), to: toISO(new Date()) });

  // ── Detail modal ────────────────────────────────────────────────────────────
  const [detailPO, setDetailPO] = useState<ApiPurchaseOrder | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [actionPanel, setActionPanel] = useState<ActionPanel>('none');
  const [actionSubmitting, setActionSubmitting] = useState(false);

  // Receive form
  const [receiveRows, setReceiveRows] = useState<ReceiveRow[]>([]);
  const [receiveNote, setReceiveNote] = useState('');

  // Bill form
  const [billIssuedAt, setBillIssuedAt] = useState(todayISO());
  const [billRateUsed, setBillRateUsed] = useState('4000');
  const [billDatePicker, setBillDatePicker] = useState(false);

  // Pay form
  const [payAmount, setPayAmount] = useState('');
  const [payPaidAt, setPayPaidAt] = useState(todayISO());
  const [payDatePicker, setPayDatePicker] = useState(false);

  // Received images
  const [receivedImages, setReceivedImages] = useState<ApiPOReceivedImage[]>([]);
  const [imagesLoading, setImagesLoading] = useState(false);
  const [addingImage, setAddingImage] = useState(false);
  const [deletingImageId, setDeletingImageId] = useState<string | null>(null);
  const [showReceivePhotoMenu, setShowReceivePhotoMenu] = useState(false);

  // ── Inline image panel (per-row in list) ────────────────────────────────────
  const [expandedPoId, setExpandedPoId] = useState<string | null>(null);
  const [expandedImages, setExpandedImages] = useState<ApiPOReceivedImage[]>([]);
  const [expandedImgLoading, setExpandedImgLoading] = useState(false);
  const [expandedPreviewUrl, setExpandedPreviewUrl] = useState<string | null>(null);

  const [payMethod, setPayMethod] = useState('CASH');
  const [payNote, setPayNote] = useState('');

  // Cancel form
  const [cancelReason, setCancelReason] = useState('');

  // Inline confirm dialog (avoids nested Modal crash on Android)
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    message?: string;
    confirmLabel?: string;
    danger?: boolean;
    onConfirm: () => void;
  } | null>(null);

  const showConfirm = useCallback((
    title: string,
    message: string,
    onConfirm: () => void,
    opts?: { confirmLabel?: string; danger?: boolean },
  ) => {
    setConfirmDialog({ title, message, onConfirm, ...opts });
  }, []);

  // ── Preview ─────────────────────────────────────────────────────────────────
  const [previewingPO, setPreviewingPO] = useState<ApiPurchaseOrder | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewVendor, setPreviewVendor] = useState<ApiVendor | null>(null);
  const [printLoading, setPrintLoading] = useState(false);

  // ── Create / Edit form ──────────────────────────────────────────────────────
  const [editingPO, setEditingPO] = useState<ApiPurchaseOrder | null>(null);
  const [selectedVendor, setSelectedVendor] = useState<ApiVendor | null>(null);
  const [selectedLocation, setSelectedLocation] = useState<ApiLocation | null>(null);
  const [poDate, setPoDate] = useState<Date>(new Date());
  const [poDraftDatePicker, setPoDraftDatePicker] = useState(false);
  const [draftItems, setDraftItems] = useState<DraftItem[]>([
    { productId: '', qty: '1', unitPrice: '0', discountPct: '', taxPct: '' },
  ]);
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [poConfirmVisible, setPoConfirmVisible] = useState(false);
  const [poConfirmPayload, setPoConfirmPayload] = useState<{ items: any[]; totalAmt: number; created_at: string } | null>(null);

  // Vendor picker
  const [vendors, setVendors] = useState<ApiVendor[]>([]);
  const [vendorsLoading, setVendorsLoading] = useState(false);
  const [vendorPickerVisible, setVendorPickerVisible] = useState(false);
  const [vendorSearch, setVendorSearch] = useState('');

  // Location picker
  const [locations, setLocations] = useState<ApiLocation[]>([]);
  const [locationsLoading, setLocationsLoading] = useState(false);
  const [locationPickerVisible, setLocationPickerVisible] = useState(false);
  const [locationSearch, setLocationSearch] = useState('');

  // Product picker
  const [products, setProducts] = useState<ApiProduct[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [pickerIdx, setPickerIdx] = useState<number | null>(null);
  const [pickerSearch, setPickerSearch] = useState('');
  const [pickerCategoryId, setPickerCategoryId] = useState<string | null>(null);
  const [categories, setCategories] = useState<ApiCategory[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(false);
  // Form-level category selector
  const [selectedCategory, setSelectedCategory] = useState<ApiCategory | null>(null);
  const [categoryPickerVisible, setCategoryPickerVisible] = useState(false);
  const [categorySearch, setCategorySearch] = useState('');
  // Last invoice costs keyed by productId
  const [lastCostMap, setLastCostMap] = useState<Record<string, ApiLastCost>>({});
  const [lastCostsLoading, setLastCostsLoading] = useState(false);

  // ── Signature ────────────────────────────────────────────────────────────────
  const sigRef = useRef<SignaturePadRef>(null);
  const [sigSaving, setSigSaving] = useState(false);
  const [sigEmpty, setSigEmpty] = useState(true);
  const formSigRef = useRef<SignaturePadRef>(null);
  const [formSigEmpty, setFormSigEmpty] = useState(true);

  // ── Load POs ────────────────────────────────────────────────────────────────
  const load = useCallback((silent = false, filters?: typeof appliedFilters) => {
    if (!silent) setLoading(true);
    setError(null);
    const f = filters ?? appliedFilters;
    getPurchaseOrdersApi({ limit: PAGE_SIZE, ...f })
      .then(({ items, nextCursor: nc, totalCount: tc }) => {
        setPos(items);
        setNextCursor(nc);
        setHasMore(nc !== null);
        setTotalCount(tc);
      })
      .catch(err => {
        setError(err?.message ?? 'Failed to load purchase orders');
      })
      .finally(() => { setLoading(false); setRefreshing(false); });
  }, [PAGE_SIZE, appliedFilters]);

  const loadMore = useCallback(() => {
    if (loadingMore || !hasMore || nextCursor == null) return;
    setLoadingMore(true);
    getPurchaseOrdersApi({ limit: PAGE_SIZE, cursor: nextCursor, ...appliedFilters })
      .then(({ items, nextCursor: nc, totalCount: tc }) => {
        setPos(prev => [...prev, ...items]);
        setNextCursor(nc);
        setHasMore(nc !== null);
        setTotalCount(tc);
      })
      .catch(() => {})
      .finally(() => setLoadingMore(false));
  }, [loadingMore, hasMore, nextCursor, PAGE_SIZE, appliedFilters]);

  useEffect(() => { load(); }, [load]);

  // ── Load vendors for picker ─────────────────────────────────────────────────
  const ensureVendors = () => {
    if (vendors.length > 0 || vendorsLoading) return;
    setVendorsLoading(true);
    getVendorsApi()
      .then(setVendors)
      .catch(() => {})
      .finally(() => setVendorsLoading(false));
  };

  // ── Load products for picker ────────────────────────────────────────────────
  const [refreshingProducts, setRefreshingProducts] = useState(false);

  const ensureProducts = () => {
    if (products.length > 0 || productsLoading) return;
    setProductsLoading(true);
    getAllProductsApi()
      .then(setProducts)
      .catch(() => {})
      .finally(() => setProductsLoading(false));
  };

  const refreshProducts = useCallback(() => {
    setRefreshingProducts(true);
    getAllProductsApi()
      .then(setProducts)
      .catch(() => {})
      .finally(() => setRefreshingProducts(false));
  }, []);

  // ── Load categories for picker filter ───────────────────────────────────────
  const ensureCategories = () => {
    if (categories.length > 0 || categoriesLoading) return;
    setCategoriesLoading(true);
    getCategoriesApi()
      .then(setCategories)
      .catch(() => {})
      .finally(() => setCategoriesLoading(false));
  };

  // ── Load bulk last-costs ─────────────────────────────────────────────────────
  const ensureLastCosts = () => {
    if (Object.keys(lastCostMap).length > 0 || lastCostsLoading) return;
    setLastCostsLoading(true);
    getProductsLastCostsApi()
      .then(items => {
        const map: Record<string, ApiLastCost> = {};
        items.forEach(lc => { map[String(lc.productId)] = lc; });
        setLastCostMap(map);
      })
      .catch(() => {})
      .finally(() => setLastCostsLoading(false));
  };

  // ── Load locations for picker ───────────────────────────────────────────────
  const ensureLocations = () => {
    if (locations.length > 0 || locationsLoading) return;
    setLocationsLoading(true);
    getLocationsApi()
      .then(setLocations)
      .catch(() => {})
      .finally(() => setLocationsLoading(false));
  };

  // Server-side filtered — pos is already the API result
  const filteredPos = pos;

  const tabCounts = useMemo(() => {
    const counts: Partial<Record<TabFilter, number>> = { ALL: totalCount || pos.length };
    pos.forEach(p => { counts[p.status] = (counts[p.status] ?? 0) + 1; });
    return counts;
  }, [pos, totalCount]);

  // ── Apply filters ────────────────────────────────────────────────────────────
  const doFilter = useCallback((statusOverride?: string) => {
    const newFilters = {
      poNumber:  poNumberInput.trim() || undefined,
      vendorId:  filterVendor ? Number(filterVendor.id) : undefined,
      from:      toISO(fromDate),
      to:        toISO(toDate),
      status:    statusOverride ?? (tab !== 'ALL' ? tab : undefined),
    };
    setAppliedFilters(newFilters);
    load(false, newFilters);
  }, [poNumberInput, filterVendor, fromDate, toDate, tab, load]);

  const filteredFilterVendors = useMemo(() => {
    const q = filterVendorSearch.trim().toLowerCase();
    if (!q) return vendors;
    return vendors.filter(v =>
      (v.nameEn ?? '').toLowerCase().includes(q) ||
      (v.nameKm ?? '').toLowerCase().includes(q) ||
      (v.code ?? '').toLowerCase().includes(q),
    );
  }, [vendors, filterVendorSearch]);

  const summary = useMemo(() => {
    let approved = 0, sent = 0, grandTotal = 0;
    for (const p of pos) {
      const amt = Number(p.totalCents ?? 0) / 100;
      grandTotal += amt;
      if (p.status === 'APPROVED') approved += amt;
      if (p.status === 'SENT')     sent     += amt;
    }
    return { approved, sent, grandTotal };
  }, [pos]);

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); } else { next.add(id); }
      return next;
    });
  };

  // ── Open PO detail ──────────────────────────────────────────────────────────
  const openDetail = async (po: ApiPurchaseOrder) => {
    sigRef.current?.clear();
    setSigEmpty(true);
    setDetailPO(po);
    setActionPanel('none');
    setReceivedImages([]);
    setDetailLoading(true);
    try {
      const full = await getPurchaseOrderApi(po.id);
      setDetailPO(full);
    } catch {}
    finally { setDetailLoading(false); }
  };

  const closeDetail = () => {
    setDetailPO(null);
    setActionPanel('none');
    resetActionForms();
    setSigEmpty(true);
    setConfirmDialog(null);
  };

  const resetActionForms = () => {
    setReceiveRows([]); setReceiveNote('');
    setBillIssuedAt(todayISO()); setBillRateUsed('4000'); setBillDatePicker(false);
    setPayAmount(''); setPayPaidAt(todayISO()); setPayDatePicker(false); setPayMethod('CASH'); setPayNote('');
    setCancelReason('');
    setReceivedImages([]);
  };

  // ── Open action panel ───────────────────────────────────────────────────────
  const openActionPanel = (panel: ActionPanel) => {
    if (panel === actionPanel) { setActionPanel('none'); return; }
    resetActionForms();
    setActionPanel(panel);
    if (panel === 'receive' && detailPO?.items) {
      setReceiveRows(detailPO.items.map(it => ({
        poItemId: it.id,
        productName: it.productNameEn ?? it.productName ?? it.productSku ?? it.productId,
        totalQty: it.qty,
        alreadyReceived: it.qtyReceived ?? 0,
        qtyReceived: String(Math.max(0, it.qty - (it.qtyReceived ?? 0))),
        unitCost: it.unitPriceCents != null ? Number(it.unitPriceCents).toFixed(4) : '0',
      })));
    }
    if (panel === 'bill') {
      setBillRateUsed(String(detailPO?.rateUsed ?? 4000));
    }
    if (panel === 'pay' && detailPO?.billTotalCents) {
      setPayAmount(String(detailPO.billTotalCents));
    }
    if (panel === 'images' && detailPO) {
      setReceivedImages([]);
      setImagesLoading(true);
      getPOReceivedImagesApi(String(detailPO.id))
        .then(setReceivedImages)
        .catch(() => {})
        .finally(() => setImagesLoading(false));
    }
  };

  // ── Inline image panel handlers ─────────────────────────────────────────────
  const toggleImagePanel = useCallback((po: ApiPurchaseOrder) => {
    const poIdStr = String(po.id);
    if (expandedPoId === poIdStr) {
      setExpandedPoId(null);
      setExpandedImages([]);
      return;
    }
    setExpandedPoId(poIdStr);
    setExpandedImages([]);
    setExpandedImgLoading(true);
    getPOReceivedImagesApi(String(po.id))
      .then(setExpandedImages)
      .catch(() => {})
      .finally(() => setExpandedImgLoading(false));
  }, [expandedPoId]);

  // ── Simple actions (approve / send) ─────────────────────────────────────────
  const doSimpleAction = (label: string, fn: () => Promise<void>) => {
    showConfirm(
      label,
      `${label} "${detailPO?.poNumber}"?`,
      async () => {
        setActionSubmitting(true);
        try {
          await fn();
          const updated = await getPurchaseOrderApi(detailPO!.id);
          setDetailPO(updated);
          setPos(prev => prev.map(p => p.id === updated.id ? updated : p));
          Alert.alert('Done', `${detailPO?.poNumber} updated.`);
        } catch (err: any) {
          const status = err?.response?.status;
          const msg =
            err?.response?.data?.error?.message ??
            err?.response?.data?.message ??
            err?.response?.data?.error ??
            err?.message ??
            'Action failed';
          Alert.alert(`Failed${status ? ` (${status})` : ''}`, String(msg));
        } finally { setActionSubmitting(false); }
      },
      { confirmLabel: label },
    );
  };

  // ── Receive goods ───────────────────────────────────────────────────────────
  const doReceive = async () => {
    const validRows = receiveRows.filter(r => Number(r.qtyReceived) > 0);
    if (!validRows.length) {
      Alert.alert('No Qty', 'Enter received quantity for at least one item.');
      return;
    }
    const po = detailPO!;
    const items = validRows.map(r => ({ poItemId: r.poItemId, qtyReceived: Number(r.qtyReceived) }));
    const totalCents = validRows.reduce((s, r) => {
      const item = detailPO?.items?.find(it => String(it.id) === String(r.poItemId));
      const qty = Number(r.qtyReceived) || 0;
      const totalQty = Number(item?.qty) || qty;
      const cost = parseFloat(r.unitCost) || 0;
      const itemDiscountDollars = Number(item?.discountCents) || 0;
      const proRataDiscountCents = totalQty > 0 ? Math.round((qty / totalQty) * itemDiscountDollars * 100) : 0;
      return s + Math.round(qty * cost * 100) - proRataDiscountCents;
    }, 0);
    const totalLabel = (totalCents / 100).toFixed(2);
    showConfirm(
      'Confirm Receive',
      `Receive goods for ${po.poNumber}?\nTotal: $${totalLabel}`,
      async () => {
        setActionSubmitting(true);
        try {
          const now = new Date();
          const issuedAt = now.toISOString().slice(0, 10);
          await receivePurchaseOrderApi(po.id, { items, note: receiveNote || undefined, receivedAt: now.toISOString() });
          try {
            const header = await createPOInvoiceHeaderApi({
              locationId: po.locationId,
              vendorId: po.vendorId,
              poId: po.id,
              issuedAt,
              totalCents,
            });
            const poItemsMap = new Map((po.items ?? []).map(it => [it.id, it]));
            for (const row of validRows) {
              const poItem = poItemsMap.get(row.poItemId);
              const unitPriceCents = parseFloat(row.unitCost) || 0;
              await createInvoiceDetailApi(String(header.id), {
                productId: poItem?.productId,
                productSku: poItem?.productSku,
                productNameEn: poItem?.productNameEn ?? poItem?.productName,
                qty: Number(row.qtyReceived),
                unitPriceCents: unitPriceCents > 0 ? unitPriceCents : 0.01,
              });
            }
          } catch {}
          const updated = await getPurchaseOrderApi(po.id);
          setDetailPO(updated);
          setPos(prev => prev.map(p => p.id === updated.id ? updated : p));
          setActionPanel('none');
          resetActionForms();
          Alert.alert('Goods Received', 'Goods received and invoice recorded.');
        } catch (err: any) {
          const respData = (err as any)?.response?.data;
          const msg =
            respData?.error?.message ??
            respData?.error?.messageKey ??
            respData?.message ??
            respData?.detail ??
            (respData ? JSON.stringify(respData) : null) ??
            err?.message ??
            'Failed to receive';
          Alert.alert(`Error ${(err as any)?.response?.status ?? ''}`, msg);
        } finally { setActionSubmitting(false); }
      },
      { confirmLabel: 'Receive' },
    );
  };

  // ── Received images ─────────────────────────────────────────────────────────
  const doPickImage = async (source: 'camera' | 'gallery' = 'gallery') => {
    setShowReceivePhotoMenu(false);
    await new Promise(r => setTimeout(r, 300));
    const res = source === 'camera'
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8, allowsMultipleSelection: true });
    if (res.canceled) return;
    if (!res.assets?.length || !detailPO) return;
    setAddingImage(true);
    try {
      const uploaded: { url: string }[] = [];
      for (const asset of res.assets) {
        if (!asset.uri) continue;
        const url = await uploadDirectApi({
          uri: asset.uri,
          type: asset.mimeType ?? 'image/jpeg',
          fileName: asset.fileName ?? `po-img-${Date.now()}.jpg`,
          purpose: 'po_received',
        });
        uploaded.push({ url });
      }
      if (!uploaded.length) return;
      const added = await addPOReceivedImagesApi(String(detailPO.id), uploaded);
      setReceivedImages(prev => [...prev, ...added]);
    } catch (err: any) {
      Alert.alert('Upload Failed', err?.message ?? 'Could not upload image');
    } finally { setAddingImage(false); }
  };

  const doDeleteImage = (img: ApiPOReceivedImage) => {
    showConfirm(
      'Remove Image',
      'Remove this image from the PO?',
      async () => {
        setDeletingImageId(img.id);
        try {
          await deletePOReceivedImageApi(String(detailPO!.id), img.id);
          setReceivedImages(prev => prev.filter(i => i.id !== img.id));
        } catch (err: any) {
          Alert.alert('Error', err?.message ?? 'Could not delete image');
        } finally { setDeletingImageId(null); }
      },
      { confirmLabel: 'Remove', danger: true },
    );
  };

  // ── Record bill ─────────────────────────────────────────────────────────────
  const submitBill = async (totalCents: number, rateUsed: number) => {
    if (!detailPO) return;
    const po = detailPO;
    setActionSubmitting(true);
    try {
      await billPurchaseOrderApi(po.id, {
        poId:     Number(po.id),
        issuedAt: billIssuedAt,
        totalCents,
        rateUsed,
      });
      setPos(prev => prev.map(p => p.id === po.id ? { ...p, status: 'BILLED' as POStatus } : p));
      closeDetail();
      load(true);
      showAlert({ type: 'success', title: 'Bill Recorded', message: `Bill created for ${po.poNumber}.`, autoClose: 2500 });
    } catch (err: any) {
      Alert.alert('Bill Failed', err?.message ?? 'Failed to record bill');
    } finally { setActionSubmitting(false); }
  };

  const doBill = () => {
    if (!billIssuedAt) { Alert.alert('Required', 'Enter issued date.'); return; }
    const totalCents = detailPO?.totalCents ?? 0;
    if (!totalCents) { Alert.alert('Required', 'PO has no total amount.'); return; }
    const rateUsed = Number(billRateUsed) || 4000;
    showConfirm(
      'Confirm Bill',
      `Record bill for ${detailPO?.poNumber}?\nTotal: $${(Number(totalCents) / 100).toFixed(2)} · Rate: ${rateUsed}`,
      () => submitBill(totalCents, rateUsed),
      { confirmLabel: 'Confirm' },
    );
  };

  // ── Record payment ──────────────────────────────────────────────────────────
  const submitPay = async (po: ApiPurchaseOrder, amountCents: number, paidAt: string, method: string, note: string) => {
    setActionSubmitting(true);
    try {
      await payPurchaseOrderApi(po.id, { amountCents, paidAt, method, note: note || undefined });
      setPos(prev => prev.map(p => p.id === po.id ? { ...p, status: 'PAID' as POStatus } : p));
      closeDetail();
      load(true);
      showAlert({ type: 'success', title: 'Payment Recorded', message: `${po.poNumber} marked as PAID.`, autoClose: 2500 });
    } catch (err: any) {
      Alert.alert('Payment Failed', err?.message ?? 'Failed to record payment');
    } finally { setActionSubmitting(false); }
  };

  const doPay = () => {
    const po = detailPO;
    if (!po) return;
    const amountCents = Number(payAmount);
    if (!amountCents || amountCents <= 0) { Alert.alert('Required', 'Enter a valid payment amount.'); return; }
    if (!payPaidAt) { Alert.alert('Required', 'Enter payment date.'); return; }
    const paidAt = payPaidAt;
    const method = payMethod;
    const note   = payNote.trim();
    showConfirm(
      'Confirm Payment',
      `Record $${Number(amountCents).toFixed(2)} via ${method} for ${po.poNumber}?`,
      () => submitPay(po, amountCents, paidAt, method, note),
      { confirmLabel: 'Confirm' },
    );
  };

  // ── Cancel ──────────────────────────────────────────────────────────────────
  const doCancel = async () => {
    if (!detailPO) return;
    showConfirm(
      'Confirm Cancel',
      `Cancel ${detailPO.poNumber}? This cannot be undone.`,
      async () => {
        setActionSubmitting(true);
        try {
          await cancelPurchaseOrderApi(detailPO.id, cancelReason.trim() || undefined);
          const updated = await getPurchaseOrderApi(detailPO.id);
          setDetailPO(updated);
          setPos(prev => prev.map(p => p.id === updated.id ? updated : p));
          setActionPanel('none');
          resetActionForms();
          Alert.alert('PO Cancelled', `${detailPO.poNumber} has been cancelled.`);
        } catch (err: any) {
          Alert.alert('Error', err?.message ?? 'Failed to cancel');
        } finally { setActionSubmitting(false); }
      },
      { confirmLabel: 'Cancel PO', danger: true },
    );
  };

  // ── Open PO preview ─────────────────────────────────────────────────────────
  const openPreview = async (po: ApiPurchaseOrder) => {
    setPreviewingPO(po);
    setPreviewVendor(null);
    setScreenView('preview');
    setPreviewLoading(true);
    ensureProducts();
    const vendorId = po.vendorId ?? po.vendor?.id;
    try {
      const full = await getPurchaseOrderApi(po.id);
      setPreviewingPO({
        ...full,
        vendor: full.vendor ?? po.vendor,
        supplierOrg: full.supplierOrg ?? po.supplierOrg,
      });
    } catch {}
    if (vendorId) {
      try {
        const vendor = await getVendorApi(Number(vendorId));
        setPreviewVendor(vendor);
      } catch (e) {

      }
    } else {

    }
    setPreviewLoading(false);
  };

  // ── Open create form ────────────────────────────────────────────────────────
  const openCreate = () => {
    setEditingPO(null);
    setSelectedVendor(null);
    setSelectedLocation(null);
    setPoDate(new Date());
    setSelectedCategory(null);
    setDraftItems([{ productId: '', qty: '1', unitPrice: '0', discountPct: '', taxPct: '' }]);
    ensureVendors();
    ensureProducts();
    ensureCategories();
    ensureLocations();
    ensureLastCosts();
    setScreenView('form');
  };

  // ── Open edit form ──────────────────────────────────────────────────────────
  const openEdit = async (po: ApiPurchaseOrder) => {
    // Show loading indicator inside the detail modal while we fetch lists
    setDetailLoading(true);

    try {
      // Load vendor + location lists in parallel (use cache if available)
      const [vendorList, locationList] = await Promise.all([
        vendors.length > 0 ? Promise.resolve(vendors) : getVendorsApi().then(v => { setVendors(v); return v; }),
        locations.length > 0 ? Promise.resolve(locations) : getLocationsApi().then(l => { setLocations(l); return l; }),
      ]);

      // Resolve vendor — nested object first, then list match by id
      const vendorObj: ApiVendor | null = po.vendor
        ? { id: po.vendor.id, code: po.vendor.code ?? '', nameEn: po.vendor.nameEn, nameKm: po.vendor.nameKm }
        : vendorList.find(v => String(v.id) === String(po.vendorId)) ?? null;

      // Resolve location — nested object first, then list match by id
      const locationObj: ApiLocation | null = po.location
        ? { id: po.location.id, code: po.location.code ?? '', nameEn: po.location.nameEn ?? '', nameKm: '' }
        : locationList.find(l => String(l.id) === String(po.locationId)) ?? null;


      // Set all form state before navigating — no race condition
      setEditingPO(po);
      setSelectedVendor(vendorObj);
      setSelectedLocation(locationObj);
      setPoDate(po.created_at ? new Date(po.created_at) : new Date());
      setSelectedCategory(null);
      setDraftItems(
        (po.items ?? []).map(it => ({
          productId: String(it.productId ?? ''),
          qty: String(it.qty),
          unitPrice: Number(it.unitPriceCents).toFixed(4),
          discountPct: it.discountCents && it.unitPriceCents && it.qty
            ? String(parseFloat(((it.discountCents / (it.qty * it.unitPriceCents)) * 100).toFixed(2)))
            : '',
          taxPct: it.taxRatePct != null ? String(it.taxRatePct) : '',
          productName: it.productNameEn ?? it.productName ?? it.productSku,
          productNameKm: it.productNameKm ?? undefined,
          productSku: it.productSku ?? undefined,
          size: products.find(p => String(p.id) === String(it.productId))?.size ?? it.size ?? null,
        })),
      );
      ensureProducts();
      ensureLastCosts();
      closeDetail();
      setScreenView('form');
    } catch (err: any) {

      setDetailLoading(false);
    }
  };

  // ── Submit create / edit ────────────────────────────────────────────────────
  const submitForm = async () => {
    if (!selectedVendor) {
      showAlert({ type: 'warning', title: 'Required', message: 'Select a supplier vendor.' }); return;
    }
    if (!selectedLocation) {
      showAlert({ type: 'warning', title: 'Required', message: 'Select a delivery location.' }); return;
    }
    const validItems = draftItems.filter(i => i.productId.trim());
    if (!validItems.length) {
      showAlert({ type: 'warning', title: 'Required', message: 'Add at least one item with a product selected.' }); return;
    }
    const seenIds = new Set<string>();
    const dupItem = validItems.find(i => {
      if (seenIds.has(i.productId)) return true;
      seenIds.add(i.productId);
      return false;
    });
    if (dupItem) {
      showAlert({ type: 'warning', title: 'Duplicate SKU', message: `SKU ${dupItem.productSku ?? dupItem.productId} appears more than once. Please remove the duplicate.` }); return;
    }
    const items = validItems.map(i => {
      const qty = Math.max(1, parseInt(i.qty) || 1);
      const unitPriceCents = parseFloat(i.unitPrice) || 0;
      const discPct = parseFloat(i.discountPct) || 0;
      const taxPct = parseFloat(i.taxPct) || 0;
      const discountCents = discPct > 0 ? parseFloat((qty * unitPriceCents * discPct / 100).toFixed(4)) : undefined;
      return {
        productId: i.productId.trim(),
        qty,
        unitPriceCents,
        ...(discountCents ? { discountCents, discountPercent: Math.round(discPct) } : {}),
        ...(taxPct > 0 ? { taxRatePct: taxPct } : {}),
      };
    });

    const zeroItem = items.find(i => i.unitPriceCents <= 0);
    if (zeroItem) {
      const name = validItems.find(i => i.productId === zeroItem.productId)?.productName ?? zeroItem.productId;
      showAlert({ type: 'warning', title: 'Invalid Price', message: `"${name}" has no unit price. Please enter a price before submitting.` });
      return;
    }

    const payload = { vendorId: selectedVendor.id, locationId: Number(selectedLocation.id), created_at: toISO(poDate), items };

    const itemCount = items.length;
    const totalAmt = items.reduce((s, i) => {
      const gross = i.qty * i.unitPriceCents;
      const afterDisc = gross - (i.discountCents ?? 0);
      const tax = i.taxRatePct ?? 0;
      return s + afterDisc * (1 + tax / 100);
    }, 0);

    setPoConfirmPayload({ items, totalAmt, created_at: toISO(poDate) });
    setPoConfirmVisible(true);
  };

  const doSubmitConfirmed = async () => {
    if (!selectedVendor || !selectedLocation || !poConfirmPayload) return;
    const payload = { vendorId: selectedVendor.id, locationId: Number(selectedLocation.id), created_at: poConfirmPayload.created_at, items: poConfirmPayload.items };
    setPoConfirmVisible(false);
    setFormSubmitting(true);
    try {
      if (editingPO) {
        await updatePurchaseOrderApi(editingPO.id, payload);
        showAlert({ type: 'success', title: 'PO Updated', autoClose: 2000 });
        try {
          const updated = await getPurchaseOrderApi(editingPO.id);
          setPreviewingPO({ ...updated, vendor: updated.vendor ?? editingPO.vendor, supplierOrg: updated.supplierOrg ?? editingPO.supplierOrg });
          setPos(prev => prev.map(p => p.id === editingPO.id ? { ...p, totalCents: updated.totalCents } : p));
          setScreenView('preview');
        } catch {
          setScreenView('list');
        }
        load(true);
        return;
      } else {
        const created = await createPurchaseOrderApi(payload);
        if (!formSigRef.current?.isEmpty()) {
          try {
            const png = await formSigRef.current!.toPNG();
            const url = await uploadDirectApi({ uri: png, type: 'image/png', fileName: `sig-po-create-${Date.now()}.png` });
            await addPOReceivedImagesApi(String(created.id), [{ url, note: 'Signature - Created' }]);
          } catch {}
        }
        formSigRef.current?.clear();
        setFormSigEmpty(true);
        showAlert({ type: 'success', title: 'PO Created', message: created.poNumber, autoClose: 2500 });
      }
      setScreenView('list');
      load(true);
    } catch (err: any) {
      const respData = err?.response?.data;

      const issues = respData?.error?.issues ?? respData?.issues ?? [];
      const detail =
        (issues.length > 0 ? issues.map((i: any) => `${i.path?.join('.')}: ${i.message}`).join('\n') : null) ??
        respData?.error?.messageKey ??
        respData?.error?.message ??
        respData?.message ??
        err?.message ??
        'Failed to save';
      showAlert({ type: 'error', title: `Error ${err?.response?.status ?? ''}`, message: detail });
    } finally { setFormSubmitting(false); }
  };

  // ── Product picker helpers ──────────────────────────────────────────────────
  const filteredVendors = useMemo(() => {
    const q = vendorSearch.trim().toLowerCase();
    if (!q) return vendors;
    return vendors.filter(v =>
      (v.nameEn ?? '').toLowerCase().includes(q) ||
      (v.code ?? '').toLowerCase().includes(q) ||
      (v.nameKm ?? '').toLowerCase().includes(q),
    );
  }, [vendors, vendorSearch]);

  const filteredProducts = useMemo(() => {
    const q = pickerSearch.trim().toLowerCase();
    let result = products;
    if (selectedVendor) {
      result = result.filter(p => p.vendorId != null && Number(p.vendorId) === Number(selectedVendor.id));
    }
    if (pickerCategoryId) {
      result = result.filter(p => String(p.categoryId) === String(pickerCategoryId));
    }
    if (q) {
      result = result.filter(p =>
        (p.nameEn ?? '').toLowerCase().includes(q) || (p.sku ?? '').toLowerCase().includes(q),
      );
    }
    const seen = new Set<string>();
    result = result.filter(p => {
      const key = String(p.id);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return result.slice(0, 150);
  }, [products, pickerSearch, selectedVendor, pickerCategoryId]);

  // Categories that have at least one product for the current vendor filter
  const pickerCategories = useMemo(() => {
    let base = selectedVendor
      ? products.filter(p => p.vendorId != null && Number(p.vendorId) === Number(selectedVendor.id))
      : products;
    const usedIds = new Set(base.map(p => String(p.categoryId)).filter(Boolean));
    return categories.filter(c => usedIds.has(String(c.id)));
  }, [categories, products, selectedVendor]);

  // Categories available for the form-level selector (filtered by vendor)
  const vendorCategories = useMemo(() => {
    if (!selectedVendor) return categories;
    const vendorProducts = products.filter(p => p.vendorId != null && Number(p.vendorId) === Number(selectedVendor.id));
    const usedIds = new Set(vendorProducts.map(p => String(p.categoryId)).filter(Boolean));
    return categories.filter(c => usedIds.has(String(c.id)));
  }, [categories, products, selectedVendor]);

  const filteredCategorySearch = useMemo(() => {
    const q = categorySearch.trim().toLowerCase();
    if (!q) return vendorCategories;
    return vendorCategories.filter(c =>
      (c.nameEn ?? '').toLowerCase().includes(q) || (c.nameKm ?? '').toLowerCase().includes(q),
    );
  }, [vendorCategories, categorySearch]);

  // Auto-populate items when vendor + category are both selected
  useEffect(() => {
    if (!selectedVendor || !selectedCategory || products.length === 0) return;
    const matched = products.filter(p =>
      p.vendorId != null &&
      Number(p.vendorId) === Number(selectedVendor.id) &&
      String(p.categoryId) === String(selectedCategory.id),
    );
    if (matched.length === 0) return;
    const vatPct = selectedVendor.vat ? '10' : '';
    setDraftItems(matched.map(p => ({
      productId: String(p.id),
      productName: p.nameEn ?? p.sku ?? String(p.id),
      productNameKm: p.nameKm ?? undefined,
      productSku: p.sku ?? undefined,
      size: p.size ?? null,
      qty: '1',
      unitPrice: p.costPriceCents != null ? (Number(p.costPriceCents) / 100).toFixed(4) : '0',
      discountPct: '',
      taxPct: vatPct,
      salePrice: p.fixedPriceCents != null ? (Number(p.fixedPriceCents) / 100).toFixed(2) : undefined,
    })));
    matched.forEach(p => {
      if (!p.sku) return;
      getStockLastCostBySkuApi(p.sku)
        .then(cents => {
          if (cents == null) return;
          setDraftItems(prev => prev.map(it =>
            it.productId === String(p.id)
              ? { ...it, lastCostCents: cents, unitPrice: Number(cents).toFixed(4) }
              : it,
          ));
        })
        .catch(() => {});
    });
  }, [selectedVendor, selectedCategory, products]);

  const filteredLocations = useMemo(() => {
    const q = locationSearch.trim().toLowerCase();
    if (!q) return locations;
    return locations.filter(l =>
      (l.nameEn ?? '').toLowerCase().includes(q) ||
      (l.code ?? '').toLowerCase().includes(q),
    );
  }, [locations, locationSearch]);

  const selectProduct = (p: ApiProduct) => {
    if (pickerIdx == null) return;
    const isDuplicate = draftItems.some((it, i) => i !== pickerIdx && it.productId === String(p.id));
    if (isDuplicate) {
      setPickerVisible(false);
      setPickerSearch('');
      setPickerCategoryId(null);
      setPickerIdx(null);
      setTimeout(() => {
        showAlert({ type: 'warning', title: 'Duplicate SKU', message: `SKU ${p.sku ?? p.id} is already in the list.` });
      }, 350);
      return;
    }
    const salePriceDollars = p.fixedPriceCents != null
      ? (Number(p.fixedPriceCents) / 100).toFixed(2)
      : undefined;
    const idx = pickerIdx;
    setDraftItems(prev => prev.map((item, i) =>
      i === idx
        ? { ...item, productId: String(p.id), productName: p.nameEn ?? p.sku ?? String(p.id), productNameKm: p.nameKm ?? undefined, productSku: p.sku ?? undefined, size: p.size ?? null, salePrice: salePriceDollars, lastCostCents: null }
        : item,
    ));
    setPickerVisible(false);
    setPickerSearch('');
    setPickerCategoryId(null);
    setPickerIdx(null);
    if (p.sku) {
      getStockLastCostBySkuApi(p.sku)
        .then(cents => {
          setDraftItems(prev => prev.map((item, i) =>
            i === idx ? {
              ...item,
              lastCostCents: cents,
              unitPrice: cents != null ? Number(cents).toFixed(4) : item.unitPrice,
            } : item,
          ));
        })
        .catch(() => {});
    }
  };

  // ── PDF export ──────────────────────────────────────────────────────────────
  const buildPOHTML = (orders: ApiPurchaseOrder[]): string => {
    const A4 = 794, A4H = 1123, ROW_H = 28, THEAD_H = 30;
    const NON_TABLE = 520;
    const MAX_ROWS = Math.floor((A4H - NON_TABLE - THEAD_H) / ROW_H) + 3;

    const css = `
      @page{size:A4 portrait;margin:0}
      *,*::before,*::after{margin:0;padding:0;box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
      html,body{width:${A4}px;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#000;background:#fff}
      .page{position:relative;width:${A4}px;height:${A4H}px;padding:30px 38px 0;overflow:hidden;page-break-after:always;break-after:always}
      .page:last-child{page-break-after:avoid;break-after:avoid}
      .hdr{display:flex;align-items:flex-start;margin-bottom:6px}
      .hdr-left{width:96px;padding-top:2px}
      .hdr-center{flex:1;text-align:center}
      .hdr-right{width:148px;text-align:right;padding-top:2px}
      .logo{width:88px;height:88px;border-radius:12px;overflow:hidden}
      .logo img{width:88px;height:88px;display:block}
      .co-name{font-size:17px;font-weight:900;letter-spacing:3px;text-transform:uppercase}
      .co-addr{font-size:9px;color:#555;line-height:1.6;margin:3px 0 6px}
      .doc-title{font-size:20px;font-weight:900;letter-spacing:0;text-decoration:underline}
      .aba-label{font-size:9px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:0.5px}
      .aba-num{font-size:13px;font-weight:800;color:#2563EB;margin:3px 0 2px}
      .aba-name{font-size:10.5px;font-weight:600}
      .hr{border:none;border-top:1.5px solid #000;margin:4px 0 5px}
      .info-row{display:flex;border:1px solid #000;margin-bottom:6px}
      .info-box{flex:1;padding:5px 10px;line-height:1.75;font-size:11px}
      .info-box+.info-box{border-left:1px solid #000}
      b{font-weight:700}
      .tbl-wrap{border:1px solid #000;overflow:hidden}
      table{width:100%;border-collapse:collapse;table-layout:fixed}
      thead tr{height:${THEAD_H}px}
      thead th{background:#efefef;border-bottom:1.5px solid #000;border-right:1px solid #000;padding:0 4px;font-size:11px;font-weight:700;text-align:center;white-space:nowrap;height:${THEAD_H}px}
      thead th:last-child{border-right:none}
      tbody tr{height:${ROW_H}px}
      tbody td{height:${ROW_H}px;border:1px solid #d8d8d8;padding:0 5px;font-size:10.5px;vertical-align:middle;overflow:hidden;white-space:nowrap}
      .c{text-align:center}.r{text-align:right}.l{text-align:left}
      .no-badge{display:inline-block;width:20px;height:20px;line-height:20px;border-radius:4px;background:#EFF6FF;color:#2563EB;font-size:10px;font-weight:700;text-align:center}
      .dash{font-size:9px;color:#c0c0c0}
      col.no{width:28px}col.barcode{width:150px}col.name{width:auto}col.size{width:48px}col.qty{width:36px}col.up{width:72px}col.dis{width:48px}col.amt{width:76px}
      .footer{position:absolute;bottom:0;left:0;right:0;padding:0 38px 23px;background:#fff}
      .totals{border-top:1.5px solid #000;padding:5px 2px 6px}
      .tr{display:flex;justify-content:flex-end;align-items:center;font-size:11px;padding:2px 0}
      .tl{font-weight:600;padding-right:20px;min-width:90px;text-align:right}
      .tv{width:80px;text-align:right}
      .td .tv{color:#E53E3E}
      .tg{border-top:1px solid #aaa;margin-top:3px;padding-top:4px;font-size:12px;font-weight:800}
      .sig-section{border:1px solid #000;display:flex}
      .sig-col{flex:1;text-align:center;font-size:11px;font-weight:600;padding:10px 6px 12px;border-right:1px solid #000}
      .sig-col:last-child{border-right:none}
      .sig-line{border-bottom:1px solid #000;margin:6px 10px 10px;height:110px}
    `;

    const pages = orders.map(po => {
      const supplierName = po.vendorName ?? po.vendor?.nameEn ?? po.vendor?.nameKm ?? po.supplierOrg?.nameEn ?? po.supplierOrg?.name ?? '—';
      const location = po.location?.nameEn ?? `Location #${po.locationId ?? '—'}`;
      const vendorInfo = previewVendor ?? vendors.find(v => String(v.id) === String(po.vendorId));
      const supplierPhone = vendorInfo?.phone ?? '';
      const supplierAddress = vendorInfo?.address ?? '';
      const items = po.items ?? [];
      const subtotalCents = items.reduce((s, i) => s + Number(i.qty) * Number(i.unitPriceCents), 0);
      const discountCents = items.reduce((s, i) => s + (Number(i.discountCents) || 0), 0);
      const grandCents = po.totalCents != null ? Number(po.totalCents) / 100 : (subtotalCents - discountCents);
      const hasDiscount = items.some(it => (Number(it.discountCents) || 0) > 0);

      const dataRows = items.map((it, i) => {
        const nameKm = it.productNameKm ?? '';
        const nameEn = it.productNameEn ?? it.productName ?? '';
        const nameCell = nameKm && nameEn ? `${nameKm} - ${nameEn}` : nameKm || nameEn || '—';
        const discNum = Number(it.discountCents) || 0;
        const total = Number(it.qty) * Number(it.unitPriceCents) - discNum;
        const rawDisc = discNum && it.qty && it.unitPriceCents
          ? (discNum / (Number(it.qty) * Number(it.unitPriceCents))) * 100
          : 0;
        const disc = rawDisc > 0 ? `${parseFloat(rawDisc.toFixed(2))}%` : '';
        const discCell = hasDiscount ? `<td class="c">${disc || '<span class="dash">—</span>'}</td>` : '';
        return `<tr>
          <td class="c"><span class="no-badge">${i + 1}</span></td>
          <td class="l">${it.productSku ?? '—'}</td>
          <td class="l">${nameCell}</td>
          <td class="c">${products.find(p => String(p.id) === String(it.productId))?.size ?? it.size ?? '—'}</td>
          <td class="c">${it.qty}</td>
          <td class="r">$${Number(it.unitPriceCents).toFixed(4)}</td>
          ${discCell}
          <td class="r">$${Number(total).toFixed(2)}</td>
        </tr>`;
      }).join('');

      const fillerCells = hasDiscount
        ? `<tr><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>`
        : `<tr><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>`;
      const fillers = Array.from({ length: Math.max(0, MAX_ROWS - items.length) })
        .map(() => fillerCells)
        .join('');

      return `
<div class="page">
  <div class="hdr">
    <div class="hdr-left"><div class="logo"><img src="${LOGO_BASE64}" /></div></div>
    <div class="hdr-center">
      <div class="co-name">FOCUS LAB</div>
      <div class="co-addr">#17 St 480, Sangkat Toul Toum Pong 1<br/>Khan Chamkarmon, Phnom Penh 12310</div>
      <div class="doc-title">PURCHASE ORDER</div>
    </div>
    <div class="hdr-right"></div>
  </div>
  <div class="hr"></div>
  <div class="info-row">
    <div class="info-box"><b>Vendor:</b> ${supplierName}${supplierPhone ? `<br/><b>Phone:</b> ${supplierPhone}` : ''}${supplierAddress ? `<br/><b>Address:</b> ${supplierAddress}` : ''}</div>
    <div class="info-box"><b>No:</b> ${po.poNumber}<br/><b>Date:</b> ${fmtDate(po.createdAt)}<br/><b>Status:</b> ${STATUS[po.status]?.label ?? po.status}${po.receiptNote ? `<br/><b>No:</b> ${po.receiptNote}` : ''}</div>
  </div>
  <div class="tbl-wrap">
    <table>
      <colgroup><col class="no"/><col class="barcode"/><col class="name"/><col class="size"/><col class="qty"/><col class="up"/>${hasDiscount ? '<col class="dis"/>' : ''}<col class="amt"/></colgroup>
      <thead><tr><th>No</th><th class="l">Barcode</th><th class="l">Name</th><th>Size</th><th>Qty</th><th>Price</th>${hasDiscount ? '<th>Disc</th>' : ''}<th>Amount</th></tr></thead>
      <tbody>${dataRows}${fillers}</tbody>
    </table>
  </div>
  <div class="footer">
    <div class="totals">
      <div class="tr"><span class="tl">Sub Total</span><span class="tv">$${subtotalCents.toFixed(2)}</span></div>
      ${hasDiscount ? `<div class="tr td"><span class="tl">Discount</span><span class="tv">- $${discountCents.toFixed(2)}</span></div>` : ''}
      <div class="tr tg"><span class="tl">Grand Total</span><span class="tv">$${Number(grandCents).toFixed(2)}</span></div>
    </div>
    <div class="sig-section">
      <div class="sig-col"><div class="sig-line"></div>Prepared By</div>
      <div class="sig-col"><div class="sig-line"></div>Approved By</div>
      <div class="sig-col"><div class="sig-line"></div>Received By</div>
    </div>
  </div>
</div>`;
    }).join('\n');

    return `<!DOCTYPE html><html><head><meta charset="UTF-8"/><style>${css}</style></head><body>${pages}</body></html>`;
  };

  const doApproveWithSignature = async () => {
    if (!detailPO) return;
    if (sigRef.current?.isEmpty()) {
      Alert.alert('Signature Required', 'Please draw a signature before approving.');
      return;
    }
    showConfirm(
      'Confirm Approve',
      `Approve ${detailPO.poNumber}?`,
      async () => {
        setSigSaving(true);
        try {
          const png = await sigRef.current!.toPNG();
          const url = await uploadDirectApi({ uri: png, type: 'image/png', fileName: `sig-po-${Date.now()}.png` });
          await approvePurchaseOrderApi(detailPO.id);
          try { await addPOReceivedImagesApi(String(detailPO.id), [{ url, note: 'Signature' }]); } catch {}
          closeDetail();
          load(true);
          showAlert({ type: 'success', title: 'Approved', message: `${detailPO.poNumber} has been approved.`, autoClose: 2500 });
        } catch (e: any) {
          const status = (e as any)?.response?.status;
          const msg = (e as any)?.response?.data?.message ?? e?.message ?? 'Could not approve PO';
          Alert.alert(`Failed${status ? ` (${status})` : ''}`, msg);
        } finally {
          setSigSaving(false);
        }
      },
      { confirmLabel: 'Approve' },
    );
  };

  const doSendWithSignature = async () => {
    if (!detailPO) return;
    if (sigRef.current?.isEmpty()) {
      Alert.alert('Signature Required', 'Please draw a signature before sending.');
      return;
    }
    showConfirm(
      'Confirm Send',
      `Send ${detailPO.poNumber} to supplier?`,
      async () => {
        setSigSaving(true);
        try {
          const png = await sigRef.current!.toPNG();
          const url = await uploadDirectApi({ uri: png, type: 'image/png', fileName: `sig-po-send-${Date.now()}.png` });
          await sendPurchaseOrderApi(detailPO.id);
          try { await addPOReceivedImagesApi(String(detailPO.id), [{ url, note: 'Signature - Send' }]); } catch {}
          sigRef.current?.clear();
          closeDetail();
          load(true);
          showAlert({ type: 'success', title: 'Sent', message: `${detailPO.poNumber} sent to supplier.`, autoClose: 2500 });
        } catch (e: any) {
          const status = (e as any)?.response?.status;
          const msg = (e as any)?.response?.data?.message ?? e?.message ?? 'Could not send PO';
          Alert.alert(`Failed${status ? ` (${status})` : ''}`, msg);
        } finally {
          setSigSaving(false);
        }
      },
      { confirmLabel: 'Send' },
    );
  };

  const previewSinglePO = async (po: ApiPurchaseOrder) => {
    setPrintLoading(true);
    try {
      // po is already the fully resolved previewingPO (vendor merged in openPreview) — no re-fetch needed
      const html = buildPOHTML([po]);
      const name = `${po.poNumber.replace(/[^a-zA-Z0-9]/g, '-')}-${Date.now()}`;
      const result = await Print.printToFileAsync({ html, width: 595, height: 842 });
      setPrintLoading(false);
      await Share.share({ url: result.uri, title: `Purchase Order ${po.poNumber}` });
    } catch (err: any) {
      setPrintLoading(false);
      Alert.alert('Export Error', err?.message ?? 'Failed to export PDF');
    }
  };

  const handleExportPDF = async () => {
    const targets = selectedIds.size > 0
      ? filteredPos.filter(p => selectedIds.has(p.id))
      : filteredPos;
    if (targets.length === 0) {
      showAlert({ type: 'info', title: 'No Orders', message: 'Nothing to export.' }); return;
    }
    setExporting(true);
    try {
      for (const po of targets) {
        let full = po;
        try { full = await getPurchaseOrderApi(po.id); } catch {}
        const html = buildPOHTML([full]);
        const name = `${po.poNumber.replace(/[^a-zA-Z0-9]/g, '-')}-${Date.now()}`;
        const result = await Print.printToFileAsync({ html, width: 595, height: 842 });
        await Share.share({ url: result.uri, title: `Purchase Order ${po.poNumber}` });
      }
    } catch (err: any) {
      showAlert({ type: 'error', title: 'Export Error', message: err?.message ?? 'Failed to export PDF' });
    } finally {
      setExporting(false);
    }
  };

  // ── PO Row (Sale Order style) ────────────────────────────────────────────────
  const openDetailReceive = async (po: ApiPurchaseOrder) => {
    sigRef.current?.clear();
    setSigEmpty(true);
    setDetailPO(po);
    setActionPanel('none');
    setReceivedImages([]);
    setDetailLoading(true);
    try {
      const full = await getPurchaseOrderApi(po.id);
      setDetailPO(full);
      setActionPanel('receive');
      if (full.items?.length) {
        setReceiveRows(full.items.map(it => ({
          poItemId: it.id,
          productName: it.productNameEn ?? it.productName ?? it.productSku ?? it.productId,
          totalQty: it.qty,
          alreadyReceived: it.qtyReceived ?? 0,
          qtyReceived: String(Math.max(0, it.qty - (it.qtyReceived ?? 0))),
          unitCost: it.unitPriceCents != null ? Number(it.unitPriceCents).toFixed(4) : '0',
        })));
      }
    } catch {} finally { setDetailLoading(false); }
  };

  const renderCard = ({ item, index }: { item: ApiPurchaseOrder; index: number }) => {
    const s = STATUS[item.status] ?? STATUS.DRAFT;
    const poRef = item.poNumber ?? item.referenceNumber ?? item.ref ?? item.id;
    const supplier = item.vendorName ?? item.vendor?.nameEn ?? item.vendor?.nameKm ?? item.supplierOrg?.nameEn ?? item.supplierOrg?.name ?? '—';
    const location = item.location?.nameEn ?? item.location?.code ?? null;
    const rowColors = ['#2563EB', '#7C3AED', '#10B981', '#F59E0B', '#EF4444', '#06B6D4'];
    const color = rowColors[index % rowColors.length];
    const isSelected = selectedIds.has(item.id);
    const days = daysSince(item.createdAt);
    const dc = daysBadgeColor(days);
    const canEdit = item.status === 'DRAFT';
    const canReceive = item.status === 'SENT';
    const canOpenDetail = item.status !== 'BILLED' && item.status !== 'PAID';
    const isReceived = item.status === 'RECEIVED';

    const isExpanded = expandedPoId === String(item.id);
    const imgCount = item.imageCount ?? 0;

    return (
      <View style={[styles.rowWrap, isSelected && styles.rowSelected]}>
        <TouchableOpacity
          onPress={() => toggleSelect(item.id)}
          onLongPress={() => openDetail(item)}
          activeOpacity={0.7}
        >
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
              {/* PO reference */}
              <View style={styles.refRow}>
                <AppText style={styles.refLabel}>PO:</AppText>
                <AppText style={styles.poNumber} numberOfLines={1}>{poRef}</AppText>
              </View>
              {/* Note below PO number */}
              {item.note ? (
                <AppText style={styles.poNoteText} numberOfLines={2}>{item.note}</AppText>
              ) : null}
              {/* Vendor name */}
              <View style={styles.refRow}>
                <AppText style={styles.refLabel}>Vendor:</AppText>
                <AppText style={[styles.vendorName, { flex: 1 }]} numberOfLines={1}>{supplier}</AppText>
              </View>
              {/* Receipt note */}
              {item.receiptNote ? (
                <View style={styles.refRow}>
                  <AppText style={styles.refLabel}>No:</AppText>
                  <AppText style={[styles.receiptNoteText, { flex: 1 }]} numberOfLines={2}>{item.receiptNote}</AppText>
                </View>
              ) : null}
              {/* Meta chips */}
              <View style={styles.rowMeta}>
                {location ? (
                  <View style={styles.locationChip}>
                    <Icon name="place" size={10} color={Colors.textSecondary} />
                    <AppText style={styles.locationChipText} numberOfLines={1}>{location}</AppText>
                  </View>
                ) : null}
                <AppText style={styles.rowDate}>{fmtDate(item.createdAt)}</AppText>
                <View style={[styles.daysBadge, { backgroundColor: dc.bg }]}>
                  <Icon name="schedule" size={10} color={dc.text} />
                  <AppText style={[styles.daysText, { color: dc.text }]}>
                    {days === 0 ? 'Today' : `${days}d`}
                  </AppText>
                </View>
              </View>
            </View>
            <View style={styles.rowRight}>
              <AppText style={styles.rowAmount}>{fmtMoney(item.totalCents)}</AppText>
              <View style={[styles.statusBadge, { backgroundColor: s.bg }]}>
                <AppText style={[styles.statusText, { color: s.color }]}>{s.label}</AppText>
              </View>
              {/* Image count badge + toggle */}
              <TouchableOpacity
                style={styles.imgToggleRow}
                onPress={() => toggleImagePanel(item)}
                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              >
                {imgCount > 0 ? (
                  <View style={styles.imgCountBadge}>
                    <AppText style={styles.imgCountText}>📎 {imgCount}</AppText>
                  </View>
                ) : null}
                <Icon
                  name={isExpanded ? 'expand-less' : 'expand-more'}
                  size={18}
                  color={Colors.textSecondary}
                />
              </TouchableOpacity>
            </View>
          </View>
          {/* Action row */}
          <View style={styles.cardActionRow}>
            {isReceived ? (
              <View style={styles.completedBadge}>
                <Icon name="check-circle" size={14} color="#16A34A" />
                <AppText style={styles.completedText}>Status: Completed</AppText>
              </View>
            ) : (
              <>
                <TouchableOpacity
                  style={[styles.cardActionBtn, { backgroundColor: '#F0FDF4', borderColor: '#BBF7D0', opacity: canReceive ? 1 : 0.35 }]}
                  onPress={() => openDetailReceive(item)}
                  activeOpacity={0.7}
                  disabled={!canReceive}
                >
                  <Icon name="move-to-inbox" size={13} color="#16A34A" />
                  <AppText style={[styles.cardActionText, { color: '#16A34A' }]}>Receive</AppText>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.cardActionBtn, { backgroundColor: '#F5F3FF', borderColor: '#DDD6FE', opacity: canOpenDetail ? 1 : 0.35 }]}
                  onPress={() => openDetail(item)}
                  activeOpacity={0.7}
                  disabled={!canOpenDetail}
                >
                  <Icon name="open-in-new" size={13} color="#7C3AED" />
                  <AppText style={[styles.cardActionText, { color: '#7C3AED' }]}>Details</AppText>
                </TouchableOpacity>
              </>
            )}
            <TouchableOpacity
              style={[styles.cardActionBtn, { backgroundColor: '#FFF7ED', borderColor: '#FED7AA' }]}
              onPress={() => openPreview(item)}
              activeOpacity={0.7}
            >
              <Icon name="visibility" size={13} color="#EA580C" />
              <AppText style={[styles.cardActionText, { color: '#EA580C' }]}>View PO</AppText>
            </TouchableOpacity>
          </View>

          {/* Inline image panel — inside card */}
          {isExpanded ? (
            <View style={styles.expandedImgPanel}>
              {expandedImgLoading ? (
                <ActivityIndicator size="small" color={Colors.primary} style={{ marginVertical: 12 }} />
              ) : expandedImages.length === 0 ? (
                <AppText style={styles.expandedImgEmpty}>No images</AppText>
              ) : (
                <View style={styles.expandedImgGrid}>
                  {expandedImages.map(img => (
                    <TouchableOpacity
                      key={img.id}
                      style={styles.expandedImgThumbWrap}
                      onPress={() => setExpandedPreviewUrl(img.url)}
                      activeOpacity={0.8}
                    >
                      <Image source={{ uri: img.url }} style={styles.expandedImgThumb} resizeMode="cover" />
                      <View style={styles.expandedImgZoomBadge}>
                        <Icon name="zoom-in" size={12} color="#fff" />
                      </View>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>
          ) : null}
        </TouchableOpacity>
      </View>
    );
  };

  // ── Form view ────────────────────────────────────────────────────────────────
  if (screenView === 'form') {
    const formTotal = draftItems.reduce((s, i) => {
      const qty = parseInt(i.qty) || 0;
      const price = parseFloat(i.unitPrice) || 0;
      const disc = parseFloat(i.discountPct) || 0;
      const tax = parseFloat(i.taxPct) || 0;
      return s + qty * price * (1 - disc / 100) * (1 + tax / 100);
    }, 0);

    const canAddItem = !!selectedVendor && !!selectedLocation;
    const canSubmit = !!selectedVendor && !!selectedLocation && draftItems.some(i => i.productId.trim() && parseInt(i.qty) >= 1);

    return (
      <View style={styles.safe}>
        <AppBar
          title={editingPO ? 'Edit Purchase Order' : 'New Purchase Order'}
          subtitle={editingPO ? editingPO.poNumber : 'Fill in order details'}
          titleAlign="left"
          showBack
          onBack={() => setScreenView('list')}
        />
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView style={styles.formScroll} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 120 }}>

            {/* PO Date */}
            <AppText style={styles.sectionLabel}>PO Date</AppText>
            <TouchableOpacity
              style={styles.vendorPicker}
              onPress={() => setPoDraftDatePicker(true)}
              activeOpacity={0.75}
            >
              <Icon name="event" size={20} color={Colors.primary} />
              <AppText style={[styles.vendorPickerName, { flex: 1 }]}>{toISO(poDate)}</AppText>
              <Icon name="arrow-drop-down" size={22} color={Colors.textSecondary} />
            </TouchableOpacity>

            {/* Supplier */}
            <AppText style={styles.sectionLabel}>Supplier</AppText>
            <TouchableOpacity
              style={styles.vendorPicker}
              onPress={() => { setVendorSearch(''); setVendorPickerVisible(true); }}
              activeOpacity={0.75}
            >
              <Icon name="store" size={20} color={selectedVendor ? Colors.primary : Colors.textLight} />
              <View style={{ flex: 1 }}>
                {selectedVendor ? (
                  <>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <AppText style={styles.vendorPickerName}>{selectedVendor.nameEn ?? selectedVendor.code}</AppText>
                      {selectedVendor.vat ? (
                        <View style={styles.vatChip}>
                          <AppText style={styles.vatChipText}>VAT 10%</AppText>
                        </View>
                      ) : null}
                    </View>
                    <AppText style={styles.vendorPickerCode}>{selectedVendor.code}</AppText>
                  </>
                ) : (
                  <AppText style={styles.vendorPickerPlaceholder}>Select vendor…</AppText>
                )}
              </View>
              <Icon name="arrow-drop-down" size={22} color={Colors.textSecondary} />
            </TouchableOpacity>

            {/* Location */}
            <AppText style={styles.sectionLabel}>Delivery Location</AppText>
            <TouchableOpacity
              style={styles.vendorPicker}
              onPress={() => { setLocationSearch(''); ensureLocations(); setLocationPickerVisible(true); }}
              activeOpacity={0.75}
            >
              <Icon name="place" size={20} color={selectedLocation ? Colors.primary : Colors.textLight} />
              <View style={{ flex: 1 }}>
                {selectedLocation ? (
                  <>
                    <AppText style={styles.vendorPickerName}>{selectedLocation.nameEn}</AppText>
                    <AppText style={styles.vendorPickerCode}>{selectedLocation.code}</AppText>
                  </>
                ) : (
                  <AppText style={styles.vendorPickerPlaceholder}>Select location…</AppText>
                )}
              </View>
              <Icon name="arrow-drop-down" size={22} color={Colors.textSecondary} />
            </TouchableOpacity>

            {/* Category */}
            <AppText style={styles.sectionLabel}>Category <AppText style={{ fontWeight: '400', color: Colors.textLight }}>(auto-fills items)</AppText></AppText>
            <TouchableOpacity
              style={styles.vendorPicker}
              onPress={() => { setCategorySearch(''); setCategoryPickerVisible(true); }}
              activeOpacity={0.75}
            >
              <Icon name="category" size={20} color={selectedCategory ? Colors.primary : Colors.textLight} />
              <View style={{ flex: 1 }}>
                {selectedCategory ? (
                  <AppText style={styles.vendorPickerName}>{selectedCategory.nameEn}</AppText>
                ) : (
                  <AppText style={styles.vendorPickerPlaceholder}>Select category…</AppText>
                )}
              </View>
              {selectedCategory && (
                <TouchableOpacity onPress={() => { setSelectedCategory(null); setDraftItems([{ productId: '', qty: '1', unitPrice: '0', discountPct: '', taxPct: selectedVendor?.vat ? '10' : '' }]); }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Icon name="close" size={18} color={Colors.textSecondary} />
                </TouchableOpacity>
              )}
              {!selectedCategory && <Icon name="arrow-drop-down" size={22} color={Colors.textSecondary} />}
            </TouchableOpacity>

            {/* Items */}
            <View style={styles.sectionRow}>
              <AppText style={styles.sectionLabel}>Items</AppText>
              <TouchableOpacity
                style={[styles.addItemBtn, !canAddItem && { opacity: 0.4 }]}
                onPress={() => setDraftItems(prev => [...prev, { productId: '', qty: '1', unitPrice: '0', discountPct: '', taxPct: selectedVendor?.vat ? '10' : '' }])}
                disabled={!canAddItem}
              >
                <Icon name="add" size={16} color={Colors.primary} />
                <AppText style={styles.addItemText}>Add Item</AppText>
              </TouchableOpacity>
            </View>

            {draftItems.map((item, idx) => (
              <View key={idx} style={styles.itemCard}>
                <View style={styles.itemCardHeader}>
                  <View style={[styles.itemIdx, { backgroundColor: `${Colors.primary}18` }]}>
                    <AppText style={styles.itemIdxText}>{idx + 1}</AppText>
                  </View>
                  {draftItems.length > 1 ? (
                    <TouchableOpacity
                      onPress={() => setDraftItems(prev => prev.filter((_, i) => i !== idx))}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Icon name="remove-circle-outline" size={20} color={Colors.error} />
                    </TouchableOpacity>
                  ) : null}
                </View>

                {/* Product picker */}
                <TouchableOpacity
                  style={[styles.productPicker, !selectedLocation && styles.productPickerDisabled]}
                  disabled={!selectedLocation}
                  onPress={() => {
                    ensureProducts();
                    ensureCategories();
                    setPickerIdx(idx);
                    setPickerSearch('');
                    setPickerCategoryId(null);
                    setPickerVisible(true);
                  }}
                >
                  <Icon name="inventory-2" size={16} color={!selectedLocation ? Colors.textLight : item.productId ? Colors.primary : Colors.textLight} />
                  {item.productId ? (
                    <View style={{ flex: 1 }}>
                      {/* Column headers */}
                      <View style={{ flexDirection: 'row', marginBottom: 2 }}>
                        <AppText style={{ width: 150, fontSize: 10, fontWeight: '700', color: Colors.textSecondary }}>SKU</AppText>
                        <AppText style={{ width: 56, fontSize: 10, fontWeight: '700', color: Colors.textSecondary }}>Size</AppText>
                        <AppText style={{ flex: 1, fontSize: 10, fontWeight: '700', color: Colors.textSecondary }}>Name KH</AppText>
                        <AppText style={{ flex: 1, fontSize: 10, fontWeight: '700', color: Colors.textSecondary }}>Name EN</AppText>
                      </View>
                      {/* Column values */}
                      <View style={{ flexDirection: 'row' }}>
                        <AppText style={{ width: 150, fontSize: 12, fontWeight: '600', color: Colors.primary }} numberOfLines={1}>{item.productSku ?? '—'}</AppText>
                        <AppText style={{ width: 56, fontSize: 12, color: Colors.text }} numberOfLines={1}>{item.size ?? '—'}</AppText>
                        <AppText style={{ flex: 1, fontSize: 12, color: Colors.text }} numberOfLines={1}>{item.productNameKm ?? '—'}</AppText>
                        <AppText style={{ flex: 1, fontSize: 12, color: Colors.text }} numberOfLines={1}>{item.productName ?? '—'}</AppText>
                      </View>
                    </View>
                  ) : (
                    <AppText style={[styles.productPickerText, styles.productPickerPlaceholder]}>
                      {selectedLocation ? 'Select product…' : 'Select a location first'}
                    </AppText>
                  )}
                  <Icon name="arrow-drop-down" size={20} color={Colors.textSecondary} />
                </TouchableOpacity>

                {/* Qty + Price */}
                <View style={styles.itemNumRow}>
                  <View style={styles.itemNumField}>
                    <AppText style={styles.fieldLabel}>Qty</AppText>
                    <TextInput
                      style={styles.numInput}
                      value={item.qty}
                      onChangeText={v => setDraftItems(prev => prev.map((it, i) => i === idx ? { ...it, qty: v } : it))}
                      keyboardType="numeric"
                      selectTextOnFocus
                    />
                  </View>
                  <View style={[styles.itemNumField, { flex: 2 }]}>
                    <AppText style={styles.fieldLabel}>Unit Price ($)</AppText>
                    <TextInput
                      style={[
                        styles.numInput,
                        item.salePrice && parseFloat(item.unitPrice) > parseFloat(item.salePrice)
                          ? styles.numInputError
                          : null,
                      ]}
                      value={item.unitPrice}
                      onChangeText={v => {
                        let clean = v.replace(/[^0-9.]/g, '');
                        if (clean.startsWith('.')) clean = '0' + clean;
                        setDraftItems(prev => prev.map((it, i) => i === idx ? { ...it, unitPrice: clean } : it));
                      }}
                      keyboardType="decimal-pad"
                      selectTextOnFocus
                    />
                  </View>
                  <View style={[styles.itemNumField, { flex: 2 }]}>
                    <AppText style={styles.fieldLabel}>Sale Price ($)</AppText>
                    <TextInput
                      style={[styles.numInput, styles.numInputSalePrice]}
                      value={item.salePrice ?? '—'}
                      editable={false}
                    />
                  </View>
                  <View style={styles.itemNumField}>
                    <AppText style={styles.fieldLabel}>Line Total</AppText>
                    {(() => {
                      const qty = parseInt(item.qty) || 0;
                      const price = parseFloat(item.unitPrice) || 0;
                      const disc = parseFloat(item.discountPct) || 0;
                      const tax = parseFloat(item.taxPct) || 0;
                      const orig = qty * price;
                      const afterDisc = orig * (1 - disc / 100);
                      const after = afterDisc * (1 + tax / 100);
                      return (
                        <View>
                          {(disc > 0 || tax > 0) ? <AppText style={styles.lineTotalOld}>${orig.toFixed(4)}</AppText> : null}
                          <AppText style={styles.lineTotal}>${after.toFixed(4)}</AppText>
                        </View>
                      );
                    })()}
                  </View>
                </View>

                {item.salePrice && parseFloat(item.unitPrice) > parseFloat(item.salePrice) ? (
                  <View style={styles.priceErrorRow}>
                    <Icon name="warning" size={13} color="#EF4444" />
                    <AppText style={styles.priceErrorText}>
                      Unit price exceeds sale price (${item.salePrice})
                    </AppText>
                  </View>
                ) : null}

                {/* Last invoice cost hint */}
                {(() => {
                  const skuVal = item.lastCostCents;
                  const lc = item.productId ? lastCostMap[String(item.productId)] : undefined;
                  const costVal = skuVal != null ? Number(skuVal) : (lc ? Number(lc.lastCostCents) : null);
                  if (costVal == null || isNaN(costVal)) return null;
                  const lastPrice = costVal.toFixed(4);
                  const isCurrentPrice = parseFloat(item.unitPrice) === costVal;
                  return (
                    <TouchableOpacity
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: isCurrentPrice ? '#F0FDF4' : '#FFFBEB', borderRadius: 8, marginBottom: 6 }}
                      onPress={() => setDraftItems(prev => prev.map((it, i) => i === idx ? { ...it, unitPrice: lastPrice } : it))}
                      activeOpacity={0.7}
                    >
                      <Icon name="history" size={13} color={isCurrentPrice ? '#059669' : '#D97706'} />
                      <AppText style={{ fontSize: 11, color: isCurrentPrice ? '#059669' : '#92400E', flex: 1 }}>
                        Last cost: <AppText style={{ fontWeight: '700' }}>${lastPrice}</AppText>
                        {lc?.lastPoDate ? `  ·  ${lc.lastPoDate.slice(0, 10)}` : ''}
                      </AppText>
                      {!isCurrentPrice && (
                        <View style={{ backgroundColor: '#D97706', borderRadius: 5, paddingHorizontal: 7, paddingVertical: 2 }}>
                          <AppText style={{ fontSize: 10, fontWeight: '700', color: '#fff' }}>Use</AppText>
                        </View>
                      )}
                      {isCurrentPrice && <Icon name="check-circle" size={13} color="#059669" />}
                    </TouchableOpacity>
                  );
                })()}

                {/* VAT + Discount — single row */}
                <View style={[styles.discountRow, { gap: 12 }]}>
                  {/* VAT */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, flex: 1 }}>
                    <Icon name="receipt-long" size={13} color="#059669" />
                    <AppText style={[styles.discountLabel, { color: '#059669' }]}>VAT</AppText>
                    <View style={[styles.discInputWrap, { marginLeft: 4 }]}>
                      <TextInput
                        style={[styles.discInput, parseFloat(item.taxPct) > 0 && { color: '#059669' }]}
                        value={item.taxPct}
                        onChangeText={v => {
                          const clean = v.replace(/[^0-9.]/g, '');
                          if (parseFloat(clean) > 100) return;
                          setDraftItems(prev => prev.map((it, i) => i === idx ? { ...it, taxPct: clean } : it));
                        }}
                        keyboardType="decimal-pad"
                        placeholder="0"
                        placeholderTextColor={Colors.textLight}
                        maxLength={5}
                        selectTextOnFocus
                      />
                      <AppText style={styles.discPctSign}>%</AppText>
                    </View>
                  </View>
                  {/* Discount */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, flex: 1 }}>
                    <Icon name="sell" size={13} color="#7C3AED" />
                    <AppText style={styles.discountLabel}>Disc</AppText>
                    <View style={[styles.discInputWrap, { marginLeft: 4 }]}>
                      <TextInput
                        style={styles.discInput}
                        value={item.discountPct}
                        onChangeText={v => {
                          const clean = v.replace(/[^0-9.]/g, '');
                          if (parseFloat(clean) > 100) return;
                          setDraftItems(prev => prev.map((it, i) => i === idx ? { ...it, discountPct: clean } : it));
                        }}
                        keyboardType="decimal-pad"
                        placeholder="0"
                        placeholderTextColor={Colors.textLight}
                        maxLength={5}
                        selectTextOnFocus
                      />
                      <AppText style={styles.discPctSign}>%</AppText>
                    </View>
                  </View>
                </View>
              </View>
            ))}

            <View style={styles.formTotalRow}>
              <AppText style={styles.formTotalLabel}>Estimated Total</AppText>
              <AppText style={styles.formTotalVal}>${formTotal.toFixed(4)}</AppText>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>

        {/* Signature — fixed above submit button */}
        <View style={{ paddingHorizontal: 16, paddingTop: 10, borderTopWidth: 1, borderTopColor: Colors.divider, backgroundColor: Colors.background }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <AppText style={styles.sectionLabel}>Signature</AppText>
            <TouchableOpacity onPress={() => { formSigRef.current?.clear(); setFormSigEmpty(true); }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <AppText style={{ fontSize: 12, color: Colors.textSecondary }}>Clear</AppText>
            </TouchableOpacity>
          </View>
          <View style={{ height: 200, borderWidth: 1, borderColor: Colors.divider, borderRadius: 10, overflow: 'hidden', backgroundColor: '#FAFAFA' }}>
            <SignaturePad ref={formSigRef} style={{ flex: 1 }} onDrawEnd={() => setFormSigEmpty(false)} />
          </View>
          {formSigEmpty && (
            <AppText style={{ fontSize: 11, color: Colors.textLight, marginTop: 4 }}>Draw your signature above (optional)</AppText>
          )}
        </View>

        <View style={styles.formBar}>
          <TouchableOpacity
            style={[styles.submitBtn, (formSubmitting || !canSubmit || (!editingPO && formSigEmpty)) && styles.submitBtnDisabled]}
            onPress={submitForm}
            disabled={formSubmitting || !canSubmit || (!editingPO && formSigEmpty)}
            activeOpacity={0.85}
          >
            {formSubmitting
              ? <ActivityIndicator size="small" color="#fff" />
              : <Icon name={editingPO ? 'save' : 'add-shopping-cart'} size={20} color="#fff" />}
            <AppText style={styles.submitBtnText}>
              {editingPO ? 'Save Changes' : 'Create Purchase Order'}
            </AppText>
          </TouchableOpacity>
        </View>

        {/* Vendor picker modal */}
        <Modal visible={vendorPickerVisible} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setVendorPickerVisible(false)}>
          <View style={styles.pickerModal}>
            <View style={styles.pickerHeader}>
              <AppText style={styles.pickerTitle}>Select Vendor</AppText>
              <TouchableOpacity onPress={() => setVendorPickerVisible(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Icon name="close" size={22} color={Colors.text} />
              </TouchableOpacity>
            </View>
            <View style={styles.pickerSearch}>
              <Icon name="search" size={18} color={Colors.textSecondary} />
              <TextInput
                style={styles.pickerSearchInput}
                value={vendorSearch}
                onChangeText={setVendorSearch}
                placeholder="Search by name or code…"
                placeholderTextColor={Colors.textLight}
                autoFocus
                autoCorrect={false}
              />
            </View>
            {vendorsLoading ? (
              <ActivityIndicator style={{ marginTop: 32 }} color={Colors.primary} />
            ) : (
              <FlatList
                data={filteredVendors}
                keyExtractor={v => String(v.id)}
                renderItem={({ item: v }) => (
                  <TouchableOpacity
                    style={[styles.pickerRow, selectedVendor?.id === v.id && styles.pickerRowSelected]}
                    onPress={() => {
                      setSelectedVendor(v);
                      setVendorPickerVisible(false);
                      if (v.vat) {
                        setDraftItems(prev => prev.map(it => ({ ...it, taxPct: it.taxPct || '10' })));
                      }
                    }}
                    activeOpacity={0.7}
                  >
                    <View style={styles.pickerRowInfo}>
                      <AppText style={styles.pickerRowName}>{v.nameEn ?? v.code}</AppText>
                      <AppText style={styles.pickerRowSku}>{v.code}{v.phone ? `  ·  ${v.phone}` : ''}</AppText>
                    </View>
                    {selectedVendor?.id === v.id
                      ? <Icon name="check-circle" size={20} color={Colors.primary} />
                      : <Icon name="chevron-right" size={18} color={Colors.textLight} />}
                  </TouchableOpacity>
                )}
                keyboardShouldPersistTaps="handled"
                ListEmptyComponent={<AppText style={styles.pickerEmpty}>No vendors found</AppText>}
              />
            )}
          </View>
        </Modal>

        {/* Location picker modal */}
        <Modal visible={locationPickerVisible} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setLocationPickerVisible(false)}>
          <View style={styles.pickerModal}>
            <View style={styles.pickerHeader}>
              <AppText style={styles.pickerTitle}>Select Location</AppText>
              <TouchableOpacity onPress={() => setLocationPickerVisible(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Icon name="close" size={22} color={Colors.text} />
              </TouchableOpacity>
            </View>
            <View style={styles.pickerSearch}>
              <Icon name="search" size={18} color={Colors.textSecondary} />
              <TextInput
                style={styles.pickerSearchInput}
                value={locationSearch}
                onChangeText={setLocationSearch}
                placeholder="Search by name or code…"
                placeholderTextColor={Colors.textLight}
                autoFocus
                autoCorrect={false}
              />
            </View>
            {locationsLoading ? (
              <ActivityIndicator style={{ marginTop: 32 }} color={Colors.primary} />
            ) : (
              <FlatList
                data={filteredLocations}
                keyExtractor={l => String(l.id)}
                renderItem={({ item: l }) => (
                  <TouchableOpacity
                    style={[styles.pickerRow, String(selectedLocation?.id) === String(l.id) && styles.pickerRowSelected]}
                    onPress={() => { setSelectedLocation(l); setLocationPickerVisible(false); }}
                    activeOpacity={0.7}
                  >
                    <View style={styles.pickerRowInfo}>
                      <AppText style={styles.pickerRowName}>{l.nameEn}</AppText>
                      <AppText style={styles.pickerRowSku}>{l.code}</AppText>
                    </View>
                    {String(selectedLocation?.id) === String(l.id)
                      ? <Icon name="check-circle" size={20} color={Colors.primary} />
                      : <Icon name="chevron-right" size={18} color={Colors.textLight} />}
                  </TouchableOpacity>
                )}
                keyboardShouldPersistTaps="handled"
                ListEmptyComponent={<AppText style={styles.pickerEmpty}>No locations found</AppText>}
              />
            )}
          </View>
        </Modal>

        {/* Category picker modal */}
        <Modal visible={categoryPickerVisible} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setCategoryPickerVisible(false)}>
          <View style={styles.pickerModal}>
            <View style={styles.pickerHeader}>
              <AppText style={styles.pickerTitle}>Select Category</AppText>
              <TouchableOpacity onPress={() => setCategoryPickerVisible(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Icon name="close" size={22} color={Colors.text} />
              </TouchableOpacity>
            </View>
            {selectedVendor && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 8, backgroundColor: '#EFF6FF', borderBottomWidth: 1, borderBottomColor: Colors.divider }}>
                <Icon name="store" size={14} color={Colors.primary} />
                <AppText style={{ fontSize: 12, color: Colors.primary, fontWeight: '600' }} numberOfLines={1}>
                  {selectedVendor.nameEn ?? selectedVendor.code}
                </AppText>
              </View>
            )}
            <View style={styles.pickerSearch}>
              <Icon name="search" size={18} color={Colors.textSecondary} />
              <TextInput
                style={styles.pickerSearchInput}
                value={categorySearch}
                onChangeText={setCategorySearch}
                placeholder="Search category…"
                placeholderTextColor={Colors.textLight}
                autoFocus
                autoCorrect={false}
              />
            </View>
            {categoriesLoading ? (
              <ActivityIndicator style={{ marginTop: 32 }} color={Colors.primary} />
            ) : (
              <FlatList
                data={filteredCategorySearch}
                keyExtractor={c => String(c.id)}
                renderItem={({ item: c }) => {
                  const count = products.filter(p =>
                    p.vendorId != null && selectedVendor && Number(p.vendorId) === Number(selectedVendor.id) &&
                    String(p.categoryId) === String(c.id),
                  ).length;
                  return (
                    <TouchableOpacity
                      style={[styles.pickerRow, selectedCategory?.id === c.id && styles.pickerRowSelected]}
                      onPress={() => {
                        setSelectedCategory(c);
                        setCategoryPickerVisible(false);
                      }}
                      activeOpacity={0.7}
                    >
                      <View style={styles.pickerRowInfo}>
                        <AppText style={styles.pickerRowName}>{c.nameEn}</AppText>
                        {c.nameKm ? <AppText style={styles.pickerRowSku}>{c.nameKm}</AppText> : null}
                      </View>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        {count > 0 && (
                          <View style={{ backgroundColor: '#EFF6FF', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 }}>
                            <AppText style={{ fontSize: 11, color: Colors.primary, fontWeight: '700' }}>{count} item{count !== 1 ? 's' : ''}</AppText>
                          </View>
                        )}
                        {selectedCategory?.id === c.id
                          ? <Icon name="check-circle" size={20} color={Colors.primary} />
                          : <Icon name="chevron-right" size={18} color={Colors.textLight} />}
                      </View>
                    </TouchableOpacity>
                  );
                }}
                keyboardShouldPersistTaps="handled"
                ListEmptyComponent={<AppText style={styles.pickerEmpty}>No categories found</AppText>}
              />
            )}
          </View>
        </Modal>

        {/* Product picker modal */}
        <Modal visible={pickerVisible} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setPickerVisible(false)}>
          <View style={styles.pickerModal}>
            <View style={styles.pickerHeader}>
              <AppText style={styles.pickerTitle}>Select Product</AppText>
              <TouchableOpacity onPress={() => setPickerVisible(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Icon name="close" size={22} color={Colors.text} />
              </TouchableOpacity>
            </View>

            {/* Vendor badge */}
            {selectedVendor && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 8, backgroundColor: '#EFF6FF', borderBottomWidth: 1, borderBottomColor: Colors.divider }}>
                <Icon name="store" size={14} color={Colors.primary} />
                <AppText style={{ fontSize: 12, color: Colors.primary, fontWeight: '700', flex: 1 }} numberOfLines={1}>
                  {selectedVendor.nameEn ?? selectedVendor.code} — vendor products only
                </AppText>
                <AppText style={{ fontSize: 11, color: Colors.textSecondary }}>{filteredProducts.length} item{filteredProducts.length !== 1 ? 's' : ''}</AppText>
              </View>
            )}

            {/* Category chips */}
            {pickerCategories.length > 0 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ height: 10, borderBottomWidth: 1, borderBottomColor: Colors.divider }} contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 0, gap: 6, flexDirection: 'row', alignItems: 'center' }}>
                <TouchableOpacity
                  style={{ paddingHorizontal: 12, paddingVertical: 5, borderRadius: 16, backgroundColor: pickerCategoryId === null ? Colors.primary : Colors.background, borderWidth: 1, borderColor: pickerCategoryId === null ? Colors.primary : Colors.divider }}
                  onPress={() => setPickerCategoryId(null)}
                >
                  <AppText style={{ fontSize: 12, fontWeight: '600', color: pickerCategoryId === null ? '#fff' : Colors.textSecondary }}>All</AppText>
                </TouchableOpacity>
                {pickerCategories.map(c => (
                  <TouchableOpacity
                    key={c.id}
                    style={{ paddingHorizontal: 12, paddingVertical: 5, borderRadius: 16, backgroundColor: pickerCategoryId === c.id ? Colors.primary : Colors.background, borderWidth: 1, borderColor: pickerCategoryId === c.id ? Colors.primary : Colors.divider }}
                    onPress={() => setPickerCategoryId(c.id)}
                  >
                    <AppText style={{ fontSize: 12, fontWeight: '600', color: pickerCategoryId === c.id ? '#fff' : Colors.textSecondary }}>{c.nameEn}</AppText>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}

            <View style={styles.pickerSearch}>
              <Icon name="search" size={18} color={Colors.textSecondary} />
              <TextInput
                style={styles.pickerSearchInput}
                value={pickerSearch}
                onChangeText={setPickerSearch}
                placeholder="Search by name or SKU…"
                placeholderTextColor={Colors.textLight}
                autoFocus
                autoCorrect={false}
              />
            </View>
            {productsLoading ? (
              <ActivityIndicator style={{ marginTop: 32 }} color={Colors.primary} />
            ) : (
              <FlatList
                data={filteredProducts}
                keyExtractor={p => String(p.id)}
                renderItem={({ item: p }) => (
                  <TouchableOpacity style={styles.pickerRow} onPress={() => selectProduct(p)} activeOpacity={0.7}>
                    <View style={styles.pickerRowInfo}>
                      <AppText style={styles.pickerRowName} numberOfLines={1}>{p.nameEn ?? String(p.id)}</AppText>
                      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        {p.sku ? <AppText style={styles.pickerRowSku}>{p.sku}</AppText> : null}
                        {p.costPriceCents ? <AppText style={{ fontSize: 11, color: '#059669', fontWeight: '600' }}>${(Number(p.costPriceCents) / 100).toFixed(2)}</AppText> : null}
                      </View>
                    </View>
                    <Icon name="chevron-right" size={18} color={Colors.textLight} />
                  </TouchableOpacity>
                )}
                keyboardShouldPersistTaps="handled"
                refreshControl={
                  <RefreshControl
                    refreshing={refreshingProducts}
                    onRefresh={refreshProducts}
                    colors={[Colors.primary]}
                    tintColor={Colors.primary}
                  />
                }
                ListEmptyComponent={
                  <View style={{ alignItems: 'center', paddingTop: 40, gap: 8 }}>
                    <Icon name="inventory-2" size={36} color={Colors.textLight} />
                    <AppText style={styles.pickerEmpty}>
                      {selectedVendor ? `No products found for ${selectedVendor.nameEn ?? selectedVendor.code}` : 'No products found'}
                    </AppText>
                  </View>
                }
              />
            )}
          </View>
        </Modal>

        {/* ── PO Confirmation Modal ──────────────────────────────────────────── */}
        <Modal visible={poConfirmVisible} transparent animationType="fade" onRequestClose={() => setPoConfirmVisible(false)}>
          <View style={poConfirmStyles.overlay}>
            <TouchableOpacity style={StyleSheet.absoluteFillObject} activeOpacity={1} onPress={() => setPoConfirmVisible(false)} />
            <View style={poConfirmStyles.card}>
              <View style={poConfirmStyles.lottieWrap}>
                <LottieView
                  source={require('../../assets/animations/invoice-confirm.json')}
                  autoPlay
                  loop
                  style={poConfirmStyles.lottie}
                />
              </View>
              <AppText style={poConfirmStyles.title}>
                {editingPO ? 'Save Changes?' : 'Confirm Purchase Order'}
              </AppText>
              <AppText style={poConfirmStyles.message}>
                {selectedVendor?.nameEn ?? selectedVendor?.code}
                {selectedLocation ? `  ·  ${selectedLocation.nameEn}` : ''}
                {poConfirmPayload ? `\n${poConfirmPayload.items.length} item${poConfirmPayload.items.length !== 1 ? 's' : ''}  ·  $${poConfirmPayload.totalAmt.toFixed(2)}` : ''}
              </AppText>
              <View style={poConfirmStyles.divider} />
              <View style={poConfirmStyles.btnRow}>
                <TouchableOpacity style={poConfirmStyles.cancelBtn} onPress={() => setPoConfirmVisible(false)} activeOpacity={0.7}>
                  <AppText style={poConfirmStyles.cancelText}>Cancel</AppText>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[poConfirmStyles.okBtn, { backgroundColor: editingPO ? Colors.primary : '#059669' }]}
                  onPress={doSubmitConfirmed}
                  disabled={formSubmitting}
                  activeOpacity={0.85}
                >
                  {formSubmitting
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <AppText style={poConfirmStyles.okText}>{editingPO ? 'Save' : 'Create'}</AppText>}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        <DatePickerModal
          visible={poDraftDatePicker}
          value={poDate}
          onChange={d => { setPoDate(d); setPoDraftDatePicker(false); }}
          onClose={() => setPoDraftDatePicker(false)}
        />
      </View>
    );
  }

  // ── Preview view ─────────────────────────────────────────────────────────────
  if (screenView === 'preview' && previewingPO) {
    const po = previewingPO;
    const vendorFromList = vendors.find(v => String(v.id) === String(po.vendorId));
    const supplierName = po.vendorName ?? po.vendor?.nameEn ?? po.vendor?.nameKm ?? po.supplierOrg?.nameEn ?? po.supplierOrg?.name ?? vendorFromList?.nameEn ?? vendorFromList?.code ?? '—';
    const location = po.location?.nameEn ?? `Location #${po.locationId ?? '—'}`;
    const items = po.items ?? [];
    const subtotalCents = items.reduce((s, i) => s + Number(i.qty) * Number(i.unitPriceCents), 0);
    const discountCents = items.reduce((s, i) => s + (Number(i.discountCents) || 0), 0);
    const grandCents = subtotalCents - discountCents;


    const hasDiscount = items.some(it => (Number(it.discountCents) || 0) > 0);
    const s = STATUS[po.status] ?? STATUS.DRAFT;

    return (
      <View style={styles.safe}>
        <AppBar
          title="Preview PO"
          subtitle={po.poNumber}
          titleAlign="left"
          showBack
          onBack={() => setScreenView('list')}
        />

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 12, paddingBottom: 24 }}>
          {previewLoading && (
            <View style={{ alignItems: 'center', paddingVertical: 12 }}>
              <ActivityIndicator color={Colors.primary} />
            </View>
          )}

          {/* Document page */}
          <View style={pvStyles.page}>

            {/* ── Header ── */}
            <View style={pvStyles.hdr}>
              <Image source={{ uri: LOGO_BASE64 }} style={pvStyles.logo} />
              <View style={pvStyles.hdrCenter}>
                <AppText style={pvStyles.coName}>FOCUS LAB</AppText>
                <AppText style={pvStyles.coAddr}>
                  {'#17 St 480, Sangkat Toul Toum Pong 1\nKhan Chamkarmon, Phnom Penh 12310'}
                </AppText>
                <AppText style={pvStyles.docTitle}>PURCHASE ORDER</AppText>
              </View>
            </View>

            <View style={pvStyles.hr} />

            {/* ── Info row ── */}
            <View style={pvStyles.infoRow}>
              <View style={pvStyles.infoBox}>
                <AppText style={pvStyles.infoLine}><AppText style={pvStyles.infoBold}>Vendor: </AppText>{supplierName}</AppText>
                {previewVendor?.phone ? <AppText style={pvStyles.infoLine}><AppText style={pvStyles.infoBold}>Phone: </AppText>{previewVendor.phone}</AppText> : null}
                {previewVendor?.address ? <AppText style={pvStyles.infoLine}><AppText style={pvStyles.infoBold}>Address: </AppText>{previewVendor.address}</AppText> : null}
              </View>
              <View style={[pvStyles.infoBox, pvStyles.infoBoxBorderLeft]}>
                <AppText style={pvStyles.infoLine}><AppText style={pvStyles.infoBold}>No: </AppText>{po.poNumber}</AppText>
                <AppText style={pvStyles.infoLine}><AppText style={pvStyles.infoBold}>Date: </AppText>{fmtDate(po.createdAt)}</AppText>
                <AppText style={pvStyles.infoLine}>
                  <AppText style={pvStyles.infoBold}>Status: </AppText>
                  <AppText style={{ color: s.color, fontSize: 7 }}>{s.label}</AppText>
                </AppText>
                {po.receiptNote ? <AppText style={pvStyles.infoLine}><AppText style={pvStyles.infoBold}>No: </AppText>{po.receiptNote}</AppText> : null}
              </View>
            </View>

            {/* ── Items table ── */}
            <View style={pvStyles.tblWrap}>
              {/* Table header */}
              <View style={[pvStyles.tr, pvStyles.tHead]}>
                <AppText style={[pvStyles.th, { width: 24 }]}>No</AppText>
                <AppText style={[pvStyles.th, { width: 60, textAlign: 'left' }]}>Barcode</AppText>
                <AppText style={[pvStyles.th, { flex: 1, textAlign: 'left' }]}>Name</AppText>
                <AppText style={[pvStyles.th, { width: 36 }]}>Size</AppText>
                <AppText style={[pvStyles.th, { width: 28 }]}>Qty</AppText>
                <AppText style={[pvStyles.th, { width: 58 }]}>Price</AppText>
                {hasDiscount && <AppText style={[pvStyles.th, { width: 36 }]}>Disc</AppText>}
                <AppText style={[pvStyles.th, { width: 60, borderRightWidth: 0 }]}>Amount</AppText>
              </View>
              {/* Data rows */}
              {items.map((it, i) => {
                const nameKm = it.productNameKm ?? '';
                const nameEn = it.productNameEn ?? it.productName ?? '';
                const discNum = Number(it.discountCents) || 0;
                const total = Number(it.qty) * Number(it.unitPriceCents) - discNum;
                const rawDiscPct = discNum && it.qty && it.unitPriceCents
                  ? (discNum / (Number(it.qty) * Number(it.unitPriceCents))) * 100
                  : 0;
                const discPct = rawDiscPct > 0 ? parseFloat(rawDiscPct.toFixed(2)) : null;
                return (
                  <View key={it.id} style={[pvStyles.tr, i % 2 === 1 && { backgroundColor: '#FAFAFA' }]}>
                    <View style={[pvStyles.td, { width: 24, alignItems: 'center' }]}>
                      <View style={pvStyles.noBadge}><AppText style={pvStyles.noBadgeText}>{i + 1}</AppText></View>
                    </View>
                    <AppText style={[pvStyles.td, { width: 60 }]} numberOfLines={1}>{it.productSku ?? '—'}</AppText>
                    <AppText style={[pvStyles.td, { flex: 1 }]} numberOfLines={1}>
                      {nameKm && nameEn ? `${nameKm} - ${nameEn}` : nameKm || nameEn || '—'}
                    </AppText>
                    <AppText style={[pvStyles.td, { width: 36, textAlign: 'center' }]}>
                      {products.find(p => String(p.id) === String(it.productId))?.size ?? it.size ?? '—'}
                    </AppText>
                    <AppText style={[pvStyles.td, { width: 28, textAlign: 'center' }]}>{it.qty}</AppText>
                    <AppText style={[pvStyles.td, { width: 58, textAlign: 'right' }]}>${Number(it.unitPriceCents).toFixed(4)}</AppText>
                    {hasDiscount && (
                      <AppText style={[pvStyles.td, { width: 36, textAlign: 'center' }]}>
                        {discPct != null && discPct > 0 ? `${discPct}%` : '—'}
                      </AppText>
                    )}
                    <AppText style={[pvStyles.td, { width: 60, textAlign: 'right', borderRightWidth: 0 }]}>
                      ${Number(total).toFixed(4)}
                    </AppText>
                  </View>
                );
              })}
              {Array.from({ length: Math.max(0, 20 - items.length) }).map((_, fi) => (
                <View key={`filler-${fi}`} style={[pvStyles.tr, pvStyles.fillerRow]}>
                  <View style={[pvStyles.td, { width: 24 }]} />
                  <AppText style={[pvStyles.td, { width: 60 }]}> </AppText>
                  <AppText style={[pvStyles.td, { flex: 1 }]}> </AppText>
                  <AppText style={[pvStyles.td, { width: 36 }]}> </AppText>
                  <AppText style={[pvStyles.td, { width: 28 }]}> </AppText>
                  <AppText style={[pvStyles.td, { width: 58 }]}> </AppText>
                  {hasDiscount && <AppText style={[pvStyles.td, { width: 36 }]}> </AppText>}
                  <AppText style={[pvStyles.td, { width: 60, borderRightWidth: 0 }]}> </AppText>
                </View>
              ))}
            </View>

            {/* ── Totals ── */}
            <View style={pvStyles.totalsWrap}>
              <View style={pvStyles.totalLine}>
                <AppText style={pvStyles.totalLbl}>Sub Total</AppText>
                <AppText style={pvStyles.totalVal}>${subtotalCents.toFixed(4)}</AppText>
              </View>
              {hasDiscount && (
                <View style={pvStyles.totalLine}>
                  <AppText style={pvStyles.totalLbl}>Discount</AppText>
                  <AppText style={[pvStyles.totalVal, { color: '#E53E3E' }]}>- ${discountCents.toFixed(4)}</AppText>
                </View>
              )}
              <View style={[pvStyles.totalLine, pvStyles.grandLine]}>
                <AppText style={pvStyles.grandLbl}>Grand Total</AppText>
                <AppText style={pvStyles.grandVal}>${Number(grandCents).toFixed(4)}</AppText>
              </View>
            </View>

          </View>
        </ScrollView>

        {/* ── Signature footer (fixed above Print button) ── */}
        <View style={pvStyles.sigFooter}>
          <AppText style={pvStyles.sigFooterTitle}>Signatures</AppText>
          <View style={pvStyles.sigSection}>
            {['Prepared By', 'Approved By', 'Received By'].map((label, i) => (
              <View key={label} style={[pvStyles.sigCol, i > 0 && pvStyles.sigColBorder]}>
                <View style={pvStyles.sigLine} />
                <AppText style={pvStyles.sigLabel}>{label}</AppText>
              </View>
            ))}
          </View>
        </View>

        {/* Bottom action bar */}
        <View style={[styles.formBar, { flexDirection: 'row', gap: 10 }]}>
          {(po.status === 'DRAFT' || po.status === 'APPROVED' || po.status === 'SENT') && (
            <TouchableOpacity
              style={[styles.submitBtn, { backgroundColor: Colors.primary, flex: 1 }]}
              onPress={() => openEdit(po)}
              activeOpacity={0.85}
            >
              <Icon name="edit" size={20} color="#fff" />
              <AppText style={styles.submitBtnText}>Edit PO</AppText>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[styles.submitBtn, { backgroundColor: '#374151', flex: 1 }, printLoading && styles.submitBtnDisabled]}
            onPress={() => previewSinglePO(po)}
            disabled={printLoading}
            activeOpacity={0.85}
          >
            {printLoading
              ? <ActivityIndicator size="small" color="#fff" />
              : <Icon name="print" size={20} color="#fff" />}
            <AppText style={styles.submitBtnText}>Print / PDF</AppText>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── List view ────────────────────────────────────────────────────────────────
  const canExport = selectedIds.size > 0;
  const subtitle = selectedIds.size > 0
    ? `${selectedIds.size} selected`
    : tab !== 'ALL' || appliedFilters.poNumber || appliedFilters.vendorId
    ? `${filteredPos.length} of ${totalCount} orders`
    : totalCount > 0
    ? `${totalCount} order${totalCount !== 1 ? 's' : ''}`
    : 'Purchase orders';

  const headerRight = (
    <TouchableOpacity
      style={[styles.headerPdfBtn, !canExport && styles.headerPdfBtnDisabled]}
      onPress={handleExportPDF}
      disabled={exporting || !canExport}
      activeOpacity={0.75}
    >
      {exporting
        ? <ActivityIndicator size="small" color="#FFFFFF" />
        : <Icon name="picture-as-pdf" size={19} color="#FFFFFF" />}
      <AppText style={styles.headerPdfText}>PDF</AppText>
      {canExport && (
        <View style={styles.headerBadge}>
          <AppText style={styles.headerBadgeText}>{selectedIds.size}</AppText>
        </View>
      )}
    </TouchableOpacity>
  );

  return (
    <View style={styles.safe}>
      <AppBar
        title="Purchase Orders"
        subtitle={subtitle}
        titleAlign="left"
        showBack
        onBack={onBack}
        rightActions={headerRight}
      />

      {/* ── Filter bar ─────────────────────────────────────────────────────── */}
      <View style={styles.filterBar}>
        {/* PO Number input */}
        <View style={styles.filterInputRow}>
          <Icon name="receipt" size={16} color={Colors.textSecondary} />
          <TextInput
            style={styles.filterTextInput}
            value={poNumberInput}
            onChangeText={setPoNumberInput}
            placeholder="PO number…"
            placeholderTextColor={Colors.textLight}
            returnKeyType="search"
            onSubmitEditing={() => doFilter()}
          />
          {poNumberInput ? (
            <TouchableOpacity onPress={() => setPoNumberInput('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Icon name="close" size={16} color={Colors.textSecondary} />
            </TouchableOpacity>
          ) : null}
        </View>

        {/* Vendor selector */}
        <View style={styles.filterSelectRow}>
          <TouchableOpacity style={styles.filterSelectBtn} onPress={() => { ensureVendors(); setShowFilterVendorModal(true); }} activeOpacity={0.75}>
            <Icon name="store" size={15} color={filterVendor ? Colors.primary : Colors.textSecondary} />
            <AppText style={[styles.filterSelectText, filterVendor && styles.filterSelectTextActive]} numberOfLines={1}>
              {filterVendor ? (filterVendor.nameEn ?? filterVendor.nameKm ?? '—') : 'All Vendors'}
            </AppText>
            {filterVendor
              ? <TouchableOpacity onPress={() => setFilterVendor(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}><Icon name="close" size={14} color={Colors.primary} /></TouchableOpacity>
              : <Icon name="expand-more" size={18} color={Colors.textSecondary} />}
          </TouchableOpacity>
        </View>

        {/* Date range */}
        <View style={styles.filterSelectRow}>
          <TouchableOpacity style={styles.filterDateBtn} onPress={() => setDatePicker('from')} activeOpacity={0.75}>
            <Icon name="calendar-today" size={14} color={Colors.primary} />
            <AppText style={styles.filterDateText}>{fmtDate(toISO(fromDate))}</AppText>
          </TouchableOpacity>
          <AppText style={styles.filterDateSep}>→</AppText>
          <TouchableOpacity style={styles.filterDateBtn} onPress={() => setDatePicker('to')} activeOpacity={0.75}>
            <Icon name="calendar-today" size={14} color={Colors.primary} />
            <AppText style={styles.filterDateText}>{fmtDate(toISO(toDate))}</AppText>
          </TouchableOpacity>
        </View>

        {/* Filter button */}
        <TouchableOpacity style={styles.filterBtn} onPress={() => doFilter()} activeOpacity={0.85} disabled={loading}>
          {loading
            ? <ActivityIndicator size="small" color="#fff" />
            : <><Icon name="search" size={18} color="#fff" /><AppText style={styles.filterBtnText}>Filter</AppText></>}
        </TouchableOpacity>
      </View>

      {/* Status tabs */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabScroll} contentContainerStyle={styles.tabContent}>
        {TABS.map(t => {
          const count = tabCounts[t.key] ?? 0;
          const active = tab === t.key;
          return (
            <TouchableOpacity
              key={t.key}
              style={[styles.tab, active && styles.tabActive]}
              onPress={() => {
                setTab(t.key);
                const newFilters = {
                  poNumber: poNumberInput.trim() || undefined,
                  vendorId: filterVendor ? Number(filterVendor.id) : undefined,
                  from: toISO(fromDate),
                  to: toISO(toDate),
                  status: t.key !== 'ALL' ? t.key : undefined,
                };
                setAppliedFilters(newFilters);
                load(false, newFilters);
              }}
              activeOpacity={0.75}
            >
              <AppText style={[styles.tabLabel, active && styles.tabLabelActive]}>{t.label}</AppText>
              {count > 0 ? (
                <View style={[styles.tabBadge, active && styles.tabBadgeActive]}>
                  <AppText style={[styles.tabBadgeText, active && styles.tabBadgeTextActive]}>{count}</AppText>
                </View>
              ) : null}
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <View style={styles.listArea}>
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={Colors.primary} />
          </View>
        ) : error ? (
          <View style={styles.center}>
            <Icon name="error-outline" size={48} color={Colors.textLight} />
            <AppText style={styles.centerMsg}>{error}</AppText>
            <TouchableOpacity style={styles.retryBtn} onPress={() => load()}>
              <AppText style={styles.retryText}>Retry</AppText>
            </TouchableOpacity>
          </View>
        ) : (
          <FlatList
            data={filteredPos}
            keyExtractor={item => item.id}
            renderItem={renderCard}
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(true); }} tintColor={Colors.primary} />}
            onEndReached={loadMore}
            onEndReachedThreshold={0.3}
            ListFooterComponent={loadingMore ? (
              <View style={{ paddingVertical: 16, alignItems: 'center' }}>
                <ActivityIndicator size="small" color={Colors.primary} />
              </View>
            ) : null}
            ListEmptyComponent={
              <View style={styles.center}>
                <Icon name="shopping-bag" size={48} color={Colors.textLight} />
                <AppText style={styles.centerMsg}>
                  {tab === 'ALL' ? 'No purchase orders found' : `No ${tab.toLowerCase()} orders`}
                </AppText>
              </View>
            }
          />
        )}
      </View>

      {/* Summary card */}
      {!loading && !error && (
        <View style={styles.summaryCard}>
          <View style={styles.summaryItem}>
            <View style={[styles.summaryDot, { backgroundColor: '#2563EB' }]} />
            <View style={styles.summaryTexts}>
              <AppText style={styles.summaryLabel}>Approved</AppText>
              <AppText style={[styles.summaryAmount, { color: '#2563EB' }]}>${summary.approved.toFixed(2)}</AppText>
            </View>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryItem}>
            <View style={[styles.summaryDot, { backgroundColor: '#06B6D4' }]} />
            <View style={styles.summaryTexts}>
              <AppText style={styles.summaryLabel}>Sent</AppText>
              <AppText style={[styles.summaryAmount, { color: '#06B6D4' }]}>${summary.sent.toFixed(2)}</AppText>
            </View>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryItem}>
            <View style={[styles.summaryDot, { backgroundColor: Colors.text }]} />
            <View style={styles.summaryTexts}>
              <AppText style={styles.summaryLabel}>Total</AppText>
              <AppText style={[styles.summaryAmount, { color: Colors.text }]}>${summary.grandTotal.toFixed(2)}</AppText>
            </View>
          </View>
        </View>
      )}

      {/* FAB */}
      <TouchableOpacity style={styles.fab} onPress={openCreate} activeOpacity={0.85}>
        <Icon name="add" size={28} color="#fff" />
      </TouchableOpacity>

      {/* ── Image centered preview ────────────────────────────────────────────── */}
      <Modal
        visible={!!expandedPreviewUrl}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setExpandedPreviewUrl(null)}
      >
        <View style={{ flex: 1, backgroundColor: '#000' }}>
          {expandedPreviewUrl ? (
            <Image
              source={{ uri: expandedPreviewUrl }}
              style={{ flex: 1, width: '100%' }}
              resizeMode="contain"
            />
          ) : null}
          <TouchableOpacity
            onPress={() => setExpandedPreviewUrl(null)}
            style={{ position: 'absolute', top: 52, right: 16, width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' }}
          >
            <Icon name="close" size={22} color="#fff" />
          </TouchableOpacity>
        </View>
      </Modal>

      {/* ── Detail Modal ─────────────────────────────────────────────────────── */}
      <Modal
        visible={!!detailPO}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => confirmDialog ? setConfirmDialog(null) : closeDetail()}
      >
        {detailPO ? (() => {
          const s = STATUS[detailPO.status] ?? STATUS.DRAFT;
          const supplier = detailPO.vendorName ?? detailPO.vendor?.nameEn ?? detailPO.vendor?.nameKm ?? detailPO.supplierOrg?.nameEn ?? detailPO.supplierOrg?.name ?? '—';
          const items = detailPO.items ?? [];
          const isDraft = detailPO.status === 'DRAFT';
          const isApproved = detailPO.status === 'APPROVED';
          const isSent = detailPO.status === 'SENT';
          const isReceived = detailPO.status === 'RECEIVED';
          const isBilled = detailPO.status === 'BILLED' || detailPO.status === 'PARTIAL';
          const hasBill = !!(detailPO.billNo || detailPO.billTotalCents);
          const canBill = isReceived && !hasBill;
          const canCancel = isDraft || isApproved;

          return (
            <View style={{ flex: 1 }}>
            <KeyboardAvoidingView
              style={styles.safe}
              behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            >
              <AppBar
                title={detailPO.poNumber}
                subtitle={s.label}
                titleAlign="left"
                showBack
                onBack={closeDetail}
              />
              <ScrollView style={styles.detailScroll} contentContainerStyle={{ paddingBottom: 40 }}>

                {/* Status + supplier */}
                <View style={styles.detailCard}>
                  <View style={styles.detailRow}>
                    <View style={[styles.statusBadgeLg, { backgroundColor: s.bg }]}>
                      <Icon name={s.icon} size={14} color={s.color} />
                      <AppText style={[styles.statusTextLg, { color: s.color }]}>{s.label}</AppText>
                    </View>
                    {(isDraft || isApproved || isSent) ? (
                      <TouchableOpacity style={styles.editPoBtn} onPress={() => openEdit(detailPO)}>
                        <Icon name="edit" size={14} color={Colors.primary} />
                        <AppText style={styles.editPoBtnText}>Edit</AppText>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                  <View style={styles.detailInfoGrid}>
                    <View style={styles.detailInfoItem}>
                      <AppText style={styles.detailInfoLabel}>Supplier</AppText>
                      <AppText style={styles.detailInfoVal} numberOfLines={2}>{supplier}</AppText>
                    </View>
                    <View style={styles.detailInfoItem}>
                      <AppText style={styles.detailInfoLabel}>Created</AppText>
                      <AppText style={styles.detailInfoVal}>{fmtDate(detailPO.createdAt)}</AppText>
                    </View>
                    {detailPO.approvedAt ? (
                      <View style={styles.detailInfoItem}>
                        <AppText style={styles.detailInfoLabel}>Approved</AppText>
                        <AppText style={styles.detailInfoVal}>{fmtDate(detailPO.approvedAt)}</AppText>
                      </View>
                    ) : null}
                    {detailPO.receivedAt ? (
                      <View style={styles.detailInfoItem}>
                        <AppText style={styles.detailInfoLabel}>Received</AppText>
                        <AppText style={styles.detailInfoVal}>{fmtDate(detailPO.receivedAt)}</AppText>
                      </View>
                    ) : null}
                    {detailPO.billNo ? (
                      <View style={styles.detailInfoItem}>
                        <AppText style={styles.detailInfoLabel}>Bill No</AppText>
                        <AppText style={styles.detailInfoVal}>{detailPO.billNo}</AppText>
                      </View>
                    ) : null}
                    {detailPO.billDueAt ? (
                      <View style={styles.detailInfoItem}>
                        <AppText style={styles.detailInfoLabel}>Bill Due</AppText>
                        <AppText style={styles.detailInfoVal}>{fmtDate(detailPO.billDueAt)}</AppText>
                      </View>
                    ) : null}
                    {detailPO.paidAt ? (
                      <View style={styles.detailInfoItem}>
                        <AppText style={styles.detailInfoLabel}>Paid</AppText>
                        <AppText style={styles.detailInfoVal}>{fmtDate(detailPO.paidAt)}</AppText>
                      </View>
                    ) : null}
                    {detailPO.paymentMethod ? (
                      <View style={styles.detailInfoItem}>
                        <AppText style={styles.detailInfoLabel}>Method</AppText>
                        <AppText style={styles.detailInfoVal}>{detailPO.paymentMethod}</AppText>
                      </View>
                    ) : null}
                  </View>
                </View>

                {/* Items */}
                {detailLoading ? (
                  <ActivityIndicator style={{ marginVertical: 20 }} color={Colors.primary} />
                ) : items.length > 0 ? (
                  <View style={styles.itemsCard}>
                    <AppText style={styles.sectionLabel}>Items ({items.length})</AppText>
                    {/* Table header */}
                    <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#EFF6FF', borderRadius: 6, paddingVertical: 6, paddingHorizontal: 8, marginBottom: 2 }}>
                      <AppText style={{ width: 24, fontSize: 10, fontWeight: '700', color: Colors.primary, textAlign: 'center' }}>#</AppText>
                      <AppText style={{ flex: 1, fontSize: 10, fontWeight: '700', color: Colors.primary }}>Product</AppText>
                      <AppText style={{ width: 36, fontSize: 10, fontWeight: '700', color: Colors.primary, textAlign: 'center' }}>Qty</AppText>
                      <AppText style={{ width: 64, fontSize: 10, fontWeight: '700', color: Colors.primary, textAlign: 'right' }}>Price</AppText>
                      <AppText style={{ width: 64, fontSize: 10, fontWeight: '700', color: Colors.primary, textAlign: 'right' }}>Total</AppText>
                    </View>
                    {items.map((it, i) => {
                      const total = it.qty * Number(it.unitPriceCents) - (Number(it.discountCents) || 0);
                      const nameKm = (it as any).productNameKm ?? (it as any).productNameKh ?? '';
                      const nameEn = it.productNameEn ?? it.productName ?? '';
                      const discPct = Number(it.discountCents) > 0 && it.qty && it.unitPriceCents
                        ? parseFloat(((Number(it.discountCents) / (it.qty * Number(it.unitPriceCents))) * 100).toFixed(2))
                        : 0;
                      return (
                        <View
                          key={it.id}
                          style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 8, backgroundColor: i % 2 === 0 ? '#F8FAFF' : '#FFFFFF', borderRadius: 6 }}
                        >
                          <AppText style={{ width: 24, fontSize: 11, fontWeight: '700', color: Colors.primary, textAlign: 'center' }}>{i + 1}</AppText>
                          <View style={{ flex: 1, paddingRight: 4 }}>
                            {nameKm ? <AppText style={{ fontSize: 12, fontWeight: '700', color: Colors.text }} numberOfLines={1}>{nameKm}</AppText> : null}
                            <AppText style={{ fontSize: 11, color: Colors.textSecondary }} numberOfLines={1}>{nameEn || '—'}</AppText>
                            {it.productSku ? <AppText style={{ fontSize: 10, color: Colors.primary, marginTop: 1 }}>{it.productSku}</AppText> : null}
                            {discPct > 0 ? <AppText style={{ fontSize: 10, color: '#D97706', marginTop: 1 }}>Disc {discPct}%</AppText> : null}
                            {it.qtyReceived != null ? <AppText style={{ fontSize: 10, color: '#10B981', marginTop: 1 }}>{it.qtyReceived} rcvd</AppText> : null}
                          </View>
                          <AppText style={{ width: 30, fontSize: 12, fontWeight: '600', color: Colors.text, textAlign: 'center' }}>{it.qty}</AppText>
                          <AppText style={{ width: 80, fontSize: 11, color: Colors.textSecondary, textAlign: 'right' }}>${Number(it.unitPriceCents).toFixed(4)}</AppText>
                          <AppText style={{ width: 80, fontSize: 13, fontWeight: '800', color: Colors.primary, textAlign: 'right' }}>${total.toFixed(4)}</AppText>
                        </View>
                      );
                    })}
                    {/* Table footer — subtotal */}
                    <View style={{ borderTopWidth: 1, borderTopColor: Colors.divider, marginTop: 4, paddingTop: 8, paddingHorizontal: 8, flexDirection: 'row', justifyContent: 'flex-end', gap: 8, alignItems: 'center' }}>
                      <AppText style={{ fontSize: 18, fontWeight: '600', color: Colors.textSecondary }} numberOfLines={1}>Subtotal</AppText>
                      <AppText style={{ fontSize: 22, fontWeight: '800', color: Colors.primary, flexShrink: 1, textAlign: 'right' }} numberOfLines={1}>
                        {`$${(Number(detailPO?.totalCents ?? 0) / 100).toFixed(4)}`}
                      </AppText>
                    </View>
                  </View>
                ) : null}

              </ScrollView>

              {/* Signature — outside ScrollView to prevent draw/scroll conflict */}
              <View style={{ backgroundColor: Colors.surface, borderTopWidth: 1, borderTopColor: Colors.divider, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 16 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Icon name="draw" size={16} color={Colors.primary} />
                    <AppText style={{ fontSize: 13, fontWeight: '700', color: Colors.text }}>Signature</AppText>
                  </View>
                  <TouchableOpacity onPress={() => { sigRef.current?.clear(); setSigEmpty(true); }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <AppText style={{ fontSize: 12, color: Colors.textSecondary }}>Clear</AppText>
                  </TouchableOpacity>
                </View>
                <View style={{ height: 250, borderRadius: 12, borderWidth: 1.5, borderColor: Colors.divider, borderStyle: 'dashed', backgroundColor: '#FAFAFA', overflow: 'hidden' }}>
                  <SignaturePad ref={sigRef} style={{ flex: 1 }} onDrawEnd={() => setSigEmpty(false)} />
                </View>
              </View>

              {/* ── Actions card — below signature ──────────────────────────── */}
              <ScrollView style={{ flex: 1, borderTopWidth: 1, borderTopColor: Colors.divider }} contentContainerStyle={{ padding: 14, paddingBottom: 120 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                <AppText style={styles.sectionLabel}>Actions</AppText>
                <View style={styles.actionBtns}>
                  {isDraft ? (
                    <View style={{ flexDirection: 'column', gap: 8, width: '100%' }}>
                      <TouchableOpacity
                        style={[styles.actionBtn, { backgroundColor: sigEmpty ? '#E5E7EB' : '#D1FAE5', width: '100%', justifyContent: 'center', opacity: (actionSubmitting || sigSaving || sigEmpty) ? 0.5 : 1 }]}
                        onPress={doApproveWithSignature}
                        disabled={actionSubmitting || sigSaving || sigEmpty}
                      >
                        <Icon name="thumb-up" size={16} color={sigEmpty ? '#9CA3AF' : '#059669'} />
                        <AppText style={[styles.actionBtnText, { color: sigEmpty ? '#9CA3AF' : '#059669' }]}>Approve</AppText>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.actionBtn, { backgroundColor: '#FEE2E2', width: '100%', justifyContent: 'center' }, actionPanel === 'cancel' && styles.actionBtnActive]}
                        onPress={() => openActionPanel('cancel')}
                      >
                        <Icon name="cancel" size={16} color="#EF4444" />
                        <AppText style={[styles.actionBtnText, { color: '#EF4444' }]}>Cancel PO</AppText>
                      </TouchableOpacity>
                    </View>
                  ) : null}
                  {isApproved ? (
                    <TouchableOpacity
                      style={[styles.actionBtn, { backgroundColor: sigEmpty ? '#E5E7EB' : '#D1FAE5', width: '100%', justifyContent: 'center', opacity: (actionSubmitting || sigSaving || sigEmpty) ? 0.5 : 1 }]}
                      onPress={doSendWithSignature}
                      disabled={actionSubmitting || sigSaving || sigEmpty}
                    >
                      <Icon name="send" size={16} color={sigEmpty ? '#9CA3AF' : '#059669'} />
                      <AppText style={[styles.actionBtnText, { color: sigEmpty ? '#9CA3AF' : '#059669' }]}>Send</AppText>
                    </TouchableOpacity>
                  ) : null}
                  {isApproved ? (
                    <TouchableOpacity
                      style={[styles.actionBtn, { backgroundColor: '#FEE2E2', width: '100%', justifyContent: 'center' }, actionPanel === 'cancel' && styles.actionBtnActive]}
                      onPress={() => openActionPanel('cancel')}
                    >
                      <Icon name="cancel" size={16} color="#EF4444" />
                      <AppText style={[styles.actionBtnText, { color: '#EF4444' }]}>Cancel PO</AppText>
                    </TouchableOpacity>
                  ) : null}
                  {isSent ? (
                    <TouchableOpacity
                      style={[styles.actionBtn, { backgroundColor: '#D1FAE5', width: '100%', justifyContent: 'center' }, actionPanel === 'receive' && styles.actionBtnActive]}
                      onPress={() => openActionPanel('receive')}
                    >
                      <Icon name="move-to-inbox" size={16} color="#10B981" />
                      <AppText style={[styles.actionBtnText, { color: '#10B981' }]}>Receive Goods</AppText>
                    </TouchableOpacity>
                  ) : null}
                  {canBill ? (
                    <TouchableOpacity
                      style={[styles.actionBtn, { backgroundColor: '#EDE9FE' }, actionPanel === 'bill' && styles.actionBtnActive]}
                      onPress={() => openActionPanel('bill')}
                    >
                      <Icon name="receipt" size={16} color="#7C3AED" />
                      <AppText style={[styles.actionBtnText, { color: '#7C3AED' }]}>Record Bill</AppText>
                    </TouchableOpacity>
                  ) : null}
                  {isBilled ? (
                    <TouchableOpacity
                      style={[styles.actionBtn, { backgroundColor: '#A7F3D0' }, actionPanel === 'pay' && styles.actionBtnActive]}
                      onPress={() => openActionPanel('pay')}
                    >
                      <Icon name="payments" size={16} color="#059669" />
                      <AppText style={[styles.actionBtnText, { color: '#059669' }]}>Record Payment</AppText>
                    </TouchableOpacity>
                  ) : null}
                </View>

                {/* Receive form */}
                {actionPanel === 'receive' ? (
                  <View style={styles.actionForm}>
                    {/* Column headers */}
                    <View style={{ flexDirection: 'row', paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: Colors.divider, marginBottom: 6 }}>
                      <AppText style={{ flex: 1, fontSize: 10, fontWeight: '700', color: Colors.textSecondary }}>Product</AppText>
                      <AppText style={{ width: 64, fontSize: 10, fontWeight: '700', color: Colors.textSecondary, textAlign: 'center' }}>Qty</AppText>
                      <AppText style={{ width: 80, fontSize: 10, fontWeight: '700', color: Colors.textSecondary, textAlign: 'center' }}>Cost ($)</AppText>
                    </View>
                    {receiveRows.map((row, i) => (
                      <View key={row.poItemId} style={[{ flexDirection: 'row', alignItems: 'center', gap: 6 }, i > 0 && { marginTop: 8 }]}>
                        <View style={{ flex: 1 }}>
                          <AppText style={styles.receiveItemName} numberOfLines={1}>{row.productName}</AppText>
                          <AppText style={styles.receiveItemMeta}>Ordered: {row.totalQty} · Rcvd: {row.alreadyReceived}</AppText>
                        </View>
                        <TextInput
                          style={[styles.numInputSm, { width: 64 }]}
                          value={row.qtyReceived}
                          onChangeText={v => setReceiveRows(prev => prev.map((r, ri) => ri === i ? { ...r, qtyReceived: v } : r))}
                          keyboardType="numeric"
                          selectTextOnFocus
                        />
                        <TextInput
                          style={[styles.numInputSm, { width: 80 }]}
                          value={row.unitCost}
                          onChangeText={v => setReceiveRows(prev => prev.map((r, ri) => ri === i ? { ...r, unitCost: v.replace(/[^0-9.]/g, '') } : r))}
                          keyboardType="decimal-pad"
                          selectTextOnFocus
                        />
                      </View>
                    ))}
                    <View style={[styles.actionFormField, { marginTop: 10 }]}>
                      <AppText style={styles.fieldLabel}>Note (optional)</AppText>
                      <TextInput style={styles.textInput} value={receiveNote} onChangeText={setReceiveNote} placeholder="Partial delivery…" placeholderTextColor={Colors.textLight} />
                    </View>

                    {/* Photos */}
                    <View style={[styles.actionFormField, { marginTop: 4 }]}>
                      <AppText style={styles.fieldLabel}>Photos (optional)</AppText>
                      <View style={pvStyles.photoGrid}>
                        {receivedImages.map(img => (
                          <View key={img.id} style={pvStyles.photoThumbWrap}>
                            <Image source={{ uri: img.url }} style={pvStyles.photoThumb} resizeMode="cover" />
                            <TouchableOpacity
                              style={pvStyles.photoRemoveBtn}
                              onPress={() => doDeleteImage(img)}
                              disabled={deletingImageId === img.id}
                              hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                            >
                              {deletingImageId === img.id
                                ? <ActivityIndicator size="small" color="#EF4444" />
                                : <Icon name="cancel" size={20} color="#EF4444" />}
                            </TouchableOpacity>
                          </View>
                        ))}
                        <TouchableOpacity
                          style={[pvStyles.photoAddTile, addingImage && { opacity: 0.6 }]}
                          onPress={() => setShowReceivePhotoMenu(true)}
                          disabled={addingImage}
                          activeOpacity={0.75}
                        >
                          {addingImage
                            ? <ActivityIndicator color="#818CF8" />
                            : <Icon name="add-a-photo" size={36} color="#818CF8" />}
                          <AppText style={pvStyles.photoAddTxt}>
                            {addingImage ? 'Uploading…' : 'Add Photo'}
                          </AppText>
                        </TouchableOpacity>
                      </View>
                    </View>

                    <TouchableOpacity style={[styles.actionSubmitBtn, { backgroundColor: '#10B981', width: '100%' }]} onPress={doReceive} disabled={actionSubmitting}>
                      {actionSubmitting ? <ActivityIndicator size="small" color="#fff" /> : <AppText style={styles.actionSubmitText}>Confirm Receive</AppText>}
                    </TouchableOpacity>
                  </View>
                ) : null}

                {/* Bill form */}
                {actionPanel === 'bill' ? (
                  <View style={styles.actionForm}>
                    <View style={styles.actionFormRow}>
                      <View style={{ flex: 1 }}>
                        <AppText style={styles.fieldLabel}>Issued At <AppText style={{ color: Colors.error }}>*</AppText></AppText>
                        <TouchableOpacity
                          style={[styles.textInput, { flexDirection: 'row', alignItems: 'center', gap: 8 }]}
                          onPress={() => setBillDatePicker(true)}
                          activeOpacity={0.75}
                        >
                          <Icon name="event" size={16} color={Colors.primary} />
                          <AppText style={{ color: Colors.text, flex: 1 }}>{billIssuedAt}</AppText>
                        </TouchableOpacity>
                      </View>
                    </View>
                    <View style={styles.actionFormRow}>
                      <View style={{ flex: 1 }}>
                        <AppText style={styles.fieldLabel}>Total Amount</AppText>
                        <View style={[styles.textInput, { justifyContent: 'center', backgroundColor: Colors.background }]}>
                          <AppText style={{ color: Colors.text, fontWeight: '700' }}>
                            ${(Number(detailPO?.totalCents ?? 0) / 100).toFixed(2)}
                          </AppText>
                        </View>
                      </View>
                      <View style={{ flex: 1 }}>
                        <AppText style={styles.fieldLabel}>Rate (KHR) <AppText style={{ color: Colors.error }}>*</AppText></AppText>
                        <TextInput style={styles.textInput} value={billRateUsed} onChangeText={setBillRateUsed} placeholder="4000" placeholderTextColor={Colors.textLight} keyboardType="numeric" />
                      </View>
                    </View>
                    <TouchableOpacity style={[styles.actionSubmitBtn, { backgroundColor: '#7C3AED' }]} onPress={doBill} disabled={actionSubmitting}>
                      {actionSubmitting ? <ActivityIndicator size="small" color="#fff" /> : <AppText style={styles.actionSubmitText}>Record Bill</AppText>}
                    </TouchableOpacity>
                  </View>
                ) : null}

                {/* Pay form */}
                {actionPanel === 'pay' ? (
                  <View style={styles.actionForm}>
                    <View style={styles.actionFormRow}>
                      <View style={{ flex: 1 }}>
                        <AppText style={styles.fieldLabel}>Amount (cents) <AppText style={{ color: Colors.error }}>*</AppText></AppText>
                        <TextInput style={styles.textInput} value={payAmount} onChangeText={setPayAmount} keyboardType="numeric" placeholder="5000" placeholderTextColor={Colors.textLight} selectTextOnFocus />
                      </View>
                      <View style={{ flex: 1 }}>
                        <AppText style={styles.fieldLabel}>Paid At <AppText style={{ color: Colors.error }}>*</AppText></AppText>
                        <TouchableOpacity
                          style={[styles.textInput, { flexDirection: 'row', alignItems: 'center', gap: 8 }]}
                          onPress={() => setPayDatePicker(true)}
                          activeOpacity={0.75}
                        >
                          <Icon name="event" size={16} color={Colors.primary} />
                          <AppText style={{ color: Colors.text, flex: 1 }}>{payPaidAt}</AppText>
                        </TouchableOpacity>
                      </View>
                    </View>
                    <View style={styles.actionFormField}>
                      <AppText style={styles.fieldLabel}>Method</AppText>
                      <View style={styles.methodRow}>
                        {[
                          { label: 'Cash',     value: 'CASH' },
                          { label: 'Transfer', value: 'BANK_TRANSFER' },
                          { label: 'Cheque',   value: 'CHEQUE' },
                          { label: 'Other',    value: 'OTHER' },
                        ].map(m => (
                          <TouchableOpacity key={m.value} style={[styles.methodChip, payMethod === m.value && styles.methodChipActive]} onPress={() => setPayMethod(m.value)}>
                            <AppText style={[styles.methodChipText, payMethod === m.value && styles.methodChipTextActive]}>{m.label}</AppText>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </View>
                    <View style={styles.actionFormField}>
                      <AppText style={styles.fieldLabel}>Note</AppText>
                      <TextInput style={styles.textInput} value={payNote} onChangeText={setPayNote} placeholder="Wire transfer…" placeholderTextColor={Colors.textLight} />
                    </View>
                    <TouchableOpacity style={[styles.actionSubmitBtn, { backgroundColor: '#059669' }]} onPress={doPay} disabled={actionSubmitting}>
                      {actionSubmitting ? <ActivityIndicator size="small" color="#fff" /> : <AppText style={styles.actionSubmitText}>Record Payment</AppText>}
                    </TouchableOpacity>
                  </View>
                ) : null}

                {/* Cancel form */}
                {actionPanel === 'cancel' ? (
                  <View style={styles.actionForm}>
                    <View style={styles.actionFormField}>
                      <AppText style={styles.fieldLabel}>Reason (optional)</AppText>
                      <TextInput style={styles.textInput} value={cancelReason} onChangeText={setCancelReason} placeholder="Supplier out of stock…" placeholderTextColor={Colors.textLight} />
                    </View>
                    <TouchableOpacity style={[styles.actionSubmitBtn, { backgroundColor: '#EF4444' }]} onPress={doCancel} disabled={actionSubmitting}>
                      {actionSubmitting ? <ActivityIndicator size="small" color="#fff" /> : <AppText style={styles.actionSubmitText}>Confirm Cancel</AppText>}
                    </TouchableOpacity>
                  </View>
                ) : null}

                {/* Images panel */}
                {actionPanel === 'images' ? (
                  <View style={styles.actionForm}>
                    <View style={{ flexDirection: 'row', gap: 10, marginBottom: 14 }}>
                      <TouchableOpacity style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: 10, backgroundColor: '#0284C7', opacity: addingImage ? 0.6 : 1 }} onPress={() => doPickImage('camera')} disabled={addingImage}>
                        <Icon name="camera-alt" size={18} color="#fff" />
                        <AppText style={{ fontSize: 13, fontWeight: '700', color: '#fff' }}>Camera</AppText>
                      </TouchableOpacity>
                      <TouchableOpacity style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: 10, backgroundColor: '#0369A1', opacity: addingImage ? 0.6 : 1 }} onPress={() => doPickImage('gallery')} disabled={addingImage}>
                        <Icon name="photo-library" size={18} color="#fff" />
                        <AppText style={{ fontSize: 13, fontWeight: '700', color: '#fff' }}>Gallery</AppText>
                      </TouchableOpacity>
                    </View>
                    {addingImage && (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                        <ActivityIndicator size="small" color="#0284C7" />
                        <AppText style={{ fontSize: 12, color: Colors.textSecondary }}>Uploading…</AppText>
                      </View>
                    )}
                    {imagesLoading ? (
                      <ActivityIndicator color="#0284C7" style={{ marginTop: 16 }} />
                    ) : receivedImages.length === 0 ? (
                      <View style={{ alignItems: 'center', paddingVertical: 24, gap: 6 }}>
                        <Icon name="add-photo-alternate" size={36} color={Colors.textLight} />
                        <AppText style={{ fontSize: 13, color: Colors.textSecondary }}>No images yet</AppText>
                      </View>
                    ) : (
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                        {receivedImages.map(img => (
                          <View key={img.id} style={{ width: 90, height: 90, borderRadius: 8, overflow: 'hidden', position: 'relative' }}>
                            <Image source={{ uri: img.url }} style={{ width: 90, height: 90 }} resizeMode="cover" />
                            <TouchableOpacity style={{ position: 'absolute', top: 3, right: 3, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 10, width: 20, height: 20, alignItems: 'center', justifyContent: 'center' }} onPress={() => doDeleteImage(img)} disabled={deletingImageId === img.id}>
                              {deletingImageId === img.id ? <ActivityIndicator size="small" color="#fff" /> : <Icon name="close" size={13} color="#fff" />}
                            </TouchableOpacity>
                            {img.note ? (
                              <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: 4, paddingVertical: 2 }}>
                                <AppText style={{ fontSize: 9, color: '#fff' }} numberOfLines={1}>{img.note}</AppText>
                              </View>
                            ) : null}
                          </View>
                        ))}
                      </View>
                    )}
                  </View>
                ) : null}
              </ScrollView>

            </KeyboardAvoidingView>

            {/* Inline photo source sheet — avoids nested Modal crash */}
            {showReceivePhotoMenu && (
              <TouchableOpacity
                style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }}
                activeOpacity={1}
                onPress={() => setShowReceivePhotoMenu(false)}
              >
                <TouchableOpacity activeOpacity={1} style={pvStyles.photoMenu} onPress={() => {}}>
                  <AppText style={pvStyles.photoMenuTitle}>Add Receive Photo</AppText>
                  <TouchableOpacity style={pvStyles.photoMenuItem} onPress={() => doPickImage('camera')} activeOpacity={0.7}>
                    <View style={[pvStyles.photoMenuIcon, { backgroundColor: '#EEF2FF' }]}>
                      <Icon name="photo-camera" size={22} color="#6366F1" />
                    </View>
                    <AppText style={pvStyles.photoMenuLabel}>Take Photo</AppText>
                    <Icon name="chevron-right" size={18} color={Colors.textLight} />
                  </TouchableOpacity>
                  <View style={pvStyles.menuSep} />
                  <TouchableOpacity style={pvStyles.photoMenuItem} onPress={() => doPickImage('gallery')} activeOpacity={0.7}>
                    <View style={[pvStyles.photoMenuIcon, { backgroundColor: '#D1FAE5' }]}>
                      <Icon name="photo-library" size={22} color="#10B981" />
                    </View>
                    <AppText style={pvStyles.photoMenuLabel}>Upload from Gallery</AppText>
                    <Icon name="chevron-right" size={18} color={Colors.textLight} />
                  </TouchableOpacity>
                </TouchableOpacity>
              </TouchableOpacity>
            )}

            {/* Inline confirm overlay — avoids nested Modal crash on Android */}
            {confirmDialog && (
              <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(15,23,42,0.55)', alignItems: 'center', justifyContent: 'center', zIndex: 999, paddingHorizontal: 28 }}>
                <View style={{ backgroundColor: Colors.surface, borderRadius: 24, paddingTop: 32, paddingBottom: 24, paddingHorizontal: 24, width: '100%', maxWidth: 360, alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 20 }, shadowOpacity: 0.18, shadowRadius: 40, elevation: 20 }}>
                  <View style={{ width: 68, height: 68, borderRadius: 34, backgroundColor: Colors.primaryLight, alignItems: 'center', justifyContent: 'center', marginBottom: 18 }}>
                    <Icon name="help" size={32} color={Colors.primary} />
                  </View>
                  <AppText variant="h4" align="center" style={{ marginBottom: 8 }}>{confirmDialog.title}</AppText>
                  {confirmDialog.message ? (
                    <AppText variant="body" color="textSecondary" align="center" style={{ lineHeight: 22 }}>{confirmDialog.message}</AppText>
                  ) : null}
                  <View style={{ height: 1, backgroundColor: Colors.divider, width: '100%', marginTop: 20, marginBottom: 16 }} />
                  <View style={{ flexDirection: 'row', gap: 10, width: '100%' }}>
                    <TouchableOpacity
                      style={{ flex: 1, borderWidth: 1.5, borderColor: Colors.primary, borderRadius: 10, paddingVertical: 12, alignItems: 'center' }}
                      onPress={() => setConfirmDialog(null)}
                    >
                      <AppText style={{ color: Colors.primary, fontWeight: '600' }}>Cancel</AppText>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={{ flex: 1, backgroundColor: confirmDialog.danger ? Colors.error : Colors.primary, borderRadius: 10, paddingVertical: 12, alignItems: 'center' }}
                      onPress={() => { const fn = confirmDialog.onConfirm; setConfirmDialog(null); fn(); }}
                    >
                      <AppText style={{ color: '#FFFFFF', fontWeight: '600' }}>{confirmDialog.confirmLabel ?? 'Confirm'}</AppText>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            )}

            </View>
          );
        })() : null}
      </Modal>
      <DatePickerModal
        visible={billDatePicker}
        value={billIssuedAt ? new Date(billIssuedAt) : new Date()}
        onChange={d => { setBillIssuedAt(toISO(d)); setBillDatePicker(false); }}
        onClose={() => setBillDatePicker(false)}
      />
      <DatePickerModal
        visible={payDatePicker}
        value={payPaidAt ? new Date(payPaidAt) : new Date()}
        onChange={d => { setPayPaidAt(toISO(d)); setPayDatePicker(false); }}
        onClose={() => setPayDatePicker(false)}
      />

      {/* ── Filter vendor picker ──────────────────────────────────────────────── */}
      <Modal visible={showFilterVendorModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowFilterVendorModal(false)}>
        <View style={styles.pickerModal}>
          <View style={styles.pickerHeader}>
            <AppText style={styles.pickerTitle}>Select Vendor</AppText>
            <TouchableOpacity onPress={() => setShowFilterVendorModal(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Icon name="close" size={22} color={Colors.text} />
            </TouchableOpacity>
          </View>
          <View style={styles.pickerSearch}>
            <Icon name="search" size={18} color={Colors.textSecondary} />
            <TextInput
              style={styles.pickerSearchInput}
              value={filterVendorSearch}
              onChangeText={setFilterVendorSearch}
              placeholder="Search vendors…"
              placeholderTextColor={Colors.textLight}
              autoFocus
              autoCorrect={false}
            />
          </View>
          {vendorsLoading ? (
            <ActivityIndicator style={{ marginTop: 32 }} color={Colors.primary} />
          ) : (
            <FlatList
              data={filteredFilterVendors}
              keyExtractor={v => String(v.id)}
              renderItem={({ item: v }) => (
                <TouchableOpacity
                  style={[styles.pickerRow, filterVendor?.id === v.id && styles.pickerRowSelected]}
                  onPress={() => { setFilterVendor(v); setShowFilterVendorModal(false); setFilterVendorSearch(''); }}
                >
                  <AppText style={styles.pickerRowName}>{v.nameEn ?? v.nameKm ?? '—'}</AppText>
                  {v.code ? <AppText style={styles.pickerRowSku}>{v.code}</AppText> : null}
                </TouchableOpacity>
              )}
              keyboardShouldPersistTaps="handled"
            />
          )}
        </View>
      </Modal>

      {/* ── Date pickers ─────────────────────────────────────────────────────── */}
      <DatePickerModal
        visible={datePicker === 'from'}
        value={fromDate}
        maxDate={toDate}
        onChange={d => { setFromDate(d); setDatePicker(null); }}
        onClose={() => setDatePicker(null)}
      />
      <DatePickerModal
        visible={datePicker === 'to'}
        value={toDate}
        minDate={fromDate}
        onChange={d => { setToDate(d); setDatePicker(null); }}
        onClose={() => setDatePicker(null)}
      />

    </View>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },

  // Header PDF button
  headerPdfBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 6,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)',
  },
  headerPdfBtnDisabled: { opacity: 0.35 },
  headerPdfText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
  headerBadge: {
    backgroundColor: '#EF4444', borderRadius: 8,
    minWidth: 16, height: 16, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3, marginLeft: 2,
  },
  headerBadgeText: { color: '#FFFFFF', fontSize: 10, fontWeight: '800' },

  // Search
  searchRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.surface,
    marginHorizontal: 16, marginTop: 8, marginBottom: 0,
    borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8,
    borderWidth: 1, borderColor: Colors.border,
  },
  searchIcon: { marginRight: 8 },
  searchInput: { flex: 1, fontSize: 15, color: Colors.text, paddingVertical: 0 },

  // Filter bar
  filterBar: {
    backgroundColor: Colors.surface,
    paddingHorizontal: 14, paddingTop: 12, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: Colors.divider,
    gap: 8,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05, shadowRadius: 6, elevation: 3,
  },
  filterInputRow: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1, borderColor: Colors.border, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10,
    backgroundColor: Colors.background, gap: 8,
  },
  filterTextInput: { flex: 1, fontSize: 14, color: Colors.text, paddingVertical: 0 },
  filterSelectRow: { flexDirection: 'row', gap: 8 },
  filterSelectBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center',
    borderWidth: 1, borderColor: Colors.border, borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 10,
    backgroundColor: Colors.background, gap: 6,
  },
  filterSelectText:       { flex: 1, fontSize: 13, color: Colors.textLight },
  filterSelectTextActive: { color: Colors.text, fontWeight: '600' },
  filterDateBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6,
    borderWidth: 1, borderColor: Colors.border, borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 10, backgroundColor: Colors.background,
  },
  filterDateText: { fontSize: 13, color: Colors.text, fontWeight: '500' },
  filterDateSep:  { fontSize: 14, color: Colors.textSecondary, fontWeight: '600' },
  filterBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: Colors.primary, borderRadius: 12, paddingVertical: 13,
    shadowColor: Colors.primary, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 8, elevation: 5,
  },
  filterBtnText: { color: '#fff', fontSize: 15, fontWeight: '700', letterSpacing: 0.3 },

  // Tabs
  tabScroll: { flexGrow: 0 },
  tabContent: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 6 },
  tab: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 14, paddingVertical: 6,
    borderRadius: 20, backgroundColor: Colors.surface,
    borderWidth: 1, borderColor: Colors.border, marginRight: 8,
  },
  tabActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  tabLabel: { fontSize: 13, fontWeight: '600', color: Colors.text },
  tabLabelActive: { color: '#fff' },
  tabBadge: {
    backgroundColor: Colors.divider, borderRadius: 9,
    minWidth: 18, height: 18, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4,
  },
  tabBadgeActive: { backgroundColor: 'rgba(255,255,255,0.3)' },
  tabBadgeText: { fontSize: 10, fontWeight: '800', color: Colors.textSecondary },
  tabBadgeTextActive: { color: '#fff' },

  // List
  listArea: { flex: 1 },
  list: { paddingBottom: 8 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 32 },
  centerMsg: { fontSize: 14, color: Colors.textSecondary, textAlign: 'center' },
  retryBtn: { paddingHorizontal: 24, paddingVertical: 10, borderRadius: 8, borderWidth: 1.5, borderColor: Colors.primary },
  retryText: { color: Colors.primary, fontWeight: '700' },

  // PO Row (Sale Order style)
  rowWrap: { backgroundColor: Colors.surface, borderBottomWidth: 1, borderBottomColor: Colors.divider },
  rowSelected: { backgroundColor: '#EFF6FF' },
  rowMain: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 13, gap: 10 },
  indexBox: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  indexText: { fontSize: 14, fontWeight: '800' },
  rowBody: { flex: 1, gap: 2 },
  refRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  refLabel: {
    fontSize: 10, fontWeight: '700', color: Colors.primary,
    backgroundColor: '#EFF6FF', borderRadius: 4,
    paddingHorizontal: 5, paddingVertical: 1,
    letterSpacing: 0.5, textTransform: 'uppercase',
  },
  poNumber: { fontSize: 14, fontWeight: '700', color: Colors.text, letterSpacing: 0.3, flex: 1 },
  vendorName: { fontSize: 13, fontWeight: '600', color: Colors.text },
  rowMeta: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 5 },
  daysBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    borderRadius: 5, paddingHorizontal: 5, paddingVertical: 2,
  },
  daysText: { fontSize: 10, fontWeight: '700' },
  locationChip: {
    flexDirection: 'row', alignItems: 'center', gap: 2,
    backgroundColor: Colors.background, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 2,
  },
  locationChipText: { fontSize: 10, color: Colors.textSecondary, maxWidth: 80 },
  rowDate: { fontSize: 11, color: Colors.textSecondary },
  rowRight: { alignItems: 'flex-end', gap: 5 },
  rowAmount: { fontSize: 14, fontWeight: '800', color: Colors.primary },
  statusBadge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  statusText: { fontSize: 11, fontWeight: '700' },
  viewDetailBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 14, paddingBottom: 10,
  },
  viewDetailText: { fontSize: 12, color: Colors.primary, fontWeight: '600' },
  cardActionRow: {
    flexDirection: 'row', gap: 8,
    paddingHorizontal: 12, paddingBottom: 12, paddingTop: 4,
  },
  cardActionBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
    paddingVertical: 8, borderRadius: 10, borderWidth: 1,
  },
  cardActionText: { fontSize: 12, fontWeight: '700' },
  completedBadge: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#F0FDF4', borderRadius: 10, borderWidth: 1, borderColor: '#BBF7D0',
    paddingVertical: 8, paddingHorizontal: 12,
  },
  completedText: { fontSize: 12, fontWeight: '700', color: '#16A34A' },

  // Inline note
  poNoteText: { fontSize: 12, color: Colors.textSecondary, lineHeight: 16 },
  receiptNoteRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  receiptNoteText: { fontSize: 12, color: '#059669', lineHeight: 16, flex: 1 },

  // Image count badge + toggle
  imgToggleRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  imgCountBadge: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#EFF6FF', borderRadius: 5,
    paddingHorizontal: 5, paddingVertical: 2,
  },
  imgCountText: { fontSize: 11, fontWeight: '700', color: Colors.primary },

  // Expanded image panel
  expandedImgPanel: {
    backgroundColor: '#F8FAFC',
    borderTopWidth: 1, borderTopColor: Colors.divider,
    paddingHorizontal: 12, paddingVertical: 10,
  },
  expandedImgEmpty: { fontSize: 13, color: Colors.textLight, textAlign: 'center', paddingVertical: 8 },
  expandedImgGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 6,
  },
  expandedImgThumbWrap: { position: 'relative' },
  expandedImgThumb: { width: 72, height: 72, borderRadius: 8 },
  expandedImgZoomBadge: {
    position: 'absolute', bottom: 3, right: 3,
    width: 20, height: 20, borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center', justifyContent: 'center',
  },

  // Summary card
  summaryCard: {
    flexDirection: 'row', backgroundColor: Colors.surface,
    borderTopWidth: 1, borderTopColor: Colors.border,
    paddingVertical: 14, paddingHorizontal: 8,
  },
  summaryItem: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  summaryDot: { width: 8, height: 8, borderRadius: 4, marginTop: 1 },
  summaryTexts: { gap: 2 },
  summaryLabel: { fontSize: 11, color: Colors.textSecondary, fontWeight: '500' },
  summaryAmount: { fontSize: 15, fontWeight: '800' },
  summaryDivider: { width: 1, backgroundColor: Colors.divider, marginVertical: 4 },

  // FAB — sits above the summary card (summary card ~80px tall)
  fab: {
    position: 'absolute', bottom: 100, right: 20,
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: Colors.primary,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: Colors.primary, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35, shadowRadius: 8, elevation: 8,
  },

  // Form
  formScroll: { flex: 1, paddingHorizontal: 16 },
  sectionLabel: {
    fontSize: 11, fontWeight: '700', color: Colors.textSecondary,
    textTransform: 'uppercase', letterSpacing: 0.8,
    marginTop: 20, marginBottom: 8,
  },
  sectionRow: { flexDirection: 'row', alignItems: 'center', marginTop: 20, marginBottom: 8 },
  addItemBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, marginLeft: 'auto' as any },
  addItemText: { fontSize: 13, fontWeight: '700', color: Colors.primary },
  formCard: {
    backgroundColor: Colors.surface, borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: Colors.border, gap: 8,
  },
  itemCard: {
    backgroundColor: Colors.surface, borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: Colors.border, gap: 10, marginBottom: 8,
  },
  itemCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  itemIdx: { width: 26, height: 26, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  itemIdxText: { fontSize: 12, fontWeight: '800', color: Colors.primary },
  productPicker: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: 1, borderColor: Colors.border, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10, backgroundColor: Colors.background,
  },
  productPickerDisabled: {
    backgroundColor: Colors.divider,
    borderColor: Colors.divider,
    opacity: 0.6,
  },
  productPickerText: { flex: 1, fontSize: 14, color: Colors.text },
  productPickerPlaceholder: { color: Colors.textLight },
  itemNumRow: { flexDirection: 'row', gap: 10 },
  itemNumField: { flex: 1, gap: 4 },
  fieldLabel: { fontSize: 11, fontWeight: '600', color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5 },
  fieldHint: { fontSize: 10, color: Colors.textLight, fontStyle: 'italic', textTransform: 'none' },
  numInput: {
    borderWidth: 1, borderColor: Colors.border, borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 8,
    fontSize: 14, fontWeight: '700', color: Colors.text, textAlign: 'center',
    backgroundColor: Colors.surface,
  },
  numInputSm: {
    borderWidth: 1, borderColor: Colors.border, borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 6,
    fontSize: 13, fontWeight: '700', color: Colors.text, textAlign: 'center',
    backgroundColor: Colors.surface, minWidth: 60,
  },
  textInput: {
    borderWidth: 1, borderColor: Colors.border, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 14, color: Colors.text, backgroundColor: Colors.surface,
  },
  lineTotalOld: { fontSize: 11, color: Colors.textSecondary, textDecorationLine: 'line-through' },
  lineTotal: { fontSize: 14, fontWeight: '800', color: Colors.primary },
  numInputSalePrice: { color: '#EF4444', borderColor: '#FECACA', backgroundColor: '#FFF5F5' },
  numInputError: { borderColor: '#EF4444', borderWidth: 1.5 },
  priceErrorRow: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: '#FEF2F2', borderRadius: 7,
    paddingHorizontal: 10, paddingVertical: 6,
  },
  priceErrorText: { fontSize: 12, fontWeight: '600', color: '#EF4444', flex: 1 },

  discountRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#F5F3FF', borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 8,
  },
  discountLeft: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  discountLabel: { fontSize: 12, fontWeight: '600', color: '#7C3AED' },
  discountRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  discInputWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 2,
    borderWidth: 1.5, borderColor: '#C4B5FD', borderRadius: 8,
    backgroundColor: '#fff', paddingHorizontal: 8, paddingVertical: 4,
  },
  discInput: { fontSize: 13, fontWeight: '800', color: '#7C3AED', padding: 0, minWidth: 32, textAlign: 'right' },
  discPctSign: { fontSize: 12, fontWeight: '700', color: '#7C3AED' },
  discSaving: { fontSize: 12, fontWeight: '700', color: '#7C3AED' },
  formTotalRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: Colors.surface, borderRadius: 12, padding: 16, marginTop: 8,
    borderWidth: 1, borderColor: Colors.border,
  },
  formTotalLabel: { fontSize: 14, fontWeight: '600', color: Colors.textSecondary },
  formTotalVal: { fontSize: 20, fontWeight: '900', color: Colors.primary },
  formBar: {
    padding: 16, paddingBottom: 28,
    backgroundColor: Colors.surface,
    borderTopWidth: 1, borderTopColor: Colors.divider,
  },
  submitBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 14,
  },
  submitBtnDisabled: { opacity: 0.6 },
  submitBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },

  // Vendor picker
  vendorPicker: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: Colors.surface, borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: Colors.border,
  },
  vendorPickerName: { fontSize: 15, fontWeight: '700', color: Colors.text },
  vendorPickerCode: { fontSize: 12, color: Colors.textSecondary, marginTop: 1 },
  vendorPickerPlaceholder: { fontSize: 14, color: Colors.textLight },
  vatChip: {
    backgroundColor: '#D1FAE5', borderRadius: 5,
    paddingHorizontal: 6, paddingVertical: 2,
  },
  vatChipText: { fontSize: 10, fontWeight: '800', color: '#059669' },

  // Product / Vendor picker modal
  pickerRowSelected: { backgroundColor: Colors.primaryMuted },
  pickerModal: { flex: 1, backgroundColor: Colors.background },
  pickerHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 10,
    backgroundColor: Colors.surface, borderBottomWidth: 1, borderBottomColor: Colors.divider,
  },
  pickerTitle: { fontSize: 15, fontWeight: '700', color: Colors.text },
  pickerSearch: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.surface, marginHorizontal: 16, marginVertical: 6,
    borderRadius: 12, paddingHorizontal: 12, paddingVertical: 6,
    borderWidth: 1, borderColor: Colors.border,
  },
  pickerSearchInput: { flex: 1, fontSize: 14, color: Colors.text, paddingVertical: 0 },
  pickerRow: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: Colors.divider, backgroundColor: Colors.surface,
  },
  pickerRowInfo: { flex: 1 },
  pickerRowName: { fontSize: 13, fontWeight: '600', color: Colors.text },
  pickerRowSku: { fontSize: 11, color: Colors.textSecondary, marginTop: 1 },
  pickerEmpty: { textAlign: 'center', color: Colors.textSecondary, padding: 32, fontSize: 14 },

  // Detail modal
  detailScroll: { flex: 1, padding: 16 },
  detailCard: {
    backgroundColor: Colors.surface, borderRadius: 14, padding: 16,
    marginBottom: 12, borderWidth: 1, borderColor: Colors.border, gap: 12,
  },
  detailRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  statusBadgeLg: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6,
  },
  statusTextLg: { fontSize: 13, fontWeight: '700' },
  editPoBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderWidth: 1, borderColor: Colors.primary, borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 6,
  },
  editPoBtnText: { fontSize: 12, fontWeight: '700', color: Colors.primary },
  detailInfoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  detailInfoItem: { minWidth: '45%' },
  detailInfoLabel: { fontSize: 10, fontWeight: '600', color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5 },
  detailInfoVal: { fontSize: 13, fontWeight: '600', color: Colors.text, marginTop: 2 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 1, borderTopColor: Colors.divider, paddingTop: 10 },
  totalLabel: { fontSize: 12, fontWeight: '600', color: Colors.textSecondary },
  totalVal: { fontSize: 18, fontWeight: '900', color: Colors.primary },

  // Detail items
  itemsCard: {
    backgroundColor: Colors.surface, borderRadius: 14,
    borderWidth: 1, borderColor: Colors.border, marginBottom: 12,
    overflow: 'hidden', padding: 14, gap: 4,
  },
  detailItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, gap: 10 },
  detailItemBorder: { borderTopWidth: 1, borderTopColor: Colors.divider },
  detailItemLeft: { flex: 1 },
  detailItemName: { fontSize: 13, fontWeight: '700', color: Colors.text },
  detailItemMeta: { fontSize: 11, color: Colors.textSecondary, marginTop: 2 },
  detailItemTotal: { fontSize: 13, fontWeight: '800', color: Colors.text },

  // Actions
  actionsCard: {
    backgroundColor: Colors.surface, borderRadius: 14,
    borderWidth: 1, borderColor: Colors.border, padding: 14, gap: 10, marginBottom: 12,
  },
  actionBtns: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  actionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderRadius: 10, paddingHorizontal: 14, height: 56,
  },
  actionBtnActive: { opacity: 0.7 },
  actionBtnText: { fontSize: 13, fontWeight: '700' },

  actionForm: {
    borderTopWidth: 1, borderTopColor: Colors.divider,
    paddingTop: 12, marginTop: 4, gap: 10,
  },
  actionFormField: { gap: 6 },
  actionFormRow: { flexDirection: 'row', gap: 10 },
  actionSubmitBtn: {
    paddingVertical: 12, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center', marginTop: 4,
  },
  actionSubmitText: { color: '#fff', fontSize: 14, fontWeight: '700' },

  // Receive
  receiveRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  receiveItemName: { fontSize: 13, fontWeight: '700', color: Colors.text },
  receiveItemMeta: { fontSize: 11, color: Colors.textSecondary, marginTop: 2 },
  receiveQtyWrap: { gap: 4, alignItems: 'center' },

  // Pay method
  methodRow: { flexDirection: 'row', gap: 8 },
  methodChip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8,
    borderWidth: 1.5, borderColor: Colors.border, backgroundColor: Colors.background,
  },
  methodChipActive: { borderColor: Colors.primary, backgroundColor: Colors.primaryMuted },
  methodChipText: { fontSize: 12, fontWeight: '700', color: Colors.textSecondary },
  methodChipTextActive: { color: Colors.primary },
});

// ── Preview document styles ───────────────────────────────────────────────────
const pvStyles = StyleSheet.create({
  page: {
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    padding: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 3,
  },
  hdr: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 6 },
  logo: { width: 52, height: 52, borderRadius: 8 },
  hdrCenter: { flex: 1, alignItems: 'center', paddingHorizontal: 6 },
  coName: { fontSize: 11, fontWeight: '900', letterSpacing: 2, textTransform: 'uppercase', color: '#111' },
  coAddr: { fontSize: 7, color: '#666', lineHeight: 11, marginTop: 2, textAlign: 'center' },
  docTitle: { fontSize: 12, fontWeight: '900', textDecorationLine: 'underline', color: '#111', marginTop: 3 },
  hr: { borderTopWidth: 1.5, borderTopColor: '#111', marginVertical: 5 },
  infoRow: { flexDirection: 'row', borderWidth: 1, borderColor: '#111', marginBottom: 6 },
  infoBox: { flex: 1, padding: 4 },
  infoBoxBorderLeft: { borderLeftWidth: 1, borderLeftColor: '#111' },
  infoLine: { fontSize: 7, color: '#111', lineHeight: 11 },
  infoBold: { fontWeight: '700', fontSize: 7 },
  tblWrap: { borderWidth: 1, borderColor: '#111', overflow: 'hidden', marginBottom: 0 },
  tHead: { backgroundColor: '#EFEFEF', borderBottomWidth: 1.5, borderBottomColor: '#111' },
  tr: { flexDirection: 'row', alignItems: 'center' },
  th: {
    fontSize: 7, fontWeight: '700', color: '#111', textAlign: 'center',
    paddingVertical: 4, paddingHorizontal: 2,
    borderRightWidth: 1, borderRightColor: '#D1D5DB',
  },
  td: {
    fontSize: 7, color: '#111',
    paddingVertical: 3, paddingHorizontal: 3,
    borderRightWidth: 1, borderRightColor: '#E5E7EB',
  },
  fillerRow: { minHeight: 16 },
  noBadge: {
    width: 14, height: 14, borderRadius: 3,
    backgroundColor: '#EFF6FF', alignItems: 'center', justifyContent: 'center',
  },
  noBadgeText: { fontSize: 7, fontWeight: '700', color: '#2563EB' },
  totalsWrap: {
    borderTopWidth: 1.5, borderTopColor: '#111',
    paddingTop: 3, paddingBottom: 3, paddingHorizontal: 3, gap: 1,
  },
  totalLine: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center' },
  totalLbl: { fontSize: 7, fontWeight: '600', color: '#374151', minWidth: 70, textAlign: 'right', paddingRight: 12 },
  totalVal: { fontSize: 7, color: '#111', width: 60, textAlign: 'right' },
  grandLine: { borderTopWidth: 1, borderTopColor: '#9CA3AF', marginTop: 3, paddingTop: 3 },
  grandLbl: { fontSize: 8, fontWeight: '800', color: '#111', minWidth: 70, textAlign: 'right', paddingRight: 12 },
  grandVal: { fontSize: 8, fontWeight: '800', color: '#111', width: 60, textAlign: 'right' },
  sigFooter: {
    backgroundColor: Colors.surface,
    borderTopWidth: 1,
    borderTopColor: Colors.divider,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 4,
  },
  sigFooterTitle: {
    fontSize: 10, fontWeight: '700', color: Colors.textSecondary,
    textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6,
  },
  sigSection: { flexDirection: 'row', borderWidth: 1, borderColor: '#C9CDD4', borderRadius: 6, overflow: 'hidden' },
  sigCol: { flex: 1, paddingVertical: 8, paddingHorizontal: 6, alignItems: 'center' },
  sigColBorder: { borderLeftWidth: 1, borderLeftColor: '#C9CDD4' },
  sigLine: { width: '100%', height: 44, borderBottomWidth: 1, borderBottomColor: '#C9CDD4', marginBottom: 4 },
  sigLabel: { fontSize: 10, fontWeight: '600', color: '#374151' },

  // Photo bottom sheet
  menuOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  photoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    justifyContent: 'center',
    marginTop: 4,
  },
  photoThumbWrap: {
    width: 96,
    height: 96,
    borderRadius: 14,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: '#E2E8F0',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  photoThumb: {
    width: '100%',
    height: '100%',
  },
  photoRemoveBtn: {
    position: 'absolute',
    top: 4,
    right: 4,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 12,
  },
  photoAddTile: {
    width: 160,
    height: 160,
    borderRadius: 18,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: '#A5B4FC',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#F5F3FF',
  },
  photoAddTxt: {
    fontSize: 14,
    fontWeight: '700',
    color: '#6366F1',
  },
  photoMenu: {
    backgroundColor: Colors.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 48,
    gap: 4,
  },
  photoMenuTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#1E293B',
    marginBottom: 12,
  },
  photoMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 10,
  },
  photoMenuIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoMenuLabel: {
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
    color: '#1E293B',
  },
  menuSep: {
    height: 1,
    backgroundColor: '#F1F5F9',
    marginVertical: 4,
  },
});

const poConfirmStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  card: {
    width: 280,
    backgroundColor: Colors.surface,
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 12,
  },
  lottieWrap: {
    marginBottom: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lottie: {
    width: 130,
    height: 130,
  },
  title: {
    fontSize: 17,
    fontWeight: '800',
    color: Colors.text,
    textAlign: 'center',
    marginBottom: 8,
  },
  message: {
    fontSize: 13,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 4,
  },
  divider: {
    height: 1,
    backgroundColor: Colors.divider,
    width: '100%',
    marginTop: 18,
    marginBottom: 14,
  },
  btnRow: {
    flexDirection: 'row',
    gap: 10,
    width: '100%',
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Colors.border,
    alignItems: 'center',
  },
  cancelText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  okBtn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 12,
    alignItems: 'center',
  },
  okText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
  },
});

export default PurchaseOrderListScreen;
