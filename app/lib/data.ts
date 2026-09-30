import type { SupabaseClient } from "@supabase/supabase-js";
import { isoDate } from "./core/dates.ts";
import {
  nextHoldingNumber,
  type Account,
  type AccountStatus,
  type ActionRule,
  type Bonus,
  type Cadence,
  type Credit,
  type Holding,
  type HoldingChange,
  type Kind,
  type OpenedVia,
  type PortfolioData,
  type Product,
} from "./core/model.ts";

export type Context = { db: SupabaseClient; householdId: string; email: string };

type Row = Record<string, unknown>;
const num = (value: unknown) => Number(value);
const text = (value: unknown) => (value === null || value === undefined ? null : String(value));

/** Supabase caps a response at 1,000 rows, so page through larger tables. */
async function selectAll(db: SupabaseClient, table: string, householdId: string, order: string) {
  const rows: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select("*").eq("household_id", householdId).order(order).range(from, from + 999);
    if (error) throw new Error(`Couldn't load ${table.replace(/_/g, " ")}: ${error.message}`);
    rows.push(...(data as Row[]));
    if (!data || data.length < 1000) return rows;
  }
}

export function toBonus(row: Row): Bonus | null {
  if (!row.bonus_amount) return null;
  return {
    amount: num(row.bonus_amount),
    unit: (row.bonus_unit as Bonus["unit"]) || "points",
    spendCents: row.bonus_spend_cents === null ? null : num(row.bonus_spend_cents),
    months: num(row.bonus_months || 3),
  };
}

export async function loadPortfolio(db: SupabaseClient, householdId: string): Promise<PortfolioData> {
  const [people, products, accounts, holdings, credits, uses, optOuts, rules] = await Promise.all([
    selectAll(db, "people", householdId, "sort"),
    selectAll(db, "products", householdId, "name"),
    selectAll(db, "accounts", householdId, "id"),
    selectAll(db, "account_products", householdId, "started_on"),
    selectAll(db, "credits", householdId, "sort"),
    selectAll(db, "credit_uses", householdId, "id"),
    selectAll(db, "credit_opt_outs", householdId, "created_at"),
    selectAll(db, "action_rules", householdId, "priority"),
  ]);
  return {
    people: people.map((row) => ({ id: num(row.id), name: String(row.name), code: text(row.code), email: text(row.email), sort: num(row.sort) })),
    products: products.map((row) => ({ id: num(row.id), slug: String(row.slug), name: String(row.name), shortName: text(row.short_name), issuer: String(row.issuer), kind: row.kind as Kind, annualFeeCents: num(row.annual_fee_cents) })),
    accounts: accounts.map((row) => ({
      id: num(row.id),
      personId: num(row.person_id),
      appliedOn: text(row.applied_on),
      approvedOn: text(row.approved_on),
      openedVia: row.opened_via as OpenedVia,
      status: row.status as AccountStatus,
      closedOn: text(row.closed_on),
      bonus: toBonus(row),
      bonusEarned: Boolean(row.bonus_earned),
      note: text(row.note),
    })),
    holdings: holdings.map((row) => ({
      id: num(row.id),
      accountId: num(row.account_id),
      personId: num(row.person_id),
      productId: num(row.product_id),
      number: row.number === null ? null : num(row.number),
      startedOn: String(row.started_on),
      endedOn: text(row.ended_on),
      change: row.change as HoldingChange,
      annualFeeCents: num(row.annual_fee_cents),
      last4: text(row.last4),
    })),
    credits: credits.map((row) => ({
      id: num(row.id),
      productId: num(row.product_id),
      name: String(row.name),
      amountCents: num(row.amount_cents),
      cadence: row.cadence as Cadence,
      remind: Boolean(row.remind),
      startsOn: text(row.starts_on),
      endsOn: text(row.ends_on),
      sort: num(row.sort),
    })),
    uses: uses.map((row) => ({
      id: num(row.id),
      creditId: num(row.credit_id),
      holdingId: num(row.account_product_id),
      periodKey: String(row.period_key),
      amountCents: num(row.amount_cents),
      usedOn: text(row.used_on),
      recordedBy: text(row.recorded_by),
      source: row.source as "manual" | "import" | "plaid",
    })),
    optOuts: optOuts.map((row) => ({ creditId: num(row.credit_id), holdingId: num(row.account_product_id) })),
    rules: rules.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      actionCode: String(row.action_code),
      priority: num(row.priority),
      enabled: Boolean(row.enabled),
      conditions: (row.conditions as ActionRule["conditions"]) || {},
    })),
  };
}

