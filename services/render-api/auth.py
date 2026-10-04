"""Accounts, opaque sessions and per-user cloud project storage.

The service is deliberately self-contained: SQLite works on a mounted cloud
volume today, while the narrow Store API can be moved to Postgres when the
render service is horizontally scaled.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import re
import secrets
import sqlite3
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

from fastapi import HTTPException, Request, Response

SESSION_COOKIE = "algoliquid_session"
CSRF_COOKIE = "algoliquid_csrf"
PBKDF2_ROUNDS = 310_000


@dataclass(frozen=True)
class User:
    id: str
    email: str
    name: str
    verified: bool


class Store:
    def __init__(self, path: Path):
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        self._init()

    def connect(self) -> sqlite3.Connection:
        db = sqlite3.connect(self.path, timeout=15)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        db.execute("PRAGMA journal_mode=WAL")
        return db

    def _init(self) -> None:
        with self.lock, self.connect() as db:
            db.executescript(
                """
                CREATE TABLE IF NOT EXISTS users (
                  id TEXT PRIMARY KEY,
                  email TEXT NOT NULL UNIQUE,
                  name TEXT NOT NULL,
                  password_hash TEXT NOT NULL,
                  created_at REAL NOT NULL,
                  email_verified_at REAL
                );
                CREATE TABLE IF NOT EXISTS sessions (
                  token_hash TEXT PRIMARY KEY,
                  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                  csrf_hash TEXT NOT NULL,
                  created_at REAL NOT NULL,
                  expires_at REAL NOT NULL
                );
                CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
                CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
                CREATE TABLE IF NOT EXISTS account_actions (
                  token_hash TEXT PRIMARY KEY,
                  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                  kind TEXT NOT NULL CHECK(kind IN ('verify','reset')),
                  expires_at REAL NOT NULL,
                  used_at REAL
                );
                CREATE INDEX IF NOT EXISTS account_actions_user_kind
                  ON account_actions(user_id, kind);
                CREATE TABLE IF NOT EXISTS cloud_projects (
                  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                  project_id TEXT NOT NULL,
                  name TEXT NOT NULL,
                  document TEXT NOT NULL,
                  updated_at TEXT NOT NULL,
                  PRIMARY KEY (user_id, project_id)
                );
                CREATE INDEX IF NOT EXISTS cloud_projects_updated
                  ON cloud_projects(user_id, updated_at DESC);
                """
            )
            columns = {row["name"] for row in db.execute("PRAGMA table_info(users)").fetchall()}
            if "email_verified_at" not in columns:
                db.execute("ALTER TABLE users ADD COLUMN email_verified_at REAL")

    def create_user(self, email: str, name: str, password: str) -> User:
        user = User(secrets.token_hex(12), normalize_email(email), clean_name(name, email), False)
        encoded = hash_password(password)
        try:
            with self.lock, self.connect() as db:
                db.execute(
                    "INSERT INTO users(id,email,name,password_hash,created_at) VALUES(?,?,?,?,?)",
                    (user.id, user.email, user.name, encoded, time.time()),
                )
        except sqlite3.IntegrityError as exc:
            raise HTTPException(409, "An account with this email already exists") from exc
        return user

    def authenticate(self, email: str, password: str) -> Optional[User]:
        with self.connect() as db:
            row = db.execute("SELECT * FROM users WHERE email=?", (normalize_email(email),)).fetchone()
        if not row or not verify_password(password, row["password_hash"]):
            return None
        return self._user(row)

    @staticmethod
    def _user(row: sqlite3.Row) -> User:
        return User(row["id"], row["email"], row["name"], bool(row["email_verified_at"]))

    def user_by_email(self, email: str) -> Optional[User]:
        with self.connect() as db:
            row = db.execute("SELECT * FROM users WHERE email=?", (normalize_email(email),)).fetchone()
        return self._user(row) if row else None

    def create_session(self, user_id: str, ttl: int) -> tuple[str, str]:
        token, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(24)
        now = time.time()
        with self.lock, self.connect() as db:
            db.execute("DELETE FROM sessions WHERE expires_at < ?", (now,))
            db.execute(
                "INSERT INTO sessions(token_hash,user_id,csrf_hash,created_at,expires_at) VALUES(?,?,?,?,?)",
                (digest(token), user_id, digest(csrf), now, now + ttl),
            )
        return token, csrf

    def user_for_session(self, token: str) -> Optional[User]:
        if not token:
            return None
        now = time.time()
        with self.connect() as db:
            row = db.execute(
                """SELECT users.id,users.email,users.name,users.email_verified_at FROM sessions
                   JOIN users ON users.id=sessions.user_id
                   WHERE sessions.token_hash=? AND sessions.expires_at>?""",
                (digest(token), now),
            ).fetchone()
        return self._user(row) if row else None

    def issue_action(self, user_id: str, kind: str, ttl: int) -> str:
        if kind not in {"verify", "reset"}:
            raise ValueError("invalid account action")
        token = secrets.token_urlsafe(32)
        now = time.time()
        with self.lock, self.connect() as db:
            db.execute("DELETE FROM account_actions WHERE expires_at<? OR (user_id=? AND kind=?)", (now, user_id, kind))
            db.execute(
                "INSERT INTO account_actions(token_hash,user_id,kind,expires_at) VALUES(?,?,?,?)",
                (digest(token), user_id, kind, now + ttl),
            )
        return token

    def consume_verification(self, token: str) -> Optional[User]:
        now = time.time()
        with self.lock, self.connect() as db:
            row = db.execute(
                "SELECT user_id FROM account_actions WHERE token_hash=? AND kind='verify' AND used_at IS NULL AND expires_at>?",
                (digest(token), now),
            ).fetchone()
            if not row:
                return None
            db.execute("UPDATE account_actions SET used_at=? WHERE token_hash=?", (now, digest(token)))
            db.execute("UPDATE users SET email_verified_at=COALESCE(email_verified_at,?) WHERE id=?", (now, row["user_id"]))
            user = db.execute("SELECT * FROM users WHERE id=?", (row["user_id"],)).fetchone()
        return self._user(user)

    def reset_password(self, token: str, password: str) -> bool:
        validate_password(password)
        now = time.time()
        with self.lock, self.connect() as db:
            row = db.execute(
                "SELECT user_id FROM account_actions WHERE token_hash=? AND kind='reset' AND used_at IS NULL AND expires_at>?",
                (digest(token), now),
            ).fetchone()
            if not row:
                return False
            db.execute("UPDATE account_actions SET used_at=? WHERE token_hash=?", (now, digest(token)))
            db.execute("UPDATE users SET password_hash=? WHERE id=?", (hash_password(password), row["user_id"]))
            db.execute("DELETE FROM sessions WHERE user_id=?", (row["user_id"],))
        return True

    def change_password(self, user_id: str, old_password: str, new_password: str) -> bool:
        validate_password(new_password)
        with self.lock, self.connect() as db:
            row = db.execute("SELECT password_hash FROM users WHERE id=?", (user_id,)).fetchone()
            if not row or not verify_password(old_password, row["password_hash"]):
                return False
            db.execute("UPDATE users SET password_hash=? WHERE id=?", (hash_password(new_password), user_id))
            db.execute("DELETE FROM sessions WHERE user_id=?", (user_id,))
        return True

    def delete_account(self, user_id: str, password: str) -> bool:
        with self.lock, self.connect() as db:
            row = db.execute("SELECT password_hash FROM users WHERE id=?", (user_id,)).fetchone()
            if not row or not verify_password(password, row["password_hash"]):
                return False
            db.execute("DELETE FROM users WHERE id=?", (user_id,))
        return True

    def purge_user(self, user_id: str) -> None:
        """Remove an incomplete registration when its verification email cannot be sent."""
        with self.lock, self.connect() as db:
            db.execute("DELETE FROM users WHERE id=?", (user_id,))

    def csrf_valid(self, token: str, csrf: str) -> bool:
        if not token or not csrf:
            return False
        with self.connect() as db:
            row = db.execute("SELECT csrf_hash FROM sessions WHERE token_hash=? AND expires_at>?", (digest(token), time.time())).fetchone()
        return bool(row and hmac.compare_digest(row["csrf_hash"], digest(csrf)))

    def revoke(self, token: str) -> None:
        if token:
            with self.lock, self.connect() as db:
                db.execute("DELETE FROM sessions WHERE token_hash=?", (digest(token),))

    def list_projects(self, user_id: str) -> list[dict[str, Any]]:
        with self.connect() as db:
            rows = db.execute(
                "SELECT project_id,name,updated_at,document FROM cloud_projects WHERE user_id=? ORDER BY updated_at DESC",
                (user_id,),
            ).fetchall()
        out = []
        for row in rows:
            doc = json.loads(row["document"])
            settings = doc.get("settings", {})
            out.append({"id": row["project_id"], "name": row["name"], "updatedAt": row["updated_at"], "aspect": settings.get("aspect"), "duration": settings.get("duration")})
        return out

    def get_project(self, user_id: str, project_id: str) -> Optional[dict[str, Any]]:
        with self.connect() as db:
            row = db.execute("SELECT document FROM cloud_projects WHERE user_id=? AND project_id=?", (user_id, project_id)).fetchone()
        return json.loads(row["document"]) if row else None

    def save_project(self, user_id: str, project_id: str, doc: dict[str, Any]) -> None:
        encoded = json.dumps(doc, separators=(",", ":"), ensure_ascii=False)
        if len(encoded.encode("utf-8")) > 20 * 1024 * 1024:
            raise HTTPException(413, "Project exceeds the 20 MB cloud-save limit")
        updated = str(doc.get("updatedAt") or "")
        with self.lock, self.connect() as db:
            db.execute(
                """INSERT INTO cloud_projects(user_id,project_id,name,document,updated_at)
                   VALUES(?,?,?,?,?) ON CONFLICT(user_id,project_id) DO UPDATE SET
                   name=excluded.name,document=excluded.document,updated_at=excluded.updated_at""",
                (user_id, project_id, str(doc.get("name") or project_id)[:200], encoded, updated),
            )

    def delete_project(self, user_id: str, project_id: str) -> None:
        with self.lock, self.connect() as db:
            db.execute("DELETE FROM cloud_projects WHERE user_id=? AND project_id=?", (user_id, project_id))


def normalize_email(value: str) -> str:
    email = value.strip().lower()
    if len(email) < 3 or len(email) > 254 or any(char.isspace() for char in email) or email.count("@") != 1:
        raise HTTPException(422, "Enter a valid email address")
    local, domain = email.split("@", 1)
    labels = domain.split(".")
    if not local or len(local) > 64 or len(labels) < 2 or any(not label or len(label) > 63 for label in labels):
        raise HTTPException(422, "Enter a valid email address")
    return email


def clean_name(value: str, email: str) -> str:
    name = " ".join(value.strip().split())[:80]
    return name or normalize_email(email).split("@", 1)[0][:80]


def validate_password(value: str) -> None:
    if len(value) < 10 or len(value) > 128:
        raise HTTPException(422, "Password must be 10–128 characters")
    if not re.search(r"[A-Za-z]", value) or not re.search(r"\d", value):
        raise HTTPException(422, "Password must include a letter and a number")


def hash_password(password: str) -> str:
    validate_password(password)
    salt = secrets.token_bytes(16)
    key = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, PBKDF2_ROUNDS)
    return f"pbkdf2_sha256${PBKDF2_ROUNDS}${salt.hex()}${key.hex()}"


def verify_password(password: str, encoded: str) -> bool:
    try:
        _, rounds, salt, expected = encoded.split("$", 3)
        key = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), int(rounds))
        return hmac.compare_digest(key.hex(), expected)
    except (ValueError, TypeError):
        return False


def digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def current_user(request: Request, store: Store) -> Optional[User]:
    return store.user_for_session(request.cookies.get(SESSION_COOKIE, ""))


def require_user(request: Request, store: Store) -> User:
    user = current_user(request, store)
    if not user:
        raise HTTPException(401, "Sign in to continue")
    return user


def require_verified_user(request: Request, store: Store, required: bool) -> User:
    user = require_user(request, store)
    if required and not user.verified:
        raise HTTPException(403, "Verify your email to continue")
    return user


def require_csrf(request: Request, store: Store) -> None:
    session = request.cookies.get(SESSION_COOKIE, "")
    header = request.headers.get("x-csrf-token", "")
    cookie = request.cookies.get(CSRF_COOKIE, "")
    if not header or not cookie or not hmac.compare_digest(header, cookie) or not store.csrf_valid(session, header):
        raise HTTPException(403, "Invalid CSRF token")


def set_session_cookies(response: Response, token: str, csrf: str, secure: bool, ttl: int) -> None:
    response.set_cookie(SESSION_COOKIE, token, max_age=ttl, httponly=True, secure=secure, samesite="lax", path="/")
    response.set_cookie(CSRF_COOKIE, csrf, max_age=ttl, httponly=False, secure=secure, samesite="lax", path="/")


def clear_session_cookies(response: Response, secure: bool) -> None:
    response.delete_cookie(SESSION_COOKIE, path="/", secure=secure, samesite="lax")
    response.delete_cookie(CSRF_COOKIE, path="/", secure=secure, samesite="lax")
