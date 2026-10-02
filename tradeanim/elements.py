# Base visual elements.

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional


@dataclass
class Element:
    # Base element.

    opacity: float = 1.0
    visible: bool = True
    z_order: int = 0

    def interpolate(self, attr: str, start: float, end: float, progress: float):
        setattr(self, attr, start + (end - start) * progress)


@dataclass
class CandleElement(Element):
    # Single candlestick.

    index: int = 0
    timestamp: str = ""
    open: float = 0.0
    high: float = 0.0
    low: float = 0.0
    close: float = 0.0
    volume: float = 0.0
    bull_color: Optional[str] = None
    bear_color: Optional[str] = None
    scale_y: float = 1.0
    offset_y: float = 0.0
    glow_enabled: bool = False
    glow_radius: float = 3.0
    glow_intensity: float = 0.15

    @property
    def is_bull(self) -> bool:
        return self.close >= self.open

    @property
    def body_top(self) -> float:
        return max(self.open, self.close)

    @property
    def body_bottom(self) -> float:
        return min(self.open, self.close)

    @property
    def body_height(self) -> float:
        return abs(self.close - self.open)

    @property
    def mid(self) -> float:
        return (self.open + self.close) / 2


@dataclass
class LineElement(Element):
    # Line element.

    points_x: list = field(default_factory=list)
    points_y: list = field(default_factory=list)
    color: str = "#2196F3"
    linewidth: float = 1.5
    linestyle: str = "-"
    draw_progress: float = 1.0
    label: str = ""

    @property
    def num_points(self) -> int:
        return len(self.points_x)

    def visible_points(self) -> tuple:
        n = max(1, int(self.num_points * self.draw_progress))
        return self.points_x[:n], self.points_y[:n]


@dataclass
class AreaElement(Element):
    # Area element.

    points_x: list = field(default_factory=list)
    points_y: list = field(default_factory=list)
    color: str = "#2196F3"
    linewidth: float = 1.5
    fill_color: str = "#2196F3"
    fill_alpha_top: float = 0.4
    fill_alpha_bottom: float = 0.0
    baseline: Optional[float] = None
    draw_progress: float = 1.0
    label: str = ""

    @property
    def num_points(self) -> int:
        return len(self.points_x)

    def visible_points(self) -> tuple:
        n = max(1, int(self.num_points * self.draw_progress))
        return self.points_x[:n], self.points_y[:n]


@dataclass
class OHLCBarElement(Element):
    # OHLC bar.

    index: int = 0
    timestamp: str = ""
    open: float = 0.0
    high: float = 0.0
    low: float = 0.0
    close: float = 0.0
    volume: float = 0.0
    bull_color: Optional[str] = None
    bear_color: Optional[str] = None
    scale_y: float = 1.0
    offset_y: float = 0.0
    tick_width: float = 0.3

    @property
    def is_bull(self) -> bool:
        return self.close >= self.open


@dataclass
class TextElement(Element):
    # Text element.

    text: str = ""
    x: float = 0.0
    y: float = 0.0
    color: str = "#d1d4dc"
    font_size: float = 14.0
    font_weight: str = "normal"
    font_family: str = "monospace"
    ha: str = "left"
    va: str = "bottom"
    bbox: Optional[dict] = None
    rotation: float = 0.0
    char_progress: float = 1.0
    use_data_coords: bool = True
    font_path: Optional[str] = None
    font_style: str = "normal"
    text_shadow: Optional[dict] = None
    text_outline: Optional[dict] = None
    scale: float = 1.0

    @property
    def visible_text(self) -> str:
        n = max(0, int(len(self.text) * self.char_progress))
        return self.text[:n]


@dataclass
class FillBetweenElement(Element):
    # Filled area.

    points_x: list = field(default_factory=list)
    upper_y: list = field(default_factory=list)
    lower_y: list = field(default_factory=list)
    fill_color: str = "#2196F315"
    edge_color: Optional[str] = None
    edge_width: float = 0.5
    draw_progress: float = 1.0
    label: str = ""

    @property
    def num_points(self) -> int:
        return len(self.points_x)

    def visible_count(self) -> int:
        return max(1, int(self.num_points * self.draw_progress))


@dataclass
class ZoneElement(Element):
    # Rectangular zone.

    x1: float = 0.0
    x2: float = 0.0
    y1: float = 0.0
    y2: float = 0.0
    fill_color: str = "#2196F340"
    border_color: Optional[str] = None
    border_width: float = 1.0
    border_style: str = "-"
    label: str = ""
    label_color: str = "#d1d4dc"
    label_size: float = 10.0
    hatch: Optional[str] = None
    extend_right: bool = False

    @property
    def width(self) -> float:
        return self.x2 - self.x1

    @property
    def height(self) -> float:
        return self.y2 - self.y1


@dataclass
class HLineElement(Element):
    # Horizontal line.

    y: float = 0.0
    color: str = "#787b86"
    linewidth: float = 1.0
    linestyle: str = "--"
    label: str = ""
    label_color: Optional[str] = None
    label_size: float = 10.0
    x_start: Optional[float] = None
    x_end: Optional[float] = None


@dataclass
class ArrowElement(Element):
    # Arrow annotation.

    x1: float = 0.0
    y1: float = 0.0
    x2: float = 0.0
    y2: float = 0.0
    color: str = "#d1d4dc"
    linewidth: float = 1.5
    head_width: float = 0.3
    head_length: float = 0.2
    label: str = ""
    label_color: Optional[str] = None
    label_size: float = 10.0
