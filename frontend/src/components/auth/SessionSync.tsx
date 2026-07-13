'use client';
import { useSession } from 'next-auth/react';
import { useEffect, useRef } from 'react';
import { useAuthStore } from '@/store/auth.store';
import Cookies from 'js-cookie';

export function SessionSync() {
  const { data: session, status } = useSession();
  const { setTokens } = useAuthStore();
  const syncedRef = useRef(false);
  const sessionRef = useRef(session);

  useEffect(() => {
    if (sessionRef.current === session && syncedRef.current) return;
    sessionRef.current = session;

    if (status === 'authenticated' && session) {
      const { accessToken: sessionToken } = session as any;
      const cookieToken = Cookies.get('access_token');

      // Sync token only when no access_token cookie exists (initial Google login or page reload).
      // Never overwrite: interceptor refresh writes fresh tokens via setTokens.
      if (sessionToken && !cookieToken) {
        setTokens(sessionToken, '');
      }

      if (!syncedRef.current) {
        syncedRef.current = true;
        // User data is fetched by initAuth → /auth/me
      }
    }
    if (status === 'unauthenticated') {
      syncedRef.current = false;
    }
  }, [status, session, setTokens]);

  return null;
}
