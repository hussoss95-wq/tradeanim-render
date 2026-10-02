import type { ObjectDef } from "./types";
import { BLUE, GOLD, box, boxHandles, dragBoxHandle, fmt, prop } from "./helpers";
import type { Primitive } from "../primitives";

const lineFields = [
  { key: "showPrice", label: "Price labels", type: "bool" as const },
  { key: "label", label: "Label", type: "text" as const },
];

function endLabels(o: Parameters<ObjectDef["compile"]>[0], ctx: Parameters<ObjectDef["compile"]>[1]): Primitive[] {
  const out: Primitive[] = [];
  const s = o.style;
  const label = prop(o, "label", "");
  const [a, b] = o.points;
  if (label && b) {
    out.push({
      k: "text",
      x: (a.t + b.t) / 2,
      y: (a.p + b.p) / 2,
      text: String(label),
      color: s.textColor,
      size: s.fontSize * 0.8,
      weight: s.fontWeight,
      align: "center",
      baseline: "bottom",
      dy: -8,
    });
  }
  if (prop(o, "showPrice", false)) {
    for (const pt of o.points) {
      out.push({ k: "text", x: pt.t, y: pt.p, text: fmt(ctx, pt.p), color: s.stroke, size: 15, align: "left", baseline: "middle", dx: 8, bg: "#000000", bgAlpha: 0.55, pad: 4 });
    }
  }
  return out;
}

export const trendline: ObjectDef = {
  kind: "trendline",
  label: "Trendline",
  description: "Straight line between two chart points",
  group: "drawing",
  track: "drawings",
  placement: "drag2",
  anchors: 2,
  icon: "trendline",
  shortcut: "L",
  defaults: () => ({ style: { stroke: BLUE, strokeWidth: 2.5 }, props: { showPrice: false, label: "" }, animIn: { preset: "draw", duration: 0.8 } }),
  fields: lineFields,
  compile: (o, ctx) => [
    { k: "line", pts: o.points.map((p) => [p.t, p.p] as [number, number]), stroke: o.style.stroke, width: o.style.strokeWidth, dash: o.style.dash },
    ...endLabels(o, ctx),
  ],
};

export const ray: ObjectDef = {
  ...trendline,
  kind: "ray",
  label: "Ray",
  description: "Line from a point through a second point, extended to the right edge",
  icon: "ray",
  shortcut: undefined,
  compile: (o, ctx) => [
    { k: "line", pts: o.points.map((p) => [p.t, p.p] as [number, number]), stroke: o.style.stroke, width: o.style.strokeWidth, dash: o.style.dash, extendRight: true },
    ...endLabels(o, ctx),
  ],
};

export const hline: ObjectDef = {
  kind: "hline",
  label: "Horizontal Line",
  description: "Full-width price level",
  group: "drawing",
  track: "drawings",
  placement: "click1",
  anchors: 1,
  icon: "hline",
  shortcut: "H",
  defaults: () => ({ style: { stroke: GOLD, strokeWidth: 2, dash: "dashed" }, props: { label: "", showPrice: true }, animIn: { preset: "wipe", duration: 0.6 } }),
  fields: [
    { key: "label", label: "Label", type: "text" },
    { key: "showPrice", label: "Price tag", type: "bool" },
  ],
  compile: (o, ctx) => {
    const p = o.points[0];
    const out: Primitive[] = [{ k: "hline", y: p.p, x1: null, x2: null, stroke: o.style.stroke, width: o.style.strokeWidth, dash: o.style.dash }];
    const label = prop(o, "label", "");
    if (label) out.push({ k: "text", x: p.t, y: p.p, text: String(label), color: o.style.textColor, size: o.style.fontSize * 0.75, weight: o.style.fontWeight, align: "left", baseline: "bottom", dy: -6 });
    if (prop(o, "showPrice", true))
      out.push({ k: "text", x: p.t, y: p.p, text: fmt(ctx, p.p), color: "#0b0e14", size: 15, weight: 700, align: "right", baseline: "middle", bg: o.style.stroke, pad: 5, pinRight: true });
    return out;
  },
};

export const arrow: ObjectDef = {
  kind: "arrow",
  label: "Arrow",
  description: "Arrow pointing from the first point to the second",
  group: "drawing",
  track: "drawings",
  placement: "drag2",
  anchors: 2,
  icon: "arrow",
  shortcut: "A",
  defaults: () => ({ style: { stroke: "#f8fafc", strokeWidth: 3 }, props: { label: "" }, animIn: { preset: "draw", duration: 0.6 } }),
  fields: [{ key: "label", label: "Label", type: "text" }],
  compile: (o, ctx) => [
    { k: "line", pts: o.points.map((p) => [p.t, p.p] as [number, number]), stroke: o.style.stroke, width: o.style.strokeWidth, dash: o.style.dash, arrowEnd: true },
    ...endLabels(o, ctx),
  ],
};

