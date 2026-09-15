"use client";

import React, { useEffect, useCallback } from "react";

interface ViewOnceModalProps {
  url: string;
  type: "image" | "video";
  onClose: () => void;
}

export default function ViewOnceModal({ url, type, onClose }: ViewOnceModalProps) {
  const handleDismiss = useCallback(() => {
    // Purge memory blob if it was a blob URL
    if (url.startsWith("blob:")) {
      try {
        URL.revokeObjectURL(url);
      } catch { /* ignore */ }
    }
    onClose();
  }, [url, onClose]);

  // Dismiss on Escape key
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleDismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleDismiss]);

  return (
    <div
      className="view-once-overlay"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 99999,
        background: "rgba(0, 0, 0, 0.96)",
        backdropFilter: "blur(12px)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        animation: "fadeIn 0.2s ease-out",
        userSelect: "none",
      }}
      onClick={handleDismiss}
    >
      {/* Top Header Bar */}
      <div
        style={{
          position: "absolute",
          top: "max(16px, env(safe-area-inset-top, 16px))",
          left: "20px",
          right: "20px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          color: "#fff",
          zIndex: 10,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            background: "rgba(255, 255, 255, 0.12)",
            padding: "6px 14px",
            borderRadius: "20px",
            fontSize: "13px",
            fontWeight: 600,
            border: "1px solid rgba(255, 255, 255, 0.2)",
          }}
        >
          <span style={{ color: "var(--green, #25d366)", fontSize: "15px" }}>①</span>
          <span>View Once {type === "image" ? "Photo" : "Video"}</span>
        </div>

        <button
          type="button"
          onClick={handleDismiss}
          style={{
            background: "rgba(255, 255, 255, 0.15)",
            border: "none",
            color: "#fff",
            width: "38px",
            height: "38px",
            borderRadius: "50%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            fontSize: "18px",
            transition: "transform 0.15s ease",
          }}
          aria-label="Close ephemeral media"
        >
          ✕
        </button>
      </div>

      {/* Main Ephemeral Media Display */}
      <div
        style={{
          maxWidth: "92vw",
          maxHeight: "80vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {type === "image" ? (
          <img
            src={url}
            alt="View Once Attachment"
            style={{
              maxWidth: "100%",
              maxHeight: "80vh",
              objectFit: "contain",
              borderRadius: "12px",
              boxShadow: "0 10px 40px rgba(0,0,0,0.6)",
            }}
          />
        ) : (
          <video
            src={url}
            autoPlay
            controls
            playsInline
            style={{
              maxWidth: "100%",
              maxHeight: "80vh",
              borderRadius: "12px",
              boxShadow: "0 10px 40px rgba(0,0,0,0.6)",
            }}
          />
        )}
      </div>

      {/* Bottom Ephemeral Warning Footer */}
      <div
        style={{
          position: "absolute",
          bottom: "max(24px, env(safe-area-inset-bottom, 24px))",
          color: "rgba(255, 255, 255, 0.65)",
          fontSize: "12px",
          fontWeight: 500,
          display: "flex",
          alignItems: "center",
          gap: "6px",
          letterSpacing: "0.2px",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <span>⏳ This media will disappear immediately upon closing</span>
      </div>
    </div>
  );
}
