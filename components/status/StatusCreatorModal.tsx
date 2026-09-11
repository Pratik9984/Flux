"use client";

import React, { useState, useRef } from "react";
import { uploadMediaToBackend, createStatusApi } from "@/lib/api";
import { compressImage } from "@/lib/utils";

interface StatusCreatorModalProps {
  initialMode?: "text" | "media";
  onClose: () => void;
  onSuccess: () => void;
}

const GRADIENTS = [
  "linear-gradient(135deg, #0ba360 0%, #3cba92 100%)",      // Emerald
  "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",      // Royal Violet
  "linear-gradient(135deg, #f093fb 0%, #f5576c 100%)",      // Berry Sunset
  "linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)",      // Ocean Blue
  "linear-gradient(135deg, #fa709a 0%, #fee140 100%)",      // Sunrise
  "linear-gradient(135deg, #30cfd0 0%, #330867 100%)",      // Cyberpunk
  "linear-gradient(135deg, #ff0844 0%, #ffb199 100%)",      // Flame
  "linear-gradient(135deg, #182848 0%, #4b6cb7 100%)",      // Midnight
];

const FONTS = [
  { id: "default", name: "Bold", style: { fontFamily: "system-ui, -apple-system, sans-serif", fontWeight: 700 } },
  { id: "serif", name: "Serif", style: { fontFamily: "Georgia, serif", fontStyle: "italic", fontWeight: 600 } },
  { id: "casual", name: "Casual", style: { fontFamily: "'Comic Sans MS', 'Caveat', cursive", fontWeight: 600 } },
  { id: "mono", name: "Mono", style: { fontFamily: "'Courier New', Courier, monospace", fontWeight: 700 } },
];

