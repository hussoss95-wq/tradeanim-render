"use client";

import type { RenderPlan } from "@tradeanim/editor-core";
import type { Project } from "@tradeanim/project-schema";
import { apiUrl } from "./config";

/** Render/project API (FastAPI) at NEXT_PUBLIC_API_URL. */

let csrfToken = "";

function mutationHeaders(jsonBody = false): HeadersInit {
  return {
    ...(jsonBody ? { "content-type": "application/json" } : {}),
    ...(csrfToken ? { "x-csrf-token": csrfToken } : {}),
  };
}

export interface AccountUser { id: string; email: string; name: string; verified: boolean }

interface AuthResponse { user: AccountUser; csrfToken: string }

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
    const r = await fetch(apiUrl("/api/health"), { signal: ctl.signal, cache: "no-store", credentials: "include" });
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
    headers: mutationHeaders(true),
    credentials: "include",
    body: JSON.stringify({ plan, options: opts, project }),
  });
  return withAbsoluteUrl(await json<RenderJob>(r));
}

function withAbsoluteUrl(job: RenderJob): RenderJob {
  return job.url ? { ...job, url: apiUrl(job.url) } : job;
}

export async function getJob(id: string): Promise<RenderJob> {
  return withAbsoluteUrl(await json<RenderJob>(await fetch(apiUrl(`/api/render/${id}`), { cache: "no-store", credentials: "include" })));
}

export async function cancelJob(id: string): Promise<void> {
  await fetch(apiUrl(`/api/render/${id}/cancel`), { method: "POST", headers: mutationHeaders(), credentials: "include" });
}

export async function apiListProjects(): Promise<ProjectSummary[]> {
  const r = await fetch(apiUrl("/api/projects"), { cache: "no-store", credentials: "include" });
  const list = await json<Omit<ProjectSummary, "source">[]>(r);
  return list.map((p) => ({ ...p, source: "workspace" as const }));
}

export async function apiGetProject(id: string): Promise<unknown> {
  return json(await fetch(apiUrl(`/api/projects/${encodeURIComponent(id)}`), { cache: "no-store", credentials: "include" }));
}

export async function apiSaveProject(p: Project): Promise<{ id: string; path: string }> {
  const r = await fetch(apiUrl(`/api/projects/${encodeURIComponent(p.id)}`), {
    method: "PUT",
    headers: mutationHeaders(true),
    credentials: "include",
    body: JSON.stringify(p),
  });
  return json(r);
}

export async function apiDeleteProject(id: string): Promise<void> {
  await json(await fetch(apiUrl(`/api/projects/${encodeURIComponent(id)}`), { method: "DELETE", headers: mutationHeaders(), credentials: "include" }));
}

export type VoiceId = "ar-IQ-BasselNeural" | "ar-SA-ZariyahNeural" | "en-US-GuyNeural" | "en-US-JennyNeural";

export async function generateVoice(text: string, voice: VoiceId): Promise<string> {
  const r = await fetch(apiUrl("/api/voice"), {
    method: "POST",
    headers: mutationHeaders(true),
    credentials: "include",
    body: JSON.stringify({ text, voice }),
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

export async function getCurrentUser(): Promise<AccountUser | null> {
  const r = await fetch(apiUrl("/api/auth/me"), { cache: "no-store", credentials: "include" });
  if (r.status === 401) return null;
  const body = await json<AuthResponse>(r);
  csrfToken = body.csrfToken;
  return body.user;
}

export async function loginAccount(email: string, password: string): Promise<AccountUser> {
  const body = await json<AuthResponse>(await fetch(apiUrl("/api/auth/login"), {
    method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }),
  }));
  csrfToken = body.csrfToken;
  return body.user;
}

export async function registerAccount(name: string, email: string, password: string): Promise<AccountUser> {
  const body = await json<AuthResponse>(await fetch(apiUrl("/api/auth/register"), {
    method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, email, password }),
  }));
  csrfToken = body.csrfToken;
  return body.user;
}

export async function logoutAccount(): Promise<void> {
  await json(await fetch(apiUrl("/api/auth/logout"), { method: "POST", credentials: "include", headers: mutationHeaders() }));
  csrfToken = "";
}

export async function resendVerification(): Promise<void> {
  await json(await fetch(apiUrl("/api/auth/email/verify/request"), { method: "POST", credentials: "include", headers: mutationHeaders() }));
}

export async function confirmEmail(token: string): Promise<void> {
  await json(await fetch(apiUrl("/api/auth/email/verify/confirm"), {
    method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }),
  }));
}

export async function requestPasswordReset(email: string): Promise<void> {
  await json(await fetch(apiUrl("/api/auth/password/forgot"), {
    method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }),
  }));
}

export async function confirmPasswordReset(token: string, password: string): Promise<void> {
  await json(await fetch(apiUrl("/api/auth/password/reset"), {
    method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, password }),
  }));
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  await json(await fetch(apiUrl("/api/auth/password/change"), {
    method: "POST", credentials: "include", headers: mutationHeaders(true), body: JSON.stringify({ currentPassword, newPassword }),
  }));
  csrfToken = "";
}

export async function deleteAccount(password: string): Promise<void> {
  await json(await fetch(apiUrl("/api/auth/account"), {
    method: "DELETE", credentials: "include", headers: mutationHeaders(true), body: JSON.stringify({ password }),
  }));
  csrfToken = "";
}

export interface UnderstoodBrief {
  style: "minimalExplainer" | "cinematic";
  direction: "bullish" | "bearish" | "neutral";
  aspect: "16:9" | "9:16" | "1:1" | "4:5";
  duration: number;
  symbol: "EURUSD" | "GBPUSD" | "XAUUSD" | "BTCUSD" | "NQ" | "ES" | "US30";
  language: "ar" | "en";
  topic: "backtest" | "risk" | "candleClose" | "liquiditySweep" | "smcSetup" | "custom";
  include: { sweep: boolean; cisd: boolean; fvg: boolean; orderBlock: boolean; position: boolean; captions: boolean };
  creativeNotes: string;
}

export async function understandDirectorPrompt(prompt: string, overrides: Record<string, unknown>): Promise<UnderstoodBrief> {
  return json(await fetch(apiUrl("/api/director/understand"), {
    method: "POST", credentials: "include", headers: mutationHeaders(true), body: JSON.stringify({ prompt, overrides }),
  }));
}
