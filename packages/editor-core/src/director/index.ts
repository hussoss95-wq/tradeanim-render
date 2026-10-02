/**
 * AI Director — architecture + offline template engine.
 *
 * The Director turns a natural-language brief into a complete project
 * (storyboard, candles, structure, SMC objects, camera, text, timing). The
 * contract is `DirectorEngine.generate(brief) -> DirectorResult`.
 *
 * Today only the deterministic `templateDirector` exists: it parses keywords
 * from the prompt and assembles a liquidity-sweep → CISD → FVG entry scene
 * from real structure detected on generated candles. An LLM-backed engine can
 * implement the same interface later — emitting a project or a list of
 * serializable `EditorCommand`s using the object registry descriptions as its
 * tool documentation — without touching the editor.
 */
import {
  createEmptyProject,
  uid,
  type AspectRatio,
  type CameraKeyframe,
  type Project,
  type SceneObject,
} from "@tradeanim/project-schema";
import { ASPECT_PRESETS } from "@tradeanim/project-schema";
import { fitCandles } from "../chart";
import type { EditorCommand } from "../commands";
import { generatePattern } from "../candles/generators";
import { createObject, makeCompileCtx } from "../objects/registry";
import { argMax, argMin, fairValueGaps } from "./analysis";

export interface DirectorBrief {
  prompt: string;
  direction: "bullish" | "bearish";
  aspect: AspectRatio;
  duration: number;
  symbol: string;
  include: { sweep: boolean; cisd: boolean; fvg: boolean; orderBlock: boolean; position: boolean; captions: boolean };
  seed: number;
}

export interface StoryBeat {
  time: number;
  beat: string;
}

export interface DirectorResult {
  project: Project;
  storyboard: StoryBeat[];
  /** optional command log (LLM engines may return commands instead of a project) */
  commands?: EditorCommand[];
  engine: string;
}

export interface DirectorEngine {
  id: string;
  label: string;
  generate(brief: DirectorBrief): Promise<DirectorResult>;
}

const SYMBOLS: Record<string, { base: number; height: number; tf: string }> = {
  EURUSD: { base: 1.0812, height: 0.0062, tf: "15m" },
  GBPUSD: { base: 1.2705, height: 0.0085, tf: "15m" },
  XAUUSD: { base: 2338, height: 32, tf: "15m" },
  BTCUSD: { base: 64200, height: 2600, tf: "1h" },
  NQ: { base: 18420, height: 260, tf: "5m" },
  ES: { base: 5310, height: 48, tf: "5m" },
  US30: { base: 39100, height: 380, tf: "5m" },
};

export function parseBrief(prompt: string, overrides: Partial<DirectorBrief> = {}): DirectorBrief {
  const p = prompt.toLowerCase();
  const direction = /bull|long|buy/.test(p) && !/bear/.test(p) ? "bullish" : "bearish";
  const aspect: AspectRatio = /vertical|9:16|short|reel|tiktok|portrait/.test(p) ? "9:16" : /square|1:1/.test(p) ? "1:1" : /4:5/.test(p) ? "4:5" : "16:9";
  const dm = p.match(/(\d{1,3})\s*-?\s*(s|sec|secs|second|seconds)\b/);
  const duration = dm ? Math.min(120, Math.max(8, Number(dm[1]))) : 20;
  const sm = prompt.toUpperCase().match(/\b(EURUSD|GBPUSD|XAUUSD|GOLD|BTCUSD|BTC|NQ|ES|US30)\b/);
  const symbol = sm ? ({ GOLD: "XAUUSD", BTC: "BTCUSD" } as Record<string, string>)[sm[1]] ?? sm[1] : "EURUSD";
  const mentionsAny = /fvg|fair value|cisd|order block|\bob\b|entry|sweep/.test(p);
  return {
    prompt,
    direction,
    aspect,
    duration,
    symbol,
    include: {
      sweep: true,
      cisd: !mentionsAny || /cisd|shift|confirm/.test(p),
      fvg: !mentionsAny || /fvg|fair value|imbalance/.test(p),
      orderBlock: /order block|\bob\b/.test(p),
      position: !mentionsAny || /entry|position|trade|short|long|sl|tp/.test(p),
      captions: true,
    },
    seed: 11,
    ...overrides,
  };
}

