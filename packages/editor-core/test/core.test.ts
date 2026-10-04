import { describe, expect, it } from "vitest";
import { produce } from "immer";
import { createEmptyProject, migrateProject, validateProject, PROJECT_SCHEMA_VERSION } from "@tradeanim/project-schema";
import {
  ALL_DEFS,
  applyCommand,
  buildSweepScenario,
  buildMinimalExplainerScenario,
  cameraPreset,
  candleReveal,
  compileObject,
  compileRenderPlan,
  createObject,
  ease,
  EASING_NAMES,
  evalAnim,
  evalCamera,
  fairValueGaps,
  generateGBM,
  generatePattern,
  makeCompileCtx,
  parseBrief,
  parseCandles,
  priceDecimals,
} from "../src/index";

const demo = () => buildSweepScenario(parseBrief("bearish liquidity sweep CISD FVG entry 12 seconds")).project;

describe("easing", () => {
  it("every easing maps 0→0 and 1→1", () => {
    for (const name of EASING_NAMES) {
      expect(ease(name, 0)).toBeCloseTo(0, 6);
      expect(ease(name, 1)).toBeCloseTo(1, 6);
    }
  });
  it("supports custom bezier curves", () => {
    expect(ease("bezier:0,0,1,1", 0.3)).toBeCloseTo(0.3, 3);
    expect(ease("bezier:0.42,0,0.58,1", 0.5)).toBeCloseTo(0.5, 3);
  });
});

describe("animation", () => {
  const base = { start: 2, duration: 4, animIn: { preset: "fade" as const, duration: 1, delay: 0, easing: "linear" as const }, animOut: { preset: "fade" as const, duration: 1, delay: 0, easing: "linear" as const } };
  it("is hidden outside the clip", () => {
    expect(evalAnim(base, 1.9).visible).toBe(false);
    expect(evalAnim(base, 6.1).visible).toBe(false);
  });
  it("fades in and out linearly", () => {
    expect(evalAnim(base, 2.5).opacity).toBeCloseTo(0.5, 5);
    expect(evalAnim(base, 4).opacity).toBe(1);
    expect(evalAnim(base, 5.5).opacity).toBeCloseTo(0.5, 5);
  });
  it("draw/wipe/typewriter set progress", () => {
    expect(evalAnim({ ...base, animIn: { ...base.animIn, preset: "draw" } }, 2.25).progress).toBeCloseTo(0.25, 5);
    expect(evalAnim({ ...base, animIn: { ...base.animIn, preset: "typewriter" } }, 2.5).chars).toBeCloseTo(0.5, 5);
  });
});

describe("schema", () => {
  it("migrates a v0 document and fills defaults", () => {
    const p = migrateProject({ name: "old", chart: { candles: [{ id: "a", o: 1, h: 2, l: 0.5, c: 1.5 }] } });
    expect(p.version).toBe(PROJECT_SCHEMA_VERSION);
    expect(p.tracks.length).toBeGreaterThan(5);
    expect(p.chart.reveal.mode).toBeDefined();
  });
  it("rejects newer versions", () => {
    expect(() => migrateProject({ schema: "tradeanim.project", version: 999 })).toThrow();
  });
  it("demo project validates", () => {
    expect(validateProject(demo())).toEqual([]);
  });
});

describe("object registry", () => {
  it("every kind creates and compiles", () => {
    const p = createEmptyProject();
    p.chart.candles = generateGBM({ count: 40, start: 100, vol: 0.01, drift: 0, seed: 3 });
    const ctx = makeCompileCtx(p);
    for (const def of ALL_DEFS) {
      const o = createObject(def.kind, ctx, { a: { t: 5, p: 100 }, b: { t: 15, p: 103 } });
      expect(o.kind).toBe(def.kind);
      const prims = compileObject(o, ctx);
      expect(Array.isArray(prims)).toBe(true);
      if (!["audio", "image", "logo"].includes(def.kind)) expect(prims.length).toBeGreaterThan(0);
    }
  });
  it("covers the SMC/ICT vocabulary", () => {
    const kinds = new Set(ALL_DEFS.map((d) => d.kind));
    for (const k of ["fvg", "ifvg", "bos", "choch", "mss", "cisd", "orderBlock", "breakerBlock", "mitigationBlock", "liquiditySweep", "liquidityGrab", "equalHighs", "equalLows", "inducement", "ote", "premiumDiscount", "pdh", "pwl", "killZone", "displacement", "smt"]) {
      expect(kinds.has(k as never)).toBe(true);
    }
  });
});

describe("commands", () => {
  it("add / translate / delete objects", () => {
    const p = createEmptyProject();
    const o = createObject("zone", makeCompileCtx(p), { a: { t: 1, p: 1 }, b: { t: 3, p: 2 } });
    let next = produce(p, (d) => applyCommand(d, { type: "objects/add", objects: [o] }));
    next = produce(next, (d) => applyCommand(d, { type: "objects/translate", ids: [o.id], dt: 2, dp: 0.5 }));
    expect(next.objects[0].points[0]).toEqual({ t: 3, p: 1.5 });
    next = produce(next, (d) => applyCommand(d, { type: "objects/delete", ids: [o.id] }));
    expect(next.objects).toHaveLength(0);
    expect(p.objects).toHaveLength(0); // immutable
  });
  it("candle updates keep high/low consistent", () => {
    const p = createEmptyProject();
    p.chart.candles = [{ id: "c1", o: 10, h: 11, l: 9, c: 10.5 }];
    const next = produce(p, (d) => applyCommand(d, { type: "candles/update", id: "c1", patch: { c: 12 } }));
    expect(next.chart.candles[0].h).toBe(12);
  });
});

