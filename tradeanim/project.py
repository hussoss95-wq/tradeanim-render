# Render web-editor projects with the tradeanim engine.
#
# The web editor compiles a project into a "render plan" (see
# packages/editor-core/src/compile.ts): settings, theme, candles, camera
# keyframes and, per object, its timing/animation specs plus a list of
# primitives (rect, line, hline, vband, text, ellipse, marker, image,
# spotlight, vignette, flash, glowOrb). This module evaluates the plan per
# frame and turns it into ordinary tradeanim elements (CandleElement,
# ZoneElement, LineElement, HLineElement, TextElement, ArrowElement) drawn by
# the stock Renderer, plus a figure-level overlay for frame-space text, media
# and screen effects. Encoding still goes through the Renderer's FFmpeg pipe.
#
# Evaluation helpers (easing, eval_anim, candle_reveal, eval_camera) mirror
# packages/editor-core (easing.ts, animation.ts, chart.ts, camera.ts).

from __future__ import annotations

import base64
import io
import math
import os
import subprocess
import tempfile
import textwrap
from datetime import datetime, timezone
from typing import Callable, Optional

import numpy as np
from matplotlib.ticker import FuncFormatter

from .config import RenderConfig, Theme
from .elements import (
    ArrowElement,
    CandleElement,
    HLineElement,
    LineElement,
    TextElement,
    ZoneElement,
)
from .renderer import Renderer, _hex_to_rgba, resolve_ffmpeg
from .scene import Scene

PLAN_FORMAT = "tradeanim.renderplan"

# Axis sizes in reference px (short side = 1080); mirror apps/editor/src/stage/layout.ts
AXIS_W = 96
AXIS_H = 44

# --------------------------------------------------------------------- easing

_C1 = 1.70158
_C2 = _C1 * 1.525
_C3 = _C1 + 1


def _bounce_out(t: float) -> float:
    n1, d1 = 7.5625, 2.75
    if t < 1 / d1:
        return n1 * t * t
    if t < 2 / d1:
        t -= 1.5 / d1
        return n1 * t * t + 0.75
    if t < 2.5 / d1:
        t -= 2.25 / d1
        return n1 * t * t + 0.9375
    t -= 2.625 / d1
    return n1 * t * t + 0.984375


EASINGS: dict[str, Callable[[float], float]] = {
    "linear": lambda t: t,
    "easeIn": lambda t: t * t,
    "easeOut": lambda t: t * (2 - t),
    "easeInOut": lambda t: 2 * t * t if t < 0.5 else -1 + (4 - 2 * t) * t,
    "cubicIn": lambda t: t ** 3,
    "cubicOut": lambda t: 1 - (1 - t) ** 3,
    "cubicInOut": lambda t: 4 * t ** 3 if t < 0.5 else 1 - (-2 * t + 2) ** 3 / 2,
    "expoIn": lambda t: 0.0 if t == 0 else 2 ** (10 * t - 10),
    "expoOut": lambda t: 1.0 if t == 1 else 1 - 2 ** (-10 * t),
    "expoInOut": lambda t: 0.0 if t == 0 else 1.0 if t == 1 else (2 ** (20 * t - 10) / 2 if t < 0.5 else (2 - 2 ** (-20 * t + 10)) / 2),
    "backIn": lambda t: _C3 * t ** 3 - _C1 * t * t,
    "backOut": lambda t: 1 + _C3 * (t - 1) ** 3 + _C1 * (t - 1) ** 2,
    "backInOut": lambda t: ((2 * t) ** 2 * ((_C2 + 1) * 2 * t - _C2)) / 2 if t < 0.5 else ((2 * t - 2) ** 2 * ((_C2 + 1) * (t * 2 - 2) + _C2) + 2) / 2,
    "elasticOut": lambda t: 0.0 if t == 0 else 1.0 if t == 1 else 2 ** (-10 * t) * math.sin((t * 10 - 0.75) * (2 * math.pi / 3)) + 1,
    "bounceOut": _bounce_out,
}


def cubic_bezier(x1: float, y1: float, x2: float, y2: float) -> Callable[[float], float]:
    cx = 3 * x1
    bx = 3 * (x2 - x1) - cx
    ax = 1 - cx - bx
    cy = 3 * y1
    by = 3 * (y2 - y1) - cy
    ay = 1 - cy - by

    def sx(t):
        return ((ax * t + bx) * t + cx) * t

    def sy(t):
        return ((ay * t + by) * t + cy) * t

    def solve(x):
        if x <= 0:
            return 0.0
        if x >= 1:
            return 1.0
        lo, hi, t = 0.0, 1.0, x
        for _ in range(40):
            v = sx(t)
            if abs(v - x) < 1e-6:
                break
            if v < x:
                lo = t
            else:
                hi = t
            t = (lo + hi) / 2
        return sy(t)

    return solve


def ease(name: Optional[str], t: float) -> float:
    t = min(1.0, max(0.0, t))
    if not name:
        return EASINGS["cubicOut"](t)
    if name.startswith("bezier:"):
        try:
            x1, y1, x2, y2 = (float(v) for v in name[7:].split(","))
            return cubic_bezier(x1, y1, x2, y2)(t)
        except ValueError:
            return t
    return EASINGS.get(name, EASINGS["cubicOut"])(t)


# --------------------------------------------------------------------- animation


