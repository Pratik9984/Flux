// lib/mediaCache.ts
// Resolves a media URL for web playback and display.

export async function getCachedMediaUrl(url: string): Promise<string> {
  return (url || "").trim();
}
