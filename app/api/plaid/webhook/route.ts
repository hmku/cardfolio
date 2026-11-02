import { after } from "next/server";
import { webhookAction } from "@/app/lib/core/finance";
import { plaid, plaidConfigured } from "@/db/plaid";
import { syncItem } from "@/db/plaid-sync";
import { verifyPlaidWebhook, type WebhookKey } from "@/db/plaid-webhook";
import { adminClient } from "@/db/storage";

export const runtime = "nodejs";
// The answer goes back to Plaid right away; the sync itself runs afterwards (next/server `after`).
export const maxDuration = 60;

// Verification keys rarely change; keep them for the life of the server instance.
const keys = new Map<string, WebhookKey>();

async function fetchKey(kid: string) {
  const cached = keys.get(kid);
  if (cached) return cached;
  try {
    const { key } = await plaid<{ key: WebhookKey }>("/webhook_verification_key/get", { key_id: kid });
    keys.set(kid, key);
    return key;
  } catch {
    return null;
  }
}

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
  const { data: item, error } = await db.from("plaid_items").select("id, household_id").eq("plaid_item_id", payload.item_id).maybeSingle();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  // An item we don't know (e.g. already disconnected): acknowledge so Plaid doesn't retry.
  if (!item) return Response.json({ ok: true, unknownItem: true });

  if (action.kind === "status") {
    const { error: updateError } = await db.from("plaid_items").update({
      status: action.status,
      error_code: action.errorCode,
      updated_at: new Date().toISOString(),
      ...(payload.consent_expiration_time ? { consent_expires_at: payload.consent_expiration_time } : {}),
    }).eq("id", item.id);
    if (updateError) return Response.json({ error: updateError.message }, { status: 500 });
    return Response.json({ ok: true, status: action.status });
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
