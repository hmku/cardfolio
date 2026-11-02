/**
 * Calls Cardfolio's own server routes (app/api/**) from the browser with the signed-in
 * person's token. Every caller gets the same safe parsing: a non-JSON reply (a Vercel 502
 * page, a timeout) becomes a readable message instead of a raw SyntaxError.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type ApiOptions = { method?: string; body?: unknown; /** Message when the server gives no error text. */ fallback?: string };
export type ApiCall = <T = Record<string, unknown>>(path: string, options?: ApiOptions) => Promise<T>;

/** The message to show for a failed call: the server's `error` text, else one based on the status. */
export function apiErrorMessage(payload: unknown, status: number, fallback = "Something went wrong. Try again.") {
  const error = payload && typeof payload === "object" && "error" in payload ? (payload as { error: unknown }).error : null;
  if (typeof error === "string" && error.trim()) return error;
  if (status === 401) return "Your sign-in has expired. Reload the page to sign in again.";
  if (status === 502 || status === 503 || status === 504) return "Cardfolio's server didn't answer in time. Try again in a minute.";
  return fallback;
}

/** An Error's message, or `fallback` for anything else that was thrown. */
export function errorText(reason: unknown, fallback: string) {
  return reason instanceof Error && reason.message ? reason.message : fallback;
}

export async function apiCall<T = Record<string, unknown>>(accessToken: string, path: string, options: ApiOptions = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: options.method || "GET",
      headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    throw new Error("Couldn't reach Cardfolio. Check your connection and try again.");
  }
  const payload: unknown = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(apiErrorMessage(payload, response.status, options.fallback));
  return payload as T;
}

/** An ApiCall that reads the current token from the Supabase session on every call, so token refreshes need no re-render. */
export function sessionApi(db: SupabaseClient): ApiCall {
  return async function call<T>(path: string, options?: ApiOptions): Promise<T> {
    const { data } = await db.auth.getSession();
    return apiCall<T>(data.session?.access_token ?? "", path, options);
  };
}
