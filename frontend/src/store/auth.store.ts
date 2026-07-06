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
        set({ accessToken, refreshToken, isAuthenticated: true });
        Cookies.set('access_token', accessToken, {
          expires: 1 / 96,
          path: '/',
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
        });
        Cookies.set('refresh_token', refreshToken, {
          expires: 30,
          path: '/',
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
        });
      },

      logout: () => {
        Cookies.remove('access_token', { path: '/' });
        Cookies.remove('refresh_token', { path: '/' });
        set({ user: null, isAuthenticated: false, preferences: null, accessToken: null, refreshToken: null });
      },

      setLoading: (isLoading) => set({ isLoading }),

      initAuth: async () => {
        const state = get();
        if (!state.accessToken && !Cookies.get('access_token')) {
          set({ isInitDone: true, isLoading: false });
          return;
        }
        const token = state.accessToken || Cookies.get('access_token');
        if (!token) {
          set({ isInitDone: true, isLoading: false });
          return;
        }
        set({ isLoading: true });
        try {
          const api = (await import('@/lib/api')).default;
          const res = await api.get('/auth/me');
          const payload = res.data?.data || res.data || {};
          const userData = payload.user || payload;
          if (userData?.id) {
            set({ user: userData, isAuthenticated: true, isLoading: false, isInitDone: true });
          } else {
            set({ isInitDone: true, isLoading: false });
          }
        } catch {
          const refreshToken = state.refreshToken || Cookies.get('refresh_token');
          if (refreshToken) {
            try {
              const api = (await import('@/lib/api')).default;
              const res = await api.post('/auth/refresh', null, {
                headers: { 'x-refresh-token': refreshToken },
              });
              const payload = res.data?.data || res.data || {};
              const newAccess = payload.accessToken || payload.access_token;
              const newRefresh = payload.refreshToken || payload.refresh_token;
              if (newAccess) {
                get().setTokens(newAccess, newRefresh || refreshToken);
                set({ isInitDone: true, isLoading: false });
                return;
              }
            } catch {}
          }
          get().logout();
          set({ isInitDone: true, isLoading: false });
        }
      },
    }),
    {
      name: 'rovx-auth',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ user: state.user, isAuthenticated: state.isAuthenticated, preferences: state.preferences }),
    },
  ),
);
