-- Daily standup snapshots — captures task state at end of each SAST day
CREATE TABLE IF NOT EXISTS standup_logs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  log_date    date NOT NULL,
  task_id     uuid REFERENCES tasks(id) ON DELETE SET NULL,
  member_id   uuid REFERENCES admin_team(id) ON DELETE SET NULL,
  title       text NOT NULL,
  status      text NOT NULL,
  priority    text DEFAULT 'medium',
  due_date    date,
  snapped_at  timestamptz DEFAULT now(),
  UNIQUE (log_date, task_id)
);

CREATE INDEX IF NOT EXISTS standup_logs_date_idx ON standup_logs (log_date);
CREATE INDEX IF NOT EXISTS standup_logs_member_idx ON standup_logs (member_id, log_date);
