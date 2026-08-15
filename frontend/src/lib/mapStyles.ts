'use client';
import type { StyleSpecification } from 'maplibre-gl';

const OPENFREEMAP_LIGHT = 'https://tiles.openfreemap.org/styles/liberty';
const OPENFREEMAP_DARK = 'https://tiles.openfreemap.org/styles/dark';

const SATELLITE_STYLE: StyleSpecification = {
  version: 8,
  name: 'Satellite',
  // MapViewGL's poi-objects-layer/poi-reports-layer add a symbol layer with
  // `text-field` on top of whichever style is active (see the glyph-server
  // comment there) — without a `glyphs` template here, MapLibre has nowhere
  // to rasterize those labels from and warns "use of text-field requires a
  // style glyphs property", silently dropping every POI name label while in
  // Satellite mode. Same endpoint the OpenFreeMap-hosted styles already use,
  // so 'Noto Sans Regular' resolves identically across all MAP_STYLES.
  glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
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

const BUILDINGS_LAYER_ID = '3d-buildings';

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

// OpenFreeMap's default label layers render `name:latin name:nonlatin`
// (e.g. "Moscow Москва") whenever a place's local name isn't already Latin
// script — a deliberate international-friendly default in the upstream
// style, but for this app's Russian-first audience it just shows every
// Cyrillic place name twice. The local `name` tag is already the correct
// Russian text for the vast majority of OSM features in Russia/CIS, so for
// a Russian UI we can drop straight to it instead of the bilingual concat.
// Only touches symbol layers whose text-field matches that known upstream
// pattern, so it's a no-op if OpenFreeMap changes their style later.
export function localizeMapLabels(map: maplibregl.Map, lang: string) {
  if (!lang?.startsWith('ru')) return;

  const style = map.getStyle();
  if (!style?.layers) return;

  for (const layer of style.layers) {
    if (layer.type !== 'symbol') continue;
    const textField = (layer.layout as any)?.['text-field'];
    if (!textField || JSON.stringify(textField).indexOf('name:nonlatin') === -1) continue;
    try {
      map.setLayoutProperty(layer.id, 'text-field', ['coalesce', ['get', 'name'], ['get', 'name_en']]);
    } catch { /* layer removed mid-iteration or style still transitioning */ }
  }
}
