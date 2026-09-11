// ─── Pulse/Flux — Structured Local Database (IndexedDB) ─────────────────────────
import type { Message, CallLogEntry } from "@/types";

export interface DBCachedFile {
  url: string;
  localPath: string;
  fileName: string;
  mimeType: string;
  size: number;
  createdAt: number;
}

const DB_NAME = "FluxLocalDB";
const DB_VERSION = 2;

let dbInstance: IDBDatabase | null = null;

/**
 * Initialize and open the local database.
 */
export function initDB(): Promise<IDBDatabase> {
  if (typeof window === "undefined" || typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB is not supported in this environment"));
  }
  if (dbInstance) {
    return Promise.resolve(dbInstance);
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      // 1. messages store
      if (!db.objectStoreNames.contains("messages")) {
        const msgStore = db.createObjectStore("messages", { keyPath: "id" });
        msgStore.createIndex("chatId", "chatId", { unique: false });
        msgStore.createIndex("timestamp", "timestamp", { unique: false });
      }

      // 2. call_logs store
      if (!db.objectStoreNames.contains("call_logs")) {
        const callStore = db.createObjectStore("call_logs", { keyPath: "id" });
        callStore.createIndex("timestamp", "timestamp", { unique: false });
      }

      // 3. cached_files store
      if (!db.objectStoreNames.contains("cached_files")) {
        db.createObjectStore("cached_files", { keyPath: "url" });
      }

      // 4. cached_media_blobs store (persistent decrypted chat media)
      if (!db.objectStoreNames.contains("cached_media_blobs")) {
        db.createObjectStore("cached_media_blobs", { keyPath: "url" });
      }
    };

    request.onsuccess = () => {
      dbInstance = request.result;
      resolve(request.result);
    };

    request.onerror = () => {
      reject(request.error);
    };
  });
}

// ─── MESSAGES HELPERS ────────────────────────────────────────────────────────

/**
 * Resolves the conversation chat ID for storing/indexing a message in IndexedDB.
 */
export function resolveMessageChatId(msg: any, fallbackChatId?: string): string {
  if (fallbackChatId) return String(fallbackChatId).toLowerCase();
  if (msg.group_id) return String(msg.group_id);
  
  const myEmail = (
    typeof window !== "undefined"
      ? (localStorage.getItem("chat_user") || "").toLowerCase().trim()
      : ""
  );

  const sender = (msg.user || msg.sender_email || "").toLowerCase().trim();
  const receiver = (msg.receiver_email || msg.target_user || "").toLowerCase().trim();

  // For 1-on-1 direct messages, the chatId is the peer's email (the other participant)
  if (sender && receiver) {
    if (myEmail) {
      if (sender === myEmail) return receiver;
      if (receiver === myEmail) return sender;
    }
    return sender === myEmail ? receiver : sender;
  }

  if (msg.chatId && !msg.chatId.includes("@")) return String(msg.chatId);
  return (receiver || sender || msg.chatId || "unknown").toLowerCase();
}

/**
 * Save or update a message in the local database.
 */
export async function dbSaveMessage(msg: Message, chatIdOverride?: string): Promise<void> {
  try {
    const db = await initDB();
    const chatId = resolveMessageChatId(msg, chatIdOverride);

    // Normalize message fields to ensure chatId index works cleanly
    const dbEntry = {
      ...msg,
      chatId,
      dbTimestamp: msg.timestamp ? new Date(msg.timestamp).getTime() : Date.now()
    };

    return new Promise((resolve, reject) => {
      const transaction = db.transaction("messages", "readwrite");
      const store = transaction.objectStore("messages");
      const request = store.put(dbEntry);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.error("dbSaveMessage failed:", err);
  }
}

/**
 * Bulk save or update messages in the local database.
 */
export async function dbSaveMessages(msgs: Message[], chatIdOverride?: string): Promise<void> {
  if (msgs.length === 0) return;
  try {
    const db = await initDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction("messages", "readwrite");
      const store = transaction.objectStore("messages");

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);

      for (const msg of msgs) {
        const chatId = resolveMessageChatId(msg, chatIdOverride);
        const dbEntry = {
          ...msg,
          chatId,
          dbTimestamp: msg.timestamp ? new Date(msg.timestamp).getTime() : Date.now()
        };
        store.put(dbEntry);
      }
    });
  } catch (err) {
    console.error("dbSaveMessages failed:", err);
  }
}

