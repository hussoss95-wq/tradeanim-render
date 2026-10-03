import { uid, type Candle } from "@tradeanim/project-schema";

export class CandleImportError extends Error {}

const num = (v: unknown) => {
  const n = typeof v === "number" ? v : Number(String(v).replace(/[, _]/g, ""));
  return Number.isFinite(n) ? n : NaN;
};

function toTime(v: unknown): number | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  if (Number.isFinite(n)) return n > 1e12 ? Math.floor(n / 1000) : n; // ms -> s
  const d = Date.parse(String(v).includes("T") || String(v).includes("Z") ? String(v) : `${v}Z`);
  return Number.isFinite(d) ? Math.floor(d / 1000) : undefined;
}

function build(o: number, h: number, l: number, c: number, v?: number, time?: number): Candle {
  if (![o, h, l, c].every(Number.isFinite)) throw new CandleImportError("Non-numeric OHLC value");
  return { id: uid("c_"), o, h: Math.max(h, o, c), l: Math.min(l, o, c), c, v: Number.isFinite(v) ? v : undefined, time };
}

const ALIASES: Record<string, string[]> = {
  time: ["date", "datetime", "timestamp", "time", "dt"],
  o: ["open", "o"],
  h: ["high", "h"],
  l: ["low", "l"],
  c: ["close", "c", "adj close"],
  v: ["volume", "vol", "v"],
};

function splitRow(line: string): string[] {
  if (line.includes("\t")) return line.split("\t");
  if (line.includes(",") && !/^\s*[\d.]+,\d{3}/.test(line)) return line.split(",");
  if (line.includes(";")) return line.split(";");
  return line.trim().split(/\s+/);
}

/** CSV/TSV with a header row (auto-detected columns), or headerless O,H,L,C[,V]. */
export function parseCSV(text: string): Candle[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  if (!lines.length) throw new CandleImportError("No rows found");
  const first = splitRow(lines[0]).map((s) => s.trim().toLowerCase().replace(/^"|"$/g, ""));
  const hasHeader = first.some((h) => Number.isNaN(Number(h)) && !/^\d{4}-\d{2}-\d{2}/.test(h));
  if (!hasHeader) return parsePasted(text);
  const col: Record<string, number> = {};
  for (const [key, names] of Object.entries(ALIASES)) {
    const idx = first.findIndex((h) => names.includes(h));
    if (idx >= 0) col[key] = idx;
  }
  for (const k of ["o", "h", "l", "c"]) if (col[k] === undefined) throw new CandleImportError(`Missing column for ${k.toUpperCase()}`);
  return lines.slice(1).map((line) => {
    const cells = splitRow(line).map((s) => s.trim().replace(/^"|"$/g, ""));
    return build(num(cells[col.o]), num(cells[col.h]), num(cells[col.l]), num(cells[col.c]), col.v !== undefined ? num(cells[col.v]) : undefined, col.time !== undefined ? toTime(cells[col.time]) : undefined);
  });
}

/** JSON: array of {open,high,low,close} / {o,h,l,c} objects or [o,h,l,c] / [time,o,h,l,c] arrays. */
export function parseJSON(text: string): Candle[] {
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new CandleImportError("Invalid JSON");
  }
  if (data && !Array.isArray(data)) data = data.candles ?? data.data ?? data.chart?.candles;
  if (!Array.isArray(data)) throw new CandleImportError("Expected an array of candles");
  return data.map((row: any) => {
    if (Array.isArray(row)) {
      if (row.length >= 5) return build(num(row[1]), num(row[2]), num(row[3]), num(row[4]), num(row[5]), toTime(row[0]));
      return build(num(row[0]), num(row[1]), num(row[2]), num(row[3]));
    }
    const g = (k: string) => {
      for (const name of [k, ...(ALIASES[k] ?? [])]) {
        if (row[name] !== undefined) return row[name];
        const cap = name.charAt(0).toUpperCase() + name.slice(1);
        if (row[cap] !== undefined) return row[cap];
      }
      return undefined;
    };
    return build(num(g("o")), num(g("h")), num(g("l")), num(g("c")), num(g("v")), toTime(g("time")));
  });
}

/** Pasted numbers: one candle per line, "O H L C" (any separator), optional leading time. */
export function parsePasted(text: string): Candle[] {
  const rows = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!rows.length) throw new CandleImportError("Nothing to import");
  return rows.map((line, i) => {
    const cells = splitRow(line).map((s) => s.trim()).filter(Boolean);
    const nums = cells.map(num);
    // 5+ columns: leading date/unix-time column, otherwise O H L C V
    const timeFirst = nums.length >= 5 && (!Number.isFinite(nums[0]) || nums[0] > 1e8);
    if (timeFirst) return build(nums[1], nums[2], nums[3], nums[4], nums[5], toTime(cells[0]));
    if (nums.length >= 4) return build(nums[0], nums[1], nums[2], nums[3], nums[4]);
    throw new CandleImportError(`Line ${i + 1}: expected O H L C`);
  });
}

/** Detect format and parse. */
export function parseCandles(text: string): Candle[] {
  const t = text.trim();
  if (t.startsWith("[") || t.startsWith("{")) return parseJSON(t);
  return parseCSV(t);
}

export function candlesToCSV(candles: Candle[]): string {
  return ["open,high,low,close,volume", ...candles.map((c) => `${c.o},${c.h},${c.l},${c.c},${c.v ?? ""}`)].join("\n");
}
