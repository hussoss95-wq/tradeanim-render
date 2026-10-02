/**
 * tradeanim project schema (v1).
 *
 * A project is a plain, versioned JSON document. It is the single contract
 * shared by the web editor, the render API / Python engine and (later) the
 * AI Director, which generates projects or command lists against this schema.
 *
 * Coordinate systems
 * - World space: `t` = bar index (float, 0 = first candle centre), `p` = price.
 *   Chart-attached objects (drawings, SMC/ICT, labels) store world anchors, so
 *   they stay glued to the chart under any camera.
 * - Frame space: x/y in 0..1 of the output frame (0,0 = top-left). Used by
 *   headings, captions, media and screen effects.
 * - Reference pixels: sizes (font size, stroke width, offsets) are expressed in
 *   px for a frame whose short side is 1080px and scaled at render time.
 */

export const PROJECT_SCHEMA_ID = "tradeanim.project" as const;
export const PROJECT_SCHEMA_VERSION = 1;

export type ID = string;

export type AspectRatio = "16:9" | "9:16" | "1:1" | "4:5";

export type TrackKind =
  | "candles"
  | "camera"
  | "drawings"
  | "smc"
  | "text"
  | "media"
  | "audio"
  | "effects";

export const TRACK_ORDER: TrackKind[] = [
  "camera",
  "candles",
  "drawings",
  "smc",
  "text",
  "media",
  "effects",
  "audio",
];

/** Named easings. `bezier:x1,y1,x2,y2` strings are also accepted (custom curves). */
export type EasingName =
  | "linear"
  | "easeIn"
  | "easeOut"
  | "easeInOut"
  | "cubicIn"
  | "cubicOut"
  | "cubicInOut"
  | "expoIn"
  | "expoOut"
  | "expoInOut"
  | "backIn"
  | "backOut"
  | "backInOut"
  | "elasticOut"
  | "bounceOut";

export type Easing = EasingName | `bezier:${string}`;

export type AnimPreset =
  | "none"
  | "fade"
  | "scale"
  | "pop"
  | "slide"
  | "draw"
  | "wipe"
  | "typewriter"
  | "bounce"
  | "pulse"
  | "glow"
  | "flash"
  | "highlight"
  | "trace"
  | "cinematic";

export type Direction = "left" | "right" | "up" | "down";

export interface AnimSpec {
  preset: AnimPreset;
  /** seconds */
  duration: number;
  /** seconds after clip start (in) / before clip end (out) */
  delay: number;
  easing: Easing;
  direction?: Direction;
}

export type EmphasisPreset = "none" | "pulse" | "glow" | "flash" | "highlight";

export interface EmphasisSpec {
  preset: EmphasisPreset;
  /** seconds relative to clip start */
  start: number;
  duration: number;
  cycles: number;
}

export interface WorldPoint {
  t: number;
  p: number;
}

export interface FrameBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type DashStyle = "solid" | "dashed" | "dotted";

export interface ObjectStyle {
  stroke: string;
  strokeWidth: number;
  dash: DashStyle;
  fill: string;
  fillOpacity: number;
  opacity: number;
  /** 0..1 glow strength */
  glow: number;
  glowColor?: string;
  /** 0..1 drop-shadow strength */
  shadow: number;
  /** px (reference) gaussian blur */
  blur: number;
  textColor: string;
  fontSize: number;
  fontWeight: number;
  fontFamily: string;
  /** label background (callouts / tags) */
  labelBg?: string;
}

export type ObjectKind =
  // drawing
  | "trendline"
  | "hline"
  | "ray"
  | "arrow"
  | "path"
  | "rect"
  | "zone"
  | "circle"
  // trading
  | "longPosition"
  | "shortPosition"
  | "riskReward"
  | "fibonacci"
  // smc / ict
  | "fvg"
  | "ifvg"
  | "bos"
  | "choch"
  | "mss"
  | "cisd"
  | "orderBlock"
  | "breakerBlock"
  | "mitigationBlock"
  | "liquidity"
  | "liquiditySweep"
  | "liquidityGrab"
  | "equalHighs"
  | "equalLows"
  | "inducement"
  | "ote"
  | "premiumDiscount"
  | "premium"
  | "discount"
  | "equilibrium"
  | "pdh"
  | "pdl"
  | "pwh"
  | "pwl"
  | "sessionHigh"
  | "sessionLow"
  | "killZone"
  | "displacement"
  | "smt"
  // text
  | "heading"
  | "label"
  | "callout"
  | "caption"
  // media
  | "image"
  | "logo"
  // effects
  | "spotlight"
  | "vignette"
  | "flash"
  | "glowOrb"
  // audio
  | "audio";

