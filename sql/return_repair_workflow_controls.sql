-- Reusable, atomic controls for the CRM Repair page.
-- Deploy after strategy_return_shadow_backfill.sql and
-- strategy_global_valuation_rules.sql.

begin;

create or replace function public.approve_return_repair_run(
  p_run_id uuid,
  p_approved_by uuid
) returns public.return_repair_runs_c
language plpgsql
security definer
set search_path = public
as $$
declare v_run public.return_repair_runs_c%rowtype;
begin
  if p_approved_by is null then raise exception 'Approver is required'; end if;
  select * into v_run from public.return_repair_runs_c where id=p_run_id for update;
  if not found then raise exception 'Unknown repair run %', p_run_id; end if;
  if v_run.status = 'APPROVED' or v_run.status = 'PROMOTED' then return v_run; end if;
  if v_run.status <> 'VALIDATED' then raise exception 'Run cannot be approved from status %', v_run.status; end if;
  if coalesce((v_run.validation_summary->>'bad_strategy_identities')::int,0) <> 0
     or coalesce((v_run.validation_summary->>'bad_client_identities')::int,0) <> 0 then
    raise exception 'Validation contains failed accounting identities';
  end if;
  update public.return_repair_runs_c
     set status='APPROVED', approved_by=p_approved_by, approved_at=now()
   where id=p_run_id returning * into v_run;
  return v_run;
end;
$$;

create or replace function public.promote_return_repair_run(
  p_run_id uuid,
  p_approved_by uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run public.return_repair_runs_c%rowtype;
  v_latest record;
  v_rule public.strategy_valuation_rules_c%rowtype;
  v_rules jsonb := '[]'::jsonb;
begin
  if p_approved_by is null then raise exception 'Approver is required'; end if;
  select * into v_run from public.return_repair_runs_c where id=p_run_id for update;
  if not found then raise exception 'Unknown repair run %', p_run_id; end if;
  if v_run.status = 'PROMOTED' then
    return jsonb_build_object('run_id',p_run_id,'status','PROMOTED','idempotent',true);
  end if;
  if v_run.status <> 'APPROVED' then raise exception 'Run must be APPROVED before promotion'; end if;

  for v_latest in
    select distinct on (strategy_id) *
      from public.strategy_returns_shadow_c
     where run_id=p_run_id
     order by strategy_id,as_of_date desc
  loop
    select * into v_rule from public.strategy_valuation_rules_c
     where strategy_id=v_latest.strategy_id and repair_run_id=p_run_id
     order by created_at desc limit 1 for update;
    if not found then
      insert into public.strategy_valuation_rules_c(
        strategy_id,effective_from,securities_value_per_lot_cents,
        continuity_cash_per_lot_cents,status,repair_run_id,
        methodology_version,source_evidence,created_by
      ) values (
        v_latest.strategy_id,v_latest.as_of_date,v_latest.securities_value_cents,
        v_latest.continuity_cash_cents,'DRAFT',p_run_id,v_run.methodology_version,
        v_latest.source_evidence,p_approved_by
      ) returning * into v_rule;
    end if;
    if v_rule.status = 'DRAFT' then
      v_rule := public.activate_strategy_valuation_rule(v_rule.id,p_approved_by);
    elsif v_rule.status <> 'ACTIVE' then
      raise exception 'Repair valuation rule % is %',v_rule.id,v_rule.status;
    end if;
    v_rules := v_rules || jsonb_build_array(jsonb_build_object(
      'rule_id',v_rule.id,'strategy_id',v_rule.strategy_id,
      'effective_from',v_rule.effective_from,'status',v_rule.status
    ));
  end loop;
  if jsonb_array_length(v_rules)=0 then raise exception 'Repair has no strategy rows'; end if;
  update public.return_repair_runs_c set status='PROMOTED',promoted_at=now() where id=p_run_id;
  return jsonb_build_object('run_id',p_run_id,'status','PROMOTED','rules',v_rules,'idempotent',false);
end;
$$;

create or replace function public.rollback_return_repair_run(
  p_run_id uuid,
  p_approved_by uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_run public.return_repair_runs_c%rowtype; v_active record; v_restored uuid[] := '{}';
begin
  if p_approved_by is null then raise exception 'Approver is required'; end if;
  select * into v_run from public.return_repair_runs_c where id=p_run_id for update;
  if not found then raise exception 'Unknown repair run %',p_run_id; end if;
  if v_run.status='ROLLED_BACK' then return jsonb_build_object('run_id',p_run_id,'status','ROLLED_BACK','idempotent',true); end if;
  if v_run.status<>'PROMOTED' then raise exception 'Only a PROMOTED run can be rolled back'; end if;
  for v_active in select * from public.strategy_valuation_rules_c where repair_run_id=p_run_id and status='ACTIVE' for update
  loop
    update public.strategy_valuation_rules_c set status='REJECTED' where id=v_active.id;
    update public.strategy_valuation_rules_c set status='ACTIVE'
     where id=(select id from public.strategy_valuation_rules_c
                where strategy_id=v_active.strategy_id and status='SUPERSEDED'
                order by effective_from desc limit 1)
     returning id into v_active.id;
    if v_active.id is not null then v_restored:=array_append(v_restored,v_active.id); end if;
  end loop;
  update public.return_repair_runs_c set status='ROLLED_BACK',rolled_back_at=now() where id=p_run_id;
  return jsonb_build_object('run_id',p_run_id,'status','ROLLED_BACK','restored_rule_ids',to_jsonb(v_restored),'idempotent',false);
end;
$$;

revoke all on function public.approve_return_repair_run(uuid,uuid) from public,anon,authenticated;
revoke all on function public.promote_return_repair_run(uuid,uuid) from public,anon,authenticated;
revoke all on function public.rollback_return_repair_run(uuid,uuid) from public,anon,authenticated;
grant execute on function public.approve_return_repair_run(uuid,uuid) to service_role;
grant execute on function public.promote_return_repair_run(uuid,uuid) to service_role;
grant execute on function public.rollback_return_repair_run(uuid,uuid) to service_role;

commit;
