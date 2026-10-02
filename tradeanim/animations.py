# Animations.

from __future__ import annotations

from typing import TYPE_CHECKING, Optional

from .elements import (
    AreaElement,
    CandleElement,
    Element,
    HLineElement,
    LineElement,
    OHLCBarElement,
    TextElement,
    ZoneElement,
)
from .easing import (
    ease_out_cubic,
    ease_out_back,
    ease_out_elastic,
    ease_out_bounce,
    ease_in_out_cubic,
    linear,
)
from .scene import Animation

if TYPE_CHECKING:
    from .chart import Chart
    from .scene import Scene


class CandlesAppear(Animation):


    def __init__(
        self,
        chart: "Chart",
        start: int = 0,
        end: Optional[int] = None,
        style: str = "sequential",
        auto_camera: bool = True,
        duration: float = 3.0,
        easing=None,
    ):
        if style == "pop":
            easing = easing or ease_out_back
        elif style == "cascade":
            easing = easing or ease_out_cubic
        super().__init__(duration=duration, easing=easing or ease_out_cubic)
        self.chart = chart
        self.start = start
        self.end = end if end is not None else len(chart)
        self.style = style
        self.auto_camera = auto_camera
        self._candles = chart.candles[self.start : self.end]

    def on_start(self, scene: "Scene"):
        for c in self._candles:
            scene.add_element(c)

    def on_update(self, scene: "Scene", progress: float):
        n = len(self._candles)
        if n == 0:
            return

        if self.style in ("all", "fade"):
            for c in self._candles:
                c.visible = True
                c.opacity = progress
                c.scale_y = 1.0
                c.offset_y = 0.0

        elif self.style == "sequential":
            candles_to_show = progress * n
            for i, c in enumerate(self._candles):
                local_p = max(0.0, min(1.0, candles_to_show - i))
                c.visible = local_p > 0
                c.opacity = local_p
                c.scale_y = 1.0
                c.offset_y = 0.0

        elif self.style == "slide_up":
            candles_to_show = progress * n
            for i, c in enumerate(self._candles):
                local_p = max(0.0, min(1.0, candles_to_show - i))
                c.visible = local_p > 0
                c.opacity = local_p
                c.scale_y = 1.0
                price_range = c.high - c.low
                c.offset_y = -(1 - local_p) * price_range * 3

        elif self.style == "pop":
            candles_to_show = progress * n
            for i, c in enumerate(self._candles):
                local_p = max(0.0, min(1.0, candles_to_show - i))
                c.visible = local_p > 0
                c.opacity = min(1.0, local_p * 2)
                c.scale_y = local_p
                c.offset_y = 0.0

        elif self.style == "cascade":
            for i, c in enumerate(self._candles):
                delay = i / n * 0.6
                local_p = max(0.0, min(1.0, (progress - delay) / (1 - 0.6)))
                c.visible = local_p > 0
                c.opacity = local_p
                c.scale_y = 1.0
                c.offset_y = 0.0

        if self.auto_camera:
            visible = [c for c in self._candles if c.visible and c.opacity > 0]
            scene.camera.fit_to_candles(
                visible,
                padding_top=scene.config.padding_top,
                padding_bottom=scene.config.padding_bottom,
                padding_right=scene.config.padding_right,
            )

    def on_finish(self, scene: "Scene"):
        for c in self._candles:
            c.visible = True
            c.opacity = 1.0
            c.scale_y = 1.0
            c.offset_y = 0.0
        if self.auto_camera:
            scene.camera.fit_to_candles(
                self._candles,
                padding_top=scene.config.padding_top,
                padding_bottom=scene.config.padding_bottom,
                padding_right=scene.config.padding_right,
            )


