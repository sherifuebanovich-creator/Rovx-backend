'use client';
import { useSession } from 'next-auth/react';
import { useEffect, useRef } from 'react';
import { useAuthStore } from '@/store/auth.store';
import Cookies from 'js-cookie';

export function SessionSync() {
  const { data: session, status } = useSession();
  const { setTokens, initAuth } = useAuthStore();
  const syncedRef = useRef(false);
  const sessionRef = useRef(session);

  useEffect(() => {
    if (sessionRef.current === session && syncedRef.current) return;
    sessionRef.current = session;

    if (status === 'authenticated' && session) {
      const { accessToken: sessionToken } = session as any;
      const cookieToken = Cookies.get('access_token');

      if (sessionToken && !cookieToken) {
        setTokens(sessionToken, '');
        // AuthInit may have already bailed — re-trigger initAuth to fetch /auth/me
        setTimeout(() => { initAuth(); }, 100);
      }

      if (!syncedRef.current) {
        syncedRef.current = true;
      }
    }
    if (status === 'unauthenticated') {
      syncedRef.current = false;
    }
  }, [status, session, setTokens, initAuth]);

  return null;
}
