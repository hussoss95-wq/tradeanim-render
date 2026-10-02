"""tradeanim render API.

Bridges the web editor and the Python tradeanim engine:

  POST /api/render            render plan (+ options) -> job (rendered in a worker process)
  GET  /api/render/{id}       job status / progress
  POST /api/render/{id}/cancel
  GET  /api/renders/{id}.mp4  rendered video
  GET/PUT/DELETE /api/projects[/{id}]   project files in workspace/projects
  GET  /api/health

Run: uvicorn app:app --app-dir services/render-api --port 8000
(`npm run dev` at the repo root starts it together with the editor).
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import threading
import time
import uuid
from collections import deque
from pathlib import Path
from typing import Any, Optional

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

import tradeanim  # noqa: E402
from tradeanim.renderer import resolve_ffmpeg  # noqa: E402

WORKSPACE = Path(os.environ.get("TRADEANIM_WORKSPACE", ROOT / "workspace")).resolve()
PROJECTS = WORKSPACE / "projects"
RENDERS = WORKSPACE / "renders"
for d in (PROJECTS, RENDERS):
    d.mkdir(parents=True, exist_ok=True)

ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,80}$")
WORKER = Path(__file__).with_name("worker.py")
MAX_PIXELS = 3840 * 2160

app = FastAPI(title="tradeanim render API", version=tradeanim.__version__)
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1)(:\d+)?",
    allow_methods=["*"],
    allow_headers=["*"],
)


def _check_id(value: str) -> str:
    if not ID_RE.match(value):
        raise HTTPException(400, "invalid id")
    return value


# ------------------------------------------------------------------ jobs


class RenderOptions(BaseModel):
    width: int = Field(1920, ge=16, le=7680)
    height: int = Field(1080, ge=16, le=7680)
    fps: int = Field(30, ge=1, le=120)
    quality: str = Field("standard", pattern="^(draft|standard|high)$")


class RenderRequest(BaseModel):
    plan: dict[str, Any]
    options: RenderOptions = RenderOptions()
    project: Optional[dict[str, Any]] = None


class Job:
    def __init__(self, job_id: str, total_frames: int):
        self.id = job_id
        self.status = "queued"
        self.frame = 0
        self.total_frames = total_frames
        self.message = "Queued"
        self.error: Optional[str] = None
        self.created_at = time.time()
        self.started_at: Optional[float] = None
        self.finished_at: Optional[float] = None
        self.proc: Optional[subprocess.Popen] = None
        self.cancel_requested = False

    @property
    def dir(self) -> Path:
        return RENDERS / self.id

    def to_dict(self) -> dict:
        end = self.finished_at or time.time()
        return {
            "id": self.id,
            "status": self.status,
            "progress": (self.frame / self.total_frames) if self.total_frames else 0.0,
            "frame": self.frame,
            "totalFrames": self.total_frames,
            "message": self.message,
            "error": self.error,
            "url": f"/api/renders/{self.id}.mp4" if self.status == "done" else None,
            "createdAt": self.created_at,
            "elapsed": (end - self.started_at) if self.started_at else 0.0,
        }


JOBS: dict[str, Job] = {}
QUEUE: deque[str] = deque()
LOCK = threading.Lock()
WAKE = threading.Event()


def _run_job(job: Job) -> None:
    job.status = "running"
    job.message = "Rendering frames"
    job.started_at = time.time()
    env = {**os.environ, "MPLBACKEND": "Agg", "PYTHONIOENCODING": "utf-8", "PYTHONUNBUFFERED": "1"}
    cmd = [sys.executable, str(WORKER), str(job.dir / "plan.json"), str(job.dir / "options.json"), str(job.dir / "output.mp4")]
    log_lines: deque[str] = deque(maxlen=60)
    try:
        job.proc = subprocess.Popen(cmd, cwd=str(ROOT), env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace")
        assert job.proc.stdout is not None
        for line in job.proc.stdout:
            line = line.rstrip()
            if line.startswith("PROGRESS "):
                done, total = line.split()[1].split("/")
                job.frame, job.total_frames = int(done), int(total)
                if job.frame >= job.total_frames:
                    job.message = "Encoding"
            elif line.startswith("STAGE "):
                job.message = line[6:]
            elif line.strip():
                log_lines.append(line)
        code = job.proc.wait()
        if job.cancel_requested:
            job.status, job.message = "cancelled", "Cancelled"
        elif code == 0 and (job.dir / "output.mp4").exists():
            job.status, job.message = "done", "Done"
            job.frame = job.total_frames
        else:
            job.status = "error"
            job.error = "\n".join(list(log_lines)[-25:]) or f"worker exited with {code}"
            job.message = "Failed"
    except Exception as exc:  # pragma: no cover - defensive
        job.status, job.error, job.message = "error", repr(exc), "Failed"
    finally:
        job.finished_at = time.time()
        job.proc = None


def _worker_loop() -> None:
    while True:
        WAKE.wait()
        while True:
            with LOCK:
                if not QUEUE:
                    WAKE.clear()
                    break
                job = JOBS[QUEUE.popleft()]
            if job.cancel_requested:
                job.status, job.message, job.finished_at = "cancelled", "Cancelled", time.time()
                continue
            _run_job(job)


threading.Thread(target=_worker_loop, daemon=True, name="render-queue").start()


@app.get("/api/health")
def health():
    ffmpeg = resolve_ffmpeg()
    return {"ok": True, "version": tradeanim.__version__, "ffmpeg": ffmpeg, "workspace": str(WORKSPACE), "queued": len(QUEUE)}


@app.post("/api/render")
def start_render(req: RenderRequest):
    plan = req.plan
    if plan.get("format") != "tradeanim.renderplan":
        raise HTTPException(422, "body.plan must be a tradeanim render plan (compileRenderPlan output)")
    o = req.options
    if o.width * o.height > MAX_PIXELS:
        raise HTTPException(422, "resolution too large")
    duration = float(plan.get("settings", {}).get("duration", 0))
    if not 0 < duration <= 600:
        raise HTTPException(422, "duration must be within (0, 600] seconds")
    job = Job(uuid.uuid4().hex[:12], int(duration * o.fps))
    job.dir.mkdir(parents=True, exist_ok=True)
    (job.dir / "plan.json").write_text(json.dumps(plan), encoding="utf-8")
    (job.dir / "options.json").write_text(o.model_dump_json(), encoding="utf-8")
    if req.project is not None:
        (job.dir / "project.json").write_text(json.dumps(req.project), encoding="utf-8")
    with LOCK:
        JOBS[job.id] = job
        QUEUE.append(job.id)
        job.message = f"Queued ({len(QUEUE)} ahead)" if len(QUEUE) > 1 else "Starting"
    WAKE.set()
    return job.to_dict()


@app.get("/api/render/{job_id}")
def job_status(job_id: str):
    job = JOBS.get(_check_id(job_id))
    if not job:
        raise HTTPException(404, "job not found")
    return job.to_dict()


@app.post("/api/render/{job_id}/cancel")
def cancel(job_id: str):
    job = JOBS.get(_check_id(job_id))
    if not job:
        raise HTTPException(404, "job not found")
    job.cancel_requested = True
    if job.proc and job.proc.poll() is None:
        job.proc.kill()
    return job.to_dict()


@app.get("/api/renders/{job_id}.mp4")
def video(job_id: str, request: Request):
    path = RENDERS / _check_id(job_id) / "output.mp4"
    if not path.exists():
        raise HTTPException(404, "video not found")
    download = "download" in request.query_params
    return FileResponse(path, media_type="video/mp4", filename=f"tradeanim-{job_id}.mp4" if download else None)


# ------------------------------------------------------------------ projects


@app.get("/api/projects")
def list_projects():
    out = []
    for f in sorted(PROJECTS.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True):
        try:
            doc = json.loads(f.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        s = doc.get("settings", {})
        out.append({"id": f.stem, "name": doc.get("name", f.stem), "updatedAt": doc.get("updatedAt", ""), "aspect": s.get("aspect"), "duration": s.get("duration")})
    return out


@app.get("/api/projects/{project_id}")
def get_project(project_id: str):
    path = PROJECTS / f"{_check_id(project_id)}.json"
    if not path.exists():
        raise HTTPException(404, "project not found")
    return json.loads(path.read_text(encoding="utf-8"))


@app.put("/api/projects/{project_id}")
async def save_project(project_id: str, request: Request):
    _check_id(project_id)
    doc = await request.json()
    if not isinstance(doc, dict) or doc.get("schema") != "tradeanim.project":
        raise HTTPException(422, "not a tradeanim project")
    path = PROJECTS / f"{project_id}.json"
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(doc, indent=1), encoding="utf-8")
    tmp.replace(path)
    return {"id": project_id, "path": str(path.relative_to(ROOT)) if path.is_relative_to(ROOT) else str(path)}


@app.delete("/api/projects/{project_id}")
def delete_project(project_id: str):
    path = PROJECTS / f"{_check_id(project_id)}.json"
    if path.exists():
        path.unlink()
    return {"ok": True}
