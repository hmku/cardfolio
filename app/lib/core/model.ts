import { parseDate } from "./dates.ts";

export type Kind = "personal" | "business" | "other";
export type OpenedVia = "applied" | "referral" | "nll_offer" | "product_change" | "other";
export type AccountStatus = "pending" | "open" | "closed" | "declined";
export type HoldingChange = "opened" | "upgrade" | "downgrade";
export type Cadence = "monthly" | "quarterly" | "semiannual" | "calendar_year" | "card_year";
export type BonusUnit = "points" | "cash" | "nights";
export type UseSource = "manual" | "import" | "plaid";

export type Person = { id: number; name: string; code: string | null; email: string | null; sort: number };

/** The cardholder's initials used in card labels ("HK" in "biz plat HK7"). */
export function personCode(person: Pick<Person, "name" | "code"> | undefined) {
  const code = person?.code?.trim();
  if (code) return code.toUpperCase();
  const words = (person?.name || "?").trim().split(/\s+/);
  return (words.length > 1 ? words.map((word) => word[0]).join("") : words[0].slice(0, 2)).toUpperCase();
}

export type Product = { id: number; slug: string; name: string; shortName: string | null; issuer: string; kind: Kind; annualFeeCents: number };

/** The compact name for tight spaces: the override if set, else the sheet abbreviation (slug). */
export function shortName(product: Pick<Product, "slug" | "shortName"> | undefined) {
  return product?.shortName?.trim() || product?.slug || "unknown card";
}

export type Bonus = { amount: number; unit: BonusUnit; spendCents: number | null; months: number };

/** One credit line: opened once, closed at most once. */
export type Account = {
  id: number;
  personId: number;
  appliedOn: string | null;
  approvedOn: string | null;
  openedVia: OpenedVia;
  status: AccountStatus;
  closedOn: string | null;
  bonus: Bonus | null;
  bonusEarned: boolean;
  note: string | null;
};

/** A stretch of time during which an account was one product ("CSR #5"). */
export type Holding = {
  id: number;
  accountId: number;
  personId: number;
  productId: number;
  number: number | null;
  startedOn: string;
  endedOn: string | null;
  change: HoldingChange;
  annualFeeCents: number;
  last4: string | null;
};

export type Credit = {
  id: number;
  productId: number;
  name: string;
  amountCents: number;
  cadence: Cadence;
  remind: boolean;
  /** Hide from Credits and disable reminders, retaining settings and uses. */
  hidden?: boolean;
  startsOn: string | null;
  endsOn: string | null;
  sort: number;
};

export type CreditUse = {
  id: number;
  creditId: number;
  holdingId: number;
  periodKey: string;
  amountCents: number;
  usedOn: string | null;
  recordedBy: string | null;
  source: UseSource;
};

export type OptOut = { creditId: number; holdingId: number };

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

export type PortfolioData = {
  people: Person[];
  products: Product[];
  accounts: Account[];
  holdings: Holding[];
  credits: Credit[];
  uses: CreditUse[];
  optOuts: OptOut[];
  rules: ActionRule[];
};

export type Portfolio = PortfolioData & {
  person(id: number): Person | undefined;
  product(id: number): Product | undefined;
  account(id: number): Account | undefined;
  holdingsOf(accountId: number): Holding[];
  current(accountId: number): Holding | undefined;
  holdingEnd(holding: Holding): string | null;
  optedOut(creditId: number, holdingId: number): boolean;
  usesFor(creditId: number, holdingId: number, periodKey: string): CreditUse[];
};

const byStart = (left: Holding, right: Holding) => left.startedOn.localeCompare(right.startedOn) || left.id - right.id;

/** Adds lookup helpers to raw portfolio rows. */
export function indexPortfolio(data: PortfolioData): Portfolio {
  const people = new Map(data.people.map((row) => [row.id, row]));
  const products = new Map(data.products.map((row) => [row.id, row]));
  const accounts = new Map(data.accounts.map((row) => [row.id, row]));
  const holdings = new Map<number, Holding[]>();
  for (const holding of [...data.holdings].sort(byStart)) {
    const list = holdings.get(holding.accountId) || [];
    list.push(holding);
    holdings.set(holding.accountId, list);
  }
  const optOuts = new Set(data.optOuts.map((row) => `${row.creditId}:${row.holdingId}`));
  const uses = new Map<string, CreditUse[]>();
  for (const use of data.uses) {
    const key = `${use.creditId}:${use.holdingId}:${use.periodKey}`;
    const list = uses.get(key) || [];
    list.push(use);
    uses.set(key, list);
  }

  return {
    ...data,
    person: (id) => people.get(id),
    product: (id) => products.get(id),
    account: (id) => accounts.get(id),
    holdingsOf: (accountId) => holdings.get(accountId) || [],
    current(accountId) {
      const list = holdings.get(accountId) || [];
      return list.find((holding) => !holding.endedOn) || list[list.length - 1];
    },
    holdingEnd(holding) {
      if (holding.endedOn) return holding.endedOn;
      const account = accounts.get(holding.accountId);
      return account && (account.status === "closed" || account.status === "declined") ? account.closedOn : null;
    },
    optedOut: (creditId, holdingId) => optOuts.has(`${creditId}:${holdingId}`),
    usesFor: (creditId, holdingId, periodKey) => uses.get(`${creditId}:${holdingId}:${periodKey}`) || [],
  };
}

/** The next unused card number for a person and card type. */
export function nextHoldingNumber(holdings: Holding[], personId: number, productId: number) {
  return holdings
    .filter((holding) => holding.personId === personId && holding.productId === productId)
    .reduce((highest, holding) => Math.max(highest, holding.number || 0), 0) + 1;
}

/** Who holds the card and which one it is: "HK7" (Harrison's 7th of this card type). */
export function cardTag(portfolio: Portfolio, holding: Holding) {
  return holding.number ? `${personCode(portfolio.person(holding.personId))}${holding.number}` : "";
}

/** "csr HK5" (short name) or "Chase Sapphire Reserve HK5" with `full`. */
export function holdingName(portfolio: Portfolio, holding: Holding, full = false) {
  const product = portfolio.product(holding.productId);
  const name = full ? product?.name || "Unknown card" : shortName(product);
  const tag = cardTag(portfolio, holding);
  return tag ? `${name} ${tag}` : name;
}

export function isActiveOn(portfolio: Portfolio, holding: Holding, start: Date, end: Date) {
  const began = parseDate(holding.startedOn);
  const ended = parseDate(portfolio.holdingEnd(holding));
  if (!began || began.getTime() > end.getTime()) return false;
  return !ended || ended.getTime() >= start.getTime();
}

export function centsToDollars(cents: number) {
  return Math.round(cents) / 100;
}

export function formatMoney(cents: number) {
  const dollars = centsToDollars(cents);
  return `$${dollars.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: dollars % 1 ? 2 : 0 })}`;
}

export function bonusLabel(bonus: Bonus) {
  if (bonus.unit === "cash") return `$${bonus.amount.toLocaleString("en-US")}`;
  if (bonus.unit === "nights") return `${bonus.amount} free night${bonus.amount === 1 ? "" : "s"}`;
  return bonus.amount >= 1000
    ? `${(bonus.amount / 1000).toLocaleString("en-US", { maximumFractionDigits: 1 })}k pts`
    : `${bonus.amount} pts`;
}
