import { useCallback, useRef } from "react";
import { useAuthStore } from "@/stores/authStore";
import { useUiStore } from "@/stores/uiStore";
import { API } from "@/lib/api";
import type { ApiOptions } from "@/types";

/**
 * Authenticated API fetch wrapper.
 * Reads the token from authStore and provides a typed fetch helper.
 */
export function useApiFetch() {
  const tokenRef = useRef("");

  // Keep tokenRef always current without triggering re-renders
  tokenRef.current = useAuthStore.getState().token;
  // Also subscribe so it updates if token changes
  useAuthStore.subscribe((s) => { tokenRef.current = s.token; });

  const apiFetch = useCallback(async <T = any>(
    path: string,
    options: ApiOptions = {}
  ): Promise<T> => {
    const token = tokenRef.current;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...((options.headers as Record<string, string>) || {}),
    };
    const res = await fetch(`${API}${path}`, {
      ...options,
      headers,
    });
    if (!res.ok) {
      let detail = res.statusText;
      try {
        const body = await res.json();
        detail = body.detail || body.message || detail;
      } catch { /* ignore */ }
      throw new Error(detail);
    }
    if (res.status === 204) return undefined as unknown as T;
    return res.json() as Promise<T>;
  }, []);

  return apiFetch;
}

/**
 * Standalone apiFetch that doesn't need a hook context.
 * Useful inside Zustand store actions or non-component code.
 */
export async function apiFetchStandalone<T = any>(
  path: string,
  options: ApiOptions = {}
): Promise<T> {
  const token = useAuthStore.getState().token;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...((options.headers as Record<string, string>) || {}),
  };
  const res = await fetch(`${API}${path}`, { ...options, headers });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail || body.message || detail;
    } catch { /* ignore */ }
    throw new Error(detail);
  }
  if (res.status === 204) return undefined as unknown as T;
  return res.json() as Promise<T>;
}
