'use client';
import { useEffect, useCallback, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FaChevronRight, FaTimes, FaVolumeMute, FaVolumeUp } from 'react-icons/fa';
import { useMapStore } from '@/store/map.store';
import { useVoiceAssistant } from '@/hooks/useVoiceAssistant';
import { useTranslation } from 'react-i18next';
import { mapApi } from '@/lib/api';
import {
  SpeedCamera, createSpeedCameraMonitor, buildCameraWarningMessage,
  buildCameraAlertText, SpeedCameraMonitor,
} from '@/lib/speedCameraMonitor';

export function NavigationHUD() {
  const navigation = useMapStore(s => s.navigation);
  const selectedRoute = useMapStore(s => s.selectedRoute);
  const destination = useMapStore(s => s.destination);
  const setNavigation = useMapStore(s => s.setNavigation);
  const userLocation = useMapStore(s => s.userLocation);
  const userHeading = useMapStore(s => s.userHeading);
  const userSpeed = useMapStore(s => s.userSpeed);
  const isAiCoDriverEnabled = useMapStore(s => s.isAiCoDriverEnabled);
  const setAiCoDriver = useMapStore(s => s.setAiCoDriver);
  const clearRoute = useMapStore(s => s.clearRoute);
  const { speak } = useVoiceAssistant();
  const { t, i18n } = useTranslation();

  const monitorRef = useRef<SpeedCameraMonitor | null>(null);
  const [cameraWarning, setCameraWarning] = useState<ReturnType<typeof buildCameraAlertText> | null>(null);
  const warningTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const userLocationRef = useRef(userLocation);
  const userHeadingRef = useRef(userHeading);
  const userSpeedRef = useRef(userSpeed);
  userLocationRef.current = userLocation;
  userHeadingRef.current = userHeading;
  userSpeedRef.current = userSpeed;

  // Init monitor
  useEffect(() => {
    if (!monitorRef.current) {
      monitorRef.current = createSpeedCameraMonitor();
    }
    const mon = monitorRef.current;

    mapApi.getObjects({ categories: 'SPEED_CAMERA', limit: 500, minLat: -90, maxLat: 90, minLng: -180, maxLng: 180 })
      .then(res => {
        const objects: any[] = res.data.data || res.data || [];
        const cameras: SpeedCamera[] = objects.map((o: any) => ({
          id: o.id, lat: o.lat, lng: o.lng, name: o.name || '',
          cameraType: (o.data?.cameraType || 'STATIONARY') as any,
          maxSpeed: o.data?.maxSpeed || undefined,
          direction: o.data?.direction || undefined,
        }));
        mon.setCameras(cameras);
      })
      .catch(() => {});

    return () => { mon.setCameras([]); };
  }, []);

  // Load OSM cameras when user location changes
  useEffect(() => {
    if (!userLocation) return;
    mapApi.getSpeedCameras(userLocation.lat, userLocation.lng, 50)
      .then(res => {
        const osmCameras: any[] = res.data.data || res.data || [];
        const mon = monitorRef.current;
        if (mon) {
          const existing = mon.getCameras();
          const dbCameras = existing.filter(c => !c.id.startsWith('osm-cam-'));
          mon.setCameras([...dbCameras, ...osmCameras]);
        }
      })
      .catch(() => {});
  }, [userLocation?.lat, userLocation?.lng]);

  // Update position
  useEffect(() => {
    const mon = monitorRef.current;
    if (!mon || !userLocation) return;
    mon.updatePosition(userLocation.lat, userLocation.lng, userHeading, userSpeed);
  }, [userLocation?.lat, userLocation?.lng, userHeading, userSpeed]);

  // Periodic camera check + OSM refresh (always, even without active navigation)
  useEffect(() => {
    if (!userLocation) return;

    let osmLoadCount = 0;

    const interval = setInterval(() => {
      const mon = monitorRef.current;
      const loc = userLocationRef.current;
      const heading = userHeadingRef.current;
      const speed = userSpeedRef.current;
      if (!mon || !loc) return;

      // Refresh OSM cameras every 30s
      osmLoadCount++;
      if (osmLoadCount % 30 === 0) {
        mapApi.getSpeedCameras(loc.lat, loc.lng, 50)
          .then(res => {
            const osmCameras: any[] = res.data.data || res.data || [];
            const existing = mon.getCameras();
            const dbCameras = existing.filter(c => !c.id.startsWith('osm-cam-'));
            mon.setCameras([...dbCameras, ...osmCameras]);
          })
          .catch(() => {});
      }

      mon.updatePosition(loc.lat, loc.lng, heading, speed);
      const warning = mon.checkProximity();

      if (warning) {
        mon.markWarned(warning.camera.id);
        const lang = i18n.language || 'ru';
        const msg = buildCameraWarningMessage(warning.camera, warning.distanceMeters, lang);
        speak(msg, true);

        const alert = buildCameraAlertText(warning.camera, warning.distanceMeters, lang);
        setCameraWarning(alert);

        if (warningTimeoutRef.current) clearTimeout(warningTimeoutRef.current);
        warningTimeoutRef.current = setTimeout(() => {
          setCameraWarning(null);
        }, 8000);
      }
    }, 1000);

    return () => { clearInterval(interval); };
  }, [navigation.isNavigating, i18n.language, speak]);

  const formatDistance = (meters: number) => {
    if (meters >= 1000) return `${(meters / 1000).toFixed(1)} ${t('navigationHud.km')}`;
    if (meters >= 100) return `${Math.round(meters / 10) * 10} ${t('navigationHud.m')}`;
    return `${Math.round(meters)} ${t('navigationHud.m')}`;
  };

  const getTurnIcon = (type: string) => {
    const icons: Record<string, string> = {
      turn_left: '↰', turn_right: '↱', continue: '↑', arrive: '🏁',
      depart: '▶', roundabout: '↻', merge: '↗', ramp: '↗', fork: '⑂',
      default: '↑',
    };
    return icons[type] || icons.default;
  };

  const getRemainingDistance = useCallback(() => {
    if (!selectedRoute || !userLocation) return null;
    const { polyline } = selectedRoute;
    if (!polyline?.length) return null;

    let minDist = Infinity;
    let closestIdx = 0;
    polyline?.forEach((pt, i) => {
      const d = Math.hypot(pt.lat - userLocation.lat, pt.lng - userLocation.lng);
      if (d < minDist) { minDist = d; closestIdx = i; }
    });

    const remaining = polyline.slice(closestIdx);
    let totalDist = 0;
    for (let i = 1; i < remaining.length; i++) {
      const dLat = (remaining[i].lat - remaining[i - 1].lat) * Math.PI / 180;
      const dLon = (remaining[i].lng - remaining[i - 1].lng) * Math.PI / 180;
      const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(remaining[i - 1].lat * Math.PI / 180) *
        Math.cos(remaining[i].lat * Math.PI / 180) *
        Math.sin(dLon / 2) ** 2;
      totalDist += 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }
    return totalDist;
  }, [selectedRoute, userLocation]);

  const remainingDist = getRemainingDistance();
  const plannedAvgSpeed = selectedRoute && selectedRoute.duration > 0
    ? selectedRoute.distance / (selectedRoute.duration / 60)
    : 80;
  const currentAvgSpeed = userSpeed > 5
    ? userSpeed
    : plannedAvgSpeed;
  const remainingMin = remainingDist
    ? Math.round((remainingDist / 1000) / currentAvgSpeed * 60)
    : null;

  const instructions = selectedRoute?.instructions || [];
  const currentLeg = Math.min(navigation.currentLeg ?? 0, instructions.length - 1);
  const currentInstruction = instructions[currentLeg] || null;

  // Cleanup warning timeout
  useEffect(() => {
    return () => { if (warningTimeoutRef.current) clearTimeout(warningTimeoutRef.current); };
  }, []);

  return (
    <div className="fixed inset-0 z-50 pointer-events-none">
      {/* Camera warning overlay */}
      <AnimatePresence>
        {cameraWarning && (
          <motion.div
            initial={{ opacity: 0, y: -30 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -30 }}
            className="absolute top-24 left-4 right-4 pointer-events-auto z-10"
          >
            <div className="bg-red-600/90 backdrop-blur-xl rounded-2xl px-4 py-3 border border-red-400/30 shadow-2xl">
              <div className="flex items-center gap-3">
                <div className="text-3xl">{cameraWarning.title.split(' ')[0]}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-base font-bold text-white">{cameraWarning.title}</p>
                  <p className="text-xs text-red-200">{cameraWarning.subtitle}</p>
                  {cameraWarning.desc && (
                    <p className="text-xs text-red-300/70 mt-0.5">{cameraWarning.desc}</p>
                  )}
                </div>
                <button
                  onClick={() => setCameraWarning(null)}
                  className="w-7 h-7 rounded-lg bg-white/10 flex items-center justify-center hover:bg-white/20 transition-all"
                >
                  <FaTimes size={10} className="text-white/70" />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main instruction banner */}
      <motion.div
        initial={{ y: -100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        className="bg-dark-card/95 backdrop-blur-xl border-b border-dark-border safe-top pointer-events-auto"
      >
        <div className="px-3 sm:px-4 pt-3 sm:pt-4 pb-2 sm:pb-3">
          {currentInstruction ? (
            <div className="flex items-center gap-3 sm:gap-4">
              <div className="w-12 h-12 sm:w-16 sm:h-16 flex-shrink-0 bg-primary-600 rounded-xl sm:rounded-2xl flex items-center
                              justify-center text-2xl sm:text-3xl shadow-glow-primary">
                {getTurnIcon(currentInstruction.type)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-lg sm:text-2xl font-bold text-white leading-tight">
                  {formatDistance(currentInstruction.distance)}
                </p>
                <p className="text-xs sm:text-sm text-gray-300 mt-0.5 truncate">{currentInstruction.text}</p>
                {currentInstruction.streetName && (
                  <p className="text-[10px] sm:text-xs text-gray-500 truncate">{currentInstruction.streetName}</p>
                )}
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3 sm:gap-4">
              <div className="w-12 h-12 sm:w-16 sm:h-16 flex-shrink-0 bg-green-600 rounded-xl sm:rounded-2xl flex items-center
                              justify-center text-2xl sm:text-3xl">🏁</div>
              <div>
                <p className="text-lg sm:text-xl font-bold text-white">{t('navigationHud.arrived')}</p>
                <p className="text-xs sm:text-sm text-gray-300">{destination?.name}</p>
              </div>
            </div>
          )}

          {instructions[currentLeg + 1] && (
            <div className="flex items-center gap-2 mt-1.5 sm:mt-2 pt-1.5 sm:pt-2 border-t border-dark-border">
              <FaChevronRight size={12} className="text-gray-500" />
              <p className="text-[11px] sm:text-xs text-gray-400 truncate">
                {t('navigationHud.then', { instruction: instructions[currentLeg + 1].text })}
              </p>
            </div>
          )}
        </div>
      </motion.div>

      {/* Bottom mini bar */}
      <motion.div
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        className="absolute bottom-20 sm:bottom-24 left-2 sm:left-4 right-2 sm:right-4 pointer-events-auto"
      >
        <div className="glass-dark rounded-xl sm:rounded-2xl px-2 sm:px-4 py-2 sm:py-3 flex items-center justify-between gap-1">
          {/* Speed */}
          <div className="text-center min-w-0">
            <p className="text-base sm:text-lg font-bold text-white tabular-nums">
              {userSpeed > 0 ? `${Math.round(userSpeed)}` : '--'}
            </p>
            <p className="text-[9px] sm:text-[10px] text-gray-400">{t('navigationHud.kmh')}</p>
          </div>

          {/* ETA */}
          <div className="text-center min-w-0">
            <p className="text-base sm:text-lg font-bold text-white tabular-nums">
              {remainingMin !== null ? `${remainingMin} ${t('navigationHud.min')}` : '--'}
            </p>
            <p className="text-[9px] sm:text-[10px] text-gray-400">{t('navigationHud.eta')}</p>
          </div>

          <div className="text-center min-w-0">
            <p className="text-base sm:text-lg font-bold text-white tabular-nums">
              {remainingDist !== null ? formatDistance(remainingDist) : '--'}
            </p>
            <p className="text-[9px] sm:text-[10px] text-gray-400">{t('navigationHud.remaining')}</p>
          </div>

          <div className="text-center max-w-[60px] sm:max-w-[80px] hidden xs:block">
            <p className="text-[11px] sm:text-sm font-semibold text-white truncate">{destination?.name}</p>
            <p className="text-[8px] sm:text-[10px] text-gray-400">{t('navigationHud.destination')}</p>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <button onClick={() => setAiCoDriver(!isAiCoDriverEnabled)}
              className={`w-9 sm:w-10 h-9 sm:h-10 rounded-xl flex items-center justify-center transition-all ${
                isAiCoDriverEnabled ? 'bg-primary-600 text-white' : 'bg-white/10 text-gray-400'
              }`}>
              {isAiCoDriverEnabled ? <FaVolumeUp size={14} /> : <FaVolumeMute size={14} />}
            </button>
            <button onClick={clearRoute}
              className="w-9 sm:w-10 h-9 sm:h-10 bg-red-600/20 rounded-xl flex items-center justify-center
                         text-red-400 hover:bg-red-600/40 transition-all">
              <FaTimes size={14} />
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