def _rest() -> dict:
    return dict(visible=True, opacity=1.0, progress=1.0, reveal="none", chars=1.0, scale=1.0,
                dx=0.0, dy=0.0, glow=0.0, flash=0.0, blur=0.0)


def _clamp01(v: float) -> float:
    return min(1.0, max(0.0, v))


def _apply_preset(s: dict, preset: str, k: float, raw: float, spec: dict, is_out: bool) -> None:
    if preset == "none":
        return
    if preset == "fade":
        s["opacity"] *= k
    elif preset == "scale":
        s["scale"] *= k
        s["opacity"] *= _clamp01(k * 3)
    elif preset == "pop":
        s["scale"] *= max(0.0, k if is_out else EASINGS["backOut"](raw))
        s["opacity"] *= _clamp01(raw * 4)
    elif preset == "bounce":
        s["scale"] *= k if is_out else _bounce_out(raw)
        s["opacity"] *= _clamp01(raw * 5)
    elif preset == "slide":
        d = 0.06 * (1 - k)
        dx, dy = {"left": (-d, 0.0), "right": (d, 0.0), "down": (0.0, -d)}.get(spec.get("direction") or "up", (0.0, d))
        s["dx"] += -dx if is_out else dx
        s["dy"] += -dy if is_out else dy
        s["opacity"] *= k
    elif preset in ("draw", "wipe"):
        s["progress"] = min(s["progress"], k)
        s["reveal"] = preset
    elif preset == "typewriter":
        s["chars"] = min(s["chars"], k)
        s["progress"] = min(s["progress"], k)
        if s["reveal"] == "none":
            s["reveal"] = "wipe"
    elif preset == "trace":
        s["progress"] = min(s["progress"], k)
        s["reveal"] = "draw"
        s["glow"] += 0.7 * (1 - raw * 0.5)
    elif preset == "pulse":
        s["opacity"] *= k
        s["scale"] *= 1 + 0.12 * math.sin(raw * math.pi * 3) * (1 - raw)
    elif preset == "glow":
        s["opacity"] *= k
        s["glow"] += math.sin(raw * math.pi) * 0.9
    elif preset == "flash":
        s["opacity"] *= 1.0 if raw >= 1 else (1.0 if int(raw * 8) % 2 == 0 else 0.15)
        s["flash"] += (1 - raw) * 0.6
    elif preset == "highlight":
        s["opacity"] *= k
        s["flash"] += math.sin(raw * math.pi) * 0.5
        s["glow"] += math.sin(raw * math.pi) * 0.4
    elif preset == "cinematic":
        s["opacity"] *= k
        s["scale"] *= 1.12 - 0.12 * k
        s["dy"] += (1 - k) * 0.02
        s["blur"] += (1 - k) * 10


def _apply_emphasis(s: dict, em: Optional[dict], local: float) -> None:
    if not em or em.get("preset", "none") == "none" or em.get("duration", 0) <= 0:
        return
    p = (local - em.get("start", 0)) / em["duration"]
    if p < 0 or p > 1:
        return
    cycles = max(1, em.get("cycles", 1))
    wave = (1 - math.cos(p * cycles * 2 * math.pi)) / 2
    preset = em["preset"]
    if preset == "pulse":
        s["scale"] *= 1 + 0.1 * wave
    elif preset == "glow":
        s["glow"] += wave * 0.9
    elif preset == "flash":
        s["opacity"] *= 1 - 0.75 * wave
    elif preset == "highlight":
        s["flash"] += wave * 0.45
        s["glow"] += wave * 0.3


def eval_anim(obj: dict, t: float) -> Optional[dict]:
    """Animation state of a plan object at time t (None = not visible)."""
    local = t - obj["start"]
    if local < 0 or local > obj["duration"] + 1e-9:
        return None
    s = _rest()
    ai = obj.get("animIn") or {}
    if ai.get("preset", "none") != "none" and ai.get("duration", 0) > 0:
        raw = _clamp01((local - (ai.get("delay") or 0)) / min(ai["duration"], obj["duration"]))
        if raw < 1:
            _apply_preset(s, ai["preset"], ease(ai.get("easing"), raw), raw, ai, False)
    elif ai.get("delay", 0) > 0 and local < ai["delay"]:
        return None
    ao = obj.get("animOut") or {}
    if ao.get("preset", "none") != "none" and ao.get("duration", 0) > 0:
        out_dur = min(ao["duration"], obj["duration"])
        out_start = obj["duration"] - out_dur - (ao.get("delay") or 0)
        if local > out_start:
            raw = _clamp01((local - out_start) / out_dur)
            _apply_preset(s, ao["preset"], 1 - ease(ao.get("easing"), raw), 1 - raw, ao, True)
    _apply_emphasis(s, obj.get("emphasis"), local)
    if s["opacity"] <= 0.001:
        return None
    return s


# --------------------------------------------------------------------- chart / camera


def candle_reveal(chart: dict, i: int, t: float) -> tuple[float, float]:
    n = len(chart["candles"])
    local = t - chart["start"]
    if not chart.get("visible", True) or local < 0 or local > chart["duration"]:
        return 0.0, 0.0
    r = chart["reveal"]
    if r["mode"] == "none" or r["duration"] <= 0 or n == 0:
        return 1.0, 1.0
    p = local / r["duration"]
    if r["mode"] == "fade":
        return ease(r.get("easing"), p), 1.0
    slot = 1 / n
    overlap = 4 if r["mode"] == "cascade" else 1
    raw = (p - i * slot) / (slot * overlap)
    k = ease(r.get("easing"), _clamp01(raw))
    if r["mode"] == "grow":
        return (1.0 if k > 0 else 0.0), k
    return k, (min(1.0, 0.35 + k * 0.65) if r["mode"] == "sequential" else 1.0)


