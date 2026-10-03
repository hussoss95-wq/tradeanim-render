"use client";

import { useEffect, useRef, useState } from "react";
import { compileRenderPlan } from "@tradeanim/editor-core";
import { sizeFor, validateProject } from "@tradeanim/project-schema";
import { CheckCircle2, Download, FileJson, FolderOpen, Loader2, Trash2, X, XCircle } from "lucide-react";
import { editor, useEditor } from "@/state/store";
import { cancelJob, getJob, health, startRender, type ProjectSummary, type RenderJob } from "@/lib/api";
import { deleteProject, downloadText, listProjects, openProject, importProjectJSON } from "@/lib/persistence";
import { Select } from "./ui";
import { API_URL } from "@/lib/config";

function Modal({ title, onClose, children, width = 520 }: { title: string; onClose: () => void; children: React.ReactNode; width?: number }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width }} role="dialog" aria-label={title}>
        <header>
          <h2>{title}</h2>
          <button className="tb-icon" onClick={onClose} title="Close (Esc)">
            <X size={15} />
          </button>
        </header>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export function Dialogs() {
  const dialog = useEditor((s) => s.dialog);
  const close = () => editor().setDialog(null);
  if (dialog === "export") return <ExportDialog onClose={close} />;
  if (dialog === "open") return <OpenDialog onClose={close} />;
  if (dialog === "shortcuts") return <ShortcutsDialog onClose={close} />;
  return null;
}

/* ------------------------------------------------------------- export */

