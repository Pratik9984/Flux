// lib/permissions.ts
// Comprehensive startup permission requester for Flux (Android Native & Web)

import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Camera } from '@capacitor/camera';

/**
 * Requests all essential app permissions on app startup:
 * - Notifications (Android 13+ POST_NOTIFICATIONS & FCM)
 * - Microphone & Audio (WebRTC voice calls & voice notes)
 * - Camera (Video calls, photos, live scanning)
 * - Media & Photos storage
 */
export async function requestAllAppPermissions(): Promise<void> {
  if (typeof window === 'undefined') return;

  if (Capacitor.isNativePlatform()) {
    try {
      // 1. Notification Permissions (Local + Push)
      try {
        const notifStatus = await LocalNotifications.checkPermissions();
        if (notifStatus.display !== 'granted') {
          await LocalNotifications.requestPermissions();
        }
      } catch (e) {
        console.warn("LocalNotifications permission error:", e);
      }

      try {
        const pushStatus = await PushNotifications.checkPermissions();
        if (pushStatus.receive !== 'granted') {
          await PushNotifications.requestPermissions();
        }
        await PushNotifications.register().catch(() => {});
      } catch (e) {
        console.warn("PushNotifications permission error:", e);
      }

      // 2. Camera & Photo Permissions (Capacitor Native)
      try {
        const camStatus = await Camera.checkPermissions();
        if (camStatus.camera !== 'granted' || camStatus.photos !== 'granted') {
          await Camera.requestPermissions({ permissions: ['camera', 'photos'] });
        }
      } catch (e) {
        console.warn("Camera permission error:", e);
      }

      // 3. Audio / Microphone & Camera Native Permissions
      try {
        (window as any).FluxNativeBridge?.requestCallPermissions?.();
      } catch {}

      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        try {
          const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
          audioStream.getTracks().forEach(t => t.stop());
        } catch (e) {
          console.warn("Audio getUserMedia prompt handled:", e);
        }

        // 4. Video / Camera Permission (WebRTC video calls)
        try {
          const videoStream = await navigator.mediaDevices.getUserMedia({ video: true });
          videoStream.getTracks().forEach(t => t.stop());
        } catch (e) {
          console.warn("Video getUserMedia prompt handled:", e);
        }
      }
    } catch (e) {
      console.warn("requestAllAppPermissions global warning:", e);
    }
  } else {
    // Web Browser fallback
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      try {
        await Notification.requestPermission();
      } catch {}
    }
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ audio: true });
        s.getTracks().forEach(t => t.stop());
      } catch {}
    }
  }
}
