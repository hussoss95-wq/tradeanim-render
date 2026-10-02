# Configuration.

from dataclasses import dataclass, field
from typing import Optional


@dataclass
class PostProcessConfig:
    # Post-processing settings.

    bloom_enabled: bool = False
    bloom_radius: int = 15
    bloom_intensity: float = 0.15
    vignette_enabled: bool = False
    vignette_strength: float = 0.3
    color_grading: Optional[dict] = None
    chromatic_aberration_enabled: bool = False
    chromatic_aberration_offset: float = 3.0
    lens_distortion_enabled: bool = False
    lens_distortion_k: float = 0.0  # negative=barrel, positive=pincushion


@dataclass
class Theme:
    # Visual theme.

    background: str = "#131722"
    panel_bg: str = "#1e222d"
    grid_color: str = "#262b3e"
    text_color: str = "#d1d4dc"
    axis_color: str = "#787b86"
    bull_color: str = "#26a69a"
    bear_color: str = "#ef5350"
    bull_body: str = "#26a69a"
    bear_body: str = "#ef5350"
    bull_wick: str = "#26a69a"
    bear_wick: str = "#ef5350"
    volume_bull: str = "#26a69a80"
    volume_bear: str = "#ef535080"
    sma_colors: list = field(
        default_factory=lambda: ["#2196F3", "#FF9800", "#E040FB", "#00E5FF"]
    )
    fvg_bull_color: str = "#26a69a25"
    fvg_bear_color: str = "#ef535025"
    ob_bull_color: str = "#26a69a1a"
    ob_bear_color: str = "#ef53501a"
    bos_color: str = "#2196F3"
    choch_color: str = "#FF9800"
    liquidity_color: str = "#FFD54F"
    premium_color: str = "#ef535012"
    discount_color: str = "#26a69a12"
    equilibrium_color: str = "#787b86"


DARK_THEME = Theme()

LIGHT_THEME = Theme(
    background="#ffffff",
    panel_bg="#f5f5f5",
    grid_color="#e0e0e0",
    text_color="#333333",
    axis_color="#666666",
    bull_color="#26a69a",
    bear_color="#ef5350",
    bull_body="#26a69a",
    bear_body="#ef5350",
    bull_wick="#26a69a",
    bear_wick="#ef5350",
    volume_bull="#26a69a60",
    volume_bear="#ef535060",
    fvg_bull_color="#26a69a20",
    fvg_bear_color="#ef535020",
    ob_bull_color="#26a69a15",
    ob_bear_color="#ef535015",
    premium_color="#ef535010",
    discount_color="#26a69a10",
)

# White bg, bull=white body with black borders, bear=black
WHITE_THEME = Theme(
    background="#ffffff",
    panel_bg="#f5f5f5",
    grid_color="#e0e0e0",
    text_color="#333333",
    axis_color="#666666",
    bull_color="#000000",
    bear_color="#000000",
    bull_body="#ffffff",
    bear_body="#000000",
    bull_wick="#000000",
    bear_wick="#000000",
    volume_bull="#00000060",
    volume_bear="#00000060",
    fvg_bull_color="#00000020",
    fvg_bear_color="#00000020",
    ob_bull_color="#00000015",
    ob_bear_color="#00000015",
    bos_color="#333333",
    choch_color="#666666",
    liquidity_color="#999999",
    premium_color="#00000010",
    discount_color="#00000010",
    equilibrium_color="#666666",
)

# White bg, bull=green body with black borders, bear=black
WHITE_GREEN_THEME = Theme(
    background="#ffffff",
    panel_bg="#f5f5f5",
    grid_color="#e0e0e0",
    text_color="#333333",
    axis_color="#666666",
    bull_color="#81c784",
    bear_color="#000000",
    bull_body="#81c784",
    bear_body="#000000",
    bull_wick="#000000",
    bear_wick="#000000",
    volume_bull="#81c78460",
    volume_bear="#00000060",
    fvg_bull_color="#81c78420",
    fvg_bear_color="#00000020",
    ob_bull_color="#81c78415",
    ob_bear_color="#00000015",
    bos_color="#333333",
    choch_color="#666666",
    liquidity_color="#999999",
    premium_color="#00000010",
    discount_color="#81c78410",
    equilibrium_color="#666666",
)

# Black bg, green=#11cd83, red=#f23645
BLACK_THEME = Theme(
    background="#000000",
    panel_bg="#0a0a0a",
    grid_color="#1a1a1a",
    text_color="#d1d4dc",
    axis_color="#787b86",
    bull_color="#11cd83",
    bear_color="#f23645",
    bull_body="#11cd83",
    bear_body="#f23645",
    bull_wick="#11cd83",
    bear_wick="#f23645",
    volume_bull="#11cd8380",
    volume_bear="#f2364580",
    fvg_bull_color="#11cd8325",
    fvg_bear_color="#f2364525",
    ob_bull_color="#11cd831a",
    ob_bear_color="#f236451a",
    bos_color="#2196F3",
    choch_color="#FF9800",
    liquidity_color="#FFD54F",
    premium_color="#f2364512",
    discount_color="#11cd8312",
    equilibrium_color="#787b86",
)

# Dark bg (#161b1e), bull=white, bear=#636363
MIDNIGHT_THEME = Theme(
    background="#161b1e",
    panel_bg="#1c2226",
    grid_color="#252b30",
    text_color="#d1d4dc",
    axis_color="#787b86",
    bull_color="#ffffff",
    bear_color="#636363",
    bull_body="#ffffff",
    bear_body="#636363",
    bull_wick="#ffffff",
    bear_wick="#636363",
    volume_bull="#ffffff60",
    volume_bear="#63636360",
    fvg_bull_color="#ffffff20",
    fvg_bear_color="#63636320",
    ob_bull_color="#ffffff15",
    ob_bear_color="#63636315",
    bos_color="#2196F3",
    choch_color="#FF9800",
    liquidity_color="#FFD54F",
    premium_color="#63636312",
    discount_color="#ffffff12",
    equilibrium_color="#787b86",
)


@dataclass
class RenderConfig:
    # Render settings.

    width: int = 1920
    height: int = 1080
    fps: int = 60
    dpi: int = 100
    codec: str = "libx264"
    pixel_format: str = "yuv420p"
    crf: int = 18
    preset: str = "medium"
    theme: Theme = field(default_factory=Theme)
    font_family: str = "monospace"
    candle_width: float = 0.6
    candle_spacing: float = 1.0
    wick_linewidth: float = 1.2
    padding_top: float = 0.05
    padding_bottom: float = 0.05
    padding_right: int = 3
    price_axis_width: float = 0.08
    time_axis_height: float = 0.06
    grid_alpha: float = 0.3
    grid_linewidth: float = 0.5
    show_grid: bool = True
    grid_style: str = "solid"
    grid_axis: str = "both"
    minor_grid: bool = False
    minor_grid_alpha: float = 0.15
    minor_grid_linewidth: float = 0.3
    show_volume: bool = False
    volume_height_ratio: float = 0.15
    watermark: Optional[str] = None
    watermark_alpha: float = 0.1
    speed_multiplier: float = 1.0
    supersample: int = 1  # render at Nx then downscale
    post_processing: Optional[PostProcessConfig] = None
    background_gradient: Optional[tuple] = None  # (top_color, bottom_color)
    candle_shadow: bool = False
    candle_shadow_offset: tuple = (0.08, -0.08)
    candle_shadow_color: str = "#00000040"
    candle_bull_color_override: Optional[str] = None
    candle_bear_color_override: Optional[str] = None
