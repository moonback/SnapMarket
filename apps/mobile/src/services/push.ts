import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { EAS_PROJECT_ID } from '../config';
import { api } from './api';

let registeredToken: string | null = null;

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

/**
 * Demande l'autorisation et enregistre le jeton push auprès de l'API.
 * Retourne null (sans erreur bloquante) si l'appareil, l'autorisation ou la
 * configuration EAS ne le permettent pas.
 */
export async function registerPushToken(): Promise<string | null> {
  if (!Device.isDevice || !EAS_PROJECT_ID) return null;
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Notifications',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
  const current = await Notifications.getPermissionsAsync();
  const status = current.granted
    ? current.status
    : (await Notifications.requestPermissionsAsync()).status;
  if (status !== 'granted') return null;
  const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId: EAS_PROJECT_ID });
  await api.request('/users/me/push-tokens', {
    method: 'POST',
    body: { token, platform: Platform.OS === 'ios' ? 'ios' : 'android' },
  });
  registeredToken = token;
  return token;
}

export async function unregisterPushToken(): Promise<void> {
  if (!registeredToken) return;
  await api.request(`/users/me/push-tokens/${encodeURIComponent(registeredToken)}`, {
    method: 'DELETE',
  });
  registeredToken = null;
}
