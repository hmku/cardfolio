-- Whose bank login a Plaid item is (picked when connecting). Card matching only considers
-- that person's cards, and the login's accounts default to that owner.

alter table public.plaid_items add column if not exists person_id bigint;
alter table public.plaid_items
  add constraint plaid_items_person_fkey foreign key (household_id, person_id)
    references public.people(household_id, id) on delete set null (person_id);

create or replace view public.plaid_item_status with (security_barrier = true) as
  select id, household_id, institution_name, status, error_code, consent_expires_at,
         last_synced_at, transactions_status, synced_products, created_at, person_id
  from public.plaid_items
  where public.is_cardfolio_member(household_id);
