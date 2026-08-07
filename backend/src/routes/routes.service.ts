import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
const RouteType = {
  FASTEST: 'FASTEST',
  SHORTEST: 'SHORTEST',
  SAFEST: 'SAFEST',
  SCENIC: 'SCENIC',
  CHEAPEST: 'CHEAPEST',
  NO_TRAFFIC: 'NO_TRAFFIC',
  NO_TOLLS: 'NO_TOLLS',
  ECONOMICAL: 'ECONOMICAL',
  TOURIST: 'TOURIST',
  FAMILY: 'FAMILY',
  NIGHT: 'NIGHT',
  TRUCK: 'TRUCK',
  CUSTOM: 'CUSTOM',
} as const;
type RouteType = (typeof RouteType)[keyof typeof RouteType];
import { CalculateRouteDto } from './dto/calculate-route.dto';
import { SaveRouteDto } from './dto/calculate-route.dto';

interface RouteSegment {
  lat: number;
  lng: number;
}

export interface RouteResult {
  type: RouteType;
  distance: number;         // km
  duration: number;         // minutes
  polyline: RouteSegment[];
  fuelEstimate: number;     // liters
  fuelCost: number;         // USD
  tollCost: number;
  safetyScore: number;      // 1-100
  ecoScore: number;         // 1-100
  hazardCount: number;
  instructions: TurnInstruction[];
  summary: string;
  // True when the real routing engine (OSRM) call failed and this is a
  // straight-line Haversine approximation instead of an actual routed path
  // — previously indistinguishable from a real route on the wire, so a
  // transient OSRM outage/timeout silently returned a normal-looking route.
  isEstimate?: boolean;
}

interface TurnInstruction {
  type: string;
  text: string;
  distance: number;
  duration: number;
  lat: number;
  lng: number;
  streetName?: string;
}

