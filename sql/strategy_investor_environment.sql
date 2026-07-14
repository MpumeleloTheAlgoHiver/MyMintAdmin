-- Separate live and UAT strategy ownership/rebalance scopes.
-- Deploy before the matching dashboard code.

begin;

alter table public.strategies_c
  add column if not exists investor_environment text not null default 'LIVE';

update public.strategies_c
   set investor_environment = upper(investor_environment)
 where investor_environment is not null;

alter table public.strategies_c
  drop constraint if exists strategies_c_investor_environment_check;

alter table public.strategies_c
  add constraint strategies_c_investor_environment_check
  check (investor_environment in ('LIVE', 'UAT'));

update public.strategies_c
   set investor_environment = 'UAT'
 where id = '26daf728-8e95-4ff0-b9e7-69b382b0bb8c'::uuid
    or lower(name) = 'test strategy';

commit;
