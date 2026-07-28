'use client';
import { useEffect, useRef, useCallback, memo } from 'react';
import maplibregl from 'maplibre-gl';
import { useMapStore } from '@/store/map.store';
import { useAuthStore } from '@/store/auth.store';
import { mapApi } from '@/lib/api';
import { escapeAttr } from '@/lib/maplibreIcons';
import { haversineDist } from '@/lib/geo';

const MIN_ZOOM = 8;
const DEBOUNCE_MS = 400;
const SIGNAL_RADIUS_M = 1000;

interface Props {
  map: maplibregl.Map | null;
}

function MapFeaturesLayer({ map }: Props) {
  const sourceId = 'map-features-src';
  const clusterLayerId = 'map-features-clusters';
  const clusterCountId = 'map-features-cluster-count';
  const cameraLayerId = 'map-features-cameras';
  const signalLayerId = 'map-features-signals';
  // Off by default (matches UserPreference.limitTrafficSignalsRadius) — read
  // via refs, not deps on loadFeatures, so a GPS tick or a settings toggle
  // doesn't recreate the callback (and its moveend/zoomend listeners) on
  // every update; the next fetch (pan/zoom, or the toggle handler below)
  // just picks up the latest ref value.
  const userLocation = useMapStore((s) => s.userLocation);
  const userLocationRef = useRef(userLocation);
  userLocationRef.current = userLocation;
  const limitSignalsRadius = useAuthStore((s) => s.preferences?.limitTrafficSignalsRadius ?? false);
  const limitSignalsRadiusRef = useRef(limitSignalsRadius);
  limitSignalsRadiusRef.current = limitSignalsRadius;
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const lastBoundsRef = useRef<string>('');
  // Nothing here ordered responses by request — a fetch for an older
  // viewport that happens to resolve after a newer one's (slow network,
  // rapid successive pans each clearing the 400ms debounce) would still
  // overwrite the map with stale cameras/signals for a bbox the user has
  // already panned away from, with no further pan/zoom to correct it.
  const requestIdRef = useRef(0);

  const cleanup = useCallback(() => {
    if (!map) return;
    try {
      [clusterLayerId, clusterCountId, cameraLayerId, signalLayerId].forEach(id => {
        if (map.getLayer(id)) map.removeLayer(id);
      });
      if (map.getSource(sourceId)) map.removeSource(sourceId);
    } catch {}
  }, [map]);

  // Draws the camera badge to an offscreen canvas and registers it as a
  // reusable map image, instead of rendering the emoji via a symbol layer's
  // `text-field`. Text-field glyphs are rasterized by the *style's* glyph
  // server (its `glyphs` URL template), and most vector map styles only
  // ship Latin/Cyrillic ranges there — not emoji — so the glyph silently
  // failed to resolve depending on which tiles/ranges happened to be
  // cached, making the icon appear and disappear seemingly at random.
  // Canvas 2D text rendering instead uses the browser's own font stack,
  // which resolves emoji via the OS's real emoji font every time.
  const ensureCameraIcon = useCallback((m: maplibregl.Map) => {
    const imageId = 'map-features-camera-icon';
    if (m.hasImage(imageId)) return;
    const size = 48;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const center = size / 2;
    ctx.beginPath();
    ctx.arc(center, center, center - 3, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#ef4444';
    ctx.stroke();
    ctx.font = `${Math.round(size * 0.5)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('📷', center, center + 1);
    m.addImage(imageId, ctx.getImageData(0, 0, size, size), { pixelRatio: 2 });
  }, []);

  const loadFeatures = useCallback(async () => {
    if (!map) return;
    const requestId = ++requestIdRef.current;
    const zoom = map.getZoom();
    if (zoom < MIN_ZOOM) {
      cleanup();
      // Without resetting this, zooming back in to the exact same bbox
      // after having zoomed out below MIN_ZOOM compares equal to the stale
      // pre-zoom-out value and short-circuits below, leaving the markers
      // cleaned up above never re-added.
      lastBoundsRef.current = '';
      return;
    }

    const bounds = map.getBounds();
    const bbox = `${bounds.getSouth()},${bounds.getWest()},${bounds.getNorth()},${bounds.getEast()}`;

    if (bbox === lastBoundsRef.current) return;
    lastBoundsRef.current = bbox;

    try {
      const res = await mapApi.getFeatures(bbox, 'speed_camera,traffic_signals');
      if (requestId !== requestIdRef.current) return;
      const rawFeatures = res.data?.data || res.data || [];

      // User-opt-in setting: only traffic_signals get distance-limited —
      // speed cameras and any other feature type always show, regardless
      // of this toggle, exactly as before it existed.
      const loc = userLocationRef.current;
      const features = (limitSignalsRadiusRef.current && loc)
        ? rawFeatures.filter((f: any) => f.type !== 'traffic_signals'
            || haversineDist(loc.lat, loc.lng, f.lat, f.lng) <= SIGNAL_RADIUS_M)
        : rawFeatures;

      if (!map.isStyleLoaded()) return;
      cleanup();
      if (!features.length) return;

      ensureCameraIcon(map);

      const geojson: GeoJSON.FeatureCollection = {
        type: 'FeatureCollection',
        features: features.map((f: any) => ({
          type: 'Feature',
          properties: {
            id: f.id,
            type: f.type,
            tags: f.tags || {},
            updatedAt: f.updatedAt,
          },
          geometry: {
            type: 'Point',
            coordinates: [f.lng, f.lat],
          },
        })),
      };

      map.addSource(sourceId, {
        type: 'geojson',
        data: geojson,
        cluster: true,
        clusterMaxZoom: 14,
        clusterRadius: 50,
      });

      // Cluster circles
      map.addLayer({
        id: clusterLayerId,
        type: 'circle',
        source: sourceId,
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': [
            'step', ['get', 'point_count'],
            '#f97316', 10,
            '#ef4444', 30,
            '#dc2626',
          ],
          'circle-radius': [
            'step', ['get', 'point_count'],
            14, 10, 18, 30, 24,
          ],
          'circle-stroke-width': 2,
          'circle-stroke-color': 'rgba(255,255,255,0.3)',
        },
      });

      // Cluster count text
      map.addLayer({
        id: clusterCountId,
        type: 'symbol',
        source: sourceId,
        filter: ['has', 'point_count'],
        layout: {
          'text-field': '{point_count_abbreviated}',
          'text-font': ['Open Sans Bold', 'Noto Sans Bold', 'Arial Unicode MS Bold'],
          'text-size': 11,
        },
        paint: {
          'text-color': 'white',
        },
      });

      // Speed cameras — a single self-contained icon (white badge + camera
      // glyph baked into one canvas image, see ensureCameraIcon) instead of
      // a plain colored dot that gave no indication of what it was until
      // tapped. Collision detection is left on its defaults (no
      // allow-overlap/ignore-placement) so icons crowded close together
      // hide each other rather than stacking illegibly — the geojson
      // source's own clustering is what's supposed to handle dense groups,
      // by collapsing them into a single cluster circle before it ever
      // reaches this per-point layer.
      map.addLayer({
        id: cameraLayerId,
        type: 'symbol',
        source: sourceId,
        filter: ['all', ['!', ['has', 'point_count']], ['==', ['get', 'type'], 'speed_camera']],
        layout: {
          'icon-image': 'map-features-camera-icon',
          'icon-size': 0.5,
        },
      });

      // Traffic signals — yellow circles
      map.addLayer({
        id: signalLayerId,
        type: 'circle',
        source: sourceId,
        filter: ['all', ['!', ['has', 'point_count']], ['==', ['get', 'type'], 'traffic_signals']],
        paint: {
          'circle-radius': 5,
          'circle-color': '#f59e0b',
          'circle-stroke-width': 1.5,
          'circle-stroke-color': 'rgba(255,255,255,0.6)',
        },
      });

    } catch (err) {
      console.warn('[MapFeaturesLayer] Failed to load features:', err);
    }
  }, [map, cleanup, ensureCameraIcon]);

  // loadFeatures dedupes by bbox (see lastBoundsRef above) — without this,
  // flipping the "limit traffic signals to 1km" toggle while the viewport
  // hasn't moved would silently do nothing until the next pan/zoom, since
  // the bbox guard would skip the refetch entirely.
  useEffect(() => {
    if (!map) return;
    lastBoundsRef.current = '';
    loadFeatures();
  }, [map, limitSignalsRadius, loadFeatures]);

  useEffect(() => {
    if (!map) return;

    const debouncedLoad = () => {
      clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(loadFeatures, DEBOUNCE_MS);
    };

    // Bound once per map instance — layer ids are stable across reloads, so
    // re-registering these on every loadFeatures() call (which reruns on
    // every pan/zoom/style change) would stack duplicate click/hover
    // listeners instead of replacing them.
    const popup = new maplibregl.Popup({ offset: [0, -12], maxWidth: '280px' });

    const onClick = (e: maplibregl.MapLayerMouseEvent) => {
      const feature = e.features?.[0];
      if (!feature) return;
      const props = feature.properties as any;
      const coords = (feature.geometry as any).coordinates;
      const typeLabel = props.type === 'speed_camera' ? '📷 Радар' : '🚦 Светофор';
      // GeoJSON sources can only hold primitive property values — maplibre-gl
      // silently JSON.stringifies nested objects (like `tags`) when the
      // source is built, so by the time a click event reads them back here,
      // `tags` is a JSON *string*, not the object it was assigned as in
      // loadFeatures(). Object.entries() on a raw string iterates characters
      // (0: "{", 1: "\"", 2: "c", ...) instead of the actual tag key/values.
      let tags: Record<string, unknown> = {};
      if (typeof props.tags === 'string') {
        try { tags = JSON.parse(props.tags) || {}; } catch { tags = {}; }
      } else if (props.tags && typeof props.tags === 'object') {
        tags = props.tags;
      }
      const tagEntries = Object.entries(tags)
        .filter(([k]) => !['highway', 'created_by'].includes(k))
        .slice(0, 8);
      const details = tagEntries
        .map(([k, v]) => `<div><span style="color:#9ca3af;font-size:11px">${escapeAttr(k)}:</span> <span style="font-size:12px;color:white">${escapeAttr(String(v))}</span></div>`)
        .join('');
      const updated = props.updatedAt
        ? new Date(props.updatedAt).toLocaleDateString('ru-RU')
        : '';

      popup
        .setLngLat(coords)
        .setHTML(`
          <div style="min-width:140px">
            <div style="font-weight:700;font-size:14px;margin-bottom:4px">${typeLabel}</div>
            ${details || '<div style="font-size:11px;color:#6b7280">Нет данных</div>'}
            ${updated ? `<div style="font-size:10px;color:#6b7280;margin-top:6px;border-top:1px solid #374151;padding-top:4px">OSM · ${updated}</div>` : ''}
          </div>
        `)
        .addTo(map);
    };
    const onEnter = () => { map.getCanvas().style.cursor = 'pointer'; };
    const onLeave = () => { map.getCanvas().style.cursor = ''; };

    map.on('click', cameraLayerId, onClick);
    map.on('click', signalLayerId, onClick);
    map.on('mouseenter', cameraLayerId, onEnter);
    map.on('mouseleave', cameraLayerId, onLeave);
    map.on('mouseenter', signalLayerId, onEnter);
    map.on('mouseleave', signalLayerId, onLeave);

    // A style switch (setStyle) wipes all custom sources/layers just like it
    // does for the route line in MapViewGL — but unlike that redraw, this one
    // dedupes by bbox (see loadFeatures), so if the viewport hasn't moved,
    // that guard would otherwise skip rebuilding and leave the camera/signal
    // layers gone until the next pan/zoom to a different bbox.
    //
    // Switching to the dark/night style (mapStyle -> 'night') is the one
    // path that actually fires this handler after initial load, and
    // `map.isStyleLoaded()` can still read false for a tick right when
    // `style.load` fires (maplibre's own internal bookkeeping lags the
    // event by a frame) — loadFeatures()'s own `!map.isStyleLoaded()` guard
    // then bails silently with nothing left to retry it, so every icon
    // this layer draws (traffic signals, speed cameras) stayed gone after
    // switching to dark mode until the user happened to pan/zoom. Falling
    // back to a one-time 'idle' wait (fires once rendering has actually
    // settled) instead of calling straight through closes that gap.
    const onStyleLoad = () => {
      lastBoundsRef.current = '';
      if (map.isStyleLoaded()) {
        loadFeatures();
      } else {
        map.once('idle', loadFeatures);
      }
    };

    map.on('moveend', debouncedLoad);
    map.on('zoomend', debouncedLoad);
    map.on('style.load', onStyleLoad);

    loadFeatures();

    return () => {
      clearTimeout(debounceRef.current);
      map.off('moveend', debouncedLoad);
      map.off('zoomend', debouncedLoad);
      map.off('style.load', onStyleLoad);
      map.off('click', cameraLayerId, onClick);
      map.off('click', signalLayerId, onClick);
      map.off('mouseenter', cameraLayerId, onEnter);
      map.off('mouseleave', cameraLayerId, onLeave);
      map.off('mouseenter', signalLayerId, onEnter);
      map.off('mouseleave', signalLayerId, onLeave);
      popup.remove();
      cleanup();
    };
  }, [map, loadFeatures, cleanup]);

  return null;
}

export default memo(MapFeaturesLayer);
