"use client";

import {
  ANIM_PRESETS,
  EASING_LABELS,
  EASING_NAMES,
  EMPHASIS_PRESETS,
  candleTime,
  formatTime,
  getDef,
  makeCompileCtx,
  type FieldDef,
} from "@tradeanim/editor-core";
import {
  THEME_PRESETS,
  validateProject,
  type AnimPreset,
  type AnimSpec,
  type CameraFollow,
  type Candle,
  type DashStyle,
  type Direction,
  type Easing,
  type EmphasisPreset,
  type SceneObject,
} from "@tradeanim/project-schema";
import { ArrowDownToLine, ArrowUpToLine, ChevronDown, ChevronUp, Eye, EyeOff, Lock, Play, Trash2, Unlock } from "lucide-react";
import { editor, useEditor } from "@/state/store";
import { playback } from "@/state/playback";
import { deleteSelection } from "@/lib/actions";
import { TRACK_COLORS, TRACK_LABELS } from "@/lib/tracks";
import { ColorField, NumberField, Row, Section, Seg, Select, Slider, TextField, Toggle } from "./ui";
import { ToolIcon } from "./ToolIcon";

const EASING_OPTS = EASING_NAMES.map((e) => ({ value: e as Easing, label: EASING_LABELS[e] }));
const FONTS = ["Inter", "JetBrains Mono", "Georgia", "Impact", "Arial", "Times New Roman"].map((f) => ({ value: f, label: f }));

export function Inspector() {
  const selection = useEditor((s) => s.selection);
  const candleSel = useEditor((s) => s.candleSelection);
  const kfSel = useEditor((s) => s.keyframeSelection);
  const objects = useEditor((s) => s.project.objects);

  let body: React.ReactNode;
  if (selection.length === 1) {
    const o = objects.find((x) => x.id === selection[0]);
    body = o ? <ObjectInspector o={o} /> : null;
  } else if (selection.length > 1) body = <MultiInspector ids={selection} />;
  else if (candleSel.length) body = <CandleInspector ids={candleSel} />;
  else if (kfSel.length === 1) body = <KeyframeInspector id={kfSel[0]} />;
  else body = <ProjectInspector />;

  return <aside className="inspector">{body}</aside>;
}

/* ------------------------------------------------------------- object */

