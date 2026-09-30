-- Agent (MCP) access was removed for now; agents update Cardfolio through the web app instead.
-- The cardfolio_* write functions from 20260930000001_agent_api stay: the app uses them.
-- To bring agent access back, see TODO.md (it restores these tables from that migration).

drop table if exists public.change_log;
drop table if exists public.agent_keys;

alter table public.credit_uses drop constraint if exists credit_uses_source_check;
alter table public.credit_uses add constraint credit_uses_source_check check (source in ('manual', 'import', 'plaid'));
