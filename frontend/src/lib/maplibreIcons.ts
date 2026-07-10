'use client';
import maplibregl from 'maplibre-gl';
import { MapObjectCategory, ReportType } from '@/types';

const CATEGORY_CONFIG: Record<string, { emoji: string; color: string; label: string }> = {
  GAS_STATION:        { emoji: '⛽', color: '#f97316', label: 'АЗС' },
  EV_CHARGER:         { emoji: '🔌', color: '#22c55e', label: 'Зарядка' },
  PARKING:            { emoji: '🅿️', color: '#0ea5e9', label: 'Парковка' },
  TRUCK_PARKING:      { emoji: '🚛', color: '#6366f1', label: 'Парковка T' },
  CAFE:               { emoji: '☕', color: '#a78bfa', label: 'Кафе' },
  RESTAURANT:         { emoji: '🍽️', color: '#f43f5e', label: 'Ресторан' },
  HOTEL:              { emoji: '🏨', color: '#fbbf24', label: 'Отель' },
  MOTEL:              { emoji: '🛌', color: '#fb923c', label: 'Мотель' },
  TOILET:             { emoji: '🚻', color: '#64748b', label: 'Туалет' },
  SHOWER:             { emoji: '🚿', color: '#38bdf8', label: 'Душ' },
  PHARMACY:           { emoji: '💊', color: '#10b981', label: 'Аптека' },
  HOSPITAL:           { emoji: '🏥', color: '#ef4444', label: 'Больница' },
  MEDICAL:            { emoji: '🩺', color: '#f87171', label: 'Поликлиника' },
  SHOP:               { emoji: '🛒', color: '#8b5cf6', label: 'Магазин' },
  SUPERMARKET:        { emoji: '🏪', color: '#7c3aed', label: 'Супермаркет' },
  MALL:               { emoji: '🏬', color: '#a855f7', label: 'ТЦ' },
  SCHOOL:             { emoji: '📚', color: '#3b82f6', label: 'Школа' },
  UNIVERSITY:         { emoji: '🎓', color: '#6366f1', label: 'Университет' },
  KINDERGARTEN:       { emoji: '🧸', color: '#f472b6', label: 'Детсад' },
  BANK:               { emoji: '🏦', color: '#84cc16', label: 'Банк' },
  ATM:                { emoji: '💳', color: '#65a30d', label: 'Банкомат' },
  BUS_STOP:           { emoji: '🚏', color: '#06b6d4', label: 'Остановка' },
  METRO_STATION:      { emoji: '🚇', color: '#dc2626', label: 'Метро' },
  TRAIN_STATION:      { emoji: '🚉', color: '#2563eb', label: 'Вокзал' },
  AIRPORT:            { emoji: '✈️', color: '#0891b2', label: 'Аэропорт' },
  PARK:               { emoji: '🌲', color: '#16a34a', label: 'Парк' },
  SPORTS_FACILITY:    { emoji: '⚽', color: '#22c55e', label: 'Спорт' },
  GOVERNMENT:         { emoji: '🏛️', color: '#78716c', label: 'Учреждение' },
  ATTRACTION:         { emoji: '📸', color: '#d97706', label: 'Дост.' },
  TOURIST_ATTRACTION: { emoji: '📸', color: '#d97706', label: 'Дост.' },
  TIRE_SERVICE:       { emoji: '🔧', color: '#6b7280', label: 'Шины' },
  CAR_SERVICE:        { emoji: '🔩', color: '#4b5563', label: 'Автосервис' },
  WEIGH_STATION:      { emoji: '⚖️', color: '#78716c', label: 'Вес' },
  BORDER_CROSSING:    { emoji: '🛂', color: '#dc2626', label: 'Граница' },
  CUSTOMS:            { emoji: '🏛️', color: '#b91c1c', label: 'Таможня' },
  REST_AREA:          { emoji: '🌳', color: '#16a34a', label: 'Отдых' },
  SPEED_CAMERA:       { emoji: '📷', color: '#ef4444', label: 'Камера' },
  ROAD_WORKS:         { emoji: '🚧', color: '#f59e0b', label: 'Работы' },
  ACCIDENT:           { emoji: '💥', color: '#dc2626', label: 'ДТП' },
  TRAFFIC_LIGHT:      { emoji: '🚦', color: '#ef4444', label: 'Светофор' },
  POLICE:             { emoji: '🚔', color: '#3b82f6', label: 'Полиция' },
};

