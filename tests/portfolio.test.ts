import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { annualFeePayments, bonusDeadline, cardAction, creditPeriod, fiveTwentyFourAccounts, isSecondaryCredit, isoDate } from "../app/lib/portfolio.ts";

const now = new Date("2026-08-03T12:00:00");

test("credit periods infer monthly, quarterly, annual, and anniversary deadlines", () => {
  assert.deepEqual(
    [creditPeriod("monthly", "2025-01-01", now).start, creditPeriod("monthly", "2025-01-01", now).end].map(isoDate),
    ["2026-08-01", "2026-08-31"],
  );
  assert.deepEqual(
    [creditPeriod("quarter", "2025-01-01", now).start, creditPeriod("quarter", "2025-01-01", now).end].map(isoDate),
    ["2026-07-01", "2026-09-30"],
  );
  assert.deepEqual(
    [creditPeriod("calendar year", "2026-02-15", now).start, creditPeriod("calendar year", "2026-02-15", now).end].map(isoDate),
    ["2026-02-15", "2026-12-31"],
  );
  assert.deepEqual(
    [creditPeriod("anniversary", "2025-09-10", now).start, creditPeriod("anniversary", "2025-09-10", now).end].map(isoDate),
    ["2025-09-10", "2026-09-09"],
  );
});

test("signup bonus periods default to three months", () => {
  assert.equal(isoDate(bonusDeadline("2026-05-21", null)!), "2026-08-21");
  assert.equal(isoDate(bonusDeadline("2026-07-13", 6)!), "2027-01-13");
});

test("clear, office supply, and wireless credits are secondary", () => {
  assert.equal(isSecondaryCredit("Clear"), true);
  assert.equal(isSecondaryCredit("Office supply credit"), true);
  assert.equal(isSecondaryCredit("Wireless credit"), true);
  assert.equal(isSecondaryCredit("Travel"), false);
});

test("5/24 follows the spreadsheet's personal-card and downgrade rules", () => {
  const rows = [
    { approvedOn: "2026-06-01", closedOn: null, openedHow: "applied", kind: "personal", annualFee: 95 },
    { approvedOn: "2026-05-01", closedOn: null, openedHow: "downgraded", kind: "personal", annualFee: 0 },
    { approvedOn: "2026-04-01", closedOn: null, openedHow: "applied", kind: "business", annualFee: 95 },
    { approvedOn: "2024-07-01", closedOn: null, openedHow: "applied", kind: "personal", annualFee: 95 },
  ];
  assert.equal(fiveTwentyFourAccounts(rows, now).length, 1);
});

test("historical annual fees treat a 13-14 month closure as one paid fee", () => {
  assert.deepEqual(annualFeePayments({ approvedOn: "2024-01-01", closedOn: "2025-02-28", openedHow: "applied", kind: "personal", annualFee: 95 }, now), { count: 1, total: 95 });
  assert.deepEqual(annualFeePayments({ approvedOn: "2023-01-01", closedOn: "2025-01-20", openedHow: "applied", kind: "personal", annualFee: 95 }, now), { count: 2, total: 190 });
});

test("card actions mirror the Tracker sheet instead of reusing opening or closure notes", () => {
  const referenceDate = new Date("2026-08-09T12:00:00");
  const account = (overrides: Record<string, unknown>) => ({
    cardName: "other card",
    cardIndex: "1",
    approvedOn: "2026-07-13",
    closedOn: null,
    openedHow: "nll",
    kind: "business",
    annualFee: 0,
    ...overrides,
  });

  const deltaGold6 = account({ cardName: "delta biz gold", cardIndex: "6" });
  assert.equal(cardAction(deltaGold6, [deltaGold6], referenceDate), null);

  const feeCard = account({ approvedOn: "2025-08-12", annualFee: 95, openedHow: "applied" });
  assert.equal(cardAction(feeCard, [feeCard], referenceDate), "CLOSE");

  const bizGold = account({ cardName: "biz gold", approvedOn: "2026-05-11", closedHow: "not part of the action" });
  assert.equal(cardAction(bizGold, [bizGold], referenceDate), "NLL");

  const cic = account({ cardName: "cic", approvedOn: "2026-05-11" });
  assert.equal(cardAction(cic, [cic], referenceDate), "CIC");

  const redcards = [
    account({ cardName: "redcard", cardIndex: "1", approvedOn: "2025-01-01", closedOn: "2026-05-01" }),
    account({ cardName: "redcard", cardIndex: "2", approvedOn: "2025-02-01", closedOn: "2026-05-01" }),
  ];
  assert.equal(cardAction(redcards[0], redcards, referenceDate), null);
  assert.equal(cardAction(redcards[1], redcards, referenceDate), "TARGET");
});

test("database-backed rules can be added, disabled, and reordered", () => {
  const account = { cardName: "Delta Biz Gold", cardIndex: "6", approvedOn: "2026-07-13", closedOn: null, openedHow: "nll", kind: "business", annualFee: 0 };
  const rules = [
    { id: "later", name: "Later rule", actionCode: "SECOND", priority: 20, enabled: true, conditions: { cardNames: ["Delta Biz Gold"], approvalAgeMin: 1 } },
    { id: "disabled", name: "Disabled rule", actionCode: "NOPE", priority: 1, enabled: false, conditions: {} },
    { id: "first", name: "First rule", actionCode: "FIRST", priority: 10, enabled: true, conditions: { approvalAgeMax: 100 } },
  ];
  assert.equal(cardAction(account, [account], new Date("2026-08-09T12:00:00"), rules), "FIRST");
  rules[2].enabled = false;
  assert.equal(cardAction(account, [account], new Date("2026-08-09T12:00:00"), rules), "SECOND");
});

test("the migration snapshot matches the audited Tracker, Stats, and Credits sheets", async () => {
  const snapshot = JSON.parse(await readFile(new URL("../data/seed-data.json", import.meta.url), "utf8"));
  assert.equal(snapshot.accounts.length, 142);
  assert.equal(new Set(snapshot.accounts.map((account: { card: string }) => account.card.trim())).size, 34);
  assert.equal(snapshot.creditDefinitions.length, 15);

  const actionAccounts = snapshot.accounts.map((account: Record<string, unknown>) => ({
    ...account,
    cardName: account.card,
  }));
  for (const account of actionAccounts) {
    assert.equal(cardAction(account, actionAccounts, new Date("2026-08-02T12:00:00")) || "-", account.action);
  }

  const expectations = {
    harrison: { approved: 75, active: 21, fiveTwentyFour: 3 },
    sophia: { approved: 42, active: 19, fiveTwentyFour: 2 },
  };
  for (const [owner, expected] of Object.entries(expectations)) {
    const accounts = snapshot.accounts.filter((account: { owner: string }) => account.owner === owner);
    assert.equal(accounts.filter((account: { approvedOn: string }) => Boolean(account.approvedOn)).length, expected.approved);
    assert.equal(accounts.filter((account: { approvedOn: string; closedOn: string }) => Boolean(account.approvedOn) && !account.closedOn).length, expected.active);
    assert.equal(fiveTwentyFourAccounts(accounts, now).length, expected.fiveTwentyFour);
  }
});
