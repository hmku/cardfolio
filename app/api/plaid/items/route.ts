import { encryptToken, exchangePublicToken, getAccounts, loadItem, noteItemError, PlaidApiError, removeItem, syncItemAccounts } from "@/db/plaid";
import { errorResponse, requireHousehold } from "@/db/storage";

export const runtime = "nodejs";

type Body = { publicToken?: string; institution?: { id?: string; name?: string } | null; itemId?: number };

/** Finishes connecting a bank: swaps Link's public token, stores the item and its cards. */
export async function POST(request: Request) {
  try {
    const context = await requireHousehold(request);
    const body = await request.json() as Body;
    if (!body.publicToken) throw new Response("Missing the token from Plaid", { status: 400 });
    const { accessToken, itemId } = await exchangePublicToken(body.publicToken);
    const { accounts, item } = await getAccounts(accessToken);
    const { data, error } = await context.db.from("plaid_items").insert({
      household_id: context.householdId,
      plaid_item_id: itemId,
      access_token_encrypted: encryptToken(accessToken),
      institution_id: item.institution_id || body.institution?.id || null,
      institution_name: body.institution?.name?.slice(0, 100) || null,
      added_by: context.user.id,
      added_by_email: context.user.email,
      consent_expires_at: item.consent_expiration_time || null,
    }).select("id").single();
    if (error) {
      await removeItem(accessToken).catch(() => undefined);
      throw error;
    }
    return Response.json(await syncItemAccounts(context, data.id as number, accounts));
  } catch (error) {
    return await errorResponse(error, "Couldn't connect that bank");
  }
}

/** Re-reads an item's cards, e.g. after reconnecting it in Link's update mode. */
export async function PATCH(request: Request) {
  try {
    const context = await requireHousehold(request);
    const { itemId } = await request.json() as Body;
    const item = await loadItem(context, itemId);
    try {
      const { accounts, item: details } = await getAccounts(item.accessToken);
      const { error } = await context.db.from("plaid_items").update({ status: "ok", error_code: null, consent_expires_at: details.consent_expiration_time || null, updated_at: new Date().toISOString() }).eq("id", item.id);
      if (error) throw error;
      return Response.json(await syncItemAccounts(context, item.id, accounts));
    } catch (error) {
      await noteItemError(context, item.id, error);
      throw error;
    }
  } catch (error) {
    return await errorResponse(error, "Couldn't refresh that bank");
  }
}

/** Disconnects a bank: removes the item at Plaid (which stops billing) and here. */
export async function DELETE(request: Request) {
  try {
    const context = await requireHousehold(request);
    const { itemId } = await request.json() as Body;
    const item = await loadItem(context, itemId);
    await removeItem(item.accessToken).catch((error) => {
      // Already gone at Plaid is fine; anything else should stop us deleting our copy.
      if (!(error instanceof PlaidApiError && ["ITEM_NOT_FOUND", "INVALID_ACCESS_TOKEN"].includes(error.code))) throw error;
    });
    const { error } = await context.db.from("plaid_items").delete().eq("id", item.id);
    if (error) throw error;
    return Response.json({ ok: true });
  } catch (error) {
    return await errorResponse(error, "Couldn't disconnect that bank");
  }
}
