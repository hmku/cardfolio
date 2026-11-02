import type { SupabaseClient } from "@supabase/supabase-js";
import { FEE_LOOKBACK_DAYS, type CardPlaidData, type CardTransaction, type LinkedCard } from "./core/card-plaid.ts";
import { addDays, isoDate, parseDate } from "./core/dates.ts";
import { transactionsBefore, transactionsForRule, type CategoryKind, type CategorySource, type RuleField, type StoredRuleTarget } from "./core/finance.ts";

/**
 * Browser data layer for the finance pages (Transactions, Cash flow, Investments, Accounts).
 * Reads and writes Supabase directly under row-level security, like data.ts does for cards.
 * Synced Plaid data is read-only here except a transaction's category, notes, excluded and
 * reviewed flags and a bank account's owner. Amounts are integer cents; transaction amounts
 * are positive for money in and negative for money out (see app/lib/core/finance.ts).
 */

export type FinanceContext = { db: SupabaseClient; householdId: string };

type Row = Record<string, unknown>;
const num = (value: unknown) => Number(value);
const numOrNull = (value: unknown) => (value === null || value === undefined ? null : Number(value));
const text = (value: unknown) => (value === null || value === undefined ? null : String(value));

function check<T>(result: { data: T; error: { message: string } | null }, what: string): T {
  if (result.error) throw new Error(`Couldn't ${what}: ${result.error.message}`);
  return result.data;
}

/** Supabase caps a response at 1,000 rows; page through bigger reads. */
async function pageAll(build: (from: number, to: number) => PromiseLike<{ data: Row[] | null; error: { message: string } | null }>, what: string) {
  const rows: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const data = check(await build(from, from + 999), what) || [];
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}

/**
 * An ilike "contains" pattern for PostgREST: escapes \, % and _, and turns * (which PostgREST
 * rewrites to %, and which can't be escaped) into _, which matches it as one character.
 */
export function containsPattern(value: string) {
  return `%${value.trim().toLowerCase().replace(/[\\%_]/g, (match) => `\\${match}`).replace(/\*/g, "_")}%`;
}

// ---------- categories and rules ----------

export type Category = {
  id: number;
  name: string;
  kind: CategoryKind;
  emoji: string | null;
  color: string | null;
  sort: number;
  /** Plaid personal_finance_category codes (primary or detailed) mapped here by default. */
  plaidCategories: string[];
};

export type CategoryDraft = Partial<Omit<Category, "id">>;

const toCategory = (row: Row): Category => ({
  id: num(row.id),
  name: String(row.name),
  kind: row.kind as CategoryKind,
  emoji: text(row.emoji),
  color: text(row.color),
  sort: num(row.sort),
  plaidCategories: (row.plaid_categories as string[]) || [],
});

export async function loadCategories(context: FinanceContext): Promise<Category[]> {
  const rows = check(await context.db.from("categories").select("*").eq("household_id", context.householdId).order("sort").order("name"), "load categories") || [];
  return rows.map(toCategory);
}

export async function saveCategory(context: FinanceContext, id: number | null, draft: CategoryDraft): Promise<Category> {
  const values = {
    ...(draft.name !== undefined && { name: draft.name.trim() }),
    ...(draft.kind !== undefined && { kind: draft.kind }),
    ...(draft.emoji !== undefined && { emoji: draft.emoji || null }),
    ...(draft.color !== undefined && { color: draft.color || null }),
    ...(draft.sort !== undefined && { sort: Math.round(draft.sort) }),
    ...(draft.plaidCategories !== undefined && { plaid_categories: draft.plaidCategories }),
  };
  const query = id === null
    ? context.db.from("categories").insert({ household_id: context.householdId, ...values })
    : context.db.from("categories").update(values).eq("household_id", context.householdId).eq("id", id);
  return toCategory(check(await query.select("*").single(), id === null ? "add the category" : "save the category") as Row);
}

/** Deletes a category; its transactions become uncategorized and its rules are deleted. */
export async function deleteCategory(context: FinanceContext, id: number) {
  check(await context.db.from("categories").delete().eq("household_id", context.householdId).eq("id", id), "delete the category");
}

