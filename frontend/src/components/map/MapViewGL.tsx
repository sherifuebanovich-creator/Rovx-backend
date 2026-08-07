'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useMapStore } from '@/store/map.store';
import { mapApi, reportsApi } from '@/lib/api';
import { MapObject, Report } from '@/types';
import {
  createPopupContent,
  createReportPopupContent,
  ensureCategoryIcon,
  ensureReportIcon,
  categoryIconId,
  reportIconId,
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

const POI_SOURCE_ID = 'poi-objects-src';
const POI_LAYER_ID = 'poi-objects-layer';
const REPORTS_SOURCE_ID = 'poi-reports-src';
const REPORTS_LAYER_ID = 'poi-reports-layer';

function emptyFeatureCollection(): GeoJSON.FeatureCollection {
  return { type: 'FeatureCollection', features: [] };
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
  // mapCenter/zoom are only ever read once, at construction (see `new
  // maplibregl.Map({ center: [initState.mapCenter...] })` below) — updating
  // them later (e.g. useGeolocation's success handler calling setMapCenter)
  // does NOT move an already-mounted map. Without this, the map permanently
  // stayed on its fallback center (previously {0,0}, now Moscow) even after
  // a real GPS fix came in, until the user manually tapped the locate-me
  // button — this jumps the camera to the user's real location the first
  // time a fix arrives after mount, without fighting any panning the user
  // does afterward.
  const hasCenteredOnUserRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const routeSourceRef = useRef<string | null>(null);
  const objectTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const reportTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const has3DBuildingsRef = useRef(false);
  const show3DRef = useRef(true);
  const objectsRequestIdRef = useRef(0);
  const reportsRequestIdRef = useRef(0);
  // Same bbox-dedupe MapFeaturesLayer/TrafficFlowLayer already use their own
  // lastBoundsRef for — without it, a single pan/zoom gesture that settles
  // in two steps (e.g. inertial momentum firing 'moveend' again after the
  // initial one) re-requests the identical viewport's objects/reports twice.
  // Objects also key on the active category list so switching categories at
  // an unmoved viewport still refetches.
  const lastObjectsFetchKeyRef = useRef('');
  const lastReportsFetchKeyRef = useRef('');
  // POI/report markers are rendered as GL symbol layers (GeoJSON source +
  // pre-baked canvas icons, see maplibreIcons.ts's ensureCategoryIcon/
  // ensureReportIcon) instead of one DOM `maplibregl.Marker` per object —
  // with up to 200 POIs and an unbounded number of reports per viewport,
  // creating/destroying that many real DOM nodes (each with its own
  // layout/paint cost) on every pan/zoom settle was the dominant cost of
  // "icons load slowly". A symbol layer's `source.setData()` just hands
  // MapLibre a full feature list and lets the GPU-side tile index figure out
  // what changed, so re-rendering ~200 points costs a fraction of what
  // 200 DOM Marker adds/removes did. Full objects/reports stay in the
  // zustand store (setVisibleObjects/setReports) and are looked up by id
  // from there on click via useMapStore.getState() — GeoJSON feature
  // properties can only hold primitives (arrays/objects get silently
  // JSON.stringified, see MapFeaturesLayer's onClick comment for the bug
  // that caused elsewhere), so click popups never build their HTML from
  // feature.properties directly.

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
  const userLocation = useMapStore(s => s.userLocation);
  // Only flyToRequestId is subscribed reactively — mapCenter/zoom themselves
  // are read via getState() inside the effect below, not as selectors here,
  // since moveend's passive position sync writes them on every pan/zoom and
  // this component (with everything it renders) would otherwise re-render
  // on every map movement for a value this effect only cares about when
  // flyToRequestId actually changes.
  const flyToRequestId = useMapStore(s => s.flyToRequestId);

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
    hasCenteredOnUserRef.current = false;

    return () => {
      clearTimeout(objectTimerRef.current);
      clearTimeout(reportTimerRef.current);
      map.remove();
      mapRef.current = null;
      setMapInstance(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Jump to the user's real location the first time a GPS fix arrives —
  // see hasCenteredOnUserRef above for why this can't just rely on the
  // map's initial `center` option.
  useEffect(() => {
    if (!mapInstance || !userLocation || hasCenteredOnUserRef.current) return;
    hasCenteredOnUserRef.current = true;
    mapInstance.jumpTo({
      center: [userLocation.lng, userLocation.lat],
      zoom: Math.max(mapInstance.getZoom(), 15),
    });
  }, [mapInstance, userLocation]);

  // Explicit "jump the camera here" requests (SearchPanel's "On Map",
  // tapping a report notification) — see flyToRequestId's comment in
  // map.store.ts for why this can't just watch mapCenter/zoom directly.
  // Skips the initial mount (requestId starts at 0 and nothing should fire
  // before the user actually asks for a jump).
  const lastFlyToRequestIdRef = useRef(0);
  useEffect(() => {
    if (!mapInstance || flyToRequestId === lastFlyToRequestIdRef.current) return;
    lastFlyToRequestIdRef.current = flyToRequestId;
    if (flyToRequestId === 0) return;
    const { mapCenter, zoom } = useMapStore.getState();
    mapInstance.flyTo({ center: [mapCenter.lng, mapCenter.lat], zoom, essential: true });
  }, [mapInstance, flyToRequestId]);

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

  // Ensures the POI/report GeoJSON sources + symbol layers exist on the
  // current style. A style switch (setStyle) wipes all custom sources/layers
  // (see the style.load reapply effect below), and maplibre throws if you
  // addSource/addLayer before the style has finished loading — so this is a
  // no-op (returns false) until `map.isStyleLoaded()` is true, same guard
  // MapFeaturesLayer uses for the same reason.
  const ensurePoiLayers = useCallback((map: maplibregl.Map): boolean => {
    if (!map.isStyleLoaded()) return false;

    if (!map.getSource(POI_SOURCE_ID)) {
      map.addSource(POI_SOURCE_ID, { type: 'geojson', data: emptyFeatureCollection() });
    }
    if (!map.getLayer(POI_LAYER_ID)) {
      map.addLayer({
        id: POI_LAYER_ID,
        type: 'symbol',
        source: POI_SOURCE_ID,
        layout: {
          'icon-image': ['get', 'iconId'],
          'icon-size': 0.85,
          'icon-anchor': 'bottom',
          // POIs never hid each other as DOM markers (every one was always
          // in the DOM); keep that — overlap is resolved visually by
          // density/zoom, not by MapLibre's collision index.
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
          'text-field': ['get', 'name'],
          // OpenFreeMap's glyph server (glyphs: tiles.openfreemap.org/fonts/
          // {fontstack}/{range}.pbf, used by all of MAP_STYLES) only ever
          // serves single-name font stacks — 'Noto Sans Regular/Bold/Italic',
          // per its own style JSON. Requesting a comma-joined fallback stack
          // like the previous ['Open Sans Regular', 'Noto Sans Regular', ...]
          // 404s the *entire* combined glyph range (verified directly against
          // the endpoint), so none of the fonts in it render — POI name
          // labels would have silently never shown at all.
          'text-font': ['Noto Sans Regular'],
          'text-size': 10,
          'text-offset': [0, 0.4],
          'text-anchor': 'top',
          'text-max-width': 8,
          'text-optional': true,
        },
        paint: {
          'text-color': '#111827',
          'text-halo-color': '#ffffff',
          'text-halo-width': 1.4,
        },
      });
    }

    if (!map.getSource(REPORTS_SOURCE_ID)) {
      map.addSource(REPORTS_SOURCE_ID, { type: 'geojson', data: emptyFeatureCollection() });
    }
    if (!map.getLayer(REPORTS_LAYER_ID)) {
      map.addLayer({
        id: REPORTS_LAYER_ID,
        type: 'symbol',
        source: REPORTS_SOURCE_ID,
        layout: {
          'icon-image': ['get', 'iconId'],
          // Severity used to grow the DOM marker's pixel size directly
          // (21 + severity*2.5, clamped 36); interpolating icon-size off the
          // baked icon's nominal size reproduces the same "worse hazard
          // looks bigger" cue without baking a variant image per severity.
          'icon-size': ['interpolate', ['linear'], ['coalesce', ['get', 'severity'], 3], 1, 0.85, 5, 1.3],
          'icon-anchor': 'bottom',
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
      });
    }

    return true;
  }, []);

  // Render POI markers as a single GL symbol layer instead of one DOM
  // `maplibregl.Marker` per object — `source.setData()` hands MapLibre the
  // full feature list and its own tile-based index diffs what actually
  // changed, which is dramatically cheaper than the add/remove-per-object
  // DOM work this replaced (see the ref comment near the top of this file).
  const renderObjectMarkers = useCallback(
    (objects: MapObject[]) => {
      const map = mapRef.current;
      if (!map || !ensurePoiLayers(map)) return;

      objects.forEach((obj) => ensureCategoryIcon(map, obj.category));

      const geojson: GeoJSON.FeatureCollection = {
        type: 'FeatureCollection',
        features: objects.map((obj) => ({
          type: 'Feature',
          properties: { id: obj.id, iconId: categoryIconId(obj.category), name: obj.name },
          geometry: { type: 'Point', coordinates: [obj.lng, obj.lat] },
        })),
      };

      (map.getSource(POI_SOURCE_ID) as maplibregl.GeoJSONSource).setData(geojson);
    },
    [ensurePoiLayers],
  );

  const renderReportMarkers = useCallback(
    (reports: Report[]) => {
      const map = mapRef.current;
      if (!map || !ensurePoiLayers(map)) return;

      reports.forEach((r) => ensureReportIcon(map, r.type));

      const geojson: GeoJSON.FeatureCollection = {
        type: 'FeatureCollection',
        features: reports.map((r) => ({
          type: 'Feature',
          properties: { id: r.id, iconId: reportIconId(r.type), severity: r.severity },
          geometry: { type: 'Point', coordinates: [r.lng, r.lat] },
        })),
      };

      (map.getSource(REPORTS_SOURCE_ID) as maplibregl.GeoJSONSource).setData(geojson);
    },
    [ensurePoiLayers],
  );

  // Click/hover handling for both symbol layers, bound once per map instance
  // (not re-bound on every render) — mirrors MapFeaturesLayer's own
  // click-handler effect. `map.on(type, layerId, listener)` resolves the
  // layer lazily at event time, so binding before the layer exists (or
  // across a style-reload recreate) is fine. Full object/report data is
  // looked up from the store by id rather than off the clicked feature's own
  // properties, since GeoJSON properties can only hold primitives — see the
  // ref comment near the top of this file.
  useEffect(() => {
    if (!mapInstance) return;
    const map = mapInstance;

    const objectPopup = new maplibregl.Popup({
      offset: [0, -10], closeButton: true, closeOnClick: false, className: 'mapboxgl-popup-custom',
    });
    const reportPopup = new maplibregl.Popup({
      offset: [0, -10], closeButton: true, closeOnClick: false, className: 'mapboxgl-popup-custom',
    });

    const onObjectClick = (e: maplibregl.MapLayerMouseEvent) => {
      const feature = e.features?.[0];
      if (!feature) return;
      const id = String(feature.properties?.id);
      const obj = useMapStore.getState().visibleObjects.find((o) => String(o.id) === id);
      if (!obj) return;
      const coords = (feature.geometry as GeoJSON.Point).coordinates as [number, number];
      objectPopup
        .setLngLat(coords)
        .setHTML(createPopupContent(obj.name, obj.category, obj.address, obj.rating, obj.distance))
        .addTo(map);
      setSelectedObject(obj);
    };

    const onReportClick = (e: maplibregl.MapLayerMouseEvent) => {
      const feature = e.features?.[0];
      if (!feature) return;
      const id = String(feature.properties?.id);
      const report = useMapStore.getState().reports.find((r) => String(r.id) === id);
      if (!report) return;
      const coords = (feature.geometry as GeoJSON.Point).coordinates as [number, number];
      reportPopup
        .setLngLat(coords)
        .setHTML(createReportPopupContent(report.type, report.severity, report.description, report.address))
        .addTo(map);
      setSelectedReport(report);
    };

    const onEnter = () => { map.getCanvas().style.cursor = 'pointer'; };
    const onLeave = () => { map.getCanvas().style.cursor = ''; };

    map.on('click', POI_LAYER_ID, onObjectClick);
    map.on('click', REPORTS_LAYER_ID, onReportClick);
    map.on('mouseenter', POI_LAYER_ID, onEnter);
    map.on('mouseleave', POI_LAYER_ID, onLeave);
    map.on('mouseenter', REPORTS_LAYER_ID, onEnter);
    map.on('mouseleave', REPORTS_LAYER_ID, onLeave);

    return () => {
      map.off('click', POI_LAYER_ID, onObjectClick);
      map.off('click', REPORTS_LAYER_ID, onReportClick);
      map.off('mouseenter', POI_LAYER_ID, onEnter);
      map.off('mouseleave', POI_LAYER_ID, onLeave);
      map.off('mouseenter', REPORTS_LAYER_ID, onEnter);
      map.off('mouseleave', REPORTS_LAYER_ID, onLeave);
      objectPopup.remove();
      reportPopup.remove();
    };
  }, [mapInstance, setSelectedObject, setSelectedReport]);

  // A style switch (setStyle) wipes all custom sources/layers, same as the
  // route line (see drawRoute's own reapply effect below) — re-create them
  // and immediately re-populate from whatever's currently in the store,
  // instead of waiting for the next pan/zoom to trigger a fresh fetch.
  //
  // Same race MapFeaturesLayer/TrafficFlowLayer already document:
  // `map.isStyleLoaded()` can still read false for a tick right when
  // 'style.load' fires (maplibre's internal bookkeeping lags the event by a
  // frame) — ensurePoiLayers's own isStyleLoaded() guard would then bail
  // silently with nothing left to retry it until the next pan/zoom, leaving
  // every POI/report icon gone after a style switch (night mode, satellite)
  // until the user happened to move the map. Falling back to a one-time
  // 'idle' wait closes that gap.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const reapply = () => {
      renderObjectMarkers(useMapStore.getState().visibleObjects);
      renderReportMarkers(useMapStore.getState().reports);
    };
    const onStyleLoad = () => {
      if (map.isStyleLoaded()) {
        reapply();
      } else {
        map.once('idle', reapply);
      }
    };
    map.on('style.load', onStyleLoad);
    return () => { map.off('style.load', onStyleLoad); };
  }, [renderObjectMarkers, renderReportMarkers]);

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
        lastObjectsFetchKeyRef.current = '';
        setVisibleObjects([]);
        renderObjectMarkers([]);
        return;
      }

      const fetchKey = `${bounds.getSouth()},${bounds.getWest()},${bounds.getNorth()},${bounds.getEast()}|${cats.join(',')}`;
      if (fetchKey === lastObjectsFetchKeyRef.current) return;
      lastObjectsFetchKeyRef.current = fetchKey;

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
          // Otherwise a single failed request (dropped connection, 5xx) wedges
          // this fetchKey as "already fetched" forever — the viewport's
          // objects would never load even on the next pan back to it, since
          // the dedupe guard above short-circuits before ever calling the API
          // again. Only clear it if this is still the latest request for this
          // key (a newer, still-in-flight/succeeded fetch must not be undone
          // by an older one's failure landing after it).
          if (requestId === objectsRequestIdRef.current) {
            lastObjectsFetchKeyRef.current = '';
          }
          console.warn('[MapViewGL] Failed to load objects:', err);
        }
      }, 500);
    },
    [setVisibleObjects, renderObjectMarkers],
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
        lastReportsFetchKeyRef.current = '';
        setReports([]);
        renderReportMarkers([]);
        return;
      }

      const fetchKey = `${bounds.getSouth()},${bounds.getWest()},${bounds.getNorth()},${bounds.getEast()}`;
      if (fetchKey === lastReportsFetchKeyRef.current) return;
      lastReportsFetchKeyRef.current = fetchKey;

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
          renderReportMarkers(reports);
        } catch (err) {
          // Same fetchKey-wedging risk as loadObjectsInBounds above.
          if (requestId === reportsRequestIdRef.current) {
            lastReportsFetchKeyRef.current = '';
          }
          console.warn('[MapViewGL] Failed to load reports:', err);
        }
      }, 500);
    },
    [setReports, renderReportMarkers],
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

  // Refresh when categories change
  useEffect(() => {
    if (!mapRef.current) return;
    const bounds = mapRef.current.getBounds();
    loadObjectsInBounds(bounds);
    loadReportsInBounds(bounds);
  }, [activeCategories, loadObjectsInBounds, loadReportsInBounds]);

  // Refresh markers when navigation state changes
  useEffect(() => {
    if (!mapRef.current) return;
    const bounds = mapRef.current.getBounds();
    if (!isNavigating) {
      loadObjectsInBounds(bounds);
    }
    loadReportsInBounds(bounds);
  }, [isNavigating, loadObjectsInBounds, loadReportsInBounds]);

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
