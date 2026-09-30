BEGIN;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS revoked_at timestamptz;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS revoked_by uuid REFERENCES users(id);
ALTER TABLE devices ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS devices_shop_active_idx ON devices(shop_id,last_seen_at DESC) WHERE revoked_at IS NULL;
COMMIT;
