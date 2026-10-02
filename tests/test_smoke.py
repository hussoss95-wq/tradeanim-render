"""Baseline smoke tests for the vendored tradeanim library.

These guard the stable baseline: the package imports, the sample data loads,
indicators / ICT detectors run, a tiny scene encodes to MP4, and the
showcase example is importable without triggering its full-HD render.
"""

import importlib.util
import shutil
import subprocess
from pathlib import Path

import pytest

import tradeanim
from tradeanim import (
    EMA,
    SMA,
    CandlesAppear,
    Chart,
    Scene,
    auto_markup,
    detect_fvg,
    detect_order_blocks,
)

ROOT = Path(__file__).resolve().parents[1]
SAMPLE_CSV = ROOT / "examples" / "data" / "sample_ohlc.csv"
SHOWCASE = ROOT / "examples" / "showcase.py"


def test_public_api_exports_resolve():
    for name in tradeanim.__all__:
        assert hasattr(tradeanim, name), name


def test_sample_chart_loads():
    chart = Chart.from_csv(str(SAMPLE_CSV))
    assert len(chart) > 0
    assert chart.highs.shape == chart.lows.shape == chart.closes.shape
    assert (chart.highs >= chart.lows).all()


def test_indicators_and_ict_run():
    chart = Chart.from_csv(str(SAMPLE_CSV))
    assert SMA(chart, period=20).num_points > 0
    assert EMA(chart, period=10).num_points > 0
    detect_fvg(chart)
    detect_order_blocks(chart, lookback=5)
    markup = auto_markup(chart)
    assert isinstance(markup, dict)


def test_showcase_is_importable():
    spec = importlib.util.spec_from_file_location("showcase", SHOWCASE)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    assert issubclass(module.ShowcaseV3, Scene)


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg not installed")
def test_tiny_scene_renders_mp4(tmp_path):
    class Tiny(Scene):
        def construct(self):
            chart = self.load_chart(str(SAMPLE_CSV), start=0, end=20)
            self.play(CandlesAppear(chart, style="sequential"), duration=0.5)
            self.wait(0.2)

    out = tmp_path / "tiny.mp4"
    Tiny(fps=10, width=320, height=180).render(str(out))
    assert out.exists() and out.stat().st_size > 0

    if shutil.which("ffprobe"):
        probe = subprocess.run(
            ["ffprobe", "-v", "error", "-select_streams", "v:0",
             "-show_entries", "stream=width,height", "-of", "csv=p=0", str(out)],
            capture_output=True, text=True, check=True,
        )
        assert probe.stdout.strip() == "320,180"
