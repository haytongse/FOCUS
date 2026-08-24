import {
  getMessaging,
  requestPermission,
  getToken,
  AuthorizationStatus,
} from '@react-native-firebase/messaging';
import { Alert, Linking } from 'react-native';

export const requestNotificationPermission = async (): Promise<void> => {
  try {
    await requestPermission(getMessaging());
  } catch (err: any) {
    console.warn('[FCM] Permission request error:', err?.message ?? err);
  }
};

export const getFcmToken = async (): Promise<string | null> => {
  try {
    const messaging = getMessaging();
    const authStatus = await requestPermission(messaging);

    const enabled =
      authStatus === AuthorizationStatus.AUTHORIZED ||
      authStatus === AuthorizationStatus.PROVISIONAL;

    if (!enabled) {
      console.warn('[FCM] Permission denied — token not retrieved');
      Alert.alert(
        'Notifications Disabled',
        'Please allow notifications for this app in Settings.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Open Settings', onPress: () => Linking.openSettings() },
        ],
      );
      return null;
    }

    const token = await getToken(messaging);
    return token ?? null;
  } catch (err: any) {
    console.warn('[FCM] Error getting token:', err?.message ?? err);
    return null;
  }
};