function ObjectInspector({ o }: { o: SceneObject }) {
  const dispatch = useEditor((s) => s.dispatch);
  const assets = useEditor((s) => s.project.assets);
  const def = getDef(o.kind);
  const up = (patch: Partial<SceneObject>, key: string) => dispatch({ type: "objects/update", id: o.id, patch }, { merge: `${o.id}:${key}` });
  const setStyle = (key: keyof SceneObject["style"], v: unknown) => up({ style: { ...o.style, [key]: v } }, `style.${key}`);
  const setProp = (key: string, v: unknown) => {
    const next = { ...o, props: { ...o.props, [key]: v } };
    const derived = def.onPropChange?.(next, key, makeCompileCtx(editor().project)) ?? {};
    up({ props: next.props, ...derived }, `prop.${key}`);
  };
  const ctx = makeCompileCtx(editor().project);
  const priceStep = Math.pow(10, -ctx.decimals);
  const isText = ["heading", "caption", "label", "callout"].includes(o.kind);
  const hasStroke = !["heading", "caption", "label", "image", "logo", "vignette", "flash", "spotlight", "audio", "glowOrb"].includes(o.kind);
  const hasFill = ["rect", "zone", "circle", "fvg", "ifvg", "orderBlock", "breakerBlock", "mitigationBlock", "killZone", "displacement", "ote", "premiumDiscount", "premium", "discount", "longPosition", "shortPosition", "riskReward", "fibonacci", "glowOrb", "flash"].includes(o.kind);
  const visual = o.kind !== "audio";

  return (
    <>
      <div className="ins-title">
        <span className="ins-ico" style={{ color: TRACK_COLORS[o.track] }}>
          <ToolIcon kind={o.kind} icon={def.icon} />
        </span>
        <input className="ins-name" value={o.name} onChange={(e) => up({ name: e.target.value }, "name")} onKeyDown={(e) => e.stopPropagation()} />
        <button className="tb-icon" title={o.visible ? "Hide" : "Show"} onClick={() => dispatch({ type: "objects/update", id: o.id, patch: { visible: !o.visible } })}>
          {o.visible ? <Eye size={14} /> : <EyeOff size={14} />}
        </button>
        <button className="tb-icon" title={o.locked ? "Unlock" : "Lock"} onClick={() => dispatch({ type: "objects/update", id: o.id, patch: { locked: !o.locked } })}>
          {o.locked ? <Lock size={14} /> : <Unlock size={14} />}
        </button>
        <button className="tb-icon danger" title="Delete (Del)" onClick={deleteSelection}>
          <Trash2 size={14} />
        </button>
      </div>
      <div className="ins-kind">
        <span style={{ color: TRACK_COLORS[o.track] }}>{TRACK_LABELS[o.track]}</span> · {def.label}
        <span className="muted"> — {def.description}</span>
      </div>

      {def.fields.length > 0 && (
        <Section title={def.group === "smc" ? "Semantics" : "Properties"}>
          {def.fields.filter((f) => !f.when || f.when(o)).map((f) => (
            <Field key={f.key} f={f} value={o.props[f.key]} onChange={(v) => setProp(f.key, v)} assets={assets.filter((a) => (o.kind === "audio" ? a.type === "audio" : a.type === "image"))} />
          ))}
        </Section>
      )}

      {visual && (
        <Section title="Position">
          {o.frame ? (
            <>
              <Row label="X / Y">
                <NumberField value={o.frame.x * 100} step={0.5} suffix="%" onChange={(v) => up({ frame: { ...o.frame!, x: v / 100 } }, "fx")} />
                <NumberField value={o.frame.y * 100} step={0.5} suffix="%" onChange={(v) => up({ frame: { ...o.frame!, y: v / 100 } }, "fy")} />
              </Row>
              <Row label="W / H">
                <NumberField value={o.frame.w * 100} step={0.5} min={1} suffix="%" onChange={(v) => up({ frame: { ...o.frame!, w: v / 100 } }, "fw")} />
                <NumberField value={o.frame.h * 100} step={0.5} min={1} suffix="%" onChange={(v) => up({ frame: { ...o.frame!, h: v / 100 } }, "fh")} />
              </Row>
            </>
          ) : (
            o.points.map((pt, i) => (
              <Row key={i} label={pointLabel(o, i)} title={formatTime(candleTime(editor().project.chart, pt.t), editor().project.chart.timeframe, true)}>
                <NumberField value={pt.t} step={1} precision={1} title="Bar index (time)" onChange={(v) => up({ points: o.points.map((p, j) => (j === i ? { ...p, t: v } : p)) }, `pt${i}t`)} />
                <NumberField value={pt.p} step={priceStep} precision={ctx.decimals} title="Price" onChange={(v) => up({ points: o.points.map((p, j) => (j === i ? { ...p, p: v } : p)) }, `pt${i}p`)} />
              </Row>
            ))
          )}
        </Section>
      )}

      <Section title="Timing">
        <Row label="Start / Dur">
          <NumberField value={o.start} step={0.1} min={0} suffix="s" onChange={(v) => up({ start: v }, "start")} />
          <NumberField value={o.duration} step={0.1} min={0.1} suffix="s" onChange={(v) => up({ duration: v }, "duration")} />
        </Row>
        <Row label="End">
          <span className="mono muted">{(o.start + o.duration).toFixed(2)}s</span>
          <button className="btn tiny" onClick={() => up({ start: Math.round(playback().time * 100) / 100 }, "start")} title="Start at playhead">
            ⇤ playhead
          </button>
          <button className="btn tiny" onClick={() => up({ duration: Math.max(0.1, editor().project.settings.duration - o.start) }, "duration")} title="Extend to end">
            to end ⇥
          </button>
        </Row>
      </Section>

      {visual && (
        <Section title="Style">
          {hasStroke && (
            <>
              <Row label="Stroke">
                <ColorField value={o.style.stroke} onChange={(v) => setStyle("stroke", v)} />
              </Row>
              <Row label="Width">
                <NumberField value={o.style.strokeWidth} step={0.5} min={0} max={20} suffix="px" onChange={(v) => setStyle("strokeWidth", v)} />
                <Seg<DashStyle>
                  value={o.style.dash}
                  options={[
                    { value: "solid", label: "—", title: "Solid" },
                    { value: "dashed", label: "- -", title: "Dashed" },
                    { value: "dotted", label: "···", title: "Dotted" },
                  ]}
                  onChange={(v) => setStyle("dash", v)}
                />
              </Row>
            </>
          )}
          {hasFill && (
            <>
              <Row label="Fill">
                <ColorField value={o.style.fill} onChange={(v) => setStyle("fill", v)} />
              </Row>
              <Row label="Fill opacity">
                <Slider value={o.style.fillOpacity} onChange={(v) => setStyle("fillOpacity", v)} />
              </Row>
            </>
          )}
          {isText && (
            <>
              <Row label="Text colour">
                <ColorField value={o.style.textColor} onChange={(v) => setStyle("textColor", v)} />
              </Row>
              {(o.kind === "label" || o.kind === "callout" || o.kind === "caption") && (
                <Row label="Background">
                  <ColorField value={o.style.labelBg ?? "#000000"} onChange={(v) => setStyle("labelBg", v)} />
                </Row>
              )}
              <Row label="Font">
                <Select value={o.style.fontFamily} options={FONTS} onChange={(v) => setStyle("fontFamily", v)} />
              </Row>
              <Row label="Size / weight">
                <NumberField value={o.style.fontSize} step={1} min={4} max={400} suffix="px" onChange={(v) => setStyle("fontSize", v)} />
                <Select
                  value={String(o.style.fontWeight)}
                  options={[400, 500, 600, 700, 800, 900].map((w) => ({ value: String(w), label: String(w) }))}
                  onChange={(v) => setStyle("fontWeight", Number(v))}
                />
              </Row>
            </>
          )}
          {!isText && o.track === "smc" && (
            <Row label="Label size">
              <NumberField value={o.style.fontSize} step={1} min={6} max={120} suffix="px" onChange={(v) => setStyle("fontSize", v)} />
            </Row>
          )}
          <Row label="Opacity">
            <Slider value={o.style.opacity} onChange={(v) => setStyle("opacity", v)} />
          </Row>
          <Row label="Glow">
            <Slider value={o.style.glow} max={1.5} onChange={(v) => setStyle("glow", v)} />
          </Row>
          {o.style.glow > 0 && (
            <Row label="Glow colour">
              <ColorField value={o.style.glowColor ?? o.style.stroke} onChange={(v) => setStyle("glowColor", v)} />
            </Row>
          )}
          <Row label="Shadow">
            <Slider value={o.style.shadow} onChange={(v) => setStyle("shadow", v)} />
          </Row>
          <Row label="Blur">
            <NumberField value={o.style.blur} step={0.5} min={0} max={40} suffix="px" onChange={(v) => setStyle("blur", v)} />
          </Row>
        </Section>
      )}

      {visual && (
        <Section
          title="Animation"
          right={
            <button
              className="btn tiny"
              title="Preview this object's animation"
              onClick={() => {
                playback().setTime(Math.max(0, o.start - 0.2));
                playback().play();
              }}
            >
              <Play size={11} /> Preview
            </button>
          }
        >
          <AnimEditor label="In" spec={o.animIn} onChange={(animIn, k) => up({ animIn }, `in.${k}`)} />
          <AnimEditor label="Out" spec={o.animOut} onChange={(animOut, k) => up({ animOut }, `out.${k}`)} />
          <div className="ins-sub">Emphasis</div>
          <Row label="Preset">
            <Select<EmphasisPreset> value={o.emphasis.preset} options={EMPHASIS_PRESETS.map((p) => ({ value: p.id, label: p.label }))} onChange={(preset) => up({ emphasis: { ...o.emphasis, preset } }, "em.p")} />
          </Row>
          {o.emphasis.preset !== "none" && (
            <>
              <Row label="At / Dur">
                <NumberField value={o.emphasis.start} step={0.1} min={0} suffix="s" onChange={(start) => up({ emphasis: { ...o.emphasis, start } }, "em.s")} />
                <NumberField value={o.emphasis.duration} step={0.1} min={0.1} suffix="s" onChange={(duration) => up({ emphasis: { ...o.emphasis, duration } }, "em.d")} />
              </Row>
              <Row label="Cycles">
                <NumberField value={o.emphasis.cycles} step={1} min={1} max={20} onChange={(cycles) => up({ emphasis: { ...o.emphasis, cycles: Math.round(cycles) } }, "em.c")} />
              </Row>
            </>
          )}
        </Section>
      )}

      <Section title="Layer" defaultOpen={false}>
        <Row label="Order">
          <div className="btn-row tight">
            <button className="btn tiny" onClick={() => dispatch({ type: "objects/reorder", ids: [o.id], to: "front" })} title="Bring to front">
              <ArrowUpToLine size={12} />
            </button>
            <button className="btn tiny" onClick={() => dispatch({ type: "objects/reorder", ids: [o.id], to: "forward" })} title="Forward">
              <ChevronUp size={12} />
            </button>
            <button className="btn tiny" onClick={() => dispatch({ type: "objects/reorder", ids: [o.id], to: "backward" })} title="Backward">
              <ChevronDown size={12} />
            </button>
            <button className="btn tiny" onClick={() => dispatch({ type: "objects/reorder", ids: [o.id], to: "back" })} title="Send to back">
              <ArrowDownToLine size={12} />
            </button>
          </div>
        </Row>
        <Row label="Id">
          <span className="mono muted small">{o.id}</span>
        </Row>
      </Section>
    </>
  );
}

