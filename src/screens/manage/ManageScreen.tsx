import React, { useState, useEffect, useRef } from 'react';
import { View, FlatList, StyleSheet, TouchableOpacity } from 'react-native';
import { tabEvents } from '../../navigation/tabEvents';
import { MaterialIcons as Icon } from '@expo/vector-icons';
import Colors from '../../theme/colors';
import AppText from '../../components/AppText';
import AppBar from '../../components/AppBar';
import CategoriesListScreen from './CategoriesListScreen';
import CreateCategoryScreen from './CreateCategoryScreen';
import EditCategoryScreen from './EditCategoryScreen';
import ProductsListScreen from './ProductsListScreen';
import ProductFormScreen from './ProductFormScreen';
import UsersListScreen from './UsersListScreen';
import CreateUserScreen from './CreateUserScreen';
import EditUserScreen from './EditUserScreen';
import CampusListScreen from './CampusListScreen';
import CreateCampusScreen from './CreateCampusScreen';
import EditCampusScreen from './EditCampusScreen';
import LocationListScreen from './LocationListScreen';
import LocationFormScreen from './LocationFormScreen';
import SaleOrdersListScreen from './SaleOrdersListScreen';
import SaleInvoiceListScreen from './SaleInvoiceListScreen';
import PurchaseOrderListScreen from './PurchaseOrderListScreen';
import VendorListScreen from './VendorListScreen';
import VendorFormScreen from './VendorFormScreen';
import UomListScreen from './UomListScreen';
import UomFormScreen from './UomFormScreen';
import QuotationListScreen from './QuotationListScreen';
import RentalInvoiceFormScreen from './RentalInvoiceFormScreen';
import RentalInvoiceListScreen from './RentalInvoiceListScreen';
import RentalInvoicePrintScreen from './RentalInvoicePrintScreen';
import VendorPayablesScreen from './VendorPayablesScreen';
import CashierManageScreen from './CashierManageScreen';
import MovementItemsScreen from './MovementItemsScreen';
import IncomeStatementScreen from './IncomeStatementScreen';
import ExpensesScreen from './ExpensesScreen';
import InvoiceDetailExportScreen from './InvoiceDetailExportScreen';
import POExportScreen from './POExportScreen';
import { ApiProduct, ApiCampus, ApiVendor, ApiUom, ApiLocation, ApiCategory, ApiRentalInvoiceHeader, ApiUser } from '../../services/focusApi';

type ManageView =
  | 'hub'
  | 'categoryList' | 'categoryCreate' | 'categoryEdit'
  | 'productList'  | 'productCreate' | 'productEdit'
  | 'userList'     | 'userCreate'    | 'userEdit'
  | 'campusList'   | 'campusCreate'  | 'campusEdit'
  | 'locationList' | 'locationCreate' | 'locationEdit'
  | 'quotationList'
  | 'saleOrderList' | 'saleInvoiceList'
  | 'purchaseOrderList'
  | 'vendorList'   | 'vendorCreate'  | 'vendorEdit'
  | 'uomList'      | 'uomCreate'     | 'uomEdit'
  | 'rentalInvoiceList' | 'rentalInvoiceCreate' | 'rentalInvoiceView'
  | 'vendorPayables'
  | 'cashierManage'
  | 'movementItems'
  | 'incomeStatement'
  | 'expenses'
  | 'invoiceDetailExport'
  | 'poExport';

interface ManageCard {
  id: ManageView;
  title: string;
  subtitle: string;
  icon: string;
  color: string;
  bg: string;
}

