import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { creditPeriod, creditState, creditSummary, eligibleHoldings } from "../app/lib/core/credits.ts";
import { addMonths, isoDate, parseDate } from "../app/lib/core/dates.ts";
import { bonusLabel, holdingName, indexPortfolio, nextHoldingNumber, type Portfolio } from "../app/lib/core/model.ts";
import {
  cashFlowByMonth, categorize, defaultCategoryFor, matchRule, monthsBefore, netWorthCents, netWorthSeries, planTransactionWrites,
  plaidAmountToCents, snapshotRows, webhookAction, type CategoryLike, type PlaidTransaction, type RuleLike,
} from "../app/lib/core/finance.ts";
import {
  activityKind, aggregatePositions, allocationByAccount, allocationByClass, balanceSeries, manualAccountGroup, periodChange, plaidAccountGroup,
  rangeStart, seriesFrom, sortPositions, summarizePositions, type HoldingInput,
} from "../app/lib/core/investments.ts";
import { matchPlaidAccounts } from "../app/lib/core/plaid.ts";
import { verifyPlaidWebhook } from "../db/plaid-webhook.ts";
import { cashFlowBreakdown, datePresetRange, fillMonths, monthBounds, recentMonths } from "../app/lib/core/finance.ts";
import { bankAccountShortLabel, DEFAULT_TRANSACTION_FILTERS, filtersToQuery, groupByDate } from "../app/lib/presentation/transaction-view.ts";
import { accountAction } from "../app/lib/core/rules.ts";
import { parseOffer, planSheetImport, planToPortfolioData } from "../app/lib/core/sheet-import.ts";
import { bonusStatus, dueItems, feeStatus, fiveTwentyFour, personStats } from "../app/lib/core/stats.ts";
import { parseCsv } from "../scripts/import-sheet.ts";

const today = new Date(2026, 8, 29, 12);
const snapshot = JSON.parse(readFileSync(new URL("../data/sheet-snapshot.json", import.meta.url), "utf8"));
const plan = planSheetImport(snapshot.tracker, snapshot.credits, today);
const portfolio: Portfolio = indexPortfolio(planToPortfolioData(plan));
const personId = (name: string) => portfolio.people.find((person) => person.name === name)!.id;
const productId = (slug: string) => portfolio.products.find((product) => product.slug === slug)!.id;
const holdingsOf = (name: string, slug: string) => portfolio.holdings.filter((holding) => holding.personId === personId(name) && holding.productId === productId(slug));

test("dates clamp month ends and reject malformed input", () => {
  assert.equal(isoDate(addMonths(parseDate("2026-01-31")!, 1)), "2026-02-28");
  assert.equal(isoDate(addMonths(parseDate("2026-05-21")!, 3)), "2026-08-21");
  assert.equal(parseDate("nope"), null);
  assert.equal(parseDate(null), null);
});

test("credit periods cover month, quarter, half, year and card year", () => {
  const range = (period: { start: Date; end: Date; key: string }) => [period.key, isoDate(period.start), isoDate(period.end)];
  assert.deepEqual(range(creditPeriod("monthly", today)), ["2026-09", "2026-09-01", "2026-09-30"]);
  assert.deepEqual(range(creditPeriod("quarterly", today)), ["2026-Q3", "2026-07-01", "2026-09-30"]);
  assert.deepEqual(range(creditPeriod("semiannual", today)), ["2026-H2", "2026-07-01", "2026-12-31"]);
  assert.deepEqual(range(creditPeriod("calendar_year", today)), ["2026", "2026-01-01", "2026-12-31"]);
  assert.deepEqual(range(creditPeriod("card_year", today, "2026-01-04")), ["CY2026", "2026-01-04", "2027-01-03"]);
  assert.deepEqual(range(creditPeriod("card_year", today, "2024-02-29")), ["CY2026", "2026-02-28", "2027-02-27"]);
});

test("offers parse into structured bonuses", () => {
  assert.deepEqual(parseOffer("175k / 12k / 6mo").bonus, { amount: 175000, unit: "points", spendCents: 1_200_000, months: 6 });
  assert.deepEqual(parseOffer("$50 / 0").bonus, { amount: 50, unit: "cash", spendCents: 0, months: 3 });
  assert.equal(parseOffer("5fnc / 8k").bonus?.unit, "nights");
  assert.equal(parseOffer("35k+$250 / 2k").leftover, "35k+$250 / 2k");
  assert.equal(parseOffer("-").bonus, null);
  assert.equal(bonusLabel({ amount: 300000, unit: "points", spendCents: null, months: 3 }), "300k pts");
});

test("CSV parsing handles quotes and commas", () => {
  assert.deepEqual(parseCsv('a,"b, c","say ""hi"""\r\n1,2,3\n'), [["a", "b, c", 'say "hi"'], ["1", "2", "3"]]);
});

