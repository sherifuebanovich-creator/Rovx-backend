'use client';
import { useEffect, useRef, useCallback, useState } from 'react';
import maplibregl from 'maplibre-gl';
import { useMapStore } from '@/store/map.store';
import {
  createBlueDotElements,
  updateBlueDotAccuracy,
  updateBlueDotHeading,
  accuracyCircleGeoJSON,
  type BlueDotElements,
} from '@/lib/maplibreIcons';
import { speedToAutoZoom } from '@/lib/navigationEngine';

const INTERPOLATION_DURATION_MS = 600;
const FOLLOW_THRESHOLD_PX = 60;

interface Props {
  map: maplibregl.Map | null;
}

export default function UserLocationLayer({ map }: Props) {
  const blueDotRef = useRef<BlueDotElements | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const accuracySourceId = 'user-accuracy-circle';
  const accuracyLayerId = 'user-accuracy-fill';
  const accuracyBorderId = 'user-accuracy-border';

  const animFromRef = useRef<{ lat: number; lng: number; heading: number } | null>(null);
  const animToRef = useRef<{ lat: number; lng: number; heading: number } | null>(null);
  const animStartRef = useRef(0);
  const rafIdRef = useRef(0);

  const userDragRef = useRef(false);
  const followTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const compassModeRef = useRef(false);

  const [followActive, setFollowActive] = useState(true);
  const [compassMode, setCompassMode] = useState(false);
  const followActiveRef = useRef(true);
  const compassModeRefState = useRef(false);

  const userLocation = useMapStore((s) => s.userLocation);
  const userHeading = useMapStore((s) => s.userHeading);
  const userAccuracy = useMapStore((s) => s.userAccuracy);
  const userSpeed = useMapStore((s) => s.userSpeed);
  const locationError = useMapStore((s) => s.locationError);
  const setFollowUser = useMapStore((s) => s.setFollowUser);
  const navigation = useMapStore((s) => s.navigation);
  const isNavigatingRef = useRef(false);
  const prevPitchRef = useRef(0);
  const prevBearingRef = useRef(0);

  const initAccuracySource = useCallback(
    (m: maplibregl.Map) => {
      try {
        if (m.getSource(accuracySourceId)) return;
        m.addSource(accuracySourceId, {
          type: 'geojson',
          data: { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[]] } },
        });
        m.addLayer({
          id: accuracyLayerId,
          type: 'fill',
          source: accuracySourceId,
          paint: { 'fill-color': 'rgba(14,165,233,0.08)', 'fill-opacity': 1 },
        }, undefined);
        m.addLayer({
          id: accuracyBorderId,
          type: 'line',
          source: accuracySourceId,
          paint: { 'line-color': 'rgba(14,165,233,0.25)', 'line-width': 1.5 },
        }, undefined);
      } catch { /* ignore if already exists */ }
    },
    [],
  );

  useEffect(() => {
    if (!map) return;

    const onUserDrag = () => {
      if (!compassModeRef.current) {
        userDragRef.current = true;
        if (followActiveRef.current) {
          followActiveRef.current = false;
          setFollowActive(false);
          setFollowUser(false);
        }
        clearTimeout(followTimeoutRef.current);
        followTimeoutRef.current = setTimeout(() => {
          if (map && useMapStore.getState().userLocation) {
            followActiveRef.current = true;
            setFollowActive(true);
            setFollowUser(true);
          }
        }, 5000);
      }
    };

    map.on('dragstart', onUserDrag);
    map.on('zoomstart', onUserDrag);

    initAccuracySource(map);

    const onStyleData = () => {
      if (map && map.isStyleLoaded()) {
        initAccuracySource(map);
      }
    };
    map.on('style.load', onStyleData);

    return () => {
      map.off('dragstart', onUserDrag);
      map.off('zoomstart', onUserDrag);
      map.off('style.load', onStyleData);
      clearTimeout(followTimeoutRef.current);
      cancelAnimationFrame(rafIdRef.current);

      if (markerRef.current) {
        markerRef.current.remove();
        markerRef.current = null;
      }
      try {
        if (map.getLayer(accuracyLayerId)) map.removeLayer(accuracyLayerId);
        if (map.getLayer(accuracyBorderId)) map.removeLayer(accuracyBorderId);
        if (map.getSource(accuracySourceId)) map.removeSource(accuracySourceId);
      } catch { /* ignore */ }
    };
  }, [map, initAccuracySource, setFollowUser]);

  useEffect(() => {
    compassModeRef.current = compassMode;
    compassModeRefState.current = compassMode;
  }, [compassMode]);

  // Auto-bear/pitch/zoom during navigation (Yandex style)
  useEffect(() => {
    if (!map) return;

    const wasNavigating = isNavigatingRef.current;
    isNavigatingRef.current = navigation.isNavigating;

    if (navigation.isNavigating && !wasNavigating) {
      prevPitchRef.current = map.getPitch();
      prevBearingRef.current = map.getBearing();

      map.easeTo({ pitch: 60, duration: 800 });

      compassModeRef.current = true;
      compassModeRefState.current = true;
      followActiveRef.current = true;
      setFollowActive(true);
      setFollowUser(true);
    } else if (!navigation.isNavigating && wasNavigating) {
      compassModeRef.current = false;
      compassModeRefState.current = false;
      setCompassMode(false);

      map.easeTo({
        pitch: prevPitchRef.current,
        bearing: 0,
        duration: 600,
      });
    }
  }, [navigation.isNavigating, map, setFollowUser]);

  useEffect(() => {
    if (!map || !userLocation) return;
    if (!isFinite(userLocation.lat) || !isFinite(userLocation.lng)) return;

    if (!blueDotRef.current) {
      blueDotRef.current = createBlueDotElements();
      const marker = new maplibregl.Marker({ element: blueDotRef.current.container, anchor: 'center' })
        .setLngLat([userLocation.lng, userLocation.lat])
        .addTo(map);
      markerRef.current = marker;

      blueDotRef.current.dotOuter.addEventListener('click', () => {
        followActiveRef.current = true;
        setFollowActive(true);
        setFollowUser(true);
        userDragRef.current = false;
      });
    }

    animFromRef.current = animToRef.current
      ? { ...animToRef.current }
      : { lat: userLocation.lat, lng: userLocation.lng, heading: userHeading };

    animToRef.current = { lat: userLocation.lat, lng: userLocation.lng, heading: userHeading };
    animStartRef.current = performance.now();

    const interpolate = (now: number) => {
      if (!blueDotRef.current || !markerRef.current || !map) return;

      const elapsed = now - animStartRef.current;
      const t = Math.min(elapsed / INTERPOLATION_DURATION_MS, 1);
      const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;

      const from = animFromRef.current;
      const to = animToRef.current;
      if (!from || !to) return;

      const lat = from.lat + (to.lat - from.lat) * ease;
      const lng = from.lng + (to.lng - from.lng) * ease;
      if (!isFinite(lat) || !isFinite(lng)) return;
      const heading = interpolateHeading(from.heading, to.heading, ease);

      markerRef.current.setLngLat([lng, lat]);
      updateBlueDotHeading(blueDotRef.current, heading);

      if (compassModeRefState.current && map) {
        const currentBearing = map.getBearing();
        const targetBearing = -heading;
        const bearingDiff = normalizeAngle(targetBearing - currentBearing);
        if (Math.abs(bearingDiff) > 0.5) {
          map.rotateTo(currentBearing + bearingDiff * 0.15, { duration: 0 });
        }
      }

      if (t < 1) {
        rafIdRef.current = requestAnimationFrame(interpolate);
      }
    };

    cancelAnimationFrame(rafIdRef.current);
    rafIdRef.current = requestAnimationFrame(interpolate);
  }, [map, userLocation, userHeading, setFollowUser]);

  useEffect(() => {
    if (!blueDotRef.current || !map || !userLocation) return;
    updateBlueDotAccuracy(blueDotRef.current, userAccuracy || 50, map.getZoom(), userLocation.lat);
  }, [map, userLocation, userAccuracy]);

  useEffect(() => {
    if (!map || !userLocation) return;

    try {
      const geojson = accuracyCircleGeoJSON(userLocation.lat, userLocation.lng, userAccuracy || 50);
      const source = map.getSource(accuracySourceId) as maplibregl.GeoJSONSource;
      if (source) {
        source.setData(geojson as any);
      }
    } catch { /* ignore */ }
  }, [map, userLocation, userAccuracy]);

  useEffect(() => {
    if (!map || !userLocation || !followActive) return;

    const cur = map.getCenter();
    const p1 = map.project([cur.lng, cur.lat]);
    const p2 = map.project([userLocation.lng, userLocation.lat]);
    const distPx = Math.hypot(p1.x - p2.x, p1.y - p2.y);

    const isNav = isNavigatingRef.current;
    const targetZoom = isNav ? speedToAutoZoom(userSpeed) : undefined;
    const currentZoom = map.getZoom();
    const zoomDiff = targetZoom != null ? Math.abs(currentZoom - targetZoom) : 0;

    if (distPx > FOLLOW_THRESHOLD_PX || (isNav && zoomDiff > 0.3)) {
      const opts: maplibregl.CameraOptions & maplibregl.AnimationOptions = {
        center: [userLocation.lng, userLocation.lat],
        duration: isNav ? 500 : 800,
        easing: (t: number) => t * (2 - t),
      };
      if (isNav && targetZoom != null && zoomDiff > 0.3) {
        opts.zoom = targetZoom;
      }
      map.easeTo(opts);
    }
  }, [map, userLocation, followActive, userSpeed]);

  const handleRecenter = useCallback(() => {
    if (!map || !userLocation) return;
    followActiveRef.current = true;
    setFollowActive(true);
    setFollowUser(true);
    userDragRef.current = false;
    clearTimeout(followTimeoutRef.current);

    map.easeTo({
      center: [userLocation.lng, userLocation.lat],
      zoom: Math.max(map.getZoom(), 15),
      duration: 600,
      easing: (t) => t * (2 - t),
    });
  }, [map, userLocation, setFollowUser]);

  const handleToggleCompass = useCallback(() => {
    setCompassMode((prev) => {
      const next = !prev;
      if (next && map && userLocation) {
        map.rotateTo(-userHeading, { duration: 400 });
      } else if (!next && map) {
        map.rotateTo(0, { duration: 400 });
      }
      return next;
    });
  }, [map, userLocation, userHeading]);

  return (
    <>
      {!followActive && userLocation && !navigation.isNavigating && (
        <button
          onClick={handleRecenter}
          className="absolute z-40 flex items-center justify-center rounded-full shadow-lg transition-all active:scale-95"
          style={{
            bottom: '140px',
            right: '16px',
            width: '48px',
            height: '48px',
            background: 'rgba(14,165,233,0.9)',
            backdropFilter: 'blur(8px)',
            border: '2px solid rgba(255,255,255,0.3)',
          }}
          aria-label="Center on my location"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <line x1="12" y1="2" x2="12" y2="6" />
            <line x1="12" y1="18" x2="12" y2="22" />
            <line x1="2" y1="12" x2="6" y2="12" />
            <line x1="18" y1="12" x2="22" y2="12" />
          </svg>
        </button>
      )}

      {userLocation && userSpeed > 2 && !navigation.isNavigating && (
        <button
          onClick={handleToggleCompass}
          className="absolute z-40 flex items-center justify-center rounded-full shadow-lg transition-all active:scale-95"
          style={{
            bottom: '200px',
            right: '16px',
            width: '40px',
            height: '40px',
            background: compassMode ? 'rgba(14,165,233,0.95)' : 'rgba(30,30,30,0.8)',
            backdropFilter: 'blur(8px)',
            border: `2px solid ${compassMode ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.15)'}`,
            transition: 'all 0.3s ease',
          }}
          aria-label="Toggle compass mode"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="white"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ transform: compassMode ? `rotate(${userHeading}deg)` : 'none', transition: 'transform 0.4s ease' }}
          >
            <polygon points="12,2 15,10 12,8 9,10" fill="white" stroke="none" />
            <polygon points="12,22 9,14 12,16 15,14" fill="rgba(255,255,255,0.4)" stroke="none" />
            <circle cx="12" cy="12" r="10" strokeOpacity="0.4" />
          </svg>
        </button>
      )}

      {locationError && (
        <div
          className="absolute z-40 left-1/2 -translate-x-1/2 px-4 py-2 rounded-xl text-xs font-medium"
          style={{
            bottom: '120px',
            background: 'rgba(239,68,68,0.9)',
            color: 'white',
            backdropFilter: 'blur(8px)',
            maxWidth: '280px',
            textAlign: 'center',
          }}
        >
          {locationError}
        </div>
      )}

      <style>{`
        @keyframes rovx-pulse {
          0% { transform: translate(-50%,-50%) translate(0,-10px) scale(1); opacity: 0.4; }
          70% { transform: translate(-50%,-50%) translate(0,-10px) scale(2.2); opacity: 0; }
          100% { transform: translate(-50%,-50%) translate(0,-10px) scale(2.2); opacity: 0; }
        }
      `}</style>
    </>
  );
}

function interpolateHeading(from: number, to: number, t: number): number {
  let diff = to - from;
  if (diff > 180) diff -= 360;
  if (diff < -180) diff += 360;
  return normalizeAngle(from + diff * t);
}

function normalizeAngle(deg: number): number {
  return ((deg % 360) + 360) % 360;
}
