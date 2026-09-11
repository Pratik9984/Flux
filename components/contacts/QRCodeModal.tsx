"use client";

import React, { useState, useEffect, useRef } from "react";
import { useAuthStore } from "@/stores/authStore";
import { connectViaQRApi } from "@/lib/api";
import { useContactStore } from "@/stores/contactStore";

interface QRCodeModalProps {
  onClose: () => void;
  onConnected?: (contact: any) => void;
}

export const QRCodeModal: React.FC<QRCodeModalProps> = ({ onClose, onConnected }) => {
  const [activeTab, setActiveTab] = useState<"my_code" | "scan">("my_code");
  const [scanInput, setScanInput] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [scanSuccess, setScanSuccess] = useState<string | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Live Camera Scanner State
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanningIntervalRef = useRef<any>(null);
  const galleryInputRef = useRef<HTMLInputElement | null>(null);

  const currentUser = useAuthStore((s) => s.currentUser);
  const profile = useAuthStore((s) => s.profile);
  const token = useAuthStore((s) => s.token);
  const addContact = useContactStore((s) => s.addContact);

  const myIdentifier = profile?.username || currentUser || "user";
  const qrData = `pulse:connect:${myIdentifier}`;
  const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=260x260&margin=8&color=18-28-31&bgcolor=ffffff&data=${encodeURIComponent(
    qrData
  )}`;

  const handleCopyLink = () => {
    navigator.clipboard.writeText(`pulse:connect:${myIdentifier}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const executeConnect = async (rawInput: string) => {
    const raw = rawInput.trim();
    if (!raw) return;

    setIsSubmitting(true);
    setScanError(null);
    setScanSuccess(null);

    try {
      const res = await connectViaQRApi(raw, token);
      if (res.contact) {
        addContact(res.contact);
        if (onConnected) onConnected(res.contact);
      }
      setScanSuccess(res.message || "Successfully connected as mutual contacts!");
      setScanInput("");
      stopCamera();
    } catch (err: any) {
      setScanError(err.message || "Failed to connect via QR code");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleManualSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    executeConnect(scanInput);
  };

  // ── Camera Scanner Lifecycle ────────────────────────────────────────────────
  const stopCamera = () => {
    if (scanningIntervalRef.current) {
      clearInterval(scanningIntervalRef.current);
      scanningIntervalRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
  };

  const startCamera = async () => {
    stopCamera();
    setCameraError(null);

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("Camera is not supported on this device or browser.");
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.setAttribute("playsinline", "true");
        await videoRef.current.play();
      }
      setCameraActive(true);

      // Start detection loop if BarcodeDetector is available
      const BarcodeDetectorClass = (window as any).BarcodeDetector;
      if (BarcodeDetectorClass) {
        const detector = new BarcodeDetectorClass({ formats: ["qr_code"] });
        scanningIntervalRef.current = setInterval(async () => {
          if (!videoRef.current || videoRef.current.readyState < 2) return;
          try {
            const codes = await detector.detect(videoRef.current);
            if (codes && codes.length > 0 && codes[0].rawValue) {
              const detected = codes[0].rawValue.trim();
              if (detected) {
                if (navigator.vibrate) navigator.vibrate(50);
                stopCamera();
                executeConnect(detected);
              }
            }
          } catch {}
        }, 250);
      }
    } catch (err: any) {
      console.warn("Camera start failed:", err);
      setCameraError(err.message || "Could not access camera. Please allow permissions or enter code manually.");
      setCameraActive(false);
    }
  };

  // Start camera when entering scan tab, stop when leaving
  useEffect(() => {
    if (activeTab === "scan") {
      startCamera();
    } else {
      stopCamera();
    }
    return () => {
      stopCamera();
    };
  }, [activeTab]);

  // Handle image upload decode from gallery
  const handleGalleryImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setScanError(null);
    setScanSuccess(null);

    try {
      const BarcodeDetectorClass = (window as any).BarcodeDetector;
      if (BarcodeDetectorClass) {
        const detector = new BarcodeDetectorClass({ formats: ["qr_code"] });
        const img = new Image();
        const objectUrl = URL.createObjectURL(file);
        img.src = objectUrl;
        await img.decode();
        const codes = await detector.detect(img);
        URL.revokeObjectURL(objectUrl);

        if (codes && codes.length > 0 && codes[0].rawValue) {
          executeConnect(codes[0].rawValue);
          return;
        }
      }
      // If BarcodeDetector not supported or didn't find code in image
      setScanError("No QR code detected in the selected image. Please try another photo or enter code manually.");
    } catch (err: any) {
      setScanError("Could not decode QR code from image: " + (err.message || "unknown error"));
    } finally {
      e.target.value = "";
    }
  };

  return (
    <div className="modal-backdrop-sage" onClick={onClose} style={{ zIndex: 1250 }}>
      <div
        className="contacts-modal-container"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "92vw",
          maxWidth: 420,
          borderRadius: 28,
          background: "#ffffff",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: "0 20px 60px rgba(0, 0, 0, 0.25)",
          border: "1px solid rgba(0,0,0,0.06)",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "20px 22px 14px",
            borderBottom: "1px solid rgba(0,0,0,0.06)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div>
            <h3 style={{ fontSize: 20, fontWeight: 800, color: "#181c1f", margin: 0 }}>
              QR Code Connect
            </h3>
            <p style={{ fontSize: 13, color: "#8a9096", margin: "2px 0 0", fontWeight: 500 }}>
              Instant friend adding without typing
            </p>
          </div>
          <button
            onClick={() => {
              stopCamera();
              onClose();
            }}
            style={{
              width: 36,
              height: 36,
              borderRadius: "50%",
              background: "#f4f5f7",
              border: "none",
              color: "#181c1f",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              fontSize: 14,
              fontWeight: 700,
            }}
          >
            ✕
          </button>
        </div>

        {/* Tab Buttons */}
        <div style={{ padding: "12px 20px 6px", display: "flex", gap: 8 }}>
          <button
            onClick={() => setActiveTab("my_code")}
            style={{
              flex: 1,
              padding: "9px 12px",
              borderRadius: 14,
              border: "none",
              background: activeTab === "my_code" ? "#6daf78" : "#f4f5f7",
              color: activeTab === "my_code" ? "#ffffff" : "#60646c",
              fontWeight: 700,
              fontSize: 13,
              cursor: "pointer",
              transition: "all 0.15s ease",
            }}
          >
            My QR Code
          </button>
          <button
            onClick={() => setActiveTab("scan")}
            style={{
              flex: 1,
              padding: "9px 12px",
              borderRadius: 14,
              border: "none",
              background: activeTab === "scan" ? "#6daf78" : "#f4f5f7",
              color: activeTab === "scan" ? "#ffffff" : "#60646c",
              fontWeight: 700,
              fontSize: 13,
              cursor: "pointer",
              transition: "all 0.15s ease",
            }}
          >
            Scan & Connect
          </button>
        </div>

        {/* Content */}
        <div style={{ padding: "16px 22px 24px", maxHeight: "75vh", overflowY: "auto" }}>
          {activeTab === "my_code" ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>
              {/* QR Image Box */}
              <div
                style={{
                  background: "#ffffff",
                  padding: 16,
                  borderRadius: 22,
                  boxShadow: "0 8px 30px rgba(0,0,0,0.08)",
                  border: "1px solid rgba(0,0,0,0.06)",
                  position: "relative",
                  marginBottom: 16,
                }}
              >
                <img
                  src={qrCodeUrl}
                  alt="My Pulse QR Code"
                  style={{ width: 200, height: 200, display: "block", borderRadius: 12 }}
                />
              </div>

              <div style={{ fontSize: 16, fontWeight: 800, color: "#181c1f", marginBottom: 2 }}>
                {profile?.displayName || profile?.username || currentUser || "Pulse User"}
              </div>
              {profile?.username && (
                <div style={{ fontSize: 13, color: "#6daf78", fontWeight: 700, marginBottom: 12 }}>
                  @{profile.username}
                </div>
              )}

              <p style={{ fontSize: 12.5, color: "#8a9096", margin: "0 0 16px", maxWidth: 260, lineHeight: 1.4 }}>
                Have your friend scan this QR code or share your link to instantly become mutual contacts.
              </p>

              <button
                onClick={handleCopyLink}
                style={{
                  width: "100%",
                  padding: "11px 16px",
                  borderRadius: 14,
                  border: "none",
                  background: copied ? "#4e9158" : "#6daf78",
                  color: "#ffffff",
                  fontWeight: 700,
                  fontSize: 13.5,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  boxShadow: "0 3px 12px rgba(109, 175, 120, 0.3)",
                  transition: "background 0.2s ease",
                }}
              >
                {copied ? "✓ Copied to Clipboard!" : "Copy Connect Code"}
              </button>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {/* Live Camera Viewfinder Box */}
              <div
                style={{
                  position: "relative",
                  width: "100%",
                  height: 220,
                  borderRadius: 20,
                  overflow: "hidden",
                  background: "#050606",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  border: "2px solid rgba(109, 175, 120, 0.4)",
                  boxShadow: "0 8px 24px rgba(0,0,0,0.15)",
                }}
              >
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                  }}
                />

                {/* Target Reticle Overlay */}
                <div
                  style={{
                    position: "absolute",
                    width: 140,
                    height: 140,
                    border: "2px solid #6daf78",
                    borderRadius: 16,
                    boxShadow: "0 0 0 9999px rgba(0, 0, 0, 0.45)",
                    pointerEvents: "none",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <div
                    style={{
                      width: "90%",
                      height: 2,
                      background: "linear-gradient(90deg, transparent, #82c28c, transparent)",
                      animation: "pulse 1.5s infinite",
                    }}
                  />
                </div>

                {!cameraActive && (
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      background: "rgba(5,6,6,0.85)",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      padding: 16,
                      textAlign: "center",
                    }}
                  >
                    <span style={{ fontSize: 28, marginBottom: 8 }}>📷</span>
                    <span style={{ color: "#fff", fontSize: 13, fontWeight: 600, marginBottom: 12 }}>
                      {cameraError || "Camera scanner ready"}
                    </span>
                    <button
                      type="button"
                      onClick={startCamera}
                      style={{
                        padding: "8px 16px",
                        borderRadius: 12,
                        background: "#6daf78",
                        border: "none",
                        color: "#fff",
                        fontSize: 12.5,
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      Enable Camera
                    </button>
                  </div>
                )}
              </div>

              {/* Gallery QR Upload Button */}
              <input
                ref={galleryInputRef}
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={handleGalleryImageChange}
              />
              <button
                type="button"
                onClick={() => galleryInputRef.current?.click()}
                style={{
                  width: "100%",
                  padding: "10px 14px",
                  borderRadius: 14,
                  border: "1px solid rgba(109, 175, 120, 0.35)",
                  background: "rgba(109, 175, 120, 0.08)",
                  color: "#275530",
                  fontWeight: 700,
                  fontSize: 13,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                }}
              >
                <span>🖼️</span>
                <span>Scan from Photo / Gallery</span>
              </button>

              {scanSuccess && (
                <div style={{ background: "#f6ffed", border: "1px solid #b7eb8f", borderRadius: 10, padding: "8px 12px", color: "#389e0d", fontSize: 12.5, fontWeight: 600 }}>
                  ✓ {scanSuccess}
                </div>
              )}

              {scanError && (
                <div style={{ background: "#fff1f0", border: "1px solid #ffa39e", borderRadius: 10, padding: "8px 12px", color: "#cf1322", fontSize: 12.5, fontWeight: 600 }}>
                  ✕ {scanError}
                </div>
              )}

              {/* Manual Code Input Form */}
              <form onSubmit={handleManualSubmit} style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 4 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#8a9096" }}>
                  Or enter connect code manually:
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    value={scanInput}
                    onChange={(e) => setScanInput(e.target.value)}
                    placeholder="pulse:connect:username or @username"
                    style={{
                      flex: 1,
                      height: 42,
                      borderRadius: 12,
                      border: "1.5px solid rgba(109, 175, 120, 0.35)",
                      background: "#f7f9f7",
                      padding: "0 12px",
                      fontSize: 13,
                      color: "#181c1f",
                      fontWeight: 500,
                      outline: "none",
                    }}
                  />
                  <button
                    type="submit"
                    disabled={isSubmitting || !scanInput.trim()}
                    style={{
                      padding: "0 16px",
                      borderRadius: 12,
                      border: "none",
                      background: "#6daf78",
                      color: "#ffffff",
                      fontWeight: 700,
                      fontSize: 13,
                      cursor: isSubmitting || !scanInput.trim() ? "not-allowed" : "pointer",
                      opacity: isSubmitting || !scanInput.trim() ? 0.6 : 1,
                    }}
                  >
                    {isSubmitting ? "..." : "Connect"}
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default QRCodeModal;
