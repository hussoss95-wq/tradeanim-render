"""AlgoLiquid Studio render API.

Bridges the web editor and the Python tradeanim engine:

  GET  /api/health            liveness + readiness (ffmpeg, workspace, queue)
  POST /api/render            render plan (+ options) -> job, rendered in a worker process
  GET  /api/render/{id}       job status / progress
  POST /api/render/{id}/cancel
  GET  /api/renders/{id}.mp4  rendered video (Range requests supported)
  GET/PUT/DELETE /api/projects[/{id}]   workspace project files (development only by default)

Configuration comes from environment variables (see settings.py / .env.example).

Development:  npm run dev   (uvicorn with --reload on 127.0.0.1:8000)
Production:   services/render-api/start.sh   (APP_ENV=production, single process)
"""

from __future__ import annotations

import json
import logging
import os
import re
import secrets
import shutil
import subprocess
import sys
import threading
import time
from collections import deque
from pathlib import Path
from typing import Any, Optional

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from pydantic import BaseModel, Field
from starlette.exceptions import HTTPException as StarletteHTTPException

from settings import ROOT, load_settings

sys.path.insert(0, str(ROOT))

import tradeanim  # noqa: E402
from tradeanim.renderer import resolve_ffmpeg  # noqa: E402

SETTINGS = load_settings()
log = logging.getLogger("algoliquid.render_api")
logging.basicConfig(level=getattr(logging, SETTINGS.log_level.upper(), logging.INFO), format="%(asctime)s %(levelname)s %(name)s: %(message)s")

WORKSPACE = SETTINGS.workspace
PROJECTS = WORKSPACE / "projects"
RENDERS = WORKSPACE / "renders"
for d in (PROJECTS, RENDERS):
    d.mkdir(parents=True, exist_ok=True)

ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,80}$")
PROGRESS_RE = re.compile(r"PROGRESS (\d+)/(\d+)")
STAGE_RE = re.compile(r"STAGE (.+)$")
WORKER = Path(__file__).with_name("worker.py")
STARTED_AT = time.time()

app = FastAPI(
    title=f"{SETTINGS.app_name} render API",
    version=tradeanim.__version__,
    docs_url="/api/docs" if SETTINGS.docs_enabled else None,
    redoc_url=None,
    openapi_url="/api/openapi.json" if SETTINGS.docs_enabled else None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=SETTINGS.allowed_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Range", "X-Request-ID"],
    expose_headers=["Content-Disposition", "Content-Length", "Content-Range", "Accept-Ranges", "X-Request-ID"],
    max_age=600,
)


# ------------------------------------------------------------------ middleware & errors


@app.middleware("http")
async def request_context(request: Request, call_next):
    request_id = request.headers.get("x-request-id") or secrets.token_hex(8)
    request.state.request_id = request_id
    length = request.headers.get("content-length")
    if length and length.isdigit() and int(length) > SETTINGS.max_body_bytes:
        return _error(413, f"Request body too large (max {SETTINGS.max_body_bytes // (1024 * 1024)} MB)", request_id)
    started = time.perf_counter()
    response = await call_next(request)
    response.headers["X-Request-ID"] = request_id
    if request.url.path != "/api/health":
        log.info("%s %s -> %s (%.0f ms) [%s]", request.method, request.url.path, response.status_code, (time.perf_counter() - started) * 1000, request_id)
    return response


def _error(status: int, detail: Any, request_id: Optional[str] = None) -> JSONResponse:
    body: dict[str, Any] = {"detail": detail}
    if request_id:
        body["requestId"] = request_id
    return JSONResponse(status_code=status, content=body, headers={"X-Request-ID": request_id} if request_id else None)


@app.exception_handler(StarletteHTTPException)
async def http_error(request: Request, exc: StarletteHTTPException):
    return _error(exc.status_code, exc.detail, getattr(request.state, "request_id", None))


@app.exception_handler(RequestValidationError)
async def validation_error(request: Request, exc: RequestValidationError):
    errors = [{"loc": list(e.get("loc", [])), "msg": e.get("msg", "")} for e in exc.errors()]
    return _error(422, errors, getattr(request.state, "request_id", None))


@app.exception_handler(Exception)
async def unhandled_error(request: Request, exc: Exception):
    request_id = getattr(request.state, "request_id", None)
    log.exception("Unhandled error on %s %s [%s]", request.method, request.url.path, request_id)
    return _error(500, "Internal server error", request_id)


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


ALLOWED_VOICES = {
    "ar-IQ-BasselNeural",
    "ar-SA-ZariyahNeural",
    "en-US-GuyNeural",
    "en-US-JennyNeural",
}


class VoiceRequest(BaseModel):
    text: str = Field(min_length=1, max_length=2500)
    voice: str