test("product changes become one account with a product history", () => {
  const chains = portfolio.accounts
    .filter((account) => account.personId === personId("Harrison") && portfolio.holdingsOf(account.id).some((holding) => holding.productId === productId("csr")))
    .map((account) => portfolio.holdingsOf(account.id).map((holding) => holdingName(portfolio, holding)));
  assert.deepEqual(chains, [
    ["cfu HK1", "csr HK2", "cff HK2", "csr HK4", "cff HK3"],
    ["csr HK1", "cff HK1", "csr HK3", "cfu HK2", "csr HK5"],
  ]);
  const explorer = portfolio.holdings.filter((holding) => holding.personId === personId("Harrison") && holding.productId === productId("united explorer"));
  assert.deepEqual(explorer.map((holding) => holding.change), ["opened", "upgrade"], "the return from Gateway is an upgrade");
  const first = portfolio.holdings.find((holding) => holding.productId === productId("csr") && holding.number === 1)!;
  assert.equal(holdingName(portfolio, first, true), "Chase Sapphire Reserve HK1", "full names are still available");
  assert.deepEqual(plan.personCodes, { Harrison: "HK", Sophia: "SL" }, "initials come from the sheet's hk1/sl1 notes");
  const csr5 = portfolio.holdings.find((holding) => holding.number === 5 && holding.productId === productId("csr"))!;
  assert.equal(portfolio.current(csr5.accountId)!.annualFeeCents, 79_500);
  assert.equal(nextHoldingNumber(portfolio.holdings, personId("Harrison"), productId("csr")), 6);
});

test("stats match the sheet's stats tab", () => {
  const harrison = fiveTwentyFour(portfolio, personId("Harrison"), today);
  const sophia = fiveTwentyFour(portfolio, personId("Sophia"), today);
  assert.equal(harrison.count, 4);
  assert.equal(isoDate(harrison.nextDrop!), "2026-12-08");
  assert.equal(sophia.count, 3);
  assert.equal(isoDate(sophia.nextDrop!), "2026-12-14");
  assert.equal(personStats(portfolio, personId("Harrison"), today).pending, 1);
});

test("action rules flag the same cards as the sheet", () => {
  const flagged = portfolio.accounts
    .map((account) => ({ account, rule: accountAction(portfolio, account, today) }))
    .filter((item) => item.rule)
    .map(({ account, rule }) => `${rule!.actionCode} ${portfolio.person(account.personId)!.name} ${holdingName(portfolio, portfolio.current(account.id)!)}`)
    .sort();
  assert.deepEqual(flagged, [
    "CLOSE Harrison biz plat HK7",
    "CLOSE Harrison wyndham biz HK2",
    "CLOSE Sophia biz plat SL4",
  ]);
});

test("credit usage follows the sheet's counts", () => {
  const summary = (name: string) => {
    const credit = portfolio.credits.find((item) => item.name === name && item.productId === productId("biz plat"))!;
    const result = creditSummary(portfolio, credit, eligibleHoldings(portfolio, credit, today), today);
    return [result.used, result.enrolled];
  };
  assert.deepEqual(summary("Airline fee"), [7, 8]);
  assert.deepEqual(summary("Dell"), [8, 9]);
  assert.deepEqual(summary("Hilton"), [0, 7]);
  assert.deepEqual(summary("CLEAR"), [2, 7]);

  const portal = portfolio.credits.find((item) => item.productId === productId("citi premier"))!;
  const tracked = eligibleHoldings(portfolio, portal, today).filter((holding) => creditState(portfolio, portal, holding, today).kind !== "off");
  assert.deepEqual(tracked.map((holding) => holding.personId), [personId("Sophia")], "the downgraded Strata Premier is the one left out");
});

test("partial uses and opt-outs change a card's credit state", () => {
  const hilton = portfolio.credits.find((item) => item.name === "Hilton")!;
  const holding = eligibleHoldings(portfolio, hilton, today).find((item) => creditState(portfolio, hilton, item, today).kind === "open")!;
  const withUse = indexPortfolio({ ...portfolio, uses: [...portfolio.uses, { id: 999, creditId: hilton.id, holdingId: holding.id, periodKey: "2026-Q3", amountCents: 3000, usedOn: null, recordedBy: null, source: "manual" }] });
  const partial = creditState(withUse, hilton, holding, today);
  assert.equal(partial.kind, "partial");
  assert.equal("daysLeft" in partial ? partial.daysLeft : null, 1);
  const optedOut = indexPortfolio({ ...portfolio, optOuts: [...portfolio.optOuts, { creditId: hilton.id, holdingId: holding.id }] });
  assert.equal(creditState(optedOut, hilton, holding, today).kind, "off");
});

test("due list collects credits, reviews, bonuses and pending applications", () => {
  const items = dueItems(portfolio, today);
  const kinds = items.map((item) => item.kind);
  assert.equal(items[0].kind, "credit");
  assert.equal(kinds.filter((kind) => kind === "review").length, 3);
  assert.equal(kinds.filter((kind) => kind === "pending").length, 1);
  const hilton = items.find((item) => item.kind === "credit" && item.credit.name === "Hilton");
  assert.equal(hilton?.kind === "credit" && hilton.holdings.length, 7);
  const onlySophia = dueItems(portfolio, today, (account) => account.personId === personId("Sophia"));
  assert.ok(onlySophia.length > 0);
  assert.ok(onlySophia.every((item) => item.kind === "credit"
    ? item.holdings.every((holding) => holding.personId === personId("Sophia"))
    : item.account.personId === personId("Sophia")));
});

