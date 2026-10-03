"use client";

/**
 * Editor actions shared by keyboard shortcuts, menus, the stage and the
 * timeline. Each action reads state imperatively and dispatches commands.
 */
import {
  createObject,
  evalCamera,
  getDef,
  makeCompileCtx,
  nextCandle,
  objectCenter,
  type EditorCommand,
} from "@tradeanim/editor-core";
import { uid, type CameraState, type ObjectKind, type SceneObject } from "@tradeanim/project-schema";
import { editor } from "@/state/store";
import { playback } from "@/state/playback";
import type { MenuItem } from "@/components/ContextMenu";

export function currentCamera(): CameraState {
  const p = editor().project;
  return evalCamera(p, playback().time, (id) => objectCenter(p, id));
}

/** Apply a view change made on the stage to the camera track (auto-key when keyframes exist). */
export function cameraCommand(state: CameraState): EditorCommand {
  const p = editor().project;
  if (p.camera.keyframes.length === 0) return { type: "camera/base", state };
  const fps = p.settings.fps;
  const time = Math.round(playback().time * fps) / fps;
  const existing = p.camera.keyframes.find((k) => Math.abs(k.time - time) < 1e-3);
  return {
    type: "camera/upsertKeyframe",
    keyframe: existing ? { ...existing, state, follow: existing.follow.mode === "price" ? existing.follow : { mode: "none" } } : { id: uid("kf_"), time, state, easing: "cubicInOut", follow: { mode: "none" } },
  };
}

/** Record the current camera view as a keyframe at the playhead. */
export function addCameraKeyframe() {
  const p = editor().project;
  const time = Math.round(playback().time * p.settings.fps) / p.settings.fps;
  const existing = p.camera.keyframes.find((k) => Math.abs(k.time - time) < 1e-3);
  const state = currentCamera();
  editor().dispatch({
    type: "camera/upsertKeyframe",
    keyframe: existing ? { ...existing, state } : { id: uid("kf_"), time, state, easing: "cubicInOut", follow: { mode: "none" } },
  });
  editor().toast(`Camera keyframe at ${time.toFixed(2)}s`, "success");
}

export function insertObject(kind: ObjectKind, opts: Parameters<typeof createObject>[2] = {}) {
  const s = editor();
  const ctx = makeCompileCtx(s.project);
  const def = getDef(kind);
  const start = opts.start ?? playback().time;
  const cam = currentCamera();
  const a = opts.a ?? { t: cam.cx - cam.span * 0.1, p: cam.cy };
  const b = opts.b ?? { t: cam.cx + cam.span * 0.12, p: cam.cy + cam.priceSpan * 0.12 };
  const remaining = Math.max(0.5, s.project.settings.duration - start);
  const obj = createObject(kind, ctx, { ...opts, a, b, start, duration: opts.duration ?? Math.min(remaining, def.defaults(ctx).duration ?? remaining) });
  s.dispatch({ type: "objects/add", objects: [obj] });
  s.select([obj.id]);
  return obj;
}

export function deleteSelection() {
  const s = editor();
  if (s.selection.length) {
    const ids = s.selection.filter((id) => !s.project.objects.find((o) => o.id === id)?.locked);
    if (ids.length) s.dispatch({ type: "objects/delete", ids });
    return;
  }
  if (s.candleSelection.length) {
    s.dispatch({ type: "candles/delete", ids: s.candleSelection });
    return;
  }
  if (s.keyframeSelection.length) s.dispatch({ type: "camera/deleteKeyframes", ids: s.keyframeSelection });
}

function cloneObjects(objs: SceneObject[], offset: { dt: number; dp: number; dStart: number }): SceneObject[] {
  return objs.map((o) => {
    const c: SceneObject = JSON.parse(JSON.stringify(o));
    c.id = uid("obj_");
    c.name = o.name.endsWith(" copy") ? o.name : `${o.name} copy`;
    c.points = c.points.map((p) => ({ t: p.t + offset.dt, p: p.p + offset.dp }));
    if (c.frame && (offset.dt || offset.dp)) c.frame = { ...c.frame, x: c.frame.x + 0.02, y: c.frame.y + 0.02 };
    c.start = Math.max(0, c.start + offset.dStart);
    return c;
  });
}

export function duplicateSelection() {
  const s = editor();
  if (s.candleSelection.length) {
    const cs = s.project.chart.candles;
    const idx = Math.max(...s.candleSelection.map((id) => cs.findIndex((c) => c.id === id)));
    const copies = cs.filter((c) => s.candleSelection.includes(c.id)).map((c) => ({ ...c, id: uid("c_") }));
    s.dispatch({ type: "candles/insert", index: idx + 1, candles: copies });
    s.selectCandles(copies.map((c) => c.id));
    return;
  }
  const objs = s.project.objects.filter((o) => s.selection.includes(o.id));
  if (!objs.length) return;
  const cam = currentCamera();
  const copies = cloneObjects(objs, { dt: 2, dp: -cam.priceSpan * 0.03, dStart: 0 });
  s.dispatch({ type: "objects/add", objects: copies });
  s.select(copies.map((c) => c.id));
}