function pointLabel(o: SceneObject, i: number) {
  if (o.kind === "longPosition" || o.kind === "shortPosition") return ["Entry", "Target", "Stop"][i] ?? `P${i + 1}`;
  if (o.kind === "callout") return ["Target", "Text"][i] ?? `P${i + 1}`;
  if (o.points.length === 1) return "Anchor";
  return `Point ${i + 1}`;
}

function Field({ f, value, onChange, assets }: { f: FieldDef; value: unknown; onChange: (v: unknown) => void; assets: { id: string; name: string }[] }) {
  switch (f.type) {
    case "bool":
      return (
        <Row label={f.label}>
          <Toggle value={Boolean(value)} onChange={onChange} />
        </Row>
      );
    case "number":
      return (
        <Row label={f.label}>
          <NumberField value={Number(value ?? 0)} step={f.step ?? 1} min={f.min} max={f.max} onChange={onChange} />
        </Row>
      );
    case "select":
      return (
        <Row label={f.label}>
          {f.options && f.options.length <= 3 ? (
            <Seg value={String(value ?? "")} options={f.options.map((o) => ({ value: o.value, label: o.label }))} onChange={onChange} />
          ) : (
            <Select value={String(value ?? "")} options={f.options ?? []} onChange={onChange} />
          )}
        </Row>
      );
    case "color":
      return (
        <Row label={f.label}>
          <ColorField value={String(value ?? "#ffffff")} onChange={onChange} />
        </Row>
      );
    case "textarea":
      return (
        <div className="ins-row col">
          <label>{f.label}</label>
          <TextField multiline value={String(value ?? "")} onChange={onChange} />
        </div>
      );
    case "asset":
      return (
        <Row label={f.label}>
          <Select value={String(value ?? "")} options={[{ value: "", label: "— none —" }, ...assets.map((a) => ({ value: a.id, label: a.name }))]} onChange={onChange} />
        </Row>
      );
    default:
      return (
        <Row label={f.label}>
          <TextField value={String(value ?? "")} onChange={onChange} />
        </Row>
      );
  }
}