class AddCandles(Animation):


    def __init__(
        self,
        chart: "Chart",
        start: int = 0,
        end: Optional[int] = None,
        auto_camera: bool = True,
        duration: float = 2.0,
        easing=None,
    ):
        super().__init__(duration=duration, easing=easing)
        self.chart = chart
        self.start = start
        self.end = end if end is not None else len(chart)
        self.auto_camera = auto_camera
        self._candles = chart.candles[self.start : self.end]

    def on_start(self, scene: "Scene"):
        for c in self._candles:
            scene.add_element(c)

    def on_update(self, scene: "Scene", progress: float):
        n = len(self._candles)
        candles_to_show = progress * n
        for i, c in enumerate(self._candles):
            local_p = max(0.0, min(1.0, candles_to_show - i))
            c.visible = local_p > 0
            c.opacity = local_p
        if self.auto_camera:
            all_visible = [c for c in self.chart.candles if c.visible and c.opacity > 0]
            scene.camera.fit_to_candles(
                all_visible,
                padding_top=scene.config.padding_top,
                padding_bottom=scene.config.padding_bottom,
                padding_right=scene.config.padding_right,
            )

    def on_finish(self, scene: "Scene"):
        for c in self._candles:
            c.visible = True
            c.opacity = 1.0


class FadeIn(Animation):
    

    def __init__(self, *elements: Element, duration: float = 0.5, easing=None):
        super().__init__(duration=duration, easing=easing)
        self.elements = elements

    def on_start(self, scene: "Scene"):
        for e in self.elements:
            e.opacity = 0.0
            e.visible = True
            scene.add_element(e)

    def on_update(self, scene: "Scene", progress: float):
        for e in self.elements:
            e.opacity = progress


class FadeOut(Animation):

    def __init__(self, *elements: Element, remove: bool = False, duration: float = 0.5, easing=None):
        super().__init__(duration=duration, easing=easing)
        self.elements = elements
        self.remove = remove

    def on_update(self, scene: "Scene", progress: float):
        for e in self.elements:
            e.opacity = 1.0 - progress

    def on_finish(self, scene: "Scene"):
        for e in self.elements:
            e.visible = False
            e.opacity = 0.0
            if self.remove:
                scene.remove_element(e)


class DrawLine(Animation):

    def __init__(self, line: LineElement, duration: float = 2.0, easing=None):
        super().__init__(duration=duration, easing=easing or ease_in_out_cubic)
        self.line = line

    def on_start(self, scene: "Scene"):
        self.line.draw_progress = 0.0
        self.line.visible = True
        self.line.opacity = 1.0
        scene.add_element(self.line)

    def on_update(self, scene: "Scene", progress: float):
        self.line.draw_progress = progress

    def on_finish(self, scene: "Scene"):
        self.line.draw_progress = 1.0


class TypeText(Animation):

    def __init__(self, text: TextElement, duration: float = 1.0, easing=None):
        super().__init__(duration=duration, easing=easing or linear)
        self.text = text

    def on_start(self, scene: "Scene"):
        self.text.char_progress = 0.0
        self.text.visible = True
        self.text.opacity = 1.0
        scene.add_element(self.text)

    def on_update(self, scene: "Scene", progress: float):
        self.text.char_progress = progress


class HighlightZone(Animation):

    def __init__(self, zone: ZoneElement, duration: float = 0.8, easing=None):
        super().__init__(duration=duration, easing=easing)
        self.zone = zone

    def on_start(self, scene: "Scene"):
        self.zone.opacity = 0.0
        self.zone.visible = True
        scene.add_element(self.zone)

    def on_update(self, scene: "Scene", progress: float):
        self.zone.opacity = progress


class PanCamera(Animation):

    def __init__(
        self,
        view_start: float,
        view_end: float,
        price_min: Optional[float] = None,
        price_max: Optional[float] = None,
        duration: float = 1.5,
        easing=None,
    ):
        super().__init__(duration=duration, easing=easing or ease_in_out_cubic)
        self.target_start = view_start
        self.target_end = view_end
        self.target_pmin = price_min
        self.target_pmax = price_max
        self._initial = None

    def on_start(self, scene: "Scene"):
        cam = scene.camera
        self._initial = (cam.view_start, cam.view_end, cam.price_min, cam.price_max)
        if self.target_pmin is None:
            self.target_pmin = cam.price_min
        if self.target_pmax is None:
            self.target_pmax = cam.price_max

    def on_update(self, scene: "Scene", progress: float):
        s0, e0, p0, p1 = self._initial
        cam = scene.camera
        cam.view_start = s0 + (self.target_start - s0) * progress
        cam.view_end = e0 + (self.target_end - e0) * progress
        cam.price_min = p0 + (self.target_pmin - p0) * progress
        cam.price_max = p1 + (self.target_pmax - p1) * progress


