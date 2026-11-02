import type { SupabaseClient } from "@supabase/supabase-js";
import { isoDate } from "@/app/lib/core/dates";
import {
  ALL_SYNC_PRODUCTS,
  balanceColumns,
  isSkippableProductError,
  mergeSyncedProducts,
  monthsBefore,
  nextItemStatus,
  planTransactionWrites,
  plaidAmountToCents,
  RECONNECT_ERRORS,
  snapshotRows,
  toCents,
  type CategoryKind,
  type CategoryLike,
  type CategorySource,
  type PlaidTransaction,
  type RuleField,
  type RuleLike,
  type StoredUserFields,
  type SyncProduct,
} from "@/app/lib/core/finance";
import { todayInTimeZone } from "@/app/lib/core/reminders";
import { decryptToken, getAccounts, noteItemError, plaid, PlaidApiError, syncItemAccounts, type PlaidAccount } from "./plaid";

/**
 * Pulls everything Plaid has for a bank login into Cardfolio's tables: accounts and their
 * balances, transactions (/transactions/sync), card statement details (/liabilities/get),
 * holdings and investment transactions, then today's balance snapshots.
 *
 * Only products the login actually has (Plaid's item.products) are called, so a sync never
 * adds a billable product to a login. A product the bank can't provide (yet) is skipped; a
 * login error marks the item for reconnecting and stops that item's sync.
 */

export type SyncContext = { db: SupabaseClient; householdId: string };

export type ProductStatus = "ok" | "skipped" | "not_available" | "error";

export type ItemSyncResult = {
  itemId: number;
  institutionName: string | null;
  ok: boolean;
  error?: string;
  accounts: number;
  products: Partial<Record<SyncProduct, ProductStatus>>;
  transactions: { added: number; modified: number; removed: number; skipped: number };
  holdings: number;
  investmentTransactions: number;
  transactionsStatus: string | null;
};

const TIME_ZONE = process.env.REMINDER_TIME_ZONE || "America/New_York";
const CHUNK = 500;
const PAGE = 500;
const MAX_SYNC_RESTARTS = 3;

/** Today's date (YYYY-MM-DD) in the household's time zone, for snapshots. */
export function syncDate() {
  return isoDate(todayInTimeZone(TIME_ZONE));
}

function chunks<T>(rows: T[], size = CHUNK) {
  const out: T[][] = [];
  for (let index = 0; index < rows.length; index += size) out.push(rows.slice(index, index + size));
  return out;
}

function must<T>(result: { data: T; error: { message: string } | null }, what: string): T {
  if (result.error) throw new Error(`Couldn't ${what}: ${result.error.message}`);
  return result.data;
}

/** Which of our sync steps each Plaid product enables. */
function productsFor(itemProducts: string[] | null | undefined): Set<SyncProduct> {
  if (!itemProducts) return new Set(ALL_SYNC_PRODUCTS);
  const available = new Set<SyncProduct>();
  if (itemProducts.includes("transactions")) available.add("transactions");
  if (itemProducts.includes("liabilities")) available.add("liabilities");
  if (itemProducts.includes("investments")) { available.add("holdings"); available.add("investment_transactions"); }
  return available;
}

type LoadedItem = { id: number; institutionName: string | null; accessToken: string; cursor: string | null };

async function loadSyncItem(context: SyncContext, itemId: number): Promise<LoadedItem> {
  const data = must(await context.db.from("plaid_items")
    .select("id, institution_name, access_token_encrypted, transactions_cursor")
    .eq("household_id", context.householdId).eq("id", itemId).maybeSingle(), "load the bank connection");
  if (!data) throw new Response("That bank connection wasn't found", { status: 404 });
  return {
    id: data.id as number,
    institutionName: (data.institution_name as string | null) ?? null,
    accessToken: decryptToken(data.access_token_encrypted as string),
    cursor: (data.transactions_cursor as string | null) || null,
  };
}

