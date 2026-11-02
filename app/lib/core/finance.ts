/**
 * Pure finance logic shared by the Plaid sync (server) and the finance pages (browser):
 * amount signs, default categories, category rules, transaction write planning, net worth
 * snapshots, cash flow and Plaid error/webhook classification. No framework or database code.
 *
 * Sign convention: Cardfolio stores transaction amounts in cents with positive = money into
 * the account and negative = money out. Plaid's amounts are the other way round
 * (positive = money out), so everything from Plaid goes through `plaidAmountToCents`.
 */

export type CategoryKind = "income" | "expense" | "transfer";

export type CategoryLike = { id: number; kind: CategoryKind; plaidCategories: string[] };

export type RuleField = "any" | "merchant" | "name";

export type RuleLike = {
  id: number;
  matchText: string;
  matchField: RuleField;
  /** Only transactions on this Plaid account (Cardfolio's plaid_accounts.id), or any account. */
  plaidAccountId: number | null;
  categoryId: number;
  setExcluded: boolean | null;
};

export type CategorySource = "rule" | "plaid" | "manual";

/** Dollars (Plaid's floats) to integer cents, or null. */
export function toCents(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return Math.round(value * 100) || 0;
}

/** A Plaid transaction amount (positive = money out) in Cardfolio's cents (positive = money in). */
export function plaidAmountToCents(amount: number) {
  return -(toCents(amount) ?? 0) || 0;
}

/**
 * The household category Plaid's personal_finance_category maps to: a category listing the
 * detailed code (FOOD_AND_DRINK_GROCERIES) wins over one listing the primary (FOOD_AND_DRINK).
 */
export function defaultCategoryFor(primary: string | null | undefined, detailed: string | null | undefined, categories: CategoryLike[]) {
  if (detailed) {
    const exact = categories.find((category) => category.plaidCategories.includes(detailed));
    if (exact) return exact;
  }
  if (primary) return categories.find((category) => category.plaidCategories.includes(primary)) ?? null;
  return null;
}

export type RuleTarget = { name: string; merchantName: string | null; plaidAccountId: number };

/** The rule that applies: account-specific beats general, then the longest match text, then the oldest rule. */
export function matchRule(target: RuleTarget, rules: RuleLike[]) {
  const name = target.name.toLowerCase();
  const merchant = (target.merchantName || "").toLowerCase();
  const matching = rules.filter((rule) => {
    const text = rule.matchText.trim().toLowerCase();
    if (!text) return false;
    if (rule.plaidAccountId !== null && rule.plaidAccountId !== target.plaidAccountId) return false;
    if (rule.matchField === "merchant") return merchant.includes(text);
    if (rule.matchField === "name") return name.includes(text);
    return merchant.includes(text) || name.includes(text);
  });
  matching.sort((left, right) =>
    Number(right.plaidAccountId !== null) - Number(left.plaidAccountId !== null)
    || right.matchText.trim().length - left.matchText.trim().length
    || left.id - right.id);
  return matching[0] ?? null;
}

export type Categorized = { categoryId: number | null; source: CategorySource | null; excluded: boolean | null };

/** A new transaction's category: the household's rules first, else Plaid's category mapped to a household category. */
export function categorize(target: RuleTarget & { plaidPrimary: string | null; plaidDetailed: string | null }, categories: CategoryLike[], rules: RuleLike[]): Categorized {
  const rule = matchRule(target, rules);
  if (rule && categories.some((category) => category.id === rule.categoryId)) {
    return { categoryId: rule.categoryId, source: "rule", excluded: rule.setExcluded };
  }
  const fallback = defaultCategoryFor(target.plaidPrimary, target.plaidDetailed, categories);
  return fallback ? { categoryId: fallback.id, source: "plaid", excluded: null } : { categoryId: null, source: null, excluded: null };
}

// ---------- transaction sync planning ----------