export interface SceneObject {
  id: ID;
  kind: ObjectKind;
  name: string;
  track: TrackKind;
  /** seconds */
  start: number;
  /** seconds */
  duration: number;
  visible: boolean;
  locked: boolean;
  /** world anchors (chart-attached objects) */
  points: WorldPoint[];
  /** frame placement (screen-attached objects) */
  frame?: FrameBox;
  style: ObjectStyle;
  /** kind-specific semantic properties, described by the object registry */
  props: Record<string, unknown>;
  animIn: AnimSpec;
  animOut: AnimSpec;
  emphasis: EmphasisSpec;
}

export interface CandleStyle {
  bodyColor?: string;
  wickColor?: string;
  borderColor?: string;
  opacity?: number;
  /** 0..1 */
  glow?: number;
  /** multiplier on global body width */
  widthScale?: number;
}

export interface Candle {
  id: ID;
  o: number;
  h: number;
  l: number;
  c: number;
  v?: number;
  /** unix seconds; falls back to chart.startTime + i * timeframe */
  time?: number;
  style?: CandleStyle;
}

export type RevealMode = "none" | "fade" | "sequential" | "cascade" | "grow";

export interface ChartData {
  symbol: string;
  timeframe: string;
  /** unix seconds of the first candle */
  startTime: number;
  candles: Candle[];
  style: {
    /** 0..1 of bar spacing */
    bodyWidth: number;
    /** reference px */
    wickWidth: number;
    borderWidth: number;
    hollowBull: boolean;
  };
  /** timeline clip for the candle layer */
  start: number;
  duration: number;
  reveal: {
    mode: RevealMode;
    duration: number;
    easing: Easing;
  };
  visible: boolean;
  locked: boolean;
}

export interface CameraState {
  /** centre bar index */
  cx: number;
  /** centre price */
  cy: number;
  /** visible width in bars */
  span: number;
  /** visible price range */
  priceSpan: number;
}

export type CameraFollow =
  | { mode: "none" }
  | { mode: "price" }
  | { mode: "object"; objectId: ID };

export interface CameraKeyframe {
  id: ID;
  time: number;
  state: CameraState;
  /** easing used to arrive at this keyframe */
  easing: Easing;
  follow: CameraFollow;
}

export interface CameraTrack {
  base: CameraState;
  keyframes: CameraKeyframe[];
}

export interface TrackState {
  kind: TrackKind;
  visible: boolean;
  locked: boolean;
  collapsed: boolean;
}

export interface Marker {
  id: ID;
  time: number;
  label: string;
}

export interface Asset {
  id: ID;
  type: "image" | "audio";
  name: string;
  /** data: URL (kept inline so a project is one portable file) */
  src: string;
  width?: number;
  height?: number;
}

export interface ChartTheme {
  background: string;
  grid: string;
  axisText: string;
  axisLine: string;
  bull: string;
  bear: string;
  bullWick: string;
  bearWick: string;
  bullBorder: string;
  bearBorder: string;
  crosshair: string;
  accent: string;
}

export interface ProjectSettings {
  aspect: AspectRatio;
  width: number;
  height: number;
  fps: number;
  /** seconds */
  duration: number;
  showPriceAxis: boolean;
  showTimeAxis: boolean;
  showGrid: boolean;
  watermark?: string;
}

export interface ProjectMeta {
  /** which tool produced this project (editor, director, import...) */
  generator?: string;
  /** natural-language brief (AI Director) */
  prompt?: string;
  storyboard?: { time: number; beat: string }[];
  notes?: string;
}

export interface Project {
  schema: typeof PROJECT_SCHEMA_ID;
  version: number;
  id: ID;
  name: string;
  createdAt: string;
  updatedAt: string;
  settings: ProjectSettings;
  theme: ChartTheme;
  chart: ChartData;
  /** array order = z-order (last drawn on top) */
  objects: SceneObject[];
  camera: CameraTrack;
  tracks: TrackState[];
  markers: Marker[];
  assets: Asset[];
  meta: ProjectMeta;
}
