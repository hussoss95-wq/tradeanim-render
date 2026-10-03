// One-command dev launcher for AlgoLiquid Studio: render API (FastAPI :8000) + editor (Next.js :3000).
//   npm run dev              -> both
//   npm run dev -- --web-only
//   npm run dev -- --api-only
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { ROOT, venvPython } from "./python-env.mjs";
import { setupPython } from "./setup-python.mjs";

const args = new Set(process.argv.slice(2));
const WEB_PORT = process.env.PORT || "3000";
const API_PORT = process.env.RENDER_API_PORT || "8000";
const isWin = process.platform === "win32";
const children = [];

const color = (c, s) => `\x1b[${c}m${s}\x1b[0m`;

function pipe(child, tag, c) {
  const prefix = color(c, `[${tag}]`);
  const onData = (buf) => {
    for (const line of buf.toString().split(/\r?\n/)) if (line.trim()) console.log(`${prefix} ${line}`);
  };
  child.stdout?.on("data", onData);
  child.stderr?.on("data", onData);
}

function start(tag, c, cmd, cmdArgs, env = {}, cwd = ROOT) {
  const child = spawn(cmd, cmdArgs, { cwd, env: { ...process.env, ...env }, shell: false });
  pipe(child, tag, c);
  child.on("exit", (code) => {
    console.log(color(c, `[${tag}] exited (${code})`));
    if (tag === "web") shutdown(code ?? 0);
  });
  children.push(child);
  return child;
}

function shutdown(code = 0) {
  for (const ch of children) {
    if (ch.exitCode !== null) continue;
    if (isWin) spawnSync("taskkill", ["/pid", String(ch.pid), "/T", "/F"], { stdio: "ignore" });
    else ch.kill("SIGTERM");
  }
  process.exit(code);
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

if (!args.has("--web-only")) {
  let py = venvPython();
  if (!py) {
    try {
      setupPython();
    } catch (err) {
      console.warn(`[python] ${err.message}`);
    }
    py = venvPython();
  }
  if (py) {
    start("api", "35", py, [
      "-m", "uvicorn", "app:app",
      "--app-dir", path.join("services", "render-api"),
      "--host", "127.0.0.1", "--port", API_PORT,
      "--reload", "--reload-dir", path.join("services", "render-api"), "--reload-dir", "tradeanim",
      "--timeout-graceful-shutdown", "3",
    ], { APP_ENV: process.env.APP_ENV || "development", MPLBACKEND: "Agg", PYTHONUNBUFFERED: "1" });
  } else {
    console.warn(color("33", "[api] Python env unavailable — editor runs, MP4 export disabled."));
  }
}

if (!args.has("--api-only")) {
  const nextBin = path.join(ROOT, "node_modules", "next", "dist", "bin", "next");
  start("web", "36", process.execPath, [nextBin, "dev", "-p", WEB_PORT], { NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || `http://localhost:${API_PORT}` }, path.join(ROOT, "apps", "editor"));
}

setTimeout(() => {
  console.log("");
  console.log(color("32", `  ▶ AlgoLiquid Studio  →  http://localhost:${WEB_PORT}`));
  console.log(color("90", `    render API        →  http://127.0.0.1:${API_PORT}/api/health`));
  console.log("");
}, 4000);
