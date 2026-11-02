import { createLinkToken, loadItem } from "@/db/plaid";
import { errorResponse, requireHousehold } from "@/db/storage";

export const runtime = "nodejs";

/** A Plaid Link token: for a new bank login, or with itemId to reconnect an existing one. */
export async function POST(request: Request) {
  try {
    const context = await requireHousehold(request);
    const { itemId } = await request.json().catch(() => ({})) as { itemId?: number };
    const item = itemId ? await loadItem(context, itemId) : null;
    return Response.json({ linkToken: await createLinkToken(context.user.id, item?.accessToken) });
  } catch (error) {
    return await errorResponse(error, "Couldn't start connecting a bank");
  }
}
