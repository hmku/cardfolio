import assert from "node:assert/strict";
import test from "node:test";
import { chartWindowEnd, elapsedMonths, transactionsBefore } from "../app/lib/core/finance.ts";
import { snapshotKey, snapshotLoadStart, withLiveEnd } from "../app/lib/core/investments.ts";
import { splitMask } from "../app/lib/presentation/account-labels.ts";
import { moneyCompact, niceTicks, percent, signedMoney, signedPercent, timeAxisLabels } from "../app/lib/presentation/finance-format.ts";

test("the 12-month averages count only the elapsed part of this month", () => {
  assert.equal(elapsedMonths("2026-11-30", 12), 12);
  assert.ok(Math.abs(elapsedMonths("2026-11-03", 12) - (11 + 3 / 30)) < 1e-9);
  assert.ok(Math.abs(elapsedMonths("2026-02-14", 12) - 11.5) < 1e-9);
});

test("the cash flow chart window only moves when the picked month is outside it", () => {
  // 24 months, a 12-month window ending on the newest (index 23).
  assert.equal(chartWindowEnd(23, 16, 12, 24), 23, "a visible month keeps the window");
  assert.equal(chartWindowEnd(23, 12, 12, 24), 23, "the oldest visible month keeps it too");
  assert.equal(chartWindowEnd(23, 11, 12, 24), 22, "one before the window shifts it by one");
  assert.equal(chartWindowEnd(23, 0, 12, 24), 11, "the oldest month shows at the left edge");
  assert.equal(chartWindowEnd(11, 12, 12, 24), 12, "one after the window shifts it by one");
  assert.equal(chartWindowEnd(11, 30, 12, 24), 23, "never past the newest month");
  assert.equal(chartWindowEnd(3, 2, 12, 24), 11, "a window can't end before it's full");
  assert.equal(chartWindowEnd(23, -1, 12, 24), 23, "an unknown month (the 12-month view) keeps it");
  assert.equal(chartWindowEnd(5, 2, 12, 6), 5, "fewer months than the window");
});

test("transaction keyset paging filter", () => {
  assert.equal(transactionsBefore({ date: "2026-10-03", id: 42 }), "or(date.lt.2026-10-03,and(date.eq.2026-10-03,id.lt.42))");
  assert.throws(() => transactionsBefore({ date: "2026-10-03),x.eq.(1", id: 42 }));
  assert.throws(() => transactionsBefore({ date: "2026-10-03", id: 4.5 }));
});

test("snapshot loads start a little before the range, or load everything", () => {
  assert.equal(snapshotLoadStart("2026-11-02", "3M"), "2026-07-19");
  assert.equal(snapshotLoadStart("2026-11-02", "1Y"), "2025-10-19");
  assert.equal(snapshotLoadStart("2026-11-02", "all"), null);
  assert.equal(snapshotKey({ plaidAccountId: 4, manualAccountId: null }), "p4");
  assert.equal(snapshotKey({ plaidAccountId: null, manualAccountId: 9 }), "m9");
});

test("withLiveEnd ends a copy of the series on today's live value", () => {
  const series = [{ date: "2026-10-30", valueCents: 100 }, { date: "2026-11-01", valueCents: 200 }];
  assert.deepEqual(withLiveEnd(series, "2026-11-02", 250), [...series, { date: "2026-11-02", valueCents: 250 }]);
  assert.deepEqual(withLiveEnd(series, "2026-11-01", 250), [series[0], { date: "2026-11-01", valueCents: 250 }]);
  assert.equal(series.length, 2, "the input isn't changed");
  assert.equal(series[1].valueCents, 200);
  assert.deepEqual(withLiveEnd([], "2026-11-02", 250), []);
});

test("splitMask keeps an account's last digits apart from its name", () => {
  assert.deepEqual(splitMask("Plaid Checking ··1234"), { name: "Plaid Checking", mask: "··1234" });
  assert.deepEqual(splitMask("biz plat HK7"), { name: "biz plat HK7", mask: "" });
  assert.deepEqual(splitMask("··1234"), { name: "··1234", mask: "" });
});

test("percent formats shares the same everywhere", () => {
  assert.equal(percent(0.074), "7.4%");
  assert.equal(percent(0.4237), "42%");
  assert.equal(percent(0), "0.0%");
  assert.equal(percent(-0.05), "−5.0%");
  assert.equal(percent(-0.0001), "0.0%");
  assert.equal(signedPercent(0.052), "+5.2%");
  assert.equal(signedPercent(-0.12), "−12%");
  assert.equal(signedPercent(null), "");
  assert.equal(signedMoney(1234_00), "+$1,234");
  assert.equal(signedMoney(-56_00), "−$56");
  assert.equal(moneyCompact(1_250_000_00), "$1.3M");
  assert.equal(moneyCompact(-4_000_00), "−$4K");
});

test("niceTicks gives round steps that cover the range", () => {
  assert.deepEqual(niceTicks(0, 1_000_000), [0, 250_000, 500_000, 750_000, 1_000_000]);
  assert.deepEqual(niceTicks(0, 900_000), [0, 250_000, 500_000, 750_000, 1_000_000]);
  const ticks = niceTicks(9_812_345, 10_480_000);
  assert.ok(ticks[0] <= 9_812_345 && ticks[ticks.length - 1] >= 10_480_000);
  assert.ok(niceTicks(500_000, 500_000).length >= 2, "a flat line still gets an axis");
});

test("time axis labels never repeat a date", () => {
  assert.deepEqual(timeAxisLabels(["2026-11-01", "2026-11-02"], 5), [{ fraction: 0, text: "Nov 1" }, { fraction: 1, text: "Nov 2" }]);
  const three = timeAxisLabels(["2026-10-31", "2026-11-01", "2026-11-02"], 5);
  assert.deepEqual(three.map((label) => label.text), ["Oct 31", "Nov 1", "Nov 2"]);
  // Many points over two days: still one label per day.
  const daily = Array.from({ length: 3 }, (_, index) => `2026-11-0${index + 1}`);
  assert.equal(timeAxisLabels(daily, 2).length, 2);
  // A long span: months and years, evenly spaced, no repeats.
  const long = Array.from({ length: 401 }, (_, index) => new Date(Date.UTC(2025, 8, 27 + index)).toISOString().slice(0, 10));
  const labels = timeAxisLabels(long, 5);
  assert.equal(labels.length, 5);
  assert.equal(labels[0].text, "Sep 2025");
  assert.equal(labels[4].text, "Nov 2026");
  assert.deepEqual(labels.map((label) => label.fraction), [0, 0.25, 0.5, 0.75, 1]);
  assert.equal(new Set(labels.map((label) => label.text)).size, labels.length);
});
