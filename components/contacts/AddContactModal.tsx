import React, { useState, useEffect, useRef } from "react";
import type { UserSearchResult, SuggestedContact } from "@/types";
import { searchUsersApi, fetchSuggestedContactsApi, sendContactRequestApi, acceptContactRequestApi } from "@/lib/api";
import { useContactStore } from "@/stores/contactStore";
import { useAuthStore } from "@/stores/authStore";
import { AvatarImage } from "@/components/ui/AvatarImage";

interface AddContactModalProps {
  onClose: () => void;
  onOpenChat: (contactEmail: string) => void;
  onViewMutuals?: (targetEmail: string, targetName: string) => void;
  onOpenRequests?: () => void;
}

export const AddContactModal: React.FC<AddContactModalProps> = ({
  onClose,
  onOpenChat,
  onViewMutuals,
  onOpenRequests,
}) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<UserSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [suggestions, setSuggestions] = useState<SuggestedContact[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);

  // Intro note inline state: key is target identifier
  const [noteTarget, setNoteTarget] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");
  const [sendingTarget, setSendingTarget] = useState<string | null>(null);

  const token = useAuthStore((s) => s.token);
  const myEmail = useAuthStore((s) => s.currentUser || "");
  const addOutgoingRequest = useContactStore((s) => s.addOutgoingRequest);

  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Load suggestions on open
  useEffect(() => {
    let mounted = true;
    const loadSuggestions = async () => {
      setLoadingSuggestions(true);
      try {
        const list = await fetchSuggestedContactsApi(token);
        if (mounted) setSuggestions(list);
      } catch (err) {
        console.warn("Failed to load suggestions:", err);
      } finally {
        if (mounted) setLoadingSuggestions(false);
      }
    };
    loadSuggestions();
    return () => {
      mounted = false;
    };
  }, [token]);

  // Debounced search
  useEffect(() => {
    const q = searchQuery.trim();
    if (!q) {
      setSearchResults([]);
      setIsSearching(false);
      setSearchError(null);
      return;
    }

    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(async () => {
      setIsSearching(true);
      setSearchError(null);
      try {
        const results = await searchUsersApi(q, token);
        setSearchResults(results);
      } catch (err: any) {
        setSearchError(err.message || "Failed to search users");
      } finally {
        setIsSearching(false);
      }
    }, 280);

    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, [searchQuery, token]);

  const handleSendRequest = async (target: string, note?: string) => {
    setSendingTarget(target);
    try {
      const res = await sendContactRequestApi(target, note, token);
      // Update local search results state
      setSearchResults((prev) =>
        prev.map((u) => {
          if (u.email === target || u.username === target) {
            return {
              ...u,
              relationship_status: "pending_sent",
              request_id: res.request_id || null,
            };
          }
          return u;
        })
      );
      // Remove from suggestions if present
      setSuggestions((prev) => prev.filter((u) => u.email !== target && u.username !== target));
      setNoteTarget(null);
      setNoteText("");
    } catch (err: any) {
      alert(err.message || "Could not send contact request");
    } finally {
      setSendingTarget(null);
    }
  };

  const handleAcceptInline = async (requestId: number, email: string) => {
    setSendingTarget(email);
    try {
      await acceptContactRequestApi(requestId, token);
      setSearchResults((prev) =>
        prev.map((u) => {
          if (u.email === email) {
            return { ...u, relationship_status: "contact" };
          }
          return u;
        })
      );
    } catch (err: any) {
      alert(err.message || "Could not accept request");
    } finally {
      setSendingTarget(null);
    }
  };

  return (
    <div className="modal-backdrop-sage" onClick={onClose} style={{ zIndex: 1200 }}>
      <div
        className="contacts-modal-container"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "94vw",
          maxWidth: 500,
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
              Find People
            </h2>
            <p style={{ fontSize: 13, color: "#8a9096", margin: "2px 0 0", fontWeight: 500 }}>
              Search by name or username to add contacts
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

        {/* Search Input Box */}
        <div style={{ padding: "14px 20px 8px" }}>
          <div style={{ position: "relative" }}>
            <svg
              style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "#8a9096" }}
              width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
            >
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              autoFocus
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by name or username..."
              style={{
                width: "100%",
                height: 44,
                borderRadius: 14,
                border: "1.5px solid rgba(109, 175, 120, 0.3)",
                background: "#f7f9f7",
                paddingLeft: 40,
                paddingRight: 36,
                fontSize: 14.5,
                color: "#181c1f",
                fontWeight: 500,
                outline: "none",
              }}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                style={{
                  position: "absolute",
                  right: 12,
                  top: "50%",
                  transform: "translateY(-50%)",
                  background: "none",
                  border: "none",
                  color: "#8a9096",
                  cursor: "pointer",
                  fontSize: 14,
                  fontWeight: 700,
                }}
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* Body content */}
        <div style={{ flex: 1, overflowY: "auto", padding: "10px 20px 20px" }}>
          {isSearching ? (
            <div style={{ textAlign: "center", padding: "40px 16px", color: "#8a9096" }}>
              <div
                style={{
                  width: 28,
                  height: 28,
                  border: "3px solid rgba(109, 175, 120, 0.2)",
                  borderTopColor: "#6daf78",
                  borderRadius: "50%",
                  animation: "spin 0.8s linear infinite",
                  margin: "0 auto 12px",
                }}
              />
              <span style={{ fontSize: 13, fontWeight: 500 }}>Searching Pulse users...</span>
            </div>
          ) : searchQuery.trim() ? (
            /* Search Results */
            searchResults.length === 0 ? (
              <div style={{ textAlign: "center", padding: "44px 16px" }}>
                <div
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: "50%",
                    background: "rgba(0,0,0,0.04)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    margin: "0 auto 12px",
                    color: "#8a9096",
                  }}
                >
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                </div>
                <h4 style={{ fontSize: 15, fontWeight: 700, color: "#181c1f", margin: "0 0 4px" }}>
                  No users found
                </h4>
                <p style={{ fontSize: 13, color: "#8a9096", margin: 0 }}>
                  No Pulse user matched "{searchQuery}". Check the spelling or try another name.
                </p>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#8a9096", textTransform: "uppercase", letterSpacing: 0.5 }}>
                  {searchResults.length} {searchResults.length === 1 ? "Result" : "Results"}
                </div>
                {searchResults.map((user) => {
                  const displayName = user.display_name || user.username || user.email;
                  const isPendingSend = user.relationship_status === "pending_sent";
                  const isPendingRecv = user.relationship_status === "pending_received";
                  const isContact = user.relationship_status === "contact";
                  const isBlocked = user.relationship_status === "blocked";
                  const isNoteOpen = noteTarget === user.email;
                  const isSubmitting = sendingTarget === user.email;

                  return (
                    <div
                      key={user.email}
                      style={{
                        background: "#ffffff",
                        border: "1px solid rgba(0,0,0,0.07)",
                        borderRadius: 18,
                        padding: "12px 14px",
                        display: "flex",
                        flexDirection: "column",
                        gap: 10,
                        boxShadow: "0 2px 8px rgba(0,0,0,0.02)",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                        {/* Avatar & Names */}
                        <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0, flex: 1 }}>
                          <div style={{ width: 44, height: 44, borderRadius: "50%", overflow: "hidden", flexShrink: 0 }}>
                            <AvatarImage
                              src={user.avatar_url}
                              alt={displayName}
                              fallbackText={displayName}
                              style={{ width: "100%", height: "100%", borderRadius: "50%", objectFit: "cover" }}
                            />
                          </div>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: 14.5, fontWeight: 700, color: "#181c1f", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {displayName}
                            </div>
                            <div style={{ fontSize: 12.5, color: "#8a9096", fontWeight: 500 }}>
                              {user.username ? `@${user.username}` : user.email}
                            </div>
                          </div>
                        </div>

                        {/* Action Button */}
                        <div>
                          {isContact ? (
                            <button
                              onClick={() => {
                                onClose();
                                onOpenChat(user.email);
                              }}
                              style={{
                                padding: "7px 14px",
                                borderRadius: 12,
                                border: "1px solid rgba(109, 175, 120, 0.4)",
                                background: "rgba(109, 175, 120, 0.1)",
                                color: "#4e9158",
                                fontWeight: 700,
                                fontSize: 13,
                                cursor: "pointer",
                              }}
                            >
                              Message
                            </button>
                          ) : isPendingSend ? (
                            <span
                              style={{
                                padding: "6px 12px",
                                borderRadius: 12,
                                background: "#f4f5f7",
                                color: "#8a9096",
                                fontWeight: 600,
                                fontSize: 12.5,
                              }}
                            >
                              Requested
                            </span>
                          ) : isPendingRecv ? (
                            <button
                              disabled={isSubmitting}
                              onClick={() => user.request_id && handleAcceptInline(user.request_id, user.email)}
                              style={{
                                padding: "7px 14px",
                                borderRadius: 12,
                                border: "none",
                                background: "#6daf78",
                                color: "#ffffff",
                                fontWeight: 700,
                                fontSize: 13,
                                cursor: "pointer",
                              }}
                            >
                              Accept
                            </button>
                          ) : isBlocked ? (
                            <span style={{ fontSize: 12, color: "#cf1322", fontWeight: 600 }}>Blocked</span>
                          ) : (
                            <button
                              disabled={isSubmitting}
                              onClick={() => {
                                if (isNoteOpen) {
                                  setNoteTarget(null);
                                } else {
                                  setNoteTarget(user.email);
                                  setNoteText("");
                                }
                              }}
                              style={{
                                padding: "7px 14px",
                                borderRadius: 12,
                                border: "none",
                                background: "#6daf78",
                                color: "#ffffff",
                                fontWeight: 700,
                                fontSize: 13,
                                cursor: "pointer",
                                display: "flex",
                                alignItems: "center",
                                gap: 6,
                              }}
                            >
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                              </svg>
                              Add
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Mutual Contacts Preview */}
                      {user.mutual_count > 0 && (
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <button
                            onClick={() => onViewMutuals && onViewMutuals(user.email, displayName)}
                            style={{
                              background: "rgba(0,0,0,0.03)",
                              border: "none",
                              borderRadius: 8,
                              padding: "2px 8px",
                              fontSize: 11.5,
                              color: "#4e9158",
                              fontWeight: 600,
                              cursor: onViewMutuals ? "pointer" : "default",
                              display: "flex",
                              alignItems: "center",
                              gap: 4,
                            }}
                          >
                            👥 {user.mutual_preview && user.mutual_preview.length > 0
                              ? `${user.mutual_preview[0].display_name || user.mutual_preview[0].username || "1 mutual"}${
                                  user.mutual_count > 1 ? ` + ${user.mutual_count - 1} more` : ""
                                }`
                              : `${user.mutual_count} mutual friends`}
                          </button>
                        </div>
                      )}

                      {/* Inline Intro Note Input */}
                      {isNoteOpen && (
                        <div
                          style={{
                            background: "#f7f9f7",
                            border: "1px solid rgba(109, 175, 120, 0.25)",
                            borderRadius: 14,
                            padding: "10px 12px",
                            display: "flex",
                            flexDirection: "column",
                            gap: 8,
                          }}
                        >
                          <input
                            autoFocus
                            maxLength={120}
                            value={noteText}
                            onChange={(e) => setNoteText(e.target.value)}
                            placeholder="Add an intro note (optional)..."
                            style={{
                              width: "100%",
                              background: "#ffffff",
                              border: "1px solid rgba(0,0,0,0.08)",
                              borderRadius: 10,
                              padding: "8px 10px",
                              fontSize: 13,
                              outline: "none",
                              color: "#181c1f",
                            }}
                          />
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <span style={{ fontSize: 11, color: "#8a9096" }}>
                              {120 - noteText.length} chars left
                            </span>
                            <div style={{ display: "flex", gap: 8 }}>
                              <button
                                onClick={() => setNoteTarget(null)}
                                style={{
                                  padding: "5px 10px",
                                  borderRadius: 8,
                                  border: "none",
                                  background: "none",
                                  color: "#8a9096",
                                  fontSize: 12,
                                  fontWeight: 600,
                                  cursor: "pointer",
                                }}
                              >
                                Cancel
                              </button>
                              <button
                                disabled={isSubmitting}
                                onClick={() => handleSendRequest(user.email, noteText)}
                                style={{
                                  padding: "5px 14px",
                                  borderRadius: 8,
                                  border: "none",
                                  background: "#6daf78",
                                  color: "#ffffff",
                                  fontSize: 12,
                                  fontWeight: 700,
                                  cursor: isSubmitting ? "not-allowed" : "pointer",
                                }}
                              >
                                {isSubmitting ? "Sending..." : "Send Request"}
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )
          ) : (
            /* Suggestions view when search input is empty */
            <div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: "#181c1f", textTransform: "uppercase", letterSpacing: 0.5 }}>
                  Suggested For You
                </span>
                <span style={{ fontSize: 12, color: "#8a9096" }}>Based on mutual friends</span>
              </div>

              {loadingSuggestions ? (
                <div style={{ textAlign: "center", padding: "30px 0", color: "#8a9096", fontSize: 13 }}>
                  Loading suggestions...
                </div>
              ) : suggestions.length === 0 ? (
                <div style={{ textAlign: "center", padding: "32px 16px", color: "#8a9096", fontSize: 13 }}>
                  No suggestions right now. Search above to find contacts by name or username.
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {suggestions.map((user) => {
                    const displayName = user.display_name || user.username || user.email;
                    const isSubmitting = sendingTarget === user.email;
                    const isNoteOpen = noteTarget === user.email;

                    return (
                      <div
                        key={user.email}
                        style={{
                          background: "#f9fafb",
                          border: "1px solid rgba(0,0,0,0.06)",
                          borderRadius: 18,
                          padding: "12px 14px",
                          display: "flex",
                          flexDirection: "column",
                          gap: 10,
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0, flex: 1 }}>
                            <div style={{ width: 44, height: 44, borderRadius: "50%", overflow: "hidden", flexShrink: 0 }}>
                              <AvatarImage
                                src={user.avatar_url}
                                alt={displayName}
                                fallbackText={displayName}
                                style={{ width: "100%", height: "100%", borderRadius: "50%", objectFit: "cover" }}
                              />
                            </div>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontSize: 14.5, fontWeight: 700, color: "#181c1f", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {displayName}
                              </div>
                              <div style={{ fontSize: 12.5, color: "#8a9096", fontWeight: 500 }}>
                                {user.username ? `@${user.username}` : user.email}
                              </div>
                            </div>
                          </div>

                          <button
                            disabled={isSubmitting}
                            onClick={() => {
                              if (isNoteOpen) {
                                setNoteTarget(null);
                              } else {
                                setNoteTarget(user.email);
                                setNoteText("");
                              }
                            }}
                            style={{
                              padding: "7px 14px",
                              borderRadius: 12,
                              border: "none",
                              background: "#6daf78",
                              color: "#ffffff",
                              fontWeight: 700,
                              fontSize: 13,
                              cursor: "pointer",
                              display: "flex",
                              alignItems: "center",
                              gap: 6,
                            }}
                          >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                            </svg>
                            Add
                          </button>
                        </div>

                        {/* Mutuals pill */}
                        {user.mutual_count > 0 && (
                          <div>
                            <button
                              onClick={() => onViewMutuals && onViewMutuals(user.email, displayName)}
                              style={{
                                background: "rgba(0,0,0,0.04)",
                                border: "none",
                                borderRadius: 8,
                                padding: "2px 8px",
                                fontSize: 11.5,
                                color: "#4e9158",
                                fontWeight: 600,
                                cursor: onViewMutuals ? "pointer" : "default",
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 4,
                              }}
                            >
                              👥 {user.mutual_preview && user.mutual_preview.length > 0
                                ? `${user.mutual_preview[0].display_name || user.mutual_preview[0].username || "1 mutual"}${
                                    user.mutual_count > 1 ? ` + ${user.mutual_count - 1} more` : ""
                                  }`
                                : `${user.mutual_count} mutual friends`}
                            </button>
                          </div>
                        )}

                        {/* Inline Note */}
                        {isNoteOpen && (
                          <div
                            style={{
                              background: "#ffffff",
                              border: "1px solid rgba(109, 175, 120, 0.25)",
                              borderRadius: 14,
                              padding: "10px 12px",
                              display: "flex",
                              flexDirection: "column",
                              gap: 8,
                            }}
                          >
                            <input
                              autoFocus
                              maxLength={120}
                              value={noteText}
                              onChange={(e) => setNoteText(e.target.value)}
                              placeholder="Add an intro note (optional)..."
                              style={{
                                width: "100%",
                                background: "#f7f9f7",
                                border: "1px solid rgba(0,0,0,0.08)",
                                borderRadius: 10,
                                padding: "8px 10px",
                                fontSize: 13,
                                outline: "none",
                                color: "#181c1f",
                              }}
                            />
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                              <span style={{ fontSize: 11, color: "#8a9096" }}>
                                {120 - noteText.length} chars left
                              </span>
                              <div style={{ display: "flex", gap: 8 }}>
                                <button
                                  onClick={() => setNoteTarget(null)}
                                  style={{
                                    padding: "5px 10px",
                                    borderRadius: 8,
                                    border: "none",
                                    background: "none",
                                    color: "#8a9096",
                                    fontSize: 12,
                                    fontWeight: 600,
                                    cursor: "pointer",
                                  }}
                                >
                                  Cancel
                                </button>
                                <button
                                  disabled={isSubmitting}
                                  onClick={() => handleSendRequest(user.email, noteText)}
                                  style={{
                                    padding: "5px 14px",
                                    borderRadius: 8,
                                    border: "none",
                                    background: "#6daf78",
                                    color: "#ffffff",
                                    fontSize: 12,
                                    fontWeight: 700,
                                    cursor: isSubmitting ? "not-allowed" : "pointer",
                                  }}
                                >
                                  {isSubmitting ? "Sending..." : "Send Request"}
                                </button>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
