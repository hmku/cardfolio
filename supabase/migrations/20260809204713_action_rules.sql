create table if not exists public.action_rules (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null,
  action_code text not null,
  priority integer not null default 100 check (priority >= 0),
  enabled boolean not null default true,
  conditions jsonb not null default '{}'::jsonb check (jsonb_typeof(conditions) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (household_id, name),
  unique (household_id, id)
);

create index if not exists idx_action_rules_household_priority
  on public.action_rules(household_id, enabled, priority, created_at);

alter table public.action_rules enable row level security;

grant select, insert, update, delete on public.action_rules to authenticated, service_role;

create policy "members manage action rules"
  on public.action_rules for all
  using (public.is_cardfolio_member(household_id))
  with check (public.is_cardfolio_member(household_id));

insert into public.action_rules (household_id, name, action_code, priority, conditions)
select id, 'Annual fee review', 'CLOSE', 10,
  '{"requiresOpen":true,"approvalAgeMin":181,"annualFeeMin":1,"anniversaryBeforeDays":19,"anniversaryAfterDays":59}'::jsonb
from public.households
where slug = 'primary'
on conflict (household_id, name) do nothing;

insert into public.action_rules (household_id, name, action_code, priority, conditions)
select id, 'Amex no-lifetime-language window', 'NLL', 20,
  '{"cardNames":["Amex Biz Plat","Amex Biz Gold"],"approvalAgeMin":80,"approvalAgeMax":100}'::jsonb
from public.households
where slug = 'primary'
on conflict (household_id, name) do nothing;

insert into public.action_rules (household_id, name, action_code, priority, conditions)
select id, 'Chase Ink Cash velocity window', 'CIC', 30,
  '{"cardNames":["CIC"],"approvalAgeMin":85,"approvalAgeMax":110}'::jsonb
from public.households
where slug = 'primary'
on conflict (household_id, name) do nothing;

insert into public.action_rules (household_id, name, action_code, priority, conditions)
select id, 'Target RedCard reapply window', 'TARGET', 40,
  '{"cardNames":["RedCard"],"closureAgeMin":60,"closureAgeMax":150,"latestCardOnly":true}'::jsonb
from public.households
where slug = 'primary'
on conflict (household_id, name) do nothing;
