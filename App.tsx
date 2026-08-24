import React, { useEffect } from 'react';
import { StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import AppNavigator from './src/navigation/AppNavigator';
import { AlertProvider } from './src/components/AppAlert';
import Colors from './src/theme/colors';
import { requestNotificationPermission } from './src/services/fcmService';
import * as Updates from 'expo-updates';

async function checkForOTAUpdate() {
  try {
    const update = await Updates.checkForUpdateAsync();
    if (update.isAvailable) {
      await Updates.fetchUpdateAsync();
      await Updates.reloadAsync();
    }
  } catch {
    // silent — dev builds or no network
  }
}

function App() {
  useEffect(() => {
    requestNotificationPermission();
    if (!__DEV__) {
      checkForOTAUpdate();
    }
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" backgroundColor={Colors.background} />
      <AlertProvider>
        <AppNavigator />
      </AlertProvider>
    </SafeAreaProvider>
  );
}

export default App;
