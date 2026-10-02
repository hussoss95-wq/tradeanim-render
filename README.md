# tradeanim v0.2.0

A **Manim-like animation library** for creating professional trading chart videos. Load OHLC data from CSV, animate candlesticks, add technical indicators, overlay ICT concepts, and export to MP4. created with AI assistance.

## Installation

```bash
# Install dependencies
pip install -r requirements.txt

# Install the package (editable mode for development)
pip install -e .

# ffmpeg is required for video encoding
brew install ffmpeg   # macOS
```

## Quick Start

```python
from tradeanim import *

class MyScene(Scene):
    def construct(self):
        chart = self.load_chart("data.csv")
        self.play(CandlesAppear(chart, style="sequential"), duration=5)
        self.wait(2)

MyScene(fps=30).render("output.mp4")
```

## CSV Format

Your CSV needs OHLC columns (case-insensitive). A `date` and `volume` column are optional but recommended.

```csv
date,open,high,low,close,volume
2024-01-01,42000,42500,41800,42350,1200000
2024-01-02,42350,43100,42200,42900,1450000
```

Column auto-detection supports: `date/datetime/timestamp/time`, `open`, `high`, `low`, `close`, `volume`.

## Core Concepts

### Scene

Everything starts with a **Scene**. Subclass it and implement `construct()`:

```python
class MyScene(Scene):
    def construct(self):
        # Load data, add animations, etc.
        pass

# Render with custom settings
MyScene(
    width=1920,        # video width (pixels)
    height=1080,       # video height (pixels)
    fps=60,            # frames per second
    crf=18,            # video quality (0=lossless, 51=worst)
).render("output.mp4")
```

### Scene Methods

| Method | Description |
|--------|-------------|
| `self.load_chart(csv_path)` | Load OHLC data, returns a `Chart` object |
| `self.play(*animations, duration=N)` | Play animations (advances timeline) |
| `self.wait(seconds)` | Pause for N seconds |
| `self.add_element(element)` | Add element immediately (no animation) |
| `self.remove_element(element)` | Remove an element |

### Chart

```python
chart = self.load_chart("data.csv")
chart = self.load_chart("data.csv", start=10, end=60)  # slice rows

# Access data
chart[0]              # first CandleElement
chart.price_at(10)    # close price at index 10
chart.high_at(10)     # high at index 10
chart.low_at(10)      # low at index 10
len(chart)            # number of candles
chart.closes          # numpy array of all close prices
chart.highs           # numpy array of all highs
```

---

## Animations

### Candle Animations

```python
# Sequential reveal (default) - candles appear one by one
self.play(CandlesAppear(chart, style="sequential"), duration=5)

# All at once with fade
self.play(CandlesAppear(chart, style="all"), duration=1)

# Slide up from below
self.play(CandlesAppear(chart, style="slide_up"), duration=3)

# Pop in with overshoot
self.play(CandlesAppear(chart, style="pop"), duration=3)

# Cascade with staggered timing
self.play(CandlesAppear(chart, style="cascade"), duration=4)

# Show a slice
self.play(CandlesAppear(chart, start=0, end=30), duration=3)

# Append more candles later
self.play(AddCandles(chart, start=30, end=60), duration=2)

# Flash a specific candle
self.play(FlashCandle(chart[25], flash_color="#FFD54F"), duration=1)
```

### Generic Animations

```python
# Fade in/out any element
self.play(FadeIn(element1, element2), duration=0.5)
self.play(FadeOut(element, remove=True), duration=0.5)

# Draw a line progressively
self.play(DrawLine(line_element), duration=2)

# Typewriter text reveal
self.play(TypeText(text_element), duration=1)

# Highlight a zone
self.play(HighlightZone(zone_element), duration=0.8)
```

### Camera Animations

```python
# Pan/zoom to specific viewport
self.play(PanCamera(
    view_start=10, view_end=40,
    price_min=41000, price_max=45000,
), duration=1.5)

# Zoom to candle range (auto-calculates price bounds)
self.play(ZoomTo(chart, start_idx=20, end_idx=50), duration=1.5)
```

### Playing Multiple Animations Simultaneously

```python
# Pass multiple animations to self.play()
self.play(
    DrawLine(sma),
    FadeIn(title),
    duration=2,
)
```

---

## Text

