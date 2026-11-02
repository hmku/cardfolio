/**
 * Pure logic for the Accounts (net worth) and Investments pages: which group an account sits
 * in, net worth over a chosen period, positions aggregated by security, allocation, unrealized
 * gains and investment activity types. No framework or database code; amounts are integer cents.
 */

import { monthsBefore } from "./finance.ts";

// ---------- account groups ----------

export type AccountGroup = "cash" | "credit" | "investment" | "retirement" | "loan" | "other";

export const ACCOUNT_GROUPS: { value: AccountGroup; label: string }[] = [
  { value: "cash", label: "Cash" },
  { value: "credit", label: "Credit cards" },
  { value: "investment", label: "Investments" },
  { value: "retirement", label: "Retirement" },
  { value: "loan", label: "Loans" },
  { value: "other", label: "Other" },
];

/** Plaid investment subtypes that are retirement accounts (tax-advantaged; HSAs count too). */
const RETIREMENT_SUBTYPES = new Set([
  "401a", "401k", "403b", "457b", "ira", "roth", "roth 401k", "sep ira", "simple ira", "sarsep", "keogh", "pension",
  "retirement", "profit sharing plan", "thrift savings plan", "hsa", "rrsp", "rrif", "lira", "lrif", "lrsp", "prif", "rlif", "tfsa",
]);

/** Where a Plaid account goes on the Accounts page, by its Plaid type and subtype. */
export function plaidAccountGroup(type: string | null | undefined, subtype: string | null | undefined): AccountGroup {
  if (type === "depository") return "cash";
  if (type === "credit") return "credit";
  if (type === "loan") return "loan";
  if (type === "investment" || type === "brokerage") return RETIREMENT_SUBTYPES.has(String(subtype || "").toLowerCase()) ? "retirement" : "investment";
  return "other";
}

export type ManualKind = "cash" | "investment" | "private_investment" | "retirement" | "real_estate" | "vehicle" | "crypto" | "loan" | "other";

/** Where a manual account goes: debts that aren't loans stay in Other. */
export function manualAccountGroup(kind: ManualKind): AccountGroup {
  if (kind === "cash") return "cash";
  if (kind === "investment" || kind === "private_investment" || kind === "crypto") return "investment";
  if (kind === "retirement") return "retirement";
  if (kind === "loan") return "loan";
  return "other";
}

/** Manual kinds that count as investments (shown as one position each on the Investments page). */
export const INVESTMENT_MANUAL_KINDS = new Set<ManualKind>(["investment", "private_investment", "retirement", "crypto"]);

// ---------- net worth over a period ----------

export type Range = "1M" | "3M" | "6M" | "1Y" | "all";
export const RANGES: { value: Range; label: string }[] = [
  { value: "1M", label: "1M" },
  { value: "3M", label: "3M" },
  { value: "6M", label: "6M" },
  { value: "1Y", label: "1Y" },
  { value: "all", label: "All" },
];

/** The first day (YYYY-MM-DD) of a range ending `today`, or null for all history. */
export function rangeStart(today: string, range: Range): string | null {
  if (range === "all") return null;
  return monthsBefore(today, range === "1M" ? 1 : range === "3M" ? 3 : range === "6M" ? 6 : 12);
}

export type SeriesPoint = { date: string; valueCents: number };

/**
 * The part of a daily series (oldest first) from `from` on. The value carried into `from`
 * (the last point before it) becomes the first point, dated `from`, so the line starts at the
 * range's left edge when earlier history exists.
 */
export function seriesFrom(series: SeriesPoint[], from: string | null): SeriesPoint[] {
  if (!from) return series;
  const inside = series.filter((point) => point.date >= from);
  const before = series.filter((point) => point.date < from).at(-1);
  if (before && (!inside.length || inside[0].date > from)) return [{ date: from, valueCents: before.valueCents }, ...inside];
  return inside;
}

const SNAPSHOT_LEAD_DAYS = 14;

/**
 * The first snapshot date (YYYY-MM-DD) to load for a range: a couple of weeks before the range starts,
 * so each account's balance carried into the range is known (the sync writes one a day), or null for all history.
 */
export function snapshotLoadStart(today: string, range: Range): string | null {
  const start = rangeStart(today, range);
  if (!start) return null;
  const [year, month, day] = start.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day - SNAPSHOT_LEAD_DAYS)).toISOString().slice(0, 10);
}

/**
 * A copy of `series` that ends on `today` at the live total (replacing a point already dated today),
 * so a chart and its headline agree. An empty series stays empty.
 */
