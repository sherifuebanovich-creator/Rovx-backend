'use client';
import { useSession } from 'next-auth/react';
import { useEffect, useRef } from 'react';
import { useAuthStore } from '@/store/auth.store';

export function SessionSync() {
  const { data: session, status } = useSession();
  const { setTokens, initAuth, accessToken } = useAuthStore();
  const syncedRef = useRef(false);
  const sessionRef = useRef(session);

  useEffect(() => {
    if (sessionRef.current === session && syncedRef.current) return;
    sessionRef.current = session;

    if (status === 'authenticated' && session) {
      const { accessToken: sessionToken } = session as any;

      // Compare against the store's own token, not cookie *presence* — a
      // leftover access_token cookie from a previous/different session
      // (stale, expired, or a different account) would otherwise block
      // this sync forever and leave the app running on the wrong token
      // after a fresh Google sign-in.
      if (sessionToken && sessionToken !== accessToken) {
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
  }, [status, session, setTokens, initAuth, accessToken]);

  return null;
}
