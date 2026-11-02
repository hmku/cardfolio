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

  const issuedAt = Number(claims.iat);
  if (!Number.isFinite(issuedAt) || now / 1000 - issuedAt > MAX_AGE_SECONDS) return { ok: false, reason: "too old" };

  const expected = Buffer.from(createHash("sha256").update(body, "utf8").digest("hex"));
  const claimed = Buffer.from(String(claims.request_body_sha256 || ""));
  if (expected.length !== claimed.length || !timingSafeEqual(expected, claimed)) return { ok: false, reason: "body doesn't match" };
  return { ok: true };
}
