"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";

interface VoiceNotePlayerProps {
  src: string;
  isMine: boolean;
}

// Generate deterministic waveform heights for realistic speech rhythm
function generateWaveformBars(seedStr: string, count = 36): number[] {
  let hash = 0;
  for (let i = 0; i < seedStr.length; i++) {
    hash = (hash << 5) - hash + seedStr.charCodeAt(i);
    hash |= 0;
  }
  const bars: number[] = [];
  for (let i = 0; i < count; i++) {
    const pseudo = Math.abs(Math.sin(hash + i * 0.45) * 0.7 + Math.cos(i * 0.3) * 0.3);
    const height = Math.max(18, Math.min(100, Math.round(pseudo * 100)));
    bars.push(height);
  }
  return bars;
}

export default function VoiceNotePlayer({ src, isMine }: VoiceNotePlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const waveformRef = useRef<HTMLDivElement | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [speed, setSpeed] = useState<number>(1.0);
  const [isLoaded, setIsLoaded] = useState(false);

  // Initialize playback speed from localStorage
  useEffect(() => {
    try {
      const savedSpeed = localStorage.getItem("flux_voice_speed");
      if (savedSpeed) {
        const val = parseFloat(savedSpeed);
        if ([1.0, 1.5, 2.0].includes(val)) {
          setSpeed(val);
          if (audioRef.current) audioRef.current.playbackRate = val;
        }
      }
    } catch { /* ignore */ }
  }, []);

  const bars = React.useMemo(() => generateWaveformBars(src || "default", 34), [src]);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
    } else {
      audio.playbackRate = speed;
      audio.play().then(() => setIsPlaying(true)).catch(() => {});
    }
  }, [isPlaying, speed]);

  const cycleSpeed = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const nextSpeed = speed === 1.0 ? 1.5 : speed === 1.5 ? 2.0 : 1.0;
    setSpeed(nextSpeed);
    if (audioRef.current) {
      audioRef.current.playbackRate = nextSpeed;
    }
    try {
      localStorage.setItem("flux_voice_speed", String(nextSpeed));
    } catch { /* ignore */ }
  }, [speed]);

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    if (audioRef.current) {
      const d = audioRef.current.duration;
      if (isFinite(d) && d > 0) {
        setDuration(d);
      }
      setIsLoaded(true);
    }
  };

  const handleEnded = () => {
    setIsPlaying(false);
    setCurrentTime(0);
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    const el = waveformRef.current;
    const audio = audioRef.current;
    if (!el || !audio || !duration) return;

    const rect = el.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const pct = Math.max(0, Math.min(1, clickX / rect.width));
    const newTime = pct * duration;
    audio.currentTime = newTime;
    setCurrentTime(newTime);
  };

  const formatTime = (secs: number) => {
    if (!isFinite(secs) || secs <= 0) return "0:00";
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? "0" : ""}${s}`;
  };

  const progress = duration > 0 ? currentTime / duration : 0;

  return (
    <div
      className={`voice-note-player ${isMine ? "voice-mine" : "voice-theirs"}`}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "10px",
        padding: "6px 8px",
        minWidth: "250px",
        maxWidth: "310px",
        userSelect: "none",
      }}
    >
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={handleEnded}
      />

      {/* Play/Pause Circle Button */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          togglePlay();
        }}
        aria-label={isPlaying ? "Pause voice note" : "Play voice note"}
        style={{
          width: "40px",
          height: "40px",
          borderRadius: "50%",
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          border: "none",
          cursor: "pointer",
          background: isMine ? "rgba(255, 255, 255, 0.25)" : "var(--green, #25d366)",
          color: "#fff",
          fontSize: "17px",
          transition: "transform 0.15s ease, background 0.15s ease",
          boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
        }}
        onMouseDown={(e) => (e.currentTarget.style.transform = "scale(0.93)")}
        onMouseUp={(e) => (e.currentTarget.style.transform = "scale(1)")}
      >
        {isPlaying ? (
          // Pause Icon
          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="4" width="4" height="16" rx="1.5" />
            <rect x="14" y="4" width="4" height="16" rx="1.5" />
          </svg>
        ) : (
          // Play Icon
          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" style={{ marginLeft: "2px" }}>
            <polygon points="5 3 19 12 5 21 5 3" />
          </svg>
        )}
      </button>

      {/* Waveform Bars & Time Info */}
      <div style={{ display: "flex", flexDirection: "column", flex: 1, gap: "4px" }}>
        <div
          ref={waveformRef}
          onClick={handleSeek}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "2.5px",
            height: "28px",
            cursor: "pointer",
            padding: "2px 0",
          }}
          title="Click to scrub"
        >
          {bars.map((barHeight, idx) => {
            const barProgress = idx / bars.length;
            const isPlayed = barProgress <= progress;
            return (
              <div
                key={idx}
                style={{
                  width: "3px",
                  height: `${Math.max(18, (barHeight / 100) * 26)}px`,
                  borderRadius: "2px",
                  background: isPlayed
                    ? (isMine ? "#ffffff" : "var(--green, #25d366)")
                    : (isMine ? "rgba(255, 255, 255, 0.4)" : "rgba(0, 0, 0, 0.22)"),
                  transition: "background 0.1s linear",
                }}
              />
            );
          })}
        </div>

        {/* Time / Duration & Speed Pill */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            fontSize: "11px",
            fontWeight: 500,
            opacity: 0.85,
            color: isMine ? "#ffffff" : "var(--text-2, #666)",
          }}
        >
          <span>{isPlaying ? formatTime(currentTime) : formatTime(duration || 0)}</span>

          {/* Speed Toggle Pill */}
          <button
            type="button"
            onClick={cycleSpeed}
            style={{
              background: isMine ? "rgba(255, 255, 255, 0.2)" : "rgba(0, 0, 0, 0.08)",
              border: "none",
              borderRadius: "10px",
              padding: "2px 7px",
              fontSize: "10px",
              fontWeight: 700,
              cursor: "pointer",
              color: "inherit",
              letterSpacing: "0.2px",
              transition: "background 0.15s ease",
            }}
            title="Toggle playback speed"
          >
            {speed.toFixed(1)}x
          </button>
        </div>
      </div>
    </div>
  );
}
