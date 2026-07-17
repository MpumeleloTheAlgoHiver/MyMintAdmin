-- Read-only completeness report. Run after reconstruct_all_rich_client_details.sql.
with clients as (
  select
    p.id,
    concat_ws(' ',nullif(p.first_name,''),nullif(p.last_name,'')) client_name,
    p.email,
    to_jsonb(p) profile,
    coalesce(k.pack_details,'{}'::jsonb) pack
  from public.profiles p
  left join public.user_onboarding_pack_details k on k.user_id=p.id
), fields as (
  select *,
    coalesce(nullif(profile->>'phone_number',''),nullif(pack->'info'->>'phone','')) phone,
    coalesce(nullif(profile->>'date_of_birth',''),nullif(pack->'info'->>'dob',''),nullif(pack->'info'->>'dateOfBirth','')) dob,
    coalesce(nullif(profile->>'gender',''),nullif(pack->'info'->>'gender','')) gender,
    coalesce(nullif(profile->>'id_number',''),nullif(pack->'info'->>'idNumber','')) id_number,
    coalesce(nullif(profile->>'address',''),jsonb_path_query_first(pack->'info','$.**.formattedAddress')#>>'{}') address
  from clients
)
select
  count(*) total_clients,
  count(*) filter(where phone is null) missing_phone,
  count(*) filter(where dob is null) missing_date_of_birth,
  count(*) filter(where gender is null) missing_gender,
  count(*) filter(where id_number is null) missing_id_number,
  count(*) filter(where address is null) missing_address
from fields;

with clients as (
  select p.id,concat_ws(' ',nullif(p.first_name,''),nullif(p.last_name,'')) client_name,p.email,
    to_jsonb(p) profile,coalesce(k.pack_details,'{}'::jsonb) pack
  from public.profiles p left join public.user_onboarding_pack_details k on k.user_id=p.id
), fields as (
  select *,
    coalesce(nullif(profile->>'phone_number',''),nullif(pack->'info'->>'phone','')) phone,
    coalesce(nullif(profile->>'date_of_birth',''),nullif(pack->'info'->>'dob',''),nullif(pack->'info'->>'dateOfBirth','')) dob,
    coalesce(nullif(profile->>'gender',''),nullif(pack->'info'->>'gender','')) gender,
    coalesce(nullif(profile->>'id_number',''),nullif(pack->'info'->>'idNumber','')) id_number,
    coalesce(nullif(profile->>'address',''),jsonb_path_query_first(pack->'info','$.**.formattedAddress')#>>'{}') address
  from clients
)
select id,client_name,email,
  array_remove(array[
    case when phone is null then 'phone' end,
    case when dob is null then 'date_of_birth' end,
    case when gender is null then 'gender' end,
    case when id_number is null then 'id_number' end,
    case when address is null then 'address' end
  ],null) missing_fields
from fields
where phone is null or dob is null or gender is null or id_number is null or address is null
order by cardinality(array_remove(array[
  case when phone is null then 'phone' end,case when dob is null then 'date_of_birth' end,
  case when gender is null then 'gender' end,case when id_number is null then 'id_number' end,
  case when address is null then 'address' end],null)) desc,client_name;