export function withLiveEnd(series: SeriesPoint[], today: string, valueCents: number): SeriesPoint[] {
  if (!series.length) return [];
  const kept = series[series.length - 1].date >= today ? series.slice(0, -1) : series;
  return [...kept, { date: today, valueCents }];
}

/** The key of a balance snapshot's account: "p12" for a Plaid account, "m3" for a manual one. */
export function snapshotKey(snapshot: { plaidAccountId: number | null; manualAccountId: number | null }) {
  return snapshot.plaidAccountId !== null ? `p${snapshot.plaidAccountId}` : `m${snapshot.manualAccountId}`;
}

export type PeriodChange ={ startDate: string; startCents: number; endCents: number; changeCents: number; percent: number | null };

/** Change from the first to the last point of a (sliced) series; null with fewer than one point. */
export function periodChange(series: SeriesPoint[], endCents = series.at(-1)?.valueCents): PeriodChange | null {
  if (!series.length || endCents === undefined) return null;
  const start = series[0];
  const changeCents = endCents - start.valueCents;
  return { startDate: start.date, startCents: start.valueCents, endCents, changeCents, percent: start.valueCents === 0 ? null : changeCents / Math.abs(start.valueCents) };
}

/** Accounts' daily contributions summed per day, carrying each account's last known balance forward. */
export function balanceSeries(snapshots: { date: string; plaidAccountId: number | null; manualAccountId: number | null; balanceCents: number }[], include?: (snapshot: { plaidAccountId: number | null; manualAccountId: number | null }) => boolean): SeriesPoint[] {
  const sorted = snapshots.filter((snapshot) => !include || include(snapshot)).sort((left, right) => left.date.localeCompare(right.date));
  const latest = new Map<string, number>();
  const series: SeriesPoint[] = [];
  for (const snapshot of sorted) {
    latest.set(snapshotKey(snapshot), snapshot.balanceCents);
    let total = 0;
    for (const value of latest.values()) total += value;
    if (series.length && series[series.length - 1].date === snapshot.date) series[series.length - 1].valueCents = total;
    else series.push({ date: snapshot.date, valueCents: total });
  }
  return series;
}

// ---------- positions, allocation and gains ----------

export type AssetClass = "equity" | "etf" | "mutual_fund" | "fixed_income" | "cash" | "crypto" | "private" | "other";

export const ASSET_CLASSES: { value: AssetClass; label: string }[] = [
  { value: "equity", label: "Stocks" },
  { value: "etf", label: "ETFs" },
  { value: "mutual_fund", label: "Mutual funds" },
  { value: "fixed_income", label: "Fixed income" },
  { value: "cash", label: "Cash" },
  { value: "crypto", label: "Crypto" },
  { value: "private", label: "Private" },
  { value: "other", label: "Other" },
];

/** The allocation class of a Plaid security (types: equity, etf, mutual fund, fixed income, cash, cryptocurrency, derivative, loan, other). */
export function assetClass(security: { type: string | null; isCashEquivalent: boolean | null }): AssetClass {
  const type = String(security.type || "").toLowerCase();
  if (type === "cash" || security.isCashEquivalent) return "cash";
  if (type === "equity") return "equity";
  if (type === "etf") return "etf";
  if (type === "mutual fund") return "mutual_fund";
  if (type === "fixed income") return "fixed_income";
  if (type === "cryptocurrency") return "crypto";
  return "other";
}

export function manualAssetClass(kind: ManualKind): AssetClass {
  if (kind === "private_investment") return "private";
  if (kind === "crypto") return "crypto";
  if (kind === "cash") return "cash";
  return "other";
}

/** What the pages pass in: Plaid holdings and manual investment accounts. */
export type HoldingInput = {
  plaidAccountId: number;
  security: { id: number; name: string | null; tickerSymbol: string | null; type: string | null; isCashEquivalent: boolean | null; closePrice: number | null };
  quantity: number;
  costBasisCents: number | null;
  institutionPrice: number | null;
  institutionValueCents: number | null;
};
export type ManualPositionInput = { id: number; name: string; kind: ManualKind; balanceCents: number };
/** A Plaid investment account with a balance but no holdings is shown as one position. */
export type BareAccountInput = { plaidAccountId: number; name: string; balanceCents: number };

