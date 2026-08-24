import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const BASE_URL = 'https://focuslaberp.focuslab.in';

const api = axios.create({
  baseURL: BASE_URL,
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
});

const TOKEN_KEY         = '@focus:auth_token';
const REFRESH_TOKEN_KEY = '@focus:refresh_token';
const EXPIRE_IN_KEY     = '@focus:expire_in';
const USER_KEY          = '@focus:user';

// Module-level token + orgId decoded from JWT
let _authToken: string | null = null;
let _orgId: string | null = null;

// Called when any response returns 401 (expired / invalid token)
let _onUnauthorized: (() => void) | null = null;
export const setOnUnauthorized = (cb: (() => void) | null) => { _onUnauthorized = cb; };

const decodeJwt = (token: string): Record<string, any> => {
  try {
    const payload = token.split('.')[1];
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    let result = '';
    let i = 0;
    const padded = base64 + '=='.slice((base64.length % 4) || 4);
    while (i < padded.length) {
      const a = chars.indexOf(padded[i++]);
      const b = chars.indexOf(padded[i++]);
      const c = chars.indexOf(padded[i++]);
      const d = chars.indexOf(padded[i++]);
      result += String.fromCharCode((a << 2) | (b >> 4));
      if (c !== -1) result += String.fromCharCode(((b & 15) << 4) | (c >> 2));
      if (d !== -1) result += String.fromCharCode(((c & 3) << 6) | d);
    }
    return JSON.parse(decodeURIComponent(result.split('').map(c2 =>
      '%' + ('00' + c2.charCodeAt(0).toString(16)).slice(-2),
    ).join('')));
  } catch {
    return {};
  }
};

export const getOrgId = (): string | null => _orgId;

// ── Request interceptor: inject Bearer token + log in dev ─────────────────────
api.interceptors.request.use(async config => {
  // If module-level token was lost (e.g. hot-reload), restore from AsyncStorage
  if (!_authToken) {
    try {
      const stored = await AsyncStorage.getItem(TOKEN_KEY);
      if (stored) {
        _authToken = stored;
        _orgId = decodeJwt(stored).orgId ?? null;
        api.defaults.headers.common['Authorization'] = `Bearer ${stored}`;
      }
    } catch {}
  }
  if (_authToken) {
    config.headers.set('Authorization', `Bearer ${_authToken}`);
  }
  return config;
});

// ── Response interceptor: handle 401 globally ────────────────────────────────
api.interceptors.response.use(
  response => response,
  error => {
    if (error?.response?.status === 401) {
      setAuthToken(null);
      _onUnauthorized?.();
    }
    return Promise.reject(error);
  },
);

/** Persist token to storage and set on axios instance. */
export const setAuthToken = (token: string | null) => {
  _authToken = token;
  if (token) {
    api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    AsyncStorage.setItem(TOKEN_KEY, token).catch(() => {});
    _orgId = decodeJwt(token).orgId ?? null;
  } else {
    delete api.defaults.headers.common['Authorization'];
    AsyncStorage.removeItem(TOKEN_KEY).catch(() => {});
    AsyncStorage.removeItem(REFRESH_TOKEN_KEY).catch(() => {});
    AsyncStorage.removeItem(EXPIRE_IN_KEY).catch(() => {});
    AsyncStorage.removeItem(USER_KEY).catch(() => {});
    _orgId = null;
  }
};

export const setAuthUser = (user: object | null): void => {
  if (user) {
    AsyncStorage.setItem(USER_KEY, JSON.stringify(user)).catch(() => {});
  } else {
    AsyncStorage.removeItem(USER_KEY).catch(() => {});
  }
};

export const restoreAuthUser = async (): Promise<object | null> => {
  try {
    const stored = await AsyncStorage.getItem(USER_KEY);
    if (!stored) return null;
    const parsed = JSON.parse(stored);
    // Normalise role to lowercase to match routing guards
    if (parsed?.role) parsed.role = parsed.role.toLowerCase();
    return parsed;
  } catch {
    return null;
  }
};

export const setRefreshToken = (refreshToken: string, expiresIn?: number) => {
  AsyncStorage.setItem(REFRESH_TOKEN_KEY, refreshToken).catch(() => {});
  if (expiresIn != null) {
    AsyncStorage.setItem(EXPIRE_IN_KEY, String(expiresIn)).catch(() => {});
  }
};

export const getRefreshToken = (): Promise<string | null> =>
  AsyncStorage.getItem(REFRESH_TOKEN_KEY).catch(() => null);

/** Call once on app start — restores saved token and returns it (or null). */
export const restoreAuthToken = async (): Promise<string | null> => {
  try {
    const token = await AsyncStorage.getItem(TOKEN_KEY);
    if (token) {
      setAuthToken(token);
    }
    return token;
  } catch {
    return null;
  }
};

/** Safely unwrap common API envelope shapes into a plain array. */
const extractArray = (data: any): any[] => {
  if (Array.isArray(data)) return data;
  if (data?.ok === true || data?.success === true) {
    const inner = data.data;
    if (Array.isArray(inner)) return inner;
  }
  for (const key of ['data', 'items', 'products', 'categories', 'result', 'results', 'list']) {
    if (Array.isArray(data?.[key])) return data[key];
  }
  return [];
};

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FocusUser {
  id: string | number;
  name: string;
  email?: string;
  username?: string;
  role?: string;
  branch?: string;
}

export interface FocusErpMenuItem {
  id: string | number;
  name: string;
  icon?: string;
  action?: string;
  url?: string;
  sequence?: number;
  children?: FocusErpMenuItem[];
}

// ─── Login ────────────────────────────────────────────────────────────────────

export const loginApi = async (
  email: string,
  password: string,
  fcmToken?: string | null,
): Promise<{ user: FocusUser; token: string; refreshToken?: string; expiresIn?: number; fcmToken?: string }> => {
  const body: Record<string, any> = { email, password };
  if (fcmToken) body.fcmToken = fcmToken;

  const { data } = await api.post('/api/v1/auth/login', body);

  // API uses { ok: boolean } envelope — surface error message properly
  if (data?.ok === false) {
    const msg: string =
      data?.error?.messageKey ?? data?.error?.code ?? data?.message ?? 'Login failed';
    throw new Error(msg);
  }

  // Unwrap nested data envelope if present
  const payload = data?.data ?? data;

  // Token may appear under several field names
  const token: string | undefined =
    payload?.token ??
    payload?.access_token ??
    payload?.accessToken ??
    payload?.bearerToken;

  // User may be nested or at the top level
  const rawUser: FocusUser | undefined =
    payload?.user ?? (payload?.id ? payload : undefined);

  if (!token) {
    throw new Error('Login failed: no token received');
  }
  if (!rawUser) {
    throw new Error('Login failed: no user data received');
  }

  const refreshToken: string | undefined =
    payload?.refresh_token ?? payload?.refreshToken;
  const expiresIn: number | undefined =
    payload?.expire_in ?? payload?.expires_in ?? payload?.expiresIn;
  const serverFcmToken: string | undefined =
    payload?.fcmToken ?? payload?.fcm_token;

  return {
    token,
    refreshToken,
    expiresIn,
    fcmToken: serverFcmToken,
    user: {
      id: String(rawUser.id ?? ''),
      name: rawUser.name ?? rawUser.username ?? 'User',
      email: rawUser.email,
      username: rawUser.username,
      role: rawUser.role,
    },
  };
};

// ─── Notifications ────────────────────────────────────────────────────────────

export interface AppNotification {
  id: number;
  title: string;
  body: string;
  data?: string;
  readAt: string | null;
  createdAt: string;
}

export const getUnreadCountApi = async (): Promise<number> => {
  const { data } = await api.get('/api/v1/auth/notifications/unread-count');
  return data?.data?.unread ?? 0;
};

export const getNotificationsApi = async (): Promise<AppNotification[]> => {
  const { data } = await api.get('/api/v1/auth/notifications');
  return data?.data?.items ?? [];
};

export const markNotificationsReadApi = async (): Promise<void> => {
  await api.patch('/api/v1/auth/notifications/mark-read');
};

// ─── Push Notification ────────────────────────────────────────────────────────

// Register / update FCM token for a specific user (OWNER only)
export const updateFcmTokenApi = async (email: string, fcmToken: string): Promise<void> => {
  await api.post('/api/v1/auth/set-fcm-token', { email, fcmToken });
};

// Send test push to one user by email
export const sendTestPushApi = async (email: string): Promise<void> => {
  const { data } = await api.post('/api/v1/auth/test-push', { email });
  if (data?.ok === false) {
    throw new Error(data?.error?.messageKey ?? data?.error?.code ?? 'Failed to send test notification');
  }
};

export interface BroadcastPushResult {
  total: number;
  results: { email: string; sent: boolean; error?: string }[];
}

// Send to all OWNER + MANAGER users
export const broadcastPushApi = async (
  title: string,
  body: string,
): Promise<BroadcastPushResult> => {
  try {
    const { data } = await api.post('/api/v1/auth/broadcast-push', { title, body });
    if (data?.ok === false) {
      throw new Error(data?.error?.messageKey ?? data?.error?.code ?? 'Broadcast failed');
    }
    return {
      total: data?.data?.total ?? 0,
      results: Array.isArray(data?.data?.results) ? data.data.results : [],
    };
  } catch (err: any) {
    const status: number | undefined = err?.response?.status;
    const errBody = err?.response?.data;
    const msg: string =
      errBody?.error?.messageKey ??
      errBody?.error?.message ??
      errBody?.message ??
      err?.message ??
      'Broadcast failed';
    throw new Error(status ? `[${status}] ${msg}` : msg);
  }
};

// ─── ERP Left-Menu ────────────────────────────────────────────────────────────

export const getMenuApi = async (
  token: string,
): Promise<FocusErpMenuItem[]> => {
  const { data } = await api.get('/api/v1/menu', {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.menu)) return data.menu;
  if (Array.isArray(data?.data)) return data.data;
  return [];
};

// ─── POS Categories ───────────────────────────────────────────────────────────

export interface ApiCategory {
  id: string;
  parentId: string | null;
  nameEn: string;
  nameKm: string;
  sort: number;
}

export const getCategoriesApi = async (): Promise<ApiCategory[]> => {
  const { data } = await api.get('/api/v1/categories', { params: { flat: '1' } });

  if (typeof data === 'string') {
    throw new Error('Unexpected HTML response — check auth token');
  }
  if (data?.ok === false) {
    const msg: string =
      data?.error?.messageKey ?? data?.error?.code ?? 'Failed to load categories';
    throw new Error(msg);
  }

  // Response: { ok: true, data: { items: [...] } }
  const items = data?.data?.items ?? data?.data ?? [];
  return Array.isArray(items) ? items : [];
};

// ─── POS Products ─────────────────────────────────────────────────────────────

export interface ApiProduct {
  id: string;
  sku: string;
  nameEn: string;
  nameKm: string;
  descriptionEn: string | null;
  descriptionKm: string | null;
  categoryId: string | null;
  vendorId?: number | null;
  vendor?: { id?: number; name?: string } | null;
  uomId?: number | null;
  pricingMode: 'FIXED' | 'RFQ';
  fixedPriceCents: string | null;  // bigint serialised as string, in cents
  costPriceCents?: string | null;  // purchase/cost price, bigint serialised as string, in cents
  unit: string;
  isRentalItem: boolean;
  primaryImageUrl: string | null;
  active: boolean;
  qtyOnHand: number;
  country?: string | null;
  size?: string | null;
  barcode?: string | null;
  locations?: Array<{ locationId: number; locationCode: string; locationNameEn: string; storeBin?: string }> | null;
}

const fetchProducts = async (params: Record<string, string>): Promise<ApiProduct[]> => {
  const all: ApiProduct[] = [];
  let cursor: string | undefined;

  do {
    const reqParams = cursor ? { ...params, cursor } : params;
    const { data } = await api.get('/api/v1/products', { params: reqParams });

    if (typeof data === 'string') {
      throw new Error('Unexpected HTML response — check auth token');
    }
    if (data?.ok === false) {
      const msg: string =
        data?.error?.messageKey ?? data?.error?.code ?? 'Failed to load products';
      throw new Error(msg);
    }

    // Response: { ok: true, data: { items: [...], nextCursor, totalCount } }
    const items = data?.data?.items ?? data?.data ?? [];
    if (Array.isArray(items)) {
      all.push(...items.map((item: any) => ({
        ...item,
        id: String(item.id ?? item.productId ?? item.product_id ?? ''),
      })));
    }
    cursor = data?.data?.nextCursor ?? undefined;
  } while (cursor);

  return all;
};

export const getProductsByCategoryApi = async (
  categoryId: string,
): Promise<ApiProduct[]> => fetchProducts({ categoryId });

export const getAllProductsApi = async (): Promise<ApiProduct[]> =>
  fetchProducts({});

export const getProductsByLocationApi = async (locationId: string | number): Promise<ApiProduct[]> => {
  const { data } = await api.get(`/api/v1/products/by-location/${locationId}`);
  if (data?.ok === false) throw new Error(data?.error?.message ?? 'Failed to load products');
  const items: any[] = data?.data?.items ?? [];
  return items.map(item => ({
    id:              String(item.id ?? ''),
    sku:             item.sku ?? '',
    nameEn:          item.nameEn ?? '',
    nameKm:          item.nameKm ?? '',
    descriptionEn:   null,
    descriptionKm:   null,
    categoryId:      item.categoryId ? String(item.categoryId) : null,
    pricingMode:     item.pricingMode ?? 'FIXED',
    fixedPriceCents: item.unitPriceCents ?? null,
    unit:            item.unit ?? '',
    isRentalItem:    false,
    primaryImageUrl: item.imageUrl ?? null,
    active:          item.active ?? true,
    qtyOnHand:       item.qty ?? 0,
  }));
};

// ─── Users ────────────────────────────────────────────────────────────────────

export interface ApiUser {
  id: string;
  email: string;
  name: string;
  username?: string;
  role: string;
  active: boolean;
  lang?: string;
  branch?: string;
  createdAt?: string;
}

export type UserRole = 'OWNER' | 'MANAGER' | 'STAFF' | 'REQUESTER' | 'APPROVER' | 'CASHIER';
export type UserLang = 'en' | 'km';

export interface CreateUserInput {
  name: string;
  email: string;
  password: string;
  role: UserRole;
  lang: UserLang;
}

export interface UpdateUserInput {
  name?: string;
  role?: UserRole;
  lang?: UserLang;
  active?: boolean;
  password?: string;
}

const handleUserError = (err: any): never => {
  const status: number | undefined = err?.response?.status;
  const body = err?.response?.data;
  const arrErrors = Array.isArray(body?.errors)
    ? body.errors.map((e: any) => e?.message ?? e?.msg ?? JSON.stringify(e)).join(', ')
    : Array.isArray(body?.data?.errors)
    ? body.data.errors.map((e: any) => e?.message ?? e?.msg ?? JSON.stringify(e)).join(', ')
    : undefined;
  const msg: string =
    body?.error?.message ??
    body?.error?.messageKey ??
    body?.error?.code ??
    body?.message ??
    body?.detail ??
    arrErrors ??
    (status === 403 ? 'Only OWNER can perform this action.' : undefined) ??
    (status === 404 ? 'User not found.' : undefined) ??
    err?.message ??
    'User operation failed';
  throw new Error(msg);
};

export const getUsersApi = async (): Promise<ApiUser[]> => {
  try {
    const { data } = await api.get('/api/v1/users');
    if (data?.ok === false) {
      throw new Error(data?.error?.messageKey ?? data?.error?.code ?? 'Failed to load users');
    }
    const items = data?.data?.items ?? data?.data ?? extractArray(data);
    return Array.isArray(items) ? items : [];
  } catch (err: any) {
    const status: number | undefined = err?.response?.status;
    if (status === 501) throw new Error('Users feature is not available on this server.');
    if (status === 403 || status === 401) throw new Error('You do not have permission to view users.');
    throw err;
  }
};

