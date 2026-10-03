"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  applyHandleDrag,
  createObject,
  evalCamera,
  fitCandles,
  getDef,
  makeCompileCtx,
  objectCenter,
  objectHandles,
  toScreenX,
  toScreenY,
  toWorldP,
  toWorldT,
  zoomCamera,
  type EditorCommand,
} from "@tradeanim/editor-core";
import { uid, type CameraState, type Candle, type SceneObject, type WorldPoint } from "@tradeanim/project-schema";
import { editor, useEditor } from "@/state/store";
import { playback, usePlayback } from "@/state/playback";
import { cameraLayout, freeLayout, type Rect, type StageLayout } from "@/stage/layout";
import { drawStage, hitTest, type ObjectHit, type Overlay } from "@/stage/draw";
import { cameraCommand, objectMenu, paste } from "@/lib/actions";
import { useContextMenu } from "./ContextMenu";

type Gesture =
  | { kind: "pan"; x: number; y: number; cam: CameraState; free: boolean }
  | { kind: "axis"; axis: "price" | "time"; x: number; y: number; cam: CameraState; free: boolean }
  | { kind: "place"; a: WorldPoint; kindId: SceneObject["kind"] }
  | { kind: "move"; x: number; y: number; t0: number; p0: number; ids: string[]; moved: boolean }
  | { kind: "handle"; id: string; handle: string; base: SceneObject }
  | { kind: "frameResize"; id: string; base: SceneObject; cx: number; cy: number; d0: number }
  | { kind: "candleHandle"; id: string; key: "o" | "h" | "l" | "c" }
  | { kind: "candleMove"; id: string; p0: number; base: Candle; moved: boolean }
  | { kind: "marquee"; x: number; y: number; additive: boolean };

const HANDLE_R = 8;

