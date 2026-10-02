# Chart data and elements.

from __future__ import annotations

from typing import Optional

import pandas as pd
import numpy as np

from .elements import AreaElement, CandleElement, LineElement, OHLCBarElement


class Chart:
    # Holds OHLC data and visual elements.

    def __init__(self, df: pd.DataFrame, chart_type: str = "candlestick"):
        self.df = df.reset_index(drop=True)
        self.chart_type = chart_type
        self.candles: list[CandleElement] = []
        self.elements: list = []
        self.timestamps: list[str] = []
        self._build_elements()

    @classmethod
    def from_csv(
        cls,
        path: str,
        chart_type: str = "candlestick",
        date_col: Optional[str] = None,
        open_col: str = "open",
        high_col: str = "high",
        low_col: str = "low",
        close_col: str = "close",
        volume_col: str = "volume",
        start: Optional[int] = None,
        end: Optional[int] = None,
    ) -> "Chart":
        # Load from CSV.
        df = pd.read_csv(path)
        df.columns = df.columns.str.strip().str.lower()

        # Auto-detect date column
        if date_col:
            date_col = date_col.lower()
        else:
            for candidate in ["date", "datetime", "timestamp", "time", "dt"]:
                if candidate in df.columns:
                    date_col = candidate
                    break

        if start is not None or end is not None:
            df = df.iloc[start:end].reset_index(drop=True)

        chart = cls(df, chart_type=chart_type)
        if date_col and date_col in df.columns:
            chart.timestamps = df[date_col].astype(str).tolist()
        else:
            chart.timestamps = [str(i) for i in range(len(df))]

        return chart

    def _build_elements(self):
        # Always build candles for indicator compatibility
        self._build_candles()
        if self.chart_type == "candlestick":
            self.elements = list(self.candles)
        elif self.chart_type == "line":
            self.elements = [self._build_line()]
        elif self.chart_type == "area":
            self.elements = [self._build_area()]
        elif self.chart_type == "ohlc":
            self._build_ohlc_bars()
        else:
            self.elements = list(self.candles)

    def _build_candles(self):
        self.candles = []
        for i, row in self.df.iterrows():
            c = CandleElement(
                index=i,
                open=float(row.get("open", 0)),
                high=float(row.get("high", 0)),
                low=float(row.get("low", 0)),
                close=float(row.get("close", 0)),
                volume=float(row.get("volume", 0) if pd.notna(row.get("volume", 0)) else 0),
                visible=False,
                opacity=0.0,
            )
            self.candles.append(c)

    def _build_line(self) -> LineElement:
        closes = self.df["close"].values.astype(float)
        xs = list(range(len(closes)))
        ys = closes.tolist()
        return LineElement(
            points_x=xs, points_y=ys, color="#2196F3", linewidth=1.5,
            label="Close", draw_progress=0.0, visible=False, opacity=0.0,
        )

    def _build_area(self) -> AreaElement:
        closes = self.df["close"].values.astype(float)
        xs = list(range(len(closes)))
        ys = closes.tolist()
        return AreaElement(
            points_x=xs, points_y=ys, color="#2196F3", linewidth=1.5,
            fill_color="#2196F3", fill_alpha_top=0.4, fill_alpha_bottom=0.0,
            draw_progress=0.0, visible=False, opacity=0.0,
        )

    def _build_ohlc_bars(self):
        bars = []
        for i, row in self.df.iterrows():
            b = OHLCBarElement(
                index=i,
                open=float(row.get("open", 0)),
                high=float(row.get("high", 0)),
                low=float(row.get("low", 0)),
                close=float(row.get("close", 0)),
                volume=float(row.get("volume", 0) if pd.notna(row.get("volume", 0)) else 0),
                visible=False,
                opacity=0.0,
            )
            bars.append(b)
        self.elements = bars

    def __len__(self) -> int:
        return len(self.candles)

    def __getitem__(self, idx) -> CandleElement:
        return self.candles[idx]

    def price_at(self, idx: int) -> float:
        return self.candles[idx].close

    def high_at(self, idx: int) -> float:
        return self.candles[idx].high

    def low_at(self, idx: int) -> float:
        return self.candles[idx].low

    def slice(self, start: int, end: int) -> list[CandleElement]:
        return self.candles[start:end]

    @property
    def highs(self) -> np.ndarray:
        return self.df["high"].values

    @property
    def lows(self) -> np.ndarray:
        return self.df["low"].values

    @property
    def closes(self) -> np.ndarray:
        return self.df["close"].values

    @property
    def opens(self) -> np.ndarray:
        return self.df["open"].values

    @property
    def volumes(self) -> np.ndarray:
        if "volume" in self.df.columns:
            return self.df["volume"].fillna(0).values
        return np.zeros(len(self.df))
