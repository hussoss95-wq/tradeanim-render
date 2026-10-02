"use client";

import { create } from "zustand";
import { produce, freeze } from "immer";
import {
  applyCommand,
  describeCommand,
  type EditorCommand,
} from "@tradeanim/editor-core";
import { migrateProject, type CameraState, type ObjectKind, type Project, type SceneObject } from "@tradeanim/project-schema";

export type ToolId = "select" | "hand" | "candle" | ObjectKind;

export type PanelId = "tools" | "smc" | "text" | "candles" | "media" | "camera" | "effects" | "audio" | "ai" | "project";

export type ViewMode = "camera" | "free";

const HISTORY_LIMIT = 200;
const MERGE_WINDOW_MS = 800;

interface HistoryEntry {
  project: Project;
  label: string;
}

export interface Toast {
  id: number;
  text: string;
  kind: "info" | "success" | "error";
}

export interface EditorState {
  project: Project;
  past: HistoryEntry[];
  future: HistoryEntry[];
  /** id that changes on every committed edit (autosave / dirty tracking) */
  revision: number;
  savedRevision: number;

  selection: string[];
  candleSelection: string[];
  keyframeSelection: string[];

  tool: ToolId;
  /** keep tool active after placing (shift-locked) */
  toolSticky: boolean;
  panel: PanelId;
  paletteOpen: boolean;
  viewMode: ViewMode;
  freeCam: CameraState | null;
  snap: boolean;
  previewMode: boolean;
  clipboard: SceneObject[] | null;
  toasts: Toast[];
  dialog: null | "export" | "open" | "shortcuts";

  dispatch: (cmd: EditorCommand, opts?: { merge?: string }) => void;
  beginGesture: () => void;
  updateGesture: (cmd: EditorCommand) => void;
  endGesture: (label?: string) => void;
  cancelGesture: () => void;
  undo: () => void;
  redo: () => void;
  loadProject: (p: unknown, opts?: { keepHistory?: boolean }) => void;
  markSaved: () => void;

  select: (ids: string[], mode?: "set" | "add" | "toggle") => void;
  selectCandles: (ids: string[], mode?: "set" | "add" | "toggle") => void;
  selectKeyframes: (ids: string[]) => void;
  clearSelection: () => void;

  setTool: (tool: ToolId, sticky?: boolean) => void;
  setPanel: (panel: PanelId) => void;
  togglePalette: () => void;
  setViewMode: (m: ViewMode) => void;
  setFreeCam: (c: CameraState | null) => void;
  setSnap: (v: boolean) => void;
  setPreviewMode: (v: boolean) => void;
  setClipboard: (objs: SceneObject[] | null) => void;
  setDialog: (d: EditorState["dialog"]) => void;
  toast: (text: string, kind?: Toast["kind"]) => void;
  dismissToast: (id: number) => void;
}

let gestureBase: Project | null = null;
let lastMerge: { key: string; at: number } | null = null;
let toastSeq = 1;

function stamp(p: Project): Project {
  return produce(p, (d) => {
    d.updatedAt = new Date().toISOString();
  });
}

