# Renderer engine

from __future__ import annotations

import subprocess
import sys
from typing import TYPE_CHECKING

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.collections as mcollections
import matplotlib.patches as mpatches
import matplotlib.path as mpath
import matplotlib.patheffects as pe
import numpy as np

from .config import RenderConfig
from .elements import (
    AreaElement,
    ArrowElement,
    CandleElement,
    FillBetweenElement,
    HLineElement,
    LineElement,
    OHLCBarElement,
    TextElement,
    ZoneElement,
)

if TYPE_CHECKING:
    from .scene import Scene


def _hex_to_rgba(hex_color: str) -> tuple:
    h = hex_color.lstrip("#")
    if len(h) == 6:
        return tuple(int(h[i:i+2], 16) / 255 for i in (0, 2, 4)) + (1.0,)
    elif len(h) == 8:
        return tuple(int(h[i:i+2], 16) / 255 for i in (0, 2, 4, 6))
    return (1.0, 1.0, 1.0, 1.0)


class Renderer:
    # Renders scene frames to video using matplotlib + ffmpeg.

    def __init__(self, config: RenderConfig):
        self.config = config
        self._fig = None
        self._ax = None
        self._ax_vol = None
        self._ss = max(1, config.supersample)
        self._render_w = config.width * self._ss
        self._render_h = config.height * self._ss
        self._render_dpi = config.dpi * self._ss
        self._cached_glow_kernel = None

    def _glow_kernel(self, size: int = 64, sigma: float = 1.0) -> np.ndarray:
        # Cached 2D glow kernel.
        if self._cached_glow_kernel is None:
            lin = np.linspace(-3.5, 3.5, size)
            X, Y = np.meshgrid(lin, lin)
            kernel = np.exp(-(X**2 + Y**2) / (2 * sigma**2))
            r = np.sqrt(X**2 + Y**2) / 3.5
            fade = np.clip(1.0 - r, 0, 1) ** 0.5
            self._cached_glow_kernel = kernel * fade
        return self._cached_glow_kernel

    def setup(self):
        c = self.config
        fig_w = self._render_w / self._render_dpi
        fig_h = self._render_h / self._render_dpi
        self._fig = plt.figure(figsize=(fig_w, fig_h), dpi=self._render_dpi)
        self._fig.set_facecolor(c.theme.background)

        if c.show_volume:
            gs = self._fig.add_gridspec(
                2, 1, height_ratios=[1 - c.volume_height_ratio, c.volume_height_ratio],
                hspace=0.02,
            )
            self._ax = self._fig.add_subplot(gs[0])
            self._ax_vol = self._fig.add_subplot(gs[1], sharex=self._ax)
            self._setup_ax(self._ax_vol, show_x=True)
            self._ax_vol.set_ylabel("Vol", color=c.theme.axis_color, fontsize=8)
            self._setup_ax(self._ax, show_x=False)
        else:
            self._ax = self._fig.add_axes([0.06, 0.08, 0.88, 0.88])
            self._setup_ax(self._ax, show_x=True)

    def _setup_ax(self, ax, show_x=True):
        c = self.config
        ax.set_facecolor(c.theme.panel_bg)
        ax.tick_params(colors=c.theme.axis_color, labelsize=9)
        ax.spines["top"].set_visible(False)
        ax.spines["right"].set_color(c.theme.axis_color)
        ax.spines["bottom"].set_color(c.theme.axis_color)
        ax.spines["left"].set_color(c.theme.axis_color)
        if c.show_grid:
            style_map = {"solid": "-", "dashed": "--", "dotted": ":", "dashdot": "-."}
            ls = style_map.get(c.grid_style, "-")
            axis_map = {"horizontal": "y", "vertical": "x", "both": "both", "x": "x", "y": "y"}
            grid_axis = axis_map.get(c.grid_axis, "both")
            ax.grid(
                True, which="major", axis=grid_axis,
                color=c.theme.grid_color,
                alpha=c.grid_alpha, linewidth=c.grid_linewidth,
                linestyle=ls,
            )
            if c.minor_grid:
                ax.minorticks_on()
                ax.grid(
                    True, which="minor", axis=grid_axis,
                    color=c.theme.grid_color,
                    alpha=c.minor_grid_alpha, linewidth=c.minor_grid_linewidth,
                    linestyle=ls,
                )
        ax.set_axisbelow(True)
        if not show_x:
            ax.tick_params(labelbottom=False)

    def _post_process(self, frame: np.ndarray) -> np.ndarray:
        pp = self.config.post_processing
        if pp is None:
            return frame
        try:
            from PIL import Image, ImageFilter, ImageEnhance
        except ImportError:
            return frame

        img = Image.fromarray(frame)

        if pp.bloom_enabled:
            blurred = img.filter(ImageFilter.GaussianBlur(radius=pp.bloom_radius))
            img = Image.blend(img, blurred, pp.bloom_intensity)

        if pp.vignette_enabled:
            w, h = img.size
            Y, X = np.ogrid[:h, :w]
            cx, cy = w / 2, h / 2
            r = np.sqrt((X - cx) ** 2 + (Y - cy) ** 2)
            r_max = np.sqrt(cx ** 2 + cy ** 2)
            vignette = 1.0 - pp.vignette_strength * (r / r_max) ** 2
            vignette = np.clip(vignette, 0, 1)
            arr = np.asarray(img).astype(np.float32)
            arr *= vignette[:, :, np.newaxis]
            img = Image.fromarray(arr.astype(np.uint8))

        if pp.color_grading:
            cg = pp.color_grading
            if "brightness" in cg:
                img = ImageEnhance.Brightness(img).enhance(cg["brightness"])
            if "contrast" in cg:
                img = ImageEnhance.Contrast(img).enhance(cg["contrast"])
            if "saturation" in cg:
                img = ImageEnhance.Color(img).enhance(cg["saturation"])

        if pp.chromatic_aberration_enabled and pp.chromatic_aberration_offset > 0:
            arr = np.asarray(img).copy()
            off = max(1, int(round(pp.chromatic_aberration_offset)))
            h_px, w_px = arr.shape[:2]
            result = np.zeros_like(arr)
            result[:, :w_px - off, 0] = arr[:, off:, 0]       # R shifted left
            result[:, :, 1] = arr[:, :, 1]                      # G stays
            result[:, off:, 2] = arr[:, :w_px - off, 2]        # B shifted right
            img = Image.fromarray(result)

        if pp.lens_distortion_enabled and pp.lens_distortion_k != 0.0:
            arr = np.asarray(img).copy()
            h_px, w_px = arr.shape[:2]
            cx, cy = w_px / 2.0, h_px / 2.0
            r_max = np.sqrt(cx**2 + cy**2)
            ys, xs = np.mgrid[:h_px, :w_px].astype(np.float64)
            dx = (xs - cx) / r_max
            dy = (ys - cy) / r_max
            r2 = dx**2 + dy**2
            factor = 1.0 + pp.lens_distortion_k * r2
            src_x = (cx + dx * factor * r_max).astype(np.int32)
            src_y = (cy + dy * factor * r_max).astype(np.int32)
            np.clip(src_x, 0, w_px - 1, out=src_x)
            np.clip(src_y, 0, h_px - 1, out=src_y)
            arr = arr[src_y, src_x]
            img = Image.fromarray(arr)

        return np.asarray(img)

    def render_scene(self, scene: "Scene", output_path: str):
        self.setup()
        c = self.config
        total_frames = int(scene.total_duration * c.fps)
        if total_frames == 0:
            print("Nothing to render (0 frames).")
            return

        ffmpeg_cmd = [
            "ffmpeg", "-y",
            "-f", "rawvideo", "-vcodec", "rawvideo",
            "-s", f"{c.width}x{c.height}",
            "-pix_fmt", "rgb24",
            "-r", str(c.fps),
            "-i", "-",
            "-c:v", c.codec,
            "-pix_fmt", c.pixel_format,
            "-crf", str(c.crf),
            "-preset", c.preset,
            output_path,
        ]

        try:
            proc = subprocess.Popen(
                ffmpeg_cmd, stdin=subprocess.PIPE,
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            )
        except FileNotFoundError:
            print("ERROR: ffmpeg not found. Install it with: brew install ffmpeg")
            sys.exit(1)

        import time as _time
        bar_w = 40
        print(f"Rendering {total_frames} frames @ {c.fps}fps "
              f"({scene.total_duration:.1f}s) [{c.width}x{c.height}]")
        t_start = _time.monotonic()

        for frame_idx in range(total_frames):
            t = frame_idx / c.fps
            scene.update(t)
            self._draw_frame(scene)
            self._fig.canvas.draw()

            buf = self._fig.canvas.buffer_rgba()
            frame = np.asarray(buf)[:, :, :3].copy()

            if self._ss > 1:
                try:
                    from PIL import Image
                    img = Image.fromarray(frame)
                    img = img.resize((c.width, c.height), Image.LANCZOS)
                    frame = np.asarray(img)
                except ImportError:
                    pass

            frame = self._post_process(frame)
            proc.stdin.write(frame.tobytes())

            if frame_idx % max(1, c.fps // 4) == 0 or frame_idx == total_frames - 1:
                done = frame_idx + 1
                pct = done / total_frames
                filled = int(bar_w * pct)
                bar = "\u2588" * filled + "\u2591" * (bar_w - filled)
                elapsed = _time.monotonic() - t_start
                fps_actual = done / elapsed if elapsed > 0 else 0
                eta = (total_frames - done) / fps_actual if fps_actual > 0 else 0
                eta_m, eta_s = divmod(int(eta), 60)
                print(f"\r  [{bar}] {pct*100:5.1f}%  "
                      f"{done}/{total_frames}  "
                      f"{fps_actual:.1f} fps  "
                      f"ETA {eta_m}:{eta_s:02d}  ", end="", flush=True)

        proc.stdin.close()
        proc.wait()
        elapsed = _time.monotonic() - t_start
        el_m, el_s = divmod(int(elapsed), 60)

        if proc.returncode != 0:
            print(f"\nffmpeg exited with code {proc.returncode}")
        else:
            print(f"\r  [{'█' * bar_w}] 100.0%  "
                  f"{total_frames}/{total_frames}  "
                  f"Done in {el_m}:{el_s:02d}         ")
            print(f"  Video saved to: {output_path}")

        plt.close(self._fig)

    def _draw_candles_batched(self, ax, candles, c):
        if not candles:
            return
        half_w = c.candle_width / 2

        shadow_patches = []
        shadow_alphas = []
        glow_candles = []
        wick_segments = []
        wick_colors = []
        body_patches = []
        body_facecolors = []
        body_edgecolors = []
        body_alphas = []

        for candle in candles:
            if candle.opacity <= 0:
                continue
            is_bull = candle.is_bull
            if is_bull:
                body_color = candle.bull_color or c.candle_bull_color_override or c.theme.bull_body
                wick_color = candle.bull_color or c.candle_bull_color_override or c.theme.bull_wick
            else:
                body_color = candle.bear_color or c.candle_bear_color_override or c.theme.bear_body
                wick_color = candle.bear_color or c.candle_bear_color_override or c.theme.bear_wick

            x = candle.index
            o = candle.open + candle.offset_y
            h = candle.high + candle.offset_y
            l = candle.low + candle.offset_y
            cl = candle.close + candle.offset_y

            mid = (o + cl) / 2
            scale = candle.scale_y
            o = mid + (o - mid) * scale
            h = mid + (h - mid) * scale
            l = mid + (l - mid) * scale
            cl = mid + (cl - mid) * scale

            body_bottom = min(o, cl)
            body_h = max(abs(cl - o), (h - l) * 0.01)
            body_top = body_bottom + body_h

            if c.candle_shadow:
                ox, oy = c.candle_shadow_offset
                sp = mpatches.FancyBboxPatch(
                    (x - half_w + ox, body_bottom + oy), c.candle_width, body_h,
                    boxstyle="round,pad=0.04",
                )
                shadow_patches.append(sp)
                shadow_alphas.append(candle.opacity * 0.35)

            if candle.glow_enabled:
                glow_candles.append((candle, x, body_bottom, body_h, h, l, body_color))

            wc_rgba = _hex_to_rgba(wick_color)
            if h > body_top:
                wick_segments.append([(x, body_top), (x, h)])
                wick_colors.append(wc_rgba[:3] + (candle.opacity,))
            if l < body_bottom:
                wick_segments.append([(x, l), (x, body_bottom)])
                wick_colors.append(wc_rgba[:3] + (candle.opacity,))

            bp = mpatches.FancyBboxPatch(
                (x - half_w, body_bottom), c.candle_width, body_h,
                boxstyle="round,pad=0.04",
            )
            body_patches.append(bp)
            fc = _hex_to_rgba(body_color)
            ec = _hex_to_rgba(wick_color)
            body_facecolors.append(fc[:3] + (candle.opacity,))
            body_edgecolors.append(ec[:3] + (candle.opacity,))
            body_alphas.append(candle.opacity)

        if shadow_patches:
            sc_rgba = _hex_to_rgba(c.candle_shadow_color)
            pc = mcollections.PatchCollection(
                shadow_patches, match_original=False,
                facecolors=[sc_rgba[:3] + (a,) for a in shadow_alphas],
                edgecolors="none", zorder=4,
            )
            ax.add_collection(pc)

        for candle, x, body_bottom, body_h, h, l, body_color in glow_candles:
            gk = self._glow_kernel()
            rgba_base = _hex_to_rgba(body_color)
            glow_img = np.empty((gk.shape[0], gk.shape[1], 4))
            glow_img[:, :, :3] = rgba_base[:3]
            glow_img[:, :, 3] = gk * candle.glow_intensity * candle.opacity
            glow_w = c.candle_width * candle.glow_radius
            glow_h = max(body_h, (h - l) * 0.3) * candle.glow_radius * 0.4
            mid_y = body_bottom + body_h / 2
            ax.imshow(
                glow_img, aspect="auto", zorder=4,
                extent=[x - glow_w, x + glow_w, mid_y - glow_h, mid_y + glow_h],
                interpolation="bilinear",
            )

        if wick_segments:
            lc = mcollections.LineCollection(
                wick_segments, colors=wick_colors,
                linewidths=c.wick_linewidth, zorder=5,
                capstyle="round",
            )
            ax.add_collection(lc)

        if body_patches:
            pc = mcollections.PatchCollection(
                body_patches, match_original=False,
                facecolors=body_facecolors,
                edgecolors=body_edgecolors,
                linewidths=0.5, zorder=6,
            )
            ax.add_collection(pc)

    def _draw_ohlc_bars_batched(self, ax, bars, c):
        if not bars:
            return
        segments = []
        colors = []
        for bar in bars:
            if bar.opacity <= 0:
                continue
            is_bull = bar.is_bull
            if is_bull:
                color = bar.bull_color or c.candle_bull_color_override or c.theme.bull_body
            else:
                color = bar.bear_color or c.candle_bear_color_override or c.theme.bear_body

            x = bar.index
            o = bar.open + bar.offset_y
            h = bar.high + bar.offset_y
            l = bar.low + bar.offset_y
            cl = bar.close + bar.offset_y

            mid = (o + cl) / 2
            scale = bar.scale_y
            o = mid + (o - mid) * scale
            h = mid + (h - mid) * scale
            l = mid + (l - mid) * scale
            cl = mid + (cl - mid) * scale

            tw = bar.tick_width
            rgba = _hex_to_rgba(color)
            bar_color = rgba[:3] + (bar.opacity,)
            segments.append([(x, l), (x, h)])
            colors.append(bar_color)
            segments.append([(x - tw, o), (x, o)])
            colors.append(bar_color)
            segments.append([(x, cl), (x + tw, cl)])
            colors.append(bar_color)

        if segments:
            lc = mcollections.LineCollection(
                segments, colors=colors,
                linewidths=c.wick_linewidth, zorder=5,
                capstyle="round",
            )
            ax.add_collection(lc)

    def _draw_frame(self, scene: "Scene"):
        ax = self._ax
        ax.cla()
        self._setup_ax(ax, show_x=not self.config.show_volume)

        if self._ax_vol:
            self._ax_vol.cla()
            self._setup_ax(self._ax_vol, show_x=True)

        c = self.config
        cam = scene.camera

        if c.background_gradient:
            top_c = _hex_to_rgba(c.background_gradient[0])
            bot_c = _hex_to_rgba(c.background_gradient[1])
            grad = np.linspace(top_c[:3], bot_c[:3], 256).reshape(256, 1, 3)
            ax.imshow(
                grad, aspect="auto", zorder=-10,
                extent=[cam.view_start - 0.5, cam.view_end + 0.5, cam.price_min, cam.price_max],
            )

        zones = [e for e in scene.visible_elements if isinstance(e, ZoneElement)]
        fills = [e for e in scene.visible_elements if isinstance(e, FillBetweenElement)]
        candles = [e for e in scene.visible_elements if isinstance(e, CandleElement)]
        lines = [e for e in scene.visible_elements if isinstance(e, LineElement)]
        hlines = [e for e in scene.visible_elements if isinstance(e, HLineElement)]
        texts = [e for e in scene.visible_elements if isinstance(e, TextElement)]
        arrows = [e for e in scene.visible_elements if isinstance(e, ArrowElement)]
        areas = [e for e in scene.visible_elements if isinstance(e, AreaElement)]
        ohlc_bars = [e for e in scene.visible_elements if isinstance(e, OHLCBarElement)]

        # Zones
        for zone in zones:
            x2 = cam.view_end if zone.extend_right else zone.x2
            fc_rgba = _hex_to_rgba(zone.fill_color)
            face_alpha = fc_rgba[3] * zone.opacity
            ec = zone.border_color
            if ec and ec != "none":
                ec_rgba = _hex_to_rgba(ec)
                edge_color = ec_rgba[:3] + (ec_rgba[3] * zone.opacity,)
            else:
                edge_color = "none"
            rect = mpatches.FancyBboxPatch(
                (zone.x1, zone.y1), x2 - zone.x1, zone.height,
                boxstyle="square,pad=0",
                facecolor=fc_rgba[:3] + (face_alpha,),
                edgecolor=edge_color,
                linewidth=zone.border_width,
                linestyle=zone.border_style,
                zorder=1,
            )
            if zone.hatch:
                rect.set_hatch(zone.hatch)
            ax.add_patch(rect)
            if zone.label:
                lx = zone.x1 + 0.3
                ly = zone.y1 + zone.height * 0.5
                ax.text(
                    lx, ly, zone.label,
                    color=zone.label_color, fontsize=zone.label_size,
                    alpha=zone.opacity, va="center", fontfamily=c.font_family,
                    zorder=2,
                )

        # Fill
        for fb in fills:
            if fb.opacity <= 0:
                continue
            n = fb.visible_count()
            xs = fb.points_x[:n]
            uy = fb.upper_y[:n]
            ly = fb.lower_y[:n]
            if len(xs) >= 2:
                ax.fill_between(
                    xs, ly, uy,
                    color=fb.fill_color, alpha=fb.opacity,
                    edgecolor=fb.edge_color or "none",
                    linewidth=fb.edge_width,
                    zorder=1,
                )

        # Horizontal lines
        for hl in hlines:
            xs = hl.x_start if hl.x_start is not None else cam.view_start
            xe = hl.x_end if hl.x_end is not None else cam.view_end
            ax.plot(
                [xs, xe], [hl.y, hl.y],
                color=hl.color, linewidth=hl.linewidth,
                linestyle=hl.linestyle, alpha=hl.opacity, zorder=3,
            )
            if hl.label:
                lc = hl.label_color or hl.color
                ax.text(
                    xe + 0.3, hl.y, hl.label,
                    color=lc, fontsize=hl.label_size, alpha=hl.opacity,
                    va="center", fontfamily=c.font_family, zorder=4,
                )

        # Candles
        self._draw_candles_batched(ax, candles, c)

        # Volume bars
        if self._ax_vol and candles:
            for candle in candles:
                if candle.opacity <= 0 or candle.volume <= 0:
                    continue
                vc = c.theme.volume_bull if candle.is_bull else c.theme.volume_bear
                self._ax_vol.bar(
                    candle.index, candle.volume,
                    width=c.candle_width, color=vc,
                    alpha=candle.opacity, zorder=5,
                )

        # Lines
        for line in lines:
            if line.opacity <= 0:
                continue
            px, py = line.visible_points()
            if len(px) < 2:
                continue
            ax.plot(
                px, py,
                color=line.color, linewidth=line.linewidth,
                linestyle=line.linestyle, alpha=line.opacity, zorder=7,
            )
            if line.label and line.draw_progress >= 1.0:
                ax.text(
                    px[-1] + 0.5, py[-1], line.label,
                    color=line.color, fontsize=9, alpha=line.opacity,
                    va="center", fontfamily=c.font_family, zorder=8,
                )

        # Areas
        for area in areas:
            if area.opacity <= 0:
                continue
            px, py = area.visible_points()
            if len(px) < 2:
                continue
            baseline = area.baseline if area.baseline is not None else cam.price_min
            verts = list(zip(px, py)) + [(px[-1], baseline), (px[0], baseline)]
            poly_path = mpath.Path(verts + [verts[0]], closed=True)
            poly_patch = mpatches.PathPatch(poly_path, facecolor="none", edgecolor="none")
            ax.add_patch(poly_patch)
            grad_h = 256
            rgba_base = _hex_to_rgba(area.fill_color)
            grad = np.zeros((grad_h, 1, 4))
            for gi in range(grad_h):
                frac = gi / (grad_h - 1)
                alpha = area.fill_alpha_bottom + (area.fill_alpha_top - area.fill_alpha_bottom) * frac
                grad[gi, 0, :3] = rgba_base[:3]
                grad[gi, 0, 3] = alpha * area.opacity
            x_min, x_max = min(px), max(px)
            y_min = baseline
            y_max = max(py)
            if y_max <= y_min:
                y_max = y_min + 1
            ax.imshow(
                grad, aspect="auto", zorder=6,
                extent=[x_min, x_max, y_min, y_max],
                origin="lower", interpolation="bilinear",
            )
            ax.images[-1].set_clip_path(poly_patch)
            ax.plot(
                px, py, color=area.color, linewidth=area.linewidth,
                alpha=area.opacity, zorder=7,
            )
            if area.label and area.draw_progress >= 1.0:
                ax.text(
                    px[-1] + 0.5, py[-1], area.label,
                    color=area.color, fontsize=9, alpha=area.opacity,
                    va="center", fontfamily=c.font_family, zorder=8,
                )

        # OHLC bars
        self._draw_ohlc_bars_batched(ax, ohlc_bars, c)

        # Arrows
        for arrow in arrows:
            if arrow.opacity <= 0:
                continue
            ax.annotate(
                "", xy=(arrow.x2, arrow.y2), xytext=(arrow.x1, arrow.y1),
                arrowprops=dict(
                    arrowstyle="->", color=arrow.color,
                    lw=arrow.linewidth,
                ),
                alpha=arrow.opacity, zorder=9,
            )
            if arrow.label:
                mx = (arrow.x1 + arrow.x2) / 2
                my = (arrow.y1 + arrow.y2) / 2
                lc = arrow.label_color or arrow.color
                ax.text(
                    mx, my, arrow.label,
                    color=lc, fontsize=arrow.label_size,
                    alpha=arrow.opacity, ha="center", va="bottom",
                    fontfamily=c.font_family, zorder=10,
                )

        # Text
        for txt in texts:
            if txt.opacity <= 0:
                continue
            display_text = txt.visible_text
            if not display_text:
                continue

            effective_size = txt.font_size * txt.scale
            if effective_size < 0.5:
                continue

            kwargs = dict(
                color=txt.color, fontsize=effective_size,
                fontweight=txt.font_weight,
                ha=txt.ha, va=txt.va, rotation=txt.rotation,
                alpha=txt.opacity, zorder=11,
            )

            if txt.font_path:
                from matplotlib.font_manager import FontProperties
                fp = FontProperties(fname=txt.font_path, style=txt.font_style)
                kwargs["fontproperties"] = fp
            else:
                kwargs["fontfamily"] = txt.font_family or c.font_family
                if txt.font_style == "italic":
                    kwargs["fontstyle"] = "italic"

            if txt.bbox:
                kwargs["bbox"] = txt.bbox

            effects = []
            if txt.text_outline:
                effects.append(pe.withStroke(
                    linewidth=txt.text_outline.get("width", 3),
                    foreground=txt.text_outline.get("color", "#000000"),
                ))
            if effects:
                kwargs["path_effects"] = effects

            coord_args = (txt.x, txt.y, display_text)
            extra = {}
            if not txt.use_data_coords:
                extra["transform"] = ax.transAxes

            if txt.text_shadow:
                s = txt.text_shadow
                sx = txt.x + s.get("offset_x", 0.002 if not txt.use_data_coords else 0.5)
                sy = txt.y + s.get("offset_y", -0.002 if not txt.use_data_coords else -0.5)
                shadow_kw = dict(kwargs)
                shadow_kw["color"] = s.get("color", "#000000")
                shadow_kw["alpha"] = txt.opacity * s.get("alpha", 0.5)
                shadow_kw["zorder"] = 10
                shadow_kw.pop("path_effects", None)
                ax.text(sx, sy, display_text, **shadow_kw, **extra)

            ax.text(*coord_args, **kwargs, **extra)

        if c.watermark:
            ax.text(
                0.5, 0.5, c.watermark,
                transform=ax.transAxes, ha="center", va="center",
                fontsize=48, color=c.theme.text_color,
                alpha=c.watermark_alpha, fontfamily=c.font_family, zorder=0,
            )

        ax.set_xlim(cam.view_start - 0.5, cam.view_end + 0.5)
        ax.set_ylim(cam.price_min, cam.price_max)

        if scene.chart and scene.chart.timestamps:
            visible_indices = range(
                max(0, int(cam.view_start)),
                min(len(scene.chart.timestamps), int(cam.view_end) + 1),
            )
            step = max(1, len(list(visible_indices)) // 8)
            tick_indices = list(visible_indices)[::step]
            labels = []
            for i in tick_indices:
                if i < len(scene.chart.timestamps):
                    labels.append(scene.chart.timestamps[i])
                else:
                    labels.append("")
            target_ax = self._ax_vol if self._ax_vol else ax
            target_ax.set_xticks(tick_indices)
            target_ax.set_xticklabels(labels, rotation=30, ha="right", fontsize=8)

        ax.yaxis.set_label_position("right")
        ax.yaxis.tick_right()

        ax.tick_params(
            axis='both', colors=c.theme.axis_color,
            labelcolor=c.theme.axis_color, labelsize=9,
        )
        for spine in ax.spines.values():
            spine.set_color(c.theme.axis_color)
