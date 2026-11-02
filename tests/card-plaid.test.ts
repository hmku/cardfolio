import assert from "node:assert/strict";
import test from "node:test";
import {
  bonusProgress, creditKeywords, creditMatchScore, creditSuggestions, isAnnualFee, isBonusSpend, isCardPayment, latestFeePosting,
  linkedCard, paymentStatus, paymentsDue, suggestionKey, summarizeCardPlaid,
  type CardPlaidData, type CardTransaction, type LinkedCard,
} from "../app/lib/core/card-plaid.ts";
import { indexPortfolio, type Account, type Cadence, type Credit, type CreditUse, type Holding } from "../app/lib/core/model.ts";
import { dailyReminder } from "../app/lib/core/reminders.ts";
import { dueItems } from "../app/lib/core/stats.ts";
import { bonusHistoryWarning, bonusProgressText, feePostingText, paymentText } from "../app/lib/presentation/card-plaid.ts";
import { cardStatus } from "../app/lib/presentation/card-status.ts";
import { dueText } from "../app/lib/presentation/due.ts";

const today = new Date(2026, 10, 2, 12); // Mon Nov 2, 2026

let creditId = 0;
const credit = (productId: number, name: string, amountCents: number, cadence: Cadence, mode: Credit["mode"] = "track"): Credit =>
  ({ id: ++creditId, productId, name, amountCents, cadence, remind: true, mode, startsOn: null, endsOn: null, sort: creditId });

const credits = [
  credit(1, "Uber Cash", 1500, "monthly"),
  credit(1, "Uber One", 12000, "calendar_year"),
  credit(1, "Resy", 10000, "quarterly"),
  credit(1, "Digital entertainment", 2500, "monthly"),
  credit(1, "Airline fee", 20000, "calendar_year"),
  credit(1, "CLEAR", 20900, "calendar_year"),
  credit(1, "Walmart+", 1295, "monthly"),
  credit(1, "lululemon", 7500, "quarterly"),
  credit(1, "Saks", 5000, "semiannual", "skip"),
  credit(2, "Dell", 15000, "semiannual"),
  credit(2, "Hilton", 5000, "quarterly"),
];
const byName = (name: string) => credits.find((item) => item.name === name)!;

const plat: Account = {
  id: 1, personId: 1, appliedOn: "2026-08-30", approvedOn: "2026-09-01", openedVia: "applied", status: "open", closedOn: null,
  bonus: { amount: 175000, unit: "points", spendCents: 800000, months: 6 }, bonusEarned: false, note: null,
};
const bizPlat: Account = { ...plat, id: 2, appliedOn: "2023-10-01", approvedOn: "2023-10-03", bonus: null };
const gold: Account = { ...plat, id: 3, approvedOn: "2026-10-01", bonus: { amount: 60000, unit: "points", spendCents: 600000, months: 6 } };
const holdings: Holding[] = [
  { id: 11, accountId: 1, personId: 1, productId: 1, number: 2, startedOn: "2026-09-01", endedOn: null, change: "opened", annualFeeCents: 89500, last4: "51001" },
  { id: 12, accountId: 2, personId: 1, productId: 2, number: 7, startedOn: "2023-10-03", endedOn: null, change: "opened", annualFeeCents: 69500, last4: "52002" },
  { id: 13, accountId: 3, personId: 1, productId: 3, number: 1, startedOn: "2026-10-01", endedOn: null, change: "opened", annualFeeCents: 32500, last4: "53003" },
];

function fixture(uses: CreditUse[] = []) {
  return indexPortfolio({
    people: [{ id: 1, name: "Harrison", code: "HK", email: null, sort: 0 }],
    products: [
      { id: 1, slug: "amex plat", shortName: null, name: "Amex Platinum", issuer: "Amex", kind: "personal", annualFeeCents: 89500 },
      { id: 2, slug: "biz plat", shortName: null, name: "Amex Business Platinum", issuer: "Amex", kind: "business", annualFeeCents: 69500 },
      { id: 3, slug: "amex gold", shortName: null, name: "Amex Gold", issuer: "Amex", kind: "personal", annualFeeCents: 32500 },
    ],
    accounts: [plat, bizPlat, gold], holdings, credits, uses, optOuts: [],
    rules: [{ id: "default-close", name: "Annual fee review", actionCode: "CLOSE", priority: 10, enabled: true, conditions: { requiresOpen: true, approvalAgeMin: 181, annualFeeMin: 1, anniversaryBeforeDays: 19, anniversaryAfterDays: 59 } }],
  });
}

