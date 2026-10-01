import assert from "node:assert/strict";
import test from "node:test";
import { indexPortfolio, type Account, type Holding } from "../app/lib/core/model.ts";
import { accountAction, DEFAULT_ACTION_RULES } from "../app/lib/core/rules.ts";

// Approved 2025-10-10 with a $695 fee: the review window runs Sep 21 – Dec 8, 2026.
const account: Account = {
  id: 1, personId: 1, appliedOn: "2025-10-10", approvedOn: "2025-10-10",
  openedVia: "applied", status: "open", closedOn: null, note: null, bonus: null, bonusEarned: false,
};
const plat: Holding = { id: 1, accountId: 1, personId: 1, productId: 1, number: 1, last4: null, startedOn: "2025-10-10", endedOn: null, change: "opened", annualFeeCents: 69500 };

function portfolio(holdings: Holding[]) {
  return indexPortfolio({
    people: [{ id: 1, name: "Alex", code: "AX", email: null, sort: 0 }],
    products: [
      { id: 1, slug: "plat", shortName: null, name: "Platinum", issuer: "Test", kind: "personal", annualFeeCents: 69500 },
      { id: 2, slug: "gold", shortName: null, name: "Gold", issuer: "Test", kind: "personal", annualFeeCents: 32500 },
    ],
    accounts: [account], holdings, credits: [], uses: [], optOuts: [], rules: DEFAULT_ACTION_RULES,
  });
}

function downgradedOn(date: string) {
  return portfolio([
    { ...plat, endedOn: date },
    { id: 2, accountId: 1, personId: 1, productId: 2, number: 1, last4: null, startedOn: date, endedOn: null, change: "downgrade", annualFeeCents: 32500 },
  ]);
}

const review = (value: ReturnType<typeof portfolio>, today: Date) => accountAction(value, account, today)?.name ?? null;

test("annual fee review shows around the anniversary", () => {
  assert.equal(review(portfolio([plat]), new Date(2026, 9, 1, 12)), "Annual fee review");
  assert.equal(review(portfolio([plat]), new Date(2026, 6, 1, 12)), null);
});

test("a downgrade to another fee card around the anniversary counts as this year's decision", () => {
  assert.equal(review(downgradedOn("2026-09-25"), new Date(2026, 9, 1, 12)), null, "changed inside the window");
  assert.equal(review(downgradedOn("2026-08-15"), new Date(2026, 9, 1, 12)), null, "changed shortly before the window");
  assert.equal(review(downgradedOn("2026-09-25"), new Date(2027, 9, 1, 12)), "Annual fee review", "back next year");
});

test("a product change earlier in the year doesn't hide the review", () => {
  assert.equal(review(downgradedOn("2026-03-01"), new Date(2026, 9, 1, 12)), "Annual fee review");
});