/** Plaid account id → Cardfolio plaid_accounts.id for one login. */
async function accountMap(context: SyncContext, itemId: number) {
  const rows = must(await context.db.from("plaid_accounts").select("id, plaid_account_id").eq("item_id", itemId), "load bank accounts");
  return new Map((rows || []).map((row) => [row.plaid_account_id as string, row.id as number]));
}

/** Updates balance columns for accounts returned by a product endpoint. */
async function saveBalances(context: SyncContext, accounts: PlaidAccount[] | undefined, now: string) {
  for (const account of accounts || []) {
    if (!account.balances) continue;
    must(await context.db.from("plaid_accounts").update(balanceColumns(account.balances, now)).eq("household_id", context.householdId).eq("plaid_account_id", account.account_id), "save balances");
  }
}

// ---------- categories ----------

async function loadCategorizing(context: SyncContext): Promise<{ categories: CategoryLike[]; rules: RuleLike[] }> {
  const { db, householdId } = context;
  let categories = must(await db.from("categories").select("id, kind, plaid_categories").eq("household_id", householdId), "load categories") || [];
  if (categories.length === 0) {
    must(await db.rpc("cardfolio_seed_categories", { p_household: householdId }), "add the default categories");
    categories = must(await db.from("categories").select("id, kind, plaid_categories").eq("household_id", householdId), "load categories") || [];
  }
  const rules = must(await db.from("category_rules").select("id, match_text, match_field, plaid_account_id, category_id, set_excluded").eq("household_id", householdId), "load category rules") || [];
  return {
    categories: categories.map((row) => ({ id: row.id as number, kind: row.kind as CategoryKind, plaidCategories: (row.plaid_categories as string[]) || [] })),
    rules: rules.map((row) => ({
      id: row.id as number,
      matchText: String(row.match_text),
      matchField: row.match_field as RuleField,
      plaidAccountId: (row.plaid_account_id as number | null) ?? null,
      categoryId: row.category_id as number,
      setExcluded: (row.set_excluded as boolean | null) ?? null,
    })),
  };
}

// ---------- transactions ----------

type SyncPage = { added: PlaidTransaction[]; modified: PlaidTransaction[]; removed: { transaction_id: string }[]; next_cursor: string; has_more: boolean; transactions_update_status?: string };

/** One complete /transactions/sync pass from `cursor`, restarting if Plaid's data changes mid-pass. */
async function pullTransactions(accessToken: string, cursor: string | null) {
  for (let attempt = 0; ; attempt += 1) {
    const pass = { added: [] as PlaidTransaction[], modified: [] as PlaidTransaction[], removed: [] as { transaction_id: string }[], cursor, status: null as string | null };
    try {
      for (;;) {
        const page = await plaid<SyncPage>("/transactions/sync", { access_token: accessToken, count: PAGE, ...(pass.cursor ? { cursor: pass.cursor } : {}) });
        pass.added.push(...page.added);
        pass.modified.push(...page.modified);
        pass.removed.push(...page.removed);
        pass.cursor = page.next_cursor || pass.cursor;
        pass.status = page.transactions_update_status ?? pass.status;
        if (!page.has_more) return pass;
      }
    } catch (error) {
      if (error instanceof PlaidApiError && error.code === "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION" && attempt < MAX_SYNC_RESTARTS) continue;
      throw error;
    }
  }
}

