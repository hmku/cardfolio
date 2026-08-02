CREATE TABLE `accounts` (
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
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `benefit_usage` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` integer NOT NULL,
	`benefit_id` integer NOT NULL,
	`period_key` text NOT NULL,
	`used` integer DEFAULT false NOT NULL,
	`used_on` text
);
--> statement-breakpoint
CREATE TABLE `benefits` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`card_type_id` integer NOT NULL,
	`name` text NOT NULL,
	`amount` integer DEFAULT 0 NOT NULL,
	`frequency` text DEFAULT 'calendar year' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `card_types` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`issuer` text DEFAULT 'Other' NOT NULL,
	`kind` text DEFAULT 'personal' NOT NULL,
	`annual_fee` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_card_types_name` ON `card_types` (`name`);