'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
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
    const done = () => setChecking(false);

    // Wait for auth initialization to complete before making any decision
    const unsub = useAuthStore.subscribe((state) => {
      if (!state.isInitDone) return;
      // Init done — show map regardless of auth (map is accessible without login)
      done();
      unsub();
    });

    // If already initialized, show immediately
    const st = useAuthStore.getState();
    if (st.isInitDone) {
      done();
      unsub();
      return;
    }

    // Safety net — if initAuth never resolves (e.g. no token + network issue), show after 6s
    const timer = setTimeout(done, 6000);

    return () => { unsub(); clearTimeout(timer); };
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
            <p className="text-sm text-gray-400 mt-1">{t('mapAppLoader.loading')}</p>
          </div>
        </div>
      </div>
    );
  }

  return <MapApp />;
}
