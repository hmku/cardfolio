import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import { creditIsDue, creditState, eligibleHoldings } from "../app/lib/core/credits.ts";
import { exportTables } from "../app/lib/core/export.ts";
import { indexPortfolio } from "../app/lib/core/model.ts";
import { dailyReminder } from "../app/lib/core/reminders.ts";
import { planSheetImport, planToPortfolioData } from "../app/lib/core/sheet-import.ts";
import { dueItems } from "../app/lib/core/stats.ts";
import { loadPortfolio, saveCredit } from "../app/lib/data.ts";

const today = new Date(2026, 8, 28, 12); // Monday and two days before quarterly expiry.
const snapshot = JSON.parse(readFileSync(new URL("../data/sheet-snapshot.json", import.meta.url), "utf8"));
const data = planToPortfolioData(planSheetImport(snapshot.tracker, snapshot.credits, today));
const portfolio = indexPortfolio(data);
const credit = portfolio.credits.find((item) => item.name === "Hilton")!;

const creditTasks = (value: typeof portfolio) => dueItems(value, today).filter((item) => item.kind === "credit" && item.credit.id === credit.id);
const creditNotifications = (value: typeof portfolio) => dailyReminder(value, today)?.lines.filter((line) => line.startsWith("Hilton ")) ?? [];

test("hidden credits suppress to-dos and notifications even with a stale reminder flag", () => {
  assert.equal(creditTasks(portfolio).length, 1);
  assert.equal(creditNotifications(portfolio).length, 1);
  const hidden = { ...credit, hidden: true, remind: true };
  const holding = eligibleHoldings(portfolio, credit, today)[0];
  const use = { id: 999, creditId: credit.id, holdingId: holding.id, periodKey: "2026-Q3", amountCents: 2500, usedOn: null, recordedBy: null, source: "manual" as const };
  const withHistory = indexPortfolio({ ...data, uses: [...data.uses, use] });
  const value = indexPortfolio({ ...withHistory, credits: data.credits.map((item) => item.id === credit.id ? hidden : item) });
  const state = creditState(value, hidden, holding, today);
  assert.equal(state.kind, "partial");
  assert.equal(creditIsDue(hidden, state), false);
  assert.equal(creditTasks(value).length, 0);
  assert.equal(creditNotifications(value).length, 0);
  assert.deepEqual(exportTables(value, today), exportTables(withHistory, today));
  assert.deepEqual(value.optOuts, withHistory.optOuts);

  const shown = { ...hidden, hidden: false, remind: false };
  const restored = indexPortfolio({ ...value, credits: value.credits.map((item) => item.id === credit.id ? shown : item) });
  assert.deepEqual(creditState(restored, shown, holding, today), state);
  assert.equal(creditTasks(restored).length, 0);
  const enabled = indexPortfolio({ ...restored, credits: restored.credits.map((item) => item.id === credit.id ? { ...shown, remind: true } : item) });
  assert.equal(creditTasks(enabled).length, 1);
});

test("saveCredit hides and disables reminders in one household-scoped request", async () => {
  const requests: { method: string; url: URL; body: Record<string, unknown> }[] = [];
  const db = createClient("https://example.supabase.co", "test-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, init) => {
      requests.push({ method: init!.method!, url: new URL(String(input)), body: JSON.parse(String(init!.body)) });
      return new Response(null, { status: 204 });
    } },
  });
  const context = { db, householdId: "test-household", email: "test@example.com" };
  await saveCredit(context, credit.id, { hidden: true, remind: true });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, "PATCH");
  assert.equal(requests[0].url.searchParams.get("household_id"), "eq.test-household");
  assert.equal(requests[0].url.searchParams.get("id"), `eq.${credit.id}`);
  assert.deepEqual(requests[0].body, { hidden: true, remind: false });
  await saveCredit(context, credit.id, { hidden: false });
  assert.deepEqual(requests[1].body, { hidden: false });
  await saveCredit(context, credit.id, { remind: true });
  assert.deepEqual(requests[2].body, { remind: true });
});

test("loadPortfolio restores hidden state from stored credits", async () => {
  const db = createClient("https://example.supabase.co", "test-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input) => {
      const rows = new URL(String(input)).pathname.endsWith("/credits")
        ? [{ id: 1, product_id: 1, name: "Hilton", amount_cents: 5000, cadence: "quarterly", remind: false, hidden: true, sort: 0 }]
        : [];
      return new Response(JSON.stringify(rows), { headers: { "Content-Type": "application/json" } });
    } },
  });
  const loaded = await loadPortfolio(db, "test-household");
  assert.equal(loaded.credits[0].hidden, true);
  assert.equal(loaded.credits[0].remind, false);
});
