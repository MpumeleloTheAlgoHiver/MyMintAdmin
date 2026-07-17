-- Read-only: clients with an existing onboarding/SumSub relationship whose
-- retained rich record still has missing core fields.
with candidates as (
  select
    p.id,
    concat_ws(' ',nullif(p.first_name,''),nullif(p.last_name,'')) client_name,
    p.email,
    coalesce(nullif(to_jsonb(o)->>'sumsub_external_user_id',''),p.id::text) external_user_id,
    nullif(to_jsonb(o)->>'sumsub_applicant_id','') applicant_id,
    to_jsonb(o)->>'kyc_status' kyc_status,
    coalesce(k.pack_details,'{}'::jsonb) pack,
    to_jsonb(p) profile
  from public.profiles p
  join public.user_onboarding o on o.user_id=p.id
  left join public.user_onboarding_pack_details k on k.user_id=p.id
), missing as (
  select *,array_remove(array[
    case when coalesce(nullif(profile->>'phone_number',''),nullif(pack->'info'->>'phone','')) is null then 'phone' end,
    case when coalesce(nullif(profile->>'date_of_birth',''),nullif(pack->'info'->>'dob',''),nullif(pack->'info'->>'dateOfBirth','')) is null then 'date_of_birth' end,
    case when coalesce(nullif(profile->>'gender',''),nullif(pack->'info'->>'gender','')) is null then 'gender' end,
    case when coalesce(nullif(profile->>'id_number',''),nullif(pack->'info'->>'idNumber','')) is null then 'id_number' end,
    case when coalesce(nullif(profile->>'address',''),jsonb_path_query_first(pack->'info','$.**.formattedAddress')#>>'{}') is null then 'address' end
  ],null) missing_fields
  from candidates
)
select count(*) as refresh_candidates,
  count(*) filter(where applicant_id is not null) as with_applicant_id,
  count(*) filter(where cardinality(missing_fields)>0) as candidates_with_missing_fields
from missing;

with candidates as (
  select p.id,concat_ws(' ',nullif(p.first_name,''),nullif(p.last_name,'')) client_name,p.email,
    coalesce(nullif(to_jsonb(o)->>'sumsub_external_user_id',''),p.id::text) external_user_id,
    nullif(to_jsonb(o)->>'sumsub_applicant_id','') applicant_id,to_jsonb(o)->>'kyc_status' kyc_status,
    coalesce(k.pack_details,'{}'::jsonb) pack,to_jsonb(p) profile
  from public.profiles p join public.user_onboarding o on o.user_id=p.id
  left join public.user_onboarding_pack_details k on k.user_id=p.id
), missing as (
  select *,array_remove(array[
    case when coalesce(nullif(profile->>'phone_number',''),nullif(pack->'info'->>'phone','')) is null then 'phone' end,
    case when coalesce(nullif(profile->>'date_of_birth',''),nullif(pack->'info'->>'dob',''),nullif(pack->'info'->>'dateOfBirth','')) is null then 'date_of_birth' end,
    case when coalesce(nullif(profile->>'gender',''),nullif(pack->'info'->>'gender','')) is null then 'gender' end,
    case when coalesce(nullif(profile->>'id_number',''),nullif(pack->'info'->>'idNumber','')) is null then 'id_number' end,
    case when coalesce(nullif(profile->>'address',''),jsonb_path_query_first(pack->'info','$.**.formattedAddress')#>>'{}') is null then 'address' end
  ],null) missing_fields from candidates
)
select id,client_name,email,external_user_id,applicant_id,kyc_status,missing_fields
from missing where cardinality(missing_fields)>0
order by cardinality(missing_fields) desc,client_name;
