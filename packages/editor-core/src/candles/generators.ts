import { uid, type Candle } from "@tradeanim/project-schema";

/** Deterministic PRNG (mulberry32) so generated scenes are reproducible. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(r: () => number) {
  const u = Math.max(1e-9, r());
  const v = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export interface GbmOptions {
  count: number;
  start: number;
  /** per-bar volatility as a fraction (0.002 = 0.2%) */
  vol: number;
  /** per-bar drift fraction */
  drift: number;
  seed: number;
}

/** Geometric Brownian motion candles with realistic wicks. */
export function generateGBM(o: GbmOptions): Candle[] {
  const r = rng(o.seed);
  const out: Candle[] = [];
  let price = o.start;
  for (let i = 0; i < o.count; i++) {
    const open = price;
    const ret = o.drift + o.vol * gauss(r);
    const close = open * Math.exp(ret);
    const span = Math.abs(close - open) + open * o.vol * 0.6;
    const high = Math.max(open, close) + span * r() * 0.6;
    const low = Math.min(open, close) - span * r() * 0.6;
    out.push({ id: uid("c_"), o: open, h: high, l: low, c: close });
    price = close;
  }
  return out;
}

/**
 * Candles that follow a polyline of waypoints [barIndex, price]. Noise and
 * wick size are relative to the overall price range, so the same pattern
 * works for EURUSD (1.08) or BTC (65000).
 */
export function fromWaypoints(
  waypoints: [number, number][],
  opts: { seed?: number; noise?: number; wick?: number } = {},
): Candle[] {
  const r = rng(opts.seed ?? 7);
  const wp = [...waypoints].sort((a, b) => a[0] - b[0]);
  const n = Math.round(wp[wp.length - 1][0]) + 1;
  const prices = wp.map((w) => w[1]);
  const range = Math.max(...prices) - Math.min(...prices) || Math.abs(prices[0]) * 0.01 || 1;
  const noise = (opts.noise ?? 0.04) * range;
  const wick = (opts.wick ?? 0.05) * range;
  const at = (x: number) => {
    let i = 0;
    while (i < wp.length - 2 && wp[i + 1][0] < x) i++;
    const [x0, y0] = wp[i];
    const [x1, y1] = wp[i + 1] ?? wp[i];
    const k = x1 === x0 ? 0 : (x - x0) / (x1 - x0);
    return y0 + (y1 - y0) * Math.min(1, Math.max(0, k));
  };
  const out: Candle[] = [];
  let prevClose = at(0);
  for (let i = 0; i < n; i++) {
    const open = prevClose + (r() - 0.5) * noise * 0.2;
    const close = at(i + 0.5) + (r() - 0.5) * noise;
    const high = Math.max(open, close) + r() * wick;
    const low = Math.min(open, close) - r() * wick;
    out.push({ id: uid("c_"), o: open, h: high, l: low, c: close });
    prevClose = close;
  }
  return out;
}

export type PatternId =
  | "uptrend"
  | "downtrend"
  | "range"
  | "vReversal"
  | "doubleTop"
  | "doubleBottom"
  | "bearishSweep"
  | "bullishSweep"
  | "headShoulders";

export const PATTERNS: { id: PatternId; label: string }[] = [
  { id: "uptrend", label: "Uptrend" },
  { id: "downtrend", label: "Downtrend" },
  { id: "range", label: "Range" },
  { id: "vReversal", label: "V-Reversal" },
  { id: "doubleTop", label: "Double Top" },
  { id: "doubleBottom", label: "Double Bottom" },
  { id: "bearishSweep", label: "Bearish Liquidity Sweep" },
  { id: "bullishSweep", label: "Bullish Liquidity Sweep" },
  { id: "headShoulders", label: "Head & Shoulders" },
];

/** Waypoints in a normalised 0..1 price space, scaled to (base, height). */
const SHAPES: Record<PatternId, [number, number][]> = {
  uptrend: [[0, 0.1], [8, 0.35], [12, 0.25], [20, 0.6], [24, 0.5], [34, 0.95]],
  downtrend: [[0, 0.9], [8, 0.65], [12, 0.75], [20, 0.4], [24, 0.5], [34, 0.05]],
  range: [[0, 0.5], [6, 0.85], [12, 0.2], [18, 0.82], [24, 0.18], [30, 0.8], [34, 0.5]],
  vReversal: [[0, 0.9], [14, 0.1], [16, 0.08], [30, 0.85]],
  doubleTop: [[0, 0.2], [10, 0.9], [16, 0.55], [22, 0.9], [34, 0.1]],
  doubleBottom: [[0, 0.8], [10, 0.1], [16, 0.45], [22, 0.1], [34, 0.9]],
  bearishSweep: [[0, 0.35], [8, 0.72], [12, 0.6], [18, 0.74], [21, 0.66], [24, 0.86], [26, 0.7], [29, 0.5], [31, 0.58], [40, 0.08]],
  bullishSweep: [[0, 0.65], [8, 0.28], [12, 0.4], [18, 0.26], [21, 0.34], [24, 0.14], [26, 0.3], [29, 0.5], [31, 0.42], [40, 0.92]],
  headShoulders: [[0, 0.2], [6, 0.6], [10, 0.45], [16, 0.9], [22, 0.45], [26, 0.62], [32, 0.4], [38, 0.1]],
};

export function generatePattern(id: PatternId, base: number, height: number, seed = 11): Candle[] {
  const wp = SHAPES[id].map(([x, y]) => [x, base + y * height] as [number, number]);
  return fromWaypoints(wp, { seed, noise: 0.05, wick: 0.045 });
}

/** A plausible next candle continuing from the last close. */
export function nextCandle(prev: Candle | undefined, bullish: boolean, size?: number): Candle {
  const ref = prev?.c ?? 100;
  const body = size ?? Math.max(Math.abs((prev?.c ?? ref) - (prev?.o ?? ref)), Math.abs(ref) * 0.0015);
  const o = ref;
  const c = bullish ? o + body : o - body;
  return { id: uid("c_"), o, c, h: Math.max(o, c) + body * 0.35, l: Math.min(o, c) - body * 0.35 };
}
