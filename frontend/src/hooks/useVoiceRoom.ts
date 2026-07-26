'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import Cookies from 'js-cookie';
import { voiceRoomsApi } from '@/lib/api';

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'http://localhost:3001';

export interface VoiceRoomParticipant {
  socketId: string;
  userId: string;
  displayName: string;
  avatar?: string | null;
  micEnabled: boolean;
  isSpeaking: boolean;
  joinedAt: number;
}

export type VoiceRoomConnectionState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'error';

interface PeerEntry {
  pc: RTCPeerConnection;
  audioEl: HTMLAudioElement;
  pendingCandidates: RTCIceCandidateInit[];
}

// A brand-new participant always initiates the offer to every existing
// member (existing members only ever answer). This one-directional rule
// is what avoids two peers creating simultaneous offers to each other
// ("glare") without needing a full perfect-negotiation implementation —
// deliberately simple given the mesh stays small (a room's worth of
// participants, not hundreds).
export function useVoiceRoom() {
  const [connectionState, setConnectionState] = useState<VoiceRoomConnectionState>('idle');
  const [participants, setParticipants] = useState<VoiceRoomParticipant[]>([]);
  const [selfMicEnabled, setSelfMicEnabled] = useState(false);
  const [selfSpeaking, setSelfSpeaking] = useState(false);
  const [volume, setVolumeState] = useState(1);
  const [error, setError] = useState<string | null>(null);

  const socketRef = useRef<Socket | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef<Map<string, PeerEntry>>(new Map());
  const iceServersRef = useRef<RTCIceServer[]>([{ urls: 'stun:stun.l.google.com:19302' }]);
  const currentRoomIdRef = useRef<string | null>(null);
  // Tracks whether the initial room:join for this session has already
  // completed, so the socket's 'connect' handler (fired for the *first*
  // connect too, not just reconnects) can tell the two apart without
  // relying on `connectionState` — a value it would otherwise read through
  // a stale closure captured when the handler was registered.
  const hasJoinedOnceRef = useRef(false);
  const micEnabledRef = useRef(false);
  const volumeRef = useRef(1);
  const mountedRef = useRef(true);
  // A locally-generated id (not the socket.io socket id, which changes on
  // every reconnect) so the UI can tell "that's me" apart from remote
  // participants across a reconnect without special-casing socket ids.
  const selfSocketIdRef = useRef<string | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const applyVolumeToAll = useCallback((v: number) => {
    peersRef.current.forEach((entry) => { entry.audioEl.volume = v; });
  }, []);

  const setVolume = useCallback((v: number) => {
    const clamped = Math.min(1, Math.max(0, v));
    volumeRef.current = clamped;
    setVolumeState(clamped);
    applyVolumeToAll(clamped);
  }, [applyVolumeToAll]);

  const createPeerConnection = useCallback((targetSocketId: string): PeerEntry => {
    const pc = new RTCPeerConnection({ iceServers: iceServersRef.current });
    const audioEl = document.createElement('audio');
    audioEl.autoplay = true;
    // Not appended to the DOM — audio plays fine from a detached element as
    // long as it stays referenced (kept alive via the peersRef map), and
    // keeping it out of the tree means it can never interact with page
    // layout/existing styling.
    audioEl.volume = volumeRef.current;

    localStreamRef.current?.getTracks().forEach((track) => {
      pc.addTrack(track, localStreamRef.current!);
    });

    pc.ontrack = (event) => {
      audioEl.srcObject = event.streams[0];
      audioEl.play().catch(() => {});
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socketRef.current?.emit('webrtc:ice-candidate', {
          targetSocketId,
          candidate: event.candidate.toJSON(),
        });
      }
    };

    // ICE restart is tried first on a drop — much cheaper than tearing the
    // whole connection down, and recovers a brief network blip (e.g. a
    // driver's phone switching between cell towers) without an audible
    // rejoin. Only a restart that doesn't recover in time, or an outright
    // 'failed' state, results in the peer being dropped (the periodic
    // room:join-driven re-mesh, or the next signal from that peer, rebuilds
    // it from scratch).
    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === 'disconnected') {
        setTimeout(() => {
          if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed') {
            try { pc.restartIce(); } catch {}
          }
        }, 1500);
      } else if (pc.iceConnectionState === 'failed') {
        try { pc.restartIce(); } catch {}
      } else if (pc.iceConnectionState === 'closed') {
        peersRef.current.delete(targetSocketId);
      }
    };

    const entry: PeerEntry = { pc, audioEl, pendingCandidates: [] };
    peersRef.current.set(targetSocketId, entry);
    return entry;
  }, []);

  const closePeer = useCallback((socketId: string) => {
    const entry = peersRef.current.get(socketId);
    if (!entry) return;
    entry.pc.close();
    entry.audioEl.srcObject = null;
    peersRef.current.delete(socketId);
  }, []);

  const closeAllPeers = useCallback(() => {
    peersRef.current.forEach((_, socketId) => closePeer(socketId));
    peersRef.current.clear();
  }, [closePeer]);

  const applyRemoteCandidates = useCallback(async (entry: PeerEntry) => {
    while (entry.pendingCandidates.length > 0) {
      const candidate = entry.pendingCandidates.shift()!;
      try { await entry.pc.addIceCandidate(candidate); } catch {}
    }
  }, []);

  const setupSignalingHandlers = useCallback((socket: Socket) => {
    socket.on('room:user-joined', (participant: VoiceRoomParticipant) => {
      setParticipants((prev) => [...prev.filter((p) => p.socketId !== participant.socketId), participant]);
    });

    socket.on('room:user-left', ({ socketId }: { socketId: string }) => {
      closePeer(socketId);
      setParticipants((prev) => prev.filter((p) => p.socketId !== socketId));
    });

    socket.on('room:user-speaking', ({ socketId, isSpeaking }: { socketId: string; isSpeaking: boolean }) => {
      setParticipants((prev) => prev.map((p) => (p.socketId === socketId ? { ...p, isSpeaking } : p)));
    });

    socket.on('room:user-mic-state', ({ socketId, micEnabled }: { socketId: string; micEnabled: boolean }) => {
      setParticipants((prev) => prev.map((p) => (p.socketId === socketId ? { ...p, micEnabled } : p)));
    });

    socket.on('webrtc:offer', async ({ fromSocketId, sdp }: { fromSocketId: string; sdp: RTCSessionDescriptionInit }) => {
      const entry = peersRef.current.get(fromSocketId) ?? createPeerConnection(fromSocketId);
      await entry.pc.setRemoteDescription(sdp);
      await applyRemoteCandidates(entry);
      const answer = await entry.pc.createAnswer();
      await entry.pc.setLocalDescription(answer);
      socket.emit('webrtc:answer', { targetSocketId: fromSocketId, sdp: answer });
    });

    socket.on('webrtc:answer', async ({ fromSocketId, sdp }: { fromSocketId: string; sdp: RTCSessionDescriptionInit }) => {
      const entry = peersRef.current.get(fromSocketId);
      if (!entry) return;
      await entry.pc.setRemoteDescription(sdp);
      await applyRemoteCandidates(entry);
    });

    socket.on('webrtc:ice-candidate', async ({ fromSocketId, candidate }: { fromSocketId: string; candidate: RTCIceCandidateInit }) => {
      const entry = peersRef.current.get(fromSocketId);
      if (!entry) return;
      if (entry.pc.remoteDescription) {
        try { await entry.pc.addIceCandidate(candidate); } catch {}
      } else {
        entry.pendingCandidates.push(candidate);
      }
    });
  }, [applyRemoteCandidates, closePeer, createPeerConnection]);

  const rejoinCurrentRoom = useCallback(async (socket: Socket) => {
    const roomId = currentRoomIdRef.current;
    if (!roomId) return;
    closeAllPeers();
    const ack = await socket.timeout(10000).emitWithAck('room:join', { roomId }).catch(() => null);
    if (!ack || ack.error) {
      setError(ack?.error || 'Failed to rejoin voice room');
      setConnectionState('error');
      return;
    }
    setParticipants(ack.participants || []);
    setConnectionState('connected');

    for (const participant of ack.participants || []) {
      const entry = createPeerConnection(participant.socketId);
      const offer = await entry.pc.createOffer();
      await entry.pc.setLocalDescription(offer);
      socket.emit('webrtc:offer', { targetSocketId: participant.socketId, sdp: offer });
    }
  }, [closeAllPeers, createPeerConnection]);

  const joinRoom = useCallback(async (roomId: string) => {
    setError(null);
    setConnectionState('connecting');
    try {
      const iceRes = await voiceRoomsApi.getIceServers();
      const servers = iceRes.data?.data || iceRes.data;
      if (Array.isArray(servers) && servers.length) iceServersRef.current = servers;
    } catch {
      // Falls back to the hardcoded Google STUN entry — still functional
      // for most NATs, just without any configured TURN.
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch {
      setError('Нет доступа к микрофону. Разрешите доступ и попробуйте снова.');
      setConnectionState('error');
      return false;
    }
    // Muted until the user actually holds Push-to-Talk — see startTalking().
    stream.getAudioTracks().forEach((t) => { t.enabled = false; });
    localStreamRef.current = stream;

    const token = Cookies.get('access_token');
    const socket = io(`${WS_URL}/voice`, {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });
    socketRef.current = socket;
    currentRoomIdRef.current = roomId;
    setupSignalingHandlers(socket);

    socket.on('connect', () => {
      selfSocketIdRef.current = socket.id ?? null;
      // The initial room:join is driven by the explicit call further down
      // this function, not this handler — it only takes over for a
      // genuine reconnect (fired after the first connect too, but
      // hasJoinedOnceRef is still false at that point).
      if (hasJoinedOnceRef.current && currentRoomIdRef.current) {
        setConnectionState('reconnecting');
        rejoinCurrentRoom(socket);
      }
    });
    socket.on('disconnect', () => {
      if (!mountedRef.current) return;
      setConnectionState((prev) => (prev === 'idle' ? prev : 'reconnecting'));
    });
    socket.on('connect_error', () => {
      setError('Не удалось подключиться к голосовой комнате');
    });

    const ack = await socket.timeout(10000).emitWithAck('room:join', { roomId }).catch(() => null);
    if (!ack || ack.error) {
      setError(ack?.error || 'Failed to join voice room');
      setConnectionState('error');
      stream.getTracks().forEach((t) => t.stop());
      socket.disconnect();
      return false;
    }

    selfSocketIdRef.current = socket.id ?? null;
    hasJoinedOnceRef.current = true;
    setParticipants(ack.participants || []);
    setConnectionState('connected');

    for (const participant of ack.participants as VoiceRoomParticipant[]) {
      const entry = createPeerConnection(participant.socketId);
      const offer = await entry.pc.createOffer();
      await entry.pc.setLocalDescription(offer);
      socket.emit('webrtc:offer', { targetSocketId: participant.socketId, sdp: offer });
    }
    return true;
  }, [createPeerConnection, rejoinCurrentRoom, setupSignalingHandlers]);

  const leaveRoom = useCallback(() => {
    socketRef.current?.emit('room:leave');
    socketRef.current?.removeAllListeners();
    socketRef.current?.disconnect();
    socketRef.current = null;
    currentRoomIdRef.current = null;
    hasJoinedOnceRef.current = false;
    closeAllPeers();
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    setParticipants([]);
    setConnectionState('idle');
    setSelfSpeaking(false);
    micEnabledRef.current = false;
    setSelfMicEnabled(false);
  }, [closeAllPeers]);

  useEffect(() => () => leaveRoom(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const setMicEnabled = useCallback((enabled: boolean) => {
    micEnabledRef.current = enabled;
    setSelfMicEnabled(enabled);
    socketRef.current?.emit('mic:state', { micEnabled: enabled });
    if (!enabled) {
      // Force-release PTT if the mic is switched off mid-press.
      localStreamRef.current?.getAudioTracks().forEach((t) => { t.enabled = false; });
      if (selfSpeaking) {
        socketRef.current?.emit('ptt:stop');
        setSelfSpeaking(false);
      }
    }
  }, [selfSpeaking]);

  // Toggling `track.enabled` (rather than renegotiating or adding/removing
  // the track) is what keeps PTT latency to essentially zero — the RTP
  // session is already fully established with every peer the moment the
  // button is held, so audio starts flowing on the very next frame instead
  // of waiting on a fresh offer/answer round trip.
  const startTalking = useCallback(() => {
    if (!micEnabledRef.current || !localStreamRef.current) return;
    localStreamRef.current.getAudioTracks().forEach((t) => { t.enabled = true; });
    setSelfSpeaking(true);
    socketRef.current?.emit('ptt:start');
  }, []);

  const stopTalking = useCallback(() => {
    localStreamRef.current?.getAudioTracks().forEach((t) => { t.enabled = false; });
    setSelfSpeaking(false);
    socketRef.current?.emit('ptt:stop');
  }, []);

  return {
    connectionState,
    participants,
    selfMicEnabled,
    selfSpeaking,
    volume,
    error,
    selfSocketId: selfSocketIdRef,
    joinRoom,
    leaveRoom,
    setMicEnabled,
    startTalking,
    stopTalking,
    setVolume,
  };
}
