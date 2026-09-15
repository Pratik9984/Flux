"use client";

import React, { useState, useRef, useEffect } from "react";

interface VoiceNoteRecorderProps {
  onFinish: (blob: Blob, durationSec: number) => void;
  onCancel: () => void;
}

export default function VoiceNoteRecorder({ onFinish, onCancel }: VoiceNoteRecorderProps) {
  const [elapsedSec, setElapsedSec] = useState(0);
  const [volumeLevels, setVolumeLevels] = useState<number[]>([15, 20, 25, 20, 15, 10, 18, 22]);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);

  useEffect(() => {
    let isCancelled = false;

    async function startRecording() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (isCancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;

        // Set up Web Audio Analyser for live frequency visualization
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioCtx) {
          const ctx = new AudioCtx();
          audioContextRef.current = ctx;
          const source = ctx.createMediaStreamSource(stream);
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 32;
          source.connect(analyser);
          analyserRef.current = analyser;

          const dataArray = new Uint8Array(analyser.frequencyBinCount);
          const updateVolume = () => {
            if (!analyserRef.current) return;
            analyserRef.current.getByteFrequencyData(dataArray);
            // Sample 8 volume bands
            const levels: number[] = [];
            const step = Math.max(1, Math.floor(dataArray.length / 8));
            for (let i = 0; i < 8; i++) {
              const val = dataArray[i * step] || 0;
              // Map 0..255 to 10..32 px height
              const height = Math.max(8, Math.min(32, Math.round((val / 255) * 32)));
              levels.push(height);
            }
            setVolumeLevels(levels);
            animFrameRef.current = requestAnimationFrame(updateVolume);
          };
          updateVolume();
        }

        // Initialize MediaRecorder
        const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : MediaRecorder.isTypeSupported("audio/mp4")
          ? "audio/mp4"
          : "";

        const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
        mediaRecorderRef.current = recorder;
        chunksRef.current = [];

        recorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) {
            chunksRef.current.push(e.data);
          }
        };

        recorder.start(100);
        startTimeRef.current = Date.now();

        timerRef.current = setInterval(() => {
          setElapsedSec((prev) => prev + 1);
        }, 1000);
      } catch (err) {
        console.error("Microphone access failed:", err);
        onCancel();
      }
    }

    startRecording();

    return () => {
      isCancelled = true;
      if (timerRef.current) clearInterval(timerRef.current);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (audioContextRef.current && audioContextRef.current.state !== "closed") {
        audioContextRef.current.close().catch(() => {});
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, [onCancel]);

  const handleStopAndSend = () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === "inactive") return;

    recorder.onstop = () => {
      const type = recorder.mimeType || "audio/webm";
      const audioBlob = new Blob(chunksRef.current, { type });
      const durationSec = Math.max(1, Math.round((Date.now() - startTimeRef.current) / 1000));
      onFinish(audioBlob, durationSec);
    };

    recorder.stop();
  };

  const handleDiscard = () => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.onstop = null;
      recorder.stop();
    }
    onCancel();
  };

  const formatTimer = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s < 10 ? "0" : ""}${s}`;
  };

  return (
    <div
      className="voice-recorder-bar"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        width: "100%",
        padding: "6px 12px",
        background: "var(--bg-2, #f5f5f5)",
        borderRadius: "24px",
        gap: "12px",
        boxShadow: "inset 0 1px 3px rgba(0,0,0,0.06)",
      }}
    >
      {/* Delete / Cancel Button */}
      <button
        type="button"
        onClick={handleDiscard}
        style={{
          background: "rgba(255, 68, 68, 0.12)",
          border: "none",
          borderRadius: "50%",
          width: "36px",
          height: "36px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#ff4444",
          cursor: "pointer",
          flexShrink: 0,
          transition: "transform 0.15s ease",
        }}
        title="Discard voice recording"
        aria-label="Discard recording"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        </svg>
      </button>

      {/* Pulsing Mic Dot & Elapsed Time */}
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <div
          style={{
            width: "10px",
            height: "10px",
            borderRadius: "50%",
            background: "#ff3b30",
            animation: "pulse 1.2s infinite ease-in-out",
          }}
        />
        <span style={{ fontSize: "14px", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
          {formatTimer(elapsedSec)}
        </span>
      </div>

      {/* Dynamic Live Decibel Bars */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "3px",
          height: "32px",
          flex: 1,
          justifyContent: "center",
          maxWidth: "140px",
        }}
      >
        {volumeLevels.map((lvl, idx) => (
          <div
            key={idx}
            style={{
              width: "3px",
              height: `${lvl}px`,
              borderRadius: "2px",
              background: "var(--green, #25d366)",
              transition: "height 0.08s ease",
            }}
          />
        ))}
      </div>

      {/* Send Button */}
      <button
        type="button"
        onClick={handleStopAndSend}
        style={{
          background: "var(--green, #25d366)",
          border: "none",
          borderRadius: "50%",
          width: "38px",
          height: "38px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#ffffff",
          cursor: "pointer",
          flexShrink: 0,
          boxShadow: "0 2px 8px rgba(37, 211, 102, 0.35)",
          transition: "transform 0.15s ease",
        }}
        title="Send voice note"
        aria-label="Send voice note"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
          <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
        </svg>
      </button>
    </div>
  );
}
