-- How each credit is tracked (Settings → Card types and credits):
--   track: tick it each period; `remind` decides whether it shows in To do and notifications.
--   auto:  always used, e.g. a recurring charge. Every period counts as used without ticking;
--          anything recorded for a period (a partial amount) takes precedence.
--   skip:  not using it. Hidden from Credits, To do, notifications and exports; its settings,
--          enrollment and history are kept so switching back restores everything.
-- `remind` is left as it was when switching to auto or skip, so switching back restores it.
alter table public.credits
  add column mode text not null default 'track' check (mode in ('track', 'auto', 'skip'));
