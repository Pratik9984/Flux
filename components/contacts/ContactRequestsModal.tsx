import React, { useState } from "react";
import type { ContactRequest } from "@/types";
import { useContactStore } from "@/stores/contactStore";
import { AvatarImage } from "@/components/ui/AvatarImage";

interface ContactRequestsModalProps {
  onClose: () => void;
  onAcceptRequest: (req: ContactRequest) => Promise<void>;
  onDeclineRequest: (req: ContactRequest) => Promise<void>;
  onDeclineAndBlock: (req: ContactRequest) => Promise<void>;
  onCancelRequest: (req: ContactRequest) => Promise<void>;
  onViewMutuals?: (targetEmail: string, targetName: string) => void;
}

export const ContactRequestsModal: React.FC<ContactRequestsModalProps> = ({
  onClose,
  onAcceptRequest,
  onDeclineRequest,
  onDeclineAndBlock,
  onCancelRequest,
  onViewMutuals,
}) => {
  const [activeTab, setActiveTab] = useState<"received" | "sent">("received");
  const [processingId, setProcessingId] = useState<number | null>(null);
  const [confirmBlockId, setConfirmBlockId] = useState<number | null>(null);

  const incomingRequests = useContactStore((s) => s.incomingRequests);
  const outgoingRequests = useContactStore((s) => s.outgoingRequests);

  const handleAccept = async (req: ContactRequest) => {
    setProcessingId(req.id);
    try {
      await onAcceptRequest(req);
    } finally {
      setProcessingId(null);
    }
  };

  const handleDecline = async (req: ContactRequest) => {
    setProcessingId(req.id);
    try {
      await onDeclineRequest(req);
    } finally {
      setProcessingId(null);
    }
  };

  const handleDeclineAndBlock = async (req: ContactRequest) => {
    setProcessingId(req.id);
    try {
      await onDeclineAndBlock(req);
      setConfirmBlockId(null);
    } finally {
      setProcessingId(null);
    }
  };

  const handleCancel = async (req: ContactRequest) => {
    setProcessingId(req.id);
    try {
      await onCancelRequest(req);
    } finally {
      setProcessingId(null);
    }
  };

  const formatRelativeTime = (iso?: string) => {
    if (!iso) return "";
    try {
      const diffSec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
      if (diffSec < 60) return "Just now";
      if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
      if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
      return `${Math.floor(diffSec / 86400)}d ago`;
    } catch {
      return "";
    }
  };

  return (
    <div className="modal-backdrop-sage" onClick={onClose} style={{ zIndex: 1200 }}>
      <div
        className="contacts-modal-container"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "94vw",
          maxWidth: 480,
          maxHeight: "88vh",
          borderRadius: 28,
          background: "#ffffff",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: "0 20px 60px rgba(0, 0, 0, 0.18)",
          border: "1px solid rgba(0,0,0,0.06)",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "20px 22px 14px",
            borderBottom: "1px solid rgba(0,0,0,0.06)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: "#ffffff",
          }}
        >
          <div>
            <h2 style={{ fontSize: 21, fontWeight: 800, color: "#181c1f", margin: 0 }}>
              Contact Requests
            </h2>
            <p style={{ fontSize: 13, color: "#8a9096", margin: "2px 0 0", fontWeight: 500 }}>
              Manage incoming and outgoing invites
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              width: 36,
              height: 36,
              borderRadius: "50%",
              background: "#f4f5f7",
              border: "none",
              color: "#181c1f",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              fontSize: 14,
              fontWeight: 700,
            }}
          >
            ✕
          </button>
        </div>

        {/* Tab switcher */}
        <div style={{ padding: "12px 20px 8px", display: "flex", gap: 8 }}>
          <button
            onClick={() => setActiveTab("received")}
            style={{
              flex: 1,
              padding: "10px 14px",
              borderRadius: 14,
              border: "none",
              background: activeTab === "received" ? "#6daf78" : "#f4f5f7",
              color: activeTab === "received" ? "#ffffff" : "#60646c",
              fontWeight: 700,
              fontSize: 13.5,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              transition: "all 0.15s ease",
            }}
          >
            Received
            {incomingRequests.length > 0 && (
              <span
                style={{
                  background: activeTab === "received" ? "rgba(255,255,255,0.3)" : "#6daf78",
                  color: "#ffffff",
                  fontSize: 11,
                  fontWeight: 800,
                  borderRadius: 10,
                  padding: "1px 7px",
                  lineHeight: "16px",
                }}
              >
                {incomingRequests.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab("sent")}
            style={{
              flex: 1,
              padding: "10px 14px",
              borderRadius: 14,
              border: "none",
              background: activeTab === "sent" ? "#6daf78" : "#f4f5f7",
              color: activeTab === "sent" ? "#ffffff" : "#60646c",
              fontWeight: 700,
              fontSize: 13.5,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              transition: "all 0.15s ease",
            }}
          >
            Sent
            {outgoingRequests.length > 0 && (
              <span
                style={{
                  background: activeTab === "sent" ? "rgba(255,255,255,0.3)" : "#8a9096",
                  color: "#ffffff",
                  fontSize: 11,
                  fontWeight: 800,
                  borderRadius: 10,
                  padding: "1px 7px",
                  lineHeight: "16px",
                }}
              >
                {outgoingRequests.length}
              </span>
            )}
          </button>
        </div>

        {/* Request List */}
        <div style={{ flex: 1, overflowY: "auto", padding: "10px 20px 20px" }}>
          {activeTab === "received" ? (
            incomingRequests.length === 0 ? (
              <div style={{ textAlign: "center", padding: "48px 16px" }}>
                <div
                  style={{
                    width: 64,
                    height: 64,
                    borderRadius: "50%",
                    background: "rgba(109, 175, 120, 0.12)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    margin: "0 auto 16px",
                    color: "#6daf78",
                  }}
                >
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="8.5" cy="7" r="4" /><polyline points="17 11 19 13 23 9" />
                  </svg>
                </div>
                <h4 style={{ fontSize: 16, fontWeight: 700, color: "#181c1f", margin: "0 0 6px" }}>
                  No Pending Requests
                </h4>
                <p style={{ fontSize: 13, color: "#8a9096", margin: 0, lineHeight: 1.4 }}>
                  When someone adds you as a contact on Pulse, their request will appear here.
                </p>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {incomingRequests.map((req) => {
                  const u = req.user || {
                    email: req.sender_email,
                    username: null,
                    display_name: req.sender_email.split("@")[0],
                    avatar_url: null,
                    about: null,
                  };
                  const displayName = u.display_name || u.username || u.email;
                  const isProcessing = processingId === req.id;
                  const isConfirmingBlock = confirmBlockId === req.id;

                  return (
                    <div
                      key={req.id}
                      style={{
                        background: "#f9fafb",
                        border: "1px solid rgba(0,0,0,0.06)",
                        borderRadius: 18,
                        padding: "14px 16px",
                        display: "flex",
                        flexDirection: "column",
                        gap: 10,
                        transition: "all 0.15s ease",
                      }}
                    >
                      {/* User Info Header */}
                      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <div style={{ width: 46, height: 46, borderRadius: "50%", overflow: "hidden", flexShrink: 0 }}>
                          <AvatarImage
                            src={u.avatar_url}
                            alt={displayName}
                            fallbackText={displayName}
                            style={{ width: "100%", height: "100%", borderRadius: "50%", objectFit: "cover" }}
                          />
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                            <div style={{ fontSize: 14.5, fontWeight: 700, color: "#181c1f", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {displayName}
                            </div>
                            <span style={{ fontSize: 11, color: "#8a9096", fontWeight: 500 }}>
                              {formatRelativeTime(req.created_at)}
                            </span>
                          </div>
                          {u.username && (
                            <div style={{ fontSize: 12.5, color: "#8a9096", fontWeight: 500 }}>
                              @{u.username}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Optional Intro Note */}
                      {req.note && (
                        <div
                          style={{
                            background: "rgba(109, 175, 120, 0.08)",
                            borderLeft: "3px solid #6daf78",
                            borderRadius: "0 10px 10px 0",
                            padding: "8px 12px",
                            fontSize: 12.5,
                            color: "#2c3e2e",
                            fontStyle: "italic",
                            lineHeight: 1.4,
                          }}
                        >
                          “{req.note}”
                        </div>
                      )}

                      {/* Mutual Contacts & Groups Summary */}
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                        {req.mutual_count > 0 ? (
                          <button
                            onClick={() => onViewMutuals && onViewMutuals(req.sender_email, displayName)}
                            style={{
                              background: "rgba(0,0,0,0.04)",
                              border: "none",
                              borderRadius: 10,
                              padding: "3px 8px",
                              fontSize: 11.5,
                              color: "#4e9158",
                              fontWeight: 600,
                              display: "flex",
                              alignItems: "center",
                              gap: 4,
                              cursor: onViewMutuals ? "pointer" : "default",
                            }}
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
                            </svg>
                            {req.mutual_preview && req.mutual_preview.length > 0
                              ? `${req.mutual_preview[0].display_name || req.mutual_preview[0].username || "1 friend"}${
                                  req.mutual_count > 1 ? ` + ${req.mutual_count - 1} more` : ""
                                }`
                              : `${req.mutual_count} mutual ${req.mutual_count === 1 ? "friend" : "friends"}`}
                          </button>
                        ) : null}

                        {req.shared_groups_count && req.shared_groups_count > 0 ? (
                          <span
                            style={{
                              background: "rgba(0,0,0,0.04)",
                              borderRadius: 10,
                              padding: "3px 8px",
                              fontSize: 11.5,
                              color: "#60646c",
                              fontWeight: 600,
                            }}
                          >
                            💬 {req.shared_groups_count} shared {req.shared_groups_count === 1 ? "group" : "groups"}
                          </span>
                        ) : null}
                      </div>

                      {/* Action buttons */}
                      {isConfirmingBlock ? (
                        <div
                          style={{
                            background: "#fff1f0",
                            border: "1px solid #ffa39e",
                            borderRadius: 12,
                            padding: "10px 12px",
                            display: "flex",
                            flexDirection: "column",
                            gap: 8,
                          }}
                        >
                          <div style={{ fontSize: 12, color: "#cf1322", fontWeight: 600 }}>
                            Decline & block @{u.username || displayName}? They won't be able to request or message you.
                          </div>
                          <div style={{ display: "flex", gap: 8 }}>
                            <button
                              disabled={isProcessing}
                              onClick={() => handleDeclineAndBlock(req)}
                              style={{
                                flex: 1,
                                padding: "6px 12px",
                                borderRadius: 8,
                                border: "none",
                                background: "#ff4d4f",
                                color: "#ffffff",
                                fontWeight: 700,
                                fontSize: 12,
                                cursor: "pointer",
                              }}
                            >
                              Confirm Block
                            </button>
                            <button
                              onClick={() => setConfirmBlockId(null)}
                              style={{
                                flex: 1,
                                padding: "6px 12px",
                                borderRadius: 8,
                                border: "1px solid rgba(0,0,0,0.12)",
                                background: "#ffffff",
                                color: "#181c1f",
                                fontWeight: 600,
                                fontSize: 12,
                                cursor: "pointer",
                              }}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                          <button
                            disabled={isProcessing}
                            onClick={() => handleAccept(req)}
                            style={{
                              flex: 1.5,
                              padding: "8px 14px",
                              borderRadius: 12,
                              border: "none",
                              background: "#6daf78",
                              color: "#ffffff",
                              fontWeight: 700,
                              fontSize: 13,
                              cursor: isProcessing ? "not-allowed" : "pointer",
                              opacity: isProcessing ? 0.6 : 1,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              gap: 6,
                              boxShadow: "0 2px 8px rgba(109, 175, 120, 0.25)",
                            }}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                            Accept
                          </button>

                          <button
                            disabled={isProcessing}
                            onClick={() => handleDecline(req)}
                            style={{
                              flex: 1,
                              padding: "8px 12px",
                              borderRadius: 12,
                              border: "none",
                              background: "#f4f5f7",
                              color: "#60646c",
                              fontWeight: 600,
                              fontSize: 13,
                              cursor: isProcessing ? "not-allowed" : "pointer",
                            }}
                          >
                            Decline
                          </button>

                          <button
                            disabled={isProcessing}
                            onClick={() => setConfirmBlockId(req.id)}
                            title="Decline & Block"
                            style={{
                              width: 36,
                              height: 36,
                              borderRadius: 12,
                              border: "none",
                              background: "#f4f5f7",
                              color: "#8a9096",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              cursor: "pointer",
                            }}
                          >
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                              <circle cx="12" cy="12" r="10" /><line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
                            </svg>
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )
          ) : (
            outgoingRequests.length === 0 ? (
              <div style={{ textAlign: "center", padding: "48px 16px" }}>
                <div
                  style={{
                    width: 64,
                    height: 64,
                    borderRadius: "50%",
                    background: "rgba(0, 0, 0, 0.04)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    margin: "0 auto 16px",
                    color: "#8a9096",
                  }}
                >
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
                  </svg>
                </div>
                <h4 style={{ fontSize: 16, fontWeight: 700, color: "#181c1f", margin: "0 0 6px" }}>
                  No Sent Requests
                </h4>
                <p style={{ fontSize: 13, color: "#8a9096", margin: 0, lineHeight: 1.4 }}>
                  Contact requests you send to other users will appear here while waiting for them to accept.
                </p>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {outgoingRequests.map((req) => {
                  const u = req.user || {
                    email: req.receiver_email,
                    username: null,
                    display_name: req.receiver_email.split("@")[0],
                    avatar_url: null,
                    about: null,
                  };
                  const displayName = u.display_name || u.username || u.email;
                  const isProcessing = processingId === req.id;

                  return (
                    <div
                      key={req.id}
                      style={{
                        background: "#f9fafb",
                        border: "1px solid rgba(0,0,0,0.06)",
                        borderRadius: 18,
                        padding: "14px 16px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 12,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0, flex: 1 }}>
                        <div style={{ width: 44, height: 44, borderRadius: "50%", overflow: "hidden", flexShrink: 0 }}>
                          <AvatarImage
                            src={u.avatar_url}
                            alt={displayName}
                            fallbackText={displayName}
                            style={{ width: "100%", height: "100%", borderRadius: "50%", objectFit: "cover" }}
                          />
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 14, fontWeight: 700, color: "#181c1f", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {displayName}
                          </div>
                          <div style={{ fontSize: 12, color: "#8a9096", fontWeight: 500 }}>
                            {u.username ? `@${u.username} • ` : ""}Pending
                          </div>
                        </div>
                      </div>

                      <button
                        disabled={isProcessing}
                        onClick={() => handleCancel(req)}
                        style={{
                          padding: "6px 12px",
                          borderRadius: 10,
                          border: "1px solid rgba(0,0,0,0.12)",
                          background: "#ffffff",
                          color: "#60646c",
                          fontWeight: 600,
                          fontSize: 12,
                          cursor: isProcessing ? "not-allowed" : "pointer",
                          opacity: isProcessing ? 0.5 : 1,
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  );
                })}
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
};
