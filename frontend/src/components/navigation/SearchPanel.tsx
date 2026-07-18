'use client';
import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  FaArrowRight, FaBriefcase, FaCompass, FaHome, FaMapMarkerAlt,
  FaStar, FaTimes, FaSearch, FaLongArrowAltRight, FaDotCircle,
  FaHistory, FaTrash, FaGasPump, FaParking, FaCoffee, FaHotel,
  FaHospital, FaShoppingCart, FaCar, FaRoad, FaUtensils,
  FaChevronLeft, FaPlus, FaCheck, FaBookmark, FaRegBookmark,
  FaBolt, FaShieldAlt, FaRoute, FaLeaf, FaDollarSign, FaTachometerAlt,
  FaTruck, FaChevronDown,
} from 'react-icons/fa';
import { useMapStore } from '@/store/map.store';
import { useAuthStore } from '@/store/auth.store';
import { mapApi, routesApi, usersApi } from '@/lib/api';
import { resetRerouteCooldown } from '@/lib/navigationEngine';
import { useVoiceAssistant } from '@/hooks/useVoiceAssistant';
import { useTranslation } from 'react-i18next';
import { MapObject, RouteResult, RouteType, SearchSuggestion, Vehicle } from '@/types';
import { getWeather, WeatherData } from '@/lib/weather';
import toast from 'react-hot-toast';

const QUICK_CATEGORIES = [
  { key: 'GAS_STATION', labelKey: 'searchPanel.categories.gasStations', icon: <FaGasPump size={14} />, color: '#f97316' },
  { key: 'EV_CHARGER', labelKey: 'searchPanel.categories.evChargers', icon: <FaBolt size={14} />, color: '#22c55e' },
  { key: 'PARKING', labelKey: 'searchPanel.categories.parking', icon: <FaParking size={14} />, color: '#0ea5e9' },
  { key: 'TRUCK_PARKING', labelKey: 'searchPanel.categories.truckParking', icon: <FaTruck size={14} />, color: '#f97316' },
  { key: 'CAFE', labelKey: 'searchPanel.categories.cafe', icon: <FaCoffee size={14} />, color: '#a78bfa' },
  { key: 'RESTAURANT', labelKey: 'searchPanel.categories.restaurants', icon: <FaUtensils size={14} />, color: '#f43f5e' },
  { key: 'HOTEL', labelKey: 'searchPanel.categories.hotels', icon: <FaHotel size={14} />, color: '#fbbf24' },
  { key: 'HOSPITAL', labelKey: 'searchPanel.categories.hospitals', icon: <FaHospital size={14} />, color: '#ef4444' },
  { key: 'SHOP', labelKey: 'searchPanel.categories.shops', icon: <FaShoppingCart size={14} />, color: '#22c55e' },
  { key: 'CAR_SERVICE', labelKey: 'searchPanel.categories.carService', icon: <FaCar size={14} />, color: '#6b7280' },
  { key: 'PHARMACY', labelKey: 'searchPanel.categories.pharmacy', icon: <FaHospital size={14} />, color: '#ec4899' },
  { key: 'ATM', labelKey: 'searchPanel.categories.atm', icon: <FaShoppingCart size={14} />, color: '#14b8a6' },
  { key: 'POLICE', labelKey: 'searchPanel.categories.police', icon: <FaShieldAlt size={14} />, color: '#3b82f6' },
  { key: 'TOILET', labelKey: 'searchPanel.categories.toilet', icon: <FaHotel size={14} />, color: '#78716c' },
  { key: 'PARK', labelKey: 'searchPanel.categories.park', icon: <FaLeaf size={14} />, color: '#22c55e' },
  { key: 'METRO_STATION', labelKey: 'searchPanel.categories.metro', icon: <FaRoad size={14} />, color: '#6366f1' },
  { key: 'BUS_STOP', labelKey: 'searchPanel.categories.busStop', icon: <FaRoad size={14} />, color: '#eab308' },
  { key: 'SUPERMARKET', labelKey: 'searchPanel.categories.supermarket', icon: <FaShoppingCart size={14} />, color: '#22d3ee' },
];

const ROUTE_OPTIONS: { key: RouteType; labelKey: string; icon: React.ReactNode; color: string }[] = [
  { key: 'FASTEST', labelKey: 'searchPanel.routeTypes.fastest', icon: <FaBolt size={12} />, color: 'text-yellow-400' },
  { key: 'SHORTEST', labelKey: 'searchPanel.routeTypes.shortest', icon: <FaRoute size={12} />, color: 'text-blue-400' },
  { key: 'SAFEST', labelKey: 'searchPanel.routeTypes.safest', icon: <FaShieldAlt size={12} />, color: 'text-green-400' },
  { key: 'SCENIC', labelKey: 'searchPanel.routeTypes.scenic', icon: <FaLeaf size={12} />, color: 'text-emerald-400' },
  { key: 'CHEAPEST', labelKey: 'searchPanel.routeTypes.cheapest', icon: <FaDollarSign size={12} />, color: 'text-green-400' },
  { key: 'NO_TRAFFIC', labelKey: 'searchPanel.routeTypes.noTraffic', icon: <FaTachometerAlt size={12} />, color: 'text-cyan-400' },
  { key: 'NO_TOLLS', labelKey: 'searchPanel.routeTypes.noTolls', icon: <FaDollarSign size={12} />, color: 'text-lime-400' },
  { key: 'ECONOMICAL', labelKey: 'searchPanel.routeTypes.economical', icon: <FaLeaf size={12} />, color: 'text-green-400' },
  { key: 'TOURIST', labelKey: 'searchPanel.routeTypes.tourist', icon: <FaCompass size={12} />, color: 'text-purple-400' },
  { key: 'FAMILY', labelKey: 'searchPanel.routeTypes.family', icon: <FaShieldAlt size={12} />, color: 'text-pink-400' },
  { key: 'NIGHT', labelKey: 'searchPanel.routeTypes.night', icon: <FaBolt size={12} />, color: 'text-indigo-400' },
  { key: 'TRUCK', labelKey: 'searchPanel.routeTypes.truck', icon: <FaRoute size={12} />, color: 'text-orange-400' },
  { key: 'CUSTOM', labelKey: 'searchPanel.routeTypes.custom', icon: <FaCompass size={12} />, color: 'text-gray-400' },
];

