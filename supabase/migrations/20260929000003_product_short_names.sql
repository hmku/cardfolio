-- Optional short card name override. When empty, the app shows the slug, which is the
-- abbreviation from the original sheet ("biz plat", "csr", "delta biz gold").

alter table public.products add column if not exists short_name text
  check (short_name is null or length(trim(short_name)) > 0);
