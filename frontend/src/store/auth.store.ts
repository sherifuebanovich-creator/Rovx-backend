import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import Cookies from 'js-cookie';
import { User, UserPreferences } from '@/types';

// api.ts's 401-retry interceptor rotates the refresh token by writing
// straight to localStorage, bypassing this store entirely — so the
// in-memory `refreshToken` field can be stale. Anywhere a fallback is
// needed, read the freshest value from localStorage, not the Zustand state.
function readStoredRefreshToken(): string | null {
  try { return JSON.parse(localStorage.getItem('rovx-auth') || '{}')?.state?.refreshToken || null; } catch { return null; }
}

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
        // A refresh response commonly omits refreshToken when it's
        // unchanged/cookie-only. Falling back to `state.refreshToken` (the
        // in-memory copy) here could overwrite a token already rotated by
        // api.ts's interceptor with a stale one — localStorage is the
        // source of truth for whichever path rotated it last.
        set((state) => ({
          accessToken,
          refreshToken: refreshToken || readStoredRefreshToken() || state.refreshToken || '',
          isAuthenticated: true,
        }));
        Cookies.set('access_token', accessToken, {
          // Matches the access token's actual ~15min lifetime (same value
          // api.ts's refresh path uses) — this was set to 30 days, so a
          // stale cookie could linger in the browser far longer than the
          // JWT inside it was ever valid for.
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
        // Trip/route/friend-marker state must not survive into the next
        // signed-in session on this device — otherwise it can leak between
        // users sharing a browser (stale trip id used with the new user's
        // token, previous user's friend locations shown, etc.).
        import('./map.store').then(({ useMapStore }) => useMapStore.getState().resetSession());
      },

      setLoading: (isLoading) => set({ isLoading }),

      initAuth: async () => {
        const state = get();
        const cookieToken = Cookies.get('access_token');
        // Re-read from localStorage on every attempt (not just once, and not
        // only from the Zustand store — api.ts's own refresh path writes
        // straight to localStorage without going through this store). If a
        // concurrent refresh from that other path wins and rotates the token
        // first, this picks up the new value instead of a stale one.
        const readStoredRefresh = readStoredRefreshToken;

        // 'ok' — session restored; 'invalid' — server rejected the refresh
        // token (real logout); 'network' — backend unreachable (Render cold
        // start etc.), keep the persisted session and try again later.
        const doRefresh = async (): Promise<'ok' | 'invalid' | 'network'> => {
          try {
            const BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';
            const axiosMod = (await import('axios')).default;
            const getRefreshHeaders = () => {
              const storedRefresh = readStoredRefresh() || get().refreshToken;
              return {
                'Content-Type': 'application/json',
                ...(storedRefresh ? { 'x-refresh-token': storedRefresh } : {}),
              };
            };
            let res;
            try {
              res = await axiosMod.post(`${BASE_URL}/auth/refresh`, null, {
                withCredentials: true,
                headers: getRefreshHeaders(),
              });
            } catch (firstErr: any) {
              // 409 = another in-flight request is already rotating this
              // token (backend redis lock) — the session is fine, just
              // retry shortly instead of treating it as an invalid token.
              if (firstErr?.response?.status >= 500 || firstErr?.response?.status === 409 || !firstErr?.response) {
                await new Promise(r => setTimeout(r, 1500));
                res = await axiosMod.post(`${BASE_URL}/auth/refresh`, null, {
                  withCredentials: true,
                  headers: getRefreshHeaders(),
                });
              } else {
                throw firstErr;
              }
            }
            const raw = res.data;
            const payload = raw?.data ?? raw;
            const inner = payload?.data ?? payload;
            const newAccess = payload?.accessToken || payload?.access_token || inner?.accessToken || inner?.access_token;
            if (!newAccess) return 'invalid';
            get().setTokens(newAccess, payload?.refreshToken || inner?.refreshToken || '');
            return 'ok';
          } catch (e: any) {
            const st = e?.response?.status;
            if (st === 400 || st === 401 || st === 403) return 'invalid';
            return 'network';
          }
        };

        const fetchMe = async (): Promise<void> => {
          const api = (await import('@/lib/api')).default;
          const res = await api.get('/auth/me', { _skipAuthRedirect: true } as any);
          const raw = res.data;
          const payload = raw?.data ?? raw;
          const inner = payload?.data ?? payload;
          const userData = inner?.user || payload?.user || inner;
          if (userData?.id) {
            set({ user: userData, isAuthenticated: true });
            // Apply pending language preference from registration/Google login
            const pendingLang = typeof window !== 'undefined' ? localStorage.getItem('pending_lang') : null;
            if (pendingLang && pendingLang !== (userData.preferredLang || 'ru')) {
              try {
                const usersApiMod = (await import('@/lib/api')).usersApi;
                await usersApiMod.updateProfile({ preferredLang: pendingLang });
                set((s) => ({
                  user: s.user ? { ...s.user, preferredLang: pendingLang } : null,
                }));
              } catch {} finally {
                localStorage.removeItem('pending_lang');
              }
            } else if (pendingLang) {
              localStorage.removeItem('pending_lang');
            }
          }
        };

        const token = state.accessToken || cookieToken;
        const hasRefresh = !!(state.refreshToken || readStoredRefresh());

        if (!token && !hasRefresh) {
          set({ isInitDone: true, isLoading: false });
          return;
        }

        set({ isLoading: true });

        // Cold start after the browser was closed: the short-lived access
        // token is gone but the long-lived refresh token survived in
        // localStorage — restore the session silently so the user stays
        // signed in across visits on this device.
        if (!token) {
          const r = await doRefresh();
          if (r === 'ok') {
            try { await fetchMe(); } catch {}
          } else if (r === 'invalid') {
            get().logout();
          }
          set({ isInitDone: true, isLoading: false });
          return;
        }

        try {
          await fetchMe();
          set({ isInitDone: true, isLoading: false });
        } catch (err: any) {
          const status = err?.response?.status;
          if (status === 401) {
            const r = await doRefresh();
            if (r === 'ok') {
              try { await fetchMe(); } catch {}
              set({ isInitDone: true, isLoading: false });
              return;
            }
            if (r === 'invalid') {
              get().logout();
            }
          }
          set({ isInitDone: true, isLoading: false });
        }
      },
    }),
    {
      name: 'rovx-auth',
      storage: createJSONStorage(() => localStorage),
      // `user.avatar` can be a multi-hundred-KB base64 data: URI (self-hosted
      // avatars are stored inline, see users.controller.ts) — persisting the
      // full user object wrote that into localStorage on every change,
      // bloating it for no benefit: initAuth() re-fetches the full profile
      // (avatar included) from /auth/me on every load anyway, so nothing
      // actually reads the persisted copy before it's overwritten.
      partialize: (state) => ({
        user: state.user ? { ...state.user, avatar: undefined } : state.user,
        isAuthenticated: state.isAuthenticated,
        preferences: state.preferences,
        refreshToken: state.refreshToken,
      }),
    },
  ),
);