export type CategoryRule = {
  id: number;
  /** Case-insensitive text the merchant name and/or description must contain. */
  matchText: string;
  matchField: RuleField;
  /** Only this bank account (BankAccount.id), or null for any. */
  plaidAccountId: number | null;
  categoryId: number;
  /** Also mark matches excluded (true) or included (false); null leaves it. */
  setExcluded: boolean | null;
};

export type CategoryRuleDraft = Partial<Omit<CategoryRule, "id">>;

const toRule = (row: Row): CategoryRule => ({
  id: num(row.id),
  matchText: String(row.match_text),
  matchField: row.match_field as RuleField,
  plaidAccountId: numOrNull(row.plaid_account_id),
  categoryId: num(row.category_id),
  setExcluded: row.set_excluded === null || row.set_excluded === undefined ? null : Boolean(row.set_excluded),
});

export async function loadCategoryRules(context: FinanceContext): Promise<CategoryRule[]> {
  const rows = check(await context.db.from("category_rules").select("*").eq("household_id", context.householdId).order("id"), "load category rules") || [];
  return rows.map(toRule);
}

export async function saveCategoryRule(context: FinanceContext, id: number | null, draft: CategoryRuleDraft): Promise<CategoryRule> {
  const values = {
    ...(draft.matchText !== undefined && { match_text: draft.matchText.trim() }),
    ...(draft.matchField !== undefined && { match_field: draft.matchField }),
    ...(draft.plaidAccountId !== undefined && { plaid_account_id: draft.plaidAccountId }),
    ...(draft.categoryId !== undefined && { category_id: draft.categoryId }),
    ...(draft.setExcluded !== undefined && { set_excluded: draft.setExcluded }),
  };
  const query = id === null
    ? context.db.from("category_rules").insert({ household_id: context.householdId, ...values })
    : context.db.from("category_rules").update(values).eq("household_id", context.householdId).eq("id", id);
  return toRule(check(await query.select("*").single(), id === null ? "add the rule" : "save the rule") as Row);
}

export async function deleteCategoryRule(context: FinanceContext, id: number) {
  check(await context.db.from("category_rules").delete().eq("household_id", context.householdId).eq("id", id), "delete the rule");
}

/**
 * Applies a rule to transactions already stored (new ones get it during sync). Matches the way
 * the sync does (core matchRule), so a more specific rule keeps its transactions, and never
 * touches transactions a person categorized by hand. Resolves to how many changed.
 */
export async function applyRuleToExisting(context: FinanceContext, rule: CategoryRule) {
  if (!rule.matchText.trim()) return 0;
  const columns = rule.matchField === "merchant" ? ["merchant_name"] : rule.matchField === "name" ? ["name"] : ["merchant_name", "name"];
  // Narrow down in the database, then let the core matcher pick the winning rule per transaction.
  const [rules, ...matches] = await Promise.all([
    loadCategoryRules(context),
    ...columns.map((column) => pageAll((from, to) => {
      let query = context.db.from("transactions")
        .select("id, name, merchant_name, plaid_account_id, category_id, category_source, excluded")
        .eq("household_id", context.householdId)
        .ilike(column, containsPattern(rule.matchText))
        .or("category_source.is.null,category_source.neq.manual");
      if (rule.plaidAccountId !== null) query = query.eq("plaid_account_id", rule.plaidAccountId);
      return query.order("id").range(from, to);
    }, "apply the rule")),
  ]);
  const candidates = new Map<number, StoredRuleTarget>();
  for (const row of matches.flat()) {
    candidates.set(num(row.id), {
      id: num(row.id),
      name: String(row.name),
      merchantName: text(row.merchant_name),
      plaidAccountId: num(row.plaid_account_id),
      categoryId: numOrNull(row.category_id),
      categorySource: (row.category_source as CategorySource | null) ?? null,
      excluded: Boolean(row.excluded),
    });
  }
  const ids = transactionsForRule(rule, rules, [...candidates.values()]);
  const values = { category_id: rule.categoryId, category_source: "rule", ...(rule.setExcluded !== null && { excluded: rule.setExcluded }) };
  for (let index = 0; index < ids.length; index += 200) {
    check(await context.db.from("transactions").update(values).eq("household_id", context.householdId).in("id", ids.slice(index, index + 200)), "apply the rule");
  }
  return ids.length;
}

