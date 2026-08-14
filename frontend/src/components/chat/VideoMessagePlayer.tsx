'use client';
import { useState, useRef, useEffect } from 'react';
import { FaPlay, FaExpand } from 'react-icons/fa';

interface Props {
  src: string;
  isOwn?: boolean;
}

export default function VideoMessagePlayer({ src, isOwn }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [showOverlay, setShowOverlay] = useState(true);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handlePlay = () => { setIsPlaying(true); setShowOverlay(false); };
    const handlePause = () => setIsPlaying(false);
    const handleEnded = () => { setIsPlaying(false); setShowOverlay(true); };

    video.addEventListener('play', handlePlay);
    video.addEventListener('pause', handlePause);
    video.addEventListener('ended', handleEnded);

    return () => {
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', handlePause);
      video.removeEventListener('ended', handleEnded);
    };
  }, []);

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (isPlaying) {
      video.pause();
    } else {
      video.play().catch(() => {});
    }
  };

  return (
    // Telegram-style round "video circle" — the recorder's own live preview
    // (VideoMessageRecorder.tsx) is already a circle while recording, but
    // playback here used rounded-xl (a rounded square), so a sent message
    // didn't match what the sender saw themselves recording it as.
    <div className="relative rounded-full overflow-hidden w-full max-w-[240px] aspect-square bg-black">
      <video
        ref={videoRef}
        src={src}
        className="w-full h-full object-cover"
        playsInline
        preload="metadata"
        onClick={togglePlay}
      />

      {showOverlay && (
        <div
          className="absolute inset-0 flex items-center justify-center bg-black/30 cursor-pointer"
          onClick={togglePlay}
        >
          <div className="w-12 h-12 flex items-center justify-center rounded-full bg-white/20 backdrop-blur-sm">
            <FaPlay size={16} className="text-white ml-1" />
          </div>
        </div>
      )}
    </div>
  );
}