const CARDS: ManageCard[] = [
  {
    id: 'campusList',
    title: 'Campus',
    subtitle: 'Configure campus locations',
    icon: 'location-city',
    color: '#F59E0B',
    bg: '#FEF3C7',
  },
  {
    id: 'locationList',
    title: 'Location',
    subtitle: 'Manage branch & warehouse locations',
    icon: 'place',
    color: '#06B6D4',
    bg: '#CFFAFE',
  },
  {
    id: 'userList',
    title: 'Users',
    subtitle: 'Manage team members & roles',
    icon: 'people',
    color: '#10B981',
    bg: '#D1FAE5',
  },
  {
    id: 'uomList',
    title: 'UOM',
    subtitle: 'Units of measure for products',
    icon: 'straighten',
    color: '#10B981',
    bg: '#D1FAE5',
  },
  {
    id: 'vendorList',
    title: 'Vendor',
    subtitle: 'Manage suppliers & vendor contacts',
    icon: 'store',
    color: '#06B6D4',
    bg: '#CFFAFE',
  },
  {
    id: 'categoryList',
    title: 'Category',
    subtitle: 'Create & manage product categories',
    icon: 'category',
    color: '#7C3AED',
    bg: '#EDE9FE',
  },
  {
    id: 'productList',
    title: 'Products',
    subtitle: 'View & add products to the catalog',
    icon: 'inventory-2',
    color: '#2563EB',
    bg: '#DBEAFE',
  },
  {
    id: 'movementItems',
    title: 'Movement Items',
    subtitle: 'Stock movements: adjustments, receipts & on-hand',
    icon: 'swap-vert',
    color: '#0891B2',
    bg: '#CFFAFE',
  },
  {
    id: 'saleOrderList',
    title: 'Sale Orders',
    subtitle: 'View & track all sale orders',
    icon: 'receipt-long',
    color: '#EF4444',
    bg: '#FEE2E2',
  },
  {
    id: 'quotationList',
    title: 'Quotation',
    subtitle: 'View, confirm & convert quotations to SO',
    icon: 'description',
    color: '#10B981',
    bg: '#D1FAE5',
  },
  {
    id: 'saleInvoiceList',
    title: 'Sale Invoices',
    subtitle: 'Manage invoiced & paid orders',
    icon: 'request-quote',
    color: '#7C3AED',
    bg: '#EDE9FE',
  },
  {
    id: 'rentalInvoiceList',
    title: 'Rental Invoice',
    subtitle: 'Convert rental contracts to invoice',
    icon: 'print',
    color: '#06B6D4',
    bg: '#CFFAFE',
  },
  {
    id: 'purchaseOrderList',
    title: 'Purchase Orders',
    subtitle: 'Create & track supplier purchase orders',
    icon: 'shopping-bag',
    color: '#F59E0B',
    bg: '#FEF3C7',
  },
  {
    id: 'vendorPayables',
    title: 'Vendor Payables',
    subtitle: 'Track & pay outstanding vendor bills',
    icon: 'account-balance-wallet',
    color: '#EF4444',
    bg: '#FEE2E2',
  },
  {
    id: 'cashierManage',
    title: 'Cash In / Out',
    subtitle: 'Record cash transactions & view session history',
    icon: 'point-of-sale',
    color: '#0891B2',
    bg: '#CFFAFE',
  },
  {
    id: 'expenses',
    title: 'Expenses',
    subtitle: 'Record & track operating expenses by category',
    icon: 'receipt-long',
    color: '#EF4444',
    bg: '#FEE2E2',
  },
  {
    id: 'incomeStatement',
    title: 'Income Statement',
    subtitle: 'Revenue, expenses & net profit by date range',
    icon: 'bar-chart',
    color: '#16A34A',
    bg: '#DCFCE7',
  },
  {
    id: 'invoiceDetailExport',
    title: 'Invoice Details',
    subtitle: 'Export invoice details to Excel by date & campus',
    icon: 'table-view',
    color: '#0369A1',
    bg: '#E0F2FE',
  },
  {
    id: 'poExport',
    title: 'PO Details',
    subtitle: 'Export purchase order details to Excel by date & location',
    icon: 'table-view',
    color: '#7C3AED',
    bg: '#EDE9FE',
  },
];