class ZoomTo(Animation):

    def __init__(
        self,
        chart: "Chart",
        start_idx: int,
        end_idx: int,
        padding: float = 0.1,
        duration: float = 1.5,
        easing=None,
    ):
        super().__init__(duration=duration, easing=easing or ease_in_out_cubic)
        self.chart = chart
        self.start_idx = start_idx
        self.end_idx = end_idx
        self.padding = padding
        self._initial = None
        self._targets = None

    def on_start(self, scene: "Scene"):
        cam = scene.camera
        self._initial = (cam.view_start, cam.view_end, cam.price_min, cam.price_max)
        candles = self.chart.candles[self.start_idx : self.end_idx + 1]
        highs = [c.high for c in candles]
        lows = [c.low for c in candles]
        price_range = max(highs) - min(lows)
        self._targets = (
            self.start_idx - 1,
            self.end_idx + 3,
            min(lows) - price_range * self.padding,
            max(highs) + price_range * self.padding,
        )

    def on_update(self, scene: "Scene", progress: float):
        s0, e0, p0, p1 = self._initial
        ts, te, tp0, tp1 = self._targets
        cam = scene.camera
        cam.view_start = s0 + (ts - s0) * progress
        cam.view_end = e0 + (te - e0) * progress
        cam.price_min = p0 + (tp0 - p0) * progress
        cam.price_max = p1 + (tp1 - p1) * progress


class FlashCandle(Animation):

    def __init__(self, candle: CandleElement, flash_color: str = "#FFD54F", cycles: int = 3, duration: float = 1.0):
        super().__init__(duration=duration, easing=linear)
        self.candle = candle
        self.flash_color = flash_color
        self.cycles = cycles
        self._orig_bull = None
        self._orig_bear = None

    def on_start(self, scene: "Scene"):
        self._orig_bull = self.candle.bull_color
        self._orig_bear = self.candle.bear_color

    def on_update(self, scene: "Scene", progress: float):
        import math
        pulse = 0.5 + 0.5 * math.sin(progress * self.cycles * 2 * math.pi)
        if pulse > 0.5:
            self.candle.bull_color = self.flash_color
            self.candle.bear_color = self.flash_color
        else:
            self.candle.bull_color = self._orig_bull
            self.candle.bear_color = self._orig_bear

    def on_finish(self, scene: "Scene"):
        self.candle.bull_color = self._orig_bull
        self.candle.bear_color = self._orig_bear


class SlideIn(Animation):

    def __init__(self, element, direction: str = "left", distance: float = 0.15, duration: float = 0.6, easing=None):
        super().__init__(duration=duration, easing=easing or ease_out_cubic)
        self.element = element
        self.direction = direction
        self.distance = distance
        self._start_x = self._start_y = self._target_x = self._target_y = 0.0

    def on_start(self, scene: "Scene"):
        self._target_x = self.element.x
        self._target_y = self.element.y
        dx, dy = 0.0, 0.0
        if self.direction == "left":
            dx = -self.distance
        elif self.direction == "right":
            dx = self.distance
        elif self.direction == "up":
            dy = self.distance
        elif self.direction == "down":
            dy = -self.distance
        self._start_x = self._target_x + dx
        self._start_y = self._target_y + dy
        self.element.x = self._start_x
        self.element.y = self._start_y
        self.element.opacity = 0.0
        self.element.visible = True
        scene.add_element(self.element)

    def on_update(self, scene: "Scene", progress: float):
        self.element.x = self._start_x + (self._target_x - self._start_x) * progress
        self.element.y = self._start_y + (self._target_y - self._start_y) * progress
        self.element.opacity = progress

    def on_finish(self, scene: "Scene"):
        self.element.x = self._target_x
        self.element.y = self._target_y
        self.element.opacity = 1.0


