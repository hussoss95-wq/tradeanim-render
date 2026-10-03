"""Render API: health, CORS, error handling, project storage, render job lifecycle."""

import json
import sys
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[3]
PLAN = json.loads((ROOT / "tests" / "fixtures" / "parity.json").read_text(encoding="utf-8"))["plan"]


def make_client(tmp_path, monkeypatch, **env):
    monkeypatch.setenv("WORKSPACE_DIR", str(tmp_path))
    for k in ("APP_ENV", "ALLOWED_ORIGINS", "PROJECT_STORAGE_ENABLED", "MAX_RENDER_SECONDS", "MAX_REQUEST_MB"):
        monkeypatch.delenv(k, raising=False)
    for k, v in env.items():
        monkeypatch.setenv(k, v)
    api_dir = str(ROOT / "services" / "render-api")
    if api_dir not in sys.path:
        sys.path.insert(0, api_dir)
    for mod in ("app", "settings"):
        sys.modules.pop(mod, None)
    import app  # noqa: WPS433 - imported after env is set

    return TestClient(app.app, raise_server_exceptions=False), app


@pytest.fixture()
def client(tmp_path, monkeypatch):
    return make_client(tmp_path, monkeypatch)[0]


@pytest.fixture()
def prod(tmp_path, monkeypatch):
    return make_client(tmp_path, monkeypatch, APP_ENV="production")


def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True and body["env"] == "development" and body["workspaceWritable"] is True
    assert r.headers["x-request-id"]


def test_dev_cors_allows_localhost(client):
    r = client.options("/api/render", headers={"Origin": "http://localhost:3000", "Access-Control-Request-Method": "POST"})
    assert r.headers.get("access-control-allow-origin") == "http://localhost:3000"


def test_production_cors_only_allows_studio_domain(prod):
    client, _ = prod
    ok = client.get("/api/health", headers={"Origin": "https://studio.algoliquid.com"})
    assert ok.headers.get("access-control-allow-origin") == "https://studio.algoliquid.com"
    bad = client.get("/api/health", headers={"Origin": "http://localhost:3000"})
    assert "access-control-allow-origin" not in bad.headers
    pre = client.options("/api/render", headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "POST"})
    assert pre.status_code == 400


def test_allowed_origins_are_configurable(tmp_path, monkeypatch):
    client, app = make_client(tmp_path, monkeypatch, APP_ENV="production", ALLOWED_ORIGINS="https://a.example, https://b.example/")
    assert app.SETTINGS.allowed_origins == ["https://a.example", "https://b.example"]
    r = client.get("/api/health", headers={"Origin": "https://b.example"})
    assert r.headers.get("access-control-allow-origin") == "https://b.example"


def test_production_hides_docs_paths_and_project_storage(prod):
    client, _ = prod
    assert client.get("/api/docs").status_code == 404
    assert client.get("/api/projects").status_code == 404
    health = client.get("/api/health").json()
    assert health["projectStorage"] is False and isinstance(health["ffmpeg"], bool)


def test_project_roundtrip(client):
    doc = {"schema": "tradeanim.project", "version": 1, "id": "prj_test", "name": "T", "settings": {"aspect": "16:9", "duration": 5}}
    r = client.put("/api/projects/prj_test", json=doc)
    assert r.status_code == 200 and r.json()["path"] == "workspace/projects/prj_test.json"
    assert [p["id"] for p in client.get("/api/projects").json()] == ["prj_test"]
    assert client.get("/api/projects/prj_test").json()["name"] == "T"
    assert client.put("/api/projects/bad", json={"nope": 1}).status_code == 422
    assert client.get("/api/projects/..%2Fsecrets").status_code in (400, 404)
    client.delete("/api/projects/prj_test")
    assert client.get("/api/projects").json() == []


def test_errors_are_json_with_request_id(client):
    r = client.post("/api/render", json={"plan": {"format": "nope"}})
    assert r.status_code == 422 and r.json()["requestId"]
    r = client.post("/api/render", content=b"{not json", headers={"content-type": "application/json"})
    assert r.status_code == 422 and "detail" in r.json()


def test_unhandled_errors_return_500_json(prod, monkeypatch):
    client, app = prod

    def boom():
        raise RuntimeError("secret internals")

    monkeypatch.setattr(app, "resolve_ffmpeg", boom)
    r = client.get("/api/health")
    assert r.status_code == 500
    assert r.json()["detail"] == "Internal server error" and "secret" not in r.text


def test_body_size_limit(tmp_path, monkeypatch):
    client, _ = make_client(tmp_path, monkeypatch, MAX_REQUEST_MB="1")
    r = client.post("/api/render", content=b"x" * (2 * 1024 * 1024), headers={"content-type": "application/json"})
    assert r.status_code == 413


def test_render_limits(tmp_path, monkeypatch):
    client, _ = make_client(tmp_path, monkeypatch, MAX_RENDER_SECONDS="1")
    plan = json.loads(json.dumps(PLAN))
    plan["settings"]["duration"] = 5
    r = client.post("/api/render", json={"plan": plan, "options": {"width": 160, "height": 90, "fps": 6}})
    assert r.status_code == 422


def test_render_job_completes(client):
    plan = json.loads(json.dumps(PLAN))
    plan["settings"]["duration"] = 0.5
    job = client.post("/api/render", json={"plan": plan, "options": {"width": 160, "height": 90, "fps": 6, "quality": "draft"}}).json()
    deadline = time.time() + 120
    while time.time() < deadline:
        job = client.get(f"/api/render/{job['id']}").json()
        if job["status"] in ("done", "error", "cancelled"):
            break
        time.sleep(0.5)
    assert job["status"] == "done", job.get("error")
    assert job["frame"] == job["totalFrames"] == 3
    video = client.get(job["url"])
    assert video.status_code == 200 and len(video.content) > 0
    ranged = client.get(job["url"], headers={"Range": "bytes=0-99"})
    assert ranged.status_code == 206 and len(ranged.content) == 100
    dl = client.get(job["url"] + "?download=1")
    assert "algoliquid-studio-" in dl.headers["content-disposition"]
