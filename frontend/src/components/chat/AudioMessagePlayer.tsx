'use client';
import { useState, useRef, useEffect, useCallback } from 'react';
import { FaPlay, FaPause } from 'react-icons/fa';

interface Props {
  src: string;
  isOwn: boolean;
}

export default function AudioMessagePlayer({ src, isOwn }: Props) {
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [bars, setBars] = useState<number[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    setBars(Array.from({ length: 32 }, () => 0.2 + Math.random() * 0.6));
  }, [src]);

  const tick = useCallback(() => {
    const a = audioRef.current;
    if (!a || a.paused) return;
    setProgress(a.currentTime / (a.duration || 1));
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  useEffect(() => {
    const a = new Audio(src);
    a.preload = 'metadata';
    audioRef.current = a;

    const onMeta = () => setDuration(a.duration || 0);
    const onEnd = () => { setPlaying(false); setProgress(0); };
    a.addEventListener('loadedmetadata', onMeta);
    a.addEventListener('ended', onEnd);

    return () => {
      a.pause();
      a.removeEventListener('loadedmetadata', onMeta);
      a.removeEventListener('ended', onEnd);
      cancelAnimationFrame(rafRef.current);
    };
  }, [src]);

  const togglePlay = (e: React.MouseEvent) => {
    e.stopPropagation();
    const a = audioRef.current;
    if (!a) return;
    if (playing) {
      a.pause();
      cancelAnimationFrame(rafRef.current);
      setPlaying(false);
    } else {
      a.play().then(() => {
        setPlaying(true);
        rafRef.current = requestAnimationFrame(tick);
      }).catch(() => {});
    }
  };

  const formatTime = (sec: number) => {
    if (!sec || !isFinite(sec)) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const remaining = duration - progress * duration;
  const SIZE = 44;
  const RADIUS = 18;
  const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

  return (
    <div className="flex items-center gap-3 min-w-[220px]">
      {/* Play button */}
      <button onClick={togglePlay}
        className={`w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0 transition-all ${
          isOwn ? 'bg-white/20 hover:bg-white/30' : 'bg-primary-600/20 hover:bg-primary-600/30'
        }`}>
        {/* Circular progress behind button */}
        <svg width={SIZE} height={SIZE} className="absolute" style={{ transform: 'rotate(-90deg)' }}>
          <circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS}
            fill="none" stroke={isOwn ? 'rgba(255,255,255,0.15)' : 'rgba(99,102,241,0.15)'} strokeWidth="2.5" />
          <circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS}
            fill="none" stroke={isOwn ? '#fff' : '#6366f1'} strokeWidth="2.5"
            strokeDasharray={CIRCUMFERENCE} strokeDashoffset={CIRCUMFERENCE * (1 - progress)}
            strokeLinecap="round" />
        </svg>
        {playing
          ? <FaPause size={14} className={`relative z-10 ${isOwn ? 'text-white' : 'text-primary-400'}`} />
          : <FaPlay size={14} className={`relative z-10 ml-0.5 ${isOwn ? 'text-white' : 'text-primary-400'}`} />
        }
      </button>

      {/* Waveform bars */}
      <div className="flex-1 flex items-center gap-[2px] h-8">
        {bars.map((h, i) => {
          const barProgress = i / bars.length;
          const filled = barProgress <= progress;
          return (
            <div key={i} className="flex-1 flex items-center justify-center">
              <div
                className={`w-full max-w-[3px] rounded-full transition-all duration-75 ${
                  filled
                    ? isOwn ? 'bg-white' : 'bg-primary-400'
                    : isOwn ? 'bg-white/30' : 'bg-primary-400/30'
                }`}
                style={{ height: `${h * 100}%` }}
              />
            </div>
          );
        })}
      </div>

      {/* Time */}
      <span className={`text-[10px] tabular-nums flex-shrink-0 w-8 text-right ${isOwn ? 'text-white/70' : 'text-gray-500'}`}>
        {playing ? formatTime(remaining) : formatTime(duration)}
      </span>
    </div>
  );
}
