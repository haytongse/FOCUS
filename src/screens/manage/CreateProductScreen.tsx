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
} from 'react-native';
import { MaterialIcons as Icon } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
type Asset = ImagePicker.ImagePickerAsset;
import Colors from '../../theme/colors';
import AppText from '../../components/AppText';
import AppInput from '../../components/AppInput';
import AppButton from '../../components/AppButton';
import AppBar from '../../components/AppBar';
import {
  createProductApi, uploadProductImageApi,
  getCategoriesApi, ApiCategory,
  getVendorsApi, ApiVendor,
  getUomsApi, ApiUom,
} from '../../services/focusApi';

interface Props {
  onBack: () => void;
}

type PricingMode = 'FIXED' | 'RFQ';

const CreateProductScreen: React.FC<Props> = ({ onBack }) => {
  const [sku, setSku] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [nameKm, setNameKm] = useState('');
  const [pricingMode, setPricingMode] = useState<PricingMode>('FIXED');
  const [price, setPrice] = useState('');
  const [categoryId, setCategoryId] = useState<string>('');
  const [vendorId, setVendorId] = useState<number | null>(null);
  const [uomId, setUomId] = useState<number | null>(null);
  const [isRentalItem, setIsRentalItem] = useState(false);
  const [active, setActive] = useState(true);

  const [categories, setCategories] = useState<ApiCategory[]>([]);
  const [catLoading, setCatLoading] = useState(true);
  const [showCatPicker, setShowCatPicker] = useState(false);

  const [vendors, setVendors] = useState<ApiVendor[]>([]);
  const [vendorLoading, setVendorLoading] = useState(true);
  const [showVendorPicker, setShowVendorPicker] = useState(false);

  const [uoms, setUoms] = useState<ApiUom[]>([]);
  const [uomLoading, setUomLoading] = useState(true);
  const [showUomPicker, setShowUomPicker] = useState(false);

  const [imageAsset, setImageAsset] = useState<Asset | null>(null);
  const [showPhotoMenu, setShowPhotoMenu] = useState(false);

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  useEffect(() => {
    getCategoriesApi()
      .then(cats => setCategories(cats))
      .catch(() => {})
      .finally(() => setCatLoading(false));
    getVendorsApi()
      .then(v => setVendors(v))
      .catch(() => {})
      .finally(() => setVendorLoading(false));
    getUomsApi()
      .then(u => setUoms(u))
      .catch(() => {})
      .finally(() => setUomLoading(false));
  }, []);

  const selectedCat = categories.find(c => c.id === categoryId);
  const selectedVendor = vendors.find(v => v.id === vendorId);
  const selectedUom = uoms.find(u => u.id === uomId);

  const handleTakePhoto = () => {
    setShowPhotoMenu(false);
    setTimeout(async () => {
      const res = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8 });
      if (!res.canceled) setImageAsset(res.assets[0]);
    }, 300);
  };

  const handleGallery = () => {
    setShowPhotoMenu(false);
    setTimeout(async () => {
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
      if (!res.canceled) setImageAsset(res.assets[0]);
    }, 300);
  };

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    const skuTrimmed = sku.trim().toUpperCase();
    if (!skuTrimmed) {
      e.sku = 'SKU is required';
    } else if (!/^[A-Z0-9]{2,32}$/.test(skuTrimmed)) {
      e.sku = 'SKU must be 2–32 uppercase letters/numbers only';
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
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;
    setApiError(null);
    setLoading(true);
    try {
      const skuUpper = sku.trim().toUpperCase();
      const fixedPriceCents =
        pricingMode === 'FIXED' ? String(Math.round(Number(price) * 100)) : undefined;

      const created = await createProductApi({
        sku: skuUpper,
        nameEn: nameEn.trim(),
        nameKm: nameKm.trim(),
        pricingMode,
        fixedPriceCents,
        categoryId: categoryId || null,
        vendorId: vendorId ?? null,
        uomId: uomId ?? null,
        unit: selectedUom?.code ?? '',
        isRentalItem,
        active,
      });

      if (imageAsset?.uri && created?.id) {
        await uploadProductImageApi(created.id, imageAsset);
      }

      setSuccess(true);
      setSku('');
      setNameEn('');
      setNameKm('');
      setPrice('');
      setCategoryId('');
      setVendorId(null);
      setUomId(null);
      setIsRentalItem(false);
      setActive(true);
      setPricingMode('FIXED');
      setImageAsset(null);
    } catch (err: any) {
      setApiError(err?.message ?? 'Failed to create product');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.safe}>
      <AppBar
        title="Create Product"
        subtitle="Add a new product to the catalog"
        titleAlign="left"
        showBack
        onBack={onBack}
      />

      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {success && (
          <View style={styles.successBanner}>
            <Icon name="check-circle" size={18} color={Colors.success} />
            <AppText variant="caption" color="success" style={styles.bannerText}>
              Product created successfully!
            </AppText>
          </View>
        )}

        {apiError && (
          <View style={styles.errorBanner}>
            <Icon name="error" size={18} color={Colors.error} />
            <AppText variant="caption" color="error" style={styles.bannerText}>
              {apiError}
            </AppText>
          </View>
        )}

        {/* Product Image */}
        <View style={styles.card}>
          <AppText style={styles.sectionLabel}>Product Image</AppText>
          <View style={styles.photoGrid}>
            {imageAsset?.uri && (
              <View style={styles.photoThumbWrap}>
                <Image source={{ uri: imageAsset.uri }} style={styles.photoThumb} resizeMode="cover" />
                <TouchableOpacity
                  style={styles.photoRemoveBtn}
                  onPress={() => setImageAsset(null)}
                  hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                >
                  <Icon name="cancel" size={20} color="#EF4444" />
                </TouchableOpacity>
              </View>
            )}
            {!imageAsset?.uri && (
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

          <AppInput
            label="SKU *"
            value={sku}
            onChangeText={v => setSku(v.toUpperCase())}
            placeholder="e.g. BEVWATER500"
            autoCapitalize="characters"
            error={errors.sku}
            hint="Uppercase letters and numbers only, 2–32 chars"
          />

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
              onChangeText={setPrice}
              placeholder="0.00"
              keyboardType="decimal-pad"
              error={errors.price}
            />
          )}

          {pricingMode === 'RFQ' && (
            <View style={styles.infoBox}>
              <Icon name="info" size={16} color={Colors.info} />
              <AppText variant="caption" color="textSecondary" style={styles.infoText}>
                Price will be negotiated per order for RFQ items.
              </AppText>
            </View>
          )}
        </View>

        {/* Category / Vendor / UOM */}
        <View style={styles.card}>
          <AppText style={styles.sectionLabel}>Classification</AppText>

          {/* Category */}
          <AppText variant="label" style={styles.fieldLabel}>Category (optional)</AppText>
          {catLoading ? (
            <ActivityIndicator size="small" color={Colors.primary} style={styles.catLoader} />
          ) : (
            <>
              <TouchableOpacity
                style={styles.picker}
                onPress={() => { setShowCatPicker(v => !v); setShowVendorPicker(false); setShowUomPicker(false); }}
                activeOpacity={0.7}
              >
                <AppText style={categoryId ? styles.pickerValue : styles.pickerPlaceholder}>
                  {selectedCat ? (selectedCat.nameEn || selectedCat.nameKm) : 'Select category…'}
                </AppText>
                <Icon name={showCatPicker ? 'expand-less' : 'expand-more'} size={22} color={Colors.textSecondary} />
              </TouchableOpacity>
              {showCatPicker && (
                <View style={styles.pickerDropdown}>
                  <TouchableOpacity
                    style={styles.pickerOption}
                    onPress={() => { setCategoryId(''); setShowCatPicker(false); }}
                  >
                    <AppText color="textSecondary">— None —</AppText>
                  </TouchableOpacity>
                  {categories.map(cat => (
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
                </View>
              )}
            </>
          )}

          {/* Vendor */}
          <AppText variant="label" style={[styles.fieldLabel, styles.fieldLabelSpaced]}>Vendor *</AppText>
          {vendorLoading ? (
            <ActivityIndicator size="small" color={Colors.primary} style={styles.catLoader} />
          ) : (
            <>
              <TouchableOpacity
                style={[styles.picker, errors.vendor ? styles.pickerError : null]}
                onPress={() => { setShowVendorPicker(v => !v); setShowCatPicker(false); setShowUomPicker(false); }}
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
                  {vendors.map(v => (
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
                </View>
              )}
            </>
          )}

          {/* UOM */}
          <AppText variant="label" style={[styles.fieldLabel, styles.fieldLabelSpaced]}>UOM *</AppText>
          {uomLoading ? (
            <ActivityIndicator size="small" color={Colors.primary} style={styles.catLoader} />
          ) : (
            <>
              <TouchableOpacity
                style={[styles.picker, errors.uom ? styles.pickerError : null]}
                onPress={() => { setShowUomPicker(v => !v); setShowCatPicker(false); setShowVendorPicker(false); }}
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

        {/* Options */}
        <View style={styles.card}>
          <AppText style={styles.sectionLabel}>Options</AppText>

          <View style={styles.toggleRow}>
            <View style={styles.toggleInfo}>
              <AppText variant="body">Rental Item</AppText>
              <AppText variant="caption" color="textSecondary">Mark if this is a rental/loan item</AppText>
            </View>
            <Switch
              value={isRentalItem}
              onValueChange={setIsRentalItem}
              trackColor={{ true: Colors.primary }}
              thumbColor={Colors.white}
            />
          </View>

          <View style={[styles.toggleRow, styles.toggleLast]}>
            <View style={styles.toggleInfo}>
              <AppText variant="body">Active</AppText>
              <AppText variant="caption" color="textSecondary">Inactive products won't appear in POS</AppText>
            </View>
            <Switch
              value={active}
              onValueChange={setActive}
              trackColor={{ true: Colors.primary }}
              thumbColor={Colors.white}
            />
          </View>
        </View>

        <AppButton
          label="Create Product"
          onPress={handleSubmit}
          loading={loading}
          fullWidth
          size="lg"
          style={styles.submitBtn}
        />
      </ScrollView>

      {/* Photo source bottom sheet */}
      <Modal
        visible={showPhotoMenu}
        transparent
        animationType="slide"
        onRequestClose={() => setShowPhotoMenu(false)}
      >
        <TouchableOpacity
          style={styles.menuOverlay}
          activeOpacity={1}
          onPress={() => setShowPhotoMenu(false)}
        >
          <TouchableOpacity activeOpacity={1} style={styles.photoMenu} onPress={() => {}}>
            <AppText style={styles.photoMenuTitle}>Add Product Photo</AppText>

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
    </View>
  );
};

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scroll: {
    padding: 16,
    gap: 16,
    paddingBottom: 32,
  },
  successBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.successLight,
    borderRadius: 10,
    padding: 12,
    borderLeftWidth: 3,
    borderLeftColor: Colors.success,
    gap: 8,
  },
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
  bannerText: {
    flex: 1,
  },
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
  fieldLabel: {
    marginBottom: 6,
    color: Colors.text,
  },
  fieldLabelSpaced: {
    marginTop: 14,
  },
  segmentRow: {
    flexDirection: 'row',
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: Colors.border,
    overflow: 'hidden',
    marginBottom: 16,
  },
  segment: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: Colors.surface,
  },
  segmentActive: {
    backgroundColor: Colors.primary,
  },
  segmentText: {
    fontSize: 14,
    color: Colors.textSecondary,
    fontWeight: '500',
  },
  segmentTextActive: {
    color: Colors.white,
    fontWeight: '700',
  },
  infoBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.infoLight,
    borderRadius: 8,
    padding: 10,
    gap: 8,
  },
  infoText: {
    flex: 1,
  },
  catLoader: {
    marginVertical: 10,
  },
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
  pickerValue: {
    flex: 1,
    fontSize: 14,
    color: Colors.text,
  },
  pickerPlaceholder: {
    flex: 1,
    fontSize: 14,
    color: Colors.textLight,
  },
  pickerError: {
    borderColor: Colors.error,
  },
  pickerErrorText: {
    fontSize: 12,
    color: Colors.error,
    marginTop: 4,
    marginLeft: 2,
  },
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
  pickerOptionActive: {
    backgroundColor: Colors.primaryMuted,
  },
  pickerOptionActiveText: {
    color: Colors.primary,
    fontWeight: '600',
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: 14,
    marginBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.divider,
  },
  toggleLast: {
    paddingBottom: 0,
    marginBottom: 0,
    borderBottomWidth: 0,
  },
  toggleInfo: {
    flex: 1,
    gap: 2,
  },
  submitBtn: {
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 6,
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

export default CreateProductScreen;