// ---------- bank logins and accounts ----------

export type BankLogin = {
  id: number;
  institutionName: string | null;
  status: "ok" | "reconnect";
  errorCode: string | null;
  consentExpiresAt: string | null;
  lastSyncedAt: string | null;
  /** Plaid's transactions_update_status, e.g. HISTORICAL_UPDATE_COMPLETE once two years are in. */
  transactionsStatus: string | null;
  syncedProducts: string[];
};

export async function loadBankLogins(context: FinanceContext): Promise<BankLogin[]> {
  const rows = check(await context.db.from("plaid_item_status").select("*").eq("household_id", context.householdId).order("created_at"), "load bank connections") || [];
  return rows.map((row) => ({
    id: num(row.id),
    institutionName: text(row.institution_name),
    status: row.status as BankLogin["status"],
    errorCode: text(row.error_code),
    consentExpiresAt: text(row.consent_expires_at),
    lastSyncedAt: text(row.last_synced_at),
    transactionsStatus: text(row.transactions_status),
    syncedProducts: (row.synced_products as string[]) || [],
  }));
}

export type BankAccount = {
  id: number;
  itemId: number;
  institutionName: string | null;
  name: string;
  officialName: string | null;
  mask: string | null;
  /** Plaid type: depository, credit, loan, investment, other. */
  type: string | null;
  subtype: string | null;
  /** The Cardfolio card (accounts.id) a credit card is linked to. */
  cardAccountId: number | null;
  personId: number | null;
  /** As Plaid reports them: a card's or loan's current balance is the positive amount owed. */
  currentCents: number | null;
  availableCents: number | null;
  limitCents: number | null;
  currency: string | null;
  balancesUpdatedAt: string | null;
  /** Credit cards only (Liabilities). */
  statement: {
    lastStatementCents: number | null;
    lastStatementDate: string | null;
    minimumPaymentCents: number | null;
    nextDueDate: string | null;
    lastPaymentCents: number | null;
    lastPaymentDate: string | null;
    overdue: boolean | null;
    updatedAt: string | null;
  };
};

/** True for accounts whose balance is owed (counts negative in net worth). */
export const isDebt = (account: Pick<BankAccount, "type">) => account.type === "credit" || account.type === "loan";

export async function loadBankAccounts(context: FinanceContext): Promise<BankAccount[]> {
  const [rows, logins] = await Promise.all([
    context.db.from("plaid_accounts").select("*").eq("household_id", context.householdId).order("name"),
    loadBankLogins(context),
  ]);
  const institution = new Map(logins.map((login) => [login.id, login.institutionName]));
  return (check(rows, "load bank accounts") || []).map((row: Row) => ({
    id: num(row.id),
    itemId: num(row.item_id),
    institutionName: institution.get(num(row.item_id)) ?? null,
    name: String(row.name),
    officialName: text(row.official_name),
    mask: text(row.mask),
    type: text(row.type),
    subtype: text(row.subtype),
    cardAccountId: numOrNull(row.account_id),
    personId: numOrNull(row.person_id),
    currentCents: numOrNull(row.current_balance_cents),
    availableCents: numOrNull(row.available_balance_cents),
    limitCents: numOrNull(row.credit_limit_cents),
    currency: text(row.currency),
    balancesUpdatedAt: text(row.balances_updated_at),
    statement: {
      lastStatementCents: numOrNull(row.last_statement_balance_cents),
      lastStatementDate: text(row.last_statement_date),
      minimumPaymentCents: numOrNull(row.minimum_payment_cents),
      nextDueDate: text(row.next_payment_due_date),
      lastPaymentCents: numOrNull(row.last_payment_cents),
      lastPaymentDate: text(row.last_payment_date),
      overdue: row.is_overdue === null || row.is_overdue === undefined ? null : Boolean(row.is_overdue),
      updatedAt: text(row.liabilities_updated_at),
    },
  }));
}

/** Sets whose account a bank account is (people.id), or null. */
export async function setBankAccountOwner(context: FinanceContext, id: number, personId: number | null) {
  check(await context.db.from("plaid_accounts").update({ person_id: personId }).eq("household_id", context.householdId).eq("id", id), "save the owner");
}

// ---------- transactions ----------

