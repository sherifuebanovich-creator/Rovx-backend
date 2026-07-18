import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { GovernmentDataService } from './government-data.service';
const MapObjectCategory = {
  GAS_STATION: 'GAS_STATION',
  EV_CHARGER: 'EV_CHARGER',
  PARKING: 'PARKING',
  TRUCK_PARKING: 'TRUCK_PARKING',
  CAFE: 'CAFE',
  RESTAURANT: 'RESTAURANT',
  HOTEL: 'HOTEL',
  MOTEL: 'MOTEL',
  TOILET: 'TOILET',
  SHOWER: 'SHOWER',
  PHARMACY: 'PHARMACY',
  HOSPITAL: 'HOSPITAL',
  MEDICAL: 'MEDICAL',
  SHOP: 'SHOP',
  SUPERMARKET: 'SUPERMARKET',
  MALL: 'MALL',
  SCHOOL: 'SCHOOL',
  UNIVERSITY: 'UNIVERSITY',
  KINDERGARTEN: 'KINDERGARTEN',
  BANK: 'BANK',
  ATM: 'ATM',
  BUS_STOP: 'BUS_STOP',
  METRO_STATION: 'METRO_STATION',
  TRAIN_STATION: 'TRAIN_STATION',
  AIRPORT: 'AIRPORT',
  PARK: 'PARK',
  SPORTS_FACILITY: 'SPORTS_FACILITY',
  GOVERNMENT: 'GOVERNMENT',
  ATTRACTION: 'ATTRACTION',
  TIRE_SERVICE: 'TIRE_SERVICE',
  CAR_SERVICE: 'CAR_SERVICE',
  WEIGH_STATION: 'WEIGH_STATION',
  BORDER_CROSSING: 'BORDER_CROSSING',
  CUSTOMS: 'CUSTOMS',
  REST_AREA: 'REST_AREA',
  TOURIST_ATTRACTION: 'TOURIST_ATTRACTION',
  SPEED_CAMERA: 'SPEED_CAMERA',
  ROAD_WORKS: 'ROAD_WORKS',
  ACCIDENT: 'ACCIDENT',
  TRAFFIC_LIGHT: 'TRAFFIC_LIGHT',
  POLICE: 'POLICE',
} as const;
type MapObjectCategory = (typeof MapObjectCategory)[keyof typeof MapObjectCategory];

interface BoundsQuery {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
  categories?: MapObjectCategory[];
  limit?: number;
}

const OSM_TAG_MAP: Record<string, string[]> = {
  GAS_STATION: ['["amenity"="fuel"]'],
  EV_CHARGER: ['["amenity"="charging_station"]'],
  PARKING: ['["amenity"="parking"]'],
  CAFE: ['["amenity"="cafe"]'],
  RESTAURANT: ['["amenity"="restaurant"]'],
  HOTEL: ['["tourism"="hotel"]'],
  MOTEL: ['["tourism"="motel"]'],
  TOILET: ['["amenity"="toilets"]'],
  SHOWER: ['["amenity"="shower"]'],
  PHARMACY: ['["amenity"="pharmacy"]'],
  HOSPITAL: ['["amenity"="hospital"]'],
  MEDICAL: ['["amenity"="clinic"]', '["amenity"="doctors"]'],
  SHOP: ['["shop"="convenience"]', '["shop"="general"]'],
  SUPERMARKET: ['["shop"="supermarket"]'],
  MALL: ['["shop"="mall"]', '["shop"="department_store"]'],
  SCHOOL: ['["amenity"="school"]'],
  UNIVERSITY: ['["amenity"="university"]', '["amenity"="college"]'],
  KINDERGARTEN: ['["amenity"="kindergarten"]'],
  BANK: ['["amenity"="bank"]'],
  ATM: ['["amenity"="atm"]'],
  BUS_STOP: ['["highway"="bus_stop"]'],
  METRO_STATION: ['["station"="subway"]', '["railway"="station"][station="subway"]'],
  TRAIN_STATION: ['["railway"="station"]'],
  AIRPORT: ['["aeroway"="aerodrome"]'],
  PARK: ['["leisure"="park"]'],
  SPORTS_FACILITY: ['["leisure"="sports_centre"]', '["leisure"="stadium"]', '["leisure"="fitness_centre"]'],
  GOVERNMENT: ['["amenity"="townhall"]', '["office"="government"]'],
  ATTRACTION: ['["tourism"="attraction"]', '["tourism"="museum"]', '["tourism"="viewpoint"]'],
  TIRE_SERVICE: ['["shop"="tyres"]', '["craft"="tyre_repair"]'],
  CAR_SERVICE: ['["shop"="car_repair"]', '["amenity"="car_wash"]'],
  WEIGH_STATION: ['["amenity"="weighbridge"]', '["highway"="weigh_station"]'],
  BORDER_CROSSING: ['["border"="border_control"]'],
  CUSTOMS: ['["amenity"="customs"]'],
  REST_AREA: ['["highway"="rest_area"]', '["amenity"="rest_area"]'],
  TOURIST_ATTRACTION: ['["tourism"="information"]', '["tourism"="artwork"]', '["tourism"="theme_park"]'],
  POLICE: ['["amenity"="police"]'],
  TRAFFIC_LIGHT: ['["highway"="traffic_signals"]'],
};