export const getUserApi = async (id: string): Promise<ApiUser> => {
  try {
    const { data } = await api.get(`/api/v1/users/${id}`);
    if (data?.ok === false) throw new Error(data?.error?.messageKey ?? 'Failed to load user');
    return data?.data ?? data;
  } catch (err: any) {
    return handleUserError(err);
  }
};

export const createUserApi = async (input: CreateUserInput): Promise<ApiUser> => {
  const orgId = Number(_orgId);
  if (!orgId) throw new Error('Organization ID not available — please log in again.');
  try {
    const { data } = await api.post('/api/v1/users', { ...input, orgId });
    if (data?.ok === false) throw new Error(data?.error?.message ?? data?.error?.messageKey ?? 'Failed to create user');
    return data?.data ?? data;
  } catch (err: any) {
    return handleUserError(err);
  }
};

export const updateUserApi = async (id: string, input: UpdateUserInput): Promise<ApiUser> => {
  try {
    const { data } = await api.patch(`/api/v1/users/${id}`, input);
    if (data?.ok === false) throw new Error(data?.error?.messageKey ?? 'Failed to update user');
    return data?.data ?? data;
  } catch (err: any) {
    return handleUserError(err);
  }
};

export const deleteUserApi = async (id: string): Promise<void> => {
  try {
    const { data } = await api.delete(`/api/v1/users/${id}`);
    if (data?.ok === false) throw new Error(data?.error?.messageKey ?? 'Failed to delete user');
  } catch (err: any) {
    handleUserError(err);
  }
};

export const disableUserApi = async (id: string): Promise<void> => {
  try {
    const { data } = await api.patch(`/api/v1/users/${id}/disable`);
    if (data?.ok === false) throw new Error(data?.error?.message ?? data?.error?.messageKey ?? 'Failed to disable user');
  } catch (err: any) {
    return handleUserError(err);
  }
};

export const enableUserApi = async (id: string): Promise<void> => {
  try {
    const { data } = await api.patch(`/api/v1/users/${id}/enable`);
    if (data?.ok === false) throw new Error(data?.error?.message ?? data?.error?.messageKey ?? 'Failed to enable user');
  } catch (err: any) {
    return handleUserError(err);
  }
};

// ─── Create Category ──────────────────────────────────────────────────────────

export interface CategoryCreateInput {
  nameEn: string;
  nameKm: string;
  parentId?: string | null;
  sort?: number;
}

export const createCategoryApi = async (input: CategoryCreateInput): Promise<ApiCategory> => {
  const { data } = await api.post('/api/v1/categories', input);
  if (data?.ok === false) {
    const msg: string = data?.error?.messageKey ?? data?.error?.code ?? 'Failed to create category';
    throw new Error(msg);
  }
  return data?.data ?? data;
};

export const updateCategoryApi = async (id: string, input: Partial<CategoryCreateInput>): Promise<ApiCategory> => {
  const { data } = await api.patch(`/api/v1/categories/${id}`, input);
  if (data?.ok === false) {
    const msg: string = data?.error?.messageKey ?? data?.error?.code ?? 'Failed to update category';
    throw new Error(msg);
  }
  return data?.data ?? data;
};

export const deleteCategoryApi = async (id: string): Promise<void> => {
  const { data } = await api.delete(`/api/v1/categories/${id}`);
  if (data?.ok === false) throw new Error(data?.error?.messageKey ?? data?.error?.code ?? 'Failed to delete category');
};

// ─── Create Product ───────────────────────────────────────────────────────────

export interface ProductCreateInput {
  sku: string;
  nameEn: string;
  nameKm: string;
  pricingMode: 'FIXED' | 'RFQ';
  fixedPriceCents?: string; // bigint serialized as string
  costPriceCents?: string | null;
  categoryId?: string | null;
  vendorId?: number | null;
  uomId?: number | null;
  unit: string;
  isRentalItem: boolean;
  active: boolean;
  descriptionEn?: string | null;
  descriptionKm?: string | null;
  primaryImageUrl?: string | null;
  country?: string | null;
  size?: string | null;
  barcode?: string | null;
}

export const createProductApi = async (input: ProductCreateInput): Promise<ApiProduct> => {
  const orgId = Number(_orgId);
  if (!orgId) throw new Error('Organization ID not available — please log in again.');
  // Strip null/undefined optional fields — backend crashes on unexpected nulls
  const body: Record<string, any> = {
    orgId,
    sku:          input.sku,
    nameEn:       input.nameEn,
    nameKm:       input.nameKm,
    pricingMode:  input.pricingMode,
    unit:         input.unit,
    isRentalItem: input.isRentalItem,
    active:       input.active,
  };
  if (input.fixedPriceCents != null)  body.fixedPriceCents  = input.fixedPriceCents;
  if (input.costPriceCents  != null)  body.costPriceCents   = input.costPriceCents;
  if (input.categoryId      != null)  body.categoryId       = input.categoryId;
  if (input.vendorId        != null)  body.vendorId         = input.vendorId;
  if (input.uomId           != null)  body.uomId            = input.uomId;
  if (input.descriptionEn   != null)  body.descriptionEn    = input.descriptionEn;
  if (input.descriptionKm   != null)  body.descriptionKm    = input.descriptionKm;
  if (input.primaryImageUrl != null)  body.primaryImageUrl  = input.primaryImageUrl;
  if (input.country         != null)  body.country          = input.country;
  if (input.size            != null)  body.size             = input.size;
  if (input.barcode         != null)  body.barcode          = input.barcode;
  try {
    const { data } = await api.post('/api/v1/products', body);
    if (data?.ok === false) {
      const msg: string = data?.error?.messageKey ?? data?.error?.code ?? 'Failed to create product';
      throw new Error(msg);
    }
    return data?.data ?? data;
  } catch (err: any) {
    throw err;
  }
};

// ─── Update Product ───────────────────────────────────────────────────────────

export interface ProductUpdateInput {
  nameEn?: string;
  nameKm?: string;
  pricingMode?: 'FIXED' | 'RFQ';
  fixedPriceCents?: string | null;
  costPriceCents?: string | null;
  categoryId?: string | null;
  vendorId?: number | null;
  uomId?: number | null;
  unit?: string;
  isRentalItem?: boolean;
  active?: boolean;
  descriptionEn?: string | null;
  descriptionKm?: string | null;
  primaryImageUrl?: string | null;
  country?: string | null;
  size?: string | null;
  barcode?: string | null;
}

export const updateProductApi = async (id: string, input: ProductUpdateInput): Promise<ApiProduct> => {
  const { data } = await api.patch(`/api/v1/products/${id}`, input);
  if (data?.ok === false) {
    const msg: string = data?.error?.messageKey ?? data?.error?.code ?? 'Failed to update product';
    throw new Error(msg);
  }
  return data?.data ?? data;
};

export const deleteProductApi = async (id: string): Promise<void> => {
  const { data } = await api.delete(`/api/v1/products/${id}`);
  if (data?.ok === false) throw new Error(data?.error?.messageKey ?? data?.error?.code ?? 'Failed to delete product');
};

export const changeSkuApi = async (currentSku: string, newSku: string): Promise<ApiProduct> => {
  try {
    const { data } = await api.patch('/api/v1/products/change-sku', { currentSku, newSku });
    if (data?.ok === false) {
      const msg: string = data?.error?.messageKey ?? data?.error?.code ?? 'Failed to change SKU';
      throw new Error(msg);
    }
    return data?.data ?? data;
  } catch (err: any) {
    // Extract API error body from HTTP 4xx/5xx responses
    if (err?.response?.data) {
      const d = err.response.data;
      const msg: string | undefined =
        d?.error?.messageKey ?? d?.error?.code ?? d?.error?.message ?? d?.message;
      if (msg) throw new Error(msg);
    }
    throw err;
  }
};

// ─── Product last costs ───────────────────────────────────────────────────────

export interface ApiLastCost {
  productId: number | string;
  sku?: string;
  nameEn?: string;
  nameKm?: string;
  lastCostCents: string | number; // dollar value, 4 decimal places (e.g. "27.0000")
  lastPoDate?: string | null;
}

export const getProductsLastCostsApi = async (): Promise<ApiLastCost[]> => {
  const { data } = await api.get('/api/v1/stock/last-cost');
  return data?.data?.items ?? data?.data ?? data?.items ?? [];
};

export const getProductLastCostApi = async (productId: string): Promise<ApiLastCost | null> => {
  const { data } = await api.get(`/api/v1/products/${productId}/last-cost`);
  return data?.lastCost ?? null;
};

export const getStockLastCostBySkuApi = async (sku: string): Promise<number | null> => {
  const { data } = await api.get('/api/v1/stock/last-cost', { params: { sku } });
  const items: any[] = data?.data?.items ?? data?.data ?? data?.items ?? [];
  const match = Array.isArray(items)
    ? items.find(it => String(it.sku ?? '') === String(sku))
    : null;
  const raw = (match ?? items[0])?.lastCostCents ?? null;
  return raw != null ? Number(raw) : null;
};

// ─── PO received images ───────────────────────────────────────────────────────

export interface ApiPOReceivedImage {
  id: string;
  url: string;
  poItemId?: string | null;
  note?: string | null;
  sort?: number | null;
}

export const getPOReceivedImagesApi = async (poId: string): Promise<ApiPOReceivedImage[]> => {
  const { data } = await api.get(`/api/v1/purchase-orders/${poId}/received-images`);
  const list = data?.data?.items ?? data?.data ?? data?.items ?? [];
  return Array.isArray(list) ? list : [];
};

export const addPOReceivedImagesApi = async (
  poId: string,
  images: { url: string; poItemId?: string; note?: string; sort?: number }[],
): Promise<ApiPOReceivedImage[]> => {
  const { data } = await api.post(`/api/v1/purchase-orders/${poId}/received-images`, { images });
  if (data?.ok === false) throw new Error(data?.error?.message ?? 'Failed to save images');
  const list = data?.data?.items ?? data?.data ?? data?.items ?? [];
  return Array.isArray(list) ? list : [];
};

export const deletePOReceivedImageApi = async (poId: string, imageId: string): Promise<void> => {
  await api.delete(`/api/v1/purchase-orders/${poId}/received-images/${imageId}`);
};

