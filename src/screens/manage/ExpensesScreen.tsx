import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
  Image,
} from 'react-native';
import { MaterialIcons as Icon } from '@expo/vector-icons';
import LottieView from 'lottie-react-native';
import * as ImagePicker from 'expo-image-picker';
type Asset = ImagePicker.ImagePickerAsset;
import Colors from '../../theme/colors';
import AppText from '../../components/AppText';
import AppBar from '../../components/AppBar';
import DatePickerModal from '../../components/DatePickerModal';
import {
  getExpensesApi,
  getExpenseCategoriesApi,
  createExpenseApi,
  updateExpenseApi,
  deleteExpenseApi,
  uploadDirectApi,
  ApiExpense,
  ApiExpenseCategory,
} from '../../services/focusApi';

interface Props {
  onBack: () => void;
}

const CATEGORY_COLORS: Record<string, string> = {
  SALARY:      '#7C3AED',
  PAYROLL:     '#7C3AED',
  RENT:        '#F59E0B',
  ELECTRICITY: '#06B6D4',
  WATER:       '#3B82F6',
  INTERNET:    '#10B981',
  PHONE:       '#10B981',
  INSURANCE:   '#EF4444',
  TAX:         '#EF4444',
  FUEL:        '#F97316',
  TRANSPORT:   '#F97316',
  MAINTENANCE: '#8B5CF6',
  SUPPLIES:    '#EC4899',
  MARKETING:   '#EC4899',
  OTHER:       '#64748B',
};

const CATEGORY_ICONS: Record<string, string> = {
  SALARY:      'people',
  PAYROLL:     'people',
  RENT:        'home',
  ELECTRICITY: 'bolt',
  WATER:       'opacity',
  INTERNET:    'wifi',
  PHONE:       'phone',
  INSURANCE:   'security',
  TAX:         'account-balance',
  FUEL:        'local-gas-station',
  TRANSPORT:   'directions-car',
  MAINTENANCE: 'build',
  SUPPLIES:    'inventory',
  MARKETING:   'campaign',
  OTHER:       'category',
};

const categoryColor = (key?: string) =>
  (key && CATEGORY_COLORS[key.toUpperCase()]) ?? '#64748B';

const categoryIcon = (key?: string) =>
  (key && CATEGORY_ICONS[key.toUpperCase()]) ?? 'receipt-long';

const fmtMoney = (cents: number) => `$${(cents / 100).toFixed(2)}`;

const fmtDate = (iso?: string) => {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' }); }
  catch { return iso; }
};

const toISO = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const startOfMonth = () => {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
};

const LIMIT = 50;

