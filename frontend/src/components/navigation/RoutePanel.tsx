'use client';
import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FaBolt, FaCar, FaChevronRight, FaChevronDown, FaClock, FaCompass, FaDollarSign, FaExclamationTriangle, FaGasPump, FaLeaf, FaRoute, FaShieldAlt, FaTachometerAlt, FaTimes, FaTruck } from 'react-icons/fa';
import { useMapStore } from '@/store/map.store';
import { useAuthStore } from '@/store/auth.store';
import { routesApi, usersApi } from '@/lib/api';
import { resetRerouteCooldown } from '@/lib/navigationEngine';
import { haversineDist } from '@/lib/geo';
import { RouteResult, RouteType, Vehicle } from '@/types';
import { getWeather, WeatherData } from '@/lib/weather';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';

const ROUTE_TYPE_CONFIG: Record<RouteType, { labelKey: string; icon: React.ReactNode; color: string }> = {
  FASTEST:    { labelKey: 'routePanel.routeTypesConfig.fastest',   icon: <FaBolt size={14} />,        color: 'text-yellow-400' },
  SHORTEST:   { labelKey: 'routePanel.routeTypesConfig.shortest',  icon: <FaRoute size={14} />,      color: 'text-blue-400' },
  SAFEST:     { labelKey: 'routePanel.routeTypesConfig.safest',    icon: <FaShieldAlt size={14} />,     color: 'text-green-400' },
  SCENIC:     { labelKey: 'routePanel.routeTypesConfig.scenic',    icon: <FaLeaf size={14} />,       color: 'text-emerald-400' },
  CHEAPEST:   { labelKey: 'routePanel.routeTypesConfig.cheapest',  icon: <FaDollarSign size={14} />, color: 'text-green-400' },
  NO_TRAFFIC: { labelKey: 'routePanel.routeTypesConfig.noJams',   icon: <FaTachometerAlt size={14} />,      color: 'text-cyan-400' },
  NO_TOLLS:   { labelKey: 'routePanel.routeTypesConfig.noTolls',  icon: <FaDollarSign size={14} />, color: 'text-lime-400' },
  ECONOMICAL: { labelKey: 'routePanel.routeTypesConfig.eco',       icon: <FaLeaf size={14} />,       color: 'text-green-400' },
  TOURIST:    { labelKey: 'routePanel.routeTypesConfig.tourist',   icon: <FaCompass size={14} />, color: 'text-purple-400' },
  FAMILY:     { labelKey: 'routePanel.routeTypesConfig.family',    icon: <FaShieldAlt size={14} />,     color: 'text-pink-400' },
  NIGHT:      { labelKey: 'routePanel.routeTypesConfig.night',     icon: <FaBolt size={14} />,        color: 'text-indigo-400' },
  TRUCK:      { labelKey: 'routePanel.routeTypesConfig.truck',     icon: <FaRoute size={14} />,      color: 'text-orange-400' },
  CUSTOM:     { labelKey: 'routePanel.routeTypesConfig.custom',    icon: <FaCompass size={14} />, color: 'text-gray-400' },
};

