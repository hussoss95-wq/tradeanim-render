import {
  PROJECT_SCHEMA_ID,
  PROJECT_SCHEMA_VERSION,
  TRACK_ORDER,
  type AnimSpec,
  type AspectRatio,
  type ChartTheme,
  type EmphasisSpec,
  type ObjectStyle,
  type Project,
  type ProjectSettings,
} from "./types";

let counter = 0;
/** Short collision-resistant id (time + counter + random). */
export function uid(prefix = ""): string {
  counter = (counter + 1) % 1_000_000;
  const rand = Math.floor(Math.random() * 36 ** 5)
    .toString(36)
    .padStart(5, "0");
  return `${prefix}${Date.now().toString(36)}${counter.toString(36)}${rand}`;
}

export const ASPECT_PRESETS: Record<AspectRatio, { width: number; height: number; label: string; hint: string }> = {
  "16:9": { width: 1920, height: 1080, label: "Landscape", hint: "YouTube · Desktop" },
  "9:16": { width: 1080, height: 1920, label: "Vertical", hint: "Shorts · Reels · TikTok" },
  "1:1": { width: 1080, height: 1080, label: "Square", hint: "Feed posts" },
  "4:5": { width: 1080, height: 1350, label: "Portrait", hint: "Instagram feed" },
};

export const RESOLUTION_PRESETS = [
  { label: "720p", short: 720 },
  { label: "1080p", short: 1080 },
  { label: "1440p", short: 1440 },
  { label: "4K", short: 2160 },
];

/** Output size for an aspect ratio at a given short side. Always even. */
export function sizeFor(aspect: AspectRatio, shortSide: number): { width: number; height: number } {
  const base = ASPECT_PRESETS[aspect];
  const k = shortSide / Math.min(base.width, base.height);
  const even = (n: number) => Math.max(2, Math.round((n * k) / 2) * 2);
  return { width: even(base.width), height: even(base.height) };
}

export const DEFAULT_THEME: ChartTheme = {
  background: "#0b0e14",
  grid: "#1a1f2b",
  axisText: "#8b93a7",
  axisLine: "#252b38",
  bull: "#22c55e",
  bear: "#ef4444",
  bullWick: "#22c55e",
  bearWick: "#ef4444",
  bullBorder: "#22c55e",
  bearBorder: "#ef4444",
  crosshair: "#9aa4b8",
  accent: "#f5b942",
};

export const THEME_PRESETS: Record<string, ChartTheme> = {
  Obsidian: DEFAULT_THEME,
  "TV Dark": {
    background: "#131722",
    grid: "#1f2433",
    axisText: "#b2b5be",
    axisLine: "#2a2e39",
    bull: "#26a69a",
    bear: "#ef5350",
    bullWick: "#26a69a",
    bearWick: "#ef5350",
    bullBorder: "#26a69a",
    bearBorder: "#ef5350",
    crosshair: "#9598a1",
    accent: "#2962ff",
  },
  Mono: {
    background: "#0a0a0a",
    grid: "#171717",
    axisText: "#8a8a8a",
    axisLine: "#222222",
    bull: "#f5f5f5",
    bear: "#525252",
    bullWick: "#d4d4d4",
    bearWick: "#737373",
    bullBorder: "#f5f5f5",
    bearBorder: "#525252",
    crosshair: "#a3a3a3",
    accent: "#facc15",
  },
  Paper: {
    background: "#ffffff",
    grid: "#eef0f3",
    axisText: "#5b6170",
    axisLine: "#d9dce3",
    bull: "#0f9d76",
    bear: "#e5484d",
    bullWick: "#0f9d76",
    bearWick: "#e5484d",
    bullBorder: "#0f9d76",
    bearBorder: "#e5484d",
    crosshair: "#5b6170",
    accent: "#2563eb",
  },
};

export function defaultSettings(aspect: AspectRatio = "16:9"): ProjectSettings {
  const { width, height } = ASPECT_PRESETS[aspect];
  return {
    aspect,
    width,
    height,
    fps: 30,
    duration: 12,
    showPriceAxis: true,
    showTimeAxis: true,
    showGrid: true,
  };
}

export function defaultStyle(overrides: Partial<ObjectStyle> = {}): ObjectStyle {
  return {
    stroke: "#e2e8f0",
    strokeWidth: 2,
    dash: "solid",
    fill: "#3b82f6",
    fillOpacity: 0.18,
    opacity: 1,
    glow: 0,
    shadow: 0,
    blur: 0,
    textColor: "#e2e8f0",
    fontSize: 22,
    fontWeight: 600,
    fontFamily: "Inter",
    ...overrides,
  };
}

export function defaultAnimIn(overrides: Partial<AnimSpec> = {}): AnimSpec {
  return { preset: "fade", duration: 0.5, delay: 0, easing: "cubicOut", ...overrides };
}

export function defaultAnimOut(overrides: Partial<AnimSpec> = {}): AnimSpec {
  return { preset: "none", duration: 0.4, delay: 0, easing: "cubicIn", ...overrides };
}

export function defaultEmphasis(): EmphasisSpec {
  return { preset: "none", start: 1, duration: 1, cycles: 2 };
}

export function createEmptyProject(
  opts: { name?: string; aspect?: AspectRatio } = {},
): Project {
  const now = new Date().toISOString();
  return {
    schema: PROJECT_SCHEMA_ID,
    version: PROJECT_SCHEMA_VERSION,
    id: uid("prj_"),
    name: opts.name ?? "Untitled Project",
    createdAt: now,
    updatedAt: now,
    settings: defaultSettings(opts.aspect),
    theme: { ...DEFAULT_THEME },
    chart: {
      symbol: "EURUSD",
      timeframe: "15m",
      startTime: Math.floor(Date.UTC(2026, 0, 5, 7, 0) / 1000),
      candles: [],
      style: { bodyWidth: 0.7, wickWidth: 1.5, borderWidth: 0, hollowBull: false },
      start: 0,
      duration: 12,
      reveal: { mode: "sequential", duration: 3, easing: "cubicOut" },
      visible: true,
      locked: false,
    },
    objects: [],
    camera: {
      base: { cx: 20, cy: 1.085, span: 50, priceSpan: 0.01 },
      keyframes: [],
    },
    tracks: TRACK_ORDER.map((kind) => ({ kind, visible: true, locked: false, collapsed: false })),
    markers: [],
    assets: [],
    meta: { generator: "tradeanim-editor" },
  };
}
