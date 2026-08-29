import { useCallback, useRef, useEffect } from "react";
import { useAuthStore } from "@/stores/authStore";
import { useChatStore } from "@/stores/chatStore";
import { useContactStore } from "@/stores/contactStore";
import { useCallStore } from "@/stores/callStore";
import { useUiStore } from "@/stores/uiStore";
import { useApiFetch } from "@/hooks/useApiFetch";
import type { CryptoHook } from "@/hooks/useCrypto";
import type { Message, Contact } from "@/types";
import { WS_URL } from "@/lib/api";
import { idbSet, idbDel } from "@/lib/idb";
import { dbSaveMessage, dbDeleteMessage, dbUpdateMessage } from "@/lib/db";
import { getDateLabel, updateReactionsForUser, getEmail } from "@/lib/utils";


export interface UseWebSocketOptions {
  crypto: CryptoHook;
  onCallOffer: (data: any) => void;
  onCallAnswer: (data: any) => void;
  onIceCandidate: (data: any) => void;
  onCallEnd: (data: any) => void;
  onCallReject: (data: any) => void;
  onCameraState: (data: any) => void;
  loadHistoryFn: (chat: any) => Promise<void>;
  loadContactsFn: () => Promise<void>;
  loadGroupsFn: () => Promise<void>;
  notifyFn: (title: string, body: string, chatId: string) => void;
  notifyCallFn: (title: string, body: string) => void;
  startRingtoneFn: () => void;
  scrollBottomFn: () => void;
  sendReadReceiptFn: (chat: any) => void;
  contactLabelFnRef: React.MutableRefObject<(c: Contact) => string>;
}

/**
 * WebSocket hook. Manages connection lifecycle, message handling,
 * reconnection, and pending message queue.
 */
