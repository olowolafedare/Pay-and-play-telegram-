CREATE TABLE app_users (
 id BIGSERIAL PRIMARY KEY, telegram_id BIGINT NOT NULL UNIQUE, username TEXT, first_name TEXT NOT NULL, last_name TEXT,
 language_code TEXT, referred_by BIGINT REFERENCES app_users(telegram_id), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE rewards_wallets (
 user_id BIGINT PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE, points BIGINT NOT NULL DEFAULT 0 CHECK(points>=0),
 lifetime_earned BIGINT NOT NULL DEFAULT 0 CHECK(lifetime_earned>=0), ad_points_earned BIGINT NOT NULL DEFAULT 0 CHECK(ad_points_earned>=0), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE rewards_transactions (
 id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
 type TEXT NOT NULL CHECK (type IN ('tap','tap_spend','daily_reward','ad_reward','referral_bonus','admin_adjustment')),
 points BIGINT NOT NULL CHECK(points>0), idempotency_key TEXT NOT NULL UNIQUE, metadata JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE tap_sessions (
 id BIGSERIAL PRIMARY KEY,user_id BIGINT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
 tap_count INTEGER NOT NULL CHECK(tap_count>0),points_awarded BIGINT NOT NULL CHECK(points_awarded>=0),created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE daily_reward_claims (
 id BIGSERIAL PRIMARY KEY,user_id BIGINT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
 claim_date DATE NOT NULL DEFAULT CURRENT_DATE,points_awarded BIGINT NOT NULL CHECK(points_awarded>0),created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),UNIQUE(user_id,claim_date)
);
CREATE TABLE referrals (
 id BIGSERIAL PRIMARY KEY,referrer_user_id BIGINT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
 referred_user_id BIGINT NOT NULL UNIQUE REFERENCES app_users(id) ON DELETE CASCADE,
 status TEXT NOT NULL DEFAULT 'registered' CHECK(status IN ('registered','qualified','rejected')),bonus_awarded BIGINT NOT NULL DEFAULT 0 CHECK(bonus_awarded>=0),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),qualified_at TIMESTAMPTZ
);
CREATE TABLE rewarded_ad_events (
 provider_event_id TEXT PRIMARY KEY,
 user_id BIGINT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
 points_awarded BIGINT NOT NULL CHECK(points_awarded > 0),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_rewards_transactions_user_created ON rewards_transactions(user_id,created_at DESC);
CREATE INDEX idx_tap_sessions_user_created ON tap_sessions(user_id,created_at DESC);
CREATE INDEX idx_referrals_referrer ON referrals(referrer_user_id,created_at DESC);

ALTER TABLE rewards_wallets ADD COLUMN IF NOT EXISTS gome_coins BIGINT NOT NULL DEFAULT 0 CHECK (gome_coins >= 0), ADD COLUMN IF NOT EXISTS conversion_remainder BIGINT NOT NULL DEFAULT 0 CHECK (conversion_remainder >= 0 AND conversion_remainder < 10);
ALTER TABLE rewards_transactions DROP CONSTRAINT IF EXISTS rewards_transactions_type_check;
ALTER TABLE rewards_transactions ADD CONSTRAINT rewards_transactions_type_check CHECK (type IN ('tap','tap_spend','daily_reward','ad_reward','referral_bonus','admin_adjustment'));