export type Transaction = {
  id: number;
  plaidAccountId: number;
  plaidTransactionId: string;
  date: string;
  authorizedDate: string | null;
  /** Positive = money in, negative = money out. */
  amountCents: number;
  currency: string | null;
  name: string;
  merchantName: string | null;
  logoUrl: string | null;
  website: string | null;
  plaidCategoryPrimary: string | null;
  plaidCategoryDetailed: string | null;
  pending: boolean;
  paymentChannel: string | null;
  categoryId: number | null;
  categorySource: CategorySource | null;
  notes: string | null;
  excluded: boolean;
  reviewed: boolean;
};

const toTransaction = (row: Row): Transaction => ({
  id: num(row.id),
  plaidAccountId: num(row.plaid_account_id),
  plaidTransactionId: String(row.plaid_transaction_id),
  date: String(row.date),
  authorizedDate: text(row.authorized_date),
  amountCents: num(row.amount_cents),
  currency: text(row.currency),
  name: String(row.name),
  merchantName: text(row.merchant_name),
  logoUrl: text(row.logo_url),
  website: text(row.website),
  plaidCategoryPrimary: text(row.plaid_category_primary),
  plaidCategoryDetailed: text(row.plaid_category_detailed),
  pending: Boolean(row.pending),
  paymentChannel: text(row.payment_channel),
  categoryId: numOrNull(row.category_id),
  categorySource: (row.category_source as CategorySource | null) ?? null,
  notes: text(row.notes),
  excluded: Boolean(row.excluded),
  reviewed: Boolean(row.reviewed),
});

const TRANSACTION_COLUMNS = "id, plaid_account_id, plaid_transaction_id, date, authorized_date, amount_cents, currency, name, merchant_name, logo_url, website, plaid_category_primary, plaid_category_detailed, pending, payment_channel, category_id, category_source, notes, excluded, reviewed";

export type TransactionQuery = {
  /** Words that must appear in the merchant, description or notes (case-insensitive). */
  search?: string;
  accountIds?: number[];
  /** Category ids; include null for uncategorized. */
  categoryIds?: (number | null)[];
  /** Inclusive YYYY-MM-DD bounds on the posted date. */
  from?: string;
  to?: string;
  /** Excluded transactions are included unless this is false. */
  includeExcluded?: boolean;
  unreviewedOnly?: boolean;
  /** Only money in (> 0) or money out (< 0). */
  direction?: "in" | "out";
  /** Page size (default 50, at most 1000) and offset for paging. */
  limit?: number;
  offset?: number;
  /** Keyset paging: only rows after this one (the last row of the previous page). Use instead of `offset`. */
  before?: { date: string; id: number };
};

/** Transactions newest first (date, then id), filtered. Returns the page and whether more exist. */
export async function loadTransactions(context: FinanceContext, query: TransactionQuery = {}): Promise<{ transactions: Transaction[]; hasMore: boolean }> {
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 1000);
  const offset = Math.max(query.offset ?? 0, 0);
  let request = context.db.from("transactions").select(TRANSACTION_COLUMNS).eq("household_id", context.householdId);
  for (const word of (query.search || "").split(/\s+/).filter(Boolean)) request = request.ilike("search_text", containsPattern(word));
  if (query.accountIds?.length) request = request.in("plaid_account_id", query.accountIds);
  // PostgREST takes one `or` here, so both conditions go in one logic tree: `.or()` wraps its argument
  // in or(…), so a single tree is passed without its own "or(" … ")", and two are ANDed inside it.
  const trees: string[] = [];
  if (query.categoryIds?.length) {
    const ids = query.categoryIds.filter((id): id is number => id !== null);
    const parts = [...(ids.length ? [`category_id.in.(${ids.join(",")})`] : []), ...(query.categoryIds.includes(null) ? ["category_id.is.null"] : [])];
    trees.push(`or(${parts.join(",")})`);
  }
  if (query.before) trees.push(transactionsBefore(query.before));
  if (trees.length) request = request.or(trees.length === 1 ? trees[0].slice(3, -1) : `and(${trees.join(",")})`);
  if (query.from) request = request.gte("date", query.from);
  if (query.to) request = request.lte("date", query.to);
  if (query.includeExcluded === false) request = request.eq("excluded", false);
  if (query.unreviewedOnly) request = request.eq("reviewed", false);
  if (query.direction === "in") request = request.gt("amount_cents", 0);
  if (query.direction === "out") request = request.lt("amount_cents", 0);
  // One extra row tells whether there's another page.
  const rows = check(await request.order("date", { ascending: false }).order("id", { ascending: false }).range(offset, offset + limit), "load transactions") || [];
  return { transactions: rows.slice(0, limit).map(toTransaction), hasMore: rows.length > limit };
}

