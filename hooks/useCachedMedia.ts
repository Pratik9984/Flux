import { useState, useEffect } from "react";
import { getCachedMediaUrl } from "@/lib/mediaCache";

export function useCachedMedia(url: string) {
  const [cachedUrl, setCachedUrl] = useState(url);

  useEffect(() => {
    let active = true;
    getCachedMediaUrl(url).then((resolved) => {
      if (active) {
        setCachedUrl(resolved);
      }
    }).catch(() => {});
    return () => {
      active = false;
    };
  }, [url]);

  return cachedUrl;
}
