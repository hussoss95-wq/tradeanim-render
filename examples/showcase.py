# Showcase v3: comprehensive demo of all tradeanim features.

import sys, os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pandas as pd
from tradeanim import *
from tradeanim.easing import (
    linear,
    ease_in_quad,
    ease_out_quad,
    ease_in_out_quad,
    ease_in_cubic,
    ease_out_cubic,
    ease_in_out_cubic,
    ease_in_sine,
    ease_out_sine,
    ease_in_out_sine,
    ease_in_expo,
    ease_out_expo,
    ease_in_out_expo,
    ease_out_back,
    ease_out_elastic,
    ease_out_bounce,
)


class _SetTheme(Animation):
    # Switch theme.

    def __init__(self, theme):
        super().__init__(duration=0.05)
        self._theme = theme

    def on_start(self, scene):
        scene.config.theme = self._theme
        bg = self._theme.background
        scene.config.background_gradient = (bg, bg)


class _SetProp(Animation):
    # Run callback.

    def __init__(self, callback):
        super().__init__(duration=0.05)
        self._cb = callback

    def on_start(self, scene):
        self._cb(scene)


def _bounds(candles):
    # Price bounds.
    highs = [c.high for c in candles]
    lows = [c.low for c in candles]
    return min(lows), max(highs)


def _label(text, y=0.06):
    # Bottom-center label.
    lbl = ScreenText(text, x=0.5, y=y, font_size=12, color="#787b86")
    lbl.ha = "center"
    return lbl


def _section_header(text):
    # Section title.
    return OutlinedText(
        text,
        x=0.5,
        y=0.93,
        font_size=16,
        color="#d1d4dc",
        outline_color="#000000",
        outline_width=2,
    )


