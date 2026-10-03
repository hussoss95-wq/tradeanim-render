"""Environment-driven configuration for the AlgoLiquid Studio render API.

Every value can be set through an environment variable (see /.env.example).
`APP_ENV=production` switches the secure defaults on; development defaults
keep `npm run dev` working with no configuration.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

DEV_ORIGINS = ["http://localhost:3000", "http://127.0.0.1:3000"]
PROD_ORIGINS = ["https://studio.algoliquid.com"]


def _bool(name: str, default: bool) -> bool:
    v = os.environ.get(name)
    if v is None or v == "":
        return default
    return v.strip().lower() in ("1", "true", "yes", "on")


def _int(name: str, default: int) -> int:
    v = os.environ.get(name)
    return int(v) if v not in (None, "") else default


def _float(name: str, default: float) -> float:
    v = os.environ.get(name)
    return float(v) if v not in (None, "") else default


def _list(name: str, default: list[str]) -> list[str]:
    v = os.environ.get(name)
    if v is None or v.strip() == "":
        return list(default)
    return [x.strip().rstrip("/") for x in v.split(",") if x.strip()]


@dataclass(frozen=True)
class Settings:
    env: str
    app_name: str
    allowed_origins: list[str]
    workspace: Path
    project_storage: bool
    max_duration_s: float
    max_pixels: int
    max_fps: int
    max_body_bytes: int
    max_queue: int
    render_retention_hours: float
    job_id_bytes: int
    log_level: str
    docs_enabled: bool = field(default=True)

    @property
    def is_production(self) -> bool:
        return self.env == "production"


def load_settings() -> Settings:
    env = (os.environ.get("APP_ENV") or "development").strip().lower()
    if env not in ("development", "production", "test"):
        raise ValueError(f"APP_ENV must be development, production or test (got {env!r})")
    prod = env == "production"
    return Settings(
        env=env,
        app_name="AlgoLiquid Studio",
        allowed_origins=_list("ALLOWED_ORIGINS", PROD_ORIGINS if prod else DEV_ORIGINS),
        workspace=Path(os.environ.get("WORKSPACE_DIR") or os.environ.get("TRADEANIM_WORKSPACE") or (ROOT / "workspace")).resolve(),
        # No authentication yet: shared server-side project storage is a dev convenience only.
        project_storage=_bool("PROJECT_STORAGE_ENABLED", not prod),
        max_duration_s=_float("MAX_RENDER_SECONDS", 120.0 if prod else 600.0),
        max_pixels=_int("MAX_RENDER_PIXELS", 1920 * 1920 if prod else 3840 * 2160),
        max_fps=_int("MAX_RENDER_FPS", 60),
        max_body_bytes=_int("MAX_REQUEST_MB", 40) * 1024 * 1024,
        max_queue=_int("MAX_QUEUED_RENDERS", 20),
        render_retention_hours=_float("RENDER_RETENTION_HOURS", 24.0),
        job_id_bytes=16 if prod else 6,
        log_level=(os.environ.get("LOG_LEVEL") or ("info" if prod else "debug")).lower(),
        docs_enabled=_bool("API_DOCS_ENABLED", not prod),
    )
