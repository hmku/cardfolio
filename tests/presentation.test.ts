import assert from "node:assert/strict";
import test from "node:test";
import { formatMoney, indexPortfolio, isLast4, type Account, type Holding } from "../app/lib/core/model.ts";
import { bankAccountKind } from "../app/lib/presentation/account-labels.ts";
import { cardStatus } from "../app/lib/presentation/card-status.ts";

const today = new Date(2026, 8, 29, 12);
const account: Account = {
  id: 1, personId: 1, appliedOn: "2026-06-01", approvedOn: "2026-06-01",
  openedVia: "applied", status: "open", closedOn: null, note: null,
  bonus: { amount: 100000, unit: "points", spendCents: 500000, months: 3 }, bonusEarned: false,
};
const holding: Holding = {
  id: 1, accountId: 1, personId: 1, productId: 1, number: 1, last4: "1234",
  startedOn: "2026-06-01", endedOn: null, change: "opened", annualFeeCents: 9500,
};
function fixture(value = account, holdings = [holding], review = false) {
  return indexPortfolio({
    people: [{ id: 1, name: "Alex", code: "AX", email: null, sort: 0 }],
    products: [{ id: 1, slug: "test", shortName: null, name: "Test Card", issuer: "Test", kind: "personal", annualFeeCents: 9500 }],
    accounts: [value], holdings, credits: [], uses: [], optOuts: [],
    rules: [{ id: "review", name: "Annual fee review", actionCode: "CLOSE", priority: 1, enabled: review, conditions: {} }],
  });
}

test("missed bonus is an alert; marking it earned removes the deadline task", () => {
  const status = cardStatus(fixture(), account, holding, today);
  assert.equal(status.tone, "alert");
  assert.match(status.tags.find((tag) => tag.key === "bonus")!.text, /deadline passed Sep 1/);
  const earned = { ...account, bonusEarned: true };
  assert.equal(cardStatus(fixture(earned), earned, holding, today).bonusInProgress, false);
  assert.equal(cardStatus(fixture(earned), earned, holding, today).tags.length, 0);
});

test("pending and closed accounts never inherit open-card bonus tasks", () => {
  for (const state of ["pending", "closed"] as const) {
    const value = { ...account, status: state, closedOn: state === "closed" ? "2026-09-15" : null };
    const status = cardStatus(fixture(value), value, holding, today);
    assert.equal(status.tone, state === "pending" ? "info" : null);
    assert.equal(status.bonusInProgress, false);
    assert.deepEqual(status.tags.map((tag) => tag.key), [state]);
  }
});

test("historical credit holdings show their successor rather than its bonus or review tasks", () => {
  const old = { ...holding, endedOn: "2026-09-20" };
  const current: Holding = { ...holding, id: 2, number: 2, startedOn: "2026-09-20", change: "upgrade" };
  const status = cardStatus(fixture(account, [old, current], true), account, old, today);
  assert.equal(status.tone, null);
  assert.equal(status.bonusInProgress, false);
  assert.deepEqual(status.tags, [{ key: "now", text: "Now test AX2" }]);
});

test("fee reviews describe an estimated anniversary rather than claiming a statement posting", () => {
  const value = { ...account, approvedOn: "2025-09-13", bonusEarned: true };
  const status = cardStatus(fixture(value, [holding], true), value, holding, today);
  assert.equal(status.tone, "alert");
  assert.equal(status.tags[0].text, "Keep or close? $95 fee, renewed Sep 13");
  assert.doesNotMatch(status.tags[0].text, /posted/);
});

test("a December anniversary still reads as renewed after New Year", () => {
  const value = { ...account, approvedOn: "2024-12-20", bonusEarned: true };
  const january = new Date(2027, 0, 10, 12);
  const status = cardStatus(fixture(value, [holding], true), value, holding, january);
  assert.equal(status.tags[0].text, "Keep or close? $95 fee, renewed Dec 20");
});

test("review priority outranks an in-progress bonus and future changes aren't called recent", () => {
  const value = { ...account, approvedOn: "2026-08-01" };
  const future: Holding = { ...holding, id: 2, number: 2, startedOn: "2026-10-01", change: "upgrade" };
  const portfolio = fixture(value, [{ ...holding, endedOn: "2026-10-01" }, future], true);
  const status = cardStatus(portfolio, value, future, today);
  assert.equal(status.tone, "alert");
  assert.equal(status.tags.find((tag) => tag.key === "bonus")?.tone, "due");
  assert.ok(!status.tags.some((tag) => tag.key === "change"));
});

test("fee cards kept past their first year get the light kept tone, below everything else", () => {
  const value = { ...account, approvedOn: "2024-03-10", bonusEarned: true };
  const status = cardStatus(fixture(value), value, holding, today);
  assert.equal(status.tone, "kept");
  assert.equal(status.tags[0].text, "Kept · $95 fee Mar 2027");
  const young = { ...account, approvedOn: "2025-12-01", bonusEarned: true };
  assert.equal(cardStatus(fixture(young), young, holding, today).tone, null, "not before the first fee");
  const pending = { ...value, status: "pending" as const };
  assert.equal(cardStatus(fixture(pending), pending, holding, today).tone, "info");
});

test("formatMoney shows whole dollars or two decimals, with the sign before the $", () => {
  assert.equal(formatMoney(69500), "$695");
  assert.equal(formatMoney(1250), "$12.50");
  assert.equal(formatMoney(123450), "$1,234.50");
  assert.equal(formatMoney(-0.4), "$0", "no sign on an amount that rounds to zero");
  assert.equal(formatMoney(150050), "$1,500.50");
  assert.equal(formatMoney(-1234), "−$12.34");
  assert.equal(formatMoney(-50000), "−$500");
  assert.equal(formatMoney(0), "$0");
});

test("last digits are 4 or 5 numbers", () => {
  assert.equal(isLast4("1234"), true);
  assert.equal(isLast4("21005"), true);
  assert.equal(isLast4("12"), false);
  assert.equal(isLast4("123456"), false);
  assert.equal(isLast4("12a4"), false);
});

test("bank account kinds read the same in Settings and on Accounts", () => {
  assert.equal(bankAccountKind({ type: "investment", subtype: "roth 401k" }), "Roth 401(k)");
  assert.equal(bankAccountKind({ type: "investment", subtype: "sep ira" }), "SEP IRA");
  assert.equal(bankAccountKind({ type: "depository", subtype: "checking" }), "Checking");
  assert.equal(bankAccountKind({ type: null, subtype: null }), "Account");
});
