// Regenerates tests/fixtures/parity.json: a render plan plus TS-evaluated samples
// that tests/test_project_render.py checks the Python mirror against.
//   npx tsx scripts/make-parity-fixture.ts
import { writeFileSync } from "node:fs";
import { buildSweepScenario, candleReveal, compileRenderPlan, evalAnim, evalCamera, parseBrief } from "../packages/editor-core/src/index";

const project = buildSweepScenario(parseBrief("bearish liquidity sweep CISD FVG entry 6 seconds")).project;
project.id = "prj_fixture";
const plan = compileRenderPlan(project);
const times = [0, 0.4, 1.1, 2.05, 3.3, 4.6, 5.9];
const samples = times.map((t) => ({
  t,
  camera: evalCamera(project, t),
  reveal: project.chart.candles.slice(0, 12).map((_, i) => candleReveal(project.chart, i, t)),
  anim: plan.objects.map((o) => {
    const s = evalAnim(o, t);
    return { visible: s.visible, opacity: s.opacity, progress: s.progress, chars: s.chars, scale: s.scale, dx: s.dx, dy: s.dy };
  }),
}));
writeFileSync("tests/fixtures/parity.json", JSON.stringify({ plan, samples }));
console.log("wrote tests/fixtures/parity.json");
