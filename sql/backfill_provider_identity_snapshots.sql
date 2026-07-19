-- One-time, idempotent archive of provider evidence already retained today.
-- Run after provider_identity_snapshots.sql.
begin;

insert into public.provider_identity_snapshots_c
  (user_id,provider,capture_type,external_reference,payload,metadata,captured_at)
select k.user_id,'SUMSUB','BACKFILL_CURRENT_STATE',
  nullif(to_jsonb(o)->>'sumsub_applicant_id',''),k.pack_details,
  jsonb_build_object('source','user_onboarding_pack_details','backfilled',true),now()
from public.user_onboarding_pack_details k
join public.user_onboarding o on o.user_id=k.user_id
join public.profiles p on p.id=k.user_id
where (nullif(to_jsonb(o)->>'sumsub_applicant_id','') ~ '^[a-fA-F0-9]{24}$'
    or coalesce(k.pack_details->'data_provenance'->>'sumsub','') not in ('','Not available'))
  and not exists(select 1 from public.provider_identity_snapshots_c s
    where s.user_id=k.user_id and s.provider='SUMSUB' and s.capture_type='BACKFILL_CURRENT_STATE');

with experian_docs as (
  select profile_id user_id,jsonb_agg(jsonb_build_object(
    'file_name',file_name,'archived_at',archived_at,'resource_metadata',resource_metadata
  ) order by archived_at) documents
  from public.sumsub_document_archive
  where lower(coalesce(resource_metadata->>'provider','')) like 'experian%'
     or lower(coalesce(resource_metadata->>'source','')) like 'experian%'
     or lower(coalesce(file_name,'')) like 'experian%'
  group by profile_id
), evidence as (
  select o.user_id,
    case when jsonb_typeof(to_jsonb(o)->'sumsub_raw')='object' then to_jsonb(o)->'sumsub_raw' else '{}'::jsonb end raw,
    coalesce(d.documents,'[]'::jsonb) documents
  from public.user_onboarding o
  join public.profiles p on p.id=o.user_id
  left join experian_docs d on d.user_id=o.user_id
)
insert into public.provider_identity_snapshots_c
  (user_id,provider,capture_type,external_reference,payload,metadata,captured_at)
select user_id,'EXPERIAN','BACKFILL_CURRENT_STATE',null,
  jsonb_build_object('onboarding_raw',raw,'archived_documents',documents),
  jsonb_build_object('source','onboarding_and_document_archive','backfilled',true),now()
from evidence
where (raw ?| array['experian_idmn_result','experian_ocr_result','experian_kyc_addresses',
                     'experian_kyc_contact','experian_idmn_transaction_id']
       or jsonb_array_length(documents)>0)
  and not exists(select 1 from public.provider_identity_snapshots_c s
    where s.user_id=evidence.user_id and s.provider='EXPERIAN' and s.capture_type='BACKFILL_CURRENT_STATE');

commit;

select provider,count(*) snapshots,count(distinct user_id) users
from public.provider_identity_snapshots_c group by provider order by provider;

-- Report legacy provider/onboarding rows that could not be archived because
-- their owning profile no longer exists. These are deliberately not assigned
-- to another client or silently deleted.
select orphan_source,user_id
from (
  select 'user_onboarding'::text orphan_source,o.user_id
  from public.user_onboarding o
  left join public.profiles p on p.id=o.user_id
  where p.id is null
  union
  select 'user_onboarding_pack_details',k.user_id
  from public.user_onboarding_pack_details k
  left join public.profiles p on p.id=k.user_id
  where p.id is null
  union
  select 'sumsub_document_archive',d.profile_id
  from public.sumsub_document_archive d
  left join public.profiles p on p.id=d.profile_id
  where p.id is null
) orphaned_provider_records
order by user_id,orphan_source;
