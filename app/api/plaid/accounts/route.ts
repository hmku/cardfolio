import { errorResponse, requireHousehold } from "@/db/storage";

export const runtime = "nodejs";

/** Links a Plaid account to a Cardfolio card, or unlinks it (accountId null). */
export async function PATCH(request: Request) {
  try {
    const context = await requireHousehold(request);
    const { id, accountId } = await request.json() as { id?: number; accountId?: number | null };
    if (!id) throw new Response("Missing the bank account", { status: 400 });
    if (accountId) {
      const { data, error } = await context.db.from("accounts").select("id").eq("household_id", context.householdId).eq("id", accountId).maybeSingle();
      if (error) throw error;
      if (!data) throw new Response("That card wasn't found", { status: 404 });
    }
    const update = context.db.from("plaid_accounts")
      .update({ account_id: accountId || null, link_source: "manual" })
      .eq("household_id", context.householdId).eq("id", id);
    // Investment accounts are hidden from members with hideInvestments (RLS doesn't apply here).
    const { data, error } = await (context.hideInvestments ? update.neq("type", "investment") : update).select("id");
    if (error) throw error;
    if (!data?.length) throw new Response("That bank account wasn't found", { status: 404 });
    return Response.json({ ok: true });
  } catch (error) {
    return await errorResponse(error, "Couldn't link that card");
  }
}