export function Stage() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const size = useRef({ w: 800, h: 500, dpr: 1 });
  const layoutRef = useRef<StageLayout | null>(null);
  const hitsRef = useRef<ObjectHit[]>([]);
  const dirty = useRef(true);
  const gesture = useRef<Gesture | null>(null);
  const overlay = useRef<Overlay>({ selection: [], candleSelection: [], hoverId: null, crosshair: null, guides: [], marquee: null, ghost: null, showHandles: true, freeView: false });
  const pathDraft = useRef<WorldPoint[] | null>(null);
  const images = useRef(new Map<string, HTMLImageElement>());
  // Pointer-driven cursor, tagged with the tool it was set for; falls back to the tool's cursor.
  const [hoverCursor, setHoverCursor] = useState<{ tool: string; cursor: string } | null>(null);
  const setCursor = (cursor: string) => setHoverCursor({ tool: editor().tool, cursor });

  const project = useEditor((s) => s.project);
  const selection = useEditor((s) => s.selection);
  const candleSelection = useEditor((s) => s.candleSelection);
  const tool = useEditor((s) => s.tool);
  const viewMode = useEditor((s) => s.viewMode);
  const freeCam = useEditor((s) => s.freeCam);
  const previewMode = useEditor((s) => s.previewMode);
  const time = usePlayback((s) => s.time);

  // keep image cache in sync with assets
  useEffect(() => {
    for (const a of project.assets) {
      if (a.type !== "image" || images.current.has(a.id)) continue;
      const img = new Image();
      img.onload = () => (dirty.current = true);
      img.src = a.src;
      images.current.set(a.id, img);
    }
  }, [project.assets]);

  useEffect(() => {
    overlay.current.selection = selection;
    overlay.current.candleSelection = candleSelection;
    overlay.current.showHandles = !previewMode;
    overlay.current.freeView = viewMode === "free";
    dirty.current = true;
  }, [project, selection, candleSelection, time, viewMode, freeCam, previewMode]);

  useEffect(() => {
    if (tool !== "path") pathDraft.current = null;
    overlay.current.ghost = null;
    dirty.current = true;
  }, [tool]);

  const toolCursor = tool === "select" ? "default" : tool === "hand" ? "grab" : "crosshair";
  const cursor = hoverCursor && hoverCursor.tool === tool ? hoverCursor.cursor : toolCursor;

  /* ---------------------------------------------------------- render loop */
  useEffect(() => {
    const el = wrapRef.current!;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      size.current = { w: Math.max(50, r.width), h: Math.max(50, r.height), dpr };
      const c = canvasRef.current!;
      c.width = Math.round(size.current.w * dpr);
      c.height = Math.round(size.current.h * dpr);
      c.style.width = `${size.current.w}px`;
      c.style.height = `${size.current.h}px`;
      dirty.current = true;
    });
    ro.observe(el);
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      if (!dirty.current) return;
      dirty.current = false;
      render();
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const computeLayout = useCallback((): StageLayout => {
    const { project: p, viewMode: vm, freeCam: fc } = editor();
    const t = playback().time;
    const cam = evalCamera(p, t, (id) => objectCenter(p, id));
    const { w, h } = size.current;
    if (vm === "free") return freeLayout(w, h, p.settings, fc ?? { ...cam, span: cam.span * 1.8, priceSpan: cam.priceSpan * 1.8 }, cam);
    return cameraLayout(w, h, p.settings, cam, editor().previewMode ? 8 : 18);
  }, []);

  function render() {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d")!;
    const { w, h, dpr } = size.current;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const layout = computeLayout();
    layoutRef.current = layout;
    hitsRef.current = drawStage({ ctx, cw: w, ch: h, project: editor().project, t: playback().time, layout, overlay: overlay.current, images: images.current });
  }

  /* ---------------------------------------------------------- helpers */
  const local = (e: { clientX: number; clientY: number }) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const world = (x: number, y: number): WorldPoint => {
    const vp = layoutRef.current!.vp;
    return { t: toWorldT(vp, x), p: toWorldP(vp, y) };
  };

  /** Magnet: snap to bar centres and candle OHLC within a few px. */
  const snapPoint = (x: number, y: number, raw: WorldPoint): { pt: WorldPoint; guides: Overlay["guides"] } => {
    const s = editor();
    if (!s.snap) return { pt: raw, guides: [] };
    const vp = layoutRef.current!.vp;
    const cs = s.project.chart.candles;
    let t = raw.t;
    let p = raw.p;
    const guides: Overlay["guides"] = [];
    const i = Math.round(raw.t);
    if (Math.abs(raw.t - i) * vp.sx < 10) t = i;
    const c = cs[i];
    if (c) {
      let best: number | null = null;
      let bestD = 9;
      for (const v of [c.o, c.h, c.l, c.c]) {
        const d = Math.abs(toScreenY(vp, v) - y);
        if (d < bestD) {
          bestD = d;
          best = v;
        }
      }
      if (best !== null) {
        p = best;
        t = i;
        guides.push({ p: best });
      }
    }
    return { pt: { t, p }, guides };
  };

  const applyView = (next: CameraState, asGesture: boolean) => {
    const s = editor();
    if (s.viewMode === "free") {
      s.setFreeCam(next);
      return;
    }
    const cmd = cameraCommand(next);
    if (asGesture) s.updateGesture(cmd);
    else s.dispatch(cmd, { merge: "camera-wheel" });
  };

  const currentView = (): CameraState => {
    const s = editor();
    const L = layoutRef.current!;
    if (s.viewMode === "free") {
      const vp = L.vp;
      return { cx: (vp.x0 + vp.x1) / 2, cy: (vp.y0 + vp.y1) / 2, span: vp.x1 - vp.x0, priceSpan: vp.y1 - vp.y0 };
    }
    return evalCamera(s.project, playback().time, (id) => objectCenter(s.project, id));
  };

  const candleAt = (x: number, y: number): Candle | null => {
    const p = editor().project;
    const vp = layoutRef.current!.vp;
    const i = Math.round(toWorldT(vp, x));
    const c = p.chart.candles[i];
    if (!c || p.chart.locked) return null;
    const halfW = Math.max(4, (vp.sx * p.chart.style.bodyWidth) / 2 + 2);
    if (Math.abs(toScreenX(vp, i) - x) > halfW) return null;
    if (y < toScreenY(vp, c.h) - 4 || y > toScreenY(vp, c.l) + 4) return null;
    return c;
  };

  const inPlot = (x: number, y: number) => {
    const P = layoutRef.current!.plot;
    return x >= P.left && x <= P.left + P.width && y >= P.top && y <= P.top + P.height;
  };

  /* ---------------------------------------------------------- pointer */
  const onPointerDown = (e: React.PointerEvent) => {
    if (!layoutRef.current) return;
    const s = editor();
    const { x, y } = local(e);
    canvasRef.current!.setPointerCapture(e.pointerId);
    const L = layoutRef.current;
    if (s.previewMode) return;

    // pan: middle button, hand tool, or space held
    if (e.button === 1 || s.tool === "hand" || (e.button === 0 && e.altKey && s.tool === "select" && !hitTest(hitsRef.current, x, y, s.project))) {
      if (s.viewMode !== "free") s.beginGesture();
      gesture.current = { kind: "pan", x, y, cam: currentView(), free: s.viewMode === "free" };
      setCursor("grabbing");
      return;
    }
    if (e.button !== 0) return;

    // axis scaling
    if (L.priceAxis && x >= L.priceAxis.left && y <= L.priceAxis.top + L.priceAxis.height) {
      if (s.viewMode !== "free") s.beginGesture();
      gesture.current = { kind: "axis", axis: "price", x, y, cam: currentView(), free: s.viewMode === "free" };
      return;
    }
    if (L.timeAxis && y >= L.timeAxis.top && x <= L.timeAxis.left + L.timeAxis.width) {
      if (s.viewMode !== "free") s.beginGesture();
      gesture.current = { kind: "axis", axis: "time", x, y, cam: currentView(), free: s.viewMode === "free" };
      return;
    }

    const raw = world(x, y);

    // candle tool: append / select candles
    if (s.tool === "candle") {
      const cs = s.project.chart.candles;
      const hitC = candleAt(x, y);
      if (hitC) {
        s.selectCandles([hitC.id], e.shiftKey ? "toggle" : "set");
        s.beginGesture();
        gesture.current = { kind: "candleMove", id: hitC.id, p0: raw.p, base: hitC, moved: false };
        return;
      }
      const prev = cs[cs.length - 1];
      const o = prev ? prev.c : raw.p;
      const body = raw.p - o;
      const wick = Math.max(Math.abs(body) * 0.3, (L.vp.y1 - L.vp.y0) * 0.01);
      const nc: Candle = { id: uid("c_"), o, c: raw.p, h: Math.max(o, raw.p) + wick, l: Math.min(o, raw.p) - wick };
      s.dispatch({ type: "candles/insert", index: cs.length, candles: [nc] });
      s.selectCandles([nc.id]);
      return;
    }

    // placement tools
    if (s.tool !== "select") {
      const def = getDef(s.tool);
      const sn = snapPoint(x, y, raw);
      overlay.current.guides = sn.guides;
      if (def.placement === "multi") {
        pathDraft.current = [...(pathDraft.current ?? []), sn.pt];
        if (e.detail >= 2 && pathDraft.current.length >= 2) finishPath();
        dirty.current = true;
        return;
      }
      if (def.placement === "frame") {
        const F = L.frame;
        const fx = (x - F.left) / F.width;
        const fy = (y - F.top) / F.height;
        place(s.tool, raw, raw, { fx, fy });
        return;
      }
      if (def.placement === "click1") {
        place(s.tool, sn.pt, sn.pt);
        return;
      }
      if (def.placement === "global") {
        place(s.tool, raw, raw);
        return;
      }
      gesture.current = { kind: "place", a: sn.pt, kindId: s.tool };
      return;
    }

    // --- select tool
    // 1. handles of selected world objects
    if (s.selection.length && s.selection.length <= 4) {
      for (const id of s.selection) {
        const o = s.project.objects.find((ob) => ob.id === id);
        if (!o || o.locked) continue;
        const hit = hitsRef.current.find((h) => h.id === id);
        if (hit?.frameSpace && hit.bbox) {
          const b = hit.bbox;
          const corners = [[b.left - 4, b.top - 4], [b.left + b.width + 4, b.top - 4], [b.left - 4, b.top + b.height + 4], [b.left + b.width + 4, b.top + b.height + 4]];
          if (corners.some(([hx, hy]) => Math.hypot(hx - x, hy - y) < HANDLE_R)) {
            const cx = b.left + b.width / 2;
            const cy = b.top + b.height / 2;
            s.beginGesture();
            gesture.current = { kind: "frameResize", id, base: o, cx, cy, d0: Math.max(4, Math.hypot(x - cx, y - cy)) };
            return;
          }
          continue;
        }
        for (const hd of objectHandles(o)) {
          if (Math.hypot(toScreenX(L.vp, hd.t) - x, toScreenY(L.vp, hd.p) - y) < HANDLE_R) {
            s.beginGesture();
            gesture.current = { kind: "handle", id, handle: hd.id, base: o };
            return;
          }
        }
      }
    }
    // 2. OHLC handles of the selected candle
    if (s.candleSelection.length === 1) {
      const c = s.project.chart.candles.find((cc) => cc.id === s.candleSelection[0]);
      const i = s.project.chart.candles.findIndex((cc) => cc.id === s.candleSelection[0]);
      if (c && !s.project.chart.locked) {
        const cx = toScreenX(L.vp, i);
        const bw = Math.max(1, L.vp.sx * s.project.chart.style.bodyWidth);
        const spots: ["o" | "h" | "l" | "c", number, number][] = [
          ["h", cx, toScreenY(L.vp, c.h)],
          ["l", cx, toScreenY(L.vp, c.l)],
          ["o", cx - bw / 2 - 12, toScreenY(L.vp, c.o)],
          ["c", cx + bw / 2 + 12, toScreenY(L.vp, c.c)],
        ];
        for (const [key, hx, hy] of spots) {
          if (Math.hypot(hx - x, hy - y) < HANDLE_R) {
            s.beginGesture();
            gesture.current = { kind: "candleHandle", id: c.id, key };
            return;
          }
        }
      }
    }
    // 3. objects
    const hitId = hitTest(hitsRef.current, x, y, s.project);
    if (hitId) {
      const mode = e.shiftKey || e.ctrlKey || e.metaKey ? "toggle" : "set";
      if (mode === "toggle") s.select([hitId], "toggle");
      else if (!s.selection.includes(hitId)) s.select([hitId]);
      const ids = editor().selection.filter((id) => !editor().project.objects.find((o) => o.id === id)?.locked);
      if (ids.length) {
        s.beginGesture();
        gesture.current = { kind: "move", x, y, t0: raw.t, p0: raw.p, ids, moved: false };
        setCursor("move");
      }
      return;
    }
    // 4. candles
    const hc = inPlot(x, y) ? candleAt(x, y) : null;
    if (hc) {
      s.selectCandles([hc.id], e.shiftKey ? "toggle" : "set");
      s.beginGesture();
      gesture.current = { kind: "candleMove", id: hc.id, p0: raw.p, base: hc, moved: false };
      return;
    }
    // 5. marquee
    if (!e.shiftKey) s.clearSelection();
    gesture.current = { kind: "marquee", x, y, additive: e.shiftKey };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!layoutRef.current) return;
    const { x, y } = local(e);
    const s = editor();
    const L = layoutRef.current;
    const g = gesture.current;
    overlay.current.crosshair = s.previewMode ? null : { x, y };
    dirty.current = true;

    if (!g) {
      // hover feedback
      if (s.tool === "select") {
        const id = hitTest(hitsRef.current, x, y, s.project);
        overlay.current.hoverId = id;
        let cur = id ? "move" : candleAt(x, y) ? "pointer" : "default";
        if (L.priceAxis && x >= L.priceAxis.left) cur = "ns-resize";
        else if (L.timeAxis && y >= L.timeAxis.top) cur = "ew-resize";
        for (const sid of s.selection) {
          const o = s.project.objects.find((ob) => ob.id === sid);
          if (!o) continue;
          for (const hd of objectHandles(o)) if (Math.hypot(toScreenX(L.vp, hd.t) - x, toScreenY(L.vp, hd.p) - y) < HANDLE_R) cur = hd.cursor ?? "crosshair";
        }
        setCursor(cur);
      } else if (s.tool !== "hand") {
        const raw = world(x, y);
        const sn = snapPoint(x, y, raw);
        overlay.current.guides = sn.guides;
        if (s.tool === "path" && pathDraft.current?.length) {
          const ctx = makeCompileCtx(s.project);
          overlay.current.ghost = createObject("path", ctx, { points: [...pathDraft.current, sn.pt] });
        }
      }
      return;
    }

    switch (g.kind) {
      case "pan": {
        const vp = L.vp;
        const dt = (x - g.x) / vp.sx;
        const dp = (y - g.y) / vp.sy;
        applyView({ ...g.cam, cx: g.cam.cx - dt, cy: g.cam.cy + dp }, true);
        return;
      }
      case "axis": {
        if (g.axis === "price") {
          const k = Math.exp((y - g.y) * 0.006);
          applyView({ ...g.cam, priceSpan: g.cam.priceSpan * k }, true);
        } else {
          const k = Math.exp(-(x - g.x) * 0.006);
          applyView({ ...g.cam, span: Math.max(3, g.cam.span * k) }, true);
        }
        return;
      }
      case "place": {
        const raw = world(x, y);
        const sn = snapPoint(x, y, raw);
        overlay.current.guides = sn.guides;
        const ctx = makeCompileCtx(s.project);
        overlay.current.ghost = createObject(g.kindId, ctx, { a: g.a, b: sn.pt });
        return;
      }
      case "move": {
        const raw = world(x, y);
        let dt = raw.t - g.t0;
        const dp = raw.p - g.p0;
        if (s.snap) dt = Math.round(dt);
        if (!g.moved && Math.hypot(x - g.x, y - g.y) < 3) return;
        g.moved = true;
        const F = L.frame;
        s.updateGesture({ type: "objects/translate", ids: g.ids, dt, dp, dfx: (x - g.x) / F.width, dfy: (y - g.y) / F.height });
        return;
      }
      case "handle": {
        const raw = world(x, y);
        const sn = snapPoint(x, y, raw);
        overlay.current.guides = sn.guides;
        s.updateGesture({ type: "objects/update", id: g.id, patch: { points: applyHandleDrag(g.base, g.handle, sn.pt) } });
        return;
      }
      case "frameResize": {
        const k = Math.max(0.1, Math.hypot(x - g.cx, y - g.cy) / g.d0);
        const b = g.base;
        const isText = b.kind === "heading" || b.kind === "caption";
        const patch: Partial<SceneObject> = isText
          ? { style: { ...b.style, fontSize: Math.max(6, Math.round(b.style.fontSize * k)) } }
          : { frame: b.frame ? { ...b.frame, w: Math.max(0.02, b.frame.w * k), h: Math.max(0.02, b.frame.h * k) } : b.frame };
        s.updateGesture({ type: "objects/update", id: g.id, patch });
        return;
      }
      case "candleHandle": {
        const raw = world(x, y);
        s.updateGesture({ type: "candles/update", id: g.id, patch: { [g.key]: raw.p } });
        return;
      }
      case "candleMove": {
        const raw = world(x, y);
        if (!g.moved && Math.abs(raw.p - g.p0) * L.vp.sy < 3) return;
        g.moved = true;
        const d = raw.p - g.p0;
        const b = g.base;
        s.updateGesture({ type: "candles/update", id: g.id, patch: { o: b.o + d, h: b.h + d, l: b.l + d, c: b.c + d } });
        return;
      }
      case "marquee": {
        overlay.current.marquee = { left: Math.min(g.x, x), top: Math.min(g.y, y), width: Math.abs(x - g.x), height: Math.abs(y - g.y) };
        return;
      }
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const g = gesture.current;
    gesture.current = null;
    const s = editor();
    overlay.current.guides = [];
    dirty.current = true;
    if (!g || !layoutRef.current) return;
    const { x, y } = local(e);
    switch (g.kind) {
      case "pan":
      case "axis":
        if (!g.free) s.endGesture("Camera view");
        setCursor(s.tool === "hand" ? "grab" : "default");
        return;
      case "place": {
        const raw = world(x, y);
        let b = snapPoint(x, y, raw).pt;
        const vp = layoutRef.current.vp;
        if (Math.abs(b.t - g.a.t) * vp.sx < 6 && Math.abs(b.p - g.a.p) * vp.sy < 6) {
          // click without drag: default footprint
          b = { t: g.a.t + Math.max(4, (vp.x1 - vp.x0) * 0.12), p: g.a.p + (vp.y1 - vp.y0) * 0.08 };
        }
        place(g.kindId, g.a, b);
        overlay.current.ghost = null;
        return;
      }
      case "move":
        s.endGesture("Move");
        setCursor("move");
        return;
      case "handle":
        s.endGesture("Edit shape");
        return;
      case "frameResize":
        s.endGesture("Resize");
        return;
      case "candleHandle":
        s.endGesture("Edit candle");
        return;
      case "candleMove":
        s.endGesture("Move candle");
        return;
      case "marquee": {
        const m = overlay.current.marquee;
        overlay.current.marquee = null;
        if (!m || m.width < 3 || m.height < 3) return;
        const ids = hitsRef.current.filter((h) => h.bbox && intersects(h.bbox, m)).map((h) => h.id);
        const vp = layoutRef.current.vp;
        const cs = s.project.chart.candles;
        const cIds: string[] = [];
        const i0 = Math.max(0, Math.ceil(toWorldT(vp, m.left)));
        const i1 = Math.min(cs.length - 1, Math.floor(toWorldT(vp, m.left + m.width)));
        for (let i = i0; i <= i1; i++) {
          const c = cs[i];
          if (toScreenY(vp, c.l) >= m.top && toScreenY(vp, c.h) <= m.top + m.height) cIds.push(c.id);
        }
        if (ids.length) s.select(ids, g.additive ? "add" : "set");
        else if (cIds.length) s.selectCandles(cIds, g.additive ? "add" : "set");
        return;
      }
    }
  };

  function place(kind: SceneObject["kind"], a: WorldPoint, b: WorldPoint, frame?: { fx: number; fy: number }) {
    const s = editor();
    const ctx = makeCompileCtx(s.project);
    const t = playback().time;
    const remaining = Math.max(0.5, s.project.settings.duration - t);
    const def = getDef(kind);
    const obj = createObject(kind, ctx, { a, b, start: t, duration: Math.min(remaining, def.defaults(ctx).duration ?? remaining) });
    if (frame && obj.frame) obj.frame = { ...obj.frame, x: clamp01(frame.fx), y: clamp01(frame.fy) };
    s.dispatch({ type: "objects/add", objects: [obj] });
    s.select([obj.id]);
    if (!s.toolSticky) s.setTool("select");
  }

  function finishPath() {
    const pts = pathDraft.current;
    pathDraft.current = null;
    overlay.current.ghost = null;
    if (!pts || pts.length < 2) return;
    const s = editor();
    const ctx = makeCompileCtx(s.project);
    const t = playback().time;
    const obj = createObject("path", ctx, { points: pts, start: t, duration: Math.max(0.5, s.project.settings.duration - t) });
    s.dispatch({ type: "objects/add", objects: [obj] });
    s.select([obj.id]);
    if (!s.toolSticky) s.setTool("select");
  }

  // Enter finishes a path, Escape cancels the draft
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!pathDraft.current) return;
      if (e.key === "Enter") finishPath();
      if (e.key === "Escape") {
        pathDraft.current = null;
        overlay.current.ghost = null;
        dirty.current = true;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /* ---------------------------------------------------------- wheel zoom */
  useEffect(() => {
    const c = canvasRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const L = layoutRef.current;
      if (!L || editor().previewMode) return;
      const r = c.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      const cam = currentView();
      if (e.shiftKey) {
        applyView({ ...cam, cx: cam.cx + (e.deltaY + e.deltaX) / L.vp.sx }, false);
        return;
      }
      const k = Math.exp(e.deltaY * 0.0015);
      const anchor = { t: toWorldT(L.vp, x), p: toWorldP(L.vp, y) };
      const kx = e.ctrlKey || e.metaKey ? 1 : k;
      const ky = e.altKey ? 1 : k;
      applyView(zoomCamera(cam, kx, ky, anchor), false);
    };
    c.addEventListener("wheel", onWheel, { passive: false });
    return () => c.removeEventListener("wheel", onWheel);
  }, []);

  const onDoubleClick = (e: React.MouseEvent) => {
    const s = editor();
    if (s.tool !== "select" || !layoutRef.current) return;
    const { x, y } = local(e);
    // double-click empty space: fit the chart
    if (!hitTest(hitsRef.current, x, y, s.project) && !candleAt(x, y) && s.project.chart.candles.length) {
      applyView(fitCandles(s.project.chart.candles), false);
    }
  };

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const s = editor();
    if (!layoutRef.current || s.previewMode) return;
    const { x, y } = local(e);
    const id = hitTest(hitsRef.current, x, y, s.project);
    if (id && !s.selection.includes(id)) s.select([id]);
    if (!id) {
      const c = candleAt(x, y);
      if (c) {
        s.selectCandles([c.id]);
        useContextMenu.getState().show(e.clientX, e.clientY, candleMenu(c));
        return;
      }
      useContextMenu.getState().show(e.clientX, e.clientY, [
        { label: "Paste", shortcut: "Ctrl+V", onSelect: paste, disabled: !s.clipboard?.length },
        { label: "Fit chart", onSelect: () => applyView(fitCandles(s.project.chart.candles), false) },
        { label: s.viewMode === "free" ? "Camera view" : "Free view", onSelect: () => s.setViewMode(s.viewMode === "free" ? "camera" : "free") },
      ]);
      return;
    }
    useContextMenu.getState().show(e.clientX, e.clientY, objectMenu());
  };

  return (
    <div ref={wrapRef} className="stage" onPointerLeave={() => {
      overlay.current.crosshair = null;
      overlay.current.hoverId = null;
      dirty.current = true;
    }}>
      <canvas
        ref={canvasRef}
        style={{ cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          editor().cancelGesture();
          gesture.current = null;
        }}
        onDoubleClick={onDoubleClick}
        onContextMenu={onContextMenu}
      />
      <StageHud />
    </div>
  );
}

