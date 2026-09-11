"use client";

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import type { UserStatusGroup, StatusItem, StatusViewEntry } from "@/types";
import { formatTimeAgo } from "@/lib/utils";
import { API, markStatusViewedApi, deleteStatusApi, fetchStatusViewsApi } from "@/lib/api";
import { AvatarImage } from "@/components/ui/AvatarImage";

interface StatusViewerModalProps {
  initialGroup: UserStatusGroup;
  allGroups: UserStatusGroup[];
  currentUserEmail: string;
  onClose: () => void;
  onSendReply: (targetEmail: string, replyText: string, status: StatusItem) => void;
  onStatusDeleted: (statusId: number) => void;
}

const DEFAULT_SLIDE_DURATION_MS = 5000;

export default function StatusViewerModal({
  initialGroup,
  allGroups,
  currentUserEmail,
  onClose,
  onSendReply,
  onStatusDeleted,
}: StatusViewerModalProps) {
  const currentGroup = initialGroup;
  const statuses = currentGroup.statuses || [];

  const [statusIndex, setStatusIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [isMediaLoaded, setIsMediaLoaded] = useState(false);
  const [slideDuration, setSlideDuration] = useState(DEFAULT_SLIDE_DURATION_MS);
  const slideDurationRef = useRef(DEFAULT_SLIDE_DURATION_MS);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    slideDurationRef.current = slideDuration;
  }, [slideDuration]);

  // Reply bar state
  const [replyText, setReplyText] = useState("");
  const [replySent, setReplySent] = useState(false);

  // Viewers sheet state (for own status)
  const [showViewersSheet, setShowViewersSheet] = useState(false);
  const [viewersList, setViewersList] = useState<StatusViewEntry[]>([]);
  const [loadingViewers, setLoadingViewers] = useState(false);

  // Deleting state
  const [deleting, setDeleting] = useState(false);

  const currentStatus: StatusItem | undefined = statuses[statusIndex];
  const isOwn = currentGroup.user_email.toLowerCase() === currentUserEmail.toLowerCase();

  const animFrameRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(Date.now());
  const elapsedBeforePauseRef = useRef<number>(0);
  const imgRef = useRef<HTMLImageElement | null>(null);

  // Reset progress and media loaded state when slide changes
  useEffect(() => {
    setProgress(0);
    elapsedBeforePauseRef.current = 0;
    setSlideDuration(DEFAULT_SLIDE_DURATION_MS);
    slideDurationRef.current = DEFAULT_SLIDE_DURATION_MS;
    if (!currentStatus?.media_url) {
      setIsMediaLoaded(true);
      startTimeRef.current = Date.now();
      return;
    }

    setIsMediaLoaded(false);

    // If image is already cached in browser, complete may already be true
    if (imgRef.current && imgRef.current.complete && imgRef.current.naturalWidth > 0) {
      setIsMediaLoaded(true);
      startTimeRef.current = Date.now();
      return;
    }

    // Fallback watchdog timer so viewer never gets stuck on first view
    const timer = setTimeout(() => {
      setIsMediaLoaded(true);
      startTimeRef.current = Date.now();
    }, 2000);

    return () => {
      clearTimeout(timer);
    };
  }, [statusIndex, currentStatus?.id, currentStatus?.media_url]);

  // Mark status as viewed when displayed
  useEffect(() => {
    if (currentStatus && !isOwn && !currentStatus.is_viewed) {
      markStatusViewedApi(currentStatus.id).catch(() => {});
      currentStatus.is_viewed = true;
    }
  }, [currentStatus, isOwn]);

  // Load viewers list when opening viewers sheet
  useEffect(() => {
    if (showViewersSheet && currentStatus && isOwn) {
      setLoadingViewers(true);
      fetchStatusViewsApi(currentStatus.id)
        .then((res) => setViewersList(res))
        .catch(() => setViewersList([]))
        .finally(() => setLoadingViewers(false));
    }
  }, [showViewersSheet, currentStatus, isOwn]);

  const handleNext = useCallback(() => {
    if (statusIndex < statuses.length - 1) {
      setStatusIndex(prev => prev + 1);
      setProgress(0);
      setIsMediaLoaded(false);
      elapsedBeforePauseRef.current = 0;
      startTimeRef.current = Date.now();
    } else {
      // Reached the end of this user's statuses: close cleanly without looping!
      onClose();
    }
  }, [statusIndex, statuses.length, onClose]);

  const handlePrev = useCallback(() => {
    if (statusIndex > 0) {
      setStatusIndex(prev => prev - 1);
      setProgress(0);
      setIsMediaLoaded(false);
      elapsedBeforePauseRef.current = 0;
      startTimeRef.current = Date.now();
    }
  }, [statusIndex]);

  // Progress bar animation loop - only runs once media is fully loaded
  useEffect(() => {
    if (!isMediaLoaded || isPaused || showViewersSheet) {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      return;
    }

    startTimeRef.current = Date.now() - elapsedBeforePauseRef.current;

    const tick = () => {
      const elapsed = Date.now() - startTimeRef.current;
      const curDur = slideDurationRef.current || DEFAULT_SLIDE_DURATION_MS;
      const pct = Math.min(100, (elapsed / curDur) * 100);
      setProgress(pct);

      if (pct >= 100) {
        handleNext();
      } else {
        animFrameRef.current = requestAnimationFrame(tick);
      }
    };

    animFrameRef.current = requestAnimationFrame(tick);
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [statusIndex, isMediaLoaded, isPaused, showViewersSheet, handleNext]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") handleNext();
      else if (e.key === "ArrowLeft") handlePrev();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleNext, handlePrev, onClose]);

  const handlePointerDown = () => {
    setIsPaused(true);
    const curDur = slideDurationRef.current || DEFAULT_SLIDE_DURATION_MS;
    elapsedBeforePauseRef.current = (progress / 100) * curDur;
    if (videoRef.current) {
      try { videoRef.current.pause(); } catch {}
    }
  };

  const handlePointerUp = () => {
    setIsPaused(false);
    if (videoRef.current) {
      try { videoRef.current.play(); } catch {}
    }
  };

  const handleDeleteCurrent = async () => {
    if (!currentStatus || deleting) return;
    if (!confirm("Delete this status update?")) return;

    setDeleting(true);
    try {
      await deleteStatusApi(currentStatus.id);
      onStatusDeleted(currentStatus.id);
      if (statuses.length <= 1) {
        onClose();
      } else {
        handleNext();
      }
    } catch (err: any) {
      alert(err.message || "Failed to delete status");
    } finally {
      setDeleting(false);
    }
  };

  const handleSendReply = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = replyText.trim();
    if (!trimmed || !currentStatus) return;

    onSendReply(currentGroup.user_email, trimmed, currentStatus);
    setReplyText("");
    setReplySent(true);
    setTimeout(() => setReplySent(false), 2000);
  };

  if (!currentStatus) return null;

  return (
    <div className="status-viewer-portal">
      {/* ── Segmented Progress Bars (Top) ── */}
      <div className="status-progress-bar-container">
        {statuses.map((st, i) => {
          let fill = "0%";
          if (i < statusIndex) fill = "100%";
          else if (i === statusIndex) fill = `${progress}%`;

          return (
            <div key={st.id || i} className="status-progress-segment">
              <div className="status-progress-fill" style={{ width: fill }} />
            </div>
          );
        })}
      </div>

      {/* ── Header ── */}
      <div className="status-viewer-header">
        <div className="status-viewer-user-info">
          <div className="status-viewer-avatar-wrap">
            {currentGroup.avatar_url ? (
              <AvatarImage
                src={currentGroup.avatar_url}
                alt={currentGroup.display_name}
                className="status-viewer-avatar"
                fallbackText={currentGroup.display_name}
              />
            ) : (
              <div className="status-viewer-avatar-placeholder">
                {(currentGroup.display_name || "U")[0]?.toUpperCase()}
              </div>
            )}
          </div>
          <div className="status-viewer-meta">
            <span className="status-viewer-name">
              {isOwn ? "My status" : currentGroup.display_name}
            </span>
            <span className="status-viewer-time">
              {formatTimeAgo(currentStatus.created_at)}
            </span>
          </div>
        </div>

        <div className="status-viewer-actions">
          {isOwn && (
            <button
              className="status-viewer-btn status-viewer-del-btn"
              onClick={handleDeleteCurrent}
              disabled={deleting}
              title="Delete status"
              aria-label="Delete status"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
            </button>
          )}

          <button
            className="status-viewer-btn"
            onClick={onClose}
            title="Close viewer"
            aria-label="Close"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>

      {/* ── Tap Touch Zones ── */}
      <div
        className="status-touch-zone status-touch-left"
        onClick={handlePrev}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
      />
      <div
        className="status-touch-zone status-touch-right"
        onClick={handleNext}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
      />

      {/* ── Slide Content ── */}
      <div className="status-viewer-body">
        {currentStatus.media_url ? (
          <div className="status-viewer-media-wrap" style={{ position: "relative" }}>
            {!isMediaLoaded && (
              <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, zIndex: 2, background: "rgba(0,0,0,0.5)" }}>
                <div style={{ width: 36, height: 36, border: "3px solid rgba(255,255,255,0.2)", borderTopColor: "#ffffff", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
                <span style={{ color: "#ffffff", fontSize: "12px", letterSpacing: "0.04em", opacity: 0.85 }}>Loading status...</span>
              </div>
            )}
            {/\.(mp4|webm|mov|3gp)(\?.*)?$/i.test(currentStatus.media_url) ? (
              <video
                ref={videoRef}
                src={currentStatus.media_url.startsWith("/") ? `${API.replace(/\/+$/, "")}${currentStatus.media_url}` : currentStatus.media_url}
                autoPlay
                playsInline
                className="status-viewer-media"
                onLoadedMetadata={(e) => {
                  const v = e.currentTarget as HTMLVideoElement;
                  const dur = v.duration;
                  if (dur && !isNaN(dur) && isFinite(dur)) {
                    const durMs = Math.max(3000, Math.min(35000, dur * 1000));
                    setSlideDuration(durMs);
                    slideDurationRef.current = durMs;
                  }
                  try {
                    v.currentTime = 0.001;
                    const playPromise = v.play();
                    if (playPromise !== undefined) {
                      playPromise.catch(() => {
                        v.muted = true;
                        v.play().catch(() => {});
                      });
                    }
                  } catch {}
                }}
                onLoadedData={() => {
                  setIsMediaLoaded(true);
                  startTimeRef.current = Date.now();
                  elapsedBeforePauseRef.current = 0;
                }}
                onCanPlay={() => {
                  setIsMediaLoaded(true);
                }}
                onEnded={() => {
                  handleNext();
                }}
              />
            ) : (
              <img
                ref={imgRef}
                src={currentStatus.media_url.startsWith("/") ? `${API.replace(/\/+$/, "")}${currentStatus.media_url}` : currentStatus.media_url}
                alt="Status content"
                className="status-viewer-media"
                onLoad={() => {
                  setIsMediaLoaded(true);
                  startTimeRef.current = Date.now();
                  elapsedBeforePauseRef.current = 0;
                }}
                onError={() => {
                  setIsMediaLoaded(true);
                }}
              />
            )}
          </div>
        ) : (
          <div
            className="status-viewer-text-wrap"
            style={{
              background: currentStatus.bg_color || "linear-gradient(135deg, #0ba360 0%, #3cba92 100%)",
            }}
          >
            <p className="status-viewer-text-content">
              {currentStatus.content_text}
            </p>
          </div>
        )}

        {/* Caption Overlay (if media has caption) */}
        {currentStatus.media_url && currentStatus.content_text && (
          <div className="status-viewer-caption-scrim">
            <p className="status-viewer-caption-text">
              {currentStatus.content_text}
            </p>
          </div>
        )}
      </div>

      {/* ── Bottom Bar ── */}
      <div className="status-viewer-footer">
        {isOwn ? (
          /* Viewers Count Bar for Author */
          <div
            className="status-viewer-count-bar"
            onClick={() => setShowViewersSheet(true)}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
            <span>{currentStatus.views_count || 0} views</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="18 15 12 9 6 15" />
            </svg>
          </div>
        ) : (
          /* Reply Bar for Contacts */
          <form className="status-reply-form" onSubmit={handleSendReply}>
            <input
              type="text"
              className="status-reply-input"
              placeholder={`Reply to ${currentGroup.display_name}...`}
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              onFocus={() => setIsPaused(true)}
              onBlur={() => setIsPaused(false)}
            />
            <button
              type="submit"
              className="status-reply-send-btn"
              disabled={!replyText.trim()}
              aria-label="Send reply"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
            {replySent && <span className="status-reply-toast">Reply sent!</span>}
          </form>
        )}
      </div>

      {/* ── Viewers Bottom Sheet (For Own Status) ── */}
      {showViewersSheet && (
        <div
          className="status-viewers-backdrop"
          onClick={() => setShowViewersSheet(false)}
        >
          <div
            className="status-viewers-sheet"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="status-viewers-sheet-handle" />
            <div className="status-viewers-sheet-header">
              <h3>Viewed by {viewersList.length}</h3>
              <button
                className="status-viewers-close"
                onClick={() => setShowViewersSheet(false)}
              >
                ✕
              </button>
            </div>

            <div className="status-viewers-sheet-content">
              {loadingViewers ? (
                <div className="status-viewers-loading">Loading viewers...</div>
              ) : viewersList.length === 0 ? (
                <div className="status-viewers-empty">No views yet</div>
              ) : (
                viewersList.map((v) => (
                  <div key={v.viewer_email} className="status-viewer-row">
                    <div className="status-viewer-avatar-small">
                      <AvatarImage
                        src={v.avatar_url}
                        alt={v.display_name}
                        fallbackText={v.display_name}
                        className="status-viewer-avatar-img"
                        style={{ width: "100%", height: "100%", borderRadius: "50%", objectFit: "cover" }}
                      />
                    </div>
                    <div className="status-viewer-info">
                      <span className="status-viewer-row-name">{v.display_name}</span>
                      <span className="status-viewer-row-time">{formatTimeAgo(v.viewed_at)}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
