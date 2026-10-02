/**
 * SMC / ICT semantic objects.
 *
 * Each kind owns its data model (anchors + typed props), its visual
 * compilation, its inspector fields and its default animation. They are not
 * generic rectangles: an FVG knows its consequent encroachment, a position its
 * R:R, a displacement measures the candles it spans, a kill zone its session.
 */
import type { ObjectKind } from "@tradeanim/project-schema";
import type { Primitive } from "../primitives";
import type { CompileCtx, FieldDef, ObjectDef } from "./types";
import {
  BEAR,
  BULL,
  CYAN,
  DIRECTION_FIELD,
  EXTEND_FIELD,
  GOLD,
  LABEL_FIELDS,
  NEUTRAL,
  PURPLE,
  box,
  boxHandles,
  dragBoxHandle,
  dragLevelHandle,
  fmt,
  isBullish,
  labelText,
  levelHandles,
  levelPlace,
  prop,
  recolorOnDirection,
} from "./helpers";

const smcBase = {
  group: "smc" as const,
  track: "smc" as const,
};

/* ---------------------------------------------------------------- boxes */

interface BoxOpts {
  kind: ObjectKind;
  label: string;
  tag: string;
  description: string;
  icon: string;
  dash?: "solid" | "dashed" | "dotted";
  midlineDefault?: boolean;
  invert?: boolean;
  fillOpacity?: number;
  extra?: FieldDef[];
}

function boxKind(opts: BoxOpts): ObjectDef {
  return {
    ...smcBase,
    kind: opts.kind,
    label: opts.label,
    description: opts.description,
    placement: "drag2",
    anchors: 2,
    icon: opts.icon,
    defaults: () => ({
      style: { stroke: BULL, fill: BULL, textColor: BULL, fillOpacity: opts.fillOpacity ?? 0.2, strokeWidth: 1.2, dash: opts.dash ?? "solid", fontSize: 18 },
      props: { direction: "bullish", showLabel: true, label: opts.tag, extendRight: false, midline: opts.midlineDefault ?? false, mitigated: false },
      animIn: { preset: "wipe", duration: 0.6 },
    }),
    fields: [
      DIRECTION_FIELD,
      ...LABEL_FIELDS,
      EXTEND_FIELD,
      { key: "midline", label: opts.kind === "fvg" || opts.kind === "ifvg" ? "CE (50%)" : "Mean threshold", type: "bool" },
      { key: "mitigated", label: "Mitigated", type: "bool" },
      ...(opts.extra ?? []),
    ],
    handles: boxHandles,
    dragHandle: dragBoxHandle,
    onPropChange: recolorOnDirection,
    compile: (o) => {
      const b = box(o);
      const s = o.style;
      const mitigated = prop(o, "mitigated", false);
      const extend = prop(o, "extendRight", false);
      const out: Primitive[] = [
        {
          k: "rect",
          ...b,
          fill: s.fill,
          fillAlpha: s.fillOpacity * (mitigated ? 0.4 : 1),
          stroke: s.stroke,
          width: s.strokeWidth,
          dash: s.dash,
          extendRight: extend,
          role: "body",
        },
      ];
      if (prop(o, "midline", false)) {
        const mid = (b.y1 + b.y2) / 2;
        out.push({ k: "hline", y: mid, x1: b.x1, x2: extend ? null : b.x2, stroke: s.stroke, width: 1, dash: "dashed", alpha: 0.9 });
      }
      const text = labelText(o, opts.tag);
      if (text) {
        out.push({
          k: "text",
          x: b.x2,
          y: (b.y1 + b.y2) / 2,
          text: mitigated ? `${text} ✓` : text,
          color: s.textColor,
          size: s.fontSize,
          weight: 800,
          align: "left",
          baseline: "middle",
          dx: 8,
        });
      }
      return out;
    },
  };
}

