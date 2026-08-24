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
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import Colors from '../../theme/colors';
import AppText from '../../components/AppText';
import AppBar from '../../components/AppBar';
import { useAlert } from '../../components/AppAlert';
import { getCampusesApi, createCampusApi, deleteCampusApi, getInvoiceHeadersApi, getSalesOrdersApi, ApiCampus } from '../../services/focusApi';

// ─── CSV helpers ──────────────────────────────────────────────────────────────
const CSV_HEADERS = ['campusCode', 'nameEn', 'nameKm', 'address', 'phone', 'active'];

const escapeCsv = (val: string | null | undefined): string => {
  const s = val ?? '';
  return s.includes(',') || s.includes('"') || s.includes('\n')
    ? `"${s.replace(/"/g, '""')}"`
    : s;
};

const toCsvRow = (c: ApiCampus): string =>
  [c.campusCode, c.nameEn, c.nameKm, c.address ?? '', c.phone ?? '', c.active === false ? 'false' : 'true']
    .map(escapeCsv).join(',');

const parseCsvLine = (line: string): string[] => {
  const result: string[] = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuote && line[i + 1] === '"') { cur += '"'; i++; }
      else { inQuote = !inQuote; }
    } else if (ch === ',' && !inQuote) {
      result.push(cur.trim()); cur = '';
    } else {
      cur += ch;
    }
  }
  result.push(cur.trim());
  return result;
};

interface Props {
  onBack: () => void;
  onCreate: () => void;
  onEdit: (campus: ApiCampus) => void;
}

const CAMPUS_COLORS = [
  '#2563EB', '#7C3AED', '#10B981', '#F59E0B',
  '#EF4444', '#06B6D4', '#F97316', '#EC4899',
];

const CAMPUS_ICONS = [
  'location-city', 'account-balance', 'school', 'business',
  'explore', 'domain', 'apartment', 'home-work',
];

