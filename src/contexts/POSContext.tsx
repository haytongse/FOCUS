import React, { createContext, useContext, useReducer, useCallback, useMemo } from 'react';
import { ApiProduct } from '../services/focusApi';

export interface CartItem {
  product: ApiProduct;
  qty: number;
  unitPriceCents: number;
}

interface POSState {
  cart: CartItem[];
  discountPercent: number;
  note: string;
}

type POSAction =
  | { type: 'ADD_ITEM'; product: ApiProduct }
  | { type: 'REMOVE_ITEM'; productId: string }
  | { type: 'UPDATE_QTY'; productId: string; qty: number }
  | { type: 'SET_DISCOUNT'; discountPercent: number }
  | { type: 'SET_NOTE'; note: string }
  | { type: 'CLEAR_CART' };

function posReducer(state: POSState, action: POSAction): POSState {
  switch (action.type) {
    case 'ADD_ITEM': {
      const existing = state.cart.find(i => i.product.id === action.product.id);
      const unitPriceCents = parseInt(action.product.fixedPriceCents ?? '0', 10);
      if (existing) {
        return {
          ...state,
          cart: state.cart.map(i =>
            i.product.id === action.product.id ? { ...i, qty: i.qty + 1 } : i
          ),
        };
      }
      return {
        ...state,
        cart: [...state.cart, { product: action.product, qty: 1, unitPriceCents }],
      };
    }
    case 'REMOVE_ITEM':
      return { ...state, cart: state.cart.filter(i => i.product.id !== action.productId) };
    case 'UPDATE_QTY':
      if (action.qty <= 0) {
        return { ...state, cart: state.cart.filter(i => i.product.id !== action.productId) };
      }
      return {
        ...state,
        cart: state.cart.map(i =>
          i.product.id === action.productId ? { ...i, qty: action.qty } : i
        ),
      };
    case 'SET_DISCOUNT':
      return { ...state, discountPercent: Math.min(100, Math.max(0, action.discountPercent)) };
    case 'SET_NOTE':
      return { ...state, note: action.note };
    case 'CLEAR_CART':
      return { cart: [], discountPercent: 0, note: '' };
    default:
      return state;
  }
}

interface POSContextValue {
  cart: CartItem[];
  discountPercent: number;
  note: string;
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  itemCount: number;
  addItem: (product: ApiProduct) => void;
  removeItem: (productId: string) => void;
  updateQty: (productId: string, qty: number) => void;
  setDiscount: (discountPercent: number) => void;
  setNote: (note: string) => void;
  clearCart: () => void;
}

const POSContext = createContext<POSContextValue | null>(null);

export const POSProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, dispatch] = useReducer(posReducer, {
    cart: [],
    discountPercent: 0,
    note: '',
  });

  const subtotalCents = useMemo(
    () => state.cart.reduce((sum, i) => sum + i.unitPriceCents * i.qty, 0),
    [state.cart]
  );
  const discountCents = useMemo(
    () => Math.round(subtotalCents * state.discountPercent / 100),
    [subtotalCents, state.discountPercent]
  );
  const totalCents = subtotalCents - discountCents;
  const itemCount = state.cart.reduce((sum, i) => sum + i.qty, 0);

  const addItem = useCallback((product: ApiProduct) => dispatch({ type: 'ADD_ITEM', product }), []);
  const removeItem = useCallback((productId: string) => dispatch({ type: 'REMOVE_ITEM', productId }), []);
  const updateQty = useCallback((productId: string, qty: number) => dispatch({ type: 'UPDATE_QTY', productId, qty }), []);
  const setDiscount = useCallback((discountPercent: number) => dispatch({ type: 'SET_DISCOUNT', discountPercent }), []);
  const setNote = useCallback((note: string) => dispatch({ type: 'SET_NOTE', note }), []);
  const clearCart = useCallback(() => dispatch({ type: 'CLEAR_CART' }), []);

  return (
    <POSContext.Provider
      value={{
        cart: state.cart,
        discountPercent: state.discountPercent,
        note: state.note,
        subtotalCents,
        discountCents,
        totalCents,
        itemCount,
        addItem,
        removeItem,
        updateQty,
        setDiscount,
        setNote,
        clearCart,
      }}
    >
      {children}
    </POSContext.Provider>
  );
};

export const usePOS = (): POSContextValue => {
  const ctx = useContext(POSContext);
  if (!ctx) throw new Error('usePOS must be used inside POSProvider');
  return ctx;
};
