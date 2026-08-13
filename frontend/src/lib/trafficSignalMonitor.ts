'use client';
import { haversineDist, bearing } from './geo';

export interface TrafficSignal {
  id: string;
  lat: number;
  lng: number;
  name: string;
  crossing?: string;
}

export interface TrafficSignalWarning {
  signal: TrafficSignal;
  distanceMeters: number;
}

const WARNING_DISTANCE_M = 500;
const MIN_WARNING_INTERVAL_MS = 10000;

export function createTrafficSignalMonitor() {
  let signals: TrafficSignal[] = [];
  let userLat = 0;
  let userLng = 0;
  let userBearing = 0;
  let warnedSignals = new Map<string, number>();

  function setSignals(newSignals: TrafficSignal[]) {
    signals = newSignals;
  }

  function updatePosition(lat: number, lng: number, bearing: number) {
    userLat = lat;
    userLng = lng;
    userBearing = bearing;
  }

  function isAhead(lat: number, lng: number, aheadAngleDeg = 45): boolean {
    const b = bearing(userLat, userLng, lat, lng);
    let diff = b - userBearing;
    if (diff < -180) diff += 360;
    if (diff > 180) diff -= 360;
    return Math.abs(diff) <= aheadAngleDeg;
  }

  function checkProximity(): TrafficSignalWarning | null {
    if (signals.length === 0) return null;

    let nearest: TrafficSignalWarning | null = null;

    for (const sig of signals) {
      const dist = haversineDist(userLat, userLng, sig.lat, sig.lng);
      if (dist > WARNING_DISTANCE_M) continue;
      if (!isAhead(sig.lat, sig.lng)) continue;

      const now = Date.now();
      const lastWarn = warnedSignals.get(sig.id) || 0;
      if (now - lastWarn < MIN_WARNING_INTERVAL_MS) continue;

      if (!nearest || dist < nearest.distanceMeters) {
        nearest = { signal: sig, distanceMeters: dist };
      }
    }

    return nearest;
  }

  function markWarned(signalId: string) {
    warnedSignals.set(signalId, Date.now());
  }

  function markPassed(signalId: string) {
    warnedSignals.delete(signalId);
  }

  function getSignals(): TrafficSignal[] {
    return signals;
  }

  return {
    setSignals,
    updatePosition,
    checkProximity,
    markWarned,
    markPassed,
    getSignals,
  };
}

export type TrafficSignalMonitor = ReturnType<typeof createTrafficSignalMonitor>;
