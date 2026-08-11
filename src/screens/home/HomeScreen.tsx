import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  StatusBar,
  ActivityIndicator,
  FlatList,
  Modal,
  ScrollView,
  Image,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Dimensions,
  Animated,
  Easing,
  Alert,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons as Icon } from '@expo/vector-icons';
import AppText from '../../components/AppText';
import AppInput from '../../components/AppInput';
import AppButton from '../../components/AppButton';
import AppBar from '../../components/AppBar';
import SaleOrderDetailScreen from './SaleOrderDetailScreen';
import SignaturePad, { SignaturePadRef } from '../../components/SignaturePad';
import { User } from '../../models/User';
import { tabEvents } from '../../navigation/tabEvents';
import { useAlert } from '../../components/AppAlert';
import Colors from '../../theme/colors';
import {
  getSalesOrdersApi,
  getSalesOrderApi,
  getSaleOrderSignaturesApi,
  createDeliveryOrderApi,
  uploadDirectApi,
  uploadSaleOrderSignatureApi,
  updateSalesOrderStatusApi,
  updateSalesOrderItemsApi,
  getAllProductsApi,
  getCampusesApi,
  getInvoiceHeadersApi,
  ApiSalesOrder,
  ApiCampus,
  ApiProduct,
  ApiInvoiceHeader,
} from '../../services/focusApi';

interface HomeScreenProps {
  user: User | null;
  fcmToken?: string | null;
}

const PRIMARY       = '#2563EB';
const PRIMARY_LIGHT = '#EFF6FF';
const BG            = '#EEF2FF';
const CARD          = '#FFFFFF';
const TEXT          = '#0F172A';
const MUTED         = '#64748B';
const PURPLE        = '#7C3AED';

const STATUS_COLOR: Record<string, { bg: string; text: string; label: string }> = {
  draft:       { bg: '#FEF3C7', text: '#D97706', label: 'Draft' },
  prepare:     { bg: '#FEF3C7', text: '#D97706', label: 'Prepare' },
  sale_orders: { bg: '#DBEAFE', text: '#2563EB', label: 'Sale Order' },
  confirmed:   { bg: '#DBEAFE', text: '#2563EB', label: 'Confirmed' },
  delivering:  { bg: '#ECFDF5', text: '#059669', label: 'Delivering' },
  received:    { bg: '#D1FAE5', text: '#10B981', label: 'Received' },
  invoiced:    { bg: '#EDE9FE', text: '#7C3AED', label: 'Invoiced' },
  delivered:   { bg: '#D1FAE5', text: '#10B981', label: 'Delivered' },
  cancelled:   { bg: '#FEE2E2', text: '#EF4444', label: 'Cancelled' },
};

const ROW_COLORS = ['#2563EB', '#7C3AED', '#10B981', '#F59E0B', '#EF4444', '#06B6D4'];

// 3 cards visible: screen − row horizontal margin (14×2) − gap between cards (6×2)
const SIG_CARD_WIDTH = Math.floor((Dimensions.get('window').width - 28 - 12) / 3);
const SCREEN_H = Dimensions.get('window').height;

const formatTime = (iso: string): string => {
  try { return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }); }
  catch { return ''; }
};
const formatDate = (iso: string): string => {
  try { return new Date(iso).toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch { return ''; }
};
const calcTotal = (order: ApiSalesOrder): number => {
  if (order.totalCents != null) return order.totalCents / 100;
  if (!Array.isArray(order.items) || order.items.length === 0) return 0;
  return order.items.reduce((s, i) => s + i.qty * i.unitPriceCents - (i.discountCents ?? 0), 0) / 100;
};

// ─── Animated Confirm Icon ────────────────────────────────────────────────────

const AnimatedConfirmIcon: React.FC = () => {
  const bounceY    = useRef(new Animated.Value(0)).current;
  const checkScale = useRef(new Animated.Value(0.6)).current;
  const checkOpacity = useRef(new Animated.Value(0)).current;
  const line1W     = useRef(new Animated.Value(0)).current;
  const line2W     = useRef(new Animated.Value(0)).current;
  const line3W     = useRef(new Animated.Value(0)).current;
  const glowOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Body bounce loop
    Animated.loop(
      Animated.sequence([
        Animated.timing(bounceY, { toValue: -5, duration: 400, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(bounceY, { toValue: 0,  duration: 400, easing: Easing.in(Easing.quad),  useNativeDriver: true }),
      ]),
    ).start();

    // Lines draw in sequence then repeat
    Animated.loop(
      Animated.sequence([
        Animated.timing(line1W, { toValue: 1, duration: 300, useNativeDriver: false }),
        Animated.timing(line2W, { toValue: 1, duration: 300, useNativeDriver: false }),
        Animated.timing(line3W, { toValue: 1, duration: 300, useNativeDriver: false }),
        Animated.delay(600),
        Animated.parallel([
          Animated.timing(line1W, { toValue: 0, duration: 200, useNativeDriver: false }),
          Animated.timing(line2W, { toValue: 0, duration: 200, useNativeDriver: false }),
          Animated.timing(line3W, { toValue: 0, duration: 200, useNativeDriver: false }),
        ]),
        Animated.delay(200),
      ]),
    ).start();

    // Check badge pop in then pulse
    Animated.sequence([
      Animated.delay(400),
      Animated.parallel([
        Animated.spring(checkScale, { toValue: 1, tension: 80, friction: 6, useNativeDriver: true }),
        Animated.timing(checkOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
      ]),
    ]).start(() => {
      Animated.loop(
        Animated.sequence([
          Animated.timing(checkScale, { toValue: 1.15, duration: 350, easing: Easing.out(Easing.ease), useNativeDriver: true }),
          Animated.timing(checkScale, { toValue: 1.0,  duration: 350, easing: Easing.in(Easing.ease),  useNativeDriver: true }),
        ]),
      ).start();
    });

    // Glow pulse behind badge
    Animated.loop(
      Animated.sequence([
        Animated.timing(glowOpacity, { toValue: 0.35, duration: 700, useNativeDriver: true }),
        Animated.timing(glowOpacity, { toValue: 0,    duration: 700, useNativeDriver: true }),
      ]),
    ).start();
  }, []);

  return (
    <Animated.View style={{ transform: [{ translateY: bounceY }], width: 100, height: 90, alignItems: 'center', justifyContent: 'center', marginBottom: 8 }}>
      {/* Document */}
      <View style={{ width: 62, height: 74, backgroundColor: '#EFF6FF', borderRadius: 8, borderWidth: 1.5, borderColor: '#BFDBFE', padding: 10, justifyContent: 'flex-start', gap: 8 }}>
        {/* Doc header bar */}
        <View style={{ width: '100%', height: 8, backgroundColor: PRIMARY, borderRadius: 3 }} />
        {/* Lines */}
        <Animated.View style={{ height: 5, borderRadius: 3, backgroundColor: '#93C5FD', width: line1W.interpolate({ inputRange: [0, 1], outputRange: ['0%', '90%'] }) }} />
        <Animated.View style={{ height: 5, borderRadius: 3, backgroundColor: '#93C5FD', width: line2W.interpolate({ inputRange: [0, 1], outputRange: ['0%', '75%'] }) }} />
        <Animated.View style={{ height: 5, borderRadius: 3, backgroundColor: '#93C5FD', width: line3W.interpolate({ inputRange: [0, 1], outputRange: ['0%', '55%'] }) }} />
      </View>

      {/* Glow behind badge */}
      <Animated.View style={{
        position: 'absolute', bottom: 2, right: 8,
        width: 30, height: 30, borderRadius: 15,
        backgroundColor: '#10B981', opacity: glowOpacity,
        transform: [{ scale: 1.6 }],
      }} />

      {/* Check badge */}
      <Animated.View style={{
        position: 'absolute', bottom: 2, right: 8,
        width: 26, height: 26, borderRadius: 13,
        backgroundColor: '#10B981',
        alignItems: 'center', justifyContent: 'center',
        opacity: checkOpacity,
        transform: [{ scale: checkScale }],
        shadowColor: '#10B981', shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.4, shadowRadius: 4, elevation: 4,
      }}>
        <Icon name="check" size={15} color="#FFFFFF" />
      </Animated.View>
    </Animated.View>
  );
};

// ─── Animated Truck Icon ──────────────────────────────────────────────────────

const AnimatedTruckIcon: React.FC = () => {
  const bounceY   = useRef(new Animated.Value(0)).current;
  const wheelRot  = useRef(new Animated.Value(0)).current;
  const line1Opacity = useRef(new Animated.Value(0.8)).current;
  const line2Opacity = useRef(new Animated.Value(0.2)).current;
  const line3Opacity = useRef(new Animated.Value(0.5)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(bounceY, { toValue: -4, duration: 300, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(bounceY, { toValue: 0,  duration: 300, easing: Easing.in(Easing.quad),  useNativeDriver: true }),
      ]),
    ).start();

    Animated.loop(
      Animated.timing(wheelRot, { toValue: 1, duration: 600, easing: Easing.linear, useNativeDriver: true }),
    ).start();

    Animated.loop(
      Animated.sequence([
        Animated.timing(line1Opacity, { toValue: 0.1, duration: 250, useNativeDriver: true }),
        Animated.timing(line1Opacity, { toValue: 0.9, duration: 250, useNativeDriver: true }),
      ]),
    ).start();
    Animated.loop(
      Animated.sequence([
        Animated.delay(80),
        Animated.timing(line2Opacity, { toValue: 0.8, duration: 250, useNativeDriver: true }),
        Animated.timing(line2Opacity, { toValue: 0.1, duration: 250, useNativeDriver: true }),
      ]),
    ).start();
    Animated.loop(
      Animated.sequence([
        Animated.delay(160),
        Animated.timing(line3Opacity, { toValue: 0.9, duration: 250, useNativeDriver: true }),
        Animated.timing(line3Opacity, { toValue: 0.3, duration: 250, useNativeDriver: true }),
      ]),
    ).start();
  }, []);

  const spin = wheelRot.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  return (
    <Animated.View style={{ transform: [{ translateY: bounceY }], alignItems: 'center', justifyContent: 'center', width: 100, height: 80, marginBottom: 8 }}>
      {/* Motion lines */}
      <View style={{ position: 'absolute', left: 2, top: 18, gap: 5 }}>
        <Animated.View style={{ width: 12, height: 2.5, borderRadius: 1.5, backgroundColor: PRIMARY, opacity: line1Opacity }} />
        <Animated.View style={{ width: 9,  height: 2.5, borderRadius: 1.5, backgroundColor: PRIMARY, opacity: line2Opacity }} />
        <Animated.View style={{ width: 7,  height: 2.5, borderRadius: 1.5, backgroundColor: PRIMARY, opacity: line3Opacity }} />
      </View>

      {/* Truck body */}
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', marginLeft: 12 }}>
        {/* Cargo */}
        <View style={{ width: 44, height: 28, backgroundColor: PRIMARY, borderRadius: 4, justifyContent: 'center', alignItems: 'center' }}>
          <View style={{ width: 20, height: 8, backgroundColor: '#3B82F6', borderRadius: 2 }} />
        </View>
        {/* Cab */}
        <View style={{ width: 24, height: 28, backgroundColor: '#1D4ED8', borderRadius: 4, justifyContent: 'flex-start', alignItems: 'center', paddingTop: 3 }}>
          <View style={{ width: 14, height: 10, backgroundColor: '#BFDBFE', borderRadius: 2 }} />
          {/* Headlight */}
          <View style={{ position: 'absolute', right: 1, bottom: 8, width: 3, height: 6, backgroundColor: '#FEF3C7', borderRadius: 1 }} />
        </View>
      </View>

      {/* Wheels */}
      <View style={{ flexDirection: 'row', marginLeft: 12, marginTop: -6, gap: 0 }}>
        <View style={{ width: 44, flexDirection: 'row', justifyContent: 'space-around', paddingHorizontal: 4 }}>
          {/* Rear wheel */}
          <Animated.View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: '#1E293B', alignItems: 'center', justifyContent: 'center', transform: [{ rotate: spin }] }}>
            <View style={{ width: 8, height: 1.5, backgroundColor: '#4B5563', position: 'absolute' }} />
            <View style={{ width: 1.5, height: 8, backgroundColor: '#4B5563', position: 'absolute' }} />
            <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: '#94A3B8' }} />
          </Animated.View>
        </View>
        <View style={{ width: 24, alignItems: 'center' }}>
          {/* Front wheel */}
          <Animated.View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: '#1E293B', alignItems: 'center', justifyContent: 'center', transform: [{ rotate: spin }] }}>
            <View style={{ width: 8, height: 1.5, backgroundColor: '#4B5563', position: 'absolute' }} />
            <View style={{ width: 1.5, height: 8, backgroundColor: '#4B5563', position: 'absolute' }} />
            <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: '#94A3B8' }} />
          </Animated.View>
        </View>
      </View>
    </Animated.View>
  );
};

