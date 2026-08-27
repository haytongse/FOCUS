import React, { useState, useCallback, useEffect, useRef } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import SplashScreen from '../screens/SplashScreen';
import LoginScreen from '../screens/auth/LoginScreen';
import DrawerNavigator from './DrawerNavigator';
import POSNavigator from './POSNavigator';
import { POSProvider } from '../contexts/POSContext';
import { User } from '../models/User';
import {
  restoreAuthToken,
  setAuthToken,
  setAuthUser,
  restoreAuthUser,
  setOnUnauthorized,
  refreshFcmTokenApi,
} from '../services/focusApi';
import { getFcmToken } from '../services/fcmService';
import { getMessaging } from '@react-native-firebase/messaging';
import { tabEvents } from './tabEvents';

type AppScreen = 'splash' | 'login' | 'main';

const AppNavigator: React.FC = () => {
  const [screen, setScreen] = useState<AppScreen>('splash');
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [fcmToken, setFcmToken] = useState<string | null>(null);
  // undefined = no pending navigation; null = navigate to PO list (no specific ID); string = specific PO
  const pendingPoIdRef = useRef<string | null | undefined>(undefined);

  const navigateToPo = useCallback((poId?: string) => {
    tabEvents.emit('ManageNav', { view: 'purchaseOrderList', poId });
  }, []);

  // Restore token AND user from AsyncStorage after splash
  const handleSplashFinish = useCallback(async () => {
    const [savedToken, savedUser] = await Promise.all([
      restoreAuthToken(),
      restoreAuthUser(),
    ]);

    // Check if app was opened by tapping a notification (killed state)
    try {
      const initial = await getMessaging().getInitialNotification();
      if (initial?.data) {
        const payload = typeof initial.data === 'string'
          ? JSON.parse(initial.data)
          : initial.data;
        const type: string = payload?.type ?? '';
        if (type.startsWith('po_')) {
          const id = String(payload?.id ?? '');
          pendingPoIdRef.current = id || null;
        }
      }
    } catch {}

    if (savedToken) {
      setToken(savedToken);
      if (savedUser) setUser(savedUser as User);
      setScreen('main');
      // Update local FCM token state (UI only — no API call to avoid duplicate registration)
      getFcmToken().then(newFcmToken => {
        if (newFcmToken) setFcmToken(newFcmToken);
      });
    } else {
      setScreen('login');
    }
  }, []);

  const handleLoginSuccess = useCallback((loggedInUser: User, loggedInToken: string, serverFcmToken?: string | null) => {
    setUser(loggedInUser);
    setToken(loggedInToken);
    if (serverFcmToken) setFcmToken(serverFcmToken);
    setAuthUser(loggedInUser);
    setScreen('main');
  }, []);

  const handleLogout = useCallback(() => {
    setAuthToken(null);
    setUser(null);
    setToken(null);
    setFcmToken(null);
    setScreen('login');
  }, []);

  useEffect(() => {
    setOnUnauthorized(handleLogout);
    return () => setOnUnauthorized(null);
  }, [handleLogout]);

  // Update backend only when Firebase rotates the FCM token (avoids duplicate registrations)
  useEffect(() => {
    if (!token) return;
    const unsubscribe = getMessaging().onTokenRefresh(newFcmToken => {
      setFcmToken(newFcmToken);
      refreshFcmTokenApi(newFcmToken).catch(() => {});
    });
    return () => unsubscribe();
  }, [token]);

  // Handle notification tap when app is in background (not killed)
  useEffect(() => {
    const unsubscribe = getMessaging().onNotificationOpenedApp(remoteMessage => {
      try {
        const raw = remoteMessage?.data;
        const payload = typeof raw === 'string' ? JSON.parse(raw) : raw;
        const type: string = payload?.type ?? '';
        if (!type.startsWith('po_')) return;
        const poId = String(payload?.id ?? '') || null;
        if (screen === 'main') {
          navigateToPo(poId ?? undefined);
        } else {
          pendingPoIdRef.current = poId;
        }
      } catch {}
    });
    return () => unsubscribe();
  }, [screen, navigateToPo]);

  // Fire pending navigation once the main screen is ready
  useEffect(() => {
    if (screen !== 'main') return;
    if (pendingPoIdRef.current === undefined) return;
    const poId = pendingPoIdRef.current ?? undefined;
    pendingPoIdRef.current = undefined;
    // Small delay to let the navigator mount
    const t = setTimeout(() => navigateToPo(poId), 500);
    return () => clearTimeout(t);
  }, [screen, navigateToPo]);

  if (screen === 'splash') {
    return <SplashScreen onFinish={handleSplashFinish} />;
  }

  if (screen === 'login') {
    return <LoginScreen onLoginSuccess={handleLoginSuccess} />;
  }

  // Cashier: POS only, no drawer or tabs
  if (user?.role === 'cashier') {
    return <POSNavigator user={user} onLogout={handleLogout} />;
  }

  // Owner: full app (drawer + tabs) with POS tab added
  // POSProvider lives here so POSScreen inside the tab can access cart state
  if (user?.role === 'owner') {
    return (
      <POSProvider>
        <NavigationContainer>
          <DrawerNavigator user={user} token={token} onLogout={handleLogout} fcmToken={fcmToken} />
        </NavigationContainer>
      </POSProvider>
    );
  }

  // Admin / manager / unknown roles: standard drawer + tabs
  return (
    <NavigationContainer>
      <DrawerNavigator user={user} token={token} onLogout={handleLogout} fcmToken={fcmToken} />
    </NavigationContainer>
  );
};

export default AppNavigator;
