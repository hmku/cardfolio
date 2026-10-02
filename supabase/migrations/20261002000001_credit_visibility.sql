-- Hiding a credit retains its settings, enrollment and usage history.
alter table public.credits
  add column hidden boolean not null default false;

-- Clients hide and disable reminders atomically. Reject stale clients attempting
-- to re-enable reminders while a credit is hidden.
alter table public.credits
  add constraint credits_hidden_no_reminders check (not (hidden and remind));
