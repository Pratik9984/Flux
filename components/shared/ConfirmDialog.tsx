"use client";

import React from "react";
import { useUiStore } from "@/stores/uiStore";

export default function ConfirmDialog() {
  const dialog = useUiStore((state) => state.confirmDialog);
  const hideConfirm = useUiStore((state) => state.hideConfirm);

  if (!dialog) return null;

  const handleCancel = () => {
    dialog.onCancel?.();
    hideConfirm();
  };

  const handleConfirm = () => {
    dialog.onConfirm();
    hideConfirm();
  };

  return (
    <div className="modal-backdrop-sage" style={{ zIndex: 10005 }} onClick={handleCancel}>
      <div
        className="cl-modal"
        onClick={e => e.stopPropagation()}
        style={{
          maxWidth: 360,
          width: "90vw",
          padding: "24px 22px 20px",
          background: "#ffffff",
          borderRadius: 24,
          boxShadow: "0 16px 40px rgba(0,0,0,0.14)",
          border: "1px solid rgba(0,0,0,0.06)",
          display: "flex",
          flexDirection: "column",
          gap: 16
        }}
        role="dialog"
        aria-modal="true"
      >
        <div style={{ fontSize: 15, fontWeight: 700, color: "#181c1f", lineHeight: 1.45 }}>
          {dialog.message}
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
          <button
            onClick={handleCancel}
            style={{
              flex: 1,
              height: 42,
              borderRadius: 12,
              background: "#f4f5f7",
              border: "none",
              color: "#5e646a",
              fontWeight: 700,
              fontSize: 14,
              cursor: "pointer"
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            style={{
              flex: 1.2,
              height: 42,
              borderRadius: 12,
              background: "#6daf78",
              border: "none",
              color: "#ffffff",
              fontWeight: 700,
              fontSize: 14,
              cursor: "pointer",
              boxShadow: "0 4px 12px rgba(109,175,120,0.3)"
            }}
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}
