'use client';
import { useEffect, useRef, useCallback, useState } from 'react';
import { useMapStore } from '@/store/map.store';
import { haversineDist } from '@/lib/geo';

const SPEED_SMOOTHING_ALPHA = 0.35;
const SMOOTHED_SPEED_KEY = 'rovx_smoothedSpeed';
const AUTO_FOLLOW_SPEED_THRESHOLD = 10;
const POSITION_THROTTLE_MS = 200;
const MAX_PLAUSIBLE_SPEED_KMH = 250;

interface LocationState {
  lat: number;
  lng: number;
  accuracy: number;
  heading: number;
  speed: number;
  timestamp: number;
}

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
  const lastFixRef = useRef<{ lat: number; lng: number; time: number } | null>(null);
  const deviceHeadingRef = useRef<number | null>(null);
  const isActiveRef = useRef(true);
  const [location, setLocation] = useState<LocationState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [permissionState, setPermissionState] = useState<'prompt' | 'granted' | 'denied' | 'unavailable'>('prompt');

  const { setUserLocation, setLocationError, followUser, setMapCenter, navigation, setFollowUser } = useMapStore();
  const followUserRef = useRef(followUser);
  followUserRef.current = followUser;
  const navRef = useRef(navigation);
  navRef.current = navigation;

  const processPosition = useCallback((position: GeolocationPosition) => {
    if (!isActiveRef.current) return;

    const now = Date.now();
    if (now - lastUpdateRef.current < POSITION_THROTTLE_MS) return;
    lastUpdateRef.current = now;

    const { latitude, longitude, speed, heading, accuracy } = position.coords;

    // Device-reported speed is frequently null/0 between fixes on many
    // browsers, which used to make the readout decay to 0 and "freeze"
    // even while still moving. Fall back to a distance/time derivation
    // from the last fix so the value keeps tracking real motion.
    let rawSpeed: number;
    if (speed != null && speed >= 0) {
      rawSpeed = speed * 3.6;
    } else {
      const last = lastFixRef.current;
      const dtSec = last ? (position.timestamp - last.time) / 1000 : 0;
      if (last && dtSec > 0.1) {
        const distMeters = haversineDist(last.lat, last.lng, latitude, longitude);
        rawSpeed = (distMeters / dtSec) * 3.6;
      } else {
        rawSpeed = smoothSpeedRef.current;
      }
    }
    rawSpeed = Math.min(Math.max(rawSpeed, 0), MAX_PLAUSIBLE_SPEED_KMH);
    lastFixRef.current = { lat: latitude, lng: longitude, time: position.timestamp };

    smoothSpeedRef.current = SPEED_SMOOTHING_ALPHA * rawSpeed + (1 - SPEED_SMOOTHING_ALPHA) * smoothSpeedRef.current;
    if (smoothSpeedRef.current < 1) smoothSpeedRef.current = 0;
    setSmoothedSpeed(smoothSpeedRef.current);

    let resolvedHeading = heading ?? 0;
    if ((heading == null || isNaN(heading)) && deviceHeadingRef.current != null) {
      resolvedHeading = deviceHeadingRef.current;
    }

    const loc: LocationState = {
      lat: latitude,
      lng: longitude,
      accuracy: accuracy || 0,
      heading: resolvedHeading,
      speed: smoothSpeedRef.current,
      timestamp: position.timestamp,
    };

    setLocation(loc);
    setUserLocation({ lat: latitude, lng: longitude }, resolvedHeading, smoothSpeedRef.current, accuracy || 0, position.timestamp);

    if (followUserRef.current) {
      setMapCenter({ lat: latitude, lng: longitude });
    }

    if (navRef.current.isNavigating && smoothSpeedRef.current > AUTO_FOLLOW_SPEED_THRESHOLD && !followUserRef.current) {
      setFollowUser(true);
    }
  }, [setUserLocation, setLocationError, setMapCenter, setFollowUser]);

  const handleError = useCallback((error: GeolocationPositionError) => {
    switch (error.code) {
      case error.PERMISSION_DENIED:
        setError('Location permission denied. Please enable in browser settings.');
        setLocationError('Location permission denied');
        setPermissionState('denied');
        break;
      case error.POSITION_UNAVAILABLE:
        setError('Location unavailable. Ensure GPS is enabled.');
        setLocationError('Location unavailable');
        setPermissionState('unavailable');
        break;
      case error.TIMEOUT:
        setError('Location request timed out. Retrying...');
        setLocationError('Location request timed out');
        break;
    }
  }, [setLocationError]);

  const startWatching = useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setError('Geolocation is not supported by your browser');
      setLocationError('Geolocation not supported');
      return;
    }

    const options: PositionOptions = {
      enableHighAccuracy: true,
      maximumAge: 500,
      timeout: 10000,
    };

    watchIdRef.current = navigator.geolocation.watchPosition(processPosition, handleError, options);
  }, [processPosition, handleError]);

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
    if (typeof navigator === 'undefined') return;

    startWatching();

    const onVisibilityChange = () => {
      if (document.hidden) {
        isActiveRef.current = false;
        stopWatching();
      } else {
        isActiveRef.current = true;
        startWatching();
      }
    };

    document.addEventListener('visibilitychange', onVisibilityChange);

    const onDeviceOrientation = (e: DeviceOrientationEvent) => {
      const heading = (e as any).webkitCompassHeading ?? (e.alpha != null ? (360 - e.alpha) : null);
      if (heading != null && !isNaN(heading)) {
        deviceHeadingRef.current = heading;
      }
    };

    if (typeof DeviceOrientationEvent !== 'undefined' && typeof (DeviceOrientationEvent as any).requestPermission === 'function') {
      (DeviceOrientationEvent as any).requestPermission()
        .then((state: string) => {
          if (state === 'granted') {
            window.addEventListener('deviceorientation', onDeviceOrientation, true);
          }
        })
        .catch(() => {});
    } else {
      window.addEventListener('deviceorientation', onDeviceOrientation, true);
    }

    let permissionResult: PermissionStatus | null = null;
    const onPermChange = () => {
      if (permissionResult) setPermissionState(permissionResult.state as any);
    };

    if (navigator.permissions) {
      navigator.permissions.query({ name: 'geolocation' }).then((result) => {
        permissionResult = result;
        setPermissionState(result.state as any);
        result.addEventListener('change', onPermChange);
      }).catch(() => {});
    }

    return () => {
      stopWatching();
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('deviceorientation', onDeviceOrientation, true);
      if (permissionResult) {
        permissionResult.removeEventListener('change', onPermChange);
      }
    };
  }, [startWatching, stopWatching]);

  return { location, error, permissionState, startWatching, stopWatching, getOnce };
}
