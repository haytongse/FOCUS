import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ErpMenuItem } from '../models/ErpMenu';
import { User } from '../models/User';
import { getMenuApi } from '../services/focusApi';
import Colors from '../theme/colors';
import AppText from '../components/AppText';
import BottomTabNavigator from './BottomTabNavigator';
import { DrawerContext } from './DrawerContext';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const DRAWER_WIDTH = Math.min(SCREEN_WIDTH * 0.92, 400);
const ANIM_OPEN_MS = 280;
const ANIM_CLOSE_MS = 220;

// ─── Props ────────────────────────────────────────────────────────────────────

interface DrawerNavigatorProps {
  user: User | null;
  token: string | null;
  onLogout: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

const DrawerNavigator: React.FC<DrawerNavigatorProps> = ({
  user,
  token,
  onLogout,
}) => {
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const [menuItems, setMenuItems] = useState<ErpMenuItem[]>([]);
  const [menuLoading, setMenuLoading] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string | number>>(
    new Set(),
  );

  const translateX = useRef(new Animated.Value(-DRAWER_WIDTH)).current;
  const overlayOpacity = useRef(new Animated.Value(0)).current;

  // Fetch ERP menu after login
  useEffect(() => {
    if (!token) return;
    setMenuLoading(true);
    getMenuApi(token)
      .then(setMenuItems)
      .catch(() => {})
      .finally(() => setMenuLoading(false));
  }, [token]);

  // Open / close animations
  const openDrawer = useCallback(() => {
    setOpen(true);
    Animated.parallel([
      Animated.timing(translateX, {
        toValue: 0,
        duration: ANIM_OPEN_MS,
        useNativeDriver: true,
      }),
      Animated.timing(overlayOpacity, {
        toValue: 0.5,
        duration: ANIM_OPEN_MS,
        useNativeDriver: true,
      }),
    ]).start();
  }, [overlayOpacity, translateX]);

  const closeDrawer = useCallback(() => {
    Animated.parallel([
      Animated.timing(translateX, {
        toValue: -DRAWER_WIDTH,
        duration: ANIM_CLOSE_MS,
        useNativeDriver: true,
      }),
      Animated.timing(overlayOpacity, {
        toValue: 0,
        duration: ANIM_CLOSE_MS,
        useNativeDriver: true,
      }),
    ]).start(() => setOpen(false));
  }, [overlayOpacity, translateX]);

  // Toggle expand/collapse for items with children
  const toggleExpand = useCallback((id: string | number) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  // Render a single menu item (recursive for children)
  const renderMenuItem = (item: ErpMenuItem, depth = 0): React.ReactNode => {
    const hasChildren = (item.children?.length ?? 0) > 0;
    const isExpanded = expandedIds.has(item.id);

    return (
      <View key={String(item.id)}>
        <TouchableOpacity
          style={[styles.menuItem, depth > 0 && styles.menuItemChild]}
          onPress={() => {
            if (hasChildren) {
              toggleExpand(item.id);
            } else {
              closeDrawer();
            }
          }}
          activeOpacity={0.7}
        >
          <View style={[styles.menuItemDot, depth === 0 && styles.menuItemDotPrimary]} />
          <AppText
            style={
              depth > 0
                ? [styles.menuItemText, styles.menuItemChildText]
                : styles.menuItemText
            }
            numberOfLines={1}
          >
            {item.name}
          </AppText>
          {hasChildren && (
            <AppText style={styles.expandIcon}>
              {isExpanded ? '▾' : '▸'}
            </AppText>
          )}
        </TouchableOpacity>
        {hasChildren &&
          isExpanded &&
          item.children!.map(child => renderMenuItem(child, depth + 1))}
      </View>
    );
  };

  const initials = user?.name
    ? user.name
        .split(' ')
        .slice(0, 2)
        .map(w => w[0]?.toUpperCase())
        .join('')
    : 'U';

  return (
    <DrawerContext.Provider value={{ openDrawer }}>
      <View style={styles.root}>
        {/* ── Main app content ── */}
        <BottomTabNavigator user={user} onLogout={onLogout} />

        {/* ── Overlay + drawer (rendered on top, pointer-events controlled) ── */}
        <View
          style={StyleSheet.absoluteFill}
          pointerEvents={open ? 'box-none' : 'none'}
        >
          {/* Dimmed overlay */}
          <Animated.View
            style={[StyleSheet.absoluteFill, { opacity: overlayOpacity, backgroundColor: '#000' }]}
            pointerEvents={open ? 'auto' : 'none'}
          >
            <TouchableOpacity
              style={StyleSheet.absoluteFill}
              onPress={closeDrawer}
              activeOpacity={1}
            />
          </Animated.View>

          {/* Drawer panel */}
          <Animated.View
            style={[
              styles.drawer,
              {
                width: DRAWER_WIDTH,
                paddingTop: insets.top,
                transform: [{ translateX }],
              },
            ]}
            pointerEvents="box-none"
          >
            {/* ── Header ── */}
            <View style={styles.drawerHeader}>
              <View style={styles.avatar}>
                <AppText style={styles.avatarText}>{initials}</AppText>
              </View>
              <View style={styles.userInfo}>
                <AppText style={styles.userName} numberOfLines={1}>
                  {user?.name ?? 'User'}
                </AppText>
                {user?.email ? (
                  <AppText style={styles.userEmail} numberOfLines={1}>
                    {user.email}
                  </AppText>
                ) : null}
              </View>
              <TouchableOpacity onPress={closeDrawer} style={styles.closeBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <AppText style={styles.closeIcon}>✕</AppText>
              </TouchableOpacity>
            </View>

            <View style={styles.divider} />

            {/* ── Menu items ── */}
            <ScrollView
              style={styles.menuScroll}
              contentContainerStyle={styles.menuContent}
              showsVerticalScrollIndicator={false}
            >
              {menuLoading ? (
                <View style={styles.loadingBox}>
                  <ActivityIndicator color={Colors.primary} size="small" />
                  <AppText style={styles.loadingText}>Loading menu…</AppText>
                </View>
              ) : menuItems.length === 0 ? (
                <AppText style={styles.emptyText}>No menu items</AppText>
              ) : (
                menuItems.map(item => renderMenuItem(item))
              )}
            </ScrollView>

            {/* ── Footer ── */}
            <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
              <View style={styles.divider} />
              <TouchableOpacity
                style={styles.logoutBtn}
                onPress={() => {
                  closeDrawer();
                  setTimeout(onLogout, 300);
                }}
                activeOpacity={0.7}
              >
                <AppText style={styles.logoutText}>⎋  Log Out</AppText>
              </TouchableOpacity>
            </View>
          </Animated.View>
        </View>
      </View>
    </DrawerContext.Provider>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  drawer: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
    backgroundColor: Colors.surface,
    shadowColor: '#000',
    shadowOffset: { width: 4, height: 0 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
    elevation: 24,
    flexDirection: 'column',
  },

  // Header
  drawerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 20,
    gap: 12,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: Colors.white,
    fontSize: 18,
    fontWeight: '700',
  },
  userInfo: {
    flex: 1,
  },
  userName: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.text,
  },
  userEmail: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  closeBtn: {
    padding: 4,
  },
  closeIcon: {
    fontSize: 16,
    color: Colors.textSecondary,
  },

  divider: {
    height: 1,
    backgroundColor: Colors.divider,
    marginHorizontal: 0,
  },

  // Menu list
  menuScroll: {
    flex: 1,
  },
  menuContent: {
    paddingVertical: 8,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 10,
  },
  menuItemChild: {
    paddingLeft: 36,
    paddingVertical: 11,
  },
  menuItemDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.border,
  },
  menuItemDotPrimary: {
    backgroundColor: Colors.primary,
  },
  menuItemText: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: Colors.text,
  },
  menuItemChildText: {
    fontSize: 14,
    fontWeight: '400',
    color: Colors.textSecondary,
  },
  expandIcon: {
    fontSize: 14,
    color: Colors.textSecondary,
  },

  // States
  loadingBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 20,
  },
  loadingText: {
    color: Colors.textSecondary,
    fontSize: 14,
  },
  emptyText: {
    padding: 20,
    color: Colors.textSecondary,
    fontSize: 14,
  },

  // Footer
  footer: {
    backgroundColor: Colors.surface,
  },
  logoutBtn: {
    paddingVertical: 16,
    paddingHorizontal: 20,
  },
  logoutText: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.error,
  },
});

export default DrawerNavigator;
