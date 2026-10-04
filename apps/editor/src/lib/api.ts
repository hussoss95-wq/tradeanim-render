"use client";

import type { RenderPlan } from "@tradeanim/editor-core";
import type { Project } from "@tradeanim/project-schema";
import { apiUrl } from "./config";

/** Render/project API (FastAPI) at NEXT_PUBLIC_API_URL. */

export interface RenderJob {
  id: string;
  status: "queued" | "running" | "done" | "error" | "cancelled";
  progress: number;
  frame: number;
  totalFrames: number;
  message?: string;
  error?: string;
  url?: string;
  createdAt: number;
  elapsed?: number;
}

export interface ProjectSummary {
  id: string;
  name: string;
  updatedAt: string;
  source: "workspace" | "browser";
  aspect?: string;
  duration?: number;
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      msg = body.detail ? (typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail)) : msg;
    } catch {
      /* not json */
    }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export async function health(): Promise<{ ok: boolean; ffmpeg: string | boolean | null; version: string; projectStorage?: boolean } | null> {
  try {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 2500);
    const r = await fetch(apiUrl("/api/health"), { signal: ctl.signal, cache: "no-store" });
    clearTimeout(to);
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

export async function startRender(plan: RenderPlan, opts: { width: number; height: number; fps: number; quality: string }, project?: Project): Promise<RenderJob> {
  const r = await fetch(apiUrl("/api/render"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ plan, options: opts, project }),
  });
  return withAbsoluteUrl(await json<RenderJob>(r));
}

function withAbsoluteUrl(job: RenderJob): RenderJob {
  return job.url ? { ...job, url: apiUrl(job.url) } : job;
}

export async function getJob(id: string): Promise<RenderJob> {
  return withAbsoluteUrl(await json<RenderJob>(await fetch(apiUrl(`/api/render/${id}`), { cache: "no-store" })));
}

export async function cancelJob(id: string): Promise<void> {
  await fetch(apiUrl(`/api/render/${id}/cancel`), { method: "POST" });
}

export async function apiListProjects(): Promise<ProjectSummary[]> {
  const r = await fetch(apiUrl("/api/projects"), { cache: "no-store" });
  const list = await json<Omit<ProjectSummary, "source">[]>(r);
  return list.map((p) => ({ ...p, source: "workspace" as const }));
}

export async function apiGetProject(id: string): Promise<unknown> {
  return json(await fetch(apiUrl(`/api/projects/${encodeURIComponent(id)}`), { cache: "no-store" }));
}

export async function apiSaveProject(p: Project): Promise<{ id: string; path: string }> {
  const r = await fetch(apiUrl(`/api/projects/${encodeURIComponent(p.id)}`), {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(p),
  });
  return json(r);
}

export async function apiDeleteProject(id: string): Promise<void> {
  await fetch(apiUrl(`/api/projects/${encodeURIComponent(id)}`), { method: "DELETE" });
}

export type VoiceId =
  | "ar-IQ-BasselNeural"
  | "ar-IQ-RanaNeural"
  | "ar-SA-HamedNeural"
  | "ar-SA-ZariyahNeural"
  | "ar-EG-ShakirNeural"
  | "ar-EG-SalmaNeural"
  | "ar-AE-HamdanNeural"
  | "ar-AE-FatimaNeural"
  | "en-US-GuyNeural"
  | "en-US-JennyNeural";

export interface VoiceOptions {
  rate?: number;
  pitch?: number;
}

export async function generateVoice(text: string, voice: VoiceId, options: VoiceOptions = {}): Promise<string> {
  const r = await fetch(apiUrl("/api/voice"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text, voice, rate: options.rate ?? 0, pitch: options.pitch ?? 0 }),
  });
  if (!r.ok) {
    let message = `Voice service error (${r.status})`;
    try {
      const body = await r.json();
      if (body.detail) message = String(body.detail);
    } catch {
      // Keep the status message for non-JSON failures.
    }
    throw new Error(message);
  }
  const blob = await r.blob();
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read generated voice"));
    reader.readAsDataURL(blob);
  });
}
