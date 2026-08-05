import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Modal,
  Image,
  Dimensions,
  KeyboardAvoidingView,
  Platform,
  StatusBar,
  Alert,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import AppText from '../../components/AppText';
import { User } from '../../models/User';
import { usePOS } from '../../contexts/POSContext';
import POSDisplayScreen from './POSDisplayScreen';
import {
  getAllProductsApi,
  getProductsByLocationApi,
  getCategoriesApi,
  getCampusesApi,
  getLocationsApi,
  createSalesOrderApi,
  createInvoiceHeaderApi,
  updateSalesOrderStatusApi,
  getOrgId,
  openCashierSessionApi,
  getOpenCashierSessionApi,
  addCashierTransactionApi,
  closeCashierSessionApi,
  ApiProduct,
  ApiCategory,
  ApiCampus,
  ApiLocation,
  ApiCashierSession,
  ApiSessionCloseResult,
} from '../../services/focusApi';

// ─── Design palette ───────────────────────────────────────────
const P = {
  bg:       '#EDF0F2',
  panel:    '#FFFFFF',
  blue:     '#6FA8D8',
  navy:     '#33455A',
  navyDark: '#1E2A38',
  amber:    '#F4B942',
  red:      '#E2574C',
  green:    '#7CB955',
  teal:     '#4FB3A9',
  dark:     '#1A2332',
  mid:      '#4A5568',
  muted:    '#8B9AB0',
  border:   '#D8DDE6',
  func:     '#F0F2F5',
  stripe:   '#F7F9FB',
};

const DISC_STEPS = [0, 10, 20, 25, 50];
const DENOMS     = [10000, 5000, 2000, 1000, 500, 100, 25, 10, 5, 1];
const FUNC_TILES = [
  'Recent Sales','Pending Orders','Layaways','Close Day',
  'Cash In/Out','Gift Card','Discount',
  'Returns','Reports','Stock Count','Settings',
];

const TILE_COLORS = [
  '#5B8DB8', '#4AA89E', '#6AAF4A', '#D4960A',
  '#C0504D', '#7B5EA7', '#2E86AB', '#E07B39',
  '#3A7D44', '#B5547A',
];
const tileColor = (product: ApiProduct): string => {
  const key = product.categoryId ?? product.id;
  let h = 0;
  for (let i = 0; i < key.length; i++) h = key.charCodeAt(i) + ((h << 5) - h);
  return TILE_COLORS[Math.abs(h) % TILE_COLORS.length];
};

const denomLabel = (c: number) => c >= 100 ? `$${c / 100}` : `¢${c}`;
const fmt = (cents: number) => `$${(cents / 100).toFixed(2)}`;

const { width: SW } = Dimensions.get('window');
const LEFT_W    = Math.round(SW * 0.45);
const RIGHT_W   = SW - LEFT_W;
const PROD_COLS = 2;
const PROD_PAD  = 12;
const PROD_GAP  = 10;
const PROD_W    = Math.floor((RIGHT_W - PROD_PAD * 2 - PROD_GAP * (PROD_COLS - 1)) / PROD_COLS);
const FUNC_COLS = 4;
const FUNC_GAP  = 6;
const FUNC_W    = (RIGHT_W - 16 * 2 - FUNC_GAP * (FUNC_COLS - 1)) / FUNC_COLS;

interface Props { user: User | null; onLogout: () => void; }