/**
 * Preload all recent conversation messages into memory for 0ms instant display.
 */
export async function dbPreloadRecentMessages(): Promise<Record<string, Message[]>> {
  try {
    const db = await initDB();
    return new Promise((resolve) => {
      const transaction = db.transaction("messages", "readonly");
      const store = transaction.objectStore("messages");
      const request = store.getAll();

      request.onsuccess = () => {
        const allMsgs = request.result as (Message & { chatId: string })[];
        const byChat: Record<string, Message[]> = {};
        if (allMsgs && allMsgs.length > 0) {
          for (const m of allMsgs) {
            const cId = m.chatId || resolveMessageChatId(m);
            if (!byChat[cId]) byChat[cId] = [];
            byChat[cId].push(m);
          }
          // Sort each chat's messages by timestamp ascending
          for (const cId of Object.keys(byChat)) {
            byChat[cId].sort((a, b) => new Date(a.timestamp || 0).getTime() - new Date(b.timestamp || 0).getTime());
            if (byChat[cId].length > 50) {
              byChat[cId] = byChat[cId].slice(-50);
            }
          }
        }
        resolve(byChat);
      };

      request.onerror = () => resolve({});
    });
  } catch {
    return {};
  }
}

/**
 * Retrieve messages for a given chat, sorted by timestamp descending.
 */
export async function dbGetMessages(chatId: string, limit = 50, beforeId: string | number | null = null): Promise<Message[]> {
  try {
    const db = await initDB();
    const normalizedChatId = String(chatId).toLowerCase();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction("messages", "readonly");
      const store = transaction.objectStore("messages");
      const index = store.index("chatId");
      const range = IDBKeyRange.only(normalizedChatId);

      const request = index.openCursor(range, "prev"); // "prev" returns desc order
      const results: Message[] = [];
      let foundBeforeId = beforeId ? false : true;

      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          const msg = cursor.value;
          if (beforeId && !foundBeforeId) {
            if (String(msg.id) === String(beforeId)) {
              foundBeforeId = true;
            }
            cursor.continue();
            return;
          }

          if (results.length < limit) {
            results.push(msg);
            cursor.continue();
          } else {
            // Sort ascending (oldest first) so they display correctly in chat interface
            results.reverse();
            resolve(results);
          }
        } else {
          // Sort ascending (oldest first) so they display correctly in chat interface
          results.reverse();
          resolve(results);
        }
      };

      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.error("dbGetMessages failed:", err);
    return [];
  }
}

/**
 * Delete a message from the database.
 */
export async function dbDeleteMessage(id: string | number): Promise<void> {
  try {
    const db = await initDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction("messages", "readwrite");
      const store = transaction.objectStore("messages");
      const request = store.delete(String(id));

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.error("dbDeleteMessage failed:", err);
  }
}

/**
 * Update a message record partially.
 */
export async function dbUpdateMessage(id: string | number, partial: Partial<Message>): Promise<void> {
  try {
    const db = await initDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction("messages", "readwrite");
      const store = transaction.objectStore("messages");
      const getRequest = store.get(String(id));

      getRequest.onsuccess = () => {
        const existing = getRequest.result;
        if (existing) {
          const updated = { ...existing, ...partial };
          const putRequest = store.put(updated);
          putRequest.onsuccess = () => resolve();
          putRequest.onerror = () => reject(putRequest.error);
        } else {
          const putRequest = store.put({ id: String(id), ...partial });
          putRequest.onsuccess = () => resolve();
          putRequest.onerror = () => reject(putRequest.error);
        }
      };

      getRequest.onerror = () => reject(getRequest.error);
    });
  } catch (err) {
    console.error("dbUpdateMessage failed:", err);
  }
}

/**
 * Clear all messages for a given chat.
 */
export async function dbClearMessages(chatId: string | number): Promise<void> {
  try {
    const db = await initDB();
    const normalizedChatId = String(chatId).toLowerCase();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction("messages", "readwrite");
      const store = transaction.objectStore("messages");
      const index = store.index("chatId");
      const range = IDBKeyRange.only(normalizedChatId);

      const request = index.openKeyCursor(range);
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          store.delete(cursor.primaryKey);
          cursor.continue();
        } else {
          resolve();
        }
      };
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.error("dbClearMessages failed:", err);
  }
}

