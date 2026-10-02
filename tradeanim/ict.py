# ICT concepts

from __future__ import annotations

from typing import TYPE_CHECKING, Optional

import numpy as np

from .elements import ArrowElement, HLineElement, LineElement, TextElement, ZoneElement

if TYPE_CHECKING:
    from .chart import Chart


def detect_fvg(
    chart: "Chart",
    bull_color: str = "#26a69a59",
    bear_color: str = "#ef535059",
    label: bool = True,
    min_gap_pct: float = 0.0,
) -> list[ZoneElement]:
    # Detect FVG.
    candles = chart.candles
    zones = []

    for i in range(2, len(candles)):
        c0 = candles[i - 2]
        c2 = candles[i]

        # Bullish FVG
        if c0.high < c2.low:
            gap = c2.low - c0.high
            if min_gap_pct > 0 and gap / c0.high * 100 < min_gap_pct:
                continue
            z = ZoneElement(
                x1=c0.index, x2=c2.index,
                y1=c0.high, y2=c2.low,
                fill_color=bull_color,
                border_color="#26a69a80",
                border_width=0.8,
                label="FVG" if label else "",
                label_color="#26a69a",
                extend_right=True,
            )
            zones.append(z)

        # Bearish FVG
        elif c0.low > c2.high:
            gap = c0.low - c2.high
            if min_gap_pct > 0 and gap / c0.low * 100 < min_gap_pct:
                continue
            z = ZoneElement(
                x1=c0.index, x2=c2.index,
                y1=c2.high, y2=c0.low,
                fill_color=bear_color,
                border_color="#ef535080",
                border_width=0.8,
                label="FVG" if label else "",
                label_color="#ef5350",
                extend_right=True,
            )
            zones.append(z)

    return zones


def detect_order_blocks(
    chart: "Chart",
    lookback: int = 5,
    bull_color: str = "#26a69a1a",
    bear_color: str = "#ef53501a",
    line_bull_color: str = "#26a69a",
    line_bear_color: str = "#ef5350",
    label: bool = True,
) -> list[tuple[ZoneElement, HLineElement]]:
    # Detect Order Blocks.
    candles = chart.candles
    results = []

    for i in range(lookback + 1, len(candles)):
        # Bullish OB
        recent_high = max(c.high for c in candles[i - lookback : i])
        if candles[i].close > recent_high:
            for j in range(i - 1, max(0, i - lookback - 1), -1):
                if not candles[j].is_bull:
                    ob = candles[j]
                    z = ZoneElement(
                        x1=ob.index - 0.5, x2=ob.index + 0.5,
                        y1=ob.low, y2=ob.high,
                        fill_color=bull_color,
                        border_color="#26a69a40",
                        border_width=0.8,
                        label="Bull OB" if label else "",
                        label_color="#26a69a",
                        label_size=9,
                        extend_right=True,
                    )
                    line = HLineElement(
                        y=ob.open,
                        color=line_bull_color,
                        linewidth=1.0,
                        linestyle="-",
                        label="",
                        x_start=ob.index,
                    )
                    results.append((z, line))
                    break

        # Bearish OB
        recent_low = min(c.low for c in candles[i - lookback : i])
        if candles[i].close < recent_low:
            for j in range(i - 1, max(0, i - lookback - 1), -1):
                if candles[j].is_bull:
                    ob = candles[j]
                    z = ZoneElement(
                        x1=ob.index - 0.5, x2=ob.index + 0.5,
                        y1=ob.low, y2=ob.high,
                        fill_color=bear_color,
                        border_color="#ef535040",
                        border_width=0.8,
                        label="Bear OB" if label else "",
                        label_color="#ef5350",
                        label_size=9,
                        extend_right=True,
                    )
                    line = HLineElement(
                        y=ob.open,
                        color=line_bear_color,
                        linewidth=1.0,
                        linestyle="-",
                        label="",
                        x_start=ob.index,
                    )
                    results.append((z, line))
                    break

    return results


