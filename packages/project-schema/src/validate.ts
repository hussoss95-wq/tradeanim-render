import type { Project } from "./types";

export interface ValidationIssue {
  path: string;
  message: string;
}

const finite = (n: unknown) => typeof n === "number" && Number.isFinite(n);

/** Structural sanity checks run before save / export. Returns [] when valid. */
export function validateProject(p: Project): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const s = p.settings;
  if (!(s.width >= 16 && s.height >= 16)) issues.push({ path: "settings", message: "Resolution too small" });
  if (s.width % 2 || s.height % 2) issues.push({ path: "settings", message: "Width/height must be even for H.264" });
  if (!(s.fps >= 1 && s.fps <= 120)) issues.push({ path: "settings.fps", message: "FPS must be 1..120" });
  if (!(s.duration > 0 && s.duration <= 600)) issues.push({ path: "settings.duration", message: "Duration must be 0..600s" });

  p.chart.candles.forEach((c, i) => {
    if (![c.o, c.h, c.l, c.c].every(finite)) {
      issues.push({ path: `chart.candles[${i}]`, message: "OHLC must be numbers" });
    } else if (c.h < Math.max(c.o, c.c) || c.l > Math.min(c.o, c.c)) {
      issues.push({ path: `chart.candles[${i}]`, message: "High/Low must contain Open/Close" });
    }
  });

  const ids = new Set<string>();
  p.objects.forEach((o, i) => {
    if (ids.has(o.id)) issues.push({ path: `objects[${i}]`, message: `Duplicate id ${o.id}` });
    ids.add(o.id);
    if (!(o.duration > 0)) issues.push({ path: `objects[${i}]`, message: "Duration must be > 0" });
    if (o.points.some((pt) => !finite(pt.t) || !finite(pt.p))) {
      issues.push({ path: `objects[${i}].points`, message: "Anchor coordinates must be numbers" });
    }
  });
  return issues;
}
