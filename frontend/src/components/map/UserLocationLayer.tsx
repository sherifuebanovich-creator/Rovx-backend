'use client';
import { useEffect, useRef, useCallback, useState } from 'react';
import maplibregl from 'maplibre-gl';
import { useMapStore } from '@/store/map.store';
import {
  createBlueDotElements,
  updateBlueDotAccuracy,
  accuracyCircleGeoJSON,
  type BlueDotElements,
} from '@/lib/maplibreIcons';
import { speedToAutoZoom } from '@/lib/navigationEngine';

const INTERPOLATION_DURATION_MS = 300;
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
  const [followActive, setFollowActive] = useState(true);
  const followActiveRef = useRef(true);

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

    const onUserDragStart = () => {
      // During active turn-by-turn navigation the camera stays locked onto
      // the route; ambient drags/zooms shouldn't drop follow mode.
      if (isNavigatingRef.current) return;

      userDragRef.current = true;
      clearTimeout(followTimeoutRef.current);
      if (followActiveRef.current) {
        followActiveRef.current = false;
        setFollowActive(false);
        setFollowUser(false);
      }
    };

    const onUserDragEnd = () => {
      // Start the "return to follow" countdown only once the user actually
      // stops interacting, not from the moment the gesture began — otherwise
      // follow can snap back while they're still panning/zooming.
      clearTimeout(followTimeoutRef.current);
      followTimeoutRef.current = setTimeout(() => {
        if (map && useMapStore.getState().userLocation) {
          followActiveRef.current = true;
          setFollowActive(true);
          setFollowUser(true);
        }
      }, 5000);
    };

    map.on('dragstart', onUserDragStart);
    map.on('zoomstart', onUserDragStart);
    map.on('dragend', onUserDragEnd);
    map.on('zoomend', onUserDragEnd);

    initAccuracySource(map);

    const onStyleData = () => {
      if (map && map.isStyleLoaded()) {
        initAccuracySource(map);
      }
    };
    map.on('style.load', onStyleData);

    return () => {
      map.off('dragstart', onUserDragStart);
      map.off('zoomstart', onUserDragStart);
      map.off('dragend', onUserDragEnd);
      map.off('zoomend', onUserDragEnd);
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

  // Auto-bear/pitch/zoom during navigation (Yandex style)
  useEffect(() => {
    if (!map) return;

    const wasNavigating = isNavigatingRef.current;
    isNavigatingRef.current = navigation.isNavigating;

    if (navigation.isNavigating && !wasNavigating) {
      prevPitchRef.current = map.getPitch();
      prevBearingRef.current = map.getBearing();

      map.easeTo({ pitch: 60, duration: 800 });

      followActiveRef.current = true;
      setFollowActive(true);
      setFollowUser(true);
    } else if (!navigation.isNavigating && wasNavigating) {
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
        duration: isNav ? 300 : 800,
        easing: (t: number) => t * (2 - t),
      };
      if (isNav && targetZoom != null && zoomDiff > 0.3) {
        opts.zoom = targetZoom;
      }
      map.easeTo(opts);
    }
  }, [map, userLocation, followActive, userSpeed]);

  // Inject pulse animation once
  useEffect(() => {
    const id = 'rovx-pulse-style';
    if (document.getElementById(id)) return;
    const style = document.createElement('style');
    style.id = id;
    style.textContent = `
        @keyframes rovx-pulse {
          0% { transform: translate(-50%,-50%) translate(0,-10px) scale(1); opacity: 0.4; }
          70% { transform: translate(-50%,-50%) translate(0,-10px) scale(2.2); opacity: 0; }
          100% { transform: translate(-50%,-50%) translate(0,-10px) scale(2.2); opacity: 0; }
        }
      `;
    document.head.appendChild(style);
  }, []);

  return (
    <>
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
