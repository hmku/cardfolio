import { isDuplicateLogin } from "@/app/lib/core/finance";
import { assertItemVisible, autoLinkItem, encryptToken, exchangePublicToken, getAccounts, loadItem, noteItemError, PlaidApiError, removeItem, syncItemAccounts } from "@/db/plaid";
import { syncItem, type ItemSyncResult } from "@/db/plaid-sync";
import { errorResponse, requireHousehold, type HouseholdContext } from "@/db/storage";

export const runtime = "nodejs";
// Connecting runs a first sync (up to two years of transactions, holdings); Plaid may still be
// gathering history, which later syncs pick up.
export const maxDuration = 300;

/**
 * The first sync after connecting or reconnecting: balances, whatever transactions are ready,
 * card statement details and holdings. Investment transactions can take Plaid a minute or two
 * the first time, so they wait for the webhook or the daily sync. A failure here doesn't undo
 * the connection.
 */
async function firstSync(context: HouseholdContext, itemId: number): Promise<ItemSyncResult | { ok: false; error: string }> {
  try {
    return await syncItem(context, itemId, { products: ["transactions", "liabilities", "holdings"] });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Couldn't sync yet" };
  }
}

type Body = { publicToken?: string; institution?: { id?: string; name?: string } | null; itemId?: number; personId?: number | null };

/** The cardholder id if it belongs to this household, else null. */
async function householdPerson(context: HouseholdContext, personId: unknown) {
  if (!personId) return null;
  const { data, error } = await context.db.from("people").select("id").eq("household_id", context.householdId).eq("id", Number(personId)).maybeSingle();
  if (error) throw error;
  if (!data) throw new Response("That cardholder wasn't found", { status: 404 });
  return data.id as number;
}

/** Whether the household already has this login (same institution and accounts), e.g. connected by the other person. */
async function alreadyConnected(context: HouseholdContext, institutionId: string | null, accounts: { mask: string | null; subtype: string | null }[]) {
  if (!institutionId) return false;
  const { data: items, error } = await context.db.from("plaid_items").select("id, institution_id").eq("household_id", context.householdId).eq("institution_id", institutionId);
  if (error) throw error;
  if (!items?.length) return false;
  const { data: rows, error: accountsError } = await context.db.from("plaid_accounts").select("item_id, mask, subtype").in("item_id", items.map((item) => item.id));
  if (accountsError) throw accountsError;
  return isDuplicateLogin(institutionId, accounts, items.map((item) => ({
    institutionId: item.institution_id as string | null,
    accounts: (rows || []).filter((row) => row.item_id === item.id).map((row) => ({ mask: row.mask as string | null, subtype: row.subtype as string | null })),
  })));
}

/** Finishes connecting a bank: swaps Link's public token, stores the item and its cards. */
export async function POST(request: Request) {
  try {
    const context = await requireHousehold(request);
    const body = await request.json() as Body;
    if (!body.publicToken) throw new Response("Missing the token from Plaid", { status: 400 });
    const personId = await householdPerson(context, body.personId);
    const { accessToken, itemId } = await exchangePublicToken(body.publicToken);
    const { accounts, item } = await getAccounts(accessToken);
    const institutionId = item.institution_id || body.institution?.id || null;
    if (await alreadyConnected(context, institutionId, accounts)) {
      // Don't keep (and pay for) a second copy: every transaction would be counted twice.
      await removeItem(accessToken).catch(() => undefined);
      throw new Response("This bank login is already connected; use Reconnect on it instead.", { status: 409 });
    }
    const { data, error } = await context.db.from("plaid_items").insert({
      household_id: context.householdId,
      plaid_item_id: itemId,
      access_token_encrypted: encryptToken(accessToken),
      institution_id: institutionId,
      institution_name: body.institution?.name?.slice(0, 100) || null,
      added_by: context.user.id,
      added_by_email: context.user.email,
      consent_expires_at: item.consent_expiration_time || null,
      person_id: personId,
    }).select("id").single();
    if (error) {
      await removeItem(accessToken).catch(() => undefined);
      throw error;
    }
    const linked = await syncItemAccounts(context, data.id as number, accounts);
    return Response.json({ ...linked, sync: await firstSync(context, data.id as number) });
  } catch (error) {
    return await errorResponse(error, "Couldn't connect that bank");
  }
}

/**
 * With personId: changes whose login this is (its accounts that followed the old owner move
 * along) and redoes automatic card matching for the new owner (links made by hand stay).
 * Without: re-reads the item's cards, e.g. after reconnecting it in Link's update mode.
 */
export async function PATCH(request: Request) {
  try {
    const context = await requireHousehold(request);
    const body = await request.json() as Body;
    const { itemId } = body;
    if ("personId" in body) {
      const personId = await householdPerson(context, body.personId);
      const { data: current, error: currentError } = await context.db.from("plaid_items").select("id, person_id").eq("household_id", context.householdId).eq("id", Number(itemId)).maybeSingle();
      if (currentError) throw currentError;
      if (!current) throw new Response("That bank connection wasn't found", { status: 404 });
      await assertItemVisible(context, current.id as number);
      const { error } = await context.db.from("plaid_items").update({ person_id: personId, updated_at: new Date().toISOString() }).eq("id", current.id);
      if (error) throw error;
      const followers = context.db.from("plaid_accounts").update({ person_id: personId }).eq("item_id", current.id);
      const { error: accountsError } = current.person_id ? await followers.or(`person_id.is.null,person_id.eq.${current.person_id}`) : await followers.is("person_id", null);
      if (accountsError) throw accountsError;
      // Automatic links were made for the old owner's cards; match again for the new owner.
      const { error: unlinkError } = await context.db.from("plaid_accounts").update({ account_id: null, link_source: null }).eq("item_id", current.id).eq("link_source", "auto");
      if (unlinkError) throw unlinkError;
      return Response.json({ linked: await autoLinkItem(context, current.id) });
    }
    const item = await loadItem(context, itemId);
    try {
      const { accounts, item: details } = await getAccounts(item.accessToken);
      const { error } = await context.db.from("plaid_items").update({ status: "ok", error_code: null, consent_expires_at: details.consent_expiration_time || null, updated_at: new Date().toISOString() }).eq("id", item.id);
      if (error) throw error;
      const linked = await syncItemAccounts(context, item.id, accounts);
      return Response.json({ ...linked, sync: await firstSync(context, item.id) });
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
