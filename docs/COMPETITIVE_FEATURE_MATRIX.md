# Competitive feature matrix — tradeanim studio vs ChartAnimator

ChartAnimator column: observed in its public editor on 2026-10-02 (Free plan;
see `CHARTANIMATOR_RESEARCH.md`). tradeanim column: this branch
(`feature/web-editor`), phase 1.

Legend: ✅ available · ◐ partial / basic · ✗ not available · 🔒 paid tier only · 🗓 planned (schema/architecture ready)

## Chart & data

| Capability | ChartAnimator | tradeanim studio |
|---|---|---|
| Candlestick rendering | ✅ (illustration-style, no axes) | ✅ canvas renderer with price + time scales |
| Price scale / time scale | ✗ | ✅ instrument-aware decimals, session timestamps |
| Crosshair with price/time tags | ✗ | ✅ |
| Pan / zoom chart, drag axes to scale | ✗ | ✅ wheel, Alt/middle-drag, axis drag, double-click fit |
| Drawings anchored to time/price | ✗ (frame-anchored) | ✅ all chart objects are world-anchored |
| Snap / magnet to OHLC + guides | ◐ (timeline snapping) | ✅ OHLC magnet with guide lines, bar snapping |
| Edit candle OHLC on canvas | ◐ (inside builder dialog) | ✅ O/H/L/C handles on the stage, body drag, OHLC table |
| Add / delete / duplicate / reorder candles | ✅ (builder) | ✅ candle tool, table, context menu, keyboard |
| Per-candle style (body, wick, opacity, glow, width) | ✅ global + parts | ✅ global theme + per-candle overrides |
| Synthetic data | ✅ GBM builder | ✅ seeded GBM + 9 waypoint patterns (sweeps, double top/bottom, H&S…) |
| Import CSV / JSON / paste OHLC | ✗ (not observed) | ✅ auto-detected columns, unix/ISO times |
| Candle reveal animation | ✅ | ✅ sequential / cascade / grow-from-open / fade |
| Zoom Drill (HTF → LTF) | 🔒 | 🗓 (camera presets cover macro→micro framing) |

## Annotation tools

| Capability | ChartAnimator | tradeanim studio |
|---|---|---|
| Line / ray / horizontal line / arrow / path | ◐ line, path, arrow | ✅ trendline, ray, horizontal line, arrow, multi-point path |
| Rectangle / zone / circle | ✅ zone, circle | ✅ rectangle, zone (extend right), ellipse |
| Long / short position with R:R | ✅ | ✅ entry/SL/TP handles, % and R:R labels |
| Fibonacci | ✅ | ✅ custom levels, golden pocket, prices |
| Risk/reward measure | ✗ | ✅ Δprice, %, bars, R multiple |
| Elliott wave, moving average | ✅ | 🗓 (engine has SMA/EMA indicators to surface) |
| Semantic SMC/ICT objects | ✗ (built from generic shapes) | ✅ 29 types: FVG, IFVG, BOS, CHoCH, MSS, CISD, OB, Breaker, Mitigation, Liquidity, Sweep, Grab, EQH, EQL, IDM, OTE, Premium/Discount, Premium, Discount, EQ, PDH, PDL, PWH, PWL, Session H/L, Kill Zone, Displacement, SMT |
| Auto-detect FVGs & structure | ✗ | ✅ one click (gaps + swing breaks) |
| Text: heading / label / callout / caption | ✅ rich presets, per-word styling | ✅ (per-word styling 🗓) |
| Spotlight / glow orb / vignette / flash | ✅ spotlight, glow orb | ✅ all four, rendered in MP4 too |
| Images / logo | ✅ | ✅ embedded in project file |
| Animated stickers | 🔒 | ✗ |

## Timeline & animation

| Capability | ChartAnimator | tradeanim studio |
|---|---|---|
| Multi-track timeline, playhead scrubbing | ✅ | ✅ typed tracks: Camera, Candles, Drawings, SMC/ICT, Text, Media, Effects, Audio |
| Drag clips / trim duration / snapping | ✅ | ✅ snaps to playhead, clip edges, markers, keyframes |
| Visibility / lock per layer and per track | ◐ (mute per lane) | ✅ |
| Layer ordering | ✅ (move to new top/bottom track) | ✅ front/forward/backward/back |
| Markers / bookmarks | ✅ | ✅ |
| Enter / exit animations | ✅ 13 + 13 | ✅ 15 presets each (fade, scale, pop, slide, draw, wipe, typewriter, bounce, pulse, glow, flash, highlight, trace, cinematic) |
| Emphasis (mid-clip) animations | ✗ (not observed) | ✅ pulse / glow / flash / highlight with cycles |
| Easing control | ◐ (slow↔fast) | ✅ 15 named easings + custom bezier in the schema |
| Keyframes | ✅ keyframe mode | ✅ camera keyframes (object property keyframes 🗓) |
| Dedicated camera track | ✗ | ✅ keyframes, easing, follow price / follow object, auto-key from stage |
| Camera presets | ✗ | ✅ Slow Zoom, Punch In, Reveal, Follow Price, Zoom To POI, Zoom To Entry, Macro To Micro |
| Camera view vs free view | ✗ | ✅ |

## Project & output

| Capability | ChartAnimator | tradeanim studio |
|---|---|---|
| Aspect ratios | ✅ 16:9, 9:16, 1:1, 4:5 | ✅ same, plus resolution presets 720p–4K and FPS |
| Undo / redo | ✅ | ✅ command architecture, gesture-coalesced history |
| Save / load / autosave | ✅ cloud | ✅ local workspace files + browser autosave + library |
| Export / import project JSON | ✗ | ✅ versioned schema with migrations |
| Export MP4 | 🔒 cloud render queue | ✅ free, local: Python tradeanim + FFmpeg, live progress, cancel |
| Audio track in export | ✅ | ✅ clips muxed with offset / trim / volume |
| Captions (auto-split, SRT), AI voice, record | ✅ / 🔒 | 🗓 |
| Templates / chart blocks | ✅ | ◐ text presets, generated scenes (template library 🗓) |
| Keyboard shortcuts | ◐ (few documented) | ✅ ~25, in-app reference (`?`) |
| AI scene generation | ✗ | ◐ offline template Director (prompt → full project); LLM Director 🗓 on the same contract |

## Where we lead today

1. Real chart semantics: axes, crosshair, pan/zoom, world-anchored drawings, OHLC magnet.
2. A typed SMC/ICT vocabulary that no shape-based editor matches.
3. A camera system with follow-price and presets.
4. Free local MP4 export from an open, versioned project format.
5. An architecture an AI Director can drive: serializable commands, an object registry that documents itself, headless plan compilation.

## Where ChartAnimator still leads

Polish of text styling (per-word styles, gradients, text teasers), animated
stickers, captions/AI voice, a template marketplace, and cloud sync. These are
the next-phase backlog.
