-- Read-only Experian evidence audit across every location used by the app.
-- Returns aggregate counts followed by a per-user evidence ledger.

with onboarding as (
  select
    user_id,
    case when jsonb_typeof(to_jsonb(o)->'sumsub_raw')='object'
      then to_jsonb(o)->'sumsub_raw' else '{}'::jsonb end as raw,
    to_jsonb(o) as row_data
  from public.user_onboarding o
), archive as (
  select
    profile_id as user_id,
    count(*) as document_count,
    max(archived_at) as last_archived_at
  from public.sumsub_document_archive
  where lower(coalesce(resource_metadata->>'provider','')) like 'experian%'
     or lower(coalesce(resource_metadata->>'source','')) like 'experian%'
     or lower(coalesce(file_name,'')) like 'experian%'
  group by profile_id
), evidence as (
  select
    p.id as user_id,
    concat_ws(' ',nullif(p.first_name,''),nullif(p.last_name,'')) as client_name,
    p.email,
    coalesce(a.document_count,0) as archived_documents,
    a.last_archived_at,
    coalesce(o.raw->>'experian_idmn_status','') as idmn_status,
    coalesce(o.raw->>'experian_ocr_status','') as ocr_status,
    nullif(o.raw->>'experian_idmn_collected_at','') as idmn_collected_at,
    nullif(o.raw->>'experian_kyc_checked_at','') as kyc_checked_at,
    (o.raw ? 'experian_idmn_result') as has_idmn_result,
    (o.raw ? 'experian_ocr_result') as has_ocr_result,
    (o.raw ? 'experian_kyc_addresses') as has_kyc_addresses,
    (o.raw ? 'experian_kyc_contact') as has_kyc_contact,
    (o.raw ? 'experian_idmn_transaction_id') as has_idmn_transaction,
    lower(coalesce(o.row_data->>'kyc_status','')) in ('verified','onboarding_complete','completed') as onboarding_verified
  from public.profiles p
  left join onboarding o on o.user_id=p.id
  left join archive a on a.user_id=p.id
)
select
  count(*) filter(where archived_documents>0 or has_idmn_result or has_ocr_result
    or has_kyc_addresses or has_kyc_contact or has_idmn_transaction) as users_with_any_experian_evidence,
  count(*) filter(where archived_documents>0) as users_with_experian_archive,
  count(*) filter(where has_idmn_result) as users_with_retained_idmn_result,
  count(*) filter(where has_kyc_addresses or has_kyc_contact) as users_with_kyc_enrichment,
  count(*) filter(where idmn_status='verified' or onboarding_verified) as users_marked_verified
from evidence;

with onboarding as (
  select user_id,
    case when jsonb_typeof(to_jsonb(o)->'sumsub_raw')='object'
      then to_jsonb(o)->'sumsub_raw' else '{}'::jsonb end as raw,
    to_jsonb(o) as row_data
  from public.user_onboarding o
), archive as (
  select profile_id as user_id,count(*) document_count,max(archived_at) last_archived_at
  from public.sumsub_document_archive
  where lower(coalesce(resource_metadata->>'provider','')) like 'experian%'
     or lower(coalesce(resource_metadata->>'source','')) like 'experian%'
     or lower(coalesce(file_name,'')) like 'experian%'
  group by profile_id
)
select
  p.id as user_id,
  concat_ws(' ',nullif(p.first_name,''),nullif(p.last_name,'')) as client_name,
  p.email,
  coalesce(a.document_count,0) as archived_documents,
  a.last_archived_at,
  nullif(o.raw->>'experian_idmn_status','') as idmn_status,
  nullif(o.raw->>'experian_ocr_status','') as ocr_status,
  nullif(o.raw->>'experian_idmn_collected_at','') as idmn_collected_at,
  nullif(o.raw->>'experian_kyc_checked_at','') as kyc_checked_at,
  o.raw ? 'experian_idmn_result' as has_idmn_result,
  o.raw ? 'experian_ocr_result' as has_ocr_result,
  o.raw ? 'experian_kyc_addresses' as has_kyc_addresses,
  o.raw ? 'experian_kyc_contact' as has_kyc_contact,
  o.raw ? 'experian_idmn_transaction_id' as has_idmn_transaction,
  o.row_data->>'kyc_status' as onboarding_kyc_status
from public.profiles p
left join onboarding o on o.user_id=p.id
left join archive a on a.user_id=p.id
where coalesce(a.document_count,0)>0
   or o.raw ?| array['experian_idmn_result','experian_ocr_result','experian_kyc_addresses',
                     'experian_kyc_contact','experian_idmn_transaction_id']
order by coalesce(a.last_archived_at,
  nullif(o.raw->>'experian_idmn_collected_at','')::timestamptz,
  nullif(o.raw->>'experian_kyc_checked_at','')::timestamptz) desc nulls last;