const ManageScreen: React.FC = () => {
  const [view, setView] = useState<ManageView>('hub');
  const viewRef = useRef(view);
  viewRef.current = view;

  useEffect(() => {
    return tabEvents.on('Manage', () => {
      if (viewRef.current !== 'hub') setView('hub');
    });
  }, []);
  const [editCategory, setEditCategory] = useState<ApiCategory | null>(null);
  const [editUser, setEditUser] = useState<ApiUser | null>(null);
  const [editProduct, setEditProduct] = useState<ApiProduct | null>(null);
  const [editCampus, setEditCampus] = useState<ApiCampus | null>(null);
  const [editLocation, setEditLocation] = useState<ApiLocation | null>(null);
  const [editVendor, setEditVendor] = useState<ApiVendor | null>(null);
  const [editUom, setEditUom] = useState<ApiUom | null>(null);
  const [viewInvoice, setViewInvoice] = useState<ApiRentalInvoiceHeader | null>(null);

  if (view === 'categoryList') {
    return (
      <CategoriesListScreen
        onBack={() => setView('hub')}
        onCreate={() => setView('categoryCreate')}
        onEdit={c => { setEditCategory(c); setView('categoryEdit'); }}
      />
    );
  }
  if (view === 'categoryCreate') {
    return <CreateCategoryScreen onBack={() => setView('categoryList')} />;
  }
  if (view === 'categoryEdit' && editCategory) {
    return (
      <EditCategoryScreen
        category={editCategory}
        onBack={() => { setEditCategory(null); setView('categoryList'); }}
        onSaved={() => { setEditCategory(null); setView('categoryList'); }}
      />
    );
  }
  if (view === 'productList') {
    return (
      <ProductsListScreen
        onBack={() => setView('hub')}
        onCreate={() => setView('productCreate')}
        onEdit={p => { setEditProduct(p); setView('productEdit'); }}
      />
    );
  }
  if (view === 'productCreate') {
    return <ProductFormScreen onBack={() => setView('productList')} onSaved={() => setView('productList')} />;
  }
  if (view === 'productEdit' && editProduct) {
    return (
      <ProductFormScreen
        product={editProduct}
        onBack={() => setView('productList')}
        onSaved={() => { setEditProduct(null); setView('productList'); }}
      />
    );
  }
  if (view === 'userList') {
    return (
      <UsersListScreen
        onBack={() => setView('hub')}
        onCreate={() => setView('userCreate')}
        onEdit={u => { setEditUser(u); setView('userEdit'); }}
      />
    );
  }
  if (view === 'userCreate') {
    return (
      <CreateUserScreen
        onBack={() => setView('userList')}
        onSaved={() => setView('userList')}
      />
    );
  }
  if (view === 'userEdit' && editUser) {
    return (
      <EditUserScreen
        user={editUser}
        onBack={() => { setEditUser(null); setView('userList'); }}
        onSaved={() => { setEditUser(null); setView('userList'); }}
        onDeleted={() => { setEditUser(null); setView('userList'); }}
      />
    );
  }
  if (view === 'campusList') {
    return (
      <CampusListScreen
        onBack={() => setView('hub')}
        onCreate={() => setView('campusCreate')}
        onEdit={c => { setEditCampus(c); setView('campusEdit'); }}
      />
    );
  }
  if (view === 'campusCreate') {
    return <CreateCampusScreen onBack={() => setView('campusList')} />;
  }
  if (view === 'campusEdit' && editCampus) {
    return (
      <EditCampusScreen
        campus={editCampus}
        onBack={() => setView('campusList')}
        onSaved={() => { setEditCampus(null); setView('campusList'); }}
      />
    );
  }
  if (view === 'locationList') {
    return (
      <LocationListScreen
        onBack={() => setView('hub')}
        onCreate={() => setView('locationCreate')}
        onEdit={l => { setEditLocation(l); setView('locationEdit'); }}
      />
    );
  }
  if (view === 'locationCreate') {
    return <LocationFormScreen onBack={() => setView('locationList')} onSaved={() => setView('locationList')} />;
  }
  if (view === 'locationEdit' && editLocation) {
    return (
      <LocationFormScreen
        location={editLocation}
        onBack={() => setView('locationList')}
        onSaved={() => { setEditLocation(null); setView('locationList'); }}
      />
    );
  }
  if (view === 'quotationList') {
    return <QuotationListScreen onBack={() => setView('hub')} />;
  }
  if (view === 'saleOrderList') {
    return <SaleOrdersListScreen onBack={() => setView('hub')} />;
  }
  if (view === 'saleInvoiceList') {
    return <SaleInvoiceListScreen onBack={() => setView('hub')} />;
  }
  if (view === 'purchaseOrderList') {
    return <PurchaseOrderListScreen onBack={() => setView('hub')} />;
  }
  if (view === 'movementItems') {
    return <MovementItemsScreen onBack={() => setView('hub')} />;
  }
  if (view === 'vendorPayables') {
    return <VendorPayablesScreen onBack={() => setView('hub')} />;
  }
  if (view === 'cashierManage') {
    return <CashierManageScreen onBack={() => setView('hub')} />;
  }
  if (view === 'incomeStatement') {
    return <IncomeStatementScreen onBack={() => setView('hub')} />;
  }
  if (view === 'expenses') {
    return <ExpensesScreen onBack={() => setView('hub')} />;
  }
  if (view === 'invoiceDetailExport') {
    return <InvoiceDetailExportScreen onBack={() => setView('hub')} />;
  }
  if (view === 'poExport') {
    return <POExportScreen onBack={() => setView('hub')} />;
  }
  if (view === 'vendorList') {
    return (
      <VendorListScreen
        onBack={() => setView('hub')}
        onCreate={() => setView('vendorCreate')}
        onEdit={v => { setEditVendor(v); setView('vendorEdit'); }}
      />
    );
  }
  if (view === 'vendorCreate') {
    return <VendorFormScreen onBack={() => setView('vendorList')} onSaved={() => setView('vendorList')} />;
  }
  if (view === 'vendorEdit' && editVendor) {
    return (
      <VendorFormScreen
        vendor={editVendor}
        onBack={() => { setEditVendor(null); setView('vendorList'); }}
        onSaved={() => { setEditVendor(null); setView('vendorList'); }}
      />
    );
  }
  if (view === 'uomList') {
    return (
      <UomListScreen
        onBack={() => setView('hub')}
        onCreate={() => setView('uomCreate')}
        onEdit={u => { setEditUom(u); setView('uomEdit'); }}
      />
    );
  }
  if (view === 'uomCreate') {
    return <UomFormScreen onBack={() => setView('uomList')} onSaved={() => setView('uomList')} />;
  }
  if (view === 'uomEdit' && editUom) {
    return (
      <UomFormScreen
        uom={editUom}
        onBack={() => setView('uomList')}
        onSaved={() => { setEditUom(null); setView('uomList'); }}
      />
    );
  }
  if (view === 'rentalInvoiceList') {
    return (
      <RentalInvoiceListScreen
        onBack={() => setView('hub')}
        onCreate={() => setView('rentalInvoiceCreate')}
        onView={inv => { setViewInvoice(inv); setView('rentalInvoiceView'); }}
      />
    );
  }
  if (view === 'rentalInvoiceCreate') {
    return (
      <RentalInvoiceFormScreen
        onBack={() => setView('rentalInvoiceList')}
        onSaved={() => setView('rentalInvoiceList')}
      />
    );
  }
  if (view === 'rentalInvoiceView' && viewInvoice) {
    return (
      <RentalInvoicePrintScreen
        invoice={viewInvoice}
        onBack={() => { setViewInvoice(null); setView('rentalInvoiceList'); }}
      />
    );
  }
  return (
    <View style={styles.safe}>
      <AppBar title="Manage" subtitle="Configure your workspace" titleAlign="left" />

      <FlatList
        data={CARDS}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.row} activeOpacity={0.75} onPress={() => setView(item.id)}>
            <View style={[styles.iconBox, { backgroundColor: item.bg }]}>
              <Icon name={item.icon} size={22} color={item.color} />
            </View>
            <View style={styles.rowText}>
              <AppText variant="bodyMedium" style={styles.rowTitle}>{item.title}</AppText>
              <AppText variant="caption" color="textSecondary">{item.subtitle}</AppText>
            </View>
            <Icon name="chevron-right" size={20} color={Colors.textLight} />
          </TouchableOpacity>
        )}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  list: {
    paddingTop: 8,
    paddingBottom: 32,
  },
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
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  rowTitle: {
    fontWeight: '600',
  },
});

export default ManageScreen;
