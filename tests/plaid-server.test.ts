import assert from "node:assert/strict";
import test from "node:test";
import { hiddenLoginIds, isDuplicateLogin, mergeSyncedProducts, nextItemStatus, planLoginConnect } from "../app/lib/core/finance.ts";
import { lookupWebhookKey, webhookKeyCache, type WebhookKey } from "../db/plaid-webhook.ts";

test("a bank login's reconnect flag stays until it's repaired", () => {
  const ok = { status: "ok", errorCode: null };
  const warned = { status: "reconnect", errorCode: "PENDING_EXPIRATION" };
  const broken = { status: "reconnect", errorCode: "ITEM_LOGIN_REQUIRED" };

  // Advance warnings survive successful syncs and unrelated errors.
  assert.deepEqual(nextItemStatus(warned, { kind: "synced", errorCode: null }), warned);
  assert.deepEqual(nextItemStatus({ status: "reconnect", errorCode: "PENDING_DISCONNECT" }, { kind: "synced", errorCode: "PRODUCTS_NOT_READY" }), { status: "reconnect", errorCode: "PENDING_DISCONNECT" });
  assert.deepEqual(nextItemStatus(warned, { kind: "error", errorCode: "INSTITUTION_DOWN" }), warned);
  // A non-reconnect error never hides a hard login error either.
  assert.deepEqual(nextItemStatus(broken, { kind: "error", errorCode: "RATE_LIMIT_EXCEEDED" }), broken);
  // A newer reconnect error replaces the old one.
  assert.deepEqual(nextItemStatus(warned, { kind: "error", errorCode: "ITEM_LOGIN_REQUIRED" }), broken);
  // A sync that reached the bank proves a hard login error is fixed.
  assert.deepEqual(nextItemStatus(broken, { kind: "synced", errorCode: null }), ok);
  // Repairs clear everything.
  assert.deepEqual(nextItemStatus(warned, { kind: "repaired" }), ok);
  assert.deepEqual(nextItemStatus(broken, { kind: "repaired" }), ok);
  // A healthy login records product errors without needing a reconnect.
  assert.deepEqual(nextItemStatus(ok, { kind: "synced", errorCode: "PRODUCTS_NOT_READY" }), { status: "ok", errorCode: "PRODUCTS_NOT_READY" });
  assert.deepEqual(nextItemStatus(ok, { kind: "error", errorCode: "INSTITUTION_DOWN" }), { status: "ok", errorCode: "INSTITUTION_DOWN" });
  assert.deepEqual(nextItemStatus(ok, { kind: "error", errorCode: "PENDING_EXPIRATION" }), warned);
  assert.deepEqual(nextItemStatus({ status: null, errorCode: null }, { kind: "synced", errorCode: null }), ok);
});

test("a partial sync adds to the login's synced products instead of replacing them", () => {
  assert.deepEqual(mergeSyncedProducts(["transactions", "liabilities"], { holdings: "ok" }), ["transactions", "liabilities", "holdings"]);
  assert.deepEqual(mergeSyncedProducts(["transactions", "liabilities"], { liabilities: "not_available", transactions: "error" }), ["transactions"]);
  assert.deepEqual(mergeSyncedProducts(null, { holdings: "ok", transactions: "ok", investment_transactions: "skipped" }), ["transactions", "holdings"]);
  assert.deepEqual(mergeSyncedProducts(null, {}), []);
});

test("connecting the same bank login twice is detected by institution and account digits", () => {
  const existing = [{ institutionId: "ins_3", accounts: [{ mask: "1234", subtype: "credit card" }, { mask: "5678", subtype: "checking" }] }];
  assert.equal(isDuplicateLogin("ins_3", [{ mask: "1234", subtype: "credit card" }, { mask: "5678", subtype: "checking" }], existing), true);
  assert.equal(isDuplicateLogin("ins_3", [{ mask: "1234", subtype: "credit card" }], existing), true, "a subset of the same accounts");
  assert.equal(isDuplicateLogin("ins_3", [{ mask: "1234", subtype: "credit card" }, { mask: "9999", subtype: "savings" }], existing), false, "a new account");
  assert.equal(isDuplicateLogin("ins_4", [{ mask: "1234", subtype: "credit card" }], existing), false, "another bank");
  assert.equal(isDuplicateLogin("ins_3", [{ mask: "1234", subtype: "checking" }], existing), false, "same digits, other kind");
  assert.equal(isDuplicateLogin("ins_3", [{ mask: null, subtype: "checking" }], existing), false, "no digits to compare");
  assert.equal(isDuplicateLogin(null, [{ mask: "1234", subtype: "credit card" }], existing), false);
  assert.equal(isDuplicateLogin("ins_3", [{ mask: "1234", subtype: "credit card" }], []), false);
});

