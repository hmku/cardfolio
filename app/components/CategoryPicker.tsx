"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { CategoryKind } from "../lib/core/finance";
import type { Category } from "../lib/finance-data";

export const KIND_LABELS: Record<CategoryKind, string> = { income: "Income", expense: "Spending", transfer: "Transfers (never in cash flow)" };
const KIND_ORDER: CategoryKind[] = ["expense", "income", "transfer"];

/** "🛒 Groceries", or "Uncategorized". */
export function categoryLabel(category: Category | null | undefined) {
  if (!category) return "Uncategorized";
  return category.emoji ? `${category.emoji} ${category.name}` : category.name;
}

/**
 * A searchable category choice: a button showing the current category that opens a filter box
 * and the categories grouped by kind. Arrow keys move through the list, Enter picks the highlighted
 * one (the first category shown, to start with); Escape closes.
 */
export function CategoryPicker({ categories, value, onChange, label, allowNone, placeholder, autoOpen, disabled }: {
  categories: Category[];
  value: number | null;
  onChange: (id: number | null) => void;
  label: string;
  /** Offer "Uncategorized" as a choice. */
  allowNone?: boolean;
  /** Button text when nothing is picked yet (instead of "Uncategorized"). */
  placeholder?: string;
  autoOpen?: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(Boolean(autoOpen));
  const [query, setQuery] = useState("");
  const [active, setActive] = useState<number | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  useEffect(() => { if (open) input.current?.focus(); }, [open]);
  const words = query.trim().toLowerCase();
  const matches = categories.filter((category) => !words || category.name.toLowerCase().includes(words));
  // In the order shown: grouped by kind, then the categories' own order.
  const groups = KIND_ORDER.map((kind) => ({ kind, list: matches.filter((category) => category.kind === kind) })).filter((group) => group.list.length);
  const showNone = Boolean(allowNone && !words);
  const choices: (number | null)[] = [...(showNone ? [null] : []), ...groups.flatMap((group) => group.list.map((category) => category.id))];
  const firstCategory = showNone && choices.length > 1 ? 1 : 0;
  const activeIndex = choices.length ? Math.min(active ?? firstCategory, choices.length - 1) : -1;
  const optionId = (id: number | null) => `${listId}-${id ?? "none"}`;
  const activeId = activeIndex >= 0 ? optionId(choices[activeIndex]) : undefined;
  useEffect(() => { if (activeId && active !== null) document.getElementById(activeId)?.scrollIntoView({ block: "nearest" }); }, [activeId, active]);
  const current = value === null ? null : categories.find((category) => category.id === value);
  const close = () => { setOpen(false); setQuery(""); setActive(null); };
  const choose = (id: number | null) => { onChange(id); close(); };

  if (!open) {
    return (
      <button type="button" className="btn category-button" disabled={disabled} aria-label={`${label}: ${current ? current.name : placeholder || "Uncategorized"}`} onClick={() => setOpen(true)}>
        <span>{current ? categoryLabel(current) : placeholder || "Uncategorized"}</span><span aria-hidden="true" className="caret">▾</span>
      </button>
    );
  }
  const option = (id: number | null, text: string) => (
    <button key={id ?? "none"} id={optionId(id)} type="button" role="option" tabIndex={-1} aria-selected={id === value}
      className={`category-option${activeId === optionId(id) ? " active" : ""}`} disabled={disabled} onClick={() => choose(id)}>{text}</button>
  );
  return (
    <div className="category-picker">
      <input ref={input} className="search" role="combobox" aria-expanded="true" aria-controls={listId} aria-autocomplete="list" aria-activedescendant={activeId}
        aria-label={`Search categories for ${label}`} placeholder="Search categories" value={query} disabled={disabled}
        onChange={(event) => { setQuery(event.target.value); setActive(null); }}
        onKeyDown={(event) => {
          if (event.key === "Escape") { event.stopPropagation(); close(); }
          else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            if (choices.length) setActive((activeIndex + (event.key === "ArrowDown" ? 1 : choices.length - 1)) % choices.length);
          } else if (event.key === "Enter") {
            event.preventDefault();
            if (activeIndex >= 0) choose(choices[activeIndex]);
          }
        }} />
      <div className="category-options" id={listId} role="listbox" aria-label={label}>
        {showNone && option(null, "Uncategorized")}
        {groups.map(({ kind, list }) => (
          <div key={kind} className="category-group" role="group" aria-label={KIND_LABELS[kind]}>
            <span className="category-kind" aria-hidden="true">{KIND_LABELS[kind]}</span>
            {list.map((category) => option(category.id, categoryLabel(category)))}
          </div>
        ))}
        {!matches.length && <p className="hint">No category matches “{query}”. Add one under Manage categories.</p>}
      </div>
      <button type="button" className="btn small" onClick={close}>Cancel</button>
    </div>
  );
}
