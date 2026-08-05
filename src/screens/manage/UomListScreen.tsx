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
import { getUomsApi, deleteUomApi, ApiUom, getAllProductsApi } from '../../services/focusApi';

interface Props {
  onBack: () => void;
  onCreate: () => void;
  onEdit: (uom: ApiUom) => void;
}

const UOM_COLORS = [
  '#2563EB', '#7C3AED', '#10B981', '#F59E0B',
  '#EF4444', '#06B6D4', '#F97316', '#EC4899',
];

const UomListScreen: React.FC<Props> = ({ onBack, onCreate, onEdit }) => {
  const { showAlert } = useAlert();
  const [uoms, setUoms] = useState<ApiUom[]>([]);
  const [usedUomIds, setUsedUomIds] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const load = useCallback((silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    Promise.all([
      getUomsApi(),
      getAllProductsApi().catch(() => []),
    ])
      .then(([uomList, products]) => {
        setUoms([...uomList].sort((a, b) => Number(b.id) - Number(a.id)));
        const ids = new Set<number>();
        products.forEach(p => { if (p.uomId != null) ids.add(p.uomId); });
        setUsedUomIds(ids);
      })
      .catch(err => setError(err?.message ?? 'Failed to load UOMs'))
      .finally(() => { setLoading(false); setRefreshing(false); });
  }, []);

  useEffect(() => { load(); }, [load]);

  const onRefresh = () => { setRefreshing(true); load(true); };

  const filteredUoms = searchQuery.trim()
    ? uoms.filter(u => {
        const q = searchQuery.toLowerCase();
        return (
          u.nameEn?.toLowerCase().includes(q) ||
          u.nameKm?.toLowerCase().includes(q) ||
          u.code?.toLowerCase().includes(q)
        );
      })
    : uoms;

  const handleDelete = (uom: ApiUom) => {
    if (usedUomIds.has(uom.id)) {
      showAlert({
        type: 'error',
        title: 'Cannot Delete UOM',
        message: `"${uom.nameEn || uom.nameKm || uom.code}" is used by one or more products and cannot be deleted.`,
      });
      return;
    }
    showAlert({
      type: 'confirm',
      title: 'Delete UOM',
      message: `Are you sure you want to delete "${uom.nameEn || uom.nameKm || uom.code}"? This action cannot be undone.`,
      actions: [
        { label: 'Cancel', variant: 'outline' },
        {
          label: 'Delete',
          variant: 'danger',
          onPress: async () => {
            setDeletingId(uom.id);
            try {
              await deleteUomApi(uom.id);
              setUoms(prev => prev.filter(u => u.id !== uom.id));
            } catch (err: any) {
              showAlert({ type: 'error', title: 'Error', message: err?.message ?? 'Failed to delete UOM' });
            } finally {
              setDeletingId(null);
            }
          },
        },
      ],
    });
  };

  const renderItem = ({ item, index }: { item: ApiUom; index: number }) => {
    const color = UOM_COLORS[index % UOM_COLORS.length];
    const isDeleting = deletingId === item.id;
    const isInUse = usedUomIds.has(item.id);

    return (
      <TouchableOpacity
        style={styles.row}
        onPress={() => onEdit(item)}
        activeOpacity={0.75}
        disabled={isDeleting}
      >
        <View style={[styles.iconBox, { backgroundColor: `${color}18` }]}>
          <Icon name="straighten" size={20} color={color} />
        </View>
        <View style={styles.rowBody}>
          <AppText variant="bodyMedium" style={styles.name} numberOfLines={1}>
            {item.nameEn || item.nameKm || item.code}
          </AppText>
          {item.nameKm && item.nameEn ? (
            <AppText variant="caption" color="textSecondary" numberOfLines={1}>
              {item.nameKm}
            </AppText>
          ) : null}
        </View>
        <View style={styles.codeBadge}>
          <AppText style={styles.codeText}>{item.code}</AppText>
        </View>
        {item.factor != null ? (
          <View style={styles.factorBadge}>
            <AppText style={styles.factorText}>×{item.factor}</AppText>
          </View>
        ) : null}
        <View style={[styles.activeBadge, item.active === false ? styles.inactiveBadge : null]}>
          <AppText style={[styles.activeText, item.active === false ? styles.inactiveText : null]}>
            {item.active === false ? 'Inactive' : 'Active'}
          </AppText>
        </View>
        {isDeleting ? (
          <ActivityIndicator size="small" color={Colors.error} style={styles.deleteBtn} />
        ) : (
          <TouchableOpacity
            style={[styles.deleteBtn, isInUse && styles.deleteBtnDisabled]}
            onPress={() => handleDelete(item)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Icon name="delete-outline" size={20} color={isInUse ? Colors.textLight : Colors.error} />
          </TouchableOpacity>
        )}
      </TouchableOpacity>
    );
  };

  const subtitle = searchQuery
    ? `${filteredUoms.length} of ${uoms.length} UOMs`
    : uoms.length > 0
    ? `${uoms.length} units`
    : 'Units of measure';

  return (
    <View style={styles.safe}>
      <AppBar
        title="UOM"
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
          data={filteredUoms}
          keyExtractor={item => String(item.id)}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
          ListEmptyComponent={
            <View style={styles.center}>
              <Icon name={searchQuery ? 'search-off' : 'straighten'} size={48} color={Colors.textLight} />
              <AppText variant="body" color="textSecondary" style={styles.centerMsg}>
                {searchQuery ? `No UOMs match "${searchQuery}"` : 'No units of measure yet'}
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
  factorBadge: {
    backgroundColor: '#FEF3C7',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  factorText: {
    fontSize: 11,
    color: '#D97706',
    fontWeight: '700',
  },
  activeBadge: {
    backgroundColor: Colors.successLight,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  inactiveBadge: { backgroundColor: Colors.divider },
  activeText: { fontSize: 11, color: Colors.success, fontWeight: '600' },
  inactiveText: { fontSize: 11, color: Colors.textSecondary, fontWeight: '600' },
  deleteBtn: { padding: 4 },
  deleteBtnDisabled: { opacity: 0.35 },
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

export default UomListScreen;