test("credit to-dos skip cards that changed product or closed earlier in the period", () => {
  const hilton = portfolio.credits.find((item) => item.name === "Hilton")!;
  const due = (value: Portfolio) => dueItems(value, today).find((item) => item.kind === "credit" && item.credit.id === hilton.id);
  const before = due(portfolio);
  assert.ok(before?.kind === "credit");
  const downgraded = before.holdings[0];
  // Downgraded on Jul 2: it was a biz plat for part of Q3 but can't use the Q3 credit now.
  const after = due(indexPortfolio({ ...portfolio, holdings: portfolio.holdings.map((holding) => holding.id === downgraded.id ? { ...holding, endedOn: "2026-07-02" } : holding) }));
  assert.ok(after?.kind === "credit");
  assert.equal(after.holdings.length, before.holdings.length - 1);
  assert.ok(!after.holdings.some((holding) => holding.id === downgraded.id));
});

test("bonus deadlines and fee dates come from the approval date", () => {
  const amexPlat = portfolio.accounts.find((account) => account.personId === personId("Harrison") && portfolio.current(account.id)?.productId === productId("amex plat"))!;
  assert.equal(isoDate(bonusStatus(amexPlat, today)!.deadline), "2027-03-20");
  assert.equal(isoDate(feeStatus(portfolio, amexPlat, today)!.next), "2027-09-20");
  assert.equal(holdingsOf("Sophia", "biz plat").length, 6);
});

test("daily reminders ping on set days and summarize on Mondays", async () => {
  const { dailyReminder, todayInTimeZone } = await import("../app/lib/core/reminders.ts");
  const on = (date: string) => dailyReminder(portfolio, parseDate(date)!);
  const hilton = (reminder: ReturnType<typeof on>) => reminder?.lines.some((line) => line.startsWith("Hilton $50 on 7 biz plats: Q3 ends")) ?? false;

  assert.ok(hilton(on("2026-09-23")), "a week before the quarter ends");
  assert.ok(hilton(on("2026-09-28")), "Monday summary");
  assert.equal(on("2026-09-28")!.title.startsWith("This week in Cardfolio"), true);
  assert.equal(hilton(on("2026-09-29")), false, "no ping the day before the last day");
  assert.ok(hilton(on("2026-09-30")), "last day");
  assert.equal(on("2026-09-24")?.lines.some((line) => line.startsWith("Hilton")) ?? false, false);
  assert.ok(on("2026-09-30")!.body.split("\n").length <= 5, "notification body stays short");

  assert.equal(isoDate(todayInTimeZone("America/New_York", new Date("2026-09-30T03:30:00Z"))), "2026-09-29");
});

test("Plaid accounts link to cards by last digits only when the match is unique", () => {
  const cards = [
    { accountId: 1, last4: "91006" },
    { accountId: 2, last4: "61006" },
    { accountId: 3, last4: "7145" },
    { accountId: 4, last4: "21009" },
    { accountId: 5, last4: null },
  ];
  const matches = matchPlaidAccounts([
    { id: 10, mask: "1006" }, // two Amex cards end in 1006: left for a person
    { id: 11, mask: "7145" },
    { id: 12, mask: "1009" },
    { id: 13, mask: "99" }, // too short to trust
    { id: 14, mask: null },
  ], cards);
  assert.deepEqual([...matches], [[11, 3], [12, 4]]);
  // Already-linked cards aren't offered again, and two Plaid accounts can't claim one card.
  assert.deepEqual([...matchPlaidAccounts([{ id: 11, mask: "7145" }], cards, [3])], []);
  assert.deepEqual([...matchPlaidAccounts([{ id: 20, mask: "7145" }, { id: 21, mask: "7145" }], cards)], []);
});

// ---------- finance ----------

const financeCategories: (CategoryLike & { name: string })[] = [
  { id: 1, name: "Paychecks", kind: "income", plaidCategories: ["INCOME_SALARY", "INCOME_WAGES"] },
  { id: 2, name: "Other income", kind: "income", plaidCategories: ["INCOME"] },
  { id: 3, name: "Groceries", kind: "expense", plaidCategories: ["FOOD_AND_DRINK_GROCERIES"] },
  { id: 4, name: "Restaurants", kind: "expense", plaidCategories: ["FOOD_AND_DRINK"] },
  { id: 5, name: "Card payments", kind: "transfer", plaidCategories: ["LOAN_PAYMENTS_CREDIT_CARD_PAYMENT"] },
  { id: 6, name: "Loan payments", kind: "expense", plaidCategories: ["LOAN_PAYMENTS"] },
  { id: 7, name: "Coffee", kind: "expense", plaidCategories: [] },
];