function ExportDialog({ onClose }: { onClose: () => void }) {
  const project = useEditor((s) => s.project);
  const s = project.settings;
  const [api, setApi] = useState<Awaited<ReturnType<typeof health>> | "checking">("checking");
  const [short, setShort] = useState(String(Math.min(s.width, s.height)));
  const [fps, setFps] = useState(String(s.fps));
  const [quality, setQuality] = useState("standard");
  const [job, setJob] = useState<RenderJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const poll = useRef<number | null>(null);

  useEffect(() => {
    health().then(setApi);
    return () => {
      if (poll.current) window.clearInterval(poll.current);
    };
  }, []);

  const size = sizeFor(s.aspect, Number(short));
  const frames = Math.round(s.duration * Number(fps));
  const issues = validateProject(project);
  const running = job && (job.status === "queued" || job.status === "running");

  const render = async () => {
    setError(null);
    try {
      const plan = compileRenderPlan(project);
      const j = await startRender(plan, { width: size.width, height: size.height, fps: Number(fps), quality }, project);
      setJob(j);
      poll.current = window.setInterval(async () => {
        try {
          const next = await getJob(j.id);
          setJob(next);
          if (next.status !== "queued" && next.status !== "running") {
            window.clearInterval(poll.current!);
            poll.current = null;
            if (next.status === "done") editor().toast("MP4 rendered", "success");
          }
        } catch (err) {
          setError((err as Error).message);
        }
      }, 600);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <Modal title="Export video" onClose={onClose} width={560}>
      <div className={`api-status ${api === "checking" ? "" : api ? "ok" : "bad"}`}>
        {api === "checking" ? (
          <>
            <Loader2 size={14} className="spin" /> Checking render engine…
          </>
        ) : api ? (
          <>
            <CheckCircle2 size={14} /> Render engine online · v{api.version} · FFmpeg {api.ffmpeg ? "ready" : "missing"}
          </>
        ) : (
          <>
            <XCircle size={14} />
            {process.env.NODE_ENV === "production" ? (
              <>Render service unavailable — please try again in a moment.</>
            ) : (
              <>
                Render API offline at <code>{API_URL || "/api"}</code>. Start everything with <code>npm run dev</code>.
              </>
            )}
          </>
        )}
      </div>

      <div className="export-grid">
        <label>Resolution</label>
        <Select
          value={short}
          onChange={setShort}
          options={[
            { value: "540", label: `Draft 540p (${sizeFor(s.aspect, 540).width}×${sizeFor(s.aspect, 540).height})` },
            { value: "720", label: `720p (${sizeFor(s.aspect, 720).width}×${sizeFor(s.aspect, 720).height})` },
            { value: "1080", label: `1080p (${sizeFor(s.aspect, 1080).width}×${sizeFor(s.aspect, 1080).height})` },
            { value: "1440", label: `1440p (${sizeFor(s.aspect, 1440).width}×${sizeFor(s.aspect, 1440).height})` },
          ]}
        />
        <label>Frame rate</label>
        <Select value={fps} onChange={setFps} options={["24", "25", "30", "60"].map((f) => ({ value: f, label: `${f} fps` }))} />
        <label>Quality</label>
        <Select
          value={quality}
          onChange={setQuality}
          options={[
            { value: "draft", label: "Draft (fast, CRF 28)" },
            { value: "standard", label: "Standard (CRF 20)" },
            { value: "high", label: "High (CRF 16, slow preset)" },
          ]}
        />
        <label>Output</label>
        <span className="mono">
          {s.aspect} · {s.duration}s · {frames} frames · H.264 MP4
        </span>
      </div>

      {issues.length > 0 && (
        <div className="issues">
          {issues.map((i, n) => (
            <div key={n} className="issue">
              {i.path}: {i.message}
            </div>
          ))}
        </div>
      )}

      {job && (
        <div className="job">
          <div className="job-head">
            <span>
              {job.status === "done" ? "Done" : job.status === "error" ? "Failed" : job.status === "cancelled" ? "Cancelled" : job.message || "Rendering"}
            </span>
            <span className="mono muted">
              {job.frame}/{job.totalFrames} frames{job.elapsed ? ` · ${job.elapsed.toFixed(1)}s` : ""}
            </span>
          </div>
          <div className="progress">
            <div style={{ width: `${Math.round(job.progress * 100)}%` }} />
          </div>
          {job.status === "error" && <pre className="err">{job.error}</pre>}
          {job.status === "done" && job.url && (
            <>
              <video className="result" src={job.url} controls autoPlay muted loop />
              <a className="btn primary wide" href={`${job.url}?download=1`} download>
                <Download size={14} /> Download MP4
              </a>
            </>
          )}
        </div>
      )}
      {error && <pre className="err">{error}</pre>}

      <footer className="modal-foot">
        <button className="btn" onClick={() => downloadText(`${project.name}.renderplan.json`, JSON.stringify(compileRenderPlan(project), null, 2))} title="The exact document sent to the Python engine">
          <FileJson size={13} /> Render plan
        </button>
        <div className="tb-spacer" />
        {running ? (
          <button className="btn danger" onClick={() => job && cancelJob(job.id)}>
            Cancel
          </button>
        ) : (
          <button className="btn primary" disabled={!api || api === "checking" || issues.length > 0} onClick={render}>
            {job?.status === "done" ? "Render again" : "Render MP4"}
          </button>
        )}
      </footer>
    </Modal>
  );
}

/* ------------------------------------------------------------- open */

function OpenDialog({ onClose }: { onClose: () => void }) {
  const [list, setList] = useState<ProjectSummary[] | null>(null);
  const refresh = () => listProjects().then(setList);
  useEffect(() => {
    refresh();
  }, []);
  return (
    <Modal title="Open project" onClose={onClose} width={560}>
      <div className="proj-list">
        {list === null && (
          <div className="muted pad">
            <Loader2 size={14} className="spin" /> Loading…
          </div>
        )}
        {list?.length === 0 && <div className="muted pad">No saved projects yet. Use Save (Ctrl+S) to store the current project.</div>}
        {list?.map((p) => (
          <div key={`${p.source}-${p.id}`} className="proj-item">
            <button
              className="proj-open"
              onClick={async () => {
                try {
                  await openProject(p);
                  onClose();
                } catch (err) {
                  editor().toast((err as Error).message, "error");
                }
              }}
            >
              <FolderOpen size={14} />
              <span className="proj-name">{p.name}</span>
              <span className="muted small">
                {p.aspect ?? ""} {p.duration ? `· ${p.duration}s` : ""} · {p.source === "workspace" ? "workspace/projects" : "browser"} · {p.updatedAt ? new Date(p.updatedAt).toLocaleString() : ""}
              </span>
            </button>
            <button
              className="tb-icon danger"
              title="Delete saved copy"
              onClick={async () => {
                await deleteProject(p);
                refresh();
              }}
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </div>
      <footer className="modal-foot">
        <button
          className="btn"
          onClick={async () => {
            await importProjectJSON();
            onClose();
          }}
        >
          <FileJson size={13} /> Import JSON file…
        </button>
      </footer>
    </Modal>
  );
}

/* ------------------------------------------------------------- shortcuts */

const SHORTCUTS: [string, string][] = [
  ["Space", "Play / pause"],
  ["← / →", "Previous / next frame (Shift: 1s)"],
  ["Home / End", "Go to start / end"],
  ["V · H · C", "Select · Pan · Candle tool"],
  ["L · Z · R · A · O · F · P", "Trendline · Zone · Rectangle · Arrow · Circle · Fibonacci · Path"],
  ["T", "Add heading"],
  ["Esc", "Cancel tool / clear selection"],
  ["Delete / Backspace", "Delete selection"],
  ["Ctrl+D", "Duplicate"],
  ["Ctrl+C / Ctrl+V", "Copy / paste"],
  ["Ctrl+Z / Ctrl+Shift+Z", "Undo / redo"],
  ["Ctrl+S / Ctrl+O", "Save / open"],
  ["Ctrl+A", "Select all objects"],
  ["Arrows (with selection)", "Nudge (Shift ×10)"],
  ["Ctrl+] / Ctrl+[", "Bring to front / send to back"],
  ["K", "Camera keyframe at playhead"],
  ["M", "Marker at playhead"],
  ["Wheel", "Zoom chart (Ctrl: time only, Alt: price only, Shift: pan)"],
  ["Middle-drag / Alt-drag", "Pan chart"],
  ["Drag price / time axis", "Scale axis"],
  ["Double-click empty chart", "Fit chart"],
  ["Ctrl+wheel on timeline", "Zoom timeline"],
];

function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Keyboard shortcuts" onClose={onClose} width={560}>
      <div className="shortcuts">
        {SHORTCUTS.map(([k, d]) => (
          <div key={k} className="sc-row">
            <kbd>{k}</kbd>
            <span>{d}</span>
          </div>
        ))}
      </div>
    </Modal>
  );
}

export function Toasts() {
  const toasts = useEditor((s) => s.toasts);
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} onClick={() => editor().dismissToast(t.id)}>
          {t.text}
        </div>
      ))}
    </div>
  );
}
