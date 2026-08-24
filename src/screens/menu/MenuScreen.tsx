import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  FlatList,
  Modal,
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  Animated,
  Easing,
  Alert,
  Switch,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useAlert } from '../../components/AppAlert';
import { ALL_GROUP_ID } from '../../viewmodels/useMenuViewModel';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons as Icon } from '@expo/vector-icons';
import Colors from '../../theme/colors';
import AppText from '../../components/AppText';
import AppButton from '../../components/AppButton';
import AppBar from '../../components/AppBar';
import AppInput from '../../components/AppInput';
import SignaturePad, { SignaturePadRef } from '../../components/SignaturePad';
import DatePickerModal from '../../components/DatePickerModal';
import { useMenuViewModel } from '../../viewmodels/useMenuViewModel';
import { MenuItemModel } from '../../models/MenuItem';
import { SaleOrderLine } from '../../models/SaleOrder';
import { tabEvents } from '../../navigation/tabEvents';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import { createSalesOrderApi, getSalesOrderApi, uploadDirectApi, uploadSaleOrderSignatureApi, getOrgId, createQuotationApi, updateSalesOrderStatusApi, createInvoiceHeaderApi, getLocationsApi, broadcastPushApi, ApiLocation } from '../../services/focusApi';
import { User } from '../../models/User';

// ─── Animated Confirm Icon ────────────────────────────────────────────────────

const AnimatedConfirmIcon: React.FC = () => {
  const bounceY     = useRef(new Animated.Value(0)).current;
  const checkScale  = useRef(new Animated.Value(0.6)).current;
  const checkOpacity = useRef(new Animated.Value(0)).current;
  const line1W      = useRef(new Animated.Value(0)).current;
  const line2W      = useRef(new Animated.Value(0)).current;
  const line3W      = useRef(new Animated.Value(0)).current;
  const glowOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(bounceY, { toValue: -5, duration: 400, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(bounceY, { toValue: 0,  duration: 400, easing: Easing.in(Easing.quad),  useNativeDriver: true }),
      ]),
    ).start();

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

    Animated.loop(
      Animated.sequence([
        Animated.timing(glowOpacity, { toValue: 0.35, duration: 700, useNativeDriver: true }),
        Animated.timing(glowOpacity, { toValue: 0,    duration: 700, useNativeDriver: true }),
      ]),
    ).start();
  }, []);

  return (
    <Animated.View style={{ transform: [{ translateY: bounceY }], width: 100, height: 90, alignItems: 'center', justifyContent: 'center', marginBottom: 8 }}>
      <View style={{ width: 62, height: 74, backgroundColor: '#EFF6FF', borderRadius: 8, borderWidth: 1.5, borderColor: '#BFDBFE', padding: 10, justifyContent: 'flex-start', gap: 8 }}>
        <View style={{ width: '100%', height: 8, backgroundColor: Colors.primary, borderRadius: 3 }} />
        <Animated.View style={{ height: 5, borderRadius: 3, backgroundColor: '#93C5FD', width: line1W.interpolate({ inputRange: [0, 1], outputRange: ['0%', '90%'] }) }} />
        <Animated.View style={{ height: 5, borderRadius: 3, backgroundColor: '#93C5FD', width: line2W.interpolate({ inputRange: [0, 1], outputRange: ['0%', '75%'] }) }} />
        <Animated.View style={{ height: 5, borderRadius: 3, backgroundColor: '#93C5FD', width: line3W.interpolate({ inputRange: [0, 1], outputRange: ['0%', '55%'] }) }} />
      </View>
      <Animated.View style={{ position: 'absolute', bottom: 2, right: 8, width: 30, height: 30, borderRadius: 15, backgroundColor: '#10B981', opacity: glowOpacity, transform: [{ scale: 1.6 }] }} />
      <Animated.View style={{ position: 'absolute', bottom: 2, right: 8, width: 26, height: 26, borderRadius: 13, backgroundColor: '#10B981', alignItems: 'center', justifyContent: 'center', opacity: checkOpacity, transform: [{ scale: checkScale }], shadowColor: '#10B981', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.4, shadowRadius: 4, elevation: 4 }}>
        <Icon name="check" size={15} color="#FFFFFF" />
      </Animated.View>
    </Animated.View>
  );
};

// ─── Left Menu Group List ────────────────────────────────────────────────────

type GroupEntry =
  | { type: 'all' }
  | { type: 'group'; group: ReturnType<typeof useMenuViewModel>['groups'][number] };