export function copySelection() {
  const s = editor();
  const objs = s.project.objects.filter((o) => s.selection.includes(o.id));
  if (objs.length) {
    s.setClipboard(objs);
    s.toast(`Copied ${objs.length} object${objs.length > 1 ? "s" : ""}`);
  }
}

export function paste() {
  const s = editor();
  if (!s.clipboard?.length) return;
  const cam = currentCamera();
  const minStart = Math.min(...s.clipboard.map((o) => o.start));
  const copies = cloneObjects(s.clipboard, { dt: 3, dp: -cam.priceSpan * 0.04, dStart: playback().time - minStart });
  s.dispatch({ type: "objects/add", objects: copies });
  s.select(copies.map((c) => c.id));
}

export function nudge(dx: number, dy: number) {
  const s = editor();
  const cam = currentCamera();
  if (s.selection.length) {
    s.dispatch({ type: "objects/translate", ids: s.selection, dt: dx, dp: -dy * cam.priceSpan * 0.01, dfx: dx * 0.005, dfy: dy * 0.005 }, { merge: "nudge" });
  } else if (s.candleSelection.length && dy) {
    for (const id of s.candleSelection) {
      const c = s.project.chart.candles.find((x) => x.id === id);
      if (!c) continue;
      const d = -dy * cam.priceSpan * 0.005;
      s.dispatch({ type: "candles/update", id, patch: { o: c.o + d, h: c.h + d, l: c.l + d, c: c.c + d } }, { merge: `nudge-c` });
    }
  }
}

export function appendCandle(bullish: boolean) {
  const s = editor();
  const cs = s.project.chart.candles;
  const c = nextCandle(cs[cs.length - 1], bullish);
  s.dispatch({ type: "candles/insert", index: cs.length, candles: [c] });
  s.selectCandles([c.id]);
}

export function objectMenu(): MenuItem[] {
  const s = editor();
  const has = s.selection.length > 0;
  const one = s.selection.length === 1 ? s.project.objects.find((o) => o.id === s.selection[0]) : null;
  return [
    { label: "Duplicate", shortcut: "Ctrl+D", onSelect: duplicateSelection, disabled: !has },
    { label: "Copy", shortcut: "Ctrl+C", onSelect: copySelection, disabled: !has },
    { label: "Paste", shortcut: "Ctrl+V", onSelect: paste, disabled: !s.clipboard?.length },
    { separator: true, label: "" },
    { label: "Bring to Front", shortcut: "Ctrl+]", onSelect: () => s.dispatch({ type: "objects/reorder", ids: s.selection, to: "front" }), disabled: !has },
    { label: "Bring Forward", onSelect: () => s.dispatch({ type: "objects/reorder", ids: s.selection, to: "forward" }), disabled: !has },
    { label: "Send Backward", onSelect: () => s.dispatch({ type: "objects/reorder", ids: s.selection, to: "backward" }), disabled: !has },
    { label: "Send to Back", shortcut: "Ctrl+[", onSelect: () => s.dispatch({ type: "objects/reorder", ids: s.selection, to: "back" }), disabled: !has },
    { separator: true, label: "" },
    {
      label: one?.locked ? "Unlock" : "Lock",
      onSelect: () => s.dispatch({ type: "objects/updateMany", patches: s.selection.map((id) => ({ id, patch: { locked: !one?.locked } })) }),
      disabled: !has,
    },
    { label: "Hide", onSelect: () => s.dispatch({ type: "objects/updateMany", patches: s.selection.map((id) => ({ id, patch: { visible: false } })) }), disabled: !has },
    { label: "Move clip to playhead", onSelect: () => moveClipsToPlayhead(), disabled: !has },
    { label: "Camera: zoom to selection", onSelect: () => zoomToSelection(), disabled: !has },
    { separator: true, label: "" },
    { label: "Delete", shortcut: "Del", danger: true, onSelect: deleteSelection, disabled: !has },
  ];
}

export function moveClipsToPlayhead() {
  const s = editor();
  const objs = s.project.objects.filter((o) => s.selection.includes(o.id));
  if (!objs.length) return;
  const min = Math.min(...objs.map((o) => o.start));
  s.dispatch({ type: "objects/retime", ids: s.selection, dStart: playback().time - min });
}

export async function zoomToSelection() {
  const { cameraPreset } = await import("@tradeanim/editor-core");
  const s = editor();
  const kfs = cameraPreset(s.project, "zoomToPOI", playback().time, s.selection);
  if (kfs.length) s.dispatch({ type: "batch", label: "Zoom to selection", commands: kfs.map((keyframe) => ({ type: "camera/upsertKeyframe", keyframe }) as EditorCommand) });
}
