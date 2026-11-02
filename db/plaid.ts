import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { balanceColumns, RECONNECT_ERRORS, type PlaidBalances } from "@/app/lib/core/finance";
import { matchPlaidAccounts } from "@/app/lib/core/plaid";
import type { HouseholdContext } from "./storage";

/**
 * Plaid API calls and access-token storage. PLAID_ENV picks the server: "sandbox" (fake
 * banks, PLAID_SANDBOX_SECRET) or "production" (real banks, PLAID_SECRET).
 */

function plaidEnv() {
  const env = (process.env.PLAID_ENV || "sandbox").trim().toLowerCase();
  if (env !== "sandbox" && env !== "production") throw new Error("PLAID_ENV should be sandbox or production.");
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

type PlaidError = { error_code?: string; error_message?: string; display_message?: string | null };

export class PlaidApiError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

export async function plaid<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const { env, clientId, secret } = credentials();
  const response = await fetch(`https://${env}.plaid.com${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_id: clientId, secret, ...body }),
  });
  const payload = await response.json().catch(() => ({})) as T & PlaidError;
  if (!response.ok) {
    throw new PlaidApiError(payload.error_code || "UNKNOWN", payload.display_message || payload.error_message || `Plaid ${path} failed (${response.status})`);
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

/** Saves Plaid's accounts for an item and links new credit cards to Cardfolio cards by last digits. */
export async function syncItemAccounts(context: Pick<HouseholdContext, "db" | "householdId">, itemId: number, accounts: PlaidAccount[]) {
  const { db, householdId } = context;
  const now = new Date().toISOString();
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

  // Accounts a person already linked or unlinked by hand (link_source set) are left alone.
  const [unlinked, open, current, linked] = await Promise.all([
    db.from("plaid_accounts").select("id, mask").eq("item_id", itemId).eq("type", "credit").is("account_id", null).is("link_source", null),
    db.from("accounts").select("id").eq("household_id", householdId).eq("status", "open"),
    db.from("account_products").select("account_id, last4").eq("household_id", householdId).is("ended_on", null),
    db.from("plaid_accounts").select("account_id").eq("household_id", householdId).not("account_id", "is", null),
  ]);
  for (const result of [unlinked, open, current, linked]) if (result.error) throw result.error;
  const openIds = new Set((open.data || []).map((row) => row.id as number));
  const matches = matchPlaidAccounts(
    (unlinked.data || []).map((row) => ({ id: row.id as number, mask: row.mask as string | null })),
    (current.data || []).filter((row) => openIds.has(row.account_id as number)).map((row) => ({ accountId: row.account_id as number, last4: row.last4 as string | null })),
    (linked.data || []).map((row) => row.account_id as number),
  );
  for (const [id, accountId] of matches) {
    const { error } = await db.from("plaid_accounts").update({ account_id: accountId, link_source: "auto" }).eq("id", id);
    if (error) throw error;
  }
  return { found: accounts.length, linked: matches.size };
}

/** The household's item (with its decrypted access token), or a 404. */
export async function loadItem(context: HouseholdContext, id: unknown) {
  const { data, error } = await context.db.from("plaid_items").select("id, access_token_encrypted").eq("household_id", context.householdId).eq("id", Number(id)).maybeSingle();
  if (error) throw error;
  if (!data) throw new Response("That bank connection wasn't found", { status: 404 });
  return { id: data.id as number, accessToken: decryptToken(data.access_token_encrypted as string) };
}

/** Marks an item for reconnecting when Plaid says the bank login needs attention. */
export async function noteItemError(context: Pick<HouseholdContext, "db">, itemId: number, error: unknown) {
  if (!(error instanceof PlaidApiError)) return;
  const reconnect = RECONNECT_ERRORS.has(error.code);
  await context.db.from("plaid_items").update({ status: reconnect ? "reconnect" : "ok", error_code: error.code, updated_at: new Date().toISOString() }).eq("id", itemId);
}