async function syncTransactions(context: SyncContext, item: LoadedItem) {
  const { db, householdId } = context;
  const pass = await pullTransactions(item.accessToken, item.cursor);
  const [{ categories, rules }, accountIds] = await Promise.all([loadCategorizing(context), accountMap(context, item.id)]);

  // User fields of rows we already have, including pending rows that posted ones replace.
  const wanted = new Set<string>();
  for (const transaction of [...pass.added, ...pass.modified]) {
    wanted.add(transaction.transaction_id);
    if (transaction.pending_transaction_id) wanted.add(transaction.pending_transaction_id);
  }
  const existing = new Map<string, StoredUserFields>();
  for (const ids of chunks([...wanted], 200)) {
    const rows = must(await db.from("transactions").select("plaid_transaction_id, category_id, category_source, notes, excluded, reviewed").eq("household_id", householdId).in("plaid_transaction_id", ids), "load transactions") || [];
    for (const row of rows) {
      existing.set(row.plaid_transaction_id as string, {
        plaidTransactionId: row.plaid_transaction_id as string,
        categoryId: (row.category_id as number | null) ?? null,
        categorySource: (row.category_source as CategorySource | null) ?? null,
        notes: (row.notes as string | null) ?? null,
        excluded: Boolean(row.excluded),
        reviewed: Boolean(row.reviewed),
      });
    }
  }

  const plan = planTransactionWrites({ householdId, added: pass.added, modified: pass.modified, removed: pass.removed, accountIds, existing, categories, rules });
  for (const rows of chunks(plan.upserts)) must(await db.from("transactions").upsert(rows, { onConflict: "plaid_transaction_id" }), "save transactions");
  for (const ids of chunks(plan.removeIds, 200)) must(await db.from("transactions").delete().eq("household_id", householdId).in("plaid_transaction_id", ids), "remove transactions");

  // Save the cursor only after the whole pass is stored, so a failure re-reads it next time.
  must(await db.from("plaid_items").update({ transactions_cursor: pass.cursor, transactions_status: pass.status }).eq("id", item.id), "save the sync position");
  return { added: pass.added.length, modified: pass.modified.length, removed: pass.removed.length, skipped: plan.skipped, status: pass.status };
}

// ---------- liabilities ----------

type CreditLiability = {
  account_id: string | null;
  is_overdue?: boolean | null;
  last_payment_amount?: number | null;
  last_payment_date?: string | null;
  last_statement_issue_date?: string | null;
  last_statement_balance?: number | null;
  minimum_payment_amount?: number | null;
  next_payment_due_date?: string | null;
};

async function syncLiabilities(context: SyncContext, item: LoadedItem, now: string) {
  const payload = await plaid<{ accounts: PlaidAccount[]; liabilities: { credit?: CreditLiability[] | null } }>("/liabilities/get", { access_token: item.accessToken });
  await saveBalances(context, payload.accounts, now);
  for (const card of payload.liabilities?.credit || []) {
    if (!card.account_id) continue;
    must(await context.db.from("plaid_accounts").update({
      last_statement_balance_cents: toCents(card.last_statement_balance),
      last_statement_date: card.last_statement_issue_date ?? null,
      minimum_payment_cents: toCents(card.minimum_payment_amount),
      next_payment_due_date: card.next_payment_due_date ?? null,
      last_payment_cents: toCents(card.last_payment_amount),
      last_payment_date: card.last_payment_date ?? null,
      is_overdue: card.is_overdue ?? null,
      liabilities_updated_at: now,
    }).eq("household_id", context.householdId).eq("plaid_account_id", card.account_id), "save card statement details");
  }
}

// ---------- investments ----------

type PlaidSecurity = {
  security_id: string;
  name?: string | null;
  ticker_symbol?: string | null;
  type?: string | null;
  is_cash_equivalent?: boolean | null;
  close_price?: number | null;
  close_price_as_of?: string | null;
  iso_currency_code?: string | null;
  unofficial_currency_code?: string | null;
};

