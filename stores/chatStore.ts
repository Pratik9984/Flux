import { create } from "zustand";
import type { Chat, Message } from "@/types";
import { safeParseJSON } from "@/lib/utils";

export interface ChatStoreState {
  activeChat: Chat | null;
  messages: Message[];
  inputMsg: string;
  unread: Record<string, number>;
  lastActivity: Record<string, number>;
  lastPreview: Record<string, string>;
  hasMore: boolean;
  loadingMore: boolean;
  isLoadingHistory: boolean;
  failedMsgIds: Set<string>;
  deletedMsgIds: Set<string>;
  deletedForMeIds: Set<string>;
  pinnedMessages: Record<string, Message[]>;
  typingSet: Set<string>;
  replyingTo: Message | null;
  editingId: string | number | null;
  editingText: string;
  highlightedMsgId: string | number | null;
  isScrollAnchored: boolean;

  setActiveChat: (chat: Chat | null) => void;
  setMessages: (messages: Message[] | ((prev: Message[]) => Message[])) => void;
  setInputMsg: (inputMsg: string | ((prev: string) => string)) => void;
  setUnread: (unread: Record<string, number> | ((prev: Record<string, number>) => Record<string, number>)) => void;
  updateUnreadCount: (chatId: string, count: number | ((prev: number) => number)) => void;
  setLastActivity: (lastActivity: Record<string, number> | ((prev: Record<string, number>) => Record<string, number>)) => void;
  updateActivityTime: (chatId: string, timestamp: number) => void;
  setLastPreview: (lastPreview: Record<string, string> | ((prev: Record<string, string>) => Record<string, string>)) => void;
  updateLastPreviewMsg: (chatId: string, content: string) => void;
  setHasMore: (hasMore: boolean) => void;
  setLoadingMore: (loadingMore: boolean) => void;
  setIsLoadingHistory: (v: boolean) => void;
  setFailedMsgIds: (failedMsgIds: Set<string> | ((prev: Set<string>) => Set<string>)) => void;
  addFailedMsgId: (id: string) => void;
  removeFailedMsgId: (id: string) => void;
  setDeletedMsgIds: (deletedMsgIds: Set<string>) => void;
  setDeletedForMeIds: (deletedForMeIds: Set<string> | ((prev: Set<string>) => Set<string>)) => void;
  setPinnedMessages: (pinnedMessages: Record<string, Message[]> | ((prev: Record<string, Message[]>) => Record<string, Message[]>)) => void;
  pinMessage: (chatId: string, msg: Message) => void;
  unpinMessage: (chatId: string, msgId: string | number) => void;
  setTypingSet: (ts: Set<string> | ((prev: Set<string>) => Set<string>)) => void;
  setReplyingTo: (msg: Message | null) => void;
  setEditingId: (id: string | number | null) => void;
  setEditingText: (text: string) => void;
  setHighlightedMsgId: (id: string | number | null) => void;
  setIsScrollAnchored: (v: boolean) => void;
}

