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
} from "@/types";
import {
  USERNAME_RE, errorMessage, getEmail, getIsAdmin, safeParseJSON,
  fmtDuration, parseTs, formatTimeAgo, getDateLabel, updateReactionsForUser,
  compressImage,
} from "@/lib/utils";
import { API, WS_URL, uploadMediaToBackend } from "@/lib/api";
import { idbSet, idbGet, idbGetMany, idbDel } from "@/lib/idb";
import { dbGetMessages, dbSaveMessages, dbSaveMessage } from "@/lib/db";
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
import AuthScreen from "@/components/auth/AuthScreen";
import Toast from "@/components/shared/Toast";
import ConfirmDialog from "@/components/shared/ConfirmDialog";
import { useVirtualizer } from "@tanstack/react-virtual";
import { requestNotificationPermission as requestFCMPermission, setupForegroundFCM } from "@/lib/firebase";
import {
  getOrCreateIdentityKeyPair, encryptDM, decryptDM,
  generateGroupKey, wrapGroupKeyForMember, unwrapGroupKey,
  encryptGroupMsg, decryptGroupMsg, isDMEncrypted, isGroupEncrypted, groupKeyCache,
} from "@/lib/crypto";
import {
  requestNotifyPermission, showLocalNotification, showCallNotification, cancelCallNotification,
} from "@/lib/notifications";

