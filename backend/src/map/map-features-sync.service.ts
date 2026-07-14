import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import axios from 'axios';

const OVERPASS_URLS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

const CIS_COUNTRIES: { code: string; name: string }[] = [
  { code: 'UZ', name: 'Uzbekistan' },
  { code: 'KZ', name: 'Kazakhstan' },
  { code: 'KG', name: 'Kyrgyzstan' },
  { code: 'TJ', name: 'Tajikistan' },
  { code: 'TM', name: 'Turkmenistan' },
  { code: 'AZ', name: 'Azerbaijan' },
  { code: 'AM', name: 'Armenia' },
  { code: 'GE', name: 'Georgia' },
  { code: 'BY', name: 'Belarus' },
  { code: 'MD', name: 'Moldova' },
  { code: 'UA', name: 'Ukraine' },
  { code: 'RU', name: 'Russia' },
];

interface OverpassElement {
  type: string;
  id: number;
  lat: number;
  lon: number;
  tags?: Record<string, string>;
}

@Injectable()
export class MapFeaturesSyncService {
  private readonly logger = new Logger(MapFeaturesSyncService.name);
  private isSyncing = false;

  constructor(private prisma: PrismaService) {}

  @Cron('0 3 * * 0', { timeZone: 'Asia/Tashkent' })
  async handleWeeklySync() {
    await this.syncAll();
  }

  async syncAll(): Promise<{ total: number; countries: Record<string, number> }> {
    if (this.isSyncing) {
      this.logger.warn('Sync already in progress, skipping');
      return { total: 0, countries: {} };
    }

    this.isSyncing = true;
    const results: Record<string, number> = {};
    let total = 0;

    try {
      for (const country of CIS_COUNTRIES) {
        try {
          const count = await this.syncCountry(country.code);
          results[country.name] = count;
          total += count;
          this.logger.log(`Synced ${country.name} (${country.code}): ${count} features`);

          await new Promise(r => setTimeout(r, 5000));
        } catch (err) {
          this.logger.error(`Failed to sync ${country.name}: ${(err as Error).message}`);
          results[country.name] = 0;
        }
      }
    } finally {
      this.isSyncing = false;
    }

    this.logger.log(`Total sync complete: ${total} features across ${Object.keys(results).length} countries`);
    return { total, countries: results };
  }

  async syncCountry(countryCode: string): Promise<number> {
    const query = `
[out:json][timeout:180];
area["ISO3166-1"="${countryCode}"][admin_level=2]->.searchArea;
(
  node["highway"="speed_camera"](area.searchArea);
  node["highway"="traffic_signals"](area.searchArea);
);
out body;
    `.trim();

    const response = await this.postWithRetry(query);

    const data = response.data;
    const elements: OverpassElement[] = data.elements || [];

    let count = 0;

    for (const el of elements) {
      if (!el.lat || !el.lon) continue;

      const osmType = el.tags?.highway;
      const osmId = `osm_${el.id}`;

      try {
        if (osmType === 'speed_camera') {
          await this.upsertSpeedCamera(el, countryCode, osmId);
          count++;
        } else {
          await this.upsertMapFeature(el, countryCode, osmId);
          count++;
        }
      } catch (err) {
        this.logger.warn(`Failed to upsert ${osmId}: ${(err as Error).message}`);
      }
    }

    return count;
  }

  private async upsertSpeedCamera(el: OverpassElement, countryCode: string, osmId: string) {
    const tags = el.tags || {};
    const type = this.detectCameraType(tags);
    const speedLimit = tags.maxspeed ? parseInt(tags.maxspeed, 10) : undefined;
    const direction = tags.direction ? parseFloat(tags.direction) : undefined;

    await this.prisma.speedCamera.upsert({
      where: { osmId },
      create: {
        type,
        lat: el.lat,
        lng: el.lon,
        direction: isFinite(direction!) ? direction : null,
        speedLimit: isFinite(speedLimit!) ? speedLimit : null,
        roadName: tags.name || tags.operator || null,
        isActive: true,
        source: 'OVERPASS',
        osmId,
      },
      update: {
        type,
        lat: el.lat,
        lng: el.lon,
        direction: isFinite(direction!) ? direction : null,
        speedLimit: isFinite(speedLimit!) ? speedLimit : null,
        roadName: tags.name || tags.operator || null,
        isActive: true,
      },
    });
  }

  private async upsertMapFeature(el: OverpassElement, countryCode: string, osmId: string) {
    await this.prisma.mapFeature.upsert({
      where: { osmId },
      create: {
        type: 'traffic_signals',
        lat: el.lat,
        lng: el.lon,
        countryCode,
        osmId,
        tags: el.tags ? JSON.stringify(el.tags) : null,
        source: 'osm',
      },
      update: {
        lat: el.lat,
        lng: el.lon,
        tags: el.tags ? JSON.stringify(el.tags) : null,
      },
    });
  }