function AnimEditor({ label, spec, onChange }: { label: string; spec: AnimSpec; onChange: (s: AnimSpec, key: string) => void }) {
  return (
    <>
      <div className="ins-sub">{label}</div>
      <Row label="Preset">
        <Select<AnimPreset> value={spec.preset} options={ANIM_PRESETS.map((p) => ({ value: p.id, label: p.label }))} onChange={(preset) => onChange({ ...spec, preset }, "p")} />
      </Row>
      {spec.preset !== "none" && (
        <>
          <Row label="Dur / Delay">
            <NumberField value={spec.duration} step={0.05} min={0.01} suffix="s" onChange={(duration) => onChange({ ...spec, duration }, "d")} />
            <NumberField value={spec.delay} step={0.05} min={0} suffix="s" onChange={(delay) => onChange({ ...spec, delay }, "dl")} />
          </Row>
          <Row label="Easing">
            <Select<Easing> value={EASING_OPTS.some((e) => e.value === spec.easing) ? spec.easing : "cubicOut"} options={EASING_OPTS} onChange={(easing) => onChange({ ...spec, easing }, "e")} />
          </Row>
          {spec.preset === "slide" && (
            <Row label="Direction">
              <Select<Direction>
                value={spec.direction ?? "up"}
                options={[
                  { value: "up", label: "From below" },
                  { value: "down", label: "From above" },
                  { value: "left", label: "From left" },
                  { value: "right", label: "From right" },
                ]}
                onChange={(direction) => onChange({ ...spec, direction }, "dir")}
              />
            </Row>
          )}
        </>
      )}
    </>
  );
}

