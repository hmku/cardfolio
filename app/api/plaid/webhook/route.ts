import { after } from "next/server";
import { nextItemStatus, webhookAction } from "@/app/lib/core/finance";
import { plaid, PlaidApiError, plaidConfigured } from "@/db/plaid";
import { syncItem } from "@/db/plaid-sync";
import { verifyPlaidWebhook, webhookKeyCache, type WebhookKey } from "@/db/plaid-webhook";
import { adminClient } from "@/db/storage";

export const runtime = "nodejs";
// The answer goes back to Plaid right away; the sync itself runs afterwards (next/server `after`),
// within this budget. A new login's first sync can pull two years of transactions.
export const maxDuration = 300;

// Plaid errors that say nothing about the key (try again later rather than remember the kid as unknown).
const TRANSIENT_ERRORS = new Set(["RATE_LIMIT_EXCEEDED", "INTERNAL_SERVER_ERROR", "PLANNED_MAINTENANCE"]);

const fetchKey = webhookKeyCache(async (kid) => {
  try {
    const { key } = await plaid<{ key: WebhookKey }>("/webhook_verification_key/get", { key_id: kid });
    return key;
  } catch (error) {
    if (error instanceof PlaidApiError && !TRANSIENT_ERRORS.has(error.code)) return null;
    throw error;
  }
});

type Payload = { webhook_type?: string; webhook_code?: string; item_id?: string; error?: { error_code?: string } | null; consent_expiration_time?: string | null };

/** Plaid webhooks (set PLAID_WEBHOOK_URL to this route's URL). Syncs or flags the item it names. */
export async function POST(request: Request) {
  if (!plaidConfigured()) return Response.json({ error: "Plaid isn't set up" }, { status: 503 });
  const body = await request.text();
  const verified = await verifyPlaidWebhook(body, request.headers.get("plaid-verification"), fetchKey);
  if (!verified.ok) return Response.json({ error: `Webhook rejected: ${verified.reason}` }, { status: 401 });

  let payload: Payload;
  try { payload = JSON.parse(body) as Payload; } catch { return Response.json({ error: "Bad JSON" }, { status: 400 }); }
  const action = webhookAction(payload);
  if (action.kind === "ignore" || !payload.item_id) return Response.json({ ok: true, ignored: true });

  const db = adminClient();
  const { data: item, error } = await db.from("plaid_items").select("id, household_id, status, error_code").eq("plaid_item_id", payload.item_id).maybeSingle();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  // An item we don't know (e.g. already disconnected): acknowledge so Plaid doesn't retry.
  if (!item) return Response.json({ ok: true, unknownItem: true });

  if (action.kind === "status") {
    // Only LOGIN_REPAIRED clears a reconnect flag; another error doesn't hide one (see nextItemStatus).
    const next = nextItemStatus(
      { status: item.status as string | null, errorCode: item.error_code as string | null },
      payload.webhook_code === "LOGIN_REPAIRED" ? { kind: "repaired" } : { kind: "error", errorCode: action.errorCode || "ITEM_ERROR" },
    );
    const { error: updateError } = await db.from("plaid_items").update({
      status: next.status,
      error_code: next.errorCode,
      updated_at: new Date().toISOString(),
      ...(payload.consent_expiration_time ? { consent_expires_at: payload.consent_expiration_time } : {}),
    }).eq("id", item.id);
    if (updateError) return Response.json({ error: updateError.message }, { status: 500 });
    return Response.json({ ok: true, status: next.status });
  }

  after(async () => {
    try {
      await syncItem({ db, householdId: item.household_id as string }, item.id as number, { products: action.products });
    } catch (reason) {
      console.error("Plaid webhook sync failed", reason);
    }
  });
  return Response.json({ ok: true, syncing: action.products });
}
