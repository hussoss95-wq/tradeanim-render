"""AlgoLiquid Studio render API.

Bridges the web editor and the Python tradeanim engine:

  GET  /api/health            liveness + readiness (ffmpeg, workspace, queue)
  POST /api/render            render plan (+ options) -> job, rendered in a worker process
  GET  /api/render/{id}       job status / progress
  POST /api/render/{id}/cancel
  GET  /api/renders/{id}.mp4  rendered video (Range requests supported)
  GET/PUT/DELETE /api/projects[/{id}]   authenticated cloud projects

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
from auth import (
    CSRF_COOKIE,
    SESSION_COOKIE,
    Store,
    clear_session_cookies,
    current_user,
    require_csrf,
    require_user,
    require_verified_user,
    set_session_cookies,
    validate_password,
)
from director_api import understand as understand_director_brief
from mailer import send_action_email

sys.path.insert(0, str(ROOT))

import tradeanim  # noqa: E402
from tradeanim.renderer import resolve_ffmpeg  # noqa: E402

SETTINGS = load_settings()
log = logging.getLogger("algoliquid.render_api")
logging.basicConfig(level=getattr(logging, SETTINGS.log_level.upper(), logging.INFO), format="%(asctime)s %(levelname)s %(name)s: %(message)s")

WORKSPACE = SETTINGS.workspace
RENDERS = WORKSPACE / "renders"
for d in (RENDERS,):
    d.mkdir(parents=True, exist_ok=True)

ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,80}$")
PROGRESS_RE = re.compile(r"PROGRESS (\d+)/(\d+)")
STAGE_RE = re.compile(r"STAGE (.+)$")
WORKER = Path(__file__).with_name("worker.py")
STARTED_AT = time.time()
STORE = Store(SETTINGS.auth_db)

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
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Range", "X-Request-ID", "X-CSRF-Token"],
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
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    if request.url.path.startswith("/api/auth"):
        response.headers["Cache-Control"] = "no-store"
    if SETTINGS.is_production:
        response.headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains"
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


class WindowLimiter:
    """Small single-instance limiter; production already runs one API worker."""

    def __init__(self):
        self.lock = threading.Lock()
        self.events: dict[str, deque[float]] = {}

    def check(self, key: str, limit: int, seconds: int = 3600) -> None:
        now = time.time()
        with self.lock:
            q = self.events.setdefault(key, deque())
            while q and q[0] <= now - seconds:
                q.popleft()
            if len(q) >= limit:
                raise HTTPException(429, "Usage limit reached; please try again later")
            q.append(now)


LIMITER = WindowLimiter()


def _actor(request: Request, action: str, limit: int, mutation: bool = False):
    user = current_user(request, STORE)
    if SETTINGS.auth_required and not user:
        raise HTTPException(401, "Sign in to continue")
    if user and SETTINGS.email_verification_required and not user.verified:
        raise HTTPException(403, "Verify your email to continue")
    if user and mutation:
        require_csrf(request, STORE)
    identity = user.id if user else (request.client.host if request.client else "anonymous")
    LIMITER.check(f"{action}:{identity}", limit)
    return user


# ------------------------------------------------------------------ accounts


class Credentials(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=10, max_length=128)
    name: str = Field("", max_length=80)


def _user_body(user) -> dict[str, Any]:
    return {"id": user.id, "email": user.email, "name": user.name, "verified": user.verified}


def _send_account_action(user, kind: str) -> None:
    ttl = 24 * 60 * 60 if kind == "verify" else 30 * 60
    token = STORE.issue_action(user.id, kind, ttl)
    send_action_email(SETTINGS, recipient=user.email, name=user.name, kind=kind, token=token)


@app.post("/api/auth/register")
def register(req: Credentials, request: Request):
    LIMITER.check(f"register:{request.client.host if request.client else 'unknown'}", 8)
    if SETTINGS.email_verification_required and not SETTINGS.email_configured:
        raise HTTPException(503, "Account email is not configured")
    validate_password(req.password)
    user = STORE.create_user(req.email, req.name, req.password)
    try:
        _send_account_action(user, "verify")
    except Exception as exc:
        STORE.purge_user(user.id)
        log.exception("Could not send registration verification email")
        raise HTTPException(503, "Could not send verification email; please try again") from exc
    token, csrf = STORE.create_session(user.id, SETTINGS.session_ttl_seconds)
    response = JSONResponse({"user": _user_body(user), "csrfToken": csrf}, status_code=201)
    set_session_cookies(response, token, csrf, SETTINGS.is_production, SETTINGS.session_ttl_seconds)
    return response


@app.post("/api/auth/login")
def login(req: Credentials, request: Request):
    LIMITER.check(f"login:{request.client.host if request.client else 'unknown'}", 20)
    user = STORE.authenticate(req.email, req.password)
    if not user:
        raise HTTPException(401, "Email or password is incorrect")
    token, csrf = STORE.create_session(user.id, SETTINGS.session_ttl_seconds)
    response = JSONResponse({"user": _user_body(user), "csrfToken": csrf})
    set_session_cookies(response, token, csrf, SETTINGS.is_production, SETTINGS.session_ttl_seconds)
    return response


@app.get("/api/auth/me")
def me(request: Request):
    user = current_user(request, STORE)
    if not user:
        raise HTTPException(401, "Not signed in")
    return {"user": _user_body(user), "csrfToken": request.cookies.get(CSRF_COOKIE, "")}


@app.post("/api/auth/logout")
def logout(request: Request):
    user = current_user(request, STORE)
    if user:
        require_csrf(request, STORE)
    STORE.revoke(request.cookies.get(SESSION_COOKIE, ""))
    response = JSONResponse({"ok": True})
    clear_session_cookies(response, SETTINGS.is_production)
    return response


class EmailRequest(BaseModel):
    email: str = Field(min_length=3, max_length=254)


class TokenRequest(BaseModel):
    token: str = Field(min_length=20, max_length=200)


class ResetPasswordRequest(TokenRequest):
    password: str = Field(min_length=10, max_length=128)


class ChangePasswordRequest(BaseModel):
    currentPassword: str = Field(min_length=1, max_length=128)
    newPassword: str = Field(min_length=10, max_length=128)


class DeleteAccountRequest(BaseModel):
    password: str = Field(min_length=1, max_length=128)


@app.post("/api/auth/email/verify/request")
def request_verification(request: Request):
    user = require_user(request, STORE)
    require_csrf(request, STORE)
    LIMITER.check(f"verify-email:{user.id}", 5)
    if user.verified:
        return {"ok": True, "alreadyVerified": True}
    if SETTINGS.email_verification_required and not SETTINGS.email_configured:
        raise HTTPException(503, "Account email is not configured")
    _send_account_action(user, "verify")
    return {"ok": True}


@app.post("/api/auth/email/verify/confirm")
def confirm_verification(req: TokenRequest):
    user = STORE.consume_verification(req.token)
    if not user:
        raise HTTPException(400, "Verification link is invalid or expired")
    return {"ok": True}


@app.post("/api/auth/password/forgot")
def forgot_password(req: EmailRequest, request: Request):
    LIMITER.check(f"forgot:{request.client.host if request.client else 'unknown'}", 8)
    user = STORE.user_by_email(req.email)
    if user:
        try:
            _send_account_action(user, "reset")
        except Exception:
            log.exception("Could not send password reset email")
    # The response is intentionally identical for existing and unknown emails.
    return {"ok": True, "message": "If that account exists, a reset link has been sent"}


@app.post("/api/auth/password/reset")
def reset_password(req: ResetPasswordRequest):
    validate_password(req.password)
    if not STORE.reset_password(req.token, req.password):
        raise HTTPException(400, "Reset link is invalid or expired")
    return {"ok": True}


@app.post("/api/auth/password/change")
def change_password(req: ChangePasswordRequest, request: Request):
    user = require_user(request, STORE)
    require_csrf(request, STORE)
    if not STORE.change_password(user.id, req.currentPassword, req.newPassword):
        raise HTTPException(401, "Current password is incorrect")
    response = JSONResponse({"ok": True})
    clear_session_cookies(response, SETTINGS.is_production)
    return response


@app.delete("/api/auth/account")
def delete_account(req: DeleteAccountRequest, request: Request):
    user = require_user(request, STORE)
    require_csrf(request, STORE)
    if not STORE.delete_account(user.id, req.password):
        raise HTTPException(401, "Password is incorrect")
    response = JSONResponse({"ok": True})
    clear_session_cookies(response, SETTINGS.is_production)
    return response


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
async def create_voice(req: VoiceRequest, request: Request):
    """Generate a compact MP3 voice-over for an AI Director project."""
    _actor(request, "voice", SETTINGS.voice_per_hour, mutation=True)
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


class DirectorRequest(BaseModel):
    prompt: str = Field(min_length=3, max_length=4000)
    overrides: dict[str, Any] = Field(default_factory=dict)


@app.post("/api/director/understand")
async def director_understand(req: DirectorRequest, request: Request):
    _actor(request, "director", SETTINGS.director_per_hour, mutation=True)
    return await understand_director_brief(req.prompt.strip(), req.overrides)


class Job:
    def __init__(self, job_id: str, total_frames: int, owner_id: str | None = None):
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
        self.owner_id = owner_id

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
    email_ready = not SETTINGS.email_verification_required or SETTINGS.email_configured
    ok = bool(ffmpeg) and writable and email_ready
    body = {
        "ok": ok,
        "service": f"{SETTINGS.app_name} render API",
        "env": SETTINGS.env,
        "version": tradeanim.__version__,
        "ffmpeg": bool(ffmpeg) if SETTINGS.is_production else ffmpeg,
        "workspaceWritable": writable,
        "projectStorage": True,
        "authentication": SETTINGS.auth_required,
        "emailVerification": SETTINGS.email_verification_required,
        "emailReady": email_ready,
        "queued": len(QUEUE),
        "running": sum(1 for j in JOBS.values() if j.status == "running"),
        "uptime": round(time.time() - STARTED_AT, 1),
        "limits": {"maxSeconds": SETTINGS.max_duration_s, "maxPixels": SETTINGS.max_pixels, "maxFps": SETTINGS.max_fps},
    }
    return JSONResponse(body, status_code=200 if ok else 503)


# ------------------------------------------------------------------ render


@app.post("/api/render")
def start_render(req: RenderRequest, request: Request):
    user = _actor(request, "render", SETTINGS.render_per_hour, mutation=True)
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
    job = Job(secrets.token_hex(SETTINGS.job_id_bytes), int(duration * o.fps), user.id if user else None)
    job.dir.mkdir(parents=True, exist_ok=True)
    (job.dir / "plan.json").write_text(json.dumps(plan), encoding="utf-8")
    (job.dir / "options.json").write_text(o.model_dump_json(), encoding="utf-8")
    if user:
        (job.dir / "owner.txt").write_text(user.id, encoding="utf-8")
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
def job_status(job_id: str, request: Request):
    user = _actor(request, "status", 600)
    job = JOBS.get(_check_id(job_id))
    if not job:
        raise HTTPException(404, "job not found")
    if job.owner_id and (not user or job.owner_id != user.id):
        raise HTTPException(404, "job not found")
    return job.to_dict()


@app.post("/api/render/{job_id}/cancel")
def cancel(job_id: str, request: Request):
    user = _actor(request, "cancel", 120, mutation=True)
    job = JOBS.get(_check_id(job_id))
    if not job:
        raise HTTPException(404, "job not found")
    if job.owner_id and (not user or job.owner_id != user.id):
        raise HTTPException(404, "job not found")
    job.cancel_requested = True
    if job.proc and job.proc.poll() is None:
        _kill_tree(job.proc)
    return job.to_dict()


@app.get("/api/renders/{job_id}.mp4")
def video(job_id: str, request: Request):
    user = _actor(request, "download", 300)
    checked_id = _check_id(job_id)
    job = JOBS.get(checked_id)
    if job and job.owner_id and (not user or job.owner_id != user.id):
        raise HTTPException(404, "video not found")
    owner_path = RENDERS / checked_id / "owner.txt"
    if owner_path.exists() and (not user or owner_path.read_text(encoding="utf-8") != user.id):
        raise HTTPException(404, "video not found")
    path = RENDERS / checked_id / "output.mp4"
    if not path.exists():
        raise HTTPException(404, "video not found")
    download = "download" in request.query_params
    return FileResponse(
        path,
        media_type="video/mp4",
        filename=f"algoliquid-studio-{job_id[:8]}.mp4" if download else None,
        headers={"Cache-Control": "private, max-age=3600"},
    )


@app.get("/api/projects")
def list_projects(request: Request):
    user = require_verified_user(request, STORE, SETTINGS.email_verification_required)
    return STORE.list_projects(user.id)


@app.get("/api/projects/{project_id}")
def get_project(project_id: str, request: Request):
    user = require_verified_user(request, STORE, SETTINGS.email_verification_required)
    doc = STORE.get_project(user.id, _check_id(project_id))
    if doc is None:
        raise HTTPException(404, "project not found")
    return doc


@app.put("/api/projects/{project_id}")
async def save_project(project_id: str, request: Request):
    user = require_verified_user(request, STORE, SETTINGS.email_verification_required)
    require_csrf(request, STORE)
    _check_id(project_id)
    try:
        doc = await request.json()
    except json.JSONDecodeError:
        raise HTTPException(422, "body must be JSON")
    if not isinstance(doc, dict) or doc.get("schema") != "tradeanim.project":
        raise HTTPException(422, "not a project document")
    if doc.get("id") != project_id:
        raise HTTPException(422, "project id does not match URL")
    STORE.save_project(user.id, project_id, doc)
    return {"id": project_id, "path": "cloud"}


@app.delete("/api/projects/{project_id}")
def delete_project(project_id: str, request: Request):
    user = require_verified_user(request, STORE, SETTINGS.email_verification_required)
    require_csrf(request, STORE)
    STORE.delete_project(user.id, _check_id(project_id))
    return {"ok": True}


log.info("%s render API ready (env=%s, origins=%s, workspace=%s, auth=%s)", SETTINGS.app_name, SETTINGS.env, SETTINGS.allowed_origins, WORKSPACE, SETTINGS.auth_required)
