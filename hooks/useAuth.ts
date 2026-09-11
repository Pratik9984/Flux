import { useCallback, useReducer, useRef } from "react";
import { useAuthStore } from "@/stores/authStore";
import { useUiStore } from "@/stores/uiStore";
import { useApiFetch } from "@/hooks/useApiFetch";
import type { CryptoHook } from "@/hooks/useCrypto";
import type { AuthState, AuthAction, Contact } from "@/types";
import { USERNAME_RE, errorMessage } from "@/lib/utils";
import { API } from "@/lib/api";
import { createClient } from "@supabase/supabase-js";
import { requestNotificationPermission as requestFCMPermission } from "@/lib/firebase";
import { requestNotifyPermission } from "@/lib/notifications";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "",
  {
    auth: {
      persistSession: false,
    },
  }
);

function authReducer(s: AuthState, a: AuthAction): AuthState {
  switch (a.type) {
    case "SET_STEP": return { ...s, step: a.step, error: "" };
    case "SET_FIELD": return { ...s, [a.field]: a.value };
    case "SET_LOADING": return { ...s, loading: a.value };
    case "SET_ERROR": return { ...s, error: a.value, loading: false };
    case "RESET": return { step: "signin", email: "", pass: "", pass2: "", user: "", loading: false, error: "" };
    default: return s;
  }
}

/**
 * Auth hook. Manages sign-in, sign-up, registration, forgot-password,
 * and token finalization flows. Writes to authStore.
 */
