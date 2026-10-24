'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { ACCESS_COOKIE, apiUrl, cookieOptions, REFRESH_COOKIE } from '@/lib/session';

export interface ActionState {
  error?: string;
  ok?: string;
  /** Valeur conservée dans le formulaire après une erreur (React réinitialise les champs). */
  email?: string;
}

function str(form: FormData, key: string): string | undefined {
  const v = form.get(key);
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
}

async function run(
  fn: () => Promise<unknown>,
  path: string,
  ok = 'Action effectuée',
): Promise<ActionState> {
  try {
    await fn();
  } catch (e) {
    if (e instanceof ApiError) return { error: e.message };
    throw e;
  }
  revalidatePath(path);
  return { ok };
}

export async function login(_: ActionState, form: FormData): Promise<ActionState> {
  const res = await fetch(`${apiUrl()}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: str(form, 'email'), password: form.get('password') }),
    cache: 'no-store',
  }).catch(() => null);
  const email = str(form, 'email');
  if (!res) return { error: 'API injoignable', email };
  const body = (await res.json().catch(() => ({}))) as {
    message?: string | string[];
    user?: { role: string };
    tokens?: {
      accessToken: string;
      accessTokenExpiresAt: string;
      refreshToken: string;
      refreshTokenExpiresAt: string;
    };
  };
  if (!res.ok || !body.tokens || !body.user) {
    return {
      error: Array.isArray(body.message)
        ? body.message.join(', ')
        : (body.message ?? 'Connexion impossible'),
      email,
    };
  }
  if (body.user.role !== 'ADMIN' && body.user.role !== 'MODERATOR') {
    // Révocation immédiate de la session ouverte pour un compte sans droits d'administration.
    await fetch(`${apiUrl()}/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: body.tokens.refreshToken }),
    }).catch(() => undefined);
    return { error: 'Ce compte n’a pas accès à l’administration', email };
  }
  const store = await cookies();
  store.set(
    ACCESS_COOKIE,
    body.tokens.accessToken,
    cookieOptions(new Date(body.tokens.accessTokenExpiresAt)),
  );
  store.set(
    REFRESH_COOKIE,
    body.tokens.refreshToken,
    cookieOptions(new Date(body.tokens.refreshTokenExpiresAt)),
  );
  redirect('/');
}

export async function logout(): Promise<void> {
  const store = await cookies();
  const refresh = store.get(REFRESH_COOKIE)?.value;
  if (refresh) {
    await fetch(`${apiUrl()}/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: refresh }),
    }).catch(() => undefined);
  }
  store.delete(ACCESS_COOKIE);
  store.delete(REFRESH_COOKIE);
  redirect('/login');
}

export async function setUserStatus(_: ActionState, form: FormData): Promise<ActionState> {
  const id = str(form, 'id')!;
  return run(
    () =>
      api(`/admin/users/${id}/status`, {
        method: 'POST',
        body: JSON.stringify({ status: str(form, 'status'), reason: str(form, 'reason') }),
      }),
    `/users/${id}`,
    'Statut mis à jour',
  );
}

export async function setUserRole(_: ActionState, form: FormData): Promise<ActionState> {
  const id = str(form, 'id')!;
  return run(
    () =>
      api(`/admin/users/${id}/role`, {
        method: 'POST',
        body: JSON.stringify({ role: str(form, 'role') }),
      }),
    `/users/${id}`,
    'Rôle mis à jour',
  );
}

export async function decideSeller(_: ActionState, form: FormData): Promise<ActionState> {
  return run(
    () =>
      api(`/admin/sellers/${str(form, 'userId')}/decision`, {
        method: 'POST',
        body: JSON.stringify({ decision: str(form, 'decision'), note: str(form, 'note') }),
      }),
    '/sellers',
    'Décision enregistrée',
  );
}

export async function moderateContent(_: ActionState, form: FormData): Promise<ActionState> {
  return run(
    () =>
      api(`/admin/content/${str(form, 'type')}/${str(form, 'id')}/moderation`, {
        method: 'POST',
        body: JSON.stringify({ action: str(form, 'action'), reason: str(form, 'reason') }),
      }),
    str(form, 'path') ?? '/products',
    'Décision de modération enregistrée',
  );
}

export async function createCategory(_: ActionState, form: FormData): Promise<ActionState> {
  return run(
    () =>
      api('/admin/categories', {
        method: 'POST',
        body: JSON.stringify({
          slug: str(form, 'slug'),
          name: str(form, 'name'),
          icon: str(form, 'icon'),
          position: str(form, 'position') ? Number(str(form, 'position')) : undefined,
          requiresReview: form.get('requiresReview') === 'on',
        }),
      }),
    '/categories',
    'Catégorie créée',
  );
}

export async function updateCategory(_: ActionState, form: FormData): Promise<ActionState> {
  return run(
    () =>
      api(`/admin/categories/${str(form, 'id')}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: str(form, 'name'),
          position: str(form, 'position') ? Number(str(form, 'position')) : undefined,
          isActive: form.get('isActive') === 'on',
          requiresReview: form.get('requiresReview') === 'on',
        }),
      }),
    '/categories',
    'Catégorie mise à jour',
  );
}

export async function refundOrder(_: ActionState, form: FormData): Promise<ActionState> {
  const id = str(form, 'id')!;
  return run(
    () =>
      api(`/admin/orders/${id}/refund`, {
        method: 'POST',
        body: JSON.stringify({ reason: str(form, 'reason') }),
      }),
    `/orders/${id}`,
    'Remboursement demandé au prestataire',
  );
}

export async function resolveDispute(_: ActionState, form: FormData): Promise<ActionState> {
  return run(
    () =>
      api(`/admin/disputes/${str(form, 'id')}/resolve`, {
        method: 'POST',
        body: JSON.stringify({ resolution: str(form, 'resolution'), note: str(form, 'note') }),
      }),
    '/disputes',
    'Litige résolu',
  );
}

export async function resolveReport(_: ActionState, form: FormData): Promise<ActionState> {
  return run(
    () =>
      api(`/admin/reports/${str(form, 'id')}/resolve`, {
        method: 'POST',
        body: JSON.stringify({
          status: str(form, 'status'),
          contentAction: str(form, 'contentAction'),
          note: str(form, 'note'),
        }),
      }),
    '/reports',
    'Signalement traité',
  );
}

export async function updateSettings(_: ActionState, form: FormData): Promise<ActionState> {
  const commission = Number(str(form, 'commissionPercent')?.replace(',', '.'));
  const patch = {
    commissionBps: Math.round(commission * 100),
    storyTtlHours: Number(str(form, 'storyTtlHours')),
    autoHideReportThreshold: Number(str(form, 'autoHideReportThreshold')),
    offersEnabled: form.get('offersEnabled') === 'on',
  };
  if (!Number.isFinite(commission)) return { error: 'Commission invalide' };
  return run(
    () => api('/admin/settings', { method: 'PATCH', body: JSON.stringify(patch) }),
    '/settings',
    'Paramètres enregistrés',
  );
}
