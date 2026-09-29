import { createSign } from "node:crypto";
import type { ExportTables } from "@/app/lib/core/export";

const TABS = ["tracker", "credits", "stats"] as const;

function settings() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, "\n");
  const spreadsheetId = process.env.CARDFOLIO_EXPORT_SPREADSHEET_ID;
  return email && key && spreadsheetId ? { email, key, spreadsheetId } : null;
}

export function googleSheetConfigured() {
  return Boolean(settings());
}

const base64url = (value: string | Buffer) => Buffer.from(value).toString("base64url");

/** Exchanges a signed service-account JWT for an access token (no Google SDK needed). */
async function accessToken(email: string, key: string) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(JSON.stringify({ iss: email, scope: "https://www.googleapis.com/auth/spreadsheets", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }));
  const signature = createSign("RSA-SHA256").update(`${header}.${claims}`).sign(key);
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${header}.${claims}.${base64url(signature)}` }),
  });
  const payload = await response.json() as { access_token?: string; error_description?: string };
  if (!response.ok || !payload.access_token) throw new Error(`Google sign-in failed: ${payload.error_description || response.status}`);
  return payload.access_token;
}

async function sheets(token: string, path: string, init?: RequestInit) {
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...init?.headers },
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(`Google Sheets error: ${payload?.error?.message || response.status}`);
  return payload;
}

/** Overwrites the tracker, credits and stats tabs of the export spreadsheet. */
export async function writeGoogleSheet(tables: ExportTables) {
  const config = settings();
  if (!config) throw new Response("The Google Sheet copy isn't set up yet", { status: 501 });
  const token = await accessToken(config.email, config.key);
  const id = encodeURIComponent(config.spreadsheetId);
  const meta = await sheets(token, `${id}?fields=sheets.properties.title`) as { sheets: { properties: { title: string } }[] };
  const existing = new Set(meta.sheets.map((sheet) => sheet.properties.title));
  const missing = TABS.filter((tab) => !existing.has(tab));
  if (missing.length) {
    await sheets(token, `${id}:batchUpdate`, { method: "POST", body: JSON.stringify({ requests: missing.map((title) => ({ addSheet: { properties: { title } } })) }) });
  }
  await sheets(token, `${id}/values:batchClear`, { method: "POST", body: JSON.stringify({ ranges: TABS.map((tab) => `${tab}!A:Z`) }) });
  await sheets(token, `${id}/values:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({ valueInputOption: "RAW", data: TABS.map((tab) => ({ range: `${tab}!A1`, values: tables[tab] })) }),
  });
}
