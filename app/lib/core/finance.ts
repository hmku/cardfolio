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

export type StoredRuleTarget = RuleTarget & { id: number; categoryId: number | null; categorySource: CategorySource | null; excluded: boolean };

/**
 * Applying `rule` to stored transactions: the ids of those it wins under matchRule (as at sync
 * time, so a more specific rule keeps its matches) and that it would change. Transactions
 * categorized by hand are left alone.
 */
export function transactionsForRule(rule: RuleLike, rules: RuleLike[], transactions: StoredRuleTarget[]) {
  const all = [...rules.filter((item) => item.id !== rule.id), rule];
  return transactions
    .filter((transaction) => transaction.categorySource !== "manual" && matchRule(transaction, all)?.id === rule.id)
    .filter((transaction) => transaction.categoryId !== rule.categoryId || transaction.categorySource !== "rule"
      || (rule.setExcluded !== null && transaction.excluded !== rule.setExcluded))
    .map((transaction) => transaction.id);
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
    const side = cashFlowSide(transaction, kinds);
    if (!side) continue;
    const month = transaction.date.slice(0, 7);
    const row = months.get(month) ?? { month, incomeCents: 0, expenseCents: 0, netCents: 0 };
    if (side === "income") row.incomeCents += transaction.amountCents;
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
  // Items on /transactions/sync also get the legacy INITIAL_UPDATE / HISTORICAL_UPDATE / DEFAULT_UPDATE /
  // TRANSACTIONS_REMOVED codes next to SYNC_UPDATES_AVAILABLE; Plaid says to ignore them, and acting on
  // both would start two overlapping syncs of the same item.
  if (type === "TRANSACTIONS" && code === "SYNC_UPDATES_AVAILABLE") return { kind: "sync", products: ["transactions"] };
  if (type === "HOLDINGS" && code === "DEFAULT_UPDATE") return { kind: "sync", products: ["holdings"] };
  if (type === "INVESTMENTS_TRANSACTIONS" && ["DEFAULT_UPDATE", "HISTORICAL_UPDATE"].includes(code)) return { kind: "sync", products: ["investment_transactions"] };
  if (type === "LIABILITIES" && code === "DEFAULT_UPDATE") return { kind: "sync", products: ["liabilities"] };
  if (type === "ITEM") {
    if (code === "ERROR") {
      const errorCode = payload.error?.error_code || "ITEM_ERROR";
      // Only a reconnect error changes the status; other errors (an institution outage) must not clear
      // an earlier "reconnect" flag. LOGIN_REPAIRED or a successful sync does that.
      return RECONNECT_ERRORS.has(errorCode) ? { kind: "status", status: "reconnect", errorCode } : { kind: "ignore" };
    }
    if (code === "PENDING_EXPIRATION" || code === "PENDING_DISCONNECT" || code === "USER_PERMISSION_REVOKED") return { kind: "status", status: "reconnect", errorCode: code };
    if (code === "LOGIN_REPAIRED") return { kind: "status", status: "ok", errorCode: null };
  }
  return { kind: "ignore" };
}

/** Advance warnings: the login still works, but the person should reconnect it before it stops. */
const ADVANCE_WARNINGS = new Set(["PENDING_EXPIRATION", "PENDING_DISCONNECT"]);

export type ItemStatus = { status: "ok" | "reconnect"; errorCode: string | null };

export type ItemStatusEvent =
  /** The person reconnected in Link's update mode, or Plaid sent LOGIN_REPAIRED. */
  | { kind: "repaired" }
  /** A sync reached the bank; errorCode is a product error that doesn't need reconnecting, or null. */
  | { kind: "synced"; errorCode: string | null }
  /** Plaid reported an error (from an API call or an ITEM webhook). */
  | { kind: "error"; errorCode: string };

/**
 * A bank login's status after an event. A "reconnect" flag is only cleared by a repair, or by a
 * successful sync when it was a hard login error (the sync proves the login works again).
 * Advance warnings (PENDING_EXPIRATION, PENDING_DISCONNECT) stay until the person reconnects,
 * and an error that doesn't need reconnecting never hides one that does.
 */
