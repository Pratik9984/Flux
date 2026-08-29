import { create } from "zustand";

export interface WsStoreState {
  ws: WebSocket | null;
  setWs: (ws: WebSocket | null) => void;
}

export const useWsStore = create<WsStoreState>((set) => ({
  ws: null,
  setWs: (ws) => set({ ws }),
}));
