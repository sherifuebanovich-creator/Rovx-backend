'use client';
import { useEffect, useRef, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import { useMapStore } from '@/store/map.store';

const TRAFFIC_SOURCE = 'traffic-jam-source';
const TRAFFIC_HEATMAP = 'traffic-jam-heatmap';
const TRAFFIC_CIRCLES = 'traffic-jam-circles';
const TRAFFIC_LABELS = 'traffic-jam-labels';

function severityToColor(severity: number): string {
  if (severity >= 4) return '#ef4444';
  if (severity === 3) return '#f59e0b';
  return '#eab308';
}

function severityToWeight(severity: number): number {
  if (severity >= 5) return 1.0;
  if (severity === 4) return 0.8;
  if (severity === 3) return 0.5;
  if (severity === 2) return 0.3;
  return 0.15;
}

export default function TrafficLayer({ map }: { map: maplibregl.Map | null }) {
  const reports = useMapStore(s => s.reports);
  const prevReportsRef = useRef<string>('');

  const renderTraffic = useCallback((force = false) => {
    if (!map || !map.isStyleLoaded()) return;

    const trafficReports = reports.filter(r =>
      r.type === 'TRAFFIC_JAM' && (r.status === 'ACTIVE' || r.status === 'CONFIRMED')
    );

    const dataKey = JSON.stringify(trafficReports.map(r => [r.id, r.lat, r.lng, r.severity]));
    // A style change (e.g. switching to satellite) wipes all custom
    // sources/layers even though `reports` hasn't changed, so `force` lets
    // the style.load handler below re-add them regardless of the data memo.
    if (!force && dataKey === prevReportsRef.current) return;
    prevReportsRef.current = dataKey;

    const geojson: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: trafficReports.map(r => ({
        type: 'Feature',
        properties: {
          id: r.id,
          severity: r.severity || 3,
          description: r.description || '',
          type: r.type,
        },
        geometry: {
          type: 'Point',
          coordinates: [r.lng, r.lat],
        },
      })),
    };

    // Remove old layers
    [TRAFFIC_CIRCLES, TRAFFIC_HEATMAP, TRAFFIC_LABELS].forEach(id => {
      try { if (map.getLayer(id)) map.removeLayer(id); } catch {}
    });
    try { if (map.getSource(TRAFFIC_SOURCE)) map.removeSource(TRAFFIC_SOURCE); } catch {}

    if (trafficReports.length === 0) return;

    map.addSource(TRAFFIC_SOURCE, {
      type: 'geojson',
      data: geojson,
    });

    // Heatmap layer (Yandex-style glow)
    map.addLayer({
      id: TRAFFIC_HEATMAP,
      type: 'heatmap',
      source: TRAFFIC_SOURCE,
      maxzoom: 16,
      paint: {
        'heatmap-weight': [
          'interpolate', ['linear'], ['get', 'severity'],
          1, 0.15,
          2, 0.3,
          3, 0.5,
          4, 0.8,
          5, 1.0,
        ],
        'heatmap-intensity': [
          'interpolate', ['linear'], ['zoom'],
          10, 0.8,
          14, 1.5,
          16, 2.0,
        ],
        'heatmap-radius': [
          'interpolate', ['linear'], ['zoom'],
          10, 12,
          14, 25,
          16, 40,
        ],
        'heatmap-color': [
          'interpolate', ['linear'], ['heatmap-density'],
          0, 'rgba(234, 179, 8, 0)',
          0.2, 'rgba(234, 179, 8, 0.3)',
          0.4, 'rgba(245, 158, 11, 0.5)',
          0.6, 'rgba(249, 115, 22, 0.6)',
          0.8, 'rgba(239, 68, 68, 0.7)',
          1, 'rgba(220, 38, 38, 0.85)',
        ],
        'heatmap-opacity': [
          'interpolate', ['linear'], ['zoom'],
          10, 0.6,
          14, 0.8,
          16, 0.9,
        ],
      },
    }, 'map-features-cameras');

    // Circle layer (individual points with severity color)
    map.addLayer({
      id: TRAFFIC_CIRCLES,
      type: 'circle',
      source: TRAFFIC_SOURCE,
      minzoom: 13,
      paint: {
        'circle-radius': [
          'interpolate', ['linear'], ['get', 'severity'],
          1, 4,
          3, 6,
          5, 8,
        ],
        'circle-color': [
          'case',
          ['>=', ['get', 'severity'], 4], '#ef4444',
          ['>=', ['get', 'severity'], 3], '#f59e0b',
          '#eab308',
        ],
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 1,
        'circle-opacity': 0.85,
      },
    }, 'map-features-cameras');

    // Label layer
    map.addLayer({
      id: TRAFFIC_LABELS,
      type: 'symbol',
      source: TRAFFIC_SOURCE,
      minzoom: 15,
      layout: {
        'text-field': '🚗',
        'text-size': 12,
      },
      paint: {
        'text-opacity': 0.9,
      },
    }, 'map-features-cameras');

  }, [map, reports]);

  useEffect(() => {
    renderTraffic();
  }, [renderTraffic]);

  useEffect(() => {
    if (!map) return;
    const onStyleLoad = () => renderTraffic(true);
    map.on('style.load', onStyleLoad);
    return () => { map.off('style.load', onStyleLoad); };
  }, [map, renderTraffic]);

  return null;
}
