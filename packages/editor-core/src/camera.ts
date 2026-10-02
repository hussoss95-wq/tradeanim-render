import type { CameraKeyframe, CameraState, ChartData, Project } from "@tradeanim/project-schema";
import { ease } from "./easing";
import { revealHead } from "./chart";

export type ObjectCenterResolver = (id: string) => { t: number; p: number } | null;

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
/** zoom-aware interpolation: spans interpolate in log space so zooms feel linear */
const lerpLog = (a: number, b: number, k: number) => Math.exp(lerp(Math.log(Math.max(a, 1e-12)), Math.log(Math.max(b, 1e-12)), k));

export function lerpCamera(a: CameraState, b: CameraState, k: number): CameraState {
  return {
    cx: lerp(a.cx, b.cx, k),
    cy: lerp(a.cy, b.cy, k),
    span: lerpLog(a.span, b.span, k),
    priceSpan: lerpLog(a.priceSpan, b.priceSpan, k),
  };
}

/** Where the newest candle sits horizontally when following price (0..1 of width). */
export const FOLLOW_ANCHOR = 0.72;

function effectiveState(
  kf: CameraKeyframe,
  t: number,
  chart: ChartData,
  resolve?: ObjectCenterResolver,
): CameraState {
  const f = kf.follow;
  if (!f || f.mode === "none") return kf.state;
  if (f.mode === "price") {
    const n = chart.candles.length;
    if (!n) return kf.state;
    const head = revealHead(chart, t);
    const i0 = Math.floor(head);
    const i1 = Math.min(n - 1, i0 + 1);
    const fr = head - i0;
    const price = lerp(chart.candles[i0].c, chart.candles[i1].c, fr);
    return { ...kf.state, cx: head + kf.state.span * (0.5 - FOLLOW_ANCHOR), cy: price };
  }
  const c = resolve?.(f.objectId);
  return c ? { ...kf.state, cx: c.t, cy: c.p } : kf.state;
}

/** Camera at time t. Mirrored in Python (eval_camera). */
export function evalCamera(project: Project, t: number, resolve?: ObjectCenterResolver): CameraState {
  const kfs = project.camera.keyframes;
  if (kfs.length === 0) return project.camera.base;
  const sorted = kfs.length > 1 ? [...kfs].sort((a, b) => a.time - b.time) : kfs;
  if (t <= sorted[0].time) return effectiveState(sorted[0], t, project.chart, resolve);
  const last = sorted[sorted.length - 1];
  if (t >= last.time) return effectiveState(last, t, project.chart, resolve);
  let i = 0;
  while (i < sorted.length - 1 && sorted[i + 1].time < t) i++;
  const a = sorted[i];
  const b = sorted[i + 1];
  const k = ease(b.easing, (t - a.time) / Math.max(1e-6, b.time - a.time));
  return lerpCamera(effectiveState(a, t, project.chart, resolve), effectiveState(b, t, project.chart, resolve), k);
}

export interface PlotRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Viewport extends PlotRect {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  /** px per bar */
  sx: number;
  /** px per price unit */
  sy: number;
}

export function makeViewport(cam: CameraState, plot: PlotRect): Viewport {
  const x0 = cam.cx - cam.span / 2;
  const x1 = cam.cx + cam.span / 2;
  const y0 = cam.cy - cam.priceSpan / 2;
  const y1 = cam.cy + cam.priceSpan / 2;
  return {
    ...plot,
    x0,
    x1,
    y0,
    y1,
    sx: plot.width / Math.max(1e-9, x1 - x0),
    sy: plot.height / Math.max(1e-12, y1 - y0),
  };
}

export function toScreenX(vp: Viewport, t: number): number {
  return vp.left + (t - vp.x0) * vp.sx;
}
export function toScreenY(vp: Viewport, p: number): number {
  return vp.top + (vp.y1 - p) * vp.sy;
}
export function toWorldT(vp: Viewport, x: number): number {
  return vp.x0 + (x - vp.left) / vp.sx;
}
export function toWorldP(vp: Viewport, y: number): number {
  return vp.y1 - (y - vp.top) / vp.sy;
}

/** Zoom a camera around a world anchor point. factor < 1 zooms in. */
export function zoomCamera(
  cam: CameraState,
  factorX: number,
  factorY: number,
  anchor: { t: number; p: number },
): CameraState {
  const span = Math.min(5000, Math.max(3, cam.span * factorX));
  const priceSpan = Math.max(1e-9, cam.priceSpan * factorY);
  const kx = span / cam.span;
  const ky = priceSpan / cam.priceSpan;
  return {
    cx: anchor.t + (cam.cx - anchor.t) * kx,
    cy: anchor.p + (cam.cy - anchor.p) * ky,
    span,
    priceSpan,
  };
}
