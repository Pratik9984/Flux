// lib/notifications.ts
// Unified Push and Local Notification Manager for Pulse (Web + Android Capacitor)

import { Capacitor } from '@capacitor/core';
import { PushNotifications, type ActionPerformed, type PushNotificationSchema, type Token } from '@capacitor/push-notifications';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Haptics } from '@capacitor/haptics';

export const CALL_NOTIFICATION_ID = 99999;
export const CALLS_CHANNEL_ID = 'flux_calls_v2';
export const MESSAGES_CHANNEL_ID = 'flux_messages_v2';

export const isNative = (): boolean => {
  return typeof window !== 'undefined' && Capacitor.isNativePlatform();
};

let isInitialized = false;
let nativePushToken: string | null = null;
let tokenResolveCallback: ((token: string) => void) | null = null;

/**
 * Initializes notification channels and listeners on native Android or Web.
 */
export async function initNotifications(callbacks?: {
  onTokenReceived?: (token: string) => void;
  onCallAccepted?: (data: any) => void;
  onCallRejected?: (data: any) => void;
  onChatOpened?: (chatId: string) => void;
  onNotificationReceived?: (notification: any) => void;
}): Promise<void> {
  if (typeof window === 'undefined') return;

  if (isNative()) {
    if (isInitialized) return;
    isInitialized = true;

    try {
      // 1. Create channels on Android matching backend FCM_CHANNEL_CALLS & FCM_CHANNEL_MESSAGES
      await LocalNotifications.createChannel({
        id: CALLS_CHANNEL_ID,
        name: 'Incoming Calls',
        description: 'Incoming voice and video call alerts with ringtone',
        importance: 5, // MAX importance
        visibility: 1, // Public
        sound: 'ringtone.mp3',
        vibration: true,
        lights: true,
        lightColor: '#25d366',
      }).catch((e) => console.warn('Call channel creation warning:', e));

      await LocalNotifications.createChannel({
        id: MESSAGES_CHANNEL_ID,
        name: 'Messages & Chats',
        description: 'New chat messages and notifications',
        importance: 4, // HIGH importance
        visibility: 0, // Private
        sound: 'notification.mp3',
        vibration: true,
        lights: true,
        lightColor: '#25d366',
      }).catch((e) => console.warn('Message channel creation warning:', e));

      // Also create legacy channel IDs for backward compatibility
      await LocalNotifications.createChannel({
        id: 'pulse_calls_channel',
        name: 'Flux Calls',
        description: 'Voice and video call alerts',
        importance: 5,
        visibility: 1,
        sound: 'ringtone.mp3',
        vibration: true,
      }).catch(() => {});

      await LocalNotifications.createChannel({
        id: 'pulse_messages_channel',
        name: 'Flux Messages',
        description: 'Chat messages',
        importance: 4,
        visibility: 0,
        sound: 'notification.mp3',
        vibration: true,
      }).catch(() => {});

      // 2. Register local notification action types for incoming call
      await LocalNotifications.registerActionTypes({
        types: [
          {
            id: 'INCOMING_CALL',
            actions: [
              { id: 'accept', title: '✅ Accept', foreground: true },
              { id: 'reject', title: '❌ Decline', destructive: true, foreground: false },
            ],
          },
        ],
      }).catch((e) => console.warn('Register action types warning:', e));

      // 3. Listen to Local Notification clicks
      LocalNotifications.addListener('localNotificationActionPerformed', (notificationAction) => {
        const actionId = notificationAction.actionId;
        const extra = notificationAction.notification.extra || {};
        cancelCallNotification();
        if (notificationAction.notification.id === CALL_NOTIFICATION_ID) {
          if (actionId === 'accept') {
            callbacks?.onCallAccepted?.(extra);
          } else if (actionId === 'reject') {
            callbacks?.onCallRejected?.(extra);
          } else {
            // Tapped body of call notification
            callbacks?.onCallAccepted?.(extra);
          }
        } else if (extra.chatId) {
          callbacks?.onChatOpened?.(String(extra.chatId));
        }
      });

      // 4. Push notification listeners
      PushNotifications.addListener('registration', (token: Token) => {
        nativePushToken = token.value;
        if (typeof window !== 'undefined') {
          try { localStorage.setItem('flux_native_push_token', token.value); } catch {}
        }
        if (tokenResolveCallback) {
          tokenResolveCallback(token.value);
          tokenResolveCallback = null;
        }
        callbacks?.onTokenReceived?.(token.value);
      });

      PushNotifications.addListener('registrationError', (error: any) => {
        console.warn('Native push registration error:', error);
      });

      PushNotifications.addListener('pushNotificationReceived', (notification: PushNotificationSchema) => {
        const data = notification.data || {};
        callbacks?.onNotificationReceived?.(notification);

        if (data.type === 'call' || data.call_offer) {
          // Trigger high-priority heads-up call banner
          showCallNotification(notification.title || 'Incoming Call', notification.body || 'Call ringing...', data);
        } else {
          // Schedule local notification so chat message pops up reliably
          showLocalNotification(
            notification.title || data.title || 'Flux',
            notification.body || data.body || notification.data?.message || 'New message received',
            data.chatId ? String(data.chatId) : undefined
          );
        }
      });

      PushNotifications.addListener('pushNotificationActionPerformed', (action: ActionPerformed) => {
        const data = action.notification.data || {};
        cancelCallNotification();
        if (data.type === 'call') {
          if (action.actionId === 'reject') {
            callbacks?.onCallRejected?.(data);
          } else {
            callbacks?.onCallAccepted?.(data);
          }
        } else if (data.chatId) {
          callbacks?.onChatOpened?.(String(data.chatId));
        }
      });

      // Automatically register for push tokens if permissions are already present
      PushNotifications.register().catch(() => {});
    } catch (e) {
      console.warn('initNotifications native failed:', e);
    }
  }
}