test("Plaid amounts flip sign into cents (positive = money in)", () => {
  assert.equal(plaidAmountToCents(4.5), -450);
  assert.equal(plaidAmountToCents(-1200), 120000);
  assert.equal(plaidAmountToCents(0.1 + 0.2), -30);
  assert.ok(Object.is(plaidAmountToCents(0), 0));
  assert.equal(netWorthCents("credit", 12345), -12345);
  assert.equal(netWorthCents("loan", 100), -100);
  assert.equal(netWorthCents("depository", 100), 100);
  assert.equal(netWorthCents("investment", 100), 100);
});

test("Plaid categories map to household categories, detailed before primary", () => {
  assert.equal(defaultCategoryFor("FOOD_AND_DRINK", "FOOD_AND_DRINK_GROCERIES", financeCategories)?.id, 3);
  assert.equal(defaultCategoryFor("FOOD_AND_DRINK", "FOOD_AND_DRINK_COFFEE", financeCategories)?.id, 4);
  assert.equal(defaultCategoryFor("LOAN_PAYMENTS", "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT", financeCategories)?.id, 5);
  assert.equal(defaultCategoryFor("LOAN_PAYMENTS", "LOAN_PAYMENTS_CAR_PAYMENT", financeCategories)?.id, 6);
  assert.equal(defaultCategoryFor("INCOME", "INCOME_WAGES", financeCategories)?.id, 1, "PFC v1 detailed code");
  assert.equal(defaultCategoryFor("TRAVEL", "TRAVEL_FLIGHTS", financeCategories), null);
  assert.equal(defaultCategoryFor(null, null, financeCategories), null);
});

test("category rules: account-specific first, then longest text; rules beat Plaid's category", () => {
  const rule = (id: number, matchText: string, categoryId: number, extra: Partial<RuleLike> = {}): RuleLike => ({ id, matchText, matchField: "any", plaidAccountId: null, categoryId, setExcluded: null, ...extra });
  const rules = [rule(1, "star", 4), rule(2, "starbucks", 7), rule(3, "STAR", 3, { plaidAccountId: 9 }), rule(4, "payroll", 1, { matchField: "merchant" })];
  const target = (name: string, merchantName: string | null, plaidAccountId = 1) => ({ name, merchantName, plaidAccountId });
  assert.equal(matchRule(target("STARBUCKS #123", "Starbucks"), rules)?.id, 2);
  assert.equal(matchRule(target("STARBUCKS #123", "Starbucks", 9), rules)?.id, 3);
  assert.equal(matchRule(target("Stardust Diner", null), rules)?.id, 1);
  assert.equal(matchRule(target("ACME PAYROLL", null), rules), null, "merchant-only rule ignores the description");
  assert.equal(matchRule(target("ACME", "Acme Payroll"), rules)?.id, 4);

  const coffee = categorize({ ...target("STARBUCKS", "Starbucks"), plaidPrimary: "FOOD_AND_DRINK", plaidDetailed: "FOOD_AND_DRINK_COFFEE" }, financeCategories, rules);
  assert.deepEqual(coffee, { categoryId: 7, source: "rule", excluded: null });
  const fallback = categorize({ ...target("Whole Foods", "Whole Foods"), plaidPrimary: "FOOD_AND_DRINK", plaidDetailed: "FOOD_AND_DRINK_GROCERIES" }, financeCategories, rules);
  assert.deepEqual(fallback, { categoryId: 3, source: "plaid", excluded: null });
  // A rule pointing at a deleted category falls through to Plaid's mapping.
  assert.equal(categorize({ ...target("starbucks", null), plaidPrimary: null, plaidDetailed: null }, financeCategories, [rule(5, "starbucks", 99)]).categoryId, null);
});

test("transaction sync keeps people's edits and carries pending edits to the posted transaction", () => {
  const tx = (id: string, extra: Partial<PlaidTransaction> = {}): PlaidTransaction => ({
    transaction_id: id, account_id: "plaid-acc", date: "2026-11-01", amount: 12.34, name: "WHOLE FOODS", merchant_name: "Whole Foods",
    personal_finance_category: { primary: "FOOD_AND_DRINK", detailed: "FOOD_AND_DRINK_GROCERIES" }, pending: false, iso_currency_code: "USD", ...extra,
  });
  const existing = new Map([
    ["kept", { plaidTransactionId: "kept", categoryId: 7, categorySource: "manual" as const, notes: "for the party", excluded: true, reviewed: true }],
    ["auto", { plaidTransactionId: "auto", categoryId: 4, categorySource: "plaid" as const, notes: null, excluded: false, reviewed: false }],
    ["pend", { plaidTransactionId: "pend", categoryId: 7, categorySource: "manual" as const, notes: "split with Sophia", excluded: false, reviewed: true }],
  ]);
  const plan = planTransactionWrites({
    householdId: "h",
    added: [tx("new", { amount: -2500, name: "ACME PAYROLL", merchant_name: null, personal_finance_category: { primary: "INCOME", detailed: "INCOME_SALARY" } }), tx("posted", { pending_transaction_id: "pend" }), tx("elsewhere", { account_id: "unknown" }), tx("gone")],
    modified: [tx("kept", { amount: 20 }), tx("auto")],
    removed: [{ transaction_id: "pend" }, { transaction_id: "gone" }],
    accountIds: new Map([["plaid-acc", 42]]),
    existing,
    categories: financeCategories,
    rules: [],
  });
  const byId = new Map(plan.upserts.map((row) => [row.plaid_transaction_id, row]));
  assert.deepEqual([...byId.keys()].sort(), ["auto", "kept", "new", "posted"]);
  assert.equal(plan.skipped, 1);
  assert.deepEqual(plan.removeIds.sort(), ["gone", "pend"]);
  assert.equal(byId.get("new")!.amount_cents, 250000);
  assert.equal(byId.get("new")!.category_id, 1);
  assert.equal(byId.get("new")!.plaid_account_id, 42);
  const kept = byId.get("kept")!;
  assert.deepEqual([kept.category_id, kept.category_source, kept.notes, kept.excluded, kept.amount_cents], [7, "manual", "for the party", true, -2000]);
  assert.deepEqual([byId.get("auto")!.category_id, byId.get("auto")!.category_source], [3, "plaid"], "non-manual categories are recomputed");
  assert.deepEqual([byId.get("posted")!.category_id, byId.get("posted")!.notes, byId.get("posted")!.reviewed], [7, "split with Sophia", true]);
});

