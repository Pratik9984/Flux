"use client";

import React, {
  useState, useEffect, useRef, useMemo, useCallback,
  useReducer, useLayoutEffect, memo,
} from "react";
// ─── Extracted modules ────────────────────────────────────────────────────────
import type {
  StickerPackMeta, StickerItem, Chat, Contact, Group, Message,
  GroupedMessage, CallState, ApiOptions, AuthStep, CallLogEntry,
  WsStatus, ProfileTab, StoredCallOffer, AuthState, AuthAction,
  UserStatusGroup, StatusItem, StatusViewEntry,
} from "@/types";
import {
  USERNAME_RE, errorMessage, getEmail, getIsAdmin, safeParseJSON,
  fmtDuration, parseTs, formatTimeAgo, getDateLabel, updateReactionsForUser,
  compressImage,
} from "@/lib/utils";
import { API, WS_URL, uploadMediaToBackend, fetchStatuses } from "@/lib/api";
import { prefetchStatusMedia } from "@/lib/statusPreloader";
import { idbSet, idbGet, idbGetMany, idbDel } from "@/lib/idb";
import { dbGetMessages, dbSaveMessages, dbSaveMessage, dbDeleteMessage, dbClearMessages, dbUpdateMessage, dbPreloadRecentMessages } from "@/lib/db";
import { encryptAvatarBlob } from "@/lib/avatarCrypto";
import { encryptMediaBlob } from "@/lib/mediaCrypto";
import { cacheSentMediaLocally } from "@/lib/mediaCache";
import { AvatarImage } from "@/components/ui/AvatarImage";
import { useDebounce, useDebounceCallback } from "@/hooks/useDebounce";
import { useDebouncedIdb } from "@/hooks/useDebouncedIdb";
import { useChatStore } from "@/stores/chatStore";
import { useAuthStore } from "@/stores/authStore";
import { useCallStore } from "@/stores/callStore";
import { useContactStore } from "@/stores/contactStore";
import { useUiStore } from "@/stores/uiStore";
import { useCrypto } from "@/hooks/useCrypto";
import { useAuth } from "@/hooks/useAuth";
import { useApiFetch } from "@/hooks/useApiFetch";
import { ErrorBoundary } from "@/components/shared/ErrorBoundary";
import ReactionPickerPortal from "@/components/chat/ReactionPickerPortal";
import ContactItem from "@/components/sidebar/ContactItem";
import GroupItem from "@/components/sidebar/GroupItem";
import CallLogRow from "@/components/call/CallLogRow";
import DragSlider from "@/components/call/DragSlider";
import MessageInfoModal from "@/components/chat/MessageInfoModal";
import MessageBubble from "@/components/chat/MessageBubble";
import ContactProfile from "@/components/profile/ContactProfile";
import GroupProfile from "@/components/profile/GroupProfile";
import LiveCameraModal from "@/components/chat/LiveCameraModal";
import StatusScreen from "@/components/status/StatusScreen";
import StatusCreatorModal from "@/components/status/StatusCreatorModal";
import StatusViewerModal from "@/components/status/StatusViewerModal";
import AuthScreen from "@/components/auth/AuthScreen";
import Toast from "@/components/shared/Toast";
import ConfirmDialog from "@/components/shared/ConfirmDialog";
import LegalModal, { type LegalTab } from "@/components/shared/LegalModal";
import { ContactsModal } from "@/components/contacts/ContactsModal";
import { ContactRequestsModal } from "@/components/contacts/ContactRequestsModal";
import { AddContactModal } from "@/components/contacts/AddContactModal";
import { MutualContactsModal } from "@/components/contacts/MutualContactsModal";
import { QRCodeModal } from "@/components/contacts/QRCodeModal";
import {
  acceptContactRequestApi,
  declineContactRequestApi,
  declineAndBlockContactRequestApi,
  cancelContactRequestApi,
  toggleFavoriteContactApi,
  removeContactApi,
  sendContactRequestApi,
  deleteMessageForMeApi,
  deleteMessageForEveryoneApi,
  clearChatApi,
  hideChatApi,
  getHiddenConversationsApi,
} from "@/lib/api";
import type { ContactRequest } from "@/types";
import { useVirtualizer } from "@tanstack/react-virtual";
import { requestNotificationPermission as requestFCMPermission, setupForegroundFCM } from "@/lib/firebase";
import {
  getOrCreateIdentityKeyPair, encryptDM, decryptDM,
  generateGroupKey, wrapGroupKeyForMember, unwrapGroupKey,
  encryptGroupMsg, decryptGroupMsg, isDMEncrypted, isGroupEncrypted, groupKeyCache,
} from "@/lib/crypto";
import {
  requestNotifyPermission, showLocalNotification, showCallNotification, cancelCallNotification,
  clearAllDeliveredNotifications, initNotifications, isNative,
} from "@/lib/notifications";
import { shareContent } from "@/lib/share";
import { Camera, CameraResultType, CameraSource } from "@capacitor/camera";
import { App as CapApp } from "@capacitor/app";
import { StatusBar, Style } from "@capacitor/status-bar";
import { Haptics, ImpactStyle } from "@capacitor/haptics";
import { Filesystem, Directory } from "@capacitor/filesystem";
import { requestAllAppPermissions } from "@/lib/permissions";
import { CURRENT_APP_VERSION, checkLatestUpdate, applyAppUpdate, type UpdateInfo } from "@/lib/updater";

// ─── MEDIA LABEL NOTIFICATION FORMATTER (Item 1) ──────────────────────────────
function formatNotificationMedia(content: string): string {
  if (!content) return "New message";
  const s = content.trim();
  if (s.startsWith("[E2E]") || s.startsWith("[E2EG]")) return "🔒 Encrypted message";

  const extractCap = (raw: string, defaultLabel: string) => {
    const parts = raw.split("\n");
    if (parts.length > 1) {
      const cap = parts.slice(1).join("\n").trim();
      if (cap && !cap.startsWith("http") && !cap.startsWith("[")) {
        return `${defaultLabel}: ${cap}`;
      }
    }
    return defaultLabel;
  };

  if (s.startsWith("[ENC_IMAGE]") || s.startsWith("[IMAGE]")) return extractCap(s, "📷 Photo");
  if (s.startsWith("[ENC_VIDEO]") || s.startsWith("[VIDEO]")) return extractCap(s, "🎥 Video");
  if (s.startsWith("[ENC_AUDIO]") || s.startsWith("[AUDIO]")) return extractCap(s, "🎤 Voice message");
  if (s.startsWith("[ENC_PDF]") || s.startsWith("[PDF]")) return extractCap(s, "📄 Document (PDF)");
  if (s.startsWith("[ENC_FILE]") || s.startsWith("[FILE]")) return extractCap(s, "📎 Document");
  if (s.includes("/files/") || s.includes("/uploads/")) {
    const lower = s.toLowerCase();
    if (lower.includes(".jpg") || lower.includes(".png") || lower.includes(".jpeg") || lower.includes(".webp") || lower.includes(".gif")) {
      return extractCap(s, "📷 Photo");
    }
    if (lower.includes(".mp4") || lower.includes(".webm") || lower.includes(".mov") || lower.includes(".3gp")) {
      return extractCap(s, "🎥 Video");
    }
    if (lower.includes(".mp3") || lower.includes(".ogg") || lower.includes(".wav") || lower.includes(".m4a")) {
      return extractCap(s, "🎤 Voice message");
    }
    if (lower.includes(".pdf")) return extractCap(s, "📄 Document (PDF)");
    return extractCap(s, "📎 Document");
  }
  if (s.startsWith("[")) return extractCap(s, "📎 Attachment");
  return s;
}

// â”€â”€â”€ AUTH REDUCER (kept here â€” depends on AuthState/AuthAction types from @/types) â”€â”€
const authInit: AuthState = { step: "welcome", email: "", pass: "", pass2: "", user: "", loading: false, error: "" };

function authReducer(state: AuthState, action: AuthAction): AuthState {
  switch (action.type) {
    case "SET_STEP": return { ...state, step: action.step, error: "" };
    case "SET_FIELD": return { ...state, [action.field]: action.value };
    case "SET_LOADING": return { ...state, loading: action.value };
    case "SET_ERROR": return { ...state, error: action.value, loading: false };
    case "RESET": return authInit;
    default: return state;
  }
}

// ─── CALL DURATION COMPONENT ──────────────────────────────────────────────────
interface CallDurationDisplayProps {
  callStartTime: number | null;
  callState: CallState;
}

function CallDurationDisplay({ callStartTime, callState }: CallDurationDisplayProps) {
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    if (callState !== "connected" || !callStartTime) {
      setDuration(0);
      return;
    }
    const update = () => {
      setDuration(Math.floor((Date.now() - callStartTime) / 1000));
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [callStartTime, callState]);

  return <>{fmtDuration(duration)}</>;
}

// ─── MESSAGE INPUT SECTION COMPONENT ──────────────────────────────────────────
const EMOJIS = ["😀", "😃", "😄", "😁", "😆", "😅", "🤣", "😂", "🙂", "😊", "😇", "🥰", "😍", "🤩", "😘", "😗", "😚", "😙", "🥲", "😋", "😛", "😜", "🤪", "😝", "🤑", "🤗", "🤭", "🫢", "🤫", "🤔", "🫡", "🤐", "🤨", "😐", "😑", "😶", "😏", "😒", "🙄", "😬", "🤥", "😌", "😔", "😪", "🤤", "😴", "😷", "🤒", "🤕", "🤢", "🤮", "🥵", "🥶", "🥴", "😵", "🤯", "🤠", "🥳", "😎", "🤓", "🧐", "😕", "😟", "🙁", "☹️", "😮", "😯", "😲", "😳", "🥺", "😦", "😧", "😨", "😰", "😥", "😢", "😭", "😱", "😖", "😣", "😞", "😓", "😩", "😫", "🥱", "😤", "😡", "😠", "🤬", "💀", "👻", "😈", "👿", "💩", "🤡", "👹", "👍", "👎", "👌", "✌️", "🤞", "🫰", "🤟", "🤘", "🤙", "👈", "👉", "👆", "👇", "☝️", "✋", "🤚", "🖐️", "👋", "🤏", "👏", "🙌", "🫶", "🤲", "🙏", "✍️", "💪", "❤️", "🧡", "💛", "💚", "💙", "💜", "🔥", "💫", "⭐", "🌟", "✨", "💥", "❄️", "🌈", "☀️", "🌙", "🎉", "🎊", "🎈", "🎁", "🏆", "🥇", "🎵", "🎶", "🎤", "🎸", "🎹", "🚀", "✈️", "🌍", "🌊", "🌺", "🌸", "🍕", "🍔", "☕", "✅", "❌", "⚡", "💯", "💬", "📌", "🔗", "🔑", "💡", "🔔", "📢", "👀", "💤", "🆗", "🆙", "🔝"];
const EMOJI_ROWS = (() => {
  const COLS = 10, rows = [];
  for (let i = 0; i < EMOJIS.length; i += COLS) rows.push(EMOJIS.slice(i, i + COLS));
  return rows;
})();

interface MessageInputSectionProps {
  activeChat: Chat | null;
  currentUser: string;
  token: string;
  apiFetch: any;
  isRecording: boolean;
  recordingDuration: number;
  isUploadingAttachment: boolean;
  replyingTo: Message | null;
  setReplyingTo: (msg: Message | null) => void;
  showEmojiPanel: boolean;
  setShowEmojiPanel: (show: boolean) => void;
  emojiPanelTab: "emojis" | "stickers";
  setEmojiPanelTab: (tab: "emojis" | "stickers") => void;
  showEmojis: boolean;
  setShowEmojis: (show: boolean) => void;
  showStickers: boolean;
  setShowStickers: (show: boolean) => void;
  setShowCameraDrawer: (show: boolean) => void;
  setShowPlusDrawer: (show: boolean) => void;
  pendingFile: any;
  pendingFiles: any[];
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  cameraPhotoInputRef: React.RefObject<HTMLInputElement | null>;
  cameraVideoInputRef: React.RefObject<HTMLInputElement | null>;
  cancelRecordingRef: React.RefObject<boolean>;
  handleFile: (e: React.ChangeEvent<HTMLInputElement>) => void;
  isNarrowScreen: boolean;
  toggleRecording: () => void;
  onSendMessage: () => void;
  onSendSticker: (url: string) => void;
  onTakePhoto?: () => void;
  onPickFile?: () => void;
  wsSend: (msg: string) => void;
}

const MessageInputSection = memo(function MessageInputSection({
  activeChat,
  currentUser,
  token,
  apiFetch,
  isRecording,
  recordingDuration,
  isUploadingAttachment,
  replyingTo,
  setReplyingTo,
  showEmojiPanel,
  setShowEmojiPanel,
  emojiPanelTab,
  setEmojiPanelTab,
  showEmojis,
  setShowEmojis,
  showStickers,
  setShowStickers,
  setShowCameraDrawer,
  setShowPlusDrawer,
  pendingFile,
  pendingFiles,
  fileInputRef,
  cameraPhotoInputRef,
  cameraVideoInputRef,
  cancelRecordingRef,
  handleFile,
  isNarrowScreen,
  toggleRecording,
  onSendMessage,
  onSendSticker,
  onTakePhoto,
  onPickFile,
  wsSend,
}: MessageInputSectionProps) {
  const inputMsg = useChatStore(s => s.inputMsg);
  const setInputMsg = useChatStore(s => s.setInputMsg);

  const [focusedEmojiCoord, setFocusedEmojiCoord] = useState<{ r: number; c: number }>({ r: 0, c: 0 });
  const [stickerPacks, setStickerPacks] = useState<StickerPackMeta[]>([]);
  const [packStickers, setPackStickers] = useState<Record<number, StickerItem[]>>({});
  const [activeStickerPack, setActiveStickerPack] = useState<number | null>(null);
  const [loadingStickers, setLoadingStickers] = useState(false);

  const emojiActiveCellRef = useRef<HTMLButtonElement | null>(null);
  const emojiToggleRef = useRef<HTMLButtonElement | null>(null);

  // Sync draft on chat change
  useEffect(() => {
    if (typeof window !== "undefined" && activeChat) {
      idbGet<Record<string, string>>("cached_chat_drafts").then(drafts => {
        setInputMsg((drafts || {})[String(activeChat.id)] || "");
      }).catch(() => setInputMsg(""));
    } else {
      setInputMsg("");
    }
  }, [activeChat, setInputMsg]);

  // Sync draft to storage on type
  useEffect(() => {
    if (typeof window !== "undefined" && activeChat) {
      idbGet<Record<string, string>>("cached_chat_drafts").then(existing => {
        const drafts = existing || {};
        if (inputMsg.trim()) {
          drafts[String(activeChat.id)] = inputMsg;
        } else {
          delete drafts[String(activeChat.id)];
        }
        idbSet("cached_chat_drafts", drafts);
      }).catch(() => { });
    }
  }, [inputMsg, activeChat]);

  // Load packs
  useEffect(() => {
    if (!showStickers || !token || stickerPacks.length > 0) return;
    apiFetch("/stickers/packs").then((packs: any) => {
      setStickerPacks(packs);
      if (packs.length > 0) setActiveStickerPack(packs[0].id);
    }).catch(() => {});
  }, [showStickers, token, apiFetch, stickerPacks.length]);

  // Load pack items
  useEffect(() => {
    if (!activeStickerPack || packStickers[activeStickerPack]) return;
    setLoadingStickers(true);
    apiFetch(`/stickers/packs/${activeStickerPack}`)
      .then((items: any) => setPackStickers(prev => ({ ...prev, [activeStickerPack]: items })))
      .catch(() => {})
      .finally(() => setLoadingStickers(false));
  }, [activeStickerPack, packStickers, apiFetch]);

  useEffect(() => { if (showEmojis && emojiActiveCellRef.current) emojiActiveCellRef.current.focus(); }, [focusedEmojiCoord, showEmojis]);

  const prevShowEmojis = useRef(showEmojis);
  useEffect(() => {
    if (showEmojis) setFocusedEmojiCoord({ r: 0, c: 0 });
    else if (prevShowEmojis.current && !showEmojis) emojiToggleRef.current?.focus();
    prevShowEmojis.current = showEmojis;
  }, [showEmojis]);

  const handleEmojiKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, r: number, c: number) => {
    let nextR = r, nextC = c;
    const rowCount = EMOJI_ROWS.length;
    const colCount = EMOJI_ROWS[r].length;
    let handled = true;
    switch (e.key) {
      case "ArrowRight": if (c < colCount - 1) nextC = c + 1; else if (r < rowCount - 1) { nextR = r + 1; nextC = 0; } break;
      case "ArrowLeft": if (c > 0) nextC = c - 1; else if (r > 0) { nextR = r - 1; nextC = EMOJI_ROWS[r - 1].length - 1; } break;
      case "ArrowDown": if (r < rowCount - 1) { nextR = r + 1; nextC = Math.min(c, EMOJI_ROWS[r + 1].length - 1); } break;
      case "ArrowUp": if (r > 0) { nextR = r - 1; nextC = Math.min(c, EMOJI_ROWS[r - 1].length - 1); } break;
      case "Home": nextC = 0; break;
      case "End": nextC = colCount - 1; break;
      case "Escape": setShowEmojis(false); break;
      default: handled = false;
    }
    if (handled) { e.preventDefault(); e.stopPropagation(); setFocusedEmojiCoord({ r: nextR, c: nextC }); }
  };

  const activeChatRef = useRef(activeChat);
  useEffect(() => { activeChatRef.current = activeChat; }, [activeChat]);

  const lastTypingSentRef = useRef<number>(0);

  const handleTyping = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputMsg(e.target.value);
    const now = Date.now();
    // Immediate on first keystroke, throttled to max once every 2.5s to eliminate spam
    if (now - lastTypingSentRef.current > 2500) {
      lastTypingSentRef.current = now;
      if (activeChatRef.current?.type === "user") {
        wsSend(JSON.stringify({ type: "typing", target_user: activeChatRef.current.id }));
      }
    }
  };

  return (
    <>
      {/* ── EMOJI/STICKER PANEL ── */}
      {showEmojiPanel && (
        <div 
          className="emoji-panel"
          onClick={e => e.stopPropagation()}
          onMouseDown={e => e.stopPropagation()}
          onTouchStart={e => e.stopPropagation()}
        >
          <div style={{ display: "flex", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
            {(["emojis", "stickers"] as const).map(tab => (
              <button
                key={tab}
                type="button"
                onClick={e => { e.preventDefault(); e.stopPropagation(); setEmojiPanelTab(tab); }}
                onTouchStart={e => { e.stopPropagation(); setEmojiPanelTab(tab); }}
                style={{ flex: 1, padding: 10, border: "none", background: emojiPanelTab === tab ? "var(--surface-3)" : "transparent", color: emojiPanelTab === tab ? "var(--primary)" : "var(--text-2)", fontWeight: emojiPanelTab === tab ? "bold" : "normal", cursor: "pointer", fontSize: 13, borderBottom: emojiPanelTab === tab ? "2px solid var(--primary)" : "none" }}
              >
                {tab === "emojis" ? "😀 Emojis" : "🖼️ Stickers"}
              </button>
            ))}
          </div>
          <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column" }}>
            {emojiPanelTab === "emojis" ? (
              <div role="grid" aria-label="Emoji picker" style={{ padding: 8 }}>
                {EMOJI_ROWS.map((row, r) => (
                  <div key={r} role="row" style={{ display: "flex", gap: 2 }}>
                    {row.map((e, c) => {
                      const isFocused = r === focusedEmojiCoord.r && c === focusedEmojiCoord.c;
                      return (
                        <button
                          key={e}
                          type="button"
                          ref={isFocused ? emojiActiveCellRef : null}
                          tabIndex={isFocused ? 0 : -1}
                          onClick={ev => { ev.stopPropagation(); setInputMsg(prev => prev + e); }}
                          onKeyDown={ev => handleEmojiKeyDown(ev, r, c)}
                          className="emoji-cell"
                          role="gridcell"
                          aria-label={e}
                        >
                          {e}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
                <div style={{ display: "flex", gap: 4, padding: "8px 10px 6px", borderBottom: "1px solid var(--border)", overflowX: "auto", flexShrink: 0 }}>
                  {stickerPacks.map(pack => (
                    <button 
                      key={pack.id} 
                      type="button"
                      onClick={e => { e.preventDefault(); e.stopPropagation(); setActiveStickerPack(pack.id); }} 
                      onTouchStart={e => { e.stopPropagation(); setActiveStickerPack(pack.id); }}
                      title={pack.name} 
                      style={{ background: activeStickerPack === pack.id ? "var(--surface-3)" : "transparent", border: activeStickerPack === pack.id ? "1px solid var(--border-2)" : "1px solid transparent", borderRadius: 8, padding: 3, cursor: "pointer", flexShrink: 0 }}
                    >
                      <img src={pack.thumbnail_url} alt={pack.name} style={{ width: 28, height: 28, objectFit: "contain" }} />
                    </button>
                  ))}
                </div>
                <div style={{ flex: 1, overflowY: "auto", padding: 8 }}>
                  {loadingStickers ? (
                    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100%" }}>
                      <span className="spinner" style={{ width: 20, height: 20 }} />
                    </div>
                  ) : activeStickerPack && packStickers[activeStickerPack] ? (
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 4 }}>
                      {packStickers[activeStickerPack].map(sticker => (
                        <button 
                          key={sticker.id} 
                          type="button"
                          onClick={e => { e.preventDefault(); e.stopPropagation(); onSendSticker(sticker.url); }} 
                          title={sticker.name || ""} 
                          style={{ background: "none", border: "none", cursor: "pointer", padding: 4, borderRadius: 8, transition: "background 0.15s" }} 
                          onMouseEnter={e => (e.currentTarget.style.background = "var(--surface-2)")} 
                          onMouseLeave={e => (e.currentTarget.style.background = "none")}
                        >
                          <img src={sticker.url} alt={sticker.name || "sticker"} style={{ width: 48, height: 48, objectFit: "contain", display: "block" }} loading="lazy" />
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div style={{ textAlign: "center", color: "var(--text-3)", fontSize: 13, marginTop: 20 }}>Select a pack above</div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── INPUT BAR ── */}
      <div className="input-bar">
        {isRecording ? (
          <div style={{ display: "flex", alignItems: "center", flex: 1, padding: "0 10px", gap: 16 }}>
            <div className="rec-waveform-container">
              <span className="rec-waveform-bar"></span>
              <span className="rec-waveform-bar"></span>
              <span className="rec-waveform-bar"></span>
              <span className="rec-waveform-bar"></span>
              <span className="rec-waveform-bar"></span>
            </div>
            <span style={{ color: "var(--red)", fontWeight: 600, flex: 1 }}>Recording · {fmtDuration(recordingDuration)}</span>
            <button onClick={() => { cancelRecordingRef.current = true; toggleRecording(); }} style={{ color: "var(--text-3)", background: "none", border: "none", cursor: "pointer", fontSize: 14 }}>Cancel</button>
            <button onClick={toggleRecording} className="send-btn" aria-label="Send voice message">➤</button>
          </div>
        ) : (
          <>
            <input type="file" ref={fileInputRef} onChange={handleFile} accept="image/*,audio/*,video/*,.pdf,.doc,.docx" className="hidden-input" multiple />
            <input type="file" ref={cameraPhotoInputRef} onChange={handleFile} accept="image/*" capture="environment" className="hidden-input" />
            <input type="file" ref={cameraVideoInputRef} onChange={handleFile} accept="video/*" capture="environment" className="hidden-input" />

            <div className="msg-input-wrapper">
              <button ref={emojiToggleRef} onClick={e => { e.stopPropagation(); setShowEmojiPanel(!showEmojiPanel); }} className={`input-inline-btn ${showEmojiPanel ? "active" : ""}`} aria-label="Emoji & Stickers" aria-expanded={showEmojiPanel} type="button">😀</button>
              <input
                value={inputMsg}
                onChange={handleTyping}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSendMessage(); } }}
                placeholder={isUploadingAttachment ? "Sending..." : "Message..."}
                className="msg-input-field"
                disabled={isRecording || isUploadingAttachment}
              />
              <button onClick={() => setShowPlusDrawer(true)} className="input-inline-btn attach-btn" title="Attach media or files" aria-label="Attachment options" type="button">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" /></svg>
              </button>
              <button onClick={onTakePhoto || (() => setShowCameraDrawer(true))} className="input-inline-btn camera-btn" title="Take photo" aria-label="Camera" type="button">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></svg>
              </button>
            </div>

            {inputMsg.trim() || pendingFile || pendingFiles.length > 0 ? (
              <button onClick={onSendMessage} disabled={isRecording || isUploadingAttachment} className="send-btn" aria-label="Send message">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
              </button>
            ) : (
              <button onClick={toggleRecording} className={`mic-btn-circle ${isRecording ? "tool-btn--rec" : ""}`} title="Voice message" aria-label="Record voice message">
                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" /></svg>
              </button>
            )}
          </>
        )}
      </div>
    </>
  );
});

// â”€â”€â”€ CONSTANTS & UTILITIES â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// â”€â”€â”€ MAIN COMPONENT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
class RingbackToneGenerator {
  private ctx: AudioContext | null = null;
  private osc1: OscillatorNode | null = null;
  private osc2: OscillatorNode | null = null;
  private gainNode: GainNode | null = null;
  private intervalId: any = null;

  start() {
    this.stop();
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      this.ctx = new AudioCtx();
      this.gainNode = this.ctx.createGain();
      this.gainNode.gain.setValueAtTime(0, this.ctx.currentTime);
      this.gainNode.connect(this.ctx.destination);

      this.osc1 = this.ctx.createOscillator();
      this.osc1.type = "sine";
      this.osc1.frequency.setValueAtTime(440, this.ctx.currentTime);
      this.osc1.connect(this.gainNode);

      this.osc2 = this.ctx.createOscillator();
      this.osc2.type = "sine";
      this.osc2.frequency.setValueAtTime(480, this.ctx.currentTime);
      this.osc2.connect(this.gainNode);

      this.osc1.start();
      this.osc2.start();

      const playCycle = () => {
        if (!this.ctx || !this.gainNode) return;
        const now = this.ctx.currentTime;
        // Ring for 2 seconds (fade in 50ms, fade out 50ms)
        this.gainNode.gain.setValueAtTime(0, now);
        this.gainNode.gain.linearRampToValueAtTime(0.12, now + 0.05);
        this.gainNode.gain.setValueAtTime(0.12, now + 1.95);
        this.gainNode.gain.linearRampToValueAtTime(0, now + 2.0);
      };

      playCycle();
      this.intervalId = setInterval(playCycle, 6000); // 6s cycle (2s ring, 4s silence)
    } catch (e) {
      console.error("Failed to start ringback tone generator:", e);
    }
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    try {
      if (this.osc1) { this.osc1.stop(); this.osc1.disconnect(); this.osc1 = null; }
      if (this.osc2) { this.osc2.stop(); this.osc2.disconnect(); this.osc2 = null; }
      if (this.gainNode) { this.gainNode.disconnect(); this.gainNode = null; }
      if (this.ctx && this.ctx.state !== "closed") { this.ctx.close(); this.ctx = null; }
    } catch (e) {
      console.error("Failed to stop ringback tone generator:", e);
    }
  }
}

function normalizeSdp(raw: any): RTCSessionDescriptionInit | null {
  if (!raw) return null;
  let target = raw;
  if (typeof target === "string") {
    try {
      target = JSON.parse(target);
    } catch {
      if (typeof target === "string" && target.includes("v=")) {
        return { type: "offer", sdp: target };
      }
      return null;
    }
  }
  if (!target || typeof target !== "object") return null;

  if (target.sdp && typeof target.sdp === "object" && target.sdp.sdp) {
    target = target.sdp;
  } else if (typeof target.sdp === "string" && target.sdp.trim().startsWith("{")) {
    try {
      const inner = JSON.parse(target.sdp);
      if (inner && (inner.sdp || inner.type)) target = inner;
    } catch {}
  }

  const type: RTCSdpType = (target.type === "offer" || target.type === "answer" || target.type === "pranswer" || target.type === "rollback")
    ? target.type
    : "offer";

  const sdpStr = typeof target.sdp === "string" ? target.sdp : (typeof target === "string" ? target : "");
  if (!sdpStr || !sdpStr.includes("v=")) return null;

  return { type, sdp: sdpStr };
}

export const triggerHaptic = (style: ImpactStyle = ImpactStyle.Light) => {
  if (isNative()) {
    Haptics.impact({ style }).catch(() => {});
  } else if (typeof navigator !== "undefined" && navigator.vibrate) {
    navigator.vibrate(15);
  }
};

export default function FluxChat() {
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js")
      .then(() => { idbSet("api_url", API); })
      .catch(() => { });
  }, []);

  const cryptoHook = useCrypto();
  const {
    auth, dispatchAuth, supabase, handleSignIn, handleSignUp, handleRegister,
    handleForgotPassword, handleResetPassword, logout: hookLogout, loadProfile: hookLoadProfile,
    _finalizeAuth, _registerFCMToken
  } = useAuth(cryptoHook);

  const { token, setToken, currentUser, setCurrentUser, profile, setProfile, updateProfile } = useAuthStore();
  const {
    blockedUsers, setBlockedUsers,
    nicknames, setNicknames,
    mutedChats, setMutedChats,
    addBlockedUser, removeBlockedUser,
    muteChat: storeMuteChat, unmuteChat: storeUnmuteChat,
    incomingRequests, setIncomingRequests,
    outgoingRequests, setOutgoingRequests,
    removeIncomingRequest, removeOutgoingRequest,
    removeContact: removeContactFromStore,
  } = useContactStore();
  const [showBlockedList, setShowBlockedList] = useState(false);
  const isAuth = !!token;

  const tokenRef = useRef(token);
  const currentUserRef = useRef(currentUser);
  const blockedUsersRef = useRef(blockedUsers);
  useEffect(() => { tokenRef.current = token; }, [token]);
  useEffect(() => { currentUserRef.current = currentUser; }, [currentUser]);
  useEffect(() => { blockedUsersRef.current = blockedUsers; }, [blockedUsers]);

  const { e2ePrivKeyRef, e2ePubKeyB64Ref, pubKeyCache } = cryptoHook;

  const lastInitKeyUserRef = useRef<string>("");
  useEffect(() => {
    if (currentUser && lastInitKeyUserRef.current !== currentUser) {
      lastInitKeyUserRef.current = currentUser;
      cryptoHook.initializeKeys(currentUser);
    }
  }, [currentUser]);
  const abortControllerRef = useRef<AbortController>(new AbortController());
  const ringbackToneRef = useRef<RingbackToneGenerator | null>(null);
  if (!ringbackToneRef.current && typeof window !== "undefined") {
    ringbackToneRef.current = new RingbackToneGenerator();
  }

  useEffect(() => { if (typeof document !== "undefined") document.body.classList.toggle("auth-mode", !isAuth); }, [isAuth]);

  // Sync auth token with Android native background service
  useEffect(() => {
    if (typeof window !== "undefined" && token) {
      try {
        (window as any).FluxNativeBridge?.syncAuthToken(token);
      } catch {}
    }
  }, [token]);

  const apiFetch = useCallback(async <T,>(path: string, opts: ApiOptions = {}): Promise<T> => {
    const headers = new Headers(opts.headers as HeadersInit | undefined);
    if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    headers.set("ngrok-skip-browser-warning", "true");
    if (tokenRef.current) headers.set("Authorization", `Bearer ${tokenRef.current}`);
    const signal = opts.signal ?? (
      abortControllerRef.current.signal.aborted
        ? (abortControllerRef.current = new AbortController()).signal
        : abortControllerRef.current.signal
    );
    const res = await fetch(`${API}${path}`, { ...opts, headers, signal });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ detail: "Request failed" }));
      throw new Error(body.detail || "Request failed");
    }
    return res.json();
  }, []);

  // ── BLOCK/UNBLOCK ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!token) return;
    apiFetch<{ email: string }[]>("/blocks")
      .then(list => setBlockedUsers(new Set(list.map(b => b.email))))
      .catch(() => { });
  }, [token, apiFetch]);

  const blockUser = async (targetEmail: string) => {
    showConfirm(`Block ${targetEmail}? They won't be able to message or call you.`, async () => {
      try {
        await apiFetch(`/blocks/${encodeURIComponent(targetEmail)}`, { method: "POST" });
        addBlockedUser(targetEmail);
        setContacts(contacts.filter(c => c.email !== targetEmail));
        if (activeChat?.id === targetEmail) { setActiveChat(null); setMessages([]); }
        showToast("User blocked", "success");
        setShowContactProfile(false);
      } catch (err) { showToast("Failed to block: " + errorMessage(err), "error"); }
    });
  };

  const unblockUser = async (targetEmail: string) => {
    try {
      await apiFetch(`/blocks/${encodeURIComponent(targetEmail)}`, { method: "DELETE" });
      removeBlockedUser(targetEmail);
      showToast("User unblocked", "success");
    } catch (err) { showToast("Failed to unblock: " + errorMessage(err), "error"); }
  };

  // ── MUTE ─────────────────────────────────────────────────────────────────────
  const muteChat = async (chatId: string, chatType: "user" | "group", duration: "8h" | "1w" | "forever") => {
    try {
      const res = await apiFetch<{ muted_until: string | null }>(
        `/mute/${chatType}/${encodeURIComponent(chatId)}`,
        { method: "POST", body: JSON.stringify({ duration }) },
      );
      storeMuteChat(chatId, res.muted_until ? new Date(res.muted_until).getTime() : null);
      const label = duration === "8h" ? "8 hours" : duration === "1w" ? "1 week" : "forever";
      showToast(`Muted for ${label}`, "success");
    } catch (err) { showToast("Failed to mute: " + errorMessage(err), "error"); }
    setShowMuteMenu(false);
  };

  const unmuteChat = async (chatId: string, chatType: "user" | "group") => {
    try {
      await apiFetch(`/mute/${chatType}/${encodeURIComponent(chatId)}`, { method: "DELETE" });
      storeUnmuteChat(chatId);
      showToast("Notifications unmuted", "success");
    } catch (err) { showToast("Failed to unmute: " + errorMessage(err), "error"); }
    setShowMuteMenu(false);
  };

  // ── SUPABASE PASSWORD RECOVERY ───────────────────────────────────────────────
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(event => {
      if (event === "PASSWORD_RECOVERY") dispatchAuth({ type: "SET_STEP", step: "reset-password" });
    });
    return () => subscription.unsubscribe();
  }, []);

  // ── STATE ─────────────────────────────────────────────────────────────────────
  const hasLoadedCacheRef = useRef(false);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  useDebouncedIdb(hasLoadedCacheRef.current && contacts.length > 0 ? "cached_contacts" : "", contacts);
  useDebouncedIdb(hasLoadedCacheRef.current && groups.length > 0 ? "cached_groups" : "", groups);

  const {
    activeChat, setActiveChat,
    messages, setMessages,
    hasMore, setHasMore,
    loadingMore, setLoadingMore,
    unread, setUnread,
    lastActivity, setLastActivity,
    lastPreview, setLastPreview,
    failedMsgIds, setFailedMsgIds,
    deletedMsgIds, setDeletedMsgIds,
    deletedForMeIds, setDeletedForMeIds,
  } = useChatStore();

  const {
    toast, showToast, hideToast,
    confirmDialog, showConfirm, hideConfirm,
    deleteConfirm, setDeleteConfirm,
  } = useUiStore();

  const totalUnread = useMemo(() => Object.values(unread).reduce((sum, n) => sum + (n || 0), 0), [unread]);
  useDebouncedIdb(hasLoadedCacheRef.current && token ? "cached_unread" : "", unread, 1000);

  // Synchronize active chat to localStorage to prevent background process kill loss
  useEffect(() => {
    if (typeof window !== "undefined") {
      if (activeChat) {
        localStorage.setItem("cached_active_chat", JSON.stringify(activeChat));
      } else {
        localStorage.removeItem("cached_active_chat");
      }
    }
  }, [activeChat]);

  const pendingTempTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const lastReplacedTempRef = useRef<string | null>(null);

  const deletedMsgIdsRef = useRef<Set<string>>(new Set<string>());
  useEffect(() => { deletedMsgIdsRef.current = deletedMsgIds; }, [deletedMsgIds]);

  const deletedForMeIdsRef = useRef<Set<string>>(new Set<string>());
  useEffect(() => { deletedForMeIdsRef.current = deletedForMeIds; }, [deletedForMeIds]);

  useEffect(() => {
    if (!currentUser) return;
    const loadDeleted = async () => {
      try {
        const saved = await idbGet<string[]>(`deleted_msgs_${currentUser}`);
        const ids = saved ? new Set<string>(saved) : new Set<string>();
        setDeletedMsgIds(ids);
        deletedMsgIdsRef.current = ids;
      } catch { }
      try {
        const savedForMe = await idbGet<string[]>(`deleted_for_me_${currentUser}`);
        const idsForMe = savedForMe ? new Set<string>(savedForMe) : new Set<string>();
        setDeletedForMeIds(idsForMe);
        deletedForMeIdsRef.current = idsForMe;
      } catch { }
    };
    loadDeleted();
  }, [currentUser]);

  const [hiddenChats, setHiddenChats] = useState<Set<string>>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem("pulse_hidden_chats");
        if (saved) return new Set(JSON.parse(saved).map((s: string) => String(s).toLowerCase()));
      } catch {}
    }
    return new Set<string>();
  });
  const hiddenChatsRef = useRef<Set<string>>(hiddenChats);
  useEffect(() => { hiddenChatsRef.current = hiddenChats; }, [hiddenChats]);

  useEffect(() => {
    if (!token) return;
    getHiddenConversationsApi(token).then(serverHidden => {
      if (serverHidden && Array.isArray(serverHidden)) {
        setHiddenChats(prev => {
          const next = new Set(prev);
          serverHidden.forEach(item => {
            const sid = item.peer_email ? item.peer_email.toLowerCase() : String(item.group_id);
            next.add(sid);
          });
          try { localStorage.setItem("pulse_hidden_chats", JSON.stringify([...next])); } catch {}
          return next;
        });
      }
    }).catch(() => {});
  }, [token]);

  const unhideChat = useCallback((chatId: string | number) => {
    const sid = String(chatId).toLowerCase();
    if (hiddenChatsRef.current.has(sid)) {
      setHiddenChats(prev => {
        if (!prev.has(sid)) return prev;
        const next = new Set(prev);
        next.delete(sid);
        try { localStorage.setItem("pulse_hidden_chats", JSON.stringify([...next])); } catch {}
        return next;
      });
    }
  }, []);

  useEffect(() => {
    if (!currentUser) return;
    idbGet<Record<string, Message[]>>(`pinned_msgs_${currentUser}`).then(saved => {
      if (saved) setPinnedMessages(saved);
    }).catch(() => { });
  }, [currentUser]);

  const savePinnedMessages = (next: Record<string, Message[]>) => {
    setPinnedMessages(next);
    if (currentUser) {
      idbSet(`pinned_msgs_${currentUser}`, next).catch(() => { });
    }
  };

  // ─── OFFLINE LOCAL MESSAGE CACHE UTILITIES ──────────────────────────────────
  const saveMessagesCache = useCallback((cache: Record<string, Message[]>) => {
    if (!currentUserRef.current) return;
    try {
      const slicedCache: Record<string, Message[]> = {};
      Object.entries(cache).forEach(([chatId, msgs]) => {
        slicedCache[chatId] = msgs.slice(-50);
      });
      idbSet(`cached_messages_cache_${currentUserRef.current}`, slicedCache);
    } catch (e) {
      console.error("Failed to save message cache to IndexedDB", e);
    }
  }, []);

  useEffect(() => {
    if (!currentUser) return;
    const loadCache = async () => {
      try {
        const loaded = await idbGet<Record<string, Message[]>>(`cached_messages_cache_${currentUser}`);
        if (loaded) {
          messagesCacheRef.current = loaded;
          if (activeChatRef.current && loaded[String(activeChatRef.current.id)]) {
            setMessages(loaded[String(activeChatRef.current.id)]);
          }
        }
      } catch (err) {
        console.error("Failed to load IndexedDB message cache:", err);
      }
      try {
        const savedPending = await idbGet<string[]>(`pending_messages_${currentUser}`);
        if (savedPending) {
          pendingMessages.current = savedPending;
        } else {
          pendingMessages.current = [];
        }
      } catch { }
    };
    loadCache();
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser) return;
    saveMessagesCache(messagesCacheRef.current);
  }, [messages, unread, saveMessagesCache, currentUser]);

  // ─── OFFLINE RESUME & NETWORK STATUS HANDLERS ──────────────────────────────
  useEffect(() => {
    const handleOnline = () => {
      showToast("Back online", "success");
      setWsStatus("reconnecting");
      initWSRef.current?.();
      if (activeChatRef.current) {
        loadHistoryRef.current?.(activeChatRef.current).catch(() => {});
      }
    };

    const handleOffline = () => {
      showToast("No internet", "error");
      setWsStatus("offline");
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [showToast]);

  // ─── WEB BROWSER RESUME/VISIBILITY HANDLER ──────────────────────────────────
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        const pendingChat = (window as any).FluxNativeBridge?.getPendingOpenChat?.();
        if (pendingChat && openChatByChatIdRef.current) {
          openChatByChatIdRef.current(pendingChat);
        }
        if (wsRef.current?.readyState !== WebSocket.OPEN) initWSRef.current?.();
        if (activeChatRef.current) {
          loadHistoryRef.current?.(activeChatRef.current).catch(() => {});
        }
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  const [editingId, setEditingId] = useState<string | number | null>(null);
  const [editingText, setEditingText] = useState("");
  const [typingSet, setTypingSet] = useState<Set<string>>(new Set());
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [forwardingMsgs, setForwardingMsgs] = useState<Message[]>([]);
  const [showForwardPicker, setShowForwardPicker] = useState(false);
  const [reactionPickerId, setReactionPickerId] = useState<string | number | null>(null);
  const [selectedMsgId, setSelectedMsgId] = useState<string | number | null>(null);
  const [selectedMsgIds, setSelectedMsgIds] = useState<Set<string | number>>(new Set());

  const toggleSelectMsg = useCallback((id: string | number | null) => {
    if (id === null) {
      setSelectedMsgIds(new Set());
      setSelectedMsgId(null);
      return;
    }
    setSelectedMsgIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      if (next.size === 1) {
        setSelectedMsgId(Array.from(next)[0]);
      } else {
        setSelectedMsgId(null);
      }
      return next;
    });
  }, []);
  const [messageInfoMsg, setMessageInfoMsg] = useState<Message | null>(null);
  const {
    searchQuery, setSearchQuery,
    wsStatus, setWsStatus,
    showProfile, setShowProfile,
    showMyProfileSettings, setShowMyProfileSettings,
    showMuteMenu, setShowMuteMenu,
    showRingtonePicker, setShowRingtonePicker,
  } = useUiStore();


  const [showEmojiPanel, setShowEmojiPanel] = useState(false);
  const [emojiPanelTab, setEmojiPanelTab] = useState<"emojis" | "stickers">("emojis");

  const showEmojis = showEmojiPanel && emojiPanelTab === "emojis";
  const showStickers = showEmojiPanel && emojiPanelTab === "stickers";

  const setShowEmojis = (val: boolean | ((prev: boolean) => boolean)) => {
    if (typeof val === "function") {
      setShowEmojiPanel(prev => { const next = val(prev && emojiPanelTab === "emojis"); if (next) setEmojiPanelTab("emojis"); return next; });
    } else { setShowEmojiPanel(val); if (val) setEmojiPanelTab("emojis"); }
  };
  const setShowStickers = (val: boolean | ((prev: boolean) => boolean)) => {
    if (typeof val === "function") {
      setShowEmojiPanel(prev => { const next = val(prev && emojiPanelTab === "stickers"); if (next) setEmojiPanelTab("stickers"); return next; });
    } else { setShowEmojiPanel(val); if (val) setEmojiPanelTab("stickers"); }
  };

  // Strictly using /ringtone.mp3 and /notification.mp3
  const [saveToGalleryPref, setSaveToGalleryPref] = useState(true);
  useEffect(() => {
    try {
      const saved = localStorage.getItem("flux_save_to_gallery");
      if (saved !== null) {
        setSaveToGalleryPref(saved === "true");
      }
    } catch { }
  }, []);

  const toggleSaveToGalleryPref = (val: boolean) => {
    setSaveToGalleryPref(val);
    try {
      localStorage.setItem("flux_save_to_gallery", String(val));
    } catch { }
    showToast(val ? "Media will save directly to device Gallery" : "Media will save to Downloads", "info");
  };

  // ── MORE STATE ────────────────────────────────────────────────────────────────
  const {
    showCallLogUI, setShowCallLogUI,
    showNewGroup, setShowNewGroup,
    showNewContact, setShowNewContact,
    showGroupProfile, setShowGroupProfile,
    showContactProfile, setShowContactProfile,
    openedProfileFromSidebar, setOpenedProfileFromSidebar,
    sidebarDeleteId, setSidebarDeleteId,
    showCameraDrawer, setShowCameraDrawer,
    showPlusDrawer, setShowPlusDrawer,
  } = useUiStore();

  const {
    isLoadingHistory, setIsLoadingHistory,
    pinnedMessages, setPinnedMessages,
    highlightedMsgId, setHighlightedMsgId,
    isScrollAnchored, setIsScrollAnchored,
    inputMsg, setInputMsg,
  } = useChatStore();

  const [showLiveCamera, setShowLiveCamera] = useState(false);
  const [showLegalModal, setShowLegalModal] = useState(false);
  const [legalModalTab, setLegalModalTab] = useState<LegalTab>("privacy");
  const [showContactsModal, setShowContactsModal] = useState(false);
  const [showRequestsModal, setShowRequestsModal] = useState(false);
  const [showAddContactModal, setShowAddContactModal] = useState(false);
  const [showMutualsModal, setShowMutualsModal] = useState<{ email: string; name: string } | null>(null);
  const [showQRModal, setShowQRModal] = useState(false);
  const [addContactPrefill, setAddContactPrefill] = useState<string | null>(null);
  const [newContactUsername, setNewContactUsername] = useState("");
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupDesc, setNewGroupDesc] = useState("");
  const [newGroupMemberChips, setNewGroupMemberChips] = useState<string[]>([]);
  const [newGroupMemberInput, setNewGroupMemberInput] = useState("");
  const [editDisplayName, setEditDisplayName] = useState("");
  const [editUsername, setEditUsername] = useState("");
  const [editAbout, setEditAbout] = useState("");
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [isUploadingGroupAvatar, setIsUploadingGroupAvatar] = useState(false);
  const groupAvatarInputRef = useRef<HTMLInputElement | null>(null);
  const cameraPhotoInputRef = useRef<HTMLInputElement | null>(null);
  const cameraVideoInputRef = useRef<HTMLInputElement | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [callLogTab, setCallLogTab] = useState<"all" | "missed">("all");
  const [lastSeenMissedTs, setLastSeenMissedTs] = useState<number>(() => {
    if (typeof window === "undefined") return 0;
    try {
      const stored = localStorage.getItem("pulse_last_seen_missed_ts");
      return stored ? Number(stored) : Date.now();
    } catch {
      return Date.now();
    }
  });

  const markMissedCallsAsSeen = useCallback(() => {
    const now = Date.now();
    setLastSeenMissedTs(now);
    try {
      localStorage.setItem("pulse_last_seen_missed_ts", String(now));
    } catch {}
  }, []);

  const isScrollAnchoredRef = useRef(true);
  useEffect(() => {
    isScrollAnchoredRef.current = isScrollAnchored;
  }, [isScrollAnchored]);

  // ── AUTO-REQUEST STARTUP PERMISSIONS & CLEAR DELIVERED NOTIFICATIONS ─────────────
  useEffect(() => {
    requestAllAppPermissions();
    clearAllDeliveredNotifications();
  }, []);

  // ── OTA UPDATE CHECK ON STARTUP ─────────────────────────────────
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);

  useEffect(() => {
    checkLatestUpdate().then(info => {
      if (info.hasUpdate) {
        setUpdateInfo(info);
      }
    });
  }, []);

  const handleManualUpdateCheck = async () => {
    setIsCheckingUpdate(true);
    try {
      const info = await checkLatestUpdate();
      setUpdateInfo(info);
      if (info.hasUpdate) {
        showToast(`New update available: v${info.version}!`, "info");
      } else {
        showToast(`Flux is up to date (v${CURRENT_APP_VERSION})`, "success");
      }
    } catch {
      showToast("Failed to check for updates", "error");
    } finally {
      setIsCheckingUpdate(false);
    }
  };
  const wsConnTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cancelRecordingRef = useRef(false);
  const [pendingFile, setPendingFile] = useState<{ file: File; url: string; type: "image" | "audio" | "video" | "pdf" | "file" } | null>(null);
  const [pendingFiles, setPendingFiles] = useState<{ file: File; url: string; type: "image" | "audio" | "video" | "pdf" | "file"; caption?: string }[]>([]);
  const [multiUploadProgress, setMultiUploadProgress] = useState<{ current: number; total: number } | null>(null);
  const [isNarrowScreen, setIsNarrowScreen] = useState(false);
  const [sidebarFilter, setSidebarFilter] = useState<"all" | "direct" | "groups" | "unread">("all");

  // ── STATUS STATE (24-Hour Stories) ──────────────────────────────────────────
  const [showStatusUI, setShowStatusUI] = useState(false);
  const [statusGroups, setStatusGroups] = useState<UserStatusGroup[]>([]);
  const [loadingStatuses, setLoadingStatuses] = useState(false);
  const [activeViewingStatusGroup, setActiveViewingStatusGroup] = useState<UserStatusGroup | null>(null);
  const [showStatusCreator, setShowStatusCreator] = useState<"text" | "media" | null>(null);

  const hasUnviewedStatuses = useMemo(() => {
    return statusGroups.some(g => g.user_email.toLowerCase() !== currentUser.toLowerCase() && g.has_unviewed);
  }, [statusGroups, currentUser]);

  const loadStatuses = useCallback(async () => {
    if (!tokenRef.current) return;
    setLoadingStatuses(true);
    try {
      const data = await fetchStatuses(tokenRef.current);
      setStatusGroups(data);
      prefetchStatusMedia(data);
    } catch (e) {
      console.warn("[Status] Failed to load statuses:", e);
    } finally {
      setLoadingStatuses(false);
    }
  }, []);

  const handleSendStatusReply = useCallback((targetEmail: string, replyText: string, status: StatusItem) => {
    const quote = status.content_text ? `"${status.content_text}"` : (status.media_url ? "[Media Status]" : "Status");
    const fullContent = `Replied to your status (${quote}): ${replyText}`;
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: "direct_message",
        target_user: targetEmail,
        content: fullContent,
        message_type: "text",
      }));
    }
    showToast(`Reply sent to ${targetEmail}`, "success");
  }, [showToast]);

  const [forwardSelectedTargets, setForwardSelectedTargets] = useState<{ type: "user" | "group"; id: string | number; name: string }[]>([]);
  const [isUploadingAttachment, setIsUploadingAttachment] = useState(false);
  const [mediaZoom, setMediaZoom] = useState(1);
  const [mediaPan, setMediaPan] = useState({ x: 0, y: 0 });
  const [isPinching, setIsPinching] = useState(false);
  const initialDistRef = useRef(0);
  const initialZoomRef = useRef(1);
  const initialPanRef = useRef({ x: 0, y: 0 });

  // ── CALL STATE ────────────────────────────────────────────────────────────────
  // ── CALL STATE ────────────────────────────────────────────────────────────────
  const {
    callState, setCallState,
    isVideoCall, setIsVideoCall,
    callPeer, setCallPeer,
    callPeerName, setCallPeerName,
    callLogs, setCallLogs,
    isMuted, setIsMuted,
    isSpeaker, setIsSpeaker,
    facingMode, setFacingMode,
    isCameraOff, setIsCameraOff,
    remoteVideoMuted, setRemoteVideoMuted,
    remoteStreams, setRemoteStreams,
    cameraStates, setCameraStates,
    pipPos, setPipPos,
    isVideoSwapped, setIsVideoSwapped,
  } = useCallStore();

  const { viewFile, setViewFile, showHeaderNicknameEdit, setShowHeaderNicknameEdit } = useUiStore();
  const [headerNicknameValue, setHeaderNicknameValue] = useState("");

  useEffect(() => {
    idbGet<CallLogEntry[]>("cached_call_logs").then(logs => {
      if (logs) setCallLogs(logs);
    }).catch(() => {});
  }, [setCallLogs]);
  const pipDragging = useRef(false);
  const pipDragStart = useRef({ mx: 0, my: 0, x: 0, y: 0 });

  useEffect(() => {
    const checkWidth = () => {
      setIsNarrowScreen(window.innerWidth <= 380);
    };
    checkWidth();
    window.addEventListener("resize", checkWidth);
    return () => window.removeEventListener("resize", checkWidth);
  }, []);

  // ── ANDROID CAPACITOR SYSTEM BARS, APP STATE & HARDWARE BACK BUTTON ────────
  const lastBackPressTimeRef = useRef(0);
  const showLiveCameraRef = useRef(false);
  const showLegalModalRef = useRef(false);
  const showContactsModalRef = useRef(false);
  const showRequestsModalRef = useRef(false);
  const showAddContactModalRef = useRef(false);
  const showMutualsModalRef = useRef<{ email: string; name: string } | null>(null);
  const showQRModalRef = useRef(false);
  const showStatusUIRef = useRef(false);
  const activeViewingStatusGroupRef = useRef<UserStatusGroup | null>(null);
  const showStatusCreatorRef = useRef<"text" | "media" | null>(null);

  useEffect(() => { showLiveCameraRef.current = showLiveCamera; }, [showLiveCamera]);
  useEffect(() => { showLegalModalRef.current = showLegalModal; }, [showLegalModal]);
  useEffect(() => { showContactsModalRef.current = showContactsModal; }, [showContactsModal]);
  useEffect(() => { showRequestsModalRef.current = showRequestsModal; }, [showRequestsModal]);
  useEffect(() => { showAddContactModalRef.current = showAddContactModal; }, [showAddContactModal]);
  useEffect(() => { showMutualsModalRef.current = showMutualsModal; }, [showMutualsModal]);
  useEffect(() => { showQRModalRef.current = showQRModal; }, [showQRModal]);
  useEffect(() => { showStatusUIRef.current = showStatusUI; }, [showStatusUI]);
  useEffect(() => { activeViewingStatusGroupRef.current = activeViewingStatusGroup; }, [activeViewingStatusGroup]);
  useEffect(() => { showStatusCreatorRef.current = showStatusCreator; }, [showStatusCreator]);

  useEffect(() => {
    if (!isNative()) return;

    // 1. Android Immersive Obsidian Status Bar & Theme Styling
    try {
      StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
      StatusBar.setBackgroundColor({ color: "#050606" }).catch(() => {});
      StatusBar.setOverlaysWebView({ overlay: true }).catch(() => {});
      if ((window as any).FluxNativeBridge?.getStatusBarHeight) {
        const h = (window as any).FluxNativeBridge.getStatusBarHeight();
        if (h && typeof h === "number" && h > 0) {
          document.documentElement.style.setProperty("--native-status-bar-height", `${h}px`);
        }
      }
    } catch {}

    // 2. Clear delivered notifications when resuming foreground
    const statePromise = CapApp.addListener("appStateChange", (state) => {
      if (state.isActive) {
        clearAllDeliveredNotifications();
      }
    });

    // 3. Native Hardware Back Button & Edge-Swipe Navigation Handler
    const backPromise = CapApp.addListener("backButton", () => {
      // 3a. Fullscreen media viewer
      const ui = useUiStore.getState();
      if (ui.viewFile) {
        ui.setViewFile(null);
        return;
      }

      // 3b. 24-Hour Stories / Status Viewer or Creator
      if (activeViewingStatusGroupRef.current) {
        setActiveViewingStatusGroup(null);
        return;
      }
      if (showStatusCreatorRef.current) {
        setShowStatusCreator(null);
        return;
      }
      if (showStatusUIRef.current) {
        setShowStatusUI(false);
        return;
      }

      // 3c. Reaction pickers, Emoji panels & Drawers
      if (ui.reactionPickerId) {
        ui.setReactionPickerId(null);
        return;
      }
      if (ui.showEmojiPanel) {
        ui.setShowEmojiPanel(false);
        return;
      }
      if (ui.showCameraDrawer) {
        ui.setShowCameraDrawer(false);
        return;
      }
      if (ui.showPlusDrawer) {
        ui.setShowPlusDrawer(false);
        return;
      }
      if (showLiveCameraRef.current) {
        setShowLiveCamera(false);
        return;
      }
      if (ui.confirmDialog) {
        ui.hideConfirm();
        return;
      }

      // 3d. User Profile & Contact Info Sheets
      if (ui.showContactProfile) {
        ui.setShowContactProfile(false);
        return;
      }
      if (ui.showGroupProfile) {
        ui.setShowGroupProfile(false);
        return;
      }
      if (ui.showCallLogUI) {
        ui.setShowCallLogUI(false);
        return;
      }
      if (ui.showNewGroup) {
        ui.setShowNewGroup(false);
        return;
      }
      if (ui.showNewContact) {
        ui.setShowNewContact(false);
        return;
      }
      if (ui.showMyProfileSettings) {
        ui.setShowMyProfileSettings(false);
        return;
      }
      if (ui.showProfile) {
        ui.setShowProfile(false);
        return;
      }
      if (showContactsModalRef.current) {
        setShowContactsModal(false);
        return;
      }
      if (showRequestsModalRef.current) {
        setShowRequestsModal(false);
        return;
      }
      if (showAddContactModalRef.current) {
        setShowAddContactModal(false);
        return;
      }
      if (showMutualsModalRef.current) {
        setShowMutualsModal(null);
        return;
      }
      if (showQRModalRef.current) {
        setShowQRModal(false);
        return;
      }
      if (showLegalModalRef.current) {
        setShowLegalModal(false);
        return;
      }
      if (ui.showRingtonePicker) {
        ui.setShowRingtonePicker(false);
        return;
      }
      if (ui.showMuteMenu) {
        ui.setShowMuteMenu(false);
        return;
      }

      // 3e. Conversation Navigation (Exit active chat room back to chats list)
      const chat = useChatStore.getState();
      if (chat.activeChat) {
        chat.setActiveChat(null);
        return;
      }

      // 3f. Root Screen Double-Back Exit Protection
      const now = Date.now();
      if (now - lastBackPressTimeRef.current < 2000) {
        CapApp.minimizeApp();
      } else {
        lastBackPressTimeRef.current = now;
        ui.showToast("Press back again to exit", "info");
      }
    });

    return () => {
      statePromise.then((h) => h.remove()).catch(() => {});
      backPromise.then((h) => h.remove()).catch(() => {});
    };
  }, []);

  // ── AUDIO REFS ────────────────────────────────────────────────────────────────
  const notificationSoundRef = useRef<HTMLAudioElement | null>(null);
  const ringtoneRef = useRef<HTMLAudioElement | null>(null);
  const ringtonePlayPromise = useRef<Promise<void> | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const ringtoneRetryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ringtoneActiveRef = useRef(false);

  // ── AUDIO INIT (Strictly ringtone.mp3 and notification.mp3) ─────────────────
  useEffect(() => {
    notificationSoundRef.current = Object.assign(new Audio("/notification.mp3"), { volume: 0.7, preload: "auto" });
    notificationSoundRef.current.load();
    ringtoneRef.current = Object.assign(new Audio("/ringtone.mp3"), { loop: true, volume: 1.0, preload: "auto" });
    ringtoneRef.current.load();
    remoteAudioRef.current = Object.assign(new Audio(), { autoplay: true, volume: 1.0 });
  }, []);

  useEffect(() => {
    const unlock = () => {
      [notificationSoundRef.current, ringtoneRef.current].forEach(audio => {
        if (!audio) return;
        const originalVolume = audio.volume;
        audio.volume = 0;
        audio.play().then(() => {
          audio.pause();
          audio.currentTime = 0;
          audio.volume = originalVolume;
        }).catch(() => {
          audio.volume = originalVolume;
        });
      });
    };
    const events = ["touchstart", "touchend", "mousedown", "keydown", "click"];
    events.forEach(e => document.addEventListener(e, unlock, { once: true, passive: true }));
    return () => events.forEach(e => document.removeEventListener(e, unlock));
  }, []);

  const playNotificationSound = useCallback(() => {
    const audio = notificationSoundRef.current;
    if (!audio) return;
    audio.currentTime = 0;
    audio.play().catch(() => { });
  }, []);

  const startRingtone = useCallback(() => {
    if (ringtoneRetryRef.current) { clearTimeout(ringtoneRetryRef.current); ringtoneRetryRef.current = null; }
    ringtoneActiveRef.current = true;
    const audio = ringtoneRef.current;
    if (!audio) return;
    audio.currentTime = 0;
    const attempt = (retriesLeft: number) => {
      if (!ringtoneActiveRef.current) return;
      const p = audio.play();
      ringtonePlayPromise.current = p;
      p.catch(() => { if (ringtoneActiveRef.current && retriesLeft > 0) ringtoneRetryRef.current = setTimeout(() => attempt(retriesLeft - 1), 600); });
    };
    attempt(3);
  }, []);

  const stopRingtone = useCallback(() => {
    ringtoneActiveRef.current = false;
    if (ringtoneRetryRef.current) { clearTimeout(ringtoneRetryRef.current); ringtoneRetryRef.current = null; }
    cancelCallNotification();
    if (typeof window !== "undefined") {
      try {
        (window as any).FluxNativeBridge?.stopRingtone?.();
        if (navigator.vibrate) navigator.vibrate(0);
      } catch {}
    }
    const audio = ringtoneRef.current;
    if (!audio) return;
    const pending = ringtonePlayPromise.current;
    ringtonePlayPromise.current = null;
    const doStop = () => { try { audio.pause(); audio.currentTime = 0; } catch { } };
    if (pending) pending.then(doStop).catch(doStop);
    else doStop();
  }, []);

  // ── PERSIST STATE ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!currentUser) return;
    const loadPersisted = async () => {
      try {
        const keys = [
          `nicknames_${currentUser}`,
          `last_activity_${currentUser}`,
          `last_preview_${currentUser}`,
          "cached_contacts",
          "cached_groups",
          "cached_unread"
        ];
        const res = await idbGetMany(keys);
        
        const savedNicknames = res.get(`nicknames_${currentUser}`);
        setNicknames(savedNicknames || {});

        const savedActivity = res.get(`last_activity_${currentUser}`);
        if (savedActivity) {
          const standardized: Record<string, number> = {};
          Object.entries(savedActivity).forEach(([k, v]) => {
            standardized[k.includes("@") ? k.toLowerCase() : k] = Number(v);
          });
          setLastActivity(standardized);
        } else {
          setLastActivity({});
        }

        const savedPreview = res.get(`last_preview_${currentUser}`);
        if (savedPreview) {
          const standardized: Record<string, string> = {};
          Object.entries(savedPreview).forEach(([k, v]) => {
            standardized[k.includes("@") ? k.toLowerCase() : k] = String(v);
          });
          setLastPreview(standardized);
        } else {
          setLastPreview({});
        }

        const savedContacts = res.get("cached_contacts");
        if (savedContacts) setContacts(savedContacts);

        const savedGroups = res.get("cached_groups");
        if (savedGroups) setGroups(savedGroups);

        const savedUnread = res.get("cached_unread");
        if (savedUnread) setUnread(savedUnread);

        // Preload recent messages for all conversations into RAM cache (<15ms)
        const allChatIds = [
          ...(savedContacts || []).map((c: any) => String(c.email).toLowerCase()),
          ...(savedGroups || []).map((g: any) => String(g.id))
        ];
        Promise.all(
          allChatIds.map(async (cid) => {
            try {
              const msgs = await dbGetMessages(cid, 50);
              if (msgs && msgs.length > 0 && (!messagesCacheRef.current[cid] || messagesCacheRef.current[cid].length === 0)) {
                messagesCacheRef.current[cid] = msgs;
              }
            } catch {}
          })
        ).catch(() => {});
      } catch (err) {
        console.error("Failed to load persisted states from IndexedDB:", err);
      } finally {
        hasLoadedCacheRef.current = true;
      }
    };
    loadPersisted();
  }, [currentUser]);

  // ── WEB FOREGROUND FCM AND TOKEN REFRESH ──────────────────────────────────────
  useEffect(() => {
    if (!currentUser) return;
    const unsub = setupForegroundFCM(
      (payload) => {
        const title = payload.notification?.title;
        const body = payload.notification?.body;
        if (!title && !body) return; // Silent notification, do not show

        const data = payload.data;
        const chatId = data?.chatId;
        if (chatId && String(chatId) !== String(activeChatRef.current?.id)) {
          showLocalNotification(title || "New Message", body || "", String(chatId));
        }
      },
      (newToken) => {
        const savedToken = tokenRef.current;
        if (savedToken) {
          fetch(`${API}/profile/fcm-token`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${savedToken}` },
            body: JSON.stringify({ fcm_token: newToken }),
          }).catch(err => console.warn("Failed to sync refreshed FCM token:", err));
        }
      }
    );
    return () => {
      if (unsub) unsub();
    };
  }, [currentUser]);

  // ── NATIVE CAPACITOR NOTIFICATIONS & CALL ACTIONS ──────────────────────────
  useEffect(() => {
    if (token) {
      requestNotifyPermission().then(nativeToken => {
        if (nativeToken) {
          fetch(`${API}/profile/fcm-token`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({ fcm_token: nativeToken }),
          }).catch(err => console.warn("Failed to sync FCM token on login:", err));
        }
      });
    }

    initNotifications({
      onTokenReceived: (pToken) => {
        const savedToken = tokenRef.current || token;
        if (savedToken && pToken) {
          fetch(`${API}/profile/fcm-token`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${savedToken}` },
            body: JSON.stringify({ fcm_token: pToken }),
          }).catch(err => console.warn("Failed to sync native FCM token:", err));
        }
      },
      onCallAccepted: (_data) => {
        if (_data) {
          try {
            localStorage.setItem("flux_pending_call_offer", JSON.stringify({ ..._data, action: "accept", ts: Date.now() }));
          } catch {}
        }
        if (restoreCallOfferRef.current) {
          restoreCallOfferRef.current("accept");
        } else if (acceptCallRef.current) {
          acceptCallRef.current();
        }
      },
      onCallRejected: (_data) => {
        if (rejectCallRef.current) {
          rejectCallRef.current();
        }
      },
      onChatOpened: (chatId) => {
        if (chatId) {
          const c = contactsRef.current?.find(item => item.email === chatId);
          if (c) {
            const peerName = nicknames[c.email] || c.display_name || (c.username ? `@${c.username}` : null) || c.email;
            setActiveChat({ type: "user", id: c.email, name: peerName });
          } else {
            const g = groupsRef.current?.find(item => String(item.id) === chatId);
            if (g) {
              setActiveChat({ type: "group", id: g.id, name: g.name });
            }
          }
        }
      },
    });
  }, [callState, nicknames, setActiveChat]);

  // ── REFS ──────────────────────────────────────────────────────────────────────
  const msgListRef = useRef<HTMLDivElement | null>(null);
  const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const wsRetryDelay = useRef(800);
  const wsRetryCount = useRef(0);
  const wsPingInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastPongRef = useRef(Date.now());
  const pendingMessages = useRef<string[]>([]);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const pcMapRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const pendingRemoteDescriptionRef = useRef<RTCSessionDescriptionInit | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const messagesCacheRef = useRef<Record<string, Message[]>>({});
  const rowVirtualizerRef = useRef<any>(null);
  const groupedMessagesRef = useRef<any[]>([]);
  const iceCandidateQueueRef = useRef<RTCIceCandidateInit[]>([]);
  const iceQueuesRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const pendingMeshOffersRef = useRef<Map<string, RTCSessionDescriptionInit>>(new Map());
  const callStateRef = useRef<CallState>("idle");
  const callStartTimeRef = useRef<number | null>(null);
  const callDirectionRef = useRef<"incoming" | "outgoing" | null>(null);
  const acceptInProgressRef = useRef(false);
  const activeChatRef = useRef<Chat | null>(activeChat);
  const contactsRef = useRef(contacts);
  const groupsRef = useRef(groups);
  const callGroupIdRef = useRef<string | number | null>(null);
  const callPeerRef = useRef<string | null>(null);
  const callPeerNameRef = useRef<string>("");
  const endCallRef = useRef<(sendSignal?: boolean, explicitStatus?: "completed" | "missed" | "rejected") => void>(() => { });
  const isVideoCallRef = useRef(false);
  const isAppActiveRef = useRef(true);

  // Sync state Refs for backButton and haptic feedback orchestration
  const viewFileRef = useRef<any>(null);
  const showEmojiPanelRef = useRef(false);
  const reactionPickerIdRef = useRef<string | number | null>(null);
  const showContactProfileRef = useRef(false);
  const showGroupProfileRef = useRef(false);
  const showCallLogUIRef = useRef(false);
  const showProfileRef = useRef(false);
  const showMyProfileSettingsRef = useRef(false);
  const openedProfileFromSidebarRef = useRef(false);
  const confirmDialogRef = useRef<any>(null);
  const showCameraDrawerRef = useRef(false);
  const showPlusDrawerRef = useRef(false);
  const showRingtonePickerRef = useRef(false);
  const showNewGroupRef = useRef(false);
  const showNewContactRef = useRef(false);
  const pendingFilesRef = useRef<any[]>([]);
  const pendingFileRef = useRef<any>(null);
  const seenMessageIds = useRef<Set<string>>(new Set<string>());
  const persistSeenTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetchingProfilesRef = useRef<Set<string>>(new Set());
  const openChatRef = useRef<(chat: Chat) => void>(() => { });
  const openChatByChatIdRef = useRef<(chatId: string) => void>(() => { });
  const readChatsRef = useRef<Set<string>>(new Set<string>());
  const initWSRef = useRef<(() => void) | null>(null);
  const acceptCallRef = useRef<() => void>(() => { });
  const rejectCallRef = useRef<() => void>(() => { });
  const wsHandlerRef = useRef<(raw: string) => void>(() => { });

  const apiFetchRef = useRef<<T = any>(path: string, opts?: any) => Promise<T>>(async () => ({}) as any);
  const decryptContentRef = useRef<any>(null);
  const updateCallStateRef = useRef<any>(null);
  const scrollBottomRef = useRef<any>(null);
  const updateActivityRef = useRef<any>(null);
  const notifyRef = useRef<any>(null);
  const notifyCallRef = useRef<any>(null);
  const startRingtoneRef = useRef<any>(null);
  const contactLabelFnRef = useRef<any>(null);
  const persistSeenIdsRef = useRef<any>(null);
  const sendReadReceiptRef = useRef<any>(null);
  const removePeerFromCallRef = useRef<any>(null);
  const loadContactsRef = useRef<any>(null);
  const loadGroupsRef = useRef<any>(null);
  const setupWebRTCRef = useRef<any>(null);
  const wsSendRef = useRef<any>(null);
  const loadHistoryRef = useRef<any>(null);

  // Synchronously initialize refs from storage on first render to prevent timing gaps
  if (typeof window !== "undefined" && seenMessageIds.current.size === 0) {
    try {
      const ss = sessionStorage.getItem("Flux_seen_ids");
      if (ss) {
        seenMessageIds.current = new Set<string>(JSON.parse(ss));
      }
    } catch { }
  }

  if (typeof window !== "undefined" && readChatsRef.current.size === 0) {
    try {
      const saved = localStorage.getItem("Flux_read_chats");
      if (saved) readChatsRef.current = new Set<string>(JSON.parse(saved));
    } catch { }
  }

  useEffect(() => { activeChatRef.current = activeChat; }, [activeChat]);
  useEffect(() => { contactsRef.current = contacts; }, [contacts]);
  useEffect(() => { groupsRef.current = groups; }, [groups]);
  useEffect(() => { callPeerRef.current = callPeer; }, [callPeer]);
  useEffect(() => { callPeerNameRef.current = callPeerName; }, [callPeerName]);
  useEffect(() => { isVideoCallRef.current = isVideoCall; }, [isVideoCall]);

  useEffect(() => { viewFileRef.current = viewFile; }, [viewFile]);
  useEffect(() => { showEmojiPanelRef.current = showEmojiPanel; }, [showEmojiPanel]);
  useEffect(() => { reactionPickerIdRef.current = reactionPickerId; }, [reactionPickerId]);
  useEffect(() => { showContactProfileRef.current = showContactProfile; }, [showContactProfile]);
  useEffect(() => { showGroupProfileRef.current = showGroupProfile; }, [showGroupProfile]);
  useEffect(() => { showCallLogUIRef.current = showCallLogUI; }, [showCallLogUI]);
  useEffect(() => { showProfileRef.current = showProfile; }, [showProfile]);
  useEffect(() => { showMyProfileSettingsRef.current = showMyProfileSettings; }, [showMyProfileSettings]);
  useEffect(() => { openedProfileFromSidebarRef.current = openedProfileFromSidebar; }, [openedProfileFromSidebar]);
  useEffect(() => { confirmDialogRef.current = confirmDialog; }, [confirmDialog]);
  useEffect(() => { showCameraDrawerRef.current = showCameraDrawer; }, [showCameraDrawer]);
  useEffect(() => { showPlusDrawerRef.current = showPlusDrawer; }, [showPlusDrawer]);
  useEffect(() => { showRingtonePickerRef.current = showRingtonePicker; }, [showRingtonePicker]);
  useEffect(() => { showNewGroupRef.current = showNewGroup; }, [showNewGroup]);
  useEffect(() => { showNewContactRef.current = showNewContact; }, [showNewContact]);
  useEffect(() => { pendingFilesRef.current = pendingFiles; }, [pendingFiles]);
  useEffect(() => { pendingFileRef.current = pendingFile; }, [pendingFile]);

  const addToReadChats = (chatId: string) => {
    readChatsRef.current.add(chatId);
    try { localStorage.setItem("Flux_read_chats", JSON.stringify([...readChatsRef.current])); } catch { }
  };

  const updateCallState = useCallback((newState: CallState) => {
    setCallState(newState);
    callStateRef.current = newState;
    if (newState === "calling") {
      try { ringbackToneRef.current?.start(); } catch (e) { console.error(e); }
    } else {
      try { ringbackToneRef.current?.stop(); } catch (e) { console.error(e); }
    }
    if (newState === "idle" || newState === "connected") {
      try { stopRingtone(); } catch (e) { console.error(e); }
    }
  }, [stopRingtone]);

  const persistSeenIds = useCallback(() => {
    if (persistSeenTimer.current) clearTimeout(persistSeenTimer.current);
    persistSeenTimer.current = setTimeout(() => {
      try {
        if (seenMessageIds.current.size > 2000) seenMessageIds.current = new Set([...seenMessageIds.current].slice(-1000));
        const arr = [...seenMessageIds.current].slice(-1000);
        sessionStorage.setItem("Flux_seen_ids", JSON.stringify(arr));
      } catch { }
    }, 500);
  }, []);

  const updateActivity = useCallback((chatId: string | number, content: string, customTs?: number | string, skipActivityUpdate?: boolean) => {
    const id = String(chatId).includes("@") ? String(chatId).toLowerCase() : String(chatId);
    if (!skipActivityUpdate) {
      let tsVal = Date.now();
      if (customTs) try { tsVal = typeof customTs === "number" ? customTs : parseTs(customTs as string).getTime(); } catch { }
      if (isNaN(tsVal)) tsVal = Date.now();
      setLastActivity(prev => {
        if (prev[id] && prev[id] > tsVal) return prev;
        const next = { ...prev, [id]: tsVal };
        if (currentUserRef.current) idbSet(`last_activity_${currentUserRef.current}`, next).catch(() => {});
        return next;
      });
    }
    if (content && !content.startsWith("[")) {
      setLastPreview(prev => {
        const next = { ...prev, [id]: content };
        if (currentUserRef.current) idbSet(`last_preview_${currentUserRef.current}`, next).catch(() => {});
        return next;
      });
    }
  }, []);

  const getPeerPubKey = useCallback(async (peerEmailRaw: string): Promise<string | null> => {
    const peerEmail = peerEmailRaw.toLowerCase();
    if (pubKeyCache.current.has(peerEmail)) return pubKeyCache.current.get(peerEmail)!;
    try {
      const data = await apiFetch<{ public_key: string }>(`/profile/public-key/${encodeURIComponent(peerEmail)}`);
      pubKeyCache.current.set(peerEmail, data.public_key);
      return data.public_key;
    } catch { return null; }
  }, [apiFetch]);

  const getGroupKey = useCallback(async (groupId: string | number): Promise<CryptoKey | null> => {
    const gid = String(groupId);
    if (groupKeyCache.has(gid)) return groupKeyCache.get(gid)!;
    const privKey = e2ePrivKeyRef.current;
    if (!privKey) return null;
    try {
      const data = await apiFetch<{ key_id: string; encrypted_key: string; setter_pub_key: string }>(`/groups/${gid}/e2e-key`);
      const groupKey = await unwrapGroupKey(data.encrypted_key, privKey, data.setter_pub_key);
      groupKeyCache.set(gid, groupKey);
      return groupKey;
    } catch { return null; }
  }, [apiFetch]);

  const decryptContent = useCallback(async (content: string, chatType: "user" | "group", peerEmail: string, groupId?: string | number): Promise<string> => {
    const privKey = e2ePrivKeyRef.current;
    if (!privKey) return content;
    try {
      if (isDMEncrypted(content)) {
        const theirPub = await getPeerPubKey(peerEmail);
        if (!theirPub) return "[Encrypted — peer key unavailable]";
        return await decryptDM(content, privKey, theirPub);
      }
      if (isGroupEncrypted(content) && groupId) {
        const groupKey = await getGroupKey(groupId);
        if (!groupKey) return "[Encrypted — group key unavailable]";
        return await decryptGroupMsg(content, groupKey);
      }
    } catch { return "[Encrypted message — decryption failed]"; }
    return content;
  }, [getPeerPubKey, getGroupKey]);

  // ── LOAD DATA ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!token) return;
    apiFetch<{ chat_id: string; chat_type: string; muted_until: string | null }[]>("/mutes").then(rows => {
      const map: Record<string, number | null> = {};
      rows.forEach(r => { map[r.chat_id] = r.muted_until ? new Date(r.muted_until).getTime() : null; });
      setMutedChats(map);
    }).catch(() => { });
  }, [token]); // eslint-disable-line

  useEffect(() => {
    if (!token) return;
    apiFetch<CallLogEntry[]>("/call-logs").then(apiLogs => {
      setCallLogs(prev => {
        const apiIdSet = new Set(apiLogs.map(l => l.id));
        const merged = [...apiLogs, ...prev.filter(l => !apiIdSet.has(l.id))];
        merged.sort((a, b) => parseTs(b.timestamp).getTime() - parseTs(a.timestamp).getTime());
        const final = merged.slice(0, 200);
        try { idbSet("cached_call_logs", final).catch(() => {}); } catch { }
        return final;
      });
    }).catch(() => { });
  }, [token]); // eslint-disable-line

  const loadProfile = useCallback(async () => {
    if (!token) return;
    try {
      let data: any = null;
      try {
        data = await apiFetch<any>("/profile/me");
      } catch {
        if (currentUser) {
          data = await apiFetch<any>(`/profile/${encodeURIComponent(currentUser)}`).catch(() => null);
        }
      }
      if (data) {
        const localAvatar = typeof window !== "undefined" ? (localStorage.getItem(`user_avatar_${currentUser}`) || (data.username ? localStorage.getItem(`user_avatar_${data.username}`) : null)) : null;
        const derivedUsername = data.username || (data.email ? data.email.split("@")[0] : (currentUser ? currentUser.split("@")[0] : ""));
        const finalProfile = {
          displayName: data.display_name || "",
          avatarUrl: data.avatar_url || localAvatar || "",
          username: data.username || derivedUsername || "",
          about: data.about || ""
        };
        setProfile(finalProfile);
        setEditDisplayName(data.display_name || "");
        setEditUsername(data.username || derivedUsername || "");
        setEditAbout(data.about || "");
      }
    } catch (e) {
      console.warn("loadProfile error:", e);
    }
  }, [apiFetch, token, currentUser, setProfile]);

  const loadContacts = useCallback(async () => {
    try {
      const [contactList, inReqs, outReqs] = await Promise.all([
        apiFetch<Contact[]>("/contacts"),
        apiFetch<ContactRequest[]>("/contacts/requests/incoming").catch(() => []),
        apiFetch<ContactRequest[]>("/contacts/requests/outgoing").catch(() => []),
      ]);
      const normalized = contactList.map((c) => ({ ...c, email: c.email.toLowerCase() }));
      setContacts(normalized);
      useContactStore.getState().setContacts(normalized);
      setIncomingRequests(inReqs);
      setOutgoingRequests(outReqs);
    } catch { }
  }, [apiFetch, setIncomingRequests, setOutgoingRequests]);

  const contactLabelFn = useCallback((c: Contact) =>
    nicknames[c.email.toLowerCase()] || nicknames[c.email] || c.display_name || (c.username ? `@${c.username}` : null) || c.email?.split("@")[0] || "User",
    [nicknames]);
  const contactLabel = contactLabelFn;

  const getPeerName = useCallback((emailOrUser: string) => {
    if (!emailOrUser) return "You";
    const clean = String(emailOrUser).toLowerCase().trim();
    if (clean === (currentUser || "").toLowerCase().trim()) return "You";
    const c = contacts.find(c => c.email.toLowerCase() === clean);
    return c ? contactLabelFn(c) : (clean.includes("@") ? clean.split("@")[0] : emailOrUser);
  }, [contacts, contactLabelFn, currentUser]);

  const handleAcceptRequest = useCallback(async (req: ContactRequest) => {
    try {
      await acceptContactRequestApi(req.id, token);
      removeIncomingRequest(req.id);
      await loadContacts();
      showToast("Contact request accepted!", "success");
    } catch (err: any) {
      showToast(err.message || "Failed to accept request", "error");
    }
  }, [token, removeIncomingRequest, loadContacts, showToast]);

  const handleDeclineRequest = useCallback(async (req: ContactRequest) => {
    try {
      await declineContactRequestApi(req.id, token);
      removeIncomingRequest(req.id);
      showToast("Contact request declined", "info");
    } catch (err: any) {
      showToast(err.message || "Failed to decline request", "error");
    }
  }, [token, removeIncomingRequest, showToast]);

  const handleDeclineAndBlock = useCallback(async (req: ContactRequest) => {
    try {
      await declineAndBlockContactRequestApi(req.id, token);
      removeIncomingRequest(req.id);
      addBlockedUser(req.sender_email);
      showToast("Declined and blocked user", "info");
    } catch (err: any) {
      showToast(err.message || "Failed to block user", "error");
    }
  }, [token, removeIncomingRequest, addBlockedUser, showToast]);

  const handleCancelRequest = useCallback(async (req: ContactRequest) => {
    try {
      await cancelContactRequestApi(req.id, token);
      removeOutgoingRequest(req.id);
      showToast("Contact request cancelled", "info");
    } catch (err: any) {
      showToast(err.message || "Failed to cancel request", "error");
    }
  }, [token, removeOutgoingRequest, showToast]);

  const handleToggleFavorite = useCallback(async (contactEmail: string) => {
    try {
      const res = await toggleFavoriteContactApi(contactEmail, token);
      setContacts((prev) =>
        prev.map((c) =>
          c.email.toLowerCase() === contactEmail.toLowerCase()
            ? { ...c, is_favorite: res.is_favorite }
            : c
        )
      );
    } catch (err: any) {
      showToast(err.message || "Failed to toggle favorite", "error");
    }
  }, [token, showToast]);

  const handleRemoveContact = useCallback(async (contactEmail: string) => {
    const peerName = getPeerName(contactEmail);
    showConfirm(`Remove ${peerName} from your contacts?`, async () => {
      try {
        await removeContactApi(contactEmail, token);
        setContacts((prev) => prev.filter((c) => c.email.toLowerCase() !== contactEmail.toLowerCase()));
        removeContactFromStore(contactEmail);
        showToast("Contact removed", "info");
      } catch (err: any) {
        showToast(err.message || "Failed to remove contact", "error");
      }
    });
  }, [getPeerName, showConfirm, token, removeContactFromStore, showToast]);

  const loadGroups = useCallback(async () => {
    try {
      const gs = await apiFetch<Group[]>("/groups");
      setGroups(gs.map(g => {
        const saved = typeof window !== "undefined" ? localStorage.getItem(`group_avatar_${g.id}`) : null;
        return saved ? { ...g, avatar_url: saved } : g;
      }));
    } catch { }
  }, [apiFetch]);

  useEffect(() => {
    if (!token) return;
    loadProfile();
    loadContacts();
    loadGroups();
    loadStatuses();

    const handleFocus = () => {
      loadContacts();
      loadGroups();
      loadProfile();
      loadStatuses();
    };

    if (typeof window !== "undefined") {
      window.addEventListener("focus", handleFocus);
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") handleFocus();
      });
    }

    const interval = setInterval(() => {
      loadContacts();
    }, 25000);

    return () => {
      clearInterval(interval);
      if (typeof window !== "undefined") {
        window.removeEventListener("focus", handleFocus);
      }
    };
  }, [token, loadProfile, loadContacts, loadGroups, loadStatuses]);

  const scrollBottom = useCallback((force = false) => {
    if (!force && !isScrollAnchoredRef.current) return;
    const scroll = () => {
      if (msgListRef.current) msgListRef.current.scrollTop = msgListRef.current.scrollHeight;
      if (rowVirtualizerRef.current && groupedMessagesRef.current.length > 0) {
        try { rowVirtualizerRef.current.scrollToIndex(groupedMessagesRef.current.length - 1, { align: "end" }); } catch { }
      }
      setIsScrollAnchored(true);
    };
    scroll();
    setTimeout(scroll, 50);
  }, []);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    const threshold = 15; // 15px scroll tolerance
    const isAtBottom = target.scrollHeight - target.scrollTop - target.clientHeight <= threshold;
    setIsScrollAnchored(isAtBottom);
  }, []);

  const mergeMessageLists = (existing: Message[], incoming: Message[]): Message[] => {
    const map = new Map<string, Message>();
    for (const m of existing) {
      if (m && m.id) map.set(String(m.id), m);
    }
    for (const m of incoming) {
      if (m && m.id) {
        const existingMsg = map.get(String(m.id));
        if (existingMsg) {
          map.set(String(m.id), { ...existingMsg, ...m });
        } else {
          map.set(String(m.id), m);
        }
      }
    }
    const list = Array.from(map.values());

    // Deduplicate: If there's a confirmed (non-temp) message matching a temp message (same user, trimmed content, close timestamp)
    const nonTempMessages = list.filter(m => !String(m.id).startsWith("temp-"));
    const cleanedList: Message[] = [];

    for (const m of list) {
      const idStr = String(m.id);
      if (idStr.startsWith("temp-")) {
        const mTime = parseTs(m.timestamp).getTime();
        const mContent = (m.content || "").trim();
        const age = Date.now() - mTime;

        // If this temp message is older than 5 minutes, it's an abandoned stale message from a previous session
        if (age > 300000) {
          dbDeleteMessage(m.id).catch(() => {});
          continue;
        }

        // Check if there is already a confirmed message with same user and content within 90s
        const hasConfirmedMatch = nonTempMessages.some(rm => {
          if (String(rm.user).toLowerCase() !== String(m.user).toLowerCase()) return false;
          if ((rm.content || "").trim() !== mContent) return false;
          const rmTime = parseTs(rm.timestamp).getTime();
          return Math.abs(rmTime - mTime) < 90000;
        });

        if (hasConfirmedMatch) {
          // Clean up this temp message from IndexedDB so it never haunts the chat again
          dbDeleteMessage(m.id).catch(() => {});
          continue;
        }
      }
      cleanedList.push(m);
    }

    cleanedList.sort((a, b) => parseTs(a.timestamp).getTime() - parseTs(b.timestamp).getTime());
    return cleanedList;
  };

  const applyPersistedDeletions = useCallback((msgs: Message[]): Message[] => {
    const ids = deletedMsgIdsRef.current;
    if (ids.size === 0) return msgs;
    return msgs.map(m => ids.has(String(m.id)) ? { ...m, is_deleted: true } : m);
  }, []);
  const loadHistory = useCallback(async (chat: Chat, beforeId: string | number | null = null) => {
    if (!chat) return;
    setLoadingMore(true);
    const { type, id } = chat;
    const cacheKey = type === "user" ? String(id).toLowerCase() : String(id);

    if (!beforeId) {
      const hasCache = !!messagesCacheRef.current[cacheKey] && messagesCacheRef.current[cacheKey].length > 0;
      if (!hasCache) {
        try {
          const localMsgs = await dbGetMessages(cacheKey, 50);
          if (localMsgs && localMsgs.length > 0) {
            messagesCacheRef.current[cacheKey] = localMsgs;
            setMessages(localMsgs);
            setIsLoadingHistory(false);
            setTimeout(() => scrollBottom(true), 50);
          } else {
            setIsLoadingHistory(true);
          }
        } catch (err) {
          setIsLoadingHistory(true);
        }
      } else {
        setIsLoadingHistory(false);
      }
    } else {
      try {
        const localOlderMsgs = await dbGetMessages(cacheKey, 50, beforeId);
        if (localOlderMsgs && localOlderMsgs.length > 0) {
          const list = msgListRef.current;
          const prevScrollHeight = list ? list.scrollHeight : 0;
          const prevScrollTop = list ? list.scrollTop : 0;
          const currentList = messagesCacheRef.current[cacheKey] || [];
          const next = mergeMessageLists(localOlderMsgs, currentList);
          messagesCacheRef.current[cacheKey] = next;
          setMessages(next);
          setLoadingMore(false);
          requestAnimationFrame(() => requestAnimationFrame(() => { 
            if (list) list.scrollTop = prevScrollTop + (list.scrollHeight - prevScrollHeight); 
          }));
          return;
        }
      } catch (err) {
        console.warn("Failed to load paginated history from local DB:", err);
      }
    }

    try {
      const base = type === "user" ? `/messages/direct/${encodeURIComponent(id)}` : `/messages/group/${id}`;
      const rawHistory = await apiFetch<Message[]>(base + (beforeId ? `?before_id=${beforeId}` : ""));
      const history = applyPersistedDeletions(rawHistory);
      const decryptedHistory: Message[] = await Promise.all(
        history.map(async m => {
          let decMsg = { ...m, user: String(m.user).toLowerCase() };
          if (m.content && !m.is_deleted && !m._callRecord) {
            const peerEmail = type === "user" 
              ? (decMsg.user === currentUser ? String(id).toLowerCase() : decMsg.user) 
              : decMsg.user;
            const dec = await decryptContent(m.content, type, peerEmail, type === "group" ? id : undefined);
            if (dec !== m.content) decMsg = { ...decMsg, content: dec };
          }
          return { ...decMsg, _dateLabel: getDateLabel(decMsg.timestamp) };
        })
      );

      if (decryptedHistory.length > 0) {
        await dbSaveMessages(decryptedHistory, cacheKey);
      }

      if (!beforeId) {
        const cachedDeleted = (messagesCacheRef.current[cacheKey] || []).filter(m => m.is_deleted);
        cachedDeleted.forEach(d => { if (!decryptedHistory.some(m => String(m.id) === String(d.id))) decryptedHistory.push(d); });
      }

      if (beforeId) {
        const list = msgListRef.current;
        const prevScrollHeight = list ? list.scrollHeight : 0;
        const prevScrollTop = list ? list.scrollTop : 0;
        const currentList = messagesCacheRef.current[cacheKey] || [];
        const next = mergeMessageLists(decryptedHistory, currentList);
        messagesCacheRef.current[cacheKey] = next;
        setMessages(next);
        requestAnimationFrame(() => requestAnimationFrame(() => { if (list) list.scrollTop = prevScrollTop + (list.scrollHeight - prevScrollHeight); }));
      } else {
        const currentList = messagesCacheRef.current[cacheKey] || [];
        const mergedHistory = mergeMessageLists(currentList, decryptedHistory);
        messagesCacheRef.current[cacheKey] = mergedHistory;
        setMessages(mergedHistory);
        if (mergedHistory.length > 0) updateActivity(id, mergedHistory[mergedHistory.length - 1].content, mergedHistory[mergedHistory.length - 1].timestamp, true);
        setTimeout(() => scrollBottom(true), 60);
      }
      setHasMore(decryptedHistory.length === 50);
    } catch { }
    setLoadingMore(false);
    if (!beforeId) setIsLoadingHistory(false);
  }, [apiFetch, scrollBottom, updateActivity, applyPersistedDeletions, decryptContent, currentUser, messages]);
  const isChatMuted = useCallback((chatId: string): boolean => {
    if (!(chatId in mutedChats)) return false;
    const until = mutedChats[chatId];
    return until === null ? true : until > Date.now();
  }, [mutedChats]);

  const notify = useCallback((title: string, body: string, chatId?: string) => {
    if (chatId && isChatMuted(chatId)) return;
    if (chatId && activeChatRef.current && String(activeChatRef.current.id) === chatId) return;
    playNotificationSound();
    showLocalNotification(title, body, chatId);
  }, [playNotificationSound, isChatMuted]);

  const notifyCall = useCallback((title: string, body: string) => {
    showCallNotification(title, body);
  }, []);

  const markAllRead = useCallback(() => { setUnread({}); }, []);

  const applyAudioOutput = useCallback(async (speaker: boolean) => {
    setIsSpeaker(speaker);
    const elements = [remoteAudioRef.current, remoteVideoRef.current];
    if (typeof navigator !== "undefined" && navigator.mediaDevices && "enumerateDevices" in navigator.mediaDevices) {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioOutputs = devices.filter(d => d.kind === "audiooutput");
        let sinkId = "";
        if (audioOutputs.length > 0) {
          const matched = audioOutputs.find(d => {
            const lbl = d.label.toLowerCase();
            return speaker ? lbl.includes("speaker") : (lbl.includes("earpiece") || lbl.includes("receiver") || lbl.includes("headset"));
          });
          if (matched) sinkId = matched.deviceId;
        }
        elements.forEach(el => {
          if (!el) return;
          if ("setSinkId" in el) {
            (el as any).setSinkId(sinkId || (speaker ? "" : "default")).catch(() => {});
          }
          el.volume = 1.0;
        });
        return;
      } catch (e) {
        console.warn("Audio output routing fallback:", e);
      }
    }
    elements.forEach(el => {
      if (!el) return;
      if ("setSinkId" in el) (el as any).setSinkId(speaker ? "" : "communications").catch(() => {});
      el.volume = 1.0;
    });
  }, []);

  // ── AUTH LOGOUT HANDLER ───────────────────────────────────────────────────────
  const logout = useCallback(() => {
    abortControllerRef.current.abort();
    abortControllerRef.current = new AbortController();
    pendingTempTimers.current.forEach(t => clearTimeout(t));
    pendingTempTimers.current.clear();
    setFailedMsgIds(new Set());
    stopRingtone();
    setMessages([]);
    setSelectedMsgIds(new Set());
    setForwardingMsgs([]);
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.close();
      wsRef.current = null;
    }
    setWsStatus("disconnected");
    seenMessageIds.current.clear();
    hookLogout();
  }, [hookLogout, setFailedMsgIds, setMessages, setWsStatus]);

  const handleUpdateDisplayName = async () => {
    const currentName = profile.displayName || "";
    const n = prompt("Enter new display name:", currentName);
    if (n === null) return;
    const trimmed = n.trim();
    if (!trimmed) {
      showToast("Display name cannot be empty", "error");
      return;
    }
    try {
      await apiFetch("/profile/me", { method: "PATCH", body: JSON.stringify({ display_name: trimmed }) });
      updateProfile({ displayName: trimmed });
      setEditDisplayName(trimmed);
      showToast("Display name updated!", "success");
      await loadProfile();
    } catch (err: any) {
      showToast("Failed to update display name: " + errorMessage(err), "error");
    }
  };

  const handleUpdateUsername = async () => {
    const currentUname = profile.username || "";
    const u = prompt("Enter new username (letters, numbers, underscores):", currentUname);
    if (u === null) return;
    const trimmed = u.trim().toLowerCase().replace(/^@/, "");
    if (!trimmed) {
      showToast("Username cannot be empty", "error");
      return;
    }
    if (!USERNAME_RE.test(trimmed)) {
      showToast("Invalid username format. Use 3-20 letters, numbers, or underscores.", "error");
      return;
    }
    try {
      await apiFetch("/profile/me", { method: "PATCH", body: JSON.stringify({ username: trimmed }) });
      updateProfile({ username: trimmed });
      setEditUsername(trimmed);
      showToast(`Username updated to @${trimmed}!`, "success");
      await loadProfile();
    } catch (err: any) {
      showToast("Failed to update username: " + errorMessage(err), "error");
    }
  };

  const saveProfile = async () => {
    try {
      const body: any = {};
      if (editDisplayName.trim()) body.display_name = editDisplayName.trim();
      if (editUsername.trim() && editUsername.trim() !== profile.username) {
        const u = editUsername.trim().toLowerCase().replace(/^@/, "");
        if (!USERNAME_RE.test(u)) { showToast("Invalid username format", "error"); return; }
        body.username = u;
      }
      await apiFetch("/profile/me", { method: "PATCH", body: JSON.stringify(body) });
      updateProfile({ displayName: editDisplayName.trim() || profile.displayName, username: body.username || profile.username });
      setShowProfile(false);
      await loadProfile();
    } catch (err) { showToast("Failed to save profile: " + errorMessage(err), "error"); }
  };

  const processAvatarFile = async (file: File | Blob) => {
    setIsUploadingAvatar(true);
    try {
      let avatarUrl = "";
      try {
        const compressedDataUrl = await compressImage(file as File, 400, 0.85);
        const imageBlob = await (await fetch(compressedDataUrl)).blob();
        const { encryptedBlob, fileName } = await encryptAvatarBlob(imageBlob);
        const encryptedFile = new File([encryptedBlob], fileName, { type: "application/octet-stream" });
        const uploadRes = await uploadMediaToBackend(encryptedFile, token, fileName);
        avatarUrl = uploadRes.url;
      } catch (uploadErr) {
        console.warn("Backend encrypted avatar upload failed, using local fallback:", uploadErr);
        avatarUrl = await compressImage(file as File, 400, 0.82);
      }

      if (typeof window !== "undefined") {
        try {
          localStorage.setItem(`user_avatar_${currentUser}`, avatarUrl);
        } catch {}
      }
      updateProfile({ avatarUrl });
      setContacts(prev => prev.map(c => c.email === currentUser ? { ...c, avatar_url: avatarUrl } : c));
      if (viewFile && (viewFile.type === "self-avatar" || viewFile.type === "avatar-circle")) {
        setViewFile({ ...viewFile, url: avatarUrl });
      }
      await apiFetch("/profile/me", { method: "PATCH", body: JSON.stringify({ avatar_url: avatarUrl }) }).catch(() => {});
      wsSend(JSON.stringify({ type: "profile_updated", user: currentUser, avatar_url: avatarUrl, display_name: profile.displayName }));
      showToast("Profile photo updated!", "success");
    } catch (err: any) {
      showToast("Avatar update failed: " + (err?.message || "Error"), "error");
    } finally {
      setIsUploadingAvatar(false);
    }
  };

  const triggerAvatarPicker = async () => {
    try {
      const image = await Camera.getPhoto({
        quality: 85,
        allowEditing: false,
        width: 512,
        height: 512,
        resultType: CameraResultType.DataUrl,
        source: CameraSource.Prompt,
      });
      if (image?.dataUrl) {
        const res = await fetch(image.dataUrl);
        const blob = await res.blob();
        const file = new File([blob], `avatar_${currentUser}_${Date.now()}.jpg`, { type: "image/jpeg" });
        await processAvatarFile(file);
        return;
      }
    } catch (e: any) {
      if (e?.message?.includes("cancelled") || e?.message?.includes("User cancelled")) return;
    }
    avatarInputRef.current?.click();
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await processAvatarFile(file);
    e.target.value = "";
  };

  const handleGroupAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!activeChat || activeChat.type !== "group") return;
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploadingGroupAvatar(true);
    try {
      let avatarUrl = "";
      try {
        const compressedDataUrl = await compressImage(file, 400, 0.85);
        const imageBlob = await (await fetch(compressedDataUrl)).blob();
        const { encryptedBlob, fileName } = await encryptAvatarBlob(imageBlob);
        const encryptedFile = new File([encryptedBlob], fileName, { type: "application/octet-stream" });
        const uploadRes = await uploadMediaToBackend(encryptedFile, token, fileName);
        avatarUrl = uploadRes.url;
      } catch (uploadErr) {
        console.warn("Backend encrypted group avatar upload failed, using local fallback:", uploadErr);
        avatarUrl = await compressImage(file, 400, 0.82);
      }

      if (typeof window !== "undefined") {
        try {
          localStorage.setItem(`group_avatar_${activeChat.id}`, avatarUrl);
        } catch {}
      }
      setGroups(prev => prev.map(g => g.id === activeChat.id ? { ...g, avatar_url: avatarUrl } : g));
      apiFetch(`/groups/${activeChat.id}`, { method: "PATCH", body: JSON.stringify({ avatar_url: avatarUrl }) }).catch(() => {});
      showToast("Group avatar updated!", "success");
    } catch (err: any) {
      showToast("Group avatar update failed: " + (err?.message || "Error"), "error");
    } finally {
      setIsUploadingGroupAvatar(false);
      e.target.value = "";
    }
  };

  const addGroupMember = async (uname: string) => {
    if (!activeChat || activeChat.type !== "group" || !uname.trim()) return;
    try {
      const cleanedUname = uname.trim().replace(/^@/, "");
      let memberEmail = cleanedUname;
      if (!cleanedUname.includes("@")) {
        try {
          const prof = await apiFetch<{ email: string }>(`/profile/by-username/${encodeURIComponent(cleanedUname)}`);
          memberEmail = prof.email;
        } catch { showToast(`Username not found: @${cleanedUname}`, "error"); return; }
      }
      await apiFetch(`/groups/${activeChat.id}/members?member_email=${encodeURIComponent(memberEmail)}`, { method: "POST" });
      try {
        wsSend(JSON.stringify({ type: "group_message", content: `[SYSTEM] member_added:${memberEmail}:${currentUser}`, group_id: activeChat.id }));
      } catch (e) {
        console.error("Failed to send member_added WebSocket message:", e);
      }
      try {
        const privKey = e2ePrivKeyRef.current;
        const myPubB64 = e2ePubKeyB64Ref.current;
        const gid = String(activeChat.id);
        const existingKey = groupKeyCache.get(gid);
        if (privKey && myPubB64 && existingKey) {
          const newMemberPub = await getPeerPubKey(memberEmail);
          if (newMemberPub) {
            const keyId = crypto.randomUUID();
            const encKey = await wrapGroupKeyForMember({ keyId, groupKey: existingKey }, privKey, newMemberPub);
            await apiFetch(`/groups/${activeChat.id}/e2e-key`, { method: "POST", body: JSON.stringify({ key_id: keyId, setter_pub_key: myPubB64, member_keys: [{ email: memberEmail, encrypted_key: encKey }] }) });
          }
        }
      } catch { }
      await loadGroups();
    } catch (err) { showToast("Failed to add member: " + errorMessage(err), "error"); }
  };

  const leaveGroup = async (groupId: string | number) => {
    try {
      await apiFetch(`/groups/${groupId}/members?member_email=${encodeURIComponent(currentUser)}`, { method: "DELETE" });
      try {
        wsSend(JSON.stringify({ type: "group_message", content: `[SYSTEM] member_left:${currentUser}`, group_id: groupId }));
      } catch (e) {
        console.error("Failed to send member_left WebSocket message:", e);
      }
      showToast("You have left the group", "success");
      await loadGroups();
    } catch (err) {
      showToast("Failed to leave group: " + errorMessage(err), "error");
      throw err;
    }
  };

  const addContactByUsername = async (username: string) => {
    if (!username.trim()) return;
    try {
      const res = await apiFetch<{ email: string; username: string; message: string }>("/contacts", { method: "POST", body: JSON.stringify({ username: username.trim().toLowerCase() }) });
      await loadContacts();
      const prof = await apiFetch<Contact>(`/profile/by-username/${username.trim().toLowerCase()}`);
      openChat({ type: "user", id: res.email, name: prof.display_name || prof.username || "Unknown User" });
    } catch (err) { showToast("Could not find user: " + errorMessage(err), "error"); }
  };

  const saveContactNickname = (email: string, nickname: string) => {
    const trimmed = nickname.trim();
    const nextNicknames = { ...nicknames };
    if (trimmed) nextNicknames[email] = trimmed; else delete nextNicknames[email];
    if (currentUser) idbSet(`nicknames_${currentUser}`, nextNicknames).catch(() => {});
    setNicknames(nextNicknames);

    if (activeChat?.type === "user" && activeChat.id === email) {
      const c = contacts.find(c => c.email === email);
      setActiveChat({ ...activeChat, name: trimmed || c?.display_name || c?.username || "Unknown User" });
    }
    setShowHeaderNicknameEdit(false);
  };

  const togglePinMessage = (msg: Message) => {
    if (!activeChat) return;
    const chatId = String(activeChat.id);
    const currentPinned = pinnedMessages[chatId] || [];
    const exists = currentPinned.some(m => m.id === msg.id);
    let nextPinned = [];
    if (exists) {
      nextPinned = currentPinned.filter(m => m.id !== msg.id);
      showToast("Message unpinned", "success");
    } else {
      nextPinned = [...currentPinned, msg];
      showToast("Message pinned", "success");
    }
    const next = { ...pinnedMessages, [chatId]: nextPinned };
    savePinnedMessages(next);
    setSelectedMsgId(null);

    // Send Real-time sync via WebSocket
    const wsSendPayload: any = {
      type: "pin_change",
      chat_id: chatId,
      action: exists ? "unpin" : "pin",
      msg: msg,
      user: currentUser
    };
    if (activeChat.type === "user") {
      wsSendPayload.target_user = chatId;
    } else {
      wsSendPayload.group_id = chatId;
    }
    wsSend(JSON.stringify(wsSendPayload));
  };

  const scrollToPinnedMessage = async (pinId: string | number) => {
    // 1. Check if already loaded
    let idx = groupedMessages.findIndex(m => m.type === "msg" && String(m.id) === String(pinId));
    if (idx !== -1) {
      rowVirtualizerRef.current?.scrollToIndex(idx, { align: "center" });
      setHighlightedMsgId(pinId);
      setTimeout(() => setHighlightedMsgId(null), 2000);
      return;
    }

    // 2. Load older history in batches until found or exhausted
    if (!activeChat) return;
    let currentMessages = messages;
    let found = false;
    let attempts = 0;
    const maxAttempts = 30;

    while (!found && currentMessages.length > 0 && attempts < maxAttempts) {
      attempts++;
      const oldestMsg = currentMessages[0];
      if (!oldestMsg) break;

      showToast("Loading older history...", "info");
      const beforeId = oldestMsg.id;
      const { type, id } = activeChat;
      const base = type === "user" ? `/messages/direct/${encodeURIComponent(id)}` : `/messages/group/${id}`;

      try {
        const rawHistory = await apiFetch<Message[]>(base + `?before_id=${beforeId}`);
        if (rawHistory.length === 0) break;

        const history = applyPersistedDeletions(rawHistory);
        const decryptedHistory: Message[] = await Promise.all(
          history.map(async m => {
            let decMsg = m;
            if (m.content && !m.is_deleted && !m._callRecord) {
              const peerEmail = type === "user" ? (m.user === currentUser ? String(id) : m.user) : m.user;
              const dec = await decryptContent(m.content, type, peerEmail, type === "group" ? id : undefined);
              if (dec !== m.content) decMsg = { ...m, content: dec };
            }
            return { ...decMsg, _dateLabel: getDateLabel(decMsg.timestamp) };
          })
        );

        const updatedMessages = [...decryptedHistory, ...messages];
        messagesCacheRef.current[String(id)] = updatedMessages;
        setMessages(updatedMessages);

        // Wait for virtualizer and state update to flush to DOM
        await new Promise(resolve => setTimeout(resolve, 150));

        idx = groupedMessagesRef.current.findIndex(m => m.type === "msg" && String(m.id) === String(pinId));
        if (idx !== -1) {
          found = true;
          rowVirtualizerRef.current?.scrollToIndex(idx, { align: "center" });
          setHighlightedMsgId(pinId);
          setTimeout(() => setHighlightedMsgId(null), 2000);
          break;
        }
        currentMessages = updatedMessages;
      } catch {
        break;
      }
    }

    if (!found) {
      showToast("Message not found in loaded history", "info");
    }
  };

  const openHeaderNicknameEdit = () => {
    if (!activeChat || activeChat.type !== "user") return;
    setHeaderNicknameValue(nicknames[String(activeChat.id)] || "");
    setShowHeaderNicknameEdit(true);
    setShowContactProfile(false);
  };

  const clearChat = useCallback(async (type: "user" | "group", id: string | number) => {
    const sid = type === "user" ? String(id).toLowerCase() : String(id);
    delete messagesCacheRef.current[sid];
    await dbClearMessages(sid);
    setLastPreview(prev => ({ ...prev, [sid]: "" }));
    if (activeChat && String(activeChat.id).toLowerCase() === sid.toLowerCase()) {
      setMessages([]);
    }
    try {
      await clearChatApi(type, sid, token);
      showToast("Chat cleared", "info");
    } catch (err: any) {
      console.error("Failed to clear chat on server:", err);
    }
  }, [activeChat, token, showToast]);

  const deleteChat = useCallback(async (type: "user" | "group", id: string | number) => {
    const sid = type === "user" ? String(id).toLowerCase() : String(id);
    setSidebarDeleteId(null);
    delete messagesCacheRef.current[sid];
    await dbClearMessages(sid);
    setLastActivity(prev => { const n = { ...prev }; delete n[sid]; return n; });
    setLastPreview(prev => { const n = { ...prev }; delete n[sid]; return n; });
    setUnread(prev => { const n = { ...prev }; delete n[sid]; return n; });

    // Hide chat from chat section until new message or search
    setHiddenChats(prev => {
      const next = new Set(prev);
      next.add(sid);
      try { localStorage.setItem("pulse_hidden_chats", JSON.stringify([...next])); } catch {}
      return next;
    });

    if (activeChat && String(activeChat.id).toLowerCase() === sid.toLowerCase()) {
      setActiveChat(null);
      setMessages([]);
    }

    try {
      await hideChatApi(type, sid, token);
      showToast("Chat deleted", "info");
    } catch (err: any) {
      console.error("Failed to delete chat on server:", err);
    }
  }, [activeChat, token, showToast]);

  const pendingReadReceiptsRef = useRef<Map<string, "user" | "group">>(new Map());
  const readReceiptTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushReadReceipts = useCallback(() => {
    if (pendingReadReceiptsRef.current.size === 0) return;
    const entries = Array.from(pendingReadReceiptsRef.current.entries());
    pendingReadReceiptsRef.current.clear();

    const userPeers: string[] = [];
    const groupIds: string[] = [];

    for (const [id, type] of entries) {
      if (type === "user") userPeers.push(id);
      else groupIds.push(id);
    }

    if (userPeers.length > 0) {
      apiFetch("/mark-read-batch", {
        method: "POST",
        body: JSON.stringify({ peer_emails: userPeers }),
      }).catch(() => {
        setTimeout(() => {
          apiFetch("/mark-read-batch", {
            method: "POST",
            body: JSON.stringify({ peer_emails: userPeers }),
          }).catch(() => {});
        }, 3000);
      });
      wsSendRef.current?.(JSON.stringify({ type: "read_receipt_batch", target_users: userPeers }));
    }

    for (const gid of groupIds) {
      apiFetch("/mark-read", {
        method: "POST",
        body: JSON.stringify({ group_id: gid }),
      }).catch(() => {
        setTimeout(() => {
          apiFetch("/mark-read", {
            method: "POST",
            body: JSON.stringify({ group_id: gid }),
          }).catch(() => {});
        }, 3000);
      });
      wsSendRef.current?.(JSON.stringify({ type: "read_receipt", group_id: gid }));
    }
  }, [apiFetch]);

  const sendReadReceipt = useCallback(async (chat: Chat) => {
    const chatId = chat.type === "user" ? String(chat.id).toLowerCase() : String(chat.id);
    pendingReadReceiptsRef.current.set(chatId, chat.type);

    if (readReceiptTimerRef.current) {
      clearTimeout(readReceiptTimerRef.current);
    }
    // Batch read receipts within 600ms window
    readReceiptTimerRef.current = setTimeout(() => {
      flushReadReceipts();
    }, 600);
  }, [flushReadReceipts]);

  const openChat = useCallback(async (chat: Chat) => {
    const chatId = chat.type === "user" ? String(chat.id).toLowerCase() : String(chat.id);
    const normalizedChat = chat.type === "user" ? { ...chat, id: chatId } : chat;
    setIsScrollAnchored(true);
    setActiveChat(normalizedChat);
    setShowHeaderNicknameEdit(false); setShowContactProfile(false); setShowGroupProfile(false);
    setSearchQuery(""); setReplyingTo(null); setReactionPickerId(null); setSelectedMsgId(null);
    setSelectedMsgIds(new Set()); setForwardingMsgs([]);

    // 1. Instant RAM cache display (0.00ms)
    const inMemoryMsgs = messagesCacheRef.current[chatId];
    if (inMemoryMsgs && inMemoryMsgs.length > 0) {
      setMessages(inMemoryMsgs);
      setIsLoadingHistory(false);
      requestAnimationFrame(() => scrollBottom(true));
    }

    // 2. Instant IndexedDB fetch (<2ms) to ensure full stored history is available
    try {
      const cachedDbMsgs = await dbGetMessages(chatId, 100);
      if (cachedDbMsgs && cachedDbMsgs.length > 0) {
        const merged = mergeMessageLists(messagesCacheRef.current[chatId] || [], cachedDbMsgs);
        messagesCacheRef.current[chatId] = merged;
        setMessages(merged);
        setIsLoadingHistory(false);
        requestAnimationFrame(() => scrollBottom(true));
      } else if (!inMemoryMsgs || inMemoryMsgs.length === 0) {
        setIsLoadingHistory(true);
      }
    } catch {
      if (!inMemoryMsgs || inMemoryMsgs.length === 0) {
        setIsLoadingHistory(true);
      }
    }

    setHasMore(false); setShowEmojis(false); setEditingId(null);
    addToReadChats(chatId);
    setUnread(prev => ({ ...prev, [chatId]: 0 }));
    sendReadReceipt(normalizedChat);

    // 3. Background network sync without blocking UI
    loadHistory(normalizedChat).catch(() => {});

    // 4. Background peer profile update so contact avatar and display name are always fresh
    if (normalizedChat.type === "user") {
      apiFetch<Contact>(`/profile/${encodeURIComponent(chatId)}`).then(prof => {
        if (prof && (prof.avatar_url || prof.display_name || prof.username)) {
          setContacts(prev => {
            const exists = prev.some(c => c.email.toLowerCase() === chatId);
            if (!exists) return [...prev, { email: chatId, display_name: prof.display_name, avatar_url: prof.avatar_url, username: prof.username, is_online: prof.is_online }];
            return prev.map(c => c.email.toLowerCase() === chatId ? { ...c, ...prof } : c);
          });
        }
      }).catch(() => {});
    }

    if (normalizedChat.type === "user" && e2ePrivKeyRef.current) getPeerPubKey(String(normalizedChat.id)).catch(() => { });
    else if (normalizedChat.type === "group" && e2ePrivKeyRef.current) getGroupKey(normalizedChat.id).catch(() => { });
  }, [scrollBottom, loadHistory, sendReadReceipt, getPeerPubKey, getGroupKey, apiFetch]);

  useEffect(() => { openChatRef.current = openChat; }, [openChat]);

  const openChatByChatId = useCallback((chatId: string) => {
    if (!chatId) return;
    if (chatId.includes("@")) {
      const c = contactsRef.current.find(co => co.email === chatId);
      const name = c ? contactLabelFn(c) : chatId;
      openChatRef.current({ type: "user", id: chatId, name });
    } else {
      const g = groupsRef.current.find(gr => String(gr.id) === String(chatId));
      const name = g ? g.name : "Group Chat";
      openChatRef.current({ type: "group", id: isNaN(Number(chatId)) ? chatId : Number(chatId), name });
    }
  }, [contactLabelFn]);

  useEffect(() => { openChatByChatIdRef.current = openChatByChatId; }, [openChatByChatId]);

  // ── NOTIFICATION REDIRECT LISTENER (Item 4) ─────────────────────────────────
  useEffect(() => {
    const handleOpenChatEvent = (e: any) => {
      const targetId = e?.detail?.chatId;
      if (targetId && openChatByChatIdRef.current) {
        openChatByChatIdRef.current(targetId);
      }
    };

    window.addEventListener("flux_open_chat", handleOpenChatEvent);

    // Initial launch check from persistent storage
    const pendingChat = (window as any).FluxNativeBridge?.getPendingOpenChat?.();
    if (pendingChat) {
      openChatByChatId(pendingChat);
    }

    return () => {
      window.removeEventListener("flux_open_chat", handleOpenChatEvent);
    };
  }, [openChatByChatId]);

  // ── BACK BUTTON / OVERLAY MANAGEMENT ─────────────────────────────────────────
  useEffect(() => {
    const anyOverlayOpen = showEmojis || showContactProfile || showGroupProfile || showCallLogUI || showProfile || showMyProfileSettings || !!viewFile || reactionPickerId !== null || !!activeViewingStatusGroup || !!showStatusCreator || showStatusUI;
    if (anyOverlayOpen) window.history.pushState({ Flux_Overlay: true }, "");
    const handlePopState = () => {
      if (activeViewingStatusGroup) { setActiveViewingStatusGroup(null); return; }
      if (showStatusCreator) { setShowStatusCreator(null); return; }
      if (showEmojis) { setShowEmojis(false); return; }
      if (reactionPickerId !== null) { setReactionPickerId(null); return; }
      if (viewFile) { setViewFile(null); return; }
      if (showContactProfile) {
        setShowContactProfile(false);
        if (openedProfileFromSidebar) { setActiveChat(null); setOpenedProfileFromSidebar(false); }
        return;
      }
      if (showGroupProfile) {
        setShowGroupProfile(false);
        if (openedProfileFromSidebar) { setActiveChat(null); setOpenedProfileFromSidebar(false); }
        return;
      }
      if (showCallLogUI) { setShowCallLogUI(false); return; }
      if (showStatusUI) { setShowStatusUI(false); return; }
      if (showProfile) { setShowProfile(false); return; }
      if (showMyProfileSettings) { setShowMyProfileSettings(false); return; }
      if (activeChat) { setActiveChat(null); return; }
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [showEmojis, showContactProfile, showGroupProfile, showCallLogUI, showProfile, showMyProfileSettings, viewFile, reactionPickerId, activeChat, openedProfileFromSidebar, activeViewingStatusGroup, showStatusCreator, showStatusUI]);

  // ── LOAD MORE (Intersection Observer) ────────────────────────────────────────
  useEffect(() => {
    const sentinel = loadMoreSentinelRef.current;
    if (!sentinel || !hasMore) return;
    const observer = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && !loadingMore && messages.length > 0 && activeChat) loadHistory(activeChat, messages[0].id);
    }, { root: msgListRef.current, threshold: 0, rootMargin: "80px 0px 0px 0px" });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loadingMore, messages, activeChat, loadHistory]);

  const wsSend = useCallback((payload: string) => {
    let sent = false;
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      try {
        wsRef.current.send(payload);
        sent = true;
      } catch (e) {
        console.warn("wsSend error:", e);
      }
    } else if (typeof window !== "undefined" && (window as any).FluxNativeBridge?.sendSignal) {
      // Fallback to native background service if web socket is not open
      if (payload.includes('"type":"call_') || payload.includes('"type":"ice_candidate"')) {
        try {
          (window as any).FluxNativeBridge.sendSignal(payload);
          sent = true;
        } catch {}
      }
    }
    if (!sent) {
      pendingMessages.current.push(payload);
      if (typeof window !== "undefined" && currentUserRef.current) {
        try {
          idbSet(`pending_messages_${currentUserRef.current}`, pendingMessages.current).catch(() => {});
        } catch (e) {
          console.error("Failed to save pending messages to storage:", e);
        }
      }
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        initWSRef.current?.();
      }
    }
  }, []);

  // ── REMOVE PEER FROM CALL ─────────────────────────────────────────────────────
  const removePeerFromCall = useCallback((peerEmail: string) => {
    const pc = pcMapRef.current.get(peerEmail);
    if (pc) { try { pc.close(); } catch { } pcMapRef.current.delete(peerEmail); }
    setRemoteStreams(prev => { const next = { ...prev }; delete next[peerEmail]; return next; });
    if (!callGroupIdRef.current || pcMapRef.current.size === 0) {
      endCallRef.current(false, callStateRef.current === "connected" ? "completed" : "missed");
    }
  }, []);

  const endCall = useCallback((sendSignal = true, explicitStatus?: "completed" | "missed" | "rejected") => {
    stopRingtone();
    cancelCallNotification();
    acceptInProgressRef.current = false;
    try {
      sessionStorage.removeItem("_Flux_call_offer");
      localStorage.removeItem("flux_pending_call_offer");
      if (typeof window !== "undefined") {
        (window as any).FluxNativeBridge?.clearPendingCallOffer?.();
        (window as any).FluxNativeBridge?.stopRingtone?.();
        if (navigator.vibrate) navigator.vibrate(0);
      }
    } catch { }

    const finalStatus = explicitStatus || (callStateRef.current === "connected" ? "completed" : "missed");
    const duration = callStartTimeRef.current && callStateRef.current === "connected"
      ? Math.floor((Date.now() - callStartTimeRef.current) / 1000) : 0;
    const cp = callPeerRef.current;
    const cpName = callPeerNameRef.current;

    if (cp && callDirectionRef.current) {
      const resolvedName = cpName || getPeerName(cp) || cp;
      const newLog: CallLogEntry = {
        id: Date.now().toString() + Math.random(), peer: cp, peerName: resolvedName,
        direction: callDirectionRef.current, media: isVideoCallRef.current ? "video" : "audio",
        status: finalStatus, timestamp: new Date().toISOString(), duration,
        ...(callGroupIdRef.current ? { group_id: callGroupIdRef.current } : {})
      };
      setCallLogs(prev => {
        const next = [newLog, ...prev];
        try { idbSet("cached_call_logs", next.slice(0, 200)).catch(() => {}); } catch { }
        return next;
      });
      apiFetch("/call-logs", { method: "POST", body: JSON.stringify(newLog) }).catch(() => { });

      const icon = isVideoCallRef.current ? "📹" : "📞";
      const callTypeLabel = isVideoCallRef.current ? "Video call" : "Voice call";
      const statusLabel = finalStatus === "completed" ? ` · ${fmtDuration(duration)}` : finalStatus === "rejected" ? " · Declined" : " · Missed";
      const recordContent = `${icon} ${callDirectionRef.current === "incoming" ? "Incoming" : "Outgoing"} ${callTypeLabel}${statusLabel}`;
      const callTs = new Date().toISOString();
      const callRecord: Message = { id: `call-${Date.now()}-${Math.random()}`, user: currentUserRef.current, content: recordContent, timestamp: callTs, _callRecord: true, _dateLabel: getDateLabel(callTs) };
      const targetChatId = activeChatRef.current ? String(activeChatRef.current.id) : cp || "";
      if (targetChatId) {
        setMessages(prev => {
          const next = [...prev, callRecord];
          messagesCacheRef.current[targetChatId] = next;
          return next;
        });
      }
      setTimeout(scrollBottom, 50);
    }

    if (sendSignal) {
      if (pcMapRef.current.size > 0) pcMapRef.current.forEach((_, peerEmail) => wsSend(JSON.stringify({ type: "call_end", target_user: peerEmail })));
      else if (cp) wsSend(JSON.stringify({ type: "call_end", target_user: cp }));
    }

    if (localStreamRef.current) localStreamRef.current.getTracks().forEach(t => t.stop());
    pcMapRef.current.forEach(pc => pc.close());
    pcMapRef.current.clear();
    if (peerConnectionRef.current) peerConnectionRef.current.close();
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null;

    peerConnectionRef.current = null; pendingRemoteDescriptionRef.current = null;
    localStreamRef.current = null; remoteStreamRef.current = null;
    iceCandidateQueueRef.current = []; iceQueuesRef.current.clear(); pendingMeshOffersRef.current.clear();

    setRemoteStreams({}); setCameraStates({});
    updateCallState("idle"); setCallPeer(null); setCallPeerName("");
    setIsMuted(false); setIsSpeaker(false); setIsCameraOff(false); setRemoteVideoMuted(false);
    setFacingMode("user"); setIsVideoSwapped(false);
    callStartTimeRef.current = null; callDirectionRef.current = null; isVideoCallRef.current = false;
    callGroupIdRef.current = null; setPipPos({ x: 16, y: 100 });
  }, [updateCallState, stopRingtone, scrollBottom, getPeerName, apiFetch]); // eslint-disable-line

  useEffect(() => { endCallRef.current = endCall; }, [endCall]);

  const restoreCallOfferRef = useRef<any>(null);

  const restoreCallOfferFromStorage = useCallback((forceAction?: string) => {
    try {
      let stored: string | null = null;
      let action = forceAction || "";
      if (typeof window !== "undefined") {
        try {
          const nativeBridgeOffer = (window as any).FluxNativeBridge?.getPendingCallOffer?.();
          if (nativeBridgeOffer && String(nativeBridgeOffer).trim().startsWith("{")) {
            stored = String(nativeBridgeOffer);
            (window as any).FluxNativeBridge?.clearPendingCallOffer?.();
          }
        } catch { }
        if (!stored) {
          stored = localStorage.getItem("flux_pending_call_offer") || sessionStorage.getItem("_Flux_call_offer");
        }
      }
      if (!stored) return false;
      const parsed: StoredCallOffer & { action?: string } = JSON.parse(stored);
      if (Date.now() - (parsed.ts || 0) > 60_000) {
        try {
          sessionStorage.removeItem("_Flux_call_offer");
          localStorage.removeItem("flux_pending_call_offer");
        } catch { }
        return false;
      }
      if (!action && parsed.action) action = parsed.action;
      if (callStateRef.current !== "idle" && action !== "accept") return false;

      const normalizedSdp = normalizeSdp(parsed.sdp);
      const offerGroupId = parsed.group_id || (parsed.sdp && (parsed.sdp as any).group_id);
      if (offerGroupId) callGroupIdRef.current = offerGroupId;
      pendingRemoteDescriptionRef.current = normalizedSdp;
      setCallPeer(parsed.peer); setCallPeerName(parsed.peerName || parsed.peer);
      callPeerRef.current = parsed.peer; callPeerNameRef.current = parsed.peerName || parsed.peer;
      setIsVideoCall(parsed.isVideo); isVideoCallRef.current = parsed.isVideo;
      callDirectionRef.current = "incoming";

      if (action === "accept") {
        stopRingtone();
        updateCallState("incoming");
        setTimeout(() => {
          acceptCallRef.current?.();
        }, 120);
      } else {
        updateCallState("incoming");
        startRingtone();
        notifyCall(parsed.isVideo ? "📹 Incoming Video Call" : "📞 Incoming Voice Call", `${parsed.peerName || parsed.peer} is calling…`);
      }
      return true;
    } catch { return false; }
  }, [updateCallState, startRingtone, notifyCall]);

  useEffect(() => {
    restoreCallOfferRef.current = restoreCallOfferFromStorage;
  }, [restoreCallOfferFromStorage]);

  useEffect(() => {
    // 1. Initial check on mount
    restoreCallOfferFromStorage();

    // 2. Window focus and visibility changes
    const onVis = () => {
      if (document.visibilityState === "visible") {
        restoreCallOfferFromStorage();
        if (tokenRef.current && (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN)) {
          initWSRef.current?.();
        }
      }
    };
    window.addEventListener("focus", onVis);
    document.addEventListener("visibilitychange", onVis);

    // 3. Direct native call intent event dispatched from MainActivity
    const onNativeIntent = (e: any) => {
      const detail = e?.detail;
      if (detail) {
        try {
          localStorage.setItem("flux_pending_call_offer", typeof detail === "string" ? detail : JSON.stringify(detail));
        } catch {}
      }
      restoreCallOfferFromStorage(detail?.action);
    };

    const onNativeDismissed = () => {
      stopRingtone();
      cancelCallNotification();
      try {
        sessionStorage.removeItem("_Flux_call_offer");
        localStorage.removeItem("flux_pending_call_offer");
        if (typeof window !== "undefined") {
          (window as any).FluxNativeBridge?.clearPendingCallOffer?.();
          (window as any).FluxNativeBridge?.stopRingtone?.();
          if (navigator.vibrate) navigator.vibrate(0);
        }
      } catch {}
      if (callStateRef.current === "incoming") {
        endCallRef.current?.(false, "rejected");
      }
    };

    window.addEventListener("flux_native_call_intent", onNativeIntent);
    window.addEventListener("flux_native_call_dismissed", onNativeDismissed);

    return () => {
      window.removeEventListener("focus", onVis);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("flux_native_call_intent", onNativeIntent);
      window.removeEventListener("flux_native_call_dismissed", onNativeDismissed);
    };
  }, [restoreCallOfferFromStorage]);

  // ── WEBSOCKET ─────────────────────────────────────────────────────────────────
  const initWS = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.CONNECTING) return;
    if (wsPingInterval.current) { clearInterval(wsPingInterval.current); wsPingInterval.current = null; }
    if (wsRef.current) { wsRef.current.onclose = null; wsRef.current.close(); }
    const currentToken = tokenRef.current;
    if (!currentToken) return;
    setWsStatus("reconnecting");

    let ws: WebSocket;
    try {
      ws = new WebSocket(`${WS_URL}/ws?token=${encodeURIComponent(currentToken)}`);
      wsRef.current = ws;
      if (wsConnTimeoutRef.current) clearTimeout(wsConnTimeoutRef.current);
      wsConnTimeoutRef.current = setTimeout(() => {
        if (ws.readyState === WebSocket.CONNECTING) {
          console.warn("WebSocket connection timeout. Closing and retrying...");
          ws.close();
        }
      }, 8000);
    } catch {
      setWsStatus("disconnected");
      return;
    }

    ws.onopen = () => {
      if (wsConnTimeoutRef.current) {
        clearTimeout(wsConnTimeoutRef.current);
        wsConnTimeoutRef.current = null;
      }
      wsRetryDelay.current = 800; wsRetryCount.current = 0;
      setWsStatus("connected");
      _registerFCMToken(currentToken).catch(() => {});
      if (ringtoneRef.current) ringtoneRef.current.load();

      if (seenMessageIds.current.size > 2000) seenMessageIds.current = new Set([...seenMessageIds.current].slice(-1000));
      persistSeenIdsRef.current();
      lastPongRef.current = Date.now();

      wsPingInterval.current = setInterval(() => {
        if (ws.readyState !== WebSocket.OPEN) return;
        if (Date.now() - lastPongRef.current > 60000) { ws.close(); return; }
        ws.send(JSON.stringify({ type: "ping" }));
      }, 20000);

      while (pendingMessages.current.length > 0) {
        const queued = pendingMessages.current[0];
        if (queued && ws.readyState === WebSocket.OPEN) {
          ws.send(queued);
          pendingMessages.current.shift();
        } else {
          break;
        }
      }
      if (typeof window !== "undefined" && currentUserRef.current) {
        try {
          if (pendingMessages.current.length > 0) {
            idbSet(`pending_messages_${currentUserRef.current}`, pendingMessages.current).catch(() => {});
          } else {
            idbDel(`pending_messages_${currentUserRef.current}`).catch(() => {});
          }
        } catch { }
      }

      apiFetchRef.current<Record<string, number>>("/unread-counts").then(counts => {
        setUnread(() => {
          const merged: Record<string, number> = {};
          Object.entries(counts).forEach(([k, v]) => {
            merged[k.includes("@") ? k.toLowerCase() : k] = v;
          });
          const id = activeChatRef.current ? (activeChatRef.current.type === "user" ? String(activeChatRef.current.id).toLowerCase() : String(activeChatRef.current.id)) : null;
          readChatsRef.current.forEach(cid => {
            merged[cid.includes("@") ? cid.toLowerCase() : cid] = 0;
          });
          if (id) merged[id] = 0;
          return merged;
        });
      }).catch(() => { });

      const openChatNow = activeChatRef.current;
      if (openChatNow && ws.readyState === WebSocket.OPEN) {
        loadHistoryRef.current?.(openChatNow).catch(() => {});
        if (openChatNow.type === "user") {
          const lowerPeerId = String(openChatNow.id).toLowerCase();
          apiFetchRef.current("/mark-read", { method: "POST", body: JSON.stringify({ peer_email: lowerPeerId }) })
            .then(() => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "read_receipt", target_user: lowerPeerId })); })
            .catch(() => { });
        } else {
          apiFetchRef.current("/mark-read", { method: "POST", body: JSON.stringify({ group_id: String(openChatNow.id) }) }).catch(() => { });
        }
      }
    };

    ws.onerror = () => {
      if (wsConnTimeoutRef.current) {
        clearTimeout(wsConnTimeoutRef.current);
        wsConnTimeoutRef.current = null;
      }
    };

    ws.onclose = (e) => {
      if (wsConnTimeoutRef.current) {
        clearTimeout(wsConnTimeoutRef.current);
        wsConnTimeoutRef.current = null;
      }
      if (wsPingInterval.current) { clearInterval(wsPingInterval.current); wsPingInterval.current = null; }
      if (e?.code === 1008 || e?.code === 4401) {
        try { useAuthStore.getState().logout(); } catch {}
        setTimeout(() => setWsStatus("disconnected"), 0);
        return;
      }
      const hasToken = !!tokenRef.current;
      if (!hasToken) { setTimeout(() => setWsStatus("disconnected"), 0); return; }
      wsRetryCount.current += 1;
      const delay = wsRetryDelay.current;
      wsRetryDelay.current = Math.min(delay * 1.5, 5000);
      setTimeout(() => {
        setWsStatus("disconnected");
        setTimeout(() => {
          if (!tokenRef.current || wsRef.current?.readyState === WebSocket.OPEN || wsRef.current?.readyState === WebSocket.CONNECTING) return;
          setWsStatus("reconnecting");
          requestAnimationFrame(() => initWSRef.current?.());
        }, delay);
      }, 0);
    };

    ws.onmessage = ({ data: raw }) => {
      try {
        const parsed = JSON.parse(raw);
        if (parsed.type === "pong") {
          lastPongRef.current = Date.now();
          return;
        }
      } catch {
        return;
      }
      // Instant execution on same event loop tick
      wsHandlerRef.current(raw);
    };
  }, []); // eslint-disable-line

  // ── WS MESSAGE HANDLER ────────────────────────────────────────────────────────
  const wsHandler = useCallback(async (raw: string) => {
    let data: Partial<Message> & Record<string, unknown>;
    try { data = JSON.parse(raw); } catch { return; }
    const me = currentUserRef.current;

    const updateMsgCache = (targetChatId: string, updater: (msgs: Message[]) => Message[]) => {
      const currentList = messagesCacheRef.current[targetChatId] || [];
      const nextList = updater(currentList);
      messagesCacheRef.current[targetChatId] = nextList;
      const activeId = activeChatRef.current
        ? (activeChatRef.current.type === "user" ? String(activeChatRef.current.id).toLowerCase() : String(activeChatRef.current.id))
        : null;
      if (targetChatId === activeId) {
        setMessages(nextList);
      }
      saveMessagesCache(messagesCacheRef.current);
    };

    switch (data.type) {
      case "status_updated":
        loadStatuses();
        break;

      case "typing":
        if (typeof data.user === "string" && String(data.user).toLowerCase() !== me) {
          const userLower = String(data.user).toLowerCase();
          setTypingSet(prev => new Set(prev).add(userLower));
          setTimeout(() => setTypingSet(prev => { const n = new Set(prev); n.delete(userLower); return n; }), 2000);
        }
        break;

      case "pin_change": {
        const isGroup = !!data.group_id;
        const sender = data.user || data.sender;
        const pinChatId = isGroup
          ? String(data.group_id || data.chat_id)
          : (String(sender).toLowerCase() === me ? String(data.target_user).toLowerCase() : String(sender).toLowerCase());
        const pinAction = String(data.action);
        const pinMsg = data.msg as Message;
        if (pinChatId && pinMsg) {
          setPinnedMessages(prev => {
            const currentPinned = prev[pinChatId] || [];
            let nextPinned = [];
            if (pinAction === "pin") {
              if (!currentPinned.some(m => m.id === pinMsg.id)) {
                nextPinned = [...currentPinned, pinMsg];
              } else {
                nextPinned = currentPinned;
              }
            } else {
              nextPinned = currentPinned.filter(m => m.id !== pinMsg.id);
            }
            const next = { ...prev, [pinChatId]: nextPinned };
            if (currentUserRef.current) {
              try {
                idbSet(`pinned_msgs_${currentUserRef.current}`, next).catch(() => {});
              } catch { }
            }
            return next;
          });
        }
        break;
      }

      case "direct_message": {
        const dataUser = String(data.user).toLowerCase();
        setTypingSet(prev => { const n = new Set(prev); n.delete(dataUser); return n; });
        const peer = dataUser === me ? (data.receiver_email || data.target_user) : data.user;
        if (!peer) break;
        const peerEmail = String(peer).toLowerCase();
        unhideChat(peerEmail);
        if (dataUser !== me && blockedUsersRef.current.has(dataUser)) break;
        const rawMsg = data as Message;
        const decContent = await decryptContentRef.current(rawMsg.content, "user", peerEmail);
        if (decContent.startsWith("[SYSTEM] delete_message:")) {
          const targetId = decContent.replace("[SYSTEM] delete_message:", "").trim();
          updateMsgCache(peerEmail, prev => prev.map(m => String(m.id) === targetId ? { ...m, is_deleted: true } : m));
          break;
        }
        if (decContent.startsWith("[SYSTEM] delete_call_log:")) {
          const logId = decContent.replace("[SYSTEM] delete_call_log:", "").trim();
          setCallLogs(prev => {
            const next = prev.filter(l => String(l.id) !== logId);
            try { idbSet("cached_call_logs", next.slice(0, 200)).catch(() => {}); } catch { }
            return next;
          });
          break;
        }
        const msg = { 
          ...rawMsg, 
          user: dataUser, 
          receiver_email: rawMsg.receiver_email ? String(rawMsg.receiver_email).toLowerCase() : undefined,
          target_user: rawMsg.target_user ? String(rawMsg.target_user).toLowerCase() : undefined,
          content: decContent, 
          _dateLabel: getDateLabel(rawMsg.timestamp) 
        };
        const dmId = String(msg.id);
        if (!dmId.startsWith("temp-") && seenMessageIds.current.has(dmId)) break;
        if (!dmId.startsWith("temp-")) { seenMessageIds.current.add(dmId); persistSeenIdsRef.current(); }
        updateActivityRef.current(peerEmail, msg.content, msg.timestamp);
        dbSaveMessage(msg, peerEmail).catch(() => {});
        const contactExists = contactsRef.current.some(c => c.email.toLowerCase() === peerEmail);
        if (!contactExists) {
          setContacts(prev => {
            if (prev.find(c => c.email.toLowerCase() === peerEmail)) return prev;
            return [...prev, { email: peerEmail, display_name: (data.sender_name as string) || null, avatar_url: (data.sender_avatar as string) || null, is_online: true, username: null }];
          });
          apiFetchRef.current("/contacts/by-email", { method: "POST", body: JSON.stringify({ email: peerEmail }) })
            .then(() => loadContactsRef.current())
            .catch(() => { });
          if (!fetchingProfilesRef.current.has(peerEmail)) {
            fetchingProfilesRef.current.add(peerEmail);
            apiFetchRef.current<Contact>(`/profile/${encodeURIComponent(peerEmail)}`)
              .then(prof => setContacts(prev => prev.map(c => c.email.toLowerCase() === peerEmail ? { ...c, ...prof } : c)))
              .catch(() => { })
              .finally(() => fetchingProfilesRef.current.delete(peerEmail));
          }
        } else if (data.sender_avatar || data.sender_name) {
          setContacts(prev => prev.map(c => {
            if (c.email.toLowerCase() === peerEmail) {
              return {
                ...c,
                ...(data.sender_avatar ? { avatar_url: data.sender_avatar as string } : {}),
                ...(data.sender_name ? { display_name: data.sender_name as string } : {}),
              };
            }
            return c;
          }));
        }
        const isInPeerChat = activeChatRef.current?.type === "user" && String(activeChatRef.current.id).toLowerCase() === peerEmail;
        lastReplacedTempRef.current = null;
        updateMsgCache(peerEmail, prev => {
          if (dataUser === me) {
            const cleanContent = (msg.content || "").trim();
            const msgTime = parseTs(msg.timestamp).getTime();
            const idx = prev.findIndex(m => {
              const mId = String(m.id);
              if (!mId.startsWith("temp-")) return false;
              if ((m.content || "").trim() === cleanContent) return true;
              return Math.abs(parseTs(m.timestamp).getTime() - msgTime) < 60000;
            });
            if (idx !== -1) {
              const oldTempId = String(prev[idx].id);
              lastReplacedTempRef.current = oldTempId;
              dbDeleteMessage(oldTempId).catch(() => {});
              const next = [...prev];
              next[idx] = msg;
              return next;
            }
            if (!prev.find(m => String(m.id) === String(msg.id))) return [...prev, msg];
            return prev;
          }
          if (!prev.find(m => String(m.id) === String(msg.id))) return [...prev, msg];
          return prev;
        });

        if (isInPeerChat) {
          const replacedId = lastReplacedTempRef.current;
          if (replacedId) { const t = pendingTempTimers.current.get(replacedId); if (t) { clearTimeout(t); pendingTempTimers.current.delete(replacedId); } setFailedMsgIds(prev => { const n = new Set(prev); n.delete(replacedId); return n; }); }
          setTimeout(() => scrollBottomRef.current?.(), 50);
          if (dataUser !== me && activeChatRef.current) sendReadReceiptRef.current(activeChatRef.current);
        } else {
          if (dataUser !== me) {
            setUnread(prev => ({ ...prev, [peerEmail]: (prev[peerEmail] || 0) + 1 }));
            notifyRef.current((data.sender_name as string) || "New message", formatNotificationMedia(msg.content), peerEmail);
          }
        }
        break;
      }

      case "group_message": {
        const rawGMsg = data as Message;
        const dataUser = String(rawGMsg.user).toLowerCase();
        unhideChat(String(rawGMsg.group_id));
        const decContent = await decryptContentRef.current(rawGMsg.content, "group", dataUser, rawGMsg.group_id);
        if (decContent.startsWith("[SYSTEM] delete_message:")) {
          const targetId = decContent.replace("[SYSTEM] delete_message:", "").trim();
          updateMsgCache(String(rawGMsg.group_id), prev => prev.map(m => String(m.id) === targetId ? { ...m, is_deleted: true } : m));
          break;
        }
        if (decContent.startsWith("[SYSTEM] delete_call_log:")) {
          const logId = decContent.replace("[SYSTEM] delete_call_log:", "").trim();
          setCallLogs(prev => {
            const next = prev.filter(l => String(l.id) !== logId);
            try { idbSet("cached_call_logs", next.slice(0, 200)).catch(() => {}); } catch { }
            return next;
          });
          break;
        }
        if (decContent.startsWith("[SYSTEM] member_left:")) {
          const leftUser = decContent.replace("[SYSTEM] member_left:", "").trim().toLowerCase();
          const targetGroupId = String(rawGMsg.group_id);
          setGroups(prev => prev.map(g => {
            if (String(g.id) !== targetGroupId) return g;
            return {
              ...g,
              members: g.members.filter(m => getEmail(m).toLowerCase() !== leftUser)
            };
          }));
          loadGroupsRef.current?.();
          break;
        }

        if (decContent.startsWith("[SYSTEM] member_added:")) {
          loadGroupsRef.current?.();
          break;
        }

        const msg = { ...rawGMsg, user: dataUser, content: decContent, _dateLabel: getDateLabel(rawGMsg.timestamp) };
        const gmId = String((data as any).id);
        if (gmId && !gmId.startsWith("temp-") && seenMessageIds.current.has(gmId)) break;
        if (gmId && !gmId.startsWith("temp-")) { seenMessageIds.current.add(gmId); persistSeenIdsRef.current(); }
        updateActivityRef.current(String(data.group_id), msg.content, msg.timestamp);
        dbSaveMessage(msg, String(data.group_id)).catch(() => {});
        const groupIdStr = String(data.group_id);
        const groupExists = groupsRef.current.some(g => String(g.id) === groupIdStr);
        if (!groupExists) {
          loadGroupsRef.current();
        }
        const isInGroupChat = activeChatRef.current?.type === "group" && String(activeChatRef.current.id) === String(data.group_id);
        lastReplacedTempRef.current = null;
        updateMsgCache(String(data.group_id), prev => {
          if (dataUser === me) {
            const cleanContent = (msg.content || "").trim();
            const msgTime = parseTs(msg.timestamp).getTime();
            const idx = prev.findIndex(m => {
              const mId = String(m.id);
              if (!mId.startsWith("temp-")) return false;
              if ((m.content || "").trim() === cleanContent) return true;
              return Math.abs(parseTs(m.timestamp).getTime() - msgTime) < 60000;
            });
            if (idx !== -1) {
              const oldTempId = String(prev[idx].id);
              lastReplacedTempRef.current = oldTempId;
              dbDeleteMessage(oldTempId).catch(() => {});
              const next = [...prev];
              next[idx] = msg;
              return next;
            }
            if (!prev.find(m => String(m.id) === String(msg.id))) return [...prev, msg];
            return prev;
          }
          if (!prev.find(m => String(m.id) === String(msg.id))) return [...prev, msg];
          return prev;
        });

        if (isInGroupChat) {
          const replacedId = lastReplacedTempRef.current;
          if (replacedId) { const t = pendingTempTimers.current.get(replacedId); if (t) { clearTimeout(t); pendingTempTimers.current.delete(replacedId); } setFailedMsgIds(prev => { const n = new Set(prev); n.delete(replacedId); return n; }); }
          setTimeout(() => scrollBottomRef.current?.(), 50);
        } else {
          if (dataUser !== me) {
            setUnread(prev => ({ ...prev, [String(data.group_id)]: (prev[String(data.group_id)] || 0) + 1 }));
            notifyRef.current(`${data.group_name || "Group"}`, `${data.sender_name || "Someone"}: ${formatNotificationMedia(msg.content)}`, String(data.group_id));
          }
        }
        break;
      }

      case "reaction": {
        const targetMid = String(data.message_id);
        const resolvedReactions = (data.reactions && typeof data.reactions === "object") ? (data.reactions as Record<string, string[]>) : null;
        setMessages(prev => {
          const next = prev.map(m => {
            if (String(m.id) !== targetMid) return m;
            if (resolvedReactions) return { ...m, reactions: resolvedReactions };
            if (data.user && data.emoji) return { ...m, reactions: updateReactionsForUser(m.reactions, String(data.user), String(data.emoji)) };
            return m;
          });
          if (activeChatRef.current) {
            const cacheKey = activeChatRef.current.type === "user" ? String(activeChatRef.current.id).toLowerCase() : String(activeChatRef.current.id);
            messagesCacheRef.current[cacheKey] = next;
          }
          return next;
        });

        // Also update all message caches in background
        Object.keys(messagesCacheRef.current).forEach(ck => {
          const list = messagesCacheRef.current[ck];
          if (list && list.some(m => String(m.id) === targetMid)) {
            messagesCacheRef.current[ck] = list.map(m => {
              if (String(m.id) !== targetMid) return m;
              if (resolvedReactions) return { ...m, reactions: resolvedReactions };
              if (data.user && data.emoji) return { ...m, reactions: updateReactionsForUser(m.reactions, String(data.user), String(data.emoji)) };
              return m;
            });
          }
        });
        break;
      }

      case "read_receipt":
        setMessages(prev => {
          const next = prev.map(m => {
            if (String(m.user).toLowerCase() !== me) return m;
            if (data.group_id && m.group_id === data.group_id) {
              const rb = m.read_by || [];
              const dataUserLower = String(data.user).toLowerCase();
              if (!rb.includes(dataUserLower)) return { ...m, is_read: true, read_by: [...rb, dataUserLower] };
            } else if (!data.group_id && !m.group_id) return { ...m, is_read: true };
            return m;
          });
          if (activeChatRef.current) {
            const cacheKey = activeChatRef.current.type === "user" ? String(activeChatRef.current.id).toLowerCase() : String(activeChatRef.current.id);
            messagesCacheRef.current[cacheKey] = next;
          }
          return next;
        });
        break;

      case "message_edited": {
        const rawMsg = data as Message;
        const chatType = data.group_id ? "group" : "user";
        const msgUser = String(data.user).toLowerCase();
        const peerEmail = chatType === "user" 
          ? (msgUser === me ? String(data.receiver_email || data.target_user).toLowerCase() : msgUser) 
          : msgUser;
        const decContent = await decryptContentRef.current(rawMsg.content, chatType, peerEmail, data.group_id ? String(data.group_id) : undefined);
        const targetChatId = data.group_id ? String(data.group_id) : peerEmail;
        setMessages(prev => {
          const next = prev.map(m => String(m.id) === String(data.id) ? { ...m, content: decContent, edited_at: data.edited_at as string, _dateLabel: getDateLabel(m.timestamp) } : m);
          messagesCacheRef.current[targetChatId] = next;
          return next;
        });
        break;
      }

      case "message_deleted":
      case "message_deleted_for_all": {
        const delBy = (data as any).deleted_by;
        const delByName = (data as any).deleted_by_name;
        const mid = String(data.id || (data as any).message_id);
        const targetChatId = data.group_id 
          ? String(data.group_id) 
          : (activeChatRef.current ? String(activeChatRef.current.id).toLowerCase() : "");

        dbUpdateMessage(mid, {
          is_deleted: true,
          deleted_by: delBy,
          deleted_by_name: delByName,
          content: "",
        }).catch(() => {});

        setMessages(prev => {
          const next = prev.map(m => String(m.id) === mid ? {
            ...m,
            is_deleted: true,
            deleted_by: delBy,
            deleted_by_name: delByName,
            content: "",
          } : m);
          if (targetChatId) messagesCacheRef.current[targetChatId] = next;
          return next;
        });
        break;
      }

      case "presence": {
        const presenceUser = String(data.user || "").toLowerCase();
        setContacts(prev => prev.map(c => c.email === presenceUser ? { ...c, is_online: Boolean(data.online) } : c));
        break;
      }

      case "profile_updated": {
        const updatedUser = String(data.user || "").toLowerCase();
        const newAvatar = data.avatar_url ? String(data.avatar_url) : undefined;
        const newName = data.display_name ? String(data.display_name) : undefined;
        if (updatedUser) {
          setContacts(prev => prev.map(c => {
            if (c.email.toLowerCase() === updatedUser) {
              return {
                ...c,
                ...(newAvatar !== undefined ? { avatar_url: newAvatar } : {}),
                ...(newName !== undefined ? { display_name: newName } : {}),
              };
            }
            return c;
          }));
        }
        break;
      }

      case "call_offer": {
        const callerEmail = String(data.user || "").toLowerCase();
        if (blockedUsersRef.current.has(callerEmail)) {
          if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify({ type: "call_reject", target_user: callerEmail }));
          break;
        }
        const vid = Boolean(data.isVideo);
        const sdpObj = (data.sdp && typeof data.sdp === "object") ? data.sdp as any : {};
        const isMesh = Boolean(data.is_mesh || sdpObj.is_mesh);
        const offerGroupId = data.group_id || sdpObj.group_id;
        const offerSenderName = data.sender_name || sdpObj.sender_name;
        const normalizedOfferSdp = normalizeSdp(data.sdp);

        if (isMesh) {
          if (callStateRef.current === "connected" && normalizedOfferSdp) {
            if (!pcMapRef.current.has(callerEmail)) {
              try {
                const meshPc = await setupWebRTCRef.current(callerEmail);
                await meshPc.setRemoteDescription(new RTCSessionDescription(normalizedOfferSdp));
                const queue = iceQueuesRef.current.get(callerEmail) || [];
                while (queue.length > 0) { const c = queue.shift(); if (c) await meshPc.addIceCandidate(new RTCIceCandidate(c)).catch(console.error); }
                iceQueuesRef.current.set(callerEmail, queue);
                const meshAnswer = await meshPc.createAnswer();
                await meshPc.setLocalDescription(meshAnswer);
                wsSendRef.current(JSON.stringify({ type: "call_answer", target_user: callerEmail, sdp: meshAnswer }));
              } catch { }
            }
          } else if (normalizedOfferSdp) {
            pendingMeshOffersRef.current.set(callerEmail, normalizedOfferSdp);
          }
          break;
        }

        iceCandidateQueueRef.current = [];
        // Preserve early ICE candidates that arrived for callerEmail; do not clear iceQueuesRef!
        if (callStateRef.current === "idle") pendingMeshOffersRef.current.clear();
        if (offerGroupId) callGroupIdRef.current = offerGroupId as string | number;

        const existingContact = contactsRef.current.find(c => c.email === callerEmail);
        const callerDisplayName = String(offerSenderName || "").trim() || (existingContact ? contactLabelFnRef.current(existingContact) : "") || callerEmail.split("@")[0] || "Incoming Call";
        const offerPayload: StoredCallOffer = { sdp: (normalizedOfferSdp || data.sdp) as any, peer: callerEmail, peerName: callerDisplayName, isVideo: vid, ts: Date.now(), group_id: offerGroupId as string | number };

        try { sessionStorage.setItem("_Flux_call_offer", JSON.stringify(offerPayload)); } catch { }
        setCallPeer(callerEmail); setCallPeerName(callerDisplayName);
        callPeerRef.current = callerEmail; callPeerNameRef.current = callerDisplayName;
        setIsVideoCall(vid); isVideoCallRef.current = vid;
        updateCallStateRef.current("incoming"); callDirectionRef.current = "incoming";
        pendingRemoteDescriptionRef.current = normalizedOfferSdp;
        startRingtoneRef.current();
        notifyCallRef.current(vid ? "📹 Incoming Video Call" : "📞 Incoming Voice Call", `${callerDisplayName} is calling…`);

        if (!existingContact?.display_name) {
          apiFetchRef.current<Contact>(`/profile/${encodeURIComponent(callerEmail)}`).then(prof => {
            const richName = prof.display_name || (prof.username ? `@${prof.username}` : "") || callerDisplayName;
            setCallPeerName(richName);
            try { sessionStorage.setItem("_Flux_call_offer", JSON.stringify({ ...offerPayload, peerName: richName })); } catch { }
          }).catch(() => { });
        }
        break;
      }

      case "call_answer": {
        const peer = String(data.user).toLowerCase();
        const pc = pcMapRef.current.get(peer) || peerConnectionRef.current;
        const normalizedAnswerSdp = normalizeSdp(data.sdp);
        if (pc && normalizedAnswerSdp) {
          await pc.setRemoteDescription(new RTCSessionDescription(normalizedAnswerSdp));
          updateCallStateRef.current("connected"); callStartTimeRef.current = Date.now();
          const queue = iceQueuesRef.current.get(peer) || [];
          while (queue.length > 0) { const c = queue.shift(); if (c) await pc.addIceCandidate(new RTCIceCandidate(c)).catch(console.error); }
          iceQueuesRef.current.set(peer, queue);

          // Full mesh auto-cross-connection for group calls
          const gid = callGroupIdRef.current;
          if (gid) {
            pcMapRef.current.forEach((_, existingPeer) => {
              const ep = existingPeer.toLowerCase();
              if (ep !== peer && ep !== me) {
                wsSendRef.current(JSON.stringify({
                  type: "mesh_connect_peer",
                  target_user: ep,
                  peer: peer,
                  group_id: gid,
                }));
                wsSendRef.current(JSON.stringify({
                  type: "mesh_connect_peer",
                  target_user: peer,
                  peer: ep,
                  group_id: gid,
                }));
              }
            });
          }
        }
        break;
      }

      case "mesh_connect_peer": {
        const newPeer = String(data.peer || "").toLowerCase().trim();
        const gid = data.group_id;
        if (!newPeer || newPeer === me) break;
        if (callStateRef.current !== "connected") break;
        if (!pcMapRef.current.has(newPeer)) {
          if (me > newPeer) {
            try {
              const meshPc = await setupWebRTCRef.current(newPeer);
              const meshOffer = await meshPc.createOffer();
              await meshPc.setLocalDescription(meshOffer);
              wsSendRef.current(JSON.stringify({
                type: "call_offer",
                target_user: newPeer,
                sdp: {
                  type: meshOffer.type,
                  sdp: meshOffer.sdp,
                  is_mesh: true,
                  group_id: gid,
                  sender_name: profile.displayName || profile.username || me,
                },
                isVideo: isVideoCallRef.current,
                is_mesh: true,
                group_id: gid,
              }));
            } catch (e) {
              console.error("Failed to initiate mesh connection to peer:", e);
            }
          }
        }
        break;
      }

      case "ice_candidate": {
        const peer = String(data.user).toLowerCase();
        const pc = pcMapRef.current.get(peer) || peerConnectionRef.current;
        if (pc && pc.remoteDescription) {
          await pc.addIceCandidate(new RTCIceCandidate(data.candidate as RTCIceCandidateInit)).catch(console.error);
        } else {
          const queue = iceQueuesRef.current.get(peer) || [];
          queue.push(data.candidate as RTCIceCandidateInit);
          iceQueuesRef.current.set(peer, queue);
        }
        break;
      }

      case "camera_state": {
        const u = String(data.user || "").toLowerCase();
        setRemoteVideoMuted(data.videoMuted === true);
        if (u) setCameraStates(prev => ({ ...prev, [u]: data.videoMuted === true }));
        break;
      }

      case "call_end": {
        const leavingPeer = String(data.user || "").toLowerCase();
        const inGroupCall = !!callGroupIdRef.current;
        if (inGroupCall && pcMapRef.current.has(leavingPeer)) {
          removePeerFromCallRef.current(leavingPeer);
        } else if (inGroupCall && pcMapRef.current.size > 0) {
          setRemoteStreams(prev => { const next = { ...prev }; delete next[leavingPeer]; return next; });
        } else {
          endCallRef.current(false);
        }
        break;
      }

      case "call_reject": {
        const rejectingPeer = String(data.user || "").toLowerCase();
        if (callGroupIdRef.current && pcMapRef.current.size > 1) removePeerFromCallRef.current(rejectingPeer);
        else endCallRef.current(false, "rejected");
        break;
      }
    }
  }, []);

  useEffect(() => { wsHandlerRef.current = wsHandler; }, [wsHandler]);
  initWSRef.current = initWS;

  // ── APP INIT ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    // Preload all cached conversation messages from IndexedDB into RAM at startup for instant 0ms chat opening
    dbPreloadRecentMessages().then(loaded => {
      if (loaded && Object.keys(loaded).length > 0) {
        messagesCacheRef.current = { ...loaded, ...messagesCacheRef.current };
      }
    }).catch(() => {});

    const initAuth = async () => {
      let authenticated = false;
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.access_token) {
          try {
            const res = await apiFetch<{ access_token: string; user: any }>("/auth/login", { method: "POST", body: JSON.stringify({ id_token: session.access_token }) });
            _finalizeAuth(res.access_token, res.user.email);
            authenticated = true;
          } catch (fetchErr) {
            console.warn("Auth login fetch failed, trying offline fallback:", fetchErr);
          }
        }

        if (!authenticated) {
          const savedToken = localStorage.getItem("flux_backend_token");
          const savedUser = localStorage.getItem("chat_user");
          if (savedToken && savedUser) {
            setToken(savedToken);
            setCurrentUser(savedUser);
            setWsStatus("offline");
            getOrCreateIdentityKeyPair(savedUser).then(({ privateKey, publicKeyB64 }) => {
              e2ePrivKeyRef.current = privateKey;
              e2ePubKeyB64Ref.current = publicKeyB64;
            }).catch(() => { });
            showToast("Offline mode. Loading cached messages.", "info");
          }
        }
      } catch (err) {
        console.warn("Auth initialization failed:", err);
      } finally {
        setIsMounted(true);
        (window as any).__FluxReady = true;
        if (typeof window !== "undefined") {
          const urlParams = new URLSearchParams(window.location.search);
          const webOpenChatId = urlParams.get("openChat");
          if (webOpenChatId) {
            try {
              const cleanUrl = window.location.protocol + "//" + window.location.host + window.location.pathname;
              window.history.replaceState({ path: cleanUrl }, "", cleanUrl);
            } catch { }
            setTimeout(() => {
              openChatByChatIdRef.current?.(webOpenChatId);
            }, 800);
          } else {
            const savedChat = safeParseJSON<Chat | null>(localStorage.getItem("cached_active_chat"), null);
            if (savedChat) {
              setTimeout(() => {
                openChatRef.current?.(savedChat);
              }, 500);
            }
          }
        }
      }
    };
    initAuth();
  }, [apiFetch, showToast]); // eslint-disable-line



  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    const handleSwMessage = (event: MessageEvent) => {
      if (event.data?.type === "NOTIFICATION_CLICK") {
        const chatId = event.data?.data?.chatId;
        if (chatId) {
          setTimeout(() => {
            openChatByChatIdRef.current(String(chatId));
          }, 300);
        }
      }
    };
    navigator.serviceWorker.addEventListener("message", handleSwMessage);
    return () => navigator.serviceWorker.removeEventListener("message", handleSwMessage);
  }, []);

  useEffect(() => {
    if (token) {
      (async () => {
        loadProfile().catch(() => {});
        loadContacts().catch(() => {});
        loadGroups().catch(() => {});
        wsRetryDelay.current = 800; wsRetryCount.current = 0;
        initWS();
        _registerFCMToken(token);
      })();
    }
    return () => {
      if (wsPingInterval.current) clearInterval(wsPingInterval.current);
      if (wsRef.current) { wsRef.current.onclose = null; wsRef.current.close(); }
    };
  }, [token]); // eslint-disable-line

  // ── DOWNLOAD MEDIA ────────────────────────────────────────────────────────────
  const handleDownloadMedia = async (url: string, filename?: string, mediaTypeHint?: string) => {
    try {
      const res = await fetch(url, { mode: "cors" }).catch(() => fetch(url));
      const blob = await res.blob();
      const buffer = await blob.arrayBuffer();
      const bytes = new Uint8Array(buffer.slice(0, 16));

      // Sniff exact MIME type & extension from magic bytes
      let mime = blob.type;
      let ext = "jpg";

      if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) {
        mime = "image/jpeg"; ext = "jpg";
      } else if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) {
        mime = "image/png"; ext = "png";
      } else if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
        mime = "image/gif"; ext = "gif";
      } else if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
                 bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
        mime = "image/webp"; ext = "webp";
      } else if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
        mime = "application/pdf"; ext = "pdf";
      } else if (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
        mime = "video/mp4"; ext = "mp4";
      } else if ((bytes[0] === 0x49 && bytes[1] === 0x33) || (bytes[0] === 0xFF && (bytes[1] & 0xE0) === 0xE0)) {
        mime = "audio/mpeg"; ext = "mp3";
      } else if (mediaTypeHint === "video") {
        mime = "video/mp4"; ext = "mp4";
      } else if (mediaTypeHint === "pdf") {
        mime = "application/pdf"; ext = "pdf";
      } else if (mediaTypeHint === "audio") {
        mime = "audio/mpeg"; ext = "mp3";
      } else if (blob.type && blob.type.includes("/")) {
        mime = blob.type;
        const sub = mime.split("/")[1]?.split(";")[0]?.toLowerCase();
        if (sub && sub !== "octet-stream" && sub !== "binary") {
          ext = sub === "jpeg" ? "jpg" : sub === "quicktime" ? "mov" : sub;
        }
      }

      const isImgOrVid = ext === "jpg" || ext === "png" || ext === "webp" || ext === "gif" || ext === "mp4" || ext === "mov" ||
                        mime.startsWith("image/") || mime.startsWith("video/");

      const cleanTimestamp = new Date().toISOString().replace(/[-:T.]/g, "").slice(0, 14);
      const name = filename || `Flux_${cleanTimestamp}.${ext}`;

      const nativeBridge = typeof window !== "undefined" ? (window as any).FluxNativeBridge : null;
      if (nativeBridge) {
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64data = reader.result as string;
          if (saveToGalleryPref && isImgOrVid && typeof nativeBridge.saveMediaToGallery === "function") {
            const success = nativeBridge.saveMediaToGallery(base64data, name, mime);
            if (success) {
              showToast("Successfully saved", "success");
              return;
            }
          }
          if (typeof nativeBridge.saveMediaToDownloads === "function") {
            const success = nativeBridge.saveMediaToDownloads(base64data, name, mime);
            if (success) {
              showToast("Successfully saved", "success");
              return;
            }
          }
          showToast("Successfully saved", "success");
        };
        reader.readAsDataURL(blob);
        return;
      }

      if (isNative()) {
        const reader = new FileReader();
        reader.onloadend = async () => {
          try {
            const base64data = (reader.result as string).split(",")[1] || (reader.result as string);
            await Filesystem.writeFile({
              path: `Flux/${name}`,
              data: base64data,
              directory: Directory.Documents,
              recursive: true,
            });
            showToast("Successfully saved", "success");
          } catch {
            showToast("Download failed", "error");
          }
        };
        reader.readAsDataURL(blob);
        return;
      }

      const blobUrl = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement("a"), { href: blobUrl, download: name });
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
      showToast("Successfully saved", "success");
    } catch (err) {
      console.warn("handleDownloadMedia error, fallback to window.open:", err);
      window.open(url, "_blank");
    }
  };

  // ── SEND MESSAGE ──────────────────────────────────────────────────────────────
  const sendMessage = async () => {
    if (isUploadingAttachment) return;
    triggerHaptic(ImpactStyle.Light);
    const text = useChatStore.getState().inputMsg.trim();
    if (!text && pendingFiles.length === 0 && !pendingFile) return;
    if (!activeChat) return;

    if (pendingFiles.length > 0 || pendingFile) {
      const filesToUpload = pendingFile ? [{ ...pendingFile, caption: "" }, ...pendingFiles] : [...pendingFiles];
      const captionText = text;
      setPendingFiles([]);
      setPendingFile(null);
      useChatStore.getState().setInputMsg("");
      setIsUploadingAttachment(true);
      try {
        for (let i = 0; i < filesToUpload.length; i++) {
          const item = filesToUpload[i];
          setMultiUploadProgress({ current: i + 1, total: filesToUpload.length });
          
          let cleanBlob: Blob = item.file;
          if (item.type === "image" && item.file instanceof File) {
            try {
              const compressed = await compressImage(item.file, 1600, 0.85);
              if (compressed.startsWith("data:")) {
                cleanBlob = await (await fetch(compressed)).blob();
              }
            } catch (e) {
              console.warn("Client pre-compression fallback:", e);
            }
          }

          // ── OPTIMISTIC MEDIA RENDERING (Item 5) ──
          // Create instant local preview blob URL and display message immediately in chat with sending status
          const localPreviewUrl = URL.createObjectURL(cleanBlob);
          const optimisticPrefix = item.type === "image" ? "IMAGE" : item.type === "audio" ? "AUDIO" : item.type === "video" ? "VIDEO" : item.type === "pdf" ? "PDF" : "FILE";
          const optimisticTag = (i === filesToUpload.length - 1 && captionText) ? `[${optimisticPrefix}]${localPreviewUrl}\n${captionText}` : `[${optimisticPrefix}]${localPreviewUrl}`;
          const { type: chatType, id } = activeChat;
          const chatIdKey = chatType === "user" ? String(id).toLowerCase() : String(id);
          const tempId = `temp-media-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`;
          const ts = new Date().toISOString();
          const optimisticMsg: Message = {
            id: tempId,
            user: currentUser,
            content: optimisticTag,
            timestamp: ts,
            _dateLabel: getDateLabel(ts),
            ...(chatType === "user" ? { target_user: String(id) } : { group_id: id, group_name: activeChat.name }),
            ...(replyingTo ? {
              reply_to_id: replyingTo.id,
              reply_to_content: replyingTo.content,
              reply_to_user: replyingTo.user,
              reply_to: {
                id: replyingTo.id,
                user: replyingTo.user,
                content: replyingTo.content,
                sender_name: replyingTo.sender_name || replyingTo.user,
              },
            } : {})
          };

          // Cache in memory for instant local view
          await cacheSentMediaLocally(localPreviewUrl, cleanBlob, cleanBlob.type || item.file.type);

          setMessages(prev => { const next = [...prev, optimisticMsg]; messagesCacheRef.current[chatIdKey] = next; return next; });
          updateActivity(id, optimisticTag, optimisticMsg.timestamp);
          setTimeout(scrollBottom, 50);

          let mediaUrl = "";
          let keyB64 = "";
          let ivB64 = "";
          let mimeType = cleanBlob.type || "application/octet-stream";
          let origFileName = item.file instanceof File ? item.file.name : "attachment";

          try {
            const encRes = await encryptMediaBlob(cleanBlob, origFileName);
            keyB64 = encRes.keyB64;
            ivB64 = encRes.ivB64;
            mimeType = encRes.mimeType;
            const encryptedFile = new File([encRes.encryptedBlob], encRes.fileName, { type: "application/octet-stream" });
            const uploadRes = await uploadMediaToBackend(encryptedFile, token, encRes.fileName);
            mediaUrl = uploadRes.url;

            // Save clean decrypted file into sender's local persistent storage (WhatsApp model)
            await cacheSentMediaLocally(mediaUrl, cleanBlob, mimeType);
          } catch (e) {
            console.warn("Encrypted media upload fallback:", e);
            const uploadRes = await uploadMediaToBackend(cleanBlob as File, token, origFileName);
            mediaUrl = uploadRes.url;
            await cacheSentMediaLocally(mediaUrl, cleanBlob, mimeType);
          }

          const prefix = item.type === "image" ? "ENC_IMAGE" : item.type === "audio" ? "ENC_AUDIO" : item.type === "video" ? "ENC_VIDEO" : item.type === "pdf" ? "ENC_PDF" : "ENC_FILE";
          const baseTag = keyB64 
            ? `[${prefix}]${mediaUrl}|${keyB64}|${ivB64}|${encodeURIComponent(mimeType)}|${encodeURIComponent(origFileName)}`
            : (item.type === "image" ? `[IMAGE]${mediaUrl}` : item.type === "audio" ? `[AUDIO]${mediaUrl}` : item.type === "video" ? `[VIDEO]${mediaUrl}` : item.type === "pdf" ? `[PDF]${mediaUrl}` : `[FILE]${mediaUrl}`);
          const tag = (i === filesToUpload.length - 1 && captionText) ? `${baseTag}\n${captionText}` : baseTag;

          // Replace optimistic content with final uploaded tag
          setMessages(prev => {
            const next = prev.map(m => m.id === tempId ? { ...m, content: tag } : m);
            messagesCacheRef.current[chatIdKey] = next;
            return next;
          });
          dbSaveMessage({ ...optimisticMsg, content: tag }, chatIdKey).catch(() => {});
          updateActivity(id, tag, optimisticMsg.timestamp);

          let contentToSend = tag;
          try {
            if (chatType === "user" && e2ePrivKeyRef.current) {
              const theirPub = await getPeerPubKey(String(id));
              if (theirPub) contentToSend = await encryptDM(tag, e2ePrivKeyRef.current, theirPub);
            } else if (chatType === "group" && e2ePrivKeyRef.current) {
              const groupKey = await getGroupKey(id);
              if (groupKey) contentToSend = await encryptGroupMsg(tag, groupKey);
            }
          } catch { }
          wsSend(JSON.stringify({
            type: chatType === "user" ? "direct_message" : "group_message",
            content: contentToSend,
            message_type: item.type,
            ...(chatType === "user" ? { target_user: id } : { group_id: id }),
            ...(replyingTo ? {
              reply_to_id: replyingTo.id,
              reply_to_content: replyingTo.content,
              reply_to_user: replyingTo.user,
            } : {})
          }));
        }
      } catch (err: any) {
        showToast("Media upload failed: " + (err?.message || "Error"), "error");
      } finally {
        setIsUploadingAttachment(false);
        setMultiUploadProgress(null);
        setReplyingTo(null);
      }
      return;
    }

    useChatStore.getState().setInputMsg(""); setShowEmojis(false);
    const { type, id } = activeChat;
    const chatIdKey = type === "user" ? String(id).toLowerCase() : String(id);
    const tempId = `temp-${Date.now()}-${Math.random()}`;
    const ts = new Date().toISOString();
    const currentReply = replyingTo;
    setReplyingTo(null);

    const replyPayload = currentReply ? {
      reply_to_id: currentReply.id,
      reply_to_content: currentReply.content,
      reply_to_user: currentReply.user,
      reply_to: {
        id: currentReply.id,
        user: currentReply.user,
        content: currentReply.content,
        sender_name: currentReply.sender_name || currentReply.user,
      },
    } : {};

    const optimisticMsg: Message = {
      id: tempId,
      user: currentUser,
      content: text,
      timestamp: ts,
      _dateLabel: getDateLabel(ts),
      ...(type === "user" ? { target_user: String(id) } : { group_id: id, group_name: activeChat.name }),
      ...replyPayload,
    };
    setMessages(prev => { const next = [...prev, optimisticMsg]; messagesCacheRef.current[chatIdKey] = next; return next; });
    dbSaveMessage(optimisticMsg, chatIdKey).catch(() => {});
    updateActivity(id, text, optimisticMsg.timestamp);
    setTimeout(scrollBottom, 50);
    const failTimer = setTimeout(() => { setFailedMsgIds(prev => new Set(prev).add(tempId)); pendingTempTimers.current.delete(tempId); }, 60000);
    pendingTempTimers.current.set(tempId, failTimer);

    const basePayload = {
      type: type === "user" ? "direct_message" : "group_message",
      message_type: "text",
      ...(type === "user" ? { target_user: id } : { group_id: id }),
      ...(currentReply ? {
        reply_to_id: currentReply.id,
        reply_to_content: currentReply.content,
        reply_to_user: currentReply.user,
      } : {}),
    };
    (async () => {
      let contentToSend = text;
      try {
        if (type === "user" && e2ePrivKeyRef.current) {
          const theirPub = await getPeerPubKey(String(id));
          if (theirPub) contentToSend = await encryptDM(text, e2ePrivKeyRef.current, theirPub);
        } else if (type === "group" && e2ePrivKeyRef.current) {
          const groupKey = await getGroupKey(id);
          if (groupKey) contentToSend = await encryptGroupMsg(text, groupKey);
        }
      } catch { }
      wsSend(JSON.stringify({ ...basePayload, content: contentToSend }));
    })();
  };

  const sendSticker = useCallback(async (url: string) => {
    if (!activeChat) return;
    setShowStickers(false);
    const content = `[STICKER]${url}`;
    const { type, id } = activeChat;
    const chatIdKey = type === "user" ? String(id).toLowerCase() : String(id);
    const tempId = `temp-${Date.now()}-${Math.random()}`;
    const ts = new Date().toISOString();
    const optimisticMsg: Message = { id: tempId, user: currentUser, content, timestamp: ts, _dateLabel: getDateLabel(ts), ...(type === "user" ? { target_user: String(id) } : { group_id: id, group_name: activeChat.name }) };
    setMessages(prev => { const next = [...prev, optimisticMsg]; messagesCacheRef.current[chatIdKey] = next; return next; });
    dbSaveMessage(optimisticMsg, chatIdKey).catch(() => {});
    updateActivity(id, content, optimisticMsg.timestamp);
    setTimeout(scrollBottom, 50);
    let contentToSend = content;
    try {
      if (type === "user" && e2ePrivKeyRef.current) {
        const theirPub = await getPeerPubKey(String(id));
        if (theirPub) contentToSend = await encryptDM(content, e2ePrivKeyRef.current, theirPub);
      } else if (type === "group" && e2ePrivKeyRef.current) {
        const groupKey = await getGroupKey(id);
        if (groupKey) contentToSend = await encryptGroupMsg(content, groupKey);
      }
    } catch { }
    wsSend(JSON.stringify({ type: type === "user" ? "direct_message" : "group_message", content: contentToSend, message_type: "sticker", ...(type === "user" ? { target_user: id } : { group_id: id }) }));
  }, [activeChat, currentUser, wsSend, updateActivity, scrollBottom]);



  const handleMultiForward = async () => {
    if (forwardingMsgs.length === 0 || forwardSelectedTargets.length === 0) return;
    const targets = [...forwardSelectedTargets];
    const msgs = [...forwardingMsgs];
    setForwardSelectedTargets([]);
    setShowForwardPicker(false);
    try {
      for (const target of targets) {
        const { type, id, name } = target;
        for (const msg of msgs) {
          const tempId = `temp-${Date.now()}-${Math.random()}`;
          const ts = new Date().toISOString();
          const optimisticMsg: Message = { id: tempId, user: currentUser, content: msg.content, timestamp: ts, _dateLabel: getDateLabel(ts), is_forwarded: true, forwarded_from_id: msg.id, ...(type === "user" ? { target_user: String(id) } : { group_id: id, group_name: name }) };
          if (activeChatRef.current && String(activeChatRef.current.id) === String(id)) {
            setMessages(prev => { const next = [...prev, optimisticMsg]; messagesCacheRef.current[String(id)] = next; return next; });
            setTimeout(scrollBottom, 50);
          }
          updateActivity(id, msg.content, optimisticMsg.timestamp);
          let contentToSend = msg.content;
          try {
            if (type === "user" && e2ePrivKeyRef.current) {
              const theirPub = await getPeerPubKey(String(id));
              if (theirPub) contentToSend = await encryptDM(msg.content, e2ePrivKeyRef.current, theirPub);
            } else if (type === "group" && e2ePrivKeyRef.current) {
              const groupKey = await getGroupKey(id);
              if (groupKey) contentToSend = await encryptGroupMsg(msg.content, groupKey);
            }
          } catch { }
          wsSend(JSON.stringify({ type: type === "user" ? "direct_message" : "group_message", content: contentToSend, message_type: msg.content.startsWith("[IMAGE]") ? "image" : msg.content.startsWith("[AUDIO]") ? "audio" : msg.content.startsWith("[VIDEO]") ? "video" : "text", is_forwarded: true, forwarded_from_id: msg.id, ...(type === "user" ? { target_user: id } : { group_id: id }) }));
        }
      }
      showToast(`Forwarded to ${targets.length} chats`, "success");
    } catch { showToast("Forwarding failed", "error"); }
    finally { setForwardingMsgs([]); }
  };

  const toggleForwardTarget = (target: { type: "user" | "group"; id: string | number; name: string }) => {
    setForwardSelectedTargets(prev => {
      const exists = prev.some(t => String(t.id) === String(target.id));
      if (exists) return prev.filter(t => String(t.id) !== String(target.id));
      return [...prev, target];
    });
  };

  const retryMessage = useCallback(async (msg: Message) => {
    if (!activeChat) return;
    const tid = String(msg.id);
    setFailedMsgIds(prev => { const n = new Set(prev); n.delete(tid); return n; });
    const existing = pendingTempTimers.current.get(tid);
    if (existing) { clearTimeout(existing); pendingTempTimers.current.delete(tid); }
    const ts = new Date().toISOString();
    const newTempId = `temp-${Date.now()}-${Math.random()}`;
    const newTemp: Message = { ...msg, id: newTempId, timestamp: ts, _dateLabel: getDateLabel(ts) };
    setMessages(prev => { const next = prev.map(m => String(m.id) === tid ? newTemp : m); messagesCacheRef.current[String(activeChat.id)] = next; return next; });
    const failTimer = setTimeout(() => { setFailedMsgIds(prev => new Set(prev).add(newTempId)); pendingTempTimers.current.delete(newTempId); }, 30000);
    pendingTempTimers.current.set(newTempId, failTimer);
    const { type, id } = activeChat;
    (async () => {
      let contentToSend = msg.content;
      try {
        if (type === "user" && e2ePrivKeyRef.current) { const theirPub = await getPeerPubKey(String(id)); if (theirPub) contentToSend = await encryptDM(msg.content, e2ePrivKeyRef.current, theirPub); }
        else if (type === "group" && e2ePrivKeyRef.current) { const groupKey = await getGroupKey(id); if (groupKey) contentToSend = await encryptGroupMsg(msg.content, groupKey); }
      } catch { }
      wsSend(JSON.stringify({ type: type === "user" ? "direct_message" : "group_message", message_type: "text", content: contentToSend, ...(type === "user" ? { target_user: id } : { group_id: id }) }));
    })();
  }, [activeChat, wsSend, getPeerPubKey, getGroupKey]);

  const sendReaction = useCallback((msgId: string | number, emoji: string) => {
    if (!activeChat) return;
    if (navigator.vibrate) navigator.vibrate(20);
    setReactionPickerId(null); setSelectedMsgId(null);
    const chatIdKey = activeChat.type === "user" ? String(activeChat.id).toLowerCase() : String(activeChat.id);
    const commonPayload = activeChat.type === "user" ? { target_user: chatIdKey } : { group_id: activeChat.id };
    
    const targetMsg = messages.find(m => String(m.id) === String(msgId));
    const effectiveId = targetMsg ? targetMsg.id : msgId;

    if (!String(effectiveId).startsWith("temp-")) {
      wsSend(JSON.stringify({ type: "reaction", message_id: effectiveId, emoji, ...commonPayload }));
    }

    setMessages(prev => {
      const next = prev.map(m => (String(m.id) === String(msgId) || String(m.id) === String(effectiveId)) ? { ...m, reactions: updateReactionsForUser(m.reactions, currentUser, emoji) } : m);
      messagesCacheRef.current[chatIdKey] = next;
      return next;
    });
  }, [activeChat, wsSend, currentUser, messages]);

  const saveEdit = useCallback(async () => {
    if (!editingId || !activeChat) return;
    const { type, id } = activeChat;
    let contentToSend = editingText;
    try {
      if (type === "user" && e2ePrivKeyRef.current) { const theirPub = await getPeerPubKey(String(id)); if (theirPub) contentToSend = await encryptDM(editingText, e2ePrivKeyRef.current, theirPub); }
      else if (type === "group" && e2ePrivKeyRef.current) { const groupKey = await getGroupKey(id); if (groupKey) contentToSend = await encryptGroupMsg(editingText, groupKey); }
    } catch { }
    try {
      await apiFetch<void>(`/messages/${editingId}`, { method: "PATCH", body: JSON.stringify({ content: contentToSend }) });
      setMessages(prev => {
        const next = prev.map(m => m.id === editingId ? { ...m, content: editingText, edited_at: new Date().toISOString() } : m);
        messagesCacheRef.current[String(activeChat.id)] = next;
        return next;
      });
      setEditingId(null); setEditingText("");
    } catch { }
  }, [editingId, activeChat, editingText, apiFetch]);

  const deleteMsgEx = useCallback(async (id: string | number, forEveryone: boolean) => {
    if (String(id).startsWith("temp-")) {
      const tid = String(id);
      const t = pendingTempTimers.current.get(tid);
      if (t) { clearTimeout(t); pendingTempTimers.current.delete(tid); }
      setFailedMsgIds(prev => { const n = new Set(prev); n.delete(tid); return n; });
      setMessages(prev => { const next = prev.filter(m => String(m.id) !== tid); messagesCacheRef.current[String(activeChat?.id || "")] = next; return next; });
      return;
    }

    if (forEveryone) {
      if (String(id).startsWith("call-")) {
        const logId = String(id).replace("call-", "");
        try {
          await apiFetch<void>(`/call-logs/${logId}`, { method: "DELETE" });
        } catch (err) {
          console.error("Failed to delete call log from server:", err);
        }
        setCallLogs(prev => {
          const next = prev.filter(l => String(l.id) !== logId);
          try { idbSet("cached_call_logs", next.slice(0, 200)).catch(() => {}); } catch { }
          return next;
        });
        if (activeChat) {
          wsSend(JSON.stringify({
            type: activeChat.type === "user" ? "direct_message" : "group_message",
            message_type: "text",
            content: `[SYSTEM] delete_call_log:${logId}`,
            ...(activeChat.type === "user" ? { target_user: activeChat.id } : { group_id: activeChat.id })
          }));
        }
        return;
      }

      const curUser = currentUserRef.current || "";
      const curName = profile.displayName || profile.username || curUser;
      const targetChatId = activeChat ? (activeChat.type === "user" ? String(activeChat.id).toLowerCase() : String(activeChat.id)) : "";

      setMessages(prev => {
        const next = prev.map(m => String(m.id) === String(id) ? {
          ...m,
          is_deleted: true,
          deleted_by: curUser,
          deleted_by_name: curName,
          content: "",
        } : m);
        if (targetChatId) messagesCacheRef.current[targetChatId] = next;
        return next;
      });

      dbUpdateMessage(String(id), {
        is_deleted: true,
        deleted_by: curUser,
        deleted_by_name: curName,
        content: "",
      }).catch(() => {});

      try {
        await deleteMessageForEveryoneApi(id, token);
        if (activeChat) {
          wsSend(JSON.stringify({
            type: activeChat.type === "user" ? "direct_message" : "group_message",
            message_type: "text",
            content: `[SYSTEM] delete_message:${id}`,
            ...(activeChat.type === "user" ? { target_user: activeChat.id } : { group_id: activeChat.id })
          }));
        }
      } catch (err) {
        console.error("Failed to delete message for everyone on server:", err);
      }
    } else {
      // Delete for Me: INSTANT (<1ms) permanent deletion for self
      const sid = String(id);
      const targetChatId = activeChat ? (activeChat.type === "user" ? String(activeChat.id).toLowerCase() : String(activeChat.id)) : "";

      setMessages(prev => {
        const next = prev.filter(m => String(m.id) !== sid);
        if (targetChatId) messagesCacheRef.current[targetChatId] = next;
        return next;
      });

      dbDeleteMessage(sid).catch(() => {});

      setDeletedForMeIds(prev => {
        const next = new Set(prev);
        next.add(sid);
        if (currentUserRef.current) idbSet(`deleted_for_me_${currentUserRef.current}`, [...next]).catch(() => {});
        deletedForMeIdsRef.current = next;
        return next;
      });

      try {
        await deleteMessageForMeApi(id, token);
      } catch (err) {
        console.error("Failed to delete message for me on server:", err);
      }
    }
  }, [activeChat, apiFetch, wsSend, token, profile]);

  const promptDeleteMsgs = useCallback((msgs: Message[]) => {
    if (msgs.length === 0) return;
    setDeleteConfirm({
      selectedMsgs: msgs,
      onConfirm: async (forEveryone) => {
        for (const m of msgs) {
          await deleteMsgEx(m.id, forEveryone);
        }
        toggleSelectMsg(null);
      }
    });
  }, [deleteMsgEx, toggleSelectMsg]);

  const dataUrlToFile = (dataUrl: string, filename: string): File => {
    const arr = dataUrl.split(",");
    const mime = arr[0].match(/:(.*?);/)?.[1] || "image/jpeg";
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
      u8arr[n] = bstr.charCodeAt(n);
    }
    return new File([u8arr], filename, { type: mime });
  };

  const takeNativePhoto = useCallback(async () => {
    setShowCameraDrawer(false);
    setShowPlusDrawer(false);
    if (isNative()) {
      try {
        const photo = await Camera.getPhoto({
          quality: 90,
          allowEditing: false,
          resultType: CameraResultType.Uri,
          source: CameraSource.Camera,
        });
        if (photo && photo.webPath) {
          const res = await fetch(photo.webPath);
          const blob = await res.blob();
          const ext = photo.format || "jpg";
          const file = new File([blob], `camera_${Date.now()}.${ext}`, { type: `image/${ext === "png" ? "png" : "jpeg"}` });
          setPendingFiles(prev => [...prev, { file, url: photo.webPath!, type: "image", caption: "" }]);
          return;
        }
      } catch (err: any) {
        if (err?.message?.includes("User cancelled")) return;
        console.warn("Native camera capture fallback:", err);
      }
    }
    setShowLiveCamera(true);
  }, []);

  const pickNativeGallery = useCallback(async () => {
    setShowCameraDrawer(false);
    setShowPlusDrawer(false);
    if (isNative()) {
      try {
        const photo = await Camera.getPhoto({
          quality: 90,
          allowEditing: false,
          resultType: CameraResultType.Uri,
          source: CameraSource.Photos,
        });
        if (photo && photo.webPath) {
          const res = await fetch(photo.webPath);
          const blob = await res.blob();
          const ext = photo.format || "jpg";
          const file = new File([blob], `gallery_${Date.now()}.${ext}`, { type: `image/${ext === "png" ? "png" : "jpeg"}` });
          setPendingFiles(prev => [...prev, { file, url: photo.webPath!, type: "image", caption: "" }]);
          return;
        }
      } catch (err: any) {
        if (err?.message?.includes("User cancelled")) return;
        console.warn("Native gallery pick fallback:", err);
        fileInputRef.current?.click();
        return;
      }
    }
    fileInputRef.current?.click();
  }, []);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0 || !activeChat) return;
    const newPending: typeof pendingFiles = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (file.size > 500 * 1024 * 1024) {
        showToast(`"${file.name}" exceeds 500MB limit.`, "error");
        continue;
      }
      const url = URL.createObjectURL(file);
      const fileName = file.name || "";
      const isImg = file.type.startsWith("image") || /\.(jpe?g|png|webp|heic|heif|gif)$/i.test(fileName) || (file.type === "" && !fileName.includes("."));
      const isVid = file.type.startsWith("video") || /\.(mp4|webm|mov|3gp)$/i.test(fileName);
      const isAud = file.type.startsWith("audio") || /\.(mp3|ogg|wav|m4a|aac)$/i.test(fileName);
      const isPdfDoc = file.type === "application/pdf" || /\.pdf$/i.test(fileName);
      const type = isImg ? "image" : isVid ? "video" : isAud ? "audio" : isPdfDoc ? "pdf" : "file";
      newPending.push({ file, url, type, caption: "" });
    }
    setPendingFiles(prev => [...prev, ...newPending]);
    setShowCameraDrawer(false);
    setShowPlusDrawer(false);
    e.target.value = "";
  };

  const getMediaStream = async (constraints: MediaStreamConstraints): Promise<MediaStream> => {
    if (typeof navigator === "undefined") {
      throw new Error("Navigator is unavailable.");
    }
    if (typeof window !== "undefined") {
      try { (window as any).FluxNativeBridge?.requestCallPermissions?.(); } catch {}
    }
    const md = navigator.mediaDevices;
    if (md && typeof md.getUserMedia === "function") {
      // 1. Try requested constraints
      try {
        return await md.getUserMedia(constraints);
      } catch (err1) {
        console.warn("Primary getUserMedia failed, attempting flexible fallback:", err1);
      }

      // 2. If video was requested, try flexible user camera without rigid resolution constraints
      if (constraints.video) {
        try {
          return await md.getUserMedia({ audio: true, video: { facingMode: "user" } });
        } catch (err2) {
          console.warn("Flexible video getUserMedia failed:", err2);
        }
        try {
          return await md.getUserMedia({ audio: true, video: true });
        } catch (err3) {
          console.warn("Basic video getUserMedia failed:", err3);
        }
      }

      // 3. Fallback to clean audio-only if video failed
      try {
        return await md.getUserMedia({ audio: true });
      } catch (err4) {
        console.warn("Audio-only getUserMedia failed:", err4);
      }
    }

    // 4. Try legacy getUserMedia
    const legacyGetUserMedia = (navigator as any).webkitGetUserMedia || (navigator as any).mozGetUserMedia || (navigator as any).getUserMedia;
    if (legacyGetUserMedia) {
      try {
        return await new Promise<MediaStream>((resolve, reject) => {
          legacyGetUserMedia.call(navigator, constraints, resolve, reject);
        });
      } catch (legacyErr) {
        console.warn("Legacy getUserMedia failed:", legacyErr);
      }
    }

    // 5. Silent dummy audio stream fallback so call connection never terminates due to device constraint quirks
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        const ctx = new AudioCtx();
        const osc = ctx.createOscillator();
        const dest = ctx.createMediaStreamDestination();
        osc.connect(dest);
        osc.start();
        const dummy = dest.stream;
        dummy.getAudioTracks().forEach(t => { t.enabled = false; });
        return dummy;
      }
    } catch (errDummy) {
      console.warn("Dummy media fallback unavailable:", errDummy);
    }
    return new MediaStream();
  };

  const toggleRecording = async () => {
    if (!activeChat) return;
    if (isRecording) { mediaRecorderRef.current?.stop(); setIsRecording(false); mediaRecorderRef.current?.stream.getTracks().forEach(t => t.stop()); return; }
    try {
      const stream = await getMediaStream({ audio: true });
      audioChunksRef.current = [];
      const mr = new MediaRecorder(stream);
      mediaRecorderRef.current = mr;
      mr.ondataavailable = e => audioChunksRef.current.push(e.data);
      mr.onstart = () => {
        setRecordingDuration(0);
        if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = setInterval(() => setRecordingDuration(prev => prev + 1), 1000);
      };
      mr.onstop = async () => {
        if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
        if (cancelRecordingRef.current) { cancelRecordingRef.current = false; return; }
        const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        try {
          const encRes = await encryptMediaBlob(blob, `voice_${Date.now()}.webm`);
          const encryptedFile = new File([encRes.encryptedBlob], encRes.fileName, { type: "application/octet-stream" });
          const uploadRes = await uploadMediaToBackend(encryptedFile, token, encRes.fileName);
          const audioUrl = uploadRes.url;

          // Save decrypted clean audio blob to sender's local storage immediately
          await cacheSentMediaLocally(audioUrl, blob, "audio/webm");

          const tag = `[ENC_AUDIO]${audioUrl}|${encRes.keyB64}|${encRes.ivB64}|audio/webm`;
          const { type, id } = activeChat;
          const chatIdKey = type === "user" ? String(id).toLowerCase() : String(id);
          const tempId = `temp-${Date.now()}-${Math.random()}`;
          const ts = new Date().toISOString();
          const optimisticMsg: Message = { id: tempId, user: currentUser, content: tag, timestamp: ts, _dateLabel: getDateLabel(ts), ...(type === "user" ? { target_user: String(id) } : { group_id: id, group_name: activeChat.name }) };
          setMessages(prev => { const next = [...prev, optimisticMsg]; messagesCacheRef.current[chatIdKey] = next; return next; });
          dbSaveMessage(optimisticMsg, chatIdKey).catch(() => {});
          updateActivity(id, tag, optimisticMsg.timestamp);

          let contentToSend = tag;
          try {
            if (type === "user" && e2ePrivKeyRef.current) {
              const theirPub = await getPeerPubKey(String(id));
              if (theirPub) contentToSend = await encryptDM(tag, e2ePrivKeyRef.current, theirPub);
            } else if (type === "group" && e2ePrivKeyRef.current) {
              const groupKey = await getGroupKey(id);
              if (groupKey) contentToSend = await encryptGroupMsg(tag, groupKey);
            }
          } catch { }

          const msgPayload: any = {
            type: type === "user" ? "direct_message" : "group_message",
            content: contentToSend,
            message_type: "audio",
            ...(type === "user" ? { target_user: id } : { group_id: id })
          };
          wsSend(JSON.stringify(msgPayload));
        } catch (uploadErr) {
          console.warn("Voice upload failed:", uploadErr);
        }
      };
      mr.start();
      setIsRecording(true);
    } catch { showToast("Could not start recording: Microphone access denied or not supported.", "error"); }
  };

  // ── WEBRTC ────────────────────────────────────────────────────────────────────
  const rtcConfig = useMemo(() => {
    let customServers = [];
    try {
      const envIce = process.env.NEXT_PUBLIC_ICE_SERVERS;
      if (envIce) {
        customServers = JSON.parse(envIce);
      }
    } catch { }

    return {
      iceServers: customServers.length > 0 ? customServers : [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        { urls: "stun:stun2.l.google.com:19302" },
        { urls: "stun:stun.cloudflare.com:3478" },
        {
          urls: [
            "turn:flux-chat.duckdns.org:3478?transport=udp",
            "turn:flux-chat.duckdns.org:3478?transport=tcp",
          ],
          username: "pulse_turn",
          credential: "pulse_turn_secret_2026",
        },
        {
          urls: [
            "turn:openrelay.metered.ca:80",
            "turn:openrelay.metered.ca:443",
            "turn:openrelay.metered.ca:443?transport=tcp",
          ],
          username: "openrelay",
          credential: "openrelay",
        },
      ],
      iceCandidatePoolSize: 0,
    };
  }, []);

  const setupWebRTC = async (targetEmail: string) => {
    const cleanTarget = targetEmail.trim().toLowerCase();
    const PeerConnection = (typeof window !== "undefined" && (window.RTCPeerConnection || (window as any).webkitRTCPeerConnection || (window as any).mozRTCPeerConnection)) || null;
    if (!PeerConnection) {
      throw new Error("WebRTC RTCPeerConnection is not supported in this environment.");
    }
    const pc = new PeerConnection(rtcConfig);
    pcMapRef.current.set(cleanTarget, pc);
    peerConnectionRef.current = pc;
    
    const localStream = localStreamRef.current;
    if (localStream && localStream.getTracks().length > 0) {
      localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
      if (isVideoCallRef.current && !localStream.getVideoTracks().length) {
        try { pc.addTransceiver("video", { direction: "recvonly" }); } catch {}
      }
    } else {
      try {
        pc.addTransceiver("audio", { direction: "sendrecv" });
        if (isVideoCallRef.current) {
          pc.addTransceiver("video", { direction: "sendrecv" });
        }
      } catch {}
    }

    pc.ontrack = event => {
      setRemoteStreams(prev => {
        const stream = (event.streams?.[0]) || (() => { const s = prev[cleanTarget] || new MediaStream(); if (!s.getTracks().find(t => t.id === event.track.id)) s.addTrack(event.track); return s; })();
        if (cleanTarget === (callPeerRef.current || "").toLowerCase()) {
          remoteStreamRef.current = stream;
          const videoEl = remoteVideoRef.current;
          if (videoEl && videoEl.srcObject !== stream) { videoEl.srcObject = stream; videoEl.volume = 1.0; videoEl.play().catch(() => { }); }
          const audioEl = remoteAudioRef.current;
          if (audioEl && audioEl.srcObject !== stream) { audioEl.srcObject = stream; audioEl.volume = 1.0; audioEl.play().catch(() => { }); }
        }
        return { ...prev, [cleanTarget]: stream };
      });
      applyAudioOutput(isSpeaker);
    };

    pc.onicecandidate = event => {
      if (event.candidate) {
        wsSend(JSON.stringify({ type: "ice_candidate", target_user: cleanTarget, candidate: event.candidate }));
      }
    };

    pc.oniceconnectionstatechange = () => {
      const s = pc.iceConnectionState;
      if (s === "failed") {
        if (pc.restartIce) {
          try { pc.restartIce(); } catch {}
        }
      }
    };

    pc.onconnectionstatechange = () => {
      // Keep connection alive or attempt reconnection instead of immediate termination
    };
    return pc;
  };

  const startCall = async (video = true) => {
    if (!activeChat) return;
    const isGroup = activeChat.type === "group";
    if (!isGroup) {
      const peerEmail = String(activeChat.id).trim().toLowerCase();
      const isContact = contacts.some(c => c.email.toLowerCase() === peerEmail);
      if (!isContact) {
        showToast("You can only call mutual contacts", "error");
        return;
      }
    }
    const groupId = isGroup ? activeChat.id : null;
    if (groupId) callGroupIdRef.current = groupId;
    const targetIds = isGroup
      ? groups.find(g => String(g.id) === String(activeChat.id))?.members.map(getEmail).filter(m => m.toLowerCase() !== currentUser.toLowerCase()) || []
      : [String(activeChat.id).trim().toLowerCase()];
    if (!targetIds.length) return;
    try {
      if (typeof window !== "undefined") {
        try { (window as any).FluxNativeBridge?.requestCallPermissions?.(); } catch {}
      }
      if (localStreamRef.current) localStreamRef.current.getTracks().forEach(t => t.stop());
      iceCandidateQueueRef.current = [];
      setIsVideoCall(video); isVideoCallRef.current = video; setIsVideoSwapped(false);
      updateCallState("calling"); setCallPeer(targetIds[0]);
      callPeerRef.current = targetIds[0];
      callDirectionRef.current = "outgoing";
      const c = contacts.find(c => c.email.toLowerCase() === targetIds[0]);
      const peerName = c ? contactLabel(c) : activeChat.name;
      setCallPeerName(peerName);
      callPeerNameRef.current = peerName;
      try {
        const streamConstraints: MediaStreamConstraints = video
          ? { audio: true, video: { facingMode: "user" } }
          : { audio: true };
        localStreamRef.current = await getMediaStream(streamConstraints);
        if (localVideoRef.current && localStreamRef.current) { localVideoRef.current.srcObject = localStreamRef.current; localVideoRef.current.play().catch(() => { }); }
      } catch (errStream) {
        console.warn("startCall getMediaStream fallback:", errStream);
      }
      for (const target of targetIds) {
        const pc = await setupWebRTC(target);
        const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: video });
        await pc.setLocalDescription(offer);
        const wrappedSdp = { type: offer.type, sdp: offer.sdp, ...(groupId ? { group_id: groupId } : {}), sender_name: profile.displayName || profile.username || currentUser };
        wsSend(JSON.stringify({ type: "call_offer", target_user: target, sdp: wrappedSdp, isVideo: video, sender_name: profile.displayName || profile.username || currentUser, ...(groupId ? { group_id: groupId } : {}) }));
      }
    } catch (err: any) {
      console.error("[Call] startCall failed:", err);
      showToast(`Could not start call: ${err.message || err}`, "error");
      endCall(false);
    }
  };
  const startCallFromLog = useCallback(async (log: CallLogEntry, video: boolean) => {
    if (log.group_id) {
      const g = groups.find(x => String(x.id) === String(log.group_id));
      if (g) {
        openChat({ type: "group", id: g.id, name: g.name });
        setTimeout(() => startCall(video), 150);
      }
    } else {
      const c = contacts.find(x => x.email === log.peer);
      const displayName = c ? contactLabel(c) : (log.peerName || log.peer.split("@")[0]);
      openChat({ type: "user", id: log.peer, name: displayName });
      setTimeout(() => startCall(video), 150);
    }
  }, [groups, contacts, openChat, startCall]);

  const acceptCall = async () => {
    if (acceptInProgressRef.current) return;
    acceptInProgressRef.current = true;
    stopRingtone(); cancelCallNotification();
    if (typeof window !== "undefined") {
      try {
        (window as any).FluxNativeBridge?.stopRingtone?.();
        (window as any).FluxNativeBridge?.notifyCallAccepted?.();
      } catch {}
    }
    try {
      if (typeof window !== "undefined") {
        try { (window as any).FluxNativeBridge?.requestCallPermissions?.(); } catch {}
      }
      if (localStreamRef.current) localStreamRef.current.getTracks().forEach(t => t.stop());
      const needVideo = isVideoCallRef.current;
      setIsVideoSwapped(false);
      if (!pendingRemoteDescriptionRef.current) {
        try {
          let stored: string | null = null;
          if (typeof window !== "undefined") {
            try {
              const nativeOffer = (window as any).FluxNativeBridge?.getPendingCallOffer?.();
              if (nativeOffer && String(nativeOffer).trim().startsWith("{")) {
                stored = String(nativeOffer);
                (window as any).FluxNativeBridge?.clearPendingCallOffer?.();
              }
            } catch { }
            if (!stored) {
              stored = localStorage.getItem("flux_pending_call_offer") || sessionStorage.getItem("_Flux_call_offer");
            }
          }
          if (stored) {
            const parsed: StoredCallOffer = JSON.parse(stored);
            const offerGroupId = parsed.group_id || (parsed.sdp && (parsed.sdp as any).group_id);
            if (offerGroupId) callGroupIdRef.current = offerGroupId;
            const normalizedOffer = normalizeSdp(parsed.sdp);
            pendingRemoteDescriptionRef.current = normalizedOffer;
            if (!callPeerRef.current && parsed.peer) {
              callPeerRef.current = parsed.peer; callPeerNameRef.current = parsed.peerName || parsed.peer;
              isVideoCallRef.current = parsed.isVideo; callDirectionRef.current = "incoming";
              setCallPeer(parsed.peer); setCallPeerName(parsed.peerName || parsed.peer); setIsVideoCall(parsed.isVideo);
            }
          }
        } catch { }
      }
      try {
        sessionStorage.removeItem("_Flux_call_offer");
        localStorage.removeItem("flux_pending_call_offer");
        if (typeof window !== "undefined") {
          (window as any).FluxNativeBridge?.clearPendingCallOffer?.();
          (window as any).FluxNativeBridge?.notifyCallAccepted?.();
        }
      } catch { }

      const normalizedRemoteSdp = normalizeSdp(pendingRemoteDescriptionRef.current);
      const targetPeer = callPeerRef.current || callPeer || null;
      if (!targetPeer || !normalizedRemoteSdp) {
        console.error("[Call] acceptCall aborted: missing peer or valid offer SDP", { targetPeer, pending: pendingRemoteDescriptionRef.current });
        if (targetPeer) wsSend(JSON.stringify({ type: "call_reject", target_user: targetPeer }));
        showToast("Could not answer call: missing valid offer data.", "error");
        endCall(false, "missed");
        return;
      }
      try {
        const streamConstraints: MediaStreamConstraints = needVideo
          ? { audio: true, video: { facingMode: "user" } }
          : { audio: true };
        localStreamRef.current = await getMediaStream(streamConstraints);
        if (localVideoRef.current && localStreamRef.current) { localVideoRef.current.srcObject = localStreamRef.current; localVideoRef.current.play().catch(() => { }); }
      } catch (errStream) {
        console.warn("acceptCall getMediaStream fallback:", errStream);
      }
      const pc = await setupWebRTC(targetPeer);
      await pc.setRemoteDescription(new RTCSessionDescription(normalizedRemoteSdp));
      const queue = iceQueuesRef.current.get(targetPeer) || [];
      while (queue.length > 0) { const c = queue.shift(); if (c) await pc.addIceCandidate(new RTCIceCandidate(c)).catch(console.error); }
      iceQueuesRef.current.set(targetPeer, queue);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      const payload = JSON.stringify({ type: "call_answer", target_user: targetPeer, sdp: answer });
      wsSend(payload);
      updateCallState("connected"); callStartTimeRef.current = Date.now();

      const meshGroupId = callGroupIdRef.current;
      if (meshGroupId) {
        const group = groupsRef.current.find(g => String(g.id) === String(meshGroupId));
        if (group) {
          const otherMembers = group.members.map(getEmail).filter(m => m !== currentUser && m !== targetPeer && !pendingMeshOffersRef.current.has(m) && m > currentUser);
          for (const meshPeer of otherMembers) {
            if (!pcMapRef.current.has(meshPeer)) {
              try {
                const meshPc = await setupWebRTC(meshPeer);
                const meshOffer = await meshPc.createOffer();
                await meshPc.setLocalDescription(meshOffer);
                wsSend(JSON.stringify({ type: "call_offer", target_user: meshPeer, sdp: { type: meshOffer.type, sdp: meshOffer.sdp, is_mesh: true, group_id: meshGroupId, sender_name: profile.displayName || profile.username || currentUser }, isVideo: needVideo, is_mesh: true, group_id: meshGroupId }));
              } catch { }
            }
          }
        }
      }

      const queuedOffers = Array.from(pendingMeshOffersRef.current.entries());
      pendingMeshOffersRef.current.clear();
      for (const [meshPeer, sdp] of queuedOffers) {
        if (!pcMapRef.current.has(meshPeer)) {
          try {
            const meshPc = await setupWebRTC(meshPeer);
            const normalizedMesh = normalizeSdp(sdp);
            if (normalizedMesh) {
              await meshPc.setRemoteDescription(new RTCSessionDescription(normalizedMesh));
              const q = iceQueuesRef.current.get(meshPeer) || [];
              while (q.length > 0) { const c = q.shift(); if (c) await meshPc.addIceCandidate(new RTCIceCandidate(c)).catch(console.error); }
              iceQueuesRef.current.set(meshPeer, q);
              const meshAnswer = await meshPc.createAnswer();
              await meshPc.setLocalDescription(meshAnswer);
              wsSend(JSON.stringify({ type: "call_answer", target_user: meshPeer, sdp: meshAnswer }));
            }
          } catch { }
        }
      }

      setTimeout(() => {
        if (remoteStreamRef.current) {
          const videoEl = remoteVideoRef.current;
          if (videoEl && videoEl.srcObject !== remoteStreamRef.current) { videoEl.srcObject = remoteStreamRef.current; videoEl.volume = 1.0; videoEl.play().catch(() => { }); }
          applyAudioOutput(isSpeaker);
        }
      }, 300);

      const retryGroupId = callGroupIdRef.current;
      if (retryGroupId) {
        setTimeout(async () => {
          if (callStateRef.current !== "connected") return;
          const retryGroup = groupsRef.current.find(g => String(g.id) === String(retryGroupId));
          if (!retryGroup) return;
          const me = currentUserRef.current;
          const target = callPeerRef.current;
          const missingPeers = retryGroup.members.map(getEmail).filter(m => m !== me && m !== target && (!pcMapRef.current.has(m) || ["failed", "disconnected"].includes(pcMapRef.current.get(m)?.iceConnectionState || "")) && m > me);
          for (const meshPeer of missingPeers) {
            if (!localStreamRef.current) break;
            try {
              const old = pcMapRef.current.get(meshPeer);
              if (old) { old.close(); pcMapRef.current.delete(meshPeer); }
              const retryPc = await setupWebRTC(meshPeer);
              const retryOffer = await retryPc.createOffer();
              await retryPc.setLocalDescription(retryOffer);
              wsSend(JSON.stringify({ type: "call_offer", target_user: meshPeer, sdp: { type: retryOffer.type, sdp: retryOffer.sdp, is_mesh: true, group_id: retryGroupId, sender_name: profile.displayName || profile.username || me }, isVideo: isVideoCallRef.current, is_mesh: true, group_id: retryGroupId }));
            } catch { }
          }
        }, 4000);
      }
    } catch (err: any) {
      console.error("[Call] acceptCall failed:", err);
      showToast(`Could not connect call: ${err?.message || err}`, "error");
      endCall(false, "missed");
    }
    finally { acceptInProgressRef.current = false; }
  };

  const rejectCall = () => {
    stopRingtone(); cancelCallNotification();
    try {
      sessionStorage.removeItem("_Flux_call_offer");
      localStorage.removeItem("flux_pending_call_offer");
      if (typeof window !== "undefined") {
        (window as any).FluxNativeBridge?.clearPendingCallOffer?.();
        (window as any).FluxNativeBridge?.stopRingtone?.();
      }
    } catch { }
    const cp = callPeerRef.current || callPeer;
    if (cp) wsSend(JSON.stringify({ type: "call_reject", target_user: cp }));
    pcMapRef.current.forEach((_, peerEmail) => { if (peerEmail !== cp) wsSend(JSON.stringify({ type: "call_end", target_user: peerEmail })); });
    endCall(false, "rejected");
  };

  useEffect(() => { acceptCallRef.current = acceptCall; }, [acceptCall]);
  useEffect(() => { rejectCallRef.current = rejectCall; }, [rejectCall]);

  useEffect(() => { apiFetchRef.current = apiFetch; }, [apiFetch]);
  useEffect(() => { decryptContentRef.current = decryptContent; }, [decryptContent]);
  useEffect(() => { updateCallStateRef.current = updateCallState; }, [updateCallState]);
  useEffect(() => { scrollBottomRef.current = scrollBottom; }, [scrollBottom]);
  useEffect(() => { updateActivityRef.current = updateActivity; }, [updateActivity]);
  useEffect(() => { notifyRef.current = notify; }, [notify]);
  useEffect(() => { notifyCallRef.current = notifyCall; }, [notifyCall]);
  useEffect(() => { startRingtoneRef.current = startRingtone; }, [startRingtone]);
  useEffect(() => { contactLabelFnRef.current = contactLabelFn; }, [contactLabelFn]);
  useEffect(() => { persistSeenIdsRef.current = persistSeenIds; }, [persistSeenIds]);
  useEffect(() => { sendReadReceiptRef.current = sendReadReceipt; }, [sendReadReceipt]);
  useEffect(() => { removePeerFromCallRef.current = removePeerFromCall; }, [removePeerFromCall]);
  useEffect(() => { loadContactsRef.current = loadContacts; }, [loadContacts]);
  useEffect(() => { loadGroupsRef.current = loadGroups; }, [loadGroups]);
  useEffect(() => { setupWebRTCRef.current = setupWebRTC; }, [setupWebRTC]);
  useEffect(() => { wsSendRef.current = wsSend; }, [wsSend]);
  useEffect(() => { loadHistoryRef.current = loadHistory; }, [loadHistory]);
  useEffect(() => { acceptCallRef.current = acceptCall; }, [acceptCall]);

  const toggleMute = () => {
    if (localStreamRef.current) { localStreamRef.current.getAudioTracks().forEach(t => (t.enabled = isMuted)); setIsMuted(!isMuted); }
  };

  const toggleSpeaker = () => {
    const s = !isSpeaker;
    setIsSpeaker(s);
    applyAudioOutput(s);
  };

  const switchCamera = async () => {
    if (!isVideoCall || !localStreamRef.current) return;
    const newMode = facingMode === "user" ? "environment" : "user";
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) return;
    try {
      localStreamRef.current.getTracks().forEach(t => t.stop());
      let ns: MediaStream;
      try { ns = await navigator.mediaDevices.getUserMedia({ audio: true, video: { facingMode: { exact: newMode } } }); }
      catch { ns = await navigator.mediaDevices.getUserMedia({ audio: true, video: true }); }
      localStreamRef.current = ns;
      if (isMuted) ns.getAudioTracks().forEach(t => (t.enabled = false));
      if (localVideoRef.current) { localVideoRef.current.srcObject = ns; localVideoRef.current.play().catch(() => { }); }
      const [at] = ns.getAudioTracks();
      const [vt] = ns.getVideoTracks();
      pcMapRef.current.forEach(pc => pc.getSenders().forEach(sender => {
        if (sender.track?.kind === "audio" && at) sender.replaceTrack(at);
        if (sender.track?.kind === "video" && vt) sender.replaceTrack(vt);
      }));
      setFacingMode(newMode);
    } catch { }
  };

  useEffect(() => {
    if (callState === "idle") return;
    const attach = () => {
      if (localStreamRef.current && localVideoRef.current && localVideoRef.current.srcObject !== localStreamRef.current) { localVideoRef.current.srcObject = localStreamRef.current; localVideoRef.current.play().catch(() => { }); }
      if (remoteStreamRef.current && remoteVideoRef.current && remoteVideoRef.current.srcObject !== remoteStreamRef.current) { remoteVideoRef.current.srcObject = remoteStreamRef.current; remoteVideoRef.current.play().catch(() => { }); }
      if (!isVideoCallRef.current && remoteAudioRef.current && remoteStreamRef.current && remoteAudioRef.current.srcObject !== remoteStreamRef.current) { remoteAudioRef.current.srcObject = remoteStreamRef.current; remoteAudioRef.current.play().catch(() => { }); applyAudioOutput(isSpeaker); }
    };
    attach();
    const t1 = setTimeout(attach, 200), t2 = setTimeout(attach, 800);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [callState, isVideoCall, remoteStreams, isSpeaker, applyAudioOutput]);

  // ── PIP DRAG ──────────────────────────────────────────────────────────────────
  const onPipMouseDown = (e: React.MouseEvent) => { pipDragging.current = true; pipDragStart.current = { mx: e.clientX, my: e.clientY, x: pipPos.x, y: pipPos.y }; e.preventDefault(); };
  const onPipTouchStart = (e: React.TouchEvent) => { const t = e.touches[0]; pipDragging.current = true; pipDragStart.current = { mx: t.clientX, my: t.clientY, x: pipPos.x, y: pipPos.y }; };
  const onPipMouseMove = useCallback((e: MouseEvent) => {
    if (!pipDragging.current) return;
    const maxX = Math.max(12, window.innerWidth - 120);
    const maxY = Math.max(70, window.innerHeight - 260);
    const rawX = pipDragStart.current.x + e.clientX - pipDragStart.current.mx;
    const rawY = pipDragStart.current.y + e.clientY - pipDragStart.current.my;
    setPipPos({ x: Math.max(12, Math.min(rawX, maxX)), y: Math.max(60, Math.min(rawY, maxY)) });
  }, []);
  const onPipTouchMove = useCallback((e: TouchEvent) => {
    if (!pipDragging.current) return;
    const t = e.touches[0];
    const maxX = Math.max(12, window.innerWidth - 120);
    const maxY = Math.max(70, window.innerHeight - 260);
    const rawX = pipDragStart.current.x + t.clientX - pipDragStart.current.mx;
    const rawY = pipDragStart.current.y + t.clientY - pipDragStart.current.my;
    setPipPos({ x: Math.max(12, Math.min(rawX, maxX)), y: Math.max(60, Math.min(rawY, maxY)) });
  }, []);
  const onPipDragEnd = useCallback(() => { pipDragging.current = false; }, []);

  useEffect(() => {
    if (callState !== "idle" && isVideoCall) {
      window.addEventListener("mousemove", onPipMouseMove);
      window.addEventListener("mouseup", onPipDragEnd);
      window.addEventListener("touchmove", onPipTouchMove, { passive: true });
      window.addEventListener("touchend", onPipDragEnd);
      return () => {
        window.removeEventListener("mousemove", onPipMouseMove);
        window.removeEventListener("mouseup", onPipDragEnd);
        window.removeEventListener("touchmove", onPipTouchMove);
        window.removeEventListener("touchend", onPipDragEnd);
      };
    }
  }, [callState, isVideoCall, onPipMouseMove, onPipTouchMove, onPipDragEnd]);

  // ── DERIVED / MEMOS ───────────────────────────────────────────────────────────
  const isTyping = useMemo(() => activeChat?.type === "user" && typingSet.has(String(activeChat.id)), [activeChat, typingSet]);

  const sortedChats = useMemo(() => {
    const q = searchQuery.toLowerCase();
    const contactList = (sidebarFilter === "groups" ? [] : (q ? contacts.filter(c => contactLabel(c).toLowerCase().includes(q) || (c.username || "").toLowerCase().includes(q)) : contacts))
      .map(c => ({ type: "user" as const, id: c.email, item: c, lastActivityTs: lastActivity[c.email] || 0 }));
    
    // Also include any users who have activity / chat history but are not in contacts
    const nonContactList = (sidebarFilter === "groups" ? [] : Object.keys(lastActivity).filter(email =>
      email.includes("@") &&
      !contacts.some(c => c.email.toLowerCase() === email.toLowerCase()) &&
      (!q || email.toLowerCase().includes(q) || (nicknames[email] || "").toLowerCase().includes(q))
    ).map(email => ({
      type: "user" as const,
      id: email,
      item: {
        email,
        username: email.split("@")[0],
        display_name: nicknames[email] || email.split("@")[0],
        is_online: false,
        not_in_contacts: true,
      } as Contact,
      lastActivityTs: lastActivity[email] || 0,
    })));

    const groupList = (sidebarFilter === "direct" ? [] : (q ? groups.filter(g => g.name.toLowerCase().includes(q)) : groups))
      .map(g => ({ type: "group" as const, id: String(g.id), item: g, lastActivityTs: lastActivity[String(g.id)] || 0 }));
    let combined = [...contactList, ...nonContactList, ...groupList].sort((a, b) => b.lastActivityTs - a.lastActivityTs);
    
    if (!q) {
      combined = combined.filter(c => !hiddenChats.has(String(c.id).toLowerCase()));
    }

    if (sidebarFilter === "unread") {
      combined = combined.filter(c => (unread[String(c.id)] || 0) > 0);
    }
    return combined;
  }, [contacts, groups, searchQuery, lastActivity, contactLabel, sidebarFilter, unread, hiddenChats, nicknames]);

  const searchMessageResults = useMemo(() => {
    if (!searchQuery) return [];
    const results: (Message & { chatId: string | number; chatType: "user" | "group" })[] = [];
    Object.entries(messagesCacheRef.current).forEach(([chatId, msgs]) => {
      const isGroup = groups.some(g => String(g.id) === chatId);
      msgs.forEach(m => { if (!m._callRecord && m.content.toLowerCase().includes(searchQuery.toLowerCase()) && !m.content.startsWith("[")) results.push({ ...m, chatId, chatType: isGroup ? "group" : "user" }); });
    });
    return results;
  }, [searchQuery, groups]);

  const nonDeletedCallLogs = useMemo(() => {
    return callLogs.filter(log => !deletedForMeIds.has(`call-${log.id}`));
  }, [callLogs, deletedForMeIds]);

  const unreadMissedCount = useMemo(() => {
    return nonDeletedCallLogs.filter(
      l => l.direction === "incoming" && l.status !== "completed" && parseTs(l.timestamp).getTime() > lastSeenMissedTs
    ).length;
  }, [nonDeletedCallLogs, lastSeenMissedTs]);

  const nonDeletedMessages = useMemo(() => {
    return messages.filter(m => !deletedForMeIds.has(String(m.id)));
  }, [messages, deletedForMeIds]);

  const mergedMessages = useMemo(() => {
    if (!activeChat) return messages;
    const chatId = String(activeChat.id);
    const filteredMessages = messages.filter(m => !deletedForMeIds.has(String(m.id)));
    const relevantLogs = activeChat.type === "group"
      ? callLogs.filter(log => log.group_id && String(log.group_id) === chatId && !deletedForMeIds.has(`call-${log.id}`))
      : callLogs.filter(log => !log.group_id && String(log.peer) === chatId && !deletedForMeIds.has(`call-${log.id}`));
    if (relevantLogs.length === 0) {
      return [...filteredMessages].sort((a, b) => parseTs(a.timestamp).getTime() - parseTs(b.timestamp).getTime());
    }

    const relevantVirtualCalls = relevantLogs.map(log => {
      const icon = log.media === "video" ? "📹" : "📞";
      const label = log.media === "video" ? "Video call" : "Voice call";
      const status = log.status === "completed" ? ` · ${fmtDuration(log.duration)}` : log.status === "rejected" ? " · Declined" : " · Missed";
      return {
        id: `call-${log.id}`,
        user: log.direction === "outgoing" ? (currentUser || "") : log.peer,
        content: `${icon} ${log.direction === "incoming" ? "Incoming" : "Outgoing"} ${label}${status}`,
        timestamp: log.timestamp,
        _callRecord: true,
        peer: String(log.peer),
        ...(log.group_id ? { group_id: log.group_id } : {})
      } as Message & { peer: string; group_id?: string | number };
    });

    const messagesWithTime = filteredMessages.map(m => ({ msg: m, time: parseTs(m.timestamp).getTime() }));
    const callsWithTime = relevantVirtualCalls.map(vc => ({ msg: vc, time: parseTs(vc.timestamp).getTime() }));

    const combinedWithTime = [...messagesWithTime];
    callsWithTime.forEach(vc => {
      const isDuplicate = combinedWithTime.some(item =>
        item.msg.id === vc.msg.id ||
        (item.msg._callRecord && Math.abs(item.time - vc.time) < 5000)
      );
      if (!isDuplicate) {
        combinedWithTime.push(vc);
      }
    });

    combinedWithTime.sort((a, b) => a.time - b.time);
    return combinedWithTime.map(item => item.msg);
  }, [messages, callLogs, currentUser, activeChat, deletedForMeIds]);

  const deleteMsg = useCallback(async (id: string | number) => {
    const found = messages.find(m => String(m.id) === String(id)) || mergedMessages.find(m => String(m.id) === String(id));
    if (found) {
      promptDeleteMsgs([found]);
    } else {
      // Fallback
      await deleteMsgEx(id, true);
    }
  }, [messages, mergedMessages, promptDeleteMsgs, deleteMsgEx]);

  const groupedMessages = useMemo(() => {
    const out: GroupedMessage[] = [];
    let lastDate: string | null = null;

    for (const msg of mergedMessages) {
      const label = getDateLabel(msg.timestamp);
      if (label !== lastDate) {
        out.push({ type: "divider", label });
        lastDate = label;
      }
      out.push({ type: "msg", ...msg });
    }
    return out;
  }, [mergedMessages]);

  const rowVirtualizer = useVirtualizer({
    count: groupedMessages.length,
    getScrollElement: () => msgListRef.current,
    estimateSize: () => 60,
    overscan: 12,
    gap: 2,
    getItemKey: useCallback((index: number) => {
      const item = groupedMessages[index];
      const chatPrefix = activeChat ? `${activeChat.type}-${activeChat.id}` : "chat";
      return item ? (item.type === "divider" ? `${chatPrefix}-div-${item.label}-${index}` : `${chatPrefix}-msg-${item.id}`) : `${chatPrefix}-${index}`;
    }, [groupedMessages, activeChat]),
  });
  rowVirtualizerRef.current = rowVirtualizer;
  groupedMessagesRef.current = groupedMessages;

  useLayoutEffect(() => {
    if (isScrollAnchored && msgListRef.current) {
      msgListRef.current.scrollTop = msgListRef.current.scrollHeight;
      if (rowVirtualizerRef.current && groupedMessagesRef.current.length > 0) {
        try {
          rowVirtualizerRef.current.scrollToIndex(groupedMessagesRef.current.length - 1, { align: "end" });
        } catch {}
      }
    }
  }, [groupedMessages.length, isScrollAnchored]);

  useLayoutEffect(() => {
    if (activeChat && rowVirtualizerRef.current) {
      try {
        rowVirtualizerRef.current.measure();
      } catch {}
    }
  }, [activeChat?.id, activeChat?.type]);

  const handleAppClick = useCallback(() => { setSidebarDeleteId(null); setReactionPickerId(null); setSelectedMsgId(null); setShowMuteMenu(false); }, []);
  const checkUsernameAvailability = useDebounceCallback(async (value: string) => {
    if (value.length >= 3) { try { const res = await apiFetch<{ available: boolean }>(`/auth/check-username/${value}`); if (!res.available) dispatchAuth({ type: "SET_ERROR", value: "Username already taken" }); } catch { } }
  }, 500);

  // ── EMOJI DATA ────────────────────────────────────────────────────────────────
  const emojis = ["😀", "😃", "😄", "😁", "😆", "😅", "🤣", "😂", "🙂", "😊", "😇", "🥰", "😍", "🤩", "😘", "😗", "😚", "😙", "🥲", "😋", "😛", "😜", "🤪", "😝", "🤑", "🤗", "🤭", "🫢", "🤫", "🤔", "🫡", "🤐", "🤨", "😐", "😑", "😶", "😏", "😒", "🙄", "😬", "🤥", "😌", "😔", "😪", "🤤", "😴", "😷", "🤒", "🤕", "🤢", "🤮", "🥵", "🥶", "🥴", "😵", "🤯", "🤠", "🥳", "😎", "🤓", "🧐", "😕", "😟", "🙁", "☹️", "😮", "😯", "😲", "😳", "🥺", "😦", "😧", "😨", "😰", "😥", "😢", "😭", "😱", "😖", "😣", "😞", "😓", "😩", "😫", "🥱", "😤", "😡", "😠", "🤬", "💀", "👻", "😈", "👿", "💩", "🤡", "👹", "👍", "👎", "👌", "✌️", "🤞", "🫰", "🤟", "🤘", "🤙", "👈", "👉", "👆", "👇", "☝️", "✋", "🤚", "🖐️", "👋", "🤏", "👏", "🙌", "🫶", "🤲", "🙏", "✍️", "💪", "❤️", "🧡", "💛", "💚", "💙", "💜", "🔥", "💫", "⭐", "🌟", "✨", "💥", "❄️", "🌈", "☀️", "🌙", "🎉", "🎊", "🎈", "🎁", "🏆", "🥇", "🎵", "🎶", "🎤", "🎸", "🎹", "🚀", "✈️", "🌍", "🌊", "🌺", "🌸", "🍕", "🍔", "☕", "✅", "❌", "⚡", "💯", "💬", "📌", "🔗", "🔑", "💡", "🔔", "📢", "👀", "💤", "🆗", "🆙", "🔝"];
  const reactionEmojis = ["👍", "❤️", "😂", "😮", "😢", "🙏", "🔥", "💯"];

  const handleReply = useCallback((msg: Message) => {
    setReplyingTo(msg);
    setReactionPickerId(null);
    toggleSelectMsg(null);
  }, [toggleSelectMsg]);

  const handleForward = useCallback((msg: Message) => {
    setForwardingMsgs([msg]);
    setShowForwardPicker(true);
    toggleSelectMsg(null);
  }, [toggleSelectMsg]);

  const handleEditStart = useCallback((id: string | number, text: string) => {
    setEditingId(id);
    setEditingText(text);
    setReactionPickerId(null);
    toggleSelectMsg(null);
  }, [toggleSelectMsg]);

  const handleEditCancel = useCallback(() => {
    setEditingId(null);
  }, []);

  const handleJumpToMessage = useCallback((targetId: string | number) => {
    const targetIdStr = String(targetId);
    const idx = groupedMessages.findIndex(m => m.type === "msg" && String(m.id) === targetIdStr);
    if (idx !== -1 && rowVirtualizerRef.current) {
      rowVirtualizerRef.current.scrollToIndex(idx, { align: "center", behavior: "smooth" });
      setHighlightedMsgId(targetId);
      setTimeout(() => setHighlightedMsgId(null), 2500);
    } else {
      const el = document.getElementById(`msg-${targetIdStr}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        setHighlightedMsgId(targetId);
        setTimeout(() => setHighlightedMsgId(null), 2500);
      }
    }
  }, [groupedMessages]);

  const handleViewFile = useCallback((url: string, type: string) => {
    setViewFile({ url, type });
  }, []);

  const handleDeleteMsg = useCallback((id: string | number) => {
    deleteMsg(id);
    toggleSelectMsg(null);
  }, [deleteMsg, toggleSelectMsg]);

  const handleCallTap = useCallback((video: boolean) => {
    const callType = video ? "Video Call" : "Voice Call";
    showConfirm(`Do you want to start a ${callType} with this chat?`, () => {
      startCall(video);
    });
  }, [showConfirm, startCall]);

  const callDisplayName = callPeerName || (callPeer ? getPeerName(callPeer) : "") || (callPeer ? callPeer.split("@")[0] : "");

  if (!isMounted) {
    return (
      <div className="skeleton-wrapper" aria-hidden="true" role="presentation">
        {/* Sidebar Skeleton */}
        <div className="skeleton-sidebar">
          <div className="skeleton-header-bar">
            <div className="skeleton-logo shimmer" />
            <div className="skeleton-circle-btn shimmer" />
          </div>
          <div className="skeleton-search-bar shimmer" />
          <div className="skeleton-list">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="skeleton-item">
                <div className="skeleton-avatar shimmer" />
                <div className="skeleton-info">
                  <div className={`skeleton-line shimmer ${i % 2 === 0 ? "skeleton-line-short" : "skeleton-line-medium"}`} />
                  <div className="skeleton-line skeleton-line-long shimmer" />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Chat Panel Skeleton */}
        <div className="skeleton-chat-panel">
          <div className="skeleton-chat-header">
            <div className="skeleton-avatar shimmer" />
            <div className="skeleton-chat-title">
              <div className="skeleton-line skeleton-line-medium shimmer" />
              <div className="skeleton-line skeleton-line-short shimmer" />
            </div>
            <div style={{ display: "flex", gap: 12 }}>
              <div className="skeleton-circle-btn shimmer" />
              <div className="skeleton-circle-btn shimmer" />
            </div>
          </div>

          <div className="skeleton-chat-messages">
            <div className="skeleton-bubble skeleton-bubble-incoming">
              <div className="skeleton-line skeleton-line-medium shimmer" style={{ height: 10 }} />
              <div className="skeleton-line skeleton-line-long shimmer" style={{ height: 10 }} />
            </div>
            <div className="skeleton-bubble skeleton-bubble-outgoing">
              <div className="skeleton-line skeleton-line-short shimmer" style={{ height: 10 }} />
              <div className="skeleton-line skeleton-line-medium shimmer" style={{ height: 10 }} />
            </div>
            <div className="skeleton-bubble skeleton-bubble-incoming" style={{ maxWidth: "45%" }}>
              <div className="skeleton-line skeleton-line-long shimmer" style={{ height: 10 }} />
            </div>
            <div className="skeleton-bubble skeleton-bubble-outgoing" style={{ maxWidth: "50%" }}>
              <div className="skeleton-line skeleton-line-medium shimmer" style={{ height: 10 }} />
              <div className="skeleton-line skeleton-line-short shimmer" style={{ height: 10 }} />
            </div>
          </div>

          <div className="skeleton-chat-input-bar">
            <div className="skeleton-circle-btn shimmer" />
            <div className="skeleton-input-field shimmer" />
            <div className="skeleton-circle-btn shimmer" />
          </div>
        </div>
      </div>
    );
  }

  // ─── RENDER HELPERS (inline to avoid passing too many props) ──────────────────
  const renderPeerVideoOrAvatar = (peerId: string, stream: MediaStream | null, idx?: number, total?: number) => {
    const isPeerCamOff = cameraStates[peerId] === true;
    const peerContact = contacts.find(c => c.email === peerId);
    const peerAvatar = peerContact?.avatar_url;
    const peerLabel = getPeerName(peerId);
    const peerInitial = peerLabel === "Unknown User" ? peerId.split("@")[0] : peerLabel;
    return (
      <div style={{ position: "relative", width: "100%", height: total && total > 1 ? `${Math.floor(100 / total)}%` : "100%", flexShrink: 0, borderBottom: (idx !== undefined && total !== undefined && idx < total - 1) ? "1.5px solid rgba(255,255,255,0.15)" : "none", overflow: "hidden" }}>
        {isPeerCamOff || !stream ? (
          <div style={{ width: "100%", height: "100%", background: "#1a1a1a", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8 }}>
            <div style={{ width: 64, height: 64, borderRadius: "50%", background: "var(--primary)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, color: "#fff", fontWeight: 700, overflow: "hidden", border: "2px solid rgba(255,255,255,0.15)" }}>
              {peerAvatar ? <img src={peerAvatar} alt={peerLabel} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : peerInitial[0]?.toUpperCase() || "?"}
            </div>
            <span style={{ fontSize: 10, color: "rgba(255,255,255,0.4)" }}>{isPeerCamOff ? "Camera Off" : ""}</span>
          </div>
        ) : (
          <video autoPlay playsInline ref={node => { if (node && node.srcObject !== stream) { node.srcObject = stream; node.play().catch(() => { }); } }} style={{ width: "100%", height: "100%", objectFit: "cover", background: "#000" }} />
        )}
        <div style={{ position: "absolute", bottom: 12, left: 12, background: "rgba(0,0,0,0.65)", color: "#fff", padding: "6px 12px", borderRadius: 16, fontSize: 13, fontWeight: 500, backdropFilter: "blur(4px)", pointerEvents: "none", zIndex: 5, border: "1px solid rgba(255,255,255,0.15)", display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: isPeerCamOff ? "#94a3b8" : "#4ade80", boxShadow: isPeerCamOff ? "none" : "0 0 8px #4ade80" }} />{peerInitial}
        </div>
      </div>
    );
  };

  const chat = activeChat;

  // ─── JSX ─────────────────────────────────────────────────────────────────────
  return (
    <ErrorBoundary>
      <div className="app" onClick={handleAppClick}>

      {/* ── PROFILE OVERLAYS ── */}
      {showContactProfile && activeChat?.type === "user" && (
        <ContactProfile
          contact={contacts.find(c => c.email === activeChat.id)}
          activeChat={activeChat} currentUser={currentUser} nicknames={nicknames}
          contactLabel={contactLabel} callLogs={nonDeletedCallLogs} messages={nonDeletedMessages}
          onClose={() => { setShowContactProfile(false); if (openedProfileFromSidebar) { setActiveChat(null); setOpenedProfileFromSidebar(false); } }}
          onCall={video => { setShowContactProfile(false); setOpenedProfileFromSidebar(false); startCall(video); }}
          onNicknameEdit={() => { setShowContactProfile(false); setOpenedProfileFromSidebar(false); openHeaderNicknameEdit(); }}
          getPeerName={getPeerName} onViewFile={(url, type) => setViewFile({ url, type })}
          isBlocked={blockedUsers.has(String(activeChat.id))}
          onBlock={() => blockUser(String(activeChat.id))}
          onUnblock={() => unblockUser(String(activeChat.id))}
          isContact={contacts.some(c => c.email.toLowerCase() === String(activeChat.id).toLowerCase())}
          onRemoveContact={() => handleRemoveContact(String(activeChat.id))}
          onAddContact={() => {
            setShowContactProfile(false);
            setAddContactPrefill(String(activeChat.id));
            setShowAddContactModal(true);
          }}
        />
      )}

      {showGroupProfile && activeChat?.type === "group" && (
        <GroupProfile
          group={groups.find(g => g.id === activeChat.id)}
          activeChat={activeChat}
          isUploadingGroupAvatar={isUploadingGroupAvatar}
          groupAvatarInputRef={groupAvatarInputRef}
          handleGroupAvatarUpload={handleGroupAvatarUpload}
          onClose={() => { setShowGroupProfile(false); if (openedProfileFromSidebar) { setActiveChat(null); setOpenedProfileFromSidebar(false); } }}
          onCall={video => { setShowGroupProfile(false); setOpenedProfileFromSidebar(false); startCall(video); }}
          onAddMember={addGroupMember}
          onLeaveGroup={leaveGroup}
          onViewFile={(url, type) => setViewFile({ url, type })}
          apiFetch={apiFetch}
          loadGroups={loadGroups}
          onCallFromLog={startCallFromLog}
          onAddContact={(targetEmail) => {
            setShowGroupProfile(false);
            setAddContactPrefill(targetEmail);
            setShowAddContactModal(true);
          }}
        />
      )}

      {messageInfoMsg && (
        <MessageInfoModal
          message={messageInfoMsg}
          group={groups.find(g => String(g.id) === String(activeChat?.id))}
          contacts={contacts} currentUser={currentUser} getPeerName={getPeerName}
          onClose={() => setMessageInfoMsg(null)}
        />
      )}

      {/* ══ AUTH SCREEN ══════════════════════════════════════════════════════════ */}
      {!isAuth ? (
        <AuthScreen
          auth={auth}
          dispatchAuth={dispatchAuth}
          handleSignIn={handleSignIn}
          handleSignUp={handleSignUp}
          handleRegister={handleRegister}
          handleForgotPassword={handleForgotPassword}
          handleResetPassword={handleResetPassword}
          checkUsernameAvailability={checkUsernameAvailability}
        />
      ) : (
        /* ══ MAIN APP SHELL ══════════════════════════════════════════════════ */
        <div className={`shell ${activeChat ? "chat-active" : ""}`}>



          {/* ── SIDEBAR ───────────────────────────────────────────────────────── */}
          <aside className="sidebar">
            <div className="sb-brand-header">
              <div className="sb-brand-left">
                <h1 className="chats-screen-title">{showStatusUI ? "Status" : "Chats"}</h1>
                <span
                  className="sb-ws-dot"
                  style={{
                    background: wsStatus === "connected" ? "#6daf78" : wsStatus === "reconnecting" ? "#fbbf24" : wsStatus === "offline" ? "#ef4444" : "#ccc",
                    cursor: wsStatus !== "connected" ? "pointer" : "default",
                  }}
                  title={
                    wsStatus === "connected" ? "Connected"
                      : wsStatus === "reconnecting" ? "Reconnecting..."
                        : wsStatus === "offline" ? "Connection lost. Click to retry."
                          : "Disconnected. Click to reconnect."
                  }
                  onClick={() => {
                    if (wsStatus !== "connected" && wsStatus !== "reconnecting") {
                      wsRetryDelay.current = 800;
                      wsRetryCount.current = 0;
                      setWsStatus("reconnecting");
                      initWSRef.current?.();
                    }
                  }}
                />
                {totalUnread > 0 && !showStatusUI && (
                  <span onClick={e => { e.stopPropagation(); markAllRead(); }} title="Mark all read" className="sb-total-unread">
                    {totalUnread > 99 ? "99+" : totalUnread}
                  </span>
                )}
              </div>
              <div className="sb-brand-actions" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                {!showStatusUI && (
                  <button
                    className="chats-compose-btn"
                    title="New Group"
                    aria-label="New Group"
                    onClick={() => {
                      setShowNewGroup(true);
                      setShowNewContact(false);
                    }}
                  >
                    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                      <circle cx="9" cy="7" r="4" />
                      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                    </svg>
                  </button>
                )}
                {!showStatusUI && (
                  <button
                    className="chats-compose-btn"
                    title={incomingRequests.length > 0 ? `${incomingRequests.length} Pending Contact Requests` : "Add Contact / Requests"}
                    aria-label="Add Contact or Requests"
                    onClick={() => {
                      if (incomingRequests.length > 0) {
                        setShowRequestsModal(true);
                      } else {
                        setShowAddContactModal(true);
                      }
                    }}
                    style={{ position: "relative" }}
                  >
                    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                      <circle cx="8.5" cy="7" r="4" />
                      <line x1="20" y1="8" x2="20" y2="14" />
                      <line x1="23" y1="11" x2="17" y2="11" />
                    </svg>
                    {incomingRequests.length > 0 && (
                      <span
                        style={{
                          position: "absolute",
                          top: -3,
                          right: -3,
                          background: "#6daf78",
                          color: "#ffffff",
                          fontSize: 10,
                          fontWeight: 800,
                          borderRadius: 10,
                          minWidth: 16,
                          height: 16,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          padding: "0 4px",
                          lineHeight: "14px",
                          boxShadow: "0 2px 6px rgba(109, 175, 120, 0.4)",
                          border: "2px solid #ffffff",
                        }}
                      >
                        {incomingRequests.length}
                      </span>
                    )}
                  </button>
                )}
                <button
                  className="chats-compose-btn"
                  title={showStatusUI ? "Add Status" : "New Chat"}
                  aria-label={showStatusUI ? "Add Status" : "New Chat"}
                  onClick={() => {
                    if (showStatusUI) {
                      setShowStatusCreator("media");
                    } else {
                      setShowContactsModal(true);
                    }
                  }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Profile Settings Full Page View */}
            {showMyProfileSettings && (
              <div className="settings-full-page">
                <div className="settings-page-header">
                  <button className="settings-back-btn" onClick={() => setShowMyProfileSettings(false)}>
                    ← Back
                  </button>
                  <div className="settings-page-title">Settings & Account</div>
                </div>
                <div className="settings-page-content">
                  {/* Profile Card */}
                  <div className="settings-profile-card">
                    <div
                      className="settings-avatar-wrap"
                      style={{ position: "relative", cursor: "pointer" }}
                      onClick={() => {
                        if (profile.avatarUrl) {
                          setViewFile({ url: profile.avatarUrl, type: "self-avatar", isSelf: true });
                        } else {
                          triggerAvatarPicker();
                        }
                      }}
                      title={profile.avatarUrl ? "View profile photo" : "Upload photo"}
                    >
                      {profile.avatarUrl ? (
                        <AvatarImage src={profile.avatarUrl} alt="Avatar" fallbackText={profile.displayName || profile.username || currentUser} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      ) : (
                        <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#ebf5ee", color: "#6daf78", fontWeight: 700, fontSize: 24 }}>
                          {(profile.displayName || currentUser)?.[0]?.toUpperCase() || "?"}
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          triggerAvatarPicker();
                        }}
                        style={{
                          position: "absolute",
                          bottom: 0,
                          right: 0,
                          width: 28,
                          height: 28,
                          borderRadius: "50%",
                          background: "#6daf78",
                          color: "#ffffff",
                          border: "2px solid #ffffff",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          cursor: "pointer",
                          boxShadow: "0 2px 6px rgba(0,0,0,0.25)",
                        }}
                        title="Change profile photo"
                        aria-label="Change photo"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                          <circle cx="12" cy="13" r="4" />
                        </svg>
                      </button>
                    </div>
                    <input type="file" ref={avatarInputRef} accept="image/*" className="hidden-input" onChange={handleAvatarUpload} style={{ display: "none" }} />
                    <div className="settings-profile-info">
                      <div className="settings-profile-name">{profile.displayName || "Flux User"}</div>
                      <div className="settings-profile-username">@{profile.username || (currentUser ? currentUser.split("@")[0] : "user")}</div>
                      {profile.about && <div className="settings-profile-about" style={{ fontSize: "12px", color: "#6daf78", marginTop: 2, fontWeight: 500 }}>"{profile.about}"</div>}
                      <div className="settings-profile-email">{currentUser}</div>
                    </div>
                  </div>

                  {/* Profile Edit Card */}
                  <div className="settings-card-group">
                    <div className="settings-card-group-hdr">Account Info</div>
                    <div className="settings-row">
                      <div className="settings-row-left">
                        <div className="settings-row-text">
                          <span className="settings-row-label">Display Name</span>
                          <span className="settings-row-sub">{profile.displayName || "Not set"}</span>
                        </div>
                      </div>
                      <button className="ringtone-change-btn" onClick={handleUpdateDisplayName}>
                        Edit
                      </button>
                    </div>
                    <div className="settings-row">
                      <div className="settings-row-left">
                        <div className="settings-row-text">
                          <span className="settings-row-label">Username</span>
                          <span className="settings-row-sub">{profile.username ? `@${profile.username}` : (currentUser ? `@${currentUser.split("@")[0]}` : "Not set")}</span>
                        </div>
                      </div>
                      <button className="ringtone-change-btn" onClick={handleUpdateUsername}>
                        Edit
                      </button>
                    </div>
                    <div className="settings-row">
                      <div className="settings-row-left">
                        <div className="settings-row-text">
                          <span className="settings-row-label">About</span>
                          <span className="settings-row-sub">{profile.about || "Not set"}</span>
                        </div>
                      </div>
                      <button className="ringtone-change-btn" onClick={() => {
                        const val = window.prompt("Update your About / Bio:", profile.about || "");
                        if (val !== null) {
                          const trimmed = val.trim();
                          apiFetch("/profile/me", {
                            method: "PATCH",
                            body: JSON.stringify({ about: trimmed }),
                          }).then(() => {
                            updateProfile({ about: trimmed });
                            setEditAbout(trimmed);
                            showToast("About updated", "success");
                          }).catch((err: any) => {
                            showToast(err.message || "Failed to update about", "error");
                          });
                        }
                      }}>
                        Edit
                      </button>
                    </div>
                  </div>

                  {/* Notifications & Calls Card */}
                  <div className="settings-card-group">
                    <div className="settings-card-group-hdr">Notifications & Calls</div>
                    <div className="settings-row">
                      <div className="settings-row-left">
                        <div className="settings-row-text">
                          <span className="settings-row-label">Audio Alerts</span>
                          <span className="settings-row-sub">Pulse ringtone and notification chime active</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Chats & Media Card */}
                  <div className="settings-card-group">
                    <div className="settings-card-group-hdr">Chats & Media</div>
                    <div className="settings-row" style={{ cursor: "pointer" }} onClick={() => toggleSaveToGalleryPref(!saveToGalleryPref)}>
                      <div className="settings-row-left">
                        <div className="settings-row-text">
                          <span className="settings-row-label">Save to Device Gallery</span>
                          <span className="settings-row-sub">Automatically save downloaded photos and videos directly into your phone's Gallery</span>
                        </div>
                      </div>
                      <div
                        style={{
                          width: 44,
                          height: 26,
                          borderRadius: 14,
                          background: saveToGalleryPref ? "#6daf78" : "rgba(0, 0, 0, 0.15)",
                          position: "relative",
                          transition: "background 0.2s ease",
                          cursor: "pointer",
                          flexShrink: 0,
                          marginLeft: 12
                        }}
                      >
                        <div
                          style={{
                            width: 20,
                            height: 20,
                            borderRadius: "50%",
                            background: "#ffffff",
                            position: "absolute",
                            top: 3,
                            left: saveToGalleryPref ? 21 : 3,
                            transition: "left 0.2s cubic-bezier(0.2, 0.8, 0.2, 1)",
                            boxShadow: "0 2px 4px rgba(0,0,0,0.2)"
                          }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Privacy & Security Card */}
                  <div className="settings-card-group">
                    <div className="settings-card-group-hdr">Privacy & Security</div>
                    <div className="settings-row settings-row-interactive" onClick={() => setShowBlockedList(!showBlockedList)}>
                      <div className="settings-row-left">
                        <div className="settings-row-text">
                          <span className="settings-row-label">Blocked Users</span>
                          <span className="settings-row-sub">{blockedUsers.size} blocked contact{blockedUsers.size === 1 ? "" : "s"}</span>
                        </div>
                      </div>
                      <svg className={`chevron ${showBlockedList ? "chevron--up" : ""}`} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6,9 12,15 18,9" /></svg>
                    </div>
                    {showBlockedList && (
                      <div style={{ padding: "10px 16px 14px", borderTop: "1px solid var(--border-subtle)", display: "flex", flexDirection: "column", gap: 8 }}>
                        {blockedUsers.size === 0 ? (
                          <p className="text-muted-sm" style={{ margin: 0, textAlign: "center" }}>No blocked users</p>
                        ) : Array.from(blockedUsers).map(email => (
                          <div key={email} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                            <span style={{ fontSize: 13, textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap", flex: 1, color: "var(--danger)" }}>{email}</span>
                            <button onClick={() => unblockUser(email)} style={{ background: "none", border: "none", color: "var(--green)", fontSize: 12, cursor: "pointer", fontWeight: "bold", padding: "4px 8px" }}>Unblock</button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Legal & Policies Card */}
                  <div className="settings-card-group">
                    <div className="settings-card-group-hdr">Legal & Privacy</div>
                    <div
                      className="settings-row settings-row-interactive"
                      onClick={() => {
                        setLegalModalTab("privacy");
                        setShowLegalModal(true);
                      }}
                      style={{ cursor: "pointer" }}
                    >
                      <div className="settings-row-left" style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <div
                          style={{
                            width: 34,
                            height: 34,
                            borderRadius: 10,
                            background: "rgba(109, 175, 120, 0.12)",
                            color: "#4f9859",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            flexShrink: 0,
                          }}
                        >
                          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                          </svg>
                        </div>
                        <div className="settings-row-text">
                          <span className="settings-row-label">Privacy Policy</span>
                          <span className="settings-row-sub">End-to-end encryption, data storage & zero logs</span>
                        </div>
                      </div>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--text-3)", flexShrink: 0 }}>
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                    </div>

                    <div
                      className="settings-row settings-row-interactive"
                      onClick={() => {
                        setLegalModalTab("terms");
                        setShowLegalModal(true);
                      }}
                      style={{ cursor: "pointer", borderTop: "1px solid var(--border-subtle)" }}
                    >
                      <div className="settings-row-left" style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <div
                          style={{
                            width: 34,
                            height: 34,
                            borderRadius: 10,
                            background: "rgba(109, 175, 120, 0.12)",
                            color: "#4f9859",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            flexShrink: 0,
                          }}
                        >
                          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                            <polyline points="14 2 14 8 20 8" />
                            <line x1="16" y1="13" x2="8" y2="13" />
                            <line x1="16" y1="17" x2="8" y2="17" />
                          </svg>
                        </div>
                        <div className="settings-row-text">
                          <span className="settings-row-label">Terms & Conditions</span>
                          <span className="settings-row-sub">Acceptable use, account rules & service terms</span>
                        </div>
                      </div>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--text-3)", flexShrink: 0 }}>
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                    </div>
                  </div>

                  {/* App Updates Card */}
                  <div className="settings-card-group">
                    <div className="settings-card-group-hdr">App Updates</div>
                    <div className="settings-row">
                      <div className="settings-row-left">
                        <div className="settings-row-text">
                          <span className="settings-row-label">Flux v{CURRENT_APP_VERSION}</span>
                          <span className="settings-row-sub">
                            {updateInfo?.hasUpdate ? `Update v${updateInfo.version} Available!` : "Up to date"}
                          </span>
                        </div>
                      </div>
                      <button
                        onClick={handleManualUpdateCheck}
                        disabled={isCheckingUpdate}
                        className="ringtone-change-btn"
                        style={{ minWidth: 85 }}
                      >
                        {isCheckingUpdate ? "Checking…" : "Check Now"}
                      </button>
                    </div>
                    {updateInfo?.hasUpdate && (
                      <div style={{ margin: "8px 16px 14px", display: "flex", flexDirection: "column", gap: 8, padding: 12, background: "rgba(var(--green-rgb), 0.08)", borderRadius: 10, border: "1px solid rgba(var(--green-rgb), 0.25)" }}>
                        <div style={{ fontSize: 12, color: "var(--text-1)", fontWeight: 500 }}>
                          🚀 A new update (v{updateInfo.version}) is available from the backend server!
                        </div>
                        <button
                          onClick={() => applyAppUpdate(updateInfo.url)}
                          className="sb-go-btn"
                          style={{ margin: 0, padding: "8px 14px", background: "var(--green)", color: "#000", fontWeight: "bold" }}
                        >
                          ⬇️ Install Update
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Log Out */}
                  <button
                    onClick={logout}
                    className="sb-bottom-btn"
                    style={{
                      marginTop: 8,
                      background: "rgba(244, 67, 54, 0.12)",
                      border: "1px solid rgba(244, 67, 54, 0.3)",
                      color: "var(--danger)",
                      height: 44,
                      borderRadius: 12,
                      fontWeight: 700
                    }}
                  >
                    🚪 Log Out of Flux
                  </button>
                </div>
              </div>
            )}

            {showStatusUI ? (
              <StatusScreen
                statusGroups={statusGroups}
                currentUserEmail={currentUser}
                currentUserDisplayName={profile.displayName || currentUser}
                currentUserAvatarUrl={profile.avatarUrl}
                onOpenViewer={(group) => setActiveViewingStatusGroup(group)}
                onOpenTextCreator={() => setShowStatusCreator("text")}
                onOpenMediaCreator={() => setShowStatusCreator("media")}
                onRefresh={loadStatuses}
                loading={loadingStatuses}
              />
            ) : (
              <>
                <div className="sb-divider" />

                <div className="sb-search-container">
                  <div className="sb-search-wrap">
                    <svg className="sb-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
                    <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search here..." className="sb-search-input" />
                    {searchQuery && <button onClick={() => setSearchQuery("")} className="sb-search-clear" aria-label="Clear search">✕</button>}
                  </div>
                  {totalUnread > 0 && (
                    <button onClick={e => { e.stopPropagation(); markAllRead(); }} className="sb-mark-read-btn">✓ All</button>
                  )}
                </div>

                {/* ── CHAT FILTER CHIPS (All | Direct | Groups | Unread) ── */}
                <div className="chat-filter-chips">
                  <button
                    className={`chat-filter-chip ${sidebarFilter === "all" ? "active" : ""}`}
                    onClick={() => setSidebarFilter("all")}
                  >
                    All
                  </button>
                  <button
                    className={`chat-filter-chip ${sidebarFilter === "direct" ? "active" : ""}`}
                    onClick={() => setSidebarFilter("direct")}
                  >
                    Direct
                  </button>
                  <button
                    className={`chat-filter-chip ${sidebarFilter === "groups" ? "active" : ""}`}
                    onClick={() => setSidebarFilter("groups")}
                  >
                    Groups {groups.length > 0 && <span className="chat-filter-chip-count">{groups.length}</span>}
                  </button>
                  <button
                    className={`chat-filter-chip ${sidebarFilter === "unread" ? "active" : ""}`}
                    onClick={() => setSidebarFilter("unread")}
                  >
                    Unread {totalUnread > 0 && <span className="chat-filter-chip-count">{totalUnread}</span>}
                  </button>
                </div>

                {searchQuery.trim() !== "" && sortedChats.length === 0 && searchMessageResults.length === 0 ? (
                  <div className="sb-empty-state">
                    <div className="sb-empty-state-icon">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
                    </div>
                    <div className="sb-empty-state-title">No results found</div>
                    <p className="sb-empty-state-text">No contacts, groups, or messages match &ldquo;{searchQuery}&rdquo;</p>
                  </div>
                ) : (
                  <>
                    {searchQuery && searchMessageResults.length > 0 && (
                      <div className="sb-section search-results-section">
                        <div className="sb-section-hdr"><div className="sb-section-label-group"><span className="sb-section-label-text">Messages</span></div></div>
                        <div className="sb-list">
                          {searchMessageResults.map(m => {
                            const groupName = groups.find(g => String(g.id) === String(m.chatId))?.name;
                            const c = contacts.find(c => c.email === String(m.chatId));
                            const chatName = m.chatType === "group" ? groupName : (c ? contactLabel(c) : "Unknown User");
                            return (
                              <button key={`${m.chatId}-${m.id}`} className="sb-item" onClick={() => openChat({ type: m.chatType, id: String(m.chatId), name: String(chatName || "Chat") })}>
                                <div className="sb-item-body mw-0">
                                  <span className="sb-item-name name-row" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                    <span className="text-truncate" style={{ flexShrink: 1 }}>{String(chatName || "Chat")}</span>
                                    {m.chatType === "group" && <span className="group-badge" style={{ flexShrink: 0 }}>Group</span>}
                                  </span>
                                  <span className="sb-item-status text-truncate">{m.content}</span>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                        <div className="sb-divider" />
                      </div>
                    )}

                    <div className="sb-section">
                      <div className="sb-section-hdr">
                        <div className="sb-section-label-group">
                          {sidebarFilter === "groups" ? (
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
                          ) : (
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" /></svg>
                          )}
                          <span className="sb-section-label-text">
                            {sidebarFilter === "groups"
                              ? `Groups (${groups.length})`
                              : sidebarFilter === "direct"
                              ? `Direct Chats (${contacts.length})`
                              : sidebarFilter === "unread"
                              ? "Unread Chats"
                              : "All Chats"}
                          </span>
                        </div>
                      </div>

                      {sidebarFilter === "groups" && (
                        <div style={{ padding: "4px 12px 10px" }}>
                          <button
                            onClick={() => setShowNewGroup(true)}
                            style={{
                              width: "100%",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              gap: 8,
                              padding: "11px 16px",
                              background: "#ebf5ee",
                              color: "#6daf78",
                              border: "1.5px dashed rgba(109, 175, 120, 0.45)",
                              borderRadius: "16px",
                              fontWeight: 700,
                              fontSize: "13.5px",
                              cursor: "pointer",
                              transition: "all 0.15s ease"
                            }}
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <line x1="12" y1="5" x2="12" y2="19" />
                              <line x1="5" y1="12" x2="19" y2="12" />
                            </svg>
                            Create New Group
                          </button>
                        </div>
                      )}

                      {sidebarFilter === "groups" && groups.length === 0 && !searchQuery ? (
                        <div style={{ padding: "36px 20px", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center" }}>
                          <div style={{ width: 52, height: 52, borderRadius: "50%", background: "#ebf5ee", color: "#6daf78", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 12 }}>
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                              <circle cx="9" cy="7" r="4" />
                              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                            </svg>
                          </div>
                          <div style={{ fontSize: 15, fontWeight: 700, color: "#181c1f", marginBottom: 4 }}>No Groups Yet</div>
                          <p style={{ fontSize: 12.5, color: "#8a9096", margin: "0 0 14px", maxWidth: 220 }}>Create a group to start group chats with friends.</p>
                          <button
                            onClick={() => setShowNewGroup(true)}
                            style={{ background: "#6daf78", color: "#ffffff", border: "none", borderRadius: 20, padding: "8px 18px", fontWeight: 700, fontSize: 13, cursor: "pointer", boxShadow: "0 4px 12px rgba(109, 175, 120, 0.35)" }}
                          >
                            + Create Group
                          </button>
                        </div>
                      ) : (
                        <div className="sb-list">
                          {sortedChats.map(chat => {
                            if (chat.type === "user") {
                              const c = chat.item;
                              return (
                                <ContactItem
                                  key={c.email}
                                  contact={c}
                                  isActive={activeChat?.id === c.email}
                                  isDeleteTarget={sidebarDeleteId === c.email}
                                  label={contactLabel(c)}
                                  lastActivityTs={chat.lastActivityTs}
                                  onOpen={() => openChat({ type: "user", id: c.email, name: contactLabel(c) })}
                                  onDelete={() => deleteChat("user", c.email)}
                                  onDeleteTarget={setSidebarDeleteId}
                                  onClearDelete={() => setSidebarDeleteId(null)}
                                  onOpenProfile={() => {
                                    openChat({ type: "user", id: c.email, name: contactLabel(c) });
                                    setOpenedProfileFromSidebar(true);
                                    setShowContactProfile(true);
                                  }}
                                />
                              );
                            } else {
                              const g = chat.item;
                              return (
                                <GroupItem
                                  key={g.id}
                                  group={g}
                                  isActive={activeChat?.id === g.id}
                                  isDeleteTarget={sidebarDeleteId === String(g.id)}
                                  lastActivityTs={chat.lastActivityTs}
                                  onOpen={() => openChat({ type: "group", id: g.id, name: g.name })}
                                  onDelete={() => deleteChat("group", g.id)}
                                  onDeleteTarget={setSidebarDeleteId}
                                  onClearDelete={() => setSidebarDeleteId(null)}
                                  onOpenProfile={() => {
                                    openChat({ type: "group", id: g.id, name: g.name });
                                    setOpenedProfileFromSidebar(true);
                                    setShowGroupProfile(true);
                                  }}
                                />
                              );
                            }
                          })}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </>
            )}

            <div className="sb-footer-sticky">
              {/* ── FLOATING BOTTOM DOCK NAVIGATION ── */}
              <nav className="floating-bottom-dock">
                <button
                  className={`dock-item-btn ${!showStatusUI && !showCallLogUI && !showMyProfileSettings ? "active" : ""}`}
                  onClick={() => {
                    setShowStatusUI(false);
                    setShowCallLogUI(false);
                    setShowMyProfileSettings(false);
                  }}
                  aria-label="Chats"
                  title="Chats"
                >
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                </button>

                <button
                  className={`dock-item-btn ${showCallLogUI ? "active" : ""}`}
                  onClick={() => {
                    setShowStatusUI(false);
                    setShowMyProfileSettings(false);
                    setShowCallLogUI(true);
                    markMissedCallsAsSeen();
                  }}
                  aria-label="Calls"
                  title="Calls"
                >
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.62 3.33 2 2 0 0 1 3.6 1.37h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 9a16 16 0 0 0 6.09 6.09l1.97-1.85a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7a2 2 0 0 1 1.72 2.03z" />
                  </svg>
                  {unreadMissedCount > 0 && (
                    <span
                      style={{
                        position: "absolute",
                        top: 4,
                        right: 4,
                        background: "#ef4444",
                        color: "#ffffff",
                        fontSize: 10,
                        fontWeight: 800,
                        minWidth: 16,
                        height: 16,
                        borderRadius: 10,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: "0 4px",
                        border: "1.5px solid #ffffff",
                        boxShadow: "0 2px 6px rgba(239, 68, 68, 0.4)"
                      }}
                    >
                      {unreadMissedCount > 9 ? "9+" : unreadMissedCount}
                    </span>
                  )}
                </button>

                {/* ── DOCK BUTTON 3: STATUS (REPLACES OLD GROUPS) ── */}
                <button
                  className={`dock-item-btn ${showStatusUI && !showCallLogUI && !showMyProfileSettings ? "active" : ""}`}
                  onClick={() => {
                    setShowCallLogUI(false);
                    setShowMyProfileSettings(false);
                    setShowStatusUI(true);
                    loadStatuses();
                  }}
                  aria-label="Status"
                  title="Status"
                >
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" strokeDasharray="5 3" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                  {hasUnviewedStatuses && (
                    <span
                      style={{
                        position: "absolute",
                        top: 6,
                        right: 6,
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        background: "#6daf78",
                        border: "1.5px solid #ffffff",
                        boxShadow: "0 1px 4px rgba(109, 175, 120, 0.5)",
                      }}
                    />
                  )}
                </button>

                <button
                  className={`dock-item-btn ${showMyProfileSettings ? "active" : ""}`}
                  onClick={() => {
                    setShowStatusUI(false);
                    setShowCallLogUI(false);
                    setShowMyProfileSettings(true);
                  }}
                  aria-label="Settings"
                  title="Settings & Profile"
                >
                  <div className="dock-avatar-thumb">
                    {profile.avatarUrl ? (
                      <AvatarImage src={profile.avatarUrl} alt="Avatar" fallbackText={profile.displayName || profile.username || currentUser} className="img-cover rounded-circle" />
                    ) : (
                      <span>{(profile.displayName || currentUser)?.[0]?.toUpperCase() || "U"}</span>
                    )}
                  </div>
                </button>
              </nav>
            </div>
          </aside>

          {/* ── CHAT MAIN ─────────────────────────────────────────────────────── */}
          <main className="chat">
            {!chat ? (
              <div className="empty-state">
                <div className="empty-rings" style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <div className="ring r1" /><div className="ring r2" /><div className="ring r3" />
                  <img className="z-1-relative" src="/icon.png" alt="Flux" style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 16, boxShadow: "0 10px 28px rgba(109, 175, 120, 0.28)" }} />
                </div>
                <h3>No conversation open</h3>
                <p>Select a contact or group to start messaging</p>
              </div>
            ) : (
              <>
                {/* ── HEADER ── */}
                <header className="chat-hdr">
                  {selectedMsgIds.size > 0 ? (() => {
                    const selectedMsgs = messages.filter(m => selectedMsgIds.has(m.id));
                    const isSingle = selectedMsgs.length === 1;
                    const singleMsg = selectedMsgs[0];
                    const isSingleMine = isSingle && singleMsg?.user === currentUser;
                    const hasCallRecord = selectedMsgs.some(m => m._callRecord);
                    return (
                      <div className="msg-selection-header-content" style={{ display: "flex", width: "100%", alignItems: "center", justifyContent: "space-between" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0, overflow: "hidden" }}>
                          <button
                            className="tool-btn"
                            style={{ width: 34, height: 34, borderRadius: "50%", background: "var(--surface-hover)", border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
                            onClick={() => toggleSelectMsg(null)}
                            aria-label="Cancel selection"
                          >
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                              <line x1="18" y1="6" x2="6" y2="18" />
                              <line x1="6" y1="6" x2="18" y2="18" />
                            </svg>
                          </button>
                          <span style={{ fontSize: 15, fontWeight: 650, color: "#fff", whiteSpace: "nowrap" }}>
                            {selectedMsgIds.size} {selectedMsgIds.size === 1 ? "message" : "messages"} selected
                          </span>
                        </div>
                        <div className="hdr-action-buttons" style={{ display: "flex", gap: 6, flexShrink: 0, alignItems: "center" }}>
                          {isSingle && singleMsg && !singleMsg._callRecord && (
                            <>
                              {(() => {
                                const isPinned = (pinnedMessages[String(chat.id)] || []).some(m => m.id === singleMsg.id);
                                return (
                                  <button
                                    onClick={() => togglePinMessage(singleMsg)}
                                    className={`tool-btn ${isPinned ? "active-pin" : ""}`}
                                    title={isPinned ? "Unpin message" : "Pin message"}
                                    aria-label={isPinned ? "Unpin message" : "Pin message"}
                                    style={{ color: isPinned ? "#6daf78" : "inherit" }}
                                  >
                                    <svg width="17" height="17" viewBox="0 0 24 24" fill={isPinned ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                      <line x1="12" y1="17" x2="12" y2="22" />
                                      <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.89A2 2 0 0 1 15 10.77V6a3 3 0 0 0-6 0v4.77a2 2 0 0 1-1.11 1.79l-1.78.89A2 2 0 0 0 5 15.24V17z" />
                                    </svg>
                                  </button>
                                );
                              })()}
                              <button
                                onClick={() => { setReplyingTo(singleMsg); toggleSelectMsg(null); }}
                                className="tool-btn"
                                title="Reply"
                                aria-label="Reply to message"
                              >
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                  <polyline points="9 14 4 9 9 4" />
                                  <path d="M20 20v-7a4 4 0 0 0-4-4H4" />
                                </svg>
                              </button>
                            </>
                          )}
                          {!hasCallRecord && (
                            <button
                              onClick={() => {
                                const sorted = [...selectedMsgs].sort((a, b) => parseTs(a.timestamp).getTime() - parseTs(b.timestamp).getTime());
                                setForwardingMsgs(sorted);
                                setShowForwardPicker(true);
                                toggleSelectMsg(null);
                              }}
                              className="tool-btn"
                              title="Forward"
                              aria-label="Forward message"
                            >
                              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="15 14 20 9 15 4" />
                                <path d="M4 20v-7a4 4 0 0 1 4-4h12" />
                              </svg>
                            </button>
                          )}
                          {isSingle && isSingleMine && singleMsg && !singleMsg._callRecord && (
                            <>
                              <button
                                onClick={() => { setEditingId(singleMsg.id); setEditingText(singleMsg.content); toggleSelectMsg(null); }}
                                className="tool-btn"
                                title="Edit"
                                aria-label="Edit message"
                              >
                                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                                </svg>
                              </button>
                              {chat.type === "group" && (
                                <button
                                  onClick={() => { setMessageInfoMsg(singleMsg); toggleSelectMsg(null); }}
                                  className="tool-btn"
                                  title="Message Info"
                                  aria-label="View message info"
                                >
                                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                    <circle cx="12" cy="12" r="10" />
                                    <line x1="12" y1="16" x2="12" y2="12" />
                                    <line x1="12" y1="8" x2="12.01" y2="8" />
                                  </svg>
                                </button>
                              )}
                            </>
                          )}
                          <button
                            onClick={() => {
                              promptDeleteMsgs(selectedMsgs);
                            }}
                            className="tool-btn del-action"
                            title="Delete"
                            aria-label="Delete message"
                          >
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="3 6 5 6 21 6" />
                              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                              <line x1="10" y1="11" x2="10" y2="17" />
                              <line x1="14" y1="11" x2="14" y2="17" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    );
                  })() : (
                    <>
                      <div className="chat-hdr-left">
                        <button className="mobile-back-btn" onClick={() => setActiveChat(null)} aria-label="Back to chat list">
                          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6" /></svg>
                        </button>
                        <div
                          className={`hdr-av ${chat.type === "group" ? "hdr-av--group" : ""} cursor-pointer pointer-relative`}
                          onClick={() => chat.type === "user" ? setShowContactProfile(true) : setShowGroupProfile(true)}
                        >
                          {(() => {
                            if (chat.type === "user") {
                              const peerContact = contacts.find(c => c.email.toLowerCase() === String(chat.id).toLowerCase());
                              return peerContact?.avatar_url
                                ? <AvatarImage src={peerContact.avatar_url} alt="avatar" fallbackText={chat.name || contactLabel(peerContact)} className="img-cover rounded-circle" />
                                : chat.name?.[0]?.toUpperCase() || "?";
                            } else {
                              const grp = groups.find(g => String(g.id) === String(chat.id));
                              return grp?.avatar_url
                                ? <AvatarImage src={grp.avatar_url} alt="group" fallbackText={grp.name || chat.name} className="img-cover rounded-circle" />
                                : chat.name?.[0]?.toUpperCase() || "?";
                            }
                          })()}
                          <div className="hdr-av-overlay">view</div>
                        </div>
                        <div className="hdr-info">
                          <div className="name-row-inline">
                            <span className="hdr-name">
                              {chat.type === "user"
                                ? (() => { const c = contacts.find(c => c.email.toLowerCase() === String(chat.id).toLowerCase()); return c ? contactLabel(c) : (nicknames[String(chat.id).toLowerCase()] || chat.name || String(chat.id).split("@")[0]); })()
                                : chat.name}
                            </span>
                            {chat.type === "group" && <span className="group-badge" style={{ flexShrink: 0 }}>Group</span>}
                            {chat.type === "user" && !contacts.some(c => c.email.toLowerCase() === String(chat.id).toLowerCase()) && (
                              <span style={{ fontSize: "10px", padding: "2px 7px", borderRadius: "10px", background: "rgba(239, 68, 68, 0.15)", color: "#ef4444", fontWeight: 600, marginLeft: "6px", flexShrink: 0 }}>
                                Not in contacts
                              </span>
                            )}
                            {chat.type === "user" && (
                              <button onClick={openHeaderNicknameEdit} className={`btn-pencil-nickname ${showHeaderNicknameEdit ? "active" : ""}`} aria-label="Edit nickname">
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                              </button>
                            )}
                          </div>
                          {chat.type === "user" && (() => { const c = contacts.find(c => c.email.toLowerCase() === String(chat.id).toLowerCase()); return c?.username ? <span className="hdr-meta hdr-meta-nickname">@{c.username}</span> : null; })()}
                          <span className="hdr-meta">
                            {chat.type === "user" ? (
                              <><span className={`hdr-dot ${contacts.find(c => c.email.toLowerCase() === String(chat.id).toLowerCase())?.is_online ? "hdr-dot--on" : ""}`} />{contacts.find(c => c.email.toLowerCase() === String(chat.id).toLowerCase())?.is_online ? "Online" : "Offline"}</>
                            ) : <>{groups.find(g => String(g.id) === String(chat.id))?.members.length || "?"} members</>}
                          </span>
                        </div>
                      </div>
                      <div className="hdr-right">
                        <button onClick={() => startCall(false)} className="tool-btn" title="Voice Call" aria-label="Start voice call">
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.62 3.33 2 2 0 0 1 3.6 1.37h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 9a16 16 0 0 0 6.09 6.09l1.97-1.85a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7a2 2 0 0 1 1.72 2.03z" /></svg>
                        </button>
                        <button onClick={() => startCall(true)} className="tool-btn" title="Video Call" aria-label="Start video call">
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" /></svg>
                        </button>

                        <div style={{ position: "relative" }}>
                          <button
                            onClick={e => { e.stopPropagation(); setShowMuteMenu(!showMuteMenu); }}
                            className={`tool-btn ${isChatMuted(String(chat.id)) ? "tool-btn--on" : ""}`}
                            title="Chat Options"
                            aria-label="Chat Options"
                          >
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="1" /><circle cx="12" cy="5" r="1" /><circle cx="12" cy="19" r="1" /></svg>
                          </button>
                          {showMuteMenu && (
                            <div style={{ position: "absolute", top: "calc(100% + 8px)", right: 0, zIndex: 900, background: "#ffffff", border: "1px solid var(--border)", borderRadius: "var(--r-lg)", boxShadow: "0 8px 24px rgba(0,0,0,0.12)", minWidth: 180, overflow: "hidden" }} onClick={e => e.stopPropagation()}>
                              <button className="mute-menu-item" onClick={() => { setShowMuteMenu(false); if (chat.type === "user") setShowContactProfile(true); else setShowGroupProfile(true); }}>
                                👤 View Profile
                              </button>
                              {isChatMuted(String(chat.id)) ? (
                                <button className="mute-menu-item" onClick={() => unmuteChat(String(chat.id), chat.type)}>🔔 Unmute Notifications</button>
                              ) : (
                                <>
                                  <div style={{ padding: "8px 14px 4px", fontSize: 10, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Mute for…</div>
                                  {(["8h", "1w", "forever"] as const).map(d => (
                                    <button key={d} className="mute-menu-item" onClick={() => muteChat(String(chat.id), chat.type, d)}>
                                      {d === "8h" ? "🔕 8 hours" : d === "1w" ? "🔕 1 week" : "🔕 Forever"}
                                    </button>
                                  ))}
                                </>
                              )}
                              <button
                                className="mute-menu-item"
                                style={{ color: "#e67e22", borderTop: "1px solid var(--border)" }}
                                onClick={() => {
                                  setShowMuteMenu(false);
                                  showConfirm("Clear all messages in this chat? Past messages will be permanently cleared for you.", () => clearChat(chat.type, chat.id));
                                }}
                              >
                                🧹 Clear Chat
                              </button>
                              <button
                                className="mute-menu-item"
                                style={{ color: "var(--danger)" }}
                                onClick={() => {
                                  setShowMuteMenu(false);
                                  showConfirm("Delete this chat? It will be hidden from your chats list until a new message arrives.", () => deleteChat(chat.type, chat.id));
                                }}
                              >
                                🗑 Delete Chat
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </>
                  )}
                </header>

                {/* ── PINS BANNER ── */}
                {(() => {
                  const chatId = String(chat.id);
                  const chatPins = (pinnedMessages[chatId] || []).filter(m => !deletedForMeIds.has(String(m.id)));
                  if (chatPins.length === 0) return null;
                  const latestPin = chatPins[chatPins.length - 1];
                  return (
                    <div className="pin-bar">
                      <div className="pin-bar-content" onClick={() => scrollToPinnedMessage(latestPin.id)}>
                        <span className="pin-bar-title">📌 Pinned Message</span>
                        <span className="pin-bar-text">
                          {formatNotificationMedia(latestPin.content)}
                        </span>
                      </div>
                      <div className="pin-bar-actions">
                        <button className="pin-bar-btn" onClick={() => togglePinMessage(latestPin)} aria-label="Unpin">✕</button>
                      </div>
                    </div>
                  );
                })()}


                {showHeaderNicknameEdit && chat.type === "user" && (
                  <div className="nickname-edit-panel">
                    <span className="nickname-edit-label">🏷 Nickname:</span>
                    <input
                      value={headerNicknameValue}
                      onChange={e => setHeaderNicknameValue(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") saveContactNickname(String(chat.id), headerNicknameValue); if (e.key === "Escape") setShowHeaderNicknameEdit(false); }}
                      placeholder={(() => { const c = contacts.find(c => c.email === chat.id); return `Nickname for ${c?.display_name || (c?.username ? `@${c.username}` : chat.name)}`; })()}
                      className="sb-field nickname-edit-input"
                      autoFocus
                    />
                    <div className="nickname-edit-actions">
                      <button onClick={() => saveContactNickname(String(chat.id), headerNicknameValue)} className="sb-go-btn btn-save-sm">Save</button>
                      {nicknames[String(chat.id)] && <button onClick={() => saveContactNickname(String(chat.id), "")} className="sb-go-btn btn-clear-sm">Clear</button>}
                      <button onClick={() => setShowHeaderNicknameEdit(false)} className="sb-go-btn btn-close-sm" aria-label="Close nickname editor">✕</button>
                    </div>
                  </div>
                )}

                {/* ── MESSAGE LIST ── */}
                <div
                  ref={msgListRef}
                  className="msg-list"
                  onClick={handleAppClick}
                  onScroll={handleScroll}
                  style={{ position: "relative" }}
                >
                  <div ref={loadMoreSentinelRef} style={{ height: 1, position: "absolute", top: 0, left: 0, right: 0 }} />
                  {loadingMore && (
                    <div className="load-more-row" style={{ position: "absolute", top: 10, left: "50%", transform: "translateX(-50%)", zIndex: 10, background: "var(--surface-2)", border: "1px solid var(--border)", padding: "6px 16px", borderRadius: 100, boxShadow: "0 4px 12px rgba(0,0,0,0.15)" }}>
                      <span className="spinner" style={{ width: 14, height: 14 }} />
                      <span style={{ fontSize: 12, color: "var(--text-2)", marginLeft: 6 }}>Loading older messages…</span>
                    </div>
                  )}

                  {isLoadingHistory ? (
                    <div className="skeleton-container">
                      {[
                        { cls: "theirs", lines: ["short", "long"] },
                        { cls: "mine", lines: ["medium"] },
                        { cls: "theirs", lines: ["long", "short"] },
                        { cls: "mine", lines: ["long"] },
                      ].map((b, i) => (
                        <div key={i} className={`skeleton-bubble ${b.cls}`}>
                          {b.lines.map((l, j) => <div key={j} className={`skeleton-line ${l}`} />)}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ height: `${rowVirtualizer.getTotalSize()}px`, width: "100%", position: "relative" }}>
                      {rowVirtualizer.getVirtualItems().map(virtualRow => {
                        const item = groupedMessages[virtualRow.index];
                        if (!item) return null;
                        return (
                          <div
                            key={virtualRow.key}
                            ref={rowVirtualizer.measureElement}
                            data-index={virtualRow.index}
                            style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${virtualRow.start}px)` }}
                          >
                            {item.type === "divider" ? (
                              <div className="date-sep"><span>{item.label}</span></div>
                            ) : (
                              <MessageBubble
                                item={item}
                                isSelected={selectedMsgIds.has(item.id)}
                                isSelectionModeActive={selectedMsgIds.size > 0}
                                isEditing={editingId === item.id}
                                editingText={editingText}
                                reactionPickerId={reactionPickerId}
                                chatType={chat.type}
                                isFailed={failedMsgIds.has(String(item.id))}
                                isPending={String(item.id).startsWith("temp-") && !failedMsgIds.has(String(item.id))}
                                onReply={handleReply}
                                onForward={handleForward}
                                onEditStart={handleEditStart}
                                onEditSave={saveEdit}
                                onEditCancel={handleEditCancel}
                                onEditChange={setEditingText}
                                onDelete={handleDeleteMsg}
                                onReaction={sendReaction}
                                onSetReactionPicker={setReactionPickerId}
                                onViewFile={handleViewFile}
                                onSelectMsg={toggleSelectMsg}
                                onRetry={retryMessage}
                                highlightedMsgId={highlightedMsgId}
                                onCallTap={handleCallTap}
                                onJumpToMessage={handleJumpToMessage}
                              />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* ── TYPING ── */}
                <div className="typing-area">
                  {isTyping && (
                    <div className="typing-pill">
                      <span className="td" /><span className="td" /><span className="td" />
                      <span>{(() => { const c = contacts.find(c => c.email === String(chat.id)); return c ? contactLabel(c) : chat.name; })()} is typing…</span>
                    </div>
                  )}
                </div>

                {/* ── REPLY BANNER ── */}
                {replyingTo && (
                  <div className="reply-banner">
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--green)", marginBottom: 2 }}>
                        ↩ Replying to {replyingTo.user?.toLowerCase() === currentUser?.toLowerCase() ? "yourself" : (replyingTo.sender_name || getPeerName(replyingTo.user))}
                      </div>
                      <div style={{ fontSize: 12, color: "var(--text-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {formatNotificationMedia(replyingTo.content)}
                      </div>
                    </div>
                    <button onClick={() => setReplyingTo(null)} style={{ marginLeft: 8, padding: "4px 8px", border: "none", background: "none", cursor: "pointer", fontSize: 16, color: "var(--text-3)" }} aria-label="Cancel reply">✕</button>
                  </div>
                )}

                {chat.type === "user" && !contacts.some(c => c.email.toLowerCase() === String(chat.id).toLowerCase()) ? (
                  <div
                    style={{
                      padding: "16px 20px",
                      background: "#f9fafb",
                      borderTop: "1px solid rgba(0,0,0,0.08)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 14,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <div
                        style={{
                          width: 40,
                          height: 40,
                          borderRadius: "50%",
                          background: "rgba(109, 175, 120, 0.12)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          color: "#4e9158",
                          flexShrink: 0,
                        }}
                      >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="8.5" cy="7" r="4" /><line x1="20" y1="8" x2="20" y2="14" /><line x1="23" y1="11" x2="17" y2="11" />
                        </svg>
                      </div>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: "#181c1f" }}>
                          You and {chat.name} are not contacts
                        </div>
                        <div style={{ fontSize: 12, color: "#8a9096" }}>
                          Add as contact to send messages, calls, and see online status.
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setAddContactPrefill(String(chat.id));
                        setShowAddContactModal(true);
                      }}
                      style={{
                        padding: "9px 18px",
                        borderRadius: 12,
                        border: "none",
                        background: "#6daf78",
                        color: "#ffffff",
                        fontWeight: 700,
                        fontSize: 13,
                        cursor: "pointer",
                        whiteSpace: "nowrap",
                        boxShadow: "0 2px 8px rgba(109, 175, 120, 0.25)",
                      }}
                    >
                      + Add Contact
                    </button>
                  </div>
                ) : (
                  <MessageInputSection
                    activeChat={activeChat}
                    currentUser={currentUser}
                    token={token}
                    apiFetch={apiFetch}
                    isRecording={isRecording}
                    recordingDuration={recordingDuration}
                    isUploadingAttachment={isUploadingAttachment}
                    replyingTo={replyingTo}
                    setReplyingTo={setReplyingTo}
                    showEmojiPanel={showEmojiPanel}
                    setShowEmojiPanel={setShowEmojiPanel}
                    emojiPanelTab={emojiPanelTab}
                    setEmojiPanelTab={setEmojiPanelTab}
                    showEmojis={showEmojis}
                    setShowEmojis={setShowEmojis}
                    showStickers={showStickers}
                    setShowStickers={setShowStickers}
                    setShowCameraDrawer={setShowCameraDrawer}
                    setShowPlusDrawer={setShowPlusDrawer}
                    pendingFile={pendingFile}
                    pendingFiles={pendingFiles}
                    fileInputRef={fileInputRef}
                    cameraPhotoInputRef={cameraPhotoInputRef}
                    cameraVideoInputRef={cameraVideoInputRef}
                    cancelRecordingRef={cancelRecordingRef}
                    handleFile={handleFile}
                    isNarrowScreen={isNarrowScreen}
                    toggleRecording={toggleRecording}
                    onSendMessage={sendMessage}
                    onSendSticker={sendSticker}
                    onTakePhoto={takeNativePhoto}
                    onPickFile={pickNativeGallery}
                    wsSend={wsSend}
                  />
                )}
              </>
            )}
          </main>
        </div>
      )}

      {/* ── START NEW CHAT MODAL (Search by @username) ──────────────────── */}
      {showNewContact && (
        <div
          className="modal-backdrop-sage"
          style={{ zIndex: 10001 }}
          onClick={() => { setShowNewContact(false); setNewContactUsername(""); }}
        >
          <div
            className="cl-modal"
            style={{
              maxWidth: 380,
              width: "92vw",
              borderRadius: 24,
              display: "flex",
              flexDirection: "column",
              padding: 0,
              overflow: "hidden",
              background: "#ffffff",
              boxShadow: "0 16px 40px rgba(0,0,0,0.12)",
              border: "1px solid rgba(0,0,0,0.06)"
            }}
            onClick={e => e.stopPropagation()}
          >
            <div
              className="cl-header"
              style={{
                padding: "18px 20px 14px",
                borderBottom: "1px solid rgba(0,0,0,0.06)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                background: "#ffffff"
              }}
            >
              <h2 className="cl-title" style={{ fontSize: 19, fontWeight: 800, color: "#181c1f", margin: 0 }}>
                Start New Chat
              </h2>
              <button
                className="cl-close"
                onClick={() => { setShowNewContact(false); setNewContactUsername(""); }}
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: "50%",
                  background: "#f4f5f7",
                  border: "none",
                  color: "#181c1f",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                  fontSize: 14,
                  fontWeight: 700
                }}
              >
                ✕
              </button>
            </div>

            <div style={{ padding: "18px 20px 22px", display: "flex", flexDirection: "column", gap: 14, background: "#ffffff" }}>
              <button
                type="button"
                onClick={() => {
                  setShowNewContact(false);
                  setNewContactUsername("");
                  setShowNewGroup(true);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "12px 14px",
                  borderRadius: 14,
                  background: "rgba(109, 175, 120, 0.08)",
                  border: "1px solid rgba(109, 175, 120, 0.22)",
                  cursor: "pointer",
                  textAlign: "left",
                  transition: "all 0.15s ease",
                  width: "100%",
                  boxSizing: "border-box"
                }}
              >
                <div style={{
                  width: 36,
                  height: 36,
                  borderRadius: "50%",
                  background: "#6daf78",
                  color: "#ffffff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 16,
                  flexShrink: 0
                }}>
                  👥
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 14, color: "#181c1f" }}>Create New Group</div>
                  <div style={{ fontSize: 12, color: "#5e646a" }}>Chat with multiple contacts together</div>
                </div>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#6daf78" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.8 }}>
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>

              <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "2px 0" }}>
                <div style={{ flex: 1, height: 1, background: "rgba(0,0,0,0.08)" }} />
                <span style={{ fontSize: 11, color: "#8a9096", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>or direct message</span>
                <div style={{ flex: 1, height: 1, background: "rgba(0,0,0,0.08)" }} />
              </div>

              <p style={{ fontSize: 13, color: "#5e646a", margin: 0, lineHeight: 1.4 }}>
                Enter the username of the person you want to chat with:
              </p>

              <div style={{ position: "relative" }}>
                <span
                  style={{
                    position: "absolute",
                    left: 14,
                    top: "50%",
                    transform: "translateY(-50%)",
                    color: "#6daf78",
                    fontWeight: 800,
                    fontSize: 16
                  }}
                >
                  @
                </span>
                <input
                  value={newContactUsername}
                  onChange={e => setNewContactUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))}
                  onKeyDown={e => {
                    if (e.key === "Enter" && newContactUsername.trim()) {
                      addContactByUsername(newContactUsername.trim());
                      setNewContactUsername("");
                      setShowNewContact(false);
                    }
                  }}
                  placeholder="username"
                  autoFocus
                  style={{
                    width: "100%",
                    height: 48,
                    paddingLeft: 34,
                    paddingRight: 14,
                    background: "#f4f5f7",
                    border: "1.5px solid rgba(0,0,0,0.06)",
                    borderRadius: 14,
                    fontSize: 15,
                    fontWeight: 600,
                    color: "#181c1f",
                    outline: "none"
                  }}
                />
              </div>

              <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
                <button
                  onClick={() => { setShowNewContact(false); setNewContactUsername(""); }}
                  style={{
                    flex: 1,
                    height: 44,
                    borderRadius: 14,
                    background: "#f4f5f7",
                    border: "none",
                    color: "#5e646a",
                    fontWeight: 700,
                    fontSize: 14,
                    cursor: "pointer"
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    if (newContactUsername.trim()) {
                      addContactByUsername(newContactUsername.trim());
                      setNewContactUsername("");
                      setShowNewContact(false);
                    }
                  }}
                  style={{
                    flex: 1.4,
                    height: 44,
                    borderRadius: 14,
                    background: "#6daf78",
                    border: "none",
                    color: "#ffffff",
                    fontWeight: 700,
                    fontSize: 14,
                    cursor: "pointer",
                    boxShadow: "0 4px 12px rgba(109, 175, 120, 0.3)"
                  }}
                >
                  Start Chat
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── CREATE GROUP MODAL ────────────────────────────────────────────── */}
      {showNewGroup && (
        <div className="modal-backdrop-sage" onClick={() => setShowNewGroup(false)}>
          <div className="group-create-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 460, width: "94vw", borderRadius: 28, display: "flex", flexDirection: "column", padding: 0, overflow: "hidden", background: "#ffffff", boxShadow: "0 16px 40px rgba(0,0,0,0.12)", border: "1px solid rgba(0,0,0,0.06)" }}>
            <div className="cl-header" style={{ padding: "18px 22px 14px", borderBottom: "1px solid rgba(0,0,0,0.06)", display: "flex", alignItems: "center", justifyContent: "space-between", background: "#ffffff" }}>
              <h2 className="cl-title" style={{ fontSize: 20, fontWeight: 800, color: "#181c1f", margin: 0 }}>Create New Group</h2>
              <button className="cl-close" onClick={() => setShowNewGroup(false)} style={{ width: 34, height: 34, borderRadius: "50%", background: "#f4f5f7", border: "none", color: "#181c1f", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 14, fontWeight: 700 }}>✕</button>
            </div>
            <div style={{ padding: "20px 22px 24px", display: "flex", flexDirection: "column", gap: 14, overflowY: "auto", background: "#ffffff" }}>
              <input
                value={newGroupName}
                onChange={e => setNewGroupName(e.target.value)}
                placeholder="Group Name *"
                className="sb-field"
                style={{ fontSize: 14, padding: "12px 16px", borderRadius: 16, background: "#f4f5f7", color: "#181c1f", border: "1px solid rgba(0,0,0,0.04)" }}
                autoFocus
              />
              <input
                value={newGroupDesc}
                onChange={e => setNewGroupDesc(e.target.value)}
                placeholder="Description (optional)"
                className="sb-field"
                style={{ fontSize: 13, padding: "12px 16px", borderRadius: 16, background: "#f4f5f7", color: "#181c1f", border: "1px solid rgba(0,0,0,0.04)" }}
              />
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "8px 12px", background: "#f4f5f7", borderRadius: 16, minHeight: 48, alignItems: "center", border: "1px solid rgba(0,0,0,0.04)" }}>
                {newGroupMemberChips.map(chip => (
                  <span key={chip} style={{ display: "flex", alignItems: "center", gap: 6, background: "#ebf5ee", color: "#6daf78", fontWeight: 700, borderRadius: 20, padding: "4px 12px", fontSize: 12.5 }}>
                    @{chip}
                    <button onClick={() => setNewGroupMemberChips(prev => prev.filter(c => c !== chip))} style={{ background: "none", border: "none", color: "#6daf78", cursor: "pointer", fontSize: 14, fontWeight: "bold", padding: 0, lineHeight: 1 }} aria-label="Remove member">×</button>
                  </span>
                ))}
                <input
                  value={newGroupMemberInput}
                  onChange={e => setNewGroupMemberInput(e.target.value)}
                  onKeyDown={e => {
                    if ((e.key === "Enter" || e.key === " ") && newGroupMemberInput.trim()) {
                      e.preventDefault();
                      const uname = newGroupMemberInput.trim().replace(/^@/, "");
                      if (uname && !newGroupMemberChips.includes(uname)) setNewGroupMemberChips(prev => [...prev, uname]);
                      setNewGroupMemberInput("");
                    }
                  }}
                  placeholder={newGroupMemberChips.length === 0 ? "Type @username & press Enter" : "Add more…"}
                  style={{ border: "none", outline: "none", background: "transparent", flex: 1, minWidth: 140, fontSize: 13, color: "#181c1f", padding: "4px" }}
                />
              </div>
              <button
                onClick={async () => {
                  const allChips = newGroupMemberInput.trim()
                    ? [...newGroupMemberChips, newGroupMemberInput.trim().replace(/^@/, "")]
                    : newGroupMemberChips;
                  if (!newGroupName.trim()) { showToast("Please enter a group name", "error"); return; }
                  const memberEmails: string[] = [];
                  const failedLookups: string[] = [];
                  for (const uname of allChips) {
                    if (uname.includes("@")) { memberEmails.push(uname); continue; }
                    try {
                      const prof = await apiFetch<{ email: string }>(`/profile/by-username/${encodeURIComponent(uname)}`);
                      memberEmails.push(prof.email);
                    } catch { failedLookups.push(uname); }
                  }
                  if (failedLookups.length > 0) { showToast("Usernames not found: " + failedLookups.map(u => "@" + u).join(", "), "error"); return; }
                  try {
                    const group = await apiFetch<any>("/groups", { method: "POST", body: JSON.stringify({ name: newGroupName.trim(), description: newGroupDesc, members: memberEmails }) });
                    try {
                      const { keyId, groupKey } = await generateGroupKey();
                      const privKey = e2ePrivKeyRef.current;
                      const myPubB64 = e2ePubKeyB64Ref.current;
                      if (privKey && myPubB64) {
                        const memberKeyEntries: { email: string; encrypted_key: string }[] = [];
                        for (const memberEmail of [...memberEmails, currentUser]) {
                          const theirPub = memberEmail === currentUser ? myPubB64 : await getPeerPubKey(memberEmail);
                          if (theirPub) {
                            const encKey = await wrapGroupKeyForMember({ keyId, groupKey }, privKey, theirPub);
                            memberKeyEntries.push({ email: memberEmail, encrypted_key: encKey });
                          }
                        }
                        if (memberKeyEntries.length > 0) {
                          await apiFetch(`/groups/${group.id}/e2e-key`, { method: "POST", body: JSON.stringify({ key_id: keyId, setter_pub_key: myPubB64, member_keys: memberKeyEntries }) });
                          groupKeyCache.set(String(group.id), groupKey);
                        }
                      }
                    } catch { }
                    setNewGroupName(""); setNewGroupDesc(""); setNewGroupMemberChips([]); setNewGroupMemberInput(""); setShowNewGroup(false);
                    loadGroups();
                    showToast("Group created successfully!", "success");
                  } catch (err) { showToast("Failed to create group: " + errorMessage(err), "error"); }
                }}
                className="sb-go-btn"
                style={{ padding: "14px", background: "#6daf78", color: "#ffffff", fontWeight: 700, borderRadius: 24, marginTop: 8, fontSize: 15, border: "none", cursor: "pointer", boxShadow: "0 4px 14px rgba(109,175,120,0.35)" }}
              >
                Create Group ({newGroupMemberChips.length} members)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── CALL LOG MODAL ────────────────────────────────────────────────────── */}
      {showCallLogUI && (
        <div className="modal-backdrop-sage" onClick={() => setShowCallLogUI(false)}>
          <div className="cl-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 460, width: "94vw", maxHeight: "82vh", borderRadius: 28, display: "flex", flexDirection: "column", padding: 0, overflow: "hidden", background: "#ffffff", boxShadow: "0 16px 40px rgba(0,0,0,0.12)", border: "1px solid rgba(0,0,0,0.06)" }}>
            <div className="cl-header" style={{ padding: "18px 20px 14px", borderBottom: "1px solid rgba(0,0,0,0.06)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <h2 className="cl-title" style={{ fontSize: 20, fontWeight: 800, color: "#181c1f", margin: 0 }}>Call History</h2>
              <button className="cl-close" onClick={() => setShowCallLogUI(false)} aria-label="Close call history" style={{ width: 34, height: 34, borderRadius: "50%", background: "#f4f5f7", border: "none", color: "#181c1f", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 14, fontWeight: 700 }}>✕</button>
            </div>
            <div className="call-log-tabs" style={{ display: "flex", gap: 6, padding: "4px", margin: "12px 18px", background: "#f4f5f7", borderRadius: 20 }}>
              <button
                className={`call-tab-btn ${callLogTab === "all" ? "active" : ""}`}
                onClick={() => setCallLogTab("all")}
                style={{
                  flex: 1,
                  padding: "8px 14px",
                  borderRadius: 16,
                  border: "none",
                  fontSize: 13,
                  cursor: "pointer",
                  transition: "all 0.18s ease",
                  ...(callLogTab === "all" ? { background: "#6daf78", color: "#ffffff", fontWeight: 700 } : { background: "transparent", color: "#5e646a", fontWeight: 600 })
                }}
              >
                All Calls
              </button>
              <button
                className={`call-tab-btn ${callLogTab === "missed" ? "active" : ""}`}
                onClick={() => {
                  setCallLogTab("missed");
                  markMissedCallsAsSeen();
                }}
                style={{
                  flex: 1,
                  padding: "8px 14px",
                  borderRadius: 16,
                  border: "none",
                  fontSize: 13,
                  cursor: "pointer",
                  transition: "all 0.18s ease",
                  ...(callLogTab === "missed" ? { background: "#6daf78", color: "#ffffff", fontWeight: 700 } : { background: "transparent", color: "#5e646a", fontWeight: 600 })
                }}
              >
                Missed ({unreadMissedCount})
              </button>
            </div>
            {(() => {
              const logsToShow = callLogTab === "missed" ? nonDeletedCallLogs.filter(l => l.status !== "completed") : nonDeletedCallLogs;
              return logsToShow.length === 0 ? (
                <p className="cl-empty" style={{ textAlign: "center", padding: "40px 20px", color: "#8a9096", fontSize: 14 }}>No {callLogTab === "missed" ? "missed " : ""}calls found</p>
              ) : (
                <div className="cl-list" style={{ padding: "8px 16px 20px", flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
                  {logsToShow.map(log => {
                    const peerName = log.peerName || getPeerName(log.peer);
                    const isMissed = log.status !== "completed";
                    const isVideo = log.media === "video";
                    return (
                      <div
                        key={log.id}
                        className="cl-item"
                        onClick={() => { setShowCallLogUI(false); startCallFromLog(log, isVideo); }}
                        style={{ cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", transition: "background 0.15s ease", padding: "12px 14px", borderRadius: "16px", background: "#ffffff", border: "1px solid rgba(0,0,0,0.06)", boxSizing: "border-box", minHeight: 70 }}
                        onMouseEnter={e => e.currentTarget.style.background = "#f8f9fa"}
                        onMouseLeave={e => e.currentTarget.style.background = "#ffffff"}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1, minWidth: 0, paddingRight: 8 }}>
                          <div style={{ width: 42, height: 42, borderRadius: "50%", background: isMissed ? "#fde8e8" : "#ebf5ee", color: isMissed ? "#e05353" : "#6daf78", border: `1px solid ${isMissed ? "rgba(224,83,83,0.2)" : "rgba(109,175,120,0.25)"}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                            {isVideo ? (
                              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" ry="2" /></svg>
                            ) : (
                              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.62 3.33 2 2 0 0 1 3.6 1.37h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 9a16 16 0 0 0 6.09 6.09l1.97-1.85a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7a2 2 0 0 1 1.72 2.03z" /></svg>
                            )}
                          </div>
                          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
                            <strong className="cl-item-name" style={{ display: "block", fontSize: 15, fontWeight: 700, color: "#181c1f", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", lineHeight: 1.2 }}>
                              {peerName}
                            </strong>
                            <div className="cl-item-meta" style={{ display: "flex", gap: 5, alignItems: "center", fontSize: 12, color: "#8a9096", lineHeight: 1.2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                              <span style={{ color: isMissed ? "#e05353" : "#6daf78", fontWeight: 600, flexShrink: 0 }}>{log.direction === "incoming" ? "↙ Incoming" : "↗ Outgoing"}</span>
                              <span>·</span>
                              {isMissed && <span style={{ color: "#e05353", fontWeight: 600, flexShrink: 0 }}>Missed</span>}
                              {!isMissed && log.duration ? <span style={{ flexShrink: 0 }}>{fmtDuration(log.duration)}</span> : null}
                              <span>·</span>
                              <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{parseTs(log.timestamp).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                            </div>
                          </div>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                          <button
                            onClick={() => { setShowCallLogUI(false); startCallFromLog(log, false); }}
                            className="tool-btn"
                            style={{ width: 38, height: 38, minWidth: 38, minHeight: 38, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "50%", background: "#f4f5f7", border: "none", color: "#181c1f", cursor: "pointer", transition: "all 0.15s ease", padding: 0 }}
                            title="Voice Call"
                            aria-label="Call Voice"
                          >
                            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.62 3.33 2 2 0 0 1 3.6 1.37h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 9a16 16 0 0 0 6.09 6.09l1.97-1.85a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7a2 2 0 0 1 1.72 2.03z" /></svg>
                          </button>
                          <button
                            onClick={() => { setShowCallLogUI(false); startCallFromLog(log, true); }}
                            className="tool-btn"
                            style={{ width: 38, height: 38, minWidth: 38, minHeight: 38, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "50%", background: "#f4f5f7", border: "none", color: "#181c1f", cursor: "pointer", transition: "all 0.15s ease", padding: 0 }}
                            title="Video Call"
                            aria-label="Call Video"
                          >
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" ry="2" /></svg>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* ── CALL OVERLAY ──────────────────────────────────────────────────────── */}
      {callState === "incoming" && (
        <div className="full-screen-incoming-call">
          {(() => {
            const peerContact = contacts.find(c => c.email === callPeer);
            if (peerContact?.avatar_url) {
              return <div className="call-bg-blur" style={{ backgroundImage: `url(${peerContact.avatar_url})` }} />;
            }
            return <div className="call-bg-blur" />;
          })()}
          <div className="call-bg-gradient" />

          <div className="fc-info">
            <div className="fc-avatar-wrapper">
              <div className="fc-avatar-pulse" />
              <div className="fc-avatar">
                {(() => {
                  const peerContact = contacts.find(c => c.email.toLowerCase() === (callPeer || "").toLowerCase());
                  return peerContact?.avatar_url ? (
                    <AvatarImage src={peerContact.avatar_url} alt={callDisplayName} fallbackText={callDisplayName} className="img-cover rounded-circle" />
                  ) : (
                    callDisplayName?.[0]?.toUpperCase() || "?"
                  );
                })()}
              </div>
            </div>
            <h1 className="fc-name">{callDisplayName}</h1>
            <p className="fc-status">{isVideoCall ? "Incoming Video Call" : "Incoming Voice Call"}</p>
          </div>

          <div className="apple-call-actions" style={{ position: "relative", zIndex: 1000, pointerEvents: "auto" }}>
            <div className="apple-btn-container" style={{ pointerEvents: "auto" }}>
              <button
                type="button"
                onClick={rejectCall}
                className="apple-call-btn apple-btn-decline"
                aria-label="Decline Call"
                style={{ cursor: "pointer", pointerEvents: "auto", position: "relative", zIndex: 1001 }}
              >
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M10.68 13.31a16 16 0 0 0 3.41 3.41l2.28-2.28a1 1 0 0 1 .94-.27 11.23 11.23 0 0 0 3.51.56 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A19.93 19.93 0 0 1 3 4a1 1 0 0 1 1-1h3.4a1 1 0 0 1 1 1 11.23 11.23 0 0 0 .56 3.51 1 1 0 0 1-.27.94l-2.28 2.28z" style={{ transform: "rotate(135deg)", transformOrigin: "center" }} />
                </svg>
              </button>
              <span className="apple-btn-label">Decline</span>
            </div>

            <div className="apple-btn-container" style={{ pointerEvents: "auto" }}>
              <button
                type="button"
                onClick={acceptCall}
                className="apple-call-btn apple-btn-accept"
                aria-label="Answer Call"
                style={{ cursor: "pointer", pointerEvents: "auto", position: "relative", zIndex: 1001 }}
              >
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 014.69 12a19.79 19.79 0 01-3.07-8.67A2 2 0 013.6 1.37h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L7.91 9a16 16 0 006.09 6.09l1.97-1.85a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7a2 2 0 011.72 2.03z" />
                </svg>
              </button>
              <span className="apple-btn-label">Answer</span>
            </div>
          </div>
        </div>
      )}

      {callState !== "idle" && callState !== "incoming" && (
        <div className="full-screen-incoming-call">
          {(() => {
            const peerContact = contacts.find(c => c.email === callPeer);
            if (peerContact?.avatar_url) {
              return <div className="call-bg-blur" style={{ backgroundImage: `url(${peerContact.avatar_url})` }} />;
            }
            return <div className="call-bg-blur" />;
          })()}
          <div className="call-bg-gradient" />

          {isVideoCall && callState === "connected" ? (
            <div className="video-container" style={{ position: "absolute", inset: 0, zIndex: 5, background: "#000", display: "flex", flexDirection: "column" }}>
              <div className="video-duration-overlay" style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#4ade80", boxShadow: "0 0 8px #4ade80" }} />
                <span style={{ opacity: 0.85, fontWeight: 550 }}>{callDisplayName}</span>
                <span style={{ width: 1, height: 12, background: "rgba(255,255,255,0.2)" }} />
                <span><CallDurationDisplay callStartTime={callStartTimeRef.current} callState={callState} /></span>
              </div>

              {/* Main remote view */}
              {isVideoSwapped ? (
                <div style={{ position: "absolute", inset: 0, zIndex: 1 }}>
                  <video autoPlay playsInline muted ref={node => { (localVideoRef as any).current = node; if (node && localStreamRef.current && node.srcObject !== localStreamRef.current) { node.srcObject = localStreamRef.current; node.play().catch(() => { }); } }} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  {isCameraOff && (
                    <div style={{ position: "absolute", inset: 0, background: "#1a1a1a", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, zIndex: 2 }}>
                      <div style={{ width: 90, height: 90, borderRadius: "50%", background: "var(--primary)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 38, color: "#fff", fontWeight: 700, overflow: "hidden", border: "3px solid rgba(255,255,255,0.15)", boxShadow: "0 8px 24px rgba(0,0,0,0.4)" }}>
                        {profile.avatarUrl ? <img src={profile.avatarUrl} alt="you" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : (profile.displayName || profile.username || currentUser)?.[0]?.toUpperCase()}
                      </div>
                      <span style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", letterSpacing: "0.04em", textTransform: "uppercase" }}>Camera Off</span>
                    </div>
                  )}
                  <div style={{ position: "absolute", bottom: 12, left: 12, background: "rgba(0,0,0,0.65)", color: "#fff", padding: "6px 12px", borderRadius: 16, fontSize: 13, fontWeight: 500, backdropFilter: "blur(4px)", pointerEvents: "none", zIndex: 5, border: "1px solid rgba(255,255,255,0.15)", display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: isCameraOff ? "#94a3b8" : "#4ade80", boxShadow: isCameraOff ? "none" : "0 0 8px #4ade80" }} />You
                  </div>
                </div>
              ) : Object.keys(remoteStreams).length > 0 ? (
                <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", zIndex: 1 }}>
                  {Object.entries(remoteStreams).map(([peerId, stream], idx, arr) =>
                    renderPeerVideoOrAvatar(peerId, stream, idx, arr.length)
                  )}
                </div>
              ) : (
                <div style={{ position: "absolute", inset: 0, zIndex: 1 }}>
                  {(remoteVideoMuted || (callPeer && cameraStates[callPeer])) ? (
                    <div style={{ width: "100%", height: "100%", background: "#1a1a1a", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12 }}>
                      {(() => {
                        const peerContact = contacts.find(c => c.email === callPeer);
                        return (
                          <div style={{ width: 90, height: 90, borderRadius: "50%", background: "var(--primary)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 38, color: "#fff", fontWeight: 700, overflow: "hidden", border: "3px solid rgba(255,255,255,0.15)", boxShadow: "0 8px 24px rgba(0,0,0,0.4)" }}>
                            {peerContact?.avatar_url ? <AvatarImage src={peerContact.avatar_url} alt={callDisplayName} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : callDisplayName?.[0]?.toUpperCase() || "?"}
                          </div>
                        );
                      })()}
                      <span style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", letterSpacing: "0.04em", textTransform: "uppercase" }}>Camera Off</span>
                    </div>
                  ) : (
                    <video autoPlay playsInline ref={node => { (remoteVideoRef as any).current = node; if (node && remoteStreamRef.current && node.srcObject !== remoteStreamRef.current) { node.srcObject = remoteStreamRef.current; node.play().catch(() => { }); } }} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  )}
                  <div style={{ position: "absolute", bottom: 12, left: 12, background: "rgba(0,0,0,0.65)", color: "#fff", padding: "6px 12px", borderRadius: 16, fontSize: 13, fontWeight: 500, backdropFilter: "blur(4px)", pointerEvents: "none", zIndex: 5, border: "1px solid rgba(255,255,255,0.1)", display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: (remoteVideoMuted || (callPeer && cameraStates[callPeer])) ? "#94a3b8" : "#4ade80" }} />
                    {callDisplayName}
                  </div>
                </div>
              )}

              {/* PIP video */}
              <div className="local-video-pip" style={{ left: pipPos.x, top: pipPos.y, cursor: "pointer", zIndex: 10 }} onMouseDown={onPipMouseDown} onTouchStart={onPipTouchStart} onClick={() => { if (!pipDragging.current) setIsVideoSwapped(!isVideoSwapped); }} title="Tap to swap">
                <div style={{ position: "relative", width: "100%", height: "100%" }}>
                  {isVideoSwapped ? (
                    // PIP shows Remote Video
                    <>
                      {(remoteVideoMuted || (callPeer && cameraStates[callPeer])) ? (
                        <div style={{ position: "absolute", inset: 0, background: "#1a1a1a", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 5 }}>
                          {(() => {
                            const peerContact = contacts.find(c => c.email === callPeer);
                            return (
                              <div style={{ width: 46, height: 46, borderRadius: "50%", background: "var(--primary)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 19, color: "#fff", fontWeight: 700, overflow: "hidden", border: "2px solid rgba(255,255,255,0.15)" }}>
                                {peerContact?.avatar_url ? <AvatarImage src={peerContact.avatar_url} alt={callDisplayName} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : callDisplayName?.[0]?.toUpperCase() || "?"}
                              </div>
                            );
                          })()}
                          <span style={{ fontSize: 8, color: "rgba(255,255,255,0.4)", letterSpacing: "0.04em", textTransform: "uppercase" }}>Cam off</span>
                        </div>
                      ) : (
                        <video autoPlay playsInline ref={node => { (remoteVideoRef as any).current = node; if (node && remoteStreamRef.current && node.srcObject !== remoteStreamRef.current) { node.srcObject = remoteStreamRef.current; node.play().catch(() => { }); } }} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                      )}
                      <div style={{ position: "absolute", bottom: 4, left: 4, background: "rgba(0,0,0,0.7)", color: "#fff", padding: "2px 6px", borderRadius: 8, fontSize: 9, fontWeight: 500, pointerEvents: "none", zIndex: 5 }}>{callDisplayName}</div>
                    </>
                  ) : (
                    // PIP shows Local Video (You)
                    <>
                      <video autoPlay playsInline muted ref={node => { (localVideoRef as any).current = node; if (node && localStreamRef.current && node.srcObject !== localStreamRef.current) { node.srcObject = localStreamRef.current; node.play().catch(() => { }); } }} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                      {isCameraOff && (
                        <div style={{ position: "absolute", inset: 0, background: "#1a1a1a", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 5 }}>
                          <div style={{ width: 46, height: 46, borderRadius: "50%", background: "var(--primary)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 19, color: "#fff", fontWeight: 700, overflow: "hidden", border: "2px solid rgba(255,255,255,0.15)" }}>
                            {profile.avatarUrl ? <AvatarImage src={profile.avatarUrl} alt="you" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : (profile.displayName || profile.username || currentUser)?.[0]?.toUpperCase()}
                          </div>
                          <span style={{ fontSize: 8, color: "rgba(255,255,255,0.4)", letterSpacing: "0.04em", textTransform: "uppercase" }}>Cam off</span>
                        </div>
                      )}
                      <div style={{ position: "absolute", bottom: 4, left: 4, background: "rgba(0,0,0,0.7)", color: "#fff", padding: "2px 6px", borderRadius: 8, fontSize: 9, fontWeight: 500, pointerEvents: "none", zIndex: 5 }}>You</div>
                    </>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="fc-info" style={{ position: "relative", zIndex: 10, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", flex: 1, width: "100%" }}>
              <div className="fc-avatar-wrapper" style={{ width: 150, height: 150, marginBottom: 28 }}>
                <div className="fc-avatar-pulse" />
                <div className="fc-avatar" style={{ width: "100%", height: "100%", fontSize: 64, border: "4px solid #ffffff", boxShadow: "0 16px 40px rgba(109, 175, 120, 0.28)" }}>
                  {(() => {
                    const peerContact = contacts.find(c => c.email === callPeer);
                    return peerContact?.avatar_url ? (
                      <AvatarImage src={peerContact.avatar_url} alt={callDisplayName} fallbackText={callDisplayName} className="img-cover rounded-circle" />
                    ) : (
                      callDisplayName?.[0]?.toUpperCase() || "?"
                    );
                  })()}
                </div>
              </div>
              <h1 className="fc-name" style={{ fontSize: "2.4rem", marginBottom: 12 }}>{callDisplayName}</h1>
              <p className="fc-status" style={{ color: "#4a8b54", letterSpacing: "0.06em", fontWeight: 700 }}>
                {callState === "calling" ? "Calling…" : <>Connected · <CallDurationDisplay callStartTime={callStartTimeRef.current} callState={callState} /></>}
              </p>
              {!isVideoCall && callState === "connected" && (
                <p style={{ fontSize: 13, color: "#5e646a", fontWeight: 600, marginTop: 8 }}>{isSpeaker ? "🔊 Speaker" : "📱 Earpiece"}</p>
              )}
            </div>
          )}

          <div className="apple-active-controls">
            <div className="apple-grid-options">
              {/* Mute Button */}
              <div className="apple-grid-item">
                <button onClick={toggleMute} className={`apple-grid-btn ${isMuted ? "active" : ""}`} aria-label={isMuted ? "Unmute" : "Mute"}>
                  {isMuted
                    ? <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="1" y1="1" x2="23" y2="23" /><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" /><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23" /><line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" /></svg>
                    : <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" /></svg>}
                </button>
                <span className="apple-grid-label">mute</span>
              </div>

              {/* Speaker Button */}
              <div className="apple-grid-item">
                <button onClick={toggleSpeaker} className={`apple-grid-btn ${isSpeaker ? "active" : ""}`} aria-label={isSpeaker ? "Switch to earpiece" : "Switch to speaker"}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" /></svg>
                </button>
                <span className="apple-grid-label">speaker</span>
              </div>

              {/* Video Button */}
              <div className="apple-grid-item">
                <button
                  onClick={() => {
                    const newOff = !isCameraOff;
                    localStreamRef.current?.getVideoTracks().forEach(t => { t.enabled = !newOff; });
                    setIsCameraOff(newOff);
                    const signalPeers = [callPeer, ...Array.from(pcMapRef.current.keys()).filter(p => p !== callPeer)];
                    signalPeers.forEach(p => { if (p) wsSend(JSON.stringify({ type: "camera_state", target_user: p, videoMuted: newOff })); });
                  }}
                  className={`apple-grid-btn ${!isCameraOff ? "active" : ""}`}
                  aria-label={isCameraOff ? "Turn camera on" : "Turn camera off"}
                >
                  {isCameraOff 
                    ? <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M16 16v1a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v3m4 0l7-5v14l-7-5" /><line x1="1" y1="1" x2="23" y2="23" /></svg>
                    : <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" /></svg>}
                </button>
                <span className="apple-grid-label">video</span>
              </div>

              {/* Switch Camera Button (Only visible on Video Calls) */}
              {isVideoCall && (
                <div className="apple-grid-item">
                  <button onClick={switchCamera} className="apple-grid-btn" aria-label="Switch camera">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="1 4 1 10 7 10" /><polyline points="23 20 23 14 17 14" /><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15" /></svg>
                  </button>
                  <span className="apple-grid-label">flip camera</span>
                </div>
              )}
            </div>

            {/* End Call Button */}
            <div className="apple-end-container">
              <button onClick={() => endCall(true)} className="apple-end-btn" aria-label="End call">
                <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                  <path d="M10.68 13.31a16 16 0 0 0 3.41 3.41l2.28-2.28a1 1 0 0 1 .94-.27 11.23 11.23 0 0 0 3.51.56 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A19.93 19.93 0 0 1 3 4a1 1 0 0 1 1-1h3.4a1 1 0 0 1 1 1 11.23 11.23 0 0 0 .56 3.51 1 1 0 0 1-.27.94l-2.28 2.28z" style={{ transform: "rotate(135deg)", transformOrigin: "center" }} />
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MULTI-MEDIA CAROUSEL PREVIEW OVERLAY ── */}
      {pendingFiles.length > 0 && (
        <div className="media-previews-overlay">
          <div className="mp-header">
            <h2 className="mp-title">Share Media ({pendingFiles.length})</h2>
            <button className="mp-close" onClick={() => setPendingFiles([])} aria-label="Cancel sharing">✕</button>
          </div>
          <div className="mp-carousel">
            <div className="mp-scroll-track">
              {pendingFiles.map((item, idx) => (
                <div key={idx} className="mp-card">
                  <button
                    className="mp-card-delete"
                    onClick={() => setPendingFiles(prev => prev.filter((_, i) => i !== idx))}
                    aria-label="Remove file"
                  >
                    ✕
                  </button>
                  {item.type === "image" && <img src={item.url} alt="preview" />}
                  {item.type === "video" && <video src={item.url} muted playsInline />}
                  {item.type !== "image" && item.type !== "video" && (
                    <div className="mp-card-doc">
                      <span style={{ fontSize: 36 }}>📄</span>
                      <span className="mp-card-doc-name">{item.file.name}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
          <div className="mp-footer">
            <div className="mp-caption-wrapper">
              <input
                type="text"
                placeholder="Add a caption..."
                value={inputMsg}
                onChange={e => setInputMsg(e.target.value)}
                className="mp-caption-input"
              />
            </div>
            <div className="mp-controls-row">
              <button className="mp-add-more-btn" onClick={() => fileInputRef.current?.click()}>
                <span>➕</span> Add more files
              </button>
              {multiUploadProgress ? (
                <div className="mp-progress-indicator">
                  <span className="spinner" style={{ width: 16, height: 16 }} />
                  <span>Sending {multiUploadProgress.current} of {multiUploadProgress.total}…</span>
                </div>
              ) : (
                <button className="mp-send-btn" onClick={sendMessage}>
                  <span>Send</span> ➤
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── CAMERA ACTION DRAWER OVERLAY ── */}
      {showCameraDrawer && (
        <div className="camera-action-sheet-overlay" onClick={() => setShowCameraDrawer(false)}>
          <div className="camera-action-sheet" onClick={e => e.stopPropagation()}>
            <div className="cas-title">Capture Media</div>
            <div className="cas-options">
              <button className="cas-btn" onClick={takeNativePhoto}>
                📸 Take Photo
              </button>
              <button
                className="cas-btn"
                onClick={() => {
                  setShowCameraDrawer(false);
                  cameraVideoInputRef.current?.click();
                }}
              >
                🎥 Record Video
              </button>
              <button className="cas-btn cas-btn-cancel" onClick={() => setShowCameraDrawer(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── PLUS ACTION DRAWER OVERLAY ── */}
      {showPlusDrawer && (
        <div className="camera-action-sheet-overlay" onClick={() => setShowPlusDrawer(false)}>
          <div className="camera-action-sheet" onClick={e => e.stopPropagation()}>
            <div className="cas-title">Add Attachment</div>
            <div className="cas-options">
              <button className="cas-btn" onClick={pickNativeGallery}>
                🖼️ Photos & Videos
              </button>
              <button className="cas-btn" onClick={() => { setShowPlusDrawer(false); fileInputRef.current?.click(); }}>
                📁 Document / File
              </button>
              <button className="cas-btn" onClick={takeNativePhoto}>
                📸 Take Photo
              </button>
              <button
                className="cas-btn"
                onClick={() => {
                  setShowPlusDrawer(false);
                  cameraVideoInputRef.current?.click();
                }}
              >
                🎥 Record Video
              </button>
              <button className="cas-btn cas-btn-cancel" onClick={() => setShowPlusDrawer(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── IN-APP LIVE CAMERA VIEWFINDER MODAL ── */}
      <LiveCameraModal
        isOpen={showLiveCamera}
        onClose={() => setShowLiveCamera(false)}
        onCapture={(file, previewUrl) => {
          setShowLiveCamera(false);
          setPendingFiles(prev => [...prev, { file, url: previewUrl, type: "image", caption: "" }]);
        }}
      />

      <ConfirmDialog />

      {/* ── CUSTOM FROSTED DELETE DUAL OPTION MODAL ── */}
      {deleteConfirm && (
        <div className="camera-action-sheet-overlay" onClick={() => setDeleteConfirm(null)}>
          <div className="camera-action-sheet cl-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: "380px", padding: "24px", borderRadius: "20px", display: "flex", flexDirection: "column", alignItems: "center" }}>
            <div className="cas-title" style={{ fontSize: "15px", marginBottom: "8px", color: "var(--text-1)", textTransform: "none", fontWeight: "600", textAlign: "center" }}>
              Delete Message
            </div>
            <div style={{ fontSize: "12px", color: "var(--text-3)", textAlign: "center", marginBottom: "20px" }}>
              Would you like to delete {deleteConfirm.selectedMsgs.length === 1 ? "this message" : `these ${deleteConfirm.selectedMsgs.length} messages`}?
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px", width: "100%" }}>
              {deleteConfirm.selectedMsgs.every(m => String(m.user || "").toLowerCase() === String(currentUser || "").toLowerCase()) && (
                <button
                  className="sb-bottom-btn"
                  onClick={async () => {
                    const callback = deleteConfirm.onConfirm;
                    setDeleteConfirm(null);
                    await callback(true); // for Everyone
                  }}
                  style={{
                    height: "42px",
                    borderRadius: "10px",
                    background: "linear-gradient(135deg, #f44336, #d32f2f)",
                    color: "#fff",
                    fontWeight: "600",
                    border: "none"
                  }}
                >
                  Delete for Everyone
                </button>
              )}
              <button
                className="sb-bottom-btn"
                onClick={async () => {
                  const callback = deleteConfirm.onConfirm;
                  setDeleteConfirm(null);
                  await callback(false); // for Me Only
                }}
                style={{
                  height: "42px",
                  borderRadius: "10px",
                  background: "rgba(255, 255, 255, 0.08)",
                  border: "1px solid var(--border)",
                  color: "var(--text-1)",
                  fontWeight: "600"
                }}
              >
                Delete for Me Only
              </button>
              <button
                className="sb-bottom-btn"
                onClick={() => setDeleteConfirm(null)}
                style={{
                  height: "42px",
                  borderRadius: "10px",
                  background: "transparent",
                  border: "none",
                  color: "var(--text-3)",
                  fontSize: "12px"
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── ENHANCED MEDIA VIEWER LIGHTBOX ────────────────────────────────────── */}
      {
        viewFile && (
          <div className="file-viewer-overlay" onClick={() => { setViewFile(null); setMediaZoom(1); setMediaPan({ x: 0, y: 0 }); }}>
            {/* Top Toolbar */}
            <div className="viewer-top-bar" onClick={e => e.stopPropagation()} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <button
                  className="close-viewer"
                  onClick={() => { setViewFile(null); setMediaZoom(1); setMediaPan({ x: 0, y: 0 }); }}
                  aria-label="Close media viewer"
                  style={{ width: 38, height: 38, borderRadius: "50%", background: "rgba(255, 255, 255, 0.12)", border: "1px solid rgba(255, 255, 255, 0.18)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", backdropFilter: "blur(12px)", transition: "all 0.15s ease" }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
                <div style={{ color: "#ffffff", fontSize: 16, fontWeight: 700, whiteSpace: "nowrap" }}>
                  {viewFile.type === "video" ? "Video" : (viewFile.type === "self-avatar" || viewFile.type === "avatar-circle") ? "Profile Photo" : viewFile.type === "pdf" ? "Document" : "Photo"}
                </div>
              </div>

              <div className="viewer-controls-group" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {viewFile.type === "image" && (
                  <>
                    <button
                      className="viewer-tool-btn"
                      onClick={() => setMediaZoom(z => Math.max(1, z - 0.5))}
                      title="Zoom Out"
                      aria-label="Zoom Out"
                      style={{ width: 38, height: 38, padding: 0, borderRadius: "50%" }}
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="5" y1="12" x2="19" y2="12" />
                      </svg>
                    </button>
                    {mediaZoom > 1 && (
                      <button
                        className="viewer-tool-btn"
                        onClick={() => { setMediaZoom(1); setMediaPan({ x: 0, y: 0 }); }}
                        title="Reset Zoom"
                        aria-label="Reset Zoom"
                        style={{ minWidth: 46, height: 38, padding: "0 10px", borderRadius: 9999 }}
                      >
                        {Math.round(mediaZoom * 100)}%
                      </button>
                    )}
                    <button
                      className="viewer-tool-btn"
                      onClick={() => setMediaZoom(z => Math.min(4, z + 0.5))}
                      title="Zoom In"
                      aria-label="Zoom In"
                      style={{ width: 38, height: 38, padding: 0, borderRadius: "50%" }}
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="12" y1="5" x2="12" y2="19" />
                        <line x1="5" y1="12" x2="19" y2="12" />
                      </svg>
                    </button>
                  </>
                )}
                {viewFile.type !== "avatar-circle" && viewFile.type !== "self-avatar" && (
                  <>
                    <button
                      className="viewer-tool-btn"
                      onClick={() => shareContent({ title: "Shared Media", url: viewFile.url, type: viewFile.type, text: "Check out this media from Flux" })}
                      title="Share Media"
                      aria-label="Share Media"
                      style={{ width: 38, height: 38, padding: 0, borderRadius: "50%" }}
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                        <polyline points="16 6 12 2 8 6" />
                        <line x1="12" y1="2" x2="12" y2="15" />
                      </svg>
                    </button>
                    <button
                      className="viewer-tool-btn viewer-dl-btn"
                      onClick={() => handleDownloadMedia(viewFile.url, undefined, viewFile.type)}
                      title="Download Media"
                      aria-label="Download Media"
                      style={{ width: 38, height: 38, padding: 0, borderRadius: "50%" }}
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="7 10 12 15 17 10" />
                        <line x1="12" y1="15" x2="12" y2="3" />
                      </svg>
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Media Content */}
            <div
              className="viewer-content"
              onClick={e => e.stopPropagation()}
              onDoubleClick={() => {
                if (viewFile.type === "image" || viewFile.type === "self-avatar") {
                  if (mediaZoom > 1) {
                    setMediaZoom(1);
                    setMediaPan({ x: 0, y: 0 });
                  } else {
                    setMediaZoom(2.2);
                  }
                }
              }}
              style={{
                transition: isPinching ? "none" : "transform 0.22s var(--ease-spring)",
                transform: `translate(${mediaPan.x}px,${mediaPan.y}px) scale(${mediaZoom})`
              }}
              onTouchStart={e => {
                if (e.touches.length === 2) {
                  setIsPinching(true);
                  initialDistRef.current = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
                  initialZoomRef.current = mediaZoom;
                } else if (e.touches.length === 1 && mediaZoom > 1) {
                  initialPanRef.current = { x: e.touches[0].clientX - mediaPan.x, y: e.touches[0].clientY - mediaPan.y };
                }
              }}
              onTouchMove={e => {
                if (e.touches.length === 2 && isPinching) {
                  const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
                  setMediaZoom(Math.max(1, Math.min(initialZoomRef.current * (d / initialDistRef.current), 5)));
                } else if (e.touches.length === 1 && mediaZoom > 1) {
                  setMediaPan({ x: e.touches[0].clientX - initialPanRef.current.x, y: e.touches[0].clientY - initialPanRef.current.y });
                }
              }}
              onTouchEnd={e => {
                if (e.touches.length < 2) setIsPinching(false);
                if (mediaZoom <= 1) setMediaPan({ x: 0, y: 0 });
              }}
            >
              {viewFile.type === "image" && (
                <img src={viewFile.url} alt="attachment" style={{ pointerEvents: "none", userSelect: "none", maxWidth: "90vw", maxHeight: "80vh", objectFit: "contain", borderRadius: 12 }} />
              )}
              {viewFile.type === "self-avatar" && (
                <AvatarImage src={viewFile.url} alt="attachment" style={{ pointerEvents: "none", userSelect: "none", maxWidth: "90vw", maxHeight: "80vh", objectFit: "contain", borderRadius: 24 }} />
              )}
              {viewFile.type === "video" && (
                <video src={viewFile.url} controls autoPlay playsInline style={{ maxHeight: "85vh", maxWidth: "92vw" }} />
              )}
              {viewFile.type === "avatar-circle" && (
                <AvatarImage src={viewFile.url} alt="Avatar" style={{ pointerEvents: "none", maxWidth: "85vw", maxHeight: "85vh", objectFit: "contain", borderRadius: "var(--r-xl)" }} />
              )}
            </div>

            {viewFile.type === "self-avatar" && (
              <div style={{ position: "fixed", bottom: "32px", left: "50%", transform: "translateX(-50%)", zIndex: 10002 }} onClick={e => e.stopPropagation()}>
                <button
                  onClick={triggerAvatarPicker}
                  style={{
                    background: "#6daf78",
                    color: "#ffffff",
                    border: "none",
                    borderRadius: "24px",
                    padding: "12px 24px",
                    fontSize: "14px",
                    fontWeight: 700,
                    boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: "8px"
                  }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                    <circle cx="12" cy="13" r="4" />
                  </svg>
                  Change Profile Photo
                </button>
              </div>
            )}
          </div>
        )
      }

      {/* ── FORWARD PICKER ────────────────────────────────────────────────────── */}
      {
        showForwardPicker && forwardingMsgs.length > 0 && (
          <div className="modal-backdrop-sage" style={{ zIndex: 10001 }} onClick={() => { setShowForwardPicker(false); setForwardSelectedTargets([]); setForwardingMsgs([]); }}>
            <div className="cl-modal" style={{ maxHeight: "75vh", display: "flex", flexDirection: "column", padding: 0, background: "#ffffff", borderRadius: 28, border: "1px solid rgba(0,0,0,0.06)", boxShadow: "0 16px 40px rgba(0,0,0,0.12)" }} onClick={e => e.stopPropagation()}>
              <div className="cl-header" style={{ flexShrink: 0, padding: "18px 22px 14px", borderBottom: "1px solid rgba(0,0,0,0.06)", display: "flex", alignItems: "center", justifyContent: "space-between", background: "#ffffff" }}>
                <h2 className="cl-title" style={{ fontSize: 20, fontWeight: 800, color: "#181c1f", margin: 0 }}>Forward to…</h2>
                <button className="cl-close" onClick={() => { setShowForwardPicker(false); setForwardSelectedTargets([]); setForwardingMsgs([]); }} style={{ width: 34, height: 34, borderRadius: "50%", background: "#f4f5f7", border: "none", color: "#181c1f", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 14, fontWeight: 700 }}>✕</button>
              </div>
              <div style={{ padding: "10px 18px", background: "#f4f5f7", borderBottom: "1px solid rgba(0,0,0,0.04)", fontSize: 12.5, color: "#5e646a", display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                <span>↗</span>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 500 }}>
                  {forwardingMsgs.length === 1 ? formatNotificationMedia(forwardingMsgs[0].content) : `Forwarding ${forwardingMsgs.length} messages`}
                </span>
              </div>
              <div style={{ flex: 1, overflowY: "auto", padding: "8px 12px" }}>
                {sortedChats.length > 0 && (
                  <>
                    <div style={{ padding: "8px 12px 4px", fontSize: 11, fontWeight: 700, color: "#8a9096", textTransform: "uppercase", letterSpacing: "0.06em" }}>Chats</div>
                    {sortedChats.map(chat => {
                      if (chat.type === "user") {
                        const c = chat.item;
                        const targetId = c.email;
                        const isSel = forwardSelectedTargets.some(t => String(t.id) === String(targetId));
                        return (
                          <button
                            key={c.email}
                            className={`sb-item ${isSel ? "sb-item--active" : ""}`}
                            style={{ width: "100%", borderRadius: 0, borderBottom: "1px solid var(--border-2)", position: "relative" }}
                            onClick={() => toggleForwardTarget({ type: "user", id: targetId, name: contactLabel(c) })}
                          >
                            <div className="sb-av">
                              {c.avatar_url ? <AvatarImage src={c.avatar_url} className="img-cover rounded-circle" alt="av" fallbackText={contactLabel(c)} /> : contactLabel(c)[0]?.toUpperCase() || "?"}
                              <span className={`pres ${c.is_online ? "pres--on" : ""}`} />
                              {isSel && <div className="checkbox-av-overlay">✓</div>}
                            </div>
                            <div className="sb-item-body mw-0">
                              <span className="sb-item-name">{contactLabel(c)}</span>
                              {c.username && <span className="sb-item-status">@{c.username}</span>}
                            </div>
                          </button>
                        );
                      } else {
                        const g = chat.item;
                        const targetId = g.id;
                        const isSel = forwardSelectedTargets.some(t => String(t.id) === String(targetId));
                        return (
                          <button
                            key={g.id}
                            className={`sb-item ${isSel ? "sb-item--active-group" : ""}`}
                            style={{ width: "100%", borderRadius: 0, borderBottom: "1px solid var(--border-2)", position: "relative" }}
                            onClick={() => toggleForwardTarget({ type: "group", id: targetId, name: g.name })}
                          >
                            <div className="sb-av sb-av--group">
                              {g.avatar_url ? <AvatarImage src={g.avatar_url} className="img-cover rounded-circle" alt="av" fallbackText={g.name} /> : g.name[0]?.toUpperCase() || "?"}
                              {isSel && <div className="checkbox-av-overlay">✓</div>}
                            </div>
                            <div className="sb-item-body mw-0">
                              <span className="sb-item-name" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                <span className="text-truncate" style={{ flexShrink: 1 }}>{g.name}</span>
                                <span className="group-badge" style={{ flexShrink: 0 }}>Group</span>
                              </span>
                              <span className="sb-item-status">{g.members.length} members</span>
                            </div>
                          </button>
                        );
                      }
                    })}
                  </>
                )}
              </div>
              {forwardSelectedTargets.length > 0 && (
                <div className="forward-actions-bar" style={{ flexShrink: 0 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-2)" }}>
                    Selected {forwardSelectedTargets.length} {forwardSelectedTargets.length === 1 ? "chat" : "chats"}
                  </span>
                  <button className="mp-send-btn" onClick={handleMultiForward} style={{ minHeight: 38, padding: "8px 20px" }}>
                    Send ➤
                  </button>
                </div>
              )}
            </div>
          </div>
        )
      }

      {/* ── STATUS CREATOR MODAL ── */}
      {showStatusCreator && (
        <StatusCreatorModal
          initialMode={showStatusCreator}
          onClose={() => setShowStatusCreator(null)}
          onSuccess={() => {
            setShowStatusCreator(null);
            loadStatuses();
            showToast("Status posted!", "success");
          }}
        />
      )}

      {/* ── STATUS VIEWER MODAL ── */}
      {activeViewingStatusGroup && (
        <StatusViewerModal
          initialGroup={activeViewingStatusGroup}
          allGroups={statusGroups}
          currentUserEmail={currentUser}
          onClose={() => setActiveViewingStatusGroup(null)}
          onSendReply={handleSendStatusReply}
          onStatusDeleted={(deletedId) => {
            loadStatuses();
            showToast("Status deleted", "info");
          }}
        />
      )}

      {/* ── PRIVACY POLICY & TERMS MODAL ── */}
      <LegalModal
        isOpen={showLegalModal}
        initialTab={legalModalTab}
        onClose={() => setShowLegalModal(false)}
      />

      {/* ── CONTACTS & REQUESTS MODALS ── */}
      {showContactsModal && (
        <ContactsModal
          onClose={() => setShowContactsModal(false)}
          onSelectContact={(c) => {
            setShowContactsModal(false);
            openChat({
              type: "user",
              id: c.email.toLowerCase(),
              name: nicknames[c.email] || c.display_name || c.username || c.email,
            });
          }}
          onOpenAddContact={() => {
            setShowContactsModal(false);
            setAddContactPrefill(null);
            setShowAddContactModal(true);
          }}
          onOpenRequests={() => {
            setShowContactsModal(false);
            setShowRequestsModal(true);
          }}
          onOpenQR={() => {
            setShowContactsModal(false);
            setShowQRModal(true);
          }}
          onStartCall={(c, isVideo) => {
            setShowContactsModal(false);
            openChat({
              type: "user",
              id: c.email.toLowerCase(),
              name: nicknames[c.email] || c.display_name || c.username || c.email,
            });
            setTimeout(() => startCall(isVideo), 150);
          }}
          onToggleFavorite={handleToggleFavorite}
        />
      )}

      {showRequestsModal && (
        <ContactRequestsModal
          onClose={() => setShowRequestsModal(false)}
          onAcceptRequest={handleAcceptRequest}
          onDeclineRequest={handleDeclineRequest}
          onDeclineAndBlock={handleDeclineAndBlock}
          onCancelRequest={handleCancelRequest}
          onViewMutuals={(targetEmail, targetName) => {
            setShowMutualsModal({ email: targetEmail, name: targetName });
          }}
        />
      )}

      {showAddContactModal && (
        <AddContactModal
          onClose={() => {
            setShowAddContactModal(false);
            setAddContactPrefill(null);
          }}
          onOpenChat={(email) => {
            setShowAddContactModal(false);
            const c = contacts.find((x) => x.email.toLowerCase() === email.toLowerCase());
            openChat({
              type: "user",
              id: email.toLowerCase(),
              name: c ? (nicknames[c.email] || c.display_name || c.username || c.email) : email.split("@")[0],
            });
          }}
          onViewMutuals={(targetEmail, targetName) => {
            setShowMutualsModal({ email: targetEmail, name: targetName });
          }}
          onOpenRequests={() => {
            setShowAddContactModal(false);
            setShowRequestsModal(true);
          }}
        />
      )}

      {showMutualsModal && (
        <MutualContactsModal
          targetEmail={showMutualsModal.email}
          targetName={showMutualsModal.name}
          onClose={() => setShowMutualsModal(null)}
          onSelectContact={(c) => {
            setShowMutualsModal(null);
            setShowContactsModal(false);
            setShowRequestsModal(false);
            setShowAddContactModal(false);
            openChat({
              type: "user",
              id: c.email.toLowerCase(),
              name: nicknames[c.email] || c.display_name || c.username || c.email,
            });
          }}
        />
      )}

      {showQRModal && (
        <QRCodeModal
          onClose={() => setShowQRModal(false)}
          onConnected={async (newContact) => {
            await loadContacts();
            showToast(`Connected with ${newContact?.display_name || newContact?.username || "friend"}!`, "success");
          }}
        />
      )}

      <input type="file" ref={avatarInputRef} accept="image/*" onChange={handleAvatarUpload} style={{ position: "fixed", opacity: 0, pointerEvents: "none", width: 1, height: 1, top: -100, left: -100 }} aria-hidden="true" tabIndex={-1} />
      <Toast />
    </div>
    </ErrorBoundary>
  );
}
