"use client";

import { useEffect, useRef } from "react";
import { Diamond, Flag, Magnet, Maximize2, Pause, Play, Repeat, SkipBack, SkipForward, StepBack, StepForward } from "lucide-react";
import { editor, useEditor } from "@/state/store";
import { playback, usePlayback } from "@/state/playback";
import { addCameraKeyframe } from "@/lib/actions";
import { addMarker, fmtTime } from "./Timeline";

export function TransportBar() {
  const playing = usePlayback((s) => s.playing);
  const loop = usePlayback((s) => s.loop);
  const speed = usePlayback((s) => s.speed);
  const pps = usePlayback((s) => s.pxPerSec);
  const duration = useEditor((s) => s.project.settings.duration);
  const fps = useEditor((s) => s.project.settings.fps);
  const snap = useEditor((s) => s.snap);
  const tcRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const apply = (t: number) => tcRef.current && (tcRef.current.textContent = fmtTime(t, fps));
    apply(playback().time);
    return usePlayback.subscribe((s) => apply(s.time));
  }, [fps]);

  const stepFrame = (n: number) => {
    playback().pause();
    playback().setTime(Math.min(duration, Math.max(0, Math.round(playback().time * fps + n) / fps)));
  };

  return (
    <div className="transport">
      <div className="tr-left">
        <button className="tb-icon" title="Snap (clips, keyframes, anchors)" onClick={() => editor().setSnap(!snap)} data-on={snap}>
          <Magnet size={14} />
        </button>
        <button className="tb-icon" title="Add camera keyframe at playhead (K)" onClick={addCameraKeyframe}>
          <Diamond size={14} />
        </button>
        <button className="tb-icon" title="Add marker at playhead (M)" onClick={addMarker}>
          <Flag size={14} />
        </button>
      </div>
      <div className="tr-center">
        <button className="tb-icon" title="Go to start (Home)" onClick={() => playback().setTime(0)}>
          <SkipBack size={14} />
        </button>
        <button className="tb-icon" title="Previous frame (←)" onClick={() => stepFrame(-1)}>
          <StepBack size={14} />
        </button>
        <button className="play-btn" title="Play / pause (Space)" onClick={() => {
          if (!playing && playback().time >= duration - 0.01) playback().setTime(0);
          playback().toggle();
        }}>
          {playing ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <button className="tb-icon" title="Next frame (→)" onClick={() => stepFrame(1)}>
          <StepForward size={14} />
        </button>
        <button className="tb-icon" title="Go to end (End)" onClick={() => playback().setTime(duration)}>
          <SkipForward size={14} />
        </button>
        <span className="timecode mono">
          <span ref={tcRef}>0:00.00</span>
          <span className="muted"> / {fmtTime(duration, fps)}</span>
        </span>
        <button className="tb-icon" title="Loop" data-on={loop} onClick={() => playback().setLoop(!loop)}>
          <Repeat size={14} />
        </button>
        <select className="sel tb-sel mini" value={speed} onChange={(e) => playback().setSpeed(Number(e.target.value))} title="Playback speed">
          {[0.25, 0.5, 1, 1.5, 2].map((s) => (
            <option key={s} value={s}>
              {s}×
            </option>
          ))}
        </select>
      </div>
      <div className="tr-right">
        <span className="tb-label">Zoom</span>
        <input className="zoom-range" type="range" min={8} max={400} value={pps} onChange={(e) => playback().setPxPerSec(Number(e.target.value))} title="Timeline zoom (Ctrl+wheel)" />
        <button
          className="tb-icon"
          title="Fit timeline"
          onClick={() => {
            const el = document.querySelector(".tl-scroll") as HTMLElement | null;
            const w = (el?.clientWidth ?? 900) - 214 - 30;
            playback().setPxPerSec(w / Math.max(1, duration));
          }}
        >
          <Maximize2 size={13} />
        </button>
      </div>
    </div>
  );
}
