'use client';
import { createContext, useCallback, useContext, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { FaWalkieTalkie } from 'react-icons/fa6';
import { useVoiceRoom, VoiceRoomConnectionState, VoiceRoomParticipant } from '@/hooks/useVoiceRoom';

interface VoiceRoomContextValue {
  connectionState: VoiceRoomConnectionState;
  participants: VoiceRoomParticipant[];
  selfMicEnabled: boolean;
  selfSpeaking: boolean;
  volume: number;
  error: string | null;
  activeRoomId: string | null;
  activeRoomName: string;
  joinAndTrack: (roomId: string, roomName: string) => Promise<boolean>;
  leaveAndClear: () => void;
  setMicEnabled: (enabled: boolean) => void;
  startTalking: () => void;
  stopTalking: () => void;
  setVolume: (v: number) => void;
  setActiveRoomName: (name: string) => void;
}

const VoiceRoomContext = createContext<VoiceRoomContextValue | null>(null);

export function useVoiceRoomContext() {
  const ctx = useContext(VoiceRoomContext);
  if (!ctx) throw new Error('useVoiceRoomContext must be used within VoiceRoomProvider');
  return ctx;
}

// Owns the single useVoiceRoom() instance for the whole app — mounted once
// here (Providers.tsx) instead of inside the [roomId] page, so navigating
// away from that page (e.g. "back to map") no longer tears down the
// socket/WebRTC connection. The page below becomes a thin view over this
// shared state; this component additionally renders the minimized
// Telegram-style "ongoing call" bar whenever connected but not currently on
// the room's own screen.
export function VoiceRoomProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const voice = useVoiceRoom();
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [activeRoomName, setActiveRoomName] = useState('');

  const joinAndTrack = useCallback(async (roomId: string, roomName: string) => {
    // The [roomId] page calls this on every mount, i.e. every time the user
    // navigates back to the room screen (including "back to map" then
    // returning) — without this guard it re-joined on top of the still-live
    // connection each time, landing the same person in the participant list
    // multiple times over (exactly what was reported: 3 round trips -> 3
    // copies of the same user). If we're already connected (or actively
    // connecting) to this exact room, just reuse it.
    if (activeRoomId === roomId && (voice.connectionState === 'connected' || voice.connectionState === 'connecting' || voice.connectionState === 'reconnecting')) {
      if (roomName) setActiveRoomName(roomName);
      return true;
    }
    // Switching rooms mid-call (rare, but reachable by navigating straight
    // from one room's URL to another's) must close the old connection first
    // — joinRoom() itself has no notion of "already in a different room".
    if (activeRoomId && activeRoomId !== roomId) {
      voice.leaveRoom();
    }
    setActiveRoomId(roomId);
    setActiveRoomName(roomName);
    const ok = await voice.joinRoom(roomId);
    if (!ok) setActiveRoomId(null);
    return ok;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRoomId, voice.connectionState]);

  const leaveAndClear = useCallback(() => {
    voice.leaveRoom();
    setActiveRoomId(null);
    setActiveRoomName('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onOwnRoomScreen = pathname === `/voice-rooms/${activeRoomId}`;
  const showMinimizedBar = !!activeRoomId && !onOwnRoomScreen
    && (voice.connectionState === 'connected' || voice.connectionState === 'reconnecting');

  return (
    <VoiceRoomContext.Provider value={{
      ...voice,
      activeRoomId,
      activeRoomName,
      joinAndTrack,
      leaveAndClear,
      setActiveRoomName,
    }}>
      {children}
      <AnimatePresence>
        {showMinimizedBar && (
          <motion.button
            initial={{ y: -60, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -60, opacity: 0 }}
            onClick={() => router.push(`/voice-rooms/${activeRoomId}`)}
            className="fixed top-0 left-0 right-0 z-[60] flex items-center justify-center gap-2 px-4 py-2.5 bg-gradient-to-r from-primary-600 to-accent-600 text-white text-sm font-medium shadow-lg"
          >
            <FaWalkieTalkie size={14} className={voice.connectionState === 'reconnecting' ? 'animate-pulse' : ''} />
            <span className="truncate max-w-[70vw]">
              {voice.connectionState === 'reconnecting' ? 'Переподключение…' : activeRoomName || 'Голосовая комната'}
            </span>
            <span className="w-1.5 h-1.5 rounded-full bg-white/80 animate-pulse ml-1" />
          </motion.button>
        )}
      </AnimatePresence>
    </VoiceRoomContext.Provider>
  );
}
