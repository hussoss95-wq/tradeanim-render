/**
 * Project -> RenderPlan.
 *
 * The plan is what the render API / Python engine consumes. All semantic
 * object logic (SMC, positions, text layout decisions) is resolved here into
 * primitives, so Python only needs a generic primitive renderer plus the
 * shared animation/camera evaluation (mirrored in tradeanim/project.py).
 */
import type {
  AnimSpec,
  CameraKeyframe,
  CameraState,
  ChartData,
  ChartTheme,
  EmphasisSpec,
  Project,
  ProjectSettings,
  SceneObject,
} from "@tradeanim/project-schema";
import { candleTime, formatTime, timeframeSeconds } from "./chart";
import { compileObject, makeCompileCtx } from "./objects/registry";
import { primitivesBBox, type Primitive } from "./primitives";

export const RENDER_PLAN_FORMAT = "tradeanim.renderplan";
export const RENDER_PLAN_VERSION = 1;

export interface PlanObject {
  id: string;
  kind: string;
  name: string;
  start: number;
  duration: number;
  animIn: AnimSpec;
  animOut: AnimSpec;
  emphasis: EmphasisSpec;
  opacity: number;
  glow: number;
  glowColor?: string;
  blur: number;
  shadow: number;
  primitives: Primitive[];
}

export interface RenderPlan {
  format: typeof RENDER_PLAN_FORMAT;
  version: number;
  projectId: string;
  name: string;
  settings: ProjectSettings;
  theme: ChartTheme;
  decimals: number;
  chart: Omit<ChartData, "candles"> & {
    timeframeSeconds: number;
    candles: ChartData["candles"];
    timeLabels: string[];
  };
  camera: { base: CameraState; keyframes: CameraKeyframe[] };
  objects: PlanObject[];
  assets: { id: string; type: string; name: string; src: string }[];
  audio: { assetId: string; start: number; duration: number; volume: number; offset: number }[];
}

export function objectCenter(project: Project, id: string): { t: number; p: number } | null {
  const o = project.objects.find((x) => x.id === id);
  if (!o) return null;
  const bb = primitivesBBox(compileObject(o, makeCompileCtx(project)));
  if (!bb) return o.points[0] ?? null;
  return { t: (bb.x1 + bb.x2) / 2, p: (bb.y1 + bb.y2) / 2 };
}

function isRendered(project: Project, o: SceneObject): boolean {
  const track = project.tracks.find((t) => t.kind === o.track);
  return o.visible && (track?.visible ?? true);
}

export function compileRenderPlan(project: Project): RenderPlan {
  const ctx = makeCompileCtx(project);
  const chart = project.chart;
  const usedAssets = new Set<string>();

  const objects: PlanObject[] = [];
  const audio: RenderPlan["audio"] = [];
  for (const o of project.objects) {
    if (!isRendered(project, o)) continue;
    if (o.kind === "audio") {
      const assetId = String(o.props.assetId ?? "");
      if (assetId) {
        usedAssets.add(assetId);
        audio.push({ assetId, start: o.start, duration: o.duration, volume: Number(o.props.volume ?? 1), offset: Number(o.props.offset ?? 0) });
      }
      continue;
    }
    const primitives = compileObject(o, ctx);
    for (const p of primitives) if (p.k === "image") usedAssets.add(p.assetId);
    objects.push({
      id: o.id,
      kind: o.kind,
      name: o.name,
      start: o.start,
      duration: o.duration,
      animIn: o.animIn,
      animOut: o.animOut,
      emphasis: o.emphasis,
      opacity: o.style.opacity,
      glow: o.style.glow,
      glowColor: o.style.glowColor,
      blur: o.style.blur,
      shadow: o.style.shadow,
      primitives,
    });
  }

  // Object-follow keyframes are resolved to static centres (objects don't move over time).
  const keyframes = project.camera.keyframes
    .map((k): CameraKeyframe => {
      if (k.follow.mode !== "object") return k;
      const c = objectCenter(project, k.follow.objectId);
      return { ...k, follow: { mode: "none" }, state: c ? { ...k.state, cx: c.t, cy: c.p } : k.state };
    })
    .sort((a, b) => a.time - b.time);

  const candlesTrack = project.tracks.find((t) => t.kind === "candles");
  const timeLabels = chart.candles.map((_, i) => formatTime(candleTime(chart, i), chart.timeframe));

  return {
    format: RENDER_PLAN_FORMAT,
    version: RENDER_PLAN_VERSION,
    projectId: project.id,
    name: project.name,
    settings: project.settings,
    theme: project.theme,
    decimals: ctx.decimals,
    chart: {
      ...chart,
      visible: chart.visible && (candlesTrack?.visible ?? true),
      timeframeSeconds: timeframeSeconds(chart.timeframe),
      timeLabels,
    },
    camera: { base: project.camera.base, keyframes },
    objects,
    assets: project.assets.filter((a) => usedAssets.has(a.id)).map(({ id, type, name, src }) => ({ id, type, name, src })),
    audio,
  };
}
