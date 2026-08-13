'use client';
import type { StyleSpecification } from 'maplibre-gl';

export const OPENFREEMAP_LIGHT = 'https://tiles.openfreemap.org/styles/liberty';
export const OPENFREEMAP_DARK = 'https://tiles.openfreemap.org/styles/dark';
export const OPENFREEMAP_POSITRON = 'https://tiles.openfreemap.org/styles/positron';

export const SATELLITE_STYLE: StyleSpecification = {
  version: 8,
  name: 'Satellite',
  sources: {
    'satellite': {
      type: 'raster',
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
      maxzoom: 19,
      attribution: '&copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community',
    },
    'labels': {
      type: 'raster',
      tiles: [
        'https://{s}.basemaps.cartocdn.com/rastertiles/voyager_labels_under/{z}/{x}/{y}{r}.png',
      ],
      tileSize: 256,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    },
  },
  layers: [
    { id: 'satellite-layer', type: 'raster', source: 'satellite' },
    { id: 'labels-layer', type: 'raster', source: 'labels' },
  ],
};

export const MAP_STYLES: Record<string, string | StyleSpecification> = {
  streets: OPENFREEMAP_LIGHT,
  satellite: SATELLITE_STYLE,
  night: OPENFREEMAP_DARK,
  traffic: OPENFREEMAP_LIGHT,
};

export const BUILDINGS_LAYER_ID = '3d-buildings';

export function getBuildingLayer(map: maplibregl.Map): boolean {
  try {
    const style = map.getStyle();
    if (!style?.sources) return false;

    const sourceEntry = Object.entries(style.sources).find(
      ([, s]) => (s as any).type === 'vector',
    );
    if (!sourceEntry) return false;

    return true;
  } catch {
    return false;
  }
}

export function add3DBuildings(map: maplibregl.Map, isDark = false) {
  if (map.getLayer(BUILDINGS_LAYER_ID)) return;

  if (!map.isStyleLoaded()) {
    map.once('style.load', () => add3DBuildings(map, isDark));
    return;
  }

  const style = map.getStyle();
  if (!style?.sources) return;

  const sourceEntry = Object.entries(style.sources).find(
    ([, s]) => (s as any).type === 'vector',
  );
  if (!sourceEntry) return;

  const [sourceId] = sourceEntry;

  try {
    const existingLayer = map.getLayer('building');
    const beforeId = existingLayer ? 'building' : undefined;

    if (map.getLayer(BUILDINGS_LAYER_ID)) return;

    map.addLayer(
      {
        id: BUILDINGS_LAYER_ID,
        type: 'fill-extrusion',
        source: sourceId,
        'source-layer': 'building',
        minzoom: 15,
        paint: {
          // The light pastel ramp looked washed out against the dark
          // basemap when switched to the night style — a mid-slate ramp
          // reads as buildings again instead of a grey haze.
          'fill-extrusion-color': isDark
            ? [
                'interpolate', ['linear'], ['get', 'render_height'],
                0, '#1e293b',
                30, '#334155',
                60, '#475569',
                100, '#64748b',
              ]
            : [
                'interpolate', ['linear'], ['get', 'render_height'],
                0, '#e2e8f0',
                30, '#cbd5e1',
                60, '#94a3b8',
                100, '#64748b',
              ],
          'fill-extrusion-height': [
            'interpolate',
            ['linear'],
            ['zoom'],
            15, 0,
            15.5, ['get', 'render_height'],
          ],
          'fill-extrusion-base': [
            'case',
            ['has', 'render_min_height'],
            ['get', 'render_min_height'],
            0,
          ],
          'fill-extrusion-opacity': [
            'interpolate',
            ['linear'],
            ['zoom'],
            15, 0,
            15.5, 0.3,
            16, 0.5,
            17, 0.7,
          ],
        },
      },
      beforeId,
    );
  } catch (e) {
    console.warn('[MapStyles] Failed to add 3D buildings:', e);
  }
}

export function remove3DBuildings(map: maplibregl.Map) {
  if (map.getLayer(BUILDINGS_LAYER_ID)) {
    map.removeLayer(BUILDINGS_LAYER_ID);
  }
}