/**
 * Dismisses/clears all delivered notifications from the notification tray.
 * Called on app launch, app resume, or when a chat is opened.
 */
export async function clearAllDeliveredNotifications(): Promise<void> {
  if (typeof window === 'undefined') return;
  if (isNative()) {
    try {
      await LocalNotifications.removeAllDeliveredNotifications();
    } catch (e) {
      console.warn('LocalNotifications removeAllDeliveredNotifications error:', e);
    }
    try {
      await PushNotifications.removeAllDeliveredNotifications();
    } catch (e) {
      console.warn('PushNotifications removeAllDeliveredNotifications error:', e);
    }
  }
}

/**
 * Requests Notification Permissions (both Web and Android 13+).
 */
export async function requestNotifyPermission(): Promise<string | null> {
  if (typeof window === 'undefined') return null;

  if (isNative()) {
    try {
      const localPerm = await LocalNotifications.requestPermissions();
      const pushPerm = await PushNotifications.requestPermissions();

      if (pushPerm.receive === 'granted' || localPerm.display === 'granted') {
        await PushNotifications.register().catch(() => {});
        if (nativePushToken) return nativePushToken;

        const cached = typeof window !== 'undefined' ? localStorage.getItem('flux_native_push_token') : null;
        if (cached) {
          nativePushToken = cached;
          return cached;
        }

        return new Promise<string | null>((resolve) => {
          tokenResolveCallback = resolve;
          setTimeout(() => {
            const fallbackToken = nativePushToken || (typeof window !== 'undefined' ? localStorage.getItem('flux_native_push_token') : null);
            resolve(fallbackToken);
          }, 4000);
        });
      }
      return null;
    } catch (e) {
      console.warn('Native notification permission error:', e);
      return null;
    }
  }

  // Web Browser fallback
  if (typeof Notification !== 'undefined') {
    try {
      if (Notification.permission === 'default') {
        const perm = await Notification.requestPermission();
        return perm === 'granted' ? 'granted' : null;
      }
      return Notification.permission === 'granted' ? 'granted' : null;
    } catch (e) {
      console.warn('Web notification permission failed:', e);
    }
  }
  return null;
}