/* ------------------------------------------------------------- multi */

function MultiInspector({ ids }: { ids: string[] }) {
  const dispatch = useEditor((s) => s.dispatch);
  const objects = useEditor((s) => s.project.objects);
  const objs = objects.filter((o) => ids.includes(o.id));
  const apply = (fn: (o: SceneObject) => Partial<SceneObject>, key: string) =>
    dispatch({ type: "objects/updateMany", patches: objs.map((o) => ({ id: o.id, patch: fn(o) })) }, { merge: `multi:${key}` });
  const minStart = Math.min(...objs.map((o) => o.start));
  return (
    <>
      <div className="ins-title">
        <span className="ins-name static">{objs.length} objects</span>
        <button className="tb-icon danger" title="Delete (Del)" onClick={deleteSelection}>
          <Trash2 size={14} />
        </button>
      </div>
      <Section title="Timing">
        <Row label="Start">
          <NumberField value={minStart} step={0.1} min={0} suffix="s" onChange={(v) => apply((o) => ({ start: Math.max(0, o.start + (v - minStart)) }), "start")} />
        </Row>
        <Row label="Stagger">
          <button
            className="btn tiny"
            onClick={() => {
              const sorted = [...objs].sort((a, b) => a.start - b.start);
              dispatch({ type: "objects/updateMany", patches: sorted.map((o, i) => ({ id: o.id, patch: { start: +(minStart + i * 0.25).toFixed(2) } })) });
            }}
          >
            0.25s cascade
          </button>
        </Row>
      </Section>
      <Section title="Style">
        <Row label="Opacity">
          <Slider value={objs[0]?.style.opacity ?? 1} onChange={(v) => apply((o) => ({ style: { ...o.style, opacity: v } }), "op")} />
        </Row>
        <Row label="Glow">
          <Slider value={objs[0]?.style.glow ?? 0} max={1.5} onChange={(v) => apply((o) => ({ style: { ...o.style, glow: v } }), "glow")} />
        </Row>
      </Section>
      <Section title="Animation">
        <Row label="In preset">
          <Select<AnimPreset> value={objs[0]?.animIn.preset ?? "fade"} options={ANIM_PRESETS.map((p) => ({ value: p.id, label: p.label }))} onChange={(preset) => apply((o) => ({ animIn: { ...o.animIn, preset } }), "in")} />
        </Row>
        <Row label="Out preset">
          <Select<AnimPreset> value={objs[0]?.animOut.preset ?? "none"} options={ANIM_PRESETS.map((p) => ({ value: p.id, label: p.label }))} onChange={(preset) => apply((o) => ({ animOut: { ...o.animOut, preset } }), "out")} />
        </Row>
      </Section>
    </>
  );
}

