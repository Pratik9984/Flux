// lib/mediaCache.ts
// Resolves a media URL for web playback and display using WhatsApp's storage model:
// 1. Checks in-memory session object URLs.
// 2. Checks persistent IndexedDB local storage (cached_media_blobs).
// 3. If missing locally, downloads the encrypted .enc file from the server,
//    decrypts it with the AES key and IV, saves it to IndexedDB, and returns the object URL.
// 4. If the server file has been deleted (>45 days) and is not in local storage, returns "EXPIRED".

import { dbGetLocalMedia, dbSaveLocalMedia } from "@/lib/db";
import { decryptMediaBuffer } from "@/lib/mediaCrypto";

const inMemoryMediaMap = new Map<string, string>();
const pendingDownloads = new Map<string, Promise<string>>();

export function getCachedMediaSync(url: string): string | undefined {
  if (!url) return undefined;
  return inMemoryMediaMap.get(url.trim());
}

export async function getCachedMediaUrl(
  url: string,
  keyB64?: string,
  ivB64?: string,
  mimeType?: string
): Promise<string> {
  if (!url) return "";
  const cleanUrl = url.trim();

  // 1. Check in-memory session cache
  const inMemory = inMemoryMediaMap.get(cleanUrl);
  if (inMemory) return inMemory;

  // Deduplicate concurrent requests for the exact same media
  const inflight = pendingDownloads.get(cleanUrl);
  if (inflight) return inflight;

  const resolvePromise = (async () => {
    try {
      // 2. Check persistent local device storage (IndexedDB)
      const localRecord = await dbGetLocalMedia(cleanUrl);
      if (localRecord && localRecord.blob) {
        const objectUrl = URL.createObjectURL(localRecord.blob);
        inMemoryMediaMap.set(cleanUrl, objectUrl);
        return objectUrl;
      }

      // 3. If not cached locally, download from server
      const res = await fetch(cleanUrl, { mode: "cors" });
      if (res.status === 404 || res.status === 410) {
        // File was deleted from server (after 45 days) and not present locally
        return "EXPIRED";
      }

      if (!res.ok) {
        throw new Error(`HTTP error ${res.status}`);
      }

      const buffer = await res.arrayBuffer();

      let finalBlob: Blob;
      if (keyB64) {
        // Decrypt the encrypted .enc file
        finalBlob = await decryptMediaBuffer(buffer, keyB64, ivB64, mimeType);
      } else {
        // Standard unencrypted binary blob
        finalBlob = new Blob([buffer], { type: mimeType || res.headers.get("content-type") || "application/octet-stream" });
      }

      // 4. Save decrypted file permanently into device-local storage (WhatsApp model)
      await dbSaveLocalMedia(cleanUrl, finalBlob, mimeType || finalBlob.type);

      // Silent auto-download to device gallery if user preference is active
      try {
        const autoSaveEnabled = typeof localStorage !== "undefined" && localStorage.getItem("flux_save_to_gallery") === "true";
        const bridge = typeof window !== "undefined" ? (window as any).FluxNativeBridge : null;
        if (autoSaveEnabled && bridge && typeof bridge.saveMediaToGallery === "function") {
          const reader = new FileReader();
          reader.onloadend = () => {
            const b64 = reader.result as string;
            const cleanType = mimeType || finalBlob.type || "application/octet-stream";
            const ext = cleanType.includes("jpeg") || cleanType.includes("jpg") ? "jpg" :
                        cleanType.includes("png") ? "png" :
                        cleanType.includes("mp4") ? "mp4" :
                        cleanType.includes("webp") ? "webp" : "media";
            const fileName = `Flux_${Date.now()}.${ext}`;
            bridge.saveMediaToGallery(b64, fileName, cleanType);
          };
          reader.readAsDataURL(finalBlob);
        }
      } catch (autoErr) {
        console.warn("[MediaCache] auto-save warning:", autoErr);
      }

      const objectUrl = URL.createObjectURL(finalBlob);
      inMemoryMediaMap.set(cleanUrl, objectUrl);
      return objectUrl;
    } catch (err) {
      console.warn("[MediaCache] Failed to load/decrypt media:", cleanUrl, err);
      // If encrypted, never fallback to raw .enc URL which breaks <img>
      return keyB64 ? "" : cleanUrl;
    } finally {
      pendingDownloads.delete(cleanUrl);
    }
  })();

  pendingDownloads.set(cleanUrl, resolvePromise);
  return resolvePromise;
}

/**
 * Saves a locally recorded or selected media blob directly into device storage
 * before or during sending.
 */
export async function cacheSentMediaLocally(url: string, blob: Blob, mimeType: string): Promise<string> {
  if (!url || !blob) return "";
  const cleanUrl = url.trim();
  try {
    await dbSaveLocalMedia(cleanUrl, blob, mimeType || blob.type);
    const objectUrl = URL.createObjectURL(blob);
    inMemoryMediaMap.set(cleanUrl, objectUrl);
    return objectUrl;
  } catch (err) {
    console.warn("[MediaCache] cacheSentMediaLocally failed:", err);
    return url;
  }
}