export function formatNotificationBody(raw: string): string {
  if (!raw) return "New message";
  const s = raw.trim();
  if (s.startsWith("[ENC_IMAGE]") || s.startsWith("[IMAGE]")) return "📷 Photo";
  if (s.startsWith("[ENC_VIDEO]") || s.startsWith("[VIDEO]")) return "🎥 Video";
  if (s.startsWith("[ENC_AUDIO]") || s.startsWith("[AUDIO]")) return "🎤 Voice message";
  if (s.startsWith("[ENC_PDF]") || s.startsWith("[PDF]")) return "📄 Document (PDF)";
  if (s.startsWith("[ENC_FILE]") || s.startsWith("[FILE]")) return "📎 Document";
  if (s.includes("/files/")) {
    const lower = s.toLowerCase();
    if (lower.includes(".jpg") || lower.includes(".png") || lower.includes(".jpeg") || lower.includes(".webp")) return "📷 Photo";
    if (lower.includes(".mp4") || lower.includes(".webm") || lower.includes(".mov") || lower.includes(".3gp")) return "🎥 Video";
    if (lower.includes(".mp3") || lower.includes(".ogg") || lower.includes(".wav") || lower.includes(".m4a")) return "🎤 Voice message";
    if (lower.includes(".pdf")) return "📄 Document (PDF)";
    return "📎 Document";
  }
  return s;
}

/**
 * Displays a local chat message notification with sound & vibration.
 */
export async function showLocalNotification(title: string, body: string, chatId?: string): Promise<void> {
  if (typeof window === 'undefined') return;
  const cleanBody = formatNotificationBody(body);

  if (isNative()) {
    try {
      const notifId = Math.floor(Math.random() * 900000) + 1000;
      await LocalNotifications.schedule({
        notifications: [
          {
            id: notifId,
            title: title || 'Pulse',
            body: cleanBody,
            channelId: MESSAGES_CHANNEL_ID,
            sound: 'notification.mp3',
            extra: { chatId },
          },
        ],
      });
      try { await Haptics.vibrate({ duration: 150 }); } catch {}
      return;
    } catch (e) {
      console.warn('Native showLocalNotification failed:', e);
    }
  }

  // Web Browser fallback
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    try {
      const notif = new Notification(title || 'Flux', {
        body,
        icon: '/icon.png',
        data: { chatId },
      });
      if (chatId) {
        notif.onclick = () => {
          window.focus();
        };
      }
    } catch (e) {
      console.warn('Web showLocalNotification failed:', e);
    }
  }
}

/**
 * Displays an incoming call notification (Heads-up banner + ringtone + buttons).
 */
export async function showCallNotification(title: string, body: string, extraData: any = {}): Promise<void> {
  if (typeof window === 'undefined') return;

  // Trigger device vibration
  startVibrationPattern([0, 1000, 1000, 1000, 1000, 1000]);

  if (isNative()) {
    try {
      await LocalNotifications.schedule({
        notifications: [
          {
            id: CALL_NOTIFICATION_ID,
            title: title || 'Incoming Call',
            body: body || 'Incoming Voice / Video Call',
            channelId: CALLS_CHANNEL_ID,
            sound: 'ringtone.mp3',
            ongoing: true,
            autoCancel: false,
            actionTypeId: 'INCOMING_CALL',
            extra: extraData,
          },
        ],
      });
      return;
    } catch (e) {
      console.warn('Native showCallNotification failed:', e);
    }
  }

  // Web Browser fallback
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    try {
      new Notification(title || 'Incoming Call', {
        body: body || 'Tap to answer call',
        icon: '/icon.png',
        requireInteraction: true,
        tag: 'pulse-incoming-call',
        data: extraData,
      } as NotificationOptions);
    } catch (e) {
      console.warn('Web showCallNotification failed:', e);
    }
  }
}

/**
 * Dismisses the active incoming call notification and stops vibration.
 */
export async function cancelCallNotification(): Promise<void> {
  stopVibration();

  if (isNative()) {
    try {
      await LocalNotifications.cancel({
        notifications: [{ id: CALL_NOTIFICATION_ID }],
      }).catch(() => {});

      await LocalNotifications.removeAllDeliveredNotifications().catch(() => {});
      await PushNotifications.removeAllDeliveredNotifications().catch(() => {});
    } catch (e) {
      console.warn('Native cancelCallNotification failed:', e);
    }
  }
}

/**
 * Starts device vibration pattern for calls or alerts.
 */
export async function startVibrationPattern(pattern: number[] = [0, 800, 800, 800]): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    if (isNative()) {
      await Haptics.vibrate({ duration: 1000 });
    } else if (navigator.vibrate) {
      navigator.vibrate(pattern);
    }
  } catch {
    // Ignore vibration errors
  }
}

/**
 * Stops device vibration.
 */
export function stopVibration(): void {
  if (typeof window !== 'undefined' && navigator.vibrate) {
    try {
      navigator.vibrate(0);
    } catch {}
  }
}