/* ------------------------------------------------------------- candles */

function CandleInspector({ ids }: { ids: string[] }) {
  const dispatch = useEditor((s) => s.dispatch);
  const chart = useEditor((s) => s.project.chart);
  const theme = useEditor((s) => s.project.theme);
  const idx = chart.candles.findIndex((c) => c.id === ids[0]);
  const c = chart.candles[idx];
  if (!c) return null;
  const dec = makeCompileCtx(editor().project).decimals;
  const step = Math.pow(10, -dec);
  const up = (patch: Partial<Candle>, key: string) => dispatch({ type: "candles/update", id: c.id, patch }, { merge: `c:${c.id}:${key}` });
  const style = c.style ?? {};
  const setStyle = (k: keyof NonNullable<Candle["style"]>, v: unknown) => {
    for (const id of ids) {
      const cc = chart.candles.find((x) => x.id === id);
      if (cc) dispatch({ type: "candles/update", id, patch: { style: { ...cc.style, [k]: v } } }, { merge: `cs:${id}:${k}` });
    }
  };
  const bull = c.c >= c.o;
  return (
    <>
      <div className="ins-title">
        <span className="ins-name static">
          Candle #{idx}
          {ids.length > 1 && <span className="muted"> + {ids.length - 1} more</span>}
        </span>
        <span className="pill" style={{ color: bull ? theme.bull : theme.bear }}>
          {bull ? "Bullish" : "Bearish"}
        </span>
        <button className="tb-icon danger" title="Delete (Del)" onClick={deleteSelection}>
          <Trash2 size={14} />
        </button>
      </div>
      <div className="ins-kind muted">{formatTime(candleTime(chart, idx), chart.timeframe, true)} UTC</div>
      <Section title="OHLC">
        <Row label="Open">
          <NumberField value={c.o} step={step} precision={dec} onChange={(v) => up({ o: v }, "o")} />
        </Row>
        <Row label="High">
          <NumberField value={c.h} step={step} precision={dec} onChange={(v) => up({ h: v }, "h")} />
        </Row>
        <Row label="Low">
          <NumberField value={c.l} step={step} precision={dec} onChange={(v) => up({ l: v }, "l")} />
        </Row>
        <Row label="Close">
          <NumberField value={c.c} step={step} precision={dec} onChange={(v) => up({ c: v }, "c")} />
        </Row>
        <Row label="Body / range">
          <span className="mono muted">
            {Math.abs(c.c - c.o).toFixed(dec)} / {(c.h - c.l).toFixed(dec)}
          </span>
        </Row>
        <div className="btn-row tight">
          <button className="btn tiny" onClick={() => up({ o: c.c, c: c.o }, "flip")}>
            Flip
          </button>
          <button className="btn tiny" onClick={() => up({ c: c.o }, "doji")}>
            Doji
          </button>
          <button className="btn tiny" onClick={() => up({ h: Math.max(c.o, c.c), l: Math.min(c.o, c.c) }, "marubozu")}>
            Marubozu
          </button>
          <button className="btn tiny" onClick={() => up({ h: Math.max(c.o, c.c) + (c.h - c.l) * 0.8 }, "wick")}>
            Long wick ↑
          </button>
          <button className="btn tiny" onClick={() => up({ l: Math.min(c.o, c.c) - (c.h - c.l) * 0.8 }, "wickd")}>
            Long wick ↓
          </button>
        </div>
      </Section>
      <Section title="Candle style">
        <Row label="Body">
          <ColorField value={style.bodyColor ?? (bull ? theme.bull : theme.bear)} onChange={(v) => setStyle("bodyColor", v)} />
        </Row>
        <Row label="Wick">
          <ColorField value={style.wickColor ?? (bull ? theme.bullWick : theme.bearWick)} onChange={(v) => setStyle("wickColor", v)} />
        </Row>
        <Row label="Opacity">
          <Slider value={style.opacity ?? 1} onChange={(v) => setStyle("opacity", v)} />
        </Row>
        <Row label="Glow">
          <Slider value={style.glow ?? 0} max={1.5} onChange={(v) => setStyle("glow", v)} />
        </Row>
        <Row label="Width">
          <NumberField value={style.widthScale ?? 1} step={0.05} min={0.1} max={3} suffix="×" onChange={(v) => setStyle("widthScale", v)} />
        </Row>
        <button
          className="btn tiny"
          onClick={() => {
            for (const id of ids) dispatch({ type: "candles/update", id, patch: { style: undefined } });
          }}
        >
          Reset style
        </button>
      </Section>
    </>
  );
}

