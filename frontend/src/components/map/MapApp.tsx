'use client';
import dynamic from 'next/dynamic';
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

const MapView = dynamic(() => import('@/components/map/MapViewGL'), { ssr: false });

export default function MapApp() {
  const isSearchOpen = useMapStore(s => s.isSearchOpen);
  const isRoutesPanelOpen = useMapStore(s => s.isRoutesPanelOpen);
  const isSidebarOpen = useMapStore(s => s.isSidebarOpen);
  const selectedObject = useMapStore(s => s.selectedObject);
  const isReportPanelOpen = useMapStore(s => s.isReportPanelOpen);
  const navigation = useMapStore(s => s.navigation);
  const setFollowUser = useMapStore(s => s.setFollowUser);
  const userLocation = useMapStore(s => s.userLocation);

  const { user } = useAuthStore();
  useGeolocation();

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

      {userLocation && !navigation.isNavigating && (
        <button
          onClick={() => setFollowUser(true)}
          className="absolute right-4 bottom-28 z-40 w-10 h-10 rounded-xl bg-dark-card/90 backdrop-blur border border-dark-border
                     flex items-center justify-center shadow-lg hover:bg-dark-card transition-all"
          title="Центрировать на мне"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0ea5e9" strokeWidth="2"
               strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
          </svg>
        </button>
      )}
    </div>
  );
}