export const path: ObjectDef = {
  kind: "path",
  label: "Path",
  description: "Multi-point path (click points, double-click to finish) — great for projected price paths",
  group: "drawing",
  track: "drawings",
  placement: "multi",
  anchors: -1,
  icon: "path",
  shortcut: "P",
  defaults: () => ({ style: { stroke: "#e2e8f0", strokeWidth: 2.5, dash: "dashed" }, props: { arrowEnd: true }, animIn: { preset: "trace", duration: 1.2 } }),
  fields: [{ key: "arrowEnd", label: "Arrow head", type: "bool" }],
  compile: (o) => [
    { k: "line", pts: o.points.map((p) => [p.t, p.p] as [number, number]), stroke: o.style.stroke, width: o.style.strokeWidth, dash: o.style.dash, arrowEnd: prop(o, "arrowEnd", true) },
  ],
};

export const rect: ObjectDef = {
  kind: "rect",
  label: "Rectangle",
  description: "Outlined rectangle",
  group: "drawing",
  track: "drawings",
  placement: "drag2",
  anchors: 2,
  icon: "rect",
  shortcut: "R",
  defaults: () => ({ style: { stroke: "#e2e8f0", strokeWidth: 2, fill: "#e2e8f0", fillOpacity: 0.06 }, props: { label: "" }, animIn: { preset: "draw", duration: 0.6 } }),
  fields: [{ key: "label", label: "Label", type: "text" }],
  handles: boxHandles,
  dragHandle: dragBoxHandle,
  compile: (o) => {
    const b = box(o);
    const out: Primitive[] = [{ k: "rect", ...b, fill: o.style.fill, fillAlpha: o.style.fillOpacity, stroke: o.style.stroke, width: o.style.strokeWidth, dash: o.style.dash }];
    const label = prop(o, "label", "");
    if (label) out.push({ k: "text", x: b.x1, y: b.y2, text: String(label), color: o.style.textColor, size: o.style.fontSize * 0.75, weight: o.style.fontWeight, align: "left", baseline: "bottom", dy: -6 });
    return out;
  },
};

export const zone: ObjectDef = {
  kind: "zone",
  label: "Zone",
  description: "Filled price zone with optional label and right extension",
  group: "drawing",
  track: "drawings",
  placement: "drag2",
  anchors: 2,
  icon: "zone",
  shortcut: "Z",
  defaults: () => ({ style: { stroke: BLUE, strokeWidth: 1, fill: BLUE, fillOpacity: 0.2, textColor: "#bfdbfe" }, props: { label: "Zone", extendRight: false }, animIn: { preset: "wipe", duration: 0.6 } }),
  fields: [
    { key: "label", label: "Label", type: "text" },
    { key: "extendRight", label: "Extend right", type: "bool" },
  ],
  handles: boxHandles,
  dragHandle: dragBoxHandle,
  compile: (o) => {
    const b = box(o);
    const out: Primitive[] = [
      { k: "rect", ...b, fill: o.style.fill, fillAlpha: o.style.fillOpacity, stroke: o.style.stroke, width: o.style.strokeWidth, dash: o.style.dash, extendRight: prop(o, "extendRight", false) },
    ];
    const label = prop(o, "label", "");
    if (label) out.push({ k: "text", x: b.x1, y: (b.y1 + b.y2) / 2, text: String(label), color: o.style.textColor, size: o.style.fontSize * 0.7, weight: 700, align: "left", baseline: "middle", dx: 8 });
    return out;
  },
};

export const circle: ObjectDef = {
  kind: "circle",
  label: "Circle",
  description: "Ellipse around an area of interest",
  group: "drawing",
  track: "drawings",
  placement: "drag2",
  anchors: 2,
  icon: "circle",
  shortcut: "O",
  defaults: () => ({ style: { stroke: GOLD, strokeWidth: 3, fill: GOLD, fillOpacity: 0 }, props: {}, animIn: { preset: "draw", duration: 0.7 } }),
  fields: [],
  handles: boxHandles,
  dragHandle: dragBoxHandle,
  compile: (o) => {
    const b = box(o);
    return [
      { k: "ellipse", cx: (b.x1 + b.x2) / 2, cy: (b.y1 + b.y2) / 2, rx: (b.x2 - b.x1) / 2, ry: (b.y2 - b.y1) / 2, stroke: o.style.stroke, width: o.style.strokeWidth, fill: o.style.fill, fillAlpha: o.style.fillOpacity, dash: o.style.dash },
    ];
  },
};

export const DRAWING_DEFS = [trendline, ray, hline, arrow, path, rect, zone, circle];
