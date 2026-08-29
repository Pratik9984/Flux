// ─── Pulse/Flux — Debounce Hooks ──────────────────────────────────────────────

import { useState, useEffect, useRef, useCallback } from "react";

/**
 * Debounce a value by a given delay (ms).
 */
export function useDebounce<T>(value: T, delay: number): T {
  const [deb, setDeb] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDeb(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return deb;
}

/**
 * Debounce a callback by a given delay (ms).
 */
export function useDebounceCallback<T extends (...args: any[]) => void>(fn: T, delay: number): T {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fnRef = useRef(fn);
  useEffect(() => { fnRef.current = fn; });
  return useCallback((...args: any[]) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => fnRef.current(...args), delay);
  }, [delay]) as T;
}
