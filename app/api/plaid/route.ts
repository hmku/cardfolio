import { plaidConfigured } from "@/db/plaid";
import { errorResponse, requireHousehold } from "@/db/storage";

export const runtime = "nodejs";

/** The household's bank connections and the cards Plaid found in each (no tokens). */
export async function GET(request: Request) {
  try {
    const context = await requireHousehold(request);
    const [items, accounts] = await Promise.all([
      context.db.from("plaid_items").select("id, institution_name, status, error_code, added_by_email, consent_expires_at, last_synced_at, created_at").eq("household_id", context.householdId).order("created_at"),
      context.db.from("plaid_accounts").select("id, item_id, name, official_name, mask, type, subtype, account_id, link_source").eq("household_id", context.householdId).order("name"),
    ]);
    if (items.error) throw items.error;
    if (accounts.error) throw accounts.error;
    // Members with hideInvestments don't see investment accounts, or logins that only have those.
    const visible = (accounts.data || []).filter((account) => !context.hideInvestments || account.type !== "investment");
    const hiddenItems = new Set((accounts.data || []).filter((account) => !visible.includes(account)).map((account) => account.item_id));
    const shownItems = (items.data || []).filter((item) => !hiddenItems.has(item.id) || visible.some((account) => account.item_id === item.id));
    return Response.json({
      configured: plaidConfigured(),
      sandbox: (process.env.PLAID_ENV || "sandbox").trim().toLowerCase() !== "production",
      items: shownItems.map((item) => ({
        id: item.id,
        institutionName: item.institution_name || "Bank",
        status: item.status,
        errorCode: item.error_code,
        addedByEmail: item.added_by_email,
        consentExpiresAt: item.consent_expires_at,
        lastSyncedAt: item.last_synced_at,
        createdAt: item.created_at,
        accounts: visible.filter((account) => account.item_id === item.id).map((account) => ({
          id: account.id,
          name: account.official_name || account.name,
          mask: account.mask,
          type: account.type,
          subtype: account.subtype,
          accountId: account.account_id,
          linkSource: account.link_source,
        })),
      })),
    });
  } catch (error) {
    return await errorResponse(error, "Couldn't load bank connections");
  }
}
