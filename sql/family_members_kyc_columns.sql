-- ============================================================
-- Add KYC verification columns + UPDATE RLS policy for family_members
-- Run this in the Supabase SQL Editor
-- ============================================================

-- 1. Add kyc_status column (defaults to 'pending' for all children)
ALTER TABLE public.family_members
  ADD COLUMN IF NOT EXISTS kyc_status text NOT NULL DEFAULT 'pending'
    CONSTRAINT family_members_kyc_status_check
    CHECK (kyc_status IN ('pending', 'completed', 'rejected'));

-- 2. Add certificate_url column (stores the uploaded birth certificate URL)
ALTER TABLE public.family_members
  ADD COLUMN IF NOT EXISTS certificate_url text;

-- 3. Add reviewer columns for audit trail
ALTER TABLE public.family_members
  ADD COLUMN IF NOT EXISTS kyc_reviewed_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS kyc_reviewed_at timestamptz;

-- 4. Allow admin UUIDs to UPDATE family_members (for accept/reject actions)
CREATE POLICY "admin_update_family_members"
ON public.family_members
FOR UPDATE
USING (
  auth.uid() IN (
    'be89ac8b-d6ed-4cc2-a314-8c6fe34d2a68'::uuid,
    '2511df6b-e0a5-489e-8614-c74cf7d48cb4'::uuid,
    'b215eb9a-4017-45f1-a460-6056b1db0c4d'::uuid,
    '3401d428-4ed7-4ba1-ae64-4bd16d2485a4'::uuid,
    'a8d225b4-9f1a-45e0-8dc4-8ecdc7789e3c'::uuid,
    '41523b8c-3f3e-48c4-ba08-0e0a931156cd'::uuid
  )
)
WITH CHECK (
  auth.uid() IN (
    'be89ac8b-d6ed-4cc2-a314-8c6fe34d2a68'::uuid,
    '2511df6b-e0a5-489e-8614-c74cf7d48cb4'::uuid,
    'b215eb9a-4017-45f1-a460-6056b1db0c4d'::uuid,
    '3401d428-4ed7-4ba1-ae64-4bd16d2485a4'::uuid,
    'a8d225b4-9f1a-45e0-8dc4-8ecdc7789e3c'::uuid,
    '41523b8c-3f3e-48c4-ba08-0e0a931156cd'::uuid
  )
);
