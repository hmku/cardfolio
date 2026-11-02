import assert from "node:assert/strict";
import test from "node:test";
import { apiCall, apiErrorMessage, errorText } from "../app/lib/api.ts";

test("apiErrorMessage prefers the server's error text, then the status", () => {
  assert.equal(apiErrorMessage({ error: "Not a member" }, 403), "Not a member");
  assert.match(apiErrorMessage({}, 504), /didn't answer/);
  assert.match(apiErrorMessage(null, 401), /sign-in has expired/);
  assert.equal(apiErrorMessage({ error: "" }, 500, "Couldn't send the invitation."), "Couldn't send the invitation.");
  assert.equal(errorText("boom", "Fallback"), "Fallback");
  assert.equal(errorText(new Error("Real"), "Fallback"), "Real");
});

test("apiCall turns an HTML error page into a readable message and sends the token", async (t) => {
  const calls: { url: string; init: RequestInit }[] = [];
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return url === "/ok"
      ? new Response(JSON.stringify({ value: 1 }), { status: 200 })
      : new Response("<!DOCTYPE html><title>Bad gateway</title>", { status: 502 });
  });
  assert.deepEqual(await apiCall("token-1", "/ok", { method: "POST", body: { a: 1 } }), { value: 1 });
  assert.equal((calls[0].init.headers as Record<string, string>).authorization, "Bearer token-1");
  assert.equal(calls[0].init.body, JSON.stringify({ a: 1 }));
  await assert.rejects(apiCall("token-1", "/broken"), /didn't answer in time/);
});

test("apiCall reports a network failure plainly", async (t) => {
  t.mock.method(globalThis, "fetch", async () => { throw new TypeError("Failed to fetch"); });
  await assert.rejects(apiCall("token", "/api/session"), /Couldn't reach Cardfolio/);
});
