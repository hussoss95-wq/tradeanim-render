"use client";

import { useEffect, useMemo, useRef } from "react";
import { getDef, type EditorCommand } from "@tradeanim/editor-core";
import { uid, type SceneObject, type TrackKind } from "@tradeanim/project-schema";
import {
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  Lock,
  Unlock,
  Video,
  CandlestickChart,
  Diamond,
} from "lucide-react";
import { editor, useEditor } from "@/state/store";
import { playback, usePlayback } from "@/state/playback";
import { objectMenu } from "@/lib/actions";
import { useContextMenu } from "./ContextMenu";
import { TRACK_COLORS, TRACK_LABELS } from "@/lib/tracks";

const HEAD_W = 214;
const RULER_H = 24;
const ROW_H = 24;
const GROUP_H = 22;
const SNAP_PX = 7;

const LAYER_TRACKS: TrackKind[] = ["drawings", "smc", "text", "media", "effects", "audio"];

type ClipDrag = {
  mode: "move" | "trimL" | "trimR";
  x0: number;
  ids: string[];
  base: Map<string, { start: number; duration: number }>;
  chart?: boolean;
  moved: boolean;
};

function rulerStep(pps: number) {
  for (const s of [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60]) if (s * pps >= 64) return s;
  return 120;
}

export function fmtTime(t: number, fps = 30) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const f = Math.floor((t - Math.floor(t)) * fps + 1e-6);
  return `${m}:${String(s).padStart(2, "0")}.${String(f).padStart(2, "0")}`;
}

