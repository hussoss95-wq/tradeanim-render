"use client";

import {
  Aperture,
  ArrowUpRight,
  Captions,
  Circle,
  Focus,
  Heading,
  Image as ImageIcon,
  MessageSquare,
  Minus,
  MoveRight,
  Music,
  Percent,
  RectangleHorizontal,
  Ruler,
  Sparkles,
  Spline,
  Square,
  Sun,
  Tag,
  TrendingDown,
  TrendingUp,
  Zap,
} from "lucide-react";
import type { ObjectKind } from "@tradeanim/project-schema";

const LUCIDE: Partial<Record<string, React.ComponentType<{ size?: number; color?: string }>>> = {
  trendline: TrendingUp,
  ray: ArrowUpRight,
  hline: Minus,
  arrow: MoveRight,
  path: Spline,
  rect: Square,
  zone: RectangleHorizontal,
  circle: Circle,
  long: TrendingUp,
  short: TrendingDown,
  measure: Ruler,
  fib: Percent,
  heading: Heading,
  label: Tag,
  callout: MessageSquare,
  caption: Captions,
  image: ImageIcon,
  logo: Sparkles,
  spotlight: Focus,
  orb: Sun,
  vignette: Aperture,
  flash: Zap,
  audio: Music,
};

const COLORS: Partial<Record<string, string>> = { long: "#22c55e", short: "#ef4444" };

/** Compact SMC/ICT badges (clearer than pictograms for these concepts). */
export const SMC_BADGES: Partial<Record<ObjectKind, [string, string]>> = {
  fvg: ["FVG", "#22c55e"],
  ifvg: ["IFVG", "#16a34a"],
  bos: ["BOS", "#38bdf8"],
  choch: ["CHoCH", "#f5b942"],
  mss: ["MSS", "#a855f7"],
  cisd: ["CISD", "#22d3ee"],
  orderBlock: ["OB", "#3b82f6"],
  breakerBlock: ["BB", "#60a5fa"],
  mitigationBlock: ["MB", "#93c5fd"],
  liquidity: ["LIQ", "#f5b942"],
  liquiditySweep: ["SWP", "#f59e0b"],
  liquidityGrab: ["GRB", "#fb923c"],
  equalHighs: ["EQH", "#f5b942"],
  equalLows: ["EQL", "#f5b942"],
  inducement: ["IDM", "#f472b6"],
  ote: ["OTE", "#f5b942"],
  premiumDiscount: ["P/D", "#94a3b8"],
  premium: ["PRM", "#ef4444"],
  discount: ["DSC", "#22c55e"],
  equilibrium: ["EQ", "#94a3b8"],
  pdh: ["PDH", "#38bdf8"],
  pdl: ["PDL", "#38bdf8"],
  pwh: ["PWH", "#c084fc"],
  pwl: ["PWL", "#c084fc"],
  sessionHigh: ["SH", "#fb923c"],
  sessionLow: ["SL", "#fb923c"],
  killZone: ["KZ", "#3b82f6"],
  displacement: ["DSP", "#22c55e"],
  smt: ["SMT", "#a855f7"],
};

export function ToolIcon({ kind, icon, size = 15 }: { kind: ObjectKind; icon: string; size?: number }) {
  const badge = SMC_BADGES[kind];
  if (badge) {
    return (
      <span className="badge" style={{ color: badge[1], borderColor: `${badge[1]}55` }}>
        {badge[0]}
      </span>
    );
  }
  const C = LUCIDE[icon] ?? Square;
  return <C size={size} color={COLORS[icon]} />;
}
