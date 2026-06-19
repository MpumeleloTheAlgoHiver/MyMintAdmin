create table if not exists public.orderbook_email_runs (
  id bigserial primary key,
  run_date date not null unique,
  status text not null default 'pending',
  timezone text null,
  target_hour integer null,
  target_minute integer null,
  row_count integer null,
  sent_at timestamp with time zone null,
  last_attempt_at timestamp with time zone null,
  error_message text null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create index if not exists idx_orderbook_email_runs_run_date on public.orderbook_email_runs (run_date);

alter table public.orderbook_email_runs
  add column if not exists sequence_number bigint null,
  add column if not exists title text null,
  add column if not exists date_label text null,
  add column if not exists snapshot_rows jsonb null;

create index if not exists idx_orderbook_email_runs_sequence_number on public.orderbook_email_runs (sequence_number);

-- Backfill any existing rows that have NULL sequence_number.
update public.orderbook_email_runs
  set sequence_number = 1
  where sequence_number is null;

-- Make sequence_number non-nullable with a default of 1.
alter table public.orderbook_email_runs
  alter column sequence_number set default 1,
  alter column sequence_number set not null;

-- Allow multiple order books per day (one per sequence).
-- Drop the old single-column unique on run_date and add a composite unique.
alter table public.orderbook_email_runs
  drop constraint if exists orderbook_email_runs_run_date_key;

create unique index if not exists idx_orderbook_email_runs_run_date_seq
  on public.orderbook_email_runs (run_date, sequence_number);

create or replace function public.set_orderbook_email_runs_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_orderbook_email_runs_updated_at on public.orderbook_email_runs;
create trigger trg_orderbook_email_runs_updated_at
before update on public.orderbook_email_runs
for each row
execute function public.set_orderbook_email_runs_updated_at();

-- Shared "Closed Books" state. Previously each admin tracked which fully-filled
-- books they had moved to Closed Books in their own browser localStorage, so the
-- Closed Books list differed per admin. These columns make the closed set shared:
-- a book closed by one admin is closed for everyone. A book maps 1:1 to a row
-- here (book id = `<run_date>-<sequence_number>`), so no separate table is needed.
alter table public.orderbook_email_runs
  add column if not exists closed_at timestamp with time zone null,
  add column if not exists closed_by uuid null;

create index if not exists idx_orderbook_email_runs_closed_at
  on public.orderbook_email_runs (closed_at)
  where closed_at is not null;

alter table public.orderbook_email_runs enable row level security;

drop policy if exists orderbook_email_runs_service_role_access on public.orderbook_email_runs;
create policy orderbook_email_runs_service_role_access
on public.orderbook_email_runs
for all
to service_role
using (true)
with check (true);
