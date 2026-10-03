"use client";

import { useState } from "react";
import { parseBrief, templateDirector, type StoryBeat } from "@tradeanim/editor-core";
import { Sparkles } from "lucide-react";
import { editor } from "@/state/store";
import { playback } from "@/state/playback";

const EXAMPLES = [
  "Create a 30-second vertical video showing a bearish liquidity sweep, CISD confirmation and FVG entry.",
  "Bullish sell-side sweep on XAUUSD with order block and long entry, 20 seconds",
  "Square 15s NQ short: sweep of equal highs then FVG retrace",
];

export function AIPanel() {
  const [prompt, setPrompt] = useState(EXAMPLES[0]);
  const [busy, setBusy] = useState(false);
  const [story, setStory] = useState<StoryBeat[] | null>(null);
  const brief = parseBrief(prompt);

  const run = async () => {
    setBusy(true);
    try {
      const res = await templateDirector.generate(brief);
      editor().loadProject(res.project, { keepHistory: true });
      setStory(res.storyboard);
      playback().setTime(0);
      editor().toast("Scene generated — press Space to play", "success");
    } catch (err) {
      editor().toast(`Director failed: ${(err as Error).message}`, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="pal-head">
        <h3>AI Director</h3>
        <p>Describe the video. The offline template engine builds candles, structure, SMC objects, camera, captions and timing. An LLM engine plugs into the same contract later.</p>
      </div>
      <div className="pad-x">
        <textarea className="txt prompt" rows={5} value={prompt} onChange={(e) => setPrompt(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
        <div className="brief">
          <span className="pill">{brief.direction}</span>
          <span className="pill">{brief.aspect}</span>
          <span className="pill">{brief.duration}s</span>
          <span className="pill">{brief.symbol}</span>
          {Object.entries(brief.include)
            .filter(([, v]) => v)
            .map(([k]) => (
              <span key={k} className="pill dim">
                {k}
              </span>
            ))}
        </div>
        <button className="btn primary wide" disabled={busy || !prompt.trim()} onClick={run}>
          <Sparkles size={14} /> {busy ? "Generating…" : "Generate scene"}
        </button>
        <p className="pal-note">Replaces the current project (undo with Ctrl+Z).</p>
      </div>
      <div className="pal-sub">Examples</div>
      <div className="pad-x examples">
        {EXAMPLES.map((e) => (
          <button key={e} className="example" onClick={() => setPrompt(e)}>
            {e}
          </button>
        ))}
      </div>
      {story && (
        <>
          <div className="pal-sub">Storyboard</div>
          <div className="pad-x story">
            {story.map((b, i) => (
              <button key={i} className="beat" onClick={() => playback().setTime(b.time)}>
                <span className="mono">{b.time.toFixed(1)}s</span>
                <span>{b.beat}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );
}
