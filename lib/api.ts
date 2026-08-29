// ─── Pulse/Flux — API Client ──────────────────────────────────────────────────

import type { ApiOptions } from "@/types";
import { useAuthStore } from "@/stores/authStore";

export const API = process.env.NEXT_PUBLIC_API_URL || "http://54.253.245.248:7860";
export const WS_URL = process.env.NEXT_PUBLIC_WS_URL || API.replace(/^http/, "ws");

/**
 * Creates an apiFetch function bound to a token ref.
 * This allows the function to always use the latest token without re-creation.
 */
export function createApiFetch(
  tokenRef: React.MutableRefObject<string>,
  abortControllerRef: React.MutableRefObject<AbortController>,
) {
  return async <T,>(path: string, opts: ApiOptions = {}): Promise<T> => {
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
  };
}

/**
 * Uploads media file to backend FastAPI server via multipart/form-data.
 * Returns the fully qualified public URL of the uploaded file.
 */
export async function uploadMediaToBackend(
  file: File | Blob,
  token?: string,
  fileName?: string
): Promise<{ url: string; filename: string }> {
  const formData = new FormData();
  const actualName = fileName || (file instanceof File ? file.name : `file_${Date.now()}`);
  formData.append("file", file, actualName);

  const headers = new Headers();
  headers.set("ngrok-skip-browser-warning", "true");
  const storedToken = typeof window !== "undefined" ? (useAuthStore.getState().token || localStorage.getItem("auth_token") || localStorage.getItem("token") || "") : "";
  const authToken = token || storedToken;
  if (authToken) headers.set("Authorization", `Bearer ${authToken}`);

  const res = await fetch(`${API}/upload`, {
    method: "POST",
    headers,
    body: formData,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: "Media upload failed" }));
    throw new Error(body.detail || `Upload failed with status ${res.status}`);
  }

  const data = await res.json();
  let url = data.url || data.file_url || data.path || "";
  if (!url) throw new Error("Server did not return a valid file URL");

  // Ensure absolute URL if backend returns relative path
  if (url.startsWith("/")) {
    url = `${API.replace(/\/+$/, "")}${url}`;
  }
  return { url, filename: data.filename || actualName };
}
