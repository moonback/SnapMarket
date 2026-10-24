import { NextRequest, NextResponse } from 'next/server';
import { ACCESS_COOKIE, apiUrl, cookieOptions, jwtExpiry, REFRESH_COOKIE } from './src/lib/session';

/**
 * Protège toutes les pages et renouvelle la session avant expiration du jeton d'accès,
 * à l'aide du refresh token stocké en cookie httpOnly.
 */
export async function middleware(req: NextRequest) {
  const access = req.cookies.get(ACCESS_COOKIE)?.value;
  const refresh = req.cookies.get(REFRESH_COOKIE)?.value;
  const exp = access ? jwtExpiry(access) : null;
  const valid = exp !== null && exp * 1000 - Date.now() > 60_000;
  if (valid) return NextResponse.next();

  const login = NextResponse.redirect(new URL('/login', req.url));
  if (!refresh) return login;

  const res = await fetch(`${apiUrl()}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: refresh }),
    cache: 'no-store',
  }).catch(() => null);
  if (!res?.ok) {
    login.cookies.delete(ACCESS_COOKIE);
    login.cookies.delete(REFRESH_COOKIE);
    return login;
  }
  const tokens = (await res.json()) as {
    accessToken: string;
    accessTokenExpiresAt: string;
    refreshToken: string;
    refreshTokenExpiresAt: string;
  };
  // Transmet le nouveau jeton à la requête en cours et le pose dans le navigateur.
  req.cookies.set(ACCESS_COOKIE, tokens.accessToken);
  req.cookies.set(REFRESH_COOKIE, tokens.refreshToken);
  const next = NextResponse.next({ request: { headers: req.headers } });
  next.cookies.set(
    ACCESS_COOKIE,
    tokens.accessToken,
    cookieOptions(new Date(tokens.accessTokenExpiresAt)),
  );
  next.cookies.set(
    REFRESH_COOKIE,
    tokens.refreshToken,
    cookieOptions(new Date(tokens.refreshTokenExpiresAt)),
  );
  return next;
}

export const config = {
  matcher: ['/((?!login|_next/static|_next/image|favicon.ico).*)'],
};
