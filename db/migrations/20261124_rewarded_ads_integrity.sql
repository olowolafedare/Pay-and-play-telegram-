-- Add durable Monetag rewarded-ad event deduplication and permit ad reward ledger entries.
CREATE TABLE IF NOT EXISTS rewarded_ad_events (
  provider_event_id TEXT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  points_awarded BIGINT NOT NULL CHECK (points_awarded > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE rewards_transactions
  DROP CONSTRAINT IF EXISTS rewards_transactions_type_check;

ALTER TABLE rewards_transactions
  ADD CONSTRAINT rewards_transactions_type_check
  CHECK (type IN ('tap','tap_spend','daily_reward','ad_reward','referral_bonus','admin_adjustment'));
