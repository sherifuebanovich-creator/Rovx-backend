'use client';
import { useState, useRef, useCallback, useEffect } from 'react';
import { FaMicrophone, FaPaperPlane, FaTimes } from 'react-icons/fa';
import { socialApi } from '@/lib/api';
import { getSocket } from '@/hooks/useSocket';
import toast from 'react-hot-toast';

interface Props {
  groupId: string;
  onSent?: () => void;
}

export default function AudioRecorderButton({ groupId, onSent }: Props) {
  const [isRecording, setIsRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const [isSending, setIsSending] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval>>();
  const startTimeRef = useRef(0);
  const touchStartY = useRef(0);

  const cleanup = useCallback(() => {
    clearInterval(timerRef.current);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    mediaRecorderRef.current = null;
    chunksRef.current = [];
  }, []);

  useEffect(() => {
    return cleanup;
  }, [cleanup]);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 44100 },
      });
      streamRef.current = stream;

      const mr = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : 'audio/webm',
      });
      mediaRecorderRef.current = mr;
      chunksRef.current = [];

      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mr.start(100);
      setIsRecording(true);
      setCancelled(false);
      setDuration(0);
      startTimeRef.current = Date.now();

      timerRef.current = setInterval(() => {
        setDuration(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 200);
    } catch {
      toast.error('Микрофон недоступен');
    }
  }, []);

  const stopRecording = useCallback(async (send: boolean) => {
    if (!mediaRecorderRef.current || mediaRecorderRef.current.state === 'inactive') {
      cleanup();
      setIsRecording(false);
      return;
    }

    const mr = mediaRecorderRef.current;
    const stream = streamRef.current;

    await new Promise<void>((resolve) => {
      mr.onstop = () => resolve();
      mr.stop();
    });

    setIsRecording(false);

    if (!send || cancelled || chunksRef.current.length === 0) {
      cleanup();
      return;
    }

    const durationSec = Math.floor((Date.now() - startTimeRef.current) / 1000);
    if (durationSec < 1) {
      cleanup();
      return;
    }

    setIsSending(true);
    try {
      const mimeType = mr.mimeType || 'audio/webm';
      const blob = new Blob(chunksRef.current, { type: mimeType });
      const ext = mimeType.includes('ogg') ? 'ogg' : 'webm';
      const file = new File([blob], `voice-${Date.now()}.${ext}`, { type: mimeType });

      const res = await socialApi.uploadGroupAudio(groupId, file);
      const audioUrl = res.data?.url || res.data?.data?.url;

      if (!audioUrl) {
        console.error('Audio upload response:', res.data);
        throw new Error('No URL in response');
      }

      const socket = getSocket();
      socket?.emit('group:message', {
        groupId,
        content: '',
        audioUrl,
      });
      onSent?.();
    } catch (err: any) {
      console.error('Audio send error:', err?.response?.data || err.message || err);
      toast.error(err?.response?.data?.message || 'Ошибка отправки голосового');
    } finally {
      setIsSending(false);
      cleanup();
    }
  }, [groupId, onSent, cancelled, cleanup]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    // Capture the pointer to this wrapper so it keeps receiving move/up/cancel
    // events even after the child content swaps from the idle mic button to
    // the recording UI once getUserMedia resolves mid-gesture.
    e.currentTarget.setPointerCapture(e.pointerId);
    touchStartY.current = e.clientY;
    startRecording();
  }, [startRecording]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    const dy = touchStartY.current - e.clientY;
    if (dy > 80) {
      setCancelled(true);
      stopRecording(false);
    } else {
      stopRecording(true);
    }
  }, [stopRecording]);

  const handlePointerCancel = useCallback(() => {
    setCancelled(true);
    stopRecording(false);
  }, [stopRecording]);

  const formatDuration = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  if (isSending) {
    return (
      <div className="flex items-center gap-2 px-3 py-2">
        <div className="w-5 h-5 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
        <span className="text-xs text-gray-400">Отправка...</span>
      </div>
    );
  }

  return (
    <div
      className={isRecording ? 'flex items-center gap-3 flex-1' : 'inline-flex'}
      onPointerDown={!isRecording ? handlePointerDown : undefined}
      onPointerUp={isRecording ? handlePointerUp : undefined}
      onPointerCancel={isRecording ? handlePointerCancel : undefined}
      onPointerLeave={isRecording ? handlePointerCancel : undefined}
      style={{ touchAction: 'none' }}
    >
      {isRecording ? (
        <>
          <button
            className="w-10 h-10 flex items-center justify-center rounded-full bg-red-500/20 text-red-400 animate-pulse"
          >
            <FaTimes size={14} />
          </button>
          <div className="flex-1 flex items-center gap-3">
            <div className="w-3 h-3 rounded-full bg-red-500 animate-pulse" />
            <span className="text-sm text-red-400 font-mono font-medium tabular-nums">
              {formatDuration(duration)}
            </span>
            <span className="text-xs text-gray-500">← отпустите или потяните вверх для отмены</span>
          </div>
        </>
      ) : (
        <button
          className="w-10 h-10 flex items-center justify-center rounded-full bg-primary-600/20 text-primary-400 hover:bg-primary-600/30 active:bg-primary-600/40 transition-colors select-none"
          title="Удерживайте для записи голосового"
        >
          <FaMicrophone size={16} />
        </button>
      )}
    </div>
  );
}
