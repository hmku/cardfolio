import assert from "node:assert/strict";
import test from "node:test";
import { applyAction } from "../db/storage.ts";

function testContext() {
  const updates: Array<{ table: string; values: Record<string, unknown> }> = [];
  const db = {
    from(table: string) {
      let updateValues: Record<string, unknown> | null = null;
      const query = {
        select() { return query; },
        eq() { return query; },
        update(values: Record<string, unknown>) {
          updateValues = values;
          updates.push({ table, values });
          return query;
        },
        async maybeSingle() {
          if (table === "card_types") return { data: { id: 7 }, error: null };
          if (table === "accounts" && updateValues) return { data: { id: 42 }, error: null };
          return { data: null, error: null };
        },
      };
      return query;
    },
  };
  return {
    updates,
    context: {
      db,
      householdId: "00000000-0000-4000-8000-00000000cafd",
      role: "owner",
      user: { id: "user-1" },
    },
  };
}

test("closing a card preserves the supplied closure description", async () => {
  const { context, updates } = testContext();
  await applyAction(context as never, {
    action: "closeAccount",
    accountId: 42,
    closedOn: "2026-08-09",
    closedHow: "Downgraded to Freedom Flex",
  });
  assert.deepEqual(updates.at(-1), {
    table: "accounts",
    values: {
      status: "closed",
      closed_on: "2026-08-09",
      closed_how: "Downgraded to Freedom Flex",
    },
  });
});

test("reopening a card clears its closure fields", async () => {
  const { context, updates } = testContext();
  await applyAction(context as never, { action: "reopenAccount", accountId: 42 });
  assert.deepEqual(updates.at(-1), {
    table: "accounts",
    values: { status: "active", closed_on: null, closed_how: null },
  });
});

test("the full card editor can mark an application declined", async () => {
  const { context, updates } = testContext();
  await applyAction(context as never, {
    action: "updateAccount",
    accountId: 42,
    cardTypeId: 7,
    owner: "Harrison",
    kind: "personal",
    annualFee: 0,
    status: "declined",
    appliedOn: "2026-08-09",
    closedOn: "2026-08-09",
    closedHow: "Declined after review",
  });
  assert.equal(updates.at(-1)?.values.status, "declined");
  assert.equal(updates.at(-1)?.values.closed_how, "Declined after review");
  assert.equal(updates.at(-1)?.values.closed_on, "2026-08-09");
});