test("snapshots and net worth carry balances forward", () => {
  const rows = snapshotRows({
    householdId: "h", date: "2026-11-02",
    plaidAccounts: [
      { id: 1, type: "credit", currentCents: 50000, availableCents: 950000, currency: "USD" },
      { id: 2, type: "depository", currentCents: null, availableCents: 300000, currency: "USD" },
      { id: 3, type: "investment", currentCents: null, availableCents: null, currency: "USD" },
    ],
    manualAccounts: [
      { id: 1, balanceCents: 10000000, liability: false, archived: false, currency: "USD" },
      { id: 2, balanceCents: 500000, liability: true, archived: false, currency: "USD" },
      { id: 3, balanceCents: 1, liability: false, archived: true, currency: "USD" },
    ],
  });
  assert.deepEqual(rows.map((row) => [row.plaid_account_id, row.manual_account_id, row.balance_cents]), [[1, null, -50000], [2, null, 300000], [null, 1, 10000000], [null, 2, -500000]]);
  const series = netWorthSeries([
    { date: "2026-11-01", plaidAccountId: 1, manualAccountId: null, balanceCents: -100 },
    { date: "2026-11-01", plaidAccountId: null, manualAccountId: 1, balanceCents: 1000 },
    { date: "2026-11-02", plaidAccountId: 1, manualAccountId: null, balanceCents: -300 },
  ]);
  assert.deepEqual(series, [{ date: "2026-11-01", netWorthCents: 900 }, { date: "2026-11-02", netWorthCents: 700 }]);
});

test("cash flow skips transfers and excluded transactions; refunds reduce spending", () => {
  const months = cashFlowByMonth([
    { date: "2026-10-03", amountCents: 500000, categoryId: 1, excluded: false },
    { date: "2026-10-04", amountCents: -12000, categoryId: 3, excluded: false },
    { date: "2026-10-05", amountCents: 2000, categoryId: 3, excluded: false },
    { date: "2026-10-06", amountCents: -90000, categoryId: 5, excluded: false },
    { date: "2026-10-07", amountCents: -4000, categoryId: null, excluded: false },
    { date: "2026-10-08", amountCents: -7777, categoryId: 4, excluded: true },
    { date: "2026-11-01", amountCents: 300, categoryId: null, excluded: false },
  ], financeCategories);
  assert.deepEqual(months, [
    { month: "2026-11", incomeCents: 300, expenseCents: 0, netCents: 300 },
    { month: "2026-10", incomeCents: 500000, expenseCents: 14000, netCents: 486000 },
  ]);
  assert.equal(monthsBefore("2026-11-02", 24), "2024-11-02");
  assert.equal(monthsBefore("2026-03-31", 1), "2026-02-28");
});

test("Plaid webhooks map to syncs or login status", () => {
  assert.deepEqual(webhookAction({ webhook_type: "TRANSACTIONS", webhook_code: "SYNC_UPDATES_AVAILABLE" }), { kind: "sync", products: ["transactions"] });
  assert.deepEqual(webhookAction({ webhook_type: "HOLDINGS", webhook_code: "DEFAULT_UPDATE" }), { kind: "sync", products: ["holdings"] });
  assert.deepEqual(webhookAction({ webhook_type: "INVESTMENTS_TRANSACTIONS", webhook_code: "HISTORICAL_UPDATE" }), { kind: "sync", products: ["investment_transactions"] });
  assert.deepEqual(webhookAction({ webhook_type: "ITEM", webhook_code: "ERROR", error: { error_code: "ITEM_LOGIN_REQUIRED" } }), { kind: "status", status: "reconnect", errorCode: "ITEM_LOGIN_REQUIRED" });
  assert.deepEqual(webhookAction({ webhook_type: "ITEM", webhook_code: "PENDING_EXPIRATION" }), { kind: "status", status: "reconnect", errorCode: "PENDING_EXPIRATION" });
  assert.deepEqual(webhookAction({ webhook_type: "ITEM", webhook_code: "LOGIN_REPAIRED" }), { kind: "status", status: "ok", errorCode: null });
  assert.deepEqual(webhookAction({ webhook_type: "ITEM", webhook_code: "WEBHOOK_UPDATE_ACKNOWLEDGED" }), { kind: "ignore" });
});

