import { buildSweepScenario, parseBrief } from "@tradeanim/editor-core";
import type { Project } from "@tradeanim/project-schema";

/** First-run scene: a fully built bearish sweep → CISD → FVG entry project. */
export function demoProject(): Project {
  const brief = parseBrief("Bearish liquidity sweep with CISD confirmation and FVG entry, 20 seconds");
  const p = buildSweepScenario(brief).project;
  return { ...p, name: "Demo — Liquidity Sweep → CISD → FVG", meta: { ...p.meta, generator: "demo" } };
}
