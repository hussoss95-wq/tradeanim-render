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
    for k in (
        "APP_ENV", "ALLOWED_ORIGINS", "AUTH_REQUIRED", "AUTH_DB_PATH", "OPENAI_API_KEY",
        "EMAIL_VERIFICATION_REQUIRED", "SMTP_HOST", "SMTP_FROM", "SMTP_USER", "SMTP_PASSWORD",
        "MAX_RENDER_SECONDS", "MAX_REQUEST_MB",
    ):
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


def register(client, email="user@example.com", password="securepass123"):
    r = client.post("/api/auth/register", json={"email": email, "password": password, "name": "Test User"})
    assert r.status_code == 201, r.text
    return r.json()["csrfToken"]


def csrf_headers(token):
    return {"x-csrf-token": token}


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


def test_voice_rejects_unknown_voice(client):
    r = client.post("/api/voice", json={"text": "hello", "voice": "unknown"})
    assert r.status_code == 400


def test_voice_rejects_empty_text(client):
    r = client.post("/api/voice", json={"text": "", "voice": "en-US-GuyNeural"})
    assert r.status_code == 422


def test_dev_cors_allows_localhost(client):
    r = client.options("/api/render", headers={"Origin": "http://localhost:3000", "Access-Control-Request-Method": "POST"})
    assert r.headers.get("access-control-allow-origin") == "http://localhost:3000"


def test_production_cors_only_allows_studio_domain(prod):
    client, _ = prod
    ok = client.get("/api/health", headers={"Origin": "https://studio.algo-liquid.com"})
    assert ok.headers.get("access-control-allow-origin") == "https://studio.algo-liquid.com"
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
    assert client.get("/api/projects").status_code == 401
    health = client.get("/api/health").json()
    assert health["projectStorage"] is True and health["authentication"] is True and isinstance(health["ffmpeg"], bool)


@pytest.mark.parametrize(
    ("path", "body"),
    [
        ("/api/render", {"plan": PLAN}),
        ("/api/voice", {"text": "hello", "voice": "en-US-GuyNeural"}),
        ("/api/director/understand", {"prompt": "make a trading video"}),
    ],
)
def test_production_protects_expensive_endpoints(prod, path, body):
    client, _ = prod
    assert client.post(path, json=body).status_code == 401


def test_project_roundtrip(client):
    csrf = register(client)
    doc = {"schema": "tradeanim.project", "version": 1, "id": "prj_test", "name": "T", "settings": {"aspect": "16:9", "duration": 5}}
    r = client.put("/api/projects/prj_test", json=doc, headers=csrf_headers(csrf))
    assert r.status_code == 200 and r.json()["path"] == "cloud"
    assert [p["id"] for p in client.get("/api/projects").json()] == ["prj_test"]
    assert client.get("/api/projects/prj_test").json()["name"] == "T"
    assert client.put("/api/projects/bad", json={"nope": 1}, headers=csrf_headers(csrf)).status_code == 422
    assert client.get("/api/projects/..%2Fsecrets").status_code in (400, 404)
    client.delete("/api/projects/prj_test", headers=csrf_headers(csrf))
    assert client.get("/api/projects").json() == []


def test_accounts_sessions_csrf_and_project_isolation(client):
    csrf = register(client, "one@example.com")
    assert client.get("/api/auth/me").json()["user"]["email"] == "one@example.com"
    doc = {"schema": "tradeanim.project", "version": 1, "id": "private", "name": "Private", "updatedAt": "2026-10-04", "settings": {"aspect": "9:16", "duration": 20}}
    assert client.put("/api/projects/private", json=doc).status_code == 403
    assert client.put("/api/projects/different", json=doc, headers=csrf_headers(csrf)).status_code == 422
    assert client.put("/api/projects/private", json=doc, headers=csrf_headers(csrf)).status_code == 200
    assert client.post("/api/auth/logout", headers=csrf_headers(csrf)).status_code == 200
    csrf2 = register(client, "two@example.com")
    assert client.get("/api/projects/private").status_code == 404
    assert client.get("/api/projects").json() == []
    assert client.post("/api/auth/logout", headers=csrf_headers(csrf2)).status_code == 200


def test_login_rejects_bad_password_and_duplicate_account(client):
    register(client)
    assert client.post("/api/auth/login", json={"email": "user@example.com", "password": "wrongpass123"}).status_code == 401
    assert client.post("/api/auth/register", json={"email": "USER@example.com", "password": "securepass123", "name": "Again"}).status_code == 409