/** The fields of a Plaid /transactions/sync transaction the sync stores. */
export type PlaidTransaction = {
  transaction_id: string;
  account_id: string;
  pending_transaction_id?: string | null;
  date: string;
  authorized_date?: string | null;
  amount: number;
  iso_currency_code?: string | null;
  unofficial_currency_code?: string | null;
  name?: string | null;
  merchant_name?: string | null;
  logo_url?: string | null;
  website?: string | null;
  personal_finance_category?: { primary?: string | null; detailed?: string | null; confidence_level?: string | null } | null;
  pending?: boolean;
  payment_channel?: string | null;
};

/** The user-owned columns of a stored transaction, kept across Plaid updates. */
export type StoredUserFields = {
  plaidTransactionId: string;
  categoryId: number | null;
  categorySource: CategorySource | null;
  notes: string | null;
  excluded: boolean;
  reviewed: boolean;
};

/** A row for public.transactions (snake_case, ready to upsert on plaid_transaction_id). */
export type TransactionRow = {
  household_id: string;
  plaid_account_id: number;
  plaid_transaction_id: string;
  pending_transaction_id: string | null;
  date: string;
  authorized_date: string | null;
  amount_cents: number;
  currency: string | null;
  name: string;
  merchant_name: string | null;
  logo_url: string | null;
  website: string | null;
  plaid_category_primary: string | null;
  plaid_category_detailed: string | null;
  plaid_category_confidence: string | null;
  pending: boolean;
  payment_channel: string | null;
  category_id: number | null;
  category_source: CategorySource | null;
  notes: string | null;
  excluded: boolean;
  reviewed: boolean;
};

export type TransactionPlan = { upserts: TransactionRow[]; removeIds: string[]; skipped: number };

/**
 * Turns one complete /transactions/sync pass into rows to upsert and Plaid ids to delete.
 * - New transactions get a category from the rules, else Plaid's mapping.
 * - Known transactions keep their notes, flags and a manual category; a rule or Plaid
 *   category is recomputed, since Plaid may have changed the merchant or category.
 * - A posted transaction replacing a pending one inherits the pending one's notes, flags
 *   and category (Plaid removes the pending one in the same or a later pass).
 * - Transactions on accounts Cardfolio doesn't know (yet) are skipped.
 * - Later updates to the same transaction win over earlier ones in the pass.
 */
export function planTransactionWrites(input: {
  householdId: string;
  added: PlaidTransaction[];
  modified: PlaidTransaction[];
  removed: { transaction_id: string }[];
  accountIds: Map<string, number>;
  existing: Map<string, StoredUserFields>;
  categories: CategoryLike[];
  rules: RuleLike[];
}): TransactionPlan {
  const latest = new Map<string, PlaidTransaction>();
  for (const transaction of [...input.added, ...input.modified]) latest.set(transaction.transaction_id, transaction);
  const removed = new Set(input.removed.map((row) => row.transaction_id));
  const upserts: TransactionRow[] = [];
  let skipped = 0;
  for (const transaction of latest.values()) {
    if (removed.has(transaction.transaction_id)) continue;
    const plaidAccountId = input.accountIds.get(transaction.account_id);
    if (plaidAccountId === undefined) { skipped += 1; continue; }
    const name = (transaction.name || transaction.merchant_name || "Transaction").trim() || "Transaction";
    const category = transaction.personal_finance_category || null;
    const own = input.existing.get(transaction.transaction_id);
    const inherited = !own && transaction.pending_transaction_id ? input.existing.get(transaction.pending_transaction_id) : undefined;
    const kept = own || inherited;
    const auto = categorize({ name, merchantName: transaction.merchant_name ?? null, plaidAccountId, plaidPrimary: category?.primary ?? null, plaidDetailed: category?.detailed ?? null }, input.categories, input.rules);
    const manual = kept?.categorySource === "manual";
    upserts.push({
      household_id: input.householdId,
      plaid_account_id: plaidAccountId,
      plaid_transaction_id: transaction.transaction_id,
      pending_transaction_id: transaction.pending_transaction_id ?? null,
      date: transaction.date,
      authorized_date: transaction.authorized_date ?? null,
      amount_cents: plaidAmountToCents(transaction.amount),
      currency: transaction.iso_currency_code ?? transaction.unofficial_currency_code ?? null,
      name,
      merchant_name: transaction.merchant_name ?? null,
      logo_url: transaction.logo_url ?? null,
      website: transaction.website ?? null,
      plaid_category_primary: category?.primary ?? null,
      plaid_category_detailed: category?.detailed ?? null,
      plaid_category_confidence: category?.confidence_level ?? null,
      pending: Boolean(transaction.pending),
      payment_channel: transaction.payment_channel ?? null,
      category_id: manual ? kept!.categoryId : auto.categoryId,
      category_source: manual ? "manual" : auto.source,
      notes: kept?.notes ?? null,
      // A person's choice sticks; otherwise a rule may set it on new transactions.
      excluded: kept ? kept.excluded : auto.excluded ?? false,
      reviewed: kept?.reviewed ?? false,
    });
  }
  return { upserts, removeIds: [...removed], skipped };
}

