export interface User {
  id: string;
  email: string;
  username: string;
  displayName: string;
  avatar?: string;
  bio?: string;
  role: 'USER' | 'MODERATOR' | 'ADMIN' | 'SUPERADMIN';
  subscription: 'FREE' | 'PREMIUM_BASIC' | 'PREMIUM_STANDARD' | 'PREMIUM_MAX';
  preferredLang: string;
  preferredVehicle: VehicleType;
  driverScore: number;
  reputation: number;
  totalTrips: number;
  totalDistance: number;
  homeLat?: number;
  homeLng?: number;
  homeAddress?: string;
  workLat?: number;
  workLng?: number;
  workAddress?: string;
  phone?: string;
  city?: string;
}

export type VehicleType = 'CAR' | 'TRUCK';

export interface Vehicle {
  id: string;
  userId: string;
  type: VehicleType;
  name: string;
  make?: string;
  model?: string;
  year?: number;
  fuelType: string;
  fuelEfficiency?: number;
  tankCapacity?: number;
  height?: number;
  weight?: number;
  length?: number;
  isDefault: boolean;
}

export interface Coordinates {
  lat: number;
  lng: number;
}

export interface RouteResult {
  type: RouteType;
  distance: number;
  duration: number;
  polyline: Coordinates[];
  fuelEstimate: number;
  fuelCost: number;
  tollCost: number;
  safetyScore: number;
  ecoScore: number;
  hazardCount: number;
  instructions: TurnInstruction[];
  summary: string;
}

export type RouteType =
  | 'FASTEST' | 'SHORTEST' | 'SAFEST' | 'SCENIC' | 'CHEAPEST'
  | 'NO_TRAFFIC' | 'NO_TOLLS' | 'ECONOMICAL' | 'TOURIST' | 'FAMILY'
  | 'NIGHT' | 'TRUCK' | 'CUSTOM';

export interface TurnInstruction {
  type: string;
  text: string;
  distance: number;
  duration: number;
  lat: number;
  lng: number;
  streetName?: string;
}

export interface MapObject {
  id: string;
  category: MapObjectCategory;
  name: string;
  description?: string;
  lat: number;
  lng: number;
  address?: string;
  phone?: string;
  website?: string;
  openHours?: any;
  amenities?: string[];
  images: string[];
  rating?: number;
  reviewCount: number;
  isPremium: boolean;
  data?: any;
  distance?: number;
}

export type MapObjectCategory =
  | 'PARKING' | 'TRUCK_PARKING' | 'GAS_STATION' | 'EV_CHARGER'
  | 'CAFE' | 'RESTAURANT' | 'SHOP' | 'SUPERMARKET' | 'MALL'
  | 'TOILET' | 'SHOWER' | 'MOTEL' | 'HOTEL'
  | 'PHARMACY' | 'HOSPITAL' | 'MEDICAL'
  | 'SCHOOL' | 'UNIVERSITY' | 'KINDERGARTEN'
  | 'BANK' | 'ATM' | 'BUS_STOP' | 'METRO_STATION'
  | 'TRAIN_STATION' | 'AIRPORT' | 'PARK' | 'SPORTS_FACILITY'
  | 'GOVERNMENT' | 'ATTRACTION'
  | 'TIRE_SERVICE' | 'CAR_SERVICE' | 'WEIGH_STATION'
  | 'BORDER_CROSSING' | 'CUSTOMS' | 'REST_AREA' | 'TOURIST_ATTRACTION'
  | 'SPEED_CAMERA' | 'ROAD_WORKS' | 'ACCIDENT' | 'TRAFFIC_LIGHT'
  | 'POLICE';

export interface Report {
  id: string;
  userId: string;
  type: ReportType;
  status: 'ACTIVE' | 'CONFIRMED' | 'EXPIRED' | 'REJECTED' | 'RESOLVED';
  lat: number;
  lng: number;
  address?: string;
  description?: string;
  severity: number;
  confidence: number;
  confirmedBy: number;
  rejectedBy: number;
  images: string[];
  expiresAt?: string;
  createdAt: string;
  user?: { id: string; displayName: string; reputation: number };
}

