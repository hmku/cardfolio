import { plaidConfigured } from "@/db/plaid";
import { syncDate, syncHousehold, writeSnapshots } from "@/db/plaid-sync";
import { adminClient, isCronRequest } from "@/db/storage";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Daily sync (see vercel.json): every bank login in every household, then each household's
 * balance snapshots (manual accounts carry forward even without Plaid). Vercel calls it with
 * `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(request: Request) {
  if (!isCronRequest(request)) return Response.json({ error: "Not authorized" }, { status: 401 });
  const db = adminClient();
  const date = syncDate();
  const { data: households, error } = await db.from("households").select("id");
  if (error) return Response.json({ error: error.message }, { status: 500 });
  const results = [];
  for (const { id: householdId } of households || []) {
    try {
      if (!plaidConfigured()) {
        results.push({ householdId, snapshots: await writeSnapshots({ db, householdId }, date), items: [] });
        continue;
      }
      const { items, snapshots } = await syncHousehold({ db, householdId }, { today: date });
      results.push({ householdId, snapshots, items: items.map((item) => ({ itemId: item.itemId, ok: item.ok, error: item.error, products: item.products, transactions: item.transactions })) });
    } catch (reason) {
      results.push({ householdId, error: reason instanceof Error ? reason.message : "Sync failed" });
    }
  }
  return Response.json({ date, results });
}