class SlideOut(Animation):

    def __init__(self, element, direction: str = "right", distance: float = 0.15, duration: float = 0.5, easing=None):
        super().__init__(duration=duration, easing=easing or ease_in_out_cubic)
        self.element = element
        self.direction = direction
        self.distance = distance
        self._start_x = self._start_y = 0.0
        self._dx = self._dy = 0.0

    def on_start(self, scene: "Scene"):
        self._start_x = self.element.x
        self._start_y = self.element.y
        if self.direction == "left":
            self._dx = -self.distance
        elif self.direction == "right":
            self._dx = self.distance
        elif self.direction == "up":
            self._dy = self.distance
        elif self.direction == "down":
            self._dy = -self.distance

    def on_update(self, scene: "Scene", progress: float):
        self.element.x = self._start_x + self._dx * progress
        self.element.y = self._start_y + self._dy * progress
        self.element.opacity = 1.0 - progress

    def on_finish(self, scene: "Scene"):
        self.element.visible = False
        self.element.opacity = 0.0


class ScaleIn(Animation):

    def __init__(self, text: "TextElement", duration: float = 0.5, easing=None):
        super().__init__(duration=duration, easing=easing or ease_out_back)
        self.text = text

    def on_start(self, scene: "Scene"):
        self.text.scale = 0.01
        self.text.opacity = 0.0
        self.text.visible = True
        scene.add_element(self.text)

    def on_update(self, scene: "Scene", progress: float):
        self.text.scale = progress
        self.text.opacity = min(1.0, progress * 2)

    def on_finish(self, scene: "Scene"):
        self.text.scale = 1.0
        self.text.opacity = 1.0


class BounceIn(Animation):

    def __init__(self, text: "TextElement", duration: float = 0.7, easing=None):
        super().__init__(duration=duration, easing=easing or ease_out_bounce)
        self.text = text

    def on_start(self, scene: "Scene"):
        self.text.scale = 0.01
        self.text.opacity = 0.0
        self.text.visible = True
        scene.add_element(self.text)

    def on_update(self, scene: "Scene", progress: float):
        self.text.scale = progress
        self.text.opacity = min(1.0, progress * 3)

    def on_finish(self, scene: "Scene"):
        self.text.scale = 1.0
        self.text.opacity = 1.0


class GlowPulse(Animation):

    def __init__(self, element, min_opacity: float = 0.3, max_opacity: float = 1.0, cycles: int = 3, duration: float = 2.0):
        super().__init__(duration=duration, easing=linear)
        self.element = element
        self.min_op = min_opacity
        self.max_op = max_opacity
        self.cycles = cycles

    def on_update(self, scene: "Scene", progress: float):
        import math
        t = 0.5 + 0.5 * math.sin(progress * self.cycles * 2 * math.pi)
        self.element.opacity = self.min_op + (self.max_op - self.min_op) * t


class Pulse(Animation):

    def __init__(self, element, min_opacity: float = 0.4, cycles: int = 2, duration: float = 1.5):
        super().__init__(duration=duration, easing=linear)
        self.element = element
        self.min_op = min_opacity
        self.cycles = cycles

    def on_update(self, scene: "Scene", progress: float):
        import math
        t = 0.5 + 0.5 * math.sin(progress * self.cycles * 2 * math.pi)
        self.element.opacity = self.min_op + (1.0 - self.min_op) * t