function check<T>(result: { data: T; error: { message: string; code?: string } | null }, what: string) {
  if (result.error) {
    if (result.error.code === "23505" && result.error.message.includes("number")) {
      throw new Error("That card number is already used for this person and card type. Pick another number.");
    }
    throw new Error(`Couldn't ${what}: ${result.error.message}`);
  }
  return result.data;
}

// ---------- credits ----------

/** Replaces a card's usage of a credit for one period. `amountCents` null clears it. */
export async function setCreditUse(context: Context, creditId: number, holdingId: number, periodKey: string, amountCents: number | null, options: { usedOn?: string | null; source?: "manual" | "agent" } = {}) {
  const { db, householdId, email } = context;
  check(await db.rpc("cardfolio_set_credit_use", {
    p_household: householdId,
    p_credit: creditId,
    p_holding: holdingId,
    p_period: periodKey,
    p_amount_cents: amountCents,
    p_used_on: options.usedOn ?? isoDate(new Date()),
    p_recorded_by: email,
    p_source: options.source ?? "manual",
  }), "update the credit");
}

export async function setOptOut(context: Context, creditId: number, holdingId: number, optedOut: boolean) {
  const { db, householdId } = context;
  if (optedOut) {
    check(await db.from("credit_opt_outs").upsert({ household_id: householdId, credit_id: creditId, account_product_id: holdingId }), "update enrollment");
  } else {
    check(await db.from("credit_opt_outs").delete().eq("household_id", householdId).eq("credit_id", creditId).eq("account_product_id", holdingId), "update enrollment");
  }
}

export type CreditDraft = Pick<Credit, "productId" | "name" | "amountCents" | "cadence" | "remind">;

export async function saveCredit(context: Context, id: number | null, draft: Partial<CreditDraft>) {
  const { db, householdId } = context;
  const values = {
    ...(draft.productId !== undefined && { product_id: draft.productId }),
    ...(draft.name !== undefined && { name: draft.name.trim() }),
    ...(draft.amountCents !== undefined && { amount_cents: Math.round(draft.amountCents) }),
    ...(draft.cadence !== undefined && { cadence: draft.cadence }),
    ...(draft.remind !== undefined && { remind: draft.remind }),
  };
  if (id === null) check(await db.from("credits").insert({ household_id: householdId, ...values }), "add the credit");
  else check(await db.from("credits").update(values).eq("household_id", householdId).eq("id", id), "save the credit");
}

export async function deleteCredit(context: Context, id: number) {
  check(await context.db.from("credits").delete().eq("household_id", context.householdId).eq("id", id), "delete the credit");
}

// ---------- card types and rules ----------

export type ProductDraft = Pick<Product, "name" | "issuer" | "kind" | "annualFeeCents"> & { slug?: string; shortName?: string | null };

function productValues(draft: ProductDraft) {
  return {
    name: draft.name.trim(),
    issuer: draft.issuer.trim() || "Other",
    kind: draft.kind,
    annual_fee_cents: Math.round(draft.annualFeeCents),
    ...(draft.shortName !== undefined && { short_name: draft.shortName?.trim() || null }),
    ...(draft.slug && { slug: draft.slug.trim().toLowerCase() }),
  };
}

export async function saveProduct(context: Context, id: number | null, draft: ProductDraft) {
  const { db, householdId } = context;
  const values = productValues({ ...draft, slug: undefined });
  if (id !== null) {
    check(await db.from("products").update(values).eq("household_id", householdId).eq("id", id), "save the card type");
    return id;
  }
  const slug = (draft.slug || draft.name).trim().toLowerCase();
  const row = check(await db.from("products").insert({ household_id: householdId, slug, ...values }).select("id").single(), "add the card type");
  return num((row as Row).id);
}

export async function setRuleEnabled(context: Context, id: string, enabled: boolean) {
  check(await context.db.from("action_rules").update({ enabled, updated_at: new Date().toISOString() }).eq("household_id", context.householdId).eq("id", id), "update the reminder");
}

// ---------- accounts ----------

