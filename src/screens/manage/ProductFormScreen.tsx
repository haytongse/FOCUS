import React, { useState, useEffect } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Switch,
  ActivityIndicator,
  Image,
  Modal,
  TextInput,
} from 'react-native';
import { MaterialIcons as Icon } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
type Asset = ImagePicker.ImagePickerAsset;
import Colors from '../../theme/colors';
import AppText from '../../components/AppText';
import AppInput from '../../components/AppInput';
import AppButton from '../../components/AppButton';
import AppBar from '../../components/AppBar';
import { useAlert } from '../../components/AppAlert';
import {
  createProductApi, updateProductApi, uploadProductImageApi,
  getCategoriesApi, ApiCategory,
  getVendorsApi, ApiVendor,
  getUomsApi, ApiUom,
  getProductLocationsApi, removeProductLocationApi,
  addProductLocationApi, updateProductLocationApi,
  getLocationsApi, ApiLocation,
  ApiProduct, ApiProductLocation,
  changeSkuApi,
  getStockLastCostBySkuApi,
} from '../../services/focusApi';

interface Props {
  product?: ApiProduct;
  onBack: () => void;
  onSaved: () => void;
}

type PricingMode = 'FIXED' | 'RFQ';

const sanitizeDecimal = (v: string): string => {
  const cleaned = v.replace(/[^0-9.]/g, '');
  const dot = cleaned.indexOf('.');
  if (dot === -1) return cleaned;
  return cleaned.slice(0, dot + 1) + cleaned.slice(dot + 1).replace(/\./g, '');
};

const normalizeDecimal = (v: string): string => {
  if (!v) return v;
  let [whole, frac] = v.split('.');
  if (frac === undefined) return `${whole}.00`;
  if (whole === '') whole = '0';
  if (frac.length === 1) frac += '0';
  return `${whole}.${frac}`;
};

