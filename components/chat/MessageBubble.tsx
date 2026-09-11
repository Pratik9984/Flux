"use client";

import React, { useRef, useState, useEffect, memo } from "react";
import { parseTs } from "@/lib/utils";
import type { Message, Contact } from "@/types";
import { useAuthStore } from "@/stores/authStore";
import { useContactStore } from "@/stores/contactStore";
import { useCachedMedia } from "@/hooks/useCachedMedia";
import ReactionPickerPortal from "./ReactionPickerPortal";
import FormattedMessageText from "./FormattedMessageText";

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
  onJumpToMessage?: (id: string | number) => void;
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
  onJumpToMessage,
}: MessageBubbleProps) {
  const currentUser = useAuthStore((s) => s.currentUser);
  const contacts = useContactStore((s) => s.contacts);
  const nicknames = useContactStore((s) => s.nicknames);

  const contactLabel = (c: Contact) =>
    nicknames[c.email.toLowerCase()] || nicknames[c.email] || c.display_name || (c.username ? `@${c.username}` : null) || (c.email ? c.email.split("@")[0] : "User");

  const getPeerName = (emailOrUser: string) => {
    if (!emailOrUser) return "You";
    const clean = String(emailOrUser).toLowerCase().trim();
    const myClean = (currentUser || "").toLowerCase().trim();
    if (clean === myClean) return "You";
    const c = contacts.find((contact) => contact.email.toLowerCase() === clean);
    if (c) return contactLabel(c);
    if (clean.includes("@")) return clean.split("@")[0];
    return emailOrUser;
  };

  const isMine = item.user?.toLowerCase() === currentUser?.toLowerCase();
  const formatTime = (ts: string) => parseTs(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const bubbleRef = useRef<HTMLDivElement>(null);
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isSwipingRef = useRef(false);
  const replyFired = useRef(false);
  const touchHandledClick = useRef(false);
  const [swipeX, setSwipeX] = useState(0);

  const content = (item.content || "").trim();

  // ── SYSTEM NOTICES (e.g. Member added / left) ─────────────────────────────
  if (content.startsWith("[SYSTEM] member_added:")) {
    const rawData = content.replace("[SYSTEM] member_added:", "").trim();
    const [addedMemberEmail, adminEmail] = rawData.split(":");
    const adminLabel = (adminEmail || item.user)?.toLowerCase() === currentUser?.toLowerCase() ? "You" : getPeerName(adminEmail || item.user);
    const memberLabel = addedMemberEmail?.toLowerCase() === currentUser?.toLowerCase() ? "You" : getPeerName(addedMemberEmail);
    return (
      <div className="system-msg-row" style={{ display: "flex", justifyContent: "center", margin: "12px 0", width: "100%" }}>
        <div className="system-msg-pill" style={{
          background: "rgba(109, 175, 120, 0.12)",
          border: "1px solid rgba(109, 175, 120, 0.28)",
          color: "#275530",
          fontSize: "12px",
          fontWeight: 600,
          padding: "6px 16px",
          borderRadius: "20px",
          display: "inline-flex",
          alignItems: "center",
          gap: "6px",
          boxShadow: "0 2px 6px rgba(0,0,0,0.04)"
        }}>
          <span style={{ fontSize: "14px" }}>✨</span>
          <span><strong>{adminLabel}</strong> added <strong>{memberLabel}</strong></span>
        </div>
      </div>
    );
  }

  if (content.startsWith("[SYSTEM] member_left:")) {
    const leftMemberEmail = content.replace("[SYSTEM] member_left:", "").trim();
    const memberLabel = leftMemberEmail?.toLowerCase() === currentUser?.toLowerCase() ? "You" : getPeerName(leftMemberEmail);
    return (
      <div className="system-msg-row" style={{ display: "flex", justifyContent: "center", margin: "12px 0", width: "100%" }}>
        <div className="system-msg-pill" style={{
          background: "rgba(0, 0, 0, 0.05)",
          border: "1px solid rgba(0, 0, 0, 0.08)",
          color: "var(--text-3)",
          fontSize: "12px",
          fontWeight: 600,
          padding: "6px 16px",
          borderRadius: "20px",
          display: "inline-flex",
          alignItems: "center",
          gap: "6px"
        }}>
          <span style={{ fontSize: "14px" }}>🚪</span>
          <span><strong>{memberLabel}</strong> left the group</span>
        </div>
      </div>
    );
  }
  
  let mediaType: "image" | "video" | "audio" | "sticker" | "pdf" | "file" | "text" = "text";
  let rawUrl = "";
  let caption = "";
  let encKey: string | undefined = undefined;
  let encIv: string | undefined = undefined;
  let encMime: string | undefined = undefined;
  let encFileName: string | undefined = undefined;

  const parseEncTag = (payload: string, type: "image" | "video" | "audio" | "pdf" | "file") => {
    mediaType = type;
    const lines = payload.split("\n");
    const meta = lines[0].trim().split("|");
    rawUrl = meta[0] || "";
    encKey = meta[1] || undefined;
    encIv = meta[2] || undefined;
    encMime = meta[3] ? decodeURIComponent(meta[3]) : undefined;
    encFileName = meta[4] ? decodeURIComponent(meta[4]) : undefined;
    caption = lines.slice(1).join("\n").trim();
  };

  if (content.startsWith("[ENC_IMAGE]")) {
    parseEncTag(content.slice(11), "image");
  } else if (content.startsWith("[ENC_VIDEO]")) {
    parseEncTag(content.slice(11), "video");
  } else if (content.startsWith("[ENC_AUDIO]")) {
    parseEncTag(content.slice(11), "audio");
  } else if (content.startsWith("[ENC_PDF]")) {
    parseEncTag(content.slice(9), "pdf");
  } else if (content.startsWith("[ENC_FILE]")) {
    parseEncTag(content.slice(10), "file");
  } else if (content.startsWith("[IMAGE]")) {
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

  const cachedUrl = useCachedMedia(rawUrl, encKey, encIv, encMime);
  const [mediaSrc, setMediaSrc] = useState(cachedUrl || (encKey ? "" : rawUrl));

  useEffect(() => {
    setMediaSrc(cachedUrl || (encKey ? "" : rawUrl));
  }, [cachedUrl, rawUrl, encKey]);

  const isExpired = mediaSrc === "EXPIRED";

  const clearPress = () => {
    if (pressTimer.current) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  };

  const openActionsAndReactions = () => {
    touchHandledClick.current = true;
    if (navigator.vibrate) navigator.vibrate(30);
    onSelectMsg(item.id);
    onSetReactionPicker(item.id);
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
        openActionsAndReactions();
      }
    }, 320);
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
    openActionsAndReactions();
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

  if (item.is_deleted) {
    const isDeletedByMe = Boolean(
      (item.deleted_by && item.deleted_by.trim().toLowerCase() === myEmail) ||
      (!item.deleted_by && isMine)
    );
    const deleterName = item.deleted_by_name || (item.deleted_by ? getPeerName(item.deleted_by) : getPeerName(item.user));
    return (
      <div
        ref={bubbleRef}
        id={`msg-${item.id}`}
        className={`msg-row ${isMine ? "msg-mine msg-row--mine" : "msg-theirs msg-row--theirs"}`}
      >
        <div className="bw">
          <div
            className={`bubble ${isMine ? "mine msg-bubble--mine" : "theirs msg-bubble--theirs"} msg-bubble msg-deleted-tombstone`}
            style={{
              fontStyle: "italic",
              opacity: 0.82,
              display: "inline-flex",
              alignItems: "center",
              gap: "7px",
              padding: "8px 14px",
              fontSize: "13px",
              background: isMine ? "rgba(109, 175, 120, 0.22)" : "rgba(0, 0, 0, 0.06)",
              color: isMine ? "inherit" : "var(--text-2, #666)",
              borderRadius: "14px",
              userSelect: "none",
            }}
          >
            <span style={{ fontSize: "14px", opacity: 0.9 }}>🚫</span>
            <span>
              {isDeletedByMe ? "This message was deleted by you" : `This message was deleted by ${deleterName}`}
            </span>
            <span
              className="msg-meta-time"
              style={{
                fontSize: "10px",
                marginLeft: "6px",
                opacity: 0.65,
                fontWeight: 500,
              }}
            >
              {formatTime(item.timestamp)}
            </span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={bubbleRef}
      id={`msg-${item.id}`}
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
          <div className="sender-name msg-sender-name" style={{ fontSize: "12px", fontWeight: 700, color: "#4a8b54", marginBottom: "4px", paddingLeft: "4px" }}>
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

          {(item.reply_to || item.reply_to_content) && (
            <div
              className="msg-reply-preview"
              style={{ cursor: "pointer" }}
              onClick={(e) => {
                e.stopPropagation();
                const targetId = item.reply_to_id || item.reply_to?.id;
                if (targetId) {
                  if (onJumpToMessage) {
                    onJumpToMessage(targetId);
                  } else {
                    const el = document.getElementById(`msg-${targetId}`);
                    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
                  }
                }
              }}
            >
              <div className="msg-reply-sender" style={{ fontWeight: 700, fontSize: "12px", color: isMine ? "rgba(255,255,255,0.95)" : "#4a8b54" }}>
                {(() => {
                  const replyUser = item.reply_to?.user || (item as any).reply_to_user || "";
                  if (replyUser) {
                    if (replyUser.toLowerCase() === (currentUser || "").toLowerCase()) {
                      return "You";
                    }
                    return getPeerName(replyUser);
                  }
                  // Fallback if replyUser was omitted in payload:
                  if (isMine) {
                    return chatType === "user" ? getPeerName(item.target_user || (item.user !== currentUser ? item.user : "")) : "Replied message";
                  }
                  return "You";
                })()}
              </div>
              <div className="msg-reply-body">
                {(() => {
                  const replyText = item.reply_to?.content || item.reply_to_content || "";
                  if (replyText.startsWith("[STICKER]")) return "🎨 Sticker";
                  if (replyText.startsWith("[AUDIO]") || replyText.startsWith("[ENC_AUDIO]") || replyText.startsWith("[VOICE]")) return "🎤 Voice Note";
                  if (replyText.startsWith("[IMAGE]") || replyText.startsWith("[ENC_IMAGE]") || replyText.startsWith("[PHOTO]")) return "📷 Photo";
                  if (replyText.startsWith("[VIDEO]") || replyText.startsWith("[ENC_VIDEO]")) return "📹 Video";
                  if (replyText.startsWith("[PDF]") || replyText.startsWith("[ENC_PDF]") || replyText.startsWith("[FILE]") || replyText.startsWith("[ENC_FILE]")) return "📄 Document";
                  if (replyText.startsWith("[")) return "📎 Attachment";
                  return replyText;
                })()}
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
              {isExpired ? (
                <div className="msg-media-expired" style={{ padding: "10px 14px", background: isMine ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.06)", borderRadius: 12, display: "flex", alignItems: "center", gap: 10, fontSize: "0.85rem", color: isMine ? "#fff" : "var(--text-2)" }}>
                  <span style={{ fontSize: "1.3rem" }}>⏳</span>
                  <div>
                    <div style={{ fontWeight: 600 }}>Media expired from server</div>
                    <div style={{ fontSize: "0.75rem", opacity: 0.8 }}>Saved on sender/receiver original devices</div>
                  </div>
                </div>
              ) : isImage || isVideo ? (
                // ── IMAGE & VIDEO MEDIA BOX WITH OVERLAY META ──
                <div className="msg-media-box" onClick={() => (mediaSrc && mediaSrc !== "EXPIRED") && onViewFile(mediaSrc, isImage ? "image" : "video")}>
                  {encKey && !mediaSrc ? (
                    <div style={{ width: 220, height: 160, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, background: "rgba(0,0,0,0.06)", borderRadius: 12 }}>
                      <div style={{ width: 24, height: 24, border: "2.5px solid rgba(0,0,0,0.15)", borderTopColor: "var(--green, #25d366)", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
                      <span style={{ fontSize: "0.82rem", opacity: 0.8, color: "var(--text-1)" }}>Loading...</span>
                    </div>
                  ) : isImage ? (
                    <img
                      src={mediaSrc}
                      alt="attachment"
                      className="msg-img-media"
                      loading="lazy"
                      onError={() => {
                        if (!encKey && mediaSrc !== rawUrl && rawUrl) setMediaSrc(rawUrl);
                      }}
                    />
                  ) : (
                    <div className="msg-video-wrap">
                      <video
                        src={mediaSrc}
                        className="msg-video-media"
                        preload="metadata"
                        muted
                        playsInline
                        onLoadedMetadata={(e) => {
                          try {
                            (e.target as HTMLVideoElement).currentTime = 0.1;
                          } catch {}
                        }}
                        onError={() => {
                          if (!encKey && mediaSrc !== rawUrl && rawUrl) setMediaSrc(rawUrl);
                        }}
                      />
                      <div className="msg-video-play-btn">▶</div>
                    </div>
                  )}
                  {caption && (
                    <div className="msg-media-caption">
                      <FormattedMessageText text={caption} />
                    </div>
                  )}
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
                    {encKey && !mediaSrc ? (
                      <div style={{ padding: "10px 16px", display: "flex", alignItems: "center", gap: 8, fontSize: "0.85rem", opacity: 0.8, color: "var(--text-1)" }}>
                        <div style={{ width: 16, height: 16, border: "2px solid rgba(0,0,0,0.15)", borderTopColor: "var(--green, #25d366)", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
                        <span>Loading audio...</span>
                      </div>
                    ) : (
                      <audio
                        src={mediaSrc}
                        controls
                        className="msg-audio-media"
                        onError={() => {
                          if (!encKey && mediaSrc !== rawUrl && rawUrl) setMediaSrc(rawUrl);
                        }}
                      />
                    )}
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
                      <span className="msg-file-name">{encFileName || (rawUrl || cachedUrl).split("/").pop() || (isPdf ? "Document.pdf" : "Attachment")}</span>
                      <span className="msg-file-sub">{isPdf ? "PDF Document" : "File Attachment"}</span>
                    </div>
                    <div className="msg-file-dl-btn">⬇</div>
                  </div>
                  {caption && (
                    <div className="msg-file-caption" style={{ padding: "4px 8px", fontSize: "0.85rem" }}>
                      <FormattedMessageText text={caption} />
                    </div>
                  )}
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
                  <div className="msg-text msg-text-content">
                    <FormattedMessageText text={item.content} />
                  </div>
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
