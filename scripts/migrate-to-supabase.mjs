import { createClient } from "@supabase/supabase-js";

const householdId = "00000000-0000-4000-8000-00000000cafd";

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

async function upsertInChunks(db, table, rows, onConflict = "id") {
  for (let index = 0; index < rows.length; index += 100) {
    const { error } = await db.from(table).upsert(rows.slice(index, index + 100), { onConflict });
    if (error) throw new Error(`${table}: ${error.message}`);
  }
}

async function loadSource() {
  const sourceUrl = required("SOURCE_SITE_URL").replace(/\/$/, "");
  const token = required("SOURCE_SITE_BYPASS_TOKEN");
  const response = await fetch(`${sourceUrl}/api/data`, {
    headers: { "OAI-Sites-Authorization": `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(`Source export failed (${response.status})`);
  return response.json();
}

const source = await loadSource();
const db = createClient(required("NEXT_PUBLIC_SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { autoRefreshToken: false, persistSession: false },
});

await upsertInChunks(db, "card_types", source.cardTypes.map((card) => ({
  id: card.id,
  household_id: householdId,
  name: card.name,
  issuer: card.issuer,
  kind: card.kind,
  annual_fee: card.annualFee,
})));

await upsertInChunks(db, "accounts", source.accounts.map((account) => ({
  id: account.id,
  household_id: householdId,
  owner: account.owner,
  card_type_id: account.cardTypeId,
  kind: account.kind,
  card_index: account.cardIndex,
  applied_on: account.appliedOn,
  approved_on: account.approvedOn,
  opened_how: account.openedHow,
  offer: account.offer,
  annual_fee: account.annualFee,
  bonus_received: Boolean(account.bonusReceived),
  status: account.approvedOn ? (account.closedOn ? "closed" : "active") : account.status,
  closed_on: account.closedOn,
  closed_how: account.closedHow,
})));

await upsertInChunks(db, "benefits", source.benefits.map((benefit) => ({
  id: benefit.id,
  household_id: householdId,
  card_type_id: benefit.cardTypeId,
  name: benefit.name,
  amount: benefit.amount,
  frequency: benefit.frequency,
})));

await upsertInChunks(db, "benefit_usage", source.usages.map((usage) => ({
  id: usage.id,
  household_id: householdId,
  account_id: usage.accountId,
  benefit_id: usage.benefitId,
  period_key: usage.periodKey,
  used: Boolean(usage.used),
  used_on: usage.usedOn,
})));

const metadata = [
  { household_id: householdId, key: "source_spreadsheet_id", value: source.source?.spreadsheetId || "" },
  { household_id: householdId, key: "migrated_at", value: new Date().toISOString() },
  { household_id: householdId, key: "source_site_url", value: required("SOURCE_SITE_URL") },
];
const { error: metadataError } = await db.from("app_meta").upsert(metadata, { onConflict: "household_id,key" });
if (metadataError) throw metadataError;
const { error: sequenceError } = await db.rpc("reset_cardfolio_sequences");
if (sequenceError) throw sequenceError;

console.log(JSON.stringify({
  cardTypes: source.cardTypes.length,
  accounts: source.accounts.length,
  benefits: source.benefits.length,
  usages: source.usages.length,
}, null, 2));
