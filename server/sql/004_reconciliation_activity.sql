BEGIN;
CREATE TABLE IF NOT EXISTS inventory_reconciliation_activity (
  id bigserial PRIMARY KEY,
  issue_id uuid NOT NULL REFERENCES inventory_reconciliation_issues(id) ON DELETE CASCADE,
  shop_id uuid NOT NULL REFERENCES shops(id),
  activity_type text NOT NULL CHECK(activity_type IN ('DETECTED','ACKNOWLEDGED','RESOLVED','NOTE')),
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inventory_reconciliation_activity_issue_idx
  ON inventory_reconciliation_activity(issue_id,created_at DESC,id DESC);
COMMIT;