test("Plaid webhook signatures are checked: key, age and body hash", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = { ...publicKey.export({ format: "jwk" }), kid: "k1", alg: "ES256", use: "sig", expired_at: null };
  const now = Date.UTC(2026, 10, 2, 12);
  const body = JSON.stringify({ webhook_type: "TRANSACTIONS", webhook_code: "SYNC_UPDATES_AVAILABLE", item_id: "abc" }, null, 2);
  const jwt = (claims: object, header: object = { alg: "ES256", kid: "k1", typ: "JWT" }) => {
    const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const input = `${encode(header)}.${encode(claims)}`;
    return `${input}.${sign("sha256", Buffer.from(input), { key: privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url")}`;
  };
  const hash = createHash("sha256").update(body).digest("hex");
  const fetchKey = async (kid: string) => (kid === "k1" ? jwk : null);
  const fresh = now / 1000 - 60;
  assert.deepEqual(await verifyPlaidWebhook(body, jwt({ iat: fresh, request_body_sha256: hash }), fetchKey, now), { ok: true });
  assert.equal((await verifyPlaidWebhook(`${body} `, jwt({ iat: fresh, request_body_sha256: hash }), fetchKey, now)).ok, false, "body changed");
  assert.equal((await verifyPlaidWebhook(body, jwt({ iat: now / 1000 - 600, request_body_sha256: hash }), fetchKey, now)).ok, false, "too old");
  assert.equal((await verifyPlaidWebhook(body, jwt({ iat: fresh, request_body_sha256: hash }, { alg: "HS256", kid: "k1" }), fetchKey, now)).ok, false, "wrong algorithm");
  assert.equal((await verifyPlaidWebhook(body, jwt({ iat: fresh, request_body_sha256: hash }, { alg: "ES256", kid: "k2" }), fetchKey, now)).ok, false, "unknown key");
  const other = generateKeyPairSync("ec", { namedCurve: "P-256" }).publicKey.export({ format: "jwk" });
  assert.equal((await verifyPlaidWebhook(body, jwt({ iat: fresh, request_body_sha256: hash }), async () => ({ ...other, kid: "k1" }), now)).ok, false, "wrong key");
  assert.equal((await verifyPlaidWebhook(body, null, fetchKey, now)).ok, false);
});

test("cash flow breakdown: totals, savings rate, categories by share and top merchants", () => {
  const breakdown = cashFlowBreakdown([
    { date: "2026-10-01", amountCents: 500000, categoryId: 1, excluded: false, merchant: "Acme Payroll" },
    { date: "2026-10-02", amountCents: 1000, categoryId: null, excluded: false, merchant: "Venmo" },
    { date: "2026-10-03", amountCents: -30000, categoryId: 3, excluded: false, merchant: "Whole Foods" },
    { date: "2026-10-04", amountCents: -10000, categoryId: 3, excluded: false, merchant: "whole foods" },
    { date: "2026-10-05", amountCents: 5000, categoryId: 3, excluded: false, merchant: "Whole Foods" },
    { date: "2026-10-06", amountCents: -15000, categoryId: 4, excluded: false, merchant: "Nopa" },
    { date: "2026-10-07", amountCents: 2000, categoryId: 7, excluded: false, merchant: "Blue Bottle" },
    { date: "2026-10-08", amountCents: -100000, categoryId: 5, excluded: false, merchant: "Chase" },
    { date: "2026-10-09", amountCents: -99999, categoryId: 4, excluded: true, merchant: "Nopa" },
    { date: "2026-10-10", amountCents: -5000, categoryId: null, excluded: false, merchant: null },
  ], financeCategories);
  assert.equal(breakdown.incomeCents, 501000);
  assert.equal(breakdown.expenseCents, 30000 + 10000 - 5000 + 15000 - 2000 + 5000);
  assert.equal(breakdown.netCents, 501000 - 53000);
  assert.equal(Math.round(breakdown.savingsRate! * 1000), 894);
  // Coffee only had a refund, so it's left out of the bars; uncategorized spending is its own row.
  assert.deepEqual(breakdown.spending.map((row) => [row.categoryId, row.cents]), [[3, 35000], [4, 15000], [null, 5000]]);
  assert.equal(breakdown.spending.reduce((sum, row) => sum + row.share, 0).toFixed(6), "1.000000");
  assert.deepEqual(breakdown.income.map((row) => [row.categoryId, row.cents]), [[1, 500000], [null, 1000]]);
  assert.deepEqual(breakdown.merchants, [{ merchant: "Whole Foods", cents: 35000, count: 3 }, { merchant: "Nopa", cents: 15000, count: 1 }]);
  assert.equal(cashFlowBreakdown([], financeCategories).savingsRate, null);
});

