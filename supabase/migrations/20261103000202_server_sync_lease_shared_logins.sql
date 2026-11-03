-- Server round 2.
--
-- sync_started_at: a per-login lease so two syncs of the same login (connect plus webhook,
-- the daily cron plus "Sync now") never run at once. db/plaid-sync.ts claims it with a
-- conditional update and clears it when done; a lease older than 5 minutes is treated as
-- abandoned (a crashed function).
--
-- ignored_accounts: Plaid account ids this login doesn't store because another connection of
-- the same bank login carries them (the login connected again for Investments, see
-- planLoginConnect in app/lib/core/finance.ts), so no account or transaction is counted twice.

alter table public.plaid_items
  add column if not exists sync_started_at timestamptz,
  add column if not exists ignored_accounts text[] not null default '{}';
