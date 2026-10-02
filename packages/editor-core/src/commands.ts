/**
 * Serializable editor commands.
 *
 * Every project mutation — from the UI, keyboard shortcuts, importers or the
 * future AI Director — is expressed as one of these plain JSON commands and
 * applied by `applyCommand` to an (immer) draft. Because commands are data,
 * they can be logged, replayed, sent over the network, validated and produced
 * by an LLM tool call.
 */
import type {
  Asset,
  CameraKeyframe,
  CameraState,
  Candle,
  ChartData,
  ChartTheme,
  Marker,
  Project,
  ProjectMeta,
  ProjectSettings,
  SceneObject,
  TrackKind,
  TrackState,
} from "@tradeanim/project-schema";
import { normalizeCandle } from "./chart";

export type ReorderTarget = "front" | "back" | "forward" | "backward";

export type EditorCommand =
  | { type: "objects/add"; objects: SceneObject[] }
  | { type: "objects/delete"; ids: string[] }
  | { type: "objects/update"; id: string; patch: Partial<SceneObject> }
  | { type: "objects/updateMany"; patches: { id: string; patch: Partial<SceneObject> }[] }
  | { type: "objects/translate"; ids: string[]; dt: number; dp: number; dfx?: number; dfy?: number }
  | { type: "objects/retime"; ids: string[]; dStart: number }
  | { type: "objects/reorder"; ids: string[]; to: ReorderTarget }
  | { type: "chart/update"; patch: Partial<Omit<ChartData, "candles">> }
  | { type: "candles/set"; candles: Candle[] }
  | { type: "candles/update"; id: string; patch: Partial<Candle> }
  | { type: "candles/insert"; index: number; candles: Candle[] }
  | { type: "candles/delete"; ids: string[] }
  | { type: "candles/move"; id: string; to: number }
  | { type: "settings/update"; patch: Partial<ProjectSettings> }
  | { type: "theme/set"; theme: Partial<ChartTheme> }
  | { type: "camera/base"; state: CameraState }
  | { type: "camera/upsertKeyframe"; keyframe: CameraKeyframe }
  | { type: "camera/updateKeyframe"; id: string; patch: Partial<CameraKeyframe> }
  | { type: "camera/deleteKeyframes"; ids: string[] }
  | { type: "camera/setKeyframes"; keyframes: CameraKeyframe[] }
  | { type: "tracks/update"; kind: TrackKind; patch: Partial<TrackState> }
  | { type: "markers/add"; marker: Marker }
  | { type: "markers/delete"; ids: string[] }
  | { type: "assets/add"; asset: Asset }
  | { type: "project/rename"; name: string }
  | { type: "project/meta"; patch: Partial<ProjectMeta> }
  | { type: "batch"; label?: string; commands: EditorCommand[] };

const KF_EPS = 1e-3;

