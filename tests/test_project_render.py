"""Web-editor render path: the Python mirror of the TS engine and the MP4 render.

tests/fixtures/parity.json is produced by scripts/make-parity-fixture.ts from the
TypeScript engine; these tests make sure tradeanim/project.py evaluates the same
animation, candle reveal and camera values.
"""

import json
import shutil
import subprocess
from pathlib import Path

import pytest

from tradeanim.project import candle_reveal, ease, eval_anim, eval_camera, render_plan
from tradeanim.renderer import resolve_ffmpeg

FIXTURE = json.loads((Path(__file__).parent / "fixtures" / "parity.json").read_text(encoding="utf-8"))
PLAN = FIXTURE["plan"]


@pytest.mark.parametrize("sample", FIXTURE["samples"], ids=lambda s: f"t={s['t']}")
def test_animation_parity(sample):
    for obj, expected in zip(PLAN["objects"], sample["anim"]):
        got = eval_anim(obj, sample["t"])
        if not expected["visible"]:
            assert got is None or got["opacity"] <= 0.001, obj["kind"]
            continue
        assert got is not None, obj["kind"]
        for key in ("opacity", "progress", "chars", "scale", "dx", "dy"):
            assert got[key] == pytest.approx(expected[key], abs=1e-6), (obj["kind"], key)


@pytest.mark.parametrize("sample", FIXTURE["samples"], ids=lambda s: f"t={s['t']}")
def test_camera_and_reveal_parity(sample):
    cam = eval_camera(PLAN, sample["t"])
    for key in ("cx", "cy", "span", "priceSpan"):
        assert cam[key] == pytest.approx(sample["camera"][key], rel=1e-6, abs=1e-9)
    for i, expected in enumerate(sample["reveal"]):
        a, g = candle_reveal(PLAN["chart"], i, sample["t"])
        assert a == pytest.approx(expected["a"], abs=1e-6)
        assert g == pytest.approx(expected["g"], abs=1e-6)


def test_bezier_easing():
    assert ease("bezier:0,0,1,1", 0.3) == pytest.approx(0.3, abs=1e-3)
    assert ease("linear", 2) == 1.0


@pytest.mark.skipif(resolve_ffmpeg() is None, reason="ffmpeg not available")
def test_render_plan_to_mp4(tmp_path):
    plan = json.loads(json.dumps(PLAN))
    plan["settings"]["duration"] = 1.0
    out = tmp_path / "plan.mp4"
    frames = []
    render_plan(plan, str(out), width=320, height=180, fps=8, quality="draft", on_progress=lambda d, n: frames.append(d))
    assert out.exists() and out.stat().st_size > 0
    assert frames[-1] == 8
    probe = shutil.which("ffprobe")
    if probe:
        r = subprocess.run([probe, "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", str(out)], capture_output=True, text=True, check=True)
        assert r.stdout.strip() == "320,180"
