import React, { useState } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import Colors from '../../theme/colors';
import AppText from '../../components/AppText';
import AppInput from '../../components/AppInput';
import AppButton from '../../components/AppButton';
import AppBar from '../../components/AppBar';
import { ApiUser, updateUserApi, deleteUserApi, disableUserApi, enableUserApi, UserRole, UserLang } from '../../services/focusApi';

interface Props {
  user: ApiUser;
  onBack: () => void;
  onSaved: () => void;
  onDeleted: () => void;
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

const toUserRole = (r: string): UserRole => {
  const upper = r?.toUpperCase() as UserRole;
  return ROLES.some(x => x.value === upper) ? upper : 'STAFF';
};

const EditUserScreen: React.FC<Props> = ({ user, onBack, onSaved, onDeleted }) => {
  const [name, setName] = useState(user.name);
  const [role, setRole] = useState<UserRole>(toUserRole(user.role));
  const [lang, setLang] = useState<UserLang>((user.lang as UserLang) ?? 'en');
  const [active, setActive] = useState(user.active);
  const [newPassword, setNewPassword] = useState('');
  const [changePassword, setChangePassword] = useState(false);

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = 'Name is required';
    if (changePassword && newPassword && newPassword.length < 8) {
      e.password = 'Minimum 8 characters';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSave = async () => {
    if (!validate()) return;
    setSubmitting(true);
    setApiError(null);
    try {
      const patch: Parameters<typeof updateUserApi>[1] = { name: name.trim(), role, lang };
      if (changePassword && newPassword) patch.password = newPassword;
      await updateUserApi(user.id, patch);
      onSaved();
    } catch (err: any) {
      setApiError(err?.message ?? 'Failed to update user');
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleActive = async () => {
    setToggling(true);
    setApiError(null);
    try {
      if (active) {
        await disableUserApi(user.id);
        setActive(false);
      } else {
        await enableUserApi(user.id);
        setActive(true);
      }
    } catch (err: any) {
      setApiError(err?.message ?? 'Failed to update user status');
    } finally {
      setToggling(false);
    }
  };

  const handleDelete = () => {
    Alert.alert(
      'Delete User',
      `Remove "${user.name}" from your organisation? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setDeleting(true);
            try {
              await deleteUserApi(user.id);
              onDeleted();
            } catch (err: any) {
              setApiError(err?.message ?? 'Failed to delete user');
              setDeleting(false);
            }
          },
        },
      ]
    );
  };

  return (
    <View style={styles.root}>
      <AppBar
        title="Edit User"
        subtitle={user.email}
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

        {/* Basic info */}
        <View style={styles.card}>
          <AppText style={styles.sectionLabel}>Basic Info</AppText>

          <AppInput
            label="Full Name *"
            value={name}
            onChangeText={setName}
            placeholder="e.g. Sopheap Chan"
            error={errors.name}
          />

          <View style={styles.readOnlyRow}>
            <AppText style={styles.readOnlyLabel}>Email</AppText>
            <AppText style={styles.readOnlyValue}>{user.email}</AppText>
          </View>
        </View>

        {/* Role & Language */}
        <View style={styles.card}>
          <AppText style={styles.sectionLabel}>Role & Language</AppText>

          <AppText style={styles.fieldLabel}>Role</AppText>
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

          <AppText style={[styles.fieldLabel, styles.fieldLabelTop]}>Language</AppText>
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

        {/* Status */}
        <View style={styles.card}>
          <AppText style={styles.sectionLabel}>Status</AppText>
          <View style={styles.statusRow}>
            <View style={styles.switchInfo}>
              <View style={styles.statusBadgeRow}>
                <View style={[styles.statusDot, { backgroundColor: active ? '#4ADE80' : Colors.border }]} />
                <AppText style={[styles.switchLabel, { color: active ? '#059669' : Colors.textSecondary }]}>
                  {active ? 'Active' : 'Disabled'}
                </AppText>
              </View>
              <AppText style={styles.switchHint}>
                {active ? 'User can log in to the system' : 'Login is blocked for this user'}
              </AppText>
            </View>
            <TouchableOpacity
              style={[styles.toggleBtn, active ? styles.toggleBtnDisable : styles.toggleBtnEnable, toggling && styles.toggleBtnDis]}
              onPress={handleToggleActive}
              disabled={toggling || submitting || deleting}
              activeOpacity={0.8}
            >
              {toggling
                ? <ActivityIndicator size="small" color="#FFF" />
                : <AppText style={styles.toggleBtnTxt}>{active ? 'Disable' : 'Enable'}</AppText>
              }
            </TouchableOpacity>
          </View>
        </View>

        {/* Change password */}
        <View style={styles.card}>
          <AppText style={styles.sectionLabel}>Password</AppText>
          <TouchableOpacity
            style={styles.switchRow}
            onPress={() => {
              setChangePassword(v => !v);
              setNewPassword('');
            }}
            activeOpacity={0.7}
          >
            <View style={styles.switchInfo}>
              <AppText style={styles.switchLabel}>Change Password</AppText>
              <AppText style={styles.switchHint}>Set a new password for this user</AppText>
            </View>
            <View style={[styles.toggleChip, changePassword && styles.toggleChipOn]}>
              <AppText style={[styles.toggleChipTxt, changePassword && styles.toggleChipTxtOn]}>
                {changePassword ? 'ON' : 'OFF'}
              </AppText>
            </View>
          </TouchableOpacity>
          {changePassword && (
            <AppInput
              label="New Password"
              value={newPassword}
              onChangeText={setNewPassword}
              placeholder="Min. 8 characters"
              secureTextEntry
              secureToggle
              error={errors.password}
            />
          )}
        </View>

        <AppButton
          label={submitting ? 'Saving…' : 'Save Changes'}
          onPress={handleSave}
          disabled={submitting || deleting}
          fullWidth
          size="lg"
          style={styles.saveBtn}
        />

        {/* Delete */}
        <TouchableOpacity
          style={[styles.deleteBtn, deleting && styles.deleteBtnDisabled]}
          onPress={handleDelete}
          disabled={deleting || submitting}
          activeOpacity={0.8}
        >
          {deleting
            ? <ActivityIndicator size="small" color={Colors.error} />
            : <AppText style={styles.deleteBtnText}>Delete User</AppText>
          }
        </TouchableOpacity>
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
  readOnlyRow: {
    gap: 4,
  },
  readOnlyLabel: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontWeight: '500',
  },
  readOnlyValue: {
    fontSize: 15,
    color: Colors.textLight,
    backgroundColor: Colors.background,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: Colors.border,
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
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  switchInfo: {
    flex: 1,
    gap: 2,
  },
  switchLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.text,
  },
  switchHint: {
    fontSize: 12,
    color: Colors.textSecondary,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  statusBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 2,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  toggleBtn: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 8,
    minWidth: 80,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggleBtnEnable:  { backgroundColor: '#059669' },
  toggleBtnDisable: { backgroundColor: '#DC2626' },
  toggleBtnDis:     { opacity: 0.5 },
  toggleBtnTxt:     { color: '#FFF', fontSize: 13, fontWeight: '700' },
  toggleChip:    { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 6, borderWidth: 1.5, borderColor: Colors.border, backgroundColor: Colors.background },
  toggleChipOn:  { borderColor: Colors.primary, backgroundColor: Colors.primaryMuted },
  toggleChipTxt: { fontSize: 12, fontWeight: '700', color: Colors.textSecondary },
  toggleChipTxtOn: { color: Colors.primary },
  saveBtn: {
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 6,
  },
  deleteBtn: {
    borderWidth: 1.5,
    borderColor: Colors.error,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surface,
  },
  deleteBtnDisabled: {
    opacity: 0.5,
  },
  deleteBtnText: {
    color: Colors.error,
    fontSize: 15,
    fontWeight: '600',
  },
});

export default EditUserScreen;
