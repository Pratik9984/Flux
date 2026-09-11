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
      if (res.status === 401) {
        try { useAuthStore.getState().logout(); } catch {}
      }
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

// ─── Status & Contact Types ───────────────────────────────────────────────────
import type {
  UserStatusGroup,
  StatusItem,
  StatusViewEntry,
  ContactRequest,
  SuggestedContact,
  UserSearchResult,
  MutualPreviewUser,
} from "@/types";

function getAuthHeader(token?: string): Record<string, string> {
  const storedToken = typeof window !== "undefined"
    ? (useAuthStore.getState().token || localStorage.getItem("auth_token") || localStorage.getItem("token") || "")
    : "";
  const authToken = token || storedToken;
  return authToken ? { Authorization: `Bearer ${authToken}` } : {};
}

export async function fetchStatuses(token?: string): Promise<UserStatusGroup[]> {
  try {
    const res = await fetch(`${API}/statuses`, {
      headers: {
        "Content-Type": "application/json",
        "ngrok-skip-browser-warning": "true",
        ...getAuthHeader(token),
      },
    });
    if (!res.ok) {
      if (res.status === 404) {
        return [];
      }
      const body = await res.json().catch(() => ({ detail: "Failed to fetch statuses" }));
      throw new Error(body.detail || "Failed to fetch statuses");
    }
    return res.json();
  } catch (err) {
    console.warn("[Status] Backend statuses not available yet:", err);
    return [];
  }
}

