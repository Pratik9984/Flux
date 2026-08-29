"use client";

import React, { useState, useRef, useEffect } from "react";

// ─── DRAG TO ANSWER SLIDER ───────────────────────────────────────────────────
export interface DragSliderProps {
  label: string;
  type: "accept" | "decline";
  onTrigger: () => void;
}

export default function DragSlider({ label, type, onTrigger }: DragSliderProps) {
  const [posX, setPosX] = useState(0);
  const [isTriggered, setIsTriggered] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const startX = useRef(0);
  const [maxDistance, setMaxDistance] = useState(120);

  useEffect(() => {
    const track = trackRef.current;
    const handle = handleRef.current;
    if (!track || !handle) return;

    const updateMaxDistance = () => {
      const trackW = track.clientWidth;
      const handleW = handle.clientWidth;
      if (trackW && handleW) {
        setMaxDistance(Math.max(80, trackW - handleW - 6));
      }
    };

    updateMaxDistance();

    const observer = new ResizeObserver(() => {
      updateMaxDistance();
    });

    observer.observe(track);
    observer.observe(handle);

    return () => {
      observer.disconnect();
    };
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    if (isTriggered) return;

    // Recalculate maxDistance on interaction to handle any timing / hydration latency
    if (trackRef.current && handleRef.current) {
      const trackW = trackRef.current.clientWidth;
      const handleW = handleRef.current.clientWidth;
      if (trackW && handleW) {
        setMaxDistance(Math.max(80, trackW - handleW - 6));
      }
    }

    isDragging.current = true;
    startX.current = e.clientX;
    if (handleRef.current) {
      handleRef.current.setPointerCapture(e.pointerId);
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (isTriggered || !isDragging.current) return;
    
    const deltaX = e.clientX - startX.current;
    let newX = deltaX;
    
    // Bounds clamping with startX adjustment to eliminate dead zones
    if (newX < 0) {
      newX = 0;
      startX.current = e.clientX;
    } else if (newX > maxDistance) {
      newX = maxDistance;
      startX.current = e.clientX - maxDistance;
    }
    
    setPosX(newX);

    if (newX >= maxDistance * 0.85) {
      isDragging.current = false;
      setIsTriggered(true);
      setPosX(maxDistance);
      if (handleRef.current) {
        try {
          handleRef.current.releasePointerCapture(e.pointerId);
        } catch {}
      }
      onTrigger();
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (isTriggered || !isDragging.current) return;
    isDragging.current = false;
    setPosX(0);
    if (handleRef.current) {
      try {
        handleRef.current.releasePointerCapture(e.pointerId);
      } catch {}
    }
  };

  const onPointerCancel = (e: React.PointerEvent) => {
    if (isTriggered || !isDragging.current) return;
    isDragging.current = false;
    setPosX(0);
    if (handleRef.current) {
      try {
        handleRef.current.releasePointerCapture(e.pointerId);
      } catch {}
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (isTriggered) return;
    const step = Math.max(20, Math.round(maxDistance * 0.15));
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setPosX(maxDistance);
      setIsTriggered(true);
      onTrigger();
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      const newX = Math.min(maxDistance, posX + step);
      setPosX(newX);
      if (newX >= maxDistance * 0.85) {
        setPosX(maxDistance);
        setIsTriggered(true);
        onTrigger();
      }
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      setPosX(Math.max(0, posX - step));
    }
  };

  if (isTriggered) {
    return (
      <button
        disabled
        className={`slide-track slide-track-${type}`}
        aria-label={type === "accept" ? "Answering" : "Declining"}
        type="button"
        style={{
          border: "none",
          cursor: "default",
          fontFamily: "var(--font-ui)",
          outline: "none",
          background: type === "accept" ? "rgba(37, 211, 102, 0.12)" : "rgba(239, 68, 68, 0.12)"
        }}
      >
        <span
          className="slide-track-text"
          style={{
            opacity: 1,
            animation: "none",
            color: type === "accept" ? "var(--green)" : "var(--danger)"
          }}
        >
          {type === "accept" ? "Answering…" : "Declining…"}
        </span>
      </button>
    );
  }

  return (
    <div ref={trackRef} className={`slide-track slide-track-${type}`}>
      <span className="slide-track-text">{label}</span>
      <div
        ref={handleRef}
        className={`slide-handle slide-handle-${type}`}
        style={{
          transform: `translateX(${posX}px)`,
          transition: isDragging.current ? "none" : "transform 0.24s cubic-bezier(0.25, 0.8, 0.25, 1)"
        }}
        tabIndex={0}
        role="slider"
        aria-valuenow={posX}
        aria-valuemin={0}
        aria-valuemax={maxDistance}
        aria-label={label}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onKeyDown={onKeyDown}
      >
        {type === "accept" ? (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 014.69 12a19.79 19.79 0 01-3.07-8.67A2 2 0 013.6 1.37h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L7.91 9a16 16 0 006.09 6.09l1.97-1.85a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7a2 2 0 011.72 2.03z" /></svg>
        ) : (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
        )}
      </div>
    </div>
  );
}