def reveal_head(chart: dict, t: float) -> float:
    n = len(chart["candles"])
    if n == 0:
        return 0.0
    r = chart["reveal"]
    if r["mode"] in ("none", "fade") or r["duration"] <= 0:
        return float(n - 1)
    p = _clamp01((t - chart["start"]) / r["duration"])
    return min(n - 1.0, p * n)


FOLLOW_ANCHOR = 0.72


def _effective(kf: dict, t: float, chart: dict) -> dict:
    follow = kf.get("follow") or {"mode": "none"}
    st = kf["state"]
    if follow.get("mode") == "price" and chart["candles"]:
        cs = chart["candles"]
        head = reveal_head(chart, t)
        i0 = int(math.floor(head))
        i1 = min(len(cs) - 1, i0 + 1)
        fr = head - i0
        price = cs[i0]["c"] + (cs[i1]["c"] - cs[i0]["c"]) * fr
        return {**st, "cx": head + st["span"] * (0.5 - FOLLOW_ANCHOR), "cy": price}
    return st


def _lerp_cam(a: dict, b: dict, k: float) -> dict:
    def lg(x, y):
        return math.exp(math.log(max(x, 1e-12)) + (math.log(max(y, 1e-12)) - math.log(max(x, 1e-12))) * k)

    return {
        "cx": a["cx"] + (b["cx"] - a["cx"]) * k,
        "cy": a["cy"] + (b["cy"] - a["cy"]) * k,
        "span": lg(a["span"], b["span"]),
        "priceSpan": lg(a["priceSpan"], b["priceSpan"]),
    }


def eval_camera(plan: dict, t: float) -> dict:
    kfs = sorted(plan["camera"]["keyframes"], key=lambda k: k["time"])
    chart = plan["chart"]
    if not kfs:
        return plan["camera"]["base"]
    if t <= kfs[0]["time"]:
        return _effective(kfs[0], t, chart)
    if t >= kfs[-1]["time"]:
        return _effective(kfs[-1], t, chart)
    i = 0
    while i < len(kfs) - 1 and kfs[i + 1]["time"] < t:
        i += 1
    a, b = kfs[i], kfs[i + 1]
    k = ease(b.get("easing"), (t - a["time"]) / max(1e-6, b["time"] - a["time"]))
    return _lerp_cam(_effective(a, t, chart), _effective(b, t, chart), k)


def _nice_step(rng: float, target: float) -> float:
    raw = rng / max(1.0, target)
    mag = 10 ** math.floor(math.log10(raw)) if raw > 0 else 1
    norm = raw / mag
    step = 1 if norm < 1.5 else 2 if norm < 3 else 5 if norm < 7 else 10
    return step * mag


def format_time(unix: float, tf_seconds: int, with_date: bool = False) -> str:
    d = datetime.fromtimestamp(unix, tz=timezone.utc)
    date = f"{d.day} {d.strftime('%b')}"
    if tf_seconds >= 86400:
        return date
    hm = d.strftime("%H:%M")
    return f"{date} {hm}" if with_date else hm


# --------------------------------------------------------------------- helpers

_DASH = {"dashed": "--", "dotted": ":", "solid": "-"}


def _hex(c: Optional[str], alpha: float = 1.0, whiten: float = 0.0) -> str:
    r, g, b, a = _hex_to_rgba(c or "#ffffff")
    w = _clamp01(whiten)
    r, g, b = (v + (1 - v) * w for v in (r, g, b))
    a = _clamp01(a * alpha)
    return "#%02x%02x%02x%02x" % (round(r * 255), round(g * 255), round(b * 255), round(a * 255))


def _mpl_text(s: str) -> str:
    # '$' would trigger matplotlib mathtext
    return s.replace("$", r"\$")


def _clip_polyline_x(pts: list, xmax: float) -> list:
    out = [pts[0]]
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        if x1 <= xmax:
            out.append((x1, y1))
            continue
        if x0 < xmax and x1 != x0:
            k = (xmax - x0) / (x1 - x0)
            out.append((xmax, y0 + (y1 - y0) * k))
        break
    return out


def _partial_polyline(pts: list, k: float, sx: float, sy: float) -> list:
    """Length-proportional partial path, measured in screen space (sx/sy px per unit)."""
    if k >= 1 or len(pts) < 2:
        return pts
    lens = [math.hypot((b[0] - a[0]) * sx, (b[1] - a[1]) * sy) for a, b in zip(pts, pts[1:])]
    want = sum(lens) * max(0.0, k)
    out = [pts[0]]
    for (a, b), ln in zip(zip(pts, pts[1:]), lens):
        if want >= ln:
            out.append(b)
            want -= ln
        else:
            f = want / ln if ln else 0
            out.append((a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f))
            break
    return out


_MARKERS = {"circle": "●", "x": "✕", "diamond": "◆", "triangleUp": "▲", "triangleDown": "▼"}


def _decode_data_url(src: str) -> bytes:
    if src.startswith("data:"):
        return base64.b64decode(src.split(",", 1)[1])
    with open(src, "rb") as f:
        return f.read()


# --------------------------------------------------------------------- scene


