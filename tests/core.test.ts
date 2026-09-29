import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { creditPeriod, creditState, creditSummary, eligibleHoldings } from "../app/lib/core/credits.ts";
import { addMonths, isoDate, parseDate } from "../app/lib/core/dates.ts";
import { bonusLabel, holdingName, indexPortfolio, nextHoldingNumber, type Portfolio } from "../app/lib/core/model.ts";
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
    ["Chase Freedom Unlimited #1", "Chase Sapphire Reserve #2", "Chase Freedom Flex #2", "Chase Sapphire Reserve #4", "Chase Freedom Flex #3"],
    ["Chase Sapphire Reserve #1", "Chase Freedom Flex #1", "Chase Sapphire Reserve #3", "Chase Freedom Unlimited #2", "Chase Sapphire Reserve #5"],
  ]);
  const explorer = portfolio.holdings.filter((holding) => holding.personId === personId("Harrison") && holding.productId === productId("united explorer"));
  assert.deepEqual(explorer.map((holding) => holding.change), ["opened", "upgrade"], "the return from Gateway is an upgrade");
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
    "CLOSE Harrison Amex Business Platinum #7",
    "CLOSE Harrison Wyndham Business #2",
    "CLOSE Sophia Amex Business Platinum #4",
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

test("bonus deadlines and fee dates come from the approval date", () => {
  const amexPlat = portfolio.accounts.find((account) => account.personId === personId("Harrison") && portfolio.current(account.id)?.productId === productId("amex plat"))!;
  assert.equal(isoDate(bonusStatus(amexPlat, today)!.deadline), "2027-03-20");
  assert.equal(isoDate(feeStatus(portfolio, amexPlat, today)!.next), "2027-09-20");
  assert.equal(holdingsOf("Sophia", "biz plat").length, 6);
});
