import React, { useState } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { MaterialIcons as Icon } from '@expo/vector-icons';
import Colors from '../../theme/colors';
import AppText from '../../components/AppText';
import AppInput from '../../components/AppInput';
import AppButton from '../../components/AppButton';
import AppBar from '../../components/AppBar';
import { useAlert } from '../../components/AppAlert';
import { createCategoryApi } from '../../services/focusApi';

interface Props {
  onBack: () => void;
}

const CreateCategoryScreen: React.FC<Props> = ({ onBack }) => {
  const { showAlert } = useAlert();
  const [nameEn, setNameEn] = useState('');
  const [nameKm, setNameKm] = useState('');
  const [sort, setSort] = useState('');

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    if (!nameEn.trim()) e.nameEn = 'English name is required';
    if (!nameKm.trim()) e.nameKm = 'Khmer name is required';
    if (sort && isNaN(Number(sort))) e.sort = 'Sort must be a number';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;

    showAlert({
      type: 'confirm',
      title: 'Create Category',
      message: `Save "${nameEn.trim()}" as a new category?`,
      actions: [
        { label: 'Cancel', variant: 'outline' },
        {
          label: 'Save',
          variant: 'primary',
          onPress: async () => {
            setApiError(null);
            setLoading(true);
            try {
              await createCategoryApi({
                nameEn: nameEn.trim(),
                nameKm: nameKm.trim(),
                sort: sort ? Number(sort) : undefined,
              });
              setSuccess(true);
              setNameEn('');
              setNameKm('');
              setSort('');
            } catch (err: any) {
              setApiError(err?.message ?? 'Failed to create category');
            } finally {
              setLoading(false);
            }
          },
        },
      ],
    });
  };

  return (
    <View style={styles.safe}>
      <AppBar
        title="Create Category"
        subtitle="Add a new product category"
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
              Category created successfully!
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

        <View style={styles.card}>
          <AppText variant="label" style={styles.sectionLabel}>Category Details</AppText>

          <AppInput
            label="English Name *"
            value={nameEn}
            onChangeText={setNameEn}
            placeholder="e.g. Beverages"
            error={errors.nameEn}
          />

          <AppInput
            label="Khmer Name *"
            value={nameKm}
            onChangeText={setNameKm}
            placeholder="e.g. ភេសជ្ជៈ"
            error={errors.nameKm}
          />

          <AppInput
            label="Sort Order"
            value={sort}
            onChangeText={setSort}
            placeholder="e.g. 10"
            keyboardType="numeric"
            error={errors.sort}
            hint="Lower numbers appear first"
          />
        </View>

        <AppButton
          label="Create Category"
          onPress={handleSubmit}
          loading={loading}
          fullWidth
          size="lg"
          style={styles.submitBtn}
        />
      </ScrollView>
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
  },
  submitBtn: {
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 6,
  },
});

export default CreateCategoryScreen;
