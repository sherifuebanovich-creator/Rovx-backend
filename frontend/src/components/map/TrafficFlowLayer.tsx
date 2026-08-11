'use client';
import { useEffect, useRef, useCallback, memo } from 'react';
import maplibregl from 'maplibre-gl';
import { useMapStore } from '@/store/map.store';
import { escapeAttr } from '@/lib/maplibreIcons';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

// Was a TomTom raster "flow" tile overlay — those tiles always render a
// colour for every road (green = free-flowing), so the whole map stayed
// tinted even where there was no congestion at all, and there was no way to
// tell "no traffic" apart from "traffic, but moving fine" at a glance. The
// Incidents API instead returns actual jam *segments* — nothing at all when
// a road has no reported jam, a real line exactly where one does.
const SOURCE_ID = 'tomtom-traffic-incidents-source';
const LINE_LAYER_ID = 'tomtom-traffic-incidents-line';
const MIN_ZOOM = 6;
const DEBOUNCE_MS = 500;
const MAX_FETCH_FAILURES = 3;

const TOMTOM_KEY = process.env.NEXT_PUBLIC_TOMTOM_API_KEY;
let warnedMissingKey = false;

// iconCategory 6 = Jam in TomTom's traffic model. magnitudeOfDelay: 0
// unknown, 1 minor, 2 moderate, 3 major, 4 undefined — only surfacing
// moderate/major matches "if there's no jam show nothing, yellow for a
// medium jam, a bigger red one for a major jam" rather than tinting every
// road with the slightest reported slowdown.
const JAM_ICON_CATEGORY = 6;

interface Props {
  map: maplibregl.Map | null;
}

