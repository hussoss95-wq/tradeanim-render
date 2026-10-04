"use client";

import { useState } from "react";
import { applyAnimatedCaptions, buildDirectorContent, parseBrief, templateDirector, type DirectorLanguage, type DirectorStyle, type StoryBeat } from "@tradeanim/editor-core";
import { Play, Sparkles } from "lucide-react";
import { editor } from "@/state/store";
import { playback } from "@/state/playback";
import { Row, Select, Slider } from "../ui";
import { generateVoice, type VoiceId } from "@/lib/api";
import { addGeneratedAudio } from "@/lib/soundDesign";

const EXAMPLES: { prompt: string; style: DirectorStyle }[] = [
  { prompt: "أنشئ فيديو عمودي 30 ثانية يشرح طريقة عمل باك تيست احترافي للاستراتيجية على 100 صفقة، بخلفية بيضاء نظيفة بدون شبكة.", style: "minimalExplainer" },
  { prompt: "Create a 30-second vertical minimal trading explainer about waiting for candle closes, clean white background, no grid.", style: "minimalExplainer" },
  { prompt: "Create a 30-second vertical video showing a bearish liquidity sweep, CISD confirmation and FVG entry.", style: "cinematic" },
  { prompt: "Bullish sell-side sweep on XAUUSD with order block and long entry, 20 seconds", style: "cinematic" },
  { prompt: "Square 15s NQ short: sweep of equal highs then FVG retrace", style: "cinematic" },
];

