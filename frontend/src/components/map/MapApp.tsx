'use client';
import dynamic from 'next/dynamic';
import { useEffect } from 'react';
import { useMapStore } from '@/store/map.store';
import { useAuthStore } from '@/store/auth.store';
import { useGeolocation } from '@/hooks/useGeolocation';
import { useSocket } from '@/hooks/useSocket';
import { TopBar } from '@/components/navigation/TopBar';
import { BottomBar } from '@/components/navigation/BottomBar';
import { Sidebar } from '@/components/navigation/Sidebar';
import { SearchPanel } from '@/components/navigation/SearchPanel';
import { RoutePanel } from '@/components/navigation/RoutePanel';
import { NavigationHUD } from '@/components/navigation/NavigationHUD';
import { ObjectDetailPanel } from '@/components/map/ObjectDetailPanel';
import { ReportPanel } from '@/components/map/ReportPanel';
import { FriendLocation, Report } from '@/types';
import { routesApi, usersApi } from '@/lib/api';
import { resetRerouteCooldown } from '@/lib/navigationEngine';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

const MapView = dynamic(() => import('@/components/map/MapViewGL'), { ssr: false });

// Maps backend report type constants to the same reportPanel.reportTypes.*
// i18n keys used by ReportPanel.tsx, so the real-time toast shown when
// another user submits a hazard nearby is localized instead of always
// rendering in Russian.
const REPORT_TYPE_KEYS: Record<string, string> = {
  ACCIDENT: 'accident',
  ROAD_CLOSURE: 'roadClosed',
  ROAD_WORKS: 'roadWorks',
  TRAFFIC_JAM: 'trafficJam',
  ICE: 'ice',
  FOG: 'fog',
  FLOODING: 'flooding',
  POLICE: 'police',
  POTHOLE: 'pothole',
  BAD_ROAD: 'badRoad',
  STRONG_WIND: 'strongWind',
  HAZARD: 'other',
  SPEED_CAMERA: 'speedCamera',
};