let transactionId = 0;
const tx = (plaidAccountId: number, date: string, amountCents: number, name: string, extra: Partial<CardTransaction> = {}): CardTransaction =>
  ({ id: ++transactionId, plaidAccountId, date, amountCents, name, merchantName: null, pending: false, categoryPrimary: null, categoryDetailed: null, ...extra });

const card = (plaidAccountId: number, accountId: number, extra: Partial<LinkedCard> = {}): LinkedCard => ({
  plaidAccountId, accountId, currentCents: 234500, limitCents: 2500000, statementCents: 123400, statementDate: "2026-10-24", minimumCents: 4000,
  dueDate: "2026-11-05", lastPaymentCents: 50000, lastPaymentDate: "2026-10-10", overdue: false, updatedAt: "2026-11-02T09:00:00Z", historyComplete: true, ...extra,
});

test("credit keywords come from an alias or the credit's own name", () => {
  assert.deepEqual(creditKeywords({ name: "Uber Cash" }), { phrases: ["uber"], unless: ["uber one"] });
  assert.deepEqual(creditKeywords({ name: "Uber One" }).phrases, ["uber one"]);
  assert.deepEqual(creditKeywords({ name: "lululemon credit" }).phrases, ["lululemon"]);
  assert.deepEqual(creditKeywords({ name: "Dell" }).phrases, ["dell"]);
  assert.deepEqual(creditKeywords({ name: "Airline fee" }).phrases, ["airline"]);
  assert.deepEqual(creditKeywords({ name: "$200 Credit" }).phrases, [], "nothing distinctive: never matches");

  const score = (name: string, text: string, merchantName: string | null = null) => creditMatchScore({ name }, { name: text, merchantName });
  assert.ok(score("Uber One", "UBER ONE MEMBERSHIP CREDIT") > 0);
  assert.equal(score("Uber Cash", "UBER ONE MEMBERSHIP CREDIT"), 0, "Uber One postings aren't Uber Cash");
  assert.ok(score("Digital entertainment", "Platinum Digital Entertainment Credit") > 0);
  assert.ok(score("Airline fee", "AMEX AIRLINE FEE REIMBURSEMENT") > 0);
  assert.ok(score("Walmart+", "Walmart+ Credit") > 0);
  assert.ok(score("CLEAR", "CLEAR PLUS CREDIT") > 0);
  assert.equal(score("CLEAR", "CLEARWATER MARINA REFUND"), 0, "whole words only");
  assert.ok(score("Resy", "AMEX DINING CREDIT", "Resy") > 0, "the merchant name counts too");
  assert.equal(score("Dell", "DELTA AIR LINES"), 0);
});