export function AIPanel() {
  const [prompt, setPrompt] = useState(EXAMPLES[0].prompt);
  const [style, setStyle] = useState<DirectorStyle>("minimalExplainer");
  const [language, setLanguage] = useState<DirectorLanguage>("ar");
  const [voice, setVoice] = useState<VoiceId | "none">("ar-IQ-BasselNeural");
  const [voiceRate, setVoiceRate] = useState(4);
  const [voicePitch, setVoicePitch] = useState(0);
  const [previewing, setPreviewing] = useState(false);
  const [includeSfx, setIncludeSfx] = useState(true);
  const [includeMusic, setIncludeMusic] = useState(true);
  const [animatedCaptions, setAnimatedCaptions] = useState(true);
  const [voiceFocus, setVoiceFocus] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [story, setStory] = useState<StoryBeat[] | null>(null);
  const brief = parseBrief(prompt, { style, language });

  const run = async () => {
    setBusy(true);
    try {
      setStatus("Building script and scenes…");
      const res = await templateDirector.generate(brief);
      let voiceDataUrl: string | undefined;
      let voiceFailed = false;
      if (voice !== "none") {
        setStatus("Generating AI voice-over…");
        try {
          voiceDataUrl = await generateVoice(buildDirectorContent(brief).narration, voice, { rate: voiceRate, pitch: voicePitch });
        } catch {
          voiceFailed = true;
        }
      }
      setStatus("Adding sound design…");
      const captioned = applyAnimatedCaptions(res.project, { enabled: animatedCaptions, maxWords: language === "ar" ? 3 : 4 });
      const project = addGeneratedAudio(captioned, res.storyboard, voiceDataUrl, { includeSfx, includeMusic, voiceFocus, style });
      editor().loadProject(project, { keepHistory: true });
      setStory(res.storyboard);
      playback().setTime(0);
      editor().toast(voiceFailed ? "Video created with SFX — voice service was unavailable" : "Full video created — press Space to play", voiceFailed ? "info" : "success");
    } catch (err) {
      editor().toast(`Director failed: ${(err as Error).message}`, "error");
    } finally {
      setBusy(false);
      setStatus("");
    }
  };

  const previewVoice = async () => {
    if (voice === "none" || previewing) return;
    setPreviewing(true);
    try {
      const sample = language === "ar"
        ? "في هذا الفيديو سنختبر الاستراتيجية خطوة بخطوة، ونراجع النتائج بوضوح."
        : "In this video, we will test the strategy step by step and review the results clearly.";
      const src = await generateVoice(sample, voice, { rate: voiceRate, pitch: voicePitch });
      await new Audio(src).play();
    } catch (err) {
      editor().toast(`Voice preview failed: ${(err as Error).message}`, "error");
    } finally {
      setPreviewing(false);
    }
  };

  return (
    <>
      <div className="pal-head">
        <h3>AI Director</h3>
        <p>Write one prompt. The Director builds a complete editable video: script, scenes, chart, captions, camera, voice-over, SFX and timing.</p>
      </div>
      <div className="pad-x">
        <Select<DirectorStyle>
          value={style}
          options={[
            { value: "minimalExplainer", label: "Minimal Explainer · clean" },
            { value: "cinematic", label: "Cinematic SMC · dark" },
          ]}
          onChange={setStyle}
        />
        <div className="btn-row">
          <Select<DirectorLanguage>
            value={language}
            options={[{ value: "ar", label: "Arabic video" }, { value: "en", label: "English video" }]}
            onChange={(next) => {
              setLanguage(next);
              setVoice(next === "ar" ? "ar-IQ-BasselNeural" : "en-US-GuyNeural");
            }}
          />
          <Select<VoiceId | "none">
            value={voice}
            options={language === "ar" ? [
              { value: "ar-IQ-BasselNeural", label: "Iraqi · Bassel" },
              { value: "ar-IQ-RanaNeural", label: "Iraqi · Rana" },
              { value: "ar-SA-HamedNeural", label: "Saudi · Hamed" },
              { value: "ar-SA-ZariyahNeural", label: "Saudi · Zariyah" },
              { value: "ar-EG-ShakirNeural", label: "Egyptian · Shakir" },
              { value: "ar-EG-SalmaNeural", label: "Egyptian · Salma" },
              { value: "ar-AE-HamdanNeural", label: "Emirati · Hamdan" },
              { value: "ar-AE-FatimaNeural", label: "Emirati · Fatima" },
              { value: "none", label: "No voice" },
            ] : [
              { value: "en-US-GuyNeural", label: "English male" },
              { value: "en-US-JennyNeural", label: "English female" },
              { value: "none", label: "No voice" },
            ]}
            onChange={setVoice}
          />
        </div>
        <div className="voice-studio">
          <div className="voice-studio-head">
            <span>Voice Studio</span>
            <button className="btn tiny" disabled={voice === "none" || previewing} onClick={previewVoice} type="button">
              <Play size={11} /> {previewing ? "Loading…" : "Preview"}
            </button>
          </div>
          <Row label={`Pace ${voiceRate >= 0 ? "+" : ""}${voiceRate}%`}>
            <Slider value={voiceRate} min={-25} max={50} step={1} onChange={setVoiceRate} />
          </Row>
          <Row label={`Tone ${voicePitch >= 0 ? "+" : ""}${voicePitch}Hz`}>
            <Slider value={voicePitch} min={-10} max={10} step={1} onChange={setVoicePitch} />
          </Row>
        </div>
        <label className="check-row">
          <input type="checkbox" checked={includeSfx} onChange={(e) => setIncludeSfx(e.target.checked)} />
          <span>Add automatic sound effects</span>
        </label>
        <label className="check-row">
          <input type="checkbox" checked={includeMusic} onChange={(e) => setIncludeMusic(e.target.checked)} />
          <span>Add adaptive background score</span>
        </label>
        <label className="check-row">
          <input type="checkbox" checked={voiceFocus} onChange={(e) => setVoiceFocus(e.target.checked)} />
          <span>Voice Focus · automatically duck music</span>
        </label>
        <label className="check-row">
          <input type="checkbox" checked={animatedCaptions} onChange={(e) => setAnimatedCaptions(e.target.checked)} />
          <span>Animated phrase captions</span>
        </label>
        <textarea className="txt prompt" rows={5} value={prompt} onChange={(e) => setPrompt(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
        <div className="brief">
          <span className="pill">{brief.direction}</span>
          <span className="pill">{brief.aspect}</span>
          <span className="pill">{brief.duration}s</span>
          <span className="pill">{brief.symbol}</span>
          <span className="pill">{brief.style === "minimalExplainer" ? "clean edit" : "cinematic"}</span>
          {Object.entries(brief.include)
            .filter(([, v]) => v)
            .map(([k]) => (
              <span key={k} className="pill dim">
                {k}
              </span>
            ))}
        </div>
        <button className="btn primary wide" disabled={busy || !prompt.trim()} onClick={run}>
          <Sparkles size={14} /> {busy ? "Generating…" : "Generate full video"}
        </button>
        {status && <p className="pal-note">{status}</p>}
        <p className="pal-note">Replaces the current project (undo with Ctrl+Z).</p>
      </div>
      <div className="pal-sub">Examples</div>
      <div className="pad-x examples">
        {EXAMPLES.map((example) => (
          <button
            key={example.prompt}
            className="example"
            onClick={() => {
              setPrompt(example.prompt);
              setStyle(example.style);
              const nextLanguage = /[\u0600-\u06ff]/.test(example.prompt) ? "ar" : "en";
              setLanguage(nextLanguage);
              setVoice(nextLanguage === "ar" ? "ar-IQ-BasselNeural" : "en-US-GuyNeural");
            }}
          >
            {example.prompt}
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