export function applyCommand(d: Project, cmd: EditorCommand): void {
  switch (cmd.type) {
    case "objects/add":
      d.objects.push(...cmd.objects);
      return;
    case "objects/delete": {
      const ids = new Set(cmd.ids);
      d.objects = d.objects.filter((o) => !ids.has(o.id));
      d.camera.keyframes.forEach((k) => {
        if (k.follow.mode === "object" && ids.has(k.follow.objectId)) k.follow = { mode: "none" };
      });
      return;
    }
    case "objects/update": {
      const o = d.objects.find((x) => x.id === cmd.id);
      if (o) Object.assign(o, cmd.patch);
      return;
    }
    case "objects/updateMany":
      for (const { id, patch } of cmd.patches) {
        const o = d.objects.find((x) => x.id === id);
        if (o) Object.assign(o, patch);
      }
      return;
    case "objects/translate": {
      const ids = new Set(cmd.ids);
      for (const o of d.objects) {
        if (!ids.has(o.id) || o.locked) continue;
        o.points.forEach((p) => {
          p.t += cmd.dt;
          p.p += cmd.dp;
        });
        if (o.frame && (cmd.dfx || cmd.dfy)) {
          o.frame.x += cmd.dfx ?? 0;
          o.frame.y += cmd.dfy ?? 0;
        }
      }
      return;
    }
    case "objects/retime": {
      const ids = new Set(cmd.ids);
      for (const o of d.objects) if (ids.has(o.id) && !o.locked) o.start = Math.max(0, o.start + cmd.dStart);
      return;
    }
    case "objects/reorder": {
      const ids = new Set(cmd.ids);
      const moving = d.objects.filter((o) => ids.has(o.id));
      const rest = d.objects.filter((o) => !ids.has(o.id));
      if (cmd.to === "front") d.objects = [...rest, ...moving];
      else if (cmd.to === "back") d.objects = [...moving, ...rest];
      else {
        const arr = [...d.objects];
        const step = cmd.to === "forward" ? 1 : -1;
        const order = step > 0 ? [...arr.keys()].reverse() : [...arr.keys()];
        for (const i of order) {
          if (!ids.has(arr[i].id)) continue;
          const j = i + step;
          if (j < 0 || j >= arr.length || ids.has(arr[j].id)) continue;
          [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        d.objects = arr;
      }
      return;
    }
    case "chart/update":
      Object.assign(d.chart, cmd.patch);
      return;
    case "candles/set":
      d.chart.candles = cmd.candles.map(normalizeCandle);
      return;
    case "candles/update": {
      const i = d.chart.candles.findIndex((c) => c.id === cmd.id);
      if (i >= 0) d.chart.candles[i] = normalizeCandle({ ...d.chart.candles[i], ...cmd.patch });
      return;
    }
    case "candles/insert":
      d.chart.candles.splice(Math.max(0, Math.min(d.chart.candles.length, cmd.index)), 0, ...cmd.candles.map(normalizeCandle));
      return;
    case "candles/delete": {
      const ids = new Set(cmd.ids);
      d.chart.candles = d.chart.candles.filter((c) => !ids.has(c.id));
      return;
    }
    case "candles/move": {
      const from = d.chart.candles.findIndex((c) => c.id === cmd.id);
      if (from < 0) return;
      const [c] = d.chart.candles.splice(from, 1);
      d.chart.candles.splice(Math.max(0, Math.min(d.chart.candles.length, cmd.to)), 0, c);
      return;
    }
    case "settings/update":
      Object.assign(d.settings, cmd.patch);
      return;
    case "theme/set":
      Object.assign(d.theme, cmd.theme);
      return;
    case "camera/base":
      d.camera.base = cmd.state;
      return;
    case "camera/upsertKeyframe": {
      const k = cmd.keyframe;
      const i = d.camera.keyframes.findIndex((x) => x.id === k.id || Math.abs(x.time - k.time) < KF_EPS);
      if (i >= 0) d.camera.keyframes[i] = { ...k, id: d.camera.keyframes[i].id };
      else d.camera.keyframes.push(k);
      d.camera.keyframes.sort((a, b) => a.time - b.time);
      return;
    }
    case "camera/updateKeyframe": {
      const k = d.camera.keyframes.find((x) => x.id === cmd.id);
      if (k) Object.assign(k, cmd.patch);
      d.camera.keyframes.sort((a, b) => a.time - b.time);
      return;
    }
    case "camera/deleteKeyframes": {
      const ids = new Set(cmd.ids);
      d.camera.keyframes = d.camera.keyframes.filter((k) => !ids.has(k.id));
      return;
    }
    case "camera/setKeyframes":
      d.camera.keyframes = [...cmd.keyframes].sort((a, b) => a.time - b.time);
      return;
    case "tracks/update": {
      const t = d.tracks.find((x) => x.kind === cmd.kind);
      if (t) Object.assign(t, cmd.patch);
      if (cmd.kind === "candles") {
        if (cmd.patch.visible !== undefined) d.chart.visible = cmd.patch.visible;
        if (cmd.patch.locked !== undefined) d.chart.locked = cmd.patch.locked;
      }
      return;
    }
    case "markers/add":
      d.markers.push(cmd.marker);
      return;
    case "markers/delete": {
      const ids = new Set(cmd.ids);
      d.markers = d.markers.filter((m) => !ids.has(m.id));
      return;
    }
    case "assets/add":
      if (!d.assets.some((a) => a.id === cmd.asset.id)) d.assets.push(cmd.asset);
      return;
    case "project/rename":
      d.name = cmd.name;
      return;
    case "project/meta":
      Object.assign(d.meta, cmd.patch);
      return;
    case "batch":
      for (const c of cmd.commands) applyCommand(d, c);
      return;
  }
}

const LABELS: Record<string, string> = {
  "objects/add": "Add object",
  "objects/delete": "Delete",
  "objects/update": "Edit object",
  "objects/updateMany": "Edit objects",
  "objects/translate": "Move",
  "objects/retime": "Move clips",
  "objects/reorder": "Reorder layers",
  "chart/update": "Edit chart",
  "candles/set": "Replace candles",
  "candles/update": "Edit candle",
  "candles/insert": "Add candle",
  "candles/delete": "Delete candle",
  "candles/move": "Move candle",
  "settings/update": "Project settings",
  "theme/set": "Theme",
  "camera/base": "Camera",
  "camera/upsertKeyframe": "Camera keyframe",
  "camera/updateKeyframe": "Camera keyframe",
  "camera/deleteKeyframes": "Delete keyframe",
  "camera/setKeyframes": "Camera preset",
  "tracks/update": "Track",
  "markers/add": "Add marker",
  "markers/delete": "Delete marker",
  "assets/add": "Import asset",
  "project/rename": "Rename",
  "project/meta": "Project info",
};

export function describeCommand(cmd: EditorCommand): string {
  if (cmd.type === "batch") return cmd.label ?? (cmd.commands[0] ? describeCommand(cmd.commands[0]) : "Batch");
  return LABELS[cmd.type] ?? cmd.type;
}
