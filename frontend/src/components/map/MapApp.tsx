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
import VoiceChat from '@/components/chat/VoiceChat';
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
      <VoiceChat />


    </div>
  );
}
