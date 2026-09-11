// ─── Pulse/Flux — Shared Type Definitions ────────────────────────────────────

export type StickerPackMeta = { id: number; name: string; thumbnail_url: string };
export type StickerItem = { id: number; url: string; name: string };
export type Chat = { type: "user" | "group"; id: string | number; name: string };
export type Contact = {
  email: string; username?: string | null; display_name?: string | null;
  nickname?: string | null; is_online?: boolean; avatar_url?: string | null;
  about?: string | null; is_favorite?: boolean; not_in_contacts?: boolean;
};

export type ContactRequestStatus = "pending" | "accepted" | "declined" | "cancelled" | "expired";

export type MutualPreviewUser = {
  email: string;
  display_name: string | null;
  username: string | null;
  avatar_url: string | null;
};

export type ContactRequest = {
  id: number;
  sender_email: string;
  receiver_email: string;
  note?: string | null;
  status: ContactRequestStatus;
  created_at: string;
  user: {
    email: string;
    username: string | null;
    display_name: string | null;
    avatar_url: string | null;
    about: string | null;
  };
  mutual_count: number;
  mutual_preview: MutualPreviewUser[];
  shared_groups_count?: number;
};

export type SuggestedContact = {
  email: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  about: string | null;
  mutual_count: number;
  mutual_preview: MutualPreviewUser[];
  shared_groups_count?: number;
};

export type UserSearchResult = {
  email: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  about: string | null;
  relationship_status: "none" | "pending_sent" | "pending_received" | "contact" | "blocked";
  request_id?: number | null;
  mutual_count: number;
  mutual_preview: MutualPreviewUser[];
  shared_groups_count?: number;
};
export type Group = {
  id: string | number; name: string; members: any[]; avatar_url?: string | null;
  description?: string | null; created_by?: string;
};
export type Message = {
  id: string | number; user: string; content: string; timestamp: string;
  group_id?: string | number; group_name?: string; receiver_email?: string;
  target_user?: string; is_read?: boolean; is_deleted?: boolean;
  deleted_by?: string; deleted_by_name?: string;
  edited_at?: string; is_edited?: boolean; reply_to_id?: string | number; reply_to_content?: string;
  reply_to?: { id?: string | number; user: string; content: string; sender_name?: string };
  reactions?: Record<string, string[]>; read_by?: string[];
  sender_name?: string; sender_avatar?: string; _callRecord?: boolean;
  is_forwarded?: boolean; forwarded_from_id?: string | number;
  _dateLabel?: string;
};
export type GroupedMessage = { type: "divider"; label: string } | ({ type: "msg" } & Message);
export type CallState = "idle" | "incoming" | "calling" | "connected";
export type ApiOptions = RequestInit & { headers?: HeadersInit; signal?: AbortSignal };
export type AuthStep = "welcome" | "signin" | "signup" | "pick-username" | "verify-email" | "forgot-password" | "reset-password";
export type CallLogEntry = {
  id: string; peer: string; peerName: string;
  direction: "incoming" | "outgoing"; media: "audio" | "video";
  status: "completed" | "missed" | "rejected"; timestamp: string; duration: number;
  group_id?: string | number;
};
export type WsStatus = "connected" | "disconnected" | "reconnecting" | "offline";
export type ProfileTab = "info" | "media" | "calls" | "members";
export type StoredCallOffer = {
  sdp: RTCSessionDescriptionInit; peer: string; peerName: string;
  isVideo: boolean; ts: number; group_id?: string | number;
};

// ─── Auth Reducer Types ───────────────────────────────────────────────────────
export type AuthState = {
  step: AuthStep; email: string; pass: string; pass2: string;
  user: string; loading: boolean; error: string;
};
export type AuthAction =
  | { type: "SET_STEP"; step: AuthStep }
  | { type: "SET_FIELD"; field: "email" | "pass" | "pass2" | "user"; value: string }
  | { type: "SET_LOADING"; value: boolean }
  | { type: "SET_ERROR"; value: string }
  | { type: "RESET" };

// ─── Status / Stories (24-Hour Ephemeral) ────────────────────────────────────
export type StatusItem = {
  id: number;
  user_email: string;
  media_url?: string | null;
  content_text?: string | null;
  bg_color?: string | null;
  font_style?: string | null;
  created_at: string;
  expires_at: string;
  is_viewed: boolean;
  views_count: number;
};

export type UserStatusGroup = {
  user_email: string;
  display_name: string;
  username?: string | null;
  avatar_url?: string | null;
  has_unviewed: boolean;
  last_updated?: string | null;
  statuses: StatusItem[];
};

export type StatusViewEntry = {
  viewer_email: string;
  display_name: string;
  avatar_url?: string | null;
  viewed_at: string;
};
