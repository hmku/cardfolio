import { assertItemVisible, hiddenItemIds } from "@/db/plaid";
import { syncHousehold, syncItem } from "@/db/plaid-sync";
import { errorResponse, requireHousehold } from "@/db/storage";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * "Sync now": syncs one bank login (body { itemId }) or every login in the household. Logins
 * hidden from a member with hideInvestments still sync, but are left out of the results.
 */
export async function POST(request: Request) {
  try {
    const context = await requireHousehold(request);
    const { itemId } = await request.json().catch(() => ({})) as { itemId?: number };
    if (itemId) {
      await assertItemVisible(context, Number(itemId));
      return Response.json({ items: [await syncItem(context, Number(itemId))] });
    }
    const hidden = await hiddenItemIds(context);
    const { items, snapshots } = await syncHousehold(context);
    return Response.json({ items: items.filter((item) => !hidden.has(item.itemId)), snapshots });
  } catch (error) {
    return await errorResponse(error, "Couldn't sync");
  }
}