// ---------- balances and net worth ----------

const DEBT_TYPES = new Set(["credit", "loan"]);

/** An account's contribution to net worth: Plaid reports debts (cards, loans) as positive amounts owed. */
export function netWorthCents(type: string | null | undefined, balanceCents: number) {
  return DEBT_TYPES.has(String(type)) ? -balanceCents || 0 : balanceCents;
}

export type PlaidBalances = { current?: number | null; available?: number | null; limit?: number | null; iso_currency_code?: string | null; unofficial_currency_code?: string | null };

/** plaid_accounts balance columns from a Plaid `balances` object (as Plaid reports them, in cents). */
export function balanceColumns(balances: PlaidBalances | null | undefined, now: string) {
  if (!balances) return {};
  return {
    current_balance_cents: toCents(balances.current),
    available_balance_cents: toCents(balances.available),
    credit_limit_cents: toCents(balances.limit),
    currency: balances.iso_currency_code ?? balances.unofficial_currency_code ?? null,
    balances_updated_at: now,
  };
}

export type SnapshotRow = {
  household_id: string;
  date: string;
  plaid_account_id: number | null;
  manual_account_id: number | null;
  balance_cents: number;
  currency: string | null;
};

/**
 * Today's balance_snapshots rows: every Plaid account with a known balance (current, else
 * available) and every manual account that isn't archived (its balance carries forward).
 */
export function snapshotRows(input: {
  householdId: string;
  date: string;
  plaidAccounts: { id: number; type: string | null; currentCents: number | null; availableCents: number | null; currency: string | null }[];
  manualAccounts: { id: number; balanceCents: number; liability: boolean; archived: boolean; currency: string | null }[];
}): SnapshotRow[] {
  const rows: SnapshotRow[] = [];
  for (const account of input.plaidAccounts) {
    const balance = account.currentCents ?? account.availableCents;
    if (balance === null) continue;
    rows.push({ household_id: input.householdId, date: input.date, plaid_account_id: account.id, manual_account_id: null, balance_cents: netWorthCents(account.type, balance), currency: account.currency });
  }
  for (const account of input.manualAccounts) {
    if (account.archived) continue;
    rows.push({ household_id: input.householdId, date: input.date, plaid_account_id: null, manual_account_id: account.id, balance_cents: account.liability ? -account.balanceCents || 0 : account.balanceCents, currency: account.currency });
  }
  return rows;
}

