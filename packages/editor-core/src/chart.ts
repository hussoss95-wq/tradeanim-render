import type { Candle, CameraState, ChartData } from "@tradeanim/project-schema";
import { ease } from "./easing";

export const TIMEFRAMES: Record<string, number> = {
  "1m": 60,
  "3m": 180,
  "5m": 300,
  "15m": 900,
  "30m": 1800,
  "1h": 3600,
  "2h": 7200,
  "4h": 14400,
  "1D": 86400,
  "1W": 604800,
};

export function timeframeSeconds(tf: string): number {
  return TIMEFRAMES[tf] ?? 900;
}

export function candleTime(chart: ChartData, i: number): number {
  const c = chart.candles[i];
  if (c?.time) return c.time;
  return chart.startTime + Math.round(i) * timeframeSeconds(chart.timeframe);
}

export interface CandleRevealState {
  /** 0..1 opacity */
  a: number;
  /** 0..1 vertical growth from the open */
  g: number;
}

/** Per-candle reveal at time t. Mirrored in Python (candle_reveal). */
export function candleReveal(chart: ChartData, i: number, t: number): CandleRevealState {
  const n = chart.candles.length;
  const local = t - chart.start;
  if (!chart.visible || local < 0 || local > chart.duration) return { a: 0, g: 0 };
  const r = chart.reveal;
  if (r.mode === "none" || r.duration <= 0 || n === 0) return { a: 1, g: 1 };
  const p = local / r.duration;
  if (r.mode === "fade") {
    const k = ease(r.easing, p);
    return { a: k, g: 1 };
  }
  // sequential / cascade / grow: candle i owns a slot of the reveal window
  const slot = 1 / n;
  const overlap = r.mode === "cascade" ? 4 : 1;
  const raw = (p - i * slot) / (slot * overlap);
  const k = ease(r.easing, Math.min(1, Math.max(0, raw)));
  if (r.mode === "grow") return { a: k > 0 ? 1 : 0, g: k };
  return { a: k, g: r.mode === "sequential" ? Math.min(1, 0.35 + k * 0.65) : 1 };
}

/** Index (float) of the newest candle that has started revealing — used by "follow price". */
export function revealHead(chart: ChartData, t: number): number {
  const n = chart.candles.length;
  if (n === 0) return 0;
  const r = chart.reveal;
  const local = t - chart.start;
  if (r.mode === "none" || r.mode === "fade" || r.duration <= 0) return n - 1;
  const p = Math.min(1, Math.max(0, local / r.duration));
  return Math.min(n - 1, p * n);
}

export function priceRange(candles: Candle[], from = 0, to = candles.length - 1) {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = Math.max(0, from); i <= Math.min(candles.length - 1, to); i++) {
    lo = Math.min(lo, candles[i].l);
    hi = Math.max(hi, candles[i].h);
  }
  if (!Number.isFinite(lo)) return { lo: 0, hi: 1 };
  if (hi === lo) return { lo: lo - 1, hi: hi + 1 };
  return { lo, hi };
}

/** Camera that frames candles [from..to] with padding. */
export function fitCandles(
  candles: Candle[],
  from = 0,
  to = candles.length - 1,
  opts: { padBars?: number; rightPad?: number; padPrice?: number } = {},
): CameraState {
  if (candles.length === 0) return { cx: 20, cy: 100, span: 50, priceSpan: 10 };
  const padBars = opts.padBars ?? 2;
  const rightPad = opts.rightPad ?? 6;
  const { lo, hi } = priceRange(candles, from, to);
  const x0 = from - padBars;
  const x1 = to + rightPad;
  const pr = hi - lo;
  const padP = opts.padPrice ?? 0.14;
  return {
    cx: (x0 + x1) / 2,
    cy: (lo + hi) / 2,
    span: Math.max(4, x1 - x0),
    priceSpan: pr * (1 + padP * 2),
  };
}

/** "Nice" tick step for a range (1-2-5 sequence). */
export function niceStep(range: number, targetTicks: number): number {
  const raw = range / Math.max(1, targetTicks);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10;
  return step * mag;
}

export function priceTicks(lo: number, hi: number, target: number): number[] {
  if (!(hi > lo)) return [];
  const step = niceStep(hi - lo, target);
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) out.push(+v.toPrecision(12));
  return out;
}

/** Decimal places appropriate for an instrument's price level / visible range. */
export function priceDecimals(price: number, range?: number): number {
  const ref = range && range > 0 ? range : Math.abs(price) * 0.01;
  if (ref <= 0 || !Number.isFinite(ref)) return 2;
  const d = Math.ceil(-Math.log10(ref)) + 1;
  return Math.min(6, Math.max(0, d));
}

export function formatPrice(v: number, decimals: number): string {
  return v.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatTime(unix: number, tf: string, withDate = false): string {
  const d = new Date(unix * 1000);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  const date = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  if (timeframeSeconds(tf) >= 86400) return date;
  return withDate ? `${date} ${hh}:${mm}` : `${hh}:${mm}`;
}

/** Time-axis ticks: integer bar indices with a readable spacing. */
export function timeTicks(x0: number, x1: number, pxPerBar: number, minPx = 80): number[] {
  const every = Math.max(1, niceStep(minPx / Math.max(pxPerBar, 1e-6), 1));
  const step = Math.max(1, Math.round(every));
  const out: number[] = [];
  for (let i = Math.ceil(x0 / step) * step; i <= x1; i += step) out.push(i);
  return out;
}

export function isBull(c: Candle): boolean {
  return c.c >= c.o;
}

/** Clamp/repair OHLC so high/low contain open/close. */
export function normalizeCandle<T extends Candle>(c: T): T {
  const h = Math.max(c.h, c.o, c.c);
  const l = Math.min(c.l, c.o, c.c);
  return { ...c, h, l };
}