/** A holding's value: the institution's, else quantity × price (institution, else close). */
export function holdingValueCents(holding: Pick<HoldingInput, "quantity" | "institutionPrice" | "institutionValueCents" | "security">) {
  if (holding.institutionValueCents !== null) return holding.institutionValueCents;
  const price = holding.institutionPrice ?? holding.security.closePrice;
  return price === null ? 0 : Math.round(holding.quantity * price * 100);
}

export type PositionAccount = { key: string; plaidAccountId: number | null; manualAccountId: number | null; quantity: number | null; valueCents: number; costBasisCents: number | null; gainCents: number | null };

export type Position = {
  /** "s<security id>", "m<manual account id>" or "a<plaid account id>". */
  key: string;
  ticker: string | null;
  name: string;
  assetClass: AssetClass;
  /** Total units, or null for a manual or whole-account position. */
  quantity: number | null;
  /** Value per unit in dollars (value ÷ quantity), or null. */
  price: number | null;
  valueCents: number;
  /** Null unless every account holding it reports a cost basis. */
  costBasisCents: number | null;
  gainCents: number | null;
  gainPercent: number | null;
  /** Share of the total value (0–1). */
  share: number;
  accounts: PositionAccount[];
};

const gainOf = (value: number, cost: number | null) => (cost === null ? null : value - cost);
const percentOf = (gain: number | null, cost: number | null) => (gain === null || !cost ? null : gain / Math.abs(cost));

/**
 * One position per security across accounts (largest value first), plus one per manual
 * investment account and per Plaid investment account that reports no holdings.
 */
export function aggregatePositions(holdings: HoldingInput[], manual: ManualPositionInput[] = [], bare: BareAccountInput[] = []): Position[] {
  const bySecurity = new Map<number, Position>();
  for (const holding of holdings) {
    const valueCents = holdingValueCents(holding);
    const key = `s${holding.security.id}`;
    const position = bySecurity.get(holding.security.id) ?? {
      key,
      ticker: holding.security.tickerSymbol,
      name: holding.security.name || holding.security.tickerSymbol || "Security",
      assetClass: assetClass(holding.security),
      quantity: 0,
      price: null,
      valueCents: 0,
      costBasisCents: 0,
      gainCents: null,
      gainPercent: null,
      share: 0,
      accounts: [],
    };
    position.quantity = (position.quantity ?? 0) + holding.quantity;
    position.valueCents += valueCents;
    position.costBasisCents = position.costBasisCents === null || holding.costBasisCents === null ? null : position.costBasisCents + holding.costBasisCents;
    position.accounts.push({ key: `${key}:${holding.plaidAccountId}`, plaidAccountId: holding.plaidAccountId, manualAccountId: null, quantity: holding.quantity, valueCents, costBasisCents: holding.costBasisCents, gainCents: gainOf(valueCents, holding.costBasisCents) });
    bySecurity.set(holding.security.id, position);
  }
  const positions: Position[] = [...bySecurity.values()];
  for (const position of positions) {
    position.price = position.quantity ? position.valueCents / 100 / position.quantity : null;
    position.accounts.sort((left, right) => right.valueCents - left.valueCents);
  }
  for (const account of manual) {
    positions.push({ key: `m${account.id}`, ticker: null, name: account.name, assetClass: manualAssetClass(account.kind), quantity: null, price: null, valueCents: account.balanceCents, costBasisCents: null, gainCents: null, gainPercent: null, share: 0, accounts: [{ key: `m${account.id}:m`, plaidAccountId: null, manualAccountId: account.id, quantity: null, valueCents: account.balanceCents, costBasisCents: null, gainCents: null }] });
  }
  for (const account of bare) {
    positions.push({ key: `a${account.plaidAccountId}`, ticker: null, name: account.name, assetClass: "other", quantity: null, price: null, valueCents: account.balanceCents, costBasisCents: null, gainCents: null, gainPercent: null, share: 0, accounts: [{ key: `a${account.plaidAccountId}:a`, plaidAccountId: account.plaidAccountId, manualAccountId: null, quantity: null, valueCents: account.balanceCents, costBasisCents: null, gainCents: null }] });
  }
  const total = positions.reduce((sum, position) => sum + position.valueCents, 0);
  for (const position of positions) {
    position.gainCents = gainOf(position.valueCents, position.costBasisCents);
    position.gainPercent = percentOf(position.gainCents, position.costBasisCents);
    position.share = total > 0 ? position.valueCents / total : 0;
  }
  return positions.sort((left, right) => right.valueCents - left.valueCents || left.name.localeCompare(right.name));
}

