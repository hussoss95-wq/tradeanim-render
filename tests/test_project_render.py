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


@pytest.mark.skipif(resolve_ffmpeg() is None, reason="ffmpeg not available")
def test_audio_clips_are_muxed(tmp_path):
    import base64

    ffmpeg = resolve_ffmpeg()
    tone = tmp_path / "tone.mp3"
    subprocess.run([ffmpeg, "-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", str(tone)], check=True)
    plan = json.loads(json.dumps(PLAN))
    plan["settings"]["duration"] = 1.0
    plan["assets"] = [{"id": "a1", "type": "audio", "name": "tone.mp3", "src": "data:audio/mpeg;base64," + base64.b64encode(tone.read_bytes()).decode()}]
    plan["audio"] = [{"assetId": "a1", "start": 0.2, "duration": 0.6, "volume": 0.8, "offset": 0.1}]
    out = tmp_path / "with_audio.mp4"
    render_plan(plan, str(out), width=160, height=90, fps=6, quality="draft")
    info = subprocess.run([ffmpeg, "-hide_banner", "-i", str(out)], capture_output=True, text=True).stderr
    assert "Audio: aac" in info and "Video: h264" in info


@pytest.mark.skipif(resolve_ffmpeg() is None, reason="ffmpeg not available")
def test_voice_focus_ducks_music_and_exports(tmp_path):
    import base64

    ffmpeg = resolve_ffmpeg()
    music = tmp_path / "music.wav"
    voice = tmp_path / "voice.wav"
    subprocess.run([ffmpeg, "-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=110:duration=1", str(music)], check=True)
    subprocess.run([ffmpeg, "-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", str(voice)], check=True)
    plan = json.loads(json.dumps(PLAN))
    plan["settings"]["duration"] = 0.8
    plan["assets"] = [
        {"id": "music", "type": "audio", "name": "music.wav", "src": "data:audio/wav;base64," + base64.b64encode(music.read_bytes()).decode()},
        {"id": "voice", "type": "audio", "name": "voice.wav", "src": "data:audio/wav;base64," + base64.b64encode(voice.read_bytes()).decode()},
    ]
    plan["audio"] = [
        {"assetId": "music", "start": 0, "duration": 0.8, "volume": 0.3, "offset": 0, "role": "music", "ducking": True},
        {"assetId": "voice", "start": 0.1, "duration": 0.6, "volume": 1, "offset": 0, "role": "voice", "ducking": True},
    ]
    out = tmp_path / "voice_focus.mp4"
    render_plan(plan, str(out), width=160, height=90, fps=6, quality="draft")
    info = subprocess.run([ffmpeg, "-hide_banner", "-i", str(out)], capture_output=True, text=True).stderr
    assert out.stat().st_size > 0 and "Audio: aac" in info


@pytest.mark.skipif(resolve_ffmpeg() is None, reason="ffmpeg not available")
def test_image_assets_render(tmp_path):
    import base64
    import io

    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGBA", (40, 20), (255, 0, 0, 255)).save(buf, format="PNG")
    plan = json.loads(json.dumps(PLAN))
    plan["settings"]["duration"] = 0.5
    plan["assets"] = [{"id": "img1", "type": "image", "name": "logo.png", "src": "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()}]
    anim = {"preset": "none", "duration": 0, "delay": 0, "easing": "linear"}
    plan["objects"].append({
        "id": "o_img", "kind": "logo", "name": "Logo", "start": 0, "duration": 0.5,
        "animIn": anim, "animOut": anim, "emphasis": {"preset": "none", "start": 0, "duration": 1, "cycles": 1},
        "opacity": 1, "glow": 0, "blur": 0, "shadow": 0,
        "primitives": [{"k": "image", "assetId": "img1", "x": 0.4, "y": 0.4, "w": 0.2, "h": 0.2}],
    })
    out = tmp_path / "img.mp4"
    render_plan(plan, str(out), width=160, height=90, fps=4, quality="draft")
    frame = tmp_path / "f.png"
    subprocess.run([resolve_ffmpeg(), "-v", "error", "-y", "-i", str(out), "-frames:v", "1", str(frame)], check=True)
    r, g, b = Image.open(frame).convert("RGB").getpixel((80, 45))
    assert r > 180 and g < 90 and b < 90  # the red logo sits in the frame centre
