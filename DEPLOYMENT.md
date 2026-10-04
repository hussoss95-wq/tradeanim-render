# Deploying AlgoLiquid Studio

Production domain: **https://studio.algo-liquid.com**

Nothing in this repository deploys automatically. This document describes how
the two components are built, configured and run, so each one can be deployed
on its own.

## Architecture

```
                  browser
                     │  https://studio.algo-liquid.com          (static UI + Next.js server)
                     ▼
        ┌──────────────────────────┐
        │ 1. Web editor (Next.js)  │  apps/editor — canvas preview, timeline, all editing
        └──────────────────────────┘    browser editor + authenticated API client
                     │  credentialed fetch/XHR to NEXT_PUBLIC_API_URL (CORS + CSRF)
                     ▼
        ┌──────────────────────────┐
        │ 2. Studio API (FastAPI)  │  accounts, AI Director, cloud projects, render queue
        │    + tradeanim + FFmpeg  │  one API instance; one process per render
        └──────────────────────────┘
                     │
               WORKSPACE_DIR  (persistent SQLite DB + expiring render outputs)
```

The MP4 pipeline is unchanged:

**Editor → `POST /api/render` (render plan) → FastAPI job queue → `worker.py` → `tradeanim.project.render_plan` → matplotlib frames → FFmpeg → MP4 → `GET /api/renders/{id}.mp4`**

| | Web editor | Render API |
|---|---|---|
| Code | `apps/editor` (+ `packages/*`) | `services/render-api` (+ `tradeanim/`) |
| Runtime | Node.js ≥ 20.9 | Python 3.10–3.12 + FFmpeg |
| Build | `npm ci && npm run build` | `pip install -r requirements.txt -r services/render-api/requirements.txt && pip install -e .` |
| Start | `npm run start:web` (`next start`, honours `PORT`) | `services/render-api/start.sh` (or `npm run start:api`) |
| Container | `apps/editor/Dockerfile` (standalone output) | `services/render-api/Dockerfile` |
| State | browser cache/fallback | SQLite accounts/projects + in-memory job queue + render files |
| Scaling | stateless, any number of instances / CDN | **one instance**, 1 render at a time (scale vertically) |
| Health | `GET /` | `GET /api/health` (200 ok, 503 degraded) |

Suggested hostnames:

- `studio.algo-liquid.com` for the web editor
- `api.studio.algo-liquid.com` for the render API (the default `NEXT_PUBLIC_API_URL` in `apps/editor/.env.production`)

## Hosting components required

1. **Frontend host for Next.js 16**, either:
   - a managed Next.js platform (Vercel, Netlify, Cloudflare via OpenNext, AWS Amplify), or
   - any Node 20+ host or container platform running `next start` or the standalone Docker image.

   No frontend secrets or database. TLS for `studio.algo-liquid.com`.
2. **Render backend host** running a long-lived container or VM with Python, FFmpeg and enough CPU. Rendering is CPU-bound: about 7 fps at 540p per core on a laptop CPU, so a 20 s, 30 fps video takes about 1.5 min. Requirements:
   - at least 2 vCPU and 2 GB RAM recommended
   - request timeouts longer than 60 s are **not** required (rendering is async and polled)
   - a single instance (the job queue is in memory)
   - Examples: Fly.io, Railway, Render, Google Cloud Run (min-instances=1, CPU always allocated), AWS ECS/Fargate, a VPS with Docker.
   - Serverless functions with short time limits (Vercel/Netlify functions, Lambda) are **not suitable**.
3. **Persistent disk for `WORKSPACE_DIR`**: required for the SQLite account and cloud-project database. Renders are temporary and removed after 24 h by default. Back up `studio.db` regularly.
4. **DNS + TLS** for `studio.algo-liquid.com` and the API hostname. Most platforms above provide managed certificates.
5. **Optional:** a CDN in front of the editor's static assets (built in on managed Next.js hosts).

The current single-instance release does not require an external database, object storage, queue service or Redis. Horizontal scaling does: move accounts/projects to a managed database, renders to object storage and jobs/rate limits to shared infrastructure first.

## Environment variables

All variables are documented in [`.env.example`](.env.example).

### Web editor (set at **build** time, because they are inlined into the JS bundle)

| Variable | Production value |
|---|---|
| `NEXT_PUBLIC_API_URL` | `https://api.studio.algo-liquid.com` (default in `apps/editor/.env.production`) |
| `NEXT_PUBLIC_APP_URL` | `https://studio.algo-liquid.com` |

Changing `NEXT_PUBLIC_API_URL` requires a rebuild. Development uses
`apps/editor/.env.development` (`http://localhost:8000`).

### Render API (runtime)

| Variable | Production value |
|---|---|
| `APP_ENV` | `production` (set by `start.sh` and the Dockerfile) |
| `ALLOWED_ORIGINS` | `https://studio.algo-liquid.com` (the default in production) |
| `PORT` | provided by the platform (default 8000) |
| `WORKSPACE_DIR` | e.g. `/data` |
| `FORWARDED_ALLOW_IPS` | `*` behind a managed load balancer |
| `AUTH_REQUIRED` | `true` (also the production default) |
| `AUTH_DB_PATH` | `/data/studio.db` or leave unset to use `WORKSPACE_DIR/studio.db` |
| `SESSION_TTL_SECONDS` | session lifetime; default 30 days |
| `EMAIL_VERIFICATION_REQUIRED` | `true` (also the production default) |
| `PUBLIC_APP_URL` | `https://studio.algo-liquid.com`, used for verification/reset links |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, `SMTP_STARTTLS` | transactional email provider credentials |
| `OPENAI_API_KEY` | server-side secret used by AI Director; never expose it to the editor |
| `OPENAI_DIRECTOR_MODEL` | model for structured brief extraction; default `gpt-5-mini` |
| `RENDER_PER_HOUR`, `VOICE_PER_HOUR`, `DIRECTOR_PER_HOUR` | per-account abuse limits |
| `MAX_RENDER_SECONDS`, `MAX_RENDER_PIXELS`, `MAX_RENDER_FPS`, `MAX_QUEUED_RENDERS`, `MAX_REQUEST_MB`, `RENDER_RETENTION_HOURS` | abuse limits; defaults are 120 s, 1920×1920 px, 60 fps, 20 queued, 40 MB, 24 h |

