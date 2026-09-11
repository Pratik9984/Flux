// ─── Pulse/Flux End-to-End Media Encryption (AES-256-GCM) ──────────────────────────
// Encrypts photos, videos, voice notes, and documents on the client device BEFORE upload.
// The server only stores raw scrambled .enc ciphertext. Nobody on the server can view the media.
// The decryption key and IV are transported inside the E2E encrypted chat payload.

const toB64 = (buf: ArrayBuffer | Uint8Array) => {
  const arr = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < arr.byteLength; i++) {
    binary += String.fromCharCode(arr[i]);
  }
  return btoa(binary);
};

const fromB64 = (s: string) => {
  const binary = atob(s);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

export interface EncryptedMediaResult {
  encryptedBlob: Blob;
  keyB64: string;
  ivB64: string;
  fileName: string;
  mimeType: string;
}

/**
 * Encrypts a clean media file/blob with a fresh random AES-256-GCM key.
 */
export async function encryptMediaBlob(
  fileOrBlob: Blob,
  originalName?: string
): Promise<EncryptedMediaResult> {
  const rawKey = crypto.getRandomValues(new Uint8Array(32)); // 256 bits
  const iv = crypto.getRandomValues(new Uint8Array(12));      // 96 bits standard GCM IV

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    rawKey,
    { name: "AES-GCM" },
    false,
    ["encrypt"]
  );

  const rawBytes = await fileOrBlob.arrayBuffer();
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    cryptoKey,
    rawBytes
  );

  // Prefix with IV: [12 bytes IV] + [ciphertext + 16 bytes auth tag]
  const combined = new Uint8Array(iv.byteLength + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.byteLength);

  const encryptedBlob = new Blob([combined], { type: "application/octet-stream" });
  const ext = originalName ? originalName.split(".").pop() || "bin" : "bin";
  const fileName = `enc_${Date.now()}_${Math.random().toString(36).substring(2, 9)}.${ext}.enc`;

  return {
    encryptedBlob,
    keyB64: toB64(rawKey),
    ivB64: toB64(iv),
    fileName,
    mimeType: fileOrBlob.type || "application/octet-stream",
  };
}

/**
 * Decrypts an encrypted binary ArrayBuffer using the provided key and IV.
 */
export async function decryptMediaBuffer(
  encryptedBuffer: ArrayBuffer,
  keyB64: string,
  ivB64?: string,
  mimeType?: string
): Promise<Blob> {
  if (encryptedBuffer.byteLength < 13) {
    throw new Error("Encrypted media buffer too small");
  }

  const rawKey = fromB64(keyB64);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    rawKey,
    { name: "AES-GCM" },
    false,
    ["decrypt"]
  );

  let iv: Uint8Array;
  if (ivB64) {
    iv = fromB64(ivB64);
  } else {
    const rawIv = new Uint8Array(encryptedBuffer, 0, 12);
    iv = new Uint8Array(12);
    iv.set(rawIv);
  }

  // The actual ciphertext starts after the 12-byte prepended IV
  const ciphertext = encryptedBuffer.slice(12);

  const decryptedBuffer = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv as any },
    cryptoKey,
    ciphertext
  );

  return new Blob([decryptedBuffer], { type: mimeType || "application/octet-stream" });
}
