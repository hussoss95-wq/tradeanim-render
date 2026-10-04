# AlgoLiquid Studio — architecture

Product: **AlgoLiquid Studio** (studio.algo-liquid.com). The rendering engine keeps its
package name, `tradeanim`. Deployment topology: see [`DEPLOYMENT.md`](../DEPLOYMENT.md).

```
apps/editor            Next.js 16 + React 19 web editor (http://localhost:3000)
packages/project-schema  versioned project JSON: types, defaults, migrations, validation
packages/editor-core     framework-free engine: easing, animation, camera, object registry
                         (drawing / trading / SMC-ICT / text / media / effects), commands,
                         render-plan compiler, candle generators & importers, AI Director
services/render-api      FastAPI: render jobs (worker process per job), project storage
tradeanim/               the original Python engine (+ project.py adapter for render plans)
scripts/                 dev launcher, Python env bootstrap, plan CLI, parity fixture
```

## Data flow

```
             ┌──────────── editor (browser) ─────────────┐
 user ──▶ UI ──▶ EditorCommand ──▶ applyCommand (immer) ──▶ Project (versioned JSON)
                                                             │
          canvas preview ◀── evalAnim / evalCamera / compileObject (editor-core)
                                                             │ Export
                                                             ▼
                                         compileRenderPlan(project) ──▶ POST /api/render
                                                                            │
                         services/render-api ──▶ worker.py (own process) ──▶ tradeanim.project
                                                                            │
          ProjectScene (Scene subclass) ─ eval per frame ─▶ tradeanim elements + overlay
          ProjectRenderer (Renderer subclass) ─▶ matplotlib frames ─▶ FFmpeg pipe ─▶ MP4 (+ audio mux)
```

### Why a render plan

Semantic objects (an FVG, a short position, a displacement measured from the
candles) compile to **primitives** (`rect`, `line`, `hline`, `vband`, `text`,
`ellipse`, `marker`, `image`, `spotlight`, `vignette`, `flash`, `glowOrb`) in
TypeScript only. The browser canvas draws those primitives, and the plan ships
them to Python, so semantics never get implemented twice. Python only mirrors
the small evaluation layer: easing, `eval_anim`, `candle_reveal` and
`eval_camera`. `tests/fixtures/parity.json` (from
`scripts/make-parity-fixture.ts`) pins TS and Python to the same numbers.

### Editing model

- **Coordinates:** chart objects store world anchors `{t: bar index, p: price}`,
  so they stay glued to the chart under any camera. Headings, captions and
  media store frame boxes (0..1). Sizes are reference px for a 1080 short
  side.
- **Commands:** every mutation is a serializable `EditorCommand`
  (`packages/editor-core/src/commands.ts`). History stores immutable snapshots
  (immer structural sharing). Drags run as gestures: a live preview from the
  base snapshot, then one undo step.
- **Registry:** each object kind is an `ObjectDef` (placement mode, anchors,
  inspector fields, handles, `compile`, `onPropChange`). The inspector,
  palette, timeline and renderer are all driven by it. Adding a kind means
  adding one definition.
- **Camera:** base state plus keyframes `{time, state{cx,cy,span,priceSpan},
  easing, follow}`. Spans interpolate in log space so zooms feel linear. In
  Camera view, stage pan and zoom auto-key at the playhead.
- **Persistence:** browser autosave (localStorage), authenticated per-user
  cloud projects through the API (falling back to a browser library), and JSON
  import/export. `migrateProject` upgrades older schema versions.

## AI Director

`packages/editor-core/src/director` defines the contract:

```ts
interface DirectorEngine { generate(brief: DirectorBrief): Promise<DirectorResult> }
DirectorResult = { project, storyboard, commands?, engine }
```

`POST /api/director/understand` uses a model with a strict JSON schema to
understand Arabic/English intent (topic, direction, aspect, duration, symbol,
and concepts). No model output is executed. The constrained brief is passed to
`templateDirector`, which generates candles and detects the
real structure on them (equal highs/lows, sweep, CISD level, FVG, retrace),
and places SMC objects, captions, a short/long position, camera keyframes and
storyboard beats. If the provider is unavailable, the improved offline parser
keeps generation available.

The pipeline also runs headless:
`npm run plan -- --prompt "..." --out plan.json` produces a render plan
without a browser, and `POST /api/render` turns it into an MP4. Narration,
SFX and captions slot into the existing audio and text tracks.

## Accounts and cloud projects

- Passwords use PBKDF2-SHA256 with unique salts.
- Sessions are opaque random tokens; only their SHA-256 digests are stored.
- The session cookie is HttpOnly/Secure in production and mutations require a
  separate CSRF token.
- Email verification and password-reset links use short-lived, single-use
  random tokens; only SHA-256 token digests are persisted. Password changes
  and resets revoke every existing session for the account.
- Password-reset requests return the same response for known and unknown
  addresses, reducing account-enumeration leakage. Users can permanently
  delete their account and cloud projects from account settings.
- Cloud projects are keyed by both user id and project id, so accounts cannot
  read or overwrite one another's work.
- SQLite/WAL runs on the render service's persistent volume while the API is a
  single instance. The narrow Store boundary supports a later Postgres move
  when rendering becomes horizontally scalable.

## Engine changes (backward compatible)

- `RenderConfig.ffmpeg_path`, and `resolve_ffmpeg()` falling back to the
  bundled `imageio-ffmpeg` binary.
- `Renderer.render_scene(..., on_progress=None)`.
- `RenderConfig.candle_body_style`. The default stays `"round,pad=0.04"`; the
  editor uses square bodies because the rounded pad is in price units and
  swamps FX prices.
- `-movflags +faststart` on encoded MP4s.
