import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { RedisService } from '../redis/redis.service';

interface GovernmentSpeedCamera {
  id: string;
  lat: number;
  lng: number;
  name: string;
  cameraType: string;
  maxSpeed?: number;
  direction?: string;
  source: string;
}

interface GovernmentTrafficSignal {
  id: string;
  lat: number;
  lng: number;
  name: string;
  crossing?: string;
  source: string;
}

@Injectable()
export class GovernmentDataService {
  private readonly logger = new Logger(GovernmentDataService.name);
  private readonly apiUrl: string;
  private readonly apiKey: string;
  private readonly sources: string[];

  constructor(
    private configService: ConfigService,
    private redis: RedisService,
  ) {
    this.apiUrl = this.configService.get('GOVERNMENT_API_URL', '');
    this.apiKey = this.configService.get('GOVERNMENT_API_KEY', '');
    const sourcesRaw = this.configService.get('GOVERNMENT_DATA_SOURCES', '');
    this.sources = sourcesRaw ? sourcesRaw.split(',').map((s) => s.trim()).filter(Boolean) : [];
  }

  async fetchGovernmentSpeedCameras(lat: number, lng: number, radiusKm = 10): Promise<GovernmentSpeedCamera[]> {
    const cacheKey = `gov:cameras:${lat.toFixed(3)}:${lng.toFixed(3)}:${radiusKm}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const results: GovernmentSpeedCamera[] = [];

    for (const source of this.sources) {
      try {
        const data = await this.fetchFromSource(source, 'speed-cameras', lat, lng, radiusKm);
        results.push(...this.normalizeSpeedCameras(data, source));
      } catch (err) {
        this.logger.warn(`Government data source "${source}" failed: ${(err as Error).message}`);
      }
    }

    if (this.apiUrl && !this.sources.length) {
      try {
        const data = await this.fetchFromSource(this.apiUrl, 'speed-cameras', lat, lng, radiusKm);
        results.push(...this.normalizeSpeedCameras(data, 'default'));
      } catch (err) {
        this.logger.warn(`Government API failed: ${(err as Error).message}`);
      }
    }

    await this.redis.set(cacheKey, JSON.stringify(results), 600);
    return results;
  }

  async fetchGovernmentTrafficSignals(lat: number, lng: number, radiusKm = 2): Promise<GovernmentTrafficSignal[]> {
    const cacheKey = `gov:signals:${lat.toFixed(3)}:${lng.toFixed(3)}:${radiusKm}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const results: GovernmentTrafficSignal[] = [];

    for (const source of this.sources) {
      try {
        const data = await this.fetchFromSource(source, 'traffic-signals', lat, lng, radiusKm);
        results.push(...this.normalizeTrafficSignals(data, source));
      } catch (err) {
        this.logger.warn(`Government data source "${source}" failed: ${(err as Error).message}`);
      }
    }

    if (this.apiUrl && !this.sources.length) {
      try {
        const data = await this.fetchFromSource(this.apiUrl, 'traffic-signals', lat, lng, radiusKm);
        results.push(...this.normalizeTrafficSignals(data, 'default'));
      } catch (err) {
        this.logger.warn(`Government API failed: ${(err as Error).message}`);
      }
    }

    await this.redis.set(cacheKey, JSON.stringify(results), 600);
    return results;
  }

  private async fetchFromSource(
    sourceUrl: string,
    endpoint: string,
    lat: number,
    lng: number,
    radiusKm: number,
  ): Promise<any> {
    const baseUrl = sourceUrl.replace(/\/+$/, '');
    const url = `${baseUrl}/${endpoint}`;

    const res = await axios.get(url, {
      params: { lat, lng, radius: radiusKm },
      headers: this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {},
      timeout: 10000,
    });

    return res.data;
  }

  private normalizeSpeedCameras(data: any, source: string): GovernmentSpeedCamera[] {
    if (!data) return [];
    const items = Array.isArray(data) ? data : data.features || data.data || data.results || [];
    return items.map((item: any, idx: number) => {
      const props = item.properties || item;
      const coords = this.extractCoordinates(item);
      return {
        id: `gov-${source}-${props.id || props.object_id || props.camera_id || idx}`,
        lat: coords.lat,
        lng: coords.lng,
        name: props.name || props.address || props.location || props.street || '',
        cameraType: this.mapGovernmentCameraType(props),
        maxSpeed: props.maxspeed || props.speed_limit || props.max_speed
          ? parseInt(props.maxspeed || props.speed_limit || props.max_speed, 10)
          : undefined,
        direction: props.direction || props.facing || props.orientation || undefined,
        source,
      };
    });
  }

  private normalizeTrafficSignals(data: any, source: string): GovernmentTrafficSignal[] {
    if (!data) return [];
    const items = Array.isArray(data) ? data : data.features || data.data || data.results || [];
    return items.map((item: any, idx: number) => {
      const props = item.properties || item;
      const coords = this.extractCoordinates(item);
      return {
        id: `gov-${source}-${props.id || props.object_id || props.signal_id || idx}`,
        lat: coords.lat,
        lng: coords.lng,
        name: props.name || props.address || props.intersection || props.location || '',
        crossing: props.crossing || props.pedestrian_crossing || props.crosswalk || undefined,
        source,
      };
    });
  }

  private extractCoordinates(item: any): { lat: number; lng: number } {
    if (item.geometry?.coordinates) {
      const coords = item.geometry.coordinates;
      return { lng: coords[0], lat: coords[1] };
    }
    if (item.latitude && item.longitude) {
      return { lat: parseFloat(item.latitude), lng: parseFloat(item.longitude) };
    }
    if (item.lat !== undefined && item.lon !== undefined) {
      return { lat: parseFloat(item.lat), lng: parseFloat(item.lon) };
    }
    if (item.lat !== undefined && item.lng !== undefined) {
      return { lat: parseFloat(item.lat), lng: parseFloat(item.lng) };
    }
    return { lat: 0, lng: 0 };
  }

  private mapGovernmentCameraType(props: Record<string, any>): string {
    const type = (props.camera_type || props.type || props.cameraType || '').toLowerCase();
    if (type.includes('mobile') || type.includes('передвиж')) return 'MOBILE';
    if (type.includes('tripod') || type.includes('треног')) return 'TRIPOD';
    if (type.includes('red_light') || type.includes('red light') || type.includes('красн') || type.includes('перекрест')) return 'RED_LIGHT';
    if (type.includes('average') || type.includes('средн') || type.includes('track')) return 'AVERAGE_SPEED';
    if (type.includes('hidden') || type.includes('скрыт')) return 'AMBUSH';
    return 'STATIONARY';
  }
}
