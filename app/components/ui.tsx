"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { parseDate } from "../lib/core/dates";
import { formatMoney } from "../lib/core/model";

export const money = formatMoney;

const shortFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const monthYearFormat = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric" });
const fullFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });

type DateLike = Date | string | null | undefined;
const toDate = (value: DateLike) => (typeof value === "string" ? parseDate(value) : value || null);

export const shortDate = (value: DateLike) => { const date = toDate(value); return date ? shortFormat.format(date) : "—"; };
export const monthYear = (value: DateLike) => { const date = toDate(value); return date ? monthYearFormat.format(date) : "—"; };
export const fullDate = (value: DateLike) => { const date = toDate(value); return date ? fullFormat.format(date) : "—"; };

export function inDays(days: number) {
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  return days < 0 ? `${-days}d ago` : `in ${days}d`;
}

const PERSON_TONES = ["tone-0", "tone-1"];

/** Stable color for a cardholder, by their position in the household. */
export function personTone(sort: number) {
  return PERSON_TONES[sort % PERSON_TONES.length];
}

export function Dot({ name, tone, large }: { name: string; tone: string; large?: boolean }) {
  return <span className={`dot ${tone}`} aria-hidden="true" style={large ? { width: 32, height: 32, fontSize: 14 } : undefined}>{name.slice(0, 1).toUpperCase()}</span>;
}

export function Tag({ tone, title, children }: { tone?: "alert" | "due" | "ok"; title?: string; children: ReactNode }) {
  return <span className={`tag ${tone || ""}`} title={title}>{children}</span>;
}

export const CheckIcon = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
);

export function Drawer({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLElement>("input, select, button")?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); previous?.focus?.(); };
  }, [onClose]);
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={title} ref={panel}>
        <div className="drawer-head"><h2>{title}</h2><button type="button" className="btn small" onClick={onClose}>Close</button></div>
        <div className="drawer-body">{children}</div>
        {footer && <div className="drawer-foot">{footer}</div>}
      </aside>
    </>
  );
}

export type ToastMessage = { id: number; text: string; undo?: () => void; error?: boolean };

export function Toast({ toast, onDone }: { toast: ToastMessage | null; onDone: () => void }) {
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(onDone, toast.error ? 8000 : 5000);
    return () => clearTimeout(timer);
  }, [toast, onDone]);
  if (!toast) return null;
  return (
    <div className="toast" role={toast.error ? "alert" : "status"} style={toast.error ? { background: "var(--alert)" } : undefined}>
      <span>{toast.text}</span>
      {toast.undo && <button type="button" onClick={() => { toast.undo?.(); onDone(); }}>Undo</button>}
    </div>
  );
}

/** Dollar input helpers: the UI edits dollars, the database stores cents. */
export const toCents = (value: string) => Math.round(Number(value || 0) * 100);
export const toDollarsInput = (cents: number | null | undefined) => (cents ? String(cents / 100) : "");