export type AccountDraft = {
  personId: number;
  productId: number;
  number: number | null;
  last4: string | null;
  appliedOn: string | null;
  approvedOn: string | null;
  openedVia: OpenedVia;
  status: AccountStatus;
  closedOn: string | null;
  annualFeeCents: number;
  bonus: Bonus | null;
  bonusEarned: boolean;
  note: string | null;
};

function accountValues(draft: AccountDraft) {
  const closes = draft.status === "closed" || draft.status === "declined";
  return {
    person_id: draft.personId,
    applied_on: draft.appliedOn,
    approved_on: draft.status === "pending" || draft.status === "declined" ? null : draft.approvedOn,
    opened_via: draft.openedVia,
    status: draft.status,
    closed_on: closes ? draft.closedOn || draft.appliedOn || isoDate(new Date()) : null,
    bonus_amount: draft.bonus?.amount || null,
    bonus_unit: draft.bonus ? draft.bonus.unit : null,
    bonus_spend_cents: draft.bonus ? draft.bonus.spendCents : null,
    bonus_months: draft.bonus ? draft.bonus.months : null,
    bonus_earned: draft.bonusEarned,
    note: draft.note?.trim() || null,
  };
}

export function validateDraft(draft: AccountDraft) {
  if (!draft.personId) return "Add a cardholder in Settings first, then add the card.";
  if (draft.status !== "pending" && draft.status !== "declined" && !draft.approvedOn) return "Enter the approval date, or set the status to Pending.";
  if (draft.status === "closed" && !draft.closedOn) return "Enter the date the card was closed.";
  if (draft.last4 && !/^\d{4,5}$/.test(draft.last4)) return "Last digits should be 4 or 5 numbers.";
  if (draft.number !== null && (!Number.isInteger(draft.number) || draft.number < 1)) return "Card number should be a whole number, 1 or more.";
  return null;
}

/** Creates an account with its first product (optionally a new card type) and returns the new account id. */
export async function createAccount(context: Context, draft: AccountDraft, newProduct: ProductDraft | null = null) {
  const { db, householdId } = context;
  const id = check(await db.rpc("cardfolio_add_card", {
    p_household: householdId,
    p_account: accountValues(draft),
    p_product: newProduct ? null : draft.productId,
    p_new_product: newProduct ? productValues(newProduct) : null,
    p_number: draft.number,
    p_annual_fee_cents: draft.annualFeeCents,
    p_last4: draft.last4,
  }), "add the card");
  return num(id);
}

/** Saves an account and corrects its current product (type, number, fee, last digits). */
export async function updateAccount(context: Context, account: Account, current: Holding, draft: AccountDraft, allHoldings: Holding[]) {
  let holdings = allHoldings;
  const { db, householdId } = context;
  const own = holdings.filter((holding) => holding.accountId === account.id);
  const personChanged = account.personId !== draft.personId;
  // Moving a card to the other cardholder: clear its numbers first so they can't clash with theirs.
  if (personChanged) check(await db.from("account_products").update({ number: null }).eq("household_id", householdId).eq("account_id", account.id), "save the card");
  check(await db.from("accounts").update(accountValues(draft)).eq("household_id", householdId).eq("id", account.id), "save the card");
  if (personChanged) {
    const others = holdings.filter((holding) => holding.accountId !== account.id);
    for (const holding of own.filter((item) => item.id !== current.id && item.number !== null)) {
      const number = nextHoldingNumber(others, draft.personId, holding.productId);
      others.push({ ...holding, personId: draft.personId, number });
      check(await db.from("account_products").update({ number }).eq("household_id", householdId).eq("id", holding.id), "save the card");
    }
    holdings = others;
  }
  const approved = draft.status === "open" || draft.status === "closed";
  const productChanged = current.productId !== draft.productId || personChanged;
  // A corrected card type or cardholder gets the next free number unless one was typed in.
  let number = draft.number;
  if (approved && (number === null || (productChanged && number === current.number))) {
    number = nextHoldingNumber(holdings.filter((holding) => holding.id !== current.id), draft.personId, draft.productId);
  }
  check(await db.from("account_products").update({
    product_id: draft.productId,
    number: approved ? number : null,
    annual_fee_cents: draft.annualFeeCents,
    last4: draft.last4,
  }).eq("household_id", householdId).eq("id", current.id), "save the card");
  // The first product starts when the account was approved (or applied, while pending).
  const first = own.sort((left, right) => left.startedOn.localeCompare(right.startedOn) || left.id - right.id)[0];
  const opened = draft.approvedOn || draft.appliedOn;
  if (first && opened && opened !== first.startedOn) {
    check(await db.from("account_products").update({ started_on: opened }).eq("household_id", householdId).eq("id", first.id), "save the card");
  }
}

