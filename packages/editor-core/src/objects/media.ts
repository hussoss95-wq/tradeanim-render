import type { ObjectDef } from "./types";
import { GOLD, prop } from "./helpers";

export const image: ObjectDef = {
  kind: "image",
  label: "Image",
  description: "Image placed in the frame",
  group: "media",
  track: "media",
  placement: "frame",
  anchors: 0,
  icon: "image",
  defaults: () => ({ props: { assetId: "" }, frame: { x: 0.5, y: 0.5, w: 0.3, h: 0.3 }, animIn: { preset: "fade", duration: 0.5 } }),
  fields: [{ key: "assetId", label: "Image", type: "asset" }],
  compile: (o) => {
    const f = o.frame!;
    const id = String(prop(o, "assetId", ""));
    return id ? [{ k: "image", assetId: id, x: f.x - f.w / 2, y: f.y - f.h / 2, w: f.w, h: f.h, role: "body" }] : [];
  },
};

export const logo: ObjectDef = {
  ...image,
  kind: "logo",
  label: "Logo",
  description: "Brand logo pinned to a frame corner",
  icon: "logo",
  defaults: () => ({ props: { assetId: "" }, frame: { x: 0.9, y: 0.09, w: 0.12, h: 0.1 }, animIn: { preset: "fade", duration: 0.6 } }),
};

export const spotlight: ObjectDef = {
  kind: "spotlight",
  label: "Spotlight",
  description: "Dims everything except a circle around a chart point",
  group: "effects",
  track: "effects",
  placement: "click1",
  anchors: 1,
  icon: "spotlight",
  defaults: () => ({ props: { radius: 0.16, dim: 0.65 }, animIn: { preset: "fade", duration: 0.6 }, animOut: { preset: "fade", duration: 0.5 }, duration: 3 }),
  fields: [
    { key: "radius", label: "Radius", type: "number", min: 0.02, max: 1, step: 0.01 },
    { key: "dim", label: "Dim", type: "number", min: 0, max: 1, step: 0.05 },
  ],
  compile: (o) => [{ k: "spotlight", x: o.points[0].t, y: o.points[0].p, r: Number(prop(o, "radius", 0.16)), dim: Number(prop(o, "dim", 0.65)) }],
};

export const glowOrb: ObjectDef = {
  kind: "glowOrb",
  label: "Glow Orb",
  description: "Soft glowing light anchored to a chart point",
  group: "effects",
  track: "effects",
  placement: "click1",
  anchors: 1,
  icon: "orb",
  defaults: () => ({ style: { fill: GOLD }, props: { radius: 0.08 }, animIn: { preset: "pop", duration: 0.5 }, duration: 3 }),
  fields: [{ key: "radius", label: "Radius", type: "number", min: 0.01, max: 0.5, step: 0.01 }],
  compile: (o) => [{ k: "glowOrb", x: o.points[0].t, y: o.points[0].p, r: Number(prop(o, "radius", 0.08)), color: o.style.fill }],
};

export const vignette: ObjectDef = {
  kind: "vignette",
  label: "Vignette",
  description: "Darkens the frame edges",
  group: "effects",
  track: "effects",
  placement: "global",
  anchors: 0,
  icon: "vignette",
  defaults: () => ({ props: { strength: 0.55 }, animIn: { preset: "fade", duration: 0.8 }, duration: 6 }),
  fields: [{ key: "strength", label: "Strength", type: "number", min: 0, max: 1, step: 0.05 }],
  compile: (o) => [{ k: "vignette", strength: Number(prop(o, "strength", 0.55)) }],
};

export const flash: ObjectDef = {
  kind: "flash",
  label: "Flash",
  description: "Full-frame flash transition",
  group: "effects",
  track: "effects",
  placement: "global",
  anchors: 0,
  icon: "flash",
  defaults: () => ({ style: { fill: "#ffffff" }, props: { strength: 0.85 }, animIn: { preset: "fade", duration: 0.08, easing: "linear" }, animOut: { preset: "fade", duration: 0.3 }, duration: 0.45 }),
  fields: [{ key: "strength", label: "Strength", type: "number", min: 0, max: 1, step: 0.05 }],
  compile: (o) => [{ k: "flash", color: o.style.fill, strength: Number(prop(o, "strength", 0.85)) }],
};

export const audio: ObjectDef = {
  kind: "audio",
  label: "Audio",
  description: "Music, voice-over or SFX clip",
  group: "audio",
  track: "audio",
  placement: "global",
  anchors: 0,
  icon: "audio",
  defaults: () => ({ props: { assetId: "", volume: 1, offset: 0 }, animIn: { preset: "none" }, duration: 8 }),
  fields: [
    { key: "assetId", label: "Audio file", type: "asset" },
    { key: "volume", label: "Volume", type: "number", min: 0, max: 2, step: 0.05 },
    { key: "offset", label: "Trim start (s)", type: "number", min: 0, step: 0.1 },
  ],
  compile: () => [],
};

export const MEDIA_DEFS = [image, logo];
export const EFFECT_DEFS = [spotlight, glowOrb, vignette, flash];
export const AUDIO_DEFS = [audio];
