// ─── Pulse/Flux — Utility Functions ───────────────────────────────────────────

export const USERNAME_RE = /^[a-z0-9_]{3,30}$/;

export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : "Request failed");

export const getEmail = (m: any) => (m && typeof m === "object" ? m.email : m) as string;

export const getIsAdmin = (m: any) => !!(m && typeof m === "object" && (m.is_admin || m.role === "admin" || m.role === "creator"));

export const safeParseJSON = <T,>(str: string | null, fallback: T): T => {
  if (!str) return fallback;
  try { return JSON.parse(str); } catch { return fallback; }
};

export const fmtDuration = (sec: number) => {
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
};

export const parseTs = (ts: string): Date => {
  if (!ts) return new Date();
  let clean = ts.replace(" ", "T");
  const hasOffset = clean.endsWith("Z") || /[+-]\d{2}:\d{2}$/.test(clean);
  if (!hasOffset) clean += "Z";
  clean = clean.replace(/\.(\d{3})\d+/, ".$1");
  const d = new Date(clean);
  return isNaN(d.getTime()) ? (new Date(ts) || new Date()) : d;
};

export const formatTimeAgo = (ts: number): string => {
  if (!ts) return "";
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d`;
  return `${Math.floor(days / 7)}w`;
};

export const getDateLabel = (ts: string): string => {
  const d = parseTs(ts);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  const dStr = d.toDateString();
  if (dStr === today.toDateString()) return "Today";
  if (dStr === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
};

export const updateReactionsForUser = (
  reactions: Record<string, string[]> | undefined,
  user: string,
  emoji: string,
): Record<string, string[]> => {
  const current = reactions || {};
  const next: Record<string, string[]> = {};
  const cleanUser = (user || "").trim().toLowerCase();
  let wasReactedWithSame = false;

  Object.entries(current).forEach(([em, users]) => {
    const isSameEmoji = em === emoji;
    const hasUser = users.some(u => (u || "").trim().toLowerCase() === cleanUser);
    const filtered = users.filter(u => (u || "").trim().toLowerCase() !== cleanUser);

    if (isSameEmoji) {
      if (hasUser) {
        wasReactedWithSame = true;
      } else {
        filtered.push(cleanUser);
      }
    }
    if (filtered.length > 0) next[em] = filtered;
  });

  if (!wasReactedWithSame && !next[emoji]) next[emoji] = [cleanUser];
  return next;
};

/**
 * Compresses an image file client-side to standard web-ready dimensions (max 1280px, quality 0.8)
 * and returns a lightweight Data URL (~100KB-250KB) that sends instantly over WebSocket.
 */
export async function compressImage(file: File, maxDim = 1280, quality = 0.8): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
      return;
    }

    // GIF or SVG: keep original
    if (file.type === "image/gif" || file.type === "image/svg+xml") {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
      return;
    }

    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        if (width > height) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      const mimeType = "image/jpeg";
      const dataUrl = canvas.toDataURL(mimeType, quality);
      resolve(dataUrl);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    };
    img.src = url;
  });
}
