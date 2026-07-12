'use client';
import { haversineDist, bearing } from './geo';

export type CameraType =
  | 'STATIONARY'
  | 'TRIPOD'
  | 'PHOTORADAR'
  | 'RED_LIGHT'
  | 'AVERAGE_SPEED'
  | 'MOBILE'
  | 'BUS_LANE'
  | 'DEDICATED_LANE'
  | 'AMBUSH'
  | 'SEATBELT';

export interface SpeedCamera {
  id: string;
  lat: number;
  lng: number;
  name: string;
  cameraType: CameraType;
  maxSpeed?: number;
  direction?: string;
  distance?: number;
}

export interface CameraWarning {
  camera: SpeedCamera;
  distanceMeters: number;
  timeToImpact: number;
  bearingDiff: number;
}

const CAMERA_TYPE_LABELS: Record<CameraType, { ru: string; en: string }> = {
  STATIONARY:      { ru: 'стационарная камера', en: 'stationary camera' },
  TRIPOD:          { ru: 'тренога', en: 'tripod camera' },
  PHOTORADAR:      { ru: 'фоторадар', en: 'photo radar' },
  RED_LIGHT:       { ru: 'камера на красный', en: 'red light camera' },
  AVERAGE_SPEED:   { ru: 'камера средней скорости', en: 'average speed camera' },
  MOBILE:          { ru: 'передвижная камера', en: 'mobile camera' },
  BUS_LANE:        { ru: 'камера на автобусную полосу', en: 'bus lane camera' },
  DEDICATED_LANE:  { ru: 'камера на выделенную полосу', en: 'dedicated lane camera' },
  AMBUSH:          { ru: 'засада', en: 'ambush camera' },
  SEATBELT:        { ru: 'камера на ремень', en: 'seatbelt camera' },
};

const CAMERA_EMOJIS: Record<CameraType, string> = {
  STATIONARY:      '📷',
  TRIPOD:          '🔭',
  PHOTORADAR:      '📸',
  RED_LIGHT:       '🔴',
  AVERAGE_SPEED:   '📏',
  MOBILE:          '🚙',
  BUS_LANE:        '🚌',
  DEDICATED_LANE:  '🛣️',
  AMBUSH:          '👁️',
  SEATBELT:        '💺',
};

const WARNING_DISTANCE_M = 1500;
const MIN_WARNING_INTERVAL_MS = 15000;

export function getCameraTypeLabel(type: CameraType, lang: string): string {
  const labels = CAMERA_TYPE_LABELS[type] || CAMERA_TYPE_LABELS.STATIONARY;
  return lang === 'ru' ? labels.ru : labels.en;
}

export function getCameraEmoji(type: CameraType): string {
  return CAMERA_EMOJIS[type] || '📷';
}

export function isCameraAhead(
  userLat: number,
  userLng: number,
  userBearing: number,
  cameraLat: number,
  cameraLng: number,
  aheadAngleDeg = 60,
): boolean {
  const b = bearing(userLat, userLng, cameraLat, cameraLng);
  let diff = b - userBearing;
  if (diff < -180) diff += 360;
  if (diff > 180) diff -= 360;
  return Math.abs(diff) <= aheadAngleDeg;
}

export function buildCameraWarningMessage(
  camera: SpeedCamera,
  distanceMeters: number,
  lang: string,
): string {
  const distKm = (distanceMeters / 1000).toFixed(1);
  const distStr = lang === 'ru'
    ? distanceMeters >= 1000 ? `${distKm} км` : `${Math.round(distanceMeters)} м`
    : distanceMeters >= 1000 ? `${distKm} km` : `${Math.round(distanceMeters)} m`;

  const typeStr = getCameraTypeLabel(camera.cameraType, lang);

  if (lang === 'ru') {
    let msg = `Внимание! Впереди ${typeStr}`;
    if (camera.maxSpeed) msg += `, ограничение ${camera.maxSpeed} км/ч`;
    msg += `. Расстояние: ${distStr}`;
    return msg;
  }

  let msg = `Caution! ${typeStr} ahead`;
  if (camera.maxSpeed) msg += `, speed limit ${camera.maxSpeed} km/h`;
  msg += `. Distance: ${distStr}`;
  return msg;
}

