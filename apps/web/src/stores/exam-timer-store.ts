import { create } from 'zustand';

interface ExamTimerState {
  /** Server-authoritative deadline; the client clock is only used for display. */
  expiresAtMs: number | null;
  clockOffsetMs: number;
  remainingSeconds: number | null;
  startExamTimer: (expiresAt: string | null, serverTime: string) => void;
  tickExamTimer: () => void;
  stopExamTimer: () => void;
}

export const useExamTimerStore = create<ExamTimerState>((set, get) => ({
  expiresAtMs: null,
  clockOffsetMs: 0,
  remainingSeconds: null,

  startExamTimer: (expiresAt, serverTime) => {
    if (!expiresAt) return set({ expiresAtMs: null, remainingSeconds: null });
    const clockOffsetMs = new Date(serverTime).getTime() - Date.now();
    set({ expiresAtMs: new Date(expiresAt).getTime(), clockOffsetMs });
    get().tickExamTimer();
  },

  tickExamTimer: () => {
    const { expiresAtMs, clockOffsetMs } = get();
    if (expiresAtMs === null) return;
    const remaining = Math.max(0, Math.floor((expiresAtMs - (Date.now() + clockOffsetMs)) / 1000));
    set({ remainingSeconds: remaining });
  },

  stopExamTimer: () => set({ expiresAtMs: null, remainingSeconds: null }),
}));
