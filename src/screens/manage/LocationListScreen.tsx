import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  TextInput,
} from 'react-native';
import { MaterialIcons as Icon } from '@expo/vector-icons';
import Colors from '../../theme/colors';
import AppText from '../../components/AppText';
import AppBar from '../../components/AppBar';
import { useAlert } from '../../components/AppAlert';
import { getLocationsApi, deleteLocationApi, getAllProductsApi, ApiLocation } from '../../services/focusApi';

interface Props {
  onBack: () => void;
  onCreate: () => void;
  onEdit: (location: ApiLocation) => void;
}

const LOCATION_COLORS = [
  '#2563EB', '#7C3AED', '#10B981', '#F59E0B',
  '#EF4444', '#06B6D4', '#F97316', '#EC4899',
];

const LOCATION_ICONS = [
  'place', 'location-on', 'my-location', 'near-me',
  'location-city', 'map', 'explore', 'pin-drop',
];

const LocationListScreen: React.FC<Props> = ({ onBack, onCreate, onEdit }) => {
  const { showAlert } = useAlert();
  const [locations, setLocations] = useState<ApiLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [usedLocationCodes, setUsedLocationCodes] = useState<Set<string>>(new Set());

  const load = useCallback((silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    Promise.all([getLocationsApi(), getAllProductsApi()])
      .then(([locs, products]) => {
        setLocations(locs);
        const codes = new Set<string>();
        for (const p of products) {
          for (const pl of p.locations ?? []) {
            if (pl.locationCode) codes.add(pl.locationCode);
          }
        }
        setUsedLocationCodes(codes);
      })
      .catch(err => setError(err?.message ?? 'Failed to load locations'))
      .finally(() => { setLoading(false); setRefreshing(false); });
  }, []);

  useEffect(() => { load(); }, [load]);

  const onRefresh = () => { setRefreshing(true); load(true); };

  const filteredLocations = searchQuery.trim()
    ? locations.filter(l => {
        const q = searchQuery.toLowerCase();
        return (
          l.nameEn?.toLowerCase().includes(q) ||
          l.nameKm?.toLowerCase().includes(q) ||
          l.code?.toLowerCase().includes(q)
        );
      })
    : locations;

  const handleDelete = (location: ApiLocation) => {
    showAlert({
      type: 'confirm',
      title: 'Delete Location',
      message: `Are you sure you want to delete "${location.nameEn || location.nameKm}"? This action cannot be undone.`,
      actions: [
        { label: 'Cancel', variant: 'outline' },
        {
          label: 'Delete',
          variant: 'danger',
          onPress: async () => {
            setDeletingId(String(location.id));
            try {
              await deleteLocationApi(String(location.id));
              setLocations(prev => prev.filter(l => l.id !== location.id));
            } catch (err: any) {
              showAlert({ type: 'error', title: 'Error', message: err?.message ?? 'Failed to delete location' });
            } finally {
              setDeletingId(null);
            }
          },
        },
      ],
    });
  };

  const renderItem = ({ item, index }: { item: ApiLocation; index: number }) => {
    const color = LOCATION_COLORS[index % LOCATION_COLORS.length];
    const icon = LOCATION_ICONS[index % LOCATION_ICONS.length];
    const isDeleting = deletingId === String(item.id);
    const isInUse = usedLocationCodes.has(item.code);

    return (
      <TouchableOpacity
        style={styles.row}
        onPress={() => onEdit(item)}
        activeOpacity={0.75}
        disabled={isDeleting}
      >
        <View style={[styles.iconBox, { backgroundColor: `${color}18` }]}>
          <Icon name={icon} size={20} color={color} />
        </View>
        <View style={styles.rowBody}>
          <AppText variant="bodyMedium" style={styles.name} numberOfLines={1}>
            {item.nameEn || item.nameKm}
          </AppText>
          {item.nameKm ? (
            <AppText variant="caption" color="textSecondary" numberOfLines={1}>
              {item.nameKm}{item.address ? `  •  ${item.address}` : ''}
            </AppText>
          ) : null}
          {isInUse && (
            <AppText style={styles.inUseLabel}>Used by products</AppText>
          )}
        </View>
        <View style={styles.codeBadge}>
          <AppText style={styles.codeText}>{item.code}</AppText>
        </View>
        <View style={[styles.activeBadge, item.active === false ? styles.inactiveBadge : null]}>
          <AppText style={[styles.activeText, item.active === false ? styles.inactiveText : null]}>
            {item.active === false ? 'Inactive' : 'Active'}
          </AppText>
        </View>
        {isDeleting ? (
          <ActivityIndicator size="small" color={Colors.error} style={styles.deleteBtn} />
        ) : isInUse ? (
          <View style={[styles.deleteBtn, styles.deleteBtnDisabled]}>
            <Icon name="lock-outline" size={20} color={Colors.textLight} />
          </View>
        ) : (
          <TouchableOpacity
            style={styles.deleteBtn}
            onPress={() => handleDelete(item)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Icon name="delete-outline" size={20} color={Colors.error} />
          </TouchableOpacity>
        )}
      </TouchableOpacity>
    );
  };

  const subtitle = searchQuery
    ? `${filteredLocations.length} of ${locations.length} locations`
    : locations.length > 0
    ? `${locations.length} locations`
    : 'Manage locations';

  return (
    <View style={styles.safe}>
      <AppBar
        title="Locations"
        subtitle={subtitle}
        titleAlign="left"
        showBack
        onBack={onBack}
      />

      <View style={styles.searchRow}>
        <Icon name="search" size={20} color={Colors.textSecondary} style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search by name or code..."
          placeholderTextColor={Colors.textLight}
          value={searchQuery}
          onChangeText={setSearchQuery}
          returnKeyType="search"
          clearButtonMode="while-editing"
        />
        {searchQuery ? (
          <TouchableOpacity onPress={() => setSearchQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Icon name="close" size={18} color={Colors.textSecondary} />
          </TouchableOpacity>
        ) : null}
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Icon name="error-outline" size={48} color={Colors.textLight} />
          <AppText variant="body" color="textSecondary" style={styles.centerMsg}>{error}</AppText>
          <TouchableOpacity style={styles.retryBtn} onPress={() => load()}>
            <AppText variant="bodyMedium" color="primary">Retry</AppText>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={filteredLocations}
          keyExtractor={item => String(item.id)}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
          ListEmptyComponent={
            <View style={styles.center}>
              <Icon name={searchQuery ? 'search-off' : 'place'} size={48} color={Colors.textLight} />
              <AppText variant="body" color="textSecondary" style={styles.centerMsg}>
                {searchQuery ? `No locations match "${searchQuery}"` : 'No locations yet'}
              </AppText>
            </View>
          }
        />
      )}

      <TouchableOpacity style={styles.fab} onPress={onCreate} activeOpacity={0.85}>
        <Icon name="add" size={28} color={Colors.white} />
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 4,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  searchIcon: { marginRight: 8 },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: Colors.text,
    paddingVertical: 0,
  },
  list: { paddingBottom: 100 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.divider,
    gap: 12,
  },
  iconBox: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBody: { flex: 1, gap: 2 },
  name: { fontWeight: '600' },
  codeBadge: {
    backgroundColor: Colors.primaryMuted,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  codeText: {
    fontSize: 11,
    color: Colors.primary,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  activeBadge: {
    backgroundColor: Colors.successLight,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  inactiveBadge: {
    backgroundColor: Colors.divider,
  },
  activeText: { fontSize: 11, color: Colors.success, fontWeight: '600' },
  inactiveText: { fontSize: 11, color: Colors.textSecondary, fontWeight: '600' },
  deleteBtn: { padding: 4 },
  deleteBtnDisabled: { opacity: 0.4 },
  inUseLabel: { fontSize: 10, color: Colors.warning, fontWeight: '600', marginTop: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  centerMsg: { textAlign: 'center' },
  retryBtn: {
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: Colors.primary,
  },
  fab: {
    position: 'absolute',
    bottom: 28,
    right: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
});

export default LocationListScreen;
