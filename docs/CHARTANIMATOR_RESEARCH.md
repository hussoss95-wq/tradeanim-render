# ChartAnimator — Product Research

Explored hands-on with Claude in Chrome on 2026-10-02, at
`https://www.chartanimator.io/editor` (Free plan, 1366×768 desktop window).
This is a **reference for product shape and workflow only**. No source code,
assets, branding, copy or private APIs were taken. Our editor is an original
implementation.

## 1. First impressions

- Below roughly 1000px wide, the editor shows a "go to desktop" gate. It is a
  desktop-only product.
- Opening the editor restores the last project (autosaved in the account;
  "Saved at hh:mm" toast).
- The theme is a dark navy/purple palette with purple accents and dense icon
  tabs.
- Rendering is **DOM + SVG**: no `<canvas>`, about 200 `<svg>` nodes, built on
  Next.js. The preview stage is a small fixed-aspect "phone" frame centered in
  a large empty area. At 1366×768, the 9:16 stage is only ~156×278px.

## 2. Layout

```
┌───────────── left panel (≈340px) ─────────────┐┌──────── stage (fixed-aspect frame) ────────┐
│ Project name · Save · Shield(Pro) · Star       ││                                             │
│ [Chart][Tools][Library][Media][Text][Stickers]││              (white 9:16 frame)             │
│ [Audio]                                        ││                                             │
│ Contextual panel / inspector (scrolls)         ││                                             │
└────────────────────────────────────────────────┘└─────────────────────────────────────────────┘
┌ toolbar: undo redo | cut | blocks | keyframe mode | snapping | drawing tools | bookmark | static ┐
│ speed 1x · prev · PLAY · next · 0:00.00 / 1:19.80 · "Free · Export with Pro" · EXPORT · 9:16 · zoom │
├ timeline: one row per clip lane, per-row [mute][delete][+] buttons, ruler in seconds, MAP minimap ┤
```

- There is **no separate right inspector**. Selecting a clip swaps the left
  panel to that clip's settings, so the asset browser and the inspector share
  one area.
- The timeline takes the bottom ~50% of the window and the stage is small. The
  canvas competes with the timeline for space.

## 3. Feature inventory (from the UI)

### Chart builders (left panel → Chart)
| Builder | Description (paraphrased) | Plan |
|---|---|---|
| Single Builder | Drag OHLC handles to shape one candle | Free |
| Group Builder | Build multi-candle sequences | Free |
| Scene Assembler | One-step setup: candles + zone + position + circle + text + arrow | Pro |
| Zoom Drill | Zoom from a higher-timeframe candle into lower-timeframe candles | Pro |
| Zig Zag Builder | Animate swing structures / impulse legs | Pro-ish |
| GBM Builder | Synthetic market data via Geometric Brownian Motion | — |
| Pattern Builder | Compose multi-candle patterns; preview canvas, numbered candles, O/H/L/C handles | — |
| Chart Blocks | Select 2+ layers → right-click → "Save as Chart Block" → reuse | — |

Pattern Builder controls:
- **+ Add Bullish / + Add Bearish**, numbered candle list.
- **Candle style:** height, width, gap, wick width, hollow.
- **Reveal animation**, **Save pattern**, **+ Add to canvas**.
- **Global candle colours** (bull/bear), **candle parts** (body/wick/border
  colour per side), **border width**.

### Tools (left panel → Tools)
- **Trading:** Fibonacci, Elliott Wave, Short Position, Long Position, Moving
  Average, Market, Baseline
- **Drawing:** Zone, Circle, Line, Path, Arrow, Note
- **Teaching:** Callout, Point (numbered), Intro, Transition, Spotlight, Glow Orb
- **Brand & Media:** Brand Logo
- **Media:** upload MP4 / PNG / JPG / MP3 (All / Images / Videos / Audio)

There is **no semantic SMC/ICT object set**. FVG, OB, BOS, CHoCH, CISD,
liquidity and so on all have to be built by hand from generic zones, lines and
text. The sample project does exactly that ("Cisd", "CISD Entry", "Zone",
"Line" clips).

### Text
- "+ Add custom text" plus preset cards (e.g. Modern Title, Impact Statement)
  with favourites.
