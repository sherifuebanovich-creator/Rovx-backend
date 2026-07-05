import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const MapObjectCategory = {
  GAS_STATION: 'GAS_STATION',
  EV_CHARGER: 'EV_CHARGER',
  PARKING: 'PARKING',
  TRUCK_PARKING: 'TRUCK_PARKING',
  CAFE: 'CAFE',
  RESTAURANT: 'RESTAURANT',
  HOTEL: 'HOTEL',
  MOTEL: 'MOTEL',
  PHARMACY: 'PHARMACY',
  HOSPITAL: 'HOSPITAL',
  TIRE_SERVICE: 'TIRE_SERVICE',
  CAR_SERVICE: 'CAR_SERVICE',
  REST_AREA: 'REST_AREA',
  BORDER_CROSSING: 'BORDER_CROSSING',
  WEIGH_STATION: 'WEIGH_STATION',
  TOURIST_ATTRACTION: 'TOURIST_ATTRACTION',
  SPEED_CAMERA: 'SPEED_CAMERA',
  TRAFFIC_LIGHT: 'TRAFFIC_LIGHT',
  POLICE: 'POLICE',
} as const;

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding ROVX database...');

  // ── Admin User ─────────────────────────────────────────────────────────────
  const adminHash = await bcrypt.hash('Admin@123456', 12);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@rovx.app' },
    update: {},
    create: {
      email: 'admin@rovx.app',
      username: 'rovx_admin',
      displayName: 'ROVX Admin',
      passwordHash: adminHash,
      role: 'SUPERADMIN',
      subscription: 'PREMIUM_MAX',
      isVerified: true,
      preferences: { create: {} },
    },
  });

  // ── Demo User ──────────────────────────────────────────────────────────────
  const userHash = await bcrypt.hash('Demo@123456', 12);
  const demo = await prisma.user.upsert({
    where: { email: 'demo@rovx.app' },
    update: {},
    create: {
      email: 'demo@rovx.app',
      username: 'demo_driver',
      displayName: 'Demo Driver',
      passwordHash: userHash,
      subscription: 'PREMIUM_STANDARD',
      isVerified: true,
      totalTrips: 47,
      totalDistance: 3842.5,
      reputation: 230,
      driverScore: 4.8,
      homeLat: 55.7558,
      homeLng: 37.6173,
      homeAddress: 'Moscow, Russia',
      preferences: {
        create: {
          voiceEnabled: true,
          voiceLanguage: 'ru',
          speedAlerts: true,
          cameraAlerts: true,
        },
      },
    },
  });

  // ── Achievements ───────────────────────────────────────────────────────────
  const achievementData = [
    { code: 'FIRST_TRIP', name: 'First Trip', description: 'Complete your first trip', icon: '🚗', points: 10, category: 'trips' },
    { code: 'ROAD_WARRIOR', name: 'Road Warrior', description: 'Complete 100 trips', icon: '🏆', points: 100, category: 'trips' },
    { code: 'REPORTER', name: 'Reporter', description: 'Submit your first hazard report', icon: '⚠️', points: 20, category: 'reports' },
    { code: 'GUARDIAN', name: 'Road Guardian', description: 'Submit 50 confirmed reports', icon: '🛡️', points: 200, category: 'reports' },
    { code: 'EXPLORER', name: 'Explorer', description: 'Travel to 10 different cities', icon: '🗺️', points: 50, category: 'exploration' },
    { code: 'ECO_DRIVER', name: 'Eco Driver', description: 'Take 10 eco-friendly routes', icon: '🌱', points: 30, category: 'eco' },
    { code: 'NIGHT_OWL', name: 'Night Owl', description: 'Complete 10 night trips', icon: '🦉', points: 25, category: 'special' },
    { code: 'SOCIAL', name: 'Social Driver', description: 'Get 20 followers', icon: '👥', points: 40, category: 'social' },
  ];

  for (const ach of achievementData) {
    await prisma.achievement.upsert({
      where: { code: ach.code },
      update: {},
      create: ach,
    });
  }

  // ── Sample Map Objects (Moscow area) ──────────────────────────────────────
  const mapObjects = [
    // Gas Stations
    { category: MapObjectCategory.GAS_STATION, name: 'Lukoil АЗС', lat: 55.7512, lng: 37.6182, address: 'Tverskaya St, Moscow', rating: 4.2, phone: '+7-800-550-00-01', amenities: ['toilet', 'shop', 'cafe'] },
    { category: MapObjectCategory.GAS_STATION, name: 'Gazprom АЗС', lat: 55.7620, lng: 37.6089, address: 'Leninsky Ave, Moscow', rating: 4.0, phone: '+7-800-100-94-00', amenities: ['toilet', 'shop'] },
    { category: MapObjectCategory.EV_CHARGER, name: 'Tesla Supercharger', lat: 55.7434, lng: 37.5873, address: 'Kutuzovsky Ave 32', rating: 4.7, amenities: ['wifi', 'parking'] },

    // Parking
    { category: MapObjectCategory.PARKING, name: 'Parking Okhotny Ryad', lat: 55.7564, lng: 37.6159, address: 'Manezhnaya Square', rating: 3.8 },
    { category: MapObjectCategory.TRUCK_PARKING, name: 'Truck Stop M10', lat: 55.9021, lng: 37.2134, address: 'M-10 Highway, km 42', rating: 4.1, amenities: ['shower', 'cafe', 'toilet', 'security'] },

    // Food & Drink
    { category: MapObjectCategory.CAFE, name: 'Shokoladnitsa', lat: 55.7540, lng: 37.6220, address: 'Tverskaya 3', rating: 4.3, phone: '+7-495-600-00-00' },
    { category: MapObjectCategory.RESTAURANT, name: 'Теремок', lat: 55.7600, lng: 37.6300, address: 'Arbat St 12', rating: 4.5 },

    // Hotels
    { category: MapObjectCategory.HOTEL, name: 'Marriott Moscow', lat: 55.7588, lng: 37.6126, address: 'Tverskaya 26', rating: 4.8, phone: '+7-495-501-91-00', amenities: ['wifi', 'parking', 'restaurant', 'gym'] },
    { category: MapObjectCategory.MOTEL, name: 'Road Inn M4', lat: 55.5012, lng: 37.4521, address: 'M-4 Highway, km 68', rating: 3.9, amenities: ['parking', 'cafe', 'wifi'] },

    // Medical
    { category: MapObjectCategory.HOSPITAL, name: 'City Hospital #1', lat: 55.7400, lng: 37.5900, address: 'Leninsky Ave 8', rating: 3.5, phone: '103' },
    { category: MapObjectCategory.PHARMACY, name: 'Apteka 36.6', lat: 55.7530, lng: 37.6210, address: 'Pushkinskaya 5', rating: 4.1, phone: '+7-800-100-36-36' },

    // Services
    { category: MapObjectCategory.TIRE_SERVICE, name: 'Shinka.ru', lat: 55.7300, lng: 37.6800, address: 'Volgogradsky Ave 14', rating: 4.4, phone: '+7-495-600-12-34' },
    { category: MapObjectCategory.CAR_SERVICE, name: 'Bosch Service', lat: 55.7800, lng: 37.5500, address: 'Leningradsky Ave 80', rating: 4.6 },

    // Infrastructure
    { category: MapObjectCategory.REST_AREA, name: 'Rest Area M1 km50', lat: 55.8234, lng: 36.9812, address: 'M-1 Minsk Highway', rating: 3.7, amenities: ['toilet', 'parking', 'cafe'] },
    { category: MapObjectCategory.BORDER_CROSSING, name: 'Krasnaya Gorka', lat: 55.1234, lng: 36.2341, address: 'Russia-Belarus border', amenities: ['customs', 'parking', 'cafe'] },
    { category: MapObjectCategory.WEIGH_STATION, name: 'Weigh Station M4 km60', lat: 55.6012, lng: 37.3421, address: 'M-4 Don Highway' },

    // Tourist
    { category: MapObjectCategory.TOURIST_ATTRACTION, name: 'Red Square', lat: 55.7539, lng: 37.6208, address: 'Red Square, Moscow', rating: 4.9 },

    // DPS / Traffic Police
    { category: MapObjectCategory.POLICE, name: 'ДПС пост МКАД 1', lat: 55.8100, lng: 37.6400, address: 'MKAD, Moscow', phone: '112', amenities: ['parking'] },
    { category: MapObjectCategory.POLICE, name: 'ДПС пост МКАД 2', lat: 55.7700, lng: 37.5100, address: 'MKAD, Moscow', phone: '112', amenities: ['parking'] },
    { category: MapObjectCategory.POLICE, name: 'ДПС пост Ленинградское ш.', lat: 55.8500, lng: 37.4800, address: 'Leningradskoye Shosse, Moscow', phone: '112', amenities: ['parking'] },
    { category: MapObjectCategory.POLICE, name: 'ДПС пост М4 Дон', lat: 55.5800, lng: 37.6800, address: 'M-4 Don Highway, Moscow Oblast', phone: '112', amenities: ['parking', 'cafe'] },
    { category: MapObjectCategory.POLICE, name: 'ГИБДД поста М10 Россия', lat: 55.8800, lng: 37.4300, address: 'M-10 Russia Highway, Moscow Oblast', phone: '112' },

    // Traffic Lights (real Moscow intersections)
    { category: MapObjectCategory.TRAFFIC_LIGHT, name: 'Тверская ул. / Охотный Ряд', lat: 55.7564, lng: 37.6159, address: 'Tverskaya St / Okhotny Ryad, Moscow' },
    { category: MapObjectCategory.TRAFFIC_LIGHT, name: 'Садовое кольцо / Тверская ул.', lat: 55.7681, lng: 37.6051, address: 'Sadovoye Koltso / Tverskaya St, Moscow' },
    { category: MapObjectCategory.TRAFFIC_LIGHT, name: 'Ленинградский пр. / Тверская ул.', lat: 55.7745, lng: 37.5891, address: 'Leningradsky Ave / Tverskaya St, Moscow' },
    { category: MapObjectCategory.TRAFFIC_LIGHT, name: 'Кутузовский пр. / Новый Арбат', lat: 55.7503, lng: 37.5845, address: 'Kutuzovsky Ave / Novy Arbat, Moscow' },
    { category: MapObjectCategory.TRAFFIC_LIGHT, name: 'МКАД / Ленинградское ш.', lat: 55.8621, lng: 37.4101, address: 'MKAD / Leningradskoye Shosse, Moscow' },
    { category: MapObjectCategory.TRAFFIC_LIGHT, name: 'Садовое кольцо / Земляной Вал', lat: 55.7619, lng: 37.6492, address: 'Sadovoye Koltso / Zemlyanoy Val, Moscow' },
    { category: MapObjectCategory.TRAFFIC_LIGHT, name: 'Бульварное кольцо / Никитский б-р', lat: 55.7573, lng: 37.6020, address: 'Boulevard Ring / Nikitsky Blvd, Moscow' },

    // Speed Cameras (real locations with types)
    { category: MapObjectCategory.SPEED_CAMERA, name: 'Фоторадар ТТК Садовое', lat: 55.7650, lng: 37.6080, address: 'Sadovoye Koltso, Moscow', data: { cameraType: 'PHOTORADAR', maxSpeed: 60 } },
    { category: MapObjectCategory.SPEED_CAMERA, name: 'Стационарная МКАД 74км', lat: 55.8100, lng: 37.6200, address: 'MKAD 74km, Moscow', data: { cameraType: 'STATIONARY', maxSpeed: 100 } },
    { category: MapObjectCategory.SPEED_CAMERA, name: 'Тренога Ленинградское ш.', lat: 55.8500, lng: 37.4500, address: 'Leningradskoye Shosse, Moscow', data: { cameraType: 'TRIPOD', maxSpeed: 60 } },
    { category: MapObjectCategory.SPEED_CAMERA, name: 'Камера на красный Тверская', lat: 55.7580, lng: 37.6160, address: 'Tverskaya St, Moscow', data: { cameraType: 'RED_LIGHT' } },
    { category: MapObjectCategory.SPEED_CAMERA, name: 'Фоторадар Кутузовский пр.', lat: 55.7450, lng: 37.5800, address: 'Kutuzovsky Ave, Moscow', data: { cameraType: 'PHOTORADAR', maxSpeed: 60 } },
    { category: MapObjectCategory.SPEED_CAMERA, name: 'Средняя скорость М4 Дон', lat: 55.5800, lng: 37.6800, address: 'M-4 Don Highway, Moscow Oblast', data: { cameraType: 'AVERAGE_SPEED', maxSpeed: 90 } },
    { category: MapObjectCategory.SPEED_CAMERA, name: 'Засада М10 Россия', lat: 55.8800, lng: 37.4300, address: 'M-10 Russia Highway', data: { cameraType: 'AMBUSH', maxSpeed: 90 } },
    { category: MapObjectCategory.SPEED_CAMERA, name: 'Стационарная МКАД 38км', lat: 55.7700, lng: 37.5100, address: 'MKAD 38km, Moscow', data: { cameraType: 'STATIONARY', maxSpeed: 100 } },
    { category: MapObjectCategory.SPEED_CAMERA, name: 'Автобусная полоса Садовое', lat: 55.7620, lng: 37.6500, address: 'Sadovoye Koltso, Moscow', data: { cameraType: 'BUS_LANE' } },
    { category: MapObjectCategory.SPEED_CAMERA, name: 'Передвижная МКАД 53км', lat: 55.7900, lng: 37.5800, address: 'MKAD 53km, Moscow', data: { cameraType: 'MOBILE', maxSpeed: 80 } },
    { category: MapObjectCategory.SPEED_CAMERA, name: 'Камера на ремень ТТК', lat: 55.7680, lng: 37.6350, address: 'TTK, Moscow', data: { cameraType: 'SEATBELT' } },
  ];

  for (const obj of mapObjects) {
    const createData: Record<string, unknown> = {
      id: `seed-${obj.name.replace(/\s+/g, '-').toLowerCase()}`,
      ...obj,
      isVerified: true,
      isActive: true,
    };
    for (const key of ['amenities', 'data'] as const) {
      const val = createData[key];
      if (val !== undefined && val !== null && typeof val !== 'string') {
        createData[key] = JSON.stringify(val);
      }
    }
    await prisma.mapObject.upsert({
      where: { id: `seed-${obj.name.replace(/\s+/g, '-').toLowerCase()}` },
      update: {},
      create: createData as any,
    });
  }

  console.log('✅ Seed complete!');
  console.log('');
  console.log('📋 Test Accounts:');
  console.log('   Admin: admin@rovx.app / Admin@123456');
  console.log('   Demo:  demo@rovx.app  / Demo@123456');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