export async function createStatusApi(
  payload: { media_url?: string | null; content_text?: string | null; bg_color?: string | null; font_style?: string | null },
  token?: string
): Promise<StatusItem> {
  const res = await fetch(`${API}/statuses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "ngrok-skip-browser-warning": "true",
      ...getAuthHeader(token),
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: "Failed to create status" }));
    throw new Error(body.detail || "Failed to create status");
  }
  return res.json();
}

export async function markStatusViewedApi(statusId: number, token?: string): Promise<{ message: string }> {
  const res = await fetch(`${API}/statuses/${statusId}/view`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "ngrok-skip-browser-warning": "true",
      ...getAuthHeader(token),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: "Failed to mark status viewed" }));
    throw new Error(body.detail || "Failed to mark status viewed");
  }
  return res.json();
}

export async function deleteStatusApi(statusId: number, token?: string): Promise<{ message: string }> {
  const res = await fetch(`${API}/statuses/${statusId}`, {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      "ngrok-skip-browser-warning": "true",
      ...getAuthHeader(token),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: "Failed to delete status" }));
    throw new Error(body.detail || "Failed to delete status");
  }
  return res.json();
}

export async function fetchStatusViewsApi(statusId: number, token?: string): Promise<StatusViewEntry[]> {
  const res = await fetch(`${API}/statuses/${statusId}/views`, {
    headers: {
      "Content-Type": "application/json",
      "ngrok-skip-browser-warning": "true",
      ...getAuthHeader(token),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: "Failed to fetch status views" }));
    throw new Error(body.detail || "Failed to fetch status views");
  }
  return res.json();
}

// ─── Contact Requests & Mutual Friends API Methods ────────────────────────────

export async function searchUsersApi(query: string, token?: string): Promise<UserSearchResult[]> {
  if (!query.trim()) return [];
  const res = await fetch(`${API}/users/search?q=${encodeURIComponent(query.trim())}&limit=30`, {
    headers: {
      "Content-Type": "application/json",
      "ngrok-skip-browser-warning": "true",
      ...getAuthHeader(token),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: "Failed to search users" }));
    throw new Error(body.detail || "Failed to search users");
  }
  return res.json();
}

export async function fetchSuggestedContactsApi(token?: string): Promise<SuggestedContact[]> {
  const res = await fetch(`${API}/contacts/suggestions?limit=20`, {
    headers: {
      "Content-Type": "application/json",
      "ngrok-skip-browser-warning": "true",
      ...getAuthHeader(token),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: "Failed to fetch suggestions" }));
    throw new Error(body.detail || "Failed to fetch suggestions");
  }
  return res.json();
}

export async function fetchMutualContactsApi(targetEmail: string, token?: string): Promise<MutualPreviewUser[]> {
  const res = await fetch(`${API}/contacts/mutual/${encodeURIComponent(targetEmail)}`, {
    headers: {
      "Content-Type": "application/json",
      "ngrok-skip-browser-warning": "true",
      ...getAuthHeader(token),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: "Failed to fetch mutual contacts" }));
    throw new Error(body.detail || "Failed to fetch mutual contacts");
  }
  return res.json();
}

export async function sendContactRequestApi(
  target: string,
  note?: string,
  token?: string
): Promise<{ status: string; message: string; request_id?: number }> {
  const res = await fetch(`${API}/contacts/requests`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "ngrok-skip-browser-warning": "true",
      ...getAuthHeader(token),
    },
    body: JSON.stringify({ target, note: note || null }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: "Failed to send contact request" }));
    throw new Error(body.detail || "Failed to send contact request");
  }
  return res.json();
}

export async function fetchIncomingRequestsApi(token?: string): Promise<ContactRequest[]> {
  const res = await fetch(`${API}/contacts/requests/incoming`, {
    headers: {
      "Content-Type": "application/json",
      "ngrok-skip-browser-warning": "true",
      ...getAuthHeader(token),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: "Failed to fetch incoming requests" }));
    throw new Error(body.detail || "Failed to fetch incoming requests");
  }
  return res.json();
}

export async function fetchOutgoingRequestsApi(token?: string): Promise<ContactRequest[]> {
  const res = await fetch(`${API}/contacts/requests/outgoing`, {
    headers: {
      "Content-Type": "application/json",
      "ngrok-skip-browser-warning": "true",
      ...getAuthHeader(token),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: "Failed to fetch outgoing requests" }));
    throw new Error(body.detail || "Failed to fetch outgoing requests");
  }
  return res.json();
}

export async function acceptContactRequestApi(requestId: number, token?: string): Promise<{ status: string; message: string }> {
  const res = await fetch(`${API}/contacts/requests/${requestId}/accept`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "ngrok-skip-browser-warning": "true",
      ...getAuthHeader(token),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: "Failed to accept contact request" }));
    throw new Error(body.detail || "Failed to accept contact request");
  }
  return res.json();
}

export async function declineContactRequestApi(requestId: number, token?: string): Promise<{ status: string; message: string }> {
  const res = await fetch(`${API}/contacts/requests/${requestId}/decline`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "ngrok-skip-browser-warning": "true",
      ...getAuthHeader(token),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: "Failed to decline contact request" }));
    throw new Error(body.detail || "Failed to decline contact request");
  }
  return res.json();
}

export async function declineAndBlockContactRequestApi(requestId: number, token?: string): Promise<{ status: string; message: string }> {
  const res = await fetch(`${API}/contacts/requests/${requestId}/decline-block`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "ngrok-skip-browser-warning": "true",
      ...getAuthHeader(token),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: "Failed to decline and block" }));
    throw new Error(body.detail || "Failed to decline and block");
  }
  return res.json();
}

export async function cancelContactRequestApi(requestId: number, token?: string): Promise<{ status: string; message: string }> {
  const res = await fetch(`${API}/contacts/requests/${requestId}/cancel`, {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      "ngrok-skip-browser-warning": "true",
      ...getAuthHeader(token),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: "Failed to cancel contact request" }));
    throw new Error(body.detail || "Failed to cancel contact request");
  }
  return res.json();
}

export async function connectViaQRApi(qrData: string, token?: string): Promise<{ status: string; message: string; contact?: any }> {
  const res = await fetch(`${API}/contacts/qr-connect`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "ngrok-skip-browser-warning": "true",
      ...getAuthHeader(token),
    },
    body: JSON.stringify({ qr_data: qrData }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: "Failed to connect via QR" }));
    throw new Error(body.detail || "Failed to connect via QR");
  }
  return res.json();
}

export async function toggleFavoriteContactApi(targetEmail: string, token?: string): Promise<{ is_favorite: boolean; favorites: string[] }> {
  const res = await fetch(`${API}/contacts/favorites/${encodeURIComponent(targetEmail)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "ngrok-skip-browser-warning": "true",
      ...getAuthHeader(token),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: "Failed to toggle favorite" }));
    throw new Error(body.detail || "Failed to toggle favorite");
  }
  return res.json();
}

