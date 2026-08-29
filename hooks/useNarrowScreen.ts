// ─── Pulse/Flux — Narrow Screen Hook ─────────────────────────────────────────

import { useState, useEffect } from "react";

/**
 * Returns true if the viewport is narrower than the given breakpoint (default 380px).
 */
export function useNarrowScreen(breakpoint = 380) {
  const [isNarrow, setIsNarrow] = useState(false);
  useEffect(() => {
    const check = () => setIsNarrow(window.innerWidth <= breakpoint);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, [breakpoint]);
  return isNarrow;
}
