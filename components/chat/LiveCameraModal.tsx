"use client";

import React, { useRef, useState, useEffect, useCallback } from "react";

export interface LiveCameraModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCapture: (file: File, previewUrl: string) => void;
}

export default function LiveCameraModal({ isOpen, onClose, onCapture }: LiveCameraModalProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");
  const [error, setError] = useState<string | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const [hasMultipleCameras, setHasMultipleCameras] = useState(true);

  // Stop current active stream
  const stopStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => {
        try {
          track.stop();
        } catch {}
      });
      streamRef.current = null;
    }
  }, []);

  // Start camera stream
  const startCamera = useCallback(async (mode: "environment" | "user") => {
    stopStream();
    setError(null);
    setIsInitializing(true);

    try {
      const constraints: MediaStreamConstraints = {
        audio: false,
        video: {
          facingMode: { ideal: mode },
          width: { ideal: 1920, max: 2560 },
          height: { ideal: 1080, max: 1440 },
        },
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setIsInitializing(false);

      // Check available devices
      if (navigator.mediaDevices.enumerateDevices) {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter(d => d.kind === "videoinput");
        setHasMultipleCameras(videoDevices.length > 1);
      }
    } catch (err: any) {
      console.warn("Failed to start in-app camera:", err);
      // Fallback with loose constraints
      try {
        const fallbackStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        streamRef.current = fallbackStream;
        if (videoRef.current) {
          videoRef.current.srcObject = fallbackStream;
          await videoRef.current.play().catch(() => {});
        }
        setIsInitializing(false);
      } catch (fallbackErr: any) {
        setError(fallbackErr?.message || "Camera access denied or unavailable");
        setIsInitializing(false);
      }
    }
  }, [stopStream]);

  useEffect(() => {
    if (isOpen) {
      startCamera(facingMode);
    } else {
      stopStream();
    }
    return () => {
      stopStream();
    };
  }, [isOpen, facingMode, startCamera, stopStream]);

  // Flip between front & back camera
  const handleFlipCamera = () => {
    if (navigator.vibrate) navigator.vibrate(20);
    setFacingMode(prev => (prev === "environment" ? "user" : "environment"));
  };

  // Capture snapshot from live video stream
  const handleSnap = () => {
    if (!videoRef.current || isInitializing) return;
    if (navigator.vibrate) navigator.vibrate(30);

    const video = videoRef.current;
    const width = video.videoWidth || 1280;
    const height = video.videoHeight || 720;

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Flip horizontally if using front camera
    if (facingMode === "user") {
      ctx.translate(width, 0);
      ctx.scale(-1, 1);
    }

    ctx.drawImage(video, 0, 0, width, height);

    canvas.toBlob(
      blob => {
        if (!blob) return;
        const fileName = `camera_${Date.now()}.jpg`;
        const file = new File([blob], fileName, { type: "image/jpeg" });
        const previewUrl = URL.createObjectURL(blob);
        stopStream();
        onCapture(file, previewUrl);
      },
      "image/jpeg",
      0.88
    );
  };

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 20000,
        background: "#000",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        userSelect: "none",
        touchAction: "none",
      }}
    >
      {/* Top Bar */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          padding: "max(16px, env(safe-area-inset-top, 16px)) 20px 16px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          zIndex: 10,
          background: "linear-gradient(to bottom, rgba(0,0,0,0.7) 0%, transparent 100%)",
        }}
      >
        <button
          onClick={onClose}
          type="button"
          aria-label="Close camera"
          style={{
            width: 44,
            height: 44,
            borderRadius: "50%",
            background: "rgba(255,255,255,0.15)",
            border: "1px solid rgba(255,255,255,0.2)",
            color: "#fff",
            fontSize: 20,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            backdropFilter: "blur(8px)",
          }}
        >
          ✕
        </button>

        {hasMultipleCameras && (
          <button
            onClick={handleFlipCamera}
            type="button"
            aria-label="Flip camera"
            style={{
              width: 44,
              height: 44,
              borderRadius: "50%",
              background: "rgba(255,255,255,0.15)",
              border: "1px solid rgba(255,255,255,0.2)",
              color: "#fff",
              fontSize: 22,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              backdropFilter: "blur(8px)",
            }}
          >
            🔄
          </button>
        )}
      </div>

      {/* Video Viewfinder */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          background: "#000",
        }}
      >
        {error ? (
          <div style={{ color: "#ef4444", textAlign: "center", padding: 24, maxWidth: 320 }}>
            <p style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Camera Error</p>
            <p style={{ fontSize: 13, color: "rgba(255,255,255,0.7)" }}>{error}</p>
            <button
              onClick={() => startCamera(facingMode)}
              style={{
                marginTop: 16,
                padding: "8px 18px",
                borderRadius: 8,
                background: "var(--primary, #22c55e)",
                color: "#fff",
                border: "none",
                fontSize: 14,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Retry
            </button>
          </div>
        ) : (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              transform: facingMode === "user" ? "scaleX(-1)" : "none",
            }}
          />
        )}
      </div>

      {/* Bottom Shutter Controls */}
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          padding: "24px 20px max(28px, env(safe-area-inset-bottom, 28px))",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 36,
          zIndex: 10,
          background: "linear-gradient(to top, rgba(0,0,0,0.8) 0%, transparent 100%)",
        }}
      >
        <button
          onClick={handleSnap}
          disabled={isInitializing || !!error}
          type="button"
          aria-label="Take snapshot"
          style={{
            width: 76,
            height: 76,
            borderRadius: "50%",
            background: "transparent",
            border: "4px solid #fff",
            padding: 4,
            cursor: isInitializing || !!error ? "not-allowed" : "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 0 20px rgba(0,0,0,0.6)",
            transition: "transform 0.15s ease",
            transform: "scale(1)",
          }}
          onMouseDown={e => (e.currentTarget.style.transform = "scale(0.92)")}
          onMouseUp={e => (e.currentTarget.style.transform = "scale(1)")}
          onTouchStart={e => (e.currentTarget.style.transform = "scale(0.92)")}
          onTouchEnd={e => (e.currentTarget.style.transform = "scale(1)")}
        >
          <div
            style={{
              width: "100%",
              height: "100%",
              borderRadius: "50%",
              background: isInitializing ? "rgba(255,255,255,0.4)" : "#fff",
              boxShadow: "0 0 10px rgba(0,0,0,0.2)",
            }}
          />
        </button>
      </div>
    </div>
  );
}
