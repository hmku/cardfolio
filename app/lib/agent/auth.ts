import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Agent keys look like `cfk_…`; only their SHA-256 hash is stored (see Settings → Agents). */
export function hashAgentKey(key: string) {
  return createHash("sha256").update(key).digest("hex");
}

/** The household and key name for a request's `Authorization: Bearer cfk_…` header, or null. */
export async function agentFromRequest(db: SupabaseClient, request: Request) {
  const header = request.headers.get("authorization") || "";
  const key = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!key.startsWith("cfk_")) return null;
  const { data, error } = await db.from("agent_keys").select("id, household_id, name")
    .eq("key_hash", hashAgentKey(key)).is("revoked_at", null).maybeSingle();
  if (error || !data) return null;
  await db.from("agent_keys").update({ last_used_at: new Date().toISOString() }).eq("id", data.id);
  return { householdId: String(data.household_id), keyName: String(data.name) };
}
