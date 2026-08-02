import seedData from "@/data/seed-data.json";
import { getRawDb } from "./index";

const SEED_VERSION = "2026-08-02-v1";

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS app_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS card_types (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    issuer TEXT NOT NULL DEFAULT 'Other',
    kind TEXT NOT NULL DEFAULT 'personal',
    annual_fee INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner TEXT NOT NULL,
    card_type_id INTEGER NOT NULL,
    kind TEXT NOT NULL,
    card_index TEXT,
    applied_on TEXT,
    approved_on TEXT,
    opened_how TEXT,
    offer TEXT,
    annual_fee INTEGER NOT NULL DEFAULT 0,
    bonus_received INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending',
    closed_on TEXT,
    closed_how TEXT,
    source_row INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (card_type_id) REFERENCES card_types(id)
  )`,
  `CREATE TABLE IF NOT EXISTS benefits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    card_type_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    amount INTEGER NOT NULL DEFAULT 0,
    frequency TEXT NOT NULL DEFAULT 'calendar year',
    FOREIGN KEY (card_type_id) REFERENCES card_types(id)
  )`,
  `CREATE TABLE IF NOT EXISTS benefit_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL,
    benefit_id INTEGER NOT NULL,
    period_key TEXT NOT NULL,
    used INTEGER NOT NULL DEFAULT 0,
    used_on TEXT,
    FOREIGN KEY (account_id) REFERENCES accounts(id),
    FOREIGN KEY (benefit_id) REFERENCES benefits(id),
    UNIQUE(account_id, benefit_id, period_key)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_accounts_owner_status ON accounts(owner, status)`,
  `CREATE INDEX IF NOT EXISTS idx_accounts_card_type_status ON accounts(card_type_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_usage_period ON benefit_usage(period_key, used)`,
];

type SeedAccount = (typeof seedData.accounts)[number];

function normalizedName(name: string) {
  const cleaned = name.trim().toLowerCase().replace(/\s+/g, " ");
  if (cleaned === "vx") return "venture x";
  if (cleaned === "strata premier") return "citi premier";
  return cleaned;
}

function displayName(name: string) {
  return normalizedName(name)
    .split(" ")
    .map((word) => word === "aa" || word === "ibp" || word === "cic" || word === "ciu" || word === "csr" || word === "csp" || word === "cfu" || word === "cff" || word === "bbp" ? word.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function issuerFor(name: string) {
  const key = normalizedName(name);
  if (/^(biz plat|biz gold|biz green|bbp|delta|hh |amex)/.test(key)) return "American Express";
  if (/^(cic|ciu|csr|csp|cfu|cff|united)/.test(key)) return "Chase";
  if (/^(citi|aa mileup)/.test(key)) return "Citi";
  if (/^(aa biz|aa aviator|jetblue|wyndham)/.test(key)) return "Barclays";
  if (/^(venture)/.test(key)) return "Capital One";
  if (/^(al biz|ha biz)/.test(key)) return "Bank of America";
  if (/^(ibp)/.test(key)) return "Chase";
  if (/^(redcard)/.test(key)) return "Target";
  return "Other";
}

function accountStatus(account: SeedAccount) {
  if (account.approvedOn) return account.closedOn ? "closed" : "active";
  const note = account.closedHow.toLowerCase();
  if (!account.closedOn || note.includes("pending") || note.includes("review")) return "pending";
  return "declined";
}

export function currentPeriodKey(frequency: string, date = new Date()) {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const normalized = frequency.toLowerCase();
  if (normalized.includes("month")) return `${year}-${String(month).padStart(2, "0")}`;
  if (normalized.includes("quarter")) return `${year}-Q${Math.ceil(month / 3)}`;
  if (normalized.includes("biannual")) return `${year}-H${month <= 6 ? 1 : 2}`;
  if (normalized.includes("anniversary")) return `${year}-anniversary`;
  return String(year);
}

async function runBatches(db: D1Database, statements: D1PreparedStatement[], size = 50) {
  for (let index = 0; index < statements.length; index += size) {
    await db.batch(statements.slice(index, index + size));
  }
}

export async function ensureDatabase() {
  const db = getRawDb();
  await db.batch(schemaStatements.map((statement) => db.prepare(statement)));
  const seeded = await db.prepare("SELECT value FROM app_meta WHERE key = ?").bind("seed_version").first<{ value: string }>();
  if (seeded?.value === SEED_VERSION) return db;

  const latestByCard = new Map<string, SeedAccount>();
  for (const account of seedData.accounts) latestByCard.set(normalizedName(account.card), account);
  const creditCards = seedData.creditDefinitions.map((credit) => normalizedName(credit.card));
  const allCardKeys = new Set([...latestByCard.keys(), ...creditCards]);

  await runBatches(db, [...allCardKeys].map((key) => {
    const latest = latestByCard.get(key);
    const kind = latest?.kind === "other" ? "personal" : (latest?.kind || "personal");
    return db.prepare(
      "INSERT OR IGNORE INTO card_types (name, issuer, kind, annual_fee) VALUES (?, ?, ?, ?)",
    ).bind(displayName(key), issuerFor(key), kind, latest?.annualFee ?? 0);
  }));

  const cardRows = await db.prepare("SELECT id, name FROM card_types").all<{ id: number; name: string }>();
  const cardIds = new Map(cardRows.results.map((row) => [normalizedName(row.name), row.id]));

  const existingAccounts = await db.prepare("SELECT COUNT(*) AS count FROM accounts").first<{ count: number }>();
  if (!existingAccounts?.count) {
    await runBatches(db, seedData.accounts.map((account) => db.prepare(
      `INSERT INTO accounts (
        owner, card_type_id, kind, card_index, applied_on, approved_on, opened_how,
        offer, annual_fee, bonus_received, status, closed_on, closed_how, source_row
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      displayName(account.owner), cardIds.get(normalizedName(account.card)), account.kind,
      account.cardIndex || null, account.appliedOn || null, account.approvedOn || null,
      account.openedHow || null, account.offer || null, account.annualFee,
      account.bonusReceived ? 1 : 0, accountStatus(account), account.closedOn || null,
      account.closedHow || null, account.sourceRow,
    )));
  }

  const existingBenefits = await db.prepare("SELECT COUNT(*) AS count FROM benefits").first<{ count: number }>();
  if (!existingBenefits?.count) {
    await runBatches(db, seedData.creditDefinitions.map((credit) => db.prepare(
      "INSERT INTO benefits (card_type_id, name, amount, frequency) VALUES (?, ?, ?, ?)",
    ).bind(cardIds.get(normalizedName(credit.card)), displayName(credit.credit), credit.amount, credit.frequency)));

    const benefitRows = await db.prepare(
      `SELECT b.id, b.card_type_id AS cardTypeId, b.frequency, b.name
       FROM benefits b ORDER BY b.id`,
    ).all<{ id: number; cardTypeId: number; frequency: string; name: string }>();
    const activeRows = await db.prepare(
      "SELECT id, card_type_id AS cardTypeId FROM accounts WHERE status = 'active' ORDER BY approved_on, id",
    ).all<{ id: number; cardTypeId: number }>();
    const usageStatements: D1PreparedStatement[] = [];
    for (const [index, benefit] of benefitRows.results.entries()) {
      const source = seedData.creditDefinitions[index];
      const match = source.currentYear.match(/(\d+)\s*\/\s*(\d+)/);
      const usedCount = match ? Number(match[1]) : 0;
      const sourcePrefix = source.currentYear.toLowerCase();
      let period = currentPeriodKey(benefit.frequency);
      if (sourcePrefix.startsWith("h1")) period = "2026-H1";
      if (sourcePrefix.startsWith("h2")) period = "2026-H2";
      if (sourcePrefix.startsWith("q1")) period = "2026-Q1";
      if (sourcePrefix.startsWith("q2")) period = "2026-Q2";
      if (sourcePrefix.startsWith("q3")) period = "2026-Q3";
      if (sourcePrefix.startsWith("q4")) period = "2026-Q4";
      const eligible = activeRows.results.filter((account) => account.cardTypeId === benefit.cardTypeId);
      eligible.forEach((account, accountIndex) => {
        const used = accountIndex < usedCount;
        usageStatements.push(db.prepare(
          "INSERT OR IGNORE INTO benefit_usage (account_id, benefit_id, period_key, used, used_on) VALUES (?, ?, ?, ?, ?)",
        ).bind(account.id, benefit.id, period, used ? 1 : 0, used ? "2026-08-02" : null));
      });
    }
    await runBatches(db, usageStatements);
  }

  await db.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)").bind("seed_version", SEED_VERSION).run();
  await db.prepare("PRAGMA optimize").run();
  return db;
}

