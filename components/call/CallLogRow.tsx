"use client";

import React from "react";
import { parseTs, fmtDuration } from "@/lib/utils";
import type { CallLogEntry } from "@/types";

// ─── CALL LOG ROW ─────────────────────────────────────────────────────────────
export default function CallLogRow({ log, onCallClick }: { log: CallLogEntry; onCallClick?: (video: boolean) => void }) {
  const isVideo = log.media === "video";
  return (
    <div
      className="pfs-call-item"
      onClick={() => onCallClick?.(isVideo)}
      style={{ cursor: "pointer", transition: "all 0.18s ease", display: "flex", justifyContent: "space-between", alignItems: "center", background: "#ffffff", marginBottom: 8 }}
      onMouseEnter={e => e.currentTarget.style.background = "#f8f9fa"}
      onMouseLeave={e => e.currentTarget.style.background = "#ffffff"}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1, minWidth: 0 }}>
        <div className={`pfs-call-icon ${log.status === "missed" ? "missed" : log.direction}`}>
          {isVideo
            ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" /></svg>
            : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 014.69 12a19.79 19.79 0 01-3.07-8.67A2 2 0 013.6 1.37h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L7.91 9a16 16 0 006.09 6.09l1.97-1.85a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7a2 2 0 011.72 2.03z" /></svg>}
        </div>
        <div className="pfs-call-info">
          <div className={`pfs-call-dir ${log.status === "missed" ? "missed" : ""}`}>
            {log.direction === "incoming" ? "↙ Incoming" : "↗ Outgoing"} {isVideo ? "Video" : "Voice"}
            {log.status !== "completed" && <span style={{ fontSize: "0.72rem", marginLeft: 6, opacity: 0.85 }}>({log.status})</span>}
          </div>
          <div className="pfs-call-meta">
            {parseTs(log.timestamp).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
          </div>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }} onClick={e => e.stopPropagation()}>
        <div className="pfs-call-dur" style={{ marginRight: 4, color: "#5e646a", fontSize: "12.5px", fontWeight: 600 }}>
          {log.status === "completed" ? fmtDuration(log.duration) : log.status}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => onCallClick?.(false)}
            className="tool-btn"
            style={{ width: 36, height: 36, minHeight: "auto", minWidth: "auto", display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "50%", background: "#f4f5f7", border: "1px solid rgba(0,0,0,0.04)", color: "#181c1f", cursor: "pointer", boxShadow: "0 2px 6px rgba(0,0,0,0.04)" }}
            title="Voice Call"
            aria-label="Quick Voice Call"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.62 3.33 2 2 0 0 1 3.6 1.37h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 9a16 16 0 0 0 6.09 6.09l1.97-1.85a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7a2 2 0 0 1 1.72 2.03z" /></svg>
          </button>
          <button
            onClick={() => onCallClick?.(true)}
            className="tool-btn"
            style={{ width: 36, height: 36, minHeight: "auto", minWidth: "auto", display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "50%", background: "#f4f5f7", border: "1px solid rgba(0,0,0,0.04)", color: "#181c1f", cursor: "pointer", boxShadow: "0 2px 6px rgba(0,0,0,0.04)" }}
            title="Video Call"
            aria-label="Quick Video Call"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" ry="2" /></svg>
          </button>
        </div>
      </div>
    </div>
  );
}