function TrafficFlowLayer({ map }: Props) {
  const { t } = useTranslation();
  const showTraffic = useMapStore((s) => s.showTraffic);
  const setShowTraffic = useMapStore((s) => s.setShowTraffic);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const lastBoundsRef = useRef<string>('');
  const requestIdRef = useRef(0);
  const fetchFailuresRef = useRef(0);
  const disabledRef = useRef(false);
  const prevShowTrafficRef = useRef(showTraffic);

  const cleanup = useCallback(() => {
    if (!map) return;
    try {
      if (map.getLayer(LINE_LAYER_ID)) map.removeLayer(LINE_LAYER_ID);
      if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
    } catch { /* ignore */ }
  }, [map]);

  const loadIncidents = useCallback(async () => {
    if (!map || !showTraffic) return;
    if (!TOMTOM_KEY) {
      if (!warnedMissingKey) {
        console.warn('[TrafficFlowLayer] NEXT_PUBLIC_TOMTOM_API_KEY is not set — traffic layer disabled.');
        warnedMissingKey = true;
      }
      return;
    }
    if (disabledRef.current) return;

    const requestId = ++requestIdRef.current;
    const zoom = map.getZoom();
    if (zoom < MIN_ZOOM) {
      cleanup();
      lastBoundsRef.current = '';
      return;
    }

    const b = map.getBounds();
    const bbox = `${b.getWest()},${b.getSouth()},${b.getEast()},${b.getNorth()}`;
    if (bbox === lastBoundsRef.current) return;

    try {
      const fields = '{incidents{type,geometry{type,coordinates},properties{iconCategory,magnitudeOfDelay,events{description}}}}';
      const url = `https://api.tomtom.com/traffic/services/5/incidentDetails?key=${TOMTOM_KEY}&bbox=${bbox}&fields=${encodeURIComponent(fields)}&language=ru-RU`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (requestId !== requestIdRef.current) return;
      // Claimed BEFORE the fetch used to resolve — a transient network/HTTP
      // error left lastBoundsRef holding the bbox, so every later debounced
      // load for the same viewport short-circuited at the guard above and
      // never re-fetched; fetchFailuresRef stopped incrementing and the
      // circuit breaker could never trip, leaving traffic permanently blank
      // for that viewport. Only mark it after a successful fetch so the next
      // debounced load retries the failed viewport.
      lastBoundsRef.current = bbox;
      fetchFailuresRef.current = 0;

      const incidents = (data?.incidents || []) as Array<{
        geometry?: { type: string; coordinates: any };
        properties?: { iconCategory?: number; magnitudeOfDelay?: number; events?: { description?: string }[] };
      }>;
      const jams = incidents.filter((inc) =>
        inc.properties?.iconCategory === JAM_ICON_CATEGORY &&
        (inc.properties?.magnitudeOfDelay ?? 0) >= 2 &&
        inc.geometry?.type === 'LineString',
      );

      if (!map.isStyleLoaded()) return;
      cleanup();
      if (jams.length === 0) return;

      const geojson: GeoJSON.FeatureCollection = {
        type: 'FeatureCollection',
        features: jams.map((inc, i) => ({
          type: 'Feature',
          properties: {
            id: i,
            magnitudeOfDelay: inc.properties?.magnitudeOfDelay ?? 2,
            description: inc.properties?.events?.[0]?.description || '',
          },
          geometry: inc.geometry as GeoJSON.Geometry,
        })),
      };

      map.addSource(SOURCE_ID, { type: 'geojson', data: geojson });

      map.addLayer({
        id: LINE_LAYER_ID,
        type: 'line',
        source: SOURCE_ID,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          // Moderate (2) -> yellow, major/undefined (3, 4) -> red and drawn
          // thicker so a severe jam actually reads as more prominent, not
          // just a different colour of the same line.
          'line-color': ['case', ['==', ['get', 'magnitudeOfDelay'], 2], '#eab308', '#ef4444'],
          'line-width': ['case', ['==', ['get', 'magnitudeOfDelay'], 2], 5, 7],
          'line-opacity': 0.85,
        },
      });
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      fetchFailuresRef.current += 1;
      console.warn('[TrafficFlowLayer] Failed to load traffic incidents:', err);
      if (fetchFailuresRef.current >= MAX_FETCH_FAILURES) {
        disabledRef.current = true;
        cleanup();
        setShowTraffic(false);
        toast.error(t('topbar.trafficLoadFailed'));
      }
    }
  }, [map, showTraffic, cleanup, setShowTraffic, t]);

  useEffect(() => {
    if (!map) return;
    // The circuit breaker below (disabledRef) trips after MAX_FETCH_FAILURES
    // consecutive errors and used to stay tripped forever — re-enabling
    // traffic (this effect's showTraffic: false -> true transition, whether
    // the user did it or the breaker itself just did via setShowTraffic(false))
    // gives it a fresh attempt instead of silently no-oping every load for
    // the rest of the session.
    if (showTraffic && !prevShowTrafficRef.current) {
      disabledRef.current = false;
      fetchFailuresRef.current = 0;
    }
    prevShowTrafficRef.current = showTraffic;

    lastBoundsRef.current = '';
    if (showTraffic) {
      loadIncidents();
    } else {
      cleanup();
    }
  }, [map, showTraffic, loadIncidents, cleanup]);

  useEffect(() => {
    if (!map) return;

    const debouncedLoad = () => {
      clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(loadIncidents, DEBOUNCE_MS);
    };

    const popup = new maplibregl.Popup({ offset: [0, -8], maxWidth: '260px' });
    const onClick = (e: maplibregl.MapLayerMouseEvent) => {
      const feature = e.features?.[0];
      if (!feature) return;
      const props = feature.properties as any;
      const severity = props.magnitudeOfDelay >= 3 ? 'Серьёзная пробка' : 'Затруднённое движение';
      const desc = props.description ? `<div style="font-size:11px;color:#9ca3af;margin-top:2px">${escapeAttr(props.description)}</div>` : '';
      popup.setLngLat(e.lngLat).setHTML(
        `<div style="min-width:120px"><strong style="font-size:13px;color:white">🚗 ${severity}</strong>${desc}</div>`,
      ).addTo(map);
    };
    const onEnter = () => { map.getCanvas().style.cursor = 'pointer'; };
    const onLeave = () => { map.getCanvas().style.cursor = ''; };

    map.on('click', LINE_LAYER_ID, onClick);
    map.on('mouseenter', LINE_LAYER_ID, onEnter);
    map.on('mouseleave', LINE_LAYER_ID, onLeave);

    // Same race as MapFeaturesLayer's style.load handler — isStyleLoaded()
    // can still read false for a tick right when the event fires.
    const onStyleLoad = () => {
      lastBoundsRef.current = '';
      if (map.isStyleLoaded()) {
        loadIncidents();
      } else {
        map.once('idle', loadIncidents);
      }
    };

    map.on('moveend', debouncedLoad);
    map.on('zoomend', debouncedLoad);
    map.on('style.load', onStyleLoad);

    return () => {
      clearTimeout(debounceRef.current);
      map.off('moveend', debouncedLoad);
      map.off('zoomend', debouncedLoad);
      map.off('style.load', onStyleLoad);
      map.off('click', LINE_LAYER_ID, onClick);
      map.off('mouseenter', LINE_LAYER_ID, onEnter);
      map.off('mouseleave', LINE_LAYER_ID, onLeave);
      popup.remove();
    };
  }, [map, loadIncidents]);

  return null;
}

export default memo(TrafficFlowLayer);
