'use client';
import { useEffect, useRef, memo } from 'react';
import maplibregl from 'maplibre-gl';
import { useMapStore } from '@/store/map.store';
import { useAuthStore } from '@/store/auth.store';
import { friendsApi } from '@/lib/api';
import { FriendLocation } from '@/types';
import { escapeAttr } from '@/lib/maplibreIcons';

interface Props {
  map: maplibregl.Map | null;
}

const STALE_MS = 5 * 60 * 1000;

// A plain green dot, not an avatar — the name only appears on hover, not
// as a permanently-visible label, so a screenful of online friends doesn't
// turn into a wall of text.
function createMarkerEl(): HTMLElement {
  const el = document.createElement('div');
  el.style.cssText = `
    width:14px;height:14px;border-radius:50%;
    background:#22c55e;
    border:2px solid #fff;
    box-shadow:0 0 0 2px rgba(34,197,94,0.35),0 1px 4px rgba(0,0,0,0.4);
  `;
  return el;
}

function FriendMarkers({ map }: Props) {
  const friendLocations = useMapStore((s) => s.friendLocations);
  const setFriendLocations = useMapStore((s) => s.setFriendLocations);
  const user = useAuthStore((s) => s.user);
  const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
  const refreshTimerRef = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => {
    if (!map || !user) return;

    const fetchLocations = async () => {
      try {
        const res = await friendsApi.getLocations();
        const data = res.data?.data || res.data || [];
        setFriendLocations(data);
      } catch { /* transient network error, next poll retries */ }
    };

    // Every other poller in this codebase is moveend/zoomend/style-event
    // driven and only fires while the tab is actually visible; this was the
    // one flat setInterval that kept firing on a fixed cadence even while
    // backgrounded, matching the visibility-pause pattern useGeolocation.ts
    // already uses for its own watch.
    const startInterval = () => {
      clearInterval(refreshTimerRef.current);
      refreshTimerRef.current = setInterval(fetchLocations, 15000);
    };
    const onVisibilityChange = () => {
      if (document.hidden) {
        clearInterval(refreshTimerRef.current);
      } else {
        fetchLocations();
        startInterval();
      }
    };

    fetchLocations();
    startInterval();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      clearInterval(refreshTimerRef.current);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [map, user, setFriendLocations]);

  useEffect(() => {
    if (!map) return;

    for (const [userId, marker] of markersRef.current) {
      const loc = friendLocations.find((f) => f.userId === userId);
      if (!loc || Date.now() - loc.updatedAt > STALE_MS) {
        marker.remove();
        markersRef.current.delete(userId);
      }
    }

    for (const loc of friendLocations) {
      if (Date.now() - loc.updatedAt > STALE_MS) continue;

      const existing = markersRef.current.get(loc.userId);
      if (existing) {
        existing.setLngLat([loc.lng, loc.lat]);
      } else {
        const el = createMarkerEl();
        // Hover, not click — a click-to-open popup meant the name was
        // hidden behind an extra tap; a small dot with a name that only
        // needs a glance should show it the same way a native map pin's
        // tooltip does.
        const popup = new maplibregl.Popup({ closeButton: false, offset: 14, className: 'friend-popup' })
          .setHTML(`<div style="padding:4px 8px;font-size:12px;font-weight:600;white-space:nowrap;">${escapeAttr(loc.displayName)}</div>`);
        el.addEventListener('mouseenter', () => popup.setLngLat([loc.lng, loc.lat]).addTo(map));
        el.addEventListener('mouseleave', () => popup.remove());

        const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
          .setLngLat([loc.lng, loc.lat])
          .addTo(map);
        markersRef.current.set(loc.userId, marker);
      }
    }
  }, [map, friendLocations]);

  useEffect(() => {
    if (!map) return;
    return () => {
      for (const marker of markersRef.current.values()) {
        marker.remove();
      }
      markersRef.current.clear();
    };
  }, [map]);

  return null;
}

export default memo(FriendMarkers);
