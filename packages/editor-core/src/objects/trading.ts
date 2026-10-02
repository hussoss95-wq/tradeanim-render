import type { SceneObject, WorldPoint } from "@tradeanim/project-schema";
import type { Primitive } from "../primitives";
import type { CompileCtx, Handle, ObjectDef } from "./types";
import { BEAR, BULL, GOLD, fmt, prop } from "./helpers";

/* ---------------- Long / Short position ----------------
 * anchors: [0] entry (t1, entry), [1] target (t2, tp), [2] stop (t2, sl)
 */

function positionPlace(long: boolean) {
  return (a: WorldPoint, b: WorldPoint): WorldPoint[] => {
    const t1 = Math.min(a.t, b.t);
    const t2 = Math.max(a.t, b.t, t1 + 6);
    let dist = Math.abs(b.p - a.p);
    if (dist === 0) dist = Math.abs(a.p) * 0.004 || 1;
    const tp = long ? a.p + dist : a.p - dist;
    const sl = long ? a.p - dist / 2 : a.p + dist / 2;
    return [
      { t: t1, p: a.p },
      { t: t2, p: tp },
      { t: t2, p: sl },
    ];
  };
}

function positionHandles(o: SceneObject): Handle[] {
  const [e, tp, sl] = o.points;
  return [
    { id: "entry", t: e.t, p: e.p, cursor: "move" },
    { id: "target", t: tp.t, p: tp.p, cursor: "ns-resize" },
    { id: "stop", t: tp.t, p: sl.p, cursor: "ns-resize" },
    { id: "end", t: tp.t, p: e.p, cursor: "ew-resize" },
  ];
}

function positionDrag(o: SceneObject, id: string, pt: WorldPoint): WorldPoint[] {
  const [e, tp, sl] = o.points.map((p) => ({ ...p }));
  if (id === "entry") {
    e.t = pt.t;
    e.p = pt.p;
  } else if (id === "target") tp.p = pt.p;
  else if (id === "stop") sl.p = pt.p;
  else if (id === "end") {
    tp.t = Math.max(e.t + 1, pt.t);
  }
  sl.t = tp.t;
  return [e, tp, sl];
}

function compilePosition(o: SceneObject, ctx: CompileCtx, long: boolean): Primitive[] {
  const [e, tp, sl] = o.points;
  const t1 = e.t;
  const t2 = tp.t;
  const reward = Math.abs(tp.p - e.p);
  const risk = Math.abs(e.p - sl.p) || 1e-12;
  const rr = reward / risk;
  const pct = (v: number) => ((v / e.p) * 100).toFixed(2);
  const fa = o.style.fillOpacity;
  const size = 15;
  const out: Primitive[] = [
    { k: "rect", x1: t1, x2: t2, y1: Math.min(e.p, tp.p), y2: Math.max(e.p, tp.p), fill: BULL, fillAlpha: fa, stroke: BULL, width: 1, role: "target" },
    { k: "rect", x1: t1, x2: t2, y1: Math.min(e.p, sl.p), y2: Math.max(e.p, sl.p), fill: BEAR, fillAlpha: fa, stroke: BEAR, width: 1, role: "stop" },
    { k: "hline", y: e.p, x1: t1, x2: t2, stroke: "#e2e8f0", width: 2 },
  ];
  if (prop(o, "showLabels", true)) {
    const mid = (t1 + t2) / 2;
    const tpY = tp.p;
    const slY = sl.p;
    const up = long ? "bottom" : "top";
    const down = long ? "top" : "bottom";
    out.push(
      { k: "text", x: mid, y: tpY, text: `Target ${fmt(ctx, tp.p)}  (${pct(reward)}%)`, color: "#ffffff", size, weight: 700, align: "center", baseline: up, bg: BULL, pad: 5, dy: long ? -4 : 4 },
      { k: "text", x: mid, y: slY, text: `Stop ${fmt(ctx, sl.p)}  (${pct(risk)}%)`, color: "#ffffff", size, weight: 700, align: "center", baseline: down, bg: BEAR, pad: 5, dy: long ? 4 : -4 },
      { k: "text", x: mid, y: e.p, text: `${long ? "LONG" : "SHORT"}  ${fmt(ctx, e.p)}  ·  R:R ${rr.toFixed(2)}`, color: "#0b0e14", size, weight: 800, align: "center", baseline: "middle", bg: "#e2e8f0", pad: 5 },
    );
  }
  return out;
}

const positionFields = [
  { key: "showLabels", label: "Labels", type: "bool" as const },
];

export const longPosition: ObjectDef = {
  kind: "longPosition",
  label: "Long Position",
  description: "Long trade: entry, stop-loss, take-profit and risk:reward",
  group: "trading",
  track: "drawings",
  placement: "drag2",
  anchors: 3,
  icon: "long",
  defaults: () => ({ style: { fillOpacity: 0.22 }, props: { showLabels: true }, animIn: { preset: "wipe", duration: 0.7 } }),
  place: positionPlace(true),
  fields: positionFields,
  handles: positionHandles,
  dragHandle: positionDrag,
  compile: (o, ctx) => compilePosition(o, ctx, true),
};

