import React, { useState, useMemo } from "react";
import type { Contact } from "@/types";
import { useContactStore } from "@/stores/contactStore";
import { AvatarImage } from "@/components/ui/AvatarImage";

interface ContactsModalProps {
  onClose: () => void;
  onSelectContact: (contact: Contact) => void;
  onOpenAddContact: () => void;
  onOpenRequests: () => void;
  onOpenQR: () => void;
  onStartCall?: (contact: Contact, isVideo: boolean) => void;
  onToggleFavorite?: (email: string) => void;
}

export const ContactsModal: React.FC<ContactsModalProps> = ({
  onClose,
  onSelectContact,
  onOpenAddContact,
  onOpenRequests,
  onOpenQR,
  onStartCall,
  onToggleFavorite,
}) => {
  const [search, setSearch] = useState("");
  const contacts = useContactStore((s) => s.contacts);
  const incomingRequests = useContactStore((s) => s.incomingRequests);
  const nicknames = useContactStore((s) => s.nicknames);

  const getDisplayName = (c: Contact) => {
    return nicknames[c.email] || c.display_name || c.username || c.email;
  };

  const filteredContacts = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter((c) => {
      const name = getDisplayName(c).toLowerCase();
      const uname = (c.username || "").toLowerCase();
      const email = c.email.toLowerCase();
      return name.includes(q) || uname.includes(q) || email.includes(q);
    });
  }, [contacts, search, nicknames]);

  // Favorites
  const favoriteContacts = useMemo(() => {
    return filteredContacts.filter((c) => c.is_favorite);
  }, [filteredContacts]);

  // Alphabetical groups (A-Z)
  const groupedContacts = useMemo(() => {
    const map: Record<string, Contact[]> = {};
    const sorted = [...filteredContacts].sort((a, b) =>
      getDisplayName(a).localeCompare(getDisplayName(b))
    );

    for (const c of sorted) {
      const firstChar = getDisplayName(c).charAt(0).toUpperCase();
      const key = /[A-Z]/.test(firstChar) ? firstChar : "#";
      if (!map[key]) map[key] = [];
      map[key].push(c);
    }
    return map;
  }, [filteredContacts, nicknames]);

  return (
    <div className="modal-backdrop-sage" onClick={onClose}>
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
          boxShadow: "0 20px 60px rgba(0, 0, 0, 0.15)",
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
              Contacts
            </h2>
            <p style={{ fontSize: 13, color: "#8a9096", margin: "2px 0 0", fontWeight: 500 }}>
              {contacts.length} {contacts.length === 1 ? "contact" : "contacts"} on Pulse
            </p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              onClick={onOpenQR}
              title="My QR Code"
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
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
              </svg>
            </button>
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
        </div>

        {/* Action Header Tiles */}
        <div style={{ padding: "12px 20px 6px", display: "flex", flexDirection: "column", gap: 10 }}>
          {/* Search bar */}
          <div style={{ position: "relative" }}>
            <svg
              style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "#8a9096" }}
              width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
            >
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search contacts..."
              style={{
                width: "100%",
                height: 42,
                borderRadius: 14,
                border: "1.5px solid rgba(0,0,0,0.06)",
                background: "#f4f5f7",
                paddingLeft: 38,
                paddingRight: 14,
                fontSize: 14,
                color: "#181c1f",
                fontWeight: 500,
                outline: "none",
              }}
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "#8a9096", cursor: "pointer", fontSize: 13, fontWeight: 700 }}
              >
                ✕
              </button>
            )}
          </div>

          {/* Quick Action Tiles */}
          <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
            <button
              onClick={onOpenAddContact}
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                background: "rgba(109, 175, 120, 0.12)",
                border: "1px solid rgba(109, 175, 120, 0.25)",
                borderRadius: 14,
                padding: "10px 14px",
                color: "#4e9158",
                fontWeight: 700,
                fontSize: 13.5,
                cursor: "pointer",
                transition: "all 0.15s ease",
              }}
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="8.5" cy="7" r="4" /><line x1="20" y1="8" x2="20" y2="14" /><line x1="23" y1="11" x2="17" y2="11" />
              </svg>
              Find People
            </button>

            <button
              onClick={onOpenRequests}
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                background: incomingRequests.length > 0 ? "#6daf78" : "#f4f5f7",
                border: "none",
                borderRadius: 14,
                padding: "10px 14px",
                color: incomingRequests.length > 0 ? "#ffffff" : "#181c1f",
                fontWeight: 700,
                fontSize: 13.5,
                cursor: "pointer",
                boxShadow: incomingRequests.length > 0 ? "0 4px 12px rgba(109, 175, 120, 0.35)" : "none",
                transition: "all 0.15s ease",
              }}
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
              Requests
              {incomingRequests.length > 0 && (
                <span
                  style={{
                    background: "#ffffff",
                    color: "#4e9158",
                    fontSize: 11,
                    fontWeight: 800,
                    padding: "2px 7px",
                    borderRadius: 10,
                  }}
                >
                  {incomingRequests.length}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Contact List (Scrollable) */}
        <div style={{ flex: 1, overflowY: "auto", padding: "10px 20px 20px" }}>
          {contacts.length === 0 ? (
            <div style={{ textAlign: "center", padding: "40px 20px" }}>
              <div
                style={{
                  width: 58,
                  height: 58,
                  borderRadius: "50%",
                  background: "rgba(109, 175, 120, 0.12)",
                  color: "#6daf78",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  margin: "0 auto 14px",
                }}
              >
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
              </div>
              <h3 style={{ fontSize: 16, fontWeight: 700, color: "#181c1f", margin: "0 0 6px" }}>
                No Contacts Yet
              </h3>
              <p style={{ fontSize: 13, color: "#8a9096", margin: "0 0 18px" }}>
                Search by username or scan a QR code to send contact requests.
              </p>
              <button
                onClick={onOpenAddContact}
                style={{
                  background: "#6daf78",
                  color: "#ffffff",
                  border: "none",
                  borderRadius: 14,
                  padding: "10px 22px",
                  fontSize: 14,
                  fontWeight: 700,
                  cursor: "pointer",
                  boxShadow: "0 4px 12px rgba(109, 175, 120, 0.3)",
                }}
              >
                + Find People
              </button>
            </div>
          ) : filteredContacts.length === 0 ? (
            <div style={{ textAlign: "center", padding: "40px 20px", color: "#8a9096", fontSize: 14 }}>
              No contacts found matching &ldquo;{search}&rdquo;
            </div>
          ) : (
            <>
              {/* Starred / Favorites */}
              {favoriteContacts.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: "#8a9096", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>
                    ★ Starred Contacts
                  </div>
                  {favoriteContacts.map((c) => renderContactRow(c))}
                </div>
              )}

              {/* Alphabetical sections */}
              {Object.keys(groupedContacts)
                .sort()
                .map((letter) => (
                  <div key={letter} style={{ marginBottom: 16 }}>
                    <div
                      style={{
                        fontSize: 12,
                        fontWeight: 800,
                        color: "#6daf78",
                        marginBottom: 6,
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                      }}
                    >
                      <span>{letter}</span>
                      <div style={{ flex: 1, height: 1, background: "rgba(0,0,0,0.05)" }} />
                    </div>
                    {groupedContacts[letter].map((c) => renderContactRow(c))}
                  </div>
                ))}
            </>
          )}
        </div>
      </div>
    </div>
  );

  function renderContactRow(c: Contact) {
    const name = getDisplayName(c);
    return (
      <div
        key={c.email}
        onClick={() => onSelectContact(c)}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 10px",
          borderRadius: 16,
          cursor: "pointer",
          transition: "background 0.15s ease",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = "#f8f9fa")}
        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1, minWidth: 0 }}>
          {/* Avatar (Always Visible) */}
          <div style={{ position: "relative", flexShrink: 0, width: 44, height: 44, borderRadius: "50%", overflow: "hidden" }}>
            <AvatarImage
              src={c.avatar_url}
              alt={name}
              fallbackText={name}
              style={{ width: "100%", height: "100%", borderRadius: "50%", objectFit: "cover" }}
            />
            {c.is_online && (
              <div
                style={{
                  position: "absolute",
                  bottom: 1,
                  right: 1,
                  width: 11,
                  height: 11,
                  borderRadius: "50%",
                  background: "#48bb78",
                  border: "2px solid #ffffff",
                }}
              />
            )}
          </div>

          {/* Info */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 14.5, fontWeight: 700, color: "#181c1f", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {name}
              </span>
              {c.username && (
                <span style={{ fontSize: 12, color: "#8a9096", fontWeight: 500 }}>
                  @{c.username}
                </span>
              )}
            </div>
            <p style={{ fontSize: 12.5, color: "#8a9096", margin: "2px 0 0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {c.about || "Available on Pulse"}
            </p>
          </div>
        </div>

        {/* Quick action buttons */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
          {onToggleFavorite && (
            <button
              onClick={() => onToggleFavorite(c.email)}
              title={c.is_favorite ? "Remove from Starred" : "Add to Starred"}
              style={{
                width: 32,
                height: 32,
                borderRadius: "50%",
                background: "transparent",
                border: "none",
                color: c.is_favorite ? "#f6ad55" : "#cbd5e0",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                fontSize: 16,
              }}
            >
              ★
            </button>
          )}
          {onStartCall && (
            <button
              onClick={() => onStartCall(c, false)}
              title="Voice Call"
              style={{
                width: 32,
                height: 32,
                borderRadius: "50%",
                background: "rgba(109, 175, 120, 0.12)",
                border: "none",
                color: "#4e9158",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
              }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
              </svg>
            </button>
          )}
        </div>
      </div>
    );
  }
};