/** Net worth per day from snapshots, carrying each account's last known balance forward. */
export function netWorthSeries(snapshots: { date: string; plaidAccountId: number | null; manualAccountId: number | null; balanceCents: number }[]) {
  const sorted = [...snapshots].sort((left, right) => left.date.localeCompare(right.date));
  const latest = new Map<string, number>();
  const series: { date: string; netWorthCents: number }[] = [];
  for (const snapshot of sorted) {
    latest.set(snapshot.plaidAccountId !== null ? `p${snapshot.plaidAccountId}` : `m${snapshot.manualAccountId}`, snapshot.balanceCents);
    const total = [...latest.values()].reduce((sum, value) => sum + value, 0);
    if (series.length && series[series.length - 1].date === snapshot.date) series[series.length - 1].netWorthCents = total;
    else series.push({ date: snapshot.date, netWorthCents: total });
  }
  return series;
}

// ---------- cash flow ----------

export type CashFlowTransaction = { date: string; amountCents: number; categoryId: number | null; excluded: boolean };
export type CashFlowMonth = { month: string; incomeCents: number; expenseCents: number; netCents: number };

/**
 * Income and spending per month (YYYY-MM, newest first). Excluded transactions and
 * transfer categories never count. Uncategorized money in counts as income and money out as
 * spending; expense-category refunds reduce spending, and income-category reversals reduce income.
 */
export function cashFlowByMonth(transactions: CashFlowTransaction[], categories: { id: number; kind: CategoryKind }[]): CashFlowMonth[] {
  const kinds = new Map(categories.map((category) => [category.id, category.kind]));
  const months = new Map<string, CashFlowMonth>();
  for (const transaction of transactions) {
    if (transaction.excluded) continue;
    const kind = transaction.categoryId === null ? null : kinds.get(transaction.categoryId) ?? null;
    if (kind === "transfer") continue;
    const month = transaction.date.slice(0, 7);
    const row = months.get(month) ?? { month, incomeCents: 0, expenseCents: 0, netCents: 0 };
    const asIncome = kind === "income" || (kind === null && transaction.amountCents > 0);
    if (asIncome) row.incomeCents += transaction.amountCents;
    else row.expenseCents -= transaction.amountCents;
    row.netCents = row.incomeCents - row.expenseCents;
    months.set(month, row);
  }
  return [...months.values()].sort((left, right) => right.month.localeCompare(left.month));
}

// ---------- Plaid errors and webhooks ----------

/** Errors meaning "this login doesn't offer that product (yet)": skip the product, don't flag the login. */
const SKIPPABLE_PRODUCT_ERRORS = new Set([
  "PRODUCTS_NOT_SUPPORTED",
  "PRODUCT_NOT_ENABLED",
  "PRODUCT_NOT_READY",
  "ADDITIONAL_CONSENT_REQUIRED",
  "INVALID_PRODUCT",
  "NO_ACCOUNTS",
  "NO_LIABILITY_ACCOUNTS",
  "NO_INVESTMENT_ACCOUNTS",
  "NO_INVESTMENT_AUTH_ACCOUNTS",
  "NO_AUTH_ACCOUNTS",
  "PRODUCTS_NOT_READY",
  "CONSENT_NOT_GRANTED",
]);

export function isSkippableProductError(code: string) {
  return SKIPPABLE_PRODUCT_ERRORS.has(code);
}

/** Errors that need the person to reconnect the login in Link's update mode. */
export const RECONNECT_ERRORS = new Set([
  "ITEM_LOGIN_REQUIRED",
  "PENDING_EXPIRATION",
  "PENDING_DISCONNECT",
  "ACCESS_NOT_GRANTED",
  "INVALID_CREDENTIALS",
  "INVALID_MFA",
  "ITEM_LOCKED",
  "USER_SETUP_REQUIRED",
  "INSUFFICIENT_CREDENTIALS",
  "USER_PERMISSION_REVOKED",
]);

export type SyncProduct = "transactions" | "liabilities" | "holdings" | "investment_transactions";
export const ALL_SYNC_PRODUCTS: SyncProduct[] = ["transactions", "liabilities", "holdings", "investment_transactions"];