export function Timeline() {
  const project = useEditor((s) => s.project);
  const selection = useEditor((s) => s.selection);
  const keyframeSelection = useEditor((s) => s.keyframeSelection);
  const pps = usePlayback((s) => s.pxPerSec);
  const scrollRef = useRef<HTMLDivElement>(null);
  const drag = useRef<ClipDrag | null>(null);
  const kfDrag = useRef<{ id: string; x0: number; t0: number } | null>(null);
  const scrubbing = useRef(false);

  const D = project.settings.duration;
  const width = HEAD_W + D * pps + 240;

  const groups = useMemo(() => {
    const z = new Map(project.objects.map((o, i) => [o.id, i]));
    return LAYER_TRACKS.map((kind) => ({
      kind,
      state: project.tracks.find((t) => t.kind === kind)!,
      objects: project.objects.filter((o) => o.track === kind).sort((a, b) => (z.get(b.id) ?? 0) - (z.get(a.id) ?? 0)),
    }));
  }, [project.objects, project.tracks]);

  /* --------------------------------------------------------- snapping */
  const snapTime = (t: number, exclude: Set<string>): number => {
    const p = editor().project;
    const cands = [0, playback().time, p.settings.duration, ...p.markers.map((m) => m.time), ...p.camera.keyframes.map((k) => k.time), p.chart.start, p.chart.start + p.chart.duration];
    for (const o of p.objects) if (!exclude.has(o.id)) cands.push(o.start, o.start + o.duration);
    let best = t;
    let bestD = SNAP_PX / pps;
    for (const c of cands) {
      const d = Math.abs(c - t);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  };

  /* --------------------------------------------------------- scrubbing */
  const scrubTo = (clientX: number) => {
    const el = scrollRef.current!;
    const r = el.getBoundingClientRect();
    const x = clientX - r.left + el.scrollLeft - HEAD_W;
    const fps = editor().project.settings.fps;
    let t = Math.max(0, Math.min(editor().project.settings.duration, x / pps));
    t = Math.round(t * fps) / fps;
    playback().setTime(t);
  };

  const clipPatch = (mode: ClipDrag["mode"], b: { start: number; duration: number }, dt: number, ex: Set<string>) => {
    const fps = editor().project.settings.fps;
    const q = (v: number) => Math.round(v * fps) / fps;
    if (mode === "move") {
      let start = Math.max(0, b.start + dt);
      const s1 = snapTime(start, ex);
      const s2 = snapTime(start + b.duration, ex) - b.duration;
      start = s1 !== start ? s1 : s2 !== start ? s2 : start;
      return { start: q(Math.max(0, start)) };
    }
    if (mode === "trimL") {
      const end = b.start + b.duration;
      const start = Math.min(end - 0.1, Math.max(0, snapTime(b.start + dt, ex)));
      return { start: q(start), duration: q(end - start) };
    }
    const end = Math.max(b.start + 0.1, snapTime(b.start + b.duration + dt, ex));
    return { duration: q(end - b.start) };
  };

  useEffect(() => {
    const move = (e: PointerEvent) => {
      if (scrubbing.current) scrubTo(e.clientX);
      const d = drag.current;
      if (d) {
        const dt = (e.clientX - d.x0) / pps;
        if (!d.moved && Math.abs(e.clientX - d.x0) < 3) return;
        d.moved = true;
        const s = editor();
        const ex = new Set(d.ids);
        if (d.chart) {
          const b = d.base.get("chart")!;
          s.updateGesture({ type: "chart/update", patch: clipPatch(d.mode, b, dt, ex) });
          return;
        }
        const patches = d.ids.map((id) => ({ id, patch: clipPatch(d.mode, d.base.get(id)!, dt, ex) }));
        s.updateGesture({ type: "objects/updateMany", patches });
      }
      const k = kfDrag.current;
      if (k) {
        const s = editor();
        const fps = s.project.settings.fps;
        let t = Math.max(0, k.t0 + (e.clientX - k.x0) / pps);
        t = Math.round(snapTime(t, new Set()) * fps) / fps;
        s.updateGesture({ type: "camera/updateKeyframe", id: k.id, patch: { time: t } });
      }
    };
    const up = () => {
      scrubbing.current = false;
      if (drag.current) {
        editor().endGesture(drag.current.mode === "move" ? "Move clip" : "Trim clip");
        drag.current = null;
      }
      if (kfDrag.current) {
        editor().endGesture("Move keyframe");
        kfDrag.current = null;
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pps]);


  const onClipDown = (e: React.PointerEvent, o: SceneObject | null) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const s = editor();
    const target = e.currentTarget as HTMLElement;
    const r = target.getBoundingClientRect();
    const off = e.clientX - r.left;
    const mode: ClipDrag["mode"] = off < 6 ? "trimL" : off > r.width - 6 ? "trimR" : "move";
    if (!o) {
      const c = s.project.chart;
      if (c.locked) return;
      s.beginGesture();
      drag.current = { mode, x0: e.clientX, ids: [], base: new Map([["chart", { start: c.start, duration: c.duration }]]), chart: true, moved: false };
      return;
    }
    if (e.shiftKey || e.ctrlKey || e.metaKey) s.select([o.id], "toggle");
    else if (!s.selection.includes(o.id)) s.select([o.id]);
    const ids = (mode === "move" ? editor().selection : [o.id]).filter((id) => {
      const ob = s.project.objects.find((x) => x.id === id);
      return ob && !ob.locked && !s.project.tracks.find((t) => t.kind === ob.track)?.locked;
    });
    if (!ids.length) return;
    s.beginGesture();
    drag.current = {
      mode,
      x0: e.clientX,
      ids,
      base: new Map(s.project.objects.filter((x) => ids.includes(x.id)).map((x) => [x.id, { start: x.start, duration: x.duration }])),
      moved: false,
    };
  };

  const onWheel = (e: React.WheelEvent) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    const el = scrollRef.current!;
    const r = el.getBoundingClientRect();
    const xIn = e.clientX - r.left + el.scrollLeft - HEAD_W;
    const tAt = xIn / pps;
    const next = Math.min(600, Math.max(8, pps * Math.exp(-e.deltaY * 0.002)));
    playback().setPxPerSec(next);
    requestAnimationFrame(() => {
      el.scrollLeft = Math.max(0, tAt * next - (e.clientX - r.left - HEAD_W));
    });
  };

  // ctrl+wheel must be non-passive to stop browser zoom
  useEffect(() => {
    const el = scrollRef.current!;
    const h = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) e.preventDefault();
    };
    el.addEventListener("wheel", h, { passive: false });
    return () => el.removeEventListener("wheel", h);
  }, []);

  const step = rulerStep(pps);
  const ticks: number[] = [];
  for (let t = 0; t <= D + 1e-6; t += step) ticks.push(+t.toFixed(3));

  const chart = project.chart;
  const candleTrack = project.tracks.find((t) => t.kind === "candles")!;
  const cameraTrack = project.tracks.find((t) => t.kind === "camera")!;
  const dispatch = editor().dispatch;

  return (
    <div className="timeline">
      <div className="tl-scroll" ref={scrollRef} onWheel={onWheel}>
        <div className="tl-content" style={{ width }}>
          {/* ruler */}
          <div className="tl-ruler" style={{ height: RULER_H }}>
            <div className="tl-head tl-ruler-head" style={{ width: HEAD_W }}>
              <span>Layers</span>
              <span className="muted">{project.objects.length}</span>
            </div>
            <div
              className="tl-ruler-track"
              onPointerDown={(e) => {
                scrubbing.current = true;
                scrubTo(e.clientX);
              }}
            >
              {ticks.map((t) => (
                <div key={t} className="tl-tick" style={{ left: t * pps }}>
                  <span>{t >= 60 ? fmtTime(t).slice(0, -3) : `${+t.toFixed(2)}s`}</span>
                </div>
              ))}
              {ticks.map((t) =>
                [1, 2, 3].map((k) => {
                  const st = t + (step * k) / 4;
                  return st <= D ? <div key={`${t}-${k}`} className="tl-subtick" style={{ left: st * pps }} /> : null;
                }),
              )}
              {project.markers.map((m) => (
                <div
                  key={m.id}
                  className="tl-marker"
                  style={{ left: m.time * pps }}
                  title={`${m.label} — right-click to delete`}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    playback().setTime(m.time);
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    useContextMenu.getState().show(e.clientX, e.clientY, [{ label: "Delete marker", danger: true, onSelect: () => dispatch({ type: "markers/delete", ids: [m.id] }) }]);
                  }}
                >
                  <span>{m.label}</span>
                </div>
              ))}
              <div className="tl-end" style={{ left: D * pps }} />
            </div>
          </div>

          {/* camera */}
          <Row
            head={
              <>
                <Video size={13} style={{ color: TRACK_COLORS.camera }} />
                <span className="tl-name">Camera</span>
                <span className="muted">{project.camera.keyframes.length ? `${project.camera.keyframes.length} keys` : "static"}</span>
                <IconToggle
                  on={!cameraTrack.locked}
                  title="Lock camera"
                  onIcon={<Unlock size={12} />}
                  offIcon={<Lock size={12} />}
                  onClick={() => dispatch({ type: "tracks/update", kind: "camera", patch: { locked: !cameraTrack.locked } })}
                />
              </>
            }
            height={ROW_H + 4}
            accent={TRACK_COLORS.camera}
          >
            {project.camera.keyframes.length > 1 && (
              <div
                className="tl-cam-span"
                style={{ left: project.camera.keyframes[0].time * pps, width: (project.camera.keyframes[project.camera.keyframes.length - 1].time - project.camera.keyframes[0].time) * pps }}
              />
            )}
            {project.camera.keyframes.map((k) => (
              <div
                key={k.id}
                className={`tl-kf${keyframeSelection.includes(k.id) ? " sel" : ""}${k.follow.mode !== "none" ? " follow" : ""}`}
                style={{ left: k.time * pps }}
                title={`${k.time.toFixed(2)}s · ${k.easing}${k.follow.mode !== "none" ? ` · follow ${k.follow.mode}` : ""}`}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  const s = editor();
                  s.selectKeyframes([k.id]);
                  if (cameraTrack.locked) return;
                  s.beginGesture();
                  kfDrag.current = { id: k.id, x0: e.clientX, t0: k.time };
                }}
                onDoubleClick={() => playback().setTime(k.time)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  useContextMenu.getState().show(e.clientX, e.clientY, [
                    { label: "Go to keyframe", onSelect: () => playback().setTime(k.time) },
                    { label: "Delete keyframe", danger: true, onSelect: () => dispatch({ type: "camera/deleteKeyframes", ids: [k.id] }) },
                  ]);
                }}
              >
                <Diamond size={11} />
              </div>
            ))}
          </Row>

          {/* candles */}
          <Row
            head={
              <>
                <CandlestickChart size={13} style={{ color: TRACK_COLORS.candles }} />
                <span className="tl-name">Candles</span>
                <span className="muted">{chart.candles.length}</span>
                <IconToggle on={candleTrack.visible} title="Show candles" onIcon={<Eye size={12} />} offIcon={<EyeOff size={12} />} onClick={() => dispatch({ type: "tracks/update", kind: "candles", patch: { visible: !candleTrack.visible } })} />
                <IconToggle on={!candleTrack.locked} title="Lock candles" onIcon={<Unlock size={12} />} offIcon={<Lock size={12} />} onClick={() => dispatch({ type: "tracks/update", kind: "candles", patch: { locked: !candleTrack.locked } })} />
              </>
            }
            height={ROW_H + 4}
            accent={TRACK_COLORS.candles}
          >
            <div
              className={`tl-clip chart${candleTrack.visible ? "" : " hidden"}`}
              style={{ left: chart.start * pps, width: Math.max(4, chart.duration * pps), ["--c" as string]: TRACK_COLORS.candles }}
              onPointerDown={(e) => onClipDown(e, null)}
              onClick={() => editor().setPanel("candles")}
              title="Candle layer — drag to move, drag edges to trim. Reveal settings in the Candles panel."
            >
              {chart.reveal.mode !== "none" && <div className="tl-reveal" style={{ width: Math.min(chart.duration, chart.reveal.duration) * pps }} />}
              <span>
                {chart.symbol} · {chart.timeframe} · reveal {chart.reveal.mode} {chart.reveal.duration}s
              </span>
            </div>
          </Row>

          {groups.map((g) => (
            <div key={g.kind}>
              <div className="tl-group" style={{ height: GROUP_H }}>
                <div className="tl-head" style={{ width: HEAD_W }}>
                  <button className="tl-collapse" onClick={() => dispatch({ type: "tracks/update", kind: g.kind, patch: { collapsed: !g.state.collapsed } })}>
                    {g.state.collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                  </button>
                  <span className="tl-dot" style={{ background: TRACK_COLORS[g.kind] }} />
                  <span className="tl-name strong">{TRACK_LABELS[g.kind]}</span>
                  <span className="muted">{g.objects.length}</span>
                  <IconToggle on={g.state.visible} title="Show track" onIcon={<Eye size={12} />} offIcon={<EyeOff size={12} />} onClick={() => dispatch({ type: "tracks/update", kind: g.kind, patch: { visible: !g.state.visible } })} />
                  <IconToggle on={!g.state.locked} title="Lock track" onIcon={<Unlock size={12} />} offIcon={<Lock size={12} />} onClick={() => dispatch({ type: "tracks/update", kind: g.kind, patch: { locked: !g.state.locked } })} />
                </div>
                <div className="tl-group-lane">
                  {g.state.collapsed &&
                    g.objects.map((o) => (
                      <div key={o.id} className="tl-mini" style={{ left: o.start * pps, width: Math.max(2, o.duration * pps), background: TRACK_COLORS[g.kind] }} />
                    ))}
                </div>
              </div>
              {!g.state.collapsed &&
                g.objects.map((o) => (
                  <LayerRow key={o.id} o={o} pps={pps} selected={selection.includes(o.id)} trackHidden={!g.state.visible} onClipDown={onClipDown} />
                ))}
              {!g.state.collapsed && g.objects.length === 0 && (
                <div className="tl-empty" style={{ height: ROW_H - 4 }}>
                  <div className="tl-head" style={{ width: HEAD_W }} />
                  <span className="muted">Empty — add from the {TRACK_LABELS[g.kind]} tools</span>
                </div>
              )}
            </div>
          ))}
          <div style={{ height: 40 }} />
          <Playhead pps={pps} scrollRef={scrollRef} />
        </div>
      </div>
    </div>
  );
}