export function useAuth(crypto: CryptoHook) {
  const apiFetch = useApiFetch();
  const showToast = useUiStore((s) => s.showToast);
  const { setToken, setCurrentUser, setProfile } = useAuthStore();
  const storeLogout = useAuthStore((s) => s.logout);

  const [auth, dispatchAuth] = useReducer(authReducer, {
    step: "welcome" as const,
    email: "", pass: "", pass2: "", user: "", loading: false, error: "",
  });

  const pendingSupabaseToken = useRef("");

  const _registerFCMToken = useCallback(async (authToken: string) => {
    try {
      const fcmToken = await requestFCMPermission();
      if (fcmToken) {
        await fetch(`${API}/profile/fcm-token`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
          body: JSON.stringify({ fcm_token: fcmToken }),
        });
      }
    } catch { /* FCM optional */ }
  }, []);

  const _finalizeAuth = useCallback(async (backendToken: string, email: string, userObj?: any) => {
    const lowerEmail = email.toLowerCase();
    setToken(backendToken);
    setCurrentUser(lowerEmail);
    if (userObj) {
      const uname = userObj.username || lowerEmail.split("@")[0];
      setProfile({
        displayName: userObj.display_name || "",
        avatarUrl: userObj.avatar_url || "",
        username: uname,
      });
    }
    pendingSupabaseToken.current = "";
    
    requestNotifyPermission();
    _registerFCMToken(backendToken);

    // Init E2E keys
    await crypto.initializeKeys(lowerEmail);
  }, [setToken, setCurrentUser, setProfile, crypto, _registerFCMToken]);

  const handleSignIn = useCallback(async () => {
    dispatchAuth({ type: "SET_ERROR", value: "" });
    if (!auth.email.trim() || !auth.pass) {
      return dispatchAuth({ type: "SET_ERROR", value: "Please fill in all fields" });
    }
    dispatchAuth({ type: "SET_LOADING", value: true });
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: auth.email.trim(), password: auth.pass,
      });
      if (error) throw error;
      const idToken = data.session?.access_token;
      if (!idToken) throw new Error("No session token");
      const res = await apiFetch<{ access_token: string; user: any }>("/auth/login", {
        method: "POST", body: JSON.stringify({ id_token: idToken }),
      });
      await _finalizeAuth(res.access_token, res.user?.email || auth.email.trim(), res.user);
      dispatchAuth({ type: "RESET" });
    } catch (e: any) {
      if (e.message?.includes("Account not found")) {
        const { data } = await supabase.auth.getSession();
        pendingSupabaseToken.current = data.session?.access_token || "";
        dispatchAuth({ type: "SET_STEP", step: "pick-username" });
      } else {
        dispatchAuth({ type: "SET_ERROR", value: errorMessage(e) });
      }
    } finally {
      dispatchAuth({ type: "SET_LOADING", value: false });
    }
  }, [auth.email, auth.pass, apiFetch, _finalizeAuth]);

  const handleSignUp = useCallback(async () => {
    if (!auth.email.trim() || !auth.pass || !auth.pass2) {
      return dispatchAuth({ type: "SET_ERROR", value: "Please fill in all fields" });
    }
    if (auth.pass !== auth.pass2) {
      return dispatchAuth({ type: "SET_ERROR", value: "Passwords don't match" });
    }
    if (auth.pass.length < 6) {
      return dispatchAuth({ type: "SET_ERROR", value: "Password must be at least 6 characters" });
    }
    dispatchAuth({ type: "SET_LOADING", value: true });
    try {
      const { data, error } = await supabase.auth.signUp({
        email: auth.email.trim(), password: auth.pass,
      });
      if (error) throw error;
      const t = data.session?.access_token;
      if (!t) {
        dispatchAuth({ type: "SET_STEP", step: "verify-email" });
        return;
      }
      pendingSupabaseToken.current = t;
      dispatchAuth({ type: "SET_STEP", step: "pick-username" });
    } catch (e: any) {
      dispatchAuth({ type: "SET_ERROR", value: errorMessage(e) });
    } finally {
      dispatchAuth({ type: "SET_LOADING", value: false });
    }
  }, [auth.email, auth.pass, auth.pass2]);

  const handleRegister = useCallback(async () => {
    const username = auth.user.trim().toLowerCase();
    if (!USERNAME_RE.test(username)) {
      return dispatchAuth({ type: "SET_ERROR", value: "Username must be 3–30 chars: lowercase letters, numbers, underscores only" });
    }
    dispatchAuth({ type: "SET_LOADING", value: true });
    try {
      if (!pendingSupabaseToken.current) {
        const { data } = await supabase.auth.getSession();
        pendingSupabaseToken.current = data.session?.access_token || "";
        if (!pendingSupabaseToken.current) {
          dispatchAuth({ type: "SET_ERROR", value: "Session expired" });
          dispatchAuth({ type: "SET_STEP", step: "signin" });
          return;
        }
      }
      const res = await apiFetch<{ access_token: string; user: any }>("/auth/register", {
        method: "POST",
        body: JSON.stringify({
          id_token: pendingSupabaseToken.current,
          username,
          display_name: auth.user.trim(),
        }),
      });
      await _finalizeAuth(res.access_token, res.user?.email || auth.email.trim(), res.user);
      dispatchAuth({ type: "RESET" });
    } catch (e: any) {
      dispatchAuth({ type: "SET_ERROR", value: errorMessage(e) });
    } finally {
      dispatchAuth({ type: "SET_LOADING", value: false });
    }
  }, [auth.user, auth.email, apiFetch, _finalizeAuth]);

  const handleForgotPassword = useCallback(async () => {
    if (!auth.email.trim()) return dispatchAuth({ type: "SET_ERROR", value: "Enter your email first" });
    dispatchAuth({ type: "SET_LOADING", value: true });
    try {
      const redirectTo = typeof window !== "undefined" ? window.location.origin : "http://localhost:3000";
      const { error } = await supabase.auth.resetPasswordForEmail(auth.email.trim(), { redirectTo });
      if (error) throw error;
      dispatchAuth({ type: "SET_STEP", step: "verify-email" });
    } catch (e: any) {
      dispatchAuth({ type: "SET_ERROR", value: errorMessage(e) });
    } finally {
      dispatchAuth({ type: "SET_LOADING", value: false });
    }
  }, [auth.email]);

  const handleResetPassword = useCallback(async () => {
    if (!auth.pass || auth.pass !== auth.pass2) {
      return dispatchAuth({ type: "SET_ERROR", value: "Passwords don't match" });
    }
    if (auth.pass.length < 6) {
      return dispatchAuth({ type: "SET_ERROR", value: "Password must be at least 6 characters" });
    }
    dispatchAuth({ type: "SET_LOADING", value: true });
    try {
      const { error } = await supabase.auth.updateUser({ password: auth.pass });
      if (error) throw error;
      dispatchAuth({ type: "RESET" });
      showToast("Password updated! Sign in with your new password.", "success");
    } catch (e: any) {
      dispatchAuth({ type: "SET_ERROR", value: errorMessage(e) });
    } finally {
      dispatchAuth({ type: "SET_LOADING", value: false });
    }
  }, [auth.pass, auth.pass2, showToast]);

  const logout = useCallback(async () => {
    try {
      await supabase.auth.signOut();
    } catch { /* ignore */ }
    storeLogout();
    pendingSupabaseToken.current = "";
  }, [storeLogout]);

  const loadProfile = useCallback(async () => {
    try {
      const data = await apiFetch<Contact>("/profile/me");
      setProfile({
        displayName: data.display_name || "",
        avatarUrl: data.avatar_url || "",
        username: data.username || "",
      });
    } catch { /* ignore */ }
  }, [apiFetch, setProfile]);

  return {
    auth,
    dispatchAuth,
    supabase,
    handleSignIn,
    handleSignUp,
    handleRegister,
    handleForgotPassword,
    handleResetPassword,
    logout,
    loadProfile,
    _finalizeAuth,
    _registerFCMToken,
  };
}

export type AuthHook = ReturnType<typeof useAuth>;
