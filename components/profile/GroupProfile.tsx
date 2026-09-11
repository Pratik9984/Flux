"use client";

import React, { useState, useEffect, useMemo } from "react";
import { getEmail, getIsAdmin } from "@/lib/utils";
import type { Group, Chat, CallLogEntry, ProfileTab } from "@/types";
import { useAuthStore } from "@/stores/authStore";
import { useContactStore } from "@/stores/contactStore";
import { useChatStore } from "@/stores/chatStore";
import { useCallStore } from "@/stores/callStore";
import { useUiStore } from "@/stores/uiStore";
import { AvatarImage } from "@/components/ui/AvatarImage";

export interface GroupProfileProps {
  group: Group | undefined;
  activeChat: Chat;
  isUploadingGroupAvatar: boolean;
  groupAvatarInputRef: React.RefObject<HTMLInputElement | null>;
  handleGroupAvatarUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onClose: () => void;
  onCall: (video: boolean) => void;
  onAddMember: (uname: string) => Promise<void>;
  onLeaveGroup: (groupId: string | number) => Promise<void>;
  onViewFile: (url: string, type: string) => void;
  apiFetch: <T>(path: string, opts?: any) => Promise<T>;
  loadGroups: () => Promise<void>;
  onCallFromLog?: (log: CallLogEntry, video: boolean) => void;
  onAddContact?: (email: string) => void;
}