  private async postWithRetry(query: string, retries = 2): Promise<any> {
    for (let i = 0; i <= retries; i++) {
      for (const url of OVERPASS_URLS) {
        try {
          const res = await axios.post(
            url,
            `data=${encodeURIComponent(query)}`,
            {
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              timeout: 180000,
            },
          );
          return res;
        } catch (err) {
          this.logger.warn(`Overpass ${url} failed (attempt ${i + 1}): ${(err as Error).message}`);
        }
      }
      if (i < retries) {
        const delay = (i + 1) * 5000;
        this.logger.log(`Retrying Overpass in ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
    throw new Error('All Overpass endpoints failed after retries');
  }

  private detectCameraType(tags: Record<string, string>): string {
    if (tags.man_mobile === 'yes' || tags.mobile === 'yes') return 'MOBILE';
    if (tags['camera:type'] === 'tripos' || tags.tripod === 'yes') return 'TRIPOD';
    if (tags['camera:type'] === 'red_light' || tags['red_light_camera'] === 'yes') return 'RED_LIGHT';
    if (tags['camera:type'] === 'average_speed' || tags.average_speed === 'yes') return 'AVERAGE_SPEED';
    if (tags.enforcement === 'bus_lane') return 'BUS_LANE';
    if (tags.enforcement === 'dedicated_lane') return 'DEDICATED_LANE';
    if (tags['camera:type'] === 'photographic' || tags['camera:type'] === 'radar') return 'PHOTORADAR';
    if (tags.hidden === 'yes' || tags['camera:type'] === 'ambush') return 'AMBUSH';
    if (tags.enforcement === 'seatbelt' || tags['camera:type'] === 'seatbelt') return 'SEATBELT';
    return 'STATIONARY';
  }

  async importElements(elements: OverpassElement[], countryCode: string): Promise<number> {
    const cameras: any[] = [];
    const signals: any[] = [];

    for (const el of elements) {
      if (!el.lat || !el.lon) continue;
      const osmType = el.tags?.highway;
      const osmId = `osm_${el.id}`;
      const tags = el.tags || {};

      if (osmType === 'speed_camera') {
        const type = this.detectCameraType(tags);
        const speedLimit = tags.maxspeed ? parseInt(tags.maxspeed, 10) : null;
        const direction = tags.direction ? parseFloat(tags.direction) : null;
        cameras.push({
          type,
          lat: el.lat,
          lng: el.lon,
          direction: isFinite(direction!) ? direction : null,
          speedLimit: isFinite(speedLimit!) ? speedLimit : null,
          roadName: tags.name || tags.operator || null,
          isActive: true,
          source: 'OVERPASS',
          osmId,
        });
      } else {
        signals.push({
          type: 'traffic_signals',
          lat: el.lat,
          lng: el.lon,
          countryCode,
          osmId,
          tags: tags && Object.keys(tags).length ? JSON.stringify(tags) : null,
          source: 'osm',
        });
      }
    }

    let count = 0;

    // Bulk insert cameras in batches of 500
    for (let i = 0; i < cameras.length; i += 500) {
      const chunk = cameras.slice(i, i + 500);
      try {
        const res = await this.prisma.speedCamera.createMany({ data: chunk, skipDuplicates: true });
        count += res.count;
      } catch (err) {
        this.logger.warn(`Bulk camera insert failed: ${(err as Error).message}`);
      }
    }

    // Bulk insert signals in batches of 500
    for (let i = 0; i < signals.length; i += 500) {
      const chunk = signals.slice(i, i + 500);
      try {
        const res = await this.prisma.mapFeature.createMany({ data: chunk, skipDuplicates: true });
        count += res.count;
      } catch (err) {
        this.logger.warn(`Bulk signal insert failed: ${(err as Error).message}`);
      }
    }

    return count;
  }

  async getFeaturesByBbox(
    minLat: number,
    minLng: number,
    maxLat: number,
    maxLng: number,
    types?: string[],
  ) {
    const typeFilter = types?.length ? types : ['traffic_signals'];
    const wantSpeedCameras = typeFilter.includes('speed_camera');
    const wantSignals = typeFilter.includes('traffic_signals');

    const bboxWhere = {
      lat: { gte: minLat, lte: maxLat },
      lng: { gte: minLng, lte: maxLng },
    };

    const results: any[] = [];

    if (wantSignals) {
      const signals = await this.prisma.mapFeature.findMany({
        where: { ...bboxWhere, type: 'traffic_signals' },
        select: { id: true, type: true, lat: true, lng: true, countryCode: true, tags: true, updatedAt: true },
      });
      results.push(...signals);
    }

    if (wantSpeedCameras) {
      const cameras = await this.prisma.speedCamera.findMany({
        where: { ...bboxWhere, isActive: true },
        select: { id: true, lat: true, lng: true, type: true, speedLimit: true, roadName: true, direction: true, source: true },
      });
      results.push(...cameras.map(c => ({
        id: c.id,
        type: 'speed_camera',
        lat: c.lat,
        lng: c.lng,
        countryCode: '',
        tags: JSON.stringify({ cameraType: c.type, maxSpeed: c.speedLimit, road: c.roadName, direction: c.direction, source: c.source }),
        updatedAt: new Date(),
      })));
    }

    return results;
  }

  async getStats() {
    const [total, byType, byCountry] = await Promise.all([
      this.prisma.mapFeature.count(),
      this.prisma.mapFeature.groupBy({ by: ['type'], _count: true }),
      this.prisma.mapFeature.groupBy({ by: ['countryCode'], _count: true }),
    ]);

    return {
      total,
      byType: Object.fromEntries(byType.map(r => [r.type, r._count])),
      byCountry: Object.fromEntries(byCountry.map(r => [r.countryCode, r._count])),
    };
  }
}