export type PortfolioSummary = {
  valueCents: number;
  /** Cost basis of the positions that report one. */
  costBasisCents: number;
  /** Gain on those positions only. */
  gainCents: number;
  gainPercent: number | null;
  /** Positions without a cost basis (left out of the gain), and their value. */
  withoutCostBasis: number;
  valueWithoutCostBasisCents: number;
};

export function summarizePositions(positions: Position[]): PortfolioSummary {
  let valueCents = 0, costBasisCents = 0, gainCents = 0, withoutCostBasis = 0, valueWithoutCostBasisCents = 0;
  for (const position of positions) {
    valueCents += position.valueCents;
    if (position.costBasisCents === null) {
      withoutCostBasis += 1;
      valueWithoutCostBasisCents += position.valueCents;
    } else {
      costBasisCents += position.costBasisCents;
      gainCents += position.valueCents - position.costBasisCents;
    }
  }
  return { valueCents, costBasisCents, gainCents, gainPercent: costBasisCents ? gainCents / Math.abs(costBasisCents) : null, withoutCostBasis, valueWithoutCostBasisCents };
}

export type Slice = { key: string; valueCents: number; share: number };

/** Value per allocation class, largest first (empty classes left out). */
export function allocationByClass(positions: Position[]): Slice[] {
  return slices(positions.map((position) => [position.assetClass, position.valueCents]));
}

/** Value per account ("p<plaid id>" or "m<manual id>"), largest first. */
export function allocationByAccount(positions: Position[]): Slice[] {
  return slices(positions.flatMap((position) => position.accounts.map((account) => [account.plaidAccountId !== null ? `p${account.plaidAccountId}` : `m${account.manualAccountId}`, account.valueCents] as [string, number])));
}

function slices(entries: [string, number][]): Slice[] {
  const totals = new Map<string, number>();
  for (const [key, value] of entries) totals.set(key, (totals.get(key) ?? 0) + value);
  const total = [...totals.values()].reduce((sum, value) => sum + value, 0);
  return [...totals.entries()]
    .filter(([, value]) => value !== 0)
    .map(([key, valueCents]) => ({ key, valueCents, share: total > 0 ? valueCents / total : 0 }))
    .sort((left, right) => right.valueCents - left.valueCents);
}

export type PositionSort = "value" | "gain" | "gainPercent";

/** Sorted copy: biggest first; positions without a gain go last when sorting by gain. */
export function sortPositions(positions: Position[], sort: PositionSort): Position[] {
  const pick = (position: Position) => (sort === "value" ? position.valueCents : sort === "gain" ? position.gainCents : position.gainPercent);
  return [...positions].sort((left, right) => {
    const a = pick(left), b = pick(right);
    if (a === null && b === null) return right.valueCents - left.valueCents;
    if (a === null) return 1;
    if (b === null) return -1;
    return b - a || right.valueCents - left.valueCents;
  });
}

// ---------- investment activity ----------

export type ActivityKind = "buy" | "sell" | "income" | "contribution" | "withdrawal" | "fee" | "transfer" | "other";

export const ACTIVITY_KINDS: { value: ActivityKind; label: string; one: string }[] = [
  { value: "buy", label: "Buys", one: "Buy" },
  { value: "sell", label: "Sells", one: "Sell" },
  { value: "income", label: "Dividends & interest", one: "Dividend or interest" },
  { value: "contribution", label: "Contributions", one: "Contribution" },
  { value: "withdrawal", label: "Withdrawals", one: "Withdrawal" },
  { value: "fee", label: "Fees & taxes", one: "Fee or tax" },
  { value: "transfer", label: "Transfers", one: "Transfer" },
  { value: "other", label: "Other", one: "Other" },
];

/** Groups Plaid's investment transaction type/subtype into the activity filter's kinds. */
export function activityKind(type: string | null | undefined, subtype: string | null | undefined): ActivityKind {
  const kind = String(type || "").toLowerCase();
  const sub = String(subtype || "").toLowerCase();
  if (kind === "buy") return "buy";
  if (kind === "sell") return "sell";
  if (kind === "fee" || /fee|tax|expense/.test(sub)) return "fee";
  if (/dividend|interest|capital gain|distribution/.test(sub) && sub !== "stock distribution") return "income";
  if (sub === "contribution" || sub === "deposit") return "contribution";
  if (sub === "withdrawal") return "withdrawal";
  if (kind === "transfer" || /transfer/.test(sub)) return "transfer";
  return "other";
}