/* ------------------------------------------------------------- keyframe */

function KeyframeInspector({ id }: { id: string }) {
  const dispatch = useEditor((s) => s.dispatch);
  const k = useEditor((s) => s.project.camera.keyframes.find((x) => x.id === id));
  const objects = useEditor((s) => s.project.objects);
  if (!k) return null;
  const up = (patch: Partial<typeof k>, key: string) => dispatch({ type: "camera/updateKeyframe", id, patch }, { merge: `kf:${id}:${key}` });
  const followValue = k.follow.mode === "object" ? `obj:${k.follow.objectId}` : k.follow.mode;
  return (
    <>
      <div className="ins-title">
        <span className="ins-name static">Camera keyframe</span>
        <button className="tb-icon danger" title="Delete (Del)" onClick={() => dispatch({ type: "camera/deleteKeyframes", ids: [id] })}>
          <Trash2 size={14} />
        </button>
      </div>
      <Section title="Keyframe">
        <Row label="Time">
          <NumberField value={k.time} step={0.05} min={0} suffix="s" onChange={(time) => up({ time }, "t")} />
        </Row>
        <Row label="Easing in">
          <Select<Easing> value={k.easing} options={EASING_OPTS} onChange={(easing) => up({ easing }, "e")} />
        </Row>
        <Row label="Follow">
          <Select
            value={followValue}
            options={[
              { value: "none", label: "None (fixed view)" },
              { value: "price", label: "Follow price (newest candle)" },
              ...objects.filter((o) => o.points.length).map((o) => ({ value: `obj:${o.id}`, label: `Follow: ${o.name}` })),
            ]}
            onChange={(v) => {
              const follow: CameraFollow = v === "none" ? { mode: "none" } : v === "price" ? { mode: "price" } : { mode: "object", objectId: v.slice(4) };
              up({ follow }, "f");
            }}
          />
        </Row>
      </Section>
      <Section title="View">
        <Row label="Centre bar">
          <NumberField value={k.state.cx} step={0.5} precision={2} onChange={(cx) => up({ state: { ...k.state, cx } }, "cx")} />
        </Row>
        <Row label="Centre price">
          <NumberField value={k.state.cy} step={Math.pow(10, -makeCompileCtx(editor().project).decimals)} onChange={(cy) => up({ state: { ...k.state, cy } }, "cy")} />
        </Row>
        <Row label="Bars visible">
          <NumberField value={k.state.span} step={1} min={3} precision={1} onChange={(span) => up({ state: { ...k.state, span } }, "span")} />
        </Row>
        <Row label="Price range">
          <NumberField value={k.state.priceSpan} step={Math.pow(10, -makeCompileCtx(editor().project).decimals)} min={0} onChange={(priceSpan) => up({ state: { ...k.state, priceSpan } }, "ps")} />
        </Row>
        <button className="btn tiny" onClick={() => playback().setTime(k.time)}>
          Jump to keyframe
        </button>
      </Section>
    </>
  );
}

