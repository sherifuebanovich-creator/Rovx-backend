'use client';
import { useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import Cookies from 'js-cookie';
import { useMapStore } from '@/store/map.store';

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'http://localhost:3001';

let socketInstance: Socket | null = null;

export function useSocket() {
  const socketRef = useRef<Socket | null>(null);
  const userLocationLat = useMapStore(s => s.userLocation?.lat);
  const userLocationLng = useMapStore(s => s.userLocation?.lng);

  const connect = useCallback(() => {
    const token = Cookies.get('access_token');
    if (!token) return null;
    if (socketInstance?.connected) return socketInstance;

    if (socketInstance) {
      socketInstance.removeAllListeners();
      socketInstance.disconnect();
      socketInstance = null;
    }

    socketInstance = io(WS_URL, {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });

    socketInstance.on('connect', () => {
      const latestToken = Cookies.get('access_token');
      if (latestToken && latestToken !== token) {
        socketInstance?.removeAllListeners();
        socketInstance?.disconnect();
        socketInstance = null;
        socketRef.current = null;
        connect();
        return;
      }
    });

    socketInstance.on('message:received', (message: any) => {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('rovx:message', { detail: message }));
      }
    });

    socketInstance.on('city:message', (message: any) => {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('rovx:city-message', { detail: message }));
      }
    });

    socketInstance.on('convoy:location', (data: any) => {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('rovx:convoy-location', { detail: data }));
      }
    });

    socketInstance.on('sos:alert', (data: any) => {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('rovx:sos-alert', { detail: data }));
      }
    });

    socketInstance.on('group:typing', (data: any) => {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('rovx:group-typing', { detail: data }));
      }
    });

    socketInstance.on('group:updated', (data: any) => {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('rovx:group-updated', { detail: data }));
      }
    });

    socketInstance.on('notification:new', (data: any) => {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('rovx:notification', { detail: data }));
      }
    });

    socketRef.current = socketInstance;
    return socketInstance;
  }, []);

  const disconnect = useCallback(() => {
    if (socketInstance) {
      socketInstance.removeAllListeners();
      socketInstance.disconnect();
      socketInstance = null;
      socketRef.current = null;
    }
  }, []);

  const updateLocation = useCallback(
    (lat: number, lng: number, speed?: number, heading?: number) => {
      socketInstance?.emit('location:update', { lat, lng, speed, heading });
    },
    [],
  );

  const subscribeToArea = useCallback((lat: number, lng: number) => {
    socketInstance?.emit('subscribe:area', { lat, lng, radius: 20 });
  }, []);

  const sendMessage = useCallback((receiverId: string, content: string) => {
    return new Promise((resolve, reject) => {
      if (!socketInstance?.connected) {
        reject(new Error('Not connected'));
        return;
      }
      socketInstance.emit('message:send', { receiverId, content }, (response: any) => {
        if (response?.error) reject(response.error);
        else resolve(response);
      });
    });
  }, []);

  const joinGroup = useCallback((groupId: string) => {
    socketInstance?.emit('join:group', { groupId });
  }, []);

  const joinCity = useCallback((city: string) => {
    socketInstance?.emit('city:join', { city });
  }, []);

  const sendCityMessage = useCallback((city: string, content: string) => {
    return new Promise((resolve, reject) => {
      if (!socketInstance?.connected) {
        reject(new Error('Not connected'));
        return;
      }
      socketInstance.emit('city:message', { city, content }, (response: any) => {
        if (response?.error) reject(response.error);
        else resolve(response);
      });
    });
  }, []);

  useEffect(() => {
    return () => {
      // Don't disconnect on component unmount - keep global socket alive
    };
  }, []);

  // Update location to server (throttled)
  const lastSocketUpdateRef = useRef(0);
  useEffect(() => {
    if (userLocationLat == null || userLocationLng == null || !socketInstance?.connected) return;
    const now = Date.now();
    if (now - lastSocketUpdateRef.current < 5000) return;
    lastSocketUpdateRef.current = now;
    updateLocation(userLocationLat, userLocationLng);
    subscribeToArea(userLocationLat, userLocationLng);
  }, [userLocationLat, userLocationLng, updateLocation, subscribeToArea]);

  return { connect, disconnect, socket: socketRef, updateLocation, sendMessage, joinGroup, joinCity, sendCityMessage };
}

export function getSocket(): Socket | null {
  return socketInstance;
}