export async function readAppData() {
  const db = await ensureDatabase();
  const [accounts, cardTypes, benefits, usages] = await Promise.all([
    db.prepare(
      `SELECT a.id, a.owner, a.card_type_id AS cardTypeId, ct.name AS cardName,
       ct.issuer, a.kind, a.card_index AS cardIndex, a.applied_on AS appliedOn,
       a.approved_on AS approvedOn, a.opened_how AS openedHow, a.offer,
       a.annual_fee AS annualFee, a.bonus_received AS bonusReceived,
       a.status, a.closed_on AS closedOn, a.closed_how AS closedHow
       FROM accounts a JOIN card_types ct ON ct.id = a.card_type_id
       ORDER BY COALESCE(a.approved_on, a.applied_on) DESC, a.id DESC`,
    ).all(),
    db.prepare(
      `SELECT ct.id, ct.name, ct.issuer, ct.kind, ct.annual_fee AS annualFee,
       COUNT(DISTINCT a.id) AS accountCount, COUNT(DISTINCT b.id) AS benefitCount
       FROM card_types ct
       LEFT JOIN accounts a ON a.card_type_id = ct.id
       LEFT JOIN benefits b ON b.card_type_id = ct.id
       GROUP BY ct.id ORDER BY ct.name`,
    ).all(),
    db.prepare(
      `SELECT b.id, b.card_type_id AS cardTypeId, ct.name AS cardName,
       b.name, b.amount, b.frequency
       FROM benefits b JOIN card_types ct ON ct.id = b.card_type_id
       ORDER BY ct.name, b.name`,
    ).all(),
    db.prepare(
      `SELECT u.id, u.account_id AS accountId, u.benefit_id AS benefitId,
       u.period_key AS periodKey, u.used, u.used_on AS usedOn
       FROM benefit_usage u`,
    ).all(),
  ]);
  return {
    accounts: accounts.results,
    cardTypes: cardTypes.results,
    benefits: benefits.results,
    usages: usages.results,
    source: { spreadsheetId: seedData.sourceSpreadsheetId, migratedAt: seedData.migratedAt },
  };
}

