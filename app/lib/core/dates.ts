export const DAY_MS = 86_400_000;

/** Parses a YYYY-MM-DD string as local noon, which keeps day math stable across DST. */
export function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
}

export function isoDate(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

export function atNoon(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate(), 12);
}

export function daysBetween(start: Date, end: Date) {
  return Math.round((atNoon(end).getTime() - atNoon(start).getTime()) / DAY_MS);
}

export function addDays(value: Date, days: number) {
  const result = atNoon(value);
  result.setDate(result.getDate() + days);
  return result;
}

/** Adds calendar months, clamping to the end of shorter months (Jan 31 + 1 month = Feb 28). */
export function addMonths(value: Date, months: number) {
  const result = atNoon(value);
  const day = result.getDate();
  result.setDate(1);
  result.setMonth(result.getMonth() + months);
  result.setDate(Math.min(day, new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate()));
  return result;
}

/** The anniversary of `opened` in `year`; Feb 29 falls back to Feb 28. */
export function anniversaryIn(opened: Date, year: number) {
  const lastDay = new Date(year, opened.getMonth() + 1, 0).getDate();
  return new Date(year, opened.getMonth(), Math.min(opened.getDate(), lastDay), 12);
}

/** The most recent anniversary of `opened` on or before `today`. */
export function lastAnniversary(opened: Date, today: Date) {
  const thisYear = anniversaryIn(opened, today.getFullYear());
  return thisYear.getTime() <= atNoon(today).getTime() ? thisYear : anniversaryIn(opened, today.getFullYear() - 1);
}

/** The next anniversary of `opened` strictly after `today`. */
export function nextAnniversary(opened: Date, today: Date) {
  const thisYear = anniversaryIn(opened, today.getFullYear());
  return thisYear.getTime() > atNoon(today).getTime() ? thisYear : anniversaryIn(opened, today.getFullYear() + 1);
}
