'use client';
import { useEffect, useRef, useCallback } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useMapStore } from '@/store/map.store';
import { mapApi, reportsApi } from '@/lib/api';
import { MapObject, Report } from '@/types';
import { getCategoryIcon, getReportIcon } from '@/lib/mapIcons';

const ALL_CATEGORIES = [
  'PARKING', 'TRUCK_PARKING', 'GAS_STATION', 'EV_CHARGER',
  'CAFE', 'RESTAURANT', 'SHOP', 'SUPERMARKET',
  'TOILET', 'SHOWER', 'MOTEL', 'HOTEL',
  'PHARMACY', 'HOSPITAL', 'MEDICAL',
  'TIRE_SERVICE', 'CAR_SERVICE', 'WEIGH_STATION',
  'BORDER_CROSSING', 'CUSTOMS', 'REST_AREA', 'TOURIST_ATTRACTION',
  'SPEED_CAMERA', 'ROAD_WORKS', 'ACCIDENT',
  'POLICE',
];

function escapeHtml(text: string): string {
  const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return text.replace(/[&<>"']/g, (c) => map[c]);
}

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

const MAP_TILES = {
  streets: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
  satellite: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  night: 'https://{s}.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}{r}.png',
  traffic: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
};

const BUILDINGS_TILE = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager_labels_under/{z}/{x}/{y}{r}.png';

export default function MapView() {
  const mapRef = useRef<L.Map | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const buildingsLayerRef = useRef<L.TileLayer | null>(null);
  const objectMarkersRef = useRef<L.LayerGroup | null>(null);
  const reportMarkersRef = useRef<L.LayerGroup | null>(null);
  const routeLayerRef = useRef<L.Polyline | null>(null);
  const userMarkerRef = useRef<L.Marker | null>(null);
  const loadTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const loadObjectsRef = useRef<(bounds: L.LatLngBounds) => void>();
  const loadReportsRef = useRef<(bounds: L.LatLngBounds) => void>();


  const mapCenter = useMapStore(s => s.mapCenter);
  const zoom = useMapStore(s => s.zoom);
  const mapStyle = useMapStore(s => s.mapStyle);
  const userLocation = useMapStore(s => s.userLocation);
  const userHeading = useMapStore(s => s.userHeading);
  const selectedRoute = useMapStore(s => s.selectedRoute);
  const setVisibleObjects = useMapStore(s => s.setVisibleObjects);
  const setSelectedObject = useMapStore(s => s.setSelectedObject);
  const setSelectedReport = useMapStore(s => s.setSelectedReport);
  const setReports = useMapStore(s => s.setReports);
  const followUser = useMapStore(s => s.followUser);
  const activeCategories = useMapStore(s => s.activeCategories);

  // Initialize map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: [mapCenter.lat, mapCenter.lng],
      zoom,
      zoomControl: false,
      attributionControl: false,
    });

    tileLayerRef.current = L.tileLayer(MAP_TILES[mapStyle], {
      maxZoom: 20,
      // Esri's free World_Imagery satellite tiles only have real high-res
      // coverage up to ~z17 outside major cities — beyond that in rural or
      // mountainous areas, the server doesn't 404, it returns an actual
      // "Map data not yet available" placeholder image as valid tile
      // content, which Leaflet then displays as-is. Capping the native
      // zoom lower for satellite mode makes Leaflet upscale the last real
      // tile instead of fetching that placeholder. The vector-rendered
      // street/night/traffic tiles have full global coverage at z19, so
      // they don't need this.
      maxNativeZoom: mapStyle === 'satellite' ? 17 : 19,
      detectRetina: true,
      attribution: '© OpenStreetMap contributors',
    }).addTo(map);

    if (mapStyle !== 'satellite') {
      buildingsLayerRef.current = L.tileLayer(BUILDINGS_TILE, {
        maxZoom: 20,
        maxNativeZoom: 19,
        detectRetina: true,
        opacity: 0.3,
      }).addTo(map);
    }

    objectMarkersRef.current = L.layerGroup().addTo(map);
    reportMarkersRef.current = L.layerGroup().addTo(map);

    map.on('moveend', () => {
      const bounds = map.getBounds();
      loadObjectsRef.current?.(bounds);
      loadReportsRef.current?.(bounds);
    });

    map.on('click', () => {
      setSelectedObject(null);
      setSelectedReport(null);
    });

    mapRef.current = map;

    return () => {
      clearTimeout(loadTimerRef.current);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!mapRef.current || !tileLayerRef.current) return;
    tileLayerRef.current.setUrl(MAP_TILES[mapStyle]);
    // setUrl() only swaps the URL template — it doesn't touch layer options,
    // so maxNativeZoom would otherwise stay stuck at whatever it was set to
    // on first mount regardless of which style is now active.
    (tileLayerRef.current.options as L.TileLayerOptions).maxNativeZoom = mapStyle === 'satellite' ? 17 : 19;

    if (buildingsLayerRef.current) {
      if (mapStyle === 'satellite') {
        buildingsLayerRef.current.remove();
        buildingsLayerRef.current = null;
      }
    } else if (mapStyle !== 'satellite' && mapRef.current) {
      buildingsLayerRef.current = L.tileLayer(BUILDINGS_TILE, {
        maxZoom: 20,
        maxNativeZoom: 19,
        detectRetina: true,
        opacity: 0.3,
      }).addTo(mapRef.current);
    }
  }, [mapStyle]);

  useEffect(() => {
    if (!mapRef.current || !userLocation) return;

    const headAngle = userHeading || 0;
    const userIcon = L.divIcon({
      className: '',
      html: `
        <div style="position:relative;width:40px;height:40px;display:flex;align-items:center;justify-content:center">
          <div style="position:absolute;inset:0;border-radius:50%;background:rgba(14,165,233,0.2);animation:ping 1.5s ease-out infinite"></div>
          <div style="
            width:0;height:0;
            border-left:8px solid transparent;
            border-right:8px solid transparent;
            border-bottom:18px solid #0ea5e9;
            filter:drop-shadow(0 2px 6px rgba(14,165,233,0.6));
            transform:rotate(${headAngle}deg);
            transition:transform 0.3s ease;
          "></div>
          <div style="position:absolute;width:8px;height:8px;border-radius:50%;background:white;top:50%;left:50%;transform:translate(-50%,-50%);border:2px solid #0ea5e9;"></div>
        </div>
      `,
      iconSize: [40, 40],
      iconAnchor: [20, 20],
    });

    if (userMarkerRef.current) {
      userMarkerRef.current.setLatLng([userLocation.lat, userLocation.lng]);
      userMarkerRef.current.setIcon(userIcon);
    } else {
      userMarkerRef.current = L.marker([userLocation.lat, userLocation.lng], {
        icon: userIcon,
        zIndexOffset: 1000,
      }).addTo(mapRef.current);
    }

    if (followUser) {
      mapRef.current.setView([userLocation.lat, userLocation.lng], undefined, {
        animate: true,
        duration: 0.5,
      });
    }
  }, [userLocation, userHeading, followUser]);

  useEffect(() => {
    if (!mapRef.current) return;
    if (followUser && userLocation) return;
    mapRef.current.setView([mapCenter.lat, mapCenter.lng], zoom, { animate: true });
  }, [mapCenter, zoom, followUser, userLocation]);

  useEffect(() => {
    if (!mapRef.current) return;

    if (routeLayerRef.current) {
      routeLayerRef.current.remove();
      routeLayerRef.current = null;
    }

    if (selectedRoute?.polyline.length) {
      const latlngs = selectedRoute.polyline.map((p) => [p.lat, p.lng] as L.LatLngTuple);

      routeLayerRef.current = L.polyline(latlngs, {
        color: '#0ea5e9',
        weight: 6,
        opacity: 0.9,
        lineCap: 'round',
        lineJoin: 'round',
      }).addTo(mapRef.current);

      mapRef.current.fitBounds(routeLayerRef.current.getBounds(), {
        padding: [60, 60],
        animate: true,
      });
    }
  }, [selectedRoute]);

  const renderObjectMarkers = useCallback(
    (objects: MapObject[]) => {
      if (!objectMarkersRef.current) return;
      objectMarkersRef.current.clearLayers();

      objects.forEach((obj) => {
        const icon = getCategoryIcon(obj.category, obj.name);
        const marker = L.marker([obj.lat, obj.lng], { icon });

        marker.on('click', (e) => {
          L.DomEvent.stopPropagation(e);
          setSelectedObject(obj);
        });

        const ratingHtml = obj.rating != null && obj.rating > 0
          ? `<span class="text-yellow-400">\u2605 ${obj.rating.toFixed(1)}</span>`
          : '';

        let popupContent = `<div style="min-width:160px">
          <p style="font-weight:600;margin:0 0 4px;font-size:13px">${escapeHtml(obj.name)}</p>
          ${ratingHtml}
          ${obj.address ? `<p style="font-size:11px;color:#9ca3af;margin:2px 0">${escapeHtml(obj.address)}</p>` : ''}
          ${obj.distance ? `<p style="font-size:11px;color:#6b7280;margin:2px 0">${obj.distance < 1000 ? Math.round(obj.distance) + ' \u043c' : (obj.distance / 1000).toFixed(1) + ' \u043a\u043c'}</p>` : ''}
        </div>`;

        marker.bindPopup(popupContent, {
          className: 'custom-popup',
          closeButton: true,
          offset: [0, -10],
        });

        objectMarkersRef.current.addLayer(marker);
      });
    },
    [setSelectedObject],
  );

  const loadObjects = useCallback(
    async (bounds: L.LatLngBounds) => {
      if (mapRef.current && mapRef.current.getZoom() < 13) return;

      const cats = useMapStore.getState().activeCategories;
      if (cats.length === 0) {
        objectMarkersRef.current?.clearLayers();
        setVisibleObjects([]);
        return;
      }

      clearTimeout(loadTimerRef.current);
      loadTimerRef.current = setTimeout(async () => {
        try {
          const res = await mapApi.getObjects({
            minLat: bounds.getSouth(),
            maxLat: bounds.getNorth(),
            minLng: bounds.getWest(),
            maxLng: bounds.getEast(),
            categories: cats.join(','),
            limit: 150,
          });

          const objects: MapObject[] = res.data.data || res.data || [];
          setVisibleObjects(objects);
          renderObjectMarkers(objects);
        } catch (err) {
          console.warn('[MapView] Failed to load objects:', err);
        }
      }, 300);
    },
    [setVisibleObjects],
  );

  useEffect(() => {
    loadObjectsRef.current = loadObjects;
  }, [loadObjects]);

  useEffect(() => {
    if (!mapRef.current) return;
    const bounds = mapRef.current.getBounds();
    loadObjectsRef.current?.(bounds);
  }, [activeCategories]);

  const cleanReports = useCallback(
    async (bounds: L.LatLngBounds) => {
      if (mapRef.current && mapRef.current.getZoom() < 13) return;
      try {
        const res = await reportsApi.getInArea({
          minLat: bounds.getSouth(),
          maxLat: bounds.getNorth(),
          minLng: bounds.getWest(),
          maxLng: bounds.getEast(),
        });
        const reports: Report[] = res.data.data || res.data || [];
        setReports(reports);

        if (!reportMarkersRef.current) return;
        reportMarkersRef.current.clearLayers();
        reports.forEach((r) => {
          const icon = getReportIcon(r.type);
          const marker = L.marker([r.lat, r.lng], { icon });
          marker.on('click', (e) => {
            L.DomEvent.stopPropagation(e);
            setSelectedReport(r);
          });
          reportMarkersRef.current?.addLayer(marker);
        });
      } catch (err) {
        console.warn('[MapView] Failed to load reports:', err);
      }
    },
    [setReports, setSelectedReport],
  );

  const loadReports = cleanReports;

  useEffect(() => {
    loadReportsRef.current = loadReports;
  }, [loadReports]);

  return (
    <div className="absolute inset-0 z-0" style={{ isolation: 'isolate' }}>
      <div ref={containerRef} className="w-full h-full" />
    </div>
  );
}
