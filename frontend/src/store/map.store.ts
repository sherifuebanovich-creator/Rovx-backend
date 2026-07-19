import { create } from 'zustand';
import { Coordinates, MapObject, Report, RouteResult, RouteType, SearchSuggestion, FriendLocation, Vehicle } from '@/types';

interface NavigationState {
  isNavigating: boolean;
  currentLeg: number;
  routeProgress: number;
  distanceToManeuver: number;
  bearingToManeuver: number;
  isArrived: boolean;
  isOffRoute: boolean;
  isRerouting: boolean;
  isWrongWay: boolean;
  forwardIndex: number;
}

interface MapState {
  // Location
  userLocation: Coordinates | null;
  userLocationTimestamp: number | null;
  userHeading: number;
  userSpeed: number;
  userAccuracy: number;
  locationError: string | null;

  // Map view
  mapCenter: Coordinates;
  zoom: number;
  mapStyle: 'streets' | 'satellite' | 'night' | 'traffic';
  showTraffic: boolean;
  followUser: boolean;

  // Route
  origin: (Coordinates & { name: string }) | null;
  destination: (Coordinates & { name: string }) | null;
  waypoints: (Coordinates & { name: string })[];
  selectedRoute: RouteResult | null;
  calculatedRoutes: RouteResult[];
  activeRouteType: RouteType;
  activeTrip: string | null;

  // Navigation
  navigation: NavigationState;
  isAiCoDriverEnabled: boolean;

  // Map objects
  visibleObjects: MapObject[];
  selectedObject: MapObject | null;
  activeCategories: string[];

  // Reports
  reports: Report[];
  selectedReport: Report | null;

  // Friends locations
  friendLocations: FriendLocation[];

  // Search
  isSearchOpen: boolean;
  searchQuery: string;
  searchSuggestions: SearchSuggestion[];
  isSearching: boolean;
  searchHistory: SearchSuggestion[];
  selectedSearchResult: SearchSuggestion | null;

  // 3D mode
  show3D: boolean;

  // UI
  isRoutesPanelOpen: boolean;
  isObjectsPanelOpen: boolean;
  isReportPanelOpen: boolean;
  isSidebarOpen: boolean;
  vehicleMode: 'CAR';
  selectedVehicle: Vehicle | null;
  darkMode: boolean;

  // Actions
  setUserLocation: (loc: Coordinates, heading?: number, speed?: number, accuracy?: number, timestamp?: number) => void;
  setLocationError: (err: string | null) => void;
  setMapCenter: (center: Coordinates, zoom?: number) => void;
  setZoom: (zoom: number) => void;
  setMapStyle: (style: MapState['mapStyle']) => void;
  setShowTraffic: (show: boolean) => void;
  setFollowUser: (follow: boolean) => void;
  setOrigin: (origin: MapState['origin']) => void;
  setDestination: (dest: MapState['destination']) => void;
  setCalculatedRoutes: (routes: RouteResult[]) => void;
  setSelectedRoute: (route: RouteResult | null) => void;
  setActiveRouteType: (type: RouteType) => void;
  setActiveTrip: (tripId: string | null) => void;
  setNavigation: (nav: Partial<NavigationState>) => void;
  setAiCoDriver: (enabled: boolean) => void;
  setVisibleObjects: (objects: MapObject[]) => void;
  setSelectedObject: (obj: MapObject | null) => void;
  toggleCategory: (category: string) => void;
  setReports: (reports: Report[]) => void;
  addReport: (report: Report) => void;
  setSelectedReport: (report: Report | null) => void;
  setFriendLocations: (locations: FriendLocation[]) => void;
  updateFriendLocation: (location: FriendLocation) => void;
  toggleSearch: () => void;
  setSearchQuery: (q: string) => void;
  setSearchSuggestions: (suggestions: SearchSuggestion[]) => void;
  setIsSearching: (v: boolean) => void;
  addToSearchHistory: (item: SearchSuggestion) => void;
  clearSearchHistory: () => void;
  setSelectedSearchResult: (item: SearchSuggestion | null) => void;
  toggleRoutesPanel: () => void;
  toggleSidebar: () => void;
  toggleReportPanel: () => void;
  setVehicleMode: (mode: 'CAR') => void;
  setSelectedVehicle: (vehicle: Vehicle | null) => void;
  setDarkMode: (dark: boolean) => void;
  setShow3D: (show: boolean) => void;
  toggle3D: () => void;
  clearRoute: () => void;
}

