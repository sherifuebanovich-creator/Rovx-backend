'use client';
import { useSession } from 'next-auth/react';
import { useEffect, useRef } from 'react';
import { useAuthStore } from '@/store/auth.store';
import { api, usersApi } from '@/lib/api';
import Cookies from 'js-cookie';

export function SessionSync() {
  const { data: session, status } = useSession();
  const { setUser, setTokens, user: storeUser } = useAuthStore();
  const syncedRef = useRef(false);
  const langAppliedRef = useRef(false);
  const sessionRef = useRef(session);

  useEffect(() => {
    if (sessionRef.current === session && syncedRef.current) return;
    sessionRef.current = session;

    if (status === 'authenticated' && session) {
      const { accessToken: sessionToken, refreshToken, rovxUser } = session as any;
      const cookieToken = Cookies.get('access_token');
      const googleUser = (session as any).user;

      if (sessionToken && cookieToken !== sessionToken) {
        setTokens(sessionToken, refreshToken || '');
        if (!storeUser && rovxUser) {
          setUser({
            id: rovxUser.id || '',
            email: rovxUser.email || (session as any).user?.email || '',
            username: rovxUser.username || '',
            displayName: rovxUser.displayName || (session as any).user?.name || 'User',
            avatar: rovxUser.avatar || (session as any).user?.image || '',
            role: rovxUser.role || 'USER',
            subscription: rovxUser.subscription || 'FREE',
            preferredLang: rovxUser.preferredLang || 'ru',
            preferredVehicle: rovxUser.preferredVehicle || 'CAR',
            driverScore: rovxUser.driverScore ?? 5.0,
            reputation: rovxUser.reputation ?? 0,
            totalTrips: rovxUser.totalTrips ?? 0,
            totalDistance: rovxUser.totalDistance ?? 0,
          });
        }
      }

      if (!sessionToken && !rovxUser && googleUser?.email && !syncedRef.current) {
        const pendingLang = typeof window !== 'undefined' ? localStorage.getItem('pending_lang') : null;
        api.post('/auth/google', {
          email: googleUser.email,
          displayName: googleUser.name || '',
          avatar: googleUser.image || '',
          googleId: googleUser.id || googleUser.email,
          lang: pendingLang || 'en',
        }).then((res) => {
          const data = res.data?.data || res.data || {};
          const accessToken = data.accessToken || data.access_token;
          const newRefresh = data.refreshToken || data.refresh_token;
          const userData = data.user || data;
          if (accessToken) {
            setTokens(accessToken, newRefresh || '');
          }
          if (userData?.id) {
            setUser(userData);
          }
          syncedRef.current = true;
        }).catch(() => {
          syncedRef.current = true;
        });
        return;
      }

      if (rovxUser && !syncedRef.current) {
        setUser({
          id: rovxUser.id || storeUser?.id || '',
          email: rovxUser.email || storeUser?.email || (session as any).user?.email || '',
          username: rovxUser.username || storeUser?.username || '',
          displayName: rovxUser.displayName || rovxUser.username || storeUser?.displayName || (session as any).user?.name || 'User',
          avatar: rovxUser.avatar || storeUser?.avatar || (session as any).user?.image || '',
          role: rovxUser.role || storeUser?.role || 'USER',
          subscription: rovxUser.subscription || storeUser?.subscription || 'FREE',
          preferredLang: rovxUser.preferredLang || storeUser?.preferredLang || 'ru',
          preferredVehicle: rovxUser.preferredVehicle || storeUser?.preferredVehicle || 'CAR',
          driverScore: rovxUser.driverScore ?? storeUser?.driverScore ?? 5.0,
          reputation: rovxUser.reputation ?? storeUser?.reputation ?? 0,
          totalTrips: rovxUser.totalTrips ?? storeUser?.totalTrips ?? 0,
          totalDistance: rovxUser.totalDistance ?? storeUser?.totalDistance ?? 0,
          homeAddress: rovxUser.homeAddress || storeUser?.homeAddress,
          homeLat: rovxUser.homeLat || storeUser?.homeLat,
          homeLng: rovxUser.homeLng || storeUser?.homeLng,
          workAddress: rovxUser.workAddress || storeUser?.workAddress,
          workLat: rovxUser.workLat || storeUser?.workLat,
          workLng: rovxUser.workLng || storeUser?.workLng,
          city: rovxUser.city || storeUser?.city,
        });
        syncedRef.current = true;

        if (!langAppliedRef.current) {
          langAppliedRef.current = true;
          const pendingLang = typeof window !== 'undefined' ? localStorage.getItem('pending_lang') : null;
          if (pendingLang && pendingLang !== (rovxUser.preferredLang || 'ru')) {
            usersApi.updateProfile({ preferredLang: pendingLang }).then(() => {
              useAuthStore.setState((state) => ({
                user: state.user ? { ...state.user, preferredLang: pendingLang } : null,
              }));
            }).catch(() => {}).finally(() => {
              localStorage.removeItem('pending_lang');
            });
          } else if (pendingLang) {
            localStorage.removeItem('pending_lang');
          }
        }
      }
    }
    if (status === 'unauthenticated') {
      syncedRef.current = false;
      langAppliedRef.current = false;
    }
  }, [status, session, setTokens, setUser, storeUser]);

  return null;
}