// ─── Main screen ─────────────────────────────────────────────
const POSScreen: React.FC<Props> = ({ user, onLogout }) => {
  const insets = useSafeAreaInsets();
  const pos    = usePOS();

  // Products & categories
  const [products,    setProducts]    = useState<ApiProduct[]>([]);
  const [categories,  setCategories]  = useState<ApiCategory[]>([]);
  const [loadingProds, setLoadingProds] = useState(true);
  const [loadError,   setLoadError]   = useState<string | null>(null);
  const [activeCatId, setActiveCatId] = useState<string | null>(null);
  const [prodSearch,  setProdSearch]  = useState('');
  const [custSearch,  setCustSearch]  = useState('');
  const [lineDisc,    setLineDisc]    = useState<Record<string, number>>({});
  const [discModal,   setDiscModal]   = useState<{ productId: string; productName: string } | null>(null);
  const [discInput,   setDiscInput]   = useState('');
  const [showDisplay, setShowDisplay] = useState(false);

  // Campus / Location
  const [campuses,          setCampuses]         = useState<ApiCampus[]>([]);
  const [selectedCampusId,  setSelectedCampusId] = useState<string | null>(null);
  const [showCampusPicker,  setShowCampusPicker] = useState(false);
  const [locations,         setLocations]        = useState<ApiLocation[]>([]);
  const [selectedLocId,     setSelectedLocId]    = useState<string | null>(null);
  const [showLocPicker,     setShowLocPicker]    = useState(false);

  // Payment
  const [showPayment,    setShowPayment]   = useState(false);
  const [payMethod,      setPayMethod]     = useState<'CASH' | 'CARD' | 'QR'>('CASH');
  const [cashTendered,   setCashTendered]  = useState('');
  const [processing,     setProcessing]    = useState(false);
  const [payError,       setPayError]      = useState<string | null>(null);
  const [successMsg,     setSuccessMsg]    = useState<string | null>(null);

  // Cashier session
  const [openSession,   setOpenSession]  = useState<ApiCashierSession | null>(null);
  const [sessLoading,   setSessLoading]  = useState(true);
  const [showOpenShift, setShowOpenShift] = useState(false);
  const [openFloat,     setOpenFloat]    = useState('');
  const [openRate,      setOpenRate]     = useState('4100');
  const [openingShift,  setOpeningShift] = useState(false);
  const [openShiftErr,  setOpenShiftErr] = useState<string | null>(null);
  const [showCloseShift, setShowCloseShift] = useState(false);
  const [denomCounts,   setDenomCounts]  = useState<Record<number, string>>(
    () => Object.fromEntries(DENOMS.map(d => [d, '']))
  );
  const [closeNote,     setCloseNote]    = useState('');
  const [closingShift,  setClosingShift] = useState(false);
  const [closeResult,   setCloseResult]  = useState<ApiSessionCloseResult | null>(null);

  // ── Load ──────────────────────────────────────────────────
  const loadProducts = useCallback((locId?: string | null) => {
    setLoadingProds(true);
    setLoadError(null);
    const fetch = locId ? getProductsByLocationApi(locId) : getAllProductsApi();
    fetch
      .then(prods => setProducts(prods))
      .catch(e => setLoadError(e?.message ?? 'Failed to load products'))
      .finally(() => setLoadingProds(false));
  }, []);

  useEffect(() => {
    // Load categories once; products loaded after location is known
    getCategoriesApi().then(cats => setCategories(cats)).catch(() => {});
  }, []);

  useEffect(() => {
    getCampusesApi().then(l => { setCampuses(l); if (l.length) setSelectedCampusId(String(l[0].id)); }).catch(() => {});
  }, []);

  useEffect(() => {
    getLocationsApi().then(l => {
      setLocations(l);
      if (l.length) setSelectedLocId(String(l[0].id));
    }).catch(() => {});
  }, []);

  useEffect(() => {
    loadProducts(selectedLocId);
  }, [selectedLocId, loadProducts]);

  useEffect(() => {
    setSessLoading(true);
    getOpenCashierSessionApi()
      .then(s => { setOpenSession(s); if (!s) setShowOpenShift(true); })
      .finally(() => setSessLoading(false));
  }, []);

  // ── Derived ───────────────────────────────────────────────
  const filteredProducts = useMemo(() => {
    let list = products;
    if (activeCatId) list = list.filter(p => p.categoryId === activeCatId);
    if (prodSearch.trim()) {
      const q = prodSearch.toLowerCase();
      list = list.filter(p =>
        p.nameEn.toLowerCase().includes(q) ||
        p.nameKm?.toLowerCase().includes(q) ||
        p.sku?.toLowerCase().includes(q)
      );
    }
    return list;
  }, [products, activeCatId, prodSearch]);

  const cartTotals = useMemo(() => {
    let subtotal = 0, discount = 0;
    for (const item of pos.cart) {
      const orig = item.unitPriceCents * item.qty;
      const after = Math.round(item.unitPriceCents * (1 - (lineDisc[item.product.id] ?? 0) / 100)) * item.qty;
      subtotal += orig;
      discount += orig - after;
    }
    const total = subtotal - discount;
    return { subtotal, discount, total };
  }, [pos.cart, lineDisc]);

  const cashCents  = useMemo(() => { const v = parseFloat(cashTendered || '0'); return isNaN(v) ? 0 : Math.round(v * 100); }, [cashTendered]);
  const changeCents = cashCents - cartTotals.total;

  const closingTotal = useMemo(
    () => DENOMS.reduce((s, d) => s + d * (parseInt(denomCounts[d] || '0', 10) || 0), 0),
    [denomCounts]
  );

  // ── Handlers ──────────────────────────────────────────────
  const openDiscModal = useCallback((productId: string, productName: string) => {
    setDiscInput(String(lineDisc[productId] ?? 0));
    setDiscModal({ productId, productName });
  }, [lineDisc]);

  const applyDisc = useCallback((productId: string, value: string) => {
    const pct = Math.min(100, Math.max(0, parseFloat(value) || 0));
    setLineDisc(prev => {
      if (pct === 0) { const { [productId]: _, ...rest } = prev; return rest; }
      return { ...prev, [productId]: pct };
    });
    setDiscModal(null);
  }, []);

  const handleOpenShift = useCallback(async () => {
    const floatCents = Math.round(parseFloat(openFloat || '0') * 100);
    if (floatCents < 0) { setOpenShiftErr('Opening float cannot be negative.'); return; }
    setOpeningShift(true); setOpenShiftErr(null);
    try {
      const s = await openCashierSessionApi({ openingFloatCents: floatCents, rateUsed: Number(openRate) || 4100 });
      setOpenSession(s); setShowOpenShift(false); setOpenFloat('');
    } catch (e: any) { setOpenShiftErr(e?.message ?? 'Failed to open shift'); }
    finally { setOpeningShift(false); }
  }, [openFloat, openRate]);

  const handleCloseShift = useCallback(async () => {
    if (!openSession) return;
    const payload = DENOMS.map(d => ({ denomination: d, count: parseInt(denomCounts[d] || '0', 10) || 0 })).filter(x => x.count > 0);
    setClosingShift(true);
    try {
      const r = await closeCashierSessionApi(openSession.id, { denominations: payload, note: closeNote || undefined });
      setCloseResult(r); setOpenSession(null);
    } catch (e: any) { Alert.alert('Error', e?.message ?? 'Failed to close shift'); }
    finally { setClosingShift(false); }
  }, [openSession, denomCounts, closeNote]);

  const handleProcessPayment = useCallback(async () => {
    if (pos.cart.length === 0) return;
    if (payMethod === 'CASH' && cashCents < cartTotals.total) { setPayError('Cash amount is less than total'); return; }
    setProcessing(true); setPayError(null);
    try {
      const orgId = getOrgId() ?? '1';
      const so = await createSalesOrderApi({
        customerOrgId: orgId,
        campusId:      selectedCampusId ? Number(selectedCampusId) : undefined,
        locationId:    selectedLocId    ? Number(selectedLocId)    : undefined,
        note:          pos.note || undefined,
        items: pos.cart.map(i => ({
          productId:     Number(i.product.id),
          qty:           i.qty,
          unitPriceCents: Math.round(i.unitPriceCents * (1 - (lineDisc[i.product.id] ?? 0) / 100)),
        })),
      });
      await updateSalesOrderStatusApi(so.id, 'RECEIVED');
      let invoiceNumber: string | null = null;
      if (selectedCampusId) {
        const inv = await createInvoiceHeaderApi({
          customerOrgId: orgId,
          campusId:  Number(selectedCampusId),
          locationId: selectedLocId ? Number(selectedLocId) : undefined,
          soIds:      [so.id],
          rateUsed:   4100,
          note:       pos.note || undefined,
        });
        invoiceNumber = inv.invoiceNumber ?? inv.id ?? null;
      }
      if (openSession) {
        addCashierTransactionApi(openSession.id, {
          type: 'SALE', amountCents: cartTotals.total,
          reference: so.referenceNumber ?? so.ref ?? String(so.id),
        }).catch(() => {});
      }
      const change = payMethod === 'CASH' ? changeCents : 0;
      setSuccessMsg(
        invoiceNumber
          ? payMethod === 'CASH' ? `Invoice ${invoiceNumber} · Change: ${fmt(change)}` : `Invoice ${invoiceNumber} created.`
          : payMethod === 'CASH' ? `Payment received. Change: ${fmt(change)}` : 'Payment processed.'
      );
      pos.clearCart(); setLineDisc({}); setShowPayment(false);
    } catch (e: any) { setPayError(e?.message ?? 'Payment failed'); }
    finally { setProcessing(false); }
  }, [pos, payMethod, cashCents, changeCents, cartTotals, selectedCampusId, selectedLocId, openSession, lineDisc]);

  const initials = user?.name
    ? user.name.split(' ').slice(0, 2).map(w => w[0]?.toUpperCase()).join('')
    : 'U';

  // ── RENDER ────────────────────────────────────────────────
  return (
    <SafeAreaView style={s.root} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor={P.navyDark} />

      {/* ═══════ HEADER ═══════ */}
      <View style={s.header}>
        <View style={s.headerLeft}>
          <View style={s.brand}>
            <AppText style={s.brandName}>FOCUS POS</AppText>
            <AppText style={s.brandVer}>v1.0</AppText>
          </View>
          {campuses.length > 0 && (
            <TouchableOpacity style={s.headerChip} onPress={() => setShowCampusPicker(true)}>
              <AppText style={s.hChipLabel}>CS</AppText>
              <AppText style={s.hChipVal} numberOfLines={1}>
                {campuses.find(c => String(c.id) === selectedCampusId)?.nameEn ?? '—'}
              </AppText>
              <AppText style={s.hChipArrow}>▾</AppText>
            </TouchableOpacity>
          )}
          {locations.length > 0 && (
            <TouchableOpacity style={s.headerChip} onPress={() => setShowLocPicker(true)}>
              <AppText style={s.hChipLabel}>LOC</AppText>
              <AppText style={s.hChipVal} numberOfLines={1}>
                {locations.find(l => String(l.id) === selectedLocId)?.nameEn ?? '—'}
              </AppText>
              <AppText style={s.hChipArrow}>▾</AppText>
            </TouchableOpacity>
          )}
        </View>
        <View style={s.headerRight}>
          {openSession && (
            <View style={s.sessBadge}>
              <View style={s.sessGreen} />
              <AppText style={s.sessTxt} numberOfLines={1}>{openSession.sessionNumber}</AppText>
            </View>
          )}
          <TouchableOpacity style={s.hBtn} onPress={() => setShowDisplay(true)}>
            <AppText style={s.hBtnTxt}>⊞ Display</AppText>
          </TouchableOpacity>
          {openSession && (
            <TouchableOpacity
              style={[s.hBtn, s.hBtnRed]}
              onPress={() => { setCloseResult(null); setDenomCounts(Object.fromEntries(DENOMS.map(d => [d, '']))); setCloseNote(''); setShowCloseShift(true); }}
            >
              <AppText style={[s.hBtnTxt, { color: '#FCA5A5' }]}>Close Shift</AppText>
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={onLogout}>
            <View style={s.avatar}><AppText style={s.avatarTxt}>{initials}</AppText></View>
          </TouchableOpacity>
        </View>
      </View>

      {/* ═══════ MAIN SPLIT ═══════ */}
      <View style={[s.main, { paddingBottom: insets.bottom }]}>

        {/* ──── LEFT PANEL ──── */}
        <View style={s.leftPanel}>

          {/* Search row */}
          <View style={s.searchRow}>
            <TextInput style={[s.searchInput, { marginRight: 5 }]} value={custSearch} onChangeText={setCustSearch} placeholder="Customer…" placeholderTextColor={P.muted} />
            <TextInput style={s.searchInput} value={prodSearch} onChangeText={setProdSearch} placeholder="Product…" placeholderTextColor={P.muted} clearButtonMode="while-editing" />
          </View>

          {/* Customer card */}
          <View style={s.custCard}>
            <View style={s.custAvatar}>
              <AppText style={s.custAvatarTxt}>GC</AppText>
            </View>
            <View style={s.custInfo}>
              <AppText style={s.custName}>General Customer</AppText>
              <AppText style={s.custSub}>Loyalty program</AppText>
              <View style={s.custStats}>
                {[['$0', 'Balance'], ['0', 'Points'], ['0', 'Visits']].map(([v, l], i) => (
                  <React.Fragment key={l}>
                    {i > 0 && <View style={s.statDiv} />}
                    <View style={s.statItem}>
                      <AppText style={s.statVal}>{v}</AppText>
                      <AppText style={s.statLbl}>{l}</AppText>
                    </View>
                  </React.Fragment>
                ))}
              </View>
            </View>
          </View>

          {/* Cart table header */}
          <View style={s.cartHdr}>
            <AppText style={[s.cartHCol, s.cartHColCode, s.cartHdrTxt]}>CODE</AppText>
            <AppText style={[s.cartHCol, s.cartHColName, s.cartHdrTxt]}>NAME</AppText>
            <AppText style={[s.cartHCol, s.cartHColQty,  s.cartHdrTxt, { textAlign: 'center' }]}>QTY</AppText>
            <AppText style={[s.cartHCol, s.cartHColDisc, s.cartHdrTxt, { textAlign: 'center' }]}>DIS</AppText>
            <AppText style={[s.cartHCol, s.cartHColPrice,s.cartHdrTxt, { textAlign: 'right' }]}>PRICE</AppText>
          </View>

          {/* Cart rows */}
          <ScrollView style={s.cartScroll} showsVerticalScrollIndicator={false}>
            {pos.cart.length === 0 ? (
              <View style={s.cartEmpty}>
                <AppText style={s.cartEmptyTxt}>Cart is empty</AppText>
                <AppText style={s.cartEmptyHint}>Tap a product to add</AppText>
              </View>
            ) : pos.cart.map((item, idx) => {
              const dp   = lineDisc[item.product.id] ?? 0;
              const disc = Math.round(item.unitPriceCents * (1 - dp / 100));
              const line = disc * item.qty;
              const orig = item.unitPriceCents * item.qty;
              const on   = dp > 0;
              return (
                <TouchableOpacity
                  key={item.product.id}
                  style={[s.cartRow, idx % 2 === 1 && s.cartRowAlt]}
                  onLongPress={() => pos.updateQty(item.product.id, 0)}
                  activeOpacity={0.85}
                  delayLongPress={500}
                >
                  {/* Code */}
                  <AppText style={[s.cartHCol, s.cartHColCode, s.cartCellCode]} numberOfLines={1}>
                    {item.product.sku ?? '—'}
                  </AppText>
                  {/* Name */}
                  <View style={[s.cartHCol, s.cartHColName]}>
                    <AppText style={s.cartCellName} numberOfLines={2}>{item.product.nameEn}</AppText>
                  </View>
                  {/* Qty */}
                  <View style={[s.cartHCol, s.cartHColQty, s.qtyCell]}>
                    <TouchableOpacity style={s.qtyBtn} onPress={() => pos.updateQty(item.product.id, item.qty - 1)}>
                      <AppText style={s.qtyBtnTxt}>−</AppText>
                    </TouchableOpacity>
                    <AppText style={s.qtyNum}>{item.qty}</AppText>
                    <TouchableOpacity style={s.qtyBtn} onPress={() => pos.updateQty(item.product.id, item.qty + 1)}>
                      <AppText style={s.qtyBtnTxt}>+</AppText>
                    </TouchableOpacity>
                  </View>
                  {/* Disc */}
                  <TouchableOpacity
                    style={[s.cartHCol, s.cartHColDisc, s.discBadge, on && s.discBadgeOn]}
                    onPress={() => openDiscModal(item.product.id, item.product.nameEn)}
                  >
                    <AppText style={[s.discTxt, on && s.discTxtOn]}>{dp > 0 ? `${dp}%` : '—'}</AppText>
                  </TouchableOpacity>
                  {/* Price */}
                  <View style={[s.cartHCol, s.cartHColPrice, { alignItems: 'flex-end' }]}>
                    {on && <AppText style={s.strikePrice}>{fmt(orig)}</AppText>}
                    <AppText style={[s.linePrice, on && s.linePriceDisc]}>{fmt(line)}</AppText>
                  </View>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {/* Totals block */}
          <View style={s.totals}>
            <View style={s.totalRow}>
              <AppText style={s.totLbl}>SUBTOTAL</AppText>
              <AppText style={s.totVal}>{fmt(cartTotals.subtotal)}</AppText>
            </View>
            {cartTotals.discount > 0 && (
              <View style={s.totalRow}>
                <AppText style={[s.totLbl, { color: P.amber }]}>DISCOUNT</AppText>
                <AppText style={[s.totVal, { color: P.amber }]}>−{fmt(cartTotals.discount)}</AppText>
              </View>
            )}
            <View style={s.totalGrand}>
              <AppText style={s.grandLbl}>TOTAL</AppText>
              <AppText style={s.grandVal}>{fmt(cartTotals.total)}</AppText>
            </View>
          </View>
        </View>

        {/* ──── RIGHT PANEL ──── */}
        <View style={s.rightPanel}>
          <ScrollView showsVerticalScrollIndicator={false}>

            {/* Category tiles (sticky-style row) */}
            <View style={s.catStrip}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.catContent}>
                <TouchableOpacity
                  style={[s.catTile, activeCatId === null && s.catTileActive]}
                  onPress={() => setActiveCatId(null)}
                >
                  <AppText style={[s.catTileTxt, activeCatId === null && s.catTileTxtActive]}>All</AppText>
                </TouchableOpacity>
                {categories.map(cat => (
                  <TouchableOpacity
                    key={cat.id}
                    style={[s.catTile, activeCatId === cat.id && s.catTileActive]}
                    onPress={() => setActiveCatId(activeCatId === cat.id ? null : cat.id)}
                  >
                    <AppText style={[s.catTileTxt, activeCatId === cat.id && s.catTileTxtActive]} numberOfLines={1}>
                      {cat.nameEn}
                    </AppText>
                  </TouchableOpacity>
                ))}
                <TouchableOpacity style={[s.catTile, s.catTileAdd]}>
                  <AppText style={s.catTileAddTxt}>+</AppText>
                </TouchableOpacity>
              </ScrollView>
            </View>

            {/* Product grid */}
            {loadingProds ? (
              <View style={s.loadBox}><ActivityIndicator size="large" color={P.blue} /></View>
            ) : loadError ? (
              <View style={s.loadBox}>
                <AppText style={{ color: P.red, marginBottom: 12, textAlign: 'center' }}>{loadError}</AppText>
                <TouchableOpacity style={s.retryBtn} onPress={() => loadProducts(selectedLocId)}>
                  <AppText style={{ color: P.panel, fontWeight: '700', fontSize: 13 }}>Retry</AppText>
                </TouchableOpacity>
              </View>
            ) : filteredProducts.length === 0 ? (
              <View style={s.loadBox}>
                <AppText style={{ color: P.muted, fontSize: 14, textAlign: 'center' }}>No products found</AppText>
              </View>
            ) : (
              <View style={s.prodGrid}>
                {filteredProducts.map(product => {
                  const price = parseInt(product.fixedPriceCents ?? '0', 10);
                  const color = tileColor(product);
                  return (
                    <TouchableOpacity
                      key={product.id}
                      style={s.prodTile}
                      onPress={() => pos.addItem(product)}
                      activeOpacity={0.78}
                    >
                      {product.primaryImageUrl ? (
                        <Image source={{ uri: product.primaryImageUrl }} style={s.prodImg} resizeMode="cover" />
                      ) : (
                        <View style={[s.prodImgPlaceholder, { backgroundColor: 'rgba(0,0,0,0.18)' }]}>
                          <AppText style={s.prodInitial}>{product.nameEn.charAt(0).toUpperCase()}</AppText>
                        </View>
                      )}
                      <View style={s.prodTileInfo}>
                        {product.nameKm ? (
                          <AppText style={s.prodName} numberOfLines={1}>{product.nameKm}</AppText>
                        ) : null}
                        <AppText style={s.prodNameKh} numberOfLines={1}>{product.nameEn}</AppText>
                        <AppText style={s.prodPrice}>{fmt(price)}</AppText>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}

            {/* Function tiles */}
            <View style={s.funcSection}>
              <AppText style={s.funcSectionHdr}>FUNCTIONS</AppText>
              <View style={s.funcGrid}>
                {FUNC_TILES.map(fn => (
                  <TouchableOpacity
                    key={fn}
                    style={s.funcTile}
                    onPress={() => {
                      if (fn === 'Close Day' || fn === 'Cash In/Out') {
                        setCloseResult(null);
                        setDenomCounts(Object.fromEntries(DENOMS.map(d => [d, ''])));
                        setCloseNote(''); setShowCloseShift(true);
                      }
                    }}
                    activeOpacity={0.75}
                  >
                    <AppText style={s.funcTileTxt}>{fn}</AppText>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            <View style={{ height: 20 }} />
          </ScrollView>
        </View>
      </View>

      {/* ═══════ BOTTOM BAR ═══════ */}
      <View style={[s.bottomBar, { paddingBottom: Math.max(insets.bottom, 10) }]}>
        <TouchableOpacity
          style={[s.bbPay, pos.cart.length === 0 && s.bbPayDis]}
          onPress={() => { setCashTendered(''); setPayError(null); setShowPayment(true); }}
          disabled={pos.cart.length === 0}
          activeOpacity={0.85}
        >
          <AppText style={s.bbPayTxt}>PAY  {fmt(cartTotals.total)}</AppText>
        </TouchableOpacity>
      </View>

      {/* ═══════════════ MODALS ═══════════════ */}

      {/* Display */}
      <Modal visible={showDisplay} animationType="fade" statusBarTranslucent onRequestClose={() => setShowDisplay(false)}>
        <POSDisplayScreen
          cart={pos.cart}
          subtotalCents={pos.subtotalCents}
          discountPercent={pos.discountPercent}
          discountCents={pos.discountCents}
          totalCents={cartTotals.total}
          onClose={() => setShowDisplay(false)}
        />
      </Modal>

      {/* Payment */}
      <Modal visible={showPayment} animationType="slide" transparent onRequestClose={() => setShowPayment(false)}>
        <KeyboardAvoidingView style={s.overlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={s.paySheet}>
            <View style={s.payHdr}>
              <AppText style={s.payTitle}>Payment</AppText>
              <TouchableOpacity onPress={() => setShowPayment(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <AppText style={s.payClose}>✕</AppText>
              </TouchableOpacity>
            </View>
            <View style={s.payMethods}>
              {(['CASH', 'CARD', 'QR'] as const).map(m => (
                <TouchableOpacity key={m} style={[s.payMethodBtn, payMethod === m && s.payMethodBtnOn]} onPress={() => setPayMethod(m)}>
                  <AppText style={[s.payMethodTxt, payMethod === m && s.payMethodTxtOn]}>
                    {m === 'CASH' ? '💵 Cash' : m === 'CARD' ? '💳 Card' : '📱 QR'}
                  </AppText>
                </TouchableOpacity>
              ))}
            </View>
            <View style={s.payDueRow}>
              <AppText style={s.payDueLbl}>Amount Due</AppText>
              <AppText style={s.payDueVal}>{fmt(cartTotals.total)}</AppText>
            </View>
            {payMethod === 'CASH' && (
              <View style={{ gap: 10 }}>
                <AppText style={s.payInputLbl}>Cash Tendered ($)</AppText>
                <TextInput
                  style={s.payInput}
                  value={cashTendered}
                  onChangeText={setCashTendered}
                  keyboardType="decimal-pad"
                  placeholder="0.00"
                  placeholderTextColor={P.muted}
                  autoFocus
                />
                {cashCents >= cartTotals.total && (
                  <View style={s.changeRow}>
                    <AppText style={s.changeLbl}>Change</AppText>
                    <AppText style={s.changeVal}>{fmt(changeCents)}</AppText>
                  </View>
                )}
              </View>
            )}
            {payError && <View style={s.payErrBox}><AppText style={{ color: P.red, textAlign: 'center', fontSize: 13 }}>{payError}</AppText></View>}
            <TouchableOpacity
              style={[s.payConfirm, (processing || pos.cart.length === 0) && s.payConfirmDis]}
              onPress={handleProcessPayment}
              disabled={processing || pos.cart.length === 0}
            >
              {processing
                ? <ActivityIndicator color="#FFF" />
                : <AppText style={s.payConfirmTxt}>Confirm Payment</AppText>
              }
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Campus picker */}
      <Modal visible={showCampusPicker} animationType="slide" transparent onRequestClose={() => setShowCampusPicker(false)}>
        <View style={s.pickerOverlay}>
          <View style={[s.pickerSheet, { paddingBottom: insets.bottom }]}>
            <View style={s.pickerHdr}>
              <AppText style={s.pickerTitle}>Select Campus</AppText>
              <TouchableOpacity onPress={() => setShowCampusPicker(false)}>
                <AppText style={s.pickerClose}>✕</AppText>
              </TouchableOpacity>
            </View>
            <ScrollView>
              {campuses.map(c => {
                const sel = String(c.id) === selectedCampusId;
                return (
                  <TouchableOpacity key={String(c.id)} style={[s.pickerRow, sel && s.pickerRowSel]} onPress={() => { setSelectedCampusId(String(c.id)); setShowCampusPicker(false); }}>
                    <View style={{ flex: 1 }}>
                      <AppText style={[s.pickerRowName, sel && { color: P.blue }]}>{c.nameEn}</AppText>
                      <AppText style={s.pickerRowCode}>{c.campusCode}</AppText>
                    </View>
                    {sel && <AppText style={{ color: P.blue, fontSize: 16, fontWeight: '700' }}>✓</AppText>}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Location picker */}
      <Modal visible={showLocPicker} animationType="slide" transparent onRequestClose={() => setShowLocPicker(false)}>
        <View style={s.pickerOverlay}>
          <View style={[s.pickerSheet, { paddingBottom: insets.bottom }]}>
            <View style={s.pickerHdr}>
              <AppText style={s.pickerTitle}>Select Location</AppText>
              <TouchableOpacity onPress={() => setShowLocPicker(false)}>
                <AppText style={s.pickerClose}>✕</AppText>
              </TouchableOpacity>
            </View>
            <ScrollView>
              {locations.map(l => {
                const sel = String(l.id) === selectedLocId;
                return (
                  <TouchableOpacity key={String(l.id)} style={[s.pickerRow, sel && s.pickerRowSel]} onPress={() => { setSelectedLocId(String(l.id)); setShowLocPicker(false); }}>
                    <View style={{ flex: 1 }}>
                      <AppText style={[s.pickerRowName, sel && { color: P.blue }]}>{l.nameEn}</AppText>
                      <AppText style={s.pickerRowCode}>{l.code}</AppText>
                    </View>
                    {sel && <AppText style={{ color: P.blue, fontSize: 16, fontWeight: '700' }}>✓</AppText>}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Open Shift */}
      <Modal visible={showOpenShift && !sessLoading} animationType="fade" transparent={false} onRequestClose={() => {}}>
        <SafeAreaView style={s.shiftRoot} edges={['top', 'bottom']}>
          <View style={s.shiftContent}>
            <View style={s.shiftIconBox}><AppText style={s.shiftIconTxt}>⊡</AppText></View>
            <AppText style={s.shiftTitle}>Open Shift</AppText>
            <AppText style={s.shiftSub}>Enter your opening float to begin the cashier session.</AppText>
            <View style={s.shiftField}>
              <AppText style={s.shiftFieldLbl}>Opening Float ($)</AppText>
              <TextInput style={s.shiftInput} value={openFloat} onChangeText={setOpenFloat} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor={P.muted} autoFocus />
            </View>
            <View style={s.shiftField}>
              <AppText style={s.shiftFieldLbl}>Exchange Rate (KHR / $1)</AppText>
              <TextInput style={s.shiftInput} value={openRate} onChangeText={setOpenRate} keyboardType="numeric" placeholder="4100" placeholderTextColor={P.muted} />
            </View>
            {openShiftErr ? <View style={s.shiftErrBox}><AppText style={{ color: P.red, textAlign: 'center', fontSize: 13 }}>{openShiftErr}</AppText></View> : null}
            <TouchableOpacity style={[s.shiftBtn, openingShift && s.shiftBtnDis]} onPress={handleOpenShift} disabled={openingShift}>
              {openingShift ? <ActivityIndicator color="#FFF" /> : <AppText style={s.shiftBtnTxt}>Open Shift</AppText>}
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Modal>

      {/* Close Shift */}
      <Modal visible={showCloseShift} animationType="slide" transparent onRequestClose={() => !closingShift && setShowCloseShift(false)}>
        <View style={s.overlay}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ width: '100%' }}>
            <View style={[s.closeSheet, { paddingBottom: insets.bottom + 16 }]}>
              {closeResult ? (
                <ScrollView showsVerticalScrollIndicator={false}>
                  <View style={s.closeResHdr}>
                    <AppText style={[s.closeResIcon, { color: closeResult.differenceCents === 0 ? P.green : P.amber }]}>
                      {closeResult.differenceCents === 0 ? '✓' : '!'}
                    </AppText>
                    <AppText style={s.closeResTitle}>Shift Closed</AppText>
                  </View>
                  <View style={s.closeResBox}>
                    {[
                      ['Expected Cash', fmt(closeResult.expectedCashCents), P.dark],
                      ['Counted Cash',  fmt(closeResult.closingCashCents),  P.dark],
                    ].map(([lbl, val, col]) => (
                      <View key={lbl} style={s.closeResRow}>
                        <AppText style={s.closeResLbl}>{lbl}</AppText>
                        <AppText style={[s.closeResVal, { color: col }]}>{val}</AppText>
                      </View>
                    ))}
                    <View style={[s.closeResRow, s.closeResDivider]}>
                      <AppText style={[s.closeResLbl, { fontWeight: '700', color: P.dark }]}>Difference</AppText>
                      <AppText style={[s.closeResVal, { color: closeResult.differenceCents === 0 ? P.green : closeResult.differenceCents > 0 ? P.blue : P.red, fontWeight: '800' }]}>
                        {closeResult.differenceCents > 0 ? '+' : ''}{fmt(closeResult.differenceCents)}
                      </AppText>
                    </View>
                  </View>
                  <TouchableOpacity style={s.shiftBtn} onPress={() => { setShowCloseShift(false); setCloseResult(null); setShowOpenShift(true); }}>
                    <AppText style={s.shiftBtnTxt}>Done — Open New Shift</AppText>
                  </TouchableOpacity>
                </ScrollView>
              ) : (
                <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                    <AppText style={{ fontSize: 19, fontWeight: '700', color: P.dark }}>Close Shift</AppText>
                    <TouchableOpacity onPress={() => setShowCloseShift(false)} disabled={closingShift} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <AppText style={{ fontSize: 18, color: P.muted }}>✕</AppText>
                    </TouchableOpacity>
                  </View>
                  {openSession && (
                    <View style={s.sessInfoBox}>
                      <AppText style={{ color: P.blue, fontWeight: '700', fontSize: 13 }}>{openSession.sessionNumber}</AppText>
                      <AppText style={{ color: P.muted, fontSize: 12 }}>Opening float: {fmt(openSession.openingFloatCents)}</AppText>
                    </View>
                  )}
                  <AppText style={s.denomSectionLbl}>CASH COUNT</AppText>
                  <View style={s.denomHdr}>
                    {['Denom.', 'Count', 'Subtotal'].map(h => (
                      <AppText key={h} style={[h === 'Denom.' ? s.denomCellDenom : h === 'Count' ? s.denomCellCount : s.denomCellSub, s.denomHdrTxt]}>{h}</AppText>
                    ))}
                  </View>
                  {DENOMS.map(d => {
                    const cnt = parseInt(denomCounts[d] || '0', 10) || 0;
                    const sub = d * cnt;
                    return (
                      <View key={d} style={s.denomRow}>
                        <AppText style={[s.denomCellDenom, { fontSize: 13, fontWeight: '700', color: P.dark }]}>{denomLabel(d)}</AppText>
                        <View style={[s.denomCellCount, { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 }]}>
                          <TouchableOpacity style={s.denomCtrlBtn} onPress={() => setDenomCounts(p => ({ ...p, [d]: String(Math.max(0, (parseInt(p[d] || '0', 10) || 0) - 1)) }))}>
                            <AppText style={s.denomCtrlTxt}>−</AppText>
                          </TouchableOpacity>
                          <TextInput
                            style={s.denomCountInput}
                            value={denomCounts[d]}
                            onChangeText={v => setDenomCounts(p => ({ ...p, [d]: v.replace(/[^0-9]/g, '') }))}
                            keyboardType="number-pad"
                            placeholder="0"
                            placeholderTextColor={P.muted}
                            selectTextOnFocus
                          />
                          <TouchableOpacity style={s.denomCtrlBtn} onPress={() => setDenomCounts(p => ({ ...p, [d]: String((parseInt(p[d] || '0', 10) || 0) + 1) }))}>
                            <AppText style={s.denomCtrlTxt}>+</AppText>
                          </TouchableOpacity>
                        </View>
                        <AppText style={[s.denomCellSub, { textAlign: 'right', color: sub > 0 ? P.blue : P.muted, fontWeight: sub > 0 ? '700' : '400' }]}>
                          {sub > 0 ? fmt(sub) : '—'}
                        </AppText>
                      </View>
                    );
                  })}
                  <View style={s.denomTotalRow}>
                    <AppText style={s.denomTotalLbl}>Total Cash</AppText>
                    <AppText style={s.denomTotalVal}>{fmt(closingTotal)}</AppText>
                  </View>
                  <View style={s.shiftField}>
                    <AppText style={s.shiftFieldLbl}>Note (optional)</AppText>
                    <TextInput
                      style={[s.shiftInput, { fontSize: 13, height: 50 }]}
                      value={closeNote}
                      onChangeText={setCloseNote}
                      placeholder="End of day note..."
                      placeholderTextColor={P.muted}
                      multiline
                    />
                  </View>
                  <TouchableOpacity
                    style={[s.shiftBtn, { backgroundColor: P.red }, closingShift && s.shiftBtnDis]}
                    onPress={handleCloseShift}
                    disabled={closingShift}
                  >
                    {closingShift ? <ActivityIndicator color="#FFF" /> : <AppText style={s.shiftBtnTxt}>Close Shift</AppText>}
                  </TouchableOpacity>
                </ScrollView>
              )}
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      {/* Discount modal */}
      <Modal visible={!!discModal} animationType="fade" transparent onRequestClose={() => setDiscModal(null)}>
        <KeyboardAvoidingView style={s.overlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={s.discSheet}>
            <View style={s.discHdr}>
              <AppText style={s.discTitle}>Set Discount</AppText>
              <TouchableOpacity onPress={() => setDiscModal(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <AppText style={s.discClose}>✕</AppText>
              </TouchableOpacity>
            </View>
            {discModal && (
              <AppText style={s.discProduct} numberOfLines={1}>{discModal.productName}</AppText>
            )}

            {/* Preset chips */}
            <View style={s.discPresets}>
              {[0, 5, 10, 15, 20, 25, 50].map(pct => {
                const active = parseFloat(discInput) === pct;
                return (
                  <TouchableOpacity
                    key={pct}
                    style={[s.discChip, active && s.discChipActive]}
                    onPress={() => setDiscInput(String(pct))}
                    activeOpacity={0.75}
                  >
                    <AppText style={[s.discChipTxt, active && s.discChipTxtActive]}>
                      {pct === 0 ? 'None' : `${pct}%`}
                    </AppText>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Custom input */}
            <View style={s.discInputRow}>
              <TextInput
                style={s.discInput}
                value={discInput}
                onChangeText={v => setDiscInput(v.replace(/[^0-9.]/g, ''))}
                keyboardType="decimal-pad"
                placeholder="0"
                placeholderTextColor={P.muted}
                selectTextOnFocus
                autoFocus
              />
              <AppText style={s.discPctSign}>%</AppText>
            </View>

            {/* Actions */}
            <View style={s.discActions}>
              <TouchableOpacity style={s.discCancelBtn} onPress={() => setDiscModal(null)} activeOpacity={0.8}>
                <AppText style={s.discCancelTxt}>Cancel</AppText>
              </TouchableOpacity>
              <TouchableOpacity
                style={s.discApplyBtn}
                onPress={() => discModal && applyDisc(discModal.productId, discInput)}
                activeOpacity={0.85}
              >
                <AppText style={s.discApplyTxt}>Apply</AppText>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Success toast */}
      {successMsg && (
        <View style={[s.toast, { bottom: insets.bottom + 24 }]}>
          <AppText style={s.toastTxt}>✓  {successMsg}</AppText>
          <TouchableOpacity onPress={() => setSuccessMsg(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <AppText style={{ color: 'rgba(255,255,255,0.8)', fontSize: 16 }}>✕</AppText>
          </TouchableOpacity>
        </View>
      )}
    </SafeAreaView>
  );
};

// ─── Styles ──────────────────────────────────────────────────
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: P.navyDark },

  // Header
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: P.navyDark, paddingHorizontal: 12, paddingVertical: 9, gap: 8,
  },
  headerLeft:  { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  brand:       { flexDirection: 'row', alignItems: 'baseline', gap: 5 },
  brandName:   { color: '#FFFFFF', fontSize: 15, fontWeight: '800', letterSpacing: 0.8 },
  brandVer:    { color: 'rgba(255,255,255,0.35)', fontSize: 10 },
  headerChip: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: 9, paddingVertical: 5, borderRadius: 6, maxWidth: 120,
  },
  hChipLabel: { color: 'rgba(255,255,255,0.45)', fontSize: 9, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.3 },
  hChipVal:   { flex: 1, color: '#FFFFFF', fontSize: 11, fontWeight: '600' },
  hChipArrow: { color: 'rgba(255,255,255,0.4)', fontSize: 10 },
  sessBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 8, paddingVertical: 5, borderRadius: 6, maxWidth: 130,
  },
  sessGreen: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#4ADE80' },
  sessTxt:   { color: '#FFFFFF', fontSize: 11, fontWeight: '600' },
  hBtn:      { paddingHorizontal: 10, paddingVertical: 6, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 6 },
  hBtnRed:   { backgroundColor: 'rgba(226,87,76,0.3)' },
  hBtnTxt:   { color: '#FFFFFF', fontSize: 12, fontWeight: '600' },
  avatar:    { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  avatarTxt: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },

  // Main
  main: { flex: 1, flexDirection: 'row', backgroundColor: P.bg },

  // Left panel
  leftPanel: {
    width: LEFT_W,
    backgroundColor: P.panel,
    borderRightWidth: 1,
    borderRightColor: P.border,
    flexDirection: 'column',
  },

  searchRow: { flexDirection: 'row', padding: 8, gap: 0, borderBottomWidth: 1, borderBottomColor: P.border },
  searchInput: {
    flex: 1, backgroundColor: P.bg, borderWidth: 1, borderColor: P.border,
    borderRadius: 5, paddingHorizontal: 8, paddingVertical: Platform.OS === 'ios' ? 7 : 5,
    fontSize: 11, color: P.dark,
  },

  // Customer card
  custCard: {
    flexDirection: 'row', alignItems: 'center', padding: 8, gap: 8,
    borderBottomWidth: 1, borderBottomColor: P.border, backgroundColor: P.stripe,
  },
  custAvatar:    { width: 38, height: 38, borderRadius: 19, backgroundColor: P.blue, alignItems: 'center', justifyContent: 'center' },
  custAvatarTxt: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
  custInfo:      { flex: 1 },
  custName:      { fontSize: 12, fontWeight: '700', color: P.dark },
  custSub:       { fontSize: 10, color: P.muted, marginBottom: 5 },
  custStats:     { flexDirection: 'row', alignItems: 'center' },
  statItem:      { flex: 1, alignItems: 'center' },
  statVal:       { fontSize: 11, fontWeight: '700', color: P.dark },
  statLbl:       { fontSize: 8, color: P.muted, textTransform: 'uppercase', letterSpacing: 0.2 },
  statDiv:       { width: 1, height: 20, backgroundColor: P.border },

  // Cart table
  cartHdr: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 6, paddingVertical: 5,
    backgroundColor: P.navy,
  },
  cartHdrTxt: { fontSize: 8, fontWeight: '700', color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase', letterSpacing: 0.3 },
  cartHCol: { paddingHorizontal: 1 },
  cartHColName:  { flex: 3 },
  cartHColCode:  { flex: 1.8 },
  cartHColQty:   { flex: 1.8 },
  cartHColDisc:  { flex: 1.4 },
  cartHColPrice: { flex: 2 },

  cartScroll: { flex: 1 },
  cartRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 6, paddingVertical: 6,
    borderBottomWidth: 1, borderBottomColor: P.border,
  },
  cartRowAlt: { backgroundColor: P.stripe },
  cartEmpty: { paddingTop: 32, alignItems: 'center', gap: 6 },
  cartEmptyTxt:  { color: P.mid, fontSize: 13, fontWeight: '500' },
  cartEmptyHint: { color: P.muted, fontSize: 11 },
  cartCellName:  { fontSize: 10, fontWeight: '600', color: P.dark, lineHeight: 13 },
  cartCellCode:  { fontSize: 9, color: P.muted },
  qtyCell: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 2 },
  qtyBtn:  { width: 17, height: 17, borderRadius: 4, backgroundColor: P.bg, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: P.border },
  qtyBtnTxt: { fontSize: 13, fontWeight: '700', color: P.mid, lineHeight: 17 },
  qtyNum:  { fontSize: 12, fontWeight: '700', color: P.dark, minWidth: 16, textAlign: 'center' },
  discBadge: {
    alignSelf: 'center', paddingHorizontal: 4, paddingVertical: 2,
    borderRadius: 4, backgroundColor: P.bg, borderWidth: 1, borderColor: P.border, alignItems: 'center',
  },
  discBadgeOn: { backgroundColor: '#FFF8E1', borderColor: P.amber },
  discTxt:     { fontSize: 9, fontWeight: '700', color: P.muted },
  discTxtOn:   { color: P.amber },
  strikePrice: { fontSize: 9, color: P.muted, textDecorationLine: 'line-through' },
  linePrice:   { fontSize: 11, fontWeight: '700', color: P.dark },
  linePriceDisc: { color: P.green },

  // Totals
  totals: { backgroundColor: P.navy, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 10, gap: 5 },
  totalRow:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  totLbl:     { fontSize: 10, fontWeight: '600', color: 'rgba(255,255,255,0.5)', letterSpacing: 0.5 },
  totVal:     { fontSize: 12, fontWeight: '700', color: 'rgba(255,255,255,0.8)' },
  totalGrand: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6, paddingTop: 8, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.15)' },
  grandLbl:   { fontSize: 12, fontWeight: '800', color: '#FFFFFF', letterSpacing: 1 },
  grandVal:   { fontSize: 22, fontWeight: '900', color: '#FFFFFF' },

  // Right panel
  rightPanel: { flex: 1, backgroundColor: P.bg },

  // Category strip
  catStrip:   { backgroundColor: P.navy, paddingVertical: 7 },
  catContent: { paddingHorizontal: 10, gap: 6, flexDirection: 'row' },
  catTile: {
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  catTileActive: { backgroundColor: P.teal },
  catTileTxt:    { fontSize: 12, fontWeight: '600', color: 'rgba(255,255,255,0.65)' },
  catTileTxtActive: { color: '#FFFFFF' },
  catTileAdd:    { backgroundColor: 'transparent', borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' },
  catTileAddTxt: { fontSize: 16, color: 'rgba(255,255,255,0.45)', fontWeight: '700' },

  // Product grid
  loadBox: { height: 180, alignItems: 'center', justifyContent: 'center', gap: 12 },
  retryBtn: { backgroundColor: P.blue, paddingHorizontal: 20, paddingVertical: 9, borderRadius: 8 },
  prodGrid: { flexDirection: 'row', flexWrap: 'wrap', padding: PROD_PAD, gap: PROD_GAP },
  prodTile: {
    width: PROD_W, backgroundColor: '#FFFFFF', borderRadius: 10, overflow: 'hidden',
    borderWidth: 1, borderColor: P.border,
  },
  prodTileOOS: { opacity: 0.4 },
  prodImg: { width: '100%', height: PROD_W * 0.65 },
  prodImgPlaceholder: {
    width: '100%', height: PROD_W * 0.65,
    backgroundColor: P.bg,
    alignItems: 'center', justifyContent: 'center',
  },
  prodInitial:  { color: P.muted, fontSize: PROD_W * 0.28, fontWeight: '700' },
  prodTileInfo: { padding: 7, gap: 3 },
  prodName:     { fontSize: 11, fontWeight: '600', color: P.dark, lineHeight: 14 },
  prodNameKh:   { fontSize: 10, color: P.muted, lineHeight: 13, marginTop: 1 },
  prodPrice:    { fontSize: 18, fontWeight: '900', color: '#FF3B30', marginTop: 4, letterSpacing: 0.3 },

  // Function tiles
  funcSection:    { paddingHorizontal: 12, paddingTop: 8 },
  funcSectionHdr: { fontSize: 10, fontWeight: '700', color: P.muted, letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 8 },
  funcGrid:       { flexDirection: 'row', flexWrap: 'wrap', gap: FUNC_GAP },
  funcTile: {
    width: FUNC_W, paddingVertical: 13, paddingHorizontal: 4,
    backgroundColor: P.func, borderRadius: 8,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: P.border,
  },
  funcTileActive: { backgroundColor: '#EFF6FF', borderColor: P.blue },
  funcTileTxt:    { fontSize: 10, fontWeight: '600', color: P.mid, textAlign: 'center' },
  funcTileTxtActive: { color: P.blue },

  // Bottom bar
  bottomBar: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: P.navyDark, paddingHorizontal: 10, paddingTop: 10, gap: 8,
  },
  bbBtn: { paddingHorizontal: 14, paddingVertical: 13, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  bbBtnTxt: { color: P.navyDark, fontSize: 12, fontWeight: '700' },
  bbPay: { flex: 1, backgroundColor: P.green, paddingVertical: 22, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  bbPayDis: { backgroundColor: P.mid },
  bbPayTxt: { color: '#FFFFFF', fontSize: 20, fontWeight: '900', letterSpacing: 0.6 },

  // Shared modal overlay
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },

  // Payment sheet
  paySheet: { backgroundColor: P.panel, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 22, gap: 14 },
  payHdr:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  payTitle: { fontSize: 19, fontWeight: '700', color: P.dark },
  payClose: { fontSize: 18, color: P.muted, padding: 4 },
  payMethods: { flexDirection: 'row', gap: 10 },
  payMethodBtn: { flex: 1, paddingVertical: 11, borderRadius: 9, alignItems: 'center', borderWidth: 1.5, borderColor: P.border, backgroundColor: P.bg },
  payMethodBtnOn: { borderColor: P.blue, backgroundColor: '#EFF6FF' },
  payMethodTxt:   { fontSize: 13, fontWeight: '600', color: P.muted },
  payMethodTxtOn: { color: P.blue },
  payDueRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: P.bg, padding: 14, borderRadius: 11 },
  payDueLbl: { fontSize: 14, color: P.muted, fontWeight: '500' },
  payDueVal: { fontSize: 26, fontWeight: '800', color: P.navy },
  payInputLbl: { fontSize: 12, color: P.muted, fontWeight: '500' },
  payInput: { borderWidth: 1.5, borderColor: P.border, borderRadius: 11, paddingHorizontal: 14, paddingVertical: 13, fontSize: 24, fontWeight: '700', color: P.dark, textAlign: 'right' },
  changeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#ECFDF5', padding: 12, borderRadius: 9 },
  changeLbl: { fontSize: 14, fontWeight: '600', color: P.green },
  changeVal: { fontSize: 20, fontWeight: '800', color: P.green },
  payErrBox: { backgroundColor: '#FEF2F2', borderRadius: 9, padding: 10 },
  payConfirm: { backgroundColor: P.green, borderRadius: 13, paddingVertical: 16, alignItems: 'center', justifyContent: 'center' },
  payConfirmDis: { backgroundColor: P.border },
  payConfirmTxt: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },

  // Pickers
  pickerOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  pickerSheet: { backgroundColor: P.panel, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '60%' },
  pickerHdr: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 18, borderBottomWidth: 1, borderBottomColor: P.border },
  pickerTitle: { fontSize: 16, fontWeight: '700', color: P.dark },
  pickerClose: { fontSize: 18, color: P.muted },
  pickerRow: { flexDirection: 'row', alignItems: 'center', padding: 15, borderBottomWidth: 1, borderBottomColor: P.border, gap: 10 },
  pickerRowSel: { backgroundColor: '#EFF6FF' },
  pickerRowName: { fontSize: 14, fontWeight: '600', color: P.dark },
  pickerRowCode: { fontSize: 11, color: P.muted, marginTop: 1 },

  // Open Shift
  shiftRoot:     { flex: 1, backgroundColor: P.bg, justifyContent: 'center' },
  shiftContent:  { padding: 30, gap: 18, alignItems: 'center' },
  shiftIconBox:  { width: 76, height: 76, borderRadius: 18, backgroundColor: '#DBEAFE', alignItems: 'center', justifyContent: 'center' },
  shiftIconTxt:  { fontSize: 34, color: P.blue },
  shiftTitle:    { fontSize: 24, fontWeight: '800', color: P.dark },
  shiftSub:      { fontSize: 13, color: P.muted, textAlign: 'center', lineHeight: 19 },
  shiftField:    { width: '100%', gap: 6 },
  shiftFieldLbl: { fontSize: 12, fontWeight: '600', color: P.mid },
  shiftInput:    { borderWidth: 1.5, borderColor: P.border, borderRadius: 11, paddingHorizontal: 14, paddingVertical: 13, fontSize: 18, fontWeight: '700', color: P.dark, backgroundColor: P.panel, textAlign: 'right' },
  shiftErrBox:   { width: '100%', backgroundColor: '#FEF2F2', borderRadius: 9, padding: 11 },
  shiftBtn:      { width: '100%', backgroundColor: P.navy, borderRadius: 13, paddingVertical: 16, alignItems: 'center', justifyContent: 'center', marginTop: 6 },
  shiftBtnDis:   { backgroundColor: P.border },
  shiftBtnTxt:   { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },

  // Close Shift
  closeSheet:     { backgroundColor: P.panel, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 18, paddingTop: 18, maxHeight: '92%' },
  sessInfoBox:    { backgroundColor: '#EFF6FF', borderRadius: 9, padding: 11, marginBottom: 14, gap: 3 },
  denomSectionLbl: { fontSize: 10, fontWeight: '700', color: P.muted, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 7 },
  denomHdr:       { flexDirection: 'row', paddingBottom: 5, borderBottomWidth: 1, borderBottomColor: P.border, marginBottom: 2 },
  denomHdrTxt:    { fontSize: 9, fontWeight: '700', color: P.muted, textTransform: 'uppercase' },
  denomRow:       { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: P.border },
  denomCellDenom: { width: 52 },
  denomCellCount: { flex: 1 },
  denomCellSub:   { width: 70, fontSize: 12 },
  denomCtrlBtn:   { width: 26, height: 26, borderRadius: 5, backgroundColor: P.bg, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: P.border },
  denomCtrlTxt:   { fontSize: 15, fontWeight: '700', color: P.mid, lineHeight: 24 },
  denomCountInput: { width: 40, textAlign: 'center', fontSize: 13, fontWeight: '700', color: P.dark, borderWidth: 1, borderColor: P.border, borderRadius: 5, paddingVertical: 3, backgroundColor: P.panel },
  denomTotalRow:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 2, borderTopColor: P.navy, paddingTop: 10, marginTop: 8, marginBottom: 14 },
  denomTotalLbl:  { fontSize: 15, fontWeight: '700', color: P.dark },
  denomTotalVal:  { fontSize: 20, fontWeight: '800', color: P.navy },

  // Close result
  closeResHdr:    { alignItems: 'center', gap: 10, paddingVertical: 18 },
  closeResIcon:   { fontSize: 46, fontWeight: '700' },
  closeResTitle:  { fontSize: 21, fontWeight: '800', color: P.dark },
  closeResBox:    { backgroundColor: P.bg, borderRadius: 13, padding: 15, gap: 9, marginBottom: 18 },
  closeResRow:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  closeResDivider:{ marginTop: 8, paddingTop: 10, borderTopWidth: 1, borderTopColor: P.border },
  closeResLbl:    { fontSize: 13, color: P.muted },
  closeResVal:    { fontSize: 15, fontWeight: '700', color: P.dark },

  // Discount modal
  discSheet: {
    backgroundColor: P.panel, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 22, gap: 16,
  },
  discHdr: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  discTitle: { fontSize: 18, fontWeight: '700', color: P.dark },
  discClose:  { fontSize: 18, color: P.muted, padding: 4 },
  discProduct: { fontSize: 13, color: P.muted, marginTop: -8 },
  discPresets: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  discChip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
    borderWidth: 1.5, borderColor: P.border, backgroundColor: P.bg,
  },
  discChipActive:  { borderColor: P.amber, backgroundColor: '#FFF8E1' },
  discChipTxt:     { fontSize: 13, fontWeight: '600', color: P.mid },
  discChipTxtActive: { color: '#B45309', fontWeight: '700' },
  discInputRow: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1.5, borderColor: P.border, borderRadius: 12,
    backgroundColor: P.bg, paddingHorizontal: 16,
  },
  discInput: {
    flex: 1, fontSize: 32, fontWeight: '700', color: P.dark,
    paddingVertical: 12, textAlign: 'right',
  },
  discPctSign: { fontSize: 24, fontWeight: '700', color: P.muted, marginLeft: 6 },
  discActions: { flexDirection: 'row', gap: 10 },
  discCancelBtn: {
    flex: 1, paddingVertical: 14, borderRadius: 12,
    borderWidth: 1.5, borderColor: P.border, alignItems: 'center',
  },
  discCancelTxt: { fontSize: 15, fontWeight: '600', color: P.mid },
  discApplyBtn: {
    flex: 2, paddingVertical: 14, borderRadius: 12,
    backgroundColor: P.amber, alignItems: 'center',
  },
  discApplyTxt: { fontSize: 15, fontWeight: '700', color: '#FFFFFF' },

  // Toast
  toast: {
    position: 'absolute', left: 16, right: 16,
    backgroundColor: P.green, borderRadius: 13,
    paddingHorizontal: 18, paddingVertical: 13,
    flexDirection: 'row', alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 8, elevation: 8,
  },
  toastTxt: { flex: 1, color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
});

export default POSScreen;
