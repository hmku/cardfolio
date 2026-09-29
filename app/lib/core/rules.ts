import { daysBetween, parseDate } from "./dates.ts";
import type { Account, ActionRule, Portfolio } from "./model.ts";

/** Mirrors the rules seeded in supabase/migrations; used when none are stored. */
export const DEFAULT_ACTION_RULES: ActionRule[] = [
  { id: "default-close", name: "Annual fee review", actionCode: "CLOSE", priority: 10, enabled: true, conditions: { requiresOpen: true, approvalAgeMin: 181, annualFeeMin: 1, anniversaryBeforeDays: 19, anniversaryAfterDays: 59 } },
  { id: "default-nll", name: "Amex no-lifetime-language window", actionCode: "NLL", priority: 20, enabled: true, conditions: { cardNames: ["biz plat", "biz gold"], approvalAgeMin: 80, approvalAgeMax: 100 } },
  { id: "default-cic", name: "Chase Ink Cash velocity window", actionCode: "CIC", priority: 30, enabled: true, conditions: { cardNames: ["cic"], approvalAgeMin: 85, approvalAgeMax: 110 } },
  { id: "default-target", name: "Target RedCard reapply window", actionCode: "TARGET", priority: 40, enabled: true, conditions: { cardNames: ["redcard"], closureAgeMin: 60, closureAgeMax: 150, latestCardOnly: true } },
];

/** Plain-language summary of a rule's conditions. */
export function describeRule(rule: ActionRule) {
  const condition = rule.conditions;
  const parts: string[] = [];
  if (condition.cardNames?.length) parts.push(condition.cardNames.join(" or "));
  if (condition.requiresOpen) parts.push("card is open");
  if (condition.approvalAgeMin !== undefined || condition.approvalAgeMax !== undefined) {
    parts.push(`${condition.approvalAgeMin ?? 0}–${condition.approvalAgeMax ?? "∞"} days after approval`);
  }
  if (condition.closureAgeMin !== undefined || condition.closureAgeMax !== undefined) {
    parts.push(`${condition.closureAgeMin ?? 0}–${condition.closureAgeMax ?? "∞"} days after closing`);
  }
  if (condition.annualFeeMin !== undefined) parts.push(`annual fee at least $${condition.annualFeeMin}`);
  if (condition.anniversaryBeforeDays !== undefined || condition.anniversaryAfterDays !== undefined) {
    parts.push(`${condition.anniversaryBeforeDays ?? 0} days before to ${condition.anniversaryAfterDays ?? 0} days after the anniversary`);
  }
  if (condition.latestCardOnly) parts.push("most recent card of this type");
  return parts.join(" · ") || "Always";
}

function matchesCard(portfolio: Portfolio, account: Account, names: string[]) {
  const product = portfolio.product(portfolio.current(account.id)?.productId ?? -1);
  if (!product) return false;
  const wanted = new Set(names.map((name) => name.trim().toLowerCase()));
  return wanted.has(product.slug.toLowerCase()) || wanted.has(product.name.toLowerCase());
}

export function ruleMatches(portfolio: Portfolio, rule: ActionRule, account: Account, today: Date) {
  if (!rule.enabled) return false;
  const condition = rule.conditions;
  const holding = portfolio.current(account.id);
  if (!holding) return false;
  if (condition.cardNames?.length && !matchesCard(portfolio, account, condition.cardNames)) return false;
  if (condition.requiresOpen && account.status !== "open") return false;

  const approved = parseDate(account.approvedOn);
  const closed = account.status === "closed" ? parseDate(account.closedOn) : null;
  const needsApproval = [condition.approvalAgeMin, condition.approvalAgeMax, condition.anniversaryBeforeDays, condition.anniversaryAfterDays].some((value) => value !== undefined);
  if (needsApproval && !approved) return false;
  const needsClosure = condition.closureAgeMin !== undefined || condition.closureAgeMax !== undefined;
  if (needsClosure && !closed) return false;

  const approvalAge = approved ? daysBetween(approved, today) : null;
  const closureAge = closed ? daysBetween(closed, today) : null;
  if (condition.approvalAgeMin !== undefined && (approvalAge === null || approvalAge < condition.approvalAgeMin)) return false;
  if (condition.approvalAgeMax !== undefined && (approvalAge === null || approvalAge > condition.approvalAgeMax)) return false;
  if (condition.closureAgeMin !== undefined && (closureAge === null || closureAge < condition.closureAgeMin)) return false;
  if (condition.closureAgeMax !== undefined && (closureAge === null || closureAge > condition.closureAgeMax)) return false;
  if (condition.annualFeeMin !== undefined && holding.annualFeeCents < condition.annualFeeMin * 100) return false;

  if (condition.anniversaryBeforeDays !== undefined || condition.anniversaryAfterDays !== undefined) {
    const dayOfYear = ((Number(approvalAge) % 365) + 365) % 365;
    const before = Math.max(0, condition.anniversaryBeforeDays || 0);
    const after = Math.max(0, condition.anniversaryAfterDays || 0);
    if (!(dayOfYear <= after || dayOfYear >= 365 - before)) return false;
  }

  if (condition.latestCardOnly) {
    const latest = portfolio.accounts
      .filter((other) => other.personId === account.personId && other.approvedOn && portfolio.current(other.id)?.productId === holding.productId)
      .sort((left, right) => String(right.approvedOn).localeCompare(String(left.approvedOn)) || right.id - left.id)[0];
    if (!latest || latest.id !== account.id) return false;
  }
  return true;
}

/** The first enabled rule (by priority) that matches the account. */
export function accountAction(portfolio: Portfolio, account: Account, today: Date) {
  const rules = portfolio.rules.length ? portfolio.rules : DEFAULT_ACTION_RULES;
  return [...rules].sort((left, right) => left.priority - right.priority)
    .find((rule) => ruleMatches(portfolio, rule, account, today)) || null;
}
