import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

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
          this.logger.error(`Failed to sync ${country.name}: ${err.message}`);
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

    const response = await fetch(OVERPASS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(query)}`,
    });

    if (!response.ok) {
      throw new Error(`Overpass API returned ${response.status}: ${await response.text()}`);
    }

    const data = await response.json();
    const elements: OverpassElement[] = data.elements || [];

    let count = 0;

    for (const el of elements) {
      if (!el.lat || !el.lon) continue;

      const osmType = el.tags?.highway;
      const type = osmType === 'speed_camera' ? 'speed_camera' : 'traffic_signals';
      const osmId = `osm_${el.id}`;

      try {
        await this.prisma.mapFeature.upsert({
          where: { osmId },
          create: {
            type,
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
        count++;
      } catch (err) {
        this.logger.warn(`Failed to upsert ${osmId}: ${err.message}`);
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
    const typeFilter = types?.length ? types : ['speed_camera', 'traffic_signals'];

    return this.prisma.mapFeature.findMany({
      where: {
        lat: { gte: minLat, lte: maxLat },
        lng: { gte: minLng, lte: maxLng },
        type: { in: typeFilter },
      },
      select: {
        id: true,
        type: true,
        lat: true,
        lng: true,
        countryCode: true,
        tags: true,
        updatedAt: true,
      },
    });
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
