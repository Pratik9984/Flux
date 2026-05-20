package com.example.app;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.media.AudioManager;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "FluxNative")
public class PulsePlugin extends Plugin {

    @PluginMethod
    public void startService(PluginCall call) {
        String token = call.getString("token", "");
        String wsUrl = call.getString("wsUrl", "");
        if (token == null || token.isEmpty() || wsUrl == null || wsUrl.isEmpty()) {
            call.reject("token and wsUrl required");
            return;
        }
        try {
            Intent i = new Intent(getContext(), PulseBackgroundService.class);
            i.putExtra("token", token);
            i.putExtra("ws_url", wsUrl);
            getContext().startForegroundService(i);
        } catch (Exception e) {
            // Some OEMs (Samsung, Xiaomi) may block foreground services — don't crash
            android.util.Log.w("PulsePlugin", "Could not start foreground service: " + e.getMessage());
        }
        call.resolve();
    }

    @PluginMethod
    public void stopService(PluginCall call) {
        getContext().stopService(new Intent(getContext(), PulseBackgroundService.class));
        call.resolve();
    }

    @PluginMethod
    public void setForeground(PluginCall call) {
        boolean fg = call.getBoolean("foreground", true);
        PulseBackgroundService svc = PulseBackgroundService.getInstance();
        if (svc != null) svc.setAppForeground(fg);
        call.resolve();
    }

    @PluginMethod
    public void stopCall(PluginCall call) {
        PulseBackgroundService svc = PulseBackgroundService.getInstance();
        if (svc != null) svc.stopCall();
        call.resolve();
    }

    @PluginMethod
    public void showCallNotif(PluginCall call) {
        String caller = call.getString("caller", "Incoming call");
        boolean isVideo = Boolean.TRUE.equals(call.getBoolean("isVideo", false));
        String offerJson = call.getString("offerData", "");
        PulseBackgroundService svc = PulseBackgroundService.getInstance();
        if (svc != null) {
            svc.showCallNotification(caller, isVideo, offerJson);
            svc.startRingtonePublic(); // expose startRingtone as package-private
        }
        call.resolve();
    }

    @PluginMethod
    public void getPendingAccept(PluginCall call) {
        SharedPreferences prefs = getContext()
            .getSharedPreferences("pulse_call", Context.MODE_PRIVATE);
        boolean pending = prefs.getBoolean("pending_accept", false);
        String offer   = prefs.getString("pending_offer", "");
        if (pending) {
            prefs.edit().remove("pending_accept").remove("pending_offer").apply();
        }
        JSObject ret = new JSObject();
        ret.put("pending", pending);
        ret.put("offerData", offer);
        call.resolve(ret);
    }

    // ── NEW: set AudioManager mode when a call starts ─────────────────────────
    // Must be called before WebRTC starts sending/receiving audio.
    // speaker=true  → MODE_NORMAL + speakerphone on  (loud speaker)
    // speaker=false → MODE_IN_COMMUNICATION + speakerphone off (earpiece)
    @PluginMethod
    public void setAudioMode(PluginCall call) {
        boolean speaker = Boolean.TRUE.equals(call.getBoolean("speaker", true));
        try {
            AudioManager am = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
            if (am == null) { call.resolve(); return; }
            if (speaker) {
                am.setMode(AudioManager.MODE_IN_COMMUNICATION);
                am.stopBluetoothSco();
                am.setBluetoothScoOn(false);
                am.setSpeakerphoneOn(true);
            } else {
                am.setMode(AudioManager.MODE_IN_COMMUNICATION);
                am.setSpeakerphoneOn(false);
                if (am.isBluetoothScoAvailableOffCall()) {
                    am.startBluetoothSco();
                    am.setBluetoothScoOn(true);
                }
            }
        } catch (Exception e) {
            android.util.Log.w("PulsePlugin", "setAudioMode error: " + e.getMessage());
        }
        call.resolve();
    }

    // ── NEW: called when a call connects — sets MODE_IN_COMMUNICATION ─────────
    // This is mandatory for WebRTC audio to route correctly through Android's
    // voice pipeline (echo cancellation, noise suppression, correct routing).
    @PluginMethod
    public void startCallAudio(PluginCall call) {
        try {
            AudioManager am = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
            if (am != null) {
                am.setMode(AudioManager.MODE_IN_COMMUNICATION);
                am.setSpeakerphoneOn(true); // default to speaker on connect
            }
        } catch (Exception e) {
            android.util.Log.w("PulsePlugin", "startCallAudio error: " + e.getMessage());
        }
        call.resolve();
    }

    // ── NEW: called when call ends — restores normal audio mode ───────────────
    @PluginMethod
    public void stopCallAudio(PluginCall call) {
        try {
            AudioManager am = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
            if (am != null) {
                am.setSpeakerphoneOn(false);
                am.stopBluetoothSco();
                am.setBluetoothScoOn(false);
                am.setMode(AudioManager.MODE_NORMAL);
            }
        } catch (Exception e) {
            android.util.Log.w("PulsePlugin", "stopCallAudio error: " + e.getMessage());
        }
        call.resolve();
    }

    // ── NEW: set ringtone choice ──────────────────────────────────────────────
    @PluginMethod
    public void setRingtone(PluginCall call) {
        String ringtone = call.getString("ringtone", "ringtone");
        SharedPreferences prefs = getContext().getSharedPreferences("pulse_settings", Context.MODE_PRIVATE);
        prefs.edit().putString("ringtone_name", ringtone).apply();
        call.resolve();
    }
}
