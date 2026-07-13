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
        set({ accessToken, refreshToken: refreshToken || '', isAuthenticated: true });
        Cookies.set('access_token', accessToken, {
          expires: 1 / 96,
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
          } else {
            set({ isInitDone: true, isLoading: false });
          }
        } catch (err: any) {
          const status = err?.response?.status;
          if (status === 401) {
            try {
              const api = (await import('@/lib/api')).default;
              const storedRefresh = get().refreshToken;
              const res = await api.post('/auth/refresh', null, {
                withCredentials: true,
                headers: storedRefresh ? { 'x-refresh-token': storedRefresh } : {},
              });
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
