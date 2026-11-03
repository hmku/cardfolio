import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { balanceColumns, hiddenLoginIds, nextItemStatus, type PlaidBalances } from "@/app/lib/core/finance";
import { matchPlaidAccounts } from "@/app/lib/core/plaid";
import type { HouseholdContext } from "./storage";

/**
 * Plaid API calls and access-token storage. PLAID_ENV picks the server: "sandbox" (fake
 * banks, PLAID_SANDBOX_SECRET) or "production" (real banks, PLAID_SECRET).
 */

/** The Plaid server PLAID_ENV picks, or null when it's set to something else. */
export function plaidEnvironment(): "sandbox" | "production" | null {
  const env = (process.env.PLAID_ENV || "sandbox").trim().toLowerCase();
  return env === "sandbox" || env === "production" ? env : null;
}

function plaidEnv() {
  const env = plaidEnvironment();
  if (!env) throw new Error("PLAID_ENV should be sandbox or production.");
  return env;
}

function credentials() {
  const env = plaidEnv();
  const clientId = process.env.PLAID_CLIENT_ID;
  const secret = env === "sandbox" ? process.env.PLAID_SANDBOX_SECRET : process.env.PLAID_SECRET;
  if (!clientId || !secret) throw new Response("Plaid isn't set up on the server yet", { status: 503 });
  return { env, clientId, secret };
}

export function plaidConfigured() {
  try {
    credentials();
    return !!process.env.PLAID_TOKEN_KEY;
  } catch {
    return false;
  }
}

type PlaidError = { error_type?: string; error_code?: string; error_message?: string; display_message?: string | null };

export class PlaidApiError extends Error {
  /** `status` is the HTTP status; `type` is Plaid's error_type (e.g. INVALID_INPUT), when the answer had one. */
  constructor(readonly code: string, message: string, readonly status: number | null = null, readonly type: string | null = null) {
    super(message);
  }
}

const PLAID_TIMEOUT_MS = 60_000;

