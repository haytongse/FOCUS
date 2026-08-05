import React, { useState, useCallback, useEffect } from 'react';
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
} from '../services/focusApi';

type AppScreen = 'splash' | 'login' | 'main';

const AppNavigator: React.FC = () => {
  const [screen, setScreen] = useState<AppScreen>('splash');
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);

  // Restore token AND user from AsyncStorage after splash
  const handleSplashFinish = useCallback(async () => {
    const [savedToken, savedUser] = await Promise.all([
      restoreAuthToken(),
      restoreAuthUser(),
    ]);
    if (savedToken) {
      setToken(savedToken);
      if (savedUser) setUser(savedUser as User);
      setScreen('main');
    } else {
      setScreen('login');
    }
  }, []);

  const handleLoginSuccess = useCallback((loggedInUser: User, loggedInToken: string) => {
    setUser(loggedInUser);
    setToken(loggedInToken);
    setAuthUser(loggedInUser); // persist so it survives app restart
    setScreen('main');
  }, []);

  const handleLogout = useCallback(() => {
    setAuthToken(null); // clears token + user from AsyncStorage
    setUser(null);
    setToken(null);
    setScreen('login');
  }, []);

  useEffect(() => {
    setOnUnauthorized(handleLogout);
    return () => setOnUnauthorized(null);
  }, [handleLogout]);

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
          <DrawerNavigator user={user} token={token} onLogout={handleLogout} />
        </NavigationContainer>
      </POSProvider>
    );
  }

  // Admin / manager / unknown roles: standard drawer + tabs
  return (
    <NavigationContainer>
      <DrawerNavigator user={user} token={token} onLogout={handleLogout} />
    </NavigationContainer>
  );
};

export default AppNavigator;
