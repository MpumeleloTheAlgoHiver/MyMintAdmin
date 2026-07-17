-- Immutable provider evidence archive for SumSub and Experian captures.
begin;
create table if not exists public.provider_identity_snapshots_c (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete restrict,
  provider text not null check (provider in ('SUMSUB','EXPERIAN')),
  capture_type text not null,
  external_reference text,
  payload jsonb not null,
  metadata jsonb not null default '{}'::jsonb,
  captured_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists idx_provider_identity_snapshots_user_date
  on public.provider_identity_snapshots_c(user_id,provider,captured_at desc);
alter table public.provider_identity_snapshots_c enable row level security;
revoke all on public.provider_identity_snapshots_c from anon,authenticated;
grant select,insert on public.provider_identity_snapshots_c to service_role;
create or replace function public.prevent_provider_snapshot_mutation()
returns trigger language plpgsql set search_path=public as $$
begin raise exception 'Provider identity snapshots are immutable'; end;
$$;
drop trigger if exists trg_provider_identity_snapshots_immutable on public.provider_identity_snapshots_c;
create trigger trg_provider_identity_snapshots_immutable
before update or delete on public.provider_identity_snapshots_c
for each row execute function public.prevent_provider_snapshot_mutation();
commit;
