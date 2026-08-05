import React, { useState } from 'react';
import { View, ScrollView, StyleSheet, Switch } from 'react-native';
import Colors from '../../theme/colors';
import AppText from '../../components/AppText';
import AppInput from '../../components/AppInput';
import AppButton from '../../components/AppButton';
import AppBar from '../../components/AppBar';
import { createLocationApi, updateLocationApi, ApiLocation } from '../../services/focusApi';
import { useAlert } from '../../components/AppAlert';

interface Props {
  location?: ApiLocation;
  onBack: () => void;
  onSaved: () => void;
}

const LocationFormScreen: React.FC<Props> = ({ location, onBack, onSaved }) => {
  const { showAlert } = useAlert();
  const isEdit = !!location;

  const [nameEn, setNameEn] = useState(location?.nameEn ?? '');
  const [nameKm, setNameKm] = useState(location?.nameKm ?? '');
  const [code, setCode] = useState(location?.code ?? '');
  const [address, setAddress] = useState(location?.address ?? '');
  const [active, setActive] = useState(location?.active !== false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    if (!nameEn.trim()) e.nameEn = 'English name is required';
    if (!nameKm.trim()) e.nameKm = 'Khmer name is required';
    if (!code.trim()) {
      e.code = 'Location code is required';
    } else if (!/^[A-Z0-9]{2,10}$/.test(code.trim())) {
      e.code = 'Code must be 2–10 uppercase letters/numbers';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const doSave = async () => {
    setApiError(null);
    setLoading(true);
    try {
      const payload = {
        nameEn: nameEn.trim(),
        nameKm: nameKm.trim(),
        code: code.trim(),
        address: address.trim() || null,
        active,
      };
      if (isEdit) {
        await updateLocationApi(String(location!.id), payload);
      } else {
        await createLocationApi(payload);
      }
      onSaved();
    } catch (err: any) {
      setApiError(err?.message ?? `Failed to ${isEdit ? 'update' : 'create'} location`);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = () => {
    if (!validate()) return;
    showAlert({
      type: 'confirm',
      title: isEdit ? 'Save Changes' : 'Create Location',
      message: isEdit
        ? `Save changes to "${nameEn.trim() || nameKm.trim()}"?`
        : `Create location "${nameEn.trim() || nameKm.trim()}"?`,
      actions: [
        { label: 'Cancel', variant: 'outline' },
        { label: isEdit ? 'Save' : 'Create', variant: 'primary', onPress: doSave },
      ],
    });
  };

  return (
    <View style={styles.safe}>
      <AppBar
        title={isEdit ? 'Edit Location' : 'New Location'}
        subtitle={isEdit ? `Code: ${location!.code}` : 'Add a new location'}
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
          <AppText style={styles.sectionLabel}>Location Details</AppText>

          <AppInput
            label="Location Code *"
            value={code}
            onChangeText={v => setCode(v.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
            placeholder="e.g. MAIN"
            autoCapitalize="none"
            maxLength={10}
            error={errors.code}
            hint="2–10 uppercase letters/numbers only"
          />

          <AppInput
            label="English Name *"
            value={nameEn}
            onChangeText={setNameEn}
            placeholder="e.g. Main Branch"
            error={errors.nameEn}
          />

          <AppInput
            label="Khmer Name *"
            value={nameKm}
            onChangeText={setNameKm}
            placeholder="e.g. សាខាមេ"
            error={errors.nameKm}
          />

          <AppInput
            label="Address (optional)"
            value={address}
            onChangeText={setAddress}
            placeholder="e.g. Phnom Penh, Cambodia"
          />

          <View style={styles.toggleRow}>
            <View style={styles.toggleInfo}>
              <AppText variant="body">Active</AppText>
              <AppText variant="caption" color="textSecondary">Inactive locations won't appear in POS</AppText>
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
          label={isEdit ? 'Save Changes' : 'Create Location'}
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
    paddingTop: 8,
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

export default LocationFormScreen;