export function RoutePanel() {
  const { t } = useTranslation();
  const origin = useMapStore(s => s.origin);
  const destination = useMapStore(s => s.destination);
  const calculatedRoutes = useMapStore(s => s.calculatedRoutes);
  const selectedRoute = useMapStore(s => s.selectedRoute);
  const setSelectedRoute = useMapStore(s => s.setSelectedRoute);
  const setCalculatedRoutes = useMapStore(s => s.setCalculatedRoutes);
  const toggleRoutesPanel = useMapStore(s => s.toggleRoutesPanel);
  const setActiveTrip = useMapStore(s => s.setActiveTrip);
  const setNavigation = useMapStore(s => s.setNavigation);
  const vehicleMode = useMapStore(s => s.vehicleMode);
  const setStoreSelectedVehicle = useMapStore(s => s.setSelectedVehicle);
  const userLocation = useMapStore(s => s.userLocation);
  const { user } = useAuthStore();

  const [isCalculating, setIsCalculating] = useState(false);
  const [selectedTypes, setSelectedTypes] = useState<RouteType[]>(['FASTEST', 'SAFEST', 'ECONOMICAL']);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [selectedVehicle, setSelectedVehicle] = useState<Vehicle | null>(null);
  const [showVehiclePicker, setShowVehiclePicker] = useState(false);
  const [weatherOrigin, setWeatherOrigin] = useState<WeatherData | null>(null);
  const [weatherDest, setWeatherDest] = useState<WeatherData | null>(null);

  useEffect(() => {
    if (!user) return;
    usersApi.getVehicles()
      .then(res => {
        const list = res.data.data || res.data || [];
        setVehicles(list);
        if (list.length > 0) setSelectedVehicle(list.find((v: Vehicle) => v.isDefault) || list[0]);
      })
      .catch(() => {});
  }, [user]);

  useEffect(() => {
    setStoreSelectedVehicle(selectedVehicle);
  }, [selectedVehicle, setStoreSelectedVehicle]);

  // Current-location weather, refreshed as the user actually moves rather
  // than pinned to whatever origin point was picked for the route.
  const lastWeatherFetchRef = useRef<{ lat: number; lng: number; time: number } | null>(null);
  useEffect(() => {
    if (!userLocation) return;
    const last = lastWeatherFetchRef.current;
    const now = Date.now();
    const movedFar = !last || haversineDist(last.lat, last.lng, userLocation.lat, userLocation.lng) > 2000;
    const isStale = !last || now - last.time > 10 * 60 * 1000;
    if (!movedFar && !isStale) return;

    lastWeatherFetchRef.current = { lat: userLocation.lat, lng: userLocation.lng, time: now };
    getWeather(userLocation.lat, userLocation.lng).then(setWeatherOrigin).catch(() => {});
  }, [userLocation?.lat, userLocation?.lng]);

  const calcAttemptedRef = useRef(false);
  useEffect(() => {
    if (origin && destination && calculatedRoutes.length === 0 && !calcAttemptedRef.current) {
      calcAttemptedRef.current = true;
      calculateRoutes();
    }
    if (calculatedRoutes.length > 0) {
      calcAttemptedRef.current = false;
    }
  }, [origin, destination, calculatedRoutes.length]);

  const calculateRoutes = async () => {
    if (!origin || !destination) {
      toast.error(t('routePanel.setOriginDest'));
      return;
    }

    setIsCalculating(true);
    try {
      const results = await Promise.all(
        selectedTypes.map((type) =>
          routesApi.calculate({
            originLat: origin.lat,
            originLng: origin.lng,
            destLat: destination.lat,
            destLng: destination.lng,
            routeType: type,
            vehicleType: selectedVehicle?.type || vehicleMode,
          }).then((r) => r.data.data?.[0]).catch(() => null),
        ),
      );

      const valid = results.filter(Boolean) as RouteResult[];
      setCalculatedRoutes(valid);
      if (valid.length > 0) {
        setSelectedRoute(valid[0]);
      } else {
        // Every per-type request is individually caught above so Promise.all
        // never rejects — without this, a total backend outage just leaves
        // the panel empty with no explanation.
        toast.error(t('routePanel.routeCalcFailed'));
      }

      // Departure weather prefers live geolocation (kept fresh by the effect
      // above); only fall back to the route's origin point if we don't have
      // a GPS fix yet.
      if (!userLocation) {
        getWeather(origin.lat, origin.lng).then(setWeatherOrigin).catch(() => {});
      }
      getWeather(destination.lat, destination.lng).then(setWeatherDest).catch(() => {});
    } catch (err) {
      toast.error(t('routePanel.routeCalcFailed'));
    } finally {
      setIsCalculating(false);
    }
  };

  const startNavigation = async () => {
    if (!selectedRoute || !origin || !destination) return;

    try {
      const res = await routesApi.startTrip({
        originName: origin.name,
        originLat: origin.lat,
        originLng: origin.lng,
        destName: destination.name,
        destLat: destination.lat,
        destLng: destination.lng,
        distance: selectedRoute.distance,
        duration: selectedRoute.duration,
      });

      const tripId = res.data?.data?.id || res.data?.id;
      if (tripId) setActiveTrip(tripId);
      resetRerouteCooldown();
      setNavigation({ isNavigating: true });
      toast.success(t('routePanel.navigationStarted'));
    } catch {
      toast.error(t('routePanel.navStartFailed'));
    }
  };

  const formatDuration = (min: number) => {
    if (min < 60) return `${min} ${t('routePanel.formatDuration.min')}`;
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m > 0 ? `${h}${t('routePanel.formatDuration.h')} ${m}${t('routePanel.formatDuration.m')}` : `${h}${t('routePanel.formatDuration.h')}`;
  };

  return (
    <motion.div
      initial={{ y: '100%', opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: '100%', opacity: 0 }}
      transition={{ type: 'spring', damping: 30, stiffness: 300 }}
      className="absolute bottom-0 left-0 right-0 z-50 max-h-[85vh] overflow-hidden md:top-4 md:bottom-4 md:left-4 md:right-auto md:w-[400px] md:max-h-none"
    >
      <div className="map-panel rounded-t-3xl md:rounded-3xl h-full mx-0 overflow-hidden flex flex-col md:border md:border-white/10 md:shadow-2xl">
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 bg-gray-600 rounded-full" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-dark-border">
          <div>
            <h2 className="font-display font-bold text-lg text-white">{t('routePanel.routeOptions')}</h2>
            {origin && destination && (
              <p className="text-xs text-gray-400 mt-0.5 truncate max-w-[250px]">
                {origin.name} → {destination.name}
              </p>
            )}
          </div>
          <button
            onClick={toggleRoutesPanel}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 transition-all"
          >
            <FaTimes size={16} className="text-gray-400" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-4 pb-4">
          {/* Vehicle selector (only show when >1 vehicle) */}
          {vehicles.length > 1 && selectedVehicle && (
            <div className="mt-4 relative">
              <p className="text-xs text-gray-400 mb-1.5">{t('routePanel.vehicle')}</p>
              <button onClick={() => setShowVehiclePicker(!showVehiclePicker)}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-all text-left">
                <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs ${
                  selectedVehicle.fuelType === 'ELECTRIC' ? 'bg-green-600/20 text-green-400' :
                  selectedVehicle.fuelType === 'DIESEL' ? 'bg-orange-600/20 text-orange-400' :
                  'bg-yellow-600/20 text-yellow-400'
                }`}>
                  {selectedVehicle.type === 'TRUCK' ? <FaTruck size={12} /> : <FaCar size={12} />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-white font-medium truncate">{selectedVehicle.make} {selectedVehicle.model}</p>
                  <p className="text-[10px] text-gray-500">{selectedVehicle.year} · {selectedVehicle.fuelType}</p>
                </div>
                <FaChevronDown size={10} className="text-gray-500" />
              </button>
              <AnimatePresence>
                {showVehiclePicker && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    className="absolute z-10 left-0 right-0 mt-1 bg-dark-card border border-dark-border rounded-xl overflow-hidden shadow-2xl"
                  >
                    {vehicles.filter(v => v.id !== selectedVehicle.id).map(v => (
                      <button key={v.id} onClick={() => { setSelectedVehicle(v); setShowVehiclePicker(false); }}
                        className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-white/5 transition-all text-left">
                        <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs ${
                          v.fuelType === 'ELECTRIC' ? 'bg-green-600/20 text-green-400' :
                          v.fuelType === 'DIESEL' ? 'bg-orange-600/20 text-orange-400' :
                          'bg-yellow-600/20 text-yellow-400'
                        }`}>
                          {v.type === 'TRUCK' ? <FaTruck size={12} /> : <FaCar size={12} />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-white font-medium truncate">{v.make} {v.model}</p>
                          <p className="text-[10px] text-gray-500">{v.year} · {v.fuelType}</p>
                        </div>
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}

          {/* Route type selector */}
          <div className={vehicles.length > 1 ? 'mt-4' : 'mt-4'}>
            <p className="text-xs text-gray-400 mb-2">{t('routePanel.routeTypes')}</p>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(ROUTE_TYPE_CONFIG) as RouteType[]).map((type) => {
                const cfg = ROUTE_TYPE_CONFIG[type];
                const selected = selectedTypes.includes(type);
                return (
                  <button
                    key={type}
                    onClick={() => {
                      setSelectedTypes((prev) =>
                        prev.includes(type)
                          ? prev.filter((t) => t !== type)
                          : [...prev, type],
                      );
                    }}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium
                      border transition-all ${
                        selected
                          ? 'bg-primary-600/30 border-primary-500/50 text-white'
                          : 'bg-white/5 border-white/10 text-gray-400'
                      }`}
                  >
                    <span className={cfg.color}>{cfg.icon}</span>
                    {t(cfg.labelKey)}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Calculate button */}
          <button
            onClick={calculateRoutes}
            disabled={isCalculating || !origin || !destination}
            className="mt-4 w-full btn-primary flex items-center justify-center gap-2 py-3
                       disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isCalculating ? (
              <>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                {t('routePanel.calculating')}
              </>
            ) : (
              <>
                <FaCompass size={18} />
                {t('routePanel.calculateRoutes')}
              </>
            )}
          </button>

          {/* Route results */}
          <AnimatePresence>
            {calculatedRoutes.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-4 space-y-3"
              >
                <p className="text-xs text-gray-400">{t('routePanel.routesFound', { count: calculatedRoutes.length })}</p>

                {/* Weather info */}
                {(weatherOrigin || weatherDest) && (
                  <div className="flex gap-2 text-[11px] text-gray-400 bg-white/5 rounded-xl p-3">
                    {weatherOrigin && (
                      <div className="flex-1">
                        <p className="text-gray-500 mb-0.5">{t('routePanel.departure')}</p>
                        <p>{weatherOrigin.icon} {Math.round(weatherOrigin.temp)}°C, {weatherOrigin.condition}</p>
                      </div>
                    )}
                    {weatherDest && (
                      <div className="flex-1">
                        <p className="text-gray-500 mb-0.5">{t('routePanel.destination')}</p>
                        <p>{weatherDest.icon} {Math.round(weatherDest.temp)}°C, {weatherDest.condition}</p>
                      </div>
                    )}
                  </div>
                )}

                {calculatedRoutes.map((route, i) => {
                  const cfg = ROUTE_TYPE_CONFIG[route.type];
                  const isSelected = selectedRoute?.type === route.type;

                  return (
                    <motion.button
                      key={route.type}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.05 }}
                      onClick={() => setSelectedRoute(route)}
                      className={`w-full p-4 rounded-2xl border transition-all text-left ${
                        isSelected
                          ? 'bg-primary-600/20 border-primary-500/50'
                          : 'bg-white/5 border-white/10 hover:bg-white/10'
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <span className={`${cfg.color}`}>{cfg.icon}</span>
                            <span className="font-semibold text-white text-sm">{t(cfg.labelKey)}</span>
                            {i === 0 && (
                              <span className="text-[10px] bg-primary-600/40 text-primary-300 px-2 py-0.5 rounded-full">
                                {t('routePanel.recommended')}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-gray-400">{route.summary}</p>
                        </div>
                        <FaChevronRight size={16} className={isSelected ? 'text-primary-400' : 'text-gray-600'} />
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
                        <StatChip icon={<FaClock size={10} />} value={formatDuration(route.duration)} />
                        <StatChip icon={<FaGasPump size={10} />} value={`${route.fuelEstimate}${t('routePanel.liters')}`} />
                        <StatChip
                          icon={<FaExclamationTriangle size={10} />}
                          value={`${route.hazardCount} ${t('routePanel.risks')}`}
                          danger={route.hazardCount > 3}
                        />
                        <StatChip
                          icon={<FaLeaf size={10} />}
                          value={`${route.ecoScore}`}
                          color="text-green-400"
                        />
                      </div>
                    </motion.button>
                  );
                })}

                {selectedRoute && (
                  <motion.button
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    onClick={startNavigation}
                    className="w-full btn-primary py-4 flex items-center justify-center gap-2 text-base font-semibold"
                  >
                    <FaCompass size={20} />
                    {t('routePanel.startNavigation')}
                  </motion.button>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
}

function StatChip({
  icon,
  value,
  danger = false,
  color,
}: {
  icon: React.ReactNode;
  value: string;
  danger?: boolean;
  color?: string;
}) {
  return (
    <div className="bg-white/5 rounded-lg p-2 flex flex-col items-center gap-1">
      <span className={danger ? 'text-red-400' : color || 'text-gray-400'}>{icon}</span>
      <span className={`text-[10px] font-medium ${danger ? 'text-red-400' : 'text-gray-300'}`}>
        {value}
      </span>
    </div>
  );
}
