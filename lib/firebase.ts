import { initializeApp, getApps } from 'firebase/app';
import { getMessaging, getToken, onMessage } from 'firebase/messaging';

const firebaseConfig = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];

export const messaging = typeof window !== 'undefined' ? getMessaging(app) : null;

export const VAPID_KEY = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY;

export async function requestNotificationPermission(): Promise<string | null> {
    if (!messaging) return null;

    try {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') return null;

        // Register service worker first
        const sw = await navigator.serviceWorker.register('/firebase-messaging-sw.js');

        const token = await getToken(messaging, {
            vapidKey: VAPID_KEY,
            serviceWorkerRegistration: sw,
        });

        return token;
    } catch (err) {
        console.error('FCM token error:', err);
        return null;
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
): (() => void) | null {
    if (!messaging) return null;

    // Listen for foreground push messages
    const unsubMessage = onMessage(messaging, (payload) => {
        onForegroundMessage(payload);
    });

    // Periodically check for token refresh (FCM doesn't have a dedicated onTokenRefresh event in v9+)
    // Re-fetch token every 30 minutes; if it changed, notify the caller
    let lastKnownToken: string | null = null;
    const refreshInterval = setInterval(async () => {
        try {
            const sw = await navigator.serviceWorker.ready;
            const freshToken = await getToken(messaging!, {
                vapidKey: VAPID_KEY,
                serviceWorkerRegistration: sw,
            });
            if (freshToken && freshToken !== lastKnownToken) {
                if (lastKnownToken !== null) {
                    // Token actually changed (not initial fetch)
                    onTokenRefresh(freshToken);
                }
                lastKnownToken = freshToken;
            }
        } catch { }
    }, 30 * 60 * 1000);

    return () => {
        unsubMessage();
        clearInterval(refreshInterval);
    };
}

export { onMessage };