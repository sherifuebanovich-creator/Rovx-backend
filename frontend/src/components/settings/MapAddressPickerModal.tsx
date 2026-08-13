'use client';
import { useState, useRef, useEffect, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useTranslation } from 'react-i18next';
import { FaTimes, FaSearch, FaMapMarkerAlt, FaCrosshairs } from 'react-icons/fa';
import { mapApi } from '@/lib/api';
import { MAP_STYLES } from '@/lib/mapStyles';
import { useMapStore } from '@/store/map.store';
import { SearchSuggestion } from '@/types';

interface MapAddressPickerModalProps {
  initial?: { lat: number; lng: number } | null;
  onConfirm: (suggestion: SearchSuggestion) => void;
  onClose: () => void;
}

// Uber/Yandex-style "drag the map, pin stays centered" picker — the
// AddressPicker text field only ever lets you commit a place by typing and
// choosing a search result, with no way to just point at a spot on the map
// (a specific building entrance, a yard, anywhere without a clean street
// address to search for).
export function MapAddressPickerModal({ initial, onConfirm, onClose }: MapAddressPickerModalProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const userLocation = useMapStore((s) => s.userLocation);
  const mapStyle = useMapStore((s) => s.mapStyle);
  const storeCenter = useMapStore((s) => s.mapCenter);

  const [center, setCenter] = useState(
    initial || userLocation || storeCenter,
  );
  const [address, setAddress] = useState('');
  const [addressLoading, setAddressLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const geocodeIdRef = useRef(0);
  const suggestFetchIdRef = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const style = MAP_STYLES[mapStyle];
    const map = new maplibregl.Map({
      container: containerRef.current,
      style,
      center: [center.lng, center.lat],
      zoom: 15,
      attributionControl: false,
    });
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
    map.on('moveend', () => {
      const c = map.getCenter();
      setCenter({ lat: c.lat, lng: c.lng });
    });
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reverse-geocode the pin position whenever it settles — debounced so
  // dragging/panning around doesn't fire a lookup per frame, only once
  // movement actually stops.
  useEffect(() => {
    const id = ++geocodeIdRef.current;
    setAddressLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await mapApi.reverseGeocode(center.lat, center.lng);
        if (id !== geocodeIdRef.current) return;
        const geo = res.data?.data || res.data;
        setAddress(geo?.name || geo?.address || `${center.lat.toFixed(5)}, ${center.lng.toFixed(5)}`);
      } catch {
        if (id === geocodeIdRef.current) setAddress(`${center.lat.toFixed(5)}, ${center.lng.toFixed(5)}`);
      } finally {
        if (id === geocodeIdRef.current) setAddressLoading(false);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [center.lat, center.lng]);

  const fetchSuggestions = useCallback((q: string) => {
    clearTimeout(debounceRef.current);
    if (!q.trim() || q.trim().length < 2) {
      setSuggestions([]);
      return;
    }
    const thisFetch = ++suggestFetchIdRef.current;
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await mapApi.suggest(q, center.lat, center.lng);
        if (thisFetch !== suggestFetchIdRef.current) return;
        setSuggestions(res.data?.data || res.data || []);
      } catch {
        if (thisFetch === suggestFetchIdRef.current) setSuggestions([]);
      }
    }, 350);
  }, [center.lat, center.lng]);

  const flyTo = (lat: number, lng: number) => {
    mapRef.current?.flyTo({ center: [lng, lat], zoom: 16, essential: true });
    setCenter({ lat, lng });
  };

  const useMyLocation = () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition((pos) => {
      flyTo(pos.coords.latitude, pos.coords.longitude);
    }, () => {}, { enableHighAccuracy: true, timeout: 8000 });
  };

  const handleConfirm = () => {
    onConfirm({
      id: `pin-${center.lat}-${center.lng}`,
      name: address || `${center.lat.toFixed(5)}, ${center.lng.toFixed(5)}`,
      address,
      lat: center.lat,
      lng: center.lng,
      category: 'ADDRESS',
    });
  };

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-dark-bg">
      {/* Search bar */}
      <div className="relative flex items-center gap-2 px-4 pt-safe-top pt-4 pb-3 border-b border-dark-border bg-dark-card/98 backdrop-blur-xl">
        <FaSearch size={13} className="text-gray-500 flex-shrink-0" />
        <input
          autoFocus
          value={query}
          onChange={(e) => { setQuery(e.target.value); setShowSuggestions(true); fetchSuggestions(e.target.value); }}
          onFocus={() => setShowSuggestions(true)}
          placeholder={t('settings.mapPickerSearchPlaceholder')}
          className="flex-1 bg-transparent text-sm text-white placeholder-gray-600 outline-none"
        />
        <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 transition-all flex-shrink-0">
          <FaTimes size={16} className="text-gray-400" />
        </button>
        {showSuggestions && suggestions.length > 0 && (
          <div className="absolute left-4 right-4 top-full mt-1 z-20 bg-dark-card border border-dark-border rounded-xl shadow-2xl max-h-60 overflow-y-auto">
            {suggestions.map((s) => (
              <button
                key={s.id}
                onClick={() => { flyTo(s.lat, s.lng); setQuery(s.address || s.name); setSuggestions([]); setShowSuggestions(false); }}
                className="w-full text-left px-3 py-2.5 text-sm text-gray-200 hover:bg-white/5 transition-all"
              >
                <p className="truncate">{s.name}</p>
                {s.address && s.address !== s.name && <p className="truncate text-xs text-gray-500">{s.address}</p>}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Map */}
      <div className="relative flex-1">
        <div ref={containerRef} className="absolute inset-0" />
        {/* Fixed center pin — stays visually centered while the map pans underneath it */}
        <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-full z-10">
          <FaMapMarkerAlt size={36} className="text-primary-500 drop-shadow-lg" />
        </div>
        <button
          onClick={useMyLocation}
          className="absolute bottom-28 right-4 w-11 h-11 rounded-full bg-dark-card border border-dark-border shadow-xl flex items-center justify-center text-primary-400 hover:bg-white/5 transition-all"
        >
          <FaCrosshairs size={16} />
        </button>
      </div>

      {/* Confirm bar */}
      <div className="px-4 pb-safe-bottom pb-4 pt-3 border-t border-dark-border bg-dark-card/98 backdrop-blur-xl">
        <p className="text-xs text-gray-500 mb-2 truncate min-h-[1rem]">
          {addressLoading ? t('settings.mapPickerLocating') : address}
        </p>
        <button
          onClick={handleConfirm}
          className="w-full h-12 rounded-xl bg-primary-600 hover:bg-primary-500 text-white text-sm font-semibold transition-all"
        >
          {t('settings.mapPickerConfirm')}
        </button>
      </div>
    </div>
  );
}
