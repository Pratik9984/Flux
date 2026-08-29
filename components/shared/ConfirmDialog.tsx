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
    <div className="confirm-overlay" onClick={handleCancel}>
      <div className="confirm-modal confirm-card" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true">
        <p className="confirm-modal-desc confirm-msg">{dialog.message}</p>
        <div className="confirm-modal-actions confirm-actions">
          <button
            className="confirm-modal-btn cancel confirm-btn confirm-btn--cancel"
            onClick={handleCancel}
          >
            Cancel
          </button>
          <button
            className="confirm-modal-btn confirm-btn confirm-btn--ok"
            style={{ background: "var(--green)", color: "#000", fontWeight: 700 }}
            onClick={handleConfirm}
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}