def test_email_verification_is_one_time(client):
    import app

    register(client)
    user = app.STORE.user_by_email("user@example.com")
    assert user and user.verified is False
    token = app.STORE.issue_action(user.id, "verify", 60)
    r = client.post("/api/auth/email/verify/confirm", json={"token": token})
    assert r.status_code == 200
    assert client.post("/api/auth/email/verify/confirm", json={"token": token}).status_code == 400
    assert client.get("/api/auth/me").json()["user"]["verified"] is True
    expired = app.STORE.issue_action(user.id, "verify", -1)
    assert client.post("/api/auth/email/verify/confirm", json={"token": expired}).status_code == 400


def test_password_reset_revokes_sessions_and_token(client):
    import app

    register(client)
    user = app.STORE.user_by_email("user@example.com")
    token = app.STORE.issue_action(user.id, "reset", 60)
    r = client.post("/api/auth/password/reset", json={"token": token, "password": "newsecure123"})
    assert r.status_code == 200
    assert client.get("/api/auth/me").status_code == 401
    assert client.post("/api/auth/password/reset", json={"token": token, "password": "another123x"}).status_code == 400
    assert client.post("/api/auth/login", json={"email": "user@example.com", "password": "securepass123"}).status_code == 401
    assert client.post("/api/auth/login", json={"email": "user@example.com", "password": "newsecure123"}).status_code == 200


def test_change_password_and_delete_account(client):
    csrf = register(client)
    assert client.post("/api/auth/password/change", json={"currentPassword": "wrong", "newPassword": "newsecure123"}, headers=csrf_headers(csrf)).status_code == 401
    assert client.post("/api/auth/password/change", json={"currentPassword": "securepass123", "newPassword": "newsecure123"}, headers=csrf_headers(csrf)).status_code == 200
    login = client.post("/api/auth/login", json={"email": "user@example.com", "password": "newsecure123"})
    csrf = login.json()["csrfToken"]
    assert client.request("DELETE", "/api/auth/account", json={"password": "wrong"}, headers=csrf_headers(csrf)).status_code == 401
    assert client.request("DELETE", "/api/auth/account", json={"password": "newsecure123"}, headers=csrf_headers(csrf)).status_code == 200
    assert client.post("/api/auth/login", json={"email": "user@example.com", "password": "newsecure123"}).status_code == 401


def test_forgot_password_does_not_reveal_accounts(client):
    known = client.post("/api/auth/password/forgot", json={"email": "known@example.com"})
    unknown = client.post("/api/auth/password/forgot", json={"email": "unknown@example.com"})
    assert known.status_code == unknown.status_code == 200
    assert known.json() == unknown.json()


def test_verification_required_blocks_cloud_features(tmp_path, monkeypatch):
    client, app = make_client(
        tmp_path, monkeypatch, EMAIL_VERIFICATION_REQUIRED="true", SMTP_HOST="smtp.example", SMTP_FROM="studio@example.com",
    )
    monkeypatch.setattr(app, "send_action_email", lambda *args, **kwargs: None)
    csrf = register(client)
    assert client.get("/api/projects").status_code == 403
    assert client.post("/api/director/understand", json={"prompt": "create a video"}, headers=csrf_headers(csrf)).status_code == 403
    user = app.STORE.user_by_email("user@example.com")
    token = app.STORE.issue_action(user.id, "verify", 60)
    assert client.post("/api/auth/email/verify/confirm", json={"token": token}).status_code == 200
    assert client.get("/api/projects").status_code == 200


def test_production_health_fails_closed_without_email(prod):
    client, _ = prod
    r = client.get("/api/health")
    assert r.status_code == 503 and r.json()["emailReady"] is False
    assert client.post("/api/auth/register", json={"email": "user@example.com", "password": "securepass123", "name": "User"}).status_code == 503


def test_director_endpoint_uses_structured_understanding(client, monkeypatch):
    import app

    csrf = register(client)

    async def understood(prompt, overrides):
        assert "اختبار" in prompt and overrides == {"aspect": "9:16"}
        return {"style": "minimalExplainer", "direction": "neutral", "aspect": "9:16", "duration": 8, "symbol": "BTCUSDT", "language": "ar", "topic": "backtest", "includeRiskBlock": True, "includeDisclaimer": True, "creativeNotes": "مختصر"}

    monkeypatch.setattr(app, "understand_director_brief", understood)
    r = client.post("/api/director/understand", json={"prompt": "اشرح اختبار الاستراتيجية", "overrides": {"aspect": "9:16"}}, headers=csrf_headers(csrf))
    assert r.status_code == 200 and r.json()["topic"] == "backtest"


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
