ALTER TABLE rewards_wallets ADD COLUMN IF NOT EXISTS ad_points_earned BIGINT NOT NULL DEFAULT 0 CHECK (ad_points_earned >= 0);
ALTER TABLE rewards_wallets ADD COLUMN IF NOT EXISTS gome_coins BIGINT NOT NULL DEFAULT 0 CHECK (gome_coins >= 0);
ALTER TABLE rewards_wallets ADD COLUMN IF NOT EXISTS conversion_remainder BIGINT NOT NULL DEFAULT 0 CHECK (conversion_remainder >= 0 AND conversion_remainder < 10);
ALTER TABLE rewards_transactions DROP CONSTRAINT IF EXISTS rewards_transactions_type_check;
ALTER TABLE rewards_transactions ADD CONSTRAINT rewards_transactions_type_check CHECK (type IN ('tap','tap_spend','daily_reward','referral_bonus','admin_adjustment'));
