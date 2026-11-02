-- Members marked hide_investments don't see brokerage logins in plaid_item_status either:
-- a login with investment accounts and no other account is left out for them (the same rule
-- GET /api/plaid uses). The view runs as its owner, so the subqueries see every account.

create or replace view public.plaid_item_status with (security_barrier = true) as
  select i.id, i.household_id, i.institution_name, i.status, i.error_code, i.consent_expires_at,
         i.last_synced_at, i.transactions_status, i.synced_products, i.created_at, i.person_id
  from public.plaid_items i
  where public.is_cardfolio_member(i.household_id)
    and (
      public.cardfolio_can_see_investments(i.household_id)
      or not exists (select 1 from public.plaid_accounts a where a.item_id = i.id and a.type = 'investment')
      or exists (select 1 from public.plaid_accounts a where a.item_id = i.id and a.type is distinct from 'investment')
    );