export function nextItemStatus(current: { status: string | null; errorCode: string | null }, event: ItemStatusEvent): ItemStatus {
  if (event.kind === "repaired") return { status: "ok", errorCode: null };
  if (event.kind === "error" && RECONNECT_ERRORS.has(event.errorCode)) return { status: "reconnect", errorCode: event.errorCode };
  if (current.status === "reconnect" && (event.kind === "error" || ADVANCE_WARNINGS.has(current.errorCode || ""))) {
    return { status: "reconnect", errorCode: current.errorCode };
  }
  return { status: "ok", errorCode: event.errorCode };
}

/**
 * The products a login has synced, after a sync that may have covered only some of them (e.g.
 * a HOLDINGS webhook): the previous list plus those that synced now, minus any the login
 * doesn't have. Kept in ALL_SYNC_PRODUCTS order.
 */
export function mergeSyncedProducts(previous: readonly string[] | null | undefined, results: Partial<Record<SyncProduct, string>>) {
  const merged = new Set(previous || []);
  for (const [product, status] of Object.entries(results)) {
    if (status === "ok") merged.add(product);
    else if (status === "not_available") merged.delete(product);
  }
  return ALL_SYNC_PRODUCTS.filter((product) => merged.has(product));
}

/**
 * Logins hidden from a member with hideInvestments: those with investment accounts and no
 * other account. A login with no accounts at all, or a mixed one, stays visible (its
 * investment accounts are hidden one by one). Empty when hideInvestments is off. The
 * plaid_item_status view (migration 20261103000101_server_hide_investment_items) applies the
 * same rule in SQL; change both together.
 */
export function hiddenLoginIds<Id>(accounts: readonly { item_id: Id; type: string | null }[], hideInvestments: boolean) {
  const hidden = new Set<Id>();
  if (!hideInvestments) return hidden;
  const visible = new Set<Id>();
  for (const account of accounts) (account.type === "investment" ? hidden : visible).add(account.item_id);
  for (const id of visible) hidden.delete(id);
  return hidden;
}

type LoginAccount = { mask: string | null; subtype: string | null };
type StoredLogin<A extends LoginAccount = LoginAccount> = { institutionId: string | null; accounts: readonly A[]; syncedProducts?: readonly string[] | null };

/** Our sync steps that a Plaid item's products enable ("investments" covers holdings and investment transactions). */
export function syncProductsOf(itemProducts: readonly string[]): SyncProduct[] {
  const products: SyncProduct[] = [];
  if (itemProducts.includes("transactions")) products.push("transactions");
  if (itemProducts.includes("liabilities")) products.push("liabilities");
  if (itemProducts.includes("investments")) products.push("holdings", "investment_transactions");
  return products;
}

const accountKey = (account: LoginAccount) => `${account.mask}|${account.subtype || ""}`;

/** The first stored login at the same institution that has every new account with last digits (by digits and subtype). */
function matchingLogin<L extends StoredLogin>(institutionId: string | null | undefined, accounts: readonly LoginAccount[], existing: readonly L[]) {
  if (!institutionId) return null;
  const keys = accounts.filter((account) => account.mask).map(accountKey);
  if (keys.length === 0) return null;
  return existing.find((item) => {
    if (item.institutionId !== institutionId) return false;
    const known = new Set(item.accounts.filter((account) => account.mask).map(accountKey));
    return keys.every((value) => known.has(value));
  }) ?? null;
}

/**
 * Sync products the new login brings that the stored one doesn't sync. Unknown products on
 * either side (null) count as nothing new, so such a login stays a duplicate.
 */
function addedProducts(newProducts: readonly string[] | null | undefined, stored: readonly string[] | null | undefined): SyncProduct[] {
  if (!newProducts || !stored) return [];
  const have = new Set(stored);
  if (have.has("holdings") || have.has("investment_transactions")) { have.add("holdings"); have.add("investment_transactions"); }
  return syncProductsOf(newProducts).filter((product) => !have.has(product));
}

/**
 * Whether a newly connected login repeats one already stored: same institution, every
 * account with last digits matches one there by digits and subtype (the check Plaid suggests),
 * and it brings no product the stored login lacks (`products` are the new item's Plaid
 * products; a login connected again for Investments isn't a duplicate). Logins whose accounts
 * have no last digits are never treated as duplicates.
 */