const CampusListScreen: React.FC<Props> = ({ onBack, onCreate, onEdit }) => {
  const { showAlert } = useAlert();
  const [campuses, setCampuses] = useState<ApiCampus[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [usedCampusIds, setUsedCampusIds] = useState<Set<string>>(new Set());

  const load = useCallback((silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    Promise.all([
      getCampusesApi(),
      getInvoiceHeadersApi().catch(() => []),
      getSalesOrdersApi().catch(() => []),
    ])
      .then(([data, invoices, orders]) => {
        setCampuses([...data].sort((a, b) => Number(b.id) - Number(a.id)));
        const ids = new Set<string>([
          ...invoices.map(i => String(i.campusId)).filter(Boolean),
          ...orders.map(o  => String(o.campusId ?? '')).filter(v => v && v !== 'null'),
        ]);
        setUsedCampusIds(ids);
      })
      .catch(err => setError(err?.message ?? 'Failed to load campuses'))
      .finally(() => { setLoading(false); setRefreshing(false); });
  }, []);

  useEffect(() => { load(); }, [load]);

  const onRefresh = () => { setRefreshing(true); load(true); };

  // ── Export CSV ───────────────────────────────────────────────────────────────
  const [exporting, setExporting] = useState(false);
  const handleExport = async () => {
    if (campuses.length === 0) {
      showAlert({ type: 'info', title: 'Nothing to Export', message: 'No campuses to export.' });
      return;
    }
    setExporting(true);
    try {
      const rows = [CSV_HEADERS.join(','), ...campuses.map(toCsvRow)].join('\n');
      const path = `${FileSystem.documentDirectory}campuses_export.csv`;
      await FileSystem.writeAsStringAsync(path, rows);
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) await Sharing.shareAsync(path, { mimeType: 'text/csv', dialogTitle: 'Export Campuses CSV' });
    } catch (err: any) {
      if (err?.message !== 'User did not share') {
        showAlert({ type: 'error', title: 'Export Failed', message: err?.message ?? 'Could not export CSV.' });
      }
    } finally {
      setExporting(false);
    }
  };

  // ── Import CSV ───────────────────────────────────────────────────────────────
  const readCsvFile = async (uri: string): Promise<string> => {
    try {
      // fetch handles encoding automatically (UTF-8, UTF-16, BOM stripping)
      const response = await fetch(uri);
      const text = await response.text();
      return text.replace(/^﻿/, ''); // strip BOM if present
    } catch {
      // Fallback: read directly as UTF-8
      const text = await FileSystem.readAsStringAsync(uri);
      return text.replace(/^﻿/, '');
    }
  };

  const [importing, setImporting] = useState(false);
  const handleImport = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
      if (res.canceled) return;
      const file = res.assets[0];
      const content = await readCsvFile(file.uri);
      const lines = content.split(/\r?\n/).filter(l => l.trim());
      if (lines.length < 2) {
        showAlert({ type: 'error', title: 'Invalid File', message: 'CSV must have a header row and at least one data row.' });
        return;
      }

      // Parse header — strip BOM, whitespace, make lowercase
      const rawHeader = parseCsvLine(lines[0]).map(h =>
        h.replace(/^﻿/, '').toLowerCase().replace(/[\s_-]/g, ''),
      );
      const col = (name: string) => rawHeader.indexOf(name);
      if (col('campuscode') === -1 || col('nameen') === -1) {
        showAlert({
          type: 'error',
          title: 'Invalid CSV Headers',
          message:
            `Required columns not found.\n\nDetected: ${rawHeader.join(', ')}\n\nExpected at minimum: campusCode, nameEn`,
        });
        return;
      }

      const rows = lines.slice(1).map(l => parseCsvLine(l));
      showAlert({
        type: 'confirm',
        title: 'Import Campuses',
        message: `Import ${rows.length} campus row${rows.length !== 1 ? 'es' : ''}? Existing campuses will not be changed.`,
        actions: [
          { label: 'Cancel', variant: 'outline' },
          {
            label: 'Import',
            variant: 'primary',
            onPress: async () => {
              setImporting(true);
              let success = 0;
              const errors: string[] = [];

              for (let i = 0; i < rows.length; i++) {
                const row        = rows[i];
                const campusCode = row[col('campuscode')]?.trim();
                const nameEn     = row[col('nameen')]?.trim();
                const nameKm     = (col('namekm') >= 0 ? row[col('namekm')]?.trim() : '') || nameEn || '';
                const address    = col('address') >= 0 ? row[col('address')]?.trim() : '';
                const phone      = col('phone')   >= 0 ? row[col('phone')]?.trim()   : '';

                if (!campusCode || !nameEn) {
                  errors.push(`Row ${i + 2}: missing campusCode or nameEn`);
                  continue;
                }
                const payload = {
                  campusCode, nameEn, nameKm,
                  ...(address ? { address } : {}),
                  ...(phone   ? { phone }   : {}),
                };
                try {
                  await createCampusApi(payload);
                  success++;
                } catch (err: any) {
                  const body = err?.response?.data;
                  const msg =
                    body?.error?.messageKey ?? body?.error?.message ??
                    body?.message ?? body?.errors?.[0]?.message ??
                    err?.message ?? 'unknown error';
                  errors.push(`Row ${i + 2} (${campusCode}): ${msg}`);
                }
              }

              setImporting(false);
              load(true);
              showAlert({
                type: success > 0 ? 'success' : 'error',
                title: 'Import Complete',
                message: success === rows.length
                  ? `All ${success} campuses imported successfully.`
                  : `${success} imported, ${errors.length} failed.\n\n${errors.slice(0, 5).join('\n')}${errors.length > 5 ? `\n…and ${errors.length - 5} more` : ''}`,
              });
            },
          },
        ],
      });
    } catch (err: any) {
      showAlert({ type: 'error', title: 'Import Failed', message: err?.message ?? 'Could not read file.' });
    }
  };

  // ── Download Template ────────────────────────────────────────────────────────
  const handleTemplate = async () => {
    try {
      const rows = [
        CSV_HEADERS.join(','),
        'CEN,Central Campus,សាខាកណ្ដាល,Phnom Penh,+855 23 123 456,true',
        'PP2,PP Branch 2,,Street 271,,true',
      ].join('\n');
      const path = `${FileSystem.documentDirectory}campus_template.csv`;
      await FileSystem.writeAsStringAsync(path, rows);
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) await Sharing.shareAsync(path, { mimeType: 'text/csv', dialogTitle: 'Campus Import Template' });
    } catch (err: any) {
      if (err?.message !== 'User did not share') {
        showAlert({ type: 'error', title: 'Template Failed', message: err?.message ?? 'Could not create template.' });
      }
    }
  };

  const filteredCampuses = searchQuery.trim()
    ? campuses.filter(c => {
        const q = searchQuery.toLowerCase();
        return c.nameEn?.toLowerCase().includes(q) || c.nameKm?.toLowerCase().includes(q) || c.campusCode?.toLowerCase().includes(q);
      })
    : campuses;

  const handleDelete = (campus: ApiCampus) => {
    showAlert({
      type: 'confirm',
      title: 'Delete Campus',
      message: `Are you sure you want to delete "${campus.nameEn || campus.nameKm}"? This action cannot be undone.`,
      actions: [
        { label: 'Cancel', variant: 'outline' },
        {
          label: 'Delete',
          variant: 'danger',
          onPress: async () => {
            setDeletingId(String(campus.id));
            try {
              await deleteCampusApi(String(campus.id));
              setCampuses(prev => prev.filter(c => c.id !== campus.id));
            } catch (err: any) {
              showAlert({ type: 'error', title: 'Error', message: err?.message ?? 'Failed to delete campus' });
            } finally {
              setDeletingId(null);
            }
          },
        },
      ],
    });
  };

  const renderItem = ({ item, index }: { item: ApiCampus; index: number }) => {
    const color = CAMPUS_COLORS[index % CAMPUS_COLORS.length];
    const icon = CAMPUS_ICONS[index % CAMPUS_ICONS.length];
    const isDeleting = deletingId === item.id;
    const isReferenced = usedCampusIds.has(String(item.id));

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
        </View>
        <View style={styles.codeBadge}>
          <AppText style={styles.codeText}>{item.campusCode}</AppText>
        </View>
        <View style={[styles.activeBadge, item.active === false ? styles.inactiveBadge : null]}>
          <AppText style={[styles.activeText, item.active === false ? styles.inactiveText : null]}>
            {item.active === false ? 'Inactive' : 'Active'}
          </AppText>
        </View>
        {isDeleting ? (
          <ActivityIndicator size="small" color={Colors.error} style={styles.deleteBtn} />
        ) : (
          <TouchableOpacity
            style={[styles.deleteBtn, isReferenced && styles.deleteBtnDisabled]}
            onPress={() => {
              if (isReferenced) {
                showAlert({
                  type: 'info',
                  title: 'Cannot Delete',
                  message: `"${item.nameEn || item.campusCode}" has linked records (invoices or orders) and cannot be deleted.`,
                });
                return;
              }
              handleDelete(item);
            }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Icon
              name={isReferenced ? 'lock-outline' : 'delete-outline'}
              size={20}
              color={isReferenced ? Colors.textLight : Colors.error}
            />
          </TouchableOpacity>
        )}
      </TouchableOpacity>
    );
  };

  const subtitle = searchQuery
    ? `${filteredCampuses.length} of ${campuses.length} campuses`
    : campuses.length > 0
    ? `${campuses.length} locations`
    : 'Campus locations';

  return (
    <View style={styles.safe}>
      <AppBar
        title="Campus"
        subtitle={subtitle}
        titleAlign="left"
        showBack
        onBack={onBack}
      />

      {/* Search + toolbar */}
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

      <View style={styles.toolbarRow}>
        <TouchableOpacity
          style={[styles.toolbarBtn, styles.toolbarBtnTemplate]}
          onPress={handleTemplate}
        >
          <Icon name="article" size={15} color="#7C3AED" />
          <AppText style={[styles.toolbarBtnText, { color: '#7C3AED' }]}>Template</AppText>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.toolbarBtn, styles.toolbarBtnImport]}
          onPress={handleImport}
          disabled={importing}
        >
          {importing
            ? <ActivityIndicator size="small" color={Colors.primary} />
            : <Icon name="upload-file" size={15} color={Colors.primary} />}
          <AppText style={[styles.toolbarBtnText, { color: Colors.primary }]}>
            {importing ? 'Importing…' : 'Import'}
          </AppText>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.toolbarBtn, styles.toolbarBtnExport]}
          onPress={handleExport}
          disabled={exporting || campuses.length === 0}
        >
          {exporting
            ? <ActivityIndicator size="small" color={Colors.white} />
            : <Icon name="download" size={15} color={Colors.white} />}
          <AppText style={[styles.toolbarBtnText, { color: Colors.white }]}>
            {exporting ? 'Exporting…' : `Export (${campuses.length})`}
          </AppText>
        </TouchableOpacity>
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
          data={filteredCampuses}
          keyExtractor={item => String(item.id)}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
          ListEmptyComponent={
            <View style={styles.center}>
              <Icon name={searchQuery ? 'search-off' : 'location-city'} size={48} color={Colors.textLight} />
              <AppText variant="body" color="textSecondary" style={styles.centerMsg}>
                {searchQuery ? `No campuses match "${searchQuery}"` : 'No campuses yet'}
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
  deleteBtn: {
    padding: 4,
  },
  deleteBtnDisabled: {
    opacity: 0.4,
  },
  toolbarRow: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  toolbarBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 9,
    borderRadius: 10,
  },
  toolbarBtnTemplate: {
    borderWidth: 1.5,
    borderColor: '#7C3AED',
    backgroundColor: '#F5F3FF',
  },
  toolbarBtnImport: {
    borderWidth: 1.5,
    borderColor: Colors.primary,
    backgroundColor: Colors.primaryMuted,
  },
  toolbarBtnExport: {
    backgroundColor: Colors.primary,
  },
  toolbarBtnText: {
    fontSize: 13,
    fontWeight: '700',
  },
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

export default CampusListScreen;
