import { Coordinates, TurnInstruction, RouteResult } from '@/types';
import { haversineDist, bearing } from './geo';

export interface NavigationUpdate {
  currentLeg: number;
  routeProgress: number;
  distanceToManeuver: number;
  bearingToManeuver: number;
  isArrived: boolean;
  isOffRoute: boolean;
  shouldReroute: boolean;
}

const ARRIVAL_THRESHOLD_METERS = 50;
const OFF_ROUTE_THRESHOLD_METERS = 80;
const LEG_ADVANCE_DISTANCE_METERS = 25;

let lastRerouteTime = 0;
const REROUTE_COOLDOWN_MS = 15000;

export function resetRerouteCooldown() {
  lastRerouteTime = 0;
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

export function computeNavigationUpdate(
  userLat: number,
  userLng: number,
  userHeading: number,
  route: RouteResult,
  currentLeg: number,
): NavigationUpdate {
  const { polyline, instructions } = route;
  const totalPoints = polyline.length;

  const closest = findClosestPointOnPolyline(userLat, userLng, polyline);

  const isOffRoute = closest.distance > OFF_ROUTE_THRESHOLD_METERS;

  if (!instructions.length || currentLeg >= instructions.length) {
    return {
      currentLeg: instructions.length,
      routeProgress: totalPoints > 0 ? closest.index / (totalPoints - 1) : 1,
      distanceToManeuver: 0,
      bearingToManeuver: 0,
      isArrived: true,
      isOffRoute,
      shouldReroute: false,
    };
  }

  let newLeg = currentLeg;

  for (let i = currentLeg; i < instructions.length; i++) {
    const instIdx = findInstructionPolylineIndex(instructions[i], polyline);
    if (closest.index >= instIdx + 3 || (closest.index >= instIdx && closest.distance < LEG_ADVANCE_DISTANCE_METERS)) {
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
  const shouldReroute = isOffRoute && !isArrived && (now - lastRerouteTime > REROUTE_COOLDOWN_MS);
  if (shouldReroute) lastRerouteTime = now;

  return {
    currentLeg: newLeg,
    routeProgress: totalPoints > 1 ? closest.index / (totalPoints - 1) : 1,
    distanceToManeuver: distToManeuver,
    bearingToManeuver: bearToManeuver,
    isArrived,
    isOffRoute,
    shouldReroute,
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

export function getRemainingDuration(
  userLat: number,
  userLng: number,
  polyline: Coordinates[],
  totalDurationSec: number,
  totalDistanceMeters: number,
): number {
  const remaining = getRemainingDistance(userLat, userLng, polyline);
  if (totalDistanceMeters <= 0) return 0;
  return (remaining / totalDistanceMeters) * totalDurationSec;
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
