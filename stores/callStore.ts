import { create } from "zustand";
import type { CallLogEntry, CallState } from "@/types";
import { dbSaveCallLog, dbGetCallLogs } from "@/lib/db";

export interface CallStoreState {
  callState: CallState;
  isVideoCall: boolean;
  callPeer: string | null;
  callPeerName: string;
  callDuration: number;
  isMuted: boolean;
  isSpeaker: boolean;
  facingMode: "user" | "environment";
  isCameraOff: boolean;
  remoteVideoMuted: boolean;
  isVideoSwapped: boolean;
  cameraStates: Record<string, boolean>;
  remoteStreams: Record<string, MediaStream>;
  callLogs: CallLogEntry[];
  pipPos: { x: number; y: number };

  setCallState: (callState: CallState) => void;
  setIsVideoCall: (isVideoCall: boolean) => void;
  setCallPeer: (callPeer: string | null) => void;
  setCallPeerName: (callPeerName: string) => void;
  setCallDuration: (callDuration: number | ((prev: number) => number)) => void;
  setIsMuted: (isMuted: boolean) => void;
  setIsSpeaker: (isSpeaker: boolean) => void;
  setFacingMode: (facingMode: "user" | "environment") => void;
  setIsCameraOff: (isCameraOff: boolean) => void;
  setRemoteVideoMuted: (remoteVideoMuted: boolean) => void;
  setIsVideoSwapped: (v: boolean) => void;
  setCameraStates: (
    states: Record<string, boolean> | ((prev: Record<string, boolean>) => Record<string, boolean>)
  ) => void;
  updateCameraState: (email: string, off: boolean) => void;
  setRemoteStreams: (
    streams: Record<string, MediaStream> | ((prev: Record<string, MediaStream>) => Record<string, MediaStream>)
  ) => void;
  setCallLogs: (callLogs: CallLogEntry[] | ((prev: CallLogEntry[]) => CallLogEntry[])) => void;
  addCallLog: (log: CallLogEntry) => void;
  setPipPos: (pos: { x: number; y: number }) => void;
  resetCallState: () => void;
}

export const useCallStore = create<CallStoreState>((set) => ({
  callState: "idle",
  isVideoCall: false,
  callPeer: null,
  callPeerName: "",
  callDuration: 0,
  isMuted: false,
  isSpeaker: false,
  facingMode: "user",
  isCameraOff: false,
  remoteVideoMuted: false,
  isVideoSwapped: false,
  cameraStates: {},
  remoteStreams: {},
  callLogs: [],
  pipPos: { x: 16, y: 100 },

  setCallState: (callState) => set({ callState }),
  setIsVideoCall: (isVideoCall) => set({ isVideoCall }),
  setCallPeer: (callPeer) => set({ callPeer }),
  setCallPeerName: (callPeerName) => set({ callPeerName }),
  setCallDuration: (callDuration) =>
    set((s) => ({
      callDuration: typeof callDuration === "function" ? callDuration(s.callDuration) : callDuration,
    })),
  setIsMuted: (isMuted) => set({ isMuted }),
  setIsSpeaker: (isSpeaker) => set({ isSpeaker }),
  setFacingMode: (facingMode) => set({ facingMode }),
  setIsCameraOff: (isCameraOff) => set({ isCameraOff }),
  setRemoteVideoMuted: (remoteVideoMuted) => set({ remoteVideoMuted }),
  setIsVideoSwapped: (v) => set({ isVideoSwapped: v }),
  setCameraStates: (states) =>
    set((s) => ({
      cameraStates: typeof states === "function" ? states(s.cameraStates) : states,
    })),
  updateCameraState: (email, off) =>
    set((s) => ({
      cameraStates: { ...s.cameraStates, [email]: off },
    })),
  setRemoteStreams: (streams) =>
    set((s) => ({
      remoteStreams: typeof streams === "function" ? streams(s.remoteStreams) : streams,
    })),
  setCallLogs: (callLogs) =>
    set((s) => {
      const next = typeof callLogs === "function" ? callLogs(s.callLogs) : callLogs;
      const final = next.slice(0, 200);
      if (typeof window !== "undefined") {
        final.forEach(log => dbSaveCallLog(log).catch(() => {}));
      }
      return { callLogs: final };
    }),
  addCallLog: (log) =>
    set((s) => {
      const nextLogs = [log, ...s.callLogs].slice(0, 200);
      if (typeof window !== "undefined") {
        dbSaveCallLog(log).catch(() => {});
      }
      return { callLogs: nextLogs };
    }),
  setPipPos: (pos) => set({ pipPos: pos }),
  resetCallState: () =>
    set({
      callState: "idle",
      callPeer: null,
      callPeerName: "",
      isVideoCall: false,
      isMuted: false,
      isSpeaker: false,
      isCameraOff: false,
      remoteVideoMuted: false,
      isVideoSwapped: false,
      facingMode: "user",
      cameraStates: {},
      remoteStreams: {},
      callDuration: 0,
      pipPos: { x: 16, y: 100 },
    }),
}));

// Restore call logs from DB on module load
if (typeof window !== "undefined") {
  dbGetCallLogs(100)
    .then((logs) => {
      if (logs && logs.length > 0) useCallStore.setState({ callLogs: logs });
    })
    .catch(() => {});
}
