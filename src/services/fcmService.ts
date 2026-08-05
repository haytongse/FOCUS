import { getMessaging, AuthorizationStatus } from '@react-native-firebase/messaging';
import { getApp } from '@react-native-firebase/app';
import { Platform } from 'react-native';

export const getFcmToken = async (): Promise<string | null> => {
  try {
    const m = getMessaging(getApp());
    const authStatus = await m.requestPermission();
    const enabled =
      authStatus === AuthorizationStatus.AUTHORIZED ||
      authStatus === AuthorizationStatus.PROVISIONAL;

    if (!enabled) return null;

    if (Platform.OS === 'ios') {
      await m.registerDeviceForRemoteMessages();
    }

    const token = await m.getToken();
    return token ?? null;
  } catch {
    return null;
  }
};
