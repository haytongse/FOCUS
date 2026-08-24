import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  TextInput,
  Modal,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { MaterialIcons as Icon } from '@expo/vector-icons';
import Colors from '../../theme/colors';
import AppText from '../../components/AppText';
import AppBar from '../../components/AppBar';
import { useAlert } from '../../components/AppAlert';
import { getCategoriesApi, createCategoryApi, deleteCategoryApi, ApiCategory, getAllProductsApi } from '../../services/focusApi';

interface Props {
  onBack: () => void;
  onCreate: () => void;
  onEdit: (category: ApiCategory) => void;
}

const CATEGORY_COLORS = [
  '#2563EB', '#F59E0B', '#EF4444', '#10B981',
  '#7C3AED', '#06B6D4', '#F97316', '#EC4899',
];

const CATEGORY_CSV_HEADERS = 'nameEn,nameKm,sort,parentId';
const CATEGORY_CSV_TEMPLATE =
  CATEGORY_CSV_HEADERS + '\n' +
  'Food,អាហារ,1,\n' +
  'Drinks,ភេសជ្ជៈ,2,';

const parseCSVLine = (line: string): string[] => {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') {
      inQuotes = !inQuotes;
    } else if (line[i] === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += line[i];
    }
  }
  result.push(current.trim());
  return result;
};

