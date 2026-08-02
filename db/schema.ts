import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const cardTypes = sqliteTable(
  "card_types",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    issuer: text("issuer").notNull().default("Other"),
    kind: text("kind").notNull().default("personal"),
    annualFee: integer("annual_fee").notNull().default(0),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [uniqueIndex("idx_card_types_name").on(table.name)],
);

export const accounts = sqliteTable(
  "accounts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    owner: text("owner").notNull(),
    cardTypeId: integer("card_type_id").notNull().references(() => cardTypes.id),
    kind: text("kind").notNull(),
    cardIndex: text("card_index"),
    appliedOn: text("applied_on"),
    approvedOn: text("approved_on"),
    openedHow: text("opened_how"),
    offer: text("offer"),
    annualFee: integer("annual_fee").notNull().default(0),
    bonusReceived: integer("bonus_received", { mode: "boolean" }).notNull().default(false),
    status: text("status").notNull().default("pending"),
    closedOn: text("closed_on"),
    closedHow: text("closed_how"),
    sourceRow: integer("source_row"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_accounts_owner_status").on(table.owner, table.status),
    index("idx_accounts_card_type_status").on(table.cardTypeId, table.status),
    uniqueIndex("idx_accounts_source_row").on(table.sourceRow),
  ],
);

export const benefits = sqliteTable("benefits", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  cardTypeId: integer("card_type_id").notNull().references(() => cardTypes.id),
  name: text("name").notNull(),
  amount: integer("amount").notNull().default(0),
  frequency: text("frequency").notNull().default("calendar year"),
});

export const benefitUsage = sqliteTable(
  "benefit_usage",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    accountId: integer("account_id").notNull().references(() => accounts.id),
    benefitId: integer("benefit_id").notNull().references(() => benefits.id),
    periodKey: text("period_key").notNull(),
    used: integer("used", { mode: "boolean" }).notNull().default(false),
    usedOn: text("used_on"),
  },
  (table) => [
    uniqueIndex("idx_usage_account_benefit_period").on(table.accountId, table.benefitId, table.periodKey),
    index("idx_usage_period").on(table.periodKey, table.used),
  ],
);