def find_swing_points(chart: "Chart", strength: int = 3) -> tuple[list[tuple], list[tuple]]:
    # Find swing points.
    candles = chart.candles
    n = len(candles)
    swing_highs = []
    swing_lows = []

    for i in range(strength, n - strength):
        is_sh = True
        for j in range(i - strength, i + strength + 1):
            if j != i and candles[j].high >= candles[i].high:
                is_sh = False
                break
        if is_sh:
            swing_highs.append((i, candles[i].high))

        is_sl = True
        for j in range(i - strength, i + strength + 1):
            if j != i and candles[j].low <= candles[i].low:
                is_sl = False
                break
        if is_sl:
            swing_lows.append((i, candles[i].low))

    return swing_highs, swing_lows


def detect_bos(
    chart: "Chart",
    strength: int = 3,
    color: str = "#2196F3",
    label: bool = True,
) -> list:
    # Detect BOS.
    swing_highs, swing_lows = find_swing_points(chart, strength)
    candles = chart.candles
    results = []

    # Bullish BOS: breaks above swing high
    for idx, price in swing_highs:
        for i in range(idx + 1, len(candles)):
            if candles[i].close > price:
                line = LineElement(
                    points_x=[idx, i],
                    points_y=[price, price],
                    color=color, linewidth=1.2, linestyle="--",
                    draw_progress=0.0,
                )
                txt = TextElement(
                    text="BOS", x=(idx + i) / 2, y=price,
                    color=color, font_size=9, ha="center", va="bottom",
                ) if label else None
                results.append((line, txt))
                break

    # Bearish BOS: breaks below swing low
    for idx, price in swing_lows:
        for i in range(idx + 1, len(candles)):
            if candles[i].close < price:
                line = LineElement(
                    points_x=[idx, i],
                    points_y=[price, price],
                    color=color, linewidth=1.2, linestyle="--",
                    draw_progress=0.0,
                )
                txt = TextElement(
                    text="BOS", x=(idx + i) / 2, y=price,
                    color=color, font_size=9, ha="center", va="top",
                ) if label else None
                results.append((line, txt))
                break

    return results


def detect_choch(
    chart: "Chart",
    strength: int = 3,
    color: str = "#FF9800",
    label: bool = True,
) -> list:
    # Detect CHoCH.
    swing_highs, swing_lows = find_swing_points(chart, strength)
    candles = chart.candles
    results = []

    # Bullish-to-bearish: in uptrend, breaks below swing low
    for i in range(1, len(swing_lows)):
        prev_idx, prev_price = swing_lows[i - 1]
        curr_idx, curr_price = swing_lows[i]

        hh_between = [
            h for idx, h in swing_highs
            if prev_idx < idx < curr_idx
        ]
        if hh_between and curr_price < prev_price:
            for j in range(curr_idx, min(curr_idx + 10, len(candles))):
                if candles[j].close < prev_price:
                    line = LineElement(
                        points_x=[prev_idx, j],
                        points_y=[prev_price, prev_price],
                        color=color, linewidth=1.5, linestyle="-.",
                        draw_progress=0.0,
                    )
                    txt = TextElement(
                        text="CHoCH", x=(prev_idx + j) / 2, y=prev_price,
                        color=color, font_size=9, ha="center", va="top",
                    ) if label else None
                    results.append((line, txt))
                    break

    # Bearish-to-bullish: in downtrend, breaks above swing high
    for i in range(1, len(swing_highs)):
        prev_idx, prev_price = swing_highs[i - 1]
        curr_idx, curr_price = swing_highs[i]

        ll_between = [
            l for idx, l in swing_lows
            if prev_idx < idx < curr_idx
        ]
        if ll_between and curr_price > prev_price:
            for j in range(curr_idx, min(curr_idx + 10, len(candles))):
                if candles[j].close > prev_price:
                    line = LineElement(
                        points_x=[prev_idx, j],
                        points_y=[prev_price, prev_price],
                        color=color, linewidth=1.5, linestyle="-.",
                        draw_progress=0.0,
                    )
                    txt = TextElement(
                        text="CHoCH", x=(prev_idx + j) / 2, y=prev_price,
                        color=color, font_size=9, ha="center", va="bottom",
                    ) if label else None
                    results.append((line, txt))
                    break

    return results


