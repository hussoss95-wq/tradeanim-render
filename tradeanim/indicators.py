# Technical indicators.

from __future__ import annotations

from typing import TYPE_CHECKING, Optional

import numpy as np

from .elements import FillBetweenElement, HLineElement, LineElement, ZoneElement

if TYPE_CHECKING:
    from .chart import Chart

try:
    import talib
    HAS_TALIB = True
except ImportError:
    HAS_TALIB = False


def SMA(chart: "Chart", period: int = 20, color: str = "#2196F3", linewidth: float = 1.5, label: str = "") -> LineElement:
    # SMA.
    closes = chart.closes.astype(float)
    if HAS_TALIB:
        sma = talib.SMA(closes, timeperiod=period)
    else:
        sma = np.full_like(closes, np.nan)
        for i in range(period - 1, len(closes)):
            sma[i] = closes[i - period + 1 : i + 1].mean()

    mask = ~np.isnan(sma)
    xs = np.arange(len(closes))[mask].tolist()
    ys = sma[mask].tolist()
    return LineElement(
        points_x=xs, points_y=ys, color=color, linewidth=linewidth,
        label=label or f"SMA {period}", draw_progress=0.0,
    )


def EMA(chart: "Chart", period: int = 20, color: str = "#FF9800", linewidth: float = 1.5, label: str = "") -> LineElement:
    # EMA.
    closes = chart.closes.astype(float)
    if HAS_TALIB:
        ema = talib.EMA(closes, timeperiod=period)
    else:
        ema = np.full_like(closes, np.nan)
        k = 2.0 / (period + 1)
        ema[period - 1] = closes[:period].mean()
        for i in range(period, len(closes)):
            ema[i] = closes[i] * k + ema[i - 1] * (1 - k)

    mask = ~np.isnan(ema)
    xs = np.arange(len(closes))[mask].tolist()
    ys = ema[mask].tolist()
    return LineElement(
        points_x=xs, points_y=ys, color=color, linewidth=linewidth,
        label=label or f"EMA {period}", draw_progress=0.0,
    )


def BollingerBands(
    chart: "Chart",
    period: int = 20,
    std_dev: float = 2.0,
    color_mid: str = "#2196F3",
    color_upper: str = "#2196F380",
    color_lower: str = "#2196F380",
    fill_color: str = "#2196F315",
    linewidth: float = 1.2,
) -> tuple[LineElement, LineElement, LineElement, FillBetweenElement]:
    # Bollinger Bands.
    closes = chart.closes.astype(float)
    if HAS_TALIB:
        upper, mid, lower = talib.BBANDS(closes, timeperiod=period, nbdevup=std_dev, nbdevdn=std_dev)
    else:
        mid = np.full_like(closes, np.nan)
        upper = np.full_like(closes, np.nan)
        lower = np.full_like(closes, np.nan)

        for i in range(period - 1, len(closes)):
            window = closes[i - period + 1 : i + 1]
            m = window.mean()
            s = window.std()
            mid[i] = m
            upper[i] = m + std_dev * s
            lower[i] = m - std_dev * s

    mask = ~np.isnan(mid)
    xs = np.arange(len(closes))[mask].tolist()

    mid_line = LineElement(
        points_x=xs, points_y=mid[mask].tolist(),
        color=color_mid, linewidth=linewidth, label=f"BB {period}", draw_progress=0.0,
    )
    upper_line = LineElement(
        points_x=xs, points_y=upper[mask].tolist(),
        color=color_upper, linewidth=linewidth * 0.7, linestyle="--", draw_progress=0.0,
    )
    lower_line = LineElement(
        points_x=xs, points_y=lower[mask].tolist(),
        color=color_lower, linewidth=linewidth * 0.7, linestyle="--", draw_progress=0.0,
    )

    if xs:
        fill = FillBetweenElement(
            points_x=xs,
            upper_y=upper[mask].tolist(),
            lower_y=lower[mask].tolist(),
            fill_color=fill_color,
            draw_progress=0.0,
        )
    else:
        fill = FillBetweenElement()

    return mid_line, upper_line, lower_line, fill


def VWAP(chart: "Chart", color: str = "#E040FB", linewidth: float = 1.5, label: str = "VWAP") -> LineElement:
    # VWAP.
    closes = chart.closes.astype(float)
    volumes = chart.volumes.astype(float)
    highs = chart.highs.astype(float)
    lows = chart.lows.astype(float)

    typical = (highs + lows + closes) / 3
    cum_tp_vol = np.cumsum(typical * volumes)
    cum_vol = np.cumsum(volumes)
    vwap = np.where(cum_vol > 0, cum_tp_vol / cum_vol, np.nan)

    mask = ~np.isnan(vwap)
    xs = np.arange(len(closes))[mask].tolist()
    ys = vwap[mask].tolist()
    return LineElement(
        points_x=xs, points_y=ys, color=color, linewidth=linewidth,
        label=label, draw_progress=0.0,
    )


