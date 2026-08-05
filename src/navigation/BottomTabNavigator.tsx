import React from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { createBottomTabNavigator, BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path, Circle, Rect } from 'react-native-svg';
import { MainTabParamList } from './types';
import HomeScreen from '../screens/home/HomeScreen';
import MenuScreen from '../screens/menu/MenuScreen';
import ManageScreen from '../screens/manage/ManageScreen';
import ProfileScreen from '../screens/profile/ProfileScreen';
import POSScreen from '../screens/pos/POSScreen';
import AppText from '../components/AppText';
import { User } from '../models/User';
import { tabEvents } from './tabEvents';

const Tab = createBottomTabNavigator<MainTabParamList>();

// ─── Colors ───────────────────────────────────────────────────────────────────

const PRIMARY       = '#2563EB';
const PRIMARY_LIGHT = '#EFF6FF';
const GRAY          = '#BDBDBD';

// ─── SVG Icons ────────────────────────────────────────────────────────────────

const HomeIcon: React.FC<{ color: string; size: number }> = ({ color, size }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path
      d="M3 9.5L12 3L21 9.5V20C21 20.55 20.55 21 20 21H15V15H9V21H4C3.45 21 3 20.55 3 20V9.5Z"
      stroke={color} strokeWidth={1.8} strokeLinejoin="round" fill="none"
    />
  </Svg>
);

const MenuIcon: React.FC<{ color: string; size: number }> = ({ color, size }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path d="M3 6H21" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
    <Path d="M3 12H21" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
    <Path d="M3 18H15" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
  </Svg>
);

const ManageIcon: React.FC<{ color: string; size: number }> = ({ color, size }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path d="M12 2L2 7L12 12L22 7L12 2Z" stroke={color} strokeWidth={1.8} strokeLinejoin="round" fill="none" />
    <Path d="M2 17L12 22L22 17" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    <Path d="M2 12L12 17L22 12" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" fill="none" />
  </Svg>
);

const ProfileIcon: React.FC<{ color: string; size: number }> = ({ color, size }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Circle cx={12} cy={8} r={4} stroke={color} strokeWidth={1.8} fill="none" />
    <Path d="M4 20C4 16.686 7.582 14 12 14C16.418 14 20 16.686 20 20" stroke={color} strokeWidth={1.8} strokeLinecap="round" fill="none" />
  </Svg>
);

// Cash-register style POS icon
const POSIcon: React.FC<{ color: string; size: number }> = ({ color, size }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Rect x={2} y={7} width={20} height={14} rx={2} stroke={color} strokeWidth={1.8} fill="none" />
    <Path d="M16 7V5C16 3.9 15.1 3 14 3H10C8.9 3 8 3.9 8 5V7" stroke={color} strokeWidth={1.8} strokeLinecap="round" fill="none" />
    <Path d="M12 12V17" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
    <Path d="M9.5 14.5H14.5" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
  </Svg>
);

// ─── Tab config map ───────────────────────────────────────────────────────────

type TabConfig = { label: string; Icon: React.FC<{ color: string; size: number }> };

const TAB_CONFIG: Record<string, TabConfig> = {
  POS:     { label: 'POS',     Icon: POSIcon },
  Home:    { label: 'Home',    Icon: HomeIcon },
  Menu:    { label: 'Menu',    Icon: MenuIcon },
  Manage:  { label: 'Manage',  Icon: ManageIcon },
  Profile: { label: 'Profile', Icon: ProfileIcon },
};

// ─── Custom Tab Bar ───────────────────────────────────────────────────────────

const CustomTabBar: React.FC<BottomTabBarProps> = ({ state, navigation }) => {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.tabBar, { paddingBottom: insets.bottom > 0 ? insets.bottom : 8 }]}>
      {state.routes.map((route, index) => {
        const config = TAB_CONFIG[route.name];
        if (!config) return null;
        const focused = state.index === index;

        return (
          <TouchableOpacity
            key={route.name}
            onPress={() => {
              if (state.index === index) {
                tabEvents.emit(route.name);
              } else {
                navigation.navigate(route.name);
              }
            }}
            activeOpacity={0.7}
            style={styles.tabItem}
          >
            <View style={[styles.topBar, focused && styles.topBarActive]} />
            <View style={[styles.iconBox, focused && styles.iconBoxActive]}>
              <config.Icon color={focused ? PRIMARY : GRAY} size={22} />
            </View>
            <AppText style={[styles.tabLabel, focused && styles.tabLabelActive]}>
              {config.label}
            </AppText>
          </TouchableOpacity>
        );
      })}
    </View>
  );
};

// ─── Navigator ────────────────────────────────────────────────────────────────

interface BottomTabNavigatorProps {
  user: User | null;
  onLogout: () => void;
}

const BottomTabNavigator: React.FC<BottomTabNavigatorProps> = ({ user, onLogout }) => {
  const isOwner = user?.role === 'owner';

  return (
    <Tab.Navigator
      tabBar={props => <CustomTabBar {...props} />}
      screenOptions={{ headerShown: false }}
    >
      <Tab.Screen name="Home">
        {() => <HomeScreen user={user} />}
      </Tab.Screen>

      {/* POS tab — owner only, between Home and Menu */}
      {isOwner && (
        <Tab.Screen name="POS">
          {() => <POSScreen user={user} onLogout={onLogout} />}
        </Tab.Screen>
      )}

      <Tab.Screen name="Menu">
        {() => <MenuScreen user={user} />}
      </Tab.Screen>

      <Tab.Screen name="Manage" component={ManageScreen} />

      <Tab.Screen name="Profile">
        {() => <ProfileScreen user={user} onLogout={onLogout} />}
      </Tab.Screen>
    </Tab.Navigator>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#F0F0F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 12,
    height: 85,
    paddingTop: 0,
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: 0,
  },
  topBar: {
    width: '60%',
    height: 3,
    borderRadius: 2,
    backgroundColor: 'transparent',
    marginBottom: 6,
  },
  topBarActive: {
    backgroundColor: PRIMARY,
  },
  iconBox: {
    width: 44,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
    marginBottom: 2,
  },
  iconBoxActive: {
    backgroundColor: PRIMARY_LIGHT,
  },
  tabLabel: {
    fontSize: 11,
    color: GRAY,
    fontWeight: '500',
  },
  tabLabelActive: {
    color: PRIMARY,
    fontWeight: '700',
  },
});

export default BottomTabNavigator;
