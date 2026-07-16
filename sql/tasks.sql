CREATE TABLE IF NOT EXISTS tasks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title        text NOT NULL,
  priority     text CHECK (priority IN ('low','medium','high','urgent')) DEFAULT 'medium',
  status       text CHECK (status IN ('todo','in_progress','done')) DEFAULT 'todo',
  due_date     date,
  assigned_to  uuid REFERENCES admin_team(id) ON DELETE SET NULL,
  created_by   uuid REFERENCES admin_team(id) ON DELETE SET NULL,
  completed_at timestamptz,
  created_at   timestamptz DEFAULT now()
);

ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'tasks' AND policyname = 'service_role_all'
  ) THEN
    CREATE POLICY "service_role_all" ON tasks USING (true) WITH CHECK (true);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS tasks_assigned_to_idx ON tasks(assigned_to);
CREATE INDEX IF NOT EXISTS tasks_due_date_idx    ON tasks(due_date);
CREATE INDEX IF NOT EXISTS tasks_status_idx      ON tasks(status);
