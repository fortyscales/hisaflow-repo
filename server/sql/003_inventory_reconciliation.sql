BEGIN;
CREATE TABLE IF NOT EXISTS inventory_reconciliation_issues (
  id uuid PRIMARY KEY,
  shop_id uuid NOT NULL REFERENCES shops(id),
  product_id text NOT NULL,
  issue_type text NOT NULL CHECK(issue_type IN ('OVERSELL')),
  status text NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','ACKNOWLEDGED','RESOLVED')),
  detected_quantity numeric NOT NULL,
  current_quantity numeric NOT NULL,
  first_detected_at timestamptz NOT NULL DEFAULT now(),
  last_detected_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  resolution_note text
);
CREATE UNIQUE INDEX IF NOT EXISTS inventory_reconciliation_one_active_oversell
  ON inventory_reconciliation_issues(shop_id,product_id,issue_type) WHERE status <> 'RESOLVED';
CREATE INDEX IF NOT EXISTS inventory_reconciliation_shop_status_idx
  ON inventory_reconciliation_issues(shop_id,status,last_detected_at DESC);
COMMIT;
