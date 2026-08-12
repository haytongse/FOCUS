import {
  getMessaging,
  requestPermission,
  getToken,
  AuthorizationStatus,
} from '@react-native-firebase/messaging';
import { Alert, Linking } from 'react-native';
import * as Notifications from 'expo-notifications';

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

export const notifyInvoiceCreated = async (
  invoiceNumber: string,
  totalCents: number | string | null,
  rateUsed?: number,
): Promise<void> => {
  try {
    let amountStr = '';
    if (totalCents != null) {
      const cents = Number(totalCents);
      const usd = cents / 100;
      amountStr = ` — $${usd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD`;
      if (rateUsed && rateUsed > 1) {
        const khr = cents * rateUsed;
        amountStr += ` / ៛${khr.toLocaleString('en-US')}`;
      }
    }
    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'New Invoice Created',
        body: `${invoiceNumber}${amountStr}`,
        sound: true,
      },
      trigger: null,
    });
  } catch (err: any) {
    console.warn('[Notify] Invoice notification failed:', err?.message ?? err);
  }
};
