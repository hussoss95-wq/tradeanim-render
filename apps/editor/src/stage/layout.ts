import { makeViewport, type PlotRect, type Viewport } from "@tradeanim/editor-core";
import type { CameraState, ProjectSettings } from "@tradeanim/project-schema";

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Axis sizes in reference px (short side = 1080). Mirrored in tradeanim/project.py. */
export const AXIS_W = 96;
export const AXIS_H = 44;

export interface StageLayout {
  /** output frame on screen */
  frame: Rect;
  /** chart plot area on screen */
  plot: Rect;
  priceAxis: Rect | null;
  timeAxis: Rect | null;
  /** screen px per reference px */
  scale: number;
  vp: Viewport;
  /** region where world content is drawn */
  clip: Rect;
}

export const STAGE_MARGIN = 18;

/** Fit the output frame in the canvas (camera view). */
export function fitFrame(cw: number, ch: number, s: ProjectSettings, margin = STAGE_MARGIN): Rect {
  const ar = s.width / s.height;
  let w = cw - margin * 2;
  let h = w / ar;
  if (h > ch - margin * 2) {
    h = ch - margin * 2;
    w = h * ar;
  }
  w = Math.max(40, w);
  h = Math.max(40, h);
  return { left: Math.round((cw - w) / 2), top: Math.round((ch - h) / 2), width: Math.round(w), height: Math.round(h) };
}

function plotWithin(frame: Rect, s: ProjectSettings, scale: number): { plot: Rect; priceAxis: Rect | null; timeAxis: Rect | null } {
  const aw = s.showPriceAxis ? AXIS_W * scale : 0;
  const ah = s.showTimeAxis ? AXIS_H * scale : 0;
  const plot = { left: frame.left, top: frame.top, width: frame.width - aw, height: frame.height - ah };
  return {
    plot,
    priceAxis: aw ? { left: plot.left + plot.width, top: frame.top, width: aw, height: plot.height } : null,
    timeAxis: ah ? { left: frame.left, top: plot.top + plot.height, width: plot.width, height: ah } : null,
  };
}

/** Camera view: WYSIWYG frame with the evaluated camera. */
export function cameraLayout(cw: number, ch: number, s: ProjectSettings, cam: CameraState, margin = STAGE_MARGIN): StageLayout {
  const frame = fitFrame(cw, ch, s, margin);
  const scale = Math.min(frame.width, frame.height) / 1080;
  const { plot, priceAxis, timeAxis } = plotWithin(frame, s, scale);
  return { frame, plot, priceAxis, timeAxis, scale, vp: makeViewport(cam, plot as PlotRect), clip: plot };
}

/** Free view: editor camera over the whole canvas; the output frame is drawn as an overlay. */
export function freeLayout(cw: number, ch: number, s: ProjectSettings, free: CameraState, outputCam: CameraState): StageLayout {
  const aw = s.showPriceAxis ? 72 : 0;
  const ah = s.showTimeAxis ? 28 : 0;
  const plot: Rect = { left: 0, top: 0, width: cw - aw, height: ch - ah };
  const vp = makeViewport(free, plot as PlotRect);
  // project the output camera's plot rect, then grow it by the output axes
  const left = plot.left + (outputCam.cx - outputCam.span / 2 - vp.x0) * vp.sx;
  const top = plot.top + (vp.y1 - (outputCam.cy + outputCam.priceSpan / 2)) * vp.sy;
  const pw = outputCam.span * vp.sx;
  const refScale = Math.min(s.width, s.height) / 1080;
  const outPlotW = s.width - (s.showPriceAxis ? AXIS_W * refScale : 0);
  const k = pw / outPlotW;
  const frame = { left, top, width: s.width * k, height: s.height * k };
  const scale = Math.min(frame.width, frame.height) / 1080;
  return {
    frame,
    plot,
    priceAxis: aw ? { left: plot.width, top: 0, width: aw, height: plot.height } : null,
    timeAxis: ah ? { left: 0, top: plot.height, width: plot.width, height: ah } : null,
    scale,
    vp,
    clip: plot,
  };
}

/* ------------------------------------------------------------ colours */

const cache = new Map<string, [number, number, number, number]>();

export function parseColor(c: string): [number, number, number, number] {
  const hit = cache.get(c);
  if (hit) return hit;
  let r = 255;
  let g = 255;
  let b = 255;
  let a = 1;
  const h = c.trim().replace("#", "");
  if (/^[0-9a-f]{3}$/i.test(h)) {
    r = parseInt(h[0] + h[0], 16);
    g = parseInt(h[1] + h[1], 16);
    b = parseInt(h[2] + h[2], 16);
  } else if (/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(h)) {
    r = parseInt(h.slice(0, 2), 16);
    g = parseInt(h.slice(2, 4), 16);
    b = parseInt(h.slice(4, 6), 16);
    if (h.length === 8) a = parseInt(h.slice(6, 8), 16) / 255;
  } else {
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (m) {
      const parts = m[1].split(",").map((x) => parseFloat(x));
      [r, g, b] = parts;
      a = parts[3] ?? 1;
    }
  }
  const out: [number, number, number, number] = [r, g, b, a];
  cache.set(c, out);
  return out;
}

/** rgba() string with alpha multiplied and optional mix toward white. */
export function rgba(c: string, alpha = 1, whiten = 0): string {
  const [r, g, b, a] = parseColor(c);
  const w = Math.min(1, Math.max(0, whiten));
  const mix = (v: number) => Math.round(v + (255 - v) * w);
  return `rgba(${mix(r)},${mix(g)},${mix(b)},${Math.max(0, Math.min(1, a * alpha)).toFixed(3)})`;
}

export function luminance(c: string): number {
  const [r, g, b] = parseColor(c);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}
