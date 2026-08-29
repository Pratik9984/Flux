import { create } from "zustand";
import type { Contact, Group } from "@/types";
import { safeParseJSON } from "@/lib/utils";

export interface ContactStoreState {
  contacts: Contact[];
  groups: Group[];
  nicknames: Record<string, string>;
  blockedUsers: Set<string>;
  mutedChats: Record<string, number | null>;

  setContacts: (contacts: Contact[]) => void;
  setGroups: (groups: Group[]) => void;
  setNicknames: (nicknames: Record<string, string>) => void;
  setBlockedUsers: (users: Set<string>) => void;
  setMutedChats: (chats: Record<string, number | null>) => void;
  addBlockedUser: (email: string) => void;
  removeBlockedUser: (email: string) => void;
  muteChat: (chatId: string, until: number | null) => void;
  unmuteChat: (chatId: string) => void;
}

export const useContactStore = create<ContactStoreState>((set) => ({
  contacts: typeof window !== "undefined"
    ? safeParseJSON<Contact[]>(localStorage.getItem("cached_contacts"), []).map(c => ({ ...c, email: (c.email || "").toLowerCase() }))
    : [],
  groups: typeof window !== "undefined"
    ? safeParseJSON<Group[]>(localStorage.getItem("cached_groups"), [])
    : [],
  nicknames: typeof window !== "undefined"
    ? safeParseJSON<Record<string, string>>(localStorage.getItem("cached_nicknames"), {})
    : {},
  blockedUsers: new Set(),
  mutedChats: {},

  setContacts: (contacts) => {
    if (typeof window !== "undefined") {
      localStorage.setItem("cached_contacts", JSON.stringify(contacts));
    }
    set({ contacts });
  },
  setGroups: (groups) => {
    if (typeof window !== "undefined") {
      localStorage.setItem("cached_groups", JSON.stringify(groups));
    }
    set({ groups });
  },
  setNicknames: (nicknames) => {
    if (typeof window !== "undefined") {
      localStorage.setItem("cached_nicknames", JSON.stringify(nicknames));
    }
    set({ nicknames });
  },
  setBlockedUsers: (blockedUsers) => set({ blockedUsers }),
  setMutedChats: (mutedChats) => set({ mutedChats }),
  addBlockedUser: (email) => set((state) => {
    const next = new Set(state.blockedUsers);
    next.add(email);
    return { blockedUsers: next };
  }),
  removeBlockedUser: (email) => set((state) => {
    const next = new Set(state.blockedUsers);
    next.delete(email);
    return { blockedUsers: next };
  }),
  muteChat: (chatId, until) => set((state) => ({
    mutedChats: { ...state.mutedChats, [chatId]: until }
  })),
  unmuteChat: (chatId) => set((state) => {
    const next = { ...state.mutedChats };
    delete next[chatId];
    return { mutedChats: next };
  }),
}));
