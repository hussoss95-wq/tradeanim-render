"use client";

import { useEffect, useRef, useState } from "react";
import { editor, useEditor, type ToolId } from "@/state/store";
import { playback, usePlayback } from "@/state/playback";
import { readAutosave, saveProject, writeAutosave } from "@/lib/persistence";
import { addCameraKeyframe, copySelection, deleteSelection, duplicateSelection, insertObject, nudge, paste } from "@/lib/actions";
import { demoProject } from "@/state/demo";
import { TopBar } from "./TopBar";
import { LeftPanel } from "./LeftPanel";
import { Stage } from "./Stage";
import { TransportBar } from "./TransportBar";
import { Timeline, addMarker } from "./Timeline";
import { Inspector } from "./Inspector";
import { ContextMenu } from "./ContextMenu";
import { Dialogs, Toasts } from "./Dialogs";

const TOOL_KEYS: Record<string, ToolId> = {
  v: "select",
  h: "hand",
  c: "candle",
  l: "trendline",
  z: "zone",
  r: "rect",
  a: "arrow",
  o: "circle",
  f: "fibonacci",
  p: "path",
};

export function Editor() {
  const [ready, setReady] = useState(false);
  const previewMode = useEditor((s) => s.previewMode);
  const [tlHeight, setTlHeight] = useState(() => (typeof window === "undefined" ? 240 : Math.round(Math.min(300, Math.max(150, window.innerHeight * 0.3)))));

  // initial project: autosave → demo
  useEffect(() => {
    const saved = readAutosave();
    editor().loadProject(saved ?? demoProject());
    try {
      const h = Number(localStorage.getItem("tradeanim.ui.timeline"));
      if (h > 120) setTlHeight(h);
    } catch {
      /* storage blocked */
    }
    setReady(true);
  }, []);

  useAutosave();
  usePlaybackLoop();
  useKeyboard();
  useAudioPreview();

  // expose for debugging / automation (window.tradeanim)
  useEffect(() => {
    (window as unknown as { tradeanim: unknown }).tradeanim = { editor, playback };
  }, []);

  const startResize = (e: React.PointerEvent) => {
    const y0 = e.clientY;
    const h0 = tlHeight;
    const move = (ev: PointerEvent) => setTlHeight(Math.min(window.innerHeight - 260, Math.max(140, h0 - (ev.clientY - y0))));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      try {
        localStorage.setItem("tradeanim.ui.timeline", String(Math.round(tlHeightRef.current)));
      } catch {
        /* ignore */
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const tlHeightRef = useRef(tlHeight);
  tlHeightRef.current = tlHeight;

  if (!ready) return <div className="boot">Loading editor…</div>;

  return (
    <div className={`app${previewMode ? " preview" : ""}`}>
      <TopBar />
      <div className="main">
        {!previewMode && <LeftPanel />}
        <div className="center">
          <Stage />
          <TransportBar />
          {!previewMode && (
            <>
              <div className="splitter" onPointerDown={startResize} title="Drag to resize timeline" />
              <div className="tl-wrap" style={{ height: tlHeight }}>
                <Timeline />
              </div>
            </>
          )}
        </div>
        {!previewMode && <Inspector />}
      </div>
      <ContextMenu />
      <Dialogs />
      <Toasts />
    </div>
  );
}

function useAutosave() {
  const revision = useEditor((s) => s.revision);
  useEffect(() => {
    const id = window.setTimeout(() => writeAutosave(editor().project), 500);
    return () => window.clearTimeout(id);
  }, [revision]);
}

function usePlaybackLoop() {
  const playing = usePlayback((s) => s.playing);
  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const pb = playback();
      const D = editor().project.settings.duration;
      let t = pb.time + dt * pb.speed;
      if (t >= D) {
        if (pb.loop && !editor().previewMode) t = 0;
        else {
          pb.setTime(D);
          pb.pause();
          return;
        }
      }
      pb.setTime(t);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);
}

function isTyping(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  const tag = t.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t.isContentEditable;
}

function useKeyboard() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e)) return;
      const s = editor();
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (s.dialog && e.key !== "Escape") return;

      if (mod) {
        if (k === "z" && !e.shiftKey) s.undo();
        else if ((k === "z" && e.shiftKey) || k === "y") s.redo();
        else if (k === "s") void saveProject();
        else if (k === "o") s.setDialog("open");
        else if (k === "d") duplicateSelection();
        else if (k === "c") copySelection();
        else if (k === "v") paste();
        else if (k === "a") s.select(s.project.objects.filter((o) => o.visible && !o.locked).map((o) => o.id));
        else if (e.key === "]") s.dispatch({ type: "objects/reorder", ids: s.selection, to: "front" });
        else if (e.key === "[") s.dispatch({ type: "objects/reorder", ids: s.selection, to: "back" });
        else return;
        e.preventDefault();
        return;
      }

      switch (e.key) {
        case " ":
          e.preventDefault();
          if (!playback().playing && playback().time >= s.project.settings.duration - 0.01) playback().setTime(0);
          playback().toggle();
          return;
        case "Escape":
          if (s.previewMode) {
            s.setPreviewMode(false);
            playback().pause();
          } else if (s.tool !== "select") s.setTool("select");
          else s.clearSelection();
          return;
        case "Delete":
        case "Backspace":
          e.preventDefault();
          deleteSelection();
          return;
        case "Home":
          playback().setTime(0);
          return;
        case "End":
          playback().setTime(s.project.settings.duration);
          return;
        case "ArrowLeft":
        case "ArrowRight":
        case "ArrowUp":
        case "ArrowDown": {
          e.preventDefault();
          const dir = e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 1;
          const horizontal = e.key === "ArrowLeft" || e.key === "ArrowRight";
          if (s.selection.length || s.candleSelection.length) {
            const mult = e.shiftKey ? 10 : 1;
            nudge(horizontal ? dir * mult : 0, horizontal ? 0 : dir * mult);
          } else if (horizontal) {
            playback().pause();
            const fps = s.project.settings.fps;
            const stepT = e.shiftKey ? 1 : 1 / fps;
            playback().setTime(Math.min(s.project.settings.duration, Math.max(0, Math.round((playback().time + dir * stepT) * fps) / fps)));
          }
          return;
        }
        case "?":
          s.setDialog("shortcuts");
          return;
      }
      if (e.altKey) return;
      if (k === "k") return addCameraKeyframe();
      if (k === "m") return addMarker();
      if (k === "t") {
        insertObject("heading");
        return;
      }
      const tool = TOOL_KEYS[k];
      if (tool) s.setTool(tool, e.shiftKey);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

