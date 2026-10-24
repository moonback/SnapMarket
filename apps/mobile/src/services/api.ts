import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { API_URL } from '../config';
import { createApiClient } from './api-client';

const sessionListeners = new Set<() => void>();

/** Client API de l'application : le refresh token est stocké dans le trousseau sécurisé du système. */
export const api = createApiClient({
  baseUrl: API_URL,
  fetch: (...args) => fetch(...args),
  // shortcut: SecureStore n'existe pas sur le web, le token y va dans localStorage (exposé au XSS) ; à revoir si le web sort du dev.
  storage:
    Platform.OS === 'web'
      ? {
          get: async (k) => localStorage.getItem(k),
          set: async (k, v) => localStorage.setItem(k, v),
          remove: async (k) => localStorage.removeItem(k),
        }
      : {
          get: (k) => SecureStore.getItemAsync(k),
          set: (k, v) =>
            SecureStore.setItemAsync(k, v, { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK }),
          remove: (k) => SecureStore.deleteItemAsync(k),
        },
  onSessionExpired: () => sessionListeners.forEach((l) => l()),
});

export function onSessionExpired(listener: () => void): () => void {
  sessionListeners.add(listener);
  return () => sessionListeners.delete(listener);
}

export { ApiError } from './api-client';