export default function StatusCreatorModal({
  initialMode = "text",
  onClose,
  onSuccess,
}: StatusCreatorModalProps) {
  const [mode, setMode] = useState<"text" | "media">(initialMode);
  const [text, setText] = useState("");
  const [gradientIdx, setGradientIdx] = useState(0);
  const [fontIdx, setFontIdx] = useState(0);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [caption, setCaption] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleNextGradient = () => {
    setGradientIdx((prev) => (prev + 1) % GRADIENTS.length);
  };

  const handleNextFont = () => {
    setFontIdx((prev) => (prev + 1) % FONTS.length);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Check video duration limit (30s maximum)
    if (file.type.startsWith("video/")) {
      try {
        const duration = await new Promise<number>((resolve) => {
          const video = document.createElement("video");
          video.preload = "metadata";
          const tempUrl = URL.createObjectURL(file);
          video.onloadedmetadata = () => {
            URL.revokeObjectURL(tempUrl);
            resolve(video.duration || 0);
          };
          video.onerror = () => {
            URL.revokeObjectURL(tempUrl);
            resolve(0); // Fallback if metadata probe fails
          };
          video.src = tempUrl;
        });

        if (duration > 30.5) {
          setErrorMsg("Video status cannot exceed 30 seconds");
          return;
        }
      } catch (err) {
        console.warn("Could not probe video duration:", err);
      }
    }

    // Auto-compress image to keep disk space minimal during 24h lifespan (Option B)
    if (file.type.startsWith("image/")) {
      try {
        const compressedDataUrl = await compressImage(file, 1400, 0.82);
        if (compressedDataUrl && compressedDataUrl.startsWith("data:")) {
          const blob = await (await fetch(compressedDataUrl)).blob();
          const cleanName = (file.name || "status.jpg").replace(/\.[^/.]+$/, "") + ".jpg";
          const compressedFile = new File([blob], cleanName, { type: "image/jpeg" });
          setSelectedFile(compressedFile);
          setPreviewUrl(URL.createObjectURL(blob));
        } else {
          setSelectedFile(file);
          setPreviewUrl(URL.createObjectURL(file));
        }
      } catch {
        setSelectedFile(file);
        setPreviewUrl(URL.createObjectURL(file));
      }
    } else {
      setSelectedFile(file);
      setPreviewUrl(URL.createObjectURL(file));
    }
    setMode("media");
    setErrorMsg("");
  };

  const handleSubmit = async () => {
    if (submitting) return;
    setErrorMsg("");

    if (mode === "text") {
      const trimmed = text.trim();
      if (!trimmed) {
        setErrorMsg("Please type something for your status");
        return;
      }

      setSubmitting(true);
      try {
        await createStatusApi({
          content_text: trimmed,
          bg_color: GRADIENTS[gradientIdx],
          font_style: FONTS[fontIdx].id,
        });
        onSuccess();
      } catch (err: any) {
        setErrorMsg(err.message || "Failed to post status");
      } finally {
        setSubmitting(false);
      }
    } else {
      if (!selectedFile) {
        setErrorMsg("Please select a photo or video");
        return;
      }

      setSubmitting(true);
      try {
        // Upload media file to backend
        const { url } = await uploadMediaToBackend(selectedFile);
        await createStatusApi({
          media_url: url,
          content_text: caption.trim() || null,
        });
        onSuccess();
      } catch (err: any) {
        setErrorMsg(err.message || "Failed to post media status");
      } finally {
        setSubmitting(false);
      }
    }
  };

  const currentGradient = GRADIENTS[gradientIdx];
  const currentFont = FONTS[fontIdx];

  return (
    <div className="status-creator-portal">
      {/* ── Top Bar ── */}
      <div className="status-creator-topbar">
        <button className="status-creator-close-btn" onClick={onClose} aria-label="Close">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        <div className="status-creator-tools">
          {mode === "text" && (
            <>
              {/* Font Switcher */}
              <button
                className="status-tool-btn"
                onClick={handleNextFont}
                title="Change font"
              >
                <span style={{ fontSize: 13, fontWeight: 700 }}>{currentFont.name}</span>
              </button>

              {/* Color Switcher */}
              <button
                className="status-tool-btn status-color-btn"
                onClick={handleNextGradient}
                title="Change background color"
                style={{ background: currentGradient }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5">
                  <circle cx="12" cy="12" r="10" />
                </svg>
              </button>
            </>
          )}

          {/* Switch Mode Button */}
          <button
            className="status-tool-btn"
            onClick={() => {
              if (mode === "text") {
                fileInputRef.current?.click();
              } else {
                setMode("text");
                setSelectedFile(null);
                setPreviewUrl(null);
              }
            }}
            title={mode === "text" ? "Add Photo/Video" : "Switch to Text Status"}
          >
            {mode === "text" ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21 15 16 10 5 21" />
              </svg>
            ) : (
              <span style={{ fontSize: 13, fontWeight: 800 }}>T</span>
            )}
          </button>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,video/*"
        style={{ display: "none" }}
        onChange={handleFileChange}
      />

      {/* ── Main Canvas ── */}
      <div
        className="status-creator-canvas"
        style={{
          background: mode === "text" ? currentGradient : "#000000",
        }}
      >
        {mode === "text" ? (
          <div className="status-text-editor-wrap">
            <textarea
              className="status-text-textarea"
              style={currentFont.style}
              placeholder="Type a status..."
              value={text}
              maxLength={700}
              autoFocus
              onChange={(e) => setText(e.target.value)}
            />
          </div>
        ) : (
          <div className="status-media-preview-wrap">
            {previewUrl && selectedFile?.type.startsWith("video/") ? (
              <video
                src={previewUrl}
                controls
                playsInline
                className="status-preview-media"
              />
            ) : previewUrl ? (
              <img
                src={previewUrl}
                alt="Status preview"
                className="status-preview-media"
              />
            ) : (
              <div
                className="status-pick-media-prompt"
                onClick={() => fileInputRef.current?.click()}
              >
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#6daf78" strokeWidth="2">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                  <circle cx="12" cy="13" r="4" />
                </svg>
                <span>Tap to choose a photo or video</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Bottom Bar / Send ── */}
      <div className="status-creator-bottombar">
        {mode === "media" && previewUrl && (
          <div className="status-caption-row">
            <input
              type="text"
              className="status-caption-input"
              placeholder="Add a caption..."
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              maxLength={250}
            />
          </div>
        )}

        {errorMsg && <div className="status-creator-err">{errorMsg}</div>}

        <div className="status-creator-send-row">
          <span className="status-recipient-hint">Status (Contacts)</span>
          <button
            className="status-creator-send-btn"
            onClick={handleSubmit}
            disabled={submitting}
            aria-label="Send status"
          >
            {submitting ? (
              <div className="status-spinner" />
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