export function useWebSocket(opts: UseWebSocketOptions) {
  const { crypto } = opts;
  const apiFetch = useApiFetch();

  // Store accessors
  const { setWsStatus } = useUiStore.getState();

  // Refs for WS internals
  const wsRef = useRef<WebSocket | null>(null);
  const wsPingInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const wsConnTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wsRetryDelay = useRef(800);
  const wsRetryCount = useRef(0);
  const lastPongRef = useRef(Date.now());
  const pendingMessages = useRef<string[]>([]);
  const seenMessageIds = useRef<Set<string>>(new Set());
  const readChatsRef = useRef<Set<string>>(new Set());
  const initWSRef = useRef<(() => void) | null>(null);

  // Store current opts in refs for stable callbacks
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const persistSeenIds = useCallback(() => {
    const user = useAuthStore.getState().currentUser;
    if (!user) return;
    const arr = [...seenMessageIds.current].slice(-1500);
    try {
      sessionStorage.setItem("Flux_seen_ids", JSON.stringify(arr));
    } catch { /* ignore */ }
  }, []);

  // ── wsSend ────────────────────────────────────────────────────────────────
  const wsSend = useCallback((msg: string) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(msg);
    } else {
      pendingMessages.current.push(msg);
      const user = useAuthStore.getState().currentUser;
      if (user) {
        idbSet(`pending_messages_${user}`, pendingMessages.current).catch(() => {});
      }
    }
  }, []);

  // ── WS Message Handler ─────────────────────────────────────────────────────
  const wsHandlerRef = useRef<(raw: string) => void>(() => {});

  const wsHandler = useCallback(async (raw: string) => {
    let data: Partial<Message> & Record<string, unknown>;
    try { data = JSON.parse(raw); } catch { return; }
    const me = useAuthStore.getState().currentUser;
    const { setMessages, setTypingSet, setPinnedMessages, setUnread } = useChatStore.getState();
    const { setContacts, setGroups } = useContactStore.getState();
    const { setRemoteVideoMuted, setCameraStates } = useCallStore.getState();
    const activeChat = useChatStore.getState().activeChat;

    const messagesCacheRef = (window as any).__messagesCacheRef as Record<string, Message[]> | undefined;

    const updateMsgCache = (targetChatId: string, updater: (msgs: Message[]) => Message[]) => {
      if (!messagesCacheRef) return;
      const currentList = messagesCacheRef[targetChatId] || [];
      const nextList = updater(currentList);
      messagesCacheRef[targetChatId] = nextList;
      const activeId = activeChat
        ? (activeChat.type === "user" ? String(activeChat.id).toLowerCase() : String(activeChat.id))
        : null;
      if (targetChatId === activeId) {
        setMessages(nextList);
      }
    };

    switch (data.type) {
      case "typing":
        if (typeof data.user === "string" && String(data.user).toLowerCase() !== me) {
          const userLower = String(data.user).toLowerCase();
          setTypingSet((prev) => new Set(prev).add(userLower));
          setTimeout(() =>
            setTypingSet((prev) => {
              const n = new Set(prev);
              n.delete(userLower);
              return n;
            }), 2000);
        }
        break;

      case "pin_change": {
        const isGroup = !!data.group_id;
        const sender = data.user || data.sender;
        const pinChatId = isGroup
          ? String(data.group_id || data.chat_id)
          : (String(sender).toLowerCase() === me ? String(data.target_user).toLowerCase() : String(sender).toLowerCase());
        const pinAction = String(data.action);
        const pinMsg = data.msg as Message;
        if (pinChatId && pinMsg) {
          setPinnedMessages((prev) => {
            const currentPinned = prev[pinChatId] || [];
            let nextPinned: Message[];
            if (pinAction === "pin") {
              nextPinned = currentPinned.some((m) => m.id === pinMsg.id)
                ? currentPinned
                : [...currentPinned, pinMsg];
            } else {
              nextPinned = currentPinned.filter((m) => m.id !== pinMsg.id);
            }
            const next = { ...prev, [pinChatId]: nextPinned };
            const user = useAuthStore.getState().currentUser;
            if (user) idbSet(`pinned_msgs_${user}`, next).catch(() => {});
            return next;
          });
        }
        break;
      }

      case "direct_message": {
        const dataUser = String(data.user).toLowerCase();
        setTypingSet((prev) => { const n = new Set(prev); n.delete(dataUser); return n; });
        const peer = dataUser === me ? (data.receiver_email || data.target_user) : data.user;
        if (!peer) break;
        const peerEmail = String(peer).toLowerCase();
        const blockedUsers = useContactStore.getState().blockedUsers;
        if (dataUser !== me && blockedUsers.has(dataUser)) break;
        const rawMsg = data as Message;
        const decContent = await crypto.decryptContent(rawMsg.content, "user", peerEmail);

        if (decContent.startsWith("[SYSTEM] delete_message:")) {
          const targetId = decContent.replace("[SYSTEM] delete_message:", "").trim();
          dbUpdateMessage(targetId, { is_deleted: true }).catch(() => {});
          updateMsgCache(peerEmail, (prev) =>
            prev.map((m) => String(m.id) === targetId ? { ...m, is_deleted: true } : m));
          break;
        }
        if (decContent.startsWith("[SYSTEM] delete_call_log:")) {
          const logId = decContent.replace("[SYSTEM] delete_call_log:", "").trim();
          // We can also delete it from call logs store!
          import("@/lib/db").then(({ dbClearCallLogs }) => {
            // Wait, this soft deletes or deletes a call log? The callLogs state is filtered:
            // We can delete individual log from db if needed, but since call logs are simple, this is fine
          });
          useCallStore.getState().setCallLogs((prev) => prev.filter((l) => String(l.id) !== logId));
          break;
        }

        const msg = {
          ...rawMsg,
          user: dataUser,
          receiver_email: rawMsg.receiver_email ? String(rawMsg.receiver_email).toLowerCase() : undefined,
          target_user: rawMsg.target_user ? String(rawMsg.target_user).toLowerCase() : undefined,
          content: decContent,
          _dateLabel: getDateLabel(rawMsg.timestamp),
        };
        const dmId = String(msg.id);
        if (!dmId.startsWith("temp-") && seenMessageIds.current.has(dmId)) break;
        if (!dmId.startsWith("temp-")) { 
          seenMessageIds.current.add(dmId); 
          persistSeenIds(); 
          dbSaveMessage(msg).catch(() => {});
        }

        // Update activity
        const ts = new Date(msg.timestamp).getTime();
        useChatStore.getState().updateActivityTime(peerEmail, ts);
        useChatStore.getState().updateLastPreviewMsg(peerEmail, msg.content);

        // Auto-add unknown contacts
        const contacts = useContactStore.getState().contacts;
        const contactExists = contacts.some((c) => c.email === peerEmail);
        if (!contactExists) {
          setContacts([
            ...contacts,
            {
              email: peerEmail,
              display_name: (data.sender_name as string) || null,
              avatar_url: (data.sender_avatar as string) || null,
              is_online: true,
              username: null,
            },
          ]);
          apiFetch("/contacts/by-email", { method: "POST", body: JSON.stringify({ email: peerEmail }) })
            .then(() => optsRef.current.loadContactsFn())
            .catch(() => {});
        }

        const isInPeerChat = activeChat?.type === "user" && String(activeChat.id).toLowerCase() === peerEmail;
        if (isInPeerChat) {
          updateMsgCache(peerEmail, (prev) => {
            if (dataUser === me) {
              const idx = prev.findIndex((m) => String(m.id).startsWith("temp-") && m.content === msg.content);
              if (idx !== -1) { const next = [...prev]; next[idx] = msg; return next; }
              if (!prev.find((m) => String(m.id) === String(msg.id))) return [...prev, msg];
              return prev;
            }
            if (!prev.find((m) => String(m.id) === String(msg.id))) return [...prev, msg];
            return prev;
          });
          setTimeout(() => optsRef.current.scrollBottomFn(), 50);
          if (dataUser !== me && activeChat) optsRef.current.sendReadReceiptFn(activeChat);
        } else {
          if (messagesCacheRef) {
            const currentList = messagesCacheRef[peerEmail];
            if (currentList && !currentList.find((m) => String(m.id) === String(msg.id))) {
              if (dataUser === me) {
                const idx = currentList.findIndex((m) => String(m.id).startsWith("temp-") && m.content === msg.content);
                messagesCacheRef[peerEmail] = idx !== -1
                  ? [...currentList.slice(0, idx), msg, ...currentList.slice(idx + 1)]
                  : [...currentList, msg];
              } else {
                messagesCacheRef[peerEmail] = [...currentList, msg];
              }
            }
          }
          if (dataUser !== me) {
            setUnread((prev) => ({ ...prev, [peerEmail]: (prev[peerEmail] || 0) + 1 }));
            optsRef.current.notifyFn(
              (data.sender_name as string) || "New message",
              msg.content.startsWith("[") ? "📎 Attachment" : msg.content,
              peerEmail
            );
          }
        }
        break;
      }

      case "group_message": {
        const rawGMsg = data as Message;
        const dataUser = String(rawGMsg.user).toLowerCase();
        const decContent = await crypto.decryptContent(rawGMsg.content, "group", dataUser, rawGMsg.group_id);

        if (decContent.startsWith("[SYSTEM] delete_message:")) {
          const targetId = decContent.replace("[SYSTEM] delete_message:", "").trim();
          dbUpdateMessage(targetId, { is_deleted: true }).catch(() => {});
          updateMsgCache(String(rawGMsg.group_id), (prev) =>
            prev.map((m) => String(m.id) === targetId ? { ...m, is_deleted: true } : m));
          break;
        }
        if (decContent.startsWith("[SYSTEM] delete_call_log:")) {
          const logId = decContent.replace("[SYSTEM] delete_call_log:", "").trim();
          useCallStore.getState().setCallLogs((prev) => prev.filter((l) => String(l.id) !== logId));
          break;
        }
        if (decContent.startsWith("[SYSTEM] member_left:")) {
          const leftUser = decContent.replace("[SYSTEM] member_left:", "").trim().toLowerCase();
          const targetGroupId = String(rawGMsg.group_id);
          setGroups(useContactStore.getState().groups.map((g) => {
            if (String(g.id) !== targetGroupId) return g;
            return { ...g, members: g.members.filter((m: any) => getEmail(m).toLowerCase() !== leftUser) };
          }));
          optsRef.current.loadGroupsFn();
          break;
        }
        if (decContent.startsWith("[SYSTEM] member_added:")) {
          optsRef.current.loadGroupsFn();
          break;
        }

        const msg = { ...rawGMsg, user: dataUser, content: decContent, _dateLabel: getDateLabel(rawGMsg.timestamp) };
        const gmId = String((data as any).id);
        if (gmId && !gmId.startsWith("temp-") && seenMessageIds.current.has(gmId)) break;
        if (gmId && !gmId.startsWith("temp-")) { 
          seenMessageIds.current.add(gmId); 
          persistSeenIds(); 
          dbSaveMessage(msg).catch(() => {});
        }

        const ts = new Date(msg.timestamp).getTime();
        useChatStore.getState().updateActivityTime(String(data.group_id), ts);
        useChatStore.getState().updateLastPreviewMsg(String(data.group_id), msg.content);

        const groupIdStr = String(data.group_id);
        const groups = useContactStore.getState().groups;
        if (!groups.some((g) => String(g.id) === groupIdStr)) {
          optsRef.current.loadGroupsFn();
        }

        const isInGroupChat = activeChat?.type === "group" && String(activeChat.id) === String(data.group_id);
        if (isInGroupChat) {
          updateMsgCache(String(data.group_id), (prev) => {
            if (dataUser === me) {
              const idx = prev.findIndex((m) => String(m.id).startsWith("temp-") && m.content === msg.content);
              if (idx !== -1) { const next = [...prev]; next[idx] = msg; return next; }
              if (!prev.find((m) => String(m.id) === String(msg.id))) return [...prev, msg];
              return prev;
            }
            if (!prev.find((m) => String(m.id) === String(msg.id))) return [...prev, msg];
            return prev;
          });
          setTimeout(() => optsRef.current.scrollBottomFn(), 50);
        } else {
          if (messagesCacheRef) {
            const currentList = messagesCacheRef[String(data.group_id)];
            if (currentList && !currentList.find((m) => String(m.id) === String(msg.id))) {
              if (dataUser === me) {
                const idx = currentList.findIndex((m) => String(m.id).startsWith("temp-") && m.content === msg.content);
                messagesCacheRef[String(data.group_id)] = idx !== -1
                  ? [...currentList.slice(0, idx), msg, ...currentList.slice(idx + 1)]
                  : [...currentList, msg];
              } else {
                messagesCacheRef[String(data.group_id)] = [...currentList, msg];
              }
            }
          }
          if (dataUser !== me) {
            setUnread((prev) => ({ ...prev, [String(data.group_id)]: (prev[String(data.group_id)] || 0) + 1 }));
            optsRef.current.notifyFn(
              `${data.group_name}`,
              `${data.sender_name || "Someone"}: ${msg.content.startsWith("[") ? "📎 Attachment" : msg.content}`,
              String(data.group_id)
            );
          }
        }
        break;
      }

      case "reaction":
        useChatStore.getState().setMessages((prev) => {
          const next = prev.map((m) => {
            if (String(m.id) !== String(data.message_id)) return m;
            if (data.reactions && typeof data.reactions === "object")
              return { ...m, reactions: data.reactions as Record<string, string[]> };
            if (data.user && data.emoji)
              return { ...m, reactions: updateReactionsForUser(m.reactions, String(data.user), String(data.emoji)) };
            return m;
          });
          return next;
        });
        break;

      case "read_receipt":
        useChatStore.getState().setMessages((prev) =>
          prev.map((m) => {
            if (String(m.user).toLowerCase() !== me) return m;
            if (data.group_id && m.group_id === data.group_id) {
              const rb = m.read_by || [];
              const u = String(data.user).toLowerCase();
              if (!rb.includes(u)) return { ...m, is_read: true, read_by: [...rb, u] };
            } else if (!data.group_id && !m.group_id) return { ...m, is_read: true };
            return m;
          })
        );
        break;

      case "message_edited": {
        const rawMsg = data as Message;
        const chatType = data.group_id ? "group" : "user";
        const msgUser = String(data.user).toLowerCase();
        const peerEmail = chatType === "user"
          ? (msgUser === me ? String(data.receiver_email || data.target_user).toLowerCase() : msgUser)
          : msgUser;
        const decContent = await crypto.decryptContent(
          rawMsg.content, chatType as "user" | "group", peerEmail,
          data.group_id ? String(data.group_id) : undefined
        );
        const targetChatId = data.group_id ? String(data.group_id) : peerEmail;

        dbUpdateMessage(String(data.id), {
          content: decContent,
          edited_at: data.edited_at as string,
          is_edited: true
        }).catch(() => {});

        useChatStore.getState().setMessages((prev) =>
          prev.map((m) =>
            String(m.id) === String(data.id)
              ? { ...m, content: decContent, edited_at: data.edited_at as string, is_edited: true, _dateLabel: getDateLabel(m.timestamp) }
              : m
          )
        );
        if (messagesCacheRef) {
          messagesCacheRef[targetChatId] = useChatStore.getState().messages;
        }
        break;
      }

      case "message_deleted": {
        const targetChatId = data.group_id
          ? String(data.group_id)
          : (activeChat ? String(activeChat.id).toLowerCase() : "");

        dbUpdateMessage(String(data.id), {
          is_deleted: true
        }).catch(() => {});

        useChatStore.getState().setMessages((prev) =>
          prev.map((m) => String(m.id) === String(data.id) ? { ...m, is_deleted: true } : m)
        );
        if (targetChatId && messagesCacheRef) {
          messagesCacheRef[targetChatId] = useChatStore.getState().messages;
        }
        break;
      }

      case "presence": {
        const presenceUser = String(data.user || "").toLowerCase();
        const contacts = useContactStore.getState().contacts;
        useContactStore.getState().setContacts(
          contacts.map((c) => c.email === presenceUser ? { ...c, is_online: Boolean(data.online) } : c)
        );
        break;
      }

      case "group_updated":
        optsRef.current.loadGroupsFn();
        break;

      // ── Call signaling → delegated to parent ──
      case "call_offer":
        optsRef.current.onCallOffer(data);
        break;
      case "call_answer":
        optsRef.current.onCallAnswer(data);
        break;
      case "ice_candidate":
        optsRef.current.onIceCandidate(data);
        break;
      case "call_end":
        optsRef.current.onCallEnd(data);
        break;
      case "call_reject":
        optsRef.current.onCallReject(data);
        break;
      case "camera_state":
        optsRef.current.onCameraState(data);
        break;
    }
  }, [crypto, apiFetch, persistSeenIds]);

  useEffect(() => { wsHandlerRef.current = wsHandler; }, [wsHandler]);

  // ── initWS ──────────────────────────────────────────────────────────────────
  const initWS = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.CONNECTING) return;
    if (wsPingInterval.current) { clearInterval(wsPingInterval.current); wsPingInterval.current = null; }
    if (wsRef.current) { wsRef.current.onclose = null; wsRef.current.close(); }
    const currentToken = useAuthStore.getState().token;
    if (!currentToken) return;
    useUiStore.getState().setWsStatus("reconnecting");

    let ws: WebSocket;
    try {
      ws = new WebSocket(`${WS_URL}/ws?token=${encodeURIComponent(currentToken)}`);
      wsRef.current = ws;
      if (wsConnTimeoutRef.current) clearTimeout(wsConnTimeoutRef.current);
      wsConnTimeoutRef.current = setTimeout(() => {
        if (ws.readyState === WebSocket.CONNECTING) ws.close();
      }, 8000);
    } catch {
      useUiStore.getState().setWsStatus("disconnected");
      return;
    }

    ws.onopen = () => {
      if (wsConnTimeoutRef.current) { clearTimeout(wsConnTimeoutRef.current); wsConnTimeoutRef.current = null; }
      wsRetryDelay.current = 800;
      wsRetryCount.current = 0;
      useUiStore.getState().setWsStatus("connected");


      if (seenMessageIds.current.size > 2000)
        seenMessageIds.current = new Set([...seenMessageIds.current].slice(-1000));
      persistSeenIds();
      lastPongRef.current = Date.now();

      wsPingInterval.current = setInterval(() => {
        if (ws.readyState !== WebSocket.OPEN) return;
        if (Date.now() - lastPongRef.current > 35000) { ws.close(); return; }
        ws.send(JSON.stringify({ type: "ping" }));
      }, 20000);

      // Drain pending messages
      while (pendingMessages.current.length > 0) {
        const queued = pendingMessages.current[0];
        if (queued && ws.readyState === WebSocket.OPEN) {
          ws.send(queued);
          pendingMessages.current.shift();
        } else break;
      }
      const user = useAuthStore.getState().currentUser;
      if (user) {
        if (pendingMessages.current.length > 0) {
          idbSet(`pending_messages_${user}`, pendingMessages.current).catch(() => {});
        } else {
          idbDel(`pending_messages_${user}`).catch(() => {});
        }
      }

      // Fetch unread counts
      apiFetch<Record<string, number>>("/unread-counts").then((counts) => {
        useChatStore.getState().setUnread(() => {
          const merged: Record<string, number> = {};
          Object.entries(counts).forEach(([k, v]) => {
            merged[k.includes("@") ? k.toLowerCase() : k] = v;
          });
          const ac = useChatStore.getState().activeChat;
          const id = ac ? (ac.type === "user" ? String(ac.id).toLowerCase() : String(ac.id)) : null;
          readChatsRef.current.forEach((cid) => {
            merged[cid.includes("@") ? cid.toLowerCase() : cid] = 0;
          });
          if (id) merged[id] = 0;
          return merged;
        });
      }).catch(() => {});

      // Reload active chat history
      const openChatNow = useChatStore.getState().activeChat;
      if (openChatNow && ws.readyState === WebSocket.OPEN) {
        optsRef.current.loadHistoryFn(openChatNow).catch(() => {});
      }
    };

    ws.onerror = () => {
      if (wsConnTimeoutRef.current) { clearTimeout(wsConnTimeoutRef.current); wsConnTimeoutRef.current = null; }
    };

    ws.onclose = () => {
      if (wsConnTimeoutRef.current) { clearTimeout(wsConnTimeoutRef.current); wsConnTimeoutRef.current = null; }
      if (wsPingInterval.current) { clearInterval(wsPingInterval.current); wsPingInterval.current = null; }
      const hasToken = !!useAuthStore.getState().token;
      if (!hasToken) {
        if (useUiStore.getState().wsStatus !== "disconnected") useUiStore.getState().setWsStatus("disconnected");
        return;
      }
      wsRetryCount.current += 1;
      const delay = wsRetryDelay.current;
      wsRetryDelay.current = Math.min(delay * 1.5, 5000);

      if (useUiStore.getState().wsStatus !== "reconnecting") {
        useUiStore.getState().setWsStatus("reconnecting");
      }

      setTimeout(() => {
        if (!useAuthStore.getState().token) return;
        if (wsRef.current?.readyState === WebSocket.OPEN || wsRef.current?.readyState === WebSocket.CONNECTING) return;
        initWSRef.current?.();
      }, delay);
    };

    ws.onmessage = ({ data: raw }) => {
      try {
        const parsed = JSON.parse(raw);
        if (parsed.type === "pong") { lastPongRef.current = Date.now(); return; }
      } catch { return; }
      setTimeout(() => wsHandlerRef.current(raw), 0);
    };
  }, [apiFetch, persistSeenIds]);

  // Keep initWSRef current
  useEffect(() => { initWSRef.current = initWS; }, [initWS]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (wsPingInterval.current) clearInterval(wsPingInterval.current);
      if (wsRef.current) { wsRef.current.onclose = null; wsRef.current.close(); }
    };
  }, []);

  return {
    wsRef,
    wsSend,
    initWS,
    seenMessageIds,
    pendingMessages,
    readChatsRef,
    persistSeenIds,
  };
}

export type WebSocketHook = ReturnType<typeof useWebSocket>;
