'use client';
import { useEffect, useCallback, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FaTimes, FaVolumeMute, FaVolumeUp, FaChevronRight, FaLocationArrow } from 'react-icons/fa';
import { useMapStore } from '@/store/map.store';
import { useVoiceAssistant } from '@/hooks/useVoiceAssistant';
import { useTranslation } from 'react-i18next';
import { mapApi, routesApi } from '@/lib/api';
import {
  computeNavigationUpdate, getRemainingDistance, getRemainingDuration,
  type NavigationUpdate,
} from '@/lib/navigationEngine';
import {
  SpeedCamera, createSpeedCameraMonitor, buildCameraWarningMessage,
  buildCameraAlertText, SpeedCameraMonitor,
} from '@/lib/speedCameraMonitor';
import { RouteResult } from '@/types';

export function NavigationHUD() {
  const navigation = useMapStore(s => s.navigation);
  const selectedRoute = useMapStore(s => s.selectedRoute);
  const destination = useMapStore(s => s.destination);
  const origin = useMapStore(s => s.origin);
  const setNavigation = useMapStore(s => s.setNavigation);
  const setSelectedRoute = useMapStore(s => s.setSelectedRoute);
  const userLocation = useMapStore(s => s.userLocation);
  const userHeading = useMapStore(s => s.userHeading);
  const userSpeed = useMapStore(s => s.userSpeed);
  const isAiCoDriverEnabled = useMapStore(s => s.isAiCoDriverEnabled);
  const setAiCoDriver = useMapStore(s => s.setAiCoDriver);
  const clearRoute = useMapStore(s => s.clearRoute);
  const activeTrip = useMapStore(s => s.activeTrip);
  const setActiveTrip = useMapStore(s => s.setActiveTrip);
  const { speak, announceNavigation } = useVoiceAssistant();
  const { t, i18n } = useTranslation();
  const wrongWayAnnouncedRef = useRef(false);

  const monitorRef = useRef<SpeedCameraMonitor | null>(null);
  const [cameraWarning, setCameraWarning] = useState<ReturnType<typeof buildCameraAlertText> | null>(null);
  const warningTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const userLocationRef = useRef(userLocation);
  const userHeadingRef = useRef(userHeading);
  const userSpeedRef = useRef(userSpeed);
  const legAnnouncedRef = useRef(-1);
  const engineInitRef = useRef(false);
  const handleArrivalRef = useRef<() => Promise<void>>(async () => {});
  const handleRerouteRef = useRef<() => Promise<void>>(async () => {});
  userLocationRef.current = userLocation;
  userHeadingRef.current = userHeading;
  userSpeedRef.current = userSpeed;

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

  const endTrip = useCallback(async () => {
    if (activeTrip) {
      try {
        const rem = userLocation && selectedRoute
          ? getRemainingDistance(userLocation.lat, userLocation.lng, selectedRoute.polyline)
          : 0;
        const traveled = selectedRoute ? selectedRoute.distance - rem / 1000 : 0;
        await routesApi.endTrip(activeTrip, {
          distance: traveled,
          duration: 0,
          status: 'completed',
        });
      } catch {}
      setActiveTrip(null);
    }
  }, [activeTrip, userLocation, selectedRoute, setActiveTrip]);

  const handleCancel = useCallback(async () => {
    await endTrip();
    clearRoute();
  }, [endTrip, clearRoute]);

  const handleArrival = useCallback(async () => {
    speak(t('navigationHud.arrivedVoice', { name: destination?.name || '' }), true);
    await endTrip();
  }, [speak, t, destination, endTrip]);

  const handleReroute = useCallback(async () => {
    if (!userLocation || !destination) return;
    setNavigation({ isRerouting: true });
    try {
      const res = await routesApi.calculate({
        originLat: userLocation.lat,
        originLng: userLocation.lng,
        destLat: destination.lat,
        destLng: destination.lng,
        routeType: 'FASTEST',
      });
      const routes: RouteResult[] = res.data.data || [];
      if (routes.length > 0) {
        setSelectedRoute(routes[0]);
        setNavigation({ currentLeg: 0, isOffRoute: false, isRerouting: false });
        legAnnouncedRef.current = -1;
        speak(t('navigationHud.rerouted'), true);
      } else {
        setNavigation({ isRerouting: false });
      }
    } catch {
      setNavigation({ isRerouting: false });
    }
  }, [userLocation, destination, setNavigation, setSelectedRoute, speak, t]);

  handleArrivalRef.current = handleArrival;
  handleRerouteRef.current = handleReroute;

  // Navigation engine — runs on every position update
  useEffect(() => {
    if (!navigation.isNavigating || !selectedRoute || !userLocation) return;

    const update: NavigationUpdate = computeNavigationUpdate(
      userLocation.lat, userLocation.lng, userHeading,
      selectedRoute, navigation.currentLeg,
    );

    if (update.currentLeg !== navigation.currentLeg ||
        update.isArrived !== navigation.isArrived ||
        update.isOffRoute !== navigation.isOffRoute ||
        update.isWrongWay !== navigation.isWrongWay) {
      setNavigation({
        currentLeg: update.currentLeg,
        isArrived: update.isArrived,
        isOffRoute: update.isOffRoute,
        isWrongWay: update.isWrongWay,
      });
    }

    if (update.routeProgress !== navigation.routeProgress) {
      setNavigation({ routeProgress: update.routeProgress });
    }
    if (update.forwardIndex !== navigation.forwardIndex) {
      setNavigation({ forwardIndex: update.forwardIndex });
    }
    if (Math.abs(update.distanceToManeuver - navigation.distanceToManeuver) > 2) {
      setNavigation({ distanceToManeuver: update.distanceToManeuver });
    }
    if (Math.abs(update.bearingToManeuver - navigation.bearingToManeuver) > 1) {
      setNavigation({ bearingToManeuver: update.bearingToManeuver });
    }

    if (update.isArrived && !engineInitRef.current) {
      engineInitRef.current = true;
      handleArrivalRef.current();
    }

    if (update.shouldReroute) {
      handleRerouteRef.current();
    }
  }, [userLocation?.lat, userLocation?.lng, userHeading, navigation.isNavigating]);

  // Reset engine init flag when navigation starts
  useEffect(() => {
    if (navigation.isNavigating) {
      engineInitRef.current = false;
      legAnnouncedRef.current = -1;
    }
  }, [navigation.isNavigating]);

  // Voice guidance on leg change
  useEffect(() => {
    if (!navigation.isNavigating || !selectedRoute) return;
    const instructions = selectedRoute.instructions || [];
    const leg = navigation.currentLeg;

    if (leg !== legAnnouncedRef.current && leg < instructions.length) {
      const inst = instructions[leg];
      if (inst && isAiCoDriverEnabled) {
        announceNavigation(inst.text, inst.type, inst.distance, inst.streetName);
      }
      legAnnouncedRef.current = leg;
    }
  }, [navigation.currentLeg, navigation.isNavigating, selectedRoute, isAiCoDriverEnabled, announceNavigation]);

  // Speed camera monitoring — throttled to avoid API flood
  const lastCameraFetchRef = useRef(0);
  const userReportedCamerasRef = useRef<SpeedCamera[]>([]);
  useEffect(() => {
    if (!userLocation) return;

    const now = Date.now();
    if (now - lastCameraFetchRef.current < 15000) return;
    lastCameraFetchRef.current = now;

    if (!monitorRef.current) {
      monitorRef.current = createSpeedCameraMonitor();
    }
    const mon = monitorRef.current;

    mapApi.getObjects({ categories: 'SPEED_CAMERA', limit: 50, minLat: userLocation.lat - 0.5, maxLat: userLocation.lat + 0.5, minLng: userLocation.lng - 0.5, maxLng: userLocation.lng + 0.5 })
      .then(res => {
        const objects: any[] = Array.isArray(res.data?.data) ? res.data.data : Array.isArray(res.data) ? res.data : [];
        const cameras: SpeedCamera[] = objects.map((o: any) => ({
          id: o.id, lat: o.lat, lng: o.lng, name: o.name || '',
          cameraType: (o.data?.cameraType || 'STATIONARY') as any,
          maxSpeed: o.data?.maxSpeed || undefined,
          direction: o.data?.direction || undefined,
        }));
        userReportedCamerasRef.current = cameras;

        return mapApi.getSpeedCameras(userLocation.lat, userLocation.lng, 50);
      })
      .then(res => {
        if (!res) return;
        const dbCameras: any[] = Array.isArray(res.data?.data) ? res.data.data : Array.isArray(res.data) ? res.data : [];
        mon.setCameras([...userReportedCamerasRef.current, ...dbCameras]);
      })
      .catch(() => {});
  }, [userLocation?.lat, userLocation?.lng]);

  useEffect(() => {
    const mon = monitorRef.current;
    if (!mon || !userLocation) return;
    mon.updatePosition(userLocation.lat, userLocation.lng, userHeading, userSpeed);
  }, [userLocation?.lat, userLocation?.lng, userHeading, userSpeed]);

  useEffect(() => {
    if (!userLocation) return;

    let osmLoadCount = 0;

    const interval = setInterval(() => {
      const mon = monitorRef.current;
      const loc = userLocationRef.current;
      const heading = userHeadingRef.current;
      const speed = userSpeedRef.current;
      if (!mon || !loc) return;

      osmLoadCount++;
      if (osmLoadCount % 30 === 0) {
        mapApi.getSpeedCameras(loc.lat, loc.lng, 50)
          .then(res => {
            const dbCameras: any[] = res.data.data || res.data || [];
            mon.setCameras([...userReportedCamerasRef.current, ...dbCameras]);
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
    // `userLocation` itself is read via a ref inside the interval (always fresh),
    // but its presence must still gate effect setup — otherwise if GPS lock
    // arrives after this effect's first run (very common), the early return
    // above means the interval is never created for the rest of the session.
    // Depend on presence only (not lat/lng) so this doesn't re-run on every fix.
  }, [navigation.isNavigating, i18n.language, speak, Boolean(userLocation)]);

  useEffect(() => {
    if (navigation.isWrongWay) {
      if (!wrongWayAnnouncedRef.current) {
        speak(t('navigationHud.wrongWayVoice'), true);
        wrongWayAnnouncedRef.current = true;
      }
    } else {
      wrongWayAnnouncedRef.current = false;
    }
  }, [navigation.isWrongWay, speak, t]);

  useEffect(() => {
    return () => { if (warningTimeoutRef.current) clearTimeout(warningTimeoutRef.current); };
  }, []);

  const instructions = selectedRoute?.instructions || [];
  const currentLeg = Math.min(navigation.currentLeg ?? 0, Math.max(0, instructions.length - 1));
  const currentInstruction = instructions[currentLeg] || null;
  const nextInstruction = instructions[currentLeg + 1] || null;

  const remainingDist = userLocation && selectedRoute
    ? getRemainingDistance(userLocation.lat, userLocation.lng, selectedRoute.polyline)
    : null;
  const remainingSec = userLocation && selectedRoute
    ? getRemainingDuration(
        userLocation.lat, userLocation.lng, selectedRoute.polyline,
        selectedRoute.duration, selectedRoute.distance * 1000,
      )
    : null;
  const remainingMin = remainingSec != null ? remainingSec / 60 : null;
  const remainingTime = remainingMin != null
    ? remainingMin >= 60
      ? `${Math.floor(remainingMin / 60)} ${t('navigationHud.h')} ${Math.round(remainingMin % 60)} ${t('navigationHud.min')}`
      : remainingMin >= 1
        ? `${Math.round(remainingMin)} ${t('navigationHud.min')}`
        : `${Math.max(1, Math.round(remainingSec))} ${t('navigationHud.sec') || 'сек'}`
    : null;

  return (
    <div className="fixed inset-0 z-50 pointer-events-none">
      {/* Camera warning removed — cameras show on map with voice alerts */}

      {/* Off-route / rerouting banner */}
      <AnimatePresence>
        {navigation.isRerouting && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="absolute top-20 left-4 right-4 pointer-events-auto z-10"
          >
            <div className="bg-amber-600/90 backdrop-blur-xl rounded-2xl px-5 py-3 border border-amber-400/30 shadow-2xl">
              <div className="flex items-center gap-3">
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                <p className="text-sm font-semibold text-white">{t('navigationHud.recalculating')}</p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Wrong way warning */}
      <AnimatePresence>
        {navigation.isWrongWay && !navigation.isRerouting && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="absolute top-20 left-4 right-4 pointer-events-auto z-10"
          >
            <div className="bg-red-600/90 backdrop-blur-xl rounded-2xl px-5 py-3 border border-red-400/30 shadow-2xl">
              <div className="flex items-center gap-3">
                <span className="text-2xl">⚠️</span>
                <div>
                  <p className="text-sm font-bold text-white">{t('navigationHud.wrongWay') || 'Едете не в том направлении!'}</p>
                  <p className="text-xs text-red-200">{t('navigationHud.turnAround') || 'Развернитесь'}</p>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Top navigation banner — Yandex style */}
      <motion.div
        initial={{ y: -100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        className="absolute top-0 left-0 right-0 pointer-events-auto"
      >
        <div className="bg-dark-card/95 backdrop-blur-xl border-b border-white/5">
          <div className="px-3 sm:px-4 pt-4 pb-3 overflow-hidden">
            {currentInstruction && !navigation.isArrived ? (
              <>
                <div className="flex items-center gap-4">
                  <div className="w-16 h-16 flex-shrink-0 bg-primary-600 rounded-2xl flex items-center justify-center text-3xl shadow-lg">
                    {getTurnIcon(currentInstruction.type)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-3xl font-bold text-white tabular-nums leading-tight">
                      {formatDistance(navigation.distanceToManeuver || currentInstruction.distance)}
                    </p>
                    <p className="text-sm sm:text-base text-gray-300 mt-0.5 truncate">
                      {currentInstruction.text}
                    </p>
                    {currentInstruction.streetName && (
                      <p className="text-xs text-gray-500 truncate mt-0.5">
                        {currentInstruction.streetName}
                      </p>
                    )}
                  </div>
                </div>

                {nextInstruction && (
                  <div className="flex items-center gap-2 mt-3 pt-3 border-t border-white/5">
                    <FaChevronRight size={10} className="text-gray-500 flex-shrink-0" />
                    <p className="text-xs text-gray-400 truncate">
                      {t('navigationHud.then', { instruction: nextInstruction.text })}
                    </p>
                  </div>
                )}
              </>
            ) : (
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 flex-shrink-0 bg-green-600 rounded-2xl flex items-center justify-center text-3xl">🏁</div>
                <div>
                  <p className="text-xl font-bold text-white">{t('navigationHud.arrived')}</p>
                  <p className="text-sm text-gray-300">{destination?.name}</p>
                  <button
                    onClick={handleCancel}
                    className="mt-2 px-4 py-1.5 bg-primary-600 rounded-lg text-xs font-semibold text-white"
                  >
                    {t('navigationHud.endTrip')}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </motion.div>

      {/* Bottom bar — Yandex style floating pill */}
      <motion.div
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        className="absolute bottom-8 left-3 right-3 pointer-events-auto"
      >
        <div className="bg-dark-card/95 backdrop-blur-xl rounded-2xl px-2 sm:px-3 py-3 border border-white/5 shadow-2xl flex items-center justify-between gap-1 sm:gap-2">
          {/* Speed */}
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-2xl sm:text-3xl font-bold text-white tabular-nums">{Math.round(userSpeed)}</span>
            <span className="text-[10px] sm:text-xs text-gray-400 uppercase">{t('navigationHud.kmh')}</span>
          </div>

          <div className="w-px h-8 bg-white/10" />

          {/* ETA */}
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-xl sm:text-2xl font-bold text-white tabular-nums">
              {remainingTime || '--'}
            </span>
            <span className="text-[10px] sm:text-xs text-gray-400">{t('navigationHud.eta')}</span>
          </div>

          <div className="w-px h-8 bg-white/10" />

          {/* Distance */}
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-xl sm:text-2xl font-bold text-white tabular-nums truncate">
              {remainingDist !== null ? formatDistance(remainingDist) : '--'}
            </span>
            <span className="text-[10px] sm:text-xs text-gray-400 hidden sm:inline">{t('navigationHud.remaining')}</span>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 ml-1">
            <button onClick={() => setAiCoDriver(!isAiCoDriverEnabled)}
              className={`w-9 h-9 rounded-xl flex items-center justify-center transition-all ${
                isAiCoDriverEnabled ? 'bg-primary-600/80 text-white' : 'bg-white/10 text-gray-400'
              }`}>
              {isAiCoDriverEnabled ? <FaVolumeUp size={13} /> : <FaVolumeMute size={13} />}
            </button>
            <button onClick={handleCancel}
              className="w-9 h-9 bg-red-600/20 rounded-xl flex items-center justify-center text-red-400 hover:bg-red-600/40 transition-all">
              <FaTimes size={13} />
            </button>
          </div>
        </div>

        {destination?.name && (
          <p className="text-[11px] text-gray-400 text-center mt-1.5 truncate px-4">
            {destination.name}
          </p>
        )}
      </motion.div>
    </div>
  );
}