/** Upserts securities and returns Plaid security id → securities.id. */
async function saveSecurities(context: SyncContext, securities: PlaidSecurity[], now: string) {
  const ids = new Map<string, number>();
  for (const rows of chunks(securities)) {
    const saved = must(await context.db.from("securities").upsert(rows.map((security) => ({
      household_id: context.householdId,
      plaid_security_id: security.security_id,
      name: security.name ?? null,
      ticker_symbol: security.ticker_symbol ?? null,
      type: security.type ?? null,
      is_cash_equivalent: security.is_cash_equivalent ?? null,
      close_price: security.close_price ?? null,
      close_price_as_of: security.close_price_as_of ?? null,
      currency: security.iso_currency_code ?? security.unofficial_currency_code ?? null,
      updated_at: now,
    })), { onConflict: "household_id,plaid_security_id" }).select("id, plaid_security_id"), "save securities") || [];
    for (const row of saved) ids.set(row.plaid_security_id as string, row.id as number);
  }
  return ids;
}

type PlaidHolding = {
  account_id: string;
  security_id: string;
  quantity: number;
  cost_basis?: number | null;
  institution_price?: number | null;
  institution_price_as_of?: string | null;
  institution_value?: number | null;
  iso_currency_code?: string | null;
  unofficial_currency_code?: string | null;
};

async function syncHoldings(context: SyncContext, item: LoadedItem, now: string) {
  const payload = await plaid<{ accounts: PlaidAccount[]; holdings: PlaidHolding[]; securities: PlaidSecurity[] }>("/investments/holdings/get", { access_token: item.accessToken });
  await saveBalances(context, payload.accounts, now);
  const [securityIds, accountIds] = await Promise.all([saveSecurities(context, payload.securities || [], now), accountMap(context, item.id)]);
  const rows = (payload.holdings || []).flatMap((holding) => {
    const plaidAccountId = accountIds.get(holding.account_id);
    const securityId = securityIds.get(holding.security_id);
    if (plaidAccountId === undefined || securityId === undefined) return [];
    return [{
      household_id: context.householdId,
      plaid_account_id: plaidAccountId,
      security_id: securityId,
      quantity: holding.quantity,
      cost_basis_cents: toCents(holding.cost_basis),
      institution_price: holding.institution_price ?? null,
      institution_price_as_of: holding.institution_price_as_of ?? null,
      institution_value_cents: toCents(holding.institution_value),
      currency: holding.iso_currency_code ?? holding.unofficial_currency_code ?? null,
      updated_at: now,
    }];
  });
  for (const chunk of chunks(rows)) must(await context.db.from("holdings").upsert(chunk, { onConflict: "plaid_account_id,security_id" }), "save holdings");
  // Positions sold since the last sync: anything in these accounts this pass didn't touch.
  const reported = (payload.accounts || []).map((account) => accountIds.get(account.account_id)).filter((id): id is number => id !== undefined);
  if (reported.length) must(await context.db.from("holdings").delete().in("plaid_account_id", reported).lt("updated_at", now), "remove sold holdings");
  return rows.length;
}

type PlaidInvestmentTransaction = {
  investment_transaction_id: string;
  account_id: string;
  security_id?: string | null;
  date: string;
  name: string;
  quantity?: number | null;
  amount: number;
  price?: number | null;
  fees?: number | null;
  type?: string | null;
  subtype?: string | null;
  iso_currency_code?: string | null;
  unofficial_currency_code?: string | null;
};

