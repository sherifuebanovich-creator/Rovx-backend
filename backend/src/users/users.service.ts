import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
const VEHICLE_TYPES = {
  CAR: 'CAR',
  TRUCK: 'TRUCK',
} as const;
type VehicleType = (typeof VEHICLE_TYPES)[keyof typeof VEHICLE_TYPES];

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService, private redis: RedisService) {}

  // Used only to check for an existing avatar to delete before overwriting
  // it — deliberately not getProfile(), which joins preferences/vehicles/
  // counts that have nothing to do with the avatar and can turn an
  // unrelated schema/data issue on those into an avatar-upload failure.
  async getAvatarOnly(userId: string): Promise<string | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { avatar: true },
    });
    return user?.avatar ?? null;
  }

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        preferences: true,
        vehicles: { where: { isDefault: true } },
        _count: {
          select: {
            followers: true,
            following: true,
            trips: true,
            reports: true,
          },
        },
      },
    });

    if (!user) throw new NotFoundException('User not found');
    const { passwordHash, refreshToken, ...safe } = user;
    // Lets the frontend tell Google-only accounts (no password set at all)
    // apart from password-based ones without ever exposing the hash itself
    // — needed so Settings can show accurate "change password" behavior
    // instead of always offering a reset flow that silently no-ops for
    // Google-only accounts.
    return { ...safe, hasPassword: !!passwordHash };
  }

  private static readonly MAX_TEXT_LENGTHS: Record<string, number> = {
    displayName: 60,
    bio: 500,
    phone: 30,
    city: 100,
    homeAddress: 200,
    workAddress: 200,
  };

  private static readonly COORD_FIELDS = ['homeLat', 'homeLng', 'workLat', 'workLng'] as const;

  async updateProfile(userId: string, data: any) {
    const updateData: any = {};

    // `avatar` is deliberately NOT accepted here — it must go through
    // POST /users/me/avatar, which validates mimetype/size via multer. This
    // endpoint has no such checks, so accepting it here let anyone set an
    // arbitrary URL or oversized data: URI as their avatar, which then gets
    // rendered verbatim to every viewer of the leaderboard/public profile.
    for (const [field, maxLen] of Object.entries(UsersService.MAX_TEXT_LENGTHS)) {
      if (data[field] === undefined) continue;
      if (typeof data[field] !== 'string' || data[field].length > maxLen) {
        throw new BadRequestException(`${field} must be a string up to ${maxLen} characters`);
      }
      updateData[field] = data[field];
    }
    for (const field of UsersService.COORD_FIELDS) {
      if (data[field] === undefined) continue;
      if (typeof data[field] !== 'number' || !Number.isFinite(data[field])) {
        throw new BadRequestException(`${field} must be a finite number`);
      }
      updateData[field] = data[field];
    }
    if (data.preferredLang !== undefined) updateData.preferredLang = data.preferredLang;
    if (data.preferredVehicle !== undefined) updateData.preferredVehicle = data.preferredVehicle;

    if (data.username !== undefined) {
      if (
        typeof data.username !== 'string' ||
        data.username.length < 3 ||
        data.username.length > 30 ||
        !/^[a-zA-Z0-9_]+$/.test(data.username)
      ) {
        throw new BadRequestException('Username must be 3-30 characters (letters, numbers, underscores only)');
      }
      const existing = await this.prisma.user.findUnique({ where: { username: data.username } });
      if (existing && existing.id !== userId) {
        throw new ConflictException('Username already taken');
      }
      updateData.username = data.username;
    }

    // The findUnique-then-update above is check-then-write, not atomic — two
    // concurrent profile updates racing to take the same new username can
    // both pass the check, so the loser hits the DB's unique constraint.
    // Without this, that surfaced as an unhandled Prisma error and a generic
    // 500 (per http-exception.filter.ts) instead of a clean 409.
    try {
      return await this.prisma.user.update({
        where: { id: userId },
        data: updateData,
        select: {
          id: true,
          email: true,
          username: true,
          displayName: true,
          avatar: true,
          bio: true,
          role: true,
          subscription: true,
          preferredLang: true,
          preferredVehicle: true,
          phone: true,
          city: true,
          homeAddress: true,
          homeLat: true,
          homeLng: true,
          workAddress: true,
          workLat: true,
          workLng: true,
        },
      });
    } catch (err: any) {
      if (err?.code === 'P2002') {
        throw new ConflictException('Username already taken');
      }
      throw err;
    }
  }

  private static readonly PROFILE_SELECT = {
    id: true,
    email: true,
    username: true,
    displayName: true,
    avatar: true,
    bio: true,
    role: true,
    subscription: true,
    preferredLang: true,
    preferredVehicle: true,
    phone: true,
    city: true,
    homeAddress: true,
    homeLat: true,
    homeLng: true,
    workAddress: true,
    workLat: true,
    workLng: true,
  } as const;

  // Only called from POST /users/me/avatar, after multer's mimetype/size
  // checks have already run — unlike updateProfile(), which must never
  // accept an unvalidated `avatar` value from arbitrary request bodies.
  async setAvatar(userId: string, avatarDataUri: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { avatar: avatarDataUri },
      select: UsersService.PROFILE_SELECT,
    });
  }

  // Was `create: { userId, ...prefs }, update: prefs` with `prefs: any` —
  // no DTO/metatype means the global ValidationPipe's whitelist/forbid
  // options never applied here (unlike updateProfile above), so any caller
  // could pass e.g. `{ userId: <victim-id> }` and hit the unique
  // constraint with an uncaught P2002. Whitelisting to the actual
  // UserPreference columns closes that off.
  private static readonly PREFERENCE_FIELDS = [
    'avoidTolls', 'avoidHighways', 'avoidFerries', 'preferScenicRoutes',
    'nightMode', 'voiceEnabled', 'voiceGender', 'voiceLanguage', 'voiceVolume',
    'speedAlerts', 'cameraAlerts', 'trafficAlerts', 'hazardAlerts',
    'restStopInterval', 'fuelWarningLevel', 'units', 'mapStyle', 'defaultRouteType',
    'limitTrafficSignalsRadius', 'shareLocationWithFriends',
  ] as const;

  async updatePreferences(userId: string, prefs: any) {
    const data: Record<string, any> = {};
    if (prefs && typeof prefs === 'object') {
      for (const key of UsersService.PREFERENCE_FIELDS) {
        if (prefs[key] !== undefined) data[key] = prefs[key];
      }
    }
    return this.prisma.userPreference.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });
  }

  async getPublicProfile(username: string, viewerId?: string) {
    const user = await this.prisma.user.findUnique({
      where: { username },
      select: {
        id: true,
        username: true,
        displayName: true,
        avatar: true,
        bio: true,
        driverScore: true,
        reputation: true,
        totalTrips: true,
        totalDistance: true,
        createdAt: true,
        _count: {
          select: { followers: true, following: true, reports: true },
        },
      },
    });

    if (!user) throw new NotFoundException('User not found');

    let isFollowing = false;
    if (viewerId) {
      const follow = await this.prisma.follow.findFirst({
        where: { followerId: viewerId, followingId: user.id },
      });
      isFollowing = !!follow;
    }

    return { ...user, isFollowing };
  }

  async addVehicle(userId: string, data: any) {
    if (!data.name || typeof data.name !== 'string') {
      throw new BadRequestException('name is required');
    }
    // Float/Int columns in Prisma — a wrong-typed value (e.g. "abc") throws
    // an unhandled validation error at create() instead of a clean 400.
    for (const field of ['year', 'weight', 'height', 'length', 'axleCount', 'fuelEfficiency', 'tankCapacity'] as const) {
      if (data[field] !== undefined && (typeof data[field] !== 'number' || !isFinite(data[field]))) {
        throw new BadRequestException(`${field} must be a number`);
      }
    }

    const createVehicle = this.prisma.vehicle.create({
      data: {
        userId,
        type: data.type || VEHICLE_TYPES.CAR,
        name: data.name,
        make: data.make,
        model: data.model,
        year: data.year,
        licensePlate: data.licensePlate,
        color: data.color,
        weight: data.weight,
        height: data.height,
        length: data.length,
        axleCount: data.axleCount,
        fuelType: data.fuelType || 'gasoline',
        fuelEfficiency: data.fuelEfficiency,
        tankCapacity: data.tankCapacity,
        isDefault: data.isDefault ?? false,
      },
    });

    // Clearing the old default and creating the new vehicle must succeed or
    // fail together — otherwise a create failure after the clear leaves the
    // user with no default vehicle at all.
    if (data.isDefault) {
      const [, vehicle] = await this.prisma.$transaction([
        this.prisma.vehicle.updateMany({ where: { userId }, data: { isDefault: false } }),
        createVehicle,
      ]);
      return vehicle;
    }

    return createVehicle;
  }

  async getVehicles(userId: string) {
    return this.prisma.vehicle.findMany({ where: { userId } });
  }

  async deleteVehicle(id: string, userId: string) {
    try {
      await this.prisma.vehicle.deleteMany({ where: { id, userId } });
    } catch (err: any) {
      // Trip.vehicleId/FuelLog.vehicleId have no onDelete: Cascade or SetNull
      // — deleting a vehicle that's referenced by past trips/fuel logs throws
      // a raw FK violation (P2003) that would otherwise surface to the user
      // as a bare "Internal server error" with no indication why.
      if (err?.code === 'P2003') {
        throw new BadRequestException('Нельзя удалить: автомобиль используется в поездках или записях топлива');
      }
      throw err;
    }
    return { deleted: true };
  }

  async getLeaderboard(limit = 20) {
    // A non-numeric `limit` query param becomes NaN in the controller's
    // `+limit`, and Math.max/Math.min propagate NaN straight through instead
    // of clamping it, so it used to reach Prisma's `take` as NaN.
    const safeLimit = Number.isFinite(limit) ? limit : 20;
    const cappedLimit = Math.min(Math.max(1, safeLimit), 100);

    // Same top-N rows get re-queried by every client opening the leaderboard
    // screen, and reputation only moves in small increments (report
    // confirmations etc) — a short cache turns a per-request sorted scan
    // over the whole user table into an occasional one without any
    // user-facing staleness that matters for a leaderboard.
    const cacheKey = `leaderboard:${cappedLimit}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      try { return JSON.parse(cached); } catch {}
    }

    const result = await this.prisma.user.findMany({
      where: { isActive: true, isBanned: false },
      orderBy: { reputation: 'desc' },
      take: cappedLimit,
      select: {
        id: true,
        username: true,
        displayName: true,
        avatar: true,
        reputation: true,
        driverScore: true,
        totalTrips: true,
        totalDistance: true,
      },
    });

    await this.redis.set(cacheKey, JSON.stringify(result), 60);
    return result;
  }

  // --- Fuel Logs ---

  async addFuelLog(userId: string, data: any) {
    if (typeof data.liters !== 'number' || !isFinite(data.liters)) {
      throw new BadRequestException('liters is required and must be a number');
    }
    // These are Float columns in Prisma — an out-of-type value (e.g. a
    // string) throws an unhandled validation error at the create() call
    // below instead of a clean 400. odometer/lat/lng/totalCost are also
    // validated even though the DB doesn't reject a bad pricePerLiter via
    // the totalCost fallback math (NaN there silently resolves to 0 instead
    // of surfacing the bad input).
    for (const field of ['odometer', 'pricePerLiter', 'totalCost', 'lat', 'lng'] as const) {
      if (data[field] !== undefined && (typeof data[field] !== 'number' || !isFinite(data[field]))) {
        throw new BadRequestException(`${field} must be a number`);
      }
    }
    if (data.vehicleId) {
      const vehicle = await this.prisma.vehicle.findFirst({
        where: { id: data.vehicleId, userId },
        select: { id: true },
      });
      if (!vehicle) throw new NotFoundException('Vehicle not found');
    }
    return this.prisma.fuelLog.create({
      data: {
        userId,
        vehicleId: data.vehicleId,
        odometer: data.odometer,
        liters: data.liters,
        pricePerLiter: data.pricePerLiter,
        totalCost: data.totalCost || (data.liters * (data.pricePerLiter || 0)) || 0,
        gasStation: data.gasStation,
        lat: data.lat,
        lng: data.lng,
        date: data.date ? new Date(data.date) : new Date(),
        notes: data.notes,
      },
    });
  }

  async getFuelLogs(userId: string, vehicleId?: string) {
    return this.prisma.fuelLog.findMany({
      where: { userId, vehicleId },
      orderBy: { date: 'desc' },
      include: { vehicle: true },
    });
  }

  // --- Emergency Contacts ---

  async addEmergencyContact(userId: string, data: any) {
    if (!data.name || typeof data.name !== 'string') {
      throw new BadRequestException('name is required');
    }
    if (!data.phone || typeof data.phone !== 'string') {
      throw new BadRequestException('phone is required');
    }
    return this.prisma.emergencyContact.create({
      data: {
        userId,
        name: data.name,
        phone: data.phone,
        relation: data.relation,
      },
    });
  }

  async getEmergencyContacts(userId: string) {
    return this.prisma.emergencyContact.findMany({
      where: { userId },
    });
  }

  async deleteEmergencyContact(id: string, userId: string) {
    await this.prisma.emergencyContact.deleteMany({ where: { id, userId } });
    return { deleted: true };
  }
}