/** Deterministic liquidity sweep → CISD → FVG entry scene. */
export function buildSweepScenario(brief: DirectorBrief): DirectorResult {
  const bear = brief.direction === "bearish";
  const sym = SYMBOLS[brief.symbol] ?? SYMBOLS.EURUSD;
  const D = brief.duration;
  const project = createEmptyProject({ name: `${bear ? "Bearish" : "Bullish"} Liquidity Sweep — ${brief.symbol}`, aspect: brief.aspect });
  const { width, height } = ASPECT_PRESETS[brief.aspect];
  project.settings = { ...project.settings, width, height, duration: D };
  project.chart.symbol = brief.symbol;
  project.chart.timeframe = sym.tf;
  const candles = generatePattern(bear ? "bearishSweep" : "bullishSweep", sym.base, sym.height, brief.seed);
  project.chart.candles = candles;
  const n = candles.length;
  const revealDur = +(D * 0.62).toFixed(2);
  project.chart.start = 0;
  project.chart.duration = D;
  project.chart.reveal = { mode: "sequential", duration: revealDur, easing: "cubicOut" };
  const tOf = (i: number) => +((revealDur * (i + 1)) / n).toFixed(2);

  const ctx = makeCompileCtx(project);
  const objects: SceneObject[] = [];
  const add = (o: SceneObject) => {
    o.duration = Math.max(0.5, Math.min(o.duration, D - o.start));
    objects.push(o);
    return o;
  };
  const until = (start: number) => D - start;
  const storyboard: StoryBeat[] = [];

  // --- structure detection on the generated data
  const ext = bear ? argMax : argMin;
  const key = bear ? "h" : "l";
  const e1 = ext(candles, 5, 11, key);
  const e2 = ext(candles, 15, 20, key);
  const sweep = ext(candles, 21, 27, key);
  const level = bear ? Math.max(candles[e1].h, candles[e2].h) : Math.min(candles[e1].l, candles[e2].l);
  const sweepPrice = bear ? candles[sweep].h : candles[sweep].l;
  const final = bear ? argMin(candles, sweep, n - 1, "l") : argMax(candles, sweep, n - 1, "h");

  // CISD: open of the last delivery run into the sweep, confirmed by a close through it
  let k0 = sweep;
  const isDelivery = (i: number) => (bear ? candles[i].c > candles[i].o : candles[i].c < candles[i].o);
  while (k0 > 1 && isDelivery(k0 - 1)) k0--;
  const cisdPrice = candles[k0].o;
  let cisdIdx = sweep + 1;
  while (cisdIdx < n - 1 && (bear ? candles[cisdIdx].c >= cisdPrice : candles[cisdIdx].c <= cisdPrice)) cisdIdx++;

  const gaps = fairValueGaps(candles, sweep, Math.min(n - 1, sweep + 10)).filter((g) => g.bullish === !bear);
  const gap = gaps[0] ?? {
    i0: sweep + 1,
    i2: sweep + 3,
    top: bear ? candles[sweep + 1].l : candles[sweep + 3].l,
    bottom: bear ? candles[sweep + 3].h : candles[sweep + 1].h,
    bullish: !bear,
  };
  const ce = (gap.top + gap.bottom) / 2;
  let retrace = gap.i2 + 1;
  while (retrace < n - 2 && (bear ? candles[retrace].h < gap.bottom : candles[retrace].l > gap.top)) retrace++;

  // --- titles
  const title = createObject("heading", ctx, { start: 0.2, props: { text: `${bear ? "Bearish" : "Bullish"} Liquidity Sweep` } });
  title.duration = Math.max(2, tOf(e2) - 0.2);
  add(title);
  storyboard.push({ time: 0.2, beat: "Hook: title card while price builds the range" });

  const sideBuy = bear;
  add(createObject(bear ? "equalHighs" : "equalLows", ctx, { points: [{ t: e1, p: bear ? candles[e1].h : candles[e1].l }, { t: e2, p: bear ? candles[e2].h : candles[e2].l }], start: tOf(e2), duration: until(tOf(e2)) }));
  add(createObject("liquidity", ctx, { points: [{ t: e1, p: level }, { t: sweep + 2, p: level }], start: tOf(e2) + 0.3, duration: tOf(sweep) - tOf(e2) + 0.4, props: { side: sideBuy ? "buy" : "sell" } }));
  storyboard.push({ time: tOf(e2), beat: `Equal ${bear ? "highs" : "lows"} = resting ${bear ? "buy" : "sell"}-side liquidity` });
  if (brief.include.captions)
    add(createObject("caption", ctx, { start: tOf(e2), duration: tOf(sweep) - tOf(e2), props: { text: `Equal ${bear ? "highs" : "lows"}: stops are resting ${bear ? "above" : "below"}.` } }));

  // sweep
  const sweepObj = add(createObject("liquiditySweep", ctx, { points: [{ t: e1, p: level }, { t: sweep, p: level }], start: tOf(sweep), duration: until(tOf(sweep)), props: { side: sideBuy ? "buy" : "sell" } }));
  sweepObj.emphasis = { preset: "glow", start: 0.4, duration: 1.2, cycles: 2 };
  const spot = add(createObject("spotlight", ctx, { a: { t: sweep, p: sweepPrice }, start: tOf(sweep), duration: 2.2 }));
  spot.props.radius = 0.14;
  storyboard.push({ time: tOf(sweep), beat: "The sweep: liquidity is taken, price rejects" });

  if (brief.include.cisd) {
    add(createObject("cisd", ctx, { points: [{ t: k0, p: cisdPrice }, { t: cisdIdx, p: cisdPrice }], start: tOf(cisdIdx), duration: until(tOf(cisdIdx)), props: { direction: bear ? "bearish" : "bullish" } }));
    if (brief.include.captions)
      add(createObject("caption", ctx, { start: tOf(cisdIdx), duration: Math.max(1.5, tOf(retrace) - tOf(cisdIdx)), props: { text: `CISD: a close ${bear ? "below" : "above"} the delivery open confirms the shift.` } }));
    storyboard.push({ time: tOf(cisdIdx), beat: "CISD confirms the change in delivery" });
  }

  if (brief.include.orderBlock) {
    add(createObject("orderBlock", ctx, { points: [{ t: k0 - 0.4, p: candles[k0].h }, { t: sweep + 6, p: candles[k0].l }], start: tOf(cisdIdx) + 0.4, duration: until(tOf(cisdIdx) + 0.4), props: { direction: bear ? "bearish" : "bullish" } }));
  }

  if (brief.include.fvg) {
    add(createObject("fvg", ctx, { points: [{ t: gap.i0 + 0.6, p: gap.top }, { t: retrace + 3, p: gap.bottom }], start: tOf(gap.i2), duration: until(tOf(gap.i2)), props: { direction: bear ? "bearish" : "bullish" } }));
    storyboard.push({ time: tOf(gap.i2), beat: "Displacement leaves a fair value gap" });
  }

  if (brief.include.position) {
    const entry = brief.include.fvg ? ce : cisdPrice;
    const sl = bear ? sweepPrice + (sweepPrice - entry) * 0.12 : sweepPrice - (entry - sweepPrice) * 0.12;
    const tp = bear ? candles[final].l : candles[final].h;
    const kind = bear ? "shortPosition" : "longPosition";
    add(createObject(kind, ctx, { points: [{ t: retrace, p: entry }, { t: n + 2, p: tp }, { t: n + 2, p: sl }], start: tOf(retrace), duration: until(tOf(retrace)) }));
    add(createObject("label", ctx, { a: { t: retrace - 1.5, p: entry }, start: tOf(retrace) + 0.3, duration: until(tOf(retrace) + 0.3), props: { text: "Entry @ CE" } }));
    if (brief.include.captions)
      add(createObject("caption", ctx, { start: tOf(retrace), duration: Math.max(1.5, tOf(final) - tOf(retrace)), props: { text: `Entry at the FVG's 50%, stop beyond the sweep.` } }));
    storyboard.push({ time: tOf(retrace), beat: "Entry on the FVG retrace, stop above the sweep" });
    const tpLabel = createObject("label", ctx, { a: { t: final + 1, p: tp }, start: tOf(final) + 0.2, duration: until(tOf(final) + 0.2), props: { text: "TP HIT" } });
    tpLabel.style.labelBg = bear ? "#22c55e" : "#22c55e";
    tpLabel.emphasis = { preset: "pulse", start: 0.5, duration: 1.5, cycles: 2 };
    add(tpLabel);
    storyboard.push({ time: tOf(final), beat: "Target: opposing liquidity reached" });
  }

  const outro = createObject("heading", ctx, { start: Math.max(tOf(final) + 0.8, D - 3), props: { text: "Sweep → CISD → FVG" } });
  outro.frame = { x: 0.5, y: 0.14, w: 0.8, h: 0.1 };
  add(outro);

  // vignette for the whole piece
  add(createObject("vignette", ctx, { start: 0, duration: D }));

  project.objects = objects;

  // --- camera
  const k = (time: number, state: CameraKeyframe["state"], easing: CameraKeyframe["easing"] = "cubicInOut", follow: CameraKeyframe["follow"] = { mode: "none" }): CameraKeyframe => ({ id: uid("kf_"), time: +time.toFixed(2), state, easing, follow });
  const all = fitCandles(candles);
  const vertical = brief.aspect === "9:16" || brief.aspect === "4:5";
  const followSpan = vertical ? 18 : 30;
  project.camera.base = all;
  project.camera.keyframes = [
    k(0, { ...fitCandles(candles, 0, 10, { rightPad: 4 }) }),
    k(Math.min(1.2, tOf(6)), { ...all, span: followSpan }, "cubicInOut", { mode: "price" }),
    k(tOf(sweep) + 0.25, { ...fitCandles(candles, Math.max(0, sweep - 6), sweep + 2, { rightPad: 3 }), span: vertical ? 12 : 16 }, "expoOut"),
    k(tOf(cisdIdx) + 0.6, fitCandles(candles, e1 - 1, Math.min(n - 1, cisdIdx + 3), { rightPad: 5 }), "cubicInOut"),
    k(tOf(retrace) + 0.4, { ...fitCandles(candles, sweep - 3, n - 1, { rightPad: 6 }) }, "cubicInOut"),
    k(Math.min(D - 0.5, tOf(final) + 1.4), { ...all, span: all.span + 4 }, "cubicInOut"),
  ];
  project.meta = { generator: "director:template", prompt: brief.prompt, storyboard };
  return { project, storyboard, engine: "template" };
}

export const templateDirector: DirectorEngine = {
  id: "template",
  label: "Template Director (offline)",
  async generate(brief) {
    return buildSweepScenario(brief);
  },
};
