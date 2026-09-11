// lib/updater.ts
// Handles in-app OTA / backend update checks against /updates/latest

import { API } from './api';

export const CURRENT_APP_VERSION = "1.0.0";

export interface UpdateInfo {
  version: string;
  url: string;
  checksum: string;
  hasUpdate: boolean;
}

/**
 * Compare two semver-like version strings (e.g. '1.0.1' > '1.0.0').
 */
export function isNewerVersion(remote: string, local: string): boolean {
  if (!remote) return false;
  if (remote === local) return false;
  const parse = (v: string) => v.replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
  const rParts = parse(remote);
  const lParts = parse(local);
  for (let i = 0; i < Math.max(rParts.length, lParts.length); i++) {
    const r = rParts[i] || 0;
    const l = lParts[i] || 0;
    if (r > l) return true;
    if (r < l) return false;
  }
  return remote !== local;
}

/**
 * Queries GET /updates/latest from backend.
 */
export async function checkLatestUpdate(): Promise<UpdateInfo> {
  try {
    const res = await fetch(`${API}/updates/latest`, {
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
    });
    if (!res.ok) throw new Error("Failed to query update endpoint");
    const data = await res.json();
    const hasUpdate = (data.url && data.url.trim().length > 0 && data.url.startsWith("http")) || isNewerVersion(data.version || "", CURRENT_APP_VERSION);
    return {
      version: data.version || CURRENT_APP_VERSION,
      url: data.url || "",
      checksum: data.checksum || "",
      hasUpdate: Boolean(hasUpdate),
    };
  } catch (e) {
    console.warn("Update check failed:", e);
    return {
      version: CURRENT_APP_VERSION,
      url: "",
      checksum: "",
      hasUpdate: false,
    };
  }
}

export function applyAppUpdate(updateUrl: string): void {
  if (!updateUrl) return;
  if (typeof window !== "undefined") {
    try {
      if ((window as any).FluxNativeBridge?.openDownloadUrl) {
        (window as any).FluxNativeBridge.openDownloadUrl(updateUrl);
        return;
      }
    } catch {}

    try {
      const a = document.createElement("a");
      a.href = updateUrl;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.download = "app-update.apk";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch {}

    try {
      window.location.href = updateUrl;
    } catch {
      window.open(updateUrl, "_system");
    }
  }
}
