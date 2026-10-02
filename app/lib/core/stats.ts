import { creditIsDue, creditState, eligibleHoldings, type Period } from "./credits.ts";
import { addMonths, DAY_MS, daysBetween, isoDate, nextAnniversary, parseDate } from "./dates.ts";
import type { Account, ActionRule, Credit, Holding, Portfolio } from "./model.ts";
import { accountAction } from "./rules.ts";

/** Accounts that count toward Chase 5/24: personal cards approved in the last 24 months. */
export function fiveTwentyFour(portfolio: Portfolio, personId: number, today: Date) {
  const cutoff = today.getTime() - 730 * DAY_MS;
  const counted = portfolio.accounts.filter((account) => {
    if (account.personId !== personId || account.openedVia === "product_change") return false;
    const approved = parseDate(account.approvedOn);
    if (!approved || approved.getTime() < cutoff) return false;
    const first = portfolio.holdingsOf(account.id)[0];
    return portfolio.product(first?.productId ?? -1)?.kind === "personal";
  });
  const oldest = counted.map((account) => parseDate(account.approvedOn)!.getTime()).sort((left, right) => left - right)[0];
  return { count: counted.length, accounts: counted, nextDrop: oldest === undefined ? null : new Date(oldest + 730 * DAY_MS) };
}

export function personStats(portfolio: Portfolio, personId: number, today: Date) {
  const mine = portfolio.accounts.filter((account) => account.personId === personId);
  return {
    open: mine.filter((account) => account.status === "open").length,
    closed: mine.filter((account) => account.status === "closed").length,
    declined: mine.filter((account) => account.status === "declined").length,
    pending: mine.filter((account) => account.status === "pending").length,
    fiveTwentyFour: fiveTwentyFour(portfolio, personId, today),
  };
}

export function bonusStatus(account: Account, today: Date) {
  if (!account.bonus || account.bonusEarned || account.status !== "open") return null;
  const approved = parseDate(account.approvedOn);
  if (!approved) return null;
  const deadline = addMonths(approved, account.bonus.months || 3);
  return { deadline, daysLeft: daysBetween(today, deadline) };
}

export function feeStatus(portfolio: Portfolio, account: Account, today: Date) {
  const holding = portfolio.current(account.id);
  const approved = parseDate(account.approvedOn);
  if (account.status !== "open" || !holding || !holding.annualFeeCents || !approved) return null;
  const next = nextAnniversary(approved, today);
  return { next, daysLeft: daysBetween(today, next), feeCents: holding.annualFeeCents };
}

export type DueItem =
  | { kind: "credit"; credit: Credit; period: Period; holdings: Holding[]; daysLeft: number }
  | { kind: "review"; account: Account; rule: ActionRule }
  | { kind: "bonus"; account: Account; deadline: Date; daysLeft: number }
  | { kind: "pending"; account: Account; daysWaiting: number };

const BONUS_WINDOW_DAYS = 60;

/** Everything that needs attention, soonest first. `include` filters accounts (person, search). */
export function dueItems(portfolio: Portfolio, today: Date, include: (account: Account) => boolean = () => true): DueItem[] {
  const items: Array<{ item: DueItem; sort: number }> = [];
  for (const credit of portfolio.credits) {
    if (!credit.remind || credit.hidden) continue;
    const grouped = new Map<string, { period: Period; holdings: Holding[]; daysLeft: number }>();
    for (const holding of eligibleHoldings(portfolio, credit, today)) {
      const account = portfolio.account(holding.accountId);
      if (!account || !include(account)) continue;
      // A card that has since closed or changed product can't use the credit any more, even
      // though it counted for part of this period.
      const ended = portfolio.holdingEnd(holding);
      if (ended && ended <= isoDate(today)) continue;
      const state = creditState(portfolio, credit, holding, today);
      if (state.kind === "off" || !creditIsDue(credit, state)) continue;
      const group = grouped.get(state.period.key) || { period: state.period, holdings: [], daysLeft: state.daysLeft };
      group.holdings.push(holding);
      grouped.set(state.period.key, group);
    }
    for (const group of grouped.values()) items.push({ item: { kind: "credit", credit, ...group }, sort: group.daysLeft });
  }
  for (const account of portfolio.accounts) {
    if (!include(account)) continue;
    const rule = accountAction(portfolio, account, today);
    if (rule) items.push({ item: { kind: "review", account, rule }, sort: 5 });
    const bonus = bonusStatus(account, today);
    if (bonus && bonus.daysLeft <= BONUS_WINDOW_DAYS) items.push({ item: { kind: "bonus", account, ...bonus }, sort: bonus.daysLeft });
    if (account.status === "pending") {
      const applied = parseDate(account.appliedOn);
      items.push({ item: { kind: "pending", account, daysWaiting: applied ? daysBetween(applied, today) : 0 }, sort: 40 });
    }
  }
  return items.sort((left, right) => left.sort - right.sort).map(({ item }) => item);
}
