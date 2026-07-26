'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useMapStore } from '@/store/map.store';
import { mapApi, reportsApi } from '@/lib/api';
import { MapObject, Report } from '@/types';
import {
  createCategoryMarker,
  createReportMarker,
  createPopupContent,
  createTrafficSignalMarker,
} from '@/lib/maplibreIcons';
import { MAP_STYLES, add3DBuildings, remove3DBuildings } from '@/lib/mapStyles';
import UserLocationLayer from './UserLocationLayer';
import MapFeaturesLayer from './MapFeaturesLayer';
import FriendMarkers from './FriendMarkers';
import TrafficLayer from './TrafficLayer';
import TrafficFlowLayer from './TrafficFlowLayer';

function escapeHtml(text: string): string {
  const m: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return text.replace(/[&<>"']/g, (c) => m[c]);
}

export default function MapViewGL() {
  const mapRef = useRef<maplibregl.Map | null>(null);
  // mapRef alone doesn't trigger a re-render when set, so UserLocationLayer/
  // MapFeaturesLayer/FriendMarkers/TrafficFlowLayer/TrafficLayer below (all
  // read mapRef.current directly in JSX) used to render with map={null} on
  // mount and only pick up the real instance whenever something else
  // happened to re-render this component — the blue dot, traffic, and
  // friend markers could stay missing until an unrelated state change.
  const [mapInstance, setMapInstance] = useState<maplibregl.Map | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // Keyed by object id (rather than a plain array) so a viewport update can
  // diff against what's already on the map instead of tearing down and
  // recreating every marker on every pan/zoom settle — with up to 200 POIs
  // per viewport, a full remove+recreate was a visible, janky pop-in burst
  // of synchronous DOM/Marker work even when most POIs hadn't changed.
  const objectMarkersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
  const reportMarkersRef = useRef<maplibregl.Marker[]>([]);
  const trafficMarkersRef = useRef<maplibregl.Marker[]>([]);
  const routeSourceRef = useRef<string | null>(null);
  const objectTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const reportTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const has3DBuildingsRef = useRef(false);
  const show3DRef = useRef(true);
  const trafficSignalsRequestIdRef = useRef(0);
  const objectsRequestIdRef = useRef(0);
  const reportsRequestIdRef = useRef(0);

  const mapStyle = useMapStore(s => s.mapStyle);
  const mapStyleRef = useRef(mapStyle);
  mapStyleRef.current = mapStyle;
  const selectedRoute = useMapStore(s => s.selectedRoute);
  const setVisibleObjects = useMapStore(s => s.setVisibleObjects);
  const setSelectedObject = useMapStore(s => s.setSelectedObject);
  const setSelectedReport = useMapStore(s => s.setSelectedReport);
  const setReports = useMapStore(s => s.setReports);
  const activeCategories = useMapStore(s => s.activeCategories);
  const show3D = useMapStore(s => s.show3D);

  // Individual field selectors instead of subscribing to the whole
  // `navigation` object — this component (and everything it renders, none
  // of which is memoized) would otherwise re-render on every navigation
  // update during active driving, including fields it never reads
  // (distanceToManeuver, bearingToManeuver, currentLeg, isArrived, ...).
  const routeProgress = useMapStore(s => s.navigation.routeProgress);
  const forwardIndex = useMapStore(s => s.navigation.forwardIndex);
  const isWrongWay = useMapStore(s => s.navigation.isWrongWay);
  const isNavigating = useMapStore(s => s.navigation.isNavigating);

  const setMapCenter = useMapStore(s => s.setMapCenter);
  const setZoom = useMapStore(s => s.setZoom);

  const cleanupMarkers = useCallback((markers: maplibregl.Marker[]) => {
    markers.forEach(m => m.remove());
    markers.length = 0;
  }, []);

  const cleanupMarkerMap = useCallback((markers: Map<string, maplibregl.Marker>) => {
    markers.forEach(m => m.remove());
    markers.clear();
  }, []);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const initState = useMapStore.getState();
    const initialStyle = typeof MAP_STYLES[mapStyle] === 'string'
      ? MAP_STYLES[mapStyle] as string
      : MAP_STYLES[mapStyle] as maplibregl.StyleSpecification;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: initialStyle,
      center: [initState.mapCenter.lng, initState.mapCenter.lat],
      zoom: initState.zoom,
      minZoom: 3,
      maxZoom: 21,
      attributionControl: false,
      failIfMajorPerformanceCaveat: false,
      renderWorldCopies: false,
      localIdeographFontFamily: "'Inter', 'Noto Sans', sans-serif",
      fadeDuration: 0,
    });

    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');

    map.on('moveend', () => {
      const center = map.getCenter();
      const z = map.getZoom();
      setMapCenter({ lat: center.lat, lng: center.lng });
      setZoom(z);

      const bounds = map.getBounds();
      loadObjectsInBounds(bounds);
      loadReportsInBounds(bounds);
    });

    map.on('click', () => {
      setSelectedObject(null);
      setSelectedReport(null);
    });

    map.on('idle', () => {
      if (!has3DBuildingsRef.current && mapStyleRef.current !== 'satellite' && show3DRef.current) {
        try {
          add3DBuildings(map);
          has3DBuildingsRef.current = true;
        } catch { /* ignore */ }
      }
    });

    map.on('style.load', () => {
      has3DBuildingsRef.current = false;
      if (mapStyleRef.current !== 'satellite' && show3DRef.current) {
        add3DBuildings(map);
        has3DBuildingsRef.current = true;
      }
    });

    mapRef.current = map;
    setMapInstance(map);

    return () => {
      clearTimeout(objectTimerRef.current);
      clearTimeout(reportTimerRef.current);
      cleanupMarkerMap(objectMarkersRef.current);
      cleanupMarkers(reportMarkersRef.current);
      cleanupMarkers(trafficMarkersRef.current);
      map.remove();
      mapRef.current = null;
      setMapInstance(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Change map style
  useEffect(() => {
    if (!mapRef.current) return;

    const style = MAP_STYLES[mapStyle];
    if (typeof style === 'string') {
      mapRef.current.setStyle(style);
    } else {
      mapRef.current.setStyle(style as maplibregl.StyleSpecification);
    }

    has3DBuildingsRef.current = false;

    mapRef.current.once('style.load', () => {
      if (mapStyle !== 'satellite' && show3DRef.current) {
        add3DBuildings(mapRef.current!);
        has3DBuildingsRef.current = true;
      }
    });
  }, [mapStyle]);

  // User location marker is handled by <UserLocationLayer />

  // Route polyline with progress visualization
  const drawRoute = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;

    const routeId = 'route-line';
    const routeTraveledId = 'route-line-traveled';
    const routeRemainingId = 'route-line-remaining';

    const cleanupRoute = () => {
      [routeId, routeTraveledId, routeRemainingId].forEach(id => {
        try { if (map.getLayer(id)) map.removeLayer(id); } catch {}
        try { if (map.getSource(id)) map.removeSource(id); } catch {}
      });
    };

    if (!selectedRoute?.polyline?.length) {
      cleanupRoute();
      routeSourceRef.current = null;
      return;
    }

    cleanupRoute();

    const coords = selectedRoute.polyline.map((p) => [p.lng, p.lat]);
    const isNav = isNavigating;

    let splitIdx: number;
    if (isNav && forwardIndex > 0) {
      splitIdx = Math.max(1, Math.min(coords.length - 1, forwardIndex));
    } else {
      const progress = routeProgress;
      splitIdx = Math.max(1, Math.min(coords.length - 1, Math.round(progress * (coords.length - 1))));
    }

    if (isNav && splitIdx > 0 && splitIdx < coords.length) {
      const remainingCoords = coords.slice(splitIdx);

      if (remainingCoords.length >= 2) {
        map.addSource(routeRemainingId, {
          type: 'geojson',
          data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: remainingCoords } },
        });
        map.addLayer({
          id: routeRemainingId,
          type: 'line',
          source: routeRemainingId,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': isWrongWay ? '#ef4444' : '#0ea5e9',
            'line-width': 5,
            'line-opacity': isWrongWay ? 0.5 : 0.9,
          },
        });
      }
    } else {
      map.addSource(routeId, {
        type: 'geojson',
        data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } },
      });
      map.addLayer({
        id: routeId,
        type: 'line',
        source: routeId,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#0ea5e9', 'line-width': 5, 'line-opacity': 0.9 },
      });
    }

    routeSourceRef.current = isNav ? routeRemainingId : routeId;

    if (!isNav) {
      try {
        const bounds = coords.reduce(
          (b, c) => b.extend(c as [number, number]),
          new maplibregl.LngLatBounds(coords[0] as [number, number], coords[0] as [number, number]),
        );
        map.fitBounds(bounds, { padding: 60, duration: 500 });
      } catch {}
    }
  }, [selectedRoute, isNavigating, routeProgress, forwardIndex, isWrongWay]);

  useEffect(() => {
    drawRoute();
  }, [drawRoute]);

  // A style switch (setStyle) wipes all custom sources/layers, including the
  // route line, without changing any of drawRoute's own dependencies.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.on('style.load', drawRoute);
    return () => { map.off('style.load', drawRoute); };
  }, [drawRoute]);

  // Render POI markers — diffed by id against what's already on the map, so
  // panning slightly (the common case) only adds/removes the handful of
  // markers that entered/left the viewport instead of rebuilding all ~200.
  const renderObjectMarkers = useCallback(
    (objects: MapObject[]) => {
      if (!mapRef.current) return;
      const existing = objectMarkersRef.current;
      const nextIds = new Set(objects.map(obj => String(obj.id)));

      for (const [id, marker] of existing) {
        if (!nextIds.has(id)) {
          marker.remove();
          existing.delete(id);
        }
      }

      objects.forEach((obj) => {
        const id = String(obj.id);
        if (existing.has(id)) return;

        const el = createCategoryMarker(obj.category, obj.name);
        const marker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
          .setLngLat([obj.lng, obj.lat])
          .addTo(mapRef.current!);

        // Popup HTML is only built on first click, not upfront for every
        // marker — most POIs in a viewport are never clicked, so eagerly
        // constructing ~200 Popup instances was pure wasted work on every
        // viewport settle.
        let popup: maplibregl.Popup | null = null;
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          if (!popup) {
            const popupHtml = createPopupContent(
              obj.name, obj.category,
              obj.address, obj.rating, obj.distance,
            );
            popup = new maplibregl.Popup({
              offset: [0, -10],
              closeButton: true,
              closeOnClick: false,
              className: 'mapboxgl-popup-custom',
            }).setHTML(popupHtml);
            marker.setPopup(popup);
          }
          marker.togglePopup();
          setSelectedObject(obj);
        });

        existing.set(id, marker);
      });
    },
    [setSelectedObject],
  );

  // Load objects from API
  const loadObjectsInBounds = useCallback(
    (bounds: maplibregl.LngLatBounds) => {
      if (!mapRef.current) return;
      const z = mapRef.current.getZoom();
      if (z < 13) return;

      const cats = useMapStore.getState().activeCategories;
      if (cats.length === 0) {
        // A pending debounced fetch scheduled while categories were active
        // must not be left to fire later and repopulate markers the user
        // just cleared.
        clearTimeout(objectTimerRef.current);
        objectsRequestIdRef.current++;
        cleanupMarkerMap(objectMarkersRef.current);
        setVisibleObjects([]);
        return;
      }

      clearTimeout(objectTimerRef.current);
      const requestId = ++objectsRequestIdRef.current;
      objectTimerRef.current = setTimeout(async () => {
        try {
          const res = await mapApi.getObjects({
            minLat: bounds.getSouth(),
            maxLat: bounds.getNorth(),
            minLng: bounds.getWest(),
            maxLng: bounds.getEast(),
            categories: cats.join(','),
            limit: 200,
          });

          // The debounce timer only dedupes scheduling, not the network
          // requests themselves — an earlier viewport's fetch can still
          // resolve after a later one on a slow/jittery connection and
          // stomp the correct markers with stale-bounds ones.
          if (requestId !== objectsRequestIdRef.current) return;
          const objects: MapObject[] = Array.isArray(res.data?.data) ? res.data.data : Array.isArray(res.data) ? res.data : [];
          setVisibleObjects(objects);
          renderObjectMarkers(objects);
        } catch (err) {
          console.warn('[MapViewGL] Failed to load objects:', err);
        }
      }, 500);
    },
    [setVisibleObjects, renderObjectMarkers, cleanupMarkerMap],
  );

  // Load reports
  const loadReportsInBounds = useCallback(
    (bounds: maplibregl.LngLatBounds) => {
      if (!mapRef.current) return;
      const z = mapRef.current.getZoom();
      if (z < 13) return;

      const cats = useMapStore.getState().activeCategories;
      if (cats.length === 0) {
        clearTimeout(reportTimerRef.current);
        reportsRequestIdRef.current++;
        cleanupMarkers(reportMarkersRef.current);
        setReports([]);
        return;
      }

      clearTimeout(reportTimerRef.current);
      const requestId = ++reportsRequestIdRef.current;
      reportTimerRef.current = setTimeout(async () => {
        try {
          const res = await reportsApi.getInArea({
            minLat: bounds.getSouth(),
            maxLat: bounds.getNorth(),
            minLng: bounds.getWest(),
            maxLng: bounds.getEast(),
          });
          // Same out-of-order-response risk as the objects loader above —
          // an earlier viewport's response landing after a later one would
          // otherwise silently replace correct markers with stale ones.
          if (requestId !== reportsRequestIdRef.current) return;
          const reports: Report[] = Array.isArray(res.data?.data) ? res.data.data : Array.isArray(res.data) ? res.data : [];
          setReports(reports);

          cleanupMarkers(reportMarkersRef.current);

          reports.forEach((r) => {
            const el = createReportMarker(r.type, r.severity);
            const marker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
              .setLngLat([r.lng, r.lat])
              .addTo(mapRef.current!);

            el.addEventListener('click', (e) => {
              e.stopPropagation();
              setSelectedReport(r);
            });

            reportMarkersRef.current.push(marker);
          });
        } catch (err) {
          console.warn('[MapViewGL] Failed to load reports:', err);
        }
      }, 500);
    },
    [setReports, setSelectedReport, cleanupMarkers],
  );

  // 3D toggle effect — defer via idle callback
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    show3DRef.current = show3D;

    const apply3D = () => {
      if (!mapRef.current) return;
      try {
        if (show3D && mapStyle !== 'satellite') {
          add3DBuildings(mapRef.current);
          has3DBuildingsRef.current = true;
        } else if (has3DBuildingsRef.current) {
          remove3DBuildings(mapRef.current);
          has3DBuildingsRef.current = false;
        }
      } catch { /* ignore */ }
    };

    if (typeof requestIdleCallback !== 'undefined') {
      requestIdleCallback(apply3D, { timeout: 1000 });
    } else {
      setTimeout(apply3D, 100);
    }
  }, [show3D, mapStyle]);

  // Load traffic signals (always, regardless of categories)
  const loadTrafficSignals = useCallback(
    (bounds: maplibregl.LngLatBounds) => {
      if (!mapRef.current) return;
      const z = mapRef.current.getZoom();
      if (z < 13) {
        cleanupMarkers(trafficMarkersRef.current);
        return;
      }

      // No debounce/sequence guard here (unlike the object/report loaders)
      // meant an earlier viewport's response arriving after a later one
      // would replace the correct markers with ones for the wrong bounds.
      const requestId = ++trafficSignalsRequestIdRef.current;
      mapApi.getObjects({
        minLat: bounds.getSouth(),
        maxLat: bounds.getNorth(),
        minLng: bounds.getWest(),
        maxLng: bounds.getEast(),
        categories: 'TRAFFIC_LIGHT',
        limit: 100,
      }).then((res) => {
        if (requestId !== trafficSignalsRequestIdRef.current) return;
        const signals: MapObject[] = Array.isArray(res.data?.data) ? res.data.data : Array.isArray(res.data) ? res.data : [];
        cleanupMarkers(trafficMarkersRef.current);

        signals.forEach((s) => {
          const el = createTrafficSignalMarker();
          const marker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
            .setLngLat([s.lng, s.lat])
            .addTo(mapRef.current!);

          const popupHtml = createPopupContent(s.name, s.category, s.address);
          const popup = new maplibregl.Popup({
            offset: [0, -10],
            closeButton: true,
            closeOnClick: false,
            className: 'mapboxgl-popup-custom',
          }).setHTML(popupHtml);
          marker.setPopup(popup);

          el.addEventListener('click', (e) => {
            e.stopPropagation();
            marker.togglePopup();
            setSelectedObject(s);
          });

          trafficMarkersRef.current.push(marker);
        });
      }).catch(() => {});
    },
    [setSelectedObject, cleanupMarkers],
  );

  // Load traffic signals only after idle, throttled to avoid cascade
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    let lastTrafficLoad = 0;
    const TRAFFIC_THROTTLE_MS = 3000;

    const handler = () => {
      const now = Date.now();
      if (now - lastTrafficLoad < TRAFFIC_THROTTLE_MS) return;
      lastTrafficLoad = now;
      const bounds = map.getBounds();
      loadTrafficSignals(bounds);
    };

    map.on('idle', handler);
    return () => { map.off('idle', handler); };
  }, [loadTrafficSignals]);

  // Refresh when categories change
  useEffect(() => {
    if (!mapRef.current) return;
    const bounds = mapRef.current.getBounds();
    loadObjectsInBounds(bounds);
    loadReportsInBounds(bounds);
    loadTrafficSignals(bounds);
  }, [activeCategories, loadObjectsInBounds, loadReportsInBounds, loadTrafficSignals]);

  // Refresh markers when navigation state changes
  useEffect(() => {
    if (!mapRef.current) return;
    const bounds = mapRef.current.getBounds();
    if (!isNavigating) {
      loadObjectsInBounds(bounds);
      loadTrafficSignals(bounds);
    }
    loadReportsInBounds(bounds);
  }, [isNavigating, loadObjectsInBounds, loadReportsInBounds, loadTrafficSignals]);

  // Inject global map styles once
  useEffect(() => {
    const id = 'rovx-map-styles';
    if (document.getElementById(id)) return;
    const style = document.createElement('style');
    style.id = id;
    style.textContent = `
        @keyframes gl-pulse {
          0%, 100% { opacity: 0.4; transform: scale(1); }
          50% { opacity: 0.1; transform: scale(1.8); }
        }
        .maplibregl-popup-content,
        .mapboxgl-popup-content {
          background: #111827 !important;
          color: white !important;
          border: 1px solid #1f2937 !important;
          border-radius: 12px !important;
          box-shadow: 0 8px 32px rgba(0,0,0,0.5) !important;
          padding: 12px 14px !important;
          font-family: inherit !important;
        }
        .maplibregl-popup-tip,
        .mapboxgl-popup-tip {
          border-top-color: #1f2937 !important;
        }
        .maplibregl-popup-close-button,
        .mapboxgl-popup-close-button {
          color: #9ca3af !important;
          font-size: 18px !important;
          padding: 2px 8px !important;
        }
        .maplibregl-popup-close-button:hover,
        .mapboxgl-popup-close-button:hover {
          color: white !important;
          background: transparent !important;
        }
        .maplibregl-canvas { outline: none; }
        .maplibregl-map { overflow: hidden; }

        @media (max-width: 640px) {
          .maplibregl-ctrl-group button {
            width: 32px !important;
            height: 32px !important;
          }
          .maplibregl-ctrl-group button span {
            transform: scale(0.75);
          }
          .maplibregl-popup-content {
            padding: 8px 10px !important;
            font-size: 12px !important;
            max-width: 240px !important;
          }
          .maplibregl-popup-close-button {
            font-size: 14px !important;
            padding: 0 6px !important;
          }
          .maplibregl-ctrl-attrib {
            font-size: 8px !important;
          }
        }

        @media (min-width: 641px) and (max-width: 1023px) {
          .maplibregl-popup-content {
            max-width: 300px !important;
          }
        }

        @media (min-width: 1024px) {
          .maplibregl-popup-content {
            max-width: 360px !important;
          }
        }
      `;
    document.head.appendChild(style);
  }, []);

  return (
    <div className="absolute inset-0 z-0" style={{ isolation: 'isolate' }}>
      <div ref={containerRef} className="w-full h-full" />
      <UserLocationLayer map={mapInstance} />
      <MapFeaturesLayer map={mapInstance} />
      <FriendMarkers map={mapInstance} />
      <TrafficFlowLayer map={mapInstance} />
      <TrafficLayer map={mapInstance} />
    </div>
  );
}