@Injectable()
export class RoutesService {
  private readonly logger = new Logger(RoutesService.name);

  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
    private config: ConfigService,
  ) {}

  async calculateRoute(dto: CalculateRouteDto, userId?: string): Promise<RouteResult[]> {
    // Must include every parameter that affects computeSingleRoute's output
    // (waypoints, vehicle profile/exclusions, fuel price) — otherwise two
    // requests for the same origin/dest/routeType but different vehicle or
    // toll preferences collide on the same cache entry and one request's
    // result gets served back to the other for up to 5 minutes.
    // Also keyed per-user: computeSingleRoute pulls the caller's own default
    // vehicle for fuelEfficiency, so without userId here one user's fuel
    // numbers would get served back to a different (or anonymous) caller
    // requesting the identical route.
    const waypointsKey = (dto.waypoints || []).map((w) => `${w.lat},${w.lng}`).join(';');
    const cacheKey = `route:${dto.originLat},${dto.originLng}:${dto.destLat},${dto.destLng}:${dto.routeType || 'fastest'}:${waypointsKey}:${dto.vehicleType || ''}:${dto.avoidTolls ? 1 : 0}:${dto.avoidHighways ? 1 : 0}:${dto.fuelPrice ?? ''}:${dto.vehicleHeight ?? ''}:${dto.vehicleWeight ?? ''}:${userId || 'anon'}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    const results = await this.computeRoutes(dto, userId);

    await this.redis.set(cacheKey, JSON.stringify(results), 300); // 5 min cache
    return results;
  }

  private async computeRoutes(dto: CalculateRouteDto, userId?: string): Promise<RouteResult[]> {
    const routeTypes = dto.routeType
      ? [dto.routeType]
      : [RouteType.FASTEST, RouteType.SHORTEST, RouteType.SAFEST];

    const routePromises = routeTypes.map((type) => this.computeSingleRoute(dto, type, userId));
    const results = await Promise.allSettled(routePromises);

    return results
      .filter((r) => r.status === 'fulfilled')
      .map((r) => (r as PromiseFulfilledResult<RouteResult>).value);
  }

  private async computeSingleRoute(
    dto: CalculateRouteDto,
    type: RouteType,
    userId?: string,
  ): Promise<RouteResult> {
    // OSRM routing engine
    const osrmBase = this.config.get('OSRM_URL', 'https://router.project-osrm.org');
    const profile = dto.vehicleType === 'TRUCK' ? 'truck' : 'driving';
    const excludeParts: string[] = [];
    if (dto.vehicleType === 'TRUCK') {
      excludeParts.push('motorway');
    }
    const waypoints = [
      `${dto.originLng},${dto.originLat}`,
      ...(dto.waypoints || []).map((w) => `${w.lng},${w.lat}`),
      `${dto.destLng},${dto.destLat}`,
    ].join(';');

    const params: Record<string, string> = {
      overview: 'full',
      geometries: 'geojson',
      steps: 'true',
      annotations: 'speed,duration,distance',
    };

    if (dto.avoidTolls) excludeParts.push('toll');
    if (excludeParts.length > 0) params.exclude = excludeParts.join(',');

    try {
      const url = `${osrmBase}/route/v1/${profile}/${waypoints}`;
      const response = await axios.get(url, { params, timeout: 10000 });
      const route = response.data.routes[0];

      if (!route) {
        throw new Error('No route found');
      }

      const coordinates: RouteSegment[] = route.geometry.coordinates.map(
        ([lng, lat]: [number, number]) => ({ lat, lng }),
      );

      const distanceKm = route.distance / 1000;
      const durationMin = route.duration / 60;

      const vehicle = userId
        ? await this.prisma.vehicle.findFirst({
            where: { userId, isDefault: true },
          })
        : null;

      const fuelEfficiency = vehicle?.fuelEfficiency || 8; // L/100km default
      const fuelPrice = dto.fuelPrice || 1.5; // USD/L default
      const fuelLiters = (distanceKm / 100) * fuelEfficiency;
      const fuelCost = fuelLiters * fuelPrice;

      const instructions: TurnInstruction[] = route.legs
        .flatMap((leg: any) => leg.steps || [])
        .map((step: any) => ({
          type: step.maneuver?.type || 'turn',
          text: this.formatInstruction(step),
          distance: step.distance,
          duration: step.duration,
          lat: step.maneuver?.location?.[1] || 0,
          lng: step.maneuver?.location?.[0] || 0,
          streetName: step.name,
        }));

      const hazardCount = await this.getHazardsOnRoute(coordinates);
      const safetyScore = Math.max(10, 100 - hazardCount * 5);
      const ecoScore = this.calculateEcoScore(distanceKm, type, fuelLiters);

      return {
        type,
        distance: Math.round(distanceKm * 10) / 10,
        duration: Math.round(durationMin),
        polyline: coordinates,
        fuelEstimate: Math.round(fuelLiters * 10) / 10,
        fuelCost: Math.round(fuelCost * 100) / 100,
        tollCost: 0,
        safetyScore,
        ecoScore,
        hazardCount,
        instructions,
        summary: `${Math.round(distanceKm)} km · ${Math.round(durationMin)} min`,
        isEstimate: false,
      };
    } catch (error) {
      this.logger.error(`Route calculation failed: ${error instanceof Error ? error.message : String(error)}`);
      return this.getFallbackRoute(dto, type);
    }
  }

  private async getHazardsOnRoute(route: RouteSegment[]): Promise<number> {
    if (route.length === 0) return 0;
    const bounds = this.getRouteBounds(route);

    const count = await this.prisma.report.count({
      where: {
        status: { in: ['ACTIVE', 'CONFIRMED'] },
        lat: { gte: bounds.minLat, lte: bounds.maxLat },
        lng: { gte: bounds.minLng, lte: bounds.maxLng },
      },
    });

    return count;
  }

  private getRouteBounds(route: RouteSegment[]) {
    let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
    for (const p of route) {
      if (p.lat < minLat) minLat = p.lat;
      if (p.lat > maxLat) maxLat = p.lat;
      if (p.lng < minLng) minLng = p.lng;
      if (p.lng > maxLng) maxLng = p.lng;
    }
    return { minLat, maxLat, minLng, maxLng };
  }

  private calculateEcoScore(distance: number, type: RouteType, fuel: number): number {
    const baseScore = 100;
    const fuelPenalty = fuel * 2;
    const typeBonuses: Record<RouteType, number> = {
      [RouteType.ECONOMICAL]: 20,
      [RouteType.SCENIC]: 10,
      [RouteType.TOURIST]: 5,
      [RouteType.FAMILY]: 5,
      [RouteType.FASTEST]: -10,
      [RouteType.NO_TRAFFIC]: 0,
      [RouteType.SHORTEST]: 5,
      [RouteType.SAFEST]: 5,
      [RouteType.CHEAPEST]: 0,
      [RouteType.NO_TOLLS]: 0,
      [RouteType.NIGHT]: -5,
      [RouteType.TRUCK]: -15,
      [RouteType.CUSTOM]: 0,
    };
    return Math.max(0, Math.min(100, baseScore - fuelPenalty + (typeBonuses[type] || 0)));
  }

  private formatInstruction(step: any): string {
    const maneuver = step.maneuver?.type;
    const modifier = step.maneuver?.modifier;
    const street = step.name ? ` on ${step.name}` : '';

    const directions: Record<string, string> = {
      turn: modifier ? `Turn ${modifier}${street}` : `Turn${street}`,
      depart: `Head ${modifier || 'forward'}${street}`,
      arrive: `Arrive at destination`,
      merge: `Merge ${modifier || 'onto'}${street}`,
      ramp: `Take ramp ${modifier || ''}${street}`,
      fork: `Keep ${modifier || 'straight'} at fork${street}`,
      roundabout: `Enter roundabout${street}`,
      rotary: `Enter rotary${street}`,
      continue: `Continue${street}`,
      'new name': `Continue${street}`,
    };

    return directions[maneuver] || `Continue${street}`;
  }

  private getFallbackRoute(dto: CalculateRouteDto, type: RouteType): RouteResult {
    const lat1 = dto.originLat;
    const lng1 = dto.originLng;
    const lat2 = dto.destLat;
    const lng2 = dto.destLng;

    // Haversine distance
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lng2 - lng1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c * 1.3; // road factor

    return {
      type,
      distance: Math.round(distance * 10) / 10,
      duration: Math.round((distance / 80) * 60),
      polyline: [
        { lat: lat1, lng: lng1 },
        { lat: lat2, lng: lng2 },
      ],
      fuelEstimate: Math.round((distance / 100) * 8 * 10) / 10,
      fuelCost: Math.round((distance / 100) * 8 * 1.5 * 100) / 100,
      tollCost: 0,
      safetyScore: 80,
      ecoScore: 70,
      hazardCount: 0,
      instructions: [
        { type: 'depart', text: 'Head to destination', distance, duration: (distance / 80) * 3600, lat: lat1, lng: lng1 },
        { type: 'arrive', text: 'Arrive at destination', distance: 0, duration: 0, lat: lat2, lng: lng2 },
      ],
      summary: `${Math.round(distance)} km · ${Math.round((distance / 80) * 60)} min`,
      isEstimate: true,
    };
  }

  async saveRoute(dto: SaveRouteDto, userId: string) {
    return this.prisma.savedRoute.create({
      data: {
        userId,
        name: dto.name,
        originName: dto.originName,
        originLat: dto.originLat,
        originLng: dto.originLng,
        destName: dto.destName,
        destLat: dto.destLat,
        destLng: dto.destLng,
        // `waypoints` is a String? column — writing the WaypointDto[] array
        // straight through (the previous `as any` cast) made the Prisma
        // client reject the insert whenever a route with waypoints was
        // saved, since the DB column isn't a JSON/array type.
        waypoints: dto.waypoints ? JSON.stringify(dto.waypoints) : undefined,
        routeType: dto.routeType || RouteType.FASTEST,
        distance: dto.distance,
        duration: dto.duration,
        polyline: dto.polyline,
      },
    });
  }

  async getSavedRoutes(userId: string) {
    return this.prisma.savedRoute.findMany({
      where: { userId },
      orderBy: [{ isFavorite: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async deleteSavedRoute(id: string, userId: string) {
    const route = await this.prisma.savedRoute.findFirst({ where: { id, userId } });
    if (!route) throw new NotFoundException('Route not found');
    await this.prisma.savedRoute.delete({ where: { id } });
    return { deleted: true };
  }

  async getTrips(userId: string, page = 1, limit = 20) {
    // Same class of gap as the other paginated services — guarded here too
    // in case this is ever called with something other than the
    // ParseIntPipe-validated controller input.
    page = Number.isFinite(page) && page > 0 ? page : 1;
    limit = Number.isFinite(limit) && limit > 0 ? Math.min(limit, 100) : 20;
    const skip = Math.max(0, (page - 1) * limit);
    const [trips, total] = await Promise.all([
      this.prisma.trip.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.trip.count({ where: { userId } }),
    ]);
    return { trips, total, page, limit };
  }

  async startTrip(userId: string, data: Partial<any>) {
    // Unlike createReport, this had no guard at all against a double-submit
    // or network-retry firing trips/start twice in quick succession — each
    // call unconditionally creates a new "active" trip row, and endTrip has
    // no way to know a duplicate exists (it only ever ends the tripId it's
    // given). Two dangling active trips both later ended would double-count
    // totalTrips/totalDistance on the user. Same short-lived per-user Redis
    // lock pattern as reports.service.ts#createReport.
    const lockKey = `trip:start:lock:${userId}`;
    let locked = true;
    try {
      locked = await this.redis.setnx(lockKey, '1', 5);
    } catch (e) {
      this.logger.warn(`Redis unavailable for trip-start lock, proceeding without it: ${(e as Error).message}`);
    }
    if (!locked) {
      throw new BadRequestException('Trip already being started, try again');
    }

    try {
      return await this.prisma.trip.create({
        data: {
          userId,
          originName: data.originName || 'Current location',
          originLat: data.originLat,
          originLng: data.originLng,
          destName: data.destName,
          destLat: data.destLat,
          destLng: data.destLng,
          routeType: data.routeType || RouteType.FASTEST,
          plannedDuration: data.duration,
          distance: data.distance,
          polyline: data.polyline,
          status: 'active',
          startedAt: new Date(),
        },
      });
    } finally {
      await this.redis.del(lockKey);
    }
  }

  async endTrip(tripId: string, userId: string, stats: Partial<any>) {
    const trip = await this.prisma.trip.findFirst({ where: { id: tripId, userId } });
    if (!trip) throw new NotFoundException('Trip not found');
    if (trip.status !== 'active') throw new BadRequestException('Trip is not active');

    // The findFirst status check above is a plain read, not a lock — a
    // double-tap on "end trip" or a network retry can fire two endTrip
    // calls for the same tripId close enough together that both read
    // status: 'active' before either write lands, then both proceed to
    // increment totalTrips/totalDistance on the user. Guarding the actual
    // write with updateMany's WHERE (status still 'active') makes the
    // transition itself atomic: only the request that wins the race
    // flips the row, the loser sees count 0 and is rejected instead of
    // double-applying stats.
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.trip.updateMany({
        where: { id: tripId, userId, status: 'active' },
        data: {
          status: 'completed',
          endedAt: new Date(),
          duration: stats.duration,
          fuelUsed: stats.fuelUsed,
          avgSpeed: stats.avgSpeed,
          maxSpeed: stats.maxSpeed,
        },
      });

      if (updated.count === 0) {
        throw new BadRequestException('Trip is not active');
      }

      const user = await tx.user.update({
        where: { id: userId },
        data: {
          totalTrips: { increment: 1 },
          totalDistance: { increment: stats.distance || trip.distance || 0 },
        },
        select: { totalTrips: true, totalDistance: true, driverScore: true, reputation: true },
      });

      // Returned so the frontend can push updated stats straight into the
      // auth store — without this, the profile page (which reads stats off
      // the store, only refreshed via /auth/me at app init) kept showing
      // pre-trip counters until a full reload.
      return { id: tripId, status: 'completed', user };
    });
  }
}
