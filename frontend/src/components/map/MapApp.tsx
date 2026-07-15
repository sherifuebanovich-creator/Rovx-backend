'use client';
import dynamic from 'next/dynamic';
import { useEffect } from 'react';
import { useMapStore } from '@/store/map.store';
import { useAuthStore } from '@/store/auth.store';
import { useGeolocation } from '@/hooks/useGeolocation';
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

const MapView = dynamic(() => import('@/components/map/MapViewGL'), { ssr: false });

const REPORT_TYPE_LABELS: Record<string, string> = {
  ACCIDENT: 'Авария',
  ROAD_CLOSURE: 'Перекрытие',
  ROAD_WORKS: 'Дор. работы',
  TRAFFIC_JAM: 'Пробка',
  ICE: 'Гололёд',
  FOG: 'Туман',
  FLOODING: 'Наводнение',
  POLICE: 'Полиция',
  POTHOLE: 'Яма',
  BAD_ROAD: 'Плохая дорога',
  STRONG_WIND: 'Ветер',
  HAZARD: 'Опасность',
  SPEED_CAMERA: 'Камера',
};

export default function MapApp() {
  const isSearchOpen = useMapStore(s => s.isSearchOpen);
  const isRoutesPanelOpen = useMapStore(s => s.isRoutesPanelOpen);
  const isSidebarOpen = useMapStore(s => s.isSidebarOpen);
  const selectedObject = useMapStore(s => s.selectedObject);
  const isReportPanelOpen = useMapStore(s => s.isReportPanelOpen);
  const navigation = useMapStore(s => s.navigation);
  const updateFriendLocation = useMapStore(s => s.updateFriendLocation);
  const addReport = useMapStore(s => s.addReport);

  const { user } = useAuthStore();
  useGeolocation();

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

      const label = REPORT_TYPE_LABELS[data.type] || data.type;
      const city = data.city ? ` в ${data.city}` : '';
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
  }, [user?.id, addReport]);

  // Auto-join city room for notifications
  useEffect(() => {
    if (!user?.city) return;
    const { joinCity } = require('@/hooks/useSocket').useSocket();
    // joinCity is stable from useCallback
  }, [user?.city]);

  return (
    <div className="relative w-full h-screen overflow-hidden bg-dark-bg" style={{ isolation: 'isolate' }}>
      <MapView />

      {navigation.isNavigating && <NavigationHUD />}

      {!navigation.isNavigating && <TopBar />}

      {!navigation.isNavigating && <BottomBar />}

      {isSearchOpen && <SearchPanel />}
      {isRoutesPanelOpen && <RoutePanel />}
      {selectedObject && <ObjectDetailPanel />}
      {isReportPanelOpen && <ReportPanel />}
      {isSidebarOpen && <Sidebar />}
      <VoiceChat />


    </div>
  );
}
