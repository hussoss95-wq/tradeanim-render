"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

export function Section({ title, children, defaultOpen = true, right }: { title: string; children: React.ReactNode; defaultOpen?: boolean; right?: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="ins-section">
      <header onClick={() => setOpen(!open)}>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span>{title}</span>
        <div className="ins-section-right" onClick={(e) => e.stopPropagation()}>
          {right}
        </div>
      </header>
      {open && <div className="ins-body">{children}</div>}
    </section>
  );
}

export function Row({ label, children, title }: { label: string; children: React.ReactNode; title?: string }) {
  return (
    <div className="ins-row" title={title}>
      <label>{label}</label>
      <div className="ins-ctl">{children}</div>
    </div>
  );
}

/**
 * Numeric input with drag-to-scrub on its label/handle (like AE / Figma).
 * `onChange` fires live; `merge` lets the store coalesce scrub steps into one undo.
 */
export function NumberField({
  value,
  onChange,
  step = 1,
  min,
  max,
  precision,
  suffix,
  width,
  title,
}: {
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  precision?: number;
  suffix?: string;
  width?: number;
  title?: string;
}) {
  const decimals = precision ?? (step >= 1 ? 0 : Math.min(6, Math.ceil(-Math.log10(step))));
  const fmt = (v: number) => (Number.isFinite(v) ? v.toFixed(decimals) : "");
  const [text, setText] = useState(fmt(value));
  const focused = useRef(false);
  const scrub = useRef<{ x: number; v: number } | null>(null);

  useEffect(() => {
    if (!focused.current) setText(fmt(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, decimals]);

  const clamp = (v: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));
  const commit = (s: string) => {
    const v = Number(s.replace(",", "."));
    if (Number.isFinite(v)) onChange(clamp(v));
    else setText(fmt(value));
  };

  return (
    <div className="num" style={width ? { width } : undefined} title={title}>
      <span
        className="num-grip"
        onPointerDown={(e) => {
          e.preventDefault();
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          scrub.current = { x: e.clientX, v: value };
        }}
        onPointerMove={(e) => {
          if (!scrub.current) return;
          const k = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
          const v = clamp(scrub.current.v + Math.round((e.clientX - scrub.current.x) / 3) * step * k);
          onChange(+v.toFixed(Math.max(decimals, 0) + 2));
        }}
        onPointerUp={() => (scrub.current = null)}
      >
        ⋮
      </span>
      <input
        value={text}
        onFocus={(e) => {
          focused.current = true;
          e.target.select();
        }}
        onBlur={(e) => {
          focused.current = false;
          commit(e.target.value);
        }}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") {
            setText(fmt(value));
            (e.target as HTMLInputElement).blur();
          }
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            const k = (e.shiftKey ? 10 : 1) * (e.key === "ArrowUp" ? 1 : -1);
            const v = clamp(value + step * k);
            onChange(+v.toFixed(decimals + 2));
            setText(fmt(v));
          }
        }}
      />
      {suffix && <span className="num-suffix">{suffix}</span>}
    </div>
  );
}

export function TextField({ value, onChange, placeholder, multiline }: { value: string; onChange: (v: string) => void; placeholder?: string; multiline?: boolean }) {
  if (multiline)
    return <textarea className="txt" rows={2} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />;
  return <input className="txt" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />;
}

export function Select<T extends string>({ value, options, onChange, width }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; width?: number }) {
  return (
    <select className="sel" style={width ? { width } : undefined} value={value} onChange={(e) => onChange(e.target.value as T)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Toggle({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button className={`tgl${value ? " on" : ""}`} onClick={() => onChange(!value)} type="button">
      <span className="tgl-knob" />
      {label && <span className="tgl-label">{label}</span>}
    </button>
  );
}

/** Colour swatch + hex input. Accepts #rgb/#rrggbb/#rrggbbaa (alpha preserved). */
export function ColorField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const hex6 = /^#[0-9a-f]{6}/i.test(value) ? value.slice(0, 7) : "#ffffff";
  const alpha = /^#[0-9a-f]{8}$/i.test(value) ? value.slice(7) : "";
  const [text, setText] = useState(value);
  // re-sync the draft when the value changes from outside (React "derive from props" pattern)
  const [synced, setSynced] = useState(value);
  if (synced !== value) {
    setSynced(value);
    setText(value);
  }
  return (
    <div className="color">
      <label className="swatch" style={{ background: value }}>
        <input type="color" value={hex6} onChange={(e) => onChange(e.target.value + alpha)} />
      </label>
      <input
        className="txt mono"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => (/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(text) ? onChange(text) : setText(value))}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
      />
    </div>
  );
}

export function Slider({ value, onChange, min = 0, max = 1, step = 0.01 }: { value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number }) {
  return (
    <div className="slider">
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <span className="mono">{value.toFixed(step < 0.1 ? 2 : 1)}</span>
    </div>
  );
}

export function Seg<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: React.ReactNode; title?: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button key={o.value} className={o.value === value ? "on" : ""} title={o.title} onClick={() => onChange(o.value)} type="button">
          {o.label}
        </button>
      ))}
    </div>
  );
}
