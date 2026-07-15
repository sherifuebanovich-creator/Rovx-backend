'use client';
import { useState, useRef, useCallback, useEffect } from 'react';
import { FaVideo, FaTimes } from 'react-icons/fa';
import { socialApi } from '@/lib/api';
import { getSocket } from '@/hooks/useSocket';
import toast from 'react-hot-toast';

interface Props {
  groupId: string;
  onSent?: () => void;
}

export default function VideoMessageRecorder({ groupId, onSent }: Props) {
  const [isRecording, setIsRecording] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const durationRef = useRef(0);
  const [isSending, setIsSending] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval>>();
  const startTimeRef = useRef(0);
  const videoPreviewRef = useRef<HTMLVideoElement | null>(null);

  const cleanup = useCallback(() => {
    clearInterval(timerRef.current);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    setPreview(null);
    mediaRecorderRef.current = null;
    chunksRef.current = [];
  }, []);

  useEffect(() => {
    return () => {
      cleanup();
      clearInterval(timerRef.current);
    };
  }, []);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 480, height: 480, facingMode: 'user' },
        audio: true,
      });
      streamRef.current = stream;

      const mr = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')
          ? 'video/webm;codecs=vp8,opus'
          : 'video/webm',
      });
      mediaRecorderRef.current = mr;
      chunksRef.current = [];

      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      setPreview('live');

      mr.start(100);
      setIsRecording(true);
      setDuration(0);
      startTimeRef.current = Date.now();

      timerRef.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
        durationRef.current = elapsed;
        setDuration(elapsed);
        if (elapsed >= 60) {
          stopRecording(true);
        }
      }, 200);
    } catch {
      toast.error('Камера недоступна');
    }
  }, []);

  const stopRecording = useCallback(async (send: boolean) => {
    if (!mediaRecorderRef.current || mediaRecorderRef.current.state === 'inactive') {
      cleanup();
      setIsRecording(false);
      return;
    }

    const mr = mediaRecorderRef.current;
    await new Promise<void>((resolve) => {
      mr.onstop = () => resolve();
      mr.stop();
    });

    setIsRecording(false);

    if (!send || chunksRef.current.length === 0 || durationRef.current < 1) {
      cleanup();
      return;
    }

    setIsSending(true);
    try {
      const mimeType = mr.mimeType || 'video/webm';
      const blob = new Blob(chunksRef.current, { type: mimeType });
      const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
      const file = new File([blob], `videomsg-${Date.now()}.${ext}`, { type: mimeType });

      const res = await socialApi.uploadGroupVideoMsg(groupId, file);
      const videoUrl = res.data?.url || res.data?.data?.url;

      if (videoUrl) {
        const socket = getSocket();
        socket?.emit('group:message', {
          groupId,
          content: '',
          videoUrl,
        });
        onSent?.();
      }
    } catch {
      toast.error('Ошибка отправки видео');
    } finally {
      setIsSending(false);
      cleanup();
    }
  }, [groupId, onSent, cleanup]);

  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  if (isSending) {
    return (
      <div className="flex items-center gap-2 px-3 py-2">
        <div className="w-5 h-5 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
        <span className="text-xs text-gray-400">Отправка видео...</span>
      </div>
    );
  }

  if (isRecording) {
    return (
      <div className="fixed inset-0 z-50 bg-black flex flex-col items-center justify-center">
        {preview && (
          <div className="relative w-64 h-64 rounded-full overflow-hidden border-4 border-red-500 mb-6">
            <video
              ref={(el) => {
                if (el && streamRef.current) {
                  el.srcObject = streamRef.current;
                  el.play().catch(() => {});
                }
              }}
              className="w-full h-full object-cover scale-x-[-1]"
              muted
              playsInline
            />
          </div>
        )}

        <div className="flex items-center gap-2 mb-8">
          <div className="w-3 h-3 rounded-full bg-red-500 animate-pulse" />
          <span className="text-white font-mono text-lg">{formatTime(duration)}</span>
        </div>

        <div className="flex items-center gap-6">
          <button
            onClick={() => stopRecording(false)}
            className="w-14 h-14 flex items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
          >
            <FaTimes size={20} />
          </button>
          <button
            onClick={() => stopRecording(true)}
            className="w-16 h-16 flex items-center justify-center rounded-full bg-primary-600 text-white hover:bg-primary-500"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
              <path d="M2 12l8-8v5h12v6H10v5z" transform="rotate(180,12,12)" />
            </svg>
          </button>
        </div>
      </div>
    );
  }

  return (
    <button
      onClick={startRecording}
      className="w-10 h-10 flex items-center justify-center rounded-full bg-primary-600/20 text-primary-400 hover:bg-primary-600/30 transition-colors"
      title="Записать видео-сообщение"
    >
      <FaVideo size={15} />
    </button>
  );
}
