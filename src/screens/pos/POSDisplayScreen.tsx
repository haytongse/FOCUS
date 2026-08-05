import React from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  StatusBar,
  TouchableOpacity,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AppText from '../../components/AppText';
import { CartItem } from '../../contexts/POSContext';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface POSDisplayScreenProps {
  cart: CartItem[];
  subtotalCents: number;
  discountPercent: number;
  discountCents: number;
  totalCents: number;
  onClose: () => void;
}

const fmt = (cents: number) => `$${(cents / 100).toFixed(2)}`;

const POSDisplayScreen: React.FC<POSDisplayScreenProps> = ({
  cart,
  discountPercent,
  discountCents,
  totalCents,
  onClose,
}) => {
  const isEmpty = cart.length === 0;

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <StatusBar barStyle="light-content" backgroundColor="#0F172A" />

      {/* Header */}
      <View style={styles.header}>
        <View style={styles.logoRow}>
          <View style={styles.logoBadge}>
            <AppText style={styles.logoLetter}>F</AppText>
          </View>
          <AppText style={styles.brand}>FOCUS POS</AppText>
        </View>
        <TouchableOpacity onPress={onClose} style={styles.closeBtn} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <AppText style={styles.closeText}>✕  Close Display</AppText>
        </TouchableOpacity>
      </View>

      <View style={styles.divider} />

      {isEmpty ? (
        /* ── Welcome / idle state ── */
        <View style={styles.welcomeContainer}>
          <View style={styles.welcomeBadge}>
            <AppText style={styles.welcomeIcon}>🛒</AppText>
          </View>
          <AppText style={styles.welcomeTitle}>Welcome!</AppText>
          <AppText style={styles.welcomeSub}>Your order will appear here</AppText>
        </View>
      ) : (
        /* ── Order summary ── */
        <View style={styles.orderContainer}>
          {/* Column headers */}
          <View style={styles.tableHeader}>
            <AppText style={[styles.colHeader, styles.colNo]}>#</AppText>
            <AppText style={[styles.colHeader, styles.colItem]}>Item</AppText>
            <AppText style={[styles.colHeader, styles.colQty]}>Qty</AppText>
            <AppText style={[styles.colHeader, styles.colPrice]}>Unit</AppText>
            <AppText style={[styles.colHeader, styles.colTotal]}>Total</AppText>
          </View>
          <View style={styles.tableHeaderDivider} />

          <FlatList
            data={cart}
            keyExtractor={item => item.product.id}
            style={styles.itemList}
            renderItem={({ item, index }) => (
              <View style={[styles.tableRow, index % 2 === 1 && styles.tableRowAlt]}>
                <AppText style={[styles.rowText, styles.colNo]}>{index + 1}</AppText>
                <AppText style={[styles.rowText, styles.colItem]} numberOfLines={2}>
                  {item.product.nameEn}
                </AppText>
                <AppText style={[styles.rowText, styles.colQty]}>{item.qty}</AppText>
                <AppText style={[styles.rowText, styles.colPrice]}>
                  {fmt(item.unitPriceCents)}
                </AppText>
                <AppText style={[styles.rowText, styles.colTotal, styles.rowTotalText]}>
                  {fmt(item.unitPriceCents * item.qty)}
                </AppText>
              </View>
            )}
          />
        </View>
      )}

      {/* ── Footer totals ── */}
      <View style={styles.footer}>
        <View style={styles.footerDivider} />
        <View style={styles.totalsRow}>
          {discountPercent > 0 && (
            <View style={styles.totalLine}>
              <AppText style={styles.totalLabel}>Discount ({discountPercent}%)</AppText>
              <AppText style={styles.totalValue}>-{fmt(discountCents)}</AppText>
            </View>
          )}
          <View style={styles.grandTotalLine}>
            <AppText style={styles.grandTotalLabel}>TOTAL</AppText>
            <AppText style={styles.grandTotalAmount}>{fmt(totalCents)}</AppText>
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 32,
    paddingVertical: 20,
  },
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  logoBadge: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#2563EB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoLetter: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '800',
  },
  brand: {
    color: '#F8FAFC',
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: 2,
  },
  closeBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
  },
  closeText: {
    color: '#94A3B8',
    fontSize: 14,
    fontWeight: '500',
  },
  divider: {
    height: 1,
    backgroundColor: '#1E293B',
    marginHorizontal: 32,
  },

  // Welcome state
  welcomeContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  welcomeBadge: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#1E293B',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  welcomeIcon: {
    fontSize: 52,
  },
  welcomeTitle: {
    color: '#F8FAFC',
    fontSize: 36,
    fontWeight: '700',
    letterSpacing: 1,
  },
  welcomeSub: {
    color: '#64748B',
    fontSize: 18,
    fontWeight: '400',
  },

  // Order table
  orderContainer: {
    flex: 1,
    paddingHorizontal: 32,
    paddingTop: 24,
  },
  tableHeader: {
    flexDirection: 'row',
    paddingVertical: 12,
  },
  tableHeaderDivider: {
    height: 1,
    backgroundColor: '#334155',
    marginBottom: 4,
  },
  colHeader: {
    color: '#64748B',
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 8,
    borderRadius: 8,
  },
  tableRowAlt: {
    backgroundColor: '#1E293B',
  },
  rowText: {
    color: '#E2E8F0',
    fontSize: 16,
    fontWeight: '400',
  },
  rowTotalText: {
    color: '#38BDF8',
    fontWeight: '600',
  },

  colNo:    { width: 40 },
  colItem:  { flex: 1, paddingRight: 8 },
  colQty:   { width: 60, textAlign: 'center' },
  colPrice: { width: SCREEN_WIDTH > 600 ? 120 : 90, textAlign: 'right' },
  colTotal: { width: SCREEN_WIDTH > 600 ? 140 : 100, textAlign: 'right' },

  itemList: {
    flex: 1,
  },

  // Footer
  footer: {
    paddingHorizontal: 32,
    paddingBottom: 24,
  },
  footerDivider: {
    height: 1,
    backgroundColor: '#334155',
    marginBottom: 20,
  },
  totalsRow: {
    alignItems: 'flex-end',
    gap: 10,
  },
  totalLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 24,
  },
  totalLabel: {
    color: '#94A3B8',
    fontSize: 16,
    fontWeight: '500',
  },
  totalValue: {
    color: '#F87171',
    fontSize: 18,
    fontWeight: '600',
    minWidth: 100,
    textAlign: 'right',
  },
  grandTotalLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 32,
    backgroundColor: '#1E293B',
    paddingHorizontal: 28,
    paddingVertical: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#2563EB',
  },
  grandTotalLabel: {
    color: '#94A3B8',
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: 2,
  },
  grandTotalAmount: {
    color: '#38BDF8',
    fontSize: SCREEN_WIDTH > 600 ? 42 : 32,
    fontWeight: '800',
    letterSpacing: 1,
    minWidth: 160,
    textAlign: 'right',
  },
});

export default POSDisplayScreen;