function candleMenu(c: Candle) {
  const s = editor();
  const cs = s.project.chart.candles;
  const i = cs.findIndex((x) => x.id === c.id);
  const cmd = (command: EditorCommand) => () => s.dispatch(command);
  return [
    { label: "Duplicate candle", onSelect: cmd({ type: "candles/insert", index: i + 1, candles: [{ ...c, id: uid("c_") }] }) },
    { label: "Flip bull / bear", onSelect: cmd({ type: "candles/update", id: c.id, patch: { o: c.c, c: c.o } }) },
    { label: "Make doji", onSelect: cmd({ type: "candles/update", id: c.id, patch: { c: c.o } }) },
    { label: c.style?.glow ? "Remove glow" : "Glow", onSelect: cmd({ type: "candles/update", id: c.id, patch: { style: { ...c.style, glow: c.style?.glow ? 0 : 0.8 } } }) },
    { label: "Move left", disabled: i <= 0, onSelect: cmd({ type: "candles/move", id: c.id, to: i - 1 }) },
    { label: "Move right", disabled: i >= cs.length - 1, onSelect: cmd({ type: "candles/move", id: c.id, to: i + 1 }) },
    { separator: true, label: "" },
    { label: "Delete candle", danger: true, shortcut: "Del", onSelect: cmd({ type: "candles/delete", ids: [c.id] }) },
  ];
}

