import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  TouchableOpacity,
  TextInput,
  Modal,
  FlatList,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { MaterialIcons as Icon } from '@expo/vector-icons';
import AppText from '../../components/AppText';
import AppBar from '../../components/AppBar';
import AppButton from '../../components/AppButton';
import {
  getSalesOrderApi,
  updateSalesOrderItemsApi,
  getAllProductsApi,
  ApiSalesOrder,
  ApiSalesOrderItem,
  ApiProduct,
} from '../../services/focusApi';
import SaleOrderInvoiceScreen from './SaleOrderInvoiceScreen';

interface Props {
  orderId: string;
  onBack: () => void;
}

type EditItem = {
  id: string;
  productId?: string;
  isNew?: boolean;
  name: string;
  nameKh?: string;
  sku?: string;
  qty: string;
  price: string;
  discount: string;
};

const PRIMARY = '#2563EB';
const BG      = '#F5F5F0';
const CARD    = '#FFFFFF';
const TEXT    = '#1A1A1A';
const MUTED   = '#888888';

const STATUS_COLOR: Record<string, { bg: string; text: string; label: string }> = {
  draft:     { bg: '#FEF3C7', text: '#D97706', label: 'Draft' },
  confirmed: { bg: '#DBEAFE', text: '#2563EB', label: 'Confirmed' },
  received:  { bg: '#D1FAE5', text: '#059669', label: 'Received' },
  invoiced:  { bg: '#EDE9FE', text: '#7C3AED', label: 'Invoiced' },
  delivered: { bg: '#D1FAE5', text: '#10B981', label: 'Delivered' },
  cancelled: { bg: '#FEE2E2', text: '#EF4444', label: 'Cancelled' },
};

const formatDate = (iso: string) => {
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      weekday: 'short', day: '2-digit', month: 'short', year: 'numeric',
    });
  } catch { return iso; }
};

const formatTime = (iso: string) => {
  try {
    return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  } catch { return ''; }
};

const cents = (n: number) => `$${(n / 100).toFixed(2)}`;


