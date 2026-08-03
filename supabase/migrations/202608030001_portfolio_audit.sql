alter table public.accounts
  add column if not exists bonus_amount text,
  add column if not exists spend_requirement integer check (spend_requirement is null or spend_requirement >= 0),
  add column if not exists bonus_period_months integer check (bonus_period_months is null or bonus_period_months > 0);

with parsed as (
  select
    id,
    nullif(trim(split_part(offer, '/', 1)), '') as bonus_part,
    lower(regexp_replace(trim(split_part(offer, '/', 2)), '[$,[:space:]]', '', 'g')) as spend_part,
    lower(trim(split_part(offer, '/', 3))) as period_part
  from public.accounts
), normalized as (
  select
    id,
    case when lower(coalesce(bonus_part, '')) in ('', '-', 'nll') then null else bonus_part end as bonus_amount,
    case
      when spend_part ~ '^[0-9]+([.][0-9]+)?k$' then round(replace(spend_part, 'k', '')::numeric * 1000)::integer
      when spend_part ~ '^[0-9]+$' then spend_part::integer
      else null
    end as spend_requirement,
    case
      when period_part ~ '[0-9]+[[:space:]]*mo' then (regexp_match(period_part, '([0-9]+)[[:space:]]*mo'))[1]::integer
      when lower(coalesce(bonus_part, '')) not in ('', '-', 'nll') then 3
      else null
    end as bonus_period_months
  from parsed
)
update public.accounts as account
set
  bonus_amount = normalized.bonus_amount,
  spend_requirement = normalized.spend_requirement,
  bonus_period_months = normalized.bonus_period_months
from normalized
where account.id = normalized.id;

update public.card_types
set
  name = case lower(trim(name))
    when 'aa aviator' then 'AA Aviator'
    when 'aa biz' then 'AA Biz'
    when 'aa mileup' then 'AA MileUp'
    when 'al biz' then 'Alaska Biz'
    when 'amex gold' then 'Amex Gold'
    when 'bbp' then 'BBP'
    when 'biz gold' then 'Amex Biz Gold'
    when 'biz green' then 'Amex Biz Green'
    when 'biz plat' then 'Amex Biz Plat'
    when 'bonvoy biz' then 'Bonvoy Biz'
    when 'cff' then 'CFF'
    when 'cfu' then 'CFU'
    when 'cic' then 'CIC'
    when 'citi aa biz' then 'Citi AA Biz'
    when 'citi custom cash' then 'Citi Custom Cash'
    when 'citi premier' then 'Citi Premier'
    when 'citi strata elite' then 'Citi Strata Elite'
    when 'ciu' then 'CIU'
    when 'csp' then 'CSP'
    when 'csr' then 'CSR'
    when 'delta biz gold' then 'Delta Biz Gold'
    when 'ha biz' then 'HA Biz'
    when 'hh base' then 'HH Base'
    when 'hh biz' then 'HH Biz'
    when 'hh surpass' then 'HH Surpass'
    when 'ibp' then 'IBP'
    when 'jetblue biz' then 'JetBlue Biz'
    when 'jetblue plus' then 'JetBlue Plus'
    when 'redcard' then 'RedCard'
    when 'united biz' then 'United Biz'
    when 'united explorer' then 'United Explorer'
    when 'venture' then 'Venture'
    when 'venture x' then 'Venture X'
    when 'wyndham biz' then 'Wyndham Biz'
    else trim(name)
  end,
  issuer = case lower(trim(name))
    when 'aa aviator' then 'Barclays'
    when 'aa biz' then 'Barclays'
    when 'aa mileup' then 'Citi'
    when 'al biz' then 'Bank of America'
    when 'amex gold' then 'American Express'
    when 'bbp' then 'American Express'
    when 'biz gold' then 'American Express'
    when 'biz green' then 'American Express'
    when 'biz plat' then 'American Express'
    when 'bonvoy biz' then 'American Express'
    when 'cff' then 'Chase'
    when 'cfu' then 'Chase'
    when 'cic' then 'Chase'
    when 'citi aa biz' then 'Citi'
    when 'citi custom cash' then 'Citi'
    when 'citi premier' then 'Citi'
    when 'citi strata elite' then 'Citi'
    when 'ciu' then 'Chase'
    when 'csp' then 'Chase'
    when 'csr' then 'Chase'
    when 'delta biz gold' then 'American Express'
    when 'ha biz' then 'Barclays'
    when 'hh base' then 'American Express'
    when 'hh biz' then 'American Express'
    when 'hh surpass' then 'American Express'
    when 'ibp' then 'Chase'
    when 'jetblue biz' then 'Barclays'
    when 'jetblue plus' then 'Barclays'
    when 'redcard' then 'Target'
    when 'united biz' then 'Chase'
    when 'united explorer' then 'Chase'
    when 'venture' then 'Capital One'
    when 'venture x' then 'Capital One'
    when 'wyndham biz' then 'Barclays'
    else issuer
  end,
  kind = case lower(trim(name))
    when 'aa aviator' then 'personal'
    when 'aa biz' then 'business'
    when 'aa mileup' then 'personal'
    when 'al biz' then 'business'
    when 'amex gold' then 'personal'
    when 'bbp' then 'business'
    when 'biz gold' then 'business'
    when 'biz green' then 'business'
    when 'biz plat' then 'business'
    when 'bonvoy biz' then 'business'
    when 'cff' then 'personal'
    when 'cfu' then 'personal'
    when 'cic' then 'business'
    when 'citi aa biz' then 'business'
    when 'citi custom cash' then 'personal'
    when 'citi premier' then 'personal'
    when 'citi strata elite' then 'personal'
    when 'ciu' then 'business'
    when 'csp' then 'personal'
    when 'csr' then 'personal'
    when 'delta biz gold' then 'business'
    when 'ha biz' then 'business'
    when 'hh base' then 'personal'
    when 'hh biz' then 'business'
    when 'hh surpass' then 'personal'
    when 'ibp' then 'business'
    when 'jetblue biz' then 'business'
    when 'jetblue plus' then 'personal'
    when 'redcard' then 'other'
    when 'united biz' then 'business'
    when 'united explorer' then 'personal'
    when 'venture' then 'personal'
    when 'venture x' then 'personal'
    when 'wyndham biz' then 'business'
    else kind
  end;
