/**
 * Configuration publique de l'application (aucun secret : seules des valeurs
 * publiques EXPO_PUBLIC_* sont embarquées dans le binaire).
 */
export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000/api/v1';
export const WS_URL = process.env.EXPO_PUBLIC_WS_URL ?? API_URL.replace(/\/api\/v1\/?$/, '');
export const STRIPE_PUBLISHABLE_KEY = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '';
export const EAS_PROJECT_ID = process.env.EXPO_PUBLIC_EAS_PROJECT_ID ?? '';
