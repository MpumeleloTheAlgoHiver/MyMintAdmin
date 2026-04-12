-- ============================================================
-- RLS policy: Allow specific admin users to view ALL family_members
-- Run this in the Supabase SQL Editor
-- ============================================================

-- Ensure RLS is enabled (it likely already is)
ALTER TABLE public.family_members ENABLE ROW LEVEL SECURITY;

-- Allow these admin UUIDs to SELECT all rows from family_members
CREATE POLICY "admin_view_all_family_members"
ON public.family_members
FOR SELECT
USING (
  auth.uid() IN (
    'be89ac8b-d6ed-4cc2-a314-8c6fe34d2a68'::uuid,
    '2511df6b-e0a5-489e-8614-c74cf7d48cb4'::uuid,
    'b215eb9a-4017-45f1-a460-6056b1db0c4d'::uuid,
    '3401d428-4ed7-4ba1-ae64-4bd16d2485a4'::uuid,
    'a8d225b4-9f1a-45e0-8dc4-8ecdc7789e3c'::uuid,
    '41523b8c-3f3e-48c4-ba08-0e0a931156cd'::uuid
  )
);
