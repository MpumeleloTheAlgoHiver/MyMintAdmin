-- Fix: CRM strategy edit fails with "permission denied for table strategies_c"
-- (Postgres 42501). The client-side role check (mintCan) already correctly
-- lets master/dev admins through — this was never an app-permission bug, it's
-- that strategies_c has RLS enabled with no policy granting UPDATE (and
-- likely INSERT) to admin_team members at all, so every direct write from
-- dashboard.html's supabaseClient.from('strategies_c').update(...) call is
-- denied at the database layer no matter who's logged in.
--
-- Mirrors the admin_team role/approver_tier check the client already applies
-- (role in ('admin','master_admin') OR approver_tier in ('master','dev')).

alter table public.strategies_c enable row level security;

drop policy if exists "admin_team can update strategies_c" on public.strategies_c;
create policy "admin_team can update strategies_c"
on public.strategies_c
for update
to authenticated
using (
  exists (
    select 1 from public.admin_team at
    where at.user_id = auth.uid()
      and (at.role in ('admin', 'master_admin') or at.approver_tier in ('master', 'dev'))
  )
)
with check (
  exists (
    select 1 from public.admin_team at
    where at.user_id = auth.uid()
      and (at.role in ('admin', 'master_admin') or at.approver_tier in ('master', 'dev'))
  )
);

drop policy if exists "admin_team can insert strategies_c" on public.strategies_c;
create policy "admin_team can insert strategies_c"
on public.strategies_c
for insert
to authenticated
with check (
  exists (
    select 1 from public.admin_team at
    where at.user_id = auth.uid()
      and (at.role in ('admin', 'master_admin') or at.approver_tier in ('master', 'dev'))
  )
);

-- Read access for strategies_c is presumably already working today (browsing/
-- listing works) — intentionally not touching SELECT here to avoid narrowing
-- something that's currently fine.