/** The last 24 months of investment transactions, paged by offset. */
async function syncInvestmentTransactions(context: SyncContext, item: LoadedItem, today: string, now: string) {
  const startDate = monthsBefore(today, 24);
  const accountIds = await accountMap(context, item.id);
  let offset = 0;
  let saved = 0;
  for (;;) {
    const page = await plaid<{ accounts: PlaidAccount[]; investment_transactions: PlaidInvestmentTransaction[]; securities: PlaidSecurity[]; total_investment_transactions: number }>(
      "/investments/transactions/get",
      { access_token: item.accessToken, start_date: startDate, end_date: today, options: { count: PAGE, offset } },
    );
    if (offset === 0) await saveBalances(context, page.accounts, now);
    const securityIds = await saveSecurities(context, page.securities || [], now);
    const rows = (page.investment_transactions || []).flatMap((transaction) => {
      const plaidAccountId = accountIds.get(transaction.account_id);
      if (plaidAccountId === undefined) return [];
      return [{
        household_id: context.householdId,
        plaid_account_id: plaidAccountId,
        plaid_investment_transaction_id: transaction.investment_transaction_id,
        security_id: transaction.security_id ? securityIds.get(transaction.security_id) ?? null : null,
        date: transaction.date,
        name: transaction.name || "Investment transaction",
        quantity: transaction.quantity ?? null,
        amount_cents: plaidAmountToCents(transaction.amount),
        price: transaction.price ?? null,
        fees_cents: toCents(transaction.fees),
        type: transaction.type ?? null,
        subtype: transaction.subtype ?? null,
        currency: transaction.iso_currency_code ?? transaction.unofficial_currency_code ?? null,
      }];
    });
    for (const chunk of chunks(rows)) must(await context.db.from("investment_transactions").upsert(chunk, { onConflict: "plaid_investment_transaction_id" }), "save investment transactions");
    saved += rows.length;
    const count = (page.investment_transactions || []).length;
    offset += count;
    if (count === 0 || offset >= (page.total_investment_transactions ?? 0)) break;
  }
  must(await context.db.from("plaid_items").update({ investments_synced_at: now }).eq("id", item.id), "save the investments sync time");
  return saved;
}

// ---------- snapshots ----------

/** Writes today's balance snapshot for every Plaid and (not archived) manual account in the household. */
export async function writeSnapshots(context: SyncContext, date = syncDate()) {
  const { db, householdId } = context;
  const [plaidAccounts, manualAccounts] = await Promise.all([
    db.from("plaid_accounts").select("id, type, current_balance_cents, available_balance_cents, currency").eq("household_id", householdId),
    db.from("manual_accounts").select("id, balance_cents, liability, archived, currency").eq("household_id", householdId),
  ]);
  const rows = snapshotRows({
    householdId,
    date,
    plaidAccounts: (must(plaidAccounts, "load bank accounts") || []).map((row) => ({
      id: row.id as number,
      type: (row.type as string | null) ?? null,
      currentCents: row.current_balance_cents === null ? null : Number(row.current_balance_cents),
      availableCents: row.available_balance_cents === null ? null : Number(row.available_balance_cents),
      currency: (row.currency as string | null) ?? null,
    })),
    manualAccounts: (must(manualAccounts, "load manual accounts") || []).map((row) => ({
      id: row.id as number,
      balanceCents: Number(row.balance_cents),
      liability: Boolean(row.liability),
      archived: Boolean(row.archived),
      currency: (row.currency as string | null) ?? null,
    })),
  });
  for (const chunk of chunks(rows)) must(await db.from("balance_snapshots").upsert(chunk, { onConflict: "plaid_account_id,manual_account_id,date" }), "save balance snapshots");
  return rows.length;
}

// ---------- items ----------

export type SyncOptions = {
  /** Limit the sync to these products (e.g. from a webhook). Accounts and balances are always refreshed. */
  products?: SyncProduct[];
  /** Write today's balance snapshots afterwards (default true). */
  snapshots?: boolean;
  today?: string;
};