const createEditorStore = () =>
  create<EditorState>((set, get) => ({
  project: freeze(migrateProject({}), true),
  past: [],
  future: [],
  revision: 0,
  savedRevision: 0,

  selection: [],
  candleSelection: [],
  keyframeSelection: [],

  tool: "select",
  toolSticky: false,
  panel: "tools",
  paletteOpen: true,
  viewMode: "camera",
  freeCam: null,
  snap: true,
  previewMode: false,
  clipboard: null,
  toasts: [],
  dialog: null,

  dispatch: (cmd, opts) => {
    const { project, past } = get();
    let next: Project;
    try {
      next = produce(project, (d) => applyCommand(d, cmd));
    } catch (err) {
      console.error("command failed", cmd, err);
      get().toast(`Edit failed: ${(err as Error).message}`, "error");
      return;
    }
    if (next === project) return;
    const now = Date.now();
    const merge = opts?.merge && lastMerge && lastMerge.key === opts.merge && now - lastMerge.at < MERGE_WINDOW_MS;
    lastMerge = opts?.merge ? { key: opts.merge, at: now } : null;
    set({
      project: stamp(next),
      past: merge ? past : [...past.slice(-HISTORY_LIMIT + 1), { project, label: describeCommand(cmd) }],
      future: [],
      revision: get().revision + 1,
    });
    pruneSelection(get, set);
  },

  // Gestures (drags) preview live without history and commit as one undo step.
  beginGesture: () => {
    gestureBase = get().project;
  },
  updateGesture: (cmd) => {
    if (!gestureBase) gestureBase = get().project;
    const base = gestureBase;
    try {
      set({ project: produce(base, (d) => applyCommand(d, cmd)) });
    } catch (err) {
      console.error(err);
    }
  },
  endGesture: (label = "Edit") => {
    const base = gestureBase;
    gestureBase = null;
    const { project, past } = get();
    if (!base || base === project) return;
    lastMerge = null;
    set({
      project: stamp(project),
      past: [...past.slice(-HISTORY_LIMIT + 1), { project: base, label }],
      future: [],
      revision: get().revision + 1,
    });
  },
  cancelGesture: () => {
    if (gestureBase) set({ project: gestureBase });
    gestureBase = null;
  },

  undo: () => {
    const { past, future, project } = get();
    const prev = past[past.length - 1];
    if (!prev) return;
    lastMerge = null;
    set({
      project: prev.project,
      past: past.slice(0, -1),
      future: [{ project, label: prev.label }, ...future],
      revision: get().revision + 1,
    });
    pruneSelection(get, set);
  },
  redo: () => {
    const { past, future, project } = get();
    const next = future[0];
    if (!next) return;
    lastMerge = null;
    set({
      project: next.project,
      past: [...past, { project, label: next.label }],
      future: future.slice(1),
      revision: get().revision + 1,
    });
    pruneSelection(get, set);
  },

  loadProject: (p, opts) => {
    const project = freeze(migrateProject(p), true);
    set({
      project,
      past: opts?.keepHistory ? [...get().past, { project: get().project, label: "Load project" }] : [],
      future: [],
      selection: [],
      candleSelection: [],
      keyframeSelection: [],
      revision: get().revision + 1,
      savedRevision: get().revision + 1,
      freeCam: null,
    });
  },
  markSaved: () => set({ savedRevision: get().revision }),

  select: (ids, mode = "set") => {
    const cur = get().selection;
    let next: string[];
    if (mode === "set") next = ids;
    else if (mode === "add") next = [...new Set([...cur, ...ids])];
    else {
      next = [...cur];
      for (const id of ids) next = next.includes(id) ? next.filter((x) => x !== id) : [...next, id];
    }
    set({ selection: next, candleSelection: mode === "set" ? [] : get().candleSelection, keyframeSelection: [] });
  },
  selectCandles: (ids, mode = "set") => {
    const cur = get().candleSelection;
    let next: string[];
    if (mode === "set") next = ids;
    else if (mode === "add") next = [...new Set([...cur, ...ids])];
    else {
      next = [...cur];
      for (const id of ids) next = next.includes(id) ? next.filter((x) => x !== id) : [...next, id];
    }
    set({ candleSelection: next, selection: mode === "set" ? [] : get().selection, keyframeSelection: [] });
  },
  selectKeyframes: (ids) => set({ keyframeSelection: ids, selection: [], candleSelection: [] }),
  clearSelection: () => set({ selection: [], candleSelection: [], keyframeSelection: [] }),

  setTool: (tool, sticky = false) => set({ tool, toolSticky: sticky }),
  setPanel: (panel) => set({ panel, paletteOpen: get().panel === panel ? !get().paletteOpen : true }),
  togglePalette: () => set({ paletteOpen: !get().paletteOpen }),
  setViewMode: (viewMode) => set({ viewMode }),
  setFreeCam: (freeCam) => set({ freeCam }),
  setSnap: (snap) => set({ snap }),
  setPreviewMode: (previewMode) => set({ previewMode }),
  setClipboard: (clipboard) => set({ clipboard }),
  setDialog: (dialog) => set({ dialog }),
  toast: (text, kind = "info") => {
    const id = toastSeq++;
    set({ toasts: [...get().toasts, { id, text, kind }] });
    setTimeout(() => get().dismissToast(id), kind === "error" ? 6000 : 3200);
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));

// Keep one store across hot reloads: re-creating it would swap the open project for an empty one.
const g = globalThis as unknown as { __tradeanimEditor?: ReturnType<typeof createEditorStore> };
export const useEditor = (g.__tradeanimEditor ??= createEditorStore());

function pruneSelection(get: () => EditorState, set: (s: Partial<EditorState>) => void) {
  const { project, selection, candleSelection, keyframeSelection } = get();
  const objIds = new Set(project.objects.map((o) => o.id));
  const cIds = new Set(project.chart.candles.map((c) => c.id));
  const kIds = new Set(project.camera.keyframes.map((k) => k.id));
  const s = selection.filter((id) => objIds.has(id));
  const c = candleSelection.filter((id) => cIds.has(id));
  const k = keyframeSelection.filter((id) => kIds.has(id));
  if (s.length !== selection.length || c.length !== candleSelection.length || k.length !== keyframeSelection.length)
    set({ selection: s, candleSelection: c, keyframeSelection: k });
}

/** Imperative accessor for event handlers. */
export const editor = () => useEditor.getState();
