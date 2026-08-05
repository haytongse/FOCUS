import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  ScrollView,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { MaterialIcons as Icon } from '@expo/vector-icons';
import Colors from '../../theme/colors';
import AppText from '../../components/AppText';
import AppBar from '../../components/AppBar';
import AppInput from '../../components/AppInput';
import AppButton from '../../components/AppButton';
import { useAlert } from '../../components/AppAlert';
import {
  getSalesOrdersApi,
  getSalesOrderApi,
  getAllProductsApi,
  createDeliveryOrderApi,
  ApiSalesOrder,
  ApiSalesOrderItem,
  ApiProduct,
} from '../../services/focusApi';

interface Props {
  onBack: () => void;
  onSaved: () => void;
}

const SO_STATUSES = ['confirmed', 'delivering', 'received'];

const STATUS_COLOR: Record<string, { bg: string; text: string; label: string }> = {
  confirmed:  { bg: '#DBEAFE', text: '#2563EB', label: 'Confirmed' },
  delivering: { bg: '#ECFDF5', text: '#059669', label: 'Delivering' },
  received:   { bg: '#D1FAE5', text: '#10B981', label: 'Received' },
};

const DeliveryOrderFormScreen: React.FC<Props> = ({ onBack, onSaved }) => {
  const { showAlert } = useAlert();

  // Step 1 — pick a SO via checkbox
  const [step, setStep] = useState<'pickSO' | 'fillForm'>('pickSO');
  const [soList, setSoList] = useState<ApiSalesOrder[]>([]);
  const [soLoading, setSoLoading] = useState(true);
  const [soSearch, setSoSearch] = useState('');
  const [checkedSoId, setCheckedSoId] = useState<string | null>(null);
  const [selectedSO, setSelectedSO] = useState<ApiSalesOrder | null>(null);

  // Step 2 — form
  const [soDetail, setSoDetail] = useState<ApiSalesOrder | null>(null);
  const [productMap, setProductMap] = useState<Record<string, ApiProduct>>({});
  const [detailLoading, setDetailLoading] = useState(false);
  const [qtyMap, setQtyMap] = useState<Record<string, string>>({});
  const [receivedBy, setReceivedBy] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Load confirmed/delivering SOs
  useEffect(() => {
    setSoLoading(true);
    getSalesOrdersApi()
      .then(all => {
        const filtered = all.filter(o =>
          SO_STATUSES.includes((o.status ?? '').toLowerCase()),
        );
        setSoList(filtered.sort((a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        ));
      })
      .catch(() => {})
      .finally(() => setSoLoading(false));
  }, []);

  // Load SO detail when user taps "Generate"
  useEffect(() => {
    if (!selectedSO) return;
    setDetailLoading(true);
    Promise.all([getSalesOrderApi(selectedSO.id), getAllProductsApi().catch(() => [])])
      .then(([detail, products]) => {
        const pm: Record<string, ApiProduct> = {};
        products.forEach((p: ApiProduct) => { pm[p.id] = p; });
        setProductMap(pm);
        setSoDetail(detail);
        const qm: Record<string, string> = {};
        (detail.items ?? []).forEach(item => {
          const remaining = Math.max(0, item.qty - (item.qtyDelivered ?? 0));
          qm[item.id] = remaining > 0 ? String(remaining) : '0';
        });
        setQtyMap(qm);
        setStep('fillForm');
      })
      .catch(err => {
        showAlert({ type: 'error', title: 'Error', message: err?.message ?? 'Failed to load order detail' });
        setSelectedSO(null);
      })
      .finally(() => setDetailLoading(false));
  }, [selectedSO?.id]);

  const filteredSO = useMemo(() => {
    if (!soSearch.trim()) return soList;
    const q = soSearch.toLowerCase();
    return soList.filter(o =>
      (o.ref ?? '').toLowerCase().includes(q) ||
      (o.referenceNumber ?? '').toLowerCase().includes(q) ||
      (o.orderNumber ?? '').toLowerCase().includes(q) ||
      String(o.campusId ?? '').toLowerCase().includes(q) ||
      (o.campusCode ?? '').toLowerCase().includes(q) ||
      (o.campus?.campusCode ?? '').toLowerCase().includes(q),
    );
  }, [soList, soSearch]);

  const deliverableItems = useMemo((): ApiSalesOrderItem[] =>
    (soDetail?.items ?? []).filter(item =>
      Math.max(0, item.qty - (item.qtyDelivered ?? 0)) > 0,
    ),
  [soDetail]);

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    if (!receivedBy.trim()) e.receivedBy = 'Received by is required';
    let anyQty = false;
    deliverableItems.forEach(item => {
      const remaining = Math.max(0, item.qty - (item.qtyDelivered ?? 0));
      const v = parseInt(qtyMap[item.id] ?? '0', 10);
      if (isNaN(v) || v < 0) {
        e[`qty_${item.id}`] = 'Invalid qty';
      } else if (v > remaining) {
        e[`qty_${item.id}`] = `Max ${remaining}`;
      } else if (v > 0) {
        anyQty = true;
      }
    });
    if (!anyQty) e._items = 'Enter at least 1 item qty to deliver';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async () => {
    if (!soDetail) return;
    if (!validate()) return;
    setSubmitting(true);
    try {
      const items = deliverableItems
        .map(item => ({ soItemId: item.id, qtyDelivered: parseInt(qtyMap[item.id] ?? '0', 10) }))
        .filter(i => i.qtyDelivered > 0);

      const campusIdNum = soDetail.campusId != null ? Number(soDetail.campusId) : undefined;
      const locationIdNum = soDetail.locationId != null ? Number(soDetail.locationId) : undefined;
      await createDeliveryOrderApi(soDetail.id, {
        items,
        ...(campusIdNum != null && !isNaN(campusIdNum) ? { campusId: campusIdNum } : {}),
        ...(locationIdNum != null && !isNaN(locationIdNum) ? { locationId: locationIdNum } : {}),
        receivedBy: receivedBy.trim(),
        note: note.trim() || undefined,
        deliveredAt: new Date().toISOString(),
      });
      showAlert({ type: 'success', title: 'Delivery Order Created', message: 'DO created successfully.', autoClose: 2500 });
      onSaved();
    } catch (err: any) {
      const msg = err?.response?.data?.error?.messageKey ?? err?.response?.data?.message ?? err?.message ?? 'Failed to create delivery order';
      showAlert({ type: 'error', title: 'Error', message: msg });
    } finally {
      setSubmitting(false);
    }
  };

  const handleGenerate = () => {
    const so = soList.find(o => o.id === checkedSoId);
    if (!so) return;
    setSelectedSO(so);
  };

  // ── Step 1: Pick a Sale Order via checkbox ────────────────────────────────────
  if (step === 'pickSO') {
    return (
      <View style={styles.safe}>
        <AppBar
          title="Create Delivery Order"
          subtitle={checkedSoId ? '1 order selected' : 'Select a Sale Order'}
          titleAlign="left"
          showBack
          onBack={onBack}
        />

        <View style={styles.searchRow}>
          <Icon name="search" size={20} color={Colors.textSecondary} style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search by ref or campus..."
            placeholderTextColor={Colors.textLight}
            value={soSearch}
            onChangeText={setSoSearch}
            clearButtonMode="while-editing"
          />
        </View>

        {soLoading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={Colors.primary} />
          </View>
        ) : (
          <>
            <FlatList
              data={filteredSO}
              keyExtractor={item => item.id}
              contentContainerStyle={[styles.list, checkedSoId ? { paddingBottom: 100 } : {}]}
              showsVerticalScrollIndicator={false}
              ListEmptyComponent={
                <View style={styles.center}>
                  <Icon name="inbox" size={48} color={Colors.textLight} />
                  <AppText variant="body" color="textSecondary" style={styles.emptyMsg}>
                    {soSearch ? `No orders match "${soSearch}"` : 'No confirmed sale orders found'}
                  </AppText>
                </View>
              }
              renderItem={({ item }) => {
                const ref = item.referenceNumber ?? item.ref ?? item.orderNumber ?? item.id;
                const statusK = (item.status ?? '').toLowerCase();
                const s = STATUS_COLOR[statusK] ?? { bg: '#F0F0F0', text: '#888', label: item.status ?? '' };
                const campus = item.campusCode ?? item.campus?.campusCode ?? String(item.campusId ?? '—');
                const isChecked = checkedSoId === item.id;
                return (
                  <TouchableOpacity
                    style={[styles.soCard, isChecked && styles.soCardChecked]}
                    activeOpacity={0.75}
                    onPress={() => setCheckedSoId(isChecked ? null : item.id)}
                  >
                    {/* Checkbox */}
                    <View style={[styles.checkbox, isChecked && styles.checkboxChecked]}>
                      {isChecked
                        ? <Icon name="check" size={14} color="#fff" />
                        : null}
                    </View>

                    {/* Info */}
                    <View style={styles.soCardLeft}>
                      <AppText style={[styles.soRef, isChecked && styles.soRefChecked]}>{ref}</AppText>
                      <View style={styles.soMeta}>
                        <Icon name="location-city" size={13} color={Colors.textSecondary} />
                        <AppText variant="caption" color="textSecondary">{campus}</AppText>
                        <AppText variant="caption" color="textSecondary">·</AppText>
                        <AppText variant="caption" color="textSecondary">
                          {item.items?.length ?? 0} item{(item.items?.length ?? 0) !== 1 ? 's' : ''}
                        </AppText>
                      </View>
                    </View>

                    {/* Status badge */}
                    <View style={[styles.statusBadge, { backgroundColor: s.bg }]}>
                      <AppText style={[styles.statusText, { color: s.text }]}>{s.label}</AppText>
                    </View>
                  </TouchableOpacity>
                );
              }}
            />

            {/* Sticky generate button */}
            {checkedSoId ? (
              <View style={styles.generateBar}>
                <TouchableOpacity
                  style={[styles.generateBtn, detailLoading && styles.generateBtnDisabled]}
                  onPress={handleGenerate}
                  disabled={detailLoading}
                  activeOpacity={0.85}
                >
                  {detailLoading
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <Icon name="local-shipping" size={20} color="#fff" />}
                  <AppText style={styles.generateBtnText}>
                    {detailLoading ? 'Loading…' : 'Generate Delivery Order'}
                  </AppText>
                </TouchableOpacity>
              </View>
            ) : null}
          </>
        )}
      </View>
    );
  }

  // ── Step 2: Fill form ─────────────────────────────────────────────────────────
  const soRef = soDetail
    ? (soDetail.referenceNumber ?? soDetail.ref ?? soDetail.orderNumber ?? soDetail.id)
    : '';

  return (
    <KeyboardAvoidingView style={styles.safe} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <AppBar
        title="New Delivery Order"
        subtitle={soRef ? `SO: ${soRef}` : 'Fill in details'}
        titleAlign="left"
        showBack
        onBack={() => { setStep('pickSO'); setSoDetail(null); setSelectedSO(null); setErrors({}); }}
      />

      <ScrollView contentContainerStyle={styles.formScroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

        {/* SO summary */}
        <View style={styles.soSummary}>
          <Icon name="receipt-long" size={16} color={Colors.primary} />
          <AppText style={styles.soSummaryRef}>{soRef}</AppText>
          {soDetail?.campusCode || soDetail?.campus?.campusCode ? (
            <View style={styles.campusChip}>
              <AppText style={styles.campusChipText}>
                {soDetail.campusCode ?? soDetail.campus?.campusCode}
              </AppText>
            </View>
          ) : null}
        </View>

        {/* Items table */}
        <View style={styles.section}>
          <AppText style={styles.sectionTitle}>Items to Deliver</AppText>
          {errors._items ? (
            <AppText style={styles.errorText}>{errors._items}</AppText>
          ) : null}

          {/* Header */}
          <View style={styles.tableHeader}>
            <AppText style={[styles.thCell, styles.colSku]}>SKU</AppText>
            <AppText style={[styles.thCell, styles.colName]}>Description</AppText>
            <AppText style={[styles.thCell, styles.colQty]}>SO</AppText>
            <AppText style={[styles.thCell, styles.colQty]}>Done</AppText>
            <AppText style={[styles.thCell, styles.colQty]}>Left</AppText>
            <AppText style={[styles.thCell, styles.colInput]}>Deliver</AppText>
          </View>

          {deliverableItems.map(item => {
            const product = productMap[item.productId];
            const sku = product?.sku ?? item.productCode ?? '—';
            const name = item.productName ?? item.productNameKh ?? product?.nameEn ?? item.productId;
            const size = product?.size ?? '';
            const remaining = Math.max(0, item.qty - (item.qtyDelivered ?? 0));
            const hasError = !!errors[`qty_${item.id}`];
            return (
              <View key={item.id} style={[styles.tableRow, hasError && styles.tableRowError]}>
                <View style={styles.colSku}>
                  <AppText style={styles.skuText}>{sku}</AppText>
                  {size ? <AppText style={styles.sizeText}>{size}</AppText> : null}
                </View>
                <AppText style={[styles.tdCell, styles.colName]} numberOfLines={2}>{name}</AppText>
                <AppText style={[styles.tdCell, styles.colQty]}>{item.qty}</AppText>
                <AppText style={[styles.tdCell, styles.colQty, { color: Colors.textSecondary }]}>{item.qtyDelivered ?? 0}</AppText>
                <AppText style={[styles.tdCell, styles.colQty, { color: '#059669', fontWeight: '700' }]}>{remaining}</AppText>
                <View style={[styles.colInput, hasError && styles.inputError]}>
                  <TextInput
                    style={styles.qtyInput}
                    value={qtyMap[item.id] ?? ''}
                    onChangeText={v => {
                      setQtyMap(prev => ({ ...prev, [item.id]: v }));
                      if (errors[`qty_${item.id}`] || errors._items) {
                        setErrors(prev => {
                          const next = { ...prev };
                          delete next[`qty_${item.id}`];
                          delete next._items;
                          return next;
                        });
                      }
                    }}
                    keyboardType="numeric"
                    maxLength={5}
                    selectTextOnFocus
                  />
                  {hasError ? (
                    <AppText style={styles.qtyError}>{errors[`qty_${item.id}`]}</AppText>
                  ) : null}
                </View>
              </View>
            );
          })}

          {deliverableItems.length === 0 && (
            <View style={styles.emptyItems}>
              <Icon name="check-circle" size={32} color={Colors.textLight} />
              <AppText variant="caption" color="textSecondary" style={{ textAlign: 'center' }}>
                All items on this order have already been fully delivered.
              </AppText>
            </View>
          )}
        </View>

        {/* Received By */}
        <View style={styles.section}>
          <AppInput
            label="Received By *"
            value={receivedBy}
            onChangeText={v => { setReceivedBy(v); if (errors.receivedBy) setErrors(p => ({ ...p, receivedBy: '' })); }}
            placeholder="Enter receiver name"
            error={errors.receivedBy}
          />
        </View>

        {/* Note */}
        <View style={styles.section}>
          <AppInput
            label="Note"
            value={note}
            onChangeText={setNote}
            placeholder="Optional note..."
            multiline
            numberOfLines={3}
          />
        </View>

        <View style={styles.submitRow}>
          <AppButton
            label={submitting ? 'Creating...' : 'Create Delivery Order'}
            onPress={handleSubmit}
            disabled={submitting || deliverableItems.length === 0}
            loading={submitting}
          />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },

  searchRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.surface,
    marginHorizontal: 16, marginTop: 12, marginBottom: 8,
    borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8,
    borderWidth: 1, borderColor: Colors.border,
  },
  searchIcon: { marginRight: 8 },
  searchInput: { flex: 1, fontSize: 12, color: Colors.text, paddingVertical: 0 },

  list: { padding: 12, gap: 8, paddingBottom: 40 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  emptyMsg: { textAlign: 'center' },

  soCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 12, padding: 14,
    borderWidth: 1.5, borderColor: Colors.border,
    gap: 10,
  },
  soCardChecked: {
    borderColor: Colors.primary,
    backgroundColor: '#EFF6FF',
  },

  checkbox: {
    width: 22, height: 22, borderRadius: 6,
    borderWidth: 2, borderColor: Colors.border,
    backgroundColor: Colors.background,
    alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
  },
  checkboxChecked: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primary,
  },

  soCardLeft: { flex: 1, gap: 4 },
  soRef: { fontSize: 12, fontWeight: '700', color: Colors.text },
  soRefChecked: { color: Colors.primary },
  soMeta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  statusBadge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  statusText: { fontSize: 12, fontWeight: '700' },

  generateBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    paddingHorizontal: 16, paddingVertical: 12,
    paddingBottom: 24,
    backgroundColor: Colors.surface,
    borderTopWidth: 1, borderTopColor: Colors.border,
  },
  generateBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, backgroundColor: Colors.primary,
    borderRadius: 12, paddingVertical: 14,
  },
  generateBtnDisabled: { opacity: 0.6 },
  generateBtnText: { fontSize: 12, fontWeight: '700', color: '#fff' },

  soSummary: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginHorizontal: 16, marginTop: 12, marginBottom: 4,
    backgroundColor: Colors.surface,
    borderRadius: 10, padding: 12,
    borderWidth: 1, borderColor: Colors.border,
  },
  soSummaryRef: { fontSize: 12, fontWeight: '700', color: Colors.text, flex: 1 },
  campusChip: { backgroundColor: Colors.primaryMuted, borderRadius: 5, paddingHorizontal: 7, paddingVertical: 2 },
  campusChipText: { fontSize: 12, color: Colors.primary, fontWeight: '700' },

  formScroll: { paddingBottom: 48 },
  section: { marginHorizontal: 16, marginTop: 12 },
  sectionTitle: { fontSize: 12, fontWeight: '700', color: Colors.textSecondary, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  errorText: { fontSize: 12, color: '#EF4444', marginBottom: 6 },

  tableHeader: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#F1F5F9',
    borderRadius: 8, paddingHorizontal: 8, paddingVertical: 7,
    borderWidth: 1, borderColor: Colors.border,
    marginBottom: 4,
  },
  thCell: { fontSize: 12, fontWeight: '700', color: Colors.textSecondary, textAlign: 'center' },

  tableRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 8, paddingHorizontal: 8, paddingVertical: 8,
    borderWidth: 1, borderColor: Colors.border,
    marginBottom: 4, gap: 2,
  },
  tableRowError: { borderColor: '#FECACA', backgroundColor: '#FFF5F5' },
  tdCell: { fontSize: 12, color: Colors.text, textAlign: 'center' },

  colSku: { width: 52 },
  colName: { flex: 1, textAlign: 'left', paddingHorizontal: 4 },
  colQty: { width: 36 },
  colInput: { width: 52, alignItems: 'center' },
  inputError: { borderRadius: 4, backgroundColor: '#FEE2E2' },

  skuText: { fontSize: 12, fontWeight: '700', color: '#2563EB', textAlign: 'center' },
  sizeText: { fontSize: 12, color: Colors.textSecondary, textAlign: 'center' },

  qtyInput: {
    width: 46, height: 32,
    borderWidth: 1.5, borderColor: Colors.border,
    borderRadius: 6, textAlign: 'center',
    fontSize: 12, fontWeight: '700', color: Colors.text,
    backgroundColor: Colors.background,
    paddingVertical: 0,
  },
  qtyError: { fontSize: 12, color: '#EF4444', textAlign: 'center', marginTop: 2 },

  emptyItems: { alignItems: 'center', gap: 8, paddingVertical: 24 },

  submitRow: { marginHorizontal: 16, marginTop: 24 },
});

export default DeliveryOrderFormScreen;