- Text inspector: content box; font family, weight, size, B/I/U, letter
  spacing, line height; plain/gradient colour; highlight fill.
- **Style individual words**: a per-word bold/italic/underline/colour toggle.
- Shadow/Glow, and **Hide text**, which pixelates a line as a teaser.
- 13 enter and 13 exit animations, with separate enter/exit durations
  (slow↔fast slider) and position.

### Audio
Captions (script → sentences; styles Default/Bold/Minimal; animations Fade
in / Slide up / Typewriter / Word by word; SRT upload), Record, Pixel Editor,
AI Voice (Pro).

### Library
My Projects (cards with date and **▶ Open**), My Templates, "+ More" template
gallery.

### Timeline
- Multi-lane clips, colour-coded by type: text in teal, shapes in purple,
  builders in blue.
- Each lane has mute (headphones), delete and add buttons.
- Clicking the ruler moves the playhead, and the stage re-renders that frame.
- Clip right-click menu: **Entrance / Exit**, **Duplicate**, **Move to New Top
  Track**, **Move to New Bottom Track**, **Delete**.
- Toolbar: undo, redo, cut (split), Chart Blocks, **Enable Keyframe Mode
  (Shift+K)**, snapping, drawing tools, **bookmark at playhead**, **Static
  Content Mode (Pro+)**.
- Playback speed (1x), previous/next, timecode `m:ss.cc`, aspect selector, and
  timeline zoom slider (100%).
- A **MAP** minimap button at the bottom right.

### Aspect ratios
16:9 Landscape (YouTube/Desktop), **9:16 Portrait (default; Shorts/TikTok)**,
1:1 Square, 4:5 Portrait feed.

### Export
"Your video is ready to export" modal with a preview. **Export is Pro-only**
(Pro tier lists: no watermark, builders unlocked, Scene Assembler & Zoom
Drill, animated stickers & special FX, priority render queue). Rendering is
server-side and queued.

## 4. Workflow observations

1. **Builder-first:** users compose candles in a builder dialog, then "add to
   canvas", which creates a timeline clip. Candles are not edited directly on
   the stage.
2. **Clip-centric:** every element is a timeline clip with enter/exit
   animations. There is no visible data-anchored coordinate system: drawings
   are positioned in frame space and do not stick to price/time.
3. **No chart navigation:** no price/time axes, crosshair, pan or zoom in the
   stage. The "chart" is an illustration, not a chart.
4. **Camera:** no dedicated camera track was visible on the free tier. Zoom
   effects come from builders (Zoom Drill) and keyframe mode.
5. **Persistence:** cloud autosave plus a project list.
6. **Keyboard:** Shift+K (keyframe mode) and F8 (notifications) were
   discoverable. Shortcuts are otherwise sparsely documented.

## 5. UX weaknesses we can beat

| Weakness | Our answer |
|---|---|
| Tiny stage, timeline eats half the screen | Stage-first layout with resizable timeline and compact chrome |
| Inspector and asset browser share one panel | Dedicated right inspector, always visible |
| No price/time axes, crosshair, pan/zoom | TradingView-grade chart: price and time scales, crosshair, wheel zoom, axis drag |
| Drawings are frame-anchored | Drawings anchored to (time, price) and snapped to OHLC (magnet) |
| SMC/ICT built from generic shapes | ~30 **semantic** SMC/ICT object types with their own data model, visuals, inspector and animations |
| No camera track | First-class camera track: keyframes, follow price/object, presets |
| Export paywalled, cloud only | Local, free MP4 export through our Python engine + FFmpeg |
| Closed project format | Versioned, documented JSON project schema, built for AI generation |
| No AI scene generation | Command-based architecture ready for an AI Director; deterministic scenario templates today |

## 6. Ideas worth adopting (implemented in an original way)

- Bull/bear candle part colours (body/wick/border) and global candle style.
- Enter/exit animation pairs per clip, plus "emphasis" animations.
- Clip context menu actions (duplicate, move to new track).
- Bookmarks/markers on the timeline ruler.
- Aspect-ratio presets with social-platform hints.
- A synthetic data generator (we use our own GBM and pattern generators).
- Caption styles (planned: captions track).
