import L from 'leaflet';
import { MapObjectCategory, ReportType } from '@/types';

const CATEGORY_CONFIG: Record<string, { emoji: string; color: string }> = {
  GAS_STATION:        { emoji: '⛽', color: '#f97316' },
  EV_CHARGER:         { emoji: '🔌', color: '#22c55e' },
  PARKING:            { emoji: '🅿️', color: '#0ea5e9' },
  TRUCK_PARKING:      { emoji: '🚛', color: '#6366f1' },
  CAFE:               { emoji: '☕', color: '#a78bfa' },
  RESTAURANT:         { emoji: '🍽️', color: '#f43f5e' },
  HOTEL:              { emoji: '🏨', color: '#fbbf24' },
  MOTEL:              { emoji: '🛌', color: '#fb923c' },
  TOILET:             { emoji: '🚻', color: '#64748b' },
  SHOWER:             { emoji: '🚿', color: '#38bdf8' },
  PHARMACY:           { emoji: '💊', color: '#10b981' },
  HOSPITAL:           { emoji: '🏥', color: '#ef4444' },
  MEDICAL:            { emoji: '🩺', color: '#f87171' },
  SHOP:               { emoji: '🛒', color: '#8b5cf6' },
  SUPERMARKET:        { emoji: '🏪', color: '#7c3aed' },
  MALL:               { emoji: '🏬', color: '#a855f7' },
  SCHOOL:             { emoji: '📚', color: '#3b82f6' },
  UNIVERSITY:         { emoji: '🎓', color: '#6366f1' },
  KINDERGARTEN:       { emoji: '🧸', color: '#f472b6' },
  BANK:               { emoji: '🏦', color: '#84cc16' },
  ATM:                { emoji: '💳', color: '#65a30d' },
  BUS_STOP:           { emoji: '🚏', color: '#06b6d4' },
  METRO_STATION:      { emoji: '🚇', color: '#dc2626' },
  TRAIN_STATION:      { emoji: '🚉', color: '#2563eb' },
  AIRPORT:            { emoji: '✈️', color: '#0891b2' },
  PARK:               { emoji: '🌲', color: '#16a34a' },
  SPORTS_FACILITY:    { emoji: '⚽', color: '#22c55e' },
  GOVERNMENT:         { emoji: '🏛️', color: '#78716c' },
  ATTRACTION:         { emoji: '🏞️', color: '#d97706' },
  TIRE_SERVICE:       { emoji: '🔧', color: '#6b7280' },
  CAR_SERVICE:        { emoji: '🔩', color: '#4b5563' },
  CAR_WASH:           { emoji: '🧽', color: '#0369a1' },
  WEIGH_STATION:      { emoji: '⚖️', color: '#78716c' },
  BORDER_CROSSING:    { emoji: '🛂', color: '#dc2626' },
  CUSTOMS:            { emoji: '🛃', color: '#b91c1c' },
  REST_AREA:          { emoji: '🌳', color: '#16a34a' },
  TOURIST_ATTRACTION: { emoji: '🏞️', color: '#d97706' },
  SPEED_CAMERA:       { emoji: '📷', color: '#ef4444' },
  ROAD_WORKS:         { emoji: '🚧', color: '#f59e0b' },
  ACCIDENT:           { emoji: '🚨', color: '#dc2626' },
  TRAFFIC_LIGHT:      { emoji: '🚦', color: '#ef4444' },
  POLICE:             { emoji: '👮', color: '#3b82f6' },
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

function makeIcon(emoji: string, color: string, _size = 22, label = ''): L.DivIcon {
  const h = label ? 34 : 22;
  return L.divIcon({
    className: '',
    html: `
      <div style="display:flex;flex-direction:column;align-items:center">
        <div style="
          width:22px;height:22px;
          background:white;
          border-radius:50%;
          border:2.5px solid ${color};
          box-shadow:0 1px 3px rgba(0,0,0,0.25);
          display:flex;align-items:center;justify-content:center;
          font-size:11px;line-height:1
        ">${emoji}</div>
        ${label ? `<span style="
          font-size:9px;font-weight:500;color:rgba(0,0,0,0.65);
          text-shadow:0 1px 1px white, 0 0 2px white;
          white-space:nowrap;max-width:120px;overflow:hidden;text-overflow:ellipsis;
          line-height:1.2;margin-top:1px
        ">${label}</span>` : ''}
      </div>
    `,
    iconSize: [22, h],
    iconAnchor: [11, h],
    popupAnchor: [0, -h - 4],
  });
}

export function getCategoryIcon(category: MapObjectCategory, name = ''): L.DivIcon {
  const config = CATEGORY_CONFIG[category] || { emoji: '📍', color: '#6b7280' };
  return makeIcon(config.emoji, config.color, 22, name);
}

export function getReportIcon(type: ReportType, severity = 3): L.DivIcon {
  const config = REPORT_CONFIG[type] || { emoji: '⚠️', color: '#f97316' };
  const size = 24 + severity * 4;
  return makeIcon(config.emoji, config.color, size);
}

export function getUserIcon(heading = 0): L.DivIcon {
  return L.divIcon({
    className: '',
    html: `
      <div style="position:relative;width:40px;height:40px;display:flex;align-items:center;justify-content:center">
        <div style="
          position:absolute;inset:0;
          border-radius:50%;
          background:rgba(14,165,233,0.2);
          animation:ping 1.5s cubic-bezier(0,0,0.2,1) infinite;
        "></div>
        <div style="
          width:20px;height:20px;
          background:linear-gradient(135deg,#0ea5e9,#38bdf8);
          border-radius:50%;
          border:3px solid white;
          box-shadow:0 2px 12px rgba(14,165,233,0.6);
        "></div>
      </div>
    `,
    iconSize: [40, 40],
    iconAnchor: [20, 20],
  });
}
