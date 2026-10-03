/**
 * Headless compiler CLI.
 *
 *   tsx packages/editor-core/cli/plan.ts --project my.tradeanim.json [--out plan.json]
 *   tsx packages/editor-core/cli/plan.ts --prompt "bearish sweep, 12 seconds" [--project-out p.json] [--out plan.json]
 *
 * Emits the render plan consumed by the Python engine. This is the same code
 * path the editor uses, so it is the hook for server-side / AI pipelines.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { migrateProject } from "@tradeanim/project-schema";
import { buildMinimalExplainerScenario, buildSweepScenario, compileRenderPlan, parseBrief } from "../src/index";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const projectPath = arg("project");
const prompt = arg("prompt");
let project;
if (projectPath) project = migrateProject(JSON.parse(readFileSync(projectPath, "utf8")));
else if (prompt) {
  const brief = parseBrief(prompt);
  project = (brief.style === "minimalExplainer" ? buildMinimalExplainerScenario(brief) : buildSweepScenario(brief)).project;
}
else {
  console.error("usage: plan.ts (--project file.json | --prompt text) [--out plan.json] [--project-out project.json]");
  process.exit(2);
}
const projectOut = arg("project-out");
if (projectOut) writeFileSync(projectOut, JSON.stringify(project, null, 2));
const plan = JSON.stringify(compileRenderPlan(project));
const out = arg("out");
if (out) writeFileSync(out, plan);
else process.stdout.write(plan);