const ExpensesScreen: React.FC<Props> = ({ onBack }) => {
  // ── Screen view ─────────────────────────────────────────────────────────────
  const [screenView, setScreenView] = useState<'list' | 'form'>('list');

  // ── List state ──────────────────────────────────────────────────────────────
  const [expenses,    setExpenses]    = useState<ApiExpense[]>([]);
  const [loading,     setLoading]     = useState(false);
  const [refreshing,  setRefreshing]  = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error,       setError]       = useState<string | null>(null);
  const [nextCursor,  setNextCursor]  = useState<string | null>(null);
  const [hasMore,     setHasMore]     = useState(false);

  // ── Filters ─────────────────────────────────────────────────────────────────
  const [fromDate,     setFromDate]     = useState<Date>(startOfMonth);
  const [toDate,       setToDate]       = useState<Date>(new Date());
  const [datePicker,   setDatePicker]   = useState<'from' | 'to' | null>(null);
  const [filterCat,    setFilterCat]    = useState<ApiExpenseCategory | null>(null);
  const [showCatModal, setShowCatModal] = useState(false);
  const [catSearch,    setCatSearch]    = useState('');

  // ── Categories ──────────────────────────────────────────────────────────────
  const [categories,  setCategories]  = useState<ApiExpenseCategory[]>([]);
  const [catsLoading, setCatsLoading] = useState(false);
  const catsLoaded = useRef(false);
  const lastTapRef = useRef<Record<string, number>>({});

  // ── Confirm dialog ───────────────────────────────────────────────────────────
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [confirmData,    setConfirmData]    = useState<{ title: string; message: string; amountCents: number } | null>(null);
  const [pendingDelete,  setPendingDelete]  = useState<ApiExpense | null>(null);

  // ── Form state ───────────────────────────────────────────────────────────────
  const [editingId,    setEditingId]    = useState<string | null>(null);
  const [formCat,      setFormCat]      = useState<ApiExpenseCategory | null>(null);
  const [formAmount,   setFormAmount]   = useState('');
  const [formDate,     setFormDate]     = useState<Date>(new Date());
  const [formVendor,   setFormVendor]   = useState('');
  const [formDesc,     setFormDesc]     = useState('');
  const [formDatePick, setFormDatePick] = useState(false);
  const [showFormCat,  setShowFormCat]  = useState(false);
  const [formCatSearch,setFormCatSearch]= useState('');
  const [saving,         setSaving]         = useState(false);
  const [deleting,       setDeleting]       = useState<string | null>(null);
  const [formProofAsset, setFormProofAsset] = useState<Asset | null>(null);
  const [formProofUrl,   setFormProofUrl]   = useState<string | null>(null);
  const [uploadingProof, setUploadingProof] = useState(false);
  const [showProofMenu,  setShowProofMenu]  = useState(false);
  const [previewUrl,     setPreviewUrl]     = useState<string | null>(null);

  // ── Load categories once ────────────────────────────────────────────────────
  const ensureCategories = useCallback(async () => {
    if (catsLoaded.current) return;
    setCatsLoading(true);
    try {
      const cats = await getExpenseCategoriesApi();
      setCategories(cats);
      catsLoaded.current = true;
    } catch { /* ignore */ }
    finally { setCatsLoading(false); }
  }, []);

  // ── Load list ───────────────────────────────────────────────────────────────
  const load = useCallback(async (refresh = false) => {
    if (refresh) { setRefreshing(true); } else { setLoading(true); }
    setError(null);
    try {
      const res = await getExpensesApi({
        from:       toISO(fromDate),
        to:         toISO(toDate),
        categoryId: filterCat?.id,
        limit:      LIMIT,
      });
      setExpenses(res.items);
      setNextCursor(res.nextCursor);
      setHasMore(res.nextCursor !== null);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to load expenses');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [fromDate, toDate, filterCat]);

  const loadMore = useCallback(async () => {
    if (!hasMore || loadingMore || !nextCursor) return;
    setLoadingMore(true);
    try {
      const res = await getExpensesApi({
        from:       toISO(fromDate),
        to:         toISO(toDate),
        categoryId: filterCat?.id,
        cursor:     nextCursor,
        limit:      LIMIT,
      });
      setExpenses(prev => [...prev, ...res.items]);
      setNextCursor(res.nextCursor);
      setHasMore(res.nextCursor !== null);
    } catch { /* ignore */ }
    finally { setLoadingMore(false); }
  }, [hasMore, loadingMore, nextCursor, fromDate, toDate, filterCat]);

  useEffect(() => { load(); }, []); // eslint-disable-line

  const totalCents = useMemo(() => expenses.reduce((s, e) => s + e.amountCents, 0), [expenses]);

  // ── Navigation helpers ───────────────────────────────────────────────────────
  const openCreate = () => {
    ensureCategories();
    setEditingId(null);
    setFormCat(null);
    setFormAmount('');
    setFormDate(new Date());
    setFormVendor('');
    setFormDesc('');
    setFormProofAsset(null);
    setFormProofUrl(null);
    setShowFormCat(false);
    setScreenView('form');
  };

  const openEdit = (expense: ApiExpense) => {
    ensureCategories();
    setEditingId(expense.id);
    const cat = categories.find(c => c.id === expense.categoryId) ?? {
      id: expense.categoryId,
      key: expense.categoryKey ?? '',
      nameEn: expense.categoryNameEn ?? expense.categoryKey ?? '',
    };
    setFormCat(cat);
    setFormAmount(String(expense.amountCents / 100));
    const d = expense.paidAt ? new Date(expense.paidAt) : new Date();
    setFormDate(isNaN(d.getTime()) ? new Date() : d);
    setFormVendor(expense.vendor ?? '');
    setFormDesc(expense.description ?? '');
    setFormProofAsset(null);
    setFormProofUrl(expense.proofUrl ?? null);
    setShowFormCat(false);
    setScreenView('form');
  };

  const handleDoubleTap = useCallback((item: ApiExpense) => {
    const now = Date.now();
    const last = lastTapRef.current[item.id] ?? 0;
    if (now - last < 350) {
      openEdit(item);
      lastTapRef.current[item.id] = 0;
    } else {
      lastTapRef.current[item.id] = now;
    }
  }, []); // eslint-disable-line

  // ── Proof image picker ───────────────────────────────────────────────────────
  const handlePickProof = (source: 'camera' | 'gallery') => {
    setShowProofMenu(false);
    setTimeout(async () => {
      const res = source === 'camera'
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8 })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
      if (res.canceled) return;
      setFormProofAsset(res.assets[0]);
      setFormProofUrl(null);
    }, 300);
  };

  // ── Save ────────────────────────────────────────────────────────────────────
  const handleSave = () => {
    if (!formCat) { Alert.alert('Validation', 'Please select a category.'); return; }
    const amt = parseFloat(formAmount);
    if (isNaN(amt) || amt <= 0) { Alert.alert('Validation', 'Enter a valid amount.'); return; }
    const amountCents = Math.round(amt * 100);
    setConfirmData({
      title:   editingId ? 'Save Changes' : 'Create Expense',
      message: `${editingId ? 'Update' : 'Record'} ${formCat.nameEn} of ${fmtMoney(amountCents)} on ${toISO(formDate)}?`,
      amountCents,
    });
    setConfirmVisible(true);
  };

  const doSave = async (amountCents: number) => {
    if (!formCat) return;
    setSaving(true);

    // Upload proof image if a new one was picked
    let proofUrl: string | undefined = formProofUrl ?? undefined;
    if (formProofAsset?.uri) {
      setUploadingProof(true);
      try {
        proofUrl = await uploadDirectApi({
          uri:      formProofAsset.uri,
          type:     formProofAsset.type ?? 'image/jpeg',
          fileName: formProofAsset.fileName ?? `expense-proof-${Date.now()}.jpg`,
          purpose:  'expense_proof',
        });
      } catch (err: any) {
        Alert.alert('Upload Failed', err?.message ?? 'Could not upload receipt image');
        setUploadingProof(false);
        setSaving(false);
        return;
      }
      setUploadingProof(false);
    }

    try {
      if (editingId) {
        await updateExpenseApi(editingId, {
          categoryId:  formCat.id,
          amountCents,
          paidAt:      toISO(formDate),
          vendor:      formVendor.trim() || undefined,
          description: formDesc.trim()   || undefined,
          proofUrl,
        });
        setExpenses(prev => prev.map(e =>
          e.id === editingId
            ? { ...e, categoryId: formCat.id, categoryKey: formCat.key,
                categoryNameEn: formCat.nameEn, amountCents, paidAt: toISO(formDate),
                vendor: formVendor.trim() || undefined, description: formDesc.trim() || undefined,
                proofUrl }
            : e,
        ));
      } else {
        await createExpenseApi({
          categoryId:  formCat.id,
          amountCents,
          paidAt:      toISO(formDate),
          vendor:      formVendor.trim() || undefined,
          description: formDesc.trim()   || undefined,
          proofUrl,
        });
        setScreenView('list');
        load(true);
        return;
      }
      setScreenView('list');
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? 'Failed to save expense');
    } finally {
      setSaving(false);
    }
  };

  // ── Delete ───────────────────────────────────────────────────────────────────
  const handleDelete = (expense: ApiExpense) => {
    setPendingDelete(expense);
  };

  const executeDelete = async () => {
    if (!pendingDelete) return;
    const expense = pendingDelete;
    setPendingDelete(null);
    setDeleting(expense.id);
    try {
      await deleteExpenseApi(expense.id);
      setExpenses(prev => prev.filter(e => e.id !== expense.id));
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? 'Failed to delete');
    } finally { setDeleting(null); }
  };

  // ── Filtered categories ──────────────────────────────────────────────────────
  const filteredCats = useMemo(() =>
    categories.filter(c =>
      !catSearch || c.nameEn.toLowerCase().includes(catSearch.toLowerCase()) ||
      c.key.toLowerCase().includes(catSearch.toLowerCase()),
    ), [categories, catSearch]);

  const formFilteredCats = useMemo(() =>
    categories.filter(c =>
      !formCatSearch || c.nameEn.toLowerCase().includes(formCatSearch.toLowerCase()),
    ), [categories, formCatSearch]);

  // ── Render item ─────────────────────────────────────────────────────────────
  const renderItem = useCallback(({ item }: { item: ApiExpense }) => {
    const color = categoryColor(item.categoryKey);
    const isDeleting = deleting === item.id;
    return (
      <View style={styles.rowWrap}>
        <TouchableOpacity activeOpacity={0.95} onPress={() => handleDoubleTap(item)}>
          <View style={styles.rowMain}>

            {/* Category icon box */}
            <View style={[styles.catIconBox, { backgroundColor: `${color}20` }]}>
              <Icon name={categoryIcon(item.categoryKey)} size={20} color={color} />
            </View>

            {/* Body */}
            <View style={styles.rowBody}>
              <AppText style={styles.catName} numberOfLines={1}>
                {item.categoryNameEn ?? item.categoryKey ?? '—'}
              </AppText>
              {item.vendor ? (
                <AppText style={styles.vendorText} numberOfLines={1}>{item.vendor}</AppText>
              ) : null}
              <View style={styles.rowMeta}>
                <View style={styles.dateBadge}>
                  <Icon name="event" size={10} color={Colors.textSecondary} />
                  <AppText style={styles.dateText}>{fmtDate(item.paidAt)}</AppText>
                </View>
                {item.createdByName ? (
                  <AppText style={styles.metaChip}>By: {item.createdByName}</AppText>
                ) : null}
              </View>
              {item.description ? (
                <AppText style={styles.descText} numberOfLines={1}>{item.description}</AppText>
              ) : null}
            </View>

            {/* Right: amount + receipt thumb */}
            <View style={styles.rowRight}>
              <AppText style={styles.rowAmount}>{fmtMoney(item.amountCents)}</AppText>
              {item.proofUrl ? (
                <TouchableOpacity
                  onPress={() => setPreviewUrl(item.proofUrl!)}
                  activeOpacity={0.8}
                  style={{ position: 'relative' }}
                >
                  <Image source={{ uri: item.proofUrl }} style={styles.rowReceiptThumb} resizeMode="cover" />
                  <View style={styles.rowReceiptBadge}>
                    <Icon name="zoom-in" size={11} color="#fff" />
                  </View>
                </TouchableOpacity>
              ) : null}
            </View>

          </View>
        </TouchableOpacity>

        {/* Delete button */}
        <View style={styles.cardActionRow}>
          <TouchableOpacity
            style={styles.actionBtnDelete}
            onPress={() => handleDelete(item)}
            disabled={isDeleting}
            activeOpacity={0.75}
          >
            {isDeleting
              ? <ActivityIndicator size="small" color={Colors.error} />
              : <Icon name="delete-outline" size={16} color={Colors.error} />}
          </TouchableOpacity>
        </View>
      </View>
    );
  }, [deleting, categories]); // eslint-disable-line

  const renderFooter = () => loadingMore
    ? <View style={styles.loadMoreWrap}><ActivityIndicator size="small" color={Colors.primary} /></View>
    : null;

  // ── Form screen ─────────────────────────────────────────────────────────────
  if (screenView === 'form') {
    return (
      <View style={styles.root}>
        <AppBar
          title={showFormCat ? 'Select Category' : (editingId ? 'Edit Expense' : 'New Expense')}
          titleAlign="left"
          showBack
          onBack={() => {
            if (showFormCat) { setShowFormCat(false); }
            else { setScreenView('list'); }
          }}
        />

        {/* ── Inline category picker ── */}
        {showFormCat ? (
          <View style={{ flex: 1 }}>
            <View style={styles.pickerSearchBox}>
              <Icon name="search" size={16} color={Colors.textSecondary} />
              <TextInput
                style={styles.pickerSearchInput}
                placeholder="Search category..."
                placeholderTextColor={Colors.textLight}
                value={formCatSearch}
                onChangeText={setFormCatSearch}
                autoFocus
              />
            </View>
            {catsLoading ? (
              <ActivityIndicator style={{ padding: 24 }} color={Colors.primary} />
            ) : (
              <FlatList
                data={formFilteredCats}
                keyExtractor={c => c.id}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={[styles.pickerItem, formCat?.id === item.id && styles.pickerItemActive]}
                    onPress={() => { setFormCat(item); setShowFormCat(false); setFormCatSearch(''); }}
                    activeOpacity={0.7}
                  >
                    <View style={[styles.catIconBox, { backgroundColor: `${categoryColor(item.key)}20`, marginRight: 12 }]}>
                      <Icon name={categoryIcon(item.key)} size={18} color={categoryColor(item.key)} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <AppText style={[styles.pickerItemText, formCat?.id === item.id && { color: Colors.primary, fontWeight: '700' }]}>
                        {item.nameEn}
                      </AppText>
                      {item.nameKm ? <AppText style={styles.pickerItemSub}>{item.nameKm}</AppText> : null}
                    </View>
                    {formCat?.id === item.id && <Icon name="check" size={18} color={Colors.primary} />}
                  </TouchableOpacity>
                )}
                contentContainerStyle={{ paddingBottom: 40 }}
              />
            )}
          </View>
        ) : (
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={styles.formScroll}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {/* Category */}
              <View style={styles.fieldGroup}>
                <AppText style={styles.fieldLabel}>Category *</AppText>
                <TouchableOpacity
                  style={[styles.fieldSelect, formCat && { borderColor: categoryColor(formCat.key) }]}
                  onPress={() => { setFormCatSearch(''); setShowFormCat(true); }}
                  activeOpacity={0.7}
                >
                  {formCat ? (
                    <View style={[styles.catIconBox, { backgroundColor: `${categoryColor(formCat.key)}20`, marginRight: 10 }]}>
                      <Icon name={categoryIcon(formCat.key)} size={18} color={categoryColor(formCat.key)} />
                    </View>
                  ) : null}
                  <AppText style={[styles.fieldSelectText, !formCat && { color: Colors.textLight }]}>
                    {formCat ? formCat.nameEn : 'Select category...'}
                  </AppText>
                  <Icon name="arrow-forward-ios" size={14} color={Colors.textSecondary} style={{ marginLeft: 'auto' }} />
                </TouchableOpacity>
              </View>

              {/* Amount */}
              <View style={styles.fieldGroup}>
                <AppText style={styles.fieldLabel}>Amount (USD) *</AppText>
                <View style={styles.amountInputWrap}>
                  <AppText style={styles.amountPrefix}>$</AppText>
                  <TextInput
                    style={styles.amountInput}
                    value={formAmount}
                    onChangeText={setFormAmount}
                    keyboardType="decimal-pad"
                    placeholder="0.00"
                    placeholderTextColor={Colors.textLight}
                  />
                </View>
                {formAmount && !isNaN(parseFloat(formAmount)) && (
                  <AppText style={styles.fieldHint}>= {Math.round(parseFloat(formAmount) * 100)} cents</AppText>
                )}
              </View>

              {/* Date */}
              <View style={styles.fieldGroup}>
                <AppText style={styles.fieldLabel}>Payment Date *</AppText>
                <TouchableOpacity style={styles.fieldSelect} onPress={() => setFormDatePick(true)} activeOpacity={0.7}>
                  <Icon name="event" size={16} color={Colors.primary} style={{ marginRight: 10 }} />
                  <AppText style={styles.fieldSelectText}>{toISO(formDate)}</AppText>
                </TouchableOpacity>
              </View>

              {/* Vendor */}
              <View style={styles.fieldGroup}>
                <AppText style={styles.fieldLabel}>Vendor / Payee (optional)</AppText>
                <TextInput
                  style={styles.fieldInput}
                  value={formVendor}
                  onChangeText={setFormVendor}
                  placeholder="e.g. Building Owner"
                  placeholderTextColor={Colors.textLight}
                />
              </View>

              {/* Description */}
              <View style={styles.fieldGroup}>
                <AppText style={styles.fieldLabel}>Description (optional)</AppText>
                <TextInput
                  style={[styles.fieldInput, styles.fieldInputMulti]}
                  value={formDesc}
                  onChangeText={setFormDesc}
                  placeholder="e.g. July rent payment"
                  placeholderTextColor={Colors.textLight}
                  multiline
                  numberOfLines={3}
                />
              </View>

              {/* Receipt / Proof image */}
              <View style={styles.fieldGroup}>
                <AppText style={styles.fieldLabel}>Receipt / Proof (optional)</AppText>
                <View style={styles.photoGrid}>
                  {(formProofAsset?.uri || formProofUrl) ? (
                    <View style={styles.photoThumbWrap}>
                      <Image
                        source={{ uri: formProofAsset?.uri ?? formProofUrl! }}
                        style={styles.photoThumb}
                        resizeMode="cover"
                      />
                      <TouchableOpacity
                        style={styles.photoRemoveBtn}
                        onPress={() => { setFormProofAsset(null); setFormProofUrl(null); }}
                        hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                      >
                        <Icon name="cancel" size={20} color="#EF4444" />
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <TouchableOpacity style={styles.photoAddTile} onPress={() => setShowProofMenu(true)} activeOpacity={0.75}>
                      <Icon name="add-a-photo" size={36} color="#818CF8" />
                      <AppText style={styles.photoAddTxt}>Add Photo</AppText>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            </ScrollView>

            {/* Fixed save button */}
            <View style={styles.formBottomBar}>
              {uploadingProof && (
                <View style={styles.uploadingRow}>
                  <ActivityIndicator size="small" color={Colors.primary} />
                  <AppText style={styles.uploadingText}>Uploading receipt…</AppText>
                </View>
              )}
              <TouchableOpacity
                style={[styles.saveBtn, (saving || uploadingProof) && styles.saveBtnDisabled]}
                onPress={handleSave}
                disabled={saving || uploadingProof}
                activeOpacity={0.85}
              >
                {saving
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <>
                      <Icon name={editingId ? 'save' : 'add-circle'} size={18} color="#fff" />
                      <AppText style={styles.saveBtnText}>{editingId ? 'Save Changes' : 'Create Expense'}</AppText>
                    </>}
              </TouchableOpacity>
            </View>

          </KeyboardAvoidingView>
        )}

        <DatePickerModal
          visible={formDatePick}
          value={formDate}
          onChange={d => { setFormDate(d); setFormDatePick(false); }}
          onClose={() => setFormDatePick(false)}
        />

        {/* ── Photo source bottom sheet ── */}
        <Modal visible={showProofMenu} transparent animationType="slide" onRequestClose={() => setShowProofMenu(false)}>
          <TouchableOpacity style={styles.menuOverlay} activeOpacity={1} onPress={() => setShowProofMenu(false)}>
            <TouchableOpacity activeOpacity={1} style={styles.photoMenu} onPress={() => {}}>
              <AppText style={styles.photoMenuTitle}>Add Receipt Photo</AppText>
              <TouchableOpacity style={styles.photoMenuItem} onPress={() => handlePickProof('camera')} activeOpacity={0.7}>
                <View style={[styles.photoMenuIcon, { backgroundColor: '#EEF2FF' }]}>
                  <Icon name="photo-camera" size={22} color="#6366F1" />
                </View>
                <AppText style={styles.photoMenuLabel}>Take Photo</AppText>
                <Icon name="chevron-right" size={18} color={Colors.textLight} />
              </TouchableOpacity>
              <View style={styles.menuSep} />
              <TouchableOpacity style={styles.photoMenuItem} onPress={() => handlePickProof('gallery')} activeOpacity={0.7}>
                <View style={[styles.photoMenuIcon, { backgroundColor: '#D1FAE5' }]}>
                  <Icon name="photo-library" size={22} color="#10B981" />
                </View>
                <AppText style={styles.photoMenuLabel}>Upload from Gallery</AppText>
                <Icon name="chevron-right" size={18} color={Colors.textLight} />
              </TouchableOpacity>
            </TouchableOpacity>
          </TouchableOpacity>
        </Modal>

        {/* ── Custom confirm dialog ── */}
        <Modal visible={confirmVisible} transparent animationType="fade" onRequestClose={() => setConfirmVisible(false)}>
          <View style={styles.confirmOverlay}>
            <View style={styles.confirmCard}>
              <View style={styles.confirmLottieWrap}>
                <LottieView
                  source={require('../../assets/animations/invoice-confirm.json')}
                  autoPlay
                  loop
                  style={styles.confirmLottie}
                />
              </View>
              <AppText style={styles.confirmTitle}>{confirmData?.title}</AppText>
              <AppText style={styles.confirmMessage}>{confirmData?.message}</AppText>
              <View style={styles.confirmRow}>
                <TouchableOpacity
                  style={styles.confirmCancelBtn}
                  onPress={() => setConfirmVisible(false)}
                  activeOpacity={0.7}
                >
                  <AppText style={styles.confirmCancelText}>Cancel</AppText>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.confirmOkBtn}
                  onPress={() => { setConfirmVisible(false); doSave(confirmData!.amountCents); }}
                  activeOpacity={0.85}
                >
                  <AppText style={styles.confirmOkText}>{editingId ? 'Save' : 'Create'}</AppText>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      </View>
    );
  }

  // ── List screen ─────────────────────────────────────────────────────────────
  return (
    <View style={styles.root}>
      <AppBar
        title="Expenses"
        subtitle={`${expenses.length} record${expenses.length !== 1 ? 's' : ''}`}
        titleAlign="left"
        showBack
        onBack={onBack}
      />

      {/* Filter bar */}
      <View style={styles.filterPanel}>
        <TouchableOpacity
          style={[styles.catFilterBtn, filterCat && styles.catFilterBtnActive]}
          onPress={() => { ensureCategories(); setCatSearch(''); setShowCatModal(true); }}
          activeOpacity={0.7}
        >
          <Icon name="label" size={15} color={filterCat ? Colors.primary : Colors.textSecondary} />
          <AppText style={[styles.catFilterText, filterCat && { color: Colors.primary }]} numberOfLines={1}>
            {filterCat ? filterCat.nameEn : 'All Categories'}
          </AppText>
          <Icon name="arrow-drop-down" size={20} color={filterCat ? Colors.primary : Colors.textSecondary} style={{ marginLeft: 'auto' }} />
        </TouchableOpacity>
        <View style={styles.dateRow}>
          <TouchableOpacity style={styles.datePill} onPress={() => setDatePicker('from')} activeOpacity={0.7}>
            <Icon name="event" size={13} color={Colors.primary} />
            <AppText style={styles.datePillText}>{toISO(fromDate)}</AppText>
          </TouchableOpacity>
          <AppText style={styles.dateSep}>→</AppText>
          <TouchableOpacity style={styles.datePill} onPress={() => setDatePicker('to')} activeOpacity={0.7}>
            <Icon name="event" size={13} color={Colors.primary} />
            <AppText style={styles.datePillText}>{toISO(toDate)}</AppText>
          </TouchableOpacity>
          <TouchableOpacity style={styles.applyBtn} onPress={() => load()} activeOpacity={0.85}>
            <Icon name="filter-list" size={14} color="#fff" />
            <AppText style={styles.applyBtnText}>Filter</AppText>
          </TouchableOpacity>
        </View>
      </View>

      {/* Summary banner */}
      {!loading && expenses.length > 0 && (
        <View style={styles.summaryBanner}>
          <View>
            <AppText style={styles.summaryLabel}>Total Expenses</AppText>
            <AppText style={styles.summaryAmount}>{fmtMoney(totalCents)}</AppText>
          </View>
          <View style={styles.summaryIconWrap}>
            <Icon name="receipt-long" size={26} color="#fff" />
          </View>
        </View>
      )}

      {/* Content */}
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Icon name="error-outline" size={48} color={Colors.textLight} />
          <AppText style={styles.centerMsg}>{error}</AppText>
          <TouchableOpacity style={styles.retryBtn} onPress={() => load()}>
            <AppText style={{ color: Colors.primary, fontWeight: '600' }}>Retry</AppText>
          </TouchableOpacity>
        </View>
      ) : expenses.length === 0 ? (
        <View style={styles.center}>
          <Icon name="receipt" size={64} color={Colors.textLight} />
          <AppText style={styles.emptyTitle}>No Expenses</AppText>
          <AppText style={styles.emptyMsg}>Tap + to record an expense.</AppText>
        </View>
      ) : (
        <FlatList
          data={expenses}
          keyExtractor={e => e.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          onEndReached={loadMore}
          onEndReachedThreshold={0.3}
          ListFooterComponent={renderFooter}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => load(true)}
              tintColor={Colors.primary}
            />
          }
        />
      )}

      {/* FAB */}
      <TouchableOpacity style={styles.fab} onPress={openCreate} activeOpacity={0.85}>
        <Icon name="add" size={28} color="#fff" />
      </TouchableOpacity>

      {/* Category filter modal */}
      <Modal visible={showCatModal} animationType="slide" transparent onRequestClose={() => setShowCatModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.pickerSheet}>
            <View style={styles.pickerHeader}>
              <AppText style={styles.pickerTitle}>Filter by Category</AppText>
              <TouchableOpacity onPress={() => setShowCatModal(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Icon name="close" size={22} color={Colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <View style={styles.pickerSearchBox}>
              <Icon name="search" size={16} color={Colors.textSecondary} />
              <TextInput
                style={styles.pickerSearchInput}
                placeholder="Search..."
                placeholderTextColor={Colors.textLight}
                value={catSearch}
                onChangeText={setCatSearch}
                autoFocus
              />
            </View>
            <TouchableOpacity
              style={styles.pickerClearRow}
              onPress={() => { setFilterCat(null); setShowCatModal(false); setCatSearch(''); }}
            >
              <Icon name="clear-all" size={16} color={Colors.textSecondary} />
              <AppText style={styles.pickerClearText}>Show all categories</AppText>
            </TouchableOpacity>
            {catsLoading ? (
              <ActivityIndicator style={{ padding: 24 }} color={Colors.primary} />
            ) : (
              <FlatList
                data={filteredCats}
                keyExtractor={c => c.id}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={[styles.pickerItem, filterCat?.id === item.id && styles.pickerItemActive]}
                    onPress={() => { setFilterCat(item); setShowCatModal(false); setCatSearch(''); }}
                    activeOpacity={0.7}
                  >
                    <View style={[styles.catIconBox, { backgroundColor: `${categoryColor(item.key)}20`, marginRight: 12 }]}>
                      <Icon name={categoryIcon(item.key)} size={18} color={categoryColor(item.key)} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <AppText style={[styles.pickerItemText, filterCat?.id === item.id && { color: Colors.primary, fontWeight: '700' }]}>
                        {item.nameEn}
                      </AppText>
                      {item.nameKm ? <AppText style={styles.pickerItemSub}>{item.nameKm}</AppText> : null}
                    </View>
                    {filterCat?.id === item.id && <Icon name="check" size={16} color={Colors.primary} />}
                  </TouchableOpacity>
                )}
                contentContainerStyle={{ paddingBottom: 40 }}
              />
            )}
          </View>
        </View>
      </Modal>

      {/* Date pickers */}
      <DatePickerModal
        visible={datePicker === 'from'}
        value={fromDate}
        onChange={d => { setFromDate(d); setDatePicker(null); }}
        onClose={() => setDatePicker(null)}
      />
      <DatePickerModal
        visible={datePicker === 'to'}
        value={toDate}
        onChange={d => { setToDate(d); setDatePicker(null); }}
        onClose={() => setDatePicker(null)}
      />

      {/* Delete confirmation modal */}
      <Modal
        visible={pendingDelete !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setPendingDelete(null)}
      >
        <View style={styles.confirmOverlay}>
          <View style={styles.confirmCard}>
            <View style={[styles.confirmLottieWrap, { backgroundColor: '#FEF2F2' }]}>
              <Icon name="delete-forever" size={40} color={Colors.error} />
            </View>
            <AppText style={styles.confirmTitle}>Delete Expense?</AppText>
            <AppText style={styles.confirmMessage}>
              {`${pendingDelete?.categoryNameEn ?? 'This expense'} (${fmtMoney(pendingDelete?.amountCents ?? 0)}) will be permanently removed.`}
            </AppText>
            <View style={styles.confirmRow}>
              <TouchableOpacity
                style={styles.confirmCancelBtn}
                onPress={() => setPendingDelete(null)}
                activeOpacity={0.7}
              >
                <AppText style={styles.confirmCancelText}>Cancel</AppText>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.confirmOkBtn, { backgroundColor: Colors.error }]}
                onPress={executeDelete}
                activeOpacity={0.85}
              >
                <AppText style={styles.confirmOkText}>Delete</AppText>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Full-screen image preview */}
      <Modal
        visible={previewUrl !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setPreviewUrl(null)}
        statusBarTranslucent
      >
        <View style={styles.previewOverlay}>
          <Image
            source={{ uri: previewUrl ?? '' }}
            style={styles.previewImage}
            resizeMode="contain"
          />
          <TouchableOpacity
            style={styles.previewCloseBtn}
            onPress={() => setPreviewUrl(null)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Icon name="close" size={22} color="#fff" />
          </TouchableOpacity>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },

  // ── FAB ──────────────────────────────────────────────────────────────────────
  fab: {
    position: 'absolute',
    bottom: 28,
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 8,
  },

  // ── Filter ────────────────────────────────────────────────────────────────────
  filterPanel: {
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 10,
    gap: 8,
  },
  catFilterBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
  },
  catFilterBtnActive: { borderColor: Colors.primary, backgroundColor: Colors.primaryMuted },
  catFilterText: { flex: 1, fontSize: 14, color: Colors.textSecondary, fontWeight: '600' },

  dateRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  datePill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
  },
  datePillText: { fontSize: 12, fontWeight: '600', color: Colors.text, flex: 1 },
  dateSep: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary },
  applyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 10,
    backgroundColor: Colors.primary,
  },
  applyBtnText: { fontSize: 13, color: '#fff', fontWeight: '700' },

  // ── Summary ───────────────────────────────────────────────────────────────────
  summaryBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.primary,
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 8,
    borderRadius: 20,
    padding: 20,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 8,
  },
  summaryLabel:   { color: 'rgba(255,255,255,0.6)', fontSize: 11, fontWeight: '600', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 4 },
  summaryAmount:  { color: '#fff', fontSize: 28, fontWeight: '800', letterSpacing: -0.5 },
  summaryIconWrap: {
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center', justifyContent: 'center',
  },

  // ── List ──────────────────────────────────────────────────────────────────────
  list: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 100 },
  loadMoreWrap: { padding: 16, alignItems: 'center' },
  rowWrap: {
    backgroundColor: Colors.surface,
    borderRadius: 18,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 8,
    elevation: 3,
    overflow: 'hidden',
  },
  rowMain: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, gap: 12 },
  catIconBox: { width: 46, height: 46, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  rowBody: { flex: 1, gap: 4 },
  catName: { fontSize: 15, fontWeight: '700', color: Colors.text, letterSpacing: -0.1 },
  vendorText: { fontSize: 12, fontWeight: '500', color: Colors.textSecondary },
  rowMeta: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  dateBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.background,
    borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3,
    borderWidth: 1, borderColor: Colors.border,
  },
  dateText: { fontSize: 11, fontWeight: '600', color: Colors.textSecondary },
  metaChip: { fontSize: 11, color: Colors.textSecondary, fontWeight: '500' },
  descText: { fontSize: 11, color: Colors.textSecondary, fontStyle: 'italic', lineHeight: 16 },
  rowRight: { alignItems: 'flex-end', gap: 8 },
  rowAmount: { fontSize: 17, fontWeight: '800', color: '#DC2626', letterSpacing: -0.3 },
  cardActionRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 14,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: Colors.divider,
  },
  actionBtnDelete: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1.5,
    borderColor: Colors.error,
    backgroundColor: '#FEF2F2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowReceiptThumb: {
    width: 52,
    height: 52,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  rowReceiptBadge: {
    position: 'absolute',
    bottom: 3,
    right: 3,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 8,
    width: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── Image preview modal ───────────────────────────────────────────────────────
  previewOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.93)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  previewImage: {
    width: '100%',
    height: '80%',
  },
  previewCloseBtn: {
    position: 'absolute',
    top: 52,
    right: 20,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 20,
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── Empty / error ─────────────────────────────────────────────────────────────
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  centerMsg: { color: Colors.textSecondary, textAlign: 'center', fontSize: 14 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: Colors.text, marginTop: 8 },
  emptyMsg: { fontSize: 14, color: Colors.textSecondary },
  retryBtn: {
    paddingHorizontal: 24, paddingVertical: 10,
    borderRadius: 8, borderWidth: 1.5, borderColor: Colors.primary,
  },

  // ── Category filter modal ─────────────────────────────────────────────────────
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  pickerSheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '80%',
    paddingBottom: 40,
  },
  pickerHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 24, paddingVertical: 16,
    borderBottomWidth: 1, borderBottomColor: Colors.divider,
  },
  pickerTitle: { fontSize: 17, fontWeight: '700', color: Colors.text },
  pickerSearchBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginHorizontal: 16, marginVertical: 10, paddingHorizontal: 12, height: 44,
    backgroundColor: Colors.background, borderRadius: 10,
    borderWidth: 1.5, borderColor: Colors.border,
  },
  pickerSearchInput: { flex: 1, fontSize: 14, color: Colors.text, paddingVertical: 0 },
  pickerClearRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 24, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: Colors.divider,
  },
  pickerClearText: { fontSize: 13, color: Colors.textSecondary },
  pickerItem: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 24, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: Colors.divider,
  },
  pickerItemActive: { backgroundColor: Colors.primaryMuted },
  pickerItemText: { fontSize: 14, color: Colors.text },
  pickerItemSub: { fontSize: 11, color: Colors.textSecondary, marginTop: 1 },
  catDot: { width: 10, height: 10, borderRadius: 5 },

  // ── Form screen ───────────────────────────────────────────────────────────────
  formScroll: { padding: 20, gap: 4, paddingBottom: 16 },
  fieldGroup: { marginBottom: 16 },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary, marginBottom: 6 },
  fieldInput: {
    borderWidth: 1.5, borderColor: Colors.border, borderRadius: 12,
    paddingHorizontal: 16, paddingVertical: 13,
    fontSize: 15, color: Colors.text, backgroundColor: Colors.surface,
  },
  fieldInputMulti: { height: 80, textAlignVertical: 'top', fontSize: 14 },
  fieldSelect: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1.5, borderColor: Colors.border, borderRadius: 12,
    paddingHorizontal: 16, paddingVertical: 14,
    backgroundColor: Colors.surface,
  },
  fieldSelectText: { fontSize: 15, color: Colors.text, flex: 1 },
  amountInputWrap: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1.5, borderColor: Colors.border, borderRadius: 12,
    backgroundColor: Colors.surface, paddingHorizontal: 16,
  },
  amountPrefix: { fontSize: 20, fontWeight: '700', color: Colors.textSecondary, marginRight: 4 },
  amountInput: { flex: 1, fontSize: 20, fontWeight: '700', color: Colors.text, paddingVertical: 13 },
  fieldHint: { fontSize: 12, color: Colors.primary, fontWeight: '600', marginTop: 4, marginLeft: 4 },
  formBottomBar: {
    borderTopWidth: 1, borderTopColor: Colors.divider,
    paddingHorizontal: 20, paddingTop: 12,
    paddingBottom: Platform.OS === 'ios' ? 32 : 16,
    backgroundColor: Colors.surface,
  },
  saveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 16,
  },
  saveBtnDisabled: { backgroundColor: Colors.border },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },

  // ── Custom confirm dialog ─────────────────────────────────────────────────────
  confirmOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  confirmCard: {
    backgroundColor: Colors.surface,
    borderRadius: 20,
    padding: 24,
    width: 280,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 12,
  },
  confirmLottieWrap: {
    marginBottom: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmLottie: {
    width: 130,
    height: 130,
  },
  confirmTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: Colors.text,
    marginBottom: 8,
    textAlign: 'center',
  },
  confirmMessage: {
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 21,
    marginBottom: 24,
  },
  confirmRow: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  confirmCancelBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Colors.border,
    alignItems: 'center',
  },
  confirmCancelText: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  confirmOkBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: Colors.primary,
    alignItems: 'center',
  },
  confirmOkText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
  },

  // ── Receipt / proof image ─────────────────────────────────────────────────────
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
  uploadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  uploadingText: { fontSize: 13, color: Colors.textSecondary },

  // ── Photo picker bottom sheet ─────────────────────────────────────────────────
  menuOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
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

export default ExpensesScreen;
