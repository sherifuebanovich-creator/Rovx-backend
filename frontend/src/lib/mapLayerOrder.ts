import type maplibregl from 'maplibre-gl';

// Canonical layer IDs shared across the independent map sibling components
// (MapViewGL, MapFeaturesLayer, TrafficLayer, TrafficFlowLayer) so each can
// anchor its own addLayer() calls relative to another component's layers
// without hardcoding that component's internal id as a magic string —
// previously done by hand in one place (TrafficLayer.tsx's CAMERA_LAYER_ID,
// a literal copy of MapFeaturesLayer's local cameraLayerId with a comment
// explaining the two had to be kept in sync manually).
export const ROUTE_LINE_ID = 'route-line';
export const ROUTE_TRAVELED_ID = 'route-line-traveled';
export const ROUTE_REMAINING_ID = 'route-line-remaining';
export const POI_LAYER_ID = 'poi-objects-layer';
export const REPORTS_LAYER_ID = 'poi-reports-layer';
export const MAP_FEATURES_CLUSTER_LAYER_ID = 'map-features-clusters';
export const MAP_FEATURES_CAMERA_LAYER_ID = 'map-features-cameras';
export const MAP_FEATURES_SIGNAL_LAYER_ID = 'map-features-signals';

// Everything the route line, POI/report icons, and camera/signal clusters —
// none of these ever pass their own `before` on addLayer, so each new one
// simply lands on top of the current stack regardless of mount order, which
// is what keeps them as a group above traffic visualizations without this
// list needing to be "the top tier's own before target" too.
const TOP_TIER_LAYER_IDS = [
  ROUTE_LINE_ID, ROUTE_TRAVELED_ID, ROUTE_REMAINING_ID,
  POI_LAYER_ID, REPORTS_LAYER_ID,
  MAP_FEATURES_CLUSTER_LAYER_ID, MAP_FEATURES_CAMERA_LAYER_ID, MAP_FEATURES_SIGNAL_LAYER_ID,
];

/**
 * Returns the first of `ids` that currently exists as a layer on `map`, or
 * undefined. `addLayer(layer, before)` with a non-existent `before` id fires
 * a silent maplibre 'error' event and skips adding the layer entirely, so
 * every `before` argument in this codebase must be existence-checked first —
 * this generalizes that check to a preference-ordered list.
 */
export function firstExistingLayer(map: maplibregl.Map, ids: string[]): string | undefined {
  for (const id of ids) {
    if (map.getLayer(id)) return id;
  }
  return undefined;
}

// Anchor for traffic-visualization layers (jam heatmap, TomTom incident
// lines): the first top-tier layer that currently exists, so they render
// below the route/POI/camera icons whenever those exist yet, and simply on
// top of whatever's there (3D buildings, base style) otherwise — since the
// top tier itself always appends without a `before`, it ends up above
// traffic regardless of which side mounts first.
export function beforeTopTier(map: maplibregl.Map): string | undefined {
  return firstExistingLayer(map, TOP_TIER_LAYER_IDS);
}
