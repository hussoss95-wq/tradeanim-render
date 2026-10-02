import { createEmptyProject } from "./defaults";
import { PROJECT_SCHEMA_ID, PROJECT_SCHEMA_VERSION, TRACK_ORDER, type Project } from "./types";

export class ProjectFormatError extends Error {}

type Migration = (doc: any) => any;

/**
 * Ordered migrations: MIGRATIONS[n] upgrades a version-n document to n+1.
 * Add one entry per schema bump; never edit an existing entry.
 */
const MIGRATIONS: Record<number, Migration> = {
  // 0 -> 1: pre-release documents had no `meta`/`markers` and no track state.
  0: (doc) => ({ ...doc, version: 1, meta: doc.meta ?? {}, markers: doc.markers ?? [] }),
};

/**
 * Accepts any JSON value that claims to be a project, upgrades it to the
 * current schema version and fills fields added since it was written.
 */
export function migrateProject(input: unknown): Project {
  if (!input || typeof input !== "object") throw new ProjectFormatError("Project must be a JSON object");
  let doc: any = { ...(input as any) };
  if (doc.schema !== undefined && doc.schema !== PROJECT_SCHEMA_ID) {
    throw new ProjectFormatError(`Unknown schema "${doc.schema}"`);
  }
  let version = typeof doc.version === "number" ? doc.version : 0;
  if (version > PROJECT_SCHEMA_VERSION) {
    throw new ProjectFormatError(
      `Project version ${version} is newer than this editor supports (${PROJECT_SCHEMA_VERSION})`,
    );
  }
  while (version < PROJECT_SCHEMA_VERSION) {
    const step = MIGRATIONS[version];
    if (!step) throw new ProjectFormatError(`No migration from version ${version}`);
    doc = step(doc);
    version = doc.version;
  }
  return fillDefaults(doc);
}

/** Deep-fill missing fields from a fresh project so older/partial docs load safely. */
function fillDefaults(doc: any): Project {
  const base = createEmptyProject();
  const out: Project = {
    ...base,
    ...doc,
    schema: PROJECT_SCHEMA_ID,
    version: PROJECT_SCHEMA_VERSION,
    settings: { ...base.settings, ...(doc.settings ?? {}) },
    theme: { ...base.theme, ...(doc.theme ?? {}) },
    chart: {
      ...base.chart,
      ...(doc.chart ?? {}),
      style: { ...base.chart.style, ...(doc.chart?.style ?? {}) },
      reveal: { ...base.chart.reveal, ...(doc.chart?.reveal ?? {}) },
      candles: Array.isArray(doc.chart?.candles) ? doc.chart.candles : [],
    },
    camera: {
      base: { ...base.camera.base, ...(doc.camera?.base ?? {}) },
      keyframes: Array.isArray(doc.camera?.keyframes) ? doc.camera.keyframes : [],
    },
    objects: Array.isArray(doc.objects) ? doc.objects : [],
    markers: Array.isArray(doc.markers) ? doc.markers : [],
    assets: Array.isArray(doc.assets) ? doc.assets : [],
    meta: { ...(doc.meta ?? {}) },
  };
  const tracks = Array.isArray(doc.tracks) ? doc.tracks : [];
  out.tracks = TRACK_ORDER.map(
    (kind) => tracks.find((t: any) => t.kind === kind) ?? { kind, visible: true, locked: false, collapsed: false },
  );
  return out;
}