const CategoriesListScreen: React.FC<Props> = ({ onBack, onCreate, onEdit }) => {
  const { showAlert } = useAlert();
  const [categories, setCategories] = useState<ApiCategory[]>([]);
  const [usedCategoryIds, setUsedCategoryIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [importVisible, setImportVisible] = useState(false);
  const [importText, setImportText] = useState('');
  const [importing, setImporting] = useState(false);

  const load = useCallback((silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    Promise.all([
      getCategoriesApi(),
      getAllProductsApi().catch(() => []),
    ])
      .then(([cats, products]) => {
        setCategories(cats);
        const ids = new Set<string>();
        products.forEach(p => { if (p.categoryId != null) ids.add(p.categoryId); });
        setUsedCategoryIds(ids);
      })
      .catch(err => setError(err?.message ?? 'Failed to load categories'))
      .finally(() => { setLoading(false); setRefreshing(false); });
  }, []);

  useEffect(() => { load(); }, [load]);

  const onRefresh = () => { setRefreshing(true); load(true); };

  const filteredCategories = searchQuery.trim()
    ? categories.filter(c => {
        const q = searchQuery.toLowerCase();
        return (
          c.nameEn?.toLowerCase().includes(q) ||
          c.nameKm?.toLowerCase().includes(q)
        );
      })
    : categories;

  const shareCsvFile = async (filename: string, content: string, title: string) => {
    const path = `${FileSystem.documentDirectory}${filename}`;
    await FileSystem.writeAsStringAsync(path, content);
    const canShare = await Sharing.isAvailableAsync();
    if (canShare) await Sharing.shareAsync(path, { mimeType: 'text/csv', dialogTitle: title });
  };

  const handleTemplate = async () => {
    try {
      await shareCsvFile('category_template.csv', CATEGORY_CSV_TEMPLATE, 'Category Import Template');
    } catch (err: any) {
      if (err?.message !== 'User did not share') {
        showAlert({ type: 'error', title: 'Template Failed', message: err?.message ?? 'Could not create template.' });
      }
    }
  };

  const handleExport = async () => {
    if (categories.length === 0) {
      showAlert({ type: 'info', title: 'No Data', message: 'There are no categories to export.' });
      return;
    }
    const rows = categories.map(c =>
      [
        `"${(c.nameEn ?? '').replace(/"/g, '""')}"`,
        `"${(c.nameKm ?? '').replace(/"/g, '""')}"`,
        String(c.sort ?? 0),
        c.parentId ?? '',
      ].join(',')
    );
    const csv = [CATEGORY_CSV_HEADERS, ...rows].join('\n');
    try {
      await shareCsvFile('categories_export.csv', csv, 'Categories Export');
    } catch (err: any) {
      if (err?.message !== 'User did not share') {
        showAlert({ type: 'error', title: 'Export Failed', message: err?.message ?? 'Could not export.' });
      }
    }
  };

  const handleImport = async () => {
    const lines = importText.trim().split('\n').filter(l => l.trim());
    if (lines.length < 2) {
      showAlert({ type: 'error', title: 'Invalid Format', message: 'Please paste CSV with a header row and at least one data row.' });
      return;
    }
    setImporting(true);
    const dataLines = lines.slice(1);
    let success = 0;
    let failed = 0;
    for (const line of dataLines) {
      try {
        const [nameEn, nameKm, sort, parentId] = parseCSVLine(line);
        await createCategoryApi({
          nameEn: nameEn || '',
          nameKm: nameKm || '',
          sort: sort ? parseInt(sort, 10) : undefined,
          parentId: parentId || null,
        });
        success++;
      } catch {
        failed++;
      }
    }
    setImporting(false);
    setImportVisible(false);
    setImportText('');
    showAlert({
      type: 'success',
      title: 'Import Complete',
      message: `Imported: ${success}  |  Failed: ${failed}`,
      actions: [{ label: 'OK', variant: 'primary', onPress: () => load(true) }],
    });
  };

  const handleDelete = (category: ApiCategory) => {
    if (usedCategoryIds.has(category.id)) {
      showAlert({
        type: 'error',
        title: 'Cannot Delete Category',
        message: `"${category.nameEn || category.nameKm}" is used by one or more products and cannot be deleted.`,
      });
      return;
    }
    showAlert({
      type: 'confirm',
      title: 'Delete Category',
      message: `Are you sure you want to delete "${category.nameEn || category.nameKm}"? This action cannot be undone.`,
      actions: [
        { label: 'Cancel', variant: 'outline' },
        {
          label: 'Delete',
          variant: 'danger',
          onPress: async () => {
            setDeletingId(category.id);
            try {
              await deleteCategoryApi(category.id);
              setCategories(prev => prev.filter(c => c.id !== category.id));
            } catch (err: any) {
              showAlert({ type: 'error', title: 'Error', message: err?.message ?? 'Failed to delete category' });
            } finally {
              setDeletingId(null);
            }
          },
        },
      ],
    });
  };

  const renderItem = ({ item, index }: { item: ApiCategory; index: number }) => {
    const color = CATEGORY_COLORS[index % CATEGORY_COLORS.length];
    const isDeleting = deletingId === item.id;
    const isInUse = usedCategoryIds.has(item.id);
    return (
      <TouchableOpacity style={styles.row} onPress={() => onEdit(item)} activeOpacity={0.75} disabled={isDeleting}>
        <View style={[styles.iconBox, { backgroundColor: `${color}18` }]}>
          <Icon name="category" size={20} color={color} />
        </View>
        <View style={styles.rowBody}>
          <AppText variant="bodyMedium" style={styles.name} numberOfLines={1}>
            {item.nameEn || item.nameKm}
          </AppText>
          {item.nameKm && item.nameEn ? (
            <AppText variant="caption" color="textSecondary" numberOfLines={1}>
              {item.nameKm}
            </AppText>
          ) : null}
        </View>
        <View style={styles.sortBadge}>
          <AppText style={styles.sortText}>#{item.sort ?? 0}</AppText>
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
    ? `${filteredCategories.length} of ${categories.length} categories`
    : categories.length > 0
    ? `${categories.length} categories`
    : 'Product categories';

  return (
    <View style={styles.safe}>
      <AppBar
        title="Categories"
        subtitle={subtitle}
        titleAlign="left"
        showBack
        onBack={onBack}
        rightActions={
          <View style={styles.appBarActions}>
            <TouchableOpacity
              style={styles.appBarBtn}
              onPress={handleTemplate}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Icon name="article" size={22} color={Colors.white} />
              <AppText style={styles.appBarBtnText}>Template</AppText>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.appBarBtn}
              onPress={() => { setImportText(''); setImportVisible(true); }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Icon name="file-upload" size={22} color={Colors.white} />
              <AppText style={styles.appBarBtnText}>Import</AppText>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.appBarBtn}
              onPress={handleExport}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Icon name="file-download" size={22} color={Colors.white} />
              <AppText style={styles.appBarBtnText}>Export</AppText>
            </TouchableOpacity>
          </View>
        }
      />

      {/* Search Bar */}
      <View style={styles.searchRow}>
        <Icon name="search" size={20} color={Colors.textSecondary} style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search categories..."
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

      {/* Import Modal */}
      <Modal visible={importVisible} transparent animationType="slide" onRequestClose={() => setImportVisible(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <AppText variant="bodyMedium" style={styles.modalTitle}>Import Categories</AppText>
              <TouchableOpacity onPress={() => setImportVisible(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Icon name="close" size={22} color={Colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <View style={styles.formatHint}>
              <Icon name="info-outline" size={15} color={Colors.info} />
              <AppText style={styles.formatHintText} numberOfLines={3}>
                CSV format: nameEn, nameKm, sort (number), parentId (optional)
              </AppText>
            </View>

            <TouchableOpacity
              style={styles.templateBtn}
              onPress={handleTemplate}
            >
              <Icon name="download" size={16} color={Colors.primary} />
              <AppText style={styles.templateBtnText}>Download Template</AppText>
            </TouchableOpacity>

            <TextInput
              style={styles.pasteInput}
              placeholder="Paste your CSV content here..."
              placeholderTextColor={Colors.textLight}
              multiline
              value={importText}
              onChangeText={setImportText}
              textAlignVertical="top"
              autoCapitalize="none"
              autoCorrect={false}
            />

            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setImportVisible(false)}>
                <AppText variant="bodyMedium" color="textSecondary">Cancel</AppText>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.importBtn, (!importText.trim() || importing) && styles.importBtnDisabled]}
                onPress={handleImport}
                disabled={!importText.trim() || importing}
              >
                {importing ? (
                  <ActivityIndicator size="small" color={Colors.white} />
                ) : (
                  <>
                    <Icon name="file-upload" size={18} color={Colors.white} />
                    <AppText style={styles.importBtnText}>Import</AppText>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

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
          data={filteredCategories}
          keyExtractor={item => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
          ListEmptyComponent={
            <View style={styles.center}>
              <Icon name={searchQuery ? 'search-off' : 'category'} size={48} color={Colors.textLight} />
              <AppText variant="body" color="textSecondary" style={styles.centerMsg}>
                {searchQuery ? `No categories match "${searchQuery}"` : 'No categories yet'}
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
  // Search
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
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: Colors.text,
    paddingVertical: 0,
  },
  // AppBar actions
  appBarActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  appBarBtn: {
    padding: 4,
    alignItems: 'center',
  },
  appBarBtnText: {
    fontSize: 10,
    color: Colors.white,
    fontWeight: '600',
    marginTop: 2,
  },
  // List
  list: { paddingBottom: 100 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.divider,
    gap: 14,
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
  sortBadge: {
    backgroundColor: Colors.divider,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  sortText: { fontSize: 11, color: Colors.textSecondary, fontWeight: '600' },
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
  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: Colors.overlay,
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    paddingBottom: 36,
    gap: 14,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: Colors.text,
  },
  formatHint: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: Colors.infoLight,
    borderRadius: 10,
    padding: 10,
  },
  formatHintText: {
    flex: 1,
    fontSize: 12,
    color: Colors.info,
    lineHeight: 18,
  },
  templateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    backgroundColor: Colors.primaryMuted,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  templateBtnText: {
    fontSize: 13,
    color: Colors.primary,
    fontWeight: '600',
  },
  pasteInput: {
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: 10,
    padding: 12,
    fontSize: 13,
    color: Colors.text,
    minHeight: 160,
    maxHeight: 260,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  modalActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 4,
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Colors.border,
    alignItems: 'center',
  },
  importBtn: {
    flex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: Colors.primary,
    paddingVertical: 13,
    borderRadius: 12,
  },
  importBtnDisabled: {
    opacity: 0.5,
  },
  importBtnText: {
    color: Colors.white,
    fontWeight: '700',
    fontSize: 15,
  },
});

export default CategoriesListScreen;