/** Every transaction in a date range with only what cash flow needs (paged past 1,000 rows); `merchant` is the merchant name, else the description. */
export async function loadCashFlowTransactions(context: FinanceContext, from: string, to: string) {
  const rows = await pageAll((start, end) => context.db.from("transactions")
    .select("id, date, amount_cents, category_id, excluded, plaid_account_id, merchant_name, name, logo_url")
    .eq("household_id", context.householdId).gte("date", from).lte("date", to)
    .order("date").order("id").range(start, end), "load cash flow");
  return rows.map((row) => ({ id: num(row.id), date: String(row.date), amountCents: num(row.amount_cents), categoryId: numOrNull(row.category_id), excluded: Boolean(row.excluded), plaidAccountId: num(row.plaid_account_id), merchant: text(row.merchant_name) || text(row.name), logoUrl: text(row.logo_url) || null }));
}

export type TransactionPatch = { categoryId?: number | null; notes?: string | null; excluded?: boolean; reviewed?: boolean };

function patchValues(patch: TransactionPatch) {
  return {
    // A person's category choice is never overwritten by later syncs or rules.
    // Clearing it ("Uncategorized") is a choice too, so it's recorded as manual as well.
    ...(patch.categoryId !== undefined && { category_id: patch.categoryId, category_source: "manual" }),
    ...(patch.notes !== undefined && { notes: patch.notes?.trim() || null }),
    ...(patch.excluded !== undefined && { excluded: patch.excluded }),
    ...(patch.reviewed !== undefined && { reviewed: patch.reviewed }),
  };
}

export async function updateTransaction(context: FinanceContext, id: number, patch: TransactionPatch): Promise<Transaction> {
  const row = check(await context.db.from("transactions").update(patchValues(patch)).eq("household_id", context.householdId).eq("id", id).select(TRANSACTION_COLUMNS).single(), "save the transaction");
  return toTransaction(row as Row);
}

/** The same change on many transactions (bulk recategorize, mark reviewed). */
export async function updateTransactions(context: FinanceContext, ids: number[], patch: TransactionPatch) {
  for (let index = 0; index < ids.length; index += 200) {
    check(await context.db.from("transactions").update(patchValues(patch)).eq("household_id", context.householdId).in("id", ids.slice(index, index + 200)), "save the transactions");
  }
}

// ---------- investments ----------

export type Security = {
  id: number;
  name: string | null;
  tickerSymbol: string | null;
  type: string | null;
  isCashEquivalent: boolean | null;
  closePrice: number | null;
  closePriceAsOf: string | null;
  currency: string | null;
};

export type Holding = {
  id: number;
  plaidAccountId: number;
  security: Security;
  quantity: number;
  costBasisCents: number | null;
  /** Price per unit in dollars, as the institution reports it. */
  institutionPrice: number | null;
  institutionPriceAsOf: string | null;
  institutionValueCents: number | null;
  currency: string | null;
  updatedAt: string;
};

const toSecurity = (row: Row): Security => ({
  id: num(row.id),
  name: text(row.name),
  tickerSymbol: text(row.ticker_symbol),
  type: text(row.type),
  isCashEquivalent: row.is_cash_equivalent === null || row.is_cash_equivalent === undefined ? null : Boolean(row.is_cash_equivalent),
  closePrice: numOrNull(row.close_price),
  closePriceAsOf: text(row.close_price_as_of),
  currency: text(row.currency),
});

export async function loadSecurities(context: FinanceContext): Promise<Map<number, Security>> {
  const rows = await pageAll((from, to) => context.db.from("securities").select("*").eq("household_id", context.householdId).order("id").range(from, to), "load securities");
  return new Map(rows.map((row) => [num(row.id), toSecurity(row)]));
}