/** Records an upgrade or downgrade: the current product ends and a new one (optionally a new card type) starts on `date`. */
export async function changeProduct(context: Context, accountId: number, change: { productId: number | null; newProduct?: ProductDraft | null; date: string; annualFeeCents: number; last4: string | null; direction: Exclude<HoldingChange, "opened"> }) {
  const { db, householdId } = context;
  const id = check(await db.rpc("cardfolio_change_product", {
    p_household: householdId,
    p_account: accountId,
    p_product: change.newProduct ? null : change.productId,
    p_new_product: change.newProduct ? productValues(change.newProduct) : null,
    p_date: change.date,
    p_direction: change.direction,
    p_annual_fee_cents: change.annualFeeCents,
    p_last4: change.last4,
  }), "record the product change");
  return num(id);
}

/** Removes the most recent product change, restoring the previous product. */
export async function undoProductChange(context: Context, accountId: number) {
  check(await context.db.rpc("cardfolio_undo_product_change", { p_household: context.householdId, p_account: accountId }), "remove the product change");
}

export async function deleteAccount(context: Context, accountId: number) {
  check(await context.db.from("accounts").delete().eq("household_id", context.householdId).eq("id", accountId), "delete the card");
}

export type PersonDraft = { name: string; code?: string | null };

const cleanCode = (code: string | null | undefined) => code?.trim().toUpperCase() || null;

export async function addPerson(context: Context, draft: PersonDraft, sort: number) {
  const row = check(await context.db.from("people").insert({ household_id: context.householdId, name: draft.name.trim(), code: cleanCode(draft.code), sort }).select("id").single(), "add the person");
  return num((row as Row).id);
}

export async function savePerson(context: Context, id: number, draft: PersonDraft) {
  if (draft.code && !/^[A-Za-z]{1,4}$/.test(draft.code.trim())) throw new Error("Initials should be 1 to 4 letters, like HK.");
  check(await context.db.from("people").update({ name: draft.name.trim(), code: cleanCode(draft.code) }).eq("household_id", context.householdId).eq("id", id), "save the cardholder");
}

// ---------- agents ----------

export type AgentKey = { id: string; name: string; prefix: string; createdAt: string; lastUsedAt: string | null; revokedAt: string | null };
export type ChangeLogEntry = { id: number; actor: string; action: string; summary: string; source: string | null; createdAt: string };

export async function listAgentKeys(context: Context): Promise<AgentKey[]> {
  const rows = check(await context.db.from("agent_keys").select("id, name, key_prefix, created_at, last_used_at, revoked_at")
    .eq("household_id", context.householdId).order("created_at", { ascending: false }), "load agent keys") as Row[];
  return rows.map((row) => ({ id: String(row.id), name: String(row.name), prefix: String(row.key_prefix), createdAt: String(row.created_at), lastUsedAt: text(row.last_used_at), revokedAt: text(row.revoked_at) }));
}

/** Creates an agent key and returns it; only its SHA-256 hash is stored, so it can't be shown again. */
export async function createAgentKey(context: Context, name: string) {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const key = `cfk_${btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key)));
  const hash = [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  check(await context.db.from("agent_keys").insert({
    household_id: context.householdId, name: name.trim(), key_hash: hash, key_prefix: key.slice(0, 10), created_by: context.email,
  }), "create the agent key");
  return key;
}

export async function revokeAgentKey(context: Context, id: string) {
  check(await context.db.from("agent_keys").update({ revoked_at: new Date().toISOString() }).eq("household_id", context.householdId).eq("id", id), "revoke the agent key");
}

export async function recentChanges(context: Context, limit = 10): Promise<ChangeLogEntry[]> {
  const rows = check(await context.db.from("change_log").select("id, actor, action, summary, source, created_at")
    .eq("household_id", context.householdId).order("created_at", { ascending: false }).limit(limit), "load recent changes") as Row[];
  return rows.map((row) => ({ id: num(row.id), actor: String(row.actor), action: String(row.action), summary: String(row.summary), source: text(row.source), createdAt: String(row.created_at) }));
}
