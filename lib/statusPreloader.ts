import type { UserStatusGroup } from "@/types";
import { API } from "@/lib/api";

const prefetchedUrls = new Set<string>();

/**
 * Pre-warms image and video buffers for all incoming user statuses in the background.
 * When the user taps any status card, the media is already loaded in browser cache.
 */
export function prefetchStatusMedia(statusGroups: UserStatusGroup[]) {
  if (typeof window === "undefined" || !statusGroups || !Array.isArray(statusGroups)) return;

  statusGroups.forEach((group) => {
    (group.statuses || []).forEach((st) => {
      if (!st.media_url) return;

      let rawUrl = st.media_url.trim();
      if (rawUrl.startsWith("/")) {
        rawUrl = `${API.replace(/\/+$/, "")}${rawUrl}`;
      }

      if (prefetchedUrls.has(rawUrl)) return;
      prefetchedUrls.add(rawUrl);

      const isVid = /\.(mp4|webm|mov|3gp)(\?.*)?$/i.test(rawUrl);

      if (isVid) {
        try {
          const video = document.createElement("video");
          video.preload = "auto";
          video.muted = true;
          video.playsInline = true;
          video.src = rawUrl;
        } catch {}
      } else {
        try {
          const img = new Image();
          img.src = rawUrl;
        } catch {}
      }
    });
  });
}