const OSM_KEYS_CATEGORIES = new Set(Object.keys(OSM_TAG_MAP));

@Injectable()
export class MapService {
  private readonly logger = new Logger(MapService.name);

  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
    private governmentData: GovernmentDataService,
  ) {}

  async getObjectsInBounds(query: BoundsQuery) {
    const { minLat, maxLat, minLng, maxLng, categories, limit = 200 } = query;

    const cacheKey = `map:${minLat.toFixed(3)},${maxLat.toFixed(3)},${minLng.toFixed(3)},${maxLng.toFixed(3)}:${(categories || []).join(',')}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    // 1. DB results
    const where: any = {
      isActive: true,
      lat: { gte: minLat, lte: maxLat },
      lng: { gte: minLng, lte: maxLng },
    };

    if (categories && categories.length > 0) {
      where.category = { in: categories };
    }

    const dbObjects = await this.prisma.mapObject.findMany({
      where,
      take: limit,
      select: {
        id: true,
        category: true,
        name: true,
        lat: true,
        lng: true,
        address: true,
        rating: true,
        reviewCount: true,
        isPremium: true,
        openHours: true,
        amenities: true,
        images: true,
        data: true,
      },
    });

    // 2. OSM results for layer categories
    const cats = categories && categories.length > 0
      ? categories.filter((c) => OSM_KEYS_CATEGORIES.has(c))
      : [...OSM_KEYS_CATEGORIES];

    let osmObjects: any[] = [];
    if (cats.length > 0) {
      osmObjects = await this.getOSMPOIs(minLat, maxLat, minLng, maxLng, cats);
    }

    // 3. Merge — deduplicate by lat/lng (within 50m)
    const merged = [...dbObjects];
    for (const osm of osmObjects) {
      const dup = merged.some(
        (m) => Math.abs(m.lat - osm.lat) < 0.0005 && Math.abs(m.lng - osm.lng) < 0.0005,
      );
      if (!dup) merged.push(osm);
    }

    const result = merged.slice(0, limit);
    await this.redis.set(cacheKey, JSON.stringify(result), 120);
    return result;
  }

  private async getOSMPOIs(
    minLat: number, maxLat: number, minLng: number, maxLng: number,
    categories: string[],
  ): Promise<any[]> {
    const bbox = `${minLat.toFixed(5)},${minLng.toFixed(5)},${maxLat.toFixed(5)},${maxLng.toFixed(5)}`;
    const filters = categories.flatMap((cat) => {
      const tags = OSM_TAG_MAP[cat];
      return tags ? tags.map((t) => `node${t}(${bbox});`) : [];
    });
    if (filters.length === 0) return [];

    const cacheKey = `osm:poi:${bbox}:${categories.join(',')}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const query = `[out:json];(${filters.join('')});out body 50;`;

    try {
      const res = await axios.post('https://overpass-api.de/api/interpreter',
        `data=${encodeURIComponent(query)}`,
        { timeout: 20000 },
      );
      const results = (res.data.elements || []).map((el: any) => {
        const t = el.tags || {};
        return {
          id: `osm-${el.id}`,
          category: this.osmTagToCategory(t) || 'POI',
          name: t.name || t.operator || t.brand || '',
          lat: el.lat,
          lng: el.lon,
          address: [t['addr:street'], t['addr:housenumber'], t['addr:city'], t['addr:postcode']]
            .filter(Boolean).join(', ') || t.display_name || '',
          rating: null,
          reviewCount: 0,
          isPremium: false,
          openHours: t.opening_hours || undefined,
          amenities: [t.wheelchair ? 'wheelchair' : '', t.wifi ? 'wifi' : '', t.shop ? 'shop' : '']
            .filter(Boolean).join(',') || undefined,
          images: undefined,
          data: JSON.stringify(t),
        };
      });
      await this.redis.set(cacheKey, JSON.stringify(results), 600);
      return results;
    } catch (err) {
      this.logger.warn(`Overpass POI API error: ${(err as Error).message}`);
      return [];
    }
  }

  private osmTagToCategory(tags: Record<string, string>): string | null {
    const tagMap: Array<[string[], string]> = [
      [OSM_TAG_MAP.GAS_STATION, 'GAS_STATION'],
      [OSM_TAG_MAP.EV_CHARGER, 'EV_CHARGER'],
      [OSM_TAG_MAP.PARKING, 'PARKING'],
      [OSM_TAG_MAP.CAFE, 'CAFE'],
      [OSM_TAG_MAP.RESTAURANT, 'RESTAURANT'],
      [OSM_TAG_MAP.HOTEL, 'HOTEL'],
      [OSM_TAG_MAP.MOTEL, 'MOTEL'],
      [OSM_TAG_MAP.TOILET, 'TOILET'],
      [OSM_TAG_MAP.SHOWER, 'SHOWER'],
      [OSM_TAG_MAP.PHARMACY, 'PHARMACY'],
      [OSM_TAG_MAP.HOSPITAL, 'HOSPITAL'],
      [OSM_TAG_MAP.MEDICAL, 'MEDICAL'],
      [OSM_TAG_MAP.SHOP, 'SHOP'],
      [OSM_TAG_MAP.SUPERMARKET, 'SUPERMARKET'],
      [OSM_TAG_MAP.MALL, 'MALL'],
      [OSM_TAG_MAP.SCHOOL, 'SCHOOL'],
      [OSM_TAG_MAP.UNIVERSITY, 'UNIVERSITY'],
      [OSM_TAG_MAP.KINDERGARTEN, 'KINDERGARTEN'],
      [OSM_TAG_MAP.BANK, 'BANK'],
      [OSM_TAG_MAP.ATM, 'ATM'],
      [OSM_TAG_MAP.BUS_STOP, 'BUS_STOP'],
      [OSM_TAG_MAP.METRO_STATION, 'METRO_STATION'],
      [OSM_TAG_MAP.TRAIN_STATION, 'TRAIN_STATION'],
      [OSM_TAG_MAP.AIRPORT, 'AIRPORT'],
      [OSM_TAG_MAP.PARK, 'PARK'],
      [OSM_TAG_MAP.SPORTS_FACILITY, 'SPORTS_FACILITY'],
      [OSM_TAG_MAP.GOVERNMENT, 'GOVERNMENT'],
      [OSM_TAG_MAP.ATTRACTION, 'ATTRACTION'],
      [OSM_TAG_MAP.TIRE_SERVICE, 'TIRE_SERVICE'],
      [OSM_TAG_MAP.CAR_SERVICE, 'CAR_SERVICE'],
      [OSM_TAG_MAP.WEIGH_STATION, 'WEIGH_STATION'],
      [OSM_TAG_MAP.BORDER_CROSSING, 'BORDER_CROSSING'],
      [OSM_TAG_MAP.CUSTOMS, 'CUSTOMS'],
      [OSM_TAG_MAP.REST_AREA, 'REST_AREA'],
      [OSM_TAG_MAP.TOURIST_ATTRACTION, 'TOURIST_ATTRACTION'],
      [OSM_TAG_MAP.POLICE, 'POLICE'],
      [OSM_TAG_MAP.TRAFFIC_LIGHT, 'TRAFFIC_LIGHT'],
    ];
    for (const [tagExprs, category] of tagMap) {
      for (const expr of tagExprs) {
        const match = expr.match(/\["(\w+)"\s*=\s*"(\w+)"\]/);
        if (match && tags[match[1]] === match[2]) return category;
      }
    }
    return null;
  }

  async getSpeedCameras(lat: number, lng: number, radiusKm = 10) {
    const cacheKey = `cameras:db:${lat.toFixed(3)}:${lng.toFixed(3)}:${radiusKm}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const latDeg = radiusKm / 111.32;
    const lngDeg = radiusKm / (111.32 * Math.cos((lat * Math.PI) / 180));

    const dbCameras = await this.prisma.speedCamera.findMany({
      where: {
        isActive: true,
        lat: { gte: lat - latDeg, lte: lat + latDeg },
        lng: { gte: lng - lngDeg, lte: lng + lngDeg },
      },
      select: {
        id: true,
        type: true,
        lat: true,
        lng: true,
        direction: true,
        speedLimit: true,
        roadName: true,
        source: true,
      },
    });

    const result = dbCameras.map((c) => ({
      id: c.id,
      lat: c.lat,
      lng: c.lng,
      name: c.roadName || '',
      cameraType: c.type,
      maxSpeed: c.speedLimit || undefined,
      direction: c.direction ? String(c.direction) : undefined,
      source: c.source,
    }));

    await this.redis.set(cacheKey, JSON.stringify(result), 3600);
    return result;
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

  async getTrafficSignals(lat: number, lng: number, radiusKm = 2) {
    const cacheKey = `traffic:db:${lat.toFixed(3)}:${lng.toFixed(3)}:${radiusKm}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const latDeg = radiusKm / 111.32;
    const lngDeg = radiusKm / (111.32 * Math.cos((lat * Math.PI) / 180));

    const dbSignals = await this.prisma.mapFeature.findMany({
      where: {
        type: 'traffic_signals',
        lat: { gte: lat - latDeg, lte: lat + latDeg },
        lng: { gte: lng - lngDeg, lte: lng + lngDeg },
      },
      select: {
        id: true,
        lat: true,
        lng: true,
        tags: true,
      },
    });

    const result = dbSignals.map((s) => {
      const tags = s.tags ? JSON.parse(s.tags) : {};
      return {
        id: s.id,
        lat: s.lat,
        lng: s.lng,
        name: tags.name || '',
        crossing: tags.crossing || '',
      };
    });

    await this.redis.set(cacheKey, JSON.stringify(result), 3600);
    return result;
  }

  async getNearby(lat: number, lng: number, radiusKm: number, category?: MapObjectCategory) {
    const latDelta = radiusKm / 111;
    const lngDelta = radiusKm / (111 * Math.cos((lat * Math.PI) / 180));
    const minLat = lat - latDelta;
    const maxLat = lat + latDelta;
    const minLng = lng - lngDelta;
    const maxLng = lng + lngDelta;

    // 1. DB results
    const where: any = {
      isActive: true,
      lat: { gte: minLat, lte: maxLat },
      lng: { gte: minLng, lte: maxLng },
    };
    if (category) where.category = category;

    const dbObjects = await this.prisma.mapObject.findMany({ where, take: 50 });

    // 2. OSM results
    let osmObjects: any[] = [];
    if (category && OSM_KEYS_CATEGORIES.has(category)) {
      osmObjects = await this.getOSMPOIs(minLat, maxLat, minLng, maxLng, [category]);
    }

    // 3. Merge
    const merged = [...dbObjects];
    for (const osm of osmObjects) {
      const dup = merged.some(
        (m) => Math.abs(m.lat - osm.lat) < 0.0005 && Math.abs(m.lng - osm.lng) < 0.0005,
      );
      if (!dup) merged.push(osm);
    }

    return merged
      .map((obj) => ({
        ...obj,
        distance: this.haversine(lat, lng, obj.lat, obj.lng),
      }))
      .filter((obj) => obj.distance <= radiusKm)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 50);
  }

  async getObjectById(id: string) {
    return this.prisma.mapObject.findUnique({
      where: { id },
      include: {
        reviews: {
          include: {
            user: { select: { id: true, displayName: true, avatar: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
      },
    });
  }

  async getTrafficInBounds(minLat: number, maxLat: number, minLng: number, maxLng: number) {
    const cacheKey = `traffic:${minLat.toFixed(2)},${maxLat.toFixed(2)},${minLng.toFixed(2)},${maxLng.toFixed(2)}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const segments = await this.prisma.trafficSegment.findMany({
      where: {
        startLat: { gte: minLat, lte: maxLat },
        startLng: { gte: minLng, lte: maxLng },
      },
      take: 500,
    });

    await this.redis.set(cacheKey, JSON.stringify(segments), 30);
    return segments;
  }

  private parsePhotonFeatures(features: any[], query: string) {
    return (features || []).map((f: any) => {
      const p = f.properties;
      const addrParts = [p.street, p.housenumber, p.city, p.state, p.country].filter(Boolean);
      const displayName = p.name
        || (p.street ? (p.housenumber ? `${p.street}, ${p.housenumber}` : p.street) : null)
        || p.city
        || p.state
        || query;
      return {
        id: `ext-${p.osm_id || ''}-${p.osm_key || ''}-${f.geometry.coordinates[0]}-${f.geometry.coordinates[1]}`.replace(/[^a-zA-Z0-9_-]/g, '_'),
        name: displayName,
        address: addrParts.join(', '),
        lat: f.geometry.coordinates[1],
        lng: f.geometry.coordinates[0],
        category: (p.osm_value || p.type || 'address').toUpperCase(),
        source: 'external',
      };
    });
  }

  private async fetchExternalResults(query: string, limit: number, lat?: number, lng?: number) {
    const params = `q=${encodeURIComponent(query)}&limit=${limit}&lang=ru${
      lat && lng ? `&lat=${lat}&lon=${lng}` : ''
    }`;

    try {
      const url = `https://photon.komoot.io/api/?${params}`;
      this.logger.log(`Photon request: ${url}`);
      const response = await axios.get(url, { timeout: 8000 });
      const results = this.parsePhotonFeatures(response.data.features || [], query);
      if (results.length > 0) {
        this.logger.log(`Photon returned ${results.length} results`);
        return results;
      }
      this.logger.warn('Photon returned 0 results, trying Nominatim');
    } catch (e) {
      this.logger.error(`Photon failed: ${e instanceof Error ? e.message : String(e)}`);
    }

    try {
      let nomUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=${limit}&accept-language=ru&addressdetails=1`;
      if (lat && lng) {
        const d = 2;
        const viewbox = `${lng - d},${lat - d},${lng + d},${lat + d}`;
        nomUrl += `&viewbox=${viewbox}&bounded=0`;
      }
      this.logger.log(`Nominatim fallback: ${nomUrl}`);
      const response = await axios.get(nomUrl, { timeout: 8000, headers: { 'User-Agent': 'RovxApp/1.0' } });
      return (response.data || []).map((r: any) => {
        const addrParts = [r.address?.road, r.address?.house_number, r.address?.city || r.address?.town, r.address?.state, r.address?.country].filter(Boolean);
        return {
          id: `nom-${r.place_id}`,
          name: r.display_name?.split(',')[0] || query,
          address: addrParts.join(', '),
          lat: parseFloat(r.lat),
          lng: parseFloat(r.lon),
          category: (r.type || r.class || 'address').toUpperCase(),
          source: 'external',
        };
      });
    } catch (e) {
      this.logger.error(`Nominatim failed: ${e instanceof Error ? e.message : String(e)}`);
      return [];
    }
  }

  async searchObjects(query: string, lat?: number, lng?: number, radiusKm = 50) {
    if (!query || query.length < 1) return [];

    const where: any = {
      isActive: true,
      OR: [
        { name: { contains: query, mode: 'insensitive' } },
        { address: { contains: query, mode: 'insensitive' } },
      ],
    };

    if (lat && lng) {
      const latDelta = radiusKm / 111;
      const lngDelta = radiusKm / (111 * Math.cos((lat * Math.PI) / 180));
      where.lat = { gte: lat - latDelta, lte: lat + latDelta };
      where.lng = { gte: lng - lngDelta, lte: lng + lngDelta };
    }

    const localResults: any[] = await this.prisma.mapObject.findMany({ where, take: 10 }).catch(() => []);

    let externalResults: any[] = [];
    if (query.length >= 3) {
      externalResults = await this.fetchExternalResults(query, 10, lat, lng);
    }

    const combined = [
      ...localResults.map((r) => ({ ...r, source: 'local' })),
      ...externalResults.filter(
        (ext) => !localResults.some((loc) => this.haversine(ext.lat, ext.lng, loc.lat, loc.lng) < 0.1),
      ),
    ];

    if (lat && lng) {
      return combined
        .map((r) => ({ ...r, distance: this.haversine(lat, lng, r.lat, r.lng) }))
        .sort((a, b) => (a.distance || 0) - (b.distance || 0));
    }

    return combined;
  }

  async getSuggestions(query: string, lat?: number, lng?: number) {
    if (!query || query.length < 1) return [];

    let localResults: any[] = [];
    try {
      localResults = await this.prisma.mapObject.findMany({
        where: {
          isActive: true,
          OR: [
            { name: { contains: query, mode: 'insensitive' } },
            { address: { contains: query, mode: 'insensitive' } },
          ],
        },
        take: 5,
        select: {
          id: true, category: true, name: true, lat: true, lng: true,
          address: true, rating: true,
        },
      });
    } catch (e) {
      this.logger.warn(`Local suggest query failed: ${e instanceof Error ? e.message : String(e)}`);
    }

    let externalResults: any[] = [];
    if (query.length >= 3) {
      externalResults = await this.fetchExternalResults(query, 8, lat, lng);
    }

    const combined = [
      ...localResults.map((r) => ({ ...r, source: 'local' })),
      ...externalResults.filter(
        (ext) => !localResults.some((loc) => this.haversine(ext.lat, ext.lng, loc.lat, loc.lng) < 0.05),
      ),
    ].slice(0, 8);

    if (lat && lng) {
      return combined
        .map((r) => ({ ...r, distance: this.haversine(lat, lng, r.lat, r.lng) }))
        .sort((a, b) => (a.distance || 0) - (b.distance || 0));
    }

    return combined;
  }

  async reverseGeocode(lat: number, lng: number) {
    const cacheKey = `revgeo:${lat.toFixed(5)},${lng.toFixed(5)}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    // Check local map objects
    const nearest = await this.prisma.mapObject.findFirst({
      where: {
        isActive: true,
        lat: { gte: lat - 0.01, lte: lat + 0.01 },
        lng: { gte: lng - 0.01, lte: lng + 0.01 },
      },
      orderBy: { rating: 'desc' },
      select: { id: true, name: true, address: true, category: true, lat: true, lng: true },
    });

    if (nearest && this.haversine(lat, lng, nearest.lat, nearest.lng) < 0.5) {
      const result = { ...nearest, distance: this.haversine(lat, lng, nearest.lat, nearest.lng) };
      await this.redis.set(cacheKey, JSON.stringify(result), 3600);
      return result;
    }

    // External reverse geocode via Photon
    try {
      const url = `https://photon.komoot.io/reverse?lat=${lat}&lon=${lng}`;
      const response = await axios.get(url, { timeout: 2000 });
      const f = response.data.features?.[0];
      if (f) {
        const result = {
          id: `rev-${f.properties.osm_id || ''}-${lng}-${lat}`.replace(/[^a-zA-Z0-9_-]/g, '_'),
          name: f.properties.name || f.properties.street || f.properties.city || 'Unknown',
          address: [f.properties.street, f.properties.housenumber, f.properties.city, f.properties.country].filter(Boolean).join(', '),
          lat: f.geometry.coordinates[1],
          lng: f.geometry.coordinates[0],
          category: (f.properties.osm_value || 'address').toUpperCase(),
        };
        await this.redis.set(cacheKey, JSON.stringify(result), 3600);
        return result;
      }
    } catch (e) {
      this.logger.error(`Reverse geocode failed: ${e instanceof Error ? e.message : String(e)}`);
    }

    return { name: `${lat.toFixed(4)}, ${lng.toFixed(4)}`, address: '', lat, lng, category: 'COORDINATES' };
  }

  async addBookmark(userId: string, data: any) {
    return this.prisma.bookmark.create({
      data: {
        userId,
        mapObjectId: data.mapObjectId,
        name: data.name,
        lat: data.lat,
        lng: data.lng,
        address: data.address,
        note: data.note,
      },
    });
  }

  async getBookmarks(userId: string) {
    return this.prisma.bookmark.findMany({
      where: { userId },
      include: {
        mapObject: {
          select: { id: true, category: true, name: true, rating: true, images: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async deleteBookmark(id: string, userId: string) {
    await this.prisma.bookmark.deleteMany({ where: { id, userId } });
    return { deleted: true };
  }

  private haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lng2 - lng1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
}