function Row({ head, children, height, accent }: { head: React.ReactNode; children: React.ReactNode; height: number; accent: string }) {
  return (
    <div className="tl-row" style={{ height }}>
      <div className="tl-head" style={{ width: HEAD_W, boxShadow: `inset 2px 0 0 ${accent}` }}>
        {head}
      </div>
      <div className="tl-lane">{children}</div>
    </div>
  );
}

function IconToggle({ on, onIcon, offIcon, onClick, title }: { on: boolean; onIcon: React.ReactNode; offIcon: React.ReactNode; onClick: () => void; title: string }) {
  return (
    <button
      className={`tl-icon${on ? "" : " off"}`}
      title={title}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {on ? onIcon : offIcon}
    </button>
  );
}

function LayerRow({
  o,
  pps,
  selected,
  trackHidden,
  onClipDown,
}: {
  o: SceneObject;
  pps: number;
  selected: boolean;
  trackHidden: boolean;
  onClipDown: (e: React.PointerEvent, o: SceneObject) => void;
}) {
  const dispatch = editor().dispatch;
  const color = TRACK_COLORS[o.track];
  const def = getDef(o.kind);
  const inW = o.animIn.preset !== "none" ? Math.min(o.duration, o.animIn.duration + o.animIn.delay) * pps : 0;
  const outW = o.animOut.preset !== "none" ? Math.min(o.duration, o.animOut.duration) * pps : 0;
  const emph = o.emphasis.preset !== "none";
  const menu = (e: React.MouseEvent) => {
    e.preventDefault();
    const s = editor();
    if (!s.selection.includes(o.id)) s.select([o.id]);
    useContextMenu.getState().show(e.clientX, e.clientY, objectMenu());
  };
  return (
    <div className={`tl-row layer${selected ? " sel" : ""}`} style={{ height: ROW_H }}>
      <div
        className="tl-head"
        style={{ width: HEAD_W }}
        onPointerDown={(e) => {
          const s = editor();
          s.select([o.id], e.shiftKey || e.ctrlKey || e.metaKey ? "toggle" : "set");
        }}
        onContextMenu={menu}
      >
        <IconToggle on={o.visible} title="Visibility" onIcon={<Eye size={12} />} offIcon={<EyeOff size={12} />} onClick={() => dispatch({ type: "objects/update", id: o.id, patch: { visible: !o.visible } })} />
        <IconToggle on={!o.locked} title="Lock" onIcon={<Unlock size={12} />} offIcon={<Lock size={12} />} onClick={() => dispatch({ type: "objects/update", id: o.id, patch: { locked: !o.locked } })} />
        <span className="tl-kind" style={{ color }}>{def.label.length > 6 ? def.label.slice(0, 6) : def.label}</span>
        <span className="tl-name" title={o.name}>{o.name}</span>
      </div>
      <div className="tl-lane">
        <div
          className={`tl-clip${selected ? " sel" : ""}${!o.visible || trackHidden ? " hidden" : ""}${o.locked ? " locked" : ""}`}
          style={{ left: o.start * pps, width: Math.max(4, o.duration * pps), ["--c" as string]: color }}
          onPointerDown={(e) => onClipDown(e, o)}
          onDoubleClick={() => playback().setTime(o.start)}
          onContextMenu={menu}
          title={`${o.name}\n${o.start.toFixed(2)}s → ${(o.start + o.duration).toFixed(2)}s\nIn: ${o.animIn.preset} · Out: ${o.animOut.preset}`}
        >
          {inW > 2 && <div className="tl-ramp in" style={{ width: inW }} />}
          {outW > 2 && <div className="tl-ramp out" style={{ width: outW }} />}
          {emph && <div className="tl-emph" style={{ left: o.emphasis.start * pps, width: Math.max(3, o.emphasis.duration * pps) }} />}
          <span>{o.name}</span>
        </div>
      </div>
    </div>
  );
}

function Playhead({ pps, scrollRef }: { pps: number; scrollRef: React.RefObject<HTMLDivElement | null> }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const apply = (t: number, playing: boolean) => {
      if (!ref.current) return;
      const x = HEAD_W + t * pps;
      ref.current.style.transform = `translateX(${x}px)`;
      const el = scrollRef.current;
      if (playing && el) {
        const vis = x - el.scrollLeft;
        if (vis > el.clientWidth - 40 || vis < HEAD_W) el.scrollLeft = Math.max(0, x - HEAD_W - 40);
      }
    };
    apply(playback().time, false);
    return usePlayback.subscribe((s) => apply(s.time, s.playing));
  }, [pps, scrollRef]);
  return (
    <div ref={ref} className="tl-playhead">
      <div className="tl-playhead-cap" />
    </div>
  );
}

export function addMarker() {
  const s = editor();
  const t = playback().time;
  s.dispatch({ type: "markers/add", marker: { id: uid("mk_"), time: t, label: `M${s.project.markers.length + 1}` } } as EditorCommand);
}
