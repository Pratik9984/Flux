import { create } from "zustand";
import type { Contact, Group, ContactRequest, SuggestedContact } from "@/types";
import { safeParseJSON } from "@/lib/utils";

export interface ContactStoreState {
  contacts: Contact[];
  groups: Group[];
  nicknames: Record<string, string>;
  blockedUsers: Set<string>;
  mutedChats: Record<string, number | null>;
  incomingRequests: ContactRequest[];
  outgoingRequests: ContactRequest[];
  suggestions: SuggestedContact[];

  setContacts: (contacts: Contact[]) => void;
  setGroups: (groups: Group[]) => void;
  setNicknames: (nicknames: Record<string, string>) => void;
  setBlockedUsers: (users: Set<string>) => void;
  setMutedChats: (chats: Record<string, number | null>) => void;
  setIncomingRequests: (requests: ContactRequest[]) => void;
  setOutgoingRequests: (requests: ContactRequest[]) => void;
  setSuggestions: (suggestions: SuggestedContact[]) => void;

  addIncomingRequest: (req: ContactRequest) => void;
  addOutgoingRequest: (req: ContactRequest) => void;
  removeIncomingRequest: (requestId: number) => void;
  removeOutgoingRequest: (requestId: number) => void;

  addContact: (contact: Contact) => void;
  removeContact: (email: string) => void;
  toggleFavorite: (email: string) => void;

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
  incomingRequests: [],
  outgoingRequests: [],
  suggestions: [],

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
  setIncomingRequests: (incomingRequests) => set({ incomingRequests }),
  setOutgoingRequests: (outgoingRequests) => set({ outgoingRequests }),
  setSuggestions: (suggestions) => set({ suggestions }),

  addIncomingRequest: (req) => set((state) => {
    const filtered = state.incomingRequests.filter((r) => r.id !== req.id);
    return { incomingRequests: [req, ...filtered] };
  }),

  addOutgoingRequest: (req) => set((state) => {
    const filtered = state.outgoingRequests.filter((r) => r.id !== req.id);
    return { outgoingRequests: [req, ...filtered] };
  }),

  removeIncomingRequest: (requestId) => set((state) => ({
    incomingRequests: state.incomingRequests.filter((r) => r.id !== requestId),
  })),

  removeOutgoingRequest: (requestId) => set((state) => ({
    outgoingRequests: state.outgoingRequests.filter((r) => r.id !== requestId),
  })),

  addContact: (contact) => set((state) => {
    const cleanEmail = contact.email.toLowerCase();
    const existing = state.contacts.filter((c) => c.email.toLowerCase() !== cleanEmail);
    const updated = [contact, ...existing];
    if (typeof window !== "undefined") {
      localStorage.setItem("cached_contacts", JSON.stringify(updated));
    }
    return { contacts: updated };
  }),

  removeContact: (email) => set((state) => {
    const clean = email.toLowerCase();
    const updated = state.contacts.filter((c) => c.email.toLowerCase() !== clean);
    if (typeof window !== "undefined") {
      localStorage.setItem("cached_contacts", JSON.stringify(updated));
    }
    return { contacts: updated };
  }),

  toggleFavorite: (email) => set((state) => {
    const clean = email.toLowerCase();
    const updated = state.contacts.map((c) =>
      c.email.toLowerCase() === clean ? { ...c, is_favorite: !c.is_favorite } : c
    );
    if (typeof window !== "undefined") {
      localStorage.setItem("cached_contacts", JSON.stringify(updated));
    }
    return { contacts: updated };
  }),

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
    mutedChats: { ...state.mutedChats, [chatId]: until },
  })),
  unmuteChat: (chatId) => set((state) => {
    const next = { ...state.mutedChats };
    delete next[chatId];
    return { mutedChats: next };
  }),
}));