export function buildCameraAlertText(
  camera: SpeedCamera,
  distanceMeters: number,
  lang: string,
): { title: string; subtitle: string; desc: string } {
  const distKm = (distanceMeters / 1000).toFixed(1);
  const distStr = distanceMeters >= 1000 ? `${distKm} км` : `${Math.round(distanceMeters)} м`;
  const typeStr = getCameraTypeLabel(camera.cameraType, lang);
  const emoji = getCameraEmoji(camera.cameraType);

  const title = `${emoji} ${typeStr}`;
  const subtitle = lang === 'ru' ? `Расстояние: ${distStr}` : `Distance: ${distStr}`;
  const desc = camera.maxSpeed
    ? (lang === 'ru' ? `Ограничение: ${camera.maxSpeed} км/ч` : `Limit: ${camera.maxSpeed} km/h`)
    : (camera.name || '');

  return { title, subtitle, desc };
}

export function detectCameraTypeFromTags(tags: Record<string, string>): CameraType {
  if (tags['camera:type'] === 'fixed' || tags.fixed === 'yes' || !tags.mobile) return 'STATIONARY';
  if (tags.man_mobile === 'yes' || tags.mobile === 'yes') return 'MOBILE';
  if (tags['camera:type'] === 'tripod' || tags['tripod'] === 'yes') return 'TRIPOD';
  if (tags['camera:type'] === 'red_light' || tags['red_light_camera'] === 'yes') return 'RED_LIGHT';
  if (tags['camera:type'] === 'average_speed' || tags['average_speed'] === 'yes') return 'AVERAGE_SPEED';
  if (tags.enforcement === 'bus_lane') return 'BUS_LANE';
  if (tags.enforcement === 'dedicated_lane') return 'DEDICATED_LANE';
  if (tags['camera:type'] === 'photographic' || tags['camera:type'] === 'radar') return 'PHOTORADAR';
  if (tags['camera:type'] === 'ambush' || tags.hidden === 'yes') return 'AMBUSH';
  if (tags.enforcement === 'seatbelt' || tags['camera:type'] === 'seatbelt') return 'SEATBELT';
  return 'STATIONARY';
}

export function createSpeedCameraMonitor() {
  let cameras: SpeedCamera[] = [];
  let userLat = 0;
  let userLng = 0;
  let userBearing = 0;
  let userSpeed = 0;
  let warnedCameras = new Map<string, number>();
  let lastWarningTime = 0;

  function setCameras(newCameras: SpeedCamera[]) {
    cameras = newCameras;
  }

  function updatePosition(lat: number, lng: number, bearing_: number, speedKmh: number) {
    userLat = lat;
    userLng = lng;
    userBearing = bearing_;
    userSpeed = speedKmh;
  }

  function checkProximity(): CameraWarning | null {
    if (cameras.length === 0) return null;

    let nearest: CameraWarning | null = null;

    for (const cam of cameras) {
      const dist = haversineDist(userLat, userLng, cam.lat, cam.lng);
      if (dist > WARNING_DISTANCE_M) continue;

      if (!isCameraAhead(userLat, userLng, userBearing, cam.lat, cam.lng)) continue;

      const timeToImpact = userSpeed > 0 ? (dist / 1000) / userSpeed * 3600 : 0;

      const now = Date.now();
      const lastWarn = warnedCameras.get(cam.id) || 0;
      if (now - lastWarn < MIN_WARNING_INTERVAL_MS) continue;

      if (!nearest || dist < nearest.distanceMeters) {
        nearest = { camera: cam, distanceMeters: dist, timeToImpact, bearingDiff: 0 };
      }
    }

    return nearest;
  }

  function markWarned(cameraId: string) {
    warnedCameras.set(cameraId, Date.now());
  }

  function markPassed(cameraId: string) {
    warnedCameras.delete(cameraId);
  }

  function getCameras(): SpeedCamera[] {
    return cameras;
  }

  return { setCameras, updatePosition, checkProximity, markWarned, markPassed, getCameras };
}

export type SpeedCameraMonitor = ReturnType<typeof createSpeedCameraMonitor>;
