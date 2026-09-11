"use client";

import React from "react";
import { useUiStore } from "@/stores/uiStore";

export default function Toast() {
  const toast = useUiStore((state) => state.toast);
  if (!toast) return null;

  return (
    <div className="toast-container">
      <div className={`toast-notification toast-notification--${toast.type}`}>
        <span className="toast-icon">
          {toast.type === "success" && (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          )}
          {toast.type === "error" && (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          )}
          {toast.type === "info" && (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
          )}
        </span>
        <span className="toast-msg-text">{toast.message}</span>
      </div>
    </div>
  );
}