export const fvg = boxKind({ kind: "fvg", label: "FVG", tag: "FVG", description: "Fair value gap: 3-candle imbalance; CE = 50% of the gap", icon: "fvg", midlineDefault: true });
export const ifvg = boxKind({ kind: "ifvg", label: "IFVG", tag: "IFVG", description: "Inversion FVG: a violated FVG that flips polarity", icon: "ifvg", dash: "dashed", midlineDefault: true, fillOpacity: 0.14 });
export const orderBlock = boxKind({ kind: "orderBlock", label: "Order Block", tag: "OB", description: "Last opposing candle before displacement", icon: "ob" });
export const breakerBlock = boxKind({ kind: "breakerBlock", label: "Breaker Block", tag: "BB", description: "Failed order block that broke structure", icon: "breaker", dash: "dashed" });
export const mitigationBlock = boxKind({ kind: "mitigationBlock", label: "Mitigation Block", tag: "MB", description: "Order block from a failure swing without a new extreme", icon: "mitigation", dash: "dotted", fillOpacity: 0.14 });

/* ----------------------------------------------------- structure breaks */

function structureKind(kind: ObjectKind, label: string, tag: string, description: string, color?: string): ObjectDef {
  return {
    ...smcBase,
    kind,
    label,
    description,
    placement: "drag2",
    anchors: 2,
    icon: kind,
    defaults: () => ({
      style: { stroke: color ?? BULL, textColor: color ?? BULL, strokeWidth: 2, dash: "dashed", fontSize: 18 },
      props: { direction: "bullish", showLabel: true, label: tag, marker: true },
      animIn: { preset: "draw", duration: 0.6 },
    }),
    place: levelPlace,
    fields: [DIRECTION_FIELD, ...LABEL_FIELDS, { key: "marker", label: "Break marker", type: "bool" }],
    handles: levelHandles,
    dragHandle: dragLevelHandle,
    onPropChange: (o, key) => (color ? undefined : recolorOnDirection(o, key)),
    compile: (o) => {
      const [a, b] = o.points;
      const s = o.style;
      const bull = isBullish(o);
      const out: Primitive[] = [{ k: "line", pts: [[a.t, a.p], [b.t, a.p]], stroke: s.stroke, width: s.strokeWidth, dash: s.dash }];
      const text = labelText(o, tag);
      if (text)
        out.push({ k: "text", x: (a.t + b.t) / 2, y: a.p, text, color: s.textColor, size: s.fontSize, weight: 800, align: "center", baseline: bull ? "bottom" : "top", dy: bull ? -5 : 5 });
      if (prop(o, "marker", true)) out.push({ k: "marker", x: b.t, y: a.p, shape: "circle", size: 7, color: s.stroke });
      return out;
    },
  };
}

export const bos = structureKind("bos", "BOS", "BOS", "Break of structure: continuation break of a swing");
export const choch = structureKind("choch", "CHoCH", "CHoCH", "Change of character: first break against the trend", GOLD);
export const mss = structureKind("mss", "MSS", "MSS", "Market structure shift with displacement", PURPLE);
export const cisd = structureKind("cisd", "CISD", "CISD", "Change in state of delivery: close through the opening price of the delivery leg", CYAN);

/* -------------------------------------------------------------- liquidity */

