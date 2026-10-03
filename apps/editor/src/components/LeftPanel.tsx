"use client";

import { ALL_DEFS, fairValueGaps, getDef, makeCompileCtx, createObject, swings, type ObjectDef } from "@tradeanim/editor-core";
import type { ObjectKind, SceneObject } from "@tradeanim/project-schema";
import {
  Bot,
  CandlestickChart,
  Hand,
  Image as ImageIcon,
  MousePointer2,
  Music,
  PanelLeftClose,
  PanelLeftOpen,
  PenTool,
  Sparkles,
  Type,
  Video,
  Wand2,
  Shapes,
} from "lucide-react";
import { editor, useEditor, type PanelId } from "@/state/store";
import { playback } from "@/state/playback";
import { insertObject } from "@/lib/actions";
import { ToolIcon } from "./ToolIcon";
import { CandlesPanel } from "./panels/CandlesPanel";
import { CameraPanel } from "./panels/CameraPanel";
import { AIPanel } from "./panels/AIPanel";
import { AudioPanel, MediaPanel } from "./panels/MediaPanels";

const RAIL: { id: PanelId; label: string; icon: React.ReactNode }[] = [
  { id: "tools", label: "Draw", icon: <PenTool size={17} /> },
  { id: "smc", label: "SMC", icon: <Shapes size={17} /> },
  { id: "candles", label: "Candles", icon: <CandlestickChart size={17} /> },
  { id: "text", label: "Text", icon: <Type size={17} /> },
  { id: "camera", label: "Camera", icon: <Video size={17} /> },
  { id: "effects", label: "FX", icon: <Sparkles size={17} /> },
  { id: "media", label: "Media", icon: <ImageIcon size={17} /> },
  { id: "audio", label: "Audio", icon: <Music size={17} /> },
  { id: "ai", label: "AI", icon: <Bot size={17} /> },
];

