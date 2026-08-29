"use client";

import React, { useRef, useState, useEffect, memo } from "react";
import { parseTs } from "@/lib/utils";
import type { Message, Contact } from "@/types";
import { useAuthStore } from "@/stores/authStore";
import { useContactStore } from "@/stores/contactStore";
import { useCachedMedia } from "@/hooks/useCachedMedia";
import ReactionPickerPortal from "./ReactionPickerPortal";

// ─── STATIC REACTION EMOJIS ──────────────────────────────────────────────────
const REACTION_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🙏", "🔥", "💯"];

// ─── STATUS TICKS COMPONENT (Pending, Sent, Delivered, Blue Read) ─────────────
export function StatusTicks({
  isMine,
  isFailed,
  isPending,
  readBy,
}: {
  isMine: boolean;
  isFailed?: boolean;
  isPending?: boolean;
  readBy?: string[];
}) {
  if (!isMine) return null;

  if (isFailed) {
    return (
      <span className="status-tick status-tick--failed" title="Failed to send">
        ⚠️
      </span>
    );
  }

  if (isPending) {
    return (
      <span className="status-tick status-tick--pending" title="Sending...">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.7 }}>
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
      </span>
    );
  }

  const isRead = Boolean(readBy && readBy.length > 0);

  return (
    <span
      className={`status-tick ${isRead ? "status-tick--read" : "status-tick--delivered"}`}
      title={isRead ? "Read" : "Delivered"}
    >
      {isRead ? (
        // Standard Double Blue / Cyan Checkmark
        <svg width="16" height="11" viewBox="0 0 16 11" fill="none" className="tick-svg tick-svg--read">
          <path d="M1 5.5L4.5 9L11.5 1.5" stroke="#53bdeb" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M5 5.5L8.5 9L15.5 1.5" stroke="#53bdeb" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        // Standard Double Grey Checkmark
        <svg width="16" height="11" viewBox="0 0 16 11" fill="none" className="tick-svg tick-svg--delivered">
          <path d="M1 5.5L4.5 9L11.5 1.5" stroke="rgba(255,255,255,0.65)" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M5 5.5L8.5 9L15.5 1.5" stroke="rgba(255,255,255,0.65)" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </span>
  );
}

export interface MessageBubbleProps {
  item: Message & { type: "msg" };
  isSelected: boolean;
  isSelectionModeActive: boolean;
  isEditing: boolean;
  editingText: string;
  reactionPickerId: string | number | null;
  chatType: "user" | "group";
  isFailed: boolean;
  isPending?: boolean;
  onReply: (msg: Message) => void;
  onForward: (msg: Message) => void;
  onEditStart: (id: string | number, text: string) => void;
  onEditSave: () => void;
  onEditCancel: () => void;
  onEditChange: (text: string) => void;
  onDelete: (id: string | number) => void;
  onReaction: (msgId: string | number, emoji: string) => void;
  onSetReactionPicker: (id: string | number | null) => void;
  onViewFile: (url: string, type: string) => void;
  onSelectMsg: (id: string | number | null) => void;
  onRetry: (msg: Message) => void;
  highlightedMsgId: string | number | null;
  onCallTap?: (video: boolean) => void;
}

const MessageBubble = memo(function MessageBubble({
  item,
  isSelected,
  isSelectionModeActive,
  isEditing,
  editingText,
  reactionPickerId,
  chatType,
  isFailed,
  isPending = false,
  onReply,
  onForward,
  onEditStart,
  onEditSave,
  onEditCancel,
  onEditChange,
  onDelete,
  onReaction,
  onSetReactionPicker,
  onViewFile,
  onSelectMsg,
  onRetry,
  highlightedMsgId,
  onCallTap,
}: MessageBubbleProps) {
  const currentUser = useAuthStore((s) => s.currentUser);
  const contacts = useContactStore((s) => s.contacts);
  const nicknames = useContactStore((s) => s.nicknames);

  const contactLabel = (c: Contact) =>
    nicknames[c.email] || c.display_name || (c.username ? `@${c.username}` : null) || "Unknown User";

  const getPeerName = (email: string) => {
    const c = contacts.find((contact) => contact.email === email);
    return c ? contactLabel(c) : "Unknown User";
  };

  const isMine = item.user === currentUser;
  const formatTime = (ts: string) => parseTs(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const bubbleRef = useRef<HTMLDivElement>(null);
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isSwipingRef = useRef(false);
  const replyFired = useRef(false);
  const touchHandledClick = useRef(false);
  const [swipeX, setSwipeX] = useState(0);

  // Resolve media cache url at component root
  const content = (item.content || "").trim();
  
  let mediaType: "image" | "video" | "audio" | "sticker" | "pdf" | "file" | "text" = "text";
  let rawUrl = "";
  let caption = "";

  if (content.startsWith("[IMAGE]")) {
    mediaType = "image";
    const rest = content.slice(7).trim();
    const parts = rest.split("\n");
    rawUrl = parts[0].trim();
    caption = parts.slice(1).join("\n").trim();
  } else if (content.startsWith("[VIDEO]")) {
    mediaType = "video";
    const rest = content.slice(7).trim();
    const parts = rest.split("\n");
    rawUrl = parts[0].trim();
    caption = parts.slice(1).join("\n").trim();
  } else if (content.startsWith("[AUDIO]")) {
    mediaType = "audio";
    rawUrl = content.slice(7).trim();
  } else if (content.startsWith("[STICKER]")) {
    mediaType = "sticker";
    rawUrl = content.slice(9).trim();
  } else if (content.startsWith("[PDF]")) {
    mediaType = "pdf";
    const rest = content.slice(5).trim();
    const parts = rest.split("\n");
    rawUrl = parts[0].trim();
    caption = parts.slice(1).join("\n").trim();
  } else if (content.startsWith("[FILE]")) {
    mediaType = "file";
    const rest = content.slice(6).trim();
    const parts = rest.split("\n");
    rawUrl = parts[0].trim();
    caption = parts.slice(1).join("\n").trim();
  } else if (/^https?:\/\/.+\.(jpg|jpeg|png|webp|gif|heic)(\?.*)?$/i.test(content) || content.startsWith("data:image/")) {
    mediaType = "image";
    rawUrl = content;
  } else if (/^https?:\/\/.+\.(mp4|webm|mov|3gp)(\?.*)?$/i.test(content)) {
    mediaType = "video";
    rawUrl = content;
  } else if (/^https?:\/\/.+\.(mp3|ogg|wav|m4a|aac)(\?.*)?$/i.test(content)) {
    mediaType = "audio";
    rawUrl = content;
  }

  const isImage = mediaType === "image";
  const isVideo = mediaType === "video";
  const isAudio = mediaType === "audio";
  const isSticker = mediaType === "sticker";
  const isPdf = mediaType === "pdf";
  const isFile = mediaType === "file";

  const cachedUrl = useCachedMedia(rawUrl);
  const [mediaSrc, setMediaSrc] = useState(cachedUrl || rawUrl);

  useEffect(() => {
    setMediaSrc(cachedUrl || rawUrl);
  }, [cachedUrl, rawUrl]);

  const clearPress = () => {
    if (pressTimer.current) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    e.stopPropagation();
    const t = e.touches[0];
    touchStartX.current = t.clientX;
    touchStartY.current = t.clientY;
    isSwipingRef.current = false;
    replyFired.current = false;
    touchHandledClick.current = false;
    pressTimer.current = setTimeout(() => {
      if (!isSwipingRef.current) {
        touchHandledClick.current = true;
        if (navigator.vibrate) navigator.vibrate(30);
        onSelectMsg(item.id);
        if (!isSelectionModeActive) {
          onSetReactionPicker(reactionPickerId === item.id ? null : item.id);
        }
      }
    }, 450);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    const dx = e.touches[0].clientX - touchStartX.current;
    const dy = e.touches[0].clientY - touchStartY.current;
    if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) {
      isSwipingRef.current = true;
      clearPress();
      const validSwipe = isMine ? dx < 0 : dx > 0;
      if (validSwipe) {
        const offset = Math.min(Math.abs(dx) * 0.55, 72);
        setSwipeX(offset);
        if (offset >= 55 && !replyFired.current) {
          replyFired.current = true;
          if (navigator.vibrate) navigator.vibrate(30);
          onReply(item);
        }
      }
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (navigator.vibrate) navigator.vibrate(30);
    onSelectMsg(item.id);
    if (!isSelectionModeActive) {
      onSetReactionPicker(reactionPickerId === item.id ? null : item.id);
    }
  };

  if (item._callRecord) {
    const isVideoCall = item.content.includes("Video call") || item.content.includes("📹");
    return (
      <div className="call-record-divider" style={{ opacity: isSelected ? 0.5 : 1 }}>
        <span className="call-record-text" onClick={() => onCallTap?.(isVideoCall)}>
          {item.content}
        </span>
      </div>
    );
  }

  const isHighlighted = highlightedMsgId === item.id;

  const handleTouchEnd = () => {
    clearPress();
    setSwipeX(0);
    if (isSwipingRef.current) return;
    if (touchHandledClick.current) return;
    if (isSelectionModeActive) {
      onSelectMsg(item.id);
    }
  };

  const myEmail = (currentUser || "").trim().toLowerCase();

  return (
    <div
      ref={bubbleRef}
      onContextMenu={handleContextMenu}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      className={`msg-row ${isMine ? "msg-mine msg-row--mine" : "msg-theirs msg-row--theirs"} ${isHighlighted ? "msg-highlighted" : ""} ${isSelected ? "msg-row--selected" : ""}`}
      style={{
        transform: swipeX ? `translateX(${isMine ? -swipeX : swipeX}px)` : "none",
        transition: swipeX ? "none" : "transform 0.15s var(--ease-spring)"
      }}
    >
      <div className={`bw ${isSelected ? "bw--selected" : ""}`}>
        {chatType === "group" && !isMine && (
          <div className="sender-name msg-sender-name">
            {getPeerName(item.user)}
          </div>
        )}

        <div className={`bubble ${isMine ? "mine msg-bubble--mine" : "theirs msg-bubble--theirs"} ${isImage || isVideo ? "bubble--media" : ""} ${isSticker ? "bubble--sticker" : ""} ${item.is_deleted ? "msg-deleted" : ""} msg-bubble`}>
          {/* Quick Hover React / Action Button */}
          {!isEditing && (
            <button
              type="button"
              className="msg-react-trigger"
              onClick={e => {
                e.stopPropagation();
                onSetReactionPicker(reactionPickerId === item.id ? null : item.id);
              }}
              title="React to message"
              aria-label="React"
            >
              😀
            </button>
          )}

          {item.reply_to && (
            <div className="msg-reply-preview">
              <div className="msg-reply-sender">{getPeerName(item.reply_to.user)}</div>
              <div className="msg-reply-body">
                {item.reply_to.content.startsWith("[") ? "📎 Attachment" : item.reply_to.content}
              </div>
            </div>
          )}

          {isEditing ? (
            <div className="edit-row msg-edit-wrap">
              <input
                type="text"
                value={editingText}
                onChange={e => onEditChange(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") onEditSave(); if (e.key === "Escape") onEditCancel(); }}
                className="edit-field msg-edit-input"
                autoFocus
              />
              <div className="msg-edit-actions">
                <button onClick={onEditSave} className="edit-save msg-edit-action-btn" aria-label="Save edit">✓</button>
                <button onClick={onEditCancel} className="edit-discard msg-edit-action-btn" aria-label="Cancel edit">✕</button>
              </div>
            </div>
          ) : (
            <>
              {isImage || isVideo ? (
                // ── IMAGE & VIDEO MEDIA BOX WITH OVERLAY META ──
                <div className="msg-media-box" onClick={() => onViewFile(rawUrl || cachedUrl, isImage ? "image" : "video")}>
                  {isImage ? (
                    <img
                      src={mediaSrc}
                      alt="attachment"
                      className="msg-img-media"
                      loading="lazy"
                      onError={() => {
                        if (mediaSrc !== rawUrl && rawUrl) setMediaSrc(rawUrl);
                      }}
                    />
                  ) : (
                    <div className="msg-video-wrap">
                      <video
                        src={mediaSrc}
                        className="msg-video-media"
                        preload="metadata"
                        onError={() => {
                          if (mediaSrc !== rawUrl && rawUrl) setMediaSrc(rawUrl);
                        }}
                      />
                      <div className="msg-video-play-btn">▶</div>
                    </div>
                  )}
                  {caption && <div className="msg-media-caption">{caption}</div>}
                  <div className="media-overlay-meta">
                    {item.is_edited && <span className="media-meta-edited">edited</span>}
                    <span className="media-meta-time">{formatTime(item.timestamp)}</span>
                    <StatusTicks isMine={isMine} isFailed={isFailed} isPending={isPending} readBy={item.read_by} />
                  </div>
                </div>
              ) : isAudio ? (
                // ── AUDIO / VOICE NOTE ──
                <>
                  <div className="msg-attachment-audio">
                    <audio
                      src={mediaSrc}
                      controls
                      className="msg-audio-media"
                      onError={() => {
                        if (mediaSrc !== rawUrl && rawUrl) setMediaSrc(rawUrl);
                      }}
                    />
                  </div>
                  <div className="msg-footer msg-meta">
                    {item.is_edited && <span className="msg-edited msg-meta-edited">edited</span>}
                    <span className="msg-ts msg-meta-time">{formatTime(item.timestamp)}</span>
                    <StatusTicks isMine={isMine} isFailed={isFailed} isPending={isPending} readBy={item.read_by} />
                  </div>
                </>
              ) : isPdf || isFile ? (
                // ── DOCUMENT / FILE ATTACHMENT CARD ──
                <>
                  <div className="msg-file-card" onClick={() => onViewFile(rawUrl || cachedUrl, isPdf ? "pdf" : "file")}>
                    <div className="msg-file-icon">{isPdf ? "📄" : "📁"}</div>
                    <div className="msg-file-info">
                      <span className="msg-file-name">{(rawUrl || cachedUrl).split("/").pop() || (isPdf ? "Document.pdf" : "Attachment")}</span>
                      <span className="msg-file-sub">{isPdf ? "PDF Document" : "File Attachment"}</span>
                    </div>
                    <div className="msg-file-dl-btn">⬇</div>
                  </div>
                  {caption && <div className="msg-file-caption" style={{ padding: "4px 8px", fontSize: "0.85rem" }}>{caption}</div>}
                  <div className="msg-footer msg-meta">
                    {item.is_edited && <span className="msg-edited msg-meta-edited">edited</span>}
                    <span className="msg-ts msg-meta-time">{formatTime(item.timestamp)}</span>
                    <StatusTicks isMine={isMine} isFailed={isFailed} isPending={isPending} readBy={item.read_by} />
                  </div>
                </>
              ) : isSticker ? (
                // ── STICKER ──
                <div className="msg-attachment-sticker">
                  <img
                    src={mediaSrc}
                    alt="sticker"
                    className="msg-img-media"
                    onError={() => {
                      if (mediaSrc !== rawUrl && rawUrl) setMediaSrc(rawUrl);
                    }}
                  />
                  <div className="msg-footer msg-meta" style={{ justifyContent: "center" }}>
                    <span className="msg-ts msg-meta-time">{formatTime(item.timestamp)}</span>
                    <StatusTicks isMine={isMine} isFailed={isFailed} isPending={isPending} readBy={item.read_by} />
                  </div>
                </div>
              ) : (
                // ── REGULAR TEXT MESSAGE ──
                <>
                  <div className="msg-text msg-text-content">{item.content}</div>
                  <div className="msg-footer msg-meta">
                    {item.is_edited && <span className="msg-edited msg-meta-edited">edited</span>}
                    <span className="msg-ts msg-meta-time">{formatTime(item.timestamp)}</span>
                    <StatusTicks isMine={isMine} isFailed={isFailed} isPending={isPending} readBy={item.read_by} />
                  </div>
                </>
              )}
            </>
          )}

          {item.reactions && Object.keys(item.reactions).length > 0 && (
            <div className="reactions-row msg-reactions-list">
              {Object.entries(item.reactions).map(([emoji, users]) => {
                const userReacted = Boolean(myEmail && (users || []).some(u => (u || "").trim().toLowerCase() === myEmail));
                return (
                  <button
                    key={emoji}
                    type="button"
                    className={`reaction-pill msg-reaction-badge ${userReacted ? "user-reacted" : ""}`}
                    onClick={e => {
                      e.stopPropagation();
                      onReaction(item.id, emoji);
                    }}
                  >
                    <span>{emoji}</span>
                    <span className="msg-reaction-count">{(users || []).length}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {reactionPickerId === item.id && (
        <ReactionPickerPortal
          anchorRef={bubbleRef}
          isMine={isMine}
          emojis={REACTION_EMOJIS}
          onReact={(emoji) => onReaction(item.id, emoji)}
          onClose={() => onSetReactionPicker(null)}
        />
      )}
    </div>
  );
});


export default MessageBubble;
