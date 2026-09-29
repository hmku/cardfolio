-- Cardholder initials used in card labels, matching the 1Password naming: "biz plat HK7".

alter table public.people add column if not exists code text
  check (code is null or code ~ '^[A-Z]{1,4}$');

update public.people set code = 'HK' where name = 'Harrison' and code is null;
update public.people set code = 'SL' where name = 'Sophia' and code is null;
