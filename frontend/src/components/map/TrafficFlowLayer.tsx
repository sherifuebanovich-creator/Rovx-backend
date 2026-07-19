'use client';
import { useEffect, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import { useMapStore } from '@/store/map.store';

const SOURCE_ID = 'tomtom-traffic-flow-source';
const LAYER_ID = 'tomtom-traffic-flow-layer';

const TOMTOM_KEY = process.env.NEXT_PUBLIC_TOMTOM_API_KEY;
let warnedMissingKey = false;

export default function TrafficFlowLayer({ map }: { map: maplibregl.Map | null }) {
  const showTraffic = useMapStore((s) => s.showTraffic);

  const addLayer = useCallback(() => {
    if (!map || !map.isStyleLoaded()) return;
    if (!TOMTOM_KEY) {
      if (!warnedMissingKey) {
        console.warn('[TrafficFlowLayer] NEXT_PUBLIC_TOMTOM_API_KEY is not set — traffic flow layer disabled.');
        warnedMissingKey = true;
      }
      return;
    }
    if (map.getSource(SOURCE_ID)) return;

    try {
      map.addSource(SOURCE_ID, {
        type: 'raster',
        tiles: [
          `https://api.tomtom.com/traffic/map/4/tile/flow/relative0/{z}/{x}/{y}.png?key=${TOMTOM_KEY}`,
        ],
        tileSize: 256,
        maxzoom: 22,
        attribution: '&copy; TomTom Traffic',
      });

      // Insert below labels (so street/city names stay readable) but above
      // the base road/land layers, using the style's own first symbol layer
      // as the anchor — this is always a real, already-existing layer id at
      // this point, unlike hardcoding one of our own async-added layer ids.
      let beforeId: string | undefined;
      try {
        beforeId = map.getStyle()?.layers?.find((l) => l.type === 'symbol')?.id;
      } catch { /* ignore */ }

      map.addLayer(
        {
          id: LAYER_ID,
          type: 'raster',
          source: SOURCE_ID,
          paint: { 'raster-opacity': 0.85 },
        },
        beforeId,
      );
    } catch (err) {
      console.warn('[TrafficFlowLayer] Failed to add traffic flow layer:', err);
    }
  }, [map]);

  const removeLayer = useCallback(() => {
    if (!map) return;
    try {
      if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
      if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
    } catch { /* ignore */ }
  }, [map]);

  useEffect(() => {
    if (!map) return;
    if (showTraffic) addLayer(); else removeLayer();
  }, [map, showTraffic, addLayer, removeLayer]);

  // A style switch (setStyle) wipes all custom sources/layers — re-add once
  // the new style has finished loading, if the toggle is still on.
  useEffect(() => {
    if (!map) return;
    const onStyleLoad = () => { if (showTraffic) addLayer(); };
    map.on('style.load', onStyleLoad);
    return () => { map.off('style.load', onStyleLoad); };
  }, [map, showTraffic, addLayer]);

  return null;
}
