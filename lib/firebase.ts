import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app';
import type { Messaging } from 'firebase/messaging';
import { isNative, requestNotifyPermission as requestNativePermission } from './notifications';

const firebaseConfig = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

function getFirebaseApp(): FirebaseApp | null {
    if (typeof window === 'undefined') return null;
    try {
        return getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
    } catch (e) {
        console.warn('Firebase initializeApp warning:', e);
        return null;
    }
}

// Lazy safe getter for Messaging instance
let messagingInstance: Messaging | null = null;
let messagingInitPromise: Promise<Messaging | null> | null = null;

export async function getMessagingSafe(): Promise<Messaging | null> {
    if (typeof window === 'undefined') return null;
    if (messagingInstance) return messagingInstance;
    if (messagingInitPromise) return messagingInitPromise;

    messagingInitPromise = (async () => {
        try {
            const { isSupported, getMessaging } = await import('firebase/messaging');
            const supported = await isSupported().catch(() => false);
            if (!supported) {
                return null;
            }
            const app = getFirebaseApp();
            if (!app) return null;
            messagingInstance = getMessaging(app);
            return messagingInstance;
        } catch (err) {
            console.warn('Firebase messaging is not supported in this environment:', err);
            return null;
        }
    })();

    return messagingInitPromise;
}

// Safe fallback export for legacy references
export const messaging = null;

export const VAPID_KEY = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY;

/**
 * Unified FCM token requester: uses Native Capacitor Push Notifications on Android,
 * and Web Service Worker FCM on browser.
 */
export async function requestNotificationPermission(): Promise<string | null> {
    if (typeof window === 'undefined') return null;

    // 1. Try Native Capacitor Android Push first
    if (isNative()) {
        try {
            const nativeTok = await requestNativePermission();
            if (nativeTok) return nativeTok;
        } catch (err) {
            console.warn('Native push token error, attempting Web VAPID fallback:', err);
        }
    }

    // 2. Web Browser & Hybrid Fallback using Firebase VAPID Key
    try {
        if (typeof Notification === 'undefined') return null;
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') return null;

        const msg = await getMessagingSafe();
        if (!msg) return null;

        let sw: ServiceWorkerRegistration | undefined = undefined;
        if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
            sw = await navigator.serviceWorker.register('/firebase-messaging-sw.js').catch(() => undefined);
        }

        const { getToken } = await import('firebase/messaging');
        const token = await getToken(msg, {
            vapidKey: VAPID_KEY,
            serviceWorkerRegistration: sw,
        });

        if (token) {
            try { localStorage.setItem('flux_native_push_token', token); } catch {}
            return token;
        }
        return null;
    } catch (err) {
        console.warn('FCM token registration fallback error:', err);
        const cached = typeof window !== 'undefined' ? localStorage.getItem('flux_native_push_token') : null;
        return cached || null;
    }
}

/**
 * Sets up foreground FCM message handling and token refresh.
 * - onForegroundMessage: called when a push arrives while the app is in the foreground
 * - onTokenRefresh: called with the new token when FCM rotates it
 */
export function setupForegroundFCM(
    onForegroundMessage: (payload: any) => void,
    onTokenRefresh: (newToken: string) => void,
): (() => void) {
    let unsubMessage: (() => void) | null = null;
    let refreshInterval: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;

    if (isNative()) {
        // Native notifications are handled directly by @capacitor/push-notifications in initNotifications
        return () => {};
    }

    (async () => {
        try {
            const msg = await getMessagingSafe();
            if (!msg || cancelled) return;

            const { onMessage, getToken } = await import('firebase/messaging');

            unsubMessage = onMessage(msg, (payload) => {
                onForegroundMessage(payload);
            });

            let lastKnownToken: string | null = null;
            refreshInterval = setInterval(async () => {
                try {
                    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
                    const sw = await navigator.serviceWorker.ready;
                    const freshToken = await getToken(msg, {
                        vapidKey: VAPID_KEY,
                        serviceWorkerRegistration: sw,
                    });
                    if (freshToken && freshToken !== lastKnownToken) {
                        if (lastKnownToken !== null) {
                            onTokenRefresh(freshToken);
                        }
                        lastKnownToken = freshToken;
                    }
                } catch { }
            }, 30 * 60 * 1000);
        } catch (err) {
            console.warn('setupForegroundFCM warning:', err);
        }
    })();

    return () => {
        cancelled = true;
        if (unsubMessage) unsubMessage();
        if (refreshInterval) clearInterval(refreshInterval);
    };
}