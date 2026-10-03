"use client";

import { migrateProject, validateProject, type Project } from "@tradeanim/project-schema";
import { editor } from "@/state/store";
import { apiDeleteProject, apiGetProject, apiListProjects, apiSaveProject, type ProjectSummary } from "./api";

const AUTOSAVE_KEY = "tradeanim.autosave.v1";
const LIBRARY_KEY = "tradeanim.library.v1";

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function readAutosave(): Project | null {
  const raw = safeGet(AUTOSAVE_KEY);
  if (!raw) return null;
  try {
    return migrateProject(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function writeAutosave(p: Project) {
  safeSet(AUTOSAVE_KEY, JSON.stringify(p));
}

function readLibrary(): Record<string, Project> {
  try {
    return JSON.parse(safeGet(LIBRARY_KEY) ?? "{}");
  } catch {
    return {};
  }
}

/** Save: workspace folder via the API when available, browser library as fallback. */
export async function saveProject(): Promise<"workspace" | "browser"> {
  const s = editor();
  const p = s.project;
  const issues = validateProject(p);
  if (issues.length) console.warn("project validation", issues);
  try {
    const r = await apiSaveProject(p);
    s.markSaved();
    s.toast(`Saved · ${r.path}`, "success");
    return "workspace";
  } catch {
    const lib = readLibrary();
    lib[p.id] = p;
    if (!safeSet(LIBRARY_KEY, JSON.stringify(lib))) throw new Error("Browser storage is full");
    s.markSaved();
    s.toast("Saved in this browser — use File › Export project JSON to keep a copy", "success");
    return "browser";
  }
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const out: ProjectSummary[] = [];
  try {
    out.push(...(await apiListProjects()));
  } catch {
    /* API offline */
  }
  const lib = readLibrary();
  for (const p of Object.values(lib)) {
    if (out.some((x) => x.id === p.id)) continue;
    out.push({ id: p.id, name: p.name, updatedAt: p.updatedAt, source: "browser", aspect: p.settings?.aspect, duration: p.settings?.duration });
  }
  return out.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
}

export async function openProject(summary: ProjectSummary) {
  const s = editor();
  const raw = summary.source === "workspace" ? await apiGetProject(summary.id) : readLibrary()[summary.id];
  if (!raw) throw new Error("Project not found");
  s.loadProject(raw);
  s.toast(`Opened “${summary.name}”`, "success");
}

export async function deleteProject(summary: ProjectSummary) {
  if (summary.source === "workspace") await apiDeleteProject(summary.id);
  else {
    const lib = readLibrary();
    delete lib[summary.id];
    safeSet(LIBRARY_KEY, JSON.stringify(lib));
  }
}

export function downloadText(name: string, text: string, type = "application/json") {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function exportProjectJSON() {
  const p = editor().project;
  const slug = p.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "project";
  downloadText(`${slug}.algoliquid.json`, JSON.stringify(p, null, 2));
  editor().toast("Project JSON exported", "success");
}

export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
}

export async function importProjectJSON() {
  const f = await pickFile(".json,application/json");
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    editor().loadProject(data, { keepHistory: true });
    editor().toast(`Imported “${f.name}”`, "success");
  } catch (err) {
    editor().toast(`Import failed: ${(err as Error).message}`, "error");
  }
}

export function readAsDataURL(f: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(f);
  });
}