/* ------------------------------------------------------------- project */

function ProjectInspector() {
  const p = useEditor((s) => s.project);
  const dispatch = useEditor((s) => s.dispatch);
  const issues = validateProject(p);
  const s = p.settings;
  return (
    <>
      <div className="ins-title">
        <span className="ins-name static">Project</span>
      </div>
      <div className="ins-kind muted">Nothing selected — click an object, candle, clip or keyframe.</div>
      <Section title="Frame">
        <Row label="Backdrop">
          <Select
            value={s.showGrid ? "grid" : s.watermark === "ALGO LIQUID" ? "brand" : "clean"}
            options={[
              { value: "clean", label: "Clean · no grid" },
              { value: "brand", label: "AlgoLiquid · no grid" },
              { value: "grid", label: "Chart grid" },
            ]}
            onChange={(value) => {
              if (value === "grid") dispatch({ type: "settings/update", patch: { showGrid: true } });
              else if (value === "brand") dispatch({ type: "settings/update", patch: { showGrid: false, watermark: "ALGO LIQUID" } });
              else dispatch({ type: "settings/update", patch: { showGrid: false, watermark: s.watermark === "ALGO LIQUID" ? undefined : s.watermark } });
            }}
          />
        </Row>
        <Row label="Price axis">
          <Toggle value={s.showPriceAxis} onChange={(v) => dispatch({ type: "settings/update", patch: { showPriceAxis: v } })} />
        </Row>
        <Row label="Time axis">
          <Toggle value={s.showTimeAxis} onChange={(v) => dispatch({ type: "settings/update", patch: { showTimeAxis: v } })} />
        </Row>
        <Row label="Grid">
          <Toggle value={s.showGrid} onChange={(v) => dispatch({ type: "settings/update", patch: { showGrid: v } })} />
        </Row>
        <Row label="Watermark">
          <TextField value={s.watermark ?? ""} placeholder="e.g. @yourhandle" onChange={(v) => dispatch({ type: "settings/update", patch: { watermark: v || undefined } }, { merge: "wm" })} />
        </Row>
      </Section>
      <Section title="Theme">
        <Row label="Preset">
          <Select
            value={Object.entries(THEME_PRESETS).find(([, t]) => t.background === p.theme.background && t.bull === p.theme.bull)?.[0] ?? "custom"}
            options={[...Object.keys(THEME_PRESETS).map((k) => ({ value: k, label: k })), { value: "custom", label: "Custom" }]}
            onChange={(k) => THEME_PRESETS[k] && dispatch({ type: "theme/set", theme: THEME_PRESETS[k] })}
          />
        </Row>
        {(["background", "grid", "axisText", "bull", "bear"] as const).map((k) => (
          <Row key={k} label={k === "axisText" ? "Axis text" : k[0].toUpperCase() + k.slice(1)}>
            <ColorField value={p.theme[k]} onChange={(v) => dispatch({ type: "theme/set", theme: k === "bull" ? { bull: v, bullWick: v, bullBorder: v } : k === "bear" ? { bear: v, bearWick: v, bearBorder: v } : { [k]: v } })} />
          </Row>
        ))}
      </Section>
      <Section title="Summary">
        <Row label="Output">
          <span className="mono">
            {s.width}×{s.height} · {s.fps}fps · {s.duration}s
          </span>
        </Row>
        <Row label="Content">
          <span className="mono">
            {p.chart.candles.length} candles · {p.objects.length} objects · {p.camera.keyframes.length} keys
          </span>
        </Row>
        {p.meta.prompt && (
          <div className="ins-row col">
            <label>Director brief</label>
            <p className="small muted">{p.meta.prompt}</p>
          </div>
        )}
        {issues.length > 0 && (
          <div className="issues">
            {issues.map((i, n) => (
              <div key={n} className="issue">
                {i.path}: {i.message}
              </div>
            ))}
          </div>
        )}
      </Section>
    </>
  );
}
