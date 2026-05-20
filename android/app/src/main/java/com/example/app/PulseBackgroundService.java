package com.example.app;

import android.app.*;
import android.content.BroadcastReceiver;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.media.*;
import android.net.Uri;
import android.os.*;
import androidx.core.app.NotificationCompat;
import com.neovisionaries.ws.client.*;
import org.json.JSONObject;
import java.util.List;
import java.util.Map;
import java.util.Timer;
import java.util.TimerTask;

public class PulseBackgroundService extends Service {

    private static final String FG_CHANNEL    = "pulse_fg";
    private static final int    FG_NOTIF_ID   = 1;
    private static final int    CALL_NOTIF_ID = 999;

    public static final String ACTION_ACCEPT  = "com.example.app.ACCEPT_CALL";
    public static final String ACTION_DECLINE = "com.example.app.DECLINE_CALL";

    private static PulseBackgroundService instance;
    public  static PulseBackgroundService getInstance() { return instance; }

    private WebSocket ws;
    private Ringtone  ringtone;
    private String    wsUrl;
    private String    token;
    private boolean   appForeground = false;
    private Timer     reconnectTimer;
    private String    lastCallerEmail; // track who is calling for reject signal
    private volatile boolean callInProgress = false;

    // ── Broadcast receiver for Accept/Decline actions ──────────────────────

    public static class CallActionReceiver extends BroadcastReceiver {
        @Override
        public void onReceive(Context context, Intent intent) {
            PulseBackgroundService svc = getInstance();
            if (svc == null) return;

            String action = intent.getAction();
            if (ACTION_ACCEPT.equals(action)) {
                // Stop ringtone + dismiss notification, then bring app to foreground
                svc.stopCall();
                
                // Store accept flag + offer so JS can read it after mounting
                SharedPreferences prefs = context.getSharedPreferences("pulse_call", Context.MODE_PRIVATE);
                String offerData = intent.getStringExtra("call_offer_data");
                if (offerData == null || offerData.isEmpty()) {
                    offerData = prefs.getString("pending_offer", "");
                }
                prefs.edit()
                    .putString("pending_offer", offerData)
                    .putBoolean("pending_accept", true)   // ← NEW FLAG
                    .commit();

                Intent launch = new Intent(context, MainActivity.class);
                launch.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
                launch.putExtra("call_action", "accept");
                launch.putExtra("call_offer_data", offerData);
                context.startActivity(launch);
            } else if (ACTION_DECLINE.equals(action)) {
                // Send reject signal via WS and stop everything
                svc.declineCall();
            }
        }
    }

