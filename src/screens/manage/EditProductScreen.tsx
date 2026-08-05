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
import { updateProductApi, uploadProductImageApi, getCategoriesApi, ApiCategory, ApiProduct } from '../../services/focusApi';

interface Props {
  product: ApiProduct;
  onBack: () => void;
  onSaved: () => void;
}

type PricingMode = 'FIXED' | 'RFQ';

const EditProductScreen: React.FC<Props> = ({ product, onBack, onSaved }) => {
  const [nameEn, setNameEn] = useState(product.nameEn);
  const [nameKm, setNameKm] = useState(product.nameKm);
  const [pricingMode, setPricingMode] = useState<PricingMode>(product.pricingMode);
  const [price, setPrice] = useState(
    product.fixedPriceCents ? String(parseInt(product.fixedPriceCents, 10) / 100) : '',
  );
  const [unit, setUnit] = useState(product.unit);
  const [categoryId, setCategoryId] = useState<string>(product.categoryId ?? '');
  const [isRentalItem, setIsRentalItem] = useState(product.isRentalItem);
  const [active, setActive] = useState(product.active);

  const [categories, setCategories] = useState<ApiCategory[]>([]);
  const [catLoading, setCatLoading] = useState(true);
  const [showCatPicker, setShowCatPicker] = useState(false);

  // Image: start with existing URL, allow replacing with new asset
  const [existingImageUrl, setExistingImageUrl] = useState<string | null>(product.primaryImageUrl);
  const [newImageAsset, setNewImageAsset] = useState<Asset | null>(null);
  const [showPhotoMenu, setShowPhotoMenu] = useState(false);

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  useEffect(() => {
    getCategoriesApi()
      .then(cats => setCategories(cats))
      .catch(() => {})
      .finally(() => setCatLoading(false));
  }, []);

  const selectedCat = categories.find(c => c.id === categoryId);
  const displayImageUri = newImageAsset?.uri ?? existingImageUrl ?? null;

  const handleTakePhoto = () => {
    setShowPhotoMenu(false);
    setTimeout(async () => {
      const res = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8 });
      if (!res.canceled) {
        setNewImageAsset(res.assets[0]);
        setExistingImageUrl(null);
      }
    }, 300);
  };

  const handleGallery = () => {
    setShowPhotoMenu(false);
    setTimeout(async () => {
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
      if (!res.canceled) {
        setNewImageAsset(res.assets[0]);
        setExistingImageUrl(null);
      }
    }, 300);
  };

  const removeImage = () => {
    setNewImageAsset(null);
    setExistingImageUrl(null);
  };

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    if (!nameEn.trim()) e.nameEn = 'English name is required';
    if (!nameKm.trim()) e.nameKm = 'Khmer name is required';
    if (!unit.trim()) e.unit = 'Unit is required';
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
      const fixedPriceCents =
        pricingMode === 'FIXED' ? String(Math.round(Number(price) * 100)) : null;

      await updateProductApi(product.id, {
        nameEn: nameEn.trim(),
        nameKm: nameKm.trim(),
        pricingMode,
        fixedPriceCents,
        categoryId: categoryId || null,
        unit: unit.trim(),
        isRentalItem,
        active,
        // only send primaryImageUrl when not uploading a new file
        ...(newImageAsset ? {} : { primaryImageUrl: existingImageUrl }),
      });

      if (newImageAsset?.uri) {
        await uploadProductImageApi(product.id, newImageAsset);
      }

      onSaved();
    } catch (err: any) {
      setApiError(err?.message ?? 'Failed to update product');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.safe}>
      <AppBar
        title="Edit Product"
        subtitle={`SKU: ${product.sku}`}
        titleAlign="left"
        showBack
        onBack={onBack}
      />

      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
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
            {displayImageUri ? (
              <View style={styles.photoThumbWrap}>
                <Image source={{ uri: displayImageUri }} style={styles.photoThumb} resizeMode="cover" />
                <TouchableOpacity
                  style={styles.photoRemoveBtn}
                  onPress={removeImage}
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

          <View style={styles.skuRow}>
            <AppText variant="caption" color="textSecondary">SKU</AppText>
            <View style={styles.skuBadge}>
              <AppText style={styles.skuText}>{product.sku}</AppText>
            </View>
          </View>

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
            label="Unit *"
            value={unit}
            onChangeText={setUnit}
            placeholder="e.g. bottle, kg, pcs"
            error={errors.unit}
          />

          <AppInput
            label="Cost (USD)"
            value={product.costPriceCents ? String(parseInt(product.costPriceCents, 10) / 100) : '—'}
            onChangeText={() => {}}
            editable={false}
          />

          <AppInput
            label="On Hand"
            value={String(product.qtyOnHand)}
            onChangeText={() => {}}
            editable={false}
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

        {/* Category */}
        <View style={styles.card}>
          <AppText style={styles.sectionLabel}>Category</AppText>

          <AppText variant="label" style={styles.fieldLabel}>Category (optional)</AppText>
          {catLoading ? (
            <ActivityIndicator size="small" color={Colors.primary} style={styles.catLoader} />
          ) : (
            <>
              <TouchableOpacity
                style={styles.picker}
                onPress={() => setShowCatPicker(v => !v)}
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
          label="Save Changes"
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
            <AppText style={styles.photoMenuTitle}>Change Product Photo</AppText>

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
  skuBadge: {
    backgroundColor: Colors.divider,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  skuText: { fontSize: 13, fontWeight: '700', color: Colors.text, letterSpacing: 0.5 },
  fieldLabel: { marginBottom: 6, color: Colors.text },
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
  catLoader: { marginVertical: 10 },
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
});

export default EditProductScreen;
