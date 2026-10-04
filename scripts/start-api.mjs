// Production-mode render API (cross-platform equivalent of services/render-api/start.sh).
// Uses the project .venv when present, otherwise the system Python.
//   APP_ENV=production PORT=8000 ALLOWED_ORIGINS=https://studio.algo-liquid.com npm run start:api
import { spawn } from "node:child_process";
import path from "node:path";
import { ROOT, systemPython, venvPython } from "./python-env.mjs";

const py = venvPython() ?? systemPython()?.cmd;
if (!py) {
  console.error("Python not found. Run `npm install` (creates .venv) or install Python 3.9+.");
  process.exit(1);
}
// FORWARDED_ALLOW_IPS is read by uvicorn from the environment (a "*" argument would be glob-expanded on Windows).
const env = { ...process.env, APP_ENV: process.env.APP_ENV || "production", FORWARDED_ALLOW_IPS: process.env.FORWARDED_ALLOW_IPS || "*", MPLBACKEND: "Agg", PYTHONUNBUFFERED: "1" };
const args = [
  "-m", "uvicorn", "app:app",
  "--app-dir", path.join("services", "render-api"),
  "--host", process.env.HOST || "0.0.0.0",
  "--port", process.env.PORT || "8000",
  "--workers", "1",
  "--proxy-headers",
  "--timeout-graceful-shutdown", "30",
  "--log-level", process.env.LOG_LEVEL || "info",
  "--no-server-header",
];
const child = spawn(py, args, { cwd: ROOT, env, stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 0));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
