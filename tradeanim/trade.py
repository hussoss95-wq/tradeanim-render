# Trade engine.

from __future__ import annotations

from typing import TYPE_CHECKING, Optional

from .elements import HLineElement, TextElement, ZoneElement
from .scene import Animation

if TYPE_CHECKING:
    from .chart import Chart
    from .scene import Scene


class Trade:
    # Trade logic and visualization.

    def __init__(
        self,
        entry_index: int,
        entry_price: float,
        side: str,
        sl: float,
        tp: float,
        contracts: float = 1.0,
        point_value: float = 1.0,
        extend: int = 10,
        order_type: str = "market",
    ):
        self.entry_index = entry_index
        self.entry_price = entry_price
        self.side = side.lower()
        self.sl = sl
        self.tp = tp
        self.contracts = contracts
        self.point_value = point_value
        self.extend = extend
        self.order_type = order_type.lower()

        self.risk = abs(entry_price - sl)
        self.reward = abs(tp - entry_price)
        self.rr_ratio = self.reward / self.risk if self.risk > 0 else 0.0
        self.risk_amount = self.risk * contracts * point_value

        self.filled: bool = self.order_type == "market"
        self.fill_index: Optional[int] = entry_index if self.filled else None

        self.closed: bool = False
        self.close_reason: Optional[str] = None
        self.close_price: Optional[float] = None

        self.tp_zone: Optional[ZoneElement] = None
        self.sl_zone: Optional[ZoneElement] = None
        self.entry_line: Optional[HLineElement] = None
        self.info_text: Optional[TextElement] = None
        self.pnl_text: Optional[TextElement] = None
        self._elements: list = []

    def calculate_pnl(self, current_price: float) -> float:
        if self.side == "long":
            return (current_price - self.entry_price) * self.contracts * self.point_value
        return (self.entry_price - current_price) * self.contracts * self.point_value

    def calculate_r(self, current_price: float) -> float:
        if self.risk_amount == 0:
            return 0.0
        return self.calculate_pnl(current_price) / self.risk_amount

    def create_elements(
        self,
        show_pnl: bool = True,
        show_info: bool = True,
        pnl_x: float = 0.95,
        pnl_y: float = 0.92,
        tp_color: str = "#26a69a",
        sl_color: str = "#ef5350",
    ) -> list:
        # Create visual elements.
        x1 = self.entry_index
        x2 = self.entry_index + self.extend

        if self.side == "long":
            tp_bottom, tp_top = self.entry_price, self.tp
            sl_bottom, sl_top = self.sl, self.entry_price
        else:
            tp_bottom, tp_top = self.tp, self.entry_price
            sl_bottom, sl_top = self.entry_price, self.sl

        self.tp_zone = ZoneElement(
            x1=x1, x2=x2,
            y1=min(tp_bottom, tp_top), y2=max(tp_bottom, tp_top),
            fill_color=tp_color + "4D",
            border_color=tp_color + "80",
            border_width=0.8,
            label=f"TP {self.tp:g}",
            label_color=tp_color,
            label_size=10,
        )

        self.sl_zone = ZoneElement(
            x1=x1, x2=x2,
            y1=min(sl_bottom, sl_top), y2=max(sl_bottom, sl_top),
            fill_color=sl_color + "4D",
            border_color=sl_color + "80",
            border_width=0.8,
            label=f"SL {self.sl:g}",
            label_color=sl_color,
            label_size=10,
        )

        self.entry_line = HLineElement(
            y=self.entry_price,
            color="#d1d4dc",
            linewidth=1.2,
            linestyle="--",
            label=f"Entry {self.entry_price:g}",
            label_color="#d1d4dc",
            label_size=10,
            x_start=x1, x_end=x2,
        )

        self._elements = [self.tp_zone, self.sl_zone, self.entry_line]

        if show_info:
            side_str = "LONG" if self.side == "long" else "SHORT"
            order_prefix = "LIMIT " if self.order_type == "limit" else ""
            self.info_text = TextElement(
                text=f"{order_prefix}{side_str} {self.contracts:g}x  |  RR 1:{self.rr_ratio:.1f}",
                x=pnl_x, y=pnl_y,
                color="#d1d4dc",
                font_size=13,
                font_weight="bold",
                ha="right", va="top",
                use_data_coords=False,
            )
            self._elements.append(self.info_text)

        if show_pnl:
            y_pos = pnl_y - 0.04 if show_info else pnl_y
            initial_text = "Pending..." if self.order_type == "limit" else "PnL: $0.00 (0.0R)"
            self.pnl_text = TextElement(
                text=initial_text,
                x=pnl_x, y=y_pos,
                color="#787b86",
                font_size=15,
                font_weight="bold",
                ha="right", va="top",
                use_data_coords=False,
            )
            self._elements.append(self.pnl_text)

        return self._elements

    @property
    def elements(self) -> list:
        return self._elements


