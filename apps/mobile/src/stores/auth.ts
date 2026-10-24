import { create } from 'zustand';
import type { AuthTokens, MeUser } from '@snapmarket/shared';
import { api, onSessionExpired } from '../services/api';
import { unregisterPushToken } from '../services/push';
import { disconnectSocket } from '../services/socket';

type Status = 'loading' | 'signedOut' | 'signedIn';

interface AuthState {
  status: Status;
  user: MeUser | null;
  bootstrap: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (input: {
    email: string;
    username: string;
    password: string;
    acceptTerms: true;
  }) => Promise<void>;
  refreshMe: () => Promise<void>;
  setUser: (user: MeUser) => void;
  logout: () => Promise<void>;
  reset: () => void;
}

export const useAuth = create<AuthState>((set, get) => ({
  status: 'loading',
  user: null,

  /** Au démarrage : restaure la session à partir du refresh token stocké. */
  bootstrap: async () => {
    if (!(await api.hasSession()) || !(await api.refresh())) {
      set({ status: 'signedOut', user: null });
      return;
    }
    try {
      const user = await api.request<MeUser>('/users/me');
      set({ status: 'signedIn', user });
    } catch {
      set({ status: 'signedOut', user: null });
    }
  },

  login: async (email, password) => {
    const res = await api.request<{ user: MeUser; tokens: AuthTokens }>('/auth/login', {
      method: 'POST',
      body: { email, password },
      auth: false,
    });
    await api.setTokens(res.tokens);
    set({ status: 'signedIn', user: res.user });
  },

  register: async (input) => {
    const res = await api.request<{ user: MeUser; tokens: AuthTokens }>('/auth/register', {
      method: 'POST',
      body: input,
      auth: false,
    });
    await api.setTokens(res.tokens);
    set({ status: 'signedIn', user: res.user });
  },

  refreshMe: async () => {
    const user = await api.request<MeUser>('/users/me');
    set({ user });
  },

  setUser: (user) => set({ user }),

  logout: async () => {
    if (get().status === 'signedIn') await unregisterPushToken().catch(() => undefined);
    disconnectSocket();
    await api.logout();
    set({ status: 'signedOut', user: null });
  },

  reset: () => {
    disconnectSocket();
    void api.clear();
    set({ status: 'signedOut', user: null });
  },
}));

onSessionExpired(() => useAuth.getState().reset());
