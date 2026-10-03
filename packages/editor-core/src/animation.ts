import type { AnimPreset, AnimSpec, Direction, EmphasisPreset, EmphasisSpec } from "@tradeanim/project-schema";
import { EASINGS, ease } from "./easing";

/**
 * Evaluated animation state of one object at one instant. Renderers apply it
 * on top of the object's static primitives. Mirrored 1:1 in Python
 * (tradeanim/project.py :: eval_anim) — keep both in sync.
 */
export interface AnimState {
  visible: boolean;
  opacity: number;
  /** 0..1 draw/wipe progress (1 = complete) */
  progress: number;
  /** how progress is applied */
  reveal: "none" | "draw" | "wipe";
  /** 0..1 fraction of characters shown */
  chars: number;
  scale: number;
  /** offset in frame fractions */
  dx: number;
  dy: number;
  /** additive glow 0..1 */
  glow: number;
  /** white flash / highlight 0..1 */
  flash: number;
  /** reference px */
  blur: number;
  /** draw a bright head at the end of a trace */
  traceHead: boolean;
}

export const ANIM_PRESETS: { id: AnimPreset; label: string }[] = [
  { id: "none", label: "None" },
  { id: "fade", label: "Fade" },
  { id: "scale", label: "Scale" },
  { id: "pop", label: "Pop" },
  { id: "slide", label: "Slide" },
  { id: "draw", label: "Draw" },
  { id: "wipe", label: "Wipe" },
  { id: "typewriter", label: "Typewriter" },
  { id: "bounce", label: "Bounce" },
  { id: "pulse", label: "Pulse" },
  { id: "glow", label: "Glow" },
  { id: "flash", label: "Flash" },
  { id: "highlight", label: "Highlight" },
  { id: "trace", label: "Trace" },
  { id: "cinematic", label: "Cinematic Reveal" },
];

export const EMPHASIS_PRESETS: { id: EmphasisPreset; label: string }[] = [
  { id: "none", label: "None" },
  { id: "pulse", label: "Pulse" },
  { id: "glow", label: "Glow" },
  { id: "flash", label: "Flash" },
  { id: "highlight", label: "Highlight" },
];

export function restState(): AnimState {
  return {
    visible: true,
    opacity: 1,
    progress: 1,
    reveal: "none",
    chars: 1,
    scale: 1,
    dx: 0,
    dy: 0,
    glow: 0,
    flash: 0,
    blur: 0,
    traceHead: false,
  };
}

export const HIDDEN: AnimState = { ...restState(), visible: false, opacity: 0 };

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

function slideOffset(dir: Direction | undefined, amount: number): [number, number] {
  const d = 0.06 * amount;
  switch (dir ?? "up") {
    case "left":
      return [-d, 0];
    case "right":
      return [d, 0];
    case "down":
      return [0, -d];
    default:
      return [0, d];
  }
}

/**
 * Apply a preset. `k` is the eased "presence" (0 = absent, 1 = fully shown),
 * `raw` the linear phase 0..1 of the in/out segment.
 */