class ProjectScene(Scene):
    """A Scene whose elements are rebuilt from a render plan every frame."""

    def __init__(self, plan: dict, config: RenderConfig):
        if plan.get("format") != PLAN_FORMAT:
            raise ValueError("not a tradeanim render plan")
        super().__init__(config)
        self.plan = plan
        self.chart = None  # time labels are drawn by ProjectRenderer
        s = plan["settings"]
        self.W, self.H = config.width, config.height
        self.ref = min(self.W, self.H) / 1080.0
        self.axis_w = AXIS_W * self.ref if s.get("showPriceAxis", True) else 0.0
        self.axis_h = AXIS_H * self.ref if s.get("showTimeAxis", True) else 0.0
        self.plot_w = self.W - self.axis_w
        self.plot_h = self.H - self.axis_h
        self.overlay: list = []
        self.t = 0.0
        self._built = True

    @property
    def total_duration(self) -> float:
        return float(self.plan["settings"]["duration"])

    def construct(self):
        pass

    # --- coordinate helpers (valid after update())
    def _px_per_bar(self) -> float:
        return self.plot_w / self.cam["span"]

    def _px_per_price(self) -> float:
        return self.plot_h / self.cam["priceSpan"]

    def _pts(self, px: float) -> float:
        """reference px -> matplotlib points (dpi aware)."""
        return px * self.ref * 72.0 / self.config.dpi

    def update(self, t: float):
        self.t = t
        cam = eval_camera(self.plan, t)
        self.cam = cam
        self.camera.view_start = cam["cx"] - cam["span"] / 2 + 0.5
        self.camera.view_end = cam["cx"] + cam["span"] / 2 - 0.5
        self.camera.price_min = cam["cy"] - cam["priceSpan"] / 2
        self.camera.price_max = cam["cy"] + cam["priceSpan"] / 2
        self._elements = []
        self.overlay = []
        self._build_candles(t)
        for obj in self.plan["objects"]:
            st = eval_anim(obj, t)
            if st is None:
                continue
            self._build_object(obj, st)

    # ------------------------------------------------------------- candles
    def _build_candles(self, t: float):
        chart = self.plan["chart"]
        cs = chart["candles"]
        if not cs or not chart.get("visible", True):
            return
        x0 = self.camera.view_start - 2
        x1 = self.camera.view_end + 2
        theme = self.plan["theme"]
        for i in range(max(0, int(x0)), min(len(cs), int(x1) + 1)):
            c = cs[i]
            a, g = candle_reveal(chart, i, t)
            if a <= 0.001:
                continue
            st = c.get("style") or {}
            o = c["o"]
            bull = c["c"] >= c["o"]
            el = CandleElement(
                index=i,
                open=o,
                close=o + (c["c"] - o) * g,
                high=o + (c["h"] - o) * g,
                low=o + (c["l"] - o) * g,
                opacity=a * float(st.get("opacity", 1.0)),
                visible=True,
            )
            col = st.get("bodyColor")
            if col:
                if bull:
                    el.bull_color = col
                else:
                    el.bear_color = col
            if st.get("glow"):
                el.glow_enabled = True
                el.glow_intensity = 0.12 * float(st["glow"])
            el.bull_color = el.bull_color or theme["bull"]
            el.bear_color = el.bear_color or theme["bear"]
            self._elements.append(el)

    # ------------------------------------------------------------- objects
    def _build_object(self, obj: dict, st: dict):
        alpha = float(obj.get("opacity", 1.0)) * st["opacity"]
        prims = obj["primitives"]
        # frame-fraction offsets -> data units
        dxd = st["dx"] * self.W / self._px_per_bar()
        dyd = -st["dy"] * self.H / self._px_per_price()
        reveal = st["reveal"]
        progress = st["progress"]
        draw = progress if reveal == "draw" else 1.0
        glow = float(obj.get("glow", 0.0)) + st["glow"]
        flash = st["flash"]
        scale = st["scale"]

        # wipe clip in data x
        clip_x = None
        if reveal == "wipe" and progress < 1:
            xs = []
            for p in prims:
                if p["k"] in ("rect",):
                    xs += [p["x1"], self.camera.view_end + 0.5 if p.get("extendRight") else p["x2"]]
                elif p["k"] == "line":
                    xs += [q[0] for q in p["pts"]]
                elif p["k"] == "hline":
                    xs += [self.camera.view_start - 0.5 if p["x1"] is None else p["x1"], self.camera.view_end + 0.5 if p["x2"] is None else p["x2"]]
                elif p["k"] in ("text", "marker") and p.get("space") != "frame":
                    xs.append(p["x"])
                elif p["k"] == "vband":
                    xs += [p["x1"], p["x2"]]
            if xs:
                clip_x = min(xs) + (max(xs) - min(xs)) * progress

        for p in prims:
            k = p["k"]
            pa = alpha * float(p.get("alpha", 1.0))
            if k in ("image", "spotlight", "vignette", "flash", "glowOrb") or p.get("space") == "frame":
                self.overlay.append((obj, p, st, pa))
                continue
            if k == "rect":
                x1 = p["x1"] + dxd
                x2 = (self.camera.view_end + 0.5) if p.get("extendRight") else p["x2"] + dxd
                y1, y2 = sorted((p["y1"] + dyd, p["y2"] + dyd))
                if clip_x is not None:
                    x2 = min(x2, max(x1, clip_x + dxd))
                if reveal == "draw":
                    x2 = x1 + (x2 - x1) * draw
                if x2 <= x1:
                    continue
                stroke = p.get("stroke")
                self._elements.append(ZoneElement(
                    x1=x1, x2=x2, y1=y1, y2=y2,
                    fill_color=_hex(p.get("fill") or "#000000", float(p.get("fillAlpha", 1.0)) if p.get("fill") else 0.0, flash),
                    border_color=_hex(stroke, 1.0, flash) if stroke and p.get("width", 1) > 0 else None,
                    border_width=max(0.5, self._pts(p.get("width", 1))),
                    border_style=_DASH.get(p.get("dash") or "solid", "-"),
                    opacity=pa,
                ))
            elif k == "line":
                pts = [(q[0] + dxd, q[1] + dyd) for q in p["pts"]]
                if p.get("extendRight") and len(pts) >= 2:
                    (ax_, ay_), (bx_, by_) = pts[-2], pts[-1]
                    if bx_ - ax_ > 1e-9:
                        xe = self.camera.view_end + 2
                        pts.append((xe, by_ + (xe - bx_) * (by_ - ay_) / (bx_ - ax_)))
                if clip_x is not None:
                    pts = _clip_polyline_x(pts, clip_x + dxd)
                pts = _partial_polyline(pts, draw, self._px_per_bar(), self._px_per_price())
                if len(pts) < 2:
                    continue
                color = _hex(p["stroke"], 1.0, flash)
                lw = max(0.5, self._pts(p["width"]))
                if glow > 0.05:
                    self._elements.append(LineElement(points_x=[q[0] for q in pts], points_y=[q[1] for q in pts], color=color, linewidth=lw * 4, opacity=pa * min(0.35, 0.2 * glow)))
                self._elements.append(LineElement(points_x=[q[0] for q in pts], points_y=[q[1] for q in pts], color=color, linewidth=lw, linestyle=_DASH.get(p.get("dash") or "solid", "-"), opacity=pa))
                if p.get("arrowEnd"):
                    (ax_, ay_), (bx_, by_) = pts[-2], pts[-1]
                    self._elements.append(ArrowElement(x1=ax_ + (bx_ - ax_) * 0.9, y1=ay_ + (by_ - ay_) * 0.9, x2=bx_, y2=by_, color=color, linewidth=lw, opacity=pa))
            elif k == "hline":
                x1 = self.camera.view_start - 0.5 if p["x1"] is None else p["x1"] + dxd
                x2 = self.camera.view_end + 0.5 if p["x2"] is None else p["x2"] + dxd
                if clip_x is not None:
                    x2 = min(x2, clip_x + dxd)
                x2 = x1 + (x2 - x1) * draw
                if x2 <= x1:
                    continue
                self._elements.append(HLineElement(y=p["y"] + dyd, x_start=x1, x_end=x2, color=_hex(p["stroke"], 1.0, flash), linewidth=max(0.5, self._pts(p["width"])), linestyle=_DASH.get(p.get("dash") or "solid", "-"), opacity=pa))
            elif k == "vband":
                x1, x2 = sorted((p["x1"] + dxd, p["x2"] + dxd))
                if clip_x is not None:
                    x2 = min(x2, clip_x)
                if x2 <= x1:
                    continue
                span = self.cam["priceSpan"]
                self._elements.append(ZoneElement(x1=x1, x2=x2, y1=self.cam["cy"] - span * 2, y2=self.cam["cy"] + span * 2, fill_color=_hex(p["fill"], float(p.get("fillAlpha", 0.1)) * draw, flash), border_color=None, opacity=pa))
            elif k == "ellipse":
                n = 72
                ang = [(-math.pi / 2) + 2 * math.pi * i / n for i in range(n + 1)]
                pts = [(p["cx"] + dxd + p["rx"] * math.cos(a), p["cy"] + dyd + p["ry"] * math.sin(a)) for a in ang]
                pts = _partial_polyline(pts, draw, self._px_per_bar(), self._px_per_price())
                if p.get("stroke") and len(pts) >= 2:
                    self._elements.append(LineElement(points_x=[q[0] for q in pts], points_y=[q[1] for q in pts], color=_hex(p["stroke"], 1.0, flash), linewidth=max(0.5, self._pts(p.get("width", 2))), linestyle=_DASH.get(p.get("dash") or "solid", "-"), opacity=pa))
            elif k == "marker":
                if draw < 0.85 or (clip_x is not None and p["x"] > clip_x):
                    continue
                self._elements.append(TextElement(text=_MARKERS.get(p["shape"], "●"), x=p["x"] + dxd, y=p["y"] + dyd, color=_hex(p["color"], 1.0, flash), font_size=self._pts(p["size"] * 2.6), ha="center", va="center", opacity=pa, font_family="DejaVu Sans"))
            elif k == "text":
                if reveal == "draw" and draw < 0.7:
                    continue
                self._elements.append(self._text_element(p, st, pa, dxd, dyd, scale, flash))

    def _text_element(self, p: dict, st: dict, pa: float, dxd: float, dyd: float, scale: float, flash: float) -> TextElement:
        x = p["x"] + dxd + float(p.get("dx", 0)) * self.ref / self._px_per_bar()
        y = p["y"] + dyd - float(p.get("dy", 0)) * self.ref / self._px_per_price()
        ha = p.get("align") or "left"
        va = {"top": "top", "bottom": "bottom"}.get(p.get("baseline") or "middle", "center")
        if p.get("pinRight"):
            x = self.camera.view_end + 0.5 - 2 / self._px_per_bar()
            ha = "right"
        bbox = None
        fs = self._pts(p["size"]) * scale
        if p.get("bg"):
            pad = float(p.get("pad", 4)) * self.ref * 72.0 / self.config.dpi
            bbox = dict(boxstyle=f"round,pad={max(0.05, pad / max(fs, 1)):.3f}", facecolor=_hex(p["bg"], float(p.get("bgAlpha", 1.0)) * pa, flash), edgecolor="none")
            # keep the pill clear of the anchor like the browser renderer does
            if va == "bottom":
                y += float(p.get("pad", 4)) * self.ref / self._px_per_price()
            elif va == "top":
                y -= float(p.get("pad", 4)) * self.ref / self._px_per_price()
        text = _mpl_text(p["text"])
        el = TextElement(
            text=text,
            x=x,
            y=y,
            color=_hex(p["color"], 1.0, flash),
            font_size=fs,
            font_weight="bold" if (p.get("weight") or 600) >= 600 else "normal",
            font_family="DejaVu Sans",
            ha=ha,
            va=va,
            bbox=bbox,
            char_progress=st["chars"],
            opacity=pa,
        )
        return el


