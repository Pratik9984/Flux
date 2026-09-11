"use client";

import React, { useState } from "react";
import type { UserStatusGroup, Contact } from "@/types";
import { formatTimeAgo } from "@/lib/utils";
import { AvatarImage } from "@/components/ui/AvatarImage";
import { API } from "@/lib/api";

function StatusPreviewThumb({
  group,
  fallbackAvatar,
  fallbackName,
}: {
  group?: UserStatusGroup | null;
  fallbackAvatar?: string | null;
  fallbackName?: string;
}) {
  const latestStatus = group?.statuses?.[group.statuses.length - 1] || group?.statuses?.[0];

  if (latestStatus?.media_url) {
    let resolvedUrl = latestStatus.media_url.trim();
    if (resolvedUrl.startsWith("/")) {
      resolvedUrl = `${API.replace(/\/+$/, "")}${resolvedUrl}`;
    }
    const isVideo = /\.(mp4|webm|mov|3gp)(\?.*)?$/i.test(resolvedUrl);

    if (isVideo) {
      return (
        <video
          src={resolvedUrl}
          className="status-avatar-img"
          style={{ width: "100%", height: "100%", objectFit: "cover", pointerEvents: "none" }}
          muted
          playsInline
          preload="metadata"
          onLoadedMetadata={(e) => {
            try {
              (e.target as HTMLVideoElement).currentTime = 0.1;
            } catch {}
          }}
        />
      );
    }

    return (
      <img
        src={resolvedUrl}
        alt="status preview"
        className="status-avatar-img"
        style={{ width: "100%", height: "100%", objectFit: "cover" }}
      />
    );
  }

  if (latestStatus?.content_text) {
    return (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: latestStatus.bg_color || "linear-gradient(135deg, #10b981, #047857)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#fff",
          fontSize: "10px",
          fontWeight: 700,
          padding: "2px",
          textAlign: "center",
          overflow: "hidden",
          lineHeight: 1.1,
          borderRadius: "50%",
        }}
      >
        {latestStatus.content_text.slice(0, 8)}
      </div>
    );
  }

  const avatar = group?.avatar_url || fallbackAvatar;
  const name = group?.display_name || fallbackName || "User";

  if (avatar) {
    return (
      <AvatarImage
        src={avatar}
        alt={name}
        className="status-avatar-img"
        fallbackText={name}
      />
    );
  }

  return (
    <div className="status-avatar-placeholder">
      {name[0]?.toUpperCase() || "?"}
    </div>
  );
}

interface StatusScreenProps {
  statusGroups: UserStatusGroup[];
  currentUserEmail: string;
  currentUserDisplayName: string;
  currentUserAvatarUrl?: string | null;
  onOpenViewer: (group: UserStatusGroup, initialIndex?: number) => void;
  onOpenTextCreator: () => void;
  onOpenMediaCreator: () => void;
  onRefresh: () => void;
  loading?: boolean;
}

