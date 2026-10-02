import {
  defaultAnimIn,
  defaultAnimOut,
  defaultEmphasis,
  defaultStyle,
  uid,
  type ObjectKind,
  type Project,
  type SceneObject,
  type WorldPoint,
} from "@tradeanim/project-schema";
import { priceDecimals } from "../chart";
import type { Primitive } from "../primitives";
import { DRAWING_DEFS } from "./drawing";
import { AUDIO_DEFS, EFFECT_DEFS, MEDIA_DEFS } from "./media";
import { SMC_DEFS } from "./smc";
import { TEXT_DEFS } from "./text";
import { TRADING_DEFS } from "./trading";
import type { CompileCtx, Handle, ObjectDef } from "./types";

export const ALL_DEFS: ObjectDef[] = [
  ...DRAWING_DEFS,
  ...TRADING_DEFS,
  ...SMC_DEFS,
  ...TEXT_DEFS,
  ...MEDIA_DEFS,
  ...EFFECT_DEFS,
  ...AUDIO_DEFS,
];

const BY_KIND = new Map<ObjectKind, ObjectDef>(ALL_DEFS.map((d) => [d.kind, d]));

export function getDef(kind: ObjectKind): ObjectDef {
  const d = BY_KIND.get(kind);
  if (!d) throw new Error(`Unknown object kind "${kind}"`);
  return d;
}

export function hasDef(kind: string): kind is ObjectKind {
  return BY_KIND.has(kind as ObjectKind);
}

export function makeCompileCtx(project: Project): CompileCtx {
  const cs = project.chart.candles;
  let lo = Infinity;
  let hi = -Infinity;
  for (const c of cs) {
    lo = Math.min(lo, c.l);
    hi = Math.max(hi, c.h);
  }
  const ref = cs.length ? cs[cs.length - 1].c : project.camera.base.cy;
  return { project, theme: project.theme, decimals: priceDecimals(ref, Number.isFinite(hi - lo) ? (hi - lo) / 10 : undefined) };
}

export interface CreateOptions {
  a?: WorldPoint;
  b?: WorldPoint;
  points?: WorldPoint[];
  start?: number;
  duration?: number;
  props?: Record<string, unknown>;
  name?: string;
}

/** Instantiate a new object of `kind` with registry defaults. */
export function createObject(kind: ObjectKind, ctx: CompileCtx, opts: CreateOptions = {}): SceneObject {
  const def = getDef(kind);
  const d = def.defaults(ctx);
  const a = opts.a ?? { t: 0, p: 0 };
  const b = opts.b ?? a;
  let points: WorldPoint[];
  if (opts.points) points = opts.points;
  else if (def.place) points = def.place(a, b, ctx);
  else if (def.anchors === 0) points = [];
  else if (def.anchors === 1) points = [a];
  else points = [a, b];
  const total = ctx.project.settings.duration;
  const start = Math.max(0, opts.start ?? 0);
  const duration = Math.max(0.1, opts.duration ?? d.duration ?? Math.max(1, total - start));
  const obj: SceneObject = {
    id: uid("obj_"),
    kind,
    name: opts.name ?? def.label,
    track: def.track,
    start,
    duration,
    visible: true,
    locked: false,
    points,
    frame: d.frame ? { ...d.frame } : undefined,
    style: defaultStyle(d.style),
    props: { ...(d.props ?? {}), ...(opts.props ?? {}) },
    animIn: defaultAnimIn(d.animIn),
    animOut: defaultAnimOut(d.animOut),
    emphasis: defaultEmphasis(),
  };
  // let direction-aware defaults recolour
  if (opts.props && def.onPropChange) {
    for (const key of Object.keys(opts.props)) {
      const patch = def.onPropChange(obj, key, ctx);
      if (patch) Object.assign(obj, patch);
    }
  }
  return obj;
}

/** Compile with a tiny identity cache: objects are immutable, so a ref check is enough. */
const compileCache = new WeakMap<SceneObject, { key: unknown; prims: Primitive[] }>();

export function compileObject(o: SceneObject, ctx: CompileCtx): Primitive[] {
  // objects that read chart data must recompile when candles change
  const key = o.kind === "displacement" ? ctx.project.chart.candles : ctx.decimals;
  const hit = compileCache.get(o);
  if (hit && hit.key === key) return hit.prims;
  let prims: Primitive[] = [];
  try {
    prims = getDef(o.kind).compile(o, ctx);
  } catch (err) {
    console.warn(`compile failed for ${o.kind}`, err);
  }
  compileCache.set(o, { key, prims });
  return prims;
}

export function objectHandles(o: SceneObject): Handle[] {
  const def = getDef(o.kind);
  if (def.handles) return def.handles(o);
  return o.points.map((p, i) => ({ id: String(i), t: p.t, p: p.p }));
}

export function applyHandleDrag(o: SceneObject, handleId: string, pt: WorldPoint): WorldPoint[] {
  const def = getDef(o.kind);
  if (def.dragHandle) return def.dragHandle(o, handleId, pt);
  const pts = o.points.map((p) => ({ ...p }));
  const i = Number(handleId);
  if (Number.isInteger(i) && pts[i]) pts[i] = { ...pt };
  return pts;
}

export const GROUP_LABELS: Record<string, string> = {
  drawing: "Drawing",
  trading: "Trading",
  smc: "SMC / ICT",
  text: "Text",
  media: "Media",
  effects: "Effects",
  audio: "Audio",
};
