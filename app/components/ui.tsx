"use client";

import { useEffect, useEffectEvent, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";

import { useDialogFocus } from "./useDialogFocus";

const PERSON_TONES = ["tone-0", "tone-1"];

/** Stable color for a cardholder, by their position in the household. */
export function personTone(sort: number) {
  return PERSON_TONES[sort % PERSON_TONES.length];
}

export function Dot({ name, tone }: { name: string; tone: string }) {
  return <span className={`dot ${tone}`} aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>;
}

/**
 * A two-press button for destructive actions: the first press asks (`confirmText`), the second
 * runs `onConfirm`. The question resets after a few seconds. `label` is the accessible name,
 * like "Delete Hilton".
 */
export function ConfirmButton({ label, onConfirm, children = "Delete", confirmText = "Sure?", className = "btn small danger", disabled, style }: {
  label: string; onConfirm: () => void; children?: ReactNode; confirmText?: string; className?: string; disabled?: boolean; style?: CSSProperties;
}) {
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    if (!confirm) return;
    const timer = setTimeout(() => setConfirm(false), 4000);
    return () => clearTimeout(timer);
  }, [confirm]);
  return (
    <button type="button" className={className} style={style} disabled={disabled} aria-label={confirm ? `Confirm ${label.charAt(0).toLowerCase()}${label.slice(1)}` : label}
      onClick={() => { if (!confirm) { setConfirm(true); return; } setConfirm(false); onConfirm(); }}>
      {confirm ? confirmText : children}
    </button>
  );
}

export function Tag({ tone, title, children }: { tone?: "alert" | "due" | "ok" | "info" | "kept"; title?: string; children: ReactNode }) {
  return <span className={`tag ${tone || ""}`} title={title}>{children}</span>;
}

export const CheckIcon = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
);

export function Drawer({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const panel = useRef<HTMLElement>(null);
  const titleId = useId();
  useDialogFocus(panel, onClose);
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, []);
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={panel} tabIndex={-1}>
        <div className="drawer-head"><h2 id={titleId}>{title}</h2><button type="button" className="btn small" onClick={onClose}>Close</button></div>
        <div className="drawer-body">{children}</div>
        {footer && <div className="drawer-foot">{footer}</div>}
      </aside>
    </>
  );
}

export type ToastMessage = { id: number; text: string; undo?: () => void; error?: boolean };

export function Toast({ toast, onDone }: { toast: ToastMessage | null; onDone: () => void }) {
  const done = useEffectEvent(onDone);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => done(), toast.error ? 8000 : 5000);
    return () => clearTimeout(timer);
  }, [toast]);
  if (!toast) return null;
  return (
    <div className="toast" role={toast.error ? "alert" : "status"} style={toast.error ? { background: "var(--alert)" } : undefined}>
      <span>{toast.text}</span>
      {toast.undo && <button type="button" onClick={() => { toast.undo?.(); onDone(); }}>Undo</button>}
    </div>
  );
}
