import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons as Icon } from '@expo/vector-icons';
import Colors from '../../theme/colors';
import AppText from '../../components/AppText';
import AppBar from '../../components/AppBar';
import { ApiUser, getUsersApi, deleteUserApi, disableUserApi, enableUserApi, getSalesOrdersApi, getInvoiceHeadersApi } from '../../services/focusApi';
import { useAlert } from '../../components/AppAlert';

interface Props {
  onBack: () => void;
  onCreate: () => void;
  onEdit: (user: ApiUser) => void;
}

type RoleName = 'OWNER' | 'MANAGER' | 'STAFF' | 'CASHIER' | 'REQUESTER' | 'APPROVER';

const ROLE_STYLE: Record<string, { bg: string; text: string }> = {
  OWNER:     { bg: '#FEF3C7', text: '#D97706' },
  MANAGER:   { bg: '#DBEAFE', text: '#2563EB' },
  STAFF:     { bg: '#D1FAE5', text: '#059669' },
  CASHIER:   { bg: '#FFE4E6', text: '#E11D48' },
  REQUESTER: { bg: '#CFFAFE', text: '#0891B2' },
  APPROVER:  { bg: '#EDE9FE', text: '#7C3AED' },
};

const roleStyle = (role: string) =>
  ROLE_STYLE[role?.toUpperCase()] ?? { bg: Colors.divider, text: Colors.textSecondary };

const avatarColor = (name: string): string => {
  const palette = ['#3B82F6', '#8B5CF6', '#10B981', '#F59E0B', '#EF4444', '#06B6D4', '#EC4899'];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return palette[Math.abs(h) % palette.length];
};

const initials = (name: string) =>
  name.split(' ').slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('');

