import { Coordinates, TurnInstruction, RouteResult, VehicleType } from '@/types';
import { haversineDist, bearing } from './geo';

export interface NavigationUpdate {
  currentLeg: number;
  routeProgress: number;
  distanceToManeuver: number;
  bearingToManeuver: number;
  isArrived: boolean;
  isOffRoute: boolean;
  shouldReroute: boolean;
  isWrongWay: boolean;
  forwardIndex: number;
}

const ARRIVAL_THRESHOLD_METERS = 50;
const OFF_ROUTE_THRESHOLD_METERS = 30;
const LEG_ADVANCE_DISTANCE_METERS = 15;
const WRONG_WAY_ANGLE_DEG = 100;
const FORWARD_SEARCH_RADIUS_M = 200;

let lastRerouteTime = 0;
const REROUTE_COOLDOWN_MS = 15000;

export function resetRerouteCooldown() {
  lastRerouteTime = 0;
}

function normalizeAngle(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

function angleDiff(a: number, b: number): number {
  let d = Math.abs(a - b) % 360;
  if (d > 180) d = 360 - d;
  return d;
}

export function findClosestPointOnPolyline(
  userLat: number,
  userLng: number,
  polyline: Coordinates[],
): { index: number; distance: number; fraction: number } {
  if (!polyline.length) return { index: 0, distance: Infinity, fraction: 0 };

  const destLat = polyline[polyline.length - 1].lat;
  const destLng = polyline[polyline.length - 1].lng;
  if (userLat === destLat && userLng === destLng) {
    return { index: polyline.length - 1, distance: 0, fraction: 1 };
  }

  let minDist = Infinity;
  let bestIdx = 0;

  for (let i = 0; i < polyline.length; i++) {
    const d = haversineDist(userLat, userLng, polyline[i].lat, polyline[i].lng);
    if (d < minDist) {
      minDist = d;
      bestIdx = i;
    }
  }

  let fraction = 0;
  if (bestIdx > 0 && bestIdx < polyline.length) {
    const d1 = haversineDist(userLat, userLng, polyline[bestIdx - 1].lat, polyline[bestIdx - 1].lng);
    const d2 = minDist;
    const segLen = haversineDist(
      polyline[bestIdx - 1].lat, polyline[bestIdx - 1].lng,
      polyline[bestIdx].lat, polyline[bestIdx].lng,
    );
    if (segLen > 0) {
      fraction = Math.max(0, Math.min(1, (d1 - d2 + segLen) / (2 * segLen)));
    }
  }

  return { index: bestIdx, distance: minDist, fraction };
}

function findInstructionPolylineIndex(
  instruction: TurnInstruction,
  polyline: Coordinates[],
): number {
  let minDist = Infinity;
  let bestIdx = 0;
  for (let i = 0; i < polyline.length; i++) {
    const d = haversineDist(instruction.lat, instruction.lng, polyline[i].lat, polyline[i].lng);
    if (d < minDist) {
      minDist = d;
      bestIdx = i;
    }
  }
  return bestIdx;
}

function findForwardClosestPoint(
  userLat: number,
  userLng: number,
  userHeading: number,
  polyline: Coordinates[],
): { index: number; distance: number; isWrongWay: boolean } {
  if (!polyline.length) return { index: 0, distance: Infinity, isWrongWay: false };

  const closest = findClosestPointOnPolyline(userLat, userLng, polyline);

  if (closest.index >= polyline.length - 1) {
    return { index: polyline.length - 1, distance: closest.distance, isWrongWay: false };
  }

  const segBearing = bearing(
    polyline[closest.index].lat, polyline[closest.index].lng,
    polyline[Math.min(closest.index + 1, polyline.length - 1)].lat,
    polyline[Math.min(closest.index + 1, polyline.length - 1)].lng,
  );

  const headingDiff = angleDiff(userHeading, segBearing);
  if (headingDiff < WRONG_WAY_ANGLE_DEG) {
    return { index: closest.index, distance: closest.distance, isWrongWay: false };
  }

  let bestIdx = closest.index;
  let bestDist = Infinity;
  let foundForward = false;

  for (let i = Math.max(0, closest.index - 10); i < polyline.length; i++) {
    const d = haversineDist(userLat, userLng, polyline[i].lat, polyline[i].lng);
    if (d > FORWARD_SEARCH_RADIUS_M) continue;

    if (i < polyline.length - 1) {
      const segB = bearing(polyline[i].lat, polyline[i].lng, polyline[i + 1].lat, polyline[i + 1].lng);
      const diff = angleDiff(userHeading, segB);
      if (diff < WRONG_WAY_ANGLE_DEG && d < bestDist) {
        bestDist = d;
        bestIdx = i;
        foundForward = true;
      }
    }
  }

  if (foundForward) {
    return { index: bestIdx, distance: bestDist, isWrongWay: false };
  }

  return { index: closest.index, distance: closest.distance, isWrongWay: true };
}

export function computeNavigationUpdate(
  userLat: number,
  userLng: number,
  userHeading: number,
  route: RouteResult,
  currentLeg: number,
): NavigationUpdate {
  const { polyline, instructions } = route;
  const totalPoints = polyline.length;

  const fwd = findForwardClosestPoint(userLat, userLng, userHeading, polyline);

  const isOffRoute = fwd.distance > OFF_ROUTE_THRESHOLD_METERS;

  if (!instructions.length || currentLeg >= instructions.length) {
    return {
      currentLeg: instructions.length,
      routeProgress: totalPoints > 0 ? fwd.index / (totalPoints - 1) : 1,
      distanceToManeuver: 0,
      bearingToManeuver: 0,
      isArrived: true,
      isOffRoute,
      shouldReroute: false,
      isWrongWay: fwd.isWrongWay,
      forwardIndex: fwd.index,
    };
  }

  let newLeg = currentLeg;

  for (let i = currentLeg; i < instructions.length; i++) {
    const instIdx = findInstructionPolylineIndex(instructions[i], polyline);
    if (fwd.index >= instIdx + 3 || (fwd.index >= instIdx && fwd.distance < LEG_ADVANCE_DISTANCE_METERS)) {
      if (i < instructions.length - 1) {
        newLeg = i + 1;
      } else {
        newLeg = i;
      }
    } else {
      break;
    }
  }

  newLeg = Math.min(newLeg, instructions.length - 1);

  const nextInst = instructions[newLeg];
  const distToManeuver = haversineDist(userLat, userLng, nextInst.lat, nextInst.lng);
  const bearToManeuver = bearing(userLat, userLng, nextInst.lat, nextInst.lng);

  const destLat = polyline[totalPoints - 1].lat;
  const destLng = polyline[totalPoints - 1].lng;
  const distToDest = haversineDist(userLat, userLng, destLat, destLng);
  const isArrived = distToDest < ARRIVAL_THRESHOLD_METERS;

  const now = Date.now();
  const shouldReroute = (isOffRoute || fwd.isWrongWay) && !isArrived && (now - lastRerouteTime > REROUTE_COOLDOWN_MS);
  if (shouldReroute) lastRerouteTime = now;

  return {
    currentLeg: newLeg,
    routeProgress: totalPoints > 1 ? fwd.index / (totalPoints - 1) : 1,
    distanceToManeuver: distToManeuver,
    bearingToManeuver: bearToManeuver,
    isArrived,
    isOffRoute,
    shouldReroute,
    isWrongWay: fwd.isWrongWay,
    forwardIndex: fwd.index,
  };
}

export function getRemainingDistance(
  userLat: number,
  userLng: number,
  polyline: Coordinates[],
): number {
  if (!polyline.length) return 0;

  const closest = findClosestPointOnPolyline(userLat, userLng, polyline);
  let totalDist = 0;

  for (let i = closest.index; i < polyline.length - 1; i++) {
    totalDist += haversineDist(
      polyline[i].lat, polyline[i].lng,
      polyline[i + 1].lat, polyline[i + 1].lng,
    );
  }

  return totalDist;
}

// Typical cruising speed by vehicle model, used whenever there's no live
// speed reading to derive an ETA from (route just calculated, backend gave
// no usable duration, etc). Trucks run slower on average than cars.
const AVERAGE_SPEED_KMH: Record<VehicleType, number> = {
  CAR: 60,
  TRUCK: 48,
};

export function estimateDurationFromDistanceKm(
  distanceKm: number,
  vehicleType: VehicleType = 'CAR',
): number {
  const avgSpeedKmh = AVERAGE_SPEED_KMH[vehicleType] || AVERAGE_SPEED_KMH.CAR;
  if (avgSpeedKmh <= 0) return 0;
  return (distanceKm / avgSpeedKmh) * 3600;
}

export function getRemainingDuration(
  userLat: number,
  userLng: number,
  polyline: Coordinates[],
  totalDurationSec: number,
  totalDistanceMeters: number,
  vehicleType: VehicleType = 'CAR',
): number {
  const remainingKm = getRemainingDistance(userLat, userLng, polyline) / 1000;
  const totalKm = totalDistanceMeters / 1000;

  const avgSpeedKmh = totalKm > 0 && totalDurationSec > 0
    ? totalKm / (totalDurationSec / 3600)
    : AVERAGE_SPEED_KMH[vehicleType] || AVERAGE_SPEED_KMH.CAR;

  if (!isFinite(avgSpeedKmh) || avgSpeedKmh <= 0) {
    return estimateDurationFromDistanceKm(remainingKm, vehicleType);
  }

  return (remainingKm / avgSpeedKmh) * 3600;
}

export function speedToAutoZoom(speedKmh: number): number {
  if (speedKmh < 5) return 17;
  if (speedKmh < 15) return 16.5;
  if (speedKmh < 30) return 16;
  if (speedKmh < 50) return 15.5;
  if (speedKmh < 80) return 15;
  if (speedKmh < 120) return 14;
  return 13;
}
