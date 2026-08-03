import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { annualFeePayments, bonusDeadline, creditPeriod, fiveTwentyFourAccounts, isoDate } from "../app/lib/portfolio.ts";

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

test("the migration snapshot matches the audited Tracker, Stats, and Credits sheets", async () => {
  const snapshot = JSON.parse(await readFile(new URL("../data/seed-data.json", import.meta.url), "utf8"));
  assert.equal(snapshot.accounts.length, 142);
  assert.equal(new Set(snapshot.accounts.map((account: { card: string }) => account.card.trim())).size, 34);
  assert.equal(snapshot.creditDefinitions.length, 15);

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
