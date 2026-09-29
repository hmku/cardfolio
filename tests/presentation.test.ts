import assert from "node:assert/strict";
import test from "node:test";
import { indexPortfolio, type Account, type Holding } from "../app/lib/core/model.ts";
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
  assert.match(status.tags[0].text, /fee anniversary Sep 13/);
  assert.doesNotMatch(status.tags[0].text, /posted/);
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
