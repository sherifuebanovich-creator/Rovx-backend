'use client';
import { useEffect, useRef, useState, memo } from 'react';
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
const PREMIUM_TIERS = ['PREMIUM_STANDARD', 'PREMIUM_MAX'];

function createMarkerEl(displayName: string): HTMLElement {
  const el = document.createElement('div');
  el.style.cssText = 'position:relative;cursor:pointer;';
  el.innerHTML = `
    <div style="
      width:32px;height:32px;border-radius:50%;
      background:linear-gradient(135deg,#22c55e,#16a34a);
      border:2.5px solid #fff;
      display:flex;align-items:center;justify-content:center;
      color:#fff;font-weight:700;font-size:13px;
      font-family:system-ui,sans-serif;
      box-shadow:0 2px 8px rgba(0,0,0,0.3);
      line-height:1;
    ">${(displayName?.[0] ?? '?').toUpperCase()}</div>
  `;
  return el;
}

function FriendMarkers({ map }: Props) {
  const friendLocations = useMapStore((s) => s.friendLocations);
  const setFriendLocations = useMapStore((s) => s.setFriendLocations);
  const user = useAuthStore((s) => s.user);
  const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
  const refreshTimerRef = useRef<ReturnType<typeof setInterval>>();
  const [hasPremium, setHasPremium] = useState(false);

  useEffect(() => {
    if (!user) {
      setHasPremium(false);
      return;
    }
    setHasPremium(PREMIUM_TIERS.includes(user.subscription));
  }, [user]);

  useEffect(() => {
    if (!map || !user || !hasPremium) return;

    const fetchLocations = async () => {
      try {
        const res = await friendsApi.getLocations();
        const data = res.data?.data || res.data || [];
        setFriendLocations(data);
      } catch { /* 403 if no premium, ignore */ }
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
  }, [map, user, hasPremium, setFriendLocations]);

  useEffect(() => {
    if (!map) return;

    // Must run even when hasPremium is false — a mid-session downgrade
    // (subscription expires/is cancelled while friend markers are already
    // on screen) previously left every existing DOM marker behind forever,
    // since this whole effect used to bail out before ever reaching the
    // removal loop below.
    if (!hasPremium) {
      for (const marker of markersRef.current.values()) marker.remove();
      markersRef.current.clear();
      return;
    }

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
        const el = createMarkerEl(loc.displayName);
        const popup = new maplibregl.Popup({ closeButton: false, offset: 20, className: 'friend-popup' })
          .setHTML(`<div style="padding:4px 8px;font-size:12px;font-weight:600;white-space:nowrap;">${escapeAttr(loc.displayName)}</div>`);

        const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
          .setLngLat([loc.lng, loc.lat])
          .setPopup(popup)
          .addTo(map);
        markersRef.current.set(loc.userId, marker);
      }
    }
  }, [map, friendLocations, hasPremium]);

  useEffect(() => {
    if (!map) return;
    return () => {
      for (const marker of markersRef.current.values()) {
        marker.remove();
      }
      markersRef.current.clear();
    };
  }, [map]);

  if (!hasPremium) return null;
  return null;
}

export default memo(FriendMarkers);