// ─── SO Row (cloned from SaleOrdersListScreen) ────────────────────────────────

const SIG_TYPE_COLOR: Record<string, { bg: string; text: string; label?: string }> = {
  PREPARE:  { bg: '#FEF3C7', text: '#D97706' },
  CONFIRM:  { bg: '#DBEAFE', text: '#2563EB' },
  RECEIVED: { bg: '#D1FAE5', text: '#059669' },
  INVOICED: { bg: '#EDE9FE', text: '#7C3AED', label: 'INVOICED' },
};

const SORow: React.FC<{
  order: ApiSalesOrder;
  index: number;
  campusMap: Record<string, ApiCampus>;
  sigMap: Record<string, Array<{ url: string; type: string; createdAt: string }>>;
  onPress: () => void;
}> = ({ order, index, campusMap, sigMap, onPress }) => {
  const color      = ROW_COLORS[index % ROW_COLORS.length];
  const statusKey  = (order.status ?? '').toLowerCase();
  const s          = STATUS_COLOR[statusKey] ?? { bg: Colors.divider, text: MUTED, label: order.status ?? '' };
  const total      = calcTotal(order);
  const ref        = order.referenceNumber ?? order.ref ?? order.id;
  const campusCode = order.campusCode ?? order.campus?.campusCode
    ?? (order.campusId != null ? campusMap[String(order.campusId)]?.campusCode : undefined) ?? null;
  const creatorName = order.createdByName ?? order.createdByUser?.name ?? order.createdByUser?.email ?? null;
  const sigs       = sigMap[order.id] ?? [];

  return (
    <TouchableOpacity style={styles.rowWrap} activeOpacity={0.7} onPress={onPress}>
      <View style={styles.rowMain}>
        <View style={[styles.indexBox, { backgroundColor: `${color}18` }]}>
          <AppText style={[styles.indexText, { color }]}>{index + 1}</AppText>
        </View>
        <View style={styles.rowBody}>
          <AppText style={styles.ref} numberOfLines={1}>{ref}</AppText>
          <View style={styles.rowMeta}>
            {campusCode ? (
              <View style={styles.campusChip}>
                <Icon name="place" size={10} color={PRIMARY} />
                <AppText style={styles.campusChipText}>{campusCode}</AppText>
              </View>
            ) : null}
            {creatorName ? (
              <View style={styles.creatorChip}>
                <Icon name="person-outline" size={10} color={MUTED} />
                <AppText style={styles.creatorChipText} numberOfLines={1}>{creatorName}</AppText>
              </View>
            ) : null}
            <AppText style={styles.dateText}>{formatDate(order.createdAt)}</AppText>
          </View>
        </View>
        <View style={styles.rowRight}>
          <AppText style={styles.amount}>${total.toFixed(2)}</AppText>
          <View style={[styles.statusBadge, { backgroundColor: s.bg }]}>
            <AppText style={[styles.statusText, { color: s.text }]}>{s.label}</AppText>
          </View>
        </View>
        <Icon name="chevron-right" size={18} color="#D0D0D0" />
      </View>

      {sigs.length > 0 ? (
        <View style={styles.sigRow}>
          <View style={styles.sigHeader}>
            <Icon name="draw" size={11} color={MUTED} />
            <AppText style={styles.sigLabel}>Signatures ({sigs.length})</AppText>
          </View>
          {(() => {
            const orderStatus = (order.status ?? '').toLowerCase();
            const isInvoiced = orderStatus === 'invoiced' || orderStatus === 'paid';
            const lastReceivedIdx = isInvoiced
              ? sigs.map((s, i) => s.type?.toUpperCase() === 'RECEIVED' ? i : -1).filter(i => i >= 0).pop() ?? -1
              : -1;
            return (
              <View style={{ flexDirection: 'row', gap: 6, paddingVertical: 2 }}>
                {sigs.map((item, i) => {
                  const displayType = (i === lastReceivedIdx) ? 'INVOICED' : item.type?.toUpperCase();
                  const tc = SIG_TYPE_COLOR[displayType] ?? { bg: '#F0F0F0', text: MUTED };
                  return (
                    <View key={i} style={styles.sigCard}>
                      <View style={[styles.sigCardAccent, { backgroundColor: tc.text }]} />
                      <View style={styles.sigImageWrap}>
                        <Image source={{ uri: item.url }} style={styles.sigImage} resizeMode="contain" />
                      </View>
                      <View style={styles.sigCardFooter}>
                        <View style={[styles.sigTypeChip, { backgroundColor: tc.bg }]}>
                          <AppText style={[styles.sigTypeText, { color: tc.text }]}>{tc.label ?? displayType}</AppText>
                        </View>
                        <AppText style={styles.sigItemDate}>{formatDate(item.createdAt)}</AppText>
                      </View>
                    </View>
                  );
                })}
              </View>
            );
          })()}
        </View>
      ) : null}
    </TouchableOpacity>
  );
};

// ─── Screen ───────────────────────────────────────────────────────────────────

