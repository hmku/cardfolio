import assert from "node:assert/strict";
import test from "node:test";
import { planTransactionWrites, transactionsForRule, type PlaidTransaction, type RuleLike, type StoredRuleTarget } from "../app/lib/core/finance.ts";
import { containsPattern } from "../app/lib/finance-data.ts";

const categories = [
  { id: 3, kind: "expense" as const, plaidCategories: ["FOOD_AND_DRINK"] },
  { id: 7, kind: "expense" as const, plaidCategories: ["TRANSPORTATION"] },
];

const rule = (id: number, matchText: string, categoryId: number, extra: Partial<RuleLike> = {}): RuleLike => ({ id, matchText, matchField: "any", plaidAccountId: null, categoryId, setExcluded: null, ...extra });

const stored = (id: number, name: string, merchantName: string | null, extra: Partial<StoredRuleTarget> = {}): StoredRuleTarget => ({
  id, name, merchantName, plaidAccountId: 1, categoryId: null, categorySource: null, excluded: false, ...extra,
});

test("applying a rule to stored transactions leaves a more specific rule's matches alone", () => {
  const eats = rule(1, "uber eats", 3);
  const uber = rule(2, "uber", 7);
  const transactions = [
    stored(10, "UBER EATS 123", "Uber Eats", { categoryId: 3, categorySource: "rule" }),
    stored(11, "UBER TRIP", "Uber"),
    stored(12, "UBER TRIP", "Uber", { categoryId: 3, categorySource: "manual" }),
    stored(13, "UBER TRIP 2", "Uber", { categoryId: 7, categorySource: "rule" }),
    stored(14, "UBER TRIP 3", "Uber", { categoryId: 3, categorySource: "plaid" }),
  ];
  assert.deepEqual(transactionsForRule(uber, [eats, uber], transactions), [11, 14], "skips the longer rule's, manual and unchanged ones");
  // An account-specific rule wins over a general one, even with shorter text.
  const mine = rule(3, "ub", 3, { plaidAccountId: 1 });
  assert.deepEqual(transactionsForRule(uber, [eats, uber, mine], transactions), []);
  // The rule passed in (just edited) replaces its stale copy in the list.
  assert.deepEqual(transactionsForRule({ ...uber, setExcluded: true }, [eats, uber], transactions), [11, 13, 14]);
});

test("a hand-cleared category stays cleared through later syncs", () => {
  const tx: PlaidTransaction = { transaction_id: "t", account_id: "a", date: "2026-11-01", amount: 5, name: "UBER", merchant_name: "Uber", personal_finance_category: { primary: "TRANSPORTATION" } };
  const plan = planTransactionWrites({
    householdId: "h", added: [], modified: [tx], removed: [],
    accountIds: new Map([["a", 1]]),
    existing: new Map([["t", { plaidTransactionId: "t", categoryId: null, categorySource: "manual" as const, notes: null, excluded: false, reviewed: false }]]),
    categories, rules: [rule(1, "uber", 7)],
  });
  assert.deepEqual([plan.upserts[0].category_id, plan.upserts[0].category_source], [null, "manual"]);
});

test("ilike patterns escape wildcards, including PostgREST's *", () => {
  assert.equal(containsPattern("  Coffee "), "%coffee%");
  assert.equal(containsPattern("50%_off\\"), "%50\\%\\_off\\\\%");
  assert.equal(containsPattern("a*b"), "%a_b%", "* can't be escaped for PostgREST, so it matches one character");
});
