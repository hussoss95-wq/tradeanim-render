"use client";

import { createObject, makeCompileCtx, type StoryBeat } from "@tradeanim/editor-core";
import { uid, type Asset, type Project } from "@tradeanim/project-schema";

type SfxKind = "whoosh" | "impact" | "click";

export interface GeneratedAudioOptions {
  includeSfx?: boolean;
  includeMusic?: boolean;
  voiceFocus?: boolean;
  style?: "cinematic" | "minimalExplainer";
}

function wavDataUrl(kind: SfxKind): string {
  const sampleRate = 22050;
  const duration = kind === "whoosh" ? 0.42 : kind === "impact" ? 0.24 : 0.1;
  const count = Math.floor(sampleRate * duration);
  const buffer = new ArrayBuffer(44 + count * 2);
  const view = new DataView(buffer);
  const write = (offset: number, value: string) => [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  write(0, "RIFF");
  view.setUint32(4, 36 + count * 2, true);
  write(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, count * 2, true);

  for (let i = 0; i < count; i++) {
    const t = i / sampleRate;
    const progress = i / count;
    const envelope = Math.pow(1 - progress, kind === "click" ? 8 : 2.2);
    let sample: number;
    if (kind === "whoosh") {
      const noise = Math.random() * 2 - 1;
      sample = noise * Math.sin(Math.PI * progress) * 0.42 + Math.sin(2 * Math.PI * (180 + 760 * progress) * t) * 0.08;
    } else if (kind === "impact") {
      sample = Math.sin(2 * Math.PI * (94 - 38 * progress) * t) * 0.75 + (Math.random() * 2 - 1) * 0.12;
    } else {
      sample = Math.sin(2 * Math.PI * 1200 * t) * 0.55;
    }
    view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, sample * envelope)) * 32767, true);
  }

  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return `data:audio/wav;base64,${btoa(binary)}`;
}

function musicDataUrl(duration: number, style: GeneratedAudioOptions["style"]): string {
  const sampleRate = 11025;
  const seconds = Math.max(1, Math.min(120, duration));
  const count = Math.floor(sampleRate * seconds);
  const buffer = new ArrayBuffer(44 + count * 2);
  const view = new DataView(buffer);
  const write = (offset: number, value: string) => [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  write(0, "RIFF");
  view.setUint32(4, 36 + count * 2, true);
  write(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, count * 2, true);

  const roots = style === "cinematic" ? [55, 49, 41.2, 46.25] : [110, 98, 82.4, 92.5];
  for (let i = 0; i < count; i++) {
    const t = i / sampleRate;
    const root = roots[Math.floor(t / 4) % roots.length];
    const pulse = Math.pow(Math.max(0, Math.sin(Math.PI * ((t % 1.8) / 1.8))), 2);
    const shimmer = Math.sin(2 * Math.PI * root * 2 * t) * 0.035 + Math.sin(2 * Math.PI * root * 3 * t) * 0.018;
    const bass = Math.sin(2 * Math.PI * root * t) * (style === "cinematic" ? 0.14 : 0.08);
    const fade = Math.min(1, t / 1.2, (seconds - t) / 1.2);
    view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, (bass + shimmer) * (0.42 + pulse * 0.58) * Math.max(0, fade))) * 32767, true);
  }
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return `data:audio/wav;base64,${btoa(binary)}`;
}

export function addGeneratedAudio(project: Project, storyboard: StoryBeat[], voiceDataUrl?: string, options: GeneratedAudioOptions = {}): Project {
  const { includeSfx = true, includeMusic = true, voiceFocus = true, style = "minimalExplainer" } = options;
  const next: Project = { ...project, assets: [...project.assets], objects: [...project.objects] };
  const ctx = makeCompileCtx(next);
  const addClip = (asset: Asset, start: number, duration: number, volume: number, name: string, role: "voice" | "music" | "sfx") => {
    next.assets.push(asset);
    const clip = createObject("audio", ctx, { start, duration, name, props: { assetId: asset.id, volume, offset: 0, role, ducking: voiceFocus } });
    next.objects.push(clip);
  };

  if (voiceDataUrl) {
    const asset: Asset = { id: uid("as_"), type: "audio", name: "AI Voice-over.mp3", src: voiceDataUrl };
    addClip(asset, 0, next.settings.duration, 1, "AI Voice-over", "voice");
  }

  if (includeMusic) {
    const asset: Asset = { id: uid("as_"), type: "audio", name: "AI Background Score.wav", src: musicDataUrl(next.settings.duration, style) };
    addClip(asset, 0, next.settings.duration, style === "cinematic" ? 0.22 : 0.16, "Music · AI background score", "music");
  }

  const kinds: SfxKind[] = ["impact", "whoosh", "click", "whoosh", "impact"];
  if (includeSfx) storyboard.slice(0, 5).forEach((beat, i) => {
    const kind = kinds[i];
    const asset: Asset = { id: uid("as_"), type: "audio", name: `AI ${kind} ${i + 1}.wav`, src: wavDataUrl(kind) };
    const duration = kind === "whoosh" ? 0.42 : kind === "impact" ? 0.24 : 0.1;
    addClip(asset, Math.max(0, beat.time), duration, kind === "impact" ? 0.2 : 0.14, `SFX · ${kind}`, "sfx");
  });
  return next;
}
