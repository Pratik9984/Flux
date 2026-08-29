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
          {toast.type === "success" && "✓"}
          {toast.type === "error" && "✕"}
          {toast.type === "info" && "ℹ"}
        </span>
        <span>{toast.message}</span>
      </div>
    </div>
  );
}
