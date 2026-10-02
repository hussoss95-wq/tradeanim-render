# Text helpers.

from __future__ import annotations

from .elements import TextElement


def ChartText(
    text: str,
    x: float = 0.0,
    y: float = 0.0,
    color: str = "#d1d4dc",
    font_size: float = 14.0,
    font_weight: str = "normal",
    ha: str = "left",
    va: str = "bottom",
    bbox: dict | None = None,
    rotation: float = 0.0,
) -> TextElement:
    # Chart text.
    return TextElement(
        text=text, x=x, y=y, color=color, font_size=font_size,
        font_weight=font_weight, ha=ha, va=va, bbox=bbox,
        rotation=rotation, use_data_coords=True,
    )


def ScreenText(
    text: str,
    x: float = 0.5,
    y: float = 0.5,
    color: str = "#d1d4dc",
    font_size: float = 24.0,
    font_weight: str = "bold",
    ha: str = "center",
    va: str = "center",
    bbox: dict | None = None,
) -> TextElement:
    # Screen text.
    return TextElement(
        text=text, x=x, y=y, color=color, font_size=font_size,
        font_weight=font_weight, ha=ha, va=va, bbox=bbox,
        use_data_coords=False,
    )


def Title(
    text: str,
    color: str = "#d1d4dc",
    font_size: float = 20.0,
    **kwargs,
) -> TextElement:
    # Top-left title.
    kwargs.setdefault("x", 0.02)
    kwargs.setdefault("y", 0.96)
    kwargs.setdefault("font_weight", "bold")
    kwargs.setdefault("ha", "left")
    kwargs.setdefault("va", "top")
    kwargs.setdefault("use_data_coords", False)
    return TextElement(text=text, color=color, font_size=font_size, **kwargs)


def Subtitle(
    text: str,
    color: str = "#787b86",
    font_size: float = 13.0,
    **kwargs,
) -> TextElement:
    # Subtitle.
    kwargs.setdefault("x", 0.02)
    kwargs.setdefault("y", 0.91)
    kwargs.setdefault("font_weight", "normal")
    kwargs.setdefault("ha", "left")
    kwargs.setdefault("va", "top")
    kwargs.setdefault("use_data_coords", False)
    return TextElement(text=text, color=color, font_size=font_size, **kwargs)


def PriceLabel(
    price: float,
    x: float,
    color: str = "#d1d4dc",
    font_size: float = 11.0,
) -> TextElement:
    # Price label.
    return TextElement(
        text=f"{price:,.2f}", x=x, y=price, color=color,
        font_size=font_size, ha="left", va="bottom",
        bbox=dict(boxstyle="round,pad=0.2", facecolor="#1e222d", edgecolor=color, alpha=0.8),
        use_data_coords=True,
    )


def AnnotationBox(
    text: str,
    x: float = 0.5,
    y: float = 0.5,
    bg_color: str = "#1e222d",
    text_color: str = "#d1d4dc",
    border_color: str = "#363a45",
    font_size: float = 14.0,
) -> TextElement:
    # Boxed text.
    return TextElement(
        text=text, x=x, y=y, color=text_color, font_size=font_size,
        ha="center", va="center",
        bbox=dict(boxstyle="round,pad=0.5", facecolor=bg_color, edgecolor=border_color, alpha=0.9),
        use_data_coords=False,
    )


def StyledText(
    text: str,
    x: float = 0.5,
    y: float = 0.5,
    color: str = "#d1d4dc",
    font_size: float = 16.0,
    font_weight: str = "normal",
    font_path: str | None = None,
    font_style: str = "normal",
    text_shadow: dict | None = None,
    text_outline: dict | None = None,
    ha: str = "center",
    va: str = "center",
    use_data_coords: bool = False,
    bbox: dict | None = None,
    rotation: float = 0.0,
) -> TextElement:
    # Styled text.
    return TextElement(
        text=text, x=x, y=y, color=color, font_size=font_size,
        font_weight=font_weight, ha=ha, va=va, bbox=bbox,
        rotation=rotation, use_data_coords=use_data_coords,
        font_path=font_path, font_style=font_style,
        text_shadow=text_shadow, text_outline=text_outline,
    )


def ShadowedTitle(
    text: str,
    color: str = "#d1d4dc",
    font_size: float = 22.0,
    shadow_color: str = "#000000",
    shadow_offset_x: float = 2.0,
    shadow_offset_y: float = -2.0,
    x: float = 0.02,
    y: float = 0.96,
) -> TextElement:
    # Shadowed title.
    return TextElement(
        text=text, x=x, y=y, color=color, font_size=font_size,
        font_weight="bold", ha="left", va="top", use_data_coords=False,
        text_shadow={"color": shadow_color, "offset_x": shadow_offset_x, "offset_y": shadow_offset_y},
    )


def OutlinedText(
    text: str,
    x: float = 0.5,
    y: float = 0.5,
    color: str = "#d1d4dc",
    font_size: float = 18.0,
    font_weight: str = "bold",
    outline_color: str = "#000000",
    outline_width: float = 3.0,
    ha: str = "center",
    va: str = "center",
    use_data_coords: bool = False,
) -> TextElement:
    # Outlined text.
    return TextElement(
        text=text, x=x, y=y, color=color, font_size=font_size,
        font_weight=font_weight, ha=ha, va=va, use_data_coords=use_data_coords,
        text_outline={"color": outline_color, "width": outline_width},
    )