const CATEGORY_EMOJI: Record<string, string> = {
  GAS_STATION: '⛽', EV_CHARGER: '🔌', PARKING: '🅿️', TRUCK_PARKING: '🚛',
  CAFE: '☕', RESTAURANT: '🍽️', HOTEL: '🏨', MOTEL: '🛌',
  TOILET: '🚻', SHOWER: '🚿', PHARMACY: '💊', HOSPITAL: '🏥',
  SHOP: '🛒', TIRE_SERVICE: '🔧', CAR_SERVICE: '🔩',
  REST_AREA: '🌳', TOURIST_ATTRACTION: '📸',
  ADDRESS: '📍', COORDINATES: '📍',
};

interface SearchPanelProps {
  onClose?: () => void;
}

export function SearchPanel({ onClose }: SearchPanelProps) {
  const { t } = useTranslation();
  const formatDistance = (km?: number): string => {
    if (!km || km <= 0) return '';
    if (km < 1) return `${Math.round(km * 1000)} ${t('navigationHud.m')}`;
    if (km < 10) return `${km.toFixed(1)} ${t('navigationHud.km')}`;
    return `${Math.round(km)} ${t('navigationHud.km')}`;
  };
  const toggleSearch = useMapStore(s => s.toggleSearch);
  const setOrigin = useMapStore(s => s.setOrigin);
  const setDestination = useMapStore(s => s.setDestination);
  const userLocation = useMapStore(s => s.userLocation);
  const setMapCenter = useMapStore(s => s.setMapCenter);
  const setZoom = useMapStore(s => s.setZoom);
  const toggleRoutesPanel = useMapStore(s => s.toggleRoutesPanel);
  const setCalculatedRoutes = useMapStore(s => s.setCalculatedRoutes);
  const setSelectedRoute = useMapStore(s => s.setSelectedRoute);
  const setNavigation = useMapStore(s => s.setNavigation);
  const vehicleMode = useMapStore(s => s.vehicleMode);
  const origin = useMapStore(s => s.origin);
  const destination = useMapStore(s => s.destination);
  const setSearchQuery = useMapStore(s => s.setSearchQuery);
  const searchSuggestions = useMapStore(s => s.searchSuggestions);
  const setSearchSuggestions = useMapStore(s => s.setSearchSuggestions);
  const isSearching = useMapStore(s => s.isSearching);
  const setIsSearching = useMapStore(s => s.setIsSearching);
  const searchHistory = useMapStore(s => s.searchHistory);
  const addToSearchHistory = useMapStore(s => s.addToSearchHistory);
  const clearSearchHistory = useMapStore(s => s.clearSearchHistory);
  const setSelectedSearchResult = useMapStore(s => s.setSelectedSearchResult);
  const selectedSearchResult = useMapStore(s => s.selectedSearchResult);
  const searchQuery = useMapStore(s => s.searchQuery);
  const activeRouteType = useMapStore(s => s.activeRouteType);
  const { user } = useAuthStore();
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const { speak } = useVoiceAssistant();

  const [query, setQuery] = useState(searchQuery || '');
  const [activeIdx, setActiveIdx] = useState(-1);
  const [selectedItem, setSelectedItem] = useState<SearchSuggestion | null>(selectedSearchResult);
  const [showOrigin, setShowOrigin] = useState(false);
  const [isGoing, setIsGoing] = useState(false);
  const isGoingRef = useRef(false);
  useEffect(() => { isGoingRef.current = isGoing; }, [isGoing]);
  const [inputMode, setInputMode] = useState<'search' | 'origin' | 'destination'>('search');
  const [selectedTypes, setSelectedTypes] = useState<RouteType[]>([activeRouteType || 'FASTEST']);
  const [isBookmarked, setIsBookmarked] = useState(false);
  const [showRouteResults, setShowRouteResults] = useState(false);
  const [localRoutes, setLocalRoutes] = useState<RouteResult[]>([]);
  const [selectedLocalRoute, setSelectedLocalRoute] = useState<RouteResult | null>(null);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [selectedVehicle, setSelectedVehicle] = useState<Vehicle | null>(null);
  const [showVehiclePicker, setShowVehiclePicker] = useState(false);
  const [weatherData, setWeatherData] = useState<WeatherData | null>(null);
  const [searchResults, setSearchResults] = useState<SearchSuggestion[]>([]);
  const [isFullSearching, setIsFullSearching] = useState(false);

  // Focus input on mount
  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 100);
  }, []);

  // Fetch vehicles
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

  // Close on outside mousedown — only when main panel is shown
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (selectedItem) return;
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        const target = e.target as HTMLElement;
        if (!target.closest('[data-search-panel]')) {
          toggleSearch();
          onClose?.();
        }
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [toggleSearch, onClose, selectedItem]);

  // Fetch autocomplete suggestions
  const fetchSuggestions = useCallback(
    async (q: string) => {
      if (q.length < 1) {
        setSearchSuggestions([]);
        setQuery('');
        return;
      }
      const thisFetch = ++fetchIdRef.current;
      setIsSearching(true);
      setSearchQuery(q);
      try {
        const res = await mapApi.suggest(q, userLocation?.lat, userLocation?.lng);
        if (thisFetch !== fetchIdRef.current) return;
        setSearchSuggestions(res.data.data || res.data || []);
        setActiveIdx(-1);
      } catch {
        if (thisFetch === fetchIdRef.current) setSearchSuggestions([]);
      } finally {
        if (thisFetch === fetchIdRef.current) setIsSearching(false);
      }
    },
    [userLocation, setSearchSuggestions, setIsSearching, setSearchQuery],
  );

  const debouncedFetch = useRef<ReturnType<typeof setTimeout>>();
  const fetchIdRef = useRef(0);

  // Clear any pending debounced fetch on unmount — otherwise it still fires
  // after the panel closes and writes stale suggestions into the shared
  // map store, which then reappear next time the panel is reopened.
  useEffect(() => {
    return () => {
      clearTimeout(debouncedFetch.current);
      fetchIdRef.current++;
    };
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setSelectedItem(null);
    setSelectedSearchResult(null);
    clearTimeout(debouncedFetch.current);
    setQuery(val);
    setSearchQuery(val);
    if (val.length < 1) {
      setSearchSuggestions([]);
      return;
    }
    const thisFetch = ++fetchIdRef.current;
    debouncedFetch.current = setTimeout(async () => {
      if (thisFetch !== fetchIdRef.current) return;
      await fetchSuggestions(val);
    }, 250);
  };

  const handleInputFocus = () => {
    if (selectedItem) {
      setSelectedItem(null);
      setSelectedSearchResult(null);
      setQuery('');
    }
  };

  // Keyboard navigation
  const suggestions = selectedItem ? [] : searchSuggestions;
  const historyItems = (!query && !selectedItem) ? searchHistory : [];
  const items = selectedItem ? [] : [...historyItems, ...suggestions];
  const totalItems = items.length;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((prev) => Math.min(prev + 1, totalItems - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((prev) => Math.max(prev - 1, -1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIdx >= 0 && items[activeIdx]) {
        selectSuggestion(items[activeIdx]);
      } else if (query.length >= 1) {
        performFullSearch(query);
      }
    } else if (e.key === 'Escape') {
      if (selectedItem && showRouteResults) {
        setShowRouteResults(false);
        setLocalRoutes([]);
      } else if (selectedItem) {
        setSelectedItem(null);
        setSelectedSearchResult(null);
        setQuery('');
        inputRef.current?.focus();
      } else if (searchResults.length > 0) {
        setSearchResults([]);
      } else if (query) {
        setQuery('');
        setSearchQuery('');
        setSearchSuggestions([]);
      } else {
        toggleSearch();
        onClose?.();
      }
    }
  };

  // Scroll active item into view
  useEffect(() => {
    if (activeIdx < 0 || !listRef.current) return;
    const el = listRef.current.children[activeIdx] as HTMLElement;
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx]);

  const selectSuggestion = (item: SearchSuggestion) => {
    setQuery(item.name);
    setSearchQuery(item.name);
    setSearchSuggestions([]);
    addToSearchHistory(item);
    setSelectedItem(item);
    setSelectedSearchResult(item);
    setActiveIdx(-1);
  };

  const performFullSearch = useCallback(async (q: string) => {
    if (q.length < 1) return;
    setIsFullSearching(true);
    setSearchSuggestions([]);
    try {
      const res = await mapApi.search(q, userLocation?.lat, userLocation?.lng, 50);
      const data = res.data?.data || res.data || [];
      setSearchResults(data);
      if (data.length > 0) {
        setMapCenter({ lat: data[0].lat, lng: data[0].lng });
        setZoom(14);
      }
    } catch {
      setSearchResults([]);
    } finally {
      setIsFullSearching(false);
    }
  }, [userLocation, setMapCenter, setZoom]);

  const calculateMultiRoutes = async () => {
    if (!selectedItem || selectedTypes.length === 0 || isGoing) return;
    setIsGoing(true);
    const loc = origin || userLocation;
    if (!loc) {
      toast(t('searchPanel.enableGeolocation'), { icon: '📍' });
      setIsGoing(false);
      return;
    }
    if (!origin) setOrigin({ ...loc, name: t('searchPanel.myLocation') });

    try {
      const results = await Promise.all(
        selectedTypes.map((type) =>
          routesApi.calculate({
            originLat: loc.lat,
            originLng: loc.lng,
            destLat: selectedItem.lat,
            destLng: selectedItem.lng,
            routeType: type,
            vehicleType: selectedVehicle?.type || vehicleMode,
          }).then((r) => r.data.data?.[0]).catch(() => null),
        ),
      );
      const valid = results.filter(Boolean) as RouteResult[];
      if (valid.length === 0) { toast.error(t('searchPanel.routesNotFound')); setIsGoing(false); return; }
      setLocalRoutes(valid);
      setSelectedLocalRoute(valid[0]);
      setShowRouteResults(true);
      getWeather(selectedItem.lat, selectedItem.lng).then(setWeatherData).catch(() => {});
    } catch {
      toast.error(t('searchPanel.routeCalcFailed'));
    } finally {
      setIsGoing(false);
    }
  };

  const startFromSearch = async () => {
    if (!selectedLocalRoute || !selectedItem || isGoing) return;
    setIsGoing(true);
    const loc = origin || userLocation;
    if (!origin && loc) setOrigin({ ...loc, name: t('searchPanel.myLocation') });

    const originLat = origin?.lat || loc?.lat || 0;
    const originLng = origin?.lng || loc?.lng || 0;

    setDestination({ lat: selectedItem.lat, lng: selectedItem.lng, name: selectedItem.name });
    setCalculatedRoutes(localRoutes);
    setSelectedRoute(selectedLocalRoute);
    resetRerouteCooldown();
    setNavigation({ isNavigating: true });

    const mins = Math.round(selectedLocalRoute.duration / 60);
    const dist = selectedLocalRoute.distance >= 1
      ? `${selectedLocalRoute.distance.toFixed(1)} ${t('navigationHud.km')}`
      : `${Math.round(selectedLocalRoute.distance * 1000)} ${t('navigationHud.m')}`;
    speak(t('searchPanel.routeBuilt', { dist, mins }), true);

    try {
      const trip = await routesApi.startTrip({
            originName: origin?.name || t('searchPanel.myLocation'),
        originLat, originLng,
        destName: selectedItem.name,
        destLat: selectedItem.lat,
        destLng: selectedItem.lng,
        distance: selectedLocalRoute.distance,
        duration: selectedLocalRoute.duration,
      });
      useMapStore.getState().setActiveTrip(trip.data.data.id);
    } catch {}

    setIsGoing(false);
    toggleSearch();
    onClose?.();
  };

  const showOnMap = (item: SearchSuggestion) => {
    setMapCenter({ lat: item.lat, lng: item.lng });
    setZoom(16);
    speak(item.name, false);
    toggleSearch();
    onClose?.();
  };

  const selectCurrentLocation = () => {
    if (!userLocation) return;
    const item: SearchSuggestion = {
      id: 'my-location',
      name: t('searchPanel.myLocation'),
      lat: userLocation.lat,
      lng: userLocation.lng,
      category: 'COORDINATES',
    };
    if (inputMode === 'origin' || inputMode === 'search') {
      setOrigin({ ...userLocation, name: t('searchPanel.myLocation') });
      setQuery('');
      setInputMode('destination');
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      setSelectedItem(item);
    }
  };

  const useSavedPlace = (name: string, lat: number, lng: number) => {
    const item: SearchSuggestion = { id: name, name, lat, lng, category: 'ADDRESS' };
    selectSuggestion(item);
    setSelectedItem(item);
  };

  const navigateToSaved = async (item: SearchSuggestion) => {
    if (isGoing) return;
    setIsGoing(true);
    setDestination({ lat: item.lat, lng: item.lng, name: item.name });
    const loc = origin || userLocation;
    if (loc) {
      if (!origin) {
        const newOrigin = { ...loc, name: t('searchPanel.myLocation') };
        setOrigin(newOrigin);
        const originLat = newOrigin.lat;
        const originLng = newOrigin.lng;
        try {
          const res = await routesApi.calculate({
            originLat,
            originLng,
            destLat: item.lat, destLng: item.lng,
            routeType: selectedTypes[0] || 'FASTEST',
            vehicleType: selectedVehicle?.type || vehicleMode,
          });
          const route = res.data.data?.[0];
          if (route) {
            setCalculatedRoutes([route]);
            setSelectedRoute(route);
            const trip = await routesApi.startTrip({
              originName: newOrigin.name,
              originLat,
              originLng,
              destName: item.name, destLat: item.lat, destLng: item.lng,
              distance: route.distance,
              duration: route.duration,
            });
            useMapStore.getState().setActiveTrip(trip.data.data.id);
            resetRerouteCooldown();
            setNavigation({ isNavigating: true });

            const mins = Math.round(route.duration / 60);
            const dist = route.distance >= 1
              ? `${route.distance.toFixed(1)} ${t('navigationHud.km')}`
              : `${Math.round(route.distance * 1000)} ${t('navigationHud.m')}`;
            speak(t('searchPanel.routeBuilt', { dist, mins }), true);
          }
        } catch {
          toast.error(t('searchPanel.routeBuildFailed'));
        }
      } else {
        try {
          const res = await routesApi.calculate({
            originLat: origin.lat,
            originLng: origin.lng,
            destLat: item.lat, destLng: item.lng,
            routeType: selectedTypes[0] || 'FASTEST',
            vehicleType: selectedVehicle?.type || vehicleMode,
          });
          const route = res.data.data?.[0];
          if (route) {
            setCalculatedRoutes([route]);
            setSelectedRoute(route);
            const trip = await routesApi.startTrip({
              originName: origin.name,
              originLat: origin.lat,
              originLng: origin.lng,
              destName: item.name, destLat: item.lat, destLng: item.lng,
              distance: route.distance,
              duration: route.duration,
            });
            useMapStore.getState().setActiveTrip(trip.data.data.id);
            resetRerouteCooldown();
            setNavigation({ isNavigating: true });

            const mins = Math.round(route.duration / 60);
            const dist = route.distance >= 1
              ? `${route.distance.toFixed(1)} ${t('navigationHud.km')}`
              : `${Math.round(route.distance * 1000)} ${t('navigationHud.m')}`;
            speak(t('searchPanel.routeBuilt', { dist, mins }), true);
          }
        } catch {
          toast.error(t('searchPanel.routeBuildFailed'));
        }
      }
    }
    setIsGoing(false);
    toggleSearch();
    onClose?.();
  };

  const navigateToPlace = useCallback(async (name: string, lat: number, lng: number, label: string) => {
    if (isGoingRef.current) return;
    setIsGoing(true);
    const loc = origin || userLocation;
    if (!loc) {
      toast(t('searchPanel.enableGeolocation'), { icon: '📍' });
      setIsGoing(false);
      return;
    }
    if (!origin) setOrigin({ ...loc, name: t('searchPanel.myLocation') });
    setDestination({ lat, lng, name });
    try {
      const res = await routesApi.calculate({
        originLat: loc.lat, originLng: loc.lng,
        destLat: lat, destLng: lng,
        routeType: 'FASTEST',
        vehicleType: selectedVehicle?.type || vehicleMode,
      });
      const route = res.data.data?.[0];
      if (!route) { toast.error(t('searchPanel.routesNotFound')); setIsGoing(false); return; }
      setCalculatedRoutes([route]);
      setSelectedRoute(route);
      resetRerouteCooldown();
      setNavigation({ isNavigating: true });
      const trip = await routesApi.startTrip({
        originName: t('searchPanel.myLocation'),
        originLat: loc.lat, originLng: loc.lng,
        destName: name, destLat: lat, destLng: lng,
        distance: route.distance, duration: route.duration,
      });
      useMapStore.getState().setActiveTrip(trip.data.data.id);
      const mins = Math.round(route.duration / 60);
      const dist = route.distance >= 1
        ? `${route.distance.toFixed(1)} ${t('navigationHud.km')}`
        : `${Math.round(route.distance * 1000)} ${t('navigationHud.m')}`;
      speak(t('searchPanel.routeBuilt', { dist, mins }), true);
    } catch { toast.error(t('searchPanel.routeBuildFailed')); }
    setIsGoing(false);
    toggleSearch();
    onClose?.();
  }, [origin, userLocation, setOrigin, setDestination, setCalculatedRoutes, setSelectedRoute,
      setNavigation, selectedVehicle, vehicleMode, speak, toggleSearch, onClose, t]);

  const quickDestinations = [
    (user?.homeAddress && user.homeLat && user.homeLng) ? {
      name: user.homeAddress,
      label: t('searchPanel.home'), icon: <FaHome size={14} />,
      lat: user.homeLat, lng: user.homeLng,
    } : null,
    (user?.workAddress && user.workLat && user.workLng) ? {
      name: user.workAddress,
      label: t('searchPanel.work'), icon: <FaBriefcase size={14} />,
      lat: user.workLat, lng: user.workLng,
    } : null,
  ].filter(Boolean) as any[];

  const categoryClick = (cat: string) => {
    if (!userLocation) { toast(t('searchPanel.enableGeolocation'), { icon: '📍' }); return; }
    if (isGoing) return;
    setQuery('');
    setSearchSuggestions([]);
    setIsFullSearching(true);
    mapApi.getNearby(userLocation.lat, userLocation.lng, 15, cat).then((res) => {
      const objs = (res.data.data || res.data || []).map((o: any) => ({
        ...o,
        category: o.category || cat,
        distance: o.distance || undefined,
      }));
      if (objs.length > 0) {
        setSearchResults(objs);
        useMapStore.getState().setVisibleObjects(objs);
        setMapCenter({ lat: objs[0].lat, lng: objs[0].lng });
        setZoom(14);
        speak(t('searchPanel.foundNearby', { count: objs.length }), false);
      } else {
        setSearchResults([]);
        toast(t('searchPanel.noCategoryResults'));
      }
    }).catch(() => { setSearchResults([]); }).finally(() => {
      setIsFullSearching(false);
    });
  };

  const handleBookmark = async () => {
    if (!selectedItem || !user) { toast.error(t('searchPanel.loginToSave')); return; }
    try {
      await mapApi.addBookmark({
        mapObjectId: selectedItem.id,
        name: selectedItem.name,
        lat: selectedItem.lat,
        lng: selectedItem.lng,
        address: selectedItem.address,
      });
      setIsBookmarked(true);
      toast.success(t('searchPanel.placeSaved'));
    } catch {
      toast.error(t('searchPanel.placeSaveFailed'));
    }
  };

  const getEmoji = (cat: string) => CATEGORY_EMOJI[cat] || '📍';

  // Selected item detail view
  if (selectedItem) {
    return (
        <div ref={panelRef} data-search-panel className="fixed inset-0 z-50 flex items-end md:items-center justify-center">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/40"
            onClick={(e) => { e.stopPropagation(); setSelectedItem(null); setSelectedSearchResult(null); }}
          />
          <motion.div
            initial={{ opacity: 0, y: 100 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 100 }}
            transition={{ type: 'spring', damping: 30, stiffness: 400 }}
            className="relative bg-dark-card/98 backdrop-blur-2xl rounded-t-2xl md:rounded-2xl shadow-2xl border border-white/10 w-full max-w-md mx-0 md:mx-4 mb-0 md:mb-0 overflow-hidden max-h-[90vh] safe-bottom"
          >
          {/* Header */}
          <div className="flex items-center gap-3 p-4 border-b border-dark-border">
            <button onClick={() => { setSelectedItem(null); setSelectedSearchResult(null); setQuery(''); inputRef.current?.focus(); }}
              className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 transition-all">
              <FaChevronLeft size={14} className="text-gray-400" />
            </button>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-white truncate">{selectedItem.name}</p>
              {selectedItem.address && (
                <p className="text-[11px] text-gray-500 truncate">{selectedItem.address}</p>
              )}
            </div>
            <button onClick={handleBookmark}
              className={`w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 transition-all ${isBookmarked ? 'text-accent-400' : 'text-gray-500'}`}>
              {isBookmarked ? <FaBookmark size={14} /> : <FaRegBookmark size={14} />}
            </button>
            <button onClick={() => { setSelectedItem(null); setSelectedSearchResult(null); toggleSearch(); onClose?.(); }}
              className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 transition-all">
              <FaTimes size={14} className="text-gray-500" />
            </button>
          </div>

          {/* Info */}
          <div className="px-4 py-3 space-y-2">
            <div className="flex items-center gap-3">
              <span className="text-2xl">{getEmoji(selectedItem.category)}</span>
              <div>
                <p className="text-sm text-white">{selectedItem.name}</p>
                {selectedItem.address && <p className="text-xs text-gray-500">{selectedItem.address}</p>}
              </div>
              {(selectedItem as any).rating && (
                <div className="ml-auto flex items-center gap-1 text-yellow-400 text-xs">
                  <FaStar size={10} /> {(selectedItem as any).rating.toFixed(1)}
                </div>
              )}
            </div>
            {(selectedItem as any).distance && (
              <p className="text-xs text-gray-500">{t('searchPanel.distance', { distance: formatDistance((selectedItem as any).distance) })}</p>
            )}
          </div>

          {/* Vehicle selector (only if >1) */}
          {vehicles.length > 1 && selectedVehicle && (
            <div className="px-4 pb-2 relative">
              <p className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold mb-1">{t('searchPanel.transport')}</p>
              <button onClick={() => setShowVehiclePicker(!showVehiclePicker)}
                className="w-full flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-all text-left">
                <div className={`w-6 h-6 rounded-lg flex items-center justify-center text-[10px] ${
                  selectedVehicle.fuelType === 'ELECTRIC' ? 'bg-green-600/20 text-green-400' :
                  selectedVehicle.fuelType === 'DIESEL' ? 'bg-orange-600/20 text-orange-400' :
                  'bg-yellow-600/20 text-yellow-400'
                }`}>
                  {selectedVehicle.type === 'TRUCK' ? <FaTruck size={10} /> : <FaCar size={10} />}
                </div>
                <span className="text-xs text-white font-medium flex-1 truncate">{selectedVehicle.make} {selectedVehicle.model} · {selectedVehicle.year}</span>
                <FaChevronDown size={9} className="text-gray-500" />
              </button>
              <AnimatePresence>
                {showVehiclePicker && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    className="absolute z-10 left-4 right-4 mt-1 bg-dark-card border border-dark-border rounded-xl overflow-hidden shadow-2xl"
                  >
                    {vehicles.filter(v => v.id !== selectedVehicle.id).map(v => (
                      <button key={v.id} onClick={() => { setSelectedVehicle(v); setShowVehiclePicker(false); }}
                        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-white/5 transition-all text-left">
                        <div className={`w-6 h-6 rounded-lg flex items-center justify-center text-[10px] ${
                          v.fuelType === 'ELECTRIC' ? 'bg-green-600/20 text-green-400' :
                          v.fuelType === 'DIESEL' ? 'bg-orange-600/20 text-orange-400' :
                          'bg-yellow-600/20 text-yellow-400'
                        }`}>
                          {v.type === 'TRUCK' ? <FaTruck size={10} /> : <FaCar size={10} />}
                        </div>
                        <span className="text-xs text-white font-medium truncate">{v.make} {v.model} · {v.year}</span>
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}

          {/* Route type selector (multi-select) */}
          <div className="px-4 pb-2">
            <p className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold mb-1.5">{t('searchPanel.routeType')}</p>
            <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-thin">
              {ROUTE_OPTIONS.map((opt) => {
                const selected = selectedTypes.includes(opt.key);
                return (
                  <button key={opt.key} onClick={() => setSelectedTypes(prev =>
                    prev.includes(opt.key) ? prev.filter(rt => rt !== opt.key) : [...prev, opt.key]
                  )}
                    className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all whitespace-nowrap ${
                      selected
                        ? 'bg-primary-600/30 text-white border border-primary-500/40'
                        : 'bg-white/5 text-gray-400 hover:bg-white/10 border border-transparent'
                    }`}>
                    <span className={opt.color}>{opt.icon}</span>
                    {t(opt.labelKey)}
                  </button>
                );
              })}
            </div>
          </div>

          {!showRouteResults ? (
            /* === Mode: select types → calculate === */
            <div className="px-4 pb-4 flex gap-2">
              <button onClick={calculateMultiRoutes}
                disabled={isGoing || selectedTypes.length === 0}
                className="flex-1 h-11 bg-primary-600 hover:bg-primary-500 disabled:opacity-50 rounded-xl text-white text-sm font-semibold flex items-center justify-center gap-2 transition-all"
              >
                {isGoing ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  : <><FaArrowRight size={12} /> {t('searchPanel.calculate')}</>}
              </button>
              <button onClick={() => showOnMap(selectedItem)}
                className="h-11 px-4 bg-white/10 hover:bg-white/15 rounded-xl text-white text-sm flex items-center justify-center gap-2 transition-all">
                <FaMapMarkerAlt size={12} /> {t('searchPanel.onMap')}
              </button>
              <button onClick={() => {
                setInputMode('origin');
                setSelectedItem(null);
                setSelectedSearchResult(null);
                setQuery('');
                setTimeout(() => inputRef.current?.focus(), 50);
              }} className="h-11 px-4 bg-white/10 hover:bg-white/15 rounded-xl text-white text-sm flex items-center justify-center gap-2 transition-all">
                <FaPlus size={12} />
              </button>
            </div>
          ) : (
            /* === Mode: compare results → navigate === */
            <div className="px-4 pb-4 space-y-3">
              <p className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">{t('searchPanel.routesFound', { count: localRoutes.length })}</p>

              {/* Weather at destination */}
              {weatherData && (
                <div className="flex items-center gap-2 text-xs text-gray-400 bg-white/5 rounded-xl px-3 py-2">
                  <span>{weatherData.icon}</span>
                  <span>{Math.round(weatherData.temp)}°C, {weatherData.condition}</span>
                  <span className="text-gray-500">{' · '}{Math.round(weatherData.windSpeed)} {t('searchPanel.ms', 'м/с')}</span>
                </div>
              )}

              {localRoutes.map((route, i) => {
                const cfg = ROUTE_OPTIONS.find(o => o.key === route.type) || ROUTE_OPTIONS[0];
                const isSelected = selectedLocalRoute?.type === route.type;
                const durationMin = Math.round(route.duration / 60);
                const distStr = route.distance >= 1
                  ? `${route.distance.toFixed(1)} ${t('searchPanel.km')}`
                  : `${Math.round(route.distance * 1000)} ${t('searchPanel.m')}`;
                return (
                  <button key={route.type} onClick={() => setSelectedLocalRoute(route)}
                    className={`w-full p-3 rounded-2xl border transition-all text-left ${
                      isSelected ? 'bg-primary-600/20 border-primary-500/50' : 'bg-white/5 border-white/10 hover:bg-white/10'
                    }`}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className={cfg.color}>{cfg.icon}</span>
                      <span className="font-semibold text-white text-sm">{t(cfg.labelKey)}</span>
                      {i === 0 && <span className="text-[10px] bg-primary-600/40 text-primary-300 px-2 py-0.5 rounded-full">{t('searchPanel.recommended')}</span>}
                    </div>
                    <p className="text-xs text-gray-400">{route.summary}</p>
                    <div className="flex gap-3 mt-2 text-[11px] text-gray-400">
                      <span>⏱ {durationMin < 60 ? `${durationMin} ${t('routePanel.formatDuration.min')}` : `${Math.floor(durationMin / 60)}${t('routePanel.formatDuration.h')} ${durationMin % 60}${t('routePanel.formatDuration.m')}`}</span>
                      <span>⛽ {route.fuelEstimate} {t('routePanel.liters')}</span>
                      <span>⚠ {route.hazardCount}</span>
                      <span>🌱 {route.ecoScore}</span>
                      {selectedVehicle?.fuelType && (
                        <span className={
                          selectedVehicle.fuelType === 'ELECTRIC' ? 'text-green-400' :
                          selectedVehicle.fuelType === 'DIESEL' ? 'text-orange-400' :
                          'text-yellow-400'
                        }>
                          {selectedVehicle.fuelType === 'ELECTRIC' ? '⚡' :
                           selectedVehicle.fuelType === 'DIESEL' ? '⛽' : '⛽'}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
              <div className="flex gap-2">
                <button onClick={startFromSearch}
                  disabled={!selectedLocalRoute || isGoing}
                  className="flex-1 h-11 bg-primary-600 hover:bg-primary-500 disabled:opacity-50 rounded-xl text-white text-sm font-semibold flex items-center justify-center gap-2 transition-all">
                  {isGoing ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    : <><FaCompass size={14} /> {t('searchPanel.start')}</>}
                </button>
                <button onClick={() => { setShowRouteResults(false); setLocalRoutes([]); }}
                  className="h-11 px-4 bg-white/10 hover:bg-white/15 rounded-xl text-white text-sm transition-all">
                  {t('searchPanel.back')}
                </button>
              </div>
            </div>
          )}
        </motion.div>
      </div>
    );
  }

  return (
    <div ref={panelRef} data-search-panel className="fixed top-0 left-0 right-0 bottom-0 z-50 flex items-start justify-center pt-16 md:pt-24 safe-top">
      <motion.div
        initial={{ opacity: 0, y: -8, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -8, scale: 0.97 }}
        transition={{ type: 'spring', damping: 30, stiffness: 400 }}
        className="bg-dark-card/98 backdrop-blur-2xl rounded-2xl shadow-2xl border border-white/10 w-full max-w-lg mx-2 sm:mx-4 md:mx-6 overflow-hidden max-h-[85vh] flex flex-col"
      >
        {/* === Top bar === */}
        <div className="flex items-center gap-3 px-4 pt-4 pb-3 border-b border-dark-border">
          <div className="w-9 h-9 rounded-xl bg-primary-600/20 flex items-center justify-center flex-shrink-0">
            <FaSearch size={14} className="text-primary-400" />
          </div>
          <div className="flex-1 relative">
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={handleInputChange}
              onFocus={handleInputFocus}
              onKeyDown={handleKeyDown}
              placeholder={inputMode === 'origin' ? t('searchPanel.fromPlaceholder') : inputMode === 'destination' ? t('searchPanel.toPlaceholder') : t('searchPanel.searchPlaceholder')}
              className="w-full bg-transparent text-sm text-white placeholder-gray-500 outline-none"
              autoFocus
              autoComplete="off"
            />
            {isSearching && (
              <div className="absolute right-0 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-primary-500/30 border-t-primary-500 rounded-full animate-spin" />
            )}
          </div>
          <button onClick={() => { toggleSearch(); onClose?.(); }}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 transition-all">
            <FaTimes size={14} className="text-gray-500" />
          </button>
        </div>

        {/* === Mode toggle (origin / destination) === */}
        <div className="flex items-center gap-1 px-4 pt-2">
          <button onClick={() => setInputMode('origin')}
            className={`text-[11px] px-2.5 py-1 rounded-lg transition-all ${inputMode === 'origin' ? 'bg-green-500/20 text-green-400' : 'text-gray-500 hover:text-gray-300'}`}>
            <FaDotCircle size={8} className="inline mr-1" /> {t('searchPanel.from')}
          </button>
          <FaArrowRight size={8} className="text-gray-600" />
          <button onClick={() => setInputMode('destination')}
            className={`text-[11px] px-2.5 py-1 rounded-lg transition-all ${inputMode === 'destination' ? 'bg-accent-500/20 text-accent-400' : 'text-gray-500 hover:text-gray-300'}`}>
            <FaMapMarkerAlt size={8} className="inline mr-1" /> {t('searchPanel.to')}
          </button>
          <div className="flex-1" />
          <span className="text-[10px] text-gray-600">
            {inputMode === 'search' ? t('searchPanel.searchMode') : inputMode === 'origin' ? t('searchPanel.origin') : t('searchPanel.destination')}
          </span>
        </div>

        {/* === Content === */}
        <div ref={listRef} className="flex-1 overflow-y-auto">
          {isGoing ? (
            <div className="flex flex-col items-center py-10">
              <div className="w-8 h-8 border-3 border-primary-500/30 border-t-primary-500 rounded-full animate-spin mb-3" />
              <p className="text-sm text-gray-400">{t('searchPanel.buildingRoute')}</p>
            </div>
          ) : isFullSearching ? (
            <div className="flex flex-col items-center py-10">
              <div className="w-8 h-8 border-3 border-primary-500/30 border-t-primary-500 rounded-full animate-spin mb-3" />
              <p className="text-sm text-gray-400">{t('searchPanel.searchPlaceholder')}</p>
            </div>
          ) : searchResults.length > 0 ? (
            /* === Full search results / category results === */
            <div className="py-1">
              <div className="flex items-center justify-between px-4 py-2 border-b border-dark-border">
                <p className="text-[11px] text-gray-500 uppercase tracking-wider font-semibold">{t('searchPanel.foundResults', { count: searchResults.length })}</p>
                <button onClick={() => { setSearchResults([]); setQuery(''); setSearchQuery(''); }}
                  className="text-[10px] text-gray-600 hover:text-gray-400 flex items-center gap-1">
                  <FaTimes size={9} /> {t('searchPanel.back')}
                </button>
              </div>
              {searchResults.map((item, idx) => (
                <button
                  key={item.id || idx}
                  onClick={() => selectSuggestion(item)}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 transition-all text-left hover:bg-white/5`}
                >
                  <span className="text-base flex-shrink-0">{getEmoji(item.category)}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white truncate">{item.name}</p>
                    {item.address && (
                      <p className="text-[11px] text-gray-500 truncate">{item.address}</p>
                    )}
                  </div>
                  {item.distance !== undefined && item.distance > 0 && (
                    <span className="text-[11px] text-gray-500 flex-shrink-0">{formatDistance(item.distance)}</span>
                  )}
                  <div className="flex gap-1 flex-shrink-0">
                    <span onClick={(e) => { e.stopPropagation(); navigateToSaved(item); }}
                      className="text-[10px] px-2 py-0.5 rounded bg-primary-600/20 text-primary-400 hover:bg-primary-600/30">
                      {t('searchPanel.navigate')}
                    </span>
                    <span onClick={(e) => { e.stopPropagation(); showOnMap(item); }}
                      className="text-[10px] px-2 py-0.5 rounded bg-white/10 text-gray-400 hover:bg-white/20">
                      {t('searchPanel.showOnMap')}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          ) : suggestions.length > 0 ? (
            /* === Autocomplete results === */
            <div className="py-1">
              {suggestions.map((item, idx) => (
                <button
                  key={item.id}
                  onClick={() => selectSuggestion(item)}
                  onMouseEnter={() => setActiveIdx(idx + historyItems.length)}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 transition-all text-left ${
                    activeIdx === idx + historyItems.length ? 'bg-white/10' : 'hover:bg-white/5'
                  }`}
                >
                  <span className="text-base flex-shrink-0">{getEmoji(item.category)}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white truncate">{item.name}</p>
                    {item.address && (
                      <p className="text-[11px] text-gray-500 truncate">{item.address}</p>
                    )}
                  </div>
                  {item.distance !== undefined && item.distance > 0 && (
                    <span className="text-[11px] text-gray-500 flex-shrink-0">{formatDistance(item.distance)}</span>
                  )}
                  {item.rating && (
                    <span className="text-[11px] text-yellow-400 flex items-center gap-0.5 flex-shrink-0">
                      <FaStar size={8} /> {item.rating.toFixed(1)}
                    </span>
                  )}
                  <FaArrowRight size={10} className="text-gray-600 flex-shrink-0" />
                </button>
              ))}
            </div>
          ) : query.length === 0 && !selectedItem ? (
            /* === Empty state: history + quick categories + saved places === */
            <div className="px-4 py-3 space-y-4">
              {/* Quick categories */}
              <div>
                <p className="text-[11px] text-gray-500 uppercase tracking-wider font-semibold mb-2">{t('searchPanel.whatLookingFor')}</p>
                <div className="flex flex-wrap gap-1.5">
                  {QUICK_CATEGORIES.map((cat) => (
                    <button key={cat.key} onClick={() => categoryClick(cat.key)}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs text-gray-300 transition-all">
                      <span style={{ color: cat.color }}>{cat.icon}</span>
                      {t(cat.labelKey)}
                    </button>
                  ))}
                </div>
              </div>

              {/* Saved places */}
              {quickDestinations.length > 0 && (
                <div>
                  <p className="text-[11px] text-gray-500 uppercase tracking-wider font-semibold mb-2">{t('searchPanel.saved')}</p>
                  <div className="space-y-0.5">
                  {quickDestinations.map((d) => (
                      <button key={d.label} onClick={() => { navigateToPlace(d.name, d.lat, d.lng, d.label); }}
                        className="w-full flex items-center gap-3 px-3 py-2 rounded-xl bg-white/5 hover:bg-primary-600/20 transition-all text-left group border border-white/10 hover:border-primary-500/30">
                        <div className="w-8 h-8 rounded-lg bg-primary-600/20 flex items-center justify-center text-primary-400">{d.icon}</div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-white font-medium">{d.label}</p>
                          <p className="text-[11px] text-gray-500 truncate">{d.name}</p>
                        </div>
                        <FaArrowRight size={10} className="text-primary-400 opacity-0 group-hover:opacity-100 transition-all" />
                      </button>
                    ))}
                  </div>
                </div>
              )}

                {/* My location */}
                {userLocation && (
                <button onClick={selectCurrentLocation}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl bg-primary-600/10 hover:bg-primary-600/20 transition-all border border-primary-500/20 text-left">
                  <div className="w-8 h-8 rounded-lg bg-primary-600/20 flex items-center justify-center">
                    <FaCompass size={14} className="text-primary-400" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-white">{t('searchPanel.myLocation')}</p>
                    <p className="text-[11px] text-gray-500">{t('searchPanel.currentCoords')}</p>
                  </div>
                </button>
              )}

              {/* Recent searches */}
              {searchHistory.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[11px] text-gray-500 uppercase tracking-wider font-semibold">{t('searchPanel.recent')}</p>
                    <button onClick={clearSearchHistory}
                      className="text-[10px] text-gray-600 hover:text-gray-400 transition-all flex items-center gap-1">
                      <FaTrash size={9} /> {t('searchPanel.clear')}
                    </button>
                  </div>
                  <div className="space-y-0.5">
                    {searchHistory.map((item, idx) => (
                      <button key={`${item.id}-${idx}`} onClick={() => selectSuggestion(item)}
                        onMouseEnter={() => setActiveIdx(idx)}
                        className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl transition-all text-left group ${
                          activeIdx === idx ? 'bg-white/10' : 'hover:bg-white/5'
                        }`}>
                        <FaHistory size={12} className="text-gray-600 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-white truncate">{item.name}</p>
                          {item.address && <p className="text-[11px] text-gray-500 truncate">{item.address}</p>}
                        </div>
                        <div className="flex gap-1">
                          <button onClick={(e) => { e.stopPropagation(); navigateToSaved(item); }}
                            className="text-[10px] px-2 py-0.5 rounded bg-primary-600/20 text-primary-400 hover:bg-primary-600/30 transition-all">
                            {t('searchPanel.routeAction')}
                          </button>
                          <button onClick={(e) => { e.stopPropagation(); showOnMap(item); }}
                            className="text-[10px] px-2 py-0.5 rounded bg-white/10 text-gray-400 hover:bg-white/20 transition-all">
                            {t('searchPanel.mapAction')}
                          </button>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {!userLocation && quickDestinations.length === 0 && searchHistory.length === 0 && (
                <div className="flex flex-col items-center py-8 text-center">
                  <FaSearch size={28} className="text-gray-700 mb-2" />
                  <p className="text-sm text-gray-500">{t('searchPanel.startTyping')}</p>
                </div>
              )}
            </div>
          ) : (
            /* No results */
            <div className="flex flex-col items-center py-8 text-center">
              <FaSearch size={24} className="text-gray-700 mb-2" />
              <p className="text-sm text-gray-500">{t('searchPanel.noResults')}</p>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
