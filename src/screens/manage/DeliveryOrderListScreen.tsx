import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  TextInput,
  Modal,
  Dimensions,
} from 'react-native';
import { WebView } from 'react-native-webview';
import * as Print from 'expo-print';
import { MaterialIcons as Icon } from '@expo/vector-icons';
import Colors from '../../theme/colors';
import AppText from '../../components/AppText';
import AppBar from '../../components/AppBar';
import { useAlert } from '../../components/AppAlert';
import LOGO_BASE64 from '../../logo/logoBase64';
import {
  getDeliveryOrdersApi,
  getDeliveryOrderApi,
  getAllProductsApi,
  getCampusesApi,
  ApiDeliveryOrder,
  ApiProduct,
  ApiCampus,
} from '../../services/focusApi';

interface Props {
  onBack: () => void;
  onCreate?: () => void;
}

// ─── Company config ────────────────────────────────────────────────────────────

const COMPANY = {
  name:    'FOCUS LAB',
  addr1:   '#17 St 480, Sangkat Toul Toum Pong 1',
  addr2:   'Khan Chamkarmon, Phnom Penh 12310',
  contact: 'SEN Sovithia  ·  0964222816  ·  sen.sov@gmail.com',
};

// ─── A5 dimensions ─────────────────────────────────────────────────────────────

const A5_PX   = 559;
const A5_H    = 794;
const ROW_H   = 26;
const THEAD_H = 28;
const NON_TABLE = 420;
const MAX_ROWS  = Math.floor((A5_H - NON_TABLE - THEAD_H) / ROW_H) + 2;

// ─── Status colours ────────────────────────────────────────────────────────────

const STATUS_COLOR: Record<string, { bg: string; text: string; label: string }> = {
  draft:      { bg: '#FEF3C7', text: '#D97706', label: 'Draft' },
  confirmed:  { bg: '#DBEAFE', text: '#2563EB', label: 'Confirmed' },
  delivering: { bg: '#ECFDF5', text: '#059669', label: 'Delivering' },
  delivered:  { bg: '#D1FAE5', text: '#10B981', label: 'Delivered' },
  cancelled:  { bg: '#FEE2E2', text: '#EF4444', label: 'Cancelled' },
};

type TabKey = 'all' | 'confirmed' | 'delivering' | 'delivered';
const TABS: { key: TabKey; label: string }[] = [
  { key: 'all',        label: 'All' },
  { key: 'confirmed',  label: 'Confirmed' },
  { key: 'delivering', label: 'Delivering' },
  { key: 'delivered',  label: 'Delivered' },
];

// ─── Helpers ───────────────────────────────────────────────────────────────────

const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return (
      d.toLocaleDateString('en-US', { day: 'numeric', month: 'numeric', year: '2-digit' }) +
      ' ' +
      d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })
    );
  } catch { return iso; }
};

const _arrayBufferToBase64 = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer);
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let result = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i], b1 = bytes[i + 1] ?? 0, b2 = bytes[i + 2] ?? 0;
    result += chars[b0 >> 2];
    result += chars[((b0 & 3) << 4) | (b1 >> 4)];
    result += i + 1 < bytes.length ? chars[((b1 & 15) << 2) | (b2 >> 6)] : '=';
    result += i + 2 < bytes.length ? chars[b2 & 63] : '=';
  }
  return result;
};

const fetchImageBase64 = async (url: string): Promise<string | null> => {
  try {
    const res = await fetch(url);
    const buf = await res.arrayBuffer();
    const b64 = _arrayBufferToBase64(buf);
    const ct  = res.headers.get('content-type') ?? 'image/png';
    return `data:${ct};base64,${b64}`;
  } catch { return null; }
};

// ─── HTML builder ──────────────────────────────────────────────────────────────

