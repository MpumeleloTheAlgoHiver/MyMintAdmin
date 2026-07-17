-- One-owner reconstruction requested for Mpumelelo Maswanganye.
-- Preserves the original pack row, merges non-empty profile fields, and embeds
-- the complete Experian KYC/IDMN evidence without altering provider source rows.

begin;

create schema if not exists backup_20260717_client_details;
create table if not exists backup_20260717_client_details.mpumelelo_pack
  as select * from public.user_onboarding_pack_details where false;

insert into backup_20260717_client_details.mpumelelo_pack
select * from public.user_onboarding_pack_details
where user_id = 'b215eb9a-4017-45f1-a460-6056b1db0c4d'::uuid
  and not exists (select 1 from backup_20260717_client_details.mpumelelo_pack);

do $$
declare
  v_uid constant uuid := 'b215eb9a-4017-45f1-a460-6056b1db0c4d'::uuid;
  v_profile jsonb;
  v_raw jsonb := '{}'::jsonb;
  v_pack jsonb := '{}'::jsonb;
  v_info jsonb := '{}'::jsonb;
  v_kyc jsonb;
  v_idmn jsonb;
  v_first text;
  v_last text;
  v_dob text;
  v_id_number text;
  v_phone text;
  v_address text;
begin
  select to_jsonb(p) into v_profile from public.profiles p where p.id = v_uid;
  if v_profile is null then raise exception 'Mpumelelo profile not found'; end if;

  select case
    when jsonb_typeof(to_jsonb(o)->'sumsub_raw') = 'object' then to_jsonb(o)->'sumsub_raw'
    else '{}'::jsonb
  end into v_raw
  from public.user_onboarding o where o.user_id = v_uid;
  v_raw := coalesce(v_raw, '{}'::jsonb);

  select coalesce(pack_details, '{}'::jsonb) into v_pack
  from public.user_onboarding_pack_details where user_id = v_uid for update;
  v_pack := coalesce(v_pack, '{}'::jsonb);
  v_info := case when jsonb_typeof(v_pack->'info') = 'object' then v_pack->'info' else '{}'::jsonb end;
  v_kyc := v_raw->'experian_kyc_result';
  v_idmn := v_raw->'experian_idmn_result';
  -- Do not retain a metadata-only Experian object when the underlying provider
  -- evidence is absent. Provenance must never imply verification without data.
  if v_kyc is null and v_idmn is null then
    v_pack := v_pack - 'experian';
  end if;

  v_first := coalesce(nullif(v_info->>'firstName',''), nullif(v_profile->>'first_name',''), jsonb_path_query_first(coalesce(v_idmn,v_kyc), '$.**.firstName') #>> '{}', jsonb_path_query_first(coalesce(v_idmn,v_kyc), '$.**.forename') #>> '{}');
  v_last := coalesce(nullif(v_info->>'lastName',''), nullif(v_profile->>'last_name',''), jsonb_path_query_first(coalesce(v_idmn,v_kyc), '$.**.lastName') #>> '{}', jsonb_path_query_first(coalesce(v_idmn,v_kyc), '$.**.surname') #>> '{}');
  v_dob := coalesce(nullif(v_info->>'dob',''), nullif(v_profile->>'date_of_birth',''), jsonb_path_query_first(coalesce(v_idmn,v_kyc), '$.**.dateOfBirth') #>> '{}', jsonb_path_query_first(coalesce(v_idmn,v_kyc), '$.**.dob') #>> '{}');
  v_id_number := coalesce(nullif(v_profile->>'id_number',''), nullif(v_info->>'idNumber',''), jsonb_path_query_first(coalesce(v_idmn,v_kyc), '$.**.identityNumber') #>> '{}', jsonb_path_query_first(coalesce(v_idmn,v_kyc), '$.**.idNumber') #>> '{}');
  v_phone := coalesce(nullif(v_profile->>'phone_number',''), nullif(v_info->>'phone',''), jsonb_path_query_first(coalesce(v_kyc,v_idmn), '$.**.phoneNumber') #>> '{}');
  v_address := coalesce(nullif(v_profile->>'address',''), jsonb_path_query_first(coalesce(v_kyc,v_idmn), '$.**.formattedAddress') #>> '{}', jsonb_path_query_first(coalesce(v_kyc,v_idmn), '$.**.residentialAddress') #>> '{}');

  v_info := v_info || jsonb_strip_nulls(jsonb_build_object(
    'firstName', v_first, 'lastName', v_last, 'dob', v_dob,
    'idNumber', v_id_number, 'email', nullif(v_profile->>'email',''),
    'phone', v_phone,
    'addresses', case when v_address is not null and not (v_info ? 'addresses')
      then jsonb_build_array(jsonb_build_object('formattedAddress', v_address)) else null end
  ));

  insert into public.user_onboarding_pack_details(user_id, pack_details, updated_at)
  values(v_uid, v_pack || jsonb_build_object(
    'info', v_info,
    'data_provenance', jsonb_build_object(
      'profile', 'User-confirmed profile fields',
      'sumsub', case when v_pack ? 'info' then 'SumSub applicant data' else 'Not available' end,
      'experian', case when v_kyc is not null or v_idmn is not null then 'Experian KYC / ID Me Now' else 'Not available' end,
      'reconstruction_scope', 'Mpumelelo only'
    )
  ) || case when v_kyc is not null or v_idmn is not null then jsonb_build_object(
    'experian', jsonb_strip_nulls(jsonb_build_object(
      'kyc', v_kyc, 'idmn', v_idmn,
      'source', 'Experian verified onboarding data', 'reconstructed_at', now()
    ))) else '{}'::jsonb end, now())
  on conflict(user_id) do update set
    pack_details = excluded.pack_details,
    updated_at = excluded.updated_at;
end $$;

revoke all on schema backup_20260717_client_details from anon, authenticated;
revoke all on all tables in schema backup_20260717_client_details from anon, authenticated;

commit;

select
  user_id,
  pack_details ? 'info' as has_info,
  pack_details ? 'experian' as has_experian,
  jsonb_object_keys(coalesce(pack_details->'info','{}'::jsonb)) as populated_info_field
from public.user_onboarding_pack_details
where user_id = 'b215eb9a-4017-45f1-a460-6056b1db0c4d'::uuid;
