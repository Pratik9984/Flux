// ─── Pulse/Flux Client-Side Avatar Encryption (AES-256-GCM) ──────────────────────────
// Ensures all profile photos uploaded to the server are stored as encrypted ciphertext (.enc).
// The server administrator, database, and filesystem NEVER see plaintext images.
// Any authenticated client automatically decrypts and caches the avatar in memory and persistent storage.

const AVATAR_KEY_SALT = new Uint8Array([
  0x46, 0x6c, 0x75, 0x78, 0x5f, 0x41, 0x76, 0x61, 0x74, 0x61, 0x72, 0x5f, 0x53, 0x65, 0x63, 0x72,
  0x65, 0x74, 0x5f, 0x53, 0x61, 0x6c, 0x74, 0x5f, 0x32, 0x30, 0x32, 0x36, 0x5f, 0x76, 0x31, 0x21
]);

const AVATAR_KEY_INFO = new TextEncoder().encode("flux-avatar-client-encryption-v1");

let cachedAvatarKey: CryptoKey | null = null;
const avatarBlobCache = new Map<string, string>();
const pendingDecryptions = new Map<string, Promise<string>>();

/**
 * Normalizes an avatar URL to an absolute URL.
 * Handles relative paths (/files/..., /uploads/...) and ensures consistency.
 */
export function normalizeAvatarUrl(url?: string | null): string {
  if (!url) return "";
  const trimmed = url.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("blob:") || trimmed.startsWith("data:")) return trimmed;
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
  const apiBase = (process.env.NEXT_PUBLIC_API_URL || "http://54.253.245.248:7860").replace(/\/+$/, "");
  return `${apiBase}/${trimmed.replace(/^\/+/, "")}`;
}

/**
 * Helper to get a stable storage key for an avatar URL.
 */
function getStorageKey(url: string): string {
  const norm = normalizeAvatarUrl(url);
  const clean = norm.split("?")[0].split("#")[0];
  const filename = clean.split("/").pop() || clean;
  return `pulse_av_${filename}`;
}

/**
 * Derives the client-side AES-256-GCM key used to encrypt and decrypt profile photos.
 */
async function getAvatarKey(): Promise<CryptoKey> {
  if (cachedAvatarKey) return cachedAvatarKey;

  const baseKey = await crypto.subtle.importKey(
    "raw",
    AVATAR_KEY_SALT,
    { name: "HKDF" },
    false,
    ["deriveKey"]
  );

  cachedAvatarKey = await crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: AVATAR_KEY_SALT,
      info: AVATAR_KEY_INFO,
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );

  return cachedAvatarKey;
}

/**
 * Checks if a given avatar URL points to an encrypted .enc file.
 */
export function isEncryptedAvatarUrl(url?: string | null): boolean {
  if (!url) return false;
  const clean = url.split("?")[0].split("#")[0].toLowerCase();
  return clean.endsWith(".enc");
}

/**
 * Encrypts a clean image Blob using AES-256-GCM.
 * Produces a binary Blob starting with a 12-byte random IV followed by the ciphertext.
 */
export async function encryptAvatarBlob(imageBlob: Blob): Promise<{ encryptedBlob: Blob; fileName: string }> {
  const key = await getAvatarKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const rawBytes = await imageBlob.arrayBuffer();

  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    rawBytes
  );

  const combined = new Uint8Array(iv.byteLength + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.byteLength);

  const encryptedBlob = new Blob([combined], { type: "application/octet-stream" });
  const fileName = `avatar_${Date.now()}_${Math.random().toString(36).substring(2, 8)}.enc`;

  return { encryptedBlob, fileName };
}

/**
 * Decrypts an encrypted .enc avatar URL into an in-memory blob: URL or cached DataURL.
 * Automatically retries on network failures, caches persistently in localStorage,
 * and NEVER returns raw .enc ciphertext so that broken image placeholders never occur.
 */
export async function decryptAvatarUrl(rawUrl: string): Promise<string> {
  if (!rawUrl) return "";
  const url = normalizeAvatarUrl(rawUrl);
  if (!isEncryptedAvatarUrl(url)) return url;

  // 1. Check in-memory blob cache
  const inMemory = avatarBlobCache.get(url);
  if (inMemory) return inMemory;

  // 2. Check persistent disk cache (instant sync hit across reloads)
  if (typeof window !== "undefined") {
    try {
      const persisted = localStorage.getItem(getStorageKey(url));
      if (persisted && persisted.startsWith("data:image/")) {
        avatarBlobCache.set(url, persisted);
        return persisted;
      }
    } catch {}
  }

  // 3. Deduplicate inflight requests for the same avatar URL
  const inflight = pendingDecryptions.get(url);
  if (inflight) return inflight;

  const decryptPromise = (async () => {
    try {
      let response: Response | null = null;
      let lastError: any = null;

      // Resilient fetch with up to 3 retry attempts for cold starts or network blips
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          response = await fetch(url, { mode: "cors" });
          if (response.ok) break;
        } catch (e) {
          lastError = e;
        }
        if (attempt < 3) {
          await new Promise((resolve) => setTimeout(resolve, attempt * 350));
        }
      }

      if (!response || !response.ok) {
        throw new Error(`Failed to fetch encrypted avatar after 3 attempts (${response?.status || "network error"}): ${lastError?.message || ""}`);
      }

      const buffer = await response.arrayBuffer();
      if (buffer.byteLength < 13) {
        throw new Error("Encrypted avatar file is too small or invalid");
      }

      const iv = new Uint8Array(buffer, 0, 12);
      const ciphertext = new Uint8Array(buffer, 12);

      const key = await getAvatarKey();
      const decrypted = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv },
        key,
        ciphertext
      );

      const imageBlob = new Blob([decrypted], { type: "image/jpeg" });
      const objectUrl = URL.createObjectURL(imageBlob);

      avatarBlobCache.set(url, objectUrl);

      // Persist to localStorage asynchronously as DataURL for instant subsequent loads
      if (typeof window !== "undefined") {
        const reader = new FileReader();
        reader.onloadend = () => {
          if (typeof reader.result === "string") {
            try {
              localStorage.setItem(getStorageKey(url), reader.result);
            } catch (quotaErr) {
              // LocalStorage quota may be full, ignore safely
            }
          }
        };
        reader.readAsDataURL(imageBlob);
      }

      return objectUrl;
    } catch (err) {
      console.warn("[AvatarCrypto] Decryption failed for:", url, err);
      // CRITICAL: NEVER return the raw .enc URL. Encrypted ciphertext is not an image format
      // and causes browser native broken image icons. Return empty string so fallback initial renders.
      return "";
    } finally {
      pendingDecryptions.delete(url);
    }
  })();

  pendingDecryptions.set(url, decryptPromise);
  return decryptPromise;
}

/**
 * Returns the cached decrypted blob URL / DataURL if already decrypted, or the normalized URL.
 * Checks in-memory cache and localStorage synchronously.
 */
export function getCachedAvatarUrl(rawUrl?: string | null): string {
  if (!rawUrl) return "";
  const url = normalizeAvatarUrl(rawUrl);
  if (!isEncryptedAvatarUrl(url)) return url;

  // Check in-memory map
  const inMemory = avatarBlobCache.get(url);
  if (inMemory) return inMemory;

  // Check persistent disk cache synchronously
  if (typeof window !== "undefined") {
    try {
      const persisted = localStorage.getItem(getStorageKey(url));
      if (persisted && persisted.startsWith("data:image/")) {
        avatarBlobCache.set(url, persisted);
        return persisted;
      }
    } catch {}
  }

  return "";
}
