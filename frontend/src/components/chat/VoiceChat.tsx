'use client';
import { useState, useRef, useCallback, useEffect } from 'react';
import { getSocket } from '@/hooks/useSocket';
import { useAuthStore } from '@/store/auth.store';
import { FaMicrophone, FaMicrophoneSlash, FaPhone, FaPhoneSlash, FaVolumeUp, FaVolumeMute } from 'react-icons/fa';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';

interface VoiceChatProps {
  targetUserId?: string;
  targetUserName?: string;
  groupId?: string;
}

export default function VoiceChat({ targetUserId, targetUserName, groupId }: VoiceChatProps) {
  const { user } = useAuthStore();
  const [isInCall, setIsInCall] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [remoteUser, setRemoteUser] = useState<string | null>(null);
  const [callDuration, setCallDuration] = useState(0);
  const [isSpeakerOn, setIsSpeakerOn] = useState(true);

  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const durationRef = useRef(0);

  // WebRTC transport. Signaling (offer/answer/ICE candidates) rides over
  // the existing voice:signal socket relay; only STUN is configured (no
  // TURN server in this deployment), so calls across strict/symmetric NATs
  // may fail to establish — acceptable for a P2P voice feature with no
  // media server infra.
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const peerIdRef = useRef<string | null>(null);
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const ICE_SERVERS: RTCIceServer[] = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ];

  const createPeerConnection = useCallback((peerId: string) => {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    localStreamRef.current?.getTracks().forEach(track => {
      pc.addTrack(track, localStreamRef.current!);
    });

    pc.ontrack = (event) => {
      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = event.streams[0];
      }
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        getSocket()?.emit('voice:signal', {
          targetUserId: peerId,
          signal: { type: 'candidate', candidate: event.candidate.toJSON() },
        });
      }
    };

    pcRef.current = pc;
    return pc;
  }, []);

  const formatDuration = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const startCall = useCallback(async (targetId: string, targetName: string) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      localStreamRef.current = stream;

      const socket = getSocket();
      if (!socket?.connected) {
        toast.error('Нет соединения');
        stream.getTracks().forEach(t => t.stop());
        return;
      }

      peerIdRef.current = targetId;
      createPeerConnection(targetId);

      socket.emit('voice:call', {
        targetUserId: targetId,
        callerName: user?.displayName || 'User',
        callerId: user?.id,
      });

      setIsInCall(true);
      setRemoteUser(targetName);
      durationRef.current = 0;
      setCallDuration(0);

      timerRef.current = setInterval(() => {
        durationRef.current += 1;
        setCallDuration(durationRef.current);
      }, 1000);

      toast.success(`Звонок ${targetName}...`);
    } catch (err) {
      toast.error('Не удалось получить доступ к микрофону');
    }
  }, [user, createPeerConnection]);

  const endCall = useCallback(() => {
    const socket = getSocket();
    const targetId = peerIdRef.current || targetUserId || groupId;
    if (targetId) {
      socket?.emit('voice:end', { targetUserId: targetId, groupId });
    }

    pcRef.current?.close();
    pcRef.current = null;
    peerIdRef.current = null;
    pendingCandidatesRef.current = [];

    localStreamRef.current?.getTracks().forEach(t => t.stop());
    localStreamRef.current = null;

    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = null;
    }

    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    setIsInCall(false);
    setIsMuted(false);
    setRemoteUser(null);
    setCallDuration(0);
    durationRef.current = 0;
  }, [targetUserId, groupId]);

  const toggleMute = useCallback(() => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMuted(!audioTrack.enabled);
      }
    }
  }, []);

  const toggleSpeaker = useCallback(() => {
    setIsSpeakerOn(!isSpeakerOn);
  }, [isSpeakerOn]);

  useEffect(() => {
    if (remoteAudioRef.current) {
      remoteAudioRef.current.muted = !isSpeakerOn;
    }
  }, [isSpeakerOn]);

  // Listen for incoming call
  useEffect(() => {
    const handler = (e: Event) => {
      const data = (e as CustomEvent).detail;
      if (!data || isInCall) return;

      toast((t) => (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">📞 Звонок от {data.callerName}</p>
          <div className="flex gap-2">
            <button onClick={() => {
              toast.dismiss(t.id);
              acceptCall(data);
            }} className="px-3 py-1 rounded-lg bg-green-600 text-white text-xs">
              Принять
            </button>
            <button onClick={() => toast.dismiss(t.id)} className="px-3 py-1 rounded-lg bg-red-600 text-white text-xs">
              Отклонить
            </button>
          </div>
        </div>
      ), { duration: 10000 });
    };

    const acceptCall = async (data: any) => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
        localStreamRef.current = stream;
        peerIdRef.current = data.callerId;
        createPeerConnection(data.callerId);

        setIsInCall(true);
        setRemoteUser(data.callerName);
        durationRef.current = 0;
        setCallDuration(0);

        timerRef.current = setInterval(() => {
          durationRef.current += 1;
          setCallDuration(durationRef.current);
        }, 1000);

        const socket = getSocket();
        socket?.emit('voice:signal', {
          targetUserId: data.callerId,
          signal: { type: 'accepted' },
        });
      } catch {
        toast.error('Не удалось получить доступ к микрофону');
      }
    };

    window.addEventListener('rovx:voice-call', handler);
    return () => window.removeEventListener('rovx:voice-call', handler);
  }, [isInCall, createPeerConnection]);

  // Listen for voice signals (SDP offer/answer + ICE candidates)
  useEffect(() => {
    const handler = async (e: Event) => {
      const data = (e as CustomEvent).detail;
      const signal = data?.signal;
      const fromUserId = data?.fromUserId;
      if (!signal) return;

      const pc = pcRef.current;

      if (signal.type === 'accepted') {
        toast.success('Звонок принят');
        // We're the caller — now that the callee agreed, create and send the offer.
        if (!pc || !peerIdRef.current) return;
        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          getSocket()?.emit('voice:signal', {
            targetUserId: peerIdRef.current,
            signal: { type: 'offer', sdp: offer.sdp },
          });
        } catch {
          toast.error('Не удалось установить соединение');
        }
        return;
      }

      if (signal.type === 'offer') {
        // We're the callee — answer it.
        if (!pc) return;
        try {
          await pc.setRemoteDescription({ type: 'offer', sdp: signal.sdp });
          for (const candidate of pendingCandidatesRef.current) {
            await pc.addIceCandidate(candidate).catch(() => {});
          }
          pendingCandidatesRef.current = [];
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          getSocket()?.emit('voice:signal', {
            targetUserId: fromUserId,
            signal: { type: 'answer', sdp: answer.sdp },
          });
        } catch {
          toast.error('Не удалось установить соединение');
        }
        return;
      }

      if (signal.type === 'answer') {
        if (!pc) return;
        try {
          await pc.setRemoteDescription({ type: 'answer', sdp: signal.sdp });
          for (const candidate of pendingCandidatesRef.current) {
            await pc.addIceCandidate(candidate).catch(() => {});
          }
          pendingCandidatesRef.current = [];
        } catch {}
        return;
      }

      if (signal.type === 'candidate' && signal.candidate) {
        if (!pc) return;
        if (pc.remoteDescription) {
          await pc.addIceCandidate(signal.candidate).catch(() => {});
        } else {
          pendingCandidatesRef.current.push(signal.candidate);
        }
      }
    };
    window.addEventListener('rovx:voice-signal', handler);
    return () => window.removeEventListener('rovx:voice-signal', handler);
  }, []);

  // Listen for call end
  useEffect(() => {
    const handler = () => {
      endCall();
      toast('Звонок завершён');
    };
    window.addEventListener('rovx:voice-end', handler);
    return () => window.removeEventListener('rovx:voice-end', handler);
  }, [endCall]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      pcRef.current?.close();
      pcRef.current = null;
      localStreamRef.current?.getTracks().forEach(t => t.stop());
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // Don't render if no target
  if (!targetUserId && !groupId) return null;

  return (
    <>
      <audio ref={remoteAudioRef} autoPlay playsInline />

      {/* Call button */}
      {!isInCall && targetUserId && (
        <button
          onClick={() => startCall(targetUserId, targetUserName || 'User')}
          className="w-10 h-10 flex items-center justify-center rounded-xl bg-green-600/20 text-green-400 hover:bg-green-600/30 transition-all"
          title="Голосовой звонок"
        >
          <FaPhone size={14} />
        </button>
      )}

      {/* Active call UI */}
      <AnimatePresence>
        {isInCall && (
          <motion.div
            initial={{ y: '100%', opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: '100%', opacity: 0 }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="fixed bottom-0 left-0 right-0 z-50 bg-dark-card border-t border-dark-border p-4 pb-safe-bottom"
          >
            <div className="max-w-sm mx-auto space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-dark-text font-semibold">{remoteUser}</p>
                  <p className="text-xs text-gray-400">{formatDuration(callDuration)}</p>
                </div>
                <div className="flex items-center gap-2">
                  {isMuted ? (
                    <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                  ) : (
                    <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                  )}
                </div>
              </div>

              <div className="flex items-center justify-center gap-4">
                <button
                  onClick={toggleMute}
                  className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${
                    isMuted ? 'bg-red-500/20 text-red-400' : 'bg-dark-surface text-gray-400 hover:text-dark-text'
                  }`}
                >
                  {isMuted ? <FaMicrophoneSlash size={16} /> : <FaMicrophone size={16} />}
                </button>

                <button
                  onClick={endCall}
                  className="w-14 h-14 rounded-full bg-red-600 text-white flex items-center justify-center hover:bg-red-500 transition-all"
                >
                  <FaPhoneSlash size={18} />
                </button>

                <button
                  onClick={toggleSpeaker}
                  className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${
                    !isSpeakerOn ? 'bg-red-500/20 text-red-400' : 'bg-dark-surface text-gray-400 hover:text-dark-text'
                  }`}
                >
                  {isSpeakerOn ? <FaVolumeUp size={16} /> : <FaVolumeMute size={16} />}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