const ProductFormScreen: React.FC<Props> = ({ product, onBack, onSaved }) => {
  const { showAlert } = useAlert();
  const isEdit = !!product;

  // ── Core product fields ───────────────────────────────────────────────────
  const [sku, setSku] = useState(product?.sku ?? '');
  const [nameEn, setNameEn] = useState(product?.nameEn ?? '');
  const [nameKm, setNameKm] = useState(product?.nameKm ?? '');
  const [country, setCountry] = useState(product?.country ?? '');
  const [size, setSize] = useState(product?.size ?? '');
  const [pricingMode, setPricingMode] = useState<PricingMode>(product?.pricingMode ?? 'FIXED');
  const [price, setPrice] = useState(
    product?.fixedPriceCents ? String(parseInt(product.fixedPriceCents, 10) / 100) : '',
  );
  const [costPrice, setCostPrice] = useState(
    product?.costPriceCents ? String(parseInt(product.costPriceCents, 10) / 100) : '',
  );
  const [categoryId, setCategoryId] = useState<string>(product?.categoryId ?? '');
  const [vendorId, setVendorId] = useState<number | null>(product?.vendorId ?? null);
  const [uomId, setUomId] = useState<number | null>(product?.uomId ?? null);
  const [isRentalItem, setIsRentalItem] = useState(product?.isRentalItem ?? false);
  const [active, setActive] = useState(product?.active !== false);

  // ── Image ─────────────────────────────────────────────────────────────────
  const [existingImageUrl, setExistingImageUrl] = useState<string | null>(product?.primaryImageUrl ?? null);
  const [newImageAsset, setNewImageAsset] = useState<Asset | null>(null);
  const [showPhotoMenu, setShowPhotoMenu] = useState(false);

  // ── Dropdown pickers ──────────────────────────────────────────────────────
  const [categories, setCategories] = useState<ApiCategory[]>([]);
  const [catLoading, setCatLoading] = useState(true);
  const [showCatPicker, setShowCatPicker] = useState(false);
  const [catSearch, setCatSearch] = useState('');

  const [vendors, setVendors] = useState<ApiVendor[]>([]);
  const [vendorLoading, setVendorLoading] = useState(true);
  const [showVendorPicker, setShowVendorPicker] = useState(false);
  const [vendorSearch, setVendorSearch] = useState('');

  const [uoms, setUoms] = useState<ApiUom[]>([]);
  const [uomLoading, setUomLoading] = useState(true);
  const [showUomPicker, setShowUomPicker] = useState(false);

  // ── Form state ────────────────────────────────────────────────────────────
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  // ── Change SKU ────────────────────────────────────────────────────────────
  const [skuModalVisible, setSkuModalVisible] = useState(false);
  const [newSkuInput, setNewSkuInput] = useState('');
  const [skuChanging, setSkuChanging] = useState(false);
  const [currentSku, setCurrentSku] = useState(product?.sku ?? '');
  const [skuError, setSkuError] = useState<string | null>(null);

  // ── Last cost (edit mode only) ─────────────────────────────────────────────
  const [lastCostCents, setLastCostCents] = useState<number | null>(null);

  // ── Product Locations ─────────────────────────────────────────────────────
  const [productLocations, setProductLocations] = useState<ApiProductLocation[]>([]);
  const [plLoading, setPlLoading] = useState(isEdit);
  const [plLoadError, setPlLoadError] = useState<string | null>(null);

  // ── Location inline form ───────────────────────────────────────────────────
  const [showLocForm, setShowLocForm] = useState(false);
  const [editingPL, setEditingPL] = useState<ApiProductLocation | null>(null);
  const [plLocationId, setPlLocationId] = useState('');
  const [plStoreBin, setPlStoreBin] = useState('');
  const [showLocPicker, setShowLocPicker] = useState(false);
  const [plSaving, setPlSaving] = useState(false);
  const [plErrors, setPlErrors] = useState<Record<string, string>>({});
  const [availableLocations, setAvailableLocations] = useState<ApiLocation[]>([]);
  const [locationsLoading, setLocationsLoading] = useState(false);
  const [locationsError, setLocationsError] = useState<string | null>(null);

  useEffect(() => {
    getCategoriesApi().then(d => setCategories(d)).catch(() => {}).finally(() => setCatLoading(false));
    getVendorsApi().then(d => setVendors(d)).catch(() => {}).finally(() => setVendorLoading(false));
    getUomsApi().then(d => setUoms(d)).catch(() => {}).finally(() => setUomLoading(false));
    setLocationsLoading(true);
    getLocationsApi()
      .then(d => setAvailableLocations(d))
      .catch(err => setLocationsError(err?.message ?? 'Failed to load locations'))
      .finally(() => setLocationsLoading(false));
    if (isEdit && product) {
      getProductLocationsApi(product.id)
        .then(d => setProductLocations(d))
        .catch(err => setPlLoadError(err?.message ?? 'Failed to load locations'))
        .finally(() => setPlLoading(false));
      getStockLastCostBySkuApi(product.sku)
        .then(cents => { if (cents != null) setLastCostCents(cents); })
        .catch(() => {});
    }
  }, []);

  const selectedCat = categories.find(c => c.id === categoryId);
  const filteredCategories = catSearch.trim()
    ? categories.filter(cat =>
        (cat.nameEn ?? '').toLowerCase().includes(catSearch.trim().toLowerCase()) ||
        (cat.nameKm ?? '').toLowerCase().includes(catSearch.trim().toLowerCase()),
      )
    : categories;
  const selectedVendor = vendors.find(v => v.id === vendorId);
  const filteredVendors = vendorSearch.trim()
    ? vendors.filter(v =>
        (v.nameEn ?? '').toLowerCase().includes(vendorSearch.trim().toLowerCase()) ||
        (v.nameKm ?? '').toLowerCase().includes(vendorSearch.trim().toLowerCase()) ||
        (v.code ?? '').toLowerCase().includes(vendorSearch.trim().toLowerCase()),
      )
    : vendors;
  const selectedUom = uoms.find(u => u.id === uomId);
  const [imageCacheBuster] = useState(() => Date.now());
  const displayImageUri = newImageAsset?.uri
    ?? (existingImageUrl ? `${existingImageUrl}?t=${imageCacheBuster}` : null);
  const selectedLocForPicker = availableLocations.find(l => String(l.id) === plLocationId) ?? null;

  const handleTakePhoto = () => {
    setShowPhotoMenu(false);
    setTimeout(async () => {
      const res = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8 });
      if (!res.canceled) { setNewImageAsset(res.assets[0]); setExistingImageUrl(null); }
    }, 300);
  };

  const handleGallery = () => {
    setShowPhotoMenu(false);
    setTimeout(async () => {
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
      if (!res.canceled) { setNewImageAsset(res.assets[0]); setExistingImageUrl(null); }
    }, 300);
  };

  const closeAllPickers = () => {
    setShowCatPicker(false);
    setShowVendorPicker(false);
    setShowUomPicker(false);
    setShowLocPicker(false);
  };

  const handleDeletePL = (pl: ApiProductLocation) => {
    showAlert({
      type: 'confirm',
      title: 'Remove Location',
      message: `Remove "${pl.locationCode} — ${pl.storeBin}" from this product?`,
      actions: [
        { label: 'Cancel', variant: 'outline' },
        {
          label: 'Remove',
          variant: 'danger',
          onPress: async () => {
            if (isEdit && product && !pl.id.startsWith('temp_')) {
              try {
                await removeProductLocationApi(product.id, pl.id);
              } catch (err: any) {
                showAlert({ type: 'error', title: 'Error', message: err?.message ?? 'Failed to remove location' });
                return;
              }
            }
            setProductLocations(prev => prev.filter(p => p.id !== pl.id));
          },
        },
      ],
    });
  };

  // ── Location form helpers ─────────────────────────────────────────────────

  const startAddPL = () => {
    setEditingPL(null);
    setPlLocationId('');
    setPlStoreBin('');
    setPlErrors({});
    setShowLocPicker(false);
    setShowLocForm(true);
  };

  const startEditPL = (pl: ApiProductLocation) => {
    setEditingPL(pl);
    setPlLocationId(String(pl.locationId));
    setPlStoreBin(pl.storeBin ?? '');
    setPlErrors({});
    setShowLocPicker(false);
    setShowLocForm(true);
  };

  const cancelLocForm = () => {
    setShowLocForm(false);
    setShowLocPicker(false);
    setEditingPL(null);
    setPlErrors({});
  };

  const validatePL = (): boolean => {
    const e: Record<string, string> = {};
    if (!editingPL && !plLocationId) e.locationId = 'Please select a location';
    setPlErrors(e);
    return Object.keys(e).length === 0;
  };

  const saveLocForm = async () => {
    if (!validatePL()) return;
    setPlSaving(true);
    try {
      if (editingPL && !editingPL.id.startsWith('temp_')) {
        if (isEdit && product) {
          const updated = await updateProductLocationApi(product.id, editingPL.id, { storeBin: plStoreBin || undefined });
          setProductLocations(prev => prev.map(p => p.id === editingPL.id ? updated : p));
        } else {
          setProductLocations(prev => prev.map(p => p.id === editingPL.id ? { ...p, storeBin: plStoreBin || '' } : p));
        }
      } else if (editingPL?.id.startsWith('temp_')) {
        setProductLocations(prev => prev.map(p => p.id === editingPL.id ? { ...p, storeBin: plStoreBin || '' } : p));
      } else {
        if (isEdit && product) {
          const added = await addProductLocationApi(product.id, { locationId: Number(plLocationId), storeBin: plStoreBin || undefined });
          setProductLocations(prev => [...prev, added]);
        } else {
          const loc = availableLocations.find(l => String(l.id) === plLocationId);
          const tempPL: ApiProductLocation = {
            id: `temp_${Date.now()}`,
            locationId: Number(plLocationId),
            locationCode: loc?.code ?? '',
            locationNameEn: loc?.nameEn ?? '',
            storeBin: plStoreBin || undefined,
          };
          setProductLocations(prev => [...prev, tempPL]);
        }
      }
      setShowLocForm(false);
      setShowLocPicker(false);
      setEditingPL(null);
      setPlErrors({});
    } catch (err: any) {
      setPlErrors({ general: err?.message ?? 'Failed to save location' });
    } finally {
      setPlSaving(false);
    }
  };

  // ── Validation & submit ───────────────────────────────────────────────────

  const validate = (): Record<string, string> => {
    const e: Record<string, string> = {};
    if (!isEdit) {
      const skuTrimmed = sku.trim().toUpperCase();
      if (!skuTrimmed) {
        e.sku = 'SKU is required';
      } else if (!/^[A-Z0-9][A-Z0-9-]{1,31}$/.test(skuTrimmed)) {
        e.sku = 'SKU must be 2–32 chars: uppercase letters, numbers, hyphens (no leading hyphen)';
      }
    }
    if (!nameEn.trim()) e.nameEn = 'English name is required';
    if (!nameKm.trim()) e.nameKm = 'Khmer name is required';
    if (!vendorId) e.vendor = 'Vendor is required';
    if (!uomId) e.uom = 'UOM is required';
    if (pricingMode === 'FIXED') {
      if (!price) {
        e.price = 'Price is required for Fixed pricing';
      } else if (isNaN(Number(price)) || Number(price) < 0) {
        e.price = 'Enter a valid price';
      }
    }
    if (!plLoading && productLocations.length === 0 && !(showLocForm && !!plLocationId)) {
      e.location = 'At least one location is required';
    }
    setErrors(e);
    return e;
  };

  const doSubmit = async () => {
    setApiError(null);
    setLoading(true);
    try {
      const fixedPriceCents =
        pricingMode === 'FIXED' ? String(Math.round(Number(price) * 100)) : undefined;
      const costPriceCents = costPrice ? String(Math.round(Number(costPrice) * 100)) : null;
      const unit = selectedUom?.code ?? '';

      if (isEdit) {
        if (showLocForm && plLocationId) {
          await saveLocForm();
        }
        await updateProductApi(product!.id, {
          nameEn: nameEn.trim(),
          nameKm: nameKm.trim(),
          pricingMode,
          fixedPriceCents: pricingMode === 'FIXED' ? fixedPriceCents : null,
          categoryId: categoryId || null,
          vendorId: vendorId ?? null,
          uomId: uomId ?? null,
          unit,
          isRentalItem,
          active,
          country: country.trim() || null,
          size: size.trim() || null,
          costPriceCents,
          ...(newImageAsset ? {} : { primaryImageUrl: existingImageUrl }),
        });
        if (newImageAsset?.uri) {
          await uploadProductImageApi(product!.id, newImageAsset);
        }
        onSaved();
      } else {
        const created = await createProductApi({
          sku: sku.trim().toUpperCase(),
          nameEn: nameEn.trim(),
          nameKm: nameKm.trim(),
          pricingMode,
          fixedPriceCents,
          categoryId: categoryId || null,
          vendorId: vendorId ?? null,
          uomId: uomId ?? null,
          unit,
          isRentalItem,
          active,
          country: country.trim() || null,
          size: size.trim() || null,
          costPriceCents,
        });
        if (newImageAsset?.uri && created?.id) {
          await uploadProductImageApi(created.id, newImageAsset);
        }
        if (created?.id) {
          if (showLocForm && plLocationId) {
            try {
              await addProductLocationApi(created.id, { locationId: Number(plLocationId), storeBin: plStoreBin || undefined });
            } catch {}
          }
          for (const pl of productLocations) {
            if (pl.id.startsWith('temp_')) {
              try {
                await addProductLocationApi(created.id, { locationId: pl.locationId, storeBin: pl.storeBin || undefined });
              } catch {}
            }
          }
        }
        setSku('');
        setNameEn('');
        setNameKm('');
        setCountry('');
        setSize('');
        setPrice('');
        setCostPrice('');
        setCategoryId('');
        setVendorId(null);
        setUomId(null);
        setIsRentalItem(false);
        setActive(true);
        setPricingMode('FIXED');
        setNewImageAsset(null);
        setExistingImageUrl(null);
        setProductLocations([]);
        setShowLocForm(false);
        setEditingPL(null);
        setPlLocationId('');
        setPlStoreBin('');
        showAlert({
          type: 'success',
          title: 'Product Created',
          message: `"${nameEn.trim() || nameKm.trim()}" has been added to the catalog.`,
          autoClose: 2500,
        });
      }
    } catch (err: any) {
      const msg: string =
        err?.response?.data?.error?.messageKey ??
        err?.response?.data?.error?.code ??
        err?.response?.data?.message ??
        err?.message ??
        `Failed to ${isEdit ? 'update' : 'create'} product`;
      const status: number | undefined = err?.response?.status;
      if (status === 409) {
        setApiError(`SKU "${sku.trim().toUpperCase()}" already exists. Please use a different SKU.`);
        setErrors(prev => ({ ...prev, sku: 'This SKU is already taken' }));
      } else {
        setApiError(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = () => {
    const errs = validate();
    if (Object.keys(errs).length > 0) {
      const LABELS: Record<string, string> = {
        sku: 'SKU',
        nameEn: 'English Name',
        nameKm: 'Khmer Name',
        vendor: 'Vendor',
        uom: 'UOM',
        price: 'Price',
        location: 'Location (at least one required)',
      };
      const missing = Object.keys(errs)
        .map(k => LABELS[k] ?? k)
        .join('\n• ');
      showAlert({
        type: 'error',
        title: 'Required Fields Missing',
        message: `Please fix the following:\n• ${missing}`,
      });
      return;
    }
    const displayName = nameEn.trim() || nameKm.trim() || sku.trim();
    showAlert({
      type: 'confirm',
      title: isEdit ? 'Save Changes' : 'Create Product',
      message: isEdit
        ? `Save changes to "${displayName}"?`
        : `Create product "${displayName}"?`,
      actions: [
        { label: 'Cancel', variant: 'outline' },
        { label: isEdit ? 'Save' : 'Create', variant: 'primary', onPress: doSubmit },
      ],
    });
  };


  return (
    <View style={styles.safe}>
      <AppBar
        title={isEdit ? 'Edit Product' : 'Create Product'}
        subtitle={isEdit ? `SKU: ${currentSku}` : 'Add a new product to the catalog'}
        titleAlign="left"
        showBack
        onBack={onBack}
      />

      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {apiError ? (
          <View style={styles.errorBanner}>
            <Icon name="error" size={18} color={Colors.error} />
            <AppText variant="caption" color="error" style={styles.bannerText}>{apiError}</AppText>
          </View>
        ) : null}

        {/* Product Image */}
        <View style={styles.card}>
          <AppText style={styles.sectionLabel}>Product Image</AppText>
          <View style={styles.photoGrid}>
            {displayImageUri ? (
              <View style={styles.photoThumbWrap}>
                <TouchableOpacity activeOpacity={0.8} onPress={() => setShowPhotoMenu(true)}>
                  <Image source={{ uri: displayImageUri }} style={styles.photoThumb} resizeMode="cover" />
                  <View style={styles.photoEditOverlay}>
                    <Icon name="photo-camera" size={18} color="#fff" />
                  </View>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.photoRemoveBtn}
                  onPress={() => { setNewImageAsset(null); setExistingImageUrl(null); }}
                  hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                >
                  <Icon name="cancel" size={20} color="#EF4444" />
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity style={styles.photoAddTile} onPress={() => setShowPhotoMenu(true)} activeOpacity={0.75}>
                <Icon name="add-a-photo" size={36} color="#818CF8" />
                <AppText style={styles.photoAddTxt}>Add Photo</AppText>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Basic Info */}
        <View style={styles.card}>
          <AppText style={styles.sectionLabel}>Basic Information</AppText>

          {isEdit ? (
            <View style={styles.skuRow}>
              <AppText variant="caption" color="textSecondary">SKU</AppText>
              <View style={styles.skuRowRight}>
                <View style={styles.skuBadge}>
                  <AppText style={styles.skuText}>{currentSku}</AppText>
                </View>
                <TouchableOpacity
                  style={styles.skuChangeBtn}
                  onPress={() => { setNewSkuInput(''); setSkuError(null); setSkuModalVisible(true); }}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Icon name="edit" size={13} color={Colors.primary} />
                  <AppText style={styles.skuChangeBtnText}>Change</AppText>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <AppInput
              label="SKU *"
              value={sku}
              onChangeText={v => setSku(v.toUpperCase().replace(/[^A-Z0-9-]/g, ''))}
              placeholder="e.g. BEV-WATER500"
              autoCapitalize="characters"
              autoCorrect={false}
              error={errors.sku}
              hint="Uppercase letters, numbers, hyphens only, 2–32 chars"
            />
          )}

          <AppInput
            label="English Name *"
            value={nameEn}
            onChangeText={setNameEn}
            placeholder="e.g. Mineral Water 500ml"
            error={errors.nameEn}
          />

          <AppInput
            label="Khmer Name *"
            value={nameKm}
            onChangeText={setNameKm}
            placeholder="e.g. ទឹករ៉ែ ៥០០ ម"
            error={errors.nameKm}
          />

          <AppInput
            label="Country (optional)"
            value={country}
            onChangeText={setCountry}
            placeholder="e.g. Cambodia"
          />

          <AppInput
            label="Size (optional)"
            value={size}
            onChangeText={setSize}
            placeholder="e.g. 500ml"
          />

        </View>

        {/* Pricing */}
        <View style={styles.card}>
          <AppText style={styles.sectionLabel}>Pricing</AppText>

          <AppText variant="label" style={styles.fieldLabel}>Pricing Mode *</AppText>
          <View style={styles.segmentRow}>
            {(['FIXED', 'RFQ'] as PricingMode[]).map(mode => (
              <TouchableOpacity
                key={mode}
                style={[styles.segment, pricingMode === mode ? styles.segmentActive : null]}
                onPress={() => setPricingMode(mode)}
                activeOpacity={0.7}
              >
                <AppText style={[styles.segmentText, pricingMode === mode ? styles.segmentTextActive : null]}>
                  {mode === 'FIXED' ? 'Fixed Price' : 'RFQ (Quote)'}
                </AppText>
              </TouchableOpacity>
            ))}
          </View>

          {pricingMode === 'FIXED' && (
            <AppInput
              label="Price (USD) *"
              value={price}
              onChangeText={v => setPrice(sanitizeDecimal(v))}
              onBlur={() => setPrice(p => normalizeDecimal(p))}
              placeholder="0.00"
              keyboardType="decimal-pad"
              error={errors.price}
            />
          )}

          <AppInput
            label="Cost Price (USD)"
            value={isEdit
              ? (lastCostCents != null ? Number(lastCostCents).toFixed(2) : '—')
              : costPrice}
            onChangeText={isEdit ? () => {} : v => setCostPrice(sanitizeDecimal(v))}
            onBlur={isEdit ? undefined : () => setCostPrice(p => normalizeDecimal(p))}
            placeholder="0.00"
            keyboardType="decimal-pad"
            editable={!isEdit}
          />

          {isEdit && (() => {
            const qoh = product?.qtyOnHand ?? 0;
            return (
              <View style={{ marginBottom: 16 }}>
                <AppText variant="label" style={{ marginBottom: 6, color: Colors.text }}>On Hand</AppText>
                <View style={{
                  borderWidth: 1.5,
                  borderColor: Colors.border,
                  borderRadius: 10,
                  backgroundColor: Colors.background,
                  minHeight: 50,
                  justifyContent: 'center',
                  paddingHorizontal: 14,
                }}>
                  <AppText style={{ color: qoh < 0 ? Colors.error : Colors.textSecondary }}>
                    {String(qoh)}
                  </AppText>
                </View>
              </View>
            );
          })()}

          {pricingMode === 'RFQ' && (
            <View style={styles.infoBox}>
              <Icon name="info" size={16} color={Colors.info} />
              <AppText variant="caption" color="textSecondary" style={styles.infoText}>
                Price will be negotiated per order for RFQ items.
              </AppText>
            </View>
          )}
        </View>

        {/* Classification */}
        <View style={styles.card}>
          <AppText style={styles.sectionLabel}>Classification</AppText>

          {/* Category */}
          <AppText variant="label" style={styles.fieldLabel}>Category (optional)</AppText>
          {catLoading ? (
            <ActivityIndicator size="small" color={Colors.primary} style={styles.pickerLoader} />
          ) : (
            <>
              <TouchableOpacity
                style={styles.picker}
                onPress={() => { setShowCatPicker(v => !v); setCatSearch(''); setShowVendorPicker(false); setShowUomPicker(false); setShowLocPicker(false); }}
                activeOpacity={0.7}
              >
                <AppText style={categoryId ? styles.pickerValue : styles.pickerPlaceholder}>
                  {selectedCat ? (selectedCat.nameEn || selectedCat.nameKm) : 'Select category…'}
                </AppText>
                <Icon name={showCatPicker ? 'expand-less' : 'expand-more'} size={22} color={Colors.textSecondary} />
              </TouchableOpacity>
              {showCatPicker && (
                <View style={styles.pickerDropdown}>
                  <View style={styles.pickerSearchRow}>
                    <Icon name="search" size={16} color={Colors.textSecondary} style={styles.pickerSearchIcon} />
                    <TextInput
                      style={styles.pickerSearchInput}
                      placeholder="Search category…"
                      placeholderTextColor={Colors.textLight}
                      value={catSearch}
                      onChangeText={setCatSearch}
                      autoFocus
                      clearButtonMode="while-editing"
                    />
                  </View>
                  <TouchableOpacity style={styles.pickerOption} onPress={() => { setCategoryId(''); setShowCatPicker(false); }}>
                    <AppText color="textSecondary">— None —</AppText>
                  </TouchableOpacity>
                  {filteredCategories.map(cat => (
                    <TouchableOpacity
                      key={cat.id}
                      style={[styles.pickerOption, categoryId === cat.id ? styles.pickerOptionActive : null]}
                      onPress={() => { setCategoryId(cat.id); setShowCatPicker(false); }}
                    >
                      <AppText style={categoryId === cat.id ? styles.pickerOptionActiveText : null}>
                        {cat.nameEn || cat.nameKm}
                      </AppText>
                    </TouchableOpacity>
                  ))}
                  {filteredCategories.length === 0 && (
                    <View style={styles.pickerOption}>
                      <AppText color="textSecondary">No categories match "{catSearch}"</AppText>
                    </View>
                  )}
                </View>
              )}
            </>
          )}

          {/* Vendor */}
          <AppText variant="label" style={[styles.fieldLabel, styles.fieldLabelSpaced]}>Vendor *</AppText>
          {vendorLoading ? (
            <ActivityIndicator size="small" color={Colors.primary} style={styles.pickerLoader} />
          ) : (
            <>
              <TouchableOpacity
                style={[styles.picker, errors.vendor ? styles.pickerError : null]}
                onPress={() => { setShowVendorPicker(v => !v); setVendorSearch(''); setShowCatPicker(false); setShowUomPicker(false); setShowLocPicker(false); }}
                activeOpacity={0.7}
              >
                <AppText style={vendorId ? styles.pickerValue : styles.pickerPlaceholder}>
                  {selectedVendor ? (selectedVendor.nameEn || selectedVendor.nameKm || selectedVendor.code) : 'Select vendor…'}
                </AppText>
                <Icon name={showVendorPicker ? 'expand-less' : 'expand-more'} size={22} color={Colors.textSecondary} />
              </TouchableOpacity>
              {errors.vendor ? <AppText style={styles.pickerErrorText}>{errors.vendor}</AppText> : null}
              {showVendorPicker && (
                <View style={styles.pickerDropdown}>
                  <View style={styles.pickerSearchRow}>
                    <Icon name="search" size={16} color={Colors.textSecondary} style={styles.pickerSearchIcon} />
                    <TextInput
                      style={styles.pickerSearchInput}
                      placeholder="Search vendor…"
                      placeholderTextColor={Colors.textLight}
                      value={vendorSearch}
                      onChangeText={setVendorSearch}
                      autoFocus
                      clearButtonMode="while-editing"
                    />
                  </View>
                  {filteredVendors.map(v => (
                    <TouchableOpacity
                      key={v.id}
                      style={[styles.pickerOption, vendorId === v.id ? styles.pickerOptionActive : null]}
                      onPress={() => { setVendorId(v.id); setShowVendorPicker(false); }}
                    >
                      <AppText style={vendorId === v.id ? styles.pickerOptionActiveText : null}>
                        {v.nameEn || v.nameKm || v.code}
                      </AppText>
                    </TouchableOpacity>
                  ))}
                  {filteredVendors.length === 0 && (
                    <View style={styles.pickerOption}>
                      <AppText color="textSecondary">No vendors match "{vendorSearch}"</AppText>
                    </View>
                  )}
                </View>
              )}
            </>
          )}

          {/* UOM */}
          <AppText variant="label" style={[styles.fieldLabel, styles.fieldLabelSpaced]}>UOM *</AppText>
          {uomLoading ? (
            <ActivityIndicator size="small" color={Colors.primary} style={styles.pickerLoader} />
          ) : (
            <>
              <TouchableOpacity
                style={[styles.picker, errors.uom ? styles.pickerError : null]}
                onPress={() => { setShowUomPicker(v => !v); setShowCatPicker(false); setShowVendorPicker(false); setShowLocPicker(false); }}
                activeOpacity={0.7}
              >
                <AppText style={uomId ? styles.pickerValue : styles.pickerPlaceholder}>
                  {selectedUom ? `${selectedUom.code}${selectedUom.nameEn ? ` — ${selectedUom.nameEn}` : ''}` : 'Select unit of measure…'}
                </AppText>
                <Icon name={showUomPicker ? 'expand-less' : 'expand-more'} size={22} color={Colors.textSecondary} />
              </TouchableOpacity>
              {errors.uom ? <AppText style={styles.pickerErrorText}>{errors.uom}</AppText> : null}
              {showUomPicker && (
                <View style={styles.pickerDropdown}>
                  {uoms.map(u => (
                    <TouchableOpacity
                      key={u.id}
                      style={[styles.pickerOption, uomId === u.id ? styles.pickerOptionActive : null]}
                      onPress={() => { setUomId(u.id); setShowUomPicker(false); }}
                    >
                      <AppText style={uomId === u.id ? styles.pickerOptionActiveText : null}>
                        {u.code}{u.nameEn ? ` — ${u.nameEn}` : ''}
                      </AppText>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </>
          )}
        </View>

        {/* Product Locations */}
        <View style={[styles.card, errors.location ? styles.cardError : null]}>
          <View style={styles.sectionLabelRow}>
            <AppText style={[styles.sectionLabel, { marginBottom: 0 }]}>Product Locations</AppText>
            <AppText style={styles.sectionRequired}>* Required</AppText>
          </View>

          {errors.location ? (
            <View style={styles.locationErrorBanner}>
              <Icon name="error-outline" size={15} color={Colors.error} />
              <AppText style={styles.locationErrorText}>{errors.location}</AppText>
            </View>
          ) : null}

          {plLoading ? (
            <ActivityIndicator size="small" color={Colors.primary} style={styles.pickerLoader} />
          ) : plLoadError ? (
            <View style={styles.plEmpty}>
              <Icon name="error-outline" size={28} color={Colors.error} />
              <AppText variant="caption" color="error" style={{ textAlign: 'center' }}>{plLoadError}</AppText>
              <TouchableOpacity
                onPress={() => {
                  if (!product) return;
                  setPlLoadError(null);
                  setPlLoading(true);
                  getProductLocationsApi(product.id)
                    .then(d => setProductLocations(d))
                    .catch(err => setPlLoadError(err?.message ?? 'Failed to load locations'))
                    .finally(() => setPlLoading(false));
                }}
              >
                <AppText style={{ color: Colors.primary, fontWeight: '600', fontSize: 13 }}>Retry</AppText>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              {productLocations.length === 0 && !showLocForm ? (
                <View style={styles.plEmpty}>
                  <Icon name="place" size={28} color={Colors.textLight} />
                  <AppText variant="caption" color="textSecondary">No store bins assigned</AppText>
                </View>
              ) : (
                productLocations.map(pl => (
                  <View key={pl.id} style={styles.plRow}>
                    <View style={styles.plCodeBadge}>
                      <AppText style={styles.plCodeText}>{pl.locationCode}</AppText>
                    </View>
                    <View style={styles.plInfo}>
                      <AppText variant="bodyMedium" style={styles.plBin}>{pl.locationNameEn}</AppText>
                      <AppText variant="caption" color="textSecondary" numberOfLines={1}>
                        {pl.locationCode}{pl.storeBin ? `  •  ${pl.storeBin}` : ''}
                      </AppText>
                    </View>
                    <TouchableOpacity
                      style={styles.plAction}
                      onPress={() => startEditPL(pl)}
                      hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                    >
                      <Icon name="edit" size={17} color={Colors.primary} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.plAction}
                      onPress={() => handleDeletePL(pl)}
                      hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                    >
                      <Icon name="delete-outline" size={17} color={Colors.error} />
                    </TouchableOpacity>
                  </View>
                ))
              )}

              {showLocForm && (
                <View style={styles.plForm}>
                  {plErrors.general ? (
                    <View style={styles.plFormErrorBox}>
                      <AppText style={{ color: Colors.error, fontSize: 12 }}>{plErrors.general}</AppText>
                    </View>
                  ) : null}

                  {editingPL ? (
                    <View style={styles.plLockedRow}>
                      <AppText variant="caption" color="textSecondary">Location</AppText>
                      <AppText style={{ fontWeight: '600', fontSize: 13 }}>
                        {editingPL.locationCode} — {editingPL.locationNameEn}
                      </AppText>
                    </View>
                  ) : (
                    <>
                      <AppText variant="label" style={styles.fieldLabel}>Location *</AppText>
                      {locationsLoading ? (
                        <ActivityIndicator size="small" color={Colors.primary} style={styles.pickerLoader} />
                      ) : (
                        <>
                          <TouchableOpacity
                            style={[styles.picker, plErrors.locationId ? styles.pickerError : null]}
                            onPress={() => { setShowLocPicker(v => !v); setShowCatPicker(false); setShowVendorPicker(false); setShowUomPicker(false); }}
                            activeOpacity={0.7}
                          >
                            <AppText style={plLocationId ? styles.pickerValue : styles.pickerPlaceholder}>
                              {selectedLocForPicker
                                ? `${selectedLocForPicker.code} — ${selectedLocForPicker.nameEn || selectedLocForPicker.nameKm}`
                                : 'Select location…'}
                            </AppText>
                            <Icon name={showLocPicker ? 'expand-less' : 'expand-more'} size={22} color={Colors.textSecondary} />
                          </TouchableOpacity>
                          {plErrors.locationId ? <AppText style={styles.pickerErrorText}>{plErrors.locationId}</AppText> : null}
                          {showLocPicker && (
                            <View style={styles.pickerDropdown}>
                              {availableLocations.map(loc => (
                                <TouchableOpacity
                                  key={String(loc.id)}
                                  style={[styles.pickerOption, plLocationId === String(loc.id) ? styles.pickerOptionActive : null]}
                                  onPress={() => { setPlLocationId(String(loc.id)); setShowLocPicker(false); }}
                                >
                                  <AppText style={plLocationId === String(loc.id) ? styles.pickerOptionActiveText : null}>
                                    {loc.code} — {loc.nameEn || loc.nameKm}
                                  </AppText>
                                </TouchableOpacity>
                              ))}
                            </View>
                          )}
                        </>
                      )}
                    </>
                  )}

                  <AppInput
                    label="Store Bin (optional)"
                    value={plStoreBin}
                    onChangeText={setPlStoreBin}
                    placeholder="e.g. A-01"
                  />
                </View>
              )}

              <View style={styles.addLocRow}>
                {showLocForm ? (
                  <>
                    <TouchableOpacity
                      style={[styles.addLocBtn, styles.addLocBtnFlex]}
                      onPress={saveLocForm}
                      disabled={plSaving}
                      activeOpacity={0.8}
                    >
                      {plSaving ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <>
                          <Icon name="save" size={16} color="#fff" />
                          <AppText style={styles.addLocBtnText}>Save Location</AppText>
                        </>
                      )}
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.cancelLocBtn} onPress={cancelLocForm} activeOpacity={0.7}>
                      <AppText style={styles.cancelLocBtnText}>Cancel</AppText>
                    </TouchableOpacity>
                  </>
                ) : (
                  <TouchableOpacity
                    style={[styles.addLocBtn, styles.addLocBtnFlex]}
                    onPress={startAddPL}
                    activeOpacity={0.8}
                  >
                    <Icon name="add-location" size={16} color="#fff" />
                    <AppText style={styles.addLocBtnText}>Add Location</AppText>
                  </TouchableOpacity>
                )}
              </View>
            </>
          )}
        </View>

        {/* Options */}
        <View style={styles.card}>
          <AppText style={styles.sectionLabel}>Options</AppText>

          <View style={styles.toggleRow}>
            <View style={styles.toggleInfo}>
              <AppText variant="body">Rental Item</AppText>
              <AppText variant="caption" color="textSecondary">Mark if this is a rental/loan item</AppText>
            </View>
            <Switch value={isRentalItem} onValueChange={setIsRentalItem} trackColor={{ true: Colors.primary }} thumbColor={Colors.white} />
          </View>

          <View style={[styles.toggleRow, styles.toggleLast]}>
            <View style={styles.toggleInfo}>
              <AppText variant="body">Active</AppText>
              <AppText variant="caption" color="textSecondary">Inactive products won't appear in POS</AppText>
            </View>
            <Switch value={active} onValueChange={setActive} trackColor={{ true: Colors.primary }} thumbColor={Colors.white} />
          </View>
        </View>

        <AppButton
          label={isEdit ? 'Save Changes' : 'Create Product'}
          onPress={handleSubmit}
          loading={loading}
          fullWidth
          size="lg"
          style={styles.submitBtn}
        />
      </ScrollView>

      {/* Photo bottom sheet */}
      <Modal visible={showPhotoMenu} transparent animationType="slide" onRequestClose={() => setShowPhotoMenu(false)}>
        <TouchableOpacity style={styles.menuOverlay} activeOpacity={1} onPress={() => setShowPhotoMenu(false)}>
          <TouchableOpacity activeOpacity={1} style={styles.photoMenu} onPress={() => {}}>
            <AppText style={styles.photoMenuTitle}>{isEdit ? 'Change Product Photo' : 'Add Product Photo'}</AppText>

            <TouchableOpacity style={styles.photoMenuItem} onPress={handleTakePhoto} activeOpacity={0.7}>
              <View style={[styles.photoMenuIcon, { backgroundColor: '#EEF2FF' }]}>
                <Icon name="photo-camera" size={22} color="#6366F1" />
              </View>
              <AppText style={styles.photoMenuLabel}>Take Photo</AppText>
              <Icon name="chevron-right" size={18} color={Colors.textLight} />
            </TouchableOpacity>

            <View style={styles.menuSep} />

            <TouchableOpacity style={styles.photoMenuItem} onPress={handleGallery} activeOpacity={0.7}>
              <View style={[styles.photoMenuIcon, { backgroundColor: '#D1FAE5' }]}>
                <Icon name="photo-library" size={22} color="#10B981" />
              </View>
              <AppText style={styles.photoMenuLabel}>Upload from Gallery</AppText>
              <Icon name="chevron-right" size={18} color={Colors.textLight} />
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Change SKU Modal */}
      <Modal
        visible={skuModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => !skuChanging && setSkuModalVisible(false)}
      >
        <TouchableOpacity
          style={styles.skuModalOverlay}
          activeOpacity={1}
          onPress={() => !skuChanging && setSkuModalVisible(false)}
        >
          <View
            style={styles.skuModalCard}
            onStartShouldSetResponder={() => true}
          >
            <AppText style={styles.skuModalTitle}>Change SKU</AppText>
            <AppText style={styles.skuModalCurrent}>
              {'Current: '}
              <AppText style={styles.skuModalCurrentVal}>{currentSku}</AppText>
            </AppText>
            <TextInput
              style={styles.skuModalInput}
              value={newSkuInput}
              onChangeText={v => { setNewSkuInput(v.toUpperCase().replace(/[^A-Z0-9-]/g, '')); setSkuError(null); }}
              placeholder="Enter new SKU or barcode"
              placeholderTextColor={Colors.textLight}
              autoCapitalize="characters"
              autoCorrect={false}
              keyboardType="default"
            />
            {skuError ? (
              <AppText variant="caption" color="error" style={{ marginTop: 8 }}>{skuError}</AppText>
            ) : null}
            {skuChanging ? (
              <ActivityIndicator color={Colors.primary} style={{ marginTop: 12 }} />
            ) : (
              <View style={styles.skuModalActions}>
                <TouchableOpacity
                  style={styles.skuModalCancel}
                  onPress={() => setSkuModalVisible(false)}
                >
                  <AppText style={styles.skuModalCancelText}>Cancel</AppText>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.skuModalConfirm}
                  onPress={async () => {
                    const trimmed = newSkuInput.trim();
                    if (!trimmed || trimmed === currentSku) {
                      setSkuModalVisible(false);
                      return;
                    }
                    setSkuChanging(true);
                    setSkuError(null);
                    try {
                      await changeSkuApi(currentSku, trimmed);
                      setCurrentSku(trimmed);
                      setSkuModalVisible(false);
                      showAlert({ type: 'success', title: 'SKU Updated', message: `SKU changed to ${trimmed}`, autoClose: 2000 });
                    } catch (e: any) {
                      setSkuError(e?.message ?? 'Could not change SKU');
                    } finally {
                      setSkuChanging(false);
                    }
                  }}
                >
                  <AppText style={styles.skuModalConfirmText}>Save</AppText>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: 16, gap: 16, paddingBottom: 32 },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.errorLight,
    borderRadius: 10,
    padding: 12,
    borderLeftWidth: 3,
    borderLeftColor: Colors.error,
    gap: 8,
  },
  bannerText: { flex: 1 },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  sectionLabel: {
    marginBottom: 16,
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    fontSize: 11,
    letterSpacing: 0.8,
    fontWeight: '600',
  },
  skuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.divider,
  },
  skuRowRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  skuBadge: {
    backgroundColor: Colors.divider,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  skuText: { fontSize: 13, fontWeight: '700', color: Colors.text, letterSpacing: 0.5 },
  skuChangeBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 16, borderWidth: 1,
    borderColor: `${Colors.primary}40`,
    backgroundColor: `${Colors.primary}08`,
  },
  skuChangeBtnText: { fontSize: 12, fontWeight: '600', color: Colors.primary },
  skuModalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center', alignItems: 'center', padding: 24,
  },
  skuModalCard: {
    backgroundColor: Colors.white, borderRadius: 16,
    padding: 20, width: '100%', gap: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15, shadowRadius: 16, elevation: 10,
  },
  skuModalTitle: { fontSize: 16, fontWeight: '800', color: Colors.text },
  skuModalCurrent: { fontSize: 13, color: Colors.textSecondary },
  skuModalCurrentVal: { fontWeight: '700', color: Colors.text },
  skuModalInput: {
    borderWidth: 1, borderColor: Colors.border, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 10,
    fontSize: 15, fontWeight: '700', color: Colors.text,
    letterSpacing: 0.5,
  },
  skuModalActions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  skuModalCancel: {
    flex: 1, paddingVertical: 11, borderRadius: 10,
    borderWidth: 1, borderColor: Colors.border, alignItems: 'center',
  },
  skuModalCancelText: { fontSize: 14, fontWeight: '600', color: Colors.textSecondary },
  skuModalConfirm: {
    flex: 1, paddingVertical: 11, borderRadius: 10,
    backgroundColor: Colors.primary, alignItems: 'center',
  },
  skuModalConfirmText: { fontSize: 14, fontWeight: '700', color: Colors.white },
  fieldLabel: { marginBottom: 6, color: Colors.text },
  fieldLabelSpaced: { marginTop: 14 },
  segmentRow: {
    flexDirection: 'row',
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: Colors.border,
    overflow: 'hidden',
    marginBottom: 16,
  },
  segment: { flex: 1, paddingVertical: 10, alignItems: 'center', backgroundColor: Colors.surface },
  segmentActive: { backgroundColor: Colors.primary },
  segmentText: { fontSize: 14, color: Colors.textSecondary, fontWeight: '500' },
  segmentTextActive: { color: Colors.white, fontWeight: '700' },
  infoBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.infoLight,
    borderRadius: 8,
    padding: 10,
    gap: 8,
  },
  infoText: { flex: 1 },
  pickerLoader: { marginVertical: 10 },
  picker: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: Colors.surface,
  },
  pickerError: { borderColor: Colors.error },
  pickerErrorText: { fontSize: 12, color: Colors.error, marginTop: 4, marginLeft: 2 },
  pickerValue: { flex: 1, fontSize: 14, color: Colors.text },
  pickerPlaceholder: { flex: 1, fontSize: 14, color: Colors.textLight },
  pickerDropdown: {
    marginTop: 4,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: Colors.surface,
  },
  pickerOption: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.divider,
  },
  pickerOptionActive: { backgroundColor: Colors.primaryMuted },
  pickerSearchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.divider,
    gap: 8,
  },
  pickerSearchIcon: { flexShrink: 0 },
  pickerSearchInput: {
    flex: 1,
    fontSize: 14,
    color: Colors.text,
    paddingVertical: 4,
  },
  pickerOptionActiveText: { color: Colors.primary, fontWeight: '600' },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: 14,
    marginBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.divider,
  },
  toggleLast: { paddingBottom: 0, marginBottom: 0, borderBottomWidth: 0 },
  toggleInfo: { flex: 1, gap: 2 },
  submitBtn: {
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 6,
  },
  // Photo
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'center', marginTop: 4 },
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
  photoThumb: { width: '100%', height: '100%' },
  photoEditOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 30,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
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
  photoAddTxt: { fontSize: 14, fontWeight: '700', color: '#6366F1' },
  menuOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  photoMenu: {
    backgroundColor: Colors.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 48,
    gap: 4,
  },
  photoMenuTitle: { fontSize: 16, fontWeight: '800', color: '#1E293B', marginBottom: 12 },
  photoMenuItem: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 10 },
  photoMenuIcon: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  photoMenuLabel: { flex: 1, fontSize: 14, fontWeight: '700', color: '#1E293B' },
  menuSep: { height: 1, backgroundColor: '#F1F5F9', marginVertical: 4 },
  // Section label row
  sectionLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  sectionRequired: { fontSize: 11, color: Colors.error, fontWeight: '600' },
  cardError: { borderWidth: 1.5, borderColor: Colors.error },
  locationErrorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.errorLight,
    borderRadius: 8,
    padding: 10,
    gap: 6,
    marginBottom: 10,
  },
  locationErrorText: { flex: 1, fontSize: 12, color: Colors.error },
  // Location inline form
  plForm: {
    backgroundColor: Colors.background,
    borderRadius: 10,
    padding: 12,
    marginTop: 8,
    marginBottom: 4,
    gap: 4,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  plFormErrorBox: {
    backgroundColor: Colors.errorLight,
    borderRadius: 6,
    padding: 8,
    marginBottom: 6,
  },
  plLockedRow: { gap: 2, marginBottom: 8 },
  addLocRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
  },
  addLocBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primary,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    gap: 6,
  },
  addLocBtnFlex: { flex: 1 },
  addLocBtnText: { fontSize: 13, fontWeight: '700', color: '#fff' },
  cancelLocBtn: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: Colors.border,
  },
  cancelLocBtnText: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary },
  // Product Locations
  plEmpty: { alignItems: 'center', paddingVertical: 16, gap: 6 },
  plRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.divider,
    gap: 10,
  },
  plCodeBadge: {
    backgroundColor: Colors.primaryMuted,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  plCodeText: { fontSize: 11, color: Colors.primary, fontWeight: '700', letterSpacing: 0.5 },
  plInfo: { flex: 1, gap: 2 },
  plBin: { fontWeight: '600' },
  plAction: { padding: 4 },
});

export default ProductFormScreen;