export type ReportType =
  | 'POTHOLE' | 'BAD_ROAD' | 'ICE' | 'STRONG_WIND' | 'FREQUENT_ACCIDENTS'
  | 'FOG' | 'FLOODING' | 'LANDSLIDE' | 'LOW_BRIDGE' | 'SHARP_TURN'
  | 'STEEP_CLIMB' | 'STEEP_DESCENT' | 'WEIGHT_LIMIT' | 'HEIGHT_LIMIT'
  | 'LENGTH_LIMIT' | 'SPEED_CAMERA' | 'ROAD_WORKS' | 'ACCIDENT'
  | 'ROAD_CLOSURE' | 'TRAFFIC_JAM' | 'POLICE' | 'HAZARD' | 'OTHER';

export interface Trip {
  id: string;
  userId: string;
  originName: string;
  originLat: number;
  originLng: number;
  destName: string;
  destLat: number;
  destLng: number;
  distance?: number;
  duration?: number;
  status: 'planned' | 'active' | 'completed' | 'cancelled';
  startedAt?: string;
  endedAt?: string;
  createdAt: string;
}

export interface SearchSuggestion {
  id: string;
  name: string;
  address?: string;
  lat: number;
  lng: number;
  category: string;
  rating?: number;
  distance?: number;
  source?: 'local' | 'external';
}

export interface PremiumTier {
  tier: number;
  name: string;
  price: number;
  maxGroups: number;
  canCreateGroups: boolean;
  canReceiveReports: boolean;
  label: string;
}

export interface PremiumSubscription {
  tier: number;
  name: string;
  label: string;
  endDate?: string;
  maxGroups: number;
  canCreateGroups: boolean;
  canReceiveReports: boolean;
  active: boolean;
}

export interface CityChatMessage {
  id: string;
  city: string;
  userId: string;
  content: string;
  createdAt: string;
  user: { id: string; displayName: string; avatar?: string };
}

export interface Friend {
  id: string;
  username: string;
  displayName: string;
  avatar?: string;
  city?: string;
  isOnline: boolean;
  since: string;
}

export interface FriendRequest {
  id: string;
  user: { id: string; username: string; displayName: string; avatar?: string };
  createdAt: string;
}

export interface FuelCalculation {
  id: string;
  originName: string;
  destName: string;
  distanceKm: number;
  durationMin: number;
  fuelConsumed: number;
  fuelCost: number;
  fuelPricePerLiter: number;
  vehicleName?: string;
  createdAt: string;
}

export interface FuelResult {
  distanceKm: number;
  durationMin: number;
  fuelConsumed: number;
  fuelCost: number;
  fuelPricePerLiter: number;
  efficiencyUsed: number;
  fuelType: string;
  originName: string;
  destName: string;
}

export interface Group {
  id: string;
  name: string;
  description?: string;
  avatar?: string;
  region?: string;
  city?: string;
  ownerId: string;
  isPublic: boolean;
  memberCount: number;
  isAdmin?: boolean;
  isMember?: boolean;
  isFavorited?: boolean;
  createdAt: string;
  updatedAt: string;
  owner?: { id: string; displayName: string; avatar?: string };
  members?: GroupMember[];
}

export interface GroupMember {
  id: string;
  userId: string;
  isAdmin: boolean;
  joinedAt: string;
  user: { id: string; username: string; displayName: string; avatar?: string };
}

export interface GroupMessage {
  id: string;
  groupId: string;
  senderId: string;
  content: string;
  images?: string[];
  sticker?: string;
  createdAt: string;
  sender: { id: string; displayName: string; avatar?: string };
}

export interface UserPreferences {
  avoidTolls: boolean;
  avoidHighways: boolean;
  preferScenicRoutes: boolean;
  nightMode: boolean;
  voiceEnabled: boolean;
  voiceLanguage: string;
  voiceVolume: number;
  speedAlerts: boolean;
  cameraAlerts: boolean;
  trafficAlerts: boolean;
  hazardAlerts: boolean;
  restStopInterval: number;
  fuelWarningLevel: number;
  units: 'metric' | 'imperial';
  mapStyle: string;
  defaultRouteType: RouteType;
}
