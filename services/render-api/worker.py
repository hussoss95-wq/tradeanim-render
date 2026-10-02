"""Render worker: one process per job so a crash or cancel never takes the API down.

usage: python worker.py plan.json options.json output.mp4
Prints `PROGRESS done/total` and `STAGE text` lines for the API to parse.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from tradeanim.project import render_plan  # noqa: E402


def main() -> int:
    plan_path, options_path, out_path = sys.argv[1:4]
    plan = json.loads(Path(plan_path).read_text(encoding="utf-8"))
    opts = json.loads(Path(options_path).read_text(encoding="utf-8"))
    last = [-1]

    def progress(done: int, total: int) -> None:
        # throttle: ~40 updates per render
        if done == total or done - last[0] >= max(1, total // 40):
            last[0] = done
            print(f"PROGRESS {done}/{total}", flush=True)

    print("STAGE Rendering frames", flush=True)
    render_plan(plan, out_path, width=opts["width"], height=opts["height"], fps=opts["fps"], quality=opts.get("quality", "standard"), on_progress=progress)
    print("STAGE Done", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
