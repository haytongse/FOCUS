import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MenuGroup, MenuItemModel } from '../models/MenuItem';
import { SaleOrder, SaleOrderLine } from '../models/SaleOrder';
import { Campus } from '../models/Campus';
import {
  getCategoriesApi,
  getProductsByCategoryApi,
  getAllProductsApi,
  getCampusesApi,
  getProductLocationsApi,
  getInvoiceDetailsTotalOnhandApi,
  ApiCategory,
  ApiProduct,
  ApiCampus,
  BASE_URL,
} from '../services/focusApi';

const resolveImageUrl = (url: string | null | undefined): string | undefined => {
  if (!url) return undefined;
  // Reject local device URIs stored by old broken upload code
  if (url.startsWith('file://') || url.startsWith('/var/') || url.startsWith('/data/')) return undefined;
  let resolved = url;
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    resolved = `${BASE_URL}${url.startsWith('/') ? '' : '/'}${url}`;
  }
  // Force HTTPS — iOS ATS blocks plain HTTP image requests
  resolved = resolved.replace(/^http:\/\//, 'https://');
  return resolved;
};

// ─── Campus mapping ───────────────────────────────────────────────────────────

const CAMPUS_COLORS = [
  '#2563EB', '#7C3AED', '#10B981', '#F59E0B',
  '#EF4444', '#06B6D4', '#F97316', '#EC4899',
];

const CAMPUS_ICONS = [
  'location-city', 'account-balance', 'school', 'business',
  'explore', 'domain', 'apartment', 'home-work',
];

