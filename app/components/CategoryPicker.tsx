"use client";

import { useEffect, useRef, useState } from "react";
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
 * and the categories grouped by kind. Enter picks the first match; Escape closes.
 */
export function CategoryPicker({ categories, value, onChange, label, allowNone, placeholder, autoOpen }: {
  categories: Category[];
  value: number | null;
  onChange: (id: number | null) => void;
  label: string;
  /** Offer "Uncategorized" as a choice. */
  allowNone?: boolean;
  /** Button text when nothing is picked yet (instead of "Uncategorized"). */
  placeholder?: string;
  autoOpen?: boolean;
}) {
  const [open, setOpen] = useState(Boolean(autoOpen));
  const [query, setQuery] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) input.current?.focus(); }, [open]);
  const words = query.trim().toLowerCase();
  const matches = categories.filter((category) => !words || category.name.toLowerCase().includes(words));
  const current = value === null ? null : categories.find((category) => category.id === value);
  const choose = (id: number | null) => { onChange(id); setOpen(false); setQuery(""); };

  if (!open) {
    return (
      <button type="button" className="btn category-button" aria-label={`${label}: ${current ? current.name : placeholder || "Uncategorized"}`} onClick={() => setOpen(true)}>
        <span>{current ? categoryLabel(current) : placeholder || "Uncategorized"}</span><span aria-hidden="true" className="caret">▾</span>
      </button>
    );
  }
  return (
    <div className="category-picker">
      <input ref={input} className="search" aria-label={`Search categories for ${label}`} placeholder="Search categories" value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") { event.stopPropagation(); setOpen(false); setQuery(""); }
          if (event.key === "Enter") { event.preventDefault(); if (matches[0]) choose(matches[0].id); }
        }} />
      <div className="category-options" role="listbox" aria-label={label}>
        {allowNone && !words && (
          <button type="button" role="option" aria-selected={value === null} className="category-option" onClick={() => choose(null)}>Uncategorized</button>
        )}
        {KIND_ORDER.map((kind) => {
          const list = matches.filter((category) => category.kind === kind);
          if (!list.length) return null;
          return (
            <div key={kind} className="category-group">
              <span className="category-kind">{KIND_LABELS[kind]}</span>
              {list.map((category) => (
                <button key={category.id} type="button" role="option" aria-selected={category.id === value} className="category-option" onClick={() => choose(category.id)}>{categoryLabel(category)}</button>
              ))}
            </div>
          );
        })}
        {!matches.length && <p className="hint">No category matches “{query}”. Add one under Manage categories.</p>}
      </div>
      <button type="button" className="btn small" onClick={() => { setOpen(false); setQuery(""); }}>Cancel</button>
    </div>
  );
}
