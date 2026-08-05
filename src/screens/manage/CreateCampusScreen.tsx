import React, { useState } from 'react';
import { View, ScrollView, StyleSheet, Switch } from 'react-native';
import Colors from '../../theme/colors';
import AppText from '../../components/AppText';
import AppInput from '../../components/AppInput';
import AppButton from '../../components/AppButton';
import AppBar from '../../components/AppBar';
import { createCampusApi } from '../../services/focusApi';
import { useAlert } from '../../components/AppAlert';

interface Props {
  onBack: () => void;
}

const CreateCampusScreen: React.FC<Props> = ({ onBack }) => {
  const [nameEn, setNameEn] = useState('');
  const [nameKm, setNameKm] = useState('');
  const [code, setCode] = useState('');
  const [address, setAddress] = useState('');
  const [active, setActive] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const { showAlert } = useAlert();

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    if (!nameEn.trim()) e.nameEn = 'English name is required';
    if (!nameKm.trim()) e.nameKm = 'Khmer name is required';
    if (!code.trim()) {
      e.code = 'Campus code is required';
    } else if (!/^[A-Z0-9]{2,10}$/.test(code.trim())) {
      e.code = 'Code must be 2–10 uppercase letters/numbers';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSave = () => {
    if (!validate()) return;
    showAlert({
      type: 'confirm',
      title: 'Create Campus',
      message: `Create campus "${code.trim()}" — ${nameEn.trim()}?`,
      actions: [
        { label: 'Cancel', variant: 'outline' },
        {
          label: 'Create',
          variant: 'primary',
          onPress: async () => {
            setApiError(null);
            setLoading(true);
            try {
              await createCampusApi({
                nameEn: nameEn.trim(),
                nameKm: nameKm.trim(),
                campusCode: code.trim(),
                ...(address.trim() ? { address: address.trim() } : {}),
              });
              setSuccess(true);
              setTimeout(() => onBack(), 800);
            } catch (err: any) {
              setApiError(err?.message ?? 'Failed to create campus');
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
        title="Create Campus"
        subtitle="Add a new campus location"
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
            <AppText variant="caption" color="success">Campus created successfully!</AppText>
          </View>
        )}

        {apiError && (
          <View style={styles.errorBanner}>
            <AppText variant="caption" color="error">{apiError}</AppText>
          </View>
        )}

        <View style={styles.card}>
          <AppText style={styles.sectionLabel}>Campus Details</AppText>

          <AppInput
            label="English Name *"
            value={nameEn}
            onChangeText={setNameEn}
            placeholder="e.g. Main Campus"
            error={errors.nameEn}
          />

          <AppInput
            label="Khmer Name *"
            value={nameKm}
            onChangeText={setNameKm}
            placeholder="e.g. បណ្ឌិត្យសភា"
            error={errors.nameKm}
          />

          <AppInput
            label="Campus Code *"
            value={code}
            onChangeText={v => setCode(v.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
            placeholder="e.g. MAIN"
            autoCapitalize="none"
            maxLength={10}
            error={errors.code}
            hint="2–10 uppercase letters/numbers only"
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
              <AppText variant="caption" color="textSecondary">Inactive campuses won't appear in POS</AppText>
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
          label="Create Campus"
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
  successBanner: {
    backgroundColor: Colors.successLight,
    borderRadius: 10,
    padding: 12,
    borderLeftWidth: 3,
    borderLeftColor: Colors.success,
  },
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

export default CreateCampusScreen;
