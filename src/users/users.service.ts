import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
const VEHICLE_TYPES = {
  CAR: 'CAR',
  TRUCK: 'TRUCK',
} as const;
type VehicleType = (typeof VEHICLE_TYPES)[keyof typeof VEHICLE_TYPES];

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

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
            achievements: true,
          },
        },
      },
    });

    if (!user) throw new NotFoundException('User not found');
    const { passwordHash, refreshToken, ...safe } = user;
    return safe;
  }

  async updateProfile(userId: string, data: any) {
    const updateData: any = {};

    if (data.displayName !== undefined) updateData.displayName = data.displayName;
    if (data.bio !== undefined) updateData.bio = data.bio;
    if (data.avatar !== undefined) updateData.avatar = data.avatar;
    if (data.homeAddress !== undefined) updateData.homeAddress = data.homeAddress;
    if (data.homeLat !== undefined) updateData.homeLat = data.homeLat;
    if (data.homeLng !== undefined) updateData.homeLng = data.homeLng;
    if (data.workAddress !== undefined) updateData.workAddress = data.workAddress;
    if (data.workLat !== undefined) updateData.workLat = data.workLat;
    if (data.workLng !== undefined) updateData.workLng = data.workLng;
    if (data.preferredLang !== undefined) updateData.preferredLang = data.preferredLang;
    if (data.preferredVehicle !== undefined) updateData.preferredVehicle = data.preferredVehicle;

    if (data.username !== undefined) {
      const existing = await this.prisma.user.findUnique({ where: { username: data.username } });
      if (existing && existing.id !== userId) {
        throw new ConflictException('Username already taken');
      }
      updateData.username = data.username;
    }

    const updated = await this.prisma.user.update({
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
      },
    });
    return updated;
  }

  async updatePreferences(userId: string, prefs: any) {
    return this.prisma.userPreference.upsert({
      where: { userId },
      create: { userId, ...prefs },
      update: prefs,
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
    if (data.isDefault) {
      await this.prisma.vehicle.updateMany({
        where: { userId },
        data: { isDefault: false },
      });
    }

    return this.prisma.vehicle.create({
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
  }

  async getVehicles(userId: string) {
    return this.prisma.vehicle.findMany({ where: { userId } });
  }

  async deleteVehicle(id: string, userId: string) {
    await this.prisma.vehicle.deleteMany({ where: { id, userId } });
    return { deleted: true };
  }

  async getLeaderboard(limit = 20) {
    return this.prisma.user.findMany({
      where: { isActive: true, isBanned: false },
      orderBy: { reputation: 'desc' },
      take: limit,
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
  }

  async getAchievements(userId: string) {
    return this.prisma.userAchievement.findMany({
      where: { userId },
      include: { achievement: true },
      orderBy: { earnedAt: 'desc' },
    });
  }

  // --- Fuel Logs ---

  async addFuelLog(userId: string, data: any) {
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
