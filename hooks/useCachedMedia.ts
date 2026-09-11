import { useState, useEffect } from "react";
import { getCachedMediaUrl, getCachedMediaSync } from "@/lib/mediaCache";

export function useCachedMedia(
  url: string,
  keyB64?: string,
  ivB64?: string,
  mimeType?: string
) {
  const [cachedUrl, setCachedUrl] = useState(() => {
    if (!url) return "";
    const inMem = getCachedMediaSync(url);
    if (inMem) return inMem;
    return keyB64 ? "" : url;
  });

  useEffect(() => {
    if (!url) {
      setCachedUrl("");
      return;
    }
    const inMem = getCachedMediaSync(url);
    if (inMem) {
      setCachedUrl(inMem);
      return;
    }
    setCachedUrl(keyB64 ? "" : url);
    let active = true;
    getCachedMediaUrl(url, keyB64, ivB64, mimeType).then((resolved) => {
      if (active) {
        setCachedUrl(resolved);
      }
    }).catch(() => {});
    return () => {
      active = false;
    };
  }, [url, keyB64, ivB64, mimeType]);

  return cachedUrl;
}