/** Current positions, largest value first. */
export async function loadHoldings(context: FinanceContext): Promise<Holding[]> {
  const [rows, securities] = await Promise.all([
    pageAll((from, to) => context.db.from("holdings").select("*").eq("household_id", context.householdId).order("id").range(from, to), "load holdings"),
    loadSecurities(context),
  ]);
  return rows
    .map((row) => ({
      id: num(row.id),
      plaidAccountId: num(row.plaid_account_id),
      security: securities.get(num(row.security_id)) ?? { id: num(row.security_id), name: null, tickerSymbol: null, type: null, isCashEquivalent: null, closePrice: null, closePriceAsOf: null, currency: null },
      quantity: num(row.quantity),
      costBasisCents: numOrNull(row.cost_basis_cents),
      institutionPrice: numOrNull(row.institution_price),
      institutionPriceAsOf: text(row.institution_price_as_of),
      institutionValueCents: numOrNull(row.institution_value_cents),
      currency: text(row.currency),
      updatedAt: String(row.updated_at),
    }))
    .sort((left, right) => (right.institutionValueCents ?? 0) - (left.institutionValueCents ?? 0));
}

export type InvestmentTransaction = {
  id: number;
  plaidAccountId: number;
  securityId: number | null;
  date: string;
  name: string;
  quantity: number | null;
  /** Positive = cash into the account (sale, dividend), negative = cash out (buy, fee). */
  amountCents: number;
  price: number | null;
  feesCents: number | null;
  type: string | null;
  subtype: string | null;
  currency: string | null;
};

export async function loadInvestmentTransactions(context: FinanceContext, options: { from?: string; plaidAccountId?: number; limit?: number; offset?: number } = {}): Promise<InvestmentTransaction[]> {
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 1000);
  const offset = Math.max(options.offset ?? 0, 0);
  let request = context.db.from("investment_transactions").select("*").eq("household_id", context.householdId);
  if (options.from) request = request.gte("date", options.from);
  if (options.plaidAccountId) request = request.eq("plaid_account_id", options.plaidAccountId);
  const rows = check(await request.order("date", { ascending: false }).order("id", { ascending: false }).range(offset, offset + limit - 1), "load investment transactions") || [];
  return rows.map((row: Row) => ({
    id: num(row.id),
    plaidAccountId: num(row.plaid_account_id),
    securityId: numOrNull(row.security_id),
    date: String(row.date),
    name: String(row.name),
    quantity: numOrNull(row.quantity),
    amountCents: num(row.amount_cents),
    price: numOrNull(row.price),
    feesCents: numOrNull(row.fees_cents),
    type: text(row.type),
    subtype: text(row.subtype),
    currency: text(row.currency),
  }));
}

// ---------- manual accounts and net worth ----------

export type ManualAccountKind = "cash" | "investment" | "private_investment" | "retirement" | "real_estate" | "vehicle" | "crypto" | "loan" | "other";

export const MANUAL_ACCOUNT_KINDS: { value: ManualAccountKind; label: string }[] = [
  { value: "cash", label: "Cash" },
  { value: "investment", label: "Investment" },
  { value: "private_investment", label: "Private investment" },
  { value: "retirement", label: "Retirement" },
  { value: "real_estate", label: "Real estate" },
  { value: "vehicle", label: "Vehicle" },
  { value: "crypto", label: "Crypto" },
  { value: "loan", label: "Loan" },
  { value: "other", label: "Other" },
];

export type ManualAccount = {
  id: number;
  name: string;
  kind: ManualAccountKind;
  /** A debt: counts negative in net worth. */
  liability: boolean;
  /** Positive value (or amount owed when liability). */
  balanceCents: number;
  currency: string;
  balanceUpdatedAt: string;
  personId: number | null;
  notes: string | null;
  archived: boolean;
  sort: number;
};

export type ManualAccountDraft = Partial<Omit<ManualAccount, "id" | "balanceUpdatedAt">>;

const toManual = (row: Row): ManualAccount => ({
  id: num(row.id),
  name: String(row.name),
  kind: row.kind as ManualAccountKind,
  liability: Boolean(row.liability),
  balanceCents: num(row.balance_cents),
  currency: String(row.currency || "USD"),
  balanceUpdatedAt: String(row.balance_updated_at),
  personId: numOrNull(row.person_id),
  notes: text(row.notes),
  archived: Boolean(row.archived),
  sort: num(row.sort),
});