export const useMapStore = create<MapState>((set) => ({
  // Location
  userLocation: null,
  userLocationTimestamp: null,
  userHeading: 0,
  userSpeed: 0,
  userAccuracy: 0,
  locationError: null,

  // Map view
  mapCenter: { lat: 0, lng: 0 }, // Will be set by geolocation
  zoom: 13,
  mapStyle: 'streets',
  showTraffic: false,
  followUser: true,

  // Route
  origin: null,
  destination: null,
  waypoints: [],
  selectedRoute: null,
  calculatedRoutes: [],
  activeRouteType: 'FASTEST',
  activeTrip: null,

  // Navigation
  navigation: {
    isNavigating: false,
    currentLeg: 0,
    routeProgress: 0,
    distanceToManeuver: 0,
    bearingToManeuver: 0,
    isArrived: false,
    isOffRoute: false,
    isRerouting: false,
    isWrongWay: false,
    forwardIndex: 0,
  },
  isAiCoDriverEnabled: false,

  // Map objects
  visibleObjects: [],
  selectedObject: null,
  activeCategories: [
    'PARKING', 'TRUCK_PARKING', 'GAS_STATION', 'EV_CHARGER',
    'CAFE', 'RESTAURANT', 'SHOP', 'SUPERMARKET', 'MALL',
    'TOILET', 'SHOWER', 'MOTEL', 'HOTEL',
    'PHARMACY', 'HOSPITAL', 'MEDICAL',
    'SCHOOL', 'UNIVERSITY', 'KINDERGARTEN',
    'BANK', 'ATM', 'BUS_STOP', 'METRO_STATION',
    'TRAIN_STATION', 'AIRPORT', 'PARK', 'SPORTS_FACILITY',
    'GOVERNMENT', 'ATTRACTION',
    'TIRE_SERVICE', 'CAR_SERVICE', 'WEIGH_STATION',
    'BORDER_CROSSING', 'CUSTOMS', 'REST_AREA', 'TOURIST_ATTRACTION',
    'SPEED_CAMERA', 'ROAD_WORKS', 'ACCIDENT', 'TRAFFIC_LIGHT',
    'POLICE',
  ],

  // Reports
  reports: [],
  selectedReport: null,

  // Friends locations
  friendLocations: [],

  // Search
  isSearchOpen: false,
  searchQuery: '',
  searchSuggestions: [],
  isSearching: false,
  searchHistory: [],
  selectedSearchResult: null,

  // 3D mode
  show3D: true,

  // UI
  isRoutesPanelOpen: false,
  isObjectsPanelOpen: false,
  isReportPanelOpen: false,
  isSidebarOpen: false,
  vehicleMode: 'CAR',
  selectedVehicle: null,
  darkMode: true,

  // Actions
  setUserLocation: (loc, heading = 0, speed = 0, accuracy = 0, timestamp) =>
    set({
      userLocation: loc,
      userLocationTimestamp: timestamp ?? Date.now(),
      userHeading: heading,
      userSpeed: speed,
      userAccuracy: accuracy,
      locationError: null,
    }),

  setLocationError: (err) => set({ locationError: err }),

  setMapCenter: (center, zoom) =>
    set((s) => ({ mapCenter: center, zoom: zoom ?? s.zoom })),

  setZoom: (zoom) => set({ zoom }),
  setMapStyle: (style) => set({ mapStyle: style }),

  setShowTraffic: (showTraffic) => set({ showTraffic }),

  setFollowUser: (followUser) => set({ followUser }),

  setOrigin: (origin) => set({ origin }),

  setDestination: (destination) => set({ destination }),

  setCalculatedRoutes: (calculatedRoutes) => set({ calculatedRoutes }),

  setSelectedRoute: (selectedRoute) => set({ selectedRoute }),

  setActiveRouteType: (activeRouteType) => set({ activeRouteType }),

  setActiveTrip: (activeTrip) => set({ activeTrip }),

  setNavigation: (nav) =>
    set((s) => ({ navigation: { ...s.navigation, ...nav } })),

  setAiCoDriver: (isAiCoDriverEnabled) => set({ isAiCoDriverEnabled }),

  setVisibleObjects: (visibleObjects) => set({ visibleObjects }),

  setSelectedObject: (selectedObject) => set({ selectedObject }),

  toggleCategory: (category) =>
    set((s) => ({
      activeCategories: s.activeCategories.includes(category)
        ? s.activeCategories.filter((c) => c !== category)
        : [...s.activeCategories, category],
    })),

  setReports: (reports) => set({ reports }),

  addReport: (report) =>
    set((s) => ({ reports: [report, ...s.reports] })),

  setSelectedReport: (selectedReport) => set({ selectedReport }),

  setFriendLocations: (friendLocations) => set({ friendLocations }),
  updateFriendLocation: (loc) =>
    set((s) => {
      const idx = s.friendLocations.findIndex((f) => f.userId === loc.userId);
      if (idx >= 0) {
        const updated = [...s.friendLocations];
        updated[idx] = loc;
        return { friendLocations: updated };
      }
      return { friendLocations: [...s.friendLocations, loc] };
    }),

  toggleSearch: () => set((s) => ({ isSearchOpen: !s.isSearchOpen, searchQuery: '', searchSuggestions: [], selectedSearchResult: null })),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setSearchSuggestions: (searchSuggestions) => set({ searchSuggestions }),
  setIsSearching: (isSearching) => set({ isSearching }),
  addToSearchHistory: (item) =>
    set((s) => {
      const filtered = s.searchHistory.filter(
        (h) => !(h.lat === item.lat && h.lng === item.lng),
      );
      return { searchHistory: [item, ...filtered].slice(0, 10) };
    }),
  clearSearchHistory: () => set({ searchHistory: [] }),
  setSelectedSearchResult: (selectedSearchResult) => set({ selectedSearchResult }),

  toggleRoutesPanel: () => set((s) => ({ isRoutesPanelOpen: !s.isRoutesPanelOpen })),

  toggleSidebar: () => set((s) => ({ isSidebarOpen: !s.isSidebarOpen })),
  toggleReportPanel: () => set((s) => ({ isReportPanelOpen: !s.isReportPanelOpen })),

  setVehicleMode: (vehicleMode) => set({ vehicleMode }),
  setSelectedVehicle: (selectedVehicle) => set({ selectedVehicle }),

  setDarkMode: (darkMode) => set({ darkMode }),

  setShow3D: (show3D) => set({ show3D }),

  toggle3D: () => set((s) => ({ show3D: !s.show3D })),

  clearRoute: () =>
    set({
      origin: null,
      destination: null,
      waypoints: [],
      selectedRoute: null,
      calculatedRoutes: [],
      activeTrip: null,
      navigation: {
        isNavigating: false,
        currentLeg: 0,
        routeProgress: 0,
        distanceToManeuver: 0,
        bearingToManeuver: 0,
        isArrived: false,
        isOffRoute: false,
        isRerouting: false,
        isWrongWay: false,
        forwardIndex: 0,
      },
      searchQuery: '',
      searchSuggestions: [],
      selectedSearchResult: null,
    }),
}));
