'use client';
import { FaSearch, FaBars, FaBell, FaSun, FaMoon, FaCube, FaLayerGroup, FaSatellite, FaCrosshairs } from 'react-icons/fa';
import { useMapStore } from '@/store/map.store';
import { useAuthStore } from '@/store/auth.store';
import { motion } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { useState, useEffect, useCallback } from 'react';
import { socialApi } from '@/lib/api';
import { useTranslation } from 'react-i18next';
import { getSocket } from '@/hooks/useSocket';


export function TopBar() {
  const { t } = useTranslation();
  const toggleSearch = useMapStore(s => s.toggleSearch);
  const toggleSidebar = useMapStore(s => s.toggleSidebar);
  const destination = useMapStore(s => s.destination);
  const origin = useMapStore(s => s.origin);
  const mapStyle = useMapStore(s => s.mapStyle);
  const setMapStyle = useMapStore(s => s.setMapStyle);
  const darkMode = useMapStore(s => s.darkMode);
  const setDarkMode = useMapStore(s => s.setDarkMode);
  const userLocation = useMapStore(s => s.userLocation);
  const setMapCenter = useMapStore(s => s.setMapCenter);
  const setFollowUser = useMapStore(s => s.setFollowUser);
  const show3D = useMapStore(s => s.show3D);
  const { user } = useAuthStore();
  const router = useRouter();
  const hasRoute = origin && destination;
  const [hasUnread, setHasUnread] = useState(false);
  const [showModeMenu, setShowModeMenu] = useState(false);

  const checkUnread = useCallback(() => {
    if (!user) return;
    socialApi.getNotifications(1).then((res) => {
      const data = res.data;
      const notifs = data?.data?.notifications || data?.data || data?.notifications || data || [];
      const arr = Array.isArray(notifs) ? notifs : [];
      setHasUnread(arr.some((n: any) => !n.isRead));
    }).catch(() => {});
  }, [user]);

  useEffect(() => {
    checkUnread();
  }, [checkUnread]);

  useEffect(() => {
    if (!user) return;
    const onNotification = () => {
      checkUnread();
    };
    // The global socket may not exist yet at mount (its creation is driven
    // by a separate auth-state effect elsewhere) — poll briefly instead of
    // giving up, otherwise the unread badge never receives live updates
    // for this mount's lifetime.
    let socket = getSocket();
    let interval: ReturnType<typeof setInterval> | null = null;
    if (socket) {
      socket.on('notification:new', onNotification);
    } else {
      interval = setInterval(() => {
        socket = getSocket();
        if (socket) {
          socket.on('notification:new', onNotification);
          if (interval) clearInterval(interval);
        }
      }, 500);
    }
    return () => {
      if (interval) clearInterval(interval);
      socket?.off('notification:new', onNotification);
    };
  }, [user, checkUnread]);

  const mapModes = [
    { key: 'streets', label: t('topbar.style2d'), icon: <FaLayerGroup size={13} /> },
    { key: 'satellite', label: t('topbar.satellite'), icon: <FaSatellite size={13} /> },
  ] as const;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="absolute top-0 left-0 right-0 z-40 safe-top flex justify-center">
        <div className="px-2 sm:px-4 pt-2 sm:pt-3 pb-2 w-full max-w-5xl">
        <div className="flex items-center gap-1 sm:gap-2">
          <button onClick={toggleSidebar}
            className="flex-shrink-0 w-9 sm:w-10 h-9 sm:h-10 glass-dark rounded-xl flex items-center justify-center hover:bg-white/10 active:scale-95 transition-all">
            <FaBars size={14} className="text-gray-300" />
          </button>

          <button onClick={toggleSearch}
            className="flex-1 glass-dark rounded-xl flex items-center gap-2 sm:gap-3 px-3 sm:px-4 h-9 sm:h-10 hover:bg-white/10 active:scale-95 transition-all text-left">
            <FaSearch size={12} className="text-primary-400 flex-shrink-0" />
            {hasRoute ? (
              <div className="flex-1 min-w-0 hidden xs:block">
                <p className="text-[10px] sm:text-xs text-gray-400 leading-none">{t('topbar.to')}</p>
                <p className="text-xs sm:text-sm text-white truncate">{destination?.name}</p>
              </div>
            ) : (
              <span className="text-xs sm:text-sm text-gray-400 truncate">{t('topbar.whereTo')}</span>
            )}
          </button>

          {/* Map mode selector */}
          <div className="relative">
            <button
              onClick={() => setShowModeMenu(!showModeMenu)}
              className="flex-shrink-0 w-9 sm:w-10 h-9 sm:h-10 glass-dark rounded-xl flex items-center justify-center hover:bg-white/10 active:scale-95 transition-all"
              title={t('topbar.mapMode')}
            >
              <FaCube size={13} className="text-primary-400" />
            </button>
            {showModeMenu && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowModeMenu(false)} />
                <div className="absolute right-0 top-12 z-20 glass-dark rounded-2xl p-2 min-w-[180px] shadow-2xl border border-dark-border">
                  <p className="text-[10px] text-gray-500 uppercase font-bold px-3 py-1.5 tracking-wider">{t('topbar.mapMode')}</p>
                  {mapModes.map((mode) => (
                    <button
                      key={mode.key}
                      onClick={() => { setMapStyle(mode.key as any); setShowModeMenu(false); }}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all text-left ${
                        mapStyle === mode.key ? 'bg-primary-600/20 text-primary-300' : 'text-gray-300 hover:bg-white/5'
                      }`}
                    >
                      {mode.icon}
                      {mode.label}
                      {mode.key === 'satellite' ? '' : (
                        <span className="text-[10px] text-gray-500 ml-auto">{t('topbar.style3d')}</span>
                      )}
                    </button>
                  ))}
                  <div className="border-t border-dark-border my-1.5 mx-2" />
                  <p className="text-[10px] text-gray-500 uppercase font-bold px-3 py-1.5 tracking-wider">{t('topbar.view')}</p>
                  <button
                    onClick={() => {
                      useMapStore.getState().toggle3D();
                      setShowModeMenu(false);
                    }}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all text-left ${
                      show3D && mapStyle !== 'satellite' ? 'bg-primary-600/20 text-primary-300' : 'text-gray-300 hover:bg-white/5'
                    }`}
                  >
                    <FaCube size={13} />
                    {t('topbar.view3dBuildings')}
                  </button>
                </div>
              </>
            )}
          </div>

          {/* My location */}
          <button
            onClick={() => {
              if (userLocation) {
                setMapCenter({ lat: userLocation.lat, lng: userLocation.lng }, 16);
                setFollowUser(true);
              }
            }}
            className={`flex-shrink-0 w-9 sm:w-10 h-9 sm:h-10 glass-dark rounded-xl flex items-center justify-center hover:bg-white/10 active:scale-95 transition-all ${userLocation ? 'text-primary-400' : 'text-gray-600'}`}
            title={t('topbar.myLocation')}
          >
            <FaCrosshairs size={13} />
          </button>

          {/* Theme toggle */}
          <button
            onClick={() => {
              const next = !darkMode;
              setDarkMode(next);
              document.documentElement.classList.toggle('dark', next);
              localStorage.setItem('darkMode', String(next));
              if (next && mapStyle === 'streets') setMapStyle('night');
              else if (!next && mapStyle === 'night') setMapStyle('streets');
            }}
            className="flex-shrink-0 w-9 sm:w-10 h-9 sm:h-10 glass-dark rounded-xl flex items-center justify-center hover:bg-white/10 active:scale-95 transition-all"
            title={darkMode ? t('topbar.lightTheme') : t('topbar.darkTheme')}
          >
            {darkMode ? <FaSun size={13} className="text-yellow-400" /> : <FaMoon size={13} className="text-gray-300" />}
          </button>

          {/* Notifications */}
          <button onClick={() => router.push('/notifications')}
            className="flex-shrink-0 w-9 sm:w-10 h-9 sm:h-10 glass-dark rounded-xl flex items-center justify-center hover:bg-white/10 active:scale-95 transition-all relative">
            <FaBell size={14} className="text-gray-300" />
            {hasUnread && <span className="absolute top-1.5 right-1.5 w-2 h-2.5 bg-accent-500 rounded-full animate-pulse" />}
          </button>
        </div>
      </div>
    </motion.div>
  );
}
