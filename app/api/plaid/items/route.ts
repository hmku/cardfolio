import { planLoginConnect, syncProductsOf } from "@/app/lib/core/finance";
import { assertItemVisible, autoLinkItem, encryptToken, exchangePublicToken, getAccounts, hiddenItemIds, loadItem, noteItemError, PlaidApiError, removeItem, syncItemAccounts, type PlaidAccount } from "@/db/plaid";
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

/**
 * Whether the household already has this login (same institution and accounts), e.g. connected
 * by the other person, and if so whether the new connection brings products it lacks (see
 * planLoginConnect).
 */
async function connectPlan(context: HouseholdContext, institutionId: string | null, accounts: PlaidAccount[], products: string[] | null | undefined) {
  if (!institutionId) return { kind: "new" } as const;
  const { data: items, error } = await context.db.from("plaid_items").select("id, institution_id, synced_products").eq("household_id", context.householdId).eq("institution_id", institutionId);
  if (error) throw error;
  if (!items?.length) return { kind: "new" } as const;
  const { data: rows, error: accountsError } = await context.db.from("plaid_accounts").select("id, item_id, plaid_account_id, mask, subtype, type").in("item_id", items.map((item) => item.id));
  if (accountsError) throw accountsError;
  return planLoginConnect(
    institutionId,
    accounts.map((account) => ({ plaidAccountId: account.account_id, mask: account.mask, subtype: account.subtype, type: account.type })),
    products,
    items.map((item) => ({
      id: item.id as number,
      institutionId: item.institution_id as string | null,
      syncedProducts: item.synced_products as string[] | null,
      accounts: (rows || []).filter((row) => row.item_id === item.id).map((row) => ({
        rowId: row.id as number, plaidAccountId: row.plaid_account_id as string, mask: row.mask as string | null, subtype: row.subtype as string | null, type: row.type as string | null,
      })),
    })),
  );
}

/**
 * Hands the accounts the new connection carries over from the stored one (keeping their
 * links, owners, rules and history) and makes the stored one skip them from now on.
 */
async function shareLogin(context: HouseholdContext, newItemId: number, plan: { itemId: number; move: { rowId: number; plaidAccountId: string }[]; release: string[] }, products: string[]) {
  const { db } = context;
  for (const { rowId, plaidAccountId } of plan.move) {
    const { error } = await db.from("plaid_accounts").update({ item_id: newItemId, plaid_account_id: plaidAccountId }).eq("household_id", context.householdId).eq("id", rowId);
    if (error) throw error;
  }
  // The new connection pulls these accounts' transactions again under its own ids.
  if (plan.move.length && syncProductsOf(products).includes("transactions")) {
    const { error } = await db.from("transactions").delete().eq("household_id", context.householdId).in("plaid_account_id", plan.move.map((row) => row.rowId));
    if (error) throw error;
  }
  if (plan.release.length) {
    const { data, error } = await db.from("plaid_items").select("ignored_accounts").eq("id", plan.itemId).single();
    if (error) throw error;
    const ignored = [...new Set([...((data.ignored_accounts as string[] | null) || []), ...plan.release])];
    const { error: updateError } = await db.from("plaid_items").update({ ignored_accounts: ignored, updated_at: new Date().toISOString() }).eq("id", plan.itemId);
    if (updateError) throw updateError;
  }
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
    const plan = await connectPlan(context, institutionId, accounts, item.products);
    if (plan.kind === "duplicate") {
      // Don't keep (and pay for) a second copy: every transaction would be counted twice.
      await removeItem(accessToken).catch(() => undefined);
      // Don't point a member at a login that's hidden from them (or confirm it exists).
      const hidden = (await hiddenItemIds(context)).has(plan.itemId);
      throw new Response(hidden ? "This login is already connected in Cardfolio." : "This bank login is already connected; use Reconnect on it instead.", { status: 409 });
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
      ignored_accounts: plan.kind === "share" ? plan.ignore : [],
    }).select("id").single();
    if (error) {
      await removeItem(accessToken).catch(() => undefined);
      throw error;
    }
    if (plan.kind === "share") await shareLogin(context, data.id as number, plan, item.products || []);
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