test("payments, purchases and fees are told apart", () => {
  assert.ok(isCardPayment(tx(10, "2026-10-30", 50000, "AUTOPAY PAYMENT - THANK YOU")));
  assert.ok(isCardPayment(tx(10, "2026-10-30", 50000, "ONLINE TRANSFER", { categoryDetailed: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT" })));
  assert.ok(!isCardPayment(tx(10, "2026-10-30", 10000, "AMEX Resy Credit")));
  assert.ok(isBonusSpend(tx(10, "2026-10-01", -5000, "WHOLE FOODS")));
  assert.ok(!isBonusSpend(tx(10, "2026-10-01", -89500, "PLATINUM ANNUAL FEE")));
  assert.ok(!isBonusSpend(tx(10, "2026-10-01", -1234, "INTEREST CHARGE ON PURCHASES")));
  assert.ok(!isBonusSpend(tx(10, "2026-10-01", -1234, "CASH APP", { categoryPrimary: "TRANSFER_OUT" })));
  assert.ok(!isBonusSpend(tx(10, "2026-10-01", 5000, "REFUND")));
  assert.ok(isAnnualFee({ name: "ANNUAL MEMBERSHIP FEE", merchantName: null }));
  assert.ok(!isAnnualFee({ name: "FOREIGN TRANSACTION FEE", merchantName: null }));
});

test("credit suggestions match name, current period and amount, once per credit", () => {
  const portfolio = fixture();
  const transactions = [
    tx(10, "2026-11-01", 10000, "AMEX Resy Credit"),
    tx(10, "2026-11-01", 2500, "PLATINUM DIGITAL ENTERTAINMENT CREDIT"),
    tx(10, "2026-11-02", 1500, "Uber Cash Credit", { pending: true }),
    tx(10, "2026-10-20", 1295, "Walmart+ Credit"), // October: not the current month
    tx(10, "2026-11-01", 1295, "Walmart+ Credit"),
    tx(10, "2026-11-02", 1295, "Walmart+ Credit"), // second posting: the month is already covered
    tx(10, "2026-10-05", 4000, "LULULEMON ATHLETICA"), // Q4, no credit word
    tx(10, "2026-10-06", 50000, "LULULEMON ATHLETICA"), // far over $75: a refund
    tx(10, "2026-10-30", 200000, "AUTOPAY PAYMENT - THANK YOU"),
    tx(10, "2026-10-10", 9900, "UBER ONE MEMBERSHIP CREDIT"),
    tx(11, "2026-08-03", 15000, "DELL TECHNOLOGIES CREDIT"), // H2 (Jul-Dec)
    tx(11, "2026-10-12", 5000, "SAKS CREDIT"), // not a biz plat credit
    tx(99, "2026-11-01", 10000, "AMEX Resy Credit"), // not a linked card
  ];
  const data: CardPlaidData = { cards: [card(10, 1), card(11, 2)], transactions };
  const found = creditSuggestions(portfolio, data, today);
  const summary = found.map((item) => [item.credit.name, item.transaction.date, item.recordCents, item.maybeRefund]);
  assert.deepEqual(summary, [
    ["Dell", "2026-08-03", 15000, false],
    ["lululemon", "2026-10-05", 4000, true],
    ["Uber One", "2026-10-10", 9900, false],
    ["Resy", "2026-11-01", 10000, false],
    ["Digital entertainment", "2026-11-01", 2500, false],
    ["Walmart+", "2026-11-01", 1295, false],
  ]);
  assert.equal(found[0].holding.id, 12);
  assert.equal(found[3].period.key, "2026-Q4");

  // Dismissed (or accepted here) suggestions stay hidden and don't fall through to another credit.
  const resy = found.find((item) => item.credit.name === "Resy")!;
  assert.equal(resy.key, suggestionKey(resy.transaction.id, byName("Resy").id));
  assert.ok(!creditSuggestions(portfolio, data, today, new Set([resy.key])).some((item) => item.transaction.id === resy.transaction.id));

  // Already recorded: by a person (credit used up) or from Plaid on another device (dated on/after the posting).
  const used = fixture([{ id: 1, creditId: byName("Resy").id, holdingId: 11, periodKey: "2026-Q4", amountCents: 10000, usedOn: "2026-10-02", recordedBy: null, source: "manual" }]);
  assert.ok(!creditSuggestions(used, data, today).some((item) => item.credit.name === "Resy"));
  const viaPlaid = fixture([{ id: 1, creditId: byName("Uber One").id, holdingId: 11, periodKey: "2026", amountCents: 9900, usedOn: "2026-10-10", recordedBy: null, source: "plaid" }]);
  assert.ok(!creditSuggestions(viaPlaid, data, today).some((item) => item.credit.name === "Uber One"));

  // A partial use adds up, capped at the credit's amount.
  const partial = fixture([{ id: 1, creditId: byName("lululemon").id, holdingId: 11, periodKey: "2026-Q4", amountCents: 5000, usedOn: "2026-10-01", recordedBy: null, source: "manual" }]);
  assert.equal(creditSuggestions(partial, data, today).find((item) => item.credit.name === "lululemon")!.recordCents, 7500);

  // Always-used and not-using credits never get suggestions.
  const auto = indexPortfolio({ ...portfolio, credits: credits.map((item) => (item.name === "Resy" ? { ...item, mode: "auto" as const } : item)) });
  assert.ok(!creditSuggestions(auto, data, today).some((item) => item.credit.name === "Resy"));
});

test("payment status: statement due soon, paid, overdue", () => {
  const portfolio = fixture();
  const due = paymentStatus(card(10, 1), [], today);
  assert.equal(due.daysLeft, 3);
  assert.equal(due.remainingCents, 123400);
  assert.ok(due.needsPayment);
  assert.equal(paymentText(due), "$1,234 due Nov 5");

  const paidByTransaction = paymentStatus(card(10, 1), [tx(10, "2026-10-30", 123400, "AUTOPAY PAYMENT - THANK YOU")], today);
  assert.equal(paidByTransaction.remainingCents, 0);
  assert.ok(!paidByTransaction.needsPayment);
  assert.equal(paymentText(paidByTransaction), "Statement paid");
  const paidPerPlaid = paymentStatus(card(10, 1, { lastPaymentCents: 123400, lastPaymentDate: "2026-10-28" }), [], today);
  assert.ok(!paidPerPlaid.needsPayment, "Plaid's last payment after the statement counts");
  const later = paymentStatus(card(10, 1, { dueDate: "2026-11-20" }), [], today);
  assert.ok(!later.needsPayment, "not within 5 days yet");
  assert.equal(paymentStatus(card(10, 1, { statementCents: 0 }), [], today).needsPayment, false);

  const data: CardPlaidData = { cards: [card(10, 1), card(11, 2, { overdue: true, dueDate: "2026-10-28" })], transactions: [] };
  const payments = paymentsDue(portfolio, data, today);
  assert.deepEqual(payments.map((item) => [item.account.id, item.payment.overdue]), [[1, false], [2, true]]);
  const items = dueItems(portfolio, today, undefined, payments).filter((item) => item.kind === "payment");
  assert.equal(items[0].account.id, 2, "overdue first");
  assert.deepEqual(dueText(portfolio, items[0]), { label: "Overdue", text: "biz plat HK7 payment is overdue: pay at least $40", when: "was due Oct 28" });
  assert.deepEqual(dueText(portfolio, items[1]), { label: "Pay", text: "$1,234 statement balance on amex plat HK2", when: "due Nov 5 (in 3d)" });

  const reminder = dailyReminder(portfolio, today, payments)!;
  assert.ok(reminder.lines.includes("biz plat HK7 payment is overdue (minimum $40)"));
  assert.ok(reminder.lines.includes("Pay $1,234 on amex plat HK2: due in 3 days"));
  const tuesday = new Date(2026, 10, 3, 12);
  assert.deepEqual(dailyReminder(portfolio, tuesday, paymentsDue(portfolio, data, tuesday))!.lines.filter((line) => line.includes("Pay ") || line.includes("overdue")),
    ["biz plat HK7 payment is overdue (minimum $40)"], "due in 2 days: no ping, overdue pings daily");

  const status = cardStatus(portfolio, bizPlat, holdings[1], today, summarizeCardPlaid(portfolio, data, today).byAccount.get(2));
  assert.equal(status.tone, "alert");
  assert.ok(status.tags.some((tag) => tag.text === "Payment overdue · $40 minimum"));
});

test("bonus spend counts posted purchases in the window and flags missing history", () => {
  const transactions = [
    tx(10, "2026-08-30", -99900, "BEFORE APPROVAL"),
    tx(10, "2026-09-10", -100000, "WHOLE FOODS"),
    tx(10, "2026-10-01", -89500, "PLATINUM ANNUAL FEE"),
    tx(10, "2026-10-05", 2000, "REFUND"),
    tx(10, "2026-11-01", -50000, "DELTA AIR LINES", { pending: true }),
    tx(11, "2026-10-01", -700000, "OTHER CARD"),
  ];
  const linked = card(10, 1, { firstTransactionDate: "2026-08-30" });
  const progress = bonusProgress(plat, linked, transactions, today)!;
  assert.equal(progress.spentCents, 100000);
  assert.equal(progress.pendingCents, 50000);
  assert.equal(progress.leftCents, 700000);
  assert.equal(progress.daysLeft, 119);
  assert.equal(progress.historyGap, null);
  assert.equal(bonusProgressText(progress), "$1,000 of $8,000 spent (+$500 pending), 119 days left");

  assert.equal(bonusProgress(plat, card(10, 1, { firstTransactionDate: "2026-10-15" }), transactions, today)!.historyGap, "2026-10-15");
  assert.equal(bonusHistoryWarning(bonusProgress(plat, card(10, 1, { firstTransactionDate: "2026-10-15" }), transactions, today)!),
    "Plaid's transactions for this card start Oct 15, so earlier spend isn't counted.");
  assert.equal(bonusProgress(plat, card(10, 1, { firstTransactionDate: "2026-09-08" }), transactions, today)!.historyGap, null, "a first purchase a week in is normal");
  assert.equal(bonusProgress(plat, card(10, 1, { firstTransactionDate: null }), [], today)!.historyGap, "none");
  assert.equal(bonusProgress(plat, card(10, 1, { historyComplete: false }), [], today)!.historyGap, "loading");
  assert.ok(bonusProgress({ ...plat, bonus: { ...plat.bonus!, spendCents: 100000 } }, linked, transactions, today)!.met);
  assert.equal(bonusProgress(plat, null, transactions, today), null, "not linked");
  assert.equal(bonusProgress({ ...plat, bonusEarned: true }, linked, transactions, today), null);

  const portfolio = fixture();
  const view = summarizeCardPlaid(portfolio, { cards: [linked], transactions }, today);
  const status = cardStatus(portfolio, plat, holdings[0], today, view.byAccount.get(1));
  assert.ok(status.tags.some((tag) => tag.text === "175k pts: $1,000 of $8,000 spent (+$500 pending), 119 days left"));
  const bonusItem = dueItems(portfolio, new Date(2027, 0, 15, 12)).find((item) => item.kind === "bonus" && item.account.id === 1)!;
  assert.match(dueText(portfolio, bonusItem, view).text, /amex plat HK2 · \$1,000 of \$8,000 spent/);
});

test("annual fee postings and the unlinked case", () => {
  const transactions = [
    tx(11, "2025-10-04", -69500, "ANNUAL MEMBERSHIP FEE"),
    tx(11, "2026-10-03", -69500, "ANNUAL MEMBERSHIP FEE"),
    tx(11, "2026-10-12", -300, "FOREIGN TRANSACTION FEE"),
  ];
  const linked = card(11, 2);
  assert.deepEqual(latestFeePosting(linked, transactions, today), { date: "2026-10-03", amountCents: 69500, pending: false, refundedOn: null });
  const refunded = latestFeePosting(linked, [...transactions, tx(11, "2026-10-20", 69500, "ANNUAL MEMBERSHIP FEE REVERSAL")], today)!;
  assert.equal(refunded.refundedOn, "2026-10-20");
  assert.equal(feePostingText(refunded), "fee posted Oct 3: $695, refunded Oct 20");
  assert.equal(latestFeePosting(null, transactions, today), null);

  const portfolio = fixture();
  const view = summarizeCardPlaid(portfolio, { cards: [linked], transactions }, today);
  const review = dueItems(portfolio, today).find((item) => item.kind === "review" && item.account.id === 2)!;
  assert.equal(dueText(portfolio, review, view).when, "fee posted Oct 3: $695");
  assert.equal(dueText(portfolio, review).when, "", "unchanged without Plaid");
  assert.ok(cardStatus(portfolio, bizPlat, holdings[1], today, view.byAccount.get(2)).tags.some((tag) => tag.text === "Keep or close? fee posted Oct 3: $695"));

  // Nothing linked: nothing changes.
  assert.equal(linkedCard({ cards: [], transactions: [] }, 1), null);
  const empty = summarizeCardPlaid(portfolio, { cards: [], transactions: [] }, today);
  assert.equal(empty.byAccount.size, 0);
  assert.deepEqual(empty.payments, []);
  assert.deepEqual(cardStatus(portfolio, plat, holdings[0], today, null), cardStatus(portfolio, plat, holdings[0], today));
});
