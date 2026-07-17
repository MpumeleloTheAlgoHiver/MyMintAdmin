-- Backup-first, idempotent normalization for existing stored onboarding data.
-- Does not call SumSub or Experian and does not alter source provider payloads.

begin;

create schema if not exists backup_20260717_all_rich_details;
create table if not exists backup_20260717_all_rich_details.user_onboarding_pack_details
  as table public.user_onboarding_pack_details;

do $$
declare
  r record;
  v_profile jsonb;
  v_raw jsonb;
  v_pack jsonb;
  v_info jsonb;
  v_kyc jsonb;
  v_idmn jsonb;
  v_archive jsonb;
  v_has_experian boolean;
  v_first text;
  v_last text;
  v_dob text;
  v_id_number text;
  v_gender text;
  v_gender_source text;
  v_sa_id_valid boolean;
  v_checksum_sum integer;
  v_digit integer;
  v_index integer;
  v_phone text;
  v_address text;
  v_had_sumsub boolean;
begin
  for r in
    select p.id
    from public.profiles p
    where exists(select 1 from public.user_onboarding o where o.user_id=p.id)
  loop
    select to_jsonb(p) into v_profile from public.profiles p where p.id=r.id;
    select case when jsonb_typeof(to_jsonb(o)->'sumsub_raw')='object'
      then to_jsonb(o)->'sumsub_raw' else '{}'::jsonb end
      into v_raw from public.user_onboarding o where o.user_id=r.id;
    v_raw := coalesce(v_raw,'{}'::jsonb);
    select coalesce(pack_details,'{}'::jsonb) into v_pack
      from public.user_onboarding_pack_details where user_id=r.id;
    v_pack := coalesce(v_pack,'{}'::jsonb);
    v_had_sumsub := jsonb_typeof(v_pack->'info')='object' or jsonb_typeof(v_pack->'fixedInfo')='object';
    v_info := case
      when jsonb_typeof(v_pack->'info')='object' then v_pack->'info'
      when jsonb_typeof(v_pack->'fixedInfo')='object' then v_pack->'fixedInfo'
      else '{}'::jsonb end;
    v_kyc := v_raw->'experian_kyc_result';
    v_idmn := v_raw->'experian_idmn_result';
    select resource_metadata into v_archive
      from public.sumsub_document_archive
     where profile_id=r.id
       and (lower(coalesce(resource_metadata->>'provider','')) like 'experian%'
         or lower(coalesce(resource_metadata->>'source','')) like 'experian%'
         or lower(coalesce(file_name,'')) like 'experian%')
     order by case when lower(coalesce(resource_metadata->>'source',''))='experian_kyc' then 0 else 1 end,
              archived_at desc nulls last
     limit 1;
    v_archive := coalesce(v_archive,'{}'::jsonb);
    v_kyc := coalesce(v_kyc,jsonb_strip_nulls(jsonb_build_object(
      'addresses',v_raw->'experian_kyc_addresses',
      'contact',v_raw->'experian_kyc_contact',
      'stats',v_raw->'experian_kyc_stats',
      'archive',v_archive
    )));
    v_has_experian := v_idmn is not null
      or v_raw ?| array['experian_idmn_result','experian_ocr_result','experian_kyc_addresses',
                         'experian_kyc_contact','experian_idmn_transaction_id']
      or v_archive<>'{}'::jsonb;
    if not v_has_experian then v_pack := v_pack-'experian'; end if;

    v_first := coalesce(nullif(v_profile->>'first_name',''),nullif(v_info->>'firstName',''),jsonb_path_query_first(coalesce(v_idmn,v_kyc),'$.**.firstName')#>>'{}',jsonb_path_query_first(coalesce(v_idmn,v_kyc),'$.**.first_name')#>>'{}',jsonb_path_query_first(coalesce(v_idmn,v_kyc),'$.**.forename')#>>'{}');
    v_last := coalesce(nullif(v_profile->>'last_name',''),nullif(v_info->>'lastName',''),jsonb_path_query_first(coalesce(v_idmn,v_kyc),'$.**.lastName')#>>'{}',jsonb_path_query_first(coalesce(v_idmn,v_kyc),'$.**.last_name')#>>'{}',jsonb_path_query_first(coalesce(v_idmn,v_kyc),'$.**.surname')#>>'{}');
    v_dob := coalesce(nullif(v_profile->>'date_of_birth',''),nullif(v_info->>'dob',''),nullif(v_info->>'dateOfBirth',''),jsonb_path_query_first(coalesce(v_idmn,v_kyc),'$.**.dateOfBirth')#>>'{}',jsonb_path_query_first(coalesce(v_idmn,v_kyc),'$.**.dob')#>>'{}');
    v_id_number := coalesce(nullif(v_profile->>'id_number',''),nullif(v_info->>'idNumber',''),jsonb_path_query_first(coalesce(v_idmn,v_kyc),'$.**.identityNumber')#>>'{}',jsonb_path_query_first(coalesce(v_idmn,v_kyc),'$.**.idNumber')#>>'{}');
    v_gender := coalesce(nullif(v_profile->>'gender',''), nullif(v_info->>'gender',''),
      jsonb_path_query_first(coalesce(v_idmn,v_kyc),'$.**.gender')#>>'{}');
    v_gender_source := case
      when nullif(v_profile->>'gender','') is not null then 'Profile'
      when nullif(v_info->>'gender','') is not null then 'Provider record'
      when jsonb_path_query_first(coalesce(v_idmn,v_kyc),'$.**.gender') is not null then 'Experian'
      else 'Not available' end;
    v_sa_id_valid := false;
    if v_id_number ~ '^\d{13}$'
       and substring(v_id_number,3,2)::int between 1 and 12
       and substring(v_id_number,5,2)::int between 1 and 31 then
      v_checksum_sum := 0;
      for v_index in 1..12 loop
        v_digit := substring(v_id_number,v_index,1)::int;
        if mod(v_index,2)=0 then
          v_digit := v_digit*2;
          if v_digit>9 then v_digit:=v_digit-9; end if;
        end if;
        v_checksum_sum := v_checksum_sum+v_digit;
      end loop;
      v_sa_id_valid := mod(10-mod(v_checksum_sum,10),10)=substring(v_id_number,13,1)::int;
    end if;
    if v_gender is null and v_sa_id_valid then
      -- SA ID digits 7-10 are the sequence: 0000-4999 female, 5000-9999 male.
      -- This is a derived display value, not a provider assertion.
      v_gender := case when substring(v_id_number,7,4)::int >= 5000 then 'Male' else 'Female' end;
      v_gender_source := 'Derived from validated SA ID';
    end if;
    v_phone := coalesce(nullif(v_profile->>'phone_number',''),nullif(v_info->>'phone',''),jsonb_path_query_first(coalesce(v_kyc,v_idmn),'$.**.phoneNumber')#>>'{}',jsonb_path_query_first(coalesce(v_kyc,v_idmn),'$.**.cell')#>>'{}');
    v_address := coalesce(nullif(v_profile->>'address',''),jsonb_path_query_first(v_info,'$.**.formattedAddress')#>>'{}',jsonb_path_query_first(coalesce(v_kyc,v_idmn),'$.**.formattedAddress')#>>'{}',jsonb_path_query_first(coalesce(v_kyc,v_idmn),'$.**.formatted')#>>'{}',jsonb_path_query_first(coalesce(v_kyc,v_idmn),'$.**.residentialAddress')#>>'{}');

    v_info := v_info || jsonb_strip_nulls(jsonb_build_object(
      'firstName',v_first,'lastName',v_last,'dob',v_dob,'gender',v_gender,'idNumber',v_id_number,
      'email',nullif(v_profile->>'email',''),'phone',v_phone,
      'addresses',case when v_address is not null and not(v_info?'addresses')
        then jsonb_build_array(jsonb_build_object('formattedAddress',v_address)) else null end
    ));

    insert into public.user_onboarding_pack_details(user_id,pack_details,updated_at)
    values(r.id,
      v_pack || jsonb_build_object(
        'info',v_info,
        'data_provenance',jsonb_build_object(
          'profile','User-confirmed profile fields',
          'sumsub',case when v_had_sumsub then 'SumSub applicant data' else 'Not available' end,
          'experian',case when v_has_experian then 'Experian KYC / ID Me Now' else 'Not available' end,
          'gender',v_gender_source,
          'reconstruction_scope','Profiles with an onboarding record',
          'reconstructed_at',now()
        )
      ) || case when v_has_experian then jsonb_build_object(
        'experian',jsonb_strip_nulls(jsonb_build_object(
          'kyc',v_kyc,'idmn',v_idmn,'archive_metadata',v_archive,
          'source','Experian retained onboarding evidence','reconstructed_at',now()
        ))) else '{}'::jsonb end,
      now())
    on conflict(user_id) do update set pack_details=excluded.pack_details,updated_at=excluded.updated_at;
  end loop;
end $$;

revoke all on schema backup_20260717_all_rich_details from anon,authenticated;
revoke all on all tables in schema backup_20260717_all_rich_details from anon,authenticated;

commit;

select
  count(*) as normalized_packs,
  count(*) filter(where pack_details?'info') as with_info,
  count(*) filter(where nullif(pack_details->'info'->>'gender','') is not null) as with_gender,
  count(*) filter(where pack_details->'data_provenance'->>'gender'='Derived from validated SA ID') as gender_derived_from_sa_id,
  count(*) filter(where pack_details?'experian' and (pack_details->'data_provenance'->>'experian')<>'Not available') as with_experian_evidence
from public.user_onboarding_pack_details;