const REPORT_CONFIG: Record<string, { emoji: string; color: string }> = {
  POTHOLE:            { emoji: '🕳️', color: '#ef4444' },
  BAD_ROAD:           { emoji: '⚠️', color: '#f97316' },
  ICE:                { emoji: '🧊', color: '#38bdf8' },
  STRONG_WIND:        { emoji: '💨', color: '#94a3b8' },
  FREQUENT_ACCIDENTS: { emoji: '⚡', color: '#ef4444' },
  FOG:                { emoji: '🌫️', color: '#94a3b8' },
  FLOODING:           { emoji: '🌊', color: '#0ea5e9' },
  LANDSLIDE:          { emoji: '⛰️', color: '#78716c' },
  LOW_BRIDGE:         { emoji: '🌉', color: '#f59e0b' },
  SHARP_TURN:         { emoji: '↩️', color: '#f97316' },
  STEEP_CLIMB:        { emoji: '⬆️', color: '#84cc16' },
  STEEP_DESCENT:      { emoji: '⬇️', color: '#f97316' },
  WEIGHT_LIMIT:       { emoji: '🏋️', color: '#a855f7' },
  HEIGHT_LIMIT:       { emoji: '📏', color: '#6366f1' },
  LENGTH_LIMIT:       { emoji: '↔️', color: '#6366f1' },
  SPEED_CAMERA:       { emoji: '📷', color: '#ef4444' },
  ROAD_WORKS:         { emoji: '🚧', color: '#f59e0b' },
  ACCIDENT:           { emoji: '💥', color: '#dc2626' },
  ROAD_CLOSURE:       { emoji: '🚫', color: '#dc2626' },
  TRAFFIC_JAM:        { emoji: '🚗', color: '#f97316' },
  POLICE:             { emoji: '🚔', color: '#3b82f6' },
  HAZARD:             { emoji: '⚠️', color: '#ef4444' },
  OTHER:              { emoji: '❗', color: '#6b7280' },
};