export default function StatusScreen({
  statusGroups,
  currentUserEmail,
  currentUserDisplayName,
  currentUserAvatarUrl,
  onOpenViewer,
  onOpenTextCreator,
  onOpenMediaCreator,
  onRefresh,
  loading = false,
}: StatusScreenProps) {
  const [showViewedUpdates, setShowViewedUpdates] = useState(true);

  // Find current user's status group
  const myStatusGroup = statusGroups.find(
    g => g.user_email.toLowerCase() === currentUserEmail.toLowerCase()
  );

  // Filter other contacts
  const otherGroups = statusGroups.filter(
    g => g.user_email.toLowerCase() !== currentUserEmail.toLowerCase()
  );

  // Separate into unviewed and viewed
  const recentUpdates = otherGroups.filter(g => g.has_unviewed);
  const viewedUpdates = otherGroups.filter(g => !g.has_unviewed);

  const myActiveCount = myStatusGroup?.statuses?.length || 0;
  const myLatestTime = myStatusGroup?.last_updated
    ? formatTimeAgo(myStatusGroup.last_updated)
    : null;

  return (
    <div className="status-screen-container">
      {/* ── Status Header ── */}
      <div className="status-header">
        <div className="status-header-left">
          <h1 className="status-header-title">Status</h1>
        </div>
        <div className="status-header-actions">
          <button
            className="status-icon-btn"
            onClick={onRefresh}
            title="Refresh statuses"
            aria-label="Refresh"
          >
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M23 4v6h-6" />
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
          </button>
        </div>
      </div>

      <div className="status-scroll-content">
        {/* ── My Status Card ── */}
        <div className="status-section">
          <div
            className="status-item-card"
            onClick={() => {
              if (myActiveCount > 0 && myStatusGroup) {
                onOpenViewer(myStatusGroup, 0);
              } else {
                onOpenMediaCreator();
              }
            }}
          >
            <div className="status-avatar-wrapper">
              <div
                className={`status-avatar-ring ${
                  myActiveCount > 0 ? "status-ring-active" : "status-ring-none"
                }`}
              >
                <StatusPreviewThumb
                  group={myStatusGroup}
                  fallbackAvatar={currentUserAvatarUrl}
                  fallbackName={currentUserDisplayName}
                />
              </div>

              {myActiveCount === 0 && (
                <div className="status-add-badge" title="Add status">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                </div>
              )}
            </div>

            <div className="status-info-col">
              <div className="status-title-row">
                <span className="status-user-name">My status</span>
                {myActiveCount > 0 && (
                  <span className="status-pill-count">{myActiveCount}</span>
                )}
              </div>
              <p className="status-subtitle">
                {myActiveCount > 0
                  ? `${myLatestTime} • Tap to view`
                  : "Tap to add status update"}
              </p>
            </div>

            {myActiveCount > 0 && (
              <button
                className="status-quick-add-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenMediaCreator();
                }}
                title="Add another status"
                aria-label="Add status"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                  <circle cx="12" cy="13" r="4" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* ── 24-Hour Ephemeral Notice ── */}
        <div className="status-disclaimer-card">
          <div className="status-disclaimer-icon">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          </div>
          <span>Status updates disappear automatically after 24 hours.</span>
        </div>

        {/* ── Recent Updates (Unviewed) ── */}
        {recentUpdates.length > 0 && (
          <div className="status-section">
            <div className="status-section-heading">Recent updates</div>
            <div className="status-list">
              {recentUpdates.map(group => (
                <div
                  key={group.user_email}
                  className="status-item-card"
                  onClick={() => onOpenViewer(group, 0)}
                >
                  <div className="status-avatar-wrapper">
                    <div className="status-avatar-ring status-ring-unviewed">
                      <StatusPreviewThumb group={group} />
                    </div>
                  </div>
                  <div className="status-info-col">
                    <span className="status-user-name">{group.display_name}</span>
                    <p className="status-subtitle">
                      {group.last_updated ? formatTimeAgo(group.last_updated) : "Recently"}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Viewed Updates ── */}
        {viewedUpdates.length > 0 && (
          <div className="status-section">
            <button
              className="status-accordion-hdr"
              onClick={() => setShowViewedUpdates(!showViewedUpdates)}
            >
              <span>Viewed updates ({viewedUpdates.length})</span>
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                style={{
                  transform: showViewedUpdates ? "rotate(180deg)" : "rotate(0deg)",
                  transition: "transform 0.2s ease",
                }}
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>

            {showViewedUpdates && (
              <div className="status-list">
                {viewedUpdates.map(group => (
                  <div
                    key={group.user_email}
                    className="status-item-card status-item-viewed"
                    onClick={() => onOpenViewer(group, 0)}
                  >
                    <div className="status-avatar-wrapper">
                      <div className="status-avatar-ring status-ring-viewed">
                        <StatusPreviewThumb group={group} />
                      </div>
                    </div>
                    <div className="status-info-col">
                      <span className="status-user-name">{group.display_name}</span>
                      <p className="status-subtitle">
                        {group.last_updated ? formatTimeAgo(group.last_updated) : "Viewed"}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Empty State ── */}
        {recentUpdates.length === 0 && viewedUpdates.length === 0 && (
          <div className="status-empty-box">
            <div className="status-empty-icon-wrap">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <path d="M8 12h8" />
                <path d="M12 8v8" />
              </svg>
            </div>
            <div className="status-empty-title">No Recent Updates</div>
            <p className="status-empty-desc">
              When your contacts post photos, videos, or text updates, you'll see them here.
            </p>
          </div>
        )}
      </div>

      {/* ── Floating Action Buttons (WhatsApp Style) ── */}
      <div className="status-fab-stack">
        <button
          className="status-fab status-fab-secondary"
          onClick={onOpenTextCreator}
          title="Type text status"
          aria-label="Text Status"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
          </svg>
        </button>

        <button
          className="status-fab status-fab-primary"
          onClick={onOpenMediaCreator}
          title="Add photo or video status"
          aria-label="Camera Status"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
            <circle cx="12" cy="13" r="4" />
          </svg>
        </button>
      </div>
    </div>
  );
}