function liquidityKind(kind: ObjectKind, label: string, description: string, mode: "pool" | "sweep" | "grab"): ObjectDef {
  return {
    ...smcBase,
    kind,
    label,
    description,
    placement: "drag2",
    anchors: 2,
    icon: kind,
    defaults: () => ({
      style: { stroke: GOLD, textColor: GOLD, strokeWidth: 2, dash: mode === "pool" ? "dotted" : "dashed", fontSize: 17 },
      props: { side: "buy", showLabel: true, label: "", taken: mode !== "pool" },
      animIn: { preset: mode === "pool" ? "wipe" : "draw", duration: 0.6 },
    }),
    place: levelPlace,
    fields: [
      { key: "side", label: "Side", type: "select", options: [{ value: "buy", label: "Buy-side (BSL)" }, { value: "sell", label: "Sell-side (SSL)" }] },
      ...LABEL_FIELDS,
      { key: "taken", label: "Swept / taken", type: "bool" },
    ],
    handles: levelHandles,
    dragHandle: dragLevelHandle,
    compile: (o) => {
      const [a, b] = o.points;
      const s = o.style;
      const buy = prop(o, "side", "buy") === "buy";
      const defaultTag = mode === "pool" ? (buy ? "BSL $$$" : "SSL $$$") : mode === "sweep" ? (buy ? "BSL Sweep" : "SSL Sweep") : buy ? "Liquidity Grab ↑" : "Liquidity Grab ↓";
      const out: Primitive[] = [{ k: "line", pts: [[a.t, a.p], [b.t, a.p]], stroke: s.stroke, width: s.strokeWidth, dash: s.dash }];
      const custom = String(prop(o, "label", ""));
      const text = prop(o, "showLabel", true) ? custom || defaultTag : null;
      if (text) out.push({ k: "text", x: a.t, y: a.p, text, color: s.textColor, size: s.fontSize, weight: 800, align: "left", baseline: buy ? "bottom" : "top", dy: buy ? -5 : 5 });
      if (prop(o, "taken", mode !== "pool")) {
        out.push({ k: "marker", x: b.t, y: a.p, shape: "x", size: 9, color: "#f8fafc" });
        if (mode !== "pool") {
          // wick that pierces the level and gets rejected
          const span = Math.abs(a.p) * 0.0006 || 0.5;
          const tip = buy ? a.p + span : a.p - span;
          out.push({ k: "line", pts: [[b.t, a.p], [b.t, tip]], stroke: s.stroke, width: s.strokeWidth, arrowEnd: mode === "grab" });
        }
      }
      return out;
    },
  };
}

export const liquidity = liquidityKind("liquidity", "Liquidity", "Resting liquidity pool above highs (BSL) or below lows (SSL)", "pool");
export const liquiditySweep = liquidityKind("liquiditySweep", "Liquidity Sweep", "Price runs a liquidity level and closes back inside", "sweep");
export const liquidityGrab = liquidityKind("liquidityGrab", "Liquidity Grab", "Fast stop run beyond a level followed by immediate rejection", "grab");

/* ------------------------------------------------------ equal highs/lows */

function equalKind(kind: "equalHighs" | "equalLows"): ObjectDef {
  const highs = kind === "equalHighs";
  const tag = highs ? "EQH" : "EQL";
  return {
    ...smcBase,
    kind,
    label: highs ? "Equal Highs" : "Equal Lows",
    description: highs ? "Two (or more) matching swing highs — engineered buy-side liquidity" : "Matching swing lows — engineered sell-side liquidity",
    placement: "drag2",
    anchors: 2,
    icon: kind,
    defaults: () => ({ style: { stroke: GOLD, textColor: GOLD, strokeWidth: 2, dash: "dotted", fontSize: 17 }, props: { showLabel: true, label: tag }, animIn: { preset: "draw", duration: 0.6 } }),
    fields: [...LABEL_FIELDS],
    compile: (o) => {
      const [a, b] = o.points;
      const s = o.style;
      const out: Primitive[] = [
        { k: "line", pts: [[a.t, a.p], [b.t, b.p]], stroke: s.stroke, width: s.strokeWidth, dash: s.dash },
        { k: "marker", x: a.t, y: a.p, shape: "circle", size: 6, color: s.stroke },
        { k: "marker", x: b.t, y: b.p, shape: "circle", size: 6, color: s.stroke },
      ];
      const text = labelText(o, tag);
      if (text) out.push({ k: "text", x: (a.t + b.t) / 2, y: Math.max(a.p, b.p) * (highs ? 1 : 0) + Math.min(a.p, b.p) * (highs ? 0 : 1), text, color: s.textColor, size: s.fontSize, weight: 800, align: "center", baseline: highs ? "bottom" : "top", dy: highs ? -6 : 6 });
      return out;
    },
  };
}

export const equalHighs = equalKind("equalHighs");
export const equalLows = equalKind("equalLows");

