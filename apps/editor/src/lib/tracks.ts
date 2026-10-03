import type { TrackKind } from "@tradeanim/project-schema";

export const TRACK_COLORS: Record<TrackKind, string> = {
  camera: "#f5b942",
  candles: "#7c8aa5",
  drawings: "#3b82f6",
  smc: "#f59e0b",
  text: "#14b8a6",
  media: "#a855f7",
  effects: "#ec4899",
  audio: "#22c55e",
};

export const TRACK_LABELS: Record<TrackKind, string> = {
  camera: "Camera",
  candles: "Candles",
  drawings: "Drawings",
  smc: "SMC / ICT",
  text: "Text",
  media: "Media",
  effects: "Effects",
  audio: "Audio",
};
