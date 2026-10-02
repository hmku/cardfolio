import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import { creditIsDue, creditState, creditSummary, eligibleHoldings } from "../app/lib/core/credits.ts";
import { exportTables } from "../app/lib/core/export.ts";
import { indexPortfolio, type Credit, type CreditMode } from "../app/lib/core/model.ts";
import { dailyReminder } from "../app/lib/core/reminders.ts";
import { planSheetImport, planToPortfolioData } from "../app/lib/core/sheet-import.ts";
import { dueItems } from "../app/lib/core/stats.ts";
import { loadPortfolio, saveCredit } from "../app/lib/data.ts";

const today = new Date(2026, 8, 28, 12); // Monday and two days before quarterly expiry.
const snapshot = JSON.parse(readFileSync(new URL("../data/sheet-snapshot.json", import.meta.url), "utf8"));
const data = planToPortfolioData(planSheetImport(snapshot.tracker, snapshot.credits, today));
const portfolio = indexPortfolio(data);
const credit = portfolio.credits.find((item) => item.name === "Hilton")!;
const holding = eligibleHoldings(portfolio, credit, today)[0];

const withMode = (mode: CreditMode, extra: Partial<Credit> = {}, base = data) =>
  indexPortfolio({ ...base, credits: base.credits.map((item) => (item.id === credit.id ? { ...item, mode, ...extra } : item)) });
const hilton = (value: typeof portfolio) => value.credits.find((item) => item.id === credit.id)!;
const creditTasks = (value: typeof portfolio) => dueItems(value, today).filter((item) => item.kind === "credit" && item.credit.id === credit.id);
const creditNotifications = (value: typeof portfolio) => dailyReminder(value, today)?.lines.filter((line) => line.startsWith("Hilton ")) ?? [];
const exportRow = (value: typeof portfolio) => exportTables(value, today).credits.find((row) => row[1] === "Hilton");

test("tracked credits with Remind make to-dos and notifications", () => {
  assert.equal(creditTasks(portfolio).length, 1);
  assert.equal(creditNotifications(portfolio).length, 1);
  assert.equal(creditTasks(withMode("track", { remind: false })).length, 0, "tracked quietly");
});

test("not-using credits disappear from to-dos, notifications and exports but keep their history", () => {
  const use = { id: 999, creditId: credit.id, holdingId: holding.id, periodKey: "2026-Q3", amountCents: 2500, usedOn: null, recordedBy: null, source: "manual" as const };
  const withHistory = { ...data, uses: [...data.uses, use] };
  const skipped = withMode("skip", { remind: true }, withHistory);
  assert.equal(creditState(skipped, hilton(skipped), holding, today).kind, "off");
  assert.equal(creditTasks(skipped).length, 0);
  assert.equal(creditNotifications(skipped).length, 0);
  assert.equal(exportRow(skipped), undefined);
  assert.equal(skipped.usesFor(credit.id, holding.id, "2026-Q3").length, 1, "history kept");
  // Switching back restores the partial use and, because Remind was kept, the to-do.
  const back = withMode("track", { remind: true }, withHistory);
  assert.equal(creditState(back, hilton(back), holding, today).kind, "partial");
  assert.equal(creditTasks(back).length, 1);
});

test("always-used credits count as used every period without ticking", () => {
  const auto = withMode("auto", { remind: true });
  const state = creditState(auto, hilton(auto), holding, today);
  assert.equal(state.kind, "used");
  assert.equal(state.kind === "used" && state.auto, true);
  assert.equal(creditIsDue(hilton(auto), state), false);
  assert.equal(creditTasks(auto).length, 0);
  assert.equal(creditNotifications(auto).length, 0);
  const holdings = eligibleHoldings(auto, hilton(auto), today);
  const summary = creditSummary(auto, hilton(auto), holdings, today);
  assert.equal(summary.used, summary.enrolled, "every enrolled card counts as used");
  assert.equal(summary.remainingCents, 0);
  assert.equal(exportRow(auto)?.[5], summary.used);
  // Something recorded for a period (a partial amount) takes precedence over "always used".
  const use = { id: 998, creditId: credit.id, holdingId: holding.id, periodKey: "2026-Q3", amountCents: 2000, usedOn: null, recordedBy: null, source: "manual" as const };
  const partial = withMode("auto", {}, { ...data, uses: [...data.uses, use] });
  assert.equal(creditState(partial, hilton(partial), holding, today).kind, "partial");
  // Not enrolled on a card still wins.
  const optedOut = withMode("auto", {}, { ...data, optOuts: [...data.optOuts, { creditId: credit.id, holdingId: holding.id }] });
  assert.equal(creditState(optedOut, hilton(optedOut), holding, today).kind, "off");
});

test("saveCredit changes the mode in one household-scoped request and leaves Remind alone", async () => {
  const requests: { method: string; url: URL; body: Record<string, unknown> }[] = [];
  const db = createClient("https://example.supabase.co", "test-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, init) => {
      requests.push({ method: init!.method!, url: new URL(String(input)), body: JSON.parse(String(init!.body)) });
      return new Response(null, { status: 204 });
    } },
  });
  const context = { db, householdId: "test-household", email: "test@example.com" };
  await saveCredit(context, credit.id, { mode: "skip" });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, "PATCH");
  assert.equal(requests[0].url.searchParams.get("household_id"), "eq.test-household");
  assert.equal(requests[0].url.searchParams.get("id"), `eq.${credit.id}`);
  assert.deepEqual(requests[0].body, { mode: "skip" });
  await saveCredit(context, credit.id, { mode: "track", remind: true });
  assert.deepEqual(requests[1].body, { remind: true, mode: "track" });
});

test("loadPortfolio reads the mode, treating anything unknown as tracked", async () => {
  const db = createClient("https://example.supabase.co", "test-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input) => {
      const rows = new URL(String(input)).pathname.endsWith("/credits")
        ? [
          { id: 1, product_id: 1, name: "Digital entertainment", amount_cents: 2500, cadence: "monthly", remind: true, mode: "auto", sort: 0 },
          { id: 2, product_id: 1, name: "Oura", amount_cents: 20000, cadence: "calendar_year", remind: true, mode: "skip", sort: 1 },
          { id: 3, product_id: 1, name: "Hilton", amount_cents: 5000, cadence: "quarterly", remind: true, sort: 2 },
        ]
        : [];
      return new Response(JSON.stringify(rows), { headers: { "Content-Type": "application/json" } });
    } },
  });
  const loaded = await loadPortfolio(db, "test-household");
  assert.deepEqual(loaded.credits.map((item) => item.mode), ["auto", "skip", "track"]);
});