def SupportLine(y: float, color: str = "#26a69a", label: str = "Support", **kwargs) -> HLineElement:
    # Support level.
    return HLineElement(y=y, color=color, label=label, linestyle="--", linewidth=1.2, **kwargs)


def ResistanceLine(y: float, color: str = "#ef5350", label: str = "Resistance", **kwargs) -> HLineElement:
    # Resistance level.
    return HLineElement(y=y, color=color, label=label, linestyle="--", linewidth=1.2, **kwargs)


def TrendLine(
    x1: float, y1: float, x2: float, y2: float,
    color: str = "#FFD54F", linewidth: float = 1.5,
    extend: int = 10, label: str = "",
) -> LineElement:
    # Trendline.
    slope = (y2 - y1) / (x2 - x1) if x2 != x1 else 0
    x_end = x2 + extend
    y_end = y2 + slope * extend
    xs = [x1, x2, x_end]
    ys = [y1, y2, y_end]
    return LineElement(
        points_x=xs, points_y=ys, color=color, linewidth=linewidth,
        linestyle="--", label=label, draw_progress=0.0,
    )


def FibonacciRetracement(
    high_price: float,
    low_price: float,
    x_start: float = 0,
    x_end: Optional[float] = None,
    levels: Optional[list[float]] = None,
    colors: Optional[list[str]] = None,
) -> list[HLineElement]:
    # Fib retracements.
    if levels is None:
        levels = [0.0, 0.236, 0.382, 0.5, 0.618, 0.786, 1.0]
    if colors is None:
        colors = ["#787b86", "#ef5350", "#FF9800", "#FFD54F", "#26a69a", "#2196F3", "#787b86"]

    price_range = high_price - low_price
    result = []
    for i, level in enumerate(levels):
        price = high_price - price_range * level
        color = colors[i % len(colors)]
        hl = HLineElement(
            y=price, color=color, linewidth=1.0, linestyle="--",
            label=f"{level:.3f} ({price:,.2f})",
            label_size=9,
            x_start=x_start,
            x_end=x_end,
        )
        result.append(hl)
    return result


def RSI(chart: "Chart", period: int = 14) -> np.ndarray:
    # RSI values.
    closes = chart.closes.astype(float)
    if HAS_TALIB:
        rsi = talib.RSI(closes, timeperiod=period)
        return rsi

    deltas = np.diff(closes)
    gains = np.where(deltas > 0, deltas, 0.0)
    losses = np.where(deltas < 0, -deltas, 0.0)

    avg_gain = np.zeros(len(closes))
    avg_loss = np.zeros(len(closes))

    avg_gain[period] = gains[:period].mean()
    avg_loss[period] = losses[:period].mean()

    for i in range(period + 1, len(closes)):
        avg_gain[i] = (avg_gain[i - 1] * (period - 1) + gains[i - 1]) / period
        avg_loss[i] = (avg_loss[i - 1] * (period - 1) + losses[i - 1]) / period

    with np.errstate(divide="ignore", invalid="ignore"):
        rs = np.where(avg_loss > 0, avg_gain / avg_loss, 100.0)
    rsi = 100.0 - 100.0 / (1.0 + rs)
    rsi[:period] = np.nan
    return rsi


def MACD(
    chart: "Chart",
    fast: int = 12,
    slow: int = 26,
    signal: int = 9,
    color_macd: str = "#2196F3",
    color_signal: str = "#FF9800",
    color_hist: str = "#26a69a",
    linewidth: float = 1.5,
) -> tuple[LineElement, LineElement, list[float]]:
    # MACD.
    closes = chart.closes.astype(float)

    if HAS_TALIB:
        macd_vals, signal_vals, hist_vals = talib.MACD(
            closes, fastperiod=fast, slowperiod=slow, signalperiod=signal,
        )
    else:
        def _ema(data, period):
            out = np.full_like(data, np.nan)
            if len(data) < period:
                return out
            k = 2.0 / (period + 1)
            out[period - 1] = data[:period].mean()
            for i in range(period, len(data)):
                out[i] = data[i] * k + out[i - 1] * (1 - k)
            return out

        ema_fast = _ema(closes, fast)
        ema_slow = _ema(closes, slow)
        macd_vals = ema_fast - ema_slow
        valid_start = slow - 1
        signal_vals = np.full_like(macd_vals, np.nan)
        macd_valid = macd_vals[valid_start:]
        if len(macd_valid) >= signal:
            sig = np.full_like(macd_valid, np.nan)
            k = 2.0 / (signal + 1)
            sig[signal - 1] = macd_valid[:signal].mean()
            for i in range(signal, len(macd_valid)):
                sig[i] = macd_valid[i] * k + sig[i - 1] * (1 - k)
            signal_vals[valid_start:] = sig
        hist_vals = macd_vals - signal_vals

    mask_macd = ~np.isnan(macd_vals)
    mask_signal = ~np.isnan(signal_vals)

    xs_macd = np.arange(len(closes))[mask_macd].tolist()
    ys_macd = macd_vals[mask_macd].tolist()
    xs_signal = np.arange(len(closes))[mask_signal].tolist()
    ys_signal = signal_vals[mask_signal].tolist()

    macd_line = LineElement(
        points_x=xs_macd, points_y=ys_macd,
        color=color_macd, linewidth=linewidth,
        label="MACD", draw_progress=0.0,
    )
    signal_line = LineElement(
        points_x=xs_signal, points_y=ys_signal,
        color=color_signal, linewidth=linewidth * 0.8,
        label="Signal", draw_progress=0.0,
    )

    mask_hist = ~np.isnan(hist_vals)
    hist_values = hist_vals[mask_hist].tolist()

    return macd_line, signal_line, hist_values