@app.post("/api/voice")
async def create_voice(req: VoiceRequest):
    """Generate a compact MP3 voice-over for an AI Director project."""
    if req.voice not in ALLOWED_VOICES:
        raise HTTPException(400, "unsupported voice")
    text = req.text.strip()
    if not text:
        raise HTTPException(400, "text is required")
    try:
        import edge_tts

        audio = bytearray()
        communicator = edge_tts.Communicate(text, req.voice)
        async for chunk in communicator.stream():
            if chunk.get("type") == "audio":
                audio.extend(chunk["data"])
        if not audio:
            raise RuntimeError("voice provider returned no audio")
        return Response(content=bytes(audio), media_type="audio/mpeg", headers={"Cache-Control": "no-store"})
    except HTTPException:
        raise
    except Exception as exc:
        log.warning("Voice generation failed: %s", exc)
        raise HTTPException(503, "Voice generation is temporarily unavailable") from exc


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

    @property
    def active(self) -> bool:
        return self.status in ("queued", "running")

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


def _kill_tree(proc: subprocess.Popen) -> None:
    # venv launchers on Windows spawn the real interpreter as a child: kill the whole tree
    if os.name == "nt":
        subprocess.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"], capture_output=True)
    else:
        proc.kill()


def _run_job(job: Job) -> None:
    job.status = "running"
    job.message = "Rendering frames"
    job.started_at = time.time()
    env = {**os.environ, "MPLBACKEND": "Agg", "PYTHONIOENCODING": "utf-8", "PYTHONUNBUFFERED": "1"}
    cmd = [sys.executable, str(WORKER), str(job.dir / "plan.json"), str(job.dir / "options.json"), str(job.dir / "output.mp4")]
    log_lines: deque[str] = deque(maxlen=60)
    try:
        # CREATE_NO_WINDOW: without a console the worker can fail DLL init (0xC0000142) on Windows
        flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        job.proc = subprocess.Popen(cmd, cwd=str(ROOT), env=env, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace", creationflags=flags)
        assert job.proc.stdout is not None
        for line in job.proc.stdout:
            line = line.rstrip()
            # the engine's own carriage-return progress bar can prefix our markers on a line
            m = PROGRESS_RE.search(line)
            if m:
                job.frame, job.total_frames = int(m.group(1)), int(m.group(2))
                if job.frame >= job.total_frames:
                    job.message = "Encoding"
                continue
            m = STAGE_RE.search(line)
            if m:
                job.message = m.group(1)
            elif line.strip() and "█" not in line and "░" not in line:
                log_lines.append(line)
        code = job.proc.wait()
        if job.cancel_requested:
            job.status, job.message = "cancelled", "Cancelled"
        elif code == 0 and (job.dir / "output.mp4").exists():
            job.status, job.message = "done", "Done"
            job.frame = job.total_frames
            log.info("render %s done in %.1fs", job.id, time.time() - job.started_at)
        else:
            details = "\n".join(list(log_lines)[-25:]) or f"worker exited with {code}"
            log.error("render %s failed (exit %s):\n%s", job.id, code, details)
            job.status, job.message = "error", "Failed"
            # never leak server paths / tracebacks to the public in production
            job.error = "Rendering failed. Please try again or simplify the project." if SETTINGS.is_production else details
    except Exception:  # pragma: no cover - defensive
        log.exception("render %s crashed", job.id)
        job.status, job.message = "error", "Failed"
        job.error = "Rendering failed unexpectedly."
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


def _cleanup_loop() -> None:
    """Delete finished renders (files + job records) older than the retention window."""
    while True:
        time.sleep(600)
        cutoff = time.time() - SETTINGS.render_retention_hours * 3600
        with LOCK:
            stale = [j for j in JOBS.values() if not j.active and (j.finished_at or j.created_at) < cutoff]
            for j in stale:
                JOBS.pop(j.id, None)
        for d in RENDERS.iterdir():
            try:
                if d.is_dir() and d.name not in JOBS and d.stat().st_mtime < cutoff:
                    shutil.rmtree(d, ignore_errors=True)
            except OSError:
                pass


threading.Thread(target=_worker_loop, daemon=True, name="render-queue").start()
threading.Thread(target=_cleanup_loop, daemon=True, name="render-cleanup").start()


# ------------------------------------------------------------------ health


def _workspace_writable() -> bool:
    probe = RENDERS / ".write-test"
    try:
        probe.write_text("ok", encoding="utf-8")
        probe.unlink()
        return True
    except OSError:
        return False


@app.get("/api/health")
def health():
    ffmpeg = resolve_ffmpeg()
    writable = _workspace_writable()
    ok = bool(ffmpeg) and writable
    body = {
        "ok": ok,
        "service": f"{SETTINGS.app_name} render API",
        "env": SETTINGS.env,
        "version": tradeanim.__version__,
        "ffmpeg": bool(ffmpeg) if SETTINGS.is_production else ffmpeg,
        "workspaceWritable": writable,
        "projectStorage": SETTINGS.project_storage,
        "queued": len(QUEUE),
        "running": sum(1 for j in JOBS.values() if j.status == "running"),
        "uptime": round(time.time() - STARTED_AT, 1),
        "limits": {"maxSeconds": SETTINGS.max_duration_s, "maxPixels": SETTINGS.max_pixels, "maxFps": SETTINGS.max_fps},
    }
    return JSONResponse(body, status_code=200 if ok else 503)


# ------------------------------------------------------------------ render


@app.post("/api/render")
def start_render(req: RenderRequest):
    plan = req.plan
    if plan.get("format") != "tradeanim.renderplan":
        raise HTTPException(422, "body.plan must be a render plan (compileRenderPlan output)")
    o = req.options
    if o.width * o.height > SETTINGS.max_pixels:
        raise HTTPException(422, "resolution too large for this server")
    if o.fps > SETTINGS.max_fps:
        raise HTTPException(422, f"fps above the server limit ({SETTINGS.max_fps})")
    try:
        duration = float(plan.get("settings", {}).get("duration", 0))
    except (TypeError, ValueError):
        raise HTTPException(422, "plan.settings.duration must be a number")
    if not 0 < duration <= SETTINGS.max_duration_s:
        raise HTTPException(422, f"duration must be within (0, {SETTINGS.max_duration_s:g}] seconds")
    with LOCK:
        if len(QUEUE) >= SETTINGS.max_queue:
            raise HTTPException(429, "Render queue is full, please retry shortly")
    job = Job(secrets.token_hex(SETTINGS.job_id_bytes), int(duration * o.fps))
    job.dir.mkdir(parents=True, exist_ok=True)
    (job.dir / "plan.json").write_text(json.dumps(plan), encoding="utf-8")
    (job.dir / "options.json").write_text(o.model_dump_json(), encoding="utf-8")
    if req.project is not None and not SETTINGS.is_production:
        (job.dir / "project.json").write_text(json.dumps(req.project), encoding="utf-8")
    with LOCK:
        JOBS[job.id] = job
        QUEUE.append(job.id)
        job.message = f"Queued ({len(QUEUE) - 1} ahead)" if len(QUEUE) > 1 else "Starting"
    WAKE.set()
    log.info("render %s queued: %dx%d@%d, %.1fs", job.id, o.width, o.height, o.fps, duration)
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
        _kill_tree(job.proc)
    return job.to_dict()


@app.get("/api/renders/{job_id}.mp4")
def video(job_id: str, request: Request):
    path = RENDERS / _check_id(job_id) / "output.mp4"
    if not path.exists():
        raise HTTPException(404, "video not found")
    download = "download" in request.query_params
    return FileResponse(
        path,
        media_type="video/mp4",
        filename=f"algoliquid-studio-{job_id[:8]}.mp4" if download else None,
        headers={"Cache-Control": "private, max-age=3600"},
    )


# ------------------------------------------------------------------ projects


def _require_storage() -> None:
    if not SETTINGS.project_storage:
        raise HTTPException(404, "server-side project storage is disabled")


@app.get("/api/projects")
def list_projects():
    _require_storage()
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
    _require_storage()
    path = PROJECTS / f"{_check_id(project_id)}.json"
    if not path.exists():
        raise HTTPException(404, "project not found")
    return json.loads(path.read_text(encoding="utf-8"))


@app.put("/api/projects/{project_id}")
async def save_project(project_id: str, request: Request):
    _require_storage()
    _check_id(project_id)
    try:
        doc = await request.json()
    except json.JSONDecodeError:
        raise HTTPException(422, "body must be JSON")
    if not isinstance(doc, dict) or doc.get("schema") != "tradeanim.project":
        raise HTTPException(422, "not a project document")
    path = PROJECTS / f"{project_id}.json"
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(doc, indent=1), encoding="utf-8")
    tmp.replace(path)
    return {"id": project_id, "path": f"workspace/projects/{project_id}.json"}


@app.delete("/api/projects/{project_id}")
def delete_project(project_id: str):
    _require_storage()
    path = PROJECTS / f"{_check_id(project_id)}.json"
    if path.exists():
        path.unlink()
    return {"ok": True}


log.info("%s render API ready (env=%s, origins=%s, workspace=%s, project storage=%s)", SETTINGS.app_name, SETTINGS.env, SETTINGS.allowed_origins, WORKSPACE, SETTINGS.project_storage)
