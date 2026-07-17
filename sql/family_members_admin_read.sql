-- ============================================================
-- CRM admin read access to family members (Parent/Child toggle)
-- ------------------------------------------------------------
-- The CRM investor page reads family_members straight from the
-- browser with the logged-in admin's session. That table's RLS
-- only lets a PARENT read their own children (owner policy), so a
-- CRM admin (who isn't a parent) gets 0 rows — which makes the
-- Parent filter blank and the Child view empty, while All (which
-- reads profiles) works.
--
-- Fix: add an admin-read policy, scoped to CRM team members
-- (rows in admin_team, matched by user_id = auth.uid()). RLS
-- SELECT policies are OR'd, so this ADDS admin read on top of the
-- existing owner policy — parents still see only their own kids,
-- and ordinary app users see nothing new.
--
-- is_crm_admin() is SECURITY DEFINER so it can read admin_team
-- regardless of admin_team's own RLS (avoids policy recursion).
--
-- Safe to run more than once.
-- ============================================================

create or replace function public.is_crm_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.admin_team t
    where t.user_id = auth.uid()
  );
$$;

revoke all on function public.is_crm_admin() from public;
grant execute on function public.is_crm_admin() to authenticated;

-- family_members: admins can read all (additive to the owner policy)
drop policy if exists "family_members_admin_read" on public.family_members;
create policy "family_members_admin_read" on public.family_members
  for select to authenticated
  using (public.is_crm_admin());

-- family_transactions: same, so child detail / balance history loads too
drop policy if exists "family_transactions_admin_read" on public.family_transactions;
create policy "family_transactions_admin_read" on public.family_transactions
  for select to authenticated
  using (public.is_crm_admin());
