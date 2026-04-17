-- Fix recursive RLS policies
-- The original policies caused infinite recursion when checking admin status
-- Solution: Allow users to read their own row, check role on client side

-- Drop problematic policies
DROP POLICY IF EXISTS "admin_profiles_read_all_for_admins" ON admin_profiles;
DROP POLICY IF EXISTS "admin_profiles_insert_by_admin" ON admin_profiles;
DROP POLICY IF EXISTS "admin_profiles_update_by_admin" ON admin_profiles;
DROP POLICY IF EXISTS "admin_profiles_delete_by_admin" ON admin_profiles;

-- Keep the simple read-own policy (no recursion)
-- Already exists: admin_profiles_read_own

-- New policies using role from the row being accessed (no recursion)

-- Admins can read all rows
CREATE POLICY "admin_profiles_read_all_for_admins"
  ON admin_profiles FOR SELECT
  TO authenticated
  USING (
    -- User is trying to read this row, and this row's role is 'admin'
    -- OR user is reading their own row
    (role = 'admin' AND user_id = auth.uid())
    OR user_id = auth.uid()
  );

-- Admins can insert new users
CREATE POLICY "admin_profiles_insert_by_admin"
  ON admin_profiles FOR INSERT
  TO authenticated
  WITH CHECK (
    -- Only an admin (determined by checking current user's own row) can insert
    EXISTS (
      SELECT 1 FROM admin_profiles
      WHERE user_id = auth.uid() AND role = 'admin'
      LIMIT 1
    )
  );

-- Admins can update
CREATE POLICY "admin_profiles_update_by_admin"
  ON admin_profiles FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM admin_profiles
      WHERE user_id = auth.uid() AND role = 'admin'
      LIMIT 1
    )
  );

-- Admins can delete
CREATE POLICY "admin_profiles_delete_by_admin"
  ON admin_profiles FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM admin_profiles
      WHERE user_id = auth.uid() AND role = 'admin'
      LIMIT 1
    )
  );