export async function loadManualAccounts(context: FinanceContext): Promise<ManualAccount[]> {
  const rows = check(await context.db.from("manual_accounts").select("*").eq("household_id", context.householdId).order("sort").order("name"), "load manual accounts") || [];
  return rows.map(toManual);
}

/**
 * Adds or edits a manual account (e.g. "Edgar Street Capital"). A new balance also records
 * today's balance snapshot, so net worth history shows the change from today.
 */
export async function saveManualAccount(context: FinanceContext, id: number | null, draft: ManualAccountDraft, today = isoDate(new Date())): Promise<ManualAccount> {
  const values = {
    ...(draft.name !== undefined && { name: draft.name.trim() }),
    ...(draft.kind !== undefined && { kind: draft.kind }),
    ...(draft.liability !== undefined && { liability: draft.liability }),
    ...(draft.balanceCents !== undefined && { balance_cents: Math.round(draft.balanceCents), balance_updated_at: new Date().toISOString() }),
    ...(draft.currency !== undefined && { currency: draft.currency }),
    ...(draft.personId !== undefined && { person_id: draft.personId }),
    ...(draft.notes !== undefined && { notes: draft.notes?.trim() || null }),
    ...(draft.archived !== undefined && { archived: draft.archived }),
    ...(draft.sort !== undefined && { sort: Math.round(draft.sort) }),
  };
  const query = id === null
    ? context.db.from("manual_accounts").insert({ household_id: context.householdId, ...values })
    : context.db.from("manual_accounts").update(values).eq("household_id", context.householdId).eq("id", id);
  const account = toManual(check(await query.select("*").single(), id === null ? "add the account" : "save the account") as Row);
  if (draft.balanceCents !== undefined || draft.liability !== undefined || id === null) {
    check(await context.db.from("balance_snapshots").upsert({
      household_id: context.householdId,
      date: today,
      plaid_account_id: null,
      manual_account_id: account.id,
      balance_cents: account.liability ? -account.balanceCents || 0 : account.balanceCents,
      currency: account.currency,
    }, { onConflict: "plaid_account_id,manual_account_id,date" }), "record the balance");
  }
  return account;
}

/** Deletes a manual account and its history. Prefer `archived: true` to keep the history. */
export async function deleteManualAccount(context: FinanceContext, id: number) {
  check(await context.db.from("manual_accounts").delete().eq("household_id", context.householdId).eq("id", id), "delete the account");
}

export type BalanceSnapshot = {
  date: string;
  plaidAccountId: number | null;
  manualAccountId: number | null;
  /** Contribution to net worth: assets positive, debts negative. */
  balanceCents: number;
};

/**
 * Daily balances from `from` (YYYY-MM-DD) on, oldest first, optionally for one account. Feed to
 * balanceSeries() in core/investments. Pass a `from` (snapshotLoadStart) where you can: there's a row
 * per account per day.
 */
export async function loadBalanceSnapshots(context: FinanceContext, from?: string | null, account?: { plaidAccountId: number } | { manualAccountId: number }): Promise<BalanceSnapshot[]> {
  const rows = await pageAll((start, end) => {
    let request = context.db.from("balance_snapshots").select("date, plaid_account_id, manual_account_id, balance_cents").eq("household_id", context.householdId);
    if (from) request = request.gte("date", from);
    if (account && "plaidAccountId" in account) request = request.eq("plaid_account_id", account.plaidAccountId);
    if (account && "manualAccountId" in account) request = request.eq("manual_account_id", account.manualAccountId);
    return request.order("date").order("id").range(start, end);
  }, "load balance history");
  return rows.map((row) => ({ date: String(row.date), plaidAccountId: numOrNull(row.plaid_account_id), manualAccountId: numOrNull(row.manual_account_id), balanceCents: num(row.balance_cents) }));
}

// ---------- card features (Cards and Credits tabs) ----------

const CARD_TRANSACTION_COLUMNS = "id, plaid_account_id, date, amount_cents, name, merchant_name, pending, plaid_category_primary, plaid_category_detailed";