export async function updatePrivacySettingApi(requestPrivacy: "everyone" | "mutual_only", token?: string): Promise<{ request_privacy: string }> {
  const res = await fetch(`${API}/profile/privacy`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "ngrok-skip-browser-warning": "true",
      ...getAuthHeader(token),
    },
    body: JSON.stringify({ request_privacy: requestPrivacy }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: "Failed to update privacy" }));
    throw new Error(body.detail || "Failed to update privacy");
  }
  return res.json();
}

export async function removeContactApi(contactEmail: string, token?: string): Promise<{ message: string }> {
  const res = await fetch(`${API}/contacts/${encodeURIComponent(contactEmail)}`, {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      "ngrok-skip-browser-warning": "true",
      ...getAuthHeader(token),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: "Failed to remove contact" }));
    throw new Error(body.detail || "Failed to remove contact");
  }
  return res.json();
}

export async function deleteMessageForMeApi(messageId: string | number, token?: string): Promise<{ message: string; id: number }> {
  const res = await fetch(`${API}/messages/${messageId}/delete-for-me`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "ngrok-skip-browser-warning": "true",
      ...getAuthHeader(token),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: "Failed to delete message" }));
    throw new Error(body.detail || "Failed to delete message");
  }
  return res.json();
}

export async function deleteMessageForEveryoneApi(messageId: string | number, token?: string): Promise<{ message: string; id: number }> {
  const res = await fetch(`${API}/messages/${messageId}/delete-for-everyone`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "ngrok-skip-browser-warning": "true",
      ...getAuthHeader(token),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: "Failed to delete message for everyone" }));
    throw new Error(body.detail || "Failed to delete message for everyone");
  }
  return res.json();
}

export async function clearChatApi(type: "user" | "group", id: string | number, token?: string): Promise<{ message: string }> {
  const endpoint = type === "user"
    ? `${API}/conversations/user/${encodeURIComponent(String(id))}/clear`
    : `${API}/conversations/group/${id}/clear`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "ngrok-skip-browser-warning": "true",
      ...getAuthHeader(token),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: "Failed to clear chat" }));
    throw new Error(body.detail || "Failed to clear chat");
  }
  return res.json();
}

export async function hideChatApi(type: "user" | "group", id: string | number, token?: string): Promise<{ message: string }> {
  const endpoint = type === "user"
    ? `${API}/conversations/user/${encodeURIComponent(String(id))}`
    : `${API}/conversations/group/${id}`;
  const res = await fetch(endpoint, {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      "ngrok-skip-browser-warning": "true",
      ...getAuthHeader(token),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: "Failed to hide chat" }));
    throw new Error(body.detail || "Failed to hide chat");
  }
  return res.json();
}

export async function getHiddenConversationsApi(token?: string): Promise<{ peer_email?: string; group_id?: number; hidden_at?: string }[]> {
  const res = await fetch(`${API}/conversations/hidden`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      "ngrok-skip-browser-warning": "true",
      ...getAuthHeader(token),
    },
  });
  if (!res.ok) {
    return [];
  }
  return res.json();
}

export async function markReadBatchApi(
  payload: { peer_email?: string; group_id?: string; peer_emails?: string[]; message_ids?: number[] },
  token?: string
): Promise<{ message: string }> {
  const res = await fetch(`${API}/mark-read-batch`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "ngrok-skip-browser-warning": "true",
      ...getAuthHeader(token),
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: "Failed to mark read" }));
    throw new Error(body.detail || "Failed to mark read");
  }
  return res.json();
}