export const inducement: ObjectDef = {
  ...smcBase,
  kind: "inducement",
  label: "Inducement",
  description: "Early liquidity (IDM) that lures traders before the real move",
  placement: "drag2",
  anchors: 2,
  icon: "inducement",
  defaults: () => ({ style: { stroke: "#f472b6", textColor: "#f472b6", strokeWidth: 1.8, dash: "dotted", fontSize: 16 }, props: { showLabel: true, label: "IDM" }, animIn: { preset: "draw", duration: 0.5 } }),
  place: levelPlace,
  fields: [...LABEL_FIELDS],
  handles: levelHandles,
  dragHandle: dragLevelHandle,
  compile: (o) => {
    const [a, b] = o.points;
    const s = o.style;
    const out: Primitive[] = [{ k: "line", pts: [[a.t, a.p], [b.t, a.p]], stroke: s.stroke, width: s.strokeWidth, dash: s.dash }];
    const text = labelText(o, "IDM");
    if (text) out.push({ k: "text", x: (a.t + b.t) / 2, y: a.p, text, color: s.textColor, size: s.fontSize, weight: 800, align: "center", baseline: "bottom", dy: -4 });
    return out;
  },
};

/* ------------------------------------------------------------------ OTE */

export const ote: ObjectDef = {
  ...smcBase,
  kind: "ote",
  label: "OTE",
  description: "Optimal trade entry: 62%–79% retracement of a swing (70.5% sweet spot)",
  placement: "drag2",
  anchors: 2,
  icon: "ote",
  defaults: () => ({ style: { stroke: GOLD, fill: GOLD, fillOpacity: 0.18, textColor: GOLD, strokeWidth: 1.2, fontSize: 16 }, props: { extendBars: 8, showLevels: true, showLabel: true, label: "OTE" }, animIn: { preset: "wipe", duration: 0.7 } }),
  fields: [{ key: "extendBars", label: "Extend (bars)", type: "number", min: 0, step: 1 }, { key: "showLevels", label: "Level prices", type: "bool" }, ...LABEL_FIELDS],
  compile: (o, ctx) => {
    const [a, b] = o.points;
    const s = o.style;
    const at = (lv: number) => b.p + (a.p - b.p) * lv;
    const x1 = b.t;
    const x2 = b.t + Number(prop(o, "extendBars", 8));
    const out: Primitive[] = [
      { k: "line", pts: [[a.t, a.p], [b.t, b.p]], stroke: NEUTRAL, width: 1, dash: "dotted" },
      { k: "rect", x1, x2, y1: Math.min(at(0.62), at(0.79)), y2: Math.max(at(0.62), at(0.79)), fill: s.fill, fillAlpha: s.fillOpacity, stroke: s.stroke, width: s.strokeWidth },
      { k: "hline", y: at(0.705), x1, x2, stroke: s.stroke, width: 2, dash: "dashed" },
    ];
    if (prop(o, "showLevels", true)) {
      for (const lv of [0.62, 0.705, 0.79]) out.push({ k: "text", x: x2, y: at(lv), text: `${lv}  ${fmt(ctx, at(lv))}`, color: s.textColor, size: 13, align: "left", baseline: "middle", dx: 6 });
    }
    const text = labelText(o, "OTE");
    if (text) out.push({ k: "text", x: (x1 + x2) / 2, y: at(0.705), text, color: "#0b0e14", size: s.fontSize, weight: 800, align: "center", baseline: "middle", bg: s.stroke, pad: 4 });
    return out;
  },
};

/* ------------------------------------------------- premium / discount */

