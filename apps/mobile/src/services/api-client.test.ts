import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, buildQuery, createApiClient, REFRESH_KEY, SecureStorage } from './api-client';

function memoryStorage(
  initial: Record<string, string> = {},
): SecureStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    get: async (k) => data[k] ?? null,
    set: async (k, v) => {
      data[k] = v;
    },
    remove: async (k) => {
      delete data[k];
    },
  };
}

const json = (status: number, body: unknown) =>
  new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const tokens = (n: number) => ({
  accessToken: `access-${n}`,
  accessTokenExpiresAt: new Date().toISOString(),
  refreshToken: `refresh-${n}`,
  refreshTokenExpiresAt: new Date().toISOString(),
});

test('buildQuery ignore les valeurs vides et joint les tableaux', () => {
  assert.equal(
    buildQuery({ q: 'veste', a: undefined, b: '', c: ['NEW', 'GOOD'], n: 0 }),
    '?q=veste&c=NEW%2CGOOD&n=0',
  );
  assert.equal(buildQuery(undefined), '');
});

test('renouvelle le jeton une seule fois pour des 401 simultanés puis rejoue les requêtes', async () => {
  const storage = memoryStorage({ [REFRESH_KEY]: 'refresh-0' });
  let refreshCalls = 0;
  const fetchMock = (async (url: string, init?: RequestInit) => {
    if (url.endsWith('/auth/refresh')) {
      refreshCalls++;
      await new Promise((r) => setTimeout(r, 10));
      return json(200, tokens(1));
    }
    const auth = (init?.headers as Record<string, string>).Authorization;
    return auth === 'Bearer access-1' ? json(200, { ok: true }) : json(401, { message: 'expired' });
  }) as typeof fetch;
  const api = createApiClient({ baseUrl: 'http://api', storage, fetch: fetchMock });
  const results = await Promise.all([api.request('/a'), api.request('/b'), api.request('/c')]);
  assert.deepEqual(results, [{ ok: true }, { ok: true }, { ok: true }]);
  assert.equal(refreshCalls, 1);
  assert.equal(storage.data[REFRESH_KEY], 'refresh-1');
});

test('signale l’expiration de session si le renouvellement échoue', async () => {
  const storage = memoryStorage({ [REFRESH_KEY]: 'revoked' });
  let expired = false;
  const fetchMock = (async (url: string) =>
    url.endsWith('/auth/refresh')
      ? json(401, { message: 'Session révoquée' })
      : json(401, { message: 'Authentification requise' })) as typeof fetch;
  const api = createApiClient({
    baseUrl: 'http://api',
    storage,
    fetch: fetchMock,
    onSessionExpired: () => (expired = true),
  });
  await assert.rejects(
    api.request('/x'),
    (e: unknown) => e instanceof ApiError && e.status === 401,
  );
  assert.equal(expired, true);
  assert.equal(storage.data[REFRESH_KEY], undefined);
});

test('expose le message et le code d’erreur de l’API', async () => {
  const fetchMock = (async () =>
    json(409, {
      statusCode: 409,
      message: 'Article indisponible',
      code: 'PRODUCT_UNAVAILABLE',
    })) as typeof fetch;
  const api = createApiClient({
    baseUrl: 'http://api',
    storage: memoryStorage(),
    fetch: fetchMock,
  });
  await assert.rejects(api.request('/orders', { method: 'POST', body: {} }), (e: unknown) => {
    assert.ok(e instanceof ApiError);
    assert.equal(e.message, 'Article indisponible');
    assert.equal(e.code, 'PRODUCT_UNAVAILABLE');
    return true;
  });
});

test('traduit une erreur réseau en message lisible', async () => {
  const fetchMock = (async () => {
    throw new TypeError('Network request failed');
  }) as typeof fetch;
  const api = createApiClient({
    baseUrl: 'http://api',
    storage: memoryStorage(),
    fetch: fetchMock,
  });
  await assert.rejects(api.request('/x'), /Connexion impossible/);
});
