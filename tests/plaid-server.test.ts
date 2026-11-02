import assert from "node:assert/strict";
import test from "node:test";
import { isDuplicateLogin, mergeSyncedProducts, nextItemStatus } from "../app/lib/core/finance.ts";
import { webhookKeyCache, type WebhookKey } from "../db/plaid-webhook.ts";

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
