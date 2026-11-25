-- Energy bar + batched taps. Run after 001_ad_rewards.sql on a database created with the OLD schema.
-- A fresh database just needs db/schema.sql (it already includes this).
ALTER TABLE rewards_wallets ADD COLUMN IF NOT EXISTS energy INTEGER NOT NULL DEFAULT 1000 CHECK (energy >= 0);
ALTER TABLE rewards_wallets ADD COLUMN IF NOT EXISTS energy_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE rewards_wallets ADD COLUMN IF NOT EXISTS last_tap_at TIMESTAMPTZ;