describe("chart + camera", () => {
  it("sequential reveal progresses candle by candle", () => {
    const p = demo();
    const n = p.chart.candles.length;
    expect(candleReveal(p.chart, 0, 0).a).toBe(0);
    expect(candleReveal(p.chart, n - 1, p.chart.reveal.duration + 0.01).a).toBe(1);
  });
  it("camera interpolates between keyframes", () => {
    const p = demo();
    const ks = p.camera.keyframes;
    const mid = (ks[2].time + ks[3].time) / 2;
    const c = evalCamera(p, mid);
    expect(Number.isFinite(c.cx) && Number.isFinite(c.span) && c.span > 0).toBe(true);
  });
  it("camera presets produce keyframes", () => {
    const p = demo();
    for (const id of ["slowZoom", "punchIn", "reveal", "followPrice", "zoomToEntry", "macroToMicro"] as const) {
      expect(cameraPreset(p, id, 1).length).toBeGreaterThan(0);
    }
  });
  it("price decimals suit the instrument", () => {
    expect(priceDecimals(1.085, 0.0006)).toBe(5);
    expect(priceDecimals(64000, 260)).toBe(0);
  });
});

describe("candles", () => {
  it("parses CSV, JSON and pasted rows", () => {
    expect(parseCandles("date,open,high,low,close\n2024-01-01,1,2,0.5,1.5\n2024-01-02,1.5,2.5,1,2")).toHaveLength(2);
    expect(parseCandles('[{"open":1,"high":2,"low":0.5,"close":1.5}]')[0].c).toBe(1.5);
    expect(parseCandles("1 2 0.5 1.5\n1.5 2.5 1 2")[1].o).toBe(1.5);
  });
  it("patterns are deterministic", () => {
    expect(generatePattern("doubleTop", 100, 10, 5)).toEqual(expect.any(Array));
    const a = generatePattern("doubleTop", 100, 10, 5).map((c) => c.c);
    const b = generatePattern("doubleTop", 100, 10, 5).map((c) => c.c);
    expect(a).toEqual(b);
  });
});

describe("director + render plan", () => {
  it("parses a brief", () => {
    const b = parseBrief("Create a 30-second vertical video showing a bearish liquidity sweep, CISD confirmation and FVG entry.");
    expect(b).toMatchObject({ direction: "bearish", aspect: "9:16", duration: 30 });
    expect(b.include.cisd && b.include.fvg).toBe(true);
    expect(b.style).toBe("cinematic");
  });
  it("recognizes the clean explainer style and builds it without chart chrome", () => {
    const brief = parseBrief("Minimal educational video about waiting for candle closes on a clean white background, no grid, 30 seconds");
    expect(brief).toMatchObject({ style: "minimalExplainer", aspect: "9:16", duration: 30 });
    const p = buildMinimalExplainerScenario(brief).project;
    expect(p.settings).toMatchObject({ showGrid: false, showPriceAxis: false, showTimeAxis: false });
    expect(p.theme.background).toBe("#ffffff");
    expect(p.objects.map((o) => o.kind)).toEqual(expect.arrayContaining(["heading", "caption", "circle", "hline", "shortPosition"]));
    expect(validateProject(p)).toEqual([]);
  });
  it("turns an Arabic backtest prompt into a topic-specific complete edit", () => {
    const brief = parseBrief("أنشئ فيديو عمودي 30 ثانية يشرح الباك تيست على 100 صفقة", { style: "minimalExplainer", language: "ar" });
    expect(brief).toMatchObject({ aspect: "9:16", duration: 30, language: "ar" });
    const p = buildMinimalExplainerScenario(brief).project;
    const copy = p.objects.map((o) => String(o.props.text ?? "")).join(" ");
    expect(p.name).toContain("باك تيست");
    expect(copy).toContain("١٠٠ صفقة");
    expect(validateProject(p)).toEqual([]);
  });
  it("understands natural Arabic variants, masculine adjectives and tanween", () => {
    const brief = parseBrief("فيديو عمودي نظيف بالعربية يشرح اختبار الاستراتيجية خلال 6 ثوانٍ");
    expect(brief).toMatchObject({ style: "minimalExplainer", aspect: "9:16", duration: 8, language: "ar", topic: "backtest" });
    expect(buildMinimalExplainerScenario(brief).project.name).toContain("باك تيست");
  });
  it("builds a scene with structure detected from the candles", () => {
    const p = demo();
    const kinds = p.objects.map((o) => o.kind);
    expect(kinds).toEqual(expect.arrayContaining(["liquiditySweep", "cisd", "fvg", "shortPosition", "equalHighs"]));
    expect(fairValueGaps(p.chart.candles).length).toBeGreaterThan(0);
  });
  it("compiles a render plan the Python engine can consume", () => {
    const plan = compileRenderPlan(demo());
    expect(plan.format).toBe("tradeanim.renderplan");
    expect(plan.objects.every((o) => Array.isArray(o.primitives))).toBe(true);
    expect(JSON.parse(JSON.stringify(plan))).toEqual(plan); // plain JSON
  });
});