const toCardTransaction = (row: Row): CardTransaction => ({
  id: num(row.id),
  plaidAccountId: num(row.plaid_account_id),
  date: String(row.date),
  amountCents: num(row.amount_cents),
  name: String(row.name),
  merchantName: text(row.merchant_name),
  pending: Boolean(row.pending),
  categoryPrimary: text(row.plaid_category_primary),
  categoryDetailed: text(row.plaid_category_detailed),
});

/**
 * Plaid data for the card pages (see app/lib/core/card-plaid.ts): linked credit cards with
 * their balances and statements, plus only the transactions those features read: money in
 * over the last ~13 months (payments and statement credits), annual fee postings, and
 * purchases on cards in a welcome-bonus window (`bonusWindows`, by Cardfolio account id,
 * YYYY-MM-DD bounds). Works with the service-role client too (the reminder cron).
 */
export async function loadCardPlaidData(context: FinanceContext, options: { today: string; bonusWindows?: { accountId: number; from: string; to: string }[] }): Promise<CardPlaidData> {
  const [accounts, logins] = await Promise.all([loadBankAccounts(context), loadBankLogins(context).catch(() => [] as BankLogin[])]);
  const status = new Map(logins.map((login) => [login.id, login.transactionsStatus]));
  const linked = accounts.filter((account) => account.type === "credit" && account.cardAccountId !== null);
  if (!linked.length) return { cards: [], transactions: [] };
  const ids = linked.map((account) => account.id);
  const since = isoDate(addDays(parseDate(options.today)!, -FEE_LOOKBACK_DAYS));
  const base = () => context.db.from("transactions").select(CARD_TRANSACTION_COLUMNS).eq("household_id", context.householdId).in("plaid_account_id", ids);
  const windows = (options.bonusWindows || []).flatMap((window) => {
    const card = linked.find((account) => account.cardAccountId === window.accountId);
    return card ? [{ ...window, plaidAccountId: card.id }] : [];
  });
  const [moneyIn, fees, spend, firsts] = await Promise.all([
    pageAll((start, end) => base().gt("amount_cents", 0).gte("date", since).order("date").order("id").range(start, end), "load card payments and credits"),
    pageAll((start, end) => base().gte("date", since).or('name.ilike."%annual fee%",name.ilike."%membership fee%",name.ilike."%annual membership%"').order("date").order("id").range(start, end), "load annual fees"),
    Promise.all(windows.map((window) => pageAll((start, end) => context.db.from("transactions").select(CARD_TRANSACTION_COLUMNS)
      .eq("household_id", context.householdId).eq("plaid_account_id", window.plaidAccountId).lt("amount_cents", 0)
      .gte("date", window.from).lte("date", window.to).order("date").order("id").range(start, end), "load bonus spend"))),
    Promise.all(windows.map(async (window) => {
      const rows = check(await context.db.from("transactions").select("date").eq("household_id", context.householdId)
        .eq("plaid_account_id", window.plaidAccountId).order("date").limit(1), "load card history") || [];
      return [window.plaidAccountId, rows[0] ? String(rows[0].date) : null] as const;
    })),
  ]);
  const firstDates = new Map(firsts);
  const transactions = new Map<number, CardTransaction>();
  for (const row of [...moneyIn, ...fees, ...spend.flat()]) transactions.set(num(row.id), toCardTransaction(row));
  const cards: LinkedCard[] = linked.map((account) => ({
    plaidAccountId: account.id,
    accountId: account.cardAccountId!,
    currentCents: account.currentCents,
    limitCents: account.limitCents,
    statementCents: account.statement.lastStatementCents,
    statementDate: account.statement.lastStatementDate,
    minimumCents: account.statement.minimumPaymentCents,
    dueDate: account.statement.nextDueDate,
    lastPaymentCents: account.statement.lastPaymentCents,
    lastPaymentDate: account.statement.lastPaymentDate,
    overdue: account.statement.overdue,
    updatedAt: account.balancesUpdatedAt,
    historyComplete: status.get(account.itemId) ? status.get(account.itemId) === "HISTORICAL_UPDATE_COMPLETE" : null,
    ...(firstDates.has(account.id) && { firstTransactionDate: firstDates.get(account.id) ?? null }),
  }));
  return { cards, transactions: [...transactions.values()] };
}
