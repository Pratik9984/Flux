"use client";

import React, { useRef, memo } from "react";
import { formatTimeAgo } from "@/lib/utils";
import type { Contact } from "@/types";
import { useChatStore } from "@/stores/chatStore";
import { useContactStore } from "@/stores/contactStore";

export interface ContactItemProps {
  contact: Contact;
  isActive: boolean;
  isDeleteTarget: boolean;
  label: string;
  lastActivityTs: number;
  onOpen: (email: string, label: string) => void;
  onDelete: (email: string) => void;
  onDeleteTarget: (id: string) => void;
  onClearDelete: () => void;
  onOpenProfile?: (email: string, label: string) => void;
}

const ContactItem = memo(function ContactItem({
  contact: c,
  isActive,
  isDeleteTarget,
  label,
  lastActivityTs,
  onOpen,
  onDelete,
  onDeleteTarget,
  onClearDelete,
  onOpenProfile,
}: ContactItemProps) {
  const unreadCount = useChatStore((s) => s.unread[c.email] || 0);
  const lastPreview = useChatStore((s) => s.lastPreview[c.email] || "");
  const nickname = useContactStore((s) => s.nicknames[c.email]);
  const mutedUntil = useContactStore((s) => s.mutedChats[c.email]);

  const isMuted = () => {
    if (!mutedUntil) return false;
    return mutedUntil === null || mutedUntil > Date.now();
  };

  const longPressRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasUnread = unreadCount > 0;
  const timeLabel = formatTimeAgo(lastActivityTs);

  return (
    <div
      className="sb-item-wrap"
      onTouchStart={() => {
        longPressRef.current = setTimeout(() => onDeleteTarget(c.email), 500);
      }}
      onTouchEnd={() => {
        if (longPressRef.current) clearTimeout(longPressRef.current);
      }}
      onTouchMove={() => {
        if (longPressRef.current) clearTimeout(longPressRef.current);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        onDeleteTarget(c.email);
      }}
    >
      <button
        onClick={() => {
          if (isDeleteTarget) {
            onClearDelete();
            return;
          }
          onOpen(c.email, label);
        }}
        className={`sb-item ${isActive ? "sb-item--active" : ""} ${hasUnread && !isActive ? "sb-item--unread" : ""}`}
      >
        <div className="sb-av" onClick={(e) => { e.stopPropagation(); onOpenProfile?.(c.email, label); }}>
          {c.avatar_url ? (
            <img src={c.avatar_url} alt="avatar" className="img-cover rounded-circle" />
          ) : (
            label?.[0]?.toUpperCase() || "?"
          )}
          <span className={`pres ${c.is_online ? "pres--on" : ""}`} />
        </div>
        <div className="sb-item-body mw-0">
          <span className="sb-item-name name-row">
            {nickname ? (
              <>
                <span>{nickname}</span>
                <span className="name-meta">({c.display_name || (c.username ? `@${c.username}` : "")})</span>
              </>
            ) : (
              <span>{label}</span>
            )}
          </span>
          <span className={`sb-item-status text-truncate ${hasUnread ? "sb-item-status--unread" : ""}`}>
            {lastPreview ? (
              lastPreview.substring(0, 34) + (lastPreview.length > 34 ? "…" : "")
            ) : c.username ? (
              <span style={{ opacity: 0.5 }}>@{c.username}</span>
            ) : (
              <span className={c.is_online ? "online" : ""}>{c.is_online ? "● Online" : "○ Offline"}</span>
            )}
          </span>
        </div>
        <div className="sb-item-right">
          {isMuted() && (
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--text-3)" strokeWidth="2" style={{ opacity: 0.55 }}>
              <path d="M13.73 21a2 2 0 01-3.46 0" />
              <path d="M18.63 13A17.9 17.9 0 0118 8" />
              <path d="M6.26 6.26A5.86 5.86 0 006 8c0 7-3 9-3 9h14" />
              <path d="M18 8a6 6 0 00-9.33-5" />
              <line x1="1" y1="1" x2="23" y2="23" />
            </svg>
          )}
          {timeLabel && <span className="sb-item-time">{timeLabel}</span>}
          {hasUnread && (
            <span className="unread unread--dm" style={{ minWidth: 20, height: 20, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, padding: "0 5px" }}>
              {unreadCount}
            </span>
          )}
        </div>
      </button>
      {isDeleteTarget && (
        <button className="sb-delete-btn" title="Delete contact chat" aria-label="Delete contact chat" onClick={(e) => { e.stopPropagation(); onDelete(c.email); }}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
          </svg>
          Delete
        </button>
      )}
    </div>
  );
});

export default ContactItem;