// â”€â”€â”€ AUTH REDUCER (kept here â€” depends on AuthState/AuthAction types from @/types) â”€â”€
const authInit: AuthState = { step: "signin", email: "", pass: "", pass2: "", user: "", loading: false, error: "" };

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

  const sendTypingEvent = useDebounceCallback(() => {
    if (activeChatRef.current?.type === "user") {
      wsSend(JSON.stringify({ type: "typing", target_user: activeChatRef.current.id }));
    }
  }, 300);

  const handleTyping = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputMsg(e.target.value);
    sendTypingEvent();
  };

  return (
    <>
      {/* ── EMOJI/STICKER PANEL ── */}
      {showEmojiPanel && (
        <div className="emoji-panel">
          <div style={{ display: "flex", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
            {(["emojis", "stickers"] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setEmojiPanelTab(tab)}
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
                          ref={isFocused ? emojiActiveCellRef : null}
                          tabIndex={isFocused ? 0 : -1}
                          onClick={() => setInputMsg(prev => prev + e)}
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
                    <button key={pack.id} onClick={() => setActiveStickerPack(pack.id)} title={pack.name} style={{ background: activeStickerPack === pack.id ? "var(--surface-3)" : "transparent", border: activeStickerPack === pack.id ? "1px solid var(--border-2)" : "1px solid transparent", borderRadius: 8, padding: 3, cursor: "pointer", flexShrink: 0 }}>
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
                        <button key={sticker.id} onClick={() => onSendSticker(sticker.url)} title={sticker.name || ""} style={{ background: "none", border: "none", cursor: "pointer", padding: 4, borderRadius: 8, transition: "background 0.15s" }} onMouseEnter={e => (e.currentTarget.style.background = "var(--surface-2)")} onMouseLeave={e => (e.currentTarget.style.background = "none")}>
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
                placeholder={isUploadingAttachment ? "Sending..." : "Type a message…"}
                className="msg-input-field"
                disabled={isRecording || isUploadingAttachment}
              />
              <button onClick={() => setShowPlusDrawer(true)} className="input-inline-btn plus-btn" title="Add attachment" aria-label="Attachment options" type="button" tabIndex={isNarrowScreen ? undefined : -1} aria-hidden={isNarrowScreen ? undefined : "true"}>+</button>
              <button onClick={() => fileInputRef.current?.click()} className="input-inline-btn attach-btn" title="Attach file" aria-label="Attach file" type="button" tabIndex={isNarrowScreen ? -1 : undefined} aria-hidden={isNarrowScreen ? "true" : undefined}>📎</button>
              <button onClick={onTakePhoto || (() => setShowCameraDrawer(true))} className="input-inline-btn camera-btn" title="Take photo" aria-label="Camera" type="button" tabIndex={isNarrowScreen ? -1 : undefined} aria-hidden={isNarrowScreen ? "true" : undefined}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></svg>
              </button>
            </div>

            {inputMsg.trim() || pendingFile || pendingFiles.length > 0 ? (
              <button onClick={onSendMessage} disabled={isRecording || isUploadingAttachment} className="send-btn" aria-label="Send message">➤</button>
            ) : (
              <button onClick={toggleRecording} className={`mic-btn-circle ${isRecording ? "tool-btn--rec" : ""}`} title="Voice message" aria-label="Record voice message">🎤</button>
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
    muteChat: storeMuteChat, unmuteChat: storeUnmuteChat
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

  useEffect(() => {
    if (currentUser) {
      cryptoHook.initializeKeys(currentUser);
    }
  }, [currentUser, cryptoHook]);
  const abortControllerRef = useRef<AbortController>(new AbortController());
  const ringbackToneRef = useRef<RingbackToneGenerator | null>(null);
  if (!ringbackToneRef.current && typeof window !== "undefined") {
    ringbackToneRef.current = new RingbackToneGenerator();
  }

  useEffect(() => { if (typeof document !== "undefined") document.body.classList.toggle("auth-mode", !isAuth); }, [isAuth]);

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
      showToast("Internet connection restored. Reconnecting...", "success");
      setWsStatus("reconnecting");
      initWSRef.current?.();
      if (activeChatRef.current) {
        loadHistoryRef.current?.(activeChatRef.current).catch(() => {});
      }
    };

    const handleOffline = () => {
      showToast("Internet connection lost. Operating in offline mode.", "error");
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

  // ── RINGTONE STATE ────────────────────────────────────────────────────────────
  const [ringtonePref, setRingtonePref] = useState("ringtone");
  const [customRingtoneName, setCustomRingtoneName] = useState<string | null>(null);
  const [previewActive, setPreviewActive] = useState<string | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const previewTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopPreview = useCallback(() => {
    if (previewTimeoutRef.current) { clearTimeout(previewTimeoutRef.current); previewTimeoutRef.current = null; }
    setPreviewActive(null);
    if (previewAudioRef.current) {
      try { previewAudioRef.current.pause(); previewAudioRef.current.currentTime = 0; } catch { }
      previewAudioRef.current = null;
    }
  }, []);

  const startPreview = useCallback(async (value: string) => {
    stopPreview();
    setPreviewActive(value);
    let src = value === "ringtone" ? "/ringtone.mp3"
      : value === "ringtone2" ? "/ringtone2.mp3"
        : value === "ringtone3" ? "/ringtone3.mp3"
          : value === "custom_file" ? ((await idbGet<string>("Flux_custom_ringtone_data")) || "") : "";
    if (!src) { stopPreview(); return; }
    const audio = new Audio(src);
    audio.volume = 1.0;
    audio.play().then(() => {
      previewAudioRef.current = audio;
      previewTimeoutRef.current = setTimeout(stopPreview, 5000);
    }).catch(stopPreview);
  }, [stopPreview]);

  const togglePreview = useCallback((e: React.MouseEvent, value: string) => {
    e.stopPropagation();
    previewActive === value ? stopPreview() : startPreview(value);
  }, [previewActive, startPreview, stopPreview]);

  useEffect(() => { if (!showMyProfileSettings) stopPreview(); }, [showMyProfileSettings, stopPreview]);

  const handleRingtoneChange = async (name: string) => {
    setRingtonePref(name);
    try { await idbSet("Flux_ringtone_name", name); } catch { }
    if (ringtoneRef.current) {
      let src = "/ringtone.mp3";
      if (name === "ringtone2") src = "/ringtone2.mp3";
      else if (name === "ringtone3") src = "/ringtone3.mp3";
      else if (name === "custom_file") {
        const data = await idbGet<string>("Flux_custom_ringtone_data");
        src = data || "/ringtone.mp3";
      }
      try { ringtoneRef.current.src = src; ringtoneRef.current.load(); } catch { }
    }
  };

  const handleCustomRingtoneUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { alert("Please select an audio file under 5 MB."); return; }
    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = reader.result as string;
      try {
        await idbSet("Flux_custom_ringtone_data", base64);
        await idbSet("Flux_custom_ringtone_name", file.name);
        setCustomRingtoneName(file.name);
        await handleRingtoneChange("custom_file");
      } catch { alert("Failed to save custom ringtone. Storage quota might be exceeded."); }
    };
    reader.readAsDataURL(file);
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
  const [newContactUsername, setNewContactUsername] = useState("");
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupDesc, setNewGroupDesc] = useState("");
  const [newGroupMemberChips, setNewGroupMemberChips] = useState<string[]>([]);
  const [newGroupMemberInput, setNewGroupMemberInput] = useState("");
  const [editDisplayName, setEditDisplayName] = useState("");
  const [editUsername, setEditUsername] = useState("");
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [isUploadingGroupAvatar, setIsUploadingGroupAvatar] = useState(false);
  const groupAvatarInputRef = useRef<HTMLInputElement | null>(null);
  const cameraPhotoInputRef = useRef<HTMLInputElement | null>(null);
  const cameraVideoInputRef = useRef<HTMLInputElement | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const isScrollAnchoredRef = useRef(true);
  useEffect(() => {
    isScrollAnchoredRef.current = isScrollAnchored;
  }, [isScrollAnchored]);
  const wsConnTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cancelRecordingRef = useRef(false);
  const [pendingFile, setPendingFile] = useState<{ file: File; url: string; type: "image" | "audio" | "video" | "pdf" | "file" } | null>(null);
  const [pendingFiles, setPendingFiles] = useState<{ file: File; url: string; type: "image" | "audio" | "video" | "pdf" | "file"; caption?: string }[]>([]);
  const [multiUploadProgress, setMultiUploadProgress] = useState<{ current: number; total: number } | null>(null);
  const [isNarrowScreen, setIsNarrowScreen] = useState(false);
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

  // ── AUDIO REFS ────────────────────────────────────────────────────────────────
  const notificationSoundRef = useRef<HTMLAudioElement | null>(null);
  const ringtoneRef = useRef<HTMLAudioElement | null>(null);
  const ringtonePlayPromise = useRef<Promise<void> | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const ringtoneRetryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ringtoneActiveRef = useRef(false);

  // ── AUDIO INIT & RINGTONE LOAD ────────────────────────────────────────────────
  useEffect(() => {
    notificationSoundRef.current = Object.assign(new Audio("/notification.mp3"), { volume: 0.7, preload: "auto" });
    notificationSoundRef.current.load();
    remoteAudioRef.current = Object.assign(new Audio(), { autoplay: true, volume: 1.0 });

    const loadRingtone = async () => {
      try {
        const keys = ["Flux_ringtone_name", "Flux_custom_ringtone_name", "Flux_custom_ringtone_data"];
        const res = await idbGetMany<string>(keys);
        const saved = res.get("Flux_ringtone_name");
        const name = res.get("Flux_custom_ringtone_name");
        const data = res.get("Flux_custom_ringtone_data");

        if (saved) setRingtonePref(saved);
        if (name) setCustomRingtoneName(name);

        let src = "/ringtone.mp3";
        if (saved === "custom_file") src = data || src;
        else if (saved === "ringtone2") src = "/ringtone2.mp3";
        else if (saved === "ringtone3") src = "/ringtone3.mp3";
        ringtoneRef.current = Object.assign(new Audio(src), { loop: true, volume: 1.0, preload: "auto" });
        ringtoneRef.current.load();
      } catch (err) {
        console.error("Failed to load ringtone from IndexedDB:", err);
        ringtoneRef.current = Object.assign(new Audio("/ringtone.mp3"), { loop: true, volume: 1.0, preload: "auto" });
        ringtoneRef.current.load();
      }
    };
    loadRingtone();
  }, []);

  useEffect(() => {
    const unlock = () => {
      [notificationSoundRef.current, ringtoneRef.current].forEach(audio => {
        if (!audio) return;
        audio.play().then(() => { audio.pause(); audio.currentTime = 0; }).catch(() => { });
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
    try {
      const data = await apiFetch<{ display_name: string; avatar_url: string; username: string }>("/profile/me");
      const localAvatar = typeof window !== "undefined" ? (localStorage.getItem(`user_avatar_${currentUser}`) || localStorage.getItem(`user_avatar_${data.username}`)) : null;
      setProfile({ displayName: data.display_name || "", avatarUrl: localAvatar || data.avatar_url || "", username: data.username || "" });
      setEditDisplayName(data.display_name || "");
      setEditUsername(data.username || "");
    } catch { }
  }, [apiFetch]);

  const loadContacts = useCallback(async () => {
    try {
      const data = await apiFetch<Contact[]>("/contacts");
      setContacts(data.map(c => ({ ...c, email: c.email.toLowerCase() })));
    } catch { }
  }, [apiFetch]);

  const loadGroups = useCallback(async () => {
    try {
      const gs = await apiFetch<Group[]>("/groups");
      setGroups(gs.map(g => {
        const saved = typeof window !== "undefined" ? localStorage.getItem(`group_avatar_${g.id}`) : null;
        return saved ? { ...g, avatar_url: saved } : g;
      }));
    } catch { }
  }, [apiFetch]);

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
        setIsLoadingHistory(true);
        try {
          const localMsgs = await dbGetMessages(cacheKey, 50);
          if (localMsgs && localMsgs.length > 0) {
            messagesCacheRef.current[cacheKey] = localMsgs;
            setMessages(localMsgs);
            setIsLoadingHistory(false);
            setTimeout(() => scrollBottom(true), 100);
          }
        } catch (err) {
          console.warn("Failed to load history from local DB:", err);
        }
      }
    } else {
      try {
        const localOlderMsgs = await dbGetMessages(cacheKey, 50, beforeId);
        if (localOlderMsgs && localOlderMsgs.length > 0) {
          const list = msgListRef.current;
          const prevScrollHeight = list ? list.scrollHeight : 0;
          const prevScrollTop = list ? list.scrollTop : 0;
          const next = [...localOlderMsgs, ...messages];
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
        decryptedHistory.sort((a, b) => parseTs(a.timestamp).getTime() - parseTs(b.timestamp).getTime());
      }

      if (beforeId) {
        const list = msgListRef.current;
        const prevScrollHeight = list ? list.scrollHeight : 0;
        const prevScrollTop = list ? list.scrollTop : 0;
        const next = [...decryptedHistory, ...messages];
        messagesCacheRef.current[cacheKey] = next;
        setMessages(next);
        requestAnimationFrame(() => requestAnimationFrame(() => { if (list) list.scrollTop = prevScrollTop + (list.scrollHeight - prevScrollHeight); }));
      } else {
        // Retain any pending optimistic messages currently in flight
        const currentTemps = (messagesCacheRef.current[cacheKey] || []).filter(m => String(m.id).startsWith("temp-"));
        const mergedHistory = [...decryptedHistory];
        for (const temp of currentTemps) {
          const alreadyIn = mergedHistory.some(m => m.content === temp.content || (m.timestamp && Math.abs(parseTs(m.timestamp).getTime() - parseTs(temp.timestamp).getTime()) < 5000));
          if (!alreadyIn) {
            mergedHistory.push(temp);
          }
        }
        mergedHistory.sort((a, b) => parseTs(a.timestamp).getTime() - parseTs(b.timestamp).getTime());
        messagesCacheRef.current[cacheKey] = mergedHistory;
        setMessages(mergedHistory);
        if (mergedHistory.length > 0) updateActivity(id, mergedHistory[mergedHistory.length - 1].content, mergedHistory[mergedHistory.length - 1].timestamp, true);
        setTimeout(() => scrollBottom(true), 100);
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
    if (!isAppActiveRef.current || !document.hasFocus()) showLocalNotification(title, body, chatId);
  }, [playNotificationSound, isChatMuted]);

  const notifyCall = useCallback((title: string, body: string) => {
    showCallNotification(title, body);
  }, []);

  const markAllRead = useCallback(() => { setUnread({}); }, []);

  const contactLabelFn = useCallback((c: Contact) =>
    nicknames[c.email] || c.display_name || (c.username ? `@${c.username}` : null) || "Unknown User",
    [nicknames]);
  const contactLabel = contactLabelFn;

  const getPeerName = useCallback((email: string) => {
    const c = contacts.find(c => c.email === email);
    return c ? contactLabelFn(c) : "Unknown User";
  }, [contacts, contactLabelFn]);

  const applyAudioOutput = useCallback((speaker: boolean) => {
    [remoteAudioRef.current, remoteVideoRef.current].forEach(el => {
      if (!el) return;
      if ("setSinkId" in el) (el as any).setSinkId(speaker ? "" : "communications").catch(() => { });
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

  const saveProfile = async () => {
    try {
      const body: any = {};
      if (editDisplayName.trim()) body.display_name = editDisplayName.trim();
      if (editUsername.trim() && editUsername.trim() !== profile.username) {
        const u = editUsername.trim().toLowerCase();
        if (!USERNAME_RE.test(u)) { showToast("Invalid username format", "error"); return; }
        body.username = u;
      }
      await apiFetch("/profile/me", { method: "PATCH", body: JSON.stringify(body) });
      updateProfile({ displayName: editDisplayName.trim() || profile.displayName, username: body.username || profile.username });
      setShowProfile(false);
      await loadProfile();
    } catch (err) { showToast("Failed to save profile: " + errorMessage(err), "error"); }
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploadingAvatar(true);
    try {
      let avatarUrl = "";
      try {
        const uploadRes = await uploadMediaToBackend(file, token, `avatar_${currentUser}.jpg`);
        avatarUrl = uploadRes.url;
      } catch (uploadErr) {
        console.warn("Backend avatar upload failed, using local compression:", uploadErr);
        avatarUrl = await compressImage(file, 400, 0.82);
      }

      if (typeof window !== "undefined") {
        try {
          localStorage.setItem(`user_avatar_${currentUser}`, avatarUrl);
        } catch {}
      }
      updateProfile({ avatarUrl });
      apiFetch("/profile/me", { method: "PATCH", body: JSON.stringify({ avatar_url: avatarUrl }) }).catch(() => {});
      showToast("Profile avatar updated!", "success");
    } catch (err: any) {
      showToast("Avatar update failed: " + (err?.message || "Error"), "error");
    } finally {
      setIsUploadingAvatar(false);
      e.target.value = "";
    }
  };

  const handleGroupAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!activeChat || activeChat.type !== "group") return;
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploadingGroupAvatar(true);
    try {
      let avatarUrl = "";
      try {
        const uploadRes = await uploadMediaToBackend(file, token, `group_${activeChat.id}.jpg`);
        avatarUrl = uploadRes.url;
      } catch (uploadErr) {
        console.warn("Backend group avatar upload failed, using local compression:", uploadErr);
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
        wsSend(JSON.stringify({ type: "group_message", content: `[SYSTEM] member_added:${memberEmail}`, group_id: activeChat.id }));
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

  const deleteChat = useCallback((type: "user" | "group", id: string | number) => {
    const sid = type === "user" ? String(id).toLowerCase() : String(id);
    setSidebarDeleteId(null);
    delete messagesCacheRef.current[sid];
    setLastActivity(prev => { const n = { ...prev }; delete n[sid]; return n; });
    setLastPreview(prev => { const n = { ...prev }; delete n[sid]; return n; });
    setUnread(prev => { const n = { ...prev }; delete n[sid]; return n; });
    if (type === "user") setContacts(prev => prev.filter(c => c.email !== sid));
    else setGroups(prev => prev.filter(g => String(g.id) !== sid));
    if (activeChat && String(activeChat.id).toLowerCase() === sid.toLowerCase()) { setActiveChat(null); setMessages([]); }
    apiFetch(type === "user" ? `/conversations/user/${encodeURIComponent(sid)}` : `/conversations/group/${sid}`, { method: "DELETE" }).catch(() => { });
  }, [activeChat, apiFetch]);

  const sendReadReceipt = useCallback(async (chat: Chat) => {
    const chatId = chat.type === "user" ? String(chat.id).toLowerCase() : String(chat.id);
    const sendWS = (payload: object) => { wsSend(JSON.stringify(payload)); };
    try {
      if (chat.type === "user") {
        await apiFetch("/mark-read", { method: "POST", body: JSON.stringify({ peer_email: chatId }) });
        sendWS({ type: "read_receipt", target_user: chatId });
      } else {
        await apiFetch("/mark-read", { method: "POST", body: JSON.stringify({ group_id: chatId }) });
        sendWS({ type: "read_receipt", group_id: chatId });
      }
    } catch {
      setTimeout(async () => {
        try {
          if (chat.type === "user") { await apiFetch("/mark-read", { method: "POST", body: JSON.stringify({ peer_email: chatId }) }); sendWS({ type: "read_receipt", target_user: chatId }); }
          else await apiFetch("/mark-read", { method: "POST", body: JSON.stringify({ group_id: chatId }) });
        } catch { }
      }, 3000);
    }
  }, [apiFetch]);

  const openChat = useCallback(async (chat: Chat) => {
    const chatId = chat.type === "user" ? String(chat.id).toLowerCase() : String(chat.id);
    const normalizedChat = chat.type === "user" ? { ...chat, id: chatId } : chat;
    setIsScrollAnchored(true);
    setActiveChat(normalizedChat);
    setShowHeaderNicknameEdit(false); setShowContactProfile(false); setShowGroupProfile(false);
    setSearchQuery(""); setReplyingTo(null); setReactionPickerId(null); setSelectedMsgId(null);
    setSelectedMsgIds(new Set()); setForwardingMsgs([]);
    setSidebarDeleteId(null); setOpenedProfileFromSidebar(false);
    if (messagesCacheRef.current[chatId]) { setMessages(messagesCacheRef.current[chatId]); setTimeout(() => scrollBottom(true), 10); }
    else setMessages([]);
    setHasMore(false); setShowEmojis(false); setEditingId(null);
    addToReadChats(chatId);
    setUnread(prev => ({ ...prev, [chatId]: 0 }));
    sendReadReceipt(normalizedChat);
    await loadHistory(normalizedChat);
    if (normalizedChat.type === "user" && e2ePrivKeyRef.current) getPeerPubKey(String(normalizedChat.id)).catch(() => { });
    else if (normalizedChat.type === "group" && e2ePrivKeyRef.current) getGroupKey(normalizedChat.id).catch(() => { });
    setMessages(prev => {
      const next = prev.map(m => m.user !== currentUser && !m.is_read ? { ...m, is_read: true } : m);
      messagesCacheRef.current[chatId] = next;
      return next;
    });
    setTimeout(() => scrollBottom(true), 150);
  }, [scrollBottom, loadHistory, currentUser, sendReadReceipt, getPeerPubKey, getGroupKey]);

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

  // ── BACK BUTTON / OVERLAY MANAGEMENT ─────────────────────────────────────────
  useEffect(() => {
    const anyOverlayOpen = showEmojis || showContactProfile || showGroupProfile || showCallLogUI || showProfile || showMyProfileSettings || !!viewFile || reactionPickerId !== null;
    if (anyOverlayOpen) window.history.pushState({ Flux_Overlay: true }, "");
    const handlePopState = () => {
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
      if (showProfile) { setShowProfile(false); return; }
      if (showMyProfileSettings) { setShowMyProfileSettings(false); return; }
      if (activeChat) { setActiveChat(null); return; }
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [showEmojis, showContactProfile, showGroupProfile, showCallLogUI, showProfile, showMyProfileSettings, viewFile, reactionPickerId, activeChat, openedProfileFromSidebar]);

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
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(payload);
    } else {
      pendingMessages.current.push(payload);
      if (typeof window !== "undefined" && currentUserRef.current) {
        try {
          idbSet(`pending_messages_${currentUserRef.current}`, pendingMessages.current).catch(() => {});
        } catch (e) {
          console.error("Failed to save pending messages to storage:", e);
        }
      }
      if (!wsRef.current || wsRef.current.readyState >= WebSocket.CLOSING) initWSRef.current?.();
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
    try { sessionStorage.removeItem("_Flux_call_offer"); } catch { }

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

  const restoreCallOfferFromStorage = useCallback(() => {
    try {
      const stored = sessionStorage.getItem("_Flux_call_offer");
      if (!stored) return false;
      const parsed: StoredCallOffer = JSON.parse(stored);
      if (Date.now() - parsed.ts > 55_000) { sessionStorage.removeItem("_Flux_call_offer"); return false; }
      if (callStateRef.current !== "idle") return false;
      const sdpObj = (parsed.sdp && typeof parsed.sdp === "object") ? parsed.sdp as any : {};
      const offerGroupId = parsed.group_id || sdpObj.group_id;
      if (offerGroupId) callGroupIdRef.current = offerGroupId;
      const realSdp = sdpObj.sdp ? { type: sdpObj.type, sdp: sdpObj.sdp } : parsed.sdp;
      pendingRemoteDescriptionRef.current = realSdp;
      setCallPeer(parsed.peer); setCallPeerName(parsed.peerName);
      setIsVideoCall(parsed.isVideo); isVideoCallRef.current = parsed.isVideo;
      callDirectionRef.current = "incoming";
      updateCallState("incoming");
      startRingtone();
      notifyCall(parsed.isVideo ? "📹 Incoming Video Call" : "📞 Incoming Voice Call", `${parsed.peerName} is calling…`);
      return true;
    } catch { return false; }
  }, [updateCallState, startRingtone, notifyCall]);

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
        if (Date.now() - lastPongRef.current > 35000) { ws.close(); return; }
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
      try { const parsed = JSON.parse(raw); if (parsed.type === "pong") { lastPongRef.current = Date.now(); return; } } catch { return; }
      setTimeout(() => wsHandlerRef.current(raw), 0);
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
        const contactExists = contactsRef.current.some(c => c.email === peerEmail);
        if (!contactExists) {
          setContacts(prev => {
            if (prev.find(c => c.email === peerEmail)) return prev;
            return [...prev, { email: peerEmail, display_name: (data.sender_name as string) || null, avatar_url: (data.sender_avatar as string) || null, is_online: true, username: null }];
          });
          apiFetchRef.current("/contacts/by-email", { method: "POST", body: JSON.stringify({ email: peerEmail }) })
            .then(() => loadContactsRef.current())
            .catch(() => { });
          if (!fetchingProfilesRef.current.has(peerEmail)) {
            fetchingProfilesRef.current.add(peerEmail);
            apiFetchRef.current<Contact>(`/profile/${encodeURIComponent(peerEmail)}`)
              .then(prof => setContacts(prev => prev.map(c => c.email === peerEmail ? { ...c, ...prof } : c)))
              .catch(() => { })
              .finally(() => fetchingProfilesRef.current.delete(peerEmail));
          }
        }
        const isInPeerChat = activeChatRef.current?.type === "user" && String(activeChatRef.current.id).toLowerCase() === peerEmail;
        if (isInPeerChat) {
          lastReplacedTempRef.current = null;
          updateMsgCache(peerEmail, prev => {
            if (dataUser === me) {
              const idx = prev.findIndex(m => String(m.id).startsWith("temp-") && m.content === msg.content);
              if (idx !== -1) { lastReplacedTempRef.current = String(prev[idx].id); const next = [...prev]; next[idx] = msg; return next; }
              if (!prev.find(m => String(m.id) === String(msg.id))) return [...prev, msg];
              return prev;
            }
            if (!prev.find(m => String(m.id) === String(msg.id))) return [...prev, msg];
            return prev;
          });
          const replacedId = lastReplacedTempRef.current;
          if (replacedId) { const t = pendingTempTimers.current.get(replacedId); if (t) { clearTimeout(t); pendingTempTimers.current.delete(replacedId); } setFailedMsgIds(prev => { const n = new Set(prev); n.delete(replacedId); return n; }); }
          setTimeout(() => scrollBottomRef.current?.(), 50);
          if (dataUser !== me && activeChatRef.current) sendReadReceiptRef.current(activeChatRef.current);
        } else {
          const currentList = messagesCacheRef.current[peerEmail];
          if (currentList && !currentList.find(m => String(m.id) === String(msg.id))) {
            let nextList = currentList;
            if (dataUser === me) {
              const idx = currentList.findIndex(m => String(m.id).startsWith("temp-") && m.content === msg.content);
              nextList = idx !== -1 ? [...currentList.slice(0, idx), msg, ...currentList.slice(idx + 1)] : [...currentList, msg];
            } else { nextList = [...currentList, msg]; }
            messagesCacheRef.current[peerEmail] = nextList;
          }
          if (dataUser !== me) {
            setUnread(prev => ({ ...prev, [peerEmail]: (prev[peerEmail] || 0) + 1 }));
            notifyRef.current((data.sender_name as string) || "New message", msg.content.startsWith("[") ? "📎 Attachment" : msg.content, peerEmail);
          }
        }
        break;
      }

      case "group_message": {
        const rawGMsg = data as Message;
        const dataUser = String(rawGMsg.user).toLowerCase();
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
        const groupIdStr = String(data.group_id);
        const groupExists = groupsRef.current.some(g => String(g.id) === groupIdStr);
        if (!groupExists) {
          loadGroupsRef.current();
        }
        const isInGroupChat = activeChatRef.current?.type === "group" && String(activeChatRef.current.id) === String(data.group_id);
        if (isInGroupChat) {
          lastReplacedTempRef.current = null;
          updateMsgCache(String(data.group_id), prev => {
            if (dataUser === me) {
              const idx = prev.findIndex(m => String(m.id).startsWith("temp-") && m.content === msg.content);
              if (idx !== -1) { lastReplacedTempRef.current = String(prev[idx].id); const next = [...prev]; next[idx] = msg; return next; }
              if (!prev.find(m => String(m.id) === String(msg.id))) return [...prev, msg];
              return prev;
            }
            if (!prev.find(m => String(m.id) === String(msg.id))) return [...prev, msg];
            return prev;
          });
          const replacedId = lastReplacedTempRef.current;
          if (replacedId) { const t = pendingTempTimers.current.get(replacedId); if (t) { clearTimeout(t); pendingTempTimers.current.delete(replacedId); } setFailedMsgIds(prev => { const n = new Set(prev); n.delete(replacedId); return n; }); }
          setTimeout(() => scrollBottomRef.current?.(), 50);
        } else {
          const currentList = messagesCacheRef.current[String(data.group_id)];
          if (currentList && !currentList.find(m => String(m.id) === String(msg.id))) {
            let nextList = currentList;
            if (dataUser === me) {
              const idx = currentList.findIndex(m => String(m.id).startsWith("temp-") && m.content === msg.content);
              nextList = idx !== -1 ? [...currentList.slice(0, idx), msg, ...currentList.slice(idx + 1)] : [...currentList, msg];
            } else { nextList = [...currentList, msg]; }
            messagesCacheRef.current[String(data.group_id)] = nextList;
          }
          if (dataUser !== me) {
            setUnread(prev => ({ ...prev, [String(data.group_id)]: (prev[String(data.group_id)] || 0) + 1 }));
            notifyRef.current(`${data.group_name}`, `${data.sender_name || "Someone"}: ${msg.content.startsWith("[") ? "📎 Attachment" : msg.content}`, String(data.group_id));
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

      case "message_deleted": {
        const targetChatId = data.group_id 
          ? String(data.group_id) 
          : (activeChatRef.current ? String(activeChatRef.current.id).toLowerCase() : "");
        setMessages(prev => {
          const next = prev.map(m => String(m.id) === String(data.id) ? { ...m, is_deleted: true } : m);
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
        const realSdp = sdpObj.sdp ? { type: sdpObj.type, sdp: sdpObj.sdp } : data.sdp;

        if (isMesh) {
          if (callStateRef.current === "connected") {
            if (!pcMapRef.current.has(callerEmail)) {
              try {
                const meshPc = await setupWebRTCRef.current(callerEmail);
                await meshPc.setRemoteDescription(new RTCSessionDescription(realSdp as RTCSessionDescriptionInit));
                const queue = iceQueuesRef.current.get(callerEmail) || [];
                while (queue.length > 0) { const c = queue.shift(); if (c) await meshPc.addIceCandidate(new RTCIceCandidate(c)).catch(console.error); }
                iceQueuesRef.current.set(callerEmail, queue);
                const meshAnswer = await meshPc.createAnswer();
                await meshPc.setLocalDescription(meshAnswer);
                wsSendRef.current(JSON.stringify({ type: "call_answer", target_user: callerEmail, sdp: meshAnswer }));
              } catch { }
            }
          } else {
            pendingMeshOffersRef.current.set(callerEmail, realSdp as RTCSessionDescriptionInit);
          }
          break;
        }

        iceCandidateQueueRef.current = [];
        iceQueuesRef.current.clear();
        if (callStateRef.current === "idle") pendingMeshOffersRef.current.clear();
        if (offerGroupId) callGroupIdRef.current = offerGroupId as string | number;

        const existingContact = contactsRef.current.find(c => c.email === callerEmail);
        const callerDisplayName = String(offerSenderName || "").trim() || (existingContact ? contactLabelFnRef.current(existingContact) : "") || callerEmail.split("@")[0] || "Incoming Call";
        const offerPayload: StoredCallOffer = { sdp: realSdp as RTCSessionDescriptionInit, peer: callerEmail, peerName: callerDisplayName, isVideo: vid, ts: Date.now(), group_id: offerGroupId as string | number };

        try { sessionStorage.setItem("_Flux_call_offer", JSON.stringify(offerPayload)); } catch { }
        setCallPeer(callerEmail); setCallPeerName(callerDisplayName);
        callPeerRef.current = callerEmail; callPeerNameRef.current = callerDisplayName;
        setIsVideoCall(vid); isVideoCallRef.current = vid;
        updateCallStateRef.current("incoming"); callDirectionRef.current = "incoming";
        pendingRemoteDescriptionRef.current = realSdp as RTCSessionDescriptionInit;
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
        if (pc) {
          await pc.setRemoteDescription(new RTCSessionDescription(data.sdp as RTCSessionDescriptionInit));
          updateCallStateRef.current("connected"); callStartTimeRef.current = Date.now();
          const queue = iceQueuesRef.current.get(peer) || [];
          while (queue.length > 0) { const c = queue.shift(); if (c) await pc.addIceCandidate(new RTCIceCandidate(c)).catch(console.error); }
          iceQueuesRef.current.set(peer, queue);
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
  const handleDownloadMedia = async (url: string, filename?: string) => {
    const rawExt = url.split(".").pop()?.split("?")[0]?.toLowerCase() || "jpg";
    const ext = ["jpg", "jpeg", "png", "gif", "webp", "mp4", "mov", "mp3", "pdf", "doc", "docx"].includes(rawExt) ? rawExt : "jpg";
    const name = filename || `Flux_${Date.now()}.${ext}`;

    try {
      const res = await fetch(url, { mode: "cors" });
      if (!res.ok) throw new Error("Fetch failed");
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement("a"), { href: blobUrl, download: name });
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
    } catch { window.open(url, "_blank"); }
  };

  // ── SEND MESSAGE ──────────────────────────────────────────────────────────────
  const sendMessage = async () => {
    if (isUploadingAttachment) return;
    if (navigator.vibrate) navigator.vibrate(15);
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
          
          let fileToUpload = item.file;
          if (item.type === "image" && item.file instanceof File) {
            try {
              const compressed = await compressImage(item.file, 1600, 0.85);
              if (compressed.startsWith("data:")) {
                const blob = await (await fetch(compressed)).blob();
                fileToUpload = new File([blob], (item.file.name || "photo").replace(/\.[^/.]+$/, "") + ".jpg", { type: "image/jpeg" });
              }
            } catch (e) {
              console.warn("Client pre-compression fallback:", e);
            }
          }

          const uploadRes = await uploadMediaToBackend(fileToUpload, token, fileToUpload instanceof File ? fileToUpload.name : undefined);
          const mediaUrl = uploadRes.url;

          const baseTag = item.type === "image" ? `[IMAGE]${mediaUrl}` : item.type === "audio" ? `[AUDIO]${mediaUrl}` : item.type === "video" ? `[VIDEO]${mediaUrl}` : item.type === "pdf" ? `[PDF]${mediaUrl}` : `[FILE]${mediaUrl}`;
          const tag = (i === filesToUpload.length - 1 && captionText) ? `${baseTag}\n${captionText}` : baseTag;
          const { type: chatType, id } = activeChat;
          const chatIdKey = chatType === "user" ? String(id).toLowerCase() : String(id);
          const tempId = `temp-${Date.now()}-${Math.random()}`;
          const ts = new Date().toISOString();
          const optimisticMsg: Message = { id: tempId, user: currentUser, content: tag, timestamp: ts, _dateLabel: getDateLabel(ts), ...(chatType === "user" ? { target_user: String(id) } : { group_id: id, group_name: activeChat.name }), ...(replyingTo ? { reply_to_id: replyingTo.id, reply_to_content: replyingTo.content } : {}) };
          setMessages(prev => { const next = [...prev, optimisticMsg]; messagesCacheRef.current[chatIdKey] = next; return next; });
          dbSaveMessage(optimisticMsg, chatIdKey).catch(() => {});
          updateActivity(id, tag, optimisticMsg.timestamp);
          setTimeout(scrollBottom, 50);
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
          wsSend(JSON.stringify({ type: chatType === "user" ? "direct_message" : "group_message", content: contentToSend, message_type: item.type, ...(chatType === "user" ? { target_user: id } : { group_id: id }), ...(replyingTo ? { reply_to_id: replyingTo.id, reply_to_content: replyingTo.content } : {}) }));
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
    const optimisticMsg: Message = { id: tempId, user: currentUser, content: text, timestamp: ts, _dateLabel: getDateLabel(ts), ...(type === "user" ? { target_user: String(id) } : { group_id: id, group_name: activeChat.name }), ...(replyingTo ? { reply_to_id: replyingTo.id, reply_to_content: replyingTo.content } : {}) };
    setMessages(prev => { const next = [...prev, optimisticMsg]; messagesCacheRef.current[chatIdKey] = next; return next; });
    dbSaveMessage(optimisticMsg, chatIdKey).catch(() => {});
    updateActivity(id, text, optimisticMsg.timestamp);
    setTimeout(scrollBottom, 50);
    const failTimer = setTimeout(() => { setFailedMsgIds(prev => new Set(prev).add(tempId)); pendingTempTimers.current.delete(tempId); }, 60000);
    pendingTempTimers.current.set(tempId, failTimer);
    setReplyingTo(null);

    const basePayload = { type: type === "user" ? "direct_message" : "group_message", message_type: "text", ...(type === "user" ? { target_user: id } : { group_id: id }), ...(replyingTo ? { reply_to_id: replyingTo.id, reply_to_content: replyingTo.content } : {}) };
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

      try {
        await apiFetch<void>(`/messages/${id}`, { method: "DELETE" });
        setMessages(prev => {
          const next = prev.map(m => String(m.id) === String(id) ? { ...m, is_deleted: true } : m);
          messagesCacheRef.current[String(activeChat?.id || "")] = next;
          return next;
        });
        if (activeChat) {
          wsSend(JSON.stringify({
            type: activeChat.type === "user" ? "direct_message" : "group_message",
            message_type: "text",
            content: `[SYSTEM] delete_message:${id}`,
            ...(activeChat.type === "user" ? { target_user: activeChat.id } : { group_id: activeChat.id })
          }));
        }
      } catch { }
    } else {
      setDeletedForMeIds(prev => {
        const next = new Set(prev);
        next.add(String(id));
        if (currentUserRef.current) idbSet(`deleted_for_me_${currentUserRef.current}`, [...next]).catch(() => {});
        deletedForMeIdsRef.current = next;
        return next;
      });
    }
  }, [activeChat, apiFetch, wsSend]);

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

  const takeNativePhoto = useCallback(() => {
    setShowCameraDrawer(false);
    setShowPlusDrawer(false);
    setShowLiveCamera(true);
  }, []);

  const pickNativeGallery = useCallback(() => {
    setShowCameraDrawer(false);
    setShowPlusDrawer(false);
    fileInputRef.current?.click();
  }, []);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0 || !activeChat) return;
    const newPending: typeof pendingFiles = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
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
    const md = navigator.mediaDevices;
    if (!md?.getUserMedia) throw new Error("Camera/microphone not available.");
    try { return await md.getUserMedia(constraints); }
    catch (err: any) {
      const name: string = err?.name || "";
      if ((name === "OverconstrainedError" || name === "ConstraintNotSatisfiedError") && constraints.video && typeof constraints.video === "object") return md.getUserMedia({ audio: constraints.audio, video: true });
      if (name === "NotAllowedError" || name === "PermissionDeniedError") throw new Error("Permission denied. Please allow camera/microphone access.");
      if (name === "NotFoundError" || name === "DevicesNotFoundError") throw new Error("No camera/microphone found.");
      if (name === "NotReadableError" || name === "TrackStartError") throw new Error("Device already in use.");
      throw err;
    }
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
          const uploadRes = await uploadMediaToBackend(blob, token, `voice_${Date.now()}.webm`);
          const audioUrl = uploadRes.url;
          const tag = `[AUDIO]${audioUrl}`;
          const { type, id } = activeChat;
          const chatIdKey = type === "user" ? String(id).toLowerCase() : String(id);
          const tempId = `temp-${Date.now()}-${Math.random()}`;
          const ts = new Date().toISOString();
          const optimisticMsg: Message = { id: tempId, user: currentUser, content: tag, timestamp: ts, _dateLabel: getDateLabel(ts), ...(type === "user" ? { target_user: String(id) } : { group_id: id, group_name: activeChat.name }) };
          setMessages(prev => { const next = [...prev, optimisticMsg]; messagesCacheRef.current[chatIdKey] = next; return next; });
          dbSaveMessage(optimisticMsg, chatIdKey).catch(() => {});
          updateActivity(id, tag, optimisticMsg.timestamp);
          setTimeout(scrollBottom, 50);
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
          wsSend(JSON.stringify({ type: type === "user" ? "direct_message" : "group_message", content: contentToSend, message_type: "audio", ...(type === "user" ? { target_user: id } : { group_id: id }) }));
        } catch (err: any) {
          showToast("Voice upload failed: " + (err?.message || "Error"), "error");
        }
      };
      mr.start(); setIsRecording(true);
    } catch (err: any) { showToast(`Microphone error: ${err?.message || err}`, "error"); setIsRecording(false); }
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
        { urls: "stun:stun3.l.google.com:19302" },
        { urls: "stun:stun4.l.google.com:19302" },
        { urls: "stun:global.stun.twilio.com:3478" },
      ],
      iceCandidatePoolSize: 10,
    };
  }, []);

  const setupWebRTC = async (targetEmail: string) => {
    const localStream = localStreamRef.current;
    if (!localStream) throw new Error("Local media stream unavailable");
    const pc = new RTCPeerConnection(rtcConfig);
    pcMapRef.current.set(targetEmail, pc);
    peerConnectionRef.current = pc;
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

    pc.ontrack = event => {
      setRemoteStreams(prev => {
        const stream = (event.streams?.[0]) || (() => { const s = prev[targetEmail] || new MediaStream(); if (!s.getTracks().find(t => t.id === event.track.id)) s.addTrack(event.track); return s; })();
        if (targetEmail === callPeerRef.current) {
          remoteStreamRef.current = stream;
          const videoEl = remoteVideoRef.current;
          if (videoEl && videoEl.srcObject !== stream) { videoEl.srcObject = stream; videoEl.volume = 1.0; videoEl.play().catch(() => { }); }
          const audioEl = remoteAudioRef.current;
          if (audioEl && audioEl.srcObject !== stream) { audioEl.srcObject = stream; audioEl.volume = 1.0; audioEl.play().catch(() => { }); }
        }
        return { ...prev, [targetEmail]: stream };
      });
      applyAudioOutput(isSpeaker);
    };

    pc.onicecandidate = event => {
      if (event.candidate) {
        wsSend(JSON.stringify({ type: "ice_candidate", target_user: targetEmail, candidate: event.candidate }));
      }
    };

    pc.oniceconnectionstatechange = () => {
      const s = pc.iceConnectionState;
      if (s === "failed") { if (pc.restartIce) pc.restartIce(); else endCall(true, "missed"); }
      if (s === "disconnected") setTimeout(() => { if (pc.iceConnectionState === "disconnected") endCall(true, "missed"); }, 5000);
    };

    pc.onconnectionstatechange = () => { if (pc.connectionState === "failed") endCall(true, "missed"); };
    return pc;
  };

  const startCall = async (video = true) => {
    if (!activeChat) return;
    const isGroup = activeChat.type === "group";
    const groupId = isGroup ? activeChat.id : null;
    if (groupId) callGroupIdRef.current = groupId;
    const targetIds = isGroup ? groups.find(g => g.id === activeChat.id)?.members.map(getEmail).filter(m => m !== currentUser) || [] : [String(activeChat.id)];
    if (!targetIds.length) return;
    try {
      if (localStreamRef.current) localStreamRef.current.getTracks().forEach(t => t.stop());
      iceCandidateQueueRef.current = [];
      setIsVideoCall(video); isVideoCallRef.current = video; setIsVideoSwapped(false);
      updateCallState("calling"); setCallPeer(targetIds[0]);
      callPeerRef.current = targetIds[0];
      const c = contacts.find(c => c.email === targetIds[0]);
      const peerName = c ? contactLabelFn(c) : activeChat.name;
      setCallPeerName(peerName);
      callPeerNameRef.current = peerName;
      callDirectionRef.current = "outgoing";
      localStreamRef.current = await getMediaStream({ audio: true, video: video ? { facingMode: "user", width: { ideal: 640, max: 1280 }, height: { ideal: 480, max: 720 }, frameRate: { ideal: 15, max: 24 } } : false });
      if (localVideoRef.current) { localVideoRef.current.srcObject = localStreamRef.current; localVideoRef.current.play().catch(() => { }); }
      for (const target of targetIds) {
        const pc = await setupWebRTC(target);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        const wrappedSdp = { type: offer.type, sdp: offer.sdp, ...(groupId ? { group_id: groupId } : {}), sender_name: profile.displayName || profile.username || currentUser };
        wsSend(JSON.stringify({ type: "call_offer", target_user: target, sdp: wrappedSdp, isVideo: video, sender_name: profile.displayName || profile.username || currentUser, ...(groupId ? { group_id: groupId } : {}) }));
      }
    } catch (err: any) { showToast(`Could not start call: ${err.message || err}`, "error"); endCall(false); }
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
    try {
      if (localStreamRef.current) localStreamRef.current.getTracks().forEach(t => t.stop());
      const needVideo = isVideoCallRef.current;
      setIsVideoSwapped(false);
      if (!pendingRemoteDescriptionRef.current) {
        try {
          const stored = sessionStorage.getItem("_Flux_call_offer");
          if (stored) {
            const parsed: StoredCallOffer = JSON.parse(stored);
            const sdpObj = (parsed.sdp && typeof parsed.sdp === "object") ? parsed.sdp as any : {};
            const offerGroupId = parsed.group_id || sdpObj.group_id;
            if (offerGroupId) callGroupIdRef.current = offerGroupId;
            const realSdp = sdpObj.sdp ? { type: sdpObj.type, sdp: sdpObj.sdp } : parsed.sdp;
            pendingRemoteDescriptionRef.current = realSdp;
            if (!callPeerRef.current && parsed.peer) {
              callPeerRef.current = parsed.peer; callPeerNameRef.current = parsed.peerName;
              isVideoCallRef.current = parsed.isVideo; callDirectionRef.current = "incoming";
              setCallPeer(parsed.peer); setCallPeerName(parsed.peerName); setIsVideoCall(parsed.isVideo);
            }
          }
        } catch { }
      }
      try { sessionStorage.removeItem("_Flux_call_offer"); } catch { }
      const targetPeer = callPeerRef.current || callPeer || null;
      if (!targetPeer || !pendingRemoteDescriptionRef.current) { endCall(false, "missed"); return; }
      localStreamRef.current = await getMediaStream({ audio: true, video: needVideo ? { facingMode: "user", width: { ideal: 640, max: 1280 }, height: { ideal: 480, max: 720 }, frameRate: { ideal: 15, max: 24 } } : false });
      if (localVideoRef.current) { localVideoRef.current.srcObject = localStreamRef.current; localVideoRef.current.play().catch(() => { }); }
      const pc = await setupWebRTC(targetPeer);
      await pc.setRemoteDescription(new RTCSessionDescription(pendingRemoteDescriptionRef.current));
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
            await meshPc.setRemoteDescription(new RTCSessionDescription(sdp));
            const q = iceQueuesRef.current.get(meshPeer) || [];
            while (q.length > 0) { const c = q.shift(); if (c) await meshPc.addIceCandidate(new RTCIceCandidate(c)).catch(console.error); }
            iceQueuesRef.current.set(meshPeer, q);
            const meshAnswer = await meshPc.createAnswer();
            await meshPc.setLocalDescription(meshAnswer);
            wsSend(JSON.stringify({ type: "call_answer", target_user: meshPeer, sdp: meshAnswer }));
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
    } catch { endCall(false, "missed"); }
    finally { acceptInProgressRef.current = false; }
  };

  const rejectCall = () => {
    stopRingtone(); cancelCallNotification();
    try { sessionStorage.removeItem("_Flux_call_offer"); } catch { }
    if (callPeer) wsSend(JSON.stringify({ type: "call_reject", target_user: callPeer }));
    pcMapRef.current.forEach((_, peerEmail) => { if (peerEmail !== callPeer) wsSend(JSON.stringify({ type: "call_end", target_user: peerEmail })); });
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
    const contactList = (q ? contacts.filter(c => contactLabel(c).toLowerCase().includes(q) || (c.username || "").toLowerCase().includes(q)) : contacts)
      .map(c => ({ type: "user" as const, id: c.email, item: c, lastActivityTs: lastActivity[c.email] || 0 }));
    const groupList = (q ? groups.filter(g => g.name.toLowerCase().includes(q)) : groups)
      .map(g => ({ type: "group" as const, id: String(g.id), item: g, lastActivityTs: lastActivity[String(g.id)] || 0 }));
    return [...contactList, ...groupList].sort((a, b) => b.lastActivityTs - a.lastActivityTs);
  }, [contacts, groups, searchQuery, lastActivity, contactLabel]);

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
    if (relevantLogs.length === 0) return filteredMessages;

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
      const label = msg._dateLabel || getDateLabel(msg.timestamp);
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

  const handleAppClick = useCallback(() => { setSidebarDeleteId(null); setReactionPickerId(null); setSelectedMsgId(null); setShowMuteMenu(false); setShowStickers(false); }, []);
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
                <div className="sb-brand-icon-wrap" style={{ overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <img src="/icon.png" alt="Flux" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                </div>
                <span className="sb-brand-name">Flux</span>
                <span
                  className="sb-ws-dot"
                  style={{
                    background: wsStatus === "connected" ? "#4ade80" : wsStatus === "reconnecting" ? "#fbbf24" : wsStatus === "offline" ? "#ef4444" : "#333",
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
                {totalUnread > 0 && (
                  <span onClick={e => { e.stopPropagation(); markAllRead(); }} title="Mark all read" className="sb-total-unread">
                    {totalUnread > 99 ? "99+" : totalUnread}
                  </span>
                )}
              </div>
              <div className="sb-brand-actions">
                <button className="sb-icon-btn" title="Call History" aria-label="Call History" onClick={e => { e.stopPropagation(); setShowCallLogUI(true); }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 014.69 12a19.79 19.79 0 01-3.07-8.67A2 2 0 013.6 1.37h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L7.91 9a16 16 0 006.09 6.09l1.97-1.85a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7a2 2 0 011.72 2.03z" /></svg>
                </button>
                <button className={`sb-icon-btn ${showMyProfileSettings ? "sb-icon-btn--active" : ""}`} title="Settings" aria-label="Settings" onClick={e => { e.stopPropagation(); setShowMyProfileSettings(v => !v); }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" /></svg>
                </button>
              </div>
            </div>

            <div className="sb-identity" onClick={e => { e.stopPropagation(); if (profile.avatarUrl) setViewFile({ url: profile.avatarUrl, type: "avatar-circle" }); }}>
              <div className="sb-id-avatar">
                {profile.avatarUrl
                  ? <img src={profile.avatarUrl} alt="Avatar" className="img-cover rounded-sq" />
                  : (profile.displayName || currentUser)?.[0]?.toUpperCase() || "?"}
              </div>
              <div className="sb-id-info">
                <span className="sb-id-name">{profile.displayName || profile.username || "Me"}</span>
                <span className="sb-id-status">
                  @{profile.username}
                </span>
              </div>
            </div>

            {showMyProfileSettings && (
              <>
                <div className="settings-backdrop-overlay" onClick={() => setShowMyProfileSettings(false)} />
                <div className="my-profile-settings-panel" onClick={e => e.stopPropagation()}>
                  <div className="settings-header">
                    <span className="settings-title">Settings</span>
                    <button className="settings-close-btn" onClick={() => setShowMyProfileSettings(false)} aria-label="Close settings">✕</button>
                  </div>
                  <input type="file" ref={avatarInputRef} accept="image/*" className="hidden-input" onChange={handleAvatarUpload} />

                  {/* ── Account ── */}
                  <div className="settings-section">
                    <div className="settings-section-label">Account</div>
                    <div className="settings-card">
                      <button className="settings-action-row settings-action-row--profile" onClick={() => setShowProfile(!showProfile)}>
                        <span className="settings-action-row__icon">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
                        </span>
                        <span style={{ flex: 1 }}>Edit Profile</span>
                        <svg className={`chevron ${showProfile ? "chevron--up" : ""}`} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6,9 12,15 18,9" /></svg>
                      </button>

                      {showProfile && (
                        <div style={{ padding: "0 12px 14px", borderTop: "1px solid var(--border)" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 0 10px" }}>
                            <div style={{ width: 52, height: 52, borderRadius: "50%", overflow: "hidden", background: "var(--surface-2)", border: "2px solid var(--border-2)", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, fontWeight: 700, color: "var(--green)" }}>
                              {profile.avatarUrl ? <img src={profile.avatarUrl} alt="Avatar" className="img-cover" /> : (profile.displayName || currentUser)?.[0]?.toUpperCase() || "?"}
                            </div>
                            <button onClick={() => avatarInputRef.current?.click()} className="avatar-upload-btn" disabled={isUploadingAvatar} style={{ flex: 1 }}>
                              {isUploadingAvatar ? "Uploading…" : "📷 Change Photo"}
                            </button>
                          </div>
                          <input value={editDisplayName} onChange={e => setEditDisplayName(e.target.value)} placeholder="Display name…" className="sb-field" />
                          <div style={{ position: "relative" }}>
                            <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--text-3)", fontWeight: 700, fontSize: 13 }}>@</span>
                            <input value={editUsername} onChange={e => setEditUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))} placeholder="username" className="sb-field" style={{ paddingLeft: 24 }} />
                          </div>
                          <p className="text-muted-sm text-muted-sm-margin">Username is how others find you on Flux.</p>
                          <button onClick={saveProfile} className="sb-save-btn">Save Profile</button>
                        </div>
                      )}

                      <button onClick={logout} className="settings-action-row settings-action-row--danger">
                        <span className="settings-action-row__icon">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" /></svg>
                        </span>
                        Sign Out
                      </button>
                    </div>
                  </div>

                  {/* ── Preferences ── */}
                  <div className="settings-section">
                    <div className="settings-section-label">Preferences</div>
                    <div className="settings-card" style={{ display: "flex", flexDirection: "column" }}>
                      <div className="ringtone-current-row">
                        <div className="ringtone-current-info">
                          <span className="settings-ringtone-icon" style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, borderRadius: "50%", background: "rgba(var(--green-rgb),0.1)", color: "var(--green)" }}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>
                          </span>
                          <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                            <span style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>Call Ringtone</span>
                            <span className="ringtone-current-name">
                              {ringtonePref === "ringtone" && "Flux Default"}
                              {ringtonePref === "ringtone2" && "Digital Alarm"}
                              {ringtonePref === "ringtone3" && "Retro Phone"}
                              {ringtonePref === "custom_file" && (customRingtoneName || "Custom Ringtone")}
                              {!["ringtone", "ringtone2", "ringtone3", "custom_file"].includes(ringtonePref) && "Flux Default"}
                            </span>
                          </div>
                        </div>
                        <button onClick={() => setShowRingtonePicker(!showRingtonePicker)} className="ringtone-change-btn">
                          {showRingtonePicker ? "Close" : "Change"}
                        </button>
                      </div>

                      {showRingtonePicker && (
                        <div className="ringtone-picker-list" style={{ borderTop: "1px solid var(--border)" }}>
                          <div className="ringtone-category"><span className="ringtone-category-icon">🎵</span> Built-in Ringtones</div>
                          {[
                            { id: "ringtone", name: "Flux Default" },
                            { id: "ringtone2", name: "Digital Alarm" },
                            { id: "ringtone3", name: "Retro Phone" },
                          ].map(item => (
                            <div key={item.id} onClick={() => handleRingtoneChange(item.id)} className={`ringtone-option ${ringtonePref === item.id ? "ringtone-option--active" : ""}`}>
                              <button onClick={e => togglePreview(e, item.id)} className={`ringtone-preview-btn ${previewActive === item.id ? "ringtone-preview-btn--playing" : ""}`} title="Preview">
                                {previewActive === item.id
                                  ? <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></svg>
                                  : <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>}
                              </button>
                              <span className="ringtone-option-name">{item.name}</span>
                              <div className={`ringtone-check ${ringtonePref === item.id ? "ringtone-check--active" : ""}`}>
                                {ringtonePref === item.id && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="4"><polyline points="20 6 9 17 4 12" /></svg>}
                              </div>
                            </div>
                          ))}



                          <div className="ringtone-category" style={{ marginTop: 6 }}><span className="ringtone-category-icon">📁</span> Custom Ringtone</div>
                          {customRingtoneName && (
                            <div onClick={() => handleRingtoneChange("custom_file")} className={`ringtone-option ${ringtonePref === "custom_file" ? "ringtone-option--active" : ""}`}>
                              <button onClick={e => togglePreview(e, "custom_file")} className={`ringtone-preview-btn ${previewActive === "custom_file" ? "ringtone-preview-btn--playing" : ""}`} title="Preview custom">
                                {previewActive === "custom_file"
                                  ? <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></svg>
                                  : <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>}
                              </button>
                              <span className="ringtone-option-name" style={{ color: "var(--green)", fontWeight: 500 }}>{customRingtoneName}</span>
                              <div className={`ringtone-check ${ringtonePref === "custom_file" ? "ringtone-check--active" : ""}`}>
                                {ringtonePref === "custom_file" && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="4"><polyline points="20 6 9 17 4 12" /></svg>}
                              </div>
                            </div>
                          )}
                          <label className="ringtone-upload-row">
                            <input type="file" accept="audio/*" onChange={handleCustomRingtoneUpload} style={{ display: "none" }} />
                            <span style={{ fontSize: 16 }}>📤</span>
                            <span style={{ fontSize: 13, fontWeight: 500 }}>
                              {customRingtoneName ? "Upload a different audio file" : "Upload custom audio from device"}
                            </span>
                          </label>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* ── Notifications ── */}
                  <div className="settings-section">
                    <div className="settings-section-label">Notifications</div>
                    <div className="settings-card" style={{ display: "flex", flexDirection: "column" }}>
                      <div className="ringtone-current-row">
                        <div className="ringtone-current-info">
                          <span className="settings-ringtone-icon" style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, borderRadius: "50%", background: "rgba(var(--green-rgb),0.1)", color: "var(--green)" }}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0" /></svg>
                          </span>
                          <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                            <span style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>Desktop Notifications</span>
                            <span className="ringtone-current-name">
                              {typeof window !== "undefined" && "Notification" in window
                                ? Notification.permission === "granted"
                                  ? "Enabled"
                                  : Notification.permission === "denied"
                                    ? "Blocked"
                                    : "Not Configured"
                                : "Unsupported"}
                            </span>
                          </div>
                        </div>
                        {typeof window !== "undefined" && "Notification" in window && Notification.permission !== "granted" && (
                          <button onClick={async () => {
                            const tokenVal = await requestFCMPermission();
                            if (tokenVal) {
                              showToast("Desktop notifications enabled!", "success");
                            } else {
                              showToast("Permission denied or blocked.", "error");
                            }
                          }} className="ringtone-change-btn">
                            Enable
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* ── Privacy ── */}
                  <div className="settings-section">
                    <div className="settings-section-label">Privacy</div>
                    <div className="settings-card">
                      <button className="settings-action-row" onClick={() => setShowBlockedList(!showBlockedList)}>
                        <span className="settings-action-row__icon" style={{ color: "var(--danger)", background: "var(--danger-dim)" }}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0110 0v4" /></svg>
                        </span>
                        <span style={{ flex: 1, color: blockedUsers.size > 0 ? "var(--danger)" : "inherit" }}>Blocked Users</span>
                        <span style={{ background: blockedUsers.size > 0 ? "var(--danger-dim)" : "rgba(255,255,255,0.08)", color: blockedUsers.size > 0 ? "var(--danger)" : "inherit", padding: "2px 6px", borderRadius: 10, fontSize: 11, marginRight: 6, border: blockedUsers.size > 0 ? "1px solid var(--danger-border)" : "none" }}>{blockedUsers.size}</span>
                        <svg className={`chevron ${showBlockedList ? "chevron--up" : ""}`} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6,9 12,15 18,9" /></svg>
                      </button>
                      {showBlockedList && (
                        <div style={{ padding: "10px 12px 14px", borderTop: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 8 }}>
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
                  </div>
                  <div style={{ height: 6 }} />
                </div>
              </>
            )}

            <div className="sb-divider" />

            <div className="sb-search-container">
              <div className="sb-search-wrap">
                <svg className="sb-search-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
                <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search conversations…" className="sb-search-input" />
                {searchQuery && <button onClick={() => setSearchQuery("")} className="sb-search-clear" aria-label="Clear search">✕</button>}
              </div>
              {totalUnread > 0 && (
                <button onClick={e => { e.stopPropagation(); markAllRead(); }} className="sb-mark-read-btn">✓ All</button>
              )}
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
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" /></svg>
                      <span className="sb-section-label-text">Chats</span>
                    </div>
                  </div>
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
                </div>
              </>
            )}

            <div className="sb-footer-sticky">
              {showNewContact && (
                <div className="sb-add-form drop" style={{ marginBottom: 4 }}>
                  <div style={{ position: "relative" }}>
                    <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--text-3)", fontWeight: 700, fontSize: 13 }}>@</span>
                    <input
                      value={newContactUsername}
                      onChange={e => setNewContactUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))}
                      onKeyDown={e => { if (e.key === "Enter") { addContactByUsername(newContactUsername); setNewContactUsername(""); setShowNewContact(false); } }}
                      placeholder="username"
                      className="sb-field"
                      style={{ paddingLeft: 22 }}
                      autoFocus
                    />
                  </div>
                  <p className="text-muted-sm">Search by @username</p>
                  <button onClick={() => { addContactByUsername(newContactUsername); setNewContactUsername(""); setShowNewContact(false); }} className="sb-go-btn">Start chat</button>
                </div>
              )}

              {showNewGroup && (
                <div className="sb-add-form drop" style={{ marginBottom: 4 }}>
                  <input value={newGroupName} onChange={e => setNewGroupName(e.target.value)} placeholder="Group name *" className="sb-field" />
                  <input value={newGroupDesc} onChange={e => setNewGroupDesc(e.target.value)} placeholder="Description (optional)" className="sb-field" />
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "6px 8px", background: "var(--surface-2)", borderRadius: 8, minHeight: 38, alignItems: "center" }}>
                    {newGroupMemberChips.map(chip => (
                      <span key={chip} style={{ display: "flex", alignItems: "center", gap: 4, background: "var(--primary)", color: "#fff", borderRadius: 20, padding: "2px 10px", fontSize: 12 }}>
                        @{chip}
                        <button onClick={() => setNewGroupMemberChips(prev => prev.filter(c => c !== chip))} style={{ background: "none", border: "none", color: "#fff", cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 0 }} aria-label="Remove member">×</button>
                      </span>
                    ))}
                    <input
                      value={newGroupMemberInput}
                      onChange={e => {
                        const val = e.target.value;
                        const start = e.target.selectionStart;
                        const end = e.target.selectionEnd;
                        setNewGroupMemberInput(val);
                        const input = e.target;
                        requestAnimationFrame(() => {
                          try { input.setSelectionRange(start, end); } catch { }
                        });
                      }}
                      onKeyDown={e => {
                        if ((e.key === "Enter" || e.key === " ") && newGroupMemberInput.trim()) {
                          e.preventDefault();
                          const uname = newGroupMemberInput.trim().replace(/^@/, "");
                          if (uname && !newGroupMemberChips.includes(uname)) setNewGroupMemberChips(prev => [...prev, uname]);
                          setNewGroupMemberInput("");
                        }
                      }}
                      placeholder={newGroupMemberChips.length === 0 ? "Add @username & press Enter" : "Add more…"}
                      style={{ border: "none", outline: "none", background: "transparent", flex: 1, minWidth: 120, fontSize: 13, color: "var(--text-1)", padding: "2px 4px" }}
                    />
                  </div>
                  <button
                    onClick={async () => {
                      const allChips = newGroupMemberInput.trim()
                        ? [...newGroupMemberChips, newGroupMemberInput.trim().replace(/^@/, "")]
                        : newGroupMemberChips;
                      if (!newGroupName.trim()) return;
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
                      } catch (err) { showToast("Failed to create group: " + errorMessage(err), "error"); }
                    }}
                    className="sb-go-btn secondary"
                  >Create group</button>
                </div>
              )}

              <div className="sb-bottom-bar">
                <button className={`sb-bottom-btn ${showNewContact ? "active-dm" : ""}`} onClick={() => { setShowNewContact(!showNewContact); setShowNewGroup(false); }} title="New direct message">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" /></svg>
                  New DM
                </button>
                <button className={`sb-bottom-btn ${showNewGroup ? "active-group" : ""}`} onClick={() => { setShowNewGroup(!showNewGroup); setShowNewContact(false); }} title="New group">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /></svg>
                  New Group
                </button>
              </div>
            </div>
          </aside>

          {/* ── CHAT MAIN ─────────────────────────────────────────────────────── */}
          <main className="chat">
            {!chat ? (
              <div className="empty-state">
                <div className="empty-rings" style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <div className="ring r1" /><div className="ring r2" /><div className="ring r3" />
                  <img className="z-1-relative" src="/icon.png" alt="Flux" style={{ width: 48, height: 48, objectFit: "cover", borderRadius: 12, boxShadow: "0 8px 24px rgba(0,0,0,0.4)" }} />
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
                          <button className="tool-btn" style={{ width: 34, height: 34, borderRadius: "50%", background: "var(--surface-hover)", border: "none" }} onClick={() => toggleSelectMsg(null)} aria-label="Cancel selection">✕</button>
                          <span style={{ fontSize: 15, fontWeight: 650, color: "#fff", whiteSpace: "nowrap" }}>{selectedMsgIds.size} {selectedMsgIds.size === 1 ? "message" : "messages"} selected</span>
                        </div>
                        <div className="hdr-action-buttons" style={{ display: "flex", gap: 6, flexShrink: 0 }}>
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
                                  >
                                    📌
                                  </button>
                                );
                              })()}
                              <button onClick={() => { setReplyingTo(singleMsg); toggleSelectMsg(null); }} className="tool-btn" title="Reply" aria-label="Reply to message">↩</button>
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
                              ↗
                            </button>
                          )}
                          {isSingle && isSingleMine && singleMsg && !singleMsg._callRecord && (
                            <>
                              <button onClick={() => { setEditingId(singleMsg.id); setEditingText(singleMsg.content); toggleSelectMsg(null); }} className="tool-btn" title="Edit" aria-label="Edit message">✎</button>
                              {chat.type === "group" && (
                                <button onClick={() => { setMessageInfoMsg(singleMsg); toggleSelectMsg(null); }} className="tool-btn" title="Message Info" aria-label="View message info">ⓘ</button>
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
                            🗑
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
                          {chat.type === "user" && contacts.find(c => c.email === chat.id)?.avatar_url
                            ? <img src={contacts.find(c => c.email === chat.id)!.avatar_url!} alt="avatar" className="img-cover rounded-circle" />
                            : chat.type === "group" && groups.find(g => g.id === chat.id)?.avatar_url
                              ? <img src={groups.find(g => g.id === chat.id)!.avatar_url!} alt="group" className="img-cover rounded-circle" />
                              : chat.name?.[0]?.toUpperCase() || "?"}
                          <div className="hdr-av-overlay">view</div>
                        </div>
                        <div className="hdr-info">
                          <div className="name-row-inline">
                            <span className="hdr-name">
                              {chat.type === "user"
                                ? (() => { const c = contacts.find(c => c.email === chat.id); return c ? contactLabel(c) : chat.name; })()
                                : chat.name}
                            </span>
                            {chat.type === "group" && <span className="group-badge" style={{ flexShrink: 0 }}>Group</span>}
                            {chat.type === "user" && (
                              <button onClick={openHeaderNicknameEdit} className={`btn-pencil-nickname ${showHeaderNicknameEdit ? "active" : ""}`} aria-label="Edit nickname">
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                              </button>
                            )}
                          </div>
                          {chat.type === "user" && (() => { const c = contacts.find(c => c.email === chat.id); return c?.username ? <span className="hdr-meta hdr-meta-nickname">@{c.username}</span> : null; })()}
                          <span className="hdr-meta">
                            {chat.type === "user" ? (
                              <><span className={`hdr-dot ${contacts.find(c => c.email === chat.id)?.is_online ? "hdr-dot--on" : ""}`} />{contacts.find(c => c.email === chat.id)?.is_online ? "Online" : "Offline"}</>
                            ) : <>{groups.find(g => g.id === chat.id)?.members.length || "?"} members</>}
                          </span>
                        </div>
                      </div>
                      <div className="hdr-right">
                        <button onClick={() => startCall(false)} className="tool-btn" title="Voice Call" aria-label="Start voice call">
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 014.69 12a19.79 19.79 0 01-3.07-8.67A2 2 0 013.6 1.37h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L7.91 9a16 16 0 006.09 6.09l1.97-1.85a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7a2 2 0 011.72 2.03z" /></svg>
                        </button>
                        <button onClick={() => startCall(true)} className="tool-btn" title="Video Call" aria-label="Start video call">
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" /></svg>
                        </button>

                        <div style={{ position: "relative" }}>
                          <button
                            onClick={e => { e.stopPropagation(); setShowMuteMenu(!showMuteMenu); }}
                            className={`tool-btn ${isChatMuted(String(chat.id)) ? "tool-btn--on" : ""}`}
                            title={isChatMuted(String(chat.id)) ? "Unmute notifications" : "Mute notifications"}
                            aria-label="Mute notifications"
                          >
                            {isChatMuted(String(chat.id)) ? (
                              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M13.73 21a2 2 0 01-3.46 0" /><path d="M18.63 13A17.9 17.9 0 0118 8" /><path d="M6.26 6.26A5.86 5.86 0 006 8c0 7-3 9-3 9h14" /><path d="M18 8a6 6 0 00-9.33-5" /><line x1="1" y1="1" x2="23" y2="23" /></svg>
                            ) : (
                              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 01-3.46 0" /></svg>
                            )}
                          </button>
                          {showMuteMenu && (
                            <div style={{ position: "absolute", top: "calc(100% + 8px)", right: 0, zIndex: 900, background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: "var(--r-lg)", boxShadow: "0 8px 24px rgba(0,0,0,0.2)", minWidth: 160, overflow: "hidden" }} onClick={e => e.stopPropagation()}>
                              {isChatMuted(String(chat.id)) ? (
                                <button className="mute-menu-item" onClick={() => unmuteChat(String(chat.id), chat.type)}>🔔 Unmute</button>
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
                            </div>
                          )}
                        </div>

                        <button className="tool-btn" title="Delete chat" aria-label="Delete chat" onClick={() => { showConfirm("Delete this chat? Only you will lose it.", () => deleteChat(chat.type, chat.id)); }}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" /><path d="M10 11v6M14 11v6M9 6V4h6v2" /></svg>
                        </button>
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
                          {latestPin.content.startsWith("[") ? "📎 Attachment" : latestPin.content}
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
                        ↩ Replying to {replyingTo.user === currentUser ? "yourself" : (replyingTo.sender_name || getPeerName(replyingTo.user))}
                      </div>
                      <div style={{ fontSize: 12, color: "var(--text-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {replyingTo.content.startsWith("[") ? "📎 Attachment" : replyingTo.content}
                      </div>
                    </div>
                    <button onClick={() => setReplyingTo(null)} style={{ marginLeft: 8, padding: "4px 8px", border: "none", background: "none", cursor: "pointer", fontSize: 16, color: "var(--text-3)" }} aria-label="Cancel reply">✕</button>
                  </div>
                )}

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
                  wsSend={wsSend}
                />
              </>
            )}
          </main>
        </div>
      )}

      {/* ── CALL LOG MODAL ────────────────────────────────────────────────────── */}
      {showCallLogUI && (
        <div className="file-viewer-overlay" onClick={() => setShowCallLogUI(false)}>
          <div className="viewer-content cl-modal" onClick={e => e.stopPropagation()}>
            <div className="cl-header">
              <h2 className="cl-title">Call History</h2>
              <button className="cl-close" onClick={() => setShowCallLogUI(false)} aria-label="Close call history">✕</button>
            </div>
            {nonDeletedCallLogs.length === 0 ? (
              <p className="cl-empty">No recent calls</p>
            ) : (
              <div className="cl-list">
                {nonDeletedCallLogs.map(log => (
                  <div
                    key={log.id}
                    className="cl-item"
                    onClick={() => { setShowCallLogUI(false); startCallFromLog(log, log.media === "video"); }}
                    style={{ cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", transition: "background 0.2s ease", padding: "10px 14px", borderRadius: "10px" }}
                    onMouseEnter={e => e.currentTarget.style.background = "var(--surface-2)"}
                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                  >
                    <div style={{ flex: 1, minWidth: 0, paddingRight: 12 }}>
                      <strong className={`cl-item-name ${log.status !== "completed" ? "missed" : ""}`} style={{ display: "block", marginBottom: 2 }}>{log.peerName || getPeerName(log.peer)}</strong>
                      <span className="cl-item-meta" style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", fontSize: 11, color: "var(--text-3)" }}>
                        <span>{log.direction === "incoming" ? "↙ Incoming" : "↗ Outgoing"}</span>
                        <span>•</span>
                        <span>{log.media === "video" ? "📹 Video" : "📞 Audio"}</span>
                        <span>•</span>
                        <span>{parseTs(log.timestamp).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                      </span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }} onClick={e => e.stopPropagation()}>
                      <div className="cl-item-dur" style={{ whiteSpace: "nowrap" }}>
                        {log.status === "completed" ? fmtDuration(log.duration) : <span className="cl-item-dur status">{log.status}</span>}
                      </div>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button
                          onClick={() => { setShowCallLogUI(false); startCallFromLog(log, false); }}
                          className="tool-btn"
                          style={{ width: 30, height: 30, fontSize: 12, minHeight: "auto", minWidth: "auto", display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "50%", border: "none" }}
                          title="Voice Call"
                          aria-label="Call Voice"
                        >
                          📞
                        </button>
                        <button
                          onClick={() => { setShowCallLogUI(false); startCallFromLog(log, true); }}
                          className="tool-btn"
                          style={{ width: 30, height: 30, fontSize: 12, minHeight: "auto", minWidth: "auto", display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "50%", border: "none" }}
                          title="Video Call"
                          aria-label="Call Video"
                        >
                          📹
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
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
                  const peerContact = contacts.find(c => c.email === callPeer);
                  return peerContact?.avatar_url ? (
                    <img src={peerContact.avatar_url} alt={callDisplayName} className="img-cover rounded-circle" />
                  ) : (
                    callDisplayName?.[0]?.toUpperCase() || "?"
                  );
                })()}
              </div>
            </div>
            <h1 className="fc-name">{callDisplayName}</h1>
            <p className="fc-status">{isVideoCall ? "Incoming Video Call" : "Incoming Voice Call"}</p>
          </div>

          <div className="apple-call-actions">
            <div className="apple-btn-container">
              <button onClick={rejectCall} className="apple-call-btn apple-btn-decline" aria-label="Decline Call">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M10.68 13.31a16 16 0 0 0 3.41 3.41l2.28-2.28a1 1 0 0 1 .94-.27 11.23 11.23 0 0 0 3.51.56 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A19.93 19.93 0 0 1 3 4a1 1 0 0 1 1-1h3.4a1 1 0 0 1 1 1 11.23 11.23 0 0 0 .56 3.51 1 1 0 0 1-.27.94l-2.28 2.28z" style={{ transform: "rotate(135deg)", transformOrigin: "center" }} />
                </svg>
              </button>
              <span className="apple-btn-label">Decline</span>
            </div>

            <div className="apple-btn-container">
              <button onClick={acceptCall} className="apple-call-btn apple-btn-accept" aria-label="Answer Call">
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
                            {peerContact?.avatar_url ? <img src={peerContact.avatar_url} alt={callDisplayName} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : callDisplayName?.[0]?.toUpperCase() || "?"}
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
                                {peerContact?.avatar_url ? <img src={peerContact.avatar_url} alt={callDisplayName} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : callDisplayName?.[0]?.toUpperCase() || "?"}
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
                            {profile.avatarUrl ? <img src={profile.avatarUrl} alt="you" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : (profile.displayName || profile.username || currentUser)?.[0]?.toUpperCase()}
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
                <div className="fc-avatar-pulse" style={{ borderColor: "rgba(var(--green-rgb), 0.45)" }} />
                <div className="fc-avatar" style={{ width: "100%", height: "100%", fontSize: 64, border: "4px solid rgba(255, 255, 255, 0.2)" }}>
                  {(() => {
                    const peerContact = contacts.find(c => c.email === callPeer);
                    return peerContact?.avatar_url ? (
                      <img src={peerContact.avatar_url} alt={callDisplayName} className="img-cover rounded-circle" />
                    ) : (
                      callDisplayName?.[0]?.toUpperCase() || "?"
                    );
                  })()}
                </div>
              </div>
              <h1 className="fc-name" style={{ fontSize: "2.4rem", marginBottom: 12 }}>{callDisplayName}</h1>
              <p className="fc-status" style={{ color: "var(--green)", letterSpacing: "0.06em", fontWeight: 700 }}>
                {callState === "calling" ? "Calling…" : <>Connected · <CallDurationDisplay callStartTime={callStartTimeRef.current} callState={callState} /></>}
              </p>
              {!isVideoCall && callState === "connected" && (
                <p style={{ fontSize: 13, opacity: 0.65, marginTop: 8 }}>{isSpeaker ? "🔊 Speaker" : "📱 Earpiece"}</p>
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
                📎 Attach File
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
            <div className="viewer-top-bar" onClick={e => e.stopPropagation()}>
              <div className="viewer-file-info">
                <span className="viewer-file-badge">
                  {viewFile.type === "video" ? "📹 Video" : viewFile.type === "avatar-circle" ? "👤 Avatar" : viewFile.type === "pdf" ? "📄 PDF" : "🖼️ Media"}
                </span>
              </div>
              <div className="viewer-controls-group">
                {viewFile.type === "image" && (
                  <>
                    <button
                      className="viewer-tool-btn"
                      onClick={() => setMediaZoom(z => Math.max(1, z - 0.5))}
                      title="Zoom Out"
                      aria-label="Zoom Out"
                    >
                      −
                    </button>
                    <button
                      className="viewer-tool-btn"
                      onClick={() => { setMediaZoom(1); setMediaPan({ x: 0, y: 0 }); }}
                      title="Reset Zoom"
                      aria-label="Reset Zoom"
                    >
                      {Math.round(mediaZoom * 100)}%
                    </button>
                    <button
                      className="viewer-tool-btn"
                      onClick={() => setMediaZoom(z => Math.min(4, z + 0.5))}
                      title="Zoom In"
                      aria-label="Zoom In"
                    >
                      +
                    </button>
                  </>
                )}
                {viewFile.type !== "avatar-circle" && (
                  <button
                    className="viewer-tool-btn viewer-dl-btn"
                    onClick={() => handleDownloadMedia(viewFile.url)}
                    title="Download Media"
                    aria-label="Download Media"
                  >
                    ⬇ Download
                  </button>
                )}
                <button
                  className="close-viewer"
                  onClick={() => { setViewFile(null); setMediaZoom(1); setMediaPan({ x: 0, y: 0 }); }}
                  aria-label="Close media viewer"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Media Content */}
            <div
              className="viewer-content"
              onClick={e => e.stopPropagation()}
              onDoubleClick={() => {
                if (viewFile.type === "image") {
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
                <img src={viewFile.url} alt="attachment" style={{ pointerEvents: "none", userSelect: "none" }} />
              )}
              {viewFile.type === "video" && (
                <video src={viewFile.url} controls autoPlay playsInline style={{ maxHeight: "85vh", maxWidth: "92vw" }} />
              )}
              {viewFile.type === "avatar-circle" && (
                <img src={viewFile.url} alt="Avatar" style={{ pointerEvents: "none", maxWidth: "85vw", maxHeight: "85vh", objectFit: "contain", borderRadius: "var(--r-xl)" }} />
              )}
            </div>
          </div>
        )
      }

      {/* ── FORWARD PICKER ────────────────────────────────────────────────────── */}
      {
        showForwardPicker && forwardingMsgs.length > 0 && (
          <div className="file-viewer-overlay" style={{ zIndex: 10001 }} onClick={() => { setShowForwardPicker(false); setForwardSelectedTargets([]); setForwardingMsgs([]); }}>
            <div className="viewer-content cl-modal" style={{ maxHeight: "75vh", display: "flex", flexDirection: "column", padding: 0 }} onClick={e => e.stopPropagation()}>
              <div className="cl-header" style={{ flexShrink: 0 }}>
                <h2 className="cl-title">Forward to…</h2>
                <button className="cl-close" onClick={() => { setShowForwardPicker(false); setForwardSelectedTargets([]); setForwardingMsgs([]); }}>✕</button>
              </div>
              <div style={{ padding: "10px 16px", background: "var(--surface-2)", borderBottom: "1px solid var(--border)", fontSize: 12, color: "var(--text-3)", display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                <span>↗</span>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {forwardingMsgs.length === 1 ? (forwardingMsgs[0].content.startsWith("[") ? "📎 Attachment" : forwardingMsgs[0].content) : `Forwarding ${forwardingMsgs.length} messages`}
                </span>
              </div>
              <div style={{ flex: 1, overflowY: "auto" }}>
                {sortedChats.length > 0 && (
                  <>
                    <div style={{ padding: "8px 16px 4px", fontSize: 11, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Chats</div>
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
                              {c.avatar_url ? <img src={c.avatar_url} className="img-cover rounded-circle" alt="av" /> : contactLabel(c)[0]?.toUpperCase() || "?"}
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
                              {g.avatar_url ? <img src={g.avatar_url} className="img-cover rounded-circle" alt="av" /> : g.name[0]?.toUpperCase() || "?"}
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

      <Toast />
    </div>
    </ErrorBoundary>
  );
}