const SaleOrderDetailScreen: React.FC<Props> = ({ orderId, onBack }) => {
  const [order, setOrder]             = useState<ApiSalesOrder | null>(null);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState<string | null>(null);
  const [showInvoice, setShowInvoice] = useState(false);

  // Edit mode
  const [editMode, setEditMode]       = useState(false);
  const [editItems, setEditItems]     = useState<EditItem[]>([]);
  const [saving, setSaving]           = useState(false);
  const [saveError, setSaveError]     = useState<string | null>(null);

  // Product picker
  const [products, setProducts]             = useState<ApiProduct[]>([]);
  const [productMap, setProductMap]         = useState<Record<string, ApiProduct>>({});
  const [productsLoaded, setProductsLoaded] = useState(false);
  const [pickerVisible, setPickerVisible]   = useState(false);
  const [pickerSearch, setPickerSearch]     = useState('');

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    getSalesOrderApi(orderId)
      .then(o => { setOrder(o); })
      .catch(err => setError(err?.message ?? 'Failed to load order'))
      .finally(() => setLoading(false));
  }, [orderId]);

  useEffect(() => { load(); }, [load]);

  const loadProducts = useCallback((): Promise<Record<string, ApiProduct>> => {
    if (productsLoaded) return Promise.resolve(productMap);
    return getAllProductsApi().then(data => {
      const map: Record<string, ApiProduct> = {};
      data.forEach(p => { map[String(p.id)] = p; });
      setProducts(data);
      setProductMap(map);
      setProductsLoaded(true);
      return map;
    }).catch(() => productMap);
  }, [productsLoaded, productMap]);

  const buildEditItems = (o: ApiSalesOrder, pMap: Record<string, ApiProduct>): EditItem[] =>
    o.items.map((item, idx) => {
      const prod = item.productId ? pMap[String(item.productId)] : undefined;
      const subtotalCents = item.unitPriceCents * item.qty;
      const discountCents = item.discountCents ?? 0;
      const pct = subtotalCents > 0 ? (discountCents / subtotalCents) * 100 : 0;
      return {
        id: item.id,
        productId: item.productId,
        name: item.productName ?? item.product?.nameEn ?? item.product?.name ?? prod?.nameEn ?? `Item ${idx + 1}`,
        nameKh: item.productNameKh ?? item.product?.nameKm ?? prod?.nameKm,
        sku: item.productCode ?? item.product?.sku ?? item.product?.code ?? prod?.sku,
        qty: String(item.qty),
        price: (item.unitPriceCents / 100).toFixed(2),
        discount: pct > 0 ? (Math.round(pct * 100) / 100).toString() : '',
      };
    });

  const enterEdit = async () => {
    if (!order) return;
    setSaveError(null);
    const pMap = await loadProducts();
    setEditItems(buildEditItems(order, pMap));
    setEditMode(true);
  };

  const cancelEdit = () => {
    if (!order) return;
    setEditItems(buildEditItems(order, productMap));
    setSaveError(null);
    setEditMode(false);
  };

  const updateItem = (idx: number, field: keyof EditItem, value: string) => {
    setEditItems(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      return next;
    });
  };

  const removeItem = (idx: number) => {
    setEditItems(prev => prev.filter((_, i) => i !== idx));
  };

  const addProduct = (product: ApiProduct) => {
    const price = product.fixedPriceCents != null
      ? (parseInt(product.fixedPriceCents, 10) / 100).toFixed(2)
      : '0.00';
    const newItem: EditItem = {
      id: `new-${product.id}-${Date.now()}`,
      productId: String(product.id),
      isNew: true,
      name: product.nameEn,
      nameKh: product.nameKm,
      sku: product.sku,
      qty: '1',
      price,
      discount: '',
    };
    setEditItems(prev => [...prev, newItem]);
    setPickerVisible(false);
    setPickerSearch('');
  };

  const saveEdit = async () => {
    if (!order) return;
    setSaving(true);
    setSaveError(null);
    try {
      const payload = editItems.map(it => {
        const qty = Math.max(1, parseInt(it.qty, 10) || 1);
        const unitPriceCents = Math.round((parseFloat(it.price) || 0) * 100);
        const pct = Math.min(100, Math.max(0, parseFloat(it.discount) || 0));
        const discountCents = Math.round(unitPriceCents * qty * pct / 100);
        // API deletes all old items and re-inserts — productId is always required
        return { productId: it.productId, qty, unitPriceCents, discountCents };
      });
      await updateSalesOrderItemsApi(orderId, payload);
      setEditMode(false);
      setLoading(true);
      const refreshed = await getSalesOrderApi(orderId);
      setOrder(refreshed);
      setLoading(false);
    } catch (err: any) {
      const status = err?.response?.status;
      const body = err?.response?.data;
      const bodyMsg = body?.error?.message ?? body?.error?.messageKey ?? body?.message;
      setSaveError(status ? `Error ${status}${bodyMsg ? ': ' + bodyMsg : ''}` : (err?.message ?? 'Failed to save'));
    } finally {
      setSaving(false);
    }
  };

  const filteredProducts = useMemo(() => {
    const q = pickerSearch.trim().toLowerCase();
    if (!q) return products;
    return products.filter(p =>
      p.nameEn?.toLowerCase().includes(q) ||
      p.nameKm?.toLowerCase().includes(q) ||
      p.sku?.toLowerCase().includes(q),
    );
  }, [products, pickerSearch]);

  const editTotal = useMemo(() => editItems.reduce((s, it) => {
    const qty = parseInt(it.qty, 10) || 0;
    const price = parseFloat(it.price) || 0;
    const disc = parseFloat(it.discount) || 0;
    return s + qty * price * (1 - disc / 100);
  }, 0), [editItems]);

  if (showInvoice) {
    return <SaleOrderInvoiceScreen orderId={orderId} onBack={() => setShowInvoice(false)} />;
  }

  if (loading) {
    return (
      <View style={styles.safe}>
        <AppBar title="Sale Order" showBack onBack={onBack} titleAlign="left" />
        <View style={styles.center}>
          <ActivityIndicator size="large" color={PRIMARY} />
        </View>
      </View>
    );
  }

  if (error || !order) {
    return (
      <View style={styles.safe}>
        <AppBar title="Sale Order" showBack onBack={onBack} titleAlign="left" />
        <View style={styles.center}>
          <Icon name="error-outline" size={48} color="#EF4444" />
          <AppText style={styles.errorText}>{error ?? 'Order not found'}</AppText>
          <TouchableOpacity style={styles.retryBtn} onPress={load}>
            <AppText style={styles.retryText}>Retry</AppText>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const statusKey = (order.status ?? '').toLowerCase();
  const s = STATUS_COLOR[statusKey] ?? { bg: '#F0F0F0', text: MUTED, label: order.status ?? '' };
  const canEdit = ['draft', 'sale_orders', 'confirmed'].includes(statusKey);

  const subtotalCents = order.items.reduce(
    (sum, item) => sum + item.qty * item.unitPriceCents - (item.discountCents ?? 0),
    0,
  );
  const grandTotal = order.totalCents != null ? order.totalCents : subtotalCents;

  return (
    <View style={styles.safe}>
      <AppBar
        title={editMode ? 'Edit Sale Order' : (order.referenceNumber ?? order.ref ?? order.id)}
        subtitle={editMode ? (order.referenceNumber ?? order.ref ?? '') : 'Sale Order'}
        showBack
        onBack={editMode ? cancelEdit : onBack}
        titleAlign="left"
        rightActions={canEdit && !editMode ? (
          <TouchableOpacity style={styles.editBtn} onPress={enterEdit}>
            <Icon name="edit" size={15} color={PRIMARY} />
            <AppText style={styles.editBtnText}>Edit</AppText>
          </TouchableOpacity>
        ) : undefined}
      />

      {!editMode && (
        <TouchableOpacity style={styles.invoiceBtn} onPress={() => setShowInvoice(true)}>
          <Icon name="receipt" size={16} color={PRIMARY} />
          <AppText style={styles.invoiceBtnText}>View Invoice</AppText>
          <Icon name="chevron-right" size={16} color={PRIMARY} />
        </TouchableOpacity>
      )}

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={[styles.scroll, editMode && { paddingBottom: 120 }]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >

          {/* Info Card */}
          {!editMode && (
            <View style={styles.card}>
              <View style={styles.infoRow}>
                <View style={styles.infoItem}>
                  <AppText style={styles.infoLabel}>Reference</AppText>
                  <AppText style={styles.infoValue}>{order.referenceNumber ?? order.ref ?? '—'}</AppText>
                </View>
                <View style={[styles.statusBadge, { backgroundColor: s.bg }]}>
                  <AppText style={[styles.statusText, { color: s.text }]}>{s.label}</AppText>
                </View>
              </View>
              <View style={styles.divider} />
              <View style={styles.infoRow}>
                <View style={styles.infoItem}>
                  <AppText style={styles.infoLabel}>Date</AppText>
                  <AppText style={styles.infoValue}>{formatDate(order.createdAt)}</AppText>
                </View>
                <View style={styles.infoItem}>
                  <AppText style={styles.infoLabel}>Time</AppText>
                  <AppText style={styles.infoValue}>{formatTime(order.createdAt)}</AppText>
                </View>
              </View>
            </View>
          )}

          {/* Items section header */}
          <View style={styles.sectionRow}>
            <AppText style={styles.sectionTitle}>Items{!editMode && order.items.length > 0 ? ` (${order.items.length})` : ''}</AppText>
            {editMode && (
              <TouchableOpacity
                style={styles.addItemBtn}
                onPress={() => { loadProducts(); setPickerSearch(''); setPickerVisible(true); }}
              >
                <Icon name="add" size={16} color={PRIMARY} />
                <AppText style={styles.addItemText}>Add Item</AppText>
              </TouchableOpacity>
            )}
          </View>

          {/* View mode items */}
          {!editMode && (
            <View style={styles.card}>
              {order.items.length === 0 ? (
                <AppText style={styles.noItems}>No items</AppText>
              ) : order.items.map((item, i) => {
                const lineCents = item.qty * item.unitPriceCents - (item.discountCents ?? 0);
                const isLast = i === order.items.length - 1;
                return (
                  <View key={item.id} style={[styles.itemRow, isLast && { borderBottomWidth: 0 }]}>
                    <View style={styles.itemLeft}>
                      <View style={styles.itemIndexBox}>
                        <AppText style={styles.itemIndex}>{i + 1}</AppText>
                      </View>
                      <View style={styles.itemInfo}>
                        <AppText style={styles.itemName} numberOfLines={1}>
                          {item.productName ?? item.productCode ?? `Product #${item.productId}`}
                        </AppText>
                        <AppText style={styles.itemSub}>
                          {item.qty} × {cents(item.unitPriceCents)}
                          {item.discountCents ? `  −${cents(item.discountCents)} disc.` : ''}
                        </AppText>
                      </View>
                    </View>
                    <AppText style={styles.itemTotal}>{cents(lineCents)}</AppText>
                  </View>
                );
              })}
            </View>
          )}

          {/* Edit mode item cards */}
          {editMode && editItems.map((item, idx) => {
            const qty = parseFloat(item.qty) || 0;
            const price = parseFloat(item.price) || 0;
            const disc = parseFloat(item.discount) || 0;
            const lineTotal = qty * price * (1 - disc / 100);
            return (
              <View key={item.id} style={styles.editItemCard}>
                {/* Header: index + name + delete */}
                <View style={styles.editItemHeader}>
                  <View style={styles.itemIndexBox}>
                    <AppText style={styles.itemIndex}>{idx + 1}</AppText>
                  </View>
                  <View style={{ flex: 1 }}>
                    {/* Column headers */}
                    <View style={styles.pickerItemCols}>
                      <AppText style={styles.pickerColSkuHeader}>SKU</AppText>
                      <AppText style={[styles.pickerColHeader, { flex: 1 }]}>Name KH</AppText>
                      <AppText style={[styles.pickerColHeader, { flex: 1 }]}>Name EN</AppText>
                    </View>
                    {/* Column values */}
                    <View style={styles.pickerItemCols}>
                      <AppText style={styles.pickerColSku} numberOfLines={1}>{item.sku ?? '—'}</AppText>
                      <AppText style={[styles.pickerColVal, { flex: 1 }]} numberOfLines={1}>{item.nameKh ?? '—'}</AppText>
                      <AppText style={[styles.pickerColVal, { flex: 1 }]} numberOfLines={1}>{item.name}</AppText>
                    </View>
                  </View>
                  <TouchableOpacity
                    onPress={() => removeItem(idx)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    style={styles.deleteBtn}
                  >
                    <Icon name="remove-circle-outline" size={22} color="#EF4444" />
                  </TouchableOpacity>
                </View>

                {/* Qty + Price + Discount */}
                <View style={styles.editItemFields}>
                  <View style={styles.editFieldCol}>
                    <AppText style={styles.fieldLabel}>Qty</AppText>
                    <View style={styles.qtyRow}>
                      <TouchableOpacity
                        style={styles.qtyBtn}
                        onPress={() => {
                          const cur = parseInt(item.qty, 10) || 1;
                          updateItem(idx, 'qty', String(Math.max(1, cur - 1)));
                        }}
                        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                      >
                        <Icon name="remove" size={14} color={PRIMARY} />
                      </TouchableOpacity>
                      <TextInput
                        style={styles.qtyInput}
                        value={item.qty}
                        onChangeText={v => updateItem(idx, 'qty', v.replace(/[^0-9]/g, '') || '1')}
                        keyboardType="number-pad"
                        selectTextOnFocus
                        maxLength={5}
                      />
                      <TouchableOpacity
                        style={styles.qtyBtn}
                        onPress={() => {
                          const cur = parseInt(item.qty, 10) || 0;
                          updateItem(idx, 'qty', String(cur + 1));
                        }}
                        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                      >
                        <Icon name="add" size={14} color={PRIMARY} />
                      </TouchableOpacity>
                    </View>
                  </View>

                  <View style={[styles.editFieldCol, { flex: 2 }]}>
                    <AppText style={styles.fieldLabel}>Unit Price ($)</AppText>
                    <TextInput
                      style={styles.numInput}
                      value={item.price}
                      onChangeText={v => updateItem(idx, 'price', v.replace(/[^0-9.]/g, ''))}
                      keyboardType="decimal-pad"
                      selectTextOnFocus
                    />
                  </View>

                  <View style={styles.editFieldCol}>
                    <AppText style={styles.fieldLabel}>Disc %</AppText>
                    <View style={styles.discWrap}>
                      <TextInput
                        style={styles.discInput}
                        value={item.discount}
                        onChangeText={v => {
                          const clean = v.replace(/[^0-9.]/g, '');
                          if (parseFloat(clean) > 100) return;
                          updateItem(idx, 'discount', clean);
                        }}
                        keyboardType="decimal-pad"
                        placeholder="0"
                        placeholderTextColor={MUTED}
                        maxLength={5}
                        selectTextOnFocus
                      />
                      <AppText style={styles.discPct}>%</AppText>
                    </View>
                  </View>
                </View>

                {/* Line total */}
                <View style={styles.lineTotalRow}>
                  <AppText style={styles.lineTotalLabel}>Line Total</AppText>
                  <AppText style={styles.lineTotalVal}>${lineTotal.toFixed(2)}</AppText>
                </View>
              </View>
            );
          })}

          {/* Edit mode total + save bar */}
          {editMode && (
            <View style={styles.editFooter}>
              <View style={styles.editTotalRow}>
                <AppText style={styles.editTotalLabel}>Total</AppText>
                <AppText style={styles.editTotalVal}>${editTotal.toFixed(2)}</AppText>
              </View>
              {saveError ? (
                <AppText style={styles.saveError}>{saveError}</AppText>
              ) : null}
              <View style={styles.editActionRow}>
                <AppButton
                  label="Cancel"
                  onPress={cancelEdit}
                  variant="outline"
                  size="lg"
                  style={{ flex: 1 }}
                  disabled={saving}
                />
                <AppButton
                  label="Save Changes"
                  onPress={saveEdit}
                  variant="primary"
                  size="lg"
                  style={{ flex: 2 }}
                  loading={saving}
                  disabled={saving || editItems.length === 0}
                />
              </View>
            </View>
          )}

          {/* Total (view mode) */}
          {!editMode && (
            <View style={styles.totalCard}>
              <AppText style={styles.totalLabel}>Grand Total</AppText>
              <AppText style={styles.totalValue}>{cents(grandTotal)}</AppText>
            </View>
          )}

        </ScrollView>
      </KeyboardAvoidingView>

      {/* Product picker modal */}
      <Modal
        visible={pickerVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setPickerVisible(false)}
      >
        <View style={styles.pickerModal}>
          <View style={styles.pickerHeader}>
            <AppText style={styles.pickerTitle}>Add Product</AppText>
            <TouchableOpacity onPress={() => setPickerVisible(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Icon name="close" size={22} color={MUTED} />
            </TouchableOpacity>
          </View>
          <View style={styles.pickerSearchWrap}>
            <Icon name="search" size={18} color={MUTED} />
            <TextInput
              style={styles.pickerSearch}
              value={pickerSearch}
              onChangeText={setPickerSearch}
              placeholder="Search by name or SKU…"
              placeholderTextColor={MUTED}
              autoFocus
              clearButtonMode="while-editing"
            />
          </View>
          {!productsLoaded ? (
            <View style={styles.center}>
              <ActivityIndicator size="large" color={PRIMARY} />
            </View>
          ) : (
            <FlatList
              data={filteredProducts}
              keyExtractor={p => String(p.id)}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingBottom: 24 }}
              renderItem={({ item: p }) => (
                <TouchableOpacity style={styles.pickerItem} onPress={() => addProduct(p)} activeOpacity={0.7}>
                  <View style={{ flex: 1 }}>
                    {/* Column headers */}
                    <View style={styles.pickerItemCols}>
                      <AppText style={styles.pickerColSkuHeader}>SKU</AppText>
                      <AppText style={[styles.pickerColHeader, { flex: 1 }]}>Name KH</AppText>
                      <AppText style={[styles.pickerColHeader, { flex: 1 }]}>Name EN</AppText>
                    </View>
                    {/* Column values */}
                    <View style={styles.pickerItemCols}>
                      <AppText style={styles.pickerColSku} numberOfLines={1}>{p.sku ?? '—'}</AppText>
                      <AppText style={[styles.pickerColVal, { flex: 1 }]} numberOfLines={1}>{p.nameKm ?? '—'}</AppText>
                      <AppText style={[styles.pickerColVal, { flex: 1 }]} numberOfLines={1}>{p.nameEn ?? '—'}</AppText>
                    </View>
                  </View>
                  {p.fixedPriceCents != null && (
                    <AppText style={styles.pickerItemPrice}>
                      ${(parseInt(p.fixedPriceCents, 10) / 100).toFixed(2)}
                    </AppText>
                  )}
                </TouchableOpacity>
              )}
              ListEmptyComponent={
                <View style={styles.center}>
                  <AppText style={styles.noItems}>No products found</AppText>
                </View>
              }
            />
          )}
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BG },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 32 },
  errorText: { fontSize: 14, color: '#EF4444', textAlign: 'center' },
  retryBtn: {
    backgroundColor: PRIMARY, borderRadius: 10,
    paddingHorizontal: 24, paddingVertical: 10,
  },
  retryText: { color: '#FFFFFF', fontWeight: '700' },

  scroll: { padding: 16, gap: 12, paddingBottom: 40 },

  card: {
    backgroundColor: CARD,
    borderRadius: 16,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },

  infoRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  infoItem: { gap: 3 },
  infoLabel: { fontSize: 11, color: MUTED, fontWeight: '500' },
  infoValue: { fontSize: 14, fontWeight: '600', color: TEXT },

  statusBadge: { borderRadius: 8, paddingHorizontal: 12, paddingVertical: 5 },
  statusText: { fontSize: 12, fontWeight: '700' },

  divider: { height: 1, backgroundColor: '#F0F0EC', marginVertical: 12 },

  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  sectionTitle: {
    fontSize: 13, fontWeight: '700', color: MUTED,
    textTransform: 'uppercase', letterSpacing: 0.8,
  },
  addItemBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  addItemText: { fontSize: 13, fontWeight: '700', color: PRIMARY },

  noItems: { fontSize: 14, color: MUTED, textAlign: 'center', paddingVertical: 12 },

  itemRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: '#F0F0EC', gap: 12,
  },
  itemLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  itemIndexBox: {
    width: 28, height: 28, borderRadius: 8,
    backgroundColor: '#EFF6FF', alignItems: 'center', justifyContent: 'center',
  },
  itemIndex: { fontSize: 12, fontWeight: '700', color: PRIMARY },
  itemInfo: { flex: 1, gap: 2 },
  itemName: { fontSize: 13, fontWeight: '600', color: TEXT },
  itemSub: { fontSize: 12, color: MUTED },
  itemTotal: { fontSize: 14, fontWeight: '700', color: PRIMARY },

  // Edit item card
  editItemCard: {
    backgroundColor: CARD, borderRadius: 16, padding: 14,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 6, elevation: 2,
    gap: 10,
  },
  editItemHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  editItemName: { fontSize: 13, fontWeight: '600', color: TEXT },
  editItemSku: { fontSize: 11, color: MUTED },
  deleteBtn: { padding: 2 },

  editItemFields: { flexDirection: 'row', gap: 10, alignItems: 'flex-end' },
  editFieldCol: { gap: 4 },
  fieldLabel: { fontSize: 11, fontWeight: '600', color: MUTED },

  qtyRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  qtyBtn: {
    width: 28, height: 32, borderRadius: 8,
    backgroundColor: '#EFF6FF', alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: '#BFDBFE',
  },
  qtyInput: {
    width: 42, height: 32, textAlign: 'center',
    fontSize: 14, fontWeight: '700', color: PRIMARY,
    borderWidth: 1, borderColor: '#BFDBFE',
    borderRadius: 8, backgroundColor: '#FFFFFF', padding: 0,
  },
  numInput: {
    height: 32, paddingHorizontal: 10,
    fontSize: 14, fontWeight: '600', color: TEXT,
    borderWidth: 1, borderColor: '#E2E8F0',
    borderRadius: 8, backgroundColor: '#FFFFFF',
  },
  discWrap: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  discInput: {
    width: 46, height: 32, textAlign: 'center',
    fontSize: 13, fontWeight: '600', color: '#7C3AED',
    borderWidth: 1, borderColor: '#E2E8F0',
    borderRadius: 8, backgroundColor: '#FFFFFF', padding: 0,
  },
  discPct: { fontSize: 12, color: MUTED, fontWeight: '600' },

  lineTotalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  lineTotalLabel: { fontSize: 12, color: MUTED },
  lineTotalVal: { fontSize: 14, fontWeight: '700', color: PRIMARY },

  editFooter: { gap: 12, marginTop: 4 },
  editTotalRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: PRIMARY, borderRadius: 14, paddingHorizontal: 18, paddingVertical: 14,
  },
  editTotalLabel: { fontSize: 14, fontWeight: '600', color: 'rgba(255,255,255,0.8)' },
  editTotalVal: { fontSize: 20, fontWeight: '800', color: '#FFFFFF' },
  editActionRow: { flexDirection: 'row', gap: 10 },
  saveError: { fontSize: 13, color: '#EF4444', textAlign: 'center' },

  invoiceBtn: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#EFF6FF', marginHorizontal: 16, marginTop: 10, marginBottom: 2,
    borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12,
    gap: 8, borderWidth: 1, borderColor: '#BFDBFE',
  },
  invoiceBtnText: { flex: 1, fontSize: 14, fontWeight: '600', color: PRIMARY },

  totalCard: {
    backgroundColor: PRIMARY, borderRadius: 16, padding: 18,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  totalLabel: { fontSize: 14, fontWeight: '600', color: 'rgba(255,255,255,0.8)' },
  totalValue: { fontSize: 22, fontWeight: '800', color: '#FFFFFF' },

  editBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: '#EFF6FF', borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 6,
    borderWidth: 1, borderColor: '#BFDBFE',
  },
  editBtnText: { fontSize: 13, fontWeight: '600', color: PRIMARY },

  // Product picker modal
  pickerModal: { flex: 1, backgroundColor: BG },
  pickerHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 20, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: '#E2E8F0',
    backgroundColor: CARD,
  },
  pickerTitle: { fontSize: 17, fontWeight: '700', color: TEXT },
  pickerSearchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: CARD, margin: 12, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 10,
    borderWidth: 1, borderColor: '#E2E8F0',
  },
  pickerSearch: { flex: 1, fontSize: 15, color: TEXT, padding: 0 },
  pickerItem: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: CARD, marginHorizontal: 12, marginBottom: 8,
    borderRadius: 12, padding: 14, gap: 12,
    borderWidth: 1, borderColor: '#F0F0EC',
  },
  pickerItemCols: { flexDirection: 'row', gap: 6 },
  pickerColHeader: { fontSize: 10, fontWeight: '700', color: MUTED, marginBottom: 2 },
  pickerColSku: { width: 150, fontSize: 12, fontWeight: '600', color: PRIMARY },
  pickerColSkuHeader: { width: 150, fontSize: 10, fontWeight: '700', color: MUTED, marginBottom: 2 },
  pickerColVal: { fontSize: 12, color: TEXT },
  pickerItemPrice: { fontSize: 15, fontWeight: '700', color: PRIMARY, marginLeft: 8 },
});

export default SaleOrderDetailScreen;
