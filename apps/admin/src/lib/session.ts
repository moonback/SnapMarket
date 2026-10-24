/** Noms et options des cookies de session de l'administration (httpOnly, jamais lus par le navigateur). */
export const ACCESS_COOKIE = 'sm_admin_at';
export const REFRESH_COOKIE = 'sm_admin_rt';

export function apiUrl(): string {
  return process.env.ADMIN_API_URL ?? 'http://localhost:3000/api/v1';
}

export function cookieOptions(expires: Date) {
  return {
    httpOnly: true,
    secure: process.env.ADMIN_COOKIE_SECURE === 'true',
    sameSite: 'strict' as const,
    path: '/',
    expires,
  };
}

/** Lit l'expiration (exp, en secondes) d'un JWT sans vérifier la signature (la vérification est faite par l'API). */
export function jwtExpiry(token: string): number | null {
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    const json = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/'))) as { exp?: unknown };
    return typeof json.exp === 'number' ? json.exp : null;
  } catch {
    return null;
  }
}
