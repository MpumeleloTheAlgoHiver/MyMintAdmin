-- Admin profiles table: links to auth.users, stores role + page permissions
-- role: 'admin' (full access + can manage team) | 'staff' (restricted to page_permissions)
-- page_permissions: array of page keys the staff member can access
--   valid keys: 'profiles', 'dashboard', 'strategies', 'factsheets', 'investors', 'eft', 'orderbook', 'settings', 'team'

CREATE TABLE IF NOT EXISTS admin_profiles (
  user_id          uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email            text NOT NULL,
  full_name        text,
  role             text NOT NULL DEFAULT 'staff' CHECK (role IN ('admin', 'staff')),
  page_permissions text[] NOT NULL DEFAULT '{}',
  invited_by       uuid REFERENCES auth.users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_admin_profiles_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_admin_profiles_updated_at ON admin_profiles;
CREATE TRIGGER trg_admin_profiles_updated_at
  BEFORE UPDATE ON admin_profiles
  FOR EACH ROW EXECUTE FUNCTION update_admin_profiles_updated_at();

-- RLS
ALTER TABLE admin_profiles ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read their own row (needed for auth-guard on every page)
DROP POLICY IF EXISTS "admin_profiles_read_own" ON admin_profiles;
CREATE POLICY "admin_profiles_read_own"
  ON admin_profiles FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Admins can read all rows (needed for the Team management page)
DROP POLICY IF EXISTS "admin_profiles_read_all_for_admins" ON admin_profiles;
CREATE POLICY "admin_profiles_read_all_for_admins"
  ON admin_profiles FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM admin_profiles ap
      WHERE ap.user_id = auth.uid() AND ap.role = 'admin'
    )
  );

-- Admins can insert (invite new users)
DROP POLICY IF EXISTS "admin_profiles_insert_by_admin" ON admin_profiles;
CREATE POLICY "admin_profiles_insert_by_admin"
  ON admin_profiles FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM admin_profiles ap
      WHERE ap.user_id = auth.uid() AND ap.role = 'admin'
    )
  );

-- Admins can update (change role or permissions)
DROP POLICY IF EXISTS "admin_profiles_update_by_admin" ON admin_profiles;
CREATE POLICY "admin_profiles_update_by_admin"
  ON admin_profiles FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM admin_profiles ap
      WHERE ap.user_id = auth.uid() AND ap.role = 'admin'
    )
  );

-- Admins can delete (remove a team member)
DROP POLICY IF EXISTS "admin_profiles_delete_by_admin" ON admin_profiles;
CREATE POLICY "admin_profiles_delete_by_admin"
  ON admin_profiles FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM admin_profiles ap
      WHERE ap.user_id = auth.uid() AND ap.role = 'admin'
    )
  );

-- Update storage policies to use admin_profiles instead of hardcoded UUIDs
DROP POLICY IF EXISTS "admin_users_view_child_docs_objects" ON storage.objects;
CREATE POLICY "admin_users_view_child_docs_objects"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id IN ('birth-certificates', 'signed-agreements')
    AND EXISTS (
      SELECT 1 FROM admin_profiles ap WHERE ap.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "admin_users_view_child_docs_buckets" ON storage.buckets;
CREATE POLICY "admin_users_view_child_docs_buckets"
  ON storage.buckets FOR SELECT
  TO authenticated
  USING (
    id IN ('birth-certificates', 'signed-agreements')
    AND EXISTS (
      SELECT 1 FROM admin_profiles ap WHERE ap.user_id = auth.uid()
    )
  );

-- Seed: Auto-migrate existing admins from hardcoded UUIDs to admin_profiles
-- This finds anyone with a UUID in the old hardcoded list and gives them admin access
INSERT INTO admin_profiles (user_id, email, role, page_permissions)
SELECT
  id,
  email,
  'admin',
  ARRAY['profiles','dashboard','strategies','factsheets','investors','eft','orderbook','settings','team']
FROM auth.users
WHERE id IN (
  'be89ac8b-d6ed-4cc2-a314-8c6fe34d2a68'::uuid,
  '2511df6b-e0a5-489e-8614-c74cf7d48cb4'::uuid,
  'b215eb9a-4017-45f1-a460-6056b1db0c4d'::uuid,
  '3401d428-4ed7-4ba1-ae64-4bd16d2485a4'::uuid,
  'a8d225b4-9f1a-45e0-8dc4-8ecdc7789e3c'::uuid,
  '41523b8c-3f3e-48c4-ba08-0e0a931156cd'::uuid
)
ON CONFLICT (user_id) DO NOTHING;