const UsersListScreen: React.FC<Props> = ({ onBack, onCreate, onEdit }) => {
  const insets = useSafeAreaInsets();
  const { showAlert } = useAlert();
  const [users, setUsers] = useState<ApiUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [togglingId,    setTogglingId]    = useState<string | null>(null);
  const [deletingId,    setDeletingId]    = useState<string | null>(null);
  const [usedUserIds,   setUsedUserIds]   = useState<Set<string>>(new Set());

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const [data, orders, invoices] = await Promise.all([
        getUsersApi(),
        getSalesOrdersApi().catch(() => []),
        getInvoiceHeadersApi().catch(() => []),
      ]);
      setUsers(data);
      const ids = new Set<string>([
        ...orders.map(o  => String(o.createdByUser?.id ?? '')).filter(Boolean),
        ...invoices.map(i => String(i.createdByUserId ?? '')).filter(Boolean),
      ]);
      setUsedUserIds(ids);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to load users');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load(true);
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      u =>
        u.name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        u.role.toLowerCase().includes(q)
    );
  }, [users, search]);

  const handleToggle = (user: ApiUser) => {
    const action = user.active ? 'Disable' : 'Enable';
    const hint   = user.active
      ? 'This will block the user from logging in immediately.'
      : 'This will allow the user to log in again.';
    Alert.alert(action + ' User', `${action} "${user.name}"?\n${hint}`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: action,
        style: user.active ? 'destructive' : 'default',
        onPress: async () => {
          setTogglingId(user.id);
          try {
            if (user.active) {
              await disableUserApi(user.id);
            } else {
              await enableUserApi(user.id);
            }
            setUsers(prev => prev.map(u => u.id === user.id ? { ...u, active: !u.active } : u));
          } catch (err: any) {
            Alert.alert('Error', err?.message ?? `Failed to ${action.toLowerCase()} user`);
          } finally {
            setTogglingId(null);
          }
        },
      },
    ]);
  };

  const handleDelete = (user: ApiUser) => {
    showAlert({
      type: 'confirm',
      title: 'Delete User',
      message: `Are you sure you want to delete "${user.name}"? This action cannot be undone.`,
      actions: [
        { label: 'Cancel', variant: 'outline' },
        {
          label: 'Delete',
          variant: 'danger',
          onPress: async () => {
            setDeletingId(user.id);
            try {
              await deleteUserApi(user.id);
              setUsers(prev => prev.filter(u => u.id !== user.id));
            } catch (err: any) {
              showAlert({ type: 'error', title: 'Error', message: err?.message ?? 'Failed to delete user' });
            } finally {
              setDeletingId(null);
            }
          },
        },
      ],
    });
  };

  const renderUser = ({ item }: { item: ApiUser }) => {
    const rs           = roleStyle(item.role);
    const color        = avatarColor(item.name);
    const isToggling   = togglingId === item.id;
    const isDeleting   = deletingId === item.id;
    const isReferenced = usedUserIds.has(String(item.id));

    return (
      <View style={styles.row}>
        {/* Avatar */}
        <View style={[styles.avatar, { backgroundColor: color }]}>
          <AppText style={styles.avatarText}>{initials(item.name)}</AppText>
        </View>

        {/* Info */}
        <View style={styles.info}>
          <View style={styles.nameRow}>
            <AppText style={styles.name} numberOfLines={1}>{item.name}</AppText>
            <View style={[styles.roleBadge, { backgroundColor: rs.bg }]}>
              <AppText style={[styles.roleText, { color: rs.text }]}>
                {item.role?.toUpperCase()}
              </AppText>
            </View>
          </View>
          <AppText style={styles.email} numberOfLines={1}>{item.email}</AppText>
          <View style={styles.statusRow}>
            <View style={[styles.statusDot, { backgroundColor: item.active ? Colors.success : Colors.textLight }]} />
            <AppText style={styles.statusLabel}>
              {item.active ? 'Active' : 'Inactive'}
            </AppText>
            {item.lang && (
              <>
                <AppText style={styles.separator}>·</AppText>
                <AppText style={styles.statusLabel}>{item.lang === 'km' ? 'Khmer' : 'English'}</AppText>
              </>
            )}
          </View>
        </View>

        {/* Actions */}
        <View style={styles.actions}>
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() => onEdit(item)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Icon name="edit" size={18} color={Colors.primary} />
          </TouchableOpacity>
          {isDeleting ? (
            <ActivityIndicator size="small" color={Colors.error} style={styles.actionBtn} />
          ) : (
            <TouchableOpacity
              style={[styles.actionBtn, isReferenced && styles.deleteBtnDisabled]}
              onPress={() => {
                if (isReferenced) {
                  showAlert({ type: 'info', title: 'Cannot Delete', message: `"${item.name}" has linked records and cannot be deleted.` });
                  return;
                }
                handleDelete(item);
              }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Icon
                name={isReferenced ? 'lock-outline' : 'delete-outline'}
                size={18}
                color={isReferenced ? Colors.textLight : Colors.error}
              />
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  };

  return (
    <View style={styles.root}>
      <AppBar
        title="Users"
        subtitle="Manage team members"
        titleAlign="left"
        showBack
        onBack={onBack}
      />

      {/* Search */}
      <View style={styles.searchWrap}>
        <Icon name="search" size={18} color={Colors.textLight} style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder="Search by name, email or role…"
          placeholderTextColor={Colors.textLight}
          clearButtonMode="while-editing"
        />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <AppText style={styles.loadingText}>Loading users…</AppText>
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Icon name="error-outline" size={44} color={Colors.error} />
          <AppText style={styles.errorText}>{error}</AppText>
          <TouchableOpacity style={styles.retryBtn} onPress={() => load()}>
            <AppText style={styles.retryText}>Try again</AppText>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={u => u.id}
          renderItem={renderUser}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={filtered.length === 0 ? styles.emptyContainer : styles.listContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[Colors.primary]} />
          }
          ListEmptyComponent={
            <View style={styles.center}>
              <Icon name="people-outline" size={44} color={Colors.textLight} />
              <AppText style={styles.emptyTitle}>
                {search ? 'No users match your search' : 'No users yet'}
              </AppText>
              {!search && (
                <TouchableOpacity style={styles.addFirstBtn} onPress={onCreate}>
                  <AppText style={styles.addFirstText}>Add the first user</AppText>
                </TouchableOpacity>
              )}
            </View>
          }
        />
      )}

      {/* Count footer */}
      {!loading && !error && filtered.length > 0 && (
        <View style={styles.footer}>
          <AppText style={styles.footerText}>
            {filtered.length} {filtered.length === 1 ? 'user' : 'users'}
            {search ? ' found' : ' total'}
          </AppText>
        </View>
      )}

      {/* FAB */}
      <TouchableOpacity
        style={[styles.fab, { bottom: insets.bottom + 24 }]}
        onPress={onCreate}
        activeOpacity={0.85}
      >
        <Icon name="person-add" size={22} color="#FFFFFF" />
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.divider,
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 8,
  },
  searchIcon: {
    marginTop: 1,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: Colors.text,
    paddingVertical: 0,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 32,
  },
  emptyContainer: {
    flex: 1,
  },
  loadingText: {
    color: Colors.textSecondary,
    fontSize: 14,
  },
  errorText: {
    color: Colors.error,
    fontSize: 14,
    textAlign: 'center',
  },
  retryBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: Colors.primaryMuted,
    borderRadius: 8,
  },
  retryText: {
    color: Colors.primary,
    fontWeight: '600',
    fontSize: 14,
  },
  emptyTitle: {
    color: Colors.textSecondary,
    fontSize: 15,
    textAlign: 'center',
  },
  addFirstBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: Colors.primary,
    borderRadius: 8,
  },
  addFirstText: {
    color: Colors.white,
    fontWeight: '600',
    fontSize: 14,
  },
  listContent: {
    paddingBottom: 96,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.divider,
    gap: 12,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  info: {
    flex: 1,
    gap: 3,
    minWidth: 0,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  name: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.text,
    flexShrink: 1,
  },
  roleBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 20,
  },
  roleText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  email: {
    fontSize: 13,
    color: Colors.textSecondary,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 1,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusLabel: {
    fontSize: 12,
    color: Colors.textLight,
  },
  separator: {
    fontSize: 12,
    color: Colors.textLight,
  },
  actions: {
    flexDirection: 'row',
    gap: 4,
  },
  actionBtn: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.background,
  },
  toggleBtnDisable:  { backgroundColor: '#FEE2E2' },
  toggleBtnEnable:   { backgroundColor: '#D1FAE5' },
  deleteBtnDisabled: { opacity: 0.4 },
  fab: {
    position: 'absolute',
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 8,
  },
  footer: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: Colors.divider,
    backgroundColor: Colors.surface,
  },
  footerText: {
    fontSize: 12,
    color: Colors.textSecondary,
    textAlign: 'center',
  },
});

export default UsersListScreen;