export const useChatStore = create<ChatStoreState>((set) => ({
  activeChat:
    typeof window !== "undefined"
      ? safeParseJSON<Chat | null>(localStorage.getItem("cached_active_chat"), null)
      : null,
  messages: [],
  inputMsg: "",
  unread:
    typeof window !== "undefined"
      ? safeParseJSON<Record<string, number>>(localStorage.getItem("cached_unread"), {})
      : {},
  lastActivity: {},
  lastPreview: {},
  hasMore: false,
  loadingMore: false,
  isLoadingHistory: false,
  failedMsgIds: new Set(),
  deletedMsgIds: new Set(),
  deletedForMeIds: new Set(),
  pinnedMessages: {},
  typingSet: new Set(),
  replyingTo: null,
  editingId: null,
  editingText: "",
  highlightedMsgId: null,
  isScrollAnchored: true,

  setActiveChat: (activeChat) => {
    if (typeof window !== "undefined") {
      if (activeChat) localStorage.setItem("cached_active_chat", JSON.stringify(activeChat));
      else localStorage.removeItem("cached_active_chat");
    }
    set({ activeChat });
  },
  setMessages: (messages) =>
    set((s) => ({
      messages: typeof messages === "function" ? messages(s.messages) : messages,
    })),
  setInputMsg: (inputMsg) =>
    set((s) => ({
      inputMsg: typeof inputMsg === "function" ? inputMsg(s.inputMsg) : inputMsg,
    })),
  setUnread: (unread) =>
    set((s) => {
      const next = typeof unread === "function" ? unread(s.unread) : unread;
      if (typeof window !== "undefined") localStorage.setItem("cached_unread", JSON.stringify(next));
      return { unread: next };
    }),
  updateUnreadCount: (chatId, count) =>
    set((s) => {
      const prevCount = s.unread[chatId] || 0;
      const nextCount = typeof count === "function" ? count(prevCount) : count;
      const nextUnread = { ...s.unread, [chatId]: nextCount };
      if (typeof window !== "undefined") localStorage.setItem("cached_unread", JSON.stringify(nextUnread));
      return { unread: nextUnread };
    }),
  setLastActivity: (lastActivity) =>
    set((s) => ({
      lastActivity: typeof lastActivity === "function" ? lastActivity(s.lastActivity) : lastActivity,
    })),
  updateActivityTime: (chatId, timestamp) =>
    set((s) => ({
      lastActivity: { ...s.lastActivity, [chatId]: timestamp },
    })),
  setLastPreview: (lastPreview) =>
    set((s) => ({
      lastPreview: typeof lastPreview === "function" ? lastPreview(s.lastPreview) : lastPreview,
    })),
  updateLastPreviewMsg: (chatId, content) =>
    set((s) => ({
      lastPreview: { ...s.lastPreview, [chatId]: content },
    })),
  setHasMore: (hasMore) => set({ hasMore }),
  setLoadingMore: (loadingMore) => set({ loadingMore }),
  setIsLoadingHistory: (v) => set({ isLoadingHistory: v }),
  setFailedMsgIds: (failedMsgIds) =>
    set((s) => ({
      failedMsgIds: typeof failedMsgIds === "function" ? failedMsgIds(s.failedMsgIds) : failedMsgIds,
    })),
  addFailedMsgId: (id) =>
    set((s) => {
      const next = new Set(s.failedMsgIds);
      next.add(id);
      return { failedMsgIds: next };
    }),
  removeFailedMsgId: (id) =>
    set((s) => {
      const next = new Set(s.failedMsgIds);
      next.delete(id);
      return { failedMsgIds: next };
    }),
  setDeletedMsgIds: (deletedMsgIds) => set({ deletedMsgIds }),
  setDeletedForMeIds: (deletedForMeIds) =>
    set((s) => ({
      deletedForMeIds: typeof deletedForMeIds === "function" ? deletedForMeIds(s.deletedForMeIds) : deletedForMeIds,
    })),
  setPinnedMessages: (pinnedMessages) =>
    set((s) => ({
      pinnedMessages: typeof pinnedMessages === "function" ? pinnedMessages(s.pinnedMessages) : pinnedMessages,
    })),
  pinMessage: (chatId, msg) =>
    set((s) => {
      const chatPins = s.pinnedMessages[chatId] || [];
      if (chatPins.some((p) => String(p.id) === String(msg.id))) return {};
      return { pinnedMessages: { ...s.pinnedMessages, [chatId]: [...chatPins, msg] } };
    }),
  unpinMessage: (chatId, msgId) =>
    set((s) => {
      const chatPins = s.pinnedMessages[chatId] || [];
      return {
        pinnedMessages: {
          ...s.pinnedMessages,
          [chatId]: chatPins.filter((p) => String(p.id) !== String(msgId)),
        },
      };
    }),
  setTypingSet: (ts) =>
    set((s) => ({ typingSet: typeof ts === "function" ? ts(s.typingSet) : ts })),
  setReplyingTo: (msg) => set({ replyingTo: msg }),
  setEditingId: (id) => set({ editingId: id }),
  setEditingText: (text) => set({ editingText: text }),
  setHighlightedMsgId: (id) => set({ highlightedMsgId: id }),
  setIsScrollAnchored: (v) => set({ isScrollAnchored: v }),
}));
