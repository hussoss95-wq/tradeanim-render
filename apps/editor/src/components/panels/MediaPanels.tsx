"use client";

import { uid, type Asset } from "@tradeanim/project-schema";
import { ImagePlus, Music, Upload } from "lucide-react";
import { editor, useEditor } from "@/state/store";
import { insertObject } from "@/lib/actions";
import { pickFile, readAsDataURL } from "@/lib/persistence";

const MAX_BYTES = 12 * 1024 * 1024;

async function importAsset(type: Asset["type"]): Promise<Asset | null> {
  const f = await pickFile(type === "image" ? "image/png,image/jpeg,image/webp,image/svg+xml" : "audio/*");
  if (!f) return null;
  if (f.size > MAX_BYTES) {
    editor().toast("File too large (max 12 MB — assets are embedded in the project)", "error");
    return null;
  }
  const src = await readAsDataURL(f);
  const asset: Asset = { id: uid("as_"), type, name: f.name, src };
  if (type === "image") {
    const dims = await new Promise<{ w: number; h: number }>((res) => {
      const img = new Image();
      img.onload = () => res({ w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => res({ w: 1, h: 1 });
      img.src = src;
    });
    asset.width = dims.w;
    asset.height = dims.h;
  }
  editor().dispatch({ type: "assets/add", asset });
  return asset;
}

function insertImage(asset: Asset, kind: "image" | "logo") {
  const s = editor();
  const o = insertObject(kind, { props: { assetId: asset.id } });
  if (asset.width && asset.height && o.frame) {
    const { width, height } = s.project.settings;
    // keep the image's aspect inside the frame box
    const h = (o.frame.w * width * asset.height) / asset.width / height;
    s.dispatch({ type: "objects/update", id: o.id, patch: { frame: { ...o.frame, h } } });
  }
}

export function MediaPanel() {
  const allAssets = useEditor((s) => s.project.assets);
  const assets = allAssets.filter((a) => a.type === "image");
  return (
    <>
      <div className="pal-head">
        <h3>Media</h3>
        <p>Images and logos are embedded in the project file and rendered in the MP4.</p>
      </div>
      <div className="btn-row">
        <button
          className="btn"
          onClick={async () => {
            const a = await importAsset("image");
            if (a) insertImage(a, "image");
          }}
        >
          <ImagePlus size={13} /> Image
        </button>
        <button
          className="btn"
          onClick={async () => {
            const a = await importAsset("image");
            if (a) insertImage(a, "logo");
          }}
        >
          <Upload size={13} /> Logo
        </button>
      </div>
      <div className="pal-sub">Library</div>
      <div className="asset-grid">
        {assets.map((a) => (
          <button key={a.id} className="asset" title={`${a.name} — click to place`} onClick={() => insertImage(a, "image")}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={a.src} alt={a.name} />
          </button>
        ))}
        {!assets.length && <div className="muted pad">No images yet.</div>}
      </div>
    </>
  );
}

export function AudioPanel() {
  const objects = useEditor((s) => s.project.objects);
  const clips = objects.filter((o) => o.kind === "audio");
  const assets = useEditor((s) => s.project.assets);
  return (
    <>
      <div className="pal-head">
        <h3>Audio</h3>
        <p>Music, voice-over and SFX. Previewed in sync with the playhead and muxed into the exported MP4.</p>
      </div>
      <div className="btn-row">
        <button
          className="btn wide"
          onClick={async () => {
            const a = await importAsset("audio");
            if (a) {
              const s = editor();
              const o = insertObject("audio", { props: { assetId: a.id }, start: 0 });
              s.dispatch({ type: "objects/update", id: o.id, patch: { name: a.name, duration: s.project.settings.duration } });
            }
          }}
        >
          <Music size={13} /> Add audio file
        </button>
      </div>
      <div className="pal-sub">Clips</div>
      <div className="kf-list">
        {clips.map((c) => (
          <button key={c.id} className="kf-item" onClick={() => editor().select([c.id])}>
            <Music size={11} />
            <span>{c.name}</span>
            <span className="muted mono">{c.start.toFixed(1)}s</span>
          </button>
        ))}
        {!clips.length && <div className="muted pad">No audio clips.</div>}
      </div>
      <div className="pal-note">
        AI Director can generate voice-over and transition SFX automatically. You can still add or replace any clip here ({assets.filter((a) => a.type === "audio").length} audio assets).
      </div>
    </>
  );
}
