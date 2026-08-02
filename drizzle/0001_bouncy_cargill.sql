PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_accounts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner` text NOT NULL,
	`card_type_id` integer NOT NULL,
	`kind` text NOT NULL,
	`card_index` text,
	`applied_on` text,
	`approved_on` text,
	`opened_how` text,
	`offer` text,
	`annual_fee` integer DEFAULT 0 NOT NULL,
	`bonus_received` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`closed_on` text,
	`closed_how` text,
	`source_row` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`card_type_id`) REFERENCES `card_types`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_accounts`("id", "owner", "card_type_id", "kind", "card_index", "applied_on", "approved_on", "opened_how", "offer", "annual_fee", "bonus_received", "status", "closed_on", "closed_how", "source_row", "created_at") SELECT "id", "owner", "card_type_id", "kind", "card_index", "applied_on", "approved_on", "opened_how", "offer", "annual_fee", "bonus_received", "status", "closed_on", "closed_how", "source_row", "created_at" FROM `accounts`;--> statement-breakpoint
DROP TABLE `accounts`;--> statement-breakpoint
ALTER TABLE `__new_accounts` RENAME TO `accounts`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_accounts_owner_status` ON `accounts` (`owner`,`status`);--> statement-breakpoint
CREATE INDEX `idx_accounts_card_type_status` ON `accounts` (`card_type_id`,`status`);--> statement-breakpoint
CREATE TABLE `__new_benefit_usage` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` integer NOT NULL,
	`benefit_id` integer NOT NULL,
	`period_key` text NOT NULL,
	`used` integer DEFAULT false NOT NULL,
	`used_on` text,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`benefit_id`) REFERENCES `benefits`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_benefit_usage`("id", "account_id", "benefit_id", "period_key", "used", "used_on") SELECT "id", "account_id", "benefit_id", "period_key", "used", "used_on" FROM `benefit_usage`;--> statement-breakpoint
DROP TABLE `benefit_usage`;--> statement-breakpoint
ALTER TABLE `__new_benefit_usage` RENAME TO `benefit_usage`;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_usage_account_benefit_period` ON `benefit_usage` (`account_id`,`benefit_id`,`period_key`);--> statement-breakpoint
CREATE INDEX `idx_usage_period` ON `benefit_usage` (`period_key`,`used`);--> statement-breakpoint
CREATE TABLE `__new_benefits` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`card_type_id` integer NOT NULL,
	`name` text NOT NULL,
	`amount` integer DEFAULT 0 NOT NULL,
	`frequency` text DEFAULT 'calendar year' NOT NULL,
	FOREIGN KEY (`card_type_id`) REFERENCES `card_types`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_benefits`("id", "card_type_id", "name", "amount", "frequency") SELECT "id", "card_type_id", "name", "amount", "frequency" FROM `benefits`;--> statement-breakpoint
DROP TABLE `benefits`;--> statement-breakpoint
ALTER TABLE `__new_benefits` RENAME TO `benefits`;