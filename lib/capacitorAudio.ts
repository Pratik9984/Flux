import { Capacitor } from "@capacitor/core";
import { NativeAudio } from "@capacitor-community/native-audio"; // ← fixed package

const IS_NATIVE = Capacitor.isNativePlatform();

export async function preloadSounds() {
    if (!IS_NATIVE) return;
    try {
        await NativeAudio.preload({ assetId: "notification", assetPath: "public/notification.mp3", audioChannelNum: 1, isUrl: false });
        await NativeAudio.preload({ assetId: "ringtone", assetPath: "public/ringtone.mp3", audioChannelNum: 1, isUrl: false });
        await NativeAudio.preload({ assetId: "ringtone2", assetPath: "public/ringtone2.mp3", audioChannelNum: 1, isUrl: false });
        await NativeAudio.preload({ assetId: "ringtone3", assetPath: "public/ringtone3.mp3", audioChannelNum: 1, isUrl: false });
    } catch (e) {
        console.warn("Audio preload failed", e);
    }
}

export async function playNotification() {
    if (!IS_NATIVE) return;
    try { await NativeAudio.play({ assetId: "notification" }); } catch { }
}

let activeRingtoneId = "ringtone";

export async function playRingtone() {
    if (!IS_NATIVE) return;
    try {
        const selected = localStorage.getItem("pulse_ringtone_name") || "ringtone";
        activeRingtoneId = selected;
        await NativeAudio.stop({ assetId: activeRingtoneId }).catch(() => { }); 
        await NativeAudio.loop({ assetId: activeRingtoneId });
    } catch (e) {
        console.warn("playRingtone failed", e);
    }
}

export async function stopRingtoneNative() {
    if (!IS_NATIVE) return;
    try { 
        await NativeAudio.stop({ assetId: activeRingtoneId });
        // Just in case, stop the others too to prevent leaks
        await NativeAudio.stop({ assetId: "ringtone" }).catch(()=>{});
        await NativeAudio.stop({ assetId: "ringtone2" }).catch(()=>{});
        await NativeAudio.stop({ assetId: "ringtone3" }).catch(()=>{});
    } catch { }
}