/**
 * Imports the Google Sheet's tracker and credits tabs into the v2 tables.
 *
 * Writes a single SQL transaction you can paste into the Supabase SQL editor
 * or run with psql. Nothing is sent anywhere by this script.
 *
 *   npm run db:import-sheet -- --snapshot data/sheet-snapshot.json > import.sql
 *   npm run db:import-sheet -- --tracker tracker.csv --credits credits.csv > import.sql
 *
 * Options:
 *   --replace         Delete the household's existing v2 data first (otherwise the SQL
 *                     refuses to run if any accounts exist).
 *   --today YYYY-MM-DD  Date used to guess which credits are used this period.
 */
import { readFileSync } from "node:fs";
import { parseDate } from "../app/lib/core/dates.ts";
import { planSheetImport, type SheetCreditRow, type SheetTrackerRow } from "../app/lib/core/sheet-import.ts";

const HOUSEHOLD_ID = "00000000-0000-4000-8000-00000000cafd";

function argument(name: string) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

/** Minimal RFC 4180 CSV parser (quoted fields, escaped quotes, CRLF). */
export function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { field += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { row.push(field); field = ""; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += char;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function loadRows(): { tracker: SheetTrackerRow[]; credits: SheetCreditRow[] } {
  const snapshot = argument("snapshot");
  if (snapshot) return JSON.parse(readFileSync(snapshot, "utf8"));
  const trackerPath = argument("tracker");
  const creditsPath = argument("credits");
  if (!trackerPath || !creditsPath) {
    console.error("Pass --snapshot <file.json>, or --tracker <tracker.csv> --credits <credits.csv> (File → Download → CSV for each tab).");
    process.exit(1);
  }
  // Columns follow the sheet: who, card, kind, card idx, applied, approved, opened how, sub / msr, af, sub, closed, closed how.
  const tracker = parseCsv(readFileSync(trackerPath, "utf8")).slice(1)
    .filter((cells) => cells[1]?.trim())
    .map(([who, card, kind, idx, applied, approved, how, offer, af, sub, closed, closedHow]) => ({ who, card, kind, idx, applied, approved, how, offer, af, sub, closed, closedHow }));
  // Columns: card, credit, amount, frequency, previous year, current year.
  const credits = parseCsv(readFileSync(creditsPath, "utf8")).slice(1)
    .filter((cells) => cells[0]?.trim())
    .map(([card, credit, amount, freq, , cur]) => ({ card, credit, amount, freq, cur }));
  return { tracker, credits };
}

const sql = (value: unknown): string => {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return `'${String(value).replace(/'/g, "''")}'`;
};
const values = (rows: unknown[][]) => rows.map((row) => `  (${row.map(sql).join(", ")})`).join(",\n");

function main() {
  const { tracker, credits } = loadRows();
  const today = parseDate(argument("today")) || new Date();
  const plan = planSheetImport(tracker, credits, today);
  const household = HOUSEHOLD_ID;

  const personIds = new Map(plan.people.map((name, index) => [name, index + 1]));
  const productIds = new Map(plan.products.map((product, index) => [product.slug, index + 1]));
  let holdingId = 0;
  const holdingIds = new Map<string, number>();
  const holdingRows: unknown[][] = [];
  const accountRows = plan.accounts.map((account, index) => {
    const accountId = index + 1;
    account.holdings.forEach((holding, holdingIndex) => {
      holdingIds.set(`${account.key}:${holdingIndex}`, ++holdingId);
      holdingRows.push([holdingId, household, accountId, personIds.get(account.person), productIds.get(holding.productSlug), holding.number, holding.startedOn, holding.endedOn, holding.change, holding.annualFeeCents]);
    });
    return [
      accountId, household, personIds.get(account.person), account.appliedOn, account.approvedOn, account.openedVia, account.status, account.closedOn,
      account.bonus?.amount ?? null, account.bonus?.unit ?? null, account.bonus?.spendCents ?? null, account.bonus?.months ?? null, account.bonusEarned, account.note, account.sourceRow,
    ];
  });
  const creditRows = plan.credits.map((credit, index) => [index + 1, household, productIds.get(credit.productSlug), credit.name, credit.amountCents, credit.cadence, credit.remind, credit.sort]);
  const useRows = plan.credits.flatMap((credit, index) => credit.used.map((use) => [household, index + 1, holdingIds.get(`${use.accountKey}:${use.holdingIndex}`), use.periodKey, credit.amountCents, "sheet import", "import"]));
  const optOutRows = plan.credits.flatMap((credit, index) => credit.optOuts.map((optOut) => [household, index + 1, holdingIds.get(`${optOut.accountKey}:${optOut.holdingIndex}`)]));

  const replace = process.argv.includes("--replace");
  const statements = [
    "-- Generated by scripts/import-sheet.ts",
    ...plan.warnings.map((warning) => `-- Note: ${warning}`),
    "begin;",
    replace
      ? ["credit_opt_outs", "credit_uses", "credits", "account_products", "accounts", "products", "people"].map((table) => `delete from public.${table} where household_id = ${sql(household)};`).join("\n")
      : `do $$ begin if exists (select 1 from public.accounts where household_id = ${sql(household)}) then raise exception 'Cardfolio already has accounts. Re-run the import with --replace to overwrite them.'; end if; end $$;`,
    `insert into public.people (id, household_id, name, code, sort) values\n${values(plan.people.map((name, index) => [index + 1, household, name, plan.personCodes[name] ?? null, index]))};`,
    `insert into public.products (id, household_id, slug, name, short_name, issuer, kind, annual_fee_cents) values\n${values(plan.products.map((product, index) => [index + 1, household, product.slug, product.name, product.shortName, product.issuer, product.kind, product.annualFeeCents]))};`,
    `insert into public.accounts (id, household_id, person_id, applied_on, approved_on, opened_via, status, closed_on, bonus_amount, bonus_unit, bonus_spend_cents, bonus_months, bonus_earned, note, source_row) values\n${values(accountRows)};`,
    `insert into public.account_products (id, household_id, account_id, person_id, product_id, number, started_on, ended_on, change, annual_fee_cents) values\n${values(holdingRows)};`,
    creditRows.length ? `insert into public.credits (id, household_id, product_id, name, amount_cents, cadence, remind, sort) values\n${values(creditRows)};` : "",
    useRows.length ? `insert into public.credit_uses (household_id, credit_id, account_product_id, period_key, amount_cents, recorded_by, source) values\n${values(useRows)};` : "",
    optOutRows.length ? `insert into public.credit_opt_outs (household_id, credit_id, account_product_id) values\n${values(optOutRows)};` : "",
    `insert into public.app_meta (household_id, key, value) values (${sql(household)}, 'sheet_imported_at', ${sql(new Date().toISOString())}) on conflict (household_id, key) do update set value = excluded.value;`,
    "select public.reset_cardfolio_sequences();",
    "commit;",
  ].filter(Boolean);
  process.stdout.write(`${statements.join("\n\n")}\n`);
  console.error(`Planned ${plan.accounts.length} accounts, ${holdingRows.length} card products, ${creditRows.length} credits, ${useRows.length} credit uses.`);
  for (const warning of plan.warnings) console.error(`• ${warning}`);
}

if (process.argv[1]?.endsWith("import-sheet.ts")) main();