class ShowcaseV3(Scene):
    def construct(self):
        data = os.path.join(os.path.dirname(__file__), "data", "sample_ohlc.csv")
        pp = self.config.post_processing
        chart = self.load_chart(data)
        n = len(chart)
        hi, lo = _bounds(chart.candles)
        rng = hi - lo
        mid_price = (hi + lo) / 2

        def _full_view():
            # Full chart view.
            return PanCamera(
                view_start=-1,
                view_end=n + 3,
                price_min=lo - rng * 0.05,
                price_max=hi + rng * 0.05,
            )

        def _fit_camera(candles):
            # Fit camera to candles.
            clo, chi = _bounds(candles)
            cr = chi - clo
            return PanCamera(
                view_start=-1,
                view_end=len(candles) + 2,
                price_min=clo - cr * 0.1,
                price_max=chi + cr * 0.1,
            )

        # Title

        title = ShadowedTitle(
            "tradeanim",
            font_size=48,
            x=0.5,
            y=0.55,
            shadow_color="#000000",
            shadow_offset_x=3,
            shadow_offset_y=-3,
        )
        title.ha = "center"
        sub = OutlinedText(
            "Complete Feature Showcase",
            x=0.5,
            y=0.43,
            font_size=18,
            color="#787b86",
            outline_color="#000000",
            outline_width=2,
        )

        self.play(ScaleIn(title, easing=ease_out_back), duration=0.8)
        self.play_with_previous(FadeIn(sub), duration=0.6, offset=0.4)
        self.wait(1.0)
        self.play(FadeOut(title, sub), duration=0.6)

        # Candle reveal

        for c in chart.candles[:30]:
            c.glow_enabled = True
            c.glow_intensity = 0.2

        lbl = ScreenText(
            'CandlesAppear: "sequential"', x=0.5, y=0.93, font_size=13, color="#787b86"
        )
        lbl.ha = "center"
        self.play(FadeIn(lbl), duration=0.2)
        self.play(CandlesAppear(chart, end=50, style="sequential"), duration=3.5)

        add_lbl = ScreenText(
            "+ AddCandles", x=0.5, y=0.88, font_size=12, color="#787b86"
        )
        add_lbl.ha = "center"
        self.play(FadeIn(add_lbl), duration=0.2)
        self.play(AddCandles(chart, start=50, end=n), duration=1.5)
        self.wait(0.3)
        self.play(FadeOut(lbl, add_lbl, remove=True), duration=0.3)
        self.play(
            _SetProp(
                lambda s: [
                    setattr(c, "glow_enabled", False) for c in chart.candles[:30]
                ]
            ),
            duration=0.05,
        )

        # Themes

        themes = [
            ("Midnight Theme", MIDNIGHT_THEME),
            ("Dark Theme (Default)", DARK_THEME),
            ("Black Theme", BLACK_THEME),
            ("White Theme", WHITE_THEME),
            ("White Green Theme", WHITE_GREEN_THEME),
            ("Light Theme", LIGHT_THEME),
        ]

        prev_tlbl = None
        for name, theme in themes:
            tlbl = ScreenText(name, x=0.5, y=0.93, font_size=16, color=theme.text_color)
            tlbl.ha = "center"
            if prev_tlbl:
                self.play(FadeOut(prev_tlbl, remove=True), duration=0.15)
            self.play(_SetTheme(theme), duration=0.05)
            self.play(FadeIn(tlbl), duration=0.3)
            self.wait(1.0)
            prev_tlbl = tlbl

        if prev_tlbl:
            self.play(FadeOut(prev_tlbl, remove=True), duration=0.3)
        self.play(_SetTheme(MIDNIGHT_THEME), duration=0.05)
        self.wait(0.2)

        # CandlesAppear styles

        self.play(FadeOut(*chart.candles), duration=0.4)

        for sname in ["slide_up", "pop", "cascade", "fade"]:
            tmp = Chart.from_csv(data, start=15, end=45)
            sl = ScreenText(
                f'CandlesAppear: "{sname}"',
                x=0.5,
                y=0.93,
                font_size=13,
                color="#787b86",
            )
            sl.ha = "center"
            self.play(FadeIn(sl), duration=0.2)
            self.play(CandlesAppear(tmp, style=sname), duration=1.8)
            self.wait(0.4)
            self.play(FadeOut(*tmp.candles, sl, remove=True), duration=0.3)

        # Chart types

        for ctype, clabel in [
            ("line", "Line Chart"),
            ("area", "Area Chart"),
            ("ohlc", "OHLC Bars"),
        ]:
            ct = Chart.from_csv(data, chart_type=ctype)
            tl = ScreenText(clabel, x=0.5, y=0.93, font_size=16, color="#d1d4dc")
            tl.ha = "center"
            self.play(FadeIn(tl), duration=0.3)
            self.play(ChartAppear(ct), duration=2.5)
            self.wait(0.6)
            self.play(FadeOut(*ct.elements, tl, remove=True), duration=0.4)

        # Technical indicators

        self.play(FadeIn(*chart.candles), duration=0.5)
        self.play(_full_view(), duration=0.5)

        hdr = _section_header("Technical Indicators")
        self.play(FadeIn(hdr), duration=0.3)

        sma = SMA(chart, 20, color="#2196F3", label="SMA 20")
        ema = EMA(chart, 10, color="#FF9800", label="EMA 10")
        self.play(DrawLine(sma, easing=ease_in_out_cubic), duration=2.0)
        self.play_with_previous(DrawLine(ema), duration=2.0, offset=0.5)
        self.wait(0.5)

        bb_mid, bb_up, bb_lo, bb_fill = BollingerBands(chart, 20)
        self.play(DrawLine(bb_mid), DrawLine(bb_up), DrawLine(bb_lo), duration=1.5)
        self.play_with_previous(FadeIn(bb_fill), duration=0.8, offset=0.5)
        self.wait(0.5)

        vwap = VWAP(chart, color="#E040FB")
        self.play(DrawLine(vwap), duration=1.5)
        self.wait(0.3)
        self.play(
            FadeOut(sma, ema, bb_mid, bb_up, bb_lo, bb_fill, vwap, remove=True),
            duration=0.4,
        )

        sup = SupportLine(lo + rng * 0.15, label="Support")
        res = ResistanceLine(hi - rng * 0.15, label="Resistance")
        self.play(FadeIn(sup, res), duration=0.5)

        trend = TrendLine(
            5, chart.low_at(5), 40, chart.low_at(40), color="#FFD54F", extend=10
        )
        self.play(DrawLine(trend), duration=1.0)

        fibs = FibonacciRetracement(hi, lo, x_start=0, x_end=n)
        self.play(StaggeredFadeIn(*fibs, stagger=0.08), duration=0.6)
        self.wait(0.8)
        self.play(FadeOut(sup, res, trend, *fibs, remove=True), duration=0.4)

        # Rescale MACD to fit on price chart
        ml, sl_line, _ = MACD(chart)
        if ml.points_y:
            mx = max(abs(v) for v in ml.points_y) or 1
            ml.points_y = [mid_price + (v / mx) * rng * 0.25 for v in ml.points_y]
        if sl_line.points_y:
            sx = max(abs(v) for v in sl_line.points_y) or 1
            sl_line.points_y = [
                mid_price + (v / sx) * rng * 0.25 for v in sl_line.points_y
            ]
        m_lbl = ScreenText("MACD", x=0.08, y=0.88, font_size=12, color="#2196F3")
        self.play(FadeIn(m_lbl), duration=0.2)
        self.play(DrawLine(ml), DrawLine(sl_line), duration=1.5)
        self.wait(0.5)
        self.play(FadeOut(ml, sl_line, m_lbl, remove=True), duration=0.3)

        # Rescale Stochastic (0-100) to price range
        k_line, d_line = Stochastic(chart)
        if k_line.points_y:
            k_line.points_y = [lo + (v / 100) * rng for v in k_line.points_y]
        if d_line.points_y:
            d_line.points_y = [lo + (v / 100) * rng for v in d_line.points_y]
        s_lbl = ScreenText("Stochastic", x=0.08, y=0.88, font_size=12, color="#2196F3")
        self.play(FadeIn(s_lbl), duration=0.2)
        self.play(DrawLine(k_line), DrawLine(d_line), duration=1.5)
        self.wait(0.5)
        self.play(FadeOut(k_line, d_line, s_lbl, remove=True), duration=0.3)

        # Rescale ATR to lower 30% of chart
        atr = ATR(chart, color="#7B1FA2")
        if atr.points_y:
            ax = max(atr.points_y) or 1
            atr.points_y = [lo + (v / ax) * rng * 0.3 for v in atr.points_y]
        a_lbl = ScreenText("ATR", x=0.08, y=0.88, font_size=12, color="#7B1FA2")
        self.play(FadeIn(a_lbl), duration=0.2)
        self.play(DrawLine(atr), duration=1.5)
        self.wait(0.5)
        self.play(FadeOut(atr, a_lbl, hdr, remove=True), duration=0.3)

        # ICT concepts

        ict_hdr = _section_header("ICT Concepts")
        self.play(FadeIn(ict_hdr), duration=0.3)
        self.play(
            ZoomTo(chart, 15, 55, padding=0.1, easing=ease_in_out_sine), duration=1.2
        )

        fvgs = detect_fvg(chart)[:5]
        if fvgs:
            fl = ScreenText(
                "Fair Value Gaps", x=0.08, y=0.88, font_size=12, color="#787b86"
            )
            self.play(FadeIn(fl), duration=0.2)
            self.play(StaggeredFadeIn(*fvgs, stagger=0.1), duration=0.6)
            self.wait(0.8)
            self.play(FadeOut(*fvgs, fl, remove=True), duration=0.4)

        obs = detect_order_blocks(chart, lookback=5)[:3]
        ob_els = []
        if obs:
            ol = ScreenText(
                "Order Blocks", x=0.08, y=0.88, font_size=12, color="#787b86"
            )
            self.play(FadeIn(ol), duration=0.2)
            for zone, hline in obs:
                self.play(HighlightZone(zone), duration=0.4)
                self.play_with_previous(FadeIn(hline), duration=0.3, offset=0.1)
                ob_els.extend([zone, hline])
            self.wait(0.6)
            self.play(FadeOut(*ob_els, ol, remove=True), duration=0.4)

        self.play(
            PanCamera(
                view_start=30,
                view_end=n + 3,
                price_min=lo - rng * 0.05,
                price_max=hi + rng * 0.05,
                easing=ease_in_out_sine,
            ),
            duration=1.0,
        )

        bos_items = detect_bos(chart, strength=3)[:3]
        bos_els = []
        if bos_items:
            bl = ScreenText(
                "Break of Structure", x=0.08, y=0.88, font_size=12, color="#2196F3"
            )
            self.play(FadeIn(bl), duration=0.2)
            for line, txt in bos_items:
                self.play(DrawLine(line, duration=0.4), duration=0.4)
                bos_els.append(line)
                if txt:
                    self.play_with_previous(FadeIn(txt), duration=0.3, offset=0.1)
                    bos_els.append(txt)
            self.wait(0.5)
            self.play(FadeOut(*bos_els, bl, remove=True), duration=0.4)

        choch_items = detect_choch(chart, strength=3)[:2]
        choch_els = []
        if choch_items:
            cl = ScreenText(
                "Change of Character", x=0.08, y=0.88, font_size=12, color="#FF9800"
            )
            self.play(FadeIn(cl), duration=0.2)
            for line, txt in choch_items:
                self.play(DrawLine(line, duration=0.4), duration=0.4)
                choch_els.append(line)
                if txt:
                    self.play_with_previous(FadeIn(txt), duration=0.3, offset=0.1)
                    choch_els.append(txt)
            self.wait(0.5)
            self.play(FadeOut(*choch_els, cl, remove=True), duration=0.4)

        self.play(
            PanCamera(
                view_start=-1,
                view_end=n + 3,
                price_min=lo - rng * 0.05,
                price_max=hi + rng * 0.05,
                easing=ease_in_out_cubic,
            ),
            duration=1.0,
        )

        liq = detect_liquidity(chart, tolerance_pct=0.15, min_touches=2, strength=5)[:5]
        if liq:
            ll = ScreenText(
                "Liquidity Levels", x=0.08, y=0.88, font_size=12, color="#FFD54F"
            )
            self.play(FadeIn(ll), duration=0.2)
            self.play(StaggeredFadeIn(*liq, stagger=0.08), duration=0.5)
            self.wait(0.6)

        premium, discount, eq = premium_discount_zones(hi, lo, x_start=0, x_end=n)
        pl = ScreenText(
            "Premium / Discount", x=0.08, y=0.84, font_size=12, color="#787b86"
        )
        self.play(FadeIn(pl), duration=0.2)
        self.play(HighlightZone(premium), HighlightZone(discount), duration=0.6)
        self.play_with_previous(FadeIn(eq), duration=0.4, offset=0.2)
        self.wait(0.8)

        ict_fade = list(liq) + [premium, discount, eq, pl, ict_hdr]
        if liq:
            ict_fade.append(ll)
        self.play(FadeOut(*ict_fade, remove=True), duration=0.5)

        # Trade engine: SSL sweep

        trade_hdr = _section_header("Trade Engine: SSL Sweep")
        self.play(FadeIn(trade_hdr), duration=0.3)
        self.play(FadeOut(*chart.candles), duration=0.4)

        # Synthetic price action: swing low at 95 → sweep → FVG → tap → continuation
        ssl_ohlc = [
            (105, 107, 104, 106),
            (106, 107, 100, 101),  # setup
            (101, 102, 95, 96),
            (96, 100, 95, 99),  # swing low at 95
            (99, 103, 98, 102),
            (102, 104, 101, 103),
            (103, 104, 101, 102),
            (102, 103, 99, 100),  # decline
            (100, 101, 97, 98),
            (98, 99, 96, 97),
            (97, 98, 95, 96),
            (96, 97, 94, 95),  # at SSL
            (95, 96, 92, 93),
            (93, 101, 92, 100),  # sweep + displacement
            (100, 106, 99, 105),  # FVG: 96-99
            (105, 106, 101, 102),
            (102, 103, 97, 98),  # pullback taps FVG
            (98, 102, 97, 101),  # bounce
            (101, 105, 100, 104),
            (104, 108, 103, 107),  # continuation
            (107, 111, 106, 110),
            (110, 114, 109, 113),
            (113, 116, 112, 115),
        ]
        ssl_df = pd.DataFrame(ssl_ohlc, columns=["open", "high", "low", "close"])
        ssl_chart = Chart(ssl_df)
        self.chart = ssl_chart

        for sc in ssl_chart.candles:
            sc.glow_enabled = True
            sc.glow_intensity = 0.15

        ssl_lo, ssl_hi = _bounds(ssl_chart.candles)
        ssl_rng = ssl_hi - ssl_lo
        self.play(
            PanCamera(
                view_start=-1,
                view_end=len(ssl_chart) + 2,
                price_min=ssl_lo - ssl_rng * 0.08,
                price_max=ssl_hi + ssl_rng * 0.08,
            ),
            duration=0.5,
        )

        ssl_line = HLineElement(
            y=95,
            color="#FFD54F",
            linewidth=1.5,
            linestyle="--",
            label="SSL",
            label_color="#FFD54F",
            label_size=12,
        )
        self.play(FadeIn(ssl_line), duration=0.4)

        p1 = _label("Establishing swing low")
        self.play(FadeIn(p1), duration=0.2)
        self.play(CandleGrow(*ssl_chart.candles[:6], auto_camera=False), duration=2.0)
        self.play(FadeOut(p1, remove=True), duration=0.2)

        p2 = _label("Declining toward SSL")
        self.play(FadeIn(p2), duration=0.2)
        self.play(
            AddCandles(ssl_chart, start=6, end=12, auto_camera=False), duration=1.5
        )
        self.play(FadeOut(p2, remove=True), duration=0.2)

        p3 = _label("SSL Sweep + Displacement")
        p3.color = "#ef5350"
        self.play(FadeIn(p3), duration=0.2)
        self.play(
            AddCandles(ssl_chart, start=12, end=15, auto_camera=False), duration=2.5
        )

        ssl_fvgs = detect_fvg(ssl_chart)
        target_fvg = None
        for f in ssl_fvgs:
            if 11 <= f.x1 <= 13:
                target_fvg = f
                break
        if target_fvg:
            self.play(HighlightZone(target_fvg), duration=0.6)
        self.play(FadeOut(p3, remove=True), duration=0.2)
        self.wait(0.5)

        trade = Trade(
            entry_index=14,
            entry_price=99,
            side="long",
            sl=90,
            tp=113,
            contracts=2,
            point_value=50,
            extend=10,
            order_type="limit",
        )
        self.play(ShowTrade(trade), duration=0.6)
        self.wait(0.3)

        p4 = _label("Pullback taps FVG \u2192 Limit Fill")
        p4.color = "#26a69a"
        self.play(FadeIn(p4), duration=0.2)
        self.play(
            AddCandles(ssl_chart, start=15, end=18, auto_camera=False), duration=1.5
        )
        self.play_with_previous(UpdatePnL(trade, ssl_chart), duration=1.5)
        self.play(
            FlashCandle(ssl_chart[16], flash_color="#FFD54F", cycles=4), duration=1.0
        )
        self.play(FadeOut(p4, remove=True), duration=0.2)

        p5 = _label("Continuation \u2192 TP Hit")
        p5.color = "#26a69a"
        self.play(FadeIn(p5), duration=0.2)
        self.play(
            AddCandles(ssl_chart, start=18, end=23, auto_camera=False), duration=2.0
        )
        self.play_with_previous(UpdatePnL(trade, ssl_chart), duration=2.0)
        self.wait(0.8)

        trade_els = [
            e
            for e in [
                trade.tp_zone,
                trade.sl_zone,
                trade.entry_line,
                trade.info_text,
                trade.pnl_text,
            ]
            if e is not None
        ]
        ssl_fade = list(ssl_chart.candles) + trade_els + [ssl_line, p5, trade_hdr]
        if target_fvg:
            ssl_fade.append(target_fvg)
        self.play(FadeOut(*ssl_fade, remove=True), duration=0.5)

        self.chart = chart
        self.play(FadeIn(*chart.candles), duration=0.5)
        self.play(_full_view(), duration=0.5)

        # Text helpers

        txt_hdr = _section_header("Text & Elements")
        self.play(FadeIn(txt_hdr), duration=0.3)

        t1 = Title("Chart Title")
        t2 = Subtitle("with subtitle text")
        self.play(SlideIn(t1, direction="left"), duration=0.5)
        self.play(FadeIn(t2), duration=0.3)

        ct_txt = ChartText(
            "Key Level", x=20, y=chart.high_at(20) + 200, font_size=12, color="#FFD54F"
        )
        self.play(FadeIn(ct_txt), duration=0.3)

        price_lbl = PriceLabel(chart.price_at(40), x=40)
        self.play(FadeIn(price_lbl), duration=0.3)

        arrow = ArrowElement(
            x1=35,
            y1=chart.low_at(35) - 400,
            x2=35,
            y2=chart.low_at(35) - 50,
            color="#11cd83",
            linewidth=2,
            head_width=0.5,
            label="Entry",
            label_color="#11cd83",
        )
        self.play(FadeIn(arrow), duration=0.3)

        ab = AnnotationBox("Reversal Zone", x=0.75, y=0.15, font_size=12)
        self.play(BounceIn(ab, easing=ease_out_bounce), duration=0.6)

        styled = StyledText(
            "Styled Text",
            x=0.75,
            y=0.75,
            font_size=20,
            color="#d1d4dc",
            font_weight="bold",
            text_shadow={"color": "#000", "offset_x": 2, "offset_y": -2, "alpha": 0.5},
            text_outline={"color": "#2196F3", "width": 2},
        )
        self.play(FadeIn(styled), duration=0.3)

        typed = ScreenText(
            "Typing animation...", x=0.5, y=0.06, font_size=13, color="#787b86"
        )
        typed.ha = "center"
        self.play(TypeText(typed, easing=linear), duration=1.5)
        self.wait(0.5)

        self.play(SlideOut(t1, direction="left"), duration=0.4)
        self.play(
            FadeOut(
                t2, ct_txt, price_lbl, arrow, ab, styled, typed, txt_hdr, remove=True
            ),
            duration=0.4,
        )

        # Animation effects

        anim_hdr = _section_header("Animation Effects")
        self.play(FadeIn(anim_hdr), duration=0.3)

        fl = _label("FlashCandle")
        self.play(FadeIn(fl), duration=0.2)
        self.play(
            FlashCandle(chart.candles[30], flash_color="#FFD54F", cycles=4),
            duration=1.0,
        )
        self.play(FadeOut(fl, remove=True), duration=0.2)

        gl = _label("GlowPulse")

        def _glow35_on(s):
            chart.candles[35].glow_enabled = True
            chart.candles[35].glow_intensity = 0.5

        self.play(_SetProp(_glow35_on), duration=0.05)
        self.play(FadeIn(gl), duration=0.2)
        self.play(GlowPulse(chart.candles[35], cycles=3), duration=1.5)
        self.play(
            _SetProp(lambda s: setattr(chart.candles[35], "glow_enabled", False)),
            duration=0.05,
        )
        self.play(FadeOut(gl, remove=True), duration=0.2)

        sk = _label("Shake")
        self.play(FadeIn(sk), duration=0.2)
        self.play(Shake(chart.candles[40], amplitude=300, frequency=12), duration=0.6)
        self.play(FadeOut(sk, remove=True), duration=0.2)

        pu = _label("Pulse")
        self.play(FadeIn(pu), duration=0.2)
        self.play(Pulse(chart.candles[50], cycles=3), duration=1.0)
        self.play(FadeOut(pu, remove=True), duration=0.2)

        shift_line = HLineElement(
            y=mid_price, color="#2196F3", linewidth=2, label="ColorShift"
        )
        cs = _label("ColorShift")
        self.play(FadeIn(shift_line, cs), duration=0.3)
        self.play(
            ColorShift(
                shift_line, attr="color", start_color="#2196F3", end_color="#f23645"
            ),
            duration=1.5,
        )
        self.play(FadeOut(shift_line, cs, remove=True), duration=0.3)

        sma_morph = SMA(chart, period=20, color="#2196F3")
        ema_target = EMA(chart, period=10, color="#FF9800")
        mo = _label("MorphLine")
        self.play(DrawLine(sma_morph), duration=1.0)
        self.play(FadeIn(mo), duration=0.2)
        self.play(MorphLine(sma_morph, target_y=ema_target.points_y), duration=1.0)
        self.wait(0.3)
        self.play(FadeOut(sma_morph, mo, remove=True), duration=0.3)

        # Temp charts for CandleGrow / Wipe / Sweep
        self.play(FadeOut(*chart.candles), duration=0.3)

        grow_chart = Chart.from_csv(data, start=0, end=15)
        self.play(_fit_camera(grow_chart.candles), duration=0.4)
        cg = _label("CandleGrow")
        self.play(FadeIn(cg), duration=0.2)
        self.play(CandleGrow(*grow_chart.candles, sequential=True), duration=1.5)
        self.wait(0.3)
        self.play(FadeOut(*grow_chart.candles, cg, remove=True), duration=0.3)

        wipe_chart = Chart.from_csv(data, start=20, end=45)
        self.play(_fit_camera(wipe_chart.candles), duration=0.4)
        wi = _label("Wipe")
        self.play(FadeIn(wi), duration=0.2)
        self.play(
            Wipe(*wipe_chart.candles, direction="left", easing=ease_in_out_cubic),
            duration=1.5,
        )
        self.wait(0.3)
        self.play(FadeOut(*wipe_chart.candles, wi, remove=True), duration=0.3)

        sweep_chart = Chart.from_csv(data, start=30, end=55)
        self.play(_fit_camera(sweep_chart.candles), duration=0.4)
        sw = _label("Sweep")
        self.play(FadeIn(sw), duration=0.2)
        self.play(Sweep(*sweep_chart.candles, easing=ease_in_out_cubic), duration=1.5)
        self.wait(0.3)
        self.play(FadeOut(*sweep_chart.candles, sw, remove=True), duration=0.3)

        self.play(FadeIn(*chart.candles), duration=0.5)
        self.play(_full_view(), duration=0.5)
        self.play(FadeOut(anim_hdr, remove=True), duration=0.3)

        # Visual effects

        fx_hdr = _section_header("Visual Effects")
        self.play(FadeIn(fx_hdr), duration=0.3)

        sh = _label("Candle Shadows")
        self.play(FadeIn(sh), duration=0.2)
        self.play(
            _SetProp(lambda s: setattr(s.config, "candle_shadow", True)), duration=0.05
        )
        self.wait(1.5)
        self.play(
            _SetProp(lambda s: setattr(s.config, "candle_shadow", False)), duration=0.05
        )
        self.play(FadeOut(sh, remove=True), duration=0.2)

        gf = _label("Candle Glow")
        self.play(FadeIn(gf), duration=0.2)

        def _all_glow_on(s):
            for c in chart.candles:
                c.glow_enabled = True
                c.glow_intensity = 0.3

        self.play(_SetProp(_all_glow_on), duration=0.05)
        self.wait(1.5)
        self.play(
            _SetProp(
                lambda s: [setattr(c, "glow_enabled", False) for c in chart.candles]
            ),
            duration=0.05,
        )
        self.play(FadeOut(gf, remove=True), duration=0.2)

        bg = _label("Background Gradient")
        self.play(FadeIn(bg), duration=0.2)
        self.play(
            _SetProp(
                lambda s: setattr(
                    s.config, "background_gradient", ("#1a1a2e", "#16213e")
                )
            ),
            duration=0.05,
        )
        self.wait(1.5)
        self.play(
            _SetProp(
                lambda s: setattr(
                    s.config, "background_gradient", ("#161b1e", "#161b1e")
                )
            ),
            duration=0.05,
        )
        self.play(FadeOut(bg, remove=True), duration=0.2)

        wm = _label("Watermark")
        self.play(FadeIn(wm), duration=0.2)

        def _wm_on(s):
            s.config.watermark = "TRADEANIM"
            s.config.watermark_alpha = 0.15

        self.play(_SetProp(_wm_on), duration=0.05)
        self.wait(1.5)
        self.play(
            _SetProp(lambda s: setattr(s.config, "watermark", None)), duration=0.05
        )
        self.play(FadeOut(wm, remove=True), duration=0.2)

        # Post-processing effects

        bl = _label("Bloom / Glow")
        self.play(FadeIn(bl), duration=0.2)
        self.play(AnimatePostProcess(pp, bloom_intensity=(0.0, 0.4)), duration=1.5)
        self.play(AnimatePostProcess(pp, bloom_intensity=(0.4, 0.0)), duration=1.0)
        self.play(FadeOut(bl, remove=True), duration=0.2)

        vi = _label("Vignette")
        self.play(FadeIn(vi), duration=0.2)
        self.play(AnimatePostProcess(pp, vignette_strength=(0.0, 0.6)), duration=1.5)
        self.play(AnimatePostProcess(pp, vignette_strength=(0.6, 0.0)), duration=1.0)
        self.play(FadeOut(vi, remove=True), duration=0.2)

        ca = _label("Chromatic Aberration")
        self.play(FadeIn(ca), duration=0.2)
        self.play(
            AnimatePostProcess(pp, chromatic_aberration_offset=(0.0, 10.0)),
            duration=1.5,
        )
        self.play(
            AnimatePostProcess(pp, chromatic_aberration_offset=(10.0, 0.0)),
            duration=1.0,
        )
        self.play(FadeOut(ca, remove=True), duration=0.2)

        ld = _label("Lens Distortion")
        self.play(FadeIn(ld), duration=0.2)
        self.play(AnimatePostProcess(pp, lens_distortion_k=(0.0, -0.35)), duration=1.2)
        self.play(AnimatePostProcess(pp, lens_distortion_k=(-0.35, 0.25)), duration=1.2)
        self.play(AnimatePostProcess(pp, lens_distortion_k=(0.25, 0.0)), duration=0.8)
        self.play(FadeOut(ld, remove=True), duration=0.2)

        co = _label("Combined Effects")
        self.play(FadeIn(co), duration=0.2)
        self.play(
            AnimatePostProcess(
                pp,
                bloom_intensity=(0.0, 0.2),
                vignette_strength=(0.0, 0.4),
                chromatic_aberration_offset=(0.0, 5.0),
            ),
            duration=2.0,
        )
        self.wait(0.5)
        self.play(
            AnimatePostProcess(
                pp,
                bloom_intensity=(0.2, 0.0),
                vignette_strength=(0.4, 0.0),
                chromatic_aberration_offset=(5.0, 0.0),
            ),
            duration=1.5,
        )
        self.play(FadeOut(co, fx_hdr, remove=True), duration=0.3)

        # Camera controls

        cam_hdr = _section_header("Camera Controls")
        self.play(FadeIn(cam_hdr), duration=0.3)

        zl = _label("ZoomTo")
        self.play(FadeIn(zl), duration=0.2)
        self.play(
            ZoomTo(chart, 20, 40, padding=0.05, easing=ease_in_out_cubic), duration=1.5
        )
        self.wait(0.5)
        self.play(FadeOut(zl, remove=True), duration=0.2)

        pc = _label("PanCamera")
        self.play(FadeIn(pc), duration=0.2)
        self.play(
            PanCamera(view_start=50, view_end=n + 3, easing=ease_in_out_sine),
            duration=1.5,
        )
        self.wait(0.3)
        self.play(_full_view(), duration=1.2)
        self.play(FadeOut(pc, cam_hdr, remove=True), duration=0.3)

        # Outro

        self.play(FadeOut(*chart.candles), duration=0.8)

        outro = ShadowedTitle(
            "tradeanim",
            font_size=48,
            x=0.5,
            y=0.55,
            shadow_color="#000000",
            shadow_offset_x=3,
            shadow_offset_y=-3,
        )
        outro.ha = "center"
        outro_sub = OutlinedText(
            "Animated Trading Charts in Python",
            x=0.5,
            y=0.42,
            font_size=16,
            font_weight="normal",
            color="#787b86",
            outline_color="#000000",
            outline_width=2,
        )
        version = ScreenText("v0.2.0", x=0.5, y=0.35, font_size=12, color="#363a45")
        version.ha = "center"

        self.play(ScaleIn(outro, easing=ease_out_elastic), duration=1.0)
        self.play(FadeIn(outro_sub), duration=0.5)
        self.play_with_previous(FadeIn(version), duration=0.4, offset=0.2)
        self.wait(2.0)
        self.play(FadeOut(outro, outro_sub, version, easing=ease_in_quad), duration=0.8)
        self.wait(0.3)


if __name__ == "__main__":
    ShowcaseV3(
        fps=30,
        width=1920,
        height=1080,
        theme=MIDNIGHT_THEME,
        candle_shadow=False,
        wick_linewidth=1.5,
        grid_style="dashed",
        grid_axis="horizontal",
        minor_grid=True,
        minor_grid_alpha=0.1,
        post_processing=PostProcessConfig(
            bloom_enabled=True,
            bloom_intensity=0.0,
            bloom_radius=15,
            vignette_enabled=True,
            vignette_strength=0.0,
            chromatic_aberration_enabled=True,
            chromatic_aberration_offset=0.0,
            lens_distortion_enabled=True,
            lens_distortion_k=0.0,
        ),
    ).render("showcase_v3.mp4")