```python
from tradeanim import Title, Subtitle, ChartText, ScreenText, PriceLabel, AnnotationBox

# Title / subtitle (positioned in screen space)
title = Title("BTC/USD Daily")
subtitle = Subtitle("January 2024")
self.play(FadeIn(title, subtitle), duration=0.5)

# Text at a specific chart position (data coordinates)
label = ChartText("Breakout!", x=25, y=chart.high_at(25), color="#26a69a")
self.play(FadeIn(label), duration=0.3)

# Screen-space text (x, y are 0-1 fractions of the chart area)
note = ScreenText("Volume spike", x=0.8, y=0.2, font_size=16)
self.play(TypeText(note), duration=0.8)

# Price label with background box
pl = PriceLabel(price=43500, x=30)
self.play(FadeIn(pl), duration=0.3)

# Annotation box
box = AnnotationBox("Key reversal zone", x=0.5, y=0.5)
self.play(FadeIn(box), duration=0.5)
```

---

## Technical Indicators

### Moving Averages

```python
from tradeanim import SMA, EMA, DrawLine

sma20 = SMA(chart, period=20, color="#2196F3")
self.play(DrawLine(sma20), duration=2)

ema10 = EMA(chart, period=10, color="#FF9800")
self.play(DrawLine(ema10), duration=2)
```

### Bollinger Bands

```python
from tradeanim import BollingerBands, DrawLine, HighlightZone

mid, upper, lower, fill = BollingerBands(chart, period=20, std_dev=2)
self.play(
    DrawLine(mid),
    DrawLine(upper),
    DrawLine(lower),
    HighlightZone(fill),
    duration=2,
)
```

### VWAP

```python
from tradeanim import VWAP, DrawLine

vwap = VWAP(chart, color="#E040FB")
self.play(DrawLine(vwap), duration=2)
```

### Support & Resistance

```python
from tradeanim import SupportLine, ResistanceLine, FadeIn

support = SupportLine(y=41500, label="Support")
resistance = ResistanceLine(y=44200, label="Resistance")
self.play(FadeIn(support, resistance), duration=0.8)
```

### Trendlines

```python
from tradeanim import TrendLine, DrawLine

tl = TrendLine(x1=5, y1=41800, x2=25, y2=43500, color="#FFD54F", extend=15)
self.play(DrawLine(tl), duration=1)
```

### Fibonacci Retracement

```python
from tradeanim import FibonacciRetracement, FadeIn

fibs = FibonacciRetracement(high_price=45000, low_price=40000)
self.play(FadeIn(*fibs), duration=1)
```

### RSI

```python
from tradeanim import RSI, ScreenText, FadeIn

rsi_values = RSI(chart, period=14)
current_rsi = rsi_values[-1]
rsi_text = ScreenText(f"RSI(14): {current_rsi:.1f}", x=0.85, y=0.95, font_size=12)
self.play(FadeIn(rsi_text), duration=0.3)
```


### Manim-style Text Animations

New in v0.2.0: Professional text intros and effects.

```python
from tradeanim import Write, FadeInSlide, GrowFromCenter, SpinIn

# Typing effect
self.play(Write(title), duration=1.5)

# Slide in from bottom
self.play(FadeInSlide(subtitle, direction="up"), duration=0.8)

# Scale up from center with bounce
self.play(GrowFromCenter(box), duration=1.0)

# Rotate and scale in
self.play(SpinIn(icon), duration=1.0)
```

---

## ICT Concepts

### Fair Value Gaps (FVG)

```python
from tradeanim import detect_fvg, HighlightZone

fvgs = detect_fvg(chart)
for fvg in fvgs:
    self.play(HighlightZone(fvg), duration=0.4)
```

### Order Blocks

```python
from tradeanim import detect_order_blocks, HighlightZone

obs = detect_order_blocks(chart, lookback=5)
for ob in obs:
    self.play(HighlightZone(ob), duration=0.5)
```

### Break of Structure (BOS)

```python
from tradeanim import detect_bos, DrawLine, FadeIn

bos_items = detect_bos(chart, strength=3)
for line, label in bos_items:
    self.play(DrawLine(line, duration=0.6))
    if label:
        self.play(FadeIn(label), duration=0.3)
```

### Change of Character (CHoCH)

```python
from tradeanim import detect_choch, DrawLine, FadeIn

choch_items = detect_choch(chart, strength=3)
for line, label in choch_items:
    self.play(DrawLine(line, duration=0.6))
    if label:
        self.play(FadeIn(label), duration=0.3)
```