export type WebhookAction =
  | { kind: "sync"; products: SyncProduct[] }
  | { kind: "status"; status: "ok" | "reconnect"; errorCode: string | null }
  | { kind: "ignore" };

/** What a Plaid webhook asks for: a sync of some products, a login status change, or nothing. */
export function webhookAction(payload: { webhook_type?: string; webhook_code?: string; error?: { error_code?: string } | null }): WebhookAction {
  const type = payload.webhook_type || "";
  const code = payload.webhook_code || "";
  if (type === "TRANSACTIONS" && ["SYNC_UPDATES_AVAILABLE", "DEFAULT_UPDATE", "HISTORICAL_UPDATE", "INITIAL_UPDATE", "TRANSACTIONS_REMOVED"].includes(code)) {
    return { kind: "sync", products: ["transactions"] };
  }
  if (type === "HOLDINGS" && code === "DEFAULT_UPDATE") return { kind: "sync", products: ["holdings"] };
  if (type === "INVESTMENTS_TRANSACTIONS" && ["DEFAULT_UPDATE", "HISTORICAL_UPDATE"].includes(code)) return { kind: "sync", products: ["investment_transactions"] };
  if (type === "LIABILITIES" && code === "DEFAULT_UPDATE") return { kind: "sync", products: ["liabilities"] };
  if (type === "ITEM") {
    if (code === "ERROR") {
      const errorCode = payload.error?.error_code || "ITEM_ERROR";
      return { kind: "status", status: RECONNECT_ERRORS.has(errorCode) ? "reconnect" : "ok", errorCode };
    }
    if (code === "PENDING_EXPIRATION" || code === "PENDING_DISCONNECT" || code === "USER_PERMISSION_REVOKED") return { kind: "status", status: "reconnect", errorCode: code };
    if (code === "LOGIN_REPAIRED") return { kind: "status", status: "ok", errorCode: null };
  }
  return { kind: "ignore" };
}