class ShowTrade(Animation):
    # Fade in trade elements.

    def __init__(self, trade: Trade, duration: float = 0.8, easing=None):
        super().__init__(duration=duration, easing=easing)
        self.trade = trade
        if not trade._elements:
            trade.create_elements()

    def on_start(self, scene: "Scene"):
        for e in self.trade.elements:
            e.opacity = 0.0
            e.visible = True
            scene.add_element(e)

    def on_update(self, scene: "Scene", progress: float):
        for e in self.trade.elements:
            e.opacity = progress

    def on_finish(self, scene: "Scene"):
        for e in self.trade.elements:
            e.opacity = 1.0


class UpdatePnL(Animation):
    # Update PnL text.

    def __init__(self, trade: Trade, chart: "Chart", duration: float = 5.0, easing=None):
        from .easing import linear
        super().__init__(duration=duration, easing=easing or linear)
        self.trade = trade
        self.chart = chart

    def _check_fill(self) -> bool:
        # Check fill status.
        trade = self.trade
        for c in self.chart.candles[trade.entry_index:]:
            if not (c.visible and c.opacity > 0.5):
                continue
            if c.low <= trade.entry_price <= c.high:
                trade.filled = True
                trade.fill_index = c.index
                if trade.info_text:
                    side_str = "LONG" if trade.side == "long" else "SHORT"
                    trade.info_text.text = f"{side_str} {trade.contracts:g}x  |  RR 1:{trade.rr_ratio:.1f}"
                return True
        return False

    def _check_tp_sl(self, latest_price: float) -> Optional[float]:
        # Check TP/SL hit.
        trade = self.trade
        if trade.closed:
            return trade.close_price

        for c in self.chart.candles[trade.entry_index:]:
            if not (c.visible and c.opacity > 0.5):
                continue
            if trade.side == "long":
                if c.high >= trade.tp:
                    trade.closed = True
                    trade.close_reason = "tp"
                    trade.close_price = trade.tp
                    return trade.tp
                if c.low <= trade.sl:
                    trade.closed = True
                    trade.close_reason = "sl"
                    trade.close_price = trade.sl
                    return trade.sl
            else:
                if c.low <= trade.tp:
                    trade.closed = True
                    trade.close_reason = "tp"
                    trade.close_price = trade.tp
                    return trade.tp
                if c.high >= trade.sl:
                    trade.closed = True
                    trade.close_reason = "sl"
                    trade.close_price = trade.sl
                    return trade.sl
        return None

    def on_update(self, scene: "Scene", progress: float):
        if not self.trade.pnl_text:
            return

        if not self.trade.filled:
            if not self._check_fill():
                self.trade.pnl_text.text = "Pending..."
                self.trade.pnl_text.color = "#787b86"
                return

        latest_price = self.trade.entry_price
        for c in self.chart.candles[self.trade.entry_index:]:
            if c.visible and c.opacity > 0.5:
                latest_price = c.close

        exit_price = self._check_tp_sl(latest_price)
        if exit_price is not None:
            latest_price = exit_price

        pnl = self.trade.calculate_pnl(latest_price)
        r_val = self.trade.calculate_r(latest_price)

        tag = ""
        if self.trade.closed:
            tag = " TP" if self.trade.close_reason == "tp" else " SL"

        if pnl >= 0:
            self.trade.pnl_text.text = f"PnL: +${pnl:,.2f} (+{r_val:.1f}R){tag}"
            self.trade.pnl_text.color = "#26a69a"
        else:
            self.trade.pnl_text.text = f"PnL: -${abs(pnl):,.2f} ({r_val:.1f}R){tag}"
            self.trade.pnl_text.color = "#ef5350"
