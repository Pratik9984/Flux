"use client";

import { useState, useEffect } from "react";
import {
  isEncryptedAvatarUrl,
  decryptAvatarUrl,
  getCachedAvatarUrl,
  normalizeAvatarUrl,
} from "@/lib/avatarCrypto";

/**
 * Hook to automatically normalize, decrypt, and resolve avatar URLs.
 * - Standard unencrypted image URLs are returned immediately as normalized absolute URLs.
 * - Encrypted .enc URLs check sync cache first (instant render) or decrypt in memory.
 * - On failure, returns null (never returns raw .enc ciphertext), allowing clean fallback initials.
 */
export function useAvatar(url?: string | null): string | null {
  const normUrl = url ? normalizeAvatarUrl(url) : "";

  const [resolved, setResolved] = useState<string | null>(() => {
    if (!normUrl) return null;
    if (!isEncryptedAvatarUrl(normUrl)) return normUrl;
    return getCachedAvatarUrl(normUrl) || null;
  });

  useEffect(() => {
    if (!normUrl) {
      setResolved(null);
      return;
    }

    // Regular image URL (not encrypted)
    if (!isEncryptedAvatarUrl(normUrl)) {
      setResolved(normUrl);
      return;
    }

    // Check synchronous cache (memory or localStorage)
    const cached = getCachedAvatarUrl(normUrl);
    if (cached) {
      setResolved(cached);
      return;
    }

    let isMounted = true;
    decryptAvatarUrl(normUrl)
      .then((decryptedUrl) => {
        if (isMounted) {
          // If decryption succeeded, set resolved URL; if failed, set null for graceful initial fallback
          setResolved(decryptedUrl || null);
        }
      })
      .catch(() => {
        if (isMounted) {
          setResolved(null);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [normUrl]);

  return resolved;
}
