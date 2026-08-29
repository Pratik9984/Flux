// ─── Pulse/Flux — Debounced IndexedDB Hook ────────────────────────────────

import { useEffect } from "react";
import { useDebounce } from "./useDebounce";
import { idbSet } from "@/lib/idb";

/**
 * Persist a value to IndexedDB with debounced writes.
 * Pass an empty key to skip writes.
 */
export function useDebouncedIdb(key: string, value: unknown, delay = 800) {
  const debouncedValue = useDebounce(value, delay);
  useEffect(() => {
    if (key) {
      idbSet(key, debouncedValue).catch(() => { });
    }
  }, [key, debouncedValue]);
}
