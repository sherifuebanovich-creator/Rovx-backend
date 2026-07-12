'use client';
import { useEffect, useRef, useCallback } from 'react';
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

function escapeHtml(text: string): string {
  const m: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return text.replace(/[&<>"']/g, (c) => m[c]);
}

export default function MapViewGL() {
  const mapRef = useRef<maplibregl.Map | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const objectMarkersRef = useRef<maplibregl.Marker[]>([]);
  const reportMarkersRef = useRef<maplibregl.Marker[]>([]);
  const trafficMarkersRef = useRef<maplibregl.Marker[]>([]);
  const routeSourceRef = useRef<string | null>(null);
  const objectTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const reportTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const has3DBuildingsRef = useRef(false);
  const show3DRef = useRef(true);

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

  const navigation = useMapStore(s => s.navigation);
  const isNavigatingRef = useRef(false);
  isNavigatingRef.current = navigation.isNavigating;

  const routeProgress = navigation.routeProgress;

  const setMapCenter = useMapStore(s => s.setMapCenter);
  const setZoom = useMapStore(s => s.setZoom);

  const cleanupMarkers = useCallback((markers: maplibregl.Marker[]) => {
    markers.forEach(m => m.remove());
    markers.length = 0;
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

    return () => {
      clearTimeout(objectTimerRef.current);
      clearTimeout(reportTimerRef.current);
      cleanupMarkers(objectMarkersRef.current);
      cleanupMarkers(reportMarkersRef.current);
      cleanupMarkers(trafficMarkersRef.current);
      map.remove();
      mapRef.current = null;
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
  useEffect(() => {
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
    const isNav = navigation.isNavigating;
    const progress = navigation.routeProgress;
    const splitIdx = Math.max(1, Math.min(coords.length - 1, Math.round(progress * (coords.length - 1))));

    if (isNav && splitIdx > 0 && splitIdx < coords.length) {
      const traveledCoords = coords.slice(0, splitIdx + 1);
      const remainingCoords = coords.slice(splitIdx);

      if (traveledCoords.length >= 2) {
        map.addSource(routeTraveledId, {
          type: 'geojson',
          data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: traveledCoords } },
        });
        map.addLayer({
          id: routeTraveledId,
          type: 'line',
          source: routeTraveledId,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': '#64748b', 'line-width': 4, 'line-opacity': 0.5 },
        });
      }

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
          paint: { 'line-color': '#0ea5e9', 'line-width': 5, 'line-opacity': 0.9 },
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
  }, [selectedRoute, navigation.isNavigating, routeProgress]);

  // Render POI markers
  const renderObjectMarkers = useCallback(
    (objects: MapObject[]) => {
      if (!mapRef.current) return;
      cleanupMarkers(objectMarkersRef.current);

      objects.forEach((obj) => {
        const el = createCategoryMarker(obj.category, obj.name);
        const marker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
          .setLngLat([obj.lng, obj.lat])
          .addTo(mapRef.current!);

        const popupHtml = createPopupContent(
          obj.name, obj.category,
          obj.address, obj.rating, obj.distance,
        );
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
          setSelectedObject(obj);
        });

        objectMarkersRef.current.push(marker);
      });
    },
    [setSelectedObject, cleanupMarkers],
  );

  // Load objects from API
  const loadObjectsInBounds = useCallback(
    (bounds: maplibregl.LngLatBounds) => {
      if (!mapRef.current) return;
      const z = mapRef.current.getZoom();
      if (z < 13) return;

      const cats = useMapStore.getState().activeCategories;
      if (cats.length === 0) {
        cleanupMarkers(objectMarkersRef.current);
        setVisibleObjects([]);
        return;
      }

      clearTimeout(objectTimerRef.current);
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

          const objects: MapObject[] = Array.isArray(res.data?.data) ? res.data.data : Array.isArray(res.data) ? res.data : [];
          setVisibleObjects(objects);
          renderObjectMarkers(objects);
        } catch (err) {
          console.warn('[MapViewGL] Failed to load objects:', err);
        }
      }, 500);
    },
    [setVisibleObjects, renderObjectMarkers, cleanupMarkers],
  );

  // Load reports
  const loadReportsInBounds = useCallback(
    (bounds: maplibregl.LngLatBounds) => {
      if (!mapRef.current) return;
      const z = mapRef.current.getZoom();
      if (z < 13) return;

      const cats = useMapStore.getState().activeCategories;
      if (cats.length === 0) {
        cleanupMarkers(reportMarkersRef.current);
        setReports([]);
        return;
      }

      clearTimeout(reportTimerRef.current);
      reportTimerRef.current = setTimeout(async () => {
        try {
          const res = await reportsApi.getInArea({
            minLat: bounds.getSouth(),
            maxLat: bounds.getNorth(),
            minLng: bounds.getWest(),
            maxLng: bounds.getEast(),
          });
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

      mapApi.getObjects({
        minLat: bounds.getSouth(),
        maxLat: bounds.getNorth(),
        minLng: bounds.getWest(),
        maxLng: bounds.getEast(),
        categories: 'TRAFFIC_LIGHT',
        limit: 100,
      }).then((res) => {
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
    if (!navigation.isNavigating) {
      loadObjectsInBounds(bounds);
      loadTrafficSignals(bounds);
    }
    loadReportsInBounds(bounds);
  }, [navigation.isNavigating, loadObjectsInBounds, loadReportsInBounds, loadTrafficSignals]);

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
      <UserLocationLayer map={mapRef.current} />
    </div>
  );
}
