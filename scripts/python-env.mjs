// Shared helpers: locate a system Python and the project virtualenv.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const VENV = path.join(ROOT, ".venv");
const isWin = process.platform === "win32";

export function venvPython() {
  const p = isWin ? path.join(VENV, "Scripts", "python.exe") : path.join(VENV, "bin", "python");
  return existsSync(p) ? p : null;
}

function works(cmd, args) {
  try {
    const r = spawnSync(cmd, [...args, "-c", "import sys; print('%d.%d' % sys.version_info[:2])"], { encoding: "utf8" });
    if (r.status !== 0) return null;
    const [maj, min] = r.stdout.trim().split(".").map(Number);
    return maj === 3 && min >= 9 ? r.stdout.trim() : null;
  } catch {
    return null;
  }
}

/** Find a usable system Python >= 3.9: $PYTHON, then py -3 (Windows), python3, python. */
export function systemPython() {
  const candidates = [];
  if (process.env.PYTHON) candidates.push([process.env.PYTHON, []]);
  if (isWin) candidates.push(["py", ["-3"]]);
  candidates.push(["python3", []], ["python", []]);
  for (const [cmd, args] of candidates) {
    const v = works(cmd, args);
    if (v) return { cmd, args, version: v };
  }
  return null;
}
