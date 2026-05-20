package com.example.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Notification;
import android.content.ContentResolver;
import android.content.Intent;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Register native plugin BEFORE super (required by Capacitor)
        registerPlugin(PulsePlugin.class);

        super.onCreate(savedInstanceState);
        createNotificationChannels();
        // Request USE_FULL_SCREEN_INTENT on Android 14+
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) { // API 34
            android.app.NotificationManager nm = getSystemService(android.app.NotificationManager.class);
            if (nm != null && !nm.canUseFullScreenIntent()) {
                Intent intent = new Intent(android.provider.Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT,
                    android.net.Uri.parse("package:" + getPackageName()));
                startActivity(intent);
            }
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        PulseBackgroundService svc = PulseBackgroundService.getInstance();
        if (svc != null) svc.setAppForeground(true);
        // Handle call accept from notification
        handleCallIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleCallIntent(intent);
    }

    private void handleCallIntent(Intent intent) {
        if (intent == null) return;
        String action = intent.getStringExtra("call_action");
        if (!"accept".equals(action)) return;
        intent.removeExtra("call_action");

        String offerData = intent.getStringExtra("call_offer_data");
        if (offerData == null || offerData.isEmpty()) {
            try {
                offerData = getSharedPreferences("pulse_call", MODE_PRIVATE)
                    .getString("pending_offer", "");
            } catch (Exception e) { offerData = ""; }
        }
        final String finalOffer = offerData;
        dispatchAcceptWithRetry(finalOffer, 0);
    }

    private void dispatchAcceptWithRetry(String offerData, int attempt) {
        if (attempt > 20) return; // give up after 10 s
        String safe = offerData.replace("\\", "\\\\").replace("'", "\\'")
                               .replace("\n", "").replace("\r", "");
        String js =
            "(function(){" +
            "  if(!window.__FluxReady){return 'notready';}" +
            "  window.dispatchEvent(new CustomEvent('FluxCallAction'," +
            "    {detail:{action:'accept',offerData:'" + safe + "'}}));" +
            "  return 'ok';" +
            "})()";

        if (getBridge() == null || getBridge().getWebView() == null) {
            retryDispatch(offerData, attempt);
            return;
        }
        getBridge().getWebView().post(() ->
            getBridge().getWebView().evaluateJavascript(js, result -> {
                if (!"\"ok\"".equals(result)) {
                    // React not mounted yet — retry after 500ms
                    retryDispatch(offerData, attempt);
                } else {
                    // Success — clear pending flag
                    getSharedPreferences("pulse_call", MODE_PRIVATE)
                        .edit().remove("pending_accept").apply();
                }
            })
        );
    }

    private void retryDispatch(String offerData, int attempt) {
        new android.os.Handler(android.os.Looper.getMainLooper())
            .postDelayed(() -> dispatchAcceptWithRetry(offerData, attempt + 1), 500);
    }

    @Override
    public void onPause() {
        super.onPause();
        PulseBackgroundService svc = PulseBackgroundService.getInstance();
        if (svc != null) svc.setAppForeground(false);
    }

    private void createNotificationChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;

        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null) return;

        // Delete stale channels so sound settings are never stuck from a previous install
        manager.deleteNotificationChannel("flux_messages");
        manager.deleteNotificationChannel("flux_calls");
        // Do NOT recreate flux_messages_v2 / flux_calls_v2 here
    }
}