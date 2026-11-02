import { createLinkToken, loadItem, type LinkKind } from "@/db/plaid";
import { errorResponse, requireHousehold } from "@/db/storage";

export const runtime = "nodejs";

/** A Plaid Link token: for a new login (kind "bank" or "investments"), or with itemId to reconnect one. */
export async function POST(request: Request) {
  try {
    const context = await requireHousehold(request);
    const { itemId, kind } = await request.json().catch(() => ({})) as { itemId?: number; kind?: LinkKind };
    const item = itemId ? await loadItem(context, itemId) : null;
    return Response.json({ linkToken: await createLinkToken(context.user.id, { accessToken: item?.accessToken, kind: kind === "investments" ? "investments" : "bank" }) });
  } catch (error) {
    return await errorResponse(error, "Couldn't start connecting a bank");
  }
}