function escapeAttr(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function createMarkerElement(emoji: string, color: string, size = 28, label = ''): HTMLDivElement {
  const el = document.createElement('div');
  el.style.cssText = `
    display:flex;
    flex-direction:column;
    align-items:center;
    cursor:pointer;
  `;

  const icon = document.createElement('div');
  icon.style.cssText = `
    width:${size}px;
    height:${size}px;
    background:white;
    border-radius:50%;
    border:2.5px solid ${color};
    box-shadow:0 2px 8px rgba(0,0,0,0.3), 0 0 0 2px rgba(255,255,255,0.5);
    display:flex;
    align-items:center;
    justify-content:center;
    font-size:${size > 24 ? '16' : '13'}px;
    line-height:1;
    transition:transform 0.2s ease;
  `;
  icon.textContent = emoji;
  el.appendChild(icon);

  if (label) {
    const lbl = document.createElement('span');
    lbl.style.cssText = `
      font-size:9px;
      font-weight:600;
      color:rgba(0,0,0,0.75);
      text-shadow:0 0 3px white, 0 0 2px white;
      white-space:nowrap;
      max-width:100px;
      overflow:hidden;
      text-overflow:ellipsis;
      line-height:1.3;
      margin-top:2px;
      background:rgba(255,255,255,0.7);
      padding:0 4px;
      border-radius:4px;
    `;
    lbl.textContent = label;
    el.appendChild(lbl);
  }

  return el;
}

export function createCategoryMarker(category: MapObjectCategory, name = ''): HTMLDivElement {
  const config = CATEGORY_CONFIG[category] || { emoji: '📍', color: '#6b7280', label: '' };
  return createMarkerElement(config.emoji, config.color, 28, name);
}

export function createReportMarker(type: ReportType, severity = 3): HTMLDivElement {
  const config = REPORT_CONFIG[type] || { emoji: '⚠️', color: '#f97316' };
  const size = 26 + severity * 3;
  return createMarkerElement(config.emoji, config.color, Math.min(size, 44));
}

export function createUserMarkerElement(heading = 0): HTMLDivElement {
  const el = document.createElement('div');
  el.style.cssText = `
    position:relative;
    width:36px;
    height:36px;
    display:flex;
    align-items:center;
    justify-content:center;
  `;

  const pulse = document.createElement('div');
  pulse.style.cssText = `
    position:absolute;
    inset:-3px;
    border-radius:50%;
    background:rgba(14,165,233,0.15);
    animation:gl-pulse 2s cubic-bezier(0,0,0.2,1) infinite;
  `;
  el.appendChild(pulse);

  const outer = document.createElement('div');
  outer.style.cssText = `
    width:20px;
    height:20px;
    border-radius:50%;
    background:#0ea5e9;
    box-shadow:0 2px 8px rgba(14,165,233,0.6);
    display:flex;
    align-items:center;
    justify-content:center;
    position:relative;
  `;
  el.appendChild(outer);

  const inner = document.createElement('div');
  inner.style.cssText = `
    width:8px;
    height:8px;
    border-radius:50%;
    background:white;
  `;
  outer.appendChild(inner);

  const headArrow = document.createElement('div');
  headArrow.style.cssText = `
    position:absolute;
    top:-12px;
    left:50%;
    margin-left:-5px;
    width:0;height:0;
    border-left:5px solid transparent;
    border-right:5px solid transparent;
    border-bottom:10px solid #0ea5e9;
    transform:rotate(${heading}deg);
    transform-origin:center 22px;
    transition:transform 0.3s ease;
    filter:drop-shadow(0 1px 3px rgba(14,165,233,0.5));
  `;
  outer.appendChild(headArrow);

  return el;
}

export interface BlueDotElements {
  container: HTMLDivElement;
  pulseRing: HTMLDivElement;
  dotOuter: HTMLDivElement;
  dotInner: HTMLDivElement;
  headingCone: HTMLDivElement;
  accuracyCircle: HTMLDivElement;
}

export function createBlueDotElements(): BlueDotElements {
  const container = document.createElement('div');
  container.className = 'rovx-user-location';
  container.style.cssText = 'position:relative;width:0;height:0;pointer-events:none;';

  const accuracyCircle = document.createElement('div');
  accuracyCircle.className = 'rovx-accuracy-circle';
  accuracyCircle.style.cssText = `
    position:absolute;
    border-radius:50%;
    background:rgba(14,165,233,0.08);
    border:1.5px solid rgba(14,165,233,0.2);
    transform:translate(-50%,-50%);
    transition:width 0.8s ease, height 0.8s ease;
    pointer-events:none;
  `;
  container.appendChild(accuracyCircle);

  const pulseRing = document.createElement('div');
  pulseRing.className = 'rovx-pulse-ring';
  pulseRing.style.cssText = `
    position:absolute;
    width:40px;
    height:40px;
    border-radius:50%;
    background:rgba(14,165,233,0.12);
    transform:translate(-50%,-50%) translate(0,-10px);
    animation:rovx-pulse 2.5s cubic-bezier(0,0,0.2,1) infinite;
    pointer-events:none;
  `;
  container.appendChild(pulseRing);

  const headingCone = document.createElement('div');
  headingCone.className = 'rovx-heading-cone';
  headingCone.style.cssText = `
    position:absolute;
    width:0;
    height:0;
    border-left:14px solid transparent;
    border-right:14px solid transparent;
    border-bottom:28px solid rgba(14,165,233,0.25);
    transform:translate(-50%,-100%) translate(0,-10px) rotate(0deg);
    transform-origin:center bottom;
    transition:transform 0.4s cubic-bezier(0.33,1,0.68,1);
    filter:blur(1px);
    pointer-events:none;
  `;
  container.appendChild(headingCone);

  const dotOuter = document.createElement('div');
  dotOuter.className = 'rovx-dot-outer';
  dotOuter.style.cssText = `
    position:absolute;
    width:22px;
    height:22px;
    border-radius:50%;
    background:#0ea5e9;
    border:3px solid white;
    box-shadow:0 2px 10px rgba(0,0,0,0.3), 0 0 0 2px rgba(14,165,233,0.3);
    transform:translate(-50%,-50%) translate(0,-10px);
    transition:box-shadow 0.3s ease;
    pointer-events:auto;
    cursor:pointer;
  `;
  container.appendChild(dotOuter);

  const dotInner = document.createElement('div');
  dotInner.className = 'rovx-dot-inner';
  dotInner.style.cssText = `
    position:absolute;
    top:50%;
    left:50%;
    width:8px;
    height:8px;
    border-radius:50%;
    background:white;
    transform:translate(-50%,-50%);
    pointer-events:none;
  `;
  dotOuter.appendChild(dotInner);

  return { container, pulseRing, dotOuter, dotInner, headingCone, accuracyCircle };
}

export function updateBlueDotAccuracy(el: BlueDotElements, accuracyMeters: number, mapZoom: number) {
  const metersPerPixel = 156543.03392 * Math.cos((el.container.ownerDocument.defaultView as any)?.__mapCenterLat ?? 0) / Math.pow(2, mapZoom);
  const diameterPx = (accuracyMeters / metersPerPixel) * 2;
  const clamped = Math.min(Math.max(diameterPx, 24), 400);

  el.accuracyCircle.style.width = `${clamped}px`;
  el.accuracyCircle.style.height = `${clamped}px`;
}

export function updateBlueDotHeading(el: BlueDotElements, heading: number) {
  el.headingCone.style.transform = `translate(-50%,-100%) translate(0,-10px) rotate(${heading}deg)`;
}

export function metersToPixelsAtLat(meters: number, lat: number, zoom: number): number {
  const latRad = (lat * Math.PI) / 180;
  const metersPerPixel = (156543.03392 * Math.cos(latRad)) / Math.pow(2, zoom);
  return meters / metersPerPixel;
}

export function accuracyCircleGeoJSON(lat: number, lng: number, radiusMeters: number, segments = 64): GeoJSON.Feature<GeoJSON.Polygon> {
  const coords: [number, number][] = [];
  const earthRadius = 6371000;
  const dLat = radiusMeters / earthRadius;
  const dLng = dLat / Math.cos((lat * Math.PI) / 180);

  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * 2 * Math.PI;
    const pLat = lat + (dLat * Math.sin(angle)) * (180 / Math.PI);
    const pLng = lng + (dLng * Math.cos(angle)) * (180 / Math.PI);
    coords.push([pLng, pLat]);
  }

  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'Polygon', coordinates: [coords] },
  };
}

