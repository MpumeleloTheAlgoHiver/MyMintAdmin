-- Read-only scope report. Run before the bulk reconstruction.
with packs as (
  select user_id, coalesce(pack_details,'{}'::jsonb) pack
  from public.user_onboarding_pack_details
), onboarding as (
  select user_id, case when jsonb_typeof(to_jsonb(o)->'sumsub_raw')='object'
    then to_jsonb(o)->'sumsub_raw' else '{}'::jsonb end raw
  from public.user_onboarding o
)
select
  (select count(*) from public.profiles) as total_profiles,
  (select count(*) from packs) as existing_packs,
  (select count(*) from packs where jsonb_typeof(pack->'info')='object') as packs_with_info,
  (select count(*) from onboarding where raw ? 'experian_kyc_result' or raw ? 'experian_idmn_result') as retained_experian_payloads,
  (select count(*) from public.profiles p
    where coalesce(to_jsonb(p)->>'id_number','') ~ '^\d{13}$') as profiles_with_sa_id,
  (select count(*) from public.profiles p
    where coalesce(to_jsonb(p)->>'id_number','') ~ '^\d{13}$'
      and nullif(to_jsonb(p)->>'gender','') is null) as sa_id_profiles_missing_gender,
  (select count(*) from public.profiles) as reconstruction_scope;