function pdKind(kind: "premiumDiscount" | "premium" | "discount" | "equilibrium", label: string, description: string): ObjectDef {
  return {
    ...smcBase,
    kind,
    label,
    description,
    placement: "drag2",
    anchors: 2,
    icon: kind,
    defaults: () => ({ style: { strokeWidth: 1.5, fillOpacity: 0.14, fontSize: 17, stroke: NEUTRAL, textColor: "#e2e8f0" }, props: { showLabel: true, extendRight: false }, animIn: { preset: "fade", duration: 0.6 } }),
    fields: [{ key: "showLabel", label: "Labels", type: "bool" }, EXTEND_FIELD],
    handles: boxHandles,
    dragHandle: dragBoxHandle,
    compile: (o) => {
      const b = box(o);
      const s = o.style;
      const mid = (b.y1 + b.y2) / 2;
      const ext = prop(o, "extendRight", false);
      const labels = prop(o, "showLabel", true);
      const out: Primitive[] = [];
      if (kind === "premiumDiscount" || kind === "premium") {
        out.push({ k: "rect", x1: b.x1, x2: b.x2, y1: mid, y2: b.y2, fill: BEAR, fillAlpha: s.fillOpacity, extendRight: ext });
        if (labels) out.push({ k: "text", x: b.x1, y: b.y2, text: "PREMIUM", color: BEAR, size: s.fontSize, weight: 800, align: "left", baseline: "top", dx: 8, dy: 6 });
      }
      if (kind === "premiumDiscount" || kind === "discount") {
        out.push({ k: "rect", x1: b.x1, x2: b.x2, y1: b.y1, y2: mid, fill: BULL, fillAlpha: s.fillOpacity, extendRight: ext });
        if (labels) out.push({ k: "text", x: b.x1, y: b.y1, text: "DISCOUNT", color: BULL, size: s.fontSize, weight: 800, align: "left", baseline: "bottom", dx: 8, dy: -6 });
      }
      if (kind !== "premium" && kind !== "discount") {
        out.push({ k: "hline", y: mid, x1: b.x1, x2: ext ? null : b.x2, stroke: s.stroke, width: s.strokeWidth, dash: "dashed" });
        if (labels) out.push({ k: "text", x: b.x2, y: mid, text: "EQ 50%", color: s.textColor, size: s.fontSize * 0.85, weight: 700, align: "right", baseline: "bottom", dy: -4 });
      }
      return out;
    },
  };
}

export const premiumDiscount = pdKind("premiumDiscount", "Premium / Discount", "Dealing range split at equilibrium: sell premium, buy discount");
export const premium = pdKind("premium", "Premium", "Upper half of a dealing range");
export const discount = pdKind("discount", "Discount", "Lower half of a dealing range");
export const equilibrium = pdKind("equilibrium", "Equilibrium", "50% of a dealing range");

/* ------------------------------------------------- key session levels */

function keyLevel(kind: ObjectKind, label: string, tag: string, description: string, color: string): ObjectDef {
  return {
    ...smcBase,
    kind,
    label,
    description,
    placement: "click1",
    anchors: 1,
    icon: "level",
    defaults: () => ({ style: { stroke: color, textColor: color, strokeWidth: 1.6, dash: "dashed", fontSize: 15 }, props: { label: tag, showPrice: true }, animIn: { preset: "wipe", duration: 0.6 } }),
    fields: [{ key: "label", label: "Tag", type: "text" }, { key: "showPrice", label: "Price", type: "bool" }],
    compile: (o, ctx) => {
      const p = o.points[0];
      const s = o.style;
      const tagText = `${prop(o, "label", tag)}${prop(o, "showPrice", true) ? `  ${fmt(ctx, p.p)}` : ""}`;
      return [
        { k: "hline", y: p.p, x1: p.t, x2: null, stroke: s.stroke, width: s.strokeWidth, dash: s.dash },
        { k: "text", x: p.t, y: p.p, text: tagText, color: "#0b0e14", size: s.fontSize, weight: 800, align: "right", baseline: "middle", bg: s.stroke, pad: 4, pinRight: true },
      ];
    },
  };
}