export default function GroupProfile({
  group: g,
  activeChat,
  isUploadingGroupAvatar,
  groupAvatarInputRef,
  handleGroupAvatarUpload,
  onClose,
  onCall,
  onAddMember,
  onLeaveGroup,
  onViewFile,
  apiFetch,
  loadGroups,
  onCallFromLog,
  onAddContact,
}: GroupProfileProps) {
  const currentUser = useAuthStore((s) => s.currentUser);
  const profile = useAuthStore((s) => s.profile);
  const contacts = useContactStore((s) => s.contacts);
  const nicknames = useContactStore((s) => s.nicknames);
  const setGroups = useContactStore((s) => s.setGroups);
  const messages = useChatStore((s) => s.messages);
  const callLogs = useCallStore((s) => s.callLogs);
  const showToast = useUiStore((s) => s.showToast);
  const showConfirm = useUiStore((s) => s.showConfirm);

  const [newMemberInput, setNewMemberInput] = useState("");
  const [tab, setTab] = useState<ProfileTab>("members");
  const [isEditingDesc, setIsEditingDesc] = useState(false);
  const [descInput, setDescInput] = useState(g?.description || "");
  const [savingDesc, setSavingDesc] = useState(false);
  const [memberProfiles, setMemberProfiles] = useState<Record<string, {
    display_name?: string | null; username?: string | null; avatar_url?: string | null;
  }>>({});
  const [openMenuEmail, setOpenMenuEmail] = useState<string | null>(null);

  const handleSaveDescription = async () => {
    if (!g) return;
    setSavingDesc(true);
    try {
      await apiFetch(`/groups/${g.id}`, {
        method: "PATCH",
        body: JSON.stringify({ description: descInput.trim() }),
      });
      showToast("Group description updated", "success");
      await loadGroups();
      setIsEditingDesc(false);
    } catch (err: any) {
      showToast("Failed to update description: " + (err.message || err), "error");
    } finally {
      setSavingDesc(false);
    }
  };

  const contactLabel = (c: any) =>
    nicknames[c.email] || c.display_name || (c.username ? `@${c.username}` : null) || "Unknown User";

  useEffect(() => {
    if (!openMenuEmail) return;
    const handleClose = () => setOpenMenuEmail(null);
    document.addEventListener("click", handleClose);
    return () => document.removeEventListener("click", handleClose);
  }, [openMenuEmail]);

  useEffect(() => {
    if (!g?.members) return;
    g.members.forEach(async mRaw => {
      const email = getEmail(mRaw);
      if (!email || email === currentUser || contacts.some(c => c.email === email) || memberProfiles[email]) return;
      try {
        const prof = await apiFetch<{ display_name?: string | null; username?: string | null; avatar_url?: string | null }>(`/profile/${encodeURIComponent(email)}`);
        setMemberProfiles(prev => ({ ...prev, [email]: prof }));
      } catch { }
    });
  }, [g, contacts, currentUser, apiFetch]); // eslint-disable-line

  if (!g) return null;
  const myMember = g.members.find(m => getEmail(m) === currentUser);
  const isAdmin = getIsAdmin(myMember) || g.members.length <= 1;

  const sharedMedia = useMemo(() => {
    return messages
      .filter(m => m.content.startsWith("[IMAGE]") || m.content.startsWith("[VIDEO]"))
      .map(m => ({ url: m.content.replace(/^\[IMAGE\]|\[VIDEO\]/, ""), type: m.content.startsWith("[IMAGE]") ? "image" : "video" }));
  }, [messages]);

  const grpCallLogs = useMemo(() => callLogs.filter(l => l.peer === String(activeChat.id)), [callLogs, activeChat.id]);

  const getMemberName = (mRaw: any) => {
    const email = getEmail(mRaw);
    if (email === currentUser) return profile.displayName || profile.username || email;
    const c = contacts.find(c => c.email === email);
    if (c) return contactLabel(c);
    const cached = memberProfiles[email];
    return cached?.display_name || cached?.username || email.split("@")[0];
  };

  const getMemberSub = (mRaw: any) => {
    const email = getEmail(mRaw);
    if (email === currentUser) return profile.username ? `@${profile.username}` : email;
    const c = contacts.find(c => c.email === email);
    if (c?.username) return `@${c.username}`;
    const cached = memberProfiles[email];
    if (cached?.username) return `@${cached.username}`;
    return email;
  };

  const getMemberAvatar = (mRaw: any) => {
    const email = getEmail(mRaw);
    if (email === currentUser) return profile.avatarUrl || null;
    const c = contacts.find(c => c.email === email);
    if (c?.avatar_url) return c.avatar_url;
    const cached = memberProfiles[email];
    return cached?.avatar_url || null;
  };

  const handleKickMember = async (memberEmail: string) => {
    showConfirm(`Remove ${memberEmail} from this group?`, async () => {
      try {
        await apiFetch(`/groups/${g.id}/members?member_email=${encodeURIComponent(memberEmail)}`, { method: "DELETE" });
        showToast("Member removed", "success");
        await loadGroups();
      } catch (err: any) {
        showToast("Failed to remove member: " + (err.message || err), "error");
      }
    });
  };

  const handlePromoteAdmin = async (memberEmail: string) => {
    try {
      await apiFetch(`/groups/${g.id}/members/role`, {
        method: "PATCH",
        body: JSON.stringify({ member_email: memberEmail, role: "admin" })
      });
      showToast("Member promoted to admin", "success");
      await loadGroups();
    } catch (err: any) {
      showToast("Failed to promote: " + (err.message || err), "error");
    }
  };

  const handleDemoteAdmin = async (memberEmail: string) => {
    try {
      await apiFetch(`/groups/${g.id}/members/role`, {
        method: "PATCH",
        body: JSON.stringify({ member_email: memberEmail, role: "member" })
      });
      showToast("Demoted admin to member", "success");
      await loadGroups();
    } catch (err: any) {
      showToast("Failed to demote: " + (err.message || err), "error");
    }
  };

  return (
    <div className="profile-fs-overlay" onClick={e => e.stopPropagation()}>
      <button className="pfs-back" onClick={onClose} aria-label="Back to chat">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M19 12H5M12 5l-7 7 7 7" /></svg>
      </button>

      <div className="pfs-cover">
        <div className="pfs-cover-img" /><div className="pfs-cover-bg" />
        <div className="pfs-avatar" style={{ borderRadius: "24%" }} onClick={() => { if (g.avatar_url) onViewFile(g.avatar_url, "avatar-circle"); }}>
          {g.avatar_url ? <AvatarImage src={g.avatar_url} alt="Group Avatar" className="img-cover" fallbackText={g.name} /> : g.name?.[0]?.toUpperCase() || "?"}
          {isAdmin && (
            <button
              onClick={e => { e.stopPropagation(); groupAvatarInputRef.current?.click(); }}
              className="avatar-upload-overlay"
              title="Change group avatar"
              aria-label="Change group avatar"
              style={{ display: "flex", alignItems: "center", justifyContent: "center" }}
            >
              {isUploadingGroupAvatar ? "⏳" : "📷"}
            </button>
          )}
        </div>
        <input ref={groupAvatarInputRef} type="file" accept="image/*" onChange={handleGroupAvatarUpload} style={{ display: "none" }} />
        <div className="pfs-name">{g.name}</div>
        <div className="pfs-username">{g.members.length} members</div>
      </div>

      <div className="pfs-actions">
        <button className="pfs-action-btn" onClick={() => onCall(false)}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 014.69 12a19.79 19.79 0 01-3.07-8.67A2 2 0 013.6 1.37h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L7.91 9a16 16 0 006.09 6.09l1.97-1.85a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7a2 2 0 011.72 2.03z" /></svg>
          <span className="pfs-action-label">Call Group</span>
        </button>
        <button className="pfs-action-btn" onClick={() => onCall(true)}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" /></svg>
          <span className="pfs-action-label">Video Group</span>
        </button>
        <button
          className="pfs-action-btn pfs-action-btn--danger"
          onClick={() => {
            showConfirm("Are you sure you want to leave this group?", () => {
              onLeaveGroup(g.id).then(() => onClose()).catch(() => {});
            });
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 01-2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>
          <span className="pfs-action-label">Leave Group</span>
        </button>
      </div>

      {/* Group Description Card */}
      <div className="pfs-group-desc-card" style={{ margin: "14px 16px 8px", padding: "14px 16px", background: "#ffffff", borderRadius: "16px", border: "1px solid rgba(0,0,0,0.06)", boxShadow: "0 1px 3px rgba(0,0,0,0.02)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
          <span style={{ fontSize: "11px", fontWeight: 700, color: "#6daf78", textTransform: "uppercase", letterSpacing: "0.06em" }}>Group Description</span>
          {isAdmin && !isEditingDesc && (
            <button
              onClick={() => { setDescInput(g?.description || ""); setIsEditingDesc(true); }}
              style={{ background: "none", border: "none", color: "#6daf78", cursor: "pointer", fontSize: "12.5px", fontWeight: 600, padding: 0 }}
            >
              {g?.description ? "Edit" : "Add description"}
            </button>
          )}
        </div>
        {isEditingDesc ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <textarea
              value={descInput}
              onChange={e => setDescInput(e.target.value)}
              placeholder="Add a group description..."
              rows={3}
              maxLength={500}
              style={{ width: "100%", padding: "10px 12px", borderRadius: "12px", border: "1px solid rgba(109,175,120,0.4)", outline: "none", fontSize: "13.5px", resize: "none", background: "#f9fafb", color: "#181c1f", fontFamily: "inherit" }}
              autoFocus
            />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button
                onClick={() => setIsEditingDesc(false)}
                disabled={savingDesc}
                style={{ padding: "6px 14px", borderRadius: "10px", border: "none", background: "#f4f5f7", color: "#555", fontSize: "12.5px", fontWeight: 600, cursor: "pointer" }}
              >
                Cancel
              </button>
              <button
                onClick={handleSaveDescription}
                disabled={savingDesc}
                style={{ padding: "6px 16px", borderRadius: "10px", border: "none", background: "#6daf78", color: "#ffffff", fontSize: "12.5px", fontWeight: 700, cursor: "pointer" }}
              >
                {savingDesc ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        ) : (
          <div
            onClick={() => { if (isAdmin) { setDescInput(g?.description || ""); setIsEditingDesc(true); } }}
            style={{ fontSize: "13.5px", color: g?.description ? "#181c1f" : "#8a9096", whiteSpace: "pre-wrap", lineHeight: 1.45, cursor: isAdmin ? "pointer" : "default" }}
          >
            {g?.description || (isAdmin ? "Tap to add a description for this group..." : "No description provided")}
          </div>
        )}
      </div>

      <div className="pfs-tabs">
        {(["members", "media", "calls"] as ProfileTab[]).map(t => (
          <button key={t} className={`pfs-tab ${tab === t ? "active" : ""}`} onClick={() => setTab(t)}>
            {t === "members" ? "Members" : t === "media" ? "Media" : "Calls"}
          </button>
        ))}
      </div>

      <div className="pfs-tab-content">
        {tab === "members" && (
          <div className="pfs-members-section">
            {isAdmin && (
              <div className="add-member-row" style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                <input
                  type="text"
                  placeholder="Username or email..."
                  value={newMemberInput}
                  onChange={e => setNewMemberInput(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && newMemberInput.trim()) { onAddMember(newMemberInput); setNewMemberInput(""); } }}
                  className="add-member-field"
                  style={{ flex: 1, padding: "10px 14px", background: "#f4f5f7", border: "1px solid rgba(0,0,0,0.06)", borderRadius: 12, color: "#181c1f", fontSize: "14px", outline: "none" }}
                />
                <button
                  onClick={() => { if (newMemberInput.trim()) { onAddMember(newMemberInput); setNewMemberInput(""); } }}
                  className="add-member-btn"
                  style={{ background: "#6daf78", color: "#ffffff", padding: "10px 18px", borderRadius: 12, border: "none", fontWeight: 700, cursor: "pointer" }}
                >
                  Add
                </button>
              </div>
            )}
            <div className="pfs-members-list">
              {g.members.map((m, idx) => {
                const email = getEmail(m);
                const isMemberAdmin = getIsAdmin(m);
                const isMe = email === currentUser;
                const name = getMemberName(m);
                const sub = getMemberSub(m);
                const av = getMemberAvatar(m);
                const showMenu = openMenuEmail === email;

                return (
                  <div key={idx} className="pfs-member-item" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", position: "relative", padding: "12px 14px", background: "#ffffff", borderRadius: 14, border: "1px solid rgba(0,0,0,0.05)", marginBottom: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <div className="pfs-member-av">{av ? <AvatarImage src={av} alt="avatar" className="img-cover rounded-circle" fallbackText={name} /> : name[0]?.toUpperCase() || "?"}</div>
                      <div>
                        <div className="pfs-member-name" style={{ color: "#181c1f", fontWeight: 700 }}>{name} {isMe && "(You)"}</div>
                        <div className="pfs-member-sub" style={{ color: "#8a9096", fontSize: "12px" }}>{sub}</div>
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      {!isMe && !contacts.some(c => c.email.toLowerCase() === email.toLowerCase()) && (
                        <button
                          type="button"
                          onClick={() => onAddContact && onAddContact(email)}
                          style={{
                            padding: "4px 10px",
                            borderRadius: 10,
                            border: "1px solid rgba(109, 175, 120, 0.4)",
                            background: "rgba(109, 175, 120, 0.1)",
                            color: "#4e9158",
                            fontSize: 12,
                            fontWeight: 700,
                            cursor: "pointer",
                            display: "flex",
                            alignItems: "center",
                            gap: 4,
                          }}
                        >
                          + Add
                        </button>
                      )}
                      {isMemberAdmin && <span className="admin-pill" style={{ background: "#ebf5ee", color: "#2e7d32", border: "1px solid rgba(46,125,50,0.2)", padding: "3px 10px", borderRadius: 10, fontSize: 11, fontWeight: 700 }}>Admin</span>}
                      {isAdmin && !isMe && (
                        <div style={{ position: "relative" }}>
                          <button
                            onClick={e => { e.stopPropagation(); setOpenMenuEmail(showMenu ? null : email); }}
                            className="tool-btn"
                            style={{ width: 28, height: 28, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", border: "none", background: "#f4f5f7", color: "#181c1f", cursor: "pointer" }}
                            title="Manage member"
                            aria-label="Manage member"
                          >
                            ⋮
                          </button>
                          {showMenu && (
                            <div className="member-dropdown-menu" style={{ position: "absolute", right: 0, top: 32, background: "#ffffff", border: "1px solid rgba(0,0,0,0.08)", borderRadius: 12, zIndex: 100, width: 160, boxShadow: "0 8px 24px rgba(0,0,0,0.12)", padding: "4px" }}>
                              <button
                                onClick={() => handleKickMember(email)}
                                style={{ width: "100%", padding: "10px 12px", background: "none", border: "none", color: "#d32f2f", textAlign: "left", cursor: "pointer", fontSize: "0.85rem", fontWeight: 600, borderRadius: 8 }}
                              >
                                Kick Member
                              </button>
                              {isMemberAdmin ? (
                                <button
                                  onClick={() => handleDemoteAdmin(email)}
                                  style={{ width: "100%", padding: "10px 12px", background: "none", border: "none", color: "#181c1f", textAlign: "left", cursor: "pointer", fontSize: "0.85rem", fontWeight: 600, borderRadius: 8 }}
                                >
                                  Demote from Admin
                                </button>
                              ) : (
                                <button
                                  onClick={() => handlePromoteAdmin(email)}
                                  style={{ width: "100%", padding: "10px 12px", background: "none", border: "none", color: "#181c1f", textAlign: "left", cursor: "pointer", fontSize: "0.85rem", fontWeight: 600, borderRadius: 8 }}
                                >
                                  Make Admin
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {tab === "media" && (
          <div className="pfs-media-section">
            {sharedMedia.length === 0
              ? <div className="pfs-media-empty">📷 No shared media yet</div>
              : <div className="pfs-media-grid">
                {sharedMedia.map((m, i) => (
                  <div key={i} className="pfs-media-cell" onClick={() => onViewFile(m.url, m.type)}>
                    {m.type === "image" ? <img src={m.url} alt="media" /> : <video src={m.url} />}
                  </div>
                ))}
              </div>}
          </div>
        )}
        {tab === "calls" && (
          <div className="pfs-calls-section">
            {grpCallLogs.length === 0
              ? <div className="pfs-calls-empty">📞 No group calls found</div>
              : grpCallLogs.map(log => (
                <div key={log.id} className="pfs-call-item" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div className={`pfs-call-icon ${log.status === "missed" ? "missed" : log.direction}`}>
                      {log.media === "video" ? "📹" : "📞"}
                    </div>
                    <div>
                      <div className="pfs-call-dir">{log.direction === "incoming" ? "↙ Incoming" : "↗ Outgoing"} Group Call</div>
                      <div className="pfs-call-meta">{new Date(log.timestamp).toLocaleString()}</div>
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div className="pfs-call-dur">{log.status === "completed" ? `${Math.floor(log.duration / 60)}:${(log.duration % 60).toString().padStart(2, "0")}` : log.status}</div>
                    {onCallFromLog && (
                      <button onClick={() => onCallFromLog(log, log.media === "video")} className="tool-btn" style={{ padding: "4px 8px" }}>Join</button>
                    )}
                  </div>
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}
