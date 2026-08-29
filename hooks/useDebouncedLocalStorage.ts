// ─── Pulse/Flux — Debounced LocalStorage Hook ────────────────────────────────

import { useEffect } from "react";
import { useDebounce } from "./useDebounce";

/**
 * Persist a value to localStorage with debounced writes.
 * Pass an empty key to skip writes.
 */
export function useDebouncedLocalStorage(key: string, value: unknown, delay = 800) {
  const debouncedValue = useDebounce(value, delay);
  useEffect(() => {
    if (key) {
      try { localStorage.setItem(key, JSON.stringify(debouncedValue)); } catch { }
    }
  }, [key, debouncedValue]);
}
