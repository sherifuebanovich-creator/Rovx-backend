'use client';
import { useState, useRef, useEffect, useCallback } from 'react';
import { FaPlay, FaPause } from 'react-icons/fa';

interface Props {
  src: string;
  isOwn?: boolean;
}

export default function AudioMessagePlayer({ src, isOwn }: Props) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [waves] = useState(() => Array.from({ length: 32 }, () => 0.3 + Math.random() * 0.7));
  const animRef = useRef(0);

  useEffect(() => {
    const audio = new Audio();
    audio.preload = 'metadata';
    audio.src = src;
    audioRef.current = audio;

    audio.onloadedmetadata = () => {
      setDuration(audio.duration);
    };
    audio.onended = () => {
      setIsPlaying(false);
      setProgress(0);
      cancelAnimationFrame(animRef.current);
    };

    return () => {
      audio.pause();
      audio.src = '';
      cancelAnimationFrame(animRef.current);
    };
  }, [src]);

  const updateProgress = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || audio.paused) return;
    setProgress(audio.currentTime / (audio.duration || 1));
    animRef.current = requestAnimationFrame(updateProgress);
  }, []);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
      cancelAnimationFrame(animRef.current);
    } else {
      audio.currentTime = 0;
      audio.play().then(() => {
        setIsPlaying(true);
        animRef.current = requestAnimationFrame(updateProgress);
      }).catch(() => {});
    }
  }, [isPlaying, updateProgress]);

  const formatTime = (sec: number) => {
    if (!sec || !isFinite(sec)) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const progressIndex = Math.floor(progress * waves.length);

  return (
    <div className="flex items-center gap-2.5 min-w-[200px] max-w-[280px]">
      <button
        onClick={togglePlay}
        className={`w-9 h-9 flex items-center justify-center rounded-full flex-shrink-0 transition-colors ${
          isOwn
            ? 'bg-white/20 text-white hover:bg-white/30'
            : 'bg-primary-600/20 text-primary-400 hover:bg-primary-600/30'
        }`}
      >
        {isPlaying ? <FaPause size={12} /> : <FaPlay size={12} className="ml-0.5" />}
      </button>

      <div className="flex-1 flex items-center gap-[2px] h-8">
        {waves.map((h, i) => (
          <div
            key={i}
            className="flex-1 rounded-full transition-colors duration-75"
            style={{
              height: `${h * 100}%`,
              minHeight: '3px',
              backgroundColor: i < progressIndex
                ? (isOwn ? 'rgba(255,255,255,0.8)' : 'var(--color-primary-400, #3b82f6)')
                : (isOwn ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.1)'),
            }}
          />
        ))}
      </div>

      <span className={`text-[10px] font-mono tabular-nums flex-shrink-0 ${
        isOwn ? 'text-white/60' : 'text-gray-500'
      }`}>
        {isPlaying ? formatTime(duration - progress * duration) : formatTime(duration)}
      </span>
    </div>
  );
}