test("cash flow months and date presets", () => {
  assert.deepEqual(recentMonths("2026-02-15", 4), ["2025-11", "2025-12", "2026-01", "2026-02"]);
  assert.deepEqual(monthBounds("2028-02"), { from: "2028-02-01", to: "2028-02-29" });
  assert.deepEqual(fillMonths([{ month: "2026-01", incomeCents: 5, expenseCents: 2, netCents: 3 }], ["2025-12", "2026-01"]),
    [{ month: "2025-12", incomeCents: 0, expenseCents: 0, netCents: 0 }, { month: "2026-01", incomeCents: 5, expenseCents: 2, netCents: 3 }]);
  assert.deepEqual(datePresetRange("this-month", "2026-11-02"), { from: "2026-11-01", to: "2026-11-02" });
  assert.deepEqual(datePresetRange("last-month", "2026-01-10"), { from: "2025-12-01", to: "2025-12-31" });
  assert.deepEqual(datePresetRange("90-days", "2026-03-01"), { from: "2025-12-02", to: "2026-03-01" });
  assert.deepEqual(datePresetRange("this-year", "2026-11-02"), { from: "2026-01-01", to: "2026-11-02" });
  assert.deepEqual(datePresetRange("all", "2026-11-02"), {});
});

test("transaction filters become a query; linked cards show their short name", () => {
  assert.deepEqual(filtersToQuery(DEFAULT_TRANSACTION_FILTERS, "2026-11-02"), {
    search: undefined, accountIds: undefined, categoryIds: undefined, includeExcluded: false, unreviewedOnly: undefined, direction: undefined,
  });
  const query = filtersToQuery({ ...DEFAULT_TRANSACTION_FILTERS, search: " whole foods ", category: "none", datePreset: "custom", from: "2026-10-01", to: "2026-10-31", direction: "out", accountIds: [4] }, "2026-11-02");
  assert.equal(query.search, "whole foods");
  assert.deepEqual(query.categoryIds, [null]);
  assert.deepEqual([query.from, query.to, query.direction, query.accountIds], ["2026-10-01", "2026-10-31", "out", [4]]);
  assert.equal(filtersToQuery({ ...DEFAULT_TRANSACTION_FILTERS, category: 7, datePreset: "last-month" }, "2026-11-02").from, "2026-10-01");

  const holding = holdingsOf("Harrison", "biz plat").at(-1)!;
  const bank = {
    id: 1, itemId: 1, institutionName: "American Express", name: "Business Platinum", officialName: null, mask: "1001", type: "credit", subtype: "credit card",
    cardAccountId: holding.accountId, personId: null, currentCents: null, availableCents: null, limitCents: null, currency: null, balancesUpdatedAt: null,
    statement: { lastStatementCents: null, lastStatementDate: null, minimumPaymentCents: null, nextDueDate: null, lastPaymentCents: null, lastPaymentDate: null, overdue: null, updatedAt: null },
  };
  assert.equal(bankAccountShortLabel(bank, portfolio), holdingName(portfolio, portfolio.current(holding.accountId)!));
  assert.equal(bankAccountShortLabel({ ...bank, cardAccountId: null, institutionName: "Chase", mask: "1234" }, portfolio), "Chase ··1234");

  assert.deepEqual(groupByDate([{ date: "2026-11-02", id: 1 }, { date: "2026-11-02", id: 2 }, { date: "2026-11-01", id: 3 }]).map((group) => [group.date, group.items.length]), [["2026-11-02", 2], ["2026-11-01", 1]]);
});

test("accounts group by type: retirement subtypes, debts and manual kinds", () => {
  assert.equal(plaidAccountGroup("depository", "checking"), "cash");
  assert.equal(plaidAccountGroup("credit", "credit card"), "credit");
  assert.equal(plaidAccountGroup("investment", "401k"), "retirement");
  assert.equal(plaidAccountGroup("investment", "Roth"), "retirement");
  assert.equal(plaidAccountGroup("investment", "brokerage"), "investment");
  assert.equal(plaidAccountGroup("loan", "mortgage"), "loan");
  assert.equal(plaidAccountGroup(null, null), "other");
  assert.equal(manualAccountGroup("private_investment"), "investment");
  assert.equal(manualAccountGroup("real_estate"), "other");
  assert.equal(manualAccountGroup("loan"), "loan");
});