const mapApiCampus = (c: ApiCampus, index: number): Campus => ({
  id: String(c.id),
  code: c.campusCode,
  name: c.nameEn || c.nameKm,
  icon: CAMPUS_ICONS[index % CAMPUS_ICONS.length],
  color: CAMPUS_COLORS[index % CAMPUS_COLORS.length],
  orgId: c.orgId ?? undefined,
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

const CATEGORY_COLORS = [
  '#2563EB', '#F59E0B', '#EF4444', '#10B981',
  '#7C3AED', '#06B6D4', '#F97316', '#EC4899',
];

const CATEGORY_ICONS = [
  'category', 'local-cafe', 'restaurant', 'cake',
  'fastfood', 'local-pizza', 'icecream', 'rice-bowl',
];

const mapCategory = (c: ApiCategory, index: number): MenuGroup => ({
  id: c.id,
  name: c.nameEn || c.nameKm,
  icon: CATEGORY_ICONS[index % CATEGORY_ICONS.length],
  color: CATEGORY_COLORS[index % CATEGORY_COLORS.length],
  items: [],
});

const mapProduct = (
  p: ApiProduct,
  groupId: string,
  catNameMap: Record<string, string>,
  onhandMap?: Map<string, number>,
): MenuItemModel => {
  const resolvedImage = resolveImageUrl(p.primaryImageUrl);
  const categoryName = (p.categoryId ? catNameMap[p.categoryId] : undefined) ?? catNameMap[groupId];
  const locationCode = p.locations?.[0]?.locationCode ?? undefined;
  return {
    id: p.id,
    name: p.nameEn || p.nameKm,
    nameKh: p.nameKm || undefined,
    sku: p.sku || undefined,
    price: p.fixedPriceCents ? parseInt(p.fixedPriceCents, 10) / 100 : 0,
    groupId: p.categoryId ?? groupId,
    categoryName,
    locationCode,
    available: p.active,
    description: p.descriptionEn ?? p.descriptionKm ?? undefined,
    image: resolvedImage,
    primaryImageUrl: resolvedImage,
    qtyOnHand: onhandMap ? (onhandMap.get(String(p.id)) ?? 0) : undefined,
  };
};

// ─── Order helpers ────────────────────────────────────────────────────────────

const TAX_RATE = 0;
let orderCounter = 0;

const generateOrderNumber = (): string => {
  ++orderCounter;
  const yy = String(new Date().getFullYear()).slice(-2);
  const seq = String(orderCounter).padStart(4, '0');
  return `SO-${yy}-${seq}`;
};

const createEmptyOrder = (): SaleOrder => ({
  id: Date.now().toString(),
  orderNumber: generateOrderNumber(),
  lines: [],
  subtotal: 0,
  tax: 0,
  discount: 0,
  total: 0,
  status: 'draft',
  createdAt: new Date(),
});

const recalculate = (lines: SaleOrderLine[]): Pick<SaleOrder, 'subtotal' | 'tax' | 'total'> => {
  const subtotal = lines.reduce((s, l) => s + l.subtotal, 0);
  const tax = subtotal * TAX_RATE;
  return { subtotal, tax, total: subtotal + tax };
};

// ─── Constants ────────────────────────────────────────────────────────────────

export const ALL_GROUP_ID = 'all';
const CAMPUS_STORAGE_KEY = '@menu_selected_campus';

// ─── Interface ────────────────────────────────────────────────────────────────

interface MenuViewModel {
  campuses: Campus[];
  campusesLoading: boolean;
  selectedCampus: Campus | null;
  selectCampus: (campus: Campus) => void;
  clearCampus: () => void;

  groups: MenuGroup[];
  selectedGroupId: string | null;
  selectedGroup: MenuGroup | null;
  displayItems: MenuItemModel[];

  loading: boolean;
  itemsLoading: boolean;
  error: string | null;
  retryLoad: () => void;

  order: SaleOrder;
  selectGroup: (groupId: string) => void;
  addItem: (item: MenuItemModel) => void;
  removeItem: (lineId: string) => void;
  incrementLine: (lineId: string) => void;
  decrementLine: (lineId: string) => void;
  setLineQuantity: (lineId: string, qty: number) => void;
  clearOrder: () => void;
  confirmOrder: () => void;
  totalItems: number;
  bulkImport: (rows: Array<{ sku: string; qty: number }>, itemOverride?: MenuItemModel[]) => string[];
  loadAllItems: () => Promise<MenuItemModel[]>;
}

// ─── ViewModel ────────────────────────────────────────────────────────────────

export const useMenuViewModel = (): MenuViewModel => {
  const [campuses, setCampuses] = useState<Campus[]>([]);
  const [campusesLoading, setCampusesLoading] = useState(true);
  const [selectedCampus, setSelectedCampus] = useState<Campus | null>(null);

  const [groups, setGroups] = useState<MenuGroup[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(ALL_GROUP_ID);
  const [displayItems, setDisplayItems] = useState<MenuItemModel[]>([]);

  const [loading, setLoading] = useState(false);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cacheVersion, setCacheVersion] = useState(0);

  const [order, setOrder] = useState<SaleOrder>(createEmptyOrder());
  const selectedCampusRef = useRef<Campus | null>(null);

  // Cache: categoryId → products
  const cache = useRef<Map<string, MenuItemModel[]>>(new Map());

  // Onhand: productId → totalOnhand
  const onhandMapRef = useRef<Map<string, number>>(new Map());

  // ── Fetch campuses from API ────────────────────────────────────────────────
  const loadCampuses = useCallback(() => {
    setCampusesLoading(true);
    getCampusesApi()
      .then(data => {
        const active = data.filter(c => c.active !== false);
        setCampuses(active.map(mapApiCampus));
      })
      .catch(() => {})
      .finally(() => setCampusesLoading(false));
  }, []);

  useEffect(() => { loadCampuses(); }, [loadCampuses]);

  // ── Restore last selected campus from storage ──────────────────────────────
  useEffect(() => {
    if (campuses.length === 0 || selectedCampusRef.current) return;
    AsyncStorage.getItem(CAMPUS_STORAGE_KEY).then(json => {
      if (!json) return;
      try {
        const saved = JSON.parse(json) as Campus;
        const match = campuses.find(c => c.id === saved.id);
        if (match) {
          selectedCampusRef.current = match;
          setSelectedCampus(match);
        }
      } catch {}
    }).catch(() => {});
  }, [campuses]);

  // ── Fetch categories ───────────────────────────────────────────────────────
  const loadCategories = useCallback((clearCache = false) => {
    if (clearCache) {
      cache.current.clear();
      setCacheVersion(v => v + 1);
    }
    setLoading(true);
    setError(null);
    getCategoriesApi()
      .then(cats => {
        setGroups(cats.map(mapCategory));
      })
      .catch(err => {
        const msg: string =
          err?.response?.data?.error?.messageKey ?? err?.message ?? 'Failed to load categories';
        setError(msg);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadCategories(); }, [loadCategories]);

  // ── Fetch onhand data — re-runs whenever cacheVersion bumps (retryLoad) ──────
  useEffect(() => {
    getInvoiceDetailsTotalOnhandApi()
      .then(items => {
        const map = new Map<string, number>();
        items.forEach(s => map.set(String(s.productId), s.totalOnhand));
        onhandMapRef.current = map;
        // Patch currently displayed items
        setDisplayItems(prev =>
          prev.map(item => ({ ...item, qtyOnHand: map.get(String(item.id)) ?? 0 })),
        );
        // Patch cache so navigating between categories keeps onhand
        cache.current.forEach((items, key) => {
          cache.current.set(key, items.map(item => ({ ...item, qtyOnHand: map.get(String(item.id)) ?? 0 })));
        });
      })
      .catch(() => {});
  }, [cacheVersion]);

  // ── Fetch products when selected group changes ─────────────────────────────
  useEffect(() => {
    if (!selectedGroupId) return;

    const cached = cache.current.get(selectedGroupId);
    if (cached) {
      // Stale: built before groups loaded — category names missing
      if (groups.length > 0 && cached.some(item => !item.categoryName)) {
        cache.current.delete(selectedGroupId);
      } else {
        setDisplayItems(cached);
        return;
      }
    }

    setItemsLoading(true);

    const fetchPromise =
      selectedGroupId === ALL_GROUP_ID
        ? getAllProductsApi()
        : getProductsByCategoryApi(selectedGroupId as string);

    fetchPromise
      .then(async products => {
        const catNameMap: Record<string, string> = {};
        groups.forEach(g => { catNameMap[g.id] = g.name; });
        const mapped = products.map(p => mapProduct(p, selectedGroupId, catNameMap, onhandMapRef.current));

        // Show items immediately, then patch in location codes
        cache.current.set(selectedGroupId, mapped);
        setDisplayItems(mapped);
        setItemsLoading(false);

        // Batch-fetch locations in background
        const results = await Promise.allSettled(mapped.map(item => getProductLocationsApi(item.id)));
        const withLocs = mapped.map((item, i) => {
          const r = results[i];
          const loc = r.status === 'fulfilled' && r.value.length > 0 ? r.value[0].locationCode : undefined;
          const onhand = onhandMapRef.current.get(String(item.id)) ?? item.qtyOnHand ?? 0;
          return { ...item, ...(loc ? { locationCode: loc } : {}), qtyOnHand: onhand };
        });
        cache.current.set(selectedGroupId, withLocs);
        setDisplayItems(withLocs);
      })
      .catch(() => { setDisplayItems([]); setItemsLoading(false); })
      .finally(() => {});
  }, [selectedGroupId, cacheVersion, groups]);

  // ── Campus ────────────────────────────────────────────────────────────────
  const selectCampus = useCallback((campus: Campus) => {
    selectedCampusRef.current = campus;
    setSelectedCampus(campus);
    AsyncStorage.setItem(CAMPUS_STORAGE_KEY, JSON.stringify(campus)).catch(() => {});
  }, []);

  const clearCampus = useCallback(() => {
    selectedCampusRef.current = null;
    setSelectedCampus(null);
    setOrder(createEmptyOrder());
    AsyncStorage.removeItem(CAMPUS_STORAGE_KEY).catch(() => {});
  }, []);

  // ── Group / category selection ────────────────────────────────────────────
  const selectGroup = useCallback((groupId: string) => setSelectedGroupId(groupId), []);

  const selectedGroup = useMemo(
    () => groups.find(g => g.id === selectedGroupId) ?? null,
    [groups, selectedGroupId],
  );

  // ── Order mutations ───────────────────────────────────────────────────────
  const addItem = useCallback((item: MenuItemModel) => {
    setOrder(prev => {
      const existing = prev.lines.find(l => l.item.id === item.id);
      let newLines: SaleOrderLine[];
      if (existing) {
        newLines = prev.lines.map(l =>
          l.item.id === item.id
            ? { ...l, quantity: l.quantity + 1, subtotal: (l.quantity + 1) * l.unitPrice }
            : l,
        );
      } else {
        newLines = [
          ...prev.lines,
          { id: `line-${Date.now()}`, item, quantity: 1, unitPrice: item.price, subtotal: item.price },
        ];
      }
      return { ...prev, lines: newLines, ...recalculate(newLines) };
    });
  }, []);

  const removeItem = useCallback((lineId: string) => {
    setOrder(prev => {
      const newLines = prev.lines.filter(l => l.id !== lineId);
      return { ...prev, lines: newLines, ...recalculate(newLines) };
    });
  }, []);

  const incrementLine = useCallback((lineId: string) => {
    setOrder(prev => {
      const newLines = prev.lines.map(l =>
        l.id === lineId
          ? { ...l, quantity: l.quantity + 1, subtotal: (l.quantity + 1) * l.unitPrice }
          : l,
      );
      return { ...prev, lines: newLines, ...recalculate(newLines) };
    });
  }, []);

  const decrementLine = useCallback((lineId: string) => {
    setOrder(prev => {
      const newLines = prev.lines
        .map(l =>
          l.id === lineId
            ? { ...l, quantity: l.quantity - 1, subtotal: (l.quantity - 1) * l.unitPrice }
            : l,
        )
        .filter(l => l.quantity > 0);
      return { ...prev, lines: newLines, ...recalculate(newLines) };
    });
  }, []);

  const setLineQuantity = useCallback((lineId: string, qty: number) => {
    setOrder(prev => {
      const newLines = prev.lines
        .map(l =>
          l.id === lineId
            ? { ...l, quantity: qty, subtotal: qty * l.unitPrice }
            : l,
        )
        .filter(l => l.quantity > 0);
      return { ...prev, lines: newLines, ...recalculate(newLines) };
    });
  }, []);

  const clearOrder = useCallback(() => {
    setOrder(createEmptyOrder());
  }, []);

  const bulkImport = useCallback((rows: Array<{ sku: string; qty: number }>, itemOverride?: MenuItemModel[]): string[] => {
    // Build SKU map from all cached groups so items outside the current category are found
    const skuMap = new Map<string, MenuItemModel>();
    cache.current.forEach(items => items.forEach(item => { if (item.sku) skuMap.set(item.sku.toLowerCase(), item); }));
    displayItems.forEach(item => { if (item.sku) skuMap.set(item.sku.toLowerCase(), item); });
    (itemOverride ?? []).forEach(item => { if (item.sku) skuMap.set(item.sku.toLowerCase(), item); });

    const notFound: string[] = [];
    setOrder(prev => {
      let lines = [...prev.lines];
      for (const row of rows) {
        if (row.qty <= 0 || !row.sku.trim()) continue;
        const item = skuMap.get(row.sku.toLowerCase().trim());
        if (!item) { notFound.push(row.sku); continue; }
        const existing = lines.find(l => l.item.id === item.id);
        if (existing) {
          const newQty = existing.quantity + row.qty;
          lines = lines.map(l =>
            l.item.id === item.id
              ? { ...l, quantity: newQty, subtotal: newQty * l.unitPrice }
              : l,
          );
        } else {
          lines = [...lines, {
            id: `line-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            item, quantity: row.qty, unitPrice: item.price, subtotal: row.qty * item.price,
          }];
        }
      }
      return { ...prev, lines, ...recalculate(lines) };
    });
    return notFound;
  }, [displayItems]);

  const loadAllItems = useCallback(async (): Promise<MenuItemModel[]> => {
    // Return from cache if already loaded
    const cached = cache.current.get(ALL_GROUP_ID);
    if (cached && cached.length > 0) return cached;
    try {
      const products = await getAllProductsApi();
      const catNameMap: Record<string, string> = {};
      // groups may not be loaded yet; use empty map — category names are cosmetic for import
      const mapped = products.map(p => mapProduct(p, ALL_GROUP_ID, catNameMap, onhandMapRef.current));
      cache.current.set(ALL_GROUP_ID, mapped);
      return mapped;
    } catch {
      return [...displayItems];
    }
  }, [displayItems]);

  const confirmOrder = useCallback(() => {
    setOrder(prev => ({ ...prev, status: 'confirmed' }));
    setTimeout(() => setOrder(createEmptyOrder()), 1500);
  }, []);

  const totalItems = useMemo(
    () => order.lines.reduce((s, l) => s + l.quantity, 0),
    [order.lines],
  );

  return {
    campuses,
    campusesLoading,
    selectedCampus,
    selectCampus,
    clearCampus,
    groups,
    selectedGroupId,
    selectedGroup,
    displayItems,
    loading,
    itemsLoading,
    error,
    retryLoad: () => loadCategories(true),
    order,
    selectGroup,
    addItem,
    removeItem,
    incrementLine,
    decrementLine,
    setLineQuantity,
    clearOrder,
    confirmOrder,
    totalItems,
    bulkImport,
    loadAllItems,
  };
};
