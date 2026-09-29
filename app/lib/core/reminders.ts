import { addDays, parseDate } from "./dates.ts";
import { bonusLabel, formatMoney, holdingName, shortName, type Portfolio } from "./model.ts";
import { ruleMatches } from "./rules.ts";
import { dueItems, type DueItem } from "./stats.ts";

/** Days before a deadline on which a reminder goes out. */
export const CREDIT_REMINDER_DAYS = [7, 2, 0];
export const BONUS_REMINDER_DAYS = [30, 14, 3];

export type Reminder = { title: string; lines: string[]; body: string };

/** The calendar date in a time zone, as local noon (the convention in dates.ts). */
export function todayInTimeZone(timeZone: string, now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return parseDate(parts)!;
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
const when = (days: number) => (days === 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`);

function line(portfolio: Portfolio, item: DueItem) {
  if (item.kind === "credit") {
    const product = shortName(portfolio.product(item.credit.productId));
    return `${item.credit.name} ${formatMoney(item.credit.amountCents)} on ${plural(item.holdings.length, product)}: ${item.period.label} ends ${when(item.daysLeft)}`;
  }
  const holding = portfolio.current(item.account.id);
  const card = holding ? holdingName(portfolio, holding) : portfolio.person(item.account.personId)?.name || "";
  if (item.kind === "review") return `${item.rule.name}: ${card}`;
  if (item.kind === "bonus") {
    const bonus = item.account.bonus ? bonusLabel(item.account.bonus) : "bonus";
    return item.daysLeft < 0 ? `${bonus} bonus deadline passed: ${card}` : `${bonus} bonus deadline ${when(item.daysLeft)}: ${card}`;
  }
  return `${card} application still pending`;
}

/**
 * What to notify about today, or null for a quiet day. Individual items ping on a
 * few set days before their deadline (and a review rule on the day it starts
 * matching); Mondays also send a summary of everything due soon.
 */
export function dailyReminder(portfolio: Portfolio, today: Date): Reminder | null {
  const items = dueItems(portfolio, today);
  const yesterday = addDays(today, -1);
  const pinged = items.filter((item) => {
    if (item.kind === "credit") return CREDIT_REMINDER_DAYS.includes(item.daysLeft);
    if (item.kind === "bonus") return BONUS_REMINDER_DAYS.includes(item.daysLeft);
    if (item.kind === "review") return !ruleMatches(portfolio, item.rule, item.account, yesterday);
    return false;
  });
  const weekly = today.getDay() === 1;
  const chosen = weekly ? items : pinged;
  if (!chosen.length) return null;
  const lines = chosen.map((item) => line(portfolio, item));
  const title = weekly ? `This week in Cardfolio: ${plural(chosen.length, "thing")} due` : chosen.length === 1 ? "Cardfolio reminder" : `Cardfolio: ${plural(chosen.length, "reminder")}`;
  const shown = lines.slice(0, 4);
  const body = [...shown, ...(lines.length > shown.length ? [`+${lines.length - shown.length} more`] : [])].join("\n");
  return { title, lines, body };
}
