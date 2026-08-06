'use client';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { FaArrowLeft, FaRoute, FaMapMarkerAlt, FaClock, FaTimes, FaSpinner } from 'react-icons/fa';
import { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { routesApi } from '@/lib/api';
import { useMapStore } from '@/store/map.store';
import { useAuthStore } from '@/store/auth.store';

export default function RoutesPage() {
  const router = useRouter();
  const { t } = useTranslation();
  const { user } = useAuthStore();
  const [routes, setRoutes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setLoadError(false);
    routesApi.getSaved().then(res => {
      const rawData = res.data.data || res.data || [];
      const normalized = rawData.map((r: any) => ({
        id: r.id,
        name: r.name,
        from: r.originName || r.from || '',
        to: r.destName || r.to || '',
        distance: typeof r.distance === 'number' ? `${r.distance} ${t('routes.km')}` : r.distance || '',
        duration: typeof r.duration === 'number' ? `${r.duration} ${t('routes.min')}` : r.duration || '',
        originLat: r.originLat,
        originLng: r.originLng,
        destLat: r.destLat,
        destLng: r.destLng,
      }));
      setRoutes(normalized);
    }).catch(() => {
      // Was silently substituting 4 hardcoded demo routes here, with no
      // indication they weren't real — a transient network blip, an
      // expired token, or a Render cold-start timeout all looked
      // identical to "you have these saved routes," and deleting one of
      // the fake ones 404'd server-side with a confusing "failed to
      // remove" toast for a route the user never actually had.
      setLoadError(true);
    }).finally(() => setLoading(false));
  }, [t]);

  useEffect(() => {
    if (!user) { setLoading(false); return; }
    load();
  }, [load, user]);

  const deleteRoute = async (id: string) => {
    const previous = [...routes];
    setRoutes(r => r.filter(route => route.id !== id));
    try {
      await routesApi.deleteSaved(id);
      toast.success(t('routes.removed'));
    } catch {
      setRoutes(previous);
      toast.error(t('routes.removeFailed'));
    }
  };

  const handleSelectRoute = (route: any) => {
    if (route.originLat == null || route.destLat == null) {
      // Missing coordinates (legacy row) — just open the map instead of
      // trying to pre-fill an origin/destination we don't have.
      router.push('/');
      return;
    }
    useMapStore.setState({
      origin: { lat: route.originLat, lng: route.originLng, name: route.from },
      destination: { lat: route.destLat, lng: route.destLng, name: route.to },
      isRoutesPanelOpen: true,
    });
    router.push('/');
  };

  // Was falling through to the generic loadError branch below (a 401 from
  // getSaved() looks like any other fetch failure) — showed "Couldn't load
  // routes, try again" with a Retry button that just re-hit the same 401
  // forever, instead of the sign-in prompt every other guest-gated page
  // (Friends, Groups, Notifications, Profile, Voice Rooms) already shows.
  if (!user) {
    return (
      <div className="min-h-dvh bg-dark-bg flex flex-col items-center justify-center gap-4 px-6">
        <FaRoute size={48} className="text-gray-600" />
        <h2 className="text-white font-bold text-xl text-center">{t('routes.loginRequired')}</h2>
        <button onClick={() => router.push('/auth/login')} className="btn-primary px-6 py-3">{t('routes.signIn')}</button>
        <button onClick={() => router.back()} className="text-gray-400 text-sm">{t('routes.back')}</button>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-dark-bg">
      <div className="relative px-4 sm:px-6 pt-14 pb-safe-bottom pb-12 max-w-lg mx-auto">
        <button onClick={() => router.back()} className="flex items-center gap-2 text-gray-400 hover:text-white mb-6 transition-all">
          <FaArrowLeft size={14} /> {t('routes.back')}
        </button>
        <h1 className="text-2xl font-black text-white font-display mb-6">{t('routes.title')}</h1>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <FaSpinner size={24} className="text-primary-400 animate-spin" />
          </div>
        ) : loadError ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <FaRoute size={48} className="text-gray-600" />
            <p className="text-red-400 text-center">{t('routes.loadFailed')}</p>
            <button onClick={load} className="btn-primary px-6 py-3 mt-2">{t('routes.retry')}</button>
          </div>
        ) : routes.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <FaRoute size={48} className="text-gray-600" />
            <p className="text-gray-400 text-center">{t('routes.empty')}<br />{t('routes.hint')}</p>
            <button onClick={() => router.push('/')} className="btn-primary px-6 py-3 mt-2">{t('routes.openMap')}</button>
          </div>
        ) : (
          <div className="space-y-3">
            {routes.map((route, i) => (
              <motion.div key={route.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.07 }}
                onClick={() => handleSelectRoute(route)}
                className="card p-4 cursor-pointer hover:bg-white/10 hover:border-primary-500/30 transition-all">
                <div className="flex items-start justify-between gap-2 mb-3">
                  <h3 className="font-semibold text-white truncate flex-1 min-w-0">{route.name}</h3>
                  <button onClick={(e) => { e.stopPropagation(); deleteRoute(route.id); }} className="text-gray-600 hover:text-red-400 transition-all p-1.5 flex-shrink-0">
                    <FaTimes size={13} />
                  </button>
                </div>
                <div className="space-y-1.5 mb-3">
                  <div className="flex items-center gap-2 text-sm text-gray-400">
                    <FaMapMarkerAlt size={11} className="text-green-400" /> <span>{route.from}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-gray-400">
                    <FaMapMarkerAlt size={11} className="text-red-400" /> <span>{route.to}</span>
                  </div>
                </div>
                <div className="flex items-center gap-4 text-xs text-gray-500">
                  <span className="flex items-center gap-1"><FaRoute size={10} /> {route.distance}</span>
                  <span className="flex items-center gap-1"><FaClock size={10} /> {route.duration}</span>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
