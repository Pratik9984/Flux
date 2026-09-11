// lib/share.ts
// Native Share and Media Sharing Manager for Pulse

import { Capacitor } from '@capacitor/core';
import { Share } from '@capacitor/share';

export interface ShareOptions {
  title?: string;
  text?: string;
  url?: string;
  type?: string;
  dialogTitle?: string;
}

/**
 * Shares media file, text, or links via native Android share sheet (or web fallback).
 * Correctly handles blob: URLs, decrypted media, and files.
 */
export async function shareContent(opts: ShareOptions): Promise<boolean> {
  const title = opts.title || 'Flux Media';
  const text = opts.text || '';
  const url = opts.url || '';
  const dialogTitle = opts.dialogTitle || 'Share via';

  if (!url && !text) return false;

  try {
    // 1. If we have a media URL (blob:, http:, data:), prepare binary data for native sharing
    if (url) {
      try {
        const res = await fetch(url, { mode: 'cors' }).catch(() => fetch(url));
        const blob = await res.blob();
        const mimeType = blob.type || (opts.type === 'video' ? 'video/mp4' : 'image/jpeg');
        let ext = mimeType.split('/')[1]?.split(';')[0]?.toLowerCase() || 'jpg';
        if (ext === 'jpeg') ext = 'jpg';
        if (ext === 'quicktime') ext = 'mov';
        const filename = `Flux_${Date.now()}.${ext}`;

        // Check Native Android Bridge first for direct Intent.ACTION_SEND
        const nativeBridge = typeof window !== 'undefined' ? (window as any).FluxNativeBridge : null;
        if (nativeBridge && typeof nativeBridge.shareMediaFile === 'function') {
          const reader = new FileReader();
          const base64 = await new Promise<string>((resolve) => {
            reader.onloadend = () => resolve(reader.result as string);
            reader.readAsDataURL(blob);
          });
          const handled = nativeBridge.shareMediaFile(base64, filename, mimeType);
          if (handled) return true;
        }

        // Web Navigator Share with real File object
        if (typeof navigator !== 'undefined' && typeof navigator.canShare === 'function') {
          const file = new File([blob], filename, { type: mimeType });
          if (navigator.canShare({ files: [file] })) {
            await navigator.share({
              files: [file],
              title,
              text,
            });
            return true;
          }
        }
      } catch (mediaErr) {
        console.warn('Error reading media for share:', mediaErr);
      }
    }

    // 2. Fallback to Capacitor Share for pure URLs or text
    if (Capacitor.isNativePlatform()) {
      const can = await Share.canShare().catch(() => ({ value: true }));
      if (can.value) {
        await Share.share({
          title,
          text,
          url: url && !url.startsWith('blob:') ? url : undefined,
          dialogTitle,
        });
        return true;
      }
    }

    // 3. Web Navigator Share fallback for URLs
    if (typeof navigator !== 'undefined' && navigator.share) {
      await navigator.share({
        title,
        text,
        url: url && !url.startsWith('blob:') ? url : undefined,
      });
      return true;
    }

    // 4. Clipboard fallback
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      const shareText = [text, url && !url.startsWith('blob:') ? url : ''].filter(Boolean).join(' ');
      if (shareText) {
        await navigator.clipboard.writeText(shareText);
        return true;
      }
    }
  } catch (err: any) {
    if (err?.name !== 'AbortError') {
      console.warn('Share error:', err);
    }
  }
  return false;
}