def Stochastic(
    chart: "Chart",
    k_period: int = 14,
    d_period: int = 3,
    color_k: str = "#2196F3",
    color_d: str = "#FF9800",
    linewidth: float = 1.5,
) -> tuple[LineElement, LineElement]:
    # Stochastic.
    closes = chart.closes.astype(float)
    highs = chart.highs.astype(float)
    lows = chart.lows.astype(float)

    if HAS_TALIB:
        k_vals, d_vals = talib.STOCH(
            highs, lows, closes,
            fastk_period=k_period, slowk_period=d_period, slowd_period=d_period,
        )
    else:
        k_vals = np.full_like(closes, np.nan)
        for i in range(max(0, k_period - 1), len(closes)):
            h_max = highs[i - k_period + 1 : i + 1].max()
            l_min = lows[i - k_period + 1 : i + 1].min()
            if h_max != l_min:
                k_vals[i] = (closes[i] - l_min) / (h_max - l_min) * 100.0
            else:
                k_vals[i] = 50.0

        # %D = SMA of %K
        d_vals = np.full_like(k_vals, np.nan)
        valid_k = ~np.isnan(k_vals)
        k_indices = np.where(valid_k)[0]
        for j in range(d_period - 1, len(k_indices)):
            idx = k_indices[j]
            window_indices = k_indices[j - d_period + 1 : j + 1]
            d_vals[idx] = k_vals[window_indices].mean()

    mask_k = ~np.isnan(k_vals)
    mask_d = ~np.isnan(d_vals)

    xs_k = np.arange(len(closes))[mask_k].tolist()
    ys_k = k_vals[mask_k].tolist()
    xs_d = np.arange(len(closes))[mask_d].tolist()
    ys_d = d_vals[mask_d].tolist()

    k_line = LineElement(
        points_x=xs_k, points_y=ys_k,
        color=color_k, linewidth=linewidth,
        label=f"%K({k_period})", draw_progress=0.0,
    )
    d_line = LineElement(
        points_x=xs_d, points_y=ys_d,
        color=color_d, linewidth=linewidth * 0.8,
        label=f"%D({d_period})", draw_progress=0.0,
    )

    return k_line, d_line


def ATR(
    chart: "Chart",
    period: int = 14,
    color: str = "#E040FB",
    linewidth: float = 1.5,
    label: str = "",
) -> LineElement:
    # ATR.
    closes = chart.closes.astype(float)
    highs = chart.highs.astype(float)
    lows = chart.lows.astype(float)

    if HAS_TALIB:
        atr_vals = talib.ATR(highs, lows, closes, timeperiod=period)
    else:
        tr = np.zeros(len(closes))
        tr[0] = highs[0] - lows[0]
        for i in range(1, len(closes)):
            tr[i] = max(
                highs[i] - lows[i],
                abs(highs[i] - closes[i - 1]),
                abs(lows[i] - closes[i - 1]),
            )

        # Wilder smoothing
        atr_vals = np.full_like(closes, np.nan)
        if len(closes) >= period:
            atr_vals[period - 1] = tr[:period].mean()
            for i in range(period, len(closes)):
                atr_vals[i] = (atr_vals[i - 1] * (period - 1) + tr[i]) / period

    mask = ~np.isnan(atr_vals)
    xs = np.arange(len(closes))[mask].tolist()
    ys = atr_vals[mask].tolist()

    return LineElement(
        points_x=xs, points_y=ys, color=color, linewidth=linewidth,
        label=label or f"ATR {period}", draw_progress=0.0,
    )