export async function plaid<T>(path: string, body: Record<string, unknown>, options: { timeoutMs?: number } = {}): Promise<T> {
  const { env, clientId, secret } = credentials();
  const response = await fetch(`https://${env}.plaid.com${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_id: clientId, secret, ...body }),
    // One hung request shouldn't use up a route's whole time budget.
    signal: AbortSignal.timeout(options.timeoutMs ?? PLAID_TIMEOUT_MS),
  });
  const payload = await response.json().catch(() => ({})) as T & PlaidError;
  if (!response.ok) {
    throw new PlaidApiError(payload.error_code || "UNKNOWN", payload.display_message || payload.error_message || `Plaid ${path} failed (${response.status})`, response.status, payload.error_type || null);
  }
  return payload;
}

// Access tokens are stored as "v1:" + base64(iv | tag | ciphertext), AES-256-GCM.
function tokenKey() {
  const key = Buffer.from(process.env.PLAID_TOKEN_KEY || "", "base64");
  if (key.length !== 32) throw new Error("PLAID_TOKEN_KEY should be 32 random bytes, base64-encoded.");
  return key;
}

export function encryptToken(token: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", tokenKey(), iv);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return `v1:${Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64")}`;
}

export function decryptToken(stored: string) {
  if (!stored.startsWith("v1:")) throw new Error("Unknown access token format.");
  const data = Buffer.from(stored.slice(3), "base64");
  const decipher = createDecipheriv("aes-256-gcm", tokenKey(), data.subarray(0, 12));
  decipher.setAuthTag(data.subarray(12, 28));
  return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString("utf8");
}

export type PlaidAccount = { account_id: string; name: string; official_name: string | null; mask: string | null; type: string; subtype: string | null; balances?: PlaidBalances | null };

export type LinkKind = "bank" | "investments";

/**
 * A Link token for connecting a new login, or for re-entering one (update mode, accessToken).
 * Products can't be added to a login later without reconnecting it, so each kind asks for
 * everything it may need: banks and cards get transactions plus card due dates and
 * balances (liabilities) where supported; brokerages get holdings (investments) plus cash
 * transactions where supported. Transactions go back the full two years Plaid allows.
 */
export async function createLinkToken(userId: string, options: { accessToken?: string; kind?: LinkKind } = {}) {
  // PLAID_WEBHOOK_URL (e.g. https://cardfolio.example.com/api/plaid/webhook) makes Plaid
  // notify Cardfolio when new data is ready; without it the daily sync and "Sync now" do.
  const webhook = process.env.PLAID_WEBHOOK_URL?.trim();
  const base = { client_name: "Cardfolio", language: "en", country_codes: ["US"], user: { client_user_id: userId }, ...(webhook ? { webhook } : {}) };
  const body = options.accessToken
    ? { ...base, access_token: options.accessToken }
    : options.kind === "investments"
      ? { ...base, products: ["investments"], optional_products: ["transactions"], transactions: { days_requested: 730 } }
      : { ...base, products: ["transactions"], required_if_supported_products: ["liabilities"], transactions: { days_requested: 730 } };
  const { link_token } = await plaid<{ link_token: string }>("/link/token/create", body);
  return link_token;
}

export async function exchangePublicToken(publicToken: string) {
  const { access_token, item_id } = await plaid<{ access_token: string; item_id: string }>("/item/public_token/exchange", { public_token: publicToken });
  return { accessToken: access_token, itemId: item_id };
}

export type PlaidItemInfo = {
  institution_id?: string | null;
  consent_expiration_time?: string | null;
  webhook?: string | null;
  /** Products added to the login (what Link asked for and the bank supports). */
  products?: string[] | null;
  billed_products?: string[] | null;
};

/** The login's accounts with Plaid's cached balances (free, unlike /accounts/balance/get). */
export async function getAccounts(accessToken: string) {
  const payload = await plaid<{ accounts: PlaidAccount[]; item: PlaidItemInfo }>("/accounts/get", { access_token: accessToken });
  return { accounts: payload.accounts, item: payload.item };
}

export async function removeItem(accessToken: string) {
  await plaid("/item/remove", { access_token: accessToken });
}

/**
 * Saves Plaid's accounts for an item, then links new credit cards to Cardfolio cards (see
 * autoLinkItem). Accounts in the item's ignored_accounts (carried by another connection of the
 * same login, see planLoginConnect) are left out.
 */
export async function syncItemAccounts(context: Pick<HouseholdContext, "db" | "householdId">, itemId: number, allAccounts: PlaidAccount[]) {
  const { db, householdId } = context;
  const now = new Date().toISOString();
  const { data: item, error: itemError } = await db.from("plaid_items").select("person_id, ignored_accounts").eq("id", itemId).single();
  if (itemError) throw itemError;
  const ignored = new Set((item.ignored_accounts as string[] | null) || []);
  const accounts = allAccounts.filter((account) => !ignored.has(account.account_id));
  const { data: existing, error: existingError } = await db.from("plaid_accounts").select("id, plaid_account_id").eq("item_id", itemId);
  if (existingError) throw existingError;
  const known = new Set((existing || []).map((row) => row.plaid_account_id as string));
  for (const account of accounts) {
    const row = { name: account.name, official_name: account.official_name, mask: account.mask, type: account.type, subtype: account.subtype, ...balanceColumns(account.balances, now) };
    const { error } = known.has(account.account_id)
      ? await db.from("plaid_accounts").update(row).eq("plaid_account_id", account.account_id)
      : await db.from("plaid_accounts").insert({ ...row, household_id: householdId, item_id: itemId, plaid_account_id: account.account_id });
    if (error) throw error;
  }

  // New accounts default to the login's owner.
  if (item.person_id) {
    const { error } = await db.from("plaid_accounts").update({ person_id: item.person_id }).eq("item_id", itemId).is("person_id", null);
    if (error) throw error;
  }
  const linked = await autoLinkItem(context, itemId);
  return { found: accounts.length, linked };
}

/**
 * Links an item's unlinked credit cards to open Cardfolio cards by card type, cardholder (the
 * login's owner, when set) and last digits. Accounts a person already linked or unlinked by
 * hand (link_source set) are left alone. Returns how many were linked.
 */
export async function autoLinkItem(context: Pick<HouseholdContext, "db" | "householdId">, itemId: number) {
  const { db, householdId } = context;
  const [item, unlinked, open, holdings, products, linked] = await Promise.all([
    db.from("plaid_items").select("person_id").eq("id", itemId).single(),
    db.from("plaid_accounts").select("id, mask, name, official_name").eq("item_id", itemId).eq("type", "credit").is("account_id", null).is("link_source", null),
    db.from("accounts").select("id").eq("household_id", householdId).eq("status", "open"),
    db.from("account_products").select("account_id, person_id, product_id, last4, started_on, ended_on").eq("household_id", householdId),
    db.from("products").select("id, name").eq("household_id", householdId),
    db.from("plaid_accounts").select("account_id").eq("household_id", householdId).not("account_id", "is", null),
  ]);
  for (const result of [item, unlinked, open, holdings, products, linked]) if (result.error) throw result.error;
  const openIds = new Set((open.data || []).map((row) => row.id as number));
  const productNames = new Map((products.data || []).map((row) => [row.id as number, row.name as string]));
  const byAccount = new Map<number, { person_id: number; product_id: number; last4: string | null; started_on: string; ended_on: string | null }[]>();
  for (const row of holdings.data || []) {
    if (!openIds.has(row.account_id as number)) continue;
    byAccount.set(row.account_id as number, [...(byAccount.get(row.account_id as number) || []), row as never]);
  }
  const cards = [...byAccount.entries()].flatMap(([accountId, rows]) => {
    const history = [...rows].sort((left, right) => right.started_on.localeCompare(left.started_on));
    const current = history.find((row) => !row.ended_on) || history[0];
    if (!current) return [];
    const digits = [...new Set(history.map((row) => row.last4).filter((value): value is string => !!value))];
    return [{ accountId, digits, productName: productNames.get(current.product_id), personId: current.person_id }];
  });
  const matches = matchPlaidAccounts(
    (unlinked.data || []).map((row) => ({ id: row.id as number, mask: row.mask as string | null, name: (row.official_name || row.name) as string })),
    cards,
    (linked.data || []).map((row) => row.account_id as number),
    { personId: item.data?.person_id as number | null },
  );
  for (const [id, accountId] of matches) {
    const { error } = await db.from("plaid_accounts").update({ account_id: accountId, link_source: "auto" }).eq("id", id);
    if (error) throw error;
  }
  return matches.size;
}


/** Logins hidden from a member with hideInvestments (see hiddenLoginIds). Empty for everyone else. */
export async function hiddenItemIds(context: Pick<HouseholdContext, "db" | "householdId" | "hideInvestments">) {
  if (!context.hideInvestments) return new Set<number>();
  const { data, error } = await context.db.from("plaid_accounts").select("item_id, type").eq("household_id", context.householdId);
  if (error) throw error;
  return hiddenLoginIds((data || []) as { item_id: number; type: string | null }[], true);
}

/** A 404, as if the login didn't exist, when it's hidden from this member. */
export async function assertItemVisible(context: Pick<HouseholdContext, "db" | "householdId" | "hideInvestments">, itemId: number) {
  if ((await hiddenItemIds(context)).has(itemId)) throw new Response("That bank connection wasn't found", { status: 404 });
}

/** The household's item (with its decrypted access token), or a 404 (also when it's hidden from this member). */
export async function loadItem(context: HouseholdContext, id: unknown) {
  const { data, error } = await context.db.from("plaid_items").select("id, access_token_encrypted").eq("household_id", context.householdId).eq("id", Number(id)).maybeSingle();
  if (error) throw error;
  if (!data) throw new Response("That bank connection wasn't found", { status: 404 });
  await assertItemVisible(context, data.id as number);
  return { id: data.id as number, accessToken: decryptToken(data.access_token_encrypted as string) };
}

/** Records a Plaid error on an item, marking it for reconnecting when the login needs attention (see nextItemStatus). */
export async function noteItemError(context: Pick<HouseholdContext, "db">, itemId: number, error: unknown) {
  if (!(error instanceof PlaidApiError)) return;
  const { data: current } = await context.db.from("plaid_items").select("status, error_code").eq("id", itemId).maybeSingle();
  const next = nextItemStatus({ status: (current?.status as string | null) ?? null, errorCode: (current?.error_code as string | null) ?? null }, { kind: "error", errorCode: error.code });
  await context.db.from("plaid_items").update({ status: next.status, error_code: next.errorCode, updated_at: new Date().toISOString() }).eq("id", itemId);
}
