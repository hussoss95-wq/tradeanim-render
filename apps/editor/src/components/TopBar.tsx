"use client";

import { useEffect, useRef, useState } from "react";
import { ASPECT_PRESETS, RESOLUTION_PRESETS, createEmptyProject, sizeFor, type AspectRatio } from "@tradeanim/project-schema";
import { Clapperboard, Download, FilePlus2, FileJson, FolderOpen, Keyboard, MonitorPlay, Redo2, Save, Undo2, Upload, ChevronDown } from "lucide-react";
import { editor, useEditor } from "@/state/store";
import { playback } from "@/state/playback";
import { exportProjectJSON, importProjectJSON, saveProject } from "@/lib/persistence";
import { NumberField } from "./ui";
import { demoProject } from "@/state/demo";

export function TopBar() {
  const name = useEditor((s) => s.project.name);
  const settings = useEditor((s) => s.project.settings);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const undoLabel = useEditor((s) => s.past[s.past.length - 1]?.label);
  const redoLabel = useEditor((s) => s.future[0]?.label);
  const dirty = useEditor((s) => s.revision !== s.savedRevision);
  const previewMode = useEditor((s) => s.previewMode);
  const dispatch = useEditor((s) => s.dispatch);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const h = (e: PointerEvent) => menuRef.current && !menuRef.current.contains(e.target as Node) && setMenu(false);
    window.addEventListener("pointerdown", h, true);
    return () => window.removeEventListener("pointerdown", h, true);
  }, [menu]);

  const shortSide = Math.min(settings.width, settings.height);

  const setAspect = (aspect: AspectRatio) => {
    const { width, height } = sizeFor(aspect, shortSide);
    dispatch({ type: "settings/update", patch: { aspect, width, height } });
  };
  const setRes = (short: number) => dispatch({ type: "settings/update", patch: sizeFor(settings.aspect, short) });

  const fileItems: { label: string; icon: React.ReactNode; kbd?: string; run: () => void }[] = [
    { label: "New project", icon: <FilePlus2 size={14} />, run: () => editor().loadProject(createEmptyProject({ aspect: settings.aspect }), { keepHistory: true }) },
    { label: "New from demo scene", icon: <Clapperboard size={14} />, run: () => editor().loadProject(demoProject(), { keepHistory: true }) },
    { label: "Open…", icon: <FolderOpen size={14} />, kbd: "Ctrl+O", run: () => editor().setDialog("open") },
    { label: "Save", icon: <Save size={14} />, kbd: "Ctrl+S", run: () => void saveProject() },
    { label: "Import project JSON…", icon: <Upload size={14} />, run: () => void importProjectJSON() },
    { label: "Export project JSON", icon: <FileJson size={14} />, run: exportProjectJSON },
    { label: "Keyboard shortcuts", icon: <Keyboard size={14} />, kbd: "?", run: () => editor().setDialog("shortcuts") },
  ];

  return (
    <header className="topbar">
      <div className="brand" title="tradeanim studio">
        <span className="brand-mark">
          <i />
          <i />
          <i />
        </span>
        <span className="brand-name">tradeanim</span>
      </div>
      <div className="tb-menu" ref={menuRef}>
        <button className="tb-btn" onClick={() => setMenu(!menu)}>
          File <ChevronDown size={12} />
        </button>
        {menu && (
          <div className="dropdown">
            {fileItems.map((it) => (
              <button
                key={it.label}
                onClick={() => {
                  setMenu(false);
                  it.run();
                }}
              >
                {it.icon}
                <span>{it.label}</span>
                {it.kbd && <kbd>{it.kbd}</kbd>}
              </button>
            ))}
          </div>
        )}
      </div>
      <input
        className="project-name"
        value={name}
        onChange={(e) => dispatch({ type: "project/rename", name: e.target.value }, { merge: "rename" })}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        spellCheck={false}
      />
      <span className={`save-dot${dirty ? " dirty" : ""}`} title={dirty ? "Unsaved changes (autosaved locally)" : "Saved"} />
      <div className="tb-sep" />
      <button className="tb-icon" disabled={!canUndo} onClick={() => editor().undo()} title={`Undo ${undoLabel ?? ""} (Ctrl+Z)`}>
        <Undo2 size={15} />
      </button>
      <button className="tb-icon" disabled={!canRedo} onClick={() => editor().redo()} title={`Redo ${redoLabel ?? ""} (Ctrl+Shift+Z)`}>
        <Redo2 size={15} />
      </button>
      <div className="tb-sep" />
      <button className="tb-btn" onClick={() => void saveProject()} title="Save (Ctrl+S)">
        <Save size={14} /> Save
      </button>
      <button className="tb-btn" onClick={() => editor().setDialog("open")} title="Open / load a project (Ctrl+O)">
        <FolderOpen size={14} /> Load
      </button>

      <div className="tb-spacer" />

      <div className="tb-group" title="Aspect ratio">
        <span className="tb-label">Aspect</span>
        <select className="sel tb-sel" value={settings.aspect} onChange={(e) => setAspect(e.target.value as AspectRatio)}>
          {(Object.keys(ASPECT_PRESETS) as AspectRatio[]).map((a) => (
            <option key={a} value={a}>
              {a} · {ASPECT_PRESETS[a].label}
            </option>
          ))}
        </select>
      </div>
      <div className="tb-group" title="Output resolution">
        <span className="tb-label">Res</span>
        <select className="sel tb-sel" value={RESOLUTION_PRESETS.find((r) => r.short === shortSide) ? String(shortSide) : "custom"} onChange={(e) => setRes(Number(e.target.value))}>
          {RESOLUTION_PRESETS.map((r) => (
            <option key={r.short} value={r.short}>
              {r.label}
            </option>
          ))}
          {!RESOLUTION_PRESETS.find((r) => r.short === shortSide) && <option value="custom">Custom</option>}
        </select>
        <span className="tb-dim mono">
          {settings.width}×{settings.height}
        </span>
      </div>
      <div className="tb-group" title="Frames per second">
        <span className="tb-label">FPS</span>
        <select className="sel tb-sel" value={settings.fps} onChange={(e) => dispatch({ type: "settings/update", patch: { fps: Number(e.target.value) } })}>
          {[24, 25, 30, 50, 60].map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      </div>
      <div className="tb-group" title="Duration (seconds)">
        <span className="tb-label">Dur</span>
        <NumberField value={settings.duration} step={0.5} min={1} max={600} suffix="s" width={70} onChange={(v) => dispatch({ type: "settings/update", patch: { duration: v } }, { merge: "duration" })} />
      </div>

      <div className="tb-spacer" />

      <button
        className={`tb-btn${previewMode ? " active" : ""}`}
        onClick={() => {
          const s = editor();
          const next = !s.previewMode;
          s.setPreviewMode(next);
          if (next) {
            s.setViewMode("camera");
            if (playback().time >= s.project.settings.duration - 0.05) playback().setTime(0);
            playback().play();
          } else playback().pause();
        }}
        title="Preview: clean camera-view playback (Esc to exit)"
      >
        <MonitorPlay size={14} /> {previewMode ? "Exit Preview" : "Preview"}
      </button>
      <button className="tb-btn primary" onClick={() => editor().setDialog("export")} title="Render MP4 with the Python engine">
        <Download size={14} /> Export
      </button>
    </header>
  );
}
