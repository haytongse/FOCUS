export interface ErpMenuItem {
  id: string | number;
  name: string;
  icon?: string;
  url?: string;
  children?: ErpMenuItem[];
}
