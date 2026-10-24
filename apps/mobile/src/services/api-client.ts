/**
 * Client HTTP de l'API, indépendant de React Native (testable sous Node).
 * - Jeton d'accès conservé en mémoire, refresh token dans un stockage sécurisé injecté.
 * - Sur 401, un seul renouvellement est lancé même si plusieurs requêtes échouent en même temps.
 */
import type { ApiErrorBody, AuthTokens } from '@snapmarket/shared';

export interface SecureStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null | string[]>;
  auth?: boolean;
}

export const REFRESH_KEY = 'snapmarket.refreshToken';

export function buildQuery(query: RequestOptions['query']): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue;
    params.set(k, Array.isArray(v) ? v.join(',') : String(v));
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}

export function errorMessage(body: Partial<ApiErrorBody> | null, status: number): string {
  if (body?.message) return Array.isArray(body.message) ? body.message.join('\n') : body.message;
  if (status === 0) return 'Connexion impossible. Vérifiez votre réseau.';
  if (status >= 500) return 'Le service est momentanément indisponible.';
  return 'Une erreur est survenue.';
}

export function createApiClient(deps: {
  baseUrl: string;
  storage: SecureStorage;
  fetch: typeof fetch;
  onSessionExpired?: () => void;
}) {
  let accessToken: string | null = null;
  let refreshing: Promise<boolean> | null = null;

  async function setTokens(tokens: AuthTokens): Promise<void> {
    accessToken = tokens.accessToken;
    await deps.storage.set(REFRESH_KEY, tokens.refreshToken);
  }

  async function clear(): Promise<void> {
    accessToken = null;
    await deps.storage.remove(REFRESH_KEY);
  }

  function refresh(): Promise<boolean> {
    refreshing ??= (async () => {
      try {
        const refreshToken = await deps.storage.get(REFRESH_KEY);
        if (!refreshToken) return false;
        const res = await deps.fetch(`${deps.baseUrl}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
        });
        if (!res.ok) {
          // Session révoquée ou expirée : on nettoie localement.
          if (res.status === 401) await clear();
          return false;
        }
        await setTokens((await res.json()) as AuthTokens);
        return true;
      } catch {
        return false;
      } finally {
        refreshing = null;
      }
    })();
    return refreshing;
  }

  async function request<T>(path: string, opts: RequestOptions = {}, retried = false): Promise<T> {
    const auth = opts.auth ?? true;
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    if (auth && accessToken) headers.Authorization = `Bearer ${accessToken}`;
    let res: Response;
    try {
      res = await deps.fetch(`${deps.baseUrl}${path}${buildQuery(opts.query)}`, {
        method: opts.method ?? 'GET',
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      });
    } catch {
      throw new ApiError(0, errorMessage(null, 0));
    }
    if (res.status === 401 && auth && !retried) {
      if (await refresh()) return request<T>(path, opts, true);
      deps.onSessionExpired?.();
    }
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as Partial<ApiErrorBody> | null;
      throw new ApiError(res.status, errorMessage(body, res.status), body?.code);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  /** Révoque le refresh token côté serveur (best effort) puis nettoie localement. */
  async function logout(): Promise<void> {
    const refreshToken = await deps.storage.get(REFRESH_KEY);
    if (refreshToken) {
      await deps
        .fetch(`${deps.baseUrl}/auth/logout`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
        })
        .catch(() => undefined);
    }
    await clear();
  }

  return {
    request,
    logout,
    setTokens,
    clear,
    refresh,
    getAccessToken: () => accessToken,
    hasSession: async () => (await deps.storage.get(REFRESH_KEY)) !== null,
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