    // ── Lifecycle ──────────────────────────────────────────────────────────

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        createNotificationChannels();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null) {
            String newToken = intent.getStringExtra("token");
            String newWsUrl = intent.getStringExtra("ws_url");
            if (newToken != null) token = newToken;
            if (newWsUrl != null) wsUrl = newWsUrl;
            if (token != null && wsUrl != null) {
                startForeground(FG_NOTIF_ID, buildFgNotification());
                // Only connect native WS if app is in background
                // (when foreground, the frontend JS WebSocket handles everything)
                if (!appForeground && (ws == null || !ws.isOpen())) {
                    connectWS();
                }
            }
        }
        return START_STICKY;
    }

    @Override public IBinder onBind(Intent i) { return null; }

    @Override
    public void onDestroy() {
        instance = null;
        cancelReconnect();
        disconnectWS();
        stopRingtone();
        super.onDestroy();
    }

    // ── Public API ─────────────────────────────────────────────────────────

    public void setAppForeground(boolean fg) {
        this.appForeground = fg;
        if (fg) {
            // App is in foreground — frontend JS WebSocket takes over.
            // Disconnect service WS to avoid fighting for the same socket slot.
            cancelReconnect();
            disconnectWS();
        } else {
            // App went to background — service WS takes over for notifications.
            if (token != null && wsUrl != null && (ws == null || !ws.isOpen())) {
                connectWS();
            }
        }
    }

    public void stopCall() {
        callInProgress = false;
        stopRingtone();
        lastCallerEmail = null;
        getSystemService(NotificationManager.class).cancel(CALL_NOTIF_ID);
    }

    public void declineCall() {
        // Send call_reject over WS
        if (lastCallerEmail != null && ws != null && ws.isOpen()) {
            try {
                JSONObject reject = new JSONObject();
                reject.put("type", "call_reject");
                reject.put("target_user", lastCallerEmail);
                ws.sendText(reject.toString());
            } catch (Exception ignored) {}
        }
        stopCall();
        clearPendingOffer();
    }

    private void clearPendingOffer() {
        try {
            getSharedPreferences("pulse_call", MODE_PRIVATE)
                .edit().remove("pending_offer").commit();
        } catch (Exception ignored) {}
    }

    // ── WebSocket ──────────────────────────────────────────────────────────

    private void connectWS() {
        disconnectWS(); // clean up any old socket
        if (token == null || wsUrl == null) return;
        try {
            String url = wsUrl.replaceFirst("^http", "ws") + "/ws?token=" + token;

            ws = new WebSocketFactory()
                    .setConnectionTimeout(10000)
                    .createSocket(url)
                    .setPingInterval(25 * 1000)
                    .addListener(new WebSocketAdapter() {

                        @Override
                        public void onConnected(WebSocket s,
                                Map<String, List<String>> headers) {
                            cancelReconnect();
                            // If a previous call was in progress when WS dropped, reset the flag.
                            // The caller would have given up by now.
                            callInProgress = false;
                        }

                        @Override
                        public void onTextMessage(WebSocket s, String text) {
                            try {
                                JSONObject d    = new JSONObject(text);
                                String     type = d.optString("type");

                                switch (type) {
                                    case "direct_message":
                                    case "group_message": {
                                        if (appForeground) break;
                                        String sender  = d.optString("sender_name", "New message");
                                        String content = d.optString("content", "");
                                        if (content.startsWith("[")) content = "📎 Attachment";
                                        showMsgNotification(sender, content);
                                        break;
                                    }
                                    case "call_offer": {
                                        if (callInProgress) break; // drop duplicate
                                        callInProgress = true;
                                        clearPendingOffer(); // wipe stale offer before processing the new one
                                        String  caller  = d.optString("sender_name", "Incoming call");
                                        String  callerEmail = d.optString("user", "");
                                        boolean isVideo = d.optBoolean("isVideo", false);
                                        lastCallerEmail = callerEmail;
                                        String offerJson = "";
                                        // Save full offer data so frontend can restore SDP on accept
                                        try {
                                            JSONObject offerData = new JSONObject();
                                            offerData.put("peer", callerEmail);
                                            offerData.put("peerName", caller);
                                            offerData.put("isVideo", isVideo);
                                            if (d.has("sdp")) {
                                                Object sdpObj = d.get("sdp");
                                                offerData.put("sdp", sdpObj);
                                                if (sdpObj instanceof org.json.JSONObject) {
                                                    org.json.JSONObject sdpJson = (org.json.JSONObject) sdpObj;
                                                    if (sdpJson.has("group_id")) {
                                                        offerData.put("group_id", sdpJson.get("group_id"));
                                                    }
                                                } else if (sdpObj instanceof String) {
                                                    try {
                                                        org.json.JSONObject sdpJson = new org.json.JSONObject((String) sdpObj);
                                                        if (sdpJson.has("group_id")) {
                                                            offerData.put("group_id", sdpJson.get("group_id"));
                                                        }
                                                    } catch (Exception ignored) {}
                                                }
                                            }
                                            if (d.has("group_id")) {
                                                offerData.put("group_id", d.get("group_id"));
                                            }
                                            offerJson = offerData.toString();
                                            SharedPreferences prefs = getSharedPreferences("pulse_call", MODE_PRIVATE);
                                            prefs.edit().putString("pending_offer", offerJson).commit(); // sync write
                                        } catch (Exception ignored) {}
                                        showCallNotification(caller, isVideo, offerJson);
                                        startRingtone();
                                        break;
                                    }
                                    case "call_end":
                                    case "call_reject":
                                        stopCall();
                                        clearPendingOffer();
                                        break;
                                }
                            } catch (Exception ignored) {}
                        }

                        @Override
                        public void onDisconnected(WebSocket s,
                                WebSocketFrame serverCloseFrame,
                                WebSocketFrame clientCloseFrame,
                                boolean closedByServer) {
                            scheduleReconnect();
                        }

                        @Override
                        public void onError(WebSocket s, WebSocketException ex) {
                            // onDisconnected will also fire, so don't double-schedule
                        }
                    })
                    .connectAsynchronously();

        } catch (Exception e) {
            scheduleReconnect();
        }
    }

    private void disconnectWS() {
        if (ws != null) {
            try { ws.disconnect(); } catch (Exception ignored) {}
            ws = null;
        }
    }

    // ── Reconnect logic ────────────────────────────────────────────────────

    private void scheduleReconnect() {
        cancelReconnect();
        // Do not schedule reconnect if app is in foreground
        if (appForeground) return;
        
        reconnectTimer = new Timer();
        reconnectTimer.schedule(new TimerTask() {
            @Override public void run() { 
                if (!appForeground) connectWS(); 
            }
        }, 5000); // retry after 5 seconds (fixed, no exponential backoff)
    }

    private void cancelReconnect() {
        if (reconnectTimer != null) {
            reconnectTimer.cancel();
            reconnectTimer = null;
        }
    }

    // ── Notifications ──────────────────────────────────────────────────────

    private void showMsgNotification(String title, String body) {
        Intent tapIntent = new Intent(this, MainActivity.class);
        tapIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(
            this, 0, tapIntent,
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);

        Notification n = new NotificationCompat.Builder(this, "flux_messages_v2")
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title)
            .setContentText(body)
            .setContentIntent(pi)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .build();

        getSystemService(NotificationManager.class)
            .notify((int) System.currentTimeMillis(), n);
    }

    public void startRingtonePublic() {
        startRingtone();
    }

    public void showCallNotification(String caller, boolean isVideo, String offerJson) {
        // Tap → open app with call offer data
        Intent tapIntent = new Intent(this, MainActivity.class);
        tapIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        tapIntent.putExtra("call_action", "accept");
        tapIntent.putExtra("call_offer_data", offerJson); // use param, not prefs re-read

        PendingIntent tapPi = PendingIntent.getActivity(
            this, 1, tapIntent,
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);

        // Accept button
        Intent acceptIntent = new Intent(this, CallActionReceiver.class);
        acceptIntent.setAction(ACTION_ACCEPT);
        acceptIntent.putExtra("call_offer_data", offerJson); // ADD THIS
        PendingIntent acceptPi = PendingIntent.getBroadcast(
            this, 2, acceptIntent,
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);

        // Decline button
        Intent declineIntent = new Intent(this, CallActionReceiver.class);
        declineIntent.setAction(ACTION_DECLINE);
        PendingIntent declinePi = PendingIntent.getBroadcast(
            this, 3, declineIntent,
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);

        Notification n = new NotificationCompat.Builder(this, "flux_calls_v2")
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(isVideo ? "📹 Incoming Video Call" : "📞 Incoming Voice Call")
            .setContentText(caller + " is calling…")
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setFullScreenIntent(tapPi, true)
            .setOngoing(true)
            .build();

        getSystemService(NotificationManager.class).notify(CALL_NOTIF_ID, n);
    }

    // ── WakeLock ───────────────────────────────────────────────────────────

    private PowerManager.WakeLock callWakeLock;

    private void acquireCallWakeLock() {
        if (callWakeLock != null && callWakeLock.isHeld()) return;
        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        if (pm == null) return;
        callWakeLock = pm.newWakeLock(
            PowerManager.PARTIAL_WAKE_LOCK | PowerManager.ACQUIRE_CAUSES_WAKEUP,
            "flux:incoming_call"
        );
        callWakeLock.acquire(60_000L); // auto-release after 60s max
    }

    private void releaseCallWakeLock() {
        if (callWakeLock != null && callWakeLock.isHeld()) {
            callWakeLock.release();
        }
        callWakeLock = null;
    }

    // ── Ringtone ───────────────────────────────────────────────────────────

    private void startRingtone() {
        acquireCallWakeLock();
        stopRingtone();
        
        SharedPreferences prefs = getSharedPreferences("pulse_settings", MODE_PRIVATE);
        String ringtoneName = prefs.getString("ringtone_name", "ringtone");
        
        Uri uri = Uri.parse(ContentResolver.SCHEME_ANDROID_RESOURCE
            + "://" + getPackageName() + "/raw/" + ringtoneName);
        ringtone = RingtoneManager.getRingtone(this, uri);
        if (ringtone == null) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) ringtone.setLooping(true);
        ringtone.play();
    }

    private void stopRingtone() {
        releaseCallWakeLock();
        if (ringtone != null) {
            if (ringtone.isPlaying()) ringtone.stop();
            ringtone = null;
        }
    }

    // ── Notification channels ──────────────────────────────────────────────

    private void createNotificationChannels() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = getSystemService(NotificationManager.class);

            // Foreground / connection channel (silent)
            NotificationChannel fg = new NotificationChannel(
                FG_CHANNEL, "Connection", NotificationManager.IMPORTANCE_LOW);
            fg.setSound(null, null);
            fg.setShowBadge(false);
            nm.createNotificationChannel(fg);

            // Messages channel
            if (nm.getNotificationChannel("flux_messages_v2") == null) {
                NotificationChannel msg = new NotificationChannel(
                    "flux_messages_v2", "Messages", NotificationManager.IMPORTANCE_HIGH);
                msg.enableVibration(true);
                msg.setVibrationPattern(new long[]{0, 250});
                msg.setLockscreenVisibility(android.app.Notification.VISIBILITY_PRIVATE);
                Uri msgSound = Uri.parse(ContentResolver.SCHEME_ANDROID_RESOURCE
                    + "://" + getPackageName() + "/raw/notification");
                msg.setSound(msgSound, new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build());
                nm.createNotificationChannel(msg);
            }

            // Calls channel
            if (nm.getNotificationChannel("flux_calls_v2") == null) {
                NotificationChannel calls = new NotificationChannel(
                    "flux_calls_v2", "Incoming Calls", NotificationManager.IMPORTANCE_MAX);
                calls.enableVibration(true);
                calls.setVibrationPattern(new long[]{0, 500, 300, 500, 300, 500});
                calls.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);
                calls.setBypassDnd(true);
                Uri callSound = Uri.parse(ContentResolver.SCHEME_ANDROID_RESOURCE
                    + "://" + getPackageName() + "/raw/ringtone");
                calls.setSound(callSound, new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build());
                nm.createNotificationChannel(calls);
            }
        }
    }

    private Notification buildFgNotification() {
        return new NotificationCompat.Builder(this, FG_CHANNEL)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle("Flux")
            .setContentText("")
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .setVisibility(NotificationCompat.VISIBILITY_SECRET)
            .setSilent(true)
            .setOngoing(true)
            .build();
    }
}