class Sweep(Animation):

    def __init__(self, *elements, duration: float = 1.5, easing=None):
        super().__init__(duration=duration, easing=easing or ease_in_out_cubic)
        self.elements = list(elements)
        self._x_min = 0.0
        self._x_max = 1.0

    @staticmethod
    def _get_x(e):
        if hasattr(e, "index"):
            return e.index
        if hasattr(e, "x1"):
            return e.x1
        if hasattr(e, "x"):
            return e.x
        if hasattr(e, "points_x") and e.points_x:
            return e.points_x[0]
        return 0

    def on_start(self, scene: "Scene"):
        for e in self.elements:
            e.opacity = 0.0
            e.visible = True
            scene.add_element(e)
        self.elements.sort(key=lambda e: self._get_x(e))
        if self.elements:
            self._x_min = self._get_x(self.elements[0])
            self._x_max = self._get_x(self.elements[-1])

    def on_update(self, scene: "Scene", progress: float):
        span = max(1.0, self._x_max - self._x_min)
        curtain_x = self._x_min + span * progress
        for e in self.elements:
            ex = self._get_x(e)
            if ex <= curtain_x:
                e.opacity = min(1.0, (curtain_x - ex) / (span * 0.1 + 0.01))
            else:
                e.opacity = 0.0

    def on_finish(self, scene: "Scene"):
        for e in self.elements:
            e.opacity = 1.0


class ColorShift(Animation):

    def __init__(self, element, attr: str = "color", start_color: str = "#ffffff", end_color: str = "#ff0000", duration: float = 1.0, easing=None):
        super().__init__(duration=duration, easing=easing)
        self.element = element
        self.attr = attr
        self.start_color = start_color
        self.end_color = end_color

    def on_update(self, scene: "Scene", progress: float):
        from matplotlib.colors import to_rgba
        import numpy as _np
        c1 = _np.array(to_rgba(self.start_color))
        c2 = _np.array(to_rgba(self.end_color))
        blended = c1 + (c2 - c1) * progress
        hex_color = "#{:02x}{:02x}{:02x}".format(
            int(blended[0] * 255), int(blended[1] * 255), int(blended[2] * 255))
        setattr(self.element, self.attr, hex_color)


class Shake(Animation):

    def __init__(self, element, amplitude: float = 0.5, frequency: float = 15.0, duration: float = 0.5, easing=None):
        super().__init__(duration=duration, easing=easing or linear)
        self.element = element
        self.amplitude = amplitude
        self.frequency = frequency

    def on_update(self, scene: "Scene", progress: float):
        import math
        decay = 1.0 - progress
        offset = self.amplitude * decay * math.sin(progress * self.frequency * 2 * math.pi)
        if hasattr(self.element, "offset_y"):
            self.element.offset_y = offset

    def on_finish(self, scene: "Scene"):
        if hasattr(self.element, "offset_y"):
            self.element.offset_y = 0.0


class MorphLine(Animation):

    def __init__(self, line: "LineElement", target_y: list, duration: float = 1.0, easing=None):
        super().__init__(duration=duration, easing=easing or ease_in_out_cubic)
        self.line = line
        self.target_y = target_y
        self._start_y = None

    def on_start(self, scene: "Scene"):
        self._start_y = list(self.line.points_y)

    def on_update(self, scene: "Scene", progress: float):
        self.line.points_y = [
            s + (t - s) * progress
            for s, t in zip(self._start_y, self.target_y)
        ]


class StaggeredFadeIn(Animation):

    def __init__(self, *elements, stagger: float = 0.08, duration: float = 0.5, easing=None):
        n = len(elements)
        total = duration + stagger * max(0, n - 1)
        super().__init__(duration=total, easing=easing or linear)
        self.elements = elements
        self.stagger = stagger
        self.fade_dur = duration

    def on_start(self, scene: "Scene"):
        for e in self.elements:
            e.opacity = 0.0
            e.visible = True
            scene.add_element(e)

    def on_update(self, scene: "Scene", progress: float):
        total_t = progress * self.duration
        for i, e in enumerate(self.elements):
            delay = i * self.stagger
            local_p = max(0.0, min(1.0, (total_t - delay) / self.fade_dur))
            e.opacity = ease_out_cubic(local_p)

    def on_finish(self, scene: "Scene"):
        for e in self.elements:
            e.opacity = 1.0


