/** Transactions page helpers: the filter state (shared with Cash flow) and date groups. */
import { datePresetRange, type DatePreset } from "../core/finance.ts";
import type { TransactionQuery } from "../finance-data.ts";

/** The Transactions tab's filters. Portfolio keeps them so Cash flow can open the tab filtered. */
export type TransactionFilters = {
  search: string;
  accountIds: number[];
  /** A category id, "none" for uncategorized, or null for any. */
  category: number | "none" | null;
  datePreset: DatePreset;
  /** Used when datePreset is "custom" (YYYY-MM-DD, inclusive). */
  from: string;
  to: string;
  direction: "all" | "in" | "out";
  showExcluded: boolean;
  unreviewedOnly: boolean;
};

export const DEFAULT_TRANSACTION_FILTERS: TransactionFilters = {
  search: "", accountIds: [], category: null, datePreset: "all", from: "", to: "", direction: "all", showExcluded: false, unreviewedOnly: false,
};

export const DATE_PRESETS: { value: DatePreset; label: string }[] = [
  { value: "all", label: "All dates" },
  { value: "this-month", label: "This month" },
  { value: "last-month", label: "Last month" },
  { value: "90-days", label: "Last 90 days" },
  { value: "this-year", label: "This year" },
  { value: "custom", label: "Custom…" },
];

/** The loadTransactions query for a set of filters on `today` (YYYY-MM-DD). */
export function filtersToQuery(filters: TransactionFilters, today: string): TransactionQuery {
  const range = filters.datePreset === "custom" ? { from: filters.from || undefined, to: filters.to || undefined } : datePresetRange(filters.datePreset, today);
  return {
    search: filters.search.trim() || undefined,
    accountIds: filters.accountIds.length ? filters.accountIds : undefined,
    categoryIds: filters.category === null ? undefined : [filters.category === "none" ? null : filters.category],
    ...range,
    includeExcluded: filters.showExcluded,
    unreviewedOnly: filters.unreviewedOnly || undefined,
    direction: filters.direction === "all" ? undefined : filters.direction,
  };
}

/** How many filters (other than search) differ from the defaults: for the "Filters (3)" button. */
export function activeFilterCount(filters: TransactionFilters) {
  return [filters.accountIds.length > 0, filters.category !== null, filters.datePreset !== "all", filters.direction !== "all", filters.showExcluded, filters.unreviewedOnly].filter(Boolean).length;
}

/** Consecutive runs of items sharing a date (the list is already newest first). */
export function groupByDate<T extends { date: string }>(items: T[]) {
  const groups: { date: string; items: T[] }[] = [];
  for (const item of items) {
    const last = groups[groups.length - 1];
    if (last && last.date === item.date) last.items.push(item);
    else groups.push({ date: item.date, items: [item] });
  }
  return groups;
}
