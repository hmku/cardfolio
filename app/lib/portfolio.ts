export type PortfolioAccount = {
  approvedOn: string | null;
  closedOn: string | null;
  openedHow: string | null;
  kind: string;
  annualFee: number;
};

export type CreditPeriod = {
  key: string;
  start: Date;
  end: Date;
};

const DAY_MS = 86_400_000;

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
