import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import Cookies from 'js-cookie';
import { User, UserPreferences } from '@/types';

interface AuthState {
  user: User | null;
  preferences: UserPreferences | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  isInitDone: boolean;
  accessToken: string | null;
  refreshToken: string | null;
  setUser: (user: User | null) => void;
  setPreferences: (prefs: UserPreferences) => void;
  setTokens: (accessToken: string, refreshToken: string) => void;
  logout: () => void;
  setLoading: (loading: boolean) => void;
  initAuth: () => Promise<void>;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      preferences: null,
      isAuthenticated: false,
      isLoading: false,
      isInitDone: false,
      accessToken: null,
      refreshToken: null,

      setUser: (user) => set({ user, isAuthenticated: !!user }),

      setPreferences: (preferences) => set({ preferences }),

      setTokens: (accessToken, refreshToken) => {
        if (!accessToken) return;
        set((state) => ({
          accessToken,
          refreshToken: refreshToken || state.refreshToken || '',
          isAuthenticated: true,
        }));
        Cookies.set('access_token', accessToken, {
          expires: 30,
          path: '/',
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
        });
      },

      logout: () => {
        Cookies.remove('access_token', { path: '/' });
        try { localStorage.removeItem('rovx-auth'); } catch {}
        set({ user: null, isAuthenticated: false, preferences: null, accessToken: null, refreshToken: null });
      },

      setLoading: (isLoading) => set({ isLoading }),

      initAuth: async () => {
        const state = get();
        const cookieToken = Cookies.get('access_token');
        if (!state.accessToken && !cookieToken) {
          set({ isInitDone: true, isLoading: false });
          return;
        }
        const token = state.accessToken || cookieToken;
        if (!token) {
          set({ isInitDone: true, isLoading: false });
          return;
        }
        set({ isLoading: true });
        try {
          const api = (await import('@/lib/api')).default;
          const res = await api.get('/auth/me', { _skipAuthRedirect: true } as any);
          const raw = res.data;
          const payload = raw?.data ?? raw;
          const inner = payload?.data ?? payload;
          const userData = inner?.user || payload?.user || inner;
          if (userData?.id) {
            set({ user: userData, isAuthenticated: true, isLoading: false, isInitDone: true });
            // Apply pending language preference from registration/Google login
            const pendingLang = typeof window !== 'undefined' ? localStorage.getItem('pending_lang') : null;
            if (pendingLang && pendingLang !== (userData.preferredLang || 'ru')) {
              try {
                const usersApiMod = (await import('@/lib/api')).usersApi;
                await usersApiMod.updateProfile({ preferredLang: pendingLang });
                set((state) => ({
                  user: state.user ? { ...state.user, preferredLang: pendingLang } : null,
                }));
              } catch {} finally {
                localStorage.removeItem('pending_lang');
              }
            } else if (pendingLang) {
              localStorage.removeItem('pending_lang');
            }
          } else {
            set({ isInitDone: true, isLoading: false });
          }
        } catch (err: any) {
          const status = err?.response?.status;
          if (status === 401) {
            try {
              const BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';
              const storedRefresh = get().refreshToken;
              const axiosMod = (await import('axios')).default;
              let res;
              try {
                res = await axiosMod.post(`${BASE_URL}/auth/refresh`, null, {
                  withCredentials: true,
                  headers: {
                    'Content-Type': 'application/json',
                    ...(storedRefresh ? { 'x-refresh-token': storedRefresh } : {}),
                  },
                });
              } catch (firstErr: any) {
                if (firstErr?.response?.status >= 500 || !firstErr?.response) {
                  await new Promise(r => setTimeout(r, 1500));
                  res = await axiosMod.post(`${BASE_URL}/auth/refresh`, null, {
                    withCredentials: true,
                    headers: {
                      'Content-Type': 'application/json',
                      ...(storedRefresh ? { 'x-refresh-token': storedRefresh } : {}),
                    },
                  });
                } else {
                  throw firstErr;
                }
              }
              const raw = res.data;
              const payload = raw?.data ?? raw;
              const inner = payload?.data ?? payload;
              const newAccess = payload?.accessToken || payload?.access_token || inner?.accessToken || inner?.access_token;
              if (newAccess) {
                get().setTokens(newAccess, payload?.refreshToken || inner?.refreshToken || '');
                set({ isInitDone: true, isLoading: false });
                return;
              }
            } catch {}
            get().logout();
          }
          set({ isInitDone: true, isLoading: false });
        }
      },
    }),
    {
      name: 'rovx-auth',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ user: state.user, isAuthenticated: state.isAuthenticated, preferences: state.preferences, refreshToken: state.refreshToken }),
    },
  ),
);
