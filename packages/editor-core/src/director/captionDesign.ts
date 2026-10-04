import { uid, type Project, type SceneObject } from "@tradeanim/project-schema";

export interface CaptionDesignOptions {
  enabled?: boolean;
  maxWords?: number;
  accent?: string;
}

function chunks(text: string, maxWords: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return [text.trim()];
  const count = Math.ceil(words.length / maxWords);
  const size = Math.ceil(words.length / count);
  return Array.from({ length: count }, (_, i) => words.slice(i * size, (i + 1) * size).join(" ")).filter(Boolean);
}

/**
 * Converts long subtitle cards into fast, editable phrase clips. The timing is
 * weighted by character count, which tracks speech more naturally than equal
 * slices without requiring word timestamps from the voice provider.
 */
export function applyAnimatedCaptions(project: Project, options: CaptionDesignOptions = {}): Project {
  if (options.enabled === false) return project;
  const maxWords = Math.max(2, Math.min(6, options.maxWords ?? 4));
  const accent = options.accent ?? project.theme.accent;
  const objects: SceneObject[] = [];

  for (const object of project.objects) {
    if (object.kind !== "caption") {
      objects.push(object);
      continue;
    }
    const parts = chunks(String(object.props.text ?? ""), maxWords);
    const weights = parts.map((part) => Math.max(2, [...part].length));
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
    const floor = Math.min(0.35, (object.duration / parts.length) * 0.7);
    const flexible = Math.max(0, object.duration - floor * parts.length);
    let cursor = object.start;

    parts.forEach((part, index) => {
      const remaining = object.start + object.duration - cursor;
      const weightedDuration = floor + flexible * (weights[index] / totalWeight);
      const duration = index === parts.length - 1 ? remaining : weightedDuration;
      const clip: SceneObject = {
        ...object,
        id: index === 0 ? object.id : uid("obj_"),
        name: `${object.name} · ${index + 1}`,
        start: +cursor.toFixed(3),
        duration: +Math.max(0.05, duration).toFixed(3),
        frame: object.frame ? { ...object.frame, y: 0.84, h: Math.max(0.09, object.frame.h) } : object.frame,
        props: { ...object.props, text: part, bgOpacity: 0.82, captionMotion: "phrase" },
        style: {
          ...object.style,
          textColor: index % 3 === 1 ? accent : object.style.textColor,
          fontSize: Math.max(38, object.style.fontSize),
          fontWeight: 800,
          shadow: Math.max(0.35, object.style.shadow),
        },
        animIn: { ...object.animIn, preset: "pop", duration: Math.min(0.22, Math.max(0.12, duration * 0.22)), easing: "backOut" },
        animOut: { ...object.animOut, preset: "fade", duration: Math.min(0.14, Math.max(0.08, duration * 0.18)), easing: "easeOut" },
        emphasis: { preset: "pulse", start: 0, duration: Math.min(0.3, duration), cycles: 1 },
      };
      objects.push(clip);
      cursor += duration;
    });
  }

  return {
    ...project,
    objects,
    meta: { ...project.meta, notes: [project.meta.notes, "Animated phrase captions enabled."].filter(Boolean).join(" ") },
  };
}