class CandleGrow(Animation):

    def __init__(self, *candles, sequential: bool = True, auto_camera: bool = True,
                 duration: float = 1.0, easing=None):
        super().__init__(duration=duration, easing=easing or ease_out_cubic)
        self.candles = candles
        self.sequential = sequential
        self.auto_camera = auto_camera

    def on_start(self, scene: "Scene"):
        for c in self.candles:
            c.scale_y = 0.0
            c.opacity = 0.0
            c.visible = True
            scene.add_element(c)

    def on_update(self, scene: "Scene", progress: float):
        n = len(self.candles)
        if n == 0:
            return
        if self.sequential:
            reveal = progress * n
            for i, c in enumerate(self.candles):
                local_p = max(0.0, min(1.0, reveal - i))
                c.scale_y = local_p
                c.opacity = min(1.0, local_p * 2)
                c.visible = local_p > 0
        else:
            for c in self.candles:
                c.scale_y = progress
                c.opacity = min(1.0, progress * 2)
        if self.auto_camera:
            visible = [c for c in self.candles if c.visible and c.opacity > 0]
            if visible:
                scene.camera.fit_to_candles(
                    visible,
                    padding_top=scene.config.padding_top,
                    padding_bottom=scene.config.padding_bottom,
                    padding_right=scene.config.padding_right,
                )

    def on_finish(self, scene: "Scene"):
        for c in self.candles:
            c.scale_y = 1.0
            c.opacity = 1.0
            c.visible = True
        if self.auto_camera:
            scene.camera.fit_to_candles(
                list(self.candles),
                padding_top=scene.config.padding_top,
                padding_bottom=scene.config.padding_bottom,
                padding_right=scene.config.padding_right,
            )


class Wipe(Animation):

    def __init__(self, *elements, direction: str = "left", duration: float = 1.0, easing=None):
        super().__init__(duration=duration, easing=easing or ease_in_out_cubic)
        self.elements = list(elements)
        self.direction = direction

    def _sort_key(self, e):
        if self.direction in ("left", "right"):
            x = getattr(e, "index", getattr(e, "x", getattr(e, "x1", 0)))
            return x if self.direction == "left" else -x
        else:
            y = getattr(e, "y", getattr(e, "y1", 0))
            return -y if self.direction == "up" else y

    def on_start(self, scene: "Scene"):
        for e in self.elements:
            e.opacity = 0.0
            e.visible = True
            scene.add_element(e)
        self.elements.sort(key=self._sort_key)

    def on_update(self, scene: "Scene", progress: float):
        n = len(self.elements)
        reveal = progress * n
        for i, e in enumerate(self.elements):
            local_p = max(0.0, min(1.0, reveal - i))
            e.opacity = local_p

    def on_finish(self, scene: "Scene"):
        for e in self.elements:
            e.opacity = 1.0


class ChartAppear(Animation):

    def __init__(
        self,
        chart: "Chart",
        auto_camera: bool = True,
        duration: float = 3.0,
        easing=None,
    ):
        super().__init__(duration=duration, easing=easing or ease_out_cubic)
        self.chart = chart
        self.auto_camera = auto_camera

    def on_start(self, scene: "Scene"):
        for e in self.chart.elements:
            e.visible = True
            e.opacity = 0.0
            if hasattr(e, "draw_progress"):
                e.draw_progress = 0.0
            scene.add_element(e)

    def _fit_camera(self, scene: "Scene"):
        candles = self.chart.candles
        if not candles:
            return
        indices = [c.index for c in candles]
        lows = [c.low for c in candles]
        highs = [c.high for c in candles]
        price_range = max(highs) - min(lows)
        if price_range == 0:
            price_range = 1
        scene.camera.view_start = min(indices) - 1
        scene.camera.view_end = max(indices) + scene.config.padding_right
        scene.camera.price_min = min(lows) - price_range * scene.config.padding_bottom
        scene.camera.price_max = max(highs) + price_range * scene.config.padding_top

    def on_update(self, scene: "Scene", progress: float):
        for e in self.chart.elements:
            e.opacity = progress
            if hasattr(e, "draw_progress"):
                e.draw_progress = progress

        if self.auto_camera:
            self._fit_camera(scene)

    def on_finish(self, scene: "Scene"):
        for e in self.chart.elements:
            e.visible = True
            e.opacity = 1.0
            if hasattr(e, "draw_progress"):
                e.draw_progress = 1.0
        if self.auto_camera:
            self._fit_camera(scene)


