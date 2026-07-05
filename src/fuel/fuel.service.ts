import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

const FUEL_PRICES: Record<string, number> = {
  gasoline: 55.5,
  diesel: 62.3,
  gas: 28.0,
  electric: 12.5,
};

interface FuelCalcDto {
  originName: string;
  originLat: number;
  originLng: number;
  destName: string;
  destLat: number;
  destLng: number;
  vehicleFuelEfficiency?: number;
  fuelType?: string;
  fuelPrice?: number;
}

@Injectable()
export class FuelService {
  private readonly logger = new Logger(FuelService.name);

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {}

  async calculate(dto: FuelCalcDto) {
    const efficiency = dto.vehicleFuelEfficiency || 10;
    const fuelType = dto.fuelType || 'gasoline';
    const pricePerLiter = dto.fuelPrice || FUEL_PRICES[fuelType] || 55.5;

    // Get route from OSRM
    const osrmUrl = this.config.get('OSRM_URL', 'https://router.project-osrm.org');
    let distanceKm = 0;
    let durationMin = 0;

    try {
      const response = await axios.get(
        `${osrmUrl}/route/v1/driving/${dto.originLng},${dto.originLat};${dto.destLng},${dto.destLat}`,
        { params: { overview: 'false', alternatives: 'false' }, timeout: 10000 },
      );
      if (response.data?.code === 'Ok' && response.data?.routes?.length > 0) {
        const route = response.data.routes[0];
        distanceKm = route.distance / 1000;
        durationMin = Math.round(route.duration / 60);
      }
    } catch (error) {
      this.logger.warn('OSRM routing failed, using Haversine approximation');
      distanceKm = this.haversineDistance(dto.originLat, dto.originLng, dto.destLat, dto.destLng);
      durationMin = Math.round((distanceKm / 60) * 60);
    }

    const fuelConsumed = distanceKm / 100 * efficiency;
    const fuelCost = fuelConsumed * pricePerLiter;

    return {
      distanceKm: Math.round(distanceKm * 100) / 100,
      durationMin,
      fuelConsumed: Math.round(fuelConsumed * 100) / 100,
      fuelCost: Math.round(fuelCost * 100) / 100,
      fuelPricePerLiter: pricePerLiter,
      efficiencyUsed: efficiency,
      fuelType,
      originName: dto.originName,
      destName: dto.destName,
    };
  }

  async calculateAndSave(userId: string, dto: FuelCalcDto) {
    const result = await this.calculate(dto);

    await this.prisma.fuelCalculation.create({
      data: {
        userId,
        originName: dto.originName,
        originLat: dto.originLat,
        originLng: dto.originLng,
        destName: dto.destName,
        destLat: dto.destLat,
        destLng: dto.destLng,
        distanceKm: result.distanceKm,
        durationMin: result.durationMin,
        fuelConsumed: result.fuelConsumed,
        fuelCost: result.fuelCost,
        fuelPricePerLiter: result.fuelPricePerLiter,
        vehicleFuelEfficiency: result.efficiencyUsed,
      },
    });

    return result;
  }

  async getHistory(userId: string) {
    return this.prisma.fuelCalculation.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async getFuelPrices() {
    return FUEL_PRICES;
  }

  private haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371;
    const dLat = this.toRad(lat2 - lat1);
    const dLon = this.toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRad(lat1)) * Math.cos(this.toRad(lat2)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  private toRad(deg: number): number {
    return deg * (Math.PI / 180);
  }
}