export function createPopupContent(
  name: string,
  category: string,
  address?: string,
  rating?: number,
  distance?: number,
): string {
  const label = CATEGORY_CONFIG[category]?.emoji || '📍';
  const ratingHtml = rating && rating > 0
    ? `<span style="color:#fbbf24;font-size:12px;">★ ${rating.toFixed(1)}</span>`
    : '';

  const distanceHtml = distance != null
    ? `<span style="color:#6b7280;font-size:11px;">${distance < 1000 ? Math.round(distance) + ' м' : (distance / 1000).toFixed(1) + ' км'}</span>`
    : '';

  return `
    <div style="min-width:150px;font-family:system-ui,sans-serif;">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
        <span style="font-size:16px;">${label}</span>
        <strong style="font-size:13px;color:white;">${escapeAttr(name)}</strong>
      </div>
      ${ratingHtml ? `<div style="margin-bottom:2px;">${ratingHtml}</div>` : ''}
      ${address ? `<p style="font-size:11px;color:#9ca3af;margin:2px 0;">${escapeAttr(address)}</p>` : ''}
      ${distanceHtml ? `<p style="margin:2px 0;">${distanceHtml}</p>` : ''}
    </div>
  `;
}

export function createTrafficSignalMarker(): HTMLDivElement {
  const el = document.createElement('div');
  el.style.cssText = `
    display:flex;
    flex-direction:column;
    align-items:center;
    cursor:pointer;
    gap:2px;
    padding:3px 3px;
    background:rgba(0,0,0,0.6);
    border-radius:4px;
    backdrop-filter:blur(2px);
    border:1px solid rgba(255,255,255,0.15);
  `;

  const colors = ['#ef4444', '#f59e0b', '#22c55e'];
  colors.forEach((c) => {
    const bulb = document.createElement('div');
    bulb.style.cssText = `
      width:8px;height:8px;border-radius:50%;
      background:${c};
      opacity:0.6;
      box-shadow:0 0 4px ${c}80;
    `;
    el.appendChild(bulb);
  });

  return el;
}

export { CATEGORY_CONFIG, REPORT_CONFIG };
