// Run the project virtualenv's Python with the given args (e.g. -m pytest).
import { spawnSync } from "node:child_process";
import { ROOT, venvPython } from "./python-env.mjs";

const py = venvPython();
if (!py) {
  console.error("No .venv found — run `npm install` (or `npm run setup:python`) first.");
  process.exit(1);
}
const r = spawnSync(py, process.argv.slice(2), { cwd: ROOT, stdio: "inherit", env: { ...process.env, MPLBACKEND: "Agg" } });
process.exit(r.status ?? 1);
