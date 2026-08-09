export type PortfolioAccount = {
  approvedOn: string | null;
  closedOn: string | null;
  openedHow: string | null;
  kind: string;
  annualFee: number;
};

export type ActionAccount = PortfolioAccount & {
  cardName: string;
  cardIndex: string | null;
};

export type ActionRuleConditions = {
  cardNames?: string[];
  requiresOpen?: boolean;
  approvalAgeMin?: number;
  approvalAgeMax?: number;
  closureAgeMin?: number;
  closureAgeMax?: number;
  annualFeeMin?: number;
  anniversaryBeforeDays?: number;
  anniversaryAfterDays?: number;
  latestCardOnly?: boolean;
};

export type ActionRule = {
  id: string;
  name: string;
  actionCode: string;
  priority: number;
  enabled: boolean;
  conditions: ActionRuleConditions;
};

export const DEFAULT_ACTION_RULES: ActionRule[] = [
  { id: "default-close", name: "Annual fee review", actionCode: "CLOSE", priority: 10, enabled: true, conditions: { requiresOpen: true, approvalAgeMin: 181, annualFeeMin: 1, anniversaryBeforeDays: 19, anniversaryAfterDays: 59 } },
  { id: "default-nll", name: "Amex no-lifetime-language window", actionCode: "NLL", priority: 20, enabled: true, conditions: { cardNames: ["Biz Plat", "Biz Gold", "Amex Biz Plat", "Amex Biz Gold"], approvalAgeMin: 80, approvalAgeMax: 100 } },
  { id: "default-cic", name: "Chase Ink Cash velocity window", actionCode: "CIC", priority: 30, enabled: true, conditions: { cardNames: ["CIC"], approvalAgeMin: 85, approvalAgeMax: 110 } },
  { id: "default-target", name: "Target RedCard reapply window", actionCode: "TARGET", priority: 40, enabled: true, conditions: { cardNames: ["RedCard"], closureAgeMin: 60, closureAgeMax: 150, latestCardOnly: true } },
];

export type CreditPeriod = {
  key: string;
  start: Date;
  end: Date;
};

const DAY_MS = 86_400_000;

function calendarDaysBetween(start: Date, end: Date) {
  const startDay = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
  const endDay = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());
  return Math.floor((endDay - startDay) / DAY_MS);
}

function normalizedName(value: string) {
  return value.trim().toLowerCase();
}

export function actionRuleMatches<T extends ActionAccount>(rule: ActionRule, account: T, accounts: T[], now = new Date()) {
  if (!rule.enabled) return false;
  const condition = rule.conditions;
  const cardName = normalizedName(account.cardName);
  if (condition.cardNames?.length && !condition.cardNames.some((name) => normalizedName(name) === cardName)) return false;
  if (condition.requiresOpen && account.closedOn) return false;
  if ((condition.approvalAgeMin !== undefined || condition.approvalAgeMax !== undefined || condition.anniversaryBeforeDays !== undefined || condition.anniversaryAfterDays !== undefined) && !account.approvedOn) return false;
  if ((condition.closureAgeMin !== undefined || condition.closureAgeMax !== undefined) && !account.closedOn) return false;

  const approvalAge = account.approvedOn ? calendarDaysBetween(dateAtNoon(account.approvedOn), now) : null;
  const closureAge = account.closedOn ? calendarDaysBetween(dateAtNoon(account.closedOn), now) : null;
  if (condition.approvalAgeMin !== undefined && (approvalAge === null || approvalAge < condition.approvalAgeMin)) return false;
  if (condition.approvalAgeMax !== undefined && (approvalAge === null || approvalAge > condition.approvalAgeMax)) return false;
  if (condition.closureAgeMin !== undefined && (closureAge === null || closureAge < condition.closureAgeMin)) return false;
  if (condition.closureAgeMax !== undefined && (closureAge === null || closureAge > condition.closureAgeMax)) return false;
  if (condition.annualFeeMin !== undefined && account.annualFee < condition.annualFeeMin) return false;

  if (condition.anniversaryBeforeDays !== undefined || condition.anniversaryAfterDays !== undefined) {
    const anniversaryDay = ((Number(approvalAge) % 365) + 365) % 365;
    const before = Math.max(0, condition.anniversaryBeforeDays || 0);
    const after = Math.max(0, condition.anniversaryAfterDays || 0);
    if (!(anniversaryDay <= after || anniversaryDay >= 365 - before)) return false;
  }

  if (condition.latestCardOnly) {
    const matchingCards = accounts.filter((item) => normalizedName(item.cardName) === cardName).length;
    const cardIndex = Number(account.cardIndex);
    if (!Number.isFinite(cardIndex) || matchingCards > cardIndex) return false;
  }

  return true;
}

