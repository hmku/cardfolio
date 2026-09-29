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
    people: people.map((row) => ({ id: num(row.id), name: String(row.name), email: text(row.email), sort: num(row.sort) })),
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
export async function setCreditUse(context: Context, creditId: number, holdingId: number, periodKey: string, amountCents: number | null) {
  const { db, householdId, email } = context;
  check(await db.from("credit_uses").delete().eq("household_id", householdId).eq("credit_id", creditId).eq("account_product_id", holdingId).eq("period_key", periodKey), "update the credit");
  if (amountCents === null) return;
  check(await db.from("credit_uses").insert({
    household_id: householdId,
    credit_id: creditId,
    account_product_id: holdingId,
    period_key: periodKey,
    amount_cents: amountCents,
    used_on: isoDate(new Date()),
    recorded_by: email,
    source: "manual",
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

export async function saveProduct(context: Context, id: number | null, draft: ProductDraft) {
  const { db, householdId } = context;
  const values = {
    name: draft.name.trim(),
    issuer: draft.issuer.trim() || "Other",
    kind: draft.kind,
    annual_fee_cents: Math.round(draft.annualFeeCents),
    ...(draft.shortName !== undefined && { short_name: draft.shortName?.trim() || null }),
  };
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
  if (draft.status !== "pending" && draft.status !== "declined" && !draft.approvedOn) return "Enter the approval date, or set the status to Pending.";
  if (draft.status === "closed" && !draft.closedOn) return "Enter the date the card was closed.";
  if (draft.last4 && !/^\d{4,5}$/.test(draft.last4)) return "Last digits should be 4 or 5 numbers.";
  if (draft.number !== null && (!Number.isInteger(draft.number) || draft.number < 1)) return "Card number should be a whole number, 1 or more.";
  return null;
}

/** Creates an account with its first product and returns the new account id. */
export async function createAccount(context: Context, draft: AccountDraft, holdings: Holding[]) {
  const { db, householdId } = context;
  const approved = draft.status === "open" || draft.status === "closed";
  const account = check(await db.from("accounts").insert({ household_id: householdId, ...accountValues(draft) }).select("id").single(), "add the card") as Row;
  const holding = await db.from("account_products").insert({
    household_id: householdId,
    account_id: account.id,
    person_id: draft.personId,
    product_id: draft.productId,
    number: approved ? draft.number ?? nextHoldingNumber(holdings, draft.personId, draft.productId) : null,
    started_on: draft.approvedOn || draft.appliedOn || isoDate(new Date()),
    change: "opened",
    annual_fee_cents: draft.annualFeeCents,
    last4: draft.last4,
  });
  if (holding.error) {
    await db.from("accounts").delete().eq("household_id", householdId).eq("id", account.id);
    check(holding, "add the card");
  }
  return num(account.id);
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

/** Records an upgrade or downgrade: the current product ends and a new one starts on `date`. */
export async function changeProduct(context: Context, account: Account, current: Holding, change: { productId: number; date: string; annualFeeCents: number; last4: string | null; direction: Exclude<HoldingChange, "opened"> }, holdings: Holding[]) {
  const { db, householdId } = context;
  if (change.date < current.startedOn) throw new Error("The change date must be after the current product started.");
  check(await db.from("account_products").update({ ended_on: change.date }).eq("household_id", householdId).eq("id", current.id), "record the product change");
  const inserted = await db.from("account_products").insert({
    household_id: householdId,
    account_id: account.id,
    person_id: account.personId,
    product_id: change.productId,
    number: nextHoldingNumber(holdings, account.personId, change.productId),
    started_on: change.date,
    change: change.direction,
    annual_fee_cents: change.annualFeeCents,
    last4: change.last4 ?? current.last4,
  });
  if (inserted.error) {
    await db.from("account_products").update({ ended_on: null }).eq("household_id", householdId).eq("id", current.id);
    check(inserted, "record the product change");
  }
}

/** Removes the most recent product change, restoring the previous product. */
export async function undoProductChange(context: Context, current: Holding, previous: Holding) {
  const { db, householdId } = context;
  check(await db.from("account_products").delete().eq("household_id", householdId).eq("id", current.id), "remove the product change");
  check(await db.from("account_products").update({ ended_on: null }).eq("household_id", householdId).eq("id", previous.id), "remove the product change");
}

export async function deleteAccount(context: Context, accountId: number) {
  check(await context.db.from("accounts").delete().eq("household_id", context.householdId).eq("id", accountId), "delete the card");
}

export type PersonDraft = { name: string };

export async function addPerson(context: Context, draft: PersonDraft, sort: number) {
  const row = check(await context.db.from("people").insert({ household_id: context.householdId, name: draft.name.trim(), sort }).select("id").single(), "add the person");
  return num((row as Row).id);
}
