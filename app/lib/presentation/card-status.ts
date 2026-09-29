import { anniversaryIn, daysBetween, parseDate } from "../core/dates.ts";
import { bonusLabel, holdingName, type Account, type Holding, type Portfolio } from "../core/model.ts";
import { accountAction } from "../core/rules.ts";
import { bonusStatus, feeStatus } from "../core/stats.ts";
import { inDays, money, monthYear, shortDate } from "./format.ts";

export type CardTone = "alert" | "due" | "info" | "kept";
export type StatusTag = { key: string; text: string; tone?: CardTone; title?: string };
const FEE_WINDOW_DAYS = 45;
const RECENT_CHANGE_DAYS = 120;
const YEAR_DAYS = 365;

function approvedDays(account: Account, today: Date) {
  const approved = parseDate(account.approvedOn);
  return approved ? daysBetween(approved, today) : -1;
}

/** Shared presentation for Cards and Credits; financial rules stay in core. */
export function cardStatus(portfolio: Portfolio, account: Account, holding: Holding, today: Date) {
  const tags: StatusTag[] = [];
  const tones: CardTone[] = [];
  const current = portfolio.current(account.id);
  // Prior products can still have usable credits, but must not show the current card's tasks.
  if (current && current.id !== holding.id) {
    tags.push(account.status === "open"
      ? { key: "now", text: `Now ${holdingName(portfolio, current)}` }
      : { key: "closed", text: `Closed ${monthYear(account.closedOn)}` });
    return { tone: null, tags, bonusInProgress: false };
  }

  const rule = accountAction(portfolio, account, today);
  const fee = feeStatus(portfolio, account, today);
  if (rule) {
    tones.push("alert");
    const approved = parseDate(account.approvedOn);
    const last = approved ? anniversaryIn(approved, today.getFullYear()) : null;
    // The app knows the approval anniversary, not when the fee posts on a statement.
    const timing = fee && last && last.getTime() <= today.getTime() && fee.daysLeft > 180
      ? `renewed ${shortDate(last)}` : fee ? `renews ${inDays(fee.daysLeft)}` : "";
    tags.push({ key: "rule", tone: "alert", title: rule.name,
      text: rule.actionCode === "CLOSE" && fee ? `Keep or close? ${money(fee.feeCents)} fee, ${timing}` : rule.name });
  } else if (fee && approvedDays(account, today) >= YEAR_DAYS) {
    // Kept past its first fee and outside a review window: a light "think about it" nudge.
    tones.push("kept");
    tags.push({ key: "kept", tone: "kept", title: "Open more than a year with an annual fee",
      text: `Kept · ${money(fee.feeCents)} fee ${fee.daysLeft <= FEE_WINDOW_DAYS ? inDays(fee.daysLeft) : monthYear(fee.next)}` });
  } else if (fee && fee.daysLeft <= FEE_WINDOW_DAYS) {
    tags.push({ key: "fee", text: `${money(fee.feeCents)} fee ${inDays(fee.daysLeft)}` });
  }

  const bonus = bonusStatus(account, today);
  if (bonus && account.bonus) {
    const overdue = bonus.daysLeft < 0;
    tones.push(overdue ? "alert" : "due");
    const spend = account.bonus.spendCents ? `spend ${money(account.bonus.spendCents)}` : "earn";
    tags.push({ key: "bonus", tone: overdue ? "alert" : "due", text: overdue
      ? `Bonus deadline passed ${shortDate(bonus.deadline)}: earned it?`
      : `${bonusLabel(account.bonus)}: ${spend} by ${shortDate(bonus.deadline)} · ${bonus.daysLeft}d left` });
  }
  if (account.status === "pending") {
    tones.push("info");
    const applied = parseDate(account.appliedOn);
    tags.push({ key: "pending", tone: "info", text: `Pending · applied ${shortDate(account.appliedOn)}${applied ? ` (${daysBetween(applied, today)}d)` : ""}` });
  }
  if (holding.change !== "opened") {
    const started = parseDate(holding.startedOn);
    const previous = portfolio.holdingsOf(account.id).filter((item) => item.startedOn < holding.startedOn).pop();
    const age = started ? daysBetween(started, today) : -1;
    if (previous && age >= 0 && age <= RECENT_CHANGE_DAYS) {
      tags.push({ key: "change", text: `${holding.change === "upgrade" ? "Upgraded" : "Downgraded"} from ${holdingName(portfolio, previous)} ${shortDate(holding.startedOn)}` });
    }
  }
  if (account.status === "closed") tags.push({ key: "closed", text: `Closed ${monthYear(account.closedOn)}` });
  if (account.status === "declined") tags.push({ key: "declined", text: `Declined ${shortDate(account.closedOn || account.appliedOn)}` });
  // Priority is explicit: decisions, then bonuses in progress, pending, and kept-with-a-fee.
  const tone = (["alert", "due", "info", "kept"] as const).find((tone) => tones.includes(tone)) ?? null;
  return { tone, tags, bonusInProgress: Boolean(bonus) };
}