export const pdh = keyLevel("pdh", "PDH", "PDH", "Previous day high", "#38bdf8");
export const pdl = keyLevel("pdl", "PDL", "PDL", "Previous day low", "#38bdf8");
export const pwh = keyLevel("pwh", "PWH", "PWH", "Previous week high", "#c084fc");
export const pwl = keyLevel("pwl", "PWL", "PWL", "Previous week low", "#c084fc");
export const sessionHigh = keyLevel("sessionHigh", "Session High", "Session H", "Current session high", "#fb923c");
export const sessionLow = keyLevel("sessionLow", "Session Low", "Session L", "Current session low", "#fb923c");

/* --------------------------------------------------------- kill zones */

const SESSION_COLORS: Record<string, string> = {
  asia: "#a855f7",
  london: "#3b82f6",
  nyam: "#f59e0b",
  nypm: "#14b8a6",
  custom: "#64748b",
};
const SESSION_LABELS: Record<string, string> = {
  asia: "Asia",
  london: "London Kill Zone",
  nyam: "NY AM Kill Zone",
  nypm: "NY PM",
  custom: "Kill Zone",
};

export const killZone: ObjectDef = {
  ...smcBase,
  kind: "killZone",
  label: "Kill Zone",
  description: "Time window of a trading session (Asia / London / New York)",
  placement: "drag2",
  anchors: 2,
  icon: "killzone",
  defaults: () => ({ style: { fill: SESSION_COLORS.london, fillOpacity: 0.1, stroke: SESSION_COLORS.london, textColor: "#bfdbfe", fontSize: 16 }, props: { session: "london", showLabel: true, label: "" }, animIn: { preset: "fade", duration: 0.6 } }),
  place: (a, b) => [
    { t: Math.min(a.t, b.t), p: a.p },
    { t: Math.max(a.t, b.t, Math.min(a.t, b.t) + 1), p: a.p },
  ],
  fields: [
    { key: "session", label: "Session", type: "select", options: Object.entries(SESSION_LABELS).map(([value, label]) => ({ value, label })) },
    ...LABEL_FIELDS,
  ],
  handles: (o) => [
    { id: "0", t: o.points[0].t, p: o.points[0].p, cursor: "ew-resize" },
    { id: "1", t: o.points[1].t, p: o.points[0].p, cursor: "ew-resize" },
  ],
  dragHandle: (o, id, pt) => {
    const pts = o.points.map((p) => ({ ...p }));
    pts[Number(id)] = { t: pt.t, p: pts[0].p };
    return pts;
  },
  onPropChange: (o, key) => {
    if (key !== "session") return;
    const c = SESSION_COLORS[String(o.props.session)] ?? SESSION_COLORS.custom;
    return { style: { ...o.style, fill: c, stroke: c } };
  },
  compile: (o) => {
    const [a, b] = o.points;
    const s = o.style;
    const out: Primitive[] = [{ k: "vband", x1: Math.min(a.t, b.t), x2: Math.max(a.t, b.t), fill: s.fill, fillAlpha: s.fillOpacity, stroke: s.stroke }];
    const text = prop(o, "showLabel", true) ? String(prop(o, "label", "")) || SESSION_LABELS[String(prop(o, "session", "london"))] : null;
    if (text) out.push({ k: "text", x: Math.min(a.t, b.t), y: a.p, text, color: s.textColor, size: s.fontSize, weight: 700, align: "left", baseline: "bottom", dx: 6, role: "kz-label" });
    return out;
  },
};

/* --------------------------------------------------------- displacement */