export const uploadPurchaseOrderImageApi = async (
  poId: string,
  asset: { uri: string; type?: string; fileName?: string },
): Promise<ApiPOReceivedImage> => {
  const formData = new FormData();
  formData.append('file', { uri: asset.uri, type: asset.type ?? 'image/jpeg', name: asset.fileName ?? `po-img-${Date.now()}.jpg` } as any);
  const { data } = await api.post(`/api/v1/purchase-orders/${poId}/images`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  if (data?.ok === false) throw new Error(data?.error?.messageKey ?? 'Failed to upload image');
  return data?.data ?? data;
};

// ─── Campuses ─────────────────────────────────────────────────────────────────

export interface ApiCampus {
  id: string | number;
  campusCode: string;
  nameEn: string;
  nameKm: string;
  address?: string | null;
  phone?: string | null;
  active?: boolean;
  orgId?: string | null;
}

export interface CampusCreateInput {
  campusCode: string;
  nameEn: string;
  nameKm: string;
  address?: string;
  phone?: string;
}

export interface CampusUpdateInput {
  campusCode?: string;
  nameEn?: string;
  nameKm?: string;
  address?: string | null;
  phone?: string | null;
  active?: boolean;
}

export const getCampusesApi = async (): Promise<ApiCampus[]> => {
  const { data } = await api.get('/api/v1/campuses');
  if (data?.ok === false || data?.success === false) {
    const msg: string = data?.error?.messageKey ?? data?.error?.code ?? 'Failed to load campuses';
    throw new Error(msg);
  }
  const items = data?.data?.items ?? data?.data ?? extractArray(data);
  return Array.isArray(items) ? items : [];
};

export const createCampusApi = async (input: CampusCreateInput): Promise<ApiCampus> => {
  const orgId = Number(_orgId);
  if (!orgId) throw new Error('Organization ID not available — please log in again.');
  const body: Record<string, any> = {
    orgId,
    campusCode: input.campusCode,
    nameEn:     input.nameEn,
    nameKm:     input.nameKm,
  };
  if (input.address) body.address = input.address;
  if (input.phone)   body.phone   = input.phone;
  try {
    const { data } = await api.post('/api/v1/campuses', body);
    if (data?.ok === false || data?.success === false) {
      const msg: string = data?.error?.messageKey ?? data?.error?.code ?? 'Failed to create campus';
      throw new Error(msg);
    }
    return data?.data ?? data;
  } catch (err: any) {
    throw err;
  }
};

export const updateCampusApi = async (id: string, input: CampusUpdateInput): Promise<ApiCampus> => {
  const { data } = await api.patch(`/api/v1/campuses/${id}`, input);
  if (data?.ok === false || data?.success === false) {
    const msg: string = data?.error?.messageKey ?? data?.error?.code ?? 'Failed to update campus';
    throw new Error(msg);
  }
  return data?.data ?? data;
};

export const deleteCampusApi = async (id: string): Promise<void> => {
  const { data } = await api.delete(`/api/v1/campuses/${id}`);
  if (data?.ok === false || data?.success === false) {
    const msg: string = data?.error?.messageKey ?? data?.error?.code ?? 'Failed to delete campus';
    throw new Error(msg);
  }
};

// ─── Delivery Orders ──────────────────────────────────────────────────────────

export type DOStatus = 'DRAFT' | 'CONFIRMED' | 'DELIVERING' | 'DELIVERED' | 'CANCELLED';

export interface ApiDeliveryOrderItem {
  productId: string;
  qty: number;
  productName?: string;
  productNameEn?: string;
}

export interface ApiDeliveryOrder {
  id: string;
  doId?: string;
  doNumber?: string;
  doRef?: string;
  ref?: string;
  referenceNumber?: string;
  status?: DOStatus;
  soId?: string | null;
  customerOrgId?: string | null;
  campusId?: string | number | null;
  locationId?: number | string | null;
  deliveredAt: string | null;
  deliveredByUserId?: string | null;
  receivedBy: string | null;
  signatureUrl?: string | null;
  note: string | null;
  items?: ApiDeliveryOrderItem[];
  createdAt: string;
  updatedAt: string;
}

export const getDeliveryOrdersApi = async (): Promise<ApiDeliveryOrder[]> => {
  const { data } = await api.get('/api/v1/delivery-orders');
  if (data?.ok === false || data?.success === false) {
    const msg: string = data?.error?.messageKey ?? data?.error?.code ?? 'Failed to load delivery orders';
    throw new Error(msg);
  }
  const items = data?.data?.items ?? data?.data ?? extractArray(data);
  if (!Array.isArray(items)) return [];
  // Normalise snake_case / alternate field names from the API
  return items.map((d: any) => {
    const soId =
      d.soId ?? d.so_id ?? d.salesOrderId ?? d.sales_order_id ??
      d.orderId ?? d.order_id ?? d.salesOrder?.id ?? d.sale_order?.id;
    const signatureUrl =
      d.signatureUrl ?? d.signature_url ?? d.signatureImageUrl ??
      d.signature_image_url ?? d.signature ?? null;
    return {
      ...d,
      id:           d.id ?? d.doId,
      doId:         d.doId ?? d.do_id,
      doRef:        d.doRef ?? d.do_ref,
      soId,
      signatureUrl,
      campusId:     d.campusId ?? d.campus_id,
      deliveredAt:  d.deliveredAt ?? d.delivered_at,
      receivedBy:   d.receivedBy ?? d.received_by,
      createdAt:    d.createdAt ?? d.created_at,
      updatedAt:    d.updatedAt ?? d.updated_at,
    };
  });
};

export const getDeliveryOrdersBySoApi = async (soId: string): Promise<ApiDeliveryOrder[]> => {
  const { data } = await api.get(`/api/v1/sales-orders/${soId}/delivery-orders`);
  if (data?.ok === false || data?.success === false) {
    const msg: string = data?.error?.messageKey ?? data?.error?.code ?? 'Failed to load delivery orders';
    throw new Error(msg);
  }
  const raw = data?.data?.items ?? data?.data ?? data?.items ?? extractArray(data);
  if (!Array.isArray(raw)) return [];
  return raw.map((d: any) => ({
    ...d,
    id:              d.id ?? d.doId ?? d.do_id,
    doId:            d.doId ?? d.do_id,
    doRef:           d.doRef ?? d.do_ref,
    doNumber:        d.doNumber ?? d.do_number,
    referenceNumber: d.referenceNumber ?? d.reference_number ?? d.doRef ?? d.doNumber ?? d.ref,
    soId,
    signatureUrl:    d.signatureUrl ?? d.signature_url ?? d.signatureImageUrl ?? d.signature_image_url ?? null,
    campusId:        d.campusId ?? d.campus_id,
    locationId:      d.locationId ?? d.location_id,
    deliveredAt:     d.deliveredAt ?? d.delivered_at,
    receivedBy:      d.receivedBy ?? d.received_by,
    status:          d.status,
    createdAt:       d.createdAt ?? d.created_at,
    updatedAt:       d.updatedAt ?? d.updated_at,
  }));
};

// ─── Sales Orders ─────────────────────────────────────────────────────────────

export interface ApiSalesOrderItem {
  id: string;        // soItemId — used when creating delivery order
  productId: string;
  productName?: string;   // nameEn
  productNameKh?: string; // nameKm / Khmer name
  productCode?: string;
  product?: { id?: string; name?: string; nameEn?: string; nameKm?: string; code?: string; sku?: string };
  qty: number;
  qtyDelivered?: number;  // already delivered in previous DOs
  unitPriceCents: number;
  discountCents?: number;
}

export interface ApiSalesOrder {
  id: string;
  ref: string;
  referenceNumber?: string;
  orderNumber?: string;
  campusId: string | number | null;
  campusCode?: string;
  campus?: { campusCode?: string; nameEn?: string };
  locationId?: number | string | null;
  location?: { id?: number | string; code?: string; nameEn?: string };
  status: string;
  items: ApiSalesOrderItem[];
  totalCents?: number;
  createdAt: string;
  orderDate?: string;
  soDate?: string;
  note?: string;
  receivedBy?: string;
  createdByName?: string;
  createdByUser?: { id?: string; name?: string; email?: string };
  org?: { id?: string; name?: string; nameEn?: string };
  customerOrg?: { id?: string; name?: string; nameEn?: string; nameKm?: string };
  customerOrgId?: string;
  customerOrgName?: string;
  // Quotation source (set when SO is converted from a quotation)
  quotationId?: string;
  quotationIds?: string[];
  quotationNumber?: string;
  quotation_number?: string;
  quotationRef?: string;
  sourceQuotationId?: string;
  quotation?: { id?: string; quotationNumber?: string; quotation_number?: string; ref?: string; referenceNumber?: string };
}

export const getSalesOrdersApi = async (): Promise<ApiSalesOrder[]> => {
  const { data } = await api.get('/api/v1/sales-orders');
  if (data?.ok === false || data?.success === false) {
    const msg: string = data?.error?.messageKey ?? data?.error?.code ?? 'Failed to load sales orders';
    throw new Error(msg);
  }
  const items = data?.data?.items ?? data?.data ?? extractArray(data);
  return Array.isArray(items) ? items : [];
};

export const getSalesOrderApi = async (id: string): Promise<ApiSalesOrder> => {
  const { data } = await api.get(`/api/v1/sales-orders/${id}`);
  if (data?.ok === false || data?.success === false) {
    const msg: string = data?.error?.messageKey ?? data?.error?.code ?? 'Failed to get sales order';
    throw new Error(msg);
  }
  const result = data?.data ?? data;
  const rawItems: ApiSalesOrderItem[] = result.items ?? result.salesOrderItems ?? result.lineItems ?? result.orderItems ?? result.data?.items ?? [];
  // Normalise product fields from nested `product` object if present
  const items = rawItems.map(i => ({
    ...i,
    productName:   i.productName   ?? i.product?.nameEn ?? i.product?.name ?? undefined,
    productNameKh: i.productNameKh ?? i.product?.nameKm ?? undefined,
    productCode:   i.productCode   ?? i.product?.code   ?? i.product?.sku  ?? undefined,
  }));
  return { ...result, items };
};

export const confirmSalesOrderApi = async (id: string): Promise<void> => {
  const { data } = await api.post(`/api/v1/sales-orders/${id}/confirm`);
  if (data?.ok === false || data?.success === false) {
    const msg: string = data?.error?.messageKey ?? data?.error?.code ?? 'Failed to confirm sales order';
    throw new Error(msg);
  }
};

export const updateSalesOrderItemsApi = async (
  id: string,
  items: Array<{ id?: string; productId?: string; qty?: number; unitPriceCents?: number; discountCents?: number }>,
  extra?: { campusId?: string | number | null; locationId?: string | number | null; customerOrgId?: string | number | null },
): Promise<void> => {
  const body: Record<string, any> = { items };
  if (extra?.campusId != null) body.campusId = extra.campusId;
  if (extra?.locationId != null) body.locationId = extra.locationId;
  if (extra?.customerOrgId != null) body.customerOrgId = extra.customerOrgId;
  const { data } = await api.patch(`/api/v1/sales-orders/${id}`, body);
  if (data?.ok === false || data?.success === false) {
    const msg: string = data?.error?.messageKey ?? data?.error?.code ?? 'Failed to update order items';
    throw new Error(msg);
  }
};

export const createSalesOrderApi = async (input: {
  campusId?: string | number;
  locationId?: string | number;
  customerOrgId: string | number;
  rateUsed?: number;
  type?: 'SO' | 'DO' | 'INV';
  orderDate?: string;
  soDate?: string;
  note?: string;
  receivedBy?: string;
  referenceNumber?: string;
  items: Array<{
    productId: number;
    qty: number;
    unitPriceCents: number;
    discountCents?: number;
  }>;
}): Promise<ApiSalesOrder> => {
  const payload = {
    ...input,
    rateUsed: input.rateUsed ?? 4100,
    // omit discountCents when 0 — backend rejects explicit zero
    items: input.items.map(({ discountCents, ...rest }) =>
      discountCents ? { ...rest, discountCents } : rest,
    ),
  };
  try {
    const { data } = await api.post('/api/v1/sales-orders', payload);
    if (data?.ok === false || data?.success === false) {
      const msg: string = data?.error?.messageKey ?? data?.error?.code ?? 'Failed to create sales order';
      throw new Error(msg);
    }
    return data?.data ?? data;
  } catch (err: any) {
    const body = err?.response?.data;
    if (body) {
      const msg: string =
        body?.error?.messageKey ??
        body?.error?.code ??
        body?.message ??
        (Array.isArray(body?.error?.issues) ? body.error.issues.map((e: any) => `${e?.path?.join('.')}: ${e?.message}`).join(' | ') : undefined) ??
        (Array.isArray(body?.errors) ? body.errors.map((e: any) => e?.message ?? e).join(', ') : undefined) ??
        (typeof body === 'string' ? body : undefined) ??
        `Failed to create sales order (${err?.response?.status})`;
      const richErr: any = new Error(msg);
      richErr.response = err.response;
      throw richErr;
    }
    throw err;
  }
};

// ─── Create Delivery Order ────────────────────────────────────────────────────

export const createDeliveryOrderApi = async (
  soId: string,
  input: {
    items: Array<{ soItemId: number; qtyDelivered: number }>;
    campusId?: number;
    locationId?: number;
    receivedBy?: string;
    signatureUrl?: string;
    note?: string;
    deliveredAt?: string;
  },
): Promise<ApiDeliveryOrder> => {
  let data: any;
  try {
    const res = await api.post(`/api/v1/sales-orders/${soId}/delivery-orders`, input);
    data = res.data;
  } catch (err: any) {
    const body = err?.response?.data;
    const msg: string =
      body?.error?.messageKey ??
      body?.error?.code ??
      body?.message ??
      (Array.isArray(body?.error?.issues) ? body.error.issues.map((e: any) => `${e?.path?.join('.')}: ${e?.message}`).join(' | ') : undefined) ??
      (Array.isArray(body?.errors) ? body.errors.map((e: any) => e?.message ?? e).join(', ') : undefined) ??
      (typeof body === 'string' ? body : undefined) ??
      `Failed to create delivery order (${err?.response?.status})`;
    const richErr: any = new Error(msg);
    richErr.response = err.response;
    throw richErr;
  }
  if (data?.ok === false || data?.success === false) {
    const msg: string = data?.error?.messageKey ?? data?.error?.code ?? 'Failed to create delivery order';
    throw new Error(msg);
  }
  const result = data?.data ?? data;
  // Normalise field name variants (camelCase, snake_case, doRef/doId from this API)
  return {
    ...result,
    id:              result.id ?? result.doId,
    doId:            result.doId,
    doRef:           result.doRef,
    ref:             result.ref ?? result.doRef ?? result.referenceNumber ?? result.reference_number,
    referenceNumber: result.referenceNumber ?? result.doRef ?? result.reference_number ?? result.ref,
    soId:            result.soId ?? result.so_id,
    campusId:        result.campusId ?? result.campus_id,
    deliveredAt:     result.deliveredAt ?? result.delivered_at,
    receivedBy:      result.receivedBy ?? result.received_by,
    signatureUrl:    result.signatureUrl ?? result.signature_url,
    createdAt:       result.createdAt ?? result.created_at,
    updatedAt:       result.updatedAt ?? result.updated_at,
  };
};

// ─── Delivery Order — top-level CRUD ─────────────────────────────────────────

export interface CreateDeliveryOrderInput {
  customerOrgId: string;
  soId?: string;
  campusId?: number;
  locationId?: number;
  receivedBy: string;
  note?: string;
  deliveredAt?: string;
  items: Array<{ productId: string; qty: number }>;
}

export interface UpdateDeliveryOrderInput {
  campusId?: number;
  locationId?: number;
  receivedBy?: string;
  note?: string;
}

export const createDeliveryOrderTopLevelApi = async (
  input: CreateDeliveryOrderInput,
): Promise<ApiDeliveryOrder> => {
  const { data } = await api.post('/api/v1/delivery-orders', input);
  if (data?.ok === false || data?.success === false) {
    const msg: string = data?.error?.messageKey ?? data?.error?.code ?? 'Failed to create delivery order';
    throw new Error(msg);
  }
  const result = data?.data ?? data;
  return {
    ...result,
    id:              result.id ?? result.doId,
    doNumber:        result.doNumber ?? result.doRef ?? result.referenceNumber,
    doRef:           result.doRef ?? result.doNumber,
    ref:             result.ref ?? result.doRef ?? result.doNumber ?? result.referenceNumber,
    referenceNumber: result.referenceNumber ?? result.doNumber ?? result.doRef ?? result.ref,
    status:          result.status,
    soId:            result.soId ?? result.so_id ?? null,
    customerOrgId:   result.customerOrgId ?? result.customer_org_id ?? null,
    campusId:        result.campusId ?? result.campus_id ?? null,
    locationId:      result.locationId ?? result.location_id ?? null,
    deliveredAt:     result.deliveredAt ?? result.delivered_at,
    receivedBy:      result.receivedBy ?? result.received_by,
    signatureUrl:    result.signatureUrl ?? result.signature_url ?? null,
    createdAt:       result.createdAt ?? result.created_at,
    updatedAt:       result.updatedAt ?? result.updated_at,
  };
};

export const updateDeliveryOrderApi = async (
  id: string,
  input: UpdateDeliveryOrderInput,
): Promise<ApiDeliveryOrder> => {
  const { data } = await api.patch(`/api/v1/delivery-orders/${id}`, input);
  if (data?.ok === false || data?.success === false) {
    const msg: string = data?.error?.messageKey ?? data?.error?.code ?? 'Failed to update delivery order';
    throw new Error(msg);
  }
  return data?.data ?? data;
};

export const getDeliveryOrderApi = async (id: string): Promise<ApiDeliveryOrder> => {
  const { data } = await api.get(`/api/v1/delivery-orders/${id}`);
  if (data?.ok === false || data?.success === false) {
    const msg: string = data?.error?.messageKey ?? data?.error?.code ?? 'Failed to get delivery order';
    throw new Error(msg);
  }
  const result = data?.data ?? data;
  const rawItems: ApiDeliveryOrderItem[] =
    result.items ?? result.lineItems ?? result.doItems ?? result.orderItems ??
    result.deliveryOrderItems ?? result.do_items ?? result.order_items ?? [];
  const items: ApiDeliveryOrderItem[] = rawItems.map((i: any) => ({
    ...i,
    productId:     i.productId     ?? i.product_id     ?? i.productId ?? i.product?.id ?? '',
    qty:           i.qty           ?? i.quantity        ?? i.qtyDelivered ?? 0,
    productName:   i.productName   ?? i.product_name   ?? i.product?.nameEn ?? i.product?.name ?? undefined,
    productNameEn: i.productNameEn ?? i.product_name_en ?? i.product?.nameEn ?? undefined,
  }));
  return {
    ...result,
    id:              result.id ?? result.doId,
    doId:            result.doId ?? result.do_id,
    doRef:           result.doRef ?? result.do_ref,
    doNumber:        result.doNumber ?? result.do_number,
    referenceNumber: result.referenceNumber ?? result.reference_number ?? result.doRef ?? result.doNumber ?? result.ref,
    soId:            result.soId ?? result.so_id ?? null,
    campusId:        result.campusId ?? result.campus_id,
    locationId:      result.locationId ?? result.location_id,
    deliveredAt:     result.deliveredAt ?? result.delivered_at,
    receivedBy:      result.receivedBy ?? result.received_by,
    signatureUrl:    result.signatureUrl ?? result.signature_url ?? result.signatureImageUrl ?? null,
    note:            result.note ?? null,
    createdAt:       result.createdAt ?? result.created_at,
    updatedAt:       result.updatedAt ?? result.updated_at,
    items,
  };
};

export const updateDeliveryOrderStatusApi = async (
  id: string,
  status: DOStatus,
): Promise<void> => {
  const { data } = await api.patch(`/api/v1/delivery-orders/${id}/status`, { status });
  if (data?.ok === false || data?.success === false) {
    const msg: string = data?.error?.messageKey ?? data?.error?.code ?? 'Failed to update delivery order status';
    throw new Error(msg);
  }
};

// ─── Upload Direct (generic image upload) ────────────────────────────────────

export const uploadDirectApi = async (
  asset: { uri: string; type?: string; fileName?: string; purpose?: string },
): Promise<string> => {
  const formData = new FormData();
  formData.append('file', {
    uri: asset.uri,
    type: asset.type ?? 'image/svg+xml',
    name: asset.fileName ?? 'file.svg',
  } as any);
  formData.append('purpose', asset.purpose ?? 'delivery_signature');
  const { data } = await api.post('/api/v1/uploads/direct', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  if (data?.ok === false) {
    throw new Error(data?.error?.messageKey ?? data?.error?.code ?? 'Failed to upload file');
  }
  const d = data?.data ?? data;
  // Handle { data: "https://..." } — data is the URL string directly
  const url: string = typeof d === 'string'
    ? d
    : (d?.url ?? d?.fileUrl ?? d?.file_url ?? d?.signedUrl ?? d?.signed_url ??
       d?.publicUrl ?? d?.public_url ?? d?.path ?? d?.location ?? d?.href ?? d?.uri);
  if (!url || typeof url !== 'string') throw new Error(`Upload succeeded but no URL returned. Keys: ${Object.keys(d ?? {}).join(', ')}`);
  return url;
};

// ─── Sale Order Signatures (list) ────────────────────────────────────────────

export interface ApiSaleOrderSignature {
  id: string;
  soId: string;
  signatureUrl: string;
  type: string;
  signedByUserId: string;
  createdAt: string;
}

export const getSaleOrderSignaturesApi = async (soId: string): Promise<ApiSaleOrderSignature[]> => {
  try {
    const { data } = await api.get(`/api/v1/sales-orders/${soId}/signatures`);
    if (data?.ok === false || data?.success === false) return [];
    const items = data?.data?.items ?? data?.data ?? extractArray(data);
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
};

// ─── Sale Order Signature ─────────────────────────────────────────────────────

export const uploadSaleOrderSignatureApi = async (
  soId: string,
  signatureUrl: string,
  type?: string,
): Promise<void> => {
  const body: Record<string, string> = { signatureUrl };
  if (type) body.type = type;
  const { data } = await api.post(`/api/v1/sales-orders/${soId}/signatures`, body);
  if (data?.ok === false) {
    throw new Error(data?.error?.messageKey ?? data?.error?.code ?? 'Failed to save signature');
  }
};

export type SaleOrderStatus =
  | 'PREPARE'
  | 'SALE_ORDERS'
  | 'CONFIRMED'
  | 'RECEIVED'
  | 'INVOICED'
  | 'PAID'
  | 'CANCELLED';

export const updateSalesOrderStatusApi = async (id: string, status: SaleOrderStatus): Promise<void> => {
  try {
    const { data } = await api.patch(`/api/v1/sales-orders/${id}/status`, { status });
    if (data?.ok === false || data?.success === false) {
      throw new Error(data?.error?.messageKey ?? data?.error?.code ?? 'Failed to update status');
    }
  } catch (err: any) {
    const body = err?.response?.data;
    if (body) {
      const msg: string =
        body?.error?.messageKey ??
        body?.error?.code ??
        body?.message ??
        (Array.isArray(body?.error?.issues) ? body.error.issues.map((e: any) => `${e?.path?.join('.')}: ${e?.message}`).join(' | ') : undefined) ??
        (typeof body === 'string' ? body : undefined) ??
        `Failed to update status (${err?.response?.status})`;
      throw new Error(msg);
    }
    throw err;
  }
};

// ─── Invoice Headers ──────────────────────────────────────────────────────────

export interface ApiInvoiceDetail {
  id: string;
  soId: string;
  soReferenceNumber?: string;
  productId?: string;
  productSku?: string;
  productNameEn?: string;
  productNameKm?: string;
  productNameKh?: string;
  qty: number;
  unitPriceCents: number | string;
  discountCents: number | string;
}

export interface ApiInvoiceHeader {
  id: string;
  invoiceNumber: string;
  customerOrgId: string;
  customerOrg?: { id?: string; name?: string; nameEn?: string; nameKm?: string };
  campusId: number | string;
  campus?: { campusCode?: string; nameEn?: string };
  campusCode?: string;
  locationId?: number | string | null;
  location?: { id?: number | string; code?: string; nameEn?: string };
  status: string;
  totalCents: number | string | null;
  rateUsed?: number;
  issuedAt?: string;
  dueAt?: string;
  note?: string | null;
  createdByUserId?: string;
  details?: ApiInvoiceDetail[];
  createdAt: string;
  updatedAt?: string;
  summaryNumber?: string | null;
  summaryId?: string | null;
}

export interface CreateInvoiceHeaderInput {
  customerOrgId: string;
  campusId: number | string;
  locationId?: number | string;
  soIds: string[];
  rateUsed?: number;
  note?: string;
  issuedAt?: string;
  dueAt?: string;
}

export const getInvoiceHeadersApi = async (params?: {
  unsummarized?: boolean;
  invoiceNumber?: string;
  from?: string;
  to?: string;
  customerOrgId?: string | number;
  campusId?: string | number;
  status?: string;
}): Promise<ApiInvoiceHeader[]> => {
  const p: Record<string, string> = {};
  if (params?.unsummarized) p.unsummarized = 'true';
  if (params?.invoiceNumber) p.invoiceNumber = params.invoiceNumber;
  if (params?.from) p.from = params.from;
  if (params?.to) p.to = params.to;
  if (params?.customerOrgId != null) p.customerOrgId = String(params.customerOrgId);
  if (params?.campusId != null) p.campusId = String(params.campusId);
  if (params?.status) p.status = params.status;
  const { data } = await api.get('/api/v1/invoice-headers', { params: p });
  if (data?.ok === false || data?.success === false) {
    const msg: string = data?.error?.messageKey ?? data?.error?.code ?? 'Failed to load invoices';
    throw new Error(msg);
  }
  const items = data?.data?.items ?? data?.data ?? extractArray(data);
  return Array.isArray(items) ? items : [];
};

export const getInvoiceHeaderApi = async (id: string): Promise<ApiInvoiceHeader> => {
  const { data } = await api.get(`/api/v1/invoice-headers/${id}`);
  if (data?.ok === false || data?.success === false) {
    const msg: string = data?.error?.messageKey ?? data?.error?.code ?? 'Failed to load invoice';
    throw new Error(msg);
  }
  const result = data?.data ?? data;
  if (Array.isArray(result.details)) {
    result.details = result.details.map((d: any) => ({
      ...d,
      productNameEn: d.productNameEn ?? d.product?.nameEn ?? d.product?.name ?? undefined,
      productNameKm: d.productNameKm ?? d.productNameKh ?? d.product?.nameKm ?? undefined,
    }));
  }
  return result;
};

export const getInvoiceExportCsvApi = async (params?: {
  status?: string;
  from?: string;
  to?: string;
  campusId?: string | number;
  invoiceNumber?: string;
}): Promise<string> => {
  const p: Record<string, string> = {};
  if (params?.status)           p.status        = params.status;
  if (params?.from)             p.from          = params.from;
  if (params?.to)               p.to            = params.to;
  if (params?.campusId != null) p.campusId      = String(params.campusId);
  if (params?.invoiceNumber)    p.invoiceNumber = params.invoiceNumber;
  const { data } = await api.get('/api/v1/exports/invoices', {
    params: p,
    responseType: 'text',
    headers: { Accept: 'text/csv' },
  });
  // API may return raw CSV string or a JSON envelope — unwrap if needed
  if (typeof data === 'string') return data;
  if (data && typeof data === 'object') {
    const inner = (data as any)?.data ?? (data as any)?.csv ?? (data as any)?.content;
    if (typeof inner === 'string') return inner;
  }
  return '';
};

export const getInvoiceExportByIdCsvApi = async (id: number | string): Promise<string> => {
  const { data } = await api.get(`/api/v1/exports/invoice/${id}`, {
    responseType: 'text',
    headers: { Accept: 'text/csv' },
  });
  if (typeof data === 'string') return data;
  if (data && typeof data === 'object') {
    const inner = (data as any)?.data ?? (data as any)?.csv ?? (data as any)?.content;
    if (typeof inner === 'string') return inner;
  }
  return '';
};

export const getPOsExportCsvApi = async (params?: {
  from?: string;
  to?: string;
  locationId?: string | number | null;
}): Promise<string> => {
  const p: Record<string, string> = {};
  if (params?.from) p.from = params.from;
  if (params?.to) p.to = params.to;
  if (params?.locationId != null) p.locationId = String(params.locationId);
  const { data } = await api.get('/api/v1/exports/pos', {
    params: p,
    responseType: 'text',
    headers: { Accept: 'text/csv' },
  });
  if (typeof data === 'string') return data;
  if (data && typeof data === 'object') {
    const inner = (data as any)?.data ?? (data as any)?.csv ?? (data as any)?.content;
    if (typeof inner === 'string') return inner;
  }
  return '';
};

export const createInvoiceHeaderApi = async (
  input: CreateInvoiceHeaderInput,
): Promise<ApiInvoiceHeader> => {
  const { data } = await api.post('/api/v1/invoice-headers', input);
  if (data?.ok === false || data?.success === false) {
    const msg: string = data?.error?.messageKey ?? data?.error?.code ?? 'Failed to create invoice';
    throw new Error(msg);
  }
  return data?.data ?? data;
};

export interface CreatePOInvoiceHeaderInput {
  locationId?: number | string;
  vendorId?: number | string;
  poId?: string;
  note?: string;
  issuedAt?: string;
  dueAt?: string;
  totalCents?: number;
}

export const createPOInvoiceHeaderApi = async (
  input: CreatePOInvoiceHeaderInput,
): Promise<ApiInvoiceHeader> => {
  const { data } = await api.post('/api/v1/invoice-headers', input);
  if (data?.ok === false || data?.success === false) {
    const msg: string = data?.error?.messageKey ?? data?.error?.code ?? 'Failed to create invoice header';
    throw new Error(msg);
  }
  return data?.data ?? data;
};

export interface CreateInvoiceDetailInput {
  productId?: string;
  productSku?: string;
  productNameEn?: string;
  productNameKm?: string;
  qty: number;
  unitPriceCents: number;
  discountCents?: number;
}

export const createInvoiceDetailApi = async (
  headerId: string,
  input: CreateInvoiceDetailInput,
): Promise<ApiInvoiceDetail> => {
  const { data } = await api.post(`/api/v1/invoice-details/${headerId}`, input);
  if (data?.ok === false || data?.success === false) {
    const msg: string = data?.error?.messageKey ?? data?.error?.code ?? 'Failed to create invoice detail';
    throw new Error(msg);
  }
  return data?.data ?? data;
};

export const updateInvoiceHeaderStatusApi = async (
  id: string,
  status: 'DRAFT' | 'ISSUED' | 'PAID' | 'CANCELLED',
): Promise<void> => {
  const { data } = await api.patch(`/api/v1/invoice-headers/${id}/status`, { status });
  if (data?.ok === false || data?.success === false) {
    throw new Error(data?.error?.messageKey ?? data?.error?.code ?? 'Failed to update invoice status');
  }
};

// ─── Product Locations ────────────────────────────────────────────────────────

export interface ApiProductLocation {
  id: string;
  locationId: number;
  locationCode: string;
  locationNameEn: string;
  storeBin?: string;
}

export interface ProductLocationAddInput {
  locationId: number;
  storeBin?: string;
}

export interface ProductLocationUpdateInput {
  storeBin?: string;
}

const normalizeProductLocation = (raw: any): ApiProductLocation => ({
  id: String(raw.id ?? raw.product_location_id ?? ''),
  locationId: Number(raw.locationId ?? raw.location_id ?? raw.location?.id ?? 0),
  locationCode: raw.locationCode ?? raw.location_code ?? raw.location?.code ?? '',
  locationNameEn: raw.locationNameEn ?? raw.location_name_en ?? raw.location?.nameEn ?? raw.location?.name_en ?? '',
  storeBin: raw.storeBin ?? raw.store_bin ?? raw.bin ?? undefined,
});

export const getProductLocationsApi = async (productId: string): Promise<ApiProductLocation[]> => {
  const { data } = await api.get(`/api/v1/products/${productId}/locations`);
  if (data?.ok === false || data?.success === false) {
    const msg: string = data?.error?.messageKey ?? data?.error?.code ?? 'Failed to load product locations';
    throw new Error(msg);
  }
  const items = data?.data?.items ?? data?.data ?? extractArray(data);
  return Array.isArray(items) ? items.map(normalizeProductLocation) : [];
};

export const addProductLocationApi = async (
  productId: string,
  input: ProductLocationAddInput,
): Promise<ApiProductLocation> => {
  const body: Record<string, any> = {
    location_id: input.locationId,
    locationId: input.locationId,
  };
  if (input.storeBin) {
    body.store_bin = input.storeBin;
    body.storeBin = input.storeBin;
  }
  const { data } = await api.post(`/api/v1/products/${productId}/locations`, body);
  if (data?.ok === false || data?.success === false) {
    const msg: string =
      data?.error?.messageKey ?? data?.error?.code ?? data?.error?.message ??
      data?.message ?? 'Failed to add product location';
    throw new Error(msg);
  }
  return normalizeProductLocation(data?.data ?? data);
};

export const updateProductLocationApi = async (
  productId: string,
  plId: string,
  input: ProductLocationUpdateInput,
): Promise<ApiProductLocation> => {
  const body: Record<string, any> = {};
  if (input.storeBin !== undefined) {
    body.store_bin = input.storeBin;
    body.storeBin = input.storeBin;
  }
  const { data } = await api.patch(`/api/v1/products/${productId}/locations/${plId}`, body);
  if (data?.ok === false || data?.success === false) {
    const msg: string =
      data?.error?.messageKey ?? data?.error?.code ?? data?.error?.message ??
      data?.message ?? 'Failed to update product location';
    throw new Error(msg);
  }
  return normalizeProductLocation(data?.data ?? data);
};

export const removeProductLocationApi = async (productId: string, plId: string): Promise<void> => {
  const { data } = await api.delete(`/api/v1/products/${productId}/locations/${plId}`);
  if (data?.ok === false || data?.success === false) {
    const msg: string = data?.error?.messageKey ?? data?.error?.code ?? 'Failed to remove product location';
    throw new Error(msg);
  }
};

// ─── Upload Product Image ──────────────────────────────────────────────────────

export const uploadProductImageApi = async (
  id: string,
  asset: { uri?: string; type?: string; fileName?: string },
): Promise<ApiProduct> => {
  const formData = new FormData();
  formData.append('file', {
    uri: asset.uri,
    type: asset.type ?? 'image/jpeg',
    name: asset.fileName ?? 'photo.jpg',
  } as any);

  const { data } = await api.post(`/api/v1/products/${id}/upload-image`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });

  if (data?.ok === false) {
    const msg: string = data?.error?.messageKey ?? data?.error?.code ?? 'Failed to upload image';
    throw new Error(msg);
  }
  return data?.data ?? data;
};

// ─── Vendors ──────────────────────────────────────────────────────────────────

export interface ApiVendor {
  id: number;
  code: string;
  nameEn?: string;
  nameKm?: string;
  address?: string;
  phone?: string;
  contactEmail?: string;
  active?: boolean;
  orgId?: string;
  // Bank account (camelCase from normalizer; API accepts snake_case on write)
  bankName?: string;
  bankAccount?: string;
  bank_name?: string;
  bank_account?: string;
  // Payment
  paymentTerm?: number;
  // VAT
  vat?: boolean;
  vatinNumber?: string;
  createdAt?: string;
  updatedAt?: string;
}

const normalizeVendor = (v: any): ApiVendor => ({
  ...v,
  phone:       v.phone       ?? v.phoneNumber  ?? v.phone_number ?? undefined,
  address:     v.address     ?? v.addressLine  ?? v.address_line ?? undefined,
  bankName:    v.bankName    ?? v.bank_name    ?? undefined,
  bankAccount: v.bankAccount ?? v.bank_account ?? undefined,
  paymentTerm: v.paymentTerm ?? v.payment_term ?? undefined,
  vat:         v.vat         ?? false,
  vatinNumber: v.vatinNumber ?? v.vatin_number ?? undefined,
});

export const getVendorsApi = async (): Promise<ApiVendor[]> => {
  const { data } = await api.get('/api/v1/vendors');
  if (data?.ok === false) throw new Error(data?.error?.messageKey ?? 'Failed to load vendors');
  const items = data?.data?.items ?? data?.data ?? extractArray(data);
  return Array.isArray(items) ? items.map(normalizeVendor) : [];
};

export const getVendorApi = async (id: number): Promise<ApiVendor> => {
  const { data } = await api.get(`/api/v1/vendors/${id}`);
  if (data?.ok === false) throw new Error(data?.error?.messageKey ?? 'Failed to load vendor');
  return normalizeVendor(data?.data ?? data);
};

const extractVendorError = (err: any, fallback: string): never => {
  const body = err?.response?.data;
  if (body) {
    const msg: string =
      body?.error?.messageKey ??
      body?.error?.code ??
      body?.message ??
      (Array.isArray(body?.errors) ? body.errors.map((e: any) => e?.message ?? e?.field ?? e).join(', ') : undefined) ??
      (typeof body === 'string' ? body : undefined) ??
      `${fallback} (${err?.response?.status})`;
    throw new Error(msg);
  }
  throw err;
};

export const createVendorApi = async (payload: Omit<ApiVendor, 'id' | 'createdAt' | 'updatedAt'>): Promise<ApiVendor> => {
  const orgId = Number(_orgId);
  if (!orgId) throw new Error('Organization ID not available — please log in again.');
  try {
    const { data } = await api.post('/api/v1/vendors', { ...payload, orgId });
    if (data?.ok === false) throw new Error(data?.error?.messageKey ?? data?.error?.code ?? 'Failed to create vendor');
    return data?.data ?? data;
  } catch (err: any) {
    if (err?.response) extractVendorError(err, 'Failed to create vendor');
    throw err;
  }
};

export const updateVendorApi = async (id: number, payload: Partial<Omit<ApiVendor, 'id' | 'createdAt' | 'updatedAt'>>): Promise<ApiVendor> => {
  try {
    const { data } = await api.patch(`/api/v1/vendors/${id}`, payload);
    if (data?.ok === false) throw new Error(data?.error?.messageKey ?? data?.error?.code ?? 'Failed to update vendor');
    return data?.data ?? data;
  } catch (err: any) {
    if (err?.response) extractVendorError(err, 'Failed to update vendor');
    throw err;
  }
};

export const deleteVendorApi = async (id: number): Promise<void> => {
  const { data } = await api.delete(`/api/v1/vendors/${id}`);
  if (data?.ok === false) throw new Error(data?.error?.messageKey ?? data?.error?.code ?? 'Failed to delete vendor');
};

// ─── UOM (Units of Measure) ───────────────────────────────────────────────────

export interface ApiUom {
  id: number;
  code: string;
  nameEn?: string;
  nameKm?: string;
  factor?: number;
  active?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export const getUomsApi = async (): Promise<ApiUom[]> => {
  const { data } = await api.get('/api/v1/uoms');
  if (data?.ok === false) throw new Error(data?.error?.messageKey ?? 'Failed to load UOMs');
  const items = data?.data?.items ?? data?.data ?? extractArray(data);
  return Array.isArray(items) ? items : [];
};

export const getUomApi = async (id: number): Promise<ApiUom> => {
  const { data } = await api.get(`/api/v1/uoms/${id}`);
  if (data?.ok === false) throw new Error(data?.error?.messageKey ?? 'Failed to load UOM');
  return data?.data ?? data;
};

export const createUomApi = async (payload: Omit<ApiUom, 'id' | 'createdAt' | 'updatedAt'>): Promise<ApiUom> => {
  const { data } = await api.post('/api/v1/uoms', payload);
  if (data?.ok === false) throw new Error(data?.error?.messageKey ?? data?.error?.code ?? 'Failed to create UOM');
  return data?.data ?? data;
};

export const updateUomApi = async (id: number, payload: Partial<Omit<ApiUom, 'id' | 'createdAt' | 'updatedAt'>>): Promise<ApiUom> => {
  const { data } = await api.patch(`/api/v1/uoms/${id}`, payload);
  if (data?.ok === false) throw new Error(data?.error?.messageKey ?? data?.error?.code ?? 'Failed to update UOM');
  return data?.data ?? data;
};

export const deleteUomApi = async (id: number): Promise<void> => {
  const { data } = await api.delete(`/api/v1/uoms/${id}`);
  if (data?.ok === false) throw new Error(data?.error?.messageKey ?? data?.error?.code ?? 'Failed to delete UOM');
};

// ── Routes ────────────────────────────────────────────────────────────────────

export interface ApiRoute {
  id: number;
  code: string;
  nameEn?: string;
  nameKm?: string;
  description?: string;
  active?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export const getRoutesApi = async (): Promise<ApiRoute[]> => {
  const { data } = await api.get('/api/v1/routes');
  if (data?.ok === false) throw new Error(data?.error?.messageKey ?? 'Failed to load routes');
  const items = data?.data?.items ?? data?.data ?? extractArray(data);
  return Array.isArray(items) ? items : [];
};

export const createRouteApi = async (payload: Omit<ApiRoute, 'id' | 'createdAt' | 'updatedAt'>): Promise<ApiRoute> => {
  const { data } = await api.post('/api/v1/routes', payload);
  if (data?.ok === false) throw new Error(data?.error?.messageKey ?? data?.error?.code ?? 'Failed to create route');
  return data?.data ?? data;
};

export const updateRouteApi = async (id: number, payload: Partial<Omit<ApiRoute, 'id' | 'createdAt' | 'updatedAt'>>): Promise<ApiRoute> => {
  const { data } = await api.patch(`/api/v1/routes/${id}`, payload);
  if (data?.ok === false) throw new Error(data?.error?.messageKey ?? data?.error?.code ?? 'Failed to update route');
  return data?.data ?? data;
};

export const deleteRouteApi = async (id: number): Promise<void> => {
  const { data } = await api.delete(`/api/v1/routes/${id}`);
  if (data?.ok === false) throw new Error(data?.error?.messageKey ?? data?.error?.code ?? 'Failed to delete route');
};

// ─── Locations ────────────────────────────────────────────────────────────────

export interface ApiLocation {
  id: string | number;
  code: string;
  nameEn: string;
  nameKm: string;
  address?: string | null;
  active?: boolean;
  orgId?: string | null;
}

export interface LocationCreateInput {
  code: string;
  nameEn: string;
  nameKm: string;
  address?: string | null;
  active?: boolean;
}

export interface LocationUpdateInput {
  code?: string;
  nameEn?: string;
  nameKm?: string;
  address?: string | null;
  active?: boolean;
}

const normalizeLocation = (raw: any): ApiLocation => ({
  id: raw.id ?? raw.location_id ?? '',
  code: raw.code ?? '',
  nameEn: raw.nameEn ?? raw.name_en ?? raw.name ?? '',
  nameKm: raw.nameKm ?? raw.name_km ?? '',
  address: raw.address ?? null,
  active: raw.active ?? true,
  orgId: raw.orgId ?? raw.org_id ?? null,
});

export const getLocationsApi = async (): Promise<ApiLocation[]> => {
  const { data } = await api.get('/api/v1/locations');
  if (data?.ok === false || data?.success === false) {
    const msg: string = data?.error?.messageKey ?? data?.error?.code ?? 'Failed to load locations';
    throw new Error(msg);
  }
  const items = data?.data?.items ?? data?.data ?? extractArray(data);
  return Array.isArray(items) ? items.map(normalizeLocation) : [];
};

export const getLocationApi = async (id: string): Promise<ApiLocation> => {
  const { data } = await api.get(`/api/v1/locations/${id}`);
  if (data?.ok === false || data?.success === false) {
    const msg: string = data?.error?.messageKey ?? data?.error?.code ?? 'Failed to load location';
    throw new Error(msg);
  }
  return data?.data ?? data;
};

export const createLocationApi = async (input: LocationCreateInput): Promise<ApiLocation> => {
  const { data } = await api.post('/api/v1/locations', input);
  if (data?.ok === false || data?.success === false) {
    const msg: string = data?.error?.messageKey ?? data?.error?.code ?? 'Failed to create location';
    throw new Error(msg);
  }
  return data?.data ?? data;
};

export const updateLocationApi = async (id: string, input: LocationUpdateInput): Promise<ApiLocation> => {
  const { data } = await api.patch(`/api/v1/locations/${id}`, input);
  if (data?.ok === false || data?.success === false) {
    const msg: string = data?.error?.messageKey ?? data?.error?.code ?? 'Failed to update location';
    throw new Error(msg);
  }
  return data?.data ?? data;
};

export const deleteLocationApi = async (id: string): Promise<void> => {
  const { data } = await api.delete(`/api/v1/locations/${id}`);
  if (data?.ok === false || data?.success === false) {
    const msg: string = data?.error?.messageKey ?? data?.error?.code ?? 'Failed to delete location';
    throw new Error(msg);
  }
};

// ─── Purchase Orders ──────────────────────────────────────────────────────────

export type POStatus = 'DRAFT' | 'APPROVED' | 'SENT' | 'RECEIVED' | 'BILLED' | 'PAID' | 'CANCELLED';

export interface ApiPOItem {
  id: string;
  productId: string;
  productName?: string;
  productNameEn?: string;
  productNameKm?: string;
  productSku?: string;
  // Fields returned by getPurchaseOrderApi detail endpoint
  sku?: string;
  nameEn?: string;
  nameKm?: string;
  size?: string | null;
  qty: number;
  unitPrice?: number;
  unitPriceCents?: number;
  discountPercent?: number;
  discountPct?: number;
  discountAmount?: number;
  discountCents?: number;
  afterDiscount?: number;
  taxRatePct?: number;
  taxCents?: number;
  lineTotal?: number;
  totalCents?: number;
  qtyReceived?: number;
}

export interface ApiPurchaseOrder {
  id: string | number;
  poNumber: string;
  referenceNumber?: string;
  ref?: string;
  status: POStatus;
  vendorId?: number;
  vendorName?: string;
  vendor?: { id: number; code?: string; nameEn?: string; nameKm?: string };
  locationId?: number;
  location?: { id: number; code?: string; nameEn?: string };
  supplierOrgId?: string;
  supplierOrg?: { id: string; name?: string; nameEn?: string };
  items?: ApiPOItem[];
  totalCents?: number;
  note?: string | null;
  receiptNote?: string | null;
  imageCount?: number;
  createdAt: string;
  updatedAt?: string;
  approvedAt?: string;
  sentAt?: string;
  receivedAt?: string;
  billNo?: string;
  billIssuedAt?: string;
  billDueAt?: string;
  billTotalCents?: number;
  paidAt?: string;
  paidAmountCents?: number;
  paymentMethod?: string;
  cancelReason?: string;
  created_at?: string;
}

export interface CreatePOInput {
  vendorId: number;
  locationId: number;
  created_at?: string;
  items: { productId: string | number; qty: number; unitPriceCents: number; discountCents?: number; discountPercent?: number; taxRatePct?: number }[];
}

export const getPurchaseOrdersApi = async (params?: {
  limit?: number;
  cursor?: number | null;
  status?: string;
  vendorId?: number | null;
  poNumber?: string;
  from?: string;
  to?: string;
  supplierOrgId?: number;
}): Promise<{ items: ApiPurchaseOrder[]; nextCursor: number | null; totalCount: number }> => {
  const limit = params?.limit ?? 20;
  const reqParams: Record<string, any> = { limit };
  if (params?.cursor != null) reqParams.cursor = params.cursor;
  if (params?.status) reqParams.status = params.status;
  if (params?.vendorId != null) reqParams.vendorId = params.vendorId;
  if (params?.poNumber?.trim()) reqParams.poNumber = params.poNumber.trim();
  if (params?.from) reqParams.from = params.from;
  if (params?.to) reqParams.to = params.to;
  if (params?.supplierOrgId != null) reqParams.supplierOrgId = params.supplierOrgId;
  const { data } = await api.get('/api/v1/purchase-orders', { params: reqParams });
  if (data?.ok === false) throw new Error(data?.error?.messageKey ?? 'Failed to load purchase orders');
  const items: any[] = data?.data?.items ?? data?.data ?? extractArray(data);
  if (!Array.isArray(items)) return { items: [], nextCursor: null, totalCount: 0 };
  return {
    items: items.map((po: any) => ({
      ...po,
      poNumber:    po.poNumber ?? po.referenceNumber ?? po.ref ?? po.poRef ?? po.po_number ?? po.id,
      receiptNote: po.receiptNote ?? po.receiveNote ?? po.receivedNote ?? po.receipt_note ?? po.receive_note ?? null,
      imageCount:  po.imageCount ?? po.image_count ?? 0,
    })),
    nextCursor: data?.data?.nextCursor ?? null,
    totalCount: data?.data?.totalCount ?? items.length,
  };
};

export const getPurchaseOrderApi = async (id: string | number): Promise<ApiPurchaseOrder> => {
  const { data } = await api.get(`/api/v1/purchase-orders/${id}`);
  if (data?.ok === false) throw new Error(data?.error?.messageKey ?? 'Failed to load purchase order');
  const po = data?.data ?? data;
  const rawItems: any[] = po.items ?? po.lineItems ?? po.poItems ?? po.orderItems ?? [];
  const items: ApiPOItem[] = rawItems.map((i: any) => {
    const unitPrice      = i.unitPrice != null ? Number(i.unitPrice) : (i.unitPriceCents != null ? Number(i.unitPriceCents) : 0);
    const discountAmount = i.discountAmount != null ? Number(i.discountAmount) : (i.discountCents != null ? Number(i.discountCents) : 0);
    const discountPct    = i.discountPercent ?? i.discountPct ?? 0;
    const afterDiscount  = i.afterDiscount != null
      ? Number(i.afterDiscount)
      : Number((unitPrice * (1 - discountPct / 100)).toFixed(4));
    const lineTotal      = i.lineTotal != null
      ? Number(i.lineTotal)
      : (i.lineCents != null ? Number(i.lineCents) / 100 : afterDiscount * i.qty);
    return {
      ...i,
      sku:            i.sku ?? i.productSku,
      nameEn:         i.nameEn ?? i.productNameEn ?? i.productName,
      nameKm:         i.nameKm ?? i.productNameKm,
      unitPrice,
      unitPriceCents:  unitPrice,
      discountAmount,
      discountCents:   discountAmount,
      discountPercent: discountPct,
      afterDiscount,
      lineTotal,
    };
  });
  return {
    ...po,
    items,
    poNumber:      po.poNumber ?? po.referenceNumber ?? po.ref ?? po.poRef ?? po.po_number ?? po.id,
    receiptNote:   po.receiptNote ?? po.receiveNote ?? po.receivedNote ?? po.receipt_note ?? po.receive_note ?? null,
    locationId:    po.locationId ?? po.location_id ?? po.deliveryLocationId ?? po.warehouseId ?? po.location?.id,
    vendorId:      po.vendorId ?? po.vendor_id ?? po.supplierId ?? po.vendor?.id,
    totalCents:    po.totalCents != null ? Number(po.totalCents) : undefined,
    billNo:        po.bill?.billNo ?? po.billNo ?? undefined,
    billTotalCents:po.bill?.totalCents != null ? Number(po.bill.totalCents) : (po.billTotalCents ?? undefined),
    billIssuedAt:  po.bill?.issuedAt ?? po.billIssuedAt ?? undefined,
  };
};

export const createPurchaseOrderApi = async (input: CreatePOInput): Promise<ApiPurchaseOrder> => {
  const body = {
    ...input,
    items: input.items.map(i => ({ ...i, productId: Number(i.productId) })),
  };
  const { data } = await api.post('/api/v1/purchase-orders', body);
  if (data?.ok === false) throw new Error(data?.error?.messageKey ?? data?.error?.code ?? 'Failed to create purchase order');
  return data?.data ?? data;
};

export const updatePurchaseOrderApi = async (id: string | number, input: Partial<CreatePOInput>): Promise<ApiPurchaseOrder> => {
  const body = input.items
    ? {
        ...input,
        items: input.items.map(i => {
          const hasDiscount = i.discountCents != null && Number(i.discountCents) > 0;
          const discountPercent = hasDiscount && i.unitPriceCents && i.qty
            ? Math.round((Number(i.discountCents) / (i.qty * Number(i.unitPriceCents))) * 100)
            : 0;
          return {
            productId: Number(i.productId),
            qty: i.qty,
            unitPriceCents: String(i.unitPriceCents),
            ...(hasDiscount ? { discountCents: Number(i.discountCents), discountPercent } : {}),
            ...(i.taxRatePct != null ? { taxRatePct: i.taxRatePct } : {}),
          };
        }),
      }
    : input;
  const { data } = await api.patch(`/api/v1/purchase-orders/${String(id)}`, body);
  if (data?.ok === false) throw new Error(data?.error?.messageKey ?? data?.error?.code ?? 'Failed to update purchase order');
  return data?.data ?? data;
};

export const approvePurchaseOrderApi = async (id: string): Promise<void> => {
  const { data } = await api.post(`/api/v1/purchase-orders/${id}/approve`);
  if (data?.ok === false) throw new Error(data?.error?.messageKey ?? 'Failed to approve PO');
};

export const sendPurchaseOrderApi = async (id: string): Promise<void> => {
  const { data } = await api.post(`/api/v1/purchase-orders/${id}/send`);
  if (data?.ok === false) throw new Error(data?.error?.messageKey ?? 'Failed to send PO');
};

export const receivePurchaseOrderApi = async (
  id: string,
  input: { items: { poItemId: string; qtyReceived: number }[]; note?: string; receivedAt?: string },
): Promise<void> => {
  const { data } = await api.post(`/api/v1/purchase-orders/${id}/receive`, input);
  if (data?.ok === false) throw new Error(data?.error?.messageKey ?? 'Failed to receive goods');
};

export const billPurchaseOrderApi = async (
  id: string | number,
  input: {
    poId:       number;
    totalCents: number;
    rateUsed:   number;
    issuedAt:   string;
    proofUrl?:  string;
  },
): Promise<void> => {
  // issuedAt must be full ISO datetime; billNo defaults to empty string (API requires string type)
  const issuedAtISO = input.issuedAt.length === 10
    ? `${input.issuedAt}T00:00:00.000Z`
    : input.issuedAt;
  const now = new Date();
  const yymm = `${String(now.getFullYear()).slice(2)}${String(now.getMonth() + 1).padStart(2, '0')}`;
  const seq  = String(Math.floor(Math.random() * 999999)).padStart(6, '0');
  const body: Record<string, unknown> = {
    poId:       input.poId,
    billNo:     `PVC-${yymm}-${seq}`,
    totalCents: input.totalCents,
    rateUsed:   input.rateUsed,
    issuedAt:   issuedAtISO,
  };
  if (input.proofUrl != null) body.proofUrl = input.proofUrl;
  try {
    const { data } = await api.post(`/api/v1/purchase-orders/${id}/bill`, body);
    if (data?.ok === false) throw new Error(data?.error?.messageKey ?? 'Failed to record bill');
  } catch (err: any) {
    const resp = err?.response;
    const body = resp?.data;
    if (body) {
      const msg = body?.error?.messageKey ?? body?.error?.code ?? body?.message ?? `Failed to record bill (${resp?.status})`;
      throw new Error(msg);
    }
    throw err;
  }
};

export const payPurchaseOrderApi = async (
  id: string | number,
  input: { amountCents: number; paidAt: string; method: string; proofUrl?: string | null; note?: string },
): Promise<void> => {
  const paidAtISO = input.paidAt.length === 10 ? `${input.paidAt}T00:00:00.000Z` : input.paidAt;
  const body = {
    amountCents: input.amountCents,
    paidAt:      paidAtISO,
    method:      input.method,
    proofUrl:    input.proofUrl ?? null,
    note:        input.note ?? undefined,
  };
  try {
    const { data } = await api.post(`/api/v1/purchase-orders/${id}/pay`, body);
    if (data?.success === false || data?.ok === false) {
      throw new Error(data?.error?.messageKey ?? data?.error?.code ?? data?.message ?? 'Failed to record payment');
    }
  } catch (err: any) {
    const resp = err?.response;
    const body2 = resp?.data;
    if (body2) throw new Error(body2?.error?.messageKey ?? body2?.error?.code ?? body2?.message ?? `Payment failed (${resp?.status})`);
    throw err;
  }
};

export const cancelPurchaseOrderApi = async (id: string, reason?: string): Promise<void> => {
  const { data } = await api.post(`/api/v1/purchase-orders/${id}/cancel`, { reason });
  if (data?.ok === false) throw new Error(data?.error?.messageKey ?? 'Failed to cancel PO');
};

// ─── Vendor Payables ──────────────────────────────────────────────────────────

export interface ApiVendorPayablePayment {
  id: string | number;
  billId?: string | number;
  amountCents: number;
  rateUsed?: number;
  paidAt: string;
  method?: string;
  note?: string;
  createdAt?: string;
}

export interface ApiVendorPayable {
  id: string | number;
  poId?: number;
  poNumber?: string;
  poReference?: string;
  receiptNote?: string | null;
  billNo: string;
  totalCents: number;
  rateUsed?: number;
  issuedAt: string;
  dueAt?: string;
  paidCents?: number;
  paidAmountCents?: number;
  balanceCents?: number;
  status: 'UNPAID' | 'PARTIAL' | 'PAID';
  vendorId?: number;
  vendorName?: string;
  vendor?: { id: number; nameEn?: string; nameKm?: string; code?: string };
  payments?: ApiVendorPayablePayment[];
  createdAt?: string;
  updatedAt?: string;
}

export interface ApiVendorBalance {
  vendorId: number;
  vendorName?: string;
  vendor?: { id: number; nameEn?: string; nameKm?: string; code?: string };
  totalBilledCents: number;
  totalPaidCents: number;
  totalBalanceCents: number;
  billCount?: number;
  bills?: ApiVendorPayable[];
}

const normalizeVendorPayable = (v: any): ApiVendorPayable => ({
  id:             v.id,
  poId:           v.poId ?? v.po_id,
  poNumber:       v.poNumber ?? v.po_number ?? v.po?.poNumber ?? v.po?.po_number,
  poReference:    v.poReference ?? v.po_reference ?? v.referenceNumber ?? v.reference_number ?? v.po?.poReference ?? v.po?.reference_number,
  receiptNote:    v.receiptNote ?? v.receipt_note ?? v.po?.receiptNote ?? v.po?.receipt_note ?? null,
  billNo:         v.billNo ?? v.bill_no ?? '',
  totalCents:     Number(v.totalCents ?? v.total_cents ?? 0),
  rateUsed:       v.rateUsed ?? v.rate_used,
  issuedAt:       v.issuedAt ?? v.issued_at ?? '',
  dueAt:          v.dueAt ?? v.due_at,
  paidCents:      Number(v.paidCents ?? v.paid_cents ?? v.paidAmountCents ?? v.paid_amount_cents ?? 0),
  paidAmountCents:Number(v.paidAmountCents ?? v.paid_amount_cents ?? v.paidCents ?? v.paid_cents ?? 0),
  balanceCents:   v.balanceCents != null ? Number(v.balanceCents) :
                  v.balance_cents != null ? Number(v.balance_cents) :
                  Number(v.totalCents ?? v.total_cents ?? 0) - Number(v.paidCents ?? v.paid_cents ?? v.paidAmountCents ?? 0),
  status:         v.status ?? 'UNPAID',
  vendorId:       v.vendorId ?? v.vendor_id ?? v.po?.vendorId ?? v.po?.vendor_id,
  vendorName:     v.vendorName ?? v.vendor_name ?? v.vendor?.nameEn ?? v.po?.vendorName,
  vendor:         v.vendor ?? v.po?.vendor,
  payments:       Array.isArray(v.payments) ? v.payments : undefined,
  createdAt:      v.createdAt ?? v.created_at,
  updatedAt:      v.updatedAt ?? v.updated_at,
});

export const getVendorPayablesApi = async (params?: {
  pvcNumber?: string;
  vendorId?: number;
  from?: string;
  to?: string;
  cursor?: number;
  limit?: number;
  routeId?: number;
}): Promise<{ items: ApiVendorPayable[]; nextCursor: number | null; totalCount: number }> => {
  const p: Record<string, string> = {};
  if (params?.pvcNumber) p.pvcNumber = params.pvcNumber;
  if (params?.vendorId != null) p.vendorId = String(params.vendorId);
  if (params?.from) p.from = params.from;
  if (params?.to) p.to = params.to;
  if (params?.cursor != null) p.cursor = String(params.cursor);
  if (params?.limit != null) p.limit = String(params.limit);
  if (params?.routeId != null) p.routeId = String(params.routeId);
  const { data } = await api.get('/api/v1/vendor-payables', { params: p });
  if (data?.ok === false) throw new Error(data?.error?.messageKey ?? 'Failed to load vendor payables');
  const items = data?.data?.items ?? data?.data ?? extractArray(data);
  return {
    items: Array.isArray(items) ? items.map(normalizeVendorPayable) : [],
    nextCursor: data?.data?.nextCursor ?? null,
    totalCount: data?.data?.totalCount ?? 0,
  };
};

export const getVendorPayableApi = async (id: string | number): Promise<ApiVendorPayable> => {
  const { data } = await api.get(`/api/v1/vendor-payables/${id}`);
  if (data?.ok === false) throw new Error(data?.error?.messageKey ?? 'Failed to load vendor payable');
  return normalizeVendorPayable(data?.data ?? data);
};

export const createVendorPayableApi = async (input: {
  poId: number;
  billNo: string;
  totalCents: number;
  rateUsed?: number;
  issuedAt: string;
  dueAt?: string;
}): Promise<ApiVendorPayable> => {
  try {
    const { data } = await api.post('/api/v1/vendor-payables', input);
    if (data?.ok === false) throw new Error(data?.error?.messageKey ?? data?.error?.code ?? 'Failed to create bill');
    return normalizeVendorPayable(data?.data ?? data);
  } catch (err: any) {
    const body = err?.response?.data;
    if (body) {
      const msg = body?.error?.messageKey ?? body?.error?.code ?? body?.message ?? `Failed to create bill (${err?.response?.status})`;
      throw new Error(msg);
    }
    throw err;
  }
};

export interface ApiPaymentResult {
  paymentId: number;
  billId: number;
  billStatus: string;
  amountCents: number;
  totalPaidCents: number;
  balanceCents: number;
  paidAt: string;
  method: string;
}

export const payVendorPayableApi = async (
  id: string | number,
  input: {
    amountCents: number;
    rateUsed: number;
    paidAt: string;
    method: string;
    note?: string;
    proofUrl?: string | null;
  },
): Promise<ApiPaymentResult> => {
  const paidAt = input.paidAt.length > 10 ? input.paidAt.slice(0, 10) : input.paidAt;
  const body: Record<string, unknown> = {
    amountCents: input.amountCents,
    rateUsed:    input.rateUsed,
    paidAt,
    method:      input.method,
  };
  if (input.note)     body.note     = input.note;
  if (input.proofUrl) body.proofUrl = input.proofUrl;
  try {
    const { data } = await api.post(`/api/v1/vendor-payables/${id}/payments`, body);
    if (data?.ok === false) throw new Error(data?.error?.messageKey ?? data?.error?.code ?? 'Failed to record payment');
    const d = data?.data ?? data;
    return {
      paymentId:      Number(d.paymentId),
      billId:         Number(d.billId),
      billStatus:     d.billStatus ?? '',
      amountCents:    Number(d.amountCents),
      totalPaidCents: Number(d.totalPaidCents),
      balanceCents:   Number(d.balanceCents),
      paidAt:         d.paidAt ?? '',
      method:         d.method ?? '',
    };
  } catch (err: any) {
    const resp = err?.response;
    const errBody = resp?.data;
    if (errBody) {
      const raw = errBody?.error?.messageKey ?? errBody?.error?.code ?? errBody?.message;
      const msg = Array.isArray(raw) ? raw.join(', ') : (raw ?? `Payment failed (${resp?.status})`);
      throw new Error(`${msg} | body: ${JSON.stringify(errBody)}`);
    }
    throw err;
  }
};

export const getVendorBalanceApi = async (vendorId: number): Promise<ApiVendorBalance> => {
  const { data } = await api.get(`/api/v1/vendor-payables/vendor/${vendorId}`);
  if (data?.ok === false) throw new Error(data?.error?.messageKey ?? 'Failed to load vendor balance');
  const d = data?.data ?? data;
  return {
    vendorId:          d.vendorId ?? d.vendor_id ?? vendorId,
    vendorName:        d.vendorName ?? d.vendor_name ?? d.vendor?.nameEn,
    vendor:            d.vendor,
    totalBilledCents:  Number(d.totalBilledCents ?? d.total_billed_cents ?? 0),
    totalPaidCents:    Number(d.totalPaidCents ?? d.total_paid_cents ?? 0),
    totalBalanceCents: Number(d.totalBalanceCents ?? d.total_balance_cents ?? 0),
    billCount:         d.billCount ?? d.bill_count,
    bills:             Array.isArray(d.bills) ? d.bills.map(normalizeVendorPayable) : undefined,
  };
};

// ─── Cashier Sessions ─────────────────────────────────────────────────────────

export interface ApiCashierTransaction {
  id: string | number;
  sessionId?: string | number;
  type: 'CASH_IN' | 'CASH_OUT' | 'SALE' | 'REFUND';
  amountCents: number;
  reference?: string;
  note?: string;
  createdAt?: string;
}

export interface ApiCashierSession {
  id: string | number;
  sessionNumber: string;
  status: 'OPEN' | 'CLOSED';
  openingFloatCents: number;
  rateUsed?: number;
  closingCashCents?: number;
  expectedCashCents?: number;
  differenceCents?: number;
  totalSalesCents?: number;
  totalCashInCents?: number;
  totalCashOutCents?: number;
  note?: string;
  openedAt?: string;
  closedAt?: string;
  createdAt?: string;
  transactions?: ApiCashierTransaction[];
}

export interface ApiSessionCloseResult {
  sessionId?: string | number;
  closingCashCents: number;
  expectedCashCents: number;
  differenceCents: number;
  denominations?: Array<{ denomination: number; count: number; subtotalCents: number | string }>;
}

const normalizeCashierSession = (s: any): ApiCashierSession => ({
  id:                 s.id,
  sessionNumber:      s.sessionNumber ?? s.session_number ?? s.ref ?? String(s.id),
  status:             s.status ?? 'OPEN',
  openingFloatCents:  Number(s.openingFloatCents ?? s.opening_float_cents ?? 0),
  rateUsed:           s.rateUsed ?? s.rate_used,
  closingCashCents:   s.closingCashCents != null ? Number(s.closingCashCents) : s.closing_cash_cents != null ? Number(s.closing_cash_cents) : undefined,
  expectedCashCents:  s.expectedCashCents != null ? Number(s.expectedCashCents) : s.expected_cash_cents != null ? Number(s.expected_cash_cents) : undefined,
  differenceCents:    s.differenceCents != null ? Number(s.differenceCents) : s.difference_cents != null ? Number(s.difference_cents) : undefined,
  totalSalesCents:    s.totalSalesCents != null ? Number(s.totalSalesCents) : s.total_sales_cents != null ? Number(s.total_sales_cents) : undefined,
  totalCashInCents:   s.totalCashInCents != null ? Number(s.totalCashInCents) : s.total_cash_in_cents != null ? Number(s.total_cash_in_cents) : undefined,
  totalCashOutCents:  s.totalCashOutCents != null ? Number(s.totalCashOutCents) : s.total_cash_out_cents != null ? Number(s.total_cash_out_cents) : undefined,
  note:               s.note,
  openedAt:           s.openedAt ?? s.opened_at ?? s.createdAt ?? s.created_at,
  closedAt:           s.closedAt ?? s.closed_at,
  createdAt:          s.createdAt ?? s.created_at,
  transactions:       Array.isArray(s.transactions) ? s.transactions : undefined,
});

export const getOpenCashierSessionApi = async (): Promise<ApiCashierSession | null> => {
  try {
    const { data } = await api.get('/api/v1/cashier/sessions/open');
    if (data?.ok === false) {
      // API explicitly says no open session — try list as fallback
      return _findOpenInList();
    }
    // Handle: { data: session }, { data: [session] }, or bare session object
    let d = data?.data ?? data;
    if (Array.isArray(d)) d = d[0];
    if (!d) return _findOpenInList();
    if (!d.id && !d.sessionNumber && !d.session_number) return _findOpenInList();
    return normalizeCashierSession(d);
  } catch (err: any) {
    if (err?.response?.status === 404) return _findOpenInList();
    return _findOpenInList();
  }
};

// Internal: scan the sessions list for an OPEN entry
const _findOpenInList = async (): Promise<ApiCashierSession | null> => {
  try {
    const { data } = await api.get('/api/v1/cashier/sessions');
    const raw = data?.data?.items ?? data?.data ?? (Array.isArray(data) ? data : []);
    const items: any[] = Array.isArray(raw) ? raw : [];
    const open = items.find((s: any) => (s.status ?? '').toUpperCase() === 'OPEN');
    return open ? normalizeCashierSession(open) : null;
  } catch (_) {
    return null;
  }
};

const findExistingOpenSession = async (): Promise<ApiCashierSession | null> =>
  getOpenCashierSessionApi();

export const openCashierSessionApi = async (input: {
  openingFloatCents: number;
  rateUsed?: number;
  note?: string;
}): Promise<ApiCashierSession> => {
  try {
    const { data } = await api.post('/api/v1/cashier/sessions/open', input);
    if (data?.ok === false) throw new Error(data?.error?.messageKey ?? data?.error?.code ?? 'Failed to open session');
    return normalizeCashierSession(data?.data ?? data);
  } catch (err: any) {
    const body = err?.response?.data;
    const errKey: string = body?.error?.messageKey ?? body?.error?.code ?? body?.message ?? '';
    // Session already open — find and return the existing session
    if (errKey.toLowerCase().includes('already_open') || errKey.toLowerCase().includes('session_already')) {
      const existing = await findExistingOpenSession();
      if (existing) return existing;
      // Could not fetch it — surface a clear message
      throw new Error('A shift is already open but could not be loaded. Please restart the app.');
    }
    if (body) throw new Error(errKey || `Failed to open session (${err?.response?.status})`);
    throw err;
  }
};

export const addCashierTransactionApi = async (
  sessionId: string | number,
  input: { type: 'CASH_IN' | 'CASH_OUT' | 'SALE' | 'REFUND'; amountCents: number; reference?: string; note?: string },
): Promise<void> => {
  try {
    const { data } = await api.post(`/api/v1/cashier/sessions/${sessionId}/transaction`, input);
    if (data?.ok === false) throw new Error(data?.error?.messageKey ?? 'Failed to add transaction');
  } catch (err: any) {
    const body = err?.response?.data;
    if (body) throw new Error(body?.error?.messageKey ?? body?.message ?? 'Failed to add transaction');
    throw err;
  }
};

export const closeCashierSessionApi = async (
  sessionId: string | number,
  input: {
    denominations: Array<{ denomination: number; count: number }>;
    note?: string;
  },
): Promise<ApiSessionCloseResult> => {
  try {
    const { data } = await api.post(`/api/v1/cashier/sessions/${sessionId}/close`, input);
    if (data?.ok === false) throw new Error(data?.error?.messageKey ?? 'Failed to close session');
    const d = data?.data ?? data;
    return {
      sessionId:        d.sessionId ?? d.session_id,
      closingCashCents: Number(d.closingCashCents ?? d.closing_cash_cents ?? 0),
      expectedCashCents:Number(d.expectedCashCents ?? d.expected_cash_cents ?? 0),
      differenceCents:  Number(d.differenceCents ?? d.difference_cents ?? 0),
      denominations:    Array.isArray(d.denominations) ? d.denominations : undefined,
    };
  } catch (err: any) {
    const body = err?.response?.data;
    if (body) throw new Error(body?.error?.messageKey ?? body?.message ?? 'Failed to close session');
    throw err;
  }
};

export const getCashierSessionsApi = async (): Promise<ApiCashierSession[]> => {
  const { data } = await api.get('/api/v1/cashier/sessions');
  if (data?.ok === false) throw new Error(data?.error?.messageKey ?? 'Failed to load sessions');
  const items = data?.data?.items ?? data?.data ?? extractArray(data);
  return Array.isArray(items) ? items.map(normalizeCashierSession) : [];
};

// ─── Quotations ───────────────────────────────────────────────────────────────

export interface ApiQuotation {
  id: string;
  quotationNumber?: string;
  quotation_number?: string;
  ref?: string;
  referenceNumber?: string;
  campusId?: string | number | null;
  customerOrgId?: string;
  status: string;
  items: ApiSalesOrderItem[];
  totalCents?: number;
  note?: string | null;
  createdAt: string;
  updatedAt?: string;
}

export interface CreateQuotationInput {
  campusId?: number;
  customerOrgId: string | number;
  rateUsed?: number;
  note?: string;
  referenceNumber?: string;
  items: Array<{
    productId: string;
    qty: number;
    unitPriceCents: number;
    discountCents?: number;
  }>;
}

export const getQuotationsApi = async (): Promise<ApiQuotation[]> => {
  const { data } = await api.get('/api/v1/quotations');
  if (data?.ok === false || data?.success === false) {
    throw new Error(data?.error?.messageKey ?? data?.error?.code ?? 'Failed to load quotations');
  }
  const items = data?.data?.items ?? data?.data ?? extractArray(data);
  return Array.isArray(items) ? items : [];
};

export const getQuotationApi = async (id: string): Promise<ApiQuotation> => {
  const { data } = await api.get(`/api/v1/quotations/${id}`);
  if (data?.ok === false || data?.success === false) {
    throw new Error(data?.error?.messageKey ?? data?.error?.code ?? 'Failed to load quotation');
  }
  return data?.data ?? data;
};

export const createQuotationApi = async (input: CreateQuotationInput): Promise<ApiQuotation> => {
  const payload = {
    ...input,
    rateUsed: input.rateUsed ?? 4100,
    // omit discountCents when 0 — some APIs reject an explicit zero
    items: input.items.map(({ discountCents, ...rest }) =>
      discountCents ? { ...rest, discountCents } : rest,
    ),
  };
  try {
    const { data } = await api.post('/api/v1/quotations', payload);
    if (data?.ok === false || data?.success === false) {
      throw new Error(data?.error?.messageKey ?? data?.error?.code ?? data?.message ?? 'Failed to create quotation');
    }
    return data?.data ?? data;
  } catch (err: any) {
    const body = err?.response?.data;
    if (body) {
      const msg: string =
        body?.error?.messageKey ??
        body?.error?.code ??
        body?.message ??
        (Array.isArray(body?.errors) ? body.errors.map((e: any) => e?.message ?? e).join(', ') : undefined) ??
        (typeof body === 'string' ? body : undefined) ??
        `Failed to create quotation (${err?.response?.status})`;
      throw new Error(msg);
    }
    throw err;
  }
};

export const updateQuotationItemsApi = async (
  id: string,
  items: Array<{ productId: string; qty: number; unitPriceCents: number; discountCents?: number }>,
  note?: string,
): Promise<void> => {
  const payload: Record<string, unknown> = {
    items: items.map(({ discountCents, ...rest }) =>
      discountCents ? { ...rest, discountCents } : rest,
    ),
  };
  if (note !== undefined) payload.note = note;
  try {
    const { data } = await api.patch(`/api/v1/quotations/${id}`, payload);
    if (data?.ok === false || data?.success === false) {
      throw new Error(data?.error?.messageKey ?? data?.error?.code ?? 'Failed to update quotation items');
    }
  } catch (err: any) {
    const body = err?.response?.data;
    if (body) {
      const msg: string =
        body?.error?.messageKey ??
        body?.error?.code ??
        body?.message ??
        (Array.isArray(body?.errors) ? body.errors.map((e: any) => e?.message ?? e).join(', ') : undefined) ??
        (typeof body === 'string' ? body : undefined) ??
        `Failed to update quotation (${err?.response?.status})`;
      throw new Error(msg);
    }
    throw err;
  }
};

export const updateQuotationStatusApi = async (id: string, status: string): Promise<void> => {
  try {
    const { data } = await api.patch(`/api/v1/quotations/${id}/status`, { status });
    if (data?.ok === false || data?.success === false) {
      throw new Error(data?.error?.messageKey ?? data?.error?.code ?? data?.message ?? 'Failed to update quotation status');
    }
  } catch (err: any) {
    const body = err?.response?.data;
    if (body) {
      const msg: string =
        body?.error?.messageKey ??
        body?.error?.code ??
        body?.message ??
        (Array.isArray(body?.errors) ? body.errors.map((e: any) => e?.message ?? e).join(', ') : undefined) ??
        (typeof body === 'string' ? body : undefined) ??
        `Failed to update status (${err?.response?.status})`;
      throw new Error(msg);
    }
    throw err;
  }
};

export const deleteQuotationApi = async (id: string): Promise<void> => {
  const { data } = await api.delete(`/api/v1/quotations/${id}`);
  if (data?.ok === false || data?.success === false) {
    throw new Error(data?.error?.messageKey ?? data?.error?.code ?? 'Failed to delete quotation');
  }
};

export const convertQuotationsToSOApi = async (quotationIds: string[]): Promise<ApiSalesOrder> => {
  const { data } = await api.post('/api/v1/quotations/convert-to-so', { quotationIds });
  if (data?.ok === false || data?.success === false) {
    throw new Error(data?.error?.messageKey ?? data?.error?.code ?? 'Failed to convert quotations to sale order');
  }
  return data?.data ?? data;
};

// ─── Invoice Summaries ────────────────────────────────────────────────────────

export interface ApiInvoiceSummaryItem {
  id:            string | number;
  invoiceNumber: string;
  totalCents:    number | string;
  rateUsed?:     number;
  status:        string;
  periodMonth?:  string | null;
  note?:         string | null;
  issuedAt?:     string;
  dueAt?:        string;
}

export interface ApiInvoiceSummary {
  id:            string;
  summaryNumber: string;
  description?:  string;
  receivedNote?: string | null;
  totalCents:    number | string;
  rateUsed?:     number;
  createdAt:     string;
  invoices?:     ApiInvoiceSummaryItem[];
}

export interface CreateInvoiceSummaryInput {
  description?:  string;
  invoiceIds:    string[];
  rateUsed:      number;
  summaryDate?:  string;
}

export const getInvoiceSummariesApi = async (): Promise<ApiInvoiceSummary[]> => {
  const { data } = await api.get('/api/v1/invoice-summaries');
  if (data?.ok === false || data?.success === false) {
    throw new Error(data?.error?.messageKey ?? data?.error?.code ?? 'Failed to load summaries');
  }
  const items = data?.data?.items ?? data?.data ?? extractArray(data);
  return Array.isArray(items) ? items : [];
};

export const getInvoiceSummaryApi = async (id: string): Promise<ApiInvoiceSummary> => {
  const { data } = await api.get(`/api/v1/invoice-summaries/${id}`);
  if (data?.ok === false || data?.success === false) {
    throw new Error(data?.error?.messageKey ?? data?.error?.code ?? 'Failed to load summary');
  }
  return data?.data ?? data;
};

export const createInvoiceSummaryApi = async (
  input: CreateInvoiceSummaryInput,
): Promise<ApiInvoiceSummary> => {
  const { data } = await api.post('/api/v1/invoice-summaries', input);
  if (data?.ok === false || data?.success === false) {
    throw new Error(data?.error?.messageKey ?? data?.error?.code ?? 'Failed to create summary');
  }
  return data?.data ?? data;
};

export const deleteInvoiceSummaryApi = async (id: string): Promise<void> => {
  const { data } = await api.delete(`/api/v1/invoice-summaries/${id}`);
  if (data?.ok === false || data?.success === false) {
    throw new Error(data?.error?.messageKey ?? data?.error?.code ?? 'Failed to delete summary');
  }
};

// ─── Rental Invoices ──────────────────────────────────────────────────────────

export interface ApiRentalContract {
  id: number;
  referenceNumber: string;
  campusId: number;
  campus?: { id: number; campusCode: string; nameEn: string } | null;
  status: string;
  assetBrand?: string | null;
  assetModel?: string | null;
}

export const getRentalContractsApi = async (): Promise<ApiRentalContract[]> => {
  const { data } = await api.get('/api/v1/rentals/contracts');
  return data?.data?.items ?? data?.data ?? extractArray(data);
};

export interface RentalMachineInput {
  contractRef: string;
  counterBwStart: number;
  counterBwEnd: number;
  amountCents?: number | null;
}

export interface RentalCampusInput {
  campusId?: number | null;
  campusCode: string;
  machines: RentalMachineInput[];
}

export interface CreateRentalInvoiceInput {
  periodMonth: string;        // "YYYY-MM-01"
  rateUsed?: number | null;
  startDate?: string | null;  // "YYYY-MM-DD"
  endDate?: string | null;    // "YYYY-MM-DD"
  dueAt?: string | null;
  note?: string | null;
  campuses: RentalCampusInput[];
}

export interface ApiRentalInvoiceDetail extends ApiInvoiceDetail {
  campusId?: number | null;
  campusCode?: string | null;
  campus?: { id?: number; campusCode?: string; nameEn?: string } | null;
  contractRef?: string | null;
  lineLabel?: string | null;
  counterBwStart?: number | null;
  counterBwEnd?: number | null;
  lineCents?: number | string;
}

export interface ApiRentalInvoiceHeader extends ApiInvoiceHeader {
  periodMonth?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  details?: ApiRentalInvoiceDetail[];
}

export const getRentalInvoiceHeadersApi = async (): Promise<ApiRentalInvoiceHeader[]> => {
  const { data } = await api.get('/api/v1/invoice-headers/rental');
  if (data?.ok === false || data?.success === false) {
    const msg: string = data?.error?.messageKey ?? data?.error?.code ?? 'Failed to load rental invoices';
    throw new Error(msg);
  }
  const items = data?.data?.items ?? data?.data ?? extractArray(data);
  return Array.isArray(items) ? items : [];
};

export const createRentalInvoiceApi = async (
  input: CreateRentalInvoiceInput,
): Promise<ApiRentalInvoiceHeader> => {
  const { data } = await api.post('/api/v1/invoice-headers/rental', input);
  if (data?.ok === false || data?.success === false) {
    const msg: string = data?.error?.messageKey ?? data?.error?.code ?? 'Failed to create rental invoice';
    throw new Error(msg);
  }
  return data?.data ?? data;
};

export interface ApiRentalUsageMachine {
  machineName?: string | null;
  startCount?: number | null;
  endCount?: number | null;
  campusCode?: string | null;
  campusNameEn?: string | null;
  unitPriceCents?: number | null;
}

export const getRentalUsageInvoiceApi = async (
  invoiceNumber: string,
): Promise<{ machines: ApiRentalUsageMachine[] }> => {
  const { data } = await api.get(`/api/v1/invoice-headers/rental/${encodeURIComponent(invoiceNumber)}`);
  if (data?.ok === false || data?.success === false) {
    const msg: string = data?.error?.messageKey ?? data?.error?.code ?? 'Failed to load rental usage';
    throw new Error(msg);
  }
  const payload = data?.data ?? data;
  return { machines: Array.isArray(payload?.machines) ? payload.machines : [] };
};

// ─── Rental Invoice Summaries ─────────────────────────────────────────────────
export interface ApiRentalInvoiceSummaryMachine {
  machineName?: string | null;
  startCount?: number | null;
  endCount?: number | null;
  campusCode?: string | null;
  campusNameEn?: string | null;
  unitPriceCents?: number | null;
}

export interface ApiRentalInvoiceSummaryLine {
  lineLabel?: string | null;
  campusCode?: string | null;
  campusNameEn?: string | null;
  counterBwStart?: number | null;
  counterBwEnd?: number | null;
}

export interface ApiRentalInvoiceSummaryInvoice {
  id: string;
  invoiceNumber?: string | null;
  periodMonth?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  totalCents?: number | string | null;
  lines?: ApiRentalInvoiceSummaryLine[];
  machines?: ApiRentalInvoiceSummaryMachine[];
}

export interface ApiRentalInvoiceSummaryItem {
  id: string;
  summaryNumber?: string | null;
  description?: string | null;
  invoiceCount?: number;
  totalCents?: number | string | null;
  createdAt: string;
  updatedAt?: string;
}

export interface ApiRentalInvoiceSummaryDetail extends ApiRentalInvoiceSummaryItem {
  invoices?: ApiRentalInvoiceSummaryInvoice[];
}

export const getRentalInvoiceSummariesApi = async (): Promise<ApiRentalInvoiceSummaryItem[]> => {
  const { data } = await api.get('/api/v1/rental-invoice-summaries');
  if (data?.ok === false || data?.success === false) {
    const msg: string = data?.error?.messageKey ?? data?.error?.code ?? 'Failed to load summaries';
    throw new Error(msg);
  }
  const items = data?.data?.items ?? data?.data ?? extractArray(data);
  return Array.isArray(items) ? items : [];
};

export const getRentalInvoiceSummaryDetailApi = async (
  id: string,
): Promise<ApiRentalInvoiceSummaryDetail> => {
  const { data } = await api.get(`/api/v1/rental-invoice-summaries/${encodeURIComponent(id)}`);
  if (data?.ok === false || data?.success === false) {
    const msg: string = data?.error?.messageKey ?? data?.error?.code ?? 'Failed to load summary detail';
    throw new Error(msg);
  }
  return data?.data ?? data;
};

export const createRentalInvoiceSummaryApi = async (input: {
  invoiceIds: string[];
  description?: string;
  rateUsed?: number;
}): Promise<ApiRentalInvoiceSummaryItem> => {
  const body: Record<string, unknown> = {
    invoiceIds: input.invoiceIds.map(Number),
    ...(input.description ? { description: input.description } : {}),
    ...(input.rateUsed != null ? { rateUsed: Number(input.rateUsed) } : {}),
  };
  try {
    const { data } = await api.post('/api/v1/rental-invoice-summaries', body);
    if (data?.ok === false || data?.success === false) {
      const msg: string = data?.error?.messageKey ?? data?.error?.code ?? 'Failed to create summary';
      throw new Error(msg);
    }
    return data?.data ?? data;
  } catch (err: any) {
    const body = err?.response?.data;
    const msg: string =
      body?.error?.message ??
      body?.error?.messageKey ??
      body?.error?.code ??
      body?.message ??
      (Array.isArray(body?.errors) ? body.errors.map((e: any) => e.message ?? e).join(', ') : null) ??
      err?.message ??
      'Failed to create summary';
    throw new Error(msg);
  }
};

export const updateRentalInvoiceSummaryApi = async (
  id: string,
  input: { description?: string; invoiceIds?: string[] },
): Promise<ApiRentalInvoiceSummaryItem> => {
  const { data } = await api.patch(`/api/v1/rental-invoice-summaries/${encodeURIComponent(id)}`, input);
  if (data?.ok === false || data?.success === false) {
    const msg: string = data?.error?.messageKey ?? data?.error?.code ?? 'Failed to update summary';
    throw new Error(msg);
  }
  return data?.data ?? data;
};

export const deleteRentalInvoiceSummaryApi = async (id: string): Promise<void> => {
  const { data } = await api.delete(`/api/v1/rental-invoice-summaries/${encodeURIComponent(id)}`);
  if (data?.ok === false || data?.success === false) {
    const msg: string = data?.error?.messageKey ?? data?.error?.code ?? 'Failed to delete summary';
    throw new Error(msg);
  }
};

// ─── Stock balance ────────────────────────────────────────────────────────────

export interface ApiStockBalance {
  productId: string;
  sku: string;
  nameEn: string;
  nameKm: string;
  qtyOnHand: number;
}

export interface ApiStockTypeTotal {
  productId: string;
  sku: string;
  nameEn?: string;
  nameKm?: string;
  totalQty: number;
}

const parseStockItems = (data: any): any[] => {
  const items = data?.data?.items ?? data?.data ?? [];
  return Array.isArray(items) ? items : [];
};

export const getStockBalanceApi = async (): Promise<ApiStockBalance[]> => {
  const { data } = await api.get('/api/v1/stock/balance');
  if (data?.ok === false || data?.success === false) {
    throw new Error(data?.error?.messageKey ?? data?.error?.code ?? 'Failed to load stock balance');
  }
  return parseStockItems(data);
};

export interface ApiProductOnhand {
  productId: string;
  sku: string;
  nameEn?: string;
  totalQty: number;       // total invoiced out
  totalReceived: number;  // total received from PO
  totalOnhand: number;    // totalReceived - totalQty (may be negative)
}

// ─── Stock Movement Item List ──────────────────────────────────────────────────

export interface ApiStockMovementItem {
  id: number;
  sku: string;
  nameEn?: string;
  nameKm?: string;
  imageUrl?: string | null;
  pricingMode?: string;
  fixedPriceCents?: string | number | null;
  active: boolean;
  vendorId?: number | null;
  locationId?: number | null;
  storeBin?: string | null;
  categoryId?: number | null;
  categoryNameEn?: string | null;
  categoryNameKm?: string | null;
  qtyStart: number;
  qtyReceived: number;
  qtyOnHand: number;
  totalReceived: number;
  totalOnHand: number;
  lastCostCents?: number | null;
}

export interface ApiStockReceivedItem {
  productId: number;
  sku: string;
  nameEn?: string;
  nameKm?: string;
  vendorId?: number | null;
  categoryId?: number | null;
  categoryNameEn?: string | null;
  categoryNameKm?: string | null;
  totalReceived: number;
  totalOnHand: number;
  lastCostCents?: number | null;
}

export const getStockReceivedBySkuApi = async (params?: {
  sku?: string;
  vendorId?: number | null;
  locationId?: number | null;
  from?: string;
  to?: string;
}): Promise<ApiStockReceivedItem[]> => {
  const query: Record<string, string> = {};
  if (params?.sku?.trim())   query.sku        = params.sku.trim();
  if (params?.vendorId)      query.vendorId   = String(params.vendorId);
  if (params?.locationId)    query.locationId = String(params.locationId);
  if (params?.from)          query.from       = params.from;
  if (params?.to)            query.to         = params.to;
  const { data } = await api.get('/api/v1/stock/received-by-sku', { params: query });
  if (data?.ok === false) throw new Error(data?.error?.messageKey ?? 'Failed to load received by SKU');
  const items: any[] = data?.data?.items ?? data?.data ?? [];
  return (Array.isArray(items) ? items : []).map((item: any) => ({
    productId:      Number(item.productId),
    sku:            item.sku ?? '',
    nameEn:         item.nameEn ?? undefined,
    nameKm:         item.nameKm ?? undefined,
    vendorId:       item.vendorId != null ? Number(item.vendorId) : null,
    categoryId:     item.categoryId != null ? Number(item.categoryId) : null,
    categoryNameEn: item.categoryNameEn ?? null,
    categoryNameKm: item.categoryNameKm ?? null,
    totalReceived:  Number(item.totalRCV ?? item.totalReceived ?? 0),
    totalOnHand:    Number(item.totalOnHand ?? 0),
    lastCostCents:  item.lastCostCents != null ? Number(item.lastCostCents) : null,
  }));
};

export const getStockItemListApi = async (params?: {
  from?: string;
  to?: string;
  activeOnly?: boolean;
  vendorId?: number | null;
  locationId?: number | null;
  sku?: string;
}): Promise<ApiStockMovementItem[]> => {
  const query: Record<string, string> = {};
  if (params?.from) query.from = params.from;
  if (params?.to) query.to = params.to;
  if (params?.activeOnly !== undefined) query.activeOnly = String(params.activeOnly);
  if (params?.vendorId) query.vendorId = String(params.vendorId);
  if (params?.locationId) query.locationId = String(params.locationId);
  if (params?.sku?.trim()) query.sku = params.sku.trim();
  const { data } = await api.get('/api/v1/stock/item-list', { params: query });
  if (data?.ok === false) throw new Error(data?.error?.messageKey ?? data?.error?.message ?? 'Failed to load stock items');
  const items: any[] = data?.data?.items ?? data?.data ?? [];
  return (Array.isArray(items) ? items : []).map((item: any) => ({
    id: Number(item.productId ?? item.id),
    sku: item.sku ?? '',
    nameEn: item.nameEn ?? undefined,
    nameKm: item.nameKm ?? undefined,
    imageUrl: item.imageUrl ?? null,
    pricingMode: item.pricingMode ?? 'FIXED',
    fixedPriceCents: item.fixedPriceCents ?? null,
    active: item.active !== false,
    vendorId: item.vendorId != null ? Number(item.vendorId) : null,
    locationId: item.locationId != null ? Number(item.locationId) : null,
    storeBin: item.storeBin ?? null,
    categoryId: item.categoryId != null ? Number(item.categoryId) : null,
    categoryNameEn: item.categoryNameEn ?? null,
    categoryNameKm: item.categoryNameKm ?? null,
    qtyStart:      Number(item.qtyStart ?? 0),
    qtyReceived:   Number(item.qtyReceived ?? 0),
    qtyOnHand:     Number(item.qtyOnHand ?? 0),
    totalReceived: Number(item.totalReceived ?? 0),
    totalOnHand:   Number(item.totalOnHand ?? 0),
    lastCostCents: item.lastCostCents != null ? Number(item.lastCostCents) : null,
  }));
};

export const getInvoiceDetailsTotalOnhandApi = async (): Promise<ApiProductOnhand[]> => {
  const { data } = await api.get('/api/v1/invoice-details/total-onhand');
  if (data?.ok === false || data?.success === false) {
    throw new Error(data?.error?.messageKey ?? data?.error?.code ?? 'Failed to load on-hand totals');
  }
  const items = data?.data?.items ?? data?.data ?? [];
  return (Array.isArray(items) ? items : []).map((item: any) => ({
    productId: String(item.productId ?? item.product_id ?? ''),
    sku: item.sku,
    nameEn: item.nameEn ?? item.name_en,
    totalQty: Number(item.totalQty ?? item.total_qty ?? 0),
    totalReceived: Number(item.totalReceived ?? item.total_received ?? 0),
    totalOnhand: Number(item.totalOnhand ?? item.total_onhand ?? 0),
  }));
};

// ── Income Statement ──────────────────────────────────────────────────────────

export interface ApiIncomeStatementLine {
  key: string;
  nameEn: string;
  amountCents: number;
}

export interface ApiIncomeStatement {
  from: string;
  to: string;
  revenue: {
    sales: number;
    rental: number;
    total: number;
  };
  cogs: number;
  grossProfit: number;
  operatingExpenses: {
    lines: ApiIncomeStatementLine[];
    total: number;
  };
  operatingIncome: number;
  otherIncomeExpenses: {
    interestIncome: number;
    interestExpense: number;
    net: number;
  };
  incomeBeforeTax: number;
  incomeTax: number;
  netProfit: number;
}

export const getIncomeStatementApi = async (from: string, to: string): Promise<ApiIncomeStatement> => {
  const { data } = await api.get('/api/v1/reports/income-statement', { params: { from, to } });
  if (data?.ok === false) throw new Error(data?.error?.messageKey ?? 'Failed to load income statement');
  const d = data?.data ?? data;
  const opEx = d?.operatingExpenses ?? {};
  const rawLines: any[] = Array.isArray(opEx?.lines) ? opEx.lines : [];
  const lines: ApiIncomeStatementLine[] = rawLines.map(l => ({
    key: l.key ?? '',
    nameEn: l.nameEn ?? l.name_en ?? l.key ?? '',
    amountCents: Number(l.amountCents ?? l.amount_cents ?? 0),
  }));
  const other = d?.otherIncomeExpenses ?? d?.other_income_expenses ?? {};
  return {
    from: d?.from ?? from,
    to: d?.to ?? to,
    revenue: {
      sales:  Number(d?.revenue?.sales  ?? 0),
      rental: Number(d?.revenue?.rental ?? 0),
      total:  Number(d?.revenue?.total  ?? 0),
    },
    cogs:        Number(d?.cogs ?? 0),
    grossProfit: Number(d?.grossProfit ?? d?.gross_profit ?? 0),
    operatingExpenses: { lines, total: Number(opEx?.total ?? 0) },
    operatingIncome:  Number(d?.operatingIncome  ?? d?.operating_income  ?? 0),
    otherIncomeExpenses: {
      interestIncome:  Number(other?.interestIncome  ?? other?.interest_income  ?? 0),
      interestExpense: Number(other?.interestExpense ?? other?.interest_expense ?? 0),
      net: Number(other?.net ?? 0),
    },
    incomeBeforeTax: Number(d?.incomeBeforeTax ?? d?.income_before_tax ?? 0),
    incomeTax:       Number(d?.incomeTax       ?? d?.income_tax        ?? 0),
    netProfit:       Number(d?.netIncome       ?? d?.net_income        ?? d?.netProfit ?? d?.net_profit ?? 0),
  };
};

// ── Expenses ──────────────────────────────────────────────────────────────────

export interface ApiExpenseCategory {
  id: string;
  key: string;
  nameEn: string;
  nameKm?: string;
}

export interface ApiExpense {
  id: string;
  categoryId: string;
  categoryKey?: string;
  categoryNameEn?: string;
  categoryNameKm?: string;
  amountCents: number;
  rateUsed?: number;
  paidAt: string;
  vendor?: string;
  description?: string;
  proofUrl?: string;
  createdByUserId?: string;
  createdByName?: string;
  createdAt?: string;
  updatedAt?: string;
}

const normalizeExpense = (e: any): ApiExpense => ({
  id:              e.id,
  categoryId:      e.categoryId ?? e.category_id ?? '',
  categoryKey:     e.categoryKey ?? e.category_key,
  categoryNameEn:  e.categoryNameEn ?? e.category_name_en,
  categoryNameKm:  e.categoryNameKm ?? e.category_name_km,
  amountCents:     Number(e.amountCents ?? e.amount_cents ?? 0),
  rateUsed:        e.rateUsed ?? e.rate_used,
  paidAt:          e.paidAt ?? e.paid_at ?? '',
  vendor:          e.vendor,
  description:     e.description,
  proofUrl:        e.proofUrl ?? e.proof_url,
  createdByUserId: e.createdByUserId ?? e.created_by_user_id,
  createdByName:   e.createdByName ?? e.created_by_name,
  createdAt:       e.createdAt ?? e.created_at,
  updatedAt:       e.updatedAt ?? e.updated_at,
});

export const getExpenseCategoriesApi = async (): Promise<ApiExpenseCategory[]> => {
  const { data } = await api.get('/api/v1/expenses/categories');
  if (data?.ok === false) throw new Error(data?.error?.messageKey ?? 'Failed to load categories');
  const items = data?.data?.items ?? data?.data ?? [];
  return (Array.isArray(items) ? items : []).map((c: any) => ({
    id:     c.id,
    key:    c.key,
    nameEn: c.nameEn ?? c.name_en ?? c.key,
    nameKm: c.nameKm ?? c.name_km,
  }));
};

export const getExpensesApi = async (params?: {
  from?: string;
  to?: string;
  categoryId?: string;
  cursor?: string;
  limit?: number;
}): Promise<{ items: ApiExpense[]; nextCursor: string | null }> => {
  const p: Record<string, string> = {};
  if (params?.from)       p.from       = params.from;
  if (params?.to)         p.to         = params.to;
  if (params?.categoryId) p.categoryId = params.categoryId;
  if (params?.cursor)     p.cursor     = params.cursor;
  if (params?.limit)      p.limit      = String(params.limit);
  const { data } = await api.get('/api/v1/expenses', { params: p });
  if (data?.ok === false) throw new Error(data?.error?.messageKey ?? 'Failed to load expenses');
  const items = data?.data?.items ?? [];
  return {
    items: Array.isArray(items) ? items.map(normalizeExpense) : [],
    nextCursor: data?.data?.nextCursor ?? null,
  };
};

export const createExpenseApi = async (body: {
  categoryId: string;
  amountCents: number;
  paidAt: string;
  vendor?: string;
  description?: string;
  proofUrl?: string;
}): Promise<ApiExpense> => {
  try {
    const { data } = await api.post('/api/v1/expenses', body);
    if (data?.ok === false) throw new Error(data?.error?.messageKey ?? 'Failed to create expense');
    return normalizeExpense(data?.data ?? {});
  } catch (err: any) {
    throw err;
  }
};

export const updateExpenseApi = async (id: string, body: {
  categoryId?: string;
  amountCents?: number;
  paidAt?: string;
  vendor?: string;
  description?: string;
  proofUrl?: string;
}): Promise<void> => {
  const { data } = await api.patch(`/api/v1/expenses/${id}`, body);
  if (data?.ok === false) throw new Error(data?.error?.messageKey ?? 'Failed to update expense');
};

export const deleteExpenseApi = async (id: string): Promise<void> => {
  const { data } = await api.delete(`/api/v1/expenses/${id}`);
  if (data?.ok === false) throw new Error(data?.error?.messageKey ?? 'Failed to delete expense');
};
