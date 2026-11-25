-- Run this ONLY if you already created the database with the old schema.sql.
-- A fresh database just needs db/schema.sql.
ALTER TABLE rewards_wallets
  ADD COLUMN IF NOT EXISTS ad_points_earned BIGINT NOT NULL DEFAULT 0 CHECK (ad_points_earned >= 0);

ALTER TABLE rewards_transactions DROP CONSTRAINT IF EXISTS rewards_transactions_type_check;
ALTER TABLE rewards_transactions ADD CONSTRAINT rewards_transactions_type_check
  CHECK (type IN ('tap','daily_reward','ad_reward','referral_bonus','admin_adjustment'));

CREATE TABLE IF NOT EXISTS rewarded_ad_events (
  provider_event_id TEXT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  points_awarded BIGINT NOT NULL CHECK (points_awarded > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rewarded_ad_events_user_created ON rewarded_ad_events(user_id, created_at DESC);
