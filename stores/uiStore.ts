import { create } from "zustand";
import type { Message, WsStatus } from "@/types";

export interface UiState {
  toast: { message: string; type: "success" | "error" | "info" } | null;
  confirmDialog: { message: string; onConfirm: () => void; onCancel?: () => void } | null;
  deleteConfirm: { selectedMsgs: Message[]; onConfirm: (forEveryone: boolean) => Promise<void> } | null;
  showProfile: boolean;
  showMyProfileSettings: boolean;
  showContactProfile: boolean;
  showGroupProfile: boolean;
  showCallLogUI: boolean;
  showEmojiPanel: boolean;
  showEmojis: boolean;
  showStickers: boolean;
  emojiPanelTab: "emojis" | "stickers";
  viewFile: { url: string; type: string } | null;
  searchQuery: string;
  wsStatus: WsStatus;
  showNewContact: boolean;
  showNewGroup: boolean;
  showForwardPicker: boolean;
  showHeaderNicknameEdit: boolean;
  showPlusDrawer: boolean;
  showCameraDrawer: boolean;
  showRingtonePicker: boolean;
  showMuteMenu: boolean;
  openedProfileFromSidebar: boolean;
  selectedMsgId: string | number | null;
  selectedMsgIds: Set<string | number>;
  sidebarDeleteId: string | null;
  reactionPickerId: string | number | null;

  showToast: (message: string, type?: "success" | "error" | "info") => void;
  hideToast: () => void;
  showConfirm: (message: string, onConfirm: () => void, onCancel?: () => void) => void;
  hideConfirm: () => void;
  setDeleteConfirm: (v: UiState["deleteConfirm"]) => void;
  setShowProfile: (val: boolean) => void;
  setShowMyProfileSettings: (val: boolean | ((prev: boolean) => boolean)) => void;
  setShowContactProfile: (val: boolean) => void;
  setShowGroupProfile: (val: boolean) => void;
  setShowCallLogUI: (val: boolean) => void;
  setShowEmojiPanel: (val: boolean | ((prev: boolean) => boolean)) => void;
  setShowEmojis: (val: boolean) => void;
  setShowStickers: (val: boolean) => void;
  setEmojiPanelTab: (tab: "emojis" | "stickers") => void;
  setViewFile: (file: { url: string; type: string } | null) => void;
  setSearchQuery: (query: string) => void;
  setWsStatus: (status: WsStatus) => void;
  setShowNewContact: (val: boolean) => void;
  setShowNewGroup: (val: boolean) => void;
  setShowForwardPicker: (val: boolean) => void;
  setShowHeaderNicknameEdit: (val: boolean) => void;
  setShowPlusDrawer: (val: boolean) => void;
  setShowCameraDrawer: (val: boolean) => void;
  setShowRingtonePicker: (val: boolean) => void;
  setShowMuteMenu: (val: boolean) => void;
  setOpenedProfileFromSidebar: (val: boolean) => void;
  setSelectedMsgId: (id: string | number | null) => void;
  setSelectedMsgIds: (ids: Set<string | number> | ((prev: Set<string | number>) => Set<string | number>)) => void;
  setSidebarDeleteId: (id: string | null) => void;
  setReactionPickerId: (id: string | number | null) => void;
}

let toastTimeout: ReturnType<typeof setTimeout> | null = null;

export const useUiStore = create<UiState>((set) => ({
  toast: null,
  confirmDialog: null,
  deleteConfirm: null,
  showProfile: false,
  showMyProfileSettings: false,
  showContactProfile: false,
  showGroupProfile: false,
  showCallLogUI: false,
  showEmojiPanel: false,
  showEmojis: false,
  showStickers: false,
  emojiPanelTab: "emojis",
  viewFile: null,
  searchQuery: "",
  wsStatus: "disconnected",
  showNewContact: false,
  showNewGroup: false,
  showForwardPicker: false,
  showHeaderNicknameEdit: false,
  showPlusDrawer: false,
  showCameraDrawer: false,
  showRingtonePicker: false,
  showMuteMenu: false,
  openedProfileFromSidebar: false,
  selectedMsgId: null,
  selectedMsgIds: new Set(),
  sidebarDeleteId: null,
  reactionPickerId: null,

  showToast: (message, type = "info") => {
    if (toastTimeout) clearTimeout(toastTimeout);
    set({ toast: { message, type } });
    toastTimeout = setTimeout(() => {
      set({ toast: null });
      toastTimeout = null;
    }, 3000);
  },
  hideToast: () => {
    if (toastTimeout) { clearTimeout(toastTimeout); toastTimeout = null; }
    set({ toast: null });
  },
  showConfirm: (message, onConfirm, onCancel) =>
    set({ confirmDialog: { message, onConfirm, onCancel } }),
  hideConfirm: () => set({ confirmDialog: null }),
  setDeleteConfirm: (v) => set({ deleteConfirm: v }),
  setShowProfile: (val) => set({ showProfile: val }),
  setShowMyProfileSettings: (val) =>
    set((s) => ({
      showMyProfileSettings: typeof val === "function" ? val(s.showMyProfileSettings) : val,
    })),
  setShowContactProfile: (val) => set({ showContactProfile: val }),
  setShowGroupProfile: (val) => set({ showGroupProfile: val }),
  setShowCallLogUI: (val) => set({ showCallLogUI: val }),
  setShowEmojiPanel: (val) =>
    set((s) => ({
      showEmojiPanel: typeof val === "function" ? val(s.showEmojiPanel) : val,
    })),
  setShowEmojis: (val) => set({ showEmojis: val }),
  setShowStickers: (val) => set({ showStickers: val }),
  setEmojiPanelTab: (tab) => set({ emojiPanelTab: tab }),
  setViewFile: (file) => set({ viewFile: file }),
  setSearchQuery: (query) => set({ searchQuery: query }),
  setWsStatus: (status) => set({ wsStatus: status }),
  setShowNewContact: (val) => set({ showNewContact: val }),
  setShowNewGroup: (val) => set({ showNewGroup: val }),
  setShowForwardPicker: (val) => set({ showForwardPicker: val }),
  setShowHeaderNicknameEdit: (val) => set({ showHeaderNicknameEdit: val }),
  setShowPlusDrawer: (val) => set({ showPlusDrawer: val }),
  setShowCameraDrawer: (val) => set({ showCameraDrawer: val }),
  setShowRingtonePicker: (val) => set({ showRingtonePicker: val }),
  setShowMuteMenu: (val) => set({ showMuteMenu: val }),
  setOpenedProfileFromSidebar: (val) => set({ openedProfileFromSidebar: val }),
  setSelectedMsgId: (id) => set({ selectedMsgId: id }),
  setSelectedMsgIds: (ids) =>
    set((s) => ({
      selectedMsgIds: typeof ids === "function" ? ids(s.selectedMsgIds) : ids,
    })),
  setSidebarDeleteId: (id) => set({ sidebarDeleteId: id }),
  setReactionPickerId: (id) => set({ reactionPickerId: id }),
}));
