BEGIN;
CREATE TABLE IF NOT EXISTS storefronts (
 shop_id uuid PRIMARY KEY REFERENCES shops(id),
 draft jsonb NOT NULL DEFAULT '{}'::jsonb,
 published jsonb,
 revision integer NOT NULL DEFAULT 0,
 published_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT now()
);
COMMIT;
