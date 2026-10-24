import * as SecureStore from 'expo-secure-store';
import { API_URL } from '../config';
import { createApiClient } from './api-client';

const sessionListeners = new Set<() => void>();

/** Client API de l'application : le refresh token est stocké dans le trousseau sécurisé du système. */
export const api = createApiClient({
  baseUrl: API_URL,
  fetch: (...args) => fetch(...args),
  storage: {
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