// ─── CALL LOGS HELPERS ───────────────────────────────────────────────────────

/**
 * Save or update a call log.
 */
export async function dbSaveCallLog(log: CallLogEntry): Promise<void> {
  try {
    const db = await initDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction("call_logs", "readwrite");
      const store = transaction.objectStore("call_logs");
      const request = store.put(log);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.error("dbSaveCallLog failed:", err);
  }
}

/**
 * Retrieve all call logs, sorted by timestamp descending.
 */
export async function dbGetCallLogs(limit = 100): Promise<CallLogEntry[]> {
  try {
    const db = await initDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction("call_logs", "readonly");
      const store = transaction.objectStore("call_logs");
      const index = store.index("timestamp");

      const request = index.openCursor(null, "prev"); // Descending order
      const results: CallLogEntry[] = [];

      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor && results.length < limit) {
          results.push(cursor.value);
          cursor.continue();
        } else {
          resolve(results);
        }
      };

      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.error("dbGetCallLogs failed:", err);
    return [];
  }
}

/**
 * Clear all call logs from the database.
 */
export async function dbClearCallLogs(): Promise<void> {
  try {
    const db = await initDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction("call_logs", "readwrite");
      const store = transaction.objectStore("call_logs");
      const request = store.clear();

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.error("dbClearCallLogs failed:", err);
  }
}

// ─── CACHED FILES HELPERS ────────────────────────────────────────────────────

/**
 * Cache metadata for a downloaded file.
 */
export async function dbSaveFileMetadata(file: DBCachedFile): Promise<void> {
  try {
    const db = await initDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction("cached_files", "readwrite");
      const store = transaction.objectStore("cached_files");
      const request = store.put(file);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.error("dbSaveFileMetadata failed:", err);
  }
}

/**
 * Retrieve metadata for a cached file by its remote URL.
 */
export async function dbGetFileMetadata(url: string): Promise<DBCachedFile | null> {
  try {
    const db = await initDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction("cached_files", "readonly");
      const store = transaction.objectStore("cached_files");
      const request = store.get(url);

      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.error("dbGetFileMetadata failed:", err);
    return null;
  }
}

/**
 * Retrieve all locally cached files metadata.
 */
export async function dbGetAllFilesMetadata(): Promise<DBCachedFile[]> {
  try {
    const db = await initDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction("cached_files", "readonly");
      const store = transaction.objectStore("cached_files");
      const request = store.getAll();

      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.error("dbGetAllFilesMetadata failed:", err);
    return [];
  }
}

/**
 * Delete a file's cache metadata.
 */
export async function dbDeleteFileMetadata(url: string): Promise<void> {
  try {
    const db = await initDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction("cached_files", "readwrite");
      const store = transaction.objectStore("cached_files");
      const request = store.delete(url);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.error("dbDeleteFileMetadata failed:", err);
  }
}

// ─── CACHED MEDIA BLOBS (PERSISTENT CLIENT STORAGE — WHATSAPP MODEL) ─────────
export interface DBCachedMediaBlob {
  url: string;
  blob: Blob;
  mimeType: string;
  savedAt: number;
}

/**
 * Saves a decrypted media file (photo, video, audio) permanently into local device storage.
 */
export async function dbSaveLocalMedia(url: string, blob: Blob, mimeType: string): Promise<void> {
  try {
    const db = await initDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction("cached_media_blobs", "readwrite");
      const store = transaction.objectStore("cached_media_blobs");
      const record: DBCachedMediaBlob = {
        url,
        blob,
        mimeType: mimeType || blob.type || "application/octet-stream",
        savedAt: Date.now(),
      };
      const request = store.put(record);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.error("dbSaveLocalMedia failed:", err);
  }
}

/**
 * Retrieves a persistent locally saved media file by its URL.
 */
export async function dbGetLocalMedia(url: string): Promise<{ blob: Blob; mimeType: string } | null> {
  try {
    const db = await initDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction("cached_media_blobs", "readonly");
      const store = transaction.objectStore("cached_media_blobs");
      const request = store.get(url);
      request.onsuccess = () => {
        const res = request.result as DBCachedMediaBlob | undefined;
        if (res && res.blob) {
          resolve({ blob: res.blob, mimeType: res.mimeType });
        } else {
          resolve(null);
        }
      };
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.error("dbGetLocalMedia failed:", err);
    return null;
  }
}
