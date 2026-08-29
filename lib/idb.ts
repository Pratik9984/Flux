// ─── Pulse/Flux — IndexedDB Helper ────────────────────────────────────────────

const DB_NAME = "Flux-sw";
const STORE_NAME = "kv";

function getDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Write a key-value pair to the Flux-sw IndexedDB store.
 * Supports any serializable object.
 */
export async function idbSet(key: string, value: any): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      const request = transaction.objectStore(STORE_NAME).put(value, key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch { }
}

/**
 * Read a value from the Flux-sw IndexedDB store.
 */
export async function idbGet<T = any>(key: string): Promise<T | null> {
  if (typeof indexedDB === "undefined") return null;
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readonly");
      const request = transaction.objectStore(STORE_NAME).get(key);
      request.onsuccess = () => resolve((request.result as T) ?? null);
      request.onerror = () => reject(request.error);
    });
  } catch {
    return null;
  }
}

/**
 * Delete a key-value pair from the Flux-sw IndexedDB store.
 */
export async function idbDel(key: string): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      const request = transaction.objectStore(STORE_NAME).delete(key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch { }
}

/**
 * Read multiple keys in a single IndexedDB transaction.
 * Returns a Map of key → value (missing keys are omitted).
 */
export async function idbGetMany<T = any>(keys: string[]): Promise<Map<string, T>> {
  const result = new Map<string, T>();
  if (typeof indexedDB === "undefined" || keys.length === 0) return result;
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readonly");
      const store = transaction.objectStore(STORE_NAME);
      let completed = 0;
      for (const key of keys) {
        const request = store.get(key);
        request.onsuccess = () => {
          if (request.result !== undefined) result.set(key, request.result as T);
          if (++completed === keys.length) resolve(result);
        };
        request.onerror = () => {
          if (++completed === keys.length) resolve(result);
        };
      }
    });
  } catch {
    return result;
  }
}
