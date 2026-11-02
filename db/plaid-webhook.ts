import { createHash, createPublicKey, timingSafeEqual, verify, type JsonWebKey } from "node:crypto";

/**
 * Verifies Plaid's `Plaid-Verification` header: an ES256 JWT whose key comes from
 * /webhook_verification_key/get (by the JWT's `kid`), issued at most 5 minutes ago, whose
 * `request_body_sha256` is the SHA-256 of the exact request body. No imports beyond
 * node:crypto so the tests can run it directly.
 */

export type WebhookKey = JsonWebKey & { kid?: string; expired_at?: number | null };

const MAX_AGE_SECONDS = 5 * 60;

function decodePart(part: string) {
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<string, unknown>;
}

export async function verifyPlaidWebhook(
  body: string,
  token: string | null,
  fetchKey: (kid: string) => Promise<WebhookKey | null>,
  now = Date.now(),
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!token) return { ok: false, reason: "missing Plaid-Verification header" };
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed JWT" };
  let header: Record<string, unknown>;
  let claims: Record<string, unknown>;
  try {
    header = decodePart(parts[0]);
    claims = decodePart(parts[1]);
  } catch {
    return { ok: false, reason: "malformed JWT" };
  }
  if (header.alg !== "ES256") return { ok: false, reason: "unexpected algorithm" };
  if (typeof header.kid !== "string" || !header.kid) return { ok: false, reason: "missing key id" };
  // The claims aren't verified yet, but a stale iat is a cheap reason to stop before any key
  // lookup; the signature check below covers forged ones.
  const issuedAt = Number(claims.iat);
  if (!Number.isFinite(issuedAt) || now / 1000 - issuedAt > MAX_AGE_SECONDS) return { ok: false, reason: "too old" };

  const key = await fetchKey(header.kid);
  if (!key) return { ok: false, reason: "unknown key" };
  if (key.expired_at && key.expired_at * 1000 < now) return { ok: false, reason: "expired key" };

  let valid = false;
  try {
    const publicKey = createPublicKey({ key: { kty: key.kty, crv: key.crv, x: key.x, y: key.y }, format: "jwk" });
    valid = verify("sha256", Buffer.from(`${parts[0]}.${parts[1]}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(parts[2], "base64url"));
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, reason: "bad signature" };

  const expected = Buffer.from(createHash("sha256").update(body, "utf8").digest("hex"));
  const claimed = Buffer.from(String(claims.request_body_sha256 || ""));
  if (expected.length !== claimed.length || !timingSafeEqual(expected, claimed)) return { ok: false, reason: "body doesn't match" };
  return { ok: true };
}

const KEY_TTL_MS = 24 * 60 * 60 * 1000;
const UNKNOWN_KID_TTL_MS = 5 * 60 * 1000;
const MAX_UNKNOWN_KIDS = 1000;

/**
 * Caches verification keys by kid: a key is re-fetched after a day, or sooner once Plaid has
 * marked it expired, and a kid Plaid didn't know is remembered for a few minutes so repeated
 * junk requests don't each cost a Plaid call. `lookup` returns null for an unknown kid and
 * throws for a failed call (e.g. rate limited), which isn't remembered.
 */
export function webhookKeyCache(lookup: (kid: string) => Promise<WebhookKey | null>, clock: () => number = Date.now) {
  const keys = new Map<string, { key: WebhookKey; fetchedAt: number }>();
  const unknown = new Map<string, number>();
  return async (kid: string): Promise<WebhookKey | null> => {
    const now = clock();
    const cached = keys.get(kid);
    if (cached && !cached.key.expired_at && now - cached.fetchedAt < KEY_TTL_MS) return cached.key;
    const missedAt = unknown.get(kid);
    if (missedAt !== undefined && now - missedAt < UNKNOWN_KID_TTL_MS) return null;
    let key: WebhookKey | null;
    try {
      key = await lookup(kid);
    } catch {
      return cached?.key ?? null;
    }
    if (!key) {
      if (unknown.size >= MAX_UNKNOWN_KIDS) unknown.clear();
      unknown.set(kid, now);
      keys.delete(kid);
      return null;
    }
    unknown.delete(kid);
    keys.set(kid, { key, fetchedAt: now });
    return key;
  };
}
