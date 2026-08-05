export interface MenuItemModel {
  id: string;
  name: string;
  nameKh?: string;
  sku?: string;
  price: number;
  description?: string;
  image?: string;
  primaryImageUrl?: string;
  groupId: string;
  categoryName?: string;
  locationCode?: string;
  available: boolean;
  qtyOnHand?: number;
}

export interface MenuGroup {
  id: string;
  name: string;
  icon?: string;
  color?: string;
  items: MenuItemModel[];
}
