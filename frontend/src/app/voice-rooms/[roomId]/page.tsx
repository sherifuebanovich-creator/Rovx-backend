'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useAuthStore } from '@/store/auth.store';
import { mediaUrl } from '@/lib/media';
import { voiceRoomsApi } from '@/lib/api';
import { useVoiceRoom } from '@/hooks/useVoiceRoom';
import {
  FaArrowLeft, FaMicrophone, FaMicrophoneSlash, FaVolumeHigh, FaVolumeXmark,
  FaWalkieTalkie, FaUsers,
} from 'react-icons/fa6';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

export default function VoiceRoomScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const params = useParams();
  const roomId = params.roomId as string;
  const { user } = useAuthStore();
  const [roomName, setRoomName] = useState('');
  const [joining, setJoining] = useState(true);
  const joinAttemptedRef = useRef(false);

  const {
    connectionState, participants, selfMicEnabled, selfSpeaking, volume, error,
    joinRoom, leaveRoom, setMicEnabled, startTalking, stopTalking, setVolume,
  } = useVoiceRoom();

  useEffect(() => {
    if (!user || !roomId || joinAttemptedRef.current) return;
    joinAttemptedRef.current = true;

    voiceRoomsApi.get(roomId)
      .then((res) => setRoomName((res.data?.data || res.data)?.name || ''))
      .catch(() => {});

    joinRoom(roomId).then((ok) => {
      if (!ok) toast.error(t('voiceRooms.joinFailed'));
      setJoining(false);
    });

    return () => { leaveRoom(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, roomId]);

  const handleLeave = useCallback(() => {
    leaveRoom();
    router.push('/voice-rooms');
  }, [leaveRoom, router]);

  // Space bar as a keyboard PTT alternative (a driver mounted phone may
  // have the app connected to a Bluetooth-paired peripheral, or this may
  // be tested/used on a desktop) — held down to talk, same as the button.
  useEffect(() => {
    const isTypingTarget = (el: EventTarget | null) =>
      el instanceof HTMLElement && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat && !isTypingTarget(e.target)) {
        e.preventDefault();
        startTalking();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isTypingTarget(e.target)) {
        e.preventDefault();
        stopTalking();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [startTalking, stopTalking]);

  if (!user) {
    return (
      <div className="min-h-dvh bg-dark-bg flex items-center justify-center">
        <p className="text-gray-400">{t('voiceRooms.loginRequired')}</p>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-dark-bg pb-safe-bottom flex flex-col">
      <div className="px-4 pt-12 sm:pt-16 max-w-2xl mx-auto w-full flex-1 flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <button onClick={handleLeave} className="flex items-center gap-2 text-gray-400 hover:text-white transition-all">
            <FaArrowLeft size={14} /> {t('voiceRooms.leave')}
          </button>
          <div className="flex items-center gap-2 text-xs">
            <span className={`w-2 h-2 rounded-full ${
              connectionState === 'connected' ? 'bg-green-500'
              : connectionState === 'connecting' || connectionState === 'reconnecting' ? 'bg-yellow-500 animate-pulse'
              : 'bg-red-500'
            }`} />
            <span className="text-gray-400">
              {connectionState === 'connected' && t('voiceRooms.status.connected')}
              {connectionState === 'connecting' && t('voiceRooms.status.connecting')}
              {connectionState === 'reconnecting' && t('voiceRooms.status.reconnecting')}
              {connectionState === 'error' && t('voiceRooms.status.error')}
            </span>
          </div>
        </div>

        <h1 className="text-xl font-black text-white font-display flex items-center gap-2 mb-1">
          <FaWalkieTalkie className="text-primary-400" /> {roomName || t('voiceRooms.title')}
        </h1>
        <p className="text-xs text-gray-500 flex items-center gap-1 mb-6">
          <FaUsers size={10} /> {participants.length + 1} {t('voiceRooms.participantsLower')}
        </p>

        {error && (
          <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-sm rounded-xl px-4 py-3 mb-4">
            {error}
          </div>
        )}

        {/* Participants */}
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-3 mb-8">
          <ParticipantTile
            displayName={user.displayName + ` (${t('voiceRooms.you')})`}
            avatar={user.avatar}
            isSpeaking={selfSpeaking}
            micEnabled={selfMicEnabled}
          />
          {participants.map((p) => (
            <ParticipantTile
              key={p.socketId}
              displayName={p.displayName}
              avatar={p.avatar}
              isSpeaking={p.isSpeaking}
              micEnabled={p.micEnabled}
            />
          ))}
        </div>

        <div className="flex-1" />

        {/* Controls */}
        <div className="pb-8 flex flex-col items-center gap-6">
          <div className="flex items-center gap-3 w-full max-w-xs">
            {volume === 0 ? <FaVolumeXmark className="text-gray-500 flex-shrink-0" size={16} /> : <FaVolumeHigh className="text-gray-400 flex-shrink-0" size={16} />}
            <input
              type="range" min={0} max={100} value={Math.round(volume * 100)}
              onChange={(e) => setVolume(Number(e.target.value) / 100)}
              className="flex-1 accent-primary-500"
              aria-label={t('voiceRooms.volume')}
            />
          </div>

          <button
            onClick={() => setMicEnabled(!selfMicEnabled)}
            className={`w-12 h-12 rounded-xl flex items-center justify-center transition-all ${
              selfMicEnabled ? 'bg-white/10 text-white' : 'bg-red-500/20 text-red-400'
            }`}
            aria-label={selfMicEnabled ? t('voiceRooms.micOn') : t('voiceRooms.micOff')}
            title={selfMicEnabled ? t('voiceRooms.micOn') : t('voiceRooms.micOff')}
          >
            {selfMicEnabled ? <FaMicrophone size={18} /> : <FaMicrophoneSlash size={18} />}
          </button>

          <button
            disabled={!selfMicEnabled || joining || connectionState !== 'connected'}
            onPointerDown={(e) => { e.preventDefault(); startTalking(); }}
            onPointerUp={stopTalking}
            onPointerLeave={stopTalking}
            onPointerCancel={stopTalking}
            className={`w-28 h-28 rounded-full flex flex-col items-center justify-center gap-1 select-none transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
              selfSpeaking
                ? 'bg-gradient-to-br from-accent-500 to-accent-600 shadow-[0_0_30px_rgba(234,88,12,0.5)] scale-105'
                : 'bg-gradient-to-br from-primary-600 to-primary-800 hover:opacity-90'
            }`}
            style={{ touchAction: 'none' }}
          >
            <FaWalkieTalkie size={28} className="text-white" />
            <span className="text-[10px] font-bold text-white uppercase tracking-wider">
              {selfSpeaking ? t('voiceRooms.talking') : t('voiceRooms.holdToTalk')}
            </span>
          </button>
          <p className="text-[11px] text-gray-500">{t('voiceRooms.pttHint')}</p>
        </div>
      </div>
    </div>
  );
}

function ParticipantTile({ displayName, avatar, isSpeaking, micEnabled }: {
  displayName: string;
  avatar?: string | null;
  isSpeaking: boolean;
  micEnabled: boolean;
}) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className={`relative w-14 h-14 rounded-2xl flex items-center justify-center overflow-hidden transition-all ${
        isSpeaking ? 'ring-2 ring-accent-500 shadow-[0_0_16px_rgba(234,88,12,0.5)]' : 'ring-1 ring-white/10'
      }`}>
        {avatar ? (
          <img src={mediaUrl(avatar)} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-primary-600 to-primary-800 flex items-center justify-center text-white font-bold">
            {displayName?.[0]?.toUpperCase() || '?'}
          </div>
        )}
        {!micEnabled && (
          <div className="absolute bottom-0 right-0 w-5 h-5 bg-dark-bg rounded-full flex items-center justify-center">
            <FaMicrophoneSlash size={10} className="text-red-400" />
          </div>
        )}
      </div>
      <span className="text-[11px] text-gray-300 truncate max-w-[70px] text-center">{displayName}</span>
    </div>
  );
}