test("connecting a login again for a product it lacks isn't a duplicate", () => {
  const bank = [{ institutionId: "ins_3", syncedProducts: ["transactions", "liabilities"], accounts: [{ mask: "1234", subtype: "credit card" }, { mask: "4444", subtype: "brokerage" }] }];
  const brokerage = [{ mask: "4444", subtype: "brokerage" }];
  assert.equal(isDuplicateLogin("ins_3", brokerage, bank, ["investments", "transactions"]), false, "adds Investments");
  assert.equal(isDuplicateLogin("ins_3", brokerage, bank, ["transactions", "liabilities"]), true, "the same products");
  assert.equal(isDuplicateLogin("ins_3", brokerage, bank, ["transactions"]), true, "fewer products");
  assert.equal(isDuplicateLogin("ins_3", brokerage, bank), true, "products unknown");
  assert.equal(isDuplicateLogin("ins_3", brokerage, [{ ...bank[0], syncedProducts: null }], ["investments"]), true, "stored products unknown");
  assert.equal(isDuplicateLogin("ins_3", brokerage, [{ ...bank[0], syncedProducts: ["transactions", "holdings"] }], ["investments"]), true, "already has holdings");

  // Both connections are kept, each account stored once: the brokerage moves to the new one.
  const stored = [{
    id: 7, institutionId: "ins_3", syncedProducts: ["transactions", "liabilities"],
    accounts: [
      { rowId: 70, plaidAccountId: "old-card", mask: "1234", subtype: "credit card", type: "credit" },
      { rowId: 71, plaidAccountId: "old-brokerage", mask: "4444", subtype: "brokerage", type: "investment" },
    ],
  }];
  const again = [
    { plaidAccountId: "new-card", mask: "1234", subtype: "credit card", type: "credit" },
    { plaidAccountId: "new-brokerage", mask: "4444", subtype: "brokerage", type: "investment" },
  ];
  assert.deepEqual(planLoginConnect("ins_3", again, ["investments", "transactions"], stored), {
    kind: "share", itemId: 7, move: [{ rowId: 71, plaidAccountId: "new-brokerage" }], ignore: ["new-card"], release: ["old-brokerage"],
  });
  assert.deepEqual(planLoginConnect("ins_3", again, ["transactions", "liabilities"], stored), { kind: "duplicate", itemId: 7 });
  // Adding Investments to a login with no investment account brings nothing to store.
  assert.deepEqual(planLoginConnect("ins_3", again.slice(0, 1), ["investments"], stored), { kind: "duplicate", itemId: 7 });
  assert.deepEqual(planLoginConnect("ins_4", again, ["investments"], stored), { kind: "new" });
});

test("members with hideInvestments don't see investment-only logins", () => {
  const accounts = [
    { item_id: 1, type: "investment" },
    { item_id: 1, type: "investment" },
    { item_id: 2, type: "investment" },
    { item_id: 2, type: "depository" },
    { item_id: 3, type: "credit" },
  ];
  assert.deepEqual([...hiddenLoginIds(accounts, true)], [1], "investment-only hidden; mixed and card logins shown");
  assert.deepEqual([...hiddenLoginIds(accounts, false)], [], "everyone else sees all");
  assert.deepEqual([...hiddenLoginIds([], true)], [], "a login with no accounts isn't hidden");
});

test("a webhook key lookup is null only when Plaid says the kid is invalid", async () => {
  const key: WebhookKey = { kty: "EC", crv: "P-256", x: "x", y: "y", kid: "k1", expired_at: null };
  const failing = (error: unknown) => async () => { throw error; };
  assert.equal(await lookupWebhookKey("k1", async () => key), key);
  assert.equal(await lookupWebhookKey("k1", failing({ code: "INVALID_WEBHOOK_VERIFICATION_KEY_ID", status: 400, type: "INVALID_INPUT" })), null);
  assert.equal(await lookupWebhookKey("k1", failing({ code: "SOMETHING", status: 400, type: null })), null);
  for (const error of [
    { code: "UNKNOWN", status: 502, type: null },
    { code: "UNKNOWN", status: 400, type: null },
    { code: "RATE_LIMIT_EXCEEDED", status: 429, type: "RATE_LIMIT_EXCEEDED" },
    { code: "INTERNAL_SERVER_ERROR", status: 500, type: "API_ERROR" },
    new DOMException("timed out", "TimeoutError"),
  ]) await assert.rejects(lookupWebhookKey("k1", failing(error)));

  // Through the cache: a 502 from Plaid's edge isn't remembered as an unknown kid.
  let calls = 0;
  let down = true;
  const cache = webhookKeyCache((kid) => lookupWebhookKey(kid, async () => {
    calls += 1;
    if (down) throw { code: "UNKNOWN", status: 502, type: null };
    return key;
  }), () => 0);
  assert.equal(await cache("k1"), null);
  down = false;
  assert.equal(await cache("k1"), key);
  assert.equal(calls, 2);
});

test("webhook verification keys are cached for a day and unknown kids briefly", async () => {
  let now = 0;
  const calls: string[] = [];
  let fail = false;
  const key: WebhookKey = { kty: "EC", crv: "P-256", x: "x", y: "y", kid: "k1", expired_at: null };
  const cache = webhookKeyCache(async (kid) => {
    calls.push(kid);
    if (fail) throw new Error("rate limited");
    return kid === "k1" ? key : null;
  }, () => now);

  assert.equal(await cache("k1"), key);
  assert.equal(await cache("k1"), key);
  assert.deepEqual(calls, ["k1"], "cached");
  assert.equal(await cache("junk"), null);
  assert.equal(await cache("junk"), null);
  assert.deepEqual(calls, ["k1", "junk"], "unknown kid remembered");
  now += 6 * 60 * 1000;
  assert.equal(await cache("junk"), null);
  assert.deepEqual(calls, ["k1", "junk", "junk"], "unknown kid forgotten after a few minutes");
  now += 25 * 60 * 60 * 1000;
  fail = true;
  assert.equal(await cache("k1"), key, "a failed refresh keeps the old key");
  assert.equal(await cache("k2"), null, "a failed lookup isn't remembered");
  fail = false;
  assert.equal(await cache("k2"), null);
  assert.deepEqual(calls.slice(3), ["k1", "k2", "k2"]);

  // A key Plaid has marked expired is fetched again.
  let fetched = 0;
  const counting = webhookKeyCache(async () => { fetched += 1; return { ...key, expired_at: 1 }; }, () => now);
  await counting("k1");
  await counting("k1");
  assert.equal(fetched, 2);
});
