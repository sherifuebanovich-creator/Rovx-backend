'use client';
import { useSession } from 'next-auth/react';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { useAuthStore } from '@/store/auth.store';

export function SessionSync() {
  const { data: session, status } = useSession();
  const { t } = useTranslation();
  const { setTokens, initAuth, accessToken } = useAuthStore();
  const syncedRef = useRef(false);
  const sessionRef = useRef(session);
  const erroredRef = useRef(false);

  useEffect(() => {
    if (sessionRef.current === session && syncedRef.current) return;
    sessionRef.current = session;

    if (status === 'authenticated' && session) {
      const { accessToken: sessionToken, error } = session as any;

      // Compare against the store's own token, not cookie *presence* — a
      // leftover access_token cookie from a previous/different session
      // (stale, expired, or a different account) would otherwise block
      // this sync forever and leave the app running on the wrong token
      // after a fresh Google sign-in.
      if (sessionToken && sessionToken !== accessToken) {
        setTokens(sessionToken, '');
        // AuthInit may have already bailed — re-trigger initAuth to fetch /auth/me
        setTimeout(() => { initAuth(); }, 100);
        erroredRef.current = false;
      } else if (error && !erroredRef.current) {
        // Google login itself succeeded but our backend never confirmed it
        // (e.g. it was still waking up) — say so instead of quietly landing
        // the user on the map as a guest.
        erroredRef.current = true;
        toast.error(t('auth.errors.backendSyncFailed') || 'Не удалось завершить вход. Попробуйте войти через Google ещё раз.');
      }

      if (!syncedRef.current) {
        syncedRef.current = true;
      }
    }
    if (status === 'unauthenticated') {
      syncedRef.current = false;
      erroredRef.current = false;
    }
  }, [status, session, setTokens, initAuth, accessToken, t]);

  return null;
}