const HomeScreen: React.FC<HomeScreenProps> = ({ user, fcmToken }) => {
  const insets = useSafeAreaInsets();
  const { showAlert, hideAlert } = useAlert();


  // List state
  const [docType, setDocType]   = useState<'SO' | 'DO' | 'RV'>('SO');
  const [orders, setOrders]     = useState<ApiSalesOrder[]>([]);
  const [campusMap, setCampusMap] = useState<Record<string, ApiCampus>>({});
  const [unpaidInvoices, setUnpaidInvoices] = useState<ApiInvoiceHeader[]>([]);
  const [sigMap, setSigMap]     = useState<Record<string, Array<{ url: string; type: string; createdAt: string }>>>({});
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);

  // Convert SO → DO modal state
  const [selectedOrder, setSelectedOrder] = useState<ApiSalesOrder | null>(null);
  const [soDetail, setSoDetail]           = useState<ApiSalesOrder | null>(null);
  const [productMap, setProductMap]       = useState<Record<string, ApiProduct>>({});
  const [detailLoading, setDetailLoading] = useState(false);
  const [itemDiscounts, setItemDiscounts] = useState<Record<string, string>>({});
  const [itemQtys, setItemQtys]           = useState<Record<string, string>>({});
  const [receivedBy, setReceivedBy]       = useState('');
  const [note, setNote]                   = useState('');
  const [submitting, setSubmitting]       = useState(false);
  const [submitError, setSubmitError]     = useState<string | null>(null);
  const [sigUploading, setSigUploading]     = useState(false);
  const [sigUploaded, setSigUploaded]       = useState(false);
  const [sigUploadedUrl, setSigUploadedUrl] = useState<string | null>(null);
  const [hasSig, setHasSig]               = useState(false);
  const [pendingSubmit, setPendingSubmit]   = useState(false);
  const [showEditScreen, setShowEditScreen] = useState(false);
  const sigRef    = useRef<SignaturePadRef>(null);

  const fetchAll = useCallback(() => {
    setLoading(true);
    setError(null);
    Promise.all([
      getSalesOrdersApi(),
      getCampusesApi().catch(() => [] as ApiCampus[]),
      getInvoiceHeadersApi().catch(() => [] as ApiInvoiceHeader[]),
    ])
      .then(([soData, campuses, headers]) => {
        setOrders(soData.map(o => ({ ...o, status: (o.status ?? '').toLowerCase() })));
        const cMap: Record<string, ApiCampus> = {};
        campuses.forEach(c => { cMap[String(c.id)] = c; });
        setCampusMap(cMap);
        setUnpaidInvoices(headers.filter(h => (h.status ?? '').toLowerCase() === 'issued'));

        // Fetch all signatures in parallel
        Promise.all(soData.map(o => getSaleOrderSignaturesApi(o.id))).then(results => {
          const sMap: Record<string, Array<{ url: string; type: string; createdAt: string }>> = {};
          results.forEach((sigs, i) => {
            if (!sigs.length) return;
            sMap[soData[i].id] = [...sigs]
              .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
              .map(s => ({ url: s.signatureUrl, type: s.type, createdAt: s.createdAt }));
          });
          setSigMap(sMap);
        }).catch(() => {});
      })
      .catch(err => setError(err?.message ?? 'Failed to load orders'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  useEffect(() => tabEvents.on('Home', () => fetchAll()), [fetchAll]);

  // Load full order detail (with items + discounts) + product names whenever a modal opens
  useEffect(() => {
    if (!selectedOrder) {
      setSoDetail(null); setProductMap({}); setItemDiscounts({}); setItemQtys({}); return;
    }
    setDetailLoading(true);
    Promise.all([
      getSalesOrderApi(selectedOrder.id),
      getAllProductsApi().catch(() => [] as ApiProduct[]),
    ])
      .then(([detail, products]) => {
        // Build productId → product lookup
        const pMap: Record<string, ApiProduct> = {};
        products.forEach(p => { pMap[p.id] = p; });
        setProductMap(pMap);
        setSoDetail(detail);
        const discMap: Record<string, string> = {};
        const qtyMap: Record<string, string> = {};
        (detail.items ?? []).forEach(item => {
          const lineCents = item.qty * item.unitPriceCents;
          const disc = item.discountCents ?? 0;
          const pct = lineCents > 0 ? (disc / lineCents) * 100 : 0;
          discMap[item.id] = pct === 0 ? '' : pct.toFixed(1);
          qtyMap[item.id] = String(item.qty);
        });
        setItemDiscounts(discMap);
        setItemQtys(qtyMap);
        setReceivedBy(detail.receivedBy ?? '');
        setNote(detail.note ?? '');
      })
      .catch(() => {})
      .finally(() => setDetailLoading(false));
  }, [selectedOrder?.id]);

  // SO tab: sale_orders (needs to be confirmed → confirmed)
  const filteredSO = useMemo(() =>
    orders.filter(o => (o.status ?? '').toLowerCase() === 'sale_orders'),
  [orders]);

  // DO tab: confirmed (needs delivery order → received)
  const filteredConfirmed = useMemo(() =>
    orders.filter(o => (o.status ?? '').toLowerCase() === 'confirmed'),
  [orders]);

  // RV tab: received
  const filteredReceived = useMemo(() =>
    orders.filter(o => (o.status ?? '').toLowerCase() === 'received'),
  [orders]);

  const grandTotal     = useMemo(() => filteredSO.reduce((s, o) => s + calcTotal(o), 0), [filteredSO]);
  const confirmedTotal = useMemo(() => filteredConfirmed.reduce((s, o) => s + calcTotal(o), 0), [filteredConfirmed]);
  const receivedTotal  = useMemo(() => filteredReceived.reduce((s, o) => s + calcTotal(o), 0), [filteredReceived]);

  const isOwner = user?.role === 'owner';
  const unpaidTotal = useMemo(
    () => unpaidInvoices.reduce((s, h) => s + (Number(h.totalCents) || 0), 0) / 100,
    [unpaidInvoices],
  );

  // Live total in the modal, recalculated as user edits qty/discount
  const modalTotal = useMemo(() => {
    if (!soDetail?.items?.length) return selectedOrder ? calcTotal(selectedOrder) : 0;
    return soDetail.items.reduce((sum, item) => {
      const qty = parseInt(itemQtys[item.id] ?? String(item.qty), 10) || item.qty;
      const pct = parseFloat(itemDiscounts[item.id] ?? '0') || 0;
      return sum + qty * item.unitPriceCents * (1 - pct / 100) / 100;
    }, 0);
  }, [soDetail, itemDiscounts, itemQtys, selectedOrder]);

  // ── Close modal & reset ──────────────────────────────────────────────────────
  const closeModal = () => {
    hideAlert();
    setSelectedOrder(null);
    setSoDetail(null);
    setProductMap({});
    setItemDiscounts({});
    setItemQtys({});
    setDetailLoading(false);
    setReceivedBy('');
    setNote('');
    setSubmitError(null);
    setSigUploaded(false);
    setSigUploadedUrl(null);
    setHasSig(false);
    setPendingSubmit(false);
    setShowEditScreen(false);
    sigRef.current?.clear();
  };

  const getFlowType = (order: ApiSalesOrder | null) => {
    const s = (order?.status ?? '').toLowerCase();
    if (s === 'sale_orders') return 'confirm'; // → CONFIRMED
    if (s === 'confirmed') return 'do';       // → RECEIVED
    return 'done';                            // received, invoiced, paid, cancelled
  };

  // ── Submit ────────────────────────────────────────────────────────────────────
  const performSubmit = async () => {
    if (!selectedOrder) return;
    const flow = getFlowType(selectedOrder);
    setSubmitting(true);
    setSubmitError(null);
    try {
      // Patch discount changes before proceeding (non-blocking — endpoint may not exist)
      if (soDetail?.items?.length) {
        try {
          const changed = soDetail.items
            .map(item => {
              const newQty = parseInt(itemQtys[item.id] ?? String(item.qty), 10) || item.qty;
              const pct = parseFloat(itemDiscounts[item.id] ?? '0') || 0;
              const newDisc = Math.round(newQty * item.unitPriceCents * pct / 100);
              const qtyChanged = newQty !== item.qty;
              const discChanged = newDisc !== (item.discountCents ?? 0);
              return { item, newQty, newDisc, qtyChanged, discChanged };
            })
            .filter(x => x.qtyChanged || x.discChanged);
          if (changed.length > 0) {
            await updateSalesOrderItemsApi(
              selectedOrder.id,
              changed.map(x => ({ id: x.item.id, qty: x.newQty, discountCents: x.newDisc })),
            );
          }
        } catch {
        }
      }

      const sigType = flow === 'confirm' ? 'CONFIRM' : 'RECEIVED';
      let signatureUrl: string | undefined = sigUploadedUrl ?? undefined;
      if (!signatureUrl && !sigRef.current?.isEmpty()) {
        const pngDataUrl = await sigRef.current!.toPNG();
        signatureUrl = await uploadDirectApi({
          uri: pngDataUrl, type: 'image/png',
          fileName: `sig-${selectedOrder.id}.png`,
        });
      }
      if (signatureUrl) {
        await uploadSaleOrderSignatureApi(selectedOrder.id, signatureUrl, sigType);
      }

      if (flow === 'confirm') {
        // SALE_ORDERS → CONFIRMED
        await updateSalesOrderStatusApi(selectedOrder.id, 'CONFIRMED');
        setOrders(prev => prev.map(o =>
          o.id === selectedOrder.id ? { ...o, status: 'confirmed' } : o,
        ));
        closeModal();
        setTimeout(() => fetchAll(), 1500);
        setTimeout(() => showAlert({ type: 'success', title: 'Order Confirmed', message: 'Status updated to Confirmed.', autoClose: 2500 }), 300);
        return;
      }

      // DO flow: update SO status to RECEIVED
      await updateSalesOrderStatusApi(selectedOrder.id, 'RECEIVED');
      setOrders(prev => prev.map(o =>
        o.id === selectedOrder.id ? { ...o, status: 'received' } : o,
      ));
      closeModal();
      setTimeout(() => fetchAll(), 1500);
      setTimeout(() => showAlert({ type: 'success', title: 'Status Updated', message: 'Order marked as Received.', autoClose: 2500 }), 300);
    } catch (err: any) {
      const msg = err?.response?.data?.error?.messageKey
        ?? err?.response?.data?.message
        ?? err?.message
        ?? 'Failed to submit';
      setSubmitError(msg);
      showAlert({ type: 'error', title: 'Error', message: msg });
    } finally {
      setSubmitting(false);
    }
  };

  const doSubmit = () => {
    if (!selectedOrder) return;
    const flow = getFlowType(selectedOrder);
    if (flow === 'done') return;

    if (sigRef.current?.isEmpty() && !sigUploadedUrl) {
      showAlert({ type: 'warning', title: 'Signature Required', message: 'Please draw a signature before submitting.' });
      return;
    }

    setPendingSubmit(true);
  };

  const handleQuickReceive = (order: ApiSalesOrder) => {
    showAlert({
      type: 'confirm',
      title: 'Mark as Received',
      message: `Confirm marking order ${order.referenceNumber ?? order.id} as Received?`,
      actions: [
        { label: 'Cancel', variant: 'outline' },
        { label: 'Confirm', variant: 'primary', onPress: async () => {
          try {
            await updateSalesOrderStatusApi(order.id, 'RECEIVED');
            setOrders(prev => prev.map(o => o.id === order.id ? { ...o, status: 'received' } : o));
            setTimeout(() => fetchAll(), 1500);
            setTimeout(() => showAlert({ type: 'success', title: 'Status Updated', message: 'Order marked as Received.', autoClose: 2500 }), 300);
          } catch (err: any) {
            showAlert({ type: 'error', title: 'Error', message: err?.message ?? 'Failed to update status' });
          }
        }},
      ],
    });
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={PRIMARY} />

      {/* Top Bar */}
      <View style={[styles.topBar, { paddingTop: insets.top, justifyContent: 'space-between' }]}>
        <View>
          <AppText style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)', fontWeight: '500' }}>
            {(() => {
              const h = new Date().getHours();
              return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
            })()}
          </AppText>
          <AppText style={{ fontSize: 16, color: '#FFFFFF', fontWeight: '800' }}>
            {user?.name ?? ''}
          </AppText>
          {fcmToken ? (
            <TouchableOpacity
              onPress={() => Alert.alert('FCM Token', fcmToken)}
              activeOpacity={0.7}
              style={{ marginTop: 4 }}
            >
              <AppText style={{ fontSize: 10, color: 'rgba(255,255,255,0.55)', fontFamily: 'monospace' }}>
                FCM: {fcmToken.slice(0, 14)}…{fcmToken.slice(-6)}
              </AppText>
            </TouchableOpacity>
          ) : null}
        </View>
        <TouchableOpacity style={styles.avatar} activeOpacity={0.8}>
          <Icon name="notifications-none" size={20} color="#FFFFFF" />
        </TouchableOpacity>
      </View>

      <View style={{ flex: 1 }}>
      {/* Unpaid Invoices — owner only */}
      {isOwner && (
        <View style={styles.kpiCard}>
          <View style={styles.kpiHeader}>
            <View style={styles.kpiIconBox}>
              <Icon name="receipt-long" size={22} color="#FFFFFF" />
            </View>
            <View style={styles.kpiTexts}>
              <AppText style={styles.kpiLabel}>Unpaid Invoices</AppText>
              <AppText style={styles.kpiValue}>${unpaidTotal.toFixed(2)}</AppText>
            </View>
            <View style={styles.kpiBadge}>
              <AppText style={styles.kpiBadgeText}>{unpaidInvoices.length}</AppText>
            </View>
          </View>
          {loading ? (
            <ActivityIndicator color={PURPLE} style={{ marginTop: 20 }} />
          ) : unpaidInvoices.length === 0 ? (
            <AppText style={styles.kpiEmpty}>No unpaid invoices</AppText>
          ) : (
            <FlatList
              data={unpaidInvoices}
              keyExtractor={item => item.id}
              contentContainerStyle={styles.kpiList}
              showsVerticalScrollIndicator={false}
              renderItem={({ item }) => {
                const amt = (Number(item.totalCents) || 0) / 100;
                const campus = item.campusCode ?? item.campus?.campusCode ?? null;
                const customer = item.customerOrg?.nameEn ?? item.customerOrg?.name ?? null;
                return (
                  <View style={styles.kpiRow}>
                    <View style={styles.kpiRowLeft}>
                      <AppText style={styles.kpiInvNum}>{item.invoiceNumber}</AppText>
                      <View style={styles.kpiMeta}>
                        {campus ? (
                          <View style={styles.kpiChip}>
                            <AppText style={styles.kpiChipText}>{campus}</AppText>
                          </View>
                        ) : null}
                        {customer ? (
                          <AppText style={styles.kpiMetaText} numberOfLines={1}>{customer}</AppText>
                        ) : null}
                      </View>
                      {item.dueAt ? (
                        <AppText style={styles.kpiNote}>Due {formatDate(item.dueAt)}</AppText>
                      ) : null}
                    </View>
                    <View style={styles.kpiRowRight}>
                      <AppText style={styles.kpiRowAmt}>${amt.toFixed(2)}</AppText>
                      {item.issuedAt ? (
                        <AppText style={styles.kpiDue}>{formatDate(item.issuedAt)}</AppText>
                      ) : null}
                    </View>
                  </View>
                );
              }}
            />
          )}
        </View>
      )}

      {/* Orders Card */}
      <View style={[styles.card, styles.ordersCard, isOwner ? { flex: 1, height: undefined } : null]}>

        {/* Header */}
        <View style={styles.cardHeader}>
          <AppText style={styles.cardTitle}>Today's Orders</AppText>
          {!loading && !error && (
            <View style={styles.countBadge}>
              <AppText style={styles.countBadgeText}>
                {docType === 'SO' ? filteredSO.length : docType === 'DO' ? filteredConfirmed.length : filteredReceived.length}
              </AppText>
            </View>
          )}
          <TouchableOpacity onPress={() => { fetchAll(); setDocType('SO'); }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Icon name="refresh" size={18} color={MUTED} />
          </TouchableOpacity>
        </View>

        {/* SO / DO / RV Toggle */}
        <View style={styles.toggleRow}>
          {(['SO', 'DO', 'RV'] as const).map(t => (
            <TouchableOpacity
              key={t}
              style={[styles.toggleBtn, docType === t && styles.toggleBtnActive]}
              onPress={() => setDocType(t)}
              activeOpacity={0.75}
            >
              <AppText style={[styles.toggleLabel, docType === t && styles.toggleLabelActive]}>
                {t === 'SO' ? 'Sale Order' : t === 'DO' ? 'Delivery' : 'Received'}
              </AppText>
            </TouchableOpacity>
          ))}
        </View>

        {/* Summary row */}
        {!loading && !error && (
          <View style={styles.summaryRow}>
            {docType === 'SO' ? (
              <>
                <View style={styles.summaryBox}>
                  <AppText style={styles.summaryNum}>{filteredSO.length}</AppText>
                  <AppText style={styles.summaryLabel}>Prepare</AppText>
                </View>
                <View style={styles.summaryDivider} />
                <View style={styles.summaryBox}>
                  <AppText style={styles.summaryNum}>${grandTotal.toFixed(2)}</AppText>
                  <AppText style={styles.summaryLabel}>Amount</AppText>
                </View>
              </>
            ) : docType === 'DO' ? (
              <>
                <View style={styles.summaryBox}>
                  <AppText style={styles.summaryNum}>{filteredConfirmed.length}</AppText>
                  <AppText style={styles.summaryLabel}>Confirmed</AppText>
                </View>
                <View style={styles.summaryDivider} />
                <View style={styles.summaryBox}>
                  <AppText style={styles.summaryNum}>${confirmedTotal.toFixed(2)}</AppText>
                  <AppText style={styles.summaryLabel}>Amount</AppText>
                </View>
              </>
            ) : docType === 'RV' ? (
              <>
                <View style={styles.summaryBox}>
                  <AppText style={styles.summaryNum}>{filteredReceived.length}</AppText>
                  <AppText style={styles.summaryLabel}>Received</AppText>
                </View>
                <View style={styles.summaryDivider} />
                <View style={styles.summaryBox}>
                  <AppText style={styles.summaryNum}>${receivedTotal.toFixed(2)}</AppText>
                  <AppText style={styles.summaryLabel}>Amount</AppText>
                </View>
              </>
            ) : null}
          </View>
        )}

        {/* List */}
        {loading ? (
          <View style={styles.centerState}>
            <ActivityIndicator color={PRIMARY} />
          </View>
        ) : error ? (
          <View style={styles.centerState}>
            <Icon name="error-outline" size={32} color="#EF4444" />
            <AppText style={styles.errorText}>{error}</AppText>
            <TouchableOpacity onPress={fetchAll} style={styles.retryBtn}>
              <AppText style={styles.retryText}>Retry</AppText>
            </TouchableOpacity>
          </View>
        ) : docType === 'SO' ? (
          <FlatList
            data={filteredSO}
            keyExtractor={item => item.id}
            extraData={[sigMap, campusMap]}
            renderItem={({ item, index }) => (
              <SORow
                order={item} index={index}
                campusMap={campusMap} sigMap={sigMap}
                onPress={() => setSelectedOrder(item)}
              />
            )}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={filteredSO.length === 0 ? styles.listEmpty : { paddingBottom: 85 + insets.bottom }}
            ListEmptyComponent={
              <View style={styles.centerState}>
                <Icon name="inbox" size={40} color={MUTED} />
                <AppText style={styles.emptyText}>No prepare orders</AppText>
              </View>
            }
          />
        ) : docType === 'DO' ? (
          <FlatList
            data={filteredConfirmed}
            keyExtractor={item => item.id}
            extraData={[sigMap, campusMap]}
            renderItem={({ item, index }) => (
              <SORow
                order={item} index={index}
                campusMap={campusMap} sigMap={sigMap}
                onPress={() => setSelectedOrder(item)}
              />
            )}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={filteredConfirmed.length === 0 ? styles.listEmpty : { paddingBottom: 85 + insets.bottom }}
            ListEmptyComponent={
              <View style={styles.centerState}>
                <Icon name="local-shipping" size={40} color={MUTED} />
                <AppText style={styles.emptyText}>No confirmed orders</AppText>
              </View>
            }
          />
        ) : docType === 'RV' ? (
          <FlatList
            data={filteredReceived}
            keyExtractor={item => item.id}
            extraData={[sigMap, campusMap]}
            renderItem={({ item, index }) => (
              <SORow
                order={item} index={index}
                campusMap={campusMap} sigMap={sigMap}
                onPress={() => setSelectedOrder(item)}
              />
            )}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={filteredReceived.length === 0 ? styles.listEmpty : { paddingBottom: 85 + insets.bottom }}
            ListEmptyComponent={
              <View style={styles.centerState}>
                <Icon name="check-circle" size={40} color={MUTED} />
                <AppText style={styles.emptyText}>No received orders</AppText>
              </View>
            }
          />
        ) : null}
      </View>
      </View>

      {/* ── Convert SO → DO Modal ─────────────────────────────────────────────── */}
      <Modal
        visible={!!selectedOrder}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={closeModal}
      >
        <SafeAreaView style={styles.modalSafe} edges={['bottom']}>
          <AppBar
            title={
              getFlowType(selectedOrder) === 'confirm' ? 'Confirm Order' :
              getFlowType(selectedOrder) === 'done'    ? 'Order Completed' :
              'Mark as Received'
            }
            subtitle={selectedOrder?.referenceNumber ?? selectedOrder?.ref ?? ''}
            titleAlign="left"
            showBack
            onBack={closeModal}
            rightActions={
              getFlowType(selectedOrder) === 'do' ? (
                <TouchableOpacity
                  onPress={() => setShowEditScreen(true)}
                  style={styles.editIconBtn}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Icon name="edit" size={20} color={PRIMARY} />
                </TouchableOpacity>
              ) : undefined
            }
          />

          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <View style={{ flex: 1 }}>
            <View style={styles.confirmBody}>
              {/* Compact order header strip */}
              {selectedOrder && (() => {
                const statusKey = (selectedOrder.status ?? '').toLowerCase();
                const s = STATUS_COLOR[statusKey] ?? { bg: '#F0F0F0', text: MUTED, label: selectedOrder.status ?? '' };
                const campusCode = selectedOrder.campusCode ?? selectedOrder.campus?.campusCode
                  ?? (selectedOrder.campusId != null ? campusMap[String(selectedOrder.campusId)]?.campusCode : null)
                  ?? selectedOrder.campusId ?? null;
                const orderDate = formatDate(soDetail?.orderDate ?? soDetail?.createdAt ?? selectedOrder.createdAt);
                return (
                  <View style={styles.orderRefChips}>
                    <AppText style={styles.orderRefNum} numberOfLines={1}>
                      {selectedOrder.referenceNumber ?? selectedOrder.ref ?? selectedOrder.id}
                    </AppText>
                    <View style={[styles.statusBadge, { backgroundColor: s.bg }]}>
                      <AppText style={[styles.statusText, { color: s.text }]}>{s.label}</AppText>
                    </View>
                    {campusCode ? (
                      <View style={styles.campusChip}>
                        <Icon name="place" size={10} color={PRIMARY} />
                        <AppText style={styles.campusChipText}>{String(campusCode)}</AppText>
                      </View>
                    ) : null}
                    <View style={styles.orderMetaChip}>
                      <Icon name="calendar-today" size={10} color={MUTED} />
                      <AppText style={styles.orderMetaText}>{orderDate}</AppText>
                    </View>
                  </View>
                );
              })()}

              {/* Order Items */}
              <View style={{ flex: 1 }}>
                <AppText style={styles.sectionLabel}>
                  Order Items{soDetail?.items?.length ? ` (${soDetail.items.length})` : ''}
                </AppText>
                <View style={[styles.itemsCard, { flex: 1 }]}>

                  {/* Customer / creator header row */}
                  {selectedOrder && (() => {
                    const customerName = soDetail?.customerOrgName
                      ?? soDetail?.customerOrg?.nameEn ?? soDetail?.customerOrg?.name
                      ?? soDetail?.org?.nameEn ?? soDetail?.org?.name ?? null;
                    const creatorName = soDetail?.createdByName ?? soDetail?.createdByUser?.name
                      ?? selectedOrder.createdByName ?? selectedOrder.createdByUser?.name ?? null;
                    const display = customerName ?? creatorName;
                    if (!display) return null;
                    return (
                      <View style={styles.orderCardCampus}>
                        <Icon name={customerName ? 'business' : 'person-outline'} size={16} color={PRIMARY} />
                        <AppText style={styles.orderCardCampusCode} numberOfLines={1}>{display}</AppText>
                      </View>
                    );
                  })()}

                  <View style={styles.orderCardDivider} />

                  {/* Items scroll */}
                  <ScrollView
                    keyboardShouldPersistTaps="handled"
                    showsVerticalScrollIndicator={false}
                    style={{ flex: 1 }}
                    contentContainerStyle={{ paddingBottom: 4 }}
                    nestedScrollEnabled
                  >
                    {detailLoading ? (
                      <ActivityIndicator color={PRIMARY} style={{ marginVertical: 20 }} />
                    ) : (soDetail?.items ?? []).length > 0 ? (
                      (soDetail!.items).map((item, idx) => {
                        const origUnit  = item.unitPriceCents / 100;
                        const discPct   = itemDiscounts[item.id] ?? '';
                        const pctNum    = parseFloat(discPct) || 0;
                        const afterUnit = origUnit * (1 - pctNum / 100);
                        const lineAmt   = item.qty * afterUnit;
                        const origAmt   = item.qty * origUnit;
                        const prod      = productMap[item.productId];
                        const nameEn    = item.productName   ?? prod?.nameEn ?? prod?.nameKm ?? `Item ${idx + 1}`;
                        const nameKh    = item.productNameKh ?? prod?.nameKm ?? null;
                        const code      = item.productCode   ?? prod?.sku    ?? null;
                        const editedQty   = parseInt(itemQtys[item.id] ?? String(item.qty), 10) || item.qty;
                        const editedLine  = editedQty * afterUnit;
                        const editedOrig  = editedQty * origUnit;
                        const flow        = getFlowType(selectedOrder);
                        const isConfirm   = flow === 'confirm';
                        return (
                          <View key={item.id} style={[styles.soItemRow, idx > 0 && styles.soItemRowBorder]}>
                            <View style={styles.orderItemRow}>
                              <View style={styles.orderItemIndex}>
                                <AppText style={styles.orderItemIndexText}>{idx + 1}</AppText>
                              </View>
                              <View style={styles.orderItemNames}>
                                {code ? (
                                  <View style={styles.orderItemCodeChip}>
                                    <AppText style={styles.orderItemCodeText}>{code}</AppText>
                                  </View>
                                ) : null}
                                <AppText style={styles.orderItemNameEn} numberOfLines={2}>{nameEn}</AppText>
                                {nameKh ? (
                                  <AppText style={styles.orderItemNameKh} numberOfLines={1}>{nameKh}</AppText>
                                ) : null}
                              </View>
                              <View style={styles.orderItemRight}>
                                {pctNum > 0 ? (
                                  <AppText style={styles.orderItemPriceOld}>${editedOrig.toFixed(2)}</AppText>
                                ) : null}
                                <AppText style={styles.orderItemPrice}>${editedLine.toFixed(2)}</AppText>
                                <AppText style={styles.orderItemUnit}>${origUnit.toFixed(2)} × {editedQty}</AppText>
                              </View>
                            </View>
                            {isConfirm ? (
                              <View style={styles.soItemDiscountRow}>
                                <View style={styles.soItemDiscountLeft}>
                                  <Icon name="inventory" size={12} color="#2563EB" />
                                  <AppText style={[styles.soItemDiscountLabel, { color: '#2563EB' }]}>Qty</AppText>
                                </View>
                                <View style={styles.soItemDiscountRight}>
                                  <View style={styles.qtyControls}>
                                    <TouchableOpacity
                                      style={styles.qtyBtn}
                                      onPress={() => setItemQtys(prev => {
                                        const cur = parseInt(prev[item.id] ?? String(item.qty), 10) || 1;
                                        return { ...prev, [item.id]: String(Math.max(1, cur - 1)) };
                                      })}
                                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                                    >
                                      <Icon name="remove" size={16} color="#2563EB" />
                                    </TouchableOpacity>
                                    <TextInput
                                      style={styles.qtyInput}
                                      value={itemQtys[item.id] ?? String(item.qty)}
                                      onChangeText={v => {
                                        const clean = v.replace(/[^0-9]/g, '');
                                        setItemQtys(prev => ({ ...prev, [item.id]: clean }));
                                      }}
                                      keyboardType="number-pad"
                                      placeholder="1"
                                      placeholderTextColor={MUTED}
                                      maxLength={6}
                                      selectTextOnFocus
                                    />
                                    <TouchableOpacity
                                      style={styles.qtyBtn}
                                      onPress={() => setItemQtys(prev => {
                                        const cur = parseInt(prev[item.id] ?? String(item.qty), 10) || 0;
                                        return { ...prev, [item.id]: String(cur + 1) };
                                      })}
                                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                                    >
                                      <Icon name="add" size={16} color="#2563EB" />
                                    </TouchableOpacity>
                                  </View>
                                </View>
                              </View>
                            ) : null}
                            <View style={styles.soItemDiscountRow}>
                              <View style={styles.soItemDiscountLeft}>
                                <Icon name="sell" size={12} color="#7C3AED" />
                                <AppText style={styles.soItemDiscountLabel}>Discount</AppText>
                              </View>
                              <View style={styles.soItemDiscountRight}>
                                <View style={styles.soDiscInputWrap}>
                                  <TextInput
                                    style={[styles.soDiscInput, getFlowType(selectedOrder) === 'done' && styles.soDiscInputDisabled]}
                                    value={discPct}
                                    onChangeText={v => {
                                      const clean = v.replace(/[^0-9.]/g, '');
                                      const num = parseFloat(clean);
                                      if (!isNaN(num) && num > 100) return;
                                      setItemDiscounts(prev => ({ ...prev, [item.id]: clean }));
                                    }}
                                    keyboardType="decimal-pad"
                                    placeholder="0"
                                    placeholderTextColor={MUTED}
                                    maxLength={6}
                                    selectTextOnFocus
                                    editable={getFlowType(selectedOrder) !== 'done'}
                                  />
                                  <AppText style={styles.soDiscPct}>%</AppText>
                                </View>
                                {pctNum > 0 ? (
                                  <AppText style={styles.soItemDiscountSaving}>−${(origAmt - lineAmt).toFixed(2)}</AppText>
                                ) : null}
                              </View>
                            </View>
                          </View>
                        );
                      })
                    ) : null}

                    {/* Existing signatures — compact inline strip */}
                    {(sigMap[selectedOrder?.id ?? ''] ?? []).length > 0 && (
                      <View style={styles.existingSigsRow}>
                        {(() => {
                          const sigs = sigMap[selectedOrder!.id] ?? [];
                          const orderStatus = (selectedOrder!.status ?? '').toLowerCase();
                          const isInvoiced = orderStatus === 'invoiced' || orderStatus === 'paid';
                          const lastReceivedIdx = isInvoiced
                            ? sigs.map((s, i) => s.type?.toUpperCase() === 'RECEIVED' ? i : -1).filter(i => i >= 0).pop() ?? -1
                            : -1;
                          return sigs.map((sig, i) => {
                            const displayType = (i === lastReceivedIdx) ? 'INVOICED' : sig.type?.toUpperCase();
                            const tc = SIG_TYPE_COLOR[displayType] ?? { bg: '#F1F5F9', text: '#64748B' };
                            return (
                              <View key={i} style={styles.modalSigCard}>
                                <View style={[styles.modalSigAccent, { backgroundColor: tc.text }]} />
                                <Image source={{ uri: sig.url }} style={styles.modalSigImage} resizeMode="contain" />
                                <View style={styles.modalSigFooter}>
                                  <View style={[styles.modalSigChip, { backgroundColor: tc.bg }]}>
                                    <AppText style={[styles.modalSigType, { color: tc.text }]}>{tc.label ?? displayType}</AppText>
                                  </View>
                                </View>
                              </View>
                            );
                          });
                        })()}
                      </View>
                    )}
                  </ScrollView>

                  {/* Totals */}
                  <View style={styles.orderCardDivider} />
                  <View style={styles.itemsTotalRow}>
                    <AppText style={styles.itemsTotalLabel}>Total</AppText>
                    <AppText style={styles.itemsTotalVal}>${modalTotal.toFixed(2)}</AppText>
                  </View>

                </View>
              </View>

              {/* Delivery Info — DO flow only */}
              {getFlowType(selectedOrder) === 'do' && (
                <View style={styles.confirmInfoRow}>
                  <AppInput
                    label="Received By"
                    value={receivedBy}
                    onChangeText={setReceivedBy}
                    placeholder="Name of person receiving"
                  />
                  <AppInput
                    label="Note (optional)"
                    value={note}
                    onChangeText={setNote}
                    placeholder="Delivery note…"
                    multiline
                    numberOfLines={2}
                  />
                </View>
              )}

            </View>

              {/* Signature — pinned to bottom, hidden for done flow */}
              {getFlowType(selectedOrder) !== 'done' && (
                <View style={styles.sigPadCard}>
                  <View style={styles.sigCardHeader}>
                    <View style={styles.sigCardLeft}>
                      <Icon name="draw" size={16} color={PRIMARY} />
                      <AppText style={styles.sigCardTitle}>
                        Signature <AppText style={styles.requiredMark}>*</AppText>
                      </AppText>
                    </View>
                    <View style={styles.sigCardActions}>
                      <TouchableOpacity
                        onPress={async () => {
                          if (sigRef.current?.isEmpty()) {
                            showAlert({ type: 'warning', title: 'No Signature', message: 'Please draw a signature first.' });
                            return;
                          }
                          setSigUploading(true);
                          try {
                            const png = await sigRef.current!.toPNG();
                            const url = await uploadDirectApi({ uri: png, type: 'image/png', fileName: 'sig-preview.png' });
                            setSigUploadedUrl(url);
                            setSigUploaded(true);
                          } catch (e: any) {
                            showAlert({ type: 'error', title: 'Upload Failed', message: e?.message ?? 'Could not upload' });
                          } finally { setSigUploading(false); }
                        }}
                        style={[styles.sigActionBtn, sigUploaded && styles.sigActionBtnDone]}
                        disabled={sigUploading}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        {sigUploading
                          ? <ActivityIndicator size="small" color={sigUploaded ? '#10B981' : PRIMARY} />
                          : <Icon name={sigUploaded ? 'check-circle' : 'cloud-upload'} size={13} color={sigUploaded ? '#10B981' : PRIMARY} />}
                        <AppText style={[styles.sigActionText, sigUploaded && { color: '#10B981' }]}>
                          {sigUploaded ? 'Uploaded' : 'Upload'}
                        </AppText>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => { sigRef.current?.clear(); setSigUploaded(false); setSigUploadedUrl(null); setHasSig(false); }}
                        style={styles.sigActionBtn}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <Icon name="refresh" size={13} color={PRIMARY} />
                        <AppText style={styles.sigActionText}>Clear</AppText>
                      </TouchableOpacity>
                    </View>
                  </View>
                  <View style={styles.sigDrawArea}>
                    <SignaturePad
                      ref={sigRef}
                      style={styles.sigPad}
                      onDrawEnd={() => setHasSig(true)}
                    />
                  </View>
                  <View style={styles.sigFooter}>
                    <View style={styles.sigFooterLine} />
                    <Icon name="person-outline" size={13} color="#94A3B8" />
                    <AppText style={styles.sigFooterLabel}>Recipient Signature</AppText>
                    <View style={styles.sigFooterLine} />
                  </View>
                </View>
              )}
            </View>
          </KeyboardAvoidingView>

          {/* Confirmation Modal */}
          <Modal
            visible={pendingSubmit}
            transparent
            animationType="fade"
            onRequestClose={() => !submitting && setPendingSubmit(false)}
          >
            <View style={styles.confirmOverlay}>
              <View style={styles.confirmCard}>
                {getFlowType(selectedOrder) === 'confirm'
                  ? <AnimatedConfirmIcon />
                  : <AnimatedTruckIcon />
                }
                <AppText variant="h4" align="center" style={styles.confirmTitle}>
                  {getFlowType(selectedOrder) === 'confirm' ? 'Confirm Order' : 'Mark as Received'}
                </AppText>
                <AppText style={styles.confirmMsg}>
                  {getFlowType(selectedOrder) === 'confirm'
                    ? `Are you sure you want to confirm order ${selectedOrder?.referenceNumber ?? selectedOrder?.id}?`
                    : `Are you sure you want to mark order ${selectedOrder?.referenceNumber ?? selectedOrder?.id} as Received?`}
                </AppText>
                <View style={styles.confirmDivider} />
                <View style={styles.confirmBtns}>
                  <AppButton
                    label="Cancel"
                    onPress={() => setPendingSubmit(false)}
                    variant="outline"
                    size="md"
                    style={{ flex: 1 }}
                    disabled={submitting}
                  />
                  <AppButton
                    label="Confirm"
                    onPress={() => { setPendingSubmit(false); performSubmit(); }}
                    variant="primary"
                    size="md"
                    style={{ flex: 1 }}
                    loading={submitting}
                    disabled={submitting || (!hasSig && !sigUploadedUrl)}
                  />
                </View>
              </View>
            </View>
          </Modal>

          {/* Submit bar — hidden for done (already invoiced/paid/cancelled) */}
          {getFlowType(selectedOrder) !== 'done' && (
          <View style={styles.submitBar}>
            {submitError ? (
              <View style={styles.submitErrorBox}>
                <Icon name="error-outline" size={16} color={Colors.error} />
                <AppText style={styles.submitErrorText} numberOfLines={2}>{submitError}</AppText>
              </View>
            ) : null}
            <AppButton
              label={
                getFlowType(selectedOrder) === 'confirm' ? 'Confirm Order' :
                'Mark as Received'
              }
              onPress={doSubmit}
              variant="primary"
              size="lg"
              fullWidth
              loading={submitting}
              disabled={submitting || (!hasSig && !sigUploadedUrl)}
            />
          </View>
          )}
          {getFlowType(selectedOrder) === 'done' && (() => {
            const st = (selectedOrder?.status ?? '').toLowerCase();
            const isCancelled = st === 'cancelled';
            const title =
              st === 'confirmed' ? 'Confirmed' :
              st === 'received'  ? 'Received' :
              st === 'invoiced'  ? 'Invoiced' :
              st === 'paid'      ? 'Paid' :
              st === 'cancelled' ? 'Cancelled' :
              'Completed';
            const sub =
              st === 'confirmed' ? 'Delivery order created. Order is confirmed.' :
              st === 'received'  ? 'Delivery done. Ready to generate invoice.' :
              st === 'invoiced'  ? 'This order has been invoiced.' :
              st === 'paid'      ? 'This order has been paid in full.' :
              st === 'cancelled' ? 'This order has been cancelled.' :
              'This order is complete.';
            return (
              <View style={[styles.completedBar, isCancelled && { backgroundColor: '#FFF1F2', borderTopColor: '#FEE2E2' }]}>
                <View style={styles.completedBadge}>
                  <Icon name={isCancelled ? 'cancel' : 'check-circle'} size={22} color={isCancelled ? '#EF4444' : '#10B981'} />
                  <AppText style={[styles.completedTitle, isCancelled && { color: '#991B1B' }]}>{title}</AppText>
                </View>
                <AppText style={[styles.completedSub, isCancelled && { color: '#B91C1C' }]}>{sub}</AppText>
              </View>
            );
          })()}

          {/* Edit Sale Order screen — nested inside this modal so iOS presents it correctly */}
          <Modal
            visible={showEditScreen}
            animationType="slide"
            presentationStyle="fullScreen"
            onRequestClose={() => setShowEditScreen(false)}
          >
            {showEditScreen && selectedOrder ? (
              <SaleOrderDetailScreen
                orderId={selectedOrder.id}
                onBack={async () => {
                  setShowEditScreen(false);
                  setDetailLoading(true);
                  try {
                    const refreshed = await getSalesOrderApi(selectedOrder.id);
                    setSoDetail(refreshed);
                    const newDiscounts: Record<string, string> = {};
                    const newQtys: Record<string, string> = {};
                    refreshed.items?.forEach(item => {
                      newDiscounts[item.id] = '';
                      newQtys[item.id] = String(item.qty);
                    });
                    setItemDiscounts(newDiscounts);
                    setItemQtys(newQtys);
                  } catch { /* silent */ }
                  finally { setDetailLoading(false); }
                }}
              />
            ) : null}
          </Modal>

        </SafeAreaView>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },

  topBar: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 20, paddingBottom: 16,
    backgroundColor: PRIMARY,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2, shadowRadius: 8, elevation: 8,
  },
  hamburger: { gap: 5, padding: 4 },
  hamLine:   { width: 22, height: 2.5, borderRadius: 2, backgroundColor: '#FFFFFF' },
  topTitle:  { flex: 1, textAlign: 'center', color: '#FFFFFF', fontWeight: '800', fontSize: 18, letterSpacing: 0.4 },
  avatar: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: PRIMARY,
    borderWidth: 2.5, borderColor: '#93C5FD',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25, shadowRadius: 4, elevation: 4,
  },
  avatarText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },

  card: {
    backgroundColor: CARD,
    shadowColor: PRIMARY,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1, shadowRadius: 12, elevation: 5,
  },
  ordersCard: {
    height: SCREEN_H * 0.88,
    borderRadius: 24,
    marginHorizontal: 16, marginTop: 16, marginBottom: 16,
    overflow: 'hidden', paddingTop: 18,
    borderTopWidth: 4, borderTopColor: PRIMARY,
    shadowColor: PRIMARY, shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.15, shadowRadius: 14, elevation: 7,
  },

  kpiCard: {
    backgroundColor: CARD,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 4,
    paddingBottom: 16,
    shadowColor: PURPLE,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.2,
    shadowRadius: 14,
    elevation: 7,
    overflow: 'hidden',
    height: SCREEN_H * 0.4,
  },
  kpiHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 16,
    backgroundColor: PURPLE,
  },
  kpiIconBox: {
    width: 42,
    height: 42,
    borderRadius: 13,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  kpiTexts: { flex: 1 },
  kpiLabel: { fontSize: 11, fontWeight: '600', color: 'rgba(255,255,255,0.75)', letterSpacing: 0.5, textTransform: 'uppercase' },
  kpiValue: { fontSize: 22, fontWeight: '900', color: '#FFFFFF', marginTop: 1 },
  kpiBadge: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 12,
    minWidth: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  kpiBadgeText: { fontSize: 13, fontWeight: '800', color: '#FFFFFF' },
  kpiList: { paddingHorizontal: 14, paddingTop: 6, paddingBottom: 16 },
  kpiRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingLeft: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F0F9',
    borderLeftWidth: 3,
    borderLeftColor: '#EDE9FE',
    marginBottom: 2,
    borderRadius: 4,
  },
  kpiRowLeft: { flex: 1, gap: 3 },
  kpiInvNum: { fontSize: 13, fontWeight: '700', color: TEXT },
  kpiMeta:   { flexDirection: 'row', alignItems: 'center', gap: 6 },
  kpiChip: {
    backgroundColor: '#DBEAFE',
    borderRadius: 5,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  kpiChipText:  { fontSize: 10, fontWeight: '700', color: PRIMARY },
  kpiMetaText:  { fontSize: 11, color: MUTED },
  kpiRowRight:  { alignItems: 'flex-end', gap: 3, paddingRight: 4 },
  kpiRowAmt:    { fontSize: 14, fontWeight: '800', color: PURPLE },
  kpiDue:       { fontSize: 10, color: MUTED },
  kpiNote:      { fontSize: 11, color: MUTED, fontStyle: 'italic', marginTop: 1 },
  kpiEmpty:     { fontSize: 13, color: MUTED, textAlign: 'center', padding: 20 },
  cardHeader: {
    flexDirection: 'row', alignItems: 'center',
    marginBottom: 12, paddingHorizontal: 18, gap: 8,
  },
  cardTitle:      { fontSize: 17, fontWeight: '800', color: TEXT, flex: 1, letterSpacing: 0.2 },
  countBadge:     { backgroundColor: PRIMARY_LIGHT, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 3 },
  countBadgeText: { color: PRIMARY, fontSize: 12, fontWeight: '800' },

  toggleRow: {
    flexDirection: 'row', marginHorizontal: 18, marginBottom: 12,
    backgroundColor: '#E0E7FF', borderRadius: 14, padding: 4, gap: 4,
  },
  toggleBtn:        { flex: 1, paddingVertical: 9, borderRadius: 11, alignItems: 'center' },
  toggleBtnActive:  {
    backgroundColor: PRIMARY,
    shadowColor: PRIMARY, shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35, shadowRadius: 5, elevation: 4,
  },
  toggleLabel:      { fontSize: 13, fontWeight: '700', color: MUTED },
  toggleLabelActive:{ color: '#FFFFFF' },

  summaryRow: {
    flexDirection: 'row', backgroundColor: '#F8FAFF', borderRadius: 16,
    padding: 14, marginHorizontal: 18, marginBottom: 14,
    borderWidth: 1, borderColor: '#E0E7FF',
  },
  summaryBox:     { flex: 1, alignItems: 'center', gap: 3 },
  summaryNum:     { fontSize: 24, fontWeight: '900', color: TEXT },
  summaryLabel:   { fontSize: 11, color: MUTED, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4 },
  summaryDivider: { width: 1, backgroundColor: '#C7D2FE', marginVertical: 4 },

  listEmpty: { flex: 1 },
  centerState: { alignItems: 'center', justifyContent: 'center', paddingVertical: 32, gap: 10 },
  errorText:   { fontSize: 13, color: '#EF4444', textAlign: 'center' },
  emptyText:   { fontSize: 14, color: MUTED, marginTop: 4, fontWeight: '500' },
  retryBtn:    { backgroundColor: PRIMARY, borderRadius: 12, paddingHorizontal: 22, paddingVertical: 10, marginTop: 4 },
  retryText:   { color: '#FFFFFF', fontWeight: '700', fontSize: 13 },

  // ── SO Row (SaleOrdersListScreen style) ──────────────────────────────────────
  rowWrap: {
    backgroundColor: CARD,
    borderBottomWidth: 1,
    borderBottomColor: '#EEF2FF',
    borderLeftWidth: 0,
  },
  rowMain: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 14, gap: 10,
  },
  indexBox:  { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  indexText: { fontSize: 14, fontWeight: '800' },
  rowBody:   { flex: 1, gap: 4 },
  ref:       { fontSize: 14, fontWeight: '700', color: TEXT, letterSpacing: 0.2 },
  rowMeta:   { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 5 },
  campusChip: {
    flexDirection: 'row', alignItems: 'center', gap: 2,
    backgroundColor: '#EFF6FF', borderRadius: 4, paddingHorizontal: 5, paddingVertical: 2,
  },
  campusChipText: { fontSize: 10, fontWeight: '700', color: PRIMARY },
  creatorChip: {
    flexDirection: 'row', alignItems: 'center', gap: 2,
    backgroundColor: '#F5F5F0', borderRadius: 4, paddingHorizontal: 5, paddingVertical: 2,
  },
  creatorChipText: { fontSize: 10, color: MUTED, maxWidth: 90 },
  dateText:   { fontSize: 11, color: MUTED },
  rowRight:   { alignItems: 'flex-end', gap: 6 },
  amount:     { fontSize: 15, fontWeight: '900', color: PRIMARY },
  statusBadge:{ borderRadius: 8, paddingHorizontal: 9, paddingVertical: 4 },
  statusText: { fontSize: 11, fontWeight: '700' },

  sigRow: {
    marginHorizontal: 14, marginBottom: 12,
    borderTopWidth: 1, borderTopColor: '#F0F0EC', paddingTop: 8, gap: 6,
  },
  sigHeader:     { flexDirection: 'row', alignItems: 'center', gap: 4 },
  sigLabel:      { fontSize: 10, color: MUTED, fontWeight: '600', letterSpacing: 0.3 },
  sigCard: {
    width: SIG_CARD_WIDTH,
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
  sigItemDate:   { fontSize: 8, color: MUTED },
  sigTypeChip:   { borderRadius: 3, paddingHorizontal: 4, paddingVertical: 1 },
  sigTypeText:   { fontSize: 8, fontWeight: '700', letterSpacing: 0.3 },
  sigBox:        { borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 8, backgroundColor: '#FAFBFF', overflow: 'hidden' },

  // ── Modal ─────────────────────────────────────────────────────────────────────
  modalSafe:   { flex: 1, backgroundColor: Colors.background },
  modalScroll: { flex: 1, padding: 16 },

  confirmBody:    { flex: 1, padding: 12, gap: 10, paddingBottom: 12 },
  confirmInfoRow: { gap: 8 },

  orderRefChips: {
    flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6,
  },
  orderRefNum: { fontSize: 15, fontWeight: '800', color: TEXT, letterSpacing: 0.3, flex: 1 },

  orderCard: {
    backgroundColor: CARD, borderRadius: 16,
    borderWidth: 1, borderColor: '#E2E8F0', overflow: 'hidden',
  },
  orderCardCampus: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: `${PRIMARY}0A`, paddingHorizontal: 14, paddingVertical: 12,
  },
  orderCardCampusCode: { fontSize: 14, fontWeight: '800', color: PRIMARY, flex: 1 },
  orderCardDivider:    { height: 1, backgroundColor: '#F0F4F8' },

  existingSigsRow: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 8,
    paddingHorizontal: 14, paddingVertical: 10,
    borderTopWidth: 1, borderTopColor: '#F0F4F8',
  },

  summaryCard: {
    backgroundColor: CARD, borderRadius: 14,
    padding: 16, marginBottom: 8, gap: 10,
    borderWidth: 1, borderColor: '#E2E8F0',
  },
  summaryCardRow:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 },
  summaryCardRef:  { fontSize: 16, fontWeight: '800', color: TEXT, letterSpacing: 0.3 },
  summaryCardTotal:{ fontSize: 20, fontWeight: '900', color: PRIMARY },
  orderMetaChip: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: '#F5F5F0', borderRadius: 5, paddingHorizontal: 6, paddingVertical: 3,
  },
  orderMetaText:   { fontSize: 11, color: MUTED, fontWeight: '500', maxWidth: 140 },
  orderNoteRow:    { flexDirection: 'row', alignItems: 'flex-start', gap: 5, paddingTop: 2 },
  orderNoteText:   { flex: 1, fontSize: 12, color: MUTED, lineHeight: 17 },
  totalRow:        { borderTopWidth: 1, borderTopColor: '#F0F4F8', paddingTop: 10, marginTop: 2 },
  totalLabel:      { fontSize: 12, fontWeight: '600', color: MUTED, textTransform: 'uppercase', letterSpacing: 0.5 },

  // item name with sequence badge
  itemNameWrap:    { flexDirection: 'row', alignItems: 'flex-start', gap: 6, flex: 1, marginRight: 8 },
  itemSeqBadge:    { width: 20, height: 20, borderRadius: 10, backgroundColor: `${PRIMARY}18`, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  itemSeqText:     { fontSize: 10, fontWeight: '800', color: PRIMARY },
  itemCodeChip: {
    alignSelf: 'flex-start',
    backgroundColor: PRIMARY_LIGHT,
    borderRadius: 5,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginBottom: 3,
  },
  itemCodeChipText: { fontSize: 10, fontWeight: '700', color: PRIMARY, letterSpacing: 0.4 },
  itemNameKh:       { fontSize: 11, color: MUTED, marginTop: 1 },

  sectionLabel: {
    fontSize: 11, fontWeight: '600', color: MUTED,
    textTransform: 'uppercase', letterSpacing: 0.8,
    marginBottom: 8, marginTop: 16,
  },
  requiredMark: { color: Colors.error, fontWeight: '700' },

  deliveryCard: {
    backgroundColor: CARD, borderRadius: 14, padding: 16,
    marginBottom: 4, borderWidth: 1, borderColor: '#E2E8F0', gap: 10,
  },

  // ── Order Items (cloned from MenuScreen) ─────────────────────────────────────
  itemsCard: {
    backgroundColor: CARD, borderRadius: 14,
    borderWidth: 1, borderColor: '#E2E8F0', overflow: 'hidden', marginBottom: 4,
  },
  soItemRow:       { },
  soItemRowBorder: { borderTopWidth: 1, borderTopColor: '#F0F4F8' },
  orderItemRow: {
    flexDirection: 'row', alignItems: 'flex-start',
    paddingHorizontal: 14, paddingVertical: 12, gap: 10,
  },
  orderItemIndex: {
    width: 28, height: 28, borderRadius: 8,
    backgroundColor: PRIMARY_LIGHT,
    alignItems: 'center', justifyContent: 'center', marginTop: 1,
  },
  orderItemIndexText: { fontSize: 12, fontWeight: '800', color: PRIMARY },
  orderItemNames: { flex: 1, gap: 2 },
  orderItemNameEn: { fontSize: 14, fontWeight: '700', color: TEXT },
  orderItemNameKh: { fontSize: 12, color: MUTED },
  orderItemCodeChip: {
    alignSelf: 'flex-start',
    backgroundColor: PRIMARY_LIGHT, borderRadius: 5,
    paddingHorizontal: 7, paddingVertical: 2, marginBottom: 3,
  },
  orderItemCodeText:  { fontSize: 10, fontWeight: '700', color: PRIMARY, letterSpacing: 0.5 },
  orderItemRight:     { alignItems: 'flex-end', gap: 2 },
  orderItemPrice:     { fontSize: 15, fontWeight: '800', color: PRIMARY },
  orderItemPriceOld:  { fontSize: 12, color: MUTED, textDecorationLine: 'line-through', textAlign: 'right' },
  orderItemUnit:      { fontSize: 11, color: MUTED },
  soItemDiscountRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#F5F3FF', paddingHorizontal: 14, paddingVertical: 8, gap: 8,
  },
  soItemDiscountLeft:    { flexDirection: 'row', alignItems: 'center', gap: 5 },
  soItemDiscountRight:   { flexDirection: 'row', alignItems: 'center', gap: 8 },
  soItemDiscountLabel:   { fontSize: 12, fontWeight: '600', color: '#7C3AED' },
  soDiscInputWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 2,
    borderWidth: 1, borderColor: '#C4B5FD', borderRadius: 8,
    backgroundColor: '#FFFFFF', paddingHorizontal: 8, paddingVertical: 4,
  },
  soDiscInput:           { fontSize: 13, fontWeight: '800', color: '#7C3AED', padding: 0, minWidth: 30, textAlign: 'right' },
  soDiscInputDisabled:   { color: '#94A3B8' },
  soDiscPct:             { fontSize: 12, fontWeight: '700', color: '#7C3AED' },
  qtyControls: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderWidth: 1, borderColor: '#BFDBFE', borderRadius: 8,
    backgroundColor: '#EFF6FF', paddingHorizontal: 6, paddingVertical: 3,
  },
  qtyBtn: {
    width: 26, height: 26, borderRadius: 6,
    backgroundColor: '#DBEAFE', alignItems: 'center', justifyContent: 'center',
  },
  qtyInput: {
    fontSize: 14, fontWeight: '800', color: '#2563EB',
    padding: 0, minWidth: 36, textAlign: 'center',
  },
  soItemDiscountSaving:  { fontSize: 13, fontWeight: '700', color: '#7C3AED' },
  itemsTotalRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 12,
    backgroundColor: `${PRIMARY}08`,
    borderTopWidth: 1, borderTopColor: `${PRIMARY}22`,
  },
  itemsTotalLabel:{ fontSize: 12, fontWeight: '700', color: MUTED, textTransform: 'uppercase', letterSpacing: 0.5 },
  itemsTotalVal:  { fontSize: 16, fontWeight: '900', color: PRIMARY },

  sigPadCard: {
    backgroundColor: CARD, borderRadius: 16,
    borderWidth: 1, borderColor: '#E2E8F0', marginTop: 4,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 8, elevation: 2,
  },
  sigCardHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
    backgroundColor: `${PRIMARY}0D`,
    borderBottomWidth: 1, borderBottomColor: `${PRIMARY}22`,
  },
  sigCardLeft:    { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sigCardTitle:   { fontSize: 13, fontWeight: '700', color: PRIMARY },
  sigRequiredBadge: { backgroundColor: '#FEE2E2', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  sigRequiredText:  { fontSize: 10, fontWeight: '700', color: Colors.error },
  sigCardActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sigActionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 20, borderWidth: 1,
    borderColor: `${PRIMARY}40`, backgroundColor: CARD,
  },
  sigActionBtnDone: { borderColor: '#10B981', backgroundColor: '#F0FDF4' },
  sigActionText:    { fontSize: 11, fontWeight: '600', color: PRIMARY },
  sigDrawArea: { borderBottomWidth: 1, borderBottomColor: '#E2E8F0' },
  sigPad:      { height: 210 },
  sigFooter: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 10, gap: 8, backgroundColor: '#F8FAFC',
  },
  sigFooterLine:  { flex: 1, height: 1, backgroundColor: '#CBD5E1' },
  sigFooterLabel: { fontSize: 11, color: '#94A3B8', fontWeight: '500', letterSpacing: 0.5 },

  submitBar: {
    padding: 16, paddingBottom: 8,
    borderTopWidth: 1, borderTopColor: '#E2E8F0',
    backgroundColor: CARD, gap: 10,
  },
  confirmOverlay: {
    flex: 1, backgroundColor: 'rgba(15,23,42,0.55)',
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28,
  },
  confirmCard: {
    width: '100%', maxWidth: 360,
    backgroundColor: CARD, borderRadius: 24,
    paddingTop: 32, paddingBottom: 24, paddingHorizontal: 24,
    alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.18, shadowRadius: 40, elevation: 20,
  },
  confirmIconCircle: {
    width: 68, height: 68, borderRadius: 34,
    backgroundColor: PRIMARY_LIGHT,
    alignItems: 'center', justifyContent: 'center', marginBottom: 18,
  },
  confirmLottie: { width: 100, height: 100, marginBottom: 8 },
  confirmTitle: { marginBottom: 8 },
  confirmMsg: {
    fontSize: 14, color: MUTED, textAlign: 'center', lineHeight: 22, marginBottom: 4,
  },
  confirmDivider: {
    height: 1, backgroundColor: '#E2E8F0', width: '100%',
    marginTop: 20, marginBottom: 16,
  },
  confirmBtns: { flexDirection: 'row', gap: 10, width: '100%' },
  editIconBtn: {
    padding: 6,
    borderRadius: 8,
    backgroundColor: Colors.primaryLight,
  },
  submitErrorBox: {
    flexDirection: 'row', alignItems: 'flex-start',
    backgroundColor: '#FEF2F2', borderRadius: 10, padding: 10, gap: 8,
  },
  submitErrorText: { flex: 1, fontSize: 13, color: Colors.error, lineHeight: 18 },
  modalSigRow: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 4,
  },
  modalSigCard: {
    width: 90,
    backgroundColor: CARD,
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 1, borderColor: '#E2E8F0',
  },
  modalSigAccent:  { height: 3 },
  modalSigImage:   { width: '100%', height: 60, backgroundColor: '#F8FAFC' },
  modalSigFooter:  { padding: 6, alignItems: 'center' },
  modalSigChip:    { borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  modalSigType:    { fontSize: 10, fontWeight: '700' },
  completedBar: {
    padding: 16, paddingBottom: 8,
    borderTopWidth: 1, borderTopColor: '#D1FAE5',
    backgroundColor: '#F0FDF4',
    alignItems: 'center', gap: 6,
  },
  completedBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
  },
  completedTitle: {
    fontSize: 16, fontWeight: '700', color: '#065F46',
  },
  completedSub: {
    fontSize: 13, color: '#047857', textAlign: 'center',
  },

});

export default HomeScreen;