# --------------------------------------------------------------------- renderer


class ProjectRenderer(Renderer):
    """Renderer laid out like the web editor: plot + right price axis + bottom time axis,
    plus a full-figure overlay axes for frame-space text, media and screen effects."""

    def __init__(self, config: RenderConfig, scene: ProjectScene):
        super().__init__(config)
        self.scene = scene
        self._ov = None
        self._images: dict = {}

    def setup(self):
        import matplotlib.pyplot as plt

        c = self.config
        s = self.scene
        fig_w = self._render_w / self._render_dpi
        fig_h = self._render_h / self._render_dpi
        self._fig = plt.figure(figsize=(fig_w, fig_h), dpi=self._render_dpi)
        self._fig.set_facecolor(c.theme.background)
        left, bottom = 0.0, s.axis_h / s.H
        self._ax = self._fig.add_axes([left, bottom, s.plot_w / s.W, s.plot_h / s.H])
        self._setup_ax(self._ax, show_x=True)
        self._ov = self._fig.add_axes([0, 0, 1, 1], zorder=10)
        self._ov.set_axis_off()
        self._ov.patch.set_alpha(0)

    def _setup_ax(self, ax, show_x=True):
        super()._setup_ax(ax, show_x=show_x)
        ax.set_facecolor(self.config.theme.background)
        for side in ("top", "left"):
            ax.spines[side].set_visible(False)

    def _draw_frame(self, scene: ProjectScene):  # type: ignore[override]
        super()._draw_frame(scene)
        ax = self._ax
        s = scene
        plan = s.plan
        theme = plan["theme"]
        fs = max(5.0, 19 * s.ref * 72.0 / self.config.dpi)
        for side in ("top", "left"):
            ax.spines[side].set_visible(False)
        for side in ("right", "bottom"):
            ax.spines[side].set_color(theme.get("axisLine", "#252b38"))
        # price axis: inside the frame on the right, editor-style
        if plan["settings"].get("showPriceAxis", True):
            dec = int(plan.get("decimals", 2))
            ax.yaxis.set_major_formatter(FuncFormatter(lambda v, _pos, d=dec: f"{v:,.{d}f}"))
            ax.tick_params(axis="y", which="both", right=False, labelright=True, left=False, labelleft=False, pad=6 * s.ref, labelsize=fs, labelcolor=theme["axisText"])
        else:
            ax.tick_params(axis="y", which="both", left=False, right=False, labelleft=False, labelright=False)
        # time axis
        if plan["settings"].get("showTimeAxis", True):
            chart = plan["chart"]
            vs, ve = s.camera.view_start - 0.5, s.camera.view_end + 0.5
            px_per_bar = s._px_per_bar()
            step = max(1, round(_nice_step(110 * max(s.ref, 0.6) / max(px_per_bar, 1e-6), 1)))
            ticks = list(range(int(math.ceil(vs / step)) * step, int(ve) + 1, step))
            tf = int(chart.get("timeframeSeconds", 900))
            labels, prev_day = [], None
            for i in ticks:
                if 0 <= i < len(chart["candles"]) and chart["candles"][i].get("time"):
                    unix = chart["candles"][i]["time"]
                else:
                    unix = chart["startTime"] + i * tf
                day = unix // 86400
                labels.append(format_time(unix, tf, prev_day is not None and day != prev_day))
                prev_day = day
            ax.set_xticks(ticks)
            ax.set_xticklabels(labels, rotation=0, ha="center", fontsize=fs, color=theme["axisText"])
            ax.tick_params(axis="x", which="both", bottom=False, pad=8 * s.ref)
        else:
            ax.tick_params(axis="x", which="both", bottom=False, labelbottom=False)
        if plan["settings"].get("watermark"):
            ax.text(0.5, 0.5, _mpl_text(plan["settings"]["watermark"]), transform=ax.transAxes, ha="center", va="center", fontsize=64 * s.ref * 0.72, color=theme["axisText"], alpha=0.12, fontweight="bold", zorder=0)
        self._draw_overlay(scene)

    # ------------------------------------------------------------- overlay
    def _fig_xy(self, x: float, y: float) -> tuple[float, float]:
        """world (bar, price) -> overlay coords (0..1, y down)."""
        disp = self._ax.transData.transform((x, y))
        fx, fy = self._fig.transFigure.inverted().transform(disp)
        return fx, 1 - fy

    def _draw_overlay(self, scene: ProjectScene):
        ov = self._ov
        ov.cla()
        ov.set_axis_off()
        ov.set_xlim(0, 1)
        ov.set_ylim(1, 0)
        W, H = scene.W, scene.H
        order = {"spotlight": 0, "vignette": 0, "glowOrb": 1, "image": 2, "text": 2, "flash": 3}
        items = sorted(scene.overlay, key=lambda it: order.get(it[1]["k"], 2))
        for obj, p, st, pa in items:
            k = p["k"]
            if k in ("spotlight", "vignette", "glowOrb"):
                self._radial(ov, p, pa, W, H)
            elif k == "flash":
                from matplotlib.patches import Rectangle

                ov.add_patch(Rectangle((0, 0), 1, 1, facecolor=_hex(p["color"]), alpha=_clamp01(p["strength"] * pa), edgecolor="none", zorder=30))
            elif k == "image":
                self._image(ov, obj, p, st, pa, W, H)
            elif k == "text":
                self._frame_text(ov, p, st, pa, scene)

    def _radial(self, ov, p: dict, pa: float, W: int, H: int):
        gw, gh = 320, max(2, int(320 * H / W))
        yy, xx = np.mgrid[0:gh, 0:gw]
        X = (xx + 0.5) / gw * W
        Y = (yy + 0.5) / gh * H
        short = min(W, H)
        rgba = np.zeros((gh, gw, 4), dtype=np.float32)
        if p["k"] == "vignette":
            cx, cy = W / 2, H / 2
            d = math.hypot(W, H) / 2
            r = np.sqrt((X - cx) ** 2 + (Y - cy) ** 2) / d
            a = np.clip((r - 0.45) / 0.55, 0, 1) * p["strength"]
        else:
            fx, fy = self._fig_xy(p["x"], p["y"])
            cx, cy = fx * W, fy * H
            R = p["r"] * short
            r = np.sqrt((X - cx) ** 2 + (Y - cy) ** 2)
            if p["k"] == "spotlight":
                a = np.clip((r - R * 0.75) / (R * 0.5), 0, 1) * p["dim"]
            else:  # glowOrb
                rr, gg, bb, _ = _hex_to_rgba(p["color"])
                rgba[..., 0], rgba[..., 1], rgba[..., 2] = rr, gg, bb
                a = np.clip(1 - r / R, 0, 1) ** 2 * 0.85
        rgba[..., 3] = np.clip(a * pa, 0, 1)
        ov.imshow(rgba, extent=(0, 1, 1, 0), interpolation="bilinear", zorder=5, aspect="auto")
        ov.set_xlim(0, 1)
        ov.set_ylim(1, 0)

    def _image(self, ov, obj, p: dict, st: dict, pa: float, W: int, H: int):
        asset = next((a for a in self.scene.plan.get("assets", []) if a["id"] == p["assetId"]), None)
        if not asset:
            return
        img = self._images.get(asset["id"])
        if img is None:
            from PIL import Image

            img = np.asarray(Image.open(io.BytesIO(_decode_data_url(asset["src"]))).convert("RGBA"))
            self._images[asset["id"]] = img
        ih, iw = img.shape[:2]
        bw, bh = p["w"] * W, p["h"] * H
        k = min(bw / iw, bh / ih) * st["scale"]
        w, h = iw * k / W, ih * k / H
        cx = p["x"] + p["w"] / 2 + st["dx"]
        cy = p["y"] + p["h"] / 2 + st["dy"]
        ov.imshow(img, extent=(cx - w / 2, cx + w / 2, cy + h / 2, cy - h / 2), alpha=_clamp01(pa), zorder=20, interpolation="bilinear", aspect="auto")
        ov.set_xlim(0, 1)
        ov.set_ylim(1, 0)

    def _frame_text(self, ov, p: dict, st: dict, pa: float, scene: ProjectScene):
        fs = scene._pts(p["size"]) * st["scale"]
        text = p["text"]
        if st["chars"] < 1:
            text = text[: int(math.ceil(len(text) * st["chars"]))]
        if not text:
            return
        max_w = p.get("maxWidth")
        if max_w:
            px = p["size"] * scene.ref
            per_line = max(4, int(max_w * scene.W / (0.56 * px)))
            text = "\n".join(textwrap.fill(line, per_line) for line in text.split("\n"))
        kw = {}
        if p.get("bg"):
            pad = float(p.get("pad", 4)) * scene.ref * 72.0 / self.config.dpi
            kw["bbox"] = dict(boxstyle=f"round,pad={max(0.05, pad / max(fs, 1)):.3f}", facecolor=_hex(p["bg"], float(p.get("bgAlpha", 1.0)) * pa), edgecolor="none")
        ov.text(
            p["x"] + st["dx"],
            p["y"] + st["dy"],
            _mpl_text(text),
            ha=p.get("align") or "center",
            va={"top": "top", "bottom": "bottom"}.get(p.get("baseline") or "middle", "center"),
            fontsize=fs,
            color=_hex(p["color"], 1.0, st["flash"]),
            alpha=_clamp01(pa),
            fontweight="bold" if (p.get("weight") or 600) >= 600 else "normal",
            linespacing=1.18,
            zorder=25,
            **kw,
        )