def detect_liquidity(
    chart: "Chart",
    tolerance_pct: float = 0.1,
    min_touches: int = 2,
    strength: int = 5,
    color: str = "#FFD54F",
) -> list[HLineElement]:
    # Detect liquidity levels.
    swing_highs, swing_lows = find_swing_points(chart, strength=strength)
    levels = []

    # Buy-side liquidity (EQH)
    used = set()
    for i, (idx_i, h_i) in enumerate(swing_highs):
        if i in used:
            continue
        cluster = [(idx_i, h_i)]
        for j, (idx_j, h_j) in enumerate(swing_highs):
            if j != i and j not in used:
                if abs(h_j - h_i) / h_i * 100 < tolerance_pct:
                    cluster.append((idx_j, h_j))
                    used.add(j)
        if len(cluster) >= min_touches:
            used.add(i)
            avg_price = sum(p for _, p in cluster) / len(cluster)
            x_start = min(idx for idx, _ in cluster)
            levels.append(
                HLineElement(
                    y=avg_price, color=color, linewidth=1.0,
                    linestyle=":", label=f"BSL ({len(cluster)})",
                    label_color=color, label_size=8,
                    x_start=x_start,
                )
            )

    # Sell-side liquidity (EQL)
    used = set()
    for i, (idx_i, l_i) in enumerate(swing_lows):
        if i in used:
            continue
        cluster = [(idx_i, l_i)]
        for j, (idx_j, l_j) in enumerate(swing_lows):
            if j != i and j not in used:
                if abs(l_j - l_i) / l_i * 100 < tolerance_pct:
                    cluster.append((idx_j, l_j))
                    used.add(j)
        if len(cluster) >= min_touches:
            used.add(i)
            avg_price = sum(p for _, p in cluster) / len(cluster)
            x_start = min(idx for idx, _ in cluster)
            levels.append(
                HLineElement(
                    y=avg_price, color=color, linewidth=1.0,
                    linestyle=":", label=f"SSL ({len(cluster)})",
                    label_color=color, label_size=8,
                    x_start=x_start,
                )
            )

    return levels


def premium_discount_zones(
    high_price: float,
    low_price: float,
    x_start: float = 0,
    x_end: float = 50,
    premium_color: str = "#ef535012",
    discount_color: str = "#26a69a12",
    eq_color: str = "#787b86",
) -> tuple[ZoneElement, ZoneElement, HLineElement]:
    # Create PD zones.
    mid = (high_price + low_price) / 2

    premium = ZoneElement(
        x1=x_start, x2=x_end,
        y1=mid, y2=high_price,
        fill_color=premium_color,
        label="Premium", label_color="#ef5350", label_size=10,
        extend_right=True,
    )

    discount = ZoneElement(
        x1=x_start, x2=x_end,
        y1=low_price, y2=mid,
        fill_color=discount_color,
        label="Discount", label_color="#26a69a", label_size=10,
        extend_right=True,
    )

    eq_line = HLineElement(
        y=mid, color=eq_color, linewidth=1.0, linestyle="-.",
        label="Equilibrium", label_size=9,
        x_start=x_start, x_end=x_end,
    )

    return premium, discount, eq_line


def auto_markup(
    chart: "Chart",
    fvg: bool = True,
    order_blocks: bool = True,
    bos: bool = True,
    choch: bool = True,
    liquidity: bool = True,
) -> dict[str, list]:
    # Auto-detect all concepts.
    result = {}
    if fvg:
        result["fvg"] = detect_fvg(chart)
    if order_blocks:
        result["order_blocks"] = detect_order_blocks(chart)
    if bos:
        result["bos"] = detect_bos(chart)
    if choch:
        result["choch"] = detect_choch(chart)
    if liquidity:
        result["liquidity"] = detect_liquidity(chart)
    return result
