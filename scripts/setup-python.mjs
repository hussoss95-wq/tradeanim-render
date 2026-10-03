// Creates ./.venv and installs the tradeanim engine + render API deps.
// Runs automatically after `npm install`; never fails the npm install.
// Skip with TRADEANIM_SKIP_PYTHON=1. Force reinstall with --force.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT, VENV, systemPython, venvPython } from "./python-env.mjs";

const REQS = [path.join(ROOT, "requirements.txt"), path.join(ROOT, "services", "render-api", "requirements.txt")];
const MARKER = path.join(VENV, ".tradeanim-deps");

function log(msg) {
  console.log(`[python] ${msg}`);
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: "inherit" });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} exited with ${r.status}`);
}

function depsHash() {
  const h = createHash("sha256");
  for (const f of [...REQS, path.join(ROOT, "setup.py")]) if (existsSync(f)) h.update(readFileSync(f));
  return h.digest("hex");
}

export function setupPython({ force = false } = {}) {
  if (process.env.TRADEANIM_SKIP_PYTHON === "1") {
    log("skipped (TRADEANIM_SKIP_PYTHON=1)");
    return true;
  }
  let py = venvPython();
  if (!py) {
    const sys = systemPython();
    if (!sys) {
      log("WARNING: Python >= 3.9 not found. The editor will run, but MP4 export needs Python.");
      log("Install Python from https://www.python.org/downloads/ then run: npm run setup:python");
      return false;
    }
    log(`creating virtualenv with Python ${sys.version} ...`);
    run(sys.cmd, [...sys.args, "-m", "venv", VENV]);
    py = venvPython();
  }
  const hash = depsHash();
  if (!force && existsSync(MARKER) && readFileSync(MARKER, "utf8") === hash) {
    log("dependencies up to date");
    return true;
  }
  log("installing Python dependencies (first run takes a minute) ...");
  run(py, ["-m", "pip", "install", "--disable-pip-version-check", "-q", "--upgrade", "pip"]);
  run(py, ["-m", "pip", "install", "--disable-pip-version-check", "-q", ...REQS.flatMap((r) => ["-r", r])]);
  run(py, ["-m", "pip", "install", "--disable-pip-version-check", "-q", "-e", ROOT]);
  writeFileSync(MARKER, hash);
  log("ready");
  return true;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  try {
    setupPython({ force: process.argv.includes("--force") });
  } catch (err) {
    log(`WARNING: ${err.message}`);
    log("The editor still works; fix Python and re-run: npm run setup:python");
  }
}
