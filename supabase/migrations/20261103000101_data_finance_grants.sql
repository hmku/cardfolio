-- Tighten table privileges on the finance tables.
--
-- 20261102000002 granted signed-in members only what the finance pages need (for example just
-- the user columns of transactions), but revoked Supabase's default grants from anon only.
-- Supabase's default privileges give `authenticated` ALL on every new public table, so members
-- could still update any transaction column (amount, date, account) under the update policy.
-- Revoke everything from authenticated and grant back exactly what is intended.

revoke all on public.categories, public.category_rules, public.transactions, public.securities,
  public.holdings, public.investment_transactions, public.manual_accounts, public.balance_snapshots
  from anon, authenticated;

-- Household lists and manual balance history: members manage them (row-level security limits
-- balance_snapshots writes to manual accounts).
grant select, insert, update, delete on public.categories, public.category_rules,
  public.manual_accounts, public.balance_snapshots to authenticated;

-- Synced Plaid data: read-only, except the user columns of transactions.
grant select on public.transactions, public.securities, public.holdings,
  public.investment_transactions to authenticated;
grant update (category_id, category_source, notes, excluded, reviewed) on public.transactions to authenticated;

-- Tables created by later migrations start closed to browser roles; grant what each needs.
alter default privileges in schema public revoke all on tables from anon, authenticated;

-- Guard: fail the migration if a member can still rewrite synced transaction data.
do $$
begin
  if has_column_privilege('authenticated', 'public.transactions', 'amount_cents', 'UPDATE')
    or has_column_privilege('authenticated', 'public.transactions', 'date', 'UPDATE')
    or has_column_privilege('authenticated', 'public.transactions', 'plaid_account_id', 'UPDATE')
    or has_table_privilege('authenticated', 'public.transactions', 'INSERT')
    or has_table_privilege('authenticated', 'public.transactions', 'DELETE')
    or has_table_privilege('authenticated', 'public.holdings', 'UPDATE') then
    raise exception 'authenticated still has write access to synced finance data';
  end if;
end;
$$;
