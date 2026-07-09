'use client';
import { useEffect, useRef, useCallback } from 'react';
import { useMapStore } from '@/store/map.store';

const SPEED_SMOOTHING_ALPHA = 0.35;
const SMOOTHED_SPEED_KEY = 'rovx_smoothedSpeed';
const AUTO_FOLLOW_SPEED_THRESHOLD = 10; // km/h

function getInitialSmoothedSpeed(): number {
  if (typeof window === 'undefined') return 0;
  const stored = sessionStorage.getItem(SMOOTHED_SPEED_KEY);
  return stored ? parseFloat(stored) : 0;
}

function setSmoothedSpeed(v: number) {
  if (typeof window === 'undefined') return;
  sessionStorage.setItem(SMOOTHED_SPEED_KEY, v.toString());
}

export function useGeolocation() {
  const watchIdRef = useRef<number | null>(null);
  const lastUpdateRef = useRef(0);
  const smoothSpeedRef = useRef(getInitialSmoothedSpeed());
  const { setUserLocation, setLocationError, followUser, setMapCenter, navigation, setFollowUser } = useMapStore();
  const followUserRef = useRef(followUser);
  followUserRef.current = followUser;
  const navRef = useRef(navigation);
  navRef.current = navigation;

  const startWatching = useCallback(() => {
    if (!navigator.geolocation) {
      setLocationError('Geolocation is not supported by your browser');
      return;
    }

    const options: PositionOptions = {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 3000,
    };

    watchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        const now = Date.now();
        if (now - lastUpdateRef.current < 1000) return;
        lastUpdateRef.current = now;

        const { latitude, longitude, speed, heading } = position.coords;
        const coords = { lat: latitude, lng: longitude };

        const rawSpeed = speed != null ? speed * 3.6 : 0;
        if (rawSpeed > 0) {
          smoothSpeedRef.current = SPEED_SMOOTHING_ALPHA * rawSpeed + (1 - SPEED_SMOOTHING_ALPHA) * smoothSpeedRef.current;
        } else {
          smoothSpeedRef.current = smoothSpeedRef.current * 0.95;
          if (smoothSpeedRef.current < 1) smoothSpeedRef.current = 0;
        }
        setSmoothedSpeed(smoothSpeedRef.current);

        setUserLocation(
          coords,
          heading ?? 0,
          smoothSpeedRef.current,
        );

        if (followUserRef.current) {
          setMapCenter(coords);
        }

        // Auto-follow: during navigation, re-enable follow when moving
        if (navRef.current.isNavigating && smoothSpeedRef.current > AUTO_FOLLOW_SPEED_THRESHOLD && !followUserRef.current) {
          setFollowUser(true);
        }
      },
      (error) => {
        switch (error.code) {
          case error.PERMISSION_DENIED:
            setLocationError('Location permission denied');
            break;
          case error.POSITION_UNAVAILABLE:
            setLocationError('Location unavailable');
            break;
          case error.TIMEOUT:
            setLocationError('Location request timed out');
            break;
        }
      },
      options,
    );
  }, [setUserLocation, setLocationError]);

  const stopWatching = useCallback(() => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
  }, []);

  const getOnce = useCallback(() => {
    return new Promise<GeolocationPosition>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 10000,
      });
    });
  }, []);

  useEffect(() => {
    startWatching();
    return stopWatching;
  }, [startWatching, stopWatching]);

  return { startWatching, stopWatching, getOnce };
}
