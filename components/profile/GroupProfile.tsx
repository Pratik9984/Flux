"use client";

import React, { useState, useEffect, useMemo } from "react";
import { getEmail, getIsAdmin } from "@/lib/utils";
import type { Group, Chat, CallLogEntry, ProfileTab } from "@/types";
import { useAuthStore } from "@/stores/authStore";
import { useContactStore } from "@/stores/contactStore";
import { useChatStore } from "@/stores/chatStore";
import { useCallStore } from "@/stores/callStore";
import { useUiStore } from "@/stores/uiStore";

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
  const [memberProfiles, setMemberProfiles] = useState<Record<string, {
    display_name?: string | null; username?: string | null; avatar_url?: string | null;
  }>>({});
  const [openMenuEmail, setOpenMenuEmail] = useState<string | null>(null);

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
          {g.avatar_url ? <img src={g.avatar_url} alt="Group Avatar" className="img-cover" /> : g.name?.[0]?.toUpperCase() || "?"}
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
                  style={{ flex: 1, padding: "8px 12px", background: "var(--surface-3)", border: "1px solid var(--border)", borderRadius: 8, color: "#fff" }}
                />
                <button
                  onClick={() => { if (newMemberInput.trim()) { onAddMember(newMemberInput); setNewMemberInput(""); } }}
                  className="add-member-btn"
                  style={{ background: "var(--primary)", color: "#fff", padding: "8px 16px", borderRadius: 8, border: "none", fontWeight: "bold" }}
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
                  <div key={idx} className="pfs-member-item" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", position: "relative" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <div className="pfs-member-av">{av ? <img src={av} alt="avatar" className="img-cover rounded-circle" /> : name[0]?.toUpperCase() || "?"}</div>
                      <div>
                        <div className="pfs-member-name">{name} {isMe && "(You)"}</div>
                        <div className="pfs-member-sub">{sub}</div>
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      {isMemberAdmin && <span className="admin-pill" style={{ background: "rgba(37,211,102,0.15)", color: "#4fe081", padding: "2px 8px", borderRadius: 10, fontSize: 10, fontWeight: "bold" }}>Admin</span>}
                      {isAdmin && !isMe && (
                        <div style={{ position: "relative" }}>
                          <button
                            onClick={e => { e.stopPropagation(); setOpenMenuEmail(showMenu ? null : email); }}
                            className="tool-btn"
                            style={{ width: 28, height: 28, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", border: "none" }}
                            title="Manage member"
                            aria-label="Manage member"
                          >
                            ⋮
                          </button>
                          {showMenu && (
                            <div className="member-dropdown-menu" style={{ position: "absolute", right: 0, top: 32, background: "var(--surface-3)", border: "1px solid var(--border)", borderRadius: 8, zIndex: 100, width: 140, boxShadow: "0 4px 12px rgba(0,0,0,0.5)" }}>
                              <button
                                onClick={() => handleKickMember(email)}
                                style={{ width: "100%", padding: "8px 12px", background: "none", border: "none", color: "var(--danger)", textAlign: "left", cursor: "pointer", fontSize: "0.85rem" }}
                              >
                                Kick Member
                              </button>
                              {isMemberAdmin ? (
                                <button
                                  onClick={() => handleDemoteAdmin(email)}
                                  style={{ width: "100%", padding: "8px 12px", background: "none", border: "none", color: "#fff", textAlign: "left", cursor: "pointer", fontSize: "0.85rem" }}
                                >
                                  Demote from Admin
                                </button>
                              ) : (
                                <button
                                  onClick={() => handlePromoteAdmin(email)}
                                  style={{ width: "100%", padding: "8px 12px", background: "none", border: "none", color: "#fff", textAlign: "left", cursor: "pointer", fontSize: "0.85rem" }}
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