### Liquidity Levels (Equal Highs/Lows)

```python
from tradeanim import detect_liquidity, FadeIn

levels = detect_liquidity(chart, tolerance_pct=0.15, min_touches=2)
self.play(FadeIn(*levels), duration=0.8)
```

### Premium / Discount Zones

```python
from tradeanim import premium_discount_zones, HighlightZone, FadeIn

high = max(c.high for c in chart.candles)
low = min(c.low for c in chart.candles)
premium, discount, equilibrium = premium_discount_zones(high, low, x_start=0, x_end=len(chart))

self.play(
    HighlightZone(premium),
    HighlightZone(discount),
    FadeIn(equilibrium),
    duration=1,
)
```

### Auto-Markup (All ICT at Once)

```python
from tradeanim import auto_markup, HighlightZone, DrawLine, FadeIn

markup = auto_markup(chart, fvg=True, order_blocks=True, bos=True)

for fvg in markup.get("fvg", []):
    self.play(HighlightZone(fvg), duration=0.3)

for ob in markup.get("order_blocks", []):
    self.play(HighlightZone(ob), duration=0.3)

for line, txt in markup.get("bos", []):
    self.play(DrawLine(line), duration=0.4)
```

---

## Configuration

### Render Settings

```python
scene = MyScene(
    width=1920,           # video width
    height=1080,          # video height
    fps=60,               # frames per second
    crf=18,               # quality (0-51, lower = better)
    preset="medium",      # encoding speed: ultrafast/fast/medium/slow/veryslow
)
```

### Themes

```python
from tradeanim import DARK_THEME, LIGHT_THEME, RenderConfig, Theme

# Use built-in light theme
scene = MyScene(config=RenderConfig(theme=LIGHT_THEME))

# Custom theme
my_theme = Theme(
    background="#0a0a0a",
    bull_color="#00ff88",
    bear_color="#ff4444",
)
scene = MyScene(config=RenderConfig(theme=my_theme))
```

### Candle Appearance

```python
config = RenderConfig(
    candle_width=0.6,       # body width (0-1)
    wick_linewidth=1.2,     # wick line thickness
    show_volume=True,       # show volume subplot
    volume_height_ratio=0.15,
    show_grid=True,
    grid_alpha=0.3,
    watermark="tradeanim",  # background watermark text
)
```

### Easing Functions

All animations accept a custom easing function:

```python
from tradeanim import easing

self.play(CandlesAppear(chart, easing=easing.ease_out_bounce), duration=3)
self.play(DrawLine(sma, easing=easing.linear), duration=2)
```

Available easings: `linear`, `ease_in_quad`, `ease_out_quad`, `ease_in_out_quad`, `ease_in_cubic`, `ease_out_cubic`, `ease_in_out_cubic`, `ease_in_sine`, `ease_out_sine`, `ease_in_out_sine`, `ease_in_expo`, `ease_out_expo`, `ease_in_out_expo`, `ease_out_back`, `ease_out_elastic`, `ease_out_bounce`.

---

## Examples

Run the examples from the project root:

```bash
# Basic candlestick animation
python examples/basic_candles.py

# Technical indicators (SMA, EMA, Fib, S/R)
python examples/with_indicators.py

# ICT concepts (FVG, Order Blocks, BOS, Premium/Discount)
python examples/ict_concepts.py

# Manim-style Text Animations
python examples/manim_demo.py
```

## Requirements

- Python >= 3.9
- matplotlib >= 3.7
- numpy >= 1.24
- pandas >= 2.0
- ffmpeg (system install)

## Architecture

```
tradeanim/
├── __init__.py       # Public API exports
├── config.py         # Theme, RenderConfig
├── easing.py         # Easing functions
├── scene.py          # Scene, Camera, Animation base
├── chart.py          # Chart (OHLC loader + candle management)
├── elements.py       # Visual elements (Candle, Line, Text, Zone, HLine, Arrow)
├── animations.py     # Built-in animations
├── text.py           # Text convenience constructors
├── indicators.py     # TA indicators (SMA, EMA, BB, VWAP, Fib, S/R)
├── ict.py            # ICT concepts (FVG, OB, BOS, CHoCH, liquidity)
└── renderer.py       # Matplotlib rendering + ffmpeg video encoding
```

## License

MIT
