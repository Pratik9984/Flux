"use client";

import React, { useState, useEffect, useRef, useLayoutEffect } from "react";
import { createPortal } from "react-dom";

// ─── REACTION PICKER PORTAL ───────────────────────────────────────────────────
export interface ReactionPickerPortalProps {
  anchorRef: React.RefObject<HTMLDivElement | null>;
  isMine: boolean;
  emojis: string[];
  onReact: (emoji: string) => void;
  onClose: () => void;
}

export default function ReactionPickerPortal({ anchorRef, isMine, emojis, onReact, onClose }: ReactionPickerPortalProps) {
  const [style, setStyle] = useState<React.CSSProperties>({ position: "fixed", zIndex: 99999, opacity: 0, pointerEvents: "none" });
  const pickerRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  useLayoutEffect(() => {
    if (!anchorRef.current || !pickerRef.current) return;
    const anchor = anchorRef.current.getBoundingClientRect();
    const picker = pickerRef.current.getBoundingClientRect();
    const pickerW = picker.width || emojis.length * 44 + 16;
    const pickerH = picker.height || 56;
    let left = isMine ? anchor.right - pickerW : anchor.left;
    left = Math.max(12, Math.min(left, window.innerWidth - pickerW - 12));
    let top = anchor.top - pickerH - 8;
    if (top < 12) top = anchor.bottom + 8;
    top = Math.max(12, Math.min(top, window.innerHeight - pickerH - 12));
    setStyle({ position: "fixed", zIndex: 99999, top, left, opacity: 1, pointerEvents: "auto" });
  }, [mounted, isMine, emojis.length]); // eslint-disable-line

  if (!mounted) return null;

  const handleSelectEmoji = (emoji: string, e: React.SyntheticEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onReact(emoji);
    onClose();
  };

  return createPortal(
    <>
      <div
        className="reaction-picker-backdrop"
        style={{ position: "fixed", inset: 0, zIndex: 99998, background: "transparent" }}
        onClick={e => { e.stopPropagation(); onClose(); }}
      />
      <div
        ref={pickerRef}
        className="reaction-picker pop"
        style={style}
        role="dialog"
        aria-modal="true"
        aria-label="Select reaction"
        onClick={e => e.stopPropagation()}
        onMouseDown={e => e.stopPropagation()}
      >
        {emojis.map(e => (
          <button
            key={e}
            type="button"
            className="reaction-btn"
            onClick={ev => handleSelectEmoji(e, ev)}
            aria-label={`React with ${e}`}
          >
            {e}
          </button>
        ))}
      </div>
    </>,
    document.body
  );
}
