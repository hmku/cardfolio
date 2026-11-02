-- Members marked hide_investments (e.g. a test account) can't see investment accounts: Plaid
-- accounts of type 'investment' (brokerage, IRA, 401(k)…), their holdings, investment
-- transactions, transactions and balance history, and manual accounts of an investment
-- kind. Enforced here with row-level security, so the browser can't get around it.

alter table public.household_members add column if not exists hide_investments boolean not null default false;

create or replace function public.cardfolio_can_see_investments(target_household_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.household_members
    where household_id = target_household_id and user_id = auth.uid() and not hide_investments
  );
$$;

revoke all on function public.cardfolio_can_see_investments(uuid) from public, anon;
grant execute on function public.cardfolio_can_see_investments(uuid) to authenticated, service_role;

create or replace function public.cardfolio_is_investment_kind(kind text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select kind in ('investment', 'private_investment', 'retirement', 'crypto');
$$;

-- Plaid accounts.
drop policy "members read plaid accounts" on public.plaid_accounts;
drop policy "members update plaid accounts" on public.plaid_accounts;
create policy "members read plaid accounts" on public.plaid_accounts for select
  using (public.is_cardfolio_member(household_id)
    and (type is distinct from 'investment' or public.cardfolio_can_see_investments(household_id)));
create policy "members update plaid accounts" on public.plaid_accounts for update
  using (public.is_cardfolio_member(household_id)
    and (type is distinct from 'investment' or public.cardfolio_can_see_investments(household_id)))
  with check (public.is_cardfolio_member(household_id));

-- Transactions follow their account's visibility (the subquery is itself filtered by the
-- plaid_accounts policy above).
drop policy "members read transactions" on public.transactions;
drop policy "members update transactions" on public.transactions;
create policy "members read transactions" on public.transactions for select
  using (public.is_cardfolio_member(household_id)
    and exists (select 1 from public.plaid_accounts a where a.id = transactions.plaid_account_id));
create policy "members update transactions" on public.transactions for update
  using (public.is_cardfolio_member(household_id)
    and exists (select 1 from public.plaid_accounts a where a.id = transactions.plaid_account_id))
  with check (public.is_cardfolio_member(household_id));

-- Investment data.
drop policy "members read securities" on public.securities;
drop policy "members read holdings" on public.holdings;
drop policy "members read investment transactions" on public.investment_transactions;
create policy "members read securities" on public.securities for select
  using (public.cardfolio_can_see_investments(household_id));
create policy "members read holdings" on public.holdings for select
  using (public.cardfolio_can_see_investments(household_id));
create policy "members read investment transactions" on public.investment_transactions for select
  using (public.cardfolio_can_see_investments(household_id));

-- Manual accounts of an investment kind.
drop policy "members manage manual accounts" on public.manual_accounts;
create policy "members manage manual accounts" on public.manual_accounts for all
  using (public.is_cardfolio_member(household_id)
    and (not public.cardfolio_is_investment_kind(kind) or public.cardfolio_can_see_investments(household_id)))
  with check (public.is_cardfolio_member(household_id)
    and (not public.cardfolio_is_investment_kind(kind) or public.cardfolio_can_see_investments(household_id)));

-- Balance history follows its account (both subqueries are filtered by the policies above).
drop policy "members read balance snapshots" on public.balance_snapshots;
drop policy "members add manual snapshots" on public.balance_snapshots;
drop policy "members change manual snapshots" on public.balance_snapshots;
drop policy "members delete manual snapshots" on public.balance_snapshots;
create policy "members read balance snapshots" on public.balance_snapshots for select
  using (public.is_cardfolio_member(household_id) and (
    exists (select 1 from public.plaid_accounts a where a.id = balance_snapshots.plaid_account_id)
    or exists (select 1 from public.manual_accounts m where m.id = balance_snapshots.manual_account_id)));
create policy "members add manual snapshots" on public.balance_snapshots for insert
  with check (public.is_cardfolio_member(household_id)
    and exists (select 1 from public.manual_accounts m where m.id = balance_snapshots.manual_account_id));
create policy "members change manual snapshots" on public.balance_snapshots for update
  using (public.is_cardfolio_member(household_id)
    and exists (select 1 from public.manual_accounts m where m.id = balance_snapshots.manual_account_id))
  with check (public.is_cardfolio_member(household_id)
    and exists (select 1 from public.manual_accounts m where m.id = balance_snapshots.manual_account_id));
create policy "members delete manual snapshots" on public.balance_snapshots for delete
  using (public.is_cardfolio_member(household_id)
    and exists (select 1 from public.manual_accounts m where m.id = balance_snapshots.manual_account_id));
