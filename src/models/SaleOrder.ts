import { MenuItemModel } from './MenuItem';

export interface SaleOrderLine {
  id: string;
  item: MenuItemModel;
  quantity: number;
  unitPrice: number;
  subtotal: number;
  note?: string;
}

export interface SaleOrder {
  id: string;
  orderNumber: string;
  lines: SaleOrderLine[];
  subtotal: number;
  tax: number;
  discount: number;
  total: number;
  status: 'draft' | 'confirmed' | 'paid' | 'cancelled';
  createdAt: Date;
  tableNumber?: string;
  customerName?: string;
}

export interface DashboardStat {
  label: string;
  value: string | number;
  change?: number;
  icon: string;
  color: string;
}
