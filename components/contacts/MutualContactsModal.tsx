import React, { useState, useEffect } from "react";
import type { MutualPreviewUser, Contact } from "@/types";
import { fetchMutualContactsApi } from "@/lib/api";
import { useAuthStore } from "@/stores/authStore";
import { AvatarImage } from "@/components/ui/AvatarImage";

interface MutualContactsModalProps {
  targetEmail: string;
  targetName: string;
  onClose: () => void;
  onSelectContact?: (contact: Contact) => void;
}

export const MutualContactsModal: React.FC<MutualContactsModalProps> = ({
  targetEmail,
  targetName,
  onClose,
  onSelectContact,
}) => {
  const [mutuals, setMutuals] = useState<MutualPreviewUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const token = useAuthStore((s) => s.token);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const list = await fetchMutualContactsApi(targetEmail, token);
        if (mounted) setMutuals(list);
      } catch (err: any) {
        if (mounted) setError(err.message || "Failed to load mutual contacts");
      } finally {
        if (mounted) setLoading(false);
      }
    };
    load();
    return () => {
      mounted = false;
    };
  }, [targetEmail, token]);

  return (
    <div className="modal-backdrop-sage" onClick={onClose} style={{ zIndex: 1250 }}>
      <div
        className="contacts-modal-container"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "92vw",
          maxWidth: 440,
          maxHeight: "80vh",
          borderRadius: 26,
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
            padding: "18px 20px 14px",
            borderBottom: "1px solid rgba(0,0,0,0.06)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div>
            <h3 style={{ fontSize: 18, fontWeight: 800, color: "#181c1f", margin: 0 }}>
              Mutual Contacts
            </h3>
            <p style={{ fontSize: 12.5, color: "#8a9096", margin: "2px 0 0", fontWeight: 500 }}>
              Shared with {targetName}
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              width: 32,
              height: 32,
              borderRadius: "50%",
              background: "#f4f5f7",
              border: "none",
              color: "#181c1f",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              fontSize: 13,
              fontWeight: 700,
            }}
          >
            ✕
          </button>
        </div>

        {/* List Content */}
        <div style={{ flex: 1, overflowY: "auto", padding: "14px 18px 18px" }}>
          {loading ? (
            <div style={{ textAlign: "center", padding: "40px 16px", color: "#8a9096" }}>
              <div
                style={{
                  width: 24,
                  height: 24,
                  border: "2.5px solid rgba(109, 175, 120, 0.25)",
                  borderTopColor: "#6daf78",
                  borderRadius: "50%",
                  animation: "spin 0.8s linear infinite",
                  margin: "0 auto 10px",
                }}
              />
              <span style={{ fontSize: 13, fontWeight: 500 }}>Loading mutual contacts...</span>
            </div>
          ) : error ? (
            <div style={{ textAlign: "center", padding: "30px 16px", color: "#cf1322", fontSize: 13 }}>
              {error}
            </div>
          ) : mutuals.length === 0 ? (
            <div style={{ textAlign: "center", padding: "36px 16px", color: "#8a9096" }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>👥</div>
              <p style={{ fontSize: 14, fontWeight: 600, margin: 0, color: "#181c1f" }}>
                No mutual contacts
              </p>
              <p style={{ fontSize: 12.5, margin: "4px 0 0" }}>
                You and {targetName} don't share any contacts yet.
              </p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: "#8a9096", textTransform: "uppercase", letterSpacing: 0.5 }}>
                {mutuals.length} Mutual {mutuals.length === 1 ? "Contact" : "Contacts"}
              </div>

              {mutuals.map((user) => {
                const displayName = user.display_name || user.username || user.email;
                return (
                  <div
                    key={user.email}
                    onClick={() => {
                      if (onSelectContact) {
                        onClose();
                        onSelectContact({
                          email: user.email,
                          username: user.username,
                          display_name: user.display_name,
                          avatar_url: user.avatar_url,
                        });
                      }
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "10px 12px",
                      borderRadius: 14,
                      background: "#f9fafb",
                      cursor: onSelectContact ? "pointer" : "default",
                      transition: "background 0.15s ease",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                      <div style={{ width: 40, height: 40, borderRadius: "50%", overflow: "hidden", flexShrink: 0 }}>
                        <AvatarImage
                          src={user.avatar_url}
                          alt={displayName}
                          fallbackText={displayName}
                          style={{ width: "100%", height: "100%", borderRadius: "50%", objectFit: "cover" }}
                        />
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 700, color: "#181c1f", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {displayName}
                        </div>
                        {user.username && (
                          <div style={{ fontSize: 12, color: "#8a9096", fontWeight: 500 }}>
                            @{user.username}
                          </div>
                        )}
                      </div>
                    </div>

                    {onSelectContact && (
                      <button
                        style={{
                          padding: "6px 12px",
                          borderRadius: 10,
                          border: "none",
                          background: "rgba(109, 175, 120, 0.12)",
                          color: "#4e9158",
                          fontSize: 12,
                          fontWeight: 700,
                          cursor: "pointer",
                        }}
                      >
                        Chat
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
