'use client';
import { useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import Cookies from 'js-cookie';
import { useMapStore } from '@/store/map.store';

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'http://localhost:3001';

let socketInstance: Socket | null = null;
// Socket.IO assigns a fresh server-side session on every reconnect, so any
// previously joined rooms (e.g. the user's city) are silently dropped by the
// server. Track the last city joined so it can be rejoined automatically
// whenever the socket (re)connects, instead of only on the initial mount.
let lastJoinedCity: string | null = null;
// The token the current socketInstance was last (re)connected with — a
// mutable module-level value rather than a captured `const` so the
// mismatch check below doesn't need a new closure (and therefore a whole
// new Socket object, see the 'connect' handler) every time it updates.
let currentToken: string | null = null;

export function useSocket() {
  const socketRef = useRef<Socket | null>(null);
  const userLocationLat = useMapStore(s => s.userLocation?.lat);
  const userLocationLng = useMapStore(s => s.userLocation?.lng);

  const connect = useCallback(() => {
    const token = Cookies.get('access_token');
    if (!token) return null;
    // Reuse the existing socket whether it's already connected or still
    // mid-handshake — tearing down an in-flight connection here just
    // because a second consumer mounted around the same time restarts the
    // handshake and drops any events that arrived in that window. A token
    // change after connection is handled separately in the 'connect' handler below.
    if (socketInstance) {
      socketRef.current = socketInstance;
      return socketInstance;
    }

    currentToken = token;
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
      if (latestToken && latestToken !== currentToken) {
        const now = Date.now();
        const lastReconnect = (connect as any).__lastReconnect || 0;
        if (now - lastReconnect < 3000) return;
        (connect as any).__lastReconnect = now;
        currentToken = latestToken;
        // Was: removeAllListeners() + disconnect() + null out socketInstance
        // + recurse into connect() to build a brand-new Socket object. Every
        // consumer that called getSocket() once and attached listeners
        // directly to that object (groups/[id]/page.tsx, TopBar.tsx,
        // notifications/page.tsx) kept a reference to the now-discarded old
        // instance and never found out a new one existed — they silently
        // stopped receiving events until their own effect happened to
        // re-run for an unrelated reason (e.g. navigating away and back).
        // Updating auth and reconnecting the SAME instance keeps every
        // existing listener (this hook's own, and every consumer's) intact,
        // since they're attached to an object reference that never changes.
        if (socketInstance) {
          socketInstance.auth = { token: latestToken };
          socketInstance.disconnect().connect();
        }
        return;
      }
      if (lastJoinedCity) {
        socketInstance?.emit('city:join', { city: lastJoinedCity });
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

    socketInstance.on('friend:location', (data: any) => {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('rovx:friend-location', { detail: data }));
      }
    });

    socketInstance.on('friend:request', (data: any) => {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('rovx:friend-request', { detail: data }));
      }
    });

    socketInstance.on('friend:accepted', (data: any) => {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('rovx:friend-accepted', { detail: data }));
      }
    });

    socketInstance.on('report:new', (data: any) => {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('rovx:report-new', { detail: data }));
      }
    });

    socketInstance.on('voice:call', (data: any) => {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('rovx:voice-call', { detail: data }));
      }
    });

    socketInstance.on('voice:signal', (data: any) => {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('rovx:voice-signal', { detail: data }));
      }
    });

    socketInstance.on('voice:end', (data: any) => {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('rovx:voice-end', { detail: data }));
      }
    });

    socketRef.current = socketInstance;
    return socketInstance;
  }, []);

  const disconnect = useCallback(() => {
    lastJoinedCity = null;
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
    lastJoinedCity = city;
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

  const sendVoiceCall = useCallback((targetUserId: string, callerName: string) => {
    socketInstance?.emit('voice:call', { targetUserId, callerName });
  }, []);

  const sendVoiceSignal = useCallback((targetUserId: string, signal: any) => {
    socketInstance?.emit('voice:signal', { targetUserId, signal });
  }, []);

  const endVoiceCall = useCallback((targetUserId: string) => {
    socketInstance?.emit('voice:end', { targetUserId });
  }, []);

  return { connect, disconnect, socket: socketRef, updateLocation, sendMessage, joinGroup, joinCity, sendCityMessage, sendVoiceCall, sendVoiceSignal, endVoiceCall };
}

export function getSocket(): Socket | null {
  return socketInstance;
}