export const displacement: ObjectDef = {
  ...smcBase,
  kind: "displacement",
  label: "Displacement",
  description: "Energetic, imbalanced move — measured from the candles it spans",
  placement: "drag2",
  anchors: 2,
  icon: "displacement",
  defaults: () => ({ style: { stroke: BULL, textColor: BULL, fill: BULL, fillOpacity: 0.08, strokeWidth: 2, glow: 0.6, fontSize: 17 }, props: { direction: "bullish", showLabel: true, label: "Displacement" }, animIn: { preset: "trace", duration: 0.8 } }),
  fields: [DIRECTION_FIELD, ...LABEL_FIELDS],
  onPropChange: recolorOnDirection,
  place: (a, b) => [
    { t: Math.round(Math.min(a.t, b.t)), p: a.p },
    { t: Math.round(Math.max(a.t, b.t)), p: b.p },
  ],
  compile: (o, ctx: CompileCtx) => {
    const s = o.style;
    const [a, b] = o.points;
    const candles = ctx.project.chart.candles;
    const i0 = Math.max(0, Math.round(Math.min(a.t, b.t)));
    const i1 = Math.min(candles.length - 1, Math.round(Math.max(a.t, b.t)));
    let lo = Math.min(a.p, b.p);
    let hi = Math.max(a.p, b.p);
    if (i1 >= i0 && candles.length) {
      lo = Infinity;
      hi = -Infinity;
      for (let i = i0; i <= i1; i++) {
        lo = Math.min(lo, candles[i].l);
        hi = Math.max(hi, candles[i].h);
      }
    }
    const bull = isBullish(o);
    const move = hi - lo;
    const out: Primitive[] = [
      { k: "rect", x1: i0 - 0.5, x2: i1 + 0.5, y1: lo, y2: hi, fill: s.fill, fillAlpha: s.fillOpacity, stroke: s.stroke, width: s.strokeWidth, dash: "dashed" },
      { k: "line", pts: bull ? [[i0 - 0.5, lo], [i1 + 0.5, hi]] : [[i0 - 0.5, hi], [i1 + 0.5, lo]], stroke: s.stroke, width: s.strokeWidth + 1, arrowEnd: true },
    ];
    const text = labelText(o, "Displacement");
    if (text)
      out.push({ k: "text", x: (i0 + i1) / 2, y: bull ? hi : lo, text: `${text}  ${bull ? "+" : "−"}${fmt(ctx, move)}`, color: s.textColor, size: s.fontSize, weight: 800, align: "center", baseline: bull ? "bottom" : "top", dy: bull ? -6 : 6 });
    return out;
  },
};

/* ----------------------------------------------------------------- SMT */

export const smt: ObjectDef = {
  ...smcBase,
  kind: "smt",
  label: "SMT Divergence",
  description: "Smart money technique: correlated pair fails to confirm a new extreme",
  placement: "drag2",
  anchors: 2,
  icon: "smt",
  defaults: () => ({ style: { stroke: PURPLE, textColor: PURPLE, strokeWidth: 2.2, fontSize: 17 }, props: { pair: "ES / NQ", showLabel: true, label: "SMT" }, animIn: { preset: "draw", duration: 0.6 } }),
  fields: [{ key: "pair", label: "Pair", type: "text" }, ...LABEL_FIELDS],
  compile: (o) => {
    const [a, b] = o.points;
    const s = o.style;
    const out: Primitive[] = [
      { k: "line", pts: [[a.t, a.p], [b.t, b.p]], stroke: s.stroke, width: s.strokeWidth },
      { k: "marker", x: a.t, y: a.p, shape: "diamond", size: 7, color: s.stroke },
      { k: "marker", x: b.t, y: b.p, shape: "diamond", size: 7, color: s.stroke },
    ];
    const text = labelText(o, "SMT");
    const pair = String(prop(o, "pair", ""));
    if (text)
      out.push({ k: "text", x: (a.t + b.t) / 2, y: Math.max(a.p, b.p), text: pair ? `${text} · ${pair}` : text, color: s.textColor, size: s.fontSize, weight: 800, align: "center", baseline: "bottom", dy: -6 });
    return out;
  },
};

export const SMC_DEFS: ObjectDef[] = [
  fvg,
  ifvg,
  bos,
  choch,
  mss,
  cisd,
  orderBlock,
  breakerBlock,
  mitigationBlock,
  liquidity,
  liquiditySweep,
  liquidityGrab,
  equalHighs,
  equalLows,
  inducement,
  ote,
  premiumDiscount,
  premium,
  discount,
  equilibrium,
  pdh,
  pdl,
  pwh,
  pwl,
  sessionHigh,
  sessionLow,
  killZone,
  displacement,
  smt,
];
