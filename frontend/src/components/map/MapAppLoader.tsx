'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import Cookies from 'js-cookie';
import { useAuthStore } from '@/store/auth.store';
import { useTranslation } from 'react-i18next';


function MapLoadingFallback() {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-center w-full h-dvh bg-dark-bg">
      <div className="flex flex-col items-center gap-4">
        <div className="relative w-16 h-16">
          <div className="absolute inset-0 rounded-full border-2 border-primary-500/30 animate-ping" />
          <div className="absolute inset-2 rounded-full border-2 border-primary-400/50 animate-pulse" />
          <div className="absolute inset-4 rounded-full bg-primary-500 animate-pulse" />
        </div>
        <div className="text-center">
          <p className="font-display text-xl font-bold text-gradient">{t('mapAppLoader.brand')}</p>
          <p className="text-sm text-gray-400 mt-1">{t('mapAppLoader.loading')}</p>
        </div>
      </div>
    </div>
  );
}

const MapApp = dynamic(() => import('@/components/map/MapApp'), {
  ssr: false,
  loading: () => <MapLoadingFallback />,
});

export default function MapAppLoader() {
  const { t } = useTranslation();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const check = () => {
      const hasToken = !!Cookies.get('access_token');
      if (useAuthStore.getState().isAuthenticated || useAuthStore.getState().user || hasToken) {
        setChecking(false);
        return true;
      }
      return false;
    };

    if (check()) return;

    const unsub = useAuthStore.subscribe((state) => {
      if (state.isAuthenticated || state.user) {
        setChecking(false);
        unsub();
      }
    });

    const hasStoredAuth = !!localStorage.getItem('rovx-auth');
    if (!hasStoredAuth) {
      setChecking(false);
    }

    return () => { unsub(); };
  }, []);

  if (checking) {
    return (
      <div className="flex items-center justify-center w-full h-dvh bg-dark-bg">
        <div className="flex flex-col items-center gap-4">
          <div className="relative w-16 h-16">
            <div className="absolute inset-0 rounded-full border-2 border-primary-500/30 animate-ping" />
            <div className="absolute inset-2 rounded-full border-2 border-primary-400/50 animate-pulse" />
            <div className="absolute inset-4 rounded-full bg-primary-500 animate-pulse" />
          </div>
          <div className="text-center">
            <p className="font-display text-xl font-bold text-gradient">{t('mapAppLoader.brand')}</p>
            <p className="text-sm text-gray-400 mt-1">{t('mapAppLoader.loadingRu')}</p>
          </div>
        </div>
      </div>
    );
  }

  return <MapApp />;
}
