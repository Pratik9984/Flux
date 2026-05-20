
import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";

const UPDATE_URL = `${process.env.NEXT_PUBLIC_API_URL}/updates/latest`;

interface UpdateInfo {
  version: string;
  url: string;
  checksum: string;
}

export async function initOTAUpdater() {
  if (!Capacitor.isNativePlatform()) return;

  // Tell the plugin the current bundle loaded successfully
  await CapacitorUpdater.notifyAppReady();

  try {
    // Fetch update info directly via GET (the native getLatest() sends POST
    // which our backend doesn't support — using fetch avoids this issue)
    const res = await fetch(UPDATE_URL);
    if (!res.ok) {
      console.warn("[OTA] Update check returned", res.status);
      return;
    }

    const latest: UpdateInfo = await res.json();

    if (!latest?.url) {
      console.log("[OTA] No update URL configured on server");
      return;
    }

    const current = await CapacitorUpdater.current();
    const currentVersion = current?.bundle?.version || "builtin";

    console.log("[OTA] Current:", currentVersion, "| Server:", latest.version);

    if (currentVersion === latest.version) {
      console.log("[OTA] Already up to date:", latest.version);
      return;
    }

    console.log("[OTA] New version available:", latest.version, "— downloading…");

    const bundle = await CapacitorUpdater.download({
      url: latest.url,
      version: latest.version,
    });

    console.log("[OTA] Download complete, bundle id:", bundle.id);

    // Apply when user backgrounds the app — no jarring mid-session reload
    const sub = await App.addListener("appStateChange", async ({ isActive }) => {
      if (!isActive) {
        try {
          console.log("[OTA] Applying update…");
          await CapacitorUpdater.set({ id: bundle.id });
        } catch (e) {
          console.warn("[OTA] Apply failed:", e);
        } finally {
          sub.remove();
        }
      }
    });
  } catch (e) {
    // Non-fatal — app works fine on old bundle
    console.warn("[OTA] Update check failed:", e);
  }
}
