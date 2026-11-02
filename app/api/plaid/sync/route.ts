import { syncHousehold, syncItem } from "@/db/plaid-sync";
import { errorResponse, requireHousehold } from "@/db/storage";

export const runtime = "nodejs";
export const maxDuration = 300;

/** "Sync now": syncs one bank login (body { itemId }) or every login in the household. */
export async function POST(request: Request) {
  try {
    const context = await requireHousehold(request);
    const { itemId } = await request.json().catch(() => ({})) as { itemId?: number };
    if (itemId) return Response.json({ items: [await syncItem(context, Number(itemId))] });
    return Response.json(await syncHousehold(context));
  } catch (error) {
    return await errorResponse(error, "Couldn't sync");
  }
}