class AnimatePostProcess(Animation):

    def __init__(self, pp_config, duration: float = 2.0, easing=None, **field_ranges):
        super().__init__(duration=duration, easing=easing or ease_in_out_cubic)
        self.pp = pp_config
        self.field_ranges = field_ranges

    def on_start(self, scene: "Scene"):
        for attr, (start, _end) in self.field_ranges.items():
            setattr(self.pp, attr, start)


    def on_update(self, scene: "Scene", progress: float):
        for attr, (start, end) in self.field_ranges.items():
            val = start + (end - start) * progress
            setattr(self.pp, attr, val)

    def on_finish(self, scene: "Scene"):
        for attr, (_start, end) in self.field_ranges.items():
            setattr(self.pp, attr, end)


class Write(TypeText):
    # Simulates writing text (enhanced TypeText).

    def __init__(self, text: "TextElement", duration: float = 1.0, easing=None):
        super().__init__(text, duration=duration, easing=easing)


class FadeInSlide(Animation):
    # Fade in while sliding into position.

    def __init__(self, element, direction: str = "up", distance: float = 0.5, duration: float = 0.8, easing=None):
        super().__init__(duration=duration, easing=easing or ease_out_cubic)
        self.element = element
        self.direction = direction
        self.distance = distance
        self._target_x = 0.0
        self._target_y = 0.0
        self._start_x = 0.0
        self._start_y = 0.0

    def on_start(self, scene: "Scene"):
        self._target_x = self.element.x
        self._target_y = self.element.y
        dx, dy = 0.0, 0.0
        if self.direction == "left":
            dx = -self.distance
        elif self.direction == "right":
            dx = self.distance
        elif self.direction == "up":
            dy = self.distance
        elif self.direction == "down":
            dy = -self.distance
        
        # Start position is opposite to slide direction
        self._start_x = self._target_x - dx
        self._start_y = self._target_y - dy
        
        self.element.x = self._start_x
        self.element.y = self._start_y
        self.element.opacity = 0.0
        self.element.visible = True
        scene.add_element(self.element)

    def on_update(self, scene: "Scene", progress: float):
        self.element.x = self._start_x + (self._target_x - self._start_x) * progress
        self.element.y = self._start_y + (self._target_y - self._start_y) * progress
        self.element.opacity = progress

    def on_finish(self, scene: "Scene"):
        self.element.x = self._target_x
        self.element.y = self._target_y
        self.element.opacity = 1.0


class GrowFromCenter(Animation):
    # Scale up from center.

    def __init__(self, element, duration: float = 0.8, easing=None):
        super().__init__(duration=duration, easing=easing or ease_out_back)
        self.element = element

    def on_start(self, scene: "Scene"):
        self.element.scale = 0.0
        self.element.opacity = 0.0
        self.element.visible = True
        scene.add_element(self.element)

    def on_update(self, scene: "Scene", progress: float):
        self.element.scale = progress
        self.element.opacity = min(1.0, progress * 2)

    def on_finish(self, scene: "Scene"):
        self.element.scale = 1.0
        self.element.opacity = 1.0


class SpinIn(Animation):
    # Rotate and scale in.

    def __init__(self, element, angle: float = -90.0, duration: float = 1.0, easing=None):
        super().__init__(duration=duration, easing=easing or ease_out_back)
        self.element = element
        self.angle = angle

    def on_start(self, scene: "Scene"):
        self.element.rotation = self.angle
        self.element.scale = 0.0
        self.element.opacity = 0.0
        self.element.visible = True
        scene.add_element(self.element)

    def on_update(self, scene: "Scene", progress: float):
        self.element.rotation = self.angle * (1.0 - progress)
        self.element.scale = progress
        self.element.opacity = min(1.0, progress * 2)

    def on_finish(self, scene: "Scene"):
        self.element.rotation = 0.0
        self.element.scale = 1.0
        self.element.opacity = 1.0


