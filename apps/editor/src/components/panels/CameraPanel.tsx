"use client";

import { CAMERA_PRESETS, cameraPreset, fitCandles, selectionBBox, bboxState, type EditorCommand } from "@tradeanim/editor-core";
import { Crosshair, Diamond, Maximize2, ScanSearch, Trash2 } from "lucide-react";
import { editor, useEditor } from "@/state/store";
import { playback } from "@/state/playback";
import { addCameraKeyframe, cameraCommand } from "@/lib/actions";
import { Seg } from "../ui";

export function CameraPanel() {
  const camera = useEditor((s) => s.project.camera);
  const viewMode = useEditor((s) => s.viewMode);
  const kSel = useEditor((s) => s.keyframeSelection);
  const selection = useEditor((s) => s.selection);
  const dispatch = useEditor((s) => s.dispatch);

  const applyPreset = (id: (typeof CAMERA_PRESETS)[number]["id"]) => {
    const s = editor();
    const kfs = cameraPreset(s.project, id, playback().time, s.selection);
    if (!kfs.length) {
      s.toast(id === "zoomToEntry" ? "Add a Long/Short position first" : "Nothing to frame", "error");
      return;
    }
    s.dispatch({ type: "batch", label: `Camera: ${id}`, commands: kfs.map((keyframe) => ({ type: "camera/upsertKeyframe", keyframe }) as EditorCommand) });
    s.toast(`Camera preset added (${kfs.length} keyframes)`, "success");
  };

  return (
    <>
      <div className="pal-head">
        <h3>Camera</h3>
        <p>In Camera view, panning/zooming the stage edits the camera — it auto-keys at the playhead once keyframes exist.</p>
      </div>
      <div className="pad-x">
        <Seg
          value={viewMode}
          options={[
            { value: "camera", label: "Camera view", title: "What renders" },
            { value: "free", label: "Free view", title: "Navigate freely; camera frame outlined" },
          ]}
          onChange={(v) => {
            editor().setFreeCam(null);
            editor().setViewMode(v);
          }}
        />
      </div>
      <div className="btn-row">
        <button className="btn" onClick={() => dispatch(cameraCommand(fitCandles(editor().project.chart.candles)))} title="Frame all candles">
          <Maximize2 size={13} /> Fit chart
        </button>
        <button
          className="btn"
          disabled={!selection.length}
          onClick={() => {
            const bb = selectionBBox(editor().project, editor().selection);
            if (bb) dispatch(cameraCommand(bboxState(bb)));
          }}
          title="Frame the selected objects"
        >
          <ScanSearch size={13} /> Fit selection
        </button>
      </div>
      <div className="btn-row">
        <button className="btn" onClick={addCameraKeyframe} title="Record current view as a keyframe (K)">
          <Diamond size={13} /> Keyframe
        </button>
        <button className="btn danger" disabled={!camera.keyframes.length} onClick={() => dispatch({ type: "camera/setKeyframes", keyframes: [] })}>
          <Trash2 size={13} /> Clear keys
        </button>
      </div>

      <div className="pal-sub">Presets (inserted at playhead)</div>
      <div className="tool-list">
        {CAMERA_PRESETS.map((p) => (
          <button key={p.id} className="tool-item" onClick={() => applyPreset(p.id)} title={p.hint}>
            <span className="tool-ico">
              <Crosshair size={14} />
            </span>
            <span className="tool-label">{p.label}</span>
          </button>
        ))}
      </div>

      <div className="pal-sub">Keyframes</div>
      <div className="kf-list">
        {camera.keyframes.map((k) => (
          <button
            key={k.id}
            className={`kf-item${kSel.includes(k.id) ? " sel" : ""}`}
            onClick={() => {
              editor().selectKeyframes([k.id]);
              playback().setTime(k.time);
            }}
          >
            <Diamond size={11} />
            <span className="mono">{k.time.toFixed(2)}s</span>
            <span className="muted">{k.easing}</span>
            {k.follow.mode !== "none" && <span className="pill">follow {k.follow.mode}</span>}
          </button>
        ))}
        {!camera.keyframes.length && <div className="muted pad">Static camera. Add a keyframe or a preset to animate it.</div>}
      </div>
    </>
  );
}
