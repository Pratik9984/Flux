import { useCallback } from "react";
import { useApiFetch } from "@/hooks/useApiFetch";
import {
  getOrCreateIdentityKeyPair, encryptDM, decryptDM,
  generateGroupKey, wrapGroupKeyForMember, unwrapGroupKey,
  encryptGroupMsg, decryptGroupMsg, isDMEncrypted, isGroupEncrypted, groupKeyCache,
} from "@/lib/crypto";

// Module-level shared states so that all instances of useCrypto see the same keys.
let globalPrivKey: CryptoKey | null = null;
let globalPubKeyB64: string = "";
const globalPubKeyCache = new Map<string, string>();

/**
 * E2E encryption hook. Manages identity keys, peer public key cache,
 * group key cache, and provides encrypt/decrypt helpers.
 */
export function useCrypto() {
  const apiFetch = useApiFetch();

  // Fake ref wrappers pointing to global shared states to preserve original ref API compatibility.
  const e2ePrivKeyRef = {
    get current() { return globalPrivKey; },
    set current(val) { globalPrivKey = val; }
  };

  const e2ePubKeyB64Ref = {
    get current() { return globalPubKeyB64; },
    set current(val) { globalPubKeyB64 = val; }
  };

  const pubKeyCache = {
    get current() { return globalPubKeyCache; }
  };

  const initializeKeys = useCallback(async (email: string) => {
    try {
      const { privateKey, publicKeyB64 } = await getOrCreateIdentityKeyPair(email);
      globalPrivKey = privateKey;
      globalPubKeyB64 = publicKeyB64;
      apiFetch("/profile/public-key", {
        method: "POST",
        body: JSON.stringify({ public_key: publicKeyB64 }),
      }).catch(() => {});
      return { privateKey, publicKeyB64 };
    } catch {
      return null;
    }
  }, [apiFetch]);

  const getPeerPubKey = useCallback(async (peerEmailRaw: string): Promise<string | null> => {
    const peerEmail = peerEmailRaw.toLowerCase();
    if (globalPubKeyCache.has(peerEmail)) return globalPubKeyCache.get(peerEmail)!;
    try {
      const data = await apiFetch<{ public_key: string }>(
        `/profile/public-key/${encodeURIComponent(peerEmail)}`
      );
      globalPubKeyCache.set(peerEmail, data.public_key);
      return data.public_key;
    } catch {
      return null;
    }
  }, [apiFetch]);

  const getGroupKey = useCallback(async (groupId: string | number): Promise<CryptoKey | null> => {
    const gid = String(groupId);
    if (groupKeyCache.has(gid)) return groupKeyCache.get(gid)!;
    const privKey = globalPrivKey;
    if (!privKey) return null;
    try {
      const data = await apiFetch<{ key_id: string; encrypted_key: string; setter_pub_key: string }>(
        `/groups/${gid}/e2e-key`
      );
      const groupKey = await unwrapGroupKey(data.encrypted_key, privKey, data.setter_pub_key);
      groupKeyCache.set(gid, groupKey);
      return groupKey;
    } catch {
      return null;
    }
  }, [apiFetch]);

  const decryptContent = useCallback(async (
    content: string,
    chatType: "user" | "group",
    peerEmail: string,
    groupId?: string | number
  ): Promise<string> => {
    const privKey = globalPrivKey;
    if (!privKey) return content;
    try {
      if (isDMEncrypted(content)) {
        const theirPub = await getPeerPubKey(peerEmail);
        if (!theirPub) return "[Encrypted — peer key unavailable]";
        return await decryptDM(content, privKey, theirPub);
      }
      if (isGroupEncrypted(content) && groupId) {
        const gKey = await getGroupKey(groupId);
        if (!gKey) return "[Encrypted — group key unavailable]";
        return await decryptGroupMsg(content, gKey);
      }
    } catch {
      return "[Encrypted message — decryption failed]";
    }
    return content;
  }, [getPeerPubKey, getGroupKey]);

  const encryptForSend = useCallback(async (
    text: string,
    chatType: "user" | "group",
    chatId: string | number
  ): Promise<string> => {
    const privKey = globalPrivKey;
    if (!privKey) return text;
    try {
      if (chatType === "user") {
        const theirPub = await getPeerPubKey(String(chatId));
        if (theirPub) return await encryptDM(text, privKey, theirPub);
      } else {
        const gKey = await getGroupKey(chatId);
        if (gKey) return await encryptGroupMsg(text, gKey);
      }
    } catch { /* fall through to plaintext */ }
    return text;
  }, [getPeerPubKey, getGroupKey]);

  return {
    e2ePrivKeyRef,
    e2ePubKeyB64Ref,
    pubKeyCache,
    initializeKeys,
    getPeerPubKey,
    getGroupKey,
    decryptContent,
    encryptForSend,
    // Re-export for external use
    encryptDM,
    decryptDM,
    generateGroupKey,
    wrapGroupKeyForMember,
    unwrapGroupKey,
    encryptGroupMsg,
    decryptGroupMsg,
    groupKeyCache,
  };
}

export type CryptoHook = ReturnType<typeof useCrypto>;
