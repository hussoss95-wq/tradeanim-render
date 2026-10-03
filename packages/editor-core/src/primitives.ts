/**
 * Render primitives: the display-list contract between object definitions and
 * renderers. Every object kind compiles to a list of these, and both the
 * browser canvas renderer and the Python/tradeanim renderer draw them, so the
 * semantic logic (what an FVG or a short position looks like) lives in one
 * place.
 *
 * Coordinates are world (t = bar index, p = price) unless `space: "frame"`
 * is set, in which case x/y are 0..1 of the output frame. Sizes are
 * reference px (short side = 1080).
 */

import type { DashStyle } from "@tradeanim/project-schema";

export type Space = "world" | "frame";

export interface PrimBase {
  /** semantic role used for hit-testing and styling hooks */
  role?: string;
  /** multiplies the object's opacity */
  alpha?: number;
}

export interface RectPrim extends PrimBase {
  k: "rect";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  fill?: string;
  fillAlpha?: number;
  stroke?: string;
  width?: number;
  dash?: DashStyle;
  /** extend to the right edge of the visible chart */
  extendRight?: boolean;
  space?: Space;
}

export interface LinePrim extends PrimBase {
  k: "line";
  pts: [number, number][];
  stroke: string;
  width: number;
  dash?: DashStyle;
  closed?: boolean;
  fill?: string;
  fillAlpha?: number;
  arrowEnd?: boolean;
  arrowStart?: boolean;
  /** extend last segment to the right edge (rays) */
  extendRight?: boolean;
  space?: Space;
}

export interface HLinePrim extends PrimBase {
  k: "hline";
  y: number;
  /** null = from left edge */
  x1: number | null;
  /** null = to right edge */
  x2: number | null;
  stroke: string;
  width: number;
  dash?: DashStyle;
}

export interface VBandPrim extends PrimBase {
  k: "vband";
  x1: number;
  x2: number;
  fill: string;
  fillAlpha: number;
  stroke?: string;
}

export interface TextPrim extends PrimBase {
  k: "text";
  x: number;
  y: number;
  text: string;
  color: string;
  size: number;
  weight?: number;
  family?: string;
  align?: "left" | "center" | "right";
  baseline?: "top" | "middle" | "bottom";
  /** label pill background */
  bg?: string;
  bgAlpha?: number;
  pad?: number;
  /** reference-px offset applied after projection */
  dx?: number;
  dy?: number;
  /** clamp x to right edge (level tags) */
  pinRight?: boolean;
  space?: Space;
  /** frame-space wrap width (0..1) */
  maxWidth?: number;
}

export interface EllipsePrim extends PrimBase {
  k: "ellipse";
  cx: number;
  cy: number;
  /** world radii */
  rx: number;
  ry: number;
  stroke?: string;
  width?: number;
  fill?: string;
  fillAlpha?: number;
  dash?: DashStyle;
}

export type MarkerShape = "circle" | "x" | "diamond" | "triangleUp" | "triangleDown";

export interface MarkerPrim extends PrimBase {
  k: "marker";
  x: number;
  y: number;
  shape: MarkerShape;
  size: number;
  color: string;
  stroke?: string;
}

export interface ImagePrim extends PrimBase {
  k: "image";
  assetId: string;
  /** frame space box */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SpotlightPrim extends PrimBase {
  k: "spotlight";
  x: number;
  y: number;
  /** radius as fraction of frame short side */
  r: number;
  dim: number;
}

export interface VignettePrim extends PrimBase {
  k: "vignette";
  strength: number;
}

export interface FlashPrim extends PrimBase {
  k: "flash";
  color: string;
  strength: number;
}

export interface GlowOrbPrim extends PrimBase {
  k: "glowOrb";
  x: number;
  y: number;
  r: number;
  color: string;
}

export type Primitive =
  | RectPrim
  | LinePrim
  | HLinePrim
  | VBandPrim
  | TextPrim
  | EllipsePrim
  | MarkerPrim
  | ImagePrim
  | SpotlightPrim
  | VignettePrim
  | FlashPrim
  | GlowOrbPrim;

export interface WorldBBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** World-space bounding box of a primitive list (frame-space prims ignored). */
export function primitivesBBox(prims: Primitive[]): WorldBBox | null {
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  const add = (x: number, y: number) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    x1 = Math.min(x1, x);
    x2 = Math.max(x2, x);
    y1 = Math.min(y1, y);
    y2 = Math.max(y2, y);
  };
  for (const p of prims) {
    switch (p.k) {
      case "rect":
        if (p.space === "frame") break;
        add(p.x1, p.y1);
        add(p.x2, p.y2);
        break;
      case "line":
        if (p.space === "frame") break;
        p.pts.forEach(([x, y]) => add(x, y));
        break;
      case "hline":
        if (p.x1 !== null) add(p.x1, p.y);
        if (p.x2 !== null) add(p.x2, p.y);
        break;
      case "vband":
        break;
      case "text":
        if (p.space === "frame") break;
        add(p.x, p.y);
        break;
      case "ellipse":
        add(p.cx - p.rx, p.cy - p.ry);
        add(p.cx + p.rx, p.cy + p.ry);
        break;
      case "marker":
      case "spotlight":
      case "glowOrb":
        add(p.x, p.y);
        break;
    }
  }
  if (!Number.isFinite(x1)) return null;
  return { x1, y1, x2, y2 };
}
