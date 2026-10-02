"""Render API: health, project storage, render job lifecycle."""

import json
import sys
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[3]


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("TRADEANIM_WORKSPACE", str(tmp_path))
    sys.path.insert(0, str(ROOT / "services" / "render-api"))
    sys.modules.pop("app", None)
    import app  # noqa: WPS433 - imported after env is set

    return TestClient(app.app)


def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200 and r.json()["ok"] is True


def test_project_roundtrip(client):
    doc = {"schema": "tradeanim.project", "version": 1, "id": "prj_test", "name": "T", "settings": {"aspect": "16:9", "duration": 5}}
    assert client.put("/api/projects/prj_test", json=doc).status_code == 200
    assert [p["id"] for p in client.get("/api/projects").json()] == ["prj_test"]
    assert client.get("/api/projects/prj_test").json()["name"] == "T"
    assert client.put("/api/projects/bad", json={"nope": 1}).status_code == 422
    assert client.get("/api/projects/..%2Fsecrets").status_code in (400, 404)
    client.delete("/api/projects/prj_test")
    assert client.get("/api/projects").json() == []


def test_render_rejects_non_plans(client):
    assert client.post("/api/render", json={"plan": {"format": "nope"}}).status_code == 422


def test_render_job_completes(client):
    plan = json.loads((ROOT / "tests" / "fixtures" / "parity.json").read_text(encoding="utf-8"))["plan"]
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
