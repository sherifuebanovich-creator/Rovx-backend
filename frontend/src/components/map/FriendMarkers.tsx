'use client';
import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import { useMapStore } from '@/store/map.store';
import { useAuthStore } from '@/store/auth.store';
import { friendsApi } from '@/lib/api';
import { FriendLocation } from '@/types';

interface Props {
  map: maplibregl.Map | null;
}

const STALE_MS = 5 * 60 * 1000;
const PREMIUM_TIERS = ['PREMIUM_STANDARD', 'PREMIUM_MAX'];

function escapeHtml(text: string): string {
  const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return text.replace(/[&<>"']/g, (c) => map[c]);
}

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

export default function FriendMarkers({ map }: Props) {
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

    fetchLocations();
    refreshTimerRef.current = setInterval(fetchLocations, 15000);
    return () => clearInterval(refreshTimerRef.current);
  }, [map, user, hasPremium, setFriendLocations]);

  useEffect(() => {
    if (!map || !hasPremium) return;

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
          .setHTML(`<div style="padding:4px 8px;font-size:12px;font-weight:600;white-space:nowrap;">${escapeHtml(loc.displayName)}</div>`);

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
