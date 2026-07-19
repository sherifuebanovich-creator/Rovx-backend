'use client';
import { useEffect, useRef, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import { useMapStore } from '@/store/map.store';
import toast from 'react-hot-toast';

const SOURCE_ID = 'tomtom-traffic-flow-source';
const LAYER_ID = 'tomtom-traffic-flow-layer';
const MAX_TILE_FAILURES = 3;

const TOMTOM_KEY = process.env.NEXT_PUBLIC_TOMTOM_API_KEY;
let warnedMissingKey = false;

export default function TrafficFlowLayer({ map }: { map: maplibregl.Map | null }) {
  const showTraffic = useMapStore((s) => s.showTraffic);
  const setShowTraffic = useMapStore((s) => s.setShowTraffic);
  const tileFailuresRef = useRef(0);
  const disabledForKeyRef = useRef(false);

  const removeLayer = useCallback(() => {
    if (!map) return;
    try {
      if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
      if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
    } catch { /* ignore */ }
  }, [map]);

  const addLayer = useCallback(() => {
    if (!map || !map.isStyleLoaded()) return;
    if (!TOMTOM_KEY) {
      if (!warnedMissingKey) {
        console.warn('[TrafficFlowLayer] NEXT_PUBLIC_TOMTOM_API_KEY is not set — traffic flow layer disabled.');
        warnedMissingKey = true;
      }
      return;
    }
    // A previous run this session already proved the key/tiles don't work —
    // don't keep re-adding a broken layer every time the toggle/style flips.
    if (disabledForKeyRef.current) return;
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
      tileFailuresRef.current = 0;
    } catch (err) {
      console.warn('[TrafficFlowLayer] Failed to add traffic flow layer:', err);
    }
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

  // An invalid/expired/rate-limited TomTom key doesn't throw when the layer
  // is added — the tile *requests* fail one at a time afterward. Left alone
  // that leaves a broken-looking overlay stuck over the whole map with no
  // way for the user to tell it's not working. Detect repeated tile
  // failures on our own source specifically and self-heal by tearing the
  // layer down and switching the toggle back off.
  useEffect(() => {
    if (!map) return;
    const onError = (e: any) => {
      if (e?.sourceId !== SOURCE_ID) return;
      tileFailuresRef.current += 1;
      if (tileFailuresRef.current >= MAX_TILE_FAILURES) {
        disabledForKeyRef.current = true;
        removeLayer();
        setShowTraffic(false);
        toast.error('Не удалось загрузить слой пробок — проверьте TomTom API-ключ');
      }
    };
    map.on('error', onError);
    return () => { map.off('error', onError); };
  }, [map, removeLayer, setShowTraffic]);

  return null;
}
