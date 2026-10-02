import { addDays, anniversaryIn, daysBetween, lastAnniversary, parseDate } from "./dates.ts";
import { isActiveOn, type Credit, type CreditUse, type Holding, type Portfolio } from "./model.ts";

export type Period = { key: string; label: string; start: Date; end: Date };

export const CADENCE_LABELS: Record<Credit["cadence"], string> = {
  monthly: "Monthly",
  quarterly: "Quarterly",
  semiannual: "Twice a year",
  calendar_year: "Calendar year",
  card_year: "Card year",
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * The period containing `today` for a credit's cadence. Card-year credits
 * follow the account's approval anniversary.
 */
export function creditPeriod(cadence: Credit["cadence"], today: Date, accountApprovedOn?: string | null): Period {
  const year = today.getFullYear();
  const month = today.getMonth();
  if (cadence === "monthly") {
    return { key: `${year}-${String(month + 1).padStart(2, "0")}`, label: MONTHS[month], start: new Date(year, month, 1, 12), end: new Date(year, month + 1, 0, 12) };
  }
  if (cadence === "quarterly") {
    const quarter = Math.floor(month / 3);
    return { key: `${year}-Q${quarter + 1}`, label: `Q${quarter + 1}`, start: new Date(year, quarter * 3, 1, 12), end: new Date(year, quarter * 3 + 3, 0, 12) };
  }
  if (cadence === "semiannual") {
    const half = month < 6 ? 1 : 2;
    return { key: `${year}-H${half}`, label: `H${half}`, start: new Date(year, half === 1 ? 0 : 6, 1, 12), end: new Date(year, half === 1 ? 6 : 12, 0, 12) };
  }
  const opened = parseDate(accountApprovedOn);
  if (cadence === "card_year" && opened) {
    const start = lastAnniversary(opened, today);
    const end = addDays(anniversaryIn(opened, start.getFullYear() + 1), -1);
    return { key: `CY${start.getFullYear()}`, label: "Card year", start, end };
  }
  return { key: String(year), label: String(year), start: new Date(year, 0, 1, 12), end: new Date(year, 11, 31, 12) };
}

export function periodFor(portfolio: Portfolio, credit: Credit, holding: Holding | null, today: Date) {
  const account = holding ? portfolio.account(holding.accountId) : null;
  return creditPeriod(credit.cadence, today, account?.approvedOn);
}

function creditLiveDuring(credit: Credit, start: Date, end: Date) {
  const from = parseDate(credit.startsOn);
  const to = parseDate(credit.endsOn);
  return (!from || from.getTime() <= end.getTime()) && (!to || to.getTime() >= start.getTime());
}

/** Holdings that could use this credit in its current period, oldest card first. */
export function eligibleHoldings(portfolio: Portfolio, credit: Credit, today: Date) {
  return portfolio.holdings
    .filter((holding) => {
      if (holding.productId !== credit.productId) return false;
      const account = portfolio.account(holding.accountId);
      if (!account || !account.approvedOn) return false;
      const period = periodFor(portfolio, credit, holding, today);
      if (!creditLiveDuring(credit, period.start, period.end)) return false;
      if (credit.cadence === "card_year") return account.status === "open" && !holding.endedOn;
      return isActiveOn(portfolio, holding, period.start, period.end);
    })
    .sort((left, right) => left.startedOn.localeCompare(right.startedOn) || left.id - right.id);
}

export type CreditState =
  | { kind: "off" }
  | { kind: "open" | "partial" | "used"; period: Period; usedCents: number; uses: CreditUse[]; daysLeft: number; auto?: boolean };

export function creditState(portfolio: Portfolio, credit: Credit, holding: Holding, today: Date): CreditState {
  if (credit.mode === "skip" || portfolio.optedOut(credit.id, holding.id)) return { kind: "off" };
  const period = periodFor(portfolio, credit, holding, today);
  const uses = portfolio.usesFor(credit.id, holding.id, period.key);
  const usedCents = uses.reduce((total, use) => total + use.amountCents, 0);
  // An always-used credit counts as used unless something was recorded for this period.
  if (credit.mode === "auto" && !uses.length) return { kind: "used", period, usedCents: credit.amountCents, uses, daysLeft: daysBetween(today, period.end), auto: true };
  const kind = usedCents <= 0 ? "open" : usedCents >= credit.amountCents ? "used" : "partial";
  return { kind, period, usedCents, uses, daysLeft: daysBetween(today, period.end) };
}

export const DUE_WINDOW_DAYS = 31;

/** Whether an unused credit on this card needs attention soon. */
export function creditIsDue(credit: Credit, state: CreditState) {
  return credit.mode === "track" && credit.remind && state.kind !== "off" && state.kind !== "used" && state.daysLeft <= DUE_WINDOW_DAYS;
}

export function creditSummary(portfolio: Portfolio, credit: Credit, holdings: Holding[], today: Date) {
  const states = holdings.map((holding) => creditState(portfolio, credit, holding, today));
  const enrolled = states.filter((state) => state.kind !== "off");
  return {
    used: enrolled.filter((state) => state.kind === "used").length,
    enrolled: enrolled.length,
    remainingCents: enrolled.reduce((total, state) => total + ("usedCents" in state ? Math.max(0, credit.amountCents - state.usedCents) : 0), 0),
  };
}