/** Returns the first matching enabled rule, ordered by priority. */
export function matchingActionRule<T extends ActionAccount>(account: T, accounts: T[], now = new Date(), rules = DEFAULT_ACTION_RULES) {
  return [...rules].sort((left, right) => left.priority - right.priority)
    .find((rule) => actionRuleMatches(rule, account, accounts, now)) || null;
}

export function cardAction<T extends ActionAccount>(account: T, accounts: T[], now = new Date(), rules = DEFAULT_ACTION_RULES): string | null {
  return matchingActionRule(account, accounts, now, rules)?.actionCode || null;
}

export function dateAtNoon(value: string) {
  return new Date(`${value}T12:00:00`);
}

export function isoDate(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function endOfDayBefore(value: Date) {
  const result = new Date(value);
  result.setDate(result.getDate() - 1);
  return result;
}

function anniversaryForYear(opened: Date, year: number) {
  const result = new Date(year, opened.getMonth(), opened.getDate(), 12);
  // Feb. 29 anniversaries use Feb. 28 in non-leap years.
  if (result.getMonth() !== opened.getMonth()) result.setDate(0);
  return result;
}

export function creditPeriod(frequency: string, approvedOn: string | null, now = new Date()): CreditPeriod {
  const key = frequency.trim().toLowerCase();
  const year = now.getFullYear();
  const month = now.getMonth();
  let start: Date;
  let end: Date;
  let periodKey: string;

  if (key.includes("month")) {
    start = new Date(year, month, 1, 12);
    end = new Date(year, month + 1, 0, 12);
    periodKey = `${year}-${String(month + 1).padStart(2, "0")}`;
  } else if (key.includes("quarter")) {
    const quarter = Math.floor(month / 3);
    start = new Date(year, quarter * 3, 1, 12);
    end = new Date(year, quarter * 3 + 3, 0, 12);
    periodKey = `${year}-Q${quarter + 1}`;
  } else if (key.includes("biannual") || key.includes("semiannual") || key.includes("half")) {
    const half = month < 6 ? 1 : 2;
    start = new Date(year, half === 1 ? 0 : 6, 1, 12);
    end = new Date(year, half === 1 ? 6 : 12, 0, 12);
    periodKey = `${year}-H${half}`;
  } else if (key.includes("anniversary") && approvedOn) {
    const opened = dateAtNoon(approvedOn);
    start = anniversaryForYear(opened, year);
    if (start.getTime() > now.getTime()) start = anniversaryForYear(opened, year - 1);
    end = endOfDayBefore(anniversaryForYear(opened, start.getFullYear() + 1));
    periodKey = `${start.getFullYear()}-anniversary`;
  } else {
    start = new Date(year, 0, 1, 12);
    end = new Date(year, 11, 31, 12);
    periodKey = String(year);
  }

  if (approvedOn) {
    const opened = dateAtNoon(approvedOn);
    if (opened.getTime() > start.getTime()) start = opened;
  }

  return { key: periodKey, start, end };
}

export function bonusDeadline(approvedOn: string | null, months: number | null) {
  if (!approvedOn) return null;
  const opened = dateAtNoon(approvedOn);
  const result = new Date(opened);
  const targetMonth = result.getMonth() + Math.max(1, months || 3);
  const originalDay = result.getDate();
  result.setDate(1);
  result.setMonth(targetMonth);
  const lastDay = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
  result.setDate(Math.min(originalDay, lastDay));
  return result;
}

export function fiveTwentyFourAccounts<T extends PortfolioAccount>(accounts: T[], now = new Date()) {
  const cutoff = now.getTime() - 730 * DAY_MS;
  return accounts.filter((account) => {
    if (account.kind.trim().toLowerCase() !== "personal" || !account.approvedOn) return false;
    if (account.openedHow?.trim().toLowerCase() === "downgraded") return false;
    return dateAtNoon(account.approvedOn).getTime() >= cutoff;
  });
}

export function annualFeePayments(account: PortfolioAccount, now = new Date()) {
  if (!account.approvedOn || account.annualFee <= 0) return { count: 0, total: 0 };
  const opened = dateAtNoon(account.approvedOn);
  const end = account.closedOn ? dateAtNoon(account.closedOn) : now;
  const daysOpen = Math.max(0, (end.getTime() - opened.getTime()) / DAY_MS);
  // A closure shortly after an anniversary generally means the renewal was refunded.
  const count = account.closedOn
    ? Math.max(1, Math.ceil(Math.max(1, daysOpen - 75) / 365))
    : 1 + Math.floor(daysOpen / 365);
  return { count, total: count * account.annualFee };
}

export function daysUntilDate(date: Date, now = new Date()) {
  return Math.ceil((date.getTime() - now.getTime()) / DAY_MS);
}

export function isSecondaryCredit(name: string) {
  const normalized = name.trim().toLowerCase();
  return normalized.includes("clear") || normalized.includes("office supply") || normalized.includes("wireless");
}