const buildHTML = (
  order: ApiDeliveryOrder,
  productMap: Record<string, ApiProduct>,
  campusMap: Record<string, ApiCampus>,
  sigData: string | null,
  previewWidth?: number,
): string => {
  const isPreview = !!previewWidth;
  const scale     = isPreview ? previewWidth! / A5_PX : 1;
  const docW      = isPreview ? previewWidth! : A5_PX;
  const docH      = isPreview ? Math.round(docW * (A5_H / A5_PX)) : A5_H;

  const refNo    = order.referenceNumber ?? order.doRef ?? order.doNumber ?? order.ref ?? order.id;
  const campusVal = order.campusId != null
    ? campusMap[String(order.campusId)]?.campusCode ?? campusMap[String(order.campusId)]?.nameEn ?? String(order.campusId)
    : '—';

  const items = (order.items ?? []).map((item, i) => {
    const product = productMap[item.productId];
    const nameEn  = item.productNameEn ?? item.productName ?? product?.nameEn ?? `Item ${i + 1}`;
    const nameKm  = product?.nameKm ?? '';
    const desc    = nameKm ? `${nameKm} - ${nameEn}` : nameEn;
    const barcode = product?.sku ?? item.productId;
    const size    = product?.size ?? '';
    return { no: i + 1, barcode, desc, size, qty: item.qty };
  });

  const fillerCount = Math.max(0, MAX_ROWS - items.length);
  const fillerRows  = Array.from({ length: fillerCount })
    .map(() => `<tr><td></td><td></td><td></td><td></td></tr>`)
    .join('');

  const dataRows = items.map(it => `
    <tr>
      <td class="c">${it.no}</td>
      <td class="c sm">${it.barcode}</td>
      <td class="l" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:0;">${it.desc}</td>
      <td class="c">${it.qty}</td>
    </tr>`).join('');

  const scalerCSS = isPreview ? `
  .scaler {
    width:${A5_PX}px;height:${A5_H}px;
    transform:scale(${scale.toFixed(6)});transform-origin:top left;
  }` : '';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=${docW},initial-scale=1.0"/>
<style>
  @page{size:A5 portrait;margin:0;}
  *,*::before,*::after{margin:0;padding:0;box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
  html{width:${isPreview?docW:A5_PX}px;height:${isPreview?docH:A5_H}px;max-height:${isPreview?docH:A5_H}px;overflow:hidden;}
  body{width:${isPreview?docW:A5_PX}px;height:${isPreview?docH:A5_H}px;max-height:${isPreview?docH:A5_H}px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;font-size:10px;color:#000;background:#fff;page-break-after:avoid;}
  ${scalerCSS}
  .page{position:relative;width:${A5_PX}px;height:${A5_H}px;max-height:${A5_H}px;padding:22px 28px 0;overflow:hidden;page-break-after:avoid;}
  @media print{html,body,.page{max-height:${A5_H}px!important;overflow:hidden!important;page-break-after:avoid!important;}}
  .hdr{display:flex;align-items:flex-start;margin-bottom:6px;}
  .logo{width:64px;height:64px;border-radius:10px;overflow:hidden;flex-shrink:0;}
  .logo img{width:64px;height:64px;display:block;}
  .hdr-mid{flex:1;text-align:center;padding:0 10px;}
  .co-name{font-size:14px;font-weight:900;letter-spacing:2px;text-transform:uppercase;}
  .co-addr{font-size:8px;color:#555;line-height:1.6;margin:2px 0 4px;}
  .do-title{font-size:16px;font-weight:900;text-decoration:underline;letter-spacing:1px;}
  .hdr-right{width:64px;}
  .hr{border:none;border-top:1.5px solid #000;margin:3px 0 5px;}
  .info-row{display:flex;border:1px solid #000;margin-bottom:5px;}
  .info-box{flex:1;padding:4px 8px;line-height:1.7;font-size:10px;}
  .info-box+.info-box{border-left:1px solid #000;}
  b{font-weight:700;}
  .tbl-wrap{border:1px solid #000;overflow:hidden;}
  table{width:100%;border-collapse:collapse;table-layout:fixed;}
  thead tr{height:${THEAD_H}px;}
  thead th{background:#efefef;border-bottom:1.5px solid #000;border-right:1px solid #000;padding:0 3px;font-size:10px;font-weight:700;text-align:center;white-space:nowrap;height:${THEAD_H}px;}
  thead th:last-child{border-right:none;}
  tbody tr{height:${ROW_H}px;}
  tbody td{height:${ROW_H}px;border-bottom:1px solid #e0e0e0;border-right:1px solid #000;padding:0 4px;font-size:14px;vertical-align:middle;overflow:hidden;white-space:nowrap;}
  tbody td:last-child{border-right:none;}
  tbody tr:last-child td{border-bottom:none;}
  .c{text-align:center;}.r{text-align:right;}.l{text-align:left;}
  .sm{font-size:8px;}
  colgroup col.no{width:22px;}colgroup col.bar{width:60px;}colgroup col.qty{width:44px;}
  .footer{position:absolute;bottom:0;left:0;right:0;padding:0 28px 18px;background:#fff;}
  .sig-section{border:1px solid #000;display:flex;margin-top:6px;}
  .sig-col{flex:1;text-align:center;font-size:10px;font-weight:600;padding:8px 4px 10px;border-right:1px solid #000;}
  .sig-col:last-child{border-right:none;}
  .sig-line{border-bottom:1px solid #000;margin:4px 8px 8px;height:90px;}
  .sig-img{width:100%;height:100%;object-fit:contain;}
  .note-row{font-size:10px;margin-top:5px;padding:4px 6px;border:1px solid #ddd;border-radius:4px;color:#444;}
</style>
</head>
<body>
${isPreview?'<div class="scaler">':''}
<div class="page">
  <div class="hdr">
    <div class="logo"><img src="${LOGO_BASE64}"/></div>
    <div class="hdr-mid">
      <div class="co-name">${COMPANY.name}</div>
      <div class="co-addr">${COMPANY.addr1}<br/>${COMPANY.addr2}<br/>${COMPANY.contact}</div>
      <div class="do-title">DELIVERY ORDER</div>
    </div>
    <div class="hdr-right"></div>
  </div>
  <div class="hr"></div>
  <div class="info-row">
    <div class="info-box"><b>To:</b> ${campusVal}<br/><b>Date:</b> ${fmtDate(order.deliveredAt ?? order.createdAt)}</div>
    <div class="info-box"><b>Delivery Number:</b> ${refNo}<br/><b>Received By:</b> ${order.receivedBy ?? '—'}</div>
  </div>
  <div class="tbl-wrap">
    <table>
      <colgroup><col class="no"/><col class="bar"/><col/><col class="qty"/></colgroup>
      <thead><tr><th>No</th><th>Barcode</th><th class="l">Description</th><th>TotalQty</th></tr></thead>
      <tbody>${dataRows}${fillerRows}</tbody>
    </table>
  </div>
  <div class="footer">
    ${order.note?`<div class="note-row"><b>Note:</b> ${order.note}</div>`:''}
    <div class="sig-section">
      <div class="sig-col"><div class="sig-line"></div>Prepare By</div>
      <div class="sig-col"><div class="sig-line"></div>Delivered By</div>
      <div class="sig-col"><div class="sig-line">${sigData?`<img class="sig-img" src="${sigData}"/>`:''}  </div>Received By</div>
    </div>
  </div>
</div>
${isPreview?'</div>':''}
</body>
</html>`;
};

// ─── Screen ────────────────────────────────────────────────────────────────────

const DeliveryOrderListScreen: React.FC<Props> = ({ onBack, onCreate }) => {
  const { showAlert } = useAlert();

  const [orders, setOrders]         = useState<ApiDeliveryOrder[]>([]);
  const [productMap, setProductMap] = useState<Record<string, ApiProduct>>({});
  const [campusMap, setCampusMap]   = useState<Record<string, ApiCampus>>({});
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [search, setSearch]         = useState('');
  const [tab, setTab]               = useState<TabKey>('all');

  const [printingId, setPrintingId]       = useState<string | null>(null);
  const [previewHtml, setPreviewHtml]     = useState<string>('');
  const [previewLoading, setPreviewLoading] = useState(false);

  const load = useCallback((silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    Promise.all([
      getDeliveryOrdersApi(),
      getAllProductsApi(),
      getCampusesApi().catch(() => [] as ApiCampus[]),
    ])
      .then(([dos, products, campuses]) => {
        setOrders([...dos].sort((a, b) => Number(a.id) - Number(b.id)));
        const pm: Record<string, ApiProduct> = {};
        products.forEach(p => { pm[p.id] = p; });
        setProductMap(pm);
        const cm: Record<string, ApiCampus> = {};
        campuses.forEach(c => { cm[String(c.id)] = c; });
        setCampusMap(cm);
      })
      .catch(err => setError(err?.message ?? 'Failed to load delivery orders'))
      .finally(() => { setLoading(false); setRefreshing(false); });
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    let list = tab === 'all' ? orders : orders.filter(o => (o.status ?? '').toLowerCase() === tab);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(o =>
        (o.referenceNumber ?? o.doRef ?? o.doNumber ?? o.ref ?? '').toLowerCase().includes(q) ||
        String(o.campusId ?? '').toLowerCase().includes(q) ||
        (o.receivedBy ?? '').toLowerCase().includes(q),
      );
    }
    return list;
  }, [orders, tab, search]);

  const handlePreview = async (order: ApiDeliveryOrder) => {
    setPreviewHtml('');
    setPreviewLoading(true);
    try {
      const detail = await getDeliveryOrderApi(order.id);
      const sigData = detail.signatureUrl ? await fetchImageBase64(detail.signatureUrl) : null;
      const pw  = Dimensions.get('window').width - 16;
      const html = buildHTML(detail, productMap, campusMap, sigData, pw);
      setPreviewHtml(html);
    } catch (err: any) {
      showAlert({ type: 'error', title: 'Preview Error', message: err?.message ?? 'Failed to load preview' });
    } finally {
      setPreviewLoading(false);
    }
  };

  const handlePrint = async (order: ApiDeliveryOrder) => {
    setPrintingId(order.id);
    try {
      const detail = await getDeliveryOrderApi(order.id);
      const sigData = detail.signatureUrl ? await fetchImageBase64(detail.signatureUrl) : null;
      const html = buildHTML(detail, productMap, campusMap, sigData);
      await Print.printAsync({ html });
    } catch (err: any) {
      if (err?.message !== 'User cancelled') {
        showAlert({ type: 'error', title: 'Print Error', message: err?.message ?? 'Failed to print' });
      }
    } finally {
      setPrintingId(null);
    }
  };

  const closePreview = () => { setPreviewHtml(''); setPreviewLoading(false); };

  const renderItem = ({ item }: { item: ApiDeliveryOrder }) => {
    const ref      = item.referenceNumber ?? item.doRef ?? item.doNumber ?? item.ref ?? item.id;
    const statusK  = (item.status ?? 'draft').toLowerCase();
    const s        = STATUS_COLOR[statusK] ?? { bg: '#F0F0F0', text: '#888', label: item.status ?? 'Draft' };
    const campus   = item.campusId != null
      ? campusMap[String(item.campusId)]?.campusCode ?? campusMap[String(item.campusId)]?.nameEn ?? String(item.campusId)
      : null;
    const itemCount  = item.items?.length ?? 0;
    const isPrinting = printingId === item.id;

    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Icon name="local-shipping" size={16} color="#2563EB" />
          <View style={styles.refRow}>
            <AppText style={styles.refText} numberOfLines={1}>{ref}</AppText>
            {campus ? (
              <View style={styles.campusChip}>
                <AppText style={styles.campusChipText}>{campus}</AppText>
              </View>
            ) : null}
          </View>
          <View style={[styles.statusBadge, { backgroundColor: s.bg }]}>
            <AppText style={[styles.statusText, { color: s.text }]}>{s.label}</AppText>
          </View>
        </View>

        <View style={styles.cardMeta}>
          {item.receivedBy ? (
            <View style={styles.metaItem}>
              <Icon name="person" size={13} color={Colors.textSecondary} />
              <AppText variant="caption" color="textSecondary">{item.receivedBy}</AppText>
            </View>
          ) : null}
          <View style={styles.metaItem}>
            <Icon name="calendar-today" size={13} color={Colors.textSecondary} />
            <AppText variant="caption" color="textSecondary">{fmtDate(item.deliveredAt ?? item.createdAt)}</AppText>
          </View>
          {itemCount > 0 ? (
            <View style={styles.metaItem}>
              <Icon name="inventory" size={13} color={Colors.textSecondary} />
              <AppText variant="caption" color="textSecondary">{itemCount} item{itemCount !== 1 ? 's' : ''}</AppText>
            </View>
          ) : null}
        </View>

        <View style={styles.cardFooter}>
          <AppText style={styles.footerSpacer} />
          {/* Preview */}
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: '#EFF6FF' }]}
            onPress={() => handlePreview(item)}
            activeOpacity={0.75}
          >
            <Icon name="visibility" size={16} color="#2563EB" />
            <AppText style={[styles.actionBtnText, { color: '#2563EB' }]}>Preview</AppText>
          </TouchableOpacity>
          {/* Print */}
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: '#FEF3C7' }]}
            onPress={() => handlePrint(item)}
            disabled={isPrinting}
            activeOpacity={0.75}
          >
            {isPrinting
              ? <ActivityIndicator size="small" color="#D97706" />
              : <Icon name="print" size={16} color="#D97706" />}
            <AppText style={[styles.actionBtnText, { color: '#D97706' }]}>Print</AppText>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const subtitle = search
    ? `${filtered.length} of ${orders.length} orders`
    : orders.length > 0 ? `${orders.length} order${orders.length !== 1 ? 's' : ''}` : 'Delivery orders';

  return (
    <View style={styles.safe}>
      <AppBar title="Delivery Orders" subtitle={subtitle} titleAlign="left" showBack onBack={onBack} />

      {/* Search */}
      <View style={styles.searchRow}>
        <Icon name="search" size={20} color={Colors.textSecondary} style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search by ref, campus, received by..."
          placeholderTextColor={Colors.textLight}
          value={search}
          onChangeText={setSearch}
          returnKeyType="search"
          clearButtonMode="while-editing"
        />
        {search ? (
          <TouchableOpacity onPress={() => setSearch('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Icon name="close" size={18} color={Colors.textSecondary} />
          </TouchableOpacity>
        ) : null}
      </View>

      {/* Tabs */}
      <View style={styles.tabRow}>
        {TABS.map(t => (
          <TouchableOpacity
            key={t.key}
            style={[styles.tab, tab === t.key && styles.tabActive]}
            onPress={() => setTab(t.key)}
            activeOpacity={0.7}
          >
            <AppText style={[styles.tabText, tab === t.key && styles.tabTextActive]}>
              {t.label}
            </AppText>
          </TouchableOpacity>
        ))}
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
          data={filtered}
          keyExtractor={item => String(item.id)}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); load(true); }}
              tintColor={Colors.primary}
            />
          }
          ListEmptyComponent={
            <View style={styles.center}>
              <Icon name={search ? 'search-off' : 'local-shipping'} size={48} color={Colors.textLight} />
              <AppText variant="body" color="textSecondary" style={styles.centerMsg}>
                {search ? `No orders match "${search}"` : 'No delivery orders yet'}
              </AppText>
            </View>
          }
        />
      )}

      {/* FAB */}
      {onCreate ? (
        <TouchableOpacity style={styles.fab} onPress={onCreate} activeOpacity={0.85}>
          <Icon name="add" size={28} color="#fff" />
        </TouchableOpacity>
      ) : null}

      {/* Preview Modal */}
      <Modal
        visible={previewLoading || previewHtml !== ''}
        transparent={false}
        animationType="slide"
        onRequestClose={closePreview}
      >
        <View style={styles.previewModal}>
          <View style={styles.previewHeader}>
            <AppText style={styles.previewTitle}>Preview</AppText>
            <TouchableOpacity
              onPress={closePreview}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Icon name="close" size={24} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
          {previewLoading ? (
            <View style={styles.center}>
              <ActivityIndicator size="large" color="#FFFFFF" />
              <AppText style={styles.previewLoadingText}>Loading preview…</AppText>
            </View>
          ) : (
            <View style={styles.previewContent}>
              <WebView
                source={{ html: previewHtml, baseUrl: '' }}
                originWhitelist={['*']}
                style={{
                  width: Dimensions.get('window').width - 16,
                  height: Math.round(A5_H * ((Dimensions.get('window').width - 16) / A5_PX)),
                }}
                scrollEnabled={false}
              />
            </View>
          )}
        </View>
      </Modal>
    </View>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },

  searchRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.surface,
    marginHorizontal: 16, marginTop: 12, marginBottom: 4,
    borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8,
    borderWidth: 1, borderColor: Colors.border,
  },
  searchIcon: { marginRight: 8 },
  searchInput: { flex: 1, fontSize: 12, color: Colors.text, paddingVertical: 0 },

  tabRow: {
    flexDirection: 'row',
    marginHorizontal: 16, marginVertical: 6,
    backgroundColor: Colors.surface,
    borderRadius: 10, borderWidth: 1, borderColor: Colors.border,
    overflow: 'hidden',
  },
  tab: { flex: 1, paddingVertical: 8, alignItems: 'center' },
  tabActive: { backgroundColor: Colors.primary },
  tabText: { fontSize: 12, color: Colors.textSecondary, fontWeight: '500' },
  tabTextActive: { color: '#fff', fontWeight: '700' },

  list: { padding: 12, gap: 10, paddingBottom: 40 },

  card: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 8,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  refRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  refText: { fontSize: 12, fontWeight: '700', color: Colors.text },
  campusChip: {
    backgroundColor: Colors.primaryMuted,
    borderRadius: 5, paddingHorizontal: 7, paddingVertical: 2,
  },
  campusChipText: { fontSize: 12, color: Colors.primary, fontWeight: '700' },
  statusBadge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  statusText: { fontSize: 12, fontWeight: '700' },

  cardMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },

  cardFooter: {
    flexDirection: 'row', alignItems: 'center',
    borderTopWidth: 1, borderTopColor: Colors.divider,
    paddingTop: 10, gap: 8,
  },
  footerSpacer: { flex: 1 },
  actionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6,
  },
  actionBtnText: { fontSize: 12, fontWeight: '700' },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  centerMsg: { textAlign: 'center' },
  retryBtn: {
    paddingHorizontal: 24, paddingVertical: 10,
    borderRadius: 8, borderWidth: 1.5, borderColor: Colors.primary,
  },

  previewModal: { flex: 1, backgroundColor: '#1E293B' },
  previewHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14, paddingTop: 50,
    backgroundColor: '#1E293B',
  },
  previewTitle: { fontSize: 12, fontWeight: '700', color: '#FFFFFF' },
  previewLoadingText: { fontSize: 12, color: '#94A3B8' },
  previewContent: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 8 },

  fab: {
    position: 'absolute', bottom: 28, right: 24,
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: Colors.primary,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4, shadowRadius: 12, elevation: 8,
  },
});

export default DeliveryOrderListScreen;
