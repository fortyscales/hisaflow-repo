BEGIN;
CREATE TABLE IF NOT EXISTS users (id uuid PRIMARY KEY, email text UNIQUE NOT NULL, password_hash text, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS shops (id uuid PRIMARY KEY, name text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version bigint NOT NULL DEFAULT 1 CHECK(version>=1));
CREATE TABLE IF NOT EXISTS shop_memberships (shop_id uuid NOT NULL REFERENCES shops(id), user_id uuid NOT NULL REFERENCES users(id), role text NOT NULL CHECK(role IN('owner','admin','manager','staff')), created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(shop_id,user_id));
CREATE TABLE IF NOT EXISTS devices (id uuid PRIMARY KEY, shop_id uuid NOT NULL REFERENCES shops(id), name text, last_seen_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS devices_shop_idx ON devices(shop_id);
CREATE TABLE IF NOT EXISTS sync_events (
 event_id text PRIMARY KEY, shop_id uuid NOT NULL REFERENCES shops(id), device_id uuid NOT NULL REFERENCES devices(id), entity_type text NOT NULL, entity_id text NOT NULL,
 operation text NOT NULL CHECK(operation IN('UPSERT','DELETE')), entity_version bigint, occurred_at timestamptz NOT NULL, payload jsonb, received_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS sync_events_shop_received_idx ON sync_events(shop_id,received_at,event_id);
CREATE TABLE IF NOT EXISTS entity_snapshots (
 shop_id uuid NOT NULL REFERENCES shops(id), entity_type text NOT NULL, entity_id text NOT NULL, version bigint NOT NULL DEFAULT 1 CHECK(version>=1), payload jsonb,
 deleted_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now(), source_device_id uuid REFERENCES devices(id), PRIMARY KEY(shop_id,entity_type,entity_id));
CREATE TABLE IF NOT EXISTS sync_changes (
 seq bigserial PRIMARY KEY, shop_id uuid NOT NULL REFERENCES shops(id), event_id text NOT NULL UNIQUE REFERENCES sync_events(event_id), entity_type text NOT NULL, entity_id text NOT NULL,
 operation text NOT NULL CHECK(operation IN('UPSERT','DELETE')), entity_version bigint, payload jsonb, occurred_at timestamptz NOT NULL, source_device_id uuid NOT NULL REFERENCES devices(id));
CREATE INDEX IF NOT EXISTS sync_changes_pull_idx ON sync_changes(shop_id,seq);
COMMIT;