export function isDuplicateLogin(
  institutionId: string | null | undefined,
  accounts: readonly LoginAccount[],
  existing: readonly StoredLogin[],
  products?: readonly string[] | null,
) {
  const match = matchingLogin(institutionId, accounts, existing);
  return !!match && addedProducts(products, match.syncedProducts).length === 0;
}

/** Whether a product step covers an account of this Plaid type. */
function productCovers(product: SyncProduct, type: string | null) {
  if (product === "holdings" || product === "investment_transactions") return type === "investment";
  if (product === "liabilities") return type === "credit";
  return type !== "investment";
}

type ConnectAccount = LoginAccount & { plaidAccountId: string; type: string | null };

export type LoginConnectPlan<Id> =
  | { kind: "new" }
  | { kind: "duplicate"; itemId: Id }
  /**
   * The same login connected again for products the stored one lacks (e.g. Investments). Both
   * are kept, but each account is stored once: `move` lists the stored rows (by id) that the new
   * login carries from now on, under its Plaid account id; the new login skips `ignore` (Plaid
   * account ids the stored login keeps), and the stored login skips the moved ones (`release`).
   */
  | { kind: "share"; itemId: Id; move: { rowId: number; plaidAccountId: string }[]; ignore: string[]; release: string[] };

/** What to do with a newly connected login, given the household's stored ones (see isDuplicateLogin). */
export function planLoginConnect<Id>(
  institutionId: string | null | undefined,
  accounts: readonly ConnectAccount[],
  products: readonly string[] | null | undefined,
  existing: readonly (StoredLogin<ConnectAccount & { rowId: number }> & { id: Id })[],
): LoginConnectPlan<Id> {
  const match = matchingLogin(institutionId, accounts, existing);
  if (!match) return { kind: "new" };
  const added = addedProducts(products, match.syncedProducts);
  const stored = new Map(match.accounts.filter((account) => account.mask).map((account) => [accountKey(account), account]));
  const move: { rowId: number; plaidAccountId: string }[] = [];
  const ignore: string[] = [];
  const release: string[] = [];
  let carried = 0;
  for (const account of accounts) {
    const wanted = added.some((product) => productCovers(product, account.type));
    const old = account.mask ? stored.get(accountKey(account)) : undefined;
    if (!wanted) { ignore.push(account.plaidAccountId); continue; }
    carried += 1;
    if (old) { move.push({ rowId: old.rowId, plaidAccountId: account.plaidAccountId }); release.push(old.plaidAccountId); }
  }
  if (carried === 0) return { kind: "duplicate", itemId: match.id };
  return { kind: "share", itemId: match.id, move, ignore, release };
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
export type MerchantSpend = {
  merchant: string;
  cents: number;
  count: number;
  /** The merchant's logo from its latest transaction that has one, if any. */
  logoUrl: string | null;
  /** The category most of this merchant's spending falls in (null = uncategorized), for an emoji fallback. */
  categoryId: number | null;
};
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
export function cashFlowBreakdown(transactions: (CashFlowTransaction & { merchant?: string | null; logoUrl?: string | null })[], categories: { id: number; kind: CategoryKind }[], merchantLimit = 10): CashFlowBreakdown {
  const kinds = new Map(categories.map((category) => [category.id, category.kind]));
  const spending = new Map<number | null, number>();
  const income = new Map<number | null, number>();
  const merchants = new Map<string, MerchantSpend & { byCategory: Map<number | null, number> }>();
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
        const row = merchants.get(key) ?? { merchant: name, cents: 0, count: 0, logoUrl: null, categoryId: null, byCategory: new Map() };
        row.cents -= transaction.amountCents;
        row.count += 1;
        if (transaction.logoUrl) row.logoUrl = transaction.logoUrl;
        row.byCategory.set(transaction.categoryId, (row.byCategory.get(transaction.categoryId) ?? 0) - transaction.amountCents);
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
      .sort((left, right) => right.cents - left.cents || left.merchant.localeCompare(right.merchant)).slice(0, merchantLimit)
      .map(({ byCategory, ...row }) => ({ ...row, categoryId: [...byCategory].reduce((best, entry) => (entry[1] > best[1] ? entry : best), [null, -Infinity] as [number | null, number])[0] })),
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

/**
 * How many months a "last `count` months" window ending `today` really covers: the full months before
 * this one plus the elapsed part of this one (Nov 2 of a 30-day month: 11 + 2/30). For per-month averages.
 */
export function elapsedMonths(today: string, count: number) {
  const day = Number(today.slice(8, 10));
  const days = Number(monthBounds(today.slice(0, 7)).to.slice(8, 10));
  return count - 1 + day / days;
}

/**
 * The index of the last month a chart window of `size` months shows, given the window it showed before
 * (`previousEnd`) and the month now picked (`index`, in a list of `total`): the window stays put while the
 * month is inside it and moves just far enough to show it otherwise.
 */
export function chartWindowEnd(previousEnd: number, index: number, size: number, total: number) {
  const last = total - 1;
  const end = Math.min(Math.max(previousEnd, Math.min(size - 1, last)), last);
  if (index < 0) return end;
  if (index > end) return Math.min(index, last);
  if (index < end - size + 1) return Math.min(Math.max(index + size - 1, 0), last);
  return end;
}

/**
 * A PostgREST filter for keyset paging over transactions sorted newest first (date, then id):
 * rows strictly after `cursor`, the last row already loaded. Unlike an offset, it doesn't skip or
 * repeat rows when edits or a sync change which rows match between pages.
 */
export function transactionsBefore(cursor: { date: string; id: number }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cursor.date) || !Number.isInteger(cursor.id)) throw new Error("Bad transaction cursor");
  return `or(date.lt.${cursor.date},and(date.eq.${cursor.date},id.lt.${cursor.id}))`;
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

// ---------- Cash flow page: default period, comparisons, category colors, the flow diagram ----------

/**
 * The period the Cash flow page opens on (YYYY-MM): this month once it has something to show
 * (from the 7th, with at least 5 counted transactions), otherwise last month, which is complete.
 */
export function defaultCashFlowPeriod(today: string, countedThisMonth: number) {
  return Number(today.slice(8, 10)) >= 7 && countedThisMonth >= 5 ? today.slice(0, 7) : recentMonths(today, 2)[0];
}

export type DateRange = { from: string; to: string };

/**
 * A Cash flow period ("12m" = the last 12 months including this one, or a YYYY-MM month) as a date
 * range, the period before it to compare against, and how many months it spans.
 */
export function cashFlowPeriodRanges(period: string, today: string): { range: DateRange; previousRange: DateRange; previousMonth: string | null; months: number } {
  if (period === "12m") {
    const months = recentMonths(today, 24);
    return { range: { from: `${months[12]}-01`, to: today }, previousRange: { from: `${months[0]}-01`, to: monthBounds(months[11]).to }, previousMonth: null, months: 12 };
  }
  const previousMonth = recentMonths(`${period}-01`, 2)[0];
  return { range: monthBounds(period), previousRange: monthBounds(previousMonth), previousMonth, months: 1 };
}

/** Relative change (0.1 = up 10%), or null when the earlier value is zero or less (nothing to compare with). */
export function relativeChange(current: number, previous: number) {
  return previous > 0 ? (current - previous) / previous : null;
}

export type ShareChange = CashFlowShare & { previousCents: number };

/** Each current category share with what the same category came to in the previous period (0 if nothing). */
export function withPreviousShares(current: CashFlowShare[], previous: CashFlowShare[]): ShareChange[] {
  const before = new Map(previous.map((row) => [row.categoryId, row.cents]));
  return current.map((row) => ({ ...row, previousCents: before.get(row.categoryId) ?? 0 }));
}

/**
 * The `keep` largest shares, and the rest folded together. A lone leftover isn't folded
 * (it's shown as itself), so "the rest" always stands for two or more categories.
 */
export function foldShares<T extends CashFlowShare>(rows: T[], keep: number): { shown: T[]; rest: T[]; restCents: number; restShare: number } {
  const limit = rows.length <= keep + 1 ? rows.length : keep;
  const rest = rows.slice(limit);
  return { shown: rows.slice(0, limit), rest, restCents: rest.reduce((sum, row) => sum + row.cents, 0), restShare: rest.reduce((sum, row) => sum + row.share, 0) };
}

/** How many category hues the chart palette has (globals.css --cat-0 … --cat-6). */
export const CATEGORY_HUES = 7;

/** Default hue per default category name: 0 orange, 1 aqua, 2 yellow, 3 magenta, 4 green, 5 violet, 6 red. */
const DEFAULT_CATEGORY_HUES: Record<string, number> = {
  "groceries": 4,
  "restaurants & bars": 0,
  "shopping": 3,
  "travel": 1,
  "transportation": 6,
  "rent & mortgage": 5,
  "utilities & phone": 2,
  "home": 1,
  "entertainment": 5,
  "health": 6,
  "personal care": 3,
  "insurance": 2,
  "services": 4,
  "gifts & donations": 3,
  "taxes & government": 5,
  "fees & interest": 6,
  "loan payments": 2,
};

/** The hue a category asks for: by default category name, else spread by id. "Other" has none (it's neutral). */
export function preferredCategoryHue(category: { id: number; name: string }): number | null {
  const name = category.name.trim().toLowerCase();
  if (name === "other") return null;
  return DEFAULT_CATEGORY_HUES[name] ?? Math.abs(category.id) % CATEGORY_HUES;
}

/**
 * Hues for categories shown together, largest first. Each keeps the hue it asks for unless a larger
 * category already has it; then it takes the next free hue, so no two shown categories share a color.
 * Categories without a hue ("Other", or past the palette) are left out of the map and drawn neutral.
 */
export function assignCategoryHues(categories: { id: number; name: string }[]): Map<number, number> {
  const hues = new Map<number, number>();
  const used = new Set<number>();
  for (const category of categories) {
    const preferred = preferredCategoryHue(category);
    if (preferred === null || used.size >= CATEGORY_HUES) continue;
    let hue = preferred;
    while (used.has(hue)) hue = (hue + 1) % CATEGORY_HUES;
    used.add(hue);
    hues.set(category.id, hue);
  }
  return hues;
}

export type FlowNode = {
  key: string;
  /** income / spending: one category (null = uncategorized); the rest stand for a group or a balance. */
  role: "income" | "spending" | "other-income" | "other-spending" | "savings" | "deficit";
  categoryId: number | null;
  cents: number;
  /** For the folded groups: how many categories they hold. */
  count: number;
};

/**
 * Nodes for an "income → spending" flow diagram: income categories on the left (plus "from savings"
 * when spending beat income), spending categories and what was saved on the right. Both sides add
 * up to the same total, so every left band fans out into the right column without gaps.
 */
export function cashFlowFlow(breakdown: Pick<CashFlowBreakdown, "income" | "spending">, options: { incomeNodes?: number; spendingNodes?: number } = {}) {
  const node = (role: FlowNode["role"], row: CashFlowShare): FlowNode => ({ key: `${role}:${row.categoryId}`, role, categoryId: row.categoryId, cents: row.cents, count: 1 });
  const income = foldShares(breakdown.income, options.incomeNodes ?? 3);
  const spending = foldShares(breakdown.spending, options.spendingNodes ?? 7);
  const sources = income.shown.map((row) => node("income", row));
  if (income.rest.length) sources.push({ key: "other-income", role: "other-income", categoryId: null, cents: income.restCents, count: income.rest.length });
  const targets = spending.shown.map((row) => node("spending", row));
  if (spending.rest.length) targets.push({ key: "other-spending", role: "other-spending", categoryId: null, cents: spending.restCents, count: spending.rest.length });
  const incomeCents = breakdown.income.reduce((sum, row) => sum + row.cents, 0);
  const spendingCents = breakdown.spending.reduce((sum, row) => sum + row.cents, 0);
  if (incomeCents > spendingCents) targets.push({ key: "savings", role: "savings", categoryId: null, cents: incomeCents - spendingCents, count: 0 });
  if (spendingCents > incomeCents) sources.push({ key: "deficit", role: "deficit", categoryId: null, cents: spendingCents - incomeCents, count: 0 });
  return { sources, targets, totalCents: Math.max(incomeCents, spendingCents), incomeCents, spendingCents };
}
