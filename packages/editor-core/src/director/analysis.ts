/** Lightweight market-structure analysis on candle arrays (used by templates + auto markup). */
import type { Candle } from "@tradeanim/project-schema";

export interface Swing {
  i: number;
  price: number;
  type: "high" | "low";
}

export function swings(candles: Candle[], strength = 2): Swing[] {
  const out: Swing[] = [];
  for (let i = strength; i < candles.length - strength; i++) {
    let hi = true;
    let lo = true;
    for (let k = 1; k <= strength; k++) {
      if (candles[i].h <= candles[i - k].h || candles[i].h < candles[i + k].h) hi = false;
      if (candles[i].l >= candles[i - k].l || candles[i].l > candles[i + k].l) lo = false;
    }
    if (hi) out.push({ i, price: candles[i].h, type: "high" });
    if (lo) out.push({ i, price: candles[i].l, type: "low" });
  }
  return out;
}

export interface Gap {
  i0: number;
  i2: number;
  top: number;
  bottom: number;
  bullish: boolean;
}

export function fairValueGaps(candles: Candle[], from = 0, to = candles.length - 1, minFrac = 0): Gap[] {
  const out: Gap[] = [];
  for (let i = Math.max(2, from + 2); i <= Math.min(to, candles.length - 1); i++) {
    const a = candles[i - 2];
    const c = candles[i];
    if (c.l > a.h && (c.l - a.h) / a.h >= minFrac) out.push({ i0: i - 2, i2: i, bottom: a.h, top: c.l, bullish: true });
    if (c.h < a.l && (a.l - c.h) / a.l >= minFrac) out.push({ i0: i - 2, i2: i, bottom: c.h, top: a.l, bullish: false });
  }
  return out;
}

export function argMax(candles: Candle[], from: number, to: number, key: "h" | "l" | "c" = "h") {
  let best = from;
  for (let i = from; i <= to; i++) if (candles[i][key] > candles[best][key]) best = i;
  return best;
}

export function argMin(candles: Candle[], from: number, to: number, key: "h" | "l" | "c" = "l") {
  let best = from;
  for (let i = from; i <= to; i++) if (candles[i][key] < candles[best][key]) best = i;
  return best;
}
