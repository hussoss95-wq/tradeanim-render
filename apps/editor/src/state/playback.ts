"use client";

import { create } from "zustand";

/**
 * Transport state lives in its own store: the playhead changes every frame
 * during playback, and only the stage, the timeline playhead and the timecode
 * subscribe to it (no full-UI re-render per frame).
 */
export interface PlaybackState {
  time: number;
  playing: boolean;
  loop: boolean;
  speed: number;
  /** timeline zoom: px per second */
  pxPerSec: number;
  setTime: (t: number) => void;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  setLoop: (v: boolean) => void;
  setSpeed: (v: number) => void;
  setPxPerSec: (v: number) => void;
}

const createPlaybackStore = () =>
  create<PlaybackState>((set, get) => ({
  time: 0,
  playing: false,
  loop: true,
  speed: 1,
  pxPerSec: 60,
  setTime: (t) => set({ time: Math.max(0, t) }),
  play: () => set({ playing: true }),
  pause: () => set({ playing: false }),
  toggle: () => set({ playing: !get().playing }),
  setLoop: (loop) => set({ loop }),
  setSpeed: (speed) => set({ speed }),
  setPxPerSec: (v) => set({ pxPerSec: Math.min(600, Math.max(8, v)) }),
}));

const g = globalThis as unknown as { __tradeanimPlayback?: ReturnType<typeof createPlaybackStore> };
export const usePlayback = (g.__tradeanimPlayback ??= createPlaybackStore());

export const playback = () => usePlayback.getState();
