import React, { useState } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import Colors from '../../theme/colors';
import AppText from '../../components/AppText';
import AppInput from '../../components/AppInput';
import AppButton from '../../components/AppButton';
import AppBar from '../../components/AppBar';
import { createUserApi, UserRole, UserLang } from '../../services/focusApi';

interface Props {
  onBack: () => void;
  onSaved: () => void;
}

const ROLES: { value: UserRole; label: string }[] = [
  { value: 'OWNER',     label: 'Owner' },
  { value: 'MANAGER',   label: 'Manager' },
  { value: 'STAFF',     label: 'Staff' },
  { value: 'CASHIER',   label: 'Cashier' },
  { value: 'REQUESTER', label: 'Requester' },
  { value: 'APPROVER',  label: 'Approver' },
];

const LANGS: { value: UserLang; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'km', label: 'Khmer' },
];

const CreateUserScreen: React.FC<Props> = ({ onBack, onSaved }) => {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>('STAFF');
  const [lang, setLang] = useState<UserLang>('en');

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = 'Name is required';
    if (!email.trim()) e.email = 'Email is required';
    else if (!/\S+@\S+\.\S+/.test(email)) e.email = 'Enter a valid email';
    if (!password) e.password = 'Password is required';
    else if (password.length < 8) e.password = 'Minimum 8 characters';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;
    setSubmitting(true);
    setApiError(null);
    try {
      await createUserApi({
        name: name.trim(),
        email: email.trim().toLowerCase(),
        password,
        role,
        lang,
      });
      onSaved();
    } catch (err: any) {
      setApiError(err?.message ?? 'Failed to create user');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.root}>
      <AppBar
        title="Create User"
        subtitle="Add a new team member"
        titleAlign="left"
        showBack
        onBack={onBack}
      />

      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* API error */}
        {apiError && (
          <View style={styles.errorBanner}>
            <AppText style={styles.errorBannerText}>{apiError}</AppText>
            <TouchableOpacity onPress={() => setApiError(null)}>
              <AppText style={styles.errorBannerClose}>✕</AppText>
            </TouchableOpacity>
          </View>
        )}

        {/* User details */}
        <View style={styles.card}>
          <AppText style={styles.sectionLabel}>User Details</AppText>

          <AppInput
            label="Full Name *"
            value={name}
            onChangeText={setName}
            placeholder="e.g. Sopheap Chan"
            error={errors.name}
          />

          <AppInput
            label="Email *"
            value={email}
            onChangeText={setEmail}
            placeholder="user@company.com"
            keyboardType="email-address"
            autoCapitalize="none"
            error={errors.email}
          />

          <AppInput
            label="Password *"
            value={password}
            onChangeText={setPassword}
            placeholder="Min. 8 characters"
            secureTextEntry
            secureToggle
            error={errors.password}
          />
        </View>

        {/* Role & Language */}
        <View style={styles.card}>
          <AppText style={styles.sectionLabel}>Role & Language</AppText>

          <AppText style={styles.fieldLabel}>Role *</AppText>
          <View style={styles.chipRow}>
            {ROLES.map(r => (
              <TouchableOpacity
                key={r.value}
                style={[styles.chip, role === r.value && styles.chipActive]}
                onPress={() => setRole(r.value)}
                activeOpacity={0.7}
              >
                <AppText style={[styles.chipText, role === r.value && styles.chipTextActive]}>
                  {r.label}
                </AppText>
              </TouchableOpacity>
            ))}
          </View>

          <AppText style={[styles.fieldLabel, styles.fieldLabelTop]}>Language *</AppText>
          <View style={styles.segmentRow}>
            {LANGS.map(l => (
              <TouchableOpacity
                key={l.value}
                style={[styles.segment, lang === l.value && styles.segmentActive]}
                onPress={() => setLang(l.value)}
                activeOpacity={0.7}
              >
                <AppText style={[styles.segmentText, lang === l.value && styles.segmentTextActive]}>
                  {l.label}
                </AppText>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <AppButton
          label={submitting ? 'Creating…' : 'Create User'}
          onPress={handleSubmit}
          disabled={submitting}
          fullWidth
          size="lg"
          style={styles.submitBtn}
        />
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scroll: {
    padding: 16,
    gap: 16,
    paddingBottom: 32,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.errorLight,
    borderRadius: 10,
    padding: 12,
    borderLeftWidth: 3,
    borderLeftColor: Colors.error,
    gap: 10,
  },
  errorBannerText: {
    flex: 1,
    color: Colors.error,
    fontSize: 14,
  },
  errorBannerClose: {
    color: Colors.error,
    fontSize: 16,
    fontWeight: '600',
    padding: 4,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  sectionLabel: {
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    fontSize: 11,
    letterSpacing: 0.8,
    fontWeight: '600',
    marginBottom: 4,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.text,
    marginBottom: 6,
  },
  fieldLabelTop: {
    marginTop: 4,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  chipActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primaryMuted,
  },
  chipText: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontWeight: '500',
  },
  chipTextActive: {
    color: Colors.primary,
    fontWeight: '700',
  },
  segmentRow: {
    flexDirection: 'row',
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: Colors.border,
    overflow: 'hidden',
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
  submitBtn: {
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 6,
  },
});

export default CreateUserScreen;