const GroupList: React.FC<{
  groups: ReturnType<typeof useMenuViewModel>['groups'];
  selectedId: string | null;
  onSelect: (id: string) => void;
}> = ({ groups, selectedId, onSelect }) => {
  const entries: GroupEntry[] = [
    { type: 'all' },
    ...groups.map(g => ({ type: 'group' as const, group: g })),
  ];

  return (
    <View style={styles.groupList}>
      <ScrollView showsVerticalScrollIndicator={false}>
        {entries.map(entry => {
          const id = entry.type === 'all' ? ALL_GROUP_ID : entry.group.id;
          const name = entry.type === 'all' ? 'All' : entry.group.name;
          const icon = entry.type === 'all' ? 'apps' : entry.group.icon ?? 'category';
          const color = entry.type === 'all' ? Colors.primary : (entry.group.color ?? Colors.primary);
          const isSelected = id === selectedId;

          return (
            <TouchableOpacity
              key={id}
              onPress={() => onSelect(id)}
              style={[styles.groupItem, isSelected && styles.groupItemActive]}
              activeOpacity={0.7}
            >
              <View style={[styles.groupIconBox, isSelected && { backgroundColor: color }]}>
                <Icon name={icon} size={20} color={isSelected ? Colors.white : color} />
              </View>
              <AppText
                style={isSelected ? [styles.groupName, styles.groupNameActive] : styles.groupName}
                numberOfLines={1}
              >
                {name}
              </AppText>
              {isSelected && <View style={styles.groupActiveLine} />}
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
};

// ─── Item Card ────────────────────────────────────────────────────────────────

const ItemCard: React.FC<{
  item: MenuItemModel;
  quantity: number;
  onAdd: (item: MenuItemModel) => void;
  onIncrement: (lineId: string) => void;
  onDecrement: (lineId: string) => void;
  onSetQty: (lineId: string, qty: number) => void;
  lineId?: string;
  imageCacheBuster: number;
}> = ({ item, quantity, onAdd, onIncrement, onDecrement, onSetQty, lineId, imageCacheBuster }) => {
  const [imgError, setImgError] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [qtyInput, setQtyInput] = useState('');
  const [editing, setEditing] = useState(false);
  const showImage = !!item.primaryImageUrl && !imgError;
  const inCart = quantity > 0;
  const addScale = useRef(new Animated.Value(1)).current;

  const handleAddPress = () => {
    Animated.sequence([
      Animated.spring(addScale, { toValue: 0.75, useNativeDriver: true, speed: 50, bounciness: 0 }),
      Animated.spring(addScale, { toValue: 1, useNativeDriver: true, speed: 12, bounciness: 18 }),
    ]).start();
    onAdd(item);
  };

  const handleQtyFocus = () => {
    setQtyInput(String(quantity));
    setEditing(true);
  };

  const handleQtyBlur = () => {
    setEditing(false);
    const parsed = parseInt(qtyInput, 10);
    if (!isNaN(parsed) && parsed > 0 && lineId) {
      onSetQty(lineId, parsed);
    } else if ((isNaN(parsed) || parsed <= 0) && lineId) {
      onSetQty(lineId, 0); // removes the line
    }
    setQtyInput('');
  };

  return (
    <View style={[styles.itemCard, !item.available && styles.itemCardDisabled]}>
      {/* Image area */}
      <TouchableOpacity
        activeOpacity={0.85}
        onPress={() => item.available && onAdd(item)}
        disabled={!item.available}
      >
        <View style={styles.itemImageBox}>
          {showImage ? (
            <>
              {!imgLoaded && (
                <View style={styles.itemImageLoading}>
                  <ActivityIndicator size="small" color={Colors.primary} />
                </View>
              )}
              <Image
                source={{ uri: `${item.primaryImageUrl}?t=${imageCacheBuster}` }}
                style={[styles.itemImage, !imgLoaded && styles.itemImageHidden]}
                resizeMode="cover"
                fadeDuration={0}
                onLoad={() => setImgLoaded(true)}
                onError={() => setImgError(true)}
              />
            </>
          ) : (
            <View style={styles.itemImagePlaceholder}>
              <Icon name="fastfood" size={26} color="#CBD5E1" />
            </View>
          )}

          {/* In-cart badge */}
          {inCart && (
            <View style={styles.itemBadge}>
              <AppText style={styles.itemBadgeText}>{quantity}</AppText>
            </View>
          )}
        </View>
      </TouchableOpacity>

      {/* Card body */}
      <View style={styles.itemCardInner}>
        {/* Khmer name first */}
        {item.nameKh ? (
          <AppText style={styles.itemNameKh} numberOfLines={1}>{item.nameKh}</AppText>
        ) : null}

        {/* English name + unavailable tag */}
        <View style={styles.itemCardTop}>
          <AppText numberOfLines={2} style={styles.itemName}>{item.name}</AppText>
          {!item.available && (
            <View style={styles.unavailableBadge}>
              <AppText style={styles.unavailableText}>N/A</AppText>
            </View>
          )}
        </View>

        {/* SKU chip */}
        {item.sku ? (
          <View style={styles.itemSkuChip}>
            <AppText style={styles.itemSku} numberOfLines={1}>{item.sku}</AppText>
          </View>
        ) : null}

        {/* Location */}
        {item.locationCode ? (
          <View style={styles.itemLocationRow}>
            <Icon name="place" size={9} color="#059669" />
            <AppText style={styles.itemLocationText} numberOfLines={1}>{item.locationCode}</AppText>
          </View>
        ) : null}

        {/* Category */}
        {item.categoryName ? (
          <View style={styles.itemCatRow}>
            <Icon name="category" size={9} color="#7C3AED" />
            <AppText style={styles.itemCatText} numberOfLines={1}>{item.categoryName}</AppText>
          </View>
        ) : null}

        {/* Price + onhand + cart controls */}
        <View style={styles.itemCardBottom}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <AppText style={styles.itemPrice}>${item.price.toFixed(2)}</AppText>
            {item.qtyOnHand !== undefined && (
              <View style={styles.itemOnhandRow}>
                <Icon name="inventory" size={9} color={item.qtyOnHand < 0 ? '#EF4444' : '#2563EB'} />
                <AppText style={[styles.itemOnhandText, item.qtyOnHand < 0 && { color: '#EF4444' }]}>
                  {item.qtyOnHand}
                </AppText>
              </View>
            )}
          </View>

          {item.available && !inCart && (
            <TouchableOpacity onPress={handleAddPress} activeOpacity={1}>
              <Animated.View style={[styles.addBtn, { transform: [{ scale: addScale }] }]}>
                <Icon name="add" size={20} color={Colors.white} />
              </Animated.View>
            </TouchableOpacity>
          )}

          {item.available && inCart && (
            <View style={[styles.qtyPill, editing && styles.qtyPillEditing]}>
              <TouchableOpacity
                style={styles.qtyPillBtn}
                onPress={() => lineId && onDecrement(lineId)}
                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              >
                <Icon name="remove" size={14} color={editing ? Colors.primary : Colors.white} />
              </TouchableOpacity>
              <TextInput
                style={[styles.qtyPillInput, editing && styles.qtyPillInputEditing]}
                value={editing ? qtyInput : String(quantity)}
                onFocus={handleQtyFocus}
                onBlur={handleQtyBlur}
                onChangeText={setQtyInput}
                onSubmitEditing={handleQtyBlur}
                keyboardType="number-pad"
                selectTextOnFocus
                returnKeyType="done"
                maxLength={4}
              />
              <TouchableOpacity
                style={styles.qtyPillBtn}
                onPress={() => lineId && onIncrement(lineId)}
                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              >
                <Icon name="add" size={14} color={editing ? Colors.primary : Colors.white} />
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>
    </View>
  );
};

// ─── Order Line Row ───────────────────────────────────────────────────────────

const OrderLineRow: React.FC<{
  line: SaleOrderLine;
  onIncrement: (id: string) => void;
  onDecrement: (id: string) => void;
  onRemove: (id: string) => void;
}> = ({ line, onIncrement, onDecrement, onRemove }) => (
  <View style={styles.orderLine}>
    <View style={styles.orderLineInfo}>
      <AppText variant="bodyMedium" numberOfLines={1} style={{ flex: 1 }}>
        {line.item.name}
      </AppText>
      <AppText variant="bodyMedium" color="primary" style={styles.lineSubtotal}>
        ${line.subtotal.toFixed(2)}
      </AppText>
    </View>
    <View style={styles.qtyRow}>
      <TouchableOpacity onPress={() => onDecrement(line.id)} style={styles.qtyBtn}>
        <AppText style={styles.qtyBtnText}>−</AppText>
      </TouchableOpacity>
      <AppText variant="bodyMedium" style={styles.qtyValue}>
        {line.quantity}
      </AppText>
      <TouchableOpacity onPress={() => onIncrement(line.id)} style={styles.qtyBtn}>
        <AppText style={styles.qtyBtnText}>+</AppText>
      </TouchableOpacity>
      <TouchableOpacity onPress={() => onRemove(line.id)} style={styles.removeBtn}>
        <AppText style={styles.removeBtnText}>✕</AppText>
      </TouchableOpacity>
    </View>
  </View>
);

// ─── Confirm Qty Pill ─────────────────────────────────────────────────────────

const ConfirmQtyPill: React.FC<{
  qty: number;
  onDecrement: () => void;
  onIncrement: () => void;
  onSet: (n: number) => void;
  disabled?: boolean;
}> = ({ qty, onDecrement, onIncrement, onSet, disabled }) => {
  const [text, setText] = useState(String(qty));
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!editing) setText(String(qty));
  }, [qty, editing]);

  return (
    <View style={[styles.confirmQtyPill, disabled && styles.confirmQtyPillDisabled]}>
      <TouchableOpacity
        style={styles.confirmQtyBtn}
        onPress={onDecrement}
        disabled={disabled}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Icon name="remove" size={15} color={disabled ? Colors.textLight : Colors.primary} />
      </TouchableOpacity>
      <TextInput
        style={[styles.confirmQtyInput, disabled && styles.confirmQtyInputDisabled]}
        value={editing ? text : String(qty)}
        editable={!disabled}
        onFocus={() => { setEditing(true); setText(String(qty)); }}
        onBlur={() => {
          setEditing(false);
          const n = parseInt(text, 10);
          if (!isNaN(n) && n >= 1) onSet(n);
          else setText(String(qty));
        }}
        onChangeText={setText}
        onSubmitEditing={() => {
          const n = parseInt(text, 10);
          if (!isNaN(n) && n >= 1) onSet(n);
          else setText(String(qty));
        }}
        keyboardType="number-pad"
        selectTextOnFocus
        maxLength={4}
        returnKeyType="done"
      />
      <TouchableOpacity
        style={styles.confirmQtyBtn}
        onPress={onIncrement}
        disabled={disabled}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Icon name="add" size={15} color={disabled ? Colors.textLight : Colors.primary} />
      </TouchableOpacity>
    </View>
  );
};

// ─── Campus Picker Modal ──────────────────────────────────────────────────────

const CampusPicker: React.FC<{
  campuses: ReturnType<typeof useMenuViewModel>['campuses'];
  loading: boolean;
  onSelect: (campus: ReturnType<typeof useMenuViewModel>['campuses'][number]) => void;
}> = ({ campuses, loading, onSelect }) => (
  <Modal visible animationType="fade" transparent statusBarTranslucent>
    <View style={styles.campusBackdrop}>
      <View style={styles.campusCard}>
        <View style={styles.campusHeader}>
          <Icon name="place" size={28} color={Colors.primary} />
          <AppText variant="h4" style={styles.campusTitle}>Select Campus</AppText>
          <AppText variant="caption" color="textSecondary" align="center">
            Choose a campus before adding items to your order
          </AppText>
        </View>
        {loading ? (
          <View style={styles.campusLoading}>
            <ActivityIndicator size="large" color={Colors.primary} />
          </View>
        ) : campuses.length === 0 ? (
          <View style={styles.campusLoading}>
            <Icon name="location-off" size={36} color={Colors.textLight} />
            <AppText variant="caption" color="textSecondary" align="center" style={{ marginTop: 8 }}>
              No campuses available
            </AppText>
          </View>
        ) : (
          <ScrollView
            style={styles.campusScroll}
            contentContainerStyle={styles.campusGrid}
            showsVerticalScrollIndicator={false}
          >
            {campuses.map(campus => (
              <TouchableOpacity
                key={campus.id}
                style={[styles.campusItem, { borderColor: campus.color }]}
                onPress={() => onSelect(campus)}
                activeOpacity={0.75}
              >
                <View style={[styles.campusIconBox, { backgroundColor: `${campus.color}18` }]}>
                  <Icon name={campus.icon} size={26} color={campus.color} />
                </View>
                <AppText style={[styles.campusCode, { color: campus.color }]}>
                  {campus.code}
                </AppText>
                <AppText variant="caption" color="textSecondary" numberOfLines={1}>
                  {campus.name}
                </AppText>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}
      </View>
    </View>
  </Modal>
);

// ─── Main Menu Screen ────────────────────────────────────────────────────────

const TAB_BAR_HEIGHT = 80;

const MenuScreen: React.FC<{ user?: User | null }> = ({ user }) => {
  const vm = useMenuViewModel();
  const isOwner = user?.role === 'owner';
  const { showAlert } = useAlert();
  const { bottom: bottomInset, top: topInset } = useSafeAreaInsets();
  const [imageCacheBuster] = useState(() => Date.now());
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (!vm.itemsLoading) setRefreshing(false);
  }, [vm.itemsLoading]);
  const [confirmFormVisible, setConfirmFormVisible] = useState(false);
  const [docType, setDocType] = useState<'QUO' | 'SO' | 'INV'>('SO');
  const [rateUsed, setRateUsed] = useState('4100');
  const [receivedBy, setReceivedBy]               = useState('');
  const [note, setNote]                           = useState('');
  const [orderDate, setOrderDate]                 = useState<Date>(new Date());
  const [datePickerVisible, setDatePickerVisible] = useState(false);
  const [invIssuedAt, setInvIssuedAt]             = useState<Date>(new Date());
  const [invDueAt, setInvDueAt]                   = useState<Date | null>(null);
  const [invDatePickerFor, setInvDatePickerFor]   = useState<'issued' | 'due' | null>(null);
  const [discounts, setDiscounts]                 = useState<Record<string, string>>({});
  const [prices, setPrices]                       = useState<Record<string, string>>({});
  const [submitting, setSubmitting]               = useState(false);
  const [submitError, setSubmitError]             = useState<string | null>(null);
  const scrollRef                                  = useRef<ScrollView>(null);
  const [sigUploading, setSigUploading]           = useState(false);
  const [sigUploaded, setSigUploaded]             = useState(false);
  const [sigUploadedUrl, setSigUploadedUrl]       = useState<string | null>(null);
  const [hasSig, setHasSig]                       = useState(false);
  const [pendingSubmit, setPendingSubmit]         = useState(false);
  const sigRef = useRef<SignaturePadRef>(null);
  const [search, setSearch] = useState('');
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
    setSearch(data.trim());
    setTimeout(() => { scanCooldown.current = false; }, 1500);
  };
  const [importVisible, setImportVisible] = useState(false);
  const [importRows, setImportRows] = useState<Array<{ barcode: string; qty: string; discount: string }>>([{ barcode: '', qty: '', discount: '' }]);
  const [importAllItems, setImportAllItems] = useState(vm.displayItems);
  const [importLoading, setImportLoading] = useState(false);
  const pendingImportDiscountsRef = useRef<Record<string, string>>({});
  const [autoNumber, setAutoNumber] = useState(true);
  const [refNumber, setRefNumber] = useState('');
  const bottomPadding = TAB_BAR_HEIGHT + bottomInset;
  const [locations, setLocations] = useState<ApiLocation[]>([]);
  const [selectedLocationId, setSelectedLocationId] = useState<string | number | null>(null);

  useEffect(() => {
    getLocationsApi().then(setLocations).catch(() => {});
  }, []);

  useEffect(() => tabEvents.on('Menu', vm.retryLoad), [vm.retryLoad]);

  useEffect(() => {
    if (confirmFormVisible && vm.order.lines.length === 0) {
      setConfirmFormVisible(false);
      setSelectedLocationId(null);
    }
  }, [vm.order.lines.length, confirmFormVisible]);

  // Apply discounts queued by the import confirm button after bulkImport state settles
  useEffect(() => {
    const pending = pendingImportDiscountsRef.current;
    if (Object.keys(pending).length === 0) return;
    const updates: Record<string, string> = {};
    let found = false;
    for (const [sku, disc] of Object.entries(pending)) {
      const line = vm.order.lines.find(l => l.item.sku?.toLowerCase() === sku.toLowerCase());
      if (line) { updates[line.id] = disc; found = true; }
    }
    if (found) {
      pendingImportDiscountsRef.current = {};
      setDiscounts(prev => ({ ...prev, ...updates }));
    }
  }, [vm.order.lines]);

  const totalDiscount = vm.order.lines.reduce((sum, line) => {
    const effectivePrice = parseFloat(prices[line.id] || '') || line.unitPrice;
    const pct = parseFloat(discounts[line.id] || '0') || 0;
    return sum + effectivePrice * line.quantity * pct / 100;
  }, 0);
  const effectiveSubtotal = vm.order.lines.reduce((sum, line) => {
    const effectivePrice = parseFloat(prices[line.id] || '') || line.unitPrice;
    return sum + effectivePrice * line.quantity;
  }, 0);
  const finalTotal = Math.max(0, effectiveSubtotal - totalDiscount);

  // Invoice qty/discount edits are restricted to the Owner role
  const lineEditLocked = docType === 'INV' && !isOwner;

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return vm.displayItems;
    return vm.displayItems.filter(item =>
      item.name.toLowerCase().includes(q) ||
      (item.sku && item.sku.toLowerCase().includes(q))
    );
  }, [search, vm.displayItems]);

  // Show campus picker if no campus selected
  if (!vm.selectedCampus) {
    return <CampusPicker campuses={vm.campuses} loading={vm.campusesLoading} onSelect={vm.selectCampus} />;
  }

  const handleConfirm = () => {
    if (vm.order.lines.length === 0) {
      showAlert({
        type: 'warning',
        title: 'Empty Order',
        message: 'Please add items from the menu before confirming.',
        actions: [{ label: 'Got it', variant: 'primary' }],
      });
      return;
    }
    setConfirmFormVisible(true);
  };

  // Format a local date as YYYY-MM-DD to avoid UTC timezone shift from toISOString()
  const formatOrderDate = (d: Date): string => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  const doSubmit = async () => {
    setSubmitError(null);
    setSubmitting(true);
    try {
      const customerOrgId = vm.selectedCampus?.orgId ?? getOrgId() ?? undefined;
      const campusId      = vm.selectedCampus?.id != null ? Number(vm.selectedCampus.id) : undefined;

      if (!customerOrgId) {
        showAlert({ type: 'warning', title: 'Missing Info', message: 'Campus organization ID not available. Please re-select the campus.' });
        return;
      }

      const lineItems = vm.order.lines.map(line => {
        const effectivePrice = parseFloat(prices[line.id] || '') || line.unitPrice;
        const discountPct    = parseFloat(discounts[line.id] || '0') || 0;
        return {
          productId:      Number(line.item.id),
          qty:            line.quantity,
          unitPriceCents: Math.round(effectivePrice * 100),
          discountCents:  Math.round(line.quantity * effectivePrice * 100 * discountPct / 100),
        };
      });

      const locationId = selectedLocationId != null ? Number(selectedLocationId) : undefined;

      if (docType === 'QUO') {
        // ── Create Quotation ──────────────────────────────────────────────────
        const quoPayload = {
          campusId,
          customerOrgId,
          note: note.trim() || undefined,
          items: lineItems,
          referenceNumber: !autoNumber && refNumber.trim() ? refNumber.trim() : undefined,
        };
        const quot = await createQuotationApi(quoPayload);
        const quotRef = quot?.referenceNumber ?? quot?.ref ?? quot?.id;

        vm.confirmOrder();
        setConfirmFormVisible(false);
        setNote('');
        setDiscounts({});
        setPrices({});
        setSelectedLocationId(null);
        setTimeout(() => {
          showAlert({ type: 'success', title: 'Quotation Created', message: quotRef ? `Reference: ${quotRef}` : 'Quotation created successfully.', autoClose: 2500 });
        }, 400);

      } else if (docType === 'INV') {
        // ── Create Invoice directly ───────────────────────────────────────────
        const invSoPayload = {
          campusId,
          locationId,
          customerOrgId,
          type: 'SO' as const,
          orderDate: formatOrderDate(invIssuedAt),
          soDate: formatOrderDate(invIssuedAt),
          note: note.trim() || undefined,
          receivedBy: receivedBy.trim() || undefined,
          items: lineItems,
          referenceNumber: !autoNumber && refNumber.trim() ? refNumber.trim() : undefined,
        };
        const so = await createSalesOrderApi(invSoPayload);

        const soId = so?.id ?? (so as any)?.data?.id;
        if (!soId) throw new Error(`Sale order created but no ID in response: ${JSON.stringify(so)}`);

        // Move SO to RECEIVED so it can be invoiced
        await updateSalesOrderStatusApi(soId, 'RECEIVED');

        // Create invoice header from this SO
        const invPayload = {
          customerOrgId,
          campusId: campusId!,
          locationId,
          soIds: [soId],
          rateUsed: Number(rateUsed) || 4100,
          note: note.trim() || undefined,
          issuedAt: formatOrderDate(invIssuedAt),
          dueAt: invDueAt ? formatOrderDate(invDueAt) : undefined,
        };
        const inv = await createInvoiceHeaderApi(invPayload);
        const soRef = so.referenceNumber ?? so.ref ?? so.orderNumber;

        // Upload signature (non-fatal)
        try {
          let signatureUrl: string | undefined;
          if (sigUploadedUrl) {
            signatureUrl = sigUploadedUrl;
          } else if (!sigRef.current?.isEmpty()) {
            const pngDataUrl = await sigRef.current!.toPNG();
            signatureUrl = await uploadDirectApi({ uri: pngDataUrl, type: 'image/png', fileName: `signature-inv-${soId}.png` });
          }
          if (signatureUrl) await uploadSaleOrderSignatureApi(soId, signatureUrl, 'RECEIVED');
        } catch {}

        vm.confirmOrder();
        vm.retryLoad();
        setConfirmFormVisible(false);
        setNote('');
        setDiscounts({});
        setPrices({});
        setSigUploaded(false);
        setSigUploadedUrl(null);
        setSelectedLocationId(null);
        sigRef.current?.clear();
        const invRef = inv?.invoiceNumber ?? inv?.id;
        const campusCode = vm.selectedCampus?.code ?? '';
        const soTotalCents = so.totalCents ?? lineItems.reduce((s, it) => s + it.qty * it.unitPriceCents - (it.discountCents ?? 0), 0);
        const amountStr = `$${(soTotalCents / 100).toFixed(2)}`;
        broadcastPushApi(
          '🧾 New Invoice',
          `Campus: ${campusCode}  |  Amount: ${amountStr}  |  Invoice: ${invRef ?? so.referenceNumber ?? so.ref ?? so.id}`,
        ).catch(() => {});
        setTimeout(() => {
          showAlert({ type: 'success', title: 'Invoice Created', message: invRef ? `Invoice: ${invRef}` : 'Invoice created successfully.', autoClose: 2500 });
        }, 400);

      } else {
        // ── Create Sales Order ────────────────────────────────────────────────
        const soPayload = {
          campusId,
          locationId,
          customerOrgId,
          type: 'SO' as const,
          orderDate: formatOrderDate(orderDate),
          soDate: formatOrderDate(orderDate),
          note: note.trim() || undefined,
          receivedBy: receivedBy.trim() || undefined,
          items: lineItems,
          referenceNumber: !autoNumber && refNumber.trim() ? refNumber.trim() : undefined,
        };
        const so = await createSalesOrderApi(soPayload);

        const soId = so?.id ?? (so as any)?.data?.id;
        if (!soId) throw new Error(`Sales order created but no ID in response: ${JSON.stringify(so)}`);

        const soDetail = await getSalesOrderApi(soId);
        if (!soDetail?.id) throw new Error(`Could not fetch SO detail for id: ${soId}`);

        // Upload signature (non-fatal)
        let signatureUrl: string | undefined;
        try {
          if (sigUploadedUrl) {
            signatureUrl = sigUploadedUrl;
          } else if (!sigRef.current?.isEmpty()) {
            const pngDataUrl = await sigRef.current!.toPNG();
            signatureUrl = await uploadDirectApi({
              uri:      pngDataUrl,
              type:     'image/png',
              fileName: `signature-${soId}.png`,
            });
          }
          if (signatureUrl) await uploadSaleOrderSignatureApi(soId, signatureUrl);
        } catch {}

        vm.confirmOrder();
        setConfirmFormVisible(false);
        setReceivedBy('');
        setNote('');
        setDiscounts({});
        setPrices({});
        setSigUploaded(false);
        setSigUploadedUrl(null);
        setSelectedLocationId(null);
        sigRef.current?.clear();
        vm.retryLoad();
        const soRef = soDetail.referenceNumber ?? soDetail.ref ?? soId;
        const campusCode = soDetail.campusCode ?? soDetail.campus?.campusCode ?? vm.selectedCampus?.code ?? '';
        const soTotalCents = soDetail.totalCents ?? lineItems.reduce((s, it) => s + it.qty * it.unitPriceCents - (it.discountCents ?? 0), 0);
        const amountStr = `$${(soTotalCents / 100).toFixed(2)}`;
        broadcastPushApi(
          '🧾 New Sale Order',
          `Campus: ${campusCode}  |  Amount: ${amountStr}  |  Ref: ${soRef}`,
        ).catch(() => {});
        setTimeout(() => {
          showAlert({ type: 'success', title: 'Sale Order Created', message: `Reference: ${soRef}`, autoClose: 2500 });
        }, 400);
      }

    } catch (err: any) {
      const msg: string =
        err?.response?.data?.error?.messageKey ??
        err?.response?.data?.error?.code ??
        err?.response?.data?.message ??
        err?.message ??
        'Failed to submit';
      setSubmitError(msg);
      showAlert({ type: 'error', title: 'Submission Failed', message: msg });
    } finally {
      setSubmitting(false);
    }
  };

  const handleFormSubmit = () => {
    setPendingSubmit(true);
  };

  const handleFormClose = () => {
    setConfirmFormVisible(false);
    setSelectedLocationId(null);
    setOrderDate(new Date());
    setInvIssuedAt(new Date());
    setInvDueAt(null);
    setHasSig(false);
    setPendingSubmit(false);
    setAutoNumber(true);
    setRefNumber('');
    setPrices({});
  };

  const handleChangeCampus = () => {
    if (vm.totalItems > 0) {
      showAlert({
        type: 'warning',
        title: 'Change Campus?',
        message: 'Changing campus will clear your current order.',
        actions: [
          { label: 'Cancel', variant: 'outline' },
          { label: 'Change', variant: 'danger', onPress: vm.clearCampus },
        ],
      });
    } else {
      vm.clearCampus();
    }
  };

  return (
    <View style={styles.safeArea}>
      {/* App Bar */}
      <AppBar
        title={docType === 'QUO' ? 'Quotation' : docType === 'INV' ? 'Create Invoice' : 'Sale Order'}
        titleAlign="left"
        rightActions={
          <TouchableOpacity style={styles.campusChip} onPress={handleChangeCampus}>
            <Icon name="place" size={13} color={Colors.white} />
            <AppText style={styles.campusChipText}>{vm.selectedCampus.code}</AppText>
            <Icon name="arrow-drop-down" size={16} color={Colors.white} />
          </TouchableOpacity>
        }
      />

      {/* Doc type selector */}
      <View style={styles.typeStrip}>
        <TouchableOpacity
          style={[styles.typeChip, docType === 'QUO' && styles.typeChipQuoActive]}
          onPress={() => setDocType('QUO')}
          activeOpacity={0.8}
        >
          <Icon name="description" size={13} color={docType === 'QUO' ? Colors.white : '#10B981'} />
          <AppText style={[styles.typeChipText, docType === 'QUO' && styles.typeChipTextActive]}>
            Quotation
          </AppText>
        </TouchableOpacity>
<TouchableOpacity
          style={[styles.typeChip, docType === 'SO' && styles.typeChipActive]}
          onPress={() => setDocType('SO')}
          activeOpacity={0.8}
        >
          <Icon name="receipt-long" size={13} color={docType === 'SO' ? Colors.white : Colors.textSecondary} />
          <AppText style={[styles.typeChipText, docType === 'SO' && styles.typeChipTextActive]}>
            Sale Order
          </AppText>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.typeChip, docType === 'INV' && styles.typeChipInvActive]}
          onPress={() => setDocType('INV')}
          activeOpacity={0.8}
        >
          <Icon name="request-quote" size={13} color={docType === 'INV' ? Colors.white : '#7C3AED'} />
          <AppText style={[styles.typeChipText, docType === 'INV' && styles.typeChipTextActive]}>
            Invoice
          </AppText>
        </TouchableOpacity>
      </View>

      <View style={styles.content}>
        {/* Left: Category List */}
        {vm.loading ? (
          <View style={[styles.groupList, styles.groupListLoading]}>
            <ActivityIndicator color={Colors.primary} style={{ marginTop: 20 }} />
          </View>
        ) : (
          <GroupList
            groups={vm.groups}
            selectedId={vm.selectedGroupId}
            onSelect={vm.selectGroup}
          />
        )}

        {/* Right: Items Grid */}
        <KeyboardAvoidingView
          style={styles.itemsPanel}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.searchRow}>
            <View style={[styles.searchBar, { flex: 1 }]}>
              <Icon name="search" size={18} color={Colors.textSecondary} style={styles.searchIcon} />
              <TextInput
                style={styles.searchInput}
                placeholder="Search items..."
                placeholderTextColor={Colors.textLight}
                value={search}
                onChangeText={setSearch}
                returnKeyType="search"
                clearButtonMode="while-editing"
              />
              {search ? (
                <TouchableOpacity onPress={() => setSearch('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={{ paddingRight: 8 }}>
                  <Icon name="close" size={16} color={Colors.textSecondary} />
                </TouchableOpacity>
              ) : (
                <TouchableOpacity onPress={openScanner} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={{ paddingRight: 8 }}>
                  <Icon name="qr-code-scanner" size={18} color={Colors.primary} />
                </TouchableOpacity>
              )}
            </View>
            <TouchableOpacity
              style={styles.importBtn}
              onPress={() => {
                setImportRows([{ barcode: '', qty: '', discount: '' }]);
                setImportLoading(true);
                setImportVisible(true);
                vm.loadAllItems()
                  .then(setImportAllItems)
                  .catch(() => {})
                  .finally(() => setImportLoading(false));
              }}
              activeOpacity={0.8}
            >
              <Icon name="upload-file" size={18} color={Colors.white} />
              <AppText style={styles.importBtnText}>Import</AppText>
            </TouchableOpacity>
          </View>

          {vm.loading ? (
            <View style={styles.centerState}>
              <ActivityIndicator size="large" color={Colors.primary} />
              <AppText variant="caption" color="textSecondary" style={{ marginTop: 10 }}>
                Loading categories…
              </AppText>
            </View>
          ) : vm.error ? (
            <View style={styles.centerState}>
              <Icon name="error-outline" size={36} color={Colors.error} />
              <AppText variant="caption" color="error" style={{ marginTop: 8, textAlign: 'center', paddingHorizontal: 12 }}>
                {vm.error}
              </AppText>
              <TouchableOpacity style={styles.retryBtn} onPress={vm.retryLoad}>
                <AppText style={styles.retryText}>Retry</AppText>
              </TouchableOpacity>
            </View>
          ) : vm.itemsLoading ? (
            <View style={styles.centerState}>
              <ActivityIndicator size="large" color={Colors.primary} />
              <AppText variant="caption" color="textSecondary" style={{ marginTop: 10 }}>
                Loading products…
              </AppText>
            </View>
          ) : (
            <FlatList
              data={filteredItems}
              keyExtractor={item => item.id}
              extraData={vm.order}
              numColumns={3}
              columnWrapperStyle={styles.columnWrapper}
              renderItem={({ item }) => {
                const line = vm.order.lines.find(l => l.item.id === item.id);
                return (
                  <ItemCard
                    item={item}
                    quantity={line?.quantity ?? 0}
                    lineId={line?.id}
                    onAdd={vm.addItem}
                    onIncrement={vm.incrementLine}
                    onDecrement={vm.decrementLine}
                    onSetQty={vm.setLineQuantity}
                    imageCacheBuster={imageCacheBuster}
                  />
                );
              }}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={[styles.itemGrid, { paddingBottom: 8 }]}
              refreshControl={
                <RefreshControl
                  refreshing={refreshing}
                  onRefresh={() => { setRefreshing(true); vm.retryLoad(); }}
                  tintColor={Colors.primary}
                  colors={[Colors.primary]}
                />
              }
              ListEmptyComponent={
                <View style={styles.emptySearch}>
                  <Icon name="search-off" size={32} color={Colors.textLight} />
                  <AppText variant="caption" color="textLight" style={{ marginTop: 8 }}>
                    No items found
                  </AppText>
                </View>
              }
            />
          )}

          {/* Cart barcode+qty mini list */}
          {vm.totalItems > 0 && (
            <ScrollView
              style={styles.cartMiniList}
              nestedScrollEnabled
              showsVerticalScrollIndicator={false}
            >
              {vm.order.lines.map((line) => {
                const pct = parseFloat(discounts[line.id] || '0') || 0;
                const discountAmt = line.subtotal * pct / 100;
                const finalAmt = Math.max(0, line.subtotal - discountAmt);
                return (
                  <View key={line.id} style={styles.cartMiniRow}>
                    {/* Name */}
                    <View style={{ flex: 1 }}>
                      {line.item.sku ? (
                        <AppText style={styles.cartMiniBarcode}>{line.item.sku}</AppText>
                      ) : null}
                      {line.item.nameKh ? (
                        <AppText style={styles.cartMiniNameKh} numberOfLines={1}>{line.item.nameKh}</AppText>
                      ) : null}
                      <AppText style={styles.cartMiniNameEn} numberOfLines={1}>{line.item.name}</AppText>
                    </View>
                    {/* Price / Discount / Qty / Amount */}
                    <View style={styles.cartMiniRight}>
                      <AppText style={styles.cartMiniPrice}>${line.unitPrice.toFixed(2)}</AppText>
                      {/* Discount input */}
                      <View style={styles.cartMiniDiscountWrap}>
                        <TextInput
                          style={styles.cartMiniDiscountInput}
                          value={discounts[line.id] || ''}
                          onChangeText={v => {
                            const clean = v.replace(/[^0-9.]/g, '');
                            const num = parseFloat(clean);
                            if (!isNaN(num) && num > 100) return;
                            setDiscounts(prev => ({ ...prev, [line.id]: clean }));
                          }}
                          keyboardType="decimal-pad"
                          placeholder="0"
                          placeholderTextColor={Colors.textLight}
                          maxLength={6}
                          selectTextOnFocus
                        />
                        <AppText style={styles.cartMiniDiscountPct}>%</AppText>
                      </View>
                      {/* Qty stepper */}
                      <View style={styles.cartMiniStepper}>
                        <TouchableOpacity
                          onPress={() => line.quantity > 1 ? vm.decrementLine(line.id) : vm.setLineQuantity(line.id, 0)}
                          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                        >
                          <Icon name="remove" size={14} color={Colors.primary} />
                        </TouchableOpacity>
                        <AppText style={styles.cartMiniStepperQty}>{line.quantity}</AppText>
                        <TouchableOpacity
                          onPress={() => vm.incrementLine(line.id)}
                          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                        >
                          <Icon name="add" size={14} color={Colors.primary} />
                        </TouchableOpacity>
                      </View>
                      <AppText style={styles.cartMiniAmount}>${finalAmt.toFixed(2)}</AppText>
                    </View>
                  </View>
                );
              })}
            </ScrollView>
          )}

          {/* Cart Button — fixed below product list */}
          {vm.totalItems > 0 && (
            <TouchableOpacity
              style={styles.cartFooterBtn}
              onPress={handleConfirm}
              activeOpacity={0.9}
            >
              <View style={styles.cartFooterIcon}>
                <Icon name="shopping-cart" size={20} color={Colors.primary} />
                <View style={styles.cartFooterBadge}>
                  <AppText style={styles.cartFooterBadgeText}>{vm.totalItems}</AppText>
                </View>
              </View>
              <View style={styles.cartFooterRight}>
                <AppText style={styles.cartFooterTotal}>
                  ${vm.order.total.toFixed(2)}
                </AppText>
                <Icon name="chevron-right" size={20} color={Colors.white} />
              </View>
            </TouchableOpacity>
          )}
        </KeyboardAvoidingView>
      </View>

      {/* ── Import Screen — absolute overlay avoids iOS DocumentPicker dismissing a native Modal VC ── */}
      {importVisible && (
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 99, backgroundColor: Colors.background }}>
          <AppBar
            title="Import Items"
            titleAlign="left"
            showBack
            onBack={() => setImportVisible(false)}
            rightActions={
              <View style={{ flexDirection: 'row', gap: 6 }}>
                <TouchableOpacity
                  style={styles.importActionBtn}
                  onPress={async () => {
                    const csv = '﻿' + 'Barcode,Qty,Discount\n';
                    const path = `${FileSystem.cacheDirectory ?? FileSystem.documentDirectory}order-template-${Date.now()}.csv`;
                    try {
                      await FileSystem.writeAsStringAsync(path, csv);
                      const canShare = await Sharing.isAvailableAsync();
                      if (canShare) await Sharing.shareAsync(path, { mimeType: 'text/csv', dialogTitle: 'Export Template' });
                    } catch (err: any) {
                      if (err?.message !== 'User did not share') {
                        showAlert({ type: 'error', title: 'Export Failed', message: err?.message ?? 'Failed to export' });
                      }
                    }
                  }}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Icon name="file-download" size={16} color={Colors.white} />
                  <AppText style={styles.importActionBtnText}>Template</AppText>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.importActionBtn, { backgroundColor: 'rgba(16,185,129,0.25)' }]}
                  onPress={async () => {
                    try {
                      const res = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
                      if (res.canceled) return;
                      const fileUri = res.assets[0].uri;
                      // Copy to app cache first so readAsStringAsync gets a stable sandbox path
                      const destUri = `${FileSystem.cacheDirectory ?? FileSystem.documentDirectory}import_${Date.now()}.csv`;
                      await FileSystem.copyAsync({ from: fileUri, to: destUri });
                      let content: string;
                      try {
                        content = await FileSystem.readAsStringAsync(destUri);
                      } finally {
                        FileSystem.deleteAsync(destUri, { idempotent: true }).catch(() => {});
                      }
                      const lines = content.replace(/^﻿/, '').split('\n').map(l => l.trim()).filter(Boolean);
                      const parsed: Array<{ barcode: string; qty: string; discount: string }> = [];
                      const normalizeBarcode = (raw: string): string => {
                        let v = raw.replace(/^﻿/, '').trim().replace(/^=?"?|"?$/g, '').trim();
                        if (/^[\d.]+[eE][+\-]?\d+$/.test(v)) v = String(Math.round(parseFloat(v)));
                        return v;
                      };
                      for (const line of lines) {
                        const cols = line.split(',');
                        const barcode = normalizeBarcode(cols[0] ?? '');
                        const qtyCol  = cols[1]?.trim().replace(/^"|"$/g, '');
                        const discCol = cols[2]?.trim().replace(/^"|"$/g, '') ?? '';
                        if (!barcode || barcode.toLowerCase() === 'barcode') continue;
                        const qty = parseInt(qtyCol) || 0;
                        if (qty > 0) {
                          parsed.push({ barcode, qty: String(qty), discount: parseFloat(discCol) > 0 ? String(parseFloat(discCol)) : '' });
                        }
                      }
                      if (parsed.length === 0) {
                        showAlert({ type: 'warning', title: 'No Data', message: 'No valid rows found. Ensure Qty column is filled.' });
                        return;
                      }
                      setImportRows(parsed);
                    } catch (err: any) {
                      showAlert({ type: 'error', title: 'Import Failed', message: err?.message ?? 'Failed to read file' });
                    }
                  }}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Icon name="upload-file" size={16} color={Colors.white} />
                  <AppText style={styles.importActionBtnText}>CSV</AppText>
                </TouchableOpacity>
              </View>
            }
          />

          {/* Product load status banner */}
          {importLoading ? (
            <View style={styles.importStatusBanner}>
              <ActivityIndicator size="small" color={Colors.primary} />
              <AppText style={styles.importStatusText}>Loading products…</AppText>
            </View>
          ) : (
            <View style={[styles.importStatusBanner, styles.importStatusBannerReady]}>
              <Icon name="check-circle" size={14} color="#10B981" />
              <AppText style={[styles.importStatusText, { color: '#059669' }]}>
                {importAllItems.length} products ready
              </AppText>
            </View>
          )}

          <FlatList
            style={{ flex: 1 }}
            contentContainerStyle={{ padding: 12, paddingBottom: 8 }}
            keyboardShouldPersistTaps="handled"
            data={importRows}
            keyExtractor={(_, idx) => String(idx)}
            ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
            renderItem={({ item: row, index: idx }) => {
              const matched = row.barcode.trim()
                ? importAllItems.find(p => p.sku?.toLowerCase() === row.barcode.toLowerCase().trim())
                : null;
              const notFound = !!(row.barcode.trim() && !matched && !importLoading);
              const qty = parseInt(row.qty) || 0;
              const discPct = parseFloat(row.discount) || 0;
              const price = matched ? matched.price : 0;
              const amount = price * qty * (1 - discPct / 100);
              return (
                <View style={styles.importCard}>
                  {/* Barcode row */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <View style={[styles.importInputWrap, { flex: 1 }, notFound && styles.importInputError]}>
                      <TextInput
                        style={styles.importInput}
                        value={row.barcode}
                        onChangeText={v => setImportRows(prev => prev.map((r, i) => i === idx ? { ...r, barcode: v } : r))}
                        placeholder="Barcode / SKU"
                        placeholderTextColor={Colors.textLight}
                        autoCapitalize="none"
                      />
                    </View>
                    <TouchableOpacity
                      style={styles.importRemoveBtn}
                      onPress={() => setImportRows(prev => prev.length > 1 ? prev.filter((_, i) => i !== idx) : [{ barcode: '', qty: '', discount: '' }])}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Icon name="close" size={18} color={Colors.error} />
                    </TouchableOpacity>
                  </View>
                  {/* Product name */}
                  {importLoading && row.barcode.trim() ? (
                    <ActivityIndicator size="small" color={Colors.textLight} style={{ alignSelf: 'flex-start' }} />
                  ) : matched ? (
                    <AppText style={styles.importMatchLabel} numberOfLines={1}>
                      {matched.nameKh || matched.name}
                    </AppText>
                  ) : notFound ? (
                    <AppText style={styles.importNoMatchLabel}>Not found</AppText>
                  ) : null}
                  {/* Price / Qty stepper / Disc / Amount */}
                  {matched && (
                    <View style={styles.importDetailsRow}>
                      <View style={styles.importDetailCell}>
                        <AppText style={styles.importDetailLabel}>Price</AppText>
                        <AppText style={styles.importDetailValue}>${price.toFixed(2)}</AppText>
                      </View>
                      <View style={styles.importDetailCell}>
                        <AppText style={styles.importDetailLabel}>Qty</AppText>
                        <View style={styles.importQtyStepper}>
                          <TouchableOpacity
                            style={styles.importQtyBtn}
                            onPress={() => setImportRows(prev => prev.map((r, i) => i === idx ? { ...r, qty: String(Math.max(1, (parseInt(r.qty) || 1) - 1)) } : r))}
                            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                          >
                            <Icon name="remove" size={14} color={Colors.primary} />
                          </TouchableOpacity>
                          <TextInput
                            style={styles.importQtyInput}
                            value={row.qty}
                            onChangeText={v => setImportRows(prev => prev.map((r, i) => i === idx ? { ...r, qty: v.replace(/[^0-9]/g, '') } : r))}
                            keyboardType="number-pad"
                            maxLength={4}
                            textAlign="center"
                          />
                          <TouchableOpacity
                            style={styles.importQtyBtn}
                            onPress={() => setImportRows(prev => prev.map((r, i) => i === idx ? { ...r, qty: String((parseInt(r.qty) || 0) + 1) } : r))}
                            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                          >
                            <Icon name="add" size={14} color={Colors.primary} />
                          </TouchableOpacity>
                        </View>
                      </View>
                      <View style={styles.importDetailCell}>
                        <AppText style={styles.importDetailLabel}>Disc%</AppText>
                        <View style={styles.importInputWrap}>
                          <TextInput
                            style={[styles.importInput, { textAlign: 'center', paddingVertical: 4 }]}
                            value={row.discount}
                            onChangeText={v => setImportRows(prev => prev.map((r, i) => i === idx ? { ...r, discount: v.replace(/[^0-9.]/g, '') } : r))}
                            placeholder="0"
                            placeholderTextColor={Colors.textLight}
                            keyboardType="decimal-pad"
                            maxLength={5}
                          />
                        </View>
                      </View>
                      <View style={[styles.importDetailCell, { alignItems: 'flex-end' }]}>
                        <AppText style={styles.importDetailLabel}>Amount</AppText>
                        <AppText style={[styles.importDetailValue, { color: Colors.primary }]}>${amount.toFixed(2)}</AppText>
                      </View>
                    </View>
                  )}
                </View>
              );
            }}
            ListFooterComponent={
              <TouchableOpacity
                style={[styles.importAddRowBtn, { marginTop: 8 }]}
                onPress={() => setImportRows(prev => [...prev, { barcode: '', qty: '', discount: '' }])}
              >
                <Icon name="add" size={18} color={Colors.primary} />
                <AppText style={styles.importAddRowText}>Add Row</AppText>
              </TouchableOpacity>
            }
          />

          {/* Footer: total + confirm */}
          <View style={[styles.importFooter, { paddingBottom: 16 + bottomInset }]}>
            {(() => {
              const validRows = importRows.filter(r => {
                const m = r.barcode.trim() ? importAllItems.find(p => p.sku?.toLowerCase() === r.barcode.toLowerCase().trim()) : null;
                return m && parseInt(r.qty) > 0;
              });
              const total = validRows.reduce((sum, r) => {
                const m = importAllItems.find(p => p.sku?.toLowerCase() === r.barcode.toLowerCase().trim())!;
                const disc = parseFloat(r.discount) || 0;
                return sum + m.price * (parseInt(r.qty) || 0) * (1 - disc / 100);
              }, 0);
              return (
                <View style={styles.importTotalRow}>
                  <AppText style={styles.importTotalLabel}>Total</AppText>
                  <AppText style={styles.importTotalValue}>${total.toFixed(2)}</AppText>
                </View>
              );
            })()}
            <TouchableOpacity
              style={styles.importConfirmBtn}
              activeOpacity={0.85}
              onPress={() => {
                const validRows = importRows.filter(r => r.barcode.trim() && parseInt(r.qty) > 0);
                if (validRows.length === 0) return;
                const discountBySku: Record<string, string> = {};
                for (const r of validRows) {
                  if (r.discount && parseFloat(r.discount) > 0) discountBySku[r.barcode.trim()] = r.discount;
                }
                if (Object.keys(discountBySku).length > 0) pendingImportDiscountsRef.current = discountBySku;
                const notFound = vm.bulkImport(validRows.map(r => ({ sku: r.barcode.trim(), qty: parseInt(r.qty) || 1 })), importAllItems);
                setImportVisible(false);
                if (notFound.length > 0) {
                  setTimeout(() => showAlert({
                    type: 'warning',
                    title: 'Some items not found',
                    message: `Could not find: ${notFound.join(', ')}`,
                  }), 400);
                }
              }}
            >
              <Icon name="check" size={20} color={Colors.white} />
              <AppText style={styles.importConfirmText}>
                Import {importRows.filter(r => r.barcode.trim() && parseInt(r.qty) > 0).length} item{importRows.filter(r => r.barcode.trim() && parseInt(r.qty) > 0).length !== 1 ? 's' : ''}
              </AppText>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Confirm Order Screen */}
      <Modal
        visible={confirmFormVisible}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={handleFormClose}
      >
        <SafeAreaView style={styles.modalSafe} edges={['bottom']}>
          <AppBar
            title={docType === 'QUO' ? 'Confirm Quotation' : docType === 'INV' ? 'Confirm Invoice' : 'Confirm Order'}
            titleAlign="left"
            showBack
            onBack={handleFormClose}
            rightActions={
              <TouchableOpacity
                onPress={() => { vm.clearOrder(); handleFormClose(); }}
                style={styles.clearOrderBtn}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Icon name="delete-outline" size={18} color={Colors.white} />
                <AppText style={styles.clearOrderText}>Clear</AppText>
              </TouchableOpacity>
            }
          />

          <KeyboardAvoidingView
            style={{ flex: 1 }}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          >
            <View style={{ flex: 1 }}>
            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={styles.confirmBody}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >

              {/* Location — compact horizontal chips */}
              {locations.length > 0 && (
                <View style={styles.locationChips}>
                  {locations.map(loc => {
                    const selected = selectedLocationId === loc.id;
                    return (
                      <TouchableOpacity
                        key={String(loc.id)}
                        style={[styles.locationChip, selected && styles.locationChipSelected]}
                        onPress={() => setSelectedLocationId(selected ? null : loc.id)}
                        activeOpacity={0.75}
                      >
                        <AppText style={[styles.locationChipText, selected && styles.locationChipTextSelected]}>
                          {loc.code ?? loc.nameEn ?? String(loc.id)}
                        </AppText>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}

              {/* Order Items */}
              <View>
                <AppText style={styles.sectionLabel}>
                  Order Items ({vm.totalItems})
                </AppText>
                <View style={styles.orderCard}>

                  {/* Campus header */}
                  {vm.selectedCampus && (
                    <View style={styles.orderCardCampus}>
                      <Icon name="place" size={18} color={Colors.primary} />
                      <AppText style={styles.orderCardCampusCode}>
                        {vm.selectedCampus.code}
                      </AppText>
                      <AppText style={styles.orderCardCampusName} numberOfLines={1}>
                        {vm.selectedCampus.name}
                      </AppText>
                    </View>
                  )}

                  {/* Divider */}
                  <View style={styles.orderCardDivider} />

                  {/* Items */}
                  <View>
                {vm.order.lines.map((line, index) => {
                  const effectivePrice    = parseFloat(prices[line.id] || '') || line.unitPrice;
                  const effectiveLineTotal = effectivePrice * line.quantity;
                  const pct              = parseFloat(discounts[line.id] || '0') || 0;
                  const itemDiscount     = effectiveLineTotal * pct / 100;
                  const itemFinal        = Math.max(0, effectiveLineTotal - itemDiscount);
                  return (
                    <View key={line.id}>
                      {/* Item row */}
                      <View style={styles.orderItemRow}>
                        <View style={styles.orderItemImageBox}>
                          {line.item.primaryImageUrl ? (
                            <Image
                              source={{ uri: `${line.item.primaryImageUrl}?t=${imageCacheBuster}` }}
                              style={styles.orderItemImage}
                              resizeMode="cover"
                            />
                          ) : (
                            <View style={styles.orderItemImagePlaceholder}>
                              <Icon name="fastfood" size={18} color="#CBD5E1" />
                            </View>
                          )}
                          <View style={styles.orderItemIndexBadge}>
                            <AppText style={styles.orderItemIndexText}>{index + 1}</AppText>
                          </View>
                        </View>
                        <View style={styles.orderItemNames}>
                          {line.item.sku ? (
                            <View style={styles.orderItemCodeChip}>
                              <AppText style={styles.orderItemCodeText}>{line.item.sku}</AppText>
                            </View>
                          ) : null}
                          <AppText style={styles.orderItemNameEn} numberOfLines={2}>
                            {line.item.name}
                          </AppText>
                          {line.item.nameKh ? (
                            <AppText style={styles.orderItemNameKh} numberOfLines={1}>
                              {line.item.nameKh}
                            </AppText>
                          ) : null}
                        </View>
                        <View style={styles.orderItemRight}>
                          {itemDiscount > 0 ? (
                            <>
                              <AppText style={styles.orderItemPriceOld}>
                                ${effectiveLineTotal.toFixed(2)}
                              </AppText>
                              <AppText style={styles.orderItemPrice}>
                                ${itemFinal.toFixed(2)}
                              </AppText>
                            </>
                          ) : (
                            <AppText style={styles.orderItemPrice}>
                              ${effectiveLineTotal.toFixed(2)}
                            </AppText>
                          )}
                          <AppText style={styles.orderItemUnit}>
                            ${effectivePrice.toFixed(2)} × {line.quantity}
                          </AppText>
                        </View>
                      </View>

                      {/* Qty row */}
                      <View style={styles.itemQtyRow}>
                        <View style={styles.itemDiscountLeft}>
                          <Icon name="format-list-numbered" size={13} color={Colors.primary} />
                          <AppText style={styles.itemQtyLabel}>Qty</AppText>
                        </View>
                        <ConfirmQtyPill
                          qty={line.quantity}
                          onDecrement={() => {
                            if (line.quantity > 1) vm.decrementLine(line.id);
                            else vm.setLineQuantity(line.id, 0);
                          }}
                          onIncrement={() => vm.incrementLine(line.id)}
                          onSet={n => vm.setLineQuantity(line.id, n)}
                          disabled={lineEditLocked}
                        />
                      </View>

                      {/* Price row */}
                      <View style={styles.itemPriceRow}>
                        <View style={styles.itemDiscountLeft}>
                          <Icon name="attach-money" size={13} color={Colors.primary} />
                          <AppText style={styles.itemPriceLabel}>Price</AppText>
                        </View>
                        <View style={styles.itemDiscountRight}>
                          <View style={[styles.itemPriceInputWrap, lineEditLocked && styles.itemDiscountInputWrapDisabled]}>
                            <TextInput
                              style={[styles.itemPriceInput, lineEditLocked && styles.itemDiscountInputDisabled]}
                              value={prices[line.id] || ''}
                              onChangeText={v => {
                                const clean = v.replace(/[^0-9.]/g, '');
                                setPrices(prev => ({ ...prev, [line.id]: clean }));
                              }}
                              editable={!lineEditLocked}
                              keyboardType="decimal-pad"
                              placeholder={line.unitPrice.toFixed(2)}
                              placeholderTextColor={Colors.textLight}
                              maxLength={10}
                              selectTextOnFocus
                            />
                          </View>
                        </View>
                      </View>

                      {/* Discount row */}
                      <View style={styles.itemDiscountRow}>
                        <View style={styles.itemDiscountLeft}>
                          <Icon name="sell" size={13} color="#7C3AED" />
                          <AppText style={styles.itemDiscountLabel}>Discount</AppText>
                        </View>
                        <View style={styles.itemDiscountRight}>
                          <View style={[styles.itemDiscountInputWrap, lineEditLocked && styles.itemDiscountInputWrapDisabled]}>
                            <TextInput
                              style={[styles.itemDiscountInput, lineEditLocked && styles.itemDiscountInputDisabled]}
                              value={discounts[line.id] || ''}
                              onChangeText={v => {
                                const clean = v.replace(/[^0-9.]/g, '');
                                const num = parseFloat(clean);
                                if (!isNaN(num) && num > 100) return;
                                setDiscounts(prev => ({ ...prev, [line.id]: clean }));
                              }}
                              editable={!lineEditLocked}
                              keyboardType="decimal-pad"
                              placeholder="0"
                              placeholderTextColor={Colors.textLight}
                              maxLength={6}
                              selectTextOnFocus
                            />
                            <AppText style={[styles.itemDiscountPct, lineEditLocked && styles.itemDiscountPctDisabled]}>%</AppText>
                          </View>
                          {itemDiscount > 0 ? (
                            <AppText style={styles.itemDiscountSaving}>−${itemDiscount.toFixed(2)}</AppText>
                          ) : null}
                        </View>
                      </View>

                      {index < vm.order.lines.length - 1 && (
                        <View style={styles.orderCardDivider} />
                      )}
                    </View>
                  );
                })}
                  </View>

                {/* Totals */}
                <View style={styles.orderCardDivider} />
                <View style={styles.orderTotalsBox}>
                  <View style={styles.orderTotalRow}>
                    <AppText style={styles.orderTotalRowLabel}>Subtotal</AppText>
                    <AppText style={styles.orderTotalRowValue}>
                      ${effectiveSubtotal.toFixed(2)}
                    </AppText>
                  </View>
                  {totalDiscount > 0 && (
                    <View style={styles.orderTotalRow}>
                      <View style={styles.discountLabelRow}>
                        <Icon name="sell" size={13} color="#7C3AED" />
                        <AppText style={styles.discountLabel}>Total Discount</AppText>
                      </View>
                      <AppText style={styles.discountValue}>
                        −${totalDiscount.toFixed(2)}
                      </AppText>
                    </View>
                  )}
                  <View style={styles.orderCardDivider} />
                  <View style={styles.orderItemsTotal}>
                    <AppText style={styles.orderItemsTotalLabel}>Total</AppText>
                    <AppText style={styles.orderItemsTotalValue}>
                      ${finalTotal.toFixed(2)}
                    </AppText>
                  </View>
                </View>
              </View>
              </View>

              {/* Delivery Info / Note — compact single-line inputs */}
              <View style={styles.confirmInfoRow}>

                {/* Reference number toggle */}
                <View style={styles.refNumberRow}>
                  <View style={styles.refNumberLeft}>
                    <Icon name="tag" size={15} color={Colors.primary} />
                    <AppText style={styles.refNumberLabel}>Ref Number</AppText>
                  </View>
                  <View style={styles.refNumberRight}>
                    <AppText style={styles.refNumberAutoText}>Auto</AppText>
                    <Switch
                      value={autoNumber}
                      onValueChange={setAutoNumber}
                      trackColor={{ false: Colors.primaryMuted, true: Colors.border }}
                      thumbColor={autoNumber ? Colors.primary : Colors.textLight}
                      style={{ transform: [{ scaleX: 0.85 }, { scaleY: 0.85 }] }}
                    />
                  </View>
                </View>
                {!autoNumber && (
                  <TextInput
                    style={styles.refNumberInput}
                    value={refNumber}
                    onChangeText={setRefNumber}
                    placeholder="Enter reference number"
                    placeholderTextColor={Colors.textLight}
                    autoCapitalize="characters"
                    returnKeyType="done"
                  />
                )}

                {/* Date picker row — Order Date for SO/QUO, Issue+Due for INV */}
                {docType !== 'INV' ? (
                  <View style={styles.dateRow}>
                    <Icon name="event" size={16} color={Colors.primary} style={styles.dateIcon} />
                    <AppText style={styles.dateLabel}>Order Date</AppText>
                    <TouchableOpacity
                      style={styles.dateTouchable}
                      onPress={() => setDatePickerVisible(true)}
                      activeOpacity={0.75}
                    >
                      <AppText style={styles.dateValue}>
                        {orderDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                      </AppText>
                      <Icon name="edit-calendar" size={16} color={Colors.primary} />
                    </TouchableOpacity>
                  </View>
                ) : (
                  <View style={styles.invDateRow}>
                    <View style={{ flex: 1 }}>
                      <AppText style={styles.invDateLabel}>Issue Date</AppText>
                      <TouchableOpacity
                        style={styles.invDateBtn}
                        onPress={() => setInvDatePickerFor('issued')}
                        activeOpacity={0.75}
                      >
                        <AppText style={styles.invDateBtnText}>
                          {invIssuedAt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                        </AppText>
                        <Icon name="edit-calendar" size={15} color={Colors.primary} />
                      </TouchableOpacity>
                    </View>
                    <View style={{ flex: 1 }}>
                      <AppText style={styles.invDateLabel}>Due Date</AppText>
                      <TouchableOpacity
                        style={styles.invDateBtn}
                        onPress={() => setInvDatePickerFor('due')}
                        activeOpacity={0.75}
                      >
                        <AppText style={[styles.invDateBtnText, !invDueAt && { color: '#94a3b8' }]}>
                          {invDueAt
                            ? invDueAt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
                            : 'Optional'}
                        </AppText>
                        <Icon name="edit-calendar" size={15} color={Colors.primary} />
                      </TouchableOpacity>
                    </View>
                  </View>
                )}

                {docType === 'SO' && (
                  <AppInput
                    label="Received By"
                    value={receivedBy}
                    onChangeText={setReceivedBy}
                    placeholder="Name of recipient"
                  />
                )}
                {docType === 'INV' && (
                  <View style={styles.invRateRow}>
                    <AppText style={styles.invRateLabel}>Exchange Rate (KHR)</AppText>
                    <TextInput
                      style={styles.invRateInput}
                      value={rateUsed}
                      onChangeText={setRateUsed}
                      keyboardType="numeric"
                      selectTextOnFocus
                      placeholder="4100"
                      placeholderTextColor={Colors.textLight}
                    />
                  </View>
                )}
                <AppInput
                  label={docType === 'QUO' ? 'Note (optional)' : 'Note (optional)'}
                  value={note}
                  onChangeText={setNote}
                  placeholder={docType === 'SO' ? 'Delivery note…' : docType === 'INV' ? 'Invoice note…' : 'Quotation note…'}
                  multiline
                  numberOfLines={2}
                />
              </View>

            </ScrollView>

            {/* Signature — SO and INV only, fixed below scroll area */}
            {(docType === 'SO' || docType === 'INV') && (
              <View style={styles.sigCard}>
                {/* Header */}
                <View style={styles.sigHeader}>
                  <View style={styles.sigHeaderLeft}>
                    <Icon name="draw" size={16} color={Colors.primary} />
                    <AppText style={styles.sigHeaderTitle}>Signature <AppText style={styles.requiredMark}>*</AppText></AppText>
                  </View>
                  <View style={styles.sigHeaderActions}>
                    <TouchableOpacity
                      onPress={async () => {
                        if (sigRef.current?.isEmpty()) {
                          showAlert({ type: 'warning', title: 'No Signature', message: 'Please draw a signature first.' });
                          return;
                        }
                        setSigUploading(true);
                        try {
                          const pngDataUrl = await sigRef.current!.toPNG();
                          const url = await uploadDirectApi({
                            uri:      pngDataUrl,
                            type:     'image/png',
                            fileName: `signature-preview.png`,
                          });
                          setSigUploadedUrl(url);
                          setSigUploaded(true);
                        } catch (e: any) {
                          showAlert({ type: 'error', title: 'Upload Failed', message: e?.message ?? 'Could not upload signature' });
                        } finally {
                          setSigUploading(false);
                        }
                      }}
                      style={[styles.sigUploadBtn, sigUploaded && styles.sigUploadBtnDone]}
                      disabled={sigUploading}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      {sigUploading
                        ? <ActivityIndicator size="small" color={sigUploaded ? '#10B981' : Colors.primary} />
                        : <Icon name={sigUploaded ? 'check-circle' : 'cloud-upload'} size={13} color={sigUploaded ? '#10B981' : Colors.primary} />}
                      <AppText style={[styles.sigUploadText, sigUploaded && styles.sigUploadTextDone]}>
                        {sigUploaded ? 'Uploaded' : 'Upload'}
                      </AppText>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => { sigRef.current?.clear(); setSigUploaded(false); setSigUploadedUrl(null); setHasSig(false); }}
                      style={styles.sigClearBtn}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Icon name="refresh" size={13} color={Colors.primary} />
                      <AppText style={styles.sigClearText}>Clear</AppText>
                    </TouchableOpacity>
                  </View>
                </View>
                {/* Drawing area */}
                <View style={styles.sigDrawArea}>
                  <SignaturePad
                    ref={sigRef}
                    style={styles.sigPad}
                    onDrawEnd={() => setHasSig(true)}
                  />
                </View>
              </View>
            )}
            </View>
          </KeyboardAvoidingView>

          {/* Submit */}
          <View style={styles.confirmActions}>
            {submitError ? (
              <View style={styles.submitErrorBox}>
                <Icon name="error-outline" size={16} color={Colors.error} />
                <AppText style={styles.submitErrorText} numberOfLines={3}>
                  {submitError}
                </AppText>
              </View>
            ) : null}
            <AppButton
              label={docType === 'QUO' ? 'Create Quotation' : docType === 'INV' ? 'Create Invoice' : 'Submit Order'}
              onPress={handleFormSubmit}
              variant="primary"
              size="lg"
              fullWidth
              loading={submitting}
              disabled={submitting || (docType !== 'QUO' && !hasSig && !sigUploadedUrl)}
            />
          </View>

          {/* Confirmation Modal */}
          <Modal
            visible={pendingSubmit}
            transparent
            animationType="fade"
            onRequestClose={() => !submitting && setPendingSubmit(false)}
          >
            <View style={styles.pendingOverlay}>
              <View style={styles.pendingCard}>
                <AnimatedConfirmIcon />
                <AppText variant="h4" align="center" style={styles.pendingTitle}>
                  {docType === 'QUO' ? 'Create Quotation' : docType === 'INV' ? 'Create Invoice' : 'Submit Order'}
                </AppText>
                <AppText style={styles.pendingMsg}>
                  {docType === 'QUO'
                    ? 'Are you sure you want to create this quotation?'
                    : docType === 'INV'
                    ? 'Are you sure you want to create this invoice?'
                    : 'Are you sure you want to submit this sale order?'}
                </AppText>
                <View style={styles.pendingDivider} />
                <View style={styles.pendingBtns}>
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
                    onPress={() => { setPendingSubmit(false); doSubmit(); }}
                    variant="primary"
                    size="md"
                    style={{ flex: 1 }}
                    loading={submitting}
                    disabled={submitting || (docType !== 'QUO' && !hasSig && !sigUploadedUrl)}
                  />
                </View>
              </View>
            </View>
          </Modal>

        </SafeAreaView>
      </Modal>

      <DatePickerModal
        visible={datePickerVisible}
        value={orderDate}
        onChange={setOrderDate}
        onClose={() => setDatePickerVisible(false)}
      />

      <DatePickerModal
        visible={invDatePickerFor !== null}
        value={invDatePickerFor === 'due' ? (invDueAt ?? new Date()) : invIssuedAt}
        onChange={date => {
          if (invDatePickerFor === 'issued') setInvIssuedAt(date);
          else setInvDueAt(date);
        }}
        onClose={() => setInvDatePickerFor(null)}
      />

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
  safeArea: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    flex: 1,
    flexDirection: 'row',
  },

  // Group List
  groupList: {
    width: '15%',
    backgroundColor: Colors.white,
    borderRightWidth: 1,
    borderRightColor: Colors.divider,
  },
  groupListLoading: {
    alignItems: 'center',
  },
  groupListHeader: {
    paddingHorizontal: 12,
    paddingTop: 16,
    paddingBottom: 8,
  },
  groupItem: {
    paddingVertical: 12,
    paddingHorizontal: 8,
    position: 'relative',
    alignItems: 'center',
  },
  groupItemActive: {
    backgroundColor: Colors.primaryMuted,
  },
  groupIconBox: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.background,
    marginBottom: 6,
  },
  groupName: {
    color: Colors.textSecondary,
    fontSize: 11,
    textAlign: 'center',
    fontWeight: '500',
    lineHeight: 15,
  },
  groupNameActive: {
    color: Colors.primary,
    fontWeight: '700',
  },
  groupActiveLine: {
    position: 'absolute',
    right: 0,
    top: 12,
    bottom: 12,
    width: 3,
    backgroundColor: Colors.primary,
    borderRadius: 2,
  },

  // Items Panel
  itemsPanel: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 4,
    gap: 8,
  },
  importBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.primary,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 4,
  },
  importBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.white,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  searchIcon: {
    marginRight: 6,
  },
  searchInput: {
    flex: 1,
    fontSize: 18,
    color: Colors.text,
    paddingVertical: 0,
  },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 40,
  },
  retryBtn: {
    marginTop: 14,
    backgroundColor: Colors.primary,
    borderRadius: 10,
    paddingHorizontal: 28,
    paddingVertical: 10,
  },
  retryText: {
    color: Colors.white,
    fontWeight: '700',
    fontSize: 14,
  },
  emptySearch: {
    alignItems: 'center',
    paddingTop: 48,
  },
  itemGrid: {
    padding: 10,
    paddingBottom: 100,
    gap: 10,
  },
  columnWrapper: {
    gap: 10,
  },
  // OrderLineRow styles
  orderLine: { marginBottom: 8 },
  orderLineInfo: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  lineSubtotal: { fontWeight: '700' },
  qtyRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  qtyBtn: { width: 28, height: 28, borderRadius: 8, backgroundColor: Colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  qtyBtnText: { fontSize: 18, color: Colors.primary, fontWeight: '700', lineHeight: 22 },
  qtyValue: { minWidth: 24, textAlign: 'center', fontWeight: '700' },
  removeBtn: { marginLeft: 4, padding: 4 },
  removeBtnText: { color: Colors.error, fontWeight: '700' },

  itemCard: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.border,
    shadowColor: Colors.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 6,
    elevation: 2,
  },
  itemCardDisabled: {
    opacity: 0.5,
  },
  itemImageBox: {
    width: '100%',
    aspectRatio: 1,
    backgroundColor: '#F1F5F9',
    position: 'relative',
  },
  itemImage: {
    width: '100%',
    height: '100%',
  },
  itemImageHidden: {
    opacity: 0,
  },
  itemImageLoading: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F1F5F9',
  },
  itemImagePlaceholder: {
    width: '100%',
    height: '100%',
    backgroundColor: '#F8FAFC',
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemCardInner: {
    padding: 8,
    gap: 3,
  },
  itemCardTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 4,
  },
  itemName: {
    flex: 1,
    fontSize: 12,
    fontWeight: '700',
    color: Colors.text,
    lineHeight: 16,
    paddingTop: 6,
    paddingBottom: 6,
  },
  itemNameKh: {
    fontSize: 11,
    fontWeight: '500',
    color: Colors.textSecondary,
    lineHeight: 15,
  },
  itemSkuChip: {
    alignSelf: 'flex-start',
    backgroundColor: Colors.primaryLight,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: `${Colors.primary}40`,
  },
  itemSku: {
    fontSize: 11,
    color: Colors.primary,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  itemPrice: {
    fontSize: 14,
    fontWeight: '800',
    color: Colors.primary,
  },
  itemLocationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: '#D1FAE5',
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
    alignSelf: 'flex-start',
  },
  itemLocationText: {
    fontSize: 9,
    color: '#059669',
    fontWeight: '600',
  },
  itemCatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  itemCatText: {
    fontSize: 10,
    color: '#7C3AED',
    fontWeight: '600',
  },
  itemOnhandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#DBEAFE',
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
    alignSelf: 'flex-start',
  },
  itemOnhandText: {
    fontSize: 10,
    color: '#2563EB',
    fontWeight: '700',
  },
  itemCardBottom: {
    flexDirection: 'column',
    marginTop: 4,
    gap: 8,
  },
  unavailableBadge: {
    backgroundColor: Colors.errorLight,
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  unavailableText: {
    fontSize: 9,
    color: Colors.error,
    fontWeight: '700',
  },
  // In-cart badge on image
  itemBadge: {
    position: 'absolute',
    top: 5,
    right: 5,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 4,
    elevation: 4,
  },
  itemBadgeText: {
    color: Colors.white,
    fontSize: 10,
    fontWeight: '800',
  },

  // Add button (qty = 0)
  addBtn: {
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
    elevation: 4,
  },

  // Qty stepper pill (qty > 0)
  qtyPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'stretch',
    backgroundColor: Colors.primary,
    borderRadius: 16,
    overflow: 'hidden',
    height: 32,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
    elevation: 4,
  },
  qtyPillBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qtyPillInput: {
    flex: 1,
    height: 32,
    textAlign: 'center',
    fontSize: 18,
    fontWeight: '800',
    color: Colors.white,
    padding: 0,
  },
  qtyPillInputEditing: {
    color: Colors.primary,
  },
  qtyPillEditing: {
    backgroundColor: Colors.white,
    borderWidth: 2,
    borderColor: Colors.primary,
    shadowOpacity: 0,
    elevation: 0,
  },

  // Floating bar
  // Cart footer button (inside FlatList footer)
  cartMiniList: {
    marginHorizontal: 5,
    marginTop: 8,
    maxHeight: 350,
    backgroundColor: Colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingVertical: 2,
  },
  cartMiniRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderBottomWidth: 1,
    borderBottomColor: Colors.divider,
  },
  cartMiniBarcode: {
    fontSize: 10,
    fontWeight: '700',
    color: Colors.primary,
  },
  cartMiniNameKh: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.text,
  },
  cartMiniNameEn: {
    fontSize: 11,
    color: Colors.textSecondary,
  },
  cartMiniRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginLeft: 8,
  },
  cartMiniPrice: {
    fontSize: 11,
    color: Colors.textSecondary,
  },
  cartMiniDiscountWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.background,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 4,
    height: 26,
  },
  cartMiniDiscountInput: {
    fontSize: 12,
    color: Colors.text,
    minWidth: 24,
    textAlign: 'center',
    padding: 0,
  },
  cartMiniDiscountPct: {
    fontSize: 11,
    color: Colors.textSecondary,
  },
  cartMiniStepper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.background,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 4,
    height: 26,
    gap: 4,
  },
  cartMiniStepperQty: {
    fontSize: 12,
    fontWeight: '800',
    color: Colors.primary,
    minWidth: 18,
    textAlign: 'center',
  },
  cartMiniQty: {
    fontSize: 12,
    fontWeight: '800',
    color: Colors.primary,
  },
  cartMiniAmount: {
    fontSize: 12,
    fontWeight: '800',
    color: Colors.text,
    minWidth: 48,
    textAlign: 'right',
  },
  cartFooterBtn: {
    marginHorizontal: 5,
    marginTop: 10,
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 13,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 6,
  },
  cartFooterIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: Colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cartFooterBadge: {
    position: 'absolute',
    top: -5,
    right: -5,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#EF4444',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
    borderWidth: 1.5,
    borderColor: Colors.primary,
  },
  cartFooterBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: Colors.white,
    lineHeight: 12,
  },
  cartFooterTotal: {
    fontSize: 15,
    fontWeight: '800',
    color: Colors.white,
  },
  cartFooterRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },

  // Modal
  modalSafe: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  clearOrderBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  clearOrderText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.white,
  },
  modalScroll: {
    flex: 1,
    padding: 16,
  },
  confirmBody: {
    padding: 12,
    gap: 10,
  },
  confirmInfoRow: {
    gap: 8,
  },
  refNumberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.surface,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: Colors.border,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  refNumberLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  refNumberLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.text,
  },
  refNumberRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  refNumberAutoText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  refNumberInput: {
    backgroundColor: Colors.surface,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: Colors.primary,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    fontWeight: '600',
    color: Colors.text,
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: Colors.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  dateIcon: { flexShrink: 0 },
  dateLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textSecondary,
    flex: 1,
  },
  dateTouchable: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dateValue: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.primary,
  },

  invDateRow: {
    flexDirection: 'row',
    gap: 10,
  },
  invDateLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textSecondary,
    marginBottom: 4,
  },
  invDateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 9,
    backgroundColor: Colors.surface,
  },
  invDateBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.primary,
    flex: 1,
  },

  backBtn: {
    padding: 4,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 8,
    marginTop: 16,
  },
  // Single order card
  orderCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
    marginBottom: 4,
  },
  orderCardCampus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.primaryMuted,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  orderCardCampusCode: {
    fontSize: 22,
    fontWeight: '900',
    color: Colors.primary,
    letterSpacing: 1,
  },
  orderCardCampusName: {
    flex: 1,
    fontSize: 13,
    color: Colors.textSecondary,
    fontWeight: '500',
  },
  orderCardDivider: {
    height: 1,
    backgroundColor: Colors.divider,
  },
  orderItemRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 10,
    position: 'relative',
  },
  orderItemImageBox: {
    width: 48,
    height: 48,
    borderRadius: 10,
    backgroundColor: '#F1F5F9',
    overflow: 'hidden',
    position: 'relative',
  },
  orderItemImage: {
    width: '100%',
    height: '100%',
  },
  orderItemImagePlaceholder: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F8FAFC',
  },
  orderItemIndexBadge: {
    position: 'absolute',
    top: 2,
    left: 2,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  orderItemIndexText: {
    fontSize: 10,
    fontWeight: '800',
    color: Colors.white,
  },
  orderItemNames: {
    flex: 1,
    gap: 2,
  },
  orderItemNameEn: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.text,
  },
  orderItemNameKh: {
    fontSize: 12,
    color: Colors.textSecondary,
  },
  orderItemSku: {
    fontSize: 10,
    color: Colors.textLight,
    fontWeight: '500',
    letterSpacing: 0.3,
    marginTop: 2,
  },
  orderItemCodeChip: {
    alignSelf: 'flex-start',
    backgroundColor: Colors.primaryMuted,
    borderRadius: 5,
    paddingHorizontal: 7,
    paddingVertical: 2,
    marginBottom: 3,
  },
  orderItemCodeText: {
    fontSize: 10,
    fontWeight: '700',
    color: Colors.primary,
    letterSpacing: 0.5,
  },
  orderItemRight: {
    alignItems: 'flex-end',
    gap: 2,
  },
  orderItemPrice: {
    fontSize: 15,
    fontWeight: '800',
    color: Colors.primary,
  },
  orderItemUnit: {
    fontSize: 11,
    color: Colors.textLight,
  },
  orderTotalsBox: {
    gap: 0,
  },
  orderTotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  orderTotalRowLabel: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontWeight: '500',
  },
  orderTotalRowValue: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.text,
  },
  // Per-item qty row
  itemQtyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: `${Colors.primary}08`,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  itemQtyLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.primary,
  },
  confirmQtyPill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: `${Colors.primary}40`,
    borderRadius: 8,
    backgroundColor: Colors.white,
    overflow: 'hidden',
  },
  confirmQtyBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: `${Colors.primary}10`,
  },
  confirmQtyInput: {
    width: 44,
    height: 32,
    textAlign: 'center',
    fontSize: 18,
    fontWeight: '800',
    color: Colors.primary,
    padding: 0,
  },
  confirmQtyPillDisabled: {
    borderColor: Colors.border,
    backgroundColor: Colors.background,
  },
  confirmQtyInputDisabled: {
    color: Colors.textLight,
  },

  // Per-item price row
  itemPriceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: `${Colors.primary}08`,
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 8,
  },
  itemPriceLabel: { fontSize: 12, fontWeight: '600', color: Colors.primary },
  itemPriceInputWrap: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1, borderColor: `${Colors.primary}40`, borderRadius: 8,
    backgroundColor: Colors.white, paddingHorizontal: 8, paddingVertical: 4,
  },
  itemPriceInput: {
    fontSize: 13, fontWeight: '800', color: Colors.primary,
    padding: 0, minWidth: 60, textAlign: 'right',
  },

  // Per-item discount row
  itemDiscountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F5F3FF',
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 8,
  },
  itemDiscountLeft:  { flexDirection: 'row', alignItems: 'center', gap: 5, flex: 1 },
  itemDiscountRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  itemDiscountLabel: { fontSize: 12, fontWeight: '600', color: '#7C3AED' },
  itemDiscountInputWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 2,
    borderWidth: 1, borderColor: '#C4B5FD', borderRadius: 8,
    backgroundColor: '#FFFFFF', paddingHorizontal: 8, paddingVertical: 4,
  },
  itemDiscountInput: {
    fontSize: 13, fontWeight: '800', color: '#7C3AED',
    padding: 0, minWidth: 30, textAlign: 'right',
  },
  itemDiscountPct: { fontSize: 12, fontWeight: '700', color: '#7C3AED' },
  itemDiscountInputWrapDisabled: {
    borderColor: Colors.border,
    backgroundColor: Colors.background,
  },
  itemDiscountInputDisabled: {
    color: Colors.textLight,
  },
  itemDiscountPctDisabled: {
    color: Colors.textLight,
  },
  itemDiscountSaving: {
    fontSize: 13, fontWeight: '700', color: '#7C3AED',
  },
  orderItemPriceOld: {
    fontSize: 12,
    color: Colors.textLight,
    textDecorationLine: 'line-through',
    textAlign: 'right',
  },
  discountLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  discountLabel: {
    fontSize: 13,
    color: '#7C3AED',
    fontWeight: '600',
  },
  discountValue: {
    fontSize: 14,
    fontWeight: '700',
    color: '#7C3AED',
  },
  orderItemsTotal: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  orderItemsTotalLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.text,
  },
  orderItemsTotalValue: {
    fontSize: 22,
    fontWeight: '900',
    color: Colors.primary,
  },

  // Confirm form
  confirmSummary: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 10,
  },
  confirmSummaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  confirmSummaryTotal: {
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingTop: 10,
    marginTop: 2,
  },
  // Signature card
  sigCard: {
    backgroundColor: Colors.white,
    borderTopWidth: 1,
    borderColor: Colors.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 4,
  },
  sigHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: `${Colors.primary}0D`,
    borderBottomWidth: 1,
    borderBottomColor: `${Colors.primary}22`,
  },
  sigHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sigHeaderTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.primary,
    letterSpacing: 0.2,
  },
  requiredMark: {
    color: Colors.error,
    fontWeight: '700',
  },
  sigRequiredBadge: {
    backgroundColor: '#FEE2E2',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  sigRequiredText: {
    fontSize: 10,
    fontWeight: '700',
    color: Colors.error,
  },
  sigHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sigUploadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: `${Colors.primary}40`,
    backgroundColor: Colors.white,
  },
  sigUploadBtnDone: {
    borderColor: '#10B981',
    backgroundColor: '#F0FDF4',
  },
  sigUploadText: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.primary,
  },
  sigUploadTextDone: {
    color: '#10B981',
  },
  sigClearBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: `${Colors.primary}40`,
    backgroundColor: Colors.white,
  },
  sigClearText: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.primary,
  },
  sigDrawArea: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  sigPad: {
    height: 200,
  },
  sigFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
    backgroundColor: '#F8FAFC',
  },
  sigFooterLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#CBD5E1',
  },
  sigFooterLabel: {
    fontSize: 11,
    color: '#94A3B8',
    fontWeight: '500',
    letterSpacing: 0.5,
  },
  confirmActions: {
    padding: 16,
    paddingBottom: 8,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    backgroundColor: Colors.surface,
    gap: 10,
  },
  invRateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  invRateLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  invRateInput: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    fontSize: 14,
    fontWeight: '700',
    color: Colors.text,
    minWidth: 80,
    textAlign: 'center',
    backgroundColor: Colors.background,
  },
  submitErrorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#FEF2F2',
    borderRadius: 10,
    padding: 10,
    gap: 8,
  },
  submitErrorText: {
    flex: 1,
    fontSize: 13,
    color: Colors.error,
    lineHeight: 18,
  },

  // Order type selector
  typeRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 4,
  },
  typeBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    gap: 3,
  },
  typeBtnActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primaryMuted,
  },
  typeBtnCode: {
    fontSize: 15,
    fontWeight: '900',
    color: Colors.textSecondary,
    letterSpacing: 0.5,
  },
  typeBtnCodeActive: {
    color: Colors.primary,
  },
  typeBtnLabel: {
    fontSize: 10,
    fontWeight: '500',
    color: Colors.textLight,
  },
  typeBtnLabelActive: {
    color: Colors.primary,
    fontWeight: '600',
  },

  // Doc type selector strip
  typeStrip: {
    flexDirection: 'row',
    backgroundColor: Colors.white,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.divider,
  },
  typeChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  typeChipActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primary,
  },
  typeChipQuoActive: {
    borderColor: '#10B981',
    backgroundColor: '#10B981',
  },
  typeChipDoActive: {
    borderColor: '#F59E0B',
    backgroundColor: '#F59E0B',
  },
  typeChipInvActive: {
    borderColor: '#7C3AED',
    backgroundColor: '#7C3AED',
  },
  typeChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  typeChipTextActive: {
    color: Colors.white,
  },

  // AppBar right cluster
  appBarRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  campusChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 5,
    gap: 3,
  },
  campusChipText: {
    color: Colors.white,
    fontSize: 12,
    fontWeight: '700',
  },

  // Campus picker modal
  campusBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  campusCard: {
    width: '100%',
    maxHeight: '80%',
    backgroundColor: Colors.surface,
    borderRadius: 24,
    padding: 24,
    shadowColor: Colors.black,
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.2,
    shadowRadius: 40,
    elevation: 20,
  },
  campusHeader: {
    alignItems: 'center',
    marginBottom: 24,
    gap: 6,
  },
  campusTitle: {
    marginTop: 4,
  },
  campusLoading: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 32,
  },
  campusScroll: {
    flexGrow: 0,
  },
  campusGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  campusItem: {
    width: '46%',
    borderWidth: 1.5,
    borderRadius: 14,
    padding: 14,
    alignItems: 'center',
    backgroundColor: Colors.surface,
    gap: 6,
  },
  campusIconBox: {
    width: 52,
    height: 52,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  campusCode: {
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 1,
  },

  // Location picker chips
  locationChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  locationChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  locationChipSelected: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primaryMuted,
  },
  locationChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  locationChipTextSelected: {
    color: Colors.primary,
  },

  // Import modal
  exportTemplateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  exportTemplateBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.white,
  },
  importHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 4,
    marginBottom: 4,
  },
  importHeaderCell: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  /* ── New import action buttons in AppBar ── */
  importActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  importActionBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.white,
  },
  /* ── Status banner ── */
  importStatusBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 7,
    backgroundColor: '#EFF6FF',
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  importStatusBannerReady: {
    backgroundColor: '#ECFDF5',
    borderBottomColor: '#D1FAE5',
  },
  importStatusText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.primary,
  },
  importAddRowBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'center',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: Colors.primary,
    borderStyle: 'dashed',
    marginTop: 8,
  },
  importAddRowText: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.primary,
  },
  importCard: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 10,
    gap: 6,
  },
  importRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  importDetailsRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    marginTop: 4,
  },
  importDetailCell: {
    flex: 1,
    gap: 3,
  },
  importDetailLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  importDetailValue: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.text,
  },
  importQtyStepper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
  },
  importQtyBtn: {
    width: 28,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.background,
  },
  importQtyInput: {
    flex: 1,
    height: 32,
    fontSize: 13,
    fontWeight: '700',
    color: Colors.text,
    padding: 0,
    minWidth: 28,
  },
  importTotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    marginBottom: 12,
  },
  importTotalLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.text,
  },
  importTotalValue: {
    fontSize: 17,
    fontWeight: '800',
    color: Colors.primary,
  },
  importInputWrap: {
    backgroundColor: Colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  importInputError: {
    borderColor: Colors.error,
    backgroundColor: Colors.errorLight,
  },
  importInput: {
    fontSize: 14,
    color: Colors.text,
    padding: 0,
  },
  importRemoveBtn: {
    padding: 4,
  },
  importMatchLabel: {
    fontSize: 11,
    color: Colors.success,
    fontWeight: '600',
    paddingLeft: 2,
  },
  importNoMatchLabel: {
    fontSize: 11,
    color: Colors.error,
    fontWeight: '600',
    paddingLeft: 2,
  },
  importFooter: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    backgroundColor: Colors.background,
  },
  importConfirmBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingVertical: 14,
    gap: 8,
  },
  importConfirmText: {
    fontSize: 15,
    fontWeight: '800',
    color: Colors.white,
  },

  pendingOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  pendingCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: Colors.surface,
    borderRadius: 24,
    paddingTop: 28,
    paddingBottom: 24,
    paddingHorizontal: 24,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.18,
    shadowRadius: 40,
    elevation: 20,
  },
  pendingTitle: {
    marginTop: 12,
    marginBottom: 6,
  },
  pendingMsg: {
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 4,
  },
  pendingDivider: {
    height: 1,
    backgroundColor: Colors.divider,
    width: '100%',
    marginTop: 20,
    marginBottom: 16,
  },
  pendingBtns: {
    flexDirection: 'row',
    gap: 10,
    width: '100%',
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

export default MenuScreen;
