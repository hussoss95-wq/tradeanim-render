import type { SceneObject, WorldPoint } from "@tradeanim/project-schema";
import { formatPrice } from "../chart";
import type { CompileCtx, FieldDef, Handle } from "./types";

export const BULL = "#22c55e";
export const BEAR = "#ef4444";
export const NEUTRAL = "#94a3b8";
export const GOLD = "#f5b942";
export const BLUE = "#3b82f6";
export const PURPLE = "#a855f7";
export const CYAN = "#22d3ee";

export const prop = <T>(o: SceneObject, key: string, fallback: T): T =>
  (o.props[key] as T | undefined) ?? fallback;

export const isBullish = (o: SceneObject) => prop(o, "direction", "bullish") === "bullish";

export const dirColor = (o: SceneObject) => (isBullish(o) ? BULL : BEAR);

export const fmt = (ctx: CompileCtx, v: number) => formatPrice(v, ctx.decimals);

export function box(o: SceneObject) {
  const [a, b] = o.points;
  const bb = b ?? a;
  return {
    x1: Math.min(a.t, bb.t),
    x2: Math.max(a.t, bb.t),
    y1: Math.min(a.p, bb.p),
    y2: Math.max(a.p, bb.p),
  };
}

/** Corner handles for 2-anchor boxes; edge handles for resizing in one axis. */
export function boxHandles(o: SceneObject): Handle[] {
  const { x1, x2, y1, y2 } = box(o);
  return [
    { id: "tl", t: x1, p: y2, cursor: "nwse-resize" },
    { id: "tr", t: x2, p: y2, cursor: "nesw-resize" },
    { id: "bl", t: x1, p: y1, cursor: "nesw-resize" },
    { id: "br", t: x2, p: y1, cursor: "nwse-resize" },
  ];
}

export function dragBoxHandle(o: SceneObject, id: string, pt: WorldPoint): WorldPoint[] {
  let { x1, x2, y1, y2 } = box(o);
  if (id.includes("l")) x1 = pt.t;
  if (id.includes("r")) x2 = pt.t;
  if (id.includes("t")) y2 = pt.p;
  if (id.includes("b")) y1 = pt.p;
  return [
    { t: x1, p: y2 },
    { t: x2, p: y1 },
  ];
}

/** Level-style anchors: second anchor shares the first anchor's price. */
export function levelHandles(o: SceneObject): Handle[] {
  const [a, b] = o.points;
  const hs: Handle[] = [{ id: "0", t: a.t, p: a.p, cursor: "move" }];
  if (b) hs.push({ id: "1", t: b.t, p: a.p, cursor: "ew-resize" });
  return hs;
}

export function dragLevelHandle(o: SceneObject, id: string, pt: WorldPoint): WorldPoint[] {
  const pts = o.points.map((p) => ({ ...p }));
  if (id === "0") {
    pts[0] = { t: pt.t, p: pt.p };
    if (pts[1]) pts[1].p = pt.p;
  } else if (pts[1]) {
    pts[1] = { t: pt.t, p: pts[0].p };
  }
  return pts;
}

export const levelPlace = (a: WorldPoint, b: WorldPoint) => [
  { t: Math.min(a.t, b.t), p: a.p },
  { t: Math.max(a.t, b.t, Math.min(a.t, b.t) + 1), p: a.p },
];

export const DIRECTION_FIELD: FieldDef = {
  key: "direction",
  label: "Direction",
  type: "select",
  options: [
    { value: "bullish", label: "Bullish" },
    { value: "bearish", label: "Bearish" },
  ],
};

export const LABEL_FIELDS: FieldDef[] = [
  { key: "showLabel", label: "Show label", type: "bool" },
  { key: "label", label: "Label", type: "text", when: (o) => prop(o, "showLabel", true) },
];

export const EXTEND_FIELD: FieldDef = { key: "extendRight", label: "Extend right", type: "bool" };

/** Recolour stroke/fill when the semantic direction flips. */
export function recolorOnDirection(o: SceneObject, key: string) {
  if (key !== "direction") return;
  const c = isBullish(o) ? BULL : BEAR;
  return { style: { ...o.style, stroke: c, fill: c, textColor: c } };
}

export function labelText(o: SceneObject, fallback: string): string | null {
  if (!prop(o, "showLabel", true)) return null;
  const s = prop(o, "label", fallback);
  return s ? String(s) : null;
}