Production behaviour of the API:

- **Accounts:** passwords are salted PBKDF2 hashes; session tokens are opaque, stored hashed and sent in `HttpOnly`, `Secure`, `SameSite=Lax` cookies.
- **Recovery:** verification and password-reset links are short-lived and single-use; password changes revoke all sessions.
- **CSRF:** authenticated state changes require the matching `X-CSRF-Token` header.
- **Isolation:** cloud projects and render jobs are bound to their owning account.
- **CORS:** only exact `ALLOWED_ORIGINS`, with credential support for the Studio frontend.
- **AI Director:** the API asks the model for a strict structured brief; the editor falls back to deterministic parsing if the model is unavailable.
- **Docs:** `/api/docs` and the OpenAPI schema are disabled.
- **Errors:**
  - Every error returns `{"detail", "requestId"}` JSON with an `X-Request-ID` header.
  - Unhandled exceptions return 500 without internals.
  - Render failures are logged server-side and return a generic message.
- **Limits:** request bodies over `MAX_REQUEST_MB` get 413, and a full queue gets 429.
- **Job ids:** 32-hex-character render ids, so outputs aren't guessable.
- **Health:** `/api/health` reports FFmpeg availability, workspace writability, queue depth and limits.

## Building and running

### Web editor

```bash
npm ci                                   # TRADEANIM_SKIP_PYTHON=1 skips the local Python setup
NEXT_PUBLIC_API_URL=https://api.studio.algo-liquid.com \
NEXT_PUBLIC_APP_URL=https://studio.algo-liquid.com \
npm run build
PORT=3000 npm run start:web
```

On Vercel-style platforms, set the root directory to `apps/editor` and the
install command to `npm ci` (run from the monorepo root), with the
environment variables above. The workspace packages
(`packages/editor-core`, `packages/project-schema`) are compiled through
`transpilePackages`.

Container:

```bash
docker build -f apps/editor/Dockerfile \
  --build-arg NEXT_PUBLIC_API_URL=https://api.studio.algo-liquid.com \
  --build-arg NEXT_PUBLIC_APP_URL=https://studio.algo-liquid.com \
  -t algoliquid-studio-web .
docker run -p 3000:3000 algoliquid-studio-web
```

### Render API

```bash
pip install -r requirements.txt -r services/render-api/requirements.txt
pip install -e .
APP_ENV=production ALLOWED_ORIGINS=https://studio.algo-liquid.com \
WORKSPACE_DIR=/data AUTH_REQUIRED=true EMAIL_VERIFICATION_REQUIRED=true \
PUBLIC_APP_URL=https://studio.algo-liquid.com OPENAI_API_KEY=... \
PORT=8000 sh services/render-api/start.sh
```

`start.sh` runs:

```
uvicorn app:app --app-dir services/render-api --host 0.0.0.0 --port $PORT \
  --workers 1 --proxy-headers --timeout-graceful-shutdown 30 --no-server-header
```

Container (includes FFmpeg and fonts):

```bash
docker build -f services/render-api/Dockerfile -t algoliquid-render-api .
docker run -p 8000:8000 -v algoliquid-data:/data algoliquid-render-api
```

### Single-domain alternative

To serve the API under the same domain (for example `https://studio.algo-liquid.com/api/*` routed to the backend by a reverse proxy or platform rewrites), build the editor with `NEXT_PUBLIC_API_URL=` (empty). The editor then calls `/api/...` on its own origin, and CORS isn't involved.

## Pre-deploy checklist

```bash
npm run verify        # lint + typecheck + JS & Python tests + production build
```

1. `NEXT_PUBLIC_API_URL` points at the deployed render API, and the editor was rebuilt after any change.
2. The API's `ALLOWED_ORIGINS` includes exactly `https://studio.algo-liquid.com`.
3. The API has a persistent `/data` volume, account verification enabled, working SMTP credentials, a protected `OPENAI_API_KEY`, and an automated backup for `studio.db`.
4. `curl https://api.studio.algo-liquid.com/api/health` returns `"ok": true, "env": "production", "ffmpeg": true`.
5. Create two test accounts and confirm each account cannot list, read, replace or download the other's projects/renders.
6. Confirm registration email, one-time verification, forgot/change password, session revocation, account deletion, sign-in/out, CSRF rejection, cloud save/open/delete and AI fallback behaviour.
7. Open the editor, then **Export → Render MP4** at 540p draft, and confirm the video downloads.
8. The render host has a single instance, and its disk has room for the database and renders.

### Database backup

Use SQLite's online backup API instead of copying the live WAL database files:

```bash
python scripts/backup-studio-db.py --source /data/studio.db --destination /backups --keep 14
```

Schedule it daily and sync `/backups` to storage outside the render host. Test a
restore before launch; a backup that has never been restored is not considered verified.

## Local development (unchanged)

```bash
npm install
npm run dev      # editor http://localhost:3000, API http://localhost:8000
```

Development mode keeps the SQLite database and renders in `workspace`, exposes interactive API docs at `http://localhost:8000/api/docs`, and enables hot reload for both sides. Authentication is optional locally but cloud project endpoints always require an account.