export function LeftPanel() {
  const panel = useEditor((s) => s.panel);
  const open = useEditor((s) => s.paletteOpen);
  const tool = useEditor((s) => s.tool);
  const setTool = useEditor((s) => s.setTool);
  const setPanel = useEditor((s) => s.setPanel);
  const toggle = useEditor((s) => s.togglePalette);

  return (
    <aside className="left">
      <nav className="rail">
        <button className={`rail-btn${tool === "select" ? " on" : ""}`} onClick={() => setTool("select")} title="Select / move (V)">
          <MousePointer2 size={17} />
        </button>
        <button className={`rail-btn${tool === "hand" ? " on" : ""}`} onClick={() => setTool("hand")} title="Pan (H)">
          <Hand size={17} />
        </button>
        <button className={`rail-btn${tool === "candle" ? " on" : ""}`} onClick={() => setTool("candle")} title="Candle tool: click to add candles (C)">
          <CandlestickChart size={17} />
        </button>
        <div className="rail-sep" />
        {RAIL.map((r) => (
          <button key={r.id} className={`rail-btn labeled${panel === r.id && open ? " active" : ""}`} onClick={() => setPanel(r.id)} title={r.label}>
            {r.icon}
            <span>{r.label}</span>
          </button>
        ))}
        <div className="rail-fill" />
        <button className="rail-btn" onClick={toggle} title={open ? "Collapse panel" : "Expand panel"}>
          {open ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
        </button>
      </nav>
      {open && (
        <div className={`palette${panel === "candles" || panel === "smc" ? " wide" : ""}`}>
          {panel === "tools" && <ToolsPanel />}
          {panel === "smc" && <SmcPanel />}
          {panel === "text" && <TextPanel />}
          {panel === "candles" && <CandlesPanel />}
          {panel === "camera" && <CameraPanel />}
          {panel === "effects" && <EffectsPanel />}
          {panel === "media" && <MediaPanel />}
          {panel === "audio" && <AudioPanel />}
          {panel === "ai" && <AIPanel />}
        </div>
      )}
    </aside>
  );
}

function PanelHead({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="pal-head">
      <h3>{title}</h3>
      {sub && <p>{sub}</p>}
    </div>
  );
}

function ToolButton({ def, insert }: { def: ObjectDef; insert?: boolean }) {
  const tool = useEditor((s) => s.tool);
  const active = tool === def.kind;
  return (
    <button
      className={`tool-item${active ? " on" : ""}`}
      title={`${def.label} — ${def.description}${def.shortcut ? ` (${def.shortcut})` : ""}`}
      onClick={(e) => {
        if (insert || def.placement === "global" || def.placement === "frame") {
          insertObject(def.kind);
          return;
        }
        editor().setTool(active ? "select" : def.kind, e.shiftKey);
      }}
    >
      <span className="tool-ico">
        <ToolIcon kind={def.kind} icon={def.icon} />
      </span>
      <span className="tool-label">{def.label}</span>
      {def.shortcut && <kbd>{def.shortcut}</kbd>}
    </button>
  );
}

const byGroup = (g: ObjectDef["group"]) => ALL_DEFS.filter((d) => d.group === g);
const pick = (kinds: ObjectKind[]) => kinds.map((k) => getDef(k));

function ToolsPanel() {
  return (
    <>
      <PanelHead title="Drawing" sub="Anchored to time & price — they stay glued to the chart." />
      <div className="tool-list">
        {byGroup("drawing").map((d) => (
          <ToolButton key={d.kind} def={d} />
        ))}
      </div>
      <PanelHead title="Trading" />
      <div className="tool-list">
        {byGroup("trading").map((d) => (
          <ToolButton key={d.kind} def={d} />
        ))}
      </div>
    </>
  );
}

const SMC_GROUPS: [string, ObjectKind[]][] = [
  ["Market structure", ["bos", "choch", "mss", "cisd"]],
  ["Imbalances & blocks", ["fvg", "ifvg", "orderBlock", "breakerBlock", "mitigationBlock", "displacement"]],
  ["Liquidity", ["liquidity", "liquiditySweep", "liquidityGrab", "equalHighs", "equalLows", "inducement", "smt"]],
  ["Dealing range", ["premiumDiscount", "premium", "discount", "equilibrium", "ote"]],
  ["Key levels", ["pdh", "pdl", "pwh", "pwl", "sessionHigh", "sessionLow"]],
  ["Time", ["killZone"]],
];

function SmcPanel() {
  return (
    <>
      <PanelHead title="SMC / ICT" sub="Semantic objects with their own data, visuals and inspector." />
      <button className="pal-action" onClick={autoMarkup} title="Detect fair value gaps and swing structure on the current candles">
        <Wand2 size={14} /> Auto-detect FVGs & structure
      </button>
      {SMC_GROUPS.map(([title, kinds]) => (
        <div key={title}>
          <div className="pal-sub">{title}</div>
          <div className="tool-grid">
            {pick(kinds).map((d) => (
              <ToolButton key={d.kind} def={d} />
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

function TextPanel() {
  const presets: { label: string; kind: ObjectKind; props: Record<string, unknown>; style?: Partial<SceneObject["style"]> }[] = [
    { label: "Hook title", kind: "heading", props: { text: "This Setup Prints Money" }, style: { fontSize: 72, fontWeight: 900 } },
    { label: "Lower third", kind: "caption", props: { text: "EURUSD · 15m · London open" }, style: { fontSize: 30 } },
    { label: "Big number", kind: "heading", props: { text: "+3.2R" }, style: { fontSize: 120, fontWeight: 900, textColor: "#22c55e" } },
    { label: "Warning", kind: "heading", props: { text: "Don't chase this move" }, style: { fontSize: 56, textColor: "#ef4444" } },
  ];
  return (
    <>
      <PanelHead title="Text" sub="Headings & captions sit on the frame; labels & callouts attach to the chart." />
      <div className="tool-list">
        {pick(["heading", "caption"]).map((d) => (
          <ToolButton key={d.kind} def={d} insert />
        ))}
        {pick(["label", "callout"]).map((d) => (
          <ToolButton key={d.kind} def={d} />
        ))}
      </div>
      <div className="pal-sub">Presets</div>
      <div className="preset-grid">
        {presets.map((p) => (
          <button
            key={p.label}
            className="preset"
            onClick={() => {
              const o = insertObject(p.kind, { props: p.props });
              if (p.style) editor().dispatch({ type: "objects/update", id: o.id, patch: { style: { ...o.style, ...p.style } } });
            }}
          >
            <span style={{ color: p.style?.textColor ?? "#f8fafc", fontWeight: p.style?.fontWeight ?? 800 }}>{p.label}</span>
          </button>
        ))}
      </div>
    </>
  );
}

function EffectsPanel() {
  return (
    <>
      <PanelHead title="Effects" sub="Spotlight & orb anchor to a chart point; vignette & flash cover the frame." />
      <div className="tool-list">
        {byGroup("effects").map((d) => (
          <ToolButton key={d.kind} def={d} />
        ))}
      </div>
      <div className="pal-note">
        Glow, shadow and blur are per-object style settings in the inspector. Emphasis animations (pulse, glow, flash, highlight) are under Animation.
      </div>
    </>
  );
}

/** Detect FVGs + swing BOS on the candles and add them as semantic objects. */
function autoMarkup() {
  const s = editor();
  const p = s.project;
  const cs = p.chart.candles;
  if (cs.length < 5) {
    s.toast("Need at least 5 candles", "error");
    return;
  }
  const ctx = makeCompileCtx(p);
  const t = playback().time;
  const dur = Math.max(1, p.settings.duration - t);
  const objs: SceneObject[] = [];
  const range = Math.max(...cs.map((c) => c.h)) - Math.min(...cs.map((c) => c.l));
  for (const g of fairValueGaps(cs).filter((g) => g.top - g.bottom > range * 0.015).slice(0, 6)) {
    objs.push(createObject("fvg", ctx, { points: [{ t: g.i0 + 0.6, p: g.top }, { t: g.i2 + 4, p: g.bottom }], start: t, duration: dur, props: { direction: g.bullish ? "bullish" : "bearish" } }));
  }
  const sw = swings(cs, 3);
  for (const s1 of sw) {
    const brk = cs.findIndex((c, i) => i > s1.i + 1 && (s1.type === "high" ? c.c > s1.price : c.c < s1.price));
    if (brk < 0) continue;
    objs.push(createObject("bos", ctx, { points: [{ t: s1.i, p: s1.price }, { t: brk, p: s1.price }], start: t, duration: dur, props: { direction: s1.type === "high" ? "bullish" : "bearish" } }));
  }
  if (!objs.length) {
    s.toast("Nothing detected", "info");
    return;
  }
  s.dispatch({ type: "objects/add", objects: objs.slice(0, 14) });
  s.select(objs.slice(0, 14).map((o) => o.id));
  s.toast(`Added ${Math.min(14, objs.length)} detected objects`, "success");
}