/** The first day of the investment transaction window: the same day `months` months ago (YYYY-MM-DD). */
export function monthsBefore(date: string, months: number) {
  const [year, month, day] = date.split("-").map(Number);
  const target = new Date(Date.UTC(year, month - 1 - months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString().slice(0, 10);
}

// ---------- cash flow breakdowns (Cash flow page) ----------

/** How a transaction counts in cash flow: income, spending, or not at all (excluded or a transfer). */
export function cashFlowSide(transaction: Pick<CashFlowTransaction, "amountCents" | "categoryId" | "excluded">, kinds: Map<number, CategoryKind>): "income" | "expense" | null {
  if (transaction.excluded) return null;
  const kind = transaction.categoryId === null ? null : kinds.get(transaction.categoryId) ?? null;
  if (kind === "transfer") return null;
  if (kind === "income" || (kind === null && transaction.amountCents > 0)) return "income";
  return "expense";
}

export type CashFlowShare = { categoryId: number | null; cents: number; share: number };
export type MerchantSpend = { merchant: string; cents: number; count: number };
export type CashFlowBreakdown = {
  incomeCents: number;
  expenseCents: number;
  netCents: number;
  /** Net as a share of income (0.25 = saved a quarter), or null without income. */
  savingsRate: number | null;
  /** Spending per category (null = uncategorized), largest first; categories netting to zero or less (only refunds) are left out. */
  spending: CashFlowShare[];
  /** Income per category, largest first. */
  income: CashFlowShare[];
  /** Spending per merchant (merchant name, else the description), largest first. */
  merchants: MerchantSpend[];
};

function shares(totals: Map<number | null, number>): CashFlowShare[] {
  const rows = [...totals].filter(([, cents]) => cents > 0).map(([categoryId, cents]) => ({ categoryId, cents, share: 0 }));
  const total = rows.reduce((sum, row) => sum + row.cents, 0);
  for (const row of rows) row.share = total ? row.cents / total : 0;
  return rows.sort((left, right) => right.cents - left.cents || (left.categoryId ?? -1) - (right.categoryId ?? -1));
}

/**
 * Totals, spending and income by category, and top merchants for a set of transactions
 * (one month or a year), counted the same way as cashFlowByMonth.
 */
export function cashFlowBreakdown(transactions: (CashFlowTransaction & { merchant?: string | null })[], categories: { id: number; kind: CategoryKind }[], merchantLimit = 10): CashFlowBreakdown {
  const kinds = new Map(categories.map((category) => [category.id, category.kind]));
  const spending = new Map<number | null, number>();
  const income = new Map<number | null, number>();
  const merchants = new Map<string, MerchantSpend>();
  let incomeCents = 0;
  let expenseCents = 0;
  for (const transaction of transactions) {
    const side = cashFlowSide(transaction, kinds);
    if (side === "income") {
      incomeCents += transaction.amountCents;
      income.set(transaction.categoryId, (income.get(transaction.categoryId) ?? 0) + transaction.amountCents);
    } else if (side === "expense") {
      expenseCents -= transaction.amountCents;
      spending.set(transaction.categoryId, (spending.get(transaction.categoryId) ?? 0) - transaction.amountCents);
      const name = (transaction.merchant || "").trim();
      if (name) {
        const key = name.toLowerCase();
        const row = merchants.get(key) ?? { merchant: name, cents: 0, count: 0 };
        row.cents -= transaction.amountCents;
        row.count += 1;
        merchants.set(key, row);
      }
    }
  }
  const netCents = incomeCents - expenseCents;
  return {
    incomeCents,
    expenseCents,
    netCents,
    savingsRate: incomeCents > 0 ? netCents / incomeCents : null,
    spending: shares(spending),
    income: shares(income),
    merchants: [...merchants.values()].filter((row) => row.cents > 0)
      .sort((left, right) => right.cents - left.cents || left.merchant.localeCompare(right.merchant)).slice(0, merchantLimit),
  };
}

/** The `count` months (YYYY-MM) ending with the month of `today` (YYYY-MM-DD), oldest first. */
export function recentMonths(today: string, count: number) {
  const [year, month] = today.split("-").map(Number);
  return Array.from({ length: count }, (_, index) => new Date(Date.UTC(year, month - 1 - (count - 1 - index), 1)).toISOString().slice(0, 7));
}

/** First and last day (YYYY-MM-DD) of a YYYY-MM month. */
export function monthBounds(month: string) {
  const [year, number] = month.split("-").map(Number);
  const last = new Date(Date.UTC(year, number, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}

/** cashFlowByMonth rows for exactly these months (in the order given), with zeros where nothing happened. */
export function fillMonths(rows: CashFlowMonth[], months: string[]): CashFlowMonth[] {
  const byMonth = new Map(rows.map((row) => [row.month, row]));
  return months.map((month) => byMonth.get(month) ?? { month, incomeCents: 0, expenseCents: 0, netCents: 0 });
}

export type DatePreset = "all" | "this-month" | "last-month" | "90-days" | "this-year" | "custom";

/** The inclusive YYYY-MM-DD range of a date preset on `today` (YYYY-MM-DD); open for "all" and "custom". */
export function datePresetRange(preset: DatePreset, today: string): { from?: string; to?: string } {
  if (preset === "this-month") return { from: `${today.slice(0, 7)}-01`, to: today };
  if (preset === "last-month") return monthBounds(recentMonths(today, 2)[0]);
  if (preset === "this-year") return { from: `${today.slice(0, 4)}-01-01`, to: today };
  if (preset === "90-days") {
    const [year, month, day] = today.split("-").map(Number);
    return { from: new Date(Date.UTC(year, month - 1, day - 89)).toISOString().slice(0, 10), to: today };
  }
  return {};
}
