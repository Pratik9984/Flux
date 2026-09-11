import { create } from "zustand";
import type { AuthState, AuthStep } from "@/types";

export interface AuthStoreState {
  token: string;
  currentUser: string;
  profile: { displayName: string; avatarUrl: string; username: string; about?: string };
  auth: AuthState;
  isMounted: boolean;

  setToken: (token: string) => void;
  setCurrentUser: (user: string) => void;
  setProfile: (profile: { displayName: string; avatarUrl: string; username: string; about?: string }) => void;
  updateProfile: (partial: Partial<{ displayName: string; avatarUrl: string; username: string; about?: string }>) => void;
  setAuthField: (field: keyof AuthState, value: any) => void;
  setAuthStep: (step: AuthStep) => void;
  setAuthLoading: (loading: boolean) => void;
  setAuthError: (error: string) => void;
  resetAuth: () => void;
  setIsMounted: (v: boolean) => void;
  logout: () => void;
}

const authInit: AuthState = {
  step: "signin",
  email: "",
  pass: "",
  pass2: "",
  user: "",
  loading: false,
  error: "",
};

export const useAuthStore = create<AuthStoreState>((set) => ({
  token: typeof window !== "undefined" ? localStorage.getItem("flux_backend_token") || "" : "",
  currentUser: typeof window !== "undefined" ? localStorage.getItem("chat_user") || "" : "",
  profile: typeof window !== "undefined" && localStorage.getItem("flux_cached_profile")
    ? JSON.parse(localStorage.getItem("flux_cached_profile") || "{}")
    : { displayName: "", avatarUrl: "", username: "", about: "" },
  auth: authInit,
  isMounted: false,

  setToken: (token) => {
    if (typeof window !== "undefined") {
      if (token) {
        localStorage.setItem("flux_backend_token", token);
        try { (window as any).FluxNativeBridge?.syncAuthToken(token); } catch {}
      } else {
        localStorage.removeItem("flux_backend_token");
      }
    }
    set({ token });
  },
  setCurrentUser: (user) => {
    if (typeof window !== "undefined") {
      if (user) localStorage.setItem("chat_user", user);
      else localStorage.removeItem("chat_user");
    }
    set({ currentUser: user });
  },
  setProfile: (profile) => {
    if (typeof window !== "undefined") {
      try { localStorage.setItem("flux_cached_profile", JSON.stringify(profile)); } catch { }
    }
    set({ profile });
  },
  updateProfile: (partial) =>
    set((s) => {
      const next = { ...s.profile, ...partial };
      if (typeof window !== "undefined") {
        try { localStorage.setItem("flux_cached_profile", JSON.stringify(next)); } catch { }
      }
      return { profile: next };
    }),
  setAuthField: (field, value) =>
    set((s) => ({ auth: { ...s.auth, [field]: value } })),
  setAuthStep: (step) =>
    set((s) => ({ auth: { ...s.auth, step, error: "" } })),
  setAuthLoading: (loading) =>
    set((s) => ({ auth: { ...s.auth, loading } })),
  setAuthError: (error) =>
    set((s) => ({ auth: { ...s.auth, error, loading: false } })),
  resetAuth: () => set({ auth: authInit }),
  setIsMounted: (v) => set({ isMounted: v }),
  logout: () => {
    if (typeof window !== "undefined") {
      localStorage.removeItem("flux_backend_token");
      localStorage.removeItem("chat_user");
      ["cached_contacts", "cached_groups", "cached_unread", "cached_call_logs", "cached_chat_drafts"].forEach((k) =>
        localStorage.removeItem(k)
      );
      try {
        sessionStorage.removeItem("Flux_seen_ids");
        sessionStorage.removeItem("_Flux_call_offer");
      } catch { /* ignore */ }
    }
    set({
      token: "",
      currentUser: "",
      profile: { displayName: "", avatarUrl: "", username: "" },
      auth: authInit,
    });
  },
}));
