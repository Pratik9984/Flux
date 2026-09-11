importScripts('https://www.gstatic.com/firebasejs/10.7.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.0/firebase-messaging-compat.js');

firebase.initializeApp({
    apiKey: "AIzaSyCaF27qAZr06JUfVfMzuMtzstv8dD4G3cI",
    authDomain: "pulse-chat-e74e4.firebaseapp.com",
    projectId: "pulse-chat-e74e4",
    storageBucket: "pulse-chat-e74e4.firebasestorage.app",
    messagingSenderId: "861770164749",
    appId: "1:861770164749:web:58f3342896bf6e27dd4344"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
    // If it's a silent data message (e.g. typing indicator, RTC signaling), do not show a notification
    if (!payload.notification || (!payload.notification.title && !payload.notification.body)) {
        console.log("Silent background message received, ignoring visual notification:", payload);
        return;
    }

    const data = payload.data || {};
    const isCall = data.type === 'call' || data.type === 'call_offer';

    let body = payload.notification?.body || '';
    if (body.startsWith('[ENC_IMAGE]') || body.startsWith('[IMAGE]')) body = '📷 Photo';
    else if (body.startsWith('[ENC_VIDEO]') || body.startsWith('[VIDEO]')) body = '🎥 Video';
    else if (body.startsWith('[ENC_AUDIO]') || body.startsWith('[AUDIO]')) body = '🎤 Voice message';
    else if (body.startsWith('[ENC_PDF]') || body.startsWith('[PDF]')) body = '📄 Document (PDF)';
    else if (body.startsWith('[ENC_FILE]') || body.startsWith('[FILE]')) body = '📎 Document';
    else if (body.includes('/files/')) {
        const lower = body.toLowerCase();
        if (lower.includes('.jpg') || lower.includes('.png') || lower.includes('.jpeg') || lower.includes('.webp')) body = '📷 Photo';
        else if (lower.includes('.mp4') || lower.includes('.webm') || lower.includes('.mov') || lower.includes('.3gp')) body = '🎥 Video';
        else if (lower.includes('.mp3') || lower.includes('.ogg') || lower.includes('.wav') || lower.includes('.m4a')) body = '🎤 Voice message';
        else if (lower.includes('.pdf')) body = '📄 Document (PDF)';
        else body = '📎 Document';
    }

    self.registration.showNotification(
        payload.notification?.title || 'Pulse',
        {
            body: body,
            icon: '/favicon.ico',
            tag: isCall ? 'incoming-call' : 'message-' + Date.now(),
            renotify: true,
            requireInteraction: isCall,
            vibrate: isCall ? [500, 300, 500, 300, 500] : [200],
            data: data,
            actions: isCall
                ? [{ action: 'accept', title: '✅ Accept' }, { action: 'reject', title: '❌ Reject' }]
                : [{ action: 'open', title: '💬 Open' }]
        }
    );
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const data = event.notification.data || {};
    const chatId = data.chatId || '';
    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
            if (event.action === 'reject') {
                // Pass callPeer so frontend can send call_reject to the correct user
                clients.forEach(c => c.postMessage({ type: 'REJECT_CALL', callPeer: data.user || '' }));
                return;
            }
            const app = clients.find(c => c.url.includes(self.location.origin));
            if (app) {
                app.focus();
                app.postMessage({ type: 'NOTIFICATION_CLICK', data: data });
            } else {
                const targetUrl = '/?openChat=' + encodeURIComponent(chatId);
                self.clients.openWindow(targetUrl);
            }
        })
    );
});