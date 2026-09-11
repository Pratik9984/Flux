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

  const fallbackInputRef = useRef<HTMLInputElement | null>(null);

  // Start camera stream
  const startCamera = useCallback(async (mode: "environment" | "user") => {
    stopStream();
    setError(null);
    setIsInitializing(true);

    if (typeof navigator === "undefined" || !navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function") {
      const isNotSecure = typeof window !== "undefined" && window.isSecureContext === false;
      const msg = isNotSecure
        ? "In-app camera streaming requires HTTPS or localhost (Secure Context). When connecting over local IP, use localhost or the System Camera button below."
        : "In-app camera is not supported in this browser.";
      console.warn(msg);
      setError(msg);
      setIsInitializing(false);
      return;
    }

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
      console.warn("Failed to start in-app camera with ideal constraints:", err);
      // Fallback with loose constraints if mediaDevices is available
      if (navigator?.mediaDevices?.getUserMedia) {
        try {
          const fallbackStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
          streamRef.current = fallbackStream;
          if (videoRef.current) {
            videoRef.current.srcObject = fallbackStream;
            await videoRef.current.play().catch(() => {});
          }
          setIsInitializing(false);
          return;
        } catch (fallbackErr: any) {
          setError(fallbackErr?.message || "Camera access denied or unavailable");
          setIsInitializing(false);
          return;
        }
      }
      setError(err?.message || "Camera access denied or unavailable");
      setIsInitializing(false);
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

  // Handle fallback native file capture
  const handleFallbackFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const previewUrl = URL.createObjectURL(file);
    stopStream();
    onCapture(file, previewUrl);
    e.target.value = "";
  };

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
          <div style={{ color: "#ef4444", textAlign: "center", padding: 24, maxWidth: 360 }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>📷</div>
            <p style={{ fontSize: 16, fontWeight: 600, marginBottom: 8, color: "#fff" }}>Camera Unavailable</p>
            <p style={{ fontSize: 13, color: "rgba(255,255,255,0.7)", lineHeight: 1.5 }}>{error}</p>
            
            <input
              ref={fallbackInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              style={{ display: "none" }}
              onChange={handleFallbackFile}
            />

            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 20 }}>
              <button
                onClick={() => fallbackInputRef.current?.click()}
                type="button"
                style={{
                  padding: "10px 18px",
                  borderRadius: 10,
                  background: "#25d366",
                  color: "#000",
                  border: "none",
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                }}
              >
                <span>📸</span> Use System Camera / File
              </button>

              <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
                <button
                  onClick={() => startCamera(facingMode)}
                  type="button"
                  style={{
                    flex: 1,
                    padding: "8px 16px",
                    borderRadius: 8,
                    background: "rgba(255,255,255,0.15)",
                    color: "#fff",
                    border: "1px solid rgba(255,255,255,0.2)",
                    fontSize: 13,
                    fontWeight: 500,
                    cursor: "pointer",
                  }}
                >
                  Retry
                </button>
                <button
                  onClick={onClose}
                  type="button"
                  style={{
                    flex: 1,
                    padding: "8px 16px",
                    borderRadius: 8,
                    background: "rgba(255,255,255,0.1)",
                    color: "rgba(255,255,255,0.7)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    fontSize: 13,
                    fontWeight: 500,
                    cursor: "pointer",
                  }}
                >
                  Close
                </button>
              </div>
            </div>
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
