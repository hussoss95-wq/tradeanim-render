import type {
  AnimSpec,
  ChartTheme,
  FrameBox,
  ObjectKind,
  ObjectStyle,
  Project,
  SceneObject,
  TrackKind,
  WorldPoint,
} from "@tradeanim/project-schema";
import type { Primitive } from "../primitives";

export type ObjectGroup = "drawing" | "trading" | "smc" | "text" | "media" | "effects" | "audio";

/**
 * How a tool creates the object on the stage.
 * - drag2: press = first anchor, release = second anchor
 * - click1: single click places one anchor
 * - multi: click to add anchors, double-click / Enter to finish (paths)
 * - frame: placed in frame space (headings, media)
 * - global: no placement; inserted at the playhead (vignette, flash, audio)
 */
export type Placement = "drag2" | "click1" | "multi" | "frame" | "global";

export interface FieldOption {
  value: string;
  label: string;
}

export interface FieldDef {
  key: string;
  label: string;
  type: "text" | "textarea" | "number" | "bool" | "select" | "color" | "asset";
  options?: FieldOption[];
  min?: number;
  max?: number;
  step?: number;
  /** only show when predicate is true */
  when?: (o: SceneObject) => boolean;
}

export interface CompileCtx {
  project: Project;
  theme: ChartTheme;
  /** price label decimals */
  decimals: number;
}

export interface Handle {
  id: string;
  t: number;
  p: number;
  /** cursor hint */
  cursor?: string;
}

export interface ObjectDefaults {
  style?: Partial<ObjectStyle>;
  props?: Record<string, unknown>;
  animIn?: Partial<AnimSpec>;
  animOut?: Partial<AnimSpec>;
  duration?: number;
  frame?: FrameBox;
}

export interface ObjectDef {
  kind: ObjectKind;
  label: string;
  /** short description for tooltips / AI tool docs */
  description: string;
  group: ObjectGroup;
  track: TrackKind;
  placement: Placement;
  /** number of anchors (drag2 = 2, click1 = 1, position = 3, multi = n) */
  anchors: number;
  /** icon id resolved by the UI */
  icon: string;
  shortcut?: string;
  defaults: (ctx: CompileCtx) => ObjectDefaults;
  /** builds anchors from the placement gesture (defaults: copy a/b) */
  place?: (a: WorldPoint, b: WorldPoint, ctx: CompileCtx) => WorldPoint[];
  fields: FieldDef[];
  compile: (o: SceneObject, ctx: CompileCtx) => Primitive[];
  /** editable handles; default = one per anchor */
  handles?: (o: SceneObject) => Handle[];
  /** apply a handle drag; default = move that anchor */
  dragHandle?: (o: SceneObject, handleId: string, pt: WorldPoint) => WorldPoint[];
  /** derived updates when a prop changes (e.g. direction recolours) */
  onPropChange?: (o: SceneObject, key: string, ctx: CompileCtx) => Partial<SceneObject> | void;
}