function intersects(a: Rect, b: Rect) {
  return a.left < b.left + b.width && a.left + a.width > b.left && a.top < b.top + b.height && a.top + a.height > b.top;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Small overlay with view mode + zoom controls in the stage corner. */
function StageHud() {
  const viewMode = useEditor((s) => s.viewMode);
  const previewMode = useEditor((s) => s.previewMode);
  const setViewMode = useEditor((s) => s.setViewMode);
  const setFreeCam = useEditor((s) => s.setFreeCam);
  const tool = useEditor((s) => s.tool);
  if (previewMode) return null;
  const hint =
    tool === "select"
      ? "Click to select · drag to move · drag empty space to marquee · wheel zoom · Alt/middle-drag pan · drag axes to scale"
      : tool === "hand"
        ? "Drag to pan · wheel to zoom"
        : tool === "candle"
          ? "Click to append a candle closing at the cursor · drag a candle to move it"
          : tool === "path"
            ? "Click to add points · double-click or Enter to finish · Esc to cancel"
            : "Drag on the chart to place · Shift-click tool to keep it active · Esc to cancel";
  return (
    <>
      <div className="stage-hud">
        <button className={viewMode === "camera" ? "on" : ""} onClick={() => setViewMode("camera")} title="Camera view: exactly what renders (pan/zoom edits the camera)">
          Camera
        </button>
        <button
          className={viewMode === "free" ? "on" : ""}
          onClick={() => {
            setFreeCam(null);
            setViewMode("free");
          }}
          title="Free view: navigate the whole chart; the camera frame is outlined"
        >
          Free
        </button>
      </div>
      <div className="stage-hint">{hint}</div>
    </>
  );
}