function applyPreset(s: AnimState, preset: AnimPreset, k: number, raw: number, spec: AnimSpec, isOut: boolean) {
  switch (preset) {
    case "none":
      return;
    case "fade":
      s.opacity *= k;
      return;
    case "scale":
      s.scale *= k;
      s.opacity *= clamp01(k * 3);
      return;
    case "pop": {
      const v = isOut ? k : EASINGS.backOut(raw);
      s.scale *= Math.max(0, v);
      s.opacity *= clamp01(raw * 4);
      return;
    }
    case "bounce": {
      const v = isOut ? k : EASINGS.bounceOut(raw);
      s.scale *= v;
      s.opacity *= clamp01(raw * 5);
      return;
    }
    case "slide": {
      const [dx, dy] = slideOffset(spec.direction, 1 - k);
      s.dx += isOut ? -dx : dx;
      s.dy += isOut ? -dy : dy;
      s.opacity *= k;
      return;
    }
    case "draw":
      s.progress = Math.min(s.progress, k);
      s.reveal = "draw";
      return;
    case "wipe":
      s.progress = Math.min(s.progress, k);
      s.reveal = "wipe";
      return;
    case "typewriter":
      s.chars = Math.min(s.chars, k);
      s.progress = Math.min(s.progress, k);
      s.reveal = s.reveal === "none" ? "wipe" : s.reveal;
      return;
    case "trace":
      s.progress = Math.min(s.progress, k);
      s.reveal = "draw";
      s.glow += 0.7 * (1 - raw * 0.5);
      s.traceHead = k < 1;
      return;
    case "pulse":
      s.opacity *= k;
      s.scale *= 1 + 0.12 * Math.sin(raw * Math.PI * 3) * (1 - raw);
      return;
    case "glow":
      s.opacity *= k;
      s.glow += Math.sin(raw * Math.PI) * 0.9;
      return;
    case "flash":
      s.opacity *= raw >= 1 ? 1 : Math.floor(raw * 8) % 2 === 0 ? 1 : 0.15;
      s.flash += (1 - raw) * 0.6;
      return;
    case "highlight":
      s.opacity *= k;
      s.flash += Math.sin(raw * Math.PI) * 0.5;
      s.glow += Math.sin(raw * Math.PI) * 0.4;
      return;
    case "cinematic":
      s.opacity *= k;
      s.scale *= 1.12 - 0.12 * k;
      s.dy += (1 - k) * 0.02;
      s.blur += (1 - k) * 10;
      return;
  }
}

function applyEmphasis(s: AnimState, em: EmphasisSpec, local: number) {
  if (em.preset === "none" || em.duration <= 0) return;
  const p = (local - em.start) / em.duration;
  if (p < 0 || p > 1) return;
  const cycles = Math.max(1, em.cycles);
  const wave = (1 - Math.cos(p * cycles * 2 * Math.PI)) / 2; // 0..1..0 per cycle
  switch (em.preset) {
    case "pulse":
      s.scale *= 1 + 0.1 * wave;
      return;
    case "glow":
      s.glow += wave * 0.9;
      return;
    case "flash":
      s.opacity *= 1 - 0.75 * wave;
      return;
    case "highlight":
      s.flash += wave * 0.45;
      s.glow += wave * 0.3;
      return;
  }
}

export interface Timed {
  start: number;
  duration: number;
  animIn: AnimSpec;
  animOut: AnimSpec;
  emphasis?: EmphasisSpec;
}

/** Evaluate an object's animation at absolute time `t` (seconds). */
export function evalAnim(o: Timed, t: number): AnimState {
  const local = t - o.start;
  if (local < 0 || local > o.duration + 1e-9) return HIDDEN;
  const s = restState();

  const ai = o.animIn;
  if (ai && ai.preset !== "none" && ai.duration > 0) {
    const raw = clamp01((local - (ai.delay || 0)) / Math.min(ai.duration, o.duration));
    if (raw < 1) applyPreset(s, ai.preset, ease(ai.easing, raw), raw, ai, false);
  } else if (ai && ai.delay > 0 && local < ai.delay) {
    return HIDDEN;
  }

  const ao = o.animOut;
  if (ao && ao.preset !== "none" && ao.duration > 0) {
    const outDur = Math.min(ao.duration, o.duration);
    const outStart = o.duration - outDur - (ao.delay || 0);
    if (local > outStart) {
      const raw = clamp01((local - outStart) / outDur);
      applyPreset(s, ao.preset, 1 - ease(ao.easing, raw), 1 - raw, ao, true);
    }
  }

  if (o.emphasis) applyEmphasis(s, o.emphasis, local);
  if (s.opacity <= 0.001) s.visible = false;
  return s;
}