/** Plays audio clips in sync with the transport (preview only; export muxes in Python). */
function useAudioPreview() {
  const objects = useEditor((s) => s.project.objects);
  const assets = useEditor((s) => s.project.assets);
  const els = useRef(new Map<string, HTMLAudioElement>());

  useEffect(() => {
    const clips = objects.filter((o) => o.kind === "audio" && o.props.assetId);
    const keep = new Set(clips.map((c) => c.id));
    for (const [id, el] of els.current) {
      if (!keep.has(id)) {
        el.pause();
        els.current.delete(id);
      }
    }
    for (const c of clips) {
      const a = assets.find((x) => x.id === c.props.assetId);
      if (!a) continue;
      let el = els.current.get(c.id);
      if (!el || el.dataset.src !== a.id) {
        el?.pause();
        el = new Audio(a.src);
        el.dataset.src = a.id;
        el.preload = "auto";
        els.current.set(c.id, el);
      }
      el.volume = Math.min(1, Math.max(0, Number(c.props.volume ?? 1)));
    }
  }, [objects, assets]);

  useEffect(() => {
    let lastT = playback().time;
    return usePlayback.subscribe((pb) => {
      const objs = editor().project.objects;
      for (const [id, el] of els.current) {
        const o = objs.find((x) => x.id === id);
        if (!o) continue;
        const local = pb.time - o.start + Number(o.props.offset ?? 0);
        const inside = pb.time >= o.start && pb.time < o.start + o.duration && o.visible;
        if (pb.playing && inside) {
          if (el.paused) {
            el.currentTime = Math.max(0, local);
            el.playbackRate = pb.speed;
            void el.play().catch(() => undefined);
          } else if (Math.abs(el.currentTime - local) > 0.25 || Math.abs(pb.time - lastT) > 0.3) {
            el.currentTime = Math.max(0, local);
          }
        } else if (!el.paused) el.pause();
      }
      lastT = pb.time;
    });
  }, []);
}