/** Syncs one bank login. Never throws for Plaid errors: they're recorded on the item and in the result. */
export async function syncItem(context: SyncContext, itemId: number, options: SyncOptions = {}): Promise<ItemSyncResult> {
  const item = await loadSyncItem(context, itemId);
  const today = options.today || syncDate();
  const now = new Date().toISOString();
  const result: ItemSyncResult = {
    itemId, institutionName: item.institutionName, ok: true, accounts: 0, products: {},
    transactions: { added: 0, modified: 0, removed: 0, skipped: 0 }, holdings: 0, investmentTransactions: 0, transactionsStatus: null,
  };

  let available: Set<SyncProduct>;
  try {
    const { accounts, item: details } = await getAccounts(item.accessToken);
    await syncItemAccounts(context, item.id, accounts);
    result.accounts = accounts.length;
    available = productsFor(details.products ?? details.billed_products);
    must(await context.db.from("plaid_items").update({ consent_expires_at: details.consent_expiration_time || null, webhook_url: details.webhook || null }).eq("id", item.id), "save the bank connection");
    const webhook = process.env.PLAID_WEBHOOK_URL?.trim();
    if (webhook && (details.webhook || "") !== webhook) {
      await plaid("/item/webhook/update", { access_token: item.accessToken, webhook })
        .then(() => context.db.from("plaid_items").update({ webhook_url: webhook }).eq("id", item.id))
        .catch(() => undefined);
    }
  } catch (error) {
    await noteItemError(context, item.id, error);
    return { ...result, ok: false, error: error instanceof Error ? error.message : "Couldn't reach the bank" };
  }

  const wanted = options.products ?? ALL_SYNC_PRODUCTS;
  const steps: [SyncProduct, () => Promise<void>][] = [
    ["transactions", async () => {
      const synced = await syncTransactions(context, item);
      result.transactions = { added: synced.added, modified: synced.modified, removed: synced.removed, skipped: synced.skipped };
      result.transactionsStatus = synced.status;
    }],
    ["liabilities", () => syncLiabilities(context, item, now)],
    ["holdings", async () => { result.holdings = await syncHoldings(context, item, now); }],
    ["investment_transactions", async () => { result.investmentTransactions = await syncInvestmentTransactions(context, item, today, now); }],
  ];
  let errorCode: string | null = null;
  for (const [product, run] of steps) {
    if (!wanted.includes(product)) continue;
    if (!available.has(product)) { result.products[product] = "not_available"; continue; }
    try {
      await run();
      result.products[product] = "ok";
    } catch (error) {
      if (error instanceof PlaidApiError && isSkippableProductError(error.code)) { result.products[product] = "skipped"; continue; }
      result.products[product] = "error";
      result.ok = false;
      result.error = error instanceof Error ? error.message : `Couldn't sync ${product}`;
      if (error instanceof PlaidApiError) {
        errorCode = error.code;
        if (RECONNECT_ERRORS.has(error.code)) { await noteItemError(context, item.id, error); return result; }
      }
    }
  }

  // Read the status now, not at the start: a webhook may have flagged the login meanwhile.
  const current = must(await context.db.from("plaid_items").select("status, error_code, synced_products").eq("id", item.id).maybeSingle(), "load the bank connection");
  const next = nextItemStatus({ status: (current?.status as string | null) ?? null, errorCode: (current?.error_code as string | null) ?? null }, { kind: "synced", errorCode });
  must(await context.db.from("plaid_items").update({
    last_synced_at: now,
    status: next.status,
    error_code: next.errorCode,
    updated_at: now,
    synced_products: mergeSyncedProducts(current?.synced_products as string[] | null, result.products),
  }).eq("id", item.id), "save the sync result");

  if (options.snapshots !== false) await writeSnapshots(context, today);
  return result;
}

/** Syncs every login in a household (one after another), then writes the day's snapshots once. */
export async function syncHousehold(context: SyncContext, options: Omit<SyncOptions, "snapshots"> = {}) {
  const items = must(await context.db.from("plaid_items").select("id").eq("household_id", context.householdId).order("id"), "load bank connections") || [];
  const results: ItemSyncResult[] = [];
  for (const { id } of items) {
    try {
      results.push(await syncItem(context, id as number, { ...options, snapshots: false }));
    } catch (error) {
      results.push({
        itemId: id as number, institutionName: null, ok: false, error: error instanceof Error ? error.message : "Sync failed",
        accounts: 0, products: {}, transactions: { added: 0, modified: 0, removed: 0, skipped: 0 }, holdings: 0, investmentTransactions: 0, transactionsStatus: null,
      });
    }
  }
  const snapshots = await writeSnapshots(context, options.today || syncDate());
  return { items: results, snapshots };
}
