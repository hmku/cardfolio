import { after } from "next/server";
import { nextItemStatus, webhookAction } from "@/app/lib/core/finance";
import { plaid, plaidConfigured } from "@/db/plaid";
import { syncItem } from "@/db/plaid-sync";
import { lookupWebhookKey, verifyPlaidWebhook, webhookKeyCache, type WebhookKey } from "@/db/plaid-webhook";
import { adminClient } from "@/db/storage";

export const runtime = "nodejs";
// The answer goes back to Plaid right away; the sync itself runs afterwards (next/server `after`),
// within this budget. A new login's first sync can pull two years of transactions.
export const maxDuration = 300;

// While another sync of the login runs, retry every 20s for up to about 4 minutes (within maxDuration).
const BUSY_RETRY_MS = 20_000;
const BUSY_RETRIES = 12;

// Plaid wants a webhook answered within about 10s, so the key lookup gets a short timeout.
const KEY_TIMEOUT_MS = 5_000;

const fetchKey = webhookKeyCache((kid) => lookupWebhookKey(kid, async (id) => {
  const { key } = await plaid<{ key: WebhookKey }>("/webhook_verification_key/get", { key_id: id }, { timeoutMs: KEY_TIMEOUT_MS });
  return key;
}));

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
    const next = nextItemStatus({ status: item.status as string | null, errorCode: item.error_code as string | null }, action.event);
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
      // If another sync of this login is running (e.g. the first sync after connecting), it may
      // have read its last page before this update arrived, so wait for it and sync once more.
      for (let attempt = 0; ; attempt += 1) {
        const result = await syncItem({ db, householdId: item.household_id as string }, item.id as number, { products: action.products });
        if (!result.skipped || attempt >= BUSY_RETRIES) break;
        await new Promise((resolve) => setTimeout(resolve, BUSY_RETRY_MS));
      }
    } catch (reason) {
      console.error("Plaid webhook sync failed", reason);
    }
  });
  return Response.json({ ok: true, syncing: action.products });
}