# --------------------------------------------------------------------- entry points

QUALITY = {"draft": (28, "veryfast"), "standard": (20, "medium"), "high": (16, "slow")}


def theme_from_plan(plan: dict) -> Theme:
    t = plan["theme"]
    return Theme(
        background=t["background"],
        panel_bg=t["background"],
        grid_color=t["grid"],
        text_color=t["axisText"],
        axis_color=t["axisText"],
        bull_color=t["bull"],
        bear_color=t["bear"],
        bull_body=t["bull"],
        bear_body=t["bear"],
        bull_wick=t.get("bullWick", t["bull"]),
        bear_wick=t.get("bearWick", t["bear"]),
    )


def render_plan(
    plan: dict,
    output_path: str,
    width: Optional[int] = None,
    height: Optional[int] = None,
    fps: Optional[int] = None,
    quality: str = "standard",
    on_progress: Optional[Callable[[int, int], None]] = None,
) -> str:
    """Render a web-editor render plan to MP4. Returns the output path."""
    s = plan["settings"]
    W = int(width or s["width"])
    H = int(height or s["height"])
    W -= W % 2
    H -= H % 2
    crf, preset = QUALITY.get(quality, QUALITY["standard"])
    ref = min(W, H) / 1080.0
    config = RenderConfig(
        width=W,
        height=H,
        fps=int(fps or s["fps"]),
        dpi=100,
        crf=crf,
        preset=preset,
        theme=theme_from_plan(plan),
        show_grid=bool(s.get("showGrid", True)),
        grid_alpha=1.0,
        grid_linewidth=max(0.4, 0.72 * ref),
        candle_width=float(plan["chart"]["style"].get("bodyWidth", 0.7)),
        wick_linewidth=max(0.5, float(plan["chart"]["style"].get("wickWidth", 1.5)) * ref * 0.72),
        font_family="DejaVu Sans",
        candle_body_style="square,pad=0",
    )
    scene = ProjectScene(plan, config)
    renderer = ProjectRenderer(config, scene)
    video_path = output_path
    audio = [a for a in plan.get("audio", []) if a.get("assetId")]
    if audio:
        video_path = output_path + ".video.mp4"
    renderer.render_scene(scene, video_path, on_progress=on_progress)
    if not os.path.exists(video_path) or os.path.getsize(video_path) == 0:
        raise RuntimeError("ffmpeg produced no output")
    if audio:
        mux_audio(plan, video_path, output_path, config)
        os.remove(video_path)
    return output_path


