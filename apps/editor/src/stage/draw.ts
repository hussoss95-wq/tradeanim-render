/**
 * Canvas 2D stage renderer. Pure function of (project, time, layout, overlay):
 * draws one frame and returns screen-space hit shapes for interaction.
 * Mirrors the Python renderer's layering: grid → bands → candles → world
 * objects → axes → screen effects → frame text/media → flash.
 */
import {
  candleReveal,
  candleTime,
  compileObject,
  evalAnim,
  formatPrice,
  formatTime,
  getDef,
  makeCompileCtx,
  objectHandles,
  priceTicks,
  timeTicks,
  toScreenX,
  toScreenY,
  type AnimState,
  type CompileCtx,
  type Primitive,
  type TextPrim,
} from "@tradeanim/editor-core";
import type { Project, SceneObject } from "@tradeanim/project-schema";
import { rgba, luminance, type Rect, type StageLayout } from "./layout";

export type HitShape =
  | { k: "rect"; x: number; y: number; w: number; h: number }
  | { k: "seg"; x1: number; y1: number; x2: number; y2: number; r: number }
  | { k: "circle"; x: number; y: number; r: number };

export interface ObjectHit {
  id: string;
  shapes: HitShape[];
  bbox: Rect | null;
  frameSpace: boolean;
}

export interface Overlay {
  selection: string[];
  candleSelection: string[];
  hoverId: string | null;
  crosshair: { x: number; y: number } | null;
  guides: { p?: number; t?: number }[];
  marquee: Rect | null;
  ghost: SceneObject | null;
  showHandles: boolean;
  freeView: boolean;
}

export interface DrawInput {
  ctx: CanvasRenderingContext2D;
  cw: number;
  ch: number;
  project: Project;
  t: number;
  layout: StageLayout;
  overlay?: Overlay;
  images: Map<string, HTMLImageElement>;
  /** draw only the output frame (thumbnail / export preview) */
  clean?: boolean;
}

const ACCENT = "#f5b942";
const FONT_STACK = "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif";
const MONO = "'JetBrains Mono', ui-monospace, 'Cascadia Mono', Consolas, monospace";

const FRAME_KINDS = new Set(["heading", "caption", "image", "logo"]);
const SCREEN_FX = new Set(["spotlight", "vignette"]);

function dashFor(d: string | undefined, s: number): number[] {
  if (d === "dashed") return [8 * s, 6 * s];
  if (d === "dotted") return [2 * s, 4 * s];
  return [];
}

/* ------------------------------------------------------------------ main */

