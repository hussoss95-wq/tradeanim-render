"use client";

import { useState } from "react";
import {
  EASING_LABELS,
  EASING_NAMES,
  PATTERNS,
  TIMEFRAMES,
  candlesToCSV,
  fitCandles,
  generateGBM,
  generatePattern,
  makeCompileCtx,
  parseCandles,
  type PatternId,
} from "@tradeanim/editor-core";
import { THEME_PRESETS, uid, type Candle, type Easing, type RevealMode } from "@tradeanim/project-schema";
import { ArrowDown, ArrowUp, Copy, Download, Plus, Trash2, Upload } from "lucide-react";
import { editor, useEditor } from "@/state/store";
import { appendCandle, cameraCommand } from "@/lib/actions";
import { downloadText, pickFile } from "@/lib/persistence";
import { ColorField, NumberField, Row, Section, Select, Toggle } from "../ui";

export function CandlesPanel() {
  const chart = useEditor((s) => s.project.chart);
  const theme = useEditor((s) => s.project.theme);
  const sel = useEditor((s) => s.candleSelection);
  const dispatch = useEditor((s) => s.dispatch);
  const [pattern, setPattern] = useState<PatternId>("bearishSweep");
  const [gbm, setGbm] = useState({ count: 60, vol: 0.0018, drift: 0, seed: 7 });
  const [paste, setPaste] = useState("");
  const cs = chart.candles;
  const last = cs[cs.length - 1];
  const dec = makeCompileCtx(editor().project).decimals;
  const step = Math.pow(10, -dec);
  const base = last?.c ?? 1.085;
  const [patBase, setPatBase] = useState<number | null>(null);
  const [patHeight, setPatHeight] = useState<number | null>(null);
  const range = cs.length ? Math.max(...cs.map((c) => c.h)) - Math.min(...cs.map((c) => c.l)) : base * 0.006;

  const replace = (candles: Candle[], label: string) => {
    const s = editor();
    s.dispatch({
      type: "batch",
      label,
      commands: [
        { type: "candles/set", candles },
        cameraCommand(fitCandles(candles)),
      ],
    });
    s.toast(`${label}: ${candles.length} candles`, "success");
  };

  const importText = (text: string) => {
    try {
      const candles = parseCandles(text);
      if (!candles.length) throw new Error("No candles found");
      replace(candles, "Import candles");
      setPaste("");
    } catch (err) {
      editor().toast(`Import failed: ${(err as Error).message}`, "error");
    }
  };

  const update = (c: Candle, patch: Partial<Candle>) => dispatch({ type: "candles/update", id: c.id, patch }, { merge: `candle-${c.id}-${Object.keys(patch).join()}` });

  return (
    <div className="candles-panel">
      <div className="pal-head">
        <h3>Candle builder</h3>
        <p>Click the chart with the Candle tool (C) to append. Select a candle to drag its O/H/L/C handles.</p>
      </div>

      <div className="btn-row">
        <button className="btn bull" onClick={() => appendCandle(true)} title="Append bullish candle">
          <Plus size={13} /> Bull
        </button>
        <button className="btn bear" onClick={() => appendCandle(false)} title="Append bearish candle">
          <Plus size={13} /> Bear
        </button>
        <button
          className="btn"
          disabled={!sel.length}
          onClick={() => {
            const i = Math.max(...sel.map((id) => cs.findIndex((c) => c.id === id)));
            const copies = cs.filter((c) => sel.includes(c.id)).map((c) => ({ ...c, id: uid("c_") }));
            dispatch({ type: "candles/insert", index: i + 1, candles: copies });
          }}
          title="Duplicate selected"
        >
          <Copy size={13} />
        </button>
        <button className="btn danger" disabled={!sel.length} onClick={() => dispatch({ type: "candles/delete", ids: sel })} title="Delete selected">
          <Trash2 size={13} />
        </button>
      </div>

      <div className="ohlc-table">
        <div className="ohlc-head">
          <span>#</span>
          <span>Open</span>
          <span>High</span>
          <span>Low</span>
          <span>Close</span>
          <span />
        </div>
        <div className="ohlc-body">
          {cs.map((c, i) => (
            <div key={c.id} className={`ohlc-row${sel.includes(c.id) ? " sel" : ""}`} onPointerDown={(e) => editor().selectCandles([c.id], e.shiftKey ? "toggle" : "set")}>
              <span className="ohlc-i" style={{ color: c.c >= c.o ? theme.bull : theme.bear }}>
                {i}
              </span>
              <NumberField value={c.o} step={step} onChange={(v) => update(c, { o: v })} />
              <NumberField value={c.h} step={step} onChange={(v) => update(c, { h: v })} />
              <NumberField value={c.l} step={step} onChange={(v) => update(c, { l: v })} />
              <NumberField value={c.c} step={step} onChange={(v) => update(c, { c: v })} />
              <span className="ohlc-move">
                <button disabled={i === 0} onClick={() => dispatch({ type: "candles/move", id: c.id, to: i - 1 })} title="Move left">
                  <ArrowUp size={11} />
                </button>
                <button disabled={i === cs.length - 1} onClick={() => dispatch({ type: "candles/move", id: c.id, to: i + 1 })} title="Move right">
                  <ArrowDown size={11} />
                </button>
              </span>
            </div>
          ))}
          {!cs.length && <div className="muted pad">No candles yet — generate, import or click with the Candle tool.</div>}
        </div>
      </div>

      <Section title="Generate">
        <Row label="Pattern">
          <Select value={pattern} options={PATTERNS.map((p) => ({ value: p.id, label: p.label }))} onChange={setPattern} />
        </Row>
        <Row label="Base">
          <NumberField value={patBase ?? +(base - range * 0.5).toFixed(dec)} step={step * 10} onChange={setPatBase} />
        </Row>
        <Row label="Height">
          <NumberField value={patHeight ?? +range.toFixed(dec)} step={step * 10} min={0} onChange={setPatHeight} />
        </Row>
        <div className="btn-row">
          <button className="btn wide" onClick={() => replace(generatePattern(pattern, patBase ?? base - range * 0.5, patHeight ?? range, Math.floor(Math.random() * 1e6)), "Generate pattern")}>
            Generate pattern
          </button>
        </div>
        <div className="pal-sub">Geometric Brownian motion</div>
        <Row label="Count">
          <NumberField value={gbm.count} step={1} min={2} max={2000} onChange={(v) => setGbm({ ...gbm, count: Math.round(v) })} />
        </Row>
        <Row label="Volatility">
          <NumberField value={gbm.vol} step={0.0001} min={0} precision={4} onChange={(v) => setGbm({ ...gbm, vol: v })} />
        </Row>
        <Row label="Drift">
          <NumberField value={gbm.drift} step={0.0001} precision={4} onChange={(v) => setGbm({ ...gbm, drift: v })} />
        </Row>
        <Row label="Seed">
          <NumberField value={gbm.seed} step={1} onChange={(v) => setGbm({ ...gbm, seed: Math.round(v) })} />
        </Row>
        <div className="btn-row">
          <button className="btn wide" onClick={() => replace(generateGBM({ ...gbm, start: base }), "Generate GBM")}>
            Generate GBM
          </button>
        </div>
      </Section>

      <Section title="Import / export">
        <textarea
          className="txt mono paste"
          rows={4}
          placeholder={"Paste OHLC rows, CSV with header, or JSON\n1.0850 1.0862 1.0845 1.0858\n…"}
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
        />
        <div className="btn-row">
          <button className="btn" disabled={!paste.trim()} onClick={() => importText(paste)}>
            Import pasted
          </button>
          <button
            className="btn"
            onClick={async () => {
              const f = await pickFile(".csv,.json,.txt,.tsv");
              if (f) importText(await f.text());
            }}
          >
            <Upload size={13} /> File
          </button>
          <button className="btn" disabled={!cs.length} onClick={() => downloadText(`${chart.symbol}-${chart.timeframe}.csv`, candlesToCSV(cs), "text/csv")}>
            <Download size={13} /> CSV
          </button>
        </div>
      </Section>

      <Section title="Instrument">
        <Row label="Symbol">
          <input className="txt" value={chart.symbol} onChange={(e) => dispatch({ type: "chart/update", patch: { symbol: e.target.value.toUpperCase() } }, { merge: "symbol" })} onKeyDown={(e) => e.stopPropagation()} />
        </Row>
        <Row label="Timeframe">
          <Select value={chart.timeframe} options={Object.keys(TIMEFRAMES).map((t) => ({ value: t, label: t }))} onChange={(v) => dispatch({ type: "chart/update", patch: { timeframe: v } })} />
        </Row>
        <Row label="Start (UTC)">
          <input
            className="txt"
            type="datetime-local"
            value={new Date(chart.startTime * 1000).toISOString().slice(0, 16)}
            onChange={(e) => {
              const v = Date.parse(`${e.target.value}:00Z`);
              if (Number.isFinite(v)) dispatch({ type: "chart/update", patch: { startTime: Math.floor(v / 1000) } }, { merge: "start" });
            }}
          />
        </Row>
      </Section>

      <Section title="Reveal animation">
        <Row label="Mode">
          <Select<RevealMode>
            value={chart.reveal.mode}
            options={[
              { value: "sequential", label: "Sequential" },
              { value: "cascade", label: "Cascade" },
              { value: "grow", label: "Grow from open" },
              { value: "fade", label: "Fade all" },
              { value: "none", label: "None" },
            ]}
            onChange={(mode) => dispatch({ type: "chart/update", patch: { reveal: { ...chart.reveal, mode } } })}
          />
        </Row>
        <Row label="Duration">
          <NumberField value={chart.reveal.duration} step={0.1} min={0} suffix="s" onChange={(duration) => dispatch({ type: "chart/update", patch: { reveal: { ...chart.reveal, duration } } }, { merge: "reveal-d" })} />
        </Row>
        <Row label="Easing">
          <Select<Easing> value={chart.reveal.easing} options={EASING_NAMES.map((e) => ({ value: e, label: EASING_LABELS[e] }))} onChange={(easing) => dispatch({ type: "chart/update", patch: { reveal: { ...chart.reveal, easing } } })} />
        </Row>
        <Row label="Layer start">
          <NumberField value={chart.start} step={0.1} min={0} suffix="s" onChange={(start) => dispatch({ type: "chart/update", patch: { start } }, { merge: "chart-start" })} />
        </Row>
      </Section>

      <Section title="Candle style">
        <Row label="Theme">
          <Select
            value={Object.entries(THEME_PRESETS).find(([, t]) => t.background === theme.background && t.bull === theme.bull)?.[0] ?? "custom"}
            options={[...Object.keys(THEME_PRESETS).map((k) => ({ value: k, label: k })), { value: "custom", label: "Custom" }]}
            onChange={(k) => THEME_PRESETS[k] && dispatch({ type: "theme/set", theme: THEME_PRESETS[k] })}
          />
        </Row>
        <Row label="Bull">
          <ColorField value={theme.bull} onChange={(v) => dispatch({ type: "theme/set", theme: { bull: v, bullWick: v, bullBorder: v } })} />
        </Row>
        <Row label="Bear">
          <ColorField value={theme.bear} onChange={(v) => dispatch({ type: "theme/set", theme: { bear: v, bearWick: v, bearBorder: v } })} />
        </Row>
        <Row label="Background">
          <ColorField value={theme.background} onChange={(v) => dispatch({ type: "theme/set", theme: { background: v } })} />
        </Row>
        <Row label="Body width">
          <NumberField value={chart.style.bodyWidth} step={0.05} min={0.1} max={1} onChange={(bodyWidth) => dispatch({ type: "chart/update", patch: { style: { ...chart.style, bodyWidth } } }, { merge: "bw" })} />
        </Row>
        <Row label="Wick">
          <NumberField value={chart.style.wickWidth} step={0.5} min={0.5} max={10} suffix="px" onChange={(wickWidth) => dispatch({ type: "chart/update", patch: { style: { ...chart.style, wickWidth } } }, { merge: "ww" })} />
        </Row>
        <Row label="Border">
          <NumberField value={chart.style.borderWidth} step={0.5} min={0} max={6} suffix="px" onChange={(borderWidth) => dispatch({ type: "chart/update", patch: { style: { ...chart.style, borderWidth } } }, { merge: "bdw" })} />
        </Row>
        <Row label="Hollow bull">
          <Toggle value={chart.style.hollowBull} onChange={(hollowBull) => dispatch({ type: "chart/update", patch: { style: { ...chart.style, hollowBull } } })} />
        </Row>
      </Section>
    </div>
  );
}