export const shortPosition: ObjectDef = {
  ...longPosition,
  kind: "shortPosition",
  label: "Short Position",
  description: "Short trade: entry, stop-loss, take-profit and risk:reward",
  icon: "short",
  place: positionPlace(false),
  compile: (o, ctx) => compilePosition(o, ctx, false),
};

/* ---------------- Risk / reward measure ---------------- */
export const riskReward: ObjectDef = {
  kind: "riskReward",
  label: "Risk Reward",
  description: "Measure a move: price change, percent, bars and R multiple",
  group: "trading",
  track: "drawings",
  placement: "drag2",
  anchors: 2,
  icon: "measure",
  defaults: () => ({ style: { stroke: "#60a5fa", fill: "#3b82f6", fillOpacity: 0.16 }, props: { riskUnit: 0 }, animIn: { preset: "wipe", duration: 0.6 } }),
  fields: [{ key: "riskUnit", label: "1R size (price)", type: "number", step: 0.0001 }],
  compile: (o, ctx) => {
    const [a, b] = o.points;
    const d = b.p - a.p;
    const bars = Math.round(Math.abs(b.t - a.t));
    const r = Number(prop(o, "riskUnit", 0));
    const color = d >= 0 ? BULL : BEAR;
    const text = `${d >= 0 ? "+" : ""}${fmt(ctx, d)} (${((d / a.p) * 100).toFixed(2)}%) · ${bars} bars${r > 0 ? ` · ${(d / r).toFixed(1)}R` : ""}`;
    return [
      { k: "rect", x1: Math.min(a.t, b.t), x2: Math.max(a.t, b.t), y1: Math.min(a.p, b.p), y2: Math.max(a.p, b.p), fill: color, fillAlpha: o.style.fillOpacity, stroke: color, width: 1 },
      { k: "line", pts: [[(a.t + b.t) / 2, a.p], [(a.t + b.t) / 2, b.p]], stroke: color, width: 2, arrowEnd: true },
      { k: "text", x: (a.t + b.t) / 2, y: Math.max(a.p, b.p), text, color: "#ffffff", size: 15, weight: 700, align: "center", baseline: "bottom", bg: color, pad: 5, dy: -6 },
    ];
  },
};

/* ---------------- Fibonacci retracement ---------------- */
const DEFAULT_LEVELS = "0, 0.236, 0.382, 0.5, 0.618, 0.786, 1";

export const fibonacci: ObjectDef = {
  kind: "fibonacci",
  label: "Fibonacci",
  description: "Fibonacci retracement between a swing high and low",
  group: "trading",
  track: "drawings",
  placement: "drag2",
  anchors: 2,
  icon: "fib",
  shortcut: "F",
  defaults: () => ({ style: { stroke: "#94a3b8", strokeWidth: 1.5, fill: GOLD, fillOpacity: 0.08 }, props: { levels: DEFAULT_LEVELS, extendRight: true, showPrices: true, highlightGolden: true }, animIn: { preset: "wipe", duration: 0.8 } }),
  fields: [
    { key: "levels", label: "Levels", type: "text" },
    { key: "extendRight", label: "Extend right", type: "bool" },
    { key: "showPrices", label: "Prices", type: "bool" },
    { key: "highlightGolden", label: "Golden pocket", type: "bool" },
  ],
  compile: (o, ctx) => {
    const [a, b] = o.points;
    const x1 = Math.min(a.t, b.t);
    const x2 = prop(o, "extendRight", true) ? null : Math.max(a.t, b.t);
    const levels = String(prop(o, "levels", DEFAULT_LEVELS))
      .split(",")
      .map((s) => Number(s.trim()))
      .filter(Number.isFinite);
    // retracement measured from b (end of move) back toward a (start)
    const at = (lv: number) => b.p + (a.p - b.p) * lv;
    const out: Primitive[] = [];
    if (prop(o, "highlightGolden", true)) {
      out.push({ k: "rect", x1, x2: x2 ?? Math.max(a.t, b.t), extendRight: x2 === null, y1: Math.min(at(0.618), at(0.65)), y2: Math.max(at(0.618), at(0.65)), fill: GOLD, fillAlpha: 0.22 });
    }
    for (const lv of levels) {
      const y = at(lv);
      const key = lv === 0.5 || lv === 0.618;
      out.push({ k: "hline", y, x1, x2, stroke: key ? GOLD : o.style.stroke, width: o.style.strokeWidth, dash: lv === 0 || lv === 1 ? "solid" : "dashed" });
      out.push({ k: "text", x: x1, y, text: `${lv}${prop(o, "showPrices", true) ? `  (${fmt(ctx, y)})` : ""}`, color: key ? GOLD : "#cbd5e1", size: 14, weight: 600, align: "right", baseline: "middle", dx: -6 });
    }
    out.push({ k: "line", pts: [[a.t, a.p], [b.t, b.p]], stroke: "#64748b", width: 1, dash: "dotted" });
    return out;
  },
};

export const TRADING_DEFS = [longPosition, shortPosition, riskReward, fibonacci];