def mux_audio(plan: dict, video_path: str, output_path: str, config: RenderConfig) -> None:
    """Mix audio clips and duck music under narration when Voice Focus is enabled."""
    ffmpeg = resolve_ffmpeg(config.ffmpeg_path) or "ffmpeg"
    assets = {a["id"]: a for a in plan.get("assets", [])}
    clips = [a for a in plan.get("audio", []) if a["assetId"] in assets]
    with tempfile.TemporaryDirectory() as tmp:
        inputs, filters = [], []
        for n, clip in enumerate(clips):
            path = os.path.join(tmp, f"a{n}")
            with open(path, "wb") as f:
                f.write(_decode_data_url(assets[clip["assetId"]]["src"]))
            inputs += ["-i", path]
            delay = max(0, int(round(clip["start"] * 1000)))
            filters.append(
                f"[{n + 1}:a]atrim=start={max(0.0, clip.get('offset', 0)):.3f}:duration={clip['duration']:.3f},"
                f"asetpts=PTS-STARTPTS,volume={clip.get('volume', 1):.3f},adelay={delay}|{delay}[a{n}]"
            )
        voice = [n for n, clip in enumerate(clips) if clip.get("role") == "voice" and clip.get("ducking", True)]
        music = [n for n, clip in enumerate(clips) if clip.get("role") == "music" and clip.get("ducking", True)]
        if voice and music:
            voice_inputs = "".join(f"[a{n}]" for n in voice)
            if len(voice) > 1:
                filters.append(f"{voice_inputs}amix=inputs={len(voice)}:normalize=0[voicebus]")
            else:
                filters.append(f"[a{voice[0]}]anull[voicebus]")
            filters.append("[voicebus]asplit=2[voicemix][voicekey]")
            music_inputs = "".join(f"[a{n}]" for n in music)
            if len(music) > 1:
                filters.append(f"{music_inputs}amix=inputs={len(music)}:normalize=0[musicbus]")
            else:
                filters.append(f"[a{music[0]}]anull[musicbus]")
            filters.append("[musicbus][voicekey]sidechaincompress=threshold=0.025:ratio=10:attack=18:release=420:makeup=1[duckedmusic]")
            other = [n for n in range(len(clips)) if n not in voice and n not in music]
            mix = "[duckedmusic][voicemix]" + "".join(f"[a{n}]" for n in other)
            filters.append(f"{mix}amix=inputs={2 + len(other)}:normalize=0:dropout_transition=0[aout]")
        else:
            mix = "".join(f"[a{n}]" for n in range(len(clips)))
            filters.append(f"{mix}amix=inputs={len(clips)}:normalize=0:dropout_transition=0[aout]")
        cmd = [ffmpeg, "-y", "-i", video_path, *inputs, "-filter_complex", ";".join(filters),
               "-map", "0:v", "-map", "[aout]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
               "-t", f"{plan['settings']['duration']:.3f}", output_path]
        r = subprocess.run(cmd, capture_output=True, text=True)
        if r.returncode != 0:
            raise RuntimeError(f"audio mux failed: {r.stderr[-800:]}")
