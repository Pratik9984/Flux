import { useCallback, useEffect, useMemo, useRef } from "react";
import { useAuthStore } from "@/stores/authStore";
import { useChatStore } from "@/stores/chatStore";
import { useContactStore } from "@/stores/contactStore";
import { useCallStore } from "@/stores/callStore";
import { useUiStore } from "@/stores/uiStore";
import { useApiFetch } from "@/hooks/useApiFetch";
import type { CallLogEntry, Message, StoredCallOffer, Contact } from "@/types";
import { fmtDuration, getDateLabel, getEmail } from "@/lib/utils";
import { idbSet } from "@/lib/idb";
import { cancelCallNotification } from "@/lib/notifications";

export interface UseWebRTCOptions {
  wsSend: (msg: string) => void;
  stopRingtone: () => void;
  startRingtone: () => void;
  scrollBottom: () => void;
  notifyCall: (title: string, body: string) => void;
  contactLabelFn: (c: Contact) => string;
  getPeerName: (email: string) => string;
  applyAudioOutput: (speaker: boolean) => void;
}

export function useWebRTC(opts: UseWebRTCOptions) {
  const apiFetch = useApiFetch();
  const optsRef = useRef(opts);
  optsRef.current = opts;

  // ── Refs ──
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const pcMapRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const iceCandidateQueueRef = useRef<RTCIceCandidateInit[]>([]);
  const iceQueuesRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const pendingRemoteDescriptionRef = useRef<RTCSessionDescriptionInit | null>(null);
  const pendingMeshOffersRef = useRef<Map<string, RTCSessionDescriptionInit>>(new Map());
  const callStartTimeRef = useRef<number | null>(null);
  const callDirectionRef = useRef<"incoming" | "outgoing" | null>(null);
  const callGroupIdRef = useRef<string | number | null>(null);
  const callPeerRef = useRef<string>("");
  const callPeerNameRef = useRef<string>("");
  const isVideoCallRef = useRef(false);
  const callStateRef = useRef<string>("idle");
  const acceptInProgressRef = useRef(false);
  const callDurationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // PiP drag refs
  const pipDragging = useRef(false);
  const pipDragStart = useRef({ mx: 0, my: 0, x: 0, y: 0 });

  // Sync callState ref
  const callState = useCallStore((s) => s.callState);
  callStateRef.current = callState;

  const updateCallState = useCallback((state: "idle" | "incoming" | "calling" | "connected") => {
    callStateRef.current = state;
    useCallStore.getState().setCallState(state);
    if (state === "connected") {
      useCallStore.getState().setCallDuration(0);
      if (callDurationIntervalRef.current) clearInterval(callDurationIntervalRef.current);
      callDurationIntervalRef.current = setInterval(() => {
        useCallStore.getState().setCallDuration((prev) => prev + 1);
      }, 1000);
    } else if (state === "idle") {
      if (callDurationIntervalRef.current) { clearInterval(callDurationIntervalRef.current); callDurationIntervalRef.current = null; }
    }
  }, []);

  // ── RTC config ──
  const rtcConfig = useMemo(() => {
    let customServers: any[] = [];
    try {
      const envIce = process.env.NEXT_PUBLIC_ICE_SERVERS;
      if (envIce) customServers = JSON.parse(envIce);
    } catch { /* ignore */ }
    return {
      iceServers: customServers.length > 0 ? customServers : [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        { urls: "stun:stun2.l.google.com:19302" },
        { urls: "stun:stun3.l.google.com:19302" },
        { urls: "stun:stun4.l.google.com:19302" },
        { urls: "stun:global.stun.twilio.com:3478" },
        {
          urls: [
            "turn:flux-chat.duckdns.org:3478?transport=udp",
            "turn:flux-chat.duckdns.org:3478?transport=tcp",
          ],
          username: "pulse_turn",
          credential: "pulse_turn_secret_2026",
        },
      ],
      iceCandidatePoolSize: 10,
    };
  }, []);

  const getMediaStream = useCallback(async (constraints: MediaStreamConstraints): Promise<MediaStream> => {
    const md = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
    if (!md?.getUserMedia) {
      const isNotSecure = typeof window !== "undefined" && window.isSecureContext === false;
      throw new Error(
        isNotSecure
          ? "Microphone/Camera is blocked on insecure HTTP. Please use 'npm run dev:https' or open via localhost."
          : "Camera and microphone are not available on this browser."
      );
    }
    try {
      return await md.getUserMedia(constraints);
    } catch (err: any) {
      const name: string = err?.name || "";
      if ((name === "OverconstrainedError" || name === "ConstraintNotSatisfiedError") && constraints.video && typeof constraints.video === "object") {
        try { return await md.getUserMedia({ audio: constraints.audio, video: true }); } catch {}
      }
      if (name === "NotFoundError" || name === "DevicesNotFoundError") {
        if (constraints.video) {
          try { return await md.getUserMedia({ audio: constraints.audio || true, video: false }); } catch {}
        }
        throw new Error("No microphone or camera detected.");
      }
      if (name === "NotAllowedError" || name === "PermissionDeniedError") {
        throw new Error("Permission denied. Please allow microphone and camera access in your browser site settings.");
      }
      if (name === "NotReadableError" || name === "TrackStartError") {
        throw new Error("Camera or microphone is already in use by another application.");
      }
      throw err;
    }
  }, []);

  // ── setupWebRTC ──
  const setupWebRTC = useCallback(async (targetEmail: string) => {
    const localStream = localStreamRef.current;
    if (!localStream) throw new Error("Local media stream unavailable");
    const PeerConnection = (typeof window !== "undefined" && (window.RTCPeerConnection || (window as any).webkitRTCPeerConnection || (window as any).mozRTCPeerConnection)) || null;
    if (!PeerConnection) throw new Error("WebRTC RTCPeerConnection is not supported in this environment");
    const pc = new PeerConnection(rtcConfig);
    pcMapRef.current.set(targetEmail, pc);
    peerConnectionRef.current = pc;
    localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));

    pc.ontrack = (event) => {
      useCallStore.getState().setRemoteStreams((prev) => {
        const stream = event.streams?.[0] || (() => {
          const s = prev[targetEmail] || new MediaStream();
          if (!s.getTracks().find((t) => t.id === event.track.id)) s.addTrack(event.track);
          return s;
        })();
        if (targetEmail === callPeerRef.current) {
          remoteStreamRef.current = stream;
          const videoEl = remoteVideoRef.current;
          if (videoEl && videoEl.srcObject !== stream) { videoEl.srcObject = stream; videoEl.volume = 1.0; videoEl.play().catch(() => {}); }
          const audioEl = remoteAudioRef.current;
          if (audioEl && audioEl.srcObject !== stream) { audioEl.srcObject = stream; audioEl.volume = 1.0; audioEl.play().catch(() => {}); }
        }
        return { ...prev, [targetEmail]: stream };
      });

      optsRef.current.applyAudioOutput(useCallStore.getState().isSpeaker);
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        optsRef.current.wsSend(JSON.stringify({ type: "ice_candidate", target_user: targetEmail, candidate: event.candidate }));
      }
    };

    pc.oniceconnectionstatechange = () => {
      const s = pc.iceConnectionState;
      if (s === "failed") { if (pc.restartIce) pc.restartIce(); else endCall(true, "missed"); }
      if (s === "disconnected") setTimeout(() => { if (pc.iceConnectionState === "disconnected") endCall(true, "missed"); }, 5000);
    };
    pc.onconnectionstatechange = () => { if (pc.connectionState === "failed") endCall(true, "missed"); };
    return pc;
  }, [rtcConfig]);

  // ── endCall ──
  const endCall = useCallback((sendSignal = true, explicitStatus?: "completed" | "missed" | "rejected") => {
    optsRef.current.stopRingtone();
    cancelCallNotification();
    acceptInProgressRef.current = false;
    try { sessionStorage.removeItem("_Flux_call_offer"); } catch { /* ignore */ }

    const finalStatus = explicitStatus || (callStateRef.current === "connected" ? "completed" : "missed");
    const duration = callStartTimeRef.current && callStateRef.current === "connected"
      ? Math.floor((Date.now() - callStartTimeRef.current) / 1000) : 0;
    const cp = callPeerRef.current;
    const cpName = callPeerNameRef.current;
    const me = useAuthStore.getState().currentUser;

    if (cp && callDirectionRef.current) {
      const resolvedName = cpName || optsRef.current.getPeerName(cp) || cp;
      const newLog: CallLogEntry = {
        id: Date.now().toString() + Math.random(), peer: cp, peerName: resolvedName,
        direction: callDirectionRef.current, media: isVideoCallRef.current ? "video" : "audio",
        status: finalStatus, timestamp: new Date().toISOString(), duration,
        ...(callGroupIdRef.current ? { group_id: callGroupIdRef.current } : {}),
      };
      useCallStore.getState().addCallLog(newLog);
      apiFetch("/call-logs", { method: "POST", body: JSON.stringify(newLog) }).catch(() => {});

      // Create inline call record message
      const icon = isVideoCallRef.current ? "📹" : "📞";
      const callTypeLabel = isVideoCallRef.current ? "Video call" : "Voice call";
      const statusLabel = finalStatus === "completed" ? ` · ${fmtDuration(duration)}` : finalStatus === "rejected" ? " · Declined" : " · Missed";
      const recordContent = `${icon} ${callDirectionRef.current === "incoming" ? "Incoming" : "Outgoing"} ${callTypeLabel}${statusLabel}`;
      const callTs = new Date().toISOString();
      const callRecord: Message = { id: `call-${Date.now()}-${Math.random()}`, user: me, content: recordContent, timestamp: callTs, _callRecord: true, _dateLabel: getDateLabel(callTs) };
      const targetChatId = useChatStore.getState().activeChat ? String(useChatStore.getState().activeChat!.id) : cp || "";
      if (targetChatId) {
        useChatStore.getState().setMessages((prev) => [...prev, callRecord]);
        const mc = (window as any).__messagesCacheRef;
        if (mc) mc[targetChatId] = useChatStore.getState().messages;
      }
      setTimeout(() => optsRef.current.scrollBottom(), 50);
    }

    if (sendSignal) {
      if (pcMapRef.current.size > 0) pcMapRef.current.forEach((_, peerEmail) => optsRef.current.wsSend(JSON.stringify({ type: "call_end", target_user: peerEmail })));
      else if (cp) optsRef.current.wsSend(JSON.stringify({ type: "call_end", target_user: cp }));
    }

    if (localStreamRef.current) localStreamRef.current.getTracks().forEach((t) => t.stop());
    pcMapRef.current.forEach((pc) => pc.close());
    pcMapRef.current.clear();
    if (peerConnectionRef.current) peerConnectionRef.current.close();
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null;

    peerConnectionRef.current = null; pendingRemoteDescriptionRef.current = null;
    localStreamRef.current = null; remoteStreamRef.current = null;
    iceCandidateQueueRef.current = []; iceQueuesRef.current.clear(); pendingMeshOffersRef.current.clear();

    useCallStore.getState().resetCallState();
    updateCallState("idle");
    callStartTimeRef.current = null; callDirectionRef.current = null;
    isVideoCallRef.current = false; callGroupIdRef.current = null;
    callPeerRef.current = ""; callPeerNameRef.current = "";
  }, [apiFetch, updateCallState]);

  const endCallRef = useRef(endCall);
  useEffect(() => { endCallRef.current = endCall; }, [endCall]);

  // ── removePeerFromCall ──
  const removePeerFromCall = useCallback((peerEmail: string) => {
    const pc = pcMapRef.current.get(peerEmail);
    if (pc) { try { pc.close(); } catch { /* ignore */ } pcMapRef.current.delete(peerEmail); }
    useCallStore.getState().setRemoteStreams((prev) => { const next = { ...prev }; delete next[peerEmail]; return next; });
    if (!callGroupIdRef.current || pcMapRef.current.size === 0) {
      endCallRef.current(false, callStateRef.current === "connected" ? "completed" : "missed");
    }
  }, []);

  // ── startCall ──
  const startCall = useCallback(async (video = true) => {
    const activeChat = useChatStore.getState().activeChat;
    if (!activeChat) return;
    const me = useAuthStore.getState().currentUser;
    const profile = useAuthStore.getState().profile;
    const contacts = useContactStore.getState().contacts;
    const groups = useContactStore.getState().groups;
    const isGroup = activeChat.type === "group";
    const groupId = isGroup ? activeChat.id : null;
    if (groupId) callGroupIdRef.current = groupId;
    const targetIds = isGroup
      ? groups.find((g) => g.id === activeChat.id)?.members.map(getEmail).filter((m: string) => m !== me) || []
      : [String(activeChat.id)];
    if (!targetIds.length) return;
    try {
      if (localStreamRef.current) localStreamRef.current.getTracks().forEach((t) => t.stop());
      iceCandidateQueueRef.current = [];
      useCallStore.getState().setIsVideoCall(video);
      isVideoCallRef.current = video;
      useCallStore.getState().setIsVideoSwapped(false);
      updateCallState("calling");
      useCallStore.getState().setCallPeer(targetIds[0]);
      callPeerRef.current = targetIds[0];
      const c = contacts.find((c) => c.email === targetIds[0]);
      const peerName = c ? optsRef.current.contactLabelFn(c) : activeChat.name;
      useCallStore.getState().setCallPeerName(peerName);
      callPeerNameRef.current = peerName;
      callDirectionRef.current = "outgoing";
      localStreamRef.current = await getMediaStream({
        audio: true,
        video: video ? { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } } : false,
      });
      if (localVideoRef.current) { localVideoRef.current.srcObject = localStreamRef.current; localVideoRef.current.play().catch(() => {}); }
      for (const target of targetIds) {
        const pc = await setupWebRTC(target);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        const wrappedSdp = { type: offer.type, sdp: offer.sdp, ...(groupId ? { group_id: groupId } : {}), sender_name: profile.displayName || profile.username || me };
        optsRef.current.wsSend(JSON.stringify({ type: "call_offer", target_user: target, sdp: wrappedSdp, isVideo: video, sender_name: profile.displayName || profile.username || me, ...(groupId ? { group_id: groupId } : {}) }));
      }
    } catch (err: any) {
      useUiStore.getState().showToast(`Could not start call: ${err.message || err}`, "error");
      endCall(false);
    }
  }, [setupWebRTC, getMediaStream, endCall, updateCallState]);

  // ── acceptCall ──
  const acceptCall = useCallback(async () => {
    if (acceptInProgressRef.current) return;
    acceptInProgressRef.current = true;
    optsRef.current.stopRingtone();
    cancelCallNotification();
    try {
      if (localStreamRef.current) localStreamRef.current.getTracks().forEach((t) => t.stop());
      const needVideo = isVideoCallRef.current;
      useCallStore.getState().setIsVideoSwapped(false);

      if (!pendingRemoteDescriptionRef.current) {
        try {
          let stored: string | null = null;
          if (typeof window !== "undefined") {
            try {
              const nativeOffer = (window as any).FluxNativeBridge?.getPendingCallOffer?.();
              if (nativeOffer && String(nativeOffer).trim().startsWith("{")) {
                stored = String(nativeOffer);
                (window as any).FluxNativeBridge?.clearPendingCallOffer?.();
              }
            } catch { }
            if (!stored) {
              stored = localStorage.getItem("flux_pending_call_offer") || sessionStorage.getItem("_Flux_call_offer");
            }
          }
          if (stored) {
            const parsed: StoredCallOffer = JSON.parse(stored);
            const sdpObj = (parsed.sdp && typeof parsed.sdp === "object") ? parsed.sdp as any : {};
            const offerGroupId = parsed.group_id || sdpObj.group_id;
            if (offerGroupId) callGroupIdRef.current = offerGroupId;
            const realSdp = sdpObj.sdp ? { type: sdpObj.type, sdp: sdpObj.sdp } : parsed.sdp;
            pendingRemoteDescriptionRef.current = realSdp;
            if (!callPeerRef.current && parsed.peer) {
              callPeerRef.current = parsed.peer; callPeerNameRef.current = parsed.peerName || parsed.peer;
              isVideoCallRef.current = parsed.isVideo; callDirectionRef.current = "incoming";
              useCallStore.getState().setCallPeer(parsed.peer);
              useCallStore.getState().setCallPeerName(parsed.peerName || parsed.peer);
              useCallStore.getState().setIsVideoCall(parsed.isVideo);
            }
          }
        } catch { /* ignore */ }
      }
      try {
        sessionStorage.removeItem("_Flux_call_offer");
        localStorage.removeItem("flux_pending_call_offer");
        if (typeof window !== "undefined") {
          (window as any).FluxNativeBridge?.clearPendingCallOffer?.();
        }
      } catch { /* ignore */ }

      const targetPeer = callPeerRef.current || null;
      if (!targetPeer || !pendingRemoteDescriptionRef.current) {
        if (targetPeer) optsRef.current.wsSend(JSON.stringify({ type: "call_reject", target_user: targetPeer }));
        endCall(false, "missed");
        return;
      }


      localStreamRef.current = await getMediaStream({
        audio: true,
        video: needVideo ? { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } } : false,
      });
      if (localVideoRef.current) { localVideoRef.current.srcObject = localStreamRef.current; localVideoRef.current.play().catch(() => {}); }

      const pc = await setupWebRTC(targetPeer);
      await pc.setRemoteDescription(new RTCSessionDescription(pendingRemoteDescriptionRef.current));
      const queue = iceQueuesRef.current.get(targetPeer) || [];
      while (queue.length > 0) { const c = queue.shift(); if (c) await pc.addIceCandidate(new RTCIceCandidate(c)).catch(console.error); }
      iceQueuesRef.current.set(targetPeer, queue);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      optsRef.current.wsSend(JSON.stringify({ type: "call_answer", target_user: targetPeer, sdp: answer }));
      updateCallState("connected");
      callStartTimeRef.current = Date.now();

      // Handle mesh group call
      const meshGroupId = callGroupIdRef.current;
      if (meshGroupId) {
        const me = useAuthStore.getState().currentUser;
        const profile = useAuthStore.getState().profile;
        const groups = useContactStore.getState().groups;
        const group = groups.find((g) => String(g.id) === String(meshGroupId));
        if (group) {
          const otherMembers = group.members.map(getEmail).filter((m: string) =>
            m !== me && m !== targetPeer && !pendingMeshOffersRef.current.has(m) && m > me);
          for (const meshPeer of otherMembers) {
            if (!pcMapRef.current.has(meshPeer)) {
              try {
                const meshPc = await setupWebRTC(meshPeer);
                const meshOffer = await meshPc.createOffer();
                await meshPc.setLocalDescription(meshOffer);
                optsRef.current.wsSend(JSON.stringify({
                  type: "call_offer", target_user: meshPeer,
                  sdp: { type: meshOffer.type, sdp: meshOffer.sdp, is_mesh: true, group_id: meshGroupId, sender_name: profile.displayName || profile.username || me },
                  isVideo: needVideo, is_mesh: true, group_id: meshGroupId,
                }));
              } catch { /* ignore */ }
            }
          }
        }
      }

      // Process queued mesh offers
      const queuedOffers = Array.from(pendingMeshOffersRef.current.entries());
      pendingMeshOffersRef.current.clear();
      for (const [meshPeer, sdp] of queuedOffers) {
        if (!pcMapRef.current.has(meshPeer)) {
          try {
            const meshPc = await setupWebRTC(meshPeer);
            await meshPc.setRemoteDescription(new RTCSessionDescription(sdp));
            const q = iceQueuesRef.current.get(meshPeer) || [];
            while (q.length > 0) { const c = q.shift(); if (c) await meshPc.addIceCandidate(new RTCIceCandidate(c)).catch(console.error); }
            iceQueuesRef.current.set(meshPeer, q);
            const meshAnswer = await meshPc.createAnswer();
            await meshPc.setLocalDescription(meshAnswer);
            optsRef.current.wsSend(JSON.stringify({ type: "call_answer", target_user: meshPeer, sdp: meshAnswer }));
          } catch { /* ignore */ }
        }
      }

      setTimeout(() => {
        if (remoteStreamRef.current) {
          const videoEl = remoteVideoRef.current;
          if (videoEl && videoEl.srcObject !== remoteStreamRef.current) { videoEl.srcObject = remoteStreamRef.current; videoEl.volume = 1.0; videoEl.play().catch(() => {}); }
          optsRef.current.applyAudioOutput(useCallStore.getState().isSpeaker);
        }
      }, 300);
    } catch { endCall(false, "missed"); }
    finally { acceptInProgressRef.current = false; }
  }, [setupWebRTC, getMediaStream, endCall, updateCallState]);

  // ── rejectCall ──
  const rejectCall = useCallback(() => {
    optsRef.current.stopRingtone();
    cancelCallNotification();
    try { sessionStorage.removeItem("_Flux_call_offer"); } catch { /* ignore */ }
    const cp = callPeerRef.current;
    if (cp) optsRef.current.wsSend(JSON.stringify({ type: "call_reject", target_user: cp }));
    pcMapRef.current.forEach((_, peerEmail) => {
      if (peerEmail !== cp) optsRef.current.wsSend(JSON.stringify({ type: "call_end", target_user: peerEmail }));
    });
    endCall(false, "rejected");
  }, [endCall]);

  // ── Call signal handlers (called from WS hook) ──
  const handleCallOffer = useCallback(async (data: any) => {
    const callerEmail = String(data.user || "").toLowerCase();
    const blockedUsers = useContactStore.getState().blockedUsers;
    if (blockedUsers.has(callerEmail)) {
      optsRef.current.wsSend(JSON.stringify({ type: "call_reject", target_user: callerEmail }));
      return;
    }
    const vid = Boolean(data.isVideo);
    const sdpObj = (data.sdp && typeof data.sdp === "object") ? data.sdp as any : {};
    const isMesh = Boolean(data.is_mesh || sdpObj.is_mesh);
    const offerGroupId = data.group_id || sdpObj.group_id;
    const offerSenderName = data.sender_name || sdpObj.sender_name;
    const realSdp = sdpObj.sdp ? { type: sdpObj.type, sdp: sdpObj.sdp } : data.sdp;

    if (isMesh) {
      if (callStateRef.current === "connected") {
        if (!pcMapRef.current.has(callerEmail)) {
          try {
            const meshPc = await setupWebRTC(callerEmail);
            await meshPc.setRemoteDescription(new RTCSessionDescription(realSdp as RTCSessionDescriptionInit));
            const queue = iceQueuesRef.current.get(callerEmail) || [];
            while (queue.length > 0) { const c = queue.shift(); if (c) await meshPc.addIceCandidate(new RTCIceCandidate(c)).catch(console.error); }
            iceQueuesRef.current.set(callerEmail, queue);
            const meshAnswer = await meshPc.createAnswer();
            await meshPc.setLocalDescription(meshAnswer);
            optsRef.current.wsSend(JSON.stringify({ type: "call_answer", target_user: callerEmail, sdp: meshAnswer }));
          } catch { /* ignore */ }
        }
      } else {
        pendingMeshOffersRef.current.set(callerEmail, realSdp as RTCSessionDescriptionInit);
      }
      return;
    }

    iceCandidateQueueRef.current = [];
    iceQueuesRef.current.clear();
    if (callStateRef.current === "idle") pendingMeshOffersRef.current.clear();
    if (offerGroupId) callGroupIdRef.current = offerGroupId;

    const contacts = useContactStore.getState().contacts;
    const existingContact = contacts.find((c) => c.email === callerEmail);
    const callerDisplayName = String(offerSenderName || "").trim() ||
      (existingContact ? optsRef.current.contactLabelFn(existingContact) : "") ||
      callerEmail.split("@")[0] || "Incoming Call";

    const offerPayload: StoredCallOffer = {
      sdp: realSdp as RTCSessionDescriptionInit, peer: callerEmail, peerName: callerDisplayName,
      isVideo: vid, ts: Date.now(), group_id: offerGroupId,
    };
    try { sessionStorage.setItem("_Flux_call_offer", JSON.stringify(offerPayload)); } catch { /* ignore */ }

    useCallStore.getState().setCallPeer(callerEmail);
    useCallStore.getState().setCallPeerName(callerDisplayName);
    callPeerRef.current = callerEmail;
    callPeerNameRef.current = callerDisplayName;
    useCallStore.getState().setIsVideoCall(vid);
    isVideoCallRef.current = vid;
    updateCallState("incoming");
    callDirectionRef.current = "incoming";
    pendingRemoteDescriptionRef.current = realSdp as RTCSessionDescriptionInit;
    optsRef.current.startRingtone();
    optsRef.current.notifyCall(vid ? "📹 Incoming Video Call" : "📞 Incoming Voice Call", `${callerDisplayName} is calling…`);
  }, [setupWebRTC, updateCallState]);

  const handleCallAnswer = useCallback(async (data: any) => {
    optsRef.current.stopRingtone();
    cancelCallNotification();
    const rawPeer = String(data.user || data.sender || data.from || data.target_user || callPeerRef.current || "").toLowerCase();
    const pc = pcMapRef.current.get(rawPeer) ||
      pcMapRef.current.get(callPeerRef.current.toLowerCase()) ||
      peerConnectionRef.current ||
      Array.from(pcMapRef.current.values())[0];

    if (pc) {
      try {
        if (pc.signalingState !== "stable") {
          await pc.setRemoteDescription(new RTCSessionDescription(data.sdp as RTCSessionDescriptionInit));
        }
        updateCallState("connected");
        callStartTimeRef.current = Date.now();

        // Flush queued ICE candidates
        const queue = iceQueuesRef.current.get(rawPeer) ||
          iceQueuesRef.current.get(callPeerRef.current.toLowerCase()) ||
          iceCandidateQueueRef.current || [];
        while (queue.length > 0) {
          const c = queue.shift();
          if (c) await pc.addIceCandidate(new RTCIceCandidate(c)).catch(console.error);
        }
        iceQueuesRef.current.set(rawPeer, queue);
      } catch (err) {
        console.warn("[WebRTC] Failed to apply call_answer remote description:", err);
      }
    } else {
      console.warn("[WebRTC] Received call_answer but no matching peer connection was found for:", rawPeer);
    }
  }, [updateCallState]);

  const handleIceCandidate = useCallback(async (data: any) => {
    const rawPeer = String(data.user || data.sender || data.from || callPeerRef.current || "").toLowerCase();
    const pc = pcMapRef.current.get(rawPeer) ||
      pcMapRef.current.get(callPeerRef.current.toLowerCase()) ||
      peerConnectionRef.current ||
      Array.from(pcMapRef.current.values())[0];

    if (pc && pc.remoteDescription) {
      await pc.addIceCandidate(new RTCIceCandidate(data.candidate as RTCIceCandidateInit)).catch(console.error);
    } else {
      const queue = iceQueuesRef.current.get(rawPeer) || [];
      queue.push(data.candidate as RTCIceCandidateInit);
      iceQueuesRef.current.set(rawPeer, queue);
    }
  }, []);

  const handleCallEnd = useCallback((data: any) => {
    const leavingPeer = String(data.user || "").toLowerCase();
    const inGroupCall = !!callGroupIdRef.current;
    if (inGroupCall && pcMapRef.current.has(leavingPeer)) {
      removePeerFromCall(leavingPeer);
    } else if (inGroupCall && pcMapRef.current.size > 0) {
      useCallStore.getState().setRemoteStreams((prev) => { const next = { ...prev }; delete next[leavingPeer]; return next; });
    } else {
      endCallRef.current(false);
    }
  }, [removePeerFromCall]);

  const handleCallReject = useCallback((data: any) => {
    const rejectingPeer = String(data.user || "").toLowerCase();
    if (callGroupIdRef.current && pcMapRef.current.size > 1) removePeerFromCall(rejectingPeer);
    else endCallRef.current(false, "rejected");
  }, [removePeerFromCall]);

  const handleCameraState = useCallback((data: any) => {
    const u = String(data.user || "").toLowerCase();
    useCallStore.getState().setRemoteVideoMuted(data.videoMuted === true);
    if (u) useCallStore.getState().updateCameraState(u, data.videoMuted === true);
  }, []);

  // ── Controls ──
  const toggleMute = useCallback(() => {
    const isMuted = useCallStore.getState().isMuted;
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach((t) => (t.enabled = isMuted));
      useCallStore.getState().setIsMuted(!isMuted);
    }
  }, []);

  const toggleSpeaker = useCallback(() => {
    const s = !useCallStore.getState().isSpeaker;
    useCallStore.getState().setIsSpeaker(s);
    optsRef.current.applyAudioOutput(s);
  }, []);

  const switchCamera = useCallback(async () => {
    const isVideoCall = useCallStore.getState().isVideoCall;
    const facingMode = useCallStore.getState().facingMode;
    const isMuted = useCallStore.getState().isMuted;
    if (!isVideoCall || !localStreamRef.current) return;
    const newMode = facingMode === "user" ? "environment" : "user";
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) return;
    try {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      let ns: MediaStream;
      try { ns = await navigator.mediaDevices.getUserMedia({ audio: true, video: { facingMode: { exact: newMode } } }); }
      catch { ns = await navigator.mediaDevices.getUserMedia({ audio: true, video: true }); }
      localStreamRef.current = ns;
      if (isMuted) ns.getAudioTracks().forEach((t) => (t.enabled = false));
      if (localVideoRef.current) { localVideoRef.current.srcObject = ns; localVideoRef.current.play().catch(() => {}); }
      const [at] = ns.getAudioTracks();
      const [vt] = ns.getVideoTracks();
      pcMapRef.current.forEach((pc) => pc.getSenders().forEach((sender) => {
        if (sender.track?.kind === "audio" && at) sender.replaceTrack(at);
        if (sender.track?.kind === "video" && vt) sender.replaceTrack(vt);
      }));
      useCallStore.getState().setFacingMode(newMode);
    } catch { /* ignore */ }
  }, []);

  const toggleCamera = useCallback(() => {
    const isCameraOff = useCallStore.getState().isCameraOff;
    if (localStreamRef.current) {
      localStreamRef.current.getVideoTracks().forEach((t) => (t.enabled = isCameraOff));
      useCallStore.getState().setIsCameraOff(!isCameraOff);
      const cp = callPeerRef.current;
      if (cp) optsRef.current.wsSend(JSON.stringify({ type: "camera_state", target_user: cp, videoMuted: !isCameraOff }));
      pcMapRef.current.forEach((_, peer) => {
        if (peer !== cp) optsRef.current.wsSend(JSON.stringify({ type: "camera_state", target_user: peer, videoMuted: !isCameraOff }));
      });
    }
  }, []);

  const restoreCallOfferFromStorage = useCallback((forceAction?: string) => {
    try {
      let stored: string | null = null;
      let action = forceAction || "";
      if (typeof window !== "undefined") {
        try {
          const nativeBridgeOffer = (window as any).FluxNativeBridge?.getPendingCallOffer?.();
          if (nativeBridgeOffer && String(nativeBridgeOffer).trim().startsWith("{")) {
            stored = String(nativeBridgeOffer);
            (window as any).FluxNativeBridge?.clearPendingCallOffer?.();
          }
        } catch { }
        if (!stored) {
          stored = localStorage.getItem("flux_pending_call_offer") || sessionStorage.getItem("_Flux_call_offer");
        }
      }
      if (!stored) return false;
      const parsed: StoredCallOffer & { action?: string } = JSON.parse(stored);
      if (Date.now() - (parsed.ts || 0) > 60_000) {
        try {
          sessionStorage.removeItem("_Flux_call_offer");
          localStorage.removeItem("flux_pending_call_offer");
        } catch { }
        return false;
      }
      if (!action && parsed.action) action = parsed.action;
      if (callStateRef.current !== "idle" && action !== "accept") return false;

      const sdpObj = (parsed.sdp && typeof parsed.sdp === "object") ? parsed.sdp as any : {};
      const offerGroupId = parsed.group_id || sdpObj.group_id;
      if (offerGroupId) callGroupIdRef.current = offerGroupId;
      const realSdp = sdpObj.sdp ? { type: sdpObj.type, sdp: sdpObj.sdp } : parsed.sdp;
      pendingRemoteDescriptionRef.current = realSdp;
      useCallStore.getState().setCallPeer(parsed.peer);
      useCallStore.getState().setCallPeerName(parsed.peerName || parsed.peer);
      useCallStore.getState().setIsVideoCall(parsed.isVideo);
      isVideoCallRef.current = parsed.isVideo;
      callDirectionRef.current = "incoming";
      callPeerRef.current = parsed.peer;
      callPeerNameRef.current = parsed.peerName || parsed.peer;

      if (action === "accept") {
        updateCallState("incoming");
        setTimeout(() => {
          acceptCall();
        }, 120);
      } else {
        updateCallState("incoming");
        optsRef.current.startRingtone();
        optsRef.current.notifyCall(parsed.isVideo ? "📹 Incoming Video Call" : "📞 Incoming Voice Call", `${parsed.peerName || parsed.peer} is calling…`);
      }
      return true;
    } catch { return false; }
  }, [updateCallState, acceptCall]);

  // ── PiP drag ──
  const onPipMouseDown = useCallback((e: React.MouseEvent) => {
    const pos = useCallStore.getState().pipPos;
    pipDragging.current = true;
    pipDragStart.current = { mx: e.clientX, my: e.clientY, x: pos.x, y: pos.y };
    e.preventDefault();
  }, []);

  const onPipTouchStart = useCallback((e: React.TouchEvent) => {
    const t = e.touches[0];
    const pos = useCallStore.getState().pipPos;
    pipDragging.current = true;
    pipDragStart.current = { mx: t.clientX, my: t.clientY, x: pos.x, y: pos.y };
  }, []);

  const onPipMouseMove = useCallback((e: MouseEvent) => {
    if (!pipDragging.current) return;
    useCallStore.getState().setPipPos({
      x: pipDragStart.current.x + e.clientX - pipDragStart.current.mx,
      y: pipDragStart.current.y + e.clientY - pipDragStart.current.my,
    });
  }, []);

  const onPipTouchMove = useCallback((e: TouchEvent) => {
    if (!pipDragging.current) return;
    const t = e.touches[0];
    useCallStore.getState().setPipPos({
      x: pipDragStart.current.x + t.clientX - pipDragStart.current.mx,
      y: pipDragStart.current.y + t.clientY - pipDragStart.current.my,
    });
  }, []);

  const onPipDragEnd = useCallback(() => { pipDragging.current = false; }, []);

  return {
    // Refs for video elements (need to be attached to DOM)
    localVideoRef, remoteVideoRef, remoteAudioRef, localStreamRef,
    pcMapRef, callPeerRef, callPeerNameRef, isVideoCallRef,
    callDirectionRef, callGroupIdRef, callStateRef, pendingRemoteDescriptionRef, pendingMeshOffersRef,

    // Actions
    startCall, acceptCall, rejectCall, endCall,
    toggleMute, toggleSpeaker, switchCamera, toggleCamera,
    removePeerFromCall, restoreCallOfferFromStorage, updateCallState, setupWebRTC,

    // Call signal handlers (wired to WS)
    handleCallOffer, handleCallAnswer, handleIceCandidate,
    handleCallEnd, handleCallReject, handleCameraState,

    // PiP
    onPipMouseDown, onPipTouchStart, onPipMouseMove, onPipTouchMove, onPipDragEnd,
  };
}

export type WebRTCHook = ReturnType<typeof useWebRTC>;
