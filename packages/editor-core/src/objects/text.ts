import type { ObjectDef } from "./types";
import { GOLD, prop } from "./helpers";
import type { Primitive } from "../primitives";

const textField = { key: "text", label: "Text", type: "textarea" as const };
const alignField = {
  key: "align",
  label: "Align",
  type: "select" as const,
  options: [
    { value: "left", label: "Left" },
    { value: "center", label: "Center" },
    { value: "right", label: "Right" },
  ],
};

export const heading: ObjectDef = {
  kind: "heading",
  label: "Heading",
  description: "Large title pinned to the frame",
  group: "text",
  track: "text",
  placement: "frame",
  anchors: 0,
  icon: "heading",
  shortcut: "T",
  defaults: () => ({
    style: { textColor: "#f8fafc", fontSize: 64, fontWeight: 800, shadow: 0.6 },
    props: { text: "Liquidity Sweep", align: "center" },
    frame: { x: 0.5, y: 0.14, w: 0.8, h: 0.1 },
    animIn: { preset: "cinematic", duration: 0.8 },
    animOut: { preset: "fade", duration: 0.4 },
  }),
  fields: [textField, alignField],
  compile: (o) => {
    const f = o.frame!;
    const align = prop(o, "align", "center") as "left" | "center" | "right";
    return [{ k: "text", space: "frame", x: f.x, y: f.y, text: String(prop(o, "text", "")), color: o.style.textColor, size: o.style.fontSize, weight: o.style.fontWeight, family: o.style.fontFamily, align, baseline: "middle", maxWidth: f.w, role: "body" }];
  },
};

export const caption: ObjectDef = {
  kind: "caption",
  label: "Caption",
  description: "Subtitle-style caption at the bottom of the frame",
  group: "text",
  track: "text",
  placement: "frame",
  anchors: 0,
  icon: "caption",
  defaults: () => ({
    style: { textColor: "#ffffff", fontSize: 36, fontWeight: 700, labelBg: "#000000" },
    props: { text: "Price sweeps the highs, then shifts structure.", bgOpacity: 0.6 },
    frame: { x: 0.5, y: 0.86, w: 0.84, h: 0.08 },
    animIn: { preset: "typewriter", duration: 1.0, easing: "linear" },
    animOut: { preset: "fade", duration: 0.3 },
  }),
  fields: [textField, { key: "bgOpacity", label: "Box opacity", type: "number", min: 0, max: 1, step: 0.05 }],
  compile: (o) => {
    const f = o.frame!;
    return [{ k: "text", space: "frame", x: f.x, y: f.y, text: String(prop(o, "text", "")), color: o.style.textColor, size: o.style.fontSize, weight: o.style.fontWeight, family: o.style.fontFamily, align: "center", baseline: "middle", bg: o.style.labelBg ?? "#000000", bgAlpha: Number(prop(o, "bgOpacity", 0.6)), pad: 14, maxWidth: f.w, role: "body" }];
  },
};

export const label: ObjectDef = {
  kind: "label",
  label: "Label",
  description: "Text label attached to a chart point",
  group: "text",
  track: "text",
  placement: "click1",
  anchors: 1,
  icon: "label",
  defaults: () => ({
    style: { textColor: "#0b0e14", fontSize: 20, fontWeight: 800, labelBg: GOLD },
    props: { text: "Entry", pill: true },
    animIn: { preset: "pop", duration: 0.5, easing: "backOut" },
  }),
  fields: [textField, { key: "pill", label: "Background pill", type: "bool" }],
  compile: (o) => {
    const p = o.points[0];
    const pill = prop(o, "pill", true);
    return [{ k: "text", x: p.t, y: p.p, text: String(prop(o, "text", "")), color: pill ? o.style.textColor : o.style.labelBg ?? GOLD, size: o.style.fontSize, weight: o.style.fontWeight, family: o.style.fontFamily, align: "center", baseline: "middle", bg: pill ? o.style.labelBg : undefined, pad: 6, role: "body" }];
  },
};

export const callout: ObjectDef = {
  kind: "callout",
  label: "Callout",
  description: "Text box with a leader line pointing at a chart point",
  group: "text",
  track: "text",
  placement: "drag2",
  anchors: 2,
  icon: "callout",
  defaults: () => ({
    style: { stroke: "#e2e8f0", strokeWidth: 1.5, textColor: "#f8fafc", fontSize: 20, fontWeight: 700, labelBg: "#111827" },
    props: { text: "Stops resting here" },
    animIn: { preset: "pop", duration: 0.5, easing: "backOut" },
  }),
  // a = target point, b = text box position
  fields: [textField],
  compile: (o) => {
    const [a, b] = o.points;
    const out: Primitive[] = [
      { k: "line", pts: [[b.t, b.p], [a.t, a.p]], stroke: o.style.stroke, width: o.style.strokeWidth },
      { k: "marker", x: a.t, y: a.p, shape: "circle", size: 5, color: o.style.stroke },
      { k: "text", x: b.t, y: b.p, text: String(prop(o, "text", "")), color: o.style.textColor, size: o.style.fontSize, weight: o.style.fontWeight, family: o.style.fontFamily, align: "center", baseline: "middle", bg: o.style.labelBg, bgAlpha: 0.92, pad: 8, role: "body" },
    ];
    return out;
  },
};

export const TEXT_DEFS = [heading, label, callout, caption];
