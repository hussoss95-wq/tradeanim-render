# tradeanim studio — architecture

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
- **Persistence:** browser autosave (localStorage), Save to
  `workspace/projects/*.json` through the API (falling back to a browser
  library), and JSON import/export. `migrateProject` upgrades older schema
  versions.

## AI Director (prepared, not complete)

`packages/editor-core/src/director` defines the contract:

```ts
interface DirectorEngine { generate(brief: DirectorBrief): Promise<DirectorResult> }
DirectorResult = { project, storyboard, commands?, engine }
```

Today `templateDirector` parses the prompt (direction, aspect, duration,
symbol, which concepts to include). It then generates candles, detects the
real structure on them (equal highs/lows, sweep, CISD level, FVG, retrace),
and places SMC objects, captions, a short/long position, camera keyframes and
storyboard beats.

An LLM engine plugs into the same interface. It can emit either a whole
project or a list of `EditorCommand`s, using each `ObjectDef.description` and
`fields` as tool documentation. The pipeline runs headless:
`npm run plan -- --prompt "..." --out plan.json` produces a render plan
without a browser, and `POST /api/render` turns it into an MP4. Narration,
SFX and captions slot into the existing audio and text tracks.

## Engine changes (backward compatible)

- `RenderConfig.ffmpeg_path`, and `resolve_ffmpeg()` falling back to the
  bundled `imageio-ffmpeg` binary.
- `Renderer.render_scene(..., on_progress=None)`.
- `RenderConfig.candle_body_style`. The default stays `"round,pad=0.04"`; the
  editor uses square bodies because the rounded pad is in price units and
  swamps FX prices.
- `-movflags +faststart` on encoded MP4s.
