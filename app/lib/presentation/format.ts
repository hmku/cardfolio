import { parseDate } from "../core/dates.ts";
import { formatMoney } from "../core/model.ts";

export const money = formatMoney;

const shortFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const monthYearFormat = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric" });
const fullFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });

type DateLike = Date | string | null | undefined;
const toDate = (value: DateLike) => (typeof value === "string" ? parseDate(value) : value || null);

export const shortDate = (value: DateLike) => { const date = toDate(value); return date ? shortFormat.format(date) : "—"; };
export const monthYear = (value: DateLike) => { const date = toDate(value); return date ? monthYearFormat.format(date) : "—"; };
export const fullDate = (value: DateLike) => { const date = toDate(value); return date ? fullFormat.format(date) : "—"; };

/** A sync or update time like "Nov 2, 9:14 AM", or "never". */
export function syncedAt(value: string | null) {
  if (!value) return "never";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function inDays(days: number) {
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  return days < 0 ? `${-days}d ago` : `in ${days}d`;
}

/** Dollar input helpers: the UI edits dollars, the database stores cents. */
export const toCents = (value: string) => Math.round(Number(value || 0) * 100);
export const toDollarsInput = (cents: number | null | undefined) => (cents ? String(cents / 100) : "");
