import { uid, type CameraKeyframe, type CameraState, type Easing, type Project } from "@tradeanim/project-schema";
import { fitCandles } from "./chart";
import { evalCamera } from "./camera";
import type { WorldBBox } from "./primitives";
import { objectCenter } from "./compile";
import { compileObject, makeCompileCtx } from "./objects/registry";
import { primitivesBBox } from "./primitives";

export type CameraPresetId =
  | "slowZoom"
  | "punchIn"
  | "reveal"
  | "followPrice"
  | "zoomToPOI"
  | "zoomToEntry"
  | "macroToMicro";

export const CAMERA_PRESETS: { id: CameraPresetId; label: string; hint: string }[] = [
  { id: "slowZoom", label: "Slow Zoom", hint: "Gentle 4s push-in from the current view" },
  { id: "punchIn", label: "Punch In", hint: "Fast zoom onto the selection (or centre)" },
  { id: "reveal", label: "Reveal", hint: "Start tight on the first candles, pull out to the full chart" },
  { id: "followPrice", label: "Follow Price", hint: "Camera tracks the newest revealed candle" },
  { id: "zoomToPOI", label: "Zoom To POI", hint: "Frame the selected object(s)" },
  { id: "zoomToEntry", label: "Zoom To Entry", hint: "Frame the first long/short position" },
  { id: "macroToMicro", label: "Macro To Micro", hint: "Whole chart, then dive into the selection" },
];

const kf = (time: number, state: CameraState, easing: Easing = "cubicInOut", follow: CameraKeyframe["follow"] = { mode: "none" }): CameraKeyframe => ({
  id: uid("kf_"),
  time: Math.max(0, +time.toFixed(3)),
  state,
  easing,
  follow,
});

export function fitChart(project: Project): CameraState {
  return fitCandles(project.chart.candles);
}

export function bboxState(bb: WorldBBox, aspectHint = 1, pad = 0.35): CameraState {
  const w = Math.max(4, (bb.x2 - bb.x1) * (1 + pad * 2));
  const h = Math.max((bb.y2 - bb.y1) * (1 + pad * 2), 1e-9);
  return { cx: (bb.x1 + bb.x2) / 2, cy: (bb.y1 + bb.y2) / 2, span: w * aspectHint, priceSpan: h };
}

export function selectionBBox(project: Project, ids: string[]): WorldBBox | null {
  const ctx = makeCompileCtx(project);
  let acc: WorldBBox | null = null;
  for (const o of project.objects) {
    if (!ids.includes(o.id)) continue;
    const bb = primitivesBBox(compileObject(o, ctx));
    if (!bb) continue;
    acc = acc ? { x1: Math.min(acc.x1, bb.x1), y1: Math.min(acc.y1, bb.y1), x2: Math.max(acc.x2, bb.x2), y2: Math.max(acc.y2, bb.y2) } : bb;
  }
  return acc;
}

/**
 * Build keyframes for a preset starting at `time`. Returned keyframes are
 * meant to be merged (upserted) into the camera track.
 */
export function cameraPreset(project: Project, id: CameraPresetId, time: number, selection: string[] = []): CameraKeyframe[] {
  const current = evalCamera(project, time, (oid) => objectCenter(project, oid));
  const candles = project.chart.candles;
  const selBox = selectionBBox(project, selection);
  const focus = (): CameraState => {
    if (selBox) return bboxState(selBox);
    return { ...current, span: current.span * 0.5, priceSpan: current.priceSpan * 0.5 };
  };
  switch (id) {
    case "slowZoom":
      return [kf(time, current), kf(time + 4, { ...current, span: current.span * 0.72, priceSpan: current.priceSpan * 0.72 }, "easeInOut")];
    case "punchIn":
      return [kf(time, current), kf(time + 0.35, focus(), "expoOut")];
    case "reveal": {
      if (!candles.length) return [];
      const n = candles.length;
      return [kf(time, fitCandles(candles, 0, Math.min(n - 1, 8), { rightPad: 3 })), kf(time + 3, fitCandles(candles), "cubicInOut")];
    }
    case "followPrice": {
      const span = Math.min(40, Math.max(16, candles.length * 0.5));
      const all = fitCandles(candles);
      return [kf(Math.max(time, project.chart.start), { ...all, span }, "linear", { mode: "price" })];
    }
    case "zoomToPOI":
      return [kf(time, current), kf(time + 1.2, focus(), "cubicInOut")];
    case "zoomToEntry": {
      const pos = project.objects.find((o) => o.kind === "longPosition" || o.kind === "shortPosition");
      if (!pos) return [];
      const bb = selectionBBox(project, [pos.id]);
      return bb ? [kf(time, current), kf(time + 1.2, bboxState(bb, 1, 0.25), "cubicInOut")] : [];
    }
    case "macroToMicro": {
      const macro = fitCandles(candles);
      const micro = selBox ? bboxState(selBox) : fitCandles(candles, Math.max(0, candles.length - 10), candles.length - 1, { rightPad: 3 });
      return [kf(time, macro), kf(time + 1.2, macro), kf(time + 3.2, micro, "expoInOut")];
    }
  }
}
