# Scene management.

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

from .config import RenderConfig
from .renderer import Renderer


@dataclass
class Camera:
    # Chart viewport.

    view_start: float = 0.0
    view_end: float = 50.0
    price_min: float = 0.0
    price_max: float = 100.0
    _target_start: Optional[float] = None
    _target_end: Optional[float] = None
    _target_pmin: Optional[float] = None
    _target_pmax: Optional[float] = None

    def fit_to_candles(self, candles, padding_top=0.05, padding_bottom=0.05, padding_right=3):
        if not candles:
            return
        visible = [c for c in candles if c.visible and c.opacity > 0]
        if not visible:
            return
        indices = [c.index for c in visible]
        lows = [c.low for c in visible]
        highs = [c.high for c in visible]
        self.view_start = min(indices) - 1
        self.view_end = max(indices) + padding_right
        price_range = max(highs) - min(lows)
        if price_range == 0:
            price_range = 1
        self.price_min = min(lows) - price_range * padding_bottom
        self.price_max = max(highs) + price_range * padding_top

    def lerp_to(self, target_start, target_end, target_pmin, target_pmax, progress):
        self.view_start += (target_start - self.view_start) * progress
        self.view_end += (target_end - self.view_end) * progress
        self.price_min += (target_pmin - self.price_min) * progress
        self.price_max += (target_pmax - self.price_max) * progress


class Animation:
    # Base animation.

    def __init__(self, duration: float = 1.0, easing=None):
        from .easing import ease_out_cubic
        self.duration = duration
        self.easing = easing or ease_out_cubic
        self.start_time: float = 0.0
        self._started = False
        self._finished = False

    def on_start(self, scene: "Scene"):
        pass

    def on_update(self, scene: "Scene", progress: float):
        pass

    def on_finish(self, scene: "Scene"):
        pass

    def update(self, scene: "Scene", t: float):
        if t < self.start_time:
            return
        raw = min(1.0, (t - self.start_time) / self.duration) if self.duration > 0 else 1.0
        progress = self.easing(raw)

        if not self._started:
            self._started = True
            self.on_start(scene)

        self.on_update(scene, progress)

        if raw >= 1.0 and not self._finished:
            self._finished = True
            self.on_finish(scene)


class Scene:
    # Base scene. Subclass and implement construct().

    def __init__(self, config: Optional[RenderConfig] = None, **kwargs):
        self.config = config or RenderConfig(**kwargs)
        self.camera = Camera()
        self.chart = None
        self._elements = []
        self._animations = []
        self._current_time = 0.0
        self._prev_play_start = 0.0
        self._built = False

    @property
    def total_duration(self) -> float:
        if not self._animations:
            return self._current_time
        max_anim_end = max(a.start_time + a.duration for a in self._animations)
        return max(self._current_time, max_anim_end)

    @property
    def visible_elements(self):
        return [e for e in self._elements if e.visible and e.opacity > 0]

    def add_element(self, element):
        self._elements.append(element)
        return element

    def remove_element(self, element):
        if element in self._elements:
            self._elements.remove(element)

    def load_chart(self, csv_path: str, **kwargs):
        from .chart import Chart
        self.chart = Chart.from_csv(csv_path, **kwargs)
        return self.chart

    def play(self, *animations, duration: Optional[float] = None, delay: float = 0.0):
        # Play animations.
        speed = self.config.speed_multiplier
        self._prev_play_start = self._current_time
        max_end = 0.0
        for idx, anim in enumerate(animations):
            if duration is not None:
                anim.duration = duration / speed
            else:
                anim.duration = anim.duration / speed
            offset = idx * delay / speed
            anim.start_time = self._current_time + offset
            self._animations.append(anim)
            max_end = max(max_end, offset + anim.duration)
        self._current_time += max_end

    def play_with_previous(self, *animations, duration: Optional[float] = None, offset: float = 0.0):
        # Play with previous.
        speed = self.config.speed_multiplier
        start = self._prev_play_start + offset / speed
        for anim in animations:
            if duration is not None:
                anim.duration = duration / speed
            else:
                anim.duration = anim.duration / speed
            anim.start_time = start
            self._animations.append(anim)

    def wait(self, duration: float = 1.0):
        self._current_time += duration / self.config.speed_multiplier

    def construct(self):
        raise NotImplementedError("Subclass Scene and implement construct()")

    def update(self, t: float):
        for anim in self._animations:
            anim.update(self, t)

    def render(self, output_path: str = "output.mp4"):
        if not self._built:
            self.construct()
            self._built = True
        renderer = Renderer(self.config)
        renderer.render_scene(self, output_path)
