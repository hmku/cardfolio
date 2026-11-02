/** Money, percent and chart-axis formatting for the finance pages (cents in). */
import { monthYear, shortDate } from "./format.ts";

const exact = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const whole = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

/** "$1,234.56", "−$4.50". */
export function moneyExact(cents: number) {
  const text = exact.format(Math.abs(cents) / 100);
  return cents < 0 ? `−${text}` : text;
}

/** "$1,235", "−$5": for totals and charts. */
export function moneyWhole(cents: number) {
  const text = whole.format(Math.abs(cents) / 100);
  return cents < 0 ? `−${text}` : text;
}

/** A transaction amount: "+$1,200.00" for money in, "$4.50" for money out (like most bank apps). */
export function transactionAmount(cents: number) {
  return cents > 0 ? `+${exact.format(cents / 100)}` : exact.format(Math.abs(cents) / 100);
}

const compact = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", minimumFractionDigits: 0, maximumFractionDigits: 1 });

/** "$1.2M", "$350K", "−$4K": for chart axes. */
export function moneyCompact(cents: number) {
  const text = compact.format(Math.abs(cents) / 100);
  return cents < 0 ? `−${text}` : text;
}

/** "+$1,234" for a gain, "−$56" for a loss. */
export function signedMoney(cents: number) {
  return cents > 0 ? `+${moneyWhole(cents)}` : moneyWhole(cents);
}

/** A share as a percentage: one decimal under 10% ("7.4%"), whole above ("42%"), "−5.0%" below zero. */
export function percent(share: number) {
  const value = share * 100;
  const text = `${Math.abs(value).toFixed(Math.abs(value) < 10 ? 1 : 0)}%`;
  return value < 0 && text !== "0.0%" ? `−${text}` : text;
}

/** A change as a signed percentage: "+5.2%", "−12%", or "" when unknown. */
export function signedPercent(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "";
  const text = percent(Math.abs(value));
  return text === "0.0%" ? text : value > 0 ? `+${text}` : value < 0 ? `−${text}` : text;
}

/** Round axis ticks covering [min, max]: steps of 1, 2, 2.5 or 5 × a power of ten, about `count` of them. */
export function niceTicks(min: number, max: number, count = 4) {
  if (min === max) {
    const pad = Math.max(Math.abs(min) * 0.05, 10_000);
    min -= pad;
    max += pad;
  }
  const raw = (max - min) / count;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((factor) => factor * power).find((candidate) => candidate >= raw) ?? raw;
  const start = Math.floor(min / step) * step;
  const ticks: number[] = [];
  for (let value = start; value <= max + step * 0.001; value += step) ticks.push(Math.round(value));
  if (ticks[ticks.length - 1] < max) ticks.push(Math.round(ticks[ticks.length - 1] + step));
  return ticks;
}

const DAY = 86_400_000;
const dayNumber = (date: string) => Math.round(Date.parse(`${date}T00:00:00Z`) / DAY);
const dayDate = (day: number) => new Date(day * DAY).toISOString().slice(0, 10);

/**
 * Date labels for a time axis over daily points (YYYY-MM-DD, oldest first): at most `maxLabels`,
 * never more than one per day, on whole days and never the same text twice in a row. Each has its
 * position as a fraction of the span (0 = first point, 1 = last). "Nov 2" style, or "Nov 2026" past 300 days.
 */
export function timeAxisLabels(dates: string[], maxLabels: number): { fraction: number; text: string }[] {
  if (dates.length < 2 || maxLabels < 1) return [];
  const first = dayNumber(dates[0]), span = dayNumber(dates[dates.length - 1]) - first;
  if (span <= 0) return [{ fraction: 0, text: shortDate(dates[0]) }];
  const format = span > 300 ? monthYear : shortDate;
  const count = Math.min(maxLabels, span + 1);
  const days = count === 1 ? [first]
    : dates.length <= count ? dates.map(dayNumber)
    : Array.from({ length: count }, (_, index) => first + Math.round((span * index) / (count - 1)));
  const labels: { fraction: number; text: string }[] = [];
  for (const day of days) {
    const text = format(dayDate(day));
    if (labels.length && labels[labels.length - 1].text === text) continue;
    labels.push({ fraction: (day - first) / span, text });
  }
  return labels;
}