export default function MapApp() {
  const { t } = useTranslation();
  const isSearchOpen = useMapStore(s => s.isSearchOpen);
  const isRoutesPanelOpen = useMapStore(s => s.isRoutesPanelOpen);
  const isSidebarOpen = useMapStore(s => s.isSidebarOpen);
  const selectedObject = useMapStore(s => s.selectedObject);
  const isReportPanelOpen = useMapStore(s => s.isReportPanelOpen);
  // Only isNavigating is used below — selecting it directly avoids
  // re-rendering the whole app shell on every unrelated navigation field
  // change (distanceToManeuver, bearingToManeuver, etc.), which fires on
  // nearly every GPS update while driving.
  const isNavigating = useMapStore(s => s.navigation.isNavigating);
  const updateFriendLocation = useMapStore(s => s.updateFriendLocation);
  const addReport = useMapStore(s => s.addReport);

  const { user } = useAuthStore();
  useGeolocation();
  const { joinCity } = useSocket();

  // Friend location listener
  useEffect(() => {
    const handler = (e: Event) => {
      const data = (e as CustomEvent<FriendLocation>).detail;
      if (data) updateFriendLocation(data);
    };
    window.addEventListener('rovx:friend-location', handler);
    return () => window.removeEventListener('rovx:friend-location', handler);
  }, [updateFriendLocation]);

  // Real-time report notifications via WebSocket
  useEffect(() => {
    const handler = (e: Event) => {
      const data = (e as CustomEvent).detail;
      if (!data) return;

      // Don't show own reports
      if (data.userId === user?.id) return;

      const typeKey = REPORT_TYPE_KEYS[data.type];
      const label = typeKey ? t('reportPanel.reportTypes.' + typeKey) : data.type;
      const city = data.city ? t('reportPanel.inCity', { city: data.city }) : '';
      const desc = data.description ? `: ${data.description.slice(0, 50)}` : '';

      toast(`⚠️ ${label}${city}${desc}`, {
        duration: 5000,
        style: { background: '#1f2937', color: '#fff', border: '1px solid #374151' },
        icon: '📍',
      });

      // Add report to map if it has coordinates
      if (data.lat && data.lng) {
        addReport({
          id: data.id,
          type: data.type,
          lat: data.lat,
          lng: data.lng,
          severity: data.severity || 3,
          description: data.description || '',
          status: 'ACTIVE',
          createdAt: data.createdAt || new Date().toISOString(),
          userId: data.userId,
          user: { id: data.userId, displayName: 'User', reputation: 0 },
        } as Report);
      }
    };
    window.addEventListener('rovx:report-new', handler);
    return () => window.removeEventListener('rovx:report-new', handler);
  }, [user?.id, addReport, t]);

  // Auto-join city room for notifications
  useEffect(() => {
    if (!user?.city) return;
    joinCity(user.city);
  }, [user?.city, joinCity]);

  // Executes AI Co-Driver voice commands. AiAssistantPanel.tsx dispatches
  // this event after every parsed voice command (navigate home, avoid
  // tolls, switch route type, recalculate, find nearby X) — previously
  // dispatched into the void with no listener anywhere in the app, so the
  // paid AI Co-Driver spoke a confirmation and showed a chat bubble
  // claiming the action happened, then did nothing at all to the map,
  // route, or preferences.
  useEffect(() => {
    const handler = async (e: Event) => {
      const detail = (e as CustomEvent<{ intent?: string; params?: Record<string, any> }>).detail;
      if (!detail?.intent) return;
      const { intent, params = {} } = detail;
      const store = useMapStore.getState();
      const authUser = useAuthStore.getState().user;
      const loc = store.userLocation;

      try {
        switch (intent) {
          case 'navigate_home': {
            if (!authUser?.homeLat || !authUser?.homeLng || !loc) return;
            const origin = store.origin || { ...loc, name: t('searchPanel.myLocation') };
            if (!store.origin) store.setOrigin(origin);
            const destName = authUser.homeAddress || t('searchPanel.home');
            store.setDestination({ lat: authUser.homeLat, lng: authUser.homeLng, name: destName });
            const res = await routesApi.calculate({
              originLat: origin.lat, originLng: origin.lng,
              destLat: authUser.homeLat, destLng: authUser.homeLng,
              routeType: 'FASTEST', vehicleType: store.vehicleMode,
            });
            const route = res.data.data?.[0];
            if (!route) return;
            store.setCalculatedRoutes([route]);
            store.setSelectedRoute(route);
            resetRerouteCooldown();
            store.setNavigation({ isNavigating: true, currentLeg: 0 });
            const trip = await routesApi.startTrip({
              originName: origin.name, originLat: origin.lat, originLng: origin.lng,
              destName, destLat: authUser.homeLat, destLng: authUser.homeLng,
              distance: route.distance, duration: route.duration,
            });
            store.setActiveTrip(trip.data.data.id);
            break;
          }
          case 'find_nearby': {
            if (params.category && !store.activeCategories.includes(params.category)) {
              store.toggleCategory(params.category);
            }
            break;
          }
          case 'update_preference': {
            if (!authUser || !params.preference) return;
            await usersApi.updatePreferences({ [params.preference]: params.value });
            useAuthStore.setState((s) => ({
              preferences: s.preferences ? { ...s.preferences, [params.preference]: params.value } : s.preferences,
            }));
            break;
          }
          case 'change_route': {
            if (!params.routeType) return;
            store.setActiveRouteType(params.routeType);
            // If already navigating, recompute with the new type right away
            // instead of only remembering it for the next time the search
            // panel happens to open.
            if (store.navigation.isNavigating && loc && store.destination) {
              const res = await routesApi.calculate({
                originLat: loc.lat, originLng: loc.lng,
                destLat: store.destination.lat, destLng: store.destination.lng,
                routeType: params.routeType, vehicleType: store.vehicleMode,
              });
              const route = res.data.data?.[0];
              if (route) store.setSelectedRoute(route);
            }
            break;
          }
          case 'recalculate': {
            if (!store.navigation.isNavigating || !loc || !store.destination) return;
            const res = await routesApi.calculate({
              originLat: loc.lat, originLng: loc.lng,
              destLat: store.destination.lat, destLng: store.destination.lng,
              routeType: store.activeRouteType, vehicleType: store.vehicleMode,
            });
            const route = res.data.data?.[0];
            if (route) {
              store.setSelectedRoute(route);
              store.setNavigation({ currentLeg: 0, isOffRoute: false });
              resetRerouteCooldown();
            }
            break;
          }
        }
      } catch { /* voice actions are best-effort — failure is already surfaced via the spoken response */ }
    };
    window.addEventListener('roadpilot:voice-action', handler);
    return () => window.removeEventListener('roadpilot:voice-action', handler);
  }, [t]);

  return (
    <div className="relative w-full h-screen overflow-hidden bg-dark-bg" style={{ isolation: 'isolate' }}>
      <MapView />

      {isNavigating && <NavigationHUD />}

      {!isNavigating && <TopBar />}

      {!isNavigating && <BottomBar />}

      {isSearchOpen && <SearchPanel />}
      {isRoutesPanelOpen && <RoutePanel />}
      {selectedObject && <ObjectDetailPanel />}
      {isReportPanelOpen && <ReportPanel />}
      {isSidebarOpen && <Sidebar />}

    </div>
  );
}