export function drawStage(input: DrawInput): ObjectHit[] {
  const { ctx, cw, ch, project, t, layout } = input;
  const { frame, plot, vp, scale } = layout;
  const theme = project.theme;
  const s = project.settings;
  const free = !!input.overlay?.freeView;

  ctx.save();
  // pasteboard
  ctx.fillStyle = "#07090d";
  ctx.fillRect(0, 0, cw, ch);
  ctx.fillStyle = theme.background;
  if (free) ctx.fillRect(0, 0, cw, ch);
  else ctx.fillRect(frame.left, frame.top, frame.width, frame.height);

  const cctx = makeCompileCtx(project);

  // grid
  if (s.showGrid) drawGrid(ctx, project, layout);

  const visibleObjects = project.objects.filter((o) => o.visible && trackVisible(project, o));
  const evaluated = visibleObjects.map((o) => ({ o, st: evalAnim(o, t), prims: compileObject(o, cctx) }));

  const hits: ObjectHit[] = [];

  // world content clipped to plot
  ctx.save();
  clipRect(ctx, layout.clip);
  // bands behind candles
  for (const e of evaluated) {
    if (!e.st.visible || FRAME_KINDS.has(e.o.kind)) continue;
    const bands = e.prims.filter((p) => p.k === "vband");
    if (bands.length) drawObject(ctx, e.o, bands, e.st, layout, cctx, input, null);
  }
  drawCandles(ctx, project, t, layout, input.overlay);
  for (const e of evaluated) {
    if (!e.st.visible || FRAME_KINDS.has(e.o.kind) || SCREEN_FX.has(e.o.kind) || e.o.kind === "flash") continue;
    const prims = e.prims.filter((p) => p.k !== "vband");
    const hit: ObjectHit = { id: e.o.id, shapes: [], bbox: null, frameSpace: false };
    drawObject(ctx, e.o, prims, e.st, layout, cctx, input, hit);
    // band hit shapes too
    for (const b of e.prims) if (b.k === "vband") {
      const x1 = toScreenX(vp, b.x1);
      const x2 = toScreenX(vp, b.x2);
      hit.shapes.push({ k: "rect", x: Math.min(x1, x2), y: plot.top, w: Math.abs(x2 - x1), h: Math.min(40 * scale + 20, plot.height) });
      hit.bbox = unionRect(hit.bbox, { left: Math.min(x1, x2), top: plot.top, width: Math.abs(x2 - x1), height: plot.height });
    }
    hits.push(hit);
  }
  // ghost (placement preview)
  if (input.overlay?.ghost) {
    const g = input.overlay.ghost;
    const prims = compileObject(g, cctx);
    if (!FRAME_KINDS.has(g.kind)) drawObject(ctx, g, prims, { ...evalAnim({ ...g, animIn: { ...g.animIn, preset: "none" }, start: 0, duration: 1e9 }, 1), opacity: 0.8 }, layout, cctx, input, null);
  }
  ctx.restore();

  // axes
  drawAxes(ctx, project, t, layout);

  // screen effects + frame-space objects, clipped to frame
  ctx.save();
  clipRect(ctx, free ? { left: 0, top: 0, width: cw, height: ch } : frame);
  for (const e of evaluated) {
    if (!e.st.visible || !SCREEN_FX.has(e.o.kind)) continue;
    const hit: ObjectHit = { id: e.o.id, shapes: [], bbox: null, frameSpace: false };
    drawObject(ctx, e.o, e.prims, e.st, layout, cctx, input, hit);
    hits.push(hit);
  }
  for (const e of evaluated) {
    if (!e.st.visible || !FRAME_KINDS.has(e.o.kind)) continue;
    const hit: ObjectHit = { id: e.o.id, shapes: [], bbox: null, frameSpace: true };
    drawObject(ctx, e.o, e.prims, e.st, layout, cctx, input, hit);
    hits.push(hit);
  }
  for (const e of evaluated) {
    if (!e.st.visible || e.o.kind !== "flash") continue;
    drawObject(ctx, e.o, e.prims, e.st, layout, cctx, input, null);
  }
  ctx.restore();

  if (s.watermark) {
    ctx.save();
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = theme.axisText;
    ctx.font = `800 ${64 * scale}px ${FONT_STACK}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(s.watermark, plot.left + plot.width / 2, plot.top + plot.height / 2);
    ctx.restore();
  }

  if (free && !input.clean) drawFreeFrame(ctx, cw, ch, frame);
  if (input.overlay && !input.clean) drawOverlay(ctx, project, layout, input.overlay, hits);
  ctx.restore();
  return hits;
}

function trackVisible(p: Project, o: SceneObject) {
  return p.tracks.find((t) => t.kind === o.track)?.visible ?? true;
}

function clipRect(ctx: CanvasRenderingContext2D, r: Rect) {
  ctx.beginPath();
  ctx.rect(r.left, r.top, r.width, r.height);
  ctx.clip();
}

function unionRect(a: Rect | null, b: Rect): Rect {
  if (!a) return { ...b };
  const l = Math.min(a.left, b.left);
  const tp = Math.min(a.top, b.top);
  return { left: l, top: tp, width: Math.max(a.left + a.width, b.left + b.width) - l, height: Math.max(a.top + a.height, b.top + b.height) - tp };
}

/* ------------------------------------------------------------------ grid / axes */

function drawGrid(ctx: CanvasRenderingContext2D, project: Project, layout: StageLayout) {
  const { vp, plot, scale } = layout;
  ctx.save();
  clipRect(ctx, plot);
  ctx.strokeStyle = project.theme.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const p of priceTicks(vp.y0, vp.y1, Math.max(3, plot.height / (70 * Math.max(scale, 0.5))))) {
    const y = Math.round(toScreenY(vp, p)) + 0.5;
    ctx.moveTo(plot.left, y);
    ctx.lineTo(plot.left + plot.width, y);
  }
  for (const i of timeTicks(vp.x0, vp.x1, vp.sx, 110 * Math.max(scale, 0.6))) {
    const x = Math.round(toScreenX(vp, i)) + 0.5;
    ctx.moveTo(x, plot.top);
    ctx.lineTo(x, plot.top + plot.height);
  }
  ctx.stroke();
  ctx.restore();
}

function drawAxes(ctx: CanvasRenderingContext2D, project: Project, t: number, layout: StageLayout) {
  const { vp, plot, priceAxis, timeAxis, scale } = layout;
  const theme = project.theme;
  const dec = makeCompileCtx(project).decimals;
  const fs = Math.max(9, 19 * scale);
  ctx.save();
  ctx.font = `500 ${fs}px ${MONO}`;
  if (priceAxis) {
    ctx.fillStyle = theme.background;
    ctx.fillRect(priceAxis.left, priceAxis.top, priceAxis.width, priceAxis.height);
    ctx.strokeStyle = theme.axisLine;
    ctx.beginPath();
    ctx.moveTo(priceAxis.left + 0.5, priceAxis.top);
    ctx.lineTo(priceAxis.left + 0.5, priceAxis.top + priceAxis.height);
    ctx.stroke();
    ctx.fillStyle = theme.axisText;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    for (const p of priceTicks(vp.y0, vp.y1, Math.max(3, plot.height / (70 * Math.max(scale, 0.5))))) {
      const y = toScreenY(vp, p);
      if (y < plot.top + fs / 2 || y > plot.top + plot.height - fs / 2) continue;
      ctx.fillText(formatPrice(p, dec), priceAxis.left + 8 * scale + 2, y);
    }
    // last price tag (newest revealed candle)
    const last = lastRevealed(project, t);
    if (last !== null) {
      const c = project.chart.candles[last];
      const y = toScreenY(vp, c.c);
      if (y > plot.top && y < plot.top + plot.height) {
        const col = c.c >= c.o ? theme.bull : theme.bear;
        ctx.save();
        ctx.setLineDash([2, 3]);
        ctx.strokeStyle = rgba(col, 0.7);
        ctx.beginPath();
        ctx.moveTo(plot.left, Math.round(y) + 0.5);
        ctx.lineTo(plot.left + plot.width, Math.round(y) + 0.5);
        ctx.stroke();
        ctx.restore();
        tag(ctx, priceAxis.left + 1, y, priceAxis.width - 2, fs, formatPrice(c.c, dec), col, luminance(col) > 0.6 ? "#000" : "#fff");
      }
    }
  }
  if (timeAxis) {
    ctx.fillStyle = theme.background;
    ctx.fillRect(timeAxis.left, timeAxis.top, timeAxis.width + (priceAxis?.width ?? 0), timeAxis.height);
    ctx.strokeStyle = theme.axisLine;
    ctx.beginPath();
    ctx.moveTo(timeAxis.left, timeAxis.top + 0.5);
    ctx.lineTo(timeAxis.left + timeAxis.width + (priceAxis?.width ?? 0), timeAxis.top + 0.5);
    ctx.stroke();
    ctx.fillStyle = theme.axisText;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    let prevDay = -1;
    for (const i of timeTicks(vp.x0, vp.x1, vp.sx, 110 * Math.max(scale, 0.6))) {
      const x = toScreenX(vp, i);
      if (x < plot.left + 20 || x > plot.left + plot.width - 20) continue;
      const unix = candleTime(project.chart, i);
      const day = Math.floor(unix / 86400);
      ctx.fillText(formatTime(unix, project.chart.timeframe, prevDay !== -1 && day !== prevDay), x, timeAxis.top + timeAxis.height / 2);
      prevDay = day;
    }
  }
  ctx.restore();
}

function tag(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, fs: number, text: string, bg: string, fg: string) {
  const h = fs + 8;
  ctx.fillStyle = bg;
  roundRect(ctx, x, y - h / 2, w, h, 3);
  ctx.fill();
  ctx.fillStyle = fg;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x + 6, y + 0.5);
}

function lastRevealed(project: Project, t: number): number | null {
  const n = project.chart.candles.length;
  for (let i = n - 1; i >= 0; i--) if (candleReveal(project.chart, i, t).a > 0.5) return i;
  return null;
}

/* ------------------------------------------------------------------ candles */

function drawCandles(ctx: CanvasRenderingContext2D, project: Project, t: number, layout: StageLayout, overlay?: Overlay) {
  const { vp, scale } = layout;
  const chart = project.chart;
  const theme = project.theme;
  const n = chart.candles.length;
  if (!n || !chart.visible || !(project.tracks.find((x) => x.kind === "candles")?.visible ?? true)) return;
  const i0 = Math.max(0, Math.floor(vp.x0) - 1);
  const i1 = Math.min(n - 1, Math.ceil(vp.x1) + 1);
  const selected = new Set(overlay?.candleSelection ?? []);
  const wickW = Math.max(1, chart.style.wickWidth * scale);
  for (let i = i0; i <= i1; i++) {
    const c = chart.candles[i];
    const rev = candleReveal(chart, i, t);
    if (rev.a <= 0.001) continue;
    const bull = c.c >= c.o;
    const st = c.style ?? {};
    const body = st.bodyColor ?? (bull ? theme.bull : theme.bear);
    const wick = st.wickColor ?? (bull ? theme.bullWick : theme.bearWick);
    const border = st.borderColor ?? (bull ? theme.bullBorder : theme.bearBorder);
    const g = rev.g;
    const o = c.o;
    const cl = o + (c.c - o) * g;
    const h = o + (c.h - o) * g;
    const l = o + (c.l - o) * g;
    const x = toScreenX(vp, i);
    const bw = Math.max(1, vp.sx * chart.style.bodyWidth * (st.widthScale ?? 1));
    const yTop = toScreenY(vp, Math.max(o, cl));
    const yBot = toScreenY(vp, Math.min(o, cl));
    const alpha = rev.a * (st.opacity ?? 1);
    ctx.save();
    ctx.globalAlpha = alpha;
    if (st.glow) {
      ctx.shadowColor = body;
      ctx.shadowBlur = 28 * st.glow * Math.max(scale, 0.4);
    }
    ctx.strokeStyle = wick;
    ctx.lineWidth = wickW;
    ctx.beginPath();
    const xs = Math.round(x) + (Math.round(wickW) % 2 ? 0.5 : 0);
    ctx.moveTo(xs, toScreenY(vp, h));
    ctx.lineTo(xs, toScreenY(vp, l));
    ctx.stroke();
    const bh = Math.max(1, yBot - yTop);
    if (chart.style.hollowBull && bull) {
      ctx.fillStyle = theme.background;
      ctx.fillRect(x - bw / 2, yTop, bw, bh);
      ctx.strokeStyle = body;
      ctx.lineWidth = Math.max(1, scale * 2);
      ctx.strokeRect(x - bw / 2, yTop, bw, bh);
    } else {
      ctx.fillStyle = body;
      ctx.fillRect(x - bw / 2, yTop, bw, bh);
      if (chart.style.borderWidth > 0) {
        ctx.strokeStyle = border;
        ctx.lineWidth = chart.style.borderWidth * scale;
        ctx.strokeRect(x - bw / 2, yTop, bw, bh);
      }
    }
    ctx.restore();
    if (selected.has(c.id) && overlay?.showHandles) {
      const top = toScreenY(vp, c.h);
      const bot = toScreenY(vp, c.l);
      ctx.save();
      ctx.strokeStyle = ACCENT;
      ctx.setLineDash([3, 3]);
      ctx.strokeRect(x - bw / 2 - 4, top - 4, bw + 8, bot - top + 8);
      ctx.setLineDash([]);
      for (const [lbl, v] of [["H", c.h], ["O", c.o], ["C", c.c], ["L", c.l]] as const) {
        const y = toScreenY(vp, v);
        const hx = lbl === "O" ? x - bw / 2 - 12 : lbl === "C" ? x + bw / 2 + 12 : x;
        handle(ctx, hx, y);
        ctx.fillStyle = "#cbd5e1";
        ctx.font = `600 10px ${MONO}`;
        ctx.textAlign = lbl === "O" ? "right" : "left";
        ctx.textBaseline = "middle";
        ctx.fillText(lbl, lbl === "O" ? hx - 8 : hx + 8, y);
      }
      ctx.restore();
    }
  }
}

/* ------------------------------------------------------------------ objects */

interface Env {
  layout: StageLayout;
  st: AnimState;
  o: SceneObject;
  images: Map<string, HTMLImageElement>;
  hit: ObjectHit | null;
}

function X(env: Env, p: { space?: string }, v: number) {
  const L = env.layout;
  return p.space === "frame" ? L.frame.left + v * L.frame.width : toScreenX(L.vp, v);
}
function Y(env: Env, p: { space?: string }, v: number) {
  const L = env.layout;
  return p.space === "frame" ? L.frame.top + v * L.frame.height : toScreenY(L.vp, v);
}

/** rough screen bbox of a primitive list (for wipe clip, scale origin, selection) */
function primsScreenBox(ctx: CanvasRenderingContext2D, prims: Primitive[], env: Env): Rect | null {
  let r: Rect | null = null;
  const L = env.layout;
  const add = (x1: number, y1: number, x2: number, y2: number) => {
    r = unionRect(r, { left: Math.min(x1, x2), top: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) });
  };
  const right = L.plot.left + L.plot.width;
  for (const p of prims) {
    switch (p.k) {
      case "rect":
        add(X(env, p, p.x1), Y(env, p, p.y1), p.extendRight ? right : X(env, p, p.x2), Y(env, p, p.y2));
        break;
      case "line": {
        p.pts.forEach(([x, y]) => add(X(env, p, x), Y(env, p, y), X(env, p, x), Y(env, p, y)));
        if (p.extendRight && p.pts.length) add(right, Y(env, p, p.pts[p.pts.length - 1][1]), right, Y(env, p, p.pts[p.pts.length - 1][1]));
        break;
      }
      case "hline":
        add(p.x1 === null ? L.plot.left : toScreenX(L.vp, p.x1), toScreenY(L.vp, p.y) - 3, p.x2 === null ? right : toScreenX(L.vp, p.x2), toScreenY(L.vp, p.y) + 3);
        break;
      case "ellipse":
        add(toScreenX(L.vp, p.cx - p.rx), toScreenY(L.vp, p.cy - p.ry), toScreenX(L.vp, p.cx + p.rx), toScreenY(L.vp, p.cy + p.ry));
        break;
      case "text": {
        const b = textBox(ctx, p, env);
        add(b.left, b.top, b.left + b.width, b.top + b.height);
        break;
      }
      case "marker":
        add(toScreenX(L.vp, p.x) - p.size, toScreenY(L.vp, p.y) - p.size, toScreenX(L.vp, p.x) + p.size, toScreenY(L.vp, p.y) + p.size);
        break;
      case "image":
        add(L.frame.left + p.x * L.frame.width, L.frame.top + p.y * L.frame.height, L.frame.left + (p.x + p.w) * L.frame.width, L.frame.top + (p.y + p.h) * L.frame.height);
        break;
      case "spotlight":
      case "glowOrb": {
        const R = p.r * Math.min(L.frame.width, L.frame.height);
        const cx = toScreenX(L.vp, p.x);
        const cy = toScreenY(L.vp, p.y);
        add(cx - R, cy - R, cx + R, cy + R);
        break;
      }
    }
  }
  return r;
}

function drawObject(
  ctx: CanvasRenderingContext2D,
  o: SceneObject,
  prims: Primitive[],
  st: AnimState,
  layout: StageLayout,
  _cctx: CompileCtx,
  input: DrawInput,
  hit: ObjectHit | null,
) {
  const env: Env = { layout, st, o, images: input.images, hit };
  const box = primsScreenBox(ctx, prims, env);
  if (hit) hit.bbox = box ? unionRect(hit.bbox, box) : hit.bbox;
  ctx.save();
  const F = layout.frame;
  if (st.dx || st.dy) ctx.translate(st.dx * F.width, st.dy * F.height);
  if (st.scale !== 1 && box) {
    const cx = box.left + box.width / 2;
    const cy = box.top + box.height / 2;
    ctx.translate(cx, cy);
    ctx.scale(Math.max(0.001, st.scale), Math.max(0.001, st.scale));
    ctx.translate(-cx, -cy);
  }
  ctx.globalAlpha = Math.max(0, Math.min(1, o.style.opacity * st.opacity));
  const blur = (o.style.blur + st.blur) * layout.scale;
  if (blur > 0.3) ctx.filter = `blur(${blur.toFixed(1)}px)`;
  const glow = o.style.glow + st.glow;
  if (glow > 0.01) {
    ctx.shadowColor = o.style.glowColor || o.style.stroke;
    ctx.shadowBlur = 26 * glow * Math.max(0.5, layout.scale);
  } else if (o.style.shadow > 0.01) {
    ctx.shadowColor = `rgba(0,0,0,${0.75 * o.style.shadow})`;
    ctx.shadowBlur = 18 * o.style.shadow * layout.scale;
    ctx.shadowOffsetY = 4 * layout.scale;
  }
  if (st.reveal === "wipe" && st.progress < 1 && box) {
    ctx.beginPath();
    ctx.rect(box.left - 2, box.top - 400, (box.width + 4) * Math.max(0, st.progress), box.height + 800);
    ctx.clip();
  }
  for (const p of prims) drawPrim(ctx, p, env);
  if (st.traceHead && box) {
    const last = lastPoint(prims, env, st.progress);
    if (last) {
      ctx.shadowColor = o.style.stroke;
      ctx.shadowBlur = 20 * layout.scale;
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(last[0], last[1], Math.max(2.5, 5 * layout.scale), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

function lastPoint(prims: Primitive[], env: Env, progress: number): [number, number] | null {
  for (const p of prims) {
    if (p.k !== "line" || p.pts.length < 2) continue;
    const pts = p.pts.map(([x, y]) => [X(env, p, x), Y(env, p, y)] as [number, number]);
    return pointAlong(pts, progress);
  }
  return null;
}

function pointAlong(pts: [number, number][], k: number): [number, number] {
  const lens: number[] = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    lens.push(l);
    total += l;
  }
  let want = total * Math.max(0, Math.min(1, k));
  for (let i = 1; i < pts.length; i++) {
    if (want <= lens[i - 1]) {
      const f = lens[i - 1] ? want / lens[i - 1] : 0;
      return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f];
    }
    want -= lens[i - 1];
  }
  return pts[pts.length - 1];
}

function partialPath(pts: [number, number][], k: number): [number, number][] {
  if (k >= 1) return pts;
  const lens: number[] = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    lens.push(l);
    total += l;
  }
  let want = total * Math.max(0, k);
  const out: [number, number][] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    if (want >= lens[i - 1]) {
      out.push(pts[i]);
      want -= lens[i - 1];
    } else {
      const f = lens[i - 1] ? want / lens[i - 1] : 0;
      out.push([pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f]);
      break;
    }
  }
  return out;
}

function arrowHead(ctx: CanvasRenderingContext2D, from: [number, number], to: [number, number], size: number, color: string) {
  const a = Math.atan2(to[1] - from[1], to[0] - from[0]);
  ctx.save();
  ctx.setLineDash([]);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(to[0], to[1]);
  ctx.lineTo(to[0] - size * Math.cos(a - 0.45), to[1] - size * Math.sin(a - 0.45));
  ctx.lineTo(to[0] - size * Math.cos(a + 0.45), to[1] - size * Math.sin(a + 0.45));
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function textLines(ctx: CanvasRenderingContext2D, text: string, maxW: number | null): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    if (!maxW) {
      out.push(para);
      continue;
    }
    const words = para.split(" ");
    let line = "";
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (ctx.measureText(test).width > maxW && line) {
        out.push(line);
        line = w;
      } else line = test;
    }
    out.push(line);
  }
  return out;
}

function fontFor(p: TextPrim, scale: number) {
  const fam = p.family && p.family !== "Inter" ? `'${p.family}', ${FONT_STACK}` : FONT_STACK;
  return `${p.weight ?? 600} ${Math.max(1, p.size * scale)}px ${fam}`;
}

function textBox(ctx: CanvasRenderingContext2D, p: TextPrim, env: Env): Rect {
  const L = env.layout;
  const s = L.scale;
  ctx.save();
  ctx.font = fontFor(p, s);
  const maxW = p.maxWidth ? p.maxWidth * L.frame.width : null;
  const lines = textLines(ctx, p.text, maxW);
  const lh = p.size * s * 1.18;
  const w = Math.max(...lines.map((l) => ctx.measureText(l).width), 1);
  ctx.restore();
  const h = lh * lines.length;
  const pad = (p.bg ? p.pad ?? 4 : 0) * s;
  let x = X(env, p, p.x) + (p.dx ?? 0) * s;
  let y = Y(env, p, p.y) + (p.dy ?? 0) * s;
  if (p.pinRight) x = L.plot.left + L.plot.width - 2;
  const align = p.align ?? "left";
  const left = align === "center" ? x - w / 2 : align === "right" ? x - w : x;
  const base = p.baseline ?? "middle";
  const top = base === "top" ? y + pad : base === "bottom" ? y - h - pad : y - h / 2;
  return { left: left - pad, top: top - pad, width: w + pad * 2, height: h + pad * 2 };
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function drawPrim(ctx: CanvasRenderingContext2D, p: Primitive, env: Env) {
  const L = env.layout;
  const s = L.scale;
  const st = env.st;
  const draw = st.reveal === "draw" ? st.progress : 1;
  const flash = st.flash;
  const right = L.plot.left + L.plot.width;
  const pa = p.alpha ?? 1;
  const hit = env.hit;
  ctx.setLineDash([]);
  switch (p.k) {
    case "rect": {
      const x1 = X(env, p, p.x1);
      const x2 = p.extendRight ? right : X(env, p, p.x2);
      const y1 = Y(env, p, p.y1);
      const y2 = Y(env, p, p.y2);
      const l = Math.min(x1, x2);
      const t = Math.min(y1, y2);
      const w = Math.abs(x2 - x1);
      const h = Math.abs(y2 - y1);
      if (p.fill && (p.fillAlpha ?? 1) > 0) {
        ctx.fillStyle = rgba(p.fill, (p.fillAlpha ?? 1) * pa * draw, flash);
        ctx.fillRect(l, t, w, h);
      }
      if (p.stroke && (p.width ?? 1) > 0) {
        ctx.strokeStyle = rgba(p.stroke, pa, flash);
        ctx.lineWidth = Math.max(1, (p.width ?? 1) * s);
        ctx.setLineDash(dashFor(p.dash, s));
        if (draw < 1) {
          const pts: [number, number][] = [[l, t], [l + w, t], [l + w, t + h], [l, t + h], [l, t]];
          strokePath(ctx, partialPath(pts, draw));
        } else ctx.strokeRect(l, t, w, h);
      }
      hit?.shapes.push({ k: "rect", x: l, y: t, w, h });
      return;
    }
    case "line": {
      let pts = p.pts.map(([x, y]) => [X(env, p, x), Y(env, p, y)] as [number, number]);
      if (p.extendRight && pts.length >= 2) {
        const [a, b] = [pts[pts.length - 2], pts[pts.length - 1]];
        const dx = b[0] - a[0];
        if (dx > 0.001) pts = [...pts, [right + 50, b[1] + ((right + 50 - b[0]) * (b[1] - a[1])) / dx]];
      }
      const part = partialPath(pts, draw);
      ctx.strokeStyle = rgba(p.stroke, pa, flash);
      ctx.lineWidth = Math.max(1, p.width * s);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.setLineDash(dashFor(p.dash, s));
      if (p.closed && p.fill) {
        ctx.fillStyle = rgba(p.fill, (p.fillAlpha ?? 0.2) * pa);
        ctx.beginPath();
        pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.closePath();
        ctx.fill();
      }
      strokePath(ctx, part);
      if (p.arrowEnd && part.length >= 2) arrowHead(ctx, part[part.length - 2], part[part.length - 1], (10 + p.width * 2.2) * s, rgba(p.stroke, pa, flash));
      if (p.arrowStart && pts.length >= 2 && draw >= 1) arrowHead(ctx, pts[1], pts[0], (10 + p.width * 2.2) * s, rgba(p.stroke, pa, flash));
      for (let i = 1; i < pts.length; i++) hit?.shapes.push({ k: "seg", x1: pts[i - 1][0], y1: pts[i - 1][1], x2: pts[i][0], y2: pts[i][1], r: 6 });
      return;
    }
    case "hline": {
      const y = Math.round(toScreenY(L.vp, p.y)) + 0.5;
      const x1 = p.x1 === null ? L.plot.left : toScreenX(L.vp, p.x1);
      const x2 = p.x2 === null ? right : toScreenX(L.vp, p.x2);
      ctx.strokeStyle = rgba(p.stroke, pa, flash);
      ctx.lineWidth = Math.max(1, p.width * s);
      ctx.setLineDash(dashFor(p.dash, s));
      strokePath(ctx, [[x1, y], [x1 + (x2 - x1) * draw, y]]);
      hit?.shapes.push({ k: "seg", x1, y1: y, x2, y2: y, r: 6 });
      return;
    }
    case "vband": {
      const x1 = toScreenX(L.vp, p.x1);
      const x2 = toScreenX(L.vp, p.x2);
      ctx.fillStyle = rgba(p.fill, p.fillAlpha * pa * draw, flash);
      ctx.fillRect(Math.min(x1, x2), L.plot.top, Math.abs(x2 - x1), L.plot.height);
      if (p.stroke) {
        ctx.strokeStyle = rgba(p.stroke, 0.45 * pa);
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        strokePath(ctx, [[x1, L.plot.top], [x1, L.plot.top + L.plot.height]]);
        strokePath(ctx, [[x2, L.plot.top], [x2, L.plot.top + L.plot.height]]);
      }
      return;
    }
    case "ellipse": {
      const cx = toScreenX(L.vp, p.cx);
      const cy = toScreenY(L.vp, p.cy);
      const rx = Math.abs(p.rx * L.vp.sx);
      const ry = Math.abs(p.ry * L.vp.sy);
      ctx.beginPath();
      ctx.ellipse(cx, cy, Math.max(1, rx), Math.max(1, ry), 0, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * draw);
      if (p.fill && (p.fillAlpha ?? 0) > 0) {
        ctx.fillStyle = rgba(p.fill, (p.fillAlpha ?? 0) * pa * draw);
        ctx.fill();
      }
      if (p.stroke) {
        ctx.strokeStyle = rgba(p.stroke, pa, flash);
        ctx.lineWidth = Math.max(1, (p.width ?? 2) * s);
        ctx.setLineDash(dashFor(p.dash, s));
        ctx.stroke();
      }
      hit?.shapes.push({ k: "rect", x: cx - rx, y: cy - ry, w: rx * 2, h: ry * 2 });
      return;
    }
    case "marker": {
      if (draw < 0.85) return;
      const x = toScreenX(L.vp, p.x);
      const y = toScreenY(L.vp, p.y);
      const r = Math.max(2, p.size * s * 1.2);
      ctx.fillStyle = rgba(p.color, pa, flash);
      ctx.strokeStyle = rgba(p.color, pa, flash);
      ctx.lineWidth = Math.max(1.5, 2.5 * s);
      ctx.beginPath();
      switch (p.shape) {
        case "circle":
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fill();
          break;
        case "x":
          ctx.moveTo(x - r, y - r);
          ctx.lineTo(x + r, y + r);
          ctx.moveTo(x + r, y - r);
          ctx.lineTo(x - r, y + r);
          ctx.stroke();
          break;
        case "diamond":
          ctx.moveTo(x, y - r);
          ctx.lineTo(x + r, y);
          ctx.lineTo(x, y + r);
          ctx.lineTo(x - r, y);
          ctx.closePath();
          ctx.fill();
          break;
        case "triangleUp":
          ctx.moveTo(x, y - r);
          ctx.lineTo(x + r, y + r);
          ctx.lineTo(x - r, y + r);
          ctx.closePath();
          ctx.fill();
          break;
        case "triangleDown":
          ctx.moveTo(x, y + r);
          ctx.lineTo(x + r, y - r);
          ctx.lineTo(x - r, y - r);
          ctx.closePath();
          ctx.fill();
          break;
      }
      hit?.shapes.push({ k: "circle", x, y, r: r + 4 });
      return;
    }
    case "text": {
      if (st.reveal === "draw" && draw < 0.7) return;
      const chars = Math.max(0, Math.min(1, st.chars));
      const full = p.text;
      const text = chars < 1 ? full.slice(0, Math.ceil(full.length * chars)) : full;
      const box = textBox(ctx, p, env);
      hit?.shapes.push({ k: "rect", x: box.left, y: box.top, w: box.width, h: box.height });
      if (!text) return;
      ctx.save();
      if (p.bg) {
        ctx.save();
        ctx.shadowColor = "transparent";
        ctx.fillStyle = rgba(p.bg, (p.bgAlpha ?? 1) * pa, flash);
        // background reveals with typewriter progress
        roundRect(ctx, box.left, box.top, box.width, box.height, 5 * s);
        ctx.fill();
        ctx.restore();
      }
      ctx.font = fontFor(p, s);
      ctx.fillStyle = rgba(p.color, pa, flash);
      ctx.textBaseline = "top";
      const pad = (p.bg ? p.pad ?? 4 : 0) * s;
      const maxW = p.maxWidth ? p.maxWidth * L.frame.width : null;
      const fullLines = textLines(ctx, full, maxW);
      const lh = p.size * s * 1.18;
      let remaining = text.length;
      const align = p.align ?? "left";
      ctx.textAlign = align;
      const ax = align === "center" ? box.left + box.width / 2 : align === "right" ? box.left + box.width - pad : box.left + pad;
      fullLines.forEach((line, i) => {
        if (remaining <= 0) return;
        const shown = line.slice(0, remaining);
        remaining -= line.length + 1;
        // keep centred lines stable while typing: draw clipped full-width position
        if (align === "center" && shown.length < line.length) {
          const full = ctx.measureText(line).width;
          ctx.textAlign = "left";
          ctx.fillText(shown, ax - full / 2, box.top + pad + i * lh + lh * 0.08);
          ctx.textAlign = align;
        } else ctx.fillText(shown, ax, box.top + pad + i * lh + lh * 0.08);
      });
      ctx.restore();
      return;
    }
    case "image": {
      const img = env.images.get(p.assetId);
      const x = L.frame.left + p.x * L.frame.width;
      const y = L.frame.top + p.y * L.frame.height;
      const w = p.w * L.frame.width;
      const h = p.h * L.frame.height;
      hit?.shapes.push({ k: "rect", x, y, w, h });
      if (img && img.complete && img.naturalWidth) {
        // contain
        const k = Math.min(w / img.naturalWidth, h / img.naturalHeight);
        const iw = img.naturalWidth * k;
        const ih = img.naturalHeight * k;
        ctx.drawImage(img, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih);
      } else {
        ctx.strokeStyle = "rgba(148,163,184,0.6)";
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(x, y, w, h);
      }
      return;
    }
    case "spotlight": {
      const F = L.frame;
      const cx = toScreenX(L.vp, p.x);
      const cy = toScreenY(L.vp, p.y);
      const R = p.r * Math.min(F.width, F.height);
      const g = ctx.createRadialGradient(cx, cy, R * 0.75, cx, cy, R * 1.25);
      g.addColorStop(0, "rgba(0,0,0,0)");
      g.addColorStop(1, `rgba(0,0,0,${p.dim})`);
      ctx.fillStyle = g;
      ctx.fillRect(F.left, F.top, F.width, F.height);
      hit?.shapes.push({ k: "circle", x: cx, y: cy, r: 14 });
      return;
    }
    case "vignette": {
      const F = L.frame;
      const cx = F.left + F.width / 2;
      const cy = F.top + F.height / 2;
      const d = Math.hypot(F.width, F.height) / 2;
      const g = ctx.createRadialGradient(cx, cy, d * 0.45, cx, cy, d);
      g.addColorStop(0, "rgba(0,0,0,0)");
      g.addColorStop(1, `rgba(0,0,0,${p.strength})`);
      ctx.fillStyle = g;
      ctx.fillRect(F.left, F.top, F.width, F.height);
      return;
    }
    case "flash": {
      const F = L.frame;
      ctx.fillStyle = rgba(p.color, p.strength);
      ctx.fillRect(F.left, F.top, F.width, F.height);
      return;
    }
    case "glowOrb": {
      const cx = toScreenX(L.vp, p.x);
      const cy = toScreenY(L.vp, p.y);
      const R = p.r * Math.min(L.frame.width, L.frame.height);
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
      g.addColorStop(0, rgba(p.color, 0.9));
      g.addColorStop(0.25, rgba(p.color, 0.45));
      g.addColorStop(1, rgba(p.color, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      hit?.shapes.push({ k: "circle", x: cx, y: cy, r: Math.max(10, R * 0.3) });
      return;
    }
  }
}

function strokePath(ctx: CanvasRenderingContext2D, pts: [number, number][]) {
  if (pts.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.stroke();
}

/* ------------------------------------------------------------------ overlays */

function handle(ctx: CanvasRenderingContext2D, x: number, y: number, active = false) {
  ctx.save();
  ctx.setLineDash([]);
  ctx.shadowColor = "transparent";
  ctx.fillStyle = active ? ACCENT : "#0b0e14";
  ctx.strokeStyle = ACCENT;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.rect(Math.round(x) - 4.5, Math.round(y) - 4.5, 9, 9);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawFreeFrame(ctx: CanvasRenderingContext2D, cw: number, ch: number, f: Rect) {
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.beginPath();
  ctx.rect(0, 0, cw, ch);
  ctx.rect(f.left, f.top, f.width, f.height);
  ctx.fill("evenodd");
  ctx.strokeStyle = ACCENT;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 4]);
  ctx.strokeRect(f.left, f.top, f.width, f.height);
  ctx.setLineDash([]);
  ctx.fillStyle = ACCENT;
  ctx.font = `700 11px ${FONT_STACK}`;
  ctx.textBaseline = "bottom";
  ctx.fillText("● CAMERA", f.left + 2, f.top - 4);
  ctx.restore();
}

function drawOverlay(ctx: CanvasRenderingContext2D, project: Project, layout: StageLayout, ov: Overlay, hits: ObjectHit[]) {
  const { vp, plot, priceAxis, timeAxis } = layout;
  const sel = new Set(ov.selection);
  ctx.save();
  // hover outline
  const hov = ov.hoverId && !sel.has(ov.hoverId) ? hits.find((h) => h.id === ov.hoverId) : null;
  if (hov?.bbox) {
    ctx.strokeStyle = "rgba(245,185,66,0.45)";
    ctx.lineWidth = 1;
    ctx.strokeRect(hov.bbox.left - 3, hov.bbox.top - 3, hov.bbox.width + 6, hov.bbox.height + 6);
  }
  // selection
  if (ov.showHandles) {
    for (const h of hits) {
      if (!sel.has(h.id) || !h.bbox) continue;
      const o = project.objects.find((x) => x.id === h.id);
      if (!o) continue;
      ctx.strokeStyle = "rgba(245,185,66,0.9)";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(h.bbox.left - 4, h.bbox.top - 4, h.bbox.width + 8, h.bbox.height + 8);
      ctx.setLineDash([]);
      if (o.locked) continue;
      if (h.frameSpace) {
        const b = h.bbox;
        for (const [x, y] of [[b.left - 4, b.top - 4], [b.left + b.width + 4, b.top - 4], [b.left - 4, b.top + b.height + 4], [b.left + b.width + 4, b.top + b.height + 4]]) handle(ctx, x, y);
      } else if (sel.size <= 4) {
        for (const hd of objectHandles(o)) handle(ctx, toScreenX(vp, hd.t), toScreenY(vp, hd.p));
      }
    }
  }
  // snapping guides
  for (const g of ov.guides) {
    ctx.strokeStyle = "rgba(56,189,248,0.85)";
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    if (g.p !== undefined) {
      const y = Math.round(toScreenY(vp, g.p)) + 0.5;
      strokePath(ctx, [[plot.left, y], [plot.left + plot.width, y]]);
    }
    if (g.t !== undefined) {
      const x = Math.round(toScreenX(vp, g.t)) + 0.5;
      strokePath(ctx, [[x, plot.top], [x, plot.top + plot.height]]);
    }
    ctx.setLineDash([]);
  }
  // marquee
  if (ov.marquee) {
    const m = ov.marquee;
    ctx.fillStyle = "rgba(245,185,66,0.08)";
    ctx.strokeStyle = "rgba(245,185,66,0.8)";
    ctx.fillRect(m.left, m.top, m.width, m.height);
    ctx.strokeRect(m.left + 0.5, m.top + 0.5, m.width, m.height);
  }
  // crosshair
  const c = ov.crosshair;
  if (c && c.x >= plot.left && c.x <= plot.left + plot.width && c.y >= plot.top && c.y <= plot.top + plot.height) {
    ctx.strokeStyle = rgba(project.theme.crosshair, 0.55);
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1;
    strokePath(ctx, [[plot.left, Math.round(c.y) + 0.5], [plot.left + plot.width, Math.round(c.y) + 0.5]]);
    strokePath(ctx, [[Math.round(c.x) + 0.5, plot.top], [Math.round(c.x) + 0.5, plot.top + plot.height]]);
    ctx.setLineDash([]);
    const dec = makeCompileCtx(project).decimals;
    const fs = 11;
    ctx.font = `600 ${fs}px ${MONO}`;
    const price = vp.y1 - (c.y - vp.top) / vp.sy;
    if (priceAxis) tag(ctx, priceAxis.left + 1, c.y, priceAxis.width - 2, fs, formatPrice(price, dec), "#334155", "#f8fafc");
    if (timeAxis) {
      const i = Math.round(vp.x0 + (c.x - vp.left) / vp.sx);
      const label = formatTime(candleTime(project.chart, i), project.chart.timeframe, true);
      const w = ctx.measureText(label).width + 12;
      ctx.fillStyle = "#334155";
      roundRect(ctx, c.x - w / 2, timeAxis.top + 2, w, fs + 8, 3);
      ctx.fill();
      ctx.fillStyle = "#f8fafc";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, c.x, timeAxis.top + 2 + (fs + 8) / 2);
    }
  }
  ctx.restore();
}

/** Hit test (topmost first). */
export function hitTest(hits: ObjectHit[], x: number, y: number, project: Project): string | null {
  const z = new Map(project.objects.map((o, i) => [o.id, i]));
  const sorted = [...hits].sort((a, b) => (z.get(b.id) ?? 0) - (z.get(a.id) ?? 0) + (b.frameSpace ? 1e6 : 0) - (a.frameSpace ? 1e6 : 0));
  for (const h of sorted) {
    for (const s of h.shapes) {
      if (s.k === "rect" && x >= s.x - 3 && x <= s.x + s.w + 3 && y >= s.y - 3 && y <= s.y + s.h + 3) return h.id;
      if (s.k === "circle" && Math.hypot(x - s.x, y - s.y) <= s.r) return h.id;
      if (s.k === "seg" && distToSeg(x, y, s) <= s.r) return h.id;
    }
  }
  return null;
}

function distToSeg(px: number, py: number, s: { x1: number; y1: number; x2: number; y2: number }) {
  const dx = s.x2 - s.x1;
  const dy = s.y2 - s.y1;
  const len = dx * dx + dy * dy;
  const k = len ? Math.max(0, Math.min(1, ((px - s.x1) * dx + (py - s.y1) * dy) / len)) : 0;
  return Math.hypot(px - (s.x1 + k * dx), py - (s.y1 + k * dy));
}

export function objectLabel(o: SceneObject): string {
  return o.name || getDef(o.kind).label;
}
