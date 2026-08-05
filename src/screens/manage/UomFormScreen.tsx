import React, { useState } from 'react';
import { View, ScrollView, StyleSheet, Switch } from 'react-native';
import Colors from '../../theme/colors';
import AppText from '../../components/AppText';
import AppInput from '../../components/AppInput';
import AppButton from '../../components/AppButton';
import AppBar from '../../components/AppBar';
import { useAlert } from '../../components/AppAlert';
import { createUomApi, updateUomApi, ApiUom } from '../../services/focusApi';

interface Props {
  uom?: ApiUom;
  onBack: () => void;
  onSaved: () => void;
}

const UomFormScreen: React.FC<Props> = ({ uom, onBack, onSaved }) => {
  const { showAlert } = useAlert();
  const isEdit = !!uom;

  const [code, setCode] = useState(uom?.code ?? '');
  const [nameEn, setNameEn] = useState(uom?.nameEn ?? '');
  const [nameKm, setNameKm] = useState(uom?.nameKm ?? '');
  const [factor, setFactor] = useState(uom?.factor != null ? String(uom.factor) : '');
  const [active, setActive] = useState(uom?.active !== false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    if (!code.trim()) {
      e.code = 'UOM code is required';
    } else if (!/^[A-Z0-9/_-]{1,10}$/.test(code.trim())) {
      e.code = 'Code must be 1–10 uppercase letters, numbers, /, _ or -';
    }
    if (!nameEn.trim()) e.nameEn = 'English name is required';
    if (!nameKm.trim()) e.nameKm = 'Khmer name is required';
    if (factor.trim()) {
      const f = parseFloat(factor);
      if (isNaN(f) || f <= 0) e.factor = 'Factor must be a positive number';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const doSave = async () => {
    setApiError(null);
    setLoading(true);
    try {
      const payload = {
        code: code.trim(),
        nameEn: nameEn.trim(),
        nameKm: nameKm.trim(),
        factor: factor.trim() ? parseFloat(factor) : undefined,
        active,
      };
      if (isEdit) {
        await updateUomApi(uom!.id, payload);
      } else {
        await createUomApi(payload);
      }
      onSaved();
    } catch (err: any) {
      if (err?.response?.status === 409) {
        setApiError(`UOM code "${code.trim()}" already exists. Please use a different code.`);
      } else {
        setApiError(err?.response?.data?.error?.messageKey ?? err?.message ?? `Failed to ${isEdit ? 'update' : 'create'} UOM`);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSave = () => {
    if (!validate()) return;
    const displayName = nameEn.trim() || nameKm.trim() || code.trim();
    showAlert({
      type: 'confirm',
      title: isEdit ? 'Save Changes' : 'Create UOM',
      message: isEdit
        ? `Save changes to "${displayName}"?`
        : `Create unit of measure "${displayName}"?`,
      actions: [
        { label: 'Cancel', variant: 'outline' },
        { label: isEdit ? 'Save' : 'Create', variant: 'primary', onPress: doSave },
      ],
    });
  };

  return (
    <View style={styles.safe}>
      <AppBar
        title={isEdit ? 'Edit UOM' : 'New UOM'}
        subtitle={isEdit ? `Code: ${uom!.code}` : 'Add a unit of measure'}
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
            <AppText variant="caption" color="error">{apiError}</AppText>
          </View>
        ) : null}

        <View style={styles.card}>
          <AppText style={styles.sectionLabel}>Unit Details</AppText>

          <AppInput
            label="UOM Code *"
            value={code}
            onChangeText={v => setCode(v.toUpperCase().replace(/[^A-Z0-9/_-]/g, ''))}
            placeholder="e.g. KG, PCS, L, M²"
            autoCapitalize="none"
            maxLength={10}
            error={errors.code}
            hint="Short code used in orders (e.g. KG, PCS, L)"
          />

          <AppInput
            label="English Name"
            value={nameEn}
            onChangeText={setNameEn}
            placeholder="e.g. Kilogram"
            error={errors.nameEn}
          />

          <AppInput
            label="Khmer Name *"
            value={nameKm}
            onChangeText={setNameKm}
            placeholder="e.g. គីឡូក្រាម"
            error={errors.nameKm}
          />

          <AppInput
            label="Factor"
            value={factor}
            onChangeText={v => setFactor(v.replace(/[^0-9.]/g, ''))}
            placeholder="e.g. 1, 1000, 0.001"
            keyboardType="decimal-pad"
            error={errors.factor}
            hint="Conversion factor relative to base unit (optional)"
          />
        </View>

        <View style={styles.card}>
          <View style={styles.toggleRow}>
            <View style={styles.toggleInfo}>
              <AppText variant="body">Active</AppText>
              <AppText variant="caption" color="textSecondary">Inactive UOMs won't appear in new orders</AppText>
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
          label={isEdit ? 'Save Changes' : 'Create UOM'}
          onPress={handleSave}
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
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: 16, gap: 16, paddingBottom: 32 },
  errorBanner: {
    backgroundColor: Colors.errorLight,
    borderRadius: 10,
    padding: 12,
    borderLeftWidth: 3,
    borderLeftColor: Colors.error,
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
    gap: 4,
  },
  sectionLabel: {
    marginBottom: 12,
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    fontSize: 11,
    letterSpacing: 0.8,
    fontWeight: '600',
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  toggleInfo: { flex: 1, gap: 2 },
  submitBtn: {
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 6,
  },
});

export default UomFormScreen;
