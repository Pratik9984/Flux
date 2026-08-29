// lib/notifications.ts
// Standard browser Web Notification API utilities for Pulse Web

export async function requestNotifyPermission(): Promise<void> {
  if (typeof window === "undefined" || typeof Notification === "undefined") return;
  try {
    if (Notification.permission === "default") {
      await Notification.requestPermission();
    }
  } catch (e) {
    console.warn("Notification permission request failed", e);
  }
}

export async function showLocalNotification(title: string, body: string, chatId?: string): Promise<void> {
  if (typeof window === "undefined" || typeof Notification === "undefined") return;
  if (Notification.permission === "granted") {
    try {
      const notif = new Notification(title, {
        body,
        icon: "/icon.png",
        data: { chatId },
      });
      if (chatId) {
        notif.onclick = () => {
          window.focus();
        };
      }
    } catch (e) {
      console.warn("showLocalNotification failed", e);
    }
  }
}

export async function showCallNotification(title: string, body: string, _offerJson = ""): Promise<void> {
  if (typeof window === "undefined" || typeof Notification === "undefined") return;
  if (Notification.permission === "granted") {
    try {
      new Notification(title, {
        body,
        icon: "/icon.png",
        requireInteraction: true,
      } as NotificationOptions);
    } catch (e) {
      console.warn("showCallNotification failed", e);
    }
  }
}

export async function cancelCallNotification(): Promise<void> {
  // Web browser notifications auto-dismiss or can be closed by user
}
