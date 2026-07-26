'use client';
import { useEffect, useRef, useCallback, memo } from 'react';
import maplibregl from 'maplibre-gl';
import { useMapStore } from '@/store/map.store';
import { mapApi } from '@/lib/api';
import { escapeAttr } from '@/lib/maplibreIcons';

const MIN_ZOOM = 8;
const DEBOUNCE_MS = 400;

interface Props {
  map: maplibregl.Map | null;
}

function MapFeaturesLayer({ map }: Props) {
  const sourceId = 'map-features-src';
  const clusterLayerId = 'map-features-clusters';
  const clusterCountId = 'map-features-cluster-count';
  const cameraLayerId = 'map-features-cameras';
  const cameraIconLayerId = 'map-features-camera-icon';
  const signalLayerId = 'map-features-signals';
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
      [clusterLayerId, clusterCountId, cameraLayerId, cameraIconLayerId, signalLayerId].forEach(id => {
        if (map.getLayer(id)) map.removeLayer(id);
      });
      if (map.getSource(sourceId)) map.removeSource(sourceId);
    } catch {}
  }, [map]);

  const loadFeatures = useCallback(async () => {
    if (!map) return;
    const requestId = ++requestIdRef.current;
    const zoom = map.getZoom();
    if (zoom < MIN_ZOOM) {
      cleanup();
      return;
    }

    const bounds = map.getBounds();
    const bbox = `${bounds.getSouth()},${bounds.getWest()},${bounds.getNorth()},${bounds.getEast()}`;

    if (bbox === lastBoundsRef.current) return;
    lastBoundsRef.current = bbox;

    try {
      const res = await mapApi.getFeatures(bbox, 'speed_camera,traffic_signals');
      if (requestId !== requestIdRef.current) return;
      const features = res.data?.data || res.data || [];

      if (!map.isStyleLoaded()) return;
      cleanup();
      if (!features.length) return;

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

      // Speed cameras — a white "badge" circle so the icon on top reads
      // clearly against any basemap color, topped with an actual camera
      // glyph instead of a plain colored dot (which read as an anonymous
      // point with no indication of what it was until tapped).
      map.addLayer({
        id: cameraLayerId,
        type: 'circle',
        source: sourceId,
        filter: ['all', ['!', ['has', 'point_count']], ['==', ['get', 'type'], 'speed_camera']],
        paint: {
          'circle-radius': 10,
          'circle-color': '#ffffff',
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ef4444',
        },
      });
      map.addLayer({
        id: cameraIconLayerId,
        type: 'symbol',
        source: sourceId,
        filter: ['all', ['!', ['has', 'point_count']], ['==', ['get', 'type'], 'speed_camera']],
        layout: {
          'text-field': '📷',
          'text-size': 13,
          'text-allow-overlap': true,
          'text-ignore-placement': true,
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
  }, [map, cleanup]);

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
    map.on('click', cameraIconLayerId, onClick);
    map.on('click', signalLayerId, onClick);
    map.on('mouseenter', cameraLayerId, onEnter);
    map.on('mouseleave', cameraLayerId, onLeave);
    map.on('mouseenter', cameraIconLayerId, onEnter);
    map.on('mouseleave', cameraIconLayerId, onLeave);
    map.on('mouseenter', signalLayerId, onEnter);
    map.on('mouseleave', signalLayerId, onLeave);

    map.on('moveend', debouncedLoad);
    map.on('zoomend', debouncedLoad);
    map.on('style.load', loadFeatures);

    loadFeatures();

    return () => {
      clearTimeout(debounceRef.current);
      map.off('moveend', debouncedLoad);
      map.off('zoomend', debouncedLoad);
      map.off('style.load', loadFeatures);
      map.off('click', cameraLayerId, onClick);
      map.off('click', cameraIconLayerId, onClick);
      map.off('click', signalLayerId, onClick);
      map.off('mouseenter', cameraLayerId, onEnter);
      map.off('mouseleave', cameraLayerId, onLeave);
      map.off('mouseenter', cameraIconLayerId, onEnter);
      map.off('mouseleave', cameraIconLayerId, onLeave);
      map.off('mouseenter', signalLayerId, onEnter);
      map.off('mouseleave', signalLayerId, onLeave);
      popup.remove();
      cleanup();
    };
  }, [map, loadFeatures, cleanup]);

  return null;
}

export default memo(MapFeaturesLayer);
