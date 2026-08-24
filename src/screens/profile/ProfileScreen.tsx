import React, { useEffect, useState } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  StatusBar,
  ActivityIndicator,
  Alert,
  RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons as Icon } from '@expo/vector-icons';
import Colors from '../../theme/colors';
import AppText from '../../components/AppText';
import AppButton from '../../components/AppButton';
import AppInput from '../../components/AppInput';
import { useAlert } from '../../components/AppAlert';
import { useProfileViewModel } from '../../viewmodels/useProfileViewModel';
import { User } from '../../models/User';
import { getUsersApi, ApiUser, broadcastPushApi } from '../../services/focusApi';
import { getFcmToken } from '../../services/fcmService';
import Constants from 'expo-constants';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ProfileScreenProps {
  user: User | null;
  onLogout: () => void;
  fcmToken?: string | null;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const roleColor: Record<string, string> = {
  admin:   Colors.secondary,
  manager: Colors.primary,
  cashier: Colors.success,
  owner:   Colors.warning,
};

const ROLE_BADGE: Record<string, { bg: string; text: string }> = {
  OWNER:     { bg: '#FEF3C7', text: '#D97706' },
  MANAGER:   { bg: '#DBEAFE', text: '#2563EB' },
  STAFF:     { bg: '#D1FAE5', text: '#059669' },
  REQUESTER: { bg: '#CFFAFE', text: '#0891B2' },
  APPROVER:  { bg: '#EDE9FE', text: '#7C3AED' },
};

const avatarBg = (name: string): string => {
  const palette = ['#3B82F6', '#8B5CF6', '#10B981', '#F59E0B', '#EF4444', '#06B6D4', '#EC4899'];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return palette[Math.abs(h) % palette.length];
};

// ─── Team member row ──────────────────────────────────────────────────────────

const TeamRow: React.FC<{ member: ApiUser; last?: boolean }> = ({ member, last }) => {
  const rs = ROLE_BADGE[member.role?.toUpperCase()] ?? { bg: Colors.divider, text: Colors.textSecondary };
  const color = avatarBg(member.name);
  const initials = member.name.split(' ').slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('');

  return (
    <View style={[styles.teamRow, !last && styles.infoRowBorder]}>
      {/* Avatar + active dot */}
      <View style={styles.teamAvatarWrap}>
        <View style={[styles.teamAvatar, { backgroundColor: color }]}>
          <AppText style={styles.teamAvatarText}>{initials}</AppText>
        </View>
        <View style={[styles.teamStatusDot, { backgroundColor: member.active ? Colors.success : Colors.textLight }]} />
      </View>

      {/* Fields */}
      <View style={styles.teamFields}>
        <View style={styles.teamFieldRow}>
          <AppText style={styles.teamFieldLabel}>Full Name</AppText>
          <AppText style={styles.teamFieldValue} numberOfLines={1}>{member.name || '—'}</AppText>
        </View>
        <View style={styles.teamFieldRow}>
          <AppText style={styles.teamFieldLabel}>Email</AppText>
          <AppText style={styles.teamFieldValue} numberOfLines={1}>{member.email || '—'}</AppText>
        </View>
        <View style={styles.teamFieldRow}>
          <AppText style={styles.teamFieldLabel}>Role</AppText>
          <View style={[styles.teamRoleBadge, { backgroundColor: rs.bg }]}>
            <AppText style={[styles.teamRoleText, { color: rs.text }]}>
              {member.role?.toUpperCase() || '—'}
            </AppText>
          </View>
        </View>
        <View style={styles.teamFieldRow}>
          <AppText style={styles.teamFieldLabel}>Branch</AppText>
          <AppText style={styles.teamFieldValue} numberOfLines={1}>{member.branch || '—'}</AppText>
        </View>
      </View>
    </View>
  );
};

const settingItems = [
  { label: 'Notifications', icon: 'notifications-none', subtitle: 'Manage alerts' },
  { label: 'Language',      icon: 'language',           subtitle: 'English' },
  { label: 'Help & Support',icon: 'help-outline',       subtitle: 'FAQs & contact' },
  { label: 'About FOCUS',   icon: 'info-outline',       subtitle: 'v1.0.0' },
];

// ─── Sub-components ───────────────────────────────────────────────────────────

const InfoRow: React.FC<{ icon: string; label: string; value: string; last?: boolean }> = ({
  icon, label, value, last,
}) => (
  <View style={[styles.infoRow, !last && styles.infoRowBorder]}>
    <View style={styles.infoIconBox}>
      <Icon name={icon} size={16} color={Colors.primary} />
    </View>
    <View style={styles.infoContent}>
      <AppText variant="label" color="textSecondary">{label}</AppText>
      <AppText variant="bodyMedium" style={styles.infoValue}>{value || '—'}</AppText>
    </View>
  </View>
);

const SettingRow: React.FC<{ icon: string; label: string; subtitle: string; last?: boolean; onPress?: () => void }> = ({
  icon, label, subtitle, last, onPress,
}) => (
  <TouchableOpacity
    style={[styles.settingRow, !last && styles.infoRowBorder]}
    activeOpacity={0.6}
    onPress={onPress}
  >
    <View style={styles.settingIconBox}>
      <Icon name={icon} size={18} color={Colors.primary} />
    </View>
    <View style={styles.infoContent}>
      <AppText variant="bodyMedium" style={styles.settingLabel}>{label}</AppText>
      <AppText variant="caption" color="textSecondary">{subtitle}</AppText>
    </View>
    <Icon name="chevron-right" size={20} color={Colors.textLight} />
  </TouchableOpacity>
);

// ─── Main Screen ──────────────────────────────────────────────────────────────

const ProfileScreen: React.FC<ProfileScreenProps> = ({ user, onLogout, fcmToken: propFcmToken }) => {
  const insets = useSafeAreaInsets();
  const vm = useProfileViewModel(user);
  const { showAlert } = useAlert();

  const [teamUsers, setTeamUsers] = useState<ApiUser[]>([]);
  const [teamLoading, setTeamLoading] = useState(true);
  const [teamError, setTeamError] = useState<string | null>(null);
  const [fcmToken, setFcmToken] = useState<string | null>(propFcmToken ?? null);
  const [fcmLoading, setFcmLoading] = useState(false);
  const [fcmChecked, setFcmChecked] = useState(!!propFcmToken);
  const [fcmSent, setFcmSent] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const isOwner = user?.role === 'owner';

  useEffect(() => {
    if (propFcmToken) {
      setFcmToken(propFcmToken);
      setFcmChecked(true);
    } else {
      // Fallback: fetch directly from Firebase if prop not available
      getFcmToken().then(token => {
        if (token) setFcmToken(token);
        setFcmChecked(true);
      });
    }
  }, [propFcmToken]);

  // Broadcast to all registered devices via POST /api/v1/auth/broadcast-push
  const handleNotificationsPress = async () => {
    setFcmLoading(true);
    try {
      const result = await broadcastPushApi('FocusLab', 'Hello from FocusLab');
      const sent = result.results.filter(r => r.sent).length;
      setFcmSent(sent > 0);
      setTimeout(() => setFcmSent(false), 3000);
    } catch {
    } finally {
      setFcmLoading(false);
    }
  };

  useEffect(() => {
    if (!isOwner) { setTeamLoading(false); return; }
    getUsersApi()
      .then(setTeamUsers)
      .catch(err => setTeamError(err?.message ?? 'Failed to load team'))
      .finally(() => setTeamLoading(false));
  }, [isOwner]);
  const color = roleColor[user?.role ?? 'cashier'] ?? Colors.primary;
  const initial = user?.name?.charAt(0)?.toUpperCase() ?? 'U';

  const handleLogout = () => {
    showAlert({
      type: 'warning',
      title: 'Sign Out',
      message: 'Are you sure you want to sign out of your account?',
      actions: [
        { label: 'Cancel', variant: 'outline' },
        { label: 'Sign Out', variant: 'danger', onPress: onLogout },
      ],
    });
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await Promise.allSettled([
      isOwner
        ? getUsersApi().then(setTeamUsers).catch(err => setTeamError(err?.message ?? 'Failed to load team'))
        : Promise.resolve(),
      getFcmToken().then(token => { if (token) setFcmToken(token); }),
    ]);
    setRefreshing(false);
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.primary} />

      {/* Hero Header */}
      <View style={[styles.hero, { paddingTop: insets.top + 12 }]}>
        {/* Top row: title + edit */}
        <View style={styles.heroTop}>
          <AppText style={styles.heroTitle}>Profile</AppText>
          <TouchableOpacity
            onPress={() => vm.setEditing(!vm.editing)}
            style={styles.editBtn}
            activeOpacity={0.7}
          >
            <Icon name={vm.editing ? 'close' : 'edit'} size={20} color={Colors.white} />
          </TouchableOpacity>
        </View>

        {/* Avatar + name */}
        <View style={styles.heroBody}>
          <View style={styles.avatarRing}>
            <View style={styles.avatar}>
              <AppText style={styles.avatarText}>{initial}</AppText>
            </View>
          </View>
          <View style={styles.heroInfo}>
            <AppText style={styles.heroName}>{user?.name ?? 'User'}</AppText>
            <AppText style={styles.heroEmail}>{user?.email ?? ''}</AppText>
            <View style={[styles.rolePill, { backgroundColor: `${color}30` }]}>
              <View style={[styles.roleDot, { backgroundColor: color }]} />
              <AppText style={[styles.roleText, { color }]}>
                {(user?.role ?? 'cashier').charAt(0).toUpperCase() + (user?.role ?? 'cashier').slice(1)}
              </AppText>
            </View>
          </View>
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 100 }]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={Colors.primary} />
        }
      >
        {/* Account Details */}
        <AppText style={styles.sectionLabel}>ACCOUNT DETAILS</AppText>
        <View style={styles.card}>
          {vm.editing ? (
            <>
              <AppInput
                label="Full Name"
                value={vm.editableUser.name}
                onChangeText={v => vm.updateField('name', v)}
                placeholder="Your name"
              />
              <AppInput
                label="Phone"
                value={vm.editableUser.phone ?? ''}
                onChangeText={v => vm.updateField('phone', v)}
                placeholder="+1 000-000-0000"
                keyboardType="phone-pad"
              />
              <AppInput
                label="Branch"
                value={vm.editableUser.branch ?? ''}
                onChangeText={v => vm.updateField('branch', v)}
                placeholder="Branch name"
              />
              <AppButton
                label="Save Changes"
                onPress={vm.saveProfile}
                loading={vm.loading}
                fullWidth
                style={styles.saveBtn}
              />
            </>
          ) : (
            <>
              <InfoRow icon="person-outline" label="Full Name" value={user?.name ?? ''} />
              <InfoRow icon="email"          label="Email"     value={user?.email ?? ''} />
              <InfoRow icon="badge"          label="Role"      value={user?.role ?? ''} />
              <InfoRow icon="store"          label="Branch"    value={user?.branch ?? ''} last />
            </>
          )}
        </View>

        {/* Settings */}
        <AppText style={styles.sectionLabel}>SETTINGS</AppText>
        <View style={styles.card}>
          {settingItems.map((item, i) => (
            <SettingRow
              key={item.label}
              icon={item.icon}
              label={item.label}
              subtitle={item.subtitle}
              last={i === settingItems.length - 1}
            />
          ))}
        </View>

        {/* Push Notifications — all users */}
        <AppText style={styles.sectionLabel}>PUSH NOTIFICATIONS</AppText>
        <View style={styles.card}>
          <View style={styles.pushRow}>
            <View style={[styles.pushIconBox, { backgroundColor: fcmToken ? '#ECFDF5' : '#FEF3C7' }]}>
              <Icon
                name={fcmToken ? 'notifications-active' : 'notifications-off'}
                size={20}
                color={fcmToken ? Colors.success : Colors.warning}
              />
            </View>
            <View style={{ flex: 1 }}>
              <AppText style={styles.pushLabel}>Push Notifications</AppText>
              <AppText variant="caption" color="textSecondary" style={{ marginTop: 2 }}>
                {fcmToken ? 'Active on this device' : 'Not available on this device'}
              </AppText>
            </View>
          </View>

          {/* Broadcast — all users */}
          <TouchableOpacity
            style={[
              styles.pushActionBtn,
              styles.pushActionBtnRefresh,
              fcmSent && { borderColor: Colors.success, backgroundColor: '#F0FDF4' },
            ]}
            onPress={handleNotificationsPress}
            disabled={fcmLoading}
            activeOpacity={0.7}
          >
            {fcmLoading
              ? <ActivityIndicator size="small" color={Colors.primary} />
              : fcmSent
              ? <>
                  <Icon name="check-circle" size={16} color={Colors.success} />
                  <AppText style={[styles.pushActionBtnText, { color: Colors.success }]}>
                    Sent
                  </AppText>
                </>
              : <>
                  <Icon name="notifications-active" size={16} color={Colors.primary} />
                  <AppText style={[styles.pushActionBtnText, { color: Colors.primary }]}>
                    Send to All Devices
                  </AppText>
                </>
            }
          </TouchableOpacity>

        </View>

        {/* Team — owner only */}
        {isOwner && (
          <>
            <AppText style={styles.sectionLabel}>TEAM</AppText>
            <View style={styles.card}>
              {teamLoading ? (
                <View style={styles.teamCenter}>
                  <ActivityIndicator size="small" color={Colors.primary} />
                  <AppText style={styles.teamMeta}>Loading team…</AppText>
                </View>
              ) : teamError ? (
                <View style={styles.teamCenter}>
                  <AppText style={styles.teamErrorText}>{teamError}</AppText>
                </View>
              ) : teamUsers.length === 0 ? (
                <View style={styles.teamCenter}>
                  <AppText style={styles.teamMeta}>No team members found</AppText>
                </View>
              ) : (
                teamUsers.map((member, i) => (
                  <TeamRow
                    key={member.id}
                    member={member}
                    last={i === teamUsers.length - 1}
                  />
                ))
              )}
            </View>
          </>
        )}

        {/* Sign Out */}
        <AppButton
          label="Sign Out"
          onPress={handleLogout}
          variant="danger"
          fullWidth
          style={styles.signOutBtn}
        />

        <AppText variant="caption" color="textLight" align="center" style={styles.version}>
          FOCUS v{Constants.expoConfig?.version ?? '—'} · © {new Date().getFullYear()}
        </AppText>
      </ScrollView>

    </View>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },

  // Hero
  hero: {
    backgroundColor: Colors.primary,
    paddingHorizontal: 20,
    paddingBottom: 24,
  },
  heroTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  heroTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.white,
  },
  editBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroBody: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  avatarRing: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 2.5,
    borderColor: 'rgba(255,255,255,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatar: {
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: Colors.white,
    fontSize: 28,
    fontWeight: '800',
  },
  heroInfo: {
    flex: 1,
    gap: 4,
  },
  heroName: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.white,
  },
  heroEmail: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.75)',
  },
  rolePill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 3,
    gap: 5,
    marginTop: 2,
  },
  roleDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  roleText: {
    fontSize: 12,
    fontWeight: '700',
  },

  // Scroll
  scroll: {
    paddingHorizontal: 16,
    paddingTop: 20,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.textSecondary,
    letterSpacing: 1,
    marginBottom: 8,
    marginLeft: 4,
  },
  card: {
    backgroundColor: Colors.card,
    borderRadius: 16,
    marginBottom: 20,
    shadowColor: Colors.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 3,
    overflow: 'hidden',
  },

  // Info rows
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  infoRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.divider,
  },
  infoIconBox: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: Colors.primaryMuted,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  infoContent: {
    flex: 1,
  },
  infoValue: {
    marginTop: 1,
  },
  saveBtn: {
    marginTop: 4,
  },

  // Settings
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  settingIconBox: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: Colors.primaryMuted,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  settingLabel: {
    fontWeight: '600',
    marginBottom: 1,
  },

  // Push notifications
  pushRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  pushIconBox: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pushLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.text,
  },
  pushStatusBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  pushStatusText: {
    fontSize: 11,
    fontWeight: '600',
  },
  pushActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: Colors.primary,
    marginHorizontal: 16,
    marginBottom: 14,
    paddingVertical: 10,
    borderRadius: 10,
  },
  pushActionBtnRefresh: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: Colors.primary,
  },
  pushActionBtnText: {
    color: Colors.white,
    fontSize: 14,
    fontWeight: '600',
  },

  // Sign out
  signOutBtn: {
    marginBottom: 16,
  },
  version: {
    marginBottom: 8,
  },

  // Team section
  teamRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 14,
  },
  teamAvatarWrap: {
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
  },
  teamAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  teamAvatarText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  teamStatusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  teamFields: {
    flex: 1,
    gap: 6,
  },
  teamFieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  teamFieldLabel: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontWeight: '500',
    width: 72,
    flexShrink: 0,
  },
  teamFieldValue: {
    flex: 1,
    fontSize: 13,
    fontWeight: '500',
    color: Colors.text,
  },
  teamRoleBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 20,
  },
  teamRoleText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  teamCenter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 20,
    paddingHorizontal: 16,
  },
  teamMeta: {
    fontSize: 13,
    color: Colors.textSecondary,
  },
  teamErrorText: {
    fontSize: 13,
    color: Colors.error,
    textAlign: 'center',
  },

});

export default ProfileScreen;