test("net worth over a range carries the earlier balance to the range start", () => {
  assert.equal(rangeStart("2026-11-02", "3M"), "2026-08-02");
  assert.equal(rangeStart("2026-03-31", "1M"), "2026-02-28");
  assert.equal(rangeStart("2026-11-02", "all"), null);
  const series = balanceSeries([
    { date: "2026-07-01", plaidAccountId: 1, manualAccountId: null, balanceCents: 1000 },
    { date: "2026-07-01", plaidAccountId: null, manualAccountId: 9, balanceCents: 5000 },
    { date: "2026-09-01", plaidAccountId: 1, manualAccountId: null, balanceCents: 2000 },
    { date: "2026-10-01", plaidAccountId: 2, manualAccountId: null, balanceCents: -500 },
  ], (snapshot) => snapshot.manualAccountId !== 9);
  assert.deepEqual(series, [{ date: "2026-07-01", valueCents: 1000 }, { date: "2026-09-01", valueCents: 2000 }, { date: "2026-10-01", valueCents: 1500 }]);
  const sliced = seriesFrom(series, "2026-08-02");
  assert.deepEqual(sliced, [{ date: "2026-08-02", valueCents: 1000 }, { date: "2026-09-01", valueCents: 2000 }, { date: "2026-10-01", valueCents: 1500 }]);
  assert.deepEqual(periodChange(sliced), { startDate: "2026-08-02", startCents: 1000, endCents: 1500, changeCents: 500, percent: 0.5 });
  assert.deepEqual(seriesFrom(series, "2026-06-01"), series, "history starts inside the range");
  assert.equal(periodChange([]), null);
  assert.equal(periodChange([{ date: "2026-10-01", valueCents: 0 }], 100)!.percent, null);
});

test("positions aggregate by security across accounts with gains, allocation and sorting", () => {
  const security = (id: number, ticker: string, type: string) => ({ id, name: `${ticker} fund`, tickerSymbol: ticker, type, isCashEquivalent: false, closePrice: 10 });
  const holding = (plaidAccountId: number, sec: ReturnType<typeof security>, quantity: number, valueCents: number | null, costBasisCents: number | null): HoldingInput =>
    ({ plaidAccountId, security: sec, quantity, costBasisCents, institutionPrice: null, institutionValueCents: valueCents });
  const vti = security(1, "VTI", "etf"), aapl = security(2, "AAPL", "equity"), cash = { ...security(3, "USD", "cash"), isCashEquivalent: true };
  const positions = aggregatePositions([
    holding(10, vti, 10, 300000, 200000),
    holding(11, vti, 5, 150000, 100000),
    holding(10, aapl, 2, null, 50000), // no institution value: 2 × close $10
    holding(11, cash, 1000, 100000, null),
  ], [{ id: 7, name: "Edgar Street Capital", kind: "private_investment", balanceCents: 448000 }], [{ plaidAccountId: 12, name: "HSA", balanceCents: 0 }]);
  const vtiPosition = positions.find((position) => position.key === "s1")!;
  assert.equal(vtiPosition.quantity, 15);
  assert.equal(vtiPosition.valueCents, 450000);
  assert.equal(vtiPosition.costBasisCents, 300000);
  assert.equal(vtiPosition.gainCents, 150000);
  assert.equal(vtiPosition.gainPercent, 0.5);
  assert.equal(vtiPosition.price, 300);
  assert.deepEqual(vtiPosition.accounts.map((account) => [account.plaidAccountId, account.valueCents, account.gainCents]), [[10, 300000, 100000], [11, 150000, 50000]]);
  const apple = positions.find((position) => position.key === "s2")!;
  assert.equal(apple.valueCents, 2000);
  assert.equal(apple.gainCents, -48000);
  assert.deepEqual(positions.map((position) => position.key), ["s1", "m7", "s3", "s2", "a12"], "largest first");
  assert.equal(positions[1].assetClass, "private");
  const total = 450000 + 2000 + 100000 + 448000;
  assert.equal(positions.reduce((sum, position) => sum + position.share, 0).toFixed(6), "1.000000");

  const summary = summarizePositions(positions);
  assert.equal(summary.valueCents, total);
  assert.equal(summary.costBasisCents, 350000);
  assert.equal(summary.gainCents, 102000);
  assert.equal(summary.withoutCostBasis, 3, "cash, Edgar Street and the HSA have no cost basis");
  assert.equal(summary.valueWithoutCostBasisCents, 548000);

  assert.deepEqual(allocationByClass(positions).map((slice) => [slice.key, slice.valueCents]), [["etf", 450000], ["private", 448000], ["cash", 100000], ["equity", 2000]]);
  assert.deepEqual(allocationByAccount(positions).map((slice) => [slice.key, slice.valueCents]), [["m7", 448000], ["p10", 302000], ["p11", 250000]]);
  assert.deepEqual(sortPositions(positions, "gain").map((position) => position.key).slice(0, 2), ["s1", "s2"]);
  assert.deepEqual(sortPositions(positions, "gainPercent").map((position) => position.key).slice(0, 2), ["s1", "s2"]);
});

test("investment activity types group Plaid's type and subtype", () => {
  assert.equal(activityKind("buy", "buy"), "buy");
  assert.equal(activityKind("buy", "dividend reinvestment"), "buy");
  assert.equal(activityKind("sell", "sell"), "sell");
  assert.equal(activityKind("cash", "qualified dividend"), "income");
  assert.equal(activityKind("cash", "interest"), "income");
  assert.equal(activityKind("cash", "contribution"), "contribution");
  assert.equal(activityKind("cash", "withdrawal"), "withdrawal");
  assert.equal(activityKind("fee", "account fee"), "fee");
  assert.equal(activityKind("cash", "tax withheld"), "fee");
  assert.equal(activityKind("transfer", "transfer"), "transfer");
  assert.equal(activityKind(null, null), "other");
});